import { ServerConnections } from 'lib/jellyfin-apiclient';

import { recordPtvEvent } from '../core/observability';
import type {
    PtvApiAjaxOptions,
    PtvApiClientLike,
    PtvApiQuery,
    PtvApiQueryValue
} from './types';

const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;

export class PtvApiError extends Error {
    endpoint: string;
    statusCode: number | null;

    constructor(message: string, endpoint: string, statusCode: number | null = null) {
        super(message);
        this.name = 'PtvApiError';
        this.endpoint = endpoint;
        this.statusCode = statusCode;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object';
}

function getWindowApiClient(): PtvApiClientLike | null {
    return (window as unknown as { ApiClient?: PtvApiClientLike }).ApiClient || null;
}

export function getCurrentPtvApiClient(): PtvApiClientLike | null {
    return (ServerConnections.currentApiClient?.() as unknown as PtvApiClientLike | null) || getWindowApiClient();
}

export function getPtvApiClient(serverId?: string | null): PtvApiClientLike | null {
    if (serverId) {
        return (ServerConnections.getApiClient?.(serverId) as unknown as PtvApiClientLike | null)
            || getCurrentPtvApiClient();
    }

    return getCurrentPtvApiClient();
}

export function requirePtvApiClient(serverId?: string | null): PtvApiClientLike {
    const apiClient = getPtvApiClient(serverId);

    if (!apiClient) {
        throw new PtvApiError('Jellyfin API client is not available.', '', null);
    }

    return apiClient;
}

export function getPtvServerId(serverId?: string | null): string {
    if (serverId) return serverId;

    return getCurrentPtvApiClient()?.serverId?.() || '';
}

export function getPtvCurrentUserId(serverId?: string | null): string {
    return getPtvApiClient(serverId)?.getCurrentUserId?.() || '';
}

function hasQueryValue(value: PtvApiQueryValue): boolean {
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return value.length > 0;

    return true;
}

export function cleanPtvQuery(query?: PtvApiQuery | null): PtvApiQuery | undefined {
    if (!query) return undefined;

    const cleaned: PtvApiQuery = {};

    Object.keys(query).forEach(key => {
        const value = query[key];

        if (hasQueryValue(value)) {
            cleaned[key] = value;
        }
    });

    return Object.keys(cleaned).length ? cleaned : undefined;
}

export function getPtvApiUrl(
    pathOrUrl: string,
    params?: PtvApiQuery | null,
    serverId?: string | null
): string {
    if (ABSOLUTE_URL_PATTERN.test(pathOrUrl)) {
        return pathOrUrl;
    }

    const apiClient = requirePtvApiClient(serverId);
    const normalizedPath = pathOrUrl.replace(/^\/+/, '');

    if (typeof apiClient.getUrl === 'function') {
        return apiClient.getUrl(normalizedPath, cleanPtvQuery(params));
    }

    throw new PtvApiError('Jellyfin API client cannot build URLs.', normalizedPath, null);
}

function getErrorStatus(error: unknown): number | null {
    if (!isRecord(error)) return null;

    const statusCode = error.statusCode || error.status || error.statusText;

    return typeof statusCode === 'number' ? statusCode : null;
}

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error) return error;
    if (isRecord(error) && typeof error.message === 'string') return error.message;

    return fallback;
}

export function normalizePtvApiLayerError(error: unknown, endpoint: string): PtvApiError {
    if (error instanceof PtvApiError) return error;

    return new PtvApiError(
        getErrorMessage(error, 'Jellyfin API request failed.'),
        endpoint,
        getErrorStatus(error)
    );
}

export function requestPtvJson<T = unknown>(
    pathOrUrl: string,
    options: {
        includeAuthorization?: boolean;
        params?: PtvApiQuery | null;
        serverId?: string | null;
    } = {}
): Promise<T> {
    const apiClient = requirePtvApiClient(options.serverId);
    const url = getPtvApiUrl(pathOrUrl, options.params, options.serverId);

    recordPtvEvent('api', 'jellyfin-api-request', {
        method: 'GET',
        path: pathOrUrl
    });

    if (typeof apiClient.getJSON !== 'function') {
        return Promise.reject(new PtvApiError('Jellyfin API client cannot make JSON requests.', url, null));
    }

    return apiClient.getJSON<T>(url, options.includeAuthorization !== false)
        .catch(error => {
            throw normalizePtvApiLayerError(error, url);
        });
}

export function sendPtvJson<T = unknown>(
    pathOrUrl: string,
    body?: Record<string, unknown> | null,
    options: {
        includeAuthorization?: boolean;
        method?: string;
        params?: PtvApiQuery | null;
        serverId?: string | null;
    } = {}
): Promise<T> {
    const apiClient = requirePtvApiClient(options.serverId);
    const url = getPtvApiUrl(pathOrUrl, options.params, options.serverId);

    recordPtvEvent('api', 'jellyfin-api-request', {
        method: options.method || 'POST',
        path: pathOrUrl
    });

    if (typeof apiClient.ajax !== 'function') {
        return Promise.reject(new PtvApiError('Jellyfin API client cannot make AJAX requests.', url, null));
    }

    const ajaxOptions: PtvApiAjaxOptions = {
        contentType: 'application/json',
        data: body ? JSON.stringify(body) : null,
        type: options.method || 'POST',
        url
    };

    return apiClient.ajax<T>(ajaxOptions)
        .catch(error => {
            throw normalizePtvApiLayerError(error, url);
        });
}

export function installPtvApiNamespace(apiNamespace: Record<string, unknown>) {
    const root = window.PTV || (window.PTV = {});
    const existingApi = isRecord(root.api) ? root.api : {};

    root.api = {
        ...existingApi,
        ...apiNamespace
    };
}
