/* eslint-disable react/jsx-no-bind, sonarjs/prefer-read-only-props */
import React from 'react';

import type { ReaderBookmark, ReaderMetadata } from './readerModels';

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
}

type ReaderToolbarButtonProps = Readonly<{
    action: string;
    glyph: string;
    label: string;
    onClick: () => void;
}>;

function ReaderToolbarButton({
    action,
    glyph,
    label,
    onClick
}: ReaderToolbarButtonProps) {
    return (
        <button
            type='button'
            className={`ptv-reader-toolbar-button ptv-reader-toolbar-button--${action}`}
            aria-label={label}
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
    onJumpToBookmark
}: ReaderToolbarProps) {
    return (
        <div className={`ptv-reader-toolbar ${controlsVisible ? 'is-visible' : ''}`}>
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
