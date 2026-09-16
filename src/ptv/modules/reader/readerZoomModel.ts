import type {
    ReaderFormat,
    ReaderZoomCapabilities,
    ReaderZoomMode,
    ReaderZoomState
} from './readerModels';

const PAGE_ZOOM_CAPABILITIES: ReaderZoomCapabilities = {
    kind: 'page',
    canZoomIn: true,
    canZoomOut: true,
    canResetZoom: true,
    canFitPage: true,
    canFitWidth: true,
    canAdjustTextScale: false,
    minScale: 0.25,
    maxScale: 4,
    step: 0.1
};

const TEXT_ZOOM_CAPABILITIES: ReaderZoomCapabilities = {
    kind: 'text',
    canZoomIn: true,
    canZoomOut: true,
    canResetZoom: true,
    canFitPage: false,
    canFitWidth: false,
    canAdjustTextScale: true,
    minScale: 0.7,
    maxScale: 2,
    step: 0.1
};

const NO_ZOOM_CAPABILITIES: ReaderZoomCapabilities = {
    kind: 'none',
    canZoomIn: false,
    canZoomOut: false,
    canResetZoom: false,
    canFitPage: false,
    canFitWidth: false,
    canAdjustTextScale: false,
    minScale: 1,
    maxScale: 1,
    step: 0
};

export interface ReaderViewportSize {
    height: number;
    width: number;
}

export interface ReaderContentSize {
    height: number;
    width: number;
}

export const READER_FIT_INSET = 16;

export function getReaderZoomCapabilities(format: ReaderFormat): ReaderZoomCapabilities {
    if (format === 'pdf' || format === 'comic') return PAGE_ZOOM_CAPABILITIES;
    if (format === 'epub') return TEXT_ZOOM_CAPABILITIES;
    return NO_ZOOM_CAPABILITIES;
}

export function createDefaultReaderZoomState(format: ReaderFormat): ReaderZoomState {
    return {
        mode: format === 'pdf' || format === 'comic' ? 'fit-page' : 'manual',
        manualScale: 1
    };
}

export function clampReaderManualScale(
    scale: number,
    capabilities: ReaderZoomCapabilities
): number {
    if (!Number.isFinite(scale)) return 1;
    return Math.max(capabilities.minScale, Math.min(capabilities.maxScale, scale));
}

export function normalizeReaderZoomState(
    format: ReaderFormat,
    state: ReaderZoomState
): ReaderZoomState {
    const capabilities = getReaderZoomCapabilities(format);
    const supportsMode = state.mode === 'manual'
        || (state.mode === 'fit-page' && capabilities.canFitPage)
        || (state.mode === 'fit-width' && capabilities.canFitWidth);

    return {
        mode: supportsMode ? state.mode : createDefaultReaderZoomState(format).mode,
        manualScale: clampReaderManualScale(state.manualScale, capabilities)
    };
}

function roundedScale(scale: number): number {
    return Math.round(scale * 100) / 100;
}

export function stepReaderZoom(
    format: ReaderFormat,
    state: ReaderZoomState,
    effectiveScale: number,
    direction: -1 | 1
): ReaderZoomState {
    const capabilities = getReaderZoomCapabilities(format);
    const startingScale = state.mode === 'manual' ? state.manualScale : effectiveScale;

    if (direction < 0 && startingScale <= capabilities.minScale) {
        return normalizeReaderZoomState(format, state);
    }
    if (direction > 0 && startingScale >= capabilities.maxScale) {
        return normalizeReaderZoomState(format, state);
    }

    return {
        mode: 'manual',
        manualScale: clampReaderManualScale(
            roundedScale(startingScale + (capabilities.step * direction)),
            capabilities
        )
    };
}

export function resetReaderZoom(format: ReaderFormat): ReaderZoomState {
    return normalizeReaderZoomState(format, {
        mode: 'manual',
        manualScale: 1
    });
}

export function setReaderFitMode(
    format: ReaderFormat,
    state: ReaderZoomState,
    mode: Extract<ReaderZoomMode, 'fit-page' | 'fit-width'>
): ReaderZoomState {
    return normalizeReaderZoomState(format, {
        ...state,
        mode
    });
}

export function resolveReaderScale(
    format: ReaderFormat,
    state: ReaderZoomState,
    viewport: ReaderViewportSize,
    content: ReaderContentSize,
    horizontalSlots = 1
): number {
    const normalized = normalizeReaderZoomState(format, state);
    if (normalized.mode === 'manual') return normalized.manualScale;

    if (viewport.width <= 0 || viewport.height <= 0 || content.width <= 0 || content.height <= 0) {
        return normalized.manualScale;
    }

    const availableWidth = Math.max(1, viewport.width - READER_FIT_INSET);
    const availableHeight = Math.max(1, viewport.height - READER_FIT_INSET);
    const slotCount = Math.max(1, horizontalSlots);
    const widthScale = (availableWidth / slotCount) / content.width;
    const fitScale = normalized.mode === 'fit-width' ?
        widthScale :
        Math.min(widthScale, availableHeight / content.height);

    return Math.min(getReaderZoomCapabilities(format).maxScale, fitScale);
}

export function readerZoomPercent(scale: number): number {
    return Math.max(1, Math.round(scale * 100));
}
