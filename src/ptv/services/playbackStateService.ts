import { playbackManager } from '../../components/playback/playbackmanager';
import Events from '../../utils/events';

import {
    getPtvItemImageUrl,
    playPtvItem,
    type PtvItem
} from '../api';
import { recordPtvItemRouteClick, resolvePtvItemRoute } from '../core/itemRoutes';
import { recordPtvEvent } from '../core/observability';
import {
    nextPtvMusicTrack,
    openPtvMusicPlayer,
    previousPtvMusicTrack,
    stopPtvMusicPlayback,
    subscribeToPtvMusicQueue,
    togglePtvMusicPlayPause
} from '../modules/music/musicQueue';
import type {
    PtvMusicItem,
    PtvMusicQueueSnapshot
} from '../modules/music/musicTypes';

import {
    incrementPtvPerformanceCounter,
    recordPtvPerformanceEntry,
    setPtvPlaybackSubscriptionCount
} from './performanceMonitor';

export type PtvGlobalPlaybackSource = 'jellyfin-player' | 'none' | 'ptv-music' | 'reading';

export type PtvGlobalPlaybackState = {
    active: boolean;
    album?: string;
    artist?: string;
    canSeek: boolean;
    durationTicks?: number;
    imageUrl?: string;
    itemId?: string;
    itemType?: string;
    lastEvent?: string;
    lastUpdatedAt: number;
    mediaType?: string;
    name?: string;
    paused: boolean;
    positionTicks?: number;
    queueLength?: number;
    rawItem?: PtvItem;
    routeHref?: string;
    seriesName?: string;
    sessionId?: string;
    source: PtvGlobalPlaybackSource;
};

type PlaybackListener = (state: PtvGlobalPlaybackState) => void;
type PtvPlaybackManagerLike = {
    getCurrentPlayer?: () => unknown;
    getPlayerState?: (player?: unknown) => Record<string, unknown>;
    currentItem?: (player?: unknown) => PtvItem | null;
    currentMediaSource?: (player?: unknown) => Record<string, unknown> | null;
    duration?: (player?: unknown) => number;
    getCurrentTicks?: (player?: unknown) => number;
    nextTrack?: (player?: unknown) => unknown;
    paused?: (player?: unknown) => boolean;
    playPause?: (player?: unknown) => unknown;
    previousTrack?: (player?: unknown) => unknown;
    stop?: (player?: unknown) => unknown;
};

const EMPTY_PLAYBACK_STATE: PtvGlobalPlaybackState = {
    active: false,
    canSeek: false,
    lastUpdatedAt: Date.now(),
    paused: true,
    source: 'none'
};

const listeners = new Set<PlaybackListener>();

let currentState: PtvGlobalPlaybackState = EMPTY_PLAYBACK_STATE;
let initialized = false;
let lastMusicSnapshot: PtvMusicQueueSnapshot | null = null;
let musicUnsubscribe: (() => void) | null = null;
let pollTimer: number | null = null;
let reconcileTimer: number | null = null;
const boundPlaybackManagerEvents: Array<{
    handler: () => void;
    name: string;
    target: PtvPlaybackManagerLike;
}> = [];

function getPlaybackManager() {
    return playbackManager as PtvPlaybackManagerLike | null | undefined;
}

function getRecordString(record: Record<string, unknown> | null | undefined, ...keys: string[]) {
    if (!record) return '';

    for (const key of keys) {
        const value = record[key];

        if (typeof value === 'string' && value.trim()) return value.trim();
    }

    return '';
}

function getRecordNumber(record: Record<string, unknown> | null | undefined, ...keys: string[]) {
    if (!record) return 0;

    for (const key of keys) {
        const value = record[key];

        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
            const numericValue = Number(value);

            if (Number.isFinite(numericValue)) return numericValue;
        }
    }

    return 0;
}

function getNestedRecord(record: Record<string, unknown> | null | undefined, key: string) {
    const value = record?.[key];

    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getMusicArtist(item: PtvMusicItem | null) {
    if (!item) return '';

    const artists = Array.isArray(item.Artists) ? item.Artists.filter(Boolean) : [];

    return item.Artist || item.AlbumArtist || artists.join(', ');
}

function getPlaybackImageUrl(item: PtvItem | null | undefined) {
    if (!item?.Id) return '';

    return getPtvItemImageUrl(item, {
        fillHeight: 180,
        fillWidth: 120,
        imageType: 'Primary',
        quality: 86
    });
}

function getMusicPlaybackState(snapshot: PtvMusicQueueSnapshot | null): PtvGlobalPlaybackState {
    const item = snapshot?.currentItem || null;
    const itemId = getRecordString(item, 'Id', 'id');

    if (!snapshot || !item || !itemId) {
        return EMPTY_PLAYBACK_STATE;
    }

    const route = resolvePtvItemRoute(item, {
        mediaType: 'music',
        source: 'global-playback-state'
    });

    return {
        active: true,
        album: item.Album || '',
        artist: getMusicArtist(item),
        canSeek: true,
        durationTicks: snapshot.runtimeTicks || item.RunTimeTicks || 0,
        imageUrl: getPlaybackImageUrl(item),
        itemId,
        itemType: item.Type || 'Audio',
        lastUpdatedAt: Date.now(),
        mediaType: item.MediaType || 'Audio',
        name: item.Name || 'Now Playing',
        paused: !snapshot.isPlaying,
        positionTicks: snapshot.positionTicks || 0,
        queueLength: snapshot.playlist.length,
        rawItem: item,
        routeHref: route.href,
        sessionId: getRecordString(item, 'PlaylistItemId') || itemId,
        source: 'ptv-music'
    };
}

function getJellyfinPlaybackState(lastEvent = ''): PtvGlobalPlaybackState {
    try {
        const playbackManagerLike = getPlaybackManager();

        if (!playbackManagerLike) return EMPTY_PLAYBACK_STATE;

        const player = playbackManagerLike.getCurrentPlayer?.();

        if (!player) return EMPTY_PLAYBACK_STATE;

        const state = playbackManagerLike.getPlayerState?.(player) || {};
        const playState = getNestedRecord(state, 'PlayState') || {};
        const mediaSource = getNestedRecord(state, 'MediaSource') || playbackManagerLike.currentMediaSource?.(player) || null;
        const item = (getNestedRecord(state, 'NowPlayingItem') || playbackManagerLike.currentItem?.(player) || null) as PtvItem | null;
        const itemId = getRecordString(item, 'Id', 'id');

        if (!itemId) return EMPTY_PLAYBACK_STATE;

        const route = resolvePtvItemRoute(item, {
            source: 'global-playback-state'
        });
        const positionTicks = getRecordNumber(playState, 'PositionTicks') || playbackManagerLike.getCurrentTicks?.(player) || 0;
        const durationTicks = getRecordNumber(item, 'RunTimeTicks', 'RuntimeTicks')
            || getRecordNumber(mediaSource, 'RunTimeTicks', 'RuntimeTicks')
            || playbackManagerLike.duration?.(player)
            || 0;

        return {
            active: true,
            canSeek: Boolean(playState.CanSeek || durationTicks),
            durationTicks,
            imageUrl: getPlaybackImageUrl(item),
            itemId,
            itemType: getRecordString(item, 'Type', 'type'),
            lastEvent,
            lastUpdatedAt: Date.now(),
            mediaType: getRecordString(item, 'MediaType', 'mediaType'),
            name: getRecordString(item, 'Name', 'name', 'Title', 'title') || 'Now Playing',
            paused: typeof playState.IsPaused === 'boolean' ? playState.IsPaused : Boolean(playbackManagerLike.paused?.(player)),
            positionTicks,
            rawItem: item || undefined,
            routeHref: route.href,
            seriesName: getRecordString(item, 'SeriesName', 'seriesName'),
            sessionId: getRecordString(playState, 'PlaySessionId', 'PlaylistItemId') || itemId,
            source: 'jellyfin-player'
        };
    } catch (error) {
        recordPtvEvent('playback', 'global-playback-state-read-failed', {
            error: error instanceof Error ? error.message : String(error)
        });

        return EMPTY_PLAYBACK_STATE;
    }
}

function selectPlaybackState(lastEvent = '') {
    const jellyfinState = getJellyfinPlaybackState(lastEvent);
    const musicState = getMusicPlaybackState(lastMusicSnapshot);

    if (musicState.active && (!jellyfinState.active || !musicState.paused)) return musicState;
    if (jellyfinState.active) return jellyfinState;
    if (musicState.active) return musicState;

    return {
        ...EMPTY_PLAYBACK_STATE,
        lastEvent,
        lastUpdatedAt: Date.now()
    };
}

function getStateSignature(state: PtvGlobalPlaybackState) {
    const positionBucket = Math.floor((state.positionTicks || 0) / 10_000_000);

    return [
        state.active,
        state.itemId || '',
        state.sessionId || '',
        state.source,
        state.mediaType || '',
        state.itemType || '',
        state.routeHref || '',
        state.paused,
        positionBucket,
        state.durationTicks || 0,
        state.queueLength || 0
    ].join('|');
}

function publishPlaybackState(lastEvent = 'reconcile') {
    incrementPtvPerformanceCounter('playbackEventsReceived', {
        lastPlaybackEvent: lastEvent
    });

    const nextState = selectPlaybackState(lastEvent);
    const previousSignature = getStateSignature(currentState);
    const nextSignature = getStateSignature(nextState);

    if (previousSignature === nextSignature) {
        incrementPtvPerformanceCounter('playbackUpdatesSuppressed', {
            activeItemId: nextState.itemId || null,
            activeSessionId: nextState.sessionId || null,
            lastPlaybackEvent: lastEvent,
            playbackStoreSource: nextState.source
        });
        return;
    }

    currentState = nextState;
    incrementPtvPerformanceCounter('playbackUpdatesPublished', {
        activeItemId: nextState.itemId || null,
        activeSessionId: nextState.sessionId || null,
        lastPlaybackEvent: lastEvent,
        playbackStoreSource: nextState.source
    });
    recordPtvPerformanceEntry('playback', 'global-playback-state-updated', {
        activeItemId: nextState.itemId || null,
        activeMediaType: nextState.mediaType || null,
        activeSessionId: nextState.sessionId || null,
        lastPlaybackEvent: lastEvent,
        playbackRoute: nextState.routeHref || null,
        playbackStoreSource: nextState.source
    });

    listeners.forEach(listener => {
        listener(currentState);
    });
}

function scheduleReconcile(lastEvent: string) {
    if (reconcileTimer !== null) {
        window.clearTimeout(reconcileTimer);
    }

    reconcileTimer = window.setTimeout(() => {
        reconcileTimer = null;
        publishPlaybackState(lastEvent);
    }, 80);
}

function bindPlaybackManagerEvent(name: string) {
    const handler = () => scheduleReconcile(name);
    const playbackManagerLike = getPlaybackManager();

    if (!playbackManagerLike || (typeof playbackManagerLike !== 'object' && typeof playbackManagerLike !== 'function')) {
        recordPtvEvent('playback', 'global-playback-event-bind-skipped', {
            eventName: name,
            reason: 'playback-manager-not-ready'
        });
        return;
    }

    try {
        Events.on(playbackManagerLike, name, handler);
        boundPlaybackManagerEvents.push({
            handler,
            name,
            target: playbackManagerLike
        });
    } catch (error) {
        recordPtvEvent('playback', 'global-playback-event-bind-failed', {
            error: error instanceof Error ? error.message : String(error),
            eventName: name
        });
    }
}

export function startPtvPlaybackStateService() {
    if (initialized) return;

    initialized = true;
    incrementPtvPerformanceCounter('playbackProviderMountCount', {
        route: window.location.hash || window.location.pathname,
        source: 'global-playback-state-service'
    });
    bindPlaybackManagerEvent('playbackstart');
    bindPlaybackManagerEvent('playbackstop');
    bindPlaybackManagerEvent('playbackerror');
    bindPlaybackManagerEvent('playerchange');
    bindPlaybackManagerEvent('playbackcancelled');

    try {
        musicUnsubscribe = subscribeToPtvMusicQueue(snapshot => {
            lastMusicSnapshot = snapshot;
            publishPlaybackState('ptv-music-queue');
        });
    } catch (error) {
        recordPtvEvent('playback', 'global-playback-music-subscribe-failed', {
            error: error instanceof Error ? error.message : String(error)
        });
    }

    pollTimer = window.setInterval(() => {
        if (lastMusicSnapshot?.currentItem) return;

        publishPlaybackState('low-frequency-reconcile');
    }, 1000);

    const root = window.PTV || (window.PTV = {});

    root.playbackState = {
        getState: getPtvGlobalPlaybackState,
        subscribe: subscribeToPtvGlobalPlaybackState
    };

    publishPlaybackState('service-start');
}

export function getPtvGlobalPlaybackState() {
    return currentState;
}

export function subscribeToPtvGlobalPlaybackState(listener: PlaybackListener) {
    startPtvPlaybackStateService();
    listeners.add(listener);
    setPtvPlaybackSubscriptionCount(listeners.size);
    listener(currentState);

    return () => {
        listeners.delete(listener);
        setPtvPlaybackSubscriptionCount(listeners.size);
    };
}

export function openPtvGlobalPlaybackDetails(state = getPtvGlobalPlaybackState()) {
    if (!state.rawItem) return;

    if (state.source === 'ptv-music') {
        openPtvMusicPlayer('global-media-dock');
        return;
    }

    const route = resolvePtvItemRoute(state.rawItem, {
        source: 'global-media-dock'
    });

    recordPtvItemRouteClick(state.rawItem, route, {
        action: 'dock-details',
        source: 'global-media-dock'
    });
    window.location.hash = route.href.slice(1);
}

export function openPtvGlobalPlaybackPrimary(state = getPtvGlobalPlaybackState()) {
    if (!state.active || !state.itemId) return Promise.resolve();

    recordPtvPerformanceEntry('playback', 'global-dock-primary-action', {
        actionSource: 'global-media-dock',
        activeItemId: state.itemId,
        playbackRoute: state.routeHref || null,
        playbackStoreSource: state.source
    });

    if (state.source === 'ptv-music') {
        return togglePtvMusicPlayPause();
    }

    const playbackManagerLike = getPlaybackManager();
    const player = playbackManagerLike?.getCurrentPlayer?.();

    if (state.source === 'jellyfin-player' && playbackManagerLike && player && typeof playbackManagerLike.playPause === 'function') {
        return Promise.resolve(playbackManagerLike.playPause(player));
    }

    return playPtvItem(state.itemId, {
        serverId: getRecordString(state.rawItem, 'ServerId', 'serverId'),
        startPositionTicks: state.positionTicks || 0
    });
}

export function stopPtvGlobalPlayback(state = getPtvGlobalPlaybackState()) {
    if (state.source === 'ptv-music') {
        return stopPtvMusicPlayback('global-media-dock');
    }

    const playbackManagerLike = getPlaybackManager();
    const player = playbackManagerLike?.getCurrentPlayer?.();

    if (playbackManagerLike && player && typeof playbackManagerLike.stop === 'function') {
        return Promise.resolve(playbackManagerLike.stop(player));
    }

    return Promise.resolve();
}

export function nextPtvGlobalPlaybackTrack(state = getPtvGlobalPlaybackState()) {
    if (state.source === 'ptv-music') return nextPtvMusicTrack();

    const playbackManagerLike = getPlaybackManager();
    const player = playbackManagerLike?.getCurrentPlayer?.();

    if (playbackManagerLike && player && typeof playbackManagerLike.nextTrack === 'function') {
        return Promise.resolve(playbackManagerLike.nextTrack(player));
    }

    return Promise.resolve();
}

export function previousPtvGlobalPlaybackTrack(state = getPtvGlobalPlaybackState()) {
    if (state.source === 'ptv-music') return previousPtvMusicTrack();

    const playbackManagerLike = getPlaybackManager();
    const player = playbackManagerLike?.getCurrentPlayer?.();

    if (playbackManagerLike && player && typeof playbackManagerLike.previousTrack === 'function') {
        return Promise.resolve(playbackManagerLike.previousTrack(player));
    }

    return Promise.resolve();
}

export function disposePtvPlaybackStateServiceForTests() {
    musicUnsubscribe?.();
    musicUnsubscribe = null;
    boundPlaybackManagerEvents.splice(0).forEach(({ handler, name, target }) => {
        Events.off(target, name, handler);
    });
    if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
    }
    if (reconcileTimer !== null) {
        window.clearTimeout(reconcileTimer);
        reconcileTimer = null;
    }
    initialized = false;
    lastMusicSnapshot = null;
    listeners.clear();
    currentState = EMPTY_PLAYBACK_STATE;
}
