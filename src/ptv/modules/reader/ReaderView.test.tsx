import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    LoadedReaderDocument,
    ReaderSettings,
    ReaderZoomState
} from './readerModels';
import { ComicPage, PdfPage, ReaderView, resolvePdfPixelRatio } from './ReaderView';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const BASE_SETTINGS: ReaderSettings = {
    brightness: 100,
    direction: 'ltr',
    fitMode: 'page',
    flow: 'paged',
    fontFamily: 'system',
    fontSize: 18,
    keepControlsVisible: false,
    lineHeight: 1.6,
    margin: 24,
    spreadMode: 'single',
    textAlign: 'left',
    theme: 'dark'
};

const VIEWPORT = {
    height: 600,
    width: 800
};

function zoom(mode: ReaderZoomState['mode'], manualScale = 1): ReaderZoomState {
    return { manualScale, mode };
}

function createPdfPage(
    width = 600,
    height = 900,
    renderPromise: Promise<unknown> = Promise.resolve()
) {
    const cancel = vi.fn();
    const page = {
        getViewport: vi.fn(({ scale }: { scale: number }) => ({
            height: height * scale,
            width: width * scale
        })),
        render: vi.fn(() => ({
            cancel,
            promise: renderPromise
        }))
    };

    return { cancel, page };
}

describe('ReaderView renderer scaling', () => {
    let container: HTMLDivElement;
    let root: Root;

    const render = async (element: React.ReactElement) => {
        await act(async () => {
            root.render(element);
            await Promise.resolve();
            await Promise.resolve();
        });
    };

    beforeEach(() => {
        vi.stubGlobal('devicePixelRatio', 2);
        vi.stubGlobal('ResizeObserver', class {
            observe() {
                // The focused page tests pass measured viewport bounds directly.
            }

            unobserve() {
                // Required by the ResizeObserver surface.
            }

            disconnect() {
                // Required by the ResizeObserver surface.
            }
        });
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
            .mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);

        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('bounds PDF backing resolution for extreme manual zoom and high-DPR displays', () => {
        const ratio = resolvePdfPixelRatio(2_448, 3_168, 3);

        expect(ratio).toBeLessThan(1.1);
        expect((2_448 * ratio) * (3_168 * ratio)).toBeLessThanOrEqual(4_000_001);
        expect(resolvePdfPixelRatio(400, 600, 3)).toBe(2);
    });

    it('renders PDF fit-page, fit-width, and manual scales with DPR only in the canvas backing store', async () => {
        const { page } = createPdfPage();
        const pdfDocument = { getPage: vi.fn().mockResolvedValue(page) };
        const onEffectiveScaleChange = vi.fn();

        await render(
            <PdfPage
                document={pdfDocument}
                pageIndex={0}
                reportScale
                viewport={VIEWPORT}
                zoom={zoom('fit-page')}
                onEffectiveScaleChange={onEffectiveScaleChange}
            />
        );

        const canvas = container.querySelector<HTMLCanvasElement>('canvas')!;

        await vi.waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));
        expect(onEffectiveScaleChange).toHaveBeenLastCalledWith(584 / 900);
        expect(canvas.style.width).toBe(`${600 * (584 / 900)}px`);
        expect(canvas.style.height).toBe('584px');
        expect(canvas.width).toBe(Math.ceil(600 * (584 / 900) * 2));
        expect(canvas.height).toBe(1168);

        await render(
            <PdfPage
                document={pdfDocument}
                pageIndex={0}
                reportScale
                viewport={VIEWPORT}
                zoom={zoom('fit-width')}
                onEffectiveScaleChange={onEffectiveScaleChange}
            />
        );

        await vi.waitFor(() => expect(page.render).toHaveBeenCalledTimes(2));
        expect(onEffectiveScaleChange).toHaveBeenLastCalledWith(784 / 600);
        expect(canvas.style.width).toBe('784px');
        expect(canvas.style.height).toBe('1176px');
        expect(canvas.width).toBe(1568);
        expect(canvas.height).toBe(2352);

        await render(
            <PdfPage
                document={pdfDocument}
                pageIndex={0}
                reportScale
                viewport={VIEWPORT}
                zoom={zoom('manual', 1.5)}
                onEffectiveScaleChange={onEffectiveScaleChange}
            />
        );

        await vi.waitFor(() => expect(page.render).toHaveBeenCalledTimes(3));
        expect(onEffectiveScaleChange).toHaveBeenLastCalledWith(1.5);
        expect(canvas.style.width).toBe('900px');
        expect(canvas.style.height).toBe('1350px');
        const manualPixelRatio = resolvePdfPixelRatio(900, 1350, 2);
        expect(canvas.width).toBe(Math.ceil(900 * manualPixelRatio));
        expect(canvas.height).toBe(Math.ceil(1350 * manualPixelRatio));
    });

    it('cancels an obsolete PDF render and ignores its eventual settlement', async () => {
        let settleFirstRender: (() => void) | undefined;
        const firstRenderPromise = new Promise<void>(resolve => {
            settleFirstRender = resolve;
        });
        const first = createPdfPage(600, 900, firstRenderPromise);
        const second = createPdfPage(600, 900);
        const pdfDocument = {
            getPage: vi.fn((pageNumber: number) => Promise.resolve(pageNumber === 1 ? first.page : second.page))
        };
        const onEffectiveScaleChange = vi.fn();

        await render(
            <PdfPage
                document={pdfDocument}
                pageIndex={0}
                reportScale
                viewport={VIEWPORT}
                zoom={zoom('manual')}
                onEffectiveScaleChange={onEffectiveScaleChange}
            />
        );
        await vi.waitFor(() => expect(first.page.render).toHaveBeenCalledTimes(1));

        await render(
            <PdfPage
                document={pdfDocument}
                pageIndex={1}
                reportScale
                viewport={VIEWPORT}
                zoom={zoom('manual', 1.2)}
                onEffectiveScaleChange={onEffectiveScaleChange}
            />
        );

        await vi.waitFor(() => expect(second.page.render).toHaveBeenCalledTimes(1));
        expect(first.cancel).toHaveBeenCalledTimes(1);
        expect(onEffectiveScaleChange).toHaveBeenCalledTimes(1);

        await act(async () => {
            settleFirstRender?.();
            await firstRenderPromise;
        });

        expect(onEffectiveScaleChange).toHaveBeenCalledTimes(1);
        expect(onEffectiveScaleChange).toHaveBeenLastCalledWith(1.2);
    });

    it('keeps the last valid PDF bitmap and scale when a replacement render fails', async () => {
        const firstCancel = vi.fn();
        const secondCancel = vi.fn();
        const page = {
            getViewport: vi.fn(({ scale }: { scale: number }) => ({
                height: 900 * scale,
                width: 600 * scale
            })),
            render: vi.fn()
                .mockImplementationOnce(() => ({ cancel: firstCancel, promise: Promise.resolve() }))
                .mockImplementationOnce(() => ({
                    cancel: secondCancel,
                    promise: Promise.reject(new Error('fixture render failure'))
                }))
        };
        const pdfDocument = { getPage: vi.fn().mockResolvedValue(page) };
        const onEffectiveScaleChange = vi.fn();
        const onLayout = vi.fn();
        const onScaleApplyFailed = vi.fn();

        await render(
            <PdfPage
                document={pdfDocument}
                pageIndex={0}
                reportScale
                viewport={VIEWPORT}
                zoom={zoom('manual')}
                onEffectiveScaleChange={onEffectiveScaleChange}
                onLayout={onLayout}
                onScaleApplyFailed={onScaleApplyFailed}
            />
        );

        const canvas = container.querySelector<HTMLCanvasElement>('canvas')!;

        await vi.waitFor(() => expect(canvas.style.width).toBe('600px'));
        expect(canvas.style.height).toBe('900px');
        expect(canvas.width).toBe(1200);
        expect(canvas.height).toBe(1800);
        expect(onEffectiveScaleChange).toHaveBeenCalledTimes(1);

        await render(
            <PdfPage
                document={pdfDocument}
                pageIndex={0}
                reportScale
                viewport={VIEWPORT}
                zoom={zoom('manual', 1.5)}
                onEffectiveScaleChange={onEffectiveScaleChange}
                onLayout={onLayout}
                onScaleApplyFailed={onScaleApplyFailed}
            />
        );

        await vi.waitFor(() => expect(page.render).toHaveBeenCalledTimes(2));
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(canvas.style.width).toBe('600px');
        expect(canvas.style.height).toBe('900px');
        expect(canvas.width).toBe(1200);
        expect(canvas.height).toBe(1800);
        expect(onEffectiveScaleChange).toHaveBeenCalledTimes(1);
        expect(onLayout).toHaveBeenCalledTimes(2);
        expect(onScaleApplyFailed).toHaveBeenCalledTimes(1);
    });

    it('settles PDF coordination and reports failure when no canvas context is available', async () => {
        vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);
        const { page } = createPdfPage();
        const pdfDocument = { getPage: vi.fn().mockResolvedValue(page) };
        const onLayout = vi.fn();
        const onScaleApplyFailed = vi.fn();

        await render(
            <PdfPage
                document={pdfDocument}
                pageIndex={0}
                reportScale
                viewport={VIEWPORT}
                zoom={zoom('manual')}
                onEffectiveScaleChange={vi.fn()}
                onLayout={onLayout}
                onScaleApplyFailed={onScaleApplyFailed}
            />
        );

        await vi.waitFor(() => expect(onScaleApplyFailed).toHaveBeenCalledTimes(1));
        expect(onLayout).toHaveBeenCalledWith(0);
        expect(page.render).not.toHaveBeenCalled();
    });

    it('bounds continuous PDF rendering to the previous, current, and next pages', async () => {
        const { page } = createPdfPage();
        const pdfDocument = { getPage: vi.fn().mockResolvedValue(page) };
        const readerDocument: LoadedReaderDocument = {
            chapters: [],
            format: 'pdf',
            pageCount: 10,
            pdfDocument,
            title: 'PDF fixture'
        };

        await render(
            <ReaderView
                document={readerDocument}
                pageIndex={5}
                progress={null}
                settings={{ ...BASE_SETTINGS, flow: 'continuous' }}
                zoom={zoom('manual')}
                onEffectiveScaleChange={vi.fn()}
                onNavigate={vi.fn()}
                onNavigatorReady={vi.fn()}
                onToggleControls={vi.fn()}
            />
        );

        await vi.waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledTimes(3));
        expect(pdfDocument.getPage.mock.calls.map(([ pageNumber ]) => pageNumber)).toEqual([ 5, 6, 7 ]);
    });

    it('updates EPUB native font scaling and theme without remounting its rendition or applying transforms', async () => {
        const themes = {
            fontSize: vi.fn(),
            register: vi.fn(),
            select: vi.fn()
        };
        const rendition = {
            destroy: vi.fn(),
            display: vi.fn().mockResolvedValue(undefined),
            next: vi.fn(),
            on: vi.fn(),
            prev: vi.fn(),
            themes
        };
        const book = {
            locations: {
                generate: vi.fn().mockResolvedValue(undefined),
                percentageFromCfi: vi.fn().mockReturnValue(0.25)
            },
            renderTo: vi.fn().mockReturnValue(rendition)
        };
        const readerDocument: LoadedReaderDocument = {
            chapters: [],
            epubBook: book,
            format: 'epub',
            pageCount: 0,
            title: 'EPUB fixture'
        };
        const onEffectiveScaleChange = vi.fn();
        const onNavigate = vi.fn();
        const onNavigatorReady = vi.fn();
        const onToggleControls = vi.fn();

        await render(
            <ReaderView
                document={readerDocument}
                pageIndex={0}
                progress={null}
                settings={BASE_SETTINGS}
                zoom={zoom('manual')}
                onEffectiveScaleChange={onEffectiveScaleChange}
                onNavigate={onNavigate}
                onNavigatorReady={onNavigatorReady}
                onToggleControls={onToggleControls}
            />
        );
        await vi.waitFor(() => expect(book.renderTo).toHaveBeenCalledTimes(1));

        await render(
            <ReaderView
                document={readerDocument}
                pageIndex={0}
                progress={null}
                settings={{ ...BASE_SETTINGS, theme: 'sepia' }}
                zoom={zoom('manual', 1.5)}
                onEffectiveScaleChange={onEffectiveScaleChange}
                onNavigate={onNavigate}
                onNavigatorReady={onNavigatorReady}
                onToggleControls={onToggleControls}
            />
        );

        expect(book.renderTo).toHaveBeenCalledTimes(1);
        expect(rendition.destroy).not.toHaveBeenCalled();
        expect(themes.fontSize).toHaveBeenLastCalledWith('27px');
        expect(themes.register).toHaveBeenLastCalledWith('ptv', expect.objectContaining({
            body: expect.objectContaining({
                background: '#ead6af'
            })
        }));
        expect(onEffectiveScaleChange).toHaveBeenLastCalledWith(1.5);
        expect(container.querySelector<HTMLElement>('.ptv-reader-epub')?.style.transform).toBe('');
    });

    it('sizes a comic from its natural dimensions across fit and manual zoom without replacing the page', async () => {
        const onEffectiveScaleChange = vi.fn();
        const onBeforeLayout = vi.fn();
        const onLayout = vi.fn();
        const source = 'data:image/png;base64,AAAA';

        await render(
            <ComicPage
                alt='Page 1'
                horizontalSlots={1}
                reportScale
                src={source}
                viewport={VIEWPORT}
                zoom={zoom('fit-page')}
                onBeforeLayout={onBeforeLayout}
                onEffectiveScaleChange={onEffectiveScaleChange}
                onLayout={onLayout}
            />
        );

        const image = container.querySelector<HTMLImageElement>('img')!;
        Object.defineProperties(image, {
            naturalHeight: { configurable: true, value: 1800 },
            naturalWidth: { configurable: true, value: 1200 }
        });
        await act(async () => image.dispatchEvent(new Event('load', { bubbles: true })));

        await vi.waitFor(() => expect(image.style.height).toBe('584px'));
        expect(Number.parseFloat(image.style.width)).toBeCloseTo(1200 * (584 / 1800), 5);
        expect(onEffectiveScaleChange).toHaveBeenLastCalledWith(584 / 1800);

        await render(
            <ComicPage
                alt='Page 1'
                horizontalSlots={1}
                reportScale
                src={source}
                viewport={VIEWPORT}
                zoom={zoom('fit-width')}
                onBeforeLayout={onBeforeLayout}
                onEffectiveScaleChange={onEffectiveScaleChange}
                onLayout={onLayout}
            />
        );

        const fitWidthImage = container.querySelector<HTMLImageElement>('img')!;
        expect(fitWidthImage).toBe(image);
        expect(fitWidthImage.getAttribute('src')).toBe(source);
        expect(fitWidthImage.style.width).toBe('784px');
        expect(fitWidthImage.style.height).toBe('1176px');

        await render(
            <ComicPage
                alt='Page 1'
                horizontalSlots={1}
                reportScale
                src={source}
                viewport={VIEWPORT}
                zoom={zoom('manual', 1.25)}
                onBeforeLayout={onBeforeLayout}
                onEffectiveScaleChange={onEffectiveScaleChange}
                onLayout={onLayout}
            />
        );

        const manualImage = container.querySelector<HTMLImageElement>('img')!;
        expect(manualImage).toBe(image);
        expect(manualImage.getAttribute('src')).toBe(source);
        expect(manualImage.style.width).toBe('1500px');
        expect(manualImage.style.height).toBe('2250px');
        expect(onEffectiveScaleChange).toHaveBeenLastCalledWith(1.25);
        expect(onBeforeLayout).toHaveBeenCalledTimes(1);
        expect(onLayout).toHaveBeenLastCalledWith(source);
    });

    it('settles comic layout only after an image loads or reaches a terminal error', async () => {
        const onLayout = vi.fn();
        const source = 'data:image/png;base64,BBBB';

        await render(
            <ComicPage
                alt='Page 2'
                horizontalSlots={1}
                reportScale
                src={source}
                viewport={VIEWPORT}
                zoom={zoom('manual')}
                onEffectiveScaleChange={vi.fn()}
                onLayout={onLayout}
            />
        );

        expect(onLayout).not.toHaveBeenCalled();
        const image = container.querySelector<HTMLImageElement>('img')!;
        await act(async () => image.dispatchEvent(new Event('error', { bubbles: true })));
        expect(onLayout).toHaveBeenCalledWith(source);
    });
});
