import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import Page from 'components/Page';
import toast from 'components/toast/toast';

import {
    getPtvCurrentUserId,
    getPtvItem,
    getPtvItemImageCandidates,
    getPtvItemImageUrl,
    getPtvServerId,
    markPtvImageCandidateFailed,
    type PtvItem,
    type PtvUser
} from '../../api';
import { createPtvAbortController } from '../../core/abortController';
import { createPtvRetryGate } from '../../core/retryGate';
import { getPtvClientProfile, getPtvPerformanceProfile } from '../../core/clientProfile';
import { PTV_BRANDING, PTV_ROUTES } from '../../core/config';
import { resolvePtvItemRoute } from '../../core/itemRoutes';
import { recordPtvEvent } from '../../core/observability';
import {
    getPtvQualityPillClass,
    getPtvQualityTags
} from '../../modules/cards/qualityTags';
import { showPtvItemActionMenu } from '../../modules/cards/itemActionMenu';
import { PtvIcon } from '../../modules/icons';
import { getPtvMusicSearchActionMenuExtension } from '../../modules/music/musicSearchItemActions';
import PTVShell from '../../shell/PTVShell';
import { registerPtvNativeRoute } from '../../shell/routeController';
import { usePtvAdminDebugVisibility } from '../../utils/usePtvAdminDebugVisibility';
import { type PtvLibraryRootDiagnostics } from '../../services/libraryRootNormalizer';
import { createPtvSearchRecoveryDiagnostics, type PtvSearchRecoveryDiagnostics } from '../../services/searchRecovery';
import { activateNativeSearchCard } from './nativeSearchDetailsNavigation';
import {
    clearPtvRecentSearches,
    getPtvSearchHistoryKey,
    loadPtvRecentSearches,
    savePtvRecentSearch
} from './nativeSearchHistory';
import {
    buildPtvSearchParams,
    getPtvSearchFilterConfig,
    getPtvSearchPresentation,
    normalizePtvSearchFilter,
    PTV_SEARCH_FILTERS,
    serializePtvSearchParams,
    type PtvSearchFilterId,
    type PtvSearchGroupId,
    type PtvSearchGroupStatus,
    type PtvSearchPresentation
} from './nativeSearchState';
import { PtvSearchActionLifecycle } from './nativeSearchActionLifecycle';
import {
    getPtvSearchHintFailureKind,
    searchPtvHints,
    type PtvGroupedSearchHints
} from './searchHintService';
import { useNativeSearchCurrentUser } from './useNativeSearchCurrentUser';
import { usePtvAuthenticatedIdentity } from '../../api/usePtvAuthenticatedIdentity';

import './nativeSearch.scss';

type PtvSearchGroupConfig = Readonly<{
    id: PtvSearchGroupId;
    includeItemTypes: string;
    kicker: string;
    priority: 1 | 2 | 3;
    title: string;
}>;

type PtvSearchGroupState = Readonly<{
    deduplicatedCount: number;
    durationMs: number;
    endpointPath: string;
    error: string;
    items: PtvItem[];
    libraryRoots: PtvLibraryRootDiagnostics['groups'];
    searchRecovery: PtvSearchRecoveryDiagnostics;
    requestUrl: string;
    status: PtvSearchGroupStatus;
    timeoutReason: string;
}>;

type PtvSearchCacheEntry = Readonly<{
    groups: Record<PtvSearchGroupId, PtvSearchGroupState>;
    query: string;
    updatedAt: number;
}>;

const PTV_SEARCH_DEBOUNCE_MS = 300;
const PTV_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const PTV_SEARCH_CACHE_LIMIT = 24;
const PTV_SEARCH_RESULT_LIMIT = 14;
const PTV_SEARCH_HINT_TIMEOUT_MS = 9000;
const PTV_SEARCH_GROUPS: readonly PtvSearchGroupConfig[] = [
    { id: 'movies', title: 'Movies', kicker: 'Film results', includeItemTypes: 'Movie', priority: 1 },
    { id: 'shows', title: 'Shows', kicker: 'Series results', includeItemTypes: 'Series', priority: 1 },
    { id: 'collections', title: 'Collections', kicker: 'Collections', includeItemTypes: 'BoxSet', priority: 1 },
    { id: 'episodes', title: 'Episodes', kicker: 'Episode results', includeItemTypes: 'Episode', priority: 2 },
    { id: 'people', title: 'People', kicker: 'Cast and creators', includeItemTypes: 'Person', priority: 2 },
    { id: 'reading', title: 'Reading', kicker: 'Books, comics, manga', includeItemTypes: 'Book', priority: 2 },
    { id: 'music', title: 'Songs', kicker: 'Music results', includeItemTypes: 'Audio', priority: 3 },
    { id: 'albums', title: 'Albums', kicker: 'Music albums', includeItemTypes: 'MusicAlbum', priority: 3 },
    { id: 'artists', title: 'Artists', kicker: 'Music artists', includeItemTypes: 'MusicArtist', priority: 3 }
];
const PTV_SEARCH_SKELETON_KEYS = [
    'search-skeleton-1',
    'search-skeleton-2',
    'search-skeleton-3',
    'search-skeleton-4',
    'search-skeleton-5',
    'search-skeleton-6'
];

const searchCache = new Map<string, PtvSearchCacheEntry>();

function getEmptyGroupState(status: PtvSearchGroupStatus = 'idle'): PtvSearchGroupState {
    return {
        deduplicatedCount: 0,
        durationMs: 0,
        endpointPath: '',
        error: '',
        items: [],
        libraryRoots: [],
        searchRecovery: createPtvSearchRecoveryDiagnostics(),
        requestUrl: '',
        status,
        timeoutReason: ''
    };
}

function getInitialGroups(status: PtvSearchGroupStatus = 'idle') {
    return PTV_SEARCH_GROUPS.reduce<Record<PtvSearchGroupId, PtvSearchGroupState>>((groups, group) => {
        groups[group.id] = getEmptyGroupState(status);
        return groups;
    }, {} as Record<PtvSearchGroupId, PtvSearchGroupState>);
}

function getText(value: unknown) {
    return typeof value === 'string' ? value : '';
}

function getNumber(value: unknown) {
    const parsed = typeof value === 'number' ? value : Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
}

function getArrayText(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return value
        .map(entry => typeof entry === 'string' ? entry : '')
        .filter(Boolean);
}

function getSearchCacheKey(
    query: string,
    filter: PtvSearchFilterId,
    serverId: string,
    userId: string
) {
    if (!serverId || !userId) return null;

    return [
        encodeURIComponent(serverId),
        encodeURIComponent(userId),
        filter,
        query.trim().toLowerCase()
    ].join(':');
}

function isSearchCacheable(groups: Record<PtvSearchGroupId, PtvSearchGroupState>) {
    return PTV_SEARCH_GROUPS.every(group => {
        const status = groups[group.id].status;

        return status === 'success' || status === 'empty';
    });
}

function rememberSearchCache(key: string, entry: PtvSearchCacheEntry) {
    searchCache.set(key, entry);

    while (searchCache.size > PTV_SEARCH_CACHE_LIMIT) {
        const oldestKey = searchCache.keys().next().value as string | undefined;

        if (!oldestKey) break;
        searchCache.delete(oldestKey);
    }
}

function getSearchCache(key: string) {
    const cached = searchCache.get(key);

    if (!cached) return null;
    if (Date.now() - cached.updatedAt > PTV_SEARCH_CACHE_TTL_MS) {
        searchCache.delete(key);
        return null;
    }

    return cached;
}

function getLoadingGroups() {
    return PTV_SEARCH_GROUPS.reduce<Record<PtvSearchGroupId, PtvSearchGroupState>>((groups, group) => {
        groups[group.id] = {
            ...getEmptyGroupState('loading'),
            endpointPath: 'Search/Hints'
        };
        return groups;
    }, {} as Record<PtvSearchGroupId, PtvSearchGroupState>);
}

function getSettledHintGroups(
    groupedHints: PtvGroupedSearchHints,
    durationMs: number
) {
    return PTV_SEARCH_GROUPS.reduce<Record<PtvSearchGroupId, PtvSearchGroupState>>((groups, group) => {
        const items = groupedHints[group.id];

        groups[group.id] = {
            ...getEmptyGroupState(items.length ? 'success' : 'empty'),
            durationMs,
            endpointPath: 'Search/Hints',
            items
        };
        return groups;
    }, {} as Record<PtvSearchGroupId, PtvSearchGroupState>);
}

function getFailedHintGroups(
    durationMs: number,
    error: string,
    failureKind: 'error' | 'timeout'
) {
    return PTV_SEARCH_GROUPS.reduce<Record<PtvSearchGroupId, PtvSearchGroupState>>((groups, group) => {
        groups[group.id] = {
            ...getEmptyGroupState(failureKind),
            durationMs,
            endpointPath: 'Search/Hints',
            error,
            searchRecovery: createPtvSearchRecoveryDiagnostics({
                primaryError: error,
                primaryStatus: failureKind,
                recoveryReason: failureKind === 'timeout' ? 'primary-timeout' : 'primary-error',
                timeoutOrAbort: failureKind === 'timeout' ? 'timeout' : 'none'
            }),
            timeoutReason: failureKind === 'timeout' ? error : ''
        };
        return groups;
    }, {} as Record<PtvSearchGroupId, PtvSearchGroupState>);
}

function getSearchItemTitle(item: PtvItem) {
    return getText(item.Name) || getText(item.SeriesName) || 'Untitled';
}

function getSearchItemYear(item: PtvItem) {
    const year = getNumber(item.ProductionYear);

    if (year) return String(year);

    return getText(item.PremiereDate).slice(0, 4);
}

function getSearchItemMeta(item: PtvItem) {
    return [
        getSearchItemYear(item),
        getText(item.Type),
        getText(item.OfficialRating)
    ].filter(Boolean).join(' | ');
}

function getSearchItemImageCandidates(item: PtvItem, serverId: string) {
    return getPtvItemImageCandidates(item, {
        baseOptions: {
            fillHeight: 480,
            fillWidth: 320,
            quality: 88,
            serverId
        },
        includeBackdrop: false,
        includeParentPrimary: false,
        includeSeriesPrimary: false,
        includeUntagged: false,
        order: ['Primary', 'Thumb']
    });
}

function getSearchItemBackdrop(item: PtvItem) {
    const performanceProfile = getPtvPerformanceProfile();
    const tag = getArrayText(item.BackdropImageTags)[0]
        || getArrayText(item.ParentBackdropImageTags)[0];

    return getPtvItemImageUrl(item, {
        serverId: getPtvServerId() || undefined,
        imageType: 'Backdrop',
        maxWidth: performanceProfile.heroBackdropMaxWidth,
        quality: 82,
        tag
    });
}

function getSearchBackdrop(groups: Record<PtvSearchGroupId, PtvSearchGroupState>) {
    const allItems = PTV_SEARCH_GROUPS.flatMap(group => groups[group.id].items);
    const backdropItem = allItems.find(item => getArrayText(item.BackdropImageTags).length)
        || allItems.find(item => (
            getArrayText(item.ParentBackdropImageTags).length
            && getText(item.ParentBackdropItemId)
        ));

    return backdropItem ? getSearchItemBackdrop(backdropItem) : '';
}

function getSearchRoute(item: PtvItem) {
    return resolvePtvItemRoute(item, {
        fallbackHref: `#/details?id=${encodeURIComponent(getText(item.Id))}`,
        source: 'ptv-search'
    });
}

function getSearchHref(query: string, filter: PtvSearchFilterId) {
    return `${PTV_ROUTES.search}?${serializePtvSearchParams(query, filter)}`;
}

function NativeSearchCard({
    item,
    sourceGroup,
    user
}: Readonly<{
    item: PtvItem;
    sourceGroup: string;
    user: PtvUser | null;
}>) {
    const route = useMemo(() => getSearchRoute(item), [item]);
    const tags = useMemo(() => getPtvQualityTags(item, { maxTags: 3 }), [item]);
    const title = getSearchItemTitle(item);
    const itemId = getText(item.Id);
    const serverId = getPtvServerId();
    const userId = getText(user?.Id);
    const imageCandidates = useMemo(
        () => getSearchItemImageCandidates(item, serverId),
        [item, serverId]
    );
    const [actionLifecycle] = useState(() => new PtvSearchActionLifecycle());
    const [imageCandidateIndex, setImageCandidateIndex] = useState(0);
    const [isMenuOpening, setIsMenuOpening] = useState(false);
    const imageCandidate = imageCandidates[imageCandidateIndex];
    const imageUrl = imageCandidate?.url || '';

    useEffect(() => () => actionLifecycle.retire(), [
        actionLifecycle,
        itemId,
        serverId,
        userId
    ]);
    useEffect(() => setImageCandidateIndex(0), [imageCandidates, itemId]);

    const onCardClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
        const activation = activateNativeSearchCard({
            event,
            item,
            route,
            sourceGroup
        });

        activation?.catch(error => {
            recordPtvEvent('route', 'ptv-search-card-navigation-failed', {
                errorName: error instanceof Error ? error.name : 'UnknownError',
                itemType: getText(item.Type),
                sourceGroup
            });
        });
    }, [item, route, sourceGroup]);
    const openItemActionMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        if (!user || isMenuOpening) return;

        const positionTo = event.currentTarget;
        const identity = { itemId, serverId, userId };
        const operation = actionLifecycle.begin(identity);
        const isCurrent = () => {
            const currentServerId = getPtvServerId();
            const currentIdentity = {
                itemId,
                serverId: currentServerId,
                userId: getPtvCurrentUserId(currentServerId)
            };

            return document.documentElement.contains(positionTo)
                && actionLifecycle.isCurrent(operation, currentIdentity);
        };

        setIsMenuOpening(true);
        void getPtvItem<PtvItem>(itemId, {
            serverId,
            signal: operation.controller.signal,
            userId
        })
            .then(actionItem => {
                if (!isCurrent()) return undefined;
                const musicActionExtension = getPtvMusicSearchActionMenuExtension(actionItem);

                return showPtvItemActionMenu({
                    ...(musicActionExtension || {}),
                    isCurrent,
                    item: actionItem,
                    positionTo,
                    signal: operation.controller.signal,
                    user
                });
            })
            .catch(error => {
                if (!isCurrent() || operation.controller.signal.aborted) return;

                toast('Actions are temporarily unavailable. Try again.');
                recordPtvEvent('api', 'ptv-search-card-menu-hydration-failed', {
                    errorName: error instanceof Error ? error.name : 'UnknownError',
                    itemType: getText(item.Type),
                    sourceGroup
                });
            })
            .finally(() => {
                if (actionLifecycle.complete(operation)) {
                    setIsMenuOpening(false);
                }
            });
    }, [
        actionLifecycle,
        isMenuOpening,
        item,
        itemId,
        serverId,
        sourceGroup,
        user,
        userId
    ]);
    const advanceImageCandidate = useCallback(() => {
        markPtvImageCandidateFailed(imageCandidate);
        setImageCandidateIndex(index => index + 1);
    }, [imageCandidate]);

    return (
        <article
            className='ptv-search-card'
            data-ptv-search-item-id={getText(item.Id)}
            data-ptv-search-item-type={getText(item.Type)}
            data-ptv-search-source-group={sourceGroup}
        >
            <a
                aria-label={`Open ${title}`}
                className='ptv-search-card-link'
                href={route.href}
                onClick={onCardClick}
            >
                <span className='ptv-search-card-art'>
                    {imageUrl ? (
                        <img alt='' loading='lazy' onError={advanceImageCandidate} src={imageUrl} />
                    ) : (
                        <span>{title.slice(0, 1)}</span>
                    )}
                    {tags.length ? (
                        <span className='ptv-search-quality-stack'>
                            {tags.map(tag => (
                                <span key={tag.id} className={`ptv-search-quality ${getPtvQualityPillClass(tag)}`}>
                                    {tag.label}
                                </span>
                            ))}
                        </span>
                    ) : null}
                </span>
                <span className='ptv-search-card-title'>{title}</span>
                <span className='ptv-search-card-meta'>{getSearchItemMeta(item)}</span>
            </a>
            {user ? (
                <button
                    aria-label={`More actions for ${title}`}
                    aria-haspopup='menu'
                    className='ptv-search-card-action'
                    data-ptv-focus-key={`search-card-menu:${getText(item.Id)}`}
                    disabled={isMenuOpening}
                    onClick={openItemActionMenu}
                    type='button'
                >
                    <PtvIcon name='more' />
                </button>
            ) : null}
        </article>
    );
}

function NativeSearchGroupContent({
    config,
    state,
    user
}: Readonly<{
    config: PtvSearchGroupConfig;
    state: PtvSearchGroupState;
    user: PtvUser | null;
}>) {
    if (state.status === 'queued') return <p>Queued...</p>;

    if (state.status === 'loading' && !state.items.length) {
        return (
            <div className='ptv-search-card-rail ptv-search-card-rail-skeleton' aria-hidden='true'>
                {PTV_SEARCH_SKELETON_KEYS.map(key => (
                    <span key={key} className='ptv-search-card ptv-search-card-skeleton'>
                        <span className='ptv-search-card-art' />
                        <span className='ptv-search-skeleton-line ptv-search-skeleton-title' />
                        <span className='ptv-search-skeleton-line ptv-search-skeleton-meta' />
                    </span>
                ))}
            </div>
        );
    }

    if (state.status === 'error' || state.status === 'timeout' || state.status === 'cancelled') {
        return <p role='status'>{state.error || 'This group could not be loaded.'}</p>;
    }

    return (
        <div className='ptv-search-card-rail'>
            {state.items.map(item => (
                <NativeSearchCard
                    key={`${config.id}-${getText(item.Id)}`}
                    item={item}
                    sourceGroup={config.id}
                    user={user}
                />
            ))}
        </div>
    );
}

function NativeSearchGroup({
    config,
    state,
    user
}: Readonly<{
    config: PtvSearchGroupConfig;
    state: PtvSearchGroupState;
    user: PtvUser | null;
}>) {
    if (state.status === 'idle' || state.status === 'empty') return null;

    let timing: React.ReactNode = null;

    if (state.status === 'loading' && state.items.length) {
        timing = <small>Updating results...</small>;
    } else if (state.durationMs) {
        timing = <small>{state.durationMs}ms</small>;
    }

    return (
        <section
            aria-labelledby={`ptv-search-group-${config.id}`}
            className={`ptv-search-group is-${state.status}`}
        >
            <header className='ptv-search-group-header'>
                <div>
                    <span>{config.kicker}</span>
                    <h2 id={`ptv-search-group-${config.id}`}>{config.title}</h2>
                </div>
                {timing}
            </header>
            <NativeSearchGroupContent config={config} state={state} user={user} />
        </section>
    );
}

function NativeSearchDebug({
    cacheHit,
    groups,
    query
}: Readonly<{
    cacheHit: boolean;
    groups: Record<PtvSearchGroupId, PtvSearchGroupState>;
    query: string;
}>) {
    const { canShowDebug } = usePtvAdminDebugVisibility();

    if (!canShowDebug) return null;

    return (
        <details className='ptv-search-debug'>
            <summary>Search diagnostics</summary>
            <dl>
                <dt>query</dt>
                <dd>{query || 'none'}</dd>
                <dt>searchCacheHit</dt>
                <dd>{String(cacheHit)}</dd>
                <dt>searchDebounceMs</dt>
                <dd>{PTV_SEARCH_DEBOUNCE_MS}</dd>
            </dl>
            <div>
                {PTV_SEARCH_GROUPS.map(group => {
                    const state = groups[group.id];
                    const libraryRoots = state.libraryRoots.map(root => {
                        const physicalRoots = root.physicalRoots.join(', ') || 'metadata only';

                        return `${root.logicalRoot} [${physicalRoots}]`;
                    }).join(' | ');

                    return (
                        <span key={group.id}>
                            {group.title}: {state.status}, {state.items.length} item(s), {state.durationMs || 'n/a'}ms
                            {state.deduplicatedCount ? `, ${state.deduplicatedCount} duplicate(s) suppressed` : ''}
                            {state.timeoutReason ? `, ${state.timeoutReason}` : ''}
                            {state.error && state.status !== 'timeout' ? `, ${state.error}` : ''}
                            {state.requestUrl ? `, ${state.requestUrl}` : ''}
                            {libraryRoots ? `, roots: ${libraryRoots}` : ''}
                            {`, primaryStatus=${state.searchRecovery.primaryStatus}, primary=${state.searchRecovery.primaryDurationMs || 'n/a'}ms, primaryError=${state.searchRecovery.primaryError || 'none'}, recovery=${state.searchRecovery.recoveryAttempted ? 'triggered' : 'not triggered'} (${state.searchRecovery.recoveryReason}), catalog={status=${state.searchRecovery.catalogStatus}; endpoint=${state.searchRecovery.catalogRequestEndpoint || 'none'}; parent=${state.searchRecovery.catalogRequestParentId}; start=${state.searchRecovery.catalogRequestStartIndex}; limit=${state.searchRecovery.catalogPageSize}; sort=${state.searchRecovery.catalogRequestSortBy || 'none'}:${state.searchRecovery.catalogRequestSortOrder || 'none'}; fields=${state.searchRecovery.catalogRequestFields || 'none'}; cached=${state.searchRecovery.catalogCachedItemCount}; total=${state.searchRecovery.catalogTotalRecordCount}; pages=${state.searchRecovery.catalogPagesLoaded}; requests=${state.searchRecovery.catalogRequestsThisSearch}; exhausted=${state.searchRecovery.catalogExhausted}; age=${state.searchRecovery.catalogCacheAgeMs}ms; duration=${state.searchRecovery.catalogSearchDurationMs}ms; matches=${state.searchRecovery.catalogMatchCount}; matched=${state.searchRecovery.catalogMatchedNames.join('|') || 'none'}; locations=${state.searchRecovery.catalogMatchedLocations.join('|') || 'none'}; hydrated=${state.searchRecovery.catalogHydrationCount}/${state.searchRecovery.catalogHydrationDurationMs}ms}, finalCount=${state.searchRecovery.finalItemCount}, cache=${state.searchRecovery.cacheSource}, rawTopParentIds=${state.searchRecovery.rawTopParentIds.join('|') || 'none'}, abort=${state.searchRecovery.timeoutOrAbort}`}
                        </span>
                    );
                })}
            </div>
        </details>
    );
}

function getNativeSearchStatus(
    query: string,
    filter: PtvSearchFilterId,
    filterLabel: string,
    presentation: PtvSearchPresentation
) {
    if (query.length < 2) return 'Enter at least two characters to search.';

    const scopeLabel = filter === 'all' ? '' : ` in ${filterLabel}`;
    const resultLabel = `${presentation.itemCount} result${presentation.itemCount === 1 ? '' : 's'}`;

    if (presentation.isPending && presentation.itemCount) {
        return `${resultLabel}${scopeLabel} for "${query}". Still searching.`;
    }
    if (presentation.isPending) return `Searching${scopeLabel} for "${query}".`;
    if (presentation.itemCount) return `${resultLabel}${scopeLabel} for "${query}".`;
    if (presentation.failedGroupCount) return `Search${scopeLabel} could not be completed.`;

    return `No results${scopeLabel} for "${query}".`;
}

function NativeSearchFilters({
    activeFilter,
    onSelect
}: Readonly<{
    activeFilter: PtvSearchFilterId;
    onSelect: (filter: PtvSearchFilterId) => void;
}>) {
    const handleSelect = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        onSelect(normalizePtvSearchFilter(event.currentTarget.dataset.ptvSearchFilter));
    }, [onSelect]);

    return (
        <nav className='ptv-search-filters' aria-label='Search result filters'>
            {PTV_SEARCH_FILTERS.map(filter => (
                <button
                    key={filter.id}
                    aria-controls='ptv-search-results'
                    aria-pressed={activeFilter === filter.id}
                    className={activeFilter === filter.id ? 'is-active' : ''}
                    data-ptv-focus-key={`search-filter-${filter.id}`}
                    data-ptv-search-filter={filter.id}
                    onClick={handleSelect}
                    type='button'
                >
                    {filter.label}
                </button>
            ))}
        </nav>
    );
}

function NativeSearchSuggestions({
    activeFilter,
    onClear,
    recentSearches
}: Readonly<{
    activeFilter: PtvSearchFilterId;
    onClear: () => void;
    recentSearches: readonly string[];
}>) {
    return (
        <div className='ptv-search-suggestions' aria-label='Recent searches'>
            <p
                id='ptv-search-status'
                aria-atomic='true'
                aria-live='polite'
                role='status'
            >
                Start typing at least two characters.
            </p>
            {recentSearches.length ? (
                <>
                    <span className='ptv-search-suggestions-label'>Recent</span>
                    <div className='ptv-search-suggestion-chips'>
                        {recentSearches.map(recent => (
                            <a key={recent} href={getSearchHref(recent, activeFilter)}>
                                {recent}
                            </a>
                        ))}
                        <button type='button' onClick={onClear}>
                            Clear history
                        </button>
                    </div>
                </>
            ) : null}
        </div>
    );
}

function NativeSearchResultFeedback({
    onClear,
    onRetry,
    presentation,
    queryReady
}: Readonly<{
    onClear: () => void;
    onRetry: () => void;
    presentation: PtvSearchPresentation;
    queryReady: boolean;
}>) {
    if (!queryReady) return null;

    if (presentation.isSettled && presentation.itemCount === 0) {
        const hasFailure = presentation.failedGroupCount > 0;
        let iconName = 'search';
        let title = 'No matches found';
        let description = 'Try a shorter title, a creator name, or another result filter.';

        if (hasFailure) {
            iconName = 'alerts';
            title = 'Search could not finish';
            description = 'The server did not return one or more result groups. Try the search again.';
        }

        return (
            <section
                className={`ptv-search-result-state ${hasFailure ? 'is-error' : 'is-empty'}`}
                aria-labelledby='ptv-search-result-state-title'
            >
                <PtvIcon name={iconName} />
                <h2 id='ptv-search-result-state-title'>{title}</h2>
                <p>{description}</p>
                <div className='ptv-search-result-state-actions'>
                    {hasFailure ? <button type='button' onClick={onRetry}>Try again</button> : null}
                    <button type='button' onClick={onClear}>Clear search</button>
                </div>
            </section>
        );
    }

    if (presentation.failedGroupCount > 0 && presentation.itemCount > 0) {
        return (
            <aside className='ptv-search-partial-error' aria-live='polite'>
                <span>Some result groups could not be loaded.</span>
                <button type='button' onClick={onRetry}>Try again</button>
            </aside>
        );
    }

    return null;
}

function NativeSearchGroups({
    filterLabel,
    groups,
    presentation,
    queryReady,
    user,
    visibleGroups
}: Readonly<{
    filterLabel: string;
    groups: Record<PtvSearchGroupId, PtvSearchGroupState>;
    presentation: PtvSearchPresentation;
    queryReady: boolean;
    user: PtvUser | null;
    visibleGroups: readonly PtvSearchGroupConfig[];
}>) {
    const showGroups = queryReady && !(presentation.isSettled && presentation.itemCount === 0);
    const renderedGroups = presentation.isPending && presentation.itemCount === 0 ?
        visibleGroups.slice(0, 1) :
        visibleGroups;

    return (
        <section
            id='ptv-search-results'
            className='ptv-search-groups'
            aria-busy={queryReady && presentation.isPending}
            aria-describedby={queryReady ? 'ptv-search-status' : undefined}
            aria-label={`${filterLabel} search results`}
        >
            {showGroups ? renderedGroups.map(group => (
                <NativeSearchGroup key={group.id} config={group} state={groups[group.id]} user={user} />
            )) : null}
        </section>
    );
}

export default function NativeSearchPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const routeQuery = searchParams.get('query') || '';
    const routeFilter = searchParams.get('filter') || '';
    const routeGrouped = searchParams.get('ptvGrouped') || '';
    const activeFilter = normalizePtvSearchFilter(routeFilter);
    const activeFilterConfig = getPtvSearchFilterConfig(activeFilter);
    const {
        serverId,
        status: identityStatus,
        userId
    } = usePtvAuthenticatedIdentity();
    const { user } = useNativeSearchCurrentUser(serverId, userId);
    const searchHistoryScope = getPtvSearchHistoryKey(serverId, userId) || '';
    const shouldAutoFocusSearch = useMemo(() => {
        const profile = getPtvClientProfile();

        return !profile.isTv && !profile.isMobile && !profile.isTablet && !profile.isCoarsePointer;
    }, []);
    const [inputQuery, setInputQuery] = useState(routeQuery);
    const [debouncedQuery, setDebouncedQuery] = useState(routeQuery.trim());
    const [groups, setGroups] = useState(() => getInitialGroups(routeQuery.trim().length >= 2 ? 'queued' : 'idle'));
    const [cacheHit, setCacheHit] = useState(false);
    const [retryGeneration, setRetryGeneration] = useState(0);
    const [recentHistory, setRecentHistory] = useState(() => ({
        items: loadPtvRecentSearches(serverId, userId),
        scope: searchHistoryScope
    }));
    const recentSearches = recentHistory.scope === searchHistoryScope ? recentHistory.items : [];
    const requestIdRef = useRef(0);
    const retryGateRef = useRef(createPtvRetryGate());
    const backdropUrl = useMemo(() => getSearchBackdrop(groups), [groups]);
    const visibleSearchGroups = useMemo(() => PTV_SEARCH_GROUPS.filter(
        group => activeFilterConfig.groups.includes(group.id)
    ), [activeFilterConfig.groups]);
    const searchPresentation = getPtvSearchPresentation(visibleSearchGroups.map(group => ({
        itemCount: groups[group.id].items.length,
        status: groups[group.id].status
    })));
    const queryReady = debouncedQuery.length >= 2;
    const searchStatus = getNativeSearchStatus(
        debouncedQuery,
        activeFilter,
        activeFilterConfig.label,
        searchPresentation
    );

    useEffect(() => {
        setInputQuery(routeQuery);
        setDebouncedQuery(routeQuery.trim());
    }, [routeQuery]);

    useEffect(() => {
        setRecentHistory({
            items: loadPtvRecentSearches(serverId, userId),
            scope: searchHistoryScope
        });
    }, [searchHistoryScope, serverId, userId]);

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            const query = inputQuery.trim();

            setDebouncedQuery(query);

            if (
                routeQuery.trim() !== query
                || routeFilter !== activeFilter
                || routeGrouped !== 'true'
            ) {
                setSearchParams(buildPtvSearchParams(query, activeFilter), { replace: true });
            }
        }, PTV_SEARCH_DEBOUNCE_MS);

        return () => window.clearTimeout(timeout);
    }, [
        activeFilter,
        inputQuery,
        routeFilter,
        routeGrouped,
        routeQuery,
        setSearchParams
    ]);

    useEffect(() => {
        const query = debouncedQuery.trim();

        if (query.length < 2) {
            retryGateRef.current.release();
            setGroups(getInitialGroups('idle'));
            setCacheHit(false);
            return undefined;
        }

        const cacheKey = getSearchCacheKey(query, activeFilter, serverId, userId);
        const cached = cacheKey ? getSearchCache(cacheKey) : null;

        setRecentHistory({
            items: savePtvRecentSearch(query, serverId, userId),
            scope: searchHistoryScope
        });

        if (cached) {
            retryGateRef.current.release();
            setGroups(cached.groups);
            setCacheHit(true);
            recordPtvEvent('route', 'ptv-search-cache-hit', {
                queryLength: query.length
            });
            return undefined;
        }

        if (identityStatus !== 'ready') {
            retryGateRef.current.release();
            setGroups(getInitialGroups('queued'));
            setCacheHit(false);
            return undefined;
        }

        const requestId = requestIdRef.current + 1;
        const startedAt = performance.now();
        let cancelled = false;
        let settled = false;
        let timedOut = false;
        const abortController = createPtvAbortController();
        const requestGroups = PTV_SEARCH_GROUPS.filter(group => (
            activeFilterConfig.groups.includes(group.id)
        ));
        const includeItemTypes = requestGroups.flatMap(group => group.includeItemTypes.split(','));
        const hintLimit = PTV_SEARCH_RESULT_LIMIT * requestGroups.length;

        requestIdRef.current = requestId;
        setGroups(getLoadingGroups());
        setCacheHit(false);
        recordPtvEvent('route', 'ptv-search-started', {
            requestPlan: 'search-hints',
            searchDebounceMs: PTV_SEARCH_DEBOUNCE_MS,
            searchMaxConcurrency: 1,
            searchQueuedGroupCount: 1,
            queryLength: query.length
        });
        recordPtvEvent('api', 'ptv-search-hints-request-started', {
            endpointPath: 'Search/Hints',
            includeItemTypeCount: includeItemTypes.length,
            limit: hintLimit,
            timeoutMs: PTV_SEARCH_HINT_TIMEOUT_MS
        });

        const timeoutId = window.setTimeout(() => {
            timedOut = true;
            abortController.abort();
        }, PTV_SEARCH_HINT_TIMEOUT_MS);

        void searchPtvHints({
            includeItemTypes,
            limit: hintLimit,
            perGroupLimit: PTV_SEARCH_RESULT_LIMIT,
            query,
            serverId,
            signal: abortController.signal,
            userId
        })
            .then(result => {
                if (cancelled || requestIdRef.current !== requestId) return;

                settled = true;
                const durationMs = Number((performance.now() - startedAt).toFixed(1));
                const nextGroups = getSettledHintGroups(result.groups, durationMs);
                const firstResultGroup = PTV_SEARCH_GROUPS.find(group => nextGroups[group.id].items.length);

                setGroups(nextGroups);
                retryGateRef.current.release();

                if (cacheKey && isSearchCacheable(nextGroups)) {
                    rememberSearchCache(cacheKey, {
                        groups: nextGroups,
                        query,
                        updatedAt: Date.now()
                    });
                }

                if (firstResultGroup) {
                    recordPtvEvent('route', 'ptv-search-first-result', {
                        groupId: firstResultGroup.id,
                        searchFirstResultMs: durationMs
                    });
                }

                recordPtvEvent('api', 'ptv-search-hints-request-complete', {
                    durationMs,
                    hintCount: result.hintCount,
                    requestStartCount: 1,
                    totalRecordCount: result.totalRecordCount
                });
                recordPtvEvent('route', 'ptv-search-complete', {
                    cached: isSearchCacheable(nextGroups),
                    requestStartCount: 1,
                    searchCompleteMs: durationMs,
                    timeoutCount: 0
                });
            })
            .catch(error => {
                if (cancelled || requestIdRef.current !== requestId) return;

                settled = true;
                const durationMs = Number((performance.now() - startedAt).toFixed(1));
                const failure = getPtvSearchHintFailureKind(error, timedOut);
                const failureKind = failure === 'timeout' ? 'timeout' : 'error';
                const message = failureKind === 'timeout' ?
                    'Search took too long. Try again.' :
                    'Search is temporarily unavailable. Try again.';
                const nextGroups = getFailedHintGroups(durationMs, message, failureKind);

                setGroups(nextGroups);
                retryGateRef.current.release();
                recordPtvEvent('api', 'ptv-search-hints-request-failed', {
                    durationMs,
                    exceptionName: error instanceof Error ? error.name : 'UnknownError',
                    requestStartCount: 1,
                    status: failureKind,
                    timeoutReason: failureKind === 'timeout' ? 'search-hints-timeout' : null
                });
                recordPtvEvent('route', 'ptv-search-complete', {
                    cached: false,
                    requestStartCount: 1,
                    searchCompleteMs: durationMs,
                    timeoutCount: failureKind === 'timeout' ? 1 : 0
                });
            })
            .finally(() => window.clearTimeout(timeoutId));

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
            abortController.abort();

            if (!settled) {
                recordPtvEvent('route', 'ptv-search-cancelled', {
                    queryLength: query.length,
                    requestStartCount: 1,
                    searchCancelledCount: 1
                });
            }
        };
    }, [
        activeFilter,
        activeFilterConfig.groups,
        debouncedQuery,
        identityStatus,
        retryGeneration,
        searchHistoryScope,
        serverId,
        userId
    ]);

    const submitSearch = useCallback((event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const query = inputQuery.trim();

        setDebouncedQuery(query);
        setSearchParams(buildPtvSearchParams(query, activeFilter), { replace: true });
    }, [activeFilter, inputQuery, setSearchParams]);
    const selectSearchFilter = useCallback((filter: PtvSearchFilterId) => {
        setSearchParams(buildPtvSearchParams(inputQuery, filter), { replace: true });
    }, [inputQuery, setSearchParams]);
    const clearSearchHistory = useCallback(() => {
        clearPtvRecentSearches(serverId, userId);
        setRecentHistory({
            items: [],
            scope: searchHistoryScope
        });
    }, [searchHistoryScope, serverId, userId]);
    const clearSearchQuery = useCallback(() => {
        setInputQuery('');
        setDebouncedQuery('');
        setSearchParams(buildPtvSearchParams('', activeFilter), { replace: true });
    }, [activeFilter, setSearchParams]);
    const retrySearch = useCallback(() => {
        if (!retryGateRef.current.claim()) return;
        setRetryGeneration(generation => generation + 1);
    }, []);
    const updateInputQuery = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setInputQuery(event.currentTarget.value);
    }, []);

    return (
        <Page
            id='ptv-native-search-page'
            title={`${PTV_BRANDING.appName} Search`}
            className='ptv-native-search-page'
            isBackButtonEnabled={false}
            isMenuButtonEnabled={false}
            isNowPlayingBarEnabled={false}
            isThemeMediaSupported={false}
        >
            <PTVShell
                backdropSource={backdropUrl ? 'search-results' : 'search-fallback'}
                backdropUrl={backdropUrl}
                className='ptv-search-shell'
                section='search'
                title='Search'
            >
                <main className='ptv-search-page'>
                    <section className='ptv-search-hero'>
                        <p>PiggieTV</p>
                        <h1>Search</h1>
                        <form className='ptv-search-hero-form' role='search' onSubmit={submitSearch}>
                            <PtvIcon name='search' />
                            <input
                                aria-describedby='ptv-search-status'
                                aria-label='Search PiggieTV'
                                autoComplete='off'
                                // eslint-disable-next-line jsx-a11y/no-autofocus
                                autoFocus={shouldAutoFocusSearch}
                                data-ptv-focus-key='search-input'
                                data-ptv-initial-focus='search'
                                inputMode='search'
                                maxLength={160}
                                onChange={updateInputQuery}
                                placeholder='Search movies, shows, people, music, reading'
                                type='search'
                                value={inputQuery}
                            />
                        </form>
                        <NativeSearchFilters activeFilter={activeFilter} onSelect={selectSearchFilter} />
                        {queryReady ? (
                            <p
                                id='ptv-search-status'
                                className='ptv-search-summary'
                                aria-atomic='true'
                                aria-live='polite'
                                role='status'
                            >
                                {searchStatus}
                            </p>
                        ) : (
                            <NativeSearchSuggestions
                                activeFilter={activeFilter}
                                onClear={clearSearchHistory}
                                recentSearches={recentSearches}
                            />
                        )}
                    </section>
                    <NativeSearchResultFeedback
                        onClear={clearSearchQuery}
                        onRetry={retrySearch}
                        presentation={searchPresentation}
                        queryReady={queryReady}
                    />
                    <NativeSearchGroups
                        filterLabel={activeFilterConfig.label}
                        groups={groups}
                        presentation={searchPresentation}
                        queryReady={queryReady}
                        user={user}
                        visibleGroups={visibleSearchGroups}
                    />
                    <NativeSearchDebug cacheHit={cacheHit} groups={groups} query={debouncedQuery} />
                </main>
            </PTVShell>
        </Page>
    );
}

registerPtvNativeRoute('/search', NativeSearchPage, 'native');
