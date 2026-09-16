import React, { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { useApi } from '../../../../../hooks/useApi';
import PtvIcon from '../../../icons/PtvIcon';
import { selectAdminLibraries } from './adminLibrariesAdapters';
import type { AdminLibraryFilter, AdminLibrarySummary } from './adminLibrariesModel';
import { startAdminLibrariesScan } from './adminLibrariesService';
import {
    AdminLibraryBadge,
    AdminLibraryScanBadge,
    AdminLibraryTypeIcon,
    formatAdminLibraryFolderCount
} from './AdminLibraryPresentation';
import { useAdminLibraries } from './useAdminLibraries';

const AddAdminLibraryDialog = lazy(async () => {
    const module = await import('./AdminLibraryDialogs');
    return { default: module.AddAdminLibraryDialog };
});

/* eslint-disable react/jsx-no-bind, no-void, no-nested-ternary, sonarjs/cognitive-complexity, sonarjs/no-nested-conditional */

const FILTER_LABELS: Readonly<Record<AdminLibraryFilter, string>> = {
    all: 'All',
    books: 'Books',
    collections: 'Collections',
    'home-videos': 'Home Videos',
    mixed: 'Mixed',
    movies: 'Movies',
    music: 'Music',
    'music-videos': 'Music Videos',
    other: 'Other',
    shows: 'Shows'
};

function LibraryRow({ library }: Readonly<{ library: AdminLibrarySummary }>) {
    return (
        <article className='ptv-admin-library-row' data-library-kind={library.kind}>
            <div className='ptv-admin-library-identity'>
                <AdminLibraryTypeIcon icon={library.icon} />
                <span>
                    <strong>{library.name}</strong>
                    <small>{library.displayType}</small>
                </span>
            </div>
            <span className='ptv-admin-library-folders'>
                <strong>{formatAdminLibraryFolderCount(library.folderCount)}</strong>
                <small>{library.pathManagementSupported ? 'Media sources' : 'Managed by server'}</small>
            </span>
            <span className='ptv-admin-library-badges'>
                <AdminLibraryScanBadge progress={library.refreshProgress} state={library.scanState} />
                {library.warning && <AdminLibraryBadge tone='warning'>Needs attention</AdminLibraryBadge>}
            </span>
            {library.manageable ? (
                <Link
                    aria-label={`Manage ${library.name}`}
                    className='ptv-admin-library-button'
                    to={`/settings/admin/libraries/${encodeURIComponent(library.id!)}`}
                >
                    Manage
                </Link>
            ) : (
                <button aria-label={`${library.name} cannot be managed`} disabled type='button'>Unavailable</button>
            )}
        </article>
    );
}

function LibraryListSkeleton() {
    return (
        <div aria-label='Loading libraries' className='ptv-admin-libraries-list' role='status'>
            {Array.from({ length: 5 }, (_, index) => (
                <div className='ptv-admin-library-row is-skeleton' key={index}>
                    <span className='ptv-admin-library-skeleton-icon' />
                    <span className='ptv-admin-library-skeleton-block' />
                    <span className='ptv-admin-library-skeleton-block' />
                    <span className='ptv-admin-library-skeleton-block' />
                </div>
            ))}
        </div>
    );
}

export default function PtvAdminLibrariesPage() {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const navigate = useNavigate();
    const [ searchParams, setSearchParams ] = useSearchParams();
    const state = useAdminLibraries(api, apiClient);
    const [ query, setQuery ] = useState('');
    const [ filter, setFilter ] = useState<AdminLibraryFilter>('all');
    const [ scanBusy, setScanBusy ] = useState(false);
    const [ scanMessage, setScanMessage ] = useState('');
    const scanBusyRef = useRef(false);
    const addOpen = searchParams.get('action') === 'add';
    const availableFilters = useMemo(() => {
        const kinds = new Set(state.libraries.map(library => library.kind));
        return ([ 'all', ...Array.from(kinds) ] as AdminLibraryFilter[])
            .filter(kind => kind in FILTER_LABELS);
    }, [state.libraries]);
    const visibleLibraries = useMemo(() => selectAdminLibraries(state.libraries, {
        filter,
        query
    }), [filter, query, state.libraries]);
    const configuredLibraryPaths = useMemo(
        () => state.libraries.flatMap(library => library.locations),
        [state.libraries]
    );
    const openAdd = useCallback(() => setSearchParams({ action: 'add' }), [setSearchParams]);
    const closeAdd = useCallback(() => setSearchParams({}, { replace: true }), [setSearchParams]);
    const handleCreated = useCallback((libraryId: string | null) => {
        closeAdd();
        void state.invalidate();
        if (libraryId) navigate(`/settings/admin/libraries/${encodeURIComponent(libraryId)}`);
    }, [closeAdd, navigate, state]);
    const scanAll = useCallback(async () => {
        if (!api || scanBusyRef.current || scanBusy) return;
        scanBusyRef.current = true;
        setScanBusy(true);
        setScanMessage('');
        try {
            await startAdminLibrariesScan(api);
            setScanMessage('Library scan requested.');
            await state.refresh();
        } catch {
            setScanMessage('The library scan could not be started.');
        } finally {
            scanBusyRef.current = false;
            setScanBusy(false);
        }
    }, [api, scanBusy, state]);

    return (
        <section className='ptv-admin-libraries' data-testid='ptv-admin-libraries-list'>
            <header className='ptv-admin-libraries-header'>
                <div>
                    <h1>Libraries</h1>
                    <p>Manage media sources, scans and library behavior.</p>
                </div>
                <div className='ptv-admin-libraries-header-actions'>
                    <button
                        disabled={scanBusy || state.globalScanTask?.State === 'Running' || state.scanStatusError}
                        onClick={() => void scanAll()}
                        type='button'
                    >
                        <PtvIcon name='refresh' size='17px' />
                        {scanBusy || state.globalScanTask?.State === 'Running' ? 'Scanning…' : 'Scan All Libraries'}
                    </button>
                    <button className='is-primary' onClick={openAdd} type='button'>
                        <PtvIcon name='libraries' size='17px' />
                        Add Library
                    </button>
                </div>
            </header>

            <div className='ptv-admin-libraries-toolbar'>
                <label className='ptv-admin-library-search' htmlFor='ptv-admin-library-search'>
                    <PtvIcon name='search' size='18px' />
                    <input
                        aria-label='Search libraries'
                        id='ptv-admin-library-search'
                        onChange={event => setQuery(event.currentTarget.value)}
                        placeholder='Search libraries…'
                        type='search'
                        value={query}
                    />
                </label>
                <div aria-label='Filter libraries' className='ptv-admin-library-filter-group' role='group'>
                    {availableFilters.map(kind => (
                        <button
                            aria-pressed={filter === kind}
                            className='ptv-admin-library-filter'
                            key={kind}
                            onClick={() => setFilter(kind)}
                            type='button'
                        >
                            {FILTER_LABELS[kind]}
                        </button>
                    ))}
                </div>
                <span aria-live='polite' className='ptv-admin-libraries-count'>
                    {visibleLibraries.length} {visibleLibraries.length === 1 ? 'library' : 'libraries'}
                </span>
            </div>

            {state.scanStatusError && !state.listError && (
                <aside className='ptv-admin-libraries-notice' role='status'>
                    <PtvIcon name='alerts' size='21px' />
                    <div><strong>Scan status is unavailable</strong><p>Your libraries remain fully manageable.</p></div>
                </aside>
            )}
            {scanMessage && (
                <p aria-live='polite' className={`ptv-admin-library-status-message${/could not/i.test(scanMessage) ? ' is-error' : ' is-success'}`}>
                    {scanMessage}
                </p>
            )}

            {state.isInitialLoading ? <LibraryListSkeleton /> : state.listError ? (
                <div className='ptv-admin-libraries-error' role='alert'>
                    <PtvIcon name='alerts' size='30px' />
                    <h2>We couldn&apos;t load your libraries.</h2>
                    <p>Administration navigation remains available while you retry.</p>
                    <button onClick={() => void state.refresh()} type='button'>Retry libraries</button>
                </div>
            ) : visibleLibraries.length > 0 ? (
                <div className='ptv-admin-libraries-list'>
                    {visibleLibraries.map((library, index) => (
                        <LibraryRow key={library.id || `${library.name}:${index}`} library={library} />
                    ))}
                </div>
            ) : (
                <div className='ptv-admin-libraries-empty'>
                    <PtvIcon name='libraries' size='31px' />
                    <h2>{query || filter !== 'all' ? 'No libraries match this view.' : 'No libraries configured.'}</h2>
                    <p>{query || filter !== 'all' ? 'Try another search or filter.' : 'Add a library to connect media folders to PiggieTV.'}</p>
                </div>
            )}

            {addOpen && (
                <Suspense fallback={null}>
                    <AddAdminLibraryDialog
                        api={api}
                        apiClient={apiClient}
                        onClose={closeAdd}
                        onCreated={handleCreated}
                        open
                        suggestedPaths={configuredLibraryPaths}
                    />
                </Suspense>
            )}
        </section>
    );
}

/* eslint-enable react/jsx-no-bind, no-void, no-nested-ternary, sonarjs/cognitive-complexity, sonarjs/no-nested-conditional */
