import { useEffect, useState } from 'react';

export type HeroItem = {
    Id?: string;
    Name?: string;
    Overview?: string;
    ProductionYear?: number;
    CommunityRating?: number;
    CriticRating?: number;
    OfficialRating?: string;
    PremiereDate?: string;
    RunTimeTicks?: number;
    Type?: string;
    SeriesId?: string;
    SeriesName?: string;
    Genres?: string[];
    BackdropImageTags?: string[];
    BackdropImageTag?: string;
    BackdropItemId?: string;
    ParentBackdropImageTags?: string[];
    ParentBackdropImageTag?: string;
    ParentBackdropItemId?: string;
    ParentLogoImageTag?: string;
    ParentLogoItemId?: string;
    PrimaryImageTag?: string;
    ImageTags?: {
        Logo?: string;
        Primary?: string;
    };
    PtvHeroSource?: 'featured' | 'continue' | 'seasonal';
    PtvHeroRecommendationLabel?: string;
};

export type HeroApiClient = {
    getResumableItems?: (
        userId: string,
        query: HeroItemsQuery
    ) => Promise<{ Items?: HeroItem[] }>;

    getItems?: (
        userId: string,
        query: HeroItemsQuery
    ) => Promise<{ Items?: HeroItem[] }>;

    getItem?: (userId: string, itemId: string) => Promise<HeroItem>;

    getUrl?: (name: string, params?: Record<string, string | number>) => string;

    getScaledImageUrl: (
        itemId: string,
        options: {
            type: string;
            maxWidth: number;
            tag?: string;
            index?: number;
        }
    ) => string;
};

type HeroItemsQuery = {
    Limit: number;
    Recursive?: boolean;
    Fields?: string;
    ImageTypeLimit?: number;
    EnableImageTypes?: string;
    EnableTotalRecordCount?: boolean;
    ImageTypes?: string;
    IncludeItemTypes?: string;
    MediaTypes?: string;
    SortBy?: string;
    SortOrder?: string;
    SearchTerm?: string;
    StartIndex?: number;
};

function getDailyIndex(length: number) {
    if (length <= 1) return 0;

    return Math.floor(Date.now() / 86400000) % length;
}

function getHeroItems(apiClient: HeroApiClient, userId: string) {
    const query = {
        Limit: 24,
        Recursive: true,
        Fields: 'Overview,Genres,PrimaryImageAspectRatio,CommunityRating,CriticRating,OfficialRating,RunTimeTicks',
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop,Logo',
        EnableTotalRecordCount: false,
        ImageTypes: 'Backdrop',
        IncludeItemTypes: 'Movie,Series',
        SortBy: 'Random'
    };

    if (apiClient.getItems) {
        return apiClient.getItems(userId, query);
    }

    if (apiClient.getResumableItems) {
        return apiClient.getResumableItems(userId, {
            Limit: 12,
            Recursive: true,
            Fields: 'Overview,Genres,PrimaryImageAspectRatio,CommunityRating,CriticRating,OfficialRating,RunTimeTicks',
            ImageTypeLimit: 1,
            EnableImageTypes: 'Primary,Backdrop,Logo',
            EnableTotalRecordCount: false,
            MediaTypes: 'Video'
        });
    }

    return Promise.resolve({ Items: [] });
}

function hasUsableBackdrop(item: HeroItem) {
    return Boolean(item.BackdropImageTags?.length)
        || Boolean(item.BackdropImageTag && (!item.BackdropItemId || item.BackdropItemId === item.Id))
        || Boolean(item.ParentBackdropItemId && item.ParentBackdropImageTags?.length)
        || Boolean(item.BackdropItemId);
}

function hydrateHeroItem(
    apiClient: HeroApiClient,
    userId: string,
    item: HeroItem
) {
    if (!item.Id || !apiClient.getItem) {
        return Promise.resolve(item);
    }

    return apiClient.getItem(userId, item.Id)
        .then(fullItem => ({
            ...item,
            ...fullItem,
            ImageTags: {
                ...item.ImageTags,
                ...fullItem.ImageTags
            }
        }))
        .catch(() => item);
}

export function useHeroItem(
    apiClient?: HeroApiClient,
    user?: { Id?: string }
) {
    const [item, setItem] = useState<HeroItem | null>(null);

    useEffect(() => {
        if (!apiClient || !user?.Id) {
            setItem(null);
            return;
        }

        const userId = user.Id;

        getHeroItems(apiClient, userId)
            .then((result) => {
                const items = result.Items || [];

                const cinematic = items.filter(
                    entry =>
                        hasUsableBackdrop(entry)
                        && Boolean(entry.ImageTags?.Primary || entry.PrimaryImageTag)
                );

                if (!cinematic.length) {
                    setItem(null);
                    return null;
                }

                const heroItem = cinematic[getDailyIndex(cinematic.length)];

                if (!heroItem) return null;

                return hydrateHeroItem(apiClient, userId, heroItem);
            })
            .then(heroItem => setItem(heroItem || null))
            .catch((err: unknown) => {
                console.warn('[PTV Hero] Failed loading hero item', err);
                setItem(null);
            });
    }, [apiClient, user?.Id]);

    return item;
}
