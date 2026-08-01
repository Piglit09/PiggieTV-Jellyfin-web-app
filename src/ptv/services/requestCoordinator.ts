import { recordPtvEvent } from '../core/observability';
import { createPtvAbortController } from '../core/abortController';

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
    signal?: AbortSignal;
    source?: string;
};

type PtvInFlightRequest<T> = {
    abortController: AbortController;
    abortableConsumers: Set<symbol>;
    diagnosticRequestId: string;
    hasUnabortableConsumer: boolean;
    promise: Promise<T>;
    reportKey: string;
    startedAt: number;
};

type PtvRequestCoordinatorWindow = Window & {
    PTV?: Record<string, unknown> & {
        requestCoordinator?: {
            report: typeof getPtvRequestCoordinatorReport;
        };
    };
};

const inFlightRequests = new Map<string, PtvInFlightRequest<unknown>>();
const recentDurations: number[] = [];
let requestSequence = 0;
let deduplicatedRequests = 0;
let abortedConsumers = 0;
let retiredRequests = 0;

function now() {
    return performance.now();
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

    if (current?.promise === request.promise) {
        inFlightRequests.delete(key);
    }

    if (!request.abortController.signal.aborted) {
        retiredRequests += 1;
        request.abortController.abort();
    }
}

function attachPtvRequestConsumer<T>(
    key: string,
    request: PtvInFlightRequest<T>,
    signal?: AbortSignal
): Promise<T> {
    if (!signal) {
        request.hasUnabortableConsumer = true;
        return request.promise;
    }

    if (signal.aborted) {
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

    const existing = inFlightRequests.get(key) as PtvInFlightRequest<T> | undefined;
    const route = normalizePtvRouteLocation().routeKey;
    const diagnosticKey = options.diagnosticKey || key;

    if (existing) {
        deduplicatedRequests += 1;
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
        diagnosticRequestId,
        hasUnabortableConsumer: false,
        promise: undefined as unknown as Promise<T>,
        reportKey: diagnosticKey,
        startedAt
    };
    const taskPromise = invokePtvCoordinatedTask(task, abortController.signal);

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

            return value;
        })
        .catch(error => {
            const durationMs = Number((now() - startedAt).toFixed(1));
            const message = error instanceof Error ? error.message : String(error);

            if (/abort|cancel/i.test(message)) {
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
            const errorRecord = error && typeof error === 'object' ? error as Record<string, unknown> : {};
            const coreError = errorRecord.coreError && typeof errorRecord.coreError === 'object' ?
                errorRecord.coreError as Record<string, unknown> :
                {};
            const status = Number(errorRecord.status || errorRecord.statusCode || coreError.httpStatus) || null;

            getPtvDiagnosticStore().completeRequest(diagnosticRequestId, {
                cancellation: category === 'cancelled',
                errorCategory: category,
                status,
                success: false,
                timeout: category === 'timeout'
            });
            throw error;
        })
        .finally(() => {
            const current = inFlightRequests.get(key);

            if (current?.promise === promise) {
                inFlightRequests.delete(key);
            }
        });

    request.promise = promise;
    inFlightRequests.set(key, request as PtvInFlightRequest<unknown>);

    return attachPtvRequestConsumer(key, request, options.signal);
}

export function getPtvRequestCoordinatorReport() {
    const sortedDurations = [...recentDurations].sort((left, right) => left - right);
    const p95Index = sortedDurations.length ? Math.floor((sortedDurations.length - 1) * 0.95) : 0;

    return {
        abortedConsumers,
        deduplicatedRequests,
        inFlightCount: inFlightRequests.size,
        inFlightKeys: Array.from(inFlightRequests.values()).map(request => request.reportKey).slice(0, 25),
        p95DurationMs: sortedDurations[p95Index] || 0,
        requestSequence,
        retiredRequests
    };
}

function installRequestCoordinatorNamespace() {
    const root = (window as PtvRequestCoordinatorWindow).PTV || ((window as PtvRequestCoordinatorWindow).PTV = {});

    root.requestCoordinator = {
        report: getPtvRequestCoordinatorReport
    };

    recordPtvEvent('api', 'ptv-request-coordinator-installed', {
        source: 'runtime-stability'
    });
}

installRequestCoordinatorNamespace();
