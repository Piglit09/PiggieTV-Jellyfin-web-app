import { ServerConnections } from 'lib/jellyfin-apiclient';

import { PTV_PLUGIN_API, PTV_RUNTIME } from './config';
import { classifyPtvRequestUrl, isPtvLocalDevHost, type PtvRequestOriginKind } from './urlOrigins';

type PtvApiRequest = {
    contentType?: string;
    data?: string;
    headers?: Record<string, string>;
    method?: string;
    signal?: AbortSignal;
    type?: string;
    url: string;
};

type PtvJellyfinApiClient = {
    ajax?: (request: PtvApiRequest) => Promise<unknown>;
    fetch?: (request: PtvApiRequest, includeAuthorization?: boolean) => Promise<unknown>;
    getJSON?: (url: string, includeAuthorization?: boolean) => Promise<unknown>;
    getUrl?: (name: string, params?: Record<string, unknown>) => string;
    serverAddress?: () => string;
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
    endpoint?: string;
    kind: PtvNormalizedApiErrorKind;
    message: string;
    status?: number;
    url?: string;
};

export type PtvPluginFeaturedContentDocument = {
    featuredContent?: unknown;
    featuredContentSettings?: unknown;
    updatedAt?: number;
    version?: number;
};

export type PtvPluginRequestOptions = {
    params?: Record<string, unknown>;
    signal?: AbortSignal;
};

export type PtvPluginPayloadRequestOptions = PtvPluginRequestOptions & {
    body?: unknown;
};

export type PtvPluginApiDiagnostics = {
    attemptedOrigins: Array<{
        origin: string;
        originKind: PtvRequestOriginKind;
        url: string;
    }>;
    attemptedUrl: string | null;
    attemptedUrls: string[];
    authoritativePluginApiRoot: string | null;
    candidates: string[];
    lastError: PtvNormalizedApiError | null;
    lastFailedEndpoint: string | null;
    lastFailedStatusCode: number | null;
    lastSuccessfulEndpoint: string | null;
    originDriftWarning: string | null;
    resolvedRoot: string | null;
    resolvedUrl: string | null;
    retryBackoffMs: number;
    retryCount: number;
    startupAttemptCount: number;
    statusAttemptCount: number;
    settingsAttemptCount: number;
    featuredAttemptCount: number;
};

let pluginUnavailableUntil = 0;
let resolvedPluginApiRoot: string | null = null;
let authoritativePluginApiRoot: string | null = null;
const inFlightPluginRequests = new Map<string, Promise<unknown>>();
let pluginApiDiagnostics: PtvPluginApiDiagnostics = {
    attemptedOrigins: [],
    attemptedUrl: null,
    attemptedUrls: [],
    authoritativePluginApiRoot: null,
    candidates: [],
    lastError: null,
    lastFailedEndpoint: null,
    lastFailedStatusCode: null,
    lastSuccessfulEndpoint: null,
    originDriftWarning: null,
    resolvedRoot: null,
    resolvedUrl: null,
    retryBackoffMs: 0,
    retryCount: 0,
    startupAttemptCount: 0,
    statusAttemptCount: 0,
    settingsAttemptCount: 0,
    featuredAttemptCount: 0
};

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

    if (status === 400) {
        return {
            code,
            kind: 'unknown',
            message: rawMessage && rawMessage !== 'Bad Request' ?
                `Bad request: ${rawMessage}` :
                'Bad request: plugin rejected the payload',
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

function withEndpointErrorDetail(error: unknown, endpoint: string, url: string): PtvNormalizedApiError {
    return {
        ...normalizePtvApiError(error),
        endpoint,
        url
    };
}

function normalizePluginPath(path: string) {
    return String(path || '').replace(/^\/+/, '');
}

function trimTrailingSlash(value: string) {
    let nextValue = value;

    while (nextValue.endsWith('/')) {
        nextValue = nextValue.slice(0, -1);
    }

    return nextValue;
}

function getLocationOrigin() {
    return `${window.location.protocol}//${window.location.host}`;
}

function getAnchorUrl(value: string) {
    const anchor = document.createElement('a');

    anchor.href = value;

    return anchor;
}

function getAnchorOrigin(anchor: HTMLAnchorElement) {
    const port = anchor.port ? `:${anchor.port}` : '';

    return `${anchor.protocol}//${anchor.hostname}${port}`;
}

function appendPluginPath(baseUrl: string, path: string, params?: Record<string, unknown>) {
    const query = Object.entries(params || {})
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');
    const querySuffix = query ? `?${query}` : '';

    return `${trimTrailingSlash(baseUrl)}/${normalizePluginPath(path)}${querySuffix}`;
}

function stripJellyfinWebPath(baseUrl: string) {
    const anchor = getAnchorUrl(baseUrl);
    const webPathIndex = anchor.pathname.toLowerCase().indexOf('/web');

    if (webPathIndex !== -1) {
        return trimTrailingSlash(`${getAnchorOrigin(anchor)}${anchor.pathname.slice(0, webPathIndex) || ''}`);
    }

    return trimTrailingSlash(anchor.href || baseUrl);
}

function getServerRootFromWindow() {
    const webPathIndex = window.location.pathname.toLowerCase().indexOf('/web');
    const basePath = webPathIndex === -1 ? '' : window.location.pathname.slice(0, webPathIndex);

    return trimTrailingSlash(`${getLocationOrigin()}${basePath}`);
}

function addCandidate(candidates: string[], url: string) {
    if (!url || candidates.includes(url)) return;

    candidates.push(url);
}

function getConfiguredJellyfinRoot() {
    return PTV_RUNTIME.jellyfinServerUrl ? stripJellyfinWebPath(PTV_RUNTIME.jellyfinServerUrl) : '';
}

function isLocalDevPluginCandidate(url: string) {
    const parsedUrl = getAnchorUrl(url);

    return isPtvLocalDevHost(parsedUrl.hostname);
}

function addPluginApiCandidate(candidates: string[], url: string) {
    if (!url) return;

    const configuredJellyfinRoot = getConfiguredJellyfinRoot();

    if (configuredJellyfinRoot && isLocalDevPluginCandidate(url)) {
        debugLog('skipping local dev plugin-api candidate', {
            configuredJellyfinRoot,
            url
        });
        return;
    }

    addCandidate(candidates, url);
}

function getPluginRootFromApiClient(apiClient: PtvJellyfinApiClient, path: string, params?: Record<string, unknown>) {
    const apiClientPathUrl = getJellyfinApiClientUrl(apiClient, path, params);

    if (apiClientPathUrl) {
        const apiClientRoot = getRootForResolvedPath(apiClientPathUrl, path);

        if (apiClientRoot) {
            return stripJellyfinWebPath(apiClientRoot);
        }
    }

    const serverAddress = apiClient.serverAddress?.();

    return serverAddress ? stripJellyfinWebPath(serverAddress) : '';
}

function setAuthoritativePluginApiRoot(root: string, source: string) {
    const normalizedRoot = stripJellyfinWebPath(root);

    if (!normalizedRoot) return '';

    if (authoritativePluginApiRoot && authoritativePluginApiRoot !== normalizedRoot) {
        const warning = `Plugin API root drift blocked: ${normalizedRoot} from ${source}; using ${authoritativePluginApiRoot}.`;

        console.warn(`[PTV Plugin API] ${warning}`);
        updatePluginApiDiagnostics({
            authoritativePluginApiRoot,
            originDriftWarning: warning,
            resolvedRoot: resolvedPluginApiRoot || authoritativePluginApiRoot
        });

        return authoritativePluginApiRoot;
    }

    authoritativePluginApiRoot = normalizedRoot;
    resolvedPluginApiRoot = normalizedRoot;
    updatePluginApiDiagnostics({
        authoritativePluginApiRoot,
        resolvedRoot: resolvedPluginApiRoot
    });

    return authoritativePluginApiRoot;
}

function getAuthoritativePluginApiRoot(
    apiClient: PtvJellyfinApiClient,
    path: string,
    params?: Record<string, unknown>
) {
    if (authoritativePluginApiRoot) {
        return authoritativePluginApiRoot;
    }

    const configuredJellyfinRoot = getConfiguredJellyfinRoot();

    if (configuredJellyfinRoot) {
        return setAuthoritativePluginApiRoot(configuredJellyfinRoot, 'configured-jellyfin-root');
    }

    if (resolvedPluginApiRoot) {
        return setAuthoritativePluginApiRoot(resolvedPluginApiRoot, 'resolved-root');
    }

    const apiClientRoot = getPluginRootFromApiClient(apiClient, path, params);

    if (apiClientRoot) {
        return setAuthoritativePluginApiRoot(apiClientRoot, 'jellyfin-api-client');
    }

    return setAuthoritativePluginApiRoot(getServerRootFromWindow(), 'window-server-root');
}

function getEndpointName(path: string) {
    const normalizedPath = normalizePluginPath(path).toLowerCase();

    if (normalizedPath.endsWith('/status')) return 'status';
    if (normalizedPath.endsWith('/settings/reset')) return 'settings';
    if (normalizedPath.endsWith('/settings')) return 'settings';
    if (normalizedPath.endsWith('/featured/refresh') || normalizedPath.endsWith('/featuredcontent/refresh')) return 'featuredContentRefresh';
    if (normalizedPath.endsWith('/featured') || normalizedPath.endsWith('/featuredcontent')) return 'featuredContent';

    return normalizedPath;
}

function getPluginRequestDedupeKey(method: string, path: string) {
    const endpoint = getEndpointName(path);

    if (method === 'GET' && endpoint === 'settings') {
        return `${method}:${endpoint}`;
    }

    if (method === 'POST' && normalizedIntegrationTestPath(path)) {
        return `${method}:${normalizePluginPath(path).toLowerCase()}`;
    }

    return null;
}

function normalizedIntegrationTestPath(path: string) {
    const normalizedPath = normalizePluginPath(path).toLowerCase();

    return normalizedPath.includes('/integrations/')
        && normalizedPath.endsWith('/test');
}

function shouldAffectPluginAvailability(path: string) {
    return getEndpointName(path) === 'status';
}

function getRootForResolvedPath(url: string, path: string) {
    const parsedUrl = getAnchorUrl(url);
    const normalizedPath = `/${normalizePluginPath(path)}`.toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();

    if (!pathname.endsWith(normalizedPath)) {
        return null;
    }

    const rootPath = parsedUrl.pathname.slice(0, parsedUrl.pathname.length - normalizedPath.length);

    return trimTrailingSlash(`${getAnchorOrigin(parsedUrl)}${rootPath}`);
}

function getJellyfinApiClientUrl(apiClient: PtvJellyfinApiClient, path: string, params?: Record<string, unknown>) {
    try {
        return apiClient.getUrl?.(path, params) || '';
    } catch {
        return '';
    }
}

function getPluginUrlCandidates(
    apiClient: PtvJellyfinApiClient,
    path: string,
    params?: Record<string, unknown>
) {
    const candidates: string[] = [];
    const root = getAuthoritativePluginApiRoot(apiClient, path, params);

    addPluginApiCandidate(candidates, appendPluginPath(root, path, params));

    return candidates;
}

function getPluginUrl(apiClient: PtvJellyfinApiClient, path: string, params?: Record<string, unknown>) {
    const [url] = getPluginUrlCandidates(apiClient, path, params);

    if (!url) {
        throw new Error('Jellyfin API client cannot build plugin URLs.');
    }

    return url;
}

function shouldRetryPluginCandidate(err: unknown) {
    const normalizedError = normalizePtvApiError(err);

    return normalizedError.kind === 'missing'
        || normalizedError.kind === 'network'
        || normalizedError.kind === 'timeout';
}

function updatePluginApiDiagnostics(nextDiagnostics: Partial<PtvPluginApiDiagnostics>) {
    pluginApiDiagnostics = {
        ...pluginApiDiagnostics,
        ...nextDiagnostics
    };
}

function notePluginApiAttempt(url: string, candidates: string[]) {
    const attemptedUrls = [...pluginApiDiagnostics.attemptedUrls, url].slice(-40);
    const originDetail = classifyPtvRequestUrl(url, {
        jellyfinRoot: authoritativePluginApiRoot || resolvedPluginApiRoot || getConfiguredJellyfinRoot(),
        pluginRoot: authoritativePluginApiRoot || resolvedPluginApiRoot || getConfiguredJellyfinRoot()
    });
    const originKind = originDetail.originKind;
    const attemptedOrigins = [
        ...pluginApiDiagnostics.attemptedOrigins,
        {
            origin: originDetail.origin,
            originKind,
            url
        }
    ].slice(-40);
    const pluginApiOrigins = Array.from(new Set(attemptedOrigins
        .filter(attempt => attempt.originKind === 'plugin-api')
        .map(attempt => attempt.origin)
        .filter(Boolean)));
    let originDriftWarning = pluginApiDiagnostics.originDriftWarning;

    if (pluginApiOrigins.length > 1) {
        originDriftWarning = `Multiple plugin API roots detected: ${pluginApiOrigins.join(', ')}. Using ${authoritativePluginApiRoot || resolvedPluginApiRoot || pluginApiOrigins[0]}.`;

        if (pluginApiDiagnostics.originDriftWarning !== originDriftWarning) {
            console.warn(`[PTV Plugin API] ${originDriftWarning}`);
        }
    }

    const allCandidates = [...pluginApiDiagnostics.candidates];

    candidates.forEach(candidate => {
        if (!allCandidates.includes(candidate)) {
            allCandidates.push(candidate);
        }
    });

    updatePluginApiDiagnostics({
        attemptedOrigins,
        attemptedUrl: url,
        attemptedUrls,
        authoritativePluginApiRoot,
        candidates: allCandidates.slice(-40),
        originDriftWarning
    });

    debugLog('trying plugin endpoint', { originKind, url });
}

function notePluginApiSuccess(url: string, path: string, candidates: string[]) {
    const resolvedRoot = getRootForResolvedPath(url, path);
    const endpoint = getEndpointName(path);

    if (resolvedRoot) {
        const pinnedRoot = setAuthoritativePluginApiRoot(resolvedRoot, 'successful-request');

        resolvedPluginApiRoot = pinnedRoot || resolvedRoot;
    }

    updatePluginApiDiagnostics({
        authoritativePluginApiRoot,
        attemptedUrl: url,
        candidates: [...candidates],
        lastError: null,
        lastFailedEndpoint: null,
        lastFailedStatusCode: null,
        lastSuccessfulEndpoint: endpoint,
        resolvedRoot: resolvedPluginApiRoot,
        resolvedUrl: url
    });

    debugLog('resolved plugin endpoint', pluginApiDiagnostics);
}

function notePluginApiFailure(err: unknown, path: string, url: string, candidates: string[]) {
    const normalizedError = withEndpointErrorDetail(err, getEndpointName(path), url);

    updatePluginApiDiagnostics({
        authoritativePluginApiRoot,
        candidates: [...candidates],
        lastError: normalizedError,
        lastFailedEndpoint: normalizedError.endpoint || null,
        lastFailedStatusCode: normalizedError.status || null
    });
}

function notePluginApiRequest(path: string) {
    const endpoint = getEndpointName(path);

    if (endpoint === 'status') {
        updatePluginApiDiagnostics({
            startupAttemptCount: pluginApiDiagnostics.startupAttemptCount + 1,
            statusAttemptCount: pluginApiDiagnostics.statusAttemptCount + 1
        });
        return;
    }

    if (endpoint === 'settings') {
        updatePluginApiDiagnostics({
            settingsAttemptCount: pluginApiDiagnostics.settingsAttemptCount + 1
        });
        return;
    }

    if (endpoint === 'featuredContent') {
        updatePluginApiDiagnostics({
            featuredAttemptCount: pluginApiDiagnostics.featuredAttemptCount + 1
        });
    }
}

export function recordPtvPluginApiRetryState(retryCount: number, retryBackoffMs: number) {
    updatePluginApiDiagnostics({
        retryBackoffMs,
        retryCount
    });
}

export function getPtvPluginApiDiagnostics(): PtvPluginApiDiagnostics {
    return {
        ...pluginApiDiagnostics,
        attemptedOrigins: [...pluginApiDiagnostics.attemptedOrigins],
        attemptedUrls: [...pluginApiDiagnostics.attemptedUrls],
        candidates: [...pluginApiDiagnostics.candidates],
        lastError: pluginApiDiagnostics.lastError ? { ...pluginApiDiagnostics.lastError } : null
    };
}

export function getPtvPluginApiResolvedUrl(
    path = PTV_PLUGIN_API.endpoints.status,
    params?: Record<string, unknown>,
    apiClient = getCurrentApiClient()
) {
    if (!apiClient) return null;

    return getPluginUrlCandidates(apiClient, path, params)[0] || null;
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

function createPluginHttpError(status: number, detail?: unknown) {
    const normalizedError = normalizePtvApiError({
        ...(isRecord(detail) ? detail : {}),
        responseJSON: detail,
        status
    });

    return Object.assign(new Error(normalizedError.message), {
        ...normalizedError,
        detail,
        status
    });
}

function parsePluginResponse<T>(response: unknown): Promise<T> {
    if (response === undefined || response === null) {
        return Promise.resolve(undefined as T);
    }

    const status = getHttpStatus(response);

    if (status !== null && status >= 400) {
        if (isJsonResponseLike(response)) {
            return response.json()
                .catch(() => null)
                .then(detail => Promise.reject(createPluginHttpError(status, detail)));
        }

        return Promise.reject(createPluginHttpError(status, response));
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
    const candidates = getPluginUrlCandidates(apiClient, path, options.params);

    if (options.signal?.aborted) {
        return Promise.reject(Object.assign(new Error('Plugin request aborted.'), {
            code: 'PTV_PLUGIN_REQUEST_ABORTED'
        }));
    }

    if (!candidates.length) {
        return Promise.reject(new Error('Jellyfin API client cannot build plugin URLs.'));
    }

    const dedupeKey = getPluginRequestDedupeKey(method, path);
    const inFlightRequest = dedupeKey ? inFlightPluginRequests.get(dedupeKey) : null;

    if (inFlightRequest) {
        debugLog('deduped plugin endpoint request', {
            dedupeKey,
            method,
            path
        });

        return inFlightRequest as Promise<T>;
    }

    notePluginApiRequest(path);

    const runAttempt = (candidateIndex: number): Promise<T> => {
        const url = candidates[candidateIndex];

        notePluginApiAttempt(url, candidates);

        const request = method === 'GET' ?
            apiClient.getJSON?.(url, true) :
            apiClient.ajax?.({
                contentType: 'application/json',
                data: options.body === undefined ? undefined : JSON.stringify(options.body),
                headers: {
                    Accept: 'application/json'
                },
                method,
                signal: options.signal,
                type: method,
                url
            }) || apiClient.fetch?.({
                contentType: 'application/json',
                data: options.body === undefined ? undefined : JSON.stringify(options.body),
                headers: {
                    Accept: 'application/json'
                },
                method,
                signal: options.signal,
                type: method,
                url
            }, true);

        if (!request) {
            return Promise.reject(new Error('Jellyfin API client cannot call plugin endpoints.'));
        }

        return request
            .then(response => parsePluginResponse<T>(response))
            .then(result => {
                notePluginApiSuccess(url, path, candidates);

                return result;
            })
            .catch((err: unknown) => {
                notePluginApiFailure(err, path, url, candidates);

                if (
                    candidateIndex < candidates.length - 1
                    && shouldRetryPluginCandidate(err)
                ) {
                    updatePluginApiDiagnostics({
                        retryCount: pluginApiDiagnostics.retryCount + 1
                    });
                    debugLog('plugin endpoint candidate failed, trying fallback', {
                        error: withEndpointErrorDetail(err, getEndpointName(path), url),
                        method,
                        url
                    });

                    return runAttempt(candidateIndex + 1);
                }

                if (shouldKeepPluginAvailableAfterError(err)) {
                    debugLog('plugin endpoint denied by authorization; keeping read endpoints available', {
                        method,
                        path,
                        status: getHttpStatus(err),
                        url
                    });
                } else if (shouldAffectPluginAvailability(path)) {
                    markPluginUnavailable(err);
                }

                throw err;
            });
    };

    const request = runAttempt(0)
        .finally(() => {
            if (dedupeKey) {
                inFlightPluginRequests.delete(dedupeKey);
            }
        });

    if (dedupeKey) {
        inFlightPluginRequests.set(dedupeKey, request);
    }

    return request;
}

function requestPluginJsonWithMissingFallback<T>(
    apiClient: PtvJellyfinApiClient,
    primaryPath: string,
    fallbackPath: string,
    options: PtvPluginPayloadRequestOptions & { method?: 'DELETE' | 'GET' | 'POST' | 'PUT' } = {}
) {
    return requestPluginJson<T>(apiClient, primaryPath, options)
        .catch((err: unknown) => {
            if (normalizePtvApiError(err).kind !== 'missing') {
                throw err;
            }

            debugLog('plugin endpoint missing, trying compatibility route', {
                fallbackPath,
                primaryPath
            });

            return requestPluginJson<T>(apiClient, fallbackPath, options);
        });
}

function isMissingPluginEndpointError(err: unknown) {
    return normalizePtvApiError(err).kind === 'missing';
}

function extractRowsFromSettings<T>(settings: unknown) {
    if (isRecord(settings) && 'rows' in settings) {
        return settings.rows as T;
    }

    return undefined as T;
}

function getRowsViaSettings<T>(
    apiClient: PtvJellyfinApiClient,
    options?: PtvPluginRequestOptions
) {
    debugLog('rows endpoint missing, falling back to settings.rows');

    return requestPluginJson<unknown>(
        apiClient,
        PTV_PLUGIN_API.endpoints.settings,
        options
    ).then(settings => extractRowsFromSettings<T>(settings));
}

function saveRowsViaSettings<TResponse, TSettings>(
    apiClient: PtvJellyfinApiClient,
    settings: TSettings,
    options?: PtvPluginRequestOptions
) {
    debugLog('rows save endpoint missing, falling back to settings.rows patch');

    return requestPluginJson<unknown>(
        apiClient,
        PTV_PLUGIN_API.endpoints.settings,
        {
            ...options,
            body: { rows: settings },
            method: 'POST'
        }
    ).then(response => {
        const rows = isRecord(response) && 'rows' in response ? response.rows : undefined;

        return (rows === undefined ? settings : rows) as TResponse;
    });
}

function getRulesFromRowsSettings(settings: unknown) {
    if (!isRecord(settings) || !Array.isArray(settings.rules)) return [];

    return settings.rules.filter(isRecord);
}

function createRowsPreviewCompatibilityResponse(settings: unknown) {
    const rows = getRulesFromRowsSettings(settings)
        .filter(rule => rule.enabled !== false)
        .map((rule, index) => {
            const name = getStringValue(rule.name) || getStringValue(rule.id) || `Row ${index + 1}`;
            const sourceType = getStringValue(rule.sourceType);
            const sourceValue = getStringValue(rule.sourceValue);

            return {
                generationMode: getStringValue(rule.generationMode),
                id: getStringValue(rule.id) || `compat-row-${index + 1}`,
                itemCount: 0,
                mediaType: getStringValue(rule.mediaType),
                ruleId: getStringValue(rule.id),
                ruleName: name,
                source: sourceValue || sourceType,
                sourceType,
                title: name,
                warnings: ['Preview endpoint is not available on this PiggieTV plugin version; save and refresh to generate real counts.'],
                weak: true
            };
        });

    return {
        diagnostics: [],
        ok: true,
        rows,
        settings,
        validation: {
            errors: [],
            ok: true,
            warnings: ['PiggieTV /rows/preview is unavailable; showing a compatibility preview from local row rules.']
        }
    };
}

function createRowsValidationCompatibilityResponse(settings: unknown) {
    const duplicateIds = new Set<string>();
    const seenIds = new Set<string>();
    const warnings: string[] = ['PiggieTV /rows/validate is unavailable; only basic local validation was run.'];
    const errors = getRulesFromRowsSettings(settings).reduce<string[]>((result, rule, index) => {
        const id = getStringValue(rule.id) || `row-${index + 1}`;
        const name = getStringValue(rule.name);

        if (!name.trim()) {
            result.push(`Rule ${index + 1} needs a row name.`);
        }

        if (seenIds.has(id)) {
            duplicateIds.add(id);
        }

        seenIds.add(id);

        return result;
    }, []);

    duplicateIds.forEach(id => {
        errors.push(`Duplicate row id: ${id}.`);
    });

    return {
        errors,
        ok: errors.length === 0,
        warnings
    };
}

export function resetPtvPluginApiAvailability() {
    pluginUnavailableUntil = 0;
    pluginApiDiagnostics = {
        attemptedOrigins: pluginApiDiagnostics.attemptedOrigins,
        attemptedUrl: null,
        attemptedUrls: pluginApiDiagnostics.attemptedUrls,
        authoritativePluginApiRoot,
        candidates: [],
        lastError: null,
        lastFailedEndpoint: null,
        lastFailedStatusCode: null,
        lastSuccessfulEndpoint: pluginApiDiagnostics.lastSuccessfulEndpoint,
        originDriftWarning: pluginApiDiagnostics.originDriftWarning,
        resolvedRoot: resolvedPluginApiRoot,
        resolvedUrl: null,
        retryBackoffMs: pluginApiDiagnostics.retryBackoffMs,
        retryCount: pluginApiDiagnostics.retryCount,
        startupAttemptCount: pluginApiDiagnostics.startupAttemptCount,
        statusAttemptCount: pluginApiDiagnostics.statusAttemptCount,
        settingsAttemptCount: pluginApiDiagnostics.settingsAttemptCount,
        featuredAttemptCount: pluginApiDiagnostics.featuredAttemptCount
    };
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
            return requestPluginJsonWithMissingFallback<PtvPluginFeaturedContentDocument>(
                apiClient,
                PTV_PLUGIN_API.endpoints.featuredContent,
                'Ptv/v1/FeaturedContent'
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
        getStatus<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, PTV_PLUGIN_API.endpoints.status, options);
        },
        getSettings<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, PTV_PLUGIN_API.endpoints.settings, options);
        },
        saveSettings<TResponse = unknown, TSettings = unknown>(settings: TSettings, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(
                apiClient,
                PTV_PLUGIN_API.endpoints.settings,
                {
                    ...options,
                    body: settings,
                    method: 'POST'
                }
            );
        },
        getRows<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, PTV_PLUGIN_API.endpoints.rows, options)
                .catch((err: unknown) => {
                    if (!isMissingPluginEndpointError(err)) {
                        throw err;
                    }

                    return getRowsViaSettings<T>(apiClient, options);
                });
        },
        saveRows<TResponse = unknown, TSettings = unknown>(settings: TSettings, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(
                apiClient,
                PTV_PLUGIN_API.endpoints.rows,
                {
                    ...options,
                    body: settings,
                    method: 'POST'
                }
            ).catch((err: unknown) => {
                if (!isMissingPluginEndpointError(err)) {
                    throw err;
                }

                return saveRowsViaSettings<TResponse, TSettings>(apiClient, settings, options);
            });
        },
        validateRows<TResponse = unknown, TSettings = unknown>(settings: TSettings, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(
                apiClient,
                PTV_PLUGIN_API.endpoints.rowsValidate,
                {
                    ...options,
                    body: settings,
                    method: 'POST'
                }
            ).catch((err: unknown) => {
                if (!isMissingPluginEndpointError(err)) {
                    throw err;
                }

                debugLog('rows validate endpoint missing, using compatibility validation');

                return createRowsValidationCompatibilityResponse(settings) as TResponse;
            });
        },
        previewRows<TResponse = unknown, TSettings = unknown>(settings: TSettings, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(
                apiClient,
                PTV_PLUGIN_API.endpoints.rowsPreview,
                {
                    ...options,
                    body: settings,
                    method: 'POST'
                }
            ).catch((err: unknown) => {
                if (!isMissingPluginEndpointError(err)) {
                    throw err;
                }

                debugLog('rows preview endpoint missing, using compatibility preview');

                return createRowsPreviewCompatibilityResponse(settings) as TResponse;
            });
        },
        resetSettings<T = unknown>() {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.settingsReset,
                {
                    method: 'POST'
                }
            );
        },
        getIntegrationsStatus<T = unknown>() {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.integrationsStatus
            );
        },
        testSeerr<T = unknown, TSettings = unknown>(settings?: TSettings, options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.seerrTest,
                {
                    ...options,
                    body: settings,
                    method: 'POST'
                }
            );
        },
        testJfaGo<T = unknown, TSettings = unknown>(settings?: TSettings, options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.jfaGoTest,
                {
                    ...options,
                    body: settings,
                    method: 'POST'
                }
            )
                .catch(error => {
                    const normalizedError = normalizePtvApiError(error);

                    if (normalizedError.kind !== 'missing') {
                        throw error;
                    }

                    return requestPluginJson<T>(
                        apiClient,
                        PTV_PLUGIN_API.endpoints.jfaGoTestAlias,
                        {
                            ...options,
                            body: settings,
                            method: 'POST'
                        }
                    );
                });
        },
        searchSeerr<T = unknown>(query: string) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.seerrSearch,
                {
                    params: { query }
                }
            );
        },
        requestSeerr<T = unknown>(body: unknown) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.seerrRequest,
                {
                    body,
                    method: 'POST'
                }
            );
        },
        getSeerrRequests<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.seerrRequests,
                options
            );
        },
        testArrService<T = unknown, TSettings = unknown>(
            serviceName: 'lidarr' | 'prowlarr' | 'radarr' | 'sonarr',
            settings?: TSettings,
            options?: PtvPluginRequestOptions
        ) {
            return requestPluginJson<T>(
                apiClient,
                `${PTV_PLUGIN_API.endpoints.integrationTestBase}/${serviceName}/test`,
                {
                    ...options,
                    body: settings,
                    method: 'POST'
                }
            );
        },
        getArrCalendar<T = unknown>() {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.arrCalendar
            );
        },
        getArrDownloads<T = unknown>() {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.arrDownloads
            );
        },
        getTags<T = unknown>() {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.tags
            );
        },
        getTagRows<T = unknown>() {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.tagRows
            );
        },
        saveTagRows<TResponse = unknown, TSettings = unknown>(settings: TSettings) {
            return requestPluginJson<TResponse>(
                apiClient,
                PTV_PLUGIN_API.endpoints.tagRows,
                {
                    body: settings,
                    method: 'POST'
                }
            );
        },
        getRandomMovie<T = unknown>() {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.randomMovie
            );
        },
        getRandomEpisode<T = unknown>() {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.randomEpisode
            );
        },
        getRandomAnime<T = unknown>() {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.randomAnime
            );
        },
        refreshFeaturedContentCacheDocument<T = unknown>() {
            return requestPluginJsonWithMissingFallback<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.featuredContentRefresh,
                'Ptv/v1/FeaturedContent/Refresh',
                {
                    method: 'POST'
                }
            );
        },
        writeFeaturedContentCacheDocument(document: PtvPluginFeaturedContentDocument) {
            return requestPluginJsonWithMissingFallback<void>(
                apiClient,
                PTV_PLUGIN_API.endpoints.featuredContent,
                'Ptv/v1/FeaturedContent',
                {
                    body: document,
                    method: 'PUT'
                }
            );
        },
        clearFeaturedContentCacheDocument() {
            return requestPluginJsonWithMissingFallback<PtvPluginFeaturedContentDocument>(
                apiClient,
                PTV_PLUGIN_API.endpoints.featuredContent,
                'Ptv/v1/FeaturedContent',
                {
                    method: 'DELETE'
                }
            );
        }
    };
}
