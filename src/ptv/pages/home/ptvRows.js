import escapeHtml from 'escape-html';

import cardBuilder from 'components/cardbuilder/cardBuilder';
import imageLoader from 'components/images/imageLoader';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { getPtvPerformanceProfile } from 'ptv/core/clientProfile';
import { PTV_ROUTES } from 'ptv/core/config';
import {
    cleanupPtvLazyImages,
    enhancePtvLazyImageAttributes,
    loadPtvImage,
    observePtvLazyImages
} from 'ptv/core/imageManager';
import { isPtvDebugEnabled, recordPtvEvent, timePtvAsync } from 'ptv/core/observability';
import { getCurrentPtvPluginApiClient } from 'ptv/core/pluginApi';
import { getFeaturedContent } from 'ptv/modules/cache/featuredContentCache';
import { getPtvQualityTags } from 'ptv/modules/cards/qualityTags';
import { loadSharedHeroItems } from 'ptv/modules/hero/useHeroItems';
import { getBackdropShape, getPortraitShape, getSquareShape } from 'utils/card';
import {
    isAnimeItem,
    isFamilyAnimationItem,
    mediaBrandMatchers
} from './rowMatchers/mediaBrandMatcher';

const ROW_ITEM_LIMIT = 16;
const CONTINUE_ROW_CACHE_TTL_MS = 90000;
const CONTINUE_ROW_FETCH_TIMEOUT_MS = 1600;
const MEDIA_FIELDS = 'PrimaryImageAspectRatio,Path,MediaSources,MediaSourceCount,Genres,Tags,Studios,ProductionLocations,ProviderIds,OriginalTitle,DateCreated,PremiereDate,ProductionYear,CommunityRating,CriticRating';
const VERSION_PROVIDER_KEYS = [
    'Tmdb',
    'Imdb',
    'Tvdb',
    'MusicBrainzAlbum',
    'MusicBrainzReleaseGroup',
    'MusicBrainzArtist'
];
const RESOLUTION_SCORES = new Map([
    ['8k', 8000],
    ['4k', 4000],
    ['2160p', 2160],
    ['1440p', 1440],
    ['1080p', 1080],
    ['720p', 720],
    ['480p', 480]
]);
let backdropSeed = Date.now();
const rowBackdropObservers = new WeakMap();
const rowBackdropLoads = new WeakMap();
const rowBackdropTokens = new WeakMap();
const continueRowCache = new Map();
const continueRowInFlight = new Map();

function getHomePerformanceProfile(options = {}) {
    return options.performanceProfile || getPtvPerformanceProfile();
}

function clampLimit(value, maxValue) {
    const limit = Number(value) || ROW_ITEM_LIMIT;
    const maxLimit = Number(maxValue) || limit;

    return Math.max(1, Math.min(limit, maxLimit));
}

function getRowItemLimit(row, options = {}) {
    return clampLimit(row.itemLimit || ROW_ITEM_LIMIT, getHomePerformanceProfile(options).rowItemLimit);
}

function getRowQueryLimit(row, options = {}) {
    return clampLimit(row.queryLimit || getRowItemLimit(row, options), getHomePerformanceProfile(options).rowItemLimit);
}

function getRowCandidateLimit(row, options = {}) {
    const profile = getHomePerformanceProfile(options);
    const requested = row.candidateLimit || getRowQueryLimit(row, options);
    const maxCandidates = Math.max(getRowItemLimit(row, options), (profile.rowItemLimit || ROW_ITEM_LIMIT) * 9);

    return clampLimit(requested, maxCandidates);
}

function getSearchTerms(row, options = {}) {
    const terms = row.searchTerms || [];
    const maxTerms = getHomePerformanceProfile(options).searchTermLimit;

    return maxTerms ? terms.slice(0, maxTerms) : terms;
}

export const PTV_HOME_ROWS = [
    {
        groupKicker: 'Jump back in',
        groupTitle: 'Home Base',
        id: 'my-media',
        presentation: 'library-hub',
        tier: 1,
        title: 'My Media',
        type: 'libraries'
    },
    {
        groupKicker: 'Personal',
        groupTitle: 'Your Favorites',
        id: 'continue-watching',
        itemLimit: 8,
        presentation: 'featured',
        queryLimit: 8,
        rowKicker: 'Resume without hunting',
        tier: 1,
        title: 'Continue Watching',
        type: 'continue'
    },
    {
        groupKicker: 'Personal',
        groupTitle: 'Your Favorites',
        id: 'requested-by-you',
        title: 'Requested By You',
        type: 'seerr-requests',
        itemLimit: 16,
        moreUrl: PTV_ROUTES.request,
        presentation: 'featured',
        queryLimit: 24,
        rowKicker: 'Requests and watchlist context',
        tier: 1,
        userScoped: true
    },
    {
        groupKicker: 'Fresh arrivals',
        groupTitle: 'Discover',
        id: 'latest-movies',
        itemTypes: 'Movie',
        presentation: 'featured',
        rowKicker: 'New films in your libraries',
        shape: 'portrait',
        tier: 1,
        title: 'Latest Movies',
        type: 'latest'
    },
    {
        groupKicker: 'Fresh arrivals',
        groupTitle: 'Discover',
        id: 'latest-shows',
        itemTypes: 'Series',
        presentation: 'featured',
        rowKicker: 'Recently added series',
        shape: 'portrait',
        tier: 1,
        title: 'Latest Shows',
        type: 'latest'
    },
    {
        groupKicker: 'Fresh arrivals',
        groupTitle: 'Discover',
        id: 'latest-music',
        itemTypes: 'MusicAlbum',
        preferPrimaryImage: true,
        presentation: 'standard',
        shape: 'square',
        tier: 2,
        title: 'Latest Music',
        type: 'latest'
    },
    {
        groupKicker: 'Mood shelves',
        groupTitle: 'Explore Genres',
        id: 'horror',
        presentation: 'compact',
        tier: 3,
        title: 'Horror',
        type: 'genre',
        genres: ['Horror']
    },
    { id: 'comedy', title: 'Comedy', type: 'genre', genres: ['Comedy'], presentation: 'compact', tier: 3, groupTitle: 'Explore Genres', groupKicker: 'Mood shelves' },
    { id: 'family-animation', title: 'Family Animation', type: 'genre', genres: ['Family', 'Animation'], itemMatcher: isFamilyAnimationItem, presentation: 'compact', tier: 3, groupTitle: 'Explore Genres', groupKicker: 'Mood shelves' },
    { id: 'drama', title: 'Drama', type: 'genre', genres: ['Drama'], presentation: 'compact', tier: 3, groupTitle: 'Explore Genres', groupKicker: 'Mood shelves' },
    { id: 'science-fiction', title: 'Science Fiction', type: 'genre', genres: ['Science Fiction', 'Sci-Fi', 'Sci Fi'], presentation: 'compact', tier: 3, groupTitle: 'Explore Genres', groupKicker: 'Mood shelves' },
    {
        groupKicker: 'Curated worlds',
        groupTitle: 'Collections & Franchises',
        id: 'anime',
        title: mediaBrandMatchers.anime.definition.title,
        type: 'search',
        candidateLimit: 220,
        includeItemTypes: 'Movie,Series',
        itemMatcher: isAnimeItem,
        queryLimit: 14,
        searchTerms: mediaBrandMatchers.anime.searchTerms,
        presentation: 'standard',
        studioKeywords: mediaBrandMatchers.anime.studioKeywords,
        studioNames: mediaBrandMatchers.anime.studioNames,
        tier: 2
    },
    {
        groupKicker: 'Quick access',
        groupTitle: 'Library Hubs',
        id: 'music',
        title: 'Music',
        type: 'library',
        libraryNames: ['music'],
        itemTypes: 'MusicAlbum',
        preferPrimaryImage: true,
        presentation: 'library-hub',
        shape: 'square',
        sortBy: 'CommunityRating,SortName',
        sortOrder: 'Descending',
        tier: 2
    },
    { id: 'family', title: 'Family', type: 'genre', genres: ['Family'], presentation: 'compact', tier: 3, groupTitle: 'Explore Genres', groupKicker: 'Mood shelves' },
    { id: 'action', title: 'Action', type: 'genre', genres: ['Action'], presentation: 'compact', tier: 3, groupTitle: 'Explore Genres', groupKicker: 'Mood shelves' },
    {
        groupKicker: 'Curated worlds',
        groupTitle: 'Collections & Franchises',
        id: 'disney',
        title: mediaBrandMatchers.disney.definition.title,
        type: 'search',
        candidateLimit: 180,
        includeItemTypes: 'Movie,Series',
        itemMatcher: mediaBrandMatchers.disney.matches,
        queryLimit: 12,
        searchTerms: mediaBrandMatchers.disney.searchTerms,
        presentation: 'standard',
        studioKeywords: mediaBrandMatchers.disney.studioKeywords,
        studioNames: mediaBrandMatchers.disney.studioNames,
        tier: 2
    },
    { id: 'marvel', title: 'Marvel', type: 'search', searchTerm: 'marvel', presentation: 'standard', tier: 2, groupTitle: 'Collections & Franchises', groupKicker: 'Curated worlds' },
    {
        groupKicker: 'Curated worlds',
        groupTitle: 'Collections & Franchises',
        id: 'star-wars',
        title: mediaBrandMatchers.starWars.definition.title,
        type: 'search',
        candidateLimit: 220,
        includeItemTypes: 'Movie,Series',
        itemMatcher: mediaBrandMatchers.starWars.matches,
        queryLimit: 18,
        searchTerms: mediaBrandMatchers.starWars.searchTerms,
        presentation: 'standard',
        studioKeywords: mediaBrandMatchers.starWars.studioKeywords,
        studioNames: mediaBrandMatchers.starWars.studioNames,
        tier: 2
    },
    {
        groupKicker: 'Curated worlds',
        groupTitle: 'Collections & Franchises',
        id: 'star-trek',
        title: mediaBrandMatchers.starTrek.definition.title,
        type: 'search',
        candidateLimit: 220,
        includeItemTypes: 'Movie,Series',
        itemMatcher: mediaBrandMatchers.starTrek.matches,
        queryLimit: 18,
        searchTerms: mediaBrandMatchers.starTrek.searchTerms,
        presentation: 'standard',
        studioKeywords: mediaBrandMatchers.starTrek.studioKeywords,
        studioNames: mediaBrandMatchers.starTrek.studioNames,
        tier: 2
    },
    { id: 'adult-animation', title: 'Adult Animation', type: 'search', searchTerm: 'adult animation', presentation: 'standard', tier: 2, groupTitle: 'Collections & Franchises', groupKicker: 'Curated worlds' },
    { id: 'crime', title: 'Crime', type: 'genre', genres: ['Crime'], presentation: 'compact', tier: 3, groupTitle: 'Explore Genres', groupKicker: 'Mood shelves' }
];

const ROW_PRESENTATIONS = new Set(['featured', 'standard', 'compact', 'mini', 'library-hub']);
const SECONDARY_LATEST_MEDIA_TYPES = new Set(['books', 'liveTv', 'music']);

function normalizeRowTier(value, fallback = 3) {
    const tier = Number(value);

    return [1, 2, 3].includes(tier) ? tier : fallback;
}

function normalizeRowPresentation(value, fallback = 'standard') {
    const presentation = String(value || '').trim().toLowerCase();

    return ROW_PRESENTATIONS.has(presentation) ? presentation : fallback;
}

function getCleanString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isContinueRow(row) {
    return row.id === 'continue-watching'
        || row.type === 'continue'
        || row.sourceType === 'continue'
        || row.sourceType === 'continueWatching';
}

function isRequestedRow(row) {
    return row.id === 'requested-by-you'
        || row.type === 'seerr-requests'
        || row.sourceType === 'requested'
        || row.sourceType === 'jellyseerr';
}

function isLibraryHubRow(row) {
    return row.type === 'libraries'
        || row.sourceType === 'library'
        || row.type === 'library';
}

function isLatestRow(row) {
    return row.type === 'latest'
        || row.sourceType === 'latest'
        || row.generationMode === 'latest';
}

function isPremiumLatestRow(row) {
    return isLatestRow(row) && !SECONDARY_LATEST_MEDIA_TYPES.has(row.mediaType);
}

function isGenreOrStudioRow(row) {
    return row.type === 'genre'
        || row.sourceType === 'genre'
        || row.sourceType === 'studio';
}

function isCuratedRow(row) {
    return row.type === 'search'
        || row.sourceType === 'collection'
        || row.sourceType === 'seasonal'
        || row.sourceType === 'popular'
        || row.generationMode === 'popular'
        || row.generationMode === 'highestRated';
}

function getDerivedRowTier(row) {
    if (row.tier) return normalizeRowTier(row.tier);
    if (isContinueRow(row) || isRequestedRow(row) || isPremiumLatestRow(row)) return 1;
    if (isLibraryHubRow(row) || isCuratedRow(row) || isLatestRow(row)) return 2;
    if (isGenreOrStudioRow(row)) return 3;

    return 3;
}

function getDerivedRowPresentation(row) {
    if (row.presentation && row.presentation !== 'auto') return normalizeRowPresentation(row.presentation);
    if (row.type === 'libraries' || row.id === 'my-media') return 'library-hub';
    if (isContinueRow(row) || isRequestedRow(row) || isPremiumLatestRow(row)) return 'featured';
    if (isGenreOrStudioRow(row)) return 'compact';
    if (row.mediaType === 'music' || row.itemTypes === 'MusicAlbum') return 'mini';

    return 'standard';
}

function getDerivedRowGroup(row) {
    const explicitTitle = getCleanString(row.groupTitle);
    if (explicitTitle) {
        return {
            key: getCleanString(row.groupKey) || explicitTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            kicker: getCleanString(row.groupKicker),
            title: explicitTitle
        };
    }

    if (row.type === 'libraries' || row.id === 'my-media') {
        return { key: 'home-base', kicker: 'Jump back in', title: 'Home Base' };
    }

    if (isContinueRow(row) || isRequestedRow(row)) {
        return { key: 'your-favorites', kicker: 'Personal', title: 'Your Favorites' };
    }

    if (isPremiumLatestRow(row)) {
        return { key: 'discover', kicker: 'Fresh arrivals', title: 'Discover' };
    }

    if (isCuratedRow(row) || row.sourceType === 'seasonal') {
        return { key: 'collections-franchises', kicker: 'Curated worlds', title: 'Collections & Franchises' };
    }

    if (isGenreOrStudioRow(row)) {
        return { key: 'explore-genres', kicker: 'Mood shelves', title: 'Explore Genres' };
    }

    return { key: 'deep-catalog', kicker: 'Deep catalog', title: 'More to Watch' };
}

function getDerivedRowKicker(row) {
    if (row.rowKicker) return row.rowKicker;
    if (isContinueRow(row)) return 'Resume without hunting';
    if (isRequestedRow(row)) return 'Requests and watchlist context';
    if (row.id === 'latest-movies') return 'New films in your libraries';
    if (row.id === 'latest-shows') return 'Recently added series';
    if (isGenreOrStudioRow(row)) return 'Compact discovery';

    return '';
}

function enrichRowComposition(row) {
    const tier = getDerivedRowTier(row);
    const presentation = getDerivedRowPresentation(row);
    const group = getDerivedRowGroup(row);

    return {
        ...row,
        groupKey: getCleanString(row.groupKey) || group.key,
        groupKicker: getCleanString(row.groupKicker) || group.kicker,
        groupTitle: getCleanString(row.groupTitle) || group.title,
        isPersonalized: row.isPersonalized === true || isContinueRow(row) || isRequestedRow(row),
        presentation,
        rowKicker: getDerivedRowKicker(row),
        tier
    };
}

function applyRowComposition(rows) {
    let previousGroupKey = '';

    return rows.map(row => {
        const enrichedRow = enrichRowComposition(row);
        const showGroupHeader = enrichedRow.groupKey && enrichedRow.groupKey !== previousGroupKey;

        previousGroupKey = enrichedRow.groupKey || previousGroupKey;

        return {
            ...enrichedRow,
            showGroupHeader
        };
    });
}

function normalizeFeaturedSection(section) {
    if (!section || typeof section !== 'object' || !section.id || !section.title) return null;

    const type = section.type || 'featured';

    return {
        id: String(section.id),
        title: String(section.title),
        type,
        includeItemTypes: section.includeItemTypes || undefined,
        itemLimit: Number.isFinite(section.itemLimit) ? section.itemLimit : ROW_ITEM_LIMIT,
        mediaType: section.mediaType || 'mixed',
        presentation: section.presentation || section.presentationType || undefined,
        queryLimit: Number.isFinite(section.itemLimit) ? section.itemLimit : ROW_ITEM_LIMIT,
        groupKey: section.groupKey || undefined,
        groupKicker: section.groupKicker || undefined,
        groupTitle: section.groupTitle || undefined,
        rowKicker: section.rowKicker || undefined,
        searchTerm: section.source || section.title,
        shape: section.shape || undefined,
        showWhenEmpty: section.showWhenEmpty === true,
        emptyResultReason: section.emptyResultReason || undefined,
        sourceType: section.sourceType || 'featured',
        tier: section.tier || undefined
    };
}

export function getRowsFromFeaturedPayload(payload, fallbackRows = PTV_HOME_ROWS) {
    const dynamicRows = Array.isArray(payload?.sections) ?
        payload.sections.map(normalizeFeaturedSection).filter(Boolean) :
        [];
    const fixedRows = fallbackRows.filter(row => row.type === 'libraries');

    if (!dynamicRows.length) {
        return applyRowComposition(payload?.rowConfigApplied === true ? fixedRows : fallbackRows);
    }

    const seenIds = new Set(fixedRows.map(row => row.id));
    const mergedRows = [...fixedRows];

    dynamicRows.forEach(row => {
        if (!seenIds.has(row.id)) {
            seenIds.add(row.id);
            mergedRows.push(row);
        }
    });

    return applyRowComposition(mergedRows);
}

function hasRenderableImage(item) {
    return Boolean(
        item?.ImageTags?.Primary
        || item?.ImageTags?.Backdrop
        || item?.ImageTags?.Thumb
        || item?.ImageTags?.Banner
        || item?.PrimaryImageTag
        || item?.SeriesPrimaryImageTag
        || item?.ParentPrimaryImageTag
        || item?.AlbumPrimaryImageTag
        || item?.BackdropImageTags?.length
        || item?.ParentBackdropImageTags?.length
        || item?.SeriesThumbImageTag
        || item?.ParentThumbImageTag
    );
}

function isQualityTagCandidate(item) {
    return item?.MediaType === 'Video'
        || ['Movie', 'Episode', 'Series', 'Season', 'Video'].includes(item?.Type);
}

function hasQualityMetadata(item) {
    return Boolean(
        item?.PtvQualityTags?.length
        || item?.MediaSources?.length
        || item?.MediaStreams?.length
        || item?.Width
        || item?.Height
        || item?.VideoRange
        || item?.VideoCodec
    );
}

function hasEnoughCachedQualityMetadata(items) {
    const qualityCandidates = (items || []).filter(isQualityTagCandidate);

    if (!qualityCandidates.length) return true;

    return qualityCandidates.some(hasQualityMetadata);
}

function getItems(result) {
    return result?.Items || result || [];
}

function getTextValue(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);

    return '';
}

function normalizeVersionText(value) {
    return getTextValue(value)
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function getItemYear(item) {
    const productionYear = Number(item?.ProductionYear);

    if (Number.isFinite(productionYear) && productionYear > 0) {
        return String(productionYear);
    }

    const premiereDate = getTextValue(item?.PremiereDate);
    const yearMatch = /\b(19|20)\d{2}\b/.exec(premiereDate);

    return yearMatch?.[0] || '';
}

function getProviderVersionKey(item) {
    const providerIds = item?.ProviderIds;
    if (!providerIds || typeof providerIds !== 'object') return '';

    const providersByLowerKey = new Map(
        Object.keys(providerIds).map(key => [key.toLowerCase(), getTextValue(providerIds[key])])
    );

    for (const providerKey of VERSION_PROVIDER_KEYS) {
        const providerValue = providersByLowerKey.get(providerKey.toLowerCase());

        if (providerValue) {
            return `${providerKey.toLowerCase()}:${providerValue.toLowerCase()}`;
        }
    }

    return '';
}

function getItemVersionKey(item) {
    if (!item) return '';

    const itemType = getTextValue(item.Type || item.MediaType || 'item').toLowerCase();

    if (itemType === 'episode') {
        const seriesKey = item.SeriesId
            || getProviderVersionKey(item)
            || normalizeVersionText(item.SeriesName || item.Name);
        const seasonIndex = getTextValue(item.ParentIndexNumber);
        const episodeIndex = getTextValue(item.IndexNumber);

        if (seriesKey && (seasonIndex || episodeIndex)) {
            return `episode:${seriesKey}:${seasonIndex}:${episodeIndex}`;
        }
    }

    const providerKey = getProviderVersionKey(item);
    if (providerKey) return `${itemType}:${providerKey}`;

    const title = normalizeVersionText(item.OriginalTitle || item.Name);
    const year = getItemYear(item);

    if (title && year) return `${itemType}:${title}:${year}`;
    if (title && itemType !== 'audio') return `${itemType}:${title}`;

    return getTextValue(item.Id || item.ItemId);
}

function getRecordArray(value) {
    if (!Array.isArray(value)) return [];

    return value.filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry));
}

function getNumberValue(...values) {
    for (const value of values) {
        const numberValue = typeof value === 'number' ? value : Number(value);

        if (Number.isFinite(numberValue) && numberValue > 0) {
            return numberValue;
        }
    }

    return 0;
}

function getBestVideoDimensions(item) {
    let width = getNumberValue(item?.Width);
    let height = getNumberValue(item?.Height);
    const sources = getRecordArray(item?.MediaSources);
    const streams = getRecordArray(item?.MediaStreams);

    sources.forEach(source => {
        width = Math.max(width, getNumberValue(source.Width));
        height = Math.max(height, getNumberValue(source.Height));

        getRecordArray(source.MediaStreams).forEach(stream => {
            if (getTextValue(stream.Type).toLowerCase() !== 'video') return;

            width = Math.max(width, getNumberValue(stream.Width));
            height = Math.max(height, getNumberValue(stream.Height));
        });
    });

    streams.forEach(stream => {
        if (getTextValue(stream.Type).toLowerCase() !== 'video') return;

        width = Math.max(width, getNumberValue(stream.Width));
        height = Math.max(height, getNumberValue(stream.Height));
    });

    return {
        height,
        width
    };
}

function getResolutionScore(item) {
    const { height, width } = getBestVideoDimensions(item);
    const dimensionScore = Math.max(height, Math.round(width / 1.78));
    const qualityScore = getPtvQualityTags(item, {
        enabledCategories: ['resolution'],
        maxTags: 3
    })
        .reduce((score, tag) => {
            const label = tag.label.toLowerCase();

            return Math.max(score, RESOLUTION_SCORES.get(label) || Number(label.replace('p', '')) || 0);
        }, 0);

    return Math.max(dimensionScore, qualityScore);
}

function getQualityFeatureScore(item) {
    return getPtvQualityTags(item, { maxTags: 12 })
        .reduce((score, tag) => score + (tag.priority || 0), 0);
}

function getPreferredVersionScore(item) {
    const resumeTicks = getNumberValue(item?.UserData?.PlaybackPositionTicks);
    const resumeScore = resumeTicks > 0 ? 10000000 : 0;
    const playedPenalty = item?.UserData?.Played ? -500 : 0;
    const sourceCount = getNumberValue(item?.MediaSourceCount, getRecordArray(item?.MediaSources).length);

    return resumeScore
        + (getResolutionScore(item) * 1000)
        + getQualityFeatureScore(item)
        + (sourceCount * 10)
        + playedPenalty;
}

function mergeVersionMetadata(preferredItem, versions) {
    const versionIds = versions
        .map(item => getTextValue(item?.Id || item?.ItemId))
        .filter(Boolean);

    if (versionIds.length <= 1 || !preferredItem || typeof preferredItem !== 'object') {
        return preferredItem;
    }

    return {
        ...preferredItem,
        PtvAlternateVersionIds: versionIds.filter(id => id !== preferredItem.Id),
        PtvVersionCount: versionIds.length
    };
}

function getUniqueItems(items) {
    const itemGroups = new Map();
    const order = [];

    (items || []).forEach(item => {
        const key = getItemVersionKey(item);

        if (!key) return;

        if (!itemGroups.has(key)) {
            itemGroups.set(key, []);
            order.push(key);
        }

        itemGroups.get(key).push(item);
    });

    const uniqueItems = order.map(key => {
        const versions = itemGroups.get(key);
        const preferredItem = versions.reduce((bestItem, candidate) => {
            if (!bestItem) return candidate;

            return getPreferredVersionScore(candidate) > getPreferredVersionScore(bestItem) ? candidate : bestItem;
        }, null);

        return mergeVersionMetadata(preferredItem, versions);
    }).filter(Boolean);

    if (uniqueItems.length < (items || []).length) {
        recordPtvEvent('render', 'dedupe-versions', {
            duplicateCount: (items || []).length - uniqueItems.length,
            itemCount: uniqueItems.length
        });
    }

    return uniqueItems;
}

function getRowRenderItems(row, items, options = {}) {
    return getUniqueItems(filterRowItems(row, items))
        .slice(0, getRowItemLimit(row, options));
}

function toRowResultWithItems(result, items) {
    if (Array.isArray(result)) return { Items: items };

    return {
        ...(result || {}),
        Items: items
    };
}

function getItemsFromResults(results) {
    const items = [];

    results.forEach(result => {
        items.push(...getItems(result));
    });

    return items;
}

function getContinueRowCacheKey(currentApiClient, userId, row, options = {}) {
    const serverId = currentApiClient?.serverId?.() || getFallbackServerId(options);

    return [
        serverId,
        userId,
        row.id || row.type,
        getRowItemLimit(row, options)
    ].join(':');
}

function getCachedContinueItems(cacheKey) {
    const entry = continueRowCache.get(cacheKey);

    if (!entry) return null;

    if (Date.now() >= entry.expiresAt) {
        continueRowCache.delete(cacheKey);
        return null;
    }

    return entry.items;
}

function setCachedContinueItems(cacheKey, items) {
    continueRowCache.set(cacheKey, {
        expiresAt: Date.now() + CONTINUE_ROW_CACHE_TTL_MS,
        items: items || []
    });

    if (continueRowCache.size > 8) {
        const oldestKey = continueRowCache.keys().next().value;

        if (oldestKey) {
            continueRowCache.delete(oldestKey);
        }
    }
}

function withRowTimeout(promise, timeoutMs, fallback, detail) {
    let timer = 0;
    const timeout = new Promise(resolve => {
        timer = window.setTimeout(() => {
            recordPtvEvent('row-fetch', 'timeout-fallback', detail);
            resolve(fallback);
        }, timeoutMs);
    });

    return Promise.race([
        promise.finally(() => {
            window.clearTimeout(timer);
        }),
        timeout
    ]);
}

function filterRowItems(row, items) {
    if (typeof row.itemMatcher !== 'function') return items;

    return items.filter(item => row.itemMatcher(item));
}

function getGenreIds(row, genresByName) {
    return (row.genres || [])
        .map(genreName => genresByName.get(genreName.toLowerCase()))
        .filter(Boolean)
        .join(',');
}

function getPrimaryGenreId(row, genresByName) {
    return (row.genres || [])
        .map(genreName => genresByName.get(genreName.toLowerCase()))
        .find(Boolean) || '';
}

function getGenreUrl(row, genresByName, serverId) {
    if (row.type !== 'genre') return '';

    const genreId = getPrimaryGenreId(row, genresByName);
    if (!genreId || !serverId) return '';

    return `#/list?genreId=${encodeURIComponent(genreId)}&serverId=${encodeURIComponent(serverId)}`;
}

function getRowUrl(row, genresByName, serverId) {
    if (row.moreUrl) return row.moreUrl;
    if (row.type === 'continue' || !serverId) return '';

    if (row.type === 'genre') {
        return getGenreUrl(row, genresByName, serverId);
    }

    if (row.type === 'latest' && row.itemTypes) {
        return `#/list?serverId=${encodeURIComponent(serverId)}&type=${encodeURIComponent(row.itemTypes)}`;
    }

    if (row.type === 'library' && row.parentId) {
        return `#/list?parentId=${encodeURIComponent(row.parentId)}&serverId=${encodeURIComponent(serverId)}`;
    }

    if (row.type === 'search') {
        const searchTerm = row.searchTerm || row.searchTerms?.[0] || row.title;

        return `#/search?query=${encodeURIComponent(searchTerm)}`;
    }

    return '';
}

function getStudioIds(row, studiosByName) {
    const studioIds = new Set();
    const studioNames = (row.studioNames || []).map(studioName => studioName.toLowerCase());
    const studioKeywords = (row.studioKeywords || []).map(studioName => studioName.toLowerCase());

    studioNames
        .map(studioName => studiosByName.get(studioName))
        .filter(Boolean)
        .forEach(studioId => {
            studioIds.add(studioId);
        });

    if (studioKeywords.length) {
        studiosByName.forEach((studioId, studioName) => {
            if (studioKeywords.some(keyword => studioName.includes(keyword))) {
                studioIds.add(studioId);
            }
        });
    }

    return Array.from(studioIds).join('|');
}

function getCardShape(row, enableOverflow) {
    if (row.shape === 'portrait') return getPortraitShape(enableOverflow);
    if (row.shape === 'square') return getSquareShape(enableOverflow);

    return getBackdropShape(enableOverflow);
}

function getFallbackServerId(options = {}) {
    if (options.serverId) return options.serverId;

    const apiServerId = options.apiClient?.serverId?.();
    if (apiServerId) return apiServerId;

    return ServerConnections.currentApiClient?.()?.serverId?.() || '';
}

function ensureItemsHaveServerId(items, options = {}) {
    const serverId = getFallbackServerId(options);
    if (!serverId) return items || [];

    return (items || []).map(item => {
        if (!item || typeof item !== 'object' || item.ServerId) return item;

        return {
            ...item,
            ServerId: serverId
        };
    });
}

function getCardsHtml(row, items, options) {
    const cardOptions = {
        ...options,
        serverId: getFallbackServerId(options)
    };
    const renderItems = ensureItemsHaveServerId(items, cardOptions);

    if (!renderItems.length && row.showWhenEmpty) {
        let html = getEmptyRowHtml(row, cardOptions);

        if (row.moreUrl) {
            html += getMoreCardHtml(row, cardOptions);
        }

        recordPtvEvent('render', 'row-empty-html', {
            row: row.id || row.title || row.type,
            rowType: row.type
        });

        return html;
    }

    let html = cardBuilder.getCardsHtml({
        items: renderItems,
        shape: getCardShape(row, options.enableOverflow),
        preferThumb: row.preferPrimaryImage ? false : row.shape !== 'portrait',
        scalable: true,
        overlayPlayButton: true,
        allowBottomPadding: false,
        showTitle: true,
        showYear: row.shape !== 'square',
        centerText: true,
        context: 'home',
        lines: 2,
        serverId: cardOptions.serverId
    });

    recordPtvEvent('render', 'row-card-html', {
        cardCount: renderItems.length,
        row: row.id || row.title || row.type,
        rowType: row.type
    });

    if (row.moreUrl) {
        html += getMoreCardHtml(row, cardOptions);
    }

    return html;
}

function getRowItemsHtml(row, options) {
    return items => getCardsHtml(row, items, options);
}

function getRandomIndex(length) {
    if (length <= 1) return 0;

    backdropSeed = (backdropSeed * 1664525 + 1013904223) >>> 0;

    return backdropSeed % length;
}

function debugRowBackdrop(message, details) {
    if (!isPtvDebugEnabled()) return;

    console.debug(`[PTV Rows] row backdrop ${message}`, details);
}

function isRowNearViewport(elem, margin = 360) {
    if (!elem?.isConnected || elem.classList.contains('hide')) return false;
    if (typeof elem.getBoundingClientRect !== 'function') return true;
    if (typeof window === 'undefined') return true;

    const rect = elem.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    return rect.bottom >= -margin && rect.top <= window.innerHeight + margin;
}

function getDirectImageUrl(apiClient, itemId, type, options) {
    if (!apiClient?.getUrl || !itemId) return '';

    const path = typeof options.index === 'number' ?
        `Items/${itemId}/Images/${type}/${options.index}` :
        `Items/${itemId}/Images/${type}`;

    const params = {
        maxWidth: options.maxWidth
    };

    if (options.tag) {
        params.tag = options.tag;
    }

    return apiClient.getUrl(path, params);
}

function getImageUrlCandidates(apiClient, itemId, type, options) {
    if (!apiClient || !itemId) return [];

    const untaggedOptions = {
        ...options
    };

    delete untaggedOptions.tag;

    return Array.from(new Set([
        getDirectImageUrl(apiClient, itemId, type, options),
        getDirectImageUrl(apiClient, itemId, type, untaggedOptions),
        apiClient.getScaledImageUrl?.(itemId, {
            type,
            ...options
        })
    ].filter(Boolean)));
}

function getBackdropUrls(apiClient, item, options = {}) {
    const performanceProfile = getHomePerformanceProfile(options);

    if (!performanceProfile.enableRowBackdrops) return [];
    if (!apiClient || !item?.Id) return [];

    if (item.BackdropImageTags?.length) {
        return getImageUrlCandidates(apiClient, item.Id, 'Backdrop', {
            maxWidth: performanceProfile.rowBackdropMaxWidth,
            index: 0,
            tag: item.BackdropImageTags[0]
        });
    }

    if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.length) {
        return getImageUrlCandidates(apiClient, item.ParentBackdropItemId, 'Backdrop', {
            maxWidth: performanceProfile.rowBackdropMaxWidth,
            index: 0,
            tag: item.ParentBackdropImageTags[0]
        });
    }

    if (item.ImageTags?.Thumb) {
        return getImageUrlCandidates(apiClient, item.Id, 'Thumb', {
            maxWidth: performanceProfile.rowBackdropMaxWidth,
            tag: item.ImageTags.Thumb
        });
    }

    if (item.ParentThumbItemId && item.ParentThumbImageTag) {
        return getImageUrlCandidates(apiClient, item.ParentThumbItemId, 'Thumb', {
            maxWidth: performanceProfile.rowBackdropMaxWidth,
            tag: item.ParentThumbImageTag
        });
    }

    const primaryTag = item.ImageTags?.Primary
        || item.PrimaryImageTag
        || item.SeriesPrimaryImageTag
        || item.ParentPrimaryImageTag
        || item.AlbumPrimaryImageTag;

    if (!primaryTag) return [];

    return getImageUrlCandidates(apiClient, item.Id, 'Primary', {
        maxWidth: performanceProfile.rowPrimaryMaxWidth,
        tag: primaryTag
    });
}

function loadBackdropCandidate(urls) {
    const [url, ...fallbackUrls] = urls;

    if (!url) {
        return Promise.resolve('');
    }

    return loadPtvImage(url, 'decorative', 'row-backdrop')
        .promise
        .then(didLoad => {
            if (didLoad) return url;

            debugRowBackdrop('candidate failed', { url });
            return loadBackdropCandidate(fallbackUrls);
        });
}

function applyRowBackdropNow(elem, apiClient, items, options = {}) {
    const backdropElement = elem.querySelector('.ptv-row-backdrop');
    if (!backdropElement) return;

    if (!getHomePerformanceProfile(options).enableRowBackdrops) {
        rowBackdropLoads.get(elem)?.cancel();
        rowBackdropLoads.delete(elem);
        elem.classList.remove('ptv-row-has-backdrop');
        elem.style.removeProperty('--ptv-row-backdrop-image');
        backdropElement.removeAttribute('style');
        return;
    }

    const backdropItems = getUniqueItems(items)
        .map(item => ({
            item,
            urls: getBackdropUrls(apiClient, item, options)
        }))
        .filter(entry => entry.urls.length);

    if (!backdropItems.length) {
        rowBackdropLoads.get(elem)?.cancel();
        rowBackdropLoads.delete(elem);
        elem.classList.remove('ptv-row-has-backdrop');
        elem.style.removeProperty('--ptv-row-backdrop-image');
        backdropElement.removeAttribute('style');
        debugRowBackdrop('no candidates', {
            itemCount: items?.length || 0,
            rowTitle: elem.querySelector('.sectionTitle')?.textContent?.trim() || ''
        });
        return;
    }

    const entry = backdropItems[getRandomIndex(backdropItems.length)];
    const token = (rowBackdropTokens.get(elem) || 0) + 1;
    const handle = {
        cancel: () => undefined,
        promise: loadBackdropCandidate(entry.urls),
        url: entry.urls[0]
    };

    rowBackdropTokens.set(elem, token);
    rowBackdropLoads.get(elem)?.cancel();
    rowBackdropLoads.set(elem, handle);

    void handle.promise
        .then((loadedUrl) => {
            if (!loadedUrl || rowBackdropTokens.get(elem) !== token || !elem.isConnected) return;

            const safeUrl = loadedUrl.replace(/"/g, '%22');
            backdropElement.setAttribute('style', `background-image: url("${safeUrl}");`);
            elem.style.setProperty('--ptv-row-backdrop-image', `url("${safeUrl}")`);
            elem.classList.add('ptv-row-has-backdrop');
            debugRowBackdrop('loaded', {
                rowTitle: elem.querySelector('.sectionTitle')?.textContent?.trim() || '',
                url: loadedUrl
            });

            const homeSections = elem.closest('.homeSectionsContainer');
            if (homeSections && !homeSections.style.getPropertyValue('--ptv-home-backdrop-image')) {
                homeSections.style.setProperty('--ptv-home-backdrop-image', `url("${safeUrl}")`);
                homeSections.classList.add('ptv-home-has-backdrop');
            }
        })
        .finally(() => {
            if (rowBackdropLoads.get(elem) === handle) {
                rowBackdropLoads.delete(elem);
            }
        });
}

function applyRowBackdrop(elem, apiClient, items, options = {}) {
    if (!getHomePerformanceProfile(options).enableRowBackdrops) {
        applyRowBackdropNow(elem, apiClient, items, options);
        return;
    }

    const existingObserver = rowBackdropObservers.get(elem);
    existingObserver?.disconnect();
    rowBackdropObservers.delete(elem);

    if (
        options.deferRowBackdrops !== true
        || elem.dataset.ptvRowBackdropLoaded === 'true'
        || isRowNearViewport(elem)
        || typeof IntersectionObserver !== 'function'
    ) {
        applyRowBackdropNow(elem, apiClient, items, options);
        elem.dataset.ptvRowBackdropLoaded = 'true';
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        if (!entries.some(entry => entry.isIntersecting) && !isRowNearViewport(elem)) return;

        observer.disconnect();
        rowBackdropObservers.delete(elem);
        elem.dataset.ptvRowBackdropLoaded = 'true';
        applyRowBackdropNow(elem, apiClient, items, options);
    }, {
        rootMargin: '360px 0px'
    });

    rowBackdropObservers.set(elem, observer);
    observer.observe(elem);

    window.setTimeout(() => {
        if (rowBackdropObservers.get(elem) !== observer || !isRowNearViewport(elem)) return;

        observer.disconnect();
        rowBackdropObservers.delete(elem);
        elem.dataset.ptvRowBackdropLoaded = 'true';
        applyRowBackdropNow(elem, apiClient, items, options);
    }, 300);
}

export function cleanupPtvRowBackdrops(root = document) {
    const rootRow = root instanceof HTMLElement && root.classList.contains('ptv-dynamic-row') ? [root] : [];
    const descendantRows = Array.from(root.querySelectorAll?.('.ptv-dynamic-row') || []);

    [...rootRow, ...descendantRows].forEach((row) => {
        const observer = rowBackdropObservers.get(row);

        observer?.disconnect();
        rowBackdropObservers.delete(row);
        rowBackdropLoads.get(row)?.cancel();
        rowBackdropLoads.delete(row);
        rowBackdropTokens.delete(row);
        row.classList.remove('ptv-row-has-backdrop');
        row.style.removeProperty('--ptv-row-backdrop-image');
        row.querySelector('.ptv-row-backdrop')?.removeAttribute('style');
    });

    root.querySelectorAll?.('.itemsContainer').forEach((itemsContainer) => {
        if (typeof itemsContainer.ptvLazyImageCleanup === 'function') {
            itemsContainer.ptvLazyImageCleanup();
            itemsContainer.ptvLazyImageCleanup = null;
        }
    });

    if (root instanceof HTMLElement && root.classList.contains('homeSectionsContainer')) {
        root.style.removeProperty('--ptv-home-backdrop-image');
        root.classList.remove('ptv-home-has-backdrop');
    }

    cleanupPtvLazyImages(root);
}

function prepareManagedRowImages(itemsContainer, options = {}) {
    const performanceProfile = getHomePerformanceProfile(options);
    const rootMargin = performanceProfile.isLowPower || performanceProfile.isWebOs ?
        '180px 0px' :
        '480px 0px';

    enhancePtvLazyImageAttributes(itemsContainer);
    itemsContainer.ptvLazyImageCleanup?.();
    itemsContainer.ptvLazyImageCleanup = observePtvLazyImages(itemsContainer, {
        priority: performanceProfile.isLowPower ? 'below-fold-poster' : 'visible-poster',
        rootMargin,
        loadElement: (imageElement) => {
            if (
                imageElement instanceof HTMLElement
                && imageElement.classList.contains('lazy')
                && imageElement.dataset.src
            ) {
                imageLoader.lazyImage(imageElement);
            }
        }
    });
}

function loadRowImageElementsNow(itemsContainer) {
    const imageElements = Array.from(itemsContainer.querySelectorAll?.('.lazy[data-src], img[data-src]') || []);
    const rowId = itemsContainer.dataset.ptvRowId || 'row';

    imageElements.forEach(imageElement => {
        if (!(imageElement instanceof HTMLElement) || !imageElement.dataset.src) return;

        const imageUrl = imageElement.dataset.src;
        const handle = loadPtvImage(imageUrl, 'visible-poster', `viewport:${rowId}`);

        void handle.promise
            .finally(() => {
                if (!imageElement.isConnected || !imageElement.dataset.src) return;

                imageLoader.lazyImage(imageElement);
            });
    });

    debugRowBackdrop('forced row image load', {
        count: imageElements.length,
        rowId: itemsContainer.dataset.ptvRowId || '',
        rowType: itemsContainer.dataset.ptvRowType || ''
    });
}

function forceLoadRowImages(itemsContainer, options = {}) {
    prepareManagedRowImages(itemsContainer, options);

    if (!getHomePerformanceProfile(options).forceLoadRowImages) return;

    loadRowImageElementsNow(itemsContainer);
}

function getMoreCardHtml(row, options) {
    const shape = getCardShape(row, options.enableOverflow);
    const url = escapeHtml(row.moreUrl);
    const title = escapeHtml(row.title);

    return [
        `<a is="emby-linkbutton" href="${url}" class="card ${shape}Card ptv-card ptv-row-more-card ptv-ignore-stock-bridge" aria-label="Open more ${title}">`,
        '<div class="cardBox">',
        '<div class="cardScalable">',
        `<div class="cardPadder cardPadder-${shape}"></div>`,
        '<div class="cardContent ptv-row-more-card-content">',
        '<span class="ptv-row-more-card-kicker">More</span>',
        `<span class="ptv-row-more-card-title">${title}</span>`,
        '<span class="material-icons chevron_right ptv-row-more-card-icon" aria-hidden="true"></span>',
        '</div>',
        '</div>',
        '</div>',
        '</a>'
    ].join('');
}

function getEmptyRowHtml(row, options) {
    const shape = getCardShape(row, options.enableOverflow);
    const title = escapeHtml(row.title || 'Row');
    const message = escapeHtml(row.emptyResultReason || 'No items found.');

    return [
        `<div class="card ${shape}Card ptv-card ptv-row-empty-card ptv-ignore-stock-bridge" role="status" aria-label="${title}: ${message}">`,
        '<div class="cardBox">',
        '<div class="cardScalable">',
        `<div class="cardPadder cardPadder-${shape}"></div>`,
        '<div class="cardContent ptv-row-empty-card-content">',
        '<span class="material-icons ptv-row-empty-card-icon" aria-hidden="true">inbox</span>',
        `<span class="ptv-row-empty-card-title">${title}</span>`,
        `<span class="ptv-row-empty-card-message">${message}</span>`,
        '</div>',
        '</div>',
        '</div>',
        '</div>'
    ].join('');
}

function getRowQuery(row, genreIds, studioIds = '', options = {}) {
    const query = {
        Limit: getRowQueryLimit(row, options),
        Recursive: true,
        Fields: MEDIA_FIELDS,
        EnableImages: true,
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop,Banner,Thumb',
        EnableTotalRecordCount: false
    };

    if (studioIds) {
        query.StudioIds = studioIds;
    }

    if (genreIds) {
        query.GenreIds = genreIds;
    }

    if (row.type === 'latest') {
        return {
            ...query,
            IncludeItemTypes: row.itemTypes,
            SortBy: 'PremiereDate,DateCreated,SortName',
            SortOrder: 'Descending'
        };
    }

    if (row.type === 'genre') {
        return {
            ...query,
            IncludeItemTypes: row.includeItemTypes || 'Movie,Series',
            GenreIds: genreIds,
            SortBy: 'Random'
        };
    }

    if (row.type === 'library') {
        const sortBy = row.sortBy || 'Random';

        return {
            ...query,
            IncludeItemTypes: row.itemTypes || 'Movie,Series',
            ParentId: row.parentId,
            SortBy: sortBy,
            SortOrder: sortBy === 'Random' ? undefined : row.sortOrder || 'Descending'
        };
    }

    return {
        ...query,
        IncludeItemTypes: row.includeItemTypes || 'Movie,Series',
        SearchTerm: row.searchTerm || row.searchTerms?.[0],
        SortBy: 'Random'
    };
}

function getLibraryParentId(row, userViews) {
    const libraryNames = row.libraryNames || [];
    const library = userViews.find(view =>
        view.Id
        && libraryNames.includes(`${view.Name || ''}`.toLowerCase())
    );

    return library?.Id || '';
}

function fetchRowResultCore(currentApiClient, userId, row, genresByName, studiosByName, userViews, options = {}) {
    if (row.type === 'seerr-requests') {
        const pluginApi = getCurrentPtvPluginApiClient();

        if (!pluginApi?.getSeerrRequests || !userId) {
            return Promise.resolve({ Items: [] });
        }

        return pluginApi.getSeerrRequests({
            params: {
                limit: getRowCandidateLimit(row, options),
                userId
            }
        })
            .then(result => ({
                Items: getItems(result)
            }))
            .catch(() => ({ Items: [] }));
    }

    if (row.type === 'continue') {
        const cacheKey = getContinueRowCacheKey(currentApiClient, userId, row, options);
        const cachedItems = getCachedContinueItems(cacheKey);

        if (cachedItems) {
            recordPtvEvent('cache', 'hit', {
                row: row.id,
                source: 'continue-memory'
            });
            return Promise.resolve({ Items: cachedItems });
        }

        let request = continueRowInFlight.get(cacheKey);

        if (!request) {
            request = currentApiClient.getResumableItems(userId, {
                Limit: getRowCandidateLimit(row, options),
                Recursive: true,
                Fields: MEDIA_FIELDS,
                EnableImages: true,
                ImageTypeLimit: 1,
                EnableImageTypes: 'Primary,Backdrop,Thumb',
                EnableTotalRecordCount: false,
                MediaTypes: 'Video'
            })
                .then(result => {
                    setCachedContinueItems(cacheKey, getItems(result));

                    return result;
                })
                .catch(err => {
                    recordPtvEvent('row-fetch', 'continue-error', {
                        error: err instanceof Error ? err.message : String(err),
                        row: row.id
                    });

                    return { Items: [] };
                })
                .finally(() => {
                    continueRowInFlight.delete(cacheKey);
                });
            continueRowInFlight.set(cacheKey, request);
        } else {
            recordPtvEvent('cache', 'hit', {
                row: row.id,
                source: 'continue-in-flight'
            });
        }

        return withRowTimeout(request, CONTINUE_ROW_FETCH_TIMEOUT_MS, { Items: [] }, {
            row: row.id,
            rowType: row.type,
            timeoutMs: CONTINUE_ROW_FETCH_TIMEOUT_MS
        });
    }

    if (row.type === 'library') {
        const parentId = row.parentId || getLibraryParentId(row, userViews);

        if (!parentId) {
            return currentApiClient.getItems(userId, getRowQuery({
                ...row,
                type: 'search',
                searchTerm: row.title
            }, '', '', options));
        }

        return currentApiClient.getItems(userId, getRowQuery({
            ...row,
            parentId
        }, '', '', options));
    }

    const genreIds = row.genres?.length ? getGenreIds(row, genresByName) : '';
    const studioIds = getStudioIds(row, studiosByName);

    if (row.type === 'genre' && !genreIds) {
        return Promise.resolve({ Items: [] });
    }

    if (row.searchTerms?.length) {
        const searchRequests = getSearchTerms(row, options).map(searchTerm =>
            currentApiClient.getItems(userId, getRowQuery({
                ...row,
                searchTerm
            }, genreIds, '', options)).catch(() => ({ Items: [] }))
        );
        const studioRequests = studioIds ? [
            currentApiClient.getItems(userId, getRowQuery({
                ...row,
                searchTerm: undefined,
                searchTerms: undefined
            }, genreIds, studioIds, options))
                .catch(() => ({ Items: [] }))
        ] : [];

        return Promise.all([
            ...searchRequests,
            ...studioRequests
        ])
            .then(results => ({
                Items: getUniqueItems(getItemsFromResults(results))
                    .slice(0, getRowCandidateLimit(row, options))
            }));
    }

    return currentApiClient.getItems(userId, getRowQuery(row, genreIds, studioIds, options));
}

function fetchRowResult(currentApiClient, userId, row, genresByName, studiosByName, userViews, options = {}) {
    return timePtvAsync(
        'row-fetch',
        row.id || row.title || row.type || 'row',
        () => fetchRowResultCore(currentApiClient, userId, row, genresByName, studiosByName, userViews, options),
        {
            renderProfile: getHomePerformanceProfile(options).renderProfile?.id,
            rowType: row.type
        }
    );
}

function getPayloadRowItems(payload, row, options = {}) {
    const rowId = row.id;
    const items = payload?.sectionItems?.[rowId];

    if (!Array.isArray(items)) return null;
    if (!items.length) return row.type === 'featured' ? [] : null;
    const matchedItems = getUniqueItems(filterRowItems(row, items));

    if (!matchedItems.some(hasRenderableImage)) return null;
    if (!hasEnoughCachedQualityMetadata(matchedItems)) return null;

    return matchedItems.slice(0, getRowItemLimit(row, options));
}

function fetchSectionItems(currentApiClient, userId, row, lookupMaps, userViews, options = {}) {
    if (row.type === 'libraries') {
        return Promise.resolve([
            row.id,
            userViews.slice(0, getRowItemLimit(row, options))
        ]);
    }

    const rowForQuery = row.type === 'library' ? {
        ...row,
        parentId: row.parentId || getLibraryParentId(row, userViews)
    } : row;

    return fetchRowResult(
        currentApiClient,
        userId,
        rowForQuery,
        lookupMaps.genresByName,
        lookupMaps.studiosByName,
        userViews,
        options
    )
        .then(result => [
            row.id,
            getRowRenderItems(row, getItems(result), options)
        ]);
}

function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;

    function runNext() {
        const index = nextIndex;
        nextIndex++;

        if (index >= items.length) {
            return Promise.resolve();
        }

        return Promise.resolve(mapper(items[index], index))
            .then(result => {
                results[index] = result;
            })
            .then(runNext);
    }

    const workerCount = Math.max(1, Math.min(concurrency || items.length || 1, items.length || 1));
    const workers = Array.from({ length: workerCount }, () => runNext());

    return Promise.all(workers).then(() => results);
}

export function createFeaturedContentFetcher(apiClient, userId, rows, lookupMaps, userViews, options = {}) {
    const serverId = apiClient.serverId();
    const performanceProfile = getHomePerformanceProfile(options);
    const contentRows = rows
        .filter(row => row.type !== 'libraries' && row.type !== 'continue' && !row.userScoped)
        .slice(0, performanceProfile.featuredRowLimit || rows.length);

    return function () {
        const currentApiClient = ServerConnections.getApiClient(serverId) || apiClient;

        return timePtvAsync(
            'recommendation',
            'featured-content-batch',
            () => Promise.all([
                loadSharedHeroItems(currentApiClient, userId).catch(() => []),
                mapWithConcurrency(contentRows, performanceProfile.featuredFetchConcurrency, row =>
                    fetchSectionItems(currentApiClient, userId, row, lookupMaps, userViews, options)
                        .catch(() => [
                            row.id,
                            []
                        ])
                )
                    .then(entries => entries.reduce((sections, [sectionId, items]) => ({
                        ...sections,
                        [sectionId]: items
                    }), {}))
            ])
                .then(([heroItems, sectionItems]) => ({
                    heroItems,
                    sections: contentRows.map(row => ({
                        groupKey: row.groupKey || '',
                        groupKicker: row.groupKicker || '',
                        groupTitle: row.groupTitle || '',
                        id: row.id,
                        includeItemTypes: row.includeItemTypes || row.itemTypes || '',
                        itemCount: sectionItems[row.id]?.length || 0,
                        mediaType: row.mediaType || 'mixed',
                        presentation: row.presentation || '',
                        rowKicker: row.rowKicker || '',
                        shape: row.shape || '',
                        source: row.searchTerm || row.title,
                        sourceType: row.sourceType || row.type,
                        tier: row.tier || '',
                        title: row.title,
                        type: row.type
                    })),
                    sectionItems
                })),
            {
                renderProfile: performanceProfile.renderProfile?.id,
                rows: contentRows.length
            }
        );
    };
}

function createFetchData({
    apiClient,
    featuredContentSource,
    genresByName,
    options = {},
    row,
    studiosByName,
    userId,
    userViews
}) {
    const serverId = apiClient.serverId();

    return function () {
        const currentApiClient = ServerConnections.getApiClient(serverId) || apiClient;
        const fetchFallbackRow = () => fetchRowResult(
            currentApiClient,
            userId,
            row,
            genresByName,
            studiosByName,
            userViews,
            options
        )
            .then(result => toRowResultWithItems(
                result,
                getRowRenderItems(row, getItems(result), options)
            ));

        if (row.type === 'continue' || row.userScoped) {
            return fetchFallbackRow();
        }

        const sharedFeaturedContent = featuredContentSource?.get?.()
            || getFeaturedContent(createFeaturedContentFetcher(
                apiClient,
                userId,
                [row],
                {
                    genresByName,
                    studiosByName
                },
                userViews,
                options
            ));

        return sharedFeaturedContent
            .then(payload => {
                const cachedItems = getPayloadRowItems(payload, row, options);

                if (cachedItems) {
                    recordPtvEvent('cache', 'hit', {
                        row: row.id,
                        source: 'section-payload'
                    });
                    return { Items: cachedItems };
                }

                recordPtvEvent('cache', 'miss', {
                    row: row.id,
                    source: 'section-payload'
                });
                return fetchFallbackRow();
            })
            .catch(fetchFallbackRow);
    };
}

function clearRowCompositionClasses(elem) {
    Array.from(elem.classList)
        .filter(className => className.startsWith('ptv-row-tier-')
            || className.startsWith('ptv-row-presentation-'))
        .forEach(className => {
            elem.classList.remove(className);
        });

    elem.classList.remove('ptv-row-group-start', 'ptv-row-personalized');
}

function getRowTitleContentHtml(row) {
    const title = escapeHtml(row.title || 'Row');
    const rowKicker = getCleanString(row.rowKicker);

    if (!rowKicker) return title;

    return [
        '<span class="ptv-row-title-stack">',
        `<span class="ptv-row-title-text">${title}</span>`,
        `<span class="ptv-row-title-kicker">${escapeHtml(rowKicker)}</span>`,
        '</span>'
    ].join('');
}

function renderRowShell(elem, row, options) {
    let html = '';
    const tier = getDerivedRowTier(row);
    const presentation = getDerivedRowPresentation(row);

    clearRowCompositionClasses(elem);
    elem.classList.add('ptv-dynamic-row', `ptv-row-tier-${tier}`, `ptv-row-presentation-${presentation}`);
    elem.classList.toggle('ptv-row-group-start', row.showGroupHeader === true);
    elem.classList.toggle('ptv-row-personalized', row.isPersonalized === true);
    elem.dataset.ptvRowTier = String(tier);
    elem.dataset.ptvRowPresentation = presentation;
    elem.dataset.ptvRowGroup = row.groupKey || '';
    recordPtvEvent('render', 'row-shell', {
        group: row.groupKey || '',
        presentation,
        row: row.id || row.title || row.type,
        rowIndex: elem.dataset.ptvRowIndex || '',
        rowTier: tier,
        rowType: row.type
    });
    html += '<div class="ptv-row-backdrop" aria-hidden="true"></div>';

    if (row.showGroupHeader === true && row.groupTitle) {
        html += '<div class="ptv-row-group-heading padded-left">';

        if (row.groupKicker) {
            html += `<span class="ptv-row-group-kicker">${escapeHtml(row.groupKicker)}</span>`;
        }

        html += `<span class="ptv-row-group-title">${escapeHtml(row.groupTitle)}</span>`;
        html += '</div>';
    }

    if (row.moreUrl) {
        html += `<a is="emby-linkbutton" href="${escapeHtml(row.moreUrl)}" class="sectionTitle sectionTitle-cards padded-left ptv-row-title-link ptv-ignore-stock-bridge" aria-label="Open ${escapeHtml(row.title)}">`;
        html += getRowTitleContentHtml(row);
        html += '<span class="material-icons chevron_right ptv-row-title-link-icon" aria-hidden="true"></span>';
        html += '</a>';
    } else {
        html += '<h2 class="sectionTitle sectionTitle-cards padded-left">' + getRowTitleContentHtml(row) + '</h2>';
    }

    if (options.enableOverflow) {
        html += '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-mousewheel="false" data-centerfocus="true">';
        html += '<div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x">';
    } else {
        html += '<div is="emby-itemscontainer" class="itemsContainer focuscontainer-x padded-left padded-right vertical-wrap">';
    }

    if (options.enableOverflow) {
        html += '</div>';
    }

    html += '</div>';
    elem.innerHTML = html;
}

export function renderLibraryRow(elem, apiClient, userViews, options, row = PTV_HOME_ROWS[0]) {
    const rowOptions = {
        ...options,
        apiClient,
        serverId: apiClient.serverId()
    };
    const rowWithNavigation = {
        ...row,
        moreUrl: `#/home.html?serverId=${encodeURIComponent(rowOptions.serverId)}`
    };

    renderRowShell(elem, rowWithNavigation, rowOptions);

    const itemsContainer = elem.querySelector('.itemsContainer');
    if (!itemsContainer) return;

    itemsContainer.dataset.ptvRowId = rowWithNavigation.id || '';
    itemsContainer.dataset.ptvRowIndex = elem.dataset.ptvRowIndex || '';
    itemsContainer.dataset.ptvRowType = rowWithNavigation.type || '';

    let html = cardBuilder.getCardsHtml({
        items: ensureItemsHaveServerId(userViews, rowOptions),
        shape: getBackdropShape(rowOptions.enableOverflow),
        showTitle: true,
        centerText: true,
        overlayText: false,
        lazy: true,
        transition: false,
        allowBottomPadding: !rowOptions.enableOverflow,
        serverId: rowOptions.serverId
    });

    html += getMoreCardHtml({
        ...rowWithNavigation,
        title: 'Libraries'
    }, rowOptions);

    itemsContainer.innerHTML = html;
    imageLoader.lazyChildren(elem);
    forceLoadRowImages(itemsContainer, rowOptions);
    applyRowBackdrop(elem, apiClient, userViews, rowOptions);
}

export function renderMediaRow(elem, apiClient, userId, row, lookupMaps, userViews, options) {
    const rowOptions = {
        ...options,
        apiClient,
        serverId: apiClient.serverId()
    };
    const parentId = row.type === 'library' ? getLibraryParentId(row, userViews) : '';
    const rowWithNavigation = {
        ...row,
        parentId,
        moreUrl: getRowUrl({
            ...row,
            parentId
        }, lookupMaps.genresByName, rowOptions.serverId)
    };

    renderRowShell(elem, rowWithNavigation, rowOptions);
    elem.classList.add('hide');

    const itemsContainer = elem.querySelector('.itemsContainer');
    if (!itemsContainer) return;

    itemsContainer.dataset.ptvRowId = rowWithNavigation.id || '';
    itemsContainer.dataset.ptvRowIndex = elem.dataset.ptvRowIndex || '';
    itemsContainer.dataset.ptvRowType = rowWithNavigation.type || '';

    itemsContainer.fetchData = createFetchData({
        apiClient,
        featuredContentSource: rowOptions.featuredContentSource,
        genresByName: lookupMaps.genresByName,
        options: rowOptions,
        row: rowWithNavigation,
        studiosByName: lookupMaps.studiosByName,
        userId,
        userViews
    });
    itemsContainer.getItemsHtml = getRowItemsHtml(rowWithNavigation, rowOptions);
    itemsContainer.parentContainer = elem;
    itemsContainer.afterRefresh = function (result) {
        if (!getItems(result).length && rowWithNavigation.showWhenEmpty) {
            elem.classList.remove('hide');
            recordPtvEvent('render', 'row-empty-visible', {
                row: rowWithNavigation.id || rowWithNavigation.title,
                rowType: rowWithNavigation.type
            });
        }

        applyRowBackdrop(elem, apiClient, getItems(result), rowOptions);
        forceLoadRowImages(itemsContainer, rowOptions);
    };
}

export function loadGenreMap(apiClient, userId) {
    return apiClient.getGenres(userId, {
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        Limit: 300
    })
        .then(result => new Map((result.Items || [])
            .filter(genre => genre.Id && genre.Name)
            .map(genre => [genre.Name.toLowerCase(), genre.Id])))
        .catch(() => new Map());
}

export function loadStudioMap(apiClient, userId) {
    if (!apiClient.getStudios) {
        return Promise.resolve(new Map());
    }

    return apiClient.getStudios(userId, {
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        Limit: 500
    })
        .then(result => new Map((result.Items || [])
            .filter(studio => studio.Id && studio.Name)
            .map(studio => [studio.Name.toLowerCase(), studio.Id])))
        .catch(() => new Map());
}
