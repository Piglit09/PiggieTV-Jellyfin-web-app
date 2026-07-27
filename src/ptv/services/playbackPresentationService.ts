import { recordPtvEvent } from '../core/observability';

import {
    getPtvGlobalPlaybackState,
    subscribeToPtvGlobalPlaybackState,
    type PtvGlobalPlaybackState
} from './playbackStateService';

export type PtvPlaybackPresentationState =
    | 'audio-fullscreen'
    | 'audio-mini'
    | 'idle'
    | 'transitioning'
    | 'unavailable'
    | 'video-paused-controls-visible'
    | 'video-playing-controls-hidden'
    | 'video-playing-controls-visible';

export type PtvPlaybackSurface =
    | 'full-screen-player'
    | 'mini-player'
    | 'none'
    | 'player-controls'
    | 'video-surface';

export type PtvPlaybackPresentationSnapshot = Readonly<{
    audioLoaded: boolean;
    controlsVisible: boolean;
    paused: boolean;
    routeFamily: 'music-fullscreen' | 'other' | 'video';
    state: PtvPlaybackPresentationState;
    surface: PtvPlaybackSurface;
    videoAvailable: boolean;
}>;

type PtvPlaybackPresentationInput = Readonly<{
    fullScreenMusicAvailable?: boolean;
    routeHash?: string;
    videoAvailable?: boolean;
    videoControlsVisible?: boolean;
    videoPaused?: boolean | null;
}>;

type PresentationListener = () => void;

const listeners = new Set<PresentationListener>();
const EMPTY_PLAYBACK_STATE: PtvGlobalPlaybackState = {
    active: false,
    canSeek: false,
    lastUpdatedAt: 0,
    paused: true,
    source: 'none'
};
let currentPlaybackState: PtvGlobalPlaybackState | null = null;
let currentSnapshot: PtvPlaybackPresentationSnapshot;
let fullScreenMusicAvailable = false;
let initialized = false;
let playbackUnsubscribe: (() => void) | null = null;
let routeChangeHandler: (() => void) | null = null;
let videoAvailable = false;
let videoControlsVisible = false;
let videoPaused: boolean | null = null;

function isVideoRoute(routeHash: string) {
    return /^#\/(?:playback|video|livetv|nowplaying)(?:[/?]|$)/i.test(routeHash);
}

function isFullScreenMusicRoute(routeHash: string) {
    return /^#\/music\/player(?:[/?]|$)/i.test(routeHash);
}

function isAudioPlayback(state: PtvGlobalPlaybackState) {
    return state.active
        && state.source === 'ptv-music'
        && String(state.mediaType || '').toLowerCase() === 'audio';
}

function isVideoPlayback(state: PtvGlobalPlaybackState) {
    const itemType = String(state.itemType || '').toLowerCase();
    const mediaType = String(state.mediaType || '').toLowerCase();

    return state.active && (
        mediaType === 'video'
        || ['episode', 'movie', 'series', 'trailer', 'video'].includes(itemType)
    );
}

function getRouteFamily(routeHash: string): PtvPlaybackPresentationSnapshot['routeFamily'] {
    if (isFullScreenMusicRoute(routeHash)) return 'music-fullscreen';
    if (isVideoRoute(routeHash)) return 'video';

    return 'other';
}

function deriveVideoPresentation(
    playbackState: PtvGlobalPlaybackState,
    input: PtvPlaybackPresentationInput,
    routeFamily: PtvPlaybackPresentationSnapshot['routeFamily'],
    audioLoaded: boolean
): PtvPlaybackPresentationSnapshot {
    const paused = input.videoPaused ?? playbackState.paused;
    const controlsVisible = Boolean(input.videoControlsVisible);
    const hasVideoSurface = Boolean(input.videoAvailable);

    if (!isVideoPlayback(playbackState) && !hasVideoSurface) {
        return {
            audioLoaded,
            controlsVisible: false,
            paused: true,
            routeFamily,
            state: 'unavailable',
            surface: 'none',
            videoAvailable: false
        };
    }

    if (paused) {
        return {
            audioLoaded,
            controlsVisible: true,
            paused: true,
            routeFamily,
            state: 'video-paused-controls-visible',
            surface: 'player-controls',
            videoAvailable: hasVideoSurface
        };
    }

    return {
        audioLoaded,
        controlsVisible,
        paused: false,
        routeFamily,
        state: controlsVisible ? 'video-playing-controls-visible' : 'video-playing-controls-hidden',
        surface: controlsVisible ? 'player-controls' : 'video-surface',
        videoAvailable: hasVideoSurface
    };
}

function deriveAudioPresentation(
    playbackState: PtvGlobalPlaybackState,
    input: PtvPlaybackPresentationInput,
    routeFamily: PtvPlaybackPresentationSnapshot['routeFamily']
): PtvPlaybackPresentationSnapshot {
    const wantsFullScreen = routeFamily === 'music-fullscreen';
    const hasFullScreen = Boolean(input.fullScreenMusicAvailable);

    if (wantsFullScreen && hasFullScreen) {
        return {
            audioLoaded: true,
            controlsVisible: true,
            paused: playbackState.paused,
            routeFamily,
            state: 'audio-fullscreen',
            surface: 'full-screen-player',
            videoAvailable: false
        };
    }

    if (wantsFullScreen || hasFullScreen) {
        return {
            audioLoaded: true,
            controlsVisible: true,
            paused: playbackState.paused,
            routeFamily,
            state: 'transitioning',
            surface: hasFullScreen ? 'full-screen-player' : 'mini-player',
            videoAvailable: false
        };
    }

    return {
        audioLoaded: true,
        controlsVisible: true,
        paused: playbackState.paused,
        routeFamily,
        state: 'audio-mini',
        surface: 'mini-player',
        videoAvailable: false
    };
}

export function derivePtvPlaybackPresentation(
    playbackState: PtvGlobalPlaybackState,
    input: PtvPlaybackPresentationInput = {}
): PtvPlaybackPresentationSnapshot {
    const routeHash = input.routeHash ?? window.location.hash ?? '';
    const routeFamily = getRouteFamily(routeHash);
    const audioLoaded = isAudioPlayback(playbackState);
    const videoOwnsPlayback = isVideoPlayback(playbackState) || routeFamily === 'video';

    if (videoOwnsPlayback) {
        return deriveVideoPresentation(playbackState, input, routeFamily, audioLoaded);
    }

    if (audioLoaded) {
        return deriveAudioPresentation(playbackState, input, routeFamily);
    }

    if (playbackState.active) {
        return {
            audioLoaded: false,
            controlsVisible: false,
            paused: playbackState.paused,
            routeFamily,
            state: 'unavailable',
            surface: 'none',
            videoAvailable: false
        };
    }

    return {
        audioLoaded: false,
        controlsVisible: false,
        paused: true,
        routeFamily,
        state: 'idle',
        surface: 'none',
        videoAvailable: false
    };
}

function snapshotSignature(snapshot: PtvPlaybackPresentationSnapshot) {
    return [
        snapshot.audioLoaded,
        snapshot.controlsVisible,
        snapshot.paused,
        snapshot.routeFamily,
        snapshot.state,
        snapshot.surface,
        snapshot.videoAvailable
    ].join('|');
}

function updateDocumentPresentation(snapshot: PtvPlaybackPresentationSnapshot) {
    document.documentElement.dataset.ptvPlaybackPresentation = snapshot.state;
    document.documentElement.dataset.ptvPlaybackSurface = snapshot.surface;
}

function publishPresentation(reason: string) {
    const playbackState = currentPlaybackState || getPtvGlobalPlaybackState() || EMPTY_PLAYBACK_STATE;
    const nextSnapshot = derivePtvPlaybackPresentation(playbackState, {
        fullScreenMusicAvailable,
        videoAvailable,
        videoControlsVisible,
        videoPaused
    });

    if (currentSnapshot && snapshotSignature(currentSnapshot) === snapshotSignature(nextSnapshot)) {
        updateDocumentPresentation(nextSnapshot);
        return;
    }

    const previousState = currentSnapshot?.state || 'idle';
    const previousSurface = currentSnapshot?.surface || 'none';

    currentSnapshot = nextSnapshot;
    updateDocumentPresentation(nextSnapshot);
    recordPtvEvent('playback', 'playback-presentation-changed', {
        fromState: previousState,
        fromSurface: previousSurface,
        reason,
        toState: nextSnapshot.state,
        toSurface: nextSnapshot.surface
    });
    listeners.forEach(listener => {
        listener();
    });
}

export function startPtvPlaybackPresentationService() {
    if (initialized) return;

    initialized = true;
    currentPlaybackState = getPtvGlobalPlaybackState() || EMPTY_PLAYBACK_STATE;
    playbackUnsubscribe = subscribeToPtvGlobalPlaybackState(state => {
        currentPlaybackState = state;
        publishPresentation('playback-state');
    });
    routeChangeHandler = () => publishPresentation('route-change');
    window.addEventListener('hashchange', routeChangeHandler);
    window.addEventListener('popstate', routeChangeHandler);
    publishPresentation('service-start');
}

export function getPtvPlaybackPresentationSnapshot() {
    return currentSnapshot;
}

export function subscribeToPtvPlaybackPresentation(listener: PresentationListener) {
    startPtvPlaybackPresentationService();
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

export function setPtvFullScreenMusicPresentationAvailable(available: boolean) {
    if (fullScreenMusicAvailable === available) return;

    fullScreenMusicAvailable = available;
    publishPresentation(available ? 'music-fullscreen-mounted' : 'music-fullscreen-unmounted');
}

export function setPtvVideoPlaybackPresentation(input: Readonly<{
    available?: boolean;
    controlsVisible?: boolean;
    paused?: boolean | null;
}>) {
    if (typeof input.available === 'boolean') videoAvailable = input.available;
    if (typeof input.controlsVisible === 'boolean') videoControlsVisible = input.controlsVisible;
    if (input.paused === null || typeof input.paused === 'boolean') videoPaused = input.paused;
    publishPresentation('video-ui-state');
}

export function disposePtvPlaybackPresentationServiceForTests() {
    playbackUnsubscribe?.();
    playbackUnsubscribe = null;
    if (routeChangeHandler) {
        window.removeEventListener('hashchange', routeChangeHandler);
        window.removeEventListener('popstate', routeChangeHandler);
    }
    routeChangeHandler = null;
    listeners.clear();
    currentPlaybackState = null;
    fullScreenMusicAvailable = false;
    initialized = false;
    videoAvailable = false;
    videoControlsVisible = false;
    videoPaused = null;
    currentSnapshot = derivePtvPlaybackPresentation(getPtvGlobalPlaybackState() || EMPTY_PLAYBACK_STATE, {
        routeHash: window.location.hash
    });
    delete document.documentElement.dataset.ptvPlaybackPresentation;
    delete document.documentElement.dataset.ptvPlaybackSurface;
}

currentSnapshot = derivePtvPlaybackPresentation(getPtvGlobalPlaybackState() || EMPTY_PLAYBACK_STATE, {
    routeHash: window.location.hash
});
