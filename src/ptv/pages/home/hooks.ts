import { HomeOwnershipReadBudget } from './homeOwnershipReadBudget';
import { acceptHomeLibraryAuthority, beginHomeLibraryVerification, getHomeLibraryAuthoritySnapshot,
    isCurrentHomeUserAccessReady, isHomeUserAccessReadyForIdentity,
    subscribeHomeLibraryAuthority, retireHomeLibraryAuthority, matchesHomeTopologyClaim,
    matchesHomeUserAccessClaim, type CurrentHomeTopology } from './homeLibraryTransitionFreshness';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Events from '../../../utils/events';

import {
    getPtvCurrentUser,
    getCurrentPtvApiClient,
    getPtvItems,
    getPtvRecentlyAdded,
    getPtvResumeItems,
    isPtvAdminUser,
    requestPtvJson,
    type PtvItem,
    type PtvLibrary,
    type PtvUser
} from '../../api';
import { getPtvPerformanceProfile } from '../../core/clientProfile';
import { createPtvAbortController } from '../../core/abortController';
import { getCurrentPtvPluginApiClient, normalizePtvApiError } from '../../core/pluginApi';
import {
    getCachedFeaturedContentPayload,
    getFeaturedContentCacheStatus,
    getPtvFeaturedRowConfigHash,
    type FeaturedPayload
} from '../../modules/cache/featuredContentCache';
import {
    getFeaturedHeroItemsForAccessEpoch,
    getPtvFeaturedPayloadItemIds,
    hasUnprovedOwnedFeaturedCache,
    reconcilePtvFeaturedPayloadForUser
} from './featuredPayloadIdentity';
import {
    createConfiguredRowAssociationResolver,
    type ConfiguredRowAssociationResult
} from './configuredRowAssociation';
import {
    filterOwnedHomeRowInPluginOrder,
    resolveHomeLibraryOwnershipClaim,
    type HomeLibraryOwnershipClaim
} from './homeLibraryOwnership';
import { createHomeLibraryMembershipAuthority } from './homeLibraryMembership';
import { summarizeFeaturedContentPayload } from '../../modules/cache/featuredContentSemantics';
import { getPtvQualityTags } from '../../modules/cards/qualityTags';
import { normalizePtvRowLibraryScope } from '../../modules/dashboard/rowBuilderImport';
import type {
    PtvRecommendationScoreDistribution,
    PtvRecommendationSurfaceDebug
} from '../../modules/recommendations/types/recommendationTypes';
import {
    getEnabledPtvPersistedRecommendationRows,
    getPtvRecommendationSettingsHash,
    PTV_MIN_RECOMMENDATION_ROW_ITEMS,
    PTV_RECOMMENDATION_DIVERSITY_LIMITS,
    normalizePtvRecommendationRowSettings,
    type PtvPersistedRecommendationRow,
    type PtvRecommendationRowSettings
} from '../../modules/recommendations/recommendationSettings';
import {
    recordPtvEvent,
    recordPtvTiming,
    shouldCollectDiagnostics,
    timePtvAsync
} from '../../core/observability';
import {
    clearPtvShellStatus,
    setPtvShellError,
    setPtvShellLoading
} from '../../shell/foundation';
import { getPtvDisplayIdentityKey, PtvIdentityScopedCache } from '../../services/displayIdentity';
import { buildNativeHomeProfile } from './services/homeProfileService';
import {
    decideNativeHomeModelReplacement,
    mergeSettledNativeHomeRows,
    summarizeNativeHomeModel,
    type NativeHomeModelLike
} from './homeModelAuthority';
import {
    applyNativeHomeAdaptiveLayout,
    getEmptyNativeHomeAdaptiveDebug,
    type NativeHomeAdaptiveDebug
} from './services/homeLayoutService';
import { resolveNativeHomeDerivedRowSourceValue } from './rowSourceValue';
import {
    beginConfiguredRowVerification,
    getConfiguredRowFreshnessSnapshot,
    getConfiguredRowProofAuthority,
    isConfiguredRowPresentationCurrent,
    isConfiguredPayloadVerified,
    isConfiguredSectionVerified,
    readConfiguredPresentationAuthority,
    retireConfiguredRowFreshness,
    subscribeConfiguredRowFreshness,
    verifyConfiguredRowFreshness,
    type ConfiguredRowProof
} from './configuredRowFreshness';

export type NativeHomeRowKind = 'items' | 'libraries';
export type NativeHomeRowSource = 'adaptive-today' | 'because-you-watched' | 'continue-listening' | 'continue-reading' | 'featured-cache' | 'featured-endpoint' | 'libraries' | 'next-up' | 'recently-added' | 'recommendation' | 'resume';
export type NativeHomeRowType = 'configured-rule' | 'generated-recommendation' | 'fallback';
export type NativeHomeRenderedRowSource = 'auto-artist' | 'auto-genre' | 'cache' | 'fallback' | 'generated-preview' | 'recommendation-settings' | 'row-builder';

export type NativeHomeRowDiagnostics = {
    accepted: boolean;
    cacheHash: string | null;
    candidateCount?: number | null;
    configHash: string | null;
    dedupeRemovals?: number | null;
    enabled: boolean;
    finalRenderedCount?: number | null;
    generatedAt: number | null;
    hydrationRemovals?: number | null;
    itemCount: number;
    mediaSourceMissingCount?: number | null;
    mediaStreamsMissingCount?: number | null;
    persisted: boolean;
    qualityBadgeEligibleCount?: number | null;
    qualityBadgeMissingCount?: number | null;
    qualityBadgeRenderedCount?: number | null;
    recommendationConfigHash: string | null;
    recommendationHydrationFailures?: number | null;
    recommendationItemsHydrated?: number | null;
    renderedButMissingFromRecommendationSettings: boolean;
    rowId: string;
    rowTitle: string;
    rowConfigHash: string | null;
    rowType: NativeHomeRowType;
    source: NativeHomeRenderedRowSource;
    sourceGroupId: string | null;
    sourceGroupTitle: string | null;
    sourceRecommendationId: string | null;
    sourceRuleId: string | null;
    sourceValue: string | null;
};

export type NativeHomeRow = {
    configuredPresentationAuthority?: string;
    accepted?: boolean;
    adaptivePriorityScore?: number;
    adaptiveReason?: string;
    cacheHash?: string;
    candidateCount?: number;
    configHash?: string;
    dedupeRemovals?: number;
    enabled?: boolean;
    editorialDescription?: string;
    finalRenderedCount?: number;
    filteredReason?: string | null;
    generatedAt?: number | null;
    homeProfileMood?: string;
    homeProfileMoodConfidence?: number;
    hydrationRemovals?: number;
    id: string;
    items: Array<PtvItem | PtvLibrary>;
    kind: NativeHomeRowKind;
    mediaType?: string;
    mediaSourceMissingCount?: number;
    mediaStreamsMissingCount?: number;
    persisted?: boolean;
    personalizationSource?: string;
    pinned?: boolean;
    qualityBadgeEligibleCount?: number;
    qualityBadgeMissingCount?: number;
    qualityBadgeRenderedCount?: number;
    recommendationConfigHash?: string;
    recommendationHydrationFailures?: number;
    recommendationItemsHydrated?: number;
    renderedButMissingFromRecommendationSettings?: boolean;
    renderedSource?: NativeHomeRenderedRowSource;
    moreUrl?: string;
    homeOwnershipKind?: 'global' | 'library';
    homeOwnershipClaimKey?: string;
    homeOwnershipGeneration?: number;
    homeOwnershipIdentityKey?: string | null;
    homeOwnershipRevision?: number;
    homeLibraryRevision?: number;
    homeUserAccessEpoch?: string;
    homeTopologyEpoch?: string;
    rowConfigHash?: string;
    rowType?: NativeHomeRowType;
    ruleId?: string;
    source: NativeHomeRowSource;
    sourceCacheSectionId?: string;
    sourceConfigHash?: string;
    sourceGroupId?: string;
    sourceGroupTitle?: string;
    sourceRecommendationId?: string;
    sourceRuleId?: string;
    sourceSortIndex?: number;
    sourceType?: string;
    sourceValue?: string;
    subtitle: string;
    title: string;
};

export type NativeHomeState = {
    debug: {
        home: NativeHomeAdaptiveDebug;
        performance: NativeHomePerformanceDebug;
        recommendations: PtvRecommendationSurfaceDebug;
    };
    error: string | null;
    heroItem: PtvItem | null;
    heroAccessEpoch?: string | null;
    heroItems: PtvItem[];
    independentHeroItems?: PtvItem[];
    configuredHeroAuthorities?: Record<string, string>;
    isLoading: boolean;
    rows: NativeHomeRow[];
    user: PtvUser | null;
};

export type NativeHomePerformanceDebug = {
    backgroundRefreshCompleted: boolean;
    backgroundRefreshDurationMs: number | null;
    backgroundRefreshStarted: boolean;
    cacheHeroUsed: boolean;
    cacheCommitDelayMs: number | null;
    cacheRenderMs: number | null;
    cacheResponseReceivedAt: number | null;
    cacheRowsUsed: boolean;
    cacheStateCommittedAt: number | null;
    cacheUsedForHero: boolean;
    cacheUsedForRows: boolean;
    cachedHeroCount: number;
    cachedItemCount: number;
    cachedRowCount: number;
    fallbackFetchesSkipped: string[];
    firstVisibleContentMs: number | null;
    firstInteractiveMs: number | null;
    homeInitialRenderMs: number | null;
    slowFetchesAborted: string[];
};

const lastUsableNativeHomeStates = new PtvIdentityScopedCache<NativeHomeState>(4);
const FEATURED_IDENTITY_ITEM_LIMIT = 120;
const FEATURED_IDENTITY_BATCH_SIZE = FEATURED_IDENTITY_ITEM_LIMIT;
const FEATURED_IDENTITY_MAX_CONCURRENCY = 1;

export function retireNativeHomeIdentityState(serverId: unknown, userId: unknown) {
    return lastUsableNativeHomeStates.delete(serverId, userId);
}

async function revalidateFeaturedPayloadForIdentity(
    payload: FeaturedPayload | null,
    options: {
        serverId: string;
        signal: AbortSignal;
        userId: string;
    }
) {
    if (!payload || !options.serverId || !options.userId) return null;

    const ids = getPtvFeaturedPayloadItemIds(payload, FEATURED_IDENTITY_ITEM_LIMIT);
    if (!ids.length) return payload;

    const batches = Array.from(
        { length: Math.ceil(ids.length / FEATURED_IDENTITY_BATCH_SIZE) },
        (_, index) => ids.slice(
            index * FEATURED_IDENTITY_BATCH_SIZE,
            (index + 1) * FEATURED_IDENTITY_BATCH_SIZE
        )
    );
    const currentItems: PtvItem[] = [];

    for (let index = 0; index < batches.length; index += FEATURED_IDENTITY_MAX_CONCURRENCY) {
        if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const results = await Promise.all(
            batches
                .slice(index, index + FEATURED_IDENTITY_MAX_CONCURRENCY)
                .map(batch => getPtvItems<PtvItem>({
                    Fields: ITEM_FIELDS,
                    Ids: batch.join(','),
                    Limit: batch.length
                }, options))
        );
        results.forEach(result => {
            currentItems.push(...(result.Items || []));
        });
    }

    return reconcilePtvFeaturedPayloadForUser(payload, currentItems);
}

const ITEM_FIELDS = [
    'Overview',
    'Genres',
    'Studios',
    'Tags',
    'PrimaryImageAspectRatio',
    'CommunityRating',
    'CriticRating',
    'Container',
    'Height',
    'LocationType',
    'MediaType',
    'ParentId',
    'Album',
    'AlbumArtist',
    'AlbumId',
    'AlbumPrimaryImageItemId',
    'AlbumPrimaryImageTag',
    'Artists',
    'Artist',
    'ArtistItems',
    'ImageTags',
    'ParentPrimaryImageItemId',
    'ParentPrimaryImageTag',
    'ParentThumbImageTag',
    'ParentThumbItemId',
    'ProductionYear',
    'ProviderIds',
    'DateCreated',
    'PtvQualityTags',
    'SeriesId',
    'SeriesPrimaryImageTag',
    'VideoCodec',
    'VideoRange',
    'Width'
].join(',');

const VIDEO_IMAGE_TYPES = 'Primary,Backdrop,Logo,Thumb';
const RECENT_ITEM_TYPES = 'Movie,Series,Episode,MusicAlbum,Audio,Book';
const MAX_CACHED_ROWS = 60;
const MAX_NATIVE_HOME_HERO_ITEMS = 15;
const NATIVE_HOME_STUDIO_ROW_EXPANSION_LIMIT = 96;
const HOME_RECOMMENDATION_ROW_ORDER = [
    'recommended-for-you',
    'because-you-watched',
    'because-you-listen',
    'ptv-discovery',
    'rediscover',
    'recommended-movies',
    'recommended-shows',
    'recommended-anime',
    'made-for-you-music',
    'recommended-books',
    'recommended-comics',
    'recommended-manga'
] as const;
const HOME_CORE_ROW_ORDER = [
    'continue-watching',
    'continue-reading',
    'continue-listening',
    'latest'
] as const;
const NATIVE_HOME_ITEM_PROVIDER_KEYS = [
    'Imdb',
    'Tmdb',
    'Tvdb',
    'MusicBrainzAlbum',
    'MusicBrainzReleaseGroup',
    'MusicBrainzArtist'
] as const;

function getEmptyRecommendationScoreDistribution(): PtvRecommendationScoreDistribution {
    return {
        buckets: [
            { count: 0, label: '0-19' },
            { count: 0, label: '20-39' },
            { count: 0, label: '40-59' },
            { count: 0, label: '60-79' },
            { count: 0, label: '80-96' }
        ],
        max: 0,
        median: 0,
        min: 0,
        p25: 0,
        p75: 0,
        p90: 0
    };
}
const NATIVE_HOME_CRITICAL_FETCH_TIMEOUT_MS = 1800;
const NATIVE_HOME_FEATURED_ADOPTION_TIMEOUT_MS = 900;
const NATIVE_HOME_FALLBACK_FETCH_TIMEOUT_MS = 2600;
const NATIVE_HOME_SUPPLEMENTAL_FETCH_TIMEOUT_MS = 3200;

type PtvRowBuilderRule = {
    enabled?: boolean;
    generationMode?: string;
    groupTitle?: string;
    id?: string;
    includeSubgenres?: boolean;
    itemLimit?: number;
    libraryScope?: unknown;
    mediaType?: string;
    name?: string;
    rowCount?: number;
    sortPriority?: number;
    sourceValue?: string;
    sourceType?: string;
    subgenreRowCount?: number;
};

type NativeHomeStudioRowTarget = {
    serverId: string;
    studioId: string;
};

type PtvRowsEndpointSettings = {
    currentPresentationAuthority?: unknown;
    categories?: unknown[];
    configuredRowAssociations?: unknown;
    enableConfiguredRows?: boolean;
    defaultsInitialized?: boolean;
    enableRecommendedRows?: boolean;
    enabled?: boolean;
    recommendations?: PtvRecommendationRowSettings | null;
    rowSettings?: {
        enableConfiguredRows?: boolean;
        enableRecommendedRows?: boolean;
        showConfiguredRowsOnHome?: boolean;
    };
    rules?: PtvRowBuilderRule[];
    schemaVersion?: number;
    showConfiguredRowsOnHome?: boolean;
};

type NativeHomeSkippedRow = {
    cacheHash?: string;
    configHash?: string;
    enabled?: boolean;
    id: string;
    itemCount?: number;
    reason: string;
    rowType?: NativeHomeRowType;
    ruleId?: string;
    sourceCacheSectionId?: string;
    sourceConfigHash?: string;
    sourceGroupId?: string;
    sourceRecommendationId?: string;
    sourceRuleId?: string;
    title: string;
};

type NativeHomeFeaturedRowsResult = {
    rows: NativeHomeRow[];
    skippedRows: NativeHomeSkippedRow[];
};

type NativeHomeViewportPosition = {
    bottom: number | null;
    height: number | null;
    inThreshold: boolean;
    left: number | null;
    right: number | null;
    top: number | null;
    viewportBottom: number | null;
    viewportHeight: number | null;
    viewportTop: number | null;
    width: number | null;
};

type NativeHomeMemoryPerformance = Performance & {
    memory?: {
        jsHeapSizeLimit?: number;
        totalJSHeapSize?: number;
        usedJSHeapSize?: number;
    };
};

type NativeHomeMaybeItem = PtvItem | PtvLibrary | null | undefined;

const NATIVE_HOME_ROW_MOUNT_ROOT_MARGIN_PX = 1200;
const NATIVE_HOME_ROW_INITIAL_BUFFER = 4;
const NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED = false;
const NATIVE_HOME_ROW_FALLBACK_MOUNT_COUNT = 8;
let nativeHomeRouteGeneration = 0;

function getNativeHomeRootMarginPx(rootMargin: string | undefined, fallback: number) {
    const firstValue = String(rootMargin || '').trim().split(/\s+/)[0] || '';
    const parsed = Number.parseInt(firstValue, 10);

    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function logRowRulesPipeline(stage: string, detail: unknown) {
    if (!shouldCollectDiagnostics()) return;

    console.debug(`[PTV Row Rules] ${stage}`, detail);

    recordPtvEvent('render', 'row-rules-pipeline', {
        [stage]: detail,
        stage
    });
}

function getItems<T>(result: { Items?: T[] } | T[] | null | undefined): T[] {
    if (Array.isArray(result)) return result;

    return result?.Items || [];
}

function normalizeNativeHomeTextValue(value: unknown) {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);

    return '';
}

function normalizeVersionText(value: string) {
    return value
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function getNativeHomeItemProviderVersionKey(item: NativeHomeMaybeItem) {
    const providerIds = item?.ProviderIds;

    if (!providerIds || typeof providerIds !== 'object') return '';

    const providersByLowerKey = new Map(
        Object.keys(providerIds).map(key => [key.toLowerCase(), normalizeNativeHomeTextValue((providerIds as Record<string, unknown>)[key]).toLowerCase()])
    );

    for (const providerKey of NATIVE_HOME_ITEM_PROVIDER_KEYS) {
        const providerValue = providersByLowerKey.get(providerKey.toLowerCase());

        if (providerValue) {
            return `${providerKey.toLowerCase()}:${providerValue}`;
        }
    }

    return '';
}

export function getNativeHomeItemVersionKey(item: NativeHomeMaybeItem) {
    const itemType = normalizeNativeHomeTextValue(item?.Type || item?.MediaType || 'item').toLowerCase();
    const providerKey = getNativeHomeItemProviderVersionKey(item);

    if (providerKey) return `${itemType}:${providerKey}`;

    const title = normalizeVersionText(
        normalizeNativeHomeTextValue(item?.Name)
        || normalizeNativeHomeTextValue((item as Record<string, unknown>)?.OriginalTitle)
    );
    const rawYear = Number(item?.ProductionYear);
    const year = Number.isFinite(rawYear) && rawYear > 0 ? String(Math.round(rawYear)) : '';

    if (title && year) return `${itemType}:${title}:${year}`;
    if (title && itemType !== 'audio') return `${itemType}:${title}`;

    return getNativeHomeItemId(item) || normalizeNativeHomeTextValue((item as Record<string, unknown>)?.ItemId);
}

function getNativeHomeItemKey(item: NativeHomeMaybeItem) {
    return getNativeHomeItemVersionKey(item);
}

function getNativeHomeItemId(item: NativeHomeMaybeItem) {
    return typeof item?.Id === 'string' ? item.Id.trim() : '';
}

function getNativeHomeItemType(item: NativeHomeMaybeItem) {
    return String(item?.Type || item?.MediaType || '').trim();
}

function isNativeHomeVideoQualityEligible(item: NativeHomeMaybeItem) {
    const mediaType = String(item?.MediaType || '').toLowerCase();
    const itemType = String(item?.Type || '').toLowerCase();

    return mediaType === 'video'
        || mediaType === 'audio'
        || ['audio', 'episode', 'movie', 'series', 'video'].includes(itemType);
}

function hasNativeHomeMediaStreams(item: NativeHomeMaybeItem) {
    const mediaStreams = item?.MediaStreams;
    const mediaSources = item?.MediaSources;

    return Array.isArray(mediaStreams) && mediaStreams.length > 0
        || Array.isArray(mediaSources) && mediaSources.some(source => (
            Boolean(source)
            && typeof source === 'object'
            && Array.isArray((source as Record<string, unknown>).MediaStreams)
            && ((source as Record<string, unknown>).MediaStreams as unknown[]).length > 0
        ));
}

function hasNativeHomeQualityMetadata(item: NativeHomeMaybeItem) {
    if (!item) return false;
    if (Array.isArray(item.PtvQualityTags) && item.PtvQualityTags.length > 0) return true;
    if (typeof item.Width === 'number' || typeof item.Height === 'number') return true;
    if (typeof item.VideoCodec === 'string' || typeof item.VideoRange === 'string') return true;
    if (hasNativeHomeMediaStreams(item)) return true;

    const mediaSources = item.MediaSources;

    return Array.isArray(mediaSources) && mediaSources.some(source => {
        if (!source || typeof source !== 'object') return false;

        const record = source as Record<string, unknown>;

        return typeof record.Width === 'number'
            || typeof record.Height === 'number'
            || typeof record.VideoCodec === 'string'
            || typeof record.VideoRange === 'string'
            || typeof record.Container === 'string';
    });
}

function shouldHydrateNativeHomeRecommendationItem(item: NativeHomeMaybeItem) {
    if (!getNativeHomeItemId(item)) return false;
    if (hasNativeHomeQualityMetadata(item)) return false;

    const mediaType = String(item?.MediaType || '').toLowerCase();
    const itemType = String(item?.Type || '').toLowerCase();
    const unsupportedTypes = new Set([
        'boxset',
        'book',
        'collectionfolder',
        'folder',
        'genre',
        'musicartist',
        'musicalbum',
        'person',
        'photo',
        'studio'
    ]);

    if (unsupportedTypes.has(itemType) || mediaType === 'photo') return false;

    return true;
}

function getNativeHomeQualityDiagnostics(items: Array<PtvItem | PtvLibrary>) {
    const eligibleItems = items.filter(isNativeHomeVideoQualityEligible);
    const qualityBadgeRenderedCount = eligibleItems.filter(item => getPtvQualityTags(item, { maxTags: 6 }).length > 0).length;
    const mediaSourceMissingCount = eligibleItems.filter(item => !Array.isArray(item.MediaSources) || item.MediaSources.length === 0).length;
    const mediaStreamsMissingCount = eligibleItems.filter(item => !hasNativeHomeMediaStreams(item)).length;

    return {
        mediaSourceMissingCount,
        mediaStreamsMissingCount,
        qualityBadgeEligibleCount: eligibleItems.length,
        qualityBadgeMissingCount: Math.max(0, eligibleItems.length - qualityBadgeRenderedCount),
        qualityBadgeRenderedCount
    };
}

function recordNativeHomeMissingQualityDiagnostics(
    row: Pick<NativeHomeRow, 'id' | 'sourceRecommendationId' | 'title'>,
    items: Array<PtvItem | PtvLibrary>,
    stage: string,
    hydratedIds = new Set<string>()
) {
    if (!shouldCollectDiagnostics()) return;

    items
        .filter(item => isNativeHomeVideoQualityEligible(item) && !hasNativeHomeQualityMetadata(item))
        .slice(0, 12)
        .forEach(item => {
            const missingFields = [
                !Array.isArray(item.MediaSources) || item.MediaSources.length === 0 ? 'MediaSources' : '',
                !hasNativeHomeMediaStreams(item) ? 'MediaStreams' : '',
                typeof item.Width !== 'number' ? 'Width' : '',
                typeof item.Height !== 'number' ? 'Height' : '',
                !item.VideoCodec ? 'VideoCodec' : '',
                !item.VideoRange ? 'VideoRange' : ''
            ].filter(Boolean);

            recordPtvEvent('render', 'native-home-quality-badge-missing', {
                badgeResolverResult: 'no-quality-metadata',
                hydrationStatus: hydratedIds.has(getNativeHomeItemId(item)) ? 'hydrated' : 'not-hydrated',
                itemId: getNativeHomeItemId(item),
                itemType: getNativeHomeItemType(item),
                missingFields,
                rowId: row.id,
                rowTitle: row.title,
                sourceRecommendationId: row.sourceRecommendationId || null,
                stage
            });
        });
}

function mergeNativeHomeHydratedItem(compactItem: PtvItem, hydratedItem: PtvItem | undefined): PtvItem {
    if (!hydratedItem) return compactItem;

    return {
        ...compactItem,
        ...hydratedItem,
        PtvRecommendationReasonText: compactItem.PtvRecommendationReasonText || hydratedItem.PtvRecommendationReasonText
    };
}

async function hydrateNativeHomeRecommendationItems(
    rows: NativeHomeRow[],
    options: {
        shouldContinue?: () => boolean;
        signal?: AbortSignal;
        source: string;
    }
): Promise<NativeHomeRow[]> {
    const recommendationRows = rows.filter(row => row.source === 'recommendation' || row.rowType === 'generated-recommendation');
    const ids = Array.from(new Set(recommendationRows.flatMap(row => (
        row.items
            .filter(shouldHydrateNativeHomeRecommendationItem)
            .map(getNativeHomeItemId)
            .filter(Boolean)
    ))));

    if (!ids.length || options.shouldContinue?.() === false) {
        if (ids.length) {
            recordPtvEvent('render', 'native-home-recommendation-quality-hydration-skipped', {
                reason: 'route-retired',
                source: options.source
            });
        }

        return rows.map(row => ({
            ...row,
            ...getNativeHomeQualityDiagnostics(row.items)
        }));
    }

    const start = performance.now();
    let hydratedItems: PtvItem[] = [];
    let failureReason = '';

    try {
        const result = await getPtvItems<PtvItem>({
            EnableImages: true,
            EnableImageTypes: 'Primary,Backdrop,Thumb,Logo',
            Fields: ITEM_FIELDS,
            Ids: ids.join(','),
            ImageTypeLimit: 1,
            Limit: ids.length
        }, {
            signal: options.signal
        });

        hydratedItems = getItems(result);
    } catch (error) {
        failureReason = normalizePtvApiError(error).message;
    }

    const durationMs = Number((performance.now() - start).toFixed(1));
    const hydratedById = new Map(hydratedItems.map(item => [getNativeHomeItemId(item), item]));
    const hydratedIds = new Set(hydratedById.keys());
    const hydrationFailures = Math.max(0, ids.length - hydratedIds.size);

    recordPtvEvent('render', failureReason ? 'native-home-recommendation-quality-hydration-failed' : 'native-home-recommendation-quality-hydrated', {
        durationMs,
        failureReason: failureReason || null,
        hydratedCount: hydratedItems.length,
        requestedCount: ids.length,
        source: options.source
    });

    return rows.map(row => {
        if (row.source !== 'recommendation' && row.rowType !== 'generated-recommendation') {
            return {
                ...row,
                ...getNativeHomeQualityDiagnostics(row.items)
            };
        }

        const items = row.items.map(item => mergeNativeHomeHydratedItem(item as PtvItem, hydratedById.get(getNativeHomeItemId(item))));
        const diagnostics = getNativeHomeQualityDiagnostics(items);

        recordNativeHomeMissingQualityDiagnostics(row, items, options.source, hydratedIds);

        return {
            ...row,
            ...diagnostics,
            hydrationRemovals: row.hydrationRemovals ?? 0,
            items,
            recommendationHydrationFailures: hydrationFailures,
            recommendationItemsHydrated: row.items.filter(item => hydratedIds.has(getNativeHomeItemId(item))).length
        };
    });
}

function getNativeHomeRowMemorySummary(rows: NativeHomeRow[], heroItems: PtvItem[] = []) {
    const rowItemKeys = new Set<string>();
    const heroItemKeys = new Set<string>();
    let rowItemReferences = 0;
    let duplicateRowItemReferences = 0;

    rows.forEach(row => {
        row.items.forEach(item => {
            const key = getNativeHomeItemKey(item);

            rowItemReferences += 1;

            if (!key) return;
            if (rowItemKeys.has(key)) {
                duplicateRowItemReferences += 1;
                return;
            }

            rowItemKeys.add(key);
        });
    });
    heroItems.forEach(item => {
        const key = getNativeHomeItemKey(item);

        if (key) heroItemKeys.add(key);
    });

    const memory = (performance as NativeHomeMemoryPerformance).memory;

    return {
        duplicateRowItemReferences,
        heroItemCount: heroItems.length,
        heroUniqueItemCount: heroItemKeys.size,
        jsHeapLimit: memory?.jsHeapSizeLimit || null,
        rowCount: rows.length,
        rowItemReferences,
        rowUniqueItemCount: rowItemKeys.size,
        totalJsHeap: memory?.totalJSHeapSize || null,
        usedJsHeap: memory?.usedJSHeapSize || null
    };
}

function getNativeHomeRowDebugMemorySummary(rows: NativeHomeRow[], heroItems: PtvItem[] = []) {
    return shouldCollectDiagnostics() ? getNativeHomeRowMemorySummary(rows, heroItems) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getRecordString(value: Record<string, unknown> | null | undefined, ...keys: string[]) {
    if (!value) return '';

    for (const key of keys) {
        const candidate = value[key];

        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
    }

    return '';
}

function getRecordBoolean(value: Record<string, unknown> | null | undefined, ...keys: string[]) {
    if (!value) return undefined;

    for (const key of keys) {
        const candidate = value[key];

        if (typeof candidate === 'boolean') return candidate;
    }

    return undefined;
}

function getRecordNumber(value: Record<string, unknown> | null | undefined, ...keys: string[]) {
    if (!value) return undefined;

    for (const key of keys) {
        const candidate = value[key];

        if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    }

    return undefined;
}

function getRecordStringArray(value: Record<string, unknown> | null | undefined, ...keys: string[]) {
    if (!value) return [];

    for (const key of keys) {
        const candidate = value[key];

        if (!Array.isArray(candidate)) continue;

        const values = candidate
            .map(entry => {
                if (typeof entry === 'string') return entry.trim();
                if (isRecord(entry)) return getRecordString(entry, 'Id', 'id');

                return '';
            })
            .filter(Boolean);

        if (values.length) return values;
    }

    return [];
}

function normalizeNativeHomeDedupeKey(value: unknown) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getNativeHomeRecommendationExactKeys(item: NativeHomeMaybeItem) {
    if (!item) return [];

    return [
        item.Id ? `item:${item.Id}` : '',
        item.Name ? `title:${item.Type || ''}:${item.Name}` : '',
        getNativeHomeItemVersionKey(item)
    ]
        .map(normalizeNativeHomeDedupeKey)
        .filter(Boolean);
}

function getNativeHomeRecommendationSeriesKey(item: NativeHomeMaybeItem) {
    if (!item || !('SeriesId' in item || 'SeriesName' in item)) return '';

    const itemId = 'Id' in item ? item.Id || '' : '';
    const type = 'Type' in item ? String(item.Type || '').toLowerCase() : '';
    const seriesId = 'SeriesId' in item ? String(item.SeriesId || '') : '';
    const seriesName = 'SeriesName' in item ? String(item.SeriesName || '') : '';

    if (!seriesId && !seriesName) return '';
    if (type !== 'episode' && type !== 'season' && seriesId && seriesId === itemId) return '';

    return normalizeNativeHomeDedupeKey(`series:${seriesId}:${seriesName}`);
}

function getNativeHomeRecommendationAlbumKey(item: NativeHomeMaybeItem) {
    if (!item) return '';

    const type = 'Type' in item ? String(item.Type || '').toLowerCase() : '';
    const mediaType = 'MediaType' in item ? String(item.MediaType || '').toLowerCase() : '';

    if (!['audio', 'musicalbum', 'musicartist'].includes(type) && mediaType !== 'audio') return '';

    const albumId = 'AlbumId' in item ? String(item.AlbumId || '') : '';
    const album = 'Album' in item ? String(item.Album || '') : '';

    if (!albumId && !album) return '';

    return normalizeNativeHomeDedupeKey(`album:${albumId}:${album}`);
}

function getNativeHomeRecommendationArtistKeys(item: NativeHomeMaybeItem) {
    if (!item) return [];

    const artists = [
        ...('Artists' in item && Array.isArray(item.Artists) ? item.Artists : []),
        'AlbumArtist' in item ? item.AlbumArtist : ''
    ];

    return artists
        .map(artist => normalizeNativeHomeDedupeKey(artist))
        .filter(Boolean);
}

function dedupeNativeHomeRecommendationItems<T extends PtvItem | PtvLibrary>(items: T[]) {
    const exactKeys = new Set<string>();
    const albumCounts = new Map<string, number>();
    const artistCounts = new Map<string, number>();
    const seriesCounts = new Map<string, number>();
    const deduped: T[] = [];

    items.forEach(item => {
        const itemExactKeys = getNativeHomeRecommendationExactKeys(item);
        const seriesKey = getNativeHomeRecommendationSeriesKey(item);
        const albumKey = getNativeHomeRecommendationAlbumKey(item);
        const artistKeys = getNativeHomeRecommendationArtistKeys(item);

        if (itemExactKeys.some(key => exactKeys.has(key))) return;
        if (seriesKey && (seriesCounts.get(seriesKey) || 0) >= PTV_RECOMMENDATION_DIVERSITY_LIMITS.maxItemsPerFranchise) return;
        if (albumKey && (albumCounts.get(albumKey) || 0) >= PTV_RECOMMENDATION_DIVERSITY_LIMITS.maxItemsPerAlbum) return;
        if (artistKeys.some(key => (artistCounts.get(key) || 0) >= PTV_RECOMMENDATION_DIVERSITY_LIMITS.maxItemsPerArtist)) return;

        itemExactKeys.forEach(key => {
            exactKeys.add(key);
        });
        if (seriesKey) seriesCounts.set(seriesKey, (seriesCounts.get(seriesKey) || 0) + 1);
        if (albumKey) albumCounts.set(albumKey, (albumCounts.get(albumKey) || 0) + 1);
        artistKeys.forEach(key => {
            artistCounts.set(key, (artistCounts.get(key) || 0) + 1);
        });
        deduped.push(item);
    });

    return deduped;
}

function normalizeSectionItems(value: unknown): Record<string, unknown[]> {
    if (!isRecord(value)) return {};

    return Object.keys(value).reduce<Record<string, unknown[]>>((sectionItems, sectionId) => {
        const items = value[sectionId];

        if (Array.isArray(items)) {
            sectionItems[sectionId] = items;
        }

        return sectionItems;
    }, {});
}

function normalizeFeaturedPayloadShape(value: unknown): FeaturedPayload | null {
    if (!isRecord(value)) return null;

    const sections = Array.isArray(value.sections) ? value.sections : [];
    const sectionItems = normalizeSectionItems(value.sectionItems);

    sections.forEach(section => {
        if (!isRecord(section)) return;

        const sectionId = getRecordString(section, 'id', 'Id', 'key');
        const items = section.items;

        if (sectionId && Array.isArray(items) && !sectionItems[sectionId]) {
            sectionItems[sectionId] = items;
        }
    });

    if (!sections.length && !Object.keys(sectionItems).length && !Array.isArray(value.heroItems)) {
        return null;
    }

    const heroEpochKeys = Object.keys(value).filter(key => key.toLowerCase() === 'heroaccessepoch');
    const heroAccessEpoch = heroEpochKeys.length === 1 && heroEpochKeys[0] === 'heroAccessEpoch'
        && typeof value.heroAccessEpoch === 'string' && /^[a-fA-F0-9]{64}$/.test(value.heroAccessEpoch) ?
        value.heroAccessEpoch : undefined;

    return {
        currentPresentationAuthority: readConfiguredPresentationAuthority(value) || undefined,
        heroAccessEpoch,
        heroItems: Array.isArray(value.heroItems) ? value.heroItems : [],
        recommendationConfigHash: typeof value.recommendationConfigHash === 'string' && value.recommendationConfigHash.trim() ? value.recommendationConfigHash.trim() : undefined,
        rowConfigApplied: typeof value.rowConfigApplied === 'boolean' ? value.rowConfigApplied : undefined,
        rowConfigHash: typeof value.rowConfigHash === 'string' && value.rowConfigHash.trim() ? value.rowConfigHash.trim() : undefined,
        rowConfigVersion: typeof value.rowConfigVersion === 'number' ? value.rowConfigVersion : undefined,
        scopeSchemaVersion: typeof value.scopeSchemaVersion === 'number' ? value.scopeSchemaVersion : undefined,
        rowDiagnostics: Array.isArray(value.rowDiagnostics) ? value.rowDiagnostics : [],
        sections,
        sectionItems
    };
}

function extractFeaturedPayload(value: unknown): FeaturedPayload | null {
    const directPayload = normalizeFeaturedPayloadShape(value);

    if (directPayload) return directPayload;
    if (!isRecord(value)) return null;

    const payload = normalizeFeaturedPayloadShape(value.payload);

    if (payload) return payload;

    if (isRecord(value.featuredContent)) {
        const entry = value.featuredContent;
        const featured = normalizeFeaturedPayloadShape(entry.payload)
            || normalizeFeaturedPayloadShape(entry);
        return featured ? {
            ...featured,
            homeFeaturedCacheVersion: [8, 9].includes(Number(entry.version)) ? Number(entry.version) : 0
        } as FeaturedPayload : null;
    }

    return null;
}

function getEnabledRowRules(settings: PtvRowsEndpointSettings | null): PtvRowBuilderRule[] {
    if (!settings || settings.enabled === false || !Array.isArray(settings.rules)) return [];

    return settings.rules.filter(rule => rule?.enabled !== false);
}

function getRowsEndpointCount(settings: PtvRowsEndpointSettings | null) {
    return Array.isArray(settings?.rules) ? settings.rules.length : 0;
}

function getCustomConfiguredRowCount(settings: PtvRowsEndpointSettings | null) {
    if (!shouldRenderConfiguredRows(settings)) return 0;

    return getEnabledRowRules(settings)
        .filter(rule => rule.sourceType !== 'continueWatching')
        .length;
}

function shouldUseSavedRowRules(settings: PtvRowsEndpointSettings | null) {
    return Boolean(settings && settings.enabled !== false && Array.isArray(settings.rules));
}

function shouldRenderConfiguredRows(settings: PtvRowsEndpointSettings | null) {
    return shouldUseSavedRowRules(settings);
}

function serializePluginHashString(value: string) {
    let serialized = '"';

    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);

        switch (code) {
            case 8:
                serialized += '\\b';
                break;
            case 9:
                serialized += '\\t';
                break;
            case 10:
                serialized += '\\n';
                break;
            case 12:
                serialized += '\\f';
                break;
            case 13:
                serialized += '\\r';
                break;
            case 92:
                serialized += '\\\\';
                break;
            default:
                serialized += code < 32 || code > 126 || '"\'&+<>`'.includes(value[index]) ?
                    `\\u${code.toString(16).toUpperCase().padStart(4, '0')}` :
                    value[index];
        }
    }

    return `${serialized}"`;
}

function serializePluginHashValue(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(serializePluginHashValue).join(',')}]`;
    if (isRecord(value)) {
        // Plugin ToStableJson uses StringComparer.Ordinal, not locale collation.
        // eslint-disable-next-line sonarjs/no-alphabetical-sort
        return `{${Object.keys(value).sort()
            .map(key => `${serializePluginHashString(key)}:${serializePluginHashValue(value[key])}`)
            .join(',')}}`;
    }
    if (typeof value === 'string') return serializePluginHashString(value);
    return JSON.stringify(value) ?? 'null';
}

function getPluginRowSettingsHash(value: unknown) {
    const stableJson = serializePluginHashValue(value);
    let hash = 5381;

    for (let index = 0; index < stableJson.length; index += 1) {
        hash = ((hash * 33) + stableJson.charCodeAt(index)) % 2147483647;
    }

    return String(hash);
}

export function getRowsEndpointSettingsHash(settings: PtvRowsEndpointSettings | null) {
    if (!settings || !Array.isArray(settings.rules)) return '';

    if (settings.schemaVersion === 3) {
        if (typeof settings.enabled !== 'boolean'
            || typeof settings.defaultsInitialized !== 'boolean'
            || typeof settings.showConfiguredRowsOnHome !== 'boolean'
            || !Array.isArray(settings.categories)
            || !settings.rules.every(isRecord)) return '';

        // The Plugin hashes the persisted RowBuilderSettings DTO, not Home's
        // normalized settings or response-only association metadata.
        return getPluginRowSettingsHash({
            schemaVersion: settings.schemaVersion,
            enabled: settings.enabled,
            defaultsInitialized: settings.defaultsInitialized,
            showConfiguredRowsOnHome: settings.showConfiguredRowsOnHome,
            rules: settings.rules,
            categories: settings.categories
        });
    }

    const hashableSettings = {
        ...settings,
        enableConfiguredRows: undefined,
        showConfiguredRowsOnHome: undefined,
        rowSettings: settings.rowSettings ? {
            ...settings.rowSettings,
            enableConfiguredRows: undefined,
            showConfiguredRowsOnHome: undefined
        } : settings.rowSettings,
        rules: settings.rules.map(rule => ({
            ...rule,
            includeSubgenres: false,
            subgenreRowCount: 0
        }))
    };

    // Response-only association is not part of the legacy persisted settings hash.
    delete hashableSettings.configuredRowAssociations;
    delete hashableSettings.currentPresentationAuthority;

    return getPtvFeaturedRowConfigHash(hashableSettings);
}

function getRecommendationRowsSettingsHash(settings: PtvRowsEndpointSettings | null) {
    return settings?.recommendations ?
        settings.recommendations.recommendationConfigHash || getPtvRecommendationSettingsHash(settings.recommendations) :
        '';
}

function areRecommendationsEnabled(settings: PtvRowsEndpointSettings | null) {
    if (!settings) return true;
    if (settings.enableRecommendedRows === false) return false;
    if (settings.rowSettings?.enableRecommendedRows === false) return false;
    if (settings.recommendations?.enableRecommendedRows === false) return false;
    if (settings.recommendations?.rowSettings?.enableRecommendedRows === false) return false;

    return settings.recommendations?.enabled !== false;
}

function isFeaturedPayloadCurrentForRows(
    featuredPayload: FeaturedPayload | null,
    rowSettings: PtvRowsEndpointSettings | null,
    configuredProof?: ConfiguredRowProof | null
) {
    // SEC-01 intentionally removes private persisted configuration hashes.
    // Only the new final-read proof may replace that legacy presentation check.
    if (isConfiguredPayloadVerified(featuredPayload, configuredProof)) return true;
    const payloadHash = featuredPayload?.rowConfigHash?.trim();
    const settingsHash = getRowsEndpointSettingsHash(rowSettings);
    const payloadRecommendationHash = featuredPayload?.recommendationConfigHash?.trim();
    const settingsRecommendationHash = getRecommendationRowsSettingsHash(rowSettings);

    if (!shouldUseSavedRowRules(rowSettings)) {
        return Boolean(featuredPayload?.rowConfigApplied && payloadHash);
    }

    if (
        payloadRecommendationHash
        && settingsRecommendationHash
        && payloadRecommendationHash !== settingsRecommendationHash
    ) {
        return false;
    }

    return Boolean(payloadHash && settingsHash && payloadHash === settingsHash);
}

function getMatchingRecommendationRow(
    settings: PtvRowsEndpointSettings | null,
    recommendationId: string
): PtvPersistedRecommendationRow | null {
    const recommendationKey = toLookupKey(recommendationId);

    if (!recommendationKey) return null;

    return getEnabledPtvPersistedRecommendationRows(settings?.recommendations)
        .find(row => toLookupKey(row.id) === recommendationKey) || null;
}

function isRuleSourceEnabled(settings: PtvRowsEndpointSettings | null, sourceType: string) {
    return getEnabledRowRules(settings).some(rule => rule.sourceType === sourceType);
}

function getSectionId(section: unknown) {
    return isRecord(section) ? getRecordString(section, 'id', 'Id', 'key') : '';
}

function getSectionRuleId(section: unknown) {
    return isRecord(section) ? getRecordString(section, 'sourceRuleId', 'SourceRuleId', 'ruleId', 'RuleId', 'rowRuleId', 'RowRuleId') : '';
}

function getSectionRecommendationId(section: unknown) {
    return isRecord(section) ? getRecordString(section, 'sourceRecommendationId', 'SourceRecommendationId', 'recommendationId', 'RecommendationId') : '';
}

function normalizeSectionRowType(value: string): NativeHomeRowType | null {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'configured-rule') return 'configured-rule';
    if (normalized === 'generated-recommendation') return 'generated-recommendation';
    if (normalized === 'fallback') return 'fallback';

    return null;
}

function getSectionRowType(section: unknown): NativeHomeRowType {
    if (!isRecord(section)) return 'fallback';
    if (getSectionRuleId(section) || Object.keys(section).some(key => /configured.*(?:association|authority)/i.test(key))) {
        return 'configured-rule';
    }

    const explicitType = normalizeSectionRowType(getRecordString(section, 'rowType', 'RowType'));

    if (explicitType) return explicitType;
    if (getSectionRecommendationId(section)) return 'generated-recommendation';

    const sourceType = getSectionSourceType(section).toLowerCase();
    const sectionType = getRecordString(section, 'type', 'Type').toLowerCase();

    if (sourceType === 'recommendation' || sectionType === 'recommendation') return 'generated-recommendation';
    if (sourceType === 'legacy' || sourceType === 'fallback' || sectionType === 'fallback') return 'fallback';

    return 'configured-rule';
}

function getSectionGroupId(section: unknown) {
    if (!isRecord(section)) return '';

    return getRecordString(section, 'sourceGroupId', 'SourceGroupId', 'groupId', 'GroupId', 'groupTitle', 'GroupTitle');
}

function getSectionGroupTitle(section: unknown) {
    if (!isRecord(section)) return '';

    return getRecordString(section, 'groupTitle', 'GroupTitle', 'groupName', 'GroupName');
}

function getSectionConfigHash(section: unknown, payload: FeaturedPayload, rowType: NativeHomeRowType) {
    const sectionHash = isRecord(section) ?
        getRecordString(section, 'configHash', 'ConfigHash', 'sourceConfigHash', 'SourceConfigHash', 'rowConfigHash', 'RowConfigHash', 'recommendationConfigHash', 'RecommendationConfigHash') :
        '';

    if (sectionHash) return sectionHash;

    return rowType === 'generated-recommendation' ?
        payload.recommendationConfigHash || '' :
        payload.rowConfigHash || '';
}

function getSectionCacheHash(section: unknown, payload: FeaturedPayload, rowType: NativeHomeRowType) {
    const sectionHash = isRecord(section) ?
        getRecordString(section, 'cacheHash', 'CacheHash') :
        '';

    if (sectionHash) return sectionHash;

    return getSectionConfigHash(section, payload, rowType);
}

function getSectionEnabled(section: unknown) {
    if (!isRecord(section)) return true;

    return getRecordBoolean(section, 'enabled', 'Enabled') !== false;
}

function getSectionNumber(section: unknown, ...keys: string[]) {
    return isRecord(section) ? getRecordNumber(section, ...keys) : undefined;
}

function getSectionParentRuleId(section: unknown) {
    return isRecord(section) ? getRecordString(section, 'parentRuleId', 'ParentRuleId') : '';
}

function getSectionSourceType(section: unknown) {
    return isRecord(section) ? getRecordString(section, 'sourceType', 'SourceType') : '';
}

function getSectionMediaType(section: unknown) {
    return isRecord(section) ? getRecordString(section, 'mediaType', 'MediaType') : '';
}

function getSectionSourceValue(section: unknown) {
    return isRecord(section) ? getRecordString(section, 'sourceValue', 'SourceValue', 'searchTerm', 'SearchTerm', 'source', 'Source') : '';
}

function getSectionExplicitSourceValue(section: unknown) {
    return isRecord(section) ? getRecordString(section, 'sourceValue', 'SourceValue', 'searchTerm', 'SearchTerm') : '';
}

function toLookupKey(value: string) {
    return value.trim().toLowerCase();
}

function getFeaturedSectionCount(payload: FeaturedPayload | null) {
    if (!payload) return 0;

    return Array.isArray(payload.sections) && payload.sections.length ?
        payload.sections.length :
        Object.keys(payload.sectionItems || {}).length;
}

function getFeaturedPayloadItemCount(payload: FeaturedPayload | null) {
    if (!payload?.sectionItems) return 0;

    return Object.values(payload.sectionItems)
        .reduce((total, items) => total + (Array.isArray(items) ? items.length : 0), 0);
}

function getRuleItemLimit(rule: PtvRowBuilderRule | null | undefined) {
    const limit = Number(rule?.itemLimit || 0);

    return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
}

function getRuleRowLimit(rule: PtvRowBuilderRule | null | undefined) {
    const limit = Number(rule?.rowCount || 1);

    return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1;
}

function normalizeNativeHomeStudioLookup(value: string) {
    return value.trim().toLowerCase();
}

function getNativeHomeStudioLookupCandidates(value: string) {
    const normalized = normalizeNativeHomeStudioLookup(value);

    if (!normalized) return [];

    const withoutStudioSuffix = normalized
        .replace(/\s+animation\s+studios?$/i, '')
        .replace(/\s+studios?$/i, '')
        .trim();

    return Array.from(new Set([
        normalized,
        withoutStudioSuffix,
        `${withoutStudioSuffix} studio`,
        `${withoutStudioSuffix} studios`,
        `${withoutStudioSuffix} animation studios`
    ].filter(Boolean)));
}

function isNativeHomeStudioSource(sourceType: string | undefined) {
    const normalized = (sourceType || '').trim().toLowerCase();

    return normalized === 'studio' || normalized === 'studios';
}

function getNativeHomeStudioIdFromMap(
    sourceValue: string,
    studioMap: Map<string, string> | null | undefined
) {
    if (!sourceValue || !studioMap?.size) return '';

    for (const candidate of getNativeHomeStudioLookupCandidates(sourceValue)) {
        const studioId = studioMap.get(candidate);

        if (studioId) return studioId;
    }

    return '';
}

function getRecordArray(value: Record<string, unknown> | null | undefined, ...keys: string[]) {
    if (!value) return [] as unknown[];

    for (const key of keys) {
        const candidate = value[key];

        if (Array.isArray(candidate)) return candidate;
    }

    return [] as unknown[];
}

function getNativeHomeStudioIdFromEntries(entries: unknown[], sourceValue: string) {
    const sourceKeys = new Set(getNativeHomeStudioLookupCandidates(sourceValue));

    for (const entry of entries) {
        if (!isRecord(entry)) continue;

        const studioId = getRecordString(entry, 'Id', 'id');
        const studioName = getRecordString(entry, 'Name', 'name');

        if (studioId && studioName && sourceKeys.has(normalizeNativeHomeStudioLookup(studioName))) {
            return studioId;
        }
    }

    return '';
}

function getNativeHomeStudioIdFromItems(
    rowItems: Array<PtvItem | PtvLibrary>,
    sourceValue: string
) {
    for (const item of rowItems) {
        if (!isRecord(item)) continue;

        const directStudioId = getRecordString(item, 'StudioId', 'studioId', 'PrimaryStudioId', 'primaryStudioId');

        if (directStudioId) return directStudioId;

        const studioIds = getRecordStringArray(item, 'StudioIds', 'studioIds');

        if (studioIds.length === 1) return studioIds[0];

        const entryStudioId = getNativeHomeStudioIdFromEntries(
            getRecordArray(item, 'Studios', 'studios', 'StudioItems', 'studioItems'),
            sourceValue
        );

        if (entryStudioId) return entryStudioId;
    }

    return '';
}

function getNativeHomeFirstItemServerId(items: Array<PtvItem | PtvLibrary>) {
    for (const item of items) {
        if (!isRecord(item)) continue;

        const serverId = getRecordString(item, 'ServerId', 'serverId');

        if (serverId) return serverId;
    }

    return '';
}

function getCurrentNativeHomeServerId() {
    return getCurrentPtvApiClient()?.serverId?.() || '';
}

function buildNativeHomeStudioMoreUrl(studioId: string, serverId: string) {
    const params = [`studioId=${encodeURIComponent(studioId)}`];

    if (serverId) params.push(`serverId=${encodeURIComponent(serverId)}`);

    return `#/list?${params.join('&')}`;
}

function getNativeHomeExplicitMoreUrl(section: unknown) {
    return isRecord(section) ?
        getRecordString(section, 'moreUrl', 'MoreUrl', 'url', 'Url', 'href', 'Href') :
        '';
}

function getNativeHomeSectionStudioId(
    section: unknown,
    sourceValue: string,
    studioMap: Map<string, string> | null | undefined,
    rowItems: Array<PtvItem | PtvLibrary>
) {
    if (isRecord(section)) {
        const directStudioId = getRecordString(section, 'studioId', 'StudioId', 'sourceId', 'SourceId');

        if (directStudioId) return directStudioId;

        const studioIds = getRecordStringArray(section, 'studioIds', 'StudioIds');

        if (studioIds.length) return studioIds[0];
    }

    return getNativeHomeStudioIdFromItems(rowItems, sourceValue)
        || getNativeHomeStudioIdFromMap(sourceValue, studioMap);
}

function getNativeHomeFeaturedRowMoreUrl(options: {
    rowItems: Array<PtvItem | PtvLibrary>;
    section: unknown;
    sourceType: string;
    sourceValue: string;
    studioMap?: Map<string, string> | null;
}) {
    const explicitMoreUrl = getNativeHomeExplicitMoreUrl(options.section);

    if (explicitMoreUrl) return explicitMoreUrl;

    if (isNativeHomeStudioSource(options.sourceType) && options.sourceValue) {
        const studioId = getNativeHomeSectionStudioId(
            options.section,
            options.sourceValue,
            options.studioMap,
            options.rowItems
        );

        if (studioId) {
            return buildNativeHomeStudioMoreUrl(
                studioId,
                getNativeHomeFirstItemServerId(options.rowItems) || getCurrentNativeHomeServerId()
            );
        }
    }

    return options.sourceValue ? `#/search?query=${encodeURIComponent(options.sourceValue)}` : '';
}

function getNativeHomeQueryValue(url: string | undefined, key: string) {
    if (!url) return '';

    const queryIndex = url.indexOf('?');

    if (queryIndex < 0) return '';

    const query = url.slice(queryIndex + 1);

    try {
        return new URLSearchParams(query).get(key) || '';
    } catch {
        return '';
    }
}

function getNativeHomeStudioRowTarget(
    row: NativeHomeRow,
    studioMap: Map<string, string>
): NativeHomeStudioRowTarget | null {
    if (!isNativeHomeStudioSource(row.sourceType)) return null;

    const sourceValue = row.sourceValue || row.title;
    const studioId = getNativeHomeQueryValue(row.moreUrl, 'studioId')
        || getNativeHomeStudioIdFromMap(sourceValue, studioMap);

    if (!studioId) return null;

    return {
        serverId: getNativeHomeQueryValue(row.moreUrl, 'serverId')
            || getNativeHomeFirstItemServerId(row.items)
            || getCurrentNativeHomeServerId(),
        studioId
    };
}

function getNativeHomeStudioIncludeItemTypes(row: NativeHomeRow) {
    const mediaType = (row.mediaType || '').trim().toLowerCase();

    if (mediaType === 'movie' || mediaType === 'movies') return 'Movie';
    if (mediaType === 'series' || mediaType === 'show' || mediaType === 'shows') return 'Series';

    return 'Movie,Series';
}

export function dedupeNativeHomeItems<TItem extends PtvItem | PtvLibrary>(items: TItem[]) {
    const seen = new Set<string>();
    const deduped: TItem[] = [];

    items.forEach(item => {
        const key = getNativeHomeItemKey(item);

        if (!key || seen.has(key)) return;

        seen.add(key);
        deduped.push(item);
    });

    return deduped;
}

function loadNativeHomeStudioMap(userId: string, signal?: AbortSignal) {
    return requestPtvJson<{ Items?: Array<{ Id?: string; Name?: string }> }>('Studios', {
        params: {
            IncludeItemTypes: 'Movie,Series',
            Limit: 500,
            Recursive: true,
            SortBy: 'SortName',
            SortOrder: 'Ascending',
            UserId: userId
        },
        signal
    })
        .then(result => new Map((result.Items || [])
            .filter(studio => studio.Id && studio.Name)
            .map(studio => [String(studio.Name).toLowerCase(), String(studio.Id)])))
        .catch(() => new Map<string, string>());
}

function expandNativeHomeStudioRow(
    row: NativeHomeRow,
    userId: string,
    studioMap: Map<string, string>,
    signal?: AbortSignal
): Promise<NativeHomeRow> {
    // Scoped rows must keep the Plugin's order and the exact proven candidate
    // set. The global studio expansion has no library membership proof.
    if (row.homeOwnershipKind === 'library') return Promise.resolve(row);
    const target = getNativeHomeStudioRowTarget(row, studioMap);

    if (!target) return Promise.resolve(row);

    return getPtvItems<PtvItem>({
        EnableImages: true,
        EnableImageTypes: VIDEO_IMAGE_TYPES,
        Fields: ITEM_FIELDS,
        ImageTypeLimit: 1,
        IncludeItemTypes: getNativeHomeStudioIncludeItemTypes(row),
        Limit: NATIVE_HOME_STUDIO_ROW_EXPANSION_LIMIT,
        Recursive: true,
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        StudioIds: target.studioId
    }, {
        serverId: target.serverId,
        signal,
        userId
    })
        .then(result => {
            const expandedItems = dedupeNativeHomeItems(getItems(result));

            if (expandedItems.length <= row.items.length) return row;

            recordPtvEvent('row-fetch', 'native-home-studio-row-expanded', {
                expandedCount: expandedItems.length,
                existingCount: row.items.length,
                rowId: row.id,
                rowTitle: row.title,
                serverId: target.serverId || null,
                sourceValue: row.sourceValue || row.title,
                studioId: target.studioId,
                totalRecordCount: result.TotalRecordCount ?? null
            });

            return {
                ...row,
                candidateCount: Math.max(row.candidateCount || 0, result.TotalRecordCount || expandedItems.length),
                finalRenderedCount: expandedItems.length,
                items: expandedItems,
                moreUrl: buildNativeHomeStudioMoreUrl(target.studioId, target.serverId)
            };
        })
        .catch(error => {
            recordPtvEvent('row-fetch', 'native-home-studio-row-expand-failed', {
                error: error instanceof Error ? error.message : String(error),
                rowId: row.id,
                rowTitle: row.title,
                serverId: target.serverId || null,
                sourceValue: row.sourceValue || row.title,
                studioId: target.studioId
            });

            return row;
        });
}

function expandNativeHomeStudioRows(
    rows: NativeHomeRow[],
    userId: string,
    studioMap: Map<string, string>,
    signal?: AbortSignal
) {
    if (!rows.some(row => isNativeHomeStudioSource(row.sourceType))) {
        return Promise.resolve(rows);
    }

    return Promise.all(rows.map(row => expandNativeHomeStudioRow(row, userId, studioMap, signal)));
}

function createNativeHomeFeaturedRowResults(
    featuredPayload: FeaturedPayload | null,
    featuredEndpointPayload: FeaturedPayload | null,
    rowSettings: PtvRowsEndpointSettings | null,
    userId: string,
    options: NativeRowFetchOptions,
    configuredProof?: ConfiguredRowProof | null,
    allowRestrictedOwnedEndpoint = false
) {
    const createResults = (studioMap: Map<string, string>) => ({
        cachedRowsResult: createRowsFromFeaturedPayload(featuredPayload, {
            configuredProof,
            rowSettings,
            source: 'featured-cache',
            studioMap
        }),
        endpointRowsResult: createRowsFromFeaturedPayload(featuredEndpointPayload, {
            configuredProof,
            rowSettings,
            source: 'featured-endpoint',
            studioMap,
            restrictedOwnedEndpoint: allowRestrictedOwnedEndpoint && !rowSettings
        }),
        studioMap
    });
    const initialResults = createResults(new Map<string, string>());
    const hasStudioRows = [
        ...initialResults.cachedRowsResult.rows,
        ...initialResults.endpointRowsResult.rows
    ].some(row => isNativeHomeStudioSource(row.sourceType));

    if (!hasStudioRows) return Promise.resolve(initialResults);

    return createNativeRowFetch(
        'native-home-studio-map',
        signal => loadNativeHomeStudioMap(userId, signal),
        new Map<string, string>(),
        options
    ).then(createResults);
}

function isRuleMatchForSection(
    rule: PtvRowBuilderRule,
    sectionRuleId: string
) {
    const ruleId = toLookupKey(rule.id || '');
    const sectionRuleKey = toLookupKey(sectionRuleId);

    return Boolean(ruleId && ruleId === sectionRuleKey);
}

function getMatchingRowRule(
    rules: PtvRowBuilderRule[],
    sectionRuleId: string
) {
    return rules.find(rule => isRuleMatchForSection(rule, sectionRuleId)) || null;
}

function hasUsableFeaturedPayload(payload: FeaturedPayload | null) {
    return Boolean(payload && summarizeFeaturedContentPayload(payload).usableForDisplay);
}

function canUseFeaturedCacheForHome(payload: FeaturedPayload | null,
    rowSettings: PtvRowsEndpointSettings | null, configuredProof: ConfiguredRowProof | null,
    hasUnprovedOwnedCache: boolean, topology: CurrentHomeTopology | null) {
    return hasUsableFeaturedPayload(payload)
        && isFeaturedPayloadCurrentForRows(payload, rowSettings, configuredProof)
        && !(hasUnprovedOwnedCache && topology);
}

function mergeSkippedRows(...groups: NativeHomeSkippedRow[][]) {
    const seen = new Set<string>();
    const merged: NativeHomeSkippedRow[] = [];

    groups.flat().forEach(row => {
        const key = `${row.id}:${row.ruleId || ''}:${row.reason}`;

        if (seen.has(key)) return;

        seen.add(key);
        merged.push(row);
    });

    return merged;
}

function getMissingConfiguredRows(
    rowSettings: PtvRowsEndpointSettings | null,
    rows: NativeHomeRow[],
    skippedRows: NativeHomeSkippedRow[]
) {
    const knownRowKeys = new Set([
        ...rows.flatMap(row => [
            toLookupKey(row.id),
            toLookupKey(row.id.replace(/^featured-/, '')),
            toLookupKey(row.ruleId || ''),
            toLookupKey(row.title)
        ]),
        ...skippedRows.flatMap(row => [
            toLookupKey(row.id),
            toLookupKey(row.id.replace(/^featured-/, '')),
            toLookupKey(row.ruleId || ''),
            toLookupKey(row.title)
        ])
    ].filter(Boolean));

    return getEnabledRowRules(rowSettings)
        .filter(rule => rule.sourceType !== 'continueWatching')
        .filter(rule => rule.sourceType !== 'becauseYouWatched')
        .filter(rule => {
            const id = toLookupKey(rule.id || '');
            const name = toLookupKey(rule.name || '');

            return Boolean(id || name) && !knownRowKeys.has(id) && !knownRowKeys.has(name);
        })
        .map((rule, index) => ({
            id: rule.id || `configured-row-${index + 1}`,
            reason: 'missing-featured-payload',
            ruleId: rule.id,
            title: rule.name || rule.id || `Configured Row ${index + 1}`
        }));
}

function getSectionTitle(section: unknown, fallback: string) {
    if (!section || typeof section !== 'object') return fallback;

    const value = section as Record<string, unknown>;

    return String(value.title || value.name || value.source || fallback);
}

function getSectionSubtitle(section: unknown) {
    if (!section || typeof section !== 'object') return 'Featured from your PiggieTV cache';

    const value = section as Record<string, unknown>;
    const rowKicker = getRecordString(value, 'rowKicker', 'RowKicker');

    if (rowKicker) return rowKicker;

    const sourceType = getRecordString(value, 'sourceType', 'SourceType').toLowerCase();

    if (sourceType === 'genre') return 'GENRE';
    if (sourceType === 'studio') return 'STUDIOS';
    if (sourceType) return 'FEATURED';

    return String(value.rowKicker || value.groupTitle || value.groupKicker || 'Featured from your PiggieTV cache');
}

function isUsableHeroItem(item: PtvItem | null | undefined): item is PtvItem & { Id: string } {
    return Boolean(
        item?.Id
        && (
            item.BackdropImageTags?.length
            || item.ImageTags?.Primary
            || item.ImageTags?.Logo
        )
    );
}

function getUniqueUsableHeroItems(items: Array<PtvItem | null | undefined>, limit = MAX_NATIVE_HOME_HERO_ITEMS) {
    const seen = new Set<string>();
    const heroItems: PtvItem[] = [];

    items.some(item => {
        if (!isUsableHeroItem(item) || seen.has(item.Id)) return false;

        seen.add(item.Id);
        heroItems.push(item);

        return heroItems.length >= limit;
    });

    return heroItems;
}

function getUsableHeroItemsFromRows(rows: NativeHomeRow[]) {
    const candidateRows = rows.filter(row => row.kind === 'items');
    const candidateItems = candidateRows.reduce<PtvItem[]>((items, row) => {
        row.items.forEach(candidate => {
            items.push(candidate as PtvItem);
        });

        return items;
    }, []);

    return getUniqueUsableHeroItems(candidateItems);
}

function firstUsableHeroItem(rows: NativeHomeRow[]): PtvItem | null {
    return getUsableHeroItemsFromRows(rows)[0] || null;
}

function buildNativeHomeHeroItems(preferredHeroItems: PtvItem[], fallbackHeroItems: PtvItem[]) {
    return getUniqueUsableHeroItems([
        ...preferredHeroItems,
        ...fallbackHeroItems
    ]);
}

function summarizeFeaturedRowDiagnostic(diagnostic: unknown) {
    if (!isRecord(diagnostic)) return null;

    return {
        candidateCount: getRecordNumber(diagnostic, 'candidateCount', 'CandidateCount'),
        dedupeRemovals: getRecordNumber(diagnostic, 'dedupeRemovals', 'DedupeRemovals'),
        dropReason: getRecordString(diagnostic, 'dropReason'),
        droppedSourceCount: typeof diagnostic.droppedSourceCount === 'number' ? diagnostic.droppedSourceCount : null,
        finalRenderedCount: getRecordNumber(diagnostic, 'finalRenderedCount', 'FinalRenderedCount'),
        generatedSourceCount: typeof diagnostic.generatedSourceCount === 'number' ? diagnostic.generatedSourceCount : null,
        hydrationRemovals: getRecordNumber(diagnostic, 'hydrationRemovals', 'HydrationRemovals'),
        itemCount: typeof diagnostic.itemCount === 'number' ? diagnostic.itemCount : null,
        plannedRowCount: typeof diagnostic.plannedRowCount === 'number' ? diagnostic.plannedRowCount : null,
        rowId: getRecordString(diagnostic, 'rowId'),
        ruleId: getRecordString(diagnostic, 'ruleId'),
        sourceType: getRecordString(diagnostic, 'sourceType'),
        sourceValue: getRecordString(diagnostic, 'sourceValue')
    };
}

function recordFeaturedPayloadShape(payload: FeaturedPayload | null) {
    if (!shouldCollectDiagnostics()) return;

    const sectionItems = payload?.sectionItems || {};
    const sectionItemEntries = Object.entries(sectionItems);
    const rowDiagnostics = Array.isArray(payload?.rowDiagnostics) ? payload.rowDiagnostics : [];

    recordPtvEvent('cache', 'native-home-featured-cache-shape', {
        hasPayload: Boolean(payload),
        heroCount: Array.isArray(payload?.heroItems) ? payload.heroItems.length : 0,
        rowDiagnosticCount: rowDiagnostics.length,
        rowDiagnostics: rowDiagnostics
            .slice(0, MAX_CACHED_ROWS)
            .map(summarizeFeaturedRowDiagnostic)
            .filter(Boolean),
        sectionCount: Array.isArray(payload?.sections) ? payload.sections.length : 0,
        sectionItemKeyCount: sectionItemEntries.length,
        sectionItemCounts: sectionItemEntries.slice(0, MAX_CACHED_ROWS).map(([sectionId, items]) => ({
            itemCount: Array.isArray(items) ? items.length : 0,
            sectionId
        }))
    });
}

function getRowFilteredReason(row: NativeHomeRow) {
    if (!row.items.length) return 'empty-items';

    return null;
}

function getNativeHomeRowType(row: NativeHomeRow): NativeHomeRowType {
    if (row.rowType) return row.rowType;
    if (row.sourceRecommendationId || row.source === 'recommendation') return 'generated-recommendation';
    if (row.sourceRuleId || row.ruleId) return 'configured-rule';

    return 'fallback';
}

function getNativeHomeRenderedRowSource(row: NativeHomeRow): NativeHomeRenderedRowSource {
    if (row.renderedSource) return row.renderedSource;

    const rowType = getNativeHomeRowType(row);
    const lookupId = toLookupKey(row.sourceRecommendationId || row.id);

    if (row.source === 'recommendation') {
        if (row.accepted === true && row.persisted === true) return 'recommendation-settings';
        if (lookupId.startsWith('because-you-like-')) return 'auto-genre';
        if (lookupId.startsWith('because-you-listen-to-')) return 'auto-artist';

        return 'generated-preview';
    }

    if (rowType === 'configured-rule' || row.ruleId || row.sourceRuleId) return 'row-builder';
    if (row.source === 'featured-cache' || row.source === 'featured-endpoint') return 'cache';

    return 'fallback';
}

export function getNativeHomeRowDiagnostics(row: NativeHomeRow): NativeHomeRowDiagnostics {
    const rowType = getNativeHomeRowType(row);
    const sourceRecommendationId = row.sourceRecommendationId || (row.source === 'recommendation' ? row.id : null);
    const sourceRuleId = row.sourceRuleId || row.ruleId || null;
    const configHash = row.configHash || row.sourceConfigHash || null;
    const cacheHash = row.cacheHash || configHash;
    const recommendationConfigHash = row.recommendationConfigHash || (rowType === 'generated-recommendation' ? configHash || null : null);
    const rowConfigHash = row.rowConfigHash || (rowType === 'configured-rule' ? configHash || null : null);
    const persisted = row.persisted === true;
    const accepted = row.accepted === true;
    const renderedButMissingFromRecommendationSettings = row.renderedButMissingFromRecommendationSettings === true
        || (row.source === 'recommendation' && (!persisted || !accepted));

    return {
        accepted,
        cacheHash,
        candidateCount: row.candidateCount ?? null,
        configHash,
        dedupeRemovals: row.dedupeRemovals ?? null,
        enabled: row.enabled !== false,
        finalRenderedCount: row.finalRenderedCount ?? row.items.length,
        generatedAt: typeof row.generatedAt === 'number' ? row.generatedAt : null,
        hydrationRemovals: row.hydrationRemovals ?? null,
        itemCount: row.items.length,
        mediaSourceMissingCount: row.mediaSourceMissingCount ?? null,
        mediaStreamsMissingCount: row.mediaStreamsMissingCount ?? null,
        persisted,
        qualityBadgeEligibleCount: row.qualityBadgeEligibleCount ?? null,
        qualityBadgeMissingCount: row.qualityBadgeMissingCount ?? null,
        qualityBadgeRenderedCount: row.qualityBadgeRenderedCount ?? null,
        recommendationConfigHash,
        recommendationHydrationFailures: row.recommendationHydrationFailures ?? null,
        recommendationItemsHydrated: row.recommendationItemsHydrated ?? null,
        renderedButMissingFromRecommendationSettings,
        rowId: row.id,
        rowTitle: row.title,
        rowConfigHash,
        rowType,
        source: getNativeHomeRenderedRowSource(row),
        sourceGroupId: row.sourceGroupId || null,
        sourceGroupTitle: row.sourceGroupTitle || null,
        sourceRecommendationId,
        sourceRuleId,
        sourceValue: row.sourceValue || null
    };
}

function finalizeNativeHomeRows(stage: string, rows: NativeHomeRow[]) {
    const rowsWithReasons = rows.map(row => ({
        ...row,
        filteredReason: getRowFilteredReason(row)
    }));

    if (shouldCollectDiagnostics()) {
        const filteredCount = rowsWithReasons.filter(row => row.filteredReason).length;

        recordPtvEvent('render', 'native-home-rows-finalized', {
            filteredCount,
            renderableCount: rowsWithReasons.length - filteredCount,
            rowCount: rowsWithReasons.length,
            stage
        });
    }

    return rowsWithReasons.filter(row => !row.filteredReason);
}

export async function fetchRowsEndpointSettings(signal?: AbortSignal): Promise<PtvRowsEndpointSettings | null> {
    const currentUser = await getPtvCurrentUser(undefined, signal).catch(() => null);

    if (!isPtvAdminUser(currentUser)) {
        recordPtvEvent('row-fetch', 'native-home-rows-endpoint-skipped', {
            reason: 'administrator-required'
        });

        return null;
    }

    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi?.getRows) return null;

    const normalizeHomeSettings = (settings: unknown): PtvRowsEndpointSettings | null => {
        if (!isRecord(settings)) return null;

        const rows = isRecord(settings.rows) ? settings.rows as PtvRowsEndpointSettings : settings as PtvRowsEndpointSettings;
        const recommendations = normalizePtvRecommendationRowSettings(settings);
        const rowSettings = rows.rowSettings || {};
        const nestedEnableRecommendedRows = isRecord(settings.rowSettings) && typeof settings.rowSettings.enableRecommendedRows === 'boolean' ?
            settings.rowSettings.enableRecommendedRows :
            undefined;
        const rowSettingsEnableRecommendedRows = typeof rowSettings.enableRecommendedRows === 'boolean' ?
            rowSettings.enableRecommendedRows :
            undefined;
        const nestedShowConfiguredRowsOnHome = isRecord(settings.rowSettings) && typeof settings.rowSettings.showConfiguredRowsOnHome === 'boolean' ?
            settings.rowSettings.showConfiguredRowsOnHome :
            undefined;
        const nestedEnableConfiguredRows = isRecord(settings.rowSettings) && typeof settings.rowSettings.enableConfiguredRows === 'boolean' ?
            settings.rowSettings.enableConfiguredRows :
            undefined;
        const rowSettingsShowConfiguredRowsOnHome = typeof rowSettings.showConfiguredRowsOnHome === 'boolean' ?
            rowSettings.showConfiguredRowsOnHome :
            undefined;
        const rowSettingsEnableConfiguredRows = typeof rowSettings.enableConfiguredRows === 'boolean' ?
            rowSettings.enableConfiguredRows :
            undefined;
        let recommendationEnableRecommendedRows: boolean | undefined;

        if (typeof recommendations?.rowSettings?.enableRecommendedRows === 'boolean') {
            recommendationEnableRecommendedRows = recommendations.rowSettings.enableRecommendedRows;
        } else if (typeof recommendations?.enableRecommendedRows === 'boolean') {
            recommendationEnableRecommendedRows = recommendations.enableRecommendedRows;
        }

        const enableRecommendedRows = typeof rows.enableRecommendedRows === 'boolean' ?
            rows.enableRecommendedRows :
            nestedEnableRecommendedRows ?? rowSettingsEnableRecommendedRows ?? recommendationEnableRecommendedRows;
        const showConfiguredRowsOnHome = typeof rows.showConfiguredRowsOnHome === 'boolean' ?
            rows.showConfiguredRowsOnHome :
            typeof rows.enableConfiguredRows === 'boolean' ?
                rows.enableConfiguredRows :
                nestedShowConfiguredRowsOnHome
                    ?? nestedEnableConfiguredRows
                    ?? rowSettingsShowConfiguredRowsOnHome
                    ?? rowSettingsEnableConfiguredRows
                    ?? false;
        const normalizedRowSettings: PtvRowsEndpointSettings['rowSettings'] = {
            ...rowSettings,
            enableConfiguredRows: showConfiguredRowsOnHome,
            showConfiguredRowsOnHome,
            ...(typeof enableRecommendedRows === 'boolean' ? { enableRecommendedRows } : {})
        };

        return {
            ...rows,
            enableRecommendedRows,
            enableConfiguredRows: showConfiguredRowsOnHome,
            recommendations,
            rowSettings: normalizedRowSettings,
            showConfiguredRowsOnHome
        };
    };
    const loadRowsFallback = () => pluginApi.getRows<unknown>()
        .then(settings => {
            const normalizedSettings = normalizeHomeSettings(settings);

            recordPtvEvent('row-fetch', 'native-home-rows-endpoint-loaded', {
                enabled: normalizedSettings?.enabled ?? null,
                recommendationRowCount: normalizedSettings?.recommendations?.rows?.length || 0,
                ruleCount: getRowsEndpointCount(normalizedSettings)
            });

            return normalizedSettings;
        });

    return (pluginApi.getSettings ?
        pluginApi.getSettings<unknown>()
            .then(settings => {
                const normalizedSettings = normalizeHomeSettings(settings);

                recordPtvEvent('row-fetch', 'native-home-settings-endpoint-loaded', {
                    enabled: normalizedSettings?.enabled ?? null,
                    recommendationRowCount: normalizedSettings?.recommendations?.rows?.length || 0,
                    ruleCount: getRowsEndpointCount(normalizedSettings)
                });

                return normalizedSettings;
            }) :
        loadRowsFallback())
        .catch(() => loadRowsFallback())
        .catch((err: unknown) => {
            const error = normalizePtvApiError(err);

            recordPtvEvent('row-fetch', 'native-home-rows-endpoint-error', {
                error: error.message,
                kind: error.kind,
                status: error.status ?? null
            });

            return null;
        });
}

function fetchFeaturedEndpointPayload(): Promise<FeaturedPayload | null> {
    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi?.getFeaturedContentCacheDocument) return Promise.resolve(null);

    return pluginApi.getFeaturedContentCacheDocument()
        .then(document => {
            const payload = extractFeaturedPayload(document);

            recordPtvEvent('row-fetch', 'native-home-featured-endpoint-loaded', {
                heroCount: Array.isArray(payload?.heroItems) ? payload.heroItems.length : 0,
                sectionCount: getFeaturedSectionCount(payload)
            });

            return payload;
        })
        .catch((err: unknown) => {
            const error = normalizePtvApiError(err);

            recordPtvEvent('row-fetch', 'native-home-featured-endpoint-error', {
                error: error.message,
                kind: error.kind,
                responseBody: error.responseBody?.slice(0, 300) || null,
                status: error.status ?? null,
                url: error.url || null
            });

            return null;
        });
}

function createRows(
    resumeItems: PtvItem[],
    continueReadingItems: PtvItem[],
    continueListeningItems: PtvItem[],
    recentlyAddedItems: PtvItem[],
    rowSettings: PtvRowsEndpointSettings | null = null
): NativeHomeRow[] {
    const dedupedResumeItems = dedupeNativeHomeItems(resumeItems);
    const dedupedContinueReadingItems = dedupeNativeHomeItems(continueReadingItems);
    const dedupedContinueListeningItems = dedupeNativeHomeItems(continueListeningItems);
    const dedupedRecentlyAddedItems = dedupeNativeHomeItems(recentlyAddedItems);
    const settingsHash = getRowsEndpointSettingsHash(rowSettings) || undefined;
    const rows: NativeHomeRow[] = [
        {
            cacheHash: settingsHash,
            configHash: settingsHash,
            enabled: true,
            id: 'resume',
            items: dedupedResumeItems,
            kind: 'items',
            rowType: 'fallback',
            source: 'resume',
            sourceGroupId: 'jellyfin-defaults',
            subtitle: 'Pick up where you left off',
            title: 'Continue Watching'
        },
        {
            cacheHash: settingsHash,
            configHash: settingsHash,
            enabled: true,
            id: 'continue-reading',
            items: dedupedContinueReadingItems,
            kind: 'items',
            rowType: 'fallback',
            source: 'continue-reading',
            sourceGroupId: 'jellyfin-defaults',
            subtitle: 'Books, comics, and manga in progress',
            title: 'Continue Reading'
        },
        {
            cacheHash: settingsHash,
            configHash: settingsHash,
            enabled: true,
            id: 'continue-listening',
            items: dedupedContinueListeningItems,
            kind: 'items',
            rowType: 'fallback',
            source: 'continue-listening',
            sourceGroupId: 'jellyfin-defaults',
            subtitle: 'Albums and tracks in progress',
            title: 'Continue Listening'
        },
        {
            cacheHash: settingsHash,
            configHash: settingsHash,
            enabled: true,
            id: 'recently-added',
            items: dedupedRecentlyAddedItems,
            kind: 'items',
            rowType: 'fallback',
            source: 'recently-added',
            sourceGroupId: 'jellyfin-defaults',
            subtitle: 'New arrivals from your server',
            title: 'Latest'
        }
    ];

    const continueRule = getEnabledRowRules(rowSettings).find(rule => rule.sourceType === 'continueWatching');
    const systemRows = shouldRenderConfiguredRows(rowSettings) ?
        rows
            .filter(row => {
                if (row.id === 'resume') return Boolean(continueRule);

                return false;
            })
            .map(row => ({
                ...row,
                ruleId: continueRule?.id,
                rowType: 'configured-rule' as const,
                sourceGroupId: continueRule?.groupTitle?.trim() || 'configured-rules',
                sourceType: continueRule?.sourceType,
                sourceRuleId: continueRule?.id,
                subtitle: continueRule?.groupTitle?.trim() || row.subtitle,
                title: continueRule?.name || row.title
            })) :
        rows;

    return finalizeNativeHomeRows('planner-candidate:jellyfin-api', systemRows);
}

function mergeNativeHomeResumeRow(
    rows: NativeHomeRow[],
    resumeItems: PtvItem[],
    rowSettings: PtvRowsEndpointSettings | null
) {
    const resumeRows = createRows(resumeItems, [], [], [], rowSettings)
        .filter(row => row.id === 'resume');

    return orderFocusedNativeHomeRows([
        ...resumeRows,
        ...rows
    ]);
}

function getNativeHomeSupplementalCachedRows(
    cachedRows: NativeHomeRow[],
    fallbackRows: NativeHomeRow[]
) {
    return cachedRows.length ? cachedRows : fallbackRows;
}

function getEmptyRecommendationDebug(): PtvRecommendationSurfaceDebug {
    return {
        duplicateItemsRemoved: 0,
        recommendationDropReasons: [],
        recommendationRowsDropped: 0,
        recommendationRowsLoaded: 0,
        recommendationRowsRendered: 0,
        rowOverlapPercentage: 0,
        scoreDistribution: getEmptyRecommendationScoreDistribution(),
        unresolvedArtistCount: 0
    };
}

function getRecommendationSettingsRows(rowSettings: PtvRowsEndpointSettings | null) {
    if (!areRecommendationsEnabled(rowSettings)) return [];

    return getEnabledPtvPersistedRecommendationRows(rowSettings?.recommendations);
}

function createUserSpecificRecommendationRows(rowSettings: PtvRowsEndpointSettings | null): NativeHomeRow[] {
    const settingsHash = getRecommendationRowsSettingsHash(rowSettings);
    const settingsRows = getRecommendationSettingsRows(rowSettings);

    recordPtvEvent('recommendation', 'native-home-persisted-recommendations-retired', {
        enabled: areRecommendationsEnabled(rowSettings),
        reason: 'identity-scoped-engine-required',
        recommendationConfigHash: settingsHash || null,
        savedRowCount: settingsRows.length
    });

    return [];
}

function getRecommendationSettingsDropReason(row: PtvPersistedRecommendationRow) {
    if (row.enabled !== true) return 'disabled-in-recommendation-settings';
    if (row.accepted !== true) return 'generated-preview-not-accepted';
    if (row.draft === true) return 'draft-recommendation-row';
    if (!Array.isArray(row.items) || row.items.length < PTV_MIN_RECOMMENDATION_ROW_ITEMS) return 'below-minimum-items';

    return 'identity-scoped-engine-required';
}

function createUserSpecificRecommendationDebug(
    rowSettings: PtvRowsEndpointSettings | null,
    renderedRows: NativeHomeRow[]
): PtvRecommendationSurfaceDebug {
    const rawRows = Array.isArray(rowSettings?.recommendations?.rows) ? rowSettings.recommendations.rows : [];
    const renderedIds = new Set(renderedRows.map(row => toLookupKey(row.sourceRecommendationId || row.id)));
    const recommendationDropReasons = rawRows
        .filter(row => !renderedIds.has(toLookupKey(row.id)))
        .map(row => ({
            id: row.id,
            itemCount: Array.isArray(row.items) ? row.items.length : 0,
            reason: getRecommendationSettingsDropReason(row),
            title: row.title
        }));
    const renderedDiagnostics = renderedRows.map(row => getNativeHomeRowDiagnostics(row));

    return {
        duplicateItemsRemoved: renderedDiagnostics.reduce((total, row) => total + (row.dedupeRemovals || 0), 0),
        recommendationDropReasons,
        recommendationRowsDropped: recommendationDropReasons.length,
        recommendationRowsLoaded: rawRows.length,
        recommendationRowsRendered: renderedRows.length,
        rowOverlapPercentage: 0,
        scoreDistribution: getEmptyRecommendationScoreDistribution(),
        unresolvedArtistCount: 0
    };
}

function getEmptyNativeHomePerformanceDebug(): NativeHomePerformanceDebug {
    return {
        backgroundRefreshCompleted: false,
        backgroundRefreshDurationMs: null,
        backgroundRefreshStarted: false,
        cacheHeroUsed: false,
        cacheCommitDelayMs: null,
        cacheRenderMs: null,
        cacheResponseReceivedAt: null,
        cacheRowsUsed: false,
        cacheStateCommittedAt: null,
        cacheUsedForHero: false,
        cacheUsedForRows: false,
        cachedHeroCount: 0,
        cachedItemCount: 0,
        cachedRowCount: 0,
        fallbackFetchesSkipped: [],
        firstVisibleContentMs: null,
        firstInteractiveMs: null,
        homeInitialRenderMs: null,
        slowFetchesAborted: []
    };
}

function hasRenderableNativeHomeRows(rows: NativeHomeRow[]) {
    return rows.some(row => row.items.length > 0);
}

type NativeHomeDisplayIdentity = Readonly<{
    serverId: string;
    userId: string;
}>;

function getNativeHomeDisplayIdentity(): NativeHomeDisplayIdentity {
    const apiClient = getCurrentPtvApiClient();

    return {
        serverId: apiClient?.serverId?.() || '',
        userId: apiClient?.getCurrentUserId?.() || ''
    };
}

function getUnprovenOwnedHeroIds(
    sourceRows: NativeHomeRow[],
    retainedRows: NativeHomeRow[],
    independentHeroItems: PtvItem[] = [],
    includeUnclassifiedConfigured = false
) {
    const independentIds = new Set<string>();
    independentHeroItems.forEach(item => {
        if (item.Id) independentIds.add(item.Id);
    });
    retainedRows.forEach(row => {
        row.items.forEach(item => {
            if (item.Id) independentIds.add(item.Id);
        });
    });
    const unprovenIds = new Set<string>();
    sourceRows.forEach(row => {
        if (row.homeOwnershipKind !== 'library'
            && !(includeUnclassifiedConfigured && row.rowType === 'configured-rule' && row.homeOwnershipKind !== 'global')) return;
        row.items.forEach(item => {
            if (item.Id && !independentIds.has(item.Id)) unprovenIds.add(item.Id);
        });
    });
    return unprovenIds;
}

export function retainCurrentNativeHomePresentation(state: NativeHomeState, identityKey?: string | null): NativeHomeState {
    const freshness = getConfiguredRowFreshnessSnapshot();
    const library = getHomeLibraryAuthoritySnapshot();
    const isCurrentRow = (row: NativeHomeRow) => row.homeOwnershipKind === 'library'
        && !row.configuredPresentationAuthority ?
        row.source === 'featured-endpoint'
            && row.homeOwnershipGeneration === nativeHomeRouteGeneration
            && row.homeOwnershipIdentityKey === identityKey
            && row.homeOwnershipRevision === freshness.revision :
        isConfiguredRowPresentationCurrent(row, identityKey);
    const rows = state.rows.map(row => {
        // This exact live Jellyfin Resume owner has independent user authorization.
        // Retire its configured label/association without discarding playback progress.
        if (row.source !== 'resume' || row.id !== 'resume' || isCurrentRow(row)) return row;
        return { ...row, configuredPresentationAuthority: undefined, ruleId: undefined, sourceRuleId: undefined,
            rowType: 'fallback' as const, renderedSource: 'fallback' as const, sourceType: undefined,
            sourceGroupId: 'jellyfin-defaults', title: 'Continue Watching', subtitle: 'Pick up where you left off' };
    }).filter(row => isCurrentRow(row)
        && (row.source !== 'featured-cache' && row.source !== 'featured-endpoint'
            || library.identityKey === identityKey && row.homeLibraryRevision === library.revision
                && isHomeUserAccessReadyForIdentity({ currentHomeUserAccess: library.userAccess }, identityKey || null)
                && row.homeUserAccessEpoch === library.userAccess?.accessEpoch)
        && (row.homeOwnershipKind !== 'library' || row.homeOwnershipRevision === freshness.revision
            && row.homeLibraryRevision === library.revision && row.homeOwnershipIdentityKey === identityKey
            && row.homeOwnershipGeneration === nativeHomeRouteGeneration
            && library.identityKey === identityKey && !!library.topology && !library.topology.held
            && row.homeTopologyEpoch === library.topology.epoch));
    const unprovenOwnedHeroIds = getUnprovenOwnedHeroIds(state.rows, rows, state.independentHeroItems || []);
    const independentIds = new Set((state.independentHeroItems || []).map(item => item.Id));
    rows.filter(row => !row.configuredPresentationAuthority).forEach(row => {
        row.items.forEach(item => {
            independentIds.add(item.Id);
        });
    });
    const configuredHeroAuthorities = { ...state.configuredHeroAuthorities };
    state.rows.forEach(row => {
        if (row.configuredPresentationAuthority) {
            row.items.forEach(item => {
                if (item.Id) configuredHeroAuthorities[item.Id] = row.configuredPresentationAuthority!;
            });
        }
    });
    const heroIsCurrent = (item: PtvItem) => (!item.Id || !unprovenOwnedHeroIds.has(item.Id))
        && (!item.Id || independentIds.has(item.Id)
        || !configuredHeroAuthorities[item.Id] || isConfiguredRowPresentationCurrent({
            rowType: 'configured-rule', configuredPresentationAuthority: configuredHeroAuthorities[item.Id]
        }, identityKey));
    const heroAuthorityCurrent = library.identityKey === identityKey && !!library.topology
        && !library.topology.held && !!library.userAccess?.accessEpoch
        && !library.userAccess.held && library.userAccess.policyProven
        && state.heroAccessEpoch === library.userAccess.accessEpoch;
    const heroItems = heroAuthorityCurrent ? state.heroItems.filter(heroIsCurrent) : [];
    const heroItem = heroAuthorityCurrent && state.heroItem && heroIsCurrent(state.heroItem) ?
        state.heroItem : heroItems[0] || null;
    const retainedHeroIds = new Set([...heroItems, ...(heroItem ? [heroItem] : [])].map(item => item.Id));
    Object.keys(configuredHeroAuthorities).forEach(id => {
        if (!retainedHeroIds.has(id) || independentIds.has(id)) delete configuredHeroAuthorities[id];
    });
    return { ...state, rows, heroItems, heroItem, configuredHeroAuthorities };
}

function rememberUsableNativeHomeState(
    state: NativeHomeState,
    reason: string,
    identity: NativeHomeDisplayIdentity
) {
    state = retainCurrentNativeHomePresentation(state, getPtvDisplayIdentityKey(identity.serverId, identity.userId));
    if (!hasRenderableNativeHomeRows(state.rows)) return;

    const stored = lastUsableNativeHomeStates.set(identity.serverId, identity.userId, state);

    recordPtvEvent('render', 'native-home-last-good-state-updated', {
        heroItemId: state.heroItem?.Id || null,
        reason,
        rowCount: state.rows.length,
        stored
    });
}

function getLastUsableNativeHomeState(identity: NativeHomeDisplayIdentity) {
    const state = lastUsableNativeHomeStates.get(identity.serverId, identity.userId);
    if (!state) return null;
    const current = retainCurrentNativeHomePresentation(state, getPtvDisplayIdentityKey(identity.serverId, identity.userId));
    const rows = current.rows.filter(row => row.homeOwnershipKind !== 'library'
        && (row.rowType !== 'configured-rule' || row.homeOwnershipKind === 'global'));
    const unprovenHeroIds = getUnprovenOwnedHeroIds(state.rows, rows, current.independentHeroItems || [], true);
    const heroItems = current.heroItems.filter(item => !item.Id || !unprovenHeroIds.has(item.Id));
    const heroItem = current.heroItem && (!current.heroItem.Id || !unprovenHeroIds.has(current.heroItem.Id)) ?
        current.heroItem : heroItems[0] || null;
    return {
        ...current,
        heroItem,
        heroItems,
        independentHeroItems: current.independentHeroItems?.filter(item => !item.Id || !unprovenHeroIds.has(item.Id)),
        rows
    };
}

function shouldUseCachedHomeRowsWithoutFreshEndpoint(hasFeaturedCache: boolean, user: PtvUser) {
    return hasFeaturedCache && isPtvAdminUser(user);
}

function getAdaptiveNativeHomeLayout(
    rows: NativeHomeRow[],
    user: PtvUser | null,
    startedAt = performance.now()
) {
    const profile = buildNativeHomeProfile(rows, {
        save: Boolean(user?.Id),
        user
    });
    const adaptive = applyNativeHomeAdaptiveLayout(rows, profile, {
        startedAt
    });

    recordPtvEvent('render', 'native-home-adaptive-layout', {
        currentMood: adaptive.debug.currentMood,
        layoutMode: adaptive.debug.layoutMode,
        personalizationScore: adaptive.debug.personalizationScore,
        rankingMs: adaptive.debug.rankingMs,
        rowCount: adaptive.rows.length,
        seasonalContext: adaptive.debug.seasonalContext,
        topGenres: adaptive.debug.topGenres,
        topStudios: adaptive.debug.topStudios
    });

    if (adaptive.debug.rankingMs !== null) {
        recordPtvTiming('render', 'native-home-adaptive-ranking', adaptive.debug.rankingMs, {
            currentMood: adaptive.debug.currentMood,
            rowCount: adaptive.rows.length
        });
    }

    return adaptive;
}

function getNativeHomeRowLookupText(row: NativeHomeRow) {
    return [
        row.id,
        row.ruleId,
        row.source,
        row.sourceType,
        row.title,
        row.subtitle
    ].filter(Boolean).join(' ').toLowerCase();
}

function getCoreHomeRowKind(row: NativeHomeRow): typeof HOME_CORE_ROW_ORDER[number] | null {
    if (row.source === 'featured-cache' || row.source === 'featured-endpoint') return null;

    const text = getNativeHomeRowLookupText(row);

    if (row.source === 'resume' || /continue[-\s]?watching|resume/.test(text)) return 'continue-watching';
    if (row.source === 'continue-reading' || /continue[-\s]?reading/.test(text)) return 'continue-reading';
    if (row.source === 'continue-listening' || /continue[-\s]?listening/.test(text)) return 'continue-listening';
    if (row.source === 'recently-added' || /\blatest\b|recently[-\s]?added/.test(text)) return 'latest';

    return null;
}

function getHomeRecommendationRowRank(row: NativeHomeRow) {
    const rowId = toLookupKey(row.id);
    const settingsIndex = typeof row.sourceSortIndex === 'number' && row.sourceSortIndex >= 0 ?
        row.sourceSortIndex :
        null;

    if (row.source === 'recommendation' && row.accepted === true && row.persisted === true && settingsIndex !== null) {
        return settingsIndex;
    }

    const explicitRank = HOME_RECOMMENDATION_ROW_ORDER.findIndex(orderedRowId => orderedRowId === rowId);

    if (explicitRank >= 0) return explicitRank;
    if (rowId.startsWith('because-you-like-')) return HOME_RECOMMENDATION_ROW_ORDER.length;
    if (rowId.startsWith('because-you-listen-to-')) return HOME_RECOMMENDATION_ROW_ORDER.length + 1;
    if (row.source === 'recommendation') return HOME_RECOMMENDATION_ROW_ORDER.length + 2;

    return -1;
}

function getFocusedHomeRowRank(row: NativeHomeRow) {
    const coreKind = getCoreHomeRowKind(row);
    const coreRank = coreKind ? HOME_CORE_ROW_ORDER.indexOf(coreKind) : -1;

    if (coreRank >= 0) return coreRank;

    const recommendationRank = getHomeRecommendationRowRank(row);

    if (recommendationRank >= 0) {
        return HOME_CORE_ROW_ORDER.length + recommendationRank;
    }

    return HOME_CORE_ROW_ORDER.length + HOME_RECOMMENDATION_ROW_ORDER.length;
}

function isAllowedHomeRecommendationRow(row: NativeHomeRow) {
    return row.source !== 'recommendation'
        || (
            row.rowType === 'generated-recommendation'
            && row.accepted === true
            && row.persisted === true
            && row.renderedButMissingFromRecommendationSettings !== true
            && row.items.length >= PTV_MIN_RECOMMENDATION_ROW_ITEMS
        );
}

function isFixedNativeHomeUtilityRow(row: NativeHomeRow) {
    return row.source === 'next-up'
        || row.source === 'libraries'
        || row.id === 'next-up'
        || row.id === 'libraries';
}

function compareFocusedNativeHomeRows(left: NativeHomeRow, right: NativeHomeRow) {
    return getFocusedHomeRowRank(left) - getFocusedHomeRowRank(right);
}

function getNativeHomeRowDedupeKey(row: NativeHomeRow) {
    return getCoreHomeRowKind(row)
        || (row.source === 'recommendation' ? row.id : '')
        || row.id
        || toLookupKey(row.title);
}

function orderFocusedNativeHomeRows(rows: NativeHomeRow[]) {
    const seenKeys = new Set<string>();

    return rows
        .filter(row => !isFixedNativeHomeUtilityRow(row))
        .filter(isAllowedHomeRecommendationRow)
        .filter(row => {
            const key = getNativeHomeRowDedupeKey(row);

            if (!key) return true;
            if (seenKeys.has(key)) return false;

            seenKeys.add(key);
            return true;
        })
        .map((row, index) => ({ index, row }))
        .sort((left, right) => compareFocusedNativeHomeRows(left.row, right.row) || left.index - right.index)
        .map(entry => entry.row);
}

function findLastNativeHomeRowIndex(rows: NativeHomeRow[], predicate: (row: NativeHomeRow) => boolean) {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (predicate(rows[index])) return index;
    }

    return -1;
}

function insertNativeHomeRecommendationRows(rows: NativeHomeRow[], recommendationRows: NativeHomeRow[]) {
    if (!recommendationRows.length) return orderFocusedNativeHomeRows(rows);

    const existingRows = rows.filter(row => row.source !== 'recommendation');
    const latestIndex = findLastNativeHomeRowIndex(existingRows, row => getCoreHomeRowKind(row) === 'latest');
    const continueIndex = findLastNativeHomeRowIndex(existingRows, row => Boolean(getCoreHomeRowKind(row)));
    let targetIndex = existingRows.length;

    if (latestIndex >= 0) {
        targetIndex = latestIndex + 1;
    } else if (continueIndex >= 0) {
        targetIndex = continueIndex + 1;
    }

    return orderFocusedNativeHomeRows([
        ...existingRows.slice(0, targetIndex),
        ...recommendationRows,
        ...existingRows.slice(targetIndex)
    ]);
}

type FeaturedSectionEntry = {
    index: number;
    section: unknown;
    sectionId: string;
};

function getFeaturedSectionEntries(payload: FeaturedPayload, sections: unknown[]): FeaturedSectionEntry[] {
    if (sections.length) {
        return sections
            .map((section, index) => ({
                index,
                section,
                sectionId: getSectionId(section)
            }))
            .filter(entry => Boolean(entry.sectionId));
    }

    return Object.keys(payload.sectionItems)
        .map((sectionId, index) => ({
            index,
            section: null,
            sectionId
        }));
}

function getFeaturedSectionItems(payload: FeaturedPayload, entry: FeaturedSectionEntry) {
    const sectionItems = payload.sectionItems[entry.sectionId];

    if (Array.isArray(sectionItems)) return sectionItems;
    if (isRecord(entry.section) && Array.isArray(entry.section.items)) return entry.section.items;

    return [];
}

function getFeaturedSafeRowIdSuffix(value: string) {
    let suffix = '';
    let previousWasDash = false;

    Array.from(value).forEach(char => {
        const isSafeChar = (char >= 'a' && char <= 'z')
            || (char >= 'A' && char <= 'Z')
            || (char >= '0' && char <= '9')
            || char === '_'
            || char === '-';

        if (isSafeChar) {
            suffix += char;
            previousWasDash = char === '-';
            return;
        }

        if (!previousWasDash) {
            suffix += '-';
            previousWasDash = true;
        }
    });

    while (suffix.startsWith('-')) {
        suffix = suffix.slice(1);
    }

    while (suffix.endsWith('-')) {
        suffix = suffix.slice(0, -1);
    }

    return suffix;
}

function getFeaturedSectionRowId(entry: FeaturedSectionEntry) {
    const explicitRowId = isRecord(entry.section) ? getRecordString(entry.section, 'rowId', 'RowId', 'rowKey', 'RowKey') : '';

    if (explicitRowId) return `featured-${explicitRowId}`;

    const rawSuffix = [
        entry.sectionId,
        getSectionRecommendationId(entry.section),
        getSectionRuleId(entry.section),
        getSectionSourceType(entry.section),
        getSectionSourceValue(entry.section)
    ]
        .filter(Boolean)
        .join('-');
    const suffix = getFeaturedSafeRowIdSuffix(rawSuffix);
    const fallbackSuffix = `section-${entry.index + 1}`;

    return `featured-${suffix || fallbackSuffix}`;
}

function getFeaturedSectionDedupeKey(entry: FeaturedSectionEntry) {
    const explicitRowId = isRecord(entry.section) ? getRecordString(entry.section, 'rowId', 'RowId', 'rowKey', 'RowKey') : '';

    return [
        explicitRowId,
        entry.sectionId,
        getSectionRecommendationId(entry.section),
        getSectionRuleId(entry.section),
        getSectionSourceType(entry.section),
        getSectionSourceValue(entry.section),
        getSectionTitle(entry.section, entry.sectionId)
    ]
        .map(toLookupKey)
        .filter(Boolean)
        .join(':');
}

function getFeaturedRecommendationAcceptance(
    payload: FeaturedPayload,
    entry: FeaturedSectionEntry,
    rowSettings: PtvRowsEndpointSettings | null,
    recommendationId: string
) {
    if (!rowSettings || !rowSettings.recommendations) {
        return {
            reason: 'recommendation-settings-missing',
            row: null
        };
    }

    if (!areRecommendationsEnabled(rowSettings)) {
        return {
            reason: 'recommendations-disabled',
            row: null
        };
    }

    const savedRecommendationRow = getMatchingRecommendationRow(rowSettings, recommendationId);

    if (!savedRecommendationRow) {
        return {
            reason: 'saved-recommendation-row-disabled-draft-or-missing',
            row: null
        };
    }

    const uniqueItemCount = dedupeNativeHomeRecommendationItems(getFeaturedSectionItems(payload, entry) as PtvItem[]).length;

    if (uniqueItemCount < PTV_MIN_RECOMMENDATION_ROW_ITEMS) {
        return {
            reason: 'below-minimum-items-after-dedupe',
            row: null
        };
    }

    return {
        reason: '',
        row: savedRecommendationRow
    };
}

function getFeaturedRecommendationCacheAcceptance(
    payload: FeaturedPayload,
    entry: FeaturedSectionEntry,
    rowSettings: PtvRowsEndpointSettings | null,
    recommendationId: string,
    canValidateConfiguredRows: boolean
) {
    const uniqueItemCount = dedupeNativeHomeRecommendationItems(getFeaturedSectionItems(payload, entry) as PtvItem[]).length;
    const savedRow = canValidateConfiguredRows ?
        getFeaturedRecommendationAcceptance(payload, entry, rowSettings, recommendationId).row :
        null;

    recordPtvEvent('render', 'native-home-shared-recommendation-cache-skipped', {
        canValidateConfiguredRows,
        hasSavedRow: Boolean(savedRow),
        recommendationId,
        sectionId: entry.sectionId,
        uniqueItemCount
    });

    if (uniqueItemCount < PTV_MIN_RECOMMENDATION_ROW_ITEMS) {
        return {
            reason: 'below-minimum-items-after-dedupe',
            row: null
        };
    }

    return {
        reason: 'shared-recommendation-cache-skipped-user-specific-required',
        row: null
    };
}

const HOME_SCOPE_ID = /^[0-9a-f]{32}$/;
const HOME_ASSOCIATION_TOKEN = /^[0-9a-f]{64}$/;

function getRestrictedHomeStructuralScope(mediaType: unknown) {
    if (mediaType === 'movies') return { expectedCollectionType: 'movies' as const, structuralTypes: [ 'Movie' as const ] };
    if (mediaType === 'music') return { expectedCollectionType: 'music' as const, structuralTypes: [ 'MusicAlbum' as const ] };
    if (mediaType === 'shows' || mediaType === 'anime' || mediaType === 'cartoons') {
        return { expectedCollectionType: 'tvshows' as const, structuralTypes: [ 'Series' as const ] };
    }
    return null;
}

function isLegacyUnscopedGlobalSection(
    settings: PtvRowsEndpointSettings,
    rule: PtvRowBuilderRule,
    section: Record<string, unknown>,
    payload: FeaturedPayload
) {
    const schemaVersion = settings.schemaVersion;
    return typeof schemaVersion === 'number' && schemaVersion < 3
        && payload.scopeSchemaVersion == null && (payload.rowConfigVersion == null || payload.rowConfigVersion < 3)
        && !rule.libraryScope
        && normalizePtvRowLibraryScope(rule as Record<string, unknown>, schemaVersion).mode === 'global'
        && rule.sourceType !== 'library' && section.sourceType !== 'library'
        && section.scopeType == null && section.libraryId == null
        && section.bindingKey == null && section.resolvedScopeHash == null;
}

// Restricted users cannot read Row Builder settings. A current, authenticated
// v9 Featured response supplies their section scope claim; fresh topology and membership
// is still proved independently before this row can reach Home state.
function resolveRestrictedFreshOwnedClaim(
    payload: FeaturedPayload | null,
    section: unknown,
    sectionId: string,
    topology: CurrentHomeTopology | null = null
): HomeLibraryOwnershipClaim {
    const source = isRecord(section) ? section : null;
    const marker = isRecord(source?.configuredRowAssociation) ? source.configuredRowAssociation : null;
    const authority = isRecord(payload?.currentPresentationAuthority) ? payload.currentPresentationAuthority : null;
    const version = isRecord(payload) ? (payload as Record<string, unknown>).homeFeaturedCacheVersion : undefined;
    const libraryId = source?.libraryId;
    const mediaType = source?.mediaType;
    const redactedProjection = source?.source === 'authorized'
        && source.sourceRuleId == null && source.ruleId == null && source.rowConfigHash == null;
    const fullProjection = typeof source?.source === 'string' && Boolean(source.source.trim())
        && typeof source.sourceRuleId === 'string' && Boolean(source.sourceRuleId.trim())
        && source.ruleId === source.sourceRuleId
        && source.rowConfigHash === payload?.rowConfigHash;
    const structural = getRestrictedHomeStructuralScope(mediaType);
    if (version !== 9 || payload?.scopeSchemaVersion !== 2 || payload.rowConfigVersion !== 3
        || !payload.rowConfigHash || !source || source.id !== sectionId
        || source.rowType !== 'configured-rule' || (!redactedProjection && !fullProjection)
        || typeof source.sourceType !== 'string' || !source.sourceType.trim()
        || source.scopeType !== 'library' || typeof libraryId !== 'string' || !HOME_SCOPE_ID.test(libraryId)
        || !structural || typeof source.resolvedScopeHash !== 'string'
        || !/^\d+$/.test(source.resolvedScopeHash)
        || source.rowConfigHash != null && source.rowConfigHash !== payload.rowConfigHash
        || !authority || Object.keys(authority).length !== 3 || authority.version !== 1
        || !HOME_ASSOCIATION_TOKEN.test(String(authority.scope))
        || !HOME_ASSOCIATION_TOKEN.test(String(authority.generation))
        || !marker || Object.keys(marker).length !== 4 || marker.version !== 1
        || !HOME_ASSOCIATION_TOKEN.test(String(marker.scope))
        || marker.scope !== authority.scope
        || !HOME_ASSOCIATION_TOKEN.test(String(marker.rule))
        || !HOME_ASSOCIATION_TOKEN.test(String(marker.section))) {
        return { kind: 'rejected', reason: 'home-scope-unresolved' };
    }
    if (topology && !matchesHomeTopologyClaim(source, topology)) return { kind: 'rejected', reason: 'home-topology-unproven' };
    return { kind: 'library', libraryId, ruleId: typeof source.sourceRuleId === 'string' ?
        source.sourceRuleId : marker.rule as string, sectionId, ...structural };
}

export function createRowsFromFeaturedPayload(
    payload: FeaturedPayload | null,
    options: {
        configuredProof?: ConfiguredRowProof | null;
        rowSettings?: PtvRowsEndpointSettings | null;
        source?: Extract<NativeHomeRowSource, 'featured-cache' | 'featured-endpoint'>;
        studioMap?: Map<string, string> | null;
        restrictedOwnedEndpoint?: boolean;
    } = {}
): NativeHomeFeaturedRowsResult {
    if (!payload?.sectionItems) {
        return {
            rows: [],
            skippedRows: []
        };
    }

    const sections = Array.isArray(payload.sections) ? payload.sections : [];
    const rowSettings = options.rowSettings || null;
    const configuredRowsEnabled = shouldRenderConfiguredRows(rowSettings);
    const enabledRules = (configuredRowsEnabled ? getEnabledRowRules(rowSettings) : [])
        .sort((left, right) => (left.sortPriority || 0) - (right.sortPriority || 0));
    const canValidateConfiguredRows = configuredRowsEnabled && shouldUseSavedRowRules(rowSettings) && enabledRules.length > 0;
    const disabledRules = Array.isArray(rowSettings?.rules) ?
        rowSettings.rules.filter(rule => rule?.enabled === false) :
        [];
    const enabledRulesById = new Map(
        enabledRules
            .filter(rule => rule.id)
            .map(rule => [toLookupKey(rule.id || ''), rule])
    );
    const disabledRuleIds = new Set(
        disabledRules
            .map(rule => toLookupKey(rule.id || ''))
            .filter(Boolean)
    );
    const renderedRuleCounts = new Map<string, number>();
    const associationResolver = createConfiguredRowAssociationResolver(rowSettings, sections);
    const sectionEntries = getFeaturedSectionEntries(payload, sections);
    const expandedRowsBeforeDedupe = sectionEntries
        .slice(0, MAX_CACHED_ROWS);
    const seenSectionKeys = new Set<string>();
    const dedupedSectionEntries = expandedRowsBeforeDedupe
        .filter(entry => {
            const key = getFeaturedSectionDedupeKey(entry);

            if (seenSectionKeys.has(key)) return false;

            seenSectionKeys.add(key);
            return true;
        });
    const skippedRows: NativeHomeSkippedRow[] = [];

    if (shouldCollectDiagnostics()) {
        logRowRulesPipeline('expandedRowsBeforeDedupe', expandedRowsBeforeDedupe.map(entry => {
            const rowType = getSectionRowType(entry.section);

            return {
                cacheHash: getSectionCacheHash(entry.section, payload, rowType) || null,
                configHash: getSectionConfigHash(entry.section, payload, rowType) || null,
                enabled: getSectionEnabled(entry.section),
                itemCount: getFeaturedSectionItems(payload, entry).length,
                rowId: getFeaturedSectionRowId(entry),
                rowType,
                ruleId: getSectionRuleId(entry.section),
                sectionId: entry.sectionId,
                source: isRecord(entry.section) ? getRecordString(entry.section, 'source', 'Source') : '',
                sourceCacheSectionId: entry.sectionId,
                sourceConfigHash: payload.rowConfigHash || null,
                sourceGroupId: getSectionGroupId(entry.section) || null,
                sourceRecommendationId: getSectionRecommendationId(entry.section) || null,
                sourceRuleId: getSectionRuleId(entry.section),
                sourceType: getSectionSourceType(entry.section),
                title: getSectionTitle(entry.section, entry.sectionId)
            };
        }));
        logRowRulesPipeline('dedupedRows', dedupedSectionEntries.map(entry => {
            const rowType = getSectionRowType(entry.section);

            return {
                cacheHash: getSectionCacheHash(entry.section, payload, rowType) || null,
                configHash: getSectionConfigHash(entry.section, payload, rowType) || null,
                enabled: getSectionEnabled(entry.section),
                itemCount: getFeaturedSectionItems(payload, entry).length,
                rowId: getFeaturedSectionRowId(entry),
                rowType,
                ruleId: getSectionRuleId(entry.section),
                sectionId: entry.sectionId,
                source: isRecord(entry.section) ? getRecordString(entry.section, 'source', 'Source') : '',
                sourceCacheSectionId: entry.sectionId,
                sourceConfigHash: payload.rowConfigHash || null,
                sourceGroupId: getSectionGroupId(entry.section) || null,
                sourceRecommendationId: getSectionRecommendationId(entry.section) || null,
                sourceRuleId: getSectionRuleId(entry.section),
                sourceType: getSectionSourceType(entry.section),
                title: getSectionTitle(entry.section, entry.sectionId)
            };
        }));
    }

    if (rowSettings && rowSettings.enabled === false) {
        dedupedSectionEntries
            .forEach(entry => {
                const rowType = getSectionRowType(entry.section);

                skippedRows.push({
                    cacheHash: getSectionCacheHash(entry.section, payload, rowType) || undefined,
                    configHash: getSectionConfigHash(entry.section, payload, rowType) || undefined,
                    enabled: getSectionEnabled(entry.section),
                    id: getFeaturedSectionRowId(entry),
                    itemCount: getFeaturedSectionItems(payload, entry).length,
                    reason: 'row-builder-disabled',
                    rowType,
                    ruleId: getSectionRuleId(entry.section),
                    sourceCacheSectionId: entry.sectionId,
                    sourceConfigHash: payload.rowConfigHash,
                    sourceGroupId: getSectionGroupId(entry.section) || undefined,
                    sourceRuleId: getSectionRuleId(entry.section),
                    title: getSectionTitle(entry.section, entry.sectionId)
                });
            });

        return {
            rows: [],
            skippedRows
        };
    }

    const acceptedEntries = dedupedSectionEntries.reduce<Array<{
        association?: Extract<ConfiguredRowAssociationResult, { kind: 'matched' }>;
        entry: FeaturedSectionEntry;
        recommendationId?: string;
        recommendationRow?: PtvPersistedRecommendationRow | null;
        rule?: PtvRowBuilderRule | null;
    }>>((accepted, entry) => {
        const sectionId = entry.sectionId;
        const section = entry.section;
        const recommendationId = getSectionRecommendationId(section);
        const parentRuleId = getSectionParentRuleId(section);
        const rowType = getSectionRowType(section);
        const association = rowType === 'configured-rule' ? associationResolver.resolve(section) : null;
        const ruleId = association?.kind === 'matched' ? association.ruleId : getSectionRuleId(section);
        const title = getSectionTitle(section, sectionId);
        const ruleKey = toLookupKey(ruleId);
        const parentRuleKey = toLookupKey(parentRuleId);
        const enabledRule = getMatchingRowRule(enabledRules, ruleId);
        const restrictedOwned = options.restrictedOwnedEndpoint === true
            && options.source === 'featured-endpoint'
            && !rowSettings
            && resolveRestrictedFreshOwnedClaim(payload, section, sectionId).kind === 'library';
        const skipRow = (reason: string, skippedRuleId = ruleId || parentRuleId) => {
            const rowType = getSectionRowType(section);
            const rowItems = getFeaturedSectionItems(payload, entry);

            skippedRows.push({
                cacheHash: getSectionCacheHash(section, payload, rowType) || undefined,
                configHash: getSectionConfigHash(section, payload, rowType) || undefined,
                enabled: getSectionEnabled(section),
                id: getFeaturedSectionRowId(entry),
                itemCount: rowItems.length,
                reason,
                rowType,
                ruleId: skippedRuleId,
                sourceCacheSectionId: sectionId,
                sourceConfigHash: payload.rowConfigHash,
                sourceGroupId: getSectionGroupId(section) || undefined,
                sourceRecommendationId: recommendationId || undefined,
                sourceRuleId: ruleId || undefined,
                title
            });
        };

        if (!getSectionEnabled(section)) {
            skipRow('section-disabled');
            return accepted;
        }

        if (rowType === 'configured-rule' && !configuredRowsEnabled && !restrictedOwned) {
            skipRow('configured-row-home-output-disabled');
            return accepted;
        }

        if (association?.kind === 'rejected' && !restrictedOwned) {
            skipRow(association.reason);
            return accepted;
        }

        if (rowType === 'configured-rule' && !restrictedOwned && (association?.kind !== 'matched'
            || !isConfiguredPayloadVerified(payload, options.configuredProof)
            || !isConfiguredSectionVerified(section, options.configuredProof))) {
            skipRow('configured-authority-unverified');
            return accepted;
        }

        if (association?.kind === 'matched' && recommendationId) {
            skipRow('configured-association-row-kind-invalid');
            return accepted;
        }

        if (recommendationId) {
            const acceptance = getFeaturedRecommendationCacheAcceptance(
                payload,
                entry,
                rowSettings,
                recommendationId,
                canValidateConfiguredRows
            );

            if (acceptance.reason) {
                skipRow(acceptance.reason || 'recommendation-row-not-accepted');
                return accepted;
            }

            accepted.push({
                entry,
                recommendationId,
                recommendationRow: acceptance.row
            });

            return accepted;
        }

        if (!canValidateConfiguredRows) {
            if (rowType === 'configured-rule' && !restrictedOwned) {
                skipRow('configured-row-requires-current-row-builder-settings');
                return accepted;
            }

            accepted.push({ entry });
            return accepted;
        }

        if (rowType !== 'configured-rule') {
            accepted.push({ entry });
            return accepted;
        }

        if (!ruleKey) {
            skipRow(parentRuleKey ? 'derived-row-without-source-rule' : 'missing-source-rule');
            return accepted;
        }

        if (disabledRuleIds.has(ruleKey)) {
            skipRow('configured-row-disabled', ruleId);
            return accepted;
        }

        if (!enabledRule || !enabledRulesById.has(ruleKey)) {
            skipRow('not-enabled-in-row-builder', ruleId);
            return accepted;
        }

        const renderedCount = renderedRuleCounts.get(ruleKey) || 0;
        const rowLimit = getRuleRowLimit(enabledRule);

        if (renderedCount >= rowLimit) {
            skipRow('configured-row-limit-reached', ruleId);
            return accepted;
        }

        renderedRuleCounts.set(ruleKey, renderedCount + 1);
        accepted.push({
            association: association?.kind === 'matched' ? association : undefined,
            entry,
            rule: enabledRule
        });

        return accepted;
    }, []);

    const rows: NativeHomeRow[] = acceptedEntries
        .map(({ association, entry, recommendationId, recommendationRow, rule }, index) => {
            const sectionId = entry.sectionId;
            const section = entry.section;
            const rawItems = getFeaturedSectionItems(payload, entry);
            const rowId = association ? `featured-associated-${association.section}` : getFeaturedSectionRowId(entry);
            const rowType = getSectionRowType(section);
            const ruleId = association?.ruleId || getSectionRuleId(section);
            const sourceType = getSectionSourceType(section);
            const redactedAssociation = Boolean(association && isRecord(section) && getRecordString(section, 'source', 'Source') === 'authorized');
            const singleConfiguredRow = Boolean(rule && getRuleRowLimit(rule) === 1 && !rule.includeSubgenres);
            const title = redactedAssociation && singleConfiguredRow && rule?.name?.trim() ?
                rule.name.trim() :
                getSectionTitle(section, sectionId || `Featured ${index + 1}`);
            // Private derived selectors remain redacted; association does not recreate them.
            const sourceValue = redactedAssociation ? '' : resolveNativeHomeDerivedRowSourceValue({
                ruleSourceValue: rule?.sourceValue,
                sectionSourceValue: getSectionExplicitSourceValue(section) || getSectionSourceValue(section),
                sourceType,
                title
            });
            const mediaType = getSectionMediaType(section);
            const rowItems = recommendationId ? dedupeNativeHomeRecommendationItems(rawItems as PtvItem[]) : dedupeNativeHomeItems(rawItems as PtvItem[]);
            const localDedupeRemovals = rawItems.length - rowItems.length;
            const configuredLimit = recommendationRow ? recommendationRow.items.length : getRuleItemLimit(rule);
            const items = configuredLimit ? rowItems.slice(0, configuredLimit) : rowItems;
            const moreUrl = getNativeHomeFeaturedRowMoreUrl({
                rowItems: rowItems as Array<PtvItem | PtvLibrary>,
                section,
                sourceType,
                sourceValue,
                studioMap: options.studioMap
            });
            const configHash = getSectionConfigHash(section, payload, rowType) || undefined;
            const cacheHash = getSectionCacheHash(section, payload, rowType) || configHash;
            const recommendationDiagnostics = recommendationRow?.diagnostics;
            const candidateCount = getSectionNumber(section, 'candidateCount', 'CandidateCount')
                ?? recommendationDiagnostics?.candidateCount
                ?? (recommendationId ? rawItems.length : undefined);
            const dedupeRemovals = getSectionNumber(section, 'dedupeRemovals', 'DedupeRemovals')
                ?? recommendationDiagnostics?.dedupeRemovals
                ?? (localDedupeRemovals > 0 ? localDedupeRemovals : undefined);
            const hydrationRemovals = getSectionNumber(section, 'hydrationRemovals', 'HydrationRemovals')
                ?? recommendationDiagnostics?.hydrationRemovals
                ?? (recommendationId ? 0 : undefined);
            const finalRenderedCount = getSectionNumber(section, 'finalRenderedCount', 'FinalRenderedCount')
                ?? recommendationDiagnostics?.finalRenderedCount
                ?? items.length;
            const sourceGroupTitle = getSectionGroupTitle(section)
                || (rowType === 'generated-recommendation' ? 'Recommendation Rows' : rule?.groupTitle?.trim())
                || '';
            const sourceGroupId = getSectionGroupId(section)
                || (rowType === 'generated-recommendation' ? 'recommendation-rows' : rule?.groupTitle?.trim())
                || (rowType === 'configured-rule' ? 'configured-rules' : 'featured-cache');

            recordPtvEvent('render', 'native-home-featured-row-items', {
                cacheHash: cacheHash || null,
                candidateCount: candidateCount ?? null,
                configHash: configHash || null,
                configuredLimit: configuredLimit || null,
                dedupeRemovals: dedupeRemovals ?? (localDedupeRemovals > 0 ? localDedupeRemovals : null),
                enabled: getSectionEnabled(section),
                finalRenderedCount,
                hydrationRemovals: hydrationRemovals ?? null,
                itemCountFromApi: rawItems.length,
                itemCountRendered: items.length,
                matchedRecommendationId: recommendationId || null,
                matchedRuleId: rule?.id || null,
                moreUrl: moreUrl || null,
                ruleId,
                rowId,
                rowSource: options.source || 'featured-cache',
                rowTitle: title,
                rowType,
                sourceCacheSectionId: sectionId,
                sourceConfigHash: configHash || payload.rowConfigHash || null,
                sourceGroupId,
                sourceGroupTitle: sourceGroupTitle || null,
                sourceRecommendationId: recommendationId || null,
                sourceRuleId: rowType === 'generated-recommendation' ? null : rule?.id || ruleId,
                sourceType,
                sourceValue,
                stage: 'featured-endpoint-row-items'
            });

            return {
                configuredPresentationAuthority: rowType === 'configured-rule' ?
                    getConfiguredRowProofAuthority(options.configuredProof) : undefined,
                accepted: rowType === 'generated-recommendation' ?
                    Boolean(recommendationRow?.accepted) :
                    (rowType === 'configured-rule' ? Boolean(rule) : undefined),
                cacheHash,
                candidateCount,
                configHash,
                dedupeRemovals,
                enabled: getSectionEnabled(section),
                finalRenderedCount,
                generatedAt: recommendationRow?.generatedAt ?? null,
                hydrationRemovals,
                id: rowId,
                items: items as PtvItem[],
                kind: 'items' as const,
                mediaType: mediaType || undefined,
                moreUrl: moreUrl || undefined,
                persisted: rowType === 'generated-recommendation' ?
                    Boolean(recommendationRow) :
                    (rowType === 'configured-rule' ? Boolean(rule) : undefined),
                recommendationConfigHash: rowType === 'generated-recommendation' ? configHash : undefined,
                renderedButMissingFromRecommendationSettings: rowType === 'generated-recommendation' && !recommendationRow,
                renderedSource: rowType === 'generated-recommendation' ?
                    (recommendationRow ? 'recommendation-settings' as const : 'cache' as const) :
                    (rowType === 'configured-rule' ? 'row-builder' as const : 'cache' as const),
                rowConfigHash: rowType === 'configured-rule' ? configHash : undefined,
                rowType,
                ruleId: rowType === 'generated-recommendation' ? undefined : ruleId || undefined,
                source: options.source || 'featured-cache' as const,
                sourceCacheSectionId: sectionId,
                sourceConfigHash: configHash || payload.rowConfigHash,
                sourceGroupId,
                sourceGroupTitle: sourceGroupTitle || undefined,
                sourceRecommendationId: recommendationId,
                sourceRuleId: rowType === 'generated-recommendation' ? undefined : rule?.id || ruleId || undefined,
                sourceType,
                sourceValue: sourceValue || undefined,
                subtitle: getSectionSubtitle(section),
                title
            };
        });

    if (shouldCollectDiagnostics()) {
        logRowRulesPipeline('finalSections', rows.map(row => ({
            ...getNativeHomeRowDiagnostics(row),
            ruleId: row.ruleId,
            source: row.source,
            sourceCacheSectionId: row.sourceCacheSectionId,
            sourceConfigHash: row.sourceConfigHash,
            sourceType: row.sourceType,
            subtitle: row.subtitle,
            title: row.title
        })));
    }

    const finalizedRows = finalizeNativeHomeRows(`planner-candidate:${options.source || 'featured-cache'}`, rows);

    rows.forEach(row => {
        const filteredReason = getRowFilteredReason(row);

        if (filteredReason) {
            const rowDiagnostics = getNativeHomeRowDiagnostics(row);

            skippedRows.push({
                cacheHash: rowDiagnostics.cacheHash || undefined,
                configHash: rowDiagnostics.configHash || undefined,
                enabled: rowDiagnostics.enabled,
                id: row.id,
                itemCount: rowDiagnostics.itemCount,
                reason: filteredReason,
                rowType: rowDiagnostics.rowType,
                ruleId: row.ruleId,
                sourceGroupId: rowDiagnostics.sourceGroupId || undefined,
                sourceRecommendationId: rowDiagnostics.sourceRecommendationId || undefined,
                sourceRuleId: rowDiagnostics.sourceRuleId || undefined,
                title: row.title
            });
        }
    });

    return {
        rows: finalizedRows,
        skippedRows
    };
}

function countRowsByRule(rows: NativeHomeRow[]) {
    return rows.reduce<Record<string, number>>((counts, row) => {
        if (!row.ruleId) return counts;

        counts[row.ruleId] = (counts[row.ruleId] || 0) + 1;

        return counts;
    }, {});
}

function getSkippedRules(settings: PtvRowsEndpointSettings | null, rows: NativeHomeRow[], skippedRows: NativeHomeSkippedRow[]) {
    if (!shouldRenderConfiguredRows(settings)) return [];

    const renderedRuleIds = new Set(rows.map(row => row.ruleId).filter(Boolean));
    const handledRuleKeys = new Set([
        ...rows.flatMap(row => [
            row.id,
            row.id.replace(/^featured-/, ''),
            row.ruleId || '',
            row.title
        ]),
        ...skippedRows.flatMap(row => [
            row.id,
            row.id.replace(/^featured-/, ''),
            row.ruleId || '',
            row.title
        ])
    ].map(toLookupKey).filter(Boolean));

    return getEnabledRowRules(settings)
        .filter(rule => {
            const ruleId = rule.id || '';
            const ruleName = rule.name || '';

            return Boolean(ruleId || ruleName)
                && !renderedRuleIds.has(ruleId)
                && !handledRuleKeys.has(toLookupKey(ruleId))
                && !handledRuleKeys.has(toLookupKey(ruleName));
        })
        .map(rule => ({
            id: rule.id,
            reason: 'no-rendered-row',
            sourceType: rule.sourceType,
            title: rule.name || rule.id
        }));
}

function recordRowRulesDebug(
    settings: PtvRowsEndpointSettings | null,
    expandedRows: NativeHomeRow[],
    skippedRows: NativeHomeSkippedRow[],
    finalRows: NativeHomeRow[]
) {
    if (!shouldCollectDiagnostics()) return;

    const enabledRules = getEnabledRowRules(settings);
    const savedRules = Array.isArray(settings?.rules) ? settings.rules : [];
    const expandedRowSummary = expandedRows.map(row => ({
        ...getNativeHomeRowDiagnostics(row),
        renderedSource: getNativeHomeRowDiagnostics(row).source,
        ruleId: row.ruleId,
        source: row.source,
        sourceCacheSectionId: row.sourceCacheSectionId || null,
        sourceConfigHash: row.sourceConfigHash || null,
        sourceType: row.sourceType,
        title: row.title
    }));
    const finalSectionSummary = finalRows.map(row => ({
        ...getNativeHomeRowDiagnostics(row),
        renderedSource: getNativeHomeRowDiagnostics(row).source,
        ruleId: row.ruleId,
        source: row.source,
        sourceCacheSectionId: row.sourceCacheSectionId || null,
        sourceConfigHash: row.sourceConfigHash || null,
        sourceType: row.sourceType,
        subtitle: row.subtitle,
        title: row.title
    }));

    const detail = {
        dedupedRows: expandedRowSummary,
        enabledRulesCount: enabledRules.length,
        expandedRowsBeforeDedupe: expandedRowSummary,
        expandedRowsCount: expandedRows.length,
        finalSections: finalSectionSummary,
        finalRenderedRowIds: finalRows.map(row => row.id),
        finalRenderedTitles: finalRows.map(row => row.title),
        rowSourceAudit: finalSectionSummary.map(row => ({
            cacheHash: row.cacheHash,
            configHash: row.configHash,
            enabled: row.enabled,
            itemCount: row.itemCount,
            rowId: row.rowId,
            rowTitle: row.title,
            rowType: row.rowType,
            renderedButMissingFromRecommendationSettings: row.renderedButMissingFromRecommendationSettings,
            renderedSource: row.renderedSource,
            sourceCacheSectionId: row.sourceCacheSectionId,
            sourceConfigHash: row.sourceConfigHash,
            sourceGroupId: row.sourceGroupId,
            sourceRecommendationId: row.sourceRecommendationId,
            sourceRuleId: row.sourceRuleId
        })),
        perRuleGeneratedRowCount: countRowsByRule(expandedRows),
        renderedRows: finalSectionSummary,
        rawSavedRules: savedRules,
        savedRules,
        skippedRows,
        skippedRules: getSkippedRules(settings, finalRows, skippedRows),
        useSavedRowRules: shouldUseSavedRowRules(settings)
    };

    if (shouldCollectDiagnostics()) {
        console.debug('[PTV Row Rules] savedRules', savedRules);
        console.debug('[PTV Row Rules] renderedRows', finalSectionSummary);
    }

    recordPtvEvent('render', 'native-home-row-rules-debug', detail);
}

type NativeRowFetchOptions = {
    onTimeout?: (name: string) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
};

export function createNativeRowFetch<T>(
    name: string,
    task: (signal: AbortSignal) => Promise<T>,
    fallback: T,
    options: NativeRowFetchOptions = {}
): Promise<T> {
    const timeoutMs = options.timeoutMs || 0;
    const requestController = createPtvAbortController();
    const run = () => timePtvAsync('row-fetch', name, () => task(requestController.signal))
        .catch(() => fallback);

    if (options.signal?.aborted) {
        requestController.abort();
        return Promise.resolve(fallback);
    }

    if (!timeoutMs && !options.signal) return run();

    return new Promise(resolve => {
        let settled = false;
        let timeoutId: number | null = null;
        const cleanup = () => {
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
                timeoutId = null;
            }
            options.signal?.removeEventListener('abort', onParentAbort);
        };
        const finish = (value: T) => {
            if (settled) return;

            settled = true;
            cleanup();
            resolve(value);
        };
        const onParentAbort = () => {
            requestController.abort();
            finish(fallback);
        };

        options.signal?.addEventListener('abort', onParentAbort, { once: true });

        const request = run();

        if (timeoutMs) {
            timeoutId = window.setTimeout(() => {
                if (settled) return;

                requestController.abort();
                options.onTimeout?.(name);
                recordPtvEvent('row-fetch', 'native-home-slow-fetch-timed-out', {
                    fetchName: name,
                    timeoutMs
                });
                finish(fallback);
            }, timeoutMs);
        }

        request
            .then(finish)
            .catch(() => finish(fallback));
    });
}

function emptyPtvItemsResult() {
    return Promise.resolve({ Items: [] as PtvItem[] });
}

async function readNativeHomeConfiguredAuthority(signal: AbortSignal) {
    const pluginApi = getCurrentPtvPluginApiClient();
    if (!pluginApi) throw new Error('Configured authority unavailable.');
    return pluginApi.getStatus({ bypassCache: true, signal });
}

function emptyPtvItemsArray() {
    return Promise.resolve([] as PtvItem[]);
}

function fetchNativeHomeResumeFallback(
    userId: string,
    rowSettings: PtvRowsEndpointSettings | null,
    options: NativeRowFetchOptions
) {
    if (shouldRenderConfiguredRows(rowSettings) && !isRuleSourceEnabled(rowSettings, 'continueWatching')) {
        return emptyPtvItemsResult();
    }

    return createNativeRowFetch('native-home-resume', signal => getPtvResumeItems<PtvItem>({
        EnableImageTypes: VIDEO_IMAGE_TYPES,
        Fields: ITEM_FIELDS,
        Limit: 16,
        MediaTypes: 'Video'
    }, { signal, userId }), { Items: [] }, options);
}

function fetchNativeHomeConfiguredResumeFallback(
    userId: string,
    rowSettings: PtvRowsEndpointSettings | null,
    options: NativeRowFetchOptions
) {
    if (!shouldRenderConfiguredRows(rowSettings)) return emptyPtvItemsResult();

    return fetchNativeHomeResumeFallback(userId, rowSettings, options);
}

function fetchNativeHomeReadingFallback(
    userId: string,
    rowSettings: PtvRowsEndpointSettings | null,
    options: NativeRowFetchOptions
) {
    if (shouldRenderConfiguredRows(rowSettings)) return emptyPtvItemsResult();

    return createNativeRowFetch('native-home-continue-reading', signal => getPtvResumeItems<PtvItem>({
        EnableImageTypes: VIDEO_IMAGE_TYPES,
        Fields: ITEM_FIELDS,
        IncludeItemTypes: 'Book',
        Limit: 16
    }, { signal, userId }), { Items: [] }, options);
}

function fetchNativeHomeListeningFallback(
    userId: string,
    rowSettings: PtvRowsEndpointSettings | null,
    options: NativeRowFetchOptions
) {
    if (shouldRenderConfiguredRows(rowSettings)) return emptyPtvItemsResult();

    return createNativeRowFetch('native-home-continue-listening', signal => getPtvResumeItems<PtvItem>({
        EnableImageTypes: VIDEO_IMAGE_TYPES,
        Fields: ITEM_FIELDS,
        IncludeItemTypes: 'Audio',
        Limit: 16,
        Recursive: true
    }, { signal, userId }), { Items: [] }, options);
}

function fetchNativeHomeRecentlyAddedFallback(
    userId: string,
    rowSettings: PtvRowsEndpointSettings | null,
    options: NativeRowFetchOptions
) {
    if (shouldRenderConfiguredRows(rowSettings)) return emptyPtvItemsArray();

    return createNativeRowFetch('native-home-recently-added', signal => getPtvRecentlyAdded<PtvItem>({
        EnableImageTypes: VIDEO_IMAGE_TYPES,
        Fields: ITEM_FIELDS,
        IncludeItemTypes: RECENT_ITEM_TYPES,
        Limit: 20
    }, { signal, userId }), [], options);
}

function getNativeHomeElementLabel(element: Element | null) {
    if (!element) return 'window';
    if (element === document.documentElement) return 'documentElement';
    if (element === document.body) return 'body';

    const id = element.id ? `#${element.id}` : '';
    const className = typeof element.className === 'string' ?
        element.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map(value => `.${value}`).join('') :
        '';

    return `${element.tagName.toLowerCase()}${id}${className}`;
}

function getNativeHomeDebugStack() {
    return new Error().stack?.split('\n').slice(2, 8).join('\n') || null;
}

function getNativeHomeScrollRootCandidateEntries() {
    const nodes: Element[] = [];
    const addNode = (node: Element | null | undefined) => {
        if (node && !nodes.includes(node)) nodes.push(node);
    };

    [
        document.querySelector('#ptv-native-home-page'),
        document.querySelector('.ptv-native-home-page'),
        document.querySelector('.mainAnimatedPages'),
        document.querySelector('.page:not(.hide)'),
        document.querySelector('.page'),
        document.documentElement,
        document.body
    ].forEach(addNode);

    const firstRow = document.querySelector('[data-ptv-native-home-row-id]');
    let ancestor = firstRow?.parentElement || null;

    while (ancestor) {
        addNode(ancestor);
        ancestor = ancestor.parentElement;
    }

    return nodes.map(element => {
        const style = window.getComputedStyle(element);
        const overflow = `${style.overflowY} ${style.overflow}`;
        const rect = element.getBoundingClientRect();
        const canScroll = /(auto|scroll|overlay)/i.test(overflow)
            && element.scrollHeight > element.clientHeight + 4;

        return {
            debug: {
                canScroll,
                clientHeight: element.clientHeight,
                label: getNativeHomeElementLabel(element),
                rectBottom: Number(rect.bottom.toFixed(1)),
                rectTop: Number(rect.top.toFixed(1)),
                scrollHeight: element.scrollHeight,
                scrollTop: element.scrollTop,
                overflow
            },
            element
        };
    });
}

function getNativeHomeScrollRootCandidates() {
    return getNativeHomeScrollRootCandidateEntries().map(candidate => candidate.debug);
}

function getNativeHomeScrollRoot(): Element | null {
    return getNativeHomeScrollRootCandidateEntries().find(candidate => candidate.debug.canScroll)?.element || null;
}

function getNativeHomeScrollRootDebug(scrollRoot: Element | null) {
    if (!shouldCollectDiagnostics()) {
        return {
            candidates: [],
            selected: getNativeHomeElementLabel(scrollRoot),
            selectedCanScroll: false
        };
    }

    const candidates = getNativeHomeScrollRootCandidates();

    return {
        candidates: candidates.slice(0, 8),
        selected: getNativeHomeElementLabel(scrollRoot),
        selectedCanScroll: candidates.find(candidate => candidate.label === getNativeHomeElementLabel(scrollRoot))?.canScroll ?? false
    };
}

function getNativeHomeObserverRoot(scrollRoot: Element | null) {
    if (!scrollRoot || scrollRoot === document.body || scrollRoot === document.documentElement) {
        return null;
    }

    return scrollRoot;
}

function recordNativeHomeObserverEvent(
    eventName: 'observer-created' | 'observer-disconnected' | 'observer-registration-failed' | 'observer-registration-skipped',
    detail: Record<string, unknown>
) {
    if (!shouldCollectDiagnostics()) return;

    recordPtvEvent('render', eventName, {
        ...detail,
        stack: getNativeHomeDebugStack()
    });
}

function getNativeHomeViewportRect(scrollRoot: Element | null) {
    if (scrollRoot && scrollRoot !== document.documentElement && scrollRoot !== document.body) {
        const rect = scrollRoot.getBoundingClientRect();

        return {
            bottom: rect.bottom,
            height: rect.height,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            width: rect.width
        };
    }

    const width = window.innerWidth || document.documentElement.clientWidth || 0;
    const height = window.innerHeight || document.documentElement.clientHeight || 0;

    return {
        bottom: height,
        height,
        left: 0,
        right: width,
        top: 0,
        width
    };
}

function getNativeHomeRowViewportPosition(
    node: HTMLElement | null,
    scrollRoot: Element | null,
    mountThreshold = NATIVE_HOME_ROW_MOUNT_ROOT_MARGIN_PX
): NativeHomeViewportPosition {
    if (!node) {
        return {
            bottom: null,
            height: null,
            inThreshold: false,
            left: null,
            right: null,
            top: null,
            viewportBottom: null,
            viewportHeight: null,
            viewportTop: null,
            width: null
        };
    }

    const rect = node.getBoundingClientRect();
    const viewport = getNativeHomeViewportRect(scrollRoot);

    return {
        bottom: Number(rect.bottom.toFixed(1)),
        height: Number(rect.height.toFixed(1)),
        inThreshold: rect.bottom >= viewport.top - mountThreshold && rect.top <= viewport.bottom + mountThreshold,
        left: Number(rect.left.toFixed(1)),
        right: Number(rect.right.toFixed(1)),
        top: Number(rect.top.toFixed(1)),
        viewportBottom: Number(viewport.bottom.toFixed(1)),
        viewportHeight: Number(viewport.height.toFixed(1)),
        viewportTop: Number(viewport.top.toFixed(1)),
        width: Number(rect.width.toFixed(1))
    };
}

export function useNativeHomeData(): NativeHomeState & { identityKey: string | null } {
    const currentDisplayIdentity = getNativeHomeDisplayIdentity();
    const currentDisplayIdentityKey = getPtvDisplayIdentityKey(
        currentDisplayIdentity.serverId,
        currentDisplayIdentity.userId
    );
    const librarySnapshot = useSyncExternalStore(subscribeHomeLibraryAuthority, getHomeLibraryAuthoritySnapshot);
    const presentationSnapshot = useSyncExternalStore(subscribeConfiguredRowFreshness, getConfiguredRowFreshnessSnapshot);
    const [state, setStoredState] = useState<NativeHomeState>({
        debug: {
            home: getEmptyNativeHomeAdaptiveDebug(),
            performance: getEmptyNativeHomePerformanceDebug(),
            recommendations: getEmptyRecommendationDebug()
        },
        error: null,
        heroItem: null,
        heroItems: [],
        isLoading: true,
        rows: [],
        user: null
    });
    const [stateIdentityKey, setStateIdentityKey] = useState(currentDisplayIdentityKey);
    const setState = useCallback((update: NativeHomeState | ((previous: NativeHomeState) => NativeHomeState)) => {
        setStoredState(previous => {
            const safePrevious = retainCurrentNativeHomePresentation(previous, currentDisplayIdentityKey);
            const next = typeof update === 'function' ? update(safePrevious) : update;
            return retainCurrentNativeHomePresentation(next, currentDisplayIdentityKey);
        });
    }, [currentDisplayIdentityKey]);

    useEffect(() => {
        setStateIdentityKey(currentDisplayIdentityKey);
        const generation = ++nativeHomeRouteGeneration;
        const libraryRevision = beginHomeLibraryVerification(currentDisplayIdentityKey);
        const ownershipBudget = new HomeOwnershipReadBudget();
        let currentHomeTopology: CurrentHomeTopology | null = null;
        const displayIdentity = getNativeHomeDisplayIdentity();
        const routeAbortController = createPtvAbortController();
        let configuredVerification = beginConfiguredRowVerification(currentDisplayIdentityKey);
        const recordConfiguredPresentation = () => {
            const presentation = getConfiguredRowFreshnessSnapshot();
            recordPtvEvent('render', 'configured-row-presentation-state', {
                state: presentation.status,
                reason: presentation.reason
            });
        };
        const unsubscribeConfiguredPresentation = subscribeConfiguredRowFreshness(recordConfiguredPresentation);
        recordConfiguredPresentation();
        const connectionClient = getCurrentPtvApiClient();
        const retireConnectionProof = () => retireConfiguredRowFreshness('connection-authority-uncertain');
        if (connectionClient) {
            Events.on(connectionClient, 'websocketclose', retireConnectionProof);
            Events.on(connectionClient, 'websocketopen', retireConnectionProof);
        }
        const deferredFrameIds = new Set<number>();
        const deferredTimerIds = new Set<number>();
        let disposed = false;
        let backgroundRefreshStartedAt: number | null = null;
        let cacheRowsForSupplemental: NativeHomeRow[] = [];
        let renderedFromCache = false;
        const isRouteWorkCurrent = () => {
            const currentIdentity = getNativeHomeDisplayIdentity();

            return !disposed
                && generation === nativeHomeRouteGeneration
                && currentIdentity.serverId === displayIdentity.serverId
                && currentIdentity.userId === displayIdentity.userId;
        };
        const currentHeroAccessEpoch = () => {
            const authority = getHomeLibraryAuthoritySnapshot();
            return isRouteWorkCurrent() && currentHomeTopology && authority.revision === libraryRevision
                && authority.identityKey === currentDisplayIdentityKey && authority.topology
                && !authority.topology.held && authority.topology.epoch === currentHomeTopology.epoch
                && isCurrentHomeUserAccessReady(authority.userAccess || null, displayIdentity.userId) ?
                authority.userAccess?.accessEpoch || null : null;
        };
        const membershipAuthority = createHomeLibraryMembershipAuthority({
            serverId: displayIdentity.serverId,
            userId: displayIdentity.userId,
            generation,
            signal: routeAbortController.signal,
            budget: ownershipBudget,
            isCurrent: () => isRouteWorkCurrent() && getHomeLibraryAuthoritySnapshot().revision === libraryRevision
        });
        const unsubscribeLibrary = subscribeHomeLibraryAuthority(() => {
            if (getHomeLibraryAuthoritySnapshot().revision !== libraryRevision) membershipAuthority.retire('library-transition');
        });
        const ownershipDiagnostics = new Set<string>();
        const filterPreviousOwnedRows = (previousRows: NativeHomeRow[], incomingRows: NativeHomeRow[]) => {
            const currentlyProven = new Map(incomingRows
                .filter(row => row.homeOwnershipKind === 'library'
                    && row.homeOwnershipGeneration === generation && row.items.length > 0
                    && row.homeOwnershipClaimKey)
                .map(row => [ row.id, row.homeOwnershipClaimKey ]));
            return previousRows.filter(row => row.homeOwnershipKind !== 'library'
                || Boolean(row.homeOwnershipClaimKey
                    && currentlyProven.get(row.id) === row.homeOwnershipClaimKey));
        };
        const mergeVerifiedHomeRows = (previousRows: NativeHomeRow[], incomingRows: NativeHomeRow[]) =>
            mergeSettledNativeHomeRows(filterPreviousOwnedRows(previousRows, incomingRows), incomingRows);
        const gateFeaturedRows = async (
            featured: FeaturedPayload | null,
            settings: PtvRowsEndpointSettings | null,
            candidate: NativeHomeFeaturedRowsResult,
            source: 'featured-cache' | 'featured-endpoint',
            allowRestrictedOwnedEndpoint = false,
            configuredProof: ConfiguredRowProof | null = null
        ): Promise<NativeHomeFeaturedRowsResult> => {
            if (!featured || !candidate.rows.length) return candidate;
            const featuredAuthority = getHomeLibraryAuthoritySnapshot();
            if (featuredAuthority.revision !== libraryRevision
                || featuredAuthority.identityKey !== currentDisplayIdentityKey
                || !isCurrentHomeUserAccessReady(featuredAuthority.userAccess || null, displayIdentity.userId)) {
                return { ...candidate, rows: [] };
            }
            const userAccessEpoch = featuredAuthority.userAccess!.accessEpoch!;
            const sections = Array.isArray(featured.sections) ? featured.sections : [];
            const featuredVersion = source === 'featured-cache' ?
                Number((featured as FeaturedPayload & { homeFeaturedCacheVersion?: number }).homeFeaturedCacheVersion
                    ?? getFeaturedContentCacheStatus().cacheVersion) :
                Number((featured as FeaturedPayload & { homeFeaturedCacheVersion?: number }).homeFeaturedCacheVersion);
            const associationResolver = createConfiguredRowAssociationResolver(settings, sections);
            const skippedRows = [ ...candidate.skippedRows ];
            const rejectRow = (row: NativeHomeRow, reason: string) => {
                skippedRows.push({ id: row.id, itemCount: row.items.length, reason,
                    rowType: row.rowType, ruleId: row.ruleId, sourceCacheSectionId: row.sourceCacheSectionId,
                    title: row.title });
                const key = `${row.id}:${reason}`;
                if (!ownershipDiagnostics.has(key)) {
                    ownershipDiagnostics.add(key);
                    recordPtvEvent('row-fetch', reason, {
                        ruleId: row.ruleId || null,
                        sectionId: row.sourceCacheSectionId || null
                    });
                }
                return null;
            };
            // Association, current scope, and user membership all belong to one adoption boundary.
            // eslint-disable-next-line sonarjs/cognitive-complexity
            const rows = await Promise.all(candidate.rows.map(async (row): Promise<NativeHomeRow | null> => {
                const sectionId = row.sourceCacheSectionId || '';
                let matchingSection: unknown = null;
                let matchingSectionCount = 0;
                for (const currentSection of sections) {
                    if (getSectionId(currentSection) === sectionId) {
                        matchingSection = currentSection;
                        matchingSectionCount += 1;
                    }
                }
                const section = matchingSectionCount === 1 ? matchingSection : null;
                if (matchingSectionCount > 1) return rejectRow(row, 'home-poisoned-payload-rejected');
                const sectionRecord = isRecord(section) ? section : null;
                if (!sectionRecord) return rejectRow(row, 'home-poisoned-payload-rejected');
                if (row.rowType !== 'configured-rule') {
                    const scopedPayload = featuredVersion >= 8 || Number(featured.scopeSchemaVersion) >= 1;
                    if (sectionRecord.scopeType === 'library' || sectionRecord.sourceType === 'library'
                        || sectionRecord.libraryId != null || sectionRecord.bindingKey != null
                        || sectionRecord.topologyEpoch != null || sectionRecord.bindingGeneration != null
                        || sectionRecord.resolvedScopeHash != null || sectionRecord.configuredRowAssociation != null
                        || sectionRecord.sourceRuleId != null || sectionRecord.ruleId != null
                        || scopedPayload && row.rowType === 'fallback'
                            && (![1, 2].includes(Number(featured.scopeSchemaVersion)) || sectionRecord.scopeType !== 'global')
                        || scopedPayload && row.rowType === 'generated-recommendation'
                            && sectionRecord.sourceType !== 'recommendation') {
                        return rejectRow(row, 'home-poisoned-payload-rejected');
                    }
                    return { ...row, homeUserAccessEpoch: userAccessEpoch, homeLibraryRevision: libraryRevision };
                }

                let claim: HomeLibraryOwnershipClaim;
                if (!settings) {
                    claim = source === 'featured-endpoint' && allowRestrictedOwnedEndpoint ?
                        resolveRestrictedFreshOwnedClaim(featured, section, sectionId, currentHomeTopology) :
                        { kind: 'rejected', reason: 'home-scope-unresolved' };
                } else {
                    const rule = getMatchingRowRule(settings.rules || [], row.ruleId || '');
                    if (!rule) return rejectRow(row, 'home-scope-unresolved');
                    // Existing explicitly global rows from pre-scope settings retain
                    // their ordinary Home behavior while current schema-3 claims use
                    // the strict config/section association matcher.
                    if (isLegacyUnscopedGlobalSection(settings, rule, sectionRecord, featured)) {
                        claim = { kind: 'global', ruleId: rule.id || '', sectionId };
                    } else {
                        claim = resolveHomeLibraryOwnershipClaim({
                            rule,
                            section,
                            sectionId,
                            payload: featured,
                            association: associationResolver.resolve(section),
                            expectedRowConfigHash: getRowsEndpointSettingsHash(settings),
                            currentHomeTopology,
                            currentHomeUserAccess: getHomeLibraryAuthoritySnapshot().userAccess,
                            currentHomeUserId: displayIdentity.userId,
                            configuredProof,
                            featuredCacheVersion: featuredVersion
                        });
                    }
                }
                if (claim.kind === 'rejected') return rejectRow(row, claim.reason);
                if (claim.kind === 'global') {
                    return { ...row, homeOwnershipKind: 'global' as const,
                        homeUserAccessEpoch: userAccessEpoch, homeLibraryRevision: libraryRevision };
                }
                const currentAuthority = getHomeLibraryAuthoritySnapshot();
                if (!currentHomeTopology || !matchesHomeTopologyClaim(sectionRecord, currentHomeTopology)
                    || !matchesHomeUserAccessClaim(sectionRecord, currentAuthority.userAccess || null, displayIdentity.userId)
                    || currentAuthority.revision !== libraryRevision) return rejectRow(row, 'home-topology-unproven');
                const candidateIds: string[] = [];
                for (const item of row.items) candidateIds.push(item.Id || '');
                const proofRevision = getConfiguredRowFreshnessSnapshot().revision;
                const proof = await membershipAuthority.prove(claim, candidateIds);
                if (!isRouteWorkCurrent() || getHomeLibraryAuthoritySnapshot().revision !== libraryRevision
                    || getConfiguredRowFreshnessSnapshot().revision !== proofRevision
                    || proof.status === 'rejected') {
                    return rejectRow(row, proof.reason || 'home-verification-route-retired');
                }
                const items = filterOwnedHomeRowInPluginOrder(claim, row.items, proof.provenIds);
                if (!items.length) return rejectRow(row, 'home-membership-unresolved');
                const sectionScopeHash = sectionRecord?.resolvedScopeHash;
                const presentation = isRecord(featured.currentPresentationAuthority) ?
                    featured.currentPresentationAuthority : null;
                const claimKey = [ displayIdentity.serverId, displayIdentity.userId, claim.libraryId,
                    claim.ruleId, claim.sectionId, featured.rowConfigHash, sectionScopeHash,
                    featured.rowConfigVersion, featured.scopeSchemaVersion, source,
                    presentation?.generation || generation ].join('|');
                return { ...row, items, homeOwnershipKind: 'library' as const,
                    homeOwnershipClaimKey: `${claimKey}|${currentHomeTopology.epoch}|${currentAuthority.userAccess?.accessEpoch}|${sectionRecord.bindingGeneration}`,
                    homeLibraryRevision: libraryRevision,
                    homeUserAccessEpoch: userAccessEpoch,
                    homeTopologyEpoch: currentHomeTopology.epoch,
                    homeOwnershipGeneration: generation,
                    homeOwnershipIdentityKey: currentDisplayIdentityKey,
                    homeOwnershipRevision: getConfiguredRowFreshnessSnapshot().revision };
            }));
            return {
                rows: isRouteWorkCurrent() ? rows.filter((row): row is NativeHomeRow => Boolean(row)) : [],
                skippedRows
            };
        };
        const startedAt = performance.now();
        const recordTimeline = (
            milestone: string,
            source: string,
            model: NativeHomeModelLike = {},
            detail: Record<string, unknown> = {}
        ) => {
            const summary = summarizeNativeHomeModel(model);
            const cacheStatus = getFeaturedContentCacheStatus();

            recordPtvEvent('render', 'native-home-state-timeline', {
                cacheFresh: cacheStatus.isFresh,
                cachePayloadClassification: cacheStatus.payloadClassification,
                cacheVersion: cacheStatus.cacheVersion,
                completeness: summary.completeness,
                emptySectionCount: summary.emptySectionCount,
                generation,
                heroItemCount: summary.heroCount,
                milestone,
                populatedSectionCount: summary.populatedSectionCount,
                replacesPopulatedModel: Boolean(detail.replacesPopulatedModel),
                rowItemCount: summary.totalRowItemCount,
                sectionCount: summary.sectionCount,
                source,
                timestampMs: Math.round(performance.now() - startedAt),
                ...detail
            });
        };
        const performanceProfile = getPtvPerformanceProfile();
        const skipNonCriticalBackgroundFetches = performanceProfile.isFireTv || performanceProfile.isLowPower;
        const markBackgroundRefreshStarted = (reason: string) => {
            if (backgroundRefreshStartedAt !== null) return;

            backgroundRefreshStartedAt = performance.now();
            recordPtvEvent('render', 'native-home-background-refresh-started', {
                reason
            });
            recordPtvEvent('render', 'home-background-enrichment-started', {
                reason
            });
        };
        const markBackgroundRefreshCompleted = (reason: string, detail: Record<string, unknown> = {}) => {
            const durationMs = backgroundRefreshStartedAt === null ?
                null :
                Math.round(performance.now() - backgroundRefreshStartedAt);

            recordPtvEvent('render', 'native-home-background-refresh-completed', {
                ...detail,
                durationMs,
                reason
            });
            recordPtvEvent('render', 'home-background-enrichment-completed', {
                ...detail,
                durationMs,
                reason
            });

            if (durationMs !== null) {
                recordPtvTiming('render', 'native-home-background-refresh', durationMs, {
                    ...detail,
                    reason
                });
            }

            if (disposed) return;

            setState(previous => {
                const nextPerformance = {
                    ...previous.debug.performance,
                    backgroundRefreshCompleted: true,
                    backgroundRefreshDurationMs: durationMs,
                    backgroundRefreshStarted: previous.debug.performance.backgroundRefreshStarted || backgroundRefreshStartedAt !== null
                };

                recordPtvEvent('render', 'native-home-interactive', nextPerformance);

                return {
                    ...previous,
                    debug: {
                        ...previous.debug,
                        performance: nextPerformance
                    }
                };
            });
        };

        recordPtvEvent('render', 'native-home-mount-start', {
            route: window.location.hash || window.location.pathname
        });
        recordPtvEvent('render', 'home-route-entered', {
            route: window.location.hash || window.location.pathname
        });
        recordTimeline('home-route-entered', 'route');
        recordPtvEvent('row-fetch', 'native-home-data-fetch-start', {
            route: window.location.hash || window.location.pathname
        });
        setPtvShellLoading(true);
        clearPtvShellStatus();
        setState(() => {
            const lastUsableState = getLastUsableNativeHomeState(displayIdentity);

            if (lastUsableState) {
                const restoredAt = Math.round(performance.now() - startedAt);

                recordPtvEvent('render', 'native-home-last-good-state-restored', {
                    restoreMs: restoredAt,
                    rowCount: lastUsableState.rows.length
                });

                return {
                    ...lastUsableState,
                    debug: {
                        ...lastUsableState.debug,
                        performance: {
                            ...lastUsableState.debug.performance,
                            backgroundRefreshStarted: true,
                            cacheRenderMs: restoredAt,
                            cacheRowsUsed: true,
                            cacheUsedForRows: true,
                            firstInteractiveMs: restoredAt,
                            homeInitialRenderMs: restoredAt
                        }
                    },
                    error: null,
                    isLoading: false
                };
            }

            return {
                debug: {
                    home: getEmptyNativeHomeAdaptiveDebug(),
                    performance: getEmptyNativeHomePerformanceDebug(),
                    recommendations: getEmptyRecommendationDebug()
                },
                error: null,
                heroItem: null,
                heroItems: [],
                isLoading: true,
                rows: [],
                user: null
            };
        });

        const slowFetchesAborted = new Set<string>();
        const fallbackFetchesSkipped = new Set<string>();
        const markSlowFetchAborted = (name: string) => {
            slowFetchesAborted.add(name);
        };
        const getFetchOptions = (timeoutMs: number) => ({
            onTimeout: markSlowFetchAborted,
            signal: routeAbortController.signal,
            timeoutMs
        });
        const skipFallbackFetches = (fetchNames: string[]) => {
            fetchNames.forEach(name => {
                fallbackFetchesSkipped.add(name);
            });
            recordPtvEvent('row-fetch', 'native-home-fallback-fetches-skipped', {
                fetchNames,
                reason: 'usable-featured-cache'
            });
        };
        const scheduleSupplementalRows = (
            user: PtvUser,
            rowSettings: PtvRowsEndpointSettings | null,
            cachedRows: NativeHomeRow[]
        ) => {
            if (shouldRenderConfiguredRows(rowSettings)) {
                markBackgroundRefreshCompleted('saved-rule-supplemental-skipped', {
                    cachedRows: cachedRows.length
                });
                return;
            }

            if (skipNonCriticalBackgroundFetches) {
                markBackgroundRefreshCompleted('low-power-supplemental-skipped', {
                    cachedRows: cachedRows.length
                });
                return;
            }

            markBackgroundRefreshStarted('supplemental-rows');
            const frameId = window.requestAnimationFrame(() => {
                deferredFrameIds.delete(frameId);
                if (!isRouteWorkCurrent()) return;

                // Wait until after the first paint before starting non-critical Jellyfin row fetches.
                // eslint-disable-next-line sonarjs/no-nested-functions
                const timerId = window.setTimeout(() => {
                    deferredTimerIds.delete(timerId);
                    if (!isRouteWorkCurrent()) return;

                    const supplementalSlowFetches = new Set<string>();
                    const markSupplementalSlowFetch = (name: string) => {
                        supplementalSlowFetches.add(name);
                        slowFetchesAborted.add(name);
                    };
                    const supplementalOptions = {
                        onTimeout: markSupplementalSlowFetch,
                        signal: routeAbortController.signal,
                        timeoutMs: NATIVE_HOME_SUPPLEMENTAL_FETCH_TIMEOUT_MS
                    };

                    void Promise.all([
                        createNativeRowFetch('native-home-resume', signal => getPtvResumeItems<PtvItem>({
                            EnableImageTypes: VIDEO_IMAGE_TYPES,
                            Fields: ITEM_FIELDS,
                            Limit: 16,
                            MediaTypes: 'Video'
                        }, { signal, userId: user.Id }), { Items: [] }, supplementalOptions),
                        createNativeRowFetch('native-home-continue-reading', signal => getPtvResumeItems<PtvItem>({
                            EnableImageTypes: VIDEO_IMAGE_TYPES,
                            Fields: ITEM_FIELDS,
                            IncludeItemTypes: 'Book',
                            Limit: 16
                        }, { signal, userId: user.Id }), { Items: [] }, supplementalOptions),
                        createNativeRowFetch('native-home-continue-listening', signal => getPtvResumeItems<PtvItem>({
                            EnableImageTypes: VIDEO_IMAGE_TYPES,
                            Fields: ITEM_FIELDS,
                            IncludeItemTypes: 'Audio',
                            Limit: 16,
                            Recursive: true
                        }, { signal, userId: user.Id }), { Items: [] }, supplementalOptions),
                        createNativeRowFetch('native-home-recently-added', signal => getPtvRecentlyAdded<PtvItem>({
                            EnableImageTypes: VIDEO_IMAGE_TYPES,
                            Fields: ITEM_FIELDS,
                            IncludeItemTypes: RECENT_ITEM_TYPES,
                            Limit: 20
                        }, { signal, userId: user.Id }), [], supplementalOptions)
                    ])
                        .then(([resumeResult, readingResult, listeningResult, recentResult]) => {
                            if (!isRouteWorkCurrent()) return;

                            const rows = createRows(
                                getItems(resumeResult),
                                getItems(readingResult),
                                getItems(listeningResult),
                                getItems(recentResult),
                                rowSettings
                            );
                            const userRows = rows.filter(row => ['resume', 'continue-reading', 'continue-listening'].includes(row.id));
                            const recentRows = rows.filter(row => row.id === 'recently-added');
                            const mergedRows = orderFocusedNativeHomeRows([
                                ...userRows,
                                ...recentRows,
                                ...cachedRows
                            ]);

                            recordPtvEvent('render', 'native-home-supplemental-rows-loaded', {
                                cachedRows: cachedRows.length,
                                memory: getNativeHomeRowDebugMemorySummary(mergedRows),
                                rowCount: mergedRows.length,
                                slowFetchesAborted: Array.from(supplementalSlowFetches)
                            });
                            setState(previous => {
                                if (previous.error) return previous;

                                const existingRecommendationRows = previous.rows.filter(row => row.source === 'recommendation');
                                const rowsWithRecommendations = existingRecommendationRows.length ?
                                    insertNativeHomeRecommendationRows(mergedRows, existingRecommendationRows) :
                                    orderFocusedNativeHomeRows(mergedRows);
                                const adaptiveSupplemental = getAdaptiveNativeHomeLayout(rowsWithRecommendations, user, performance.now());
                                const adaptiveRows = mergeVerifiedHomeRows(
                                    previous.rows,
                                    adaptiveSupplemental.rows
                                );
                                const safeRows = hasRenderableNativeHomeRows(adaptiveRows) ?
                                    adaptiveRows :
                                    previous.rows;
                                const fallbackHeroItems = getUsableHeroItemsFromRows(adaptiveRows);
                                const heroItems = previous.heroItems.length ?
                                    previous.heroItems :
                                    buildNativeHomeHeroItems([], fallbackHeroItems);
                                const nextState = {
                                    ...previous,
                                    debug: {
                                        ...previous.debug,
                                        home: adaptiveSupplemental.debug,
                                        performance: {
                                            ...previous.debug.performance,
                                            slowFetchesAborted: Array.from(new Set([
                                                ...previous.debug.performance.slowFetchesAborted,
                                                ...supplementalSlowFetches
                                            ])),
                                            backgroundRefreshStarted: true
                                        }
                                    },
                                    heroItem: previous.heroItem || heroItems[0] || firstUsableHeroItem(safeRows),
                                    heroItems,
                                    rows: safeRows
                                };

                                if (!hasRenderableNativeHomeRows(adaptiveRows) && hasRenderableNativeHomeRows(previous.rows)) {
                                    recordPtvEvent('render', 'native-home-empty-supplemental-ignored', {
                                        previousRows: previous.rows.length,
                                        reason: 'preserve-last-visible-rows'
                                    });
                                }

                                rememberUsableNativeHomeState(nextState, 'supplemental-rows', displayIdentity);

                                return nextState;
                            });
                            markBackgroundRefreshCompleted('supplemental-rows', {
                                cachedRows: cachedRows.length,
                                rowCount: mergedRows.length,
                                slowFetchesAborted: Array.from(supplementalSlowFetches)
                            });
                        });
                }, 0);
                deferredTimerIds.add(timerId);
            });
            deferredFrameIds.add(frameId);
        };
        const renderFromFeaturedCache = async (
            featuredPayload: FeaturedPayload | null,
            rowSettings: PtvRowsEndpointSettings | null = null,
            options: {
                configuredProof?: ConfiguredRowProof | null;
                mode?: 'cache-only' | 'settings-validated';
                user?: PtvUser | null;
            } = {}
        ) => {
            if (!isRouteWorkCurrent() || renderedFromCache || !hasUsableFeaturedPayload(featuredPayload)) return false;
            const cacheResponseReceivedAt = Math.round(performance.now() - startedAt);
            const cacheRenderMode = options.mode || 'settings-validated';
            const cacheOnly = cacheRenderMode === 'cache-only';

            recordPtvEvent('render', 'home-cache-response-received', {
                cacheRenderMode,
                responseMs: cacheResponseReceivedAt
            });

            if (!cacheOnly && !isFeaturedPayloadCurrentForRows(featuredPayload, rowSettings, options.configuredProof)) {
                recordPtvEvent('cache', 'native-home-cache-render-skipped', {
                    payloadHash: featuredPayload?.rowConfigHash || null,
                    reason: 'row-config-hash-mismatch',
                    rowSettingsHash: getRowsEndpointSettingsHash(rowSettings)
                });

                return false;
            }

            const cacheRowsResult = await gateFeaturedRows(featuredPayload, rowSettings, createRowsFromFeaturedPayload(featuredPayload, {
                configuredProof: options.configuredProof,
                rowSettings: cacheOnly ? null : rowSettings,
                source: 'featured-cache'
            }), 'featured-cache', false, options.configuredProof);
            const settingsRecommendationRows = cacheOnly ? [] : createUserSpecificRecommendationRows(rowSettings);

            if (!isRouteWorkCurrent() || renderedFromCache) return false;

            const focusedCacheRows = settingsRecommendationRows.length ?
                insertNativeHomeRecommendationRows(cacheRowsResult.rows, settingsRecommendationRows) :
                orderFocusedNativeHomeRows(cacheRowsResult.rows);
            const recommendationDebug = createUserSpecificRecommendationDebug(rowSettings, settingsRecommendationRows);
            const adaptiveCache = cacheOnly ? {
                debug: getEmptyNativeHomeAdaptiveDebug(),
                rows: focusedCacheRows
            } : getAdaptiveNativeHomeLayout(focusedCacheRows, options.user || null, startedAt);
            const adaptiveCacheRows = adaptiveCache.rows;

            if (!focusedCacheRows.length) {
                recordPtvEvent('cache', 'native-home-cache-render-skipped', {
                    reason: 'no-renderable-cache-rows',
                    sectionCount: getFeaturedSectionCount(featuredPayload)
                });

                return false;
            }

            cacheRowsForSupplemental = focusedCacheRows;
            renderedFromCache = true;
            markBackgroundRefreshStarted('post-cache-render');
            skipFallbackFetches([
                'native-home-rows-endpoint-blocking',
                'native-home-featured-endpoint',
                'native-home-hero-fallback',
                'native-home-resume',
                'native-home-continue-reading',
                'native-home-continue-listening',
                'native-home-recently-added',
                'native-home-watched-context',
                'native-home-because-watched-candidates'
            ]);

            const heroAccessEpoch = currentHeroAccessEpoch();
            const preferredHeroItems = getItems(getFeaturedHeroItemsForAccessEpoch(
                featuredPayload, heroAccessEpoch) as PtvItem[]);
            const fallbackHeroItems = getUsableHeroItemsFromRows(adaptiveCacheRows);
            const heroItems = buildNativeHomeHeroItems(preferredHeroItems, fallbackHeroItems);
            const heroItem = heroItems[0] || firstUsableHeroItem(adaptiveCacheRows);
            const cacheRenderMs = Math.round(performance.now() - startedAt);
            const cachedItemCount = adaptiveCacheRows.reduce((total, row) => total + row.items.length, 0);
            const performanceDebug: NativeHomePerformanceDebug = {
                backgroundRefreshCompleted: false,
                backgroundRefreshDurationMs: null,
                backgroundRefreshStarted: true,
                cacheHeroUsed: Boolean(preferredHeroItems.length),
                cacheCommitDelayMs: Math.max(0, cacheRenderMs - cacheResponseReceivedAt),
                cacheRenderMs,
                cacheResponseReceivedAt,
                cacheRowsUsed: true,
                cacheStateCommittedAt: cacheRenderMs,
                cacheUsedForHero: Boolean(preferredHeroItems.length),
                cacheUsedForRows: true,
                cachedHeroCount: heroItems.length,
                cachedItemCount,
                cachedRowCount: adaptiveCacheRows.length,
                fallbackFetchesSkipped: Array.from(fallbackFetchesSkipped),
                firstVisibleContentMs: cacheRenderMs,
                firstInteractiveMs: cacheRenderMs,
                homeInitialRenderMs: cacheRenderMs,
                slowFetchesAborted: Array.from(slowFetchesAborted)
            };

            recordPtvEvent('render', 'native-home-cache-rendered', {
                cacheRenderMode,
                cacheRenderMs,
                heroCount: heroItems.length,
                itemCount: getFeaturedPayloadItemCount(featuredPayload),
                memory: getNativeHomeRowDebugMemorySummary(adaptiveCacheRows, heroItems),
                recommendationRows: settingsRecommendationRows.length,
                rowCount: adaptiveCacheRows.length,
                sectionCount: getFeaturedSectionCount(featuredPayload),
                skippedRows: cacheRowsResult.skippedRows
            });
            recordPtvEvent('render', 'native-home-hero-items-built', {
                fallbackHeroCount: fallbackHeroItems.length,
                finalHeroCount: heroItems.length,
                preferredHeroCount: preferredHeroItems.length,
                selectedHeroAvailable: Boolean(heroItem),
                source: 'featured-cache'
            });
            recordPtvEvent('render', 'native-home-interactive', performanceDebug);
            recordPtvEvent('render', 'home-cache-state-committed', {
                cacheRenderMode,
                commitMs: cacheRenderMs,
                rowCount: adaptiveCacheRows.length
            });
            recordPtvEvent('render', 'home-first-visible-content', {
                cacheRenderMode,
                firstVisibleContentMs: cacheRenderMs
            });
            recordPtvEvent('render', 'home-first-interactive', {
                cacheRenderMode,
                firstInteractiveMs: cacheRenderMs
            });
            recordPtvTiming('render', 'native-home-cache-render', cacheRenderMs, performanceDebug);
            recordPtvTiming('render', 'native-home-initial-render', cacheRenderMs, performanceDebug);
            clearPtvShellStatus();
            setPtvShellLoading(false);
            const nextState = {
                debug: {
                    home: adaptiveCache.debug,
                    performance: performanceDebug,
                    recommendations: recommendationDebug
                },
                error: null,
                heroItem,
                heroAccessEpoch,
                heroItems,
                independentHeroItems: preferredHeroItems,
                isLoading: false,
                rows: adaptiveCacheRows,
                user: options.user || null
            };

            rememberUsableNativeHomeState(nextState, 'featured-cache', displayIdentity);
            recordTimeline('home-cache-model-committed', 'plugin-file', nextState, {
                adoptionReason: 'populated-cache-accepted',
                adopted: true
            });
            if (heroItems.length) recordTimeline('first-hero-committed', 'plugin-file', nextState);
            if (adaptiveCacheRows.length) recordTimeline('first-shelf-committed', 'plugin-file', nextState);
            setState(nextState);
            return true;
        };

        recordPtvEvent('render', 'home-cache-request-start', {
            route: window.location.hash || window.location.pathname
        });
        const featuredPayloadPromise = createNativeRowFetch(
            'native-home-featured-cache',
            () => getCachedFeaturedContentPayload({ allowStale: true, homeVerificationCandidates: true }),
            null,
            getFetchOptions(NATIVE_HOME_FEATURED_ADOPTION_TIMEOUT_MS)
        );
        recordTimeline('memory-cache-read-started', 'memory-cache');
        recordTimeline('browser-cache-read-skipped', 'browser-cache', {}, {
            reason: 'browser-featured-cache-retired'
        });
        recordTimeline('plugin-cache-read-started', 'plugin-file');
        const rowSettingsPromise = createNativeRowFetch(
            'native-home-rows-endpoint',
            signal => fetchRowsEndpointSettings(signal),
            null,
            getFetchOptions(NATIVE_HOME_CRITICAL_FETCH_TIMEOUT_MS)
        );
        const currentUserPromise = createNativeRowFetch(
            'native-home-current-user',
            signal => getPtvCurrentUser(undefined, signal),
            null,
            getFetchOptions(0)
        );
        const userScopedFeaturedPayloadPromise = createNativeRowFetch(
            'native-home-featured-adoption',
            async signal => {
                const [featuredPayload, user] = await Promise.all([
                    featuredPayloadPromise,
                    currentUserPromise
                ]);

                return {
                    featuredPayload: await revalidateFeaturedPayloadForIdentity(featuredPayload, {
                        serverId: displayIdentity.serverId,
                        signal,
                        userId: user?.Id || ''
                    }),
                    user
                };
            },
            { featuredPayload: null, user: null },
            getFetchOptions(NATIVE_HOME_FEATURED_ADOPTION_TIMEOUT_MS)
        );

        const verifyConfiguredInputs = async (rowSettings: PtvRowsEndpointSettings | null, featuredPayload: FeaturedPayload | null, endpoint = false) => {
            if (!featuredPayload || !rowSettings && !endpoint) return null;
            const verification = configuredVerification;
            if (!isRouteWorkCurrent()
                || !ownershipBudget.reserve(currentHomeTopology ? 'recheck' : 'status')) return null;
            const status = await createNativeRowFetch('native-home-configured-authority', readNativeHomeConfiguredAuthority,
                null, getFetchOptions(NATIVE_HOME_CRITICAL_FETCH_TIMEOUT_MS));
            if (!isRouteWorkCurrent()) return null;
            currentHomeTopology = acceptHomeLibraryAuthority(status, libraryRevision, currentDisplayIdentityKey);
            return verifyConfiguredRowFreshness({
                verification, settings: rowSettings, featured: featuredPayload,
                isCurrent: isRouteWorkCurrent,
                readAuthority: () => Promise.resolve(status)
            });
        };
        // Both input reads finish before this independent, non-coalesced final authority read starts.
        const configuredInputsPromise = Promise.all([userScopedFeaturedPayloadPromise, rowSettingsPromise])
            .then(async ([result, rowSettings]) => ({ ...result, rowSettings,
                configuredProof: await verifyConfiguredInputs(rowSettings, result.featuredPayload) }));

        void userScopedFeaturedPayloadPromise
            .then(({ featuredPayload, user }) => {
                const semanticSummary = summarizeFeaturedContentPayload(featuredPayload);
                const cacheStatus = getFeaturedContentCacheStatus();

                recordTimeline('plugin-cache-response-received', 'plugin-file', {
                    completeness: semanticSummary.completeness,
                    sectionCount: semanticSummary.sectionCount
                }, {
                    adoptionReason: cacheStatus.lastRejectionReason || cacheStatus.adoptionResult,
                    heroItemCount: semanticSummary.heroCount,
                    payloadClassification: semanticSummary.payloadClassification,
                    populatedSectionCount: semanticSummary.populatedSectionCount,
                    totalRowItemCount: semanticSummary.totalRowItemCount
                });
                recordTimeline(
                    semanticSummary.usableForDisplay ? 'plugin-cache-adopted' : 'plugin-cache-rejected',
                    'plugin-file',
                    {},
                    { reason: semanticSummary.reason }
                );

                return renderFromFeaturedCache(featuredPayload, null, {
                    mode: 'cache-only',
                    user
                });
            })
            .catch(() => undefined);

        void configuredInputsPromise
            .then(({ featuredPayload, user, rowSettings, configuredProof }) => renderFromFeaturedCache(featuredPayload, rowSettings, {
                configuredProof,
                mode: 'settings-validated',
                user
            }))
            .catch(() => undefined);

        recordTimeline('live-jellyfin-requests-started', 'jellyfin-live');
        currentUserPromise
            .then(async user => {
                if (!user?.Id) {
                    throw new Error('A signed-in Jellyfin user is required for the native PiggieTV home.');
                }

                const userId = user.Id;
                const restrictedUser = !isPtvAdminUser(user);
                const { rowSettings, featuredPayload, configuredProof: cachedConfiguredProof } = await configuredInputsPromise;
                let configuredProof = cachedConfiguredProof;
                const savedRowRulesActive = shouldRenderConfiguredRows(rowSettings);
                const currentAccess = getHomeLibraryAuthoritySnapshot().userAccess || null;
                const hasUnprovedOwnedCache = hasUnprovedOwnedFeaturedCache(
                    featuredPayload, currentAccess, displayIdentity.userId);
                const hasFeaturedCache = canUseFeaturedCacheForHome(featuredPayload, rowSettings,
                    configuredProof, hasUnprovedOwnedCache, currentHomeTopology);
                let featuredEndpointPayload: FeaturedPayload | null = null;
                let resumeResult: { Items?: PtvItem[] } | PtvItem[];
                let continueReadingResult: { Items?: PtvItem[] } | PtvItem[] = { Items: [] };
                let continueListeningResult: { Items?: PtvItem[] } | PtvItem[] = { Items: [] };
                let recentResult: { Items?: PtvItem[] } | PtvItem[] = [];
                let heroResult: { Items?: PtvItem[] } | PtvItem[] = { Items: [] };

                recordFeaturedPayloadShape(featuredPayload);

                if (shouldUseCachedHomeRowsWithoutFreshEndpoint(hasFeaturedCache, user)) {
                    skipFallbackFetches([
                        'native-home-featured-endpoint',
                        'native-home-hero-fallback',
                        'native-home-watched-context',
                        'native-home-because-watched-candidates'
                    ]);
                    resumeResult = await fetchNativeHomeConfiguredResumeFallback(
                        userId,
                        rowSettings,
                        getFetchOptions(NATIVE_HOME_FALLBACK_FETCH_TIMEOUT_MS)
                    );
                } else {
                    ([
                        featuredEndpointPayload,
                        resumeResult,
                        continueReadingResult,
                        continueListeningResult,
                        recentResult,
                        heroResult
                    ] = await Promise.all([
                        createNativeRowFetch('native-home-featured-endpoint', fetchFeaturedEndpointPayload, null, getFetchOptions(NATIVE_HOME_FALLBACK_FETCH_TIMEOUT_MS)),
                        fetchNativeHomeResumeFallback(userId, rowSettings, getFetchOptions(NATIVE_HOME_FALLBACK_FETCH_TIMEOUT_MS)),
                        fetchNativeHomeReadingFallback(userId, rowSettings, getFetchOptions(NATIVE_HOME_FALLBACK_FETCH_TIMEOUT_MS)),
                        fetchNativeHomeListeningFallback(userId, rowSettings, getFetchOptions(NATIVE_HOME_FALLBACK_FETCH_TIMEOUT_MS)),
                        fetchNativeHomeRecentlyAddedFallback(userId, rowSettings, getFetchOptions(NATIVE_HOME_FALLBACK_FETCH_TIMEOUT_MS)),
                        createNativeRowFetch('native-home-hero-fallback', signal => getPtvItems<PtvItem>({
                            EnableImageTypes: VIDEO_IMAGE_TYPES,
                            Fields: ITEM_FIELDS,
                            ImageTypes: 'Backdrop',
                            IncludeItemTypes: 'Movie,Series',
                            Limit: 8,
                            Recursive: true,
                            SortBy: 'Random'
                        }, {
                            signal,
                            userId
                        }), { Items: [] }, getFetchOptions(NATIVE_HOME_FALLBACK_FETCH_TIMEOUT_MS))
                    ]));

                    featuredEndpointPayload = await revalidateFeaturedPayloadForIdentity(
                        featuredEndpointPayload,
                        {
                            serverId: displayIdentity.serverId,
                            signal: routeAbortController.signal,
                            userId
                        }
                    );
                    if (isRouteWorkCurrent()) {
                        configuredVerification = beginConfiguredRowVerification(currentDisplayIdentityKey);
                        configuredProof = await verifyConfiguredInputs(rowSettings, featuredEndpointPayload, true);
                    }
                }

                if (!areRecommendationsEnabled(rowSettings)) {
                    recordPtvEvent('recommendation', 'native-home-user-recommendations-skipped', {
                        reason: 'recommendations-disabled'
                    });
                } else {
                    recordPtvEvent('recommendation', 'native-home-user-recommendations-skipped', {
                        reason: 'home-uses-identity-scoped-engine'
                    });
                }

                recordPtvEvent('cache', 'native-home-featured-endpoint-shape', {
                    hasPayload: Boolean(featuredEndpointPayload),
                    heroCount: Array.isArray(featuredEndpointPayload?.heroItems) ? featuredEndpointPayload.heroItems.length : 0,
                    sectionCount: getFeaturedSectionCount(featuredEndpointPayload),
                    sectionItemCount: Object.keys(featuredEndpointPayload?.sectionItems || {}).length
                });

                const {
                    cachedRowsResult,
                    endpointRowsResult,
                    studioMap
                } = await createNativeHomeFeaturedRowResults(
                    featuredPayload,
                    featuredEndpointPayload,
                    rowSettings,
                    userId,
                    getFetchOptions(NATIVE_HOME_SUPPLEMENTAL_FETCH_TIMEOUT_MS),
                    configuredProof,
                    restrictedUser
                );
                const [verifiedCachedRowsResult, verifiedEndpointRowsResult] = await Promise.all([
                    gateFeaturedRows(featuredPayload, rowSettings, cachedRowsResult, 'featured-cache', false, configuredProof),
                    gateFeaturedRows(featuredEndpointPayload, rowSettings, endpointRowsResult, 'featured-endpoint', restrictedUser, configuredProof)
                ]);
                const preferVerifiedEndpoint = hasUnprovedOwnedCache
                    && verifiedEndpointRowsResult.rows.some(row => row.homeOwnershipKind === 'library')
                    || isConfiguredPayloadVerified(featuredEndpointPayload, configuredProof)
                    && !isConfiguredPayloadVerified(featuredPayload, configuredProof);
                const preferFreshRestrictedEndpoint = restrictedUser && !rowSettings
                    && verifiedEndpointRowsResult.rows.some(row => row.homeOwnershipKind === 'library');
                const preferredFeaturedRowsResult = !preferVerifiedEndpoint && !preferFreshRestrictedEndpoint
                    && verifiedCachedRowsResult.rows.length ?
                    verifiedCachedRowsResult :
                    verifiedEndpointRowsResult;
                const cachedRows = await expandNativeHomeStudioRows(
                    orderFocusedNativeHomeRows(preferredFeaturedRowsResult.rows),
                    userId,
                    studioMap,
                    routeAbortController.signal
                );
                const featuredHeroAccessEpoch = currentHeroAccessEpoch();
                const cachedHeroItems = getFeaturedHeroItemsForAccessEpoch(featuredPayload, featuredHeroAccessEpoch);
                const endpointHeroItems = getFeaturedHeroItemsForAccessEpoch(
                    featuredEndpointPayload, featuredHeroAccessEpoch);
                const preferredHeroItems = getItems((cachedHeroItems.length ? cachedHeroItems : endpointHeroItems) as PtvItem[]);
                const userRecommendationRows = await hydrateNativeHomeRecommendationItems(
                    createUserSpecificRecommendationRows(rowSettings),
                    {
                        shouldContinue: isRouteWorkCurrent,
                        signal: routeAbortController.signal,
                        source: 'recommendation-settings-background'
                    }
                );
                const recommendationDebug = createUserSpecificRecommendationDebug(rowSettings, userRecommendationRows);
                recordTimeline('recommendation-rows-received', 'recommendation-settings', {
                    rows: userRecommendationRows
                }, {
                    recommendationRowCount: userRecommendationRows.length
                });

                return {
                    cacheUsedForHero: cachedHeroItems.length > 0,
                    cacheUsedForRows: verifiedCachedRowsResult.rows.length > 0,
                    cachedRows,
                    cachedSectionCount: getFeaturedSectionCount(featuredPayload),
                    customConfiguredRowCount: getCustomConfiguredRowCount(rowSettings),
                    featuredEndpointRows: verifiedEndpointRowsResult.rows,
                    featuredEndpointSectionCount: getFeaturedSectionCount(featuredEndpointPayload),
                    featuredHeroItems: preferredHeroItems,
                    featuredHeroAccessEpoch,
                    heroItems: getItems(heroResult),
                    continueListeningItems: getItems(continueListeningResult),
                    continueReadingItems: getItems(continueReadingResult),
                    recentlyAddedItems: getItems(recentResult),
                    recommendationDebug,
                    rowSettings,
                    rowsEndpointCount: getRowsEndpointCount(rowSettings),
                    shouldLoadSupplementalRows: hasFeaturedCache && !savedRowRulesActive,
                    skippedFeaturedRows: mergeSkippedRows(
                        preferredFeaturedRowsResult.skippedRows,
                        getMissingConfiguredRows(
                            rowSettings,
                            preferredFeaturedRowsResult.rows,
                            preferredFeaturedRowsResult.skippedRows
                        )
                    ),
                    resumeItems: getItems(resumeResult),
                    user,
                    userRecommendationRows
                };
            })
            .then(payload => {
                if (!isRouteWorkCurrent()) return;

                if (renderedFromCache) {
                    const supplementalCachedRows = getNativeHomeSupplementalCachedRows(
                        payload.cachedRows,
                        cacheRowsForSupplemental
                    );
                    const cachedRowsWithResume = mergeNativeHomeResumeRow(
                        supplementalCachedRows,
                        payload.resumeItems,
                        payload.rowSettings
                    );
                    const rowsWithUserRecommendations = payload.userRecommendationRows.length ?
                        insertNativeHomeRecommendationRows(cachedRowsWithResume, payload.userRecommendationRows) :
                        cachedRowsWithResume;
                    const adaptiveBackground = getAdaptiveNativeHomeLayout(rowsWithUserRecommendations, payload.user, performance.now());

                    recordPtvEvent('render', 'native-home-background-refresh-ready', {
                        backgroundRows: adaptiveBackground.rows.length,
                        cachedRows: supplementalCachedRows.length,
                        hasUser: Boolean(payload.user?.Id),
                        recommendationRows: payload.userRecommendationRows.length,
                        shouldLoadSupplementalRows: payload.shouldLoadSupplementalRows
                    });
                    setState(previous => {
                        const settledRows = mergeVerifiedHomeRows(
                            previous.rows,
                            adaptiveBackground.rows
                        );
                        const safeRows = hasRenderableNativeHomeRows(settledRows) ?
                            settledRows :
                            previous.rows;
                        const nextState = {
                            ...previous,
                            debug: {
                                ...previous.debug,
                                home: adaptiveBackground.debug,
                                performance: {
                                    ...previous.debug.performance,
                                    backgroundRefreshStarted: true,
                                    fallbackFetchesSkipped: Array.from(fallbackFetchesSkipped),
                                    slowFetchesAborted: Array.from(slowFetchesAborted)
                                },
                                recommendations: payload.recommendationDebug
                            },
                            rows: safeRows,
                            user: payload.user
                        };

                        if (!hasRenderableNativeHomeRows(adaptiveBackground.rows) && hasRenderableNativeHomeRows(previous.rows)) {
                            recordPtvEvent('render', 'native-home-empty-background-refresh-ignored', {
                                cachedRows: supplementalCachedRows.length,
                                previousRows: previous.rows.length,
                                reason: 'preserve-cache-render'
                            });
                        }

                        rememberUsableNativeHomeState(nextState, 'background-refresh', displayIdentity);

                        return nextState;
                    });

                    if (payload.shouldLoadSupplementalRows) {
                        scheduleSupplementalRows(payload.user, payload.rowSettings, supplementalCachedRows);
                    } else {
                        markBackgroundRefreshCompleted('no-supplemental-rows', {
                            cachedRows: supplementalCachedRows.length
                        });
                    }
                    return;
                }

                const rows = createRows(
                    payload.resumeItems,
                    payload.continueReadingItems,
                    payload.continueListeningItems,
                    payload.recentlyAddedItems,
                    payload.rowSettings
                );
                const userRows = rows.filter(row => ['resume', 'continue-reading', 'continue-listening'].includes(row.id));
                const recentRows = rows.filter(row => row.id === 'recently-added');
                const baseRows = orderFocusedNativeHomeRows([
                    ...userRows,
                    ...recentRows,
                    ...payload.cachedRows
                ]);
                const mergedRows = insertNativeHomeRecommendationRows(baseRows, payload.userRecommendationRows);
                const adaptiveHome = getAdaptiveNativeHomeLayout(mergedRows, payload.user, startedAt);
                const adaptiveRows = adaptiveHome.rows;
                const expandedRuleRows = [
                    ...userRows,
                    ...payload.cachedRows,
                    ...payload.userRecommendationRows
                ];

                if (shouldCollectDiagnostics()) {
                    recordPtvEvent('render', 'native-home-planner-output-merged', {
                        plannedRowCount: adaptiveRows.length,
                        recommendationRows: payload.userRecommendationRows.length,
                        userRowCount: userRows.length
                    });
                }
                recordRowRulesDebug(
                    payload.rowSettings,
                    expandedRuleRows,
                    payload.skippedFeaturedRows,
                    adaptiveRows
                );

                recordPtvEvent('render', 'native-home-row-source-summary', {
                    cachedSectionCount: payload.cachedSectionCount,
                    customConfiguredRowCount: payload.customConfiguredRowCount,
                    featuredSectionCount: payload.featuredEndpointSectionCount,
                    finalHomeRowCount: adaptiveRows.length,
                    recommendationRows: payload.userRecommendationRows.length,
                    rowsEndpointCount: payload.rowsEndpointCount,
                    skippedRows: payload.skippedFeaturedRows
                });

                const preferredHeroItems = payload.featuredHeroItems.length ? payload.featuredHeroItems : payload.heroItems;
                const fallbackHeroItems = getUsableHeroItemsFromRows(adaptiveRows);
                const heroItems = buildNativeHomeHeroItems(preferredHeroItems, fallbackHeroItems);
                const heroItem = heroItems[0] || firstUsableHeroItem(adaptiveRows);
                const firstInteractiveMs = Math.round(performance.now() - startedAt);
                const performanceDebug: NativeHomePerformanceDebug = {
                    backgroundRefreshCompleted: false,
                    backgroundRefreshDurationMs: null,
                    backgroundRefreshStarted: false,
                    cacheHeroUsed: payload.cacheUsedForHero,
                    cacheCommitDelayMs: null,
                    cacheRenderMs: null,
                    cacheResponseReceivedAt: null,
                    cacheRowsUsed: payload.cacheUsedForRows,
                    cacheStateCommittedAt: null,
                    cacheUsedForHero: payload.cacheUsedForHero,
                    cacheUsedForRows: payload.cacheUsedForRows,
                    cachedHeroCount: payload.cacheUsedForHero ? preferredHeroItems.length : 0,
                    cachedItemCount: payload.cacheUsedForRows ? adaptiveRows.reduce((total, row) => total + row.items.length, 0) : 0,
                    cachedRowCount: payload.cacheUsedForRows ? adaptiveRows.length : 0,
                    fallbackFetchesSkipped: Array.from(fallbackFetchesSkipped),
                    firstVisibleContentMs: firstInteractiveMs,
                    firstInteractiveMs,
                    homeInitialRenderMs: firstInteractiveMs,
                    slowFetchesAborted: Array.from(slowFetchesAborted)
                };

                recordPtvEvent('render', 'native-home-hero-items-built', {
                    fallbackHeroCount: fallbackHeroItems.length,
                    finalHeroCount: heroItems.length,
                    preferredHeroCount: preferredHeroItems.length,
                    selectedHeroAvailable: Boolean(heroItem)
                });

                clearPtvShellStatus();
                recordPtvTiming('recommendation', 'native-home-row-plan', performance.now() - startedAt, {
                    cachedRows: payload.cachedRows.length,
                    customConfiguredRowCount: payload.customConfiguredRowCount,
                    featuredEndpointRows: payload.featuredEndpointRows.length,
                    recommendationRows: payload.userRecommendationRows.length,
                    skippedRows: payload.skippedFeaturedRows.length,
                    source: payload.cachedRows.length ? 'featured-cache' : 'jellyfin-api'
                });
                recordPtvTiming('render', 'native-home-render-complete', performance.now() - startedAt, {
                    cachedRows: payload.cachedRows.length,
                    memory: getNativeHomeRowDebugMemorySummary(adaptiveRows, heroItems),
                    rowCount: adaptiveRows.length
                });
                recordPtvEvent('render', 'native-home-interactive', performanceDebug);
                recordPtvTiming('render', 'native-home-initial-render', firstInteractiveMs, performanceDebug);
                const nextState = {
                    debug: {
                        home: adaptiveHome.debug,
                        performance: performanceDebug,
                        recommendations: payload.recommendationDebug
                    },
                    error: null,
                    heroItem,
                    heroAccessEpoch: payload.featuredHeroAccessEpoch,
                    heroItems,
                    independentHeroItems: preferredHeroItems,
                    isLoading: false,
                    rows: adaptiveRows,
                    user: payload.user
                };

                setState(previous => {
                    const safePreviousRows = filterPreviousOwnedRows(previous.rows, nextState.rows);
                    const settledNextState = {
                        ...nextState,
                        configuredHeroAuthorities: previous.configuredHeroAuthorities,
                        independentHeroItems: nextState.heroItems.length ? nextState.independentHeroItems : previous.independentHeroItems,
                        heroItem: nextState.heroItem || previous.heroItem,
                        heroItems: nextState.heroItems.length ? nextState.heroItems : previous.heroItems,
                        rows: mergeSettledNativeHomeRows(safePreviousRows, nextState.rows)
                    };
                    const decision = decideNativeHomeModelReplacement({
                        current: { ...previous, rows: safePreviousRows },
                        currentGeneration: generation,
                        incoming: settledNextState,
                        incomingGeneration: generation
                    });

                    recordTimeline('final-home-model-commit', 'jellyfin-live', settledNextState, {
                        adoptionReason: decision.reason,
                        adopted: decision.allow,
                        replacesPopulatedModel: decision.replacesPopulatedModel
                    });

                    if (!decision.allow) {
                        return {
                            ...previous,
                            error: null,
                            isLoading: false,
                            rows: safePreviousRows,
                            user: payload.user
                        };
                    }

                    if (settledNextState.heroItems.length) recordTimeline('first-hero-committed', 'jellyfin-live', settledNextState);
                    if (settledNextState.rows.length) recordTimeline('first-shelf-committed', 'jellyfin-live', settledNextState);
                    rememberUsableNativeHomeState(settledNextState, 'fresh-home', displayIdentity);

                    return settledNextState;
                });
                if (payload.shouldLoadSupplementalRows) {
                    scheduleSupplementalRows(payload.user, payload.rowSettings, payload.cachedRows);
                }
            })
            .catch(error => {
                if (!isRouteWorkCurrent()) return;

                const message = error instanceof Error ? error.message : 'PiggieTV native home could not load.';

                if (renderedFromCache) {
                    recordPtvEvent('render', 'native-home-background-refresh-failed', {
                        error: message
                    });
                    markBackgroundRefreshCompleted('background-error', {
                        error: message
                    });
                    return;
                }

                const lastUsableState = getLastUsableNativeHomeState(displayIdentity);

                if (lastUsableState) {
                    recordPtvEvent('render', 'native-home-fallback-preserved-last-good-state', {
                        error: message,
                        rowCount: lastUsableState.rows.length
                    });
                    setState({
                        ...lastUsableState,
                        debug: {
                            ...lastUsableState.debug,
                            performance: {
                                ...lastUsableState.debug.performance,
                                backgroundRefreshCompleted: true,
                                backgroundRefreshStarted: true,
                                fallbackFetchesSkipped: Array.from(fallbackFetchesSkipped),
                                slowFetchesAborted: Array.from(slowFetchesAborted)
                            }
                        },
                        error: null,
                        isLoading: false
                    });
                    return;
                }

                recordPtvEvent('render', 'native-home-fallback-used', {
                    error: message
                });
                setPtvShellError(message);
                setState({
                    debug: {
                        home: getEmptyNativeHomeAdaptiveDebug(),
                        performance: {
                            ...getEmptyNativeHomePerformanceDebug(),
                            fallbackFetchesSkipped: Array.from(fallbackFetchesSkipped),
                            homeInitialRenderMs: Math.round(performance.now() - startedAt),
                            slowFetchesAborted: Array.from(slowFetchesAborted)
                        },
                        recommendations: getEmptyRecommendationDebug()
                    },
                    error: message,
                    heroItem: null,
                    heroItems: [],
                    isLoading: false,
                    rows: [],
                    user: null
                });
            })
            .finally(() => {
                if (!disposed) {
                    setPtvShellLoading(false);
                }
            });

        return () => {
            disposed = true;
            if (connectionClient) {
                Events.off(connectionClient, 'websocketclose', retireConnectionProof);
                Events.off(connectionClient, 'websocketopen', retireConnectionProof);
            }
            if (getConfiguredRowFreshnessSnapshot().revision === configuredVerification.revision) {
                retireConfiguredRowFreshness('home-route-retired');
            }
            unsubscribeConfiguredPresentation();
            unsubscribeLibrary();
            membershipAuthority.retire('home-route-retired');
            if (getHomeLibraryAuthoritySnapshot().revision === libraryRevision) retireHomeLibraryAuthority('home-route-retired', { broadcast: false });
            routeAbortController.abort();
            deferredFrameIds.forEach(frameId => {
                window.cancelAnimationFrame(frameId);
            });
            deferredTimerIds.forEach(timerId => {
                window.clearTimeout(timerId);
            });
            deferredFrameIds.clear();
            deferredTimerIds.clear();
            recordTimeline('home-route-retired', 'route');
            setPtvShellLoading(false);
        };
    }, [currentDisplayIdentityKey, setState]);

    const currentPresentation = useMemo(() => retainCurrentNativeHomePresentation(state, currentDisplayIdentityKey),
        [state, currentDisplayIdentityKey, presentationSnapshot, librarySnapshot]);

    return {
        ...currentPresentation,
        identityKey: stateIdentityKey
    };
}

export function useNativeHomeVirtualRows(rows: NativeHomeRow[]) {
    const performanceProfile = useMemo(() => getPtvPerformanceProfile(), []);
    const initialRowCount = Math.max(1, Math.min(3, performanceProfile.homeInitialRowCount || NATIVE_HOME_ROW_INITIAL_BUFFER));
    const fallbackMountCount = Math.max(1, Math.min(NATIVE_HOME_ROW_FALLBACK_MOUNT_COUNT, initialRowCount));
    const rowMountRootMarginPx = getNativeHomeRootMarginPx(
        performanceProfile.homeRowViewportRootMargin,
        NATIVE_HOME_ROW_MOUNT_ROOT_MARGIN_PX
    );
    const observerRootMargin = performanceProfile.homeRowViewportRootMargin || `${rowMountRootMarginPx}px 0px`;
    const [mountedRowIds, setMountedRowIds] = useState<Set<string>>(() => new Set());
    const [mountedRowReasons, setMountedRowReasons] = useState<Map<string, string>>(() => new Map());
    const mountedRowIdsRef = useRef(mountedRowIds);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const rowRefCallbacks = useRef(new Map<string, (node: HTMLElement | null) => void>());
    const observerTriggerCountRef = useRef(0);
    const manualViewportPassCountRef = useRef(0);
    const nodeMap = useRef(new Map<string, HTMLElement>());
    const pendingManualViewportFrame = useRef<number | null>(null);
    const rowsLengthRef = useRef(rows.length);
    const scrollRootRef = useRef<Element | null>(null);
    const lastManualViewportPassAtRef = useRef(0);
    const manualViewportFallbackRanRef = useRef(false);
    const rowIdsKey = useMemo(
        () => rows.map(row => row.id).join('|'),
        [rows]
    );
    const rowIdList = useMemo(
        () => rows.map(row => row.id),
        [rowIdsKey]
    );

    const initialRowIds = useMemo(
        () => rowIdList.slice(0, initialRowCount),
        [initialRowCount, rowIdList]
    );
    const forcedMountedRowIds = useMemo(
        () => new Set(rowIdList),
        [rowIdList]
    );

    useEffect(() => {
        mountedRowIdsRef.current = mountedRowIds;
    }, [mountedRowIds]);

    useEffect(() => {
        rowsLengthRef.current = rows.length;
    }, [rows.length]);

    useEffect(() => {
        const currentRowIds = new Set(rowIdList);

        setMountedRowIds(previous => {
            let changed = false;
            const next = new Set<string>();

            previous.forEach(rowId => {
                if (currentRowIds.has(rowId)) {
                    next.add(rowId);
                    return;
                }

                changed = true;
            });

            return changed ? next : previous;
        });
        setMountedRowReasons(previous => {
            let changed = false;
            const next = new Map<string, string>();

            previous.forEach((reason, rowId) => {
                if (currentRowIds.has(rowId)) {
                    next.set(rowId, reason);
                    return;
                }

                changed = true;
            });

            return changed ? next : previous;
        });
    }, [rowIdList]);

    const mountRows = useCallback((idsToMount: string[], reason: string) => {
        const uniqueRowIds = Array.from(new Set(idsToMount.filter(Boolean)));
        if (!uniqueRowIds.length) return;

        uniqueRowIds.forEach(rowId => {
            const node = nodeMap.current.get(rowId);

            if (node) observerRef.current?.unobserve(node);
        });
        setMountedRowIds(previous => {
            let changed = false;
            const next = new Set(previous);

            uniqueRowIds.forEach(id => {
                if (!next.has(id)) {
                    next.add(id);
                    changed = true;
                }
            });

            return changed ? next : previous;
        });
        setMountedRowReasons(previous => {
            let changed = false;
            const next = new Map(previous);

            uniqueRowIds.forEach(id => {
                if (!next.has(id)) {
                    next.set(id, reason);
                    changed = true;
                }
            });

            return changed ? next : previous;
        });
    }, []);

    const runManualViewportPass = useCallback((reason: string) => {
        pendingManualViewportFrame.current = null;
        if (!NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED && mountedRowIdsRef.current.size >= rowsLengthRef.current) {
            return;
        }
        if (!NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED && manualViewportFallbackRanRef.current) {
            return;
        }
        manualViewportFallbackRanRef.current = true;

        manualViewportPassCountRef.current += 1;
        scrollRootRef.current = getNativeHomeScrollRoot();

        const rowIdsToMount: string[] = [];
        let alreadyMountedCount = 0;
        let fallbackHitCount = 0;
        let viewportHitCount = 0;
        const nodeEntries = Array.from(nodeMap.current.entries())
            .filter(([rowId]) => NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED || !mountedRowIdsRef.current.has(rowId));

        nodeEntries.forEach(([rowId, node], rowIndex) => {
            const viewportPosition = getNativeHomeRowViewportPosition(
                node,
                scrollRootRef.current,
                rowMountRootMarginPx
            );
            const isMounted = NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED || mountedRowIdsRef.current.has(rowId);
            const shouldMountByViewport = viewportPosition.inThreshold;
            const shouldMountByFallback = !NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED
                && observerTriggerCountRef.current === 0
                && /fallback|initial|observer-created/.test(reason)
                && rowIndex < fallbackMountCount;

            if (isMounted) alreadyMountedCount += 1;
            if (shouldMountByViewport) viewportHitCount += 1;
            if (shouldMountByFallback) fallbackHitCount += 1;
            if (!NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED && (shouldMountByViewport || shouldMountByFallback) && !isMounted) {
                rowIdsToMount.push(rowId);
            }
        });

        if (shouldCollectDiagnostics()) {
            recordPtvEvent('render', 'native-home-row-virtualization-manual-pass', {
                alreadyMountedCount,
                fallbackHitCount,
                inspectedRowCount: nodeEntries.length,
                manualViewportPassCount: manualViewportPassCountRef.current,
                mountedRowCount: mountedRowIdsRef.current.size,
                mountThreshold: rowMountRootMarginPx,
                reason,
                rowIdsMounted: rowIdsToMount.slice(0, 12),
                scrollRoot: getNativeHomeScrollRootDebug(scrollRootRef.current),
                totalRows: rowsLengthRef.current,
                viewportHitCount,
                virtualizationDisabled: NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED
            });
        }

        if (!NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED) {
            mountRows(rowIdsToMount, `manual-viewport:${reason}`);
        }
    }, [fallbackMountCount, mountRows, rowMountRootMarginPx]);

    const scheduleManualViewportPass = useCallback((reason: string) => {
        if (!NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED && mountedRowIdsRef.current.size >= rowsLengthRef.current) return;
        if (pendingManualViewportFrame.current !== null) return;

        pendingManualViewportFrame.current = window.requestAnimationFrame(() => {
            const now = performance.now();

            if (now - lastManualViewportPassAtRef.current < 120 && !/initial|observer-created/.test(reason)) {
                pendingManualViewportFrame.current = null;
                return;
            }

            lastManualViewportPassAtRef.current = now;
            runManualViewportPass(reason);
        });
    }, [runManualViewportPass]);

    useEffect(() => {
        if (!NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED) {
            mountRows(initialRowIds, 'initial-buffer');
        }
    }, [initialRowIds, mountRows]);

    useEffect(() => {
        if (!NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED || !rows.length) return;

        recordPtvEvent('render', 'native-home-row-virtualization-disabled', {
            reason: 'temporary-test-force-all-rows',
            totalRows: rows.length
        });
    }, [rows.length]);

    useEffect(() => {
        scrollRootRef.current = getNativeHomeScrollRoot();

        if (!rows.length) {
            recordNativeHomeObserverEvent('observer-registration-skipped', {
                reason: 'no-rows',
                virtualizationDisabled: NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED
            });
            return undefined;
        }

        if (!('IntersectionObserver' in window)) {
            recordNativeHomeObserverEvent('observer-registration-skipped', {
                reason: 'intersection-observer-unavailable',
                scrollRoot: getNativeHomeScrollRootDebug(scrollRootRef.current),
                virtualizationDisabled: NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED
            });

            if (!NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED) {
                mountRows(rowIdList, 'intersection-observer-unavailable');
            }

            return undefined;
        }

        if (observerRef.current) {
            observerRef.current.disconnect();
            recordNativeHomeObserverEvent('observer-disconnected', {
                reason: 'recreate',
                virtualizationDisabled: NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED
            });
        }

        const observerRoot = getNativeHomeObserverRoot(scrollRootRef.current);

        try {
            observerRef.current = new IntersectionObserver(entries => {
                observerTriggerCountRef.current += entries.length;
                const enteredIds = entries
                    .filter(entry => entry.isIntersecting)
                    .map(entry => (entry.target as HTMLElement).dataset.ptvNativeRowId)
                    .filter(Boolean) as string[];

                if (shouldCollectDiagnostics() && enteredIds.length) {
                    recordPtvEvent('render', 'observer-callback', {
                        enteredIds,
                        entryCount: entries.length,
                        intersectingCount: enteredIds.length,
                        root: getNativeHomeElementLabel(scrollRootRef.current),
                        triggerCount: observerTriggerCountRef.current,
                        virtualizationDisabled: NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED
                    });
                }

                if (enteredIds.length && !NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED) {
                    mountRows(enteredIds, 'intersection-observer');
                }
            }, {
                root: observerRoot,
                rootMargin: observerRootMargin,
                threshold: 0.01
            });
        } catch (error) {
            observerRef.current = null;
            recordNativeHomeObserverEvent('observer-registration-failed', {
                error: error instanceof Error ? error.message : String(error),
                reason: 'constructor-failed',
                scrollRoot: getNativeHomeScrollRootDebug(scrollRootRef.current),
                virtualizationDisabled: NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED
            });
            scheduleManualViewportPass('intersection-observer');

            return undefined;
        }

        nodeMap.current.forEach((node, rowId) => {
            if (!mountedRowIdsRef.current.has(rowId)) {
                observerRef.current?.observe(node);
            }
        });
        recordNativeHomeObserverEvent('observer-created', {
            observedNodeCount: nodeMap.current.size,
            observerRoot: getNativeHomeElementLabel(observerRoot),
            reason: 'effect-init',
            rowCount: rows.length,
            scrollRoot: getNativeHomeScrollRootDebug(scrollRootRef.current),
            virtualizationDisabled: NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED
        });
        scheduleManualViewportPass('observer-created');

        return () => {
            observerRef.current?.disconnect();
            observerRef.current = null;
            recordNativeHomeObserverEvent('observer-disconnected', {
                reason: 'effect-cleanup',
                virtualizationDisabled: NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED
            });
        };
    }, [mountRows, observerRootMargin, rowIdList, rowIdsKey, rows.length, scheduleManualViewportPass]);

    useEffect(() => {
        return () => {
            if (pendingManualViewportFrame.current !== null) {
                window.cancelAnimationFrame(pendingManualViewportFrame.current);
                pendingManualViewportFrame.current = null;
            }
        };
    }, []);

    const registerRowRef = useCallback((rowId: string) => {
        const existingCallback = rowRefCallbacks.current.get(rowId);

        if (existingCallback) return existingCallback;

        const callback = (node: HTMLElement | null) => {
            const previousNode = nodeMap.current.get(rowId);

            if (previousNode && observerRef.current) {
                observerRef.current.unobserve(previousNode);
            }

            if (!node) {
                nodeMap.current.delete(rowId);
                return;
            }

            node.dataset.ptvNativeRowId = rowId;
            nodeMap.current.set(rowId, node);

            if (mountedRowIdsRef.current.has(rowId)) {
                observerRef.current?.unobserve(node);
                return;
            }

            observerRef.current?.observe(node);
        };

        rowRefCallbacks.current.set(rowId, callback);

        return callback;
    }, []);

    const isRowMounted = useCallback(
        (rowId: string) => NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED ?
            forcedMountedRowIds.has(rowId) :
            mountedRowIds.has(rowId),
        [forcedMountedRowIds, mountedRowIds]
    );
    const getRowMountReason = useCallback(
        (rowId: string) => NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED ?
            'virtualization-disabled' :
            mountedRowReasons.get(rowId) || null,
        [mountedRowReasons]
    );

    return {
        getRowMountReason,
        isRowMounted,
        mountedRowCount: NATIVE_HOME_ROW_VIRTUALIZATION_DISABLED ? rows.length : mountedRowIds.size,
        registerRowRef
    };
}
