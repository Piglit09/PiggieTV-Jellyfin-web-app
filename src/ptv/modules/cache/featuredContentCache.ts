import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from '../../../utils/events';

import { PTV_CACHE, PTV_EVENTS } from '../../core/config';
import { dispatchPtvCustomEvent } from '../../core/events';
import { ptvLogger } from '../../core/logger';
import { recordPtvEvent, registerPtvDebugCacheStatusProvider, timePtvAsync } from '../../core/observability';
import { getCurrentPtvPluginApiClient, normalizePtvApiError, recordPtvPluginApiRetryState } from '../../core/pluginApi';
import { ptvSafeConsole } from '../../core/safeConsole';
import { getRuntimeScope } from '../../core/scope';
import { getPtvAuthenticatedDisplayIdentityKey } from '../../services/displayIdentity';
import { observeConfiguredRowAuthority, readConfiguredPresentationAuthority, retireConfiguredRowFreshness } from '../../pages/home/configuredRowFreshness';
import {
    summarizeFeaturedContentPayload,
    type FeaturedContentSemanticSummary
} from './featuredContentSemantics';

export const FEATURED_CACHE_VERSION = PTV_CACHE.featuredContentVersion;
export const FEATURED_CACHE_UPDATED_EVENT = PTV_EVENTS.featuredCacheUpdated;

const DEFAULT_FEATURED_CACHE_TTL_MS = PTV_CACHE.featuredContentTtlMs;
const MIN_FEATURED_CACHE_TTL_MS = PTV_CACHE.minFeaturedContentTtlMs;
const MAX_FEATURED_CACHE_TTL_MS = PTV_CACHE.maxFeaturedContentTtlMs;
const SERVER_CACHE_DOCUMENT_VERSION = 1;
const SUPPORTED_FEATURED_CACHE_VERSIONS: number[] = [FEATURED_CACHE_VERSION];

export type FeaturedPayload = {
    currentPresentationAuthority?: unknown;
    emptyLibraryConfirmed?: boolean;
    generationState?: string;
    heroItems: unknown[];
    payloadClassification?: string;
    recommendationConfigHash?: string;
    rowConfigApplied?: boolean;
    rowConfigHash?: string;
    rowConfigVersion?: number;
    rowDiagnostics?: unknown[];
    sections?: unknown[];
    sectionItems: Record<string, unknown[]>;
};

type FeaturedPayloadRowSourceSummary = {
    configuredRowCount: number;
    fallbackRowCount: number;
    recommendationRowCount: number;
    skippedRows: Array<{
        reason: string;
        rowId: string;
        rowTitle: string;
        rowType: string;
    }>;
    totalRenderedRowCount: number;
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

type PtvAbortControllerLike = {
    abort: () => void;
    signal: AbortSignal;
};

type FeaturedCacheIdentityOwner = Readonly<{
    generation: number;
    key: string;
}>;

type FeaturedCacheAdoptionResult =
    | 'adopted'
    | 'empty'
    | 'none'
    | 'preserved-memory'
    | 'rejected';

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
let lastServerCacheAdoptionResult: FeaturedCacheAdoptionResult = 'none';
let lastServerCacheRejectionReason: string | null = null;
let lastServerCacheRawByteSize: number | null = null;
let lastServerCacheRawTopLevelKeys: string[] = [];
let lastServerCacheNormalizedTopLevelKeys: string[] = [];
let lastServerCacheRenderSource = 'none';
let lastServerCacheDetectedVersion: number | null = null;
let lastServerCachePayloadSummary: FeaturedContentSemanticSummary | null = null;
let initialCachePrimeScheduled = false;
let serverReadRetryBackoffMs = 0;
let serverReadRetryCount = 0;
let nextServerReadAllowedAt = 0;
let startupPrimeAttemptCount = 0;
let activeFeaturedCacheIdentityKey: string | null = null;
let featuredCacheIdentityGeneration = 0;

const FEATURED_CACHE_PRIME_DELAYS = [300, 1200, 3200, 8000, 15000];
const MAX_SERVER_READ_RETRY_COUNT = 5;
const SERVER_READ_BACKOFF_BASE_MS = 1000;
const SERVER_READ_BACKOFF_MAX_MS = 5 * 60 * 1000;
const SERVER_EMPTY_READ_SUPPRESSION_MS = 30000;
const SERVER_CACHE_READ_TIMEOUT_MS = 12000;
const SERVER_STATUS_READ_TIMEOUT_MS = 6000;
const PLUGIN_STATUS_CACHE_MS = 30000;
const featuredCacheScope = getRuntimeScope('featured-cache');

function createFeaturedCacheIdentityError(message = 'The authenticated Featured cache identity is unavailable.') {
    return Object.assign(new Error(message), {
        code: 'PTV_FEATURED_CACHE_IDENTITY_UNAVAILABLE'
    });
}

function createRetiredFeaturedCacheOwnerError() {
    const error = new Error('The Featured cache identity owner was retired.');

    error.name = 'AbortError';
    return error;
}

function readCurrentFeaturedCacheIdentityKey() {
    const apiClient = getCurrentApiClient() as null | {
        getCurrentUserId?: () => string | null | undefined;
        serverId?: () => string | null | undefined;
        serverInfo?: () => { Id?: string | null } | null | undefined;
    };

    return getPtvAuthenticatedDisplayIdentityKey(apiClient);
}

function resetFeaturedCacheIdentityState() {
    inflightFeaturedContent = null;
    inflightServerRead = null;
    inflightPluginStatus = null;
    lastFeaturedContentFetcher = null;
    lastPluginStatus = null;
    lastPluginStatusReadAt = 0;
    memoryCacheEntry = null;
    memoryCacheSettings = {};
    lastCacheStorage = null;
    lastCacheWriteError = null;
    lastCacheReadError = null;
    lastRefreshDurationMs = null;
    lastRefreshError = null;
    lastServerCacheAdoptionResult = 'none';
    lastServerCacheRejectionReason = null;
    lastServerCacheRawByteSize = null;
    lastServerCacheRawTopLevelKeys = [];
    lastServerCacheNormalizedTopLevelKeys = [];
    lastServerCacheRenderSource = 'none';
    lastServerCacheDetectedVersion = null;
    lastServerCachePayloadSummary = null;
    serverReadRetryBackoffMs = 0;
    serverReadRetryCount = 0;
    nextServerReadAllowedAt = 0;
    startupPrimeAttemptCount = 0;
}

function retireActiveFeaturedCacheIdentity() {
    retireConfiguredRowFreshness('featured-cache-identity-retired');
    featuredCacheIdentityGeneration += 1;
    activeFeaturedCacheIdentityKey = null;
    resetFeaturedCacheIdentityState();
}

function requireCurrentFeaturedCacheOwner(): FeaturedCacheIdentityOwner {
    const key = readCurrentFeaturedCacheIdentityKey();

    if (!key) {
        if (activeFeaturedCacheIdentityKey) retireActiveFeaturedCacheIdentity();
        throw createFeaturedCacheIdentityError();
    }

    if (key !== activeFeaturedCacheIdentityKey) {
        // Initial cache ownership is not a transition away from a verified identity.
        if (activeFeaturedCacheIdentityKey) retireConfiguredRowFreshness('featured-cache-identity-changed');
        featuredCacheIdentityGeneration += 1;
        resetFeaturedCacheIdentityState();
        activeFeaturedCacheIdentityKey = key;
    }

    return Object.freeze({
        generation: featuredCacheIdentityGeneration,
        key
    });
}

function isFeaturedCacheOwnerCurrent(owner: FeaturedCacheIdentityOwner) {
    return owner.generation === featuredCacheIdentityGeneration
        && owner.key === activeFeaturedCacheIdentityKey
        && owner.key === readCurrentFeaturedCacheIdentityKey();
}

function assertFeaturedCacheOwnerCurrent(owner: FeaturedCacheIdentityOwner) {
    if (!isFeaturedCacheOwnerCurrent(owner)) {
        throw createRetiredFeaturedCacheOwnerError();
    }
}

function resolveForFeaturedCacheOwner<T>(owner: FeaturedCacheIdentityOwner, value: T) {
    return Promise.resolve().then(() => {
        assertFeaturedCacheOwnerCurrent(owner);
        return value;
    });
}

const CACHE_ITEM_FIELDS = new Set([
    'Album',
    'AlbumArtist',
    'AlbumArtists',
    'AlbumId',
    'AlbumPrimaryImageItemId',
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
    'Width'
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
        ptvSafeConsole.debug(`[PTV Featured Cache] ${message}`, detail);
    }
}

function getCurrentApiClient() {
    const connections = ServerConnections as unknown as {
        getApiClient?: (serverId: string) => ReturnType<typeof ServerConnections.currentApiClient>;
        getLastUsedServer?: () => { Id?: unknown } | null;
        getLocalApiClient?: () => ReturnType<typeof ServerConnections.currentApiClient>;
    };

    try {
        const localApiClient = connections.getLocalApiClient?.();

        if (localApiClient) return localApiClient;

        const serverId = connections.getLastUsedServer?.()?.Id;

        if (typeof serverId !== 'string' || !serverId.trim()) {
            debugLog('startup cache probe deferred: selected server is not ready');
            return null;
        }

        return connections.getApiClient?.(serverId) || null;
    } catch (error) {
        debugLog('startup cache probe deferred: server context is unstable', error);
        return null;
    }
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

function stableStringifyForHash(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringifyForHash).join(',')}]`;
    }

    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort((first, second) => first.localeCompare(second))
            .map(key => `${JSON.stringify(key)}:${stableStringifyForHash(value[key])}`)
            .join(',')}}`;
    }

    return JSON.stringify(value) ?? 'null';
}

export function getPtvFeaturedRowConfigHash(value: unknown) {
    const text = stableStringifyForHash(value);
    let hash = 5381;

    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash * 33) + text.charCodeAt(index)) % 2147483647;
    }

    return String(hash);
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

function coerceFiniteNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;

    if (typeof value === 'string' && value.trim()) {
        const parsedValue = Number(value);

        return Number.isFinite(parsedValue) ? parsedValue : null;
    }

    return null;
}

function coerceVersion(value: unknown) {
    const parsedValue = coerceFiniteNumber(value);

    return parsedValue === null ? null : Math.round(parsedValue);
}

function getPayloadField(payload: unknown, ...keys: string[]) {
    return isRecord(payload) ? getRecordField(payload, ...keys) : undefined;
}

function normalizePresentationAuthority(payload: FeaturedPayload | Record<string, unknown>) {
    // Do not canonicalize malformed/case-ambiguous proof into a valid cached envelope.
    return readConfiguredPresentationAuthority(payload) || undefined;
}

function normalizePayload(payload: FeaturedPayload | Record<string, unknown>): FeaturedPayload {
    const emptyLibraryConfirmed = getPayloadField(payload, 'emptyLibraryConfirmed', 'EmptyLibraryConfirmed');
    const generationState = getPayloadField(payload, 'generationState', 'GenerationState');
    const heroItems = getPayloadField(payload, 'heroItems', 'HeroItems');
    const payloadClassification = getPayloadField(payload, 'payloadClassification', 'PayloadClassification');
    const recommendationConfigHash = getPayloadField(payload, 'recommendationConfigHash', 'RecommendationConfigHash');
    const rowConfigApplied = getPayloadField(payload, 'rowConfigApplied', 'RowConfigApplied');
    const rowConfigHash = getPayloadField(payload, 'rowConfigHash', 'RowConfigHash');
    const rowConfigVersion = getPayloadField(payload, 'rowConfigVersion', 'RowConfigVersion');
    const rowDiagnostics = getPayloadField(payload, 'rowDiagnostics', 'RowDiagnostics');
    const sections = getPayloadField(payload, 'sections', 'Sections');
    const sectionItems = getPayloadField(payload, 'sectionItems', 'SectionItems');

    return {
        currentPresentationAuthority: normalizePresentationAuthority(payload),
        emptyLibraryConfirmed: emptyLibraryConfirmed === true ? true : undefined,
        generationState: typeof generationState === 'string' && generationState.trim() ? generationState.trim() : undefined,
        heroItems: Array.isArray(heroItems) ? heroItems : [],
        payloadClassification: typeof payloadClassification === 'string' && payloadClassification.trim() ? payloadClassification.trim() : undefined,
        recommendationConfigHash: typeof recommendationConfigHash === 'string' && recommendationConfigHash.trim() ? recommendationConfigHash.trim() : undefined,
        rowConfigApplied: typeof rowConfigApplied === 'boolean' ? rowConfigApplied : undefined,
        rowConfigHash: typeof rowConfigHash === 'string' && rowConfigHash.trim() ? rowConfigHash.trim() : undefined,
        rowConfigVersion: typeof rowConfigVersion === 'number' ? rowConfigVersion : undefined,
        rowDiagnostics: Array.isArray(rowDiagnostics) ? rowDiagnostics : [],
        sections: Array.isArray(sections) ? sections : [],
        sectionItems: normalizeSectionItems(sectionItems)
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

const SHARED_PAYLOAD_USER_FIELDS = new Set([
    'PtvHeroRecommendationLabel',
    'PtvRecommendationExplanation',
    'RecommendationReason',
    'UserData'
]);

function sanitizeSharedPayloadValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sanitizeSharedPayloadValue);
    if (!isRecord(value)) return value;

    return Object.keys(value).reduce<Record<string, unknown>>((sanitized, key) => {
        if (!SHARED_PAYLOAD_USER_FIELDS.has(key)) {
            sanitized[key] = sanitizeSharedPayloadValue(value[key]);
        }

        return sanitized;
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
        currentPresentationAuthority: normalizedPayload.currentPresentationAuthority,
        emptyLibraryConfirmed: normalizedPayload.emptyLibraryConfirmed,
        generationState: normalizedPayload.generationState,
        heroItems: normalizedPayload.heroItems.map(compactCacheItem),
        payloadClassification: normalizedPayload.payloadClassification,
        recommendationConfigHash: normalizedPayload.recommendationConfigHash,
        rowConfigApplied: normalizedPayload.rowConfigApplied,
        rowConfigHash: normalizedPayload.rowConfigHash,
        rowConfigVersion: normalizedPayload.rowConfigVersion,
        rowDiagnostics: sanitizeSharedPayloadValue(normalizedPayload.rowDiagnostics) as unknown[],
        sections: sanitizeSharedPayloadValue(normalizedPayload.sections) as unknown[],
        sectionItems: Object.keys(normalizedPayload.sectionItems).reduce<Record<string, unknown[]>>(
            (sectionItems, sectionId) => {
                sectionItems[sectionId] = normalizedPayload.sectionItems[sectionId].map(compactCacheItem);

                return sectionItems;
            },
            {}
        )
    };
}

export function sanitizeFeaturedPayloadForSharedCache(payload: FeaturedPayload) {
    return compactPayload(payload);
}

function getPayloadItemCount(payload: FeaturedPayload) {
    return Object.keys(payload.sectionItems).reduce((count, sectionId) => {
        const items = payload.sectionItems[sectionId];

        return count + items.length;
    }, 0);
}

function getPayloadRecordString(value: unknown, ...keys: string[]) {
    if (!isRecord(value)) return '';

    for (const key of keys) {
        const candidate = value[key];

        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }

    return '';
}

function getSectionId(section: unknown) {
    return getPayloadRecordString(section, 'id', 'Id', 'key', 'Key', 'sectionId', 'SectionId');
}

function getPayloadRecordNumber(value: unknown, ...keys: string[]) {
    if (!isRecord(value)) return null;

    for (const key of keys) {
        const candidate = value[key];

        if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    }

    return null;
}

function getSectionItemCount(section: unknown, sectionItems: Record<string, unknown[]>) {
    const sectionId = getSectionId(section);
    const explicitCount = getPayloadRecordNumber(section, 'itemCount', 'ItemCount');

    if (explicitCount !== null && explicitCount > 0) return explicitCount;
    if (sectionId && Array.isArray(sectionItems[sectionId])) return sectionItems[sectionId].length;
    if (isRecord(section) && Array.isArray(section.items)) return section.items.length;
    if (explicitCount !== null) return explicitCount;

    return 0;
}

function getSectionRowType(section: unknown) {
    const explicitType = getPayloadRecordString(section, 'rowType', 'RowType');

    if (explicitType) return explicitType;

    const sourceType = getPayloadRecordString(section, 'sourceType', 'SourceType').toLowerCase();
    const sectionType = getPayloadRecordString(section, 'type', 'Type').toLowerCase();

    if (sourceType === 'recommendation' || sectionType === 'recommendation') return 'generated-recommendation';
    if (sourceType === 'legacy') return 'fallback';

    return 'configured-rule';
}

function getPayloadRowSourceSummary(payload: FeaturedPayload | null | undefined): FeaturedPayloadRowSourceSummary {
    const normalizedPayload = payload ? normalizePayload(payload) : null;
    const sections = normalizedPayload?.sections || [];
    const sectionItems = normalizedPayload?.sectionItems || {};
    const renderedSections = sections.length ?
        sections :
        Object.keys(sectionItems).map(sectionId => ({
            id: sectionId,
            itemCount: sectionItems[sectionId]?.length || 0,
            rowType: 'fallback',
            title: sectionId
        }));
    const counts = renderedSections.reduce<FeaturedPayloadRowSourceSummary>(
        (summary, section) => {
            const rowType = getSectionRowType(section);
            const itemCount = getSectionItemCount(section, sectionItems);

            if (itemCount <= 0) return summary;

            if (rowType === 'generated-recommendation') summary.recommendationRowCount += 1;
            else if (rowType === 'fallback') summary.fallbackRowCount += 1;
            else summary.configuredRowCount += 1;

            summary.totalRenderedRowCount += 1;

            return summary;
        },
        {
            configuredRowCount: 0,
            fallbackRowCount: 0,
            recommendationRowCount: 0,
            skippedRows: [] as FeaturedPayloadRowSourceSummary['skippedRows'],
            totalRenderedRowCount: 0
        }
    );
    const skippedRows = (normalizedPayload?.rowDiagnostics || [])
        .filter(diagnostic => getPayloadRecordString(diagnostic, 'dropReason', 'DropReason'))
        .map(diagnostic => ({
            reason: getPayloadRecordString(diagnostic, 'dropReason', 'DropReason'),
            rowId: getPayloadRecordString(diagnostic, 'rowId', 'RowId'),
            rowTitle: getPayloadRecordString(diagnostic, 'rowTitle', 'RowTitle'),
            rowType: getSectionRowType(diagnostic)
        }));

    return {
        ...counts,
        skippedRows
    };
}

function getPayloadSummary(payload: FeaturedPayload | null | undefined) {
    const rowSourceSummary = getPayloadRowSourceSummary(payload);
    const semanticSummary = summarizeFeaturedContentPayload(payload);

    return {
        ...semanticSummary,
        configuredRowCount: rowSourceSummary.configuredRowCount,
        fallbackRowCount: rowSourceSummary.fallbackRowCount,
        heroCount: payload?.heroItems.length || 0,
        itemCount: payload ? getPayloadItemCount(payload) : 0,
        recommendationRowCount: rowSourceSummary.recommendationRowCount,
        sectionCount: payload ? Object.keys(payload.sectionItems).length : 0,
        skippedRows: rowSourceSummary.skippedRows,
        totalRenderedRowCount: rowSourceSummary.totalRenderedRowCount
    };
}

function getDocumentPayloadSummary(document: FeaturedServerCacheDocument) {
    const entry = parseCacheEntryValue(document.featuredContent);

    return {
        ...getPayloadSummary(entry?.payload),
        hasFeaturedContent: Boolean(entry),
        updatedAt: document.updatedAt ?? null
    };
}

function getSerializedByteSize(value: unknown) {
    try {
        return JSON.stringify(value).length;
    } catch {
        return 0;
    }
}

function getTopLevelKeys(value: unknown) {
    return isRecord(value) ? Object.keys(value).slice(0, 32) : [];
}

function isSupportedFeaturedCacheVersion(value: unknown): value is number {
    const version = coerceVersion(value);

    return version !== null && SUPPORTED_FEATURED_CACHE_VERSIONS.includes(version);
}

function getCacheEntryVersion(value: unknown) {
    if (!isRecord(value)) return null;

    return coerceVersion(getRecordField(value, 'version', 'Version', 'cacheVersion', 'CacheVersion'));
}

function hasLegacyFeaturedCacheShape(payload: unknown) {
    return isRecord(payload)
        && Array.isArray(getPayloadField(payload, 'heroItems', 'HeroItems'))
        && isRecord(getPayloadField(payload, 'sectionItems', 'SectionItems'));
}

function explainCacheEntryRejection(value: unknown) {
    if (value === undefined) return 'missing-featured-content';
    if (value === null) return 'empty-featured-content';
    if (!isRecord(value)) return 'featured-content-not-object';
    const payload = getRecordField(value, 'payload', 'Payload');
    const version = getRecordField(value, 'version', 'Version', 'cacheVersion', 'CacheVersion');

    if (!isSupportedFeaturedCacheVersion(version) && !(coerceVersion(version) === null && hasLegacyFeaturedCacheShape(payload))) return 'unsupported-cache-version';
    if (coerceFiniteNumber(getRecordField(value, 'createdAt', 'CreatedAt')) === null) return 'missing-created-at';
    if (coerceFiniteNumber(getRecordField(value, 'expiresAt', 'ExpiresAt')) === null) return 'missing-expires-at';
    if (!isRecord(payload)) return 'missing-payload';

    return 'unknown-cache-entry-rejection';
}

function explainServerDocumentRejection(rawDocument: unknown) {
    if (!isRecord(rawDocument)) return 'server-response-not-object';
    if (!getTopLevelKeys(rawDocument).length) return 'empty-object-response';

    const document = getServerDocumentSource(rawDocument);
    if (!document) return 'missing-cache-document';

    const featuredContent = getRecordField(document, 'featuredContent', 'FeaturedContent');

    return explainCacheEntryRejection(featuredContent);
}

function getErrorMessage(err: unknown) {
    const normalizedError = normalizePtvApiError(err);

    if (normalizedError.message !== 'Unknown plugin API error') {
        return normalizedError.message;
    }

    return err instanceof Error ? err.message : 'Unable to store featured cache.';
}

function createPluginTimeoutError(message: string) {
    return Object.assign(new Error(message), {
        code: 'PTV_PLUGIN_TIMEOUT'
    });
}

function runPluginRequestWithTimeout<T>(
    task: (signal?: AbortSignal) => Promise<T>,
    timeoutMs: number,
    message: string
) {
    let timeoutId = 0;
    const AbortControllerCtor = (window as unknown as {
        AbortController?: new () => PtvAbortControllerLike;
    }).AbortController;
    const controller = AbortControllerCtor ? new AbortControllerCtor() : null;
    const timeout = new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
            controller?.abort();
            reject(createPluginTimeoutError(message));
        }, timeoutMs);
    });

    return Promise.race([
        task(controller?.signal),
        timeout
    ]).finally(() => {
        window.clearTimeout(timeoutId);
    });
}

function mergePayload(payload: FeaturedPayload, fallbackPayload?: FeaturedPayload): FeaturedPayload {
    const normalizedPayload = normalizePayload(payload);

    if (!fallbackPayload) return normalizedPayload;

    const normalizedFallbackPayload = normalizePayload(fallbackPayload);
    const primaryAuthority = normalizePresentationAuthority(normalizedPayload);
    const fallbackAuthority = normalizePresentationAuthority(normalizedFallbackPayload);
    const matchingAuthority = primaryAuthority && fallbackAuthority
        && primaryAuthority.scope === fallbackAuthority.scope
        && primaryAuthority.generation === fallbackAuthority.generation;
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
        // Mixed/fallback-derived content cannot inherit one side's presentation proof.
        currentPresentationAuthority: matchingAuthority ? primaryAuthority : undefined,
        heroItems: normalizedPayload.heroItems.length ?
            normalizedPayload.heroItems :
            normalizedFallbackPayload.heroItems,
        recommendationConfigHash: normalizedPayload.recommendationConfigHash || normalizedFallbackPayload.recommendationConfigHash,
        rowConfigApplied: normalizedPayload.rowConfigApplied ?? normalizedFallbackPayload.rowConfigApplied,
        rowConfigHash: normalizedPayload.rowConfigHash || normalizedFallbackPayload.rowConfigHash,
        rowConfigVersion: normalizedPayload.rowConfigVersion ?? normalizedFallbackPayload.rowConfigVersion,
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

    const version = getCacheEntryVersion(value);
    const createdAt = coerceFiniteNumber(getRecordField(value, 'createdAt', 'CreatedAt'));
    const expiresAt = coerceFiniteNumber(getRecordField(value, 'expiresAt', 'ExpiresAt'));
    const payload = getRecordField(value, 'payload', 'Payload');

    if (!isSupportedFeaturedCacheVersion(version) && !(version === null && hasLegacyFeaturedCacheShape(payload))) return null;
    if (createdAt === null) return null;
    if (expiresAt === null) return null;
    if (!isRecord(payload)) return null;

    return {
        version: FEATURED_CACHE_VERSION,
        createdAt,
        expiresAt,
        payload: compactPayload(normalizePayload(payload))
    };
}

function parseCacheSettings(value: unknown): FeaturedCacheSettings {
    if (!isRecord(value)) return {};

    return {
        ttlMs: typeof value.ttlMs === 'number' ? clampTtlMs(value.ttlMs) : undefined
    };
}

function getRecordField(source: Record<string, unknown>, ...keys: string[]) {
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            return source[key];
        }
    }

    return undefined;
}

function getServerDocumentSource(value: unknown) {
    if (!isRecord(value)) return null;

    const directSettings = getRecordField(value, 'featuredContentSettings', 'FeaturedContentSettings');
    const directUpdatedAt = getRecordField(value, 'updatedAt', 'UpdatedAt');
    const nestedDocument = getRecordField(value, 'document', 'Document');
    const storeStatus = getRecordField(value, 'storeStatus', 'StoreStatus');
    const hasFeaturedContentField =
        Object.prototype.hasOwnProperty.call(value, 'featuredContent')
        || Object.prototype.hasOwnProperty.call(value, 'FeaturedContent');
    const hasSettingsField =
        Object.prototype.hasOwnProperty.call(value, 'featuredContentSettings')
        || Object.prototype.hasOwnProperty.call(value, 'FeaturedContentSettings');
    const hasUpdatedAtField =
        Object.prototype.hasOwnProperty.call(value, 'updatedAt')
        || Object.prototype.hasOwnProperty.call(value, 'UpdatedAt');

    if (isRecord(nestedDocument)) return nestedDocument;
    if (isRecord(storeStatus)) {
        const storeDocument = getRecordField(storeStatus, 'document', 'Document');

        if (isRecord(storeDocument)) return storeDocument;
    }

    const isDocumentLike = hasFeaturedContentField
        || (hasSettingsField && isRecord(directSettings))
        || (hasUpdatedAtField && typeof directUpdatedAt === 'number');

    return isDocumentLike ? value : null;
}

function normalizeServerDocument(value: unknown): FeaturedServerCacheDocument {
    const document = getServerDocumentSource(value);

    if (!document) {
        return {
            version: SERVER_CACHE_DOCUMENT_VERSION
        };
    }

    const featuredContent = getRecordField(document, 'featuredContent', 'FeaturedContent');
    const featuredContentSettings = getRecordField(document, 'featuredContentSettings', 'FeaturedContentSettings');
    const updatedAt = getRecordField(document, 'updatedAt', 'UpdatedAt');

    return {
        ...document,
        version: SERVER_CACHE_DOCUMENT_VERSION,
        featuredContent: parseCacheEntryValue(featuredContent),
        featuredContentSettings: parseCacheSettings(featuredContentSettings),
        updatedAt: typeof updatedAt === 'number' ? updatedAt : undefined
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

function readPluginStatusForCache(owner: FeaturedCacheIdentityOwner) {
    assertFeaturedCacheOwnerCurrent(owner);

    if (lastPluginStatus && Date.now() - lastPluginStatusReadAt < PLUGIN_STATUS_CACHE_MS) {
        return resolveForFeaturedCacheOwner(owner, lastPluginStatus);
    }

    if (inflightPluginStatus) return inflightPluginStatus;

    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi) {
        return resolveForFeaturedCacheOwner(owner, null);
    }

    const statusRequest = runPluginRequestWithTimeout(
        signal => pluginApi.getStatus<PtvPluginStatusForCache>({ signal }),
        SERVER_STATUS_READ_TIMEOUT_MS,
        'PiggieTV plugin status request timed out.'
    )
        .then(status => {
            assertFeaturedCacheOwnerCurrent(owner);
            lastPluginStatus = status;
            lastPluginStatusReadAt = Date.now();

            return status;
        })
        .catch((err: unknown) => {
            if (!isFeaturedCacheOwnerCurrent(owner)) throw createRetiredFeaturedCacheOwnerError();

            debugLog('plugin status unavailable for cache capability check', err);
            lastPluginStatus = null;
            lastPluginStatusReadAt = Date.now();

            return null;
        })
        .finally(() => {
            if (isFeaturedCacheOwnerCurrent(owner) && inflightPluginStatus === statusRequest) {
                inflightPluginStatus = null;
            }
        });

    inflightPluginStatus = statusRequest;
    return statusRequest;
}

function recordPluginCacheCapabilities(status: PtvPluginStatusForCache | null) {
    const isFeaturedContentAdvertised = hasPluginFeature(status, 'featuredContent');
    const hasStatusCapabilities = Boolean(
        status
        && (
            status.featureFlags
            || status.features
        )
    );

    recordPtvEvent('cache', 'featured-cache-feature-advertised', {
        featureFlagKeys: status?.featureFlags ? Object.keys(status.featureFlags) : [],
        features: Array.isArray(status?.features) ? status.features : Object.keys(status?.features || {}),
        hasStatusCapabilities,
        isFeaturedContentAdvertised,
        statusOk: status?.ok ?? null
    });

    if (hasStatusCapabilities && !isFeaturedContentAdvertised) {
        recordPtvEvent('cache', 'featured-cache-feature-not-advertised', {
            action: 'try-featured-directly',
            featureFlagKeys: status?.featureFlags ? Object.keys(status.featureFlags) : [],
            features: Array.isArray(status?.features) ? status.features : Object.keys(status?.features || {}),
            statusOk: status?.ok ?? null
        });
    }

    if (!hasStatusCapabilities) {
        recordPtvEvent('cache', 'featured-cache-status-unavailable', {
            action: 'try-featured-directly'
        });
    }
}

function readPluginDocument(owner: FeaturedCacheIdentityOwner) {
    assertFeaturedCacheOwnerCurrent(owner);
    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi) {
        return Promise.reject(new Error('PTV plugin API client is unavailable.'));
    }

    // Status is diagnostic only: the cache endpoint is attempted regardless of
    // the advertised capability. Do not serialize these independent requests.
    void readPluginStatusForCache(owner)
        .then(status => {
            if (isFeaturedCacheOwnerCurrent(owner)) recordPluginCacheCapabilities(status);
        })
        .catch(() => undefined);

    return runPluginRequestWithTimeout(
        signal => pluginApi.getFeaturedContentCacheDocument({ signal }),
        SERVER_CACHE_READ_TIMEOUT_MS,
        'PiggieTV featured cache read timed out.'
    )
        .then(document => {
            assertFeaturedCacheOwnerCurrent(owner);
            const rawResponseByteSize = getSerializedByteSize(document);
            const rawTopLevelKeys = getTopLevelKeys(document);
            const normalizedDocument = normalizeServerDocument(document);
            const entry = parseCacheEntryValue(normalizedDocument.featuredContent);
            // A newly received response can retire CURRENT even when this read is
            // only persistence readback. Its captured identity was checked above.
            observeConfiguredRowAuthority(readConfiguredPresentationAuthority(entry?.payload));
            const normalizedTopLevelKeys = getTopLevelKeys(normalizedDocument);
            const rejectionReason = entry ? null : explainServerDocumentRejection(document);

            lastServerCacheRawByteSize = rawResponseByteSize;
            lastServerCacheRawTopLevelKeys = rawTopLevelKeys;
            lastServerCacheNormalizedTopLevelKeys = normalizedTopLevelKeys;
            lastServerCacheRejectionReason = rejectionReason;

            recordPtvEvent('cache', 'featured-cache-document-read', {
                cacheVersion: entry?.version ?? null,
                hasFeaturedContent: Boolean(entry),
                heroCount: entry?.payload.heroItems.length || 0,
                itemCount: entry ? getPayloadItemCount(entry.payload) : 0,
                normalizedTopLevelKeys,
                payloadSize: getSerializedByteSize(normalizedDocument.featuredContent),
                rawResponseByteSize,
                rawTopLevelKeys,
                rejectionReason,
                sectionCount: entry ? Object.keys(entry.payload.sectionItems).length : 0,
                storage: getSuccessfulServerStorage(),
                updatedAt: normalizedDocument.updatedAt ?? null
            });

            return normalizedDocument;
        })
        .catch((error: unknown) => {
            if (!isFeaturedCacheOwnerCurrent(owner)) throw createRetiredFeaturedCacheOwnerError();
            observeConfiguredRowAuthority(null);
            throw error;
        });
}

function writePluginDocument(owner: FeaturedCacheIdentityOwner, nextDocument: FeaturedServerCacheDocument) {
    assertFeaturedCacheOwnerCurrent(owner);
    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi) {
        return Promise.reject(new Error('PTV plugin API client is unavailable.'));
    }

    return pluginApi.writeFeaturedContentCacheDocument({
        ...nextDocument,
        version: SERVER_CACHE_DOCUMENT_VERSION,
        updatedAt: Date.now()
    }).then(result => {
        assertFeaturedCacheOwnerCurrent(owner);
        return result;
    });
}

function clearPluginDocument(owner: FeaturedCacheIdentityOwner) {
    assertFeaturedCacheOwnerCurrent(owner);
    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi?.clearFeaturedContentCacheDocument) {
        return Promise.reject(new Error('PTV plugin cache clear endpoint is unavailable.'));
    }

    return pluginApi.clearFeaturedContentCacheDocument()
        .then(result => {
            assertFeaturedCacheOwnerCurrent(owner);
            return result;
        });
}

function readServerDocument(owner: FeaturedCacheIdentityOwner) {
    return readPluginDocument(owner)
        .then(document => document);
}

function canReadServerCacheNow() {
    return Date.now() >= nextServerReadAllowedAt;
}

function getServerCacheReplacementRejection(
    nextEntry: FeaturedCacheEntry | null,
    previousEntry: FeaturedCacheEntry | null
) {
    if (!nextEntry) return null;

    const nextSummary = summarizeFeaturedContentPayload(nextEntry.payload);

    if (!nextSummary.usableForPersistence) return nextSummary.reason;
    if (!previousEntry) return null;

    const previousSummary = summarizeFeaturedContentPayload(previousEntry.payload);

    if (previousSummary.totalItemCount > 0 && nextSummary.totalItemCount === 0) {
        return 'semantic-empty-cannot-replace-populated';
    }

    return nextEntry.createdAt < previousEntry.createdAt ? 'older-than-memory-cache' : null;
}

function noteServerReadSuccess(hasCache: boolean) {
    serverReadRetryBackoffMs = 0;
    serverReadRetryCount = 0;
    nextServerReadAllowedAt = hasCache ? 0 : Date.now() + SERVER_EMPTY_READ_SUPPRESSION_MS;
    recordPtvPluginApiRetryState(serverReadRetryCount, serverReadRetryBackoffMs);
}

function applyServerCacheDocument(
    owner: FeaturedCacheIdentityOwner,
    document: unknown,
    source: string
) {
    assertFeaturedCacheOwnerCurrent(owner);
    const normalizedDocument = normalizeServerDocument(document);
    const previousEntry = memoryCacheEntry;
    const rawDocumentSource = isRecord(document) ? getServerDocumentSource(document) : null;
    const rawFeaturedContent = rawDocumentSource ? getRecordField(rawDocumentSource, 'featuredContent', 'FeaturedContent') : undefined;
    const detectedVersion = getCacheEntryVersion(rawFeaturedContent);
    const nextEntry = parseCacheEntryValue(normalizedDocument.featuredContent);
    // Hydration also receives ordinary new responses. Rejected replacements must
    // not silently preserve CURRENT merely because their old content survives.
    observeConfiguredRowAuthority(readConfiguredPresentationAuthority(nextEntry?.payload));
    const nextPayloadSummary = nextEntry ? summarizeFeaturedContentPayload(nextEntry.payload) : null;
    const rejectionReason = getServerCacheReplacementRejection(nextEntry, previousEntry)
        || (nextEntry ? null : explainServerDocumentRejection(document));

    memoryCacheSettings = parseCacheSettings(normalizedDocument.featuredContentSettings);
    lastServerCacheRawByteSize = getSerializedByteSize(document);
    lastServerCacheRawTopLevelKeys = getTopLevelKeys(document);
    lastServerCacheNormalizedTopLevelKeys = getTopLevelKeys(normalizedDocument);
    lastServerCacheRejectionReason = rejectionReason;
    lastServerCacheRenderSource = source;
    lastServerCacheDetectedVersion = detectedVersion;
    lastServerCachePayloadSummary = nextPayloadSummary;

    if (nextEntry && !rejectionReason) {
        memoryCacheEntry = nextEntry;
        lastCacheStorage = getSuccessfulServerStorage();
        lastCacheReadError = null;
        lastServerCacheAdoptionResult = 'adopted';
    } else if (previousEntry) {
        memoryCacheEntry = previousEntry;
        lastCacheStorage = lastCacheStorage || 'memory';
        lastCacheReadError = rejectionReason;
        lastServerCacheAdoptionResult = 'preserved-memory';
    } else {
        memoryCacheEntry = null;
        lastCacheStorage = null;
        lastCacheReadError = rejectionReason && rejectionReason !== 'empty-featured-content' ? rejectionReason : null;
        lastServerCacheAdoptionResult = rejectionReason === 'empty-featured-content' ? 'empty' : 'rejected';
    }

    lastCacheWriteError = null;
    noteServerReadSuccess(Boolean(memoryCacheEntry));

    debugLog('applied server cache document', {
        adoptionResult: lastServerCacheAdoptionResult,
        hasCache: Boolean(memoryCacheEntry),
        rejectionReason,
        source,
        storage: lastCacheStorage,
        ttlMs: getFeaturedContentCacheTtlMs()
    });
    recordPtvEvent('cache', 'featured-cache-server-read-result', {
        adoptionResult: lastServerCacheAdoptionResult,
        cacheVersion: memoryCacheEntry?.version ?? null,
        detectedCacheVersion: lastServerCacheDetectedVersion,
        hasCache: Boolean(memoryCacheEntry),
        heroCount: memoryCacheEntry?.payload.heroItems.length || 0,
        itemCount: memoryCacheEntry ? getPayloadItemCount(memoryCacheEntry.payload) : 0,
        normalizedTopLevelKeys: lastServerCacheNormalizedTopLevelKeys,
        payloadSize: getSerializedByteSize(memoryCacheEntry),
        rawResponseByteSize: lastServerCacheRawByteSize,
        rawTopLevelKeys: lastServerCacheRawTopLevelKeys,
        rejectionReason,
        renderSource: lastServerCacheRenderSource,
        sectionCount: memoryCacheEntry ? Object.keys(memoryCacheEntry.payload.sectionItems).length : 0,
        source,
        storage: lastCacheStorage || 'none',
        supportedCacheVersions: SUPPORTED_FEATURED_CACHE_VERSIONS,
        ttlMs: getFeaturedContentCacheTtlMs()
    });

    return memoryCacheEntry;
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

function writeServerDocument(owner: FeaturedCacheIdentityOwner, nextDocument: FeaturedServerCacheDocument) {
    assertFeaturedCacheOwnerCurrent(owner);
    const normalizedDocument: FeaturedServerCacheDocument = {
        ...nextDocument,
        version: SERVER_CACHE_DOCUMENT_VERSION,
        updatedAt: Date.now()
    };
    const writeSummary = getDocumentPayloadSummary(normalizedDocument);
    const payloadSize = getSerializedByteSize(normalizedDocument);

    recordPtvEvent('cache', 'featured-cache-write-start', {
        ...writeSummary,
        payloadSize
    });
    return writePluginDocument(owner, normalizedDocument)
        .then(() => {
            assertFeaturedCacheOwnerCurrent(owner);
            return readPluginDocument(owner);
        })
        .then(readbackDocument => {
            assertFeaturedCacheOwnerCurrent(owner);
            const normalizedReadback = normalizeServerDocument(readbackDocument);
            const readbackSummary = getDocumentPayloadSummary(normalizedReadback);

            recordPtvEvent('cache', 'featured-cache-write-success', {
                ...readbackSummary,
                payloadSize,
                requestedHeroCount: writeSummary.heroCount,
                requestedItemCount: writeSummary.itemCount,
                requestedSectionCount: writeSummary.sectionCount
            });
            recordPtvEvent('cache', 'featured-cache-write-readback-result', {
                ...readbackSummary,
                payloadSize
            });

            return normalizedReadback;
        })
        .catch((err: unknown) => {
            recordPtvEvent('cache', 'featured-cache-write-failure', {
                ...writeSummary,
                error: getErrorMessage(err),
                payloadSize
            });
            throw err;
        });
}

function clearServerDocument(owner: FeaturedCacheIdentityOwner) {
    return clearPluginDocument(owner)
        .then(() => undefined);
}

function readServerCacheEntry(owner: FeaturedCacheIdentityOwner) {
    assertFeaturedCacheOwnerCurrent(owner);
    if (inflightServerRead) return inflightServerRead;

    if (!canReadServerCacheNow()) {
        debugLog('server cache read suppressed by backoff', {
            retryBackoffMs: serverReadRetryBackoffMs,
            retryCount: serverReadRetryCount
        });
        recordPtvEvent('cache', 'featured-cache-read-suppressed', {
            hasMemoryCache: Boolean(memoryCacheEntry),
            nextServerReadAllowedAt,
            retryBackoffMs: serverReadRetryBackoffMs,
            retryCount: serverReadRetryCount
        });

        if (memoryCacheEntry) {
            lastCacheStorage = 'memory';
        }

        return resolveForFeaturedCacheOwner(owner, memoryCacheEntry);
    }

    const serverRead = timePtvAsync('cache', 'read-server-cache', () => readServerDocument(owner))
        .then(document => {
            assertFeaturedCacheOwnerCurrent(owner);
            return applyServerCacheDocument(owner, document, 'server-read');
        })
        .catch((err: unknown) => {
            if (!isFeaturedCacheOwnerCurrent(owner)) throw createRetiredFeaturedCacheOwnerError();

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
            if (isFeaturedCacheOwnerCurrent(owner) && inflightServerRead === serverRead) {
                inflightServerRead = null;
            }
        });

    inflightServerRead = serverRead;
    return serverRead;
}

function hydrateFeaturedContentCacheFromDocument(
    owner: FeaturedCacheIdentityOwner,
    document: unknown,
    reason: string
) {
    assertFeaturedCacheOwnerCurrent(owner);
    const entry = applyServerCacheDocument(owner, document, `hydrate:${reason}`);

    recordPtvEvent('cache', 'featured-cache-memory-hydrated', {
        hasCache: Boolean(entry),
        reason
    });
    dispatchCacheUpdated();

    return entry;
}

export function createFeaturedContentCacheDocumentHydrator(reason = 'manual') {
    let owner: FeaturedCacheIdentityOwner;

    try {
        owner = requireCurrentFeaturedCacheOwner();
    } catch {
        return null;
    }

    return (document: unknown) => {
        if (!isFeaturedCacheOwnerCurrent(owner)) return null;

        return hydrateFeaturedContentCacheFromDocument(owner, document, reason);
    };
}

export function createFeaturedContentCacheIdentityGuard() {
    const identityKey = readCurrentFeaturedCacheIdentityKey();

    if (!identityKey) return null;

    return () => identityKey === readCurrentFeaturedCacheIdentityKey();
}

export function primeFeaturedContentCacheStatus() {
    let owner: FeaturedCacheIdentityOwner;

    try {
        owner = requireCurrentFeaturedCacheOwner();
    } catch {
        return Promise.resolve(null);
    }

    if (memoryCacheEntry || inflightServerRead) {
        recordPtvEvent('cache', 'status-prime-skipped', {
            hasMemoryCache: Boolean(memoryCacheEntry),
            reason: memoryCacheEntry ? 'memory-cache-present' : 'read-in-flight'
        });
        return inflightServerRead || resolveForFeaturedCacheOwner(owner, memoryCacheEntry);
    }

    if (!getCurrentApiClient() || !canReadServerCacheNow()) {
        recordPtvEvent('cache', 'status-prime-skipped', {
            hasApiClient: Boolean(getCurrentApiClient()),
            nextServerReadAllowedAt,
            reason: getCurrentApiClient() ? 'read-backoff' : 'missing-api-client',
            retryBackoffMs: serverReadRetryBackoffMs,
            retryCount: serverReadRetryCount
        });
        return Promise.resolve(null);
    }

    startupPrimeAttemptCount += 1;
    recordPtvEvent('cache', 'status-prime', {
        attempt: startupPrimeAttemptCount,
        source: 'startup'
    });

    return readServerCacheEntry(owner)
        .then(entry => {
            if (isFeaturedCacheOwnerCurrent(owner)) dispatchCacheUpdated();

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

function persistServerState(owner: FeaturedCacheIdentityOwner, entry: FeaturedCacheEntry | null) {
    assertFeaturedCacheOwnerCurrent(owner);
    return timePtvAsync('cache', 'persist-server-cache', () => readServerDocument(owner)
        .catch((err: unknown) => {
            if (!isFeaturedCacheOwnerCurrent(owner)) throw createRetiredFeaturedCacheOwnerError();

            debugLog('plugin cache read unavailable before write; using default plugin document', err);

            return getDefaultServerDocument();
        })
        .then(document => {
            assertFeaturedCacheOwnerCurrent(owner);
            return writeServerDocument(owner, {
                ...document,
                featuredContent: entry,
                featuredContentSettings: memoryCacheSettings
            });
        }));
}

export function setFeaturedContentCacheTtlMs(ttlMs: number, options: { persist?: boolean } = {}) {
    const normalizedTtlMs = clampTtlMs(ttlMs);
    const shouldPersist = options.persist !== false;
    let owner: FeaturedCacheIdentityOwner;

    try {
        owner = requireCurrentFeaturedCacheOwner();
    } catch {
        return normalizedTtlMs;
    }

    memoryCacheSettings = {
        ttlMs: normalizedTtlMs
    };
    updateMemoryCacheExpiry(normalizedTtlMs);

    if (shouldPersist) {
        void persistServerState(owner, memoryCacheEntry)
            .then(() => {
                if (!isFeaturedCacheOwnerCurrent(owner)) return;
                lastCacheStorage = memoryCacheEntry ? getSuccessfulServerStorage() : lastCacheStorage;
                lastCacheWriteError = null;
                debugLog('updated server refresh interval', { ttlMs: normalizedTtlMs });
                dispatchCacheUpdated();
            })
            .catch((err: unknown) => {
                if (!isFeaturedCacheOwnerCurrent(owner)) return;
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

function writeCacheEntry(owner: FeaturedCacheIdentityOwner, payload: FeaturedPayload) {
    assertFeaturedCacheOwnerCurrent(owner);
    const createdAt = Date.now();
    const compactPayloadValue = compactPayload(payload);
    // A mixed-generation merge intentionally has no proof. Publication cannot
    // retain configured CURRENT from either input, nor can it grant new CURRENT.
    observeConfiguredRowAuthority(readConfiguredPresentationAuthority(compactPayloadValue));
    const semanticSummary = summarizeFeaturedContentPayload(compactPayloadValue);

    if (!semanticSummary.usableForPersistence) {
        const error = `Featured content refresh rejected: ${semanticSummary.reason}.`;

        lastRefreshError = error;
        recordPtvEvent('cache', 'featured-cache-entry-write-rejected', {
            ...semanticSummary,
            reason: semanticSummary.reason
        });

        return Promise.reject(new Error(error));
    }

    const entry: FeaturedCacheEntry = {
        version: FEATURED_CACHE_VERSION,
        createdAt,
        expiresAt: createdAt + getFeaturedContentCacheTtlMs(),
        payload: compactPayloadValue
    };
    const payloadSummary = getPayloadSummary(entry.payload);
    const payloadSize = getSerializedByteSize(entry);

    memoryCacheEntry = entry;
    nextServerReadAllowedAt = 0;
    recordPtvEvent('cache', 'featured-cache-entry-write-start', {
        ...payloadSummary,
        payloadSize
    });

    return persistServerState(owner, entry)
        .then(() => {
            assertFeaturedCacheOwnerCurrent(owner);
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
            recordPtvEvent('cache', 'featured-cache-entry-write-success', {
                ...payloadSummary,
                payloadSize,
                storage: lastCacheStorage
            });
            nextServerReadAllowedAt = 0;

            return entry;
        })
        .catch((err: unknown) => {
            if (!isFeaturedCacheOwnerCurrent(owner)) throw createRetiredFeaturedCacheOwnerError();

            lastCacheStorage = 'memory';
            lastCacheWriteError = getErrorMessage(err);
            recordPtvEvent('cache', 'error', {
                error: getErrorMessage(err),
                operation: 'write'
            });
            recordPtvEvent('cache', 'featured-cache-entry-write-failure', {
                ...payloadSummary,
                error: getErrorMessage(err),
                payloadSize,
                storage: lastCacheStorage
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
    owner: FeaturedCacheIdentityOwner,
    fetcher: () => Promise<FeaturedPayload>,
    fallbackPayload?: FeaturedPayload,
    notifyOnSuccess = false
) {
    assertFeaturedCacheOwnerCurrent(owner);
    const startedAt = performance.now();

    lastRefreshError = null;

    const refreshRequest = timePtvAsync('cache', 'refresh-featured-content', fetcher)
        .then(payload => {
            assertFeaturedCacheOwnerCurrent(owner);
            observeConfiguredRowAuthority(readConfiguredPresentationAuthority(payload));
            const refreshSummary = summarizeFeaturedContentPayload(payload);

            if (!refreshSummary.usableForPersistence) {
                recordPtvEvent('cache', 'featured-cache-refresh-degraded', {
                    ...refreshSummary,
                    reason: refreshSummary.reason
                });
                throw new Error(`Featured content refresh is not persistable: ${refreshSummary.reason}.`);
            }

            const normalizedPayload = mergePayload(payload, fallbackPayload);

            return writeCacheEntry(owner, normalizedPayload)
                .then(entry => {
                    assertFeaturedCacheOwnerCurrent(owner);
                    lastRefreshDurationMs = Math.round(performance.now() - startedAt);
                    lastRefreshError = null;

                    if (notifyOnSuccess) {
                        dispatchCacheUpdated();
                    }

                    return entry.payload;
                });
        })
        .catch((err: unknown) => {
            if (!isFeaturedCacheOwnerCurrent(owner)) throw createRetiredFeaturedCacheOwnerError();

            observeConfiguredRowAuthority(null);
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
            if (isFeaturedCacheOwnerCurrent(owner) && inflightFeaturedContent === refreshRequest) {
                inflightFeaturedContent = null;
            }
        });

    inflightFeaturedContent = refreshRequest;
    return refreshRequest;
}

export function isFeaturedContentCacheFresh() {
    try {
        requireCurrentFeaturedCacheOwner();
    } catch {
        return false;
    }

    return Boolean(memoryCacheEntry && Date.now() < memoryCacheEntry.expiresAt);
}

export function getCachedFeaturedContentPayload(options: { allowStale?: boolean } = {}): Promise<FeaturedPayload | null> {
    let owner: FeaturedCacheIdentityOwner;

    try {
        owner = requireCurrentFeaturedCacheOwner();
    } catch {
        return Promise.resolve(null);
    }

    if (memoryCacheEntry && (options.allowStale || Date.now() < memoryCacheEntry.expiresAt)) {
        recordPtvEvent('cache', Date.now() < memoryCacheEntry.expiresAt ? 'hit' : 'stale-hit', {
            source: 'native-home-memory'
        });

        return resolveForFeaturedCacheOwner(owner, memoryCacheEntry.payload);
    }

    return readServerCacheEntry(owner)
        .then(cached => {
            assertFeaturedCacheOwnerCurrent(owner);
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
    let owner: FeaturedCacheIdentityOwner;

    try {
        owner = requireCurrentFeaturedCacheOwner();
    } catch {
        retireActiveFeaturedCacheIdentity();
        dispatchCacheUpdated();
        return;
    }

    const identityKey = owner.key;

    retireConfiguredRowFreshness('featured-cache-cleared');
    featuredCacheIdentityGeneration += 1;
    inflightFeaturedContent = null;
    inflightServerRead = null;
    inflightPluginStatus = null;
    memoryCacheEntry = null;
    nextServerReadAllowedAt = 0;
    lastCacheWriteError = null;
    lastRefreshError = null;
    activeFeaturedCacheIdentityKey = identityKey;
    owner = Object.freeze({
        generation: featuredCacheIdentityGeneration,
        key: identityKey
    });

    void clearServerDocument(owner)
        .then(() => {
            if (!isFeaturedCacheOwnerCurrent(owner)) return;
            lastCacheStorage = null;
            debugLog('cleared server cache');
            ptvLogger.info('Featured content server cache cleared', undefined, 'FeaturedCache');
            dispatchCacheUpdated();
        })
        .catch((err: unknown) => {
            if (!isFeaturedCacheOwnerCurrent(owner)) return;
            lastCacheStorage = null;
            lastCacheWriteError = getErrorMessage(err);
            debugLog('failed to clear server cache', err);
            dispatchCacheUpdated();
        });

    dispatchCacheUpdated();
}

export function invalidateFeaturedContentMemoryCache(reason = 'manual') {
    if (reason === 'identity-retired') {
        retireActiveFeaturedCacheIdentity();
    } else {
        let owner: FeaturedCacheIdentityOwner;

        try {
            owner = requireCurrentFeaturedCacheOwner();
        } catch {
            retireActiveFeaturedCacheIdentity();
            dispatchCacheUpdated();
            return;
        }

        retireConfiguredRowFreshness(`featured-cache-invalidated:${reason}`);
        featuredCacheIdentityGeneration += 1;
        const identityKey = owner.key;

        inflightFeaturedContent = null;
        inflightServerRead = null;
        inflightPluginStatus = null;
        memoryCacheEntry = null;
        nextServerReadAllowedAt = 0;
        lastCacheReadError = null;
        activeFeaturedCacheIdentityKey = identityKey;
    }

    recordPtvEvent('cache', 'featured-cache-memory-invalidated', {
        reason
    });
    debugLog('invalidated local featured cache', { reason });
    dispatchCacheUpdated();
}

export function getFeaturedContentCacheStatus(options: { prime?: boolean } = {}) {
    let hasIdentity = true;

    try {
        requireCurrentFeaturedCacheOwner();
    } catch {
        hasIdentity = false;
    }

    const cached = memoryCacheEntry;
    const now = Date.now();
    const rowSourceSummary = getPayloadRowSourceSummary(cached?.payload);
    const semanticSummary = cached ? summarizeFeaturedContentPayload(cached.payload) : lastServerCachePayloadSummary;

    if (hasIdentity && options.prime !== false && !cached && !inflightServerRead && canReadServerCacheNow()) {
        void primeFeaturedContentCacheStatus();
    }

    return {
        createdAt: cached?.createdAt || null,
        expiresAt: cached?.expiresAt || null,
        adoptionResult: lastServerCacheAdoptionResult,
        completeness: semanticSummary?.completeness || 'empty',
        cacheVersion: cached?.version ?? null,
        configuredRowCount: rowSourceSummary.configuredRowCount,
        fallbackRowCount: rowSourceSummary.fallbackRowCount,
        emptySectionCount: semanticSummary?.emptySectionCount || 0,
        heroCount: semanticSummary?.heroCount || 0,
        isStored: lastCacheStorage === 'plugin-file',
        isFresh: Boolean(cached && now < cached.expiresAt),
        itemCount: semanticSummary?.totalRowItemCount || 0,
        observedStorage: lastServerCachePayloadSummary ? 'plugin-file' : lastCacheStorage || 'none',
        payloadClassification: semanticSummary?.payloadClassification || 'empty',
        populatedSectionCount: semanticSummary?.populatedSectionCount || 0,
        recommendationRowCount: rowSourceSummary.recommendationRowCount,
        sectionCount: semanticSummary?.sectionCount || 0,
        semanticUsable: semanticSummary?.usableForPersistence || false,
        skippedRows: rowSourceSummary.skippedRows,
        storage: lastCacheStorage || 'none',
        totalRenderedRowCount: rowSourceSummary.totalRenderedRowCount,
        lastRawResponseByteSize: lastServerCacheRawByteSize,
        lastRawTopLevelKeys: lastServerCacheRawTopLevelKeys,
        lastNormalizedTopLevelKeys: lastServerCacheNormalizedTopLevelKeys,
        lastRejectionReason: lastServerCacheRejectionReason,
        detectedCacheVersion: lastServerCacheDetectedVersion,
        supportedCacheVersions: SUPPORTED_FEATURED_CACHE_VERSIONS,
        renderSource: lastServerCacheRenderSource,
        readError: lastCacheReadError,
        readInProgress: Boolean(inflightServerRead),
        writeError: lastCacheWriteError,
        lastRefreshDurationMs,
        lastRefreshError,
        retryBackoffMs: serverReadRetryBackoffMs,
        retryCount: serverReadRetryCount,
        retainedIdentityCount: activeFeaturedCacheIdentityKey ? 1 : 0,
        ttlMs: getFeaturedContentCacheTtlMs()
    };
}

export function forceRefreshFeaturedContentCache(fetcher?: () => Promise<FeaturedPayload>) {
    let owner: FeaturedCacheIdentityOwner;

    try {
        owner = requireCurrentFeaturedCacheOwner();
    } catch {
        return Promise.reject(createFeaturedCacheIdentityError());
    }

    const activeFetcher = fetcher || lastFeaturedContentFetcher;

    return readServerCacheEntry(owner)
        .then(cached => {
            assertFeaturedCacheOwnerCurrent(owner);
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

            return refreshFeaturedContent(owner, activeFetcher, cached?.payload, true);
        });
}

function resolveCachedFeaturedContent(
    owner: FeaturedCacheIdentityOwner,
    cached: FeaturedCacheEntry | null,
    fetcher: () => Promise<FeaturedPayload>
) {
    assertFeaturedCacheOwnerCurrent(owner);
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

        return resolveForFeaturedCacheOwner(owner, cached.payload);
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
            void refreshFeaturedContent(owner, fetcher, cached.payload, true);
        }

        return resolveForFeaturedCacheOwner(owner, cached.payload);
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
    return refreshFeaturedContent(owner, fetcher);
}

export function getFeaturedContent(fetcher: () => Promise<FeaturedPayload>): Promise<FeaturedPayload> {
    let owner: FeaturedCacheIdentityOwner;

    try {
        owner = requireCurrentFeaturedCacheOwner();
    } catch {
        return Promise.reject(createFeaturedCacheIdentityError());
    }

    lastFeaturedContentFetcher = fetcher;

    if (memoryCacheEntry) {
        const isFresh = Date.now() < memoryCacheEntry.expiresAt;

        recordPtvEvent('cache', isFresh ? 'hit' : 'stale-hit', {
            source: 'memory'
        });

        if (!isFresh && !inflightFeaturedContent) {
            void refreshFeaturedContent(owner, fetcher, memoryCacheEntry.payload, true);
        }

        return resolveForFeaturedCacheOwner(owner, memoryCacheEntry.payload);
    }

    return readServerCacheEntry(owner)
        .then(cached => resolveCachedFeaturedContent(owner, cached, fetcher));
}

registerPtvDebugCacheStatusProvider(getFeaturedContentCacheStatus);

function handleFeaturedCacheSignedIn() {
    const currentIdentityKey = readCurrentFeaturedCacheIdentityKey();

    if (currentIdentityKey && currentIdentityKey === activeFeaturedCacheIdentityKey) return;

    retireActiveFeaturedCacheIdentity();
    dispatchCacheUpdated();
}

function handleFeaturedCacheSignedOut() {
    retireActiveFeaturedCacheIdentity();
    dispatchCacheUpdated();
}

Events.on(ServerConnections, 'localusersignedin', handleFeaturedCacheSignedIn);
Events.on(ServerConnections, 'localusersignedout', handleFeaturedCacheSignedOut);

function scheduleInitialCachePrime() {
    if (initialCachePrimeScheduled) return;

    initialCachePrimeScheduled = true;
    FEATURED_CACHE_PRIME_DELAYS.forEach(delay => {
        featuredCacheScope.timeout(() => {
            try {
                requireCurrentFeaturedCacheOwner();
            } catch {
                return;
            }

            if (memoryCacheEntry) return;

            void primeFeaturedContentCacheStatus();
        }, delay);
    });
}

scheduleInitialCachePrime();
