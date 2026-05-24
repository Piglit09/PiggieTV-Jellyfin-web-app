import { playbackManager } from '../../../components/playback/playbackmanager';
import Events from '../../../utils/events.ts';
import { ServerConnections } from '../../../lib/jellyfin-apiclient';
import { registerModule } from '../../core/lifecycle';
import { watchDom } from '../../core/observer';

import './playback.scss';

const PAGE_SELECTOR = '#videoOsdPage';
const PAUSE_STAGE_CLASS = 'ptv-player-pause-stage';
const TICKS_PER_MINUTE = 600000000;
const PLAYBACK_STATE_SETTLE_MS = 80;

let currentPlayer = null;
let currentItem = null;
let stopWatchingDom = null;
let playbackStateTimer = null;

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

function getBackdropUrl(item) {
    if (item?.BackdropImageTags?.length) {
        return getImageUrl(item, 'Backdrop', {
            itemId: item.BackdropItemId || item.Id,
            index: 0,
            tag: item.BackdropImageTags[0],
            maxWidth: 1920
        });
    }

    if (item?.ParentBackdropItemId && item?.ParentBackdropImageTags?.length) {
        return getImageUrl(item, 'Backdrop', {
            itemId: item.ParentBackdropItemId,
            index: 0,
            tag: item.ParentBackdropImageTags[0],
            maxWidth: 1920
        });
    }

    if (item?.ImageTags?.Thumb) {
        return getImageUrl(item, 'Thumb', {
            tag: item.ImageTags.Thumb,
            maxWidth: 1920
        });
    }

    return '';
}

function getLogoUrl(item) {
    if (!item?.ImageTags?.Logo) return '';

    return getImageUrl(item, 'Logo', {
        tag: item.ImageTags.Logo,
        maxWidth: 760
    });
}

function getDiscUrl(item) {
    if (item?.ImageTags?.Disc) {
        return getImageUrl(item, 'Disc', {
            tag: item.ImageTags.Disc,
            maxWidth: 720
        });
    }

    const primaryTag = item?.ImageTags?.Primary
        || item?.PrimaryImageTag
        || item?.SeriesPrimaryImageTag
        || item?.ParentPrimaryImageTag;

    if (!primaryTag) return '';

    return getImageUrl(item, 'Primary', {
        tag: primaryTag,
        maxWidth: 720
    });
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
        formatRuntime(item)
    ].filter(Boolean);
}

function setSafeBackground(element, url) {
    if (!url) {
        element.style.removeProperty('--ptv-player-image');
        return;
    }

    element.style.setProperty('--ptv-player-image', `url("${url.replace(/"/g, '%22')}")`);
}

function setSafeDisc(element, url) {
    if (!url) {
        element.classList.remove('ptv-player-pause-stage-has-disc');
        element.style.removeProperty('--ptv-player-disc');
        return;
    }

    element.classList.add('ptv-player-pause-stage-has-disc');
    element.style.setProperty('--ptv-player-disc', `url("${url.replace(/"/g, '%22')}")`);
}

function getOrCreatePauseStage(page) {
    let stage = page.querySelector(`.${PAUSE_STAGE_CLASS}`);

    if (stage) return stage;

    stage = document.createElement('div');
    stage.className = PAUSE_STAGE_CLASS;
    stage.setAttribute('aria-hidden', 'true');
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

    page.prepend(stage);

    return stage;
}

function renderPauseStage(page, item, state = {}) {
    const stage = getOrCreatePauseStage(page);
    const logo = stage.querySelector('.ptv-player-logo');
    const title = stage.querySelector('.ptv-player-title');
    const meta = stage.querySelector('.ptv-player-meta');
    const overview = stage.querySelector('.ptv-player-overview');
    const progress = stage.querySelector('.ptv-player-progress-summary');
    const logoUrl = getLogoUrl(item);

    setSafeBackground(stage, getBackdropUrl(item));
    setSafeDisc(stage, getDiscUrl(item));

    if (logoUrl) {
        logo.style.backgroundImage = `url("${logoUrl.replace(/"/g, '%22')}")`;
        logo.classList.add('ptv-player-logo-visible');
    } else {
        logo.style.removeProperty('background-image');
        logo.classList.remove('ptv-player-logo-visible');
    }

    title.textContent = getDisplayTitle(item);
    meta.innerHTML = getMetaItems(item)
        .map(value => `<span>${value}</span>`)
        .join('');
    overview.textContent = item?.Overview || '';
    progress.textContent = getProgressText(item, state);
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

function init() {
    Events.on(playbackManager, 'playbackstart', onPlaybackStart);
    Events.on(playbackManager, 'playbackstop', onPlaybackStop);
    Events.on(playbackManager, 'playbackerror', onPlaybackError);
    stopWatchingDom = watchDom(enhancePlaybackDom);
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
