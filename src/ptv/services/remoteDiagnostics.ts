import { getPtvBuildInfo } from '../core/buildInfo';
import { getPtvClientProfile } from '../core/clientProfile';
import {
    createPtvRemoteDiagnosticsPayload,
    createPtvRemoteDiagnosticsProfileTag,
    evaluatePtvRemoteDiagnosticsLease,
    PTV_REMOTE_DIAGNOSTICS_SCHEMA_VERSION,
    PtvDiagnosticsRingBuffer,
    sanitizePtvDiagnosticRoute,
    sanitizePtvDiagnosticUrl,
    sanitizePtvRemoteDiagnosticDetail,
    type PtvRemoteDiagnosticEntry,
    type PtvRemoteDiagnosticKind,
    type PtvRemoteDiagnosticsLease,
    type PtvRemoteDiagnosticsLeaseInput,
    type PtvRemoteDiagnosticsPayload,
    type PtvRemoteDiagnosticsProfileTag
} from '../core/remoteDiagnosticsModel';
import { getPtvRuntimeDiagnostics } from '../core/runtime';
import { ptvLogger } from '../core/logger';
import {
    subscribeToPtvGlobalPlaybackState,
    type PtvGlobalPlaybackState
} from './playbackStateService';

export type PtvRemoteDiagnosticsPresence = {
    boot: PtvRemoteDiagnosticsBootMarker;
    capabilities: PtvRemoteDiagnosticsClientCapabilities;
    clientId: string;
    diagnostics: {
        active: boolean;
        expiresAt: number | null;
        lastLeaseRejection: string | null;
        sessionId: string | null;
    };
    profile: PtvRemoteDiagnosticsProfileTag;
    route: string;
    schemaVersion: typeof PTV_REMOTE_DIAGNOSTICS_SCHEMA_VERSION;
    seenAt: number;
    metadata: PtvRemoteDiagnosticsClientMetadata;
};

export type PtvRemoteDiagnosticsBootMarker = {
    checkInAttempted: boolean;
    checkInStatus: number | null;
    diagnosticsModuleLoaded: boolean;
    failureCode: string | null;
    frontendBuildId: string;
    loadedClientBuildId: string;
    platformDetected: string;
    ptvRuntimeLoaded: boolean;
    remoteDiagnosticsRegistrationCount: number;
};

export type PtvRemoteDiagnosticsClientCapabilities = {
    heartbeat: boolean;
    memoryMetrics: boolean;
    navigationTiming: boolean;
    networkTiming: boolean;
    performanceMetrics: boolean;
    playbackTelemetry: boolean;
    remoteCommands: boolean;
    reportExport: boolean;
};

export type PtvRemoteDiagnosticsClientMetadata = {
    applicationName: string;
    applicationVersion: string;
    deviceDisplayName: string;
    deviceName: string;
    deviceType: string;
    nativeRuntime: boolean;
    platform: string;
};

export type PtvRemoteDiagnosticsCommand = {
    disable?: boolean;
    lease?: PtvRemoteDiagnosticsLeaseInput | null;
    requestSnapshot?: boolean;
};

export type PtvRemoteDiagnosticsTransport = {
    checkIn: (presence: PtvRemoteDiagnosticsPresence) => Promise<PtvRemoteDiagnosticsCommand | void>;
    publishSnapshot: (payload: PtvRemoteDiagnosticsPayload) => Promise<void>;
};

export type PtvRemoteDiagnosticsState = {
    active: boolean;
    bufferCount: number;
    bufferDropped: number;
    expiresAt: number | null;
    lastLeaseRejection: string | null;
    profile: PtvRemoteDiagnosticsProfileTag;
    sessionId: string | null;
};

type PtvRemoteDiagnosticsApi = {
    applyLease: (lease: PtvRemoteDiagnosticsLeaseInput) => PtvRemoteDiagnosticsState;
    clear: () => void;
    disable: () => PtvRemoteDiagnosticsState;
    getPresence: () => PtvRemoteDiagnosticsPresence;
    getSnapshot: () => PtvRemoteDiagnosticsPayload | null;
    record: (kind: PtvRemoteDiagnosticKind, name: string, detail?: unknown) => boolean;
    requestSnapshot: () => Promise<PtvRemoteDiagnosticsPayload | null>;
    setTransport: (transport: PtvRemoteDiagnosticsTransport | null) => void;
    state: () => PtvRemoteDiagnosticsState;
};

type PtvDiagnosticsWindow = Window & {
    ApiClient?: {
        appName?: () => string;
        appVersion?: () => string;
        deviceName?: () => string;
    };
    PTV?: Record<string, unknown> & {
        remoteDiagnostics?: PtvRemoteDiagnosticsApi;
    };
    __ptvRemoteDiagnosticsStarted?: boolean;
};

type NavigatorWithHardwareHints = Navigator & {
    deviceMemory?: number;
};

type PerformanceWithMemory = Performance & {
    memory?: {
        jsHeapSizeLimit?: number;
        totalJSHeapSize?: number;
        usedJSHeapSize?: number;
    };
};

type NetworkRequestMetadata = {
    method: string;
    startedAt: number;
    url: string;
};

const BUFFER_CAPACITY = 300;
const CHECK_IN_INTERVAL_MS = 30_000;
const FPS_SAMPLE_INTERVAL_MS = 15_000;
const FPS_SAMPLE_WINDOW_MS = 1_200;
const MEMORY_SAMPLE_INTERVAL_MS = 30_000;
const SNAPSHOT_INTERVAL_MS = 15_000;
const RECENT_CLIENT_LOG_LIMIT = 20;
const CLIENT_ID_STORAGE_KEY = 'ptv:remote-diagnostics:client:v1';
const LEASE_STORAGE_KEY = 'ptv:remote-diagnostics:lease:v1';
const REMOTE_KEYS: Record<number, string> = {
    8: 'back',
    13: 'select',
    19: 'media-pause',
    27: 'back',
    37: 'left',
    38: 'up',
    39: 'right',
    40: 'down',
    403: 'red',
    404: 'green',
    405: 'yellow',
    406: 'blue',
    412: 'media-rewind',
    413: 'media-stop',
    415: 'media-play',
    417: 'media-fast-forward',
    461: 'back'
};
const REMOTE_KEY_NAMES: Record<string, string> = {
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    Backspace: 'back',
    Enter: 'select',
    Escape: 'back',
    MediaFastForward: 'media-fast-forward',
    MediaPause: 'media-pause',
    MediaPlay: 'media-play',
    MediaPlayPause: 'media-play-pause',
    MediaRewind: 'media-rewind',
    MediaStop: 'media-stop'
};
const KNOWN_ERROR_NAMES = new Set([
    'AbortError',
    'DataCloneError',
    'EncodingError',
    'InvalidStateError',
    'MediaError',
    'NetworkError',
    'NotAllowedError',
    'NotFoundError',
    'QuotaExceededError',
    'RangeError',
    'ReferenceError',
    'SecurityError',
    'SyntaxError',
    'TimeoutError',
    'TypeError'
]);
const SAFE_CLIENT_LOG_MESSAGES = new Set([
    'Featured content cache cleared',
    'Featured content cache force refresh started',
    'Featured content cache stored on server',
    'Featured content server cache write failed',
    'PTV logging started',
    'Runtime started'
]);
const SAFE_CLIENT_LOG_SCOPES = new Set([
    'Browser',
    'FeaturedCache',
    'Logger',
    'PTV',
    'Runtime'
]);

const diagnosticsWindow = window as PtvDiagnosticsWindow;
const buffer = new PtvDiagnosticsRingBuffer<PtvRemoteDiagnosticEntry>(BUFFER_CAPACITY);
const collectorCleanup = new Set<() => void>();
const capturedClientLogKeys = new Set<string>();

let activeLease: PtvRemoteDiagnosticsLease | null = null;
let checkInInFlight: Promise<void> | null = null;
let checkInTimer: number | null = null;
let expirationTimer: number | null = null;
let lastLeaseRejection: string | null = null;
let lastSnapshot: PtvRemoteDiagnosticsPayload | null = null;
let publishInFlight: Promise<void> | null = null;
let transport: PtvRemoteDiagnosticsTransport | null = null;
let bootCheckInAttempted = false;
let bootCheckInStatus: number | null = null;
let bootFailureCode: string | null = null;

function getSessionStorage() {
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
}

function createRandomId() {
    const cryptoApi = window['crypto'];

    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
        const values = new Uint32Array(4);

        cryptoApi.getRandomValues(values);

        return `ptv-${Array.from(values).map(value => value.toString(16).padStart(8, '0')).join('')}`;
    }

    // eslint-disable-next-line sonarjs/pseudo-random -- This is a non-secret, session-scoped correlation label.
    return `ptv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function getClientId() {
    const storage = getSessionStorage();
    let stored: string | null = null;

    try {
        stored = storage?.getItem(CLIENT_ID_STORAGE_KEY) || null;
    } catch {
        stored = null;
    }

    if (stored && /^[a-z0-9_-]{8,96}$/i.test(stored)) return stored;

    const clientId = createRandomId();

    try {
        storage?.setItem(CLIENT_ID_STORAGE_KEY, clientId);
    } catch {
        // The ephemeral in-memory identifier remains sufficient when storage is unavailable.
    }

    return clientId;
}

const clientId = getClientId();

function now() {
    return Date.now();
}

function performanceNow() {
    return typeof performance !== 'undefined' ? performance.now() : now();
}

function getProfileTag() {
    const nav = navigator as NavigatorWithHardwareHints;

    return createPtvRemoteDiagnosticsProfileTag(getPtvClientProfile(), {
        deviceMemory: nav.deviceMemory,
        hardwareConcurrency: nav.hardwareConcurrency,
        viewportWidth: window.innerWidth
    });
}

function getSafeRuntimeString(value: unknown, maximumLength = 96) {
    if (typeof value !== 'string') return '';

    return value.trim()
        .replace(/\s+/g, ' ')
        .slice(0, maximumLength);
}

function readApiClientString(reader: (() => string) | undefined, maximumLength = 96) {
    try {
        return getSafeRuntimeString(typeof reader === 'function' ? reader() : '', maximumLength);
    } catch {
        return '';
    }
}

function getFriendlyPlatform(profile: PtvRemoteDiagnosticsProfileTag) {
    if (profile.tvPlatform === 'fire-tv') return 'Fire TV';
    if (profile.tvPlatform === 'webos') return 'LG webOS';
    if (profile.tvPlatform === 'android-tv') return 'Android TV';
    if (profile.tvPlatform === 'tizen') return 'Samsung Tizen';
    if (profile.tvPlatform === 'roku') return 'Roku';

    return profile.kind;
}

function getPtvRemoteDiagnosticsClientMetadata(profile = getProfileTag()): PtvRemoteDiagnosticsClientMetadata {
    const apiClient = diagnosticsWindow.ApiClient;
    const applicationName = readApiClientString(apiClient?.appName) || 'Jellyfin Web';
    const applicationVersion = readApiClientString(apiClient?.appVersion, 48);
    const rawDeviceName = readApiClientString(apiClient?.deviceName);
    const friendlyPlatform = getFriendlyPlatform(profile);
    const deviceName = rawDeviceName || friendlyPlatform;

    return {
        applicationName,
        applicationVersion,
        deviceDisplayName: deviceName,
        deviceName,
        deviceType: profile.tvPlatform === 'none' ? profile.kind : profile.tvPlatform,
        nativeRuntime: applicationName !== 'Jellyfin Web',
        platform: friendlyPlatform
    };
}

function getPtvRemoteDiagnosticsClientCapabilities(): PtvRemoteDiagnosticsClientCapabilities {
    const hasPerformanceEntries = typeof performance !== 'undefined'
        && typeof performance['getEntriesByType'] === 'function';

    return {
        heartbeat: true,
        memoryMetrics: (typeof navigator !== 'undefined' && 'deviceMemory' in navigator)
            || (typeof performance !== 'undefined' && Boolean((performance as PerformanceWithMemory).memory)),
        navigationTiming: hasPerformanceEntries,
        networkTiming: typeof window.fetch === 'function' || typeof XMLHttpRequest !== 'undefined',
        performanceMetrics: typeof performance !== 'undefined' && typeof performance.now === 'function',
        playbackTelemetry: true,
        remoteCommands: true,
        reportExport: true
    };
}

export function updatePtvRemoteDiagnosticsBootMarker(options: {
    checkInAttempted?: boolean;
    checkInStatus?: number | null;
    failureCode?: string | null;
}) {
    if (typeof options.checkInAttempted === 'boolean') bootCheckInAttempted = options.checkInAttempted;
    if (options.checkInStatus !== undefined) bootCheckInStatus = options.checkInStatus;
    if (options.failureCode !== undefined) bootFailureCode = options.failureCode;
}

function getPtvRemoteDiagnosticsBootMarker(profile = getProfileTag()): PtvRemoteDiagnosticsBootMarker {
    const runtimeDiagnostics = getPtvRuntimeDiagnostics();
    const buildInfo = getPtvBuildInfo();

    return {
        checkInAttempted: bootCheckInAttempted,
        checkInStatus: bootCheckInStatus,
        diagnosticsModuleLoaded: true,
        failureCode: bootFailureCode,
        frontendBuildId: buildInfo.frontendBuildId,
        loadedClientBuildId: buildInfo.frontendBuildId,
        platformDetected: profile.tvPlatform === 'none' ? profile.kind : profile.tvPlatform,
        ptvRuntimeLoaded: runtimeDiagnostics.runtimeCreateCount > 0 || runtimeDiagnostics.ready,
        remoteDiagnosticsRegistrationCount: runtimeDiagnostics.featureRegistrationCount['remote-diagnostics'] || 0
    };
}

function isLeaseActive() {
    if (!activeLease) return false;
    if (activeLease.expiresAt > now()) return true;

    expireLease();
    return false;
}

export function recordPtvRemoteDiagnostic(
    kind: PtvRemoteDiagnosticKind,
    name: string,
    detail: unknown = {}
) {
    if (!isLeaseActive()) return false;

    appendDiagnostic(kind, name, detail);

    return true;
}

function appendDiagnostic(
    kind: PtvRemoteDiagnosticKind,
    name: string,
    detail: unknown = {}
) {
    buffer.push({
        at: now(),
        detail: sanitizePtvRemoteDiagnosticDetail(detail),
        kind,
        name: String(name || 'event').slice(0, 96)
    });
}

function getCurrentRoute() {
    return sanitizePtvDiagnosticRoute(`${window.location.pathname}${window.location.hash}`);
}

export function getPtvRemoteDiagnosticsPresence(): PtvRemoteDiagnosticsPresence {
    const profile = getProfileTag();

    return {
        boot: getPtvRemoteDiagnosticsBootMarker(profile),
        capabilities: getPtvRemoteDiagnosticsClientCapabilities(),
        clientId,
        diagnostics: {
            active: isLeaseActive(),
            expiresAt: activeLease?.expiresAt || null,
            lastLeaseRejection,
            sessionId: activeLease?.sessionId || null
        },
        metadata: getPtvRemoteDiagnosticsClientMetadata(profile),
        profile,
        route: getCurrentRoute(),
        schemaVersion: PTV_REMOTE_DIAGNOSTICS_SCHEMA_VERSION,
        seenAt: now()
    };
}

export function getPtvRemoteDiagnosticsState(): PtvRemoteDiagnosticsState {
    return {
        active: isLeaseActive(),
        bufferCount: buffer.count,
        bufferDropped: buffer.dropped,
        expiresAt: activeLease?.expiresAt || null,
        lastLeaseRejection,
        profile: getProfileTag(),
        sessionId: activeLease?.sessionId || null
    };
}

export function getPtvRemoteDiagnosticsSnapshot() {
    if (!activeLease) return lastSnapshot;

    syncRecentPtvLogs();

    return createPtvRemoteDiagnosticsPayload({
        buffer,
        clientId,
        lease: activeLease,
        profile: getProfileTag(),
        route: getCurrentRoute()
    });
}

function persistLease(lease: PtvRemoteDiagnosticsLeaseInput | null) {
    try {
        if (lease) {
            getSessionStorage()?.setItem(LEASE_STORAGE_KEY, JSON.stringify(lease));
        } else {
            getSessionStorage()?.removeItem(LEASE_STORAGE_KEY);
        }
    } catch {
        // A lease remains memory-only when session storage is blocked.
    }
}

function addCollectorCleanup(cleanup: () => void) {
    collectorCleanup.add(cleanup);
}

function stopCollectors() {
    collectorCleanup.forEach(cleanup => {
        cleanup();
    });
    collectorCleanup.clear();
}

function addWindowListener<K extends keyof WindowEventMap>(
    type: K,
    listener: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean
) {
    window.addEventListener(type, listener as EventListener, options);
    addCollectorCleanup(() => window.removeEventListener(type, listener as EventListener, options));
}

function addDocumentListener<K extends keyof DocumentEventMap>(
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean
) {
    document.addEventListener(type, listener as EventListener, options);
    addCollectorCleanup(() => document.removeEventListener(type, listener as EventListener, options));
}

function installRouteCollector() {
    let previousRoute = getCurrentRoute();
    const pendingFrames = new Set<number>();
    const collectRoute = () => {
        const startedAt = performanceNow();
        const nextRoute = getCurrentRoute();

        recordPtvRemoteDiagnostic('route', 'route-change', {
            from: previousRoute,
            to: nextRoute
        });
        previousRoute = nextRoute;

        let firstFrame = 0;
        let secondFrame = 0;

        if (typeof window.requestAnimationFrame === 'function') {
            firstFrame = window.requestAnimationFrame(() => {
                pendingFrames.delete(firstFrame);
                secondFrame = window.requestAnimationFrame(() => {
                    pendingFrames.delete(secondFrame);
                    recordPtvRemoteDiagnostic('render', 'route-render', {
                        durationMs: Number((performanceNow() - startedAt).toFixed(1)),
                        route: nextRoute
                    });
                });
                pendingFrames.add(secondFrame);
            });
            pendingFrames.add(firstFrame);
        }
    };

    addWindowListener('hashchange', collectRoute);
    addWindowListener('popstate', collectRoute);
    addCollectorCleanup(() => {
        pendingFrames.forEach(frame => {
            window.cancelAnimationFrame(frame);
        });
        pendingFrames.clear();
    });
    recordPtvRemoteDiagnostic('route', 'route-initial', { route: previousRoute });
}

function installKeyCollector() {
    addDocumentListener('keydown', event => {
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- Legacy WebOS remotes expose numeric keyCode only.
        const keyName = REMOTE_KEY_NAMES[event.key] || REMOTE_KEYS[event.keyCode];

        if (!keyName) return;

        const target = event.target instanceof HTMLElement ? event.target : null;

        recordPtvRemoteDiagnostic('key', 'remote-key', {
            action: keyName,
            defaultPrevented: event.defaultPrevented,
            repeat: event.repeat,
            targetRole: target?.getAttribute('role') || null,
            targetTag: target?.tagName.toLowerCase() || null
        });
    }, true);
}

function getErrorDetail(error: unknown) {
    const rawName = error instanceof Error ? error.name : '';
    const rawMessage = error instanceof Error ? error.message : String(error || '');
    const lowerMessage = rawMessage.toLowerCase();
    let category = 'unknown';

    if (/abort|cancel/.test(lowerMessage)) category = 'aborted';
    else if (/timeout|timed out/.test(lowerMessage)) category = 'timeout';
    else if (/network|fetch|connection|offline/.test(lowerMessage)) category = 'network';
    else if (/media|codec|decode|playback|\bplay\b/.test(lowerMessage)) category = 'media';
    else if (/permission|denied|not allowed/.test(lowerMessage)) category = 'permission';

    return {
        category,
        name: KNOWN_ERROR_NAMES.has(rawName) ? rawName : 'Error'
    };
}

function installErrorCollector() {
    addWindowListener('error', event => {
        recordPtvRemoteDiagnostic('error', 'javascript-error', {
            column: event.colno,
            error: getErrorDetail(event.error || event.message),
            line: event.lineno,
            source: sanitizePtvDiagnosticUrl(event.filename || '', window.location.origin)
        });
    });
    addWindowListener('unhandledrejection', event => {
        recordPtvRemoteDiagnostic('error', 'unhandled-rejection', getErrorDetail(event.reason));
    });
}

function getRequestUrl(input: RequestInfo | URL) {
    if (typeof input === 'string') return input;
    if (typeof URL !== 'undefined' && input instanceof URL) return input.toString();
    if (typeof Request !== 'undefined' && input instanceof Request) return input.url;

    return String(input);
}

function installFetchCollector() {
    if (typeof window.fetch !== 'function') return;

    const originalFetch = window.fetch;
    const wrappedFetch: typeof window.fetch = (...args) => {
        const [input, init] = args;
        const requestUrl = getRequestUrl(input);
        const startedAt = performanceNow();
        const method = String(init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();

        return originalFetch.apply(window, args).then(response => {
            if (!response.ok) {
                recordPtvRemoteDiagnostic('network', 'fetch-failed', {
                    durationMs: Number((performanceNow() - startedAt).toFixed(1)),
                    method,
                    status: response.status,
                    target: sanitizePtvDiagnosticUrl(requestUrl, window.location.origin)
                });
            }

            return response;
        }).catch((error: unknown) => {
            recordPtvRemoteDiagnostic('network', 'fetch-error', {
                durationMs: Number((performanceNow() - startedAt).toFixed(1)),
                error: getErrorDetail(error),
                method,
                target: sanitizePtvDiagnosticUrl(requestUrl, window.location.origin)
            });
            throw error;
        });
    };

    window.fetch = wrappedFetch;
    addCollectorCleanup(() => {
        if (window.fetch === wrappedFetch) window.fetch = originalFetch;
    });
}

function installXhrCollector() {
    if (typeof XMLHttpRequest === 'undefined') return;

    const requestMetadata = new WeakMap<XMLHttpRequest, NetworkRequestMetadata>();
    const prototype = XMLHttpRequest.prototype;
    const originalOpen = prototype.open;
    const originalSend = prototype.send;
    const wrappedOpen = function(
        this: XMLHttpRequest,
        method: string,
        url: string | URL,
        async?: boolean,
        username?: string | null,
        password?: string | null
    ) {
        requestMetadata.set(this, {
            method: String(method || 'GET').toUpperCase(),
            startedAt: 0,
            url: String(url || '')
        });

        if (typeof async === 'boolean') {
            return originalOpen.call(this, method, url, async, username, password);
        }

        return (originalOpen as (method: string, url: string | URL) => void).call(this, method, url);
    } as XMLHttpRequest['open'];
    const wrappedSend = function(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
        const metadata = requestMetadata.get(this);

        if (metadata) metadata.startedAt = performanceNow();

        const handleLoadEnd = () => {
            this.removeEventListener('loadend', handleLoadEnd);
            const request = requestMetadata.get(this);

            if (!request || (this.status > 0 && this.status < 400)) return;

            recordPtvRemoteDiagnostic('network', 'xhr-failed', {
                durationMs: Number((performanceNow() - request.startedAt).toFixed(1)),
                method: request.method,
                status: this.status,
                target: sanitizePtvDiagnosticUrl(request.url, window.location.origin)
            });
        };

        this.addEventListener('loadend', handleLoadEnd);

        return originalSend.call(this, body);
    } as XMLHttpRequest['send'];

    prototype.open = wrappedOpen;
    prototype.send = wrappedSend;
    addCollectorCleanup(() => {
        if (prototype.open === wrappedOpen) prototype.open = originalOpen;
        if (prototype.send === wrappedSend) prototype.send = originalSend;
    });
}

function installNetworkStateCollector() {
    addWindowListener('offline', () => recordPtvRemoteDiagnostic('network', 'offline'));
    addWindowListener('online', () => recordPtvRemoteDiagnostic('network', 'online'));
    installFetchCollector();
    installXhrCollector();
}

function installLongTaskCollector() {
    const PerformanceObserverCtor = window['PerformanceObserver'];

    if (!PerformanceObserverCtor) return;

    let observer: PerformanceObserver | null = null;

    try {
        observer = new PerformanceObserverCtor(list => {
            list.getEntries().forEach(entry => {
                recordPtvRemoteDiagnostic('long-task', 'long-task', {
                    durationMs: Number(entry.duration.toFixed(1)),
                    startTimeMs: Number(entry.startTime.toFixed(1))
                });
            });
        });
        observer.observe({ entryTypes: ['longtask'] });
    } catch {
        observer?.disconnect();
        observer = null;
    }

    addCollectorCleanup(() => observer?.disconnect());
}

function collectMemorySample() {
    const nav = navigator as NavigatorWithHardwareHints;
    const memory = (performance as PerformanceWithMemory).memory;
    const toMegabytes = (value: number | undefined) => value ? Math.round(value / (1024 * 1024)) : null;

    recordPtvRemoteDiagnostic('memory', 'memory-sample', {
        deviceMemoryGb: nav.deviceMemory || null,
        hardwareConcurrency: nav.hardwareConcurrency || null,
        heapLimitMb: toMegabytes(memory?.jsHeapSizeLimit),
        totalHeapMb: toMegabytes(memory?.totalJSHeapSize),
        usedHeapMb: toMegabytes(memory?.usedJSHeapSize)
    });
}

function installMemoryCollector() {
    collectMemorySample();
    const timer = window.setInterval(collectMemorySample, MEMORY_SAMPLE_INTERVAL_MS);

    addCollectorCleanup(() => window.clearInterval(timer));
}

function installFpsCollector() {
    if (typeof window.requestAnimationFrame !== 'function') return;

    let activeFrame = 0;
    let initialTimer = 0;
    let sampleRunning = false;
    const runSample = () => {
        if (sampleRunning || document.visibilityState === 'hidden' || !isLeaseActive()) return;

        sampleRunning = true;
        const startedAt = performanceNow();
        let frameCount = 0;
        let lastFrameAt = startedAt;
        let maxFrameGapMs = 0;
        let stutterCount = 0;
        const countFrame = (frameAt: number) => {
            const frameGap = frameAt - lastFrameAt;

            frameCount += 1;
            lastFrameAt = frameAt;
            maxFrameGapMs = Math.max(maxFrameGapMs, frameGap);
            if (frameGap >= 50) stutterCount += 1;

            const durationMs = frameAt - startedAt;

            if (durationMs >= FPS_SAMPLE_WINDOW_MS) {
                sampleRunning = false;
                recordPtvRemoteDiagnostic('fps', 'fps-sample', {
                    durationMs: Number(durationMs.toFixed(1)),
                    fps: Number(((frameCount * 1000) / Math.max(1, durationMs)).toFixed(1)),
                    maxFrameGapMs: Number(maxFrameGapMs.toFixed(1)),
                    stutterCount
                });
                return;
            }

            activeFrame = window.requestAnimationFrame(countFrame);
        };

        activeFrame = window.requestAnimationFrame(countFrame);
    };

    initialTimer = window.setTimeout(runSample, 750);
    const interval = window.setInterval(runSample, FPS_SAMPLE_INTERVAL_MS);

    addCollectorCleanup(() => {
        window.clearTimeout(initialTimer);
        window.clearInterval(interval);
        window.cancelAnimationFrame(activeFrame);
        sampleRunning = false;
    });
}

function getPlaybackSignature(state: PtvGlobalPlaybackState) {
    return [state.source, state.active, state.paused, state.routeHref || ''].join('|');
}

function installPlaybackCollector() {
    let previousSignature = '';
    const unsubscribe = subscribeToPtvGlobalPlaybackState(state => {
        const signature = getPlaybackSignature(state);

        if (signature === previousSignature) return;

        previousSignature = signature;
        recordPtvRemoteDiagnostic('playback', 'playback-transition', {
            hasItem: Boolean(state.rawItem),
            active: state.active,
            paused: state.paused,
            route: state.routeHref ? sanitizePtvDiagnosticRoute(state.routeHref) : null,
            source: state.source
        });
    });

    addCollectorCleanup(unsubscribe);
}

function collectNavigationTiming() {
    const getEntriesByType = performance['getEntriesByType'];

    if (typeof getEntriesByType !== 'function') return;

    const entry = getEntriesByType.call(performance, 'navigation')[0] as PerformanceNavigationTiming | undefined;

    if (!entry) return;

    recordPtvRemoteDiagnostic('render', 'page-navigation', {
        domContentLoadedMs: Number(entry.domContentLoadedEventEnd.toFixed(1)),
        durationMs: Number(entry.duration.toFixed(1)),
        loadEventMs: Number(entry.loadEventEnd.toFixed(1)),
        responseEndMs: Number(entry.responseEnd.toFixed(1))
    });
}

function syncRecentPtvLogs() {
    // Copy only a small, sanitized tail of PiggieTV's existing client log. The
    // verbose detail field is intentionally excluded because it may contain
    // library metadata; every retained string still passes through the report
    // sanitizer before it can leave the client.
    for (const entry of ptvLogger.getEntries().slice(-RECENT_CLIENT_LOG_LIMIT)) {
        const key = `${entry.at}\u0000${entry.level}\u0000${entry.scope}\u0000${entry.message}\u0000${entry.route}`;

        if (capturedClientLogKeys.has(key)) continue;
        if (capturedClientLogKeys.size >= BUFFER_CAPACITY) {
            const oldestKey = capturedClientLogKeys.values().next().value;

            if (typeof oldestKey === 'string') capturedClientLogKeys.delete(oldestKey);
        }
        capturedClientLogKeys.add(key);
        appendDiagnostic('log', 'client-log', {
            level: entry.level,
            message: SAFE_CLIENT_LOG_MESSAGES.has(entry.message) ? entry.message : '[message-omitted]',
            route: sanitizePtvDiagnosticRoute(entry.route),
            scope: SAFE_CLIENT_LOG_SCOPES.has(entry.scope) ? entry.scope : 'Other'
        });
    }
}

function startCollectors() {
    stopCollectors();
    syncRecentPtvLogs();

    installRouteCollector();
    installKeyCollector();
    installErrorCollector();
    installNetworkStateCollector();
    installLongTaskCollector();
    installMemoryCollector();
    installFpsCollector();
    installPlaybackCollector();
    collectNavigationTiming();

    const snapshotTimer = window.setInterval(() => {
        void publishSnapshot();
    }, SNAPSHOT_INTERVAL_MS);

    addCollectorCleanup(() => window.clearInterval(snapshotTimer));
}

function scheduleExpiration() {
    if (expirationTimer !== null) window.clearTimeout(expirationTimer);
    if (!activeLease) return;

    expirationTimer = window.setTimeout(expireLease, Math.max(0, activeLease.expiresAt - now()));
}

function expireLease() {
    if (!activeLease) return;

    appendDiagnostic('system', 'session-expired', {
        sessionId: activeLease.sessionId
    });
    lastSnapshot = getPtvRemoteDiagnosticsSnapshot();
    stopCollectors();
    activeLease = null;
    persistLease(null);

    if (expirationTimer !== null) {
        window.clearTimeout(expirationTimer);
        expirationTimer = null;
    }

    if (lastSnapshot && transport) {
        void transport.publishSnapshot(lastSnapshot).catch(() => undefined);
    }
}

export function applyPtvRemoteDiagnosticsLease(input: PtvRemoteDiagnosticsLeaseInput) {
    const profile = getPtvClientProfile();
    const decision = evaluatePtvRemoteDiagnosticsLease(input, profile.kind);

    if (!decision.accepted) {
        lastLeaseRejection = decision.reason;
        if (decision.reason === 'disabled' || decision.reason === 'expired') {
            disablePtvRemoteDiagnostics();
        }
        return getPtvRemoteDiagnosticsState();
    }

    const isExistingSession = activeLease?.sessionId === decision.lease.sessionId;

    activeLease = isExistingSession && activeLease ? {
        ...decision.lease,
        startedAt: activeLease.startedAt
    } : decision.lease;
    lastLeaseRejection = null;
    // Persist the client-local normalized expiry, not the server-relative
    // duration, so a reload cannot replay and extend the original command.
    persistLease({
        enabled: true,
        expiresAt: activeLease.expiresAt,
        profiles: activeLease.profiles,
        sessionId: activeLease.sessionId
    });

    if (!isExistingSession) {
        buffer.clear();
        capturedClientLogKeys.clear();
        lastSnapshot = null;
        startCollectors();
        recordPtvRemoteDiagnostic('system', 'session-started', {
            expiresAt: activeLease.expiresAt,
            profile: activeLease.profile,
            sessionId: activeLease.sessionId
        });
    }

    scheduleExpiration();
    return getPtvRemoteDiagnosticsState();
}

export function disablePtvRemoteDiagnostics() {
    if (activeLease) {
        appendDiagnostic('system', 'session-disabled', {
            sessionId: activeLease.sessionId
        });
        lastSnapshot = getPtvRemoteDiagnosticsSnapshot();
    }

    stopCollectors();
    activeLease = null;
    persistLease(null);
    if (expirationTimer !== null) {
        window.clearTimeout(expirationTimer);
        expirationTimer = null;
    }

    return getPtvRemoteDiagnosticsState();
}

async function publishSnapshot() {
    const payload = getPtvRemoteDiagnosticsSnapshot();

    if (!payload || !transport) return;
    if (publishInFlight) {
        await publishInFlight;
        return;
    }

    publishInFlight = transport.publishSnapshot(payload)
        .catch(error => {
            recordPtvRemoteDiagnostic('network', 'diagnostics-publish-failed', getErrorDetail(error));
        })
        .finally(() => {
            publishInFlight = null;
        });

    await publishInFlight;
}

async function checkIn() {
    if (!transport || checkInInFlight) return checkInInFlight || Promise.resolve();

    const activeTransport = transport;

    checkInInFlight = activeTransport.checkIn(getPtvRemoteDiagnosticsPresence())
        .then(command => {
            if (!command) return;
            if (command.disable === true || command.lease === null) disablePtvRemoteDiagnostics();
            if (command.lease) applyPtvRemoteDiagnosticsLease(command.lease);
            if (command.requestSnapshot) return publishSnapshot().then(() => undefined);
        })
        .catch(error => {
            recordPtvRemoteDiagnostic('network', 'diagnostics-check-in-failed', getErrorDetail(error));
        })
        .finally(() => {
            checkInInFlight = null;
        });

    return checkInInFlight;
}

export function setPtvRemoteDiagnosticsTransport(nextTransport: PtvRemoteDiagnosticsTransport | null) {
    transport = nextTransport;

    if (checkInTimer !== null) {
        window.clearInterval(checkInTimer);
        checkInTimer = null;
    }

    if (!transport) return;

    void checkIn();
    checkInTimer = window.setInterval(() => {
        checkIn().catch(() => undefined);
    }, CHECK_IN_INTERVAL_MS);
}

function restoreLease() {
    try {
        const stored = getSessionStorage()?.getItem(LEASE_STORAGE_KEY);

        if (!stored) return;

        applyPtvRemoteDiagnosticsLease(JSON.parse(stored) as PtvRemoteDiagnosticsLeaseInput);
    } catch {
        persistLease(null);
    }
}

function installApi() {
    const root = diagnosticsWindow.PTV || (diagnosticsWindow.PTV = {});

    root.remoteDiagnostics = {
        applyLease: applyPtvRemoteDiagnosticsLease,
        clear: () => {
            buffer.clear();
            lastSnapshot = null;
        },
        disable: disablePtvRemoteDiagnostics,
        getPresence: getPtvRemoteDiagnosticsPresence,
        getSnapshot: getPtvRemoteDiagnosticsSnapshot,
        record: recordPtvRemoteDiagnostic,
        requestSnapshot: async () => {
            await publishSnapshot();
            return getPtvRemoteDiagnosticsSnapshot();
        },
        setTransport: setPtvRemoteDiagnosticsTransport,
        state: getPtvRemoteDiagnosticsState
    };
}

export function startPtvRemoteDiagnosticsAgent() {
    if (diagnosticsWindow.__ptvRemoteDiagnosticsStarted) return disposePtvRemoteDiagnosticsAgent;

    diagnosticsWindow.__ptvRemoteDiagnosticsStarted = true;
    installApi();
    restoreLease();

    return disposePtvRemoteDiagnosticsAgent;
}

export function disposePtvRemoteDiagnosticsAgent() {
    disablePtvRemoteDiagnostics();
    setPtvRemoteDiagnosticsTransport(null);
    buffer.clear();
    capturedClientLogKeys.clear();
    lastSnapshot = null;
    lastLeaseRejection = null;
    diagnosticsWindow.__ptvRemoteDiagnosticsStarted = false;
    if (diagnosticsWindow.PTV) delete diagnosticsWindow.PTV.remoteDiagnostics;
}
