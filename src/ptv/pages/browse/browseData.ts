import {
    getPtvCurrentUserId,
    getPtvItems,
    getPtvResumeItems,
    getPtvServerId,
    getPtvUserViews,
    requestPtvJson,
    serializePtvItemFieldProfile,
    type PtvItem,
    type PtvItemQuery,
    type PtvItemsResult,
    type PtvLibrary
} from '../../api';
import type { PtvBrowseMediaKind, PtvBrowseRoute } from './browseRoute';
import { getPtvFocusedBrowseLoaderKey } from './focusedBrowseLoader';
import { normalizePtvLibraryItems } from '../../services/libraryRootNormalizer';
import { getPtvDisplayIdentityKey } from '../../services/displayIdentity';

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

const PTV_BROWSE_SCOPE_NAMES: Record<string, Readonly<{
    collectionTypes: string[];
    kind: PtvBrowseMediaKind;
    names: string[];
}>> = {
    movies: {
        collectionTypes: ['movies'],
        kind: 'movies',
        names: ['movies', 'movies library']
    },
    shows: {
        collectionTypes: ['tvshows'],
        kind: 'shows',
        names: ['shows', 'shows library', 'tv shows']
    },
    anime: {
        collectionTypes: ['tvshows'],
        kind: 'shows',
        names: ['anime', 'anime library']
    },
    animemovies: {
        collectionTypes: ['movies'],
        kind: 'movies',
        names: ['ani movies', 'anime movies', 'animemovies', 'animovies', 'animovies library']
    },
    cartoons: {
        collectionTypes: ['tvshows'],
        kind: 'shows',
        names: ['cartoons', 'cartoons library']
    }
};
const PTV_BROWSE_DIRECTORY_LIMIT = 500;
const PTV_BROWSE_FOCUSED_CACHE_LIMIT = 80;
const PTV_BROWSE_FOCUSED_CACHE_MS = 2 * 60 * 1000;
const PTV_BROWSE_SCOPE_CACHE_LIMIT = 8;
const PTV_BROWSE_SCOPE_CACHE_MS = 2 * 60 * 1000;
const PTV_BROWSE_TRENDING_POOL_LIMIT = 200;
const PTV_BROWSE_TRENDING_CACHE_MS = 5 * 60 * 1000;
type PtvBrowseMetadataCacheEntry =
    | Readonly<{
        expiresAt: number;
        kind: 'directory';
        value: PtvBrowseDirectoryEntry[];
    }>
    | Readonly<{
        expiresAt: number;
        kind: 'libraries';
        value: PtvLibrary[];
    }>;

const browseMetadataCache = new Map<string, PtvBrowseMetadataCacheEntry>();
const focusedPageCache = new Map<string, Readonly<{
    expiresAt: number;
    result: PtvFocusedBrowseResult;
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

function getScopeDiscoveryIdentity() {
    const serverId = getPtvServerId();
    const userId = getPtvCurrentUserId(serverId);

    return {
        key: getPtvDisplayIdentityKey(serverId, userId),
        serverId,
        userId
    };
}

export function getPtvBrowseScopeIdentityKey() {
    return getScopeDiscoveryIdentity().key;
}

export function isPtvBrowseScopeIdentityCurrent(identityKey: string | null) {
    return getPtvBrowseScopeIdentityKey() === identityKey;
}

export function getPtvFocusedBrowseCacheKey(
    route: PtvBrowseRoute,
    scope: PtvBrowseResolvedScope,
    metadataId = ''
) {
    const identityKey = getPtvDisplayIdentityKey(getPtvServerId(), getPtvCurrentUserId())
        || 'identity-pending';

    return `${identityKey}|${getPtvFocusedBrowseLoaderKey(route, scope, metadataId)}`;
}

function trimFocusedPageCache() {
    while (focusedPageCache.size > PTV_BROWSE_FOCUSED_CACHE_LIMIT) {
        const oldestKey = focusedPageCache.keys().next().value;

        if (!oldestKey) return;
        focusedPageCache.delete(oldestKey);
    }
}

function trimBrowseMetadataCache() {
    while (browseMetadataCache.size > PTV_BROWSE_SCOPE_CACHE_LIMIT) {
        const oldestKey = browseMetadataCache.keys().next().value;

        if (!oldestKey) return;
        browseMetadataCache.delete(oldestKey);
    }
}

function getEffectiveBrowseScopeAlias(route: PtvBrowseRoute) {
    if (route.scopeAlias) return route.scopeAlias;
    if (route.kind === 'movies') return 'movies';
    if (route.kind === 'shows') return 'shows';

    return '';
}

function createBrowseScopeAbortError() {
    const error = new Error('Browse scope discovery was cancelled.');

    error.name = 'AbortError';
    return error;
}

function createBrowseDirectoryAbortError() {
    const error = new Error('Browse directory work was cancelled.');

    error.name = 'AbortError';
    return error;
}

function waitForPtvBrowseMetadataConsumer<T>(
    cacheOwner: Promise<T>,
    signal?: AbortSignal
): Promise<T> {
    if (!signal) return cacheOwner;
    if (signal.aborted) return Promise.reject(createBrowseDirectoryAbortError());

    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const cleanup = () => signal.removeEventListener('abort', onAbort);
        const onAbort = () => {
            if (settled) return;

            settled = true;
            cleanup();
            reject(createBrowseDirectoryAbortError());
        };

        signal.addEventListener('abort', onAbort, { once: true });
        cacheOwner.then(
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

async function getBrowseLibraries(signal?: AbortSignal) {
    if (signal?.aborted) throw createBrowseScopeAbortError();

    const identity = getScopeDiscoveryIdentity();
    const cached = identity.key ? browseMetadataCache.get(identity.key) : undefined;

    if (cached?.kind === 'libraries' && cached.expiresAt > Date.now()) return cached.value;
    if (cached && identity.key) browseMetadataCache.delete(identity.key);

    const result = await getPtvUserViews({
        serverId: identity.serverId || null,
        signal,
        userId: identity.userId || null
    });

    if (signal?.aborted) throw createBrowseScopeAbortError();

    const libraries = result.Items || [];

    if (identity.key) {
        browseMetadataCache.set(identity.key, {
            expiresAt: Date.now() + PTV_BROWSE_SCOPE_CACHE_MS,
            kind: 'libraries',
            value: libraries
        });
        trimBrowseMetadataCache();
    }

    return libraries;
}

function libraryMatchesScope(library: PtvLibrary, route: PtvBrowseRoute, scopeAlias: string) {
    const definition = PTV_BROWSE_SCOPE_NAMES[scopeAlias];
    const libraryId = normalizeBrowseKey(library.Id).replace(/ /g, '');
    const requestedId = normalizeBrowseKey(scopeAlias).replace(/ /g, '');

    if (libraryId && libraryId === requestedId) return true;
    if (!definition || definition.kind !== route.kind) return false;

    const collectionType = normalizeBrowseKey(library.CollectionType).replace(/ /g, '');
    const libraryName = normalizeBrowseKey(library.Name);

    return definition.collectionTypes.includes(collectionType)
        && definition.names.some(name => normalizeBrowseKey(name) === libraryName);
}

export async function resolvePtvBrowseScope(
    route: PtvBrowseRoute,
    signal?: AbortSignal
): Promise<PtvBrowseResolvedScope> {
    const scopeAlias = getEffectiveBrowseScopeAlias(route);

    if (!scopeAlias) return UNSCOPED_BROWSE_SCOPE;

    try {
        const libraries = await getBrowseLibraries(signal);
        const matches = libraries.filter(library => libraryMatchesScope(library, route, scopeAlias));
        const libraryIds = matches.map(library => getBrowseText(library.Id)).filter(Boolean);

        if (!libraryIds.length) {
            return {
                alias: scopeAlias,
                error: `The ${scopeAlias} library is not available for this account.`,
                libraryIds: [],
                libraryNames: [],
                status: 'error'
            };
        }

        return {
            alias: scopeAlias,
            error: '',
            libraryIds,
            libraryNames: matches.map(library => getBrowseText(library.Name)).filter(Boolean),
            status: 'resolved'
        };
    } catch (error) {
        if (
            signal?.aborted
            || (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
        ) {
            throw error;
        }

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
    const resolveDirectoryEntryCount = (item: unknown) => {
        const value = item as Record<string, unknown>;

        return Math.max(
            getBrowseNumber(value.ChildCount),
            getBrowseNumber(value.ItemCount),
            getBrowseNumber(value.ItemCountNum),
            getBrowseNumber((value as Record<string, unknown>).MovieCount),
            getBrowseNumber((value as Record<string, unknown>).SeriesCount),
            getBrowseNumber((value as Record<string, unknown>).EpisodeCount),
            getBrowseNumber((value as Record<string, unknown>).StudioCount),
            getBrowseNumber(value.TotalRecordCount)
        );
    };

    results.forEach(result => {
        (result.Items || []).forEach(item => {
            const name = getBrowseText(item.Name);
            const id = getBrowseText(item.Id);
            const key = normalizeBrowseKey(name);

            if (!key || !id) return;

            const count = resolveDirectoryEntryCount(item);
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

function getPtvBrowseDirectoryCacheKey(
    route: PtvBrowseRoute,
    scope: PtvBrowseResolvedScope,
    type: 'genre' | 'studio',
    identityKey = getPtvBrowseScopeIdentityKey()
) {
    if (!identityKey) return null;

    const libraryIds = scope.libraryIds
        .map(libraryId => encodeURIComponent(libraryId))
        .sort((left, right) => left.localeCompare(right))
        .join(',');

    return [
        'directory',
        identityKey,
        route.kind,
        type,
        scope.status,
        encodeURIComponent(scope.alias),
        libraryIds
    ].join('|');
}

export async function loadPtvBrowseDirectory(
    route: PtvBrowseRoute,
    scope: PtvBrowseResolvedScope,
    type: 'genre' | 'studio',
    signal?: AbortSignal
): Promise<PtvBrowseDirectoryEntry[]> {
    if (signal?.aborted) throw createBrowseDirectoryAbortError();

    const identity = getScopeDiscoveryIdentity();
    const { serverId, userId } = identity;

    if (!userId) throw new Error(`${type === 'genre' ? 'Genre' : 'Studio'} browsing is unavailable.`);

    const cacheKey = getPtvBrowseDirectoryCacheKey(route, scope, type, identity.key);
    const cached = cacheKey ? browseMetadataCache.get(cacheKey) : undefined;

    if (cached?.kind === 'directory' && cached.expiresAt > Date.now()) {
        return waitForPtvBrowseMetadataConsumer(Promise.resolve(cached.value), signal);
    }
    if (cached && cacheKey) browseMetadataCache.delete(cacheKey);

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
    const endpoint = type === 'genre' ? 'Genres' : 'Studios';
    const cacheOwner = Promise.all(scopedQueries.map(query => (
        requestPtvJson<PtvItemsResult<PtvItem>>(endpoint, {
            params: {
                ...query,
                userId
            },
            serverId: serverId || null
        })
    )))
        .then(mergeDirectoryEntries)
        .then(directory => {
            if (cacheKey && getPtvBrowseDirectoryCacheKey(route, scope, type) === cacheKey) {
                browseMetadataCache.set(cacheKey, {
                    expiresAt: Date.now() + PTV_BROWSE_SCOPE_CACHE_MS,
                    kind: 'directory',
                    value: directory
                });
                trimBrowseMetadataCache();
            }

            return directory;
        });

    return waitForPtvBrowseMetadataConsumer(cacheOwner, signal);
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

async function loadTrendingPool(
    route: PtvBrowseRoute,
    scope: PtvBrowseResolvedScope,
    signal?: AbortSignal
) {
    const identityKey = getPtvDisplayIdentityKey(getPtvServerId(), getPtvCurrentUserId());
    const scopeKey = [...scope.libraryIds].sort((left, right) => left.localeCompare(right)).join(',');
    const cacheKey = `${identityKey || 'identity-pending'}|${route.kind}|${route.scopeAlias || 'all'}|${scopeKey}|${route.genre}|${route.studio}|${route.network}|${route.query}`;
    const cached = identityKey ? trendingCache.get(cacheKey) : undefined;

    if (cached && cached.expiresAt > Date.now()) return cached.items;

    const baseQuery = buildPtvFocusedBrowseQuery({ ...route, page: 0 }, scope);
    const result = await getPtvItems<PtvItem>({
        ...baseQuery,
        Fields: `${baseQuery.Fields},CommunityRating,CriticRating`,
        Limit: PTV_BROWSE_TRENDING_POOL_LIMIT,
        SortBy: 'DatePlayed,DateCreated',
        SortOrder: 'Descending',
        StartIndex: 0
    }, {
        signal
    });
    const ranked = rankPtvBrowseTrendingItems(normalizePtvLibraryItems(result.Items || []).items);

    if (identityKey) {
        trendingCache.set(cacheKey, {
            expiresAt: Date.now() + PTV_BROWSE_TRENDING_CACHE_MS,
            items: ranked
        });
    }

    if (trendingCache.size > 12) {
        const oldestKey = trendingCache.keys().next().value;

        if (oldestKey) trendingCache.delete(oldestKey);
    }

    return ranked;
}

async function fetchPtvFocusedBrowsePage(
    route: PtvBrowseRoute,
    scope: PtvBrowseResolvedScope,
    metadataId = '',
    signal?: AbortSignal
): Promise<PtvFocusedBrowseResult> {
    if (route.view === 'trending') {
        const ranked = await loadTrendingPool(route, scope, signal);
        const startIndex = route.page * route.pageSize;

        return {
            items: ranked.slice(startIndex, startIndex + route.pageSize),
            totalRecordCount: ranked.length
        };
    }

    const query = buildPtvFocusedBrowseQuery(route, scope, metadataId);
    const result = route.view === 'continue' ?
        await getPtvResumeItems<PtvItem>(query, { signal }) :
        await getPtvItems<PtvItem>(query, { signal });

    const normalized = normalizePtvLibraryItems(result.Items || []);

    return {
        items: normalized.items,
        totalRecordCount: Math.max(normalized.items.length, result.TotalRecordCount ?? normalized.items.length)
    };
}

export async function loadPtvFocusedBrowsePage(
    route: PtvBrowseRoute,
    scope: PtvBrowseResolvedScope,
    metadataId = '',
    signal?: AbortSignal
): Promise<PtvFocusedBrowseResult> {
    const identityKey = getPtvDisplayIdentityKey(getPtvServerId(), getPtvCurrentUserId());
    const cacheKey = getPtvFocusedBrowseCacheKey(route, scope, metadataId);
    const cached = identityKey ? focusedPageCache.get(cacheKey) : undefined;

    if (cached && cached.expiresAt > Date.now()) return cached.result;
    if (cached) focusedPageCache.delete(cacheKey);

    const result = await fetchPtvFocusedBrowsePage(route, scope, metadataId, signal);

    if (identityKey && !signal?.aborted) {
        focusedPageCache.set(cacheKey, {
            expiresAt: Date.now() + PTV_BROWSE_FOCUSED_CACHE_MS,
            result
        });
        trimFocusedPageCache();
    }

    return result;
}

export async function loadPtvFocusedBrowsePages(
    route: PtvBrowseRoute,
    scope: PtvBrowseResolvedScope,
    metadataId = '',
    signal?: AbortSignal
): Promise<PtvFocusedBrowseResult> {
    const pages = await Promise.all(Array.from({ length: route.page + 1 }, (_, page) => (
        loadPtvFocusedBrowsePage({ ...route, page }, scope, metadataId, signal)
    )));
    const itemsById = new Map<string, PtvItem>();

    pages.forEach(page => {
        page.items.forEach(item => {
            const itemId = getBrowseText(item.Id);

            if (itemId && !itemsById.has(itemId)) itemsById.set(itemId, item);
        });
    });

    const items = normalizePtvLibraryItems([...itemsById.values()]).items;

    return {
        items,
        totalRecordCount: Math.max(items.length, ...pages.map(page => page.totalRecordCount))
    };
}

export function resetPtvBrowseDataCachesForTests() {
    focusedPageCache.clear();
    browseMetadataCache.clear();
    trendingCache.clear();
}
