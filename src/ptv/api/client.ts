import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { ServerConnections } from 'lib/jellyfin-apiclient';

import {
    createPtvCoreError,
    getPtvCoreErrorKindForHttpStatus,
    type PtvCoreError
} from '../core/errors/coreError';
import { createPtvAbortController } from '../core/abortController';
import { recordPtvEvent } from '../core/observability';
import Events from '../../utils/events';
import { redactPtvCoreText, redactPtvSensitiveValue } from '../core/diagnostics/redaction';
import {
    coordinatePtvJsonRequest,
    getPtvRequestCoordinatorKey
} from '../services/requestCoordinator';
import { getPtvDisplayIdentityKey } from '../services/displayIdentity';
import type {
    PtvApiAjaxOptions,
    PtvApiClientLike,
    PtvApiQuery,
    PtvApiQueryValue
} from './types';

const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;
const PTV_ABORTABLE_GET_TIMEOUT_MS = 30_000;
const PTV_ITEM_FIELDS_BY_NORMALIZED_NAME = new Map<string, string>(
    Object.values(ItemFields).map(field => [field.toLowerCase(), field])
);

export class PtvApiError extends Error {
    coreError: PtvCoreError;
    endpoint: string;
    statusCode: number | null;
    responseBody: string;

    constructor(message: string, endpoint: string, statusCode: number | null = null, responseBody = '') {
        const safeMessage = redactPtvCoreText(message, 1000);
        const safeEndpoint = redactPtvCoreText(endpoint, 1000);
        const safeResponseBody = redactPtvCoreText(responseBody, 4000);

        super(safeMessage);
        this.name = 'PtvApiError';
        this.endpoint = safeEndpoint;
        this.statusCode = statusCode;
        this.responseBody = safeResponseBody;
        this.coreError = createPtvCoreError({
            code: statusCode ? `API_HTTP_${statusCode}` : 'API_REQUEST_FAILED',
            developerDetail: safeResponseBody || undefined,
            httpStatus: statusCode || undefined,
            kind: statusCode ? getPtvCoreErrorKindForHttpStatus(statusCode) : 'unknown',
            message: safeMessage,
            operation: safeEndpoint,
            retryable: statusCode === null || statusCode === 408 || statusCode === 429 || statusCode >= 500
        });
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object';
}

function getWindowApiClient(): PtvApiClientLike | null {
    return (window as unknown as { ApiClient?: PtvApiClientLike }).ApiClient || null;
}

let incompleteRequestIdentitySequence = 0;
let freshRequestSequence = 0;

function getNextIncompleteRequestIdentity() {
    incompleteRequestIdentitySequence += 1;
    return `pending-${incompleteRequestIdentitySequence}`;
}

export function getCurrentPtvApiClient(): PtvApiClientLike | null {
    return (ServerConnections.currentApiClient?.() as unknown as PtvApiClientLike | null) || getWindowApiClient();
}

export function getPtvApiClient(serverId?: string | null): PtvApiClientLike | null {
    if (serverId) {
        const candidate = (ServerConnections.getApiClient?.(serverId) as unknown as PtvApiClientLike | null)
            || null;

        if (!candidate) return null;

        try {
            const candidateIds = [
                candidate.serverId?.(),
                candidate.serverInfo?.()?.Id
            ].filter((value): value is string => Boolean(value));

            if (!candidateIds.length || candidateIds.some(candidateId => candidateId !== serverId)) {
                return null;
            }
        } catch {
            return null;
        }

        return candidate;
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

export function normalizePtvItemFields(value: PtvApiQueryValue): string | undefined {
    const candidates = (Array.isArray(value) ? value : [value])
        .flatMap(entry => typeof entry === 'string' ? entry.split(',') : [])
        .map(field => field.trim())
        .filter(Boolean);
    const normalized = candidates
        .map(field => PTV_ITEM_FIELDS_BY_NORMALIZED_NAME.get(field.toLowerCase()))
        .filter((field): field is string => Boolean(field));

    return normalized.length ? [...new Set(normalized)].join(',') : undefined;
}

export function cleanPtvQuery(query?: PtvApiQuery | null): PtvApiQuery | undefined {
    if (!query) return undefined;

    const cleaned: PtvApiQuery = {};

    Object.keys(query).forEach(key => {
        const value = query[key];

        if (key === 'Fields') {
            const fields = normalizePtvItemFields(value);
            if (fields) {
                cleaned[key] = fields;
            }
            return;
        }

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

    const response = isRecord(error.response) ? error.response : null;
    const statusCode = error.statusCode || error.status || response?.status || error.statusText;

    return typeof statusCode === 'number' ? statusCode : null;
}

function getRecordErrorMessage(error: Record<string, unknown>): string {
    if (typeof error.message === 'string') return error.message;
    const response = isRecord(error.response) ? error.response : null;
    const status = typeof error.status === 'number' ? error.status : response?.status;
    const statusText = typeof error.statusText === 'string' ? error.statusText : response?.statusText;
    if (typeof status !== 'number') return '';
    const statusSuffix = statusText ? ` ${statusText}` : '';

    return `Jellyfin API request failed with HTTP ${status}${statusSuffix}.`;
}

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error) return error;
    if (isRecord(error)) {
        const recordMessage = getRecordErrorMessage(error);
        if (recordMessage) return recordMessage;
    }

    return fallback;
}

function redactDiagnosticText(value: string) {
    return redactPtvCoreText(value, 2000);
}

function getErrorResponseBody(error: unknown): string {
    if (!isRecord(error)) return '';

    const candidates = [
        error.responseText,
        error.responseBody,
        error.body,
        error.data,
        error.response
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return redactDiagnosticText(candidate).slice(0, 2000);
        }

        if (isRecord(candidate)) {
            try {
                return redactDiagnosticText(JSON.stringify(redactPtvSensitiveValue(candidate))).slice(0, 2000);
            } catch {
                return '[unserializable response body]';
            }
        }
    }

    return '';
}

async function getErrorResponseBodyAsync(error: unknown): Promise<string> {
    const syncBody = getErrorResponseBody(error);

    if (syncBody) return syncBody;
    if (!isRecord(error)) return '';

    const responseLike = typeof error.text === 'function' ? error : error.response;

    if (isRecord(responseLike) && typeof responseLike.text === 'function') {
        try {
            const clone = typeof responseLike.clone === 'function' ? responseLike.clone() : responseLike;
            const text = await (clone.text as () => Promise<string>)();

            return redactDiagnosticText(text).slice(0, 2000);
        } catch {
            return '';
        }
    }

    return '';
}

export function normalizePtvApiLayerError(error: unknown, endpoint: string): PtvApiError {
    if (error instanceof PtvApiError) return error;

    return new PtvApiError(
        redactDiagnosticText(getErrorMessage(error, 'Jellyfin API request failed.')),
        redactDiagnosticText(endpoint),
        getErrorStatus(error),
        getErrorResponseBody(error)
    );
}

async function normalizePtvApiLayerErrorAsync(error: unknown, endpoint: string): Promise<PtvApiError> {
    if (error instanceof PtvApiError) return error;

    return new PtvApiError(
        redactDiagnosticText(getErrorMessage(error, 'Jellyfin API request failed.')),
        redactDiagnosticText(endpoint),
        getErrorStatus(error),
        await getErrorResponseBodyAsync(error)
    );
}

function isPtvAbortError(error: unknown) {
    return Boolean(error)
        && typeof error === 'object'
        && (error as { name?: unknown }).name === 'AbortError';
}

function createPtvTransportTimeoutError(url: string) {
    return new PtvApiError(
        `Jellyfin API request timed out after ${PTV_ABORTABLE_GET_TIMEOUT_MS}ms.`,
        url,
        null
    );
}

function getPtvJsonWithSignal<T>(
    apiClient: PtvApiClientLike,
    url: string,
    includeAuthorization: boolean,
    signal: AbortSignal,
    fresh: boolean
): Promise<T> {
    if (
        typeof globalThis.fetch !== 'function'
        || (includeAuthorization && typeof apiClient.setRequestHeaders !== 'function')
    ) {
        const message = includeAuthorization ?
            'An owned authenticated request transport is unavailable.' :
            'An owned request transport is unavailable.';

        return Promise.reject(new PtvApiError(message, url, null));
    }

    const headers: Record<string, string> = {
        accept: 'application/json'
    };

    if (includeAuthorization) {
        apiClient.setRequestHeaders?.(headers);
    }

    const transportController = createPtvAbortController();
    let abortCause: 'route' | 'timeout' | null = null;
    const forwardAbort = () => {
        if (!abortCause) {
            abortCause = 'route';
        }

        transportController.abort();
    };

    if (signal.aborted) {
        forwardAbort();
    } else {
        signal.addEventListener('abort', forwardAbort, { once: true });
    }

    const timeoutId = globalThis.setTimeout(() => {
        if (abortCause) return;

        abortCause = 'timeout';
        transportController.abort();
    }, PTV_ABORTABLE_GET_TIMEOUT_MS);
    let failureReported = false;
    const reportFailure = (error: unknown) => {
        if (failureReported || isPtvAbortError(error)) return;

        failureReported = true;
        const response = error && typeof error === 'object' ? error as {
            headers?: { get?: (name: string) => string | null };
            status?: number;
        } : {};

        Events.trigger(apiClient, 'requestfail', [{
            errorCode: response.headers?.get?.('X-Application-Error-Code') || null,
            status: Number(response.status) || 0,
            url
        }]);
    };

    return globalThis.fetch(url, {
        ...(fresh ? { cache: 'no-store' as const } : {}),
        credentials: 'same-origin',
        headers,
        method: 'GET',
        signal: transportController.signal
    }).then(response => {
        apiClient.lastFetch = Date.now();

        if (!response.ok) {
            reportFailure(response);
            throw response;
        }

        return response.json() as Promise<T>;
    }).catch(error => {
        let transportError = error;

        if (isPtvAbortError(error)) {
            if (abortCause === 'timeout') {
                transportError = createPtvTransportTimeoutError(url);
            } else if (abortCause !== 'route') {
                transportError = new PtvApiError('Jellyfin request transport ended unexpectedly.', url, null);
            }
        }

        reportFailure(transportError);
        throw transportError;
    }).finally(() => {
        globalThis.clearTimeout(timeoutId);
        signal.removeEventListener('abort', forwardAbort);
    });
}

export function requestPtvJson<T = unknown>(
    pathOrUrl: string,
    options: {
        fresh?: boolean;
        includeAuthorization?: boolean;
        params?: PtvApiQuery | null;
        scope?: 'background' | 'route';
        serverId?: string | null;
        signal?: AbortSignal;
    } = {}
): Promise<T> {
    const apiClient = requirePtvApiClient(options.serverId);
    const url = getPtvApiUrl(pathOrUrl, options.params, options.serverId);

    if (options.scope === 'route' && !options.signal) {
        return Promise.reject(new PtvApiError(
            'A route-scoped PTV request requires an AbortSignal.',
            url,
            null
        ));
    }

    recordPtvEvent('api', 'jellyfin-api-request', {
        method: 'GET',
        path: pathOrUrl
    });

    const includeAuthorization = options.includeAuthorization !== false;
    const displayIdentity = includeAuthorization ? getPtvDisplayIdentityKey(
        options.serverId || apiClient.serverId?.(),
        apiClient.getCurrentUserId?.()
    ) : null;
    let authorizationIdentity = '';

    if (includeAuthorization) {
        authorizationIdentity = displayIdentity || getNextIncompleteRequestIdentity();
    }

    const requestKey = getPtvRequestCoordinatorKey(
        'GET',
        url,
        includeAuthorization,
        authorizationIdentity
    );
    // An explicit freshness check owns a separate transport rather than joining an older in-flight response.
    const coordinatedRequestKey = options.fresh ? `${requestKey} fresh:${++freshRequestSequence}` : requestKey;

    return coordinatePtvJsonRequest<T>(coordinatedRequestKey, signal => (
        getPtvJsonWithSignal<T>(apiClient, url, includeAuthorization, signal, options.fresh === true)
    ), {
        endpoint: pathOrUrl,
        includeAuthorization,
        method: 'GET',
        signal: options.signal,
        source: 'requestPtvJson'
    })
        .catch(async error => {
            if (isPtvAbortError(error)) throw error;

            throw await normalizePtvApiLayerErrorAsync(error, url);
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
        .catch(async error => {
            throw await normalizePtvApiLayerErrorAsync(error, url);
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
