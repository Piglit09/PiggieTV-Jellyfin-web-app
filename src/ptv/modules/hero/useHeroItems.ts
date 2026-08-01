import { useEffect, useState } from 'react';

import { getPtvPerformanceProfile } from '../../core/clientProfile';
import { timePtvAsync } from '../../core/observability';
import {
    FEATURED_CACHE_UPDATED_EVENT,
    getFeaturedContent,
    type FeaturedPayload
} from '../cache/featuredContentCache';
import type { HeroApiClient, HeroItem } from './useHeroItem';

type SeasonalRecommendationContext = {
    label: string;
    searchTerms: string[];
};

const HERO_ITEM_LIMIT = 20;
const HERO_CONTINUE_LIMIT = 5;
const HERO_SHOW_LIMIT = 5;
const HERO_MOVIE_LIMIT = 10;
const HERO_BUCKET_QUERY_LIMIT = 48;
const HERO_RECOMMENDATION_POOL_LIMIT = 24;
const SEASONAL_LOOKUP_TIMEOUT_MS = 2200;
const RECOMMENDATION_LOOKUP_TIMEOUT_MS = 2500;

const HERO_FIELDS = 'Overview,Genres,PrimaryImageAspectRatio,ParentId,CommunityRating,CriticRating,PremiereDate,BackdropImageTags,ParentBackdropImageTags,ParentBackdropItemId,ImageTags,LogoImageTag,ParentLogoImageTag,ParentLogoItemId,SeriesPrimaryImageTag,ProductionYear,RunTimeTicks,OfficialRating';

const SEASONAL_RECOMMENDATIONS: Array<SeasonalRecommendationContext & {
    start: [number, number];
    end: [number, number];
}> = [
    {
        label: 'Halloween Picks',
        start: [10, 1],
        end: [10, 31],
        searchTerms: ['Halloween', 'haunted', 'ghost', 'witch', 'monster']
    },
    {
        label: 'Thanksgiving Picks',
        start: [11, 15],
        end: [11, 30],
        searchTerms: ['Thanksgiving', 'family', 'homecoming', 'feast']
    },
    {
        label: 'Holiday Picks',
        start: [12, 1],
        end: [12, 31],
        searchTerms: ['Christmas', 'holiday', 'snow', 'winter', 'Santa']
    },
    {
        label: 'New Year Picks',
        start: [1, 1],
        end: [1, 7],
        searchTerms: ['New Year', 'party', 'celebration']
    },
    {
        label: 'Valentine Picks',
        start: [2, 1],
        end: [2, 14],
        searchTerms: ['Valentine', 'romance', 'love', 'wedding']
    },
    {
        label: 'Spring Picks',
        start: [3, 1],
        end: [5, 31],
        searchTerms: ['spring', 'adventure', 'nature', 'garden']
    },
    {
        label: 'Summer Picks',
        start: [6, 1],
        end: [8, 31],
        searchTerms: ['summer', 'beach', 'vacation', 'camp']
    },
    {
        label: 'Fall Picks',
        start: [9, 1],
        end: [11, 14],
        searchTerms: ['fall', 'autumn', 'school', 'football']
    },
    {
        label: 'Winter Picks',
        start: [1, 8],
        end: [2, 29],
        searchTerms: ['winter', 'snow', 'mountain', 'ice']
    }
];

function getDateKey(month: number, day: number) {
    return (month * 100) + day;
}

function isDateInRange(dateKey: number, start: [number, number], end: [number, number]) {
    const startKey = getDateKey(start[0], start[1]);
    const endKey = getDateKey(end[0], end[1]);

    if (startKey <= endKey) {
        return dateKey >= startKey && dateKey <= endKey;
    }

    return dateKey >= startKey || dateKey <= endKey;
}

function getSeasonalRecommendationContext(date = new Date()): SeasonalRecommendationContext | null {
    const dateKey = getDateKey(date.getMonth() + 1, date.getDate());

    return SEASONAL_RECOMMENDATIONS.find(recommendation =>
        isDateInRange(dateKey, recommendation.start, recommendation.end)
    ) || null;
}

function getHeroRecommendationPoolLimit() {
    return getPtvPerformanceProfile().heroRecommendationPoolLimit || HERO_RECOMMENDATION_POOL_LIMIT;
}

function getDailyIndex(length: number) {
    if (length <= 1) return 0;

    return Math.floor(Date.now() / 86400000) % length;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T) {
    return new Promise<T>(resolve => {
        const timeout = window.setTimeout(() => resolve(fallback), timeoutMs);

        promise
            .then(resolve)
            .catch(() => resolve(fallback))
            .finally(() => window.clearTimeout(timeout));
    });
}

function hasHeroImages(item: HeroItem) {
    return Boolean(item.Id) && (
        Boolean(item.BackdropImageTags?.length)
        || Boolean(item.BackdropImageTag)
        || Boolean(item.BackdropItemId)
        || Boolean(item.ParentBackdropItemId && item.ParentBackdropImageTags?.length)
        || Boolean(item.ParentBackdropItemId && item.ParentBackdropImageTag)
        || Boolean(item.ImageTags?.Primary)
        || Boolean(item.PrimaryImageTag)
    );
}

function getItemTrendScore(item: HeroItem) {
    const criticRating = item.CriticRating || 0;
    const communityRating = item.CommunityRating ? item.CommunityRating * 10 : 0;
    const releaseYear = item.ProductionYear || (
        item.PremiereDate ? new Date(item.PremiereDate).getFullYear() : 0
    );
    const recencyBoost = releaseYear ?
        Math.max(0, Math.min(12, releaseYear - 2014)) :
        0;

    return (criticRating * 0.55) + (communityRating * 0.45) + recencyBoost;
}

function sortByTrending(items: HeroItem[]) {
    return [...items].sort((a, b) => getItemTrendScore(b) - getItemTrendScore(a));
}

function hydrateHeroItems(
    apiClient: HeroApiClient,
    userId: string,
    items: HeroItem[]
) {
    const itemsWithId = items.filter((item): item is HeroItem & { Id: string } => Boolean(item.Id));

    if (!apiClient.getItem) {
        return Promise.resolve(itemsWithId);
    }

    const getItem = apiClient.getItem.bind(apiClient);

    return Promise.all(itemsWithId.map(item =>
        getItem(userId, item.Id)
            .then(fullItem => ({
                ...item,
                ...fullItem,
                ImageTags: {
                    ...item.ImageTags,
                    ...fullItem.ImageTags
                }
            }))
            .catch(() => item)
    ));
}

function getResumableHeroItems(apiClient: HeroApiClient, userId: string) {
    if (!apiClient.getResumableItems) {
        return Promise.resolve({ Items: [] });
    }

    return apiClient.getResumableItems(userId, {
        Limit: HERO_ITEM_LIMIT,
        Recursive: true,
        Fields: HERO_FIELDS,
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop,Logo',
        EnableTotalRecordCount: false,
        IncludeItemTypes: 'Movie,Episode',
        MediaTypes: 'Video'
    });
}

function getSeasonalHeroLabel(seasonalContext: SeasonalRecommendationContext, mediaLabel: string) {
    const seasonalLabel = seasonalContext.label.endsWith(' Picks') ?
        seasonalContext.label.slice(0, -6) :
        seasonalContext.label;

    return `${seasonalLabel} ${mediaLabel}`;
}

function getRecommendedQuery(itemTypes: string, searchTerm?: string) {
    return {
        Limit: getPtvPerformanceProfile().heroBucketQueryLimit || HERO_BUCKET_QUERY_LIMIT,
        Recursive: true,
        Fields: HERO_FIELDS,
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop,Logo',
        EnableTotalRecordCount: false,
        IncludeItemTypes: itemTypes,
        SearchTerm: searchTerm,
        SortBy: 'CommunityRating,CriticRating,DateCreated',
        SortOrder: 'Descending'
    };
}

function getBaseRecommendedItems(
    apiClient: HeroApiClient,
    userId: string,
    itemTypes: string,
    label: string
) {
    if (!apiClient.getItems) {
        return Promise.resolve([]);
    }

    const getItems = apiClient.getItems.bind(apiClient);
    const recommendationPoolLimit = getHeroRecommendationPoolLimit();

    return getItems(userId, getRecommendedQuery(itemTypes))
        .then(result => getCinematicItems(
            apiClient,
            userId,
            sortByTrending(result.Items || []),
            'featured',
            label,
            recommendationPoolLimit,
            false
        ))
        .catch(() => []);
}

function getCinematicItems(
    apiClient: HeroApiClient,
    userId: string,
    items: HeroItem[],
    source: NonNullable<HeroItem['PtvHeroSource']>,
    recommendationLabel?: string,
    itemLimit = HERO_ITEM_LIMIT,
    hydrateItems = true
) {
    const candidateItems = items.filter(item => Boolean(item.Id)).slice(0, itemLimit);
    const itemPromise = hydrateItems ?
        hydrateHeroItems(apiClient, userId, candidateItems) :
        Promise.resolve(candidateItems);

    return itemPromise
        .then(hydratedItems => hydratedItems
            .filter(hasHeroImages)
            .map(item => ({
                ...item,
                PtvHeroSource: source,
                PtvHeroRecommendationLabel: recommendationLabel
            }))
            .slice(0, itemLimit));
}

function getUniqueHeroItems(items: HeroItem[]) {
    const usedIds = new Set<string>();

    return items.filter(item => {
        if (!item.Id || usedIds.has(item.Id)) return false;

        usedIds.add(item.Id);
        return true;
    });
}

function getResultItems(results: Array<{ Items?: HeroItem[] }>) {
    const items: HeroItem[] = [];

    results.forEach(result => {
        items.push(...(result.Items || []));
    });

    return items;
}

function toHeroItems(items: unknown[]) {
    return items.filter((item): item is HeroItem => Boolean(item) && typeof item === 'object');
}

function getSeasonalRecommendedItems(
    apiClient: HeroApiClient,
    userId: string,
    itemTypes: string,
    mediaLabel: string
) {
    if (!apiClient.getItems) {
        return Promise.resolve([]);
    }

    const getItems = apiClient.getItems.bind(apiClient);
    const seasonalContext = getSeasonalRecommendationContext();
    const performanceProfile = getPtvPerformanceProfile();
    const recommendationPoolLimit = getHeroRecommendationPoolLimit();

    if (!seasonalContext) {
        return Promise.resolve([]);
    }

    const searchTerms = seasonalContext.searchTerms.slice(
        0,
        performanceProfile.heroSeasonalSearchTermLimit || seasonalContext.searchTerms.length
    );

    const seasonalLookup = Promise.resolve()
        .then(() => Promise.all(searchTerms.map(searchTerm =>
            getItems(userId, {
                ...getRecommendedQuery(itemTypes, searchTerm)
            }).catch(() => ({ Items: [] }))
        )))
        .then(results => getUniqueHeroItems(getResultItems(results)))
        .then(items => {
            if (items.length) return Promise.resolve(items);

            const fallbackTerm = searchTerms[getDailyIndex(searchTerms.length)] || seasonalContext.searchTerms[0];

            return getItems(userId, {
                ...getRecommendedQuery(itemTypes, fallbackTerm)
            }).then(result => sortByTrending(result.Items || []));
        })
        .then(items => getCinematicItems(
            apiClient,
            userId,
            sortByTrending(items),
            'seasonal',
            getSeasonalHeroLabel(seasonalContext, mediaLabel),
            recommendationPoolLimit,
            false
        ))
        .then(items => items.slice(0, recommendationPoolLimit));

    return withTimeout(seasonalLookup, performanceProfile.seasonalLookupTimeoutMs || SEASONAL_LOOKUP_TIMEOUT_MS, []);
}

function getRecommendedHeroBucket(
    apiClient: HeroApiClient,
    userId: string,
    itemTypes: string,
    label: string,
    mediaLabel: string
) {
    const recommendationLookupTimeoutMs = getPtvPerformanceProfile().recommendationLookupTimeoutMs
        || RECOMMENDATION_LOOKUP_TIMEOUT_MS;

    return withTimeout(Promise.all([
        getSeasonalRecommendedItems(apiClient, userId, itemTypes, mediaLabel),
        getBaseRecommendedItems(apiClient, userId, itemTypes, label)
    ])
        .then(([seasonalItems, recommendedItems]) => getUniqueHeroItems([
            ...seasonalItems,
            ...recommendedItems
        ])), recommendationLookupTimeoutMs, []);
}

function pushUniqueHeroItems(
    target: HeroItem[],
    items: HeroItem[],
    limit: number,
    usedIds: Set<string>
) {
    for (const item of items) {
        if (target.length >= limit) break;
        if (!item.Id || usedIds.has(item.Id)) continue;

        usedIds.add(item.Id);
        target.push(item);
    }
}

function buildHeroPattern(
    continueItems: HeroItem[],
    showItems: HeroItem[],
    movieItems: HeroItem[]
) {
    const continueSlot: HeroItem[] = [];
    const showSlot: HeroItem[] = [];
    const movieSlot: HeroItem[] = [];
    const usedIds = new Set<string>();

    pushUniqueHeroItems(continueSlot, continueItems, HERO_CONTINUE_LIMIT, usedIds);
    pushUniqueHeroItems(showSlot, showItems, HERO_SHOW_LIMIT, usedIds);
    pushUniqueHeroItems(movieSlot, movieItems, HERO_MOVIE_LIMIT, usedIds);

    const heroItems = [
        ...continueSlot,
        ...showSlot,
        ...movieSlot
    ];

    if (heroItems.length < HERO_ITEM_LIMIT) {
        pushUniqueHeroItems(heroItems, [...showItems, ...movieItems, ...continueItems], HERO_ITEM_LIMIT, usedIds);
    }

    return heroItems;
}

export function loadContinueHeroItems(apiClient: HeroApiClient, userId: string) {
    return getResumableHeroItems(apiClient, userId)
        .then(result => getCinematicItems(
            apiClient,
            userId,
            result.Items || [],
            'continue',
            'Continue Watching',
            HERO_CONTINUE_LIMIT,
            false
        ));
}

export function loadSharedHeroItems(apiClient: HeroApiClient, userId: string) {
    return timePtvAsync('recommendation', 'shared-hero-items', () => Promise.all([
        getRecommendedHeroBucket(
            apiClient,
            userId,
            'Series',
            'Recommended Shows',
            'Shows'
        ).catch(() => []),
        getRecommendedHeroBucket(
            apiClient,
            userId,
            'Movie',
            'Recommended Movies',
            'Movies'
        ).catch(() => [])
    ])
        .then(([showItems, movieItems]) => buildHeroPattern(
            [],
            showItems,
            movieItems
        )));
}

export function loadHeroItems(apiClient: HeroApiClient, userId: string) {
    return timePtvAsync('recommendation', 'hero-items', () => Promise.all([
        loadContinueHeroItems(apiClient, userId).catch(() => []),
        getRecommendedHeroBucket(
            apiClient,
            userId,
            'Series',
            'Recommended Shows',
            'Shows'
        ).catch(() => []),
        getRecommendedHeroBucket(
            apiClient,
            userId,
            'Movie',
            'Recommended Movies',
            'Movies'
        ).catch(() => [])
    ])
        .then(([continueItems, showItems, movieItems]) => buildHeroPattern(
            continueItems,
            showItems,
            movieItems
        )));
}

function createHeroFeaturedPayload(apiClient: HeroApiClient, userId: string): Promise<FeaturedPayload> {
    return loadSharedHeroItems(apiClient, userId)
        .then(heroItems => ({
            heroItems,
            sectionItems: {}
        }));
}

function getSharedHeroItems(payload: FeaturedPayload) {
    return toHeroItems(payload.heroItems)
        .filter(item => item.PtvHeroSource !== 'continue');
}

function splitSharedHeroItems(items: HeroItem[]) {
    const showItems = items.filter(item => item.Type === 'Series');
    const movieItems = items.filter(item => item.Type === 'Movie');
    const fallbackItems = items.filter(item => item.Type !== 'Series' && item.Type !== 'Movie');

    return {
        movieItems: movieItems.length ? movieItems : fallbackItems,
        showItems: showItems.length ? showItems : fallbackItems
    };
}

function mergeUserHeroItems(
    apiClient: HeroApiClient,
    userId: string,
    payload: FeaturedPayload
) {
    const sharedItems = getSharedHeroItems(payload);
    const { movieItems, showItems } = splitSharedHeroItems(sharedItems);

    return loadContinueHeroItems(apiClient, userId)
        .catch(() => [])
        .then(continueItems => buildHeroPattern(continueItems, showItems, movieItems));
}

export function useHeroItems(
    apiClient?: HeroApiClient,
    user?: { Id?: string },
    featuredContentPromise?: Promise<FeaturedPayload>
) {
    const [items, setItems] = useState<HeroItem[]>([]);

    useEffect(() => {
        if (!apiClient || !user?.Id) {
            setItems([]);
            return;
        }

        const userId = user.Id;
        let disposed = false;

        const loadContent = (contentPromise: Promise<FeaturedPayload>) => contentPromise
            .then(payload => mergeUserHeroItems(apiClient, userId, payload))
            .then(heroItems => {
                if (!disposed) {
                    setItems(heroItems);
                }
            })
            .catch((err: unknown) => {
                console.warn('[PTV Hero] Failed loading hero items', err);
                if (!disposed) {
                    setItems([]);
                }
            });
        const getHeroFeaturedContent = () => getFeaturedContent(() => createHeroFeaturedPayload(apiClient, userId));
        const handleCacheUpdated = () => {
            void loadContent(getHeroFeaturedContent());
        };

        void loadContent(featuredContentPromise || getHeroFeaturedContent());
        window.addEventListener(FEATURED_CACHE_UPDATED_EVENT, handleCacheUpdated);

        return () => {
            disposed = true;
            window.removeEventListener(FEATURED_CACHE_UPDATED_EVENT, handleCacheUpdated);
        };
    }, [apiClient, featuredContentPromise, user?.Id]);

    return items;
}
