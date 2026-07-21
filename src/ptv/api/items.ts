import {
    cleanPtvQuery,
    getPtvApiClient,
    getPtvCurrentUserId,
    requestPtvJson
} from './client';
import type {
    PtvApiQuery,
    PtvItem,
    PtvItemQuery,
    PtvItemsResult
} from './types';

export type PtvItemListResponseShape = 'array' | 'invalid' | 'wrapped-items';

export type PtvNormalizedItemListResponse<TItem> = Readonly<{
    items: TItem[];
    rawItemCount: number;
    responseKeys: string[];
    responseShape: PtvItemListResponseShape;
    totalRecordCount: number;
}>;

export type PtvRecentlyAddedRequest = Readonly<{
    endpoint: string;
    params: PtvApiQuery;
    userId: string;
}>;

export type PtvRecentlyAddedResult<TItem> = PtvNormalizedItemListResponse<TItem> & Readonly<{
    request: PtvRecentlyAddedRequest;
}>;

export type PtvItemsRequestDiagnostic = Readonly<{
    endpoint: string;
    params: PtvApiQuery;
    userId: string;
}>;

function emptyItemsResult<TItem = PtvItem>(): PtvItemsResult<TItem> {
    return {
        Items: [],
        TotalRecordCount: 0
    };
}

function getPtvResponseRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getPtvResponseTotalCount(value: unknown, fallback: number) {
    const record = getPtvResponseRecord(value);
    const totalRecordCount = Number(record?.TotalRecordCount);

    return Number.isFinite(totalRecordCount) ? totalRecordCount : fallback;
}

export function normalizeJellyfinItemListResponse<TItem = PtvItem>(response: unknown): PtvNormalizedItemListResponse<TItem> {
    if (Array.isArray(response)) {
        return {
            items: response as TItem[],
            rawItemCount: response.length,
            responseKeys: [],
            responseShape: 'array',
            totalRecordCount: response.length
        };
    }

    const record = getPtvResponseRecord(response);
    const items = record?.Items;

    if (Array.isArray(items)) {
        return {
            items: items as TItem[],
            rawItemCount: items.length,
            responseKeys: Object.keys(record || {}).sort().slice(0, 20),
            responseShape: 'wrapped-items',
            totalRecordCount: getPtvResponseTotalCount(record, items.length)
        };
    }

    return {
        items: [],
        rawItemCount: 0,
        responseKeys: record ? Object.keys(record).sort().slice(0, 20) : [],
        responseShape: 'invalid',
        totalRecordCount: 0
    };
}

export function buildPtvRecentlyAddedRequest(
    query: PtvItemQuery = {},
    options: {
        serverId?: string | null;
        userId?: string | null;
    } = {}
): PtvRecentlyAddedRequest {
    const userId = options.userId || getPtvCurrentUserId(options.serverId);

    return {
        endpoint: userId ? `Users/${userId}/Items/Latest` : 'Users/[missing-user]/Items/Latest',
        params: cleanPtvQuery(query) || {},
        userId
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
        onRequest?: (request: PtvItemsRequestDiagnostic) => void;
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

    const endpoint = `Users/${userId}/Items`;

    options.onRequest?.({
        endpoint,
        params: { ...(cleanedQuery || {}) },
        userId
    });

    if (typeof apiClient?.getItems === 'function') {
        return apiClient.getItems<TItem>(userId, cleanedQuery);
    }

    return requestPtvJson<PtvItemsResult<TItem>>(endpoint, {
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
    return getPtvRecentlyAddedResult<TItem>(query, options).then(result => result.items);
}

export function getPtvRecentlyAddedResult<TItem = PtvItem>(
    query: PtvItemQuery = {},
    options: {
        serverId?: string | null;
        userId?: string | null;
    } = {}
): Promise<PtvRecentlyAddedResult<TItem>> {
    const request = buildPtvRecentlyAddedRequest(query, options);

    if (!request.userId) {
        return Promise.resolve({
            ...normalizeJellyfinItemListResponse<TItem>(undefined),
            request
        });
    }

    return requestPtvJson<unknown>(request.endpoint, {
        params: request.params,
        serverId: options.serverId
    }).then(response => ({
        ...normalizeJellyfinItemListResponse<TItem>(response),
        request
    }));
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
