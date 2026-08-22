export type PtvVideoSeekAction = 'seek-back' | 'seek-forward';
type VideoControlsVisibilityHandler = (visible: boolean) => void;
type HiddenVideoDirectionalGesture = Readonly<{
    action: PtvVideoSeekAction;
}>;
export type PtvVideoControlsVisibilityLease = Readonly<{
    isActive: () => boolean;
    release: () => boolean;
}>;

let videoControlsVisibilityHandler: VideoControlsVisibilityHandler | null = null;
let videoControlsVisibilityOwner = '';
let hiddenVideoDirectionalGesture: HiddenVideoDirectionalGesture | null = null;

export function registerPtvVideoControlsVisibilityHandler(
    owner: string,
    handler: VideoControlsVisibilityHandler
): PtvVideoControlsVisibilityLease {
    const isActive = () => (
        videoControlsVisibilityHandler === handler
        && videoControlsVisibilityOwner === owner
    );
    const release = () => {
        if (!isActive()) return false;

        videoControlsVisibilityHandler = null;
        videoControlsVisibilityOwner = '';
        return true;
    };

    if (!owner || typeof handler !== 'function') return { isActive, release };
    if (videoControlsVisibilityHandler && videoControlsVisibilityOwner !== owner) {
        return { isActive, release };
    }

    videoControlsVisibilityHandler = handler;
    videoControlsVisibilityOwner = owner;

    return { isActive, release };
}

export function requestPtvVideoControlsVisibility(visible: boolean) {
    if (!videoControlsVisibilityHandler) return false;

    videoControlsVisibilityHandler(visible);
    return true;
}

export function hidePtvVideoControls(fallback: () => void) {
    if (requestPtvVideoControlsVisibility(false)) return true;

    fallback();
    return false;
}

export function shouldTreatPtvVideoControlsAsHidden(
    currentVisibleMenu: string | null | undefined,
    presentation: Readonly<{
        playbackActive: boolean;
        controlsVisible: boolean;
    }>
) {
    if (!currentVisibleMenu) return true;

    return currentVisibleMenu === 'osd'
        && presentation.playbackActive
        && !presentation.controlsVisible;
}

export function getPtvVideoSeekAction(key: string): PtvVideoSeekAction | null {
    if (key === 'ArrowLeft' || key === 'Left' || key === 'left') return 'seek-back';
    if (key === 'ArrowRight' || key === 'Right' || key === 'right') return 'seek-forward';

    return null;
}

export function beginPtvHiddenVideoDirectionalGesture(key: string) {
    const action = getPtvVideoSeekAction(key);

    if (!action) {
        hiddenVideoDirectionalGesture = null;
        return false;
    }

    hiddenVideoDirectionalGesture = { action };
    return true;
}

export function shouldContinuePtvHiddenVideoDirectionalGesture(
    key: string,
    repeat: boolean
) {
    const action = getPtvVideoSeekAction(key);
    const gesture = hiddenVideoDirectionalGesture;

    if (!repeat || !action || action !== gesture?.action) {
        hiddenVideoDirectionalGesture = null;
        return false;
    }

    return true;
}

export function resetPtvHiddenVideoDirectionalGesture() {
    hiddenVideoDirectionalGesture = null;
}

export function resetPtvHiddenVideoDirectionalGestureForLease(
    lease: PtvVideoControlsVisibilityLease | null
) {
    if (!lease?.isActive()) return false;

    resetPtvHiddenVideoDirectionalGesture();
    return true;
}

export function executePtvHiddenVideoDirectionalGestureKey(
    input: Readonly<{
        controlsHidden: boolean;
        key: string;
        repeat: boolean;
    }>,
    handlers: Readonly<{
        seekBack: () => void;
        seekForward: () => void;
    }>
) {
    const continuedGesture = shouldContinuePtvHiddenVideoDirectionalGesture(
        input.key,
        input.repeat
    );

    if (!continuedGesture && !input.controlsHidden) return false;
    if (!executePtvVideoSeekKey(input.key, handlers)) return false;

    beginPtvHiddenVideoDirectionalGesture(input.key);
    return true;
}

export function executePtvVideoSeekAction(
    action: PtvVideoSeekAction | null,
    handlers: Readonly<{
        seekBack: () => void;
        seekForward: () => void;
    }>
) {
    if (action === 'seek-back') {
        handlers.seekBack();
        return true;
    }

    if (action === 'seek-forward') {
        handlers.seekForward();
        return true;
    }

    return false;
}

export function executePtvVideoSeekKey(
    key: string,
    handlers: Readonly<{
        seekBack: () => void;
        seekForward: () => void;
    }>
) {
    return executePtvVideoSeekAction(getPtvVideoSeekAction(key), handlers);
}

export function shouldYieldVideoKeyToPtvFocusOwner(defaultPrevented: boolean) {
    return defaultPrevented;
}

export function reconcilePtvVideoControlSurface(
    videoPage: Element | null,
    root: Document | Element = document
) {
    root.querySelectorAll('.ptv-player-topbar').forEach(element => {
        element.remove();
    });
    root.querySelectorAll('[data-ptv-playback-surface="video-controls"]').forEach(element => {
        element.removeAttribute('data-ptv-playback-surface');
    });

    if (!videoPage) return 0;

    videoPage.setAttribute('data-ptv-playback-surface', 'video-controls');
    return 1;
}

export function isPtvVideoPlayerControlFocused(element: Element | null = document.activeElement) {
    if (!(element instanceof HTMLElement)) return false;

    const controlSurface = element.closest([
        '.ptv-player-pause-stage',
        '#videoOsdPage .videoOsdBottom',
        '.videoOsdPage .videoOsdBottom',
        '#videoOsdPage .osdControls',
        '.videoOsdPage .osdControls',
        '#videoOsdPage .osdHeader',
        '.videoOsdPage .osdHeader'
    ].join(','));

    if (!controlSurface) return false;

    return !element.closest([
        '.hide',
        '.hidden',
        '[hidden]',
        '[aria-hidden="true"]',
        '.videoOsdBottom-hidden',
        '.osdHeader-hidden'
    ].join(','));
}
