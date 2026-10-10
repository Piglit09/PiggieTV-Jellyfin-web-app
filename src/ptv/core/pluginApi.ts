import { observeHomeLibraryAuthority } from '../pages/home/homeLibraryTransitionFreshness';
import type { Api } from '@jellyfin/sdk';
import type { VirtualFolderInfo } from '@jellyfin/sdk/lib/generated-client/models/virtual-folder-info';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from '../../utils/events';
import { getPtvAuthenticatedDisplayIdentityKey } from '../services/displayIdentity';
import { observeConfiguredRowAuthority, readConfiguredPresentationAuthority, retireConfiguredRowFreshness } from '../pages/home/configuredRowFreshness';

import { PTV_PLUGIN_API, PTV_RUNTIME } from './config';
import { redactPtvSensitiveText, redactPtvSensitiveValue } from './diagnostics/redaction';
import { ptvSafeConsole } from './safeConsole';
import {
    type PtvCoreRecommendationResponse
} from './recommendations/recommendationContracts';
import { normalizePtvPluginRecommendationResponse } from './recommendations/pluginRecommendationBoundary';
import type {
    PtvRecommendationPolicyRequest,
    PtvRecommendationPolicyResponse
} from './recommendations/recommendationPolicyContracts';
import {
    classifyPtvRequestUrl,
    isPtvWebpackDevServerOrigin,
    resolvePtvServerUrlForPage,
    type PtvRequestOriginKind
} from './urlOrigins';

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
    accessToken?: () => string | null | undefined;
    ajax?: (request: PtvApiRequest) => Promise<unknown>;
    fetch?: (request: PtvApiRequest, includeAuthorization?: boolean) => Promise<unknown>;
    getCurrentUserId?: () => string | null | undefined;
    getJSON?: (url: string, includeAuthorization?: boolean) => Promise<unknown>;
    getSessions?: (options?: unknown) => Promise<unknown>;
    getUrl?: (name: string, params?: Record<string, unknown>) => string;
    serverAddress?: () => string;
    serverId?: () => string | null | undefined;
    serverInfo?: () => { Id?: string | null } | null | undefined;
};

export type HomeTransitionLibraryDefinition = {
    libraryId: string;
    name: string;
    collectionType: string;
    roots: string[];
    options: NonNullable<VirtualFolderInfo['LibraryOptions']>;
};
export type HomeTransitionIntent = {
    operationId: string;
    serverId: string;
    kind: 'create' | 'rename' | 'delete' | 'roots' | 'definition';
    expectedLibraryAbsent?: boolean;
    expectedLibrary?: HomeTransitionLibraryDefinition;
    intendedLibrary?: HomeTransitionLibraryDefinition;
};
export type HomeTransitionResponse = {
    operationId: string | null;
    epoch: string;
    held: boolean;
    state: 'pending' | 'failed' | 'complete' | 'idle' | 'recovery-required';
    affectedRuleIds: string[];
    writeAllowed: boolean;
    authority: 'unresolved' | 'binding-required' | 'generation-pending' | 'bound';
    library?: VirtualFolderInfo | null;
};
export type HomeTransitionCompleteRequest = {
    bindings?: Array<{ ruleId: string; libraryId: string }>;
};
export type HomeUserAccess = {
    userId: string;
    enableAllFolders: boolean;
    enabledFolders: string[];
    isAdministrator: boolean;
    isDisabled: boolean;
};
export type HomeUserAccessBeginRequest = {
    operationId: string;
    supersedesOperationId?: string;
    userId: string;
    mode: 'existing' | 'bootstrap' | 'preserve' | 'reproof';
    expectedAccess: HomeUserAccess | null;
    intendedAccess: HomeUserAccess;
};
export type HomeUserAccessResponse = {
    version: 1;
    userId: string;
    operationId: string | null;
    accessEpoch: string | null;
    held: boolean;
    policyProven: boolean;
    state: 'unproven' | 'pending' | 'failed' | 'policy-attested' | 'recovery-required';
    writeAllowed: boolean;
    /** Administrator current diagnostic only; core Begin/Complete omit these fields. */
    supersededOperationId?: string | null;
    currentAccess?: HomeUserAccess | null;
    expectedAccess?: HomeUserAccess | null;
    intendedAccess?: HomeUserAccess | null;
    controlledCreated?: boolean;
    migrationRecoveryRestricted?: boolean;
    lateUnverified?: boolean;
};
export type HomeUserVerificationBatch = {
    id: string;
    topologyEpoch: string;
    candidateUserIds: string[];
    verifiedCount: number;
    needsVerificationCount: number;
    stale: boolean;
};
export type HomeUserVerificationRequest = {
    intendedAccess: HomeUserAccess;
    confirmCurrentPolicy: true;
};
export type HomeUserVerificationSummary = {
    verifiedCount: number;
    needsVerificationCount: number;
    totalCount: number;
    currentBatchId: string | null;
    topologyEpoch: string | null;
    held: boolean;
    recoveryRequired: boolean;
    pendingCreationReservations: number;
    legacyCohortStarted: boolean;
    migrationRecoveryRestricted: boolean;
};
export type HomeUserCorruptRecoveryResponse = {
    recovered: boolean;
    requiresVerification: boolean;
};
export type HomeUserCreationReservation = {
    version: 1;
    creationOperationId: string;
    state: 'reserved';
    migrationVerificationHeld: true;
    userId: null;
    bootstrapRequired: false;
};
export type HomeUserCreationBinding = {
    version: 1;
    creationOperationId: string;
    state: 'bound';
    userId: string;
    bootstrapRequired: true;
    migrationVerificationHeld: false;
};
export type HomeUserCreationCurrent = {
    pendingCount: number;
    pending: Array<{ creationOperationId: string; candidateNewUserIds: string[] }>;
};
export type HomeUserCreationRecovery = {
    creationOperationId: string;
    state: 'recovered';
    markedUserIds: string[];
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
    | 'server'
    | 'timeout'
    | 'unauthorized'
    | 'unknown'
    | 'version_mismatch';

export type PtvNormalizedApiError = {
    code?: string;
    endpoint?: string;
    kind: PtvNormalizedApiErrorKind;
    message: string;
    responseBody?: string;
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
    bypassCache?: boolean;
    params?: Record<string, unknown>;
    signal?: AbortSignal;
};

export type PtvPluginPayloadRequestOptions = PtvPluginRequestOptions & {
    body?: unknown;
    requiresAuthentication?: boolean;
};

export type PtvPluginApiDiagnostics = {
    authenticationReadyRetryCount: number;
    authenticationWaitCount: number;
    attemptedOrigins: Array<{
        origin: string;
        originKind: PtvRequestOriginKind;
        url: string;
    }>;
    attemptedResponses: Array<{
        durationMs: number;
        endpoint: string;
        ok: boolean;
        responseBody: string | null;
        status: number | null;
        url: string;
    }>;
    attemptedUrl: string | null;
    attemptedUrls: string[];
    authoritativePluginApiRoot: string | null;
    candidates: string[];
    deduplicatedRequestCount: number;
    lastError: PtvNormalizedApiError | null;
    lastFailedEndpoint: string | null;
    lastFailedStatusCode: number | null;
    lastResponseBody: string | null;
    lastSuccessfulEndpoint: string | null;
    originDriftWarning: string | null;
    resolvedRoot: string | null;
    resolvedUrl: string | null;
    retryBackoffMs: number;
    retryCount: number;
    startupAttemptCount: number;
    startupReasonCounts: Record<string, number>;
    statusAttemptCount: number;
    settingsAttemptCount: number;
    featuredAttemptCount: number;
};

let pluginUnavailableUntil = 0;
let resolvedPluginApiRoot: string | null = null;
let authoritativePluginApiRoot: string | null = null;
const inFlightPluginRequests = new Map<string, Promise<unknown>>();
const PLUGIN_API_CLIENT_WAIT_TIMEOUT_MS = 10_000;
const PLUGIN_API_CLIENT_POLL_INTERVAL_MS = 50;
const pluginReadResponseCache = new Map<string, {
    expiresAt: number;
    value: unknown;
}>();
const MAX_PLUGIN_READ_RESPONSE_CACHE_ENTRIES = 64;
let pluginReadResponseCacheRevision = 0;
let pluginRequestIdentityGeneration = 0;
let pluginRequestIdentityLifecycleInitialized = false;
let pluginAuthenticationWait: Promise<PtvJellyfinApiClient> | null = null;
let pluginApiDiagnostics: PtvPluginApiDiagnostics = {
    authenticationReadyRetryCount: 0,
    authenticationWaitCount: 0,
    attemptedOrigins: [],
    attemptedResponses: [],
    attemptedUrl: null,
    attemptedUrls: [],
    authoritativePluginApiRoot: null,
    candidates: [],
    deduplicatedRequestCount: 0,
    lastError: null,
    lastFailedEndpoint: null,
    lastFailedStatusCode: null,
    lastResponseBody: null,
    lastSuccessfulEndpoint: null,
    originDriftWarning: null,
    resolvedRoot: null,
    resolvedUrl: null,
    retryBackoffMs: 0,
    retryCount: 0,
    startupAttemptCount: 0,
    startupReasonCounts: {},
    statusAttemptCount: 0,
    settingsAttemptCount: 0,
    featuredAttemptCount: 0
};

const PLUGIN_AUTHENTICATION_WAIT_TIMEOUT_MS = 15_000;

function incrementPluginDiagnosticCategory(category: string) {
    const normalizedCategory = category.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'unknown';
    const nextEntries = Object.entries(pluginApiDiagnostics.startupReasonCounts)
        .filter(([key]) => key !== normalizedCategory)
        .slice(-7);

    updatePluginApiDiagnostics({
        startupReasonCounts: {
            ...Object.fromEntries(nextEntries),
            [normalizedCategory]: (pluginApiDiagnostics.startupReasonCounts[normalizedCategory] || 0) + 1
        }
    });
}

function hasPluginAuthenticationIntrospection(apiClient: PtvJellyfinApiClient) {
    return typeof apiClient.getCurrentUserId === 'function' || typeof apiClient.accessToken === 'function';
}

function isPluginAuthenticationReady(apiClient: PtvJellyfinApiClient) {
    if (!hasPluginAuthenticationIntrospection(apiClient)) {
        // Direct-import and focused unit-test clients do not expose Jellyfin auth state.
        return true;
    }

    const hasUser = typeof apiClient.getCurrentUserId !== 'function' || Boolean(apiClient.getCurrentUserId());
    const hasToken = typeof apiClient.accessToken !== 'function' || Boolean(apiClient.accessToken());

    return hasUser && hasToken;
}

function createPluginAuthenticationError() {
    return Object.assign(new Error('PTV plugin request deferred until Jellyfin authentication is ready.'), {
        code: 'PTV_PLUGIN_AUTHENTICATION_NOT_READY',
        kind: 'unauthorized' as const,
        status: 401
    });
}

function createPluginRequestIdentityRetiredError() {
    const error = Object.assign(new Error('The authenticated Plugin request identity was retired.'), {
        code: 'PTV_PLUGIN_REQUEST_IDENTITY_RETIRED'
    });

    error.name = 'AbortError';
    return error;
}

function assertPluginRequestIdentityCurrent(
    authenticatedIdentity: string,
    identityGeneration: number,
    requestClient: PtvJellyfinApiClient
) {
    const activeClient = getCurrentApiClient();
    const identityClient = activeClient || requestClient;

    if (
        identityGeneration === pluginRequestIdentityGeneration
        && isPluginAuthenticationReady(identityClient)
        && authenticatedIdentity === getPluginAuthenticatedIdentity(identityClient)
    ) return;

    throw createPluginRequestIdentityRetiredError();
}

function resolvePluginResponseForIdentity<T>(
    value: T,
    authenticatedIdentity: string,
    identityGeneration: number,
    requestClient: PtvJellyfinApiClient
) {
    return Promise.resolve().then(() => {
        assertPluginRequestIdentityCurrent(authenticatedIdentity, identityGeneration, requestClient);
        return value;
    });
}

function withPluginRequestAbort<T>(promise: Promise<T>, signal?: AbortSignal) {
    if (!signal) return promise;
    if (signal.aborted) {
        return Promise.reject(Object.assign(new Error('Plugin request aborted.'), {
            code: 'PTV_PLUGIN_REQUEST_ABORTED'
        }));
    }

    return new Promise<T>((resolve, reject) => {
        const handleAbort = () => reject(Object.assign(new Error('Plugin request aborted.'), {
            code: 'PTV_PLUGIN_REQUEST_ABORTED'
        }));

        signal.addEventListener('abort', handleAbort, { once: true });
        promise.then(resolve, reject).finally(() => {
            signal.removeEventListener('abort', handleAbort);
        });
    });
}

function waitForPluginAuthentication(
    apiClient: PtvJellyfinApiClient,
    signal?: AbortSignal
): Promise<PtvJellyfinApiClient> {
    const currentClient = getCurrentApiClient() || apiClient;

    if (isPluginAuthenticationReady(currentClient)) {
        return Promise.resolve(currentClient);
    }

    updatePluginApiDiagnostics({
        authenticationWaitCount: pluginApiDiagnostics.authenticationWaitCount + 1
    });
    incrementPluginDiagnosticCategory('pre-authentication-wait');
    if (!pluginAuthenticationWait) {
        pluginAuthenticationWait = new Promise<PtvJellyfinApiClient>((resolve, reject) => {
            let timeoutId: ReturnType<typeof setTimeout> | null = null;

            const cleanup = () => {
                if (timeoutId !== null) clearTimeout(timeoutId);
                Events.off(ServerConnections, 'localusersignedin', handleAuthenticationChange);
                Events.off(ServerConnections, 'localusersignedout', handleAuthenticationChange);
            };
            const handleAuthenticationChange = () => {
                const authenticatedClient = getCurrentApiClient() || apiClient;

                if (!isPluginAuthenticationReady(authenticatedClient)) return;

                cleanup();
                clearPluginReadResponseCache();
                updatePluginApiDiagnostics({
                    authenticationReadyRetryCount: pluginApiDiagnostics.authenticationReadyRetryCount + 1
                });
                incrementPluginDiagnosticCategory('authenticated-retry');
                resolve(authenticatedClient);
            };

            Events.on(ServerConnections, 'localusersignedin', handleAuthenticationChange);
            Events.on(ServerConnections, 'localusersignedout', handleAuthenticationChange);
            timeoutId = setTimeout(() => {
                cleanup();
                incrementPluginDiagnosticCategory('authentication-wait-timeout');
                reject(createPluginAuthenticationError());
            }, PLUGIN_AUTHENTICATION_WAIT_TIMEOUT_MS);
            handleAuthenticationChange();
        }).finally(() => {
            pluginAuthenticationWait = null;
        });
    }

    return withPluginRequestAbort(pluginAuthenticationWait, signal);
}

function debugLog(message: string, detail?: unknown) {
    if (typeof window !== 'undefined' && (window as DebugWindow)['PTV_DEBUG'] === true) {
        ptvSafeConsole.debug(`[PTV Plugin API] ${message}`, detail);
    }
}

function getCurrentApiClient(): PtvJellyfinApiClient | null {
    const windowApiClient = typeof window === 'undefined' ? null :
        (window as Window & { ApiClient?: PtvJellyfinApiClient }).ApiClient;
    const connectionApiClient = ServerConnections.currentApiClient?.() || null;

    if (connectionApiClient && isPluginAuthenticationReady(connectionApiClient)) {
        return connectionApiClient;
    }

    if (windowApiClient && isPluginAuthenticationReady(windowApiClient)) {
        return windowApiClient;
    }

    return connectionApiClient || windowApiClient || null;
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

function getNestedStringByKey(value: unknown, key: string, depth = 0): string {
    if (!isRecord(value) || depth > 3) return '';

    const carrier = value as Record<string, unknown>;
    const directValue = getStringValue(carrier[key]);

    if (directValue) return directValue;

    return (
        getNestedStringByKey(carrier.responseJSON, key, depth + 1)
        || getNestedStringByKey(carrier.response, key, depth + 1)
        || getNestedStringByKey(carrier.xhr, key, depth + 1)
        || getNestedStringByKey(carrier.data, key, depth + 1)
    );
}

function redactDiagnosticText(value: string) {
    return redactPtvSensitiveText(value, 1200);
}

function getErrorResponseBody(value: unknown): string {
    const textBody = (
        getNestedStringByKey(value, 'responseText')
        || getNestedStringByKey(value, 'body')
        || getNestedStringByKey(value, 'text')
    );

    if (textBody) return redactDiagnosticText(textBody).slice(0, 1200);

    if (isRecord(value)) {
        const carrier = value as HttpErrorLike;
        const structuredBody = carrier.responseJSON || carrier.data || carrier.response;

        if (structuredBody && !isJsonResponseLike(structuredBody)) {
            try {
                return redactDiagnosticText(JSON.stringify(redactPtvSensitiveValue(structuredBody))).slice(0, 1200);
            } catch {
                return '';
            }
        }
    }

    return '';
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
    const rawMessage = redactDiagnosticText(getRawErrorMessage(error)).slice(0, 800);
    const lowerMessage = rawMessage.toLowerCase();
    const responseBody = getErrorResponseBody(error) || undefined;

    if (status === 401) {
        return {
            code,
            kind: 'unauthorized',
            message: 'HTTP 401: Unauthorized',
            responseBody,
            status
        };
    }

    if (status === 403) {
        return {
            code,
            kind: 'forbidden',
            message: 'HTTP 403: Forbidden',
            responseBody,
            status
        };
    }

    if (status === 404) {
        return {
            code,
            kind: 'missing',
            message: 'HTTP 404: Plugin endpoint not found',
            responseBody,
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
            responseBody,
            status
        };
    }

    if (status !== undefined && status >= 500) {
        return {
            code,
            kind: 'server',
            message: `Plugin server error: endpoint returned HTTP ${status}`,
            responseBody,
            status
        };
    }

    if (lowerMessage.includes('timed out') || code === 'PTV_PLUGIN_TIMEOUT') {
        return {
            code,
            kind: 'timeout',
            message: 'Timeout: request timed out',
            responseBody,
            status
        };
    }

    if (lowerMessage.includes('version') && lowerMessage.includes('mismatch')) {
        return {
            code,
            kind: 'version_mismatch',
            message: rawMessage || 'Version mismatch: expected v1 but received another version',
            responseBody,
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
            responseBody,
            status
        };
    }

    return {
        code,
        kind: 'unknown',
        message: rawMessage || 'Unknown plugin API error',
        responseBody,
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
    const configuredRoot = PTV_RUNTIME.mode === 'development' ?
        PTV_RUNTIME.devJellyfinServerUrl || PTV_RUNTIME.jellyfinServerUrl :
        PTV_RUNTIME.jellyfinServerUrl;

    return configuredRoot ? stripJellyfinWebPath(configuredRoot) : '';
}

function getConfiguredJellyfinRoots() {
    const configuredRoots: string[] = [];

    (PTV_RUNTIME.jellyfinServerUrlCandidates || [PTV_RUNTIME.jellyfinServerUrl]).forEach(candidate => {
        const root = candidate ? stripJellyfinWebPath(candidate) : '';

        addCandidate(configuredRoots, root);
    });

    return configuredRoots;
}

function isLocalDevPluginCandidate(url: string) {
    const parsedUrl = getAnchorUrl(url);

    return isPtvWebpackDevServerOrigin(parsedUrl.hostname, parsedUrl.port);
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
            return getPageSafeJellyfinRoot(apiClientRoot);
        }
    }

    const serverAddress = apiClient.serverAddress?.();

    return serverAddress ? getPageSafeJellyfinRoot(serverAddress) : '';
}

function getPageSafeJellyfinRoot(value: string) {
    return stripJellyfinWebPath(resolvePtvServerUrlForPage(value, {
        development: PTV_RUNTIME.mode === 'development',
        pageUrl: window.location.href
    }));
}

function getPluginRootCandidates(
    apiClient: PtvJellyfinApiClient,
    path: string,
    params?: Record<string, unknown>,
    options: { requireApiClientRoot?: boolean } = {}
) {
    const rootCandidates: string[] = [];
    const apiClientRoot = getPluginRootFromApiClient(apiClient, path, params);

    if (options.requireApiClientRoot) {
        addCandidate(rootCandidates, apiClientRoot);
        return rootCandidates;
    }

    const activeRoot = PTV_RUNTIME.mode === 'development' && PTV_RUNTIME.devJellyfinServerUrl ?
        getPageSafeJellyfinRoot(PTV_RUNTIME.devJellyfinServerUrl) :
        apiClientRoot;

    if (
        activeRoot
        && authoritativePluginApiRoot
        && activeRoot !== authoritativePluginApiRoot
    ) {
        authoritativePluginApiRoot = null;
        resolvedPluginApiRoot = null;
        updatePluginApiDiagnostics({
            authoritativePluginApiRoot: null,
            originDriftWarning: 'Plugin API root retired after the active Jellyfin server changed.',
            resolvedRoot: null
        });
    }

    addCandidate(rootCandidates, activeRoot);
    addCandidate(rootCandidates, authoritativePluginApiRoot || '');
    addCandidate(rootCandidates, resolvedPluginApiRoot || '');
    addCandidate(rootCandidates, apiClientRoot);
    getConfiguredJellyfinRoots().forEach(root => {
        addCandidate(rootCandidates, root);
    });

    if (!isPtvWebpackDevServerOrigin()) {
        addCandidate(rootCandidates, getServerRootFromWindow());
    }

    return rootCandidates;
}

function setAuthoritativePluginApiRoot(root: string, source: string) {
    const normalizedRoot = stripJellyfinWebPath(root);

    if (!normalizedRoot) return '';

    const rootChanged = Boolean(authoritativePluginApiRoot && authoritativePluginApiRoot !== normalizedRoot);

    authoritativePluginApiRoot = normalizedRoot;
    resolvedPluginApiRoot = normalizedRoot;
    updatePluginApiDiagnostics({
        authoritativePluginApiRoot: getPrivacySafePluginDiagnosticOrigin(authoritativePluginApiRoot),
        originDriftWarning: rootChanged ?
            `Plugin API root updated after ${source}.` :
            pluginApiDiagnostics.originDriftWarning,
        resolvedRoot: getPrivacySafePluginDiagnosticOrigin(resolvedPluginApiRoot)
    });

    return authoritativePluginApiRoot;
}

function getEndpointName(path: string) {
    const normalizedPath = normalizePluginPath(path).toLowerCase();

    if (
        normalizedPath === normalizePluginPath(PTV_PLUGIN_API.endpoints.status).toLowerCase()
        || normalizedPath === 'ptv/status'
    ) return 'status';
    if (normalizedPath.endsWith('/settings/reset')) return 'settings';
    if (normalizedPath.endsWith('/settings')) return 'settings';
    if (normalizedPath.endsWith('/featured/refresh') || normalizedPath.endsWith('/featuredcontent/refresh')) return 'featuredContentRefresh';
    if (normalizedPath.endsWith('/featured') || normalizedPath.endsWith('/featuredcontent')) return 'featuredContent';

    const configuredEndpoint = Object.entries(PTV_PLUGIN_API.endpoints)
        .sort((left, right) => right[1].length - left[1].length)
        .find(([, endpointPath]) => {
            const normalizedEndpoint = normalizePluginPath(endpointPath).toLowerCase();

            return normalizedPath === normalizedEndpoint || normalizedPath.startsWith(`${normalizedEndpoint}/`);
        });

    if (configuredEndpoint) return configuredEndpoint[0];

    return normalizedPath;
}

function getStableCachePart(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(item => getStableCachePart(item)).join(',')}]`;
    }

    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort((leftKey, rightKey) => leftKey.localeCompare(rightKey))
            .map(key => `${key}:${getStableCachePart(value[key])}`)
            .join(',')}}`;
    }

    return JSON.stringify(value) || 'undefined';
}

function getPluginRequestServerIdentity(
    apiClient: PtvJellyfinApiClient,
    path: string,
    params: Record<string, unknown> | undefined,
    primaryCandidate: string | undefined
) {
    let serverId = '';

    try {
        serverId = apiClient.serverId?.()?.trim() || '';
    } catch {
        // Some transitional clients cannot resolve their server id yet. The
        // concrete request root below still keeps their cache entries isolated.
    }

    const candidateRoot = primaryCandidate ? getRootForResolvedPath(primaryCandidate, path) : null;
    const root = candidateRoot || getPluginRootFromApiClient(apiClient, path, params);

    return getStableCachePart({
        root: trimTrailingSlash(root),
        serverId
    });
}

function getPluginAuthenticatedIdentity(apiClient: PtvJellyfinApiClient) {
    return getPtvAuthenticatedDisplayIdentityKey(apiClient);
}

function getPluginRequestCacheKey(
    serverIdentity: string,
    authorizationIdentity: string,
    method: string,
    path: string,
    params?: Record<string, unknown>
) {
    return `${serverIdentity}:auth:${authorizationIdentity}:${method}:${normalizePluginPath(path).toLowerCase()}:${getStableCachePart(params || {})}`;
}

function getPluginCompatibilityPaths(path: string) {
    const normalizedPath = normalizePluginPath(path).toLowerCase();

    if (normalizedPath === 'ptv/v1/status') {
        return ['Ptv/Status'];
    }

    if (normalizedPath === 'ptv/v1/featured') {
        return [
            'Ptv/v1/FeaturedContent',
            'Ptv/FeaturedContent'
        ];
    }

    if (normalizedPath === 'ptv/v1/featured/refresh') {
        return [
            'Ptv/v1/FeaturedContent/Refresh',
            'Ptv/FeaturedContent/Refresh'
        ];
    }

    return [];
}

function getPluginReadCacheTtlMs(method: string, path: string) {
    if (method !== 'GET') return 0;

    const endpoint = getEndpointName(path);

    if (endpoint === 'featuredContent') return 10000;
    if (endpoint === 'settings') return 30000;
    if (endpoint === 'status') return 30000;

    return 0;
}

function getPluginRequestDedupeKey(
    serverIdentity: string,
    authorizationIdentity: string,
    method: string,
    path: string,
    params?: Record<string, unknown>
) {
    const endpoint = getEndpointName(path);

    if (
        method === 'GET'
        && (
            endpoint === 'featuredContent'
            || endpoint === 'settings'
            || endpoint === 'status'
        )
    ) {
        return getPluginRequestCacheKey(serverIdentity, authorizationIdentity, method, path, params);
    }

    if (method === 'POST' && normalizedIntegrationTestPath(path)) {
        return getPluginRequestCacheKey(serverIdentity, authorizationIdentity, method, path, params);
    }

    return null;
}

function clearPluginReadResponseCache() {
    pluginReadResponseCacheRevision += 1;

    if (pluginReadResponseCache.size) {
        pluginReadResponseCache.clear();
    }
}

function setPluginReadResponseCacheEntry(key: string, value: unknown, expiresAt: number) {
    const now = Date.now();

    pluginReadResponseCache.forEach((entry, entryKey) => {
        if (entry.expiresAt <= now) pluginReadResponseCache.delete(entryKey);
    });
    pluginReadResponseCache.delete(key);
    pluginReadResponseCache.set(key, { expiresAt, value });

    while (pluginReadResponseCache.size > MAX_PLUGIN_READ_RESPONSE_CACHE_ENTRIES) {
        const oldestKey = pluginReadResponseCache.keys().next().value;

        if (oldestKey === undefined) break;
        pluginReadResponseCache.delete(oldestKey);
    }
}

function retirePluginRequestIdentityState() {
    retireConfiguredRowFreshness('authenticated-identity-retired');
    pluginRequestIdentityGeneration += 1;
    clearPluginReadResponseCache();
    inFlightPluginRequests.clear();
}

function ensurePluginRequestIdentityLifecycle() {
    if (pluginRequestIdentityLifecycleInitialized) return;

    // Keep this binding behind a runtime call. pluginApi is part of the
    // ServerConnections bootstrap dependency graph, so reading the barrel export
    // during module evaluation observes its still-uninitialized live binding.
    Events.on(ServerConnections, 'localusersignedin', retirePluginRequestIdentityState);
    Events.on(ServerConnections, 'localusersignedout', retirePluginRequestIdentityState);
    pluginRequestIdentityLifecycleInitialized = true;
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
    params?: Record<string, unknown>,
    options: { requireApiClientRoot?: boolean } = {}
) {
    const candidates: string[] = [];

    getPluginRootCandidates(apiClient, path, params, options).forEach(root => {
        addPluginApiCandidate(candidates, appendPluginPath(root, path, params));
        getPluginCompatibilityPaths(path).forEach(compatibilityPath => {
            addPluginApiCandidate(candidates, appendPluginPath(root, compatibilityPath, params));
        });
    });

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

function notePluginApiAttempt(url: string, candidates: string[], path: string) {
    const diagnosticUrl = getSanitizedPluginDiagnosticUrl(url, path);
    const attemptedUrls = [...pluginApiDiagnostics.attemptedUrls, diagnosticUrl].slice(-40);
    const originDetail = classifyPtvRequestUrl(url, {
        jellyfinRoot: authoritativePluginApiRoot || resolvedPluginApiRoot || getConfiguredJellyfinRoot(),
        pluginRoot: authoritativePluginApiRoot || resolvedPluginApiRoot || getConfiguredJellyfinRoot()
    });
    const originKind = originDetail.originKind;
    const attemptedOrigins = [
        ...pluginApiDiagnostics.attemptedOrigins,
        {
            origin: getPrivacySafePluginDiagnosticOrigin(originDetail.origin) || '',
            originKind,
            url: diagnosticUrl
        }
    ].slice(-40);
    const pluginApiOrigins = Array.from(new Set(attemptedOrigins
        .filter(attempt => attempt.originKind === 'plugin-api')
        .map(attempt => attempt.origin)
        .filter(Boolean)));
    let originDriftWarning = pluginApiDiagnostics.originDriftWarning;

    if (pluginApiOrigins.length > 1) {
        originDriftWarning = authoritativePluginApiRoot || resolvedPluginApiRoot ?
            'Plugin API server transition detected; the most recent successful root is active.' :
            'Plugin API server transition detected; the active root is pending a successful request.';

        if (pluginApiDiagnostics.originDriftWarning !== originDriftWarning) {
            ptvSafeConsole.warn(`[PTV Plugin API] ${originDriftWarning}`);
        }
    }

    const allCandidates = [...pluginApiDiagnostics.candidates];

    candidates.forEach(() => {
        if (!allCandidates.includes(diagnosticUrl)) {
            allCandidates.push(diagnosticUrl);
        }
    });

    updatePluginApiDiagnostics({
        attemptedOrigins,
        attemptedUrl: diagnosticUrl,
        attemptedUrls,
        authoritativePluginApiRoot: getPrivacySafePluginDiagnosticOrigin(authoritativePluginApiRoot),
        candidates: allCandidates.slice(-40),
        originDriftWarning
    });

    debugLog('trying plugin endpoint', { endpoint: getEndpointName(path), originKind });
}

function getPrivacySafePluginDiagnosticOrigin(origin: string | null) {
    if (!origin) return null;

    let hash = 0x811c9dc5;

    for (let index = 0; index < origin.length; index += 1) {
        hash ^= origin.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }

    return `origin#${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function getSanitizedPluginDiagnosticUrl(_url: string, path: string) {
    return `endpoint:${getEndpointName(path)}`;
}

function getPrivacySafePluginDiagnosticError(error: PtvNormalizedApiError, endpoint: string) {
    return {
        endpoint,
        kind: error.kind,
        message: `Plugin request failed (${error.kind}).`,
        status: error.status,
        url: `endpoint:${endpoint}`
    } satisfies PtvNormalizedApiError;
}

function getPluginRequestDuration(startedAt: number) {
    return Number(Math.max(0, performance.now() - startedAt).toFixed(1));
}

function notePluginApiSuccess(
    url: string,
    path: string,
    candidates: string[],
    status: number,
    durationMs: number
) {
    const resolvedRoot = getRootForResolvedPath(url, path);
    const endpoint = getEndpointName(path);
    const diagnosticUrl = getSanitizedPluginDiagnosticUrl(url, path);
    const attemptedResponses = [
        ...pluginApiDiagnostics.attemptedResponses,
        {
            durationMs,
            endpoint,
            ok: true,
            responseBody: null,
            status,
            url: diagnosticUrl
        }
    ].slice(-40);

    if (resolvedRoot) {
        const pinnedRoot = setAuthoritativePluginApiRoot(resolvedRoot, 'successful-request');

        resolvedPluginApiRoot = pinnedRoot || resolvedRoot;
    }

    updatePluginApiDiagnostics({
        authoritativePluginApiRoot: getPrivacySafePluginDiagnosticOrigin(authoritativePluginApiRoot),
        attemptedResponses,
        attemptedUrl: diagnosticUrl,
        candidates: candidates.length ? [diagnosticUrl] : [],
        lastError: null,
        lastFailedEndpoint: null,
        lastFailedStatusCode: null,
        lastSuccessfulEndpoint: endpoint,
        originDriftWarning: null,
        resolvedRoot: getPrivacySafePluginDiagnosticOrigin(resolvedPluginApiRoot),
        resolvedUrl: diagnosticUrl
    });

    debugLog('resolved plugin endpoint', pluginApiDiagnostics);
}

function notePluginApiFailure(
    err: unknown,
    path: string,
    url: string,
    candidates: string[],
    durationMs: number
) {
    const endpoint = getEndpointName(path);
    const normalizedError = withEndpointErrorDetail(err, endpoint, url);
    const diagnosticError = getPrivacySafePluginDiagnosticError(normalizedError, endpoint);
    const diagnosticUrl = getSanitizedPluginDiagnosticUrl(url, path);
    const attemptedResponses = [
        ...pluginApiDiagnostics.attemptedResponses,
        {
            durationMs,
            endpoint,
            ok: false,
            responseBody: null,
            status: normalizedError.status || null,
            url: diagnosticUrl
        }
    ].slice(-40);

    updatePluginApiDiagnostics({
        attemptedResponses,
        authoritativePluginApiRoot: getPrivacySafePluginDiagnosticOrigin(authoritativePluginApiRoot),
        candidates: candidates.length ? [diagnosticUrl] : [],
        lastError: diagnosticError,
        lastFailedEndpoint: endpoint,
        lastFailedStatusCode: normalizedError.status || null,
        lastResponseBody: null
    });

    debugLog('plugin endpoint failed', {
        errorCategory: normalizedError.kind,
        status: normalizedError.status || null,
        endpoint
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
        attemptedOrigins: pluginApiDiagnostics.attemptedOrigins.map(attempt => ({
            origin: attempt.origin.startsWith('origin#') ? attempt.origin : getPrivacySafePluginDiagnosticOrigin(attempt.origin) || '',
            originKind: attempt.originKind,
            url: attempt.url.startsWith('endpoint:') ? attempt.url : 'endpoint:unknown'
        })),
        attemptedResponses: pluginApiDiagnostics.attemptedResponses.map(attempt => ({
            ...attempt,
            responseBody: null,
            url: attempt.url.startsWith('endpoint:') ? attempt.url : 'endpoint:unknown'
        })),
        attemptedUrl: pluginApiDiagnostics.attemptedUrl?.startsWith('endpoint:') ? pluginApiDiagnostics.attemptedUrl : null,
        attemptedUrls: pluginApiDiagnostics.attemptedUrls
            .filter(value => value.startsWith('endpoint:')),
        authoritativePluginApiRoot: pluginApiDiagnostics.authoritativePluginApiRoot ? 'state:resolved' : null,
        candidates: pluginApiDiagnostics.candidates.filter(value => value.startsWith('endpoint:')),
        lastError: pluginApiDiagnostics.lastError ? getPrivacySafePluginDiagnosticError(
            pluginApiDiagnostics.lastError,
            pluginApiDiagnostics.lastError.endpoint || 'unknown'
        ) : null,
        lastResponseBody: null,
        resolvedRoot: pluginApiDiagnostics.resolvedRoot ? 'state:resolved' : null,
        resolvedUrl: pluginApiDiagnostics.resolvedUrl?.startsWith('endpoint:') ? pluginApiDiagnostics.resolvedUrl : null,
        startupReasonCounts: { ...pluginApiDiagnostics.startupReasonCounts }
    };
}

export function getPtvPluginApiResolvedRoot() {
    return authoritativePluginApiRoot || resolvedPluginApiRoot;
}

export function getPtvPluginApiResolvedUrl(
    path: string = PTV_PLUGIN_API.endpoints.status,
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
    const normalized = normalizePtvApiError(err);
    debugLog('temporarily disabled plugin endpoint probing', {
        code: normalized.code || null,
        errorCategory: normalized.kind,
        status: normalized.status || null
    });
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

    if (status === 204) {
        return Promise.resolve(undefined as T);
    }

    if (isJsonResponseLike(response)) {
        return response.json().then(value => value as T);
    }

    return Promise.resolve(response as T);
}

// eslint-disable-next-line sonarjs/cognitive-complexity
function requestPluginJson<T>(
    apiClient: PtvJellyfinApiClient,
    path: string,
    options: PtvPluginPayloadRequestOptions & { method?: 'DELETE' | 'GET' | 'POST' | 'PUT' } = {}
): Promise<T> {
    if (shouldSkipPluginApi()) {
        return Promise.reject(new Error('PTV plugin API is unavailable.'));
    }

    const currentClient = getCurrentApiClient() || apiClient;
    const requiresAuthentication = options.requiresAuthentication !== false;

    if (requiresAuthentication && !isPluginAuthenticationReady(currentClient)) {
        return waitForPluginAuthentication(currentClient, options.signal)
            .then(authenticatedClient => requestPluginJson<T>(authenticatedClient, path, options));
    }

    const method = options.method || 'GET';
    const isAuthenticatedFeaturedRead = requiresAuthentication
        && method === 'GET'
        && getEndpointName(path) === 'featuredContent';
    const candidates = getPluginUrlCandidates(currentClient, path, options.params, {
        requireApiClientRoot: isAuthenticatedFeaturedRead || /^ptv\/v1\/home-(?:transitions|user-access)\//.test(normalizePluginPath(path).toLowerCase())
    });
    const serverIdentity = getPluginRequestServerIdentity(currentClient, path, options.params, candidates[0]);
    const authenticatedIdentity = requiresAuthentication ? getPluginAuthenticatedIdentity(currentClient) : null;
    const requestSharingIdentity = requiresAuthentication ? authenticatedIdentity : 'public';
    const identityGeneration = pluginRequestIdentityGeneration;
    const responseCacheTtlMs = getPluginReadCacheTtlMs(method, path);
    const canShareRequest = Boolean(requestSharingIdentity);
    const canUseResponseCache = responseCacheTtlMs > 0 && !options.bypassCache && canShareRequest;
    const responseCacheKey = canUseResponseCache ?
        getPluginRequestCacheKey(serverIdentity, requestSharingIdentity!, method, path, options.params) :
        null;
    const responseCacheRevision = pluginReadResponseCacheRevision;

    if (options.signal?.aborted) {
        return Promise.reject(Object.assign(new Error('Plugin request aborted.'), {
            code: 'PTV_PLUGIN_REQUEST_ABORTED'
        }));
    }

    if (!candidates.length) {
        return Promise.reject(new Error('Jellyfin API client cannot build plugin URLs.'));
    }

    if (method !== 'GET') {
        if (/\/(?:settings|rows|featured)(?:\/|$)/i.test(path)) {
            retireConfiguredRowFreshness('configuration-mutation');
        }
        clearPluginReadResponseCache();
    } else if (responseCacheKey) {
        const cachedResponse = pluginReadResponseCache.get(responseCacheKey);

        if (cachedResponse && Date.now() < cachedResponse.expiresAt) {
            debugLog('served plugin endpoint response from short cache', {
                identityScope: requiresAuthentication ? 'authenticated' : 'public',
                method,
                path
            });

            if (requiresAuthentication && authenticatedIdentity) {
                return resolvePluginResponseForIdentity(
                    cachedResponse.value as T,
                    authenticatedIdentity,
                    identityGeneration,
                    currentClient
                );
            }

            return Promise.resolve(cachedResponse.value as T);
        }

        if (cachedResponse) {
            pluginReadResponseCache.delete(responseCacheKey);
        }
    }

    let dedupeKey: string | null = null;

    if (!options.bypassCache && requestSharingIdentity) {
        dedupeKey = getPluginRequestDedupeKey(
            serverIdentity,
            requestSharingIdentity,
            method,
            path,
            options.params
        );
    }
    const inFlightRequest = dedupeKey ? inFlightPluginRequests.get(dedupeKey) : null;

    if (inFlightRequest) {
        updatePluginApiDiagnostics({
            deduplicatedRequestCount: pluginApiDiagnostics.deduplicatedRequestCount + 1
        });
        debugLog('deduped plugin endpoint request', {
            identityScope: requiresAuthentication ? 'authenticated' : 'public',
            method,
            path
        });

        return inFlightRequest as Promise<T>;
    }

    notePluginApiRequest(path);

    const runAttempt = (candidateIndex: number): Promise<T> => {
        const url = candidates[candidateIndex];
        const startedAt = performance.now();
        let responseStatus = 200;

        notePluginApiAttempt(url, candidates, path);

        let request: Promise<unknown> | undefined;

        if (method === 'GET' && !options.signal) {
            request = currentClient.getJSON?.(url, true);
        } else if (method === 'GET') {
            request = currentClient.fetch?.({
                headers: {
                    Accept: 'application/json'
                },
                method,
                signal: options.signal,
                type: method,
                url
            }, true) || currentClient.ajax?.({
                headers: {
                    Accept: 'application/json'
                },
                method,
                signal: options.signal,
                type: method,
                url
            });
        } else {
            request = currentClient.ajax?.({
                contentType: 'application/json',
                data: options.body === undefined ? undefined : JSON.stringify(options.body),
                headers: {
                    Accept: 'application/json'
                },
                method,
                signal: options.signal,
                type: method,
                url
            }) || currentClient.fetch?.({
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
        }

        if (!request) {
            return Promise.reject(new Error('Jellyfin API client cannot call plugin endpoints.'));
        }

        return request
            .then(response => {
                responseStatus = getHttpStatus(response) || 200;

                return parsePluginResponse<T>(response);
            })
            .then(result => {
                notePluginApiSuccess(
                    url,
                    path,
                    candidates,
                    responseStatus,
                    getPluginRequestDuration(startedAt)
                );

                return result;
            })
            .catch((err: unknown) => {
                notePluginApiFailure(err, path, url, candidates, getPluginRequestDuration(startedAt));

                if (
                    candidateIndex < candidates.length - 1
                    && shouldRetryPluginCandidate(err)
                ) {
                    updatePluginApiDiagnostics({
                        retryCount: pluginApiDiagnostics.retryCount + 1
                    });
                    const normalized = normalizePtvApiError(err);
                    debugLog('plugin endpoint candidate failed, trying fallback', {
                        code: normalized.code || null,
                        endpoint: getEndpointName(path),
                        errorCategory: normalized.kind,
                        method,
                        status: normalized.status || null
                    });

                    return runAttempt(candidateIndex + 1);
                }

                if (shouldKeepPluginAvailableAfterError(err)) {
                    debugLog('plugin endpoint denied by authorization; keeping read endpoints available', {
                        endpoint: getEndpointName(path),
                        method,
                        status: getHttpStatus(err)
                    });
                } else if (shouldAffectPluginAvailability(path)) {
                    markPluginUnavailable(err);
                }

                throw err;
            });
    };

    const request = runAttempt(0)
        .then(result => {
            if (
                method === 'GET'
                && requiresAuthentication
                && authenticatedIdentity
            ) {
                assertPluginRequestIdentityCurrent(authenticatedIdentity, identityGeneration, currentClient);
            }

            if (method !== 'GET') {
                clearPluginReadResponseCache();
            } else if (
                responseCacheKey
                && responseCacheTtlMs > 0
                && responseCacheRevision === pluginReadResponseCacheRevision
            ) {
                setPluginReadResponseCacheEntry(
                    responseCacheKey,
                    result,
                    Date.now() + responseCacheTtlMs
                );
            }

            return result;
        })
        .finally(() => {
            if (dedupeKey && inFlightPluginRequests.get(dedupeKey) === request) {
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

const pluginStatusListeners = new Set<(status: unknown) => void>();

function publishPtvPluginStatus(status: unknown) {
    observeHomeLibraryAuthority(status);
    observeConfiguredRowAuthority(readConfiguredPresentationAuthority(status));
    pluginStatusListeners.forEach(listener => {
        try {
            listener(status);
        } catch {
            // A presentation consumer must never fail the authoritative request.
        }
    });
}

function captureConfiguredAuthorityObserver(apiClient: PtvJellyfinApiClient) {
    const identity = getPluginAuthenticatedIdentity(apiClient);
    const generation = pluginRequestIdentityGeneration;
    return () => {
        if (!identity) return false;
        try {
            assertPluginRequestIdentityCurrent(identity, generation, apiClient);
        } catch {
            return false; // A retired user's request cannot invalidate the next user's presentation.
        }
        return true;
    };
}

export function subscribePtvPluginStatus(listener: (status: unknown) => void) {
    pluginStatusListeners.add(listener);

    return () => {
        pluginStatusListeners.delete(listener);
    };
}

export function resetPtvPluginApiAvailability() {
    pluginUnavailableUntil = 0;
    authoritativePluginApiRoot = null;
    resolvedPluginApiRoot = null;
    clearPluginReadResponseCache();
    pluginApiDiagnostics = {
        authenticationReadyRetryCount: pluginApiDiagnostics.authenticationReadyRetryCount,
        authenticationWaitCount: pluginApiDiagnostics.authenticationWaitCount,
        attemptedOrigins: pluginApiDiagnostics.attemptedOrigins,
        attemptedResponses: pluginApiDiagnostics.attemptedResponses,
        attemptedUrl: null,
        attemptedUrls: pluginApiDiagnostics.attemptedUrls,
        authoritativePluginApiRoot: null,
        candidates: [],
        deduplicatedRequestCount: pluginApiDiagnostics.deduplicatedRequestCount,
        lastError: null,
        lastFailedEndpoint: null,
        lastFailedStatusCode: null,
        lastResponseBody: null,
        lastSuccessfulEndpoint: pluginApiDiagnostics.lastSuccessfulEndpoint,
        originDriftWarning: null,
        resolvedRoot: null,
        resolvedUrl: null,
        retryBackoffMs: pluginApiDiagnostics.retryBackoffMs,
        retryCount: pluginApiDiagnostics.retryCount,
        startupAttemptCount: pluginApiDiagnostics.startupAttemptCount,
        startupReasonCounts: { ...pluginApiDiagnostics.startupReasonCounts },
        statusAttemptCount: pluginApiDiagnostics.statusAttemptCount,
        settingsAttemptCount: pluginApiDiagnostics.settingsAttemptCount,
        featuredAttemptCount: pluginApiDiagnostics.featuredAttemptCount
    };
}

export function isPtvPluginApiCoolingDown() {
    return Date.now() < pluginUnavailableUntil;
}

export function getCurrentPtvPluginApiClient(apiClient = getCurrentApiClient()) {
    ensurePluginRequestIdentityLifecycle();

    if (!apiClient?.getUrl) return null;

    return {
        matchesSdkApi(api: Api) {
            const address = apiClient.serverAddress?.();
            const token = apiClient.accessToken?.();
            return Boolean(address && token && api.basePath.replace(/\/$/, '') === address.replace(/\/$/, '') && api.accessToken === token);
        },
        beginHomeTransition(body: HomeTransitionIntent, options?: PtvPluginRequestOptions) {
            return requestPluginJson<HomeTransitionResponse>(apiClient, `${PTV_PLUGIN_API.endpoints.homeTransitions}/begin`, { ...options, body, method: 'POST' });
        },
        completeHomeTransition(operationId: string, body: HomeTransitionCompleteRequest = {}, options?: PtvPluginRequestOptions) {
            return requestPluginJson<HomeTransitionResponse>(apiClient, `${PTV_PLUGIN_API.endpoints.homeTransitions}/${encodeURIComponent(operationId)}/complete`, { ...options, body, method: 'POST' });
        },
        getCurrentHomeTransition(options?: PtvPluginRequestOptions) {
            return requestPluginJson<HomeTransitionResponse>(apiClient, `${PTV_PLUGIN_API.endpoints.homeTransitions}/current`, { ...options, bypassCache: true });
        },
        beginHomeUserAccess(body: HomeUserAccessBeginRequest, options?: PtvPluginRequestOptions) {
            return requestPluginJson<HomeUserAccessResponse>(apiClient, `${PTV_PLUGIN_API.endpoints.homeUserAccess}/begin`, { ...options, body, method: 'POST' });
        },
        completeHomeUserAccess(operationId: string, options?: PtvPluginRequestOptions) {
            return requestPluginJson<HomeUserAccessResponse>(apiClient, `${PTV_PLUGIN_API.endpoints.homeUserAccess}/${encodeURIComponent(operationId)}/complete`, { ...options, body: {}, method: 'POST' });
        },
        getCurrentHomeUserAccess(userId: string, options?: PtvPluginRequestOptions) {
            return requestPluginJson<HomeUserAccessResponse>(apiClient, `${PTV_PLUGIN_API.endpoints.homeUserAccess}/current`, {
                ...options,
                bypassCache: true,
                params: { userId }
            });
        },
        createHomeUserVerificationBatch(options?: PtvPluginRequestOptions) {
            return requestPluginJson<HomeUserVerificationBatch>(apiClient, `${PTV_PLUGIN_API.endpoints.homeUserAccess}/verification-batches`, {
                ...options, body: {}, method: 'POST'
            });
        },
        createFreshHomeUserVerificationBatch(options?: PtvPluginRequestOptions) {
            return requestPluginJson<HomeUserVerificationBatch>(apiClient, `${PTV_PLUGIN_API.endpoints.homeUserAccess}/verification-batches/new`, {
                ...options, body: {}, method: 'POST'
            });
        },
        getHomeUserVerificationSummary(options?: PtvPluginRequestOptions) {
            return requestPluginJson<HomeUserVerificationSummary>(apiClient, `${PTV_PLUGIN_API.endpoints.homeUserAccess}/verification-summary`, {
                ...options, bypassCache: true
            });
        },
        recoverCorruptHomeUserAccessLedger(options?: PtvPluginRequestOptions) {
            return requestPluginJson<HomeUserCorruptRecoveryResponse>(apiClient, `${PTV_PLUGIN_API.endpoints.homeUserAccess}/recover-corrupt`, {
                ...options, body: {}, method: 'POST'
            });
        },
        reserveHomeUserCreation(body: { creationOperationId: string }, options?: PtvPluginRequestOptions) {
            return requestPluginJson<HomeUserCreationReservation>(apiClient, `${PTV_PLUGIN_API.endpoints.homeUserAccess}/creations/reserve`, {
                ...options, body, method: 'POST'
            });
        },
        bindHomeUserCreation(creationOperationId: string, body: { userId: string }, options?: PtvPluginRequestOptions) {
            return requestPluginJson<HomeUserCreationBinding>(apiClient,
                `${PTV_PLUGIN_API.endpoints.homeUserAccess}/creations/${encodeURIComponent(creationOperationId)}/bind`,
                { ...options, body, method: 'POST' });
        },
        getCurrentHomeUserCreations(options?: PtvPluginRequestOptions) {
            return requestPluginJson<HomeUserCreationCurrent>(apiClient, `${PTV_PLUGIN_API.endpoints.homeUserAccess}/creations/current`, {
                ...options, bypassCache: true
            });
        },
        recoverHomeUserCreation(creationOperationId: string, body: { confirmCreationRequestSettled: true }, options?: PtvPluginRequestOptions) {
            return requestPluginJson<HomeUserCreationRecovery>(apiClient,
                `${PTV_PLUGIN_API.endpoints.homeUserAccess}/creations/${encodeURIComponent(creationOperationId)}/recover`,
                { ...options, body, method: 'POST' });
        },
        getCurrentHomeUserVerificationBatch(options?: PtvPluginRequestOptions) {
            return requestPluginJson<HomeUserVerificationBatch>(apiClient, `${PTV_PLUGIN_API.endpoints.homeUserAccess}/verification-batches/current`, {
                ...options, bypassCache: true
            });
        },
        verifyHomeUserVerificationBatchCandidate(batchId: string, userId: string, body: HomeUserVerificationRequest, options?: PtvPluginRequestOptions) {
            return requestPluginJson<HomeUserAccessResponse>(apiClient,
                `${PTV_PLUGIN_API.endpoints.homeUserAccess}/verification-batches/${encodeURIComponent(batchId)}/users/${encodeURIComponent(userId)}/verify`,
                { ...options, body, method: 'POST' });
        },
        getCurrentServerId() {
            return typeof apiClient.serverId === 'function' ? apiClient.serverId() : null;
        },
        getCurrentUserId() {
            return typeof apiClient.getCurrentUserId === 'function' ? apiClient.getCurrentUserId() : null;
        },
        getAccountProfile<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, PTV_PLUGIN_API.endpoints.accountProfile, options);
        },
        startAccountEmailVerification<TResponse = unknown, TRequest = unknown>(body: TRequest, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(apiClient, PTV_PLUGIN_API.endpoints.accountEmailVerification, {
                ...options,
                body,
                method: 'POST'
            });
        },
        resendAccountEmailVerification<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, `${PTV_PLUGIN_API.endpoints.accountEmailVerification}/resend`, {
                ...options,
                body: {},
                method: 'POST'
            });
        },
        cancelAccountEmailVerification<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, `${PTV_PLUGIN_API.endpoints.accountEmailVerification}/cancel`, {
                ...options,
                body: {},
                method: 'POST'
            });
        },
        verifyAccountEmail<TResponse = unknown, TRequest = unknown>(body: TRequest, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(apiClient, PTV_PLUGIN_API.endpoints.accountEmailVerify, {
                ...options,
                body,
                method: 'POST',
                requiresAuthentication: false
            });
        },
        getAccountAdminHealth<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, PTV_PLUGIN_API.endpoints.accountAdminHealth, options);
        },
        getAccountAdminUsers<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, PTV_PLUGIN_API.endpoints.accountAdminUsers, options);
        },
        cancelAccountAdminVerification<T = unknown>(jellyfinUserId: string, options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, `${PTV_PLUGIN_API.endpoints.accountAdminUsers}/${encodeURIComponent(jellyfinUserId)}/verification/cancel`, {
                ...options,
                body: {},
                method: 'POST'
            });
        },
        createAccountBackup<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, PTV_PLUGIN_API.endpoints.accountAdminBackups, {
                ...options,
                body: {},
                method: 'POST'
            });
        },
        verifyAccountBackup<TResponse = unknown, TRequest = unknown>(body: TRequest, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(apiClient, `${PTV_PLUGIN_API.endpoints.accountAdminBackups}/verify`, {
                ...options,
                body,
                method: 'POST'
            });
        },
        restoreAccountBackup<TResponse = unknown, TRequest = unknown>(body: TRequest, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(apiClient, `${PTV_PLUGIN_API.endpoints.accountAdminBackups}/restore`, {
                ...options,
                body,
                method: 'POST'
            });
        },
        getBackdropPreprocessStatus<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.backdropPreprocess,
                options
            );
        },
        getFeaturedContentCacheDocument(options?: PtvPluginRequestOptions) {
            return requestPluginJsonWithMissingFallback<PtvPluginFeaturedContentDocument>(
                apiClient,
                PTV_PLUGIN_API.endpoints.featuredContent,
                'Ptv/v1/FeaturedContent',
                options
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
        getRecommendations<T = PtvCoreRecommendationResponse>(options?: PtvPluginPayloadRequestOptions) {
            return requestPluginJson<unknown>(
                apiClient,
                PTV_PLUGIN_API.endpoints.recommendations,
                {
                    ...options,
                    method: options?.body === undefined ? 'GET' : 'POST'
                }
            ).then(value => normalizePtvPluginRecommendationResponse(value, {
                cacheVersion: 1,
                serverId: apiClient.serverAddress?.() || 'current-server',
                userId: apiClient.getCurrentUserId?.() || 'current-user'
            }) as T);
        },
        rankRecommendations(
            request: PtvRecommendationPolicyRequest,
            options?: PtvPluginRequestOptions
        ) {
            return requestPluginJson<PtvRecommendationPolicyResponse>(
                apiClient,
                PTV_PLUGIN_API.endpoints.recommendationPolicyRank,
                {
                    ...options,
                    body: request,
                    method: 'POST'
                }
            );
        },
        searchMusicMetadata<T = unknown>(params: Record<string, unknown>, options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.musicMetadataSearch,
                {
                    ...options,
                    params
                }
            );
        },
        searchGoogleBooksMetadata<T = unknown>(params: Record<string, unknown>, options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.googleBooksMetadataSearch,
                {
                    ...options,
                    params
                }
            );
        },
        getReadingMetadataProviders<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.readingMetadataProviders,
                options
            );
        },
        searchReadingMetadata<TResponse = unknown, TRequest = unknown>(
            body: TRequest,
            options?: PtvPluginRequestOptions
        ) {
            return requestPluginJson<TResponse>(
                apiClient,
                PTV_PLUGIN_API.endpoints.readingMetadataSearch,
                {
                    ...options,
                    body,
                    method: 'POST'
                }
            );
        },
        reassessReadingMetadata<TResponse = unknown, TRequest = unknown>(
            body: TRequest,
            options?: PtvPluginRequestOptions
        ) {
            return requestPluginJson<TResponse>(
                apiClient,
                PTV_PLUGIN_API.endpoints.readingMetadataReassess,
                { ...options, body, method: 'POST', bypassCache: true }
            );
        },
        getReadingSeriesOverrides<T = unknown>(routeKind: string, options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                `${PTV_PLUGIN_API.endpoints.readingSeriesOverrides}/${encodeURIComponent(routeKind)}`,
                options
            );
        },
        saveReadingSeriesOverrides<TResponse = unknown, TBody = unknown>(routeKind: string, body: TBody, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(
                apiClient,
                `${PTV_PLUGIN_API.endpoints.readingSeriesOverrides}/${encodeURIComponent(routeKind)}`,
                {
                    ...options,
                    body,
                    method: 'PUT'
                }
            );
        },
        getItemRelationships<T = unknown>(sourceItemId: string, options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                `${PTV_PLUGIN_API.endpoints.relationships}/${encodeURIComponent(sourceItemId)}`,
                options
            );
        },
        createItemRelationship<TResponse = unknown, TBody = unknown>(body: TBody, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(
                apiClient,
                PTV_PLUGIN_API.endpoints.relationships,
                {
                    ...options,
                    body,
                    method: 'POST'
                }
            );
        },
        updateItemRelationship<TResponse = unknown, TBody = unknown>(mappingId: string, body: TBody, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(
                apiClient,
                `${PTV_PLUGIN_API.endpoints.relationships}/${encodeURIComponent(mappingId)}`,
                {
                    ...options,
                    body,
                    method: 'PUT'
                }
            );
        },
        deleteItemRelationship(mappingId: string, options?: PtvPluginRequestOptions) {
            return requestPluginJson<void>(
                apiClient,
                `${PTV_PLUGIN_API.endpoints.relationships}/${encodeURIComponent(mappingId)}`,
                {
                    ...options,
                    method: 'DELETE'
                }
            );
        },
        getStatus<T = unknown>(options?: PtvPluginRequestOptions) {
            const isObservationCurrent = captureConfiguredAuthorityObserver(apiClient);
            return requestPluginJson<T>(apiClient, PTV_PLUGIN_API.endpoints.status, options)
                .then(status => {
                    if (isObservationCurrent()) publishPtvPluginStatus(status);
                    return status;
                }).catch(error => {
                    if (isObservationCurrent()) {
                        observeHomeLibraryAuthority(null);
                        retireConfiguredRowFreshness('status-authority-uncertain');
                    }
                    throw error;
                });
        },
        getMetadataQualitySummary<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, PTV_PLUGIN_API.endpoints.metadataQualitySummary, options);
        },
        getMetadataQualityStatus<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, PTV_PLUGIN_API.endpoints.metadataQualityStatus, options);
        },
        getMetadataQualityResults<T = unknown>(params: Record<string, unknown>, options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, PTV_PLUGIN_API.endpoints.metadataQualityResults, {
                ...options,
                params
            });
        },
        getMetadataQualityResult<T = unknown>(itemId: string, options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                `${PTV_PLUGIN_API.endpoints.metadataQualityResults}/${encodeURIComponent(itemId)}`,
                options
            );
        },
        getMetadataQualitySettings<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, PTV_PLUGIN_API.endpoints.metadataQualitySettings, options);
        },
        saveMetadataQualitySettings<TResponse = unknown, TRequest = unknown>(body: TRequest, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(apiClient, PTV_PLUGIN_API.endpoints.metadataQualitySettings, {
                ...options,
                body,
                method: 'POST'
            });
        },
        testMetadataQualityAiConnection<TResponse = unknown, TRequest = unknown>(body: TRequest, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(apiClient, PTV_PLUGIN_API.endpoints.metadataQualityAiTest, {
                ...options,
                body,
                method: 'POST'
            });
        },
        startMetadataQualityScan<TResponse = unknown, TRequest = unknown>(body: TRequest, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(apiClient, PTV_PLUGIN_API.endpoints.metadataQualityScan, {
                ...options,
                body,
                method: 'POST'
            });
        },
        cancelMetadataQualityScan<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, `${PTV_PLUGIN_API.endpoints.metadataQualityScan}/cancel`, {
                ...options,
                body: {},
                method: 'POST'
            });
        },
        resolveMetadataQualityResult<TResponse = unknown, TRequest = unknown>(
            itemId: string,
            body: TRequest,
            options?: PtvPluginRequestOptions
        ) {
            return requestPluginJson<TResponse>(
                apiClient,
                `${PTV_PLUGIN_API.endpoints.metadataQualityResults}/${encodeURIComponent(itemId)}/resolve`,
                {
                    ...options,
                    body,
                    method: 'POST'
                }
            );
        },
        checkInRemoteDiagnostics<TResponse = unknown, TPresence = unknown>(presence: TPresence, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(
                apiClient,
                PTV_PLUGIN_API.endpoints.remoteDiagnosticsCheckIn,
                {
                    ...options,
                    body: presence,
                    method: 'POST'
                }
            );
        },
        getRemoteDiagnosticsCheckInUrl() {
            return getPluginUrl(apiClient, PTV_PLUGIN_API.endpoints.remoteDiagnosticsCheckIn);
        },
        getJellyfinSessions<T = unknown>(options?: unknown) {
            return typeof apiClient.getSessions === 'function' ?
                apiClient.getSessions(options) as Promise<T> :
                Promise.resolve([] as T);
        },
        publishRemoteDiagnosticsReport<TReport = unknown>(report: TReport, options?: PtvPluginRequestOptions) {
            return requestPluginJson<void>(
                apiClient,
                PTV_PLUGIN_API.endpoints.remoteDiagnosticsReport,
                {
                    ...options,
                    body: report,
                    method: 'POST'
                }
            );
        },
        getRemoteDiagnosticsClients<T = unknown>(profile?: string, options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.remoteDiagnosticsClients,
                {
                    ...options,
                    params: profile ? { profile } : undefined
                }
            );
        },
        getRemoteDiagnosticsStorage<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, PTV_PLUGIN_API.endpoints.remoteDiagnosticsStorage, options);
        },
        rotateRemoteDiagnosticsStorage<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, `${PTV_PLUGIN_API.endpoints.remoteDiagnosticsStorage}/rotate`, { ...options, body: {}, method: 'POST' });
        },
        clearRemoteDiagnosticsStorage<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, `${PTV_PLUGIN_API.endpoints.remoteDiagnosticsStorage}/clear`, { ...options, body: { confirm: true }, method: 'POST' });
        },
        consolidateRemoteDiagnosticsStorage<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(apiClient, `${PTV_PLUGIN_API.endpoints.remoteDiagnosticsStorage}/consolidate`, { ...options, body: { confirm: true, createArchive: true }, method: 'POST' });
        },
        getRemoteDiagnosticsStorageDownloadUrl() {
            return getPluginUrl(apiClient, `${PTV_PLUGIN_API.endpoints.remoteDiagnosticsStorage}/download`);
        },
        getRemoteDiagnosticsStorageBundleUrl() {
            return getPluginUrl(apiClient, `${PTV_PLUGIN_API.endpoints.remoteDiagnosticsStorage}/bundle`);
        },
        startRemoteDiagnosticsSession<T = unknown>(clientId: string, durationMinutes: 5 | 10, options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                `${PTV_PLUGIN_API.endpoints.remoteDiagnosticsClients}/${encodeURIComponent(clientId)}/sessions`,
                {
                    ...options,
                    body: { durationMinutes },
                    method: 'POST'
                }
            );
        },
        stopRemoteDiagnosticsSession(clientId: string, options?: PtvPluginRequestOptions) {
            return requestPluginJson<void>(
                apiClient,
                `${PTV_PLUGIN_API.endpoints.remoteDiagnosticsClients}/${encodeURIComponent(clientId)}/sessions`,
                {
                    ...options,
                    method: 'DELETE'
                }
            );
        },
        requestRemoteDiagnosticsSnapshot<T = unknown>(clientId: string, options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                `${PTV_PLUGIN_API.endpoints.remoteDiagnosticsClients}/${encodeURIComponent(clientId)}/snapshot`,
                {
                    ...options,
                    body: {},
                    method: 'POST'
                }
            );
        },
        getRemoteDiagnosticsReport<T = unknown>(clientId: string, options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                `${PTV_PLUGIN_API.endpoints.remoteDiagnosticsClients}/${encodeURIComponent(clientId)}/report`,
                options
            );
        },
        getRemoteDiagnosticsReportDownloadUrl(clientId: string) {
            return getPluginUrl(
                apiClient,
                `${PTV_PLUGIN_API.endpoints.remoteDiagnosticsClients}/${encodeURIComponent(clientId)}/report/download`
            );
        },
        getSettings<T = unknown>(options?: PtvPluginRequestOptions) {
            const isObservationCurrent = captureConfiguredAuthorityObserver(apiClient);
            return requestPluginJson<T>(apiClient, PTV_PLUGIN_API.endpoints.settings, options).then(settings => {
                const rows = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).rows : null;
                if (isObservationCurrent()) observeConfiguredRowAuthority(readConfiguredPresentationAuthority(rows));
                return settings;
            }).catch(error => {
                if (isObservationCurrent()) retireConfiguredRowFreshness('settings-authority-uncertain');
                throw error;
            });
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
            const isObservationCurrent = captureConfiguredAuthorityObserver(apiClient);
            return requestPluginJson<T>(apiClient, PTV_PLUGIN_API.endpoints.rows, options)
                .catch((err: unknown) => {
                    if (!isMissingPluginEndpointError(err)) {
                        throw err;
                    }

                    return getRowsViaSettings<T>(apiClient, options);
                }).then(rows => {
                    if (isObservationCurrent()) observeConfiguredRowAuthority(readConfiguredPresentationAuthority(rows));
                    return rows;
                }).catch(error => {
                    if (isObservationCurrent()) retireConfiguredRowFreshness('rows-authority-uncertain');
                    throw error;
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
        getArrCalendarAvailability<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.arrCalendarAvailability,
                options
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
        testTmdbMetadata<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.tmdbTest,
                {
                    ...options,
                    method: 'POST'
                }
            );
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
        createSignupUser<TResponse = unknown, TRequest = unknown>(body: TRequest, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(
                apiClient,
                PTV_PLUGIN_API.endpoints.signupCreateUser,
                {
                    ...options,
                    body,
                    method: 'POST',
                    requiresAuthentication: false
                }
            );
        },
        verifySignupEmail<TResponse = unknown, TRequest = unknown>(body: TRequest, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(
                apiClient,
                PTV_PLUGIN_API.endpoints.signupVerifyEmail,
                {
                    ...options,
                    body,
                    method: 'POST',
                    requiresAuthentication: false
                }
            );
        },
        requestSignupPasswordReset<TResponse = unknown, TRequest = unknown>(body: TRequest, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(
                apiClient,
                PTV_PLUGIN_API.endpoints.signupPasswordResetRequest,
                {
                    ...options,
                    body,
                    method: 'POST',
                    requiresAuthentication: false
                }
            );
        },
        confirmSignupPasswordReset<TResponse = unknown, TRequest = unknown>(body: TRequest, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(
                apiClient,
                PTV_PLUGIN_API.endpoints.signupPasswordResetConfirm,
                {
                    ...options,
                    body,
                    method: 'POST',
                    requiresAuthentication: false
                }
            );
        },
        getSignupSettings<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.signupAdminSettings,
                options
            );
        },
        saveSignupSettings<TResponse = unknown, TRequest = unknown>(body: TRequest, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(
                apiClient,
                PTV_PLUGIN_API.endpoints.signupAdminSettings,
                {
                    ...options,
                    body,
                    method: 'POST'
                }
            );
        },
        sendSignupTestEmail<TResponse = unknown, TRequest = unknown>(body: TRequest, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(
                apiClient,
                PTV_PLUGIN_API.endpoints.signupAdminTestEmail,
                {
                    ...options,
                    body,
                    method: 'POST'
                }
            );
        },
        getSignupInvites<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.signupAdminInvites,
                options
            );
        },
        createSignupInvite<TResponse = unknown, TRequest = unknown>(body: TRequest, options?: PtvPluginRequestOptions) {
            return requestPluginJson<TResponse>(
                apiClient,
                PTV_PLUGIN_API.endpoints.signupAdminInvites,
                {
                    ...options,
                    body,
                    method: 'POST'
                }
            );
        },
        disableSignupInvite<T = unknown>(inviteId: string, options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                `${PTV_PLUGIN_API.endpoints.signupAdminInvites}/${encodeURIComponent(inviteId)}/disable`,
                {
                    ...options,
                    method: 'POST'
                }
            );
        },
        deleteSignupInvite<T = unknown>(inviteId: string, options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                `${PTV_PLUGIN_API.endpoints.signupAdminInvites}/${encodeURIComponent(inviteId)}`,
                {
                    ...options,
                    method: 'DELETE'
                }
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
        getArrCalendar<T = unknown>(options?: PtvPluginRequestOptions) {
            return requestPluginJson<T>(
                apiClient,
                PTV_PLUGIN_API.endpoints.arrCalendar,
                options
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

export function waitForCurrentPtvPluginApiClient(options: {
    signal?: AbortSignal;
    timeoutMs?: number;
} = {}): Promise<NonNullable<ReturnType<typeof getCurrentPtvPluginApiClient>>> {
    const immediateClient = getCurrentPtvPluginApiClient();

    if (immediateClient) return Promise.resolve(immediateClient);

    const timeoutMs = Math.max(0, options.timeoutMs ?? PLUGIN_API_CLIENT_WAIT_TIMEOUT_MS);

    return new Promise((resolve, reject) => {
        let intervalId: ReturnType<typeof setInterval> | null = null;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
            if (intervalId !== null) clearInterval(intervalId);
            if (timeoutId !== null) clearTimeout(timeoutId);
            Events.off(ServerConnections, 'localusersignedin', checkForClient);
            options.signal?.removeEventListener('abort', handleAbort);
        };
        const rejectUnavailable = (code: string, message: string) => {
            cleanup();
            reject(Object.assign(new Error(message), { code }));
        };
        const handleAbort = () => rejectUnavailable(
            'PTV_PLUGIN_CLIENT_WAIT_ABORTED',
            'PTV plugin API client wait was aborted.'
        );
        const checkForClient = () => {
            const client = getCurrentPtvPluginApiClient();

            if (!client) return;

            cleanup();
            resolve(client);
        };

        if (options.signal?.aborted) {
            handleAbort();
            return;
        }

        Events.on(ServerConnections, 'localusersignedin', checkForClient);
        options.signal?.addEventListener('abort', handleAbort, { once: true });
        intervalId = setInterval(checkForClient, PLUGIN_API_CLIENT_POLL_INTERVAL_MS);
        timeoutId = setTimeout(() => rejectUnavailable(
            'PTV_PLUGIN_CLIENT_WAIT_TIMEOUT',
            'PTV plugin API client did not become available before the readiness timeout.'
        ), timeoutMs);
        checkForClient();
    });
}
