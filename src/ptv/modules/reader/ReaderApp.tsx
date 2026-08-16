/* eslint-disable @typescript-eslint/no-shadow, react/jsx-no-bind, sonarjs/prefer-read-only-props */
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { redactPtvCoreText } from '../../core/diagnostics/redaction';
import { recordPtvEvent } from '../../core/observability';

import { ReaderProgress } from './ReaderProgress';
import { ReaderSettingsPanel } from './ReaderSettingsPanel';
import { ReaderToolbar } from './ReaderToolbar';
import { ReaderView, type ReaderNavigator } from './ReaderView';
import type { LoadedReaderDocument, ReaderBookmark, ReaderProgressState, ReaderSettings, ReaderSource } from './readerModels';
import { loadReaderDocument } from './readerRepository';
import { addReaderBookmark, loadReaderBookmarks, loadReaderProgress, saveReaderProgress } from './readerProgressStore';
import { loadReaderSettings, saveReaderSettings } from './readerSettingsStore';

interface ReaderAppProps {
    openedAt?: number;
    source: ReaderSource;
    onClose: () => void;
    onProgress: (percent: number) => void;
}

function progressFromSource(source: ReaderSource): ReaderProgressState {
    return loadReaderProgress(source.metadata.stableId) || {
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
    const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>(() => loadReaderBookmarks(source.metadata.stableId));
    const [navigator, setNavigator] = useState<ReaderNavigator | null>(null);
    const currentProgress = useMemo(() => progressFromSource(source), [source]);

    useEffect(() => {
        saveReaderSettings(settings);
    }, [settings]);

    useEffect(() => {
        if (!source.supported) {
            setLoading(false);
            return undefined;
        }

        let cancelled = false;
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
        });
    }, [onProgress, readerDocument?.pageCount, source.format, source.metadata.stableId]);

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

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                if (settingsOpen) setSettingsOpen(false);
                else if (controlsVisible) setControlsVisible(false);
                else onClose();
            } else if (event.key === 'ArrowRight' || event.key === ' ') {
                event.preventDefault();
                next();
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                previous();
            }
        };

        window.document.addEventListener('keydown', onKeyDown);
        return () => window.document.removeEventListener('keydown', onKeyDown);
    }, [controlsVisible, next, onClose, previous, settingsOpen]);

    const addBookmark = useCallback(() => {
        const nextBookmarks = addReaderBookmark({
            stableId: source.metadata.stableId,
            label: `${Math.round(percent)}%`,
            position: position || `page:${pageIndex}`,
            pageIndex,
            percent
        });

        setBookmarks(nextBookmarks);
    }, [pageIndex, percent, position, source.metadata.stableId]);

    const jumpToBookmark = useCallback((bookmark: ReaderBookmark) => {
        if (readerDocument?.format === 'epub') {
            navigator?.jumpTo(bookmark.position);
        } else {
            goToPage(bookmark.pageIndex);
        }
    }, [goToPage, navigator, readerDocument?.format]);

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
            />

            {settingsOpen && <ReaderSettingsPanel settings={settings} onChange={setSettings} />}

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
                    pageIndex={pageIndex}
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
