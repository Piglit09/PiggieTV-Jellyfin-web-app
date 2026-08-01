import { getPtvItems } from '../api/items';
import {
    getPtvCurrentUserId,
    getPtvServerId
} from '../api/client';
import type { PtvItem, PtvItemQuery, PtvItemsResult } from '../api/types';
import { createPtvAbortController } from '../core/abortController';
import { normalizePtvLibraryItems, normalizePtvLibraryRoot } from './libraryRootNormalizer';
import { filterPtvSearchRecoveryCandidates } from './searchRecovery';

export const PTV_MOVIE_SEARCH_CATALOG_PAGE_SIZE = 500;
export const PTV_MOVIE_SEARCH_CATALOG_FOREGROUND_PAGE_BUDGET = 8;

export type PtvMovieSearchCatalogStatus = 'cold' | 'complete' | 'partial' | 'refreshing';
export type PtvMovieSearchCatalogStopReason = 'cancelled' | 'empty-page' | 'exact-match-found' | 'exhausted' | 'page-budget' | 'repeated-page' | 'request-error' | 'time-budget';

export type PtvMovieSearchCatalogRequest = Readonly<{
    endpoint: string;
    fields: string;
    limit: number;
    parentId: string;
    sortBy: string;
    sortOrder: string;
    startIndex: number;
    userId: string;
}>;

export type PtvMovieSearchCatalogSearchResult = Readonly<{
    actualHasParentId: boolean;
    actualParentId: string;
    actualQueryKeys: string[];
    actualRequestCountByParentId: Record<string, number>;
    actualRequestUrl: string;
    cacheAgeMs: number;
    cacheSource: 'memory' | 'network' | 'shared-promise';
    cachedItemCount: number;
    exhausted: boolean;
    hydrationCount: number;
    hydrationDurationMs: number;
    items: PtvItem[];
    matchedLocations: string[];
    matchedNames: string[];
    pageSize: number;
    pagesLoaded: number;
    request: PtvMovieSearchCatalogRequest;
    requestsThisSearch: number;
    searchDurationMs: number;
    stopReason: PtvMovieSearchCatalogStopReason;
    status: PtvMovieSearchCatalogStatus;
    totalRecordCount: number;
    countByLogicalRoot: Record<string, number>;
    countByTopParentId: Record<string, number>;
    distinctTopParentIdCount: number;
    physicalRootSample: string[];
    topParentIds: string[];
}>;

export type PtvMovieSearchCatalogOptions = Readonly<{
    excludeItemIds?: readonly string[];
    fields?: string;
    foregroundPageBudget?: number;
    serverId?: string | null;
    signal?: AbortSignal;
    userId?: string | null;
}>;

type PtvMovieSearchCatalogPage = Readonly<{
    items: PtvItem[];
    networkRequest: boolean;
    startIndex: number;
}>;

type PtvMovieSearchCatalogInFlightPage = {
    abortController: AbortController;
    abortableConsumers: Set<symbol>;
    hasUnabortableConsumer: boolean;
    promise: Promise<PtvMovieSearchCatalogPage>;
    settled: boolean;
};

type PtvMovieSearchCatalog = {
    actualRequestCountByParentId: Map<string, number>;
    createdAt: number;
    expiresAt: number;
    hydratedItems: Map<string, PtvItem>;
    inFlightPage?: PtvMovieSearchCatalogInFlightPage;
    itemLocations: Map<string, { index: number; page: number }>;
    items: PtvItem[];
    lastActualQueryKeys: string[];
    lastActualRequestUrl: string;
    lastUpdatedAt: number;
    nextStartIndex: number;
    pagesLoaded: number;
    status: PtvMovieSearchCatalogStatus;
    totalRecordCount: number;
    complete: boolean;
};

const MOVIE_SEARCH_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const MOVIE_SEARCH_CATALOG_CACHE_LIMIT = 16;
const MOVIE_SEARCH_CATALOG_FIELDS = [
    'DateCreated',
    'Name',
    'OriginalTitle',
    'ParentId',
    'Path',
    'PresentationUniqueKey',
    'ProductionYear',
    'ProviderIds',
    'SortName',
    'TopParentId',
    'Type'
].join(',');
const movieSearchCatalogs = new Map<string, PtvMovieSearchCatalog>();

function createCatalogAbortError() {
    const error = new Error('Movie search catalog request was cancelled.');

    error.name = 'AbortError';
    return error;
}

function throwIfCatalogAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw createCatalogAbortError();
}

function awaitCatalogAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) {
        void promise.catch(() => undefined);
        return Promise.reject(createCatalogAbortError());
    }

    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const cleanup = () => signal.removeEventListener('abort', onAbort);
        const onAbort = () => {
            if (settled) return;

            settled = true;
            cleanup();
            reject(createCatalogAbortError());
        };

        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            value => {
                if (settled) return;

                settled = true;
                cleanup();
                resolve(value);
            },
            error => {
                if (settled) return;

                settled = true;
                cleanup();
                reject(error);
            }
        );
    });
}

function getText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function getItemId(item: PtvItem) {
    return getText(item.Id);
}

function resolveCatalogOptions(options: PtvMovieSearchCatalogOptions): PtvMovieSearchCatalogOptions {
    const serverId = getPtvServerId(options.serverId);
    const userId = options.userId || getPtvCurrentUserId(serverId);

    return {
        ...options,
        serverId: serverId || null,
        userId: userId || null
    };
}

function getCatalogKey(options: PtvMovieSearchCatalogOptions) {
    if (!options.serverId || !options.userId) return null;

    return [
        options.serverId,
        options.userId,
        'movie-catalog-v1'
    ].join('|');
}

function getCatalogRequest(options: PtvMovieSearchCatalogOptions, startIndex: number): PtvMovieSearchCatalogRequest {
    const userId = options.userId || '';

    return {
        endpoint: userId ? `Users/${userId}/Items` : 'Users/[current-user]/Items',
        fields: MOVIE_SEARCH_CATALOG_FIELDS,
        limit: PTV_MOVIE_SEARCH_CATALOG_PAGE_SIZE,
        parentId: 'none',
        sortBy: 'DateCreated',
        sortOrder: 'Descending',
        startIndex,
        userId
    };
}

function createCatalog(): PtvMovieSearchCatalog {
    const now = Date.now();

    return {
        actualRequestCountByParentId: new Map(),
        complete: false,
        createdAt: now,
        expiresAt: now + MOVIE_SEARCH_CATALOG_CACHE_TTL_MS,
        hydratedItems: new Map(),
        itemLocations: new Map(),
        items: [],
        lastActualQueryKeys: [],
        lastActualRequestUrl: '',
        lastUpdatedAt: now,
        nextStartIndex: 0,
        pagesLoaded: 0,
        status: 'cold',
        totalRecordCount: 0
    };
}

function rememberCatalog(key: string, catalog: PtvMovieSearchCatalog) {
    movieSearchCatalogs.set(key, catalog);

    while (movieSearchCatalogs.size > MOVIE_SEARCH_CATALOG_CACHE_LIMIT) {
        const oldestKey = movieSearchCatalogs.keys().next().value as string | undefined;

        if (!oldestKey) break;
        movieSearchCatalogs.delete(oldestKey);
    }
}

function getOrCreateCatalog(options: PtvMovieSearchCatalogOptions) {
    const key = getCatalogKey(options);
    if (!key) return createCatalog();

    const existing = movieSearchCatalogs.get(key);

    if (existing) {
        if (existing.expiresAt > Date.now() || existing.inFlightPage) return existing;

        const refreshed = createCatalog();
        refreshed.status = 'refreshing';
        rememberCatalog(key, refreshed);
        return refreshed;
    }

    const catalog = createCatalog();
    rememberCatalog(key, catalog);
    return catalog;
}

function appendCatalogPage(
    catalog: PtvMovieSearchCatalog,
    result: PtvItemsResult<PtvItem>,
    startIndex: number
) {
    const pageItems = result.Items || [];
    const pageNumber = catalog.pagesLoaded + 1;

    pageItems.forEach((item, index) => {
        const id = getItemId(item);
        if (id && !catalog.itemLocations.has(id)) catalog.itemLocations.set(id, { index, page: pageNumber });
    });

    catalog.items = normalizePtvLibraryItems([...catalog.items, ...pageItems]).items;
    catalog.pagesLoaded += 1;
    catalog.nextStartIndex = startIndex + pageItems.length;
    catalog.totalRecordCount = Math.max(catalog.totalRecordCount, result.TotalRecordCount || 0, catalog.nextStartIndex);
    catalog.complete = pageItems.length < PTV_MOVIE_SEARCH_CATALOG_PAGE_SIZE
        || (catalog.totalRecordCount > 0 && catalog.nextStartIndex >= catalog.totalRecordCount);
    catalog.status = catalog.complete ? 'complete' : 'partial';
    catalog.expiresAt = Date.now() + MOVIE_SEARCH_CATALOG_CACHE_TTL_MS;
    catalog.lastUpdatedAt = Date.now();
}

function getActualParentId(params: PtvItemQuery) {
    const value = params.ParentId;

    return typeof value === 'string' && value.trim() ? value.trim() : 'none';
}

function getCatalogMatches(catalog: PtvMovieSearchCatalog, searchTerm: string, excludeItemIds: readonly string[] | undefined) {
    const excluded = new Set((excludeItemIds || []).map(id => String(id)));

    return filterPtvSearchRecoveryCandidates(catalog.items, searchTerm)
        .filter(item => !excluded.has(getItemId(item)));
}

function getCatalogRootSummary(items: PtvItem[]) {
    const rawTopParentIds = [...new Set(items.map(item => getText(item.TopParentId)).filter(Boolean))].sort();
    const labels = new Map(rawTopParentIds.map((id, index) => [id, `top-parent-${index + 1}`]));
    const countByTopParentId: Record<string, number> = {};
    const countByLogicalRoot: Record<string, number> = {};

    items.forEach(item => {
        const topParentLabel = labels.get(getText(item.TopParentId)) || 'top-parent-none';
        const logicalRoot = normalizePtvLibraryRoot(item).logicalRoot || 'unknown';

        countByTopParentId[topParentLabel] = (countByTopParentId[topParentLabel] || 0) + 1;
        countByLogicalRoot[logicalRoot] = (countByLogicalRoot[logicalRoot] || 0) + 1;
    });

    return {
        countByLogicalRoot,
        countByTopParentId,
        distinctTopParentIdCount: rawTopParentIds.length,
        physicalRootSample: Object.keys(countByLogicalRoot).sort().slice(0, 12),
        topParentIds: rawTopParentIds.map(id => labels.get(id) || 'top-parent-none')
    };
}

function retireCatalogPageRequest(
    catalog: PtvMovieSearchCatalog,
    request: PtvMovieSearchCatalogInFlightPage
) {
    if (catalog.inFlightPage === request) {
        catalog.inFlightPage = undefined;
    }
    if (!request.abortController.signal.aborted) {
        request.abortController.abort();
    }
}

function attachCatalogPageConsumer(
    catalog: PtvMovieSearchCatalog,
    request: PtvMovieSearchCatalogInFlightPage,
    networkRequest: boolean,
    signal?: AbortSignal
): Promise<PtvMovieSearchCatalogPage> {
    if (!signal) {
        request.hasUnabortableConsumer = true;
        return request.promise.then(page => ({ ...page, networkRequest }));
    }

    if (signal.aborted) {
        if (!request.hasUnabortableConsumer && request.abortableConsumers.size === 0) {
            retireCatalogPageRequest(catalog, request);
        }

        return Promise.reject(createCatalogAbortError());
    }

    const consumer = Symbol('movie-search-catalog-page');

    request.abortableConsumers.add(consumer);

    return new Promise<PtvMovieSearchCatalogPage>((resolve, reject) => {
        let settled = false;
        const detach = () => {
            signal.removeEventListener('abort', onAbort);
            request.abortableConsumers.delete(consumer);
        };
        const onAbort = () => {
            if (settled) return;

            settled = true;
            detach();
            reject(createCatalogAbortError());

            if (
                !request.settled
                && !request.hasUnabortableConsumer
                && request.abortableConsumers.size === 0
            ) {
                retireCatalogPageRequest(catalog, request);
            }
        };

        signal.addEventListener('abort', onAbort, { once: true });
        request.promise.then(
            page => {
                if (settled) return;

                settled = true;
                detach();
                resolve({ ...page, networkRequest });
            },
            error => {
                if (settled) return;

                settled = true;
                detach();
                reject(error);
            }
        );
    });
}

function loadNextCatalogPage(
    catalog: PtvMovieSearchCatalog,
    options: PtvMovieSearchCatalogOptions
): Promise<PtvMovieSearchCatalogPage> {
    throwIfCatalogAborted(options.signal);

    if (catalog.complete) {
        return Promise.resolve({
            items: [],
            networkRequest: false,
            startIndex: catalog.nextStartIndex
        });
    }

    if (catalog.inFlightPage) {
        return attachCatalogPageConsumer(catalog, catalog.inFlightPage, false, options.signal);
    }

    const startIndex = catalog.nextStartIndex;
    const request = getCatalogRequest(options, startIndex);
    const query: PtvItemQuery = {
        EnableImages: false,
        EnableUserData: false,
        Fields: request.fields,
        GroupItems: false,
        IncludeItemTypes: 'Movie',
        Limit: request.limit,
        Recursive: true,
        SortBy: request.sortBy,
        SortOrder: request.sortOrder,
        StartIndex: request.startIndex
    };

    const pageRequest: PtvMovieSearchCatalogInFlightPage = {
        abortController: createPtvAbortController(),
        abortableConsumers: new Set(),
        hasUnabortableConsumer: false,
        promise: undefined as unknown as Promise<PtvMovieSearchCatalogPage>,
        settled: false
    };
    const promise = getPtvItems<PtvItem>(query, {
        onRequest: actualRequest => {
            const actualQuery = actualRequest.params as PtvItemQuery;
            const parentId = getActualParentId(actualQuery);

            catalog.lastActualQueryKeys = Object.keys(actualQuery).sort();
            catalog.lastActualRequestUrl = actualRequest.endpoint;
            catalog.actualRequestCountByParentId.set(parentId, (catalog.actualRequestCountByParentId.get(parentId) || 0) + 1);
        },
        serverId: options.serverId,
        signal: pageRequest.abortController.signal,
        userId: options.userId
    }).then(result => {
        throwIfCatalogAborted(pageRequest.abortController.signal);
        const items = result.Items || [];
        appendCatalogPage(catalog, result, startIndex);
        return { items, networkRequest: true, startIndex };
    }).finally(() => {
        pageRequest.settled = true;
        if (catalog.inFlightPage === pageRequest) {
            catalog.inFlightPage = undefined;
        }
    });

    pageRequest.promise = promise;
    catalog.inFlightPage = pageRequest;
    return attachCatalogPageConsumer(catalog, pageRequest, true, options.signal);
}

async function hydrateCatalogMatches(
    catalog: PtvMovieSearchCatalog,
    matches: PtvItem[],
    options: PtvMovieSearchCatalogOptions
) {
    throwIfCatalogAborted(options.signal);
    const ids = matches
        .map(getItemId)
        .filter(id => id && !catalog.hydratedItems.has(id));

    if (!ids.length) return { count: 0, durationMs: 0 };

    const startedAt = performance.now();
    const result = await awaitCatalogAbort(getPtvItems<PtvItem>({
        EnableImages: true,
        EnableImageTypes: 'Primary',
        EnableUserData: true,
        Fields: options.fields || MOVIE_SEARCH_CATALOG_FIELDS,
        GroupItems: false,
        Ids: ids.join(','),
        ImageTypeLimit: 1,
        IncludeItemTypes: 'Movie',
        Recursive: true
    }, {
        serverId: options.serverId,
        signal: options.signal,
        userId: options.userId
    }), options.signal);

    throwIfCatalogAborted(options.signal);
    (result.Items || []).forEach(item => {
        const id = getItemId(item);
        if (id) catalog.hydratedItems.set(id, item);
    });

    return {
        count: ids.length,
        durationMs: Number((performance.now() - startedAt).toFixed(1))
    };
}

function getHydratedCatalogMatches(catalog: PtvMovieSearchCatalog, matches: PtvItem[]) {
    return matches.map(item => {
        const id = getItemId(item);
        const hydrated = id ? catalog.hydratedItems.get(id) : undefined;

        return hydrated ? { ...item, ...hydrated } : item;
    });
}

function scheduleCatalogPage(catalog: PtvMovieSearchCatalog, options: PtvMovieSearchCatalogOptions) {
    if (catalog.complete || catalog.inFlightPage || options.signal?.aborted) return;

    const idleApi = globalThis as typeof globalThis & {
        cancelIdleCallback?: (handle: number) => void;
        requestIdleCallback?: (callback: () => void) => number;
    };
    const requestIdleCallback = idleApi.requestIdleCallback;

    if (!requestIdleCallback) return;

    let pending = true;
    let idleHandle = 0;
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
        if (!pending) return;

        pending = false;
        idleApi.cancelIdleCallback?.(idleHandle);
        cleanup();
    };

    idleHandle = requestIdleCallback(() => {
        if (!pending) return;

        pending = false;
        cleanup();
        if (catalog.complete || catalog.inFlightPage || options.signal?.aborted) return;
        void loadNextCatalogPage(catalog, options).catch(() => undefined);
    });
    options.signal?.addEventListener('abort', onAbort, { once: true });
}

function getCatalogStopReason(
    catalog: PtvMovieSearchCatalog,
    matchCount: number,
    requestsThisSearch: number,
    foregroundPageBudget: number
): PtvMovieSearchCatalogStopReason {
    if (matchCount) return 'exact-match-found';
    if (catalog.complete) return 'exhausted';
    if (requestsThisSearch >= foregroundPageBudget) return 'page-budget';

    return 'empty-page';
}

export async function searchPtvMovieCatalog(
    searchTerm: string,
    requestedOptions: PtvMovieSearchCatalogOptions = {}
): Promise<PtvMovieSearchCatalogSearchResult> {
    const options = resolveCatalogOptions(requestedOptions);

    throwIfCatalogAborted(options.signal);
    const startedAt = performance.now();
    const catalog = getOrCreateCatalog(options);
    const initialStatus = catalog.status;
    let requestsThisSearch = 0;
    let cacheSource: PtvMovieSearchCatalogSearchResult['cacheSource'] = catalog.items.length ? 'memory' : 'network';
    let matches = getCatalogMatches(catalog, searchTerm, options.excludeItemIds);

    const foregroundPageBudget = Math.max(1, options.foregroundPageBudget || PTV_MOVIE_SEARCH_CATALOG_FOREGROUND_PAGE_BUDGET);

    while (!matches.length && !catalog.complete && requestsThisSearch < foregroundPageBudget) {
        throwIfCatalogAborted(options.signal);
        const page = await loadNextCatalogPage(catalog, options);
        throwIfCatalogAborted(options.signal);
        if (page.networkRequest) requestsThisSearch += 1;
        else if (!catalog.items.length) cacheSource = 'shared-promise';

        matches = getCatalogMatches(catalog, searchTerm, options.excludeItemIds);
    }

    const stopReason = getCatalogStopReason(
        catalog,
        matches.length,
        requestsThisSearch,
        foregroundPageBudget
    );

    const hydration = await hydrateCatalogMatches(catalog, matches, options);
    throwIfCatalogAborted(options.signal);
    if (matches.length) scheduleCatalogPage(catalog, options);
    const request = getCatalogRequest(options, Math.max(0, catalog.nextStartIndex - PTV_MOVIE_SEARCH_CATALOG_PAGE_SIZE));
    const actualParentId = catalog.actualRequestCountByParentId.size === 1
        ? [...catalog.actualRequestCountByParentId.keys()][0]
        : 'none';
    const rootSummary = getCatalogRootSummary(catalog.items);
    const matchedLocations = matches.map(item => {
        const location = catalog.itemLocations.get(getItemId(item));

        return location ? `page:${location.page},index:${location.index}` : 'page:cached,index:unknown';
    });

    return {
        actualHasParentId: [...catalog.actualRequestCountByParentId.keys()].some(parentId => parentId !== 'none'),
        actualParentId,
        actualQueryKeys: catalog.lastActualQueryKeys,
        actualRequestCountByParentId: Object.fromEntries(catalog.actualRequestCountByParentId),
        actualRequestUrl: catalog.lastActualRequestUrl,
        cacheAgeMs: Math.max(0, Date.now() - catalog.lastUpdatedAt),
        cacheSource: requestsThisSearch ? 'network' : cacheSource,
        cachedItemCount: catalog.items.length,
        exhausted: catalog.complete,
        hydrationCount: hydration.count,
        hydrationDurationMs: hydration.durationMs,
        items: getHydratedCatalogMatches(catalog, matches),
        matchedLocations,
        matchedNames: matches.map(item => getText(item.Name)).filter(Boolean).slice(0, 20),
        pageSize: PTV_MOVIE_SEARCH_CATALOG_PAGE_SIZE,
        pagesLoaded: catalog.pagesLoaded,
        request,
        requestsThisSearch,
        searchDurationMs: Number((performance.now() - startedAt).toFixed(1)),
        stopReason,
        status: initialStatus === 'refreshing' ? 'refreshing' : catalog.status,
        totalRecordCount: catalog.totalRecordCount,
        ...rootSummary
    };
}

export function resetPtvMovieSearchCatalogForTests() {
    movieSearchCatalogs.forEach(catalog => {
        catalog.inFlightPage?.abortController.abort();
    });
    movieSearchCatalogs.clear();
}
