import { recordPtvEvent } from '../core/observability';

import {
    incrementPtvPerformanceCounter,
    recordPtvPerformanceEntry
} from './performanceMonitor';
import { normalizePtvRouteLocation } from './runtimeStability';

type PtvCoordinatedRequestOptions = {
    endpoint?: string;
    includeAuthorization?: boolean;
    method?: string;
    source?: string;
};

type PtvInFlightRequest<T> = {
    promise: Promise<T>;
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

    if (existing) {
        deduplicatedRequests += 1;
        incrementPtvPerformanceCounter('deduplicatedRequestCount', {
            endpoint: options.endpoint || '',
            key,
            route,
            source: options.source || 'ptv-api'
        });
        return existing.promise;
    }

    const requestId = requestSequence += 1;
    const startedAt = now();

    incrementPtvPerformanceCounter('requestCount', {
        endpoint: options.endpoint || '',
        key,
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
                key,
                payloadBytes: getPayloadSize(value),
                requestId,
                route,
                source: options.source || 'ptv-api'
            }, durationMs);

            return value;
        })
        .catch(error => {
            const durationMs = Number((now() - startedAt).toFixed(1));
            const message = error instanceof Error ? error.message : String(error);

            if (/abort|cancel/i.test(message)) {
                incrementPtvPerformanceCounter('abortedRequestCount', {
                    endpoint: options.endpoint || '',
                    key,
                    requestId,
                    route
                });
            }
            if (/timeout|timed out/i.test(message)) {
                incrementPtvPerformanceCounter('timeoutCount', {
                    endpoint: options.endpoint || '',
                    key,
                    requestId,
                    route
                });
            }

            recordPtvPerformanceEntry('request', 'ptv-api-request-failed', {
                endpoint: options.endpoint || '',
                error: message,
                key,
                requestId,
                route,
                source: options.source || 'ptv-api'
            }, durationMs);
            throw error;
        })
        .finally(() => {
            const current = inFlightRequests.get(key);

            if (current?.promise === promise) {
                inFlightRequests.delete(key);
            }
        });

    inFlightRequests.set(key, {
        promise,
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
        inFlightKeys: Array.from(inFlightRequests.keys()).slice(0, 25),
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
