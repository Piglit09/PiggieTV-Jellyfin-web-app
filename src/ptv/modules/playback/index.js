import { playbackManager } from '../../../components/playback/playbackmanager';
import Events from '../../../utils/events.ts';
import { ServerConnections } from '../../../lib/jellyfin-apiclient';
import { registerModule } from '../../core/lifecycle';
import { cancelPtvImageScope, loadPtvImage } from '../../core/imageManager';
import { watchDom } from '../../core/observer';

import './playback.scss';

const PAGE_SELECTOR = '#videoOsdPage';
const PAUSE_STAGE_CLASS = 'ptv-player-pause-stage';
const TICKS_PER_MINUTE = 600000000;
const PLAYBACK_STATE_SETTLE_MS = 80;
const PAUSE_RELATED_ITEM_LIMIT = 4;

let currentPlayer = null;
let currentItem = null;
let stopWatchingDom = null;
let playbackStateTimer = null;
let pauseAssetToken = 0;

const relatedItemCache = new Map();
const activePauseImageLoads = new Set();

function getApiClient(item) {
    if (!item?.ServerId) return null;

    return ServerConnections.getApiClient(item.ServerId);
}

function getImageUrl(item, type, options = {}) {
    const apiClient = getApiClient(item);
    const itemId = options.itemId || item?.Id;

    if (!apiClient || !itemId) return '';

    return apiClient.getScaledImageUrl(itemId, {
        type,
        ...options
    });
}

function addImageCandidate(candidates, item, type, options = {}) {
    const url = getImageUrl(item, type, options);

    if (url) {
        candidates.push(url);
    }
}

function addBackdropCandidates(candidates, item) {
    if (!item) return;

    if (item.BackdropImageTags?.length) {
        addImageCandidate(candidates, item, 'Backdrop', {
            itemId: item.BackdropItemId || item.Id,
            index: 0,
            tag: item.BackdropImageTags[0],
            maxWidth: 1920
        });
    }

    if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.length) {
        addImageCandidate(candidates, item, 'Backdrop', {
            itemId: item.ParentBackdropItemId,
            index: 0,
            tag: item.ParentBackdropImageTags[0],
            maxWidth: 1920
        });
    }

    if (item.ImageTags?.Thumb) {
        addImageCandidate(candidates, item, 'Thumb', {
            tag: item.ImageTags.Thumb,
            maxWidth: 1920
        });
    }

    if (item.ImageTags?.Primary || item.PrimaryImageTag) {
        addImageCandidate(candidates, item, 'Primary', {
            tag: item.ImageTags?.Primary || item.PrimaryImageTag,
            maxWidth: 1280
        });
    }
}

function addLogoCandidates(candidates, item) {
    if (!item) return;

    if (item.ImageTags?.Logo) {
        addImageCandidate(candidates, item, 'Logo', {
            tag: item.ImageTags.Logo,
            maxWidth: 760
        });
    }

    if (item.ParentLogoItemId && item.ParentLogoImageTag) {
        addImageCandidate(candidates, item, 'Logo', {
            itemId: item.ParentLogoItemId,
            tag: item.ParentLogoImageTag,
            maxWidth: 760
        });
    }
}

function addDiscCandidates(candidates, item, includePrimaryFallback = false) {
    if (!item) return;

    if (item.ImageTags?.Disc) {
        addImageCandidate(candidates, item, 'Disc', {
            tag: item.ImageTags.Disc,
            maxWidth: 720
        });
    }

    if (!includePrimaryFallback) return;

    const primaryTag = item?.ImageTags?.Primary
        || item?.PrimaryImageTag
        || item?.SeriesPrimaryImageTag
        || item?.ParentPrimaryImageTag;

    if (!primaryTag) return;

    addImageCandidate(candidates, item, 'Primary', {
        tag: primaryTag,
        maxWidth: 720
    });
}

function getUniqueUrls(urls) {
    return Array.from(new Set(urls.filter(Boolean)));
}

function buildPauseImageCandidates(item, relatedItems = []) {
    const backdropCandidates = [];
    const logoCandidates = [];
    const discCandidates = [];

    addBackdropCandidates(backdropCandidates, item);
    addLogoCandidates(logoCandidates, item);
    addDiscCandidates(discCandidates, item);

    relatedItems.forEach(relatedItem => {
        addBackdropCandidates(backdropCandidates, relatedItem);
        addLogoCandidates(logoCandidates, relatedItem);
        addDiscCandidates(discCandidates, relatedItem);
    });

    addDiscCandidates(discCandidates, item, true);

    return {
        backdrops: getUniqueUrls(backdropCandidates),
        discs: getUniqueUrls(discCandidates),
        logos: getUniqueUrls(logoCandidates)
    };
}

function getRelatedItemIds(item) {
    const ids = [
        item?.ParentLogoItemId,
        item?.ParentBackdropItemId,
        item?.SeasonId,
        item?.SeriesId,
        item?.ParentId
    ].filter(Boolean);

    return Array.from(new Set(ids))
        .filter(id => id !== item?.Id)
        .slice(0, PAUSE_RELATED_ITEM_LIMIT);
}

function getRelatedCacheKey(itemId, serverId) {
    return `${serverId || 'default'}:${itemId}`;
}

async function fetchRelatedItem(rootItem, itemId) {
    const apiClient = getApiClient(rootItem);

    if (!apiClient || !itemId) return null;

    const cacheKey = getRelatedCacheKey(itemId, rootItem.ServerId);

    if (relatedItemCache.has(cacheKey)) {
        return relatedItemCache.get(cacheKey);
    }

    const promise = apiClient.getItem(apiClient.getCurrentUserId(), itemId)
        .catch(() => null);

    relatedItemCache.set(cacheKey, promise);

    return promise;
}

function getPauseAssetKey(item) {
    return [
        item?.ServerId,
        item?.Id,
        item?.ParentLogoImageTag,
        item?.ParentBackdropImageTags?.[0],
        item?.ImageTags?.Logo,
        item?.ImageTags?.Disc,
        item?.BackdropImageTags?.[0],
        item?.ImageTags?.Primary
    ].filter(Boolean).join(':');
}

function formatRuntime(item) {
    if (!item?.RunTimeTicks) return '';

    const totalMinutes = Math.round(item.RunTimeTicks / TICKS_PER_MINUTE);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (!hours) return `${minutes}m`;
    if (!minutes) return `${hours}h`;

    return `${hours}h ${minutes}m`;
}

function getDisplayTitle(item) {
    if (!item) return '';

    if (item.SeriesName && item.IndexNumber) {
        return `${item.SeriesName}: ${item.Name}`;
    }

    return item.Name || item.SeriesName || '';
}

function getMetaItems(item) {
    return [
        item?.ProductionYear,
        item?.OfficialRating,
        formatRuntime(item),
        item?.CommunityRating ? `Rating ${Number(item.CommunityRating).toFixed(1)}` : ''
    ].filter(Boolean);
}

function setSafeBackground(element, url) {
    if (!element) return;

    if (!url) {
        element.style.removeProperty('--ptv-player-image');
        return;
    }

    element.style.setProperty('--ptv-player-image', `url("${url.replace(/"/g, '%22')}")`);
}

function setSafeDisc(element, url) {
    if (!element) return;

    if (!url) {
        element.classList.remove('ptv-player-pause-stage-has-disc');
        element.style.removeProperty('--ptv-player-disc');
        return;
    }

    element.classList.add('ptv-player-pause-stage-has-disc');
    element.style.setProperty('--ptv-player-disc', `url("${url.replace(/"/g, '%22')}")`);
}

function setSafeLogo(element, url) {
    if (!element) return;

    if (!url) {
        element.style.removeProperty('background-image');
        element.classList.remove('ptv-player-logo-visible');
        return;
    }

    element.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
    element.classList.add('ptv-player-logo-visible');
}

function cancelPauseImageLoads() {
    activePauseImageLoads.forEach(handle => {
        handle.cancel();
    });
    activePauseImageLoads.clear();
}

async function resolveFirstImageUrl(urls, priority, scope) {
    for (const url of getUniqueUrls(urls)) {
        const handle = loadPtvImage(url, priority, scope);

        activePauseImageLoads.add(handle);

        try {
            const didLoad = await handle.promise;

            activePauseImageLoads.delete(handle);

            if (didLoad) {
                return url;
            }
        } catch {
            activePauseImageLoads.delete(handle);
        }
    }

    return '';
}

function applyResolvedPauseAsset(stage, selector, setter, url, token) {
    if (token !== pauseAssetToken || !stage.isConnected) return;

    const target = selector ? stage.querySelector(selector) : stage;

    if (target) {
        setter(target, url);
    }
}

async function applyPauseCandidateSet(stage, candidates, token) {
    const [backdropUrl, logoUrl, discUrl] = await Promise.all([
        resolveFirstImageUrl(candidates.backdrops, 'hero-current', 'pause-screen-backdrop'),
        resolveFirstImageUrl(candidates.logos, 'hero-current', 'pause-screen-logo'),
        resolveFirstImageUrl(candidates.discs, 'decorative', 'pause-screen-disc')
    ]);

    applyResolvedPauseAsset(stage, null, setSafeBackground, backdropUrl, token);
    applyResolvedPauseAsset(stage, '.ptv-player-logo', setSafeLogo, logoUrl, token);
    applyResolvedPauseAsset(stage, null, setSafeDisc, discUrl, token);
}

async function resolvePauseAssets(stage, item, token) {
    const relatedItemIds = getRelatedItemIds(item);
    const relatedItemsPromise = Promise.all(
        relatedItemIds.map(itemId => fetchRelatedItem(item, itemId))
    );

    await applyPauseCandidateSet(stage, buildPauseImageCandidates(item), token);

    if (token !== pauseAssetToken || !relatedItemIds.length) return;

    const relatedItems = await relatedItemsPromise;

    await applyPauseCandidateSet(
        stage,
        buildPauseImageCandidates(item, relatedItems.filter(Boolean)),
        token
    );
}

function resumePlayback() {
    const player = currentPlayer || playbackManager.getCurrentPlayer?.();

    if (!player) return;

    if (playbackManager.unpause) {
        playbackManager.unpause(player);
        return;
    }

    if (player.unpause) {
        player.unpause();
    }
}

function handlePauseStageKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;

    event.preventDefault();
    resumePlayback();
}

function getOrCreatePauseStage(page) {
    let stage = page.querySelector(`.${PAUSE_STAGE_CLASS}`);

    if (stage) return stage;

    stage = document.createElement('div');
    stage.className = PAUSE_STAGE_CLASS;
    stage.setAttribute('aria-hidden', 'true');
    stage.dataset.ptvEnhanced = 'true';
    stage.innerHTML = `
        <div class="ptv-player-pause-content">
            <div class="ptv-player-logo"></div>
            <h1 class="ptv-player-title"></h1>
            <div class="ptv-player-meta"></div>
            <p class="ptv-player-overview"></p>
            <div class="ptv-player-progress-summary"></div>
        </div>
        <div class="ptv-player-disc-wrap">
            <div class="ptv-player-disc"></div>
        </div>
    `;

    const content = stage.querySelector('.ptv-player-pause-content');

    if (content) {
        content.setAttribute('role', 'button');
        content.setAttribute('tabindex', '0');
        content.setAttribute('aria-label', 'Resume playback');
        content.addEventListener('click', resumePlayback);
        content.addEventListener('keydown', handlePauseStageKeydown);
    }

    page.prepend(stage);

    return stage;
}

function renderMetaItems(meta, item) {
    if (!meta) return;

    meta.textContent = '';
    getMetaItems(item).forEach(value => {
        const metaItem = document.createElement('span');

        metaItem.textContent = value;
        meta.appendChild(metaItem);
    });
}

function renderPauseStage(page, item, state = {}) {
    const stage = getOrCreatePauseStage(page);
    const logo = stage.querySelector('.ptv-player-logo');
    const title = stage.querySelector('.ptv-player-title');
    const meta = stage.querySelector('.ptv-player-meta');
    const overview = stage.querySelector('.ptv-player-overview');
    const progress = stage.querySelector('.ptv-player-progress-summary');
    const assetKey = getPauseAssetKey(item);

    if (stage.dataset.ptvPauseAssetKey !== assetKey) {
        stage.dataset.ptvPauseAssetKey = assetKey;
        cancelPauseImageLoads();
        pauseAssetToken += 1;
        setSafeBackground(stage, '');
        setSafeDisc(stage, '');
        setSafeLogo(logo, '');
        void resolvePauseAssets(stage, item, pauseAssetToken);
    }

    if (title) {
        title.textContent = getDisplayTitle(item);
    }

    renderMetaItems(meta, item);

    if (overview) {
        overview.textContent = item?.Overview || '';
    }

    if (progress) {
        progress.textContent = getProgressText(item, state);
    }
}

function getProgressText(item, state) {
    const positionTicks = state?.PlayState?.PositionTicks;
    const runtimeTicks = item?.RunTimeTicks;

    if (!positionTicks || !runtimeTicks) return '';

    const percent = Math.max(0, Math.min(100, Math.round(positionTicks / runtimeTicks * 100)));

    return `${percent}% watched`;
}

function setPauseState(isPaused) {
    document.documentElement.classList.toggle('ptv-player-paused', Boolean(isPaused));
    document.querySelectorAll(`.${PAUSE_STAGE_CLASS}`).forEach(stage => {
        stage.setAttribute('aria-hidden', isPaused ? 'false' : 'true');
    });
}

function clearPlaybackStateTimer() {
    if (!playbackStateTimer) return;

    window.clearTimeout(playbackStateTimer);
    playbackStateTimer = null;
}

function schedulePlaybackStateUpdate(player = currentPlayer) {
    clearPlaybackStateTimer();

    playbackStateTimer = window.setTimeout(() => {
        playbackStateTimer = null;
        updateFromState(player);
    }, PLAYBACK_STATE_SETTLE_MS);
}

function updateFromState(player = currentPlayer) {
    if (!player) return;

    const state = playbackManager.getPlayerState(player) || {};
    const item = state.NowPlayingItem || playbackManager.currentItem(player);
    const page = document.querySelector(PAGE_SELECTOR);

    currentItem = item || currentItem;

    if (page && currentItem) {
        page.classList.add('ptv-player-page');
        renderPauseStage(page, currentItem, state);
    }

    setPauseState(Boolean(state.PlayState?.IsPaused || player.paused?.()));
}

function enhancePlaybackDom() {
    const page = document.querySelector(PAGE_SELECTOR);

    if (!page) return;

    page.classList.add('ptv-player-page');
    page.querySelectorAll('.videoOsdBottom, .osdControls, .osdHeader').forEach(element => {
        element.classList.add('ptv-player-chrome');
    });

    if (currentItem) {
        renderPauseStage(page, currentItem, playbackManager.getPlayerState(currentPlayer) || {});
    }
}

function cleanupPlaybackDom() {
    cancelPauseImageLoads();
    cancelPtvImageScope('pause-screen-backdrop');
    cancelPtvImageScope('pause-screen-logo');
    cancelPtvImageScope('pause-screen-disc');
    pauseAssetToken += 1;
    document.querySelectorAll('.ptv-player-page').forEach(page => {
        page.classList.remove('ptv-player-page');
        page.querySelector(`.${PAUSE_STAGE_CLASS}`)?.remove();
        page.querySelectorAll('.ptv-player-chrome').forEach(element => {
            element.classList.remove('ptv-player-chrome');
        });
    });
}

function onPlaybackStart(_event, player, state) {
    bindPlayer(player);
    currentItem = state?.NowPlayingItem || playbackManager.currentItem(player);
    document.documentElement.classList.add('ptv-playing');
    updateFromState(player);
    schedulePlaybackStateUpdate(player);
}

function onPlaybackStop() {
    clearPlaybackStateTimer();
    document.documentElement.classList.remove('ptv-playing', 'ptv-player-paused');
    currentItem = null;
    cleanupPlaybackDom();
}

function onPlaybackError() {
    clearPlaybackStateTimer();
    document.documentElement.classList.remove('ptv-playing', 'ptv-player-paused');
    cleanupPlaybackDom();
}

function onPlayerPauseChange() {
    updateFromState(currentPlayer);
    schedulePlaybackStateUpdate(currentPlayer);
}

function bindPlayer(player) {
    if (!player || player === currentPlayer) return;

    releasePlayer();
    currentPlayer = player;

    Events.on(player, 'pause', onPlayerPauseChange);
    Events.on(player, 'unpause', onPlayerPauseChange);
    Events.on(player, 'playing', onPlayerPauseChange);
    Events.on(player, 'playbackstart', onPlayerPauseChange);
}

function releasePlayer() {
    if (!currentPlayer) return;

    Events.off(currentPlayer, 'pause', onPlayerPauseChange);
    Events.off(currentPlayer, 'unpause', onPlayerPauseChange);
    Events.off(currentPlayer, 'playing', onPlayerPauseChange);
    Events.off(currentPlayer, 'playbackstart', onPlayerPauseChange);
    currentPlayer = null;
}

function init({ scope } = {}) {
    Events.on(playbackManager, 'playbackstart', onPlaybackStart);
    Events.on(playbackManager, 'playbackstop', onPlaybackStop);
    Events.on(playbackManager, 'playbackerror', onPlaybackError);
    scope?.add(() => Events.off(playbackManager, 'playbackstart', onPlaybackStart), {
        label: 'playbackstart',
        type: 'listener'
    });
    scope?.add(() => Events.off(playbackManager, 'playbackstop', onPlaybackStop), {
        label: 'playbackstop',
        type: 'listener'
    });
    scope?.add(() => Events.off(playbackManager, 'playbackerror', onPlaybackError), {
        label: 'playbackerror',
        type: 'listener'
    });
    stopWatchingDom = scope?.watchDom ? scope.watchDom(enhancePlaybackDom) : watchDom(enhancePlaybackDom);
    bindPlayer(playbackManager.getCurrentPlayer?.());
    updateFromState();
    enhancePlaybackDom();
}

function refresh() {
    bindPlayer(playbackManager.getCurrentPlayer?.());
    updateFromState();
    enhancePlaybackDom();
}

function destroy() {
    Events.off(playbackManager, 'playbackstart', onPlaybackStart);
    Events.off(playbackManager, 'playbackstop', onPlaybackStop);
    Events.off(playbackManager, 'playbackerror', onPlaybackError);
    clearPlaybackStateTimer();
    releasePlayer();
    stopWatchingDom?.();
    stopWatchingDom = null;
    onPlaybackStop();
}

registerModule({
    density: 'comfortable',
    features: ['playback'],
    layout: 'player',
    name: 'playback',
    surface: 0,
    widgets: [
        {
            density: 'comfortable',
            id: 'pause-stage',
            surface: 0,
            type: 'player-stage'
        }
    ],
    init,
    refresh,
    destroy
});
