import { resetRuntimeScope } from '../../core/scope';

const ACTIVE_CLASS = 'ptv-playback-active';
const HIDDEN_CHROME_CLASS = 'ptv-playback-hidden-chrome';
const PLAYBACK_CHROME_KEY = '__PTV_PLAYBACK_CHROME__';
const SETTLE_MS = 80;
const PLAYBACK_SELECTORS = [
    '#videoOsdPage',
    '.videoOsdPage',
    '.videoPlayerContainer',
    '.htmlVideoPlayer',
    '.videoSubtitles',
    '.osdControls',
    '.videoOsdBottom'
].join(',');
const SHELL_HEADER_SELECTORS = [
    '.ptv-app-header-root',
    '.skinHeader',
    '.ptv-skinHeader',
    '.ptv-legacy-skinHeader'
].join(',');
let updateTimer = 0;
let lastActive = false;

function hasPlaybackHash() {
    return /#\/(?:playback|video|livetv|nowplaying)/i.test(window.location.hash || '');
}

function hasPlaybackBodyState() {
    return document.body.classList.contains('videoOsdBody')
        || document.body.classList.contains('playerBody');
}

function hasActiveVideoElement() {
    return Array.from(document.querySelectorAll('video')).some((video) => {
        const element = video as HTMLVideoElement;
        const insidePlayer = Boolean(element.closest(PLAYBACK_SELECTORS));
        const hasSource = Boolean(element.currentSrc || element.src || element.readyState > 0);

        return insidePlayer && hasSource;
    });
}

function detectPlaybackActive() {
    const routeOrBodyActive = hasPlaybackHash() || hasPlaybackBodyState();

    return Boolean(routeOrBodyActive && (
        document.querySelector(PLAYBACK_SELECTORS)
        || hasActiveVideoElement()
    ));
}

function shouldHideHeaderDuringPlayback(header: Element) {
    return Boolean(header);
}

function updateHiddenPlaybackChrome(active: boolean) {
    document
        .querySelectorAll(SHELL_HEADER_SELECTORS)
        .forEach(header => {
            header.classList.toggle(
                HIDDEN_CHROME_CLASS,
                active && shouldHideHeaderDuringPlayback(header)
            );
        });

    if (!active) {
        document
            .querySelectorAll(`.${HIDDEN_CHROME_CLASS}`)
            .forEach(element => {
                element.classList.remove(HIDDEN_CHROME_CLASS);
            });
    }
}

function setPlaybackActive(active: boolean) {
    if (active === lastActive) {
        updateHiddenPlaybackChrome(active);
        return;
    }

    lastActive = active;
    document.documentElement.classList.toggle(ACTIVE_CLASS, active);
    document.body.classList.toggle(ACTIVE_CLASS, active);
    updateHiddenPlaybackChrome(active);

    if (active) {
        document.documentElement.classList.add('ptv-playing');
        document.body.classList.add('ptv-playing');
        return;
    }

    document.documentElement.classList.remove('ptv-playing', 'ptv-player-paused');
    document.body.classList.remove('ptv-playing', 'ptv-player-paused');
}

function updatePlaybackChrome() {
    updateTimer = 0;
    setPlaybackActive(detectPlaybackActive());
}

function schedulePlaybackChromeUpdate() {
    if (updateTimer) {
        window.clearTimeout(updateTimer);
    }

    updateTimer = window.setTimeout(updatePlaybackChrome, SETTLE_MS);
}

function initPlaybackChrome() {
    const globalWindow = window as unknown as Window & Record<string, boolean | undefined>;

    if (globalWindow[PLAYBACK_CHROME_KEY]) return;

    globalWindow[PLAYBACK_CHROME_KEY] = true;

    const scope = resetRuntimeScope('playback-chrome');

    scope.watchDom(schedulePlaybackChromeUpdate);
    scope.listen(window, 'hashchange', schedulePlaybackChromeUpdate);
    scope.listen(window, 'popstate', schedulePlaybackChromeUpdate);
    scope.listen(document, 'fullscreenchange', schedulePlaybackChromeUpdate);
    scope.listen(document, 'webkitfullscreenchange', schedulePlaybackChromeUpdate);
    scope.listen(document, 'play', schedulePlaybackChromeUpdate, true);
    scope.listen(document, 'pause', schedulePlaybackChromeUpdate, true);
    scope.listen(document, 'ended', schedulePlaybackChromeUpdate, true);

    schedulePlaybackChromeUpdate();
}

initPlaybackChrome();
