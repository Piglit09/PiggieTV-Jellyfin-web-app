import {
    getCurrentPtvApiClient,
    getPtvCurrentUserId,
    getPtvItems,
    getPtvResumeItems,
    getPtvServerId,
    getPtvUserViews,
    serializePtvItemFieldProfile,
    type PtvItem,
    type PtvItemQuery,
    type PtvItemsResult,
    type PtvLibrary
} from '../../api';
import type { PtvBrowseMediaKind, PtvBrowseRoute } from './browseRoute';

export type PtvBrowseScopeStatus = 'error' | 'resolved' | 'unscoped';

export type PtvBrowseResolvedScope = Readonly<{
    alias: string;
    error: string;
    libraryIds: string[];
    libraryNames: string[];
    status: PtvBrowseScopeStatus;
}>;

export type PtvBrowseDirectoryEntry = Readonly<{
    count: number;
    id: string;
    name: string;
}>;

export type PtvFocusedBrowseResult = Readonly<{
    items: PtvItem[];
    totalRecordCount: number;
}>;

type PtvBrowseMetadataApiClient = ReturnType<typeof getCurrentPtvApiClient> & {
    getGenres?: (userId: string, query: PtvItemQuery) => Promise<PtvItemsResult<PtvItem>>;
    getStudios?: (userId: string, query: PtvItemQuery) => Promise<PtvItemsResult<PtvItem>>;
};

const PTV_BROWSE_SCOPE_NAMES: Record<string, Readonly<{
    collectionTypes: string[];
    kind: PtvBrowseMediaKind;
    names: string[];
}>> = {
    anime: {
        collectionTypes: ['tvshows'],
        kind: 'shows',
        names: ['anime', 'anime series', 'anime shows']
    },
    animemovies: {
        collectionTypes: ['movies'],
        kind: 'movies',
        names: ['anime films', 'anime movies', 'animemovies']
    },
    cartoons: {
        collectionTypes: ['tvshows'],
        kind: 'shows',
        names: ['cartoon shows', 'cartoons']
    }
};
const PTV_BROWSE_DIRECTORY_LIMIT = 500;
const PTV_BROWSE_FOCUSED_CACHE_LIMIT = 80;
const PTV_BROWSE_FOCUSED_CACHE_MS = 2 * 60 * 1000;
const PTV_BROWSE_TRENDING_POOL_LIMIT = 200;
const PTV_BROWSE_TRENDING_CACHE_MS = 5 * 60 * 1000;
const scopeDiscoveryCache = new Map<string, Promise<PtvLibrary[]>>();
const focusedPageCache = new Map<string, Readonly<{
    expiresAt: number;
    result: Promise<PtvFocusedBrowseResult>;
}>>();
const trendingCache = new Map<string, Readonly<{
    expiresAt: number;
    items: PtvItem[];
}>>();

const UNSCOPED_BROWSE_SCOPE: PtvBrowseResolvedScope = {
    alias: '',
    error: '',
    libraryIds: [],
    libraryNames: [],
    status: 'unscoped'
};

function normalizeBrowseKey(value: unknown) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function getBrowseText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function getBrowseNumber(value: unknown) {
    const parsed = typeof value === 'number' ? value : Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
}

function getScopeDiscoveryKey() {
    return `${getPtvServerId() || 'server'}:${getPtvCurrentUserId() || 'user'}`;
}

export function getPtvFocusedBrowseCacheKey(
    route: PtvBrowseRoute,
    scope: PtvBrowseResolvedScope,
    metadataId = ''
) {
    return [
        route.kind,
        route.view,
        route.scopeAlias || 'all',
        [...scope.libraryIds].sort((left, right) => left.localeCompare(right)).join(','),
        route.genre,
        route.studio,
        route.network,
        route.collectionId,
        route.seasonParentId,
        metadataId,
        route.query,
        route.sortBy,
        route.sortOrder,
        route.page,
        route.pageSize
    ].join('|');
}

function trimFocusedPageCache() {
    while (focusedPageCache.size > PTV_BROWSE_FOCUSED_CACHE_LIMIT) {
        const oldestKey = focusedPageCache.keys().next().value;

        if (!oldestKey) return;
        focusedPageCache.delete(oldestKey);
    }
}

async function getBrowseLibraries() {
    const key = getScopeDiscoveryKey();
    const cached = scopeDiscoveryCache.get(key);

    if (cached) return cached;

    const request = getPtvUserViews()
        .then(result => result.Items || [])
        .catch(error => {
            scopeDiscoveryCache.delete(key);
            throw error;
        });

    scopeDiscoveryCache.set(key, request);
    return request;
}

function libraryMatchesScope(library: PtvLibrary, route: PtvBrowseRoute) {
    const definition = PTV_BROWSE_SCOPE_NAMES[route.scopeAlias];
    const libraryId = normalizeBrowseKey(library.Id).replace(/ /g, '');
    const requestedId = normalizeBrowseKey(route.scopeAlias).replace(/ /g, '');

    if (libraryId && libraryId === requestedId) return true;
    if (!definition || definition.kind !== route.kind) return false;

    const collectionType = normalizeBrowseKey(library.CollectionType).replace(/ /g, '');
    const libraryName = normalizeBrowseKey(library.Name);

    return definition.collectionTypes.includes(collectionType)
        && definition.names.some(name => normalizeBrowseKey(name) === libraryName);
}

export async function resolvePtvBrowseScope(route: PtvBrowseRoute): Promise<PtvBrowseResolvedScope> {
    if (!route.scopeAlias) return UNSCOPED_BROWSE_SCOPE;

    try {
        const libraries = await getBrowseLibraries();
        const matches = libraries.filter(library => libraryMatchesScope(library, route));
        const libraryIds = matches.map(library => getBrowseText(library.Id)).filter(Boolean);

        if (!libraryIds.length) {
            return {
                alias: route.scopeAlias,
                error: `The ${route.scopeAlias} library is not available for this account.`,
                libraryIds: [],
                libraryNames: [],
                status: 'error'
            };
        }

        return {
            alias: route.scopeAlias,
            error: '',
            libraryIds,
            libraryNames: matches.map(library => getBrowseText(library.Name)).filter(Boolean),
            status: 'resolved'
        };
    } catch {
        return {
            alias: route.scopeAlias,
            error: 'Library discovery failed. Try this view again.',
            libraryIds: [],
            libraryNames: [],
            status: 'error'
        };
    }
}

export function applyPtvBrowseScope(query: PtvItemQuery, scope: PtvBrowseResolvedScope): PtvItemQuery {
    if (scope.status !== 'resolved' || !scope.libraryIds.length) return { ...query };
    if (query.ParentId) {
        return {
            ...query,
            AncestorIds: scope.libraryIds.join(',')
        };
    }

    if (scope.libraryIds.length === 1) {
        return {
            ...query,
            ParentId: scope.libraryIds[0]
        };
    }

    return {
        ...query,
        AncestorIds: scope.libraryIds.join(',')
    };
}

function getFocusedIncludeItemTypes(route: PtvBrowseRoute) {
    if (route.kind === 'collections') return 'BoxSet';
    if (route.view === 'season') return 'Season';
    if (route.view === 'continue' && route.kind === 'shows') return 'Episode,Series';

    return route.kind === 'shows' ? 'Series' : 'Movie';
}

function getDirectoryIncludeItemTypes(route: PtvBrowseRoute) {
    if (route.kind === 'shows') return 'Series';
    if (route.kind === 'collections') return 'BoxSet';

    return 'Movie';
}

export function buildPtvFocusedBrowseQuery(
    route: PtvBrowseRoute,
    scope: PtvBrowseResolvedScope,
    metadataId = ''
): PtvItemQuery {
    const query: PtvItemQuery = {
        EnableImages: true,
        EnableImageTypes: 'Primary',
        EnableTotalRecordCount: true,
        Fields: serializePtvItemFieldProfile(route.kind === 'collections' ? 'COLLECTION_FIELDS' : 'CARD_FIELDS'),
        ImageTypeLimit: 1,
        IncludeItemTypes: getFocusedIncludeItemTypes(route),
        Limit: route.pageSize,
        Recursive: route.view !== 'season',
        SortBy: route.sortBy,
        SortOrder: route.sortOrder,
        StartIndex: route.page * route.pageSize
    };

    if (route.view === 'continue') query.Filters = 'IsResumable';
    if (route.view === 'genre' && route.genre) query.Genres = route.genre;
    if ((route.view === 'studio' || route.view === 'network') && metadataId) query.StudioIds = metadataId;
    if (route.collectionId) query.ParentId = route.collectionId;
    if (route.view === 'season' && route.seasonParentId) query.ParentId = route.seasonParentId;
    if (route.query) query.SearchTerm = route.query;

    return applyPtvBrowseScope(query, scope);
}

function mergeDirectoryEntries(results: PtvItemsResult<PtvItem>[]) {
    const entries = new Map<string, PtvBrowseDirectoryEntry>();

    results.forEach(result => {
        (result.Items || []).forEach(item => {
            const name = getBrowseText(item.Name);
            const id = getBrowseText(item.Id);
            const key = normalizeBrowseKey(name);

            if (!key || !id) return;

            const count = getBrowseNumber(item.ChildCount);
            const existing = entries.get(key);

            entries.set(key, {
                count: Math.max(count, existing?.count || 0),
                id: existing?.id || id,
                name: existing?.name || name
            });
        });
    });

    return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadPtvBrowseDirectory(
    route: PtvBrowseRoute,
    scope: PtvBrowseResolvedScope,
    type: 'genre' | 'studio'
): Promise<PtvBrowseDirectoryEntry[]> {
    const apiClient = getCurrentPtvApiClient() as PtvBrowseMetadataApiClient;
    const userId = getPtvCurrentUserId();
    const method = type === 'genre' ? apiClient?.getGenres : apiClient?.getStudios;

    if (!userId || !method) throw new Error(`${type === 'genre' ? 'Genre' : 'Studio'} browsing is unavailable.`);

    const baseQuery: PtvItemQuery = {
        EnableTotalRecordCount: true,
        IncludeItemTypes: getDirectoryIncludeItemTypes(route),
        Limit: PTV_BROWSE_DIRECTORY_LIMIT,
        Recursive: true,
        SortBy: 'SortName',
        SortOrder: 'Ascending'
    };
    const scopedQueries = scope.status === 'resolved' && scope.libraryIds.length ?
        scope.libraryIds.map(libraryId => ({ ...baseQuery, ParentId: libraryId })) :
        [baseQuery];
    const results = await Promise.all(scopedQueries.map(query => method.call(apiClient, userId, query)));

    return mergeDirectoryEntries(results);
}

export function findExactPtvBrowseDirectoryEntry(entries: PtvBrowseDirectoryEntry[], value: string) {
    const key = normalizeBrowseKey(value);

    return entries.find(entry => normalizeBrowseKey(entry.name) === key) || null;
}

function getTrendingTimestamp(item: PtvItem) {
    const userData = item.UserData || {};
    const value = getBrowseText(userData.LastPlayedDate || item.DateCreated || item.PremiereDate);
    const timestamp = value ? Date.parse(value) : 0;

    return Number.isFinite(timestamp) ? timestamp : 0;
}

export function getPtvBrowseTrendingScore(item: PtvItem, now = Date.now()) {
    const userData = item.UserData || {};
    const ageDays = getTrendingTimestamp(item) ? Math.max(0, (now - getTrendingTimestamp(item)) / 86_400_000) : 3650;
    const recency = Math.max(0, 10 - Math.min(10, ageDays / 18));

    return getBrowseNumber(userData.PlayCount) * 20
        + (userData.IsFavorite ? 14 : 0)
        + (userData.Played ? 8 : 0)
        + getBrowseNumber(item.CommunityRating) * 2
        + getBrowseNumber(item.CriticRating) / 10
        + recency;
}

export function rankPtvBrowseTrendingItems(items: PtvItem[], now = Date.now()) {
    return [...items].sort((left, right) => {
        const scoreDifference = getPtvBrowseTrendingScore(right, now) - getPtvBrowseTrendingScore(left, now);

        if (scoreDifference) return scoreDifference;

        const nameDifference = getBrowseText(left.SortName || left.Name).localeCompare(getBrowseText(right.SortName || right.Name));

        return nameDifference || getBrowseText(left.Id).localeCompare(getBrowseText(right.Id));
    });
}

async function loadTrendingPool(route: PtvBrowseRoute, scope: PtvBrowseResolvedScope) {
    const scopeKey = [...scope.libraryIds].sort((left, right) => left.localeCompare(right)).join(',');
    const cacheKey = `${route.kind}|${route.scopeAlias || 'all'}|${scopeKey}|${route.genre}|${route.studio}|${route.network}|${route.query}`;
    const cached = trendingCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) return cached.items;

    const baseQuery = buildPtvFocusedBrowseQuery({ ...route, page: 0 }, scope);
    const result = await getPtvItems<PtvItem>({
        ...baseQuery,
        Fields: `${baseQuery.Fields},CommunityRating,CriticRating`,
        Limit: PTV_BROWSE_TRENDING_POOL_LIMIT,
        SortBy: 'DatePlayed,DateCreated',
        SortOrder: 'Descending',
        StartIndex: 0
    });
    const ranked = rankPtvBrowseTrendingItems(result.Items || []);

    trendingCache.set(cacheKey, {
        expiresAt: Date.now() + PTV_BROWSE_TRENDING_CACHE_MS,
        items: ranked
    });

    if (trendingCache.size > 12) {
        const oldestKey = trendingCache.keys().next().value;

        if (oldestKey) trendingCache.delete(oldestKey);
    }

    return ranked;
}

async function fetchPtvFocusedBrowsePage(
    route: PtvBrowseRoute,
    scope: PtvBrowseResolvedScope,
    metadataId = ''
): Promise<PtvFocusedBrowseResult> {
    if (route.view === 'trending') {
        const ranked = await loadTrendingPool(route, scope);
        const startIndex = route.page * route.pageSize;

        return {
            items: ranked.slice(startIndex, startIndex + route.pageSize),
            totalRecordCount: ranked.length
        };
    }

    const query = buildPtvFocusedBrowseQuery(route, scope, metadataId);
    const result = route.view === 'continue' ?
        await getPtvResumeItems<PtvItem>(query) :
        await getPtvItems<PtvItem>(query);

    return {
        items: result.Items || [],
        totalRecordCount: result.TotalRecordCount ?? (result.Items || []).length
    };
}

export async function loadPtvFocusedBrowsePage(
    route: PtvBrowseRoute,
    scope: PtvBrowseResolvedScope,
    metadataId = ''
): Promise<PtvFocusedBrowseResult> {
    const cacheKey = getPtvFocusedBrowseCacheKey(route, scope, metadataId);
    const cached = focusedPageCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) return cached.result;
    if (cached) focusedPageCache.delete(cacheKey);

    const result = fetchPtvFocusedBrowsePage(route, scope, metadataId)
        .catch(error => {
            focusedPageCache.delete(cacheKey);
            throw error;
        });

    focusedPageCache.set(cacheKey, {
        expiresAt: Date.now() + PTV_BROWSE_FOCUSED_CACHE_MS,
        result
    });
    trimFocusedPageCache();

    return result;
}

export function resetPtvBrowseDataCachesForTests() {
    focusedPageCache.clear();
    scopeDiscoveryCache.clear();
    trendingCache.clear();
}
