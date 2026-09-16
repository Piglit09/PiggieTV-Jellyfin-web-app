/* eslint-disable @typescript-eslint/no-explicit-any, jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions, react/jsx-no-bind, sonarjs/prefer-read-only-props */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { ptvSafeConsole } from '../../core/safeConsole';
import type {
    LoadedReaderDocument,
    ReaderProgressState,
    ReaderSettings,
    ReaderZoomState
} from './readerModels';
import {
    resolveReaderScale,
    type ReaderViewportSize
} from './readerZoomModel';

export interface ReaderNavigator {
    jumpTo: (position: string, pageIndex?: number) => void;
    next: () => void;
    previous: () => void;
}

export interface ReaderViewProps {
    document: LoadedReaderDocument;
    progress: ReaderProgressState | null;
    settings: ReaderSettings;
    zoom: ReaderZoomState;
    pageIndex: number;
    onEffectiveScaleChange: (scale: number) => void;
    onScaleApplyFailed?: () => void;
    onNavigate: (pageIndex: number, position?: string, percent?: number) => void;
    onNavigatorReady: (navigator: ReaderNavigator | null) => void;
    onToggleControls: () => void;
}

const EMPTY_VIEWPORT: ReaderViewportSize = { height: 0, width: 0 };
const COMIC_SPREAD_GAP = 16;
const MAX_PDF_CANVAS_PIXELS = 4_000_000;
const MAX_PDF_PIXEL_RATIO = 2;

interface PendingPdfScrollRestore {
    frame: number;
    ratioX: number;
    ratioY: number;
    remainingPages: Set<number>;
}

interface PendingComicScrollRestore {
    frame: number;
    ratioX: number;
    ratioY: number;
    remainingPages: Set<string>;
}

export function resolvePdfPixelRatio(
    displayWidth: number,
    displayHeight: number,
    devicePixelRatio: number
): number {
    const displayPixels = Math.max(1, displayWidth * displayHeight);
    const pixelBudgetRatio = Math.sqrt(MAX_PDF_CANVAS_PIXELS / displayPixels);
    const preferredRatio = Math.max(1, Math.min(MAX_PDF_PIXEL_RATIO, devicePixelRatio || 1));

    return Math.min(preferredRatio, pixelBudgetRatio);
}

function useReaderViewportSize(containerRef: React.RefObject<HTMLElement>): ReaderViewportSize {
    const [viewport, setViewport] = useState<ReaderViewportSize>(EMPTY_VIEWPORT);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return undefined;

        const measure = () => {
            const bounds = container.getBoundingClientRect();
            const next = {
                height: Math.max(0, container.clientHeight || bounds.height),
                width: Math.max(0, container.clientWidth || bounds.width)
            };

            setViewport(current => (
                Math.abs(current.height - next.height) < 0.5
                && Math.abs(current.width - next.width) < 0.5
            ) ? current : next);
        };

        measure();
        // Legacy WebViews receive the ResizeObserver polyfill during application boot.
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;

        observer?.observe(container);
        window.addEventListener('resize', measure);

        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [containerRef]);

    return viewport;
}

type ReaderThemeSettings = Pick<
    ReaderSettings,
    'fontFamily' | 'lineHeight' | 'margin' | 'textAlign' | 'theme'
>;

function createReaderTheme(settings: ReaderThemeSettings) {
    const palette = {
        dark: { color: '#eef2ff', background: '#05020a' },
        oled: { color: '#f8fbff', background: '#000' },
        sepia: { color: '#2c1c11', background: '#ead6af' },
        day: { color: '#151219', background: '#fffaf3' }
    }[settings.theme];

    return {
        body: {
            ...palette,
            'font-family': settings.fontFamily === 'system' ? 'Noto Sans, Arial, sans-serif' : settings.fontFamily,
            'line-height': String(settings.lineHeight),
            'padding': `0 ${settings.margin}px`,
            'text-align': settings.textAlign
        },
        p: {
            'line-height': String(settings.lineHeight)
        },
        a: {
            color: '#27c8ff'
        }
    };
}

interface PdfPageProps {
    document: any;
    pageIndex: number;
    reportScale: boolean;
    viewport: ReaderViewportSize;
    zoom: ReaderZoomState;
    onEffectiveScaleChange: (scale: number) => void;
    onLayout?: (pageIndex: number) => void;
    onScaleApplyFailed?: () => void;
}

export function PdfPage({
    document,
    pageIndex,
    reportScale,
    viewport,
    zoom,
    onEffectiveScaleChange,
    onLayout,
    onScaleApplyFailed
}: PdfPageProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        let cancelled = false;
        let renderTask: any = null;

        async function render() {
            if (zoom.mode !== 'manual' && (viewport.width <= 0 || viewport.height <= 0)) return;

            const page = await document.getPage(pageIndex + 1);
            if (cancelled) return;

            const canvas = canvasRef.current;
            if (!canvas) return;

            const naturalViewport = page.getViewport({ scale: 1 });
            const effectiveScale = resolveReaderScale('pdf', zoom, viewport, {
                height: naturalViewport.height,
                width: naturalViewport.width
            });
            const displayViewport = page.getViewport({ scale: effectiveScale });
            const pixelRatio = resolvePdfPixelRatio(
                displayViewport.width,
                displayViewport.height,
                window.devicePixelRatio
            );
            const renderViewport = page.getViewport({ scale: effectiveScale * pixelRatio });
            const stagingCanvas = window.document.createElement('canvas');
            const stagingContext = stagingCanvas.getContext('2d');

            if (!stagingContext) throw new Error('PDF_CANVAS_CONTEXT_UNAVAILABLE');

            stagingCanvas.width = Math.max(1, Math.ceil(renderViewport.width));
            stagingCanvas.height = Math.max(1, Math.ceil(renderViewport.height));
            renderTask = page.render({ canvasContext: stagingContext, viewport: renderViewport });
            await renderTask.promise;
            if (cancelled || canvasRef.current !== canvas) return;

            const context = canvas.getContext('2d');
            if (!context) throw new Error('PDF_CANVAS_CONTEXT_UNAVAILABLE');

            canvas.width = stagingCanvas.width;
            canvas.height = stagingCanvas.height;
            canvas.style.width = `${displayViewport.width}px`;
            canvas.style.height = `${displayViewport.height}px`;
            context.drawImage(stagingCanvas, 0, 0);
            onLayout?.(pageIndex);

            if (reportScale) onEffectiveScaleChange(effectiveScale);
        }

        render().catch(error => {
            if (cancelled || error?.name === 'RenderingCancelledException') return;
            onLayout?.(pageIndex);
            if (reportScale) onScaleApplyFailed?.();
            ptvSafeConsole.warn('[PiggieTV Reader] PDF page render failed', error);
        });

        return () => {
            cancelled = true;
            renderTask?.cancel?.();
        };
    }, [document, onEffectiveScaleChange, onLayout, onScaleApplyFailed, pageIndex, reportScale, viewport, zoom]);

    return (
        <div className='ptv-reader-page-stage'>
            <canvas ref={canvasRef} className='ptv-reader-pdf-page' />
        </div>
    );
}

function EpubReader({
    document,
    progress,
    settings,
    zoom,
    onEffectiveScaleChange,
    onNavigate,
    onNavigatorReady
}: ReaderViewProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const renditionRef = useRef<any>(null);
    const currentPositionRef = useRef(progress?.position || '');
    const readerTheme = useMemo(() => createReaderTheme({
        fontFamily: settings.fontFamily,
        lineHeight: settings.lineHeight,
        margin: settings.margin,
        textAlign: settings.textAlign,
        theme: settings.theme
    }), [
        settings.fontFamily,
        settings.lineHeight,
        settings.margin,
        settings.textAlign,
        settings.theme
    ]);
    const textSize = settings.fontSize * zoom.manualScale;
    const latestReaderThemeRef = useRef(readerTheme);
    const latestTextSizeRef = useRef(textSize);

    latestReaderThemeRef.current = readerTheme;
    latestTextSizeRef.current = textSize;

    useEffect(() => {
        const book = document.epubBook;
        const container = containerRef.current;
        if (!book || !container) return undefined;

        let cancelled = false;

        container.innerHTML = '';

        const rendition = book.renderTo(container, {
            flow: settings.flow === 'continuous' ? 'scrolled-doc' : 'paginated',
            height: '100%',
            spread: 'none',
            width: '100%'
        });
        renditionRef.current = rendition;

        rendition.themes.register('ptv', latestReaderThemeRef.current);
        rendition.themes.select('ptv');
        rendition.themes.fontSize(`${latestTextSizeRef.current}px`);

        const startPosition = currentPositionRef.current;
        const start = startPosition.startsWith('epub:') ? startPosition.slice(5) : undefined;

        Promise.resolve(book.locations?.generate?.(1200))
            .catch(() => undefined)
            .then(() => cancelled ? undefined : rendition.display(start))
            .catch(() => cancelled ? undefined : rendition.display())
            .catch(error => {
                if (!cancelled) ptvSafeConsole.warn('[PiggieTV Reader] EPUB display failed', error);
            });

        rendition.on('relocated', (location: any) => {
            if (cancelled) return;
            const cfi = location?.start?.cfi || '';
            const percent = book.locations?.percentageFromCfi ? Math.round(book.locations.percentageFromCfi(cfi) * 10000) / 100 : 0;
            currentPositionRef.current = cfi ? `epub:${cfi}` : currentPositionRef.current;
            onNavigate(Math.round(percent), cfi ? `epub:${cfi}` : '', percent);
        });

        onNavigatorReady({
            jumpTo: position => {
                if (position.startsWith('epub:')) {
                    rendition.display(position.slice(5));
                }
            },
            next: () => rendition.next(),
            previous: () => rendition.prev()
        });

        return () => {
            cancelled = true;
            onNavigatorReady(null);
            rendition.destroy?.();
            renditionRef.current = null;
        };
    }, [document.epubBook, onNavigate, onNavigatorReady, settings.flow]);

    useEffect(() => {
        const rendition = renditionRef.current;
        if (!rendition) return;

        rendition.themes.register('ptv', readerTheme);
        rendition.themes.select('ptv');
    }, [readerTheme]);

    useEffect(() => {
        const rendition = renditionRef.current;
        if (!rendition) return;

        rendition.themes.fontSize(`${textSize}px`);
        onEffectiveScaleChange(zoom.manualScale);
    }, [onEffectiveScaleChange, textSize, zoom.manualScale]);

    return <div ref={containerRef} className='ptv-reader-epub' />;
}

interface ComicPageProps {
    alt: string;
    horizontalSlots: number;
    reportScale: boolean;
    src: string;
    viewport: ReaderViewportSize;
    zoom: ReaderZoomState;
    onBeforeLayout?: () => void;
    onEffectiveScaleChange: (scale: number) => void;
    onLayout?: (pageKey: string) => void;
}

export function ComicPage({
    alt,
    horizontalSlots,
    reportScale,
    src,
    viewport,
    zoom,
    onBeforeLayout,
    onEffectiveScaleChange,
    onLayout
}: ComicPageProps) {
    const imageRef = useRef<HTMLImageElement | null>(null);
    const [naturalSize, setNaturalSize] = useState({ height: 0, width: 0 });
    const [loadFailed, setLoadFailed] = useState(false);
    const adjustedViewport = horizontalSlots > 1 ? {
        ...viewport,
        width: Math.max(1, viewport.width - (COMIC_SPREAD_GAP * (horizontalSlots - 1)))
    } : viewport;
    const effectiveScale = resolveReaderScale('comic', zoom, adjustedViewport, naturalSize, horizontalSlots);
    const hasNaturalSize = naturalSize.height > 0 && naturalSize.width > 0;
    const previousEffectiveScaleRef = useRef(effectiveScale);

    useLayoutEffect(() => {
        const previousScale = previousEffectiveScaleRef.current;
        const image = imageRef.current;
        const scaleChanged = hasNaturalSize
            && zoom.mode === 'manual'
            && previousScale > 0
            && Math.abs(previousScale - effectiveScale) > 0.001;

        if (reportScale && scaleChanged) onBeforeLayout?.();

        if (image && hasNaturalSize) {
            image.style.height = `${naturalSize.height * effectiveScale}px`;
            image.style.width = `${naturalSize.width * effectiveScale}px`;
        }

        if (hasNaturalSize || loadFailed) onLayout?.(src);

        previousEffectiveScaleRef.current = effectiveScale;
    }, [
        effectiveScale,
        hasNaturalSize,
        loadFailed,
        naturalSize.height,
        naturalSize.width,
        onBeforeLayout,
        onLayout,
        reportScale,
        src,
        zoom.mode
    ]);

    useEffect(() => {
        if (reportScale && hasNaturalSize) onEffectiveScaleChange(effectiveScale);
    }, [effectiveScale, hasNaturalSize, onEffectiveScaleChange, reportScale]);

    return (
        <img
            ref={imageRef}
            alt={alt}
            className={`ptv-reader-comic-page is-zoom-${zoom.mode}`}
            decoding='async'
            draggable={false}
            src={src}
            onLoad={event => {
                const image = event.currentTarget;
                setLoadFailed(false);
                setNaturalSize({
                    height: image.naturalHeight,
                    width: image.naturalWidth
                });
            }}
            onError={() => setLoadFailed(true)}
        />
    );
}

function ComicReader({
    document,
    pageIndex,
    settings,
    zoom,
    onEffectiveScaleChange,
    onNavigate
}: ReaderViewProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const viewport = useReaderViewportSize(containerRef);
    const pages = useMemo(() => document.comicPages || [], [document.comicPages]);
    const spread = useMemo(() => (
        settings.spreadMode === 'double' && pages[pageIndex + 1] ?
            [pages[pageIndex], pages[pageIndex + 1]] :
            [pages[pageIndex]]
    ), [pageIndex, pages, settings.spreadMode]);
    const nearbyPages = useMemo(() => {
        const start = Math.max(0, pageIndex);
        const end = Math.min(pages.length - 1, pageIndex + 3);
        const nextPages = [];

        for (let index = start; index <= end; index += 1) {
            nextPages.push({
                index,
                url: pages[index]
            });
        }

        return nextPages;
    }, [pageIndex, pages]);

    const visiblePageKeys = useMemo(() => (
        settings.flow === 'continuous' ? nearbyPages.map(page => page.url) : spread
    ), [nearbyPages, settings.flow, spread]);
    const pendingScrollRestoreRef = useRef<PendingComicScrollRestore | null>(null);
    const previousPageSignatureRef = useRef('');

    const restorePendingScroll = useCallback((pending: PendingComicScrollRestore) => {
        if (pending.frame) window.cancelAnimationFrame(pending.frame);

        pending.frame = window.requestAnimationFrame(() => {
            const scrollHost = containerRef.current;
            if (!scrollHost || pendingScrollRestoreRef.current !== pending) return;

            scrollHost.scrollLeft = Math.max(0, (pending.ratioX * scrollHost.scrollWidth) - (scrollHost.clientWidth / 2));
            scrollHost.scrollTop = Math.max(0, (pending.ratioY * scrollHost.scrollHeight) - (scrollHost.clientHeight / 2));
            pendingScrollRestoreRef.current = null;
        });
    }, []);

    const beginComicLayout = useCallback(() => {
        if (pendingScrollRestoreRef.current) return;

        const scrollHost = containerRef.current;
        if (!scrollHost) return;

        const pending: PendingComicScrollRestore = {
            frame: 0,
            ratioX: (scrollHost.scrollLeft + (scrollHost.clientWidth / 2)) / Math.max(1, scrollHost.scrollWidth),
            ratioY: (scrollHost.scrollTop + (scrollHost.clientHeight / 2)) / Math.max(1, scrollHost.scrollHeight),
            remainingPages: new Set(visiblePageKeys)
        };

        pendingScrollRestoreRef.current = pending;
    }, [visiblePageKeys]);

    const onComicPageLayout = useCallback((pageKey: string) => {
        const pending = pendingScrollRestoreRef.current;
        if (!pending) return;

        pending.remainingPages.delete(pageKey);
        if (pending.remainingPages.size === 0) restorePendingScroll(pending);
    }, [restorePendingScroll]);

    useLayoutEffect(() => {
        const pageSignature = `${settings.flow}:${pageIndex}:${visiblePageKeys.join(',')}`;
        const pageChanged = previousPageSignatureRef.current
            && previousPageSignatureRef.current !== pageSignature;
        const pending = pendingScrollRestoreRef.current;

        previousPageSignatureRef.current = pageSignature;
        if ((!pageChanged && zoom.mode === 'manual') || !pending) return;

        if (pending.frame) window.cancelAnimationFrame(pending.frame);
        pendingScrollRestoreRef.current = null;
    }, [pageIndex, settings.flow, visiblePageKeys, zoom.mode]);

    useEffect(() => () => {
        const pending = pendingScrollRestoreRef.current;
        if (!pending) return;
        if (pending.frame) window.cancelAnimationFrame(pending.frame);
    }, []);

    useEffect(() => {
        const percent = pages.length ? ((pageIndex + 1) / pages.length) * 100 : 0;
        onNavigate(pageIndex, `page:${pageIndex}`, percent);
    }, [onNavigate, pageIndex, pages.length]);

    useEffect(() => {
        const preloaders = nearbyPages.slice(1).map(page => {
            const image = new Image();

            image.decoding = 'async';
            image.src = page.url;

            return image;
        });

        return () => {
            preloaders.forEach(image => {
                image.src = '';
            });
        };
    }, [nearbyPages]);

    if (settings.flow === 'continuous') {
        return (
            <div ref={containerRef} className={`ptv-reader-comic ptv-reader-comic--continuous is-zoom-${zoom.mode}`}>
                {nearbyPages.map((page, index) => (
                    <div key={page.url} className='ptv-reader-page-stage'>
                        <ComicPage
                            alt={`Page ${page.index + 1}`}
                            horizontalSlots={1}
                            reportScale={index === 0}
                            src={page.url}
                            viewport={viewport}
                            zoom={zoom}
                            onBeforeLayout={index === 0 ? beginComicLayout : undefined}
                            onEffectiveScaleChange={onEffectiveScaleChange}
                            onLayout={onComicPageLayout}
                        />
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div ref={containerRef} className={`ptv-reader-comic is-${settings.spreadMode} is-zoom-${zoom.mode}`}>
            <div className='ptv-reader-page-stage'>
                {spread.map((url, index) => (
                    <ComicPage
                        key={url}
                        alt={`Page ${pageIndex + index + 1}`}
                        horizontalSlots={spread.length}
                        reportScale={index === 0}
                        src={url}
                        viewport={viewport}
                        zoom={zoom}
                        onBeforeLayout={index === 0 ? beginComicLayout : undefined}
                        onEffectiveScaleChange={onEffectiveScaleChange}
                        onLayout={onComicPageLayout}
                    />
                ))}
            </div>
        </div>
    );
}

function PdfReader({
    document,
    pageIndex,
    settings,
    zoom,
    onEffectiveScaleChange,
    onNavigate,
    onScaleApplyFailed
}: ReaderViewProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const viewport = useReaderViewportSize(containerRef);
    const renderViewport = zoom.mode === 'manual' ? EMPTY_VIEWPORT : viewport;
    const pendingScrollRestoreRef = useRef<PendingPdfScrollRestore | null>(null);
    const previousZoomSignatureRef = useRef(`${zoom.mode}:${zoom.manualScale}`);
    const previousPageSignatureRef = useRef('');
    const nearbyPages = useMemo(() => {
        if (settings.flow !== 'continuous') return [pageIndex];

        const start = Math.max(0, pageIndex - 1);
        const end = Math.min(document.pageCount - 1, pageIndex + 1);
        const pages = [];

        for (let index = start; index <= end; index += 1) pages.push(index);

        return pages;
    }, [document.pageCount, pageIndex, settings.flow]);

    const restorePendingScroll = useCallback((pending: PendingPdfScrollRestore) => {
        if (pending.frame) window.cancelAnimationFrame(pending.frame);

        pending.frame = window.requestAnimationFrame(() => {
            const scrollHost = containerRef.current;
            if (!scrollHost || pendingScrollRestoreRef.current !== pending) return;

            scrollHost.scrollLeft = Math.max(0, (pending.ratioX * scrollHost.scrollWidth) - (scrollHost.clientWidth / 2));
            scrollHost.scrollTop = Math.max(0, (pending.ratioY * scrollHost.scrollHeight) - (scrollHost.clientHeight / 2));
            pendingScrollRestoreRef.current = null;
        });
    }, []);

    const onPageLayout = useCallback((laidOutPageIndex: number) => {
        const pending = pendingScrollRestoreRef.current;
        if (!pending) return;

        pending.remainingPages.delete(laidOutPageIndex);
        if (pending.remainingPages.size === 0) restorePendingScroll(pending);
    }, [restorePendingScroll]);

    useLayoutEffect(() => {
        const zoomSignature = `${zoom.mode}:${zoom.manualScale}`;
        const previousZoomSignature = previousZoomSignatureRef.current;
        const zoomChanged = zoomSignature !== previousZoomSignature;
        const pageSignature = `${settings.flow}:${pageIndex}:${nearbyPages.join(',')}`;
        const pageChanged = previousPageSignatureRef.current && previousPageSignatureRef.current !== pageSignature;
        const existingPending = pendingScrollRestoreRef.current;

        previousZoomSignatureRef.current = zoomSignature;
        previousPageSignatureRef.current = pageSignature;
        if ((pageChanged || (zoomChanged && zoom.mode !== 'manual')) && existingPending) {
            if (existingPending.frame) window.cancelAnimationFrame(existingPending.frame);
            pendingScrollRestoreRef.current = null;
        }
        if (!zoomChanged || zoom.mode !== 'manual') return;

        const scrollHost = containerRef.current;
        if (!scrollHost) return;

        const previousPending = pendingScrollRestoreRef.current;
        if (previousPending) {
            if (previousPending.frame) window.cancelAnimationFrame(previousPending.frame);
        }

        const pending: PendingPdfScrollRestore = {
            frame: 0,
            ratioX: (scrollHost.scrollLeft + (scrollHost.clientWidth / 2)) / Math.max(1, scrollHost.scrollWidth),
            ratioY: (scrollHost.scrollTop + (scrollHost.clientHeight / 2)) / Math.max(1, scrollHost.scrollHeight),
            remainingPages: new Set(nearbyPages)
        };

        pendingScrollRestoreRef.current = pending;
    }, [nearbyPages, pageIndex, settings.flow, zoom.manualScale, zoom.mode]);

    useEffect(() => () => {
        const pending = pendingScrollRestoreRef.current;
        if (!pending) return;
        if (pending.frame) window.cancelAnimationFrame(pending.frame);
    }, []);

    useEffect(() => {
        const percent = document.pageCount ? ((pageIndex + 1) / document.pageCount) * 100 : 0;
        onNavigate(pageIndex, `page:${pageIndex}`, percent);
    }, [document.pageCount, onNavigate, pageIndex]);

    return (
        <div ref={containerRef} className={`ptv-reader-pdf ${settings.flow === 'continuous' ? 'is-continuous' : ''} is-zoom-${zoom.mode}`}>
            {nearbyPages.map(index => (
                <PdfPage
                    key={index}
                    document={document.pdfDocument}
                    pageIndex={index}
                    reportScale={index === pageIndex}
                    viewport={renderViewport}
                    zoom={zoom}
                    onEffectiveScaleChange={onEffectiveScaleChange}
                    onLayout={onPageLayout}
                    onScaleApplyFailed={onScaleApplyFailed}
                />
            ))}
        </div>
    );
}

export function ReaderView(props: ReaderViewProps) {
    const { document, onToggleControls } = props;

    return (
        <main
            className={`ptv-reader-view is-${document.format}`}
            onClick={event => {
                const target = event.target as HTMLElement;
                if (target.closest('button, select, input, a')) return;
                onToggleControls();
            }}
        >
            {document.format === 'epub' && <EpubReader {...props} />}
            {document.format === 'pdf' && <PdfReader {...props} />}
            {document.format === 'comic' && <ComicReader {...props} />}
        </main>
    );
}

/* eslint-enable @typescript-eslint/no-explicit-any, jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions, react/jsx-no-bind, sonarjs/prefer-read-only-props */
