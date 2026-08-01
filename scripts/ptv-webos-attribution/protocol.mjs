export const ATTRIBUTION_SCHEMA_VERSION = 1;
export const ATTRIBUTION_ENDPOINT = '/_ptv-attribution/events';
export const ATTRIBUTION_OBSERVER_PATH = '/_ptv-attribution/observer.js';
export const MAX_ATTRIBUTION_BODY_BYTES = 8 * 1024;

export const ATTRIBUTION_CATEGORIES = Object.freeze([
    'app-launch',
    'document-start',
    'runtime-created',
    'route-family',
    'video-started',
    'controls-visible',
    'back-received',
    'back-owner',
    'controls-hide-requested',
    'playback-exit-requested',
    'beforeunload',
    'pagehide',
    'visibilitychange',
    'unload',
    'error-category',
    'unhandled-rejection-category',
    'document-recreated',
    'renderer-disconnected',
    'app-manager-state',
    'heartbeat'
]);

const CATEGORY_SET = new Set(ATTRIBUTION_CATEGORIES);
const ENVELOPE_KEYS = new Set([
    'category',
    'data',
    'documentGeneration',
    'documentMs',
    'documentSeq',
    'schemaVersion',
    'state',
    'validationSession'
]);
const SESSION_PATTERN = /^validation-[0-9a-f]{32}$/u;

const READY_STATES = new Set(['complete', 'interactive', 'loading', 'unknown']);
const VISIBILITY_STATES = new Set(['hidden', 'prerender', 'unloaded', 'unknown', 'visible']);
const ROUTE_FAMILIES = new Set([
    'details',
    'home',
    'login',
    'movies',
    'music',
    'other',
    'playback',
    'settings',
    'shows',
    'unknown'
]);
const BACK_OWNERS = new Set([
    'full-screen-music',
    'input-manager',
    'route-history',
    'transient-layer',
    'unknown',
    'video-controls',
    'video-playback'
]);
const ERROR_CATEGORIES = new Set([
    'error',
    'media-error',
    'range-error',
    'reference-error',
    'resource-error',
    'syntax-error',
    'type-error',
    'unknown'
]);
const VIDEO_STATES = new Set(['play', 'playing']);
const CONTROL_STATES = new Set(['hidden', 'visible']);
const CONTROL_HIDE_SOURCES = new Set(['ptv-focus-owner', 'show-video-osd']);
const DOCUMENT_VISIBILITY_STATES = new Set(['hidden', 'prerender', 'unknown', 'visible']);
const BACK_RECEIVED_STATES = new Set(['bubble', 'capture', 'command', 'final', 'focus-pipeline']);
const DIRECT_BACK_STATES = new Set(['bubble', 'capture', 'command', 'final']);
const PIPELINE_STAGES = new Set([
    'action-resolved',
    'browser-event-received',
    'completed',
    'current-candidate-resolved',
    'event-classified',
    'focus-event-observed',
    'focus-handler-reached',
    'focus-movement-requested',
    'handler-rejected',
    'key-normalized',
    'movement-confirmed',
    'movement-timed-out',
    'platform-mapping-applied',
    'target-found',
    'target-rejected',
    'target-search-started'
]);
const BACK_STAGES = new Set(['bubble', 'capture', 'command', 'final', ...PIPELINE_STAGES]);
const DOCUMENT_STATES = new Set(['observer-installed', 'served']);
const DISCONNECT_STATES = new Set(['heartbeat-timeout']);
const APP_MANAGER_STATES = new Set(['restarted', 'running', 'stopped', 'unknown']);
const APP_LAUNCH_STATES = new Set(['started']);
const RUNTIME_STATES = new Set(['not-ready', 'ready']);
const OBSERVATION_STATES = new Set(['observed']);
const PLAYBACK_EXIT_STATES = new Set(['observed']);
const PAGEHIDE_STATES = new Set(['non-persisted', 'persisted']);
const HEARTBEAT_STATES = new Set(['alive']);
const HISTORY_CLASSES = new Set(['multiple', 'single', 'unknown']);
const INPUT_SOURCES = new Set([
    'android-tv-profile',
    'fire-tv-profile',
    'input-manager',
    'keyboard',
    'synthetic-test',
    'unknown',
    'webos-remote'
]);
const ROUTE_SOURCES = new Set(['controller', 'hashchange', 'initial', 'popstate']);
const PRESENTATION_CATEGORIES = new Set([
    'audio-fullscreen',
    'audio-mini',
    'idle',
    'transitioning',
    'unavailable',
    'video-paused-controls-visible',
    'video-playing-controls-hidden',
    'video-playing-controls-visible'
]);
const FOCUS_CATEGORIES = new Set([
    'body',
    'none',
    'outside-video',
    'video-back',
    'video-other',
    'video-play-pause',
    'video-seek'
]);
const CATEGORY_STATES = new Map([
    ['app-launch', APP_LAUNCH_STATES],
    ['document-start', DOCUMENT_STATES],
    ['runtime-created', RUNTIME_STATES],
    ['route-family', ROUTE_FAMILIES],
    ['video-started', VIDEO_STATES],
    ['controls-visible', CONTROL_STATES],
    ['back-received', BACK_RECEIVED_STATES],
    ['back-owner', BACK_OWNERS],
    ['controls-hide-requested', OBSERVATION_STATES],
    ['playback-exit-requested', PLAYBACK_EXIT_STATES],
    ['beforeunload', OBSERVATION_STATES],
    ['pagehide', PAGEHIDE_STATES],
    ['visibilitychange', DOCUMENT_VISIBILITY_STATES],
    ['unload', OBSERVATION_STATES],
    ['error-category', ERROR_CATEGORIES],
    ['unhandled-rejection-category', ERROR_CATEGORIES],
    ['document-recreated', DOCUMENT_STATES],
    ['renderer-disconnected', DISCONNECT_STATES],
    ['app-manager-state', APP_MANAGER_STATES],
    ['heartbeat', HEARTBEAT_STATES]
]);
const STATE_DATA_MATCHERS = new Map([
    ['runtime-created', (state, data) => (state === 'ready') === data.runtimeReady],
    ['route-family', (state, data) => state === data.routeFamily],
    ['visibilitychange', (state, data) => state === data.visibilityState],
    ['pagehide', (state, data) => (state === 'persisted') === data.persisted],
    ['back-received', backStateMatchesData]
]);

export class AttributionProtocolError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
        this.name = 'AttributionProtocolError';
    }
}

function fail(code) {
    throw new AttributionProtocolError(code);
}

function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function requireExactKeys(value, allowedKeys) {
    if (!isPlainRecord(value)) fail('invalid-object');

    for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) fail('unknown-field');
    }
}

function requireInteger(value, minimum, maximum, code = 'invalid-integer') {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(code);
    return value;
}

function requireBoolean(value) {
    if (typeof value !== 'boolean') fail('invalid-boolean');
    return value;
}

function requireEnum(value, allowed) {
    if (typeof value !== 'string' || !allowed.has(value)) fail('invalid-enum');
    return value;
}

function requireEmptyData(data) {
    requireExactKeys(data, new Set());
    return {};
}

function normalizeRuntime(data) {
    requireExactKeys(data, new Set([
        'appCreateCount',
        'listenerRegistrationCount',
        'runtimeCreateCount',
        'runtimeReady'
    ]));

    return {
        appCreateCount: requireInteger(data.appCreateCount, 0, 1000),
        listenerRegistrationCount: requireInteger(data.listenerRegistrationCount, 0, 10000),
        runtimeCreateCount: requireInteger(data.runtimeCreateCount, 0, 1000),
        runtimeReady: requireBoolean(data.runtimeReady)
    };
}

function normalizeRoute(data) {
    requireExactKeys(data, new Set(['routeFamily', 'routeGeneration', 'source']));
    return {
        routeFamily: requireEnum(data.routeFamily, ROUTE_FAMILIES),
        routeGeneration: requireInteger(data.routeGeneration, 0, 1_000_000),
        source: requireEnum(data.source, ROUTE_SOURCES)
    };
}

function normalizeBackReceived(data) {
    requireExactKeys(data, new Set([
        'controlsVisible',
        'defaultPrevented',
        'duplicate',
        'handlerReached',
        'historyClass',
        'inputSource',
        'propagationStopped',
        'repeat',
        'routeFamily',
        'stage',
        'trusted'
    ]));
    return {
        controlsVisible: requireBoolean(data.controlsVisible),
        defaultPrevented: requireBoolean(data.defaultPrevented),
        duplicate: requireBoolean(data.duplicate),
        handlerReached: requireBoolean(data.handlerReached),
        historyClass: requireEnum(data.historyClass, HISTORY_CLASSES),
        inputSource: requireEnum(data.inputSource, INPUT_SOURCES),
        propagationStopped: requireBoolean(data.propagationStopped),
        repeat: requireBoolean(data.repeat),
        routeFamily: requireEnum(data.routeFamily, ROUTE_FAMILIES),
        stage: requireEnum(data.stage, BACK_STAGES),
        trusted: requireBoolean(data.trusted)
    };
}

function normalizeControlsHideRequest(data) {
    requireExactKeys(data, new Set(['source']));
    return {
        source: requireEnum(data.source, CONTROL_HIDE_SOURCES)
    };
}

function normalizeVisibility(data) {
    requireExactKeys(data, new Set(['visibilityState']));
    return { visibilityState: requireEnum(data.visibilityState, VISIBILITY_STATES) };
}

function normalizePageHide(data) {
    requireExactKeys(data, new Set(['persisted', 'visibilityState']));
    return {
        persisted: requireBoolean(data.persisted),
        visibilityState: requireEnum(data.visibilityState, VISIBILITY_STATES)
    };
}

function normalizeHeartbeat(data) {
    requireExactKeys(data, new Set([
        'activeFocus',
        'appCreateCount',
        'controlsVisible',
        'listenerRegistrationCount',
        'presentationCategory',
        'readyState',
        'routeFamily',
        'routeGeneration',
        'runtimeCreateCount',
        'runtimePresent',
        'runtimeReady',
        'videoPaused',
        'videoPresent',
        'visibilityState'
    ]));

    const videoPaused = data.videoPaused;
    if (videoPaused !== null && typeof videoPaused !== 'boolean') fail('invalid-video-state');

    return {
        activeFocus: requireEnum(data.activeFocus, FOCUS_CATEGORIES),
        appCreateCount: requireInteger(data.appCreateCount, 0, 1000),
        controlsVisible: requireBoolean(data.controlsVisible),
        listenerRegistrationCount: requireInteger(data.listenerRegistrationCount, 0, 10000),
        presentationCategory: requireEnum(data.presentationCategory, PRESENTATION_CATEGORIES),
        readyState: requireEnum(data.readyState, READY_STATES),
        routeFamily: requireEnum(data.routeFamily, ROUTE_FAMILIES),
        routeGeneration: requireInteger(data.routeGeneration, 0, 1_000_000),
        runtimeCreateCount: requireInteger(data.runtimeCreateCount, 0, 1000),
        runtimePresent: requireBoolean(data.runtimePresent),
        runtimeReady: requireBoolean(data.runtimeReady),
        videoPaused,
        videoPresent: requireBoolean(data.videoPresent),
        visibilityState: requireEnum(data.visibilityState, VISIBILITY_STATES)
    };
}

function normalizeData(category, data) {
    switch (category) {
        case 'app-launch':
        case 'document-start':
        case 'document-recreated':
        case 'video-started':
        case 'controls-visible':
        case 'back-owner':
        case 'playback-exit-requested':
        case 'error-category':
        case 'unhandled-rejection-category':
        case 'renderer-disconnected':
        case 'app-manager-state':
            return requireEmptyData(data);
        case 'controls-hide-requested':
            return normalizeControlsHideRequest(data);
        case 'runtime-created':
            return normalizeRuntime(data);
        case 'route-family':
            return normalizeRoute(data);
        case 'back-received':
            return normalizeBackReceived(data);
        case 'beforeunload':
        case 'visibilitychange':
        case 'unload':
            return normalizeVisibility(data);
        case 'pagehide':
            return normalizePageHide(data);
        case 'heartbeat':
            return normalizeHeartbeat(data);
        default:
            fail('unknown-category');
    }
}

function statesForCategory(category) {
    const states = CATEGORY_STATES.get(category);
    if (!states) fail('unknown-category');
    return states;
}

function requireConsistentState(category, state, data) {
    const matches = STATE_DATA_MATCHERS.get(category);
    if (matches && !matches(state, data)) fail('state-data-mismatch');
}

function backStateMatchesData(state, data) {
    if (DIRECT_BACK_STATES.has(state)) {
        return state === data.stage && (state !== 'command' || data.inputSource === 'input-manager');
    }
    return state === 'focus-pipeline' && PIPELINE_STAGES.has(data.stage);
}

function normalizeStateAndData(category, state, data) {
    const normalizedState = requireEnum(state, statesForCategory(category));
    const normalizedData = normalizeData(category, data);
    requireConsistentState(category, normalizedState, normalizedData);
    return {
        data: normalizedData,
        state: normalizedState
    };
}

export function isValidationSession(value) {
    return typeof value === 'string' && SESSION_PATTERN.test(value);
}

export function validateRendererEnvelope(value, expected) {
    requireExactKeys(value, ENVELOPE_KEYS);

    if (value.schemaVersion !== ATTRIBUTION_SCHEMA_VERSION) fail('schema-version');
    if (!isValidationSession(value.validationSession)) fail('validation-session-format');
    if (value.validationSession !== expected.validationSession) fail('validation-session-mismatch');

    const documentGeneration = requireInteger(
        value.documentGeneration,
        1,
        expected.maximumDocumentGeneration,
        'document-generation'
    );
    const category = requireEnum(value.category, CATEGORY_SET);
    const normalized = normalizeStateAndData(category, value.state, value.data);

    return {
        category,
        data: normalized.data,
        documentGeneration,
        documentMs: requireInteger(value.documentMs, 0, 86_400_000, 'document-ms'),
        documentSeq: requireInteger(value.documentSeq, 1, 10_000_000, 'document-seq'),
        schemaVersion: ATTRIBUTION_SCHEMA_VERSION,
        state: normalized.state,
        validationSession: value.validationSession
    };
}

export function createServerRecord({
    category,
    data,
    documentGeneration,
    documentMs = 0,
    documentSeq = 0,
    observedAt,
    seq,
    sessionMs,
    state,
    validationSession
}) {
    if (!CATEGORY_SET.has(category)) fail('unknown-category');
    if (!isValidationSession(validationSession)) fail('validation-session-format');
    const normalized = normalizeStateAndData(category, state, data);

    return {
        category,
        data: normalized.data,
        documentGeneration: requireInteger(documentGeneration, 0, 1_000_000),
        documentMs: requireInteger(documentMs, 0, 86_400_000),
        documentSeq: requireInteger(documentSeq, 0, 10_000_000),
        observedAt: requireObservedAt(observedAt),
        schemaVersion: ATTRIBUTION_SCHEMA_VERSION,
        seq: requireInteger(seq, 1, Number.MAX_SAFE_INTEGER),
        sessionMs: requireInteger(sessionMs, 0, Number.MAX_SAFE_INTEGER),
        state: normalized.state,
        validationSession
    };
}

function requireObservedAt(value) {
    if (
        typeof value !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
        || Number.isNaN(Date.parse(value))
    ) {
        fail('invalid-observed-at');
    }
    return value;
}
