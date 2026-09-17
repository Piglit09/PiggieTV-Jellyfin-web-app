import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    LoadedReaderDocument,
    ReaderFormat,
    ReaderProgressState,
    ReaderSettings,
    ReaderSource,
    ReaderZoomState
} from './readerModels';
import { clearReaderZoomSessionsForTests } from './readerZoomSessionStore';

type MockReaderViewProps = Readonly<{
    document: LoadedReaderDocument;
    pageIndex: number;
    settings: ReaderSettings;
    zoom: ReaderZoomState;
    onEffectiveScaleChange: (scale: number) => void;
    onScaleApplyFailed?: () => void;
}>;

const readerMocks = vi.hoisted(() => ({
    addReaderBookmark: vi.fn(() => []),
    loadReaderBookmarks: vi.fn(() => []),
    loadReaderDocument: vi.fn(),
    loadReaderProgress: vi.fn<(stableId: string) => ReaderProgressState | null>(() => null),
    loadReaderSettings: vi.fn(),
    recordPtvEvent: vi.fn(),
    saveReaderProgress: vi.fn(),
    saveReaderSettings: vi.fn()
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: readerMocks.recordPtvEvent
}));

vi.mock('./readerRepository', () => ({
    loadReaderDocument: readerMocks.loadReaderDocument
}));

vi.mock('./readerProgressStore', () => ({
    addReaderBookmark: readerMocks.addReaderBookmark,
    loadReaderBookmarks: readerMocks.loadReaderBookmarks,
    loadReaderProgress: readerMocks.loadReaderProgress,
    saveReaderProgress: readerMocks.saveReaderProgress
}));

vi.mock('./readerSettingsStore', () => ({
    loadReaderSettings: readerMocks.loadReaderSettings,
    saveReaderSettings: readerMocks.saveReaderSettings
}));

vi.mock('./ReaderSettingsPanel', async () => {
    const { createElement } = await import('react');

    return {
        ReaderSettingsPanel: () => createElement('input', {
            'aria-label': 'Mock reader setting'
        })
    };
});

vi.mock('./ReaderView', async () => {
    const { createElement } = await import('react');

    return {
        ReaderView: ({ document, pageIndex, settings, zoom, onEffectiveScaleChange, onScaleApplyFailed }: MockReaderViewProps) => createElement(
            'div',
            {
                'data-direction': settings.direction,
                'data-format': document.format,
                'data-page-index': pageIndex,
                'data-testid': 'reader-view',
                'data-zoom-mode': zoom.mode,
                'data-zoom-scale': zoom.manualScale
            },
            createElement('button', {
                'aria-label': 'Mock scale success',
                onClick: () => onEffectiveScaleChange(0.75),
                type: 'button'
            }),
            createElement('button', {
                'aria-label': 'Mock scale failure',
                onClick: onScaleApplyFailed,
                type: 'button'
            })
        )
    };
});

import { ReaderApp } from './ReaderApp';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const BASE_SETTINGS: ReaderSettings = {
    brightness: 1,
    direction: 'ltr',
    fitMode: 'width',
    flow: 'paged',
    fontFamily: 'system',
    fontSize: 18,
    keepControlsVisible: false,
    lineHeight: 1.55,
    margin: 28,
    spreadMode: 'single',
    textAlign: 'left',
    theme: 'dark'
};

function source(format: ReaderFormat, stableId = `${format}-fixture`, direction: 'ltr' | 'rtl' = 'ltr'): ReaderSource {
    return {
        downloadUrl: `https://example.invalid/${stableId}.${format}`,
        format,
        item: {},
        itemId: stableId,
        metadata: {
            artists: [],
            authors: [ 'Piggie Author' ],
            fileExtension: format,
            fileFormat: format,
            genres: [],
            id: stableId,
            providerIds: {},
            readingDirection: direction,
            sourceLabel: 'Jellyfin',
            stableId,
            tags: [],
            title: `${format.toUpperCase()} fixture`
        },
        provider: 'jellyfin',
        supported: format !== 'unsupported'
    };
}

function documentFor(format: ReaderFormat): LoadedReaderDocument {
    return {
        chapters: [],
        comicPages: format === 'comic' ? [ 'page-1', 'page-2', 'page-3', 'page-4', 'page-5', 'page-6' ] : undefined,
        format,
        pageCount: format === 'epub' ? 0 : 6,
        title: `${format.toUpperCase()} fixture`
    };
}

function view(container: HTMLElement) {
    return container.querySelector<HTMLElement>('[data-testid="reader-view"]');
}

function button(container: HTMLElement, label: string) {
    return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

async function keyDown(target: EventTarget, key: string, options: KeyboardEventInit = {}) {
    await act(async () => {
        target.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key,
            ...options
        }));
        await Promise.resolve();
    });
}

describe('ReaderApp zoom and navigation orchestration', () => {
    let container: HTMLDivElement;
    let root: Root;

    const renderReader = async (readerSource: ReaderSource) => {
        await act(async () => {
            root.render(
                <ReaderApp
                    source={readerSource}
                    onClose={vi.fn()}
                    onProgress={vi.fn()}
                />
            );
            await Promise.resolve();
            await Promise.resolve();
        });

        await vi.waitFor(() => expect(view(container)).not.toBeNull());
    };

    const remountReader = async (readerSource: ReaderSource) => {
        act(() => root.unmount());
        root = createRoot(container);
        await renderReader(readerSource);
    };

    beforeEach(() => {
        clearReaderZoomSessionsForTests();
        readerMocks.loadReaderSettings.mockImplementation(() => ({ ...BASE_SETTINGS }));
        readerMocks.loadReaderProgress.mockReturnValue(null);
        readerMocks.loadReaderDocument.mockImplementation(
            (readerSource: ReaderSource) => Promise.resolve(documentFor(readerSource.format))
        );

        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.clearAllMocks();
    });

    it('handles +, =, -, and 0 as bounded reader zoom shortcuts', async () => {
        await renderReader(source('pdf'));

        await keyDown(document, '+');
        expect(view(container)?.dataset).toMatchObject({ zoomMode: 'manual', zoomScale: '1.1' });

        await keyDown(document, '=');
        expect(view(container)?.dataset.zoomScale).toBe('1.2');

        await keyDown(document, '-');
        expect(view(container)?.dataset.zoomScale).toBe('1.1');

        await keyDown(document, '0');
        expect(view(container)?.dataset).toMatchObject({ zoomMode: 'manual', zoomScale: '1' });
    });

    it('ignores reader shortcuts with modifiers or editable and button targets', async () => {
        await renderReader(source('pdf'));

        await keyDown(document, '+', { ctrlKey: true });
        await keyDown(document, '+', { metaKey: true });
        await keyDown(document, '+', { altKey: true });

        const input = document.createElement('input');
        const editable = document.createElement('div');
        editable.setAttribute('contenteditable', 'true');
        document.body.append(input, editable);

        await keyDown(input, '+');
        await keyDown(editable, '+');
        await keyDown(button(container, 'Next')!, '+');

        expect(view(container)?.dataset).toMatchObject({ zoomMode: 'fit-page', zoomScale: '1' });
        input.remove();
        editable.remove();
    });

    it('preserves manual zoom while arrow keys navigate pages', async () => {
        await renderReader(source('pdf'));
        await keyDown(document, '+');

        await keyDown(document, 'ArrowRight');
        expect(view(container)?.dataset).toMatchObject({ pageIndex: '1', zoomMode: 'manual', zoomScale: '1.1' });

        await keyDown(document, 'ArrowLeft');
        expect(view(container)?.dataset).toMatchObject({ pageIndex: '0', zoomMode: 'manual', zoomScale: '1.1' });
    });

    it('restores the last successfully applied zoom state after a renderer rejects a replacement', async () => {
        await renderReader(source('pdf'));
        await act(async () => button(container, 'Mock scale success')?.click());
        await act(async () => button(container, 'Zoom in')?.click());

        expect(view(container)?.dataset).toMatchObject({ zoomMode: 'manual', zoomScale: '0.85' });

        await act(async () => button(container, 'Mock scale failure')?.click());

        expect(view(container)?.dataset).toMatchObject({ zoomMode: 'fit-page', zoomScale: '1' });
        expect(button(container, 'Fit page')?.getAttribute('aria-pressed')).toBe('true');
    });

    it('retains fit mode through next/previous and a same-item app remount', async () => {
        const pdfSource = source('pdf', 'same-item');
        await renderReader(pdfSource);

        await act(async () => button(container, 'Fit width')?.click());
        await act(async () => button(container, 'Next')?.click());
        await act(async () => button(container, 'Previous')?.click());
        expect(view(container)?.dataset).toMatchObject({ pageIndex: '0', zoomMode: 'fit-width' });

        await remountReader(pdfSource);
        expect(view(container)?.dataset).toMatchObject({ pageIndex: '0', zoomMode: 'fit-width' });
        expect(button(container, 'Fit width')?.getAttribute('aria-pressed')).toBe('true');
    });

    it('adapts page-fit controls for PDF/comic and layout-safe text scaling for EPUB', async () => {
        for (const pageFormat of [ 'pdf', 'comic' ] as const) {
            await remountReader(source(pageFormat, `${pageFormat}-capabilities`));
            expect(view(container)?.dataset).toMatchObject({ format: pageFormat, zoomMode: 'fit-page' });
            expect(button(container, 'Fit page')).not.toBeNull();
            expect(button(container, 'Fit width')).not.toBeNull();
            expect(button(container, 'Zoom in')).not.toBeNull();
            expect(button(container, 'Zoom out')).not.toBeNull();
        }

        await remountReader(source('epub', 'epub-capabilities'));
        expect(view(container)?.dataset).toMatchObject({ format: 'epub', zoomMode: 'manual', zoomScale: '1' });
        expect(button(container, 'Zoom in')).not.toBeNull();
        expect(button(container, 'Zoom out')).not.toBeNull();
        expect(button(container, 'Fit page')).toBeNull();
        expect(button(container, 'Fit width')).toBeNull();
    });

    it('keeps RTL comic next/previous navigation directionally correct', async () => {
        readerMocks.loadReaderProgress.mockReturnValue({
            format: 'comic',
            pageCount: 6,
            pageIndex: 2,
            percent: 50,
            position: 'page:2',
            stableId: 'rtl-comic',
            updatedAt: 1
        });
        await renderReader(source('comic', 'rtl-comic', 'rtl'));

        await keyDown(document, 'ArrowRight');
        expect(view(container)?.dataset).toMatchObject({ direction: 'rtl', pageIndex: '1', zoomMode: 'fit-page' });

        await keyDown(document, 'ArrowLeft');
        expect(view(container)?.dataset).toMatchObject({ direction: 'rtl', pageIndex: '2', zoomMode: 'fit-page' });
    });
});
