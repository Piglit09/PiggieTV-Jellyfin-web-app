import { ServerConnections } from 'lib/jellyfin-apiclient';

import { recordPtvEvent } from '../core/observability';
import { createPtvAbortController } from '../core/abortController';
import Events from '../../utils/events';

import {
    incrementPtvPerformanceCounter,
    recordPtvPerformanceEntry
} from './performanceMonitor';
import { normalizePtvRouteLocation } from './runtimeStability';
import {
    classifyPtvDiagnosticError,
    getPtvDiagnosticStore
} from './diagnostics/diagnosticStore';

type PtvCoordinatedRequestOptions = {
    diagnosticKey?: string;
    endpoint?: string;
    includeAuthorization?: boolean;
    method?: string;
    reuseSuccessfulForMs?: number;
    signal?: AbortSignal;
    source?: string;
};

type PtvInFlightRequest<T> = {
    abortController: AbortController;
    abortableConsumers: Set<symbol>;
    consumerCount: number;
    diagnosticRequestId: string;
    hasUnabortableConsumer: boolean;
    promise: Promise<T>;
    reuseTimer: number | null;
    reuseUntil: number;
    retiring: boolean;
    settled: boolean;
    startedAt: number;
    successful: boolean;
    validationIdentityGeneration: number;
    validationInvalidated: boolean;
    validationRouteScope: string;
    validationTracked: boolean;
};

type PtvRequestLedgerTerminalOutcome = 'aborted' | 'failed' | 'settled';

type PtvRequestLedgerTerminal = {
    expiresAt: number;
    identityGeneration: number;
    invalidated: boolean;
    outcome: PtvRequestLedgerTerminalOutcome;
    reuseUntil: number;
    routeScope: string;
};

type PtvRequestLedgerState = {
    aborted: number;
    active: number;
    admitted: number;
    concurrentExactDuplicates: number;
    failed: number;
    failedReplacementHandoffs: number;
    identityGeneration: number;
    invalidated: number;
    peakActive: number;
    peakExactTransportOwnership: number;
    retired: number;
    routeGeneration: number;
    sequentialSuccessfulDuplicates: number;
    settled: number;
    sharedInFlight: number;
    staleRejected: number;
    successfulBoundedReuse: number;
    visibleRetries: number;
};

type PtvRequestCoordinatorWindow = Window & {
    PTV?: Record<string, unknown> & {
        requestCoordinator?: {
            report: typeof getPtvRequestCoordinatorReport;
        };
        requestLedger?: {
            report: typeof getPtvRequestValidationLedgerReport;
            reset: typeof resetPtvRequestValidationLedger;
        };
        routeController?: {
            getState?: () => {
                routeGeneration?: number;
            };
        };
    };
};

const inFlightRequests = new Map<string, PtvInFlightRequest<unknown>>();
const recentDurations: number[] = [];
const validationActiveExactTransports = new Map<string, number>();
const validationTerminalRequests = new Map<string, PtvRequestLedgerTerminal>();
const VALIDATION_TERMINAL_LIMIT = 250;
const VALIDATION_FAILED_HANDOFF_WINDOW_MS = 30_000;
let requestSequence = 0;
let deduplicatedRequests = 0;
let abortedConsumers = 0;
let abortedRequests = 0;
let retiredRequests = 0;
let retirementWaits = 0;
let cacheReusedRequests = 0;
let failedRequests = 0;
let peakConsumerCount = 0;
let settledRequests = 0;
let validationAdapterInstalled = false;
let validationAuthorizationIdentity = '';
let validationIdentityState: 'signed-in' | 'signed-out' | 'unknown' = 'unknown';
const validationLedger: PtvRequestLedgerState = {
    aborted: 0,
    active: 0,
    admitted: 0,
    concurrentExactDuplicates: 0,
    failed: 0,
    failedReplacementHandoffs: 0,
    identityGeneration: 0,
    invalidated: 0,
    peakActive: 0,
    peakExactTransportOwnership: 0,
    retired: 0,
    routeGeneration: 0,
    sequentialSuccessfulDuplicates: 0,
    settled: 0,
    sharedInFlight: 0,
    staleRejected: 0,
    successfulBoundedReuse: 0,
    visibleRetries: 0
};

function now() {
    return performance.now();
}

function isLoopbackHostname(hostname: string) {
    return [
        '127.0.0.1',
        '::1',
        '[::1]',
        'localhost'
    ].includes(String(hostname || '').toLowerCase());
}

export function isPtvRequestValidationLedgerEnabled() {
    if (
        typeof __PTV_ACCEPTANCE_LEDGER__ === 'undefined'
        || __PTV_ACCEPTANCE_LEDGER__ !== true
        || !isLoopbackHostname(window.location.hostname)
    ) return false;

    return /(?:^|[?&])ptvAcceptanceLedger=1(?:&|$)/.test(window.location.search);
}

function incrementPtvRequestValidationCounter(counter: keyof PtvRequestLedgerState) {
    if (!isPtvRequestValidationLedgerEnabled()) return;

    validationLedger[counter] += 1;
}

export function classifyPtvRequestLedgerAdmission(input: Readonly<{
    explicitlyInvalidated: boolean;
    identityCompatible: boolean;
    now: number;
    previousOutcome: PtvRequestLedgerTerminalOutcome;
    reuseUntil: number;
    routeCompatible: boolean;
}>) {
    if (
        input.explicitlyInvalidated
        || !input.identityCompatible
        || !input.routeCompatible
    ) return 'none' as const;

    if (input.previousOutcome === 'failed') return 'failed-replacement' as const;
    if (input.previousOutcome === 'settled' && input.reuseUntil > input.now) {
        return 'sequential-successful-duplicate' as const;
    }

    return 'none' as const;
}

function prunePtvRequestValidationTerminals(at: number) {
    validationTerminalRequests.forEach((request, key) => {
        if (request.expiresAt <= at) validationTerminalRequests.delete(key);
    });

    while (validationTerminalRequests.size > VALIDATION_TERMINAL_LIMIT) {
        const oldestKey = validationTerminalRequests.keys().next().value;

        if (oldestKey === undefined) break;
        validationTerminalRequests.delete(oldestKey);
    }
}

function beginPtvRequestValidationTransport(
    key: string,
    routeScope: string
) {
    if (!isPtvRequestValidationLedgerEnabled()) return false;

    const admittedAt = now();

    prunePtvRequestValidationTerminals(admittedAt);

    const previous = validationTerminalRequests.get(key);

    if (previous) {
        const classification = classifyPtvRequestLedgerAdmission({
            explicitlyInvalidated: previous.invalidated,
            identityCompatible: previous.identityGeneration === validationLedger.identityGeneration,
            now: admittedAt,
            previousOutcome: previous.outcome,
            reuseUntil: previous.reuseUntil,
            routeCompatible: previous.routeScope === routeScope
        });

        if (classification === 'failed-replacement') {
            validationLedger.failedReplacementHandoffs += 1;
        } else if (classification === 'sequential-successful-duplicate') {
            validationLedger.sequentialSuccessfulDuplicates += 1;
        }
    }

    const activeForExactKey = (validationActiveExactTransports.get(key) || 0) + 1;

    validationActiveExactTransports.set(key, activeForExactKey);
    validationLedger.active += 1;
    validationLedger.admitted += 1;
    validationLedger.peakActive = Math.max(validationLedger.peakActive, validationLedger.active);
    validationLedger.peakExactTransportOwnership = Math.max(
        validationLedger.peakExactTransportOwnership,
        activeForExactKey
    );
    if (activeForExactKey > 1) validationLedger.concurrentExactDuplicates += 1;

    return true;
}

function finishPtvRequestValidationTransport(
    key: string,
    request: PtvInFlightRequest<unknown>,
    outcome: PtvRequestLedgerTerminalOutcome
) {
    if (!request.validationTracked) return;

    const settledAt = now();
    const activeForExactKey = Math.max(0, (validationActiveExactTransports.get(key) || 0) - 1);

    if (activeForExactKey > 0) {
        validationActiveExactTransports.set(key, activeForExactKey);
    } else {
        validationActiveExactTransports.delete(key);
    }

    validationLedger.active = Math.max(0, validationLedger.active - 1);
    validationLedger[outcome] += 1;

    const expiresAt = outcome === 'failed' ?
        settledAt + VALIDATION_FAILED_HANDOFF_WINDOW_MS :
        request.reuseUntil;

    if (expiresAt > settledAt) {
        validationTerminalRequests.delete(key);
        validationTerminalRequests.set(key, {
            expiresAt,
            identityGeneration: request.validationIdentityGeneration,
            invalidated: request.validationInvalidated,
            outcome,
            reuseUntil: request.reuseUntil,
            routeScope: request.validationRouteScope
        });
        prunePtvRequestValidationTerminals(settledAt);
    } else {
        validationTerminalRequests.delete(key);
    }
}

export function recordPtvRequestLedgerStaleRejected() {
    if (!isPtvRequestValidationLedgerEnabled()) return false;

    validationLedger.staleRejected += 1;
    return true;
}

export function recordPtvRequestLedgerVisibleRetry() {
    if (!isPtvRequestValidationLedgerEnabled()) return false;

    validationLedger.visibleRetries += 1;
    return true;
}

export function recordPtvRequestLedgerRouteGeneration(value: unknown) {
    if (!isPtvRequestValidationLedgerEnabled()) return false;

    const generation = Number(value);

    if (!Number.isSafeInteger(generation) || generation < 0) return false;

    validationLedger.routeGeneration = generation;
    return true;
}

function recordPtvRequestLedgerAuthorizationIdentity(authorizationIdentity: string) {
    if (!isPtvRequestValidationLedgerEnabled()) return false;

    const nextIdentity = String(authorizationIdentity || '');

    if (!nextIdentity || /^pending-\d+$/.test(nextIdentity)) return false;
    if (validationAuthorizationIdentity === nextIdentity) return false;

    if (validationIdentityState === 'signed-in' && !validationAuthorizationIdentity) {
        validationAuthorizationIdentity = nextIdentity;
        return false;
    }

    validationAuthorizationIdentity = nextIdentity;
    validationIdentityState = 'signed-in';
    validationLedger.identityGeneration += 1;
    return true;
}

function recordPtvRequestLedgerIdentityState(signedIn: boolean) {
    if (!isPtvRequestValidationLedgerEnabled()) return false;

    const nextState = signedIn ? 'signed-in' : 'signed-out';

    if (validationIdentityState === nextState) return false;

    validationIdentityState = nextState;
    validationAuthorizationIdentity = '';
    validationLedger.identityGeneration += 1;
    return true;
}

export function recordPtvRequestLedgerIdentityRetired() {
    return recordPtvRequestLedgerIdentityState(false);
}

async function invokePtvCoordinatedTask<T>(
    task: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal
) {
    return task(signal);
}

function getPayloadSize(value: unknown) {
    try {
        return JSON.stringify(value).length;
    } catch {
        return 0;
    }
}

export function getPtvRequestCoordinatorKey(
    method: string,
    url: string,
    includeAuthorization = true,
    authorizationIdentity = ''
) {
    let authorizationScope = 'anon';

    if (includeAuthorization) {
        recordPtvRequestLedgerAuthorizationIdentity(authorizationIdentity);
        authorizationScope = authorizationIdentity ? `auth:${authorizationIdentity}` : 'auth';
    }

    return [
        method.toUpperCase(),
        authorizationScope,
        url
    ].join(' ');
}

function createPtvCoordinatorAbortError() {
    const error = new Error('PTV request consumer was cancelled.');

    error.name = 'AbortError';
    return error;
}

function retirePtvInFlightRequest<T>(
    key: string,
    request: PtvInFlightRequest<T>
) {
    const current = inFlightRequests.get(key);

    if (current?.promise !== request.promise || request.retiring) return;

    request.retiring = true;

    if (!request.abortController.signal.aborted) {
        retiredRequests += 1;
        if (request.validationTracked) validationLedger.retired += 1;
        request.abortController.abort();
    }
}

function waitForPtvRequestRetirement<T>(
    request: PtvInFlightRequest<T>,
    retry: () => Promise<T>,
    signal?: AbortSignal
) {
    retirementWaits += 1;

    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const detach = () => signal?.removeEventListener('abort', onAbort);
        const onAbort = () => {
            if (settled) return;

            settled = true;
            abortedConsumers += 1;
            detach();
            reject(createPtvCoordinatorAbortError());
        };

        signal?.addEventListener('abort', onAbort, { once: true });
        void request.promise
            .catch(() => undefined)
            .then(() => {
                if (settled) return;

                settled = true;
                detach();

                if (signal?.aborted) {
                    abortedConsumers += 1;
                    reject(createPtvCoordinatorAbortError());
                    return;
                }

                void retry().then(resolve, reject);
            });
    });
}

function attachPtvRequestConsumer<T>(
    key: string,
    request: PtvInFlightRequest<T>,
    signal?: AbortSignal
): Promise<T> {
    request.consumerCount += 1;
    peakConsumerCount = Math.max(peakConsumerCount, request.consumerCount);

    if (!signal) {
        request.hasUnabortableConsumer = true;
        request.promise.then(
            () => {
                request.consumerCount = Math.max(0, request.consumerCount - 1);
            },
            () => {
                request.consumerCount = Math.max(0, request.consumerCount - 1);
            }
        );
        return request.promise;
    }

    if (signal.aborted) {
        request.consumerCount = Math.max(0, request.consumerCount - 1);
        if (!request.hasUnabortableConsumer && request.abortableConsumers.size === 0) {
            retirePtvInFlightRequest(key, request);
        }

        return Promise.reject(createPtvCoordinatorAbortError());
    }

    const consumer = Symbol(key);

    request.abortableConsumers.add(consumer);

    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const detach = () => {
            signal.removeEventListener('abort', onAbort);
            request.abortableConsumers.delete(consumer);
            request.consumerCount = Math.max(0, request.consumerCount - 1);
        };
        const onAbort = () => {
            if (settled) return;

            settled = true;
            abortedConsumers += 1;
            detach();
            reject(createPtvCoordinatorAbortError());

            if (!request.hasUnabortableConsumer && request.abortableConsumers.size === 0) {
                retirePtvInFlightRequest(key, request);
            }
        };

        signal.addEventListener('abort', onAbort, { once: true });
        request.promise.then(
            value => {
                if (settled) return;

                settled = true;
                detach();
                resolve(value);
            },
            error => {
                if (settled) return;

                settled = true;
                detach();
                reject(error);
            }
        );
    });
}

export function coordinatePtvJsonRequest<T>(
    key: string,
    task: (signal: AbortSignal) => Promise<T>,
    options: PtvCoordinatedRequestOptions = {}
): Promise<T> {
    if (options.signal?.aborted) {
        abortedConsumers += 1;
        return Promise.reject(createPtvCoordinatorAbortError());
    }

    let existing = inFlightRequests.get(key) as PtvInFlightRequest<T> | undefined;
    const route = normalizePtvRouteLocation().routeKey;
    const diagnosticKey = options.diagnosticKey || key;

    if (existing?.settled && (!existing.successful || existing.reuseUntil <= now())) {
        if (existing.reuseTimer !== null) window.clearTimeout(existing.reuseTimer);
        inFlightRequests.delete(key);
        existing = undefined;
    }

    if (existing) {
        if (existing.retiring) {
            return waitForPtvRequestRetirement(
                existing,
                () => coordinatePtvJsonRequest(key, task, options),
                options.signal
            );
        }

        if (existing.settled && existing.successful) {
            cacheReusedRequests += 1;
            incrementPtvRequestValidationCounter('successfulBoundedReuse');
            return attachPtvRequestConsumer(key, existing, options.signal);
        }

        deduplicatedRequests += 1;
        incrementPtvRequestValidationCounter('sharedInFlight');
        getPtvDiagnosticStore().recordCoordinatorHit({
            endpoint: options.endpoint,
            method: options.method,
            route
        });
        incrementPtvPerformanceCounter('deduplicatedRequestCount', {
            endpoint: options.endpoint || '',
            key: diagnosticKey,
            route,
            source: options.source || 'ptv-api'
        });
        return attachPtvRequestConsumer(key, existing, options.signal);
    }

    const requestId = requestSequence += 1;
    const startedAt = now();
    const reuseSuccessfulForMs = Math.min(30_000, Math.max(0, Number(options.reuseSuccessfulForMs) || 0));
    const abortController = createPtvAbortController();
    const diagnosticRequestId = getPtvDiagnosticStore().beginRequest({
        cacheClassification: 'coordinated-network',
        endpoint: options.endpoint,
        method: options.method,
        route
    });

    incrementPtvPerformanceCounter('requestCount', {
        endpoint: options.endpoint || '',
        key: diagnosticKey,
        route,
        source: options.source || 'ptv-api'
    });

    const request: PtvInFlightRequest<T> = {
        abortController,
        abortableConsumers: new Set<symbol>(),
        consumerCount: 0,
        diagnosticRequestId,
        hasUnabortableConsumer: false,
        promise: undefined as unknown as Promise<T>,
        reuseTimer: null,
        reuseUntil: 0,
        retiring: false,
        settled: false,
        startedAt,
        successful: false,
        validationIdentityGeneration: validationLedger.identityGeneration,
        validationInvalidated: false,
        validationRouteScope: route,
        validationTracked: false
    };
    request.validationTracked = beginPtvRequestValidationTransport(key, route);
    const taskPromise = invokePtvCoordinatedTask(task, abortController.signal);
    let validationOutcome: PtvRequestLedgerTerminalOutcome = 'failed';

    const promise: Promise<T> = taskPromise
        .then(value => {
            const durationMs = Number((now() - startedAt).toFixed(1));

            recentDurations.push(durationMs);
            while (recentDurations.length > 100) recentDurations.shift();

            recordPtvPerformanceEntry('request', 'ptv-api-request-complete', {
                endpoint: options.endpoint || '',
                key: diagnosticKey,
                payloadBytes: getPayloadSize(value),
                requestId,
                route,
                source: options.source || 'ptv-api'
            }, durationMs);
            getPtvDiagnosticStore().completeRequest(diagnosticRequestId, {
                responseByteEstimate: getPayloadSize(value),
                status: null,
                success: true
            });
            request.settled = true;
            request.successful = !request.retiring;
            request.reuseUntil = request.retiring ? 0 : now() + reuseSuccessfulForMs;
            settledRequests += 1;
            validationOutcome = 'settled';

            return value;
        })
        .catch(error => {
            const durationMs = Number((now() - startedAt).toFixed(1));
            const message = error instanceof Error ? error.message : String(error);
            const errorName = error instanceof Error ? error.name : '';

            if (/abort|cancel/i.test(`${errorName} ${message}`)) {
                incrementPtvPerformanceCounter('abortedRequestCount', {
                    endpoint: options.endpoint || '',
                    key: diagnosticKey,
                    requestId,
                    route
                });
            }
            if (/timeout|timed out/i.test(message)) {
                incrementPtvPerformanceCounter('timeoutCount', {
                    endpoint: options.endpoint || '',
                    key: diagnosticKey,
                    requestId,
                    route
                });
            }

            recordPtvPerformanceEntry('request', 'ptv-api-request-failed', {
                endpoint: options.endpoint || '',
                error: message,
                key: diagnosticKey,
                requestId,
                route,
                source: options.source || 'ptv-api'
            }, durationMs);
            const category = classifyPtvDiagnosticError(error);
            const cancelled = category === 'cancelled' || /abort|cancel/i.test(errorName);
            const errorRecord = error && typeof error === 'object' ? error as Record<string, unknown> : {};
            const coreError = errorRecord.coreError && typeof errorRecord.coreError === 'object' ?
                errorRecord.coreError as Record<string, unknown> :
                {};
            const status = Number(errorRecord.status || errorRecord.statusCode || coreError.httpStatus) || null;

            getPtvDiagnosticStore().completeRequest(diagnosticRequestId, {
                cancellation: cancelled,
                errorCategory: cancelled ? 'cancelled' : category,
                status,
                success: false,
                timeout: category === 'timeout'
            });
            request.settled = true;
            if (cancelled) {
                abortedRequests += 1;
                validationOutcome = 'aborted';
            } else {
                failedRequests += 1;
                validationOutcome = 'failed';
            }
            throw error;
        })
        .finally(() => {
            finishPtvRequestValidationTransport(
                key,
                request as PtvInFlightRequest<unknown>,
                validationOutcome
            );
            const current = inFlightRequests.get(key);

            if (current?.promise === promise) {
                if (request.successful && request.reuseUntil > now()) {
                    request.reuseTimer = window.setTimeout(() => {
                        if (inFlightRequests.get(key)?.promise === promise) {
                            inFlightRequests.delete(key);
                        }
                    }, Math.max(0, request.reuseUntil - now()));
                } else {
                    inFlightRequests.delete(key);
                }
            }
        });

    request.promise = promise;
    inFlightRequests.set(key, request as PtvInFlightRequest<unknown>);

    return attachPtvRequestConsumer(key, request, options.signal);
}

export function invalidatePtvCoordinatedRequest(key: string) {
    const request = inFlightRequests.get(key);

    if (!request) return false;

    if (request.validationTracked && !request.validationInvalidated) {
        request.validationInvalidated = true;
        validationLedger.invalidated += 1;
        validationTerminalRequests.delete(key);
    }

    if (request.reuseTimer !== null) window.clearTimeout(request.reuseTimer);
    if (request.settled) {
        inFlightRequests.delete(key);
    } else {
        retirePtvInFlightRequest(key, request);
    }

    return true;
}

export function getPtvRequestCoordinatorReport() {
    const sortedDurations = [...recentDurations].sort((left, right) => left - right);
    const p95Index = sortedDurations.length ? Math.floor((sortedDurations.length - 1) * 0.95) : 0;

    return {
        abortedConsumers,
        abortedRequests,
        activeConsumerCount: Array.from(inFlightRequests.values())
            .filter(request => !request.settled)
            .reduce((count, request) => count + request.consumerCount, 0),
        cacheReusedRequests,
        deduplicatedRequests,
        failedRequests,
        inFlightCount: Array.from(inFlightRequests.values()).filter(request => !request.settled).length,
        p95DurationMs: sortedDurations[p95Index] || 0,
        peakConsumerCount,
        requestSequence,
        retainedSuccessfulCount: Array.from(inFlightRequests.values())
            .filter(request => request.settled && request.successful && request.reuseUntil > now()).length,
        retiredRequests,
        retirementWaits,
        retiringCount: Array.from(inFlightRequests.values()).filter(request => !request.settled && request.retiring).length,
        settledRequests
    };
}

export function getPtvRequestValidationLedgerReport() {
    return {
        aborted: validationLedger.aborted,
        active: validationLedger.active,
        admitted: validationLedger.admitted,
        concurrentExactDuplicates: validationLedger.concurrentExactDuplicates,
        failed: validationLedger.failed,
        failedReplacementHandoffs: validationLedger.failedReplacementHandoffs,
        identityGeneration: validationLedger.identityGeneration,
        invalidated: validationLedger.invalidated,
        peakActive: validationLedger.peakActive,
        peakExactTransportOwnership: validationLedger.peakExactTransportOwnership,
        retired: validationLedger.retired,
        routeGeneration: validationLedger.routeGeneration,
        sequentialSuccessfulDuplicates: validationLedger.sequentialSuccessfulDuplicates,
        settled: validationLedger.settled,
        sharedInFlight: validationLedger.sharedInFlight,
        staleRejected: validationLedger.staleRejected,
        successfulBoundedReuse: validationLedger.successfulBoundedReuse,
        visibleRetries: validationLedger.visibleRetries
    };
}

export function resetPtvRequestValidationLedger() {
    if (!isPtvRequestValidationLedgerEnabled() || validationLedger.active !== 0) return false;

    const identityGeneration = validationLedger.identityGeneration;
    const routeGeneration = validationLedger.routeGeneration;

    Object.assign(validationLedger, {
        aborted: 0,
        active: 0,
        admitted: 0,
        concurrentExactDuplicates: 0,
        failed: 0,
        failedReplacementHandoffs: 0,
        identityGeneration,
        invalidated: 0,
        peakActive: 0,
        peakExactTransportOwnership: 0,
        retired: 0,
        routeGeneration,
        sequentialSuccessfulDuplicates: 0,
        settled: 0,
        sharedInFlight: 0,
        staleRejected: 0,
        successfulBoundedReuse: 0,
        visibleRetries: 0
    });
    validationActiveExactTransports.clear();
    validationTerminalRequests.clear();

    return true;
}

export function installPtvRequestValidationLedger() {
    if (validationAdapterInstalled || !isPtvRequestValidationLedgerEnabled()) return false;

    validationAdapterInstalled = true;
    const root = (window as PtvRequestCoordinatorWindow).PTV || ((window as PtvRequestCoordinatorWindow).PTV = {});

    root.requestCoordinator = {
        report: getPtvRequestCoordinatorReport
    };
    root.requestLedger = {
        report: getPtvRequestValidationLedgerReport,
        reset: resetPtvRequestValidationLedger
    };

    let initiallySignedIn = false;

    try {
        initiallySignedIn = Boolean(ServerConnections.currentApiClient()?.isLoggedIn?.());
    } catch {
        initiallySignedIn = false;
    }

    validationIdentityState = initiallySignedIn ? 'unknown' : 'signed-out';
    if (initiallySignedIn) recordPtvRequestLedgerIdentityState(true);
    Events.on(ServerConnections, 'localusersignedin', () => {
        recordPtvRequestLedgerIdentityState(true);
    });
    Events.on(ServerConnections, 'localusersignedout', () => {
        recordPtvRequestLedgerIdentityState(false);
    });

    const initialRouteGeneration = root.routeController?.getState?.().routeGeneration;

    recordPtvRequestLedgerRouteGeneration(initialRouteGeneration);
    window.addEventListener('ptv:routecontrollerchange', event => {
        const detail = (event as CustomEvent<{ routeGeneration?: number }>).detail;

        recordPtvRequestLedgerRouteGeneration(detail?.routeGeneration);
    });
    recordPtvEvent('api', 'ptv-request-coordinator-installed', {
        acceptanceLedger: true,
        source: 'runtime-stability'
    });

    return true;
}

installPtvRequestValidationLedger();
