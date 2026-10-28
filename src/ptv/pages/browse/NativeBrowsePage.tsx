import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import Page from 'components/Page';

import {
    getPtvCurrentUserId,
    getItemImageTag,
    getPtvItemImageCandidates,
    getPtvItemImageUrl,
    getPtvServerId,
    getPtvItems,
    getPtvResumeItems,
    getPtvItemFieldProfileDiagnostics,
    markPtvImageCandidateFailed,
    recordPtvImageFallback,
    serializePtvItemFieldProfile,
    type PtvItem,
    type PtvItemFieldProfileId,
    type PtvItemQuery
} from '../../api';
import { PTV_BRANDING, PTV_ROUTES } from '../../core/config';
import {
    recordPtvItemRouteClick,
    resolvePtvItemRoute
} from '../../core/itemRoutes';
import { recordPtvEvent, shouldCollectDiagnostics } from '../../core/observability';
import { focusPtvTvElement, notifyPtvTvFocusContentReady } from '../../core/tvFocus';
import PTVShell, { type PtvShellSection } from '../../shell/PTVShell';
import {
    getPtvRouteControllerState,
    navigatePtvRoute,
    registerPtvNativeRoute
} from '../../shell/routeController';
import { getPtvPerformanceProfile } from '../../core/clientProfile';
import { createPtvAbortController } from '../../core/abortController';
import { usePtvAdminDebugVisibility } from '../../utils/usePtvAdminDebugVisibility';
import {
    getPtvQualityPillClass,
    getPtvQualityTags
} from '../../modules/cards/qualityTags';
import { PtvIcon } from '../../modules/icons';
import { getPtvRecommendationHomeData } from '../../modules/recommendations';
import {
    getPtvBrowseFeaturedQueryOverrides,
    prioritizePtvBrowseTasks
} from './browseLoadingPolicy';
import {
    assertPtvBrowseLoadOwnerCurrent,
    createPtvBrowseCancellationError,
    getMissingPtvBrowseRetryTaskId,
    getPtvBrowseSettledCancellation,
    isPtvBrowseCancellation,
    isPtvBrowseLoadOwnerCurrent,
    recoverPtvBrowseRequestWithFallback,
    throwIfPtvBrowseCancelled
} from './browseReliability';
import {
    mergePtvBrowseShelfResult,
    preparePtvBrowseSectionsForRetry
} from './browseShelfState';
import {
    applyPtvBrowseScope,
    findExactPtvBrowseDirectoryEntry,
    getPtvBrowseScopeIdentityKey,
    getPtvBrowseScopedItems,
    isPtvBrowseScopeIdentityCurrent,
    loadPtvBrowseDirectory,
    loadPtvFocusedBrowsePages,
    resolvePtvBrowseScope,
    type PtvBrowseDirectoryEntry,
    type PtvBrowseResolvedScope
} from './browseData';
import {
    buildPtvBrowseHref,
    parsePtvBrowseRoute,
    type PtvBrowseRoute
} from './browseRoute';
import {
    getPtvFocusedBrowseDiagnosticLoaderKey,
    getPtvFocusedBrowseLoaderKey,
    PtvFocusedBrowseLoadOwner
} from './focusedBrowseLoader';
import BrowseDirectory from './BrowseDirectory';
import { selectPtvBrowseRecommendations } from './browseRecommendations';
import { usePtvBrowseBackdrop } from './usePtvBrowseBackdrop';

import './nativeBrowse.scss';

type PtvBrowseKind = 'collections' | 'movies' | 'shows';

type PtvBrowseConfig = Readonly<{
    browseTitle: string;
    collectionTitle: string;
    continueIncludeItemTypes: string;
    description: string;
    featuredTitle: string;
    genreFilter: string;
    icon: string;
    includeItemTypes: string;
    kind: PtvBrowseKind;
    recommendationsTitle: string;
    recentlyTitle: string;
    title: string;
}>;

type PtvBrowseSection = Readonly<{
    error: string;
    id: string;
    kicker: string;
    title: string;
    items: PtvItem[];
    status: 'empty' | 'error' | 'loading' | 'ready' | 'slow';
}>;

type PtvBrowseLandingTagSection = Readonly<{
    id: string;
    label: string;
    tag: string;
    tagId: string;
    type: 'genre' | 'studio';
}>;

type PtvBrowseLandingTagSelectionSummary = Readonly<{
    minItemCount: number;
    total: number;
    eligible: number;
    selected: string[];
    skippedUnderMinimum: string[];
}>;

type PtvBrowseLandingTagDebug = Readonly<{
    genre: PtvBrowseLandingTagSelectionSummary;
    studio: PtvBrowseLandingTagSelectionSummary;
}>;

type PtvBrowseDiagnostic = Readonly<{
    bytesPerItem: number;
    count: number;
    durationMs: number;
    error: string;
    fields: string;
    fieldProfileMismatchWarning: string;
    includeItemTypes: string;
    lateResultDiscarded: boolean;
    limit: number;
    normalizationDurationMs: number;
    payloadSize: number;
    requestedFieldCount: number;
    requestedFieldProfile: string;
    responseByteSize: number;
    route: string;
    rowId: string;
    requestUrl: string;
    section: string;
    status: 'error' | 'ready' | 'timeout';
    timeoutSource: 'hard' | 'none' | 'soft';
    timeoutReason: string;
    wasAborted: boolean;
}>;

type PtvBrowseRowNavState = Readonly<{
    canScrollLeft: boolean;
    canScrollRight: boolean;
    navButtonsMounted: boolean;
}>;

type PtvBrowseState = Readonly<{
    diagnostics: PtvBrowseDiagnostic[];
    error: string;
    heroItem: PtvItem | null;
    isLoading: boolean;
    sections: PtvBrowseSection[];
    tagSectionDebug: PtvBrowseLandingTagDebug;
    tags: {
        genres: string[];
        studios: string[];
    };
}>;

type PtvBrowseMemory = Readonly<{
    focusedItemId: string;
    focusedSectionId: string;
    lastFilter: string;
    scrollY: number;
    updatedAt: number;
}>;

const PTV_BROWSE_MEMORY_PREFIX = 'ptv:browse:memory:v1:';
const PTV_BROWSE_SOFT_TIMEOUT_MS = 5000;
const PTV_BROWSE_FEATURED_HARD_TIMEOUT_MS = 22000;
const PTV_BROWSE_ROW_HARD_TIMEOUT_MS = 26000;
const PTV_BROWSE_ROW_NAV_EPSILON = 2;
const PTV_BROWSE_EAGER_ROW_COUNT = 2;
const PTV_BROWSE_DEFERRED_ROW_ROOT_MARGIN = '900px 0px';
const PTV_BROWSE_RANDOM_TAG_SHELVES_COUNT = 4;
const PTV_BROWSE_TAG_SHELF_MIN_ITEM_COUNT = 12;

let browseMountedCardCount = 0;
let browsePeakMountedCardCount = 0;
let browseShelfMountCount = 0;
let browseShelfUnmountCount = 0;

function createPtvBrowseSeed(value: string) {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
}

function createPtvBrowseRandom(seed: number) {
    let state = seed >>> 0;

    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;

        return state / 0x100000000;
    };
}

function shufflePtvBrowseItems<T>(items: readonly T[], nextRandom: () => number = Math.random) {
    const shuffledItems = [...items];

    for (let index = shuffledItems.length - 1; index > 0; index -= 1) {
        const next = Math.max(0, Math.min(index, Math.floor(nextRandom() * (index + 1))));
        const candidate = shuffledItems[index];
        shuffledItems[index] = shuffledItems[next];
        shuffledItems[next] = candidate;
    }

    return shuffledItems;
}

function getPtvBrowseSectionSeed(route: PtvBrowseRoute, scope: PtvBrowseResolvedScope) {
    return createPtvBrowseSeed(`${route.kind}|${route.scopeAlias || ''}|${scope.alias}|${scope.libraryIds.join(',')}`);
}

function slugPtvBrowseSection(value: string) {
    const normalized = getText(value).toLowerCase();

    return normalized
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-+/g, '-');
}

function buildPtvBrowseLandingTagSectionId(type: 'genre' | 'studio', index: number, tag: string) {
    const prefix = type === 'genre' ? 'genre' : 'studio';
    const fallback = String(index + 1);

    return `${prefix}-${slugPtvBrowseSection(tag) || fallback}-${index + 1}`;
}

function getBrowseFieldProfileForSection(section: string): PtvItemFieldProfileId {
    if (section === 'collections') return 'COLLECTION_FIELDS';
    if (section === 'featured') return 'HERO_FIELDS';

    return 'CARD_FIELDS';
}

function getBrowseFieldsForSection(section: string) {
    return serializePtvItemFieldProfile(getBrowseFieldProfileForSection(section));
}

function getBrowseImageTypesForSection(section: string) {
    if (section === 'featured') return 'Primary,Backdrop,Thumb,Logo';

    return 'Primary';
}

function getSerializedPayloadSize(value: unknown) {
    try {
        return JSON.stringify(value).length;
    } catch {
        return 0;
    }
}

const EMPTY_BROWSE_STATE: PtvBrowseState = {
    diagnostics: [],
    error: '',
    heroItem: null,
    isLoading: true,
    sections: [],
    tagSectionDebug: {
        genre: {
            minItemCount: PTV_BROWSE_TAG_SHELF_MIN_ITEM_COUNT,
            eligible: 0,
            skippedUnderMinimum: [],
            selected: [],
            total: 0
        },
        studio: {
            minItemCount: PTV_BROWSE_TAG_SHELF_MIN_ITEM_COUNT,
            eligible: 0,
            skippedUnderMinimum: [],
            selected: [],
            total: 0
        }
    },
    tags: {
        genres: [],
        studios: []
    }
};

const EMPTY_BROWSE_MEMORY: PtvBrowseMemory = {
    focusedItemId: '',
    focusedSectionId: '',
    lastFilter: '',
    scrollY: 0,
    updatedAt: 0
};
const PTV_BROWSE_SKELETON_KEYS = [
    'browse-skeleton-1',
    'browse-skeleton-2',
    'browse-skeleton-3',
    'browse-skeleton-4',
    'browse-skeleton-5',
    'browse-skeleton-6',
    'browse-skeleton-7',
    'browse-skeleton-8'
];

function getPtvBrowseRowNavState(row: HTMLElement | null): PtvBrowseRowNavState {
    if (!row) {
        return {
            canScrollLeft: false,
            canScrollRight: false,
            navButtonsMounted: false
        };
    }

    const maxScrollLeft = Math.max(0, row.scrollWidth - row.clientWidth);
    const navButtonsMounted = maxScrollLeft > PTV_BROWSE_ROW_NAV_EPSILON;

    return {
        canScrollLeft: navButtonsMounted && row.scrollLeft > PTV_BROWSE_ROW_NAV_EPSILON,
        canScrollRight: navButtonsMounted && row.scrollLeft < maxScrollLeft - PTV_BROWSE_ROW_NAV_EPSILON,
        navButtonsMounted
    };
}

function arePtvBrowseRowNavStatesEqual(a: PtvBrowseRowNavState, b: PtvBrowseRowNavState) {
    return a.canScrollLeft === b.canScrollLeft
        && a.canScrollRight === b.canScrollRight
        && a.navButtonsMounted === b.navButtonsMounted;
}

class PtvBrowseTimeoutError extends Error {
    timeoutMs: number;

    constructor(section: string, timeoutMs: number) {
        super(`${section} timed out after ${timeoutMs}ms`);
        this.name = 'PtvBrowseTimeoutError';
        this.timeoutMs = timeoutMs;
    }
}

function getPtvBrowseMemoryKey(pathname: string, search: string) {
    return `${PTV_BROWSE_MEMORY_PREFIX}${pathname}${search}`;
}

function loadPtvBrowseMemory(key: string): PtvBrowseMemory {
    try {
        const raw = window.localStorage?.getItem(key);
        const parsed = raw ? JSON.parse(raw) as Partial<PtvBrowseMemory> : {};

        return {
            focusedItemId: typeof parsed.focusedItemId === 'string' ? parsed.focusedItemId : '',
            focusedSectionId: typeof parsed.focusedSectionId === 'string' ? parsed.focusedSectionId : '',
            lastFilter: typeof parsed.lastFilter === 'string' ? parsed.lastFilter : '',
            scrollY: typeof parsed.scrollY === 'number' && Number.isFinite(parsed.scrollY) ? parsed.scrollY : 0,
            updatedAt: typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0
        };
    } catch {
        return EMPTY_BROWSE_MEMORY;
    }
}

function savePtvBrowseMemory(key: string, memory: PtvBrowseMemory) {
    try {
        window.localStorage?.setItem(key, JSON.stringify(memory));
    } catch {
        // Memory is a polish feature; storage failures should not affect browsing.
    }
}

function getText(value: unknown) {
    return typeof value === 'string' ? value : '';
}

function getNumber(value: unknown) {
    const parsed = typeof value === 'number' ? value : Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
}

function getArrayText(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return value
        .map(entry => {
            if (typeof entry === 'string') return entry;
            if (entry && typeof entry === 'object') {
                return getText((entry as Record<string, unknown>).Name || (entry as Record<string, unknown>).name);
            }

            return '';
        })
        .filter(Boolean);
}

function getPtvBrowseConfig(pathname: string, parentHintValue: string): PtvBrowseConfig {
    const parentHint = parentHintValue.toLowerCase();

    if (pathname.includes('collections')) {
        return {
            browseTitle: 'Browse Collections',
            collectionTitle: 'Collection Hubs',
            continueIncludeItemTypes: 'Movie,Series,Episode',
            description: 'Curated sets, franchises, and watch paths.',
            featuredTitle: 'Featured Collections',
            genreFilter: '',
            icon: 'collections',
            includeItemTypes: 'BoxSet',
            kind: 'collections',
            recommendationsTitle: 'Recommended Collections',
            recentlyTitle: 'Recently Added Collections',
            title: 'Collections'
        };
    }

    if (pathname.includes('shows') || pathname.includes('tv')) {
        if (parentHint === 'anime') {
            return {
                browseTitle: 'Browse Anime',
                collectionTitle: 'Anime Collections',
                continueIncludeItemTypes: 'Episode,Series',
                description: 'Series, seasons, and episodes from your anime library.',
                featuredTitle: 'Featured Anime',
                genreFilter: '',
                icon: 'anime',
                includeItemTypes: 'Series',
                kind: 'shows',
                recommendationsTitle: 'Recommended Anime',
                recentlyTitle: 'Recently Added Anime',
                title: 'Anime'
            };
        }

        if (parentHint === 'cartoons') {
            return {
                browseTitle: 'Browse Cartoons',
                collectionTitle: 'Cartoon Collections',
                continueIncludeItemTypes: 'Episode,Series',
                description: 'Animated series, comfort shows, and weekend cartoons.',
                featuredTitle: 'Featured Cartoons',
                genreFilter: '',
                icon: 'cartoons',
                includeItemTypes: 'Series',
                kind: 'shows',
                recommendationsTitle: 'Recommended Cartoons',
                recentlyTitle: 'Recently Added Cartoons',
                title: 'Cartoons'
            };
        }

        return {
            browseTitle: 'Browse Shows',
            collectionTitle: 'Show Collections',
            continueIncludeItemTypes: 'Episode,Series',
            description: 'Series, next-up episodes, genres, studios, and discovery shelves.',
            featuredTitle: 'Featured Shows',
            genreFilter: '',
            icon: 'shows',
            includeItemTypes: 'Series',
            kind: 'shows',
            recommendationsTitle: 'Recommended Shows',
            recentlyTitle: 'Recently Added Shows',
            title: 'Shows'
        };
    }

    if (parentHint === 'animemovies') {
        return {
            browseTitle: 'Browse AniMovies',
            collectionTitle: 'Anime Movie Collections',
            continueIncludeItemTypes: 'Movie',
            description: 'Anime films, specials, and cinematic picks.',
            featuredTitle: 'Featured AniMovies',
            genreFilter: '',
            icon: 'animeMovies',
            includeItemTypes: 'Movie',
            kind: 'movies',
            recommendationsTitle: 'Recommended AniMovies',
            recentlyTitle: 'Recently Added AniMovies',
            title: 'AniMovies'
        };
    }

    return {
        browseTitle: 'Browse Movies',
        collectionTitle: 'Movie Collections',
        continueIncludeItemTypes: 'Movie',
        description: 'Movies, studios, genres, collections, and discovery shelves.',
        featuredTitle: 'Featured Movies',
        genreFilter: '',
        icon: 'movies',
        includeItemTypes: 'Movie',
        kind: 'movies',
        recommendationsTitle: 'Recommended Movies',
        recentlyTitle: 'Recently Added Movies',
        title: 'Movies'
    };
}

function getPtvBrowseShellSection(config: PtvBrowseConfig): PtvShellSection {
    if (config.title === 'AniMovies' || config.title === 'Anime') return 'anime';
    if (config.title === 'Cartoons') return 'cartoons';
    if (config.kind === 'collections') return 'collections';

    return config.kind;
}

function getPtvBrowseLibraryTitle(config: PtvBrowseConfig, route: PtvBrowseRoute) {
    if (route.kind === 'movies' && route.scopeAlias === 'animemovies') return 'AniMovies library';
    if (route.kind === 'shows' && route.scopeAlias === 'anime') return 'Anime library';
    if (route.kind === 'shows' && route.scopeAlias === 'cartoons') return 'Cartoons library';

    if (route.kind === 'movies') return 'Movies Library';
    if (route.kind === 'shows') return 'Shows Library';

    return config.title;
}

function getBaseQuery(
    config: PtvBrowseConfig,
    overrides: PtvItemQuery = {},
    section = 'default',
    scope?: PtvBrowseResolvedScope
): PtvItemQuery {
    const query: PtvItemQuery = {
        EnableTotalRecordCount: false,
        EnableImages: true,
        EnableImageTypes: getBrowseImageTypesForSection(section),
        Fields: getBrowseFieldsForSection(section),
        ImageTypeLimit: 1,
        IncludeItemTypes: config.includeItemTypes,
        Limit: 20,
        Recursive: true,
        ...overrides
    };

    if (config.genreFilter) {
        query.Genres = config.genreFilter;
    }

    return scope ? applyPtvBrowseScope(query, scope) : query;
}

function dedupeBrowseItems(items: PtvItem[]) {
    const seen = new Set<string>();

    return items.filter(item => {
        const id = getText(item.Id);

        if (!id || seen.has(id)) return false;

        seen.add(id);
        return true;
    });
}

function getBrowseItemYear(item: PtvItem) {
    const year = getNumber(item.ProductionYear);

    if (year) return String(year);

    const premiereDate = getText(item.PremiereDate);

    return premiereDate ? premiereDate.slice(0, 4) : '';
}

function getBrowseItemTypeLabel(item: PtvItem) {
    const itemType = getText(item.Type);

    if (itemType === 'BoxSet') return 'Collection';
    if (itemType === 'Series') return 'Series';
    if (itemType === 'Episode') return 'Episode';
    if (itemType === 'Movie') return 'Movie';

    return itemType || 'Item';
}

function getBrowseMetadata(item: PtvItem) {
    return [
        getBrowseItemYear(item),
        getBrowseItemTypeLabel(item),
        getText(item.OfficialRating)
    ].filter(Boolean).join(' | ');
}

function hasBrowseLogoImage(item: PtvItem | null | undefined): boolean {
    if (!item) return false;

    const logoTag = getItemImageTag(item, 'Logo');
    const parentLogoItemId = getText(item.ParentLogoItemId) || getText((item as Record<string, unknown>).parentLogoItemId);

    return Boolean(logoTag || parentLogoItemId);
}

function isPreferredHeroItemType(item: PtvItem, config?: PtvBrowseConfig): boolean {
    const type = getText(item.Type);

    if (!type) return true;
    if (config?.kind === 'shows') {
        return type === 'Series' || type === 'BoxSet';
    }
    if (config?.kind === 'movies') {
        return type === 'Movie' || type === 'BoxSet';
    }
    if (config?.kind === 'collections') {
        return type === 'BoxSet';
    }

    return type !== 'Episode';
}

function getHeroItemScore(item: PtvItem, config?: PtvBrowseConfig): number {
    let score = 0;
    const type = getText(item.Type);

    if (isPreferredHeroItemType(item, config)) {
        score += 1000;
    } else if (type === 'Episode') {
        score -= 500;
    }

    const hasBackdrop = Boolean(
        (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags.length)
        || item.BackdropImageTag
        || item.ParentBackdropImageTag
        || item.ParentBackdropItemId
        || item.BackdropItemId
    );
    if (hasBackdrop) score += 200;

    if (hasBrowseLogoImage(item)) score += 100;
    if (getText(item.Overview)) score += 50;

    return score;
}

function findPtvBrowseHeroItem(items: PtvItem[] | undefined, config?: PtvBrowseConfig): PtvItem | null {
    if (!items || !items.length) return null;

    let bestItem: PtvItem | null = null;
    let bestScore = -Infinity;

    for (const item of items) {
        const score = getHeroItemScore(item, config);
        if (score > bestScore) {
            bestScore = score;
            bestItem = item;
        }
    }

    return bestItem;
}

function selectPtvBrowseHeroItem(
    currentHero: PtvItem | null,
    sectionId: string,
    items: PtvItem[],
    config: PtvBrowseConfig
): PtvItem | null {
    const candidate = findPtvBrowseHeroItem(items, config);

    if (!candidate) return currentHero;
    if (!currentHero) return candidate;

    const currentIsEpisode = getText(currentHero.Type) === 'Episode';
    const candidateIsPreferred = isPreferredHeroItemType(candidate, config);

    if (currentIsEpisode && candidateIsPreferred) {
        return candidate;
    }

    if (sectionId === 'featured' && candidateIsPreferred) {
        return candidate;
    }

    const currentScore = getHeroItemScore(currentHero, config);
    const candidateScore = getHeroItemScore(candidate, config);

    if (candidateScore > currentScore + 100) {
        return candidate;
    }

    return currentHero;
}

function getBrowseBackdropImage(item: PtvItem | null) {
    if (!item) return '';
    const performanceProfile = getPtvPerformanceProfile();

    return getPtvItemImageUrl(item, {
        serverId: getPtvServerId() || undefined,
        imageType: 'Backdrop',
        maxWidth: performanceProfile.heroBackdropMaxWidth,
        quality: 88
    });
}

function getBrowseLogoImage(item: PtvItem | null) {
    if (!item || !hasBrowseLogoImage(item)) return '';
    const performanceProfile = getPtvPerformanceProfile();

    return getPtvItemImageUrl(item, {
        serverId: getPtvServerId() || undefined,
        imageType: 'Logo',
        maxWidth: Math.min(520, performanceProfile.rowPrimaryMaxWidth),
        quality: 92
    });
}

function getBrowseRoute(item: PtvItem) {
    return resolvePtvItemRoute(item, {
        fallbackHref: `#/details?id=${encodeURIComponent(getText(item.Id))}`,
        source: 'ptv-browse'
    });
}

function getDistinctTags(items: PtvItem[], key: 'Genres' | 'Studios') {
    const counts = new Map<string, number>();

    items.forEach(item => {
        getArrayText(item[key]).forEach(tag => {
            counts.set(tag, (counts.get(tag) || 0) + 1);
        });
    });

    return [...counts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([tag]) => tag)
        .slice(0, 18);
}

function getPtvBrowseLandingTagSections(
    config: PtvBrowseConfig,
    directories: PtvBrowseDirectoryEntry[],
    type: 'genre' | 'studio',
    nextRandom: () => number,
    maxCount: number
): PtvBrowseLandingTagSection[] {
    const eligibleDirectories = directories.filter(entry => entry.count >= PTV_BROWSE_TAG_SHELF_MIN_ITEM_COUNT);

    if (!eligibleDirectories.length || maxCount <= 0) return [];

    const label = type === 'genre' ? 'Genre' : (config.kind === 'shows' ? 'Studio / Network' : 'Studio');
    const rows = shufflePtvBrowseItems(eligibleDirectories, nextRandom)
        .slice(0, Math.min(maxCount, eligibleDirectories.length));

    return rows.map((entry, index) => ({
        id: buildPtvBrowseLandingTagSectionId(type, index, entry.name),
        label,
        tag: entry.name,
        tagId: entry.id,
        type
    })).filter(section => section.tag);
}

function getPtvBrowseLandingTagSectionSummary(
    directories: PtvBrowseDirectoryEntry[],
    sections: readonly PtvBrowseLandingTagSection[],
    minItemCount: number
): PtvBrowseLandingTagSelectionSummary {
    const directoryByTag = new Map<string, number>(directories.map(directory => [directory.name, directory.count]));
    const selected = sections
        .map(section => `${section.tag} (${directoryByTag.get(section.tag) || 0})`)
        .slice(0, PTV_BROWSE_RANDOM_TAG_SHELVES_COUNT);

    const skippedUnderMinimum = directories
        .filter(entry => entry.count > 0 && entry.count < minItemCount)
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
        .slice(0, PTV_BROWSE_RANDOM_TAG_SHELVES_COUNT * 2)
        .map(entry => `${entry.name} (${entry.count})`);

    return {
        eligible: directories.filter(entry => entry.count >= minItemCount).length,
        minItemCount,
        selected,
        skippedUnderMinimum,
        total: directories.length
    };
}

function getEmptyPtvBrowseLandingTagSectionSummary(minItemCount: number): PtvBrowseLandingTagSelectionSummary {
    return {
        eligible: 0,
        minItemCount,
        selected: [],
        skippedUnderMinimum: [],
        total: 0
    };
}

function getEmptyPtvBrowseLandingTagDebug(minItemCount: number): PtvBrowseLandingTagDebug {
    return {
        genre: getEmptyPtvBrowseLandingTagSectionSummary(minItemCount),
        studio: getEmptyPtvBrowseLandingTagSectionSummary(minItemCount)
    };
}

function getPtvBrowseLandingTagSectionQuery(
    config: PtvBrowseConfig,
    scope: PtvBrowseResolvedScope,
    section: PtvBrowseLandingTagSection
) {
    const hasTagId = Boolean(section.tagId);
    const genreFilters = hasTagId ?
        { GenreIds: section.tagId, Genres: section.tag } :
        { Genres: section.tag };
    const studioFilters = hasTagId ?
        { StudioIds: section.tagId, Studios: section.tag } :
        { Studios: section.tag };
    const sectionOverrides = section.type === 'genre' ? {
        ...genreFilters,
        Limit: 20,
        SortBy: 'SortName',
        SortOrder: 'Ascending'
    } : {
        ...studioFilters,
        Limit: 20,
        SortBy: 'SortName',
        SortOrder: 'Ascending'
    };

    return getBaseQuery(config, sectionOverrides, section.id, scope);
}

function getBrowseRequestUrl(query: PtvItemQuery) {
    const userId = getPtvCurrentUserId();

    if (!userId) return '';

    return `GET /Users/{user}/Items (${String(query.IncludeItemTypes || 'items')}, limit=${Number(query.Limit || 0)})`;
}

function getBrowseFieldDiagnostics(section: string, query: PtvItemQuery, itemCount: number, payloadSize: number) {
    const requestedFieldProfile = getBrowseFieldProfileForSection(section);
    const profileDiagnostics = getPtvItemFieldProfileDiagnostics(requestedFieldProfile);
    const fields = String(query.Fields || '');
    const isCardRow = requestedFieldProfile === 'CARD_FIELDS';
    const fieldProfileMismatchWarning = isCardRow && /(?:^|,)(?:MediaSources|MediaStreams|Overview|Path|People|ProviderIds|Studios|Tags)(?:,|$)/i.test(fields) ?
        'Card row requested detail/playback fields.' :
        '';

    return {
        bytesPerItem: itemCount ? Number((payloadSize / itemCount).toFixed(1)) : 0,
        fieldProfileMismatchWarning,
        requestedFieldCount: profileDiagnostics.fieldCount,
        requestedFieldProfile,
        responseByteSize: payloadSize,
        route: window.location.hash || window.location.pathname,
        rowId: section
    };
}

function createPtvBrowseMissingRetryDiagnostic(section: string): PtvBrowseDiagnostic {
    const error = 'This shelf is no longer available for the current browse route.';

    return {
        ...getBrowseFieldDiagnostics(section, {}, 0, 0),
        count: 0,
        durationMs: 0,
        error,
        fields: '',
        includeItemTypes: '',
        lateResultDiscarded: false,
        limit: 0,
        normalizationDurationMs: 0,
        payloadSize: 0,
        requestUrl: 'browse-directory',
        section,
        status: 'error',
        timeoutReason: '',
        timeoutSource: 'none',
        wasAborted: false
    };
}

function withBrowseHardTimeout<T>(
    task: (signal: AbortSignal) => Promise<T>,
    section: string,
    timeoutMs: number,
    parentSignal?: AbortSignal,
    onLateResult?: (status: 'error' | 'success') => void
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const requestController = createPtvAbortController();
        const createAbortError = () => {
            const error = new Error(`${section} request was cancelled.`);

            error.name = 'AbortError';
            return error;
        };
        const cleanup = () => {
            window.clearTimeout(timeout);
            parentSignal?.removeEventListener('abort', onParentAbort);
        };
        const onParentAbort = () => {
            if (settled) return;

            settled = true;
            requestController.abort();
            cleanup();
            reject(createAbortError());
        };
        const timeout = window.setTimeout(() => {
            if (settled) return;

            settled = true;
            requestController.abort();
            cleanup();
            reject(new PtvBrowseTimeoutError(section, timeoutMs));
        }, timeoutMs);
        const promise = parentSignal?.aborted ?
            Promise.reject(createAbortError()) :
            task(requestController.signal);

        parentSignal?.addEventListener('abort', onParentAbort, { once: true });

        promise.then(
            value => {
                if (settled) {
                    onLateResult?.('success');
                    return;
                }

                settled = true;
                cleanup();
                resolve(value);
            },
            error => {
                if (settled) {
                    onLateResult?.('error');
                    return;
                }

                settled = true;
                cleanup();
                reject(error);
            }
        );
    });
}

async function fetchBrowseItems(section: string, query: PtvItemQuery, signal?: AbortSignal, scope?: PtvBrowseResolvedScope): Promise<{
    diagnostic: PtvBrowseDiagnostic;
    items: PtvItem[];
}> {
    const startedAt = performance.now();
    const requestUrl = getBrowseRequestUrl(query);
    const timeoutMs = section === 'featured' ? PTV_BROWSE_FEATURED_HARD_TIMEOUT_MS : PTV_BROWSE_ROW_HARD_TIMEOUT_MS;
    let lateResultDiscarded = false;
    const startedFieldDiagnostics = getBrowseFieldDiagnostics(section, query, 0, 0);

    recordPtvEvent('api', 'ptv-browse-row-request-started', {
        ...startedFieldDiagnostics,
        fields: query.Fields || '',
        includeItemTypes: query.IncludeItemTypes || '',
        limit: query.Limit || 0,
        requestUrl,
        softTimeoutMs: PTV_BROWSE_SOFT_TIMEOUT_MS,
        timeoutMs
    });

    try {
        const result = await withBrowseHardTimeout(
            requestSignal => scope ? getPtvBrowseScopedItems(query, scope, requestSignal) : getPtvItems<PtvItem>(query, { signal: requestSignal }),
            section,
            timeoutMs,
            signal,
            () => {
                lateResultDiscarded = true;
            }
        );
        const normalizeStartedAt = performance.now();
        const items = dedupeBrowseItems(result.Items || []);
        const normalizationDurationMs = Number((performance.now() - normalizeStartedAt).toFixed(1));
        const durationMs = Number((performance.now() - startedAt).toFixed(1));
        const payloadSize = getSerializedPayloadSize(result);
        const timeoutSource = durationMs > PTV_BROWSE_SOFT_TIMEOUT_MS ? 'soft' : 'none';
        const fieldDiagnostics = getBrowseFieldDiagnostics(section, query, items.length, payloadSize);

        recordPtvEvent('api', 'ptv-browse-row-request-complete', {
            ...fieldDiagnostics,
            durationMs,
            fields: query.Fields || '',
            includeItemTypes: query.IncludeItemTypes || '',
            itemCount: items.length,
            limit: query.Limit || 0,
            normalizationDurationMs,
            payloadSize,
            requestUrl,
            timeoutSource,
            totalRecordCount: result.TotalRecordCount ?? items.length
        });

        return {
            diagnostic: {
                ...fieldDiagnostics,
                count: items.length,
                durationMs,
                error: '',
                fields: query.Fields || '',
                includeItemTypes: query.IncludeItemTypes || '',
                lateResultDiscarded,
                limit: Number(query.Limit || 0),
                normalizationDurationMs,
                payloadSize,
                requestUrl,
                section,
                status: 'ready',
                timeoutReason: timeoutSource === 'soft' ? `${section} exceeded soft warning after ${PTV_BROWSE_SOFT_TIMEOUT_MS}ms.` : '',
                timeoutSource,
                wasAborted: false
            },
            items
        };
    } catch (error) {
        throwIfPtvBrowseCancelled(error, signal);

        const isTimeout = error instanceof PtvBrowseTimeoutError;
        const message = error instanceof Error ? error.message : 'Browse row failed';
        const durationMs = Number((performance.now() - startedAt).toFixed(1));
        const fieldDiagnostics = getBrowseFieldDiagnostics(section, query, 0, 0);

        recordPtvEvent('api', 'ptv-browse-row-request-failed', {
            ...fieldDiagnostics,
            durationMs,
            exceptionMessage: message,
            exceptionName: error instanceof Error ? error.name : 'UnknownError',
            fields: query.Fields || '',
            includeItemTypes: query.IncludeItemTypes || '',
            limit: query.Limit || 0,
            requestUrl,
            status: isTimeout ? 'timeout' : 'error'
        });

        return {
            diagnostic: {
                ...fieldDiagnostics,
                count: 0,
                durationMs,
                error: message,
                fields: query.Fields || '',
                includeItemTypes: query.IncludeItemTypes || '',
                lateResultDiscarded,
                limit: Number(query.Limit || 0),
                normalizationDurationMs: 0,
                payloadSize: 0,
                requestUrl,
                section,
                status: isTimeout ? 'timeout' : 'error',
                timeoutReason: isTimeout ? message : '',
                timeoutSource: isTimeout ? 'hard' : 'none',
                wasAborted: isTimeout
            },
            items: []
        };
    }
}

async function fetchBrowseRecommendations(config: PtvBrowseConfig, scope: PtvBrowseResolvedScope, signal?: AbortSignal): Promise<{
    diagnostic: PtvBrowseDiagnostic;
    items: PtvItem[];
}> {
    const startedAt = performance.now();
    const requestUrl = 'recommendations/engine/getPtvRecommendationHomeData';
    let lateResultDiscarded = false;
    const timeoutMs = PTV_BROWSE_ROW_HARD_TIMEOUT_MS;
    const fallbackQuery = getBaseQuery(config, {
        Limit: 20,
        SortBy: 'Random'
    }, 'recommendations', scope);
    // Global rank/cache data is never library-membership evidence. This ordinary
    // ParentId read is also the only permitted fallback; do not use Ids+ParentId.
    const scopedResult = await fetchBrowseItems('recommendations', fallbackQuery, signal, scope);
    if (scopedResult.diagnostic.status !== 'ready' || !scopedResult.items.length) return scopedResult;
    const fallback = () => Promise.resolve(scopedResult);

    const userId = getPtvCurrentUserId();

    if (!userId) return fallback();

    try {
        const result = await withBrowseHardTimeout(
            requestSignal => getPtvRecommendationHomeData({ signal: requestSignal }),
            'recommendations',
            timeoutMs,
            signal,
            () => {
                lateResultDiscarded = true;
            }
        );
        const items = selectPtvBrowseRecommendations(config.kind, result.candidates, scopedResult.items);

        if (!items.length) return fallback();

        const durationMs = Number((performance.now() - startedAt).toFixed(1));
        const payloadSize = getSerializedPayloadSize(result);
        const timeoutSource = durationMs > PTV_BROWSE_SOFT_TIMEOUT_MS ? 'soft' : 'none';
        const fieldDiagnostics = getBrowseFieldDiagnostics('recommendations', fallbackQuery, items.length, payloadSize);

        return {
            diagnostic: {
                ...fieldDiagnostics,
                count: items.length,
                durationMs,
                error: '',
                fields: fallbackQuery.Fields || '',
                includeItemTypes: fallbackQuery.IncludeItemTypes || '',
                lateResultDiscarded,
                limit: Number(fallbackQuery.Limit || 0),
                normalizationDurationMs: 0,
                payloadSize,
                requestUrl,
                section: 'recommendations',
                status: 'ready',
                timeoutReason: timeoutSource === 'soft' ? `recommendations exceeded soft warning after ${PTV_BROWSE_SOFT_TIMEOUT_MS}ms.` : '',
                timeoutSource,
                wasAborted: false
            },
            items
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Browse row failed';
        const fallbackResult = await recoverPtvBrowseRequestWithFallback(error, fallback, signal);

        if (fallbackResult.items.length && fallbackResult.diagnostic.status === 'ready') {
            return fallbackResult;
        }

        return {
            ...fallbackResult,
            diagnostic: {
                ...fallbackResult.diagnostic,
                status: 'error',
                error: message,
                requestUrl
            }
        };
    }
}

async function fetchBrowseResumeItems(section: string, query: PtvItemQuery, signal?: AbortSignal, scope?: PtvBrowseResolvedScope): Promise<{
    diagnostic: PtvBrowseDiagnostic;
    items: PtvItem[];
}> {
    const startedAt = performance.now();
    const requestUrl = getBrowseRequestUrl(query);
    const timeoutMs = PTV_BROWSE_ROW_HARD_TIMEOUT_MS;
    let lateResultDiscarded = false;
    const startedFieldDiagnostics = getBrowseFieldDiagnostics(section, query, 0, 0);

    recordPtvEvent('api', 'ptv-browse-row-request-started', {
        ...startedFieldDiagnostics,
        fields: query.Fields || '',
        includeItemTypes: query.IncludeItemTypes || '',
        limit: query.Limit || 0,
        requestUrl,
        softTimeoutMs: PTV_BROWSE_SOFT_TIMEOUT_MS,
        timeoutMs
    });

    try {
        const result = await withBrowseHardTimeout(
            requestSignal => scope ? getPtvBrowseScopedItems(query, scope, requestSignal, true) : getPtvResumeItems<PtvItem>(query, { signal: requestSignal }),
            section,
            timeoutMs,
            signal,
            () => {
                lateResultDiscarded = true;
            }
        );
        const normalizeStartedAt = performance.now();
        const items = dedupeBrowseItems(result.Items || []);
        const normalizationDurationMs = Number((performance.now() - normalizeStartedAt).toFixed(1));
        const durationMs = Number((performance.now() - startedAt).toFixed(1));
        const payloadSize = getSerializedPayloadSize(result);
        const timeoutSource = durationMs > PTV_BROWSE_SOFT_TIMEOUT_MS ? 'soft' : 'none';
        const fieldDiagnostics = getBrowseFieldDiagnostics(section, query, items.length, payloadSize);

        recordPtvEvent('api', 'ptv-browse-row-request-complete', {
            ...fieldDiagnostics,
            durationMs,
            fields: query.Fields || '',
            includeItemTypes: query.IncludeItemTypes || '',
            itemCount: items.length,
            limit: query.Limit || 0,
            normalizationDurationMs,
            payloadSize,
            requestUrl,
            timeoutSource,
            totalRecordCount: result.TotalRecordCount ?? items.length
        });

        return {
            diagnostic: {
                ...fieldDiagnostics,
                count: items.length,
                durationMs,
                error: '',
                fields: query.Fields || '',
                includeItemTypes: query.IncludeItemTypes || '',
                lateResultDiscarded,
                limit: Number(query.Limit || 0),
                normalizationDurationMs,
                payloadSize,
                requestUrl,
                section,
                status: 'ready',
                timeoutReason: timeoutSource === 'soft' ? `${section} exceeded soft warning after ${PTV_BROWSE_SOFT_TIMEOUT_MS}ms.` : '',
                timeoutSource,
                wasAborted: false
            },
            items
        };
    } catch (error) {
        throwIfPtvBrowseCancelled(error, signal);

        const isTimeout = error instanceof PtvBrowseTimeoutError;
        const message = error instanceof Error ? error.message : 'Browse row failed';
        const durationMs = Number((performance.now() - startedAt).toFixed(1));
        const fieldDiagnostics = getBrowseFieldDiagnostics(section, query, 0, 0);

        recordPtvEvent('api', 'ptv-browse-row-request-failed', {
            ...fieldDiagnostics,
            durationMs,
            exceptionMessage: message,
            exceptionName: error instanceof Error ? error.name : 'UnknownError',
            fields: query.Fields || '',
            includeItemTypes: query.IncludeItemTypes || '',
            limit: query.Limit || 0,
            requestUrl,
            status: isTimeout ? 'timeout' : 'error'
        });

        return {
            diagnostic: {
                ...fieldDiagnostics,
                count: 0,
                durationMs,
                error: message,
                fields: query.Fields || '',
                includeItemTypes: query.IncludeItemTypes || '',
                lateResultDiscarded,
                limit: Number(query.Limit || 0),
                normalizationDurationMs: 0,
                payloadSize: 0,
                requestUrl,
                section,
                status: isTimeout ? 'timeout' : 'error',
                timeoutReason: isTimeout ? message : '',
                timeoutSource: isTimeout ? 'hard' : 'none',
                wasAborted: isTimeout
            },
            items: []
        };
    }
}

function makeSection(id: string, title: string, kicker: string, items: PtvItem[], isLoading = false, error = ''): PtvBrowseSection {
    return {
        error,
        id,
        items,
        kicker,
        status: error ? 'error' : isLoading ? 'loading' : items.length ? 'ready' : 'empty',
        title
    };
}

function getInitialSections(config: PtvBrowseConfig, featuredItems: PtvItem[], dynamicSections: readonly PtvBrowseLandingTagSection[] = []): PtvBrowseSection[] {
    const baseSections = [
        makeSection('featured', config.featuredTitle, 'Featured', featuredItems),
        makeSection('continue', 'Continue', 'Pick up where you left off', [], true),
        makeSection('recommendations', config.recommendationsTitle, 'Recommended', [], true)
    ];

    if (config.kind === 'collections') {
        return [
            ...baseSections,
            makeSection('recently-added', config.recentlyTitle, 'Recently Added', [], true),
            makeSection('browse', config.browseTitle, 'Browse', [], true),
            makeSection('collections', config.collectionTitle, 'Collections', [], true)
        ];
    }

    return [
        ...baseSections,
        ...dynamicSections.map(section => makeSection(section.id, section.tag, section.label, [], true))
    ];
}

function getBrowseShelfFailureMessage(section: PtvBrowseSection) {
    return `${section.title} couldn't be loaded.`;
}

function getBrowseShelfFailureDetail(section: PtvBrowseSection) {
    return section.error || 'The shelf request failed.';
}

function getCompleteSections(
    config: PtvBrowseConfig,
    featuredItems: PtvItem[],
    resumeItems: PtvItem[],
    recommendationItems: PtvItem[],
    dynamicSections: readonly PtvBrowseLandingTagSection[] = [],
    recentlyAddedItems: PtvItem[],
    browseItems: PtvItem[],
    collectionItems: PtvItem[]
): PtvBrowseSection[] {
    const baseSections = [
        makeSection('featured', config.featuredTitle, 'Featured', featuredItems),
        makeSection('continue', 'Continue', 'Pick up where you left off', resumeItems),
        makeSection('recommendations', config.recommendationsTitle, 'Recommendations', recommendationItems)
    ];

    if (config.kind === 'collections') {
        return [
            ...baseSections,
            makeSection('recently-added', config.recentlyTitle, 'Recently Added', recentlyAddedItems),
            makeSection('browse', config.browseTitle, 'Browse', browseItems),
            makeSection('collections', config.collectionTitle, 'Collections', collectionItems)
        ];
    }

    return [
        ...baseSections,
        ...dynamicSections.map(section => makeSection(section.id, section.tag, section.label, []))
    ];
}

function cleanBrowseOverviewText(overview: string): string {
    if (!overview) return '';

    return overview
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/?[^>]+(>|$)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function PtvBrowseHero({
    config,
    item,
    title
}: Readonly<{
    config: PtvBrowseConfig;
    item: PtvItem | null;
    title: string;
}>) {
    const resolvedTitle = title || config.title;
    const backdropUrl = getBrowseBackdropImage(item);
    const logoUrl = getBrowseLogoImage(item);
    const heroTitle = getText(item?.Name) || resolvedTitle;
    const overview = cleanBrowseOverviewText(getText(item?.Overview)) || config.description;
    const route = item ? getBrowseRoute(item) : null;
    const [logoFailed, setLogoFailed] = useState(false);

    useEffect(() => {
        setLogoFailed(false);
    }, [item?.Id]);

    const handleLogoError = useCallback(() => {
        setLogoFailed(true);
    }, []);

    return (
        <section className='ptv-cinematic-hero ptv-cinematic-hero--browse ptv-browse-hero'>
            {backdropUrl ? <img className='ptv-browse-hero-backdrop' src={backdropUrl} alt='' /> : null}
            <div className='ptv-browse-hero-vignette' />
            <div className='ptv-browse-hero-copy'>
                <div className='ptv-browse-section-kicker'>
                    <PtvIcon name={config.icon} />
                    <span>{resolvedTitle}</span>
                </div>
                {logoUrl && !logoFailed ? (
                    <img className='ptv-browse-hero-logo' src={logoUrl} alt={heroTitle} onError={handleLogoError} />
                ) : (
                    <h1>{heroTitle}</h1>
                )}
                {item ? <p className='ptv-browse-hero-meta'>{getBrowseMetadata(item)}</p> : null}
                <p className='ptv-browse-hero-overview'>{overview}</p>
                <div className='ptv-browse-hero-actions'>
                    {route ? (
                        <a className='ptv-browse-primary-action' href={route.href}>
                            <PtvIcon name='play' />
                            <span>Open</span>
                        </a>
                    ) : null}
                    <a className='ptv-browse-secondary-action' href={PTV_ROUTES.home}>
                        <PtvIcon name='home' />
                        <span>Home</span>
                    </a>
                </div>
            </div>
        </section>
    );
}

function PtvBrowseCard({
    item,
    onFocusItem,
    sectionId
}: Readonly<{
    item: PtvItem;
    onFocusItem: (sectionId: string, item: PtvItem) => void;
    sectionId: string;
}>) {
    const route = useMemo(() => getBrowseRoute(item), [item]);
    const imageCandidates = useMemo(() => getPtvItemImageCandidates(item, {
        baseOptions: {
            fillHeight: 558,
            fillWidth: 372,
            quality: 92,
            serverId: getPtvServerId() || undefined
        },
        includeUntagged: true,
        order: ['Primary', 'SeriesPrimary', 'ParentPrimary', 'Thumb']
    }).slice(0, 4), [item]);
    const [imageAttemptIndex, setImageAttemptIndex] = useState(0);
    const imageCandidate = imageCandidates[imageAttemptIndex];
    const tags = useMemo(() => getPtvQualityTags(item, { maxTags: 3 }), [item]);
    const title = getText(item.Name) || 'Untitled';

    useEffect(() => {
        setImageAttemptIndex(0);
    }, [item.Id]);

    const handleImageError = useCallback(() => {
        if (!imageCandidate) return;

        markPtvImageCandidateFailed(imageCandidate);
        recordPtvImageFallback();
        setImageAttemptIndex(index => index + 1);
    }, [imageCandidate]);

    return (
        <a
            className='ptv-browse-card'
            data-ptv-browse-item-id={getText(item.Id)}
            data-ptv-focus-key={`browse-card:${getText(item.Id)}`}
            data-ptv-browse-section-id={sectionId}
            href={route.href}
            onClick={() => recordPtvItemRouteClick(item, route, {
                action: 'browse-card',
                source: 'ptv-browse'
            })}
            onFocus={() => onFocusItem(sectionId, item)}
        >
            <span className='ptv-browse-card-art'>
                {imageCandidate ? (
                    <img
                        src={imageCandidate.url}
                        alt=''
                        decoding='async'
                        loading='lazy'
                        onError={handleImageError}
                    />
                ) : <span className='ptv-browse-card-fallback'>{title.slice(0, 1)}</span>}
                {tags.length ? (
                    <span className='ptv-browse-quality-stack'>
                        {tags.map(tag => (
                            <span key={tag.id} className={`ptv-browse-quality ${getPtvQualityPillClass(tag)}`}>
                                {tag.label}
                            </span>
                        ))}
                    </span>
                ) : null}
            </span>
            <span className='ptv-browse-card-title'>{title}</span>
            <span className='ptv-browse-card-meta'>{getBrowseMetadata(item)}</span>
        </a>
    );
}

function PtvBrowseReadyRail({
    onFocusItem,
    section
}: Readonly<{
    onFocusItem: (sectionId: string, item: PtvItem) => void;
    section: PtvBrowseSection;
}>) {
    useEffect(() => {
        notifyPtvTvFocusContentReady(`browse-row:${section.id}`);
    }, [section.id, section.items.length]);

    const rowRef = useRef<HTMLDivElement | null>(null);
    const frameRef = useRef<number | null>(null);
    const settleTimeoutRef = useRef<number | null>(null);
    const [navState, setNavState] = useState<PtvBrowseRowNavState>(() => getPtvBrowseRowNavState(null));
    const updateNavState = useCallback(() => {
        const nextState = getPtvBrowseRowNavState(rowRef.current);

        setNavState(previousState => {
            if (arePtvBrowseRowNavStatesEqual(previousState, nextState)) {
                return previousState;
            }

            return nextState;
        });
    }, []);
    const scheduleNavStateUpdate = useCallback(() => {
        if (frameRef.current !== null) {
            window.cancelAnimationFrame(frameRef.current);
        }

        frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = null;
            updateNavState();
        });
    }, [updateNavState]);
    const handleScroll = useCallback(() => {
        scheduleNavStateUpdate();
    }, [scheduleNavStateUpdate]);
    const scrollRow = useCallback((direction: 1 | -1) => {
        const row = rowRef.current;

        if (!row) return;

        row.scrollBy({
            behavior: 'smooth',
            left: direction * Math.max(320, row.clientWidth * 0.78)
        });

        scheduleNavStateUpdate();

        if (settleTimeoutRef.current !== null) {
            window.clearTimeout(settleTimeoutRef.current);
        }

        settleTimeoutRef.current = window.setTimeout(scheduleNavStateUpdate, 360);
    }, [scheduleNavStateUpdate]);
    const handleScrollPrevious = useCallback(() => scrollRow(-1), [scrollRow]);
    const handleScrollNext = useCallback(() => scrollRow(1), [scrollRow]);

    useEffect(() => {
        const row = rowRef.current;

        scheduleNavStateUpdate();

        if (!row) return undefined;

        const handleResize = () => scheduleNavStateUpdate();
        const handleImageLoad = () => scheduleNavStateUpdate();
        let resizeObserver: ResizeObserver | null = null;
        const delayedUpdate = window.setTimeout(scheduleNavStateUpdate, 180);

        window.addEventListener('resize', handleResize);
        row.addEventListener('load', handleImageLoad, true);

        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(scheduleNavStateUpdate);
            resizeObserver.observe(row);
        }

        return () => {
            window.clearTimeout(delayedUpdate);
            window.removeEventListener('resize', handleResize);
            row.removeEventListener('load', handleImageLoad, true);
            resizeObserver?.disconnect();
        };
    }, [scheduleNavStateUpdate, section.items.length]);

    useEffect(() => () => {
        if (frameRef.current !== null) {
            window.cancelAnimationFrame(frameRef.current);
        }

        if (settleTimeoutRef.current !== null) {
            window.clearTimeout(settleTimeoutRef.current);
        }
    }, []);

    return (
        <div
            className='ptv-browse-row-rail'
            data-ptv-row-nav-can-scroll-left={String(navState.canScrollLeft)}
            data-ptv-row-nav-can-scroll-right={String(navState.canScrollRight)}
            data-ptv-row-nav-mounted={String(navState.navButtonsMounted)}
        >
            <button
                aria-hidden={!navState.canScrollLeft}
                aria-label={`Scroll ${section.title} left`}
                className={`ptv-browse-row-nav ptv-browse-row-nav--prev${navState.canScrollLeft ? '' : ' is-hidden'}`}
                disabled={!navState.canScrollLeft}
                onClick={handleScrollPrevious}
                tabIndex={navState.canScrollLeft ? 0 : -1}
                type='button'
            >
                <PtvIcon name='skipPrevious' />
            </button>
            <div ref={rowRef} className='ptv-browse-card-rail' onScroll={handleScroll}>
                {section.items.map(item => (
                    <PtvBrowseCard
                        key={getText(item.Id)}
                        item={item}
                        onFocusItem={onFocusItem}
                        sectionId={section.id}
                    />
                ))}
            </div>
            <button
                aria-hidden={!navState.canScrollRight}
                aria-label={`Scroll ${section.title} right`}
                className={`ptv-browse-row-nav ptv-browse-row-nav--next${navState.canScrollRight ? '' : ' is-hidden'}`}
                disabled={!navState.canScrollRight}
                onClick={handleScrollNext}
                tabIndex={navState.canScrollRight ? 0 : -1}
                type='button'
            >
                <PtvIcon name='skipNext' />
            </button>
        </div>
    );
}

function PtvBrowseSectionView({
    onFocusItem,
    onRetry,
    rowIndex,
    section
}: Readonly<{
    onFocusItem: (sectionId: string, item: PtvItem) => void;
    onRetry: (sectionId: string) => void;
    rowIndex: number;
    section: PtvBrowseSection;
}>) {
    const { canShowDebug } = usePtvAdminDebugVisibility();
    const sectionRef = useRef<HTMLElement | null>(null);
    const mountCountedRef = useRef(false);
    const shouldMountImmediately = rowIndex < PTV_BROWSE_EAGER_ROW_COUNT;
    const [readyRailMounted, setReadyRailMounted] = useState(shouldMountImmediately);
    const handleRetry = useCallback(() => onRetry(section.id), [onRetry, section.id]);

    useEffect(() => {
        if (!readyRailMounted || !section.items.length || mountCountedRef.current) return undefined;

        mountCountedRef.current = true;
        browseShelfMountCount += 1;
        browseMountedCardCount += section.items.length;
        browsePeakMountedCardCount = Math.max(browsePeakMountedCardCount, browseMountedCardCount);
        recordPtvEvent('render', 'ptv-browse-row-render-mounted', {
            activeCardCount: browseMountedCardCount,
            itemCount: section.items.length,
            lazyShelfActivationCount: shouldMountImmediately ? 0 : 1,
            peakMountedCardCount: browsePeakMountedCardCount,
            rowId: section.id,
            rowIndex,
            shelfMountCount: browseShelfMountCount,
            title: section.title,
            visibleShelfCount: browseShelfMountCount - browseShelfUnmountCount
        });

        return () => {
            browseShelfUnmountCount += 1;
            browseMountedCardCount = Math.max(0, browseMountedCardCount - section.items.length);
            recordPtvEvent('render', 'ptv-browse-row-render-unmounted', {
                activeCardCount: browseMountedCardCount,
                itemCount: section.items.length,
                peakMountedCardCount: browsePeakMountedCardCount,
                rowId: section.id,
                rowIndex,
                shelfUnmountCount: browseShelfUnmountCount,
                title: section.title,
                visibleShelfCount: Math.max(0, browseShelfMountCount - browseShelfUnmountCount)
            });
        };
    }, [
        readyRailMounted,
        rowIndex,
        section.id,
        section.items.length,
        section.title,
        shouldMountImmediately
    ]);

    useEffect(() => {
        if (shouldMountImmediately) {
            setReadyRailMounted(true);
            return undefined;
        }

        if (readyRailMounted || section.status !== 'ready' || !section.items.length) {
            return undefined;
        }

        const node = sectionRef.current;

        if (!node || typeof IntersectionObserver === 'undefined') {
            setReadyRailMounted(true);
            return undefined;
        }

        recordPtvEvent('render', 'ptv-browse-row-render-deferred', {
            itemCount: section.items.length,
            rowId: section.id,
            rowIndex,
            title: section.title
        });

        const observer = new IntersectionObserver(entries => {
            const isNearViewport = entries.some(entry => entry.isIntersecting || entry.intersectionRatio > 0);

            if (!isNearViewport) return;

            setReadyRailMounted(true);
            observer.disconnect();
        }, {
            rootMargin: PTV_BROWSE_DEFERRED_ROW_ROOT_MARGIN
        });

        observer.observe(node);

        return () => observer.disconnect();
    }, [
        readyRailMounted,
        rowIndex,
        section.id,
        section.items.length,
        section.status,
        section.title,
        shouldMountImmediately
    ]);

    return (
        <section
            ref={sectionRef}
            className={`ptv-browse-row is-${section.status}${readyRailMounted ? '' : ' is-deferred'}`}
            data-ptv-browse-row-index={rowIndex}
            data-ptv-browse-row-mounted={String(readyRailMounted)}
        >
            <header className='ptv-browse-row-header'>
                <div>
                    <span className='ptv-browse-section-kicker'>{section.kicker}</span>
                    <h2>{section.title}</h2>
                </div>
            </header>
            {section.status === 'loading' || section.status === 'slow' ? (
                <div className='ptv-browse-card-rail ptv-browse-card-rail-skeleton' aria-hidden='true'>
                    {PTV_BROWSE_SKELETON_KEYS.map(key => (
                        <span key={key} className='ptv-browse-card ptv-browse-card-skeleton'>
                            <span className='ptv-browse-card-art' />
                            <span className='ptv-browse-skeleton-line ptv-browse-skeleton-title' />
                            <span className='ptv-browse-skeleton-line ptv-browse-skeleton-meta' />
                        </span>
                    ))}
                    {section.status === 'slow' ? (
                        <span className='ptv-browse-slow-status'>
                            This shelf is taking longer than expected.
                        </span>
                    ) : null}
                </div>
            ) : section.status === 'error' ? (
                <div className='ptv-browse-row-empty ptv-browse-row-failure'>
                    <strong>{getBrowseShelfFailureMessage(section)}</strong>
                    <span>Try again when the server catches up.</span>
                    <button type='button' onClick={handleRetry}>
                        <PtvIcon name='refresh' />
                        <span>Retry</span>
                    </button>
                    {canShowDebug ? <small>{getBrowseShelfFailureDetail(section)}</small> : null}
                </div>
            ) : section.items.length && readyRailMounted ? (
                <PtvBrowseReadyRail onFocusItem={onFocusItem} section={section} />
            ) : section.items.length ? (
                <div className='ptv-browse-card-rail ptv-browse-card-rail-deferred' aria-hidden='true'>
                    {PTV_BROWSE_SKELETON_KEYS.slice(0, 4).map(key => (
                        <span key={key} className='ptv-browse-card ptv-browse-card-skeleton'>
                            <span className='ptv-browse-card-art' />
                            <span className='ptv-browse-skeleton-line ptv-browse-skeleton-title' />
                            <span className='ptv-browse-skeleton-line ptv-browse-skeleton-meta' />
                        </span>
                    ))}
                </div>
            ) : (
                <div className='ptv-browse-row-empty'>Nothing to show here yet.</div>
            )}
        </section>
    );
}

type PtvBrowseTagType = 'genre' | 'network' | 'studio';

function getPtvBrowseTagHeading(type: PtvBrowseTagType) {
    if (type === 'genre') return 'Genres';
    if (type === 'network') return 'Studios & Networks';

    return 'Studios';
}

function getPtvBrowseTagHref(route: PtvBrowseRoute, type: PtvBrowseTagType, tag: string) {
    if (type === 'genre') return buildPtvBrowseHref(route, { genre: tag, view: 'genre' });
    if (type === 'network') return buildPtvBrowseHref(route, { network: tag, view: 'network' });

    return buildPtvBrowseHref(route, { studio: tag, view: 'studio' });
}

function PtvBrowseTagSection({ route, tags, title, type }: Readonly<{
    route: PtvBrowseRoute;
    tags: string[];
    title: string;
    type: PtvBrowseTagType;
}>) {
    return (
        <section className='ptv-browse-tag-section'>
            <header className='ptv-browse-row-header'>
                <div>
                    <span className='ptv-browse-section-kicker'>
                        {getPtvBrowseTagHeading(type)}
                    </span>
                    <h2>{title}</h2>
                </div>
            </header>
            {tags.length ? (
                <div className='ptv-browse-chip-grid'>
                    {tags.map(tag => (
                        <a
                            key={tag}
                            className='ptv-browse-chip'
                            href={getPtvBrowseTagHref(route, type, tag)}
                        >
                            {tag}
                        </a>
                    ))}
                </div>
            ) : (
                <div className='ptv-browse-row-empty'>More categories will appear as this section loads.</div>
            )}
        </section>
    );
}

function PtvBrowseDebugPanel({ diagnostics, state }: Readonly<{ diagnostics: PtvBrowseDiagnostic[]; state: PtvBrowseState }>) {
    const { canShowDebug } = usePtvAdminDebugVisibility();
    const genreTagDebug = state.tagSectionDebug.genre;
    const studioTagDebug = state.tagSectionDebug.studio;

    if (!canShowDebug) return null;

    return (
        <details className='ptv-browse-debug'>
            <summary>Browse diagnostics</summary>
            <dl>
                <dt>sectionCount</dt>
                <dd>{state.sections.length}</dd>
                <dt>heroItem</dt>
                <dd>{getText(state.heroItem?.Name) || 'none'}</dd>
                <dt>genres</dt>
                <dd>{getBoundedBrowseDiagnosticText(state.tags.genres.join(', '), 500) || 'none'}</dd>
                <dt>studios</dt>
                <dd>{getBoundedBrowseDiagnosticText(state.tags.studios.join(', '), 500) || 'none'}</dd>
                <dt>genre.tagDirectory.total</dt>
                <dd>{genreTagDebug.total}</dd>
                <dt>genre.tagDirectory.eligible (minimum {genreTagDebug.minItemCount})</dt>
                <dd>{genreTagDebug.eligible}</dd>
                <dt>genre.tagDirectory.selected</dt>
                <dd>{getBoundedBrowseDiagnosticText(genreTagDebug.selected.join(', '), 500) || 'none'}</dd>
                <dt>genre.tagDirectory.skippedUnderMinimum</dt>
                <dd>{getBoundedBrowseDiagnosticText(genreTagDebug.skippedUnderMinimum.join(', '), 500) || 'none'}</dd>
                <dt>studio.tagDirectory.total</dt>
                <dd>{studioTagDebug.total}</dd>
                <dt>studio.tagDirectory.eligible (minimum {studioTagDebug.minItemCount})</dt>
                <dd>{studioTagDebug.eligible}</dd>
                <dt>studio.tagDirectory.selected</dt>
                <dd>{getBoundedBrowseDiagnosticText(studioTagDebug.selected.join(', '), 500) || 'none'}</dd>
                <dt>studio.tagDirectory.skippedUnderMinimum</dt>
                <dd>{getBoundedBrowseDiagnosticText(studioTagDebug.skippedUnderMinimum.join(', '), 500) || 'none'}</dd>
            </dl>
            <div className='ptv-browse-debug-list'>
                {diagnostics.slice(0, 8).map(entry => (
                    <span key={entry.section}>
                        {entry.section}: {entry.status}, {entry.count} items, {entry.durationMs}ms
                        {entry.timeoutReason ? `, ${entry.timeoutReason}` : ''}
                        {entry.error && !entry.timeoutReason ? `, ${entry.error}` : ''}
                        {entry.includeItemTypes ? `, types=${entry.includeItemTypes}` : ''}
                        {entry.limit ? `, limit=${entry.limit}` : ''}
                        {entry.requestedFieldProfile ? `, profile=${entry.requestedFieldProfile}` : ''}
                        {entry.requestedFieldCount ? `, fieldCount=${entry.requestedFieldCount}` : ''}
                        {entry.payloadSize ? `, payload=${entry.payloadSize}` : ''}
                        {entry.bytesPerItem ? `, bytes/item=${entry.bytesPerItem}` : ''}
                        {entry.normalizationDurationMs ? `, normalize=${entry.normalizationDurationMs}ms` : ''}
                        {entry.fieldProfileMismatchWarning ? `, warning=${entry.fieldProfileMismatchWarning}` : ''}
                        {entry.timeoutSource !== 'none' ? `, timeoutSource=${entry.timeoutSource}` : ''}
                        {entry.requestUrl ? `, endpoint=${getBoundedBrowseDiagnosticText(entry.requestUrl, 180)}` : ''}
                    </span>
                ))}
            </div>
        </details>
    );
}

function PtvBrowseLandingPage({ config, location, onBackdropChange, route, scope, title }: Readonly<{
    config: PtvBrowseConfig;
    location: { pathname: string; search: string };
    onBackdropChange: (url: string) => void;
    title: string;
    route: PtvBrowseRoute;
    scope: PtvBrowseResolvedScope;
}>) {
    const { canShowDebug } = usePtvAdminDebugVisibility();
    const memoryKey = useMemo(() => getPtvBrowseMemoryKey(location.pathname, location.search), [location.pathname, location.search]);
    const memoryRef = useRef<PtvBrowseMemory>(loadPtvBrowseMemory(memoryKey));
    const memoryRestoredRef = useRef(false);
    const [retryRequest, setRetryRequest] = useState({
        loadKey: '',
        nonce: 0,
        routeGeneration: 0,
        sectionId: ''
    });
    const [state, setState] = useState<PtvBrowseState>(EMPTY_BROWSE_STATE);
    const saveBrowseMemory = useCallback((updates: Partial<PtvBrowseMemory>) => {
        const nextMemory: PtvBrowseMemory = {
            ...memoryRef.current,
            ...updates,
            lastFilter: location.search || config.kind,
            updatedAt: Date.now()
        };

        memoryRef.current = nextMemory;
        savePtvBrowseMemory(memoryKey, nextMemory);
    }, [config.kind, location.search, memoryKey]);
    const handleBrowseItemFocus = useCallback((sectionId: string, item: PtvItem) => {
        saveBrowseMemory({
            focusedItemId: getText(item.Id),
            focusedSectionId: sectionId,
            scrollY: Math.max(0, Math.round(window.scrollY || document.documentElement.scrollTop || 0))
        });
    }, [saveBrowseMemory]);
    const handleBrowseRetry = useCallback((sectionId: string) => {
        setRetryRequest(previous => ({
            loadKey: memoryKey,
            nonce: previous.nonce + 1,
            routeGeneration: getPtvRouteControllerState().routeGeneration,
            sectionId
        }));
    }, [memoryKey]);

    useEffect(() => {
        memoryRef.current = loadPtvBrowseMemory(memoryKey);
        memoryRestoredRef.current = false;
    }, [memoryKey]);

    useEffect(() => {
        let frame = 0;

        const saveScroll = () => {
            saveBrowseMemory({
                scrollY: Math.max(0, Math.round(window.scrollY || document.documentElement.scrollTop || 0))
            });
        };
        const handleScroll = () => {
            if (frame) return;

            frame = window.requestAnimationFrame(() => {
                frame = 0;
                saveScroll();
            });
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('pagehide', saveScroll);

        return () => {
            if (frame) window.cancelAnimationFrame(frame);
            saveScroll();
            window.removeEventListener('scroll', handleScroll);
            window.removeEventListener('pagehide', saveScroll);
        };
    }, [saveBrowseMemory]);

    useEffect(() => {
        let isMounted = true;
        const routeAbortController = createPtvAbortController();
        const startedAt = performance.now();
        const routeGeneration = getPtvRouteControllerState().routeGeneration;
        const retrySectionId = (
            retryRequest.loadKey === memoryKey
            && retryRequest.routeGeneration === routeGeneration
        ) ? retryRequest.sectionId : '';
        let firstInteractiveRecorded = false;
        let firstShelfRenderedRecorded = false;
        let aboveFoldLoadedRecorded = false;
        const slowTimers = new Map<string, number>();

        recordPtvEvent('route', 'browse-page-route-matched', {
            kind: config.kind,
            routeGeneration,
            routeMatchedMs: 0,
            title: config.title
        });

        const clearSlowTimer = (sectionId: string) => {
            const timer = slowTimers.get(sectionId);

            if (timer) {
                window.clearTimeout(timer);
                slowTimers.delete(sectionId);
            }
        };

        const scheduleSlowTimer = (sectionId: string) => {
            clearSlowTimer(sectionId);
            slowTimers.set(sectionId, window.setTimeout(() => {
                slowTimers.delete(sectionId);

                if (!isMounted) return;

                setState(previous => ({
                    ...previous,
                    sections: previous.sections.map(section => (
                        section.id === sectionId && section.status === 'loading' ?
                            {
                                ...section,
                                status: 'slow'
                            } :
                            section
                    ))
                }));
                recordPtvEvent('api', 'ptv-browse-row-request-soft-timeout', {
                    rowId: sectionId,
                    softTimeoutMs: PTV_BROWSE_SOFT_TIMEOUT_MS
                });
            }, PTV_BROWSE_SOFT_TIMEOUT_MS));
        };
        const sectionSeed = getPtvBrowseSectionSeed(route, scope);
        const randomTagGenerator = createPtvBrowseRandom(sectionSeed + 101);
        const featuredRandomGenerator = createPtvBrowseRandom(sectionSeed + 202);
        const getBrowseLoadOwner = () => ({
            currentRouteGeneration: getPtvRouteControllerState().routeGeneration,
            expectedRouteGeneration: routeGeneration,
            isMounted,
            signal: routeAbortController.signal
        });
        const isCurrentBrowseLoad = () => isPtvBrowseLoadOwnerCurrent(getBrowseLoadOwner());
        const assertCurrentBrowseLoad = () => assertPtvBrowseLoadOwnerCurrent(getBrowseLoadOwner());
        const getBrowseTagSections = async (): Promise<{
            sections: PtvBrowseLandingTagSection[];
            debug: PtvBrowseLandingTagDebug;
        }> => {
            if (config.kind === 'collections' || !scope.status || scope.status === 'error') {
                return {
                    sections: [],
                    debug: getEmptyPtvBrowseLandingTagDebug(PTV_BROWSE_TAG_SHELF_MIN_ITEM_COUNT)
                };
            }

            try {
                const [genreDirectoryResult, studioDirectoryResult] = await Promise.allSettled([
                    loadPtvBrowseDirectory(route, scope, 'genre', routeAbortController.signal),
                    loadPtvBrowseDirectory(route, scope, 'studio', routeAbortController.signal)
                ]);
                assertCurrentBrowseLoad();

                const directoryCancellation = getPtvBrowseSettledCancellation(
                    [ genreDirectoryResult, studioDirectoryResult ],
                    routeAbortController.signal
                );

                if (directoryCancellation) throw directoryCancellation;

                const genreDirectory = genreDirectoryResult.status === 'fulfilled' ? genreDirectoryResult.value : [];
                const studioDirectory = studioDirectoryResult.status === 'fulfilled' ? studioDirectoryResult.value : [];
                const genreSections = getPtvBrowseLandingTagSections(
                    config,
                    genreDirectory,
                    'genre',
                    randomTagGenerator,
                    PTV_BROWSE_RANDOM_TAG_SHELVES_COUNT
                );
                const studioSections = getPtvBrowseLandingTagSections(
                    config,
                    studioDirectory,
                    'studio',
                    randomTagGenerator,
                    PTV_BROWSE_RANDOM_TAG_SHELVES_COUNT
                );

                return {
                    sections: [...genreSections, ...studioSections],
                    debug: {
                        genre: getPtvBrowseLandingTagSectionSummary(genreDirectory, genreSections, PTV_BROWSE_TAG_SHELF_MIN_ITEM_COUNT),
                        studio: getPtvBrowseLandingTagSectionSummary(studioDirectory, studioSections, PTV_BROWSE_TAG_SHELF_MIN_ITEM_COUNT)
                    }
                };
            } catch (error) {
                if (isPtvBrowseCancellation(error, routeAbortController.signal)) throw error;
                if (!isCurrentBrowseLoad()) {
                    throw createPtvBrowseCancellationError('Browse directory work was superseded.');
                }

                return {
                    sections: [],
                    debug: getEmptyPtvBrowseLandingTagDebug(PTV_BROWSE_TAG_SHELF_MIN_ITEM_COUNT)
                };
            }
        };

        if (retrySectionId) {
            setState(previous => {
                const sections = preparePtvBrowseSectionsForRetry(
                    previous.sections,
                    retrySectionId
                );
                const hasReadyContent = sections.some(section => (
                    section.status === 'ready' && section.items.length
                ));

                return {
                    ...previous,
                    error: '',
                    isLoading: !hasReadyContent,
                    sections
                };
            });
        } else {
            setState({
                ...EMPTY_BROWSE_STATE,
                isLoading: true,
                sections: getInitialSections(config, [])
            });
        }

        async function loadBrowsePage() {
            const updateBrowseSection = (sectionId: string, result: {
                diagnostic: PtvBrowseDiagnostic;
                items: PtvItem[];
            }) => {
                if (!isMounted) return;
                if (getPtvRouteControllerState().routeGeneration !== routeGeneration) {
                    recordPtvEvent('route', 'browse-page-stale-section-discarded', {
                        currentRouteGeneration: getPtvRouteControllerState().routeGeneration,
                        kind: config.kind,
                        routeGeneration,
                        sectionId
                    });
                    return;
                }
                clearSlowTimer(sectionId);

                if (!firstShelfRenderedRecorded && result.items.length) {
                    firstShelfRenderedRecorded = true;
                    recordPtvEvent('route', 'browse-page-first-shelf-rendered', {
                        durationMs: Number((performance.now() - startedAt).toFixed(1)),
                        firstShelfRenderedMs: Number((performance.now() - startedAt).toFixed(1)),
                        kind: config.kind,
                        routeGeneration,
                        sectionId,
                        title: config.title
                    });
                }

                if (!firstInteractiveRecorded && result.items.length) {
                    firstInteractiveRecorded = true;
                    recordPtvEvent('route', 'browse-page-loaded', {
                        durationMs: Number((performance.now() - startedAt).toFixed(1)),
                        firstInteractiveMs: Number((performance.now() - startedAt).toFixed(1)),
                        firstSectionId: sectionId,
                        firstSectionItemCount: result.items.length,
                        kind: config.kind,
                        loadedMode: 'first-section',
                        routeGeneration,
                        title: config.title
                    });
                }

                setState(previous => {
                    const sections = previous.sections.map(section => (
                        section.id === sectionId ?
                            mergePtvBrowseShelfResult(
                                section,
                                makeSection(
                                    section.id,
                                    section.title,
                                    section.kicker,
                                    result.items,
                                    false,
                                    result.diagnostic.status === 'ready' ? '' : result.diagnostic.error || result.diagnostic.timeoutReason || 'Shelf failed to load.'
                                )
                            ) :
                            section
                    ));
                    const diagnostics = [
                        ...previous.diagnostics.filter(entry => entry.section !== result.diagnostic.section),
                        result.diagnostic
                    ];
                    const allItems = dedupeBrowseItems(sections.reduce<PtvItem[]>((items, section) => items.concat(section.items), []));
                    const failedCount = diagnostics.filter(entry => entry.status === 'error' || entry.status === 'timeout').length;
                    const hasReadyContent = sections.some(section => section.status === 'ready' && section.items.length);
                    const aboveFoldLoaded = sections
                        .slice(0, PTV_BROWSE_EAGER_ROW_COUNT)
                        .every(section => section.status !== 'loading' && section.status !== 'slow');

                    if (!aboveFoldLoadedRecorded && aboveFoldLoaded) {
                        aboveFoldLoadedRecorded = true;
                        recordPtvEvent('route', 'browse-page-above-fold-loaded', {
                            aboveFoldLoadedMs: Number((performance.now() - startedAt).toFixed(1)),
                            kind: config.kind,
                            routeGeneration,
                            title: config.title
                        });
                    }

                    return {
                        diagnostics,
                        error: failedCount >= 2 || (!allItems.length && failedCount) ? 'Some shelves could not be loaded.' : '',
                        heroItem: selectPtvBrowseHeroItem(previous.heroItem, sectionId, result.items, config),
                        isLoading: !hasReadyContent && sections.some(section => section.status === 'loading' || section.status === 'slow'),
                    sections,
                    tagSectionDebug: previous.tagSectionDebug,
                    tags: {
                            genres: getDistinctTags(allItems, 'Genres'),
                            studios: getDistinctTags(allItems, 'Studios')
                        }
                    };
                });
            };
            const browseTagData = await getBrowseTagSections();
            assertCurrentBrowseLoad();

            const browseTagSections = browseTagData.sections;

            if (!retrySectionId && config.kind !== 'collections') {
                setState(previous => {
                    if (!isCurrentBrowseLoad()) return previous;

                    return {
                        ...previous,
                        sections: getInitialSections(config, [], browseTagSections),
                        tagSectionDebug: browseTagData.debug
                    };
                });
            }

            const sectionTasks = (
                config.kind === 'collections' ? prioritizePtvBrowseTasks([
                    {
                        id: 'featured',
                        run: () => fetchBrowseItems(
                            'featured',
                            getBaseQuery(config, getPtvBrowseFeaturedQueryOverrides(config.kind), 'featured', scope),
                            routeAbortController.signal, scope
                        )
                    },
                    {
                        id: 'continue',
                        run: () => fetchBrowseResumeItems('continue', getBaseQuery(config, {
                            IncludeItemTypes: config.continueIncludeItemTypes,
                            Limit: 20,
                            SortBy: 'DatePlayed',
                            SortOrder: 'Descending'
                        }, 'continue', scope), routeAbortController.signal, scope)
                    },
                    {
                        id: 'recommendations',
                        run: () => fetchBrowseItems('recommendations', getBaseQuery(config, {
                            Limit: 20,
                            SortBy: 'Random'
                        }, 'recommendations', scope), routeAbortController.signal, scope)
                    },
                    {
                        id: 'recently-added',
                        run: () => fetchBrowseItems('recently-added', getBaseQuery(config, {
                            Limit: 20,
                            SortBy: 'DateCreated',
                            SortOrder: 'Descending'
                        }, 'recently-added', scope), routeAbortController.signal, scope)
                    },
                    {
                        id: 'browse',
                        run: () => fetchBrowseItems('browse', getBaseQuery(config, {
                            Limit: 50,
                            SortBy: 'SortName',
                            SortOrder: 'Ascending'
                        }, 'browse', scope), routeAbortController.signal, scope)
                    },
                    {
                        id: 'collections',
                        run: () => fetchBrowseItems('collections', getBaseQuery({
                            ...config,
                            genreFilter: '',
                            includeItemTypes: 'BoxSet'
                        }, {
                            Limit: 24,
                            SortBy: 'SortName',
                            SortOrder: 'Ascending'
                        }, 'collections', scope), routeAbortController.signal, scope)
                    }
                ]) : [
                    {
                        id: 'featured',
                        run: async () => {
                            const result = await fetchBrowseItems(
                                'featured',
                                getBaseQuery(config, getPtvBrowseFeaturedQueryOverrides(config.kind), 'featured', scope),
                                routeAbortController.signal, scope
                            );

                            return {
                                ...result,
                                items: shufflePtvBrowseItems(result.items, featuredRandomGenerator)
                            };
                        }
                    },
                    {
                        id: 'continue',
                        run: () => fetchBrowseResumeItems('continue', getBaseQuery(config, {
                            IncludeItemTypes: config.continueIncludeItemTypes,
                            Limit: 20,
                            SortBy: 'DatePlayed',
                            SortOrder: 'Descending'
                        }, 'continue', scope), routeAbortController.signal, scope)
                    },
                    {
                        id: 'recommendations',
                        run: () => fetchBrowseRecommendations(config, scope, routeAbortController.signal)
                    },
                    ...browseTagSections.map((section: PtvBrowseLandingTagSection) => ({
                        id: section.id,
                        run: () => fetchBrowseItems(section.id, getPtvBrowseLandingTagSectionQuery(config, scope, section), routeAbortController.signal, scope)
                    }))
                ]).filter(task => !retrySectionId || task.id === retrySectionId);
            const sectionTaskIds: string[] = [];

            for (const task of sectionTasks) sectionTaskIds.push(task.id);

            const missingRetryTaskId = getMissingPtvBrowseRetryTaskId(retrySectionId, sectionTaskIds);

            if (missingRetryTaskId) {
                updateBrowseSection(missingRetryTaskId, {
                    diagnostic: createPtvBrowseMissingRetryDiagnostic(missingRetryTaskId),
                    items: []
                });
                recordPtvEvent('api', 'ptv-browse-row-retry-task-missing', {
                    kind: config.kind,
                    routeGeneration,
                    rowId: missingRetryTaskId
                });
                return;
            }

            let nextSectionIndex = 0;

            const runSectionWorker = async () => {
                while (isMounted) {
                    const task = sectionTasks[nextSectionIndex];

                    nextSectionIndex += 1;
                    if (!task) break;

                    scheduleSlowTimer(task.id);
                    const result = await task.run();
                    updateBrowseSection(task.id, result);
                }
            };

            const performanceProfile = getPtvPerformanceProfile();
            const browseConcurrency = performanceProfile.isLowPower || performanceProfile.clientKind === 'mobile' ? 2 : 4;

            await Promise.all(Array.from({ length: browseConcurrency }, () => runSectionWorker()));
            if (!isCurrentBrowseLoad()) return;

            if (shouldCollectDiagnostics()) {
                if (!firstInteractiveRecorded) {
                    recordPtvEvent('route', 'browse-page-loaded', {
                        durationMs: Number((performance.now() - startedAt).toFixed(1)),
                        firstInteractiveMs: Number((performance.now() - startedAt).toFixed(1)),
                        firstSectionId: '',
                        firstSectionItemCount: 0,
                        kind: config.kind,
                        loadedMode: 'complete-empty',
                        routeGeneration,
                        title: config.title
                    });
                }

                recordPtvEvent('route', 'browse-page-fully-loaded', {
                    durationMs: Number((performance.now() - startedAt).toFixed(1)),
                    fullyLoadedMs: Number((performance.now() - startedAt).toFixed(1)),
                    kind: config.kind,
                    routeGeneration,
                    sectionCount: sectionTasks.length,
                    title: config.title
                });
            }
        }

        void loadBrowsePage().catch(error => {
            if (
                !isCurrentBrowseLoad()
                || isPtvBrowseCancellation(error, routeAbortController.signal)
            ) return;

            const message = error instanceof Error ? error.message : 'Browse page failed to load.';
            recordPtvEvent('route', 'browse-page-load-failed', {
                error: message,
                kind: config.kind,
                routeGeneration,
                title: config.title
            });
            setState(previous => ({
                ...previous,
                error: message,
                isLoading: false
            }));
        });

        return () => {
            isMounted = false;
            routeAbortController.abort();
            slowTimers.forEach(timer => window.clearTimeout(timer));
            slowTimers.clear();
        };
    }, [config, memoryKey, retryRequest, route, scope]);

    useEffect(() => {
        if (memoryRestoredRef.current || !state.sections.length) return undefined;

        const memory = memoryRef.current;
        memoryRestoredRef.current = true;

        if (!memory.scrollY && !memory.focusedItemId) return undefined;

        const frame = window.requestAnimationFrame(() => {
            if (memory.scrollY) {
                window.scrollTo({
                    behavior: 'auto',
                    top: memory.scrollY
                });
            }

            if (memory.focusedItemId) {
                const focusedNode = Array.from(document.querySelectorAll<HTMLElement>('[data-ptv-browse-item-id]'))
                    .find(node => node.dataset.ptvBrowseItemId === memory.focusedItemId);

                if (focusedNode) focusPtvTvElement(focusedNode, 'browse-back-forward-restore');
            }

            if (shouldCollectDiagnostics()) {
                recordPtvEvent('route', 'browse-page-memory-restored', {
                    focusedItemId: memory.focusedItemId || null,
                    focusedSectionId: memory.focusedSectionId || null,
                    kind: config.kind,
                    lastFilter: memory.lastFilter || null,
                    scrollY: memory.scrollY
                });
            }
        });

        return () => window.cancelAnimationFrame(frame);
    }, [config.kind, state.sections.length]);

    const backdropUrl = getBrowseBackdropImage(state.heroItem);

    useEffect(() => {
        onBackdropChange(backdropUrl);
    }, [backdropUrl, onBackdropChange]);

    return (
        <>
            <PtvBrowseHero
                config={config}
                item={state.heroItem}
                title={title}
            />
            <main className='ptv-browse-content' aria-busy={state.isLoading}>
                {state.error && canShowDebug ? <div className='ptv-browse-error'>{state.error}</div> : null}
            {state.sections.map((section, rowIndex) => (
                <PtvBrowseSectionView
                    key={`${config.title}-${section.id}`}
                    onFocusItem={handleBrowseItemFocus}
                    onRetry={handleBrowseRetry}
                    rowIndex={rowIndex}
                    section={section}
                />
            ))}
                {config.kind === 'collections' ? (
                    <>
                        <PtvBrowseTagSection route={route} title={`${config.title} Genres`} tags={state.tags.genres} type='genre' />
                        <PtvBrowseTagSection
                            route={route}
                            title={`${config.title} Studios`}
                            tags={state.tags.studios}
                            type='studio'
                        />
                    </>
                ) : null}
                <PtvBrowseDebugPanel diagnostics={state.diagnostics} state={state} />
            </main>
        </>
    );
}

type PtvFocusedBrowseState = Readonly<{
    directory: PtvBrowseDirectoryEntry[];
    durationMs: number;
    error: string;
    exactFilterResolved: boolean;
    items: PtvItem[];
    status: 'error' | 'loading' | 'ready';
    totalRecordCount: number;
}>;

const EMPTY_FOCUSED_BROWSE_STATE: PtvFocusedBrowseState = {
    directory: [],
    durationMs: 0,
    error: '',
    exactFilterResolved: false,
    items: [],
    status: 'loading',
    totalRecordCount: 0
};

function getFocusedBrowseTitle(route: PtvBrowseRoute, config: PtvBrowseConfig) {
    if (route.view === 'genre') return route.genre;
    if (route.view === 'studio') return route.studio;
    if (route.view === 'network') return route.network;
    if (route.view === 'genres') return `${config.title} Genres`;
    if (route.view === 'studios') return `${config.title} Studios`;
    if (route.view === 'networks') return `${config.title} Studios & Networks`;
    if (route.view === 'continue') return `Continue ${config.kind === 'shows' ? 'Watching' : config.title}`;
    if (route.view === 'latest') return `Latest ${config.title}`;
    if (route.view === 'trending') return `Trending ${config.title}`;
    if (route.view === 'season') return 'Seasons';
    if (route.view === 'featured') return `Featured ${config.title}`;

    return config.title;
}

function getFocusedBrowseKicker(route: PtvBrowseRoute) {
    if (route.view === 'genre') return 'Genre';
    if (route.view === 'studio') return 'Studio';
    if (route.view === 'network') return 'Studio / Network';
    if (route.view === 'genres' || route.view === 'studios' || route.view === 'networks') return 'Browse directory';
    if (route.view === 'continue') return 'Pick up where you left off';
    if (route.view === 'latest') return 'Recently added';
    if (route.view === 'trending') return 'Trending in your library';

    return 'Browse';
}

function isPtvBrowseDirectoryView(route: PtvBrowseRoute) {
    return route.view === 'genres' || route.view === 'studios' || route.view === 'networks';
}

function getPtvBrowseDirectoryType(route: PtvBrowseRoute): 'genre' | 'studio' {
    return route.view === 'genres' ? 'genre' : 'studio';
}

function PtvFocusedBrowseToolbar({ route }: Readonly<{ route: PtvBrowseRoute }>) {
    const [query, setQuery] = useState(route.query);
    const [sortBy, setSortBy] = useState(route.sortBy);
    const [sortOrder, setSortOrder] = useState(route.sortOrder);

    useEffect(() => {
        setQuery(route.query);
        setSortBy(route.sortBy);
        setSortOrder(route.sortOrder);
    }, [route.canonicalRouteKey, route.query, route.sortBy, route.sortOrder]);

    const handleSubmit = useCallback((event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        navigatePtvRoute(buildPtvBrowseHref(route, {
            page: 0,
            query,
            sortBy,
            sortOrder
        }));
    }, [query, route, sortBy, sortOrder]);
    const handleQueryChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(event.target.value);
    }, []);
    const handleSortByChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
        setSortBy(event.target.value);
    }, []);
    const handleSortOrderChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
        setSortOrder(event.target.value as 'Ascending' | 'Descending');
    }, []);

    return (
        <form className='ptv-browse-focused-toolbar' onSubmit={handleSubmit}>
            <label>
                <span>Search this view</span>
                <input
                    onChange={handleQueryChange}
                    placeholder={`Search ${route.kind}`}
                    type='search'
                    value={query}
                />
            </label>
            <label>
                <span>Sort by</span>
                <select onChange={handleSortByChange} value={sortBy}>
                    <option value='SortName'>Name</option>
                    <option value='DateCreated'>Date added</option>
                    <option value='PremiereDate'>Release date</option>
                    <option value='CommunityRating'>Rating</option>
                </select>
            </label>
            <label>
                <span>Order</span>
                <select
                    onChange={handleSortOrderChange}
                    value={sortOrder}
                >
                    <option value='Ascending'>Ascending</option>
                    <option value='Descending'>Descending</option>
                </select>
            </label>
            <button className='ptv-browse-toolbar-action' type='submit'>Apply</button>
            {route.query ? (
                <a className='ptv-browse-toolbar-action' href={buildPtvBrowseHref(route, { page: 0, query: '' })}>
                    Clear search
                </a>
            ) : null}
        </form>
    );
}

function getBoundedBrowseDiagnosticText(value: unknown, maxLength = 120) {
    const normalized = String(value || '').replace(/[\r\n\t]+/g, ' ').trim();

    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function PtvFocusedBrowseDebug({ route, scope, state, title }: Readonly<{
    route: PtvBrowseRoute;
    scope: PtvBrowseResolvedScope;
    state: PtvFocusedBrowseState;
    title: string;
}>) {
    const { canShowDebug } = usePtvAdminDebugVisibility();

    if (!canShowDebug) return null;

    return (
        <details className='ptv-browse-debug'>
            <summary>Focused browse diagnostics</summary>
            <dl>
                <dt>rawView</dt>
                <dd>{getBoundedBrowseDiagnosticText(route.rawView) || 'landing'}</dd>
                <dt>normalizedView</dt>
                <dd>{route.view}</dd>
                <dt>mediaKind</dt>
                <dd>{route.kind}</dd>
                <dt>scopeAlias</dt>
                <dd>{getBoundedBrowseDiagnosticText(scope.alias) || 'none'}</dd>
                <dt>scopeResolved</dt>
                <dd>{String(scope.status === 'resolved')}</dd>
                <dt>loaderKey</dt>
                <dd>{getBoundedBrowseDiagnosticText(getPtvFocusedBrowseDiagnosticLoaderKey(route, scope), 240)}</dd>
                <dt>cacheCategory</dt>
                <dd>focused-browse/{route.kind}/{route.view}</dd>
                <dt>metadataDirectorySource</dt>
                <dd>{route.view === 'network' || route.view === 'networks' ? 'Jellyfin studios / StudioIds' : 'Jellyfin metadata directory'}</dd>
                <dt>filterType</dt>
                <dd>{route.filterType}</dd>
                <dt>filterValue</dt>
                <dd>{getBoundedBrowseDiagnosticText(route.filterValue) || 'none'}</dd>
                <dt>exactFilterResolved</dt>
                <dd>{String(state.exactFilterResolved)}</dd>
                <dt>sort</dt>
                <dd>{route.sortBy} {route.sortOrder}</dd>
                <dt>page</dt>
                <dd>{route.page}</dd>
                <dt>startIndex</dt>
                <dd>{route.page * route.pageSize}</dd>
                <dt>returnedItems</dt>
                <dd>{state.items.length}</dd>
                <dt>totalRecordCount</dt>
                <dd>{state.totalRecordCount}</dd>
                <dt>durationMs</dt>
                <dd>{state.durationMs}</dd>
                <dt>staleResponseSuppressed</dt>
                <dd>false (suppressed responses are recorded before render)</dd>
                <dt>activeTitle</dt>
                <dd>{getBoundedBrowseDiagnosticText(title)}</dd>
            </dl>
        </details>
    );
}

function getPtvFocusedBrowseStatusText(state: PtvFocusedBrowseState) {
    if (state.status === 'ready') {
        const noun = state.totalRecordCount === 1 ? 'item' : 'items';

        return `${state.totalRecordCount} ${noun}`;
    }

    if (state.status === 'loading') return 'Loading this view...';

    return 'This view needs attention.';
}

function getPtvFocusedBrowseBackHref(route: PtvBrowseRoute) {
    return buildPtvBrowseHref(route, {
        collectionId: '',
        genre: '',
        network: '',
        page: 0,
        query: '',
        seasonParentId: '',
        studio: '',
        view: 'landing'
    });
}

async function loadPtvFocusedBrowseState(
    route: PtvBrowseRoute,
    scope: PtvBrowseResolvedScope,
    signal?: AbortSignal
): Promise<PtvFocusedBrowseState> {
    if (route.error) throw new Error(route.error);
    if (scope.status === 'error') throw new Error(scope.error);

    if (isPtvBrowseDirectoryView(route)) {
        const directory = await loadPtvBrowseDirectory(route, scope, getPtvBrowseDirectoryType(route), signal);

        return {
            directory,
            durationMs: 0,
            error: '',
            exactFilterResolved: true,
            items: [],
            status: 'ready',
            totalRecordCount: directory.length
        };
    }

    let metadataId = '';
    let exactFilterResolved = route.view !== 'studio' && route.view !== 'network';

    if (route.view === 'studio' || route.view === 'network') {
        const directory = await loadPtvBrowseDirectory(route, scope, 'studio', signal);
        const filterName = route.view === 'studio' ? route.studio : route.network;
        const selected = findExactPtvBrowseDirectoryEntry(directory, filterName);

        if (!selected) {
            const label = route.view === 'network' ? 'studio or network' : route.view;

            throw new Error(`No exact ${label} match exists in this library.`);
        }

        metadataId = selected.id;
        exactFilterResolved = true;
    }

    const result = await loadPtvFocusedBrowsePages(route, scope, metadataId, signal);

    return {
        directory: [],
        durationMs: 0,
        error: '',
        exactFilterResolved,
        items: result.items,
        status: 'ready',
        totalRecordCount: result.totalRecordCount
    };
}

function ignoreFocusedBrowseCardFocus() {
    // Focus state is local to focused grids; the landing hero is not mounted here.
}

function PtvFocusedBrowseItems({ route, state }: Readonly<{
    route: PtvBrowseRoute;
    state: PtvFocusedBrowseState;
}>) {
    const hasMore = state.items.length < state.totalRecordCount;

    if (!state.items.length) {
        return <div className='ptv-browse-focused-status'>No matching items were found.</div>;
    }

    return (
        <>
            <div className='ptv-browse-focused-grid'>
                {state.items.map(item => (
                    <PtvBrowseCard
                        key={getText(item.Id)}
                        item={item}
                        onFocusItem={ignoreFocusedBrowseCardFocus}
                        sectionId={`${route.kind}-${route.view}`}
                    />
                ))}
            </div>
            {hasMore ? (
                <a className='ptv-browse-load-more' href={buildPtvBrowseHref(route, { page: route.page + 1 })}>
                    Load more
                </a>
            ) : null}
        </>
    );
}

function PtvFocusedBrowseBody({ onRetry, route, state, title }: Readonly<{
    onRetry: () => void;
    route: PtvBrowseRoute;
    state: PtvFocusedBrowseState;
    title: string;
}>) {
    if (state.status === 'loading') {
        return <div className='ptv-browse-focused-status'>Loading {title}...</div>;
    }

    if (state.status === 'error') {
        return (
            <div className='ptv-browse-focused-status ptv-browse-row-failure'>
                <strong>{state.error}</strong>
                <button type='button' onClick={onRetry}>
                    <PtvIcon name='refresh' />
                    <span>Retry</span>
                </button>
            </div>
        );
    }

    if (isPtvBrowseDirectoryView(route)) {
        return <BrowseDirectory directory={state.directory} route={route} />;
    }

    return <PtvFocusedBrowseItems route={route} state={state} />;
}

function PtvFocusedBrowsePage({ config, onBackdropChange, route, scope }: Readonly<{
    config: PtvBrowseConfig;
    onBackdropChange: (url: string) => void;
    route: PtvBrowseRoute;
    scope: PtvBrowseResolvedScope;
}>) {
    const [retryNonce, setRetryNonce] = useState(0);
    const [state, setState] = useState<PtvFocusedBrowseState>(EMPTY_FOCUSED_BROWSE_STATE);
    const title = getFocusedBrowseTitle(route, config);
    const loadOwnerRef = useRef(new PtvFocusedBrowseLoadOwner());
    const loaderKey = getPtvFocusedBrowseLoaderKey(route, scope);
    const loadInputRef = useRef({ loaderKey, route, scope });

    loadInputRef.current = { loaderKey, route, scope };

    useEffect(() => {
        const loadInput = loadInputRef.current;
        const loadOwner = loadOwnerRef.current;
        const loadToken = loadOwner.begin(loadInput.loaderKey);
        const routeAbortController = createPtvAbortController();
        const startedAt = performance.now();
        const routeGeneration = getPtvRouteControllerState().routeGeneration;

        setState(EMPTY_FOCUSED_BROWSE_STATE);
        void loadPtvFocusedBrowseState(
            loadInput.route,
            loadInput.scope,
            routeAbortController.signal
        ).then(nextState => {
            if (!loadOwner.isActive(loadToken) || getPtvRouteControllerState().routeGeneration !== routeGeneration) {
                recordPtvEvent('route', 'focused-browse-stale-response-suppressed', {
                    kind: loadInput.route.kind,
                    loaderKey: getPtvFocusedBrowseDiagnosticLoaderKey(loadInput.route, loadInput.scope),
                    view: loadInput.route.view
                });
                return;
            }

            const durationMs = Number((performance.now() - startedAt).toFixed(1));
            const readyState = { ...nextState, durationMs };

            setState(readyState);
            recordPtvEvent('route', 'focused-browse-loaded', {
                cacheKeyCategory: `${loadInput.route.kind}:${loadInput.route.view}`,
                durationMs,
                filterLabel: ['genre', 'network', 'studio'].includes(loadInput.route.filterType) ? loadInput.route.filterValue : '',
                filterType: loadInput.route.filterType,
                filterValuePresent: Boolean(loadInput.route.filterValue),
                itemCount: readyState.items.length,
                kind: loadInput.route.kind,
                limit: loadInput.route.pageSize,
                loaderKey: getPtvFocusedBrowseDiagnosticLoaderKey(loadInput.route, loadInput.scope),
                page: loadInput.route.page,
                routeKeyCategory: `${loadInput.route.kind}:${loadInput.route.view}`,
                sortBy: loadInput.route.sortBy,
                sortOrder: loadInput.route.sortOrder,
                scopeStatus: loadInput.scope.status,
                startIndex: loadInput.route.page * loadInput.route.pageSize,
                totalRecordCount: readyState.totalRecordCount,
                view: loadInput.route.view
            });
        }).catch(error => {
            if (!loadOwner.isActive(loadToken) || getPtvRouteControllerState().routeGeneration !== routeGeneration) return;

            const message = error instanceof Error ? error.message : 'This browse view could not be loaded.';

            setState({
                ...EMPTY_FOCUSED_BROWSE_STATE,
                durationMs: Number((performance.now() - startedAt).toFixed(1)),
                error: message,
                status: 'error'
            });
            recordPtvEvent('route', 'focused-browse-failed', {
                error: message,
                kind: loadInput.route.kind,
                loaderKey: getPtvFocusedBrowseDiagnosticLoaderKey(loadInput.route, loadInput.scope),
                scopeStatus: loadInput.scope.status,
                view: loadInput.route.view
            });
        });

        return () => {
            routeAbortController.abort();
            loadOwner.retire(loadToken);
        };
    }, [loaderKey, retryNonce]);
    const handleRetry = useCallback(() => {
        setRetryNonce(value => value + 1);
    }, []);
    const showToolbar = !isPtvBrowseDirectoryView(route) && route.view !== 'season';
    const backdropUrl = getBrowseBackdropImage(state.items[0] || null);

    useEffect(() => {
        onBackdropChange(backdropUrl);
    }, [backdropUrl, onBackdropChange]);

    return (
        <main className='ptv-browse-focused-content' aria-busy={state.status === 'loading'}>
            <header className='ptv-browse-focused-header'>
                <div>
                    <span className='ptv-browse-section-kicker'>{getFocusedBrowseKicker(route)}</span>
                    <h1>{title}</h1>
                    <p>{getPtvFocusedBrowseStatusText(state)}</p>
                </div>
                <a className='ptv-browse-focused-back' href={getPtvFocusedBrowseBackHref(route)}>
                    Back to {config.title}
                </a>
            </header>

            {showToolbar ? <PtvFocusedBrowseToolbar route={route} /> : null}
            <PtvFocusedBrowseBody onRetry={handleRetry} route={route} state={state} title={title} />

            <PtvFocusedBrowseDebug route={route} scope={scope} state={state} title={title} />
        </main>
    );
}

function NativeBrowsePage() {
    const location = useLocation();
    const route = useMemo(
        () => parsePtvBrowseRoute(location.pathname, location.search),
        [location.pathname, location.search]
    );
    const config = useMemo(
        () => getPtvBrowseConfig(location.pathname, route.scopeAlias),
        [location.pathname, route.scopeAlias]
    );
    const scopeIdentityKey = getPtvBrowseScopeIdentityKey();
    const scopeResolutionKey = `${scopeIdentityKey || 'identity-pending'}:${route.kind}:${route.scopeAlias || ''}`;
    const [resolvedScope, setResolvedScope] = useState<Readonly<{
        key: string;
        scope: PtvBrowseResolvedScope | null;
    }>>({ key: '', scope: null });

    useEffect(() => {
        let cancelled = false;
        const scopeAbortController = createPtvAbortController();
        const requestIdentityKey = scopeIdentityKey;

        setResolvedScope(current => current.key === scopeResolutionKey && current.scope ? current : {
            key: scopeResolutionKey,
            scope: null
        });
        void resolvePtvBrowseScope(route, scopeAbortController.signal).then(scope => {
            if (!cancelled && isPtvBrowseScopeIdentityCurrent(requestIdentityKey)) {
                setResolvedScope({ key: scopeResolutionKey, scope });
            }
        }).catch(error => {
            if (cancelled || error?.name === 'AbortError') return;

            recordPtvEvent('route', 'browse-scope-resolution-failed', {
                error: error instanceof Error ? error.message : String(error),
                kind: route.kind,
                scopeAlias: route.scopeAlias
            });
        });

        return () => {
            cancelled = true;
            scopeAbortController.abort();
        };
    }, [route, scopeIdentityKey, scopeResolutionKey]);

    const scope = resolvedScope.key === scopeResolutionKey ? resolvedScope.scope : null;
    const { backdropUrl, setBackdropUrl, backdropPresentationKey } = usePtvBrowseBackdrop(scopeResolutionKey, scope?.status === 'resolved' || scope?.status === 'unscoped');
    const browseLibraryTitle = useMemo(() => getPtvBrowseLibraryTitle(config, route), [config, route]);
    const title = route.view === 'landing' ? browseLibraryTitle : getFocusedBrowseTitle(route, config);
    const backdropSource = route.view === 'landing' ? `${config.kind}-hero` : `${route.kind}-${route.view}`;

    let browseContent;
    if (!scope) {
        browseContent = (
            <main className='ptv-browse-focused-content' aria-busy='true'>
                <div className='ptv-browse-focused-status'>Resolving your {browseLibraryTitle}...</div>
            </main>
        );
    } else if (scope.status === 'error') {
        browseContent = (
            <main className='ptv-browse-focused-content'>
                <div className='ptv-browse-focused-status' role='alert'>{scope.error || 'The selected library is unavailable.'}</div>
            </main>
        );
    } else if (route.view === 'landing') {
        browseContent = (
            <PtvBrowseLandingPage
                key={scopeResolutionKey}
                config={config}
                location={location}
                onBackdropChange={setBackdropUrl}
                title={title}
                route={route}
                scope={scope}
            />
        );
    } else {
        browseContent = (
            <PtvFocusedBrowsePage
                key={scopeResolutionKey}
                config={config}
                onBackdropChange={setBackdropUrl}
                route={route}
                scope={scope}
            />
        );
    }

    return (
        <Page
            id='ptv-native-browse-page'
            title={`${PTV_BRANDING.appName} ${title}`}
            className='ptv-native-browse-page'
            isBackButtonEnabled={false}
            isMenuButtonEnabled={false}
            isNowPlayingBarEnabled={false}
            isThemeMediaSupported={false}
        >
            <PTVShell
                backdropPresentationKey={backdropPresentationKey}
                backdropSource={backdropSource}
                backdropUrl={backdropUrl}
                className='ptv-browse-shell'
                section={getPtvBrowseShellSection(config)}
                title={title}
            >
                {browseContent}
            </PTVShell>
        </Page>
    );
}

registerPtvNativeRoute('/movies', NativeBrowsePage, 'native');
registerPtvNativeRoute('/movies/*', NativeBrowsePage, 'native');
registerPtvNativeRoute('/shows', NativeBrowsePage, 'native');
registerPtvNativeRoute('/shows/*', NativeBrowsePage, 'native');
registerPtvNativeRoute('/tv', NativeBrowsePage, 'native');
registerPtvNativeRoute('/tv/*', NativeBrowsePage, 'native');
const PremiumCollectionsPage = React.lazy(() => import('../../modules/collections/CollectionsPage'));

function NativeCollectionsPage() {
    return (
        <React.Suspense fallback={<div className='ptv-nativeBrowseLoading' aria-busy='true'>Loading Collections…</div>}>
            <PremiumCollectionsPage />
        </React.Suspense>
    );
}

registerPtvNativeRoute('/collections', NativeCollectionsPage, 'native');
registerPtvNativeRoute('/collections/*', NativeCollectionsPage, 'native');

export default NativeBrowsePage;
