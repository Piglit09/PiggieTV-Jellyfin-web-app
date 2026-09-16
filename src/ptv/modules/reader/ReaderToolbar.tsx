/* eslint-disable react/jsx-no-bind, sonarjs/prefer-read-only-props */
import React from 'react';

import type {
    ReaderBookmark,
    ReaderMetadata,
    ReaderZoomCapabilities,
    ReaderZoomState
} from './readerModels';

export interface ReaderToolbarZoomProps {
    capabilities: ReaderZoomCapabilities;
    effectiveScale: number;
    state: ReaderZoomState;
    onFitPage: () => void;
    onFitWidth: () => void;
    onReset: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
}

interface ReaderToolbarProps {
    metadata: ReaderMetadata;
    bookmarks: ReaderBookmark[];
    controlsVisible: boolean;
    pageIndex: number;
    pageCount: number;
    onBookmark: () => void;
    onClose: () => void;
    onNext: () => void;
    onPrevious: () => void;
    onSettings: () => void;
    onOpenExternal: () => void;
    onJumpToBookmark: (bookmark: ReaderBookmark) => void;
    zoom: ReaderToolbarZoomProps;
}

type ReaderToolbarButtonProps = Readonly<{
    action: string;
    disabled?: boolean;
    glyph: string;
    label: string;
    onClick: () => void;
    pressed?: boolean;
}>;

function ReaderToolbarButton({
    action,
    disabled,
    glyph,
    label,
    onClick,
    pressed
}: ReaderToolbarButtonProps) {
    return (
        <button
            type='button'
            className={`ptv-reader-toolbar-button ptv-reader-toolbar-button--${action}`}
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            title={label}
            onClick={onClick}
        >
            <span className='ptv-reader-toolbar-button__glyph' aria-hidden='true'>{glyph}</span>
            <span className='ptv-reader-toolbar-button__label'>{label}</span>
        </button>
    );
}

export function ReaderToolbar({
    metadata,
    bookmarks,
    controlsVisible,
    pageIndex,
    pageCount,
    onBookmark,
    onClose,
    onNext,
    onPrevious,
    onSettings,
    onOpenExternal,
    onJumpToBookmark,
    zoom
}: ReaderToolbarProps) {
    const currentZoomPercent = Math.max(1, Math.round(zoom.effectiveScale * 100));
    const isAtMinimum = zoom.effectiveScale <= zoom.capabilities.minScale + 0.001;
    const isAtMaximum = zoom.effectiveScale >= zoom.capabilities.maxScale - 0.001;
    const isReset = zoom.state.mode === 'manual' && Math.abs(zoom.state.manualScale - 1) < 0.001;

    return (
        <div
            aria-hidden={!controlsVisible}
            className={`ptv-reader-toolbar ${controlsVisible ? 'is-visible' : ''}`}
        >
            <div className='ptv-reader-toolbar__top'>
                <ReaderToolbarButton action='close' glyph='X' label='Close' onClick={onClose} />
                <div className='ptv-reader-toolbar__title'>
                    <strong>{metadata.title}</strong>
                    <span>{metadata.authors.join(', ') || metadata.sourceLabel}</span>
                </div>
                <ReaderToolbarButton action='settings' glyph='Aa' label='Settings' onClick={onSettings} />
            </div>

            <div className='ptv-reader-toolbar__bottom'>
                <ReaderToolbarButton action='previous' glyph='<' label='Previous' onClick={onPrevious} />
                <span>{pageCount ? `${pageIndex + 1} / ${pageCount}` : metadata.fileExtension?.toUpperCase() || 'Reader'}</span>
                <ReaderToolbarButton action='next' glyph='>' label='Next' onClick={onNext} />
                {zoom.capabilities.kind !== 'none' && (
                    <div className='ptv-reader-toolbar__zoom' role='group' aria-label='Reader zoom controls'>
                        {zoom.capabilities.canZoomOut && (
                            <ReaderToolbarButton
                                action='zoom-out'
                                disabled={isAtMinimum}
                                glyph='−'
                                label='Zoom out'
                                onClick={zoom.onZoomOut}
                            />
                        )}
                        {zoom.capabilities.canResetZoom && (
                            <ReaderToolbarButton
                                action='reset-zoom'
                                disabled={isReset}
                                glyph={`${currentZoomPercent}%`}
                                label={`Reset zoom to 100%. Current zoom ${currentZoomPercent}%`}
                                onClick={zoom.onReset}
                            />
                        )}
                        {zoom.capabilities.canZoomIn && (
                            <ReaderToolbarButton
                                action='zoom-in'
                                disabled={isAtMaximum}
                                glyph='+'
                                label='Zoom in'
                                onClick={zoom.onZoomIn}
                            />
                        )}
                        {zoom.capabilities.canFitPage && (
                            <ReaderToolbarButton
                                action='fit-page'
                                glyph='Page'
                                label='Fit page'
                                onClick={zoom.onFitPage}
                                pressed={zoom.state.mode === 'fit-page'}
                            />
                        )}
                        {zoom.capabilities.canFitWidth && (
                            <ReaderToolbarButton
                                action='fit-width'
                                glyph='Width'
                                label='Fit width'
                                onClick={zoom.onFitWidth}
                                pressed={zoom.state.mode === 'fit-width'}
                            />
                        )}
                    </div>
                )}
                <ReaderToolbarButton action='bookmark' glyph='Mark' label='Bookmark' onClick={onBookmark} />
                <ReaderToolbarButton action='external' glyph='Out' label='Open externally' onClick={onOpenExternal} />
                {bookmarks.length > 0 && (
                    <select
                        aria-label='Bookmarks'
                        defaultValue=''
                        onChange={event => {
                            const bookmark = bookmarks.find(item => item.id === event.target.value);
                            if (bookmark) onJumpToBookmark(bookmark);
                            event.target.value = '';
                        }}
                    >
                        <option value=''>Bookmarks</option>
                        {bookmarks.map(bookmark => (
                            <option key={bookmark.id} value={bookmark.id}>{bookmark.label}</option>
                        ))}
                    </select>
                )}
            </div>
        </div>
    );
}

/* eslint-enable react/jsx-no-bind, sonarjs/prefer-read-only-props */
