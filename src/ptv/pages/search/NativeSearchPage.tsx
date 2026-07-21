import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import Page from 'components/Page';

import {
    getPtvCurrentUserId,
    getPtvApiUrl,
    getPtvItemImageUrl,
    getPtvServerId,
    PtvSearchAbortedError,
    PtvSearchPrimaryTimeoutError,
    searchPtvItems,
    type PtvItem,
    type PtvItemQuery
} from '../../api';
import { PTV_BRANDING, PTV_ROUTES } from '../../core/config';
import {
    recordPtvItemRouteClick,
    resolvePtvItemRoute
} from '../../core/itemRoutes';
import { recordPtvEvent } from '../../core/observability';
import {
    getPtvQualityPillClass,
    getPtvQualityTags
} from '../../modules/cards/qualityTags';
import { PtvIcon } from '../../modules/icons';
import PTVShell from '../../shell/PTVShell';
import { registerPtvNativeRoute } from '../../shell/routeController';
import { usePtvAdminDebugVisibility } from '../../utils/usePtvAdminDebugVisibility';
import { type PtvLibraryRootDiagnostics } from '../../services/libraryRootNormalizer';
import { createPtvSearchRecoveryDiagnostics, type PtvSearchRecoveryDiagnostics } from '../../services/searchRecovery';

import './nativeSearch.scss';

type PtvSearchGroupId =
    | 'albums'
    | 'artists'
    | 'collections'
    | 'episodes'
    | 'movies'
    | 'music'
    | 'reading'
    | 'shows';

type PtvSearchGroupConfig = Readonly<{
    id: PtvSearchGroupId;
    includeItemTypes: string;
    kicker: string;
    priority: 1 | 2 | 3;
    title: string;
}>;

type PtvSearchGroupStatus = 'cancelled' | 'empty' | 'error' | 'idle' | 'loading' | 'queued' | 'success' | 'timeout';

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
const PTV_SEARCH_CONCURRENCY = 2;
const PTV_SEARCH_RESULT_LIMIT = 14;
const PTV_SEARCH_INITIAL_TIMEOUT_MS = 5000;
const PTV_SEARCH_BACKGROUND_TIMEOUT_MS = 8000;
const PTV_SEARCH_RECENT_KEY = 'ptv:search:recent:v1';
const PTV_SEARCH_FIELDS = [
    'Container',
    'ImageTags',
    'MediaType',
    'OfficialRating',
    'ParentBackdropImageTags',
    'ParentBackdropItemId',
    'ParentLogoImageTag',
    'ParentLogoItemId',
    'ParentPrimaryImageItemId',
    'ParentPrimaryImageTag',
    'ParentThumbItemId',
    'PremiereDate',
    'PrimaryImageAspectRatio',
    'ProductionYear',
    'RunTimeTicks',
    'SeriesName'
].join(',');
const PTV_MOVIE_SEARCH_RECOVERY_FIELDS = [
    PTV_SEARCH_FIELDS,
    'OriginalTitle',
    'Path',
    'PresentationUniqueKey',
    'ProviderIds',
    'SortName',
    'TopParentId'
].join(',');
const PTV_SEARCH_GROUPS: readonly PtvSearchGroupConfig[] = [
    { id: 'movies', title: 'Movies', kicker: 'Film results', includeItemTypes: 'Movie', priority: 1 },
    { id: 'shows', title: 'Shows', kicker: 'Series results', includeItemTypes: 'Series', priority: 1 },
    { id: 'collections', title: 'Collections', kicker: 'Collections', includeItemTypes: 'BoxSet', priority: 1 },
    { id: 'episodes', title: 'Episodes', kicker: 'Episode results', includeItemTypes: 'Episode', priority: 2 },
    { id: 'reading', title: 'Reading', kicker: 'Books, comics, manga', includeItemTypes: 'Book', priority: 2 },
    { id: 'music', title: 'Songs', kicker: 'Music results', includeItemTypes: 'Audio', priority: 3 },
    { id: 'albums', title: 'Albums', kicker: 'Music albums', includeItemTypes: 'MusicAlbum', priority: 3 },
    { id: 'artists', title: 'Artists', kicker: 'Music artists', includeItemTypes: 'MusicArtist', priority: 3 },
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

function getSearchCacheKey(query: string) {
    return [
        getPtvServerId() || 'server',
        getPtvCurrentUserId() || 'user',
        query.trim().toLowerCase()
    ].join(':');
}

function redactSearchDiagnosticUrl(url: string) {
    return url
        .replace(/([?&](?:api_key|apikey|access_token|token)=)[^&]+/gi, '$1[redacted]')
        .replace(/(Authorization=)[^&]+/gi, '$1[redacted]');
}

function getSearchGroupQuery(group: PtvSearchGroupConfig, searchTerm: string): PtvItemQuery {
    return {
        EnableImages: false,
        Fields: PTV_SEARCH_FIELDS,
        ImageTypeLimit: 0,
        IncludeItemTypes: group.includeItemTypes,
        Limit: PTV_SEARCH_RESULT_LIMIT,
        Recursive: true,
        SearchTerm: searchTerm
    };
}

function getSearchGroupRequestDetail(group: PtvSearchGroupConfig, searchTerm: string) {
    const userId = getPtvCurrentUserId();
    const endpointPath = userId ? `Users/${userId}/Items` : 'Users/[missing-user]/Items';
    const query = getSearchGroupQuery(group, searchTerm);
    let requestUrl = '';

    try {
        requestUrl = userId ? redactSearchDiagnosticUrl(getPtvApiUrl(endpointPath, query)) : '';
    } catch {
        requestUrl = '';
    }

    return {
        endpointPath,
        query,
        requestUrl,
        userId
    };
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

function loadRecentSearches() {
    try {
        const parsed = JSON.parse(window.localStorage?.getItem(PTV_SEARCH_RECENT_KEY) || '[]') as unknown;

        return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string').slice(0, 8) as string[] : [];
    } catch {
        return [];
    }
}

function saveRecentSearch(query: string) {
    const normalized = query.trim();

    if (normalized.length < 2) return;

    try {
        const next = [normalized, ...loadRecentSearches().filter(item => item.toLowerCase() !== normalized.toLowerCase())].slice(0, 8);

        window.localStorage?.setItem(PTV_SEARCH_RECENT_KEY, JSON.stringify(next));
    } catch {
        // Search history is an enhancement; storage failures should not block search.
    }
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

function getSearchItemImage(item: PtvItem) {
    return getPtvItemImageUrl(item, {
        fillHeight: 480,
        fillWidth: 320,
        imageType: 'Primary',
        quality: 88
    });
}

function getSearchItemBackdrop(item: PtvItem) {
    return getPtvItemImageUrl(item, {
        imageType: 'Backdrop',
        maxWidth: 1600,
        quality: 82
    });
}

function getSearchBackdrop(groups: Record<PtvSearchGroupId, PtvSearchGroupState>) {
    const allItems = PTV_SEARCH_GROUPS.flatMap(group => groups[group.id].items);
    const backdropItem = allItems.find(item => getArrayText(item.BackdropImageTags).length)
        || allItems.find(item => getArrayText(item.ParentBackdropImageTags).length || getText(item.ParentBackdropItemId))
        || allItems[0];

    return backdropItem ? getSearchItemBackdrop(backdropItem) : '';
}

function getSearchRoute(item: PtvItem) {
    return resolvePtvItemRoute(item, {
        fallbackHref: `#/details?id=${encodeURIComponent(getText(item.Id))}`,
        source: 'ptv-search'
    });
}

function NativeSearchCard({ item, sourceGroup }: Readonly<{ item: PtvItem; sourceGroup: string }>) {
    const route = useMemo(() => getSearchRoute(item), [item]);
    const imageUrl = getSearchItemImage(item);
    const tags = useMemo(() => getPtvQualityTags(item, { maxTags: 3 }), [item]);
    const title = getSearchItemTitle(item);

    return (
        <a
            className='ptv-search-card'
            data-ptv-search-item-id={getText(item.Id)}
            data-ptv-search-item-type={getText(item.Type)}
            data-ptv-search-source-group={sourceGroup}
            href={route.href}
            onClick={() => recordPtvItemRouteClick(item, route, {
                action: 'search-card',
                source: 'ptv-search'
            })}
        >
            <span className='ptv-search-card-art'>
                {imageUrl ? <img alt='' loading='lazy' src={imageUrl} /> : <span>{title.slice(0, 1)}</span>}
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
    );
}

function NativeSearchGroup({
    config,
    state
}: Readonly<{
    config: PtvSearchGroupConfig;
    state: PtvSearchGroupState;
}>) {
    if (state.status === 'idle') return null;

    if (state.status === 'empty') {
        return (
            <section className='ptv-search-group is-empty'>
                <header className='ptv-search-group-header'>
                    <span>{config.kicker}</span>
                    <h2>{config.title}</h2>
                </header>
                <p>No matches in this group.</p>
            </section>
        );
    }

    return (
        <section className={`ptv-search-group is-${state.status}`}>
            <header className='ptv-search-group-header'>
                <div>
                    <span>{config.kicker}</span>
                    <h2>{config.title}</h2>
                </div>
                {state.status === 'loading' && state.items.length
                    ? <small>Searching your movie catalog...</small>
                    : state.durationMs ? <small>{state.durationMs}ms</small> : null}
            </header>
            {state.status === 'queued' ? (
                <p>Queued...</p>
            ) : state.status === 'loading' && !state.items.length ? (
                <div className='ptv-search-card-rail ptv-search-card-rail-skeleton' aria-hidden='true'>
                    {PTV_SEARCH_SKELETON_KEYS.map(key => (
                        <span key={key} className='ptv-search-card ptv-search-card-skeleton'>
                            <span className='ptv-search-card-art' />
                            <span className='ptv-search-skeleton-line ptv-search-skeleton-title' />
                            <span className='ptv-search-skeleton-line ptv-search-skeleton-meta' />
                        </span>
                    ))}
                </div>
            ) : state.status === 'error' || state.status === 'timeout' || state.status === 'cancelled' ? (
                <p>{state.error || 'This group could not be loaded.'}</p>
            ) : (
                <div className='ptv-search-card-rail'>
                    {state.items.map(item => (
                        <NativeSearchCard key={`${config.id}-${getText(item.Id)}`} item={item} sourceGroup={config.id} />
                    ))}
                </div>
            )}
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

                    return (
                        <span key={group.id}>
                            {group.title}: {state.status}, {state.items.length} item(s), {state.durationMs || 'n/a'}ms
                            {state.deduplicatedCount ? `, ${state.deduplicatedCount} duplicate(s) suppressed` : ''}
                            {state.timeoutReason ? `, ${state.timeoutReason}` : ''}
                            {state.error && state.status !== 'timeout' ? `, ${state.error}` : ''}
                            {state.requestUrl ? `, ${state.requestUrl}` : ''}
                            {state.libraryRoots.length ? `, roots: ${state.libraryRoots.map(root => `${root.logicalRoot} [${root.physicalRoots.join(', ') || 'metadata only'}]`).join(' | ')}` : ''}
                            {`, primaryStatus=${state.searchRecovery.primaryStatus}, primary=${state.searchRecovery.primaryDurationMs || 'n/a'}ms, primaryError=${state.searchRecovery.primaryError || 'none'}, recovery=${state.searchRecovery.recoveryAttempted ? 'triggered' : 'not triggered'} (${state.searchRecovery.recoveryReason}), catalog={status=${state.searchRecovery.catalogStatus}; endpoint=${state.searchRecovery.catalogRequestEndpoint || 'none'}; parent=${state.searchRecovery.catalogRequestParentId}; start=${state.searchRecovery.catalogRequestStartIndex}; limit=${state.searchRecovery.catalogPageSize}; sort=${state.searchRecovery.catalogRequestSortBy || 'none'}:${state.searchRecovery.catalogRequestSortOrder || 'none'}; fields=${state.searchRecovery.catalogRequestFields || 'none'}; cached=${state.searchRecovery.catalogCachedItemCount}; total=${state.searchRecovery.catalogTotalRecordCount}; pages=${state.searchRecovery.catalogPagesLoaded}; requests=${state.searchRecovery.catalogRequestsThisSearch}; exhausted=${state.searchRecovery.catalogExhausted}; age=${state.searchRecovery.catalogCacheAgeMs}ms; duration=${state.searchRecovery.catalogSearchDurationMs}ms; matches=${state.searchRecovery.catalogMatchCount}; matched=${state.searchRecovery.catalogMatchedNames.join('|') || 'none'}; locations=${state.searchRecovery.catalogMatchedLocations.join('|') || 'none'}; hydrated=${state.searchRecovery.catalogHydrationCount}/${state.searchRecovery.catalogHydrationDurationMs}ms}, finalCount=${state.searchRecovery.finalItemCount}, cache=${state.searchRecovery.cacheSource}, rawTopParentIds=${state.searchRecovery.rawTopParentIds.join('|') || 'none'}, abort=${state.searchRecovery.timeoutOrAbort}`}
                        </span>
                    );
                })}
            </div>
        </details>
    );
}

export default function NativeSearchPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const routeQuery = searchParams.get('query') || '';
    const [inputQuery, setInputQuery] = useState(routeQuery);
    const [debouncedQuery, setDebouncedQuery] = useState(routeQuery.trim());
    const [groups, setGroups] = useState(() => getInitialGroups(routeQuery.trim().length >= 2 ? 'queued' : 'idle'));
    const [cacheHit, setCacheHit] = useState(false);
    const requestIdRef = useRef(0);
    const recentSearches = useMemo(() => loadRecentSearches(), [debouncedQuery]);
    const backdropUrl = useMemo(() => getSearchBackdrop(groups), [groups]);
    const hasActiveResults = PTV_SEARCH_GROUPS.some(group => groups[group.id].items.length);

    useEffect(() => {
        setInputQuery(routeQuery);
        setDebouncedQuery(routeQuery.trim());
    }, [routeQuery]);

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            setDebouncedQuery(inputQuery.trim());
        }, PTV_SEARCH_DEBOUNCE_MS);

        return () => window.clearTimeout(timeout);
    }, [inputQuery]);

    useEffect(() => {
        const query = debouncedQuery.trim();

        if (query.length < 2) {
            setGroups(getInitialGroups('idle'));
            setCacheHit(false);
            return undefined;
        }

        const cacheKey = getSearchCacheKey(query);
        const cached = getSearchCache(cacheKey);

        saveRecentSearch(query);

        if (cached) {
            setGroups(cached.groups);
            setCacheHit(true);
            recordPtvEvent('route', 'ptv-search-cache-hit', {
                queryLength: query.length
            });
            return undefined;
        }

        const requestId = requestIdRef.current + 1;
        const groupResults = getInitialGroups('queued');
        const requestQueue = [...PTV_SEARCH_GROUPS].sort((left, right) => left.priority - right.priority);
        const startedAt = performance.now();
        let cancelled = false;
        const abortController = new AbortController();
        let firstResultRecorded = false;
        let nextGroupIndex = 0;
        let requestStartCount = 0;
        let timeoutCount = 0;

        requestIdRef.current = requestId;
        setGroups(groupResults);
        setCacheHit(false);
        recordPtvEvent('route', 'ptv-search-started', {
            searchDebounceMs: PTV_SEARCH_DEBOUNCE_MS,
            searchMaxConcurrency: PTV_SEARCH_CONCURRENCY,
            searchQueuedGroupCount: PTV_SEARCH_GROUPS.length,
            queryLength: query.length
        });

        const setGroupState = (group: PtvSearchGroupConfig, nextGroup: PtvSearchGroupState) => {
            groupResults[group.id] = nextGroup;

            if (cancelled || requestIdRef.current !== requestId) return;

            setGroups(previous => ({
                ...previous,
                [group.id]: nextGroup
            }));
        };

        const runGroup = async (group: PtvSearchGroupConfig) => {
            if (cancelled || requestIdRef.current !== requestId) return;

            const requestDetail = getSearchGroupRequestDetail(group, query);
            const groupStartedAt = performance.now();
            const timeoutMs = group.priority === 1 ? PTV_SEARCH_INITIAL_TIMEOUT_MS : PTV_SEARCH_BACKGROUND_TIMEOUT_MS;

            requestStartCount += 1;
            setGroupState(group, {
                ...getEmptyGroupState('loading'),
                endpointPath: requestDetail.endpointPath,
                requestUrl: requestDetail.requestUrl
            });
            recordPtvEvent('api', 'ptv-search-group-request-started', {
                endpointPath: requestDetail.endpointPath,
                fields: PTV_SEARCH_FIELDS,
                groupId: group.id,
                includeItemTypes: group.includeItemTypes,
                limit: PTV_SEARCH_RESULT_LIMIT,
                priority: group.priority,
                recursive: true,
                requestStartTimestamp: new Date().toISOString(),
                requestUrl: requestDetail.requestUrl,
                searchTerm: query,
                timeoutMs,
                userId: requestDetail.userId
            });

            try {
                const result = await searchPtvItems<PtvItem>({
                    fields: PTV_SEARCH_FIELDS,
                    includeItemTypes: group.includeItemTypes,
                    limit: PTV_SEARCH_RESULT_LIMIT,
                    primaryTimeoutMs: timeoutMs,
                    recoveryFields: group.id === 'movies' ? PTV_MOVIE_SEARCH_RECOVERY_FIELDS : undefined,
                    searchTerm: query,
                    signal: abortController.signal,
                    serverId: getPtvServerId(),
                    userId: requestDetail.userId,
                    onPrimaryResult: group.id === 'movies' ? partialResult => {
                        const partialItems = partialResult.Items || [];
                        const partialGroup: PtvSearchGroupState = {
                            deduplicatedCount: partialResult.ptvLibraryRootDiagnostics.deduplicatedCount,
                            durationMs: Number((performance.now() - groupStartedAt).toFixed(1)),
                            endpointPath: requestDetail.endpointPath,
                            error: '',
                            items: partialItems,
                            libraryRoots: partialResult.ptvLibraryRootDiagnostics.groups,
                            searchRecovery: partialResult.ptvSearchRecoveryDiagnostics,
                            requestUrl: requestDetail.requestUrl,
                            status: 'loading',
                            timeoutReason: ''
                        };

                        setGroupState(group, partialGroup);

                        if (!firstResultRecorded && partialItems.length && !cancelled && requestIdRef.current === requestId) {
                            firstResultRecorded = true;
                            recordPtvEvent('route', 'ptv-search-first-result', {
                                groupId: group.id,
                                searchFirstResultMs: Number((performance.now() - startedAt).toFixed(1))
                            });
                        }
                    } : undefined
                });
                const items = result.Items || [];
                const nextGroup: PtvSearchGroupState = {
                    deduplicatedCount: result.ptvLibraryRootDiagnostics.deduplicatedCount,
                    durationMs: Number((performance.now() - groupStartedAt).toFixed(1)),
                    endpointPath: requestDetail.endpointPath,
                    error: '',
                    items,
                    libraryRoots: result.ptvLibraryRootDiagnostics.groups,
                    searchRecovery: result.ptvSearchRecoveryDiagnostics,
                    requestUrl: requestDetail.requestUrl,
                    status: items.length ? 'success' : 'empty',
                    timeoutReason: ''
                };

                setGroupState(group, nextGroup);
                recordPtvEvent('api', 'ptv-search-group-request-complete', {
                    deduplicatedCount: nextGroup.deduplicatedCount,
                    durationMs: nextGroup.durationMs,
                    groupId: group.id,
                    itemCount: items.length,
                    normalizedLibraryRoots: nextGroup.libraryRoots,
                    requestUrl: requestDetail.requestUrl,
                    searchRecovery: nextGroup.searchRecovery,
                    status: nextGroup.status,
                    totalRecordCount: result.TotalRecordCount ?? items.length
                });

                if (!firstResultRecorded && nextGroup.items.length && !cancelled && requestIdRef.current === requestId) {
                    firstResultRecorded = true;
                    recordPtvEvent('route', 'ptv-search-first-result', {
                        groupId: group.id,
                        searchFirstResultMs: Number((performance.now() - startedAt).toFixed(1))
                    });
                }
            } catch (error) {
                const isTimeout = error instanceof PtvSearchPrimaryTimeoutError;
                const isAborted = error instanceof PtvSearchAbortedError;
                const message = error instanceof Error ? error.message : 'Search failed';

                if (isTimeout) timeoutCount += 1;

                const nextGroup: PtvSearchGroupState = {
                    deduplicatedCount: 0,
                    durationMs: Number((performance.now() - groupStartedAt).toFixed(1)),
                    endpointPath: requestDetail.endpointPath,
                    error: cancelled ? 'Cancelled' : message,
                    items: [],
                    libraryRoots: [],
                    searchRecovery: createPtvSearchRecoveryDiagnostics({
                        primaryError: message,
                        primaryStatus: isAborted ? 'aborted' : isTimeout ? 'timeout' : 'error',
                        recoveryReason: isAborted ? 'aborted-primary-request' : isTimeout ? 'primary-timeout' : 'primary-error',
                        timeoutOrAbort: isAborted ? 'aborted' : isTimeout ? 'timeout' : 'none'
                    }),
                    requestUrl: requestDetail.requestUrl,
                    status: cancelled || isAborted ? 'cancelled' : isTimeout ? 'timeout' : 'error',
                    timeoutReason: isTimeout ? message : ''
                };

                setGroupState(group, nextGroup);
                recordPtvEvent('api', 'ptv-search-group-request-failed', {
                    durationMs: nextGroup.durationMs,
                    exceptionMessage: message,
                    exceptionName: error instanceof Error ? error.name : 'UnknownError',
                    groupId: group.id,
                    requestUrl: requestDetail.requestUrl,
                    status: nextGroup.status,
                    timeoutReason: nextGroup.timeoutReason || null
                });
            }
        };

        const runWorker = async () => {
            while (!cancelled && requestIdRef.current === requestId) {
                const group = requestQueue[nextGroupIndex];

                nextGroupIndex += 1;
                if (!group) break;

                await runGroup(group);
            }
        };

        const requests = Array.from({ length: PTV_SEARCH_CONCURRENCY }, () => runWorker());

        void Promise.all(requests).then(() => {
            if (cancelled || requestIdRef.current !== requestId) return;

            if (isSearchCacheable(groupResults)) {
                rememberSearchCache(cacheKey, {
                    groups: groupResults,
                    query,
                    updatedAt: Date.now()
                });
            }
            recordPtvEvent('route', 'ptv-search-complete', {
                cached: isSearchCacheable(groupResults),
                requestStartCount,
                timeoutCount,
                perGroupDurationMs: PTV_SEARCH_GROUPS.reduce<Record<string, number>>((durations, group) => {
                    durations[group.id] = groupResults[group.id].durationMs;
                    return durations;
                }, {}),
                searchCompleteMs: Number((performance.now() - startedAt).toFixed(1))
            });
        });

        return () => {
            cancelled = true;
            abortController.abort();
            recordPtvEvent('route', 'ptv-search-cancelled', {
                requestStartCount,
                queryLength: query.length,
                searchCancelledCount: 1
            });
        };
    }, [debouncedQuery]);

    const submitSearch = useCallback((event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const query = inputQuery.trim();

        setSearchParams(query ? { query, ptvGrouped: 'true' } : {});
    }, [inputQuery, setSearchParams]);

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
                                aria-label='Search PiggieTV'
                                autoComplete='off'
                                data-ptv-focus-key='search-input'
                                data-ptv-initial-focus='search'
                                inputMode='search'
                                onChange={event => setInputQuery(event.currentTarget.value)}
                                placeholder='Search movies, shows, music, reading'
                                type='search'
                                value={inputQuery}
                            />
                        </form>
                        {debouncedQuery.length < 2 ? (
                            <div className='ptv-search-suggestions'>
                                <span>Start typing at least two characters.</span>
                                {recentSearches.map(recent => (
                                    <a key={recent} href={`${PTV_ROUTES.search}?query=${encodeURIComponent(recent)}&ptvGrouped=true`}>
                                        {recent}
                                    </a>
                                ))}
                            </div>
                        ) : (
                            <p className='ptv-search-summary'>
                                {hasActiveResults ? `Results for "${debouncedQuery}"` : `Searching for "${debouncedQuery}"`}
                            </p>
                        )}
                    </section>
                    <section className='ptv-search-groups' aria-live='polite'>
                        {debouncedQuery.length >= 2 ? PTV_SEARCH_GROUPS.map(group => (
                            <NativeSearchGroup key={group.id} config={group} state={groups[group.id]} />
                        )) : null}
                    </section>
                    <NativeSearchDebug cacheHit={cacheHit} groups={groups} query={debouncedQuery} />
                </main>
            </PTVShell>
        </Page>
    );
}

registerPtvNativeRoute('/search', NativeSearchPage, 'native');
