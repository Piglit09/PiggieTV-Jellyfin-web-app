import { recordPtvEvent } from '../core/observability';

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
    source?: string;
};

type PtvInFlightRequest<T> = {
    diagnosticRequestId: string;
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

function now() {
    return performance.now();
}

function getPayloadSize(value: unknown) {
    try {
        return JSON.stringify(value).length;
    } catch {
        return 0;
    }
}

export function getPtvRequestCoordinatorKey(method: string, url: string, includeAuthorization = true) {
    return [
        method.toUpperCase(),
        includeAuthorization ? 'auth' : 'anon',
        url
    ].join(' ');
}

export function coordinatePtvJsonRequest<T>(
    key: string,
    task: () => Promise<T>,
    options: PtvCoordinatedRequestOptions = {}
): Promise<T> {
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
        return existing.promise;
    }

    const requestId = requestSequence += 1;
    const startedAt = now();
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

    const promise = task()
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

    inFlightRequests.set(key, {
        diagnosticRequestId,
        promise,
        reportKey: diagnosticKey,
        startedAt
    });

    return promise;
}

export function getPtvRequestCoordinatorReport() {
    const sortedDurations = [...recentDurations].sort((left, right) => left - right);
    const p95Index = sortedDurations.length ? Math.floor((sortedDurations.length - 1) * 0.95) : 0;

    return {
        deduplicatedRequests,
        inFlightCount: inFlightRequests.size,
        inFlightKeys: Array.from(inFlightRequests.values()).map(request => request.reportKey).slice(0, 25),
        p95DurationMs: sortedDurations[p95Index] || 0,
        requestSequence
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
