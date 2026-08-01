import {
    cleanPtvQuery,
    getPtvApiClient,
    getPtvCurrentUserId,
    requestPtvJson
} from './client';
import {
    executePtvItemDetailsApiBoundary,
    PTV_ITEM_DETAILS_ROUTE_IDENTIFIER,
    type PtvCoreItemDetails
} from '../core/api/itemDetailsBoundary';
import { type PtvCoreApiResponse } from '../core/api/apiContracts';
import { type PtvCoreResult } from '../core/errors/coreError';
import { recordPtvEvent } from '../core/observability';
import {
    coordinatePtvJsonRequest,
    getPtvRequestCoordinatorKey
} from '../services/requestCoordinator';
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

type PtvItemDetailsExecution<TItem> = Readonly<{
    legacyError?: unknown;
    result: PtvCoreResult<PtvCoreApiResponse<PtvCoreItemDetails<TItem>>>;
}>;

let itemDetailsRequestSequence = 0;

function createPtvItemDetailsRequestId() {
    itemDetailsRequestSequence += 1;

    return `ptv-item-details-${itemDetailsRequestSequence}`;
}

function recordPtvItemDetailsDiagnostic(detail: Record<string, unknown>) {
    try {
        recordPtvEvent('api', 'ptv-core-item-details-request', detail);
    } catch {
        // Existing API behavior must not depend on diagnostics.
    }
}

function executePtvItemDetailsRequest<TItem>(
    itemId: string,
    options: {
        serverId?: string | null;
        signal?: AbortSignal;
        userId?: string | null;
    }
): Promise<PtvItemDetailsExecution<TItem>> {
    const userId = options.userId || getPtvCurrentUserId(options.serverId);
    const apiClient = getPtvApiClient(options.serverId);
    const requestId = createPtvItemDetailsRequestId();
    const requestIdentity = [
        PTV_ITEM_DETAILS_ROUTE_IDENTIFIER,
        options.serverId || apiClient?.serverId?.() || '',
        userId,
        itemId
    ].join(':');
    const requestKey = getPtvRequestCoordinatorKey('GET', requestIdentity, true);

    return coordinatePtvJsonRequest<PtvItemDetailsExecution<TItem>>(requestKey, async signal => {
        let legacyError: unknown;
        const result = await executePtvItemDetailsApiBoundary<TItem>({
            diagnostic: recordPtvItemDetailsDiagnostic,
            requestId,
            serverId: options.serverId || apiClient?.serverId?.() || undefined,
            transport: async () => {
                try {
                    if (!options.signal && userId && typeof apiClient?.getItem === 'function') {
                        return await apiClient.getItem<TItem>(userId, itemId);
                    }

                    return await requestPtvJson<TItem>(
                        userId ? `Users/${userId}/Items/${itemId}` : `Items/${itemId}`,
                        {
                            serverId: options.serverId,
                            signal
                        }
                    );
                } catch (error) {
                    legacyError = error;
                    throw error;
                }
            },
            userId
        });

        return {
            legacyError,
            result
        };
    }, {
        diagnosticKey: 'GET auth jellyfin:item-details',
        endpoint: PTV_ITEM_DETAILS_ROUTE_IDENTIFIER,
        includeAuthorization: true,
        method: 'GET',
        signal: options.signal,
        source: 'getPtvItem'
    });
}

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
            responseKeys: Object.keys(record || {}).sort((left, right) => left.localeCompare(right)).slice(0, 20),
            responseShape: 'wrapped-items',
            totalRecordCount: getPtvResponseTotalCount(record, items.length)
        };
    }

    return {
        items: [],
        rawItemCount: 0,
        responseKeys: record ? Object.keys(record).sort((left, right) => left.localeCompare(right)).slice(0, 20) : [],
        responseShape: 'invalid',
        totalRecordCount: 0
    };
}

export function buildPtvRecentlyAddedRequest(
    query: PtvItemQuery = {},
    options: {
        serverId?: string | null;
        signal?: AbortSignal;
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
        signal?: AbortSignal;
        userId?: string | null;
    } = {}
): Promise<TItem> {
    return executePtvItemDetailsRequest<TItem>(itemId, options).then(execution => {
        if (execution.result.success) return execution.result.value.value.item;
        if (execution.legacyError !== undefined) throw execution.legacyError;

        const error = new Error(execution.result.error.message) as Error & {
            coreError: typeof execution.result.error;
        };
        error.name = 'PtvApiError';
        error.coreError = execution.result.error;
        throw error;
    });
}

export function getPtvItemCoreResult<TItem = PtvItem>(
    itemId: string,
    options: {
        serverId?: string | null;
        signal?: AbortSignal;
        userId?: string | null;
    } = {}
): Promise<PtvCoreResult<PtvCoreApiResponse<PtvCoreItemDetails<TItem>>>> {
    return executePtvItemDetailsRequest<TItem>(itemId, options).then(execution => execution.result);
}

export function getPtvItems<TItem = PtvItem>(
    query: PtvItemQuery = {},
    options: {
        onRequest?: (request: PtvItemsRequestDiagnostic) => void;
        serverId?: string | null;
        signal?: AbortSignal;
        userId?: string | null;
    } = {}
): Promise<PtvItemsResult<TItem>> {
    const userId = options.userId || getPtvCurrentUserId(options.serverId);
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

    return requestPtvJson<PtvItemsResult<TItem>>(endpoint, {
        params: cleanedQuery,
        serverId: options.serverId,
        ...(options.signal ? { signal: options.signal } : {})
    });
}

export function getPtvResumeItems<TItem = PtvItem>(
    query: PtvItemQuery = {},
    options: {
        serverId?: string | null;
        signal?: AbortSignal;
        userId?: string | null;
    } = {}
): Promise<PtvItemsResult<TItem>> {
    const userId = options.userId || getPtvCurrentUserId(options.serverId);
    const cleanedQuery = cleanPtvQuery(query);

    if (!userId) {
        return Promise.resolve(emptyItemsResult<TItem>());
    }

    return requestPtvJson<PtvItemsResult<TItem>>(`Users/${userId}/Items/Resume`, {
        params: cleanedQuery,
        serverId: options.serverId,
        ...(options.signal ? { signal: options.signal } : {})
    });
}

export function getPtvNextUp<TItem = PtvItem>(
    query: PtvItemQuery = {},
    options: {
        serverId?: string | null;
        signal?: AbortSignal;
    } = {}
): Promise<PtvItemsResult<TItem>> {
    const apiClient = getPtvApiClient(options.serverId);
    const cleanedQuery = cleanPtvQuery(query);

    if (!options.signal && typeof apiClient?.getNextUpEpisodes === 'function') {
        return apiClient.getNextUpEpisodes<TItem>(cleanedQuery);
    }

    return requestPtvJson<PtvItemsResult<TItem>>('Shows/NextUp', {
        params: cleanedQuery,
        serverId: options.serverId,
        ...(options.signal ? { signal: options.signal } : {})
    });
}

export function getPtvRecentlyAdded<TItem = PtvItem>(
    query: PtvItemQuery = {},
    options: {
        serverId?: string | null;
        signal?: AbortSignal;
        userId?: string | null;
    } = {}
): Promise<TItem[]> {
    return getPtvRecentlyAddedResult<TItem>(query, options).then(result => result.items);
}

export function getPtvRecentlyAddedResult<TItem = PtvItem>(
    query: PtvItemQuery = {},
    options: {
        serverId?: string | null;
        signal?: AbortSignal;
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
        serverId: options.serverId,
        ...(options.signal ? { signal: options.signal } : {})
    }).then(response => ({
        ...normalizeJellyfinItemListResponse<TItem>(response),
        request
    }));
}

export function getPtvFavoriteItems<TItem = PtvItem>(
    query: PtvItemQuery = {},
    options: {
        serverId?: string | null;
        signal?: AbortSignal;
        userId?: string | null;
    } = {}
): Promise<PtvItemsResult<TItem>> {
    return getPtvItems<TItem>({
        ...query,
        Filters: query.Filters || 'IsFavorite'
    }, options);
}
