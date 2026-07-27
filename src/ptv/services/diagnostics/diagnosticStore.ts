import {
    PTV_CORE_CONTRACT_VERSION,
    PTV_DIAGNOSTIC_PRIVACY_SCHEMA_VERSION,
    PTV_DIAGNOSTIC_SCHEMA_VERSION,
    createPtvDiagnosticHealth,
    getPtvDiagnosticPercentile,
    type PtvBuildDiagnostic,
    type PtvCacheDiagnostic,
    type PtvCoreDiagnostic,
    type PtvDiagnosticExport,
    type PtvDiagnosticHealth,
    type PtvDiagnosticSnapshot,
    type PtvFocusChangeDiagnostic,
    type PtvFocusDiagnostic,
    type PtvFocusGraphDiagnostic,
    type PtvFocusScopeDiagnostic,
    type PtvFocusVisibilityDiagnostic,
    type PtvFrameDiagnostic,
    type PtvImageDiagnostic,
    type PtvInputDiagnostic,
    type PtvPlatformDiagnostic,
    type PtvPluginDiagnostic,
    type PtvRecommendationDiagnostic,
    type PtvRequestDiagnostic,
    type PtvRequestErrorCategory,
    type PtvRouteDiagnostic,
    type PtvServerDiagnostic,
    type PtvShelfDiagnostic
} from '../../core';
import { sanitizePtvDebugExport } from '../../modules/dashboard/debugExportSanitizer';

export const PTV_DIAGNOSTIC_RETENTION_LIMITS = Object.freeze({
    focusChanges: 200,
    focusGraphs: 50,
    focusScopes: 100,
    focusVisibility: 100,
    frames: 120,
    images: 200,
    inputs: 300,
    requests: 200,
    routes: 50,
    shelves: 100,
    warnings: 100
});

const INITIALIZATION_ORDER = [
    'environment',
    'device-identity',
    'session',
    'settings',
    'cache',
    'api',
    'diagnostics',
    'navigation',
    'playback',
    'ready'
];

type ActiveRequest = {
    activeConcurrencyAtStart: number;
    cacheClassification: string;
    method: string;
    requestFamily: string;
    requestId: string;
    routeFamily: string;
    serverOriginClassification: PtvRequestDiagnostic['serverOriginClassification'];
    startedAt: number;
    startedAtIso: string;
};

type RequestCompletion = Readonly<{
    cancellation?: boolean;
    errorCategory?: PtvRequestErrorCategory;
    responseByteEstimate?: number | null;
    status?: number | null;
    success: boolean;
    timeout?: boolean;
}>;

type DiagnosticContext = {
    build: PtvBuildDiagnostic;
    cache: PtvCacheDiagnostic;
    collectorCapabilities: Record<string, boolean>;
    core: PtvCoreDiagnostic;
    focus: PtvFocusDiagnostic;
    platform: PtvPlatformDiagnostic;
    plugin: PtvPluginDiagnostic;
    recommendations: PtvRecommendationDiagnostic;
    server: PtvServerDiagnostic;
};

function timestamp() {
    return new Date().toISOString();
}

function createId(prefix: string, sequence: number) {
    return `${prefix}-${sequence.toString(36)}`;
}

function emptyHealth(status: PtvDiagnosticHealth['status'], reason: string, lastUpdated?: string) {
    return createPtvDiagnosticHealth(status, reason, { lastUpdated });
}

function createDefaultContext(now: string): DiagnosticContext {
    return {
        build: {
            buildId: 'unknown',
            buildTimestamp: 'unknown',
            commitSha: 'unknown',
            environment: 'unknown',
            packageVersion: 'unknown'
        },
        cache: {
            ageMs: null,
            health: createPtvDiagnosticHealth('unknown', 'Cache summary has not been observed.', { lastUpdated: now }),
            itemCount: 0,
            lastErrorCategory: 'none',
            lastReadStatus: 'unknown',
            lastWriteStatus: 'unknown',
            owner: 'featured-content',
            sectionCount: 0,
            state: 'unknown',
            storageType: 'unknown',
            ttlMs: null,
            version: null
        },
        collectorCapabilities: {
            cacheSummary: false,
            frameTiming: false,
            focusGraph: false,
            focusScopes: false,
            focusVisibility: false,
            imageLifecycle: false,
            longTasks: false,
            pluginStatus: false,
            requestCoordinator: false,
            remoteInputPipeline: false,
            routeRestoration: false,
            routeLifecycle: false,
            shelfLifecycle: false,
            tvFocus: false
        },
        core: {
            activeAdapters: [],
            capabilityIdentifiers: [],
            contractVersion: PTV_CORE_CONTRACT_VERSION,
            health: createPtvDiagnosticHealth('unknown', 'Core initialization has not been observed.', { lastUpdated: now }),
            initializationOrder: INITIALIZATION_ORDER,
            initializationState: 'unknown',
            schemaVersion: 1,
            unsupportedCapabilities: []
        },
        focus: {
            candidateCount: 0,
            currentCandidatePresent: false,
            currentCategory: 'unknown',
            currentFingerprint: 'none',
            currentRoute: 'unknown',
            currentScope: 'unknown',
            currentVisible: false,
            disabledReason: 'not-observed',
            disposalCount: 0,
            duplicateListenerCount: 0,
            engineEnabled: false,
            engineRequested: false,
            enableReason: 'not-observed',
            graphRebuildCount: 0,
            health: createPtvDiagnosticHealth('unknown', 'Focus engine state has not been observed.', { lastUpdated: now }),
            initializationCount: 0,
            initializationReason: 'not-observed',
            isTv: false,
            lastRebuildReason: 'none',
            listenerInstallCount: 0
        },
        platform: {
            deviceClass: 'unknown',
            eligibilitySource: 'not-observed',
            eligibilityTimestamp: now,
            isAndroidTv: false,
            isFireTv: false,
            isTv: false,
            isWebOs: false,
            layoutMode: 'unknown',
            platform: 'unknown',
            profile: 'unknown',
            reducedMotion: false,
            userAgentClassification: 'unknown',
            visibilityState: 'unknown'
        },
        plugin: {
            apiVersion: null,
            capabilityFingerprint: 'unknown',
            capabilityIdentifiers: [],
            health: createPtvDiagnosticHealth('unknown', 'Plugin status has not been checked.', { lastUpdated: now }),
            reachable: null,
            status: 'unknown',
            version: 'unknown'
        },
        recommendations: {
            active: false,
            cacheState: 'unknown',
            configuredRows: 0,
            duplicateSuppressionCount: 0,
            generatedRows: 0,
            health: createPtvDiagnosticHealth('unknown', 'Recommendation summary has not been observed.', { lastUpdated: now }),
            itemCount: 0,
            lastErrorCategory: 'none',
            lastGenerationAt: null,
            runDurationMs: null,
            sourceCount: 0
        },
        server: {
            authenticatedSessionPresent: false,
            health: createPtvDiagnosticHealth('unknown', 'Server state has not been observed.', { lastUpdated: now }),
            lastResponseDurationMs: null,
            originClassification: 'unknown',
            reachable: null,
            version: 'unknown'
        }
    };
}

function boundedPush<T>(
    values: T[],
    value: T,
    limit: number,
    stream: string,
    dropped: Record<string, number>
) {
    values.push(value);

    if (values.length <= limit) return;

    const removed = values.length - limit;
    values.splice(0, removed);
    dropped[stream] = (dropped[stream] || 0) + removed;
}

function hashSafe(value: string) {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
}

export function normalizePtvDiagnosticRouteFamily(value = '') {
    const path = value
        .replace(/^.*#/, '')
        .split('?')[0]
        .split('#')[0]
        .replace(/\/+/g, '/')
        .toLowerCase();
    const segments = path.split('/').filter(Boolean);

    if (!segments.length) return 'home';
    if (segments[0] === 'dashboard' && segments[1] === 'piggietv') {
        return `dashboard/piggietv/${segments[2] || 'overview'}`;
    }

    const known = [
        'home', 'movies', 'shows', 'tv', 'music', 'reading', 'books', 'comics',
        'manga', 'search', 'collections', 'details', 'item', 'calendar', 'requests',
        'login', 'settings'
    ];
    const family = segments.find(segment => known.includes(segment));

    return family || 'other';
}

export function normalizePtvDiagnosticRequestFamily(value = '') {
    const normalized = value.split('?')[0].replace(/\\/g, '/').toLowerCase();
    const matchers: Array<[RegExp, string]> = [
        [/(?:plugin.*(?:status|configuration)|piggietv\/status|ptv\/v\d+\/status)/, 'Plugin status'],
        [/featured/, 'Featured content'],
        [/favoriteitems|resume/, 'Resume'],
        [/user.*views|userviews/, 'User views'],
        [/recommend/, 'Recommendations'],
        [/season/, 'Seasons'],
        [/episode/, 'Episodes'],
        [/studio/, 'Studios'],
        [/genre/, 'Genres'],
        [/collection|boxset/, 'Collections'],
        [/search/, 'Search'],
        [/image/, 'Images'],
        [/items\/[^/]+$|item.?details/, 'Item details'],
        [/items/, 'Items list']
    ];

    return matchers.find(([pattern]) => pattern.test(normalized))?.[1] || 'Other API';
}

export function classifyPtvDiagnosticError(error: unknown): PtvRequestErrorCategory {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const message = error instanceof Error ? error.message : String(record.message || error || '');
    const status = Number(record.status || record.statusCode || 0);

    if (/abort|cancel/i.test(message)) return 'cancelled';
    if (/timeout|timed out/i.test(message)) return 'timeout';
    if (status === 401 || status === 403) return 'authentication';
    if (status === 404) return 'not-found';
    if (status >= 500) return 'server';
    if (status >= 400) return 'client';
    if (/network|failed to fetch|offline/i.test(message)) return 'network';

    return 'unknown';
}

function getOverallHealth(
    context: DiagnosticContext,
    requests: PtvRequestDiagnostic[],
    frames: PtvFrameDiagnostic[],
    generatedAt: string
) {
    const statuses = [
        context.core.health.status,
        context.server.health.status,
        context.plugin.health.status,
        context.cache.health.status,
        context.recommendations.health.status,
        context.focus.health.status
    ];
    const failures = requests.filter(request => !request.success).length;
    const latestFrame = frames.at(-1);

    if (statuses.includes('failing')) {
        return emptyHealth('failing', 'One or more observed subsystems are failing.', generatedAt);
    }
    if (
        statuses.includes('degraded')
        || statuses.includes('unavailable')
        || failures > 0
        || (latestFrame?.jankyFramePercentage || 0) > 20
    ) {
        return emptyHealth('degraded', 'The client is usable, with one or more degraded signals.', generatedAt);
    }
    if (statuses.some(status => status === 'healthy')) {
        return emptyHealth('healthy', 'Observed client subsystems are operating normally.', generatedAt);
    }

    return emptyHealth('unknown', 'Not enough observations are available yet.', generatedAt);
}

export function createPtvDiagnosticStore() {
    const createdAt = timestamp();
    let context = createDefaultContext(createdAt);
    let collectorEnabled = true;
    let resetCount = 0;
    let sessionSequence = 1;
    let eventSequence = 0;
    let peakConcurrency = 0;
    let pendingFocusRestorationStartedAt: number | null = null;
    let lastUiRenderDurationMs: number | null = null;
    let sessionStartedAt = createdAt;
    let diagnosticSessionId = `diagnostic-1-${hashSafe(createdAt)}`;
    const subscribers = new Set<() => void>();
    const activeRequests = new Map<string, ActiveRequest>();
    const requests: PtvRequestDiagnostic[] = [];
    const routes: PtvRouteDiagnostic[] = [];
    const focusChanges: PtvFocusChangeDiagnostic[] = [];
    const focusGraphs: PtvFocusGraphDiagnostic[] = [];
    const focusScopes: PtvFocusScopeDiagnostic[] = [];
    const focusVisibility: PtvFocusVisibilityDiagnostic[] = [];
    const frames: PtvFrameDiagnostic[] = [];
    const inputs: PtvInputDiagnostic[] = [];
    const images: PtvImageDiagnostic[] = [];
    const shelves: PtvShelfDiagnostic[] = [];
    const warnings: string[] = [];
    const dropped: Record<string, number> = {};
    const eventCounts: Record<string, number> = {};

    const count = (stream: string) => {
        eventCounts[stream] = (eventCounts[stream] || 0) + 1;
    };
    const publish = () => subscribers.forEach(listener => {
        listener();
    });
    const record = <T>(stream: string, target: T[], value: T, limit: number) => {
        if (!collectorEnabled) return;
        boundedPush(target, value, limit, stream, dropped);
        count(stream);
        publish();
    };

    function getSnapshot(generatedAt = timestamp()): PtvDiagnosticSnapshot {
        const droppedTotal = Object.values(dropped).reduce((sum, value) => sum + value, 0);
        const estimatedStoreBytes = requests.length * 260
            + routes.length * 310
            + focusChanges.length * 190
            + focusGraphs.length * 520
            + focusScopes.length * 210
            + focusVisibility.length * 220
            + frames.length * 230
            + inputs.length * 360
            + images.length * 150
            + shelves.length * 150
            + warnings.join('').length * 2;

        return {
            build: context.build,
            cache: context.cache,
            collectorCapabilities: { ...context.collectorCapabilities },
            contractVersion: PTV_CORE_CONTRACT_VERSION,
            core: context.core,
            diagnosticSessionId,
            droppedEvents: {
                byStream: { ...dropped },
                collectorOverload: 0,
                retentionTrimmed: droppedTotal,
                total: droppedTotal
            },
            focusChanges: [...focusChanges],
            focusGraphs: [...focusGraphs],
            focusScopes: [...focusScopes],
            focusVisibility: [...focusVisibility],
            frames: [...frames],
            generatedAt,
            health: getOverallHealth(context, requests, frames, generatedAt),
            images: [...images],
            inputs: [...inputs],
            latestFocus: context.focus,
            platform: context.platform,
            plugin: context.plugin,
            privacyClassification: 'local-only',
            recommendations: context.recommendations,
            requests: [...requests],
            retentionLimits: PTV_DIAGNOSTIC_RETENTION_LIMITS,
            routes: [...routes],
            schemaVersion: PTV_DIAGNOSTIC_SCHEMA_VERSION,
            self: {
                collectorEnabled,
                estimatedStoreBytes,
                eventCounts: {
                    ...eventCounts,
                    activeRequests: activeRequests.size,
                    peakConcurrency
                },
                lastUiRenderDurationMs,
                subscriberCount: subscribers.size
            },
            server: context.server,
            session: {
                collectorEnabled,
                diagnosticSessionId,
                resetCount,
                startedAt: sessionStartedAt
            },
            shelves: [...shelves],
            warnings: [...warnings]
        };
    }

    return {
        beginRequest(options: Readonly<{
            cacheClassification?: string;
            endpoint?: string;
            method?: string;
            route?: string;
            serverOriginClassification?: PtvRequestDiagnostic['serverOriginClassification'];
        }>) {
            if (!collectorEnabled) return '';

            const requestId = createId('request', ++eventSequence);
            const startedAt = Date.now();
            const active: ActiveRequest = {
                activeConcurrencyAtStart: activeRequests.size + 1,
                cacheClassification: options.cacheClassification || 'network',
                method: (options.method || 'GET').toUpperCase(),
                requestFamily: normalizePtvDiagnosticRequestFamily(options.endpoint),
                requestId,
                routeFamily: normalizePtvDiagnosticRouteFamily(options.route || window.location.hash),
                serverOriginClassification: options.serverOriginClassification || 'remote-server',
                startedAt,
                startedAtIso: new Date(startedAt).toISOString()
            };

            activeRequests.set(requestId, active);
            peakConcurrency = Math.max(peakConcurrency, activeRequests.size);
            count('request-starts');
            publish();

            return requestId;
        },
        completeRequest(requestId: string, completion: RequestCompletion) {
            const active = activeRequests.get(requestId);

            if (!active) return;

            activeRequests.delete(requestId);
            const endedAt = Date.now();
            record('requests', requests, {
                activeConcurrencyAtStart: active.activeConcurrencyAtStart,
                cacheClassification: active.cacheClassification,
                cancellation: completion.cancellation === true,
                coordinatorHit: false,
                durationMs: Number(Math.max(0, endedAt - active.startedAt).toFixed(1)),
                endedAt: new Date(endedAt).toISOString(),
                errorCategory: completion.errorCategory || (completion.success ? 'none' : 'unknown'),
                method: active.method,
                requestFamily: active.requestFamily,
                requestId,
                responseByteEstimate: completion.responseByteEstimate ?? null,
                routeFamily: active.routeFamily,
                serverOriginClassification: active.serverOriginClassification,
                startedAt: active.startedAtIso,
                status: completion.status ?? null,
                success: completion.success,
                timeout: completion.timeout === true
            }, PTV_DIAGNOSTIC_RETENTION_LIMITS.requests);
        },
        recordCoordinatorHit(options: Readonly<{ endpoint?: string; method?: string; route?: string }>) {
            const occurredAt = timestamp();

            record('requests', requests, {
                activeConcurrencyAtStart: activeRequests.size,
                cacheClassification: 'coalesced',
                cancellation: false,
                coordinatorHit: true,
                durationMs: 0,
                endedAt: occurredAt,
                errorCategory: 'none',
                method: (options.method || 'GET').toUpperCase(),
                requestFamily: normalizePtvDiagnosticRequestFamily(options.endpoint),
                requestId: createId('request', ++eventSequence),
                responseByteEstimate: null,
                routeFamily: normalizePtvDiagnosticRouteFamily(options.route || window.location.hash),
                serverOriginClassification: 'remote-server',
                startedAt: occurredAt,
                status: null,
                success: true,
                timeout: false
            }, PTV_DIAGNOSTIC_RETENTION_LIMITS.requests);
        },
        startRoute(route: string) {
            const now = timestamp();
            const previous = routes.at(-1);

            if (previous && !previous.cleanupCompletedAt) {
                routes[routes.length - 1] = {
                    ...previous,
                    cleanupCompletedAt: now,
                    status: previous.status === 'active' ? 'abandoned' : previous.status
                };
            }

            const routeSessionId = createId('route', ++eventSequence);
            record('routes', routes, {
                activeRequestsAtSettle: null,
                cleanupCompletedAt: null,
                firstContentAt: null,
                firstDirectionalMovementAt: null,
                firstFocusableAt: null,
                focusGraphReadyAt: null,
                focusLossCount: 0,
                focusRestorationDurationMs: null,
                focusRestorationStatus: 'not-observed',
                initialFocusAt: null,
                imagesPendingAtSettle: null,
                initializedAt: null,
                navigationToFirstContentMs: null,
                navigationToFirstDirectionalMovementMs: null,
                navigationToFocusableMs: null,
                navigationToGraphReadyMs: null,
                navigationToInitialFocusMs: null,
                navigationToSettledMs: null,
                recognizedAt: now,
                requestedAt: now,
                routeFamily: normalizePtvDiagnosticRouteFamily(route),
                routeSessionId,
                settledAt: null,
                shelvesPendingAtSettle: null,
                status: 'active'
            }, PTV_DIAGNOSTIC_RETENTION_LIMITS.routes);

            return routeSessionId;
        },
        markRoutePhase(
            routeSessionId: string,
            phase: 'cleanup-completed' | 'first-content' | 'first-focusable' | 'initialized' | 'settled'
        ) {
            const index = routes.findIndex(route => route.routeSessionId === routeSessionId);

            if (index < 0) return;

            const route = routes[index];
            const occurredAt = timestamp();
            const elapsedMs = Math.max(0, Date.parse(occurredAt) - Date.parse(route.requestedAt));
            const imagesPending = Math.max(
                0,
                images.filter(image => image.status === 'requested').length
                - images.filter(image => image.status === 'loaded' || image.status === 'errored').length
            );
            const shelvesPending = Math.max(
                0,
                shelves.filter(shelf => shelf.status === 'request-started').length
                - shelves.filter(shelf => (
                    shelf.status === 'settled'
                    || shelf.status === 'disposed'
                    || shelf.status === 'failed'
                    || shelf.status === 'empty'
                )).length
            );
            const next: PtvRouteDiagnostic = {
                ...route,
                ...(phase === 'initialized' ? { initializedAt: occurredAt } : {}),
                ...(phase === 'first-content' ? {
                    firstContentAt: occurredAt,
                    navigationToFirstContentMs: elapsedMs
                } : {}),
                ...(phase === 'first-focusable' ? {
                    firstFocusableAt: occurredAt,
                    navigationToFocusableMs: elapsedMs
                } : {}),
                ...(phase === 'settled' ? {
                    activeRequestsAtSettle: activeRequests.size,
                    imagesPendingAtSettle: imagesPending,
                    navigationToSettledMs: elapsedMs,
                    settledAt: occurredAt,
                    shelvesPendingAtSettle: shelvesPending,
                    status: 'settled' as const
                } : {}),
                ...(phase === 'cleanup-completed' ? { cleanupCompletedAt: occurredAt } : {})
            };

            routes[index] = next;
            count('route-phases');
            publish();
        },
        recordFrame(frame: PtvFrameDiagnostic) {
            record('frames', frames, frame, PTV_DIAGNOSTIC_RETENTION_LIMITS.frames);
        },
        recordFocusChange(change: PtvFocusChangeDiagnostic) {
            record('focusChanges', focusChanges, change, PTV_DIAGNOSTIC_RETENTION_LIMITS.focusChanges);
        },
        recordFocusGraph(graph: PtvFocusGraphDiagnostic) {
            record('focusGraphs', focusGraphs, graph, PTV_DIAGNOSTIC_RETENTION_LIMITS.focusGraphs);
        },
        recordFocusScope(scope: PtvFocusScopeDiagnostic) {
            record('focusScopes', focusScopes, scope, PTV_DIAGNOSTIC_RETENTION_LIMITS.focusScopes);
        },
        recordFocusVisibility(visibility: PtvFocusVisibilityDiagnostic) {
            record('focusVisibility', focusVisibility, visibility, PTV_DIAGNOSTIC_RETENTION_LIMITS.focusVisibility);
        },
        markRouteFocusPhase(
            phase: 'first-directional-movement' | 'focus-graph-ready' | 'focus-lost' | 'initial-focus' | 'restoration-failed' | 'restoration-started' | 'restored'
        ) {
            if (phase === 'restoration-started') {
                pendingFocusRestorationStartedAt = Date.now();
            }

            const index = routes.length - 1;

            if (index < 0) return;

            const route = routes[index];
            const occurredAt = timestamp();
            const elapsedMs = Math.max(0, Date.parse(occurredAt) - Date.parse(route.requestedAt));
            const restorationDurationMs = pendingFocusRestorationStartedAt === null ?
                null :
                Math.max(0, Date.now() - pendingFocusRestorationStartedAt);

            routes[index] = {
                ...route,
                ...(phase === 'focus-graph-ready' && !route.focusGraphReadyAt ? {
                    focusGraphReadyAt: occurredAt,
                    navigationToGraphReadyMs: elapsedMs
                } : {}),
                ...(phase === 'initial-focus' && !route.initialFocusAt ? {
                    initialFocusAt: occurredAt,
                    navigationToInitialFocusMs: elapsedMs
                } : {}),
                ...(phase === 'first-directional-movement' && !route.firstDirectionalMovementAt ? {
                    firstDirectionalMovementAt: occurredAt,
                    navigationToFirstDirectionalMovementMs: elapsedMs
                } : {}),
                ...(phase === 'focus-lost' ? {
                    focusLossCount: route.focusLossCount + 1
                } : {}),
                ...(phase === 'restoration-started' ? {
                    focusRestorationStatus: 'pending' as const
                } : {}),
                ...(phase === 'restored' ? {
                    focusRestorationDurationMs: restorationDurationMs,
                    focusRestorationStatus: 'restored' as const
                } : {}),
                ...(phase === 'restoration-failed' ? {
                    focusRestorationDurationMs: restorationDurationMs,
                    focusRestorationStatus: 'failed' as const
                } : {})
            };

            if (phase === 'restored' || phase === 'restoration-failed') {
                pendingFocusRestorationStartedAt = null;
            }
            count('route-focus-phases');
            publish();
        },
        setFocus(focus: PtvFocusDiagnostic) {
            if (!collectorEnabled) return;
            context.focus = focus;
            count('focus');
            publish();
        },
        recordInput(input: PtvInputDiagnostic) {
            record('inputs', inputs, input, PTV_DIAGNOSTIC_RETENTION_LIMITS.inputs);
        },
        recordImage(image: Omit<PtvImageDiagnostic, 'eventId'>) {
            record('images', images, {
                ...image,
                eventId: createId('image', ++eventSequence)
            }, PTV_DIAGNOSTIC_RETENTION_LIMITS.images);
        },
        recordShelf(shelf: Omit<PtvShelfDiagnostic, 'eventId'>) {
            record('shelves', shelves, {
                ...shelf,
                eventId: createId('shelf', ++eventSequence)
            }, PTV_DIAGNOSTIC_RETENTION_LIMITS.shelves);
        },
        addWarning(warning: string) {
            const safeWarning = warning.toLowerCase().replace(/[^a-z0-9 _:-]/g, '').slice(0, 120);

            record('warnings', warnings, safeWarning || 'unspecified diagnostic warning', PTV_DIAGNOSTIC_RETENTION_LIMITS.warnings);
        },
        updateContext(changes: Partial<DiagnosticContext>) {
            context = {
                ...context,
                ...changes
            };
            publish();
        },
        setCollectorCapability(name: string, available: boolean) {
            context.collectorCapabilities[name] = available;
            publish();
        },
        setCollectorEnabled(enabled: boolean) {
            collectorEnabled = enabled;
            publish();
        },
        recordUiRenderDuration(durationMs: number) {
            lastUiRenderDurationMs = Number(Math.max(0, durationMs).toFixed(1));
        },
        getRequestSummary() {
            const durations = requests.filter(request => !request.coordinatorHit).map(request => request.durationMs);

            return {
                active: activeRequests.size,
                coalesced: requests.filter(request => request.coordinatorHit).length,
                failures: requests.filter(request => !request.success).length,
                p50Ms: getPtvDiagnosticPercentile(durations, 0.5),
                p90Ms: getPtvDiagnosticPercentile(durations, 0.9),
                p95Ms: getPtvDiagnosticPercentile(durations, 0.95),
                peakConcurrency,
                timeouts: requests.filter(request => request.timeout).length,
                total: requests.length
            };
        },
        getSnapshot,
        createExport(options: { generatedAt?: string } = {}) {
            const generatedAt = options.generatedAt || timestamp();
            const snapshot = {
                ...getSnapshot(generatedAt),
                generatedAt,
                privacyClassification: 'share-safe' as const
            };
            const sanitized = sanitizePtvDebugExport(snapshot) as Record<string, unknown>;
            const report = sanitized.sanitization as Record<string, number>;
            delete sanitized.sanitization;

            return {
                ...sanitized,
                privacy: {
                    guarantees: [
                        'No authentication tokens, cookies, request bodies, or response bodies.',
                        'No complete URLs, query strings, private hosts, user IDs, media IDs, titles, filenames, local paths, SQL, or private stack traces.',
                        'Event histories are bounded, local-only, and exported only on demand.'
                    ],
                    redactionCounts: {
                        identifiers: report.redactedIdentifiers || 0,
                        paths: report.redactedPaths || 0,
                        secrets: report.redactedFields || 0,
                        truncated: (report.truncatedArrays || 0)
                            + (report.truncatedDepth || 0)
                            + (report.truncatedObjects || 0)
                            + (report.truncatedStrings || 0),
                        urls: report.redactedUrls || 0
                    },
                    schemaVersion: PTV_DIAGNOSTIC_PRIVACY_SCHEMA_VERSION
                },
                privacyClassification: 'share-safe'
            } as unknown as PtvDiagnosticExport;
        },
        resetSession() {
            activeRequests.clear();
            requests.length = 0;
            routes.length = 0;
            focusChanges.length = 0;
            focusGraphs.length = 0;
            focusScopes.length = 0;
            focusVisibility.length = 0;
            frames.length = 0;
            inputs.length = 0;
            images.length = 0;
            shelves.length = 0;
            warnings.length = 0;
            Object.keys(dropped).forEach(key => {
                delete dropped[key];
            });
            Object.keys(eventCounts).forEach(key => {
                delete eventCounts[key];
            });
            peakConcurrency = 0;
            pendingFocusRestorationStartedAt = null;
            resetCount += 1;
            sessionSequence += 1;
            sessionStartedAt = timestamp();
            diagnosticSessionId = `diagnostic-${sessionSequence}-${hashSafe(sessionStartedAt)}`;
            publish();
        },
        subscribe(listener: () => void) {
            subscribers.add(listener);

            return () => {
                subscribers.delete(listener);
            };
        }
    };
}

export type PtvDiagnosticStore = ReturnType<typeof createPtvDiagnosticStore>;

let diagnosticStore: PtvDiagnosticStore | null = null;

export function getPtvDiagnosticStore() {
    diagnosticStore ||= createPtvDiagnosticStore();

    return diagnosticStore;
}

export function resetPtvDiagnosticStoreForTests() {
    diagnosticStore = null;
}
