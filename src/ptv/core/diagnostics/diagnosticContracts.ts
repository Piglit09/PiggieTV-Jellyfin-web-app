import {
    PTV_CORE_CONTRACT_VERSION,
    type PtvCoreContractVersion,
    type PtvCorePlatform
} from '../contracts/version';

export const PTV_DIAGNOSTIC_SCHEMA_VERSION = 1 as const;
export const PTV_DIAGNOSTIC_PRIVACY_SCHEMA_VERSION = 1 as const;

export type PtvDiagnosticSchemaVersion = typeof PTV_DIAGNOSTIC_SCHEMA_VERSION;
export type PtvDiagnosticHealthStatus =
    | 'degraded'
    | 'failing'
    | 'healthy'
    | 'unavailable'
    | 'unknown'
    | 'unsupported';
export type PtvDiagnosticPrivacyClassification = 'local-only' | 'share-safe';
export type PtvDiagnosticMetricValue = boolean | number | string | null;

export type PtvDiagnosticHealth = Readonly<{
    collectorAvailable: boolean;
    lastUpdated: string;
    metrics: Readonly<Record<string, PtvDiagnosticMetricValue>>;
    reason: string;
    status: PtvDiagnosticHealthStatus;
    warnings: readonly string[];
}>;

export type PtvDiagnosticSession = Readonly<{
    collectorEnabled: boolean;
    diagnosticSessionId: string;
    resetCount: number;
    startedAt: string;
}>;

export type PtvBuildDiagnostic = Readonly<{
    buildId: string;
    buildTimestamp: string;
    commitSha: string;
    environment: 'development' | 'production' | 'unknown';
    packageVersion: string;
}>;

export type PtvPlatformDiagnostic = Readonly<{
    deviceClass: string;
    eligibilitySource: string;
    eligibilityTimestamp: string;
    isAndroidTv: boolean;
    isFireTv: boolean;
    isTv: boolean;
    isWebOs: boolean;
    layoutMode: string;
    platform: PtvCorePlatform;
    profile: string;
    reducedMotion: boolean;
    userAgentClassification: 'android-tv' | 'desktop' | 'fire-tv' | 'generic-tv' | 'mobile' | 'webos' | 'unknown';
    visibilityState: 'hidden' | 'visible' | 'unknown';
}>;

export type PtvCoreDiagnostic = Readonly<{
    activeAdapters: readonly string[];
    capabilityIdentifiers: readonly string[];
    contractVersion: PtvCoreContractVersion;
    health: PtvDiagnosticHealth;
    initializationOrder: readonly string[];
    initializationState: 'degraded' | 'failed' | 'initializing' | 'ready' | 'unknown';
    schemaVersion: number;
    unsupportedCapabilities: readonly string[];
}>;

export type PtvServerDiagnostic = Readonly<{
    authenticatedSessionPresent: boolean;
    health: PtvDiagnosticHealth;
    lastResponseDurationMs: number | null;
    originClassification: 'remote-server' | 'same-origin' | 'unknown';
    reachable: boolean | null;
    version: string;
}>;

export type PtvPluginDiagnostic = Readonly<{
    apiVersion: number | null;
    capabilityFingerprint: string;
    capabilityIdentifiers: readonly string[];
    health: PtvDiagnosticHealth;
    reachable: boolean | null;
    status: string;
    version: string;
}>;

export type PtvRouteLifecyclePhase =
    | 'abandoned'
    | 'cleanup-completed'
    | 'first-content'
    | 'first-focusable'
    | 'initialized'
    | 'recognized'
    | 'requested'
    | 'settled';

export type PtvRouteDiagnostic = Readonly<{
    activeRequestsAtSettle: number | null;
    cleanupCompletedAt: string | null;
    firstContentAt: string | null;
    firstDirectionalMovementAt: string | null;
    firstFocusableAt: string | null;
    focusGraphReadyAt: string | null;
    focusLossCount: number;
    focusRestorationDurationMs: number | null;
    focusRestorationStatus: 'failed' | 'not-observed' | 'pending' | 'restored';
    initialFocusAt: string | null;
    imagesPendingAtSettle: number | null;
    initializedAt: string | null;
    navigationToFirstContentMs: number | null;
    navigationToFirstDirectionalMovementMs: number | null;
    navigationToFocusableMs: number | null;
    navigationToGraphReadyMs: number | null;
    navigationToInitialFocusMs: number | null;
    navigationToSettledMs: number | null;
    recognizedAt: string | null;
    requestedAt: string;
    routeFamily: string;
    routeSessionId: string;
    settledAt: string | null;
    shelvesPendingAtSettle: number | null;
    status: 'abandoned' | 'active' | 'settled';
}>;

export type PtvRequestErrorCategory =
    | 'authentication'
    | 'cancelled'
    | 'client'
    | 'network'
    | 'none'
    | 'not-found'
    | 'server'
    | 'timeout'
    | 'unknown';

export type PtvRequestDiagnostic = Readonly<{
    activeConcurrencyAtStart: number;
    cacheClassification: string;
    cancellation: boolean;
    coordinatorHit: boolean;
    durationMs: number;
    endedAt: string;
    errorCategory: PtvRequestErrorCategory;
    method: string;
    requestFamily: string;
    requestId: string;
    responseByteEstimate: number | null;
    routeFamily: string;
    serverOriginClassification: 'plugin' | 'remote-server' | 'same-origin' | 'unknown';
    startedAt: string;
    status: number | null;
    success: boolean;
    timeout: boolean;
}>;

export type PtvFrameDiagnostic = Readonly<{
    approximateFps: number;
    collectorOverheadMs: number;
    frameCount: number;
    jankyFrameCount: number;
    jankyFramePercentage: number;
    longestFrameMs: number;
    longTaskCount: number;
    p50FrameMs: number;
    p90FrameMs: number;
    p95FrameMs: number;
    p99FrameMs: number;
    reducedMotion: boolean;
    routeFamily: string;
    sampledAt: string;
    visibilityState: 'hidden' | 'visible';
}>;

export type PtvFocusElementCategory =
    | 'button'
    | 'dialog-control'
    | 'hero-action'
    | 'media-card'
    | 'menu-item'
    | 'nav-item'
    | 'player-control'
    | 'unknown';

export type PtvFocusScopeCategory =
    | 'context-menu'
    | 'dropdown-menu'
    | 'full-screen-music-player'
    | 'main-content'
    | 'modal-dialog'
    | 'navigation'
    | 'player-controls'
    | 'settings-panel'
    | 'unknown';

export type PtvFocusRegionClass =
    | 'above'
    | 'below'
    | 'left'
    | 'offscreen'
    | 'overlapping'
    | 'right'
    | 'unknown';

export type PtvSafeRemoteAction =
    | 'back'
    | 'color-key'
    | 'down'
    | 'enter'
    | 'left'
    | 'menu'
    | 'play-pause'
    | 'right'
    | 'unknown'
    | 'up';

export type PtvRemoteInputSource =
    | 'android-tv-profile'
    | 'fire-tv-profile'
    | 'keyboard'
    | 'synthetic-test'
    | 'webos-remote';

export type PtvRemoteInputStage =
    | 'action-resolved'
    | 'browser-event-received'
    | 'completed'
    | 'current-candidate-resolved'
    | 'event-classified'
    | 'focus-event-observed'
    | 'focus-handler-reached'
    | 'focus-movement-requested'
    | 'handler-rejected'
    | 'key-normalized'
    | 'movement-confirmed'
    | 'movement-timed-out'
    | 'platform-mapping-applied'
    | 'target-found'
    | 'target-rejected'
    | 'target-search-started';

export type PtvFocusMovementResult =
    | 'confirmed'
    | 'failed'
    | 'not-applicable'
    | 'not-attempted'
    | 'pending'
    | 'timed-out';

export type PtvInputDelayClassification =
    | 'browser-focus-application'
    | 'input-handling'
    | 'render-frame-delay'
    | 'route-instability'
    | 'scroll'
    | 'target-search'
    | 'unknown';

export type PtvFocusDiagnostic = Readonly<{
    candidateCount: number;
    currentCandidatePresent: boolean;
    currentCategory: PtvFocusElementCategory;
    currentFingerprint: string;
    currentRoute: string;
    currentScope: PtvFocusScopeCategory;
    currentVisible: boolean;
    disabledReason: string;
    disposalCount: number;
    duplicateListenerCount: number;
    engineEnabled: boolean;
    engineRequested: boolean;
    enableReason: string;
    graphRebuildCount: number;
    health: PtvDiagnosticHealth;
    initializationCount: number;
    initializationReason: string;
    isTv: boolean;
    lastRebuildReason: string;
    listenerInstallCount: number;
}>;

export type PtvInputDiagnostic = Readonly<{
    activeRequests: number;
    currentCandidateResolved: boolean;
    defaultPreventedAfter: boolean;
    defaultPreventedBefore: boolean;
    delayClassification: PtvInputDelayClassification;
    direction: 'down' | 'left' | 'right' | 'up' | 'unknown';
    elapsedMs: number;
    eventPhase: 'capture' | 'target' | 'unknown';
    eventType: 'keydown' | 'keyup';
    failureReason: string;
    frameP95Ms: number;
    handlerReached: boolean;
    inputId: string;
    movementAttempted: boolean;
    movementResult: PtvFocusMovementResult;
    movementSucceeded: boolean;
    nextFocusFingerprint: string;
    occurredAt: string;
    pendingImages: number;
    pendingShelves: number;
    previousFocusFingerprint: string;
    propagationStopped: boolean;
    repeat: boolean;
    repeatCount: number;
    routeFamily: string;
    routeSettled: boolean;
    safeAction: PtvSafeRemoteAction;
    source: PtvRemoteInputSource;
    stage: PtvRemoteInputStage;
    stageSequence: number;
    targetCategory: PtvFocusElementCategory;
    targetCandidateFound: boolean;
}>;

export type PtvFocusGraphDiagnostic = Readonly<{
    activeScope: PtvFocusScopeCategory;
    buildDurationMs: number;
    candidateCountByCategory: Readonly<Record<PtvFocusElementCategory, number>>;
    containerCount: number;
    currentCandidatePresent: boolean;
    currentRegion: PtvFocusRegionClass;
    enabledCount: number;
    generatedAt: string;
    generation: number;
    lastRebuildReason: string;
    nearestCandidateCategories: Readonly<Record<'down' | 'left' | 'right' | 'up', PtvFocusElementCategory>>;
    nearestCandidateFingerprints: Readonly<Record<'down' | 'left' | 'right' | 'up', string>>;
    offscreenCount: number;
    rejectedByReason: Readonly<{
        blockedByModal: number;
        detached: number;
        disabled: number;
        hidden: number;
        outsideActiveScope: number;
        zeroSize: number;
    }>;
    routeFamily: string;
    totalCandidateCount: number;
    visibleCount: number;
}>;

export type PtvFocusChangeDiagnostic = Readonly<{
    candidatePresent: boolean;
    category: PtvFocusElementCategory;
    fingerprint: string;
    inputId: string;
    occurredAt: string;
    previousCategory: PtvFocusElementCategory;
    reason: string;
    routeFamily: string;
    scope: PtvFocusScopeCategory;
    visible: boolean;
}>;

export type PtvFocusScopeDiagnostic = Readonly<{
    candidateCount: number;
    initialFocusedCategory: PtvFocusElementCategory;
    leakedFocusOutsideScope: boolean;
    occurredAt: string;
    orphanedAfterRouteChange: boolean;
    previousFocusRestored: boolean | null;
    routeFamily: string;
    scope: PtvFocusScopeCategory;
    status: 'activated' | 'back-or-close' | 'closed' | 'opened' | 'orphaned';
    trapActive: boolean;
}>;

export type PtvFocusVisibilityDiagnostic = Readonly<{
    detachedDuringAnimation: boolean;
    focusMovedBeforeScrollSettled: boolean;
    focusToVisibleDurationMs: number | null;
    focusedCategory: PtvFocusElementCategory;
    inputId: string;
    obscuredBy: 'fixed-header' | 'modal' | 'overlay' | 'player' | 'unknown' | 'unobscured';
    occurredAt: string;
    routeFamily: string;
    scrollContainer: PtvFocusScopeCategory;
    status: 'focus-observed' | 'scroll-settled' | 'scroll-started';
    visible: boolean;
    virtualizedNodeReplaced: boolean;
}>;

export type PtvImageRole = 'avatar' | 'backdrop' | 'logo' | 'poster' | 'thumbnail' | 'unknown';
export type PtvImageDiagnostic = Readonly<{
    cacheClassification: string;
    decodeDurationMs: number | null;
    durationMs: number | null;
    eventId: string;
    fallbackUsed: boolean;
    occurredAt: string;
    role: PtvImageRole;
    routeFamily: string;
    status: 'errored' | 'loaded' | 'requested';
}>;

export type PtvShelfDiagnostic = Readonly<{
    durationMs: number | null;
    eventId: string;
    itemCount: number | null;
    occurredAt: string;
    routeFamily: string;
    shelfFamily: string;
    status:
        | 'configured'
        | 'data-returned'
        | 'disposed'
        | 'empty'
        | 'failed'
        | 'first-card-visible'
        | 'render-started'
        | 'request-started'
        | 'settled';
}>;

export type PtvCacheDiagnostic = Readonly<{
    ageMs: number | null;
    health: PtvDiagnosticHealth;
    itemCount: number;
    lastErrorCategory: string;
    lastReadStatus: string;
    lastWriteStatus: string;
    owner: string;
    sectionCount: number;
    state: 'fresh' | 'stale' | 'unknown';
    storageType: string;
    ttlMs: number | null;
    version: number | null;
}>;

export type PtvRecommendationDiagnostic = Readonly<{
    active: boolean;
    cacheState: string;
    configuredRows: number;
    duplicateSuppressionCount: number;
    generatedRows: number;
    health: PtvDiagnosticHealth;
    itemCount: number;
    lastErrorCategory: string;
    lastGenerationAt: string | null;
    runDurationMs: number | null;
    sourceCount: number;
}>;

export type PtvDiagnosticRetentionLimits = Readonly<{
    focusChanges: number;
    focusGraphs: number;
    focusScopes: number;
    focusVisibility: number;
    frames: number;
    images: number;
    inputs: number;
    requests: number;
    routes: number;
    shelves: number;
    warnings: number;
}>;

export type PtvDiagnosticDroppedEvents = Readonly<{
    byStream: Readonly<Record<string, number>>;
    collectorOverload: number;
    retentionTrimmed: number;
    total: number;
}>;

export type PtvDiagnosticSelfDiagnostic = Readonly<{
    collectorEnabled: boolean;
    eventCounts: Readonly<Record<string, number>>;
    estimatedStoreBytes: number;
    lastUiRenderDurationMs: number | null;
    subscriberCount: number;
}>;

export type PtvDiagnosticSnapshot = Readonly<{
    build: PtvBuildDiagnostic;
    cache: PtvCacheDiagnostic;
    collectorCapabilities: Readonly<Record<string, boolean>>;
    contractVersion: PtvCoreContractVersion;
    core: PtvCoreDiagnostic;
    diagnosticSessionId: string;
    droppedEvents: PtvDiagnosticDroppedEvents;
    focusChanges: readonly PtvFocusChangeDiagnostic[];
    focusGraphs: readonly PtvFocusGraphDiagnostic[];
    focusScopes: readonly PtvFocusScopeDiagnostic[];
    focusVisibility: readonly PtvFocusVisibilityDiagnostic[];
    frames: readonly PtvFrameDiagnostic[];
    generatedAt: string;
    health: PtvDiagnosticHealth;
    images: readonly PtvImageDiagnostic[];
    inputs: readonly PtvInputDiagnostic[];
    latestFocus: PtvFocusDiagnostic;
    platform: PtvPlatformDiagnostic;
    plugin: PtvPluginDiagnostic;
    privacyClassification: PtvDiagnosticPrivacyClassification;
    recommendations: PtvRecommendationDiagnostic;
    requests: readonly PtvRequestDiagnostic[];
    retentionLimits: PtvDiagnosticRetentionLimits;
    routes: readonly PtvRouteDiagnostic[];
    schemaVersion: PtvDiagnosticSchemaVersion;
    self: PtvDiagnosticSelfDiagnostic;
    server: PtvServerDiagnostic;
    session: PtvDiagnosticSession;
    shelves: readonly PtvShelfDiagnostic[];
    warnings: readonly string[];
}>;

export type PtvDiagnosticRedactionCounts = Readonly<{
    identifiers: number;
    paths: number;
    secrets: number;
    truncated: number;
    urls: number;
}>;

export type PtvDiagnosticExport = PtvDiagnosticSnapshot & Readonly<{
    privacy: {
        guarantees: readonly string[];
        redactionCounts: PtvDiagnosticRedactionCounts;
        schemaVersion: typeof PTV_DIAGNOSTIC_PRIVACY_SCHEMA_VERSION;
    };
    privacyClassification: 'share-safe';
}>;

export function createPtvDiagnosticHealth(
    status: PtvDiagnosticHealthStatus,
    reason: string,
    options: Readonly<{
        collectorAvailable?: boolean;
        lastUpdated?: string;
        metrics?: Readonly<Record<string, PtvDiagnosticMetricValue>>;
        warnings?: readonly string[];
    }> = {}
): PtvDiagnosticHealth {
    return {
        collectorAvailable: options.collectorAvailable ?? !['unavailable', 'unsupported'].includes(status),
        lastUpdated: options.lastUpdated || new Date().toISOString(),
        metrics: options.metrics || {},
        reason,
        status,
        warnings: options.warnings || []
    };
}

export function getPtvDiagnosticPercentile(values: readonly number[], percentile: number): number {
    const finite = values.filter(Number.isFinite).sort((left, right) => left - right);

    if (!finite.length) return 0;

    const boundedPercentile = Math.min(1, Math.max(0, percentile));
    const index = Math.ceil(boundedPercentile * finite.length) - 1;

    return Number(finite[Math.max(0, index)].toFixed(1));
}

export function getPtvDiagnosticContractMetadata() {
    return {
        contractVersion: PTV_CORE_CONTRACT_VERSION,
        privacySchemaVersion: PTV_DIAGNOSTIC_PRIVACY_SCHEMA_VERSION,
        schemaVersion: PTV_DIAGNOSTIC_SCHEMA_VERSION
    };
}
