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
    response?: unknown;
    status?: unknown;
    statusCode?: unknown;
    xhr?: unknown;
};

type DebugWindow = Window & Partial<Record<'PTV_DEBUG', boolean>>;

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
    return Object.assign(new Error(`PTV plugin endpoint returned HTTP ${status}.`), {
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
