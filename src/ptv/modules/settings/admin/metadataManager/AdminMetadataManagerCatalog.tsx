import React from 'react';

import PtvIcon from '../../../icons/PtvIcon';
import type { PtvIconName } from '../../../icons/iconRegistry';
import type {
    AdminMetadataCatalogItem,
    AdminMetadataCatalogPage,
    AdminMetadataCatalogRoot
} from './adminMetadataManagerModel';

/* eslint-disable react/jsx-no-bind */

type CatalogProps = Readonly<{
    error: boolean;
    imageUrl: (item: AdminMetadataCatalogItem) => string;
    loading: boolean;
    onBack: () => void;
    onLibraryChange: (libraryId: string) => void;
    onNextPage: () => void;
    onOpenFolder: (item: AdminMetadataCatalogItem) => void;
    onPreviousPage: () => void;
    onRetry: () => void;
    onSearchChange: (value: string) => void;
    onSelect: (item: AdminMetadataCatalogItem) => void;
    page: AdminMetadataCatalogPage | null;
    parentName: string;
    refreshing: boolean;
    roots: readonly AdminMetadataCatalogRoot[];
    search: string;
    selectedItemId: string;
    selectedLibraryId: string;
    showBack: boolean;
}>;

function itemIcon(type: string, isFolder: boolean): PtvIconName {
    if (isFolder) return 'folders';
    switch (type.toLowerCase()) {
        case 'movie':
        case 'trailer':
        case 'video':
        case 'musicvideo':
            return 'movies';
        case 'series':
        case 'season':
        case 'episode':
            return 'shows';
        case 'audio':
        case 'musicalbum':
        case 'musicartist':
            return 'music';
        case 'book':
        case 'audiobook':
            return 'books';
        case 'boxset':
            return 'collections';
        case 'playlist':
            return 'playlists';
        case 'photo':
        case 'photoalbum':
            return 'image';
        case 'person':
            return 'person';
        default:
            return 'metadata';
    }
}

function itemSubtitle(item: AdminMetadataCatalogItem) {
    const parts: string[] = [];
    if (item.productionYear) parts.push(String(item.productionYear));
    parts.push(item.type || (item.isFolder ? 'Folder' : 'Item'));
    return parts.join(' · ');
}

function CatalogSkeleton() {
    return (
        <div aria-label='Loading catalog' className='ptv-metadata-catalog-skeleton' role='status'>
            {Array.from({ length: 7 }, (_, index) => (
                <span aria-hidden='true' key={index} />
            ))}
            <span className='visually-hidden'>Loading catalog…</span>
        </div>
    );
}

export default function AdminMetadataManagerCatalog({
    error,
    imageUrl,
    loading,
    onBack,
    onLibraryChange,
    onNextPage,
    onOpenFolder,
    onPreviousPage,
    onRetry,
    onSearchChange,
    onSelect,
    page,
    parentName,
    refreshing,
    roots,
    search,
    selectedItemId,
    selectedLibraryId,
    showBack
}: CatalogProps) {
    const itemCount = page?.items.length || 0;
    const total = page?.totalRecordCount;
    const currentPage = page ? Math.floor(page.startIndex / page.limit) + 1 : 1;
    const pageCount = page && typeof total === 'number' ? Math.max(1, Math.ceil(total / page.limit)) : null;

    return (
        <section aria-label='Media catalog' className='ptv-metadata-catalog'>
            <div className='ptv-metadata-catalog-controls'>
                <label>
                    <span>Library</span>
                    <select
                        aria-label='Library'
                        disabled={!roots.length}
                        onChange={event => onLibraryChange(event.currentTarget.value)}
                        value={selectedLibraryId}
                    >
                        {!roots.length && <option value=''>No libraries available</option>}
                        {roots.map(root => <option key={root.id} value={root.id}>{root.name}</option>)}
                    </select>
                </label>
                <label className='ptv-metadata-search'>
                    <span className='visually-hidden'>Search media in the selected library</span>
                    <PtvIcon name='search' size='17px' />
                    <input
                        autoComplete='off'
                        onChange={event => onSearchChange(event.currentTarget.value)}
                        placeholder='Search media'
                        type='search'
                        value={search}
                    />
                </label>
                <div className='ptv-metadata-catalog-location'>
                    {showBack ? (
                        <button aria-label='Back one folder' onClick={onBack} type='button'>
                            <PtvIcon name='back' size='16px' />
                            Back
                        </button>
                    ) : <span />}
                    <strong title={parentName}>{search.trim() ? 'Search results' : parentName || 'Catalog'}</strong>
                    {refreshing && <small role='status'>Updating…</small>}
                </div>
            </div>

            <div aria-busy={loading || refreshing} className='ptv-metadata-catalog-list'>
                {loading && !page && <CatalogSkeleton />}
                {error && !page && (
                    <div className='ptv-metadata-inline-state' role='alert'>
                        <PtvIcon name='alerts' size='24px' />
                        <strong>Catalog unavailable</strong>
                        <p>Items in this library could not be loaded.</p>
                        <button onClick={onRetry} type='button'>Retry</button>
                    </div>
                )}
                {!loading && !error && page && itemCount === 0 && (
                    <div className='ptv-metadata-inline-state'>
                        <PtvIcon name='search' size='24px' />
                        <strong>{search.trim() ? `No items match “${search.trim()}”` : 'No items found'}</strong>
                        <p>{search.trim() ? 'Try a different title or clear the search.' : 'This location has no catalog items.'}</p>
                    </div>
                )}
                {page?.items.map(item => {
                    const url = imageUrl(item);
                    const selected = item.id === selectedItemId;
                    return (
                        <div className='ptv-metadata-catalog-row' data-selected={selected || undefined} key={item.id}>
                            <button
                                aria-current={selected ? 'true' : undefined}
                                className='ptv-metadata-catalog-select'
                                onClick={() => onSelect(item)}
                                type='button'
                            >
                                <span className='ptv-metadata-catalog-thumb'>
                                    {url ? <img alt='' loading='lazy' src={url} /> : <PtvIcon name={itemIcon(item.type, item.isFolder)} size='20px' />}
                                </span>
                                <span>
                                    <strong>{item.name}</strong>
                                    <small>{itemSubtitle(item)}</small>
                                </span>
                                {selected && <span className='visually-hidden'>Selected</span>}
                            </button>
                            {item.isFolder && (
                                <button
                                    aria-label={`Open ${item.name}`}
                                    className='ptv-metadata-folder-open'
                                    onClick={() => onOpenFolder(item)}
                                    title={`Browse ${item.name}`}
                                    type='button'
                                >
                                    <PtvIcon name='right' size='15px' />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            {page && itemCount > 0 && (
                <footer className='ptv-metadata-pagination'>
                    <button disabled={page.startIndex === 0} onClick={onPreviousPage} type='button'>
                        <PtvIcon name='back' size='14px' />
                        Previous
                    </button>
                    <span>
                        Page {currentPage}{pageCount ? ` of ${pageCount}` : ''}
                        {typeof total === 'number' && <small>{total} items</small>}
                    </span>
                    <button disabled={!page.hasNextPage} onClick={onNextPage} type='button'>
                        Next
                        <PtvIcon name='right' size='14px' />
                    </button>
                </footer>
            )}
        </section>
    );
}

/* eslint-enable react/jsx-no-bind */
