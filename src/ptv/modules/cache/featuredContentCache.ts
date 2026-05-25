import { ServerConnections } from 'lib/jellyfin-apiclient';

import { PTV_CACHE, PTV_EVENTS } from '../../core/config';
import { dispatchPtvCustomEvent } from '../../core/events';
import { ptvLogger } from '../../core/logger';
import { recordPtvEvent, registerPtvDebugCacheStatusProvider, timePtvAsync } from '../../core/observability';
import { getCurrentPtvPluginApiClient } from '../../core/pluginApi';
import { getRuntimeScope } from '../../core/scope';

export const FEATURED_CACHE_VERSION = PTV_CACHE.featuredContentVersion;
export const FEATURED_CACHE_UPDATED_EVENT = PTV_EVENTS.featuredCacheUpdated;

const FEATURED_CACHE_SERVER_CONFIG_NAME = PTV_CACHE.featuredContentServerConfigName;
const DEFAULT_FEATURED_CACHE_TTL_MS = PTV_CACHE.featuredContentTtlMs;
const MIN_FEATURED_CACHE_TTL_MS = PTV_CACHE.minFeaturedContentTtlMs;
const MAX_FEATURED_CACHE_TTL_MS = PTV_CACHE.maxFeaturedContentTtlMs;
const SERVER_CACHE_DOCUMENT_VERSION = 1;

export type FeaturedPayload = {
    heroItems: unknown[];
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

let inflightFeaturedContent: Promise<FeaturedPayload> | null = null;
let inflightServerRead: Promise<FeaturedCacheEntry | null> | null = null;
let lastFeaturedContentFetcher: (() => Promise<FeaturedPayload>) | null = null;
let memoryCacheEntry: FeaturedCacheEntry | null = null;
let memoryCacheSettings: FeaturedCacheSettings = {};
let lastCacheStorage: 'memory' | 'named-config' | 'plugin' | null = null;
let lastCacheWriteError: string | null = null;
let lastCacheReadError: string | null = null;
let lastRefreshDurationMs: number | null = null;
let lastRefreshError: string | null = null;
let lastServerBackend: 'named-config' | 'plugin' | null = null;
let initialCachePrimeScheduled = false;

const FEATURED_CACHE_PRIME_DELAYS = [300, 1200, 3200, 8000, 15000];
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
    'UserData'
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
        sectionItems: normalizeSectionItems(payload.sectionItems)
    };
}

function compactCacheItem(item: unknown): unknown {
    if (!isRecord(item)) return item;

    return Object.keys(item).reduce<Record<string, unknown>>((compactItem, key) => {
        if (CACHE_ITEM_FIELDS.has(key)) {
            compactItem[key] = item[key];
        }

        return compactItem;
    }, {});
}

function compactPayload(payload: FeaturedPayload): FeaturedPayload {
    const normalizedPayload = normalizePayload(payload);

    return {
        heroItems: normalizedPayload.heroItems.map(compactCacheItem),
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

function getSuccessfulServerStorage() {
    return lastServerBackend === 'plugin' ? 'plugin' : 'named-config';
}

function readNamedConfigDocument() {
    const apiClient = getCurrentApiClient();

    if (!apiClient?.getNamedConfiguration) {
        return Promise.reject(new Error('Jellyfin named configuration API is unavailable.'));
    }

    return apiClient.getNamedConfiguration(FEATURED_CACHE_SERVER_CONFIG_NAME)
        .then(normalizeServerDocument)
        .catch(() => getDefaultServerDocument());
}

function writeNamedConfigDocument(nextDocument: FeaturedServerCacheDocument) {
    const apiClient = getCurrentApiClient();

    if (!apiClient?.updateNamedConfiguration) {
        return Promise.reject(new Error('Jellyfin named configuration write API is unavailable.'));
    }

    return apiClient.updateNamedConfiguration(FEATURED_CACHE_SERVER_CONFIG_NAME, {
        ...nextDocument,
        version: SERVER_CACHE_DOCUMENT_VERSION,
        updatedAt: Date.now()
    });
}

function readPluginDocument() {
    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi) {
        return Promise.reject(new Error('PTV plugin API client is unavailable.'));
    }

    return pluginApi.getFeaturedContentCacheDocument()
        .then(document => normalizeServerDocument(document));
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
        .then(document => {
            lastServerBackend = 'plugin';

            return document;
        })
        .catch((err: unknown) => {
            debugLog('plugin cache read unavailable, falling back to named configuration', err);

            return readNamedConfigDocument()
                .then(document => {
                    lastServerBackend = 'named-config';

                    return document;
                });
        });
}

function writeServerDocument(nextDocument: FeaturedServerCacheDocument) {
    const normalizedDocument: FeaturedServerCacheDocument = {
        ...nextDocument,
        version: SERVER_CACHE_DOCUMENT_VERSION,
        updatedAt: Date.now()
    };

    if (lastServerBackend !== 'named-config') {
        return writePluginDocument(normalizedDocument)
            .then(() => {
                lastServerBackend = 'plugin';
            })
            .catch((err: unknown) => {
                debugLog('plugin cache write unavailable, falling back to named configuration', err);

                return writeNamedConfigDocument(normalizedDocument)
                    .then(() => {
                        lastServerBackend = 'named-config';
                    });
            });
    }

    return writeNamedConfigDocument(normalizedDocument)
        .then(() => {
            lastServerBackend = 'named-config';
        });
}

function clearServerDocument() {
    if (lastServerBackend !== 'named-config') {
        return clearPluginDocument()
            .then(() => {
                lastServerBackend = 'plugin';
            })
            .catch((err: unknown) => {
                debugLog('plugin cache clear unavailable, falling back to named configuration', err);

                return writeNamedConfigDocument({
                    ...getDefaultServerDocument(),
                    featuredContent: null,
                    featuredContentSettings: memoryCacheSettings
                })
                    .then(() => {
                        lastServerBackend = 'named-config';
                    });
            });
    }

    return writeNamedConfigDocument({
        ...getDefaultServerDocument(),
        featuredContent: null,
        featuredContentSettings: memoryCacheSettings
    })
        .then(() => {
            lastServerBackend = 'named-config';
        });
}

function readServerCacheEntry() {
    if (inflightServerRead) return inflightServerRead;

    inflightServerRead = timePtvAsync('cache', 'read-server-cache', () => readServerDocument())
        .then(document => {
            memoryCacheSettings = parseCacheSettings(document.featuredContentSettings);
            memoryCacheEntry = parseCacheEntryValue(document.featuredContent);
            lastCacheStorage = memoryCacheEntry ? getSuccessfulServerStorage() : null;
            lastCacheWriteError = null;
            lastCacheReadError = null;

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
            recordPtvEvent('cache', 'error', {
                error: getErrorMessage(err),
                operation: 'read'
            });
            debugLog('server cache read failed', err);

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

    if (!getCurrentApiClient()) {
        return Promise.resolve(null);
    }

    recordPtvEvent('cache', 'status-prime', {
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
        .then(document => writeServerDocument({
            ...document,
            featuredContent: entry,
            featuredContentSettings: memoryCacheSettings
        })));
}

export function setFeaturedContentCacheTtlMs(ttlMs: number) {
    const normalizedTtlMs = clampTtlMs(ttlMs);

    memoryCacheSettings = {
        ttlMs: normalizedTtlMs
    };
    updateMemoryCacheExpiry(normalizedTtlMs);

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

export function clearFeaturedContentCache() {
    inflightFeaturedContent = null;
    memoryCacheEntry = null;
    lastCacheWriteError = null;
    lastRefreshError = null;

    void clearServerDocument()
        .then(() => {
            lastCacheStorage = null;
            lastServerBackend = null;
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

    if (!cached && !inflightServerRead) {
        void primeFeaturedContentCacheStatus();
    }

    return {
        createdAt: cached?.createdAt || null,
        expiresAt: cached?.expiresAt || null,
        heroCount: cached?.payload.heroItems.length || 0,
        isStored: lastCacheStorage === 'plugin' || lastCacheStorage === 'named-config',
        isFresh: Boolean(cached && now < cached.expiresAt),
        itemCount: cached ? getPayloadItemCount(cached.payload) : 0,
        sectionCount: cached ? Object.keys(cached.payload.sectionItems).length : 0,
        storage: lastCacheStorage || 'none',
        readError: lastCacheReadError,
        readInProgress: Boolean(inflightServerRead),
        writeError: lastCacheWriteError,
        lastRefreshDurationMs,
        lastRefreshError,
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
