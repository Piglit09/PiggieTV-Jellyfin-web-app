export type PtvVideoSeekAction = 'seek-back' | 'seek-forward';
type VideoControlsVisibilityHandler = (visible: boolean) => void;

let videoControlsVisibilityHandler: VideoControlsVisibilityHandler | null = null;
let videoControlsVisibilityOwner = '';

export function registerPtvVideoControlsVisibilityHandler(
    owner: string,
    handler: VideoControlsVisibilityHandler
) {
    if (!owner || typeof handler !== 'function') return () => undefined;
    if (videoControlsVisibilityHandler && videoControlsVisibilityOwner !== owner) return () => undefined;

    videoControlsVisibilityHandler = handler;
    videoControlsVisibilityOwner = owner;

    return () => {
        if (videoControlsVisibilityHandler !== handler || videoControlsVisibilityOwner !== owner) return;

        videoControlsVisibilityHandler = null;
        videoControlsVisibilityOwner = '';
    };
}

export function requestPtvVideoControlsVisibility(visible: boolean) {
    if (!videoControlsVisibilityHandler) return false;

    videoControlsVisibilityHandler(visible);
    return true;
}

export function getPtvVideoSeekAction(key: string): PtvVideoSeekAction | null {
    if (key === 'ArrowLeft' || key === 'Left') return 'seek-back';
    if (key === 'ArrowRight' || key === 'Right') return 'seek-forward';

    return null;
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

export function isPtvVideoPlayerControlFocused(element: Element | null = document.activeElement) {
    return element instanceof HTMLElement && Boolean(element.closest([
        '.ptv-player-chrome-root',
        '#videoOsdPage .videoOsdBottom',
        '.videoOsdPage .videoOsdBottom',
        '#videoOsdPage .osdControls',
        '.videoOsdPage .osdControls',
        '#videoOsdPage .osdHeader',
        '.videoOsdPage .osdHeader'
    ].join(',')));
}
