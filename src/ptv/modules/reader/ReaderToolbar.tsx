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
                <button type='button' onClick={onClose}>Close</button>
                <div className='ptv-reader-toolbar__title'>
                    <strong>{metadata.title}</strong>
                    <span>{metadata.authors.join(', ') || metadata.sourceLabel}</span>
                </div>
                <button type='button' onClick={onSettings}>Settings</button>
            </div>

            <div className='ptv-reader-toolbar__bottom'>
                <button type='button' onClick={onPrevious}>Previous</button>
                <span>{pageCount ? `${pageIndex + 1} / ${pageCount}` : metadata.fileExtension?.toUpperCase() || 'Reader'}</span>
                <button type='button' onClick={onNext}>Next</button>
                <button type='button' onClick={onBookmark}>Bookmark</button>
                <button type='button' onClick={onOpenExternal}>Open externally</button>
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
