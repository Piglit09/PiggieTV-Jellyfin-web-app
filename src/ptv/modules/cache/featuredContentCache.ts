import { ServerConnections } from 'lib/jellyfin-apiclient';

import { PTV_CACHE, PTV_EVENTS } from '../../core/config';
import { dispatchPtvCustomEvent } from '../../core/events';
import { ptvLogger } from '../../core/logger';
import { recordPtvEvent, registerPtvDebugCacheStatusProvider, timePtvAsync } from '../../core/observability';
import { getCurrentPtvPluginApiClient, normalizePtvApiError, recordPtvPluginApiRetryState } from '../../core/pluginApi';
import { getRuntimeScope } from '../../core/scope';

export const FEATURED_CACHE_VERSION = PTV_CACHE.featuredContentVersion;
export const FEATURED_CACHE_UPDATED_EVENT = PTV_EVENTS.featuredCacheUpdated;

const DEFAULT_FEATURED_CACHE_TTL_MS = PTV_CACHE.featuredContentTtlMs;
const MIN_FEATURED_CACHE_TTL_MS = PTV_CACHE.minFeaturedContentTtlMs;
const MAX_FEATURED_CACHE_TTL_MS = PTV_CACHE.maxFeaturedContentTtlMs;
const SERVER_CACHE_DOCUMENT_VERSION = 1;

export type FeaturedPayload = {
    heroItems: unknown[];
    rowDiagnostics?: unknown[];
    sections?: unknown[];
    sectionItems: Record<string, unknown[]>;
};

type FeaturedCacheEntry = {
    version: typeof FEATURED_CACHE_VERSION;
    createdAt: number;
    expiresAt: number;
    payload: FeaturedPayload;
};

type FeaturedCacheSettings = {
    ttlMs?: number;
};

type FeaturedServerCacheDocument = {
    version: typeof SERVER_CACHE_DOCUMENT_VERSION;
    featuredContent?: FeaturedCacheEntry | null;
    featuredContentSettings?: FeaturedCacheSettings;
    updatedAt?: number;
};

type DebugWindow = Window & Partial<Record<'PTV_DEBUG', boolean>>;

type PtvPluginStatusForCache = {
    featureFlags?: Record<string, boolean>;
    features?: Record<string, boolean> | string[];
    ok?: boolean;
};

let inflightFeaturedContent: Promise<FeaturedPayload> | null = null;
let inflightServerRead: Promise<FeaturedCacheEntry | null> | null = null;
let inflightPluginStatus: Promise<PtvPluginStatusForCache | null> | null = null;
let lastFeaturedContentFetcher: (() => Promise<FeaturedPayload>) | null = null;
let lastPluginStatus: PtvPluginStatusForCache | null = null;
let lastPluginStatusReadAt = 0;
let memoryCacheEntry: FeaturedCacheEntry | null = null;
let memoryCacheSettings: FeaturedCacheSettings = {};
let lastCacheStorage: 'memory' | 'plugin-file' | null = null;
let lastCacheWriteError: string | null = null;
let lastCacheReadError: string | null = null;
let lastRefreshDurationMs: number | null = null;
let lastRefreshError: string | null = null;
let initialCachePrimeScheduled = false;
let serverReadRetryBackoffMs = 0;
let serverReadRetryCount = 0;
let nextServerReadAllowedAt = 0;
let startupPrimeAttemptCount = 0;

const FEATURED_CACHE_PRIME_DELAYS = [300, 1200, 3200, 8000, 15000];
const MAX_SERVER_READ_RETRY_COUNT = 5;
const SERVER_READ_BACKOFF_BASE_MS = 1000;
const SERVER_READ_BACKOFF_MAX_MS = 5 * 60 * 1000;
const SERVER_EMPTY_READ_SUPPRESSION_MS = 30000;
const PLUGIN_STATUS_CACHE_MS = 30000;
const featuredCacheScope = getRuntimeScope('featured-cache');

const CACHE_ITEM_FIELDS = new Set([
    'Album',
    'AlbumArtist',
    'AlbumArtists',
    'AlbumId',
    'AlbumPrimaryImageTag',
    'ArtistItems',
    'Artists',
    'BackdropImageTag',
    'BackdropImageTags',
    'BackdropItemId',
    'ChildCount',
    'CollectionType',
    'CommunityRating',
    'Container',
    'CriticRating',
    'DateCreated',
    'EndDate',
    'Genres',
    'Id',
    'ImageBlurHashes',
    'ImageTags',
    'IndexNumber',
    'IsFolder',
    'LocationType',
    'MediaSourceCount',
    'MediaSources',
    'MediaStreams',
    'MediaType',
    'Name',
    'OfficialRating',
    'OriginalTitle',
    'Overview',
    'ParentBackdropImageTag',
    'ParentBackdropImageTags',
    'ParentBackdropItemId',
    'ParentId',
    'ParentIndexNumber',
    'ParentLogoImageTag',
    'ParentLogoItemId',
    'ParentPrimaryImageTag',
    'ParentThumbImageTag',
    'ParentThumbItemId',
    'PremiereDate',
    'PrimaryImageAspectRatio',
    'PrimaryImageTag',
    'ProductionYear',
    'PtvQualityTags',
    'PtvHeroRecommendationLabel',
    'PtvHeroSource',
    'RecursiveItemCount',
    'RunTimeTicks',
    'SeasonId',
    'SeasonName',
    'Series',
    'SeriesId',
    'SeriesName',
    'SeriesPrimaryImageTag',
    'SeriesThumbImageTag',
    'ServerId',
    'SongCount',
    'Studios',
    'Type',
    'VideoCodec',
    'VideoRange',
    'Height',
    'Width',
    'UserData'
]);

const CACHE_MEDIA_SOURCE_FIELDS = new Set([
    'Container',
    'Height',
    'MediaSourceType',
    'MediaStreams',
    'Protocol',
    'Type',
    'VideoCodec',
    'VideoRange',
    'Width'
]);

const CACHE_MEDIA_STREAM_FIELDS = new Set([
    'Channels',
    'Codec',
    'CodecTag',
    'DisplayTitle',
    'Height',
    'Profile',
    'Title',
    'Type',
    'Video3DFormat',
    'VideoDoViTitle',
    'VideoRange',
    'VideoRangeType',
    'Width'
]);

function isDebugEnabled() {
    return typeof window !== 'undefined' && (window as DebugWindow)['PTV_DEBUG'] === true;
}

function debugLog(message: string, detail?: unknown) {
    if (isDebugEnabled()) {
        console.debug(`[PTV Featured Cache] ${message}`, detail);
    }
}

function getCurrentApiClient() {
    return ServerConnections.currentApiClient?.();
}

function clampTtlMs(ttlMs: number) {
    if (!Number.isFinite(ttlMs)) return DEFAULT_FEATURED_CACHE_TTL_MS;

    return Math.min(
        MAX_FEATURED_CACHE_TTL_MS,
        Math.max(MIN_FEATURED_CACHE_TTL_MS, Math.round(ttlMs))
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSectionItems(value: unknown): Record<string, unknown[]> {
    if (!isRecord(value)) return {};

    return Object.keys(value).reduce<Record<string, unknown[]>>((sections, sectionId) => {
        const items = value[sectionId];

        if (Array.isArray(items)) {
            sections[sectionId] = items;
        }

        return sections;
    }, {});
}

function normalizePayload(payload: FeaturedPayload): FeaturedPayload {
    return {
        heroItems: Array.isArray(payload.heroItems) ? payload.heroItems : [],
        rowDiagnostics: Array.isArray(payload.rowDiagnostics) ? payload.rowDiagnostics : [],
        sections: Array.isArray(payload.sections) ? payload.sections : [],
        sectionItems: normalizeSectionItems(payload.sectionItems)
    };
}

function compactCacheItem(item: unknown): unknown {
    if (!isRecord(item)) return item;

    return Object.keys(item).reduce<Record<string, unknown>>((compactItem, key) => {
        if (key === 'MediaSources') {
            compactItem[key] = compactMediaSources(item[key]);
        } else if (key === 'MediaStreams') {
            compactItem[key] = compactMediaStreams(item[key]);
        } else if (CACHE_ITEM_FIELDS.has(key)) {
            compactItem[key] = item[key];
        }

        return compactItem;
    }, {});
}

function compactRecord(value: unknown, allowedFields: Set<string>) {
    if (!isRecord(value)) return null;

    return Object.keys(value).reduce<Record<string, unknown>>((compactValue, key) => {
        if (key === 'MediaStreams') {
            compactValue[key] = compactMediaStreams(value[key]);
        } else if (allowedFields.has(key)) {
            compactValue[key] = value[key];
        }

        return compactValue;
    }, {});
}

function compactMediaSources(value: unknown) {
    if (!Array.isArray(value)) return undefined;

    return value
        .map(mediaSource => compactRecord(mediaSource, CACHE_MEDIA_SOURCE_FIELDS))
        .filter(Boolean)
        .slice(0, 2);
}

function compactMediaStreams(value: unknown) {
    if (!Array.isArray(value)) return undefined;

    return value
        .map(mediaStream => compactRecord(mediaStream, CACHE_MEDIA_STREAM_FIELDS))
        .filter(Boolean)
        .slice(0, 8);
}

function compactPayload(payload: FeaturedPayload): FeaturedPayload {
    const normalizedPayload = normalizePayload(payload);

    return {
        heroItems: normalizedPayload.heroItems.map(compactCacheItem),
        rowDiagnostics: normalizedPayload.rowDiagnostics,
        sections: normalizedPayload.sections,
        sectionItems: Object.keys(normalizedPayload.sectionItems).reduce<Record<string, unknown[]>>(
            (sectionItems, sectionId) => {
                sectionItems[sectionId] = normalizedPayload.sectionItems[sectionId].map(compactCacheItem);

                return sectionItems;
            },
            {}
        )
    };
}

function getPayloadItemCount(payload: FeaturedPayload) {
    return Object.keys(payload.sectionItems).reduce((count, sectionId) => {
        const items = payload.sectionItems[sectionId];

        return count + items.length;
    }, 0);
}

function getErrorMessage(err: unknown) {
    const normalizedError = normalizePtvApiError(err);

    if (normalizedError.message !== 'Unknown plugin API error') {
        return normalizedError.message;
    }

    return err instanceof Error ? err.message : 'Unable to store featured cache.';
}

function mergePayload(payload: FeaturedPayload, fallbackPayload?: FeaturedPayload): FeaturedPayload {
    const normalizedPayload = normalizePayload(payload);

    if (!fallbackPayload) return normalizedPayload;

    const normalizedFallbackPayload = normalizePayload(fallbackPayload);
    const sectionItems = {
        ...normalizedFallbackPayload.sectionItems
    };

    Object.keys(normalizedPayload.sectionItems).forEach(sectionId => {
        const items = normalizedPayload.sectionItems[sectionId];

        if (items.length || !sectionItems[sectionId]) {
            sectionItems[sectionId] = items;
        }
    });

    return {
        heroItems: normalizedPayload.heroItems.length ?
            normalizedPayload.heroItems :
            normalizedFallbackPayload.heroItems,
        rowDiagnostics: normalizedPayload.rowDiagnostics?.length ?
            normalizedPayload.rowDiagnostics :
            normalizedFallbackPayload.rowDiagnostics,
        sections: normalizedPayload.sections?.length ?
            normalizedPayload.sections :
            normalizedFallbackPayload.sections,
        sectionItems
    };
}

function parseCacheEntryValue(value: unknown): FeaturedCacheEntry | null {
    if (!isRecord(value)) return null;
    if (value.version !== FEATURED_CACHE_VERSION) return null;
    if (typeof value.createdAt !== 'number') return null;
    if (typeof value.expiresAt !== 'number') return null;
    if (!isRecord(value.payload)) return null;

    return {
        version: FEATURED_CACHE_VERSION,
        createdAt: value.createdAt,
        expiresAt: value.expiresAt,
        payload: normalizePayload(value.payload as FeaturedPayload)
    };
}

function parseCacheSettings(value: unknown): FeaturedCacheSettings {
    if (!isRecord(value)) return {};

    return {
        ttlMs: typeof value.ttlMs === 'number' ? clampTtlMs(value.ttlMs) : undefined
    };
}

function normalizeServerDocument(value: unknown): FeaturedServerCacheDocument {
    if (!isRecord(value)) {
        return {
            version: SERVER_CACHE_DOCUMENT_VERSION
        };
    }

    return {
        ...value,
        version: SERVER_CACHE_DOCUMENT_VERSION,
        featuredContent: parseCacheEntryValue(value.featuredContent),
        featuredContentSettings: parseCacheSettings(value.featuredContentSettings),
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : undefined
    };
}

function getDefaultServerDocument(): FeaturedServerCacheDocument {
    return {
        version: SERVER_CACHE_DOCUMENT_VERSION,
        featuredContent: null,
        featuredContentSettings: memoryCacheSettings,
        updatedAt: Date.now()
    };
}

function getSuccessfulServerStorage(): 'plugin-file' {
    return 'plugin-file';
}

function hasPluginFeature(status: PtvPluginStatusForCache | null, feature: string) {
    if (!status) return false;

    const featureMapValue = status.featureFlags?.[feature];

    if (typeof featureMapValue === 'boolean') {
        debugLog(`Feature detected: ${feature}=${featureMapValue}`);

        return featureMapValue;
    }

    if (Array.isArray(status.features)) {
        const isDetected = status.features.includes(feature);

        debugLog(`Feature detected: ${feature}=${isDetected}`);

        return isDetected;
    }

    const featureValue = status.features?.[feature];

    if (typeof featureValue === 'boolean') {
        debugLog(`Feature detected: ${feature}=${featureValue}`);

        return featureValue;
    }

    debugLog(`Feature detected: ${feature}=false`);

    return false;
}

function readPluginStatusForCache() {
    if (lastPluginStatus && Date.now() - lastPluginStatusReadAt < PLUGIN_STATUS_CACHE_MS) {
        return Promise.resolve(lastPluginStatus);
    }

    if (inflightPluginStatus) return inflightPluginStatus;

    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi) {
        return Promise.resolve(null);
    }

    inflightPluginStatus = pluginApi.getStatus<PtvPluginStatusForCache>()
        .then(status => {
            lastPluginStatus = status;
            lastPluginStatusReadAt = Date.now();

            return status;
        })
        .catch((err: unknown) => {
            debugLog('plugin status unavailable for cache capability check', err);
            lastPluginStatus = null;
            lastPluginStatusReadAt = Date.now();

            return null;
        })
        .finally(() => {
            inflightPluginStatus = null;
        });

    return inflightPluginStatus;
}

function readPluginDocument() {
    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi) {
        return Promise.reject(new Error('PTV plugin API client is unavailable.'));
    }

    return readPluginStatusForCache()
        .then(status => {
            const isFeaturedContentAdvertised = hasPluginFeature(status, 'featuredContent');

            recordPtvEvent('cache', 'featured-cache-feature-advertised', {
                featureFlagKeys: status?.featureFlags ? Object.keys(status.featureFlags) : [],
                features: Array.isArray(status?.features) ? status.features : Object.keys(status?.features || {}),
                isFeaturedContentAdvertised,
                statusOk: status?.ok ?? null
            });

            if (!isFeaturedContentAdvertised) {
                return Promise.reject(new Error('PTV plugin featured-content endpoint is not advertised by status.'));
            }

            return pluginApi.getFeaturedContentCacheDocument()
                .then(document => normalizeServerDocument(document));
        });
}

function writePluginDocument(nextDocument: FeaturedServerCacheDocument) {
    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi) {
        return Promise.reject(new Error('PTV plugin API client is unavailable.'));
    }

    return pluginApi.writeFeaturedContentCacheDocument({
        ...nextDocument,
        version: SERVER_CACHE_DOCUMENT_VERSION,
        updatedAt: Date.now()
    });
}

function clearPluginDocument() {
    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi?.clearFeaturedContentCacheDocument) {
        return Promise.reject(new Error('PTV plugin cache clear endpoint is unavailable.'));
    }

    return pluginApi.clearFeaturedContentCacheDocument();
}

function readServerDocument() {
    return readPluginDocument()
        .then(document => document);
}

function canReadServerCacheNow() {
    return Date.now() >= nextServerReadAllowedAt;
}

function noteServerReadSuccess(hasCache: boolean) {
    serverReadRetryBackoffMs = 0;
    serverReadRetryCount = 0;
    nextServerReadAllowedAt = hasCache ? 0 : Date.now() + SERVER_EMPTY_READ_SUPPRESSION_MS;
    recordPtvPluginApiRetryState(serverReadRetryCount, serverReadRetryBackoffMs);
}

function noteServerReadFailure() {
    serverReadRetryCount += 1;
    serverReadRetryBackoffMs = Math.min(
        SERVER_READ_BACKOFF_MAX_MS,
        SERVER_READ_BACKOFF_BASE_MS * (2 ** Math.max(0, serverReadRetryCount - 1))
    );

    if (serverReadRetryCount >= MAX_SERVER_READ_RETRY_COUNT) {
        serverReadRetryBackoffMs = SERVER_READ_BACKOFF_MAX_MS;
    }

    nextServerReadAllowedAt = Date.now() + serverReadRetryBackoffMs;
    recordPtvPluginApiRetryState(serverReadRetryCount, serverReadRetryBackoffMs);
}

function writeServerDocument(nextDocument: FeaturedServerCacheDocument) {
    const normalizedDocument: FeaturedServerCacheDocument = {
        ...nextDocument,
        version: SERVER_CACHE_DOCUMENT_VERSION,
        updatedAt: Date.now()
    };

    return writePluginDocument(normalizedDocument)
        .then(() => undefined);
}

function clearServerDocument() {
    return clearPluginDocument()
        .then(() => undefined);
}

function readServerCacheEntry() {
    if (inflightServerRead) return inflightServerRead;

    if (!canReadServerCacheNow()) {
        debugLog('server cache read suppressed by backoff', {
            retryBackoffMs: serverReadRetryBackoffMs,
            retryCount: serverReadRetryCount
        });

        if (memoryCacheEntry) {
            lastCacheStorage = 'memory';
        }

        return Promise.resolve(memoryCacheEntry);
    }

    inflightServerRead = timePtvAsync('cache', 'read-server-cache', () => readServerDocument())
        .then(document => {
            memoryCacheSettings = parseCacheSettings(document.featuredContentSettings);
            memoryCacheEntry = parseCacheEntryValue(document.featuredContent);
            lastCacheStorage = memoryCacheEntry ? getSuccessfulServerStorage() : null;
            lastCacheWriteError = null;
            lastCacheReadError = null;
            noteServerReadSuccess(Boolean(memoryCacheEntry));

            debugLog('read server cache', {
                hasCache: Boolean(memoryCacheEntry),
                storage: lastCacheStorage,
                ttlMs: getFeaturedContentCacheTtlMs()
            });

            return memoryCacheEntry;
        })
        .catch((err: unknown) => {
            lastCacheWriteError = null;
            lastCacheReadError = getErrorMessage(err);
            noteServerReadFailure();
            recordPtvEvent('cache', 'error', {
                error: getErrorMessage(err),
                operation: 'read'
            });
            debugLog('server cache read failed', err);

            if (memoryCacheEntry) {
                lastCacheStorage = 'memory';
            }

            return memoryCacheEntry;
        })
        .finally(() => {
            inflightServerRead = null;
        });

    return inflightServerRead;
}

export function primeFeaturedContentCacheStatus() {
    if (memoryCacheEntry || inflightServerRead) {
        return inflightServerRead || Promise.resolve(memoryCacheEntry);
    }

    if (!getCurrentApiClient() || !canReadServerCacheNow()) {
        return Promise.resolve(null);
    }

    startupPrimeAttemptCount += 1;
    recordPtvEvent('cache', 'status-prime', {
        attempt: startupPrimeAttemptCount,
        source: 'startup'
    });

    return readServerCacheEntry()
        .then(entry => {
            dispatchCacheUpdated();

            return entry;
        });
}

export function getFeaturedContentCacheTtlMs() {
    return memoryCacheSettings.ttlMs || DEFAULT_FEATURED_CACHE_TTL_MS;
}

function updateMemoryCacheExpiry(ttlMs: number) {
    if (!memoryCacheEntry) return;

    memoryCacheEntry = {
        ...memoryCacheEntry,
        expiresAt: memoryCacheEntry.createdAt + ttlMs
    };
}

function persistServerState(entry: FeaturedCacheEntry | null) {
    return timePtvAsync('cache', 'persist-server-cache', () => readServerDocument()
        .catch((err: unknown) => {
            debugLog('plugin cache read unavailable before write; using default plugin document', err);

            return getDefaultServerDocument();
        })
        .then(document => writeServerDocument({
            ...document,
            featuredContent: entry,
            featuredContentSettings: memoryCacheSettings
        })));
}

export function setFeaturedContentCacheTtlMs(ttlMs: number, options: { persist?: boolean } = {}) {
    const normalizedTtlMs = clampTtlMs(ttlMs);
    const shouldPersist = options.persist !== false;

    memoryCacheSettings = {
        ttlMs: normalizedTtlMs
    };
    updateMemoryCacheExpiry(normalizedTtlMs);

    if (shouldPersist) {
        void persistServerState(memoryCacheEntry)
            .then(() => {
                lastCacheStorage = memoryCacheEntry ? getSuccessfulServerStorage() : lastCacheStorage;
                lastCacheWriteError = null;
                debugLog('updated server refresh interval', { ttlMs: normalizedTtlMs });
                dispatchCacheUpdated();
            })
            .catch((err: unknown) => {
                lastCacheWriteError = getErrorMessage(err);
                lastCacheStorage = memoryCacheEntry ? 'memory' : lastCacheStorage;
                debugLog('failed to store server refresh interval', err);
                dispatchCacheUpdated();
            });
    } else {
        lastCacheWriteError = null;
        debugLog('updated local refresh interval from plugin settings', { ttlMs: normalizedTtlMs });
    }

    dispatchCacheUpdated();

    return normalizedTtlMs;
}

function writeCacheEntry(payload: FeaturedPayload) {
    const createdAt = Date.now();
    const entry: FeaturedCacheEntry = {
        version: FEATURED_CACHE_VERSION,
        createdAt,
        expiresAt: createdAt + getFeaturedContentCacheTtlMs(),
        payload: compactPayload(payload)
    };

    memoryCacheEntry = entry;

    return persistServerState(entry)
        .then(() => {
            lastCacheStorage = getSuccessfulServerStorage();
            lastCacheWriteError = null;
            debugLog('stored fresh payload on server', {
                heroItems: entry.payload.heroItems.length,
                itemCount: getPayloadItemCount(entry.payload),
                sections: Object.keys(entry.payload.sectionItems).length,
                storage: lastCacheStorage,
                expiresAt: entry.expiresAt
            });
            ptvLogger.info('Featured content cache stored on server', {
                expiresAt: entry.expiresAt,
                heroItems: entry.payload.heroItems.length,
                itemCount: getPayloadItemCount(entry.payload),
                sections: Object.keys(entry.payload.sectionItems).length,
                storage: lastCacheStorage
            }, 'FeaturedCache');

            return entry;
        })
        .catch((err: unknown) => {
            lastCacheStorage = 'memory';
            lastCacheWriteError = getErrorMessage(err);
            recordPtvEvent('cache', 'error', {
                error: getErrorMessage(err),
                operation: 'write'
            });
            debugLog('failed to store payload on server', err);

            if (isDebugEnabled()) {
                ptvLogger.warn('Featured content server cache write failed', {
                    error: getErrorMessage(err)
                }, 'FeaturedCache');
            }

            return entry;
        });
}

function dispatchCacheUpdated() {
    if (typeof window === 'undefined') return;

    dispatchPtvCustomEvent(FEATURED_CACHE_UPDATED_EVENT);
}

function refreshFeaturedContent(
    fetcher: () => Promise<FeaturedPayload>,
    fallbackPayload?: FeaturedPayload,
    notifyOnSuccess = false
) {
    const startedAt = performance.now();

    lastRefreshError = null;

    inflightFeaturedContent = timePtvAsync('cache', 'refresh-featured-content', fetcher)
        .then(payload => {
            const normalizedPayload = mergePayload(payload, fallbackPayload);

            return writeCacheEntry(normalizedPayload)
                .then(entry => {
                    lastRefreshDurationMs = Math.round(performance.now() - startedAt);
                    lastRefreshError = null;

                    if (notifyOnSuccess) {
                        dispatchCacheUpdated();
                    }

                    return entry.payload;
                });
        })
        .catch((err: unknown) => {
            if (fallbackPayload) {
                recordPtvEvent('cache', 'error', {
                    error: getErrorMessage(err),
                    operation: 'refresh-with-fallback'
                });
                lastRefreshDurationMs = Math.round(performance.now() - startedAt);
                lastRefreshError = getErrorMessage(err);
                debugLog('refresh failed, keeping stale payload', err);

                return fallbackPayload;
            }

            recordPtvEvent('cache', 'error', {
                error: getErrorMessage(err),
                operation: 'refresh'
            });
            lastRefreshDurationMs = Math.round(performance.now() - startedAt);
            lastRefreshError = getErrorMessage(err);
            throw err;
        })
        .finally(() => {
            inflightFeaturedContent = null;
        });

    return inflightFeaturedContent;
}

export function isFeaturedContentCacheFresh() {
    return Boolean(memoryCacheEntry && Date.now() < memoryCacheEntry.expiresAt);
}

export function getCachedFeaturedContentPayload(options: { allowStale?: boolean } = {}): Promise<FeaturedPayload | null> {
    if (memoryCacheEntry && (options.allowStale || Date.now() < memoryCacheEntry.expiresAt)) {
        recordPtvEvent('cache', Date.now() < memoryCacheEntry.expiresAt ? 'hit' : 'stale-hit', {
            source: 'native-home-memory'
        });

        return Promise.resolve(memoryCacheEntry.payload);
    }

    return readServerCacheEntry()
        .then(cached => {
            if (!cached) return null;
            if (!options.allowStale && Date.now() >= cached.expiresAt) return null;

            recordPtvEvent('cache', Date.now() < cached.expiresAt ? 'hit' : 'stale-hit', {
                source: 'native-home-server',
                storage: lastCacheStorage
            });

            return cached.payload;
        });
}

export function clearFeaturedContentCache() {
    inflightFeaturedContent = null;
    memoryCacheEntry = null;
    lastCacheWriteError = null;
    lastRefreshError = null;

    void clearServerDocument()
        .then(() => {
            lastCacheStorage = null;
            debugLog('cleared server cache');
            ptvLogger.info('Featured content server cache cleared', undefined, 'FeaturedCache');
            dispatchCacheUpdated();
        })
        .catch((err: unknown) => {
            lastCacheStorage = null;
            lastCacheWriteError = getErrorMessage(err);
            debugLog('failed to clear server cache', err);
            dispatchCacheUpdated();
        });

    dispatchCacheUpdated();
}

export function getFeaturedContentCacheStatus() {
    const cached = memoryCacheEntry;
    const now = Date.now();

    if (!cached && !inflightServerRead && canReadServerCacheNow()) {
        void primeFeaturedContentCacheStatus();
    }

    return {
        createdAt: cached?.createdAt || null,
        expiresAt: cached?.expiresAt || null,
        heroCount: cached?.payload.heroItems.length || 0,
        isStored: lastCacheStorage === 'plugin-file',
        isFresh: Boolean(cached && now < cached.expiresAt),
        itemCount: cached ? getPayloadItemCount(cached.payload) : 0,
        sectionCount: cached ? Object.keys(cached.payload.sectionItems).length : 0,
        storage: lastCacheStorage || 'none',
        readError: lastCacheReadError,
        readInProgress: Boolean(inflightServerRead),
        writeError: lastCacheWriteError,
        lastRefreshDurationMs,
        lastRefreshError,
        retryBackoffMs: serverReadRetryBackoffMs,
        retryCount: serverReadRetryCount,
        ttlMs: getFeaturedContentCacheTtlMs()
    };
}

export function forceRefreshFeaturedContentCache(fetcher?: () => Promise<FeaturedPayload>) {
    const activeFetcher = fetcher || lastFeaturedContentFetcher;

    return readServerCacheEntry()
        .then(cached => {
            if (!activeFetcher) {
                clearFeaturedContentCache();
                debugLog('force refresh requested without active fetcher');

                return cached?.payload || {
                    heroItems: [],
                    sectionItems: {}
                };
            }

            if (inflightFeaturedContent) {
                return inflightFeaturedContent;
            }

            debugLog('force refresh started');
            ptvLogger.info('Featured content cache force refresh started', undefined, 'FeaturedCache');

            return refreshFeaturedContent(activeFetcher, cached?.payload, true);
        });
}

function resolveCachedFeaturedContent(cached: FeaturedCacheEntry | null, fetcher: () => Promise<FeaturedPayload>) {
    if (cached && Date.now() < cached.expiresAt) {
        recordPtvEvent('cache', 'hit', {
            heroItems: cached.payload.heroItems.length,
            sections: Object.keys(cached.payload.sectionItems).length,
            storage: lastCacheStorage
        });
        debugLog('fresh server hit', {
            heroItems: cached.payload.heroItems.length,
            sections: Object.keys(cached.payload.sectionItems).length
        });

        return Promise.resolve(cached.payload);
    }

    if (cached) {
        recordPtvEvent('cache', 'stale-hit', {
            heroItems: cached.payload.heroItems.length,
            sections: Object.keys(cached.payload.sectionItems).length,
            storage: lastCacheStorage
        });
        debugLog('stale server hit, refreshing in background', {
            heroItems: cached.payload.heroItems.length,
            sections: Object.keys(cached.payload.sectionItems).length
        });

        if (!inflightFeaturedContent) {
            void refreshFeaturedContent(fetcher, cached.payload, true);
        }

        return Promise.resolve(cached.payload);
    }

    if (inflightFeaturedContent) {
        recordPtvEvent('cache', 'hit', {
            source: 'inflight'
        });
        debugLog('reusing in-flight request');

        return inflightFeaturedContent;
    }

    recordPtvEvent('cache', 'miss', {
        storage: lastCacheStorage
    });
    return refreshFeaturedContent(fetcher);
}

export function getFeaturedContent(fetcher: () => Promise<FeaturedPayload>): Promise<FeaturedPayload> {
    lastFeaturedContentFetcher = fetcher;

    if (memoryCacheEntry && Date.now() < memoryCacheEntry.expiresAt) {
        recordPtvEvent('cache', 'hit', {
            source: 'memory'
        });
        return Promise.resolve(memoryCacheEntry.payload);
    }

    return readServerCacheEntry()
        .then(cached => resolveCachedFeaturedContent(cached, fetcher));
}

registerPtvDebugCacheStatusProvider(getFeaturedContentCacheStatus);

function scheduleInitialCachePrime() {
    if (initialCachePrimeScheduled) return;

    initialCachePrimeScheduled = true;
    FEATURED_CACHE_PRIME_DELAYS.forEach(delay => {
        featuredCacheScope.timeout(() => {
            if (memoryCacheEntry) return;

            void primeFeaturedContentCacheStatus();
        }, delay);
    });
}

scheduleInitialCachePrime();
