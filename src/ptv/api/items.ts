import {
    cleanPtvQuery,
    getPtvApiClient,
    getPtvCurrentUserId,
    requestPtvJson
} from './client';
import type {
    PtvItem,
    PtvItemQuery,
    PtvItemsResult
} from './types';

function emptyItemsResult<TItem = PtvItem>(): PtvItemsResult<TItem> {
    return {
        Items: [],
        TotalRecordCount: 0
    };
}

export function getPtvItem<TItem = PtvItem>(
    itemId: string,
    options: {
        serverId?: string | null;
        userId?: string | null;
    } = {}
): Promise<TItem> {
    const userId = options.userId || getPtvCurrentUserId(options.serverId);
    const apiClient = getPtvApiClient(options.serverId);

    if (userId && typeof apiClient?.getItem === 'function') {
        return apiClient.getItem<TItem>(userId, itemId);
    }

    return requestPtvJson<TItem>(userId ? `Users/${userId}/Items/${itemId}` : `Items/${itemId}`, {
        serverId: options.serverId
    });
}

export function getPtvItems<TItem = PtvItem>(
    query: PtvItemQuery = {},
    options: {
        serverId?: string | null;
        userId?: string | null;
    } = {}
): Promise<PtvItemsResult<TItem>> {
    const userId = options.userId || getPtvCurrentUserId(options.serverId);
    const apiClient = getPtvApiClient(options.serverId);
    const cleanedQuery = cleanPtvQuery(query);

    if (!userId) {
        return Promise.resolve(emptyItemsResult<TItem>());
    }

    if (typeof apiClient?.getItems === 'function') {
        return apiClient.getItems<TItem>(userId, cleanedQuery);
    }

    return requestPtvJson<PtvItemsResult<TItem>>(`Users/${userId}/Items`, {
        params: cleanedQuery,
        serverId: options.serverId
    });
}

export function getPtvResumeItems<TItem = PtvItem>(
    query: PtvItemQuery = {},
    options: {
        serverId?: string | null;
        userId?: string | null;
    } = {}
): Promise<PtvItemsResult<TItem>> {
    const userId = options.userId || getPtvCurrentUserId(options.serverId);
    const apiClient = getPtvApiClient(options.serverId);
    const cleanedQuery = cleanPtvQuery(query);

    if (!userId) {
        return Promise.resolve(emptyItemsResult<TItem>());
    }

    if (typeof apiClient?.getResumableItems === 'function') {
        return apiClient.getResumableItems<TItem>(userId, cleanedQuery);
    }

    return getPtvItems<TItem>({
        ...query,
        Filters: query.Filters || 'IsResumable',
        SortBy: query.SortBy || 'DatePlayed',
        SortOrder: query.SortOrder || 'Descending'
    }, options);
}

export function getPtvNextUp<TItem = PtvItem>(
    query: PtvItemQuery = {},
    options: {
        serverId?: string | null;
    } = {}
): Promise<PtvItemsResult<TItem>> {
    const apiClient = getPtvApiClient(options.serverId);
    const cleanedQuery = cleanPtvQuery(query);

    if (typeof apiClient?.getNextUpEpisodes === 'function') {
        return apiClient.getNextUpEpisodes<TItem>(cleanedQuery);
    }

    return requestPtvJson<PtvItemsResult<TItem>>('Shows/NextUp', {
        params: cleanedQuery,
        serverId: options.serverId
    });
}

export function getPtvRecentlyAdded<TItem = PtvItem>(
    query: PtvItemQuery = {},
    options: {
        serverId?: string | null;
        userId?: string | null;
    } = {}
): Promise<TItem[]> {
    const userId = options.userId || getPtvCurrentUserId(options.serverId);

    if (!userId) return Promise.resolve([]);

    return requestPtvJson<TItem[]>(`Users/${userId}/Items/Latest`, {
        params: cleanPtvQuery(query),
        serverId: options.serverId
    });
}

export function getPtvFavoriteItems<TItem = PtvItem>(
    query: PtvItemQuery = {},
    options: {
        serverId?: string | null;
        userId?: string | null;
    } = {}
): Promise<PtvItemsResult<TItem>> {
    return getPtvItems<TItem>({
        ...query,
        Filters: query.Filters || 'IsFavorite'
    }, options);
}
