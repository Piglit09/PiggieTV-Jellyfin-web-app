import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import { MediaType } from '@jellyfin/sdk/lib/generated-client/models/media-type';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';

import { getItemQuery } from 'hooks/useItem';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { ptvSafeConsole } from 'ptv/core/safeConsole';
import { currentSettings as userSettings } from 'scripts/settings/userSettings';
import { ItemKind } from 'types/base/models/item-kind';
import Events from 'utils/events.ts';
import { toApi } from 'utils/jellyfin-apiclient/compat';
import { queryClient } from 'utils/query/queryClient';

import { playbackManager } from './playback/playbackmanager';
import { isGuardedPlaybackStart } from './playback/playbackStartGuard';

let availableThemeItems = [];
let availableThemeOwnerId = null;
let availableThemeIdentity = null;
let currentOwnerId = null;
let currentThemeIds = [];
let pendingOwnerId = null;
let activePlaybackGeneration = null;
let activeThemeIds = [];
let playbackGeneration = 0;
let themeLoadGeneration = 0;
let themePlaybackSuppressed = false;
let activeThemeRouteKey = null;
let loadedThemeRouteKey = null;
let identityEventsBound = false;
const themePlaybackAttempts = new Map();

function isCurrentThemeIdentity(identity) {
    try {
        return Boolean(identity?.userId
            && ServerConnections.getApiClient(identity.serverId)?.getCurrentUserId() === identity.userId);
    } catch {
        return false;
    }
}

function getCurrentThemePlayback() {
    const player = playbackManager.getCurrentPlayer?.();
    let item = null;
    let paused;

    try {
        item = player ? playbackManager.currentItem(player) : null;
        paused = typeof player?.paused === 'function' ? player.paused() : undefined;
    } catch (err) {
        ptvSafeConsole.warn('[ThemeMediaPlayer] failed to inspect current playback', err);
    }

    return {
        item,
        paused,
        player
    };
}

function isThemeItem(item) {
    return Boolean(item?.Id && currentThemeIds.includes(item.Id));
}

function attemptOwnsItem(attempt, item) {
    return Boolean(item?.Id && attempt?.ids.includes(item.Id));
}

function stopThemePlayback() {
    try {
        void Promise.resolve(playbackManager.stop()).catch(err => {
            ptvSafeConsole.warn('[ThemeMediaPlayer] failed to stop theme media', err);
        });
    } catch (err) {
        ptvSafeConsole.warn('[ThemeMediaPlayer] failed to stop theme media', err);
    }
}

function stopStaleThemeAttempt(generation) {
    const attempt = themePlaybackAttempts.get(generation);

    if (!attempt) return;

    const playback = getCurrentThemePlayback();
    const acceptedByCurrentAttempt = activePlaybackGeneration === playbackGeneration
        && Boolean(playback.item?.Id && activeThemeIds.includes(playback.item.Id));

    if (acceptedByCurrentAttempt) {
        themePlaybackAttempts.delete(generation);
        return;
    }

    const newerAttemptPending = activePlaybackGeneration === playbackGeneration
        && activePlaybackGeneration !== generation
        && themePlaybackAttempts.has(activePlaybackGeneration);
    const staleAttemptIsCurrent = attemptOwnsItem(attempt, playback.item);

    if (staleAttemptIsCurrent) {
        currentThemeIds = Array.from(new Set([
            ...currentThemeIds,
            ...attempt.ids
        ]));

        if (!newerAttemptPending) {
            stopThemePlayback();
        }
    }

    themePlaybackAttempts.delete(generation);

    if (
        staleAttemptIsCurrent
        && !newerAttemptPending
        && !themePlaybackSuppressed
        && availableThemeItems.some(item => enabled(item.MediaType))
    ) {
        playAvailableThemeMedia();
    }
}

function commitThemeOwner(ownerId, generation) {
    if (generation !== playbackGeneration) return;

    const playback = getCurrentThemePlayback();

    if (
        playback.item?.Id
        && activeThemeIds.includes(playback.item.Id)
        && playback.paused === false
    ) {
        currentOwnerId = ownerId;
        pendingOwnerId = null;
        return;
    }

    currentOwnerId = null;
}

function retireFailedThemeAttempt(generation, attempt) {
    themePlaybackAttempts.delete(generation);

    if (generation !== playbackGeneration || activePlaybackGeneration !== generation) {
        return;
    }

    const playback = getCurrentThemePlayback();

    if (isThemeItem(playback.item) && !attemptOwnsItem(attempt, playback.item)) {
        stopThemePlayback();
    }

    activePlaybackGeneration = null;
    activeThemeIds = [];
    currentOwnerId = null;
    pendingOwnerId = null;
}

async function startThemePlayback(options, ownerId, generation) {
    const attempt = themePlaybackAttempts.get(generation);

    try {
        await playbackManager.play(options);

        if (generation !== playbackGeneration || activePlaybackGeneration !== generation) {
            stopStaleThemeAttempt(generation);
            return;
        }

        const playback = getCurrentThemePlayback();

        if (!attemptOwnsItem(attempt, playback.item)) {
            retireFailedThemeAttempt(generation, attempt);
            return;
        }

        currentThemeIds = [...attempt.ids];
        commitThemeOwner(ownerId, generation);
        themePlaybackAttempts.delete(generation);
    } catch (err) {
        retireFailedThemeAttempt(generation, attempt);

        ptvSafeConsole.warn('[ThemeMediaPlayer] failed to start theme media', err);
    }
}

function playThemeMedia(items, ownerId) {
    const currentThemeItems = items.filter(function (i) {
        return enabled(i.MediaType);
    });

    if (currentThemeItems.length) {
        if (themePlaybackSuppressed) return;

        const requestedThemeIds = currentThemeItems.map(function (i) {
            return i.Id;
        });
        const playback = getCurrentThemePlayback();
        const currentItemIsTheme = isThemeItem(playback.item);

        // Leave user-selected media alone. A browser-blocked theme attempt has
        // a source but remains paused, so it must still be eligible for retry.
        if (playbackManager.isPlaying() && !currentItemIsTheme) {
            return;
        }

        if (
            currentOwnerId === ownerId
            && currentItemIsTheme
            && playback.paused === false
        ) return;

        currentThemeIds = Array.from(new Set([
            ...currentThemeIds,
            ...requestedThemeIds
        ]));
        pendingOwnerId = ownerId;
        currentOwnerId = null;
        playbackGeneration += 1;

        const generation = playbackGeneration;
        const attempt = {
            ids: requestedThemeIds,
            identity: availableThemeIdentity
        };

        activePlaybackGeneration = generation;
        activeThemeIds = requestedThemeIds;
        themePlaybackAttempts.set(generation, attempt);

        currentThemeItems.forEach((i) => {
            i.playOptions = {
                fullscreen: false,
                enableRemotePlayers: false
            };
        });

        void startThemePlayback({
            items: currentThemeItems,
            aspectRatio: 'cover',
            fullscreen: false,
            enableRemotePlayers: false,
            playbackStartGuard: () => generation === playbackGeneration
                && activePlaybackGeneration === generation
                && !themePlaybackSuppressed
                && isCurrentThemeIdentity(attempt.identity)
        }, ownerId, generation);
    } else {
        stopIfPlaying();
    }
}

function stopIfPlaying() {
    const playback = getCurrentThemePlayback();
    const knownThemeIds = new Set(currentThemeIds);

    themePlaybackAttempts.forEach(attempt => {
        attempt.ids.forEach(id => {
            knownThemeIds.add(id);
        });
    });

    const currentItemIsTheme = Boolean(
        playback.item?.Id && knownThemeIds.has(playback.item.Id)
    );

    if (currentItemIsTheme) {
        stopThemePlayback();
    }

    playbackGeneration += 1;
    activePlaybackGeneration = null;
    activeThemeIds = [];
    currentOwnerId = null;
    currentThemeIds = currentItemIsTheme || (!playback.item && themePlaybackAttempts.size) ?
        Array.from(knownThemeIds) : [];
    pendingOwnerId = null;
}

function beginThemeRouteLoad() {
    availableThemeItems = [];
    availableThemeOwnerId = null;
    availableThemeIdentity = null;
    playbackGeneration += 1;
    activePlaybackGeneration = null;
    activeThemeIds = [];
    currentOwnerId = null;
    pendingOwnerId = null;
}

function clearAvailableThemeMedia() {
    availableThemeItems = [];
    availableThemeOwnerId = null;
    availableThemeIdentity = null;
    stopIfPlaying();
}

function playAvailableThemeMedia() {
    return playThemeMedia(availableThemeItems, availableThemeOwnerId);
}

function enabled(mediaType) {
    if (mediaType === MediaType.Video) {
        return userSettings.enableThemeVideos();
    }

    return userSettings.enableThemeSongs();
}

const excludeTypes = [
    ItemKind.CollectionFolder,
    ItemKind.UserView,
    ItemKind.Person,
    ItemKind.Program,
    ItemKind.TvChannel,
    ItemKind.Channel,
    ItemKind.SeriesTimer
];

async function loadThemeMedia(serverId, itemId, userId, generation, routeKey) {
    try {
        const apiClient = ServerConnections.getApiClient(serverId);
        const api = toApi(apiClient);
        const identity = { serverId, userId };
        const item = await queryClient.fetchQuery(getItemQuery(
            api,
            itemId,
            userId
        ));

        if (generation !== themeLoadGeneration || !isCurrentThemeIdentity(identity)) return;

        if (item.CollectionType) {
            loadedThemeRouteKey = routeKey;
            clearAvailableThemeMedia();
            return;
        }

        if (excludeTypes.includes(item.Type)) {
            loadedThemeRouteKey = routeKey;
            clearAvailableThemeMedia();
            return;
        }

        const { data: themeMedia } = await getLibraryApi(api).getThemeMedia({
            userId,
            itemId: item.Id,
            inheritFromParent: true,
            sortBy: [ItemSortBy.Random]
        });

        if (generation !== themeLoadGeneration || !isCurrentThemeIdentity(identity)) return;

        const result = userSettings.enableThemeVideos() && themeMedia.ThemeVideosResult?.Items?.length ?
            themeMedia.ThemeVideosResult :
            themeMedia.ThemeSongsResult;

        availableThemeItems = result?.Items || [];
        availableThemeOwnerId = result?.OwnerId || null;
        availableThemeIdentity = identity;
        loadedThemeRouteKey = routeKey;
        playAvailableThemeMedia();
    } catch (err) {
        if (generation !== themeLoadGeneration) return;

        activeThemeRouteKey = null;
        loadedThemeRouteKey = null;
        clearAvailableThemeMedia();
        ptvSafeConsole.error('[ThemeMediaPlayer] failed to load theme media', err);
    }
}

document.addEventListener('viewshow', e => {
    // ServerConnections participates in the bootstrap import graph. Bind only
    // after the application begins showing views, before themes can be owned.
    if (!identityEventsBound) {
        Events.on(ServerConnections, 'localusersignedin', retireThemeRoute);
        Events.on(ServerConnections, 'localusersignedout', retireThemeRoute);
        identityEventsBound = true;
    }
    const { serverId, id } = e.detail?.params || {};

    if (serverId && id) {
        const userId = ServerConnections.getApiClient(serverId)?.getCurrentUserId();
        if (!userId) {
            retireThemeRoute();
            return;
        }
        const routeKey = JSON.stringify([serverId, userId, id]);
        themePlaybackSuppressed = false;

        if (routeKey === activeThemeRouteKey) {
            if (routeKey === loadedThemeRouteKey) {
                playAvailableThemeMedia();
            }
            return;
        }

        const generation = ++themeLoadGeneration;
        activeThemeRouteKey = routeKey;
        loadedThemeRouteKey = null;
        beginThemeRouteLoad();
        void loadThemeMedia(serverId, id, userId, generation, routeKey);
        return;
    }

    themeLoadGeneration += 1;
    const viewOptions = e.detail?.options || {};

    if (viewOptions.supportsThemeMedia) {
        // Do nothing here, allow it to keep playing
    } else {
        themePlaybackSuppressed = true;
        activeThemeRouteKey = null;
        loadedThemeRouteKey = null;
        clearAvailableThemeMedia();
    }
}, true);

function relinquishThemePlayback() {
    themePlaybackSuppressed = true;
    playbackGeneration += 1;
    activePlaybackGeneration = null;
    activeThemeIds = [];
    currentOwnerId = null;
    currentThemeIds = [];
    pendingOwnerId = null;
    themePlaybackAttempts.clear();
}

function retireThemeRoute() {
    themeLoadGeneration += 1;
    themePlaybackSuppressed = true;
    activeThemeRouteKey = null;
    loadedThemeRouteKey = null;
    clearAvailableThemeMedia();
}

Events.on(playbackManager, 'playbackrequest', (_event, options) => {
    if (!isGuardedPlaybackStart(options)) relinquishThemePlayback();
});

Events.on(playbackManager, 'playbackstart', (_e, player) => {
    const item = playbackManager.currentItem(player);

    if (
        activePlaybackGeneration === playbackGeneration
        && item?.Id
        && activeThemeIds.includes(item.Id)
    ) {
        currentThemeIds = [...activeThemeIds];
        commitThemeOwner(pendingOwnerId || availableThemeOwnerId, playbackGeneration);
    } else if (Array.from(themePlaybackAttempts.entries()).some(([generation, attempt]) => {
        if (!attemptOwnsItem(attempt, item)) return false;

        stopStaleThemeAttempt(generation);
        return true;
    })) {
        return;
    } else if (!themePlaybackSuppressed && isThemeItem(item)) {
        return;
    } else {
        // User played something manually.
        relinquishThemePlayback();
    }
});

Events.on(userSettings, 'change', (_event, settingName) => {
    if (settingName !== 'enableThemeSongs') return;

    themePlaybackSuppressed = false;
    playAvailableThemeMedia();
});
