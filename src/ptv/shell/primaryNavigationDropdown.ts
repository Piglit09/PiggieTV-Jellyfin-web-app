export type PtvDropdownRect = Readonly<{
    bottom: number;
    height: number;
    left: number;
    right: number;
    top: number;
    width: number;
}>;

export type PtvDropdownViewport = Readonly<{
    height: number;
    left: number;
    top: number;
    width: number;
}>;

export type PtvDropdownOverlayPosition = Readonly<{
    left: number;
    maxHeight: number;
    minWidth: number;
    top: number;
    width: number;
}>;

const DROPDOWN_GAP = 10;
const DROPDOWN_MARGIN = 14;
const DROPDOWN_MIN_WIDTH = 220;
const DROPDOWN_WIDTH_PADDING = 72;
const TOUCH_MOVE_THRESHOLD = 10;

function clamp(value: number, minimum: number, maximum: number) {
    if (maximum <= minimum) return minimum;
    return Math.min(Math.max(value, minimum), maximum);
}

export function getPtvDropdownViewport(targetWindow: Window = window): PtvDropdownViewport {
    const visualViewport = targetWindow.visualViewport;

    return {
        height: visualViewport?.height || targetWindow.innerHeight || targetWindow.document.documentElement.clientHeight || 0,
        left: visualViewport?.offsetLeft || 0,
        top: visualViewport?.offsetTop || 0,
        width: visualViewport?.width || targetWindow.innerWidth || targetWindow.document.documentElement.clientWidth || 0
    };
}

export function getPtvDropdownOverlayPosition(
    trigger: PtvDropdownRect,
    viewport: PtvDropdownViewport,
    panelHeight: number
): PtvDropdownOverlayPosition {
    const availableWidth = Math.max(0, viewport.width - (DROPDOWN_MARGIN * 2));
    const width = Math.min(Math.max(DROPDOWN_MIN_WIDTH, trigger.width + DROPDOWN_WIDTH_PADDING), availableWidth);
    const minWidth = Math.min(DROPDOWN_MIN_WIDTH, width);
    const leftBoundary = viewport.left + DROPDOWN_MARGIN;
    const rightBoundary = viewport.left + viewport.width - DROPDOWN_MARGIN;
    const left = clamp(trigger.left, leftBoundary, rightBoundary - width);
    const maxHeight = Math.max(0, viewport.height - (DROPDOWN_MARGIN * 2));
    const effectiveHeight = Math.min(Math.max(0, panelHeight), maxHeight);
    const topBoundary = viewport.top + DROPDOWN_MARGIN;
    const bottomBoundary = viewport.top + viewport.height - DROPDOWN_MARGIN;
    const belowTop = trigger.bottom + DROPDOWN_GAP;
    const aboveTop = trigger.top - DROPDOWN_GAP - effectiveHeight;
    const preferredTop = belowTop + effectiveHeight <= bottomBoundary || aboveTop < topBoundary ? belowTop : aboveTop;
    const top = clamp(preferredTop, topBoundary, bottomBoundary - effectiveHeight);

    return {
        left,
        maxHeight,
        minWidth,
        top,
        width
    };
}

export function hasPtvDropdownPointerMoved(
    startX: number,
    startY: number,
    currentX: number,
    currentY: number
) {
    return Math.abs(currentX - startX) >= TOUCH_MOVE_THRESHOLD
        || Math.abs(currentY - startY) >= TOUCH_MOVE_THRESHOLD;
}
