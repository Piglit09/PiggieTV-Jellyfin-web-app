import type { ReaderFormat, ReaderZoomState } from './readerModels';
import { createDefaultReaderZoomState, normalizeReaderZoomState } from './readerZoomModel';

const zoomByItem = new Map<string, ReaderZoomState>();

function zoomKey(stableId: string, format: ReaderFormat): string {
    return `${format}:${stableId}`;
}

export function loadReaderZoomSession(stableId: string, format: ReaderFormat): ReaderZoomState {
    const stored = zoomByItem.get(zoomKey(stableId, format));
    return stored ? normalizeReaderZoomState(format, stored) : createDefaultReaderZoomState(format);
}

export function saveReaderZoomSession(stableId: string, format: ReaderFormat, state: ReaderZoomState) {
    zoomByItem.set(zoomKey(stableId, format), normalizeReaderZoomState(format, state));
}

export function clearReaderZoomSessionsForTests() {
    zoomByItem.clear();
}
