/* eslint-disable @typescript-eslint/no-shadow, react/jsx-no-bind, sonarjs/prefer-read-only-props */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { redactPtvCoreText } from '../../core/diagnostics/redaction';
import { recordPtvEvent } from '../../core/observability';

import { ReaderProgress } from './ReaderProgress';
import { ReaderSettingsPanel } from './ReaderSettingsPanel';
import { ReaderToolbar } from './ReaderToolbar';
import { ReaderView, type ReaderNavigator } from './ReaderView';
import type {
    LoadedReaderDocument,
    ReaderBookmark,
    ReaderProgressState,
    ReaderSettings,
    ReaderSource,
    ReaderZoomState
} from './readerModels';
import { loadReaderDocument } from './readerRepository';
import { addReaderBookmark, loadReaderBookmarks, loadReaderProgress, saveReaderProgress } from './readerProgressStore';
import { loadReaderSettings, saveReaderSettings } from './readerSettingsStore';
import {
    getReaderZoomCapabilities,
    resetReaderZoom,
    setReaderFitMode,
    stepReaderZoom
} from './readerZoomModel';
import { loadReaderZoomSession, saveReaderZoomSession } from './readerZoomSessionStore';

interface ReaderAppProps {
    openedAt?: number;
    source: ReaderSource;
    onClose: () => void;
    onProgress: (percent: number) => void;
}

function progressFromSource(source: ReaderSource): ReaderProgressState {
    return loadReaderProgress(source.metadata.stableId, source.serverId) || {
        stableId: source.metadata.stableId,
        format: source.format,
        position: '',
        pageIndex: 0,
        pageCount: 0,
        percent: 0,
        updatedAt: Date.now()
    };
}

function openExternal(source: ReaderSource) {
    const url = source.externalUrl || source.downloadUrl;
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
}

type ReaderZoomShortcut = 'in' | 'out' | 'reset';

function getReaderZoomShortcut(event: KeyboardEvent): ReaderZoomShortcut | null {
    if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') return 'in';
    if (event.key === '-' || event.code === 'NumpadSubtract') return 'out';
    if (event.key === '0' || event.code === 'Numpad0') return 'reset';
    return null;
}

function getReaderNavigationShortcut(event: KeyboardEvent): 'next' | 'previous' | null {
    if (event.key === 'ArrowRight' || event.key === ' ') return 'next';
    if (event.key === 'ArrowLeft') return 'previous';
    return null;
}

export function ReaderApp({ openedAt, source, onClose, onProgress }: ReaderAppProps) {
    const [settings, setSettings] = useState<ReaderSettings>(() => ({
        ...loadReaderSettings(),
        direction: source.metadata.readingDirection || loadReaderSettings().direction
    }));
    const [readerDocument, setReaderDocument] = useState<LoadedReaderDocument | null>(null);
    const [loadError, setLoadError] = useState<string>('');
    const [loading, setLoading] = useState(source.supported);
    const [controlsVisible, setControlsVisible] = useState(true);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [pageIndex, setPageIndex] = useState(() => progressFromSource(source).pageIndex || 0);
    const [percent, setPercent] = useState(() => progressFromSource(source).percent || 0);
    const [position, setPosition] = useState(() => progressFromSource(source).position || '');
    const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>(() => loadReaderBookmarks(source.metadata.stableId, source.serverId));
    const [navigator, setNavigator] = useState<ReaderNavigator | null>(null);
    const [zoom, setZoom] = useState<ReaderZoomState>(() => loadReaderZoomSession(source.metadata.stableId, source.format));
    const [effectiveScale, setEffectiveScale] = useState(zoom.manualScale);
    const zoomStateRef = useRef(zoom);
    const lastAppliedZoomRef = useRef(zoom);
    const currentProgress = useMemo(() => progressFromSource(source), [source]);
    const zoomCapabilities = useMemo(() => getReaderZoomCapabilities(source.format), [source.format]);

    zoomStateRef.current = zoom;

    useEffect(() => {
        saveReaderSettings(settings);
    }, [settings]);

    useEffect(() => {
        saveReaderZoomSession(source.metadata.stableId, source.format, zoom);
    }, [source.format, source.metadata.stableId, zoom]);

    useEffect(() => {
        if (!source.supported) {
            setLoading(false);
            return undefined;
        }

        let cancelled = false;
        // The application boot path installs the AbortController polyfill for legacy WebViews.
        // eslint-disable-next-line compat/compat
        const abortController = typeof AbortController === 'function' ? new AbortController() : null;

        setLoading(true);
        setLoadError('');

        loadReaderDocument(source, {
            signal: abortController?.signal
        })
            .then(loadedDocument => {
                if (cancelled) {
                    loadedDocument.release?.();
                    return;
                }

                setReaderDocument(loadedDocument);
                setLoading(false);
                recordPtvEvent('render', 'firstPageRenderMs', {
                    firstPageRenderMs: Math.max(0, Math.round(performance.now() - (openedAt || performance.now()))),
                    format: loadedDocument.format,
                    pageCount: loadedDocument.pageCount,
                    title: loadedDocument.title
                });
            })
            .catch(error => {
                if (cancelled) return;
                const safeMessage = redactPtvCoreText(
                    error instanceof Error ? error.message : '',
                    500
                );

                setLoadError(safeMessage || 'PiggieTV Reader could not open this item.');
                setLoading(false);
            });

        return () => {
            cancelled = true;
            abortController?.abort();
        };
    }, [openedAt, source]);

    useEffect(() => () => {
        readerDocument?.release?.();
    }, [readerDocument]);

    const updateProgress = useCallback((nextPageIndex: number, position?: string, nextPercent?: number) => {
        const pageCount = readerDocument?.pageCount || 0;
        const normalizedPage = pageCount ? Math.max(0, Math.min(pageCount - 1, nextPageIndex)) : Math.max(0, nextPageIndex);
        const normalizedPercent = Math.max(0, Math.min(100, nextPercent ?? (pageCount ? ((normalizedPage + 1) / pageCount) * 100 : nextPageIndex)));

        setPageIndex(normalizedPage);
        setPercent(normalizedPercent);
        setPosition(position || `page:${normalizedPage}`);
        onProgress(normalizedPercent);
        saveReaderProgress({
            stableId: source.metadata.stableId,
            format: source.format,
            position: position || `page:${normalizedPage}`,
            pageIndex: normalizedPage,
            pageCount,
            percent: normalizedPercent,
            updatedAt: Date.now()
        }, source.serverId);
    }, [onProgress, readerDocument?.pageCount, source.format, source.metadata.stableId, source.serverId]);

    const goToPage = useCallback((nextPage: number) => {
        const count = readerDocument?.pageCount || 0;
        const next = count ? Math.max(0, Math.min(count - 1, nextPage)) : Math.max(0, nextPage);
        setPageIndex(next);
        updateProgress(next, `page:${next}`);
    }, [readerDocument?.pageCount, updateProgress]);

    const next = useCallback(() => {
        if (readerDocument?.format === 'epub') {
            settings.direction === 'rtl' ? navigator?.previous() : navigator?.next();
            return;
        }

        const step = readerDocument?.format === 'comic' && settings.spreadMode === 'double' ? 2 : 1;
        goToPage(settings.direction === 'rtl' ? pageIndex - step : pageIndex + step);
    }, [goToPage, navigator, pageIndex, readerDocument?.format, settings.direction, settings.spreadMode]);

    const previous = useCallback(() => {
        if (readerDocument?.format === 'epub') {
            settings.direction === 'rtl' ? navigator?.next() : navigator?.previous();
            return;
        }

        const step = readerDocument?.format === 'comic' && settings.spreadMode === 'double' ? 2 : 1;
        goToPage(settings.direction === 'rtl' ? pageIndex + step : pageIndex - step);
    }, [goToPage, navigator, pageIndex, readerDocument?.format, settings.direction, settings.spreadMode]);

    const applyZoom = useCallback((nextZoom: ReaderZoomState) => {
        if (
            nextZoom.mode === zoomStateRef.current.mode
            && Math.abs(nextZoom.manualScale - zoomStateRef.current.manualScale) < 0.001
        ) return;

        zoomStateRef.current = nextZoom;
        setZoom(nextZoom);
    }, []);

    const zoomIn = useCallback(() => {
        applyZoom(stepReaderZoom(source.format, zoomStateRef.current, effectiveScale, 1));
    }, [applyZoom, effectiveScale, source.format]);

    const zoomOut = useCallback(() => {
        applyZoom(stepReaderZoom(source.format, zoomStateRef.current, effectiveScale, -1));
    }, [applyZoom, effectiveScale, source.format]);

    const resetZoom = useCallback(() => {
        applyZoom(resetReaderZoom(source.format));
    }, [applyZoom, source.format]);

    const fitPage = useCallback(() => {
        applyZoom(setReaderFitMode(source.format, zoomStateRef.current, 'fit-page'));
    }, [applyZoom, source.format]);

    const fitWidth = useCallback(() => {
        applyZoom(setReaderFitMode(source.format, zoomStateRef.current, 'fit-width'));
    }, [applyZoom, source.format]);

    const updateEffectiveScale = useCallback((scale: number) => {
        if (!Number.isFinite(scale) || scale <= 0) return;
        lastAppliedZoomRef.current = zoomStateRef.current;
        setEffectiveScale(current => Math.abs(current - scale) < 0.001 ? current : scale);
    }, []);

    const handleScaleApplyFailed = useCallback(() => {
        const fallbackZoom = lastAppliedZoomRef.current;
        const currentZoom = zoomStateRef.current;

        if (
            fallbackZoom.mode === currentZoom.mode
            && Math.abs(fallbackZoom.manualScale - currentZoom.manualScale) < 0.001
        ) return;

        zoomStateRef.current = fallbackZoom;
        setZoom(fallbackZoom);
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                if (settingsOpen) setSettingsOpen(false);
                else if (controlsVisible) setControlsVisible(false);
                else onClose();
                return;
            }

            const target = event.target;
            if (target instanceof Element && target.closest('a, button, input, select, textarea, [contenteditable="true"]')) return;

            const navigationShortcut = getReaderNavigationShortcut(event);
            if (navigationShortcut) {
                event.preventDefault();
                if (navigationShortcut === 'next') next();
                else previous();
                return;
            }

            const zoomShortcut = getReaderZoomShortcut(event);
            if (!zoomShortcut) return;

            const zoomEnabled = {
                in: zoomCapabilities.canZoomIn,
                out: zoomCapabilities.canZoomOut,
                reset: zoomCapabilities.canResetZoom
            }[zoomShortcut];
            if (!zoomEnabled) return;

            event.preventDefault();
            ({
                in: zoomIn,
                out: zoomOut,
                reset: resetZoom
            })[zoomShortcut]();
        };

        window.document.addEventListener('keydown', onKeyDown);
        return () => window.document.removeEventListener('keydown', onKeyDown);
    }, [controlsVisible, next, onClose, previous, resetZoom, settingsOpen, zoomCapabilities, zoomIn, zoomOut]);

    const addBookmark = useCallback(() => {
        const nextBookmarks = addReaderBookmark({
            stableId: source.metadata.stableId,
            label: `${Math.round(percent)}%`,
            position: position || `page:${pageIndex}`,
            pageIndex,
            percent
        }, source.serverId);

        setBookmarks(nextBookmarks);
    }, [pageIndex, percent, position, source.metadata.stableId, source.serverId]);

    const jumpToBookmark = useCallback((bookmark: ReaderBookmark) => {
        if (readerDocument?.format === 'epub') {
            navigator?.jumpTo(bookmark.position);
        } else {
            goToPage(bookmark.pageIndex);
        }
    }, [goToPage, navigator, readerDocument?.format]);

    const toolbarZoom = useMemo(() => ({
        capabilities: zoomCapabilities,
        effectiveScale,
        state: zoom,
        onFitPage: fitPage,
        onFitWidth: fitWidth,
        onReset: resetZoom,
        onZoomIn: zoomIn,
        onZoomOut: zoomOut
    }), [effectiveScale, fitPage, fitWidth, resetZoom, zoom, zoomCapabilities, zoomIn, zoomOut]);

    if (!source.supported) {
        return (
            <div className={`ptv-reader ptv-reader--${settings.theme}`}>
                <div className='ptv-reader-unsupported'>
                    <p className='ptv-reader-kicker'>{source.metadata.sourceLabel}</p>
                    <h1>{source.metadata.title}</h1>
                    <p>{source.unsupportedReason || 'This format is not available in PiggieTV Reader yet.'}</p>
                    <div className='ptv-reader-actions'>
                        <button type='button' onClick={() => openExternal(source)}>Open externally</button>
                        <a href={source.downloadUrl} download>Download</a>
                        <button type='button' onClick={onClose}>Close</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`ptv-reader ptv-reader--${settings.theme}`} style={{ '--ptv-reader-brightness': settings.brightness } as React.CSSProperties}>
            {source.metadata.backdropUrl && <div className='ptv-reader-backdrop' style={{ backgroundImage: `url("${source.metadata.backdropUrl}")` }} />}

            <ReaderToolbar
                metadata={source.metadata}
                bookmarks={bookmarks}
                controlsVisible={controlsVisible || settings.keepControlsVisible}
                pageIndex={pageIndex}
                pageCount={readerDocument?.pageCount || 0}
                onBookmark={addBookmark}
                onClose={onClose}
                onNext={next}
                onPrevious={previous}
                onSettings={() => setSettingsOpen(value => !value)}
                onOpenExternal={() => openExternal(source)}
                onJumpToBookmark={jumpToBookmark}
                zoom={toolbarZoom}
            />

            {settingsOpen && (
                <ReaderSettingsPanel
                    format={readerDocument?.format || source.format}
                    settings={settings}
                    onChange={setSettings}
                />
            )}

            {loading && (
                <div className='ptv-reader-loading'>
                    <div className='ptv-reader-spinner' />
                    <span>Opening PiggieTV Reader</span>
                </div>
            )}

            {loadError && (
                <div className='ptv-reader-unsupported'>
                    <h1>Could not open this item</h1>
                    <p>{loadError}</p>
                    <div className='ptv-reader-actions'>
                        <button type='button' onClick={() => openExternal(source)}>Open externally</button>
                        <button type='button' onClick={onClose}>Close</button>
                    </div>
                </div>
            )}

            {readerDocument && !loadError && (
                <ReaderView
                    document={readerDocument}
                    progress={currentProgress}
                    settings={settings}
                    zoom={zoom}
                    pageIndex={pageIndex}
                    onEffectiveScaleChange={updateEffectiveScale}
                    onScaleApplyFailed={handleScaleApplyFailed}
                    onNavigate={updateProgress}
                    onNavigatorReady={setNavigator}
                    onToggleControls={() => setControlsVisible(value => !value)}
                />
            )}

            <ReaderProgress percent={percent} label={`${Math.round(percent)}%`} />
        </div>
    );
}

/* eslint-enable @typescript-eslint/no-shadow, react/jsx-no-bind, sonarjs/prefer-read-only-props */
