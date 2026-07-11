import { playbackManager } from '../../../components/playback/playbackmanager';
import Events from '../../../utils/events.ts';
import { ServerConnections } from '../../../lib/jellyfin-apiclient';
import { EventType } from '../../../constants/eventType';
import { appRouter } from '../../../components/router/appRouter';
import { registerModule } from '../../core/lifecycle';
import { cancelPtvImageScope, loadPtvImage } from '../../core/imageManager';
import { watchDom } from '../../core/observer';
import { getPtvClientProfile } from '../../core/clientProfile';
import { getPtvPlaybackMode, isPtvPlaybackMode } from '../../core/featureSettings';
import { recordPtvEvent } from '../../core/observability';

import './playbackChrome';
import './playback.scss';

const PAGE_SELECTOR = '#videoOsdPage, .videoOsdPage';
const VIDEO_SELECTOR = [
    '#videoOsdPage video',
    '.videoOsdPage video',
    '#videoOsdPage .htmlVideoPlayer',
    '.videoOsdPage .htmlVideoPlayer',
    '#videoOsdPage .htmlvideoplayer',
    '.videoOsdPage .htmlvideoplayer',
    'video.htmlVideoPlayer',
    'video.htmlvideoplayer'
].join(',');
const PAUSE_STAGE_CLASS = 'ptv-player-pause-stage';
const PLAYER_HEADER_CLASS = 'ptv-player-topbar';
const PLAYER_CHROME_ROOT_CLASS = 'ptv-player-chrome-root';
const PLAYER_CHROME_VISIBLE_CLASS = 'ptv-player-chrome-visible';
const PLAYER_PAGE_CLASS = 'ptv-player-page';
const PLAYER_PAGE_HOST_CLASS = 'ptv-player-page-host';
const PLAYER_RECONNECTING_CLASS = 'ptv-player-reconnecting';
const PLAYER_RECONNECTING_VISIBLE_CLASS = 'ptv-player-reconnecting-visible';
const TICKS_PER_MINUTE = 600000000;
const PLAYBACK_STATE_SETTLE_MS = 80;
const PLAYER_CHROME_HIDE_MS = 4200;
const PAUSE_RELATED_ITEM_LIMIT = 4;
const PTV_STARTUP_VOLUME_LEVEL = 50;
const PTV_STARTUP_MEDIA_VOLUME = Math.pow(PTV_STARTUP_VOLUME_LEVEL / 100, 3);
const PTV_RESTORED_HIDE_CLASS_KEY = 'ptvRestoredHideClass';
const PTV_RESTORED_HIDDEN_CLASS_KEY = 'ptvRestoredHiddenClass';
const PTV_RESTORED_OSD_HIDDEN_CLASS_KEY = 'ptvRestoredOsdHiddenClass';
const STALL_RECOVERY_DELAY_MS = 12000;
const STALL_SETTLE_HIDE_MS = 900;
const PLAYBACK_DIAGNOSTIC_THROTTLE_MS = 1500;
const MAX_RETRIED_SOURCE_KEYS = 12;

let currentPlayer = null;
let currentVideo = null;
let currentItem = null;
let stopWatchingDom = null;
let playbackStateTimer = null;
let playerChromeTimer = null;
let pauseAssetToken = 0;
let moduleInitialized = false;
let lastKnownOsdVisible = false;
let lastStartupVolumeKey = '';
let playbackStallTimer = null;
let reconnectingHideTimer = null;
let playbackStallCount = 0;
let playbackRetryCount = 0;
let lastVideoProgressAt = 0;
let lastVideoTime = 0;
let lastVideoError = null;
let lastPlaybackDiagnosticAt = 0;
let reconnectingReason = '';

const relatedItemCache = new Map();
const activePauseImageLoads = new Set();
const retriedPlaybackSourceKeys = new Set();

function hasPlaybackHash() {
    return /#\/(?:playback|video|livetv|nowplaying)/i.test(window.location.hash || '');
}

function hasPlaybackBodyState() {
    return document.body.classList.contains('videoOsdBody')
        || document.body.classList.contains('playerBody');
}

function hasLivePlaybackState() {
    const player = currentPlayer || playbackManager.getCurrentPlayer?.();
    const state = player ? playbackManager.getPlayerState(player) : null;
    const item = state?.NowPlayingItem || (player ? playbackManager.currentItem(player) : null);

    return Boolean(item && (hasPlaybackHash() || hasPlaybackBodyState()));
}

function isPlaybackUiActive() {
    return hasPlaybackHash() || hasPlaybackBodyState() || hasLivePlaybackState();
}

function getActiveVideoElement() {
    const video = document.querySelector(VIDEO_SELECTOR);

    return video instanceof HTMLVideoElement ? video : null;
}

function getCurrentMediaSource(player = currentPlayer) {
    try {
        return player ? playbackManager.currentMediaSource?.(player) || null : null;
    } catch {
        return null;
    }
}

function getCurrentPlayMethod(player = currentPlayer) {
    try {
        return player ? playbackManager.playMethod?.(player) || null : null;
    } catch {
        return null;
    }
}

function getCurrentPlaySessionId(player = currentPlayer) {
    try {
        return player ? playbackManager.playSessionId?.(player) || null : null;
    } catch {
        return null;
    }
}

function getMediaStream(mediaSource, type) {
    return mediaSource?.MediaStreams?.find(stream => String(stream?.Type || '').toLowerCase() === type) || null;
}

function getDefaultAudioStream(mediaSource) {
    const defaultIndex = mediaSource?.DefaultAudioStreamIndex;

    if (defaultIndex != null) {
        return mediaSource?.MediaStreams?.find(stream => stream?.Index === defaultIndex) || getMediaStream(mediaSource, 'audio');
    }

    return getMediaStream(mediaSource, 'audio');
}

function normalizeCodec(value) {
    return String(value || '').toLowerCase();
}

function getPlaybackUrlType(video) {
    const url = String(video?.currentSrc || video?.src || '');
    const lowerUrl = url.toLowerCase();

    if (!url) return 'unknown';
    if (lowerUrl.startsWith('blob:')) return 'hls-js-blob';
    if (lowerUrl.includes('.m3u8') || lowerUrl.includes('/hls/') || lowerUrl.includes('transcodingsubprotocol=hls')) return 'hls';
    if (lowerUrl.includes('/videos/') && lowerUrl.includes('/stream.')) return 'direct-video-stream';
    if (lowerUrl.includes('/audio/') && lowerUrl.includes('/stream.')) return 'direct-audio-stream';
    if (lowerUrl.includes('/videos/') || lowerUrl.includes('/audio/')) return 'jellyfin-media-url';

    return 'media-url';
}

function getBufferedRangeSummary(video) {
    const ranges = [];
    const buffered = video?.buffered;

    if (!buffered) return ranges;

    for (let index = 0; index < buffered.length; index += 1) {
        try {
            ranges.push({
                end: Number(buffered.end(index).toFixed(2)),
                start: Number(buffered.start(index).toFixed(2))
            });
        } catch {
            // Buffered ranges can disappear while the media element is updating.
        }
    }

    return ranges;
}

function hasBufferedAhead(video, minimumSeconds = 2) {
    const currentTime = video?.currentTime || 0;
    const buffered = video?.buffered;

    if (!buffered) return false;

    for (let index = 0; index < buffered.length; index += 1) {
        try {
            if (buffered.start(index) <= currentTime && buffered.end(index) - currentTime >= minimumSeconds) {
                return true;
            }
        } catch {
            return false;
        }
    }

    return false;
}

function getVideoSourceKey(video = currentVideo) {
    return [
        currentItem?.ServerId || '',
        currentItem?.Id || '',
        getCurrentPlaySessionId() || '',
        video?.currentSrc || video?.src || ''
    ].filter(Boolean).join(':');
}

function rememberRetriedSourceKey(sourceKey) {
    if (!sourceKey) return;

    retriedPlaybackSourceKeys.add(sourceKey);

    while (retriedPlaybackSourceKeys.size > MAX_RETRIED_SOURCE_KEYS) {
        const firstKey = retriedPlaybackSourceKeys.values().next().value;
        retriedPlaybackSourceKeys.delete(firstKey);
    }
}

function getQueryFlag(name) {
    const search = window.location.search ? window.location.search.substring(1) : '';
    const parts = search.split('&');

    for (const part of parts) {
        const pair = part.split('=');

        try {
            if (decodeURIComponent(pair[0] || '') === name) {
                return decodeURIComponent(pair.slice(1).join('=') || '');
            }
        } catch {
            // Ignore malformed query values.
        }
    }

    return null;
}

function getPtvRequestedPlaybackMode() {
    const queryValue = getQueryFlag('ptvPlaybackMode');

    if (isPtvPlaybackMode(queryValue)) return queryValue;

    const safePlaybackQueryValue = getQueryFlag('ptvSafePlayback');

    if (safePlaybackQueryValue === '0' || safePlaybackQueryValue === 'false') return 'performance';
    if (safePlaybackQueryValue === '1' || safePlaybackQueryValue === 'true') return 'compatible';

    return getPtvPlaybackMode();
}

function supportsMediaSourceApi() {
    try {
        return 'MediaSource' in window && window['MediaSource'] != null;
    } catch {
        return false;
    }
}

function getClientCapabilitySummary() {
    const video = document.createElement('video');
    const playbackMode = getPtvRequestedPlaybackMode();

    return {
        eac3: Boolean(video.canPlayType?.('audio/mp4; codecs="ec-3"').replace(/no/, '')),
        fmp4Hls: Boolean(video.canPlayType?.('application/vnd.apple.mpegURL; codecs="hvc1.1.6.L120, mp4a.40.2"').replace(/no/, '')),
        hevc: Boolean(
            video.canPlayType?.('video/mp4; codecs="hvc1.1.L120"').replace(/no/, '')
            || video.canPlayType?.('video/mp4; codecs="hev1.1.L120"').replace(/no/, '')
        ),
        hevcMain10: Boolean(
            video.canPlayType?.('video/mp4; codecs="hvc1.2.4.L123"').replace(/no/, '')
            || video.canPlayType?.('video/mp4; codecs="hev1.2.4.L123"').replace(/no/, '')
        ),
        hls: Boolean(
            video.canPlayType?.('application/x-mpegURL').replace(/no/, '')
            || video.canPlayType?.('application/vnd.apple.mpegURL').replace(/no/, '')
        ),
        hlsTs: Boolean(video.canPlayType?.('application/x-mpegURL; codecs="avc1.42E01E, mp4a.40.2"').replace(/no/, '')),
        mediaSource: supportsMediaSourceApi(),
        playbackMode,
        ptvSafePlaybackMode: playbackMode === 'compatible'
    };
}

function getMediaSourceSummary(mediaSource = getCurrentMediaSource()) {
    const videoStream = getMediaStream(mediaSource, 'video');
    const audioStream = getDefaultAudioStream(mediaSource);
    const container = normalizeCodec(mediaSource?.Container);
    const videoCodec = normalizeCodec(videoStream?.Codec || mediaSource?.VideoCodec);
    const audioCodec = normalizeCodec(audioStream?.Codec || mediaSource?.AudioCodec);
    const videoProfile = String(videoStream?.Profile || mediaSource?.VideoProfile || '').toLowerCase();

    return {
        audioChannels: audioStream?.Channels || null,
        audioCodec,
        audioIndex: audioStream?.Index ?? null,
        container,
        height: videoStream?.Height || mediaSource?.Height || null,
        isHevcMain10Eac3Mkv: container.includes('mkv')
            && (videoCodec === 'hevc' || videoCodec === 'h265')
            && (videoProfile.includes('main 10') || videoStream?.BitDepth === 10)
            && audioCodec === 'eac3',
        mediaSourceId: mediaSource?.Id || null,
        protocol: mediaSource?.Protocol || null,
        runTimeTicks: mediaSource?.RunTimeTicks || null,
        supportsDirectPlay: Boolean(mediaSource?.SupportsDirectPlay),
        supportsDirectStream: Boolean(mediaSource?.SupportsDirectStream),
        supportsTranscoding: Boolean(mediaSource?.SupportsTranscoding),
        transcodingContainer: mediaSource?.TranscodingContainer || null,
        transcodingSubProtocol: mediaSource?.TranscodingSubProtocol || null,
        videoBitDepth: videoStream?.BitDepth || null,
        videoCodec,
        videoIndex: videoStream?.Index ?? null,
        videoProfile,
        videoRange: videoStream?.VideoRange || mediaSource?.VideoRange || null,
        width: videoStream?.Width || mediaSource?.Width || null
    };
}

function getPlaybackDiagnostics(reason, extra = {}) {
    const video = currentVideo || getActiveVideoElement();
    const player = currentPlayer || playbackManager.getCurrentPlayer?.();
    const state = player ? playbackManager.getPlayerState?.(player) || {} : {};

    return {
        bufferedRanges: getBufferedRangeSummary(video),
        client: getPtvClientProfile(),
        clientCapabilities: getClientCapabilitySummary(),
        currentTime: video ? Number((video.currentTime || 0).toFixed(2)) : null,
        duration: video && Number.isFinite(video.duration) ? Number(video.duration.toFixed(2)) : null,
        itemId: currentItem?.Id || state?.NowPlayingItem?.Id || null,
        lastVideoError,
        mediaSource: getMediaSourceSummary(state?.MediaSource || getCurrentMediaSource(player)),
        nextItemId: state?.NextItem?.Id || null,
        playMethod: state?.PlayState?.PlayMethod || getCurrentPlayMethod(player),
        playbackMode: getPtvRequestedPlaybackMode(),
        playbackSessionId: state?.PlayState?.PlaySessionId || getCurrentPlaySessionId(player),
        playbackUrlType: getPlaybackUrlType(video),
        readyState: video?.readyState ?? null,
        reason,
        reconnectingReason,
        retryCount: playbackRetryCount,
        stalled: document.documentElement.classList.contains(PLAYER_RECONNECTING_VISIBLE_CLASS),
        stallCount: playbackStallCount,
        videoNetworkState: video?.networkState ?? null,
        ...extra
    };
}

function recordPlaybackDiagnostic(name, reason, detail = {}, throttle = false) {
    const now = Date.now();

    if (throttle && now - lastPlaybackDiagnosticAt < PLAYBACK_DIAGNOSTIC_THROTTLE_MS) return;

    lastPlaybackDiagnosticAt = now;
    recordPtvEvent('playback', name, getPlaybackDiagnostics(reason, detail));
}

function getPlaybackPages() {
    return Array.from(document.querySelectorAll(PAGE_SELECTOR))
        .filter(page => page instanceof HTMLElement);
}

function getActivePlaybackPage(pages = getPlaybackPages()) {
    return pages.find(page => !page.hidden
        && !page.classList.contains('hide')
        && !page.classList.contains('hidden'))
        || pages[pages.length - 1]
        || null;
}

function markPlaybackPageHosts(pages = getPlaybackPages()) {
    const reactRoot = document.getElementById('reactRoot');

    if (!reactRoot) return;

    pages.forEach(page => {
        let host = page;

        while (host.parentElement && host.parentElement !== reactRoot) {
            host = host.parentElement;
        }

        if (host !== reactRoot) {
            host.classList.add(PLAYER_PAGE_HOST_CLASS);
        }
    });
}

function getStartupVolumeKey(player, item) {
    let playSessionId = '';

    try {
        playSessionId = playbackManager.playSessionId?.(player) || '';
    } catch {
        playSessionId = '';
    }

    return [
        item?.ServerId || '',
        item?.Id || '',
        playSessionId || player?.name || ''
    ].filter(Boolean).join(':');
}

function setPlaybackStartupVolume(player, item) {
    if (!player) return;

    const startupVolumeKey = getStartupVolumeKey(player, item);

    if (startupVolumeKey && startupVolumeKey === lastStartupVolumeKey) return;

    lastStartupVolumeKey = startupVolumeKey;

    try {
        playbackManager.setVolume(PTV_STARTUP_VOLUME_LEVEL, player);
    } catch {
        const video = getActiveVideoElement();

        if (video) {
            video.volume = PTV_STARTUP_MEDIA_VOLUME;
        }
    }
}

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

function getFirstLogoUrl(item) {
    const candidates = [];

    addLogoCandidates(candidates, item);

    return getUniqueUrls(candidates)[0] || '';
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

    const primaryCandidates = [
        {
            itemId: item.Id,
            tag: item.ImageTags?.Primary || item.PrimaryImageTag,
            allowMissingTag: true
        },
        {
            itemId: item.SeriesId,
            tag: item.SeriesPrimaryImageTag
        },
        {
            itemId: item.ParentId,
            tag: item.ParentPrimaryImageTag
        }
    ];

    primaryCandidates.forEach(candidate => {
        if (!candidate.itemId) return;
        if (!candidate.tag && !candidate.allowMissingTag) return;

        addImageCandidate(candidates, item, 'Primary', {
            itemId: candidate.itemId,
            tag: candidate.tag,
            maxWidth: 720
        });
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

function getPlayerHeaderTitle(item) {
    if (!item) return '';

    if (item.SeriesName) {
        const episodeParts = [
            item.ParentIndexNumber ? `S${String(item.ParentIndexNumber).padStart(2, '0')}` : '',
            item.IndexNumber ? `E${String(item.IndexNumber).padStart(2, '0')}` : ''
        ].filter(Boolean).join(':');

        return [
            item.SeriesName,
            episodeParts,
            item.Name
        ].filter(Boolean).join(' - ');
    }

    if (item.Type === 'Movie' && item.ProductionYear) {
        return `${item.Name} (${item.ProductionYear})`;
    }

    return item.Name || getDisplayTitle(item);
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

function setHeaderLogo(element, url) {
    if (!element) return;

    if (!url) {
        element.style.removeProperty('background-image');
        element.classList.remove('ptv-player-top-logo-visible');
        return;
    }

    element.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
    element.classList.add('ptv-player-top-logo-visible');
}

function goBackFromPlayback() {
    const result = appRouter.back();

    if (result?.catch) {
        result.catch(() => window.history.back());
    }
}

function copyShareUrl(url) {
    const input = document.createElement('input');

    input.value = url;
    input.setAttribute('readonly', 'readonly');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.select();
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand('copy');
    input.remove();
}

async function shareCurrentPlayback() {
    const title = getPlayerHeaderTitle(currentItem);
    const url = window.location.href;

    try {
        if (navigator.share) {
            await navigator.share({ title, url });
            return;
        }

        copyShareUrl(url);
    } catch {
        // Sharing is best-effort and should never interrupt playback controls.
    }
}

function castCurrentPlayback() {
    const castButton = getPlaybackPages()
        .map(page => page.querySelector('.btnAirPlay:not(.hide)'))
        .find(Boolean)
        || document.querySelector('.headerCastButton:not(.hide), .castButton:not(.hide)');

    if (castButton instanceof HTMLElement) {
        castButton.click();
    }
}

function getPlayerChromeRoot() {
    let root = document.querySelector(`.${PLAYER_CHROME_ROOT_CLASS}`);

    if (root) return root;

    root = document.createElement('div');
    root.className = PLAYER_CHROME_ROOT_CLASS;
    root.dataset.ptvEnhanced = 'true';
    document.body.appendChild(root);

    return root;
}

function getOrCreateReconnectingBanner() {
    const root = getPlayerChromeRoot();
    let banner = root.querySelector(`.${PLAYER_RECONNECTING_CLASS}`);

    if (banner) return banner;

    banner = document.createElement('div');
    banner.className = PLAYER_RECONNECTING_CLASS;
    banner.dataset.ptvEnhanced = 'true';
    banner.setAttribute('aria-live', 'polite');
    banner.textContent = 'Reconnecting...';
    root.appendChild(banner);

    return banner;
}

function clearReconnectingHideTimer() {
    if (!reconnectingHideTimer) return;

    window.clearTimeout(reconnectingHideTimer);
    reconnectingHideTimer = null;
}

function setReconnectingState(visible, reason = '') {
    clearReconnectingHideTimer();

    if (visible) {
        reconnectingReason = reason;
        getOrCreateReconnectingBanner();
        document.documentElement.classList.add(PLAYER_RECONNECTING_VISIBLE_CLASS);
        document.body.classList.add(PLAYER_RECONNECTING_VISIBLE_CLASS);
        return;
    }

    reconnectingReason = '';
    document.documentElement.classList.remove(PLAYER_RECONNECTING_VISIBLE_CLASS);
    document.body.classList.remove(PLAYER_RECONNECTING_VISIBLE_CLASS);
}

function hideReconnectingStateSoon(reason = 'settled') {
    clearReconnectingHideTimer();

    reconnectingHideTimer = window.setTimeout(() => {
        reconnectingHideTimer = null;
        setReconnectingState(false, reason);
    }, STALL_SETTLE_HIDE_MS);
}

function getOrCreatePlayerHeader() {
    const root = getPlayerChromeRoot();
    let header = root.querySelector(`.${PLAYER_HEADER_CLASS}`);

    if (header) return header;

    header = document.createElement('div');
    header.className = PLAYER_HEADER_CLASS;
    header.dataset.ptvEnhanced = 'true';
    header.innerHTML = `
        <button class="ptv-player-top-button ptv-player-top-back" type="button" aria-label="Back"></button>
        <div class="ptv-player-top-title-wrap">
            <div class="ptv-player-top-logo" aria-hidden="true"></div>
            <div class="ptv-player-top-title"></div>
        </div>
        <div class="ptv-player-top-actions">
            <button class="ptv-player-top-button ptv-player-top-share" type="button" aria-label="Share"></button>
            <button class="ptv-player-top-button ptv-player-top-cast" type="button" aria-label="Cast"></button>
        </div>
    `;

    header.querySelector('.ptv-player-top-back')?.addEventListener('click', goBackFromPlayback);
    header.querySelector('.ptv-player-top-share')?.addEventListener('click', () => {
        void shareCurrentPlayback();
    });
    header.querySelector('.ptv-player-top-cast')?.addEventListener('click', castCurrentPlayback);

    root.appendChild(header);

    return header;
}

function renderPlayerHeader(item) {
    const header = getOrCreatePlayerHeader();
    const title = header.querySelector('.ptv-player-top-title');
    const logo = header.querySelector('.ptv-player-top-logo');
    const share = header.querySelector('.ptv-player-top-share');
    const cast = header.querySelector('.ptv-player-top-cast');
    const logoUrl = getFirstLogoUrl(item);

    if (title) {
        title.textContent = getPlayerHeaderTitle(item);
    }

    setHeaderLogo(logo, logoUrl);
    header.classList.toggle('ptv-player-topbar-has-logo', Boolean(logoUrl));
    share?.classList.remove('hide');
    cast?.classList.toggle('hide', !getPlaybackPages().some(page => page.querySelector('.btnAirPlay:not(.hide), .headerCastButton:not(.hide), .castButton:not(.hide)')));
}

function clearPlayerChromeTimer() {
    if (!playerChromeTimer) return;

    window.clearTimeout(playerChromeTimer);
    playerChromeTimer = null;
}

function setPlayerChromeVisible(visible) {
    const shouldShow = Boolean(visible) && isPlaybackUiActive();

    document.documentElement.classList.toggle(PLAYER_CHROME_VISIBLE_CLASS, shouldShow);
    document.body.classList.toggle(PLAYER_CHROME_VISIBLE_CLASS, shouldShow);
    syncNativePlayerControlsVisibility(shouldShow);
}

function showPlayerChrome(autoHide = true) {
    if (!isPlaybackUiActive()) {
        cleanupPlaybackDom();
        return;
    }

    clearPlayerChromeTimer();
    setPlayerChromeVisible(true);

    if (!autoHide || document.documentElement.classList.contains('ptv-player-paused')) return;

    playerChromeTimer = window.setTimeout(() => {
        playerChromeTimer = null;
        setPlayerChromeVisible(false);
        setPlayerOsdVisible(false);
    }, PLAYER_CHROME_HIDE_MS);
}

function setPlayerOsdVisible(visible) {
    const shouldShow = Boolean(visible) && isPlaybackUiActive();

    lastKnownOsdVisible = shouldShow;
    document.documentElement.classList.toggle('ptv-player-osd-visible', shouldShow);
    document.body.classList.toggle('ptv-player-osd-visible', shouldShow);

    if (shouldShow) {
        showPlayerChrome();
        return;
    }

    setPlayerChromeVisible(false);
}

function syncNativePlayerControlsVisibility(visible) {
    const pages = getPlaybackPages();

    if (!pages.length) return;

    markPlaybackPageHosts(pages);

    pages.forEach(page => {
        page.querySelectorAll('.videoOsdBottom, .osdControls').forEach(element => {
            element.classList.add('ptv-player-chrome');
            element.classList.toggle('ptv-player-chrome-forced-visible', Boolean(visible));

            if (visible) {
                if (element.classList.contains('hide')) {
                    element.dataset[PTV_RESTORED_HIDE_CLASS_KEY] = 'true';
                    element.classList.remove('hide');
                }

                if (element.classList.contains('hidden')) {
                    element.dataset[PTV_RESTORED_HIDDEN_CLASS_KEY] = 'true';
                    element.classList.remove('hidden');
                }

                if (element.classList.contains('videoOsdBottom-hidden')) {
                    element.dataset[PTV_RESTORED_OSD_HIDDEN_CLASS_KEY] = 'true';
                    element.classList.remove('videoOsdBottom-hidden');
                }

                element.removeAttribute('hidden');
                element.setAttribute('aria-hidden', 'false');
                return;
            }

            if (element.dataset[PTV_RESTORED_HIDE_CLASS_KEY] === 'true') {
                element.classList.add('hide');
                delete element.dataset[PTV_RESTORED_HIDE_CLASS_KEY];
            }

            if (element.dataset[PTV_RESTORED_HIDDEN_CLASS_KEY] === 'true') {
                element.classList.add('hidden');
                delete element.dataset[PTV_RESTORED_HIDDEN_CLASS_KEY];
            }

            if (element.dataset[PTV_RESTORED_OSD_HIDDEN_CLASS_KEY] === 'true') {
                element.classList.add('videoOsdBottom-hidden');
                delete element.dataset[PTV_RESTORED_OSD_HIDDEN_CLASS_KEY];
            }
        });
    });
}

function isPlayerOsdVisible() {
    const osd = getPlaybackPages()
        .flatMap(page => Array.from(page.querySelectorAll('.videoOsdBottom, .osdControls, .osdHeader')))
        .find(element => element instanceof HTMLElement
            && !element.closest('.hide, .hidden'));

    if (!(osd instanceof HTMLElement)) return false;

    const style = window.getComputedStyle(osd);

    return !osd.classList.contains('hide')
        && !osd.classList.contains('hidden')
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0;
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

function getOrCreatePauseStage() {
    const root = getPlayerChromeRoot();
    let stage = root.querySelector(`.${PAUSE_STAGE_CLASS}`);

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

    root.appendChild(stage);

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
    const stage = getOrCreatePauseStage();
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
    document.body.classList.toggle('ptv-player-paused', Boolean(isPaused));

    if (isPaused) {
        showPlayerChrome(false);
    }

    document.querySelectorAll(`.${PAUSE_STAGE_CLASS}`).forEach(stage => {
        stage.setAttribute('aria-hidden', isPaused ? 'false' : 'true');
    });
}

function isPlaybackPaused(player, state = {}) {
    const video = getActiveVideoElement();
    const managerPaused = Boolean(state.PlayState?.IsPaused || player?.paused?.());
    const videoPaused = Boolean(video && video.paused && !video.ended && video.readyState > 0);

    return managerPaused || videoPaused;
}

function clearPlaybackStallTimer() {
    if (!playbackStallTimer) return;

    window.clearTimeout(playbackStallTimer);
    playbackStallTimer = null;
}

function markPlaybackProgress(reason) {
    const video = currentVideo;

    lastVideoProgressAt = Date.now();
    lastVideoTime = video?.currentTime || lastVideoTime;

    if (video && !video.paused && !video.ended && (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA || hasBufferedAhead(video))) {
        clearPlaybackStallTimer();
        hideReconnectingStateSoon(reason);
    }
}

function retryCurrentPlaybackSource(video, reason) {
    const sourceKey = getVideoSourceKey(video);

    if (!sourceKey) {
        recordPlaybackDiagnostic('ptv-playback-stall-retry-skipped', reason, { skippedReason: 'missing-source' });
        return false;
    }

    if (retriedPlaybackSourceKeys.has(sourceKey)) {
        recordPlaybackDiagnostic('ptv-playback-stall-retry-skipped', reason, { skippedReason: 'already-retried-source' });
        return false;
    }

    rememberRetriedSourceKey(sourceKey);
    playbackRetryCount += 1;

    const restoreTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const wasPaused = video.paused;
    const hlsPlayer = currentPlayer?._hlsPlayer;

    recordPlaybackDiagnostic('ptv-playback-stall-retry-start', reason, {
        restoreTime: Number(restoreTime.toFixed(2)),
        strategy: hlsPlayer?.startLoad ? 'hls-start-load' : 'native-reload'
    });

    try {
        if (hlsPlayer?.startLoad) {
            hlsPlayer.startLoad(restoreTime);

            if (video.error && hlsPlayer.recoverMediaError) {
                hlsPlayer.recoverMediaError();
            }
        } else {
            const restorePosition = () => {
                video.removeEventListener('loadedmetadata', restorePosition);

                if (restoreTime && Number.isFinite(video.duration) && restoreTime < video.duration) {
                    video.currentTime = restoreTime;
                }
            };

            video.addEventListener('loadedmetadata', restorePosition);
            video.load();
        }

        if (!wasPaused) {
            const playPromise = video.play();

            if (playPromise?.catch) {
                playPromise.catch(() => {
                    recordPlaybackDiagnostic('ptv-playback-stall-retry-play-deferred', reason);
                });
            }
        }

        return true;
    } catch (err) {
        recordPlaybackDiagnostic('ptv-playback-stall-retry-failed', reason, {
            error: err instanceof Error ? err.message : String(err)
        });
        return false;
    }
}

function recoverFromPlaybackStall(reason) {
    playbackStallTimer = null;

    const video = currentVideo;

    if (!video || !isPlaybackUiActive() || video.paused || video.ended) {
        hideReconnectingStateSoon('inactive');
        return;
    }

    if (hasBufferedAhead(video)) {
        hideReconnectingStateSoon('buffered');
        return;
    }

    const elapsedSinceProgress = Date.now() - lastVideoProgressAt;
    const currentTime = video.currentTime || 0;
    const timeAdvanced = Math.abs(currentTime - lastVideoTime) > 0.25;

    if (timeAdvanced && elapsedSinceProgress < STALL_RECOVERY_DELAY_MS * 1.5) {
        markPlaybackProgress('time-advanced');
        return;
    }

    const didRetry = retryCurrentPlaybackSource(video, reason);

    if (!didRetry) {
        recordPlaybackDiagnostic('ptv-playback-stall-waiting-without-retry', reason, {}, true);
    }
}

function schedulePlaybackStallRecovery(reason) {
    const video = currentVideo;

    if (!video || video.paused || video.ended) return;

    playbackStallCount += 1;
    setReconnectingState(true, reason);
    recordPlaybackDiagnostic('ptv-playback-stall-detected', reason, {}, true);
    clearPlaybackStallTimer();

    playbackStallTimer = window.setTimeout(() => {
        recoverFromPlaybackStall(reason);
    }, STALL_RECOVERY_DELAY_MS);
}

function resetPlaybackDiagnostics() {
    clearPlaybackStallTimer();
    clearReconnectingHideTimer();
    setReconnectingState(false);
    playbackStallCount = 0;
    playbackRetryCount = 0;
    lastVideoProgressAt = 0;
    lastVideoTime = 0;
    lastVideoError = null;
    lastPlaybackDiagnosticAt = 0;
    reconnectingReason = '';
    retriedPlaybackSourceKeys.clear();
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

function updateFromState(player = currentPlayer || playbackManager.getCurrentPlayer?.()) {
    const state = player ? playbackManager.getPlayerState(player) || {} : {};
    const item = state.NowPlayingItem || (player ? playbackManager.currentItem(player) : null);
    const pages = getPlaybackPages();
    const page = getActivePlaybackPage(pages);
    const video = getActiveVideoElement();

    currentItem = item || currentItem;
    bindVideo(video);
    markPlaybackPageHosts(pages);

    if (page || isPlaybackUiActive()) {
        document.documentElement.classList.add(PLAYER_PAGE_CLASS);
        document.body.classList.add(PLAYER_PAGE_CLASS);
    }

    if (page && currentItem) {
        page.classList.add(PLAYER_PAGE_CLASS);
        renderPlayerHeader(currentItem);
        renderPauseStage(page, currentItem, state);
    }

    setPauseState(Boolean(currentItem && isPlaybackPaused(player, state)));
}

function enhancePlaybackDom() {
    const pages = getPlaybackPages();
    const page = getActivePlaybackPage(pages);

    if (!page || !isPlaybackUiActive()) {
        cleanupPlaybackDom();
        setPlayerOsdVisible(false);
        return;
    }

    document.documentElement.classList.add(PLAYER_PAGE_CLASS);
    document.body.classList.add(PLAYER_PAGE_CLASS);
    pages.forEach(playbackPage => {
        playbackPage.classList.add(PLAYER_PAGE_CLASS);
    });
    markPlaybackPageHosts(pages);
    getOrCreatePlayerHeader();
    bindVideo(getActiveVideoElement());

    if (!isPlayerOsdVisible() && lastKnownOsdVisible) {
        setPlayerOsdVisible(false);
    }

    pages.forEach(playbackPage => {
        playbackPage.querySelectorAll('.videoOsdBottom, .osdControls, .osdHeader').forEach(element => {
            element.classList.add('ptv-player-chrome');
        });
    });
    syncNativePlayerControlsVisibility(document.documentElement.classList.contains(PLAYER_CHROME_VISIBLE_CLASS));

    if (currentItem) {
        renderPlayerHeader(currentItem);
        renderPauseStage(page, currentItem, playbackManager.getPlayerState(currentPlayer) || {});
    }
}

function cleanupPlaybackDom() {
    clearPlayerChromeTimer();
    clearPlaybackStallTimer();
    lastKnownOsdVisible = false;
    setPlayerChromeVisible(false);
    setReconnectingState(false);
    releaseVideo();
    cancelPauseImageLoads();
    cancelPtvImageScope('pause-screen-backdrop');
    cancelPtvImageScope('pause-screen-logo');
    cancelPtvImageScope('pause-screen-disc');
    pauseAssetToken += 1;
    document.querySelector(`.${PLAYER_CHROME_ROOT_CLASS}`)?.remove();
    document.documentElement.classList.remove('ptv-player-paused');
    document.documentElement.classList.remove(PLAYER_PAGE_CLASS);
    document.body.classList.remove('ptv-player-paused');
    document.body.classList.remove(PLAYER_PAGE_CLASS);
    document.querySelectorAll(`.${PLAYER_PAGE_HOST_CLASS}`).forEach(host => {
        host.classList.remove(PLAYER_PAGE_HOST_CLASS);
    });
    document.querySelectorAll('.ptv-player-page').forEach(page => {
        page.classList.remove('ptv-player-page');
        page.querySelector(`.${PAUSE_STAGE_CLASS}`)?.remove();
        page.querySelectorAll('.ptv-player-chrome').forEach(element => {
            element.classList.remove('ptv-player-chrome');
        });
    });
}

function onPlaybackStart(_event, player, state) {
    resetPlaybackDiagnostics();
    bindPlayer(player);
    currentItem = state?.NowPlayingItem || playbackManager.currentItem(player);
    setPlaybackStartupVolume(player, currentItem);
    document.documentElement.classList.add('ptv-playing');
    document.body.classList.add('ptv-playing');
    updateFromState(player);
    recordPlaybackDiagnostic('ptv-playback-start', 'playbackstart');
    schedulePlaybackStateUpdate(player);
}

function onPlaybackStop(_event, playbackStopInfo = {}) {
    recordPlaybackDiagnostic('ptv-playback-stop', 'playbackstop', {
        nextItemId: playbackStopInfo?.nextItem?.Id || null,
        nextMediaType: playbackStopInfo?.nextMediaType || null
    });
    clearPlaybackStateTimer();
    setPlayerOsdVisible(false);
    document.documentElement.classList.remove('ptv-playing', 'ptv-player-paused');
    document.body.classList.remove('ptv-playing', 'ptv-player-paused');
    currentItem = null;
    lastStartupVolumeKey = '';
    resetPlaybackDiagnostics();
    cleanupPlaybackDom();
}

function onPlaybackAutoplayDecision(_event, detail = {}) {
    recordPlaybackDiagnostic('ptv-playback-autoplay-decision', 'autoplay', {
        autoplayAllowed: Boolean(detail.allowed),
        autoplayDecisionReason: detail.reason || 'unknown',
        autoplayError: detail.error || null,
        currentItemId: detail.currentItemId || null,
        currentItemName: detail.currentItemName || null,
        nextItemId: detail.nextItemId || null,
        nextItemName: detail.nextItemName || null,
        nextMediaType: detail.nextMediaType || null
    });
}

function onPlaybackError(_event, errorType) {
    recordPlaybackDiagnostic('ptv-playback-manager-error', 'playbackerror', {
        errorType
    });
    clearPlaybackStateTimer();
    setPlayerOsdVisible(false);
    document.documentElement.classList.remove('ptv-playing', 'ptv-player-paused');
    document.body.classList.remove('ptv-playing', 'ptv-player-paused');
    lastStartupVolumeKey = '';
    resetPlaybackDiagnostics();
    cleanupPlaybackDom();
}

function onPlayerPauseChange() {
    updateFromState(currentPlayer);
    schedulePlaybackStateUpdate(currentPlayer);
}

function onNativeVideoStateChange() {
    updateFromState(currentPlayer || playbackManager.getCurrentPlayer?.());
    schedulePlaybackStateUpdate(currentPlayer || playbackManager.getCurrentPlayer?.());
}

function onNativeVideoProgress(event) {
    const video = event.currentTarget instanceof HTMLVideoElement ? event.currentTarget : currentVideo;

    if (video && video !== currentVideo) return;

    markPlaybackProgress(event.type);
    updateFromState(currentPlayer || playbackManager.getCurrentPlayer?.());
}

function onNativeVideoStalled(event) {
    const video = event.currentTarget instanceof HTMLVideoElement ? event.currentTarget : currentVideo;

    if (video && video !== currentVideo) return;

    schedulePlaybackStallRecovery(event.type);
    updateFromState(currentPlayer || playbackManager.getCurrentPlayer?.());
}

function onNativeVideoError(event) {
    const video = event.currentTarget instanceof HTMLVideoElement ? event.currentTarget : currentVideo;
    const mediaError = video?.error;

    lastVideoError = mediaError ? {
        code: mediaError.code || 0,
        message: mediaError.message || ''
    } : {
        code: 0,
        message: ''
    };

    recordPlaybackDiagnostic('ptv-playback-video-error', event.type, {}, true);
    updateFromState(currentPlayer || playbackManager.getCurrentPlayer?.());
}

function onShowVideoOsd(_event, visible) {
    setPlayerOsdVisible(Boolean(visible));
    enhancePlaybackDom();
}

function onPlayerActivity() {
    if (!getPlaybackPages().length || !isPlaybackUiActive()) {
        cleanupPlaybackDom();
        return;
    }

    setPlayerOsdVisible(true);
    enhancePlaybackDom();
}

function onPlaybackRouteChanged() {
    if (!isPlaybackUiActive()) {
        cleanupPlaybackDom();
        setPlayerOsdVisible(false);
        document.documentElement.classList.remove('ptv-playing', 'ptv-player-paused');
        document.body.classList.remove('ptv-playing', 'ptv-player-paused');
        return;
    }

    refresh();
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

function bindVideo(video) {
    if (!video || video === currentVideo) return;

    releaseVideo();
    currentVideo = video;
    lastVideoProgressAt = Date.now();
    lastVideoTime = currentVideo.currentTime || 0;
    currentVideo.addEventListener('pause', onNativeVideoStateChange);
    currentVideo.addEventListener('play', onNativeVideoStateChange);
    currentVideo.addEventListener('playing', onNativeVideoStateChange);
    currentVideo.addEventListener('ended', onNativeVideoStateChange);
    currentVideo.addEventListener('waiting', onNativeVideoStalled);
    currentVideo.addEventListener('stalled', onNativeVideoStalled);
    currentVideo.addEventListener('error', onNativeVideoError);
    currentVideo.addEventListener('timeupdate', onNativeVideoProgress);
    currentVideo.addEventListener('progress', onNativeVideoProgress);
    currentVideo.addEventListener('loadedmetadata', onNativeVideoProgress);
    currentVideo.addEventListener('canplay', onNativeVideoProgress);
    currentVideo.addEventListener('canplaythrough', onNativeVideoProgress);
    recordPlaybackDiagnostic('ptv-playback-video-bound', 'bind-video', {}, true);
}

function releaseVideo() {
    if (!currentVideo) return;

    clearPlaybackStallTimer();
    currentVideo.removeEventListener('pause', onNativeVideoStateChange);
    currentVideo.removeEventListener('play', onNativeVideoStateChange);
    currentVideo.removeEventListener('playing', onNativeVideoStateChange);
    currentVideo.removeEventListener('ended', onNativeVideoStateChange);
    currentVideo.removeEventListener('waiting', onNativeVideoStalled);
    currentVideo.removeEventListener('stalled', onNativeVideoStalled);
    currentVideo.removeEventListener('error', onNativeVideoError);
    currentVideo.removeEventListener('timeupdate', onNativeVideoProgress);
    currentVideo.removeEventListener('progress', onNativeVideoProgress);
    currentVideo.removeEventListener('loadedmetadata', onNativeVideoProgress);
    currentVideo.removeEventListener('canplay', onNativeVideoProgress);
    currentVideo.removeEventListener('canplaythrough', onNativeVideoProgress);
    currentVideo = null;
}

function init({ scope } = {}) {
    if (moduleInitialized) {
        refresh();
        return;
    }

    moduleInitialized = true;
    Events.on(playbackManager, 'playbackstart', onPlaybackStart);
    Events.on(playbackManager, 'playbackstop', onPlaybackStop);
    Events.on(playbackManager, 'playbackautoplaydecision', onPlaybackAutoplayDecision);
    Events.on(playbackManager, 'playbackerror', onPlaybackError);
    Events.on(document, EventType.SHOW_VIDEO_OSD, onShowVideoOsd);
    Events.on(document, 'mousemove', onPlayerActivity);
    Events.on(document, 'touchstart', onPlayerActivity);
    Events.on(document, 'keydown', onPlayerActivity);
    Events.on(window, 'hashchange', onPlaybackRouteChanged);
    Events.on(window, 'popstate', onPlaybackRouteChanged);
    scope?.add(() => Events.off(playbackManager, 'playbackstart', onPlaybackStart), {
        label: 'playbackstart',
        type: 'listener'
    });
    scope?.add(() => Events.off(playbackManager, 'playbackstop', onPlaybackStop), {
        label: 'playbackstop',
        type: 'listener'
    });
    scope?.add(() => Events.off(playbackManager, 'playbackautoplaydecision', onPlaybackAutoplayDecision), {
        label: 'playback-autoplay-decision',
        type: 'listener'
    });
    scope?.add(() => Events.off(playbackManager, 'playbackerror', onPlaybackError), {
        label: 'playbackerror',
        type: 'listener'
    });
    scope?.add(() => Events.off(document, EventType.SHOW_VIDEO_OSD, onShowVideoOsd), {
        label: 'show-video-osd',
        type: 'listener'
    });
    scope?.add(() => Events.off(document, 'mousemove', onPlayerActivity), {
        label: 'player-mousemove',
        type: 'listener'
    });
    scope?.add(() => Events.off(document, 'touchstart', onPlayerActivity), {
        label: 'player-touchstart',
        type: 'listener'
    });
    scope?.add(() => Events.off(document, 'keydown', onPlayerActivity), {
        label: 'player-keydown',
        type: 'listener'
    });
    scope?.add(() => Events.off(window, 'hashchange', onPlaybackRouteChanged), {
        label: 'player-hashchange',
        type: 'listener'
    });
    scope?.add(() => Events.off(window, 'popstate', onPlaybackRouteChanged), {
        label: 'player-popstate',
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
    moduleInitialized = false;
    Events.off(playbackManager, 'playbackstart', onPlaybackStart);
    Events.off(playbackManager, 'playbackstop', onPlaybackStop);
    Events.off(playbackManager, 'playbackautoplaydecision', onPlaybackAutoplayDecision);
    Events.off(playbackManager, 'playbackerror', onPlaybackError);
    Events.off(document, EventType.SHOW_VIDEO_OSD, onShowVideoOsd);
    Events.off(document, 'mousemove', onPlayerActivity);
    Events.off(document, 'touchstart', onPlayerActivity);
    Events.off(document, 'keydown', onPlayerActivity);
    Events.off(window, 'hashchange', onPlaybackRouteChanged);
    Events.off(window, 'popstate', onPlaybackRouteChanged);
    setPlayerOsdVisible(false);
    clearPlayerChromeTimer();
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

init();
