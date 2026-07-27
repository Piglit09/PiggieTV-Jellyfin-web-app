import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Page from 'components/Page';

import {
    getPtvImageFailureDiagnostics,
    getPtvItemImageCandidates,
    getPtvItemImageUrl,
    hasPtvImageCandidateFailed,
    markPtvImageCandidateFailed,
    playPtvItem,
    queuePtvItems,
    recordPtvImageFallback,
    setPtvFavorite,
    type PtvItemImageCandidate,
    type PtvImageOptions,
    type PtvItem,
    type PtvLibrary
} from '../../api';
import { getPtvPerformanceProfile } from '../../core/clientProfile';
import { PTV_ASSETS, PTV_BRANDING, PTV_ROUTES } from '../../core/config';
import {
    recordPtvItemRouteClick,
    resolvePtvItemRoute,
    type PtvItemRouteResult
} from '../../core/itemRoutes';
import { recordPtvEvent, shouldCollectDiagnostics } from '../../core/observability';
import { notifyPtvTvFocusContentReady } from '../../core/tvFocus';
import { resolvePtvStaticAssetUrl } from '../../core/urlOrigins';
import PTVShell from '../../shell/PTVShell';
import { registerPtvNativeRoute } from '../../shell/routeController';
import { usePtvAdminDebugVisibility } from '../../utils/usePtvAdminDebugVisibility';
import {
    getPtvQualityPillClass,
    getPtvQualityTags
} from '../../modules/cards/qualityTags';
import { PtvIcon } from '../../modules/icons';
import {
    getNativeHomeRowDiagnostics,
    dedupeNativeHomeItems,
    getNativeHomeItemVersionKey,
    type NativeHomeRow,
    useNativeHomeData,
    useNativeHomeVirtualRows
} from './hooks';
import {
    decorateNativeHomeRowsForCurrentLayout,
    loadNativeHomePersonalizationSettings,
    moveNativeHomePinnedRow,
    resetNativeHomeLayoutPreferences,
    toggleNativeHomePinnedRow,
    type NativeHomeAdaptiveDebug
} from './services/homeLayoutService';
import { openNativeHomeDetails } from './nativeHomeDetailsNavigation';

const POSTER_IMAGE_OPTIONS = {
    fillHeight: 480,
    fillWidth: 320,
    imageType: 'Primary',
    quality: 84
};

const LIBRARY_IMAGE_OPTIONS = {
    fillHeight: 267,
    fillWidth: 474,
    imageType: 'Thumb',
    quality: 84
};

const failedNativeHomeImageUrls = new Set<string>();
const reportedNativeHomeFallbackKeys = new Set<string>();
const reportedNativeHomeImageAttemptUrls = new Set<string>();
const PTV_READING_LIBRARY_CARD_PATTERN = /\b(?:book|books|comic|comics|manga|maga|manhwa|manhua|reader|reading)\b/i;
const LOW_POWER_IMAGE_SCALE = 0.76;
const MOBILE_IMAGE_SCALE = 0.86;

type NativeHomeAnyItem = PtvItem | PtvLibrary;
type NativeHomeMaybeItem = NativeHomeAnyItem | null | undefined;
type NativeHomeIntelligenceFocusSource = 'cancel' | 'clear' | 'focus' | 'hero' | 'mouse' | 'row' | 'select';
type NativeHomeActiveItemHandler = (
    item: PtvItem | null,
    source: NativeHomeIntelligenceFocusSource,
    row?: NativeHomeRow | null
) => void;
type NativeHomeRowLayoutAction = 'down' | 'pin' | 'reset' | 'unpin' | 'up';
type NativeHomeRowLayoutActionHandler = (rowId: string, action: NativeHomeRowLayoutAction) => void;
type NativeHomeHeroProps = Readonly<{
    activeItem: PtvItem | null;
    canAutoRotate: boolean;
    heroItem: PtvItem | null;
    heroItems: PtvItem[];
    onActiveBackdropItemChange: (item: PtvItem | null) => void;
}>;
type NativeHomeCardProps = Readonly<{
    item: NativeHomeAnyItem;
    onActivate: (item: NativeHomeAnyItem | null, source: NativeHomeIntelligenceFocusSource) => void;
    row: NativeHomeRow;
}>;
type NativeHomeRowScrollerProps = Readonly<{
    onActiveItemChange: (item: NativeHomeAnyItem | null, source: NativeHomeIntelligenceFocusSource) => void;
    row: NativeHomeRow;
}>;
type NativeHomeRowViewProps = Readonly<{
    canShowDebug: boolean;
    isMounted: boolean;
    onActiveBackdropItemChange: NativeHomeActiveItemHandler;
    onLayoutAction: NativeHomeRowLayoutActionHandler;
    row: NativeHomeRow;
}>;
type NativeHomeFallbackProps = Readonly<{ message: string }>;
type NativeHomeCinematicBackdropProps = Readonly<{
    activeItem: PtvItem | null;
    heroItem: PtvItem | null;
    rows: NativeHomeRow[];
}>;
type NativeHomeCrossfadeBackdropLayerProps = Readonly<{
    layer: 'fallback' | 'hero' | 'section';
    src: string;
}>;
type NativeHomeHeroBackdropProps = Readonly<{
    item: PtvItem | null;
    objectPosition: string;
    src: string;
}>;
type NativeHomeRecommendationExplanation = Readonly<{
    confidence: number;
    genres: string[];
    lead: string;
    matchedItems: string[];
    type: string;
}>;

const NATIVE_HOME_HERO_ROTATION_MS = 12000;
const NATIVE_HOME_HERO_INACTIVITY_ROTATION_MS = 52000;
const NATIVE_HOME_SMART_HERO_MOUSE_DELAY_MS = 540;
const NATIVE_HOME_SMART_HERO_FOCUS_DELAY_MS = 320;
const NATIVE_HOME_SMART_HERO_MIN_COMMIT_GAP_MS = 980;
const NATIVE_HOME_SCROLL_SUPPRESSION_MS = 720;
const NATIVE_HOME_IMAGE_PREFETCH_CACHE_LIMIT = 90;
const NATIVE_HOME_FAILED_ARTWORK_CACHE_LIMIT = 70;
const prefetchedNativeHomeImageUrls = new Map<string, number>();
const failedNativeHomeHeroArtworkUrls = new Map<string, string>();

function getNativeHomeDebugImageType(candidate: PtvItemImageCandidate) {
    return candidate.requestedType;
}

function getNativeHomeScaledImageOptions(options: PtvImageOptions): PtvImageOptions {
    const profile = getPtvPerformanceProfile();

    const scale = profile.isLowPower || profile.isFireTv ?
        LOW_POWER_IMAGE_SCALE :
        profile.clientKind === 'mobile' ? MOBILE_IMAGE_SCALE : 1;

    if (scale === 1) return options;

    const scaleDimension = (value?: number) => value ? Math.max(120, Math.round(value * scale)) : value;
    const maxQuality = profile.clientKind === 'mobile' && !profile.isLowPower && !profile.isFireTv ? 86 : 82;

    return {
        ...options,
        fillHeight: scaleDimension(options.fillHeight),
        fillWidth: scaleDimension(options.fillWidth),
        maxHeight: scaleDimension(options.maxHeight),
        maxWidth: scaleDimension(options.maxWidth),
        quality: Math.min(options.quality || 88, maxQuality)
    };
}

function getItemValue<TValue = unknown>(
    item: NativeHomeMaybeItem,
    ...keys: string[]
): TValue | null {
    if (!item) return null;

    for (const key of keys) {
        const value = item[key];

        if (value !== undefined && value !== null) {
            return value as TValue;
        }
    }

    return null;
}

function getItemString(item: NativeHomeMaybeItem, ...keys: string[]) {
    const value = getItemValue(item, ...keys);

    return typeof value === 'string' ? value : '';
}

function getItemNumber(item: NativeHomeMaybeItem, ...keys: string[]) {
    const value = getItemValue(item, ...keys);

    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getItemImageTags(item: NativeHomeMaybeItem): Record<string, string> {
    return getItemValue<Record<string, string>>(item, 'ImageTags', 'imageTags') || {};
}

function getItemStringArray(item: NativeHomeMaybeItem, ...keys: string[]) {
    const value = getItemValue(item, ...keys);

    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry)) : [];
}

function getItemObjectArray(item: NativeHomeMaybeItem, ...keys: string[]) {
    const value = getItemValue(item, ...keys);

    return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object') : [];
}

function getItemId(item: NativeHomeMaybeItem) {
    return getItemString(item, 'Id', 'id');
}

function getItemServerId(item: NativeHomeMaybeItem) {
    return getItemString(item, 'ServerId', 'serverId');
}

function getItemUserData(item: NativeHomeMaybeItem) {
    return getItemValue<PtvItem['UserData']>(item, 'UserData', 'userData') || {};
}

function getNativeHomeProgressPercent(item: NativeHomeMaybeItem) {
    const userData = getItemUserData(item);
    const positionTicks = Number(userData.PlaybackPositionTicks || 0);
    const runtimeTicks = getItemNumber(item, 'RunTimeTicks', 'RuntimeTicks', 'runTimeTicks', 'runtimeTicks') || 0;

    if (!positionTicks || !runtimeTicks) return 0;

    return Math.max(1, Math.min(99, Math.round((positionTicks / runtimeTicks) * 100)));
}

function getItemTitle(item: NativeHomeMaybeItem) {
    return getItemString(item, 'Name', 'name', 'Title', 'title') || 'Untitled';
}

function isNativeHomeReadingLibraryItem(item: NativeHomeMaybeItem) {
    const collectionType = getItemString(item, 'CollectionType', 'collectionType').toLowerCase();

    return collectionType === 'books' || PTV_READING_LIBRARY_CARD_PATTERN.test(getItemTitle(item));
}

function getNativeHomeLibraryCardHref(item: NativeHomeMaybeItem) {
    const customHref = getItemString(item, 'PtvHref', 'ptvHref');

    if (customHref) return customHref;
    if (isNativeHomeReadingLibraryItem(item)) return PTV_ROUTES.reading;

    const itemId = getItemId(item);

    return itemId ? `#/list?parentId=${encodeURIComponent(itemId)}` : PTV_ROUTES.home;
}

function getNativeHomeDisplayItems(row: NativeHomeRow): NativeHomeAnyItem[] {
    if (row.kind !== 'libraries') return row.items;

    const readingLibraries = row.items.filter(isNativeHomeReadingLibraryItem);

    if (!readingLibraries.length) return row.items;

    const [primaryReadingLibrary] = readingLibraries;
    const otherLibraries = row.items.filter(item => !isNativeHomeReadingLibraryItem(item));

    return [
        {
            ...primaryReadingLibrary,
            CollectionType: 'PTV Reading',
            Name: 'PTV Reading',
            PtvHref: PTV_ROUTES.reading
        },
        ...otherLibraries
    ];
}

const NATIVE_HOME_ROW_ACCENT_PALETTE = [
    '151, 84, 255',
    '142, 220, 255',
    '230, 77, 255',
    '255, 202, 92',
    '76, 211, 194',
    '255, 118, 170'
] as const;

const NATIVE_HOME_ITEM_ACCENT_PALETTE = [
    '151, 84, 255',
    '120, 190, 255',
    '235, 90, 255',
    '255, 146, 92',
    '84, 224, 198',
    '255, 210, 96',
    '255, 94, 132',
    '106, 124, 255'
] as const;

function getNativeHomeStringHash(value: string) {
    let hash = 0;

    for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    }

    return Math.abs(hash);
}

function getNativeHomeItemAccent(item: NativeHomeMaybeItem, row?: NativeHomeRow) {
    const text = [
        row?.title,
        row?.sourceValue,
        getItemTitle(item),
        getItemString(item, 'Type', 'type'),
        getItemString(item, 'MediaType', 'mediaType'),
        ...getItemStringArray(item, 'Genres', 'genres'),
        ...getItemStringArray(item, 'Studios', 'studios')
    ].filter(Boolean).join(' ').toLowerCase();

    if (/\b(horror|thriller|slasher|dead|blood|crime)\b/.test(text)) return '255, 84, 124';
    if (/\b(anime|animation|cartoon|family|fantasy)\b/.test(text)) return '120, 190, 255';
    if (/\b(music|album|artist|song|concert|rock|metal|pop)\b/.test(text)) return '84, 224, 198';
    if (/\b(comedy|sitcom|stand[-\s]?up)\b/.test(text)) return '255, 210, 96';
    if (/\b(action|adventure|war|western)\b/.test(text)) return '255, 146, 92';
    if (/\b(romance|drama)\b/.test(text)) return '235, 90, 255';

    const key = `${row?.id || ''}:${getItemId(item)}:${getItemTitle(item)}`;

    return NATIVE_HOME_ITEM_ACCENT_PALETTE[getNativeHomeStringHash(key) % NATIVE_HOME_ITEM_ACCENT_PALETTE.length];
}

function getNativeHomeRowAccentStyle(row: NativeHomeRow, activeItem?: NativeHomeMaybeItem): React.CSSProperties {
    const key = `${row.id}:${row.title}:${row.sourceValue || row.mediaType || row.source}`;
    const accent = activeItem ?
        getNativeHomeItemAccent(activeItem, row) :
        NATIVE_HOME_ROW_ACCENT_PALETTE[getNativeHomeStringHash(key) % NATIVE_HOME_ROW_ACCENT_PALETTE.length];

    return {
        '--ptv-native-row-accent-rgb': accent,
        '--ptv-native-row-ambient-opacity': activeItem ? '0.08' : '0.055',
        '--ptv-native-row-ambient-secondary-opacity': activeItem ? '0.058' : '0.04'
    } as React.CSSProperties;
}

function getNativeHomePageAccentStyle(item?: NativeHomeMaybeItem): React.CSSProperties {
    return {
        '--ptv-native-page-accent-rgb': getNativeHomeItemAccent(item)
    } as React.CSSProperties;
}

function getNativeHomeRowBackdropItem(row: NativeHomeRow): PtvItem | null {
    return getNativeHomeDisplayItems(row)
        .find(item => getNativeHomeImageCandidates(item, row).some(candidate => (
            candidate.requestedType === 'Backdrop' || candidate.requestedType === 'Thumb'
        ))) as PtvItem | undefined || null;
}

function getNativeHomeHeroKey(item: NativeHomeMaybeItem) {
    return getItemId(item) || getItemTitle(item);
}

function rememberNativeHomeBoundedCacheValue<TValue>(
    cache: Map<string, TValue>,
    key: string,
    value: TValue,
    limit: number
) {
    if (cache.has(key)) {
        cache.delete(key);
    }

    cache.set(key, value);

    while (cache.size > limit) {
        const oldestKey = cache.keys().next().value;

        if (!oldestKey) break;
        cache.delete(oldestKey);
    }
}

function preloadNativeHomeImageUrl(url: string) {
    if (!url || prefetchedNativeHomeImageUrls.has(url) || failedNativeHomeHeroArtworkUrls.has(url)) return;

    rememberNativeHomeBoundedCacheValue(
        prefetchedNativeHomeImageUrls,
        url,
        performance.now(),
        NATIVE_HOME_IMAGE_PREFETCH_CACHE_LIMIT
    );
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
}

function preloadNativeHomeHeroAssets(item: NativeHomeMaybeItem, profile: ReturnType<typeof getPtvPerformanceProfile>) {
    if (!item || profile.isFireTv || profile.isLowPower) return;

    const backdropUrl = getNativeHomeHeroBackdropUrl(item as PtvItem, profile);
    const logoUrl = getItemImageTags(item).Logo ? getPtvItemImageUrl(item as PtvItem, {
        imageType: 'Logo',
        maxWidth: profile.heroLogoMaxWidth,
        quality: profile.clientKind === 'mobile' ? 88 : 94
    }) : '';

    preloadNativeHomeImageUrl(backdropUrl);
    preloadNativeHomeImageUrl(logoUrl);
}

function getItemMeta(item: NativeHomeMaybeItem) {
    const parts = [
        getItemNumber(item, 'ProductionYear', 'productionYear'),
        getItemString(item, 'Type', 'type'),
        getItemString(item, 'OfficialRating', 'officialRating')
    ].filter(Boolean);

    return parts.join(' | ');
}

function getHeroMeta(item: PtvItem | null) {
    if (!item) return PTV_BRANDING.loginDescription;

    const rating = getItemNumber(item, 'CommunityRating', 'communityRating');

    return [
        getItemNumber(item, 'ProductionYear', 'productionYear'),
        getItemString(item, 'Type', 'type'),
        rating ? `Rating ${rating.toFixed(1)}` : ''
    ].filter(Boolean).join('  ');
}

function formatNativeHomeRuntime(ticks: number | null) {
    if (!ticks) return '';

    const minutes = Math.round(ticks / 600000000);
    const hours = Math.floor(minutes / 60);
    const remainderMinutes = minutes % 60;

    if (hours > 0 && remainderMinutes > 0) return `${hours}h ${remainderMinutes}m`;
    if (hours > 0) return `${hours}h`;

    return `${minutes}m`;
}

function getNativeHomeProviderIds(item: NativeHomeMaybeItem) {
    return getItemValue<Record<string, unknown>>(item, 'ProviderIds', 'providerIds') || {};
}

function getNativeHomeRuntimeOrSeasons(item: NativeHomeMaybeItem) {
    const itemType = getItemString(item, 'Type', 'type').toLowerCase();

    if (itemType === 'series') {
        const seasonCount = getItemNumber(item, 'ChildCount', 'SeasonCount', 'seasonCount');

        if (seasonCount) return `${seasonCount} season${seasonCount === 1 ? '' : 's'}`;
    }

    return formatNativeHomeRuntime(getItemNumber(item, 'RunTimeTicks', 'RuntimeTicks', 'runTimeTicks', 'runtimeTicks'));
}

function getNativeHomeScoreParts(item: NativeHomeMaybeItem) {
    const communityRating = getItemNumber(item, 'CommunityRating', 'communityRating');
    const criticRating = getItemNumber(item, 'CriticRating', 'criticRating');
    const parts: string[] = [];

    if (communityRating) parts.push(`IMDb ★ ${communityRating.toFixed(1)}`);
    if (criticRating) parts.push(`TMDB ${Math.round(criticRating)}%`);

    return parts;
}

function getHeroMetaGroups(item: PtvItem | null) {
    if (!item) return [];

    const certification = getItemString(item, 'OfficialRating', 'officialRating');
    const runtimeOrSeasons = getNativeHomeRuntimeOrSeasons(item);
    const genres = getItemStringArray(item, 'Genres', 'genres').slice(0, 3);
    const qualityTags = getPtvQualityTags(item, { maxTags: 10 });
    const quality = qualityTags
        .filter(tag => ['audio', 'resolution', 'video-feature'].includes(tag.category))
        .map(tag => tag.label)
        .slice(0, 4);
    const groups = [
        {
            id: 'facts',
            parts: [
                getItemNumber(item, 'ProductionYear', 'productionYear'),
                certification,
                runtimeOrSeasons
            ].filter(Boolean).map(String)
        },
        {
            id: 'genres',
            parts: genres,
            secondary: true
        },
        {
            id: 'scores',
            parts: getNativeHomeScoreParts(item)
        },
        {
            id: 'quality',
            parts: quality,
            secondary: true
        }
    ];

    return groups.filter(group => group.parts.length);
}

function getNativeHomeCardSpotlightMetaParts(item: NativeHomeMaybeItem) {
    return [
        getNativeHomeRuntimeOrSeasons(item),
        getItemStringArray(item, 'Genres', 'genres').slice(0, 2).join(' / '),
        getItemString(item, 'OfficialRating', 'officialRating'),
        ...getNativeHomeScoreParts(item).slice(0, 1)
    ].filter(Boolean).map(String);
}

function getNativeHomeCardSpotlightSynopsis(item: NativeHomeMaybeItem, fallback = '') {
    return getItemString(item, 'Overview', 'overview') || fallback;
}

function isNativeHomeRecommendationRow(row: NativeHomeRow) {
    return row.source === 'recommendation'
        || row.rowType === 'generated-recommendation'
        || row.renderedSource === 'recommendation-settings';
}

function getTopNativeHomeRowGenres(row: NativeHomeRow) {
    const counts = new Map<string, number>();

    getNativeHomeDisplayItems(row).forEach(item => {
        getItemStringArray(item, 'Genres', 'genres').forEach(genre => {
            const trimmed = genre.trim();

            if (!trimmed) return;
            counts.set(trimmed, (counts.get(trimmed) || 0) + 1);
        });
    });

    return Array.from(counts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 3)
        .map(([genre]) => genre);
}

function getNativeHomeRecommendationType(row: NativeHomeRow) {
    const key = `${row.id} ${row.title} ${row.subtitle} ${row.mediaType || ''}`.toLowerCase();

    if (/\b(listen|music|album|artist|song)\b/.test(key)) return 'Music affinity';
    if (/\bwatch|watched|history|resume\b/.test(key)) return 'Watch history';
    if (/\bdiscover|discovery|fresh|unwatched\b/.test(key)) return 'Discovery';
    if (/\brediscover|again|library\b/.test(key)) return 'Rediscovery';
    if (/\bread|book|comic|manga\b/.test(key)) return 'Reading affinity';

    return 'Taste match';
}

function getNativeHomeRecommendationLead(row: NativeHomeRow) {
    const key = `${row.id} ${row.title}`.toLowerCase();
    const genres = getTopNativeHomeRowGenres(row);
    const genrePhrase = genres.slice(0, 2).join(' and ');

    if (/\bbecause-you-watched|watched\b/.test(key)) {
        return genres.length
            ? `More stories that match your recent ${genrePhrase} favorites.`
            : 'Shaped by what you recently watched.';
    }

    if (/\bbecause-you-like-music|made-for-you-music|music\b/.test(key)) return 'Tracks and artists close to your recent listening.';
    if (/\brediscover\b/.test(key)) return 'Favorites and overlooked picks worth another visit.';
    if (/\bdiscovery\b/.test(key)) return 'Fresh discovery outside your usual rotation.';
    if (genres.length) return `More from genres you enjoy: ${genrePhrase}.`;

    return row.subtitle || "Curated from what you've been enjoying recently.";
}

function getNativeHomeRecommendationConfidence(row: NativeHomeRow) {
    const finalCount = row.finalRenderedCount || getNativeHomeDisplayItems(row).length;
    const candidateCount = Math.max(row.candidateCount || finalCount, finalCount, 1);
    const density = finalCount / candidateCount;
    const hydrationBoost = row.recommendationItemsHydrated ? 4 : 0;

    return Math.max(62, Math.min(96, Math.round(74 + (density * 18) + hydrationBoost)));
}

function getNativeHomeRecommendationExplanation(row: NativeHomeRow): NativeHomeRecommendationExplanation | null {
    if (!isNativeHomeRecommendationRow(row)) return null;

    return {
        confidence: getNativeHomeRecommendationConfidence(row),
        genres: getTopNativeHomeRowGenres(row),
        lead: getNativeHomeRecommendationLead(row),
        matchedItems: getNativeHomeDisplayItems(row).map(getItemTitle).filter(Boolean).slice(0, 3),
        type: getNativeHomeRecommendationType(row)
    };
}

function getNativeHomeRecommendationBadgeLabel(row: NativeHomeRow) {
    const confidence = getNativeHomeRecommendationConfidence(row);
    const type = getNativeHomeRecommendationType(row);

    if (confidence >= 88) return 'Highly Recommended';
    if (type === 'Discovery') return 'Fresh Pick';
    if (type === 'Rediscovery') return 'Worth Another Look';
    if (type === 'Music affinity') return 'For Your Music Taste';
    if (type === 'Watch history') return 'Based on Recent Watching';

    return 'Recommended';
}

function getNativeHomeRowConfiguredDescription(row: NativeHomeRow) {
    const value = row as NativeHomeRow & {
        description?: unknown;
        editorialDescription?: unknown;
        editorialSubtitle?: unknown;
    };
    const description = value.editorialDescription || value.description || value.editorialSubtitle;

    return typeof description === 'string' ? description.trim() : '';
}

function getNativeHomeRowEditorialDescription(row: NativeHomeRow) {
    const configuredDescription = getNativeHomeRowConfiguredDescription(row);

    if (configuredDescription) return configuredDescription;

    const key = `${row.id} ${row.title} ${row.subtitle} ${row.sourceValue || ''}`.toLowerCase();

    if (/\bcontinue watching|resume|next-up\b/.test(key)) return 'Pick up right where the story paused.';
    if (/\bcontinue listening\b/.test(key)) return 'Resume the sound you already had in motion.';
    if (/\bcontinue reading\b/.test(key)) return 'Open the next page without losing your place.';
    if (/\blatest movies|new movies|recent movies\b/.test(key)) return 'New film arrivals ready for tonight.';
    if (/\blatest shows|new shows|recent episodes\b/.test(key)) return 'Fresh episodes waiting to be discovered.';
    if (/\blatest anime|new anime\b/.test(key)) return 'Fresh anime picks from the newest additions.';
    if (/\blatest cartoons|new cartoons\b/.test(key)) return 'Bright, quick watches from the newest cartoon shelves.';
    if (/\bmusic|album|artist|song\b/.test(key)) return 'Albums, tracks, and artists tuned to your recent listening.';
    if (/\breading|books|comic|manga\b/.test(key)) return 'Books, comics, and manga with a clear path back in.';
    if (/\bcollections?\b/.test(key)) return 'Franchises and curated sets gathered into one place.';
    if (/\bgenres?\b/.test(key)) return 'A focused lane through the moods you return to.';
    if (/\brediscover\b/.test(key)) return 'Favorites and overlooked picks worth another visit.';
    if (/\bdiscover|discovery\b/.test(key)) return 'A few fresh turns outside your usual rotation.';
    if (isNativeHomeRecommendationRow(row)) return "Curated from what you've been enjoying recently.";
    if (/\bdisney\b/.test(key)) return 'Pixar, classics, and timeless family adventures.';
    if (/\ba24\b/.test(key)) return 'Modern horror, indie cinema, and award-winning dramas.';
    if (/\bstudio|studios\b/.test(key)) return 'A studio-focused shelf with a distinct point of view.';
    if (/\blibrary|libraries\b/.test(key)) return 'Jump into your saved PiggieTV spaces.';
    if (row.sourceValue) return `Curated from ${row.sourceValue}.`;

    return row.subtitle || '';
}

function getNativeHomeRemoteTrailerUrl(item: NativeHomeMaybeItem) {
    const remoteTrailers = getItemValue<Array<Record<string, unknown>>>(item, 'RemoteTrailers', 'remoteTrailers');

    if (!Array.isArray(remoteTrailers)) return '';

    const trailer = remoteTrailers.find(entry => typeof entry.Url === 'string' || typeof entry.url === 'string');

    return typeof trailer?.Url === 'string' ? trailer.Url : typeof trailer?.url === 'string' ? trailer.url : '';
}

function getNativeHomeTrailerHref(item: NativeHomeMaybeItem) {
    return getNativeHomeRemoteTrailerUrl(item);
}

function getNativeHomeHeroBackdropPosition(item: NativeHomeMaybeItem) {
    const text = [
        getItemTitle(item),
        getItemString(item, 'Type', 'type'),
        ...getItemStringArray(item, 'Genres', 'genres'),
        ...getItemStringArray(item, 'Studios', 'studios')
    ].filter(Boolean).join(' ').toLowerCase();

    if (/\b(anime|animation|cartoon)\b/.test(text)) return '58% center';
    if (/\b(music|concert|documentary)\b/.test(text)) return '52% center';
    if (/\b(horror|thriller|crime|mystery)\b/.test(text)) return '56% center';
    if (/\b(action|adventure|fantasy|sci[-\s]?fi)\b/.test(text)) return '62% center';

    return '58% center';
}

function getDetailsHref(item: NativeHomeMaybeItem) {
    return resolvePtvItemRoute(item as Record<string, unknown> | null | undefined).href;
}

function getPlaybackHref(item: NativeHomeMaybeItem) {
    return getDetailsHref(item);
}

function getNativeHomeRowAnchor(rowId: string) {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-ptv-native-home-row-id]'));

    return nodes.find(node => node.dataset.ptvNativeHomeRowId === rowId) || null;
}

type NativeHomeRowNavState = {
    canScrollLeft: boolean;
    canScrollRight: boolean;
    clientWidth: number | null;
    navButtonsMounted: boolean;
    overflowX: string | null;
    pointerEvents: string | null;
    scrollerFound: boolean;
    scrollLeft: number | null;
    scrollWidth: number | null;
    touchAction: string | null;
};

const NATIVE_HOME_ROW_NAV_TOLERANCE = 2;

function getNativeHomeRowNavState(
    scroller: HTMLElement | null,
    navButtonsMounted = false
): NativeHomeRowNavState {
    if (!scroller) {
        return {
            canScrollLeft: false,
            canScrollRight: false,
            clientWidth: null,
            navButtonsMounted,
            overflowX: null,
            pointerEvents: null,
            scrollerFound: false,
            scrollLeft: null,
            scrollWidth: null,
            touchAction: null
        };
    }

    const style = window.getComputedStyle(scroller);
    const scrollLeft = Number(scroller.scrollLeft.toFixed(1));
    const clientWidth = Number(scroller.clientWidth.toFixed(1));
    const scrollWidth = Number(scroller.scrollWidth.toFixed(1));

    return {
        canScrollLeft: scrollLeft > NATIVE_HOME_ROW_NAV_TOLERANCE,
        canScrollRight: scrollLeft + clientWidth < scrollWidth - NATIVE_HOME_ROW_NAV_TOLERANCE,
        clientWidth,
        navButtonsMounted,
        overflowX: style.overflowX,
        pointerEvents: style.pointerEvents,
        scrollerFound: true,
        scrollLeft,
        scrollWidth,
        touchAction: style.touchAction
    };
}

function areNativeHomeRowNavStatesEqual(
    left: NativeHomeRowNavState,
    right: NativeHomeRowNavState
) {
    return left.canScrollLeft === right.canScrollLeft
        && left.canScrollRight === right.canScrollRight
        && left.clientWidth === right.clientWidth
        && left.navButtonsMounted === right.navButtonsMounted
        && left.overflowX === right.overflowX
        && left.pointerEvents === right.pointerEvents
        && left.scrollerFound === right.scrollerFound
        && left.scrollLeft === right.scrollLeft
        && left.scrollWidth === right.scrollWidth
        && left.touchAction === right.touchAction;
}

function recordNativeHomeRowNavState(
    rowId: string,
    title: string,
    state: NativeHomeRowNavState,
    reason: string
) {
    if (!shouldCollectDiagnostics()) return;

    recordPtvEvent('render', 'native-home-row-nav-state', {
        canScrollLeft: state.canScrollLeft,
        canScrollRight: state.canScrollRight,
        clientWidth: state.clientWidth,
        navButtonsMounted: state.navButtonsMounted,
        overflowX: state.overflowX,
        pointerEvents: state.pointerEvents,
        reason,
        rowId,
        scrollerFound: state.scrollerFound,
        scrollLeft: state.scrollLeft,
        scrollWidth: state.scrollWidth,
        title,
        touchAction: state.touchAction
    });
}

function getNativeHomeRowLayout(rowId: string) {
    const node = getNativeHomeRowAnchor(rowId);
    const scroller = node?.querySelector<HTMLElement>('.ptv-native-home-scroller') || null;
    const navButtonsMounted = (node?.querySelectorAll('.ptv-row-nav').length || 0) >= 2;
    const placeholder = node?.querySelector<HTMLElement>('.ptv-native-home-row-placeholder') || null;
    const cardCount = node?.querySelectorAll('.ptv-native-card').length || 0;
    const navState = getNativeHomeRowNavState(scroller, navButtonsMounted);
    const style = node ? window.getComputedStyle(node) : null;
    const rect = node?.getBoundingClientRect();

    return {
        bottom: rect ? Number(rect.bottom.toFixed(1)) : null,
        canScrollLeft: navState.canScrollLeft,
        canScrollRight: navState.canScrollRight,
        cardCount,
        clientWidth: navState.clientWidth,
        display: style?.display || null,
        hasCards: cardCount > 0,
        hasPlaceholder: Boolean(placeholder),
        hasScroller: Boolean(scroller),
        height: rect ? Number(rect.height.toFixed(1)) : null,
        inDom: Boolean(node),
        navButtonsMounted: navState.navButtonsMounted,
        opacity: style?.opacity || null,
        overflowX: navState.overflowX,
        pointerEvents: navState.pointerEvents,
        scrollerFound: navState.scrollerFound,
        scrollLeft: navState.scrollLeft,
        scrollWidth: navState.scrollWidth,
        touchAction: navState.touchAction,
        top: rect ? Number(rect.top.toFixed(1)) : null,
        visibility: style?.visibility || null,
        width: rect ? Number(rect.width.toFixed(1)) : null
    };
}

function isPlayableItem(item: NativeHomeMaybeItem) {
    if (!getItemId(item)) return false;

    const mediaType = getItemString(item, 'MediaType', 'mediaType').toLowerCase();
    const collectionType = getItemString(item, 'CollectionType', 'collectionType').toLowerCase();
    const itemType = getItemString(item, 'Type', 'type').toLowerCase();

    if (mediaType === 'book' || collectionType === 'books' || itemType === 'book') return false;

    return mediaType === 'video'
        || mediaType === 'audio'
        || ['movie', 'episode', 'video', 'audio', 'musicvideo', 'program', 'tvchannel'].includes(itemType);
}

function isHeroPlayableItem(item: NativeHomeMaybeItem) {
    if (!getItemId(item)) return false;

    const mediaType = getItemString(item, 'MediaType', 'mediaType').toLowerCase();
    const collectionType = getItemString(item, 'CollectionType', 'collectionType').toLowerCase();
    const itemType = getItemString(item, 'Type', 'type').toLowerCase();

    if (mediaType === 'book' || collectionType === 'books' || itemType === 'book') return false;
    if (['boxset', 'collectionfolder', 'folder', 'photo'].includes(itemType)) return false;

    return true;
}

function getNativeHomeHeroPrimaryActionLabel(item: NativeHomeMaybeItem, route: PtvItemRouteResult | null) {
    if (route?.routeSource === 'ptv-reading') {
        const startPositionTicks = getItemUserData(item).PlaybackPositionTicks || 0;

        return startPositionTicks ? 'Continue Reading' : 'Read';
    }

    if (route?.routeSource === 'ptv-music') return 'Play';

    return getItemUserData(item).PlaybackPositionTicks ? 'Resume' : 'Play';
}

function canShowNativeHomeHeroPrimaryAction(item: NativeHomeMaybeItem, route: PtvItemRouteResult | null) {
    if (!getItemId(item)) return false;
    if (route?.routeSource === 'ptv-reading') return true;
    if (route?.routeSource === 'ptv-music') return true;

    return isHeroPlayableItem(item);
}

function getNativeHomeSpotlightPrimaryActionLabel(item: NativeHomeMaybeItem, route: PtvItemRouteResult | null) {
    if (route?.routeSource === 'ptv-reading') return getItemUserData(item).PlaybackPositionTicks ? 'Continue Reading' : 'Open';
    if (route?.routeSource === 'ptv-music') return 'Play';

    return getItemUserData(item).PlaybackPositionTicks ? 'Resume' : 'Play';
}

function getNativeHomeFavoriteActionLabel(route: PtvItemRouteResult | null, isFavorite: boolean) {
    if (isFavorite) return route?.routeSource === 'ptv-music' ? 'Liked' : 'Favorited';

    return route?.routeSource === 'ptv-music' ? 'Like' : 'Favorite';
}

function canOpenNativeHomeRouteAsPrimary(route: PtvItemRouteResult | null) {
    return route?.routeSource === 'ptv-reading';
}

function getNativeHomeMusicArtistHref(item: NativeHomeMaybeItem) {
    const artistEntries = [
        ...getItemObjectArray(item, 'ArtistItems', 'artistItems'),
        ...getItemObjectArray(item, 'AlbumArtistItems', 'albumArtistItems')
    ];
    const artistId = artistEntries
        .map(entry => typeof entry.Id === 'string' ? entry.Id : typeof entry.id === 'string' ? entry.id : '')
        .find(Boolean);

    return artistId ? `#/music/artist/${encodeURIComponent(artistId)}` : '';
}

function getNativeHomeItemRoute(item: NativeHomeMaybeItem, row?: NativeHomeRow): PtvItemRouteResult {
    return resolvePtvItemRoute(item as Record<string, unknown> | null | undefined, {
        mediaType: row?.mediaType,
        source: row ? 'native-home-card' : 'native-home'
    });
}

function getImageAvailability(item: NativeHomeAnyItem) {
    const imageTags = getItemImageTags(item);
    const backdropTags = getItemStringArray(item, 'BackdropImageTags', 'backdropImageTags');
    const parentBackdropTags = getItemStringArray(item, 'ParentBackdropImageTags', 'parentBackdropImageTags');
    const parentPrimaryTag = getItemString(
        item,
        'ParentPrimaryImageTag',
        'parentPrimaryImageTag',
        'AlbumPrimaryImageTag',
        'albumPrimaryImageTag',
        'SeriesPrimaryImageTag',
        'seriesPrimaryImageTag'
    );
    const parentPrimaryItemId = getItemString(
        item,
        'PrimaryImageItemId',
        'primaryImageItemId',
        'ParentPrimaryImageItemId',
        'parentPrimaryImageItemId',
        'AlbumPrimaryImageItemId',
        'albumPrimaryImageItemId',
        'ParentId',
        'parentId',
        'SeriesId',
        'seriesId'
    );

    return {
        hasBackdrop: backdropTags.length > 0
            || parentBackdropTags.length > 0
            || Boolean(getItemString(item, 'BackdropImageTag', 'backdropImageTag', 'ParentBackdropImageTag', 'parentBackdropImageTag')),
        hasParentPrimary: Boolean(parentPrimaryTag && parentPrimaryItemId),
        hasPrimary: Boolean(imageTags.Primary || getItemString(item, 'PrimaryImageTag', 'primaryImageTag')),
        hasSeriesPrimary: Boolean(getItemString(item, 'SeriesPrimaryImageTag', 'seriesPrimaryImageTag') && getItemString(item, 'SeriesId', 'seriesId')),
        hasThumb: Boolean(imageTags.Thumb || getItemString(item, 'ThumbImageTag', 'thumbImageTag', 'ParentThumbImageTag', 'parentThumbImageTag')),
        imageTagsPresent: Object.keys(imageTags).length > 0
    };
}

function recordNativeHomeImageFailure(
    item: NativeHomeAnyItem,
    candidate: PtvItemImageCandidate,
    usedFallback: boolean
) {
    if (!shouldCollectDiagnostics()) return;

    const itemId = getItemId(item);
    const availability = getImageAvailability(item);
    const detail = {
        ...availability,
        backdropTagsPresent: availability.hasBackdrop,
        hasBackdropTag: availability.hasBackdrop,
        hasParentPrimaryTag: availability.hasParentPrimary,
        hasPrimaryTag: availability.hasPrimary,
        hasSeriesPrimaryTag: availability.hasSeriesPrimary,
        hasThumbTag: availability.hasThumb,
        imageTagsPresent: availability.imageTagsPresent,
        imageItemId: candidate.imageItemId,
        imageTag: candidate.tag,
        imageType: getNativeHomeDebugImageType(candidate),
        imageUrl: candidate.url,
        itemId,
        itemName: getItemTitle(item),
        itemType: getItemString(item, 'Type', 'type'),
        posterUrl: candidate.url,
        requestedType: getNativeHomeDebugImageType(candidate),
        selectedImageType: getNativeHomeDebugImageType(candidate),
        staleTagDetected: Boolean(candidate.untaggedFallbackFor),
        usedFallback,
        imageDiagnostics: getPtvImageFailureDiagnostics()
    };

    recordPtvEvent('image', 'native-home-image-failed', detail);
}

function cacheNativeHomeImageFailure(
    item: NativeHomeAnyItem,
    candidate: PtvItemImageCandidate | undefined,
    usedFallback: boolean
) {
    if (!candidate?.url) return;

    markPtvImageCandidateFailed(candidate);

    if (failedNativeHomeImageUrls.has(candidate.url)) return;

    failedNativeHomeImageUrls.add(candidate.url);
    recordNativeHomeImageFailure(item, candidate, usedFallback);
}

function recordNativeHomeImageFallback(
    failedCandidate: PtvItemImageCandidate | undefined,
    nextCandidate: PtvItemImageCandidate | undefined,
    itemId: string,
    title: string
) {
    recordPtvImageFallback();

    if (!shouldCollectDiagnostics()) return;

    recordPtvEvent('image', 'native-home-image-fallback', {
        attemptedImageType: failedCandidate?.imageType || null,
        attemptedTagMode: failedCandidate?.tagMode || null,
        attemptedUrl: failedCandidate?.url || null,
        imageDiagnostics: getPtvImageFailureDiagnostics(),
        itemId,
        itemName: title,
        nextImageType: nextCandidate?.imageType || null,
        nextSelectedImageType: nextCandidate ? getNativeHomeDebugImageType(nextCandidate) : null,
        nextTagMode: nextCandidate?.tagMode || null,
        nextUrl: nextCandidate?.url || null,
        selectedImageType: failedCandidate ? getNativeHomeDebugImageType(failedCandidate) : null,
        staleTagDetected: Boolean(failedCandidate?.tag && nextCandidate?.untaggedFallbackFor === failedCandidate.tag),
        title
    });
}

function recordNativeHomeImageAttempt(
    item: NativeHomeAnyItem,
    candidate: PtvItemImageCandidate
) {
    if (!shouldCollectDiagnostics() || !candidate.url || reportedNativeHomeImageAttemptUrls.has(candidate.url)) return;

    reportedNativeHomeImageAttemptUrls.add(candidate.url);
    const detail = {
        attemptedUrl: candidate.url,
        imageTag: candidate.tag || null,
        itemId: getItemId(item),
        itemName: getItemTitle(item),
        itemType: getItemString(item, 'Type', 'type'),
        selectedImageType: getNativeHomeDebugImageType(candidate),
        staleTagRetry: Boolean(candidate.untaggedFallbackFor)
    };

    recordPtvEvent('image', 'native-home-image-attempt', detail);
}

function recordNativeHomeNoImageCandidate(
    item: NativeHomeAnyItem,
    kind: NativeHomeRow['kind'],
    reason: string
) {
    if (!shouldCollectDiagnostics()) return;

    const itemId = getItemId(item);
    const key = `${itemId || getItemTitle(item)}:${kind}:${reason}`;

    if (reportedNativeHomeFallbackKeys.has(key)) return;
    reportedNativeHomeFallbackKeys.add(key);

    const availability = getImageAvailability(item);

    recordPtvEvent('image', 'native-home-poster-fallback', {
        ...availability,
        imageTag: null,
        itemId,
        itemName: getItemTitle(item),
        itemType: getItemString(item, 'Type', 'type'),
        kind,
        posterUrl: null,
        reason,
        imageDiagnostics: getPtvImageFailureDiagnostics()
    });
}

function isContinueWatchingRow(row: NativeHomeRow) {
    return row.source === 'resume'
        || row.sourceType === 'continue'
        || row.sourceType === 'continueWatching'
        || row.id === 'resume'
        || row.id === 'continue-watching'
        || row.title.toLowerCase() === 'continue watching';
}

function isEpisodeItem(item: NativeHomeAnyItem) {
    return getItemString(item, 'Type', 'type').toLowerCase() === 'episode';
}

function getNativeHomeImageCandidates(item: NativeHomeAnyItem, row: NativeHomeRow) {
    let order: Array<'Primary' | 'Thumb' | 'Backdrop' | 'SeriesPrimary' | 'ParentPrimary'> = [
        'Primary',
        'Thumb',
        'Backdrop',
        'SeriesPrimary',
        'ParentPrimary'
    ];

    if (row.kind === 'libraries') {
        order = ['Thumb', 'Primary', 'Backdrop'];
    } else if (isContinueWatchingRow(row)) {
        order = ['Primary', 'SeriesPrimary', 'ParentPrimary', 'Thumb', 'Backdrop'];

        if (isEpisodeItem(item)) {
            order = ['SeriesPrimary', 'ParentPrimary', 'Primary', 'Thumb', 'Backdrop'];
        }
    }

    return getPtvItemImageCandidates(item as PtvItem, {
        baseOptions: getNativeHomeScaledImageOptions(row.kind === 'libraries' ? LIBRARY_IMAGE_OPTIONS : POSTER_IMAGE_OPTIONS),
        order
    })
        .filter(candidate => !failedNativeHomeImageUrls.has(candidate.url) && !hasPtvImageCandidateFailed(candidate))
        .slice(0, 2);
}

function titleCaseGroupId(value: string) {
    return value
        .replace(/[-_]+/g, ' ')
        .trim()
        .replace(/\b\w/g, character => character.toUpperCase());
}

function getNativeHomeGroupTitle(row: NativeHomeRow) {
    if (row.sourceGroupTitle?.trim()) return row.sourceGroupTitle.trim();

    const groupId = row.sourceGroupId?.trim();

    if (groupId === 'recommendation-rows') return 'Recommendation Rows';
    if (groupId === 'configured-rules') return 'Configured Rules';
    if (groupId === 'jellyfin-defaults') return 'Jellyfin Home';
    if (groupId) return titleCaseGroupId(groupId);

    return row.subtitle || 'PiggieTV Rows';
}

function getNativeHomeGroupKey(row: NativeHomeRow) {
    return (row.sourceGroupId || row.sourceGroupTitle || row.subtitle || 'ptv-rows')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(?:^-)|(?:-$)/g, '') || 'ptv-rows';
}

function getNativeHomeRowGroups(rows: NativeHomeRow[]) {
    const groups: Array<{ id: string; rows: NativeHomeRow[]; title: string }> = [];
    const groupsByKey = new Map<string, { id: string; rows: NativeHomeRow[]; title: string }>();

    rows.forEach(row => {
        const key = getNativeHomeGroupKey(row);
        const existingGroup = groupsByKey.get(key);

        if (existingGroup) {
            existingGroup.rows.push(row);
            return;
        }

        const group = {
            id: `${groups.length}-${key}`,
            rows: [row],
            title: getNativeHomeGroupTitle(row)
        };

        groupsByKey.set(key, group);
        groups.push(group);
    });

    return groups;
}

function getNativeHomeBackdropImageUrl(item: NativeHomeAnyItem, profile: ReturnType<typeof getPtvPerformanceProfile>) {
    const availability = getImageAvailability(item);
    const quality = profile.clientKind === 'mobile' ? 72 : 78;
    const maxWidth = profile.clientKind === 'mobile' ? 1000 : 1800;

    if (availability.hasBackdrop) {
        return getPtvItemImageUrl(item as PtvItem, {
            imageIndex: 0,
            imageType: 'Backdrop',
            maxWidth,
            quality
        });
    }

    if (availability.hasThumb) {
        return getPtvItemImageUrl(item as PtvItem, {
            imageType: 'Thumb',
            maxWidth,
            quality
        });
    }

    return getPtvItemImageUrl(item as PtvItem, {
        imageType: 'Primary',
        maxWidth: Math.min(maxWidth, 900),
        quality: Math.min(quality, 74)
    });
}

function getNativeHomeRowBackdropUrl(row: NativeHomeRow, profile: ReturnType<typeof getPtvPerformanceProfile>) {
    if (profile.isFireTv || profile.isLowPower || row.kind === 'libraries') return '';

    const displayItems = getNativeHomeDisplayItems(row);
    const backdropItem = displayItems.find(item => getImageAvailability(item).hasBackdrop)
        || displayItems.find(item => {
            const availability = getImageAvailability(item);

            return availability.hasThumb || availability.hasPrimary || availability.hasParentPrimary || availability.hasSeriesPrimary;
        })
        || displayItems.find(item => Boolean(getItemId(item)))
        || null;

    return backdropItem ? getNativeHomeBackdropImageUrl(backdropItem, profile) : '';
}

function getNativeHomeHeroBackdropUrl(heroItem: PtvItem | null, profile: ReturnType<typeof getPtvPerformanceProfile>) {
    if (profile.isFireTv || profile.isLowPower) return '';

    const quality = profile.clientKind === 'mobile' ? 84 : 92;

    if (!heroItem) {
        return resolvePtvStaticAssetUrl(PTV_ASSETS.backgrounds.page);
    }

    if (getImageAvailability(heroItem).hasBackdrop) {
        return getPtvItemImageUrl(heroItem, {
            imageIndex: 0,
            imageType: 'Backdrop',
            maxWidth: profile.heroBackdropMaxWidth,
            quality
        });
    }

    return getPtvItemImageUrl(heroItem, {
        imageType: 'Primary',
        maxWidth: profile.heroBackdropMaxWidth,
        quality
    });
}

function getNativeHomeFallbackBackdropUrls(rows: NativeHomeRow[], profile: ReturnType<typeof getPtvPerformanceProfile>) {
    const seen = new Set<string>();
    const urls: string[] = [];

    rows.some(row => {
        const url = getNativeHomeRowBackdropUrl(row, profile);

        if (url && !seen.has(url)) {
            seen.add(url);
            urls.push(url);
        }

        return urls.length >= 6;
    });

    return urls;
}

function NativeHomeCrossfadeBackdropLayer({
    layer,
    src
}: NativeHomeCrossfadeBackdropLayerProps) {
    const [currentSrc, setCurrentSrc] = useState(src);
    const [previousSrc, setPreviousSrc] = useState('');
    const [currentVisible, setCurrentVisible] = useState(Boolean(src));
    const [previousVisible, setPreviousVisible] = useState(false);

    useEffect(() => {
        if (src === currentSrc) return undefined;

        setPreviousSrc(currentSrc);
        setPreviousVisible(Boolean(currentSrc));
        setCurrentSrc(src);
        setCurrentVisible(false);

        const animationFrame = window.requestAnimationFrame(() => {
            setPreviousVisible(false);
            setCurrentVisible(Boolean(src));
        });

        const timeout = window.setTimeout(() => {
            setPreviousSrc('');
        }, 1800);

        return () => {
            window.cancelAnimationFrame(animationFrame);
            window.clearTimeout(timeout);
        };
    }, [currentSrc, src]);

    return (
        <>
            {previousSrc ? (
                <img
                    alt=''
                    aria-hidden='true'
                    className={`ptv-native-home-cinematic-backdrop-image ptv-native-home-cinematic-backdrop-image-${layer} is-previous${previousVisible ? ' is-visible' : ''}`}
                    decoding='async'
                    src={previousSrc}
                />
            ) : null}
            {currentSrc ? (
                <img
                    alt=''
                    aria-hidden='true'
                    className={`ptv-native-home-cinematic-backdrop-image ptv-native-home-cinematic-backdrop-image-${layer} is-current${currentVisible ? ' is-visible' : ''}`}
                    decoding='async'
                    src={currentSrc}
                />
            ) : null}
        </>
    );
}

function NativeHomeHeroBackdrop({
    item,
    objectPosition,
    src
}: NativeHomeHeroBackdropProps) {
    const requestTokenRef = useRef(0);
    const [currentLayer, setCurrentLayer] = useState(() => src ? {
        itemId: getItemId(item),
        objectPosition,
        src
    } : null);
    const [previousLayer, setPreviousLayer] = useState<typeof currentLayer>(null);
    const [currentVisible, setCurrentVisible] = useState(Boolean(src));
    const [previousVisible, setPreviousVisible] = useState(false);

    useEffect(() => {
        if (!src || currentLayer?.src === src) return undefined;

        if (failedNativeHomeHeroArtworkUrls.has(src)) {
            recordPtvEvent('render', 'native-home-smart-hero-artwork-skipped', {
                fallbackArtworkReason: failedNativeHomeHeroArtworkUrls.get(src) || 'previous-load-failed',
                itemId: getItemId(item),
                src
            });
            return undefined;
        }

        const token = requestTokenRef.current + 1;
        const loadStartedAt = performance.now();
        requestTokenRef.current = token;
        let cancelled = false;
        const image = new Image();
        image.decoding = 'async';

        image.onload = () => {
            if (cancelled || requestTokenRef.current !== token) {
                recordPtvEvent('render', 'native-home-smart-hero-stale-artwork-ignored', {
                    itemId: getItemId(item),
                    staleRequestsIgnored: 1,
                    src
                });
                return;
            }

            const nextLayer = {
                itemId: getItemId(item),
                objectPosition,
                src
            };
            const loadMs = Number((performance.now() - loadStartedAt).toFixed(1));

            rememberNativeHomeBoundedCacheValue(
                prefetchedNativeHomeImageUrls,
                src,
                performance.now(),
                NATIVE_HOME_IMAGE_PREFETCH_CACHE_LIMIT
            );
            setPreviousLayer(currentLayer);
            setPreviousVisible(Boolean(currentLayer));
            setCurrentLayer(nextLayer);
            setCurrentVisible(false);

            const animationFrame = window.requestAnimationFrame(() => {
                setPreviousVisible(false);
                setCurrentVisible(true);
            });
            const timeout = window.setTimeout(() => {
                setPreviousLayer(null);
            }, 900);

            recordPtvEvent('render', 'native-home-smart-hero-artwork-loaded', {
                artworkCacheHit: loadMs < 8,
                backdropLoadMs: loadMs,
                currentHeroItemId: nextLayer.itemId || null,
                src
            });

            window.setTimeout(() => {
                window.cancelAnimationFrame(animationFrame);
                window.clearTimeout(timeout);
            }, 950);
        };

        image.onerror = () => {
            if (cancelled || requestTokenRef.current !== token) return;

            rememberNativeHomeBoundedCacheValue(
                failedNativeHomeHeroArtworkUrls,
                src,
                'image-load-failed',
                NATIVE_HOME_FAILED_ARTWORK_CACHE_LIMIT
            );
            recordPtvEvent('render', 'native-home-smart-hero-artwork-failed', {
                failedArtworkCount: failedNativeHomeHeroArtworkUrls.size,
                fallbackArtworkReason: 'image-load-failed',
                itemId: getItemId(item),
                src
            });
        };

        image.src = src;

        return () => {
            cancelled = true;
        };
    }, [currentLayer, item, objectPosition, src]);

    return (
        <>
            {previousLayer ? (
                <img
                    alt=''
                    aria-hidden='true'
                    className={`ptv-native-home-hero-backdrop is-previous${previousVisible ? ' is-visible' : ''}`}
                    decoding='async'
                    style={{ objectPosition: previousLayer.objectPosition }}
                    src={previousLayer.src}
                />
            ) : null}
            {currentLayer ? (
                <img
                    alt=''
                    aria-hidden='true'
                    className={`ptv-native-home-hero-backdrop is-current${currentVisible ? ' is-visible' : ''}`}
                    decoding='async'
                    style={{ objectPosition: currentLayer.objectPosition }}
                    src={currentLayer.src}
                />
            ) : null}
        </>
    );
}

function NativeHomeCinematicBackdrop({ activeItem, heroItem, rows }: NativeHomeCinematicBackdropProps) {
    const performanceProfile = useMemo(() => getPtvPerformanceProfile(), []);
    const defaultBackdropUrl = resolvePtvStaticAssetUrl(PTV_ASSETS.backgrounds.page);
    const heroBackdropUrl = useMemo(
        () => getNativeHomeHeroBackdropUrl(heroItem, performanceProfile),
        [heroItem, performanceProfile]
    );
    const activeBackdropUrl = useMemo(
        () => getNativeHomeHeroBackdropUrl(activeItem, performanceProfile),
        [activeItem, performanceProfile]
    );
    const fallbackBackdropUrls = useMemo(
        () => getNativeHomeFallbackBackdropUrls(rows, performanceProfile),
        [performanceProfile, rows]
    );
    const globalBackdropUrl = activeBackdropUrl || heroBackdropUrl || fallbackBackdropUrls[0] || '';

    return (
        <div className='ptv-native-home-cinematic-backdrop' aria-hidden='true'>
            {defaultBackdropUrl ? (
                <img
                    alt=''
                    className='ptv-native-home-cinematic-backdrop-image ptv-native-home-cinematic-backdrop-image-default'
                    decoding='async'
                    src={defaultBackdropUrl}
                />
            ) : null}
            <NativeHomeCrossfadeBackdropLayer layer='hero' src={globalBackdropUrl} />
        </div>
    );
}

function getNativeHomeCardPipeline(row: NativeHomeRow, isMounted: boolean) {
    const rejectedCards = row.items
        .map((item, index) => ({
            item,
            index
        }))
        .filter(({ item }) => !item || typeof item !== 'object')
        .map(({ item, index }) => ({
            itemId: getItemId(item),
            itemName: getItemTitle(item),
            itemType: getItemString(item, 'Type', 'type'),
            rejectionReason: `invalid-card-item-${index}`
        }));
    const cardModelsCreated = row.items.length - rejectedCards.length;
    const cardsCreated = isMounted ? cardModelsCreated : 0;
    const rejectionReasons = rejectedCards.map(card => card.rejectionReason);

    return {
        cardModelsCreated,
        cardsCreated,
        cardsFilteredOut: rejectedCards.length,
        deferredReason: isMounted ? null : 'row-not-mounted-virtualized',
        itemCountFromApi: row.items.length,
        rejectionReasons,
        rejectedCards
    };
}

function recordNativeHomeCardPipeline(row: NativeHomeRow, isMounted: boolean) {
    if (!shouldCollectDiagnostics()) return;
    if (!isMounted) return;

    const pipeline = getNativeHomeCardPipeline(row, isMounted);

    recordPtvEvent('render', 'native-home-card-pipeline', {
        cardModelsCreated: pipeline.cardModelsCreated,
        cardsCreated: pipeline.cardsCreated,
        cardsFilteredOut: pipeline.cardsFilteredOut,
        deferredReason: pipeline.deferredReason,
        isMounted,
        itemCountFromApi: pipeline.itemCountFromApi,
        rejectionReasons: pipeline.rejectionReasons,
        rowId: row.id,
        rowSource: row.source,
        rowTitle: row.title,
        stage: 'card-filtering'
    });

    pipeline.rejectedCards.forEach(card => {
        recordPtvEvent('render', 'native-home-card-rejected', {
            ...card,
            rowId: row.id,
            rowSource: row.source,
            rowTitle: row.title
        });
    });
}

function getNativeHomeHeroRotationItems(heroItems: PtvItem[], fallbackHeroItem: PtvItem | null) {
    const seen = new Set<string>();
    const items: PtvItem[] = [];

    [
        ...heroItems,
        ...(fallbackHeroItem ? [fallbackHeroItem] : [])
    ].forEach(item => {
        const key = getNativeHomeHeroKey(item);

        if (!key || seen.has(key)) return;

        seen.add(key);
        items.push(item);
    });

    return items;
}

function NativeHomeHero({
    activeItem,
    canAutoRotate,
    heroItem: fallbackHeroItem,
    heroItems,
    onActiveBackdropItemChange
}: NativeHomeHeroProps) {
    const performanceProfile = useMemo(() => getPtvPerformanceProfile(), []);
    const rotationItems = useMemo(
        () => getNativeHomeHeroRotationItems(heroItems, fallbackHeroItem),
        [fallbackHeroItem, heroItems]
    );
    const rotationKey = useMemo(
        () => rotationItems.map(getNativeHomeHeroKey).join('|'),
        [rotationItems]
    );
    const [heroIndex, setHeroIndex] = useState(0);
    const [failedLogoUrl, setFailedLogoUrl] = useState('');
    const rotationHeroItem = rotationItems[heroIndex] || fallbackHeroItem;
    const focusedHeroItem = activeItem && getItemId(activeItem) ? activeItem : null;
    const heroItem = focusedHeroItem || rotationHeroItem;
    const heroSource = focusedHeroItem ? 'focus' : 'rotation';
    const heroRenderKey = `${heroSource}:${getNativeHomeHeroKey(heroItem)}`;

    useEffect(() => {
        setHeroIndex(0);
    }, [rotationKey]);

    useEffect(() => {
        recordPtvEvent('render', 'native-home-hero-rotation-ready', {
            autoRotate: performanceProfile.enableHeroAutoRotate && canAutoRotate,
            heroCount: rotationItems.length,
            selectedHeroId: getItemId(heroItem),
            source: heroSource
        });
    }, [canAutoRotate, heroItem, heroSource, performanceProfile.enableHeroAutoRotate, rotationItems.length]);

    useEffect(() => {
        if (!performanceProfile.enableHeroAutoRotate) return undefined;
        if (!canAutoRotate) return undefined;
        if (rotationItems.length <= 1) return undefined;

        const timer = window.setInterval(() => {
            setHeroIndex(previousIndex => {
                const nextIndex = (previousIndex + 1) % rotationItems.length;
                const nextItem = rotationItems[nextIndex];

                recordPtvEvent('render', 'native-home-hero-rotated', {
                    heroCount: rotationItems.length,
                    heroIndex: nextIndex,
                    itemId: getItemId(nextItem),
                    title: getItemTitle(nextItem)
                });

                return nextIndex;
            });
        }, NATIVE_HOME_HERO_ROTATION_MS);

        return () => window.clearInterval(timer);
    }, [canAutoRotate, performanceProfile.enableHeroAutoRotate, rotationItems]);

    const backdropUrl = useMemo(
        () => getNativeHomeHeroBackdropUrl(heroItem, performanceProfile),
        [heroItem, performanceProfile]
    );
    const logoUrl = useMemo(() => {
        if (!getItemImageTags(heroItem).Logo) {
            return '';
        }

        return getPtvItemImageUrl(heroItem, {
            imageType: 'Logo',
            maxWidth: performanceProfile.heroLogoMaxWidth,
            quality: performanceProfile.clientKind === 'mobile' ? 88 : 94
        });
    }, [heroItem, performanceProfile.clientKind, performanceProfile.heroLogoMaxWidth]);
    const displayLogoUrl = logoUrl && logoUrl !== failedLogoUrl ? logoUrl : '';
    const appLogoUrl = resolvePtvStaticAssetUrl(PTV_ASSETS.logos.bannerLight);
    const heroMetaGroups = useMemo(() => getHeroMetaGroups(heroItem), [heroItem]);
    const heroRoute = useMemo(
        () => heroItem ? getNativeHomeItemRoute(heroItem) : null,
        [heroItem]
    );
    const primaryActionLabel = getNativeHomeHeroPrimaryActionLabel(heroItem, heroRoute);
    const primaryActionHref = heroRoute?.routeSource === 'ptv-music' || heroRoute?.routeSource === 'ptv-reading' ?
        heroRoute.href :
        getPlaybackHref(heroItem);
    const detailsHref = heroRoute?.href || getDetailsHref(heroItem);

    useEffect(() => {
        preloadNativeHomeHeroAssets(heroItem, performanceProfile);
        preloadNativeHomeHeroAssets(rotationItems[(heroIndex + 1) % Math.max(rotationItems.length, 1)], performanceProfile);
    }, [heroIndex, heroItem, performanceProfile, rotationItems]);

    useEffect(() => {
        if (logoUrl && failedLogoUrl && logoUrl !== failedLogoUrl) {
            setFailedLogoUrl('');
        }
    }, [failedLogoUrl, logoUrl]);

    useEffect(() => {
        recordPtvEvent('render', 'native-home-smart-hero-selected', {
            heroCount: rotationItems.length,
            itemId: getItemId(heroItem),
            source: heroSource,
            title: getItemTitle(heroItem)
        });
    }, [heroItem, heroSource, rotationItems.length]);

    useEffect(() => {
        if (focusedHeroItem) return;

        onActiveBackdropItemChange(heroItem || null);
    }, [focusedHeroItem, heroItem, onActiveBackdropItemChange]);

    const handlePrimaryAction = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
        const heroItemId = getItemId(heroItem);

        if (!heroItemId) return;

        event.preventDefault();
        event.stopPropagation();

        if (heroRoute?.routeSource === 'ptv-music' || heroRoute?.routeSource === 'ptv-reading') {
            recordPtvItemRouteClick(heroItem as Record<string, unknown>, heroRoute, {
                action: 'hero-primary',
                source: 'native-home-smart-hero'
            });
            window.location.hash = heroRoute.href.slice(1);
            return;
        }

        playPtvItem(heroItemId, {
            serverId: getItemServerId(heroItem),
            startPositionTicks: getItemUserData(heroItem).PlaybackPositionTicks || 0
        }).catch(error => {
            recordPtvEvent('render', 'native-home-hero-playback-failed', {
                error: error instanceof Error ? error.message : String(error),
                itemId: heroItemId
            });
        });
    }, [heroItem, heroRoute]);

    const handleDetailsClick = useCallback(() => {
        if (!heroItem || !heroRoute) return;

        recordPtvItemRouteClick(heroItem as Record<string, unknown>, heroRoute, {
            action: 'hero-details',
            source: 'native-home-smart-hero'
        });
    }, [heroItem, heroRoute]);

    return (
        <section
            className='ptv-cinematic-hero ptv-cinematic-hero--home ptv-native-home-hero'
            aria-label='Featured PiggieTV title'
            data-ptv-layout-node='home-hero'
            data-ptv-smart-hero-source={heroSource}
        >
            {backdropUrl ? (
                <NativeHomeHeroBackdrop
                    item={heroItem}
                    objectPosition={getNativeHomeHeroBackdropPosition(heroItem)}
                    src={backdropUrl}
                />
            ) : null}

            <div className='ptv-native-home-hero-vignette' aria-hidden='true' />

            <div
                key={`content:${heroRenderKey}`}
                className='ptv-native-home-hero-content'
            >
                <img
                    alt={PTV_BRANDING.appName}
                    className='ptv-native-home-logo'
                    decoding='async'
                    src={appLogoUrl}
                />

                {displayLogoUrl ? (
                    <img
                        alt={getItemTitle(heroItem || {})}
                        className='ptv-native-home-title-logo'
                        decoding='async'
                        onError={() => {
                            setFailedLogoUrl(displayLogoUrl);
                            recordPtvEvent('render', 'native-home-hero-logo-failed', {
                                itemId: getItemId(heroItem),
                                logoUrl: displayLogoUrl
                            });
                        }}
                        src={displayLogoUrl}
                    />
                ) : (
                    <h1>{heroItem ? getItemTitle(heroItem) : PTV_BRANDING.appName}</h1>
                )}

                {heroMetaGroups.length ? (
                    <div className='ptv-native-home-hero-meta' aria-label='Title details'>
                        {heroMetaGroups.map(group => (
                            <div
                                key={group.id}
                                className={`ptv-native-home-hero-meta-group is-${group.id}${group.secondary ? ' is-secondary' : ''}`}
                            >
                                {group.parts.map((part, index) => (
                                    <span className='ptv-native-home-hero-meta-value' key={`${group.id}-${part}-${index}`}>
                                        {part}
                                    </span>
                                ))}
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className='ptv-native-home-hero-meta'>{PTV_BRANDING.loginDescription}</p>
                )}

                {heroItem?.Overview ? (
                    <p className='ptv-native-home-overview'>{heroItem.Overview}</p>
                ) : (
                    <p className='ptv-native-home-overview'>
                        Your native PiggieTV home, powered by Jellyfin APIs.
                    </p>
                )}

                <div className='ptv-native-home-hero-actions'>
                    {canShowNativeHomeHeroPrimaryAction(heroItem, heroRoute) ? (
                        <a
                            aria-label={`${primaryActionLabel} ${getItemTitle(heroItem)}`}
                            className='ptv-native-home-primary-action'
                            data-ptv-focus-key={`home-hero-primary:${getItemId(heroItem)}`}
                            data-ptv-initial-focus='home-primary'
                            href={primaryActionHref}
                            onClick={handlePrimaryAction}
                        >
                            {primaryActionLabel}
                        </a>
                    ) : null}
                    {getItemId(heroItem) ? (
                        <a
                            className='ptv-native-home-secondary-action'
                            href={detailsHref}
                            onClick={handleDetailsClick}
                        >
                            Details
                        </a>
                    ) : null}
                </div>
            </div>
        </section>
    );
}

function NativeHomeCard({ item, onActivate, row }: NativeHomeCardProps) {
    const kind = row.kind;
    const itemId = getItemId(item);
    const [imageAttemptIndex, setImageAttemptIndex] = useState(0);
    const [isFavorite, setIsFavorite] = useState(Boolean(getItemUserData(item).IsFavorite));
    const [isQueueing, setIsQueueing] = useState(false);
    const [spotlightEdgeClass, setSpotlightEdgeClass] = useState('is-edge-center');
    const suppressMousePreviewUntilRef = useRef(0);
    const imageCandidates = useMemo(() => getNativeHomeImageCandidates(item, row), [item, row]);
    const currentImageCandidate = imageAttemptIndex < imageCandidates.length ? imageCandidates[imageAttemptIndex] : undefined;
    const imageUrl = currentImageCandidate?.url || '';
    const currentImageType = currentImageCandidate?.imageType || 'Fallback';
    const currentImageTagMode = currentImageCandidate?.tagMode || 'none';
    const currentRequestedImageType = currentImageCandidate ? getNativeHomeDebugImageType(currentImageCandidate) : 'Fallback';
    const title = getItemTitle(item);
    const recommendationReasonText = getItemString(item, 'PtvRecommendationReasonText');
    const imageAvailability = getImageAvailability(item);
    const qualityTags = useMemo(
        () => kind === 'libraries' ? [] : getPtvQualityTags(item as PtvItem, { maxTags: 3 }),
        [item, kind]
    );
    const itemRoute = useMemo(
        () => kind === 'libraries' ? null : getNativeHomeItemRoute(item, row),
        [item, kind, row]
    );
    const progressPercent = kind === 'libraries' ? 0 : getNativeHomeProgressPercent(item);
    const artistHref = useMemo(
        () => itemRoute?.routeSource === 'ptv-music' ? getNativeHomeMusicArtistHref(item) : '',
        [item, itemRoute?.routeSource]
    );
    const href = kind === 'libraries' ?
        getNativeHomeLibraryCardHref(item) :
        itemRoute?.href || PTV_ROUTES.home;
    const spotlightMetaParts = useMemo(
        () => kind === 'libraries' ? [] : getNativeHomeCardSpotlightMetaParts(item),
        [item, kind]
    );
    const spotlightSynopsis = useMemo(
        () => kind === 'libraries' ? '' : getNativeHomeCardSpotlightSynopsis(item, recommendationReasonText),
        [item, kind, recommendationReasonText]
    );
    const trailerHref = useMemo(
        () => kind === 'libraries' ? '' : getNativeHomeTrailerHref(item),
        [item, kind]
    );
    const primaryActionLabel = getNativeHomeSpotlightPrimaryActionLabel(item, itemRoute);
    const favoriteActionLabel = getNativeHomeFavoriteActionLabel(itemRoute, isFavorite);
    const updateSpotlightEdge = useCallback((element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        const expandedWidth = rect.width * 1.72;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;

        if (viewportWidth && rect.left + expandedWidth > viewportWidth - 24) {
            setSpotlightEdgeClass('is-edge-right');
            return;
        }

        if (rect.right - expandedWidth < 24) {
            setSpotlightEdgeClass('is-edge-left');
            return;
        }

        setSpotlightEdgeClass('is-edge-center');
    }, []);
    const handleFocusActivate = useCallback((event: React.FocusEvent<HTMLElement>) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        if (performance.now() < suppressMousePreviewUntilRef.current) return;

        updateSpotlightEdge(event.currentTarget);
        onActivate(item, 'focus');
        recordPtvEvent('render', 'native-home-card-spotlight-opened', {
            expandedCardOpenTimeMs: 0,
            itemId,
            rowId: row.id,
            source: 'focus'
        });
    }, [item, itemId, onActivate, row.id, updateSpotlightEdge]);
    const handleMouseActivate = useCallback((event: React.MouseEvent<HTMLElement>) => {
        if (performance.now() < suppressMousePreviewUntilRef.current) return;

        updateSpotlightEdge(event.currentTarget);
        onActivate(item, 'mouse');
        recordPtvEvent('render', 'native-home-card-spotlight-opened', {
            expandedCardOpenTimeMs: 300,
            itemId,
            rowId: row.id,
            source: 'mouse'
        });
    }, [item, itemId, onActivate, row.id, updateSpotlightEdge]);
    const handleMouseLeave = useCallback(() => {
        onActivate(null, 'cancel');
    }, [onActivate]);
    const handleTouchStart = useCallback(() => {
        suppressMousePreviewUntilRef.current = performance.now() + 900;
        onActivate(null, 'cancel');
    }, [onActivate]);

    useEffect(() => {
        setImageAttemptIndex(0);
        setIsFavorite(Boolean(getItemUserData(item).IsFavorite));
    }, [itemId, kind]);

    useEffect(() => {
        if (imageCandidates.length) return;

        recordNativeHomeNoImageCandidate(item, kind, 'no-valid-image-tags');
    }, [imageCandidates.length, item, kind]);

    useEffect(() => {
        if (!currentImageCandidate) return;

        recordNativeHomeImageAttempt(item, currentImageCandidate);
    }, [currentImageCandidate, item]);

    const handleRouteClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
        if (!itemRoute) return;

        recordPtvItemRouteClick(item as Record<string, unknown>, itemRoute, {
            action: 'open-card',
            mediaType: row.mediaType,
            privacySafeDiagnostics: itemRoute.routeSource === 'jellyfin-fallback',
            rowId: row.id,
            rowTitle: row.title,
            source: 'native-home-card'
        });

        if (itemRoute.routeSource !== 'jellyfin-fallback' || !itemRoute.href.startsWith('#/details?')) return;

        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation?.();
        void openNativeHomeDetails({
            href: itemRoute.href,
            mediaId: itemId
        });
    }, [item, itemId, itemRoute, row.id, row.mediaType, row.title]);

    const handlePlay = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        if (!itemId || !isPlayableItem(item)) return;

        event.preventDefault();
        event.stopPropagation();

        if (itemRoute?.routeSource === 'ptv-music') {
            recordPtvItemRouteClick(item as Record<string, unknown>, itemRoute, {
                action: 'play-card',
                mediaType: row.mediaType,
                rowId: row.id,
                rowTitle: row.title,
                source: 'native-home-card'
            });
            window.location.hash = itemRoute.href.slice(1);
            return;
        }

        playPtvItem(itemId, {
            serverId: getItemServerId(item),
            startPositionTicks: getItemUserData(item).PlaybackPositionTicks || 0
        }).catch(() => {
            recordPtvEvent('render', 'native-home-card-playback-failed', {
                itemId,
                rowId: row.id,
                rowTitle: row.title,
                title
            });
        });
    }, [item, itemId, itemRoute, row.id, row.mediaType, row.title, title]);

    const handleQueue = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        if (!itemId || !isPlayableItem(item) || isQueueing) return;

        event.preventDefault();
        event.stopPropagation();
        setIsQueueing(true);

        queuePtvItems({
            ids: [itemId],
            serverId: getItemServerId(item)
        })
            .then(() => {
                recordPtvEvent('render', 'native-home-card-queue-added', {
                    itemId,
                    rowId: row.id,
                    rowTitle: row.title,
                    title
                });
            })
            .catch(error => {
                recordPtvEvent('render', 'native-home-card-queue-failed', {
                    error: error instanceof Error ? error.message : String(error),
                    itemId,
                    rowId: row.id,
                    rowTitle: row.title,
                    title
                });
            })
            .finally(() => setIsQueueing(false));
    }, [isQueueing, item, itemId, row.id, row.title, title]);

    const handleFavorite = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        if (!itemId) return;

        event.preventDefault();
        event.stopPropagation();
        const nextValue = !isFavorite;

        setIsFavorite(nextValue);
        void setPtvFavorite(itemId, nextValue, {
            serverId: getItemServerId(item)
        }).catch(error => {
            setIsFavorite(!nextValue);
            recordPtvEvent('render', 'native-home-card-favorite-failed', {
                error: error instanceof Error ? error.message : String(error),
                itemId,
                rowId: row.id,
                rowTitle: row.title,
                title
            });
        });
    }, [isFavorite, item, itemId, row.id, row.title, title]);

    const handleTrailerClick = useCallback(() => {
        recordPtvEvent('render', 'native-home-card-trailer-opened', {
            itemId,
            rowId: row.id,
            rowTitle: row.title,
            title,
            trailerHref
        });
    }, [itemId, row.id, row.title, title, trailerHref]);

    const handleImageError = useCallback(() => {
        setImageAttemptIndex(previous => {
            const failedCandidate = imageCandidates[previous];
            const next = previous + 1;
            const finalFallbackUsed = next >= imageCandidates.length;

            cacheNativeHomeImageFailure(item, failedCandidate, finalFallbackUsed);

            if (next < imageCandidates.length) {
                recordNativeHomeImageFallback(failedCandidate, imageCandidates[next], itemId, title);

                return next;
            }

            return imageCandidates.length;
        });
    }, [imageCandidates, item, itemId, title]);

    return (
        <article
            className={`ptv-native-card ptv-card ptv-native-card-${kind}`}
            data-ptv-recommendation-reasons={recommendationReasonText}
            onFocus={handleFocusActivate}
            onMouseEnter={handleMouseActivate}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handleTouchStart}
            title={recommendationReasonText || undefined}
        >
            <div className='ptv-native-card-media'>
                <a
                    aria-label={`Open ${title}`}
                    className='ptv-native-card-link ptv-native-card-media-link'
                    data-ptv-focus-key={`home-card:${itemId}`}
                    data-ptv-item-type={getItemString(item, 'Type', 'type')}
                    data-ptv-route-fallback-reason={itemRoute?.fallbackReason || ''}
                    data-ptv-route-source={itemRoute?.routeSource || ''}
                    href={href}
                    onClick={handleRouteClick}
                >
                    <div className='ptv-native-card-image-wrap'>
                        {imageUrl ? (
                            <img
                                alt={title}
                                className={`ptv-native-card-image ptv-native-card-image-${currentImageType.toLowerCase()}`}
                                data-ptv-image-attempt={imageAttemptIndex}
                                data-ptv-image-backdrop-tags-present={String(imageAvailability.hasBackdrop)}
                                data-ptv-image-component='native-home-card'
                                data-ptv-image-has-backdrop-tag={String(imageAvailability.hasBackdrop)}
                                data-ptv-image-has-parent-primary-tag={String(imageAvailability.hasParentPrimary)}
                                data-ptv-image-has-primary-tag={String(imageAvailability.hasPrimary)}
                                data-ptv-image-has-series-primary-tag={String(imageAvailability.hasSeriesPrimary)}
                                data-ptv-image-has-thumb-tag={String(imageAvailability.hasThumb)}
                                data-ptv-image-item-id={itemId}
                                data-ptv-image-item-name={title}
                                data-ptv-image-item-type={getItemString(item, 'Type', 'type')}
                                data-ptv-image-tag={currentImageCandidate?.tag || ''}
                                data-ptv-image-tag-mode={currentImageTagMode}
                                data-ptv-image-tags-present={String(imageAvailability.imageTagsPresent)}
                                data-ptv-image-type={currentRequestedImageType}
                                data-ptv-image-url={imageUrl}
                                loading='lazy'
                                onError={handleImageError}
                                src={imageUrl}
                            />
                        ) : (
                            <div className='ptv-native-card-empty' aria-hidden='true'>
                                {title.slice(0, 1)}
                            </div>
                        )}
                    </div>
                </a>

                {qualityTags.length ? (
                    <div className='ptv-card-quality-stack ptv-native-card-quality-stack' aria-label='Quality'>
                        {qualityTags.map(tag => (
                            <span
                                key={`${tag.category}-${tag.id}`}
                                className={getPtvQualityPillClass(tag)}
                                data-ptv-quality-category={tag.category}
                                title={tag.label}
                            >
                                {tag.label}
                            </span>
                        ))}
                    </div>
                ) : null}

                {isPlayableItem(item) ? (
                    <button
                        aria-label={`Play ${title}`}
                        className='ptv-native-card-play ptv-card-play-pill'
                        data-ptv-focus-key={`home-card-play:${itemId}`}
                        onClick={handlePlay}
                        type='button'
                    >
                        <span className='ptv-card-play-icon' aria-hidden='true' />
                        <span>Play</span>
                    </button>
                ) : null}

                {progressPercent ? (
                    <div
                        className='ptv-native-home-progress ptv-native-card-progress'
                        aria-label={`${progressPercent}% complete`}
                    >
                        <span style={{ width: `${progressPercent}%` }} />
                    </div>
                ) : null}
            </div>

            <a
                aria-label={`Open ${title}`}
                className='ptv-native-card-copy ptv-native-card-copy-link'
                data-ptv-focus-key={`home-card-copy:${itemId}`}
                data-ptv-route-fallback-reason={itemRoute?.fallbackReason || ''}
                data-ptv-route-source={itemRoute?.routeSource || ''}
                href={href}
                onClick={handleRouteClick}
            >
                <strong>{title}</strong>
                <span>{kind === 'libraries' ? item.CollectionType || 'Library' : getItemMeta(item)}</span>
            </a>

            {kind !== 'libraries' ? (
                <div className={`ptv-native-card-spotlight ${spotlightEdgeClass}`}>
                    <strong className='ptv-native-card-spotlight-title'>{title}</strong>
                    {spotlightMetaParts.length ? (
                        <div className='ptv-native-card-spotlight-meta'>
                            {spotlightMetaParts.map((part, index) => (
                                <span key={`${part}-${index}`}>{part}</span>
                            ))}
                        </div>
                    ) : null}
                    {qualityTags.length ? (
                        <div className='ptv-native-card-spotlight-quality' aria-label='Quality'>
                            {qualityTags.map(tag => (
                                <span
                                    key={`${tag.category}-${tag.id}`}
                                    className={getPtvQualityPillClass(tag)}
                                    data-ptv-quality-category={tag.category}
                                    title={tag.label}
                                >
                                    {tag.label}
                                </span>
                            ))}
                        </div>
                    ) : null}
                    {spotlightSynopsis ? (
                        <p>{spotlightSynopsis}</p>
                    ) : null}
                    <div className='ptv-native-card-spotlight-actions'>
                        {itemId && isPlayableItem(item) ? (
                            <button
                                aria-label={`${primaryActionLabel} ${title}`}
                                className='ptv-native-card-spotlight-primary'
                                onClick={handlePlay}
                                type='button'
                            >
                                {primaryActionLabel}
                            </button>
                        ) : canOpenNativeHomeRouteAsPrimary(itemRoute) ? (
                            <a
                                className='ptv-native-card-spotlight-primary'
                                data-ptv-route-fallback-reason={itemRoute?.fallbackReason || ''}
                                data-ptv-route-source={itemRoute?.routeSource || ''}
                                href={href}
                                onClick={handleRouteClick}
                            >
                                {primaryActionLabel}
                            </a>
                        ) : null}
                        {trailerHref ? (
                            <a
                                href={trailerHref}
                                onClick={handleTrailerClick}
                            >
                                Trailer
                            </a>
                        ) : null}
                        {artistHref ? (
                            <a
                                data-ptv-route-source='ptv-music'
                                href={artistHref}
                            >
                                Go to Artist
                            </a>
                        ) : null}
                        <a
                            data-ptv-route-fallback-reason={itemRoute?.fallbackReason || ''}
                            data-ptv-route-source={itemRoute?.routeSource || ''}
                            href={href}
                            onClick={handleRouteClick}
                        >
                            Details
                        </a>
                        {itemId && isPlayableItem(item) ? (
                            <button
                                aria-label={`Add ${title} to queue`}
                                disabled={isQueueing}
                                onClick={handleQueue}
                                type='button'
                            >
                                {isQueueing ? 'Adding' : 'Queue'}
                            </button>
                        ) : null}
                        {itemId ? (
                            <button
                                aria-label={`${isFavorite ? 'Remove favorite from' : favoriteActionLabel} ${title}`}
                                aria-pressed={isFavorite}
                                className={isFavorite ? 'is-liked' : ''}
                                onClick={handleFavorite}
                                type='button'
                            >
                                {favoriteActionLabel}
                            </button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </article>
    );
}

function NativeHomeRowScroller({ onActiveItemChange, row }: NativeHomeRowScrollerProps) {
    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const frameRef = useRef<number | null>(null);
    const timeoutRef = useRef<number | null>(null);
    const displayItems = useMemo(() => dedupeNativeHomeItems(getNativeHomeDisplayItems(row)), [row]);
    const [navState, setNavState] = useState<NativeHomeRowNavState>(() => getNativeHomeRowNavState(null, false));

    const updateNavState = useCallback((reason: string) => {
        const nextState = getNativeHomeRowNavState(scrollerRef.current, true);

        setNavState(previousState => {
            if (areNativeHomeRowNavStatesEqual(previousState, nextState)) {
                return previousState;
            }

            recordNativeHomeRowNavState(row.id, row.title, nextState, reason);
            return nextState;
        });
    }, [row.id, row.title]);

    const scheduleNavStateUpdate = useCallback((reason: string) => {
        if (frameRef.current !== null) {
            window.cancelAnimationFrame(frameRef.current);
        }

        frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = null;
            updateNavState(reason);
        });
    }, [updateNavState]);

    const handleScroll = useCallback(() => {
        scheduleNavStateUpdate('scroll');
    }, [scheduleNavStateUpdate]);

    const scrollRow = useCallback((direction: 'next' | 'prev') => {
        const scroller = scrollerRef.current;

        if (!scroller) return;

        const distance = Math.max(scroller.clientWidth * 0.8, 240);
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

        scroller.scrollBy({
            behavior: reduceMotion ? 'auto' : 'smooth',
            left: direction === 'next' ? distance : -distance
        });

        scheduleNavStateUpdate(`button-${direction}`);

        if (timeoutRef.current !== null) {
            window.clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = window.setTimeout(() => {
            scheduleNavStateUpdate(`button-${direction}-settled`);
        }, reduceMotion ? 0 : 320);
    }, [scheduleNavStateUpdate]);

    const handlePreviousClick = useCallback(() => {
        scrollRow('prev');
    }, [scrollRow]);

    const handleNextClick = useCallback(() => {
        scrollRow('next');
    }, [scrollRow]);

    useEffect(() => {
        const scroller = scrollerRef.current;

        scheduleNavStateUpdate('row-rendered');

        if (!scroller) return undefined;

        const handleWindowResize = () => scheduleNavStateUpdate('window-resize');
        const handleImageLoad = () => scheduleNavStateUpdate('image-load');
        let resizeObserver: ResizeObserver | null = null;
        const delayedUpdate = window.setTimeout(() => scheduleNavStateUpdate('row-rendered-delayed'), 120);
        const settledUpdate = window.setTimeout(() => scheduleNavStateUpdate('row-rendered-settled'), 420);

        window.addEventListener('resize', handleWindowResize);
        scroller.addEventListener('load', handleImageLoad, true);

        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => {
                scheduleNavStateUpdate('resize-observer');
            });
            resizeObserver.observe(scroller);
        }

        return () => {
            window.clearTimeout(delayedUpdate);
            window.clearTimeout(settledUpdate);
            window.removeEventListener('resize', handleWindowResize);
            scroller.removeEventListener('load', handleImageLoad, true);
            resizeObserver?.disconnect();
        };
    }, [displayItems.length, scheduleNavStateUpdate]);

    useEffect(() => () => {
        if (frameRef.current !== null) {
            window.cancelAnimationFrame(frameRef.current);
        }

        if (timeoutRef.current !== null) {
            window.clearTimeout(timeoutRef.current);
        }
    }, []);

    return (
        <div
            className='ptv-native-home-row-rail'
            data-ptv-row-nav-can-scroll-left={String(navState.canScrollLeft)}
            data-ptv-row-nav-can-scroll-right={String(navState.canScrollRight)}
            data-ptv-row-nav-mounted={String(navState.navButtonsMounted)}
        >
            <button
                aria-hidden={!navState.canScrollLeft}
                aria-label='Scroll row left'
                className={`ptv-row-nav ptv-row-nav--prev${navState.canScrollLeft ? '' : ' is-hidden'}`}
                disabled={!navState.canScrollLeft}
                onClick={handlePreviousClick}
                tabIndex={navState.canScrollLeft ? 0 : -1}
                type='button'
            >
                <span aria-hidden='true'>&lt;</span>
            </button>

            <div
                ref={scrollerRef}
                className='ptv-native-home-scroller'
                data-ptv-layout-node='home-shelf-scroller'
                onScroll={handleScroll}
                role='list'
            >
                {displayItems.map(item => (
                    <div
                        key={`${row.id}-${getNativeHomeItemVersionKey(item) || item.Id || item.Name}`}
                        className='ptv-native-home-card-cell'
                        role='listitem'
                    >
                        <NativeHomeCard item={item} onActivate={onActiveItemChange} row={row} />
                    </div>
                ))}
            </div>

            <button
                aria-hidden={!navState.canScrollRight}
                aria-label='Scroll row right'
                className={`ptv-row-nav ptv-row-nav--next${navState.canScrollRight ? '' : ' is-hidden'}`}
                disabled={!navState.canScrollRight}
                onClick={handleNextClick}
                tabIndex={navState.canScrollRight ? 0 : -1}
                type='button'
            >
                <span aria-hidden='true'>&gt;</span>
            </button>
        </div>
    );
}

function NativeHomeRowDiagnosticsPanel({ row }: Readonly<{ row: NativeHomeRow }>) {
    const diagnostics = getNativeHomeRowDiagnostics(row);
    const entries = [
        ['rowTitle', diagnostics.rowTitle],
        ['rowId', diagnostics.rowId],
        ['rowType', diagnostics.rowType],
        ['source', diagnostics.source],
        ['accepted', diagnostics.accepted ? 'true' : 'false'],
        ['persisted', diagnostics.persisted ? 'true' : 'false'],
        ['missingFromSettings', diagnostics.renderedButMissingFromRecommendationSettings ? 'true' : 'false'],
        ['sourceRuleId', diagnostics.sourceRuleId || ''],
        ['sourceValue', diagnostics.sourceValue || ''],
        ['sourceRecommendationId', diagnostics.sourceRecommendationId || ''],
        ['sourceGroupId', diagnostics.sourceGroupId || ''],
        ['sourceGroupTitle', diagnostics.sourceGroupTitle || ''],
        ['enabled', diagnostics.enabled ? 'true' : 'false'],
        ['candidateCount', diagnostics.candidateCount == null ? '' : String(diagnostics.candidateCount)],
        ['dedupeRemovals', diagnostics.dedupeRemovals == null ? '' : String(diagnostics.dedupeRemovals)],
        ['hydrationRemovals', diagnostics.hydrationRemovals == null ? '' : String(diagnostics.hydrationRemovals)],
        ['finalRenderedCount', diagnostics.finalRenderedCount == null ? '' : String(diagnostics.finalRenderedCount)],
        ['itemCount', String(diagnostics.itemCount)],
        ['qualityBadgeEligibleCount', diagnostics.qualityBadgeEligibleCount == null ? '' : String(diagnostics.qualityBadgeEligibleCount)],
        ['qualityBadgeRenderedCount', diagnostics.qualityBadgeRenderedCount == null ? '' : String(diagnostics.qualityBadgeRenderedCount)],
        ['qualityBadgeMissingCount', diagnostics.qualityBadgeMissingCount == null ? '' : String(diagnostics.qualityBadgeMissingCount)],
        ['recommendationItemsHydrated', diagnostics.recommendationItemsHydrated == null ? '' : String(diagnostics.recommendationItemsHydrated)],
        ['recommendationHydrationFailures', diagnostics.recommendationHydrationFailures == null ? '' : String(diagnostics.recommendationHydrationFailures)],
        ['mediaSourceMissingCount', diagnostics.mediaSourceMissingCount == null ? '' : String(diagnostics.mediaSourceMissingCount)],
        ['mediaStreamsMissingCount', diagnostics.mediaStreamsMissingCount == null ? '' : String(diagnostics.mediaStreamsMissingCount)],
        ['moreUrl', row.moreUrl || ''],
        ['cacheHash', diagnostics.cacheHash || ''],
        ['configHash', diagnostics.configHash || ''],
        ['rowConfigHash', diagnostics.rowConfigHash || ''],
        ['recommendationConfigHash', diagnostics.recommendationConfigHash || ''],
        ['generatedAt', diagnostics.generatedAt == null ? '' : new Date(diagnostics.generatedAt).toISOString()]
    ];

    return (
        <dl
            aria-label={`${row.title} source diagnostics`}
            className='ptv-native-home-row-diagnostics'
        >
            {entries.map(([label, value]) => (
                <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value || 'n/a'}</dd>
                </div>
            ))}
        </dl>
    );
}

function NativeHomeRenderedRowsDebugPanel({ rows }: Readonly<{ rows: NativeHomeRow[] }>) {
    return (
        <details className='ptv-native-home-rendered-rows-debug'>
            <summary>Rendered Home Rows</summary>
            <div className='ptv-native-home-rendered-rows-debug-list'>
                {rows.map(sourceRow => {
                    const row = getNativeHomeRowDiagnostics(sourceRow);

                    return (
                        <div
                            key={row.rowId}
                            className={row.renderedButMissingFromRecommendationSettings ? 'is-missing-settings-row' : ''}
                        >
                            <strong>{row.rowTitle}</strong>
                            <span>{row.rowId}</span>
                            <span>{sourceRow.source}</span>
                            <span>{row.source}</span>
                            <span>{row.rowType}</span>
                            <span>{row.enabled ? 'enabled' : 'disabled'}</span>
                            <span>{row.accepted ? 'accepted' : 'not accepted'}</span>
                            <span>{row.persisted ? 'persisted' : 'not persisted'}</span>
                            <span>{`quality ${row.qualityBadgeRenderedCount ?? 0}/${row.qualityBadgeEligibleCount ?? 0}`}</span>
                            <span>{`hydrated ${row.recommendationItemsHydrated ?? 0}`}</span>
                            <span>{sourceRow.pinned ? 'pinned' : 'not pinned'}</span>
                            <span>{sourceRow.personalizationSource || 'standard'}</span>
                            <span>{`adaptive ${Math.round(sourceRow.adaptivePriorityScore || 0)}`}</span>
                            <span>{sourceRow.adaptiveReason || 'balanced placement'}</span>
                            <span>{row.configHash || 'no config hash'}</span>
                            {row.generatedAt == null ? (
                                <span>generatedAt n/a</span>
                            ) : (
                                <span>{new Date(row.generatedAt).toLocaleString()}</span>
                            )}
                            {row.renderedButMissingFromRecommendationSettings ? (
                                <em>not in accepted recommendation settings</em>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </details>
    );
}

function NativeHomeIntelligenceDebugPanel({
    ambientColorSource,
    averageHeroTransitionMs,
    averageHoverDelayMs,
    cancelledTransitions,
    committedItem,
    focusSource,
    heroUpdateCount,
    pendingItem,
    sourceRow,
    staleRequestsIgnored
}: Readonly<{
    ambientColorSource: string;
    averageHeroTransitionMs: number;
    averageHoverDelayMs: number;
    cancelledTransitions: number;
    committedItem: PtvItem | null;
    focusSource: NativeHomeIntelligenceFocusSource;
    heroUpdateCount: number;
    pendingItem: PtvItem | null;
    sourceRow: string;
    staleRequestsIgnored: number;
}>) {
    const entries = [
        ['smartHeroState', pendingItem ? 'pending' : committedItem ? 'focused' : 'hero-rotation'],
        ['focusSource', focusSource],
        ['pendingHeroItemId', getItemId(pendingItem) || 'none'],
        ['pendingHeroTitle', pendingItem ? getItemTitle(pendingItem) : 'none'],
        ['committedHeroItemId', getItemId(committedItem) || 'none'],
        ['committedHeroTitle', committedItem ? getItemTitle(committedItem) : 'none'],
        ['sourceRow', sourceRow || 'none'],
        ['heroUpdateCount', String(heroUpdateCount)],
        ['cancelledTransitions', String(cancelledTransitions)],
        ['averageHeroTransitionMs', averageHeroTransitionMs ? averageHeroTransitionMs.toFixed(1) : 'n/a'],
        ['averageHoverDelayMs', averageHoverDelayMs ? averageHoverDelayMs.toFixed(1) : 'n/a'],
        ['hoverDelayMs', String(NATIVE_HOME_SMART_HERO_MOUSE_DELAY_MS)],
        ['focusDelayMs', String(NATIVE_HOME_SMART_HERO_FOCUS_DELAY_MS)],
        ['recommendationExplanationSource', 'editorial-generated'],
        ['ambientColorSource', ambientColorSource || 'hero'],
        ['prefetchedArtworkCount', String(prefetchedNativeHomeImageUrls.size)],
        ['failedArtworkCount', String(failedNativeHomeHeroArtworkUrls.size)],
        ['staleRequestsIgnored', String(staleRequestsIgnored)]
    ];

    return (
        <details className='ptv-native-home-rendered-rows-debug ptv-native-home-intelligence-debug'>
            <summary>Home Intelligence</summary>
            <dl className='ptv-native-home-row-diagnostics'>
                {entries.map(([label, value]) => (
                    <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                    </div>
                ))}
            </dl>
        </details>
    );
}

function NativeHomeInsightsDebugPanel({ debug }: Readonly<{ debug: NativeHomeAdaptiveDebug }>) {
    const entries = [
        ['currentMood', debug.currentMood],
        ['layoutMode', debug.layoutMode],
        ['seasonalContext', debug.seasonalContext],
        ['personalizationScore', String(debug.personalizationScore)],
        ['rankingMs', debug.rankingMs == null ? 'n/a' : String(debug.rankingMs)],
        ['homeGenerationMs', debug.homeGenerationMs == null ? 'n/a' : String(debug.homeGenerationMs)],
        ['homeRowsSuppressed', String(debug.suppressedHomeRowsCount)],
        ['recommendationCacheAgeMs', debug.recommendationCacheAgeMs == null ? 'n/a' : String(debug.recommendationCacheAgeMs)],
        ['profileUpdatedAt', debug.profileUpdatedAt ? new Date(debug.profileUpdatedAt).toLocaleString() : 'n/a'],
        ['topGenres', debug.topGenres.join(', ') || 'none'],
        ['topStudios', debug.topStudios.join(', ') || 'none'],
        ['adaptiveRows', debug.settings.adaptiveRows ? 'enabled' : 'disabled'],
        ['autoReorder', debug.settings.autoReorder ? 'enabled' : 'disabled'],
        ['crossMediaRecommendations', debug.settings.crossMediaRecommendations ? 'enabled' : 'disabled'],
        ['moodRecommendations', debug.settings.moodRecommendations ? 'enabled' : 'disabled'],
        ['seasonalRows', debug.settings.seasonalRows ? 'enabled' : 'disabled'],
        ['pinnedRows', debug.settings.pinnedRows.join(', ') || 'none']
    ];

    return (
        <details className='ptv-native-home-rendered-rows-debug ptv-native-home-adaptive-debug'>
            <summary>Home Insights</summary>
            <dl className='ptv-native-home-row-diagnostics'>
                {entries.map(([label, value]) => (
                    <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                    </div>
                ))}
            </dl>
            {debug.rowScores.length ? (
                <div className='ptv-native-home-adaptive-score-list'>
                    {debug.rowScores.slice(0, 24).map(row => (
                        <span key={row.rowId}>
                            {row.title}: {Math.round(row.score)} ({row.reason})
                        </span>
                    ))}
                </div>
            ) : null}
            {debug.suppressedHomeRows.length ? (
                <div className='ptv-native-home-adaptive-score-list'>
                    {debug.suppressedHomeRows.map(row => (
                        <span key={row.id}>
                            moved to section: {row.title}
                        </span>
                    ))}
                </div>
            ) : null}
        </details>
    );
}

function NativeHomeRecommendationExplanationPanel({
    canShowDebug,
    row
}: Readonly<{
    canShowDebug: boolean;
    row: NativeHomeRow;
}>) {
    const explanation = useMemo(() => getNativeHomeRecommendationExplanation(row), [row]);

    if (!explanation) return null;

    return (
        <div
            className='ptv-native-home-row-intelligence'
            aria-label={`Why ${row.title} is recommended`}
            data-ptv-recommendation-explanation-source='editorial-generated'
        >
            <span className='ptv-native-home-row-intelligence-lead'>{explanation.lead}</span>
            {canShowDebug && explanation.matchedItems.length ? (
                <span className='ptv-native-home-row-intelligence-chip'>{`Matches ${explanation.matchedItems.join(', ')}`}</span>
            ) : null}
            {canShowDebug && explanation.genres.length ? (
                <span className='ptv-native-home-row-intelligence-chip'>{`Themes: ${explanation.genres.join(', ')}`}</span>
            ) : null}
            <span className='ptv-native-home-row-intelligence-chip'>
                {canShowDebug ? `${explanation.type} - ${explanation.confidence}% match` : getNativeHomeRecommendationBadgeLabel(row)}
            </span>
        </div>
    );
}

function NativeHomeRowView({
    canShowDebug,
    isMounted,
    onActiveBackdropItemChange,
    onLayoutAction,
    row
}: NativeHomeRowViewProps) {
    const moreHref = row.moreUrl
        || (row.sourceValue ? `#/search?query=${encodeURIComponent(row.sourceValue)}` : PTV_ROUTES.search);
    const rowBackdropItem = useMemo(() => getNativeHomeRowBackdropItem(row), [row]);
    const [activeRowItem, setActiveRowItem] = useState<NativeHomeAnyItem | null>(null);
    const rowAccentStyle = useMemo(() => getNativeHomeRowAccentStyle(row, activeRowItem), [activeRowItem, row]);
    const editorialDescription = useMemo(() => getNativeHomeRowEditorialDescription(row), [row]);
    const handleActiveItemChange = useCallback((item: NativeHomeAnyItem | null, source: NativeHomeIntelligenceFocusSource) => {
        setActiveRowItem(item);
        onActiveBackdropItemChange(item as PtvItem, source, row);
    }, [onActiveBackdropItemChange, row]);
    const activateRowBackdrop = useCallback(() => {
        if (rowBackdropItem) onActiveBackdropItemChange(rowBackdropItem, 'row', row);
    }, [onActiveBackdropItemChange, row, rowBackdropItem]);
    const deactivateRowBackdrop = useCallback(() => {
        setActiveRowItem(null);
        onActiveBackdropItemChange(null, 'cancel', row);
    }, [onActiveBackdropItemChange, row]);
    const handleRowBlur = useCallback((event: React.FocusEvent<HTMLElement>) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;

        deactivateRowBackdrop();
    }, [deactivateRowBackdrop]);
    const handlePinClick = useCallback(() => {
        onLayoutAction(row.id, row.pinned ? 'unpin' : 'pin');
    }, [onLayoutAction, row.id, row.pinned]);
    const handleMoveUpClick = useCallback(() => {
        onLayoutAction(row.id, 'up');
    }, [onLayoutAction, row.id]);
    const handleMoveDownClick = useCallback(() => {
        onLayoutAction(row.id, 'down');
    }, [onLayoutAction, row.id]);
    const handleResetClick = useCallback(() => {
        onLayoutAction(row.id, 'reset');
    }, [onLayoutAction, row.id]);

    useEffect(() => {
        recordNativeHomeCardPipeline(row, isMounted);

        if (isMounted && getNativeHomeDisplayItems(row).length) {
            notifyPtvTvFocusContentReady(`home-row:${row.id}`);
        }
    }, [isMounted, row]);

    return (
        <section
            aria-label={row.title}
            className={`ptv-native-home-row ptv-native-home-row-${row.id}`}
            data-ptv-layout-node='home-shelf'
            onBlurCapture={handleRowBlur}
            onFocusCapture={activateRowBackdrop}
            onMouseEnter={activateRowBackdrop}
            onMouseLeave={deactivateRowBackdrop}
            style={rowAccentStyle}
        >
            <div className='ptv-native-home-row-heading'>
                <div>
                    <span>{row.subtitle}</span>
                    <h2>{row.title}</h2>
                    {editorialDescription ? (
                        <p>{editorialDescription}</p>
                    ) : null}
                </div>
                <div className='ptv-native-home-row-heading-actions'>
                    {row.pinned ? (
                        <>
                            <button
                                aria-label={`Move ${row.title} up`}
                                className='ptv-native-home-row-layout-action'
                                onClick={handleMoveUpClick}
                                type='button'
                            >
                                Up
                            </button>
                            <button
                                aria-label={`Move ${row.title} down`}
                                className='ptv-native-home-row-layout-action'
                                onClick={handleMoveDownClick}
                                type='button'
                            >
                                Down
                            </button>
                            <button
                                aria-label='Reset Home row layout'
                                className='ptv-native-home-row-layout-action'
                                onClick={handleResetClick}
                                type='button'
                            >
                                Reset
                            </button>
                        </>
                    ) : null}
                    <button
                        aria-pressed={row.pinned ? 'true' : 'false'}
                        className='ptv-native-home-row-layout-action'
                        onClick={handlePinClick}
                        type='button'
                    >
                        {row.pinned ? 'Unpin' : 'Pin Row'}
                    </button>
                    <a href={moreHref} aria-label={`Open more titles from ${row.title}`}>More</a>
                </div>
            </div>

            <NativeHomeRecommendationExplanationPanel canShowDebug={canShowDebug} row={row} />

            {canShowDebug ? (
                <NativeHomeRowDiagnosticsPanel row={row} />
            ) : null}

            {isMounted ? (
                <NativeHomeRowScroller onActiveItemChange={handleActiveItemChange} row={row} />
            ) : (
                <div
                    aria-label={`${row.title} is waiting to load`}
                    className='ptv-native-home-row-placeholder'
                    role='status'
                />
            )}
        </section>
    );
}

function NativeHomeFallback({ message }: NativeHomeFallbackProps) {
    const openJellyfinHome = useCallback(() => {
        // TODO: once the native route controller can host multiple component variants,
        // replace this redirect with an in-shell fallback component.
        recordPtvEvent('render', 'native-home-fallback-used', {
            target: PTV_ROUTES.homeHtml
        });
        window.location.hash = PTV_ROUTES.homeHtml.slice(1);
    }, []);

    return (
        <section className='ptv-native-home-error' role='alert'>
            <h1>Native Home could not load</h1>
            <p>{message}</p>
            <button type='button' onClick={openJellyfinHome}>
                Open Jellyfin Web Home
            </button>
        </section>
    );
}

function NativeHome() {
    const mountedAt = useRef(performance.now());
    const focusedHeroTimerRef = useRef<number | null>(null);
    const heroInactivityTimerRef = useRef<number | null>(null);
    const lastHeroCommitAtRef = useRef(0);
    const lastScrollAtRef = useRef(0);
    const smartHeroRequestTokenRef = useRef(0);
    const [activeBackdropItem, setActiveBackdropItem] = useState<PtvItem | null>(null);
    const [focusedHeroItem, setFocusedHeroItem] = useState<PtvItem | null>(null);
    const [pendingHeroItem, setPendingHeroItem] = useState<PtvItem | null>(null);
    const [isMediaNavOpen, setIsMediaNavOpen] = useState(false);
    const [smartHeroFocusSource, setSmartHeroFocusSource] = useState<NativeHomeIntelligenceFocusSource>('hero');
    const [smartHeroSourceRow, setSmartHeroSourceRow] = useState('');
    const [staleHeroRequestsIgnored, setStaleHeroRequestsIgnored] = useState(0);
    const [heroUpdateCount, setHeroUpdateCount] = useState(0);
    const [cancelledHeroTransitions, setCancelledHeroTransitions] = useState(0);
    const [heroTransitionTotalMs, setHeroTransitionTotalMs] = useState(0);
    const [heroTransitionSampleCount, setHeroTransitionSampleCount] = useState(0);
    const [hoverDelayTotalMs, setHoverDelayTotalMs] = useState(0);
    const [hoverDelaySampleCount, setHoverDelaySampleCount] = useState(0);
    const [layoutRevision, setLayoutRevision] = useState(0);
    const { canShowDebug } = usePtvAdminDebugVisibility();
    const {
        debug,
        error,
        heroItem,
        heroItems,
        isLoading,
        rows: rawRows
    } = useNativeHomeData();
    const personalizationSettings = useMemo(
        () => loadNativeHomePersonalizationSettings(),
        [layoutRevision]
    );
    const rows = useMemo(
        () => decorateNativeHomeRowsForCurrentLayout(rawRows, personalizationSettings),
        [personalizationSettings, rawRows]
    );
    const homeInsightsDebug = useMemo(
        () => ({
            ...debug.home,
            settings: personalizationSettings
        }),
        [debug.home, personalizationSettings]
    );
    const {
        getRowMountReason,
        isRowMounted,
        mountedRowCount,
        registerRowRef
    } = useNativeHomeVirtualRows(rows);
    const rowGroups = useMemo(() => getNativeHomeRowGroups(rows), [rows]);
    const performanceProfile = useMemo(() => getPtvPerformanceProfile(), []);
    const pageAccentStyle = useMemo(
        () => getNativeHomePageAccentStyle(focusedHeroItem || heroItem),
        [focusedHeroItem, heroItem]
    );
    const shellBackdropUrl = useMemo(
        () => getNativeHomeHeroBackdropUrl(activeBackdropItem, performanceProfile)
            || getNativeHomeHeroBackdropUrl(heroItem, performanceProfile)
            || getNativeHomeFallbackBackdropUrls(rows, performanceProfile)[0]
            || '',
        [activeBackdropItem, heroItem, performanceProfile, rows]
    );
    const averageHeroTransitionMs = heroTransitionSampleCount ? heroTransitionTotalMs / heroTransitionSampleCount : 0;
    const averageHoverDelayMs = hoverDelaySampleCount ? hoverDelayTotalMs / hoverDelaySampleCount : 0;
    const ambientColorSource = focusedHeroItem ? getItemTitle(focusedHeroItem) : heroItem ? getItemTitle(heroItem) : 'hero';
    const canAutoRotateHero = !focusedHeroItem && !isMediaNavOpen;
    const handleRowLayoutAction = useCallback<NativeHomeRowLayoutActionHandler>((rowId, action) => {
        if (action === 'pin' || action === 'unpin') {
            toggleNativeHomePinnedRow(rowId);
        } else if (action === 'up' || action === 'down') {
            moveNativeHomePinnedRow(rowId, action);
        } else {
            resetNativeHomeLayoutPreferences();
        }

        setLayoutRevision(previous => previous + 1);
        recordPtvEvent('render', 'native-home-row-layout-action', {
            action,
            rowId
        });
    }, []);
    const handleMediaNavOpenChange = useCallback((open: boolean) => {
        setIsMediaNavOpen(open);

        if (!open) return;

        smartHeroRequestTokenRef.current += 1;

        if (focusedHeroTimerRef.current !== null) {
            window.clearTimeout(focusedHeroTimerRef.current);
            focusedHeroTimerRef.current = null;
        }

        setPendingHeroItem(null);
        setCancelledHeroTransitions(previous => previous + 1);
        recordPtvEvent('render', 'native-home-smart-hero-paused-for-nav', {
            committedHeroItemId: getItemId(focusedHeroItem) || getItemId(heroItem) || null
        });
    }, [focusedHeroItem, heroItem]);

    const handleFocusedBackdropItemChange = useCallback((
        item: PtvItem | null,
        source: NativeHomeIntelligenceFocusSource = 'focus',
        row: NativeHomeRow | null = null
    ) => {
        smartHeroRequestTokenRef.current += 1;

        if (focusedHeroTimerRef.current !== null) {
            window.clearTimeout(focusedHeroTimerRef.current);
            focusedHeroTimerRef.current = null;
        }

        if (!item) {
            setPendingHeroItem(null);
            setSmartHeroFocusSource(source);
            setSmartHeroSourceRow('');
            setCancelledHeroTransitions(previous => previous + 1);
            recordPtvEvent('render', 'native-home-smart-hero-preview-cancelled', {
                source,
                sourceRowId: row?.id || null
            });
            return;
        }

        if (isMediaNavOpen) {
            setPendingHeroItem(null);
            setStaleHeroRequestsIgnored(previous => previous + 1);
            recordPtvEvent('render', 'native-home-smart-hero-request-ignored-nav-open', {
                itemId: getItemId(item),
                source,
                sourceRowId: row?.id || null
            });
            return;
        }

        const now = performance.now();

        if ((source === 'focus' || source === 'mouse') && now - lastScrollAtRef.current < NATIVE_HOME_SCROLL_SUPPRESSION_MS) {
            setPendingHeroItem(null);
            setStaleHeroRequestsIgnored(previous => previous + 1);
            recordPtvEvent('render', 'native-home-smart-hero-request-ignored-scroll', {
                itemId: getItemId(item),
                source,
                sourceRowId: row?.id || null
            });
            return;
        }

        setSmartHeroFocusSource(source);
        setSmartHeroSourceRow(row?.title || row?.id || '');

        if (source === 'row') {
            setPendingHeroItem(null);
            recordPtvEvent('render', 'native-home-smart-hero-row-backdrop-only', {
                currentHeroItemId: getItemId(focusedHeroItem) || getItemId(heroItem) || null,
                rowId: row?.id || null,
                rowTitle: row?.title || null
            });
            return;
        }

        const requestToken = smartHeroRequestTokenRef.current;
        const baseDelay = source === 'mouse'
            ? NATIVE_HOME_SMART_HERO_MOUSE_DELAY_MS
            : NATIVE_HOME_SMART_HERO_FOCUS_DELAY_MS;
        const queuedAt = performance.now();
        const quietDelay = Math.max(0, NATIVE_HOME_SMART_HERO_MIN_COMMIT_GAP_MS - (queuedAt - lastHeroCommitAtRef.current));
        const delay = baseDelay + quietDelay;

        setPendingHeroItem(item);

        focusedHeroTimerRef.current = window.setTimeout(() => {
            if (smartHeroRequestTokenRef.current !== requestToken) {
                focusedHeroTimerRef.current = null;
                setStaleHeroRequestsIgnored(previous => previous + 1);
                setCancelledHeroTransitions(previous => previous + 1);
                recordPtvEvent('render', 'native-home-smart-hero-stale-request-ignored', {
                    itemId: getItemId(item),
                    source,
                    sourceRowId: row?.id || null
                });
                return;
            }

            const transitionMs = Number((performance.now() - queuedAt).toFixed(1));

            setActiveBackdropItem(item);
            setFocusedHeroItem(item);
            lastHeroCommitAtRef.current = performance.now();
            setPendingHeroItem(null);
            focusedHeroTimerRef.current = null;
            preloadNativeHomeHeroAssets(item, performanceProfile);
            setHeroUpdateCount(previous => previous + 1);
            setHeroTransitionTotalMs(previous => previous + transitionMs);
            setHeroTransitionSampleCount(previous => previous + 1);

            if (source === 'mouse') {
                setHoverDelayTotalMs(previous => previous + delay);
                setHoverDelaySampleCount(previous => previous + 1);
            }

            recordPtvEvent('render', 'native-home-smart-hero-focus-committed', {
                delayMs: delay,
                focusSource: source,
                itemId: getItemId(item),
                minQuietDelayMs: quietDelay,
                rowId: row?.id || null,
                rowTitle: row?.title || null,
                transitionMs
            });
        }, delay);
    }, [focusedHeroItem, heroItem, isMediaNavOpen, performanceProfile]);

    useEffect(() => () => {
        smartHeroRequestTokenRef.current += 1;

        if (focusedHeroTimerRef.current !== null) {
            window.clearTimeout(focusedHeroTimerRef.current);
        }

        if (heroInactivityTimerRef.current !== null) {
            window.clearTimeout(heroInactivityTimerRef.current);
        }
    }, []);

    useEffect(() => {
        const handleScroll = () => {
            lastScrollAtRef.current = performance.now();
        };

        window.addEventListener('scroll', handleScroll, { passive: true });

        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => {
        if (heroInactivityTimerRef.current !== null) {
            window.clearTimeout(heroInactivityTimerRef.current);
            heroInactivityTimerRef.current = null;
        }

        if (!focusedHeroItem || isMediaNavOpen) return undefined;

        heroInactivityTimerRef.current = window.setTimeout(() => {
            setFocusedHeroItem(null);
            setPendingHeroItem(null);
            setSmartHeroFocusSource('hero');
            setSmartHeroSourceRow('');
            recordPtvEvent('render', 'native-home-smart-hero-resumed-carousel', {
                idleMs: NATIVE_HOME_HERO_INACTIVITY_ROTATION_MS
            });
        }, NATIVE_HOME_HERO_INACTIVITY_ROTATION_MS);

        return () => {
            if (heroInactivityTimerRef.current !== null) {
                window.clearTimeout(heroInactivityTimerRef.current);
                heroInactivityTimerRef.current = null;
            }
        };
    }, [focusedHeroItem, isMediaNavOpen]);

    useEffect(() => {
        if (isLoading || error) return;
        if (!shouldCollectDiagnostics()) return;

        const mountedRows = rows.filter(row => isRowMounted(row.id));
        const mountedCardsRendered = mountedRows.reduce((total, row) => total + getNativeHomeDisplayItems(row).length, 0);
        const totalCardsPlanned = rows.reduce((total, row) => total + getNativeHomeDisplayItems(row).length, 0);
        const mountedImageCandidateCount = mountedRows.reduce((total, row) => (
            total + getNativeHomeDisplayItems(row).reduce((rowTotal, item) => rowTotal + getNativeHomeImageCandidates(item, row).length, 0)
        ), 0);

        if (canShowDebug) {
            console.debug('[PTV Row Rules] render summary', {
                mountedCardsRendered,
                mountedRowCount,
                rowCount: rows.length,
                totalCardsPlanned
            });
        }

        recordPtvEvent('render', 'native-home-render-complete', {
            imageAttemptUrlCount: reportedNativeHomeImageAttemptUrls.size,
            imageCandidateCount: mountedImageCandidateCount,
            mountedCardsRendered,
            mountedRows: mountedRowCount,
            renderAgeMs: Number((performance.now() - mountedAt.current).toFixed(1)),
            totalCardsPlanned,
            rowCount: rows.length
        });
    }, [canShowDebug, error, isLoading, isRowMounted, mountedRowCount, rows]);

    return (
        <Page
            id='ptv-native-home-page'
            title={PTV_BRANDING.appName}
            className='ptv-native-home-page'
            isBackButtonEnabled={false}
            isMenuButtonEnabled
            isThemeMediaSupported
            shouldAutoFocus={false}
        >
            <main
                className='ptv-native-home'
                data-ptv-layout-node='home-root'
                data-ptv-mounted-rows={mountedRowCount}
                style={pageAccentStyle}
            >
                <PTVShell
                    backdropSource={activeBackdropItem ? 'home-focused-item' : 'home-hero'}
                    backdropUrl={shellBackdropUrl}
                    className='ptv-native-home-shell'
                    onNavigationOpenChange={handleMediaNavOpenChange}
                    section='home'
                >
                    {error ? (
                        <NativeHomeFallback message={error} />
                    ) : (
                        <>
                            <NativeHomeHero
                                activeItem={focusedHeroItem}
                                canAutoRotate={canAutoRotateHero}
                                heroItem={heroItem}
                                heroItems={heroItems}
                                onActiveBackdropItemChange={setActiveBackdropItem}
                            />

                            {isLoading ? (
                                <section className='ptv-native-home-loading' aria-live='polite'>
                                    <span />
                                    <p>Loading PiggieTV Home</p>
                                </section>
                            ) : (
                                <div className='ptv-native-home-rows' data-ptv-layout-node='home-rows'>
                                    {canShowDebug ? (
                                        <>
                                            <NativeHomeIntelligenceDebugPanel
                                                ambientColorSource={ambientColorSource}
                                                averageHeroTransitionMs={averageHeroTransitionMs}
                                                averageHoverDelayMs={averageHoverDelayMs}
                                                cancelledTransitions={cancelledHeroTransitions}
                                                committedItem={focusedHeroItem}
                                                focusSource={smartHeroFocusSource}
                                                heroUpdateCount={heroUpdateCount}
                                                pendingItem={pendingHeroItem}
                                                sourceRow={smartHeroSourceRow}
                                                staleRequestsIgnored={staleHeroRequestsIgnored}
                                            />
                                            <NativeHomeInsightsDebugPanel debug={homeInsightsDebug} />
                                            <NativeHomeRenderedRowsDebugPanel rows={rows} />
                                        </>
                                    ) : null}

                                    {rowGroups.map(group => (
                                        <div
                                            key={group.id}
                                            className='ptv-native-home-row-group'
                                            data-ptv-native-home-row-group={group.title}
                                        >
                                            <div className='ptv-native-home-row-group-heading'>
                                                <h2>{group.title}</h2>
                                            </div>
                                            {group.rows.map(row => {
                                                const diagnostics = getNativeHomeRowDiagnostics(row);
                                                const debugAttributes = canShowDebug ? {
                                                    'data-ptv-native-home-accepted': diagnostics.accepted ? 'true' : 'false',
                                                    'data-ptv-native-home-cache-hash': diagnostics.cacheHash || '',
                                                    'data-ptv-native-home-candidate-count': diagnostics.candidateCount == null ? '' : String(diagnostics.candidateCount),
                                                    'data-ptv-native-home-config-hash': diagnostics.configHash || '',
                                                    'data-ptv-native-home-dedupe-removals': diagnostics.dedupeRemovals == null ? '' : String(diagnostics.dedupeRemovals),
                                                    'data-ptv-native-home-final-rendered-count': diagnostics.finalRenderedCount == null ? '' : String(diagnostics.finalRenderedCount),
                                                    'data-ptv-native-home-generated-at': diagnostics.generatedAt == null ? '' : String(diagnostics.generatedAt),
                                                    'data-ptv-native-home-hydration-removals': diagnostics.hydrationRemovals == null ? '' : String(diagnostics.hydrationRemovals),
                                                    'data-ptv-native-home-item-count': String(diagnostics.itemCount),
                                                    'data-ptv-native-home-persisted': diagnostics.persisted ? 'true' : 'false',
                                                    'data-ptv-native-home-recommendation-config-hash': diagnostics.recommendationConfigHash || '',
                                                    'data-ptv-native-home-rendered-source': diagnostics.source,
                                                    'data-ptv-native-home-row-config-hash': diagnostics.rowConfigHash || '',
                                                    'data-ptv-native-home-row-enabled': diagnostics.enabled ? 'true' : 'false',
                                                    'data-ptv-native-home-row-title': diagnostics.rowTitle,
                                                    'data-ptv-native-home-row-type': diagnostics.rowType,
                                                    'data-ptv-native-home-settings-missing': diagnostics.renderedButMissingFromRecommendationSettings ? 'true' : 'false',
                                                    'data-ptv-native-home-source-group-id': diagnostics.sourceGroupId || '',
                                                    'data-ptv-native-home-source-group-title': diagnostics.sourceGroupTitle || '',
                                                    'data-ptv-native-home-source-value': diagnostics.sourceValue || '',
                                                    'data-ptv-native-home-more-url': row.moreUrl || ''
                                                } : {};

                                                return (
                                                    <div
                                                        key={row.id}
                                                        ref={registerRowRef(row.id)}
                                                        className='ptv-native-home-row-anchor'
                                                        data-ptv-native-home-row-id={row.id}
                                                        data-ptv-native-home-row-mounted={isRowMounted(row.id) ? 'true' : 'false'}
                                                        data-ptv-native-home-row-mount-reason={getRowMountReason(row.id) || ''}
                                                        data-ptv-native-home-row-source={row.source}
                                                        data-ptv-native-home-adaptive-priority={row.adaptivePriorityScore == null ? '' : String(row.adaptivePriorityScore)}
                                                        data-ptv-native-home-adaptive-reason={row.adaptiveReason || ''}
                                                        data-ptv-native-home-home-profile-mood={row.homeProfileMood || ''}
                                                        data-ptv-native-home-pinned={row.pinned ? 'true' : 'false'}
                                                        data-ptv-native-home-rendered-source={diagnostics.source}
                                                        data-ptv-native-home-source-cache-section-id={row.sourceCacheSectionId || ''}
                                                        data-ptv-native-home-source-config-hash={row.sourceConfigHash || ''}
                                                        data-ptv-native-home-source-recommendation-id={diagnostics.sourceRecommendationId || ''}
                                                        data-ptv-native-home-source-rule-id={diagnostics.sourceRuleId || ''}
                                                        {...debugAttributes}
                                                    >
                                                        <NativeHomeRowView
                                                            canShowDebug={canShowDebug}
                                                            isMounted={isRowMounted(row.id)}
                                                            onActiveBackdropItemChange={handleFocusedBackdropItemChange}
                                                            onLayoutAction={handleRowLayoutAction}
                                                            row={row}
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </PTVShell>
            </main>
        </Page>
    );
}

function registerNativeHomeRoute() {
    const routeController = window.PTV?.routeController as {
        registerRoute?: (path: string, component: unknown, mode: 'native') => unknown;
    } | undefined;

    if (routeController?.registerRoute) {
        routeController.registerRoute('/home', NativeHome, 'native');
        return;
    }

    registerPtvNativeRoute('/home', NativeHome, 'native');
}

registerNativeHomeRoute();

export default NativeHome;
