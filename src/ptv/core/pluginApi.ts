import { ServerConnections } from 'lib/jellyfin-apiclient';

import { PTV_PLUGIN_API } from './config';

type PtvApiRequest = {
    contentType?: string;
    data?: string;
    headers?: Record<string, string>;
    method?: string;
    type?: string;
    url: string;
};

type PtvJellyfinApiClient = {
    ajax?: (request: PtvApiRequest) => Promise<unknown>;
    fetch?: (request: PtvApiRequest, includeAuthorization?: boolean) => Promise<unknown>;
    getJSON?: (url: string, includeAuthorization?: boolean) => Promise<unknown>;
    getUrl?: (name: string, params?: Record<string, unknown>) => string;
};

type JsonResponseLike = {
    json: () => Promise<unknown>;
};

type HttpErrorLike = Record<string, unknown> & {
    code?: unknown;
    data?: unknown;
    error?: unknown;
    message?: unknown;
    response?: unknown;
    responseJSON?: unknown;
    statusText?: unknown;
    status?: unknown;
    statusCode?: unknown;
    xhr?: unknown;
};

type DebugWindow = Window & Partial<Record<'PTV_DEBUG', boolean>>;

export type PtvNormalizedApiErrorKind =
    | 'forbidden'
    | 'missing'
    | 'network'
    | 'timeout'
    | 'unauthorized'
    | 'unknown'
    | 'version_mismatch';

export type PtvNormalizedApiError = {
    code?: string;
    kind: PtvNormalizedApiErrorKind;
    message: string;
    status?: number;
};

export type PtvPluginFeaturedContentDocument = {
    featuredContent?: unknown;
    featuredContentSettings?: unknown;
    updatedAt?: number;
    version?: number;
};

export type PtvPluginRequestOptions = {
    params?: Record<string, unknown>;
};

export type PtvPluginPayloadRequestOptions = PtvPluginRequestOptions & {
    body?: unknown;
};

let pluginUnavailableUntil = 0;

function debugLog(message: string, detail?: unknown) {
    if (typeof window !== 'undefined' && (window as DebugWindow)['PTV_DEBUG'] === true) {
        console.debug(`[PTV Plugin API] ${message}`, detail);
    }
}

function getCurrentApiClient(): PtvJellyfinApiClient | null {
    return ServerConnections.currentApiClient?.() || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isJsonResponseLike(value: unknown): value is JsonResponseLike {
    return isRecord(value) && typeof value.json === 'function';
}

function getHttpStatus(value: unknown): number | null {
    if (!isRecord(value)) return null;

    const carrier = value as HttpErrorLike;

    if (typeof carrier.status === 'number') return carrier.status;
    if (typeof carrier.statusCode === 'number') return carrier.statusCode;

    return getHttpStatus(carrier.response) || getHttpStatus(carrier.xhr);
}

function getStringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function getNestedString(value: unknown, key: 'code' | 'error' | 'message' | 'statusText'): string {
    if (!isRecord(value)) return '';

    const carrier = value as HttpErrorLike;
    const directValue = getStringValue(carrier[key]);

    if (directValue) return directValue;

    return (
        getNestedString(carrier.responseJSON, key)
        || getNestedString(carrier.response, key)
        || getNestedString(carrier.xhr, key)
        || getNestedString(carrier.data, key)
    );
}

function getErrorCode(value: unknown): string | undefined {
    return getNestedString(value, 'code') || undefined;
}

function getRawErrorMessage(value: unknown): string {
    if (value instanceof Error && value.message) return value.message;

    return (
        getNestedString(value, 'error')
        || getNestedString(value, 'message')
        || getNestedString(value, 'statusText')
    );
}

export function normalizePtvApiError(error: unknown): PtvNormalizedApiError {
    const status = getHttpStatus(error) || undefined;
    const code = getErrorCode(error);
    const rawMessage = getRawErrorMessage(error);
    const lowerMessage = rawMessage.toLowerCase();

    if (status === 401) {
        return {
            code,
            kind: 'unauthorized',
            message: 'HTTP 401: Unauthorized',
            status
        };
    }

    if (status === 403) {
        return {
            code,
            kind: 'forbidden',
            message: 'HTTP 403: Forbidden',
            status
        };
    }

    if (status === 404) {
        return {
            code,
            kind: 'missing',
            message: 'HTTP 404: Plugin endpoint not found',
            status
        };
    }

    if (lowerMessage.includes('timed out') || code === 'PTV_PLUGIN_TIMEOUT') {
        return {
            code,
            kind: 'timeout',
            message: 'Timeout: request timed out',
            status
        };
    }

    if (lowerMessage.includes('version') && lowerMessage.includes('mismatch')) {
        return {
            code,
            kind: 'version_mismatch',
            message: rawMessage || 'Version mismatch: expected v1 but received another version',
            status
        };
    }

    if (
        lowerMessage.includes('failed to fetch')
        || lowerMessage.includes('network')
        || lowerMessage.includes('unavailable')
        || lowerMessage.includes('cannot call plugin')
        || lowerMessage.includes('cannot build plugin')
    ) {
        return {
            code,
            kind: 'network',
            message: 'Network failure: endpoint unreachable',
            status
        };
    }

    return {
        code,
        kind: 'unknown',
        message: rawMessage || 'Unknown plugin API error',
        status
    };
}

function getPluginUrl(apiClient: PtvJellyfinApiClient, path: string, params?: Record<string, unknown>) {
    if (!apiClient.getUrl) {
        throw new Error('Jellyfin API client cannot build plugin URLs.');
    }

    return apiClient.getUrl(path, params);
}

function shouldSkipPluginApi() {
    return !PTV_PLUGIN_API.enabled || Date.now() < pluginUnavailableUntil;
}

function markPluginUnavailable(err: unknown) {
    pluginUnavailableUntil = Date.now() + PTV_PLUGIN_API.unavailableRetryMs;
    debugLog('temporarily disabled plugin endpoint probing', err);
}

function shouldKeepPluginAvailableAfterError(err: unknown) {
    const status = getHttpStatus(err);

    return status === 401 || status === 403;
}

function createPluginHttpError(status: number) {
    const normalizedError = normalizePtvApiError({ status });

    return Object.assign(new Error(normalizedError.message), {
        ...normalizedError,
        status
    });
}

function parsePluginResponse<T>(response: unknown): Promise<T> {
    if (response === undefined || response === null) {
        return Promise.resolve(undefined as T);
    }

    const status = getHttpStatus(response);

    if (status !== null && status >= 400) {
        return Promise.reject(createPluginHttpError(status));
    }

    if (isJsonResponseLike(response)) {
        return response.json().then(value => value as T);
    }

    return Promise.resolve(response as T);
}

function requestPluginJson<T>(
    apiClient: PtvJellyfinApiClient,
    path: string,
    options: PtvPluginPayloadRequestOptions & { method?: 'DELETE' | 'GET' | 'POST' | 'PUT' } = {}
) {
    if (shouldSkipPluginApi()) {
        return Promise.reject(new Error('PTV plugin API is unavailable.'));
    }

    const method = options.method || 'GET';
    const url = getPluginUrl(apiClient, path, options.params);

    const request = method === 'GET' ?
        apiClient.getJSON?.(url, true) :
        apiClient.ajax?.({
            contentType: 'application/json',
            data: options.body === undefined ? undefined : JSON.stringify(options.body),
            headers: {
                Accept: 'application/json'
            },
            method,
            type: method,
            url
        }) || apiClient.fetch?.({
            contentType: 'application/json',
            data: options.body === undefined ? undefined : JSON.stringify(options.body),
            headers: {
                Accept: 'application/json'
            },
            method,
            type: method,
            url
        }, true);

    if (!request) {
        return Promise.reject(new Error('Jellyfin API client cannot call plugin endpoints.'));
    }

    return request
        .then(response => parsePluginResponse<T>(response))
        .catch((err: unknown) => {
            if (shouldKeepPluginAvailableAfterError(err)) {
                debugLog('plugin endpoint denied by authorization; keeping read endpoints available', {
                    method,
                    path,
                    status: getHttpStatus(err)
                });
            } else {
                markPluginUnavailable(err);
            }

            throw err;
        });
}

export function resetPtvPluginApiAvailability() {
    pluginUnavailableUntil = 0;
}

export function isPtvPluginApiCoolingDown() {
    return Date.now() < pluginUnavailableUntil;
}

export function getCurrentPtvPluginApiClient(apiClient = getCurrentApiClient()) {
    if (!apiClient?.getUrl) return null;

    return {
        getBackdropPreprocessStatus<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.backdropPreprocess,
                options
            );
        },
        getFeaturedContentCacheDocument() {
            return requestPluginJson<PtvPluginFeaturedContentDocument>(
                apiClient,
                PTV_PLUGIN_API.endpoints.featuredContent
            );
        },
        getHeroBatch<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.heroBatches,
                options
            );
        },
        getImageProxyUrl(params?: Record<string, unknown>) {
            return getPluginUrl(apiClient, PTV_PLUGIN_API.endpoints.imageProxy, params);
        },
        getRecommendations<T = unknown>(options?: PtvPluginPayloadRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.recommendations,
                {
                    ...options,
                    method: options?.body === undefined ? 'GET' : 'POST'
                }
            );
        },
        getStatus<T = unknown>() {
            return requestPluginJson<T>(apiClient, PTV_PLUGIN_API.endpoints.status);
        },
        refreshFeaturedContentCacheDocument<T = unknown>() {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.featuredContentRefresh,
                {
                    method: 'POST'
                }
            );
        },
        writeFeaturedContentCacheDocument(document: PtvPluginFeaturedContentDocument) {
            return requestPluginJson<void>(
                apiClient,
                PTV_PLUGIN_API.endpoints.featuredContent,
                {
                    body: document,
                    method: 'PUT'
                }
            );
        },
        clearFeaturedContentCacheDocument() {
            return requestPluginJson<PtvPluginFeaturedContentDocument>(
                apiClient,
                PTV_PLUGIN_API.endpoints.featuredContent,
                {
                    method: 'DELETE'
                }
            );
        }
    };
}
