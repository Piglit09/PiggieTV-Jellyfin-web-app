import {
    cleanPtvQuery,
    getPtvCurrentUserId,
    getPtvFavoriteItems,
    getPtvItem,
    getPtvItemImageCandidates,
    getPtvItemImageUrl,
    getPtvApiUrl,
    getPtvItems,
    getPtvRecentlyAdded,
    getPtvResumeItems,
    getPtvServerId,
    getPtvUserViews,
    requestPtvJson,
    sendPtvJson,
    type PtvLibrary,
    type PtvItemsResult,
    type PtvItemQuery
} from '../../api';
import { recordPtvEvent, timePtvAsync } from '../../core/observability';
import { getCurrentPtvPluginApiClient } from '../../core/pluginApi';
import { logPtvRecommendationStage } from '../recommendations/debug/recommendationRuntimeDebug';
import {
    readPtvLocalStorageJson,
    removePtvLocalStorageKey,
    writePtvLocalStorageJson
} from '../../services/runtimeStability';
import {
    deletePtvLibraryIndexCache,
    deletePtvLibraryIndexCacheByPrefix,
    PTV_LIBRARY_INDEX_CACHE_TTL_MS,
    readPtvLibraryIndexCache,
    writePtvLibraryIndexCache
} from '../../utils/libraryIndexCache';
import { runPtvScheduledRequests } from '../../utils/ptvMediaRequestScheduler';
import { getPtvMusicPageLimit as getPtvMusicPageLimitForBudget } from './musicPaging';

import type {
    PtvMusicCodec,
    PtvMusicHomeData,
    PtvMusicItem,
    PtvMusicLibraryDebug,
    PtvMusicLibraryDiscoveryItem,
    PtvMusicLibraryIndex,
    PtvMusicLyricsResponse,
    PtvMusicMetadataLookupResponse,
    PtvMusicMediaStream,
    PtvMusicSection,
    PtvMusicSectionTiming
} from './musicTypes';
import { createPtvMusicRecommendationEngine } from './musicRecommendations';
import {
    getPtvLikedMusicItems,
    mergePtvLikedMusicItems
} from './musicLikes';
import {
    compactPtvMusicHomeSnapshotForStorage,
    getMusicJsonPayloadBytes,
    MUSIC_HOME_PERSISTENT_CACHE_SCHEMA_VERSION,
    MUSIC_HOME_SNAPSHOT_MAX_BYTES,
    MUSIC_HOME_SNAPSHOT_TARGET_BYTES
} from './musicHomeSnapshot';

const MUSIC_FIELDS = [
    'Album',
    'AlbumArtist',
    'AlbumPrimaryImageItemId',
    'AlbumPrimaryImageTag',
    'AlbumArtists',
    'Artist',
    'ArtistItems',
    'Artists',
    'AudioInfo',
    'BackdropImageTags',
    'CanDelete',
    'CanDownload',
    'DateCreated',
    'Genres',
    'ImageTags',
    'MediaSources',
    'MediaStreams',
    'Overview',
    'ParentBackdropImageTags',
    'ParentId',
    'Path',
    'PremiereDate',
    'ParentPrimaryImageItemId',
    'ParentPrimaryImageTag',
    'PrimaryImageAspectRatio',
    'ProductionYear',
    'ProviderIds',
    'SortName',
    'Tags',
    'UserData'
].join(',');

const MUSIC_HOME_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TRACK_LIMIT = 28;
const DEFAULT_ALBUM_SAMPLE_LIMIT = 32;
const DEFAULT_ARTIST_SAMPLE_LIMIT = 32;
const MUSIC_LIBRARY_PAGE_SIZE = 48;
const MUSIC_LIBRARY_FETCH_CAP = 360;
const MUSIC_LIBRARY_INDEX_CACHE_SCHEMA_VERSION = 1;
const MAX_GENERATOR_PAGE_SIZE = 100;
const UNKNOWN_ARTIST_LABEL = 'Unknown Artist';
const UNKNOWN_TRACK_LABEL = 'Unknown Track';
const UNKNOWN_DISPLAY_VALUES = new Set([
    'n/a',
    'none',
    'unknown',
    'unknown artist',
    'unknown title',
    'unknown track',
    '[unknown]',
    '<unknown>'
]);

export function getPtvMusicPageLimit(retainedCount: number, pageSize = MUSIC_LIBRARY_PAGE_SIZE, maxItems = MUSIC_LIBRARY_FETCH_CAP) {
    return getPtvMusicPageLimitForBudget(retainedCount, pageSize, maxItems);
}
const MUSIC_PLACEHOLDER_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent([
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">',
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#71d7ff"/><stop offset=".55" stop-color="#a78bfa"/><stop offset="1" stop-color="#ff73bd"/></linearGradient></defs>',
    '<rect width="640" height="640" rx="42" fill="#070711"/>',
    '<circle cx="320" cy="282" r="152" fill="url(#g)" opacity=".34"/>',
    '<path d="M384 160v254a62 62 0 1 1-34-55V224l-142 32v190a62 62 0 1 1-34-55V222l210-48z" fill="#fff" opacity=".92"/>',
    '</svg>'
].join(''))}`;
const musicImageUrlCache = new Map<string, string>();

type MusicHomeCacheEntry = {
    data: PtvMusicHomeData;
    expiresAt: number;
    schemaVersion?: number;
};

type MusicDataCoordinatorRequest<T> = {
    activeConsumerCount: number;
    owners: Set<string>;
    promise: Promise<T>;
    startedAt: number;
};

type PtvMusicLibraryScope = {
    detectionReason?: string;
    id: string;
    musicLibrariesFound: PtvMusicLibraryDiscoveryItem[];
    musicLibraryCount?: number;
    name: string;
    selectedParentId: string;
};

type PtvMusicLibraryPageName = 'albums' | 'artists' | 'playlists' | 'tracks';

type PtvMusicPagedFetchResult = {
    durationMs: number;
    dropReasons: string[];
    droppedCount: number;
    error?: string;
    items: PtvMusicItem[];
    lastQueryUrl: string;
    pageCount: number;
    parentId?: string | null;
    status: 'empty' | 'error' | 'ok';
    totalRecordCount: number;
};
type PtvMusicImageType = 'Backdrop' | 'Primary' | 'Thumb';

type PtvMusicQueryStatus = NonNullable<PtvMusicLibraryDebug['queryStatus']>[string];

type PtvMusicLibraryIndexResults = {
    albumsResult: PtvMusicPagedFetchResult;
    artistsResult: PtvMusicPagedFetchResult;
    playlistsResult: PtvMusicPagedFetchResult;
    queryStartedAt: Record<PtvMusicLibraryPageName, number>;
    tracksResult: PtvMusicPagedFetchResult;
};

const musicHomeCache = new Map<string, MusicHomeCacheEntry>();
const musicHomeSummaryCache = new Map<string, MusicHomeCacheEntry>();
const musicLibraryCache = new Map<string, PtvMusicLibraryScope | null>();
const musicDataCoordinatorRequests = new Map<string, MusicDataCoordinatorRequest<unknown>>();
let musicDataRequestStartedCount = 0;
let musicDataRequestJoinedCount = 0;
let musicDataRequestCancelledCount = 0;
let musicRouteWorkRevision = 0;
let lastMusicLibraryDiscovery: {
    detectionReason?: string;
    musicLibrariesFound: PtvMusicLibraryDiscoveryItem[];
    musicLibraryCount: number;
    selectedMusicLibraryId: string | null;
    selectedMusicLibraryName: string | null;
    selectedParentId: string | null;
} = {
    musicLibrariesFound: [],
    musicLibraryCount: 0,
    selectedMusicLibraryId: null,
    selectedMusicLibraryName: null,
    selectedParentId: null
};

function getCacheKey() {
    return [
        getPtvServerId() || 'server',
        getPtvCurrentUserId() || 'user'
    ].join(':');
}

function getMusicDataScopeKey(libraryId = 'pending') {
    return [
        getPtvServerId() || 'server',
        getPtvCurrentUserId() || 'user',
        libraryId || 'unscoped'
    ].join(':');
}

function getMusicHomeStorageKey(cacheKey: string, initialOnly = false) {
    return `ptv:music-home-snapshot:${cacheKey}:${initialOnly ? 'initial' : 'full'}:v${MUSIC_HOME_PERSISTENT_CACHE_SCHEMA_VERSION}`;
}

function getMusicPerformanceNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function runMusicCoordinatorRequest<T>(
    requestKey: string,
    requestOwner: string,
    task: () => Promise<T>
): Promise<T> {
    const existing = musicDataCoordinatorRequests.get(requestKey) as MusicDataCoordinatorRequest<T> | undefined;

    if (existing) {
        existing.activeConsumerCount += 1;
        existing.owners.add(requestOwner);
        musicDataRequestJoinedCount += 1;
        recordPtvEvent('api', 'music-data-coordinator-request-joined', {
            activeConsumerCount: existing.activeConsumerCount,
            joinedExistingRequest: true,
            requestJoinedCount: musicDataRequestJoinedCount,
            requestKey,
            requestOwner,
            requestStartedCount: musicDataRequestStartedCount
        });

        return existing.promise.finally(() => {
            existing.activeConsumerCount = Math.max(0, existing.activeConsumerCount - 1);
        });
    }

    musicDataRequestStartedCount += 1;
    const startedAt = getMusicPerformanceNow();
    const entry: MusicDataCoordinatorRequest<T> = {
        activeConsumerCount: 1,
        owners: new Set([requestOwner]),
        promise: Promise.resolve()
            .then(task)
            .finally(() => {
                const current = musicDataCoordinatorRequests.get(requestKey);

                if (current === entry) {
                    musicDataCoordinatorRequests.delete(requestKey);
                }
            }),
        startedAt
    };

    musicDataCoordinatorRequests.set(requestKey, entry as MusicDataCoordinatorRequest<unknown>);
    recordPtvEvent('api', 'music-data-coordinator-request-started', {
        activeConsumerCount: entry.activeConsumerCount,
        joinedExistingRequest: false,
        requestKey,
        requestOwner,
        requestStartedCount: musicDataRequestStartedCount
    });

    return entry.promise.finally(() => {
        entry.activeConsumerCount = Math.max(0, entry.activeConsumerCount - 1);
        recordPtvEvent('api', 'music-data-coordinator-request-finished', {
            activeConsumerCount: entry.activeConsumerCount,
            durationMs: Number((getMusicPerformanceNow() - startedAt).toFixed(1)),
            requestKey,
            requestOwner
        });
    });
}

function readPersistentMusicHomeCache(cacheKey: string, initialOnly = false, allowStale = true) {
    const startedAt = getMusicPerformanceNow();
    const storageKey = getMusicHomeStorageKey(cacheKey, initialOnly);
    const entry = readPtvLocalStorageJson<MusicHomeCacheEntry | null>(storageKey, null);
    const homeCacheReadMs = Number((getMusicPerformanceNow() - startedAt).toFixed(1));
    const isFresh = Boolean(entry && entry.expiresAt > Date.now());

    if (
        entry?.schemaVersion === MUSIC_HOME_PERSISTENT_CACHE_SCHEMA_VERSION
        && entry.data
        && canUseMusicHomeCache(entry.data)
        && (isFresh || allowStale)
    ) {
        const activeCache = initialOnly ? musicHomeSummaryCache : musicHomeCache;

        activeCache.set(cacheKey, {
            ...entry,
            expiresAt: isFresh ? entry.expiresAt : Date.now() + 1000
        });
        recordPtvEvent('cache', 'music-home-persistent-cache-hit', {
            cacheAgeMs: Math.max(0, Date.now() - entry.data.generatedAt),
            completeness: entry.data.completeness || null,
            homeCacheHit: true,
            homeCacheReadMs,
            initialOnly,
            itemCount: getMusicHomeItemCount(entry.data),
            staleHit: !isFresh,
            sectionCount: entry.data.sections.length
        });

        return entry.data;
    }

    if (entry) {
        removePtvLocalStorageKey(storageKey);
    }

    recordPtvEvent('cache', 'music-home-persistent-cache-miss', {
        homeCacheHit: false,
        homeCacheReadMs,
        initialOnly,
        reason: entry ? 'expired-invalid-or-empty' : 'missing'
    });

    return null;
}

function writePersistentMusicHomeCache(cacheKey: string, data: PtvMusicHomeData, initialOnly = false) {
    if (!shouldWriteMusicHomeCache(data)) return false;

    const compacted = compactPtvMusicHomeSnapshotForStorage(data);
    const entry = {
        data: compacted.data,
        expiresAt: Date.now() + MUSIC_HOME_CACHE_TTL_MS,
        schemaVersion: MUSIC_HOME_PERSISTENT_CACHE_SCHEMA_VERSION
    };
    const entryBytes = getMusicJsonPayloadBytes(entry);
    const snapshotWriteSucceeded = writePtvLocalStorageJson(
        getMusicHomeStorageKey(cacheKey, initialOnly),
        entry,
        {
            maxBytes: MUSIC_HOME_SNAPSHOT_MAX_BYTES,
            namespace: 'ptv:music-home-snapshot'
        }
    );

    recordPtvEvent('cache', 'music-home-snapshot-compacted', {
        ...compacted.diagnostics,
        cacheKind: initialOnly ? 'initial' : 'full',
        entryBytes,
        snapshotTargetBytes: MUSIC_HOME_SNAPSHOT_TARGET_BYTES,
        snapshotWriteSucceeded
    });

    return snapshotWriteSucceeded;
}

export function getPtvMusicDataCoordinatorReport() {
    return {
        activeRequests: Array.from(musicDataCoordinatorRequests.entries()).map(([requestKey, request]) => ({
            activeConsumerCount: request.activeConsumerCount,
            owners: Array.from(request.owners),
            requestKey,
            runningMs: Number((getMusicPerformanceNow() - request.startedAt).toFixed(1))
        })),
        activeRequestCount: musicDataCoordinatorRequests.size,
        requestCancelledCount: musicDataRequestCancelledCount,
        requestJoinedCount: musicDataRequestJoinedCount,
        requestStartedCount: musicDataRequestStartedCount
    };
}

export function cancelPtvMusicRouteWork(ownerRoute = 'music') {
    musicRouteWorkRevision += 1;
    musicDataRequestCancelledCount += 1;
    recordPtvEvent('api', 'music-data-coordinator-route-work-cancelled', {
        abortLatencyMs: 0,
        abortedOnRouteExit: true,
        ownerRoute,
        persistentBackgroundWork: false,
        requestCancelledCount: musicDataRequestCancelledCount,
        routeWorkRevision: musicRouteWorkRevision
    });
}

export const MusicDataCoordinator = {
    buildUpNext(seedItem: PtvMusicItem, options: { limit?: number; pool?: PtvMusicItem[] } = {}) {
        return import('./musicRecommendations').then(module => module.buildPtvMusicRelatedTracks(seedItem, options));
    },
    cancelRouteWork: cancelPtvMusicRouteWork,
    invalidate: invalidatePtvMusicHomeCache,
    loadSection(section: 'albums' | 'artists' | 'playlists' | 'tracks', limit?: number) {
        switch (section) {
            case 'albums':
                return fetchPtvMusicAlbums(limit);
            case 'artists':
                return fetchPtvMusicArtists(limit);
            case 'playlists':
                return fetchPtvMusicPlaylists(limit);
            case 'tracks':
            default:
                return fetchPtvMusicTracks({}, limit);
        }
    },
    loadHomeSnapshot: getPtvMusicHome,
    loadLibraryIndex: fetchPtvMusicLibraryIndex,
    resolveLibrary: getPtvMusicLibrary,
    report: getPtvMusicDataCoordinatorReport
};

export function getPtvMusicDataCoordinator() {
    return MusicDataCoordinator;
}

function getMusicLibraryIndexCacheKey(libraryId = 'unscoped') {
    return `music:${getCacheKey()}:${libraryId || 'unscoped'}:library-index`;
}

function hasItemId(item: PtvMusicItem | null | undefined): item is PtvMusicItem & { Id: string } {
    return Boolean(item?.Id);
}

function getMusicHomeItemCount(data: PtvMusicHomeData) {
    return data.sections.reduce((total, section) => total + section.items.length, 0);
}

function isUsableMusicHomeCache(data: PtvMusicHomeData) {
    return Boolean(
        getMusicHomeItemCount(data)
        || data.stats.albumCount
        || data.stats.artistCount
        || data.stats.trackCount
    );
}

function hasFailedMusicSections(timings: PtvMusicSectionTiming[] = []) {
    return timings.some(timing => timing.status === 'error');
}

function isConfirmedEmptyMusicHomeCache(data: PtvMusicHomeData) {
    const timings = data.sectionTimings || [];

    return !isUsableMusicHomeCache(data)
        && timings.length > 0
        && !hasFailedMusicSections(timings);
}

function canUseMusicHomeCache(data: PtvMusicHomeData) {
    return isUsableMusicHomeCache(data) || isConfirmedEmptyMusicHomeCache(data);
}

function getMusicHomeCacheIgnoredReason(data: PtvMusicHomeData) {
    if (hasFailedMusicSections(data.sectionTimings)) return 'failed-empty-cache';

    return 'empty-unverified-cache';
}

function shouldWriteMusicHomeCache(data: PtvMusicHomeData) {
    return canUseMusicHomeCache(data);
}

function getMusicSectionFailureMessage(prefix: string, timings: PtvMusicSectionTiming[]) {
    const failures = timings
        .filter(timing => timing.status === 'error')
        .map(timing => `${timing.id}: ${timing.error || 'failed'}`)
        .join('; ');

    return `${prefix}: ${failures}`;
}

export function uniquePtvMusicItems(items: Array<PtvMusicItem | null | undefined>): PtvMusicItem[] {
    const seen = new Set<string>();
    const uniqueItems: PtvMusicItem[] = [];

    items.forEach(item => {
        if (!hasItemId(item) || seen.has(item.Id)) return;

        seen.add(item.Id);
        uniqueItems.push(item);
    });

    return uniqueItems;
}

function byName(left: PtvMusicItem, right: PtvMusicItem) {
    return getPtvMusicTitle(left).localeCompare(getPtvMusicTitle(right));
}

function getPlaylistIdentity(item: PtvMusicItem) {
    const title = getPtvMusicTitle(item).trim().toLowerCase();

    return title || item.Id || '';
}

function uniquePtvMusicPlaylists(items: PtvMusicItem[]) {
    const seen = new Set<string>();
    const playlists: PtvMusicItem[] = [];

    items.forEach(item => {
        const key = getPlaylistIdentity(item);

        if (!key || seen.has(key)) return;

        seen.add(key);
        playlists.push(item);
    });

    return playlists;
}

function getItems<TItem = PtvMusicItem>(query: PtvItemQuery) {
    return getPtvItems<TItem>({
        EnableImageTypes: 'Primary,Backdrop,Thumb',
        EnableTotalRecordCount: true,
        Fields: MUSIC_FIELDS,
        Recursive: true,
        ...query
    });
}

async function getScopedMusicQuery(query: PtvItemQuery): Promise<PtvItemQuery> {
    const libraryScope = query.ParentId ? {} : await getPtvMusicLibraryScopeQuery();

    return {
        ...libraryScope,
        ...query
    };
}

function getMusicItemsQueryUrl(query: PtvItemQuery) {
    const userId = getPtvCurrentUserId();

    if (!userId) return '';

    try {
        return getPtvApiUrl(`Users/${userId}/Items`, cleanPtvQuery({
            EnableImageTypes: 'Primary,Backdrop,Thumb',
            EnableTotalRecordCount: true,
            Fields: MUSIC_FIELDS,
            Recursive: true,
            ...query
        }));
    } catch {
        return '';
    }
}

function getMusicLatestItemsQueryUrl(query: PtvItemQuery) {
    const userId = getPtvCurrentUserId();

    if (!userId) return '';

    try {
        return getPtvApiUrl(`Users/${userId}/Items/Latest`, cleanPtvQuery(query));
    } catch {
        return '';
    }
}

function getQueryParentId(query: PtvItemQuery) {
    return typeof query.ParentId === 'string' && query.ParentId ? query.ParentId : null;
}

type PtvMusicQueryContextError = Error & {
    ptvMusicParentId?: string | null;
    ptvMusicQueryUrl?: string;
};

function getMusicQueryContextError(error: unknown, queryUrl: string, parentId: string | null) {
    const normalizedError: PtvMusicQueryContextError = error instanceof Error ?
        error as PtvMusicQueryContextError :
        new Error(String(error)) as PtvMusicQueryContextError;

    normalizedError.ptvMusicQueryUrl = queryUrl;
    normalizedError.ptvMusicParentId = parentId;

    return normalizedError;
}

function getMusicErrorQueryUrl(error: unknown) {
    if (!(error instanceof Error)) return '';

    const contextError = error as PtvMusicQueryContextError;

    return typeof contextError.ptvMusicQueryUrl === 'string' ? contextError.ptvMusicQueryUrl : '';
}

function getMusicErrorParentId(error: unknown) {
    if (!(error instanceof Error)) return null;

    const contextError = error as PtvMusicQueryContextError;

    return typeof contextError.ptvMusicParentId === 'string' ? contextError.ptvMusicParentId : null;
}

function getMusicStringValue(item: PtvMusicItem | null | undefined, ...keys: string[]) {
    if (!item) return '';

    for (const key of keys) {
        const value = item[key];

        if (typeof value === 'string' && value) return value;
    }

    return '';
}

function cleanMusicDisplayValue(value: unknown) {
    return String(value || '').trim();
}

function isShortNumericPlaceholder(value: string) {
    const trimmed = value.trim();

    return trimmed.length > 0
        && trimmed.length <= 3
        && Array.from(trimmed).every(char => char >= '0' && char <= '9');
}

function isKnownMusicDisplayValue(value: unknown) {
    const normalized = cleanMusicDisplayValue(value);

    return Boolean(normalized)
        && !UNKNOWN_DISPLAY_VALUES.has(normalized.toLowerCase())
        && !isShortNumericPlaceholder(normalized);
}

function firstKnownMusicDisplayValue(values: unknown[]) {
    return values.map(cleanMusicDisplayValue).find(isKnownMusicDisplayValue) || '';
}

function getFirstStringArrayValue(value: unknown) {
    return Array.isArray(value) ? value.find(isKnownMusicDisplayValue) : '';
}

function getMusicParentImageUrl(item: PtvMusicItem, size: number) {
    const parentImageItemId = getMusicStringValue(
        item,
        'ParentPrimaryImageItemId',
        'AlbumPrimaryImageItemId',
        'AlbumId'
    );
    const parentImageTag = getMusicStringValue(
        item,
        'ParentPrimaryImageTag',
        'AlbumPrimaryImageTag'
    );

    if (!parentImageItemId || !parentImageTag) return '';

    return getPtvItemImageUrl(parentImageItemId, {
        fillHeight: size,
        fillWidth: size,
        imageType: 'Primary',
        quality: 84,
        tag: parentImageTag
    });
}

function getMusicImageTag(item: PtvMusicItem, preferredImageType: PtvMusicImageType) {
    if (preferredImageType === 'Backdrop') {
        return item.BackdropImageTags?.[0]
            || item.ParentBackdropImageTags?.[0]
            || item.ImageTags?.Primary
            || item.ParentPrimaryImageTag
            || item.AlbumPrimaryImageTag
            || '';
    }

    return item.ImageTags?.Primary
        || item.ParentPrimaryImageTag
        || item.AlbumPrimaryImageTag
        || '';
}

function getCanonicalMusicImageSize(size: number, preferredImageType: PtvMusicImageType) {
    if (preferredImageType === 'Backdrop') {
        if (size <= 900) return 900;
        if (size <= 1200) return 1200;

        return 1600;
    }

    if (size <= 128) return 112;
    if (size <= 420) return 320;
    if (size <= 640) return 520;

    return 640;
}

export function getMusicImagePlaceholder() {
    return MUSIC_PLACEHOLDER_IMAGE;
}

function getMusicImageSemanticUsage(canonicalSize: number, preferredImageType: PtvMusicImageType) {
    if (preferredImageType === 'Backdrop') return 'background';
    if (canonicalSize <= 112) return 'avatar-small';
    if (canonicalSize <= 320) return 'card';

    return 'detail';
}

export function getMusicImageUrl(
    item: PtvMusicItem | null | undefined,
    size = 360,
    preferredImageType: PtvMusicImageType = 'Primary'
) {
    if (!item) return MUSIC_PLACEHOLDER_IMAGE;

    const canonicalSize = getCanonicalMusicImageSize(size, preferredImageType);
    const semanticUsage = getMusicImageSemanticUsage(canonicalSize, preferredImageType);
    const cacheKey = [
        item.Id || item.Name || 'unknown',
        getMusicImageTag(item, preferredImageType),
        preferredImageType,
        semanticUsage,
        canonicalSize
    ].join(':');
    const cachedUrl = musicImageUrlCache.get(cacheKey);

    if (cachedUrl) return cachedUrl;

    let order: Array<'Primary' | 'Thumb' | 'Backdrop' | 'SeriesPrimary' | 'ParentPrimary'> = ['Primary', 'ParentPrimary', 'Thumb', 'Backdrop', 'SeriesPrimary'];

    if (preferredImageType === 'Backdrop') {
        order = ['Backdrop', 'Primary', 'ParentPrimary', 'Thumb', 'SeriesPrimary'];
    } else if (preferredImageType === 'Thumb') {
        order = ['Thumb', 'Primary', 'ParentPrimary', 'Backdrop', 'SeriesPrimary'];
    }

    const candidates = getPtvItemImageCandidates(item, {
        baseOptions: {
            fillHeight: preferredImageType === 'Backdrop' ? Math.round(canonicalSize * 0.56) : canonicalSize,
            fillWidth: canonicalSize,
            quality: 84
        },
        order
    });
    const taggedCandidate = candidates.find(candidate => candidate.tag);

    if (taggedCandidate?.url) {
        musicImageUrlCache.set(cacheKey, taggedCandidate.url);
        return taggedCandidate.url;
    }

    const parentImageUrl = getMusicParentImageUrl(item, canonicalSize);
    const fallbackCandidate = candidates.find(candidate => candidate.url);
    const resolvedUrl = parentImageUrl || fallbackCandidate?.url || MUSIC_PLACEHOLDER_IMAGE;

    musicImageUrlCache.set(cacheKey, resolvedUrl);

    return resolvedUrl;
}

function isMusicLibrary(library: PtvLibrary) {
    const collectionType = String(library.CollectionType || '').toLowerCase();
    const itemType = String(library.Type || '').toLowerCase();
    const mediaType = String(library.MediaType || '').toLowerCase();
    const name = String(library.Name || '').trim().toLowerCase();

    return collectionType === 'music'
        || (itemType === 'collectionfolder' && collectionType.includes('music'))
        || mediaType === 'audio'
        || /\b(music|songs|albums|audio)\b/.test(name);
}

function getMusicLibraryDiscoveryItem(library: PtvLibrary): PtvMusicLibraryDiscoveryItem {
    return {
        collectionType: library.CollectionType || null,
        id: library.Id || null,
        mediaType: library.MediaType || null,
        name: library.Name || null,
        type: library.Type || null
    };
}

function getMusicLibraryDetectionReason(library: PtvLibrary | null, libraries: PtvLibrary[]) {
    if (!library) return libraries.length ? 'no-music-view-detected-using-unscoped-audio' : 'no-user-views-returned';

    return [
        `collectionType=${library.CollectionType || 'none'}`,
        `type=${library.Type || 'none'}`,
        `mediaType=${library.MediaType || 'none'}`,
        `name=${library.Name || 'none'}`
    ].join('; ');
}

function getMusicHomeCountDiagnostic(data: PtvMusicHomeData) {
    return {
        albumCount: data.stats.albumCount,
        artistCount: data.stats.artistCount,
        completeness: data.completeness || null,
        isPartial: Boolean(data.isPartial),
        libraryId: data.library?.id || null,
        libraryName: data.library?.name || null,
        nextEligibleRefreshAt: data.nextEligibleRefreshAt || null,
        refreshReason: data.refreshReason || null,
        sectionCount: data.sections.length,
        songCount: data.stats.trackCount
    };
}

function recordPtvMusicApiDiagnostic(name: string, detail: Record<string, unknown>) {
    recordPtvEvent('api', name, detail);
    console.info(`[PTV Music] ${name}`, detail);
}

export async function getPtvMusicLibrary(): Promise<PtvMusicLibraryScope | null> {
    const cacheKey = getCacheKey();
    const discoveryContext = {
        serverId: getPtvServerId() || null,
        userId: getPtvCurrentUserId() || null
    };

    recordPtvMusicApiDiagnostic('music-library-discovery-started', discoveryContext);

    if (musicLibraryCache.has(cacheKey)) {
        const cachedScope = musicLibraryCache.get(cacheKey) || null;

        recordPtvMusicApiDiagnostic('music-library-discovery-complete', {
            ...discoveryContext,
            cached: true,
            libraryId: cachedScope?.id || null,
            libraryName: cachedScope?.name || null,
            selectedParentId: cachedScope?.selectedParentId || null
        });

        return cachedScope;
    }

    const result = await getPtvUserViews();
    const libraries = result.Items || [];
    const musicLibraries = libraries.filter(isMusicLibrary);
    const musicLibrariesFound = musicLibraries.map(getMusicLibraryDiscoveryItem);
    const library = musicLibraries[0] || null;
    const detectionReason = getMusicLibraryDetectionReason(library, libraries);
    const scope = library?.Id ? {
        detectionReason,
        id: library.Id,
        musicLibrariesFound,
        musicLibraryCount: musicLibraries.length,
        name: library.Name || 'Music',
        selectedParentId: library.Id
    } : null;

    lastMusicLibraryDiscovery = {
        detectionReason,
        musicLibrariesFound,
        musicLibraryCount: musicLibraries.length,
        selectedMusicLibraryId: scope?.id || null,
        selectedMusicLibraryName: scope?.name || null,
        selectedParentId: scope?.selectedParentId || null
    };

    if (scope) {
        musicLibraryCache.set(cacheKey, scope);
    }

    recordPtvEvent('api', 'music-library-resolved', {
        detectedMusicLibraryCount: musicLibraries.length,
        detectionReason,
        libraryId: scope?.id || null,
        libraryName: scope?.name || null,
        musicLibrariesFound,
        selectedParentId: scope?.selectedParentId || null,
        serverId: getPtvServerId() || null,
        totalViewCount: libraries.length,
        userId: getPtvCurrentUserId() || null,
        views: libraries.slice(0, 12).map(getMusicLibraryDiscoveryItem)
    });

    recordPtvMusicApiDiagnostic('music-library-discovery-complete', {
        ...discoveryContext,
        cached: false,
        detectedMusicLibraryCount: musicLibraries.length,
        detectionReason,
        libraryId: scope?.id || null,
        libraryName: scope?.name || null,
        selectedParentId: scope?.selectedParentId || null,
        totalViewCount: libraries.length
    });

    return scope;
}

async function getPtvMusicLibraryScopeQuery(): Promise<Partial<PtvItemQuery>> {
    const library = await getPtvMusicLibrary();

    return library?.id ? { ParentId: library.id } : {};
}

async function getScopedItems<TItem = PtvMusicItem>(query: PtvItemQuery) {
    return getItems<TItem>(await getScopedMusicQuery(query));
}

async function getScopedItemsWithUnscopedFallback<TItem = PtvMusicItem>(
    query: PtvItemQuery,
    stage: string
) {
    const scopedQuery = await getScopedMusicQuery(query);
    const scopedQueryUrl = getMusicItemsQueryUrl(scopedQuery);
    const scopedParentId = getQueryParentId(scopedQuery);
    let scopedResult: PtvItemsResult<TItem>;

    recordPtvEvent('api', 'music-query-start', {
        parentId: scopedParentId,
        queryUrl: scopedQueryUrl,
        stage
    });

    try {
        scopedResult = await getItems<TItem>(scopedQuery);
    } catch (error) {
        recordPtvEvent('api', 'music-query-failed', {
            error: getErrorMessage(error),
            parentId: scopedParentId,
            queryUrl: scopedQueryUrl,
            stage
        });
        throw getMusicQueryContextError(error, scopedQueryUrl, scopedParentId);
    }

    const scopedCount = scopedResult.Items?.length || 0;

    recordPtvEvent('api', 'music-query-complete', {
        parentId: scopedParentId,
        queryUrl: scopedQueryUrl,
        responseCount: scopedCount,
        stage,
        totalRecordCount: scopedResult.TotalRecordCount ?? null
    });

    if (scopedCount || !scopedQuery.ParentId || query.ParentId) {
        return scopedResult;
    }

    const unscopedQueryUrl = getMusicItemsQueryUrl(query);
    recordPtvEvent('api', 'music-query-unscoped-fallback-start', {
        parentId: scopedQuery.ParentId,
        queryUrl: unscopedQueryUrl,
        stage
    });

    let unscopedResult: PtvItemsResult<TItem>;

    try {
        unscopedResult = await getItems<TItem>(query);
    } catch (error) {
        recordPtvEvent('api', 'music-query-failed', {
            error: getErrorMessage(error),
            parentId: null,
            queryUrl: unscopedQueryUrl,
            stage: `${stage}-unscoped-fallback`
        });
        throw getMusicQueryContextError(error, unscopedQueryUrl, null);
    }

    recordPtvEvent('api', 'music-query-unscoped-fallback-complete', {
        parentId: scopedQuery.ParentId,
        queryUrl: unscopedQueryUrl,
        scopedCount,
        stage,
        responseCount: unscopedResult.Items?.length || 0,
        unscopedCount: unscopedResult.Items?.length || 0,
        unscopedTotalRecordCount: unscopedResult.TotalRecordCount ?? null
    });

    return unscopedResult;
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function getPagedQueryStatus(
    result: PtvMusicPagedFetchResult,
    durationMs: number
): PtvMusicQueryStatus {
    return {
        count: result.items.length,
        durationMs,
        error: result.error,
        failureReason: result.error || null,
        parentId: result.parentId ?? null,
        responseCount: result.items.length,
        status: getPagedQueryStatusLabel(result),
        totalRecordCount: result.totalRecordCount,
        url: result.lastQueryUrl
    };
}

function getPagedQueryStatusLabel(result: PtvMusicPagedFetchResult): PtvMusicQueryStatus['status'] {
    if (result.status === 'error') return 'failed';
    if (result.items.length) return 'ok';

    return 'empty';
}

function recordMusicApiSectionFailure(stage: string, error: unknown) {
    recordPtvEvent('api', 'music-api-section-failed', {
        error: getErrorMessage(error),
        stage
    });
}

function timeMusicSection(
    stage: string,
    promise: Promise<PtvMusicItem[]>,
    timings: PtvMusicSectionTiming[]
): Promise<PtvMusicItem[]> {
    const startedAt = Date.now();

    return promise
        .then(items => {
            const uniqueItems = uniquePtvMusicItems(items);

            timings.push({
                durationMs: Date.now() - startedAt,
                id: stage,
                itemCount: uniqueItems.length,
                status: 'ok'
            });

            return uniqueItems;
        })
        .catch(error => {
            const message = getErrorMessage(error);

            recordMusicApiSectionFailure(stage, error);
            timings.push({
                durationMs: Date.now() - startedAt,
                error: message,
                id: stage,
                itemCount: 0,
                status: 'error'
            });

            return [];
        });
}

export function getPtvMusicTitle(item?: PtvMusicItem | null): string {
    const itemType = String(item?.Type || '').toLowerCase();
    const title = itemType === 'musicartist' ?
        firstKnownMusicDisplayValue([
            item?.Name,
            item?.AlbumArtist,
            getFirstStringArrayValue(item?.Artists),
            item?.Artist,
            ...(item?.AlbumArtists || []).map(entry => entry.Name),
            getFirstStringArrayValue(item?.MusicBrainzArtistNames),
            item?.MusicBrainzArtistName,
            ...(item?.ArtistItems || []).map(entry => entry.Name)
        ]) :
        firstKnownMusicDisplayValue([
            item?.Name,
            item?.MusicBrainzTitle,
            item?.SortName,
            item?.Album
        ]);

    if (title) return title;
    if (itemType === 'musicartist') return UNKNOWN_ARTIST_LABEL;

    return UNKNOWN_TRACK_LABEL;
}

export function getPtvMusicArtist(item?: PtvMusicItem | null): string {
    const artist = firstKnownMusicDisplayValue([
        item?.AlbumArtist,
        getFirstStringArrayValue(item?.Artists),
        item?.Artist,
        ...(item?.AlbumArtists || []).map(entry => entry.Name),
        getFirstStringArrayValue(item?.MusicBrainzArtistNames),
        item?.MusicBrainzArtistName,
        ...(item?.ArtistItems || []).map(entry => entry.Name)
    ]);

    return artist || UNKNOWN_ARTIST_LABEL;
}

export function getPtvMusicAlbum(item?: PtvMusicItem | null): string {
    const isAlbum = String(item?.Type || '').toLowerCase() === 'musicalbum';

    return firstKnownMusicDisplayValue([
        item?.Album,
        isAlbum ? item?.Name : '',
        isAlbum ? item?.SortName : ''
    ]);
}

export function searchPtvMusicMetadata(item: PtvMusicItem, limit = 6): Promise<PtvMusicMetadataLookupResponse> {
    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi?.searchMusicMetadata) {
        return Promise.reject(new Error('PiggieTV music metadata lookup endpoint is unavailable.'));
    }

    return pluginApi.searchMusicMetadata<PtvMusicMetadataLookupResponse>({
        album: getPtvMusicAlbum(item),
        artist: getPtvMusicArtist(item),
        itemId: item.Id,
        limit,
        title: getPtvMusicTitle(item),
        year: item.ProductionYear
    });
}

export function getPtvMusicGenres(item?: PtvMusicItem | null): string[] {
    return Array.isArray(item?.Genres) ?
        item.Genres.filter((genre): genre is string => typeof genre === 'string' && genre.length > 0) :
        [];
}

export function getPtvMusicCodec(item?: PtvMusicItem | null): PtvMusicCodec {
    const mediaSources = item?.MediaSources || [];
    const mediaStreams = mediaSources.reduce<PtvMusicMediaStream[]>(
        (streams, source) => streams.concat(source.MediaStreams || []),
        []
    );
    const firstAudioStream = mediaStreams.find(stream => String(stream.Type || '').toLowerCase() === 'audio');
    const codec = firstAudioStream?.Codec || item?.Container || mediaSources[0]?.Container || '';

    return String(codec || '').toLowerCase();
}

export function isPtvMusicQualityMatch(item: PtvMusicItem, codecs: string[]) {
    if (!codecs.length) return true;

    const codec = getPtvMusicCodec(item);
    const container = String(item.Container || item.MediaSources?.[0]?.Container || '').toLowerCase();

    return codecs.some(value => codec.includes(value) || container.includes(value));
}

export function getPtvMusicBitrate(item?: PtvMusicItem | null): number {
    const mediaSource = item?.MediaSources?.[0];
    const audioStream = mediaSource?.MediaStreams?.find(stream => String(stream.Type || '').toLowerCase() === 'audio');

    return Number(audioStream?.BitRate || mediaSource?.Bitrate || item?.Bitrate || 0);
}

export function fetchPtvMusicTracks(
    query: PtvItemQuery = {},
    limit = DEFAULT_TRACK_LIMIT
): Promise<PtvMusicItem[]> {
    return getScopedItemsWithUnscopedFallback<PtvMusicItem>({
        IncludeItemTypes: 'Audio',
        Limit: limit,
        ...query
    }, 'tracks').then(result => uniquePtvMusicItems(result.Items || []));
}

export function fetchPtvMusicAlbums(limit = DEFAULT_ALBUM_SAMPLE_LIMIT): Promise<PtvMusicItem[]> {
    return getScopedItemsWithUnscopedFallback<PtvMusicItem>({
        IncludeItemTypes: 'MusicAlbum',
        Limit: limit,
        SortBy: 'DatePlayed,SortName',
        SortOrder: 'Descending'
    }, 'albums').then(result => uniquePtvMusicItems(result.Items || []).sort(byName));
}

export function fetchPtvMusicArtists(limit = DEFAULT_ARTIST_SAMPLE_LIMIT): Promise<PtvMusicItem[]> {
    return fetchPtvMusicArtistsResult({
        IncludeItemTypes: 'MusicArtist',
        Limit: limit,
        SortBy: 'SortName',
        SortOrder: 'Ascending'
    }).then(result => uniquePtvMusicItems(result.Items || []).sort(byName));
}

async function fetchPtvMusicArtistsEndpoint(query: PtvItemQuery): Promise<PtvItemsResult<PtvMusicItem>> {
    const userId = getPtvCurrentUserId();
    const scopedQuery = await getScopedMusicQuery(query);
    const params = cleanPtvQuery({
        EnableImageTypes: 'Primary,Backdrop,Thumb',
        EnableTotalRecordCount: true,
        Fields: MUSIC_FIELDS,
        Recursive: true,
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        UserId: userId,
        ...scopedQuery
    });

    if (!userId) return { Items: [], TotalRecordCount: 0 };

    return requestPtvJson<PtvItemsResult<PtvMusicItem>>('Artists', {
        params
    }).catch(() => requestPtvJson<PtvItemsResult<PtvMusicItem>>('Artists/AlbumArtists', {
        params
    }));
}

async function fetchPtvMusicArtistsResult(query: PtvItemQuery): Promise<PtvItemsResult<PtvMusicItem>> {
    const itemResult = await getScopedItemsWithUnscopedFallback<PtvMusicItem>(query, 'artists');

    if (itemResult.Items?.length || Number(itemResult.TotalRecordCount || 0) > 0) {
        return itemResult;
    }

    const endpointResult = await fetchPtvMusicArtistsEndpoint(query).catch(error => {
        recordMusicApiSectionFailure('artists-endpoint-fallback', error);

        return null;
    });

    return endpointResult || itemResult;
}

async function fetchPtvRecentlyAddedMusic(
    libraryScope: Partial<PtvItemQuery>,
    limit: number,
    stage: string
) {
    const scopedQuery: PtvItemQuery = {
        Fields: MUSIC_FIELDS,
        IncludeItemTypes: 'Audio',
        Limit: limit,
        ...libraryScope
    };
    const scopedParentId = getQueryParentId(scopedQuery);
    const scopedQueryUrl = getMusicLatestItemsQueryUrl(scopedQuery);

    recordPtvEvent('api', 'music-query-start', {
        parentId: scopedParentId,
        queryUrl: scopedQueryUrl,
        stage
    });

    try {
        const scopedItems = uniquePtvMusicItems(await getPtvRecentlyAdded<PtvMusicItem>(scopedQuery));

        recordPtvEvent('api', 'music-query-complete', {
            parentId: scopedParentId,
            queryUrl: scopedQueryUrl,
            responseCount: scopedItems.length,
            stage,
            totalRecordCount: scopedItems.length
        });

        if (scopedItems.length || !scopedParentId) {
            return scopedItems;
        }
    } catch (error) {
        recordPtvEvent('api', 'music-query-failed', {
            error: getErrorMessage(error),
            parentId: scopedParentId,
            queryUrl: scopedQueryUrl,
            stage
        });

        if (!scopedParentId) {
            throw getMusicQueryContextError(error, scopedQueryUrl, scopedParentId);
        }
    }

    const unscopedQuery = {
        ...scopedQuery
    };

    delete unscopedQuery.ParentId;

    const unscopedQueryUrl = getMusicLatestItemsQueryUrl(unscopedQuery);

    recordPtvEvent('api', 'music-query-unscoped-fallback-start', {
        parentId: scopedParentId,
        queryUrl: unscopedQueryUrl,
        stage
    });

    try {
        const unscopedItems = uniquePtvMusicItems(await getPtvRecentlyAdded<PtvMusicItem>(unscopedQuery));

        recordPtvEvent('api', 'music-query-unscoped-fallback-complete', {
            parentId: scopedParentId,
            queryUrl: unscopedQueryUrl,
            responseCount: unscopedItems.length,
            stage,
            unscopedCount: unscopedItems.length,
            unscopedTotalRecordCount: unscopedItems.length
        });

        return unscopedItems;
    } catch (error) {
        recordPtvEvent('api', 'music-query-failed', {
            error: getErrorMessage(error),
            parentId: null,
            queryUrl: unscopedQueryUrl,
            stage: `${stage}-unscoped-fallback`
        });
        throw getMusicQueryContextError(error, unscopedQueryUrl, null);
    }
}

async function fetchPagedScopedMusicItems(
    name: PtvMusicLibraryPageName,
    query: PtvItemQuery,
    options: {
        maxItems?: number;
        pageSize?: number;
        scoped?: boolean;
    } = {}
): Promise<PtvMusicPagedFetchResult> {
    const startedAt = getMusicPerformanceNow();
    const pageSize = Math.max(1, Math.min(options.pageSize || MUSIC_LIBRARY_PAGE_SIZE, MUSIC_LIBRARY_PAGE_SIZE));
    const maxItems = Math.max(pageSize, options.maxItems || MUSIC_LIBRARY_FETCH_CAP);
    const baseQuery = options.scoped === false ? query : await getScopedMusicQuery(query);
    const fetchPages = async (activeQuery: PtvItemQuery) => {
        const items: PtvMusicItem[] = [];
        let lastQueryUrl = '';
        let pageCount = 0;
        const parentId = getQueryParentId(activeQuery);
        let totalRecordCount = 0;

        while (items.length < maxItems) {
            const limit = getPtvMusicPageLimit(items.length, pageSize, maxItems);

            if (limit <= 0) break;

            const pageQuery: PtvItemQuery = {
                ...activeQuery,
                Limit: limit,
                StartIndex: items.length
            };
            lastQueryUrl = getMusicItemsQueryUrl(pageQuery);

            let result: PtvItemsResult<PtvMusicItem>;

            try {
                result = await getItems<PtvMusicItem>(pageQuery);
            } catch (error) {
                recordPtvEvent('api', 'music-query-failed', {
                    error: getErrorMessage(error),
                    parentId,
                    queryUrl: lastQueryUrl,
                    section: name,
                    stage: `library-index-${name}`
                });
                throw getMusicQueryContextError(error, lastQueryUrl, parentId);
            }
            const pageItems = result.Items || [];

            pageCount += 1;
            totalRecordCount = typeof result.TotalRecordCount === 'number' ?
                result.TotalRecordCount :
                Math.max(totalRecordCount, items.length + pageItems.length);
            items.push(...pageItems);

            if (!pageItems.length || items.length >= totalRecordCount) break;
        }

        return {
            items,
            lastQueryUrl,
            pageCount,
            parentId,
            totalRecordCount
        };
    };
    let pageResult = await fetchPages(baseQuery);
    const shouldTryUnscopedFallback = Boolean(
        options.scoped !== false
        && baseQuery.ParentId
        && !query.ParentId
        && !pageResult.items.length
    );

    if (shouldTryUnscopedFallback) {
        recordPtvEvent('api', 'music-library-page-unscoped-fallback-start', {
            parentId: baseQuery.ParentId,
            section: name
        });
        pageResult = await fetchPages(query);
        recordPtvEvent('api', 'music-library-page-unscoped-fallback-complete', {
            parentId: baseQuery.ParentId,
            section: name,
            unscopedParentId: pageResult.parentId,
            unscopedCount: pageResult.items.length,
            unscopedTotalRecordCount: pageResult.totalRecordCount
        });
    }

    const uniqueItems = name === 'playlists' ?
        uniquePtvMusicPlaylists(uniquePtvMusicItems(pageResult.items)) :
        uniquePtvMusicItems(pageResult.items);
    const duplicateDropCount = Math.max(0, pageResult.items.length - uniqueItems.length);
    const capDropCount = Math.max(0, pageResult.totalRecordCount - Math.min(pageResult.totalRecordCount, maxItems));
    const shortPageDropCount = pageResult.totalRecordCount > uniqueItems.length && !capDropCount ?
        pageResult.totalRecordCount - uniqueItems.length :
        0;
    const dropReasons: string[] = [];

    if (duplicateDropCount) dropReasons.push(`${name}: ${duplicateDropCount} duplicate item(s) removed`);
    if (capDropCount) dropReasons.push(`${name}: capped at ${maxItems} item(s) for browser safety`);
    if (shortPageDropCount) dropReasons.push(`${name}: Jellyfin returned ${shortPageDropCount} fewer item(s) than TotalRecordCount`);

    recordPtvEvent('api', 'music-library-page-fetch-complete', {
        fetchedCount: uniqueItems.length,
        lastQueryUrl: pageResult.lastQueryUrl,
        pageCount: pageResult.pageCount,
        pageSize,
        parentId: pageResult.parentId,
        responseCount: uniqueItems.length,
        section: name,
        totalRecordCount: pageResult.totalRecordCount
    });

    return {
        durationMs: Number((getMusicPerformanceNow() - startedAt).toFixed(1)),
        dropReasons,
        droppedCount: duplicateDropCount + capDropCount + shortPageDropCount,
        items: uniqueItems,
        lastQueryUrl: pageResult.lastQueryUrl,
        pageCount: pageResult.pageCount,
        parentId: pageResult.parentId,
        status: uniqueItems.length ? 'ok' : 'empty',
        totalRecordCount: pageResult.totalRecordCount
    };
}

async function fetchPtvMusicLibraryPlaylists(): Promise<PtvMusicPagedFetchResult> {
    const result = await fetchPagedScopedMusicItems('playlists', {
        IncludeItemTypes: 'Playlist',
        SortBy: 'SortName',
        SortOrder: 'Ascending'
    }, {
        maxItems: MUSIC_LIBRARY_FETCH_CAP,
        scoped: false
    });
    const sortedItems = [...result.items];

    sortedItems.sort(byName);

    return {
        ...result,
        items: sortedItems
    };
}

async function fetchPtvMusicLibraryArtists(): Promise<PtvMusicPagedFetchResult> {
    const startedAt = getMusicPerformanceNow();
    const baseQuery = await getScopedMusicQuery({
        IncludeItemTypes: 'MusicArtist',
        SortBy: 'SortName',
        SortOrder: 'Ascending'
    });
    const pageSize = MUSIC_LIBRARY_PAGE_SIZE;
    const maxItems = MUSIC_LIBRARY_FETCH_CAP;
    const fetchArtistPages = async (activeQuery: PtvItemQuery) => {
        const items: PtvMusicItem[] = [];
        let lastQueryUrl = '';
        let pageCount = 0;
        const parentId = getQueryParentId(activeQuery);
        let totalRecordCount = 0;

        while (items.length < maxItems) {
            const limit = getPtvMusicPageLimit(items.length, pageSize, maxItems);

            if (limit <= 0) break;

            const pageQuery: PtvItemQuery = {
                ...activeQuery,
                Limit: limit,
                StartIndex: items.length
            };
            lastQueryUrl = getMusicItemsQueryUrl(pageQuery);

            let result: PtvItemsResult<PtvMusicItem>;

            try {
                result = await fetchPtvMusicArtistsResult(pageQuery);
            } catch (error) {
                recordPtvEvent('api', 'music-query-failed', {
                    error: getErrorMessage(error),
                    parentId,
                    queryUrl: lastQueryUrl,
                    section: 'artists',
                    stage: 'library-index-artists'
                });
                throw getMusicQueryContextError(error, lastQueryUrl, parentId);
            }
            const pageItems = result.Items || [];

            pageCount += 1;
            totalRecordCount = typeof result.TotalRecordCount === 'number' ?
                result.TotalRecordCount :
                Math.max(totalRecordCount, items.length + pageItems.length);
            items.push(...pageItems);

            if (!pageItems.length || items.length >= totalRecordCount) break;
        }

        return {
            items,
            lastQueryUrl,
            pageCount,
            parentId,
            totalRecordCount
        };
    };
    let pageResult = await fetchArtistPages(baseQuery);

    if (baseQuery.ParentId && !pageResult.items.length) {
        const unscopedQuery = {
            ...baseQuery
        };

        delete unscopedQuery.ParentId;
        recordPtvEvent('api', 'music-library-page-unscoped-fallback-start', {
            parentId: baseQuery.ParentId,
            section: 'artists'
        });
        pageResult = await fetchArtistPages(unscopedQuery);
        recordPtvEvent('api', 'music-library-page-unscoped-fallback-complete', {
            parentId: baseQuery.ParentId,
            section: 'artists',
            unscopedParentId: pageResult.parentId,
            unscopedCount: pageResult.items.length,
            unscopedTotalRecordCount: pageResult.totalRecordCount
        });
    }

    const uniqueItems = uniquePtvMusicItems(pageResult.items).sort(byName);
    const duplicateDropCount = Math.max(0, pageResult.items.length - uniqueItems.length);
    const capDropCount = Math.max(0, pageResult.totalRecordCount - Math.min(pageResult.totalRecordCount, maxItems));
    const dropReasons: string[] = [];

    if (duplicateDropCount) dropReasons.push(`artists: ${duplicateDropCount} duplicate item(s) removed`);
    if (capDropCount) dropReasons.push(`artists: capped at ${maxItems} item(s) for browser safety`);

    recordPtvEvent('api', 'music-library-page-fetch-complete', {
        fetchedCount: uniqueItems.length,
        lastQueryUrl: pageResult.lastQueryUrl,
        pageCount: pageResult.pageCount,
        pageSize,
        parentId: pageResult.parentId,
        responseCount: uniqueItems.length,
        section: 'artists',
        totalRecordCount: pageResult.totalRecordCount
    });

    return {
        durationMs: Number((getMusicPerformanceNow() - startedAt).toFixed(1)),
        dropReasons,
        droppedCount: duplicateDropCount + capDropCount,
        items: uniqueItems,
        lastQueryUrl: pageResult.lastQueryUrl,
        pageCount: pageResult.pageCount,
        parentId: pageResult.parentId,
        status: uniqueItems.length ? 'ok' : 'empty',
        totalRecordCount: pageResult.totalRecordCount
    };
}

function getEmptyPagedMusicResult(
    name: PtvMusicLibraryPageName,
    error: unknown
): PtvMusicPagedFetchResult {
    return {
        durationMs: 0,
        dropReasons: [`${name}: fetch failed - ${getErrorMessage(error)}`],
        droppedCount: 0,
        error: getErrorMessage(error),
        items: [],
        lastQueryUrl: getMusicErrorQueryUrl(error),
        pageCount: 0,
        parentId: getMusicErrorParentId(error),
        status: 'error',
        totalRecordCount: 0
    };
}

function recoverPagedMusicItems(
    name: PtvMusicLibraryPageName,
    promise: Promise<PtvMusicPagedFetchResult>
): Promise<PtvMusicPagedFetchResult> {
    return promise.catch(error => {
        recordMusicApiSectionFailure(`library-index-${name}`, error);

        return getEmptyPagedMusicResult(name, error);
    });
}

function isUsableMusicLibraryIndexCache(index: PtvMusicLibraryIndex, library: PtvMusicLibraryScope | null) {
    const expectedLibraryId = library?.id || null;
    const cachedLibraryId = index.library?.id || null;
    const hasCoreMusic = Boolean(index.albums.length || index.artists.length || index.tracks.length);
    const failedCoreSection = (index.debug.failedSections || [])
        .some(section => section === 'albums' || section === 'artists' || section === 'tracks');

    return cachedLibraryId === expectedLibraryId && hasCoreMusic && !failedCoreSection;
}

function shouldWriteMusicLibraryIndexCache(index: PtvMusicLibraryIndex) {
    const failedCoreSection = (index.debug.failedSections || [])
        .some(section => section === 'albums' || section === 'artists' || section === 'tracks');

    return !failedCoreSection && Boolean(index.albums.length || index.artists.length || index.tracks.length);
}

async function readUsableMusicLibraryIndexCache(cacheKey: string, library: PtvMusicLibraryScope | null) {
    const cachedIndex = await readPtvLibraryIndexCache<PtvMusicLibraryIndex>(
        cacheKey,
        MUSIC_LIBRARY_INDEX_CACHE_SCHEMA_VERSION
    );

    if (cachedIndex && isUsableMusicLibraryIndexCache(cachedIndex, library)) {
        recordPtvEvent('cache', 'music-library-index-cache-hit-valid', {
            albumCount: cachedIndex.albums.length,
            artistCount: cachedIndex.artists.length,
            libraryId: library?.id || null,
            trackCount: cachedIndex.tracks.length
        });

        return cachedIndex;
    }

    if (cachedIndex) {
        recordPtvEvent('cache', 'music-library-index-cache-ignored', {
            cachedLibraryId: cachedIndex.library?.id || null,
            expectedLibraryId: library?.id || null,
            failedSections: cachedIndex.debug.failedSections || [],
            reason: 'empty-failed-or-library-mismatch'
        });
    }

    return null;
}

function getFinalMusicLibraryStateReason(failedSections: string[], ...results: PtvMusicPagedFetchResult[]) {
    if (failedSections.length) return 'partial-failed-sections';
    if (results.some(result => result.items.length)) return 'loaded';

    return 'empty-confirmed';
}

function getFailedMusicSections(results: Partial<Record<PtvMusicLibraryPageName, PtvMusicPagedFetchResult>>) {
    return (Object.entries(results) as Array<[PtvMusicLibraryPageName, PtvMusicPagedFetchResult]>)
        .filter(([, result]) => result.status === 'error')
        .map(([section]) => section);
}

async function fetchMusicLibraryIndexPages(): Promise<PtvMusicLibraryIndexResults> {
    const queryStartedAt: Record<PtvMusicLibraryPageName, number> = {
        albums: 0,
        artists: 0,
        playlists: 0,
        tracks: 0
    };
    const [artistsResult, albumsResult, tracksResult, playlistsResult] = await runPtvScheduledRequests(
        [
            () => {
                queryStartedAt.artists = Date.now();
                return recoverPagedMusicItems('artists', fetchPtvMusicLibraryArtists());
            },
            () => {
                queryStartedAt.albums = Date.now();
                return recoverPagedMusicItems('albums', fetchPagedScopedMusicItems('albums', {
                    IncludeItemTypes: 'MusicAlbum',
                    SortBy: 'SortName',
                    SortOrder: 'Ascending'
                }));
            },
            () => {
                queryStartedAt.tracks = Date.now();
                return recoverPagedMusicItems('tracks', fetchPagedScopedMusicItems('tracks', {
                    IncludeItemTypes: 'Audio',
                    SortBy: 'SortName',
                    SortOrder: 'Ascending'
                }));
            },
            () => {
                queryStartedAt.playlists = Date.now();
                return recoverPagedMusicItems('playlists', fetchPtvMusicLibraryPlaylists());
            }
        ],
        task => task(),
        { concurrency: 2 }
    );

    return {
        albumsResult,
        artistsResult,
        playlistsResult,
        queryStartedAt,
        tracksResult
    };
}

function buildMusicLibraryDebug(
    library: PtvMusicLibraryScope | null,
    results: PtvMusicLibraryIndexResults
): PtvMusicLibraryDebug {
    const {
        albumsResult,
        artistsResult,
        playlistsResult,
        queryStartedAt,
        tracksResult
    } = results;
    const failedSections = getFailedMusicSections({
        albums: albumsResult,
        artists: artistsResult,
        playlists: playlistsResult,
        tracks: tracksResult
    });
    const dropReasons = [
        ...artistsResult.dropReasons,
        ...albumsResult.dropReasons,
        ...tracksResult.dropReasons,
        ...playlistsResult.dropReasons
    ];

    return {
        dropReasons,
        droppedAlbumCount: albumsResult.droppedCount,
        droppedArtistCount: artistsResult.droppedCount,
        droppedTrackCount: tracksResult.droppedCount,
        failedSections,
        fetchedAlbumCount: albumsResult.items.length,
        fetchedArtistCount: artistsResult.items.length,
        fetchedTrackCount: tracksResult.items.length,
        finalStateReason: getFinalMusicLibraryStateReason(failedSections, albumsResult, artistsResult, tracksResult),
        jellyfinAlbumTotal: albumsResult.totalRecordCount,
        jellyfinArtistTotal: artistsResult.totalRecordCount,
        jellyfinTrackTotal: tracksResult.totalRecordCount,
        lastMusicQueryUrl: tracksResult.lastQueryUrl || albumsResult.lastQueryUrl || artistsResult.lastQueryUrl || playlistsResult.lastQueryUrl,
        libraryDetectionReason: library?.detectionReason || lastMusicLibraryDiscovery.detectionReason || (library ? 'music-library-selected' : 'unscoped-audio-fallback'),
        musicLibrariesFound: library?.musicLibrariesFound || lastMusicLibraryDiscovery.musicLibrariesFound,
        musicLibraryCount: library?.musicLibraryCount ?? lastMusicLibraryDiscovery.musicLibraryCount,
        musicLibraryName: library?.name || lastMusicLibraryDiscovery.selectedMusicLibraryName || null,
        pageCount: {
            albums: albumsResult.pageCount,
            artists: artistsResult.pageCount,
            playlists: playlistsResult.pageCount,
            tracks: tracksResult.pageCount
        },
        pageSize: MUSIC_LIBRARY_PAGE_SIZE,
        playlistCount: playlistsResult.items.length,
        queryStatus: {
            albums: getPagedQueryStatus(albumsResult, albumsResult.durationMs || (queryStartedAt.albums ? Date.now() - queryStartedAt.albums : 0)),
            artists: getPagedQueryStatus(artistsResult, artistsResult.durationMs || (queryStartedAt.artists ? Date.now() - queryStartedAt.artists : 0)),
            playlists: getPagedQueryStatus(playlistsResult, playlistsResult.durationMs || (queryStartedAt.playlists ? Date.now() - queryStartedAt.playlists : 0)),
            tracks: getPagedQueryStatus(tracksResult, tracksResult.durationMs || (queryStartedAt.tracks ? Date.now() - queryStartedAt.tracks : 0))
        },
        selectedMusicLibraryId: library?.id || lastMusicLibraryDiscovery.selectedMusicLibraryId || null,
        selectedParentId: library?.selectedParentId || lastMusicLibraryDiscovery.selectedParentId || null,
        serverId: getPtvServerId() || null,
        totalRecordCountFromApi: {
            albums: albumsResult.totalRecordCount,
            artists: artistsResult.totalRecordCount,
            playlists: playlistsResult.totalRecordCount,
            tracks: tracksResult.totalRecordCount
        },
        userId: getPtvCurrentUserId() || null
    };
}

export async function fetchPtvMusicLibraryIndex(options: {
    forceRefresh?: boolean;
} = {}): Promise<PtvMusicLibraryIndex> {
    const library = await getPtvMusicLibrary().catch(error => {
        recordMusicApiSectionFailure('library-index-scope', error);

        return null;
    });
    const cacheKey = getMusicLibraryIndexCacheKey(library?.id || 'unscoped');

    if (!options.forceRefresh) {
        const cachedIndex = await readUsableMusicLibraryIndexCache(cacheKey, library);

        if (cachedIndex) {
            recordPtvMusicApiDiagnostic('music-library-counts-loaded', {
                albumCount: cachedIndex.albums.length,
                artistCount: cachedIndex.artists.length,
                cached: true,
                libraryId: cachedIndex.library?.id || library?.id || null,
                libraryName: cachedIndex.library?.name || library?.name || null,
                playlistCount: cachedIndex.playlists.length,
                songCount: cachedIndex.tracks.length
            });

            return cachedIndex;
        }
    }

    const requestKey = `music-library-index:${getMusicDataScopeKey(library?.id || 'unscoped')}:${options.forceRefresh ? 'refresh' : 'normal'}`;

    return runMusicCoordinatorRequest(requestKey, 'music-library-index', async () => {
        const results = await fetchMusicLibraryIndexPages();
        const {
            albumsResult,
            artistsResult,
            playlistsResult,
            tracksResult
        } = results;
        const debug = buildMusicLibraryDebug(library, results);

        recordPtvEvent('api', 'music-library-index-loaded', debug);
        const sortedAlbums = [...albumsResult.items];
        const sortedArtists = [...artistsResult.items];

        sortedAlbums.sort(byName);
        sortedArtists.sort(byName);

        const index = {
            albums: sortedAlbums,
            artists: sortedArtists,
            debug,
            library,
            playlists: playlistsResult.items,
            tracks: tracksResult.items
        };

        recordPtvMusicApiDiagnostic('music-library-counts-loaded', {
            albumCount: index.albums.length,
            artistCount: index.artists.length,
            cached: false,
            libraryId: index.library?.id || null,
            libraryName: index.library?.name || null,
            playlistCount: index.playlists.length,
            songCount: index.tracks.length
        });

        const failedCoreSections = debug.failedSections
            .filter(section => section === 'albums' || section === 'artists' || section === 'tracks');

        if (!index.albums.length && !index.artists.length && !index.tracks.length && failedCoreSections.length) {
            throw new Error(`Music library index failed for ${failedCoreSections.join(', ')}.`);
        }

        if (shouldWriteMusicLibraryIndexCache(index)) {
            await writePtvLibraryIndexCache(
                cacheKey,
                MUSIC_LIBRARY_INDEX_CACHE_SCHEMA_VERSION,
                index,
                PTV_LIBRARY_INDEX_CACHE_TTL_MS
            );
        } else {
            recordPtvEvent('cache', 'music-library-index-cache-write-skipped', {
                failedSections: debug.failedSections,
                reason: 'empty-or-failed-core-section'
            });
        }

        return index;
    });
}

export async function fetchPtvMusicPlaylists(limit = 36): Promise<PtvMusicItem[]> {
    const result = await getItems<PtvMusicItem>({
        IncludeItemTypes: 'Playlist',
        Limit: Math.max(limit * 2, limit),
        SortBy: 'DateCreated,SortName',
        SortOrder: 'Descending'
    });
    const candidates = uniquePtvMusicPlaylists(uniquePtvMusicItems(result.Items || []));
    const checkedPlaylists = await Promise.all(candidates.map(async playlist => {
        if (!playlist.Id) return null;

        const tracks = await fetchPtvMusicPlaylistTracks(playlist.Id, 1).catch(() => []);

        return tracks.length ? playlist : null;
    }));
    const playlists = checkedPlaylists.filter((playlist): playlist is PtvMusicItem => Boolean(playlist)).slice(0, limit);

    recordPtvEvent('api', 'music-playlists-filtered', {
        candidateCount: candidates.length,
        musicPlaylistCount: playlists.length
    });

    return playlists;
}

export function searchPtvMusic(searchTerm: string, limit = 48): Promise<PtvMusicItem[]> {
    const normalizedSearchTerm = searchTerm.trim();

    if (!normalizedSearchTerm) return Promise.resolve([]);

    return getScopedItems<PtvMusicItem>({
        IncludeItemTypes: 'Audio,MusicAlbum,MusicArtist,Playlist',
        Limit: limit,
        SearchTerm: normalizedSearchTerm,
        SortBy: 'SortName',
        SortOrder: 'Ascending'
    }).then(result => uniquePtvMusicItems(result.Items || []));
}

export async function fetchPtvMusicTracksByArtist(
    artistId: string,
    artistName = '',
    limit = 60
): Promise<PtvMusicItem[]> {
    const primaryQuery = artistId ? { ArtistIds: artistId } : { SearchTerm: artistName };
    const items = await fetchPtvMusicTracks({
        ...primaryQuery,
        SortBy: 'PlayCount,SortName',
        SortOrder: 'Descending'
    }, limit);

    if (items.length || !artistName) return items;

    return fetchPtvMusicTracks({
        SearchTerm: artistName,
        SortBy: 'PlayCount,SortName',
        SortOrder: 'Descending'
    }, limit);
}

export async function fetchPtvMusicAlbumsByArtist(
    artistId: string,
    artistName = '',
    limit = 36
): Promise<PtvMusicItem[]> {
    const primaryQuery = artistId ? { ArtistIds: artistId } : { SearchTerm: artistName };
    const items = await getScopedItems<PtvMusicItem>({
        IncludeItemTypes: 'MusicAlbum',
        Limit: limit,
        SortBy: 'ProductionYear,PremiereDate,SortName',
        SortOrder: 'Descending',
        ...primaryQuery
    }).then(result => uniquePtvMusicItems(result.Items || []));

    if (items.length || !artistName) return items;

    return getScopedItems<PtvMusicItem>({
        IncludeItemTypes: 'MusicAlbum',
        Limit: limit,
        SearchTerm: artistName,
        SortBy: 'ProductionYear,PremiereDate,SortName',
        SortOrder: 'Descending'
    }).then(result => uniquePtvMusicItems(result.Items || []));
}

export function fetchPtvMusicAlbumTracks(albumId: string, limit = 100): Promise<PtvMusicItem[]> {
    if (!albumId) return Promise.resolve([]);

    return fetchPtvMusicTracks({
        ParentId: albumId,
        SortBy: 'ParentIndexNumber,IndexNumber,SortName',
        SortOrder: 'Ascending'
    }, limit);
}

export function fetchPtvMusicPlaylistTracks(playlistId: string, limit = 100): Promise<PtvMusicItem[]> {
    const userId = getPtvCurrentUserId();

    if (!playlistId) return Promise.resolve([]);

    if (!userId) {
        return fetchPtvMusicTracks({
            ParentId: playlistId,
            SortBy: 'SortName',
            SortOrder: 'Ascending'
        }, limit);
    }

    return requestPtvJson<PtvItemsResult<PtvMusicItem>>(`Playlists/${playlistId}/Items`, {
        params: {
            Fields: MUSIC_FIELDS,
            Limit: limit,
            UserId: userId
        }
    }).then(result => uniquePtvMusicItems(result.Items || []))
        .catch(() => fetchPtvMusicTracks({
            ParentId: playlistId,
            SortBy: 'SortName',
            SortOrder: 'Ascending'
        }, limit));
}

export function fetchPtvMusicVideos(limit = 12): Promise<PtvMusicItem[]> {
    return getScopedItems<PtvMusicItem>({
        IncludeItemTypes: 'MusicVideo',
        Limit: limit,
        SortBy: 'DateCreated',
        SortOrder: 'Descending'
    }).then(result => uniquePtvMusicItems(result.Items || []))
        .catch(() => []);
}

function getSection(id: string, title: string, items: PtvMusicItem[], options: Partial<PtvMusicSection> = {}): PtvMusicSection {
    return {
        id,
        items: uniquePtvMusicItems(items),
        kind: options.kind || 'track',
        seed: options.seed,
        subtitle: options.subtitle,
        title
    };
}

function getGenreCounts(items: PtvMusicItem[]) {
    const counts = new Map<string, number>();

    items.forEach(item => {
        getPtvMusicGenres(item).forEach(genre => {
            counts.set(genre, (counts.get(genre) || 0) + 1);
        });
    });

    return Array.from(counts.entries())
        .sort((left, right) => right[1] - left[1])
        .map(([genre]) => genre);
}

function buildGenreMixSections(items: PtvMusicItem[]) {
    return getGenreCounts(items)
        .slice(0, 4)
        .map(genre => getSection(
            `genre-${genre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            `${genre} Mix`,
            items.filter(item => getPtvMusicGenres(item).includes(genre)).slice(0, 18),
            {
                seed: {
                    kind: 'genre',
                    label: genre,
                    value: genre
                },
                subtitle: 'Genre Mix'
            }
        ))
        .filter(section => section.items.length > 0);
}

function buildSimilarArtistSection(artists: PtvMusicItem[], tracks: PtvMusicItem[]) {
    const topTrackArtists = new Set(tracks.map(getPtvMusicArtist).filter(Boolean));
    const similarArtists = artists
        .filter(artist => !topTrackArtists.has(getPtvMusicTitle(artist)))
        .slice(0, 18);

    return getSection('similar-artists', 'Similar Artists', similarArtists, {
        kind: 'artist',
        seed: {
            kind: 'artist',
            label: 'Similar Artists'
        },
        subtitle: 'Artist Radio'
    });
}

export function invalidatePtvMusicHomeCache() {
    const cacheKey = getCacheKey();

    musicHomeCache.clear();
    musicHomeSummaryCache.clear();
    musicLibraryCache.clear();
    removePtvLocalStorageKey(getMusicHomeStorageKey(cacheKey, true));
    removePtvLocalStorageKey(getMusicHomeStorageKey(cacheKey, false));
    void deletePtvLibraryIndexCache(getMusicLibraryIndexCacheKey());
    void deletePtvLibraryIndexCacheByPrefix(`music:${cacheKey}:`);
}

export function getPtvMusicHome(options: {
    initialOnly?: boolean;
    forceRefresh?: boolean;
} = {}): Promise<PtvMusicHomeData> {
    const cacheKey = getCacheKey();
    const activeCache = options.initialOnly ? musicHomeSummaryCache : musicHomeCache;
    const cached = activeCache.get(cacheKey);
    const fullCached = musicHomeCache.get(cacheKey);
    const requestKey = `music-home:${getMusicDataScopeKey()}:${options.initialOnly ? 'initial' : 'full'}:${options.forceRefresh ? 'refresh' : 'normal'}`;

    if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
        if (!canUseMusicHomeCache(cached.data)) {
            activeCache.delete(cacheKey);
            recordPtvEvent('cache', 'music-home-cache-ignored', {
                isPartial: Boolean(cached.data.isPartial),
                reason: getMusicHomeCacheIgnoredReason(cached.data),
                sectionCount: cached.data.sections.length,
                stats: cached.data.stats
            });
        } else {
            recordPtvEvent('cache', 'music-home-cache-hit', {
                completeness: cached.data.completeness || null,
                isPartial: Boolean(cached.data.isPartial),
                sectionCount: cached.data.sections.length
            });
            recordPtvMusicApiDiagnostic('music-home-counts-loaded', {
                ...getMusicHomeCountDiagnostic(cached.data),
                cached: true
            });

            return Promise.resolve(cached.data);
        }
    }

    if (!options.forceRefresh) {
        const persistentCached = readPersistentMusicHomeCache(cacheKey, Boolean(options.initialOnly), true);

        if (persistentCached) return Promise.resolve(persistentCached);

        if (options.initialOnly) {
            const persistentFullCached = readPersistentMusicHomeCache(cacheKey, false, true);

            if (persistentFullCached) return Promise.resolve(persistentFullCached);
        }
    }

    if (!options.forceRefresh && options.initialOnly && fullCached && fullCached.expiresAt > Date.now()) {
        if (!canUseMusicHomeCache(fullCached.data)) {
            musicHomeCache.delete(cacheKey);
            recordPtvEvent('cache', 'music-home-cache-ignored', {
                isPartial: false,
                reason: getMusicHomeCacheIgnoredReason(fullCached.data),
                sectionCount: fullCached.data.sections.length,
                stats: fullCached.data.stats
            });
        } else {
            recordPtvEvent('cache', 'music-home-cache-hit', {
                completeness: fullCached.data.completeness || null,
                isPartial: false,
                sectionCount: fullCached.data.sections.length
            });
            recordPtvMusicApiDiagnostic('music-home-counts-loaded', {
                ...getMusicHomeCountDiagnostic(fullCached.data),
                cached: true
            });

            return Promise.resolve(fullCached.data);
        }
    }

    return runMusicCoordinatorRequest(requestKey, options.initialOnly ? 'music-home-initial' : 'music-home-full', () => timePtvAsync('api', 'music-api-loaded', async () => {
        const sectionTimings: PtvMusicSectionTiming[] = [];
        const musicLibrary = await getPtvMusicLibrary().catch(error => {
            recordMusicApiSectionFailure('library', error);

            return null;
        });
        const libraryScope = musicLibrary?.id ? { ParentId: musicLibrary.id } : {};

        if (options.initialOnly) {
            const [
                recentlyPlayed,
                continueListening,
                favorites,
                recentlyAdded,
                albumSample,
                artistSample,
                trackSample
            ] = await runPtvScheduledRequests(
                [
                    () => timeMusicSection('recently-played', fetchPtvMusicTracks({
                        SortBy: 'DatePlayed',
                        SortOrder: 'Descending'
                    }, 24), sectionTimings),
                    () => timeMusicSection('continue-listening', getPtvResumeItems<PtvMusicItem>({
                        Fields: MUSIC_FIELDS,
                        IncludeItemTypes: 'Audio',
                        Limit: 18,
                        Recursive: true,
                        ...libraryScope
                    }).then(result => uniquePtvMusicItems(result.Items || [])), sectionTimings),
                    () => timeMusicSection('favorites', getPtvFavoriteItems<PtvMusicItem>({
                        Fields: MUSIC_FIELDS,
                        IncludeItemTypes: 'Audio',
                        Limit: 24,
                        Recursive: true,
                        SortBy: 'SortName',
                        ...libraryScope
                    }).then(result => uniquePtvMusicItems(result.Items || [])), sectionTimings),
                    () => timeMusicSection('recently-added', fetchPtvRecentlyAddedMusic(
                        libraryScope,
                        24,
                        'recently-added'
                    ), sectionTimings),
                    () => timeMusicSection('album-sample', fetchPtvMusicAlbums(20), sectionTimings),
                    () => timeMusicSection('artist-sample', fetchPtvMusicArtists(20), sectionTimings),
                    () => timeMusicSection('track-sample', fetchPtvMusicTracks({
                        SortBy: 'SortName',
                        SortOrder: 'Ascending'
                    }, 20), sectionTimings)
                ],
                task => task(),
                { concurrency: 2 }
            );
            const likedSongs = uniquePtvMusicItems([
                ...getPtvLikedMusicItems(),
                ...favorites
            ]);
            const allItems = uniquePtvMusicItems([
                ...recentlyPlayed,
                ...continueListening,
                ...likedSongs,
                ...recentlyAdded,
                ...trackSample
            ]);
            const sections = [
                getSection('recently-played', 'Recently Played', recentlyPlayed, {
                    seed: { kind: 'recent', label: 'Recently Played' }
                }),
                getSection('continue-listening', 'Continue Listening', continueListening, {
                    seed: { kind: 'recent', label: 'Continue Listening' }
                }),
                getSection('liked-songs', 'Liked Songs', likedSongs, {
                    seed: { kind: 'favorites', label: 'Liked Songs' },
                    subtitle: 'Favorites'
                }),
                getSection('recently-added-music', 'Recently Added Music', recentlyAdded, {
                    seed: { kind: 'recent', label: 'Recently Added Music' }
                }),
                getSection('top-artists', 'Top Artists', artistSample, {
                    kind: 'artist',
                    seed: { kind: 'artist', label: 'Top Artists' }
                }),
                getSection('top-albums', 'Top Albums', albumSample, {
                    kind: 'album',
                    seed: { kind: 'album', label: 'Top Albums' }
                }),
                getSection('songs', 'Songs', trackSample, {
                    seed: { kind: 'song', label: 'Songs' }
                })
            ].filter(section => section.items.length > 0);
            const data: PtvMusicHomeData = {
                completeness: hasFailedMusicSections(sectionTimings) ? 'degraded' : 'initial-usable',
                generatedAt: Date.now(),
                isPartial: true,
                library: musicLibrary,
                nextEligibleRefreshAt: Date.now() + MUSIC_HOME_CACHE_TTL_MS,
                refreshReason: hasFailedMusicSections(sectionTimings) ? 'initial-load-had-failed-sections' : 'intentional-initial-home-sections',
                sectionTimings,
                sections,
                stats: {
                    albumCount: albumSample.length,
                    artistCount: artistSample.length,
                    trackCount: allItems.length
                }
            };

            if (favorites.length) {
                mergePtvLikedMusicItems(favorites);
            }

            if (!isUsableMusicHomeCache(data) && hasFailedMusicSections(sectionTimings)) {
                throw new Error(getMusicSectionFailureMessage(
                    'Music initial load failed before any library items were confirmed',
                    sectionTimings
                ));
            }

            if (shouldWriteMusicHomeCache(data)) {
                musicHomeSummaryCache.set(cacheKey, {
                    data,
                    expiresAt: Date.now() + MUSIC_HOME_CACHE_TTL_MS,
                    schemaVersion: MUSIC_HOME_PERSISTENT_CACHE_SCHEMA_VERSION
                });
                writePersistentMusicHomeCache(cacheKey, data, true);
            } else {
                recordPtvEvent('cache', 'music-home-cache-write-skipped', {
                    isPartial: true,
                    reason: 'empty-unverified-cache',
                    sectionTimings
                });
            }
            recordPtvEvent('api', 'music-api-loaded', {
                isPartial: true,
                sectionTimings,
                sections: sections.map(section => ({
                    id: section.id,
                    itemCount: section.items.length,
                    title: section.title
                }))
            });
            recordPtvMusicApiDiagnostic('music-home-counts-loaded', {
                ...getMusicHomeCountDiagnostic(data),
                cached: false
            });

            return data;
        }

        const [
            recentlyPlayed,
            continueListening,
            favorites,
            recentlyAdded,
            highestPlayed,
            newMusic,
            albums,
            artists
        ] = await runPtvScheduledRequests(
            [
                () => timeMusicSection('recently-played', fetchPtvMusicTracks({
                    SortBy: 'DatePlayed',
                    SortOrder: 'Descending'
                }, DEFAULT_TRACK_LIMIT), sectionTimings),
                () => timeMusicSection('continue-listening', getPtvResumeItems<PtvMusicItem>({
                    Fields: MUSIC_FIELDS,
                    IncludeItemTypes: 'Audio',
                    Limit: 24,
                    Recursive: true,
                    ...libraryScope
                }).then(result => uniquePtvMusicItems(result.Items || [])), sectionTimings),
                () => timeMusicSection('favorites', getPtvFavoriteItems<PtvMusicItem>({
                    Fields: MUSIC_FIELDS,
                    IncludeItemTypes: 'Audio',
                    Limit: 48,
                    Recursive: true,
                    SortBy: 'SortName',
                    ...libraryScope
                }).then(result => uniquePtvMusicItems(result.Items || [])), sectionTimings),
                () => timeMusicSection('recently-added', fetchPtvRecentlyAddedMusic(
                    libraryScope,
                    36,
                    'recently-added'
                ), sectionTimings),
                () => timeMusicSection('highest-played', fetchPtvMusicTracks({
                    SortBy: 'PlayCount,SortName',
                    SortOrder: 'Descending'
                }, 48), sectionTimings),
                () => timeMusicSection('new-music', fetchPtvMusicTracks({
                    SortBy: 'DateCreated',
                    SortOrder: 'Descending'
                }, 48), sectionTimings),
                () => timeMusicSection('albums', fetchPtvMusicAlbums(), sectionTimings),
                () => timeMusicSection('artists', fetchPtvMusicArtists(), sectionTimings)
            ],
            task => task(),
            { concurrency: 3 }
        );
        const likedSongs = uniquePtvMusicItems([
            ...getPtvLikedMusicItems(),
            ...favorites
        ]);

        if (favorites.length) {
            mergePtvLikedMusicItems(favorites);
        }

        const recommendationPool = uniquePtvMusicItems([
            ...likedSongs,
            ...favorites,
            ...recentlyPlayed,
            ...highestPlayed,
            ...recentlyAdded,
            ...newMusic
        ]);
        const recommendationEngine = createPtvMusicRecommendationEngine();
        logPtvRecommendationStage('Engine created', {
            candidateCount: recommendationPool.length,
            initialized: recommendationEngine.initialized,
            surface: 'music-home'
        });
        recommendationEngine.initialize();
        logPtvRecommendationStage('Provider created', {
            candidateCount: recommendationPool.length,
            provider: 'jellyfin-music-library',
            surface: 'music-home'
        });
        logPtvRecommendationStage('Provider initialized', {
            engineInitialized: recommendationEngine.initialized,
            provider: 'jellyfin-music-library',
            surface: 'music-home'
        });
        const recommendationSeeds = [
            ...likedSongs.slice(0, 24),
            ...favorites.slice(0, 16),
            ...recentlyPlayed.slice(0, 16),
            ...highestPlayed.slice(0, 12)
        ];
        logPtvRecommendationStage('Profile loaded', {
            favoriteCount: likedSongs.length,
            profileSignalCount: new Set(recommendationSeeds.flatMap(item => [getPtvMusicArtist(item), ...getPtvMusicGenres(item)].filter(Boolean))).size,
            profileSource: 'music-library-signals',
            surface: 'music-home'
        });
        logPtvRecommendationStage('Provider loaded', {
            candidateCount: recommendationPool.length,
            surface: 'music-home'
        });
        const recommendationShelves = recommendationEngine.buildShelves(
            recommendationSeeds,
            recommendationPool,
            [
                ...newMusic,
                ...recentlyAdded,
                ...highestPlayed,
                ...recommendationPool
            ],
            continueListening,
            DEFAULT_TRACK_LIMIT
        );
        const { madeForYou, recommended } = recommendationShelves;
        const sections = [
            getSection('recently-played', 'Recently Played', recentlyPlayed, {
                seed: { kind: 'recent', label: 'Recently Played' }
            }),
            getSection('continue-listening', 'Continue Listening', continueListening, {
                seed: { kind: 'recent', label: 'Continue Listening' }
            }),
            getSection('liked-songs', 'Liked Songs', likedSongs, {
                seed: { kind: 'favorites', label: 'Liked Songs' },
                subtitle: 'Favorites'
            }),
            getSection('made-for-you', 'Made For You', madeForYou, {
                seed: { kind: 'favorites', label: 'Made For You' },
                subtitle: 'Smart Picks'
            }),
            getSection('recommended', 'Recommended', recommended, {
                seed: { kind: 'random', label: 'Recommended' },
                subtitle: 'Discovery'
            }),
            getSection('new-music', 'New Music', newMusic, {
                seed: { kind: 'random', label: 'New Music' }
            }),
            getSection('top-artists', 'Top Artists', artists, {
                kind: 'artist',
                seed: { kind: 'artist', label: 'Top Artists' }
            }),
            getSection('top-albums', 'Top Albums', albums, {
                kind: 'album',
                seed: { kind: 'album', label: 'Top Albums' }
            }),
            buildSimilarArtistSection(artists, highestPlayed),
            ...buildGenreMixSections(recommendationPool),
            getSection('recently-added-music', 'Recently Added Music', recentlyAdded, {
                seed: { kind: 'recent', label: 'Recently Added Music' }
            }),
            getSection('high-quality', 'FLAC / OPUS Picks', recommendationPool.filter(item => isPtvMusicQualityMatch(item, ['flac', 'opus'])), {
                seed: { kind: 'quality', label: 'FLAC / OPUS', value: 'flac,opus' },
                subtitle: 'High Quality'
            })
        ].filter(section => section.items.length > 0);
        const recommendationSections = sections.filter(section => section.id === 'continue-listening' || section.id === 'made-for-you' || section.id === 'recommended');
        const recommendationDetail = {
            algorithmByShelf: {
                'continue-listening': 'resume-history',
                'made-for-you': 'artist-genre-affinity',
                recommended: 'fresh-quality-discovery'
            },
            engineInitialized: recommendationEngine.initialized,
            recommendationRowsRendered: recommendationSections.length,
            rowCount: recommendationSections.length,
            rowOverlapPercentage: recommendationShelves.overlapPercentage,
            shelfItemCounts: Object.fromEntries(recommendationSections.map(section => [section.id, section.items.length])),
            shelfIds: recommendationSections.map(section => section.id),
            surface: 'music-home'
        };
        recordPtvEvent('recommendation', 'recommendation-rows-generated', recommendationDetail);
        recordPtvEvent('recommendation', 'music-recommendation-rows-loaded', recommendationDetail);
        const data: PtvMusicHomeData = {
            completeness: hasFailedMusicSections(sectionTimings) ? 'degraded' : 'complete',
            generatedAt: Date.now(),
            isPartial: false,
            library: musicLibrary,
            nextEligibleRefreshAt: Date.now() + MUSIC_HOME_CACHE_TTL_MS,
            refreshReason: hasFailedMusicSections(sectionTimings) ? 'full-load-had-failed-sections' : 'full-home-snapshot',
            sectionTimings,
            sections,
            stats: {
                albumCount: albums.length,
                artistCount: artists.length,
                trackCount: recommendationPool.length
            }
        };

        if (!isUsableMusicHomeCache(data) && hasFailedMusicSections(sectionTimings)) {
            throw new Error(getMusicSectionFailureMessage(
                'Music full load failed before any library items were confirmed',
                sectionTimings
            ));
        }

        if (shouldWriteMusicHomeCache(data)) {
            musicHomeCache.set(cacheKey, {
                data,
                expiresAt: Date.now() + MUSIC_HOME_CACHE_TTL_MS,
                schemaVersion: MUSIC_HOME_PERSISTENT_CACHE_SCHEMA_VERSION
            });
            writePersistentMusicHomeCache(cacheKey, data, false);
        } else {
            recordPtvEvent('cache', 'music-home-cache-write-skipped', {
                isPartial: false,
                reason: 'empty-unverified-cache',
                sectionTimings
            });
        }
        recordPtvEvent('api', 'music-api-loaded', {
            isPartial: false,
            sectionTimings,
            sections: sections.map(section => ({
                id: section.id,
                itemCount: section.items.length,
                title: section.title
            }))
        });
        recordPtvMusicApiDiagnostic('music-home-counts-loaded', {
            ...getMusicHomeCountDiagnostic(data),
            cached: false
        });

        return data;
    }));
}

export function fetchPtvMusicItem(itemId: string): Promise<PtvMusicItem> {
    return getPtvItem<PtvMusicItem>(itemId);
}

export function fetchPtvMusicLyrics(item: PtvMusicItem): Promise<PtvMusicLyricsResponse> {
    if (!item.Id || !item.HasLyrics) {
        return Promise.resolve({ Lyrics: [] });
    }

    return requestPtvJson<PtvMusicLyricsResponse>(`Audio/${item.Id}/Lyrics`)
        .catch(error => {
            recordPtvEvent('render', 'music-playback-error', {
                error: error instanceof Error ? error.message : String(error),
                itemId: item.Id,
                stage: 'lyrics'
            });

            return { Lyrics: [] };
        });
}

export function createPtvMusicPlaylist(name: string, items: PtvMusicItem[]): Promise<{ Id?: string }> {
    const userId = getPtvCurrentUserId();
    const ids = uniquePtvMusicItems(items)
        .map(item => item.Id)
        .filter((id): id is string => Boolean(id));

    if (!userId) {
        recordPtvEvent('api', 'playlist-create-failed', {
            error: 'A signed-in Jellyfin user is required.',
            itemCount: ids.length,
            name
        });

        return Promise.reject(new Error('A signed-in Jellyfin user is required.'));
    }

    if (!ids.length) {
        recordPtvEvent('api', 'playlist-create-failed', {
            error: 'Playlist needs at least one track.',
            itemCount: 0,
            name
        });

        return Promise.reject(new Error('Playlist needs at least one track.'));
    }

    recordPtvEvent('api', 'playlist-create-request', {
        itemCount: ids.length,
        name
    });

    return sendPtvJson<{ Id?: string }>('Playlists', {
        Ids: ids,
        IsPublic: false,
        MediaType: 'Audio',
        Name: name,
        UserId: userId
    }, {
        method: 'POST'
    }).then(result => {
        recordPtvEvent('api', 'playlist-create-success', {
            itemCount: ids.length,
            name,
            playlistId: result.Id || null
        });

        return result;
    }).catch(error => {
        recordPtvEvent('api', 'playlist-create-failed', {
            error: error instanceof Error ? error.message : String(error),
            itemCount: ids.length,
            name
        });

        throw error;
    });
}

export function addPtvMusicItemsToPlaylist(playlistId: string, items: PtvMusicItem[]): Promise<unknown> {
    const userId = getPtvCurrentUserId();
    const ids = uniquePtvMusicItems(items)
        .map(item => item.Id)
        .filter((id): id is string => Boolean(id));

    if (!playlistId) {
        return Promise.reject(new Error('Choose a playlist first.'));
    }

    if (!userId) {
        return Promise.reject(new Error('A signed-in Jellyfin user is required.'));
    }

    if (!ids.length) {
        return Promise.reject(new Error('Playlist needs at least one track.'));
    }

    recordPtvEvent('api', 'playlist-add-request', {
        itemCount: ids.length,
        playlistId
    });

    return sendPtvJson(`Playlists/${playlistId}/Items`, null, {
        method: 'POST',
        params: {
            Ids: ids.join(','),
            UserId: userId
        }
    }).then(result => {
        recordPtvEvent('api', 'playlist-add-success', {
            itemCount: ids.length,
            playlistId
        });

        return result;
    }).catch(error => {
        recordPtvEvent('api', 'playlist-add-failed', {
            error: error instanceof Error ? error.message : String(error),
            itemCount: ids.length,
            playlistId
        });

        throw error;
    });
}

export function fetchPtvMusicTracksForGenerator(query: PtvItemQuery, limit: number): Promise<PtvMusicItem[]> {
    const cappedLimit = Math.max(1, Math.min(limit, MAX_GENERATOR_PAGE_SIZE));

    return fetchPtvMusicTracks(query, cappedLimit);
}
