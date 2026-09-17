import React, { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useApi } from '../../../../../hooks/useApi';
import PtvIcon from '../../../icons/PtvIcon';
import { selectAdminActivityEntries } from './adminPeopleAdapters';
import type { AdminActivityView } from './adminPeopleService';
import { AdminActivityRow } from './AdminPeoplePresentation';
import { useAdminActivity } from './useAdminPeople';

const ACTIVITY_VIEW_LABELS: Readonly<Record<AdminActivityView, string>> = {
    all: 'All',
    user: 'User',
    system: 'System'
};

const ACTIVITY_VIEWS: readonly AdminActivityView[] = [ 'all', 'user', 'system' ];

function readActivityView(value: string | null): AdminActivityView {
    return value === 'user' || value === 'system' ? value : 'all';
}

function readActivityPage(value: string | null) {
    if (!value || !/^\d+$/.test(value)) return 0;
    const page = Number.parseInt(value, 10);
    return Number.isSafeInteger(page) && page > 0 ? page - 1 : 0;
}

function ActivityListSkeleton() {
    return (
        <div aria-label='Loading recent activity' className='ptv-admin-activity-list' role='status'>
            {Array.from({ length: 7 }, (_, index) => (
                <div className='ptv-admin-people-skeleton-row' key={index} />
            ))}
        </div>
    );
}

/* eslint-disable react/jsx-no-bind, no-void, no-nested-ternary, sonarjs/no-nested-conditional, sonarjs/cognitive-complexity, compat/compat */

export default function PtvAdminActivityPage() {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const [ searchParams, setSearchParams ] = useSearchParams();
    const view = readActivityView(searchParams.get('view'));
    const pageIndex = readActivityPage(searchParams.get('page'));
    const [ query, setQuery ] = useState('');
    const state = useAdminActivity(api, apiClient, { pageIndex, view });
    const visibleEntries = useMemo(() => selectAdminActivityEntries(state.entries, {
        query
    }), [query, state.entries]);
    const totalPages = state.totalCount === null ? null : Math.max(1, Math.ceil(state.totalCount / state.pageSize));
    const canPrevious = pageIndex > 0;
    const canNext = totalPages === null ? state.entries.length === state.pageSize : pageIndex + 1 < totalPages;
    const setRouteState = useCallback((nextView: AdminActivityView, nextPage: number) => {
        const params = new URLSearchParams();
        if (nextView !== 'all') params.set('view', nextView);
        if (nextPage > 0) params.set('page', String(nextPage + 1));
        setSearchParams(params);
    }, [setSearchParams]);
    const selectView = useCallback((nextView: AdminActivityView) => {
        setRouteState(nextView, 0);
    }, [setRouteState]);
    const goPrevious = useCallback(() => setRouteState(view, Math.max(0, pageIndex - 1)), [pageIndex, setRouteState, view]);
    const goNext = useCallback(() => setRouteState(view, pageIndex + 1), [pageIndex, setRouteState, view]);
    const pageDescription = totalPages === null ? `Page ${pageIndex + 1}` : `Page ${pageIndex + 1} of ${totalPages}`;

    return (
        <section className='ptv-admin-people' data-testid='ptv-admin-activity'>
            <header className='ptv-admin-people-header'>
                <div>
                    <h1>Activity</h1>
                    <p>Review recent PiggieTV server and account activity.</p>
                </div>
                <button
                    aria-busy={state.refreshing}
                    disabled={state.refreshing}
                    onClick={() => void state.refresh()}
                    type='button'
                >
                    <PtvIcon name='refresh' size='17px' />
                    {state.refreshing ? 'Refreshing…' : 'Refresh'}
                </button>
            </header>

            <div className='ptv-admin-people-toolbar'>
                <label className='ptv-admin-people-search' htmlFor='ptv-admin-activity-search'>
                    <PtvIcon name='search' size='18px' />
                    <input
                        aria-label='Search loaded activity entries'
                        aria-describedby='ptv-admin-activity-search-scope'
                        id='ptv-admin-activity-search'
                        onChange={event => setQuery(event.currentTarget.value)}
                        placeholder='Search this page…'
                        type='search'
                        value={query}
                    />
                </label>
                <div aria-label='Filter server activity' className='ptv-admin-people-filters' role='group'>
                    {ACTIVITY_VIEWS.map(value => (
                        <button
                            aria-pressed={view === value}
                            className='ptv-admin-people-filter'
                            key={value}
                            onClick={() => selectView(value)}
                            type='button'
                        >
                            {ACTIVITY_VIEW_LABELS[value]}
                        </button>
                    ))}
                </div>
                <span aria-live='polite' className='ptv-admin-people-result-count'>
                    {visibleEntries.length} shown · {state.totalCount === null ? 'total unavailable' : `${state.totalCount} total`}
                </span>
                <p className='ptv-admin-people-search-scope' id='ptv-admin-activity-search-scope'>
                    Search filters only the {state.pageSize} or fewer entries loaded on this page. All, User and System filters are server-wide.
                </p>
            </div>

            {state.usersError && !state.error ? (
                <aside className='ptv-admin-people-notice' role='status'>
                    <PtvIcon name='users' size='21px' />
                    <div>
                        <strong>Current user names are unavailable</strong>
                        <p>Authoritative event text and paging remain available. User links are withheld until mapping returns.</p>
                    </div>
                </aside>
            ) : null}

            {state.initialLoading ? <ActivityListSkeleton /> : state.error ? (
                <div className='ptv-admin-people-error' role='alert'>
                    <PtvIcon name='alerts' size='31px' />
                    <h2>Activity couldn&apos;t be loaded.</h2>
                    <p>The page was not mistaken for an empty history.</p>
                    <button onClick={() => void state.refresh()} type='button'>Retry activity</button>
                </div>
            ) : visibleEntries.length > 0 ? (
                <div className='ptv-admin-activity-list'>
                    {visibleEntries.map((entry, index) => (
                        <AdminActivityRow key={entry.id || `${entry.createdAt}:${entry.type}:${index}`} entry={entry} />
                    ))}
                </div>
            ) : (
                <div className='ptv-admin-people-empty'>
                    <PtvIcon name='activity' size='31px' />
                    <h2>{query ? 'No activity matches this page search.' : 'No activity entries found.'}</h2>
                    <p>{query ? 'Clear the search or move to another page.' : 'Try another activity filter or refresh.'}</p>
                </div>
            )}

            {!state.error && !state.initialLoading ? (
                <nav aria-label='Activity pages' className='ptv-admin-activity-pagination'>
                    <button disabled={!canPrevious || state.refreshing} onClick={goPrevious} type='button'>Previous</button>
                    <span aria-live='polite'>{pageDescription}</span>
                    <button disabled={!canNext || state.refreshing} onClick={goNext} type='button'>Next</button>
                </nav>
            ) : null}
        </section>
    );
}

/* eslint-enable react/jsx-no-bind, no-void, no-nested-ternary, sonarjs/no-nested-conditional, sonarjs/cognitive-complexity, compat/compat */
