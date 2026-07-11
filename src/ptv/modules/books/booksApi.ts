import {
    cleanPtvQuery,
    getPtvCurrentUserId,
    getPtvItem,
    getPtvItemImageCandidates,
    getPtvItemImageUrl,
    getPtvApiUrl,
    getPtvItems,
    getPtvServerId,
    getPtvUserViews,
    type PtvItemQuery,
    type PtvLibrary
} from '../../api';
import { recordPtvEvent, recordPtvTiming, timePtvAsync } from '../../core/observability';
import {
    deletePtvLibraryIndexCacheByPrefix,
    PTV_LIBRARY_INDEX_CACHE_TTL_MS,
    readPtvLibraryIndexCache,
    writePtvLibraryIndexCache
} from '../../utils/libraryIndexCache';
import { runPtvScheduledRequests } from '../../utils/ptvMediaRequestScheduler';
import { withPtvTimeout } from '../../utils/withPtvTimeout';

import { getPtvReadingMetadataStats } from './booksMetadataProviders';
import type {
    PtvReadingCacheDiagnostic,
    PtvReadingFileFormat,
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
    'Tags',
    'UserData'
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
const READING_LIBRARY_FETCH_CAP = 200;
const READING_LIBRARY_COUNT_TIMEOUT_MS = 3500;
const READING_SHELF_TIMEOUT_MS = 6500;
const READING_OPTIONAL_SHELF_TIMEOUT_MS = 2500;
const READING_CONTINUE_LIMIT = 12;
const READING_LIBRARY_INDEX_CACHE_SCHEMA_VERSION = 3;
const READING_HOME_STORAGE_SCHEMA_VERSION = 4;
const COMIC_EXTENSIONS = new Set(['cb7', 'cbr', 'cbt', 'cbz']);
const EPUB_EXTENSIONS = new Set(['epub']);
const PDF_EXTENSIONS = new Set(['pdf']);
const UNSUPPORTED_BOOK_EXTENSIONS = new Set(['azw', 'azw3', 'djvu', 'mobi']);
const MANGA_KEYWORDS = /(?:manga|manhwa|manhua)/i;
const COMIC_KEYWORDS = /(?:comic|comics|graphic novel|graphic novels|issue|issues)/i;
const BOOKS_KEYWORDS = /\b(?:book|books|ebook|ebooks|novel|novels|light novel|reader)\b/i;
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

type ScopedReadingItem = {
    item: PtvReadingItem;
    library?: PtvReadingLibraryScope;
};

type PtvReadingPagedFetchResult = {
    dropReasons: string[];
    droppedItemCount: number;
    entries: ScopedReadingItem[];
    lastReadingQueryUrl: string;
    pageCount: number;
    totalRecordCount: number;
};

type ReadingItemsRequestOptions = {
    enableImages?: boolean;
    fields?: string;
    stage?: string;
    timeoutMs?: number;
};

const readingHomeCache = new Map<string, ReadingHomeCacheEntry>();
const readingHomeSummaryCache = new Map<string, ReadingHomeCacheEntry>();
const readingLibraryCache = new Map<string, PtvReadingLibraryScope[]>();
const readingRecentlyAddedRequestCache = new Map<string, Promise<PtvReadingItem[]>>();

function getCacheKey(kind: PtvReadingRouteKind | 'all' = 'all') {
    return [
        getPtvServerId() || 'server',
        getPtvCurrentUserId() || 'user',
        kind
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

function getReadingHomeStorageKey(kind: PtvReadingRouteKind, initialOnly = false) {
    return `ptv:reading-home:v${READING_HOME_STORAGE_SCHEMA_VERSION}:${getCacheKey(kind)}:${initialOnly ? 'summary' : 'full'}`;
}

function getStorage(): Storage | null {
    try {
        return window.localStorage || null;
    } catch {
        return null;
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
    return {
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

function readStoredReadingHome(
    routeKind: PtvReadingRouteKind,
    initialOnly: boolean
): PtvReadingHomeData | null {
    const storage = getStorage();
    const storageKey = getReadingHomeStorageKey(routeKind, initialOnly);

    if (!storage) return null;

    try {
        const rawValue = storage.getItem(storageKey);

        if (!rawValue) {
            recordPtvEvent('cache', 'reading-home-storage-cache-miss', {
                initialOnly,
                kind: routeKind,
                storageKey
            });
            return null;
        }

        const entry = JSON.parse(rawValue) as ReadingHomeStorageEntry;

        if (entry.schemaVersion !== READING_HOME_STORAGE_SCHEMA_VERSION || entry.key !== storageKey || !entry.data) {
            storage.removeItem(storageKey);
            return null;
        }

        const now = Date.now();
        const isFresh = entry.expiresAt > now;
        const isStaleUsable = entry.createdAt + READING_HOME_STALE_TTL_MS > now;

        if (!isFresh && !isStaleUsable) {
            storage.removeItem(storageKey);
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
            ageMs: now - entry.createdAt,
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
            isPartial: entry.data.isPartial || !isFresh
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
    data: PtvReadingHomeData
) {
    const storage = getStorage();
    const storageKey = getReadingHomeStorageKey(routeKind, initialOnly);

    if (!storage) return;

    try {
        const createdAt = Date.now();
        const entry: ReadingHomeStorageEntry = {
            createdAt,
            data,
            expiresAt: createdAt + READING_HOME_CACHE_TTL_MS,
            key: storageKey,
            schemaVersion: READING_HOME_STORAGE_SCHEMA_VERSION
        };

        storage.setItem(storageKey, JSON.stringify(entry));
        recordPtvEvent('cache', 'reading-home-storage-cache-written', {
            initialOnly,
            itemCount: getReadingHomeItemCount(data),
            kind: routeKind,
            payloadSize: getPayloadSize(data),
            sectionCount: data.sections.length,
            storageKey
        });
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
    const storage = getStorage();

    if (!storage) return;

    try {
        const prefix = `ptv:reading-home:v${READING_HOME_STORAGE_SCHEMA_VERSION}:`;
        const keys: string[] = [];

        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);

            if (key?.startsWith(prefix)) keys.push(key);
        }

        keys.forEach(key => storage.removeItem(key));
        recordPtvEvent('cache', 'reading-home-storage-cache-cleared', {
            count: keys.length
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

function getExtensionFromText(value: unknown): string {
    const text = lower(value);
    const extensionMatch = /\.([a-z0-9]+)(?:$|\?)/.exec(text);

    if (extensionMatch?.[1]) return extensionMatch[1];
    if (text && !text.includes('/') && !text.includes('\\') && text.length <= 8) return text.replace(/^\./, '');

    return '';
}

export function getPtvReadingExtension(item: PtvReadingItem | null | undefined): string {
    if (!item) return '';

    const values = [
        item.Path,
        item.Container,
        item.MediaSources?.[0]?.Path,
        item.MediaSources?.[0]?.Container,
        item.Name
    ];

    for (const value of values) {
        const extension = getExtensionFromText(value);

        if (extension) return extension;
    }

    return '';
}

export function getPtvReadingFormat(item: PtvReadingItem | null | undefined): PtvReadingFileFormat {
    const extension = getPtvReadingExtension(item);
    const mime = lower(item?.MediaSources?.[0]?.MimeType || item?.MediaSources?.[0]?.MediaStreams?.[0]?.MimeType);

    if (EPUB_EXTENSIONS.has(extension) || mime.includes('epub')) return 'epub';
    if (PDF_EXTENSIONS.has(extension) || mime.includes('pdf')) return 'pdf';
    if (COMIC_EXTENSIONS.has(extension) || mime.includes('comicbook') || mime.includes('x-cb')) return 'comic';
    if (UNSUPPORTED_BOOK_EXTENSIONS.has(extension)) return 'unsupported';

    return 'book';
}

function getLibraryKind(library: PtvLibrary): PtvReadingItemKind {
    const text = getItemText(library);

    if (MANGA_KEYWORDS.test(text)) return 'manga';
    if (COMIC_KEYWORDS.test(text)) return 'comic';

    return 'book';
}

function isReadingLibrary(library: PtvLibrary) {
    const collectionType = lower(library.CollectionType);
    const text = getItemText(library);

    return collectionType === 'books'
        || BOOKS_KEYWORDS.test(text)
        || COMIC_KEYWORDS.test(text)
        || MANGA_KEYWORDS.test(text);
}

export function getPtvReadingRouteKind(value: string | null | undefined): PtvReadingRouteKind {
    const normalized = lower(value);

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
    const preferredKind = getPreferredReadingLibraryKind(routeKind);
    const matchedLibraries = libraries.filter(library => library.kind === preferredKind);

    return sortReadingLibrariesForRoute(matchedLibraries.length ? matchedLibraries : libraries, routeKind);
}

export function getPtvReadingItemKind(item: PtvReadingItem | null | undefined, libraryName = ''): PtvReadingItemKind {
    const hintedKind = item?.PtvReadingLibraryKindHint;
    const text = getItemText(item, libraryName || item?.PtvReadingLibraryName || '');
    const format = getPtvReadingFormat(item);

    if (MANGA_KEYWORDS.test(text)) return 'manga';
    if (COMIC_KEYWORDS.test(text)) return 'comic';
    if (hintedKind === 'manga' || hintedKind === 'comic') return hintedKind;
    if (format === 'comic') return 'comic';

    return 'book';
}

export function isPtvReadingKindMatch(
    item: PtvReadingItem | null | undefined,
    routeKind: PtvReadingRouteKind,
    libraryName = ''
) {
    if (!item) return false;
    const itemKind = getPtvReadingItemKind(item, libraryName);

    if (routeKind === 'books') return itemKind === 'book';

    return itemKind === (routeKind === 'manga' ? 'manga' : 'comic');
}

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

function getItems<TItem = PtvReadingItem>(
    query: PtvItemQuery,
    options: ReadingItemsRequestOptions = {}
) {
    const request = getPtvItems<TItem>({
        ...getReadingQueryDefaults(options),
        ...query
    });

    if (!options.timeoutMs) return request;

    return withPtvTimeout(
        request,
        options.timeoutMs,
        `${options.stage || 'Reading'} timed out after ${options.timeoutMs}ms.`
    );
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
            stage: options.stage || `${library.name} reading items`,
            timeoutMs: options.timeoutMs ?? READING_SHELF_TIMEOUT_MS
        });

        return (result.Items || [])
            .map(item => addLibraryHint(item, library))
            .filter(item => isPtvReadingKindMatch(item, routeKind, library.name));
    } catch (error) {
        recordPtvEvent('api', 'reading-library-recursive-fetch-fallback', {
            error: getErrorMessage(error),
            libraryId: library.id,
            libraryName: library.name,
            routeKind,
            stage: options.stage || 'reading-items'
        });

        const fallbackResult = await getItems<PtvReadingItem>({
            IncludeItemTypes: 'Book,Folder,Photo,BoxSet',
            Limit: query.Limit,
            ParentId: library.id,
            Recursive: false,
            SortBy: query.SortBy || 'SortName',
            SortOrder: query.SortOrder || 'Ascending',
            StartIndex: query.StartIndex
        }, {
            enableImages: false,
            fields: READING_PROBE_FIELDS,
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
    query: PtvItemQuery
): Promise<ScopedReadingItem[]> {
    const libraries = await getPtvReadingLibraries();
    const limit = typeof query.Limit === 'number' ? query.Limit : undefined;

    if (query.ParentId || !libraries.length) {
        const result = await getItems<PtvReadingItem>(query, {
            enableImages: false,
            fields: READING_PROBE_FIELDS,
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
            stage: `${library.name} scoped ${routeKind} items`,
            timeoutMs: READING_SHELF_TIMEOUT_MS
        });

        return items.map(item => ({
            item,
            library
        }));
    }, {
        concurrency: 2
    });

    const entries = results
        .reduce<ScopedReadingItem[]>((items, result) => items.concat(result), [])
        .filter(entry => matchesRouteKind(entry, routeKind));

    return getLimitedItems(uniquePtvReadingItems(entries.map(entry => entry.item)), limit)
        .map(item => entries.find(entry => entry.item.Id === item.Id) || { item });
}

async function fetchPagedReadingLibraryEntries(
    routeKind: PtvReadingRouteKind,
    query: PtvItemQuery,
    library?: PtvReadingLibraryScope
): Promise<PtvReadingPagedFetchResult> {
    const entries: ScopedReadingItem[] = [];
    const dropReasons: string[] = [];
    const baseQuery: PtvItemQuery = library?.id ? {
        ...query,
        ParentId: library.id
    } : query;
    let lastReadingQueryUrl = '';
    let pageCount = 0;
    let totalRecordCount = 0;

    while (entries.length < READING_LIBRARY_FETCH_CAP) {
        const pageQuery: PtvItemQuery = {
            ...baseQuery,
            Limit: READING_LIBRARY_PAGE_SIZE,
            StartIndex: entries.length
        };
        const requestOptions: ReadingItemsRequestOptions = {
            enableImages: false,
            fields: READING_PROBE_FIELDS,
            stage: `${library?.name || routeKind} library index page ${pageCount + 1}`,
            timeoutMs: READING_SHELF_TIMEOUT_MS
        };
        const result = await getItems<PtvReadingItem>(pageQuery, requestOptions);
        const pageItems = result.Items || [];

        lastReadingQueryUrl = getReadingItemsQueryUrl(pageQuery, requestOptions);
        pageCount += 1;
        totalRecordCount = typeof result.TotalRecordCount === 'number' ?
            result.TotalRecordCount :
            Math.max(totalRecordCount, entries.length + pageItems.length);
        entries.push(...pageItems.map(item => ({
            item: library ? {
                ...item,
                PtvReadingLibraryKindHint: library.kind,
                PtvReadingLibraryName: library.name
            } : item,
            library
        })));

        if (!pageItems.length || entries.length >= totalRecordCount) break;
    }

    const capDropCount = Math.max(0, totalRecordCount - Math.min(totalRecordCount, READING_LIBRARY_FETCH_CAP));

    if (capDropCount) {
        dropReasons.push(`${library?.name || 'Reading'}: capped at ${READING_LIBRARY_FETCH_CAP} item(s) for browser safety`);
    }

    recordPtvEvent('api', 'reading-library-page-fetch-complete', {
        fetchedCount: entries.length,
        lastReadingQueryUrl,
        libraryId: library?.id || null,
        libraryName: library?.name || null,
        pageCount,
        pageSize: READING_LIBRARY_PAGE_SIZE,
        routeKind,
        totalRecordCount
    });

    return {
        dropReasons,
        droppedItemCount: capDropCount,
        entries,
        lastReadingQueryUrl,
        pageCount,
        totalRecordCount
    };
}

function getEmptyPagedReadingResult(
    routeKind: PtvReadingRouteKind,
    library: PtvReadingLibraryScope | undefined,
    error: unknown
): PtvReadingPagedFetchResult {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
        dropReasons: [`${library?.name || routeKind}: fetch failed - ${errorMessage}`],
        droppedItemCount: 0,
        entries: [],
        lastReadingQueryUrl: '',
        pageCount: 0,
        totalRecordCount: 0
    };
}

function recoverPagedReadingEntries(
    routeKind: PtvReadingRouteKind,
    library: PtvReadingLibraryScope | undefined,
    promise: Promise<PtvReadingPagedFetchResult>
): Promise<PtvReadingPagedFetchResult> {
    return promise.catch(error => {
        recordPtvEvent('api', 'reading-library-index-section-failed', {
            error: error instanceof Error ? error.message : String(error),
            libraryId: library?.id || null,
            libraryName: library?.name || null,
            routeKind
        });

        return getEmptyPagedReadingResult(routeKind, library, error);
    });
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

export async function fetchPtvReadingLibraryIndex(
    routeKind: PtvReadingRouteKind,
    options: {
        forceRefresh?: boolean;
    } = {}
): Promise<PtvReadingLibraryIndex> {
    const startedAt = performance.now();
    const cacheKey = getReadingLibraryIndexCacheKey(routeKind);

    if (!options.forceRefresh) {
        const cachedIndex = await readPtvLibraryIndexCache<PtvReadingLibraryIndex>(
            cacheKey,
            READING_LIBRARY_INDEX_CACHE_SCHEMA_VERSION
        );

        if (cachedIndex) return cachedIndex;
    }

    const discovery = await fetchPtvReadingLibraryDiscovery(routeKind);
    const libraries = discovery.libraries;
    const targetLibraries: Array<PtvReadingLibraryScope | undefined> = libraries.length ?
        getReadingLibrariesForRoute(libraries, routeKind) :
        [undefined];
    const selectedLibraries = targetLibraries.filter((library): library is PtvReadingLibraryScope => Boolean(library));
    const results = await runPtvScheduledRequests(
        targetLibraries,
        library => recoverPagedReadingEntries(
            routeKind,
            library,
            fetchPagedReadingLibraryEntries(routeKind, {
                SortBy: 'SortName',
                SortOrder: 'Ascending'
            }, library)
        ),
        { concurrency: 2 }
    );
    const rawEntries = results.reduce<ScopedReadingItem[]>((items, result) => items.concat(result.entries), []);
    const matchedEntries = rawEntries.filter(entry => matchesRouteKind(entry, routeKind));
    const uniqueItems = uniquePtvReadingItems(matchedEntries.map(entry => entry.item));
    const duplicateDropCount = Math.max(0, matchedEntries.length - uniqueItems.length);
    const routeFilterDropCount = Math.max(0, rawEntries.length - matchedEntries.length);
    const dropReasons = results.reduce<string[]>((reasons, result) => reasons.concat(result.dropReasons), []);

    if (duplicateDropCount) dropReasons.push(`${routeKind}: ${duplicateDropCount} duplicate item(s) removed`);
    if (routeFilterDropCount) dropReasons.push(`${routeKind}: ${routeFilterDropCount} item(s) excluded by reading kind filter`);

    const sortedItems = [...uniqueItems];

    sortedItems.sort(byTitle);

    const requestDurationMs = Number((performance.now() - startedAt).toFixed(1));
    const debug: PtvReadingLibraryDebug = {
        dropReasons,
        droppedItemCount: results.reduce((total, result) => total + result.droppedItemCount, 0) + duplicateDropCount + routeFilterDropCount,
        fetchedItemCount: sortedItems.length,
        jellyfinItemTotal: results.reduce((total, result) => total + result.totalRecordCount, 0),
        jellyfinRouteItemTotal: sortedItems.length,
        kindCounts: getReadingKindCounts(sortedItems),
        lastReadingQueryUrl: [...results].reverse().find(result => result.lastReadingQueryUrl)?.lastReadingQueryUrl || '',
        libraryDiagnostics: discovery.diagnostics,
        pageCount: results.reduce((total, result) => total + result.pageCount, 0),
        pageSize: READING_LIBRARY_PAGE_SIZE,
        readingLibraryNames: selectedLibraries.map(library => library.name),
        requestDurationMs,
        routeKind,
        selectedReadingLibraryIds: selectedLibraries.map(library => library.id),
        sectionDiagnostics: [],
        statusCode: results.some(result => result.dropReasons.length) ? null : 200,
        totalRecordCountFromApi: results.reduce((total, result) => total + result.totalRecordCount, 0)
    };

    recordPtvEvent('api', 'reading-library-index-loaded', debug);

    const index = {
        debug,
        items: sortedItems,
        libraries
    };

    if (sortedItems.length || !dropReasons.length) {
        await writePtvLibraryIndexCache(
            cacheKey,
            READING_LIBRARY_INDEX_CACHE_SCHEMA_VERSION,
            index,
            PTV_LIBRARY_INDEX_CACHE_TTL_MS
        );
    }

    return index;
}

export function invalidatePtvReadingHomeCache() {
    readingHomeCache.clear();
    readingHomeSummaryCache.clear();
    readingLibraryCache.clear();
    readingRecentlyAddedRequestCache.clear();
    clearStoredReadingHomeCache();
    void deletePtvLibraryIndexCacheByPrefix(getReadingLibraryIndexCachePrefix());
}

export async function getPtvReadingLibraries(): Promise<PtvReadingLibraryScope[]> {
    const cacheKey = getCacheKey('all');

    if (readingLibraryCache.has(cacheKey)) {
        return readingLibraryCache.get(cacheKey) || [];
    }

    const result = await getPtvUserViews();
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
        libraryCount: libraries.length,
        libraryNames: libraries.map(library => library.name)
    });

    return libraries;
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
    routeKind: PtvReadingRouteKind
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
    } = {}
): Promise<{
    diagnostics: PtvReadingLibraryDiagnostic[];
    libraries: PtvReadingLibraryScope[];
    requestDurationMs: number;
}> {
    const startedAt = performance.now();
    const libraries = await getPtvReadingLibraries().catch(error => {
        recordPtvEvent('api', 'reading-library-discovery-failed', {
            error: getErrorMessage(error),
            routeKind
        });

        return [];
    });

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
            diagnostics,
            libraryCount: diagnostics.length,
            requestDurationMs,
            routeKind,
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
        library => fetchPtvReadingLibraryDiagnostic(library, routeKind),
        { concurrency: 2 }
    );
    const requestDurationMs = Number((performance.now() - startedAt).toFixed(1));

    recordPtvEvent('api', 'reading-library-discovery-loaded', {
        diagnostics: results.map(result => result.diagnostic),
        libraryCount: results.length,
        requestDurationMs,
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

    return [...new Set(authors)].join(', ') || 'Unknown Author';
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
    preferredImageType: 'Backdrop' | 'Primary' | 'Thumb' = 'Primary'
) {
    if (!item) return READING_PLACEHOLDER_IMAGE;

    let order: Array<'Primary' | 'Thumb' | 'Backdrop' | 'SeriesPrimary' | 'ParentPrimary'> = ['Primary', 'ParentPrimary', 'Thumb', 'Backdrop'];

    if (preferredImageType === 'Backdrop') {
        order = ['Backdrop', 'Primary', 'ParentPrimary', 'Thumb'];
    } else if (preferredImageType === 'Thumb') {
        order = ['Thumb', 'Primary', 'ParentPrimary', 'Backdrop'];
    }

    const candidates = getPtvItemImageCandidates(item, {
        baseOptions: {
            fillHeight: preferredImageType === 'Backdrop' ? Math.round(size * 0.56) : Math.round(size * 1.5),
            fillWidth: size,
            quality: 90
        },
        order
    });
    const taggedCandidate = candidates.find(candidate => candidate.tag);

    if (taggedCandidate?.url) return taggedCandidate.url;
    if (item.Id) {
        return getPtvItemImageUrl(item, {
            fillHeight: Math.round(size * 1.5),
            fillWidth: size,
            imageType: 'Primary',
            quality: 90
        });
    }

    return READING_PLACEHOLDER_IMAGE;
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
        routeKind === 'books' ? getSection('manga', 'Manga', manga, {
            kind: 'manga',
            subtitle: 'Right-to-left ready'
        }) : null,
        routeKind === 'books' ? getSection('comics', 'Comics', comics, {
            kind: 'comic',
            subtitle: 'Issues and graphic novels'
        }) : null,
        ...getTopGenreSections(allItems),
        getSection('library', routeKind === 'books' ? 'All Reading' : `All ${routeKind}`, allItems, {
            subtitle: 'Library'
        })
    ].filter((section): section is PtvReadingSection => Boolean(section?.items.length));

    return {
        ...homeData,
        generatedAt: Date.now(),
        isPartial: false,
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
    limit = DEFAULT_READING_LIMIT
): Promise<PtvReadingItem[]> {
    const entries = await getScopedReadingEntries(routeKind, {
        Limit: limit,
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        ...query
    });

    return entries.map(entry => entry.item);
}

export async function fetchPtvReadingRecentlyAdded(
    routeKind: PtvReadingRouteKind,
    limit = DEFAULT_READING_LIMIT
): Promise<PtvReadingItem[]> {
    const cacheKey = `${getCacheKey(routeKind)}:recently-added:${limit}`;
    const inFlightRequest = readingRecentlyAddedRequestCache.get(cacheKey);

    if (inFlightRequest) return inFlightRequest;

    const request = fetchPtvReadingRecentlyAddedUncached(routeKind, limit)
        .finally(() => {
            readingRecentlyAddedRequestCache.delete(cacheKey);
        });

    readingRecentlyAddedRequestCache.set(cacheKey, request);

    return request;
}

async function fetchPtvReadingRecentlyAddedUncached(
    routeKind: PtvReadingRouteKind,
    limit: number
): Promise<PtvReadingItem[]> {
    const libraries = await getPtvReadingLibraries();
    const recentQuery: PtvItemQuery = {
        SortBy: 'DateCreated',
        SortOrder: 'Descending'
    };

    if (!libraries.length) {
        const result = await getItems<PtvReadingItem>({
            ...recentQuery,
            Limit: Math.min(limit, READING_HOME_LIBRARY_PREVIEW_LIMIT)
        }, {
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
            stage: `${library.name} recently added`,
            timeoutMs: READING_SHELF_TIMEOUT_MS
        });
    }, {
        concurrency: 2
    });

    return uniquePtvReadingItems(results.reduce<PtvReadingItem[]>((items, result) => items.concat(result), []))
        .sort(byDateDescending)
        .slice(0, limit);
}

export function searchPtvReading(
    routeKind: PtvReadingRouteKind,
    searchTerm: string,
    limit = 60
): Promise<PtvReadingItem[]> {
    const normalizedSearchTerm = searchTerm.trim();

    if (!normalizedSearchTerm) return Promise.resolve([]);

    return fetchPtvReadingItems(routeKind, {
        SearchTerm: normalizedSearchTerm,
        SortBy: 'SortName',
        SortOrder: 'Ascending'
    }, limit);
}

export function fetchPtvReadingItem(itemId: string): Promise<PtvReadingItem> {
    return getPtvItem<PtvReadingItem>(itemId);
}

function fetchPtvReadingContinueItems(routeKind: PtvReadingRouteKind, limit = 36): Promise<PtvReadingItem[]> {
    return fetchPtvReadingItems(routeKind, {
        Filters: 'IsResumable',
        SortBy: 'DatePlayed',
        SortOrder: 'Descending'
    }, limit);
}

function fetchPtvReadingFavoriteItems(routeKind: PtvReadingRouteKind, limit = 48): Promise<PtvReadingItem[]> {
    return fetchPtvReadingItems(routeKind, {
        Filters: 'IsFavorite',
        SortBy: 'SortName',
        SortOrder: 'Ascending'
    }, limit);
}

function getReadingSectionTitle(sectionId: string, routeKind: PtvReadingRouteKind) {
    if (sectionId === 'continue-reading') return 'Continue Reading';
    if (sectionId === 'favorites') return 'Favorites';
    if (sectionId === 'recently-added') return 'Recently Added';
    if (sectionId === 'library') return routeKind === 'books' ? 'All Reading' : `All ${routeKind}`;
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
    task: () => Promise<PtvReadingItem[]>,
    options: {
        kind?: PtvReadingItemKind;
        lastQueriedUrl?: string;
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

    try {
        const items = await withPtvTimeout(
            task(),
            timeoutMs,
            `${title} shelf timed out after ${timeoutMs}ms.`
        );
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
        const errorMessage = getErrorMessage(error);
        const requestDurationMs = Number((performance.now() - startedAt).toFixed(1));
        const diagnostics = getSectionDiagnostic(sectionId, title, source, [], {
            error: errorMessage,
            lastQueriedUrl: options.lastQueriedUrl,
            requestDurationMs,
            status: 'error',
            statusCode: getErrorStatusCode(error),
            timeoutReason: isTimeoutError(error) ? errorMessage : undefined
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
    }
}

async function getReadingRouteQueryForDiagnostics(
    routeKind: PtvReadingRouteKind,
    query: PtvItemQuery
) {
    const libraries = await getPtvReadingLibraries().catch(() => []);
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
    limit = READING_HOME_LIBRARY_PREVIEW_LIMIT
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
            () => fetchPtvReadingRecentlyAdded(routeKind, Math.min(limit, READING_HOME_LIBRARY_PREVIEW_LIMIT)),
            {
                lastQueriedUrl: getReadingItemsQueryUrl(await getReadingRouteQueryForDiagnostics(routeKind, query), {
                    enableImages: false,
                    fields: READING_PROBE_FIELDS
                }),
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
            () => fetchPtvReadingContinueItems(routeKind, sectionLimit),
            {
                lastQueriedUrl: getReadingItemsQueryUrl(await getReadingRouteQueryForDiagnostics(routeKind, query), {
                    enableImages: false,
                    fields: READING_PROBE_FIELDS
                }),
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
            () => fetchPtvReadingFavoriteItems(routeKind, Math.min(limit, READING_HOME_LIBRARY_PREVIEW_LIMIT)),
            {
                lastQueriedUrl: getReadingItemsQueryUrl(await getReadingRouteQueryForDiagnostics(routeKind, query), {
                    enableImages: false,
                    fields: READING_PROBE_FIELDS
                }),
                source: 'jellyfin-favorites'
            }
        );
    }

    return runReadingShelf(
        routeKind,
        'library',
        () => fetchPtvReadingItems(routeKind, {
            SortBy: 'SortName',
            SortOrder: 'Ascending'
        }, Math.min(limit, READING_HOME_LIBRARY_PREVIEW_LIMIT)),
        {
            lastQueriedUrl: getReadingItemsQueryUrl(await getReadingRouteQueryForDiagnostics(routeKind, {
                Limit: Math.min(limit, READING_HOME_LIBRARY_PREVIEW_LIMIT),
                SortBy: 'SortName',
                SortOrder: 'Ascending'
            }), {
                enableImages: false,
                fields: READING_PROBE_FIELDS
            }),
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
    } = {}
): Promise<PtvReadingHomeData> {
    const cacheKey = getCacheKey(routeKind);
    const activeCache = options.initialOnly ? readingHomeSummaryCache : readingHomeCache;
    const cached = activeCache.get(cacheKey);
    const fullCached = readingHomeCache.get(cacheKey);

    if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
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

    if (!options.forceRefresh && options.initialOnly && fullCached && fullCached.expiresAt > Date.now()) {
        const cacheDiagnostics = getCacheDiagnostic('hit', 'reading-memory-full', fullCached.data, {
            cacheKey
        });

        recordPtvTiming('cache', 'readingCacheRenderMs', 0, {
            itemCount: cacheDiagnostics.itemCount,
            kind: routeKind,
            source: 'reading-memory-full'
        });
        recordPtvEvent('cache', 'reading-home-cache-hit', {
            isPartial: false,
            itemCount: cacheDiagnostics.itemCount,
            kind: routeKind,
            sectionCount: fullCached.data.sections.length
        });

        return Promise.resolve(withCacheDiagnostic(fullCached.data, cacheDiagnostics));
    }

    if (!options.forceRefresh) {
        const storageStartedAt = performance.now();
        const storedData = readStoredReadingHome(routeKind, Boolean(options.initialOnly))
            || (options.initialOnly ? readStoredReadingHome(routeKind, false) : null);

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
        const startedAt = performance.now();
        const discovery = await fetchPtvReadingLibraryDiscovery(routeKind);
        const { diagnostics: libraryDiagnostics, libraries } = discovery;

        if (options.initialOnly) {
            const recentlyAddedSection = await fetchPtvReadingHomeSection(routeKind, 'recently-added', READING_INITIAL_LIMIT);
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

            readingHomeSummaryCache.set(cacheKey, {
                createdAt,
                data: cachedData,
                expiresAt: createdAt + READING_HOME_CACHE_TTL_MS
            });
            writeStoredReadingHome(routeKind, true, cachedData);
            recordPtvEvent('api', 'reading-api-loaded', {
                isPartial: true,
                kind: routeKind,
                libraryDiagnostics,
                metadataProviderCounts: metadataStats.providerCounts,
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
                () => fetchPtvReadingHomeSection(routeKind, 'recently-added', READING_HOME_LIBRARY_PREVIEW_LIMIT),
                () => fetchPtvReadingHomeSection(routeKind, 'continue-reading', READING_HOME_LIBRARY_PREVIEW_LIMIT),
                () => fetchPtvReadingHomeSection(routeKind, 'favorites', READING_HOME_LIBRARY_PREVIEW_LIMIT),
                () => fetchPtvReadingHomeSection(routeKind, 'library', READING_HOME_LIBRARY_PREVIEW_LIMIT)
            ],
            task => task(),
            { concurrency: 2 }
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
            routeKind === 'books' ? getSection('manga', 'Manga', manga, {
                kind: 'manga',
                subtitle: 'Right-to-left ready'
            }) : null,
            routeKind === 'books' ? getSection('comics', 'Comics', comics, {
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

        readingHomeCache.set(cacheKey, {
            createdAt,
            data: cachedData,
            expiresAt: createdAt + READING_HOME_CACHE_TTL_MS
        });
        writeStoredReadingHome(routeKind, false, cachedData);
        recordPtvEvent('api', 'reading-api-loaded', {
            isPartial: false,
            kind: routeKind,
            libraryDiagnostics,
            libraryPreviewCount: libraryPreviewSection.items.length,
            metadataProviderCounts: metadataStats.providerCounts,
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
