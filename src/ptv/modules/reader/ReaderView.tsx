/* eslint-disable @typescript-eslint/no-explicit-any, jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions, no-nested-ternary, react/jsx-no-bind, sonarjs/no-nested-conditional, sonarjs/prefer-read-only-props */
import React, { useEffect, useMemo, useRef } from 'react';

import type { LoadedReaderDocument, ReaderProgressState, ReaderSettings } from './readerModels';

export interface ReaderNavigator {
    jumpTo: (position: string, pageIndex?: number) => void;
    next: () => void;
    previous: () => void;
}

interface ReaderViewProps {
    document: LoadedReaderDocument;
    progress: ReaderProgressState | null;
    settings: ReaderSettings;
    pageIndex: number;
    onNavigate: (pageIndex: number, position?: string, percent?: number) => void;
    onNavigatorReady: (navigator: ReaderNavigator | null) => void;
    onToggleControls: () => void;
}

function createReaderTheme(settings: ReaderSettings) {
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
            'font-size': `${settings.fontSize}px`,
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

function PdfPage({ document, pageIndex, settings }: { document: any; pageIndex: number; settings: ReaderSettings }) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function render() {
            const page = await document.getPage(pageIndex + 1);
            if (cancelled) return;

            const canvas = canvasRef.current;
            if (!canvas) return;

            const parent = canvas.parentElement;
            const bounds = parent?.getBoundingClientRect();
            const viewport = page.getViewport({ scale: 1 });
            const widthScale = ((bounds?.width || window.innerWidth) * 0.94) / viewport.width;
            const heightScale = ((bounds?.height || window.innerHeight) * 0.88) / viewport.height;
            const fitScale = settings.fitMode === 'height' ? heightScale : settings.fitMode === 'page' ? Math.min(widthScale, heightScale) : widthScale;
            const pixelRatio = window.devicePixelRatio || 1;
            const scaledViewport = page.getViewport({ scale: Math.max(0.2, fitScale) * pixelRatio });
            const displayViewport = page.getViewport({ scale: Math.max(0.2, fitScale) });
            const context = canvas.getContext('2d');

            canvas.width = scaledViewport.width;
            canvas.height = scaledViewport.height;
            canvas.style.width = `${displayViewport.width}px`;
            canvas.style.height = `${displayViewport.height}px`;

            if (!context) return;
            await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
        }

        render().catch(error => console.warn('[PiggieTV Reader] PDF page render failed', error));

        return () => {
            cancelled = true;
        };
    }, [document, pageIndex, settings.fitMode]);

    return <canvas ref={canvasRef} className='ptv-reader-pdf-page' />;
}

function EpubReader({ document, progress, settings, onNavigate, onNavigatorReady }: ReaderViewProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const renditionRef = useRef<any>(null);

    useEffect(() => {
        const book = document.epubBook;
        const container = containerRef.current;
        if (!book || !container) return undefined;

        container.innerHTML = '';

        const rendition = book.renderTo(container, {
            flow: settings.flow === 'continuous' ? 'scrolled-doc' : 'paginated',
            height: '100%',
            spread: 'none',
            width: '100%'
        });
        renditionRef.current = rendition;

        rendition.themes.register('ptv', createReaderTheme(settings));
        rendition.themes.select('ptv');

        const start = progress?.position?.startsWith('epub:') ? progress.position.slice(5) : undefined;

        Promise.resolve(book.locations?.generate?.(1200))
            .catch(() => undefined)
            .then(() => rendition.display(start))
            .catch(() => rendition.display());

        rendition.on('relocated', (location: any) => {
            const cfi = location?.start?.cfi || '';
            const percent = book.locations?.percentageFromCfi ? Math.round(book.locations.percentageFromCfi(cfi) * 10000) / 100 : 0;
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
            onNavigatorReady(null);
            rendition.destroy?.();
            renditionRef.current = null;
        };
    }, [document, onNavigate, onNavigatorReady, progress?.position, settings]);

    return <div ref={containerRef} className='ptv-reader-epub' />;
}

function ComicReader({
    document,
    pageIndex,
    settings,
    onNavigate
}: ReaderViewProps) {
    const pages = document.comicPages || [];
    const spread = settings.spreadMode === 'double' && pages[pageIndex + 1] ?
        [pages[pageIndex], pages[pageIndex + 1]] :
        [pages[pageIndex]];
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
            <div className='ptv-reader-comic ptv-reader-comic--continuous'>
                {nearbyPages.map(page => (
                    <img key={page.url} loading='lazy' src={page.url} alt={`Page ${page.index + 1}`} className={`ptv-reader-comic-page is-fit-${settings.fitMode}`} />
                ))}
            </div>
        );
    }

    return (
        <div className={`ptv-reader-comic is-${settings.spreadMode}`}>
            {spread.map((url, index) => (
                <img key={url} src={url} alt={`Page ${pageIndex + index + 1}`} className={`ptv-reader-comic-page is-fit-${settings.fitMode}`} />
            ))}
        </div>
    );
}

function PdfReader({ document, pageIndex, settings, onNavigate }: ReaderViewProps) {
    const nearbyPages = useMemo(() => {
        if (settings.flow !== 'continuous') return [pageIndex];

        const start = Math.max(0, pageIndex - 1);
        const end = Math.min(document.pageCount - 1, pageIndex + 4);
        const pages = [];

        for (let index = start; index <= end; index += 1) pages.push(index);

        return pages;
    }, [document.pageCount, pageIndex, settings.flow]);

    useEffect(() => {
        const percent = document.pageCount ? ((pageIndex + 1) / document.pageCount) * 100 : 0;
        onNavigate(pageIndex, `page:${pageIndex}`, percent);
    }, [document.pageCount, onNavigate, pageIndex]);

    return (
        <div className={`ptv-reader-pdf ${settings.flow === 'continuous' ? 'is-continuous' : ''}`}>
            {nearbyPages.map(index => (
                <PdfPage key={index} document={document.pdfDocument} pageIndex={index} settings={settings} />
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

/* eslint-enable @typescript-eslint/no-explicit-any, jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions, no-nested-ternary, react/jsx-no-bind, sonarjs/no-nested-conditional, sonarjs/prefer-read-only-props */
