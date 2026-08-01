import {
    cleanPtvQuery,
    getPtvCurrentUserId,
    getPtvItem,
    getPtvItemImageCandidates,
    getPtvApiUrl,
    getPtvItems,
    getPtvServerId,
    getPtvUserViews,
    type PtvItemQuery,
    type PtvLibrary
} from '../../api';
import { createPtvAbortController } from '../../core/abortController';
import { recordPtvEvent, recordPtvTiming, timePtvAsync } from '../../core/observability';
import {
    deletePtvLibraryIndexCacheByPrefix,
    PTV_LIBRARY_INDEX_CACHE_TTL_MS,
    readPtvLibraryIndexCache,
    writePtvLibraryIndexCache
} from '../../utils/libraryIndexCache';
import {
    clearPtvLocalStorageByPrefix,
    readPtvLocalStorageJson,
    removePtvLocalStorageKey,
    writePtvLocalStorageJson
} from '../../services/runtimeStability';
import { runPtvScheduledRequests } from '../../utils/ptvMediaRequestScheduler';

import { getPtvReadingMetadataStats } from './booksMetadataProviders';
import {
    getPtvReadingExtension,
    getPtvReadingFormat,
    getPtvReadingItemKind,
    hasPtvReadingComicKeyword,
    hasPtvReadingMangaKeyword,
    isPtvReadingKindMatch
} from './booksClassification';
import {
    createPtvReadingProgressiveLoader,
    type PtvReadingProgressiveLoader,
    shouldPreservePtvReadingIndex,
    yieldPtvReadingIndexWork
} from './readingProgressiveIndex';
import {
    canUsePtvReadingHomeCache,
    isPtvReadingFullHomeCache
} from './readingCachePolicy';
import type {
    PtvReadingCacheDiagnostic,
    PtvReadingHomeData,
    PtvReadingItem,
    PtvReadingItemKind,
    PtvReadingLibraryDebug,
    PtvReadingLibraryDiagnostic,
    PtvReadingLibraryIndex,
    PtvReadingLibraryScope,
    PtvReadingRouteKind,
    PtvReadingSection,
    PtvReadingSectionDiagnostic
} from './booksTypes';

type PtvReadingImageType = 'Backdrop' | 'Primary' | 'Thumb';

const READING_SHELF_FIELDS = [
    'CanDownload',
    'Container',
    'DateCreated',
    'Genres',
    'ImageTags',
    'MediaSources',
    'ParentId',
    'ParentPrimaryImageItemId',
    'ParentPrimaryImageTag',
    'Path',
    'People',
    'PremiereDate',
    'PrimaryImageAspectRatio',
    'ProductionYear',
    'ProviderIds',
    'SeriesId',
    'SortName',
    'Tags'
].join(',');

const READING_PROBE_FIELDS = [
    'Container',
    'DateCreated',
    'MediaSources',
    'Path',
    'SortName'
].join(',');

const READING_HOME_CACHE_TTL_MS = 5 * 60 * 1000;
const READING_HOME_STALE_TTL_MS = 24 * 60 * 60 * 1000;
const READING_IMAGE_QUERY = {
    EnableImages: true,
    EnableImageTypes: 'Primary,Backdrop,Thumb',
    ImageTypeLimit: 1
} as const;
const READING_NO_IMAGE_QUERY = {
    EnableImages: false,
    ImageTypeLimit: 0
} as const;
const READING_INITIAL_LIMIT = 20;
const DEFAULT_READING_LIMIT = 32;
const READING_HOME_LIBRARY_PREVIEW_LIMIT = 50;
const READING_LIBRARY_PAGE_SIZE = 50;
const READING_LIBRARY_INITIAL_INDEX_ITEM_COUNT = READING_LIBRARY_PAGE_SIZE;
const READING_LIBRARY_COUNT_TIMEOUT_MS = 10_000;
const READING_SHELF_TIMEOUT_MS = 20_000;
const READING_OPTIONAL_SHELF_TIMEOUT_MS = 7_000;
const READING_CONTINUE_LIMIT = 12;
const READING_LIBRARY_INDEX_CACHE_SCHEMA_VERSION = 4;
const READING_HOME_STORAGE_SCHEMA_VERSION = 5;
const READING_HOME_SCOPE_STORAGE_SCHEMA_VERSION = 1;
const BOOKS_KEYWORDS = /\b(?:books?|ebooks?|novels?|reader|reading|pdfs?|docs?)\b/i;
const PUBLICATION_KEYWORDS = /\b(?:documents?|magazines?|publications?|literature|bookshelf)\b/i;
const READING_PLACEHOLDER_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent([
    '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="640" viewBox="0 0 420 640">',
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#67e8f9"/><stop offset=".48" stop-color="#facc15"/><stop offset="1" stop-color="#fb7185"/></linearGradient></defs>',
    '<rect width="420" height="640" rx="26" fill="#07070a"/>',
    '<rect x="42" y="58" width="336" height="524" rx="18" fill="url(#g)" opacity=".32"/>',
    '<path d="M124 150h172v24H124zm0 64h172v16H124zm0 42h134v16H124zm0 42h156v16H124z" fill="#fff" opacity=".88"/>',
    '<path d="M102 105h216a28 28 0 0 1 28 28v374a28 28 0 0 1-28 28H102z" fill="none" stroke="#fff" stroke-width="16" opacity=".7"/>',
    '</svg>'
].join(''))}`;

type ReadingHomeCacheEntry = {
    createdAt: number;
    data: PtvReadingHomeData;
    expiresAt: number;
};

type ReadingHomeStorageEntry = ReadingHomeCacheEntry & {
    key: string;
    schemaVersion: number;
};

type ReadingHomeStorageScope = {
    cacheKey: string;
    kind: PtvReadingRouteKind;
    librarySetIdentity: string;
    schemaVersion: number;
    view: string;
};

type ScopedReadingItem = {
    item: PtvReadingItem;
    library?: PtvReadingLibraryScope;
};

type PtvReadingProgressiveLibraryState = {
    dropReasons: string[];
    lastReadingQueryUrl: string;
    library?: PtvReadingLibraryScope;
    loader: PtvReadingProgressiveLoader<ScopedReadingItem>;
};

type ReadingItemsRequestOptions = {
    enableImages?: boolean;
    fields?: string;
    signal?: AbortSignal;
    stage?: string;
    timeoutMs?: number;
};

const readingHomeCache = new Map<string, ReadingHomeCacheEntry>();
const readingHomeSummaryCache = new Map<string, ReadingHomeCacheEntry>();
const readingLibraryCache = new Map<string, PtvReadingLibraryScope[]>();
const readingLibraryResolutionRequests = new Map<string, Promise<PtvReadingLibraryScope[]>>();
const readingRecentlyAddedRequestCache = new Map<string, Promise<PtvReadingItem[]>>();
const readingImageUrlCache = new Map<string, string>();
const readingLibraryIndexGenerations = new Map<string, number>();

function getCacheKey(kind: PtvReadingRouteKind | 'all' = 'all') {
    return [
        getPtvServerId() || 'server',
        getPtvCurrentUserId() || 'user',
        kind
    ].join(':');
}

function getReadingHomeCacheKey(
    kind: PtvReadingRouteKind,
    librarySetIdentity = 'unscoped',
    view = 'home'
) {
    return [
        getPtvServerId() || 'server',
        getPtvCurrentUserId() || 'user',
        kind,
        librarySetIdentity || 'unscoped',
        view,
        `v${READING_HOME_STORAGE_SCHEMA_VERSION}`
    ].join(':');
}

function getReadingLibraryIndexCachePrefix() {
    return [
        'reading',
        getPtvServerId() || 'server',
        getPtvCurrentUserId() || 'user'
    ].join(':') + ':';
}

function getReadingLibraryIndexCacheKey(kind: PtvReadingRouteKind) {
    return `${getReadingLibraryIndexCachePrefix()}${kind}:library-index`;
}

function getReadingLibrarySetIdentity(
    libraries: PtvReadingLibraryScope[],
    routeKind: PtvReadingRouteKind
) {
    const libraryIds = getReadingLibrariesForRoute(libraries, routeKind)
        .map(library => library.id)
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right, 'en-US'));

    return libraryIds.length ? libraryIds.join('|') : 'unscoped';
}

function getReadingHomeStorageKey(
    kind: PtvReadingRouteKind,
    initialOnly = false,
    librarySetIdentity = 'unscoped',
    view = 'home'
) {
    return `ptv:reading-home:${getReadingHomeCacheKey(kind, librarySetIdentity, view)}:${initialOnly ? 'summary' : 'full'}`;
}

function getReadingHomeScopeStorageKey(kind: PtvReadingRouteKind, view = 'home') {
    return `ptv:reading-home:scope:${getCacheKey(kind)}:${view}:v${READING_HOME_STORAGE_SCHEMA_VERSION}`;
}

function readStoredReadingHomeScope(kind: PtvReadingRouteKind, view = 'home') {
    const storageKey = getReadingHomeScopeStorageKey(kind, view);

    try {
        const scope = readPtvLocalStorageJson<Partial<ReadingHomeStorageScope> | null>(storageKey, null);
        const librarySetIdentity = String(scope?.librarySetIdentity || '').trim();
        const expectedCacheKey = librarySetIdentity ?
            getReadingHomeStorageKey(kind, false, librarySetIdentity, view) : '';

        if (
            !scope
            || scope.schemaVersion !== READING_HOME_SCOPE_STORAGE_SCHEMA_VERSION
            || scope.kind !== kind
            || scope.view !== view
            || !librarySetIdentity
            || librarySetIdentity === 'unscoped'
            || scope.cacheKey !== expectedCacheKey
        ) {
            if (scope) removePtvLocalStorageKey(storageKey);
            return 'unscoped';
        }

        return librarySetIdentity;
    } catch {
        return 'unscoped';
    }
}

function getPayloadSize(value: unknown) {
    try {
        return JSON.stringify(value).length;
    } catch {
        return 0;
    }
}

function getReadingHomeItemCount(data: PtvReadingHomeData) {
    return uniquePtvReadingItems(data.sections.reduce<PtvReadingItem[]>((items, section) => items.concat(section.items), [])).length;
}

function getCacheDiagnostic(
    status: PtvReadingCacheDiagnostic['status'],
    source: string,
    data: PtvReadingHomeData | null,
    options: {
        cacheKey?: string;
        refreshDurationMs?: number | null;
        staleHit?: boolean;
    } = {}
): PtvReadingCacheDiagnostic {
    const generatedAt = typeof data?.generatedAt === 'number' ? data.generatedAt : 0;
    const cacheAgeMs = generatedAt ? Math.max(0, Date.now() - generatedAt) : null;

    return {
        cacheAgeMs,
        cacheFresh: status === 'hit' || status === 'refresh',
        cacheKey: options.cacheKey,
        itemCount: data ? getReadingHomeItemCount(data) : 0,
        payloadSize: data ? getPayloadSize(data) : 0,
        refreshDurationMs: options.refreshDurationMs ?? null,
        sectionCount: data?.sections.length || 0,
        source,
        staleHit: Boolean(options.staleHit),
        status,
        updatedAt: Date.now()
    };
}

function withCacheDiagnostic(
    data: PtvReadingHomeData,
    cacheDiagnostics: PtvReadingCacheDiagnostic
): PtvReadingHomeData {
    const sectionDiagnostics = data.sectionDiagnostics || data.libraryDebug?.sectionDiagnostics || getSectionDiagnostics(data.sections);
    const sectionItems = uniquePtvReadingItems(data.sections.reduce<PtvReadingItem[]>((items, section) => items.concat(section.items), []));
    const hasMoreSectionItemsThanDebug = sectionItems.length > (data.libraryDebug?.fetchedItemCount || 0);

    return {
        ...data,
        cacheDiagnostics,
        libraryDebug: data.libraryDebug ? {
            ...data.libraryDebug,
            fetchedItemCount: Math.max(data.libraryDebug.fetchedItemCount, sectionItems.length),
            jellyfinItemTotal: Math.max(data.libraryDebug.jellyfinItemTotal, sectionItems.length),
            jellyfinRouteItemTotal: Math.max(data.libraryDebug.jellyfinRouteItemTotal, sectionItems.length),
            kindCounts: hasMoreSectionItemsThanDebug ? getReadingKindCounts(sectionItems) : data.libraryDebug.kindCounts,
            sectionDiagnostics,
            totalRecordCountFromApi: Math.max(data.libraryDebug.totalRecordCountFromApi, sectionItems.length)
        } : data.libraryDebug
    };
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- Cache acceptance validates schema, identity, completeness, and freshness independently.
function readStoredReadingHome(
    routeKind: PtvReadingRouteKind,
    initialOnly: boolean,
    librarySetIdentity = 'unscoped',
    view = 'home'
): PtvReadingHomeData | null {
    if (!canUsePtvReadingHomeCache({
        cachedLibrarySetIdentity: librarySetIdentity,
        cachedRouteKind: routeKind,
        librarySetIdentity,
        routeKind
    })) {
        recordPtvEvent('cache', 'reading-home-storage-cache-rejected', {
            initialOnly,
            kind: routeKind,
            librarySetIdentity,
            reason: librarySetIdentity === 'unscoped' ? 'awaiting-library-discovery' : 'cache-identity-mismatch',
            view
        });
        return null;
    }

    const storageKey = getReadingHomeStorageKey(routeKind, initialOnly, librarySetIdentity, view);

    try {
        const entry = readPtvLocalStorageJson<Partial<ReadingHomeStorageEntry> | null>(storageKey, null);

        if (!entry) {
            recordPtvEvent('cache', 'reading-home-storage-cache-miss', {
                initialOnly,
                kind: routeKind,
                storageKey
            });
            return null;
        }

        const storedLibrarySetIdentity = getReadingLibrarySetIdentity(entry.data?.libraries || [], routeKind);

        if (
            entry.schemaVersion !== READING_HOME_STORAGE_SCHEMA_VERSION
            || entry.key !== storageKey
            || !entry.data
            || entry.data.kind !== routeKind
            || (!initialOnly && !isPtvReadingFullHomeCache(entry.data))
            || (librarySetIdentity !== 'unscoped' && storedLibrarySetIdentity !== librarySetIdentity)
        ) {
            removePtvLocalStorageKey(storageKey);
            return null;
        }

        const now = Date.now();
        const createdAt = typeof entry.createdAt === 'number' ? entry.createdAt : 0;
        const expiresAt = typeof entry.expiresAt === 'number' ? entry.expiresAt : 0;
        const isFresh = expiresAt > now;
        const isStaleUsable = createdAt + READING_HOME_STALE_TTL_MS > now;

        if (!isFresh && !isStaleUsable) {
            removePtvLocalStorageKey(storageKey);
            recordPtvEvent('cache', 'reading-home-storage-cache-expired', {
                initialOnly,
                kind: routeKind,
                storageKey
            });
            return null;
        }

        const cacheDiagnostics = getCacheDiagnostic(isFresh ? 'hit' : 'stale-hit', 'reading-local-storage', entry.data, {
            cacheKey: storageKey,
            staleHit: !isFresh
        });

        recordPtvEvent('cache', isFresh ? 'reading-home-storage-cache-hit' : 'reading-home-storage-cache-stale-hit', {
            ageMs: now - createdAt,
            initialOnly,
            itemCount: cacheDiagnostics.itemCount,
            kind: routeKind,
            sectionCount: cacheDiagnostics.sectionCount,
            storageKey
        });

        if (!isFresh) {
            recordPtvTiming('cache', 'readingCacheRenderMs', 0, {
                itemCount: cacheDiagnostics.itemCount,
                kind: routeKind,
                source: 'reading-local-storage',
                staleHit: true
            });
        }

        return withCacheDiagnostic({
            ...entry.data,
            isPartial: Boolean(entry.data.isPartial)
        }, cacheDiagnostics);
    } catch (error) {
        recordPtvEvent('cache', 'reading-home-storage-cache-read-failed', {
            error: error instanceof Error ? error.message : String(error),
            initialOnly,
            kind: routeKind,
            storageKey
        });

        return null;
    }
}

function writeStoredReadingHome(
    routeKind: PtvReadingRouteKind,
    initialOnly: boolean,
    data: PtvReadingHomeData,
    librarySetIdentity = 'unscoped',
    view = 'home'
) {
    const storageKey = getReadingHomeStorageKey(routeKind, initialOnly, librarySetIdentity, view);

    if (!initialOnly && !isPtvReadingFullHomeCache(data)) {
        recordPtvEvent('cache', 'reading-home-storage-cache-write-skipped', {
            initialOnly,
            kind: routeKind,
            reason: 'full-cache-requires-complete-data',
            storageKey
        });
        return;
    }

    try {
        const createdAt = Date.now();
        const entry: ReadingHomeStorageEntry = {
            createdAt,
            data,
            expiresAt: createdAt + READING_HOME_CACHE_TTL_MS,
            key: storageKey,
            schemaVersion: READING_HOME_STORAGE_SCHEMA_VERSION
        };

        const payloadSize = getPayloadSize(data);
        const stored = writePtvLocalStorageJson(storageKey, entry, {
            maxBytes: initialOnly ? 140_000 : 240_000,
            namespace: 'reading-home'
        });

        recordPtvEvent('cache', stored ? 'reading-home-storage-cache-written' : 'reading-home-storage-cache-write-skipped', {
            initialOnly,
            itemCount: getReadingHomeItemCount(data),
            kind: routeKind,
            payloadSize,
            sectionCount: data.sections.length,
            storageKey
        });

        if (stored && !initialOnly && librarySetIdentity !== 'unscoped') {
            writePtvLocalStorageJson(getReadingHomeScopeStorageKey(routeKind, view), {
                cacheKey: storageKey,
                kind: routeKind,
                librarySetIdentity,
                schemaVersion: READING_HOME_SCOPE_STORAGE_SCHEMA_VERSION,
                view
            } satisfies ReadingHomeStorageScope, {
                maxBytes: 2_000,
                namespace: 'reading-home'
            });
        }
    } catch (error) {
        recordPtvEvent('cache', 'reading-home-storage-cache-write-failed', {
            error: error instanceof Error ? error.message : String(error),
            initialOnly,
            kind: routeKind,
            storageKey
        });
    }
}

function clearStoredReadingHomeCache() {
    try {
        const count = clearPtvLocalStorageByPrefix([
            'ptv:reading-home:',
            `ptv:reading-home:v${READING_HOME_STORAGE_SCHEMA_VERSION}:`
        ]);

        recordPtvEvent('cache', 'reading-home-storage-cache-cleared', {
            count
        });
    } catch (error) {
        recordPtvEvent('cache', 'reading-home-storage-cache-clear-failed', {
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

function cleanText(value: unknown): string {
    return String(value || '').trim();
}

function lower(value: unknown): string {
    return cleanText(value).toLowerCase();
}

function getItemText(item: PtvReadingItem | PtvLibrary | null | undefined, libraryName = '') {
    return [
        item?.Name,
        item?.CollectionType,
        item?.MediaType,
        item?.Type,
        item?.Overview,
        item?.SeriesName,
        item?.Album,
        item?.CollectionName,
        libraryName,
        ...(item?.Genres || []),
        ...(item?.Tags || [])
    ].join(' ');
}

function getLibraryKind(library: PtvLibrary): PtvReadingItemKind {
    const text = getItemText(library);

    if (hasPtvReadingMangaKeyword(text)) return 'manga';
    if (hasPtvReadingComicKeyword(text)) return 'comic';

    return 'book';
}

function isReadingLibrary(library: PtvLibrary) {
    const collectionType = lower(library.CollectionType);
    const text = getItemText(library);

    return collectionType === 'books'
        || BOOKS_KEYWORDS.test(text)
        || PUBLICATION_KEYWORDS.test(text)
        || hasPtvReadingComicKeyword(text)
        || hasPtvReadingMangaKeyword(text);
}

export function getPtvReadingRouteKind(value: string | null | undefined): PtvReadingRouteKind {
    const normalized = lower(value);

    if (normalized === 'reading') return 'reading';
    if (normalized === 'comic' || normalized === 'comics') return 'comics';
    if (normalized === 'manga' || normalized === 'maga') return 'manga';

    return 'books';
}

function getPreferredReadingLibraryKind(routeKind: PtvReadingRouteKind): PtvReadingItemKind {
    if (routeKind === 'manga') return 'manga';
    if (routeKind === 'comics') return 'comic';

    return 'book';
}

function sortReadingLibrariesForRoute(
    libraries: PtvReadingLibraryScope[],
    routeKind: PtvReadingRouteKind
) {
    if (routeKind === 'reading') {
        return [...libraries].sort((left, right) => (
            left.kind.localeCompare(right.kind)
            || left.name.localeCompare(right.name)
        ));
    }

    const preferredKind = getPreferredReadingLibraryKind(routeKind);

    return [...libraries].sort((left, right) => (
        Number(right.kind === preferredKind) - Number(left.kind === preferredKind)
        || left.name.localeCompare(right.name)
    ));
}

function getReadingLibrariesForRoute(
    libraries: PtvReadingLibraryScope[],
    routeKind: PtvReadingRouteKind
) {
    if (routeKind === 'reading') return sortReadingLibrariesForRoute(libraries, routeKind);

    const preferredKind = getPreferredReadingLibraryKind(routeKind);
    const matchedLibraries = libraries.filter(library => library.kind === preferredKind);

    return sortReadingLibrariesForRoute(matchedLibraries.length ? matchedLibraries : libraries, routeKind);
}

export {
    getPtvReadingExtension,
    getPtvReadingFormat,
    getPtvReadingItemKind,
    isPtvReadingKindMatch
} from './booksClassification';

function hasItemId(item: PtvReadingItem | null | undefined): item is PtvReadingItem & { Id: string } {
    return Boolean(item?.Id);
}

export function uniquePtvReadingItems(items: Array<PtvReadingItem | null | undefined>): PtvReadingItem[] {
    const seen = new Set<string>();
    const uniqueItems: PtvReadingItem[] = [];

    items.forEach(item => {
        if (!hasItemId(item) || seen.has(item.Id)) return;

        seen.add(item.Id);
        uniqueItems.push(item);
    });

    return uniqueItems;
}

function byTitle(left: PtvReadingItem, right: PtvReadingItem) {
    return getPtvReadingTitle(left).localeCompare(getPtvReadingTitle(right));
}

function byDateDescending(left: PtvReadingItem, right: PtvReadingItem) {
    const leftDate = Date.parse(left.DateCreated || left.PremiereDate || '') || 0;
    const rightDate = Date.parse(right.DateCreated || right.PremiereDate || '') || 0;

    return rightDate - leftDate || byTitle(left, right);
}

function getReadingQueryDefaults(options: ReadingItemsRequestOptions = {}): PtvItemQuery {
    return {
        ...(options.enableImages === false ? READING_NO_IMAGE_QUERY : READING_IMAGE_QUERY),
        EnableTotalRecordCount: true,
        Fields: options.fields || READING_SHELF_FIELDS,
        IncludeItemTypes: 'Book',
        Recursive: true
    };
}

function createReadingAbortError() {
    if (typeof DOMException !== 'undefined') {
        return new DOMException('PiggieTV Reading route work was aborted.', 'AbortError');
    }

    return Object.assign(new Error('PiggieTV Reading route work was aborted.'), {
        name: 'AbortError'
    });
}

function isReadingAbortError(error: unknown) {
    const errorRecord = error && typeof error === 'object' ? error as {
        message?: unknown;
        name?: unknown;
    } : null;
    const message = typeof errorRecord?.message === 'string' ? errorRecord.message : '';

    return errorRecord?.name === 'AbortError' || /abort|cancel|superseded/i.test(message);
}

function throwIfReadingAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw createReadingAbortError();
}

async function getItems<TItem = PtvReadingItem>(
    query: PtvItemQuery,
    options: ReadingItemsRequestOptions = {}
) {
    throwIfReadingAborted(options.signal);

    const controller = createPtvAbortController();
    let timedOut = false;
    const abortFromOwner = () => {
        controller.abort();
    };
    const timeoutId = options.timeoutMs ? globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, options.timeoutMs) : null;

    options.signal?.addEventListener('abort', abortFromOwner, { once: true });

    try {
        return await getPtvItems<TItem>({
            ...getReadingQueryDefaults(options),
            ...query
        }, {
            signal: controller.signal
        });
    } catch (error) {
        if (timedOut) {
            throw new Error(`${options.stage || 'Reading'} timed out after ${options.timeoutMs}ms.`);
        }

        throw error;
    } finally {
        if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
        options.signal?.removeEventListener('abort', abortFromOwner);
    }
}

function getReadingItemsQueryUrl(
    query: PtvItemQuery,
    options: ReadingItemsRequestOptions = {}
) {
    const userId = getPtvCurrentUserId();

    if (!userId) return '';

    try {
        return getPtvApiUrl(`Users/${userId}/Items`, cleanPtvQuery({
            ...getReadingQueryDefaults(options),
            ...query
        }));
    } catch {
        return '';
    }
}

function getErrorStatusCode(error: unknown) {
    const value = error as { status?: number; statusCode?: number } | null;
    const statusCode = value?.statusCode ?? value?.status;

    return typeof statusCode === 'number' ? statusCode : null;
}

function isTimeoutError(error: unknown) {
    return error instanceof Error && /timed out/i.test(error.message);
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function getLimitedItems(items: PtvReadingItem[], limit: number | undefined) {
    return limit ? items.slice(0, limit) : items;
}

function matchesRouteKind(entry: ScopedReadingItem, routeKind: PtvReadingRouteKind) {
    return isPtvReadingKindMatch(entry.item, routeKind, entry.library?.name || '');
}

function addLibraryHint(item: PtvReadingItem, library: PtvReadingLibraryScope): PtvReadingItem {
    return {
        ...item,
        PtvReadingLibraryKindHint: library.kind,
        PtvReadingLibraryName: library.name
    };
}

async function getLibraryReadingItems(
    library: PtvReadingLibraryScope,
    routeKind: PtvReadingRouteKind,
    query: PtvItemQuery,
    options: ReadingItemsRequestOptions = {}
): Promise<PtvReadingItem[]> {
    try {
        const result = await getItems<PtvReadingItem>({
            ...query,
            ParentId: library.id
        }, {
            enableImages: options.enableImages ?? false,
            fields: options.fields || READING_PROBE_FIELDS,
            signal: options.signal,
            stage: options.stage || `${library.name} reading items`,
            timeoutMs: options.timeoutMs ?? READING_SHELF_TIMEOUT_MS
        });

        return (result.Items || [])
            .map(item => addLibraryHint(item, library))
            .filter(item => isPtvReadingKindMatch(item, routeKind, library.name));
    } catch (error) {
        if (options.signal?.aborted || isReadingAbortError(error) || isTimeoutError(error)) throw error;

        recordPtvEvent('api', 'reading-library-recursive-fetch-fallback', {
            error: getErrorMessage(error),
            libraryId: library.id,
            libraryName: library.name,
            routeKind,
            stage: options.stage || 'reading-items'
        });

        const fallbackResult = await getItems<PtvReadingItem>({
            IncludeItemTypes: 'Book',
            Limit: query.Limit,
            ParentId: library.id,
            Recursive: false,
            SortBy: query.SortBy || 'SortName',
            SortOrder: query.SortOrder || 'Ascending',
            StartIndex: query.StartIndex
        }, {
            enableImages: options.enableImages ?? false,
            fields: options.fields || READING_PROBE_FIELDS,
            signal: options.signal,
            stage: `${library.name} direct reading items`,
            timeoutMs: Math.max(2500, Math.round((options.timeoutMs ?? READING_SHELF_TIMEOUT_MS) / 2))
        });

        return (fallbackResult.Items || [])
            .map(item => addLibraryHint(item, library))
            .filter(item => isPtvReadingKindMatch(item, routeKind, library.name));
    }
}

async function getScopedReadingEntries(
    routeKind: PtvReadingRouteKind,
    query: PtvItemQuery,
    options: ReadingItemsRequestOptions = {}
): Promise<ScopedReadingItem[]> {
    const libraries = await getPtvReadingLibraries({ signal: options.signal });
    const limit = typeof query.Limit === 'number' ? query.Limit : undefined;

    if (query.ParentId || !libraries.length) {
        const result = await getItems<PtvReadingItem>(query, {
            enableImages: true,
            fields: READING_SHELF_FIELDS,
            signal: options.signal,
            stage: `${routeKind} scoped items`,
            timeoutMs: READING_SHELF_TIMEOUT_MS
        });

        return uniquePtvReadingItems(result.Items || [])
            .map(item => ({ item }))
            .filter(entry => matchesRouteKind(entry, routeKind));
    }

    const sortedLibraries = getReadingLibrariesForRoute(libraries, routeKind);
    const pageLimit = limit && sortedLibraries.length > 1 ? Math.max(4, Math.ceil(limit / sortedLibraries.length)) : limit;
    const results = await runPtvScheduledRequests(sortedLibraries, async library => {
        const items = await getLibraryReadingItems(library, routeKind, {
            ...query,
            Limit: pageLimit
        }, {
            enableImages: true,
            fields: READING_SHELF_FIELDS,
            signal: options.signal,
            stage: `${library.name} scoped ${routeKind} items`,
            timeoutMs: READING_SHELF_TIMEOUT_MS
        });

        return items.map(item => ({
            item,
            library
        }));
    }, {
        concurrency: 2,
        signal: options.signal
    });

    const entries = results
        .reduce<ScopedReadingItem[]>((items, result) => items.concat(result), [])
        .filter(entry => matchesRouteKind(entry, routeKind));

    return getLimitedItems(uniquePtvReadingItems(entries.map(entry => entry.item)), limit)
        .map(item => entries.find(entry => entry.item.Id === item.Id) || { item });
}

function createReadingProgressiveLibraryState(
    routeKind: PtvReadingRouteKind,
    query: PtvItemQuery,
    library: PtvReadingLibraryScope | undefined,
    isCurrent: () => boolean,
    signal?: AbortSignal
): PtvReadingProgressiveLibraryState {
    const state: PtvReadingProgressiveLibraryState = {
        dropReasons: [],
        lastReadingQueryUrl: '',
        library,
        loader: null as unknown as PtvReadingProgressiveLoader<ScopedReadingItem>
    };
    const baseQuery: PtvItemQuery = library?.id ? {
        ...query,
        ParentId: library.id
    } : query;

    state.loader = createPtvReadingProgressiveLoader({
        fetchPage: async (startIndex, limit) => {
            const pageQuery: PtvItemQuery = {
                ...baseQuery,
                Limit: limit,
                StartIndex: startIndex
            };
            const requestOptions: ReadingItemsRequestOptions = {
                enableImages: false,
                fields: READING_PROBE_FIELDS,
                signal,
                stage: `${library?.name || routeKind} library index page ${Math.floor(startIndex / limit) + 1}`,
                timeoutMs: READING_SHELF_TIMEOUT_MS
            };
            const result = await getItems<PtvReadingItem>(pageQuery, requestOptions);

            state.lastReadingQueryUrl = getReadingItemsQueryUrl(pageQuery, requestOptions);

            return {
                items: (result.Items || []).map(item => ({
                    item: library ? {
                        ...item,
                        PtvReadingLibraryKindHint: library.kind,
                        PtvReadingLibraryName: library.name
                    } : item,
                    library
                })),
                totalRecordCount: typeof result.TotalRecordCount === 'number' ?
                    result.TotalRecordCount :
                    startIndex + (result.Items || []).length
            };
        },
        getKey: entry => entry.item.Id || '',
        initialItemCount: READING_LIBRARY_INITIAL_INDEX_ITEM_COUNT,
        isCurrent,
        pageSize: READING_LIBRARY_PAGE_SIZE
    });

    return state;
}

async function loadReadingProgressivePage(
    routeKind: PtvReadingRouteKind,
    state: PtvReadingProgressiveLibraryState,
    stage: 'initial' | 'background'
) {
    try {
        return stage === 'initial' ? await state.loader.loadInitial() : await state.loader.loadNext('background');
    } catch (error) {
        if (isReadingAbortError(error)) {
            state.loader.retire();
            throw error;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);

        state.dropReasons.push(`${state.library?.name || routeKind}: fetch failed - ${errorMessage}`);
        state.loader.retire();
        recordPtvEvent('api', 'reading-library-index-section-failed', {
            error: errorMessage,
            libraryName: state.library?.name || null,
            routeKind,
            stage
        });

        return state.loader.getSnapshot();
    }
}

function getReadingKindCounts(items: PtvReadingItem[]): Record<PtvReadingItemKind, number> {
    return items.reduce<Record<PtvReadingItemKind, number>>((counts, item) => {
        const kind = getPtvReadingItemKind(item);

        counts[kind] += 1;

        return counts;
    }, {
        book: 0,
        comic: 0,
        manga: 0
    });
}

function buildPtvReadingLibraryIndex(
    routeKind: PtvReadingRouteKind,
    libraries: PtvReadingLibraryScope[],
    libraryDiagnostics: PtvReadingLibraryDiagnostic[],
    selectedLibraries: PtvReadingLibraryScope[],
    states: PtvReadingProgressiveLibraryState[],
    startedAt: number,
    stage: 'background' | 'complete' | 'initial' | 'retired'
): PtvReadingLibraryIndex {
    const snapshots = states.map(state => state.loader.getSnapshot());
    const rawEntries = snapshots.reduce<ScopedReadingItem[]>((items, snapshot) => items.concat(snapshot.items), []);
    const matchedEntries = rawEntries.filter(entry => matchesRouteKind(entry, routeKind));
    const uniqueItems = uniquePtvReadingItems(matchedEntries.map(entry => entry.item));
    const duplicateDropCount = Math.max(0, matchedEntries.length - uniqueItems.length);
    const routeFilterDropCount = Math.max(0, rawEntries.length - matchedEntries.length);
    const dropReasons = states.reduce<string[]>((reasons, state) => reasons.concat(state.dropReasons), []);

    if (duplicateDropCount) dropReasons.push(`${routeKind}: ${duplicateDropCount} duplicate item(s) removed`);
    if (routeFilterDropCount) dropReasons.push(`${routeKind}: ${routeFilterDropCount} item(s) excluded by reading kind filter`);

    const sortedItems = [...uniqueItems].sort(byTitle);
    const totalRecordCount = snapshots.reduce((total, snapshot) => total + snapshot.totalRecordCount, 0);
    const isComplete = snapshots.length > 0 && snapshots.every(snapshot => snapshot.isComplete);
    let resolvedStage = stage;

    if (stage === 'retired') resolvedStage = 'retired';
    else if (isComplete) resolvedStage = 'complete';
    const debug: PtvReadingLibraryDebug = {
        dropReasons,
        droppedItemCount: duplicateDropCount + routeFilterDropCount,
        fetchedItemCount: sortedItems.length,
        indexAccumulatedCount: sortedItems.length,
        indexIsComplete: isComplete,
        indexStage: resolvedStage,
        indexTotalPageCount: snapshots.reduce((total, snapshot) => total + snapshot.totalPageCount, 0),
        jellyfinItemTotal: totalRecordCount,
        jellyfinRouteItemTotal: sortedItems.length,
        kindCounts: getReadingKindCounts(sortedItems),
        lastReadingQueryUrl: [...states].reverse().find(state => state.lastReadingQueryUrl)?.lastReadingQueryUrl || '',
        libraryDiagnostics,
        pageCount: snapshots.reduce((total, snapshot) => total + snapshot.pageCount, 0),
        pageSize: READING_LIBRARY_PAGE_SIZE,
        readingLibraryNames: selectedLibraries.map(library => library.name),
        requestDurationMs: Number((performance.now() - startedAt).toFixed(1)),
        routeKind,
        selectedReadingLibraryIds: selectedLibraries.map(library => library.id),
        sectionDiagnostics: [],
        statusCode: dropReasons.length ? null : 200,
        totalRecordCountFromApi: totalRecordCount
    };

    return {
        debug,
        items: sortedItems,
        libraries
    };
}

export async function fetchPtvReadingLibraryIndex(
    routeKind: PtvReadingRouteKind,
    options: {
        forceRefresh?: boolean;
        isCurrent?: () => boolean;
        onProgress?: (index: PtvReadingLibraryIndex) => void;
        signal?: AbortSignal;
    } = {}
): Promise<PtvReadingLibraryIndex> {
    throwIfReadingAborted(options.signal);

    const startedAt = performance.now();
    const cacheKey = getReadingLibraryIndexCacheKey(routeKind);

    if (!options.forceRefresh) {
        const cachedIndex = await readPtvLibraryIndexCache<PtvReadingLibraryIndex>(
            cacheKey,
            READING_LIBRARY_INDEX_CACHE_SCHEMA_VERSION
        );

        throwIfReadingAborted(options.signal);
        if (cachedIndex?.debug.indexIsComplete) {
            return {
                ...cachedIndex,
                debug: {
                    ...cachedIndex.debug,
                    indexStage: 'cache'
                }
            };
        }
    }

    const generation = (readingLibraryIndexGenerations.get(cacheKey) || 0) + 1;

    readingLibraryIndexGenerations.set(cacheKey, generation);
    let expectedLibrarySetIdentity: string | null = null;

    const isCurrent = () => readingLibraryIndexGenerations.get(cacheKey) === generation
        && getReadingLibraryIndexCacheKey(routeKind) === cacheKey
        && !options.signal?.aborted
        && (
            expectedLibrarySetIdentity === null
            || getReadingLibrarySetIdentity(
                readingLibraryCache.get(getCacheKey('all')) || [],
                routeKind
            ) === expectedLibrarySetIdentity
        )
        && options.isCurrent?.() !== false;

    const discovery = await fetchPtvReadingLibraryDiscovery(routeKind, {
        signal: options.signal
    });
    const libraries = discovery.libraries;
    expectedLibrarySetIdentity = getReadingLibrarySetIdentity(libraries, routeKind);
    const targetLibraries: Array<PtvReadingLibraryScope | undefined> = libraries.length ?
        getReadingLibrariesForRoute(libraries, routeKind) :
        [undefined];
    const selectedLibraries = targetLibraries.filter((library): library is PtvReadingLibraryScope => Boolean(library));
    const states = targetLibraries.map(library => createReadingProgressiveLibraryState(
        routeKind,
        {
            SortBy: 'SortName',
            SortOrder: 'Ascending'
        },
        library,
        isCurrent,
        options.signal
    ));

    await runPtvScheduledRequests(
        states,
        state => loadReadingProgressivePage(routeKind, state, 'initial'),
        {
            concurrency: 2,
            signal: options.signal
        }
    );

    const index = buildPtvReadingLibraryIndex(
        routeKind,
        libraries,
        discovery.diagnostics,
        selectedLibraries,
        states,
        startedAt,
        isCurrent() ? 'initial' : 'retired'
    );

    recordPtvEvent('api', 'reading-library-index-loaded', index.debug);

    if (isCurrent() && index.debug.indexIsComplete && (index.items.length || !index.debug.dropReasons.length)) {
        await writePtvLibraryIndexCache(
            cacheKey,
            READING_LIBRARY_INDEX_CACHE_SCHEMA_VERSION,
            index,
            PTV_LIBRARY_INDEX_CACHE_TTL_MS
        );
    } else if (isCurrent()) {
        void (async () => {
            while (isCurrent()) {
                const activeStates = states.filter(state => state.loader.hasMore());

                if (!activeStates.length) break;

                await runPtvScheduledRequests(
                    activeStates,
                    state => loadReadingProgressivePage(routeKind, state, 'background'),
                    {
                        concurrency: 2,
                        signal: options.signal
                    }
                );

                if (!isCurrent()) break;

                const progressIndex = buildPtvReadingLibraryIndex(
                    routeKind,
                    libraries,
                    discovery.diagnostics,
                    selectedLibraries,
                    states,
                    startedAt,
                    'background'
                );

                options.onProgress?.(progressIndex);
                recordPtvEvent('api', 'reading-library-index-progress', {
                    accumulatedCount: progressIndex.debug.indexAccumulatedCount,
                    isComplete: progressIndex.debug.indexIsComplete,
                    pageCount: progressIndex.debug.pageCount,
                    routeKind,
                    stage: progressIndex.debug.indexStage,
                    totalRecordCount: progressIndex.debug.totalRecordCountFromApi
                });

                if (progressIndex.debug.indexIsComplete) {
                    if (progressIndex.items.length || !progressIndex.debug.dropReasons.length) {
                        await writePtvLibraryIndexCache(
                            cacheKey,
                            READING_LIBRARY_INDEX_CACHE_SCHEMA_VERSION,
                            progressIndex,
                            PTV_LIBRARY_INDEX_CACHE_TTL_MS
                        );
                    }

                    break;
                }

                await yieldPtvReadingIndexWork();
            }

            if (!isCurrent()) {
                states.forEach(state => {
                    state.loader.retire();
                });
            }
        })().catch(error => {
            if (options.signal?.aborted || isReadingAbortError(error)) return;

            recordPtvEvent('api', 'reading-library-index-background-failed', {
                error: error instanceof Error ? error.message : String(error),
                routeKind
            });
        });
    }

    return index;
}

export function invalidatePtvReadingHomeCache() {
    readingLibraryIndexGenerations.clear();
    readingHomeCache.clear();
    readingHomeSummaryCache.clear();
    readingLibraryCache.clear();
    readingLibraryResolutionRequests.clear();
    readingRecentlyAddedRequestCache.clear();
    clearStoredReadingHomeCache();
    void deletePtvLibraryIndexCacheByPrefix(getReadingLibraryIndexCachePrefix());
}

export async function getPtvReadingLibraries(
    options: {
        signal?: AbortSignal;
    } = {}
): Promise<PtvReadingLibraryScope[]> {
    throwIfReadingAborted(options.signal);

    const startedAt = performance.now();
    const cacheKey = getCacheKey('all');

    if (readingLibraryCache.has(cacheKey)) {
        recordPtvEvent('api', 'reading-libraries-resolved', {
            cachedLibraryResolutionMs: Number((performance.now() - startedAt).toFixed(1)),
            libraryCount: (readingLibraryCache.get(cacheKey) || []).length,
            source: 'memory-cache'
        });

        return readingLibraryCache.get(cacheKey) || [];
    }

    const existingRequest = options.signal ? null : readingLibraryResolutionRequests.get(cacheKey);

    if (existingRequest) return existingRequest;

    const request = (async () => {
        const requestStartedAt = performance.now();
        const result = await getPtvUserViews({
            signal: options.signal
        });
        throwIfReadingAborted(options.signal);
        const libraryDiscoveryRequestMs = Number((performance.now() - requestStartedAt).toFixed(1));
        const libraries = (result.Items || [])
            .filter(isReadingLibrary)
            .map((library): PtvReadingLibraryScope => ({
                collectionType: cleanText(library.CollectionType),
                id: library.Id || '',
                kind: getLibraryKind(library),
                itemCount: typeof library.ChildCount === 'number' ? library.ChildCount : undefined,
                name: library.Name || 'Books'
            }))
            .filter(library => Boolean(library.id));

        readingLibraryCache.set(cacheKey, libraries);
        recordPtvEvent('api', 'reading-libraries-resolved', {
            cachedLibraryResolutionMs: null,
            coalesced: false,
            libraryCount: libraries.length,
            libraryDiscoveryRequestMs,
            libraryNames: libraries.map(library => library.name),
            readingLibraryDiscoveryMs: Number((performance.now() - startedAt).toFixed(1)),
            source: 'user-views'
        });

        return libraries;
    })();

    if (options.signal) return request;

    readingLibraryResolutionRequests.set(cacheKey, request);
    return request.finally(() => {
        if (readingLibraryResolutionRequests.get(cacheKey) === request) readingLibraryResolutionRequests.delete(cacheKey);
    });
}

function getLibraryDiagnosticFromError(
    library: PtvReadingLibraryScope,
    lastQueriedUrl: string,
    requestDurationMs: number,
    error: unknown
): PtvReadingLibraryDiagnostic {
    const errorMessage = getErrorMessage(error);

    return {
        collectionType: library.collectionType || '',
        error: errorMessage,
        fileFormats: [],
        id: library.id,
        itemCount: library.itemCount || 0,
        itemTypes: [],
        kind: library.kind,
        lastQueriedUrl,
        name: library.name,
        requestDurationMs,
        statusCode: getErrorStatusCode(error),
        timeoutReason: isTimeoutError(error) ? errorMessage : undefined,
        updatedAt: Date.now()
    };
}

async function fetchPtvReadingLibraryDiagnostic(
    library: PtvReadingLibraryScope,
    routeKind: PtvReadingRouteKind,
    signal?: AbortSignal
): Promise<{
        diagnostic: PtvReadingLibraryDiagnostic;
        library: PtvReadingLibraryScope;
    }> {
    const query: PtvItemQuery = {
        Limit: 1,
        ParentId: library.id,
        SortBy: 'DateCreated',
        SortOrder: 'Descending',
        StartIndex: 0
    };
    const requestOptions: ReadingItemsRequestOptions = {
        enableImages: false,
        fields: READING_PROBE_FIELDS,
        signal,
        stage: `Reading library probe ${library.name}`,
        timeoutMs: READING_LIBRARY_COUNT_TIMEOUT_MS
    };
    const lastQueriedUrl = getReadingItemsQueryUrl(query, requestOptions);
    const startedAt = performance.now();

    try {
        const result = await getItems<PtvReadingItem>(query, requestOptions);
        const requestDurationMs = Number((performance.now() - startedAt).toFixed(1));
        const sampleItems = result.Items || [];
        const itemCount = typeof result.TotalRecordCount === 'number' ?
            result.TotalRecordCount :
            (library.itemCount || sampleItems.length);
        const diagnostic: PtvReadingLibraryDiagnostic = {
            collectionType: library.collectionType || '',
            fileFormats: [...new Set(sampleItems.map(item => getPtvReadingFormat(item)).filter(Boolean))],
            id: library.id,
            itemCount,
            itemTypes: [...new Set(sampleItems.map(item => cleanText(item.Type || 'Book')).filter(Boolean))],
            kind: library.kind,
            lastQueriedUrl,
            name: library.name,
            requestDurationMs,
            statusCode: 200,
            updatedAt: Date.now()
        };

        recordPtvTiming('api', 'readingLibraryDiscoveryMs', requestDurationMs, {
            itemCount,
            libraryId: library.id,
            libraryName: library.name,
            routeKind
        });

        return {
            diagnostic,
            library: {
                ...library,
                itemCount
            }
        };
    } catch (error) {
        if (signal?.aborted || isReadingAbortError(error)) throw error;

        const requestDurationMs = Number((performance.now() - startedAt).toFixed(1));
        const diagnostic = getLibraryDiagnosticFromError(library, lastQueriedUrl, requestDurationMs, error);

        if (diagnostic.timeoutReason) {
            recordPtvEvent('api', 'reading-slow-fetch-aborted', {
                libraryId: library.id,
                libraryName: library.name,
                routeKind,
                stage: 'library-discovery',
                timeoutReason: diagnostic.timeoutReason
            });
        }

        recordPtvTiming('api', 'readingLibraryDiscoveryMs', requestDurationMs, {
            error: diagnostic.error,
            libraryId: library.id,
            libraryName: library.name,
            routeKind
        });

        return {
            diagnostic,
            library
        };
    }
}

async function fetchPtvReadingLibraryDiscovery(
    routeKind: PtvReadingRouteKind,
    options: {
        probeLibraries?: boolean;
        signal?: AbortSignal;
    } = {}
): Promise<{
        diagnostics: PtvReadingLibraryDiagnostic[];
        libraries: PtvReadingLibraryScope[];
        requestDurationMs: number;
    }> {
    const startedAt = performance.now();
    const libraryResolutionStartedAt = performance.now();
    const libraries = await getPtvReadingLibraries({
        signal: options.signal
    }).catch(error => {
        if (options.signal?.aborted || isReadingAbortError(error)) throw error;

        recordPtvEvent('api', 'reading-library-discovery-failed', {
            error: getErrorMessage(error),
            routeKind
        });

        return [];
    });
    const cachedLibraryResolutionMs = Number((performance.now() - libraryResolutionStartedAt).toFixed(1));

    if (!libraries.length) {
        return {
            diagnostics: [],
            libraries: [],
            requestDurationMs: Number((performance.now() - startedAt).toFixed(1))
        };
    }

    if (!options.probeLibraries) {
        const requestDurationMs = Number((performance.now() - startedAt).toFixed(1));
        const diagnostics = sortReadingLibrariesForRoute(libraries, routeKind).map(library => ({
            collectionType: library.collectionType || '',
            fileFormats: [],
            id: library.id,
            itemCount: library.itemCount || 0,
            itemTypes: ['Book', 'Folder', 'Photo', 'BoxSet'],
            kind: library.kind,
            lastQueriedUrl: '',
            name: library.name,
            requestDurationMs: 0,
            statusCode: null,
            updatedAt: Date.now()
        }));

        recordPtvEvent('api', 'reading-library-discovery-loaded', {
            cachedLibraryResolutionMs,
            diagnostics,
            libraryCount: diagnostics.length,
            libraryDiscoveryRequestMs: requestDurationMs,
            libraryDiscoveryWaitForSharedPromiseMs: 0,
            requestDurationMs,
            routeKind,
            routeElapsedSinceRuntimeMs: null,
            source: 'user-views'
        });

        return {
            diagnostics,
            libraries,
            requestDurationMs
        };
    }

    const results = await runPtvScheduledRequests(
        sortReadingLibrariesForRoute(libraries, routeKind),
        library => fetchPtvReadingLibraryDiagnostic(library, routeKind, options.signal),
        {
            concurrency: 2,
            signal: options.signal
        }
    );
    const requestDurationMs = Number((performance.now() - startedAt).toFixed(1));

    recordPtvEvent('api', 'reading-library-discovery-loaded', {
        cachedLibraryResolutionMs,
        diagnostics: results.map(result => result.diagnostic),
        libraryCount: results.length,
        libraryDiscoveryRequestMs: requestDurationMs,
        libraryDiscoveryWaitForSharedPromiseMs: 0,
        requestDurationMs,
        routeElapsedSinceRuntimeMs: null,
        routeKind
    });

    return {
        diagnostics: results.map(result => result.diagnostic),
        libraries: results.map(result => result.library),
        requestDurationMs
    };
}

export function getPtvReadingTitle(item?: PtvReadingItem | null): string {
    return cleanText(item?.Name || item?.SortName || 'Untitled');
}

export function getPtvReadingAuthors(item?: PtvReadingItem | null): string {
    const authors = (item?.People || [])
        .filter(person => ['author', 'writer'].includes(lower(person.Type)))
        .map(person => cleanText(person.Name))
        .filter(Boolean);

    return [...new Set(authors)].join(', ');
}

export function getPtvReadingSeries(item?: PtvReadingItem | null): string {
    return cleanText(item?.SeriesName || item?.Album || item?.CollectionName);
}

export function getPtvReadingGenres(item?: PtvReadingItem | null): string[] {
    const genreItems = item?.GenreItems?.map(genre => genre.Name).filter((genre): genre is string => Boolean(genre)) || [];
    const genres = Array.isArray(item?.Genres) ? item.Genres : [];

    return [...new Set([...genres, ...genreItems].filter(Boolean))];
}

export function getPtvReadingStableId(item: PtvReadingItem | null | undefined) {
    if (item?.Id) return `jellyfin:${item.ServerId || 'default'}:${item.Id}`;

    return `source:${item?.Path || item?.Name || 'unknown'}`;
}

export function getPtvReadingImagePlaceholder() {
    return READING_PLACEHOLDER_IMAGE;
}

export function getPtvReadingImageUrl(
    item: PtvReadingItem | null | undefined,
    size = 420,
    preferredImageType: PtvReadingImageType = 'Primary'
) {
    if (!item) return READING_PLACEHOLDER_IMAGE;

    const canonicalSize = getReadingCanonicalImageSize(size, preferredImageType);
    const semanticProfile = getReadingImageSemanticProfile(canonicalSize, preferredImageType);
    const imageTag = preferredImageType === 'Backdrop' ?
        item.BackdropImageTags?.[0] || item.ImageTags?.Primary || item.ParentPrimaryImageTag || '' :
        item.ImageTags?.Primary || item.ParentPrimaryImageTag || '';
    const cacheKey = [
        item.Id || item.Name || item.Path || 'unknown',
        imageTag,
        preferredImageType,
        semanticProfile,
        canonicalSize
    ].join(':');
    const cachedUrl = readingImageUrlCache.get(cacheKey);

    if (cachedUrl) {
        recordPtvEvent('image', 'reading-image-profile-cache-hit', {
            imageProfile: semanticProfile,
            preferredImageType
        });

        return cachedUrl;
    }

    let order: Array<'Primary' | 'Thumb' | 'Backdrop' | 'SeriesPrimary' | 'ParentPrimary'> = ['Primary', 'ParentPrimary', 'Thumb', 'Backdrop'];

    if (preferredImageType === 'Backdrop') {
        order = ['Backdrop', 'Primary', 'ParentPrimary', 'Thumb'];
    } else if (preferredImageType === 'Thumb') {
        order = ['Thumb', 'Primary', 'ParentPrimary', 'Backdrop'];
    }

    const candidates = getPtvItemImageCandidates(item, {
        baseOptions: {
            fillHeight: preferredImageType === 'Backdrop' ? Math.round(canonicalSize * 0.56) : Math.round(canonicalSize * 1.5),
            fillWidth: canonicalSize,
            quality: 84
        },
        order
    });
    const taggedCandidate = candidates.find(candidate => candidate.tag);

    if (taggedCandidate?.url) {
        readingImageUrlCache.set(cacheKey, taggedCandidate.url);
        recordPtvEvent('image', 'reading-image-profile-requested', {
            duplicateImageTransformPrevented: false,
            imageProfile: semanticProfile,
            itemId: item.Id || null,
            largestRequestedDimension: preferredImageType === 'Backdrop' ? canonicalSize : Math.round(canonicalSize * 1.5),
            preferredImageType
        });

        return taggedCandidate.url;
    }

    readingImageUrlCache.set(cacheKey, READING_PLACEHOLDER_IMAGE);
    return READING_PLACEHOLDER_IMAGE;
}

function getReadingCanonicalImageSize(size: number, preferredImageType: 'Backdrop' | 'Primary' | 'Thumb') {
    if (preferredImageType === 'Backdrop') {
        if (size <= 700) return 700;
        return 900;
    }

    if (size <= 340) return 320;
    if (size <= 520) return 480;

    return 800;
}

function getReadingImageSemanticProfile(size: number, preferredImageType: 'Backdrop' | 'Primary' | 'Thumb') {
    if (preferredImageType === 'Backdrop') return 'blurred-background-source';
    if (size <= 320) return 'shelf-cover';
    if (size <= 480) return 'featured-cover';

    return 'detail-cover';
}

export function getPtvReadingFormatLabel(item: PtvReadingItem | null | undefined) {
    const extension = getPtvReadingExtension(item);
    const format = getPtvReadingFormat(item);

    if (extension) return extension.toUpperCase();
    if (format === 'comic') return 'COMIC';
    if (format === 'epub') return 'EPUB';
    if (format === 'pdf') return 'PDF';

    return 'BOOK';
}

function getSection(
    id: string,
    title: string,
    items: PtvReadingItem[],
    options: Partial<PtvReadingSection> = {}
): PtvReadingSection {
    return {
        diagnostics: options.diagnostics,
        error: options.error,
        id,
        isLoading: options.isLoading,
        items: uniquePtvReadingItems(items),
        kind: options.kind,
        subtitle: options.subtitle,
        title
    };
}

function getLoadingSection(id: string, title: string, subtitle: string): PtvReadingSection {
    const diagnostics: PtvReadingSectionDiagnostic = {
        id,
        itemCount: 0,
        lastQueriedUrl: '',
        requestDurationMs: null,
        source: 'background',
        status: 'loading',
        statusCode: null,
        title,
        updatedAt: Date.now()
    };

    return getSection(id, title, [], {
        diagnostics,
        isLoading: true,
        subtitle
    });
}

function getSectionDiagnostic(
    id: string,
    title: string,
    source: string,
    items: PtvReadingItem[],
    options: Partial<PtvReadingSectionDiagnostic> = {}
): PtvReadingSectionDiagnostic {
    return {
        id,
        itemCount: items.length,
        lastQueriedUrl: options.lastQueriedUrl || '',
        requestDurationMs: options.requestDurationMs ?? null,
        source,
        status: options.status || 'ready',
        statusCode: options.statusCode ?? 200,
        title,
        updatedAt: Date.now(),
        ...(options.error ? { error: options.error } : {}),
        ...(options.timeoutReason ? { timeoutReason: options.timeoutReason } : {})
    };
}

function getTopGenreSections(items: PtvReadingItem[]): PtvReadingSection[] {
    const counts = new Map<string, number>();

    items.forEach(item => {
        getPtvReadingGenres(item).forEach(genre => {
            counts.set(genre, (counts.get(genre) || 0) + 1);
        });
    });

    return Array.from(counts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 3)
        .map(([genre]) => getSection(
            `genre-${genre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            genre,
            items.filter(item => getPtvReadingGenres(item).includes(genre)).slice(0, 24),
            { subtitle: 'Genre shelf' }
        ))
        .filter(section => section.items.length > 0);
}

export function mergePtvReadingLibraryIndex(
    homeData: PtvReadingHomeData,
    libraryIndex: PtvReadingLibraryIndex
): PtvReadingHomeData {
    const routeKind = homeData.kind;
    const existingItems = uniquePtvReadingItems(homeData.sections.reduce<PtvReadingItem[]>((items, section) => items.concat(section.items), []));
    const sectionDiagnostics = getSectionDiagnostics(homeData.sections);
    const previousIndexCount = homeData.libraryDebug?.indexAccumulatedCount || 0;

    if (shouldPreservePtvReadingIndex(
        previousIndexCount,
        libraryIndex.debug.indexAccumulatedCount,
        libraryIndex.items.length
    )) {
        recordPtvEvent('cache', 'reading-progressive-index-preserved-fuller-result', {
            kind: routeKind,
            nextIndexCount: libraryIndex.debug.indexAccumulatedCount,
            nextStage: libraryIndex.debug.indexStage,
            previousIndexCount,
            reason: 'incoming-index-less-complete-than-active-index'
        });

        return homeData;
    }

    if (!libraryIndex.items.length && libraryIndex.debug.dropReasons.length && existingItems.length) {
        const existingItemCount = existingItems.length;
        const previousDebug = homeData.libraryDebug;
        const dropReasons = [...new Set([
            ...(previousDebug?.dropReasons || []),
            ...libraryIndex.debug.dropReasons
        ])];

        return {
            ...homeData,
            generatedAt: Date.now(),
            libraries: libraryIndex.libraries.length ? libraryIndex.libraries : homeData.libraries,
            libraryDebug: {
                ...(previousDebug || libraryIndex.debug),
                dropReasons,
                droppedItemCount: Math.max(previousDebug?.droppedItemCount || 0, libraryIndex.debug.droppedItemCount),
                fetchedItemCount: Math.max(previousDebug?.fetchedItemCount || 0, existingItemCount),
                jellyfinItemTotal: Math.max(previousDebug?.jellyfinItemTotal || 0, libraryIndex.debug.jellyfinItemTotal, existingItemCount),
                jellyfinRouteItemTotal: Math.max(previousDebug?.jellyfinRouteItemTotal || 0, libraryIndex.debug.jellyfinRouteItemTotal, existingItemCount),
                kindCounts: getReadingKindCounts(existingItems),
                lastReadingQueryUrl: libraryIndex.debug.lastReadingQueryUrl || previousDebug?.lastReadingQueryUrl || '',
                libraryDiagnostics: libraryIndex.debug.libraryDiagnostics.length ? libraryIndex.debug.libraryDiagnostics : (previousDebug?.libraryDiagnostics || []),
                pageCount: Math.max(previousDebug?.pageCount || 0, libraryIndex.debug.pageCount),
                requestDurationMs: libraryIndex.debug.requestDurationMs ?? previousDebug?.requestDurationMs ?? null,
                sectionDiagnostics,
                statusCode: null,
                totalRecordCountFromApi: Math.max(previousDebug?.totalRecordCountFromApi || 0, libraryIndex.debug.totalRecordCountFromApi, existingItemCount)
            },
            sectionDiagnostics,
            stats: {
                ...homeData.stats,
                itemCount: Math.max(homeData.stats.itemCount, existingItemCount),
                libraryCount: libraryIndex.libraries.length || homeData.libraries.length
            }
        };
    }

    const allItems = libraryIndex.items;
    const comics = allItems.filter(item => getPtvReadingItemKind(item) === 'comic');
    const manga = allItems.filter(item => getPtvReadingItemKind(item) === 'manga');
    const metadataStats = getPtvReadingMetadataStats(allItems);
    const pinnedSections = homeData.sections.filter(section => [
        'continue-reading',
        'favorites',
        'recently-added'
    ].includes(section.id));
    const sections = [
        ...pinnedSections,
        routeKind === 'reading' ? getSection('manga', 'Manga', manga, {
            kind: 'manga',
            subtitle: 'Right-to-left ready'
        }) : null,
        routeKind === 'reading' ? getSection('comics', 'Comics', comics, {
            kind: 'comic',
            subtitle: 'Issues and graphic novels'
        }) : null,
        ...getTopGenreSections(allItems),
        getSection('library', getReadingSectionTitle('library', routeKind), allItems, {
            subtitle: 'Library'
        })
    ].filter((section): section is PtvReadingSection => Boolean(section?.items.length));

    return {
        ...homeData,
        generatedAt: Date.now(),
        isPartial: !libraryIndex.debug.indexIsComplete,
        libraries: libraryIndex.libraries.length ? libraryIndex.libraries : homeData.libraries,
        libraryDebug: {
            ...libraryIndex.debug,
            sectionDiagnostics: sections
                .map(section => section.diagnostics)
                .filter((diagnostic): diagnostic is PtvReadingSectionDiagnostic => Boolean(diagnostic))
        },
        sectionDiagnostics: sections
            .map(section => section.diagnostics)
            .filter((diagnostic): diagnostic is PtvReadingSectionDiagnostic => Boolean(diagnostic)),
        sections,
        stats: {
            ...homeData.stats,
            itemCount: libraryIndex.debug.jellyfinRouteItemTotal,
            libraryCount: libraryIndex.libraries.length || homeData.libraries.length,
            metadata: metadataStats
        }
    };
}

export async function fetchPtvReadingItems(
    routeKind: PtvReadingRouteKind,
    query: PtvItemQuery = {},
    limit = DEFAULT_READING_LIMIT,
    options: {
        signal?: AbortSignal;
    } = {}
): Promise<PtvReadingItem[]> {
    const entries = await getScopedReadingEntries(routeKind, {
        Limit: limit,
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        ...query
    }, {
        signal: options.signal
    });

    return entries.map(entry => entry.item);
}

export async function fetchPtvReadingRecentlyAdded(
    routeKind: PtvReadingRouteKind,
    limit = DEFAULT_READING_LIMIT,
    options: {
        signal?: AbortSignal;
    } = {}
): Promise<PtvReadingItem[]> {
    const cacheKey = `${getCacheKey(routeKind)}:recently-added:${limit}`;
    const inFlightRequest = options.signal ? null : readingRecentlyAddedRequestCache.get(cacheKey);

    if (inFlightRequest) return inFlightRequest;

    const request = fetchPtvReadingRecentlyAddedUncached(routeKind, limit, options.signal)
        .finally(() => {
            if (!options.signal) readingRecentlyAddedRequestCache.delete(cacheKey);
        });

    if (options.signal) return request;

    readingRecentlyAddedRequestCache.set(cacheKey, request);

    return request;
}

async function fetchPtvReadingRecentlyAddedUncached(
    routeKind: PtvReadingRouteKind,
    limit: number,
    signal?: AbortSignal
): Promise<PtvReadingItem[]> {
    const libraries = await getPtvReadingLibraries({ signal });
    const recentQuery: PtvItemQuery = {
        SortBy: 'DateCreated',
        SortOrder: 'Descending'
    };

    if (!libraries.length) {
        const result = await getItems<PtvReadingItem>({
            ...recentQuery,
            Limit: Math.min(limit, READING_HOME_LIBRARY_PREVIEW_LIMIT)
        }, {
            signal,
            stage: `${routeKind} recently added`,
            timeoutMs: READING_SHELF_TIMEOUT_MS
        });

        return uniquePtvReadingItems(result.Items || [])
            .filter(item => isPtvReadingKindMatch(item, routeKind))
            .sort(byDateDescending)
            .slice(0, limit);
    }

    const sortedLibraries = getReadingLibrariesForRoute(libraries, routeKind);
    const pageLimit = Math.max(4, Math.ceil(limit / sortedLibraries.length));
    const results = await runPtvScheduledRequests(sortedLibraries, async library => {
        return getLibraryReadingItems(library, routeKind, {
            ...recentQuery,
            Limit: pageLimit
        }, {
            enableImages: true,
            fields: READING_SHELF_FIELDS,
            signal,
            stage: `${library.name} recently added`,
            timeoutMs: READING_SHELF_TIMEOUT_MS
        });
    }, {
        concurrency: 2,
        signal
    });

    return uniquePtvReadingItems(results.reduce<PtvReadingItem[]>((items, result) => items.concat(result), []))
        .sort(byDateDescending)
        .slice(0, limit);
}

export function searchPtvReading(
    routeKind: PtvReadingRouteKind,
    searchTerm: string,
    limit = 60,
    options: {
        signal?: AbortSignal;
    } = {}
): Promise<PtvReadingItem[]> {
    const normalizedSearchTerm = searchTerm.trim();

    if (!normalizedSearchTerm) return Promise.resolve([]);

    return fetchPtvReadingItems(routeKind, {
        SearchTerm: normalizedSearchTerm,
        SortBy: 'SortName',
        SortOrder: 'Ascending'
    }, limit, options);
}

export function fetchPtvReadingItem(
    itemId: string,
    options: {
        signal?: AbortSignal;
    } = {}
): Promise<PtvReadingItem> {
    return getPtvItem<PtvReadingItem>(itemId, {
        signal: options.signal
    });
}

function fetchPtvReadingContinueItems(
    routeKind: PtvReadingRouteKind,
    limit = 36,
    signal?: AbortSignal
): Promise<PtvReadingItem[]> {
    return fetchPtvReadingItems(routeKind, {
        Filters: 'IsResumable',
        SortBy: 'DatePlayed',
        SortOrder: 'Descending'
    }, limit, { signal });
}

function fetchPtvReadingFavoriteItems(
    routeKind: PtvReadingRouteKind,
    limit = 48,
    signal?: AbortSignal
): Promise<PtvReadingItem[]> {
    return fetchPtvReadingItems(routeKind, {
        Filters: 'IsFavorite',
        SortBy: 'SortName',
        SortOrder: 'Ascending'
    }, limit, { signal });
}

function getReadingSectionTitle(sectionId: string, routeKind: PtvReadingRouteKind) {
    if (sectionId === 'continue-reading') return 'Continue Reading';
    if (sectionId === 'favorites') return 'Favorites';
    if (sectionId === 'recently-added') return 'Recently Added';
    if (sectionId === 'library') {
        if (routeKind === 'reading') return 'All Reading';
        if (routeKind === 'comics') return 'All Comics';
        if (routeKind === 'manga') return 'All Manga';

        return 'All Books';
    }
    if (sectionId === 'comics') return 'Comics';
    if (sectionId === 'manga') return 'Manga';

    return sectionId;
}

function getReadingSectionSubtitle(sectionId: string) {
    if (sectionId === 'continue-reading') return 'Pick up where you left off';
    if (sectionId === 'favorites') return 'Saved reads';
    if (sectionId === 'recently-added') return 'New in Jellyfin';
    if (sectionId === 'library') return 'Library';
    if (sectionId === 'comics') return 'Issues and graphic novels';
    if (sectionId === 'manga') return 'Right-to-left ready';

    return 'Shelf';
}

async function runReadingShelf(
    routeKind: PtvReadingRouteKind,
    sectionId: string,
    task: (signal: AbortSignal) => Promise<PtvReadingItem[]>,
    options: {
        kind?: PtvReadingItemKind;
        lastQueriedUrl?: string;
        signal?: AbortSignal;
        source?: string;
        subtitle?: string;
        timeoutMs?: number;
        title?: string;
    } = {}
): Promise<PtvReadingSection> {
    const title = options.title || getReadingSectionTitle(sectionId, routeKind);
    const subtitle = options.subtitle || getReadingSectionSubtitle(sectionId);
    const source = options.source || 'jellyfin';
    const timeoutMs = options.timeoutMs ?? READING_SHELF_TIMEOUT_MS;
    const startedAt = performance.now();

    throwIfReadingAborted(options.signal);

    const controller = createPtvAbortController();
    let timedOut = false;
    const abortFromOwner = () => {
        controller.abort();
    };
    const timeoutId = globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    options.signal?.addEventListener('abort', abortFromOwner, { once: true });
    try {
        const items = await task(controller.signal);
        const requestDurationMs = Number((performance.now() - startedAt).toFixed(1));
        const diagnostics = getSectionDiagnostic(sectionId, title, source, items, {
            lastQueriedUrl: options.lastQueriedUrl,
            requestDurationMs
        });

        recordPtvTiming('api', 'readingShelfFetch', requestDurationMs, {
            itemCount: items.length,
            kind: routeKind,
            sectionId,
            title
        });

        return getSection(sectionId, title, items, {
            diagnostics,
            kind: options.kind,
            subtitle
        });
    } catch (error) {
        if (options.signal?.aborted) throw createReadingAbortError();
        if (!timedOut && isReadingAbortError(error)) throw error;

        const reportedError = timedOut ?
            new Error(`${title} shelf timed out after ${timeoutMs}ms.`) :
            error;
        const errorMessage = getErrorMessage(reportedError);
        const requestDurationMs = Number((performance.now() - startedAt).toFixed(1));
        const diagnostics = getSectionDiagnostic(sectionId, title, source, [], {
            error: errorMessage,
            lastQueriedUrl: options.lastQueriedUrl,
            requestDurationMs,
            status: 'error',
            statusCode: getErrorStatusCode(reportedError),
            timeoutReason: isTimeoutError(reportedError) ? errorMessage : undefined
        });

        recordPtvEvent('api', 'reading-api-section-failed', {
            error: errorMessage,
            kind: routeKind,
            sectionId,
            title
        });
        recordPtvTiming('api', 'readingShelfFetch', requestDurationMs, {
            error: errorMessage,
            kind: routeKind,
            sectionId,
            title
        });

        if (diagnostics.timeoutReason) {
            recordPtvEvent('api', 'reading-slow-fetch-aborted', {
                kind: routeKind,
                sectionId,
                stage: 'shelf',
                timeoutReason: diagnostics.timeoutReason
            });
        }

        return getSection(sectionId, title, [], {
            diagnostics,
            error: errorMessage,
            kind: options.kind,
            subtitle
        });
    } finally {
        globalThis.clearTimeout(timeoutId);
        options.signal?.removeEventListener('abort', abortFromOwner);
    }
}

async function getReadingRouteQueryForDiagnostics(
    routeKind: PtvReadingRouteKind,
    query: PtvItemQuery,
    signal?: AbortSignal
) {
    const libraries = await getPtvReadingLibraries({ signal }).catch(error => {
        if (signal?.aborted || isReadingAbortError(error)) throw error;

        return [];
    });
    const selectedLibraries = getReadingLibrariesForRoute(libraries, routeKind);
    const selectedLibrary = selectedLibraries.length === 1 ? selectedLibraries[0] : null;

    return selectedLibrary ? {
        ...query,
        ParentId: selectedLibrary.id
    } : query;
}

export async function fetchPtvReadingHomeSection(
    routeKind: PtvReadingRouteKind,
    sectionId: string,
    limit = READING_HOME_LIBRARY_PREVIEW_LIMIT,
    options: {
        signal?: AbortSignal;
    } = {}
): Promise<PtvReadingSection> {
    if (sectionId === 'recently-added') {
        const query = {
            Limit: Math.min(limit, READING_HOME_LIBRARY_PREVIEW_LIMIT),
            SortBy: 'DateCreated',
            SortOrder: 'Descending'
        };

        return runReadingShelf(
            routeKind,
            sectionId,
            signal => fetchPtvReadingRecentlyAdded(
                routeKind,
                Math.min(limit, READING_HOME_LIBRARY_PREVIEW_LIMIT),
                { signal }
            ),
            {
                lastQueriedUrl: getReadingItemsQueryUrl(await getReadingRouteQueryForDiagnostics(
                    routeKind,
                    query,
                    options.signal
                ), {
                    enableImages: false,
                    fields: READING_PROBE_FIELDS
                }),
                signal: options.signal,
                source: 'jellyfin-latest'
            }
        );
    }

    if (sectionId === 'continue-reading') {
        const sectionLimit = Math.min(limit, READING_CONTINUE_LIMIT);
        const query = {
            Filters: 'IsResumable',
            Limit: sectionLimit,
            SortBy: 'DatePlayed',
            SortOrder: 'Descending'
        };

        return runReadingShelf(
            routeKind,
            sectionId,
            signal => fetchPtvReadingContinueItems(routeKind, sectionLimit, signal),
            {
                lastQueriedUrl: getReadingItemsQueryUrl(await getReadingRouteQueryForDiagnostics(
                    routeKind,
                    query,
                    options.signal
                ), {
                    enableImages: false,
                    fields: READING_PROBE_FIELDS
                }),
                signal: options.signal,
                source: 'jellyfin-resume',
                timeoutMs: READING_OPTIONAL_SHELF_TIMEOUT_MS
            }
        );
    }

    if (sectionId === 'favorites') {
        const query = {
            Filters: 'IsFavorite',
            Limit: Math.min(limit, READING_HOME_LIBRARY_PREVIEW_LIMIT),
            SortBy: 'SortName',
            SortOrder: 'Ascending'
        };

        return runReadingShelf(
            routeKind,
            sectionId,
            signal => fetchPtvReadingFavoriteItems(
                routeKind,
                Math.min(limit, READING_HOME_LIBRARY_PREVIEW_LIMIT),
                signal
            ),
            {
                lastQueriedUrl: getReadingItemsQueryUrl(await getReadingRouteQueryForDiagnostics(
                    routeKind,
                    query,
                    options.signal
                ), {
                    enableImages: false,
                    fields: READING_PROBE_FIELDS
                }),
                signal: options.signal,
                source: 'jellyfin-favorites'
            }
        );
    }

    return runReadingShelf(
        routeKind,
        'library',
        signal => fetchPtvReadingItems(routeKind, {
            SortBy: 'SortName',
            SortOrder: 'Ascending'
        }, Math.min(limit, READING_HOME_LIBRARY_PREVIEW_LIMIT), {
            signal
        }),
        {
            lastQueriedUrl: getReadingItemsQueryUrl(await getReadingRouteQueryForDiagnostics(routeKind, {
                Limit: Math.min(limit, READING_HOME_LIBRARY_PREVIEW_LIMIT),
                SortBy: 'SortName',
                SortOrder: 'Ascending'
            }, options.signal), {
                enableImages: false,
                fields: READING_PROBE_FIELDS
            }),
            signal: options.signal,
            source: 'jellyfin-items'
        }
    );
}

function isVisibleReadingSection(section: PtvReadingSection | null | undefined): section is PtvReadingSection {
    return Boolean(section && (section.items.length || section.error || section.isLoading));
}

function getSectionDiagnostics(sections: PtvReadingSection[]): PtvReadingSectionDiagnostic[] {
    return sections
        .map(section => section.diagnostics)
        .filter((diagnostic): diagnostic is PtvReadingSectionDiagnostic => Boolean(diagnostic));
}

function buildReadingLibraryDebug(
    routeKind: PtvReadingRouteKind,
    libraries: PtvReadingLibraryScope[],
    libraryDiagnostics: PtvReadingLibraryDiagnostic[],
    sections: PtvReadingSection[],
    requestDurationMs: number | null
): PtvReadingLibraryDebug {
    const allItems = uniquePtvReadingItems(sections.reduce<PtvReadingItem[]>((items, section) => items.concat(section.items), []));
    const routeLibraries = getReadingLibrariesForRoute(libraries, routeKind);
    const routeLibraryIds = new Set(routeLibraries.map(library => library.id));
    const routeDiagnostics = libraryDiagnostics.filter(diagnostic => routeLibraryIds.has(diagnostic.id));
    const routeRecordCount = routeDiagnostics.reduce((total, diagnostic) => total + diagnostic.itemCount, 0);
    const routeItemTotal = Math.max(routeRecordCount, allItems.length);
    const allLibraryRecordCount = libraryDiagnostics.reduce((total, diagnostic) => total + diagnostic.itemCount, 0);
    const sectionDiagnostics = getSectionDiagnostics(sections);
    const timeoutReason = [
        ...libraryDiagnostics.map(diagnostic => diagnostic.timeoutReason || ''),
        ...sectionDiagnostics.map(diagnostic => diagnostic.timeoutReason || '')
    ].find(Boolean);
    const failedDiagnostics = [
        ...libraryDiagnostics.filter(diagnostic => diagnostic.error),
        ...sectionDiagnostics.filter(diagnostic => diagnostic.error)
    ];

    return {
        dropReasons: failedDiagnostics.map(diagnostic => {
            const label = 'name' in diagnostic ? diagnostic.name : diagnostic.title;

            return `${label}: ${diagnostic.error}`;
        }),
        droppedItemCount: 0,
        fetchedItemCount: allItems.length,
        indexAccumulatedCount: allItems.length,
        indexIsComplete: allItems.length >= routeItemTotal,
        indexStage: allItems.length >= routeItemTotal ? 'complete' : 'initial',
        indexTotalPageCount: Math.ceil(routeItemTotal / READING_LIBRARY_PAGE_SIZE),
        jellyfinItemTotal: Math.max(allLibraryRecordCount, allItems.length),
        jellyfinRouteItemTotal: routeItemTotal,
        kindCounts: getReadingKindCounts(allItems),
        lastReadingQueryUrl: [
            ...sectionDiagnostics.map(diagnostic => diagnostic.lastQueriedUrl),
            ...libraryDiagnostics.map(diagnostic => diagnostic.lastQueriedUrl)
        ].reverse().find(Boolean) || '',
        libraryDiagnostics,
        pageCount: 0,
        pageSize: READING_HOME_LIBRARY_PREVIEW_LIMIT,
        readingLibraryNames: routeLibraries.map(library => library.name),
        requestDurationMs,
        routeKind,
        selectedReadingLibraryIds: routeLibraries.map(library => library.id),
        sectionDiagnostics,
        statusCode: failedDiagnostics.length ? null : 200,
        timeoutReason,
        totalRecordCountFromApi: routeItemTotal
    };
}

export function getPtvReadingHome(
    routeKind: PtvReadingRouteKind,
    options: {
        initialOnly?: boolean;
        forceRefresh?: boolean;
        signal?: AbortSignal;
        view?: string;
    } = {}
): Promise<PtvReadingHomeData> {
    if (options.signal?.aborted) return Promise.reject(createReadingAbortError());

    const view = options.view || 'home';
    const memoryLibrarySetIdentity = getReadingLibrarySetIdentity(readingLibraryCache.get(getCacheKey('all')) || [], routeKind);
    const knownLibrarySetIdentity = memoryLibrarySetIdentity !== 'unscoped' ?
        memoryLibrarySetIdentity : readStoredReadingHomeScope(routeKind, view);
    const canUseKnownCache = canUsePtvReadingHomeCache({
        cachedLibrarySetIdentity: knownLibrarySetIdentity,
        cachedRouteKind: routeKind,
        forceRefresh: options.forceRefresh,
        librarySetIdentity: knownLibrarySetIdentity,
        routeKind
    });
    let cacheKey = getReadingHomeCacheKey(routeKind, knownLibrarySetIdentity, view);
    const activeCache = options.initialOnly ? readingHomeSummaryCache : readingHomeCache;
    const cached = activeCache.get(cacheKey);
    const fullCached = readingHomeCache.get(cacheKey);

    if (canUseKnownCache && options.initialOnly && fullCached && fullCached.expiresAt > Date.now() && isPtvReadingFullHomeCache(fullCached.data)) {
        const cacheDiagnostics = getCacheDiagnostic('hit', 'reading-memory-full', fullCached.data, {
            cacheKey
        });

        recordPtvTiming('cache', 'readingCacheRenderMs', 0, {
            itemCount: cacheDiagnostics.itemCount,
            kind: routeKind,
            source: 'reading-memory-full'
        });

        return Promise.resolve(withCacheDiagnostic(fullCached.data, cacheDiagnostics));
    }

    if (canUseKnownCache && cached && cached.expiresAt > Date.now() && (options.initialOnly || isPtvReadingFullHomeCache(cached.data))) {
        const cacheDiagnostics = getCacheDiagnostic('hit', 'reading-memory', cached.data, {
            cacheKey
        });

        recordPtvTiming('cache', 'readingCacheRenderMs', 0, {
            itemCount: cacheDiagnostics.itemCount,
            kind: routeKind,
            source: 'reading-memory'
        });
        recordPtvEvent('cache', 'reading-home-cache-hit', {
            isPartial: Boolean(cached.data.isPartial),
            itemCount: cacheDiagnostics.itemCount,
            kind: routeKind,
            sectionCount: cached.data.sections.length
        });

        return Promise.resolve(withCacheDiagnostic(cached.data, cacheDiagnostics));
    }

    if (canUseKnownCache) {
        const storageStartedAt = performance.now();
        const storedData = options.initialOnly ?
            readStoredReadingHome(routeKind, false, knownLibrarySetIdentity, view)
            || readStoredReadingHome(routeKind, true, knownLibrarySetIdentity, view) :
            readStoredReadingHome(routeKind, false, knownLibrarySetIdentity, view);

        if (storedData) {
            const durationMs = Number((performance.now() - storageStartedAt).toFixed(1));

            recordPtvTiming('cache', 'readingCacheRenderMs', durationMs, {
                itemCount: getReadingHomeItemCount(storedData),
                kind: routeKind,
                source: storedData.cacheDiagnostics?.source || 'reading-local-storage',
                staleHit: Boolean(storedData.cacheDiagnostics?.staleHit)
            });

            return Promise.resolve(storedData);
        }
    }

    recordPtvEvent('cache', 'reading-home-cache-miss', {
        initialOnly: Boolean(options.initialOnly),
        kind: routeKind
    });

    return timePtvAsync('api', 'reading-api-loaded', async () => {
        throwIfReadingAborted(options.signal);

        const startedAt = performance.now();
        const discovery = await fetchPtvReadingLibraryDiscovery(routeKind, {
            signal: options.signal
        });
        const { diagnostics: libraryDiagnostics, libraries } = discovery;
        const resolvedLibrarySetIdentity = getReadingLibrarySetIdentity(libraries, routeKind);
        cacheKey = getReadingHomeCacheKey(routeKind, resolvedLibrarySetIdentity, view);

        if (options.initialOnly) {
            const recentlyAddedSection = await fetchPtvReadingHomeSection(
                routeKind,
                'recently-added',
                READING_INITIAL_LIMIT,
                { signal: options.signal }
            );
            const sections = [
                recentlyAddedSection,
                getLoadingSection('continue-reading', 'Continue Reading', 'Loading in background'),
                getLoadingSection('favorites', 'Favorites', 'Loading in background')
            ].filter(isVisibleReadingSection);
            const allItems = uniquePtvReadingItems(recentlyAddedSection.items);
            const metadataStats = getPtvReadingMetadataStats(allItems);
            const requestDurationMs = Number((performance.now() - startedAt).toFixed(1));
            const libraryDebug = buildReadingLibraryDebug(routeKind, libraries, libraryDiagnostics, sections, requestDurationMs);
            const data: PtvReadingHomeData = {
                generatedAt: Date.now(),
                isPartial: true,
                kind: routeKind,
                libraries,
                libraryDebug,
                sectionDiagnostics: getSectionDiagnostics(sections),
                sections,
                stats: {
                    favoriteCount: 0,
                    itemCount: libraryDebug.totalRecordCountFromApi || allItems.length,
                    libraryCount: libraries.length,
                    metadata: metadataStats,
                    resumedCount: 0
                }
            };
            const cachedData = withCacheDiagnostic(data, getCacheDiagnostic('refresh', 'jellyfin-initial', data, {
                cacheKey,
                refreshDurationMs: requestDurationMs
            }));
            const createdAt = Date.now();

            throwIfReadingAborted(options.signal);
            readingHomeSummaryCache.set(cacheKey, {
                createdAt,
                data: cachedData,
                expiresAt: createdAt + READING_HOME_CACHE_TTL_MS
            });
            writeStoredReadingHome(routeKind, true, cachedData, resolvedLibrarySetIdentity, view);
            recordPtvEvent('api', 'reading-api-loaded', {
                isPartial: true,
                kind: routeKind,
                libraryDiagnostics,
                metadataProviderCounts: metadataStats.collectionStatus === 'collected' ? metadataStats.providerCounts : null,
                metadataProviderCountsStatus: metadataStats.collectionStatus || 'notCollected',
                metadataProviderItemCount: metadataStats.itemCount,
                requestDurationMs,
                sections: sections.map(section => ({
                    id: section.id,
                    itemCount: section.items.length,
                    status: section.diagnostics?.status || 'ready',
                    title: section.title
                }))
            });

            return cachedData;
        }

        const [
            recentlyAddedSection,
            continueReadingSection,
            favoritesSection,
            libraryPreviewSection
        ] = await runPtvScheduledRequests(
            [
                () => fetchPtvReadingHomeSection(
                    routeKind,
                    'recently-added',
                    READING_HOME_LIBRARY_PREVIEW_LIMIT,
                    { signal: options.signal }
                ),
                () => fetchPtvReadingHomeSection(
                    routeKind,
                    'continue-reading',
                    READING_HOME_LIBRARY_PREVIEW_LIMIT,
                    { signal: options.signal }
                ),
                () => fetchPtvReadingHomeSection(
                    routeKind,
                    'favorites',
                    READING_HOME_LIBRARY_PREVIEW_LIMIT,
                    { signal: options.signal }
                ),
                () => fetchPtvReadingHomeSection(
                    routeKind,
                    'library',
                    READING_HOME_LIBRARY_PREVIEW_LIMIT,
                    { signal: options.signal }
                )
            ],
            task => task(),
            {
                concurrency: 2,
                signal: options.signal
            }
        );
        const allItems = uniquePtvReadingItems([
            ...continueReadingSection.items,
            ...recentlyAddedSection.items,
            ...favoritesSection.items,
            ...libraryPreviewSection.items
        ]);
        const comics = allItems.filter(item => getPtvReadingItemKind(item) === 'comic');
        const manga = allItems.filter(item => getPtvReadingItemKind(item) === 'manga');
        const metadataStats = getPtvReadingMetadataStats(allItems);
        const sections = [
            continueReadingSection,
            recentlyAddedSection,
            favoritesSection,
            routeKind === 'reading' ? getSection('manga', 'Manga', manga, {
                kind: 'manga',
                subtitle: 'Right-to-left ready'
            }) : null,
            routeKind === 'reading' ? getSection('comics', 'Comics', comics, {
                kind: 'comic',
                subtitle: 'Issues and graphic novels'
            }) : null,
            ...getTopGenreSections(allItems),
            libraryPreviewSection
        ].filter(isVisibleReadingSection);
        const requestDurationMs = Number((performance.now() - startedAt).toFixed(1));
        const libraryDebug = buildReadingLibraryDebug(routeKind, libraries, libraryDiagnostics, sections, requestDurationMs);
        const data: PtvReadingHomeData = {
            generatedAt: Date.now(),
            isPartial: false,
            kind: routeKind,
            libraries,
            libraryDebug,
            sectionDiagnostics: getSectionDiagnostics(sections),
            sections,
            stats: {
                favoriteCount: favoritesSection.items.length,
                itemCount: libraryDebug.totalRecordCountFromApi || allItems.length,
                libraryCount: libraries.length,
                metadata: metadataStats,
                resumedCount: continueReadingSection.items.length
            }
        };
        const cachedData = withCacheDiagnostic(data, getCacheDiagnostic('refresh', 'jellyfin-background', data, {
            cacheKey,
            refreshDurationMs: requestDurationMs
        }));
        const createdAt = Date.now();

        throwIfReadingAborted(options.signal);
        readingHomeCache.set(cacheKey, {
            createdAt,
            data: cachedData,
            expiresAt: createdAt + READING_HOME_CACHE_TTL_MS
        });
        writeStoredReadingHome(routeKind, false, cachedData, resolvedLibrarySetIdentity, view);
        recordPtvEvent('api', 'reading-api-loaded', {
            isPartial: false,
            kind: routeKind,
            libraryDiagnostics,
            libraryPreviewCount: libraryPreviewSection.items.length,
            metadataProviderCounts: metadataStats.collectionStatus === 'collected' ? metadataStats.providerCounts : null,
            metadataProviderCountsStatus: metadataStats.collectionStatus || 'notCollected',
            metadataProviderItemCount: metadataStats.itemCount,
            requestDurationMs,
            sections: sections.map(section => ({
                id: section.id,
                itemCount: section.items.length,
                status: section.diagnostics?.status || 'ready',
                title: section.title
            }))
        });

        return cachedData;
    }, { kind: routeKind });
}
