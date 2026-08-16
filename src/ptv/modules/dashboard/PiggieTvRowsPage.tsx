/* eslint-disable @stylistic/operator-linebreak, max-params, no-nested-ternary, react/jsx-no-bind, react/no-array-index-key, sonarjs/anchor-precedence, sonarjs/no-nested-conditional */
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid2';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getPtvPerformanceProfile } from '../../core/clientProfile';
import {
    recordPtvEvent,
    shouldCollectDiagnostics
} from '../../core/observability';
import { ptvSafeConsole } from '../../core/safeConsole';
import {
    PTV_PLUGIN_API
} from '../../core/config';
import {
    getCurrentPtvPluginApiClient,
    getPtvPluginApiDiagnostics,
    getPtvPluginApiResolvedUrl,
    normalizePtvApiError
} from '../../core/pluginApi';
import {
    getFeaturedContentCacheStatus,
    getPtvFeaturedRowConfigHash,
    hydrateFeaturedContentCacheFromDocument,
    invalidateFeaturedContentMemoryCache,
    primeFeaturedContentCacheStatus
} from '../cache/featuredContentCache';
import { getRecommendationTitle } from '../recommendations/scoring/metadata';
import {
    getEnabledPtvPersistedRecommendationRows,
    getPtvRecommendationSettingsHash,
    getValidatedPtvPersistedRecommendationRow,
    normalizePtvRecommendationRowSettings,
    PTV_MIN_RECOMMENDATION_ROW_ITEMS,
    toPtvPersistedRecommendationItem,
    type PtvPersistedRecommendationRow,
    type PtvRecommendationRowSettings
} from '../recommendations/recommendationSettings';
import type {
    PtvRecommendationDashboardData,
    PtvRecommendationScore
} from '../recommendations/types/recommendationTypes';
import { useAdminUnsavedChanges } from '../settings/admin/configuration/useAdminUnsavedChanges';
import {
    MAX_PTV_ROW_IMPORT_BYTES,
    parsePtvRowBuilderImport
} from './rowBuilderImport';
import {
    arePtvAdminSnapshotsEqual,
    getPtvAdminMutationCommitDecision
} from './piggietvConfigurationData';
import {
    PtvRecommendationMutationInProgressError,
    PtvRecommendationSettingsConflictError,
    recommendationSettingsMatch,
    runPtvRecommendationMutationSingleFlight,
    savePtvRecommendationMutationSafely,
    type PtvRecommendationSettingsBaseline
} from './recommendationMutationSafety';

type RowMediaType = 'anime' | 'books' | 'cartoons' | 'liveTv' | 'mixed' | 'movies' | 'music' | 'shows';
type RowSourceType = 'becauseYouWatched' | 'collection' | 'communityRating' | 'continueWatching' | 'genre' | 'image' | 'latest' | 'library' | 'officialRating' | 'person' | 'premiereDate' | 'productionYear' | 'providerId' | 'requested' | 'seasonal' | 'studio' | 'tag';
type RowGenerationMode = 'highestRated' | 'latest' | 'popular' | 'random';
type RowPresentation = 'auto' | 'compact' | 'featured' | 'library-hub' | 'mini' | 'standard';
type HealthLabel = 'Good' | 'Heavy' | 'Moderate' | 'Risky';

type PtvRowSeasonalSettings = {
    endDay?: number | null;
    endMonth?: number | null;
    mode: string;
    startDay?: number | null;
    startMonth?: number | null;
};

type PtvRowBuilderRule = {
    enabled: boolean;
    generationMode: RowGenerationMode;
    groupTitle: string;
    id: string;
    includeSubgenres: boolean;
    itemLimit: number;
    mediaType: RowMediaType;
    name: string;
    providerHints: string[];
    presentation: RowPresentation;
    rowCount: number;
    seasonal: PtvRowSeasonalSettings | null;
    sortPriority: number;
    sourceType: RowSourceType;
    sourceValue: string;
    subgenreRowCount: number;
    tier: number;
};

type LegacyCategory = {
    enabled?: boolean;
    entries?: string[];
    generationMode?: string;
    id?: string;
    mediaType?: RowMediaType;
    rowCount?: number;
    sourcePoolFilters?: string[];
    sourceType?: string;
};

type PtvRowBuilderSettings = {
    categories?: LegacyCategory[];
    defaultsInitialized: boolean;
    enabled: boolean;
    rules: PtvRowBuilderRule[];
    schemaVersion: number;
    showConfiguredRowsOnHome: boolean;
};

type PtvRowPreviewItem = {
    empty?: boolean;
    generationMode?: string;
    id: string;
    itemCount: number;
    mediaType?: string;
    providerUsed?: string;
    ruleId?: string;
    ruleName?: string;
    source?: string;
    sourceType?: string;
    title: string;
    warnings?: string[];
    weak?: boolean;
};

type PtvRowGenerationDiagnostic = {
    candidateCount?: number;
    dropReason?: string | null;
    droppedSourceCount?: number;
    emptyResultReason?: string | null;
    fallbackUsed?: boolean;
    filteredDuplicateCount?: number;
    first10MatchedItemNames?: string[];
    first10ItemNames?: string[];
    generationMode?: string;
    generatedSourceCount?: number;
    generationTimeMs?: number;
    itemCount?: number;
    matchedCount?: number;
    mediaType?: string;
    metadataSourceFieldsUsed?: string[];
    plannedRowCount?: number;
    providerError?: string | null;
    providerUsed?: string;
    queryUsed?: string;
    rowId?: string;
    rowTitle?: string;
    ruleId?: string;
    ruleName?: string;
    ruleType?: string;
    searchTerm?: string;
    sourceType?: string;
    sourceValue?: string;
    studioFilter?: string | null;
};

type PtvRowPreviewResponse = {
    diagnostics?: PtvRowGenerationDiagnostic[];
    ok?: boolean;
    providerStatus?: Record<string, unknown>;
    rows?: PtvRowPreviewItem[];
    settings?: PtvRowBuilderSettings;
    validation?: {
        errors?: string[];
        ok?: boolean;
        warnings?: string[];
    };
};

type PtvStatusMessage = {
    severity: 'error' | 'info' | 'success' | 'warning';
    text: string;
};

type PtvRowGroupSummary = {
    enabledCount: number;
    ruleCount: number;
    title: string;
};

type PerformanceEstimate = {
    configuredRowCount: number;
    estimatedCacheCost: string;
    estimatedFrontendCost: string;
    expectedItemCount: number;
    expectedRowCount: number;
    health: HealthLabel;
    providerCalls: number;
    reasons: string[];
};

const CUSTOM_GENRE = '__custom__';
const SUBGENRES_DISABLED_PROVIDER_HINT = 'ptv-subgenres-disabled';
const ROW_BUILDER_LOAD_TIMEOUT_MS = 15000;
const STUDIO_SOURCE_HELPER_TEXT = 'Matches Jellyfin item.Studios exactly or by normalized text. Examples: Disney, Pixar, Lucasfilm.';

const MEDIA_TYPES: Array<{ label: string; value: RowMediaType }> = [
    { label: 'Movies', value: 'movies' },
    { label: 'Shows', value: 'shows' },
    { label: 'Cartoons', value: 'cartoons' },
    { label: 'Anime', value: 'anime' },
    { label: 'Music', value: 'music' },
    { label: 'Books', value: 'books' },
    { label: 'Live TV', value: 'liveTv' },
    { label: 'Mixed', value: 'mixed' }
];

const SOURCE_TYPES: Array<{ label: string; value: RowSourceType }> = [
    { label: 'Genre', value: 'genre' },
    { label: 'Studio', value: 'studio' },
    { label: 'Tag', value: 'tag' },
    { label: 'Provider ID', value: 'providerId' },
    { label: 'Person', value: 'person' },
    { label: 'Production Year', value: 'productionYear' },
    { label: 'Official Rating', value: 'officialRating' },
    { label: 'Community Rating', value: 'communityRating' },
    { label: 'Premiere Date', value: 'premiereDate' },
    { label: 'Image Metadata', value: 'image' },
    { label: 'Library', value: 'library' },
    { label: 'Collection', value: 'collection' },
    { label: 'Requested', value: 'requested' },
    { label: 'Continue Watching', value: 'continueWatching' },
    { label: 'Because You Watched', value: 'becauseYouWatched' },
    { label: 'Latest', value: 'latest' },
    { label: 'Seasonal / Holiday', value: 'seasonal' }
];

const GENERATION_MODES: Array<{ label: string; value: RowGenerationMode }> = [
    { label: 'Random', value: 'random' },
    { label: 'Latest', value: 'latest' },
    { label: 'Popular', value: 'popular' },
    { label: 'Highest Rated', value: 'highestRated' }
];

const ROW_TIERS = [
    { label: 'Auto', value: 0 },
    { label: 'Tier 1', value: 1 },
    { label: 'Tier 2', value: 2 },
    { label: 'Tier 3', value: 3 }
];

const ROW_PRESENTATIONS: Array<{ label: string; value: RowPresentation }> = [
    { label: 'Auto', value: 'auto' },
    { label: 'Featured', value: 'featured' },
    { label: 'Standard', value: 'standard' },
    { label: 'Compact', value: 'compact' },
    { label: 'Mini', value: 'mini' },
    { label: 'Library Hub', value: 'library-hub' }
];

const SEASONAL_MODES = [
    { label: 'Auto Seasonal', value: 'auto' },
    { label: 'Halloween', value: 'halloween' },
    { label: 'Christmas', value: 'christmas' },
    { label: 'Thanksgiving', value: 'thanksgiving' },
    { label: "Valentine's Day", value: 'valentines' },
    { label: 'Summer', value: 'summer' },
    { label: 'Winter', value: 'winter' },
    { label: 'New Year', value: 'newYear' },
    { label: 'Custom Date Range', value: 'custom' }
];

const COMMON_GENRES = [
    'Action',
    'Adventure',
    'Animation',
    'Comedy',
    'Crime',
    'Documentary',
    'Drama',
    'Family',
    'Fantasy',
    'Horror',
    'Mystery',
    'Romance',
    'Science Fiction',
    'Thriller',
    'War',
    'Western'
];

const GENRES_BY_MEDIA: Record<string, string[]> = {
    anime: ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Isekai', 'Mecha', 'Romance', 'Shonen', 'Shojo', 'Slice of Life', 'Supernatural'],
    books: ['Fantasy', 'Science Fiction', 'Horror', 'Mystery', 'Thriller', 'Manga', 'Comics'],
    cartoons: COMMON_GENRES,
    liveTv: COMMON_GENRES,
    movies: COMMON_GENRES,
    music: ['Rock', 'Metal', 'Hip-Hop', 'Pop', 'Country', 'Jazz', 'Electronic', 'Soundtrack'],
    shows: COMMON_GENRES
};

const DEFAULT_SETTINGS: PtvRowBuilderSettings = {
    enabled: true,
    schemaVersion: 2,
    defaultsInitialized: true,
    showConfiguredRowsOnHome: true,
    rules: [
        makeRule('continue-watching', 'Continue Watching', 'mixed', 'continueWatching', 'continue', 'latest', 16, 1, 0),
        makeRule('latest-movies', 'Latest Movies', 'movies', 'latest', 'movies', 'latest', 16, 1, 10),
        makeRule('latest-shows', 'Latest Shows', 'shows', 'latest', 'shows', 'latest', 16, 1, 20),
        makeRule('latest-cartoons', 'Latest Cartoons', 'cartoons', 'latest', 'cartoons', 'latest', 16, 1, 30),
        makeRule('latest-anime', 'Latest Anime', 'anime', 'latest', 'anime', 'latest', 16, 1, 40),
        makeRule('latest-music', 'Latest Music', 'music', 'latest', 'music', 'latest', 16, 1, 50),
        {
            ...makeRule('requested-by-you', 'Requested By You', 'mixed', 'requested', 'jellyseerr', 'latest', 16, 1, 60),
            enabled: false
        }
    ]
};

function makeRule(
    id: string,
    name: string,
    mediaType: RowMediaType,
    sourceType: RowSourceType,
    sourceValue: string,
    generationMode: RowGenerationMode,
    itemLimit: number,
    rowCount: number,
    sortPriority: number
): PtvRowBuilderRule {
    return {
        id,
        enabled: true,
        name,
        mediaType,
        sourceType,
        sourceValue,
        generationMode,
        itemLimit,
        rowCount,
        includeSubgenres: false,
        subgenreRowCount: 0,
        seasonal: sourceType === 'seasonal' ? { mode: 'auto' } : null,
        providerHints: [],
        sortPriority,
        tier: 0,
        presentation: 'auto',
        groupTitle: ''
    };
}

function slugify(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        || `rule-${Date.now()}`;
}

function migrateLegacyCategory(category: LegacyCategory, index: number): PtvRowBuilderRule[] {
    const mediaType = category.mediaType || 'movies';
    const sourceType: RowSourceType = category.sourceType === 'studio' ? 'studio' : category.sourceType === 'genre' ? 'genre' : 'collection';

    if (category.generationMode === 'specific') {
        return (category.entries || []).map((entry, entryIndex) => makeRule(
            slugify(`${category.id || 'legacy'}-${entry}`),
            entry,
            mediaType,
            sourceType,
            entry,
            'popular',
            16,
            1,
            (index * 100) + entryIndex
        ));
    }

    const sources = category.sourcePoolFilters?.length ? category.sourcePoolFilters : [category.id || mediaType];

    return sources.map((source, sourceIndex) => makeRule(
        slugify(`${category.id || 'legacy'}-${source}`),
        source,
        mediaType,
        sourceType,
        source,
        'random',
        16,
        Math.max(1, category.rowCount || 1),
        (index * 100) + sourceIndex
    ));
}

function normalizeRuleTier(value: unknown) {
    const tier = Number(value);

    return [0, 1, 2, 3].includes(tier) ? tier : 0;
}

function normalizeRulePresentation(value: unknown): RowPresentation {
    return ROW_PRESENTATIONS.some(option => option.value === value) ? value as RowPresentation : 'auto';
}

function getDefaultSourceValue(
    rule: Partial<PtvRowBuilderRule>,
    sourceType: RowSourceType,
    mediaType: RowMediaType,
    seasonal: PtvRowSeasonalSettings | null
) {
    if (rule.sourceValue) return rule.sourceValue;
    if (sourceType === 'latest') return mediaType;
    if (sourceType === 'continueWatching') return 'continue';
    if (sourceType === 'becauseYouWatched') return 'watched';
    if (sourceType === 'requested') return 'jellyseerr';
    if (sourceType === 'seasonal') return seasonal?.mode || 'auto';

    return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pascalCase(value: string) {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function getPayloadValue(source: unknown, key: string) {
    if (!isRecord(source)) return undefined;

    if (Object.prototype.hasOwnProperty.call(source, key)) {
        return source[key];
    }

    const pascalKey = pascalCase(key);

    return Object.prototype.hasOwnProperty.call(source, pascalKey) ? source[pascalKey] : undefined;
}

function getPayloadArray(source: unknown, key: string) {
    const value = getPayloadValue(source, key);

    return Array.isArray(value) ? value : [];
}

function getPayloadRecord(source: unknown, key: string) {
    const value = getPayloadValue(source, key);

    return isRecord(value) ? value : null;
}

function getPayloadBoolean(source: unknown, key: string) {
    const value = getPayloadValue(source, key);

    return typeof value === 'boolean' ? value : null;
}

function getPayloadNumberOrNull(source: unknown, key: string) {
    const value = getPayloadValue(source, key);
    const numeric = Number(value);

    return Number.isFinite(numeric) ? numeric : null;
}

function getPayloadStringOrNull(source: unknown, key: string) {
    const value = getPayloadValue(source, key);

    return typeof value === 'string' && value.trim() ? value : null;
}

function getPayloadStringFromKeys(source: unknown, ...keys: string[]) {
    for (const key of keys) {
        const value = getPayloadStringOrNull(source, key);

        if (value) return value;
    }

    return null;
}

function getPayloadNumberFromKeys(source: unknown, ...keys: string[]) {
    for (const key of keys) {
        const value = getPayloadNumberOrNull(source, key);

        if (value !== null) return value;
    }

    return null;
}

function getFeaturedSectionItemCount(section: unknown, sectionItems: Record<string, unknown> | null) {
    const explicitCount = getPayloadNumberFromKeys(section, 'itemCount', 'ItemCount');
    const sectionId = getPayloadStringFromKeys(section, 'id', 'Id', 'key', 'Key', 'sectionId', 'SectionId');

    if (explicitCount !== null && explicitCount > 0) return explicitCount;
    if (sectionId && sectionItems) {
        const items = sectionItems[sectionId];

        if (Array.isArray(items)) return items.length;
    }

    const embeddedItems = getPayloadArray(section, 'items');

    if (embeddedItems.length > 0) return embeddedItems.length;
    if (explicitCount !== null) return explicitCount;

    return 0;
}

function getFeaturedSectionRowType(section: unknown) {
    const rowType = getPayloadStringFromKeys(section, 'rowType', 'RowType');

    if (rowType) return rowType;

    const sourceType = (getPayloadStringFromKeys(section, 'sourceType', 'SourceType') || '').toLowerCase();
    const sectionType = (getPayloadStringFromKeys(section, 'type', 'Type') || '').toLowerCase();

    if (sourceType === 'recommendation' || sectionType === 'recommendation') return 'generated-recommendation';
    if (sourceType === 'legacy') return 'fallback';

    return 'configured-rule';
}

function getFeaturedCacheDocumentSummary(document: unknown) {
    const featuredContent = getPayloadRecord(document, 'featuredContent');
    const payload = getPayloadRecord(featuredContent, 'payload');
    const heroItems = getPayloadArray(payload, 'heroItems');
    const sections = getPayloadArray(payload, 'sections');
    const diagnostics = getPayloadArray(payload, 'rowDiagnostics');
    const sectionItems = getPayloadRecord(payload, 'sectionItems');
    const sectionCount = sectionItems ? Object.keys(sectionItems).length : 0;
    const itemCount = sectionItems ? Object.keys(sectionItems).reduce((total, sectionId) => {
        const items = sectionItems[sectionId];

        return total + (Array.isArray(items) ? items.length : 0);
    }, 0) : 0;
    const renderedSections = sections.filter(section => getFeaturedSectionItemCount(section, sectionItems) > 0);
    const configuredRowCount = renderedSections.filter(section => getFeaturedSectionRowType(section) === 'configured-rule').length;
    const recommendationRowCount = renderedSections.filter(section => getFeaturedSectionRowType(section) === 'generated-recommendation').length;
    const skippedRows = diagnostics
        .filter(diagnostic => getPayloadStringOrNull(diagnostic, 'dropReason'))
        .map(diagnostic => ({
            reason: getPayloadStringOrNull(diagnostic, 'dropReason'),
            rowId: getPayloadStringOrNull(diagnostic, 'rowId'),
            rowTitle: getPayloadStringOrNull(diagnostic, 'rowTitle'),
            rowType: getPayloadStringOrNull(diagnostic, 'rowType')
        }));

    return {
        configuredRowCount,
        hasFeaturedContent: Boolean(featuredContent),
        heroCount: heroItems.length,
        itemCount,
        payloadSize: JSON.stringify(featuredContent || {}).length,
        recommendationRowCount,
        sectionCount,
        skippedRows,
        totalRenderedRowCount: configuredRowCount + recommendationRowCount,
        updatedAt: getPayloadNumberOrNull(document, 'updatedAt')
    };
}

type FeaturedCacheDocumentSummary = ReturnType<typeof getFeaturedCacheDocumentSummary>;
type FeaturedCacheReadback = {
    document: unknown | null;
    error: string | null;
    summary: FeaturedCacheDocumentSummary;
};
type FeaturedCacheApiClient = NonNullable<ReturnType<typeof getCurrentPtvPluginApiClient>>;

type FeaturedCacheRefreshResult = {
    cachePayloadBytes: number | null;
    cacheWriteError: string | null;
    effectiveHasPayload: boolean;
    featuredCacheExists: boolean | null;
    featuredCacheFresh: boolean | null;
    heroCount: number;
    itemCount: number;
    lastRefreshError: string | null;
    localCache: ReturnType<typeof getFeaturedContentCacheStatus>;
    ok: boolean | null;
    prime: FeaturedCacheDocumentSummary;
    readback: FeaturedCacheDocumentSummary;
    responseError: string | null;
    sectionCount: number;
    staleReadbackWarning: string | null;
};

type RecommendationSettingsSaveResult = {
    cacheRefresh: FeaturedCacheRefreshResult | null;
    cacheRefreshError: string;
    settings: PtvRecommendationRowSettings;
};

const FEATURED_CACHE_READBACK_RETRY_DELAY_MS = 1500;

function waitForFeaturedCacheReadbackRetry() {
    return new Promise<void>(resolve => {
        window.setTimeout(resolve, FEATURED_CACHE_READBACK_RETRY_DELAY_MS);
    });
}

function isFeaturedCacheReadbackStale(readbackSummary: FeaturedCacheDocumentSummary, refreshStartedAt: number) {
    return Boolean(readbackSummary.updatedAt && readbackSummary.updatedAt < refreshStartedAt - 1000);
}

function getFeaturedCacheStaleReadbackWarning(readbackSummary: FeaturedCacheDocumentSummary, refreshStartedAt: number) {
    if (!isFeaturedCacheReadbackStale(readbackSummary, refreshStartedAt)) return null;

    return `Featured cache readback is older than this refresh request (${new Date(readbackSummary.updatedAt || 0).toLocaleTimeString()} < ${new Date(refreshStartedAt).toLocaleTimeString()}).`;
}

function shouldSurfaceFeaturedCacheStaleReadbackWarning(status: {
    cacheWriteError: string | null;
    effectiveHasPayload: boolean;
    featuredCacheFresh: boolean | null;
    lastRefreshError: string | null;
    ok: boolean | null;
    responseError: string | null;
}) {
    return Boolean(
        status.cacheWriteError
        || status.lastRefreshError
        || status.responseError
        || !status.effectiveHasPayload
        || status.ok === false
        || status.featuredCacheFresh === false
    );
}

async function readFeaturedCacheDocumentReadback(
    api: FeaturedCacheApiClient,
    reason: string,
    eventContext: Record<string, unknown>,
    attempt: 'initial' | 'retry'
): Promise<FeaturedCacheReadback> {
    return api.getFeaturedContentCacheDocument({ bypassCache: true })
        .then(document => {
            const summary = getFeaturedCacheDocumentSummary(document);

            recordPtvEvent('api', 'row-builder-featured-cache-readback-result', {
                ...eventContext,
                ...summary,
                attempt,
                reason
            });

            return {
                document,
                error: null,
                summary
            };
        })
        .catch(error => {
            const message = normalizePtvApiError(error).message;
            const summary = {
                configuredRowCount: 0,
                error: message,
                fallbackRowCount: 0,
                hasFeaturedContent: false,
                heroCount: 0,
                itemCount: 0,
                payloadSize: 0,
                recommendationRowCount: 0,
                sectionCount: 0,
                skippedRows: [],
                totalRenderedRowCount: 0,
                updatedAt: null
            };

            recordPtvEvent('api', 'row-builder-featured-cache-readback-failed', {
                ...eventContext,
                ...summary,
                attempt,
                reason
            });

            return {
                document: null,
                error: message,
                summary
            };
        });
}

async function readFreshFeaturedCacheDocumentReadback(
    api: FeaturedCacheApiClient,
    reason: string,
    refreshStartedAt: number,
    eventContext: Record<string, unknown>
) {
    const firstReadback = await readFeaturedCacheDocumentReadback(api, reason, eventContext, 'initial');
    const firstReadbackSummary = firstReadback.summary;

    if (!isFeaturedCacheReadbackStale(firstReadbackSummary, refreshStartedAt)) return firstReadback;

    const staleReadbackWarning = getFeaturedCacheStaleReadbackWarning(firstReadbackSummary, refreshStartedAt);

    recordPtvEvent('api', 'row-builder-featured-cache-stale-readback-detected', {
        ...eventContext,
        ...firstReadbackSummary,
        reason,
        refreshStartedAt,
        retryDelayMs: FEATURED_CACHE_READBACK_RETRY_DELAY_MS,
        staleReadbackWarning
    });

    invalidateFeaturedContentMemoryCache(`featured-cache-stale-readback-${reason}`);
    await waitForFeaturedCacheReadbackRetry();

    const retryReadback = await readFeaturedCacheDocumentReadback(api, reason, eventContext, 'retry');
    const retryReadbackSummary = retryReadback.summary;

    recordPtvEvent('api', 'row-builder-featured-cache-stale-readback-retry-result', {
        ...eventContext,
        ...retryReadbackSummary,
        reason,
        refreshStartedAt,
        staleReadbackWarning: getFeaturedCacheStaleReadbackWarning(retryReadbackSummary, refreshStartedAt)
    });

    return retryReadback;
}

async function observeStoredFeaturedCacheDocumentAfterSave(
    reason: string,
    refreshStartedAt: number,
    eventContext: Record<string, unknown> = {}
): Promise<FeaturedCacheRefreshResult> {
    const api = getCurrentPtvPluginApiClient();

    if (!api?.getFeaturedContentCacheDocument) {
        throw new Error('PiggieTV featured cache API is unavailable.');
    }

    recordPtvEvent('api', 'row-builder-featured-cache-observation-start', {
        ...eventContext,
        refreshStartedAt,
        reason
    });

    // POST /settings with recommendations and POST /rows already rebuild the
    // Featured cache on the server before resolving. Observe that result with
    // a read-only request instead of starting a duplicate rebuild.
    const response: Record<string, unknown> = {};
    const featuredContent = getPayloadRecord(response, 'featuredContent');
    const contentCacheStatus = getPayloadRecord(response, 'contentCacheStatus');
    const storeStatus = getPayloadRecord(response, 'storeStatus');
    const readback = await readFreshFeaturedCacheDocumentReadback(api, reason, refreshStartedAt, eventContext);
    const readbackSummary = readback.summary;
    const sectionCount =
        getPayloadNumberOrNull(featuredContent, 'sectionCount') ??
        getPayloadNumberOrNull(response, 'sectionCount') ??
        getPayloadNumberOrNull(storeStatus, 'sectionCount') ??
        readbackSummary.sectionCount;
    const itemCount =
        getPayloadNumberOrNull(featuredContent, 'itemCount') ??
        getPayloadNumberOrNull(response, 'itemCount') ??
        getPayloadNumberOrNull(storeStatus, 'itemCount') ??
        readbackSummary.itemCount;
    const heroCount =
        getPayloadNumberOrNull(featuredContent, 'heroCount') ??
        getPayloadNumberOrNull(response, 'heroCount') ??
        readbackSummary.heroCount;
    const cachePayloadBytes =
        getPayloadNumberOrNull(response, 'cachePayloadBytes') ??
        getPayloadNumberOrNull(contentCacheStatus, 'payloadBytes') ??
        getPayloadNumberOrNull(storeStatus, 'cachePayloadBytes') ??
        readbackSummary.payloadSize;
    const cacheWriteError =
        getPayloadStringOrNull(response, 'cacheWriteError') ??
        getPayloadStringOrNull(contentCacheStatus, 'writeError') ??
        getPayloadStringOrNull(storeStatus, 'cacheWriteError');
    const lastRefreshError = getPayloadStringOrNull(response, 'lastRefreshError');
    const responseError = getPayloadStringOrNull(response, 'error') ?? readback.error;
    const featuredCacheExists =
        getPayloadBoolean(response, 'featuredCacheExists') ??
        getPayloadBoolean(contentCacheStatus, 'exists') ??
        getPayloadBoolean(storeStatus, 'featuredCacheExists');
    const featuredCacheFresh =
        getPayloadBoolean(response, 'featuredCacheFresh') ??
        getPayloadBoolean(contentCacheStatus, 'fresh') ??
        getPayloadBoolean(storeStatus, 'featuredCacheFresh');
    const hasPayload = getPayloadBoolean(featuredContent, 'hasPayload');
    const ok = getPayloadBoolean(response, 'ok');

    let primedCacheEntry = readback.document
        ? hydrateFeaturedContentCacheFromDocument(readback.document, `featured-cache-refresh-${reason}`)
        : null;

    if (!readback.document) {
        invalidateFeaturedContentMemoryCache(`featured-cache-refresh-${reason}`);
        primedCacheEntry = await primeFeaturedContentCacheStatus();
    }

    const primedSummary = getFeaturedCacheDocumentSummary({
        featuredContent: primedCacheEntry,
        updatedAt: primedCacheEntry?.createdAt
    });
    const localCache = getFeaturedContentCacheStatus();
    const responseHasPayload = hasPayload ?? readbackSummary.hasFeaturedContent;
    const effectiveHasPayload = responseHasPayload || primedSummary.hasFeaturedContent;
    const readbackStaleWarning = getFeaturedCacheStaleReadbackWarning(readbackSummary, refreshStartedAt);
    const staleReadbackWarning = readbackStaleWarning && shouldSurfaceFeaturedCacheStaleReadbackWarning({
        cacheWriteError,
        effectiveHasPayload,
        featuredCacheFresh,
        lastRefreshError,
        ok,
        responseError
    }) ? readbackStaleWarning : null;

    if (readbackStaleWarning && !staleReadbackWarning) {
        recordPtvEvent('api', 'row-builder-featured-cache-stale-readback-warning-suppressed', {
            ...eventContext,
            effectiveHasPayload,
            featuredCacheFresh,
            ok,
            reason,
            refreshStartedAt,
            staleReadbackWarning: readbackStaleWarning
        });
    }

    const result: FeaturedCacheRefreshResult = {
        cachePayloadBytes,
        cacheWriteError,
        effectiveHasPayload,
        featuredCacheExists: featuredCacheExists ?? Boolean(readback.document),
        featuredCacheFresh: featuredCacheFresh ?? localCache.isFresh,
        heroCount,
        itemCount,
        lastRefreshError,
        localCache,
        ok: ok ?? (readback.error ? false : Boolean(readback.document)),
        prime: primedSummary,
        readback: readbackSummary,
        responseError,
        sectionCount,
        staleReadbackWarning
    };

    recordPtvEvent('api', 'row-builder-featured-cache-observation-complete', {
        ...eventContext,
        ...result,
        reason
    });
    recordPtvEvent('api', 'row-builder-featured-cache-prime-result', {
        ...primedSummary,
        isStored: localCache.isStored,
        readError: localCache.readError,
        reason,
        storage: localCache.storage
    });

    return result;
}

function getFeaturedCacheRefreshWarning(result: FeaturedCacheRefreshResult | null) {
    if (!result) return '';

    return result.cacheWriteError || result.lastRefreshError || result.responseError || result.staleReadbackWarning || '';
}

function getRecommendationSaveSuccessText(action: string, result: RecommendationSettingsSaveResult) {
    if (result.cacheRefreshError) {
        return `${action} saved. Featured cache refresh warning: ${result.cacheRefreshError}`;
    }

    const warning = getFeaturedCacheRefreshWarning(result.cacheRefresh);

    if (warning) {
        return `${action} saved. Featured cache refresh warning: ${warning}`;
    }

    if (result.cacheRefresh) {
        return `${action} saved and featured cache refreshed (${result.cacheRefresh.readback.configuredRowCount} configured rows, ${result.cacheRefresh.readback.recommendationRowCount} recommendation rows, ${result.cacheRefresh.sectionCount} total sections).`;
    }

    return `${action} saved.`;
}

function normalizeChoice<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
    return options.includes(value as T) ? value as T : fallback;
}

function normalizeNumber(value: unknown, fallback: number) {
    const numeric = Number(value);

    return Number.isFinite(numeric) ? numeric : fallback;
}

function hasSubgenresDisabledHint(providerHints: string[]) {
    return providerHints.some(hint => hint.toLowerCase() === SUBGENRES_DISABLED_PROVIDER_HINT);
}

function withSubgenresDisabledHint(providerHints: string[]) {
    return hasSubgenresDisabledHint(providerHints)
        ? providerHints
        : [...providerHints, SUBGENRES_DISABLED_PROVIDER_HINT];
}

function withoutSubgenresDisabledHint(providerHints: string[]) {
    return providerHints.filter(hint => hint.toLowerCase() !== SUBGENRES_DISABLED_PROVIDER_HINT);
}

function normalizeSeasonalSettings(value: unknown): PtvRowSeasonalSettings {
    return {
        mode: String(getPayloadValue(value, 'mode') || 'auto'),
        startMonth: getPayloadValue(value, 'startMonth') == null ? null : normalizeNumber(getPayloadValue(value, 'startMonth'), 1),
        startDay: getPayloadValue(value, 'startDay') == null ? null : normalizeNumber(getPayloadValue(value, 'startDay'), 1),
        endMonth: getPayloadValue(value, 'endMonth') == null ? null : normalizeNumber(getPayloadValue(value, 'endMonth'), 12),
        endDay: getPayloadValue(value, 'endDay') == null ? null : normalizeNumber(getPayloadValue(value, 'endDay'), 31)
    };
}

function normalizeRule(rule: Partial<PtvRowBuilderRule> | Record<string, unknown>, index: number): PtvRowBuilderRule {
    const sourceType = normalizeChoice(
        getPayloadValue(rule, 'sourceType'),
        SOURCE_TYPES.map(option => option.value),
        'genre'
    );
    const mediaType = normalizeChoice(
        getPayloadValue(rule, 'mediaType'),
        MEDIA_TYPES.map(option => option.value),
        'movies'
    );
    const seasonal = sourceType === 'seasonal'
        ? normalizeSeasonalSettings(getPayloadValue(rule, 'seasonal') || { mode: 'auto' })
        : null;
    const sourceValue = getDefaultSourceValue(
        { sourceValue: String(getPayloadValue(rule, 'sourceValue') || '') },
        sourceType,
        mediaType,
        seasonal
    );
    const generationMode = normalizeChoice(
        getPayloadValue(rule, 'generationMode'),
        GENERATION_MODES.map(option => option.value),
        'random'
    );
    const rowCount = normalizeNumber(getPayloadValue(rule, 'rowCount'), 1);
    const providerHints = getPayloadArray(rule, 'providerHints')
        .map(value => String(value))
        .filter(Boolean);
    const isRandomGenreRule = sourceType === 'genre' && generationMode === 'random';
    const subgenresExplicitlyDisabled = hasSubgenresDisabledHint(providerHints);
    const includeSubgenres = isRandomGenreRule
        && (getPayloadValue(rule, 'includeSubgenres') === true
            || (!subgenresExplicitlyDisabled && rowCount > 1));
    const subgenreRowCount = includeSubgenres
        ? Math.min(Math.max(0, normalizeNumber(getPayloadValue(rule, 'subgenreRowCount'), Math.max(0, rowCount - 1))), Math.max(0, rowCount - 1))
        : 0;

    return {
        id: String(getPayloadValue(rule, 'id') || slugify(String(getPayloadValue(rule, 'name') || `row-${index + 1}`))),
        enabled: getPayloadValue(rule, 'enabled') !== false,
        name: String(getPayloadValue(rule, 'name') || `Row ${index + 1}`),
        mediaType,
        sourceType,
        sourceValue,
        generationMode,
        itemLimit: normalizeNumber(getPayloadValue(rule, 'itemLimit'), 16),
        rowCount,
        includeSubgenres,
        subgenreRowCount,
        seasonal,
        providerHints: includeSubgenres ? withoutSubgenresDisabledHint(providerHints) : providerHints,
        sortPriority: normalizeNumber(getPayloadValue(rule, 'sortPriority'), index * 10),
        tier: normalizeRuleTier(getPayloadValue(rule, 'tier')),
        presentation: normalizeRulePresentation(getPayloadValue(rule, 'presentation')),
        groupTitle: String(getPayloadValue(rule, 'groupTitle') || '')
    };
}

function cloneSettings(settings?: Partial<PtvRowBuilderSettings> | null): PtvRowBuilderSettings {
    if (!settings) return structuredCloneSafe(DEFAULT_SETTINGS);

    const rawRules = getPayloadArray(settings, 'rules');
    const rawCategories = getPayloadArray(settings, 'categories') as LegacyCategory[];
    const hasExplicitRules = Array.isArray(getPayloadValue(settings, 'rules'));
    const migratedRules = rawRules.length
        ? rawRules
        : rawCategories.flatMap(migrateLegacyCategory);
    const rulesSource = migratedRules.length
        ? migratedRules
        : hasExplicitRules
            ? []
            : DEFAULT_SETTINGS.rules;
    const rules = rulesSource
        .map(normalizeRule)
        .sort((left, right) => left.sortPriority - right.sortPriority);

    return {
        enabled: getPayloadValue(settings, 'enabled') !== false,
        schemaVersion: 2,
        defaultsInitialized: true,
        showConfiguredRowsOnHome: getPayloadValue(settings, 'showConfiguredRowsOnHome') === true || getPayloadValue(settings, 'enableConfiguredRows') === true,
        rules
    };
}

class PtvRowsConflictError extends Error {
    constructor() {
        super('Home Row settings changed on the server while this page was open.');
        this.name = 'PtvRowsConflictError';
    }
}

class PtvRowsSaveVerificationError extends Error {
    constructor() {
        super('The server did not confirm the submitted Home Row settings.');
        this.name = 'PtvRowsSaveVerificationError';
    }
}

function rowSettingsMatch(left: PtvRowBuilderSettings, right: PtvRowBuilderSettings) {
    return arePtvAdminSnapshotsEqual(cloneSettings(left), cloneSettings(right));
}

function getRowsFromSettingsPayload(payload: unknown): PtvRowBuilderSettings | null {
    const rows = getPayloadValue(payload, 'rows');

    return isRecord(rows) ? rows as PtvRowBuilderSettings : null;
}

function getSeerrConfiguredFromSettingsPayload(payload: unknown) {
    const seerrSettings = getPayloadRecord(payload, 'seerrSettings');

    return getPayloadValue(seerrSettings, 'apiKeyConfigured') === true;
}

function getRuleIds(settings: PtvRowBuilderSettings) {
    return settings.rules.map(rule => rule.id);
}

function isDefaultRuleSet(settings: PtvRowBuilderSettings) {
    const defaultIds = getRuleIds(cloneSettings(DEFAULT_SETTINGS));
    const ids = getRuleIds(settings);

    return ids.length === defaultIds.length && ids.every((id, index) => id === defaultIds[index]);
}

function getRowsDebugSummary(settings: PtvRowBuilderSettings) {
    return {
        defaultRuleSet: isDefaultRuleSet(settings),
        enabled: settings.enabled,
        ruleCount: settings.rules.length,
        showConfiguredRowsOnHome: settings.showConfiguredRowsOnHome,
        ruleIds: getRuleIds(settings)
    };
}

function structuredCloneSafe<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function getGenres(mediaType: RowMediaType) {
    return GENRES_BY_MEDIA[mediaType] || COMMON_GENRES;
}

function isBuiltInGenre(rule: PtvRowBuilderRule) {
    return getGenres(rule.mediaType).some(genre => genre.toLowerCase() === rule.sourceValue.toLowerCase());
}

function estimateRuleRows(rule: PtvRowBuilderRule) {
    if (!rule.enabled) return 0;
    if (rule.sourceType === 'genre' && rule.generationMode === 'random') {
        return Math.max(1, rule.rowCount || 1);
    }

    return 1;
}

function estimatePerformance(settings: PtvRowBuilderSettings): PerformanceEstimate {
    const enabledRules = settings.enabled ? settings.rules.filter(rule => rule.enabled) : [];
    const expectedRowCount = enabledRules.reduce((total, rule) => total + estimateRuleRows(rule), 0);
    const expectedItemCount = enabledRules.reduce((total, rule) => total + (estimateRuleRows(rule) * Math.max(1, rule.itemLimit || 16)), 0);
    const providerCalls = enabledRules.filter(rule => ['anime', 'cartoons', 'movies', 'music', 'shows'].includes(rule.mediaType)).length;
    const reasons: string[] = [];

    if (expectedRowCount > 30) reasons.push('many generated rows');
    if (expectedItemCount > 500) reasons.push('large item payload');
    if (providerCalls > 20) reasons.push('provider-heavy matching');

    let health: HealthLabel = 'Good';

    if (expectedRowCount > 45 || expectedItemCount > 800) health = 'Risky';
    else if (expectedRowCount > 28 || expectedItemCount > 500) health = 'Heavy';
    else if (expectedRowCount > 16 || expectedItemCount > 260) health = 'Moderate';

    return {
        configuredRowCount: expectedRowCount,
        expectedRowCount,
        expectedItemCount,
        providerCalls,
        health,
        reasons,
        estimatedCacheCost: health === 'Good' ? 'low' : health === 'Moderate' ? 'medium' : 'high',
        estimatedFrontendCost: expectedRowCount > 28 ? 'high' : expectedRowCount > 16 ? 'medium' : 'low'
    };
}

function localValidation(settings: PtvRowBuilderSettings, seerrConfigured = false) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const ids = new Set<string>();

    settings.rules.forEach(rule => {
        if (!rule.id.trim()) {
            errors.push('Every rule needs an id.');
        } else if (ids.has(rule.id.toLowerCase())) {
            errors.push(`Duplicate rule id '${rule.id}'.`);
        }

        ids.add(rule.id.toLowerCase());

        if (!rule.name.trim()) {
            errors.push(`Rule '${rule.id}' needs a row name.`);
        }

        if (['collection', 'genre', 'library', 'studio', 'tag', 'providerId', 'person', 'productionYear', 'officialRating', 'communityRating', 'premiereDate', 'image'].includes(rule.sourceType) && !rule.sourceValue.trim()) {
            errors.push(`Rule '${rule.name}' needs a source value.`);
        }

        if (rule.sourceType === 'requested' && !seerrConfigured) {
            warnings.push(`Rule '${rule.name}' requires Jellyseerr/Jellyseer to be configured.`);
        }
    });

    const estimate = estimatePerformance(settings);

    if (estimate.health === 'Heavy' || estimate.health === 'Risky') {
        warnings.push(`Estimated performance is ${estimate.health}: ${estimate.reasons.join(', ') || 'large row plan'}.`);
    }

    return { errors, warnings };
}

function createRowBuilderTimeoutError(message: string) {
    return Object.assign(new Error(message), {
        kind: 'timeout'
    });
}

function withRowBuilderTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeoutId = 0;
    const timeout = new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
            reject(createRowBuilderTimeoutError(message));
        }, timeoutMs);
    });

    return Promise.race([promise, timeout])
        .finally(() => window.clearTimeout(timeoutId));
}

function getFirstRowBuilderSettings(...promises: Array<Promise<PtvRowBuilderSettings | null>>) {
    return new Promise<PtvRowBuilderSettings | null>((resolve, reject) => {
        let settledCount = 0;
        let lastError: unknown = null;

        promises.forEach(promise => {
            promise
                .then(rows => {
                    if (rows) {
                        resolve(rows);
                        return;
                    }

                    settledCount += 1;
                    if (settledCount === promises.length) {
                        resolve(null);
                    }
                })
                .catch(error => {
                    lastError = error;
                    settledCount += 1;
                    if (settledCount === promises.length) {
                        reject(lastError);
                    }
                });
        });
    });
}

function createRowsAbortController() {
    // eslint-disable-next-line compat/compat
    return typeof AbortController === 'function' ? new AbortController() : null;
}

function getSourceValueHelp(sourceType: RowSourceType) {
    switch (sourceType) {
        case 'providerId':
            return 'Use Tmdb:123, Imdb:tt1234567, Tvdb:123, or a raw provider id.';
        case 'productionYear':
            return 'Use a year like 2024 or a range like 1990-1999.';
        case 'communityRating':
            return 'Use a rating like 7.5 or a comparison like >=7.';
        case 'premiereDate':
            return 'Use a year, yyyy-mm, or yyyy-mm-dd.';
        case 'image':
            return 'Use any, primary, thumb, backdrop, or logo.';
        case 'person':
            return 'Matches Jellyfin people names, roles, and type:name values.';
        case 'tag':
            return 'Matches Jellyfin item tags populated by metadata providers or admins.';
        case 'becauseYouWatched':
            return 'Native Home fills this per user from watched Jellyfin content.';
        default:
            return 'Matches normalized Jellyfin item metadata.';
    }
}

function formatDiagnosticSummary(diagnostic: PtvRowGenerationDiagnostic) {
    const parts = [
        `${diagnostic.ruleId || diagnostic.ruleName}: ${diagnostic.mediaType}/${diagnostic.sourceType}/${diagnostic.generationMode}`,
        `row ${diagnostic.rowId || diagnostic.rowTitle || 'n/a'}`,
        `planned ${diagnostic.plannedRowCount ?? 'n/a'} generated ${diagnostic.generatedSourceCount ?? 'n/a'} dropped ${diagnostic.droppedSourceCount ?? 0}`,
        `${diagnostic.searchTerm || diagnostic.sourceValue || 'source'}: ${diagnostic.itemCount ?? 0} item(s)`,
        `candidates ${diagnostic.candidateCount ?? 'n/a'} -> matches ${diagnostic.matchedCount ?? 'n/a'}`,
        `fallback ${diagnostic.fallbackUsed ? 'yes' : 'no'}`,
        `${diagnostic.filteredDuplicateCount ?? 0} duplicate(s)`,
        `${diagnostic.generationTimeMs ?? 0} ms`
    ];

    if (diagnostic.studioFilter) parts.push(`studio: ${diagnostic.studioFilter}`);
    if (diagnostic.metadataSourceFieldsUsed?.length) parts.push(`fields: ${diagnostic.metadataSourceFieldsUsed.join(' | ')}`);
    if (diagnostic.queryUsed) parts.push(diagnostic.queryUsed);
    if (diagnostic.first10MatchedItemNames?.length) {
        parts.push(`matches: ${diagnostic.first10MatchedItemNames.slice(0, 5).join(' | ')}`);
    } else if (diagnostic.first10ItemNames?.length) {
        parts.push(`items: ${diagnostic.first10ItemNames.slice(0, 5).join(' | ')}`);
    }
    if (diagnostic.providerError) parts.push(`provider: ${diagnostic.providerError}`);
    if (diagnostic.dropReason) parts.push(`drop: ${diagnostic.dropReason}`);
    if (diagnostic.emptyResultReason) parts.push(diagnostic.emptyResultReason);

    return parts.join(', ');
}

function getRecommendationReasonSummary(item: PtvRecommendationScore) {
    return item.reasons
        .slice(0, 4)
        .map(reason => reason.label)
        .join(' / ');
}

function getRowBuilderConfigHash(settings: PtvRowBuilderSettings) {
    return getPtvFeaturedRowConfigHash({
        ...settings,
        rules: settings.rules.map(rule => ({
            ...rule,
            includeSubgenres: false,
            subgenreRowCount: 0
        }))
    });
}

function getPersistedRecommendationRowDiagnostics(rows: PtvPersistedRecommendationRow[]) {
    return rows.map(row => ({
        candidateCount: row.diagnostics?.candidateCount ?? row.items.length,
        dedupeRemovals: row.diagnostics?.dedupeRemovals ?? 0,
        discoveryFallbackCount: row.diagnostics?.discoveryFallbackCount ?? 0,
        finalRenderedCount: row.diagnostics?.finalRenderedCount ?? row.items.length,
        hydrationRemovals: row.diagnostics?.hydrationRemovals ?? 0,
        itemCount: row.items.length,
        primaryCandidateCount: row.diagnostics?.primaryCandidateCount ?? row.diagnostics?.candidateCount ?? row.items.length,
        rowId: row.id,
        secondaryFallbackCount: row.diagnostics?.secondaryFallbackCount ?? 0,
        title: row.title
    }));
}

function finalizeRecommendationSettings(settings: PtvRecommendationRowSettings): PtvRecommendationRowSettings {
    const rows = (settings.rows || [])
        .reduce<PtvPersistedRecommendationRow[]>((result, row) => {
            const validatedRow = getValidatedPtvPersistedRecommendationRow(row);

            if (!validatedRow) return result;

            const wasAccepted = row.accepted === true;

            result.push({
                ...validatedRow,
                accepted: true,
                diagnostics: {
                    candidateCount: validatedRow.diagnostics?.candidateCount ?? row.items.length,
                    dedupeRemovals: (validatedRow.diagnostics?.dedupeRemovals ?? 0) + Math.max(0, row.items.length - validatedRow.items.length),
                    discoveryFallbackCount: validatedRow.diagnostics?.discoveryFallbackCount ?? 0,
                    finalRenderedCount: validatedRow.items.length,
                    hydrationRemovals: validatedRow.diagnostics?.hydrationRemovals ?? 0,
                    primaryCandidateCount: validatedRow.diagnostics?.primaryCandidateCount ?? validatedRow.diagnostics?.candidateCount ?? row.items.length,
                    secondaryFallbackCount: validatedRow.diagnostics?.secondaryFallbackCount ?? 0
                },
                draft: false,
                enabled: wasAccepted ? row.enabled === true : true,
                recommendationConfigHash: undefined,
                sourceTimings: undefined,
                sourceTimingsJson: undefined
            });

            return result;
        }, []);
    const baseSettings: PtvRecommendationRowSettings = {
        ...settings,
        enabled: settings.enabled !== false,
        recommendationConfigHash: undefined,
        rowDiagnostics: getPersistedRecommendationRowDiagnostics(rows),
        rows,
        schemaVersion: settings.schemaVersion || 1
    };
    baseSettings.sourceTimings = undefined;
    baseSettings.sourceTimingsJson = undefined;
    const recommendationConfigHash = getPtvRecommendationSettingsHash(baseSettings);

    return {
        ...baseSettings,
        recommendationConfigHash,
        rowDiagnostics: getPersistedRecommendationRowDiagnostics(baseSettings.rows || []),
        rows: (baseSettings.rows || []).map(row => ({
            ...row,
            recommendationConfigHash
        }))
    };
}

function buildPersistedRecommendationSettings(
    data: PtvRecommendationDashboardData,
    rowConfigHash: string
): PtvRecommendationRowSettings {
    const generatedAt = data.generatedAt || Date.now();
    const sourceCounts = Object.entries(data.debug.sourceCounts || {}).reduce<Array<{ count: number; source: string }>>((counts, [key, count]) => {
        if (typeof count === 'number') {
            counts.push({
                count,
                source: key
            });
        }

        return counts;
    }, []);
    const rows: PtvPersistedRecommendationRow[] = data.rows
        .map(row => {
            const sourceItemCount = row.items.length;
            const items = row.items
                .map(item => toPtvPersistedRecommendationItem(item.item, item.mediaType))
                .filter((item): item is NonNullable<ReturnType<typeof toPtvPersistedRecommendationItem>> => Boolean(item));
            const hydrationRemovals = Math.max(0, sourceItemCount - items.length);
            const diagnostics = {
                candidateCount: row.diagnostics?.candidateCount ?? sourceItemCount,
                dedupeRemovals: row.diagnostics?.dedupeRemovals ?? 0,
                discoveryFallbackCount: row.diagnostics?.discoveryFallbackCount ?? 0,
                finalRenderedCount: items.length,
                hydrationRemovals: (row.diagnostics?.hydrationRemovals ?? 0) + hydrationRemovals,
                primaryCandidateCount: row.diagnostics?.primaryCandidateCount ?? row.diagnostics?.candidateCount ?? sourceItemCount,
                secondaryFallbackCount: row.diagnostics?.secondaryFallbackCount ?? 0
            };

            return {
                accepted: items.length >= PTV_MIN_RECOMMENDATION_ROW_ITEMS,
                diagnostics,
                draft: items.length < PTV_MIN_RECOMMENDATION_ROW_ITEMS,
                enabled: items.length >= PTV_MIN_RECOMMENDATION_ROW_ITEMS,
                explanation: row.explanation,
                generatedAt,
                id: row.id,
                items,
                mediaType: row.mediaType || 'mixed',
                rowConfigHash,
                sourceCounts,
                title: row.title
            };
        })
        .filter(row => row.items.length >= PTV_MIN_RECOMMENDATION_ROW_ITEMS);

    return finalizeRecommendationSettings({
        enabled: true,
        generatedAt,
        rowConfigHash,
        rows,
        schemaVersion: 1,
        sourceCounts
    });
}

function getRecommendationSettingsPayloadSize(settings: PtvRecommendationRowSettings | null) {
    try {
        return settings ? JSON.stringify(settings).length : 0;
    } catch {
        return 0;
    }
}

function getSerializedPayloadSize(value: unknown) {
    try {
        return JSON.stringify(value).length;
    } catch {
        return 0;
    }
}

function getRecommendationRowItemCounts(settings: PtvRecommendationRowSettings | null) {
    return (settings?.rows || []).map(row => ({
        itemCount: row.items.length,
        rowId: row.id
    }));
}

function getRecommendationRowDiagnosticsSummary(settings: PtvRecommendationRowSettings | null) {
    return (settings?.rows || []).map(row => ({
        candidateCount: row.diagnostics?.candidateCount ?? null,
        dedupeRemovals: row.diagnostics?.dedupeRemovals ?? null,
        finalRenderedCount: row.diagnostics?.finalRenderedCount ?? row.items.length,
        hydrationRemovals: row.diagnostics?.hydrationRemovals ?? null,
        itemCount: row.items.length,
        rowId: row.id,
        title: row.title
    }));
}

function getRecommendationSavePayloadSummary(
    settings: PtvRecommendationRowSettings,
    requestBody: Record<string, unknown>,
    reason: string
) {
    const perRowItemCounts = getRecommendationRowItemCounts(settings);

    return {
        endpointUrl: getPtvPluginApiResolvedUrl(PTV_PLUGIN_API.endpoints.settings),
        itemCount: perRowItemCounts.reduce((total, row) => total + row.itemCount, 0),
        payloadSize: getRecommendationSettingsPayloadSize(settings),
        payloadTopLevelKeys: Object.keys(requestBody),
        perRowDiagnostics: getRecommendationRowDiagnosticsSummary(settings),
        perRowItemCounts,
        reason,
        recommendationTopLevelKeys: Object.keys(settings),
        requestPayloadSize: getSerializedPayloadSize(requestBody),
        rowCount: settings.rows?.length || 0,
        rowIds: (settings.rows || []).map(row => row.id)
    };
}

function getRecommendationSettingsMigrationState(settings: PtvRecommendationRowSettings | null) {
    const finalizedSettings = settings ? finalizeRecommendationSettings(settings) : null;
    const needsMigration = Boolean(
        finalizedSettings
        && JSON.stringify(finalizedSettings) !== JSON.stringify(settings)
    );

    return {
        finalizedSettings,
        needsMigration
    };
}

function getRecommendationRowsLoadedMessage(settings: PtvRecommendationRowSettings | null, migrated: boolean) {
    const rowCount = settings?.rows?.length || 0;

    if (migrated) {
        return {
            severity: rowCount ? 'success' as const : 'info' as const,
            text: rowCount ?
                `Loaded and normalized ${rowCount} recommendation row(s). Save to persist cleanup changes.` :
                'No renderable recommendation rows were found after normalization.'
        };
    }

    return {
        severity: rowCount ? 'success' as const : 'info' as const,
        text: rowCount ?
            `Loaded ${rowCount} saved recommendation row(s).` :
            'No saved recommendation rows were found.'
    };
}

function getLazyPtvRecommendationDashboardData(options: { forceRefresh?: boolean; includeHomeScans?: boolean; signal?: AbortSignal } = {}) {
    return import('../recommendations/engine/recommendationEngine')
        .then(module => module.getPtvRecommendationDashboardData(options));
}

function makeNewRule(index: number): PtvRowBuilderRule {
    return makeRule(`genre-row-${index + 1}`, 'New Genre Row', 'movies', 'genre', 'Action', 'random', 16, 1, index * 10);
}

function makeRuleForGroup(index: number, groupTitle: string): PtvRowBuilderRule {
    return {
        ...makeNewRule(index),
        id: slugify(`${groupTitle}-row-${index + 1}`),
        groupTitle,
        sortPriority: index * 10
    };
}

function getRowGroups(settings: PtvRowBuilderSettings): PtvRowGroupSummary[] {
    const groups = new Map<string, PtvRowGroupSummary>();

    settings.rules.forEach(rule => {
        const title = rule.groupTitle.trim();

        if (!title) return;

        const group = groups.get(title) || {
            enabledCount: 0,
            ruleCount: 0,
            title
        };

        group.ruleCount += 1;
        if (rule.enabled) group.enabledCount += 1;
        groups.set(title, group);
    });

    return [...groups.values()].sort((left, right) => left.title.localeCompare(right.title));
}

function getGroupOptions(groups: PtvRowGroupSummary[], currentGroupTitle: string) {
    const options = groups.map(group => group.title);
    const current = currentGroupTitle.trim();

    if (current && !options.some(option => option.toLowerCase() === current.toLowerCase())) {
        options.push(current);
    }

    return options.sort((left, right) => left.localeCompare(right));
}

function getGroupSelectValue(currentGroupTitle: string, groups: PtvRowGroupSummary[]) {
    const current = currentGroupTitle.trim();

    if (!current) return '';

    return getGroupOptions(groups, current).find(option => option.toLowerCase() === current.toLowerCase()) || current;
}

function getNextSortPriority(settings: PtvRowBuilderSettings) {
    return settings.rules.reduce((max, rule) => Math.max(max, Number(rule.sortPriority) || 0), -10) + 10;
}

function withUniqueRuleId(rule: PtvRowBuilderRule, existingIds: Set<string>) {
    const baseId = slugify(rule.id || rule.name);
    let id = baseId;
    let suffix = 2;

    while (existingIds.has(id.toLowerCase())) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
    }

    existingIds.add(id.toLowerCase());

    return {
        ...rule,
        id
    };
}

function makeStudiosTemplate(startPriority: number): PtvRowBuilderRule[] {
    return [
        makeRule('studios-disney', 'Disney', 'mixed', 'studio', 'Disney', 'popular', 16, 1, startPriority),
        makeRule('studios-lucasfilm', 'Lucasfilm', 'mixed', 'studio', 'Lucasfilm', 'popular', 16, 1, startPriority + 10),
        makeRule('studios-pixar', 'Pixar', 'mixed', 'studio', 'Pixar', 'popular', 16, 1, startPriority + 20)
    ].map(rule => ({
        ...rule,
        groupTitle: 'Studios',
        presentation: 'standard',
        tier: 2
    }));
}

function makeFeaturedTemplate(startPriority: number): PtvRowBuilderRule[] {
    return [
        {
            ...makeRule('featured-seasonal', 'Seasons / Holidays', 'mixed', 'seasonal', 'auto', 'popular', 16, 1, startPriority),
            seasonal: { mode: 'auto' }
        },
        makeRule('featured-latest-movies', 'Latest Movies', 'movies', 'latest', 'movies', 'latest', 16, 1, startPriority + 10),
        makeRule('featured-latest-all', 'Latest All', 'mixed', 'latest', 'all', 'latest', 16, 1, startPriority + 20),
        makeRule('featured-because-you-watched', 'Because You Watched', 'mixed', 'becauseYouWatched', 'watched', 'popular', 16, 1, startPriority + 30)
    ].map(rule => ({
        ...rule,
        groupTitle: 'Featured',
        presentation: 'featured',
        tier: 1
    }));
}

type RecommendationRowsPanelProps = {
    canShowDiagnostics: boolean;
    data: PtvRecommendationDashboardData | null;
    error: string;
    hasConflict: boolean;
    isLoading: boolean;
    onAcceptAll: () => void;
    onDeleteRow: (rowId: string) => void;
    onGenerate: (forceRefresh?: boolean, manual?: boolean) => void;
    onRefreshSaved: () => void;
    onToggleRow: (rowId: string, enabled: boolean) => void;
    persistedRows: PtvPersistedRecommendationRow[];
};

function getRecommendationPanelRows(
    data: PtvRecommendationDashboardData | null,
    persistedRows: PtvPersistedRecommendationRow[]
): PtvPersistedRecommendationRow[] {
    if (persistedRows.length) return persistedRows;

    return (data?.rows || [])
        .reduce<PtvPersistedRecommendationRow[]>((result, row) => {
            const items = row.items
                .map(item => toPtvPersistedRecommendationItem(item.item, item.mediaType))
                .filter((item): item is NonNullable<ReturnType<typeof toPtvPersistedRecommendationItem>> => Boolean(item));

            if (items.length < PTV_MIN_RECOMMENDATION_ROW_ITEMS) return result;

            result.push({
                accepted: items.length >= PTV_MIN_RECOMMENDATION_ROW_ITEMS,
                diagnostics: {
                    candidateCount: row.diagnostics?.candidateCount ?? row.items.length,
                    dedupeRemovals: row.diagnostics?.dedupeRemovals ?? 0,
                    discoveryFallbackCount: row.diagnostics?.discoveryFallbackCount ?? 0,
                    finalRenderedCount: items.length,
                    hydrationRemovals: (row.diagnostics?.hydrationRemovals ?? 0) + Math.max(0, row.items.length - items.length),
                    primaryCandidateCount: row.diagnostics?.primaryCandidateCount ?? row.diagnostics?.candidateCount ?? row.items.length,
                    secondaryFallbackCount: row.diagnostics?.secondaryFallbackCount ?? 0
                },
                draft: false,
                enabled: true,
                explanation: row.explanation,
                generatedAt: data?.generatedAt || null,
                id: row.id,
                items,
                mediaType: row.mediaType || 'mixed',
                title: row.title
            });

            return result;
        }, []);
}

function RecommendationSummaryChips({
    data,
    enabledCount,
    itemCount,
    rowCount
}: Readonly<{
    data: PtvRecommendationDashboardData | null;
    enabledCount: number;
    itemCount: number;
    rowCount: number;
}>) {
    if (!rowCount) return null;

    return (
        <>
            <Chip label={`${rowCount} rows`} />
            <Chip label={`${enabledCount} enabled`} color={enabledCount ? 'success' : 'default'} />
            <Chip label={`${itemCount} items`} />
            {data ? <Chip label={`${data.metrics.crossMediaMatches} cross-media`} /> : null}
            {data ? <Chip label={`${data.metrics.sourceCount} taste signals`} /> : null}
            {data?.metrics.failedSourceCount ? <Chip color='warning' label={`${data.metrics.failedSourceCount} source issue(s)`} /> : null}
        </>
    );
}

type RuleUpdateHandler = (index: number, patch: Partial<PtvRowBuilderRule>) => void;

function isRandomGenreGeneratedRule(rule: PtvRowBuilderRule) {
    return rule.sourceType === 'genre' && rule.generationMode === 'random';
}

function RowSourceValueControls({
    index,
    rule,
    updateRule
}: Readonly<{
    index: number;
    rule: PtvRowBuilderRule;
    updateRule: RuleUpdateHandler;
}>) {
    const genreOptions = getGenres(rule.mediaType);
    const genreValue = rule.sourceType === 'genre' && isBuiltInGenre(rule) ? rule.sourceValue : CUSTOM_GENRE;
    const showCustomGenre = rule.sourceType === 'genre' && genreValue === CUSTOM_GENRE;

    return (
        <Box className='ptv-row-rule-cell'>
            {rule.sourceType === 'genre' && (
                <Stack direction='row' spacing={1}>
                    <TextField fullWidth select label='Genre' value={genreValue} onChange={event => updateRule(index, { sourceValue: event.target.value === CUSTOM_GENRE ? '' : event.target.value })}>
                        {genreOptions.map(genre => <MenuItem key={genre} value={genre}>{genre}</MenuItem>)}
                        <MenuItem value={CUSTOM_GENRE}>Custom...</MenuItem>
                    </TextField>
                    {showCustomGenre && <TextField fullWidth label='Custom Genre' value={rule.sourceValue} onChange={event => updateRule(index, { sourceValue: event.target.value })} />}
                </Stack>
            )}
            {rule.sourceType === 'studio' && (
                <TextField fullWidth label='Studio' value={rule.sourceValue} onChange={event => updateRule(index, { sourceValue: event.target.value })} />
            )}
            {['collection', 'library', 'tag', 'providerId', 'person', 'productionYear', 'officialRating', 'communityRating', 'premiereDate', 'image'].includes(rule.sourceType) && (
                <TextField
                    fullWidth
                    label='Source Value'
                    value={rule.sourceValue}
                    helperText={getSourceValueHelp(rule.sourceType)}
                    onChange={event => updateRule(index, { sourceValue: event.target.value })}
                />
            )}
            {rule.sourceType === 'seasonal' && (
                <TextField fullWidth select label='Seasonal Mode' value={rule.seasonal?.mode || 'auto'} onChange={event => updateRule(index, { sourceValue: event.target.value, seasonal: { ...(rule.seasonal || { mode: 'auto' }), mode: event.target.value } })}>
                    {SEASONAL_MODES.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                </TextField>
            )}
            {['becauseYouWatched', 'continueWatching', 'latest', 'requested'].includes(rule.sourceType) && (
                <TextField fullWidth disabled label='Source Value' value={rule.sourceValue} />
            )}
        </Box>
    );
}

function RowSubgenreControls({
    index,
    rule,
    updateRule
}: Readonly<{
    index: number;
    rule: PtvRowBuilderRule;
    updateRule: RuleUpdateHandler;
}>) {
    if (!isRandomGenreGeneratedRule(rule)) return null;

    return (
        <>
            <Box className='ptv-row-rule-cell'>
                <FormControlLabel
                    control={(
                        <Switch
                            checked={rule.includeSubgenres}
                            onChange={event => updateRule(index, {
                                includeSubgenres: event.target.checked,
                                providerHints: event.target.checked ? withoutSubgenresDisabledHint(rule.providerHints) : withSubgenresDisabledHint(rule.providerHints),
                                rowCount: event.target.checked ? Math.max(2, rule.rowCount || 2) : rule.rowCount,
                                subgenreRowCount: event.target.checked ? Math.max(1, rule.subgenreRowCount || Math.max(1, (rule.rowCount || 2) - 1)) : 0
                            })}
                        />
                    )}
                    label='Subgenres'
                />
            </Box>
            <Box className='ptv-row-rule-cell ptv-row-rule-cell-small'>
                <TextField
                    disabled={!rule.includeSubgenres}
                    fullWidth
                    label='Sub Rows'
                    type='number'
                    value={rule.subgenreRowCount}
                    onChange={event => updateRule(index, {
                        includeSubgenres: Number(event.target.value) > 0,
                        providerHints: Number(event.target.value) > 0 ? withoutSubgenresDisabledHint(rule.providerHints) : withSubgenresDisabledHint(rule.providerHints),
                        rowCount: Math.max(rule.rowCount || 1, Number(event.target.value) + 1),
                        subgenreRowCount: Number(event.target.value)
                    })}
                />
            </Box>
        </>
    );
}

function RecommendationDiagnosticsPanel({ data }: Readonly<{ data: PtvRecommendationDashboardData }>) {
    return (
        <Grid size={{ xs: 12, lg: 5 }}>
            <Stack spacing={1.25}>
                <Typography variant='h3'>Recommendation Diagnostics</Typography>
                {(data.metrics.topRecommendationSources || []).slice(0, 8).map(source => (
                    <Typography key={source.label} variant='body2'>
                        {source.label}: {source.score}
                    </Typography>
                ))}
                <Divider />
                <Typography variant='h3'>Source Timing</Typography>
                {(data.metrics.sourceTimings || []).map(source => (
                    <Typography key={source.source} variant='body2'>
                        {source.source}: {source.status}, {source.itemCount} item(s), {source.durationMs} ms{source.slow ? ' (slow)' : ''}{source.error ? ` - ${source.error}` : ''}
                    </Typography>
                ))}
                <Divider />
                {data.candidates.slice(0, 8).map(item => (
                    <Typography key={`${item.item.Id || getRecommendationTitle(item.item)}-${item.score}`} variant='body2'>
                        {getRecommendationTitle(item.item)} - {getRecommendationReasonSummary(item) || 'discovery'} - {item.score}
                    </Typography>
                ))}
            </Stack>
        </Grid>
    );
}

function RecommendationRowsPanel({
    canShowDiagnostics,
    data,
    error,
    hasConflict,
    isLoading,
    onAcceptAll,
    onDeleteRow,
    onGenerate,
    onRefreshSaved,
    onToggleRow,
    persistedRows
}: Readonly<RecommendationRowsPanelProps>) {
    const rows = getRecommendationPanelRows(data, persistedRows);
    const itemCount = rows.reduce((total, row) => total + row.items.length, 0);
    const enabledRows = rows.filter(row => getValidatedPtvPersistedRecommendationRow(row) && row.enabled === true && row.accepted === true && row.draft !== true);

    return (
        <Card className='ptv-dashboard-card ptv-control-card'>
            <CardContent>
                <Stack spacing={1.5}>
                    <Box>
                        <Typography variant='h2'>Recommendation Rows</Typography>
                        <Typography variant='body2' color='text.secondary'>
                            Recommendation rows use the same Row Builder surface now. Generate them here, then use the preview and diagnostics beside your configured rules.
                        </Typography>
                    </Box>
                    <Stack direction='row' spacing={1} alignItems='center' flexWrap='wrap'>
                        <Button className='ptv-button' variant='contained' disabled={isLoading || hasConflict} onClick={() => onGenerate(false, true)}>
                            {isLoading ? 'Generating...' : 'Generate Recommendation Rows'}
                        </Button>
                        <Button variant='outlined' disabled={isLoading} onClick={onRefreshSaved}>
                            Refresh Recommendations
                        </Button>
                        <Button variant='outlined' disabled={isLoading || hasConflict || !rows.length} onClick={onAcceptAll}>
                            Accept Recommendations
                        </Button>
                        <RecommendationSummaryChips data={data} enabledCount={enabledRows.length} itemCount={itemCount} rowCount={rows.length} />
                    </Stack>
                    {error ? <Alert severity='error'>{error}</Alert> : null}
                    {data?.metrics.sourceFailures.length ? (
                        <Alert severity='warning'>
                            Partial recommendations generated. Failed sources: {data.metrics.sourceFailures.map(failure => `${failure.source}: ${failure.error}`).join(' | ')}
                        </Alert>
                    ) : null}
                    {!rows.length && !isLoading ? (
                        <Typography color='text.secondary'>No recommendation rows generated yet.</Typography>
                    ) : null}
                    {rows.length ? (
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 12, lg: 7 }}>
                                <Stack spacing={1.25}>
                                    <Typography variant='h3'>Generated Recommendation Rows</Typography>
                                    {rows.map(row => {
                                        const validatedRow = getValidatedPtvPersistedRecommendationRow(row);
                                        const isEnabled = row.enabled === true && row.accepted === true && row.draft !== true;
                                        const statusLabel = isEnabled ? 'Enabled' : row.accepted === true ? 'Disabled' : 'Draft';
                                        const diagnostics = row.diagnostics;

                                        return (
                                            <Box key={row.id} className='ptv-dashboard-list-row'>
                                                <Stack direction='row' spacing={1} alignItems='center' justifyContent='space-between' flexWrap='wrap'>
                                                    <Stack direction='row' spacing={1} alignItems='center' flexWrap='wrap'>
                                                        <Typography variant='h3'>{row.title}</Typography>
                                                        <Chip size='small' label={`${validatedRow?.items.length || 0}/${row.items.length} items`} color={validatedRow ? 'success' : 'warning'} />
                                                        <Chip size='small' label={`candidates ${diagnostics?.candidateCount ?? 'n/a'}`} />
                                                        <Chip size='small' label={`dedupe -${diagnostics?.dedupeRemovals ?? 0}`} />
                                                        <Chip size='small' label={`hydration -${diagnostics?.hydrationRemovals ?? 0}`} />
                                                        <Chip size='small' label={`final ${diagnostics?.finalRenderedCount ?? validatedRow?.items.length ?? 0}`} color={(diagnostics?.finalRenderedCount ?? validatedRow?.items.length ?? 0) >= PTV_MIN_RECOMMENDATION_ROW_ITEMS ? 'success' : 'warning'} />
                                                        <Chip size='small' label={row.mediaType || 'mixed'} />
                                                        <Chip size='small' label={statusLabel} color={isEnabled ? 'success' : row.accepted ? 'default' : 'warning'} />
                                                    </Stack>
                                                    <Stack direction='row' spacing={1} alignItems='center' flexWrap='wrap'>
                                                        <FormControlLabel
                                                            control={<Switch checked={isEnabled} disabled={isLoading || hasConflict || !validatedRow} onChange={event => onToggleRow(row.id, event.target.checked)} />}
                                                            label={isEnabled ? 'Enabled' : 'Disabled'}
                                                        />
                                                        <Button size='small' variant='outlined' disabled={isLoading || hasConflict || !validatedRow} onClick={() => onToggleRow(row.id, true)}>Accept</Button>
                                                        <Button size='small' color='error' variant='outlined' disabled={isLoading || hasConflict} onClick={() => onDeleteRow(row.id)}>Delete</Button>
                                                    </Stack>
                                                </Stack>
                                                <Typography variant='body2' color='text.secondary'>{row.explanation || 'Generated from your recommendation profile.'}</Typography>
                                                {!validatedRow ? (
                                                    <Typography variant='body2' color='warning.main'>
                                                        Hidden from Home until it has at least {PTV_MIN_RECOMMENDATION_ROW_ITEMS} unique items after dedupe.
                                                    </Typography>
                                                ) : null}
                                                {row.items.slice(0, 4).map(item => (
                                                    <Typography key={`${row.id}-${item.Id || getRecommendationTitle(item)}`} variant='body2'>
                                                        {getRecommendationTitle(item)}
                                                    </Typography>
                                                ))}
                                            </Box>
                                        );
                                    })}
                                </Stack>
                            </Grid>
                            {canShowDiagnostics && data ? <RecommendationDiagnosticsPanel data={data} /> : null}
                        </Grid>
                    ) : null}
                </Stack>
            </CardContent>
        </Card>
    );
}

// This page coordinates several independent editors and previews; keeping the
// orchestration together avoids duplicated requests and competing save state.
// eslint-disable-next-line sonarjs/cognitive-complexity
const PiggieTvRowsPage = () => {
    const hydratedRef = useRef(false);
    const loadRequestRef = useRef<Promise<void> | null>(null);
    const previewAbortRef = useRef<AbortController | null>(null);
    const recommendationAbortRef = useRef<AbortController | null>(null);
    const recommendationRequestRef = useRef<Promise<void> | null>(null);
    const recommendationRequestTokenRef = useRef<object | null>(null);
    const recommendationSaveRequestRef = useRef<Promise<RecommendationSettingsSaveResult> | null>(null);
    const refreshRequestRef = useRef<Promise<void> | null>(null);
    const saveRequestRef = useRef<Promise<void> | null>(null);
    const draftRevisionRef = useRef(0);
    const importInputRef = useRef<HTMLInputElement | null>(null);
    const [form, setForm] = useState<PtvRowBuilderSettings>(() => cloneSettings(DEFAULT_SETTINGS));
    const [groupDraft, setGroupDraft] = useState('');
    const [saved, setSaved] = useState<PtvRowBuilderSettings>(() => cloneSettings(DEFAULT_SETTINGS));
    const [preview, setPreview] = useState<PtvRowPreviewResponse | null>(null);
    const [recommendationData, setRecommendationData] = useState<PtvRecommendationDashboardData | null>(null);
    const [recommendationSettings, setRecommendationSettings] = useState<PtvRecommendationRowSettings | null>(null);
    const [confirmedRecommendationSettings, setConfirmedRecommendationSettings] = useState<PtvRecommendationSettingsBaseline>(undefined);
    const [recommendationConflict, setRecommendationConflict] = useState(false);
    const [recommendationError, setRecommendationError] = useState('');
    const [recommendationLoading, setRecommendationLoading] = useState(false);
    const [recommendationSaving, setRecommendationSaving] = useState(false);
    const [seerrConfigured, setSeerrConfigured] = useState(false);
    const [statusMessage, setStatusMessage] = useState<PtvStatusMessage | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadSucceeded, setLoadSucceeded] = useState(false);
    const [rowConflict, setRowConflict] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);

    const canShowDiagnostics = shouldCollectDiagnostics();
    const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);
    const recommendationDirty = useMemo(() => (
        recommendationSettings !== null || confirmedRecommendationSettings !== undefined
    ) && !recommendationSettingsMatch(recommendationSettings, confirmedRecommendationSettings), [
        confirmedRecommendationSettings,
        recommendationSettings
    ]);
    const pageDirty = dirty || recommendationDirty;
    useAdminUnsavedChanges(pageDirty, 'Leave Home Rows without saving your changes?');
    const rowGroups = useMemo(() => getRowGroups(form), [form]);
    const persistedRecommendationRows = useMemo(() => recommendationSettings?.rows || [], [recommendationSettings]);
    const estimate = useMemo(() => estimatePerformance(form), [form]);
    const enabledRecommendationRows = useMemo(
        () => getEnabledPtvPersistedRecommendationRows(recommendationSettings),
        [recommendationSettings]
    );
    const configuredRowsOnHomeEnabled = form.enabled;
    const estimatedConfiguredHomeRows = configuredRowsOnHomeEnabled ? estimate.configuredRowCount : 0;
    const totalEstimatedHomeRows = estimatedConfiguredHomeRows + enabledRecommendationRows.length;
    const validation = useMemo(() => localValidation(form, seerrConfigured), [form, seerrConfigured]);
    const configuredPreviewRows = useMemo(() => (preview?.rows || [])
        .filter(row => row.itemCount > 0)
        .map(row => ({
            id: row.id,
            itemCount: row.itemCount,
            mediaType: row.mediaType || 'mixed',
            rowType: 'configured-rule',
            sourceId: row.ruleId || row.id,
            sourceType: row.sourceType || 'source',
            title: row.title
        })), [preview?.rows]);
    const configuredHomePreviewRows = useMemo(
        () => configuredRowsOnHomeEnabled ? configuredPreviewRows : [],
        [configuredPreviewRows, configuredRowsOnHomeEnabled]
    );
    const recommendationPreviewRows = useMemo(() => enabledRecommendationRows.map(row => ({
        id: `recommendation-${row.id}`,
        itemCount: row.items.length,
        mediaType: row.mediaType || 'mixed',
        rowType: 'generated-recommendation',
        sourceId: row.id,
        sourceType: 'recommendation',
        title: row.title
    })), [enabledRecommendationRows]);
    const homeOutputPreviewRows = useMemo(
        () => [...configuredHomePreviewRows, ...recommendationPreviewRows],
        [configuredHomePreviewRows, recommendationPreviewRows]
    );

    const savePersistedRecommendationSettings = useCallback(async (
        settings: PtvRecommendationRowSettings,
        confirmedBaseline: PtvRecommendationSettingsBaseline,
        reason: string
    ) => {
        const api = getCurrentPtvPluginApiClient();
        const nextSettings = finalizeRecommendationSettings(settings);
        const requestBody = { recommendations: nextSettings };
        const saveSummary = getRecommendationSavePayloadSummary(nextSettings, requestBody, reason);

        if (!api?.getSettings || !api.saveSettings) throw new Error('PiggieTV plugin settings API is unavailable.');
        if (recommendationSaveRequestRef.current) throw new PtvRecommendationMutationInProgressError();

        recordPtvEvent('recommendation', 'recommendation-save-start', {
            ...saveSummary
        });

        setRecommendationSaving(true);

        try {
            return await runPtvRecommendationMutationSingleFlight(recommendationSaveRequestRef, async () => {
                let response: unknown;
                const refreshStartedAt = Date.now();

                try {
                    response = await savePtvRecommendationMutationSafely({
                        confirmedBaseline,
                        nextSettings,
                        normalizeAuthoritative: payload => getRecommendationSettingsMigrationState(
                            normalizePtvRecommendationRowSettings(payload)
                        ).finalizedSettings,
                        readAuthoritative: () => api.getSettings<unknown>({ bypassCache: true }),
                        write: authoritativeSettings => api.saveSettings<unknown, { recommendations: PtvRecommendationRowSettings }>({
                            recommendations: authoritativeSettings
                        })
                    });
                } catch (error) {
                    const normalizedError = normalizePtvApiError(error);
                    const diagnostics = getPtvPluginApiDiagnostics();

                    recordPtvEvent('recommendation', 'recommendation-save-failure', {
                        ...saveSummary,
                        error: normalizedError.message,
                        httpStatus: normalizedError.status ?? diagnostics.lastFailedStatusCode ?? null
                    });

                    throw error;
                }

                const persistedSettings = normalizePtvRecommendationRowSettings(response);

                if (!persistedSettings) {
                    throw new Error('Recommendation rows were generated but the plugin did not return saved recommendation settings.');
                }

                const persistedRowCount = persistedSettings.rows?.length || 0;
                const persistedItemCount = (persistedSettings.rows || []).reduce((total, row) => total + row.items.length, 0);

                recordPtvEvent('recommendation', 'recommendation-save-success', {
                    ...saveSummary,
                    persistedItemCount,
                    persistedPerRowItemCounts: getRecommendationRowItemCounts(persistedSettings),
                    persistedRowCount,
                    responsePayloadSize: getSerializedPayloadSize(persistedSettings),
                    storageWriteResult: 'plugin-settings-response'
                });
                invalidateFeaturedContentMemoryCache(`recommendation-${reason}`);
                setRecommendationSettings(persistedSettings);
                setConfirmedRecommendationSettings(persistedSettings);
                setRecommendationConflict(false);

                let cacheRefresh: FeaturedCacheRefreshResult | null = null;
                let cacheRefreshError = '';

                try {
                    cacheRefresh = await observeStoredFeaturedCacheDocumentAfterSave(
                        `recommendation-${reason}`,
                        refreshStartedAt,
                        {
                            itemCount: persistedItemCount,
                            persistedRowCount,
                            reason
                        }
                    );
                } catch (error) {
                    cacheRefreshError = normalizePtvApiError(error).message;
                    recordPtvEvent('recommendation', 'recommendation-save-cache-refresh-failure', {
                        error: cacheRefreshError,
                        itemCount: persistedItemCount,
                        persistedRowCount,
                        reason
                    });
                }

                return {
                    cacheRefresh,
                    cacheRefreshError,
                    settings: persistedSettings
                };
            });
        } finally {
            if (!recommendationSaveRequestRef.current) setRecommendationSaving(false);
        }
    }, []);

    const loadPersistedRecommendationRows = useCallback(async (source = 'manual-refresh', settingsPayload?: unknown) => {
        const api = getCurrentPtvPluginApiClient();

        if (!api?.getSettings && !settingsPayload) {
            setRecommendationSettings(null);
            setConfirmedRecommendationSettings(undefined);
            return null;
        }

        try {
            const payload = settingsPayload ?? await api?.getSettings<unknown>({ bypassCache: true });
            const persistedSettings = normalizePtvRecommendationRowSettings(payload);
            const { finalizedSettings, needsMigration } = getRecommendationSettingsMigrationState(persistedSettings);
            const loadedSettings = finalizedSettings;
            const migrated = needsMigration;

            if (needsMigration && finalizedSettings) {
                recordPtvEvent('recommendation', 'recommendation-rows-normalized-on-load', {
                    before: getRecommendationRowDiagnosticsSummary(persistedSettings),
                    after: getRecommendationRowDiagnosticsSummary(finalizedSettings),
                    source
                });
            }

            setRecommendationSettings(loadedSettings);
            setConfirmedRecommendationSettings(loadedSettings);
            setRecommendationConflict(false);
            setRecommendationData(null);
            setRecommendationError('');
            recordPtvEvent('recommendation', 'recommendation-rows-loaded-from-storage', {
                loadedRowCount: loadedSettings?.rows?.length || 0,
                migrated,
                persistedRowCount: loadedSettings?.rows?.length || 0,
                source
            });

            if (source === 'manual-refresh') {
                setStatusMessage(getRecommendationRowsLoadedMessage(loadedSettings, migrated));
            }

            return loadedSettings;
        } catch (error) {
            const message = normalizePtvApiError(error).message;

            recordPtvEvent('recommendation', 'recommendation-rows-load-failed', {
                error: message,
                source
            });
            setRecommendationError(message);
            if (source === 'manual-refresh') {
                setStatusMessage({ severity: 'error', text: message });
            }

            return null;
        }
    }, []);

    const reloadPersistedRecommendationRows = useCallback(() => {
        if (
            recommendationLoading
            || recommendationSaving
            || recommendationRequestRef.current
            || recommendationSaveRequestRef.current
        ) return;
        if (
            recommendationDirty
            && !window.confirm('Reload recommendation settings and discard your unsaved recommendation changes?')
        ) return;

        void loadPersistedRecommendationRows('manual-refresh');
    }, [
        loadPersistedRecommendationRows,
        recommendationDirty,
        recommendationLoading,
        recommendationSaving
    ]);

    const loadRows = useCallback(() => {
        if (loadRequestRef.current) return loadRequestRef.current;

        setLoading(true);

        const request = (async () => {
            const api = getCurrentPtvPluginApiClient();

            if (!api) throw new Error('PiggieTV plugin API client is unavailable.');

            let rows: PtvRowBuilderSettings | null = null;
            let settingsPayload: unknown = null;
            let settingsError: unknown = null;
            let rowsError: unknown = null;
            const settingsRequest = withRowBuilderTimeout(
                api.getSettings<unknown>(),
                ROW_BUILDER_LOAD_TIMEOUT_MS,
                'PiggieTV settings request timed out.'
            )
                .then(payload => {
                    settingsPayload = payload;
                    setSeerrConfigured(getSeerrConfiguredFromSettingsPayload(payload));

                    return payload;
                })
                .catch(error => {
                    settingsError = error;
                    recordPtvEvent('api', 'row-builder-load-settings-failed', {
                        error: normalizePtvApiError(error).message
                    });

                    return null;
                });
            const settingsRowsRequest = settingsRequest.then(payload => getRowsFromSettingsPayload(payload));
            const endpointRowsRequest = withRowBuilderTimeout(
                api.getRows<PtvRowBuilderSettings>(),
                ROW_BUILDER_LOAD_TIMEOUT_MS,
                'Row settings request timed out.'
            )
                .then(endpointRows => endpointRows || null)
                .catch(error => {
                    rowsError = error;
                    recordPtvEvent('api', 'row-builder-load-rows-failed', {
                        error: normalizePtvApiError(error).message,
                        settingsError: settingsError ? normalizePtvApiError(settingsError).message : null
                    });

                    return null;
                });

            rows = await getFirstRowBuilderSettings(settingsRowsRequest, endpointRowsRequest);

            if (!rows) {
                throw rowsError || settingsError || new Error('Home Row settings were not returned by the server.');
            }

            const normalizedRows = cloneSettings(rows);

            recordPtvEvent('api', 'row-builder-load-complete', {
                hasPluginPayload: Boolean(rows),
                settingsPayloadLoaded: Boolean(settingsPayload),
                ...getRowsDebugSummary(normalizedRows)
            });

            setForm(normalizedRows);
            setSaved(normalizedRows);
            setRowConflict(false);
            setLoadSucceeded(true);
            setPreview(null);
            setStatusMessage({ severity: 'success', text: 'Row settings loaded.' });
            void settingsRequest
                .then(payload => {
                    if (payload) {
                        return loadPersistedRecommendationRows('row-builder-load', payload);
                    }

                    setRecommendationSettings(null);
                    setConfirmedRecommendationSettings(undefined);

                    return null;
                });
        })()
            .catch(error => {
                setLoadSucceeded(false);
                const normalizedError = normalizePtvApiError(error);
                recordPtvEvent('api', 'row-builder-load-failed', {
                    code: normalizedError.code,
                    kind: normalizedError.kind,
                    status: normalizedError.status
                });
                setStatusMessage({ severity: 'error', text: 'Home Row settings could not be loaded.' });
            })
            .finally(() => {
                hydratedRef.current = true;
                loadRequestRef.current = null;
                setLoading(false);
            });

        loadRequestRef.current = request;

        return request;
    }, [loadPersistedRecommendationRows]);

    useEffect(() => {
        if (!hydratedRef.current) {
            void loadRows();
        }

        return () => {
            recommendationAbortRef.current?.abort();
            recommendationAbortRef.current = null;
            recommendationRequestRef.current = null;
            recommendationRequestTokenRef.current = null;
            previewAbortRef.current?.abort();
        };
    }, [loadRows]);

    const updateForm = useCallback((updater: (settings: PtvRowBuilderSettings) => PtvRowBuilderSettings) => {
        draftRevisionRef.current += 1;
        setForm(current => updater(cloneSettings(current)));
    }, []);

    const updateRule = useCallback((index: number, patch: Partial<PtvRowBuilderRule>) => {
        updateForm(settings => ({
            ...settings,
            rules: settings.rules.map((rule, ruleIndex) => (
                ruleIndex === index ? normalizeRule({ ...rule, ...patch }, index) : rule
            ))
        }));
    }, [updateForm]);

    const addRule = useCallback(() => {
        updateForm(settings => ({
            ...settings,
            rules: [...settings.rules, makeNewRule(settings.rules.length)]
        }));
    }, [updateForm]);

    const addRuleToGroup = useCallback((groupTitle: string) => {
        updateForm(settings => ({
            ...settings,
            rules: [
                ...settings.rules,
                {
                    ...makeRuleForGroup(settings.rules.length, groupTitle),
                    sortPriority: getNextSortPriority(settings)
                }
            ]
        }));
    }, [updateForm]);

    const addGroup = useCallback(() => {
        const title = groupDraft.trim();

        if (!title) {
            setStatusMessage({ severity: 'warning', text: 'Enter a group name first.' });
            return;
        }

        if (rowGroups.some(group => group.title.toLowerCase() === title.toLowerCase())) {
            setStatusMessage({ severity: 'warning', text: `Group '${title}' already exists.` });
            return;
        }

        addRuleToGroup(title);
        setGroupDraft('');
        setPreview(null);
        setStatusMessage({ severity: 'info', text: `Group '${title}' added with a starter row. Save to persist.` });
    }, [addRuleToGroup, groupDraft, rowGroups]);

    const addTemplateRows = useCallback((templateName: 'featured' | 'studios') => {
        updateForm(settings => {
            const existingIds = new Set(settings.rules.map(rule => rule.id.toLowerCase()));
            const startPriority = getNextSortPriority(settings);
            const templateRows = (templateName === 'studios'
                ? makeStudiosTemplate(startPriority)
                : makeFeaturedTemplate(startPriority))
                .map(rule => withUniqueRuleId(rule, existingIds));

            return {
                ...settings,
                rules: [...settings.rules, ...templateRows]
            };
        });
        setPreview(null);
        setStatusMessage({
            severity: 'info',
            text: `${templateName === 'studios' ? 'Studios' : 'Featured'} group rows added locally. Preview and save to persist.`
        });
    }, [updateForm]);

    const renameGroup = useCallback((oldTitle: string, nextTitle: string) => {
        updateForm(settings => ({
            ...settings,
            rules: settings.rules.map((rule, index) => (
                rule.groupTitle === oldTitle ? normalizeRule({ ...rule, groupTitle: nextTitle }, index) : rule
            ))
        }));
    }, [updateForm]);

    const clearGroup = useCallback((groupTitle: string) => {
        updateForm(settings => ({
            ...settings,
            rules: settings.rules.map((rule, index) => (
                rule.groupTitle === groupTitle ? normalizeRule({ ...rule, groupTitle: '' }, index) : rule
            ))
        }));
        setPreview(null);
        setStatusMessage({ severity: 'info', text: `Rows from '${groupTitle}' were moved to Ungrouped locally. Save to persist.` });
    }, [updateForm]);

    const removeRule = useCallback((index: number) => {
        updateForm(settings => ({
            ...settings,
            rules: settings.rules.filter((_, ruleIndex) => ruleIndex !== index)
        }));
    }, [updateForm]);

    const restoreDefaults = useCallback(() => {
        if (!window.confirm('Restore the default Home Row rules? The defaults will remain local until you choose Save.')) return;

        draftRevisionRef.current += 1;
        setForm(cloneSettings(DEFAULT_SETTINGS));
        setPreview(null);
        setStatusMessage({ severity: 'info', text: 'Default row rules restored locally. Save to persist.' });
    }, []);

    const previewRows = useCallback(async () => {
        if (previewing || validation.errors.length) return;

        previewAbortRef.current?.abort();
        const abortController = createRowsAbortController();
        previewAbortRef.current = abortController;
        setPreviewing(true);
        setStatusMessage({ severity: 'info', text: 'Generating row plan preview...' });

        try {
            const api = getCurrentPtvPluginApiClient();

            if (!api) throw new Error('PiggieTV plugin API client is unavailable.');

            const response = await api.previewRows<PtvRowPreviewResponse, PtvRowBuilderSettings>(
                form,
                abortController ? { signal: abortController.signal } : undefined
            );
            setPreview(response);
            setStatusMessage({
                severity: response.validation?.errors?.length ? 'warning' : 'success',
                text: `Preview generated: ${response.rows?.length || 0} row(s).`
            });
        } catch (error) {
            if (!abortController?.signal.aborted) {
                setStatusMessage({ severity: 'error', text: normalizePtvApiError(error).message });
            }
        } finally {
            if (previewAbortRef.current === abortController) previewAbortRef.current = null;
            setPreviewing(false);
        }
    }, [form, previewing, validation.errors.length]);

    const previewRecommendationRows = useCallback(async (forceRefresh = false, manual = false) => {
        if (!manual) {
            recordPtvEvent('recommendation', 'row-builder-recommendation-generation-blocked', {
                forceRefresh,
                reason: 'manual-click-required'
            });
            setRecommendationError('Recommendation generation only runs when Generate Recommendation Rows is clicked.');
            return;
        }

        if (
            confirmedRecommendationSettings === undefined
            || recommendationLoading
            || recommendationSaving
            || recommendationConflict
            || recommendationRequestRef.current
            || recommendationSaveRequestRef.current
        ) return;

        const performanceProfile = getPtvPerformanceProfile();

        if (performanceProfile.isFireTv || performanceProfile.isLowPower) {
            setRecommendationError('Recommendation generation is disabled on Fire TV and low-power clients.');
            setStatusMessage({
                severity: 'warning',
                text: 'Recommendation generation is disabled on Fire TV and low-power clients.'
            });
            return;
        }

        recommendationAbortRef.current?.abort();
        const abortController = createRowsAbortController();

        recommendationAbortRef.current = abortController;
        setRecommendationLoading(true);
        setRecommendationError('');
        setStatusMessage({ severity: 'info', text: 'Generating recommendation rows inside Row Builder...' });

        const startedAt = Date.now();
        const requestToken = {};
        recommendationRequestTokenRef.current = requestToken;
        const request = (async () => {
            recordPtvEvent('recommendation', 'row-builder-recommendation-generation-start', {
                endpoint: 'recommendations/engine/getPtvRecommendationDashboardData',
                forceRefresh,
                includeHomeScans: false,
                manual,
                startedAt
            });

            const nextData = await getLazyPtvRecommendationDashboardData({
                forceRefresh,
                includeHomeScans: false,
                signal: abortController?.signal
            });

            if (recommendationRequestTokenRef.current !== requestToken) return;

            const persistedSettings = buildPersistedRecommendationSettings(nextData, getRowBuilderConfigHash(form));
            setRecommendationData(nextData);
            setRecommendationSettings(persistedSettings);
            recordPtvEvent('recommendation', 'row-builder-recommendation-hydration-summary', {
                generatedCandidateCount: nextData.candidates.length,
                generatedRows: nextData.rows.map(row => ({
                    diagnostics: row.diagnostics,
                    itemCount: row.items.length,
                    rowId: row.id,
                    title: row.title
                })),
                savedRows: getRecommendationRowDiagnosticsSummary(persistedSettings)
            });
            recordPtvEvent('recommendation', 'row-builder-recommendation-rows-loaded', {
                durationMs: Date.now() - startedAt,
                endpoint: 'recommendations/engine/getPtvRecommendationDashboardData',
                forceRefresh,
                includeHomeScans: false,
                recommendationRowsLoaded: nextData.rows.length,
                recommendationRowsRendered: nextData.rows.length,
                recommendationRowsDropped: 0,
                recommendationDropReasons: [],
                recommendationCount: nextData.metrics.recommendationCount
            });
            try {
                const saveResult = await savePersistedRecommendationSettings(
                    persistedSettings,
                    confirmedRecommendationSettings,
                    'generated'
                );

                setStatusMessage({
                    severity: saveResult.cacheRefreshError || getFeaturedCacheRefreshWarning(saveResult.cacheRefresh) ? 'warning' : 'success',
                    text: getRecommendationSaveSuccessText(
                        `Recommendation rows generated: ${persistedSettings.rows?.length || 0} row(s), ${nextData.metrics.recommendationCount} candidate item(s)`,
                        saveResult
                    )
                });
            } catch (saveError) {
                if (saveError instanceof PtvRecommendationSettingsConflictError) {
                    setRecommendationConflict(true);
                    setStatusMessage({
                        severity: 'warning',
                        text: 'Recommendation rows changed on the server. Your generated rows remain unsaved until you reload and try again.'
                    });
                    return;
                }

                const message = saveError instanceof PtvRecommendationMutationInProgressError ?
                    saveError.message :
                    normalizePtvApiError(saveError).message;

                setStatusMessage({
                    severity: 'warning',
                    text: `Recommendation rows generated but not saved: ${message}. Your generated rows remain unsaved.`
                });
                return;
            }
        })();

        recommendationRequestRef.current = request;

        try {
            await request;
        } catch (error) {
            if (recommendationRequestTokenRef.current !== requestToken) return;
            if (isRecord(error) && error.kind === 'abort') return;

            const message = normalizePtvApiError(error).message;

            setRecommendationError(message);
            recordPtvEvent('recommendation', 'row-builder-recommendation-generation-failed', {
                durationMs: Date.now() - startedAt,
                endpoint: 'recommendations/engine/getPtvRecommendationDashboardData',
                error: message,
                forceRefresh
            });
            setStatusMessage({ severity: 'error', text: message });
        } finally {
            if (recommendationRequestRef.current === request && recommendationRequestTokenRef.current === requestToken) {
                recommendationRequestRef.current = null;
                recommendationRequestTokenRef.current = null;
                if (recommendationAbortRef.current === abortController) recommendationAbortRef.current = null;
                setRecommendationLoading(false);
            }
        }
    }, [
        confirmedRecommendationSettings,
        form,
        recommendationConflict,
        recommendationLoading,
        recommendationSaving,
        savePersistedRecommendationSettings
    ]);

    const toggleRecommendationRow = useCallback(async (rowId: string, enabled: boolean) => {
        if (
            !recommendationSettings?.rows?.length
            || confirmedRecommendationSettings === undefined
            || recommendationConflict
            || recommendationLoading
            || recommendationSaving
            || recommendationRequestRef.current
            || recommendationSaveRequestRef.current
        ) return;

        const nextSettings = finalizeRecommendationSettings({
            ...recommendationSettings,
            rows: recommendationSettings.rows.map(row => (
                row.id === rowId ? {
                    ...row,
                    accepted: enabled ? true : row.accepted === true,
                    draft: enabled ? false : row.draft === true && row.accepted !== true,
                    enabled
                } : row
            ))
        });

        setRecommendationSettings(nextSettings);
        setStatusMessage({ severity: 'info', text: 'Saving recommendation row state...' });

        try {
            const saveResult = await savePersistedRecommendationSettings(
                nextSettings,
                confirmedRecommendationSettings,
                'row-toggle'
            );

            setStatusMessage({
                severity: saveResult.cacheRefreshError || getFeaturedCacheRefreshWarning(saveResult.cacheRefresh) ? 'warning' : 'success',
                text: getRecommendationSaveSuccessText('Recommendation row state', saveResult)
            });
        } catch (error) {
            if (error instanceof PtvRecommendationSettingsConflictError) {
                setRecommendationConflict(true);
                setStatusMessage({
                    severity: 'warning',
                    text: 'Recommendation settings changed on the server. Your row change remains unsaved until you reload and try again.'
                });
                return;
            }

            const message = error instanceof PtvRecommendationMutationInProgressError ?
                error.message :
                normalizePtvApiError(error).message;
            setStatusMessage({ severity: 'error', text: `Recommendation row state was not saved: ${message}. Your change remains unsaved.` });
        }
    }, [
        confirmedRecommendationSettings,
        recommendationConflict,
        recommendationLoading,
        recommendationSaving,
        recommendationSettings,
        savePersistedRecommendationSettings
    ]);

    const acceptRecommendationRows = useCallback(async () => {
        if (
            !recommendationSettings?.rows?.length
            || confirmedRecommendationSettings === undefined
            || recommendationConflict
            || recommendationLoading
            || recommendationSaving
            || recommendationRequestRef.current
            || recommendationSaveRequestRef.current
        ) return;

        const nextSettings = finalizeRecommendationSettings({
            ...recommendationSettings,
            rows: recommendationSettings.rows.map(row => {
                const validatedRow = getValidatedPtvPersistedRecommendationRow(row);

                return validatedRow ? {
                    ...row,
                    accepted: true,
                    draft: false,
                    enabled: true
                } : {
                    ...row,
                    enabled: false
                };
            })
        });

        setRecommendationSettings(nextSettings);
        setStatusMessage({ severity: 'info', text: 'Saving accepted recommendation rows...' });

        try {
            const saveResult = await savePersistedRecommendationSettings(
                nextSettings,
                confirmedRecommendationSettings,
                'accept-all'
            );

            setStatusMessage({
                severity: saveResult.cacheRefreshError || getFeaturedCacheRefreshWarning(saveResult.cacheRefresh) ? 'warning' : 'success',
                text: getRecommendationSaveSuccessText('Accepted recommendation rows', saveResult)
            });
        } catch (error) {
            if (error instanceof PtvRecommendationSettingsConflictError) {
                setRecommendationConflict(true);
                setStatusMessage({
                    severity: 'warning',
                    text: 'Recommendation settings changed on the server. Your acceptance changes remain unsaved until you reload and try again.'
                });
                return;
            }

            const message = error instanceof PtvRecommendationMutationInProgressError ?
                error.message :
                normalizePtvApiError(error).message;
            setStatusMessage({ severity: 'error', text: `Recommendation rows were not accepted: ${message}. Your changes remain unsaved.` });
        }
    }, [
        confirmedRecommendationSettings,
        recommendationConflict,
        recommendationLoading,
        recommendationSaving,
        recommendationSettings,
        savePersistedRecommendationSettings
    ]);

    const deleteRecommendationRow = useCallback(async (rowId: string) => {
        if (
            !recommendationSettings?.rows?.length
            || confirmedRecommendationSettings === undefined
            || recommendationConflict
            || recommendationLoading
            || recommendationSaving
            || recommendationRequestRef.current
            || recommendationSaveRequestRef.current
        ) return;

        const nextSettings = finalizeRecommendationSettings({
            ...recommendationSettings,
            rows: recommendationSettings.rows.filter(row => row.id !== rowId)
        });

        setRecommendationSettings(nextSettings);
        setStatusMessage({ severity: 'info', text: 'Deleting recommendation row...' });

        try {
            const saveResult = await savePersistedRecommendationSettings(
                nextSettings,
                confirmedRecommendationSettings,
                'row-delete'
            );

            setStatusMessage({
                severity: saveResult.cacheRefreshError || getFeaturedCacheRefreshWarning(saveResult.cacheRefresh) ? 'warning' : 'success',
                text: getRecommendationSaveSuccessText('Recommendation row deletion', saveResult)
            });
        } catch (error) {
            if (error instanceof PtvRecommendationSettingsConflictError) {
                setRecommendationConflict(true);
                setStatusMessage({
                    severity: 'warning',
                    text: 'Recommendation settings changed on the server. The row remains removed locally until you reload and try again.'
                });
                return;
            }

            const message = error instanceof PtvRecommendationMutationInProgressError ?
                error.message :
                normalizePtvApiError(error).message;
            setStatusMessage({ severity: 'error', text: `Recommendation row was not deleted: ${message}. The removal remains unsaved.` });
        }
    }, [
        confirmedRecommendationSettings,
        recommendationConflict,
        recommendationLoading,
        recommendationSaving,
        recommendationSettings,
        savePersistedRecommendationSettings
    ]);

    const saveRows = useCallback(async () => {
        if (saving || refreshing || saveRequestRef.current || refreshRequestRef.current || validation.errors.length) return;
        if (estimate.health === 'Risky' && !window.confirm('This row plan is estimated as Risky. Save it anyway?')) return;

        setSaving(true);
        setStatusMessage({ severity: 'info', text: 'Saving row rules...' });

        const request = (async () => {
            const api = getCurrentPtvPluginApiClient();

            if (!api) throw new Error('PiggieTV plugin API client is unavailable.');

            const submittedRows = cloneSettings(form);
            const submittedRevision = draftRevisionRef.current;
            const authoritativeRowsResponse = await api.getRows<PtvRowBuilderSettings>();

            if (!authoritativeRowsResponse || !rowSettingsMatch(cloneSettings(authoritativeRowsResponse), saved)) {
                throw new PtvRowsConflictError();
            }
            const savedRules = submittedRows.rules.map(rule => ({
                enabled: rule.enabled,
                generationMode: rule.generationMode,
                groupTitle: rule.groupTitle,
                id: rule.id,
                includeSubgenres: rule.includeSubgenres,
                itemLimit: rule.itemLimit,
                mediaType: rule.mediaType,
                name: rule.name,
                rowCount: rule.rowCount,
                sourceType: rule.sourceType,
                sourceValue: rule.sourceValue,
                subgenreRowCount: rule.subgenreRowCount
            }));

            if (canShowDiagnostics) {
                ptvSafeConsole.debug('[PTV Row Rules] savedRules', savedRules);
            }

            recordPtvEvent('api', 'row-builder-save-start', getRowsDebugSummary(submittedRows));
            recordPtvEvent('api', 'row-rules-savedRules', {
                savedRules
            });

            const response = await api.saveRows<PtvRowBuilderSettings, PtvRowBuilderSettings>(submittedRows);
            const responseRows = cloneSettings(response);
            const responseLooksLikeUnexpectedDefaults = !isDefaultRuleSet(submittedRows) && isDefaultRuleSet(responseRows);
            const verifiedRows = responseLooksLikeUnexpectedDefaults
                ? cloneSettings(await api.getRows<PtvRowBuilderSettings>())
                : responseRows;
            const saveDecision = getPtvAdminMutationCommitDecision({
                areEqual: rowSettingsMatch,
                confirmedValue: verifiedRows,
                currentRevision: draftRevisionRef.current,
                submittedRevision,
                submittedValue: submittedRows
            });

            recordPtvEvent('api', 'row-builder-save-complete', {
                responseLooksLikeUnexpectedDefaults,
                response: getRowsDebugSummary(responseRows),
                saveVerified: saveDecision.confirmed,
                saved: getRowsDebugSummary(verifiedRows),
                submitted: getRowsDebugSummary(submittedRows)
            });

            invalidateFeaturedContentMemoryCache('row-builder-save');
            if (!saveDecision.confirmed) throw new PtvRowsSaveVerificationError();
            setSaved(verifiedRows);
            if (saveDecision.applyToDraft) setForm(verifiedRows);
            setStatusMessage({ severity: 'success', text: 'Row rules saved.' });
        })();

        saveRequestRef.current = request;

        try {
            await request;
        } catch (error) {
            if (error instanceof PtvRowsConflictError) {
                setRowConflict(true);
                setStatusMessage({ severity: 'warning', text: 'Home Row settings were not saved because the server has newer values.' });
                return;
            }
            if (error instanceof PtvRowsSaveVerificationError) {
                setStatusMessage({
                    severity: 'warning',
                    text: 'The server did not confirm the submitted Home Row settings. Your edits remain unsaved.'
                });
                return;
            }
            const normalizedError = normalizePtvApiError(error);
            recordPtvEvent('api', 'row-builder-save-failed', {
                code: normalizedError.code,
                kind: normalizedError.kind,
                status: normalizedError.status
            });
            setStatusMessage({ severity: 'error', text: 'Home Row settings could not be saved. Review the form and try again.' });
        } finally {
            if (saveRequestRef.current === request) saveRequestRef.current = null;
            setSaving(false);
        }
    }, [canShowDiagnostics, estimate.health, form, refreshing, saved, saving, validation.errors.length]);

    const refreshCache = useCallback(async () => {
        if (refreshing || saving || refreshRequestRef.current || saveRequestRef.current) return;
        if (validation.errors.length) {
            setStatusMessage({ severity: 'error', text: 'Fix row validation errors before refreshing the featured cache.' });
            return;
        }
        if (dirty && estimate.health === 'Risky' && !window.confirm('This row plan is estimated as Risky. Save and refresh it anyway?')) return;

        setRefreshing(true);
        setStatusMessage({ severity: 'info', text: dirty ? 'Saving row rules before refreshing featured cache...' : 'Refreshing featured cache with saved row rules...' });

        const request = (async () => {
            const api = getCurrentPtvPluginApiClient();

            if (!api) throw new Error('PiggieTV plugin API client is unavailable.');

            const submittedRows = cloneSettings(form);
            const submittedRevision = draftRevisionRef.current;
            const refreshStartedAt = Date.now();
            let savedRows = cloneSettings(saved);

            if (dirty) {
                setSaving(true);
                const authoritativeRowsResponse = await api.getRows<PtvRowBuilderSettings>();

                if (!authoritativeRowsResponse || !rowSettingsMatch(cloneSettings(authoritativeRowsResponse), saved)) {
                    throw new PtvRowsConflictError();
                }

                const responseRows = cloneSettings(await api.saveRows<PtvRowBuilderSettings, PtvRowBuilderSettings>(submittedRows));
                const responseLooksLikeUnexpectedDefaults = !isDefaultRuleSet(submittedRows) && isDefaultRuleSet(responseRows);
                savedRows = responseLooksLikeUnexpectedDefaults
                    ? cloneSettings(await api.getRows<PtvRowBuilderSettings>())
                    : responseRows;
                const saveDecision = getPtvAdminMutationCommitDecision({
                    areEqual: rowSettingsMatch,
                    confirmedValue: savedRows,
                    currentRevision: draftRevisionRef.current,
                    submittedRevision,
                    submittedValue: submittedRows
                });

                invalidateFeaturedContentMemoryCache('row-builder-refresh-save');
                if (!saveDecision.confirmed) throw new PtvRowsSaveVerificationError();
                setSaved(savedRows);
                if (saveDecision.applyToDraft) setForm(savedRows);
                recordPtvEvent('api', 'row-builder-refresh-saved-current-rules', {
                    dirty,
                    responseLooksLikeUnexpectedDefaults,
                    saveVerified: saveDecision.confirmed,
                    saved: getRowsDebugSummary(savedRows),
                    submitted: getRowsDebugSummary(submittedRows)
                });
            } else {
                await api.refreshFeaturedContentCacheDocument();
            }

            const cacheRefresh = await observeStoredFeaturedCacheDocumentAfterSave(
                'row-builder-manual-refresh',
                refreshStartedAt,
                {
                    dirty,
                    saved: getRowsDebugSummary(savedRows)
                }
            );
            const cacheRefreshWarning = getFeaturedCacheRefreshWarning(cacheRefresh);

            if (cacheRefreshWarning) {
                setStatusMessage({
                    severity: 'warning',
                    text: `Featured cache refresh returned a warning: ${cacheRefreshWarning}`
                });
                return;
            }

            setStatusMessage({
                severity: cacheRefresh.featuredCacheExists === false || cacheRefresh.effectiveHasPayload === false || cacheRefresh.sectionCount === 0 || cacheRefresh.itemCount === 0 ? 'warning' : 'success',
                text: `Featured cache refreshed (${cacheRefresh.heroCount} heroes, ${cacheRefresh.readback.configuredRowCount} configured rows, ${cacheRefresh.readback.recommendationRowCount} recommendation rows, ${cacheRefresh.sectionCount} total sections, ${cacheRefresh.itemCount} items, ${cacheRefresh.cachePayloadBytes ?? 'n/a'} bytes).`
            });
        })();

        refreshRequestRef.current = request;

        try {
            await request;
        } catch (error) {
            if (error instanceof PtvRowsConflictError) {
                setRowConflict(true);
                setStatusMessage({ severity: 'warning', text: 'The Featured cache was not refreshed because Home Row settings changed on the server.' });
                return;
            }
            if (error instanceof PtvRowsSaveVerificationError) {
                setStatusMessage({
                    severity: 'warning',
                    text: 'The Featured cache was not refreshed because the server did not confirm the submitted Home Row settings. Your edits remain unsaved.'
                });
                return;
            }
            const normalizedError = normalizePtvApiError(error);
            recordPtvEvent('api', 'row-builder-refresh-failed', {
                code: normalizedError.code,
                kind: normalizedError.kind,
                status: normalizedError.status
            });
            setStatusMessage({ severity: 'error', text: 'The Featured cache could not be refreshed. Try again.' });
        } finally {
            if (refreshRequestRef.current === request) refreshRequestRef.current = null;
            setRefreshing(false);
            setSaving(false);
        }
    }, [dirty, estimate.health, form, refreshing, saved, saving, validation.errors.length]);

    const exportObject = useCallback((value: unknown, filename: string) => {
        const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
        // eslint-disable-next-line compat/compat
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        // eslint-disable-next-line compat/compat
        URL.revokeObjectURL(url);
    }, []);

    const exportConfig = useCallback(() => {
        exportObject(form, `piggietv-row-rules-${Date.now()}.json`);
    }, [exportObject, form]);

    const importConfig = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';

        if (!file) return;
        if (file.size > MAX_PTV_ROW_IMPORT_BYTES) {
            setStatusMessage({ severity: 'error', text: 'Row configuration is too large. Choose a JSON file smaller than 512 KiB.' });
            return;
        }

        const reader = new FileReader();

        reader.onload = () => {
            try {
                const parsed = parsePtvRowBuilderImport(String(reader.result || ''));
                const imported = cloneSettings(parsed as Partial<PtvRowBuilderSettings>);
                const importedValidation = localValidation(imported, seerrConfigured);
                if (importedValidation.errors.length) throw new Error(importedValidation.errors[0]);
                draftRevisionRef.current += 1;
                setForm(imported);
                setPreview(null);
                setStatusMessage({ severity: 'success', text: `${imported.rules.length} row rules imported locally. Preview and save to persist.` });
            } catch (error) {
                setStatusMessage({ severity: 'error', text: normalizePtvApiError(error).message });
            }
        };

        reader.readAsText(file);
    }, [seerrConfigured]);

    return (
        <section
            id='ptvRowsPage'
            className='ptv-admin-piggietv-page'
            data-testid='ptv-admin-piggietv-rows'
        >
            <Box className='ptv-admin-piggietv-content'>
                <Stack spacing={2}>
                    <Box className='ptv-admin-piggietv-header'>
                        <Stack direction='row' spacing={1} alignItems='center' flexWrap='wrap'>
                            <Typography variant='h1'>Home Rows</Typography>
                            <Chip className='ptv-status-badge ptv-status-badge-info' label={pageDirty ? 'unsaved changes' : 'saved'} size='small' />
                        </Stack>
                        <Typography variant='body1' color='text.secondary'>
                            Build and preview PiggieTV homepage rows, recommendations and featured-content rules.
                        </Typography>
                    </Box>

                    {statusMessage && <Alert severity={statusMessage.severity}>{statusMessage.text}</Alert>}
                    {rowConflict ? (
                        <Alert
                            severity='warning'
                            action={(
                                <Button
                                    color='inherit'
                                    onClick={() => {
                                        if (!window.confirm('Reload Home Row settings and discard your unsaved changes?')) return;
                                        setRowConflict(false);
                                        loadRows().catch(() => undefined);
                                    }}
                                >
                                    Reload Settings
                                </Button>
                            )}
                        >
                            Home Row settings changed on the server while you were editing.
                        </Alert>
                    ) : null}
                    {recommendationConflict ? (
                        <Alert
                            severity='warning'
                            action={(
                                <Button color='inherit' onClick={reloadPersistedRecommendationRows}>
                                    Reload Recommendations
                                </Button>
                            )}
                        >
                            Recommendation settings changed on the server while you were editing. Your local recommendation changes remain unsaved.
                        </Alert>
                    ) : null}
                    {validation.errors.map(error => <Alert key={error} severity='error'>{error}</Alert>)}
                    {validation.warnings.map(warning => <Alert key={warning} severity='warning'>{warning}</Alert>)}

                    {loading ? (
                        <Grid aria-label='Loading Home Rows' container spacing={2}>
                            {[0, 1, 2].map(index => (
                                <Grid key={index} size={{ xs: 12, md: index === 2 ? 12 : 6 }}>
                                    <Card className='ptv-dashboard-card ptv-control-card'>
                                        <CardContent>
                                            <Skeleton height={36} width='42%' />
                                            <Skeleton height={24} width='78%' />
                                            <Skeleton height={96} variant='rounded' />
                                        </CardContent>
                                    </Card>
                                </Grid>
                            ))}
                        </Grid>
                    ) : !loadSucceeded ? (
                        <Alert
                            severity='error'
                            action={<Button color='inherit' onClick={loadRows}>Retry</Button>}
                        >
                            Home Row settings could not be loaded. No editable defaults were shown.
                        </Alert>
                    ) : (
                        <>
                            <Grid container spacing={2}>
                                <Grid size={{ xs: 12, md: 6 }}>
                                    <Card className='ptv-dashboard-card ptv-control-card'>
                                        <CardContent>
                                            <Stack spacing={1}>
                                                <Typography variant='h2'>Estimated Performance</Typography>
                                                <Stack direction='row' spacing={1} flexWrap='wrap'>
                                                    <Chip label={estimate.health} color={estimate.health === 'Risky' ? 'error' : estimate.health === 'Heavy' ? 'warning' : 'success'} />
                                                    <Chip label={`Configured rows: ${estimate.configuredRowCount}`} />
                                                    <Chip label={`Recommendation rows enabled: ${enabledRecommendationRows.length}`} />
                                                    <Chip label={`Total Home rows: ${totalEstimatedHomeRows}`} />
                                                    <Chip label={`${estimate.expectedItemCount} items`} />
                                                    <Chip label={`${estimate.providerCalls} provider checks`} />
                                                </Stack>
                                                <Typography>Cache generation: {estimate.estimatedCacheCost}</Typography>
                                                <Typography>Frontend render cost: {estimate.estimatedFrontendCost}</Typography>
                                                {!!estimate.reasons.length && <Typography color='warning.main'>{estimate.reasons.join(', ')}</Typography>}
                                            </Stack>
                                        </CardContent>
                                    </Card>
                                </Grid>
                            </Grid>

                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack className='ptv-row-builder-action-groups' spacing={1.5}>
                                        <Stack direction='row' spacing={1.5} alignItems='center' justifyContent='space-between' flexWrap='wrap'>
                                            <FormControlLabel
                                                control={<Switch checked={form.enabled} onChange={event => updateForm(settings => ({ ...settings, enabled: event.target.checked }))} />}
                                                label='Enable Row Builder'
                                            />
                                            <Button href='#/settings/admin/piggietv' variant='text'>PiggieTV Configuration</Button>
                                        </Stack>
                                        <Box>
                                            <Typography className='ptv-row-builder-action-label' component='h2' variant='overline'>Primary actions</Typography>
                                            <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                                                <Button className='ptv-button' variant='contained' onClick={addRule}>Add Row</Button>
                                                <Button className='ptv-button' variant='outlined' disabled={previewing || saving || refreshing || Boolean(validation.errors.length)} onClick={previewRows}>
                                                    {previewing ? 'Previewing...' : 'Preview'}
                                                </Button>
                                                <Button className='ptv-button' variant='contained' disabled={saving || refreshing || !dirty || Boolean(validation.errors.length)} onClick={saveRows}>
                                                    {saving ? 'Saving...' : 'Save Changes'}
                                                </Button>
                                            </Stack>
                                        </Box>
                                        <Box>
                                            <Typography className='ptv-row-builder-action-label' component='h2' variant='overline'>Featured content</Typography>
                                            <Button className='ptv-button' variant='outlined' disabled={refreshing || saving || Boolean(validation.errors.length)} onClick={refreshCache}>
                                                {refreshing ? 'Refreshing...' : 'Refresh Featured Cache'}
                                            </Button>
                                        </Box>
                                        <details className='ptv-admin-piggietv-advanced-details'>
                                            <summary>Import, export and defaults</summary>
                                            <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                                                <Button color='warning' disabled={saving || refreshing} variant='outlined' onClick={restoreDefaults}>Restore Defaults</Button>
                                                <Button disabled={saving || refreshing} variant='outlined' onClick={exportConfig}>Export Config</Button>
                                                <Button disabled={saving || refreshing} variant='outlined' onClick={() => importInputRef.current?.click()}>Import Config</Button>
                                            </Stack>
                                        </details>
                                        <input ref={importInputRef} hidden type='file' accept='application/json,.json' onChange={importConfig} />
                                    </Stack>
                                </CardContent>
                            </Card>

                            <RecommendationRowsPanel
                                canShowDiagnostics={canShowDiagnostics}
                                data={recommendationData}
                                error={recommendationError}
                                hasConflict={recommendationConflict || confirmedRecommendationSettings === undefined}
                                isLoading={recommendationLoading || recommendationSaving}
                                onAcceptAll={acceptRecommendationRows}
                                onDeleteRow={deleteRecommendationRow}
                                onGenerate={previewRecommendationRows}
                                onRefreshSaved={reloadPersistedRecommendationRows}
                                onToggleRow={toggleRecommendationRow}
                                persistedRows={persistedRecommendationRows}
                            />

                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={1.5}>
                                        <Box>
                                            <Typography variant='h2'>Row Groups</Typography>
                                            <Typography variant='body2' color='text.secondary'>
                                                Groups keep related rows together on the homepage. A group is saved when at least one row belongs to it.
                                            </Typography>
                                        </Box>

                                        <Grid container spacing={1.25} alignItems='center'>
                                            <Grid size={{ xs: 12, md: 4 }}>
                                                <TextField
                                                    fullWidth
                                                    label='New Group Name'
                                                    placeholder='Studios, Featured, Explore Genres'
                                                    value={groupDraft}
                                                    onChange={event => setGroupDraft(event.target.value)}
                                                />
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 8 }}>
                                                <Stack direction='row' spacing={1} flexWrap='wrap'>
                                                    <Button className='ptv-button' variant='contained' onClick={addGroup}>Add Group</Button>
                                                    <Button variant='outlined' onClick={() => addTemplateRows('studios')}>Add Studios Example</Button>
                                                    <Button variant='outlined' onClick={() => addTemplateRows('featured')}>Add Featured Example</Button>
                                                </Stack>
                                            </Grid>
                                        </Grid>

                                        {rowGroups.length ? (
                                            <Grid container spacing={1.25}>
                                                {rowGroups.map(group => (
                                                    <Grid key={group.title} size={{ xs: 12, md: 6, xl: 4 }}>
                                                        <Box className='ptv-dashboard-list-row'>
                                                            <Stack spacing={1}>
                                                                <Stack direction='row' spacing={1} alignItems='center' flexWrap='wrap'>
                                                                    <Chip label={`${group.ruleCount} row${group.ruleCount === 1 ? '' : 's'}`} />
                                                                    <Chip label={`${group.enabledCount} enabled`} color={group.enabledCount ? 'success' : 'default'} />
                                                                </Stack>
                                                                <TextField
                                                                    fullWidth
                                                                    defaultValue={group.title}
                                                                    label='Group Name'
                                                                    onBlur={event => {
                                                                        const nextTitle = event.target.value.trim();

                                                                        if (nextTitle && nextTitle !== group.title) {
                                                                            renameGroup(group.title, nextTitle);
                                                                        } else {
                                                                            event.target.value = group.title;
                                                                        }
                                                                    }}
                                                                />
                                                                <Stack direction='row' spacing={1} flexWrap='wrap'>
                                                                    <Button variant='outlined' onClick={() => addRuleToGroup(group.title)}>Add Row To Group</Button>
                                                                    <Button color='warning' variant='outlined' onClick={() => clearGroup(group.title)}>Ungroup Rows</Button>
                                                                </Stack>
                                                            </Stack>
                                                        </Box>
                                                    </Grid>
                                                ))}
                                            </Grid>
                                        ) : (
                                            <Alert severity='info'>No groups yet. Add a named group or use one of the examples.</Alert>
                                        )}
                                    </Stack>
                                </CardContent>
                            </Card>

                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={1.5}>
                                        <Typography variant='h2'>Configured Rules</Typography>
                                        {form.rules.map((rule, index) => {
                                            return (
                                                <Box key={`${rule.id}-${index}`} className='ptv-dashboard-list-row ptv-row-rule-line'>
                                                    <Box className='ptv-row-rule-editor'>
                                                        <Box className='ptv-row-rule-cell ptv-row-rule-cell-toggle'>
                                                            <FormControlLabel
                                                                control={<Switch checked={rule.enabled} onChange={event => updateRule(index, { enabled: event.target.checked })} />}
                                                                label='On'
                                                            />
                                                        </Box>
                                                        <Box className='ptv-row-rule-cell'>
                                                            <TextField fullWidth label='Row Name' value={rule.name} onChange={event => updateRule(index, { name: event.target.value })} />
                                                        </Box>
                                                        <Box className='ptv-row-rule-cell'>
                                                            <TextField fullWidth select label='Media' value={rule.mediaType} onChange={event => updateRule(index, { mediaType: event.target.value as RowMediaType })}>
                                                                {MEDIA_TYPES.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                                            </TextField>
                                                        </Box>
                                                        <Box className='ptv-row-rule-cell'>
                                                            <TextField fullWidth select label='Source' value={rule.sourceType} onChange={event => updateRule(index, { sourceType: event.target.value as RowSourceType })}>
                                                                {SOURCE_TYPES.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                                            </TextField>
                                                        </Box>
                                                        <RowSourceValueControls index={index} rule={rule} updateRule={updateRule} />
                                                        <Box className='ptv-row-rule-cell'>
                                                            <TextField fullWidth select label='Mode' value={rule.generationMode} onChange={event => updateRule(index, { generationMode: event.target.value as RowGenerationMode })}>
                                                                {GENERATION_MODES.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                                            </TextField>
                                                        </Box>
                                                        <Box className='ptv-row-rule-cell ptv-row-rule-cell-small'>
                                                            <TextField fullWidth label={rule.generationMode === 'random' && rule.sourceType === 'genre' ? 'Rows' : 'Limit'} type='number' value={rule.generationMode === 'random' && rule.sourceType === 'genre' ? rule.rowCount : rule.itemLimit} onChange={event => updateRule(index, rule.generationMode === 'random' && rule.sourceType === 'genre' ? { rowCount: Number(event.target.value) } : { itemLimit: Number(event.target.value) })} />
                                                        </Box>
                                                        <RowSubgenreControls index={index} rule={rule} updateRule={updateRule} />
                                                        <Box className='ptv-row-rule-cell ptv-row-rule-cell-small'>
                                                            <TextField fullWidth label='Priority' type='number' value={rule.sortPriority} onChange={event => updateRule(index, { sortPriority: Number(event.target.value) })} />
                                                        </Box>
                                                        <Box className='ptv-row-rule-cell'>
                                                            <TextField fullWidth select label='Tier' value={rule.tier} onChange={event => updateRule(index, { tier: Number(event.target.value) })}>
                                                                {ROW_TIERS.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                                            </TextField>
                                                        </Box>
                                                        <Box className='ptv-row-rule-cell'>
                                                            <TextField fullWidth select label='Presentation' value={rule.presentation} onChange={event => updateRule(index, { presentation: event.target.value as RowPresentation })}>
                                                                {ROW_PRESENTATIONS.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                                            </TextField>
                                                        </Box>
                                                        <Box className='ptv-row-rule-cell'>
                                                            <TextField fullWidth select label='Group Label' value={getGroupSelectValue(rule.groupTitle, rowGroups)} onChange={event => updateRule(index, { groupTitle: event.target.value })}>
                                                                <MenuItem value=''>Ungrouped</MenuItem>
                                                                {getGroupOptions(rowGroups, rule.groupTitle).map(groupTitle => <MenuItem key={groupTitle} value={groupTitle}>{groupTitle}</MenuItem>)}
                                                            </TextField>
                                                        </Box>
                                                        <Box className='ptv-row-rule-cell ptv-row-rule-actions'>
                                                            <Button color='error' variant='outlined' onClick={() => removeRule(index)}>Remove</Button>
                                                        </Box>
                                                    </Box>
                                                    {rule.sourceType === 'studio' && (
                                                        <Typography className='ptv-row-rule-inline-helper' variant='body2'>
                                                            {STUDIO_SOURCE_HELPER_TEXT}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            );
                                        })}
                                    </Stack>
                                </CardContent>
                            </Card>

                            <Grid container spacing={2}>
                                <Grid size={{ xs: 12, lg: 7 }}>
                                    <Card className='ptv-dashboard-card ptv-control-card'>
                                        <CardContent>
                                            <Stack spacing={1.5}>
                                                <Typography variant='h2'>Total Home Output Preview</Typography>
                                                <Stack direction='row' spacing={1} flexWrap='wrap'>
                                                    <Chip size='small' label={`Configured Preview: ${configuredPreviewRows.length}`} />
                                                    <Chip size='small' label={`Configured On Home: ${configuredHomePreviewRows.length}`} />
                                                    <Chip size='small' label={`Recommendation Rows: ${recommendationPreviewRows.length}`} />
                                                    <Chip size='small' label={`Total Home Output: ${homeOutputPreviewRows.length}`} color={homeOutputPreviewRows.length ? 'success' : 'default'} />
                                                </Stack>
                                                {!preview?.rows?.length && !recommendationPreviewRows.length && <Typography color='text.secondary'>No preview generated yet.</Typography>}
                                                {preview?.validation?.errors?.map(error => <Alert key={error} severity='error'>{error}</Alert>)}
                                                {preview?.validation?.warnings?.map(warning => <Alert key={warning} severity='warning'>{warning}</Alert>)}
                                                {!!configuredPreviewRows.length && !configuredRowsOnHomeEnabled && (
                                                    <>
                                                        <Alert severity='info'>Configured Row Builder rows are generating in settings, but hidden from Home until Row Builder is enabled.</Alert>
                                                        <Typography variant='h3'>Configured Row Builder Preview</Typography>
                                                        {configuredPreviewRows.map(row => (
                                                            <Box key={`configured-preview-${row.id}`} className='ptv-dashboard-list-row'>
                                                                <Stack direction='row' spacing={1} alignItems='center' flexWrap='wrap'>
                                                                    <Typography variant='h3'>{row.title}</Typography>
                                                                    <Chip size='small' label={`${row.itemCount} items`} color={row.itemCount ? 'success' : 'warning'} />
                                                                    <Chip size='small' label={row.mediaType || 'mixed'} />
                                                                    <Chip size='small' label={row.sourceType || 'source'} />
                                                                    <Chip size='small' label={row.rowType} />
                                                                    <Chip size='small' label={row.sourceId || 'source'} />
                                                                </Stack>
                                                            </Box>
                                                        ))}
                                                        <Divider />
                                                        <Typography variant='h3'>Home Output</Typography>
                                                    </>
                                                )}
                                                {homeOutputPreviewRows.map(row => (
                                                    <Box key={row.id} className='ptv-dashboard-list-row'>
                                                        <Stack direction='row' spacing={1} alignItems='center' flexWrap='wrap'>
                                                            <Typography variant='h3'>{row.title}</Typography>
                                                            <Chip size='small' label={`${row.itemCount} items`} color={row.itemCount ? 'success' : 'warning'} />
                                                            <Chip size='small' label={row.mediaType || 'mixed'} />
                                                            <Chip size='small' label={row.sourceType || 'source'} />
                                                            <Chip size='small' label={row.rowType} />
                                                            <Chip size='small' label={row.sourceId || 'source'} />
                                                        </Stack>
                                                    </Box>
                                                ))}
                                                {canShowDiagnostics && !!preview?.diagnostics?.length && (
                                                    <>
                                                        <Divider />
                                                        <Typography variant='h3'>Row Diagnostics</Typography>
                                                        {preview.diagnostics.slice(0, 16).map((diagnostic, index) => (
                                                            <Typography key={`${diagnostic.ruleId}-${diagnostic.searchTerm}-${index}`} variant='body2'>
                                                                {formatDiagnosticSummary(diagnostic)}
                                                            </Typography>
                                                        ))}
                                                    </>
                                                )}
                                            </Stack>
                                        </CardContent>
                                    </Card>
                                </Grid>

                            </Grid>
                        </>
                    )}
                </Stack>
            </Box>
        </section>
    );
};

export default PiggieTvRowsPage;
/* eslint-enable @stylistic/operator-linebreak, max-params, no-nested-ternary, react/jsx-no-bind, react/no-array-index-key, sonarjs/anchor-precedence, sonarjs/no-nested-conditional */
