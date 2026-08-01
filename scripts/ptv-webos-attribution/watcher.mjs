/* eslint-disable compat/compat -- Validation-only Node.js watcher; it is never bundled for supported browsers. */

import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import WebSocket from 'ws';

import { isValidationSession } from './protocol.mjs';

const SOURCE = 'external-process-watcher';
const SOCKET_CLOSE_GRACE_MS = 250;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const EXCEPTION_CATEGORIES = new Set([
    'error',
    'range-error',
    'reference-error',
    'syntax-error',
    'type-error',
    'unknown'
]);
const QUERY_STATUSES = new Set([
    'command-unavailable',
    'error',
    'ok',
    'timeout'
]);
const CDP_CONNECTION_CAUSES = new Set([
    'socket-close',
    'socket-error',
    'socket-open',
    'target-missing',
    'target-replaced',
    'watcher-stopped'
]);
const CDP_CONNECTION_STATES = new Set(['connected', 'disconnected']);
const SOCKET_CLOSE_CODE_CLASSES = new Set([
    'abnormal-closure',
    'application',
    'bad-gateway',
    'extension-required',
    'going-away',
    'internal-error',
    'invalid-payload',
    'message-too-big',
    'no-status',
    'normal',
    'not-applicable',
    'other-protocol',
    'policy-violation',
    'private',
    'protocol-error',
    'service-restart',
    'tls-failure',
    'try-again-later',
    'unavailable',
    'unsupported-data'
]);
const INSPECTOR_DETACHED_REASONS = new Set([
    'connection-closed',
    'not-applicable',
    'other',
    'renderer-gone',
    'replaced-by-another-debugger',
    'target-closed',
    'target-crashed',
    'unavailable'
]);
const CLI_OPTION_KEYS = Object.freeze({
    '--app-id': 'validationAppId',
    '--ares-launch-script': 'aresLaunchScript',
    '--cdp': 'cdpListUrl',
    '--device': 'device',
    '--session-started-at': 'sessionStartedAt',
    '--validation-session': 'validationSession'
});

const EVENT_DATA_KEYS = Object.freeze({
    'app-manager-sample': new Set(['appPresent', 'queryStatus']),
    'cdp-connection': new Set(['cause', 'closeCode', 'closeCodeClass', 'state']),
    'cdp-exception': new Set(['exceptionCategory']),
    'cdp-inspector': new Set(['detachedReason', 'state']),
    'cdp-list-query': new Set(['status']),
    'cdp-resource-sample': new Set([
        'documents',
        'jsEventListeners',
        'jsHeapTotalBytes',
        'jsHeapUsedBytes',
        'nodes'
    ]),
    'cdp-target': new Set(['state']),
    'system-log-status': new Set(['status']),
    'watcher-status': new Set(['state'])
});
const DEVICE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const VALIDATION_APP_ID_PATTERN = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+){1,31}$/u;

function requireEnum(value, allowed, name) {
    if (!allowed.has(value)) {
        throw new TypeError(`Invalid ${name}`);
    }

    return value;
}

function safeNullableCount(value) {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return value;
}

function requireSessionStartedAt(value) {
    if (
        typeof value !== 'string'
        || !value.endsWith('Z')
        || Number.isNaN(Date.parse(value))
    ) {
        throw new TypeError('Session start UTC anchor is required');
    }

    return Date.parse(value);
}

function requireIdentifier(value, pattern, name) {
    if (typeof value !== 'string' || !pattern.test(value)) {
        throw new TypeError(`Invalid ${name}`);
    }

    return value;
}

function requireAresLaunchScript(value) {
    if (
        typeof value !== 'string'
        || !isAbsolute(value)
        || basename(value) !== 'ares-launch.js'
    ) {
        throw new TypeError('Invalid ares-launch script path');
    }

    return value;
}

function classifySocketCloseCode(value) {
    if (!Number.isSafeInteger(value) || value < 1_000 || value > 4_999) {
        return {
            closeCode: null,
            closeCodeClass: 'unavailable'
        };
    }

    const knownClasses = new Map([
        [1_000, 'normal'],
        [1_001, 'going-away'],
        [1_002, 'protocol-error'],
        [1_003, 'unsupported-data'],
        [1_005, 'no-status'],
        [1_006, 'abnormal-closure'],
        [1_007, 'invalid-payload'],
        [1_008, 'policy-violation'],
        [1_009, 'message-too-big'],
        [1_010, 'extension-required'],
        [1_011, 'internal-error'],
        [1_012, 'service-restart'],
        [1_013, 'try-again-later'],
        [1_014, 'bad-gateway'],
        [1_015, 'tls-failure']
    ]);
    let closeCodeClass = knownClasses.get(value);

    if (!closeCodeClass) {
        if (value >= 4_000) closeCodeClass = 'private';
        else if (value >= 3_000) closeCodeClass = 'application';
        else closeCodeClass = 'other-protocol';
    }

    return {
        closeCode: value,
        closeCodeClass
    };
}

function classifyInspectorDetachedReason(value) {
    if (typeof value !== 'string' || !value.trim()) return 'unavailable';

    const normalized = value.trim().toLowerCase().replace(/[\s-]+/gu, '_');

    if (normalized.includes('replaced')) return 'replaced-by-another-debugger';
    if (normalized.includes('target_closed') || normalized.includes('target_destroyed')) {
        return 'target-closed';
    }
    if (normalized.includes('render') && (
        normalized.includes('gone')
        || normalized.includes('crash')
        || normalized.includes('terminat')
    )) {
        return 'renderer-gone';
    }
    if (normalized.includes('target') && normalized.includes('crash')) return 'target-crashed';
    if (normalized.includes('connection') || normalized.includes('disconnect')) {
        return 'connection-closed';
    }
    return 'other';
}

function normalizeSocketClose(value) {
    const candidate = value && typeof value === 'object' && 'code' in value ?
        value.code :
        value;
    return classifySocketCloseCode(candidate);
}

function sanitizeCdpConnection(data) {
    const cause = requireEnum(
        data.cause,
        CDP_CONNECTION_CAUSES,
        'CDP connection cause'
    );
    const state = requireEnum(
        data.state,
        CDP_CONNECTION_STATES,
        'CDP connection state'
    );

    if (cause !== 'socket-close') {
        return {
            cause,
            closeCode: null,
            closeCodeClass: 'not-applicable',
            state
        };
    }

    const close = classifySocketCloseCode(data.closeCode);
    const suppliedClass = requireEnum(
        data.closeCodeClass,
        SOCKET_CLOSE_CODE_CLASSES,
        'socket close code class'
    );

    if (close.closeCodeClass !== suppliedClass) {
        throw new TypeError('Invalid socket close classification');
    }

    return {
        cause,
        ...close,
        state
    };
}

function sanitizeCdpInspector(data) {
    const state = requireEnum(
        data.state,
        new Set(['detached', 'target-crashed']),
        'CDP inspector state'
    );

    if (state === 'target-crashed') {
        return {
            detachedReason: 'not-applicable',
            state
        };
    }

    return {
        detachedReason: requireEnum(
            data.detachedReason,
            INSPECTOR_DETACHED_REASONS,
            'inspector detached reason'
        ),
        state
    };
}

function sanitizeEventData(kind, data) {
    const allowedKeys = EVENT_DATA_KEYS[kind];

    if (!allowedKeys) {
        throw new TypeError('Invalid watcher event kind');
    }

    for (const key of Object.keys(data)) {
        if (!allowedKeys.has(key)) {
            throw new TypeError('Unsafe watcher event field');
        }
    }

    switch (kind) {
        case 'watcher-status':
            return {
                state: requireEnum(data.state, new Set(['started', 'stopped']), 'watcher state')
            };
        case 'system-log-status':
            return {
                status: requireEnum(data.status, new Set(['unavailable']), 'system log status')
            };
        case 'cdp-list-query':
            return {
                status: requireEnum(
                    data.status,
                    new Set(['invalid-response', 'ok', 'unavailable']),
                    'CDP query status'
                )
            };
        case 'cdp-target':
            return {
                state: requireEnum(
                    data.state,
                    new Set(['missing', 'present', 'replaced']),
                    'CDP target state'
                )
            };
        case 'cdp-connection':
            return sanitizeCdpConnection(data);
        case 'cdp-inspector':
            return sanitizeCdpInspector(data);
        case 'cdp-exception':
            return {
                exceptionCategory: requireEnum(
                    data.exceptionCategory,
                    EXCEPTION_CATEGORIES,
                    'exception category'
                )
            };
        case 'cdp-resource-sample':
            return {
                documents: safeNullableCount(data.documents),
                jsEventListeners: safeNullableCount(data.jsEventListeners),
                jsHeapTotalBytes: safeNullableCount(data.jsHeapTotalBytes),
                jsHeapUsedBytes: safeNullableCount(data.jsHeapUsedBytes),
                nodes: safeNullableCount(data.nodes)
            };
        case 'app-manager-sample': {
            const appPresent = data.appPresent;

            if (appPresent !== null && typeof appPresent !== 'boolean') {
                throw new TypeError('Invalid app-present state');
            }

            return {
                appPresent,
                queryStatus: requireEnum(data.queryStatus, QUERY_STATUSES, 'app-manager query status')
            };
        }
        default:
            throw new TypeError('Invalid watcher event kind');
    }
}

export function createSynchronizedRecorder(
    emit,
    {
        monotonicNow = () => performance.now(),
        sessionStartedAt,
        validationSession,
        wallNow = () => Date.now()
    } = {}
) {
    if (typeof emit !== 'function') {
        throw new TypeError('Watcher emit callback is required');
    }
    if (!isValidationSession(validationSession)) {
        throw new TypeError('Validation session is required');
    }

    const sessionStartedWallMs = requireSessionStartedAt(sessionStartedAt);
    const monotonicOrigin = monotonicNow();
    const wallOrigin = wallNow();
    const sessionOffsetMs = Math.max(0, wallOrigin - sessionStartedWallMs);
    let sequence = 0;

    return (kind, data) => {
        const sessionMs = sessionOffsetMs
            + Math.max(0, Math.round(monotonicNow() - monotonicOrigin));
        const record = Object.freeze({
            ...sanitizeEventData(kind, data),
            kind,
            observedAt: new Date(sessionStartedWallMs + sessionMs).toISOString(),
            sequence: ++sequence,
            sessionMs,
            source: SOURCE,
            validationSession
        });

        emit(record);
        return record;
    };
}

function normalizeLoopbackCdpListUrl(value) {
    const url = new URL(value);

    if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
        throw new TypeError('CDP list endpoint must be loopback-only');
    }

    if (!['/json', '/json/list'].includes(url.pathname.replace(/\/$/u, ''))) {
        throw new TypeError('CDP list endpoint must use /json or /json/list');
    }

    url.username = '';
    url.password = '';
    url.hash = '';
    return url;
}

function localizeDebuggerUrl(debuggerUrl, cdpListUrl) {
    let advertised;

    try {
        advertised = new URL(debuggerUrl);
    } catch {
        return null;
    }

    if (!['ws:', 'wss:'].includes(advertised.protocol)) return null;

    const localized = new URL(cdpListUrl);
    localized.protocol = cdpListUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    localized.pathname = advertised.pathname;
    localized.search = advertised.search;
    localized.hash = '';
    localized.username = '';
    localized.password = '';
    return localized.toString();
}

function selectPageDebuggerUrl(targetList, cdpListUrl) {
    if (!Array.isArray(targetList)) return { status: 'invalid-response', debuggerUrl: null };

    for (const target of targetList) {
        if (
            target
            && typeof target === 'object'
            && target.type === 'page'
            && typeof target.webSocketDebuggerUrl === 'string'
        ) {
            const debuggerUrl = localizeDebuggerUrl(target.webSocketDebuggerUrl, cdpListUrl);

            if (debuggerUrl) {
                return { status: 'ok', debuggerUrl };
            }
        }
    }

    return { status: 'ok', debuggerUrl: null };
}

function classifyException(message) {
    const className = message?.params?.exceptionDetails?.exception?.className;

    switch (className) {
        case 'RangeError':
            return 'range-error';
        case 'ReferenceError':
            return 'reference-error';
        case 'SyntaxError':
            return 'syntax-error';
        case 'TypeError':
            return 'type-error';
        case 'Error':
            return 'error';
        default:
            return 'unknown';
    }
}

function addSocketListener(socket, eventName, listener) {
    if (typeof socket.on === 'function') {
        socket.on(eventName, listener);
    } else {
        socket.addEventListener(eventName, listener);
    }
}

function unwrapSocketMessage(value) {
    const payload = value && typeof value === 'object' && 'data' in value ? value.data : value;

    if (typeof payload === 'string') return payload;
    if (Buffer.isBuffer(payload)) return payload.toString('utf8');
    if (payload instanceof ArrayBuffer) return Buffer.from(payload).toString('utf8');
    return null;
}

function fingerprintDebuggerUrl(debuggerUrl, salt) {
    return createHash('sha256')
        .update(salt)
        .update(debuggerUrl)
        .digest('hex');
}

function outputContainsAppId(output, appId) {
    const escaped = appId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const boundary = new RegExp(`(?:^|[\\s"'[,=:])${escaped}(?=$|[\\s"',}\\]])`, 'mu');
    return boundary.test(String(output || ''));
}

export function createAresRunningAppsQuery({
    aresLaunchScript,
    execFileImpl = execFile,
    timeoutMs = 5_000
} = {}) {
    const scriptPath = requireAresLaunchScript(aresLaunchScript);

    return (device, validationAppId) => new Promise(resolve => {
        const safeDevice = requireIdentifier(device, DEVICE_NAME_PATTERN, 'device name');
        const safeAppId = requireIdentifier(
            validationAppId,
            VALIDATION_APP_ID_PATTERN,
            'validation app id'
        );

        execFileImpl(
            process.execPath,
            [scriptPath, '-r', '-d', safeDevice],
            {
                encoding: 'utf8',
                maxBuffer: 64 * 1024,
                shell: false,
                timeout: timeoutMs,
                windowsHide: true
            },
            (error, stdout) => {
                if (!error) {
                    resolve({
                        appPresent: outputContainsAppId(stdout, safeAppId),
                        queryStatus: 'ok'
                    });
                    return;
                }

                if (error.code === 'ENOENT') {
                    resolve({ appPresent: null, queryStatus: 'command-unavailable' });
                } else if (error.killed || error.code === 'ETIMEDOUT') {
                    resolve({ appPresent: null, queryStatus: 'timeout' });
                } else {
                    resolve({ appPresent: null, queryStatus: 'error' });
                }
            }
        );
    });
}

export class ValidationProcessWatcher {
    constructor({
        appManagerPollMs = 2_000,
        aresLaunchScript,
        cdpListUrl,
        cdpPollMs = 500,
        createWebSocket = debuggerUrl => new WebSocket(debuggerUrl),
        device,
        emit,
        fetchImpl = globalThis.fetch,
        metricPollMs = 2_000,
        monotonicNow,
        queryRunningApps,
        sessionStartedAt,
        validationAppId,
        validationSession,
        wallNow
    }) {
        if (typeof fetchImpl !== 'function') throw new TypeError('Fetch implementation is required');
        if (typeof createWebSocket !== 'function') throw new TypeError('WebSocket factory is required');
        const safeDevice = requireIdentifier(device, DEVICE_NAME_PATTERN, 'device name');
        const safeAppId = requireIdentifier(
            validationAppId,
            VALIDATION_APP_ID_PATTERN,
            'validation app id'
        );
        const runningAppsQuery = queryRunningApps === undefined ?
            createAresRunningAppsQuery({ aresLaunchScript }) :
            queryRunningApps;

        if (typeof runningAppsQuery !== 'function') throw new TypeError('App-manager query is required');
        if (!isValidationSession(validationSession)) {
            throw new TypeError('Validation session is required');
        }

        this.cdpListUrl = normalizeLoopbackCdpListUrl(cdpListUrl);
        this.device = safeDevice;
        this.validationAppId = safeAppId;
        this.fetchImpl = fetchImpl;
        this.createWebSocket = createWebSocket;
        this.queryRunningApps = runningAppsQuery;
        this.record = createSynchronizedRecorder(emit, {
            monotonicNow,
            sessionStartedAt,
            validationSession,
            wallNow
        });
        this.cdpPollMs = cdpPollMs;
        this.appManagerPollMs = appManagerPollMs;
        this.metricPollMs = metricPollMs;

        this.fingerprintSalt = randomBytes(32);
        this.activeFingerprint = null;
        this.activeSocket = null;
        this.activeSocketGeneration = 0;
        this.activeSocketConnected = false;
        this.activeSocketErrorTimer = null;
        this.cdpQueryInFlight = null;
        this.appManagerQueryInFlight = null;
        this.lastCdpQueryStatus = null;
        this.nextCommandId = 0;
        this.nextMetricCycle = 0;
        this.pendingCommands = new Map();
        this.metricCycles = new Map();
        this.running = false;
        this.timers = new Set();
    }

    start() {
        if (this.running) return;

        this.running = true;
        this.record('watcher-status', { state: 'started' });
        this.record('system-log-status', { status: 'unavailable' });
        this.#scheduleLoop(() => this.pollCdpOnce(), 0, this.cdpPollMs);
        this.#scheduleLoop(() => this.pollAppManagerOnce(), 0, this.appManagerPollMs);
        this.#scheduleLoop(() => this.pollMetricsOnce(), this.metricPollMs, this.metricPollMs);
    }

    stop() {
        if (!this.running) return;

        this.running = false;

        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
        this.#disconnectSocket('watcher-stopped');
        this.record('watcher-status', { state: 'stopped' });
    }

    async pollCdpOnce() {
        if (this.cdpQueryInFlight) return this.cdpQueryInFlight;

        this.cdpQueryInFlight = this.#pollCdp();

        try {
            return await this.cdpQueryInFlight;
        } finally {
            this.cdpQueryInFlight = null;
        }
    }

    async #pollCdp() {
        let response;
        let targetList;

        try {
            response = await this.fetchImpl(this.cdpListUrl, { method: 'GET' });

            if (!response?.ok) {
                this.#recordCdpQueryStatus('unavailable');
                return;
            }

            targetList = await response.json();
        } catch {
            this.#recordCdpQueryStatus('unavailable');
            return;
        }

        const selection = selectPageDebuggerUrl(targetList, this.cdpListUrl);
        this.#recordCdpQueryStatus(selection.status);

        if (!selection.debuggerUrl) {
            if (this.activeFingerprint !== null) {
                this.#disconnectSocket('target-missing');
                this.activeFingerprint = null;
            }

            this.#recordTargetState('missing');
            return;
        }

        const fingerprint = fingerprintDebuggerUrl(selection.debuggerUrl, this.fingerprintSalt);

        if (this.activeFingerprint === null) {
            this.activeFingerprint = fingerprint;
            this.#recordTargetState('present');
            this.#connectSocket(selection.debuggerUrl);
        } else if (this.activeFingerprint !== fingerprint) {
            this.#disconnectSocket('target-replaced');
            this.activeFingerprint = fingerprint;
            this.#recordTargetState('replaced');
            this.#connectSocket(selection.debuggerUrl);
        } else if (!this.activeSocket) {
            this.#connectSocket(selection.debuggerUrl);
        }
    }

    async pollAppManagerOnce() {
        if (this.appManagerQueryInFlight) return this.appManagerQueryInFlight;

        this.appManagerQueryInFlight = this.#pollAppManager();

        try {
            return await this.appManagerQueryInFlight;
        } finally {
            this.appManagerQueryInFlight = null;
        }
    }

    async #pollAppManager() {
        let result;

        try {
            result = await this.queryRunningApps(this.device, this.validationAppId);
        } catch {
            result = { appPresent: null, queryStatus: 'error' };
        }

        this.record('app-manager-sample', {
            appPresent: result?.queryStatus === 'ok' ? Boolean(result.appPresent) : null,
            queryStatus: QUERY_STATUSES.has(result?.queryStatus) ? result.queryStatus : 'error'
        });
    }

    pollMetricsOnce() {
        if (!this.activeSocket || !this.activeSocketConnected) return false;

        const cycle = ++this.nextMetricCycle;
        const generation = this.activeSocketGeneration;
        this.metricCycles.set(cycle, {
            domComplete: false,
            domValues: null,
            generation,
            heapComplete: false,
            heapValues: null
        });
        this.#sendCommand('Memory.getDOMCounters', generation, { cycle, type: 'dom' });
        this.#sendCommand('Runtime.getHeapUsage', generation, { cycle, type: 'heap' });
        return true;
    }

    #recordCdpQueryStatus(status) {
        if (status === this.lastCdpQueryStatus) return;

        this.lastCdpQueryStatus = status;
        this.record('cdp-list-query', { status });
    }

    #recordTargetState(state) {
        if (this.lastTargetState === state && state !== 'replaced') return;

        this.lastTargetState = state;
        this.record('cdp-target', { state });
    }

    #connectSocket(debuggerUrl) {
        const generation = ++this.activeSocketGeneration;
        let socket;

        try {
            socket = this.createWebSocket(debuggerUrl);
        } catch {
            this.record('cdp-connection', {
                cause: 'socket-error',
                closeCode: null,
                closeCodeClass: 'not-applicable',
                state: 'disconnected'
            });
            return;
        }

        this.activeSocket = socket;
        this.activeSocketConnected = false;

        addSocketListener(socket, 'open', () => {
            if (generation !== this.activeSocketGeneration || socket !== this.activeSocket) return;

            this.activeSocketConnected = true;
            this.record('cdp-connection', {
                cause: 'socket-open',
                closeCode: null,
                closeCodeClass: 'not-applicable',
                state: 'connected'
            });
            this.#sendCommand('Runtime.enable', generation);
            this.#sendCommand('Inspector.enable', generation);
            this.pollMetricsOnce();
        });
        addSocketListener(socket, 'message', message => {
            this.#handleSocketMessage(message, generation);
        });
        addSocketListener(socket, 'error', () => {
            this.#handleSocketError(generation);
        });
        addSocketListener(socket, 'close', closeEventOrCode => {
            this.#handleSocketDisconnect(
                generation,
                'socket-close',
                normalizeSocketClose(closeEventOrCode)
            );
        });
    }

    #disconnectSocket(cause) {
        const socket = this.activeSocket;

        if (!socket) return;

        this.#clearSocketErrorTimer();
        this.activeSocketGeneration += 1;
        this.activeSocket = null;
        this.activeSocketConnected = false;
        this.pendingCommands.clear();
        this.metricCycles.clear();
        this.record('cdp-connection', {
            cause,
            closeCode: null,
            closeCodeClass: 'not-applicable',
            state: 'disconnected'
        });

        try {
            socket.close();
        } catch {
            // Closing the observer's own transport is best effort and never acts on the app.
        }
    }

    #handleSocketDisconnect(
        generation,
        cause,
        close = { closeCode: null, closeCodeClass: 'not-applicable' }
    ) {
        if (generation !== this.activeSocketGeneration || !this.activeSocket) return;

        this.#clearSocketErrorTimer();
        this.activeSocket = null;
        this.activeSocketConnected = false;
        this.pendingCommands.clear();
        this.metricCycles.clear();
        this.record('cdp-connection', {
            cause,
            closeCode: close.closeCode,
            closeCodeClass: close.closeCodeClass,
            state: 'disconnected'
        });
    }

    #handleSocketError(generation) {
        if (
            generation !== this.activeSocketGeneration
            || !this.activeSocket
            || this.activeSocketErrorTimer
        ) {
            return;
        }

        this.activeSocketConnected = false;
        this.record('cdp-connection', {
            cause: 'socket-error',
            closeCode: null,
            closeCodeClass: 'not-applicable',
            state: 'disconnected'
        });

        const timer = setTimeout(() => {
            this.timers.delete(timer);
            this.activeSocketErrorTimer = null;

            if (generation !== this.activeSocketGeneration || !this.activeSocket) return;

            this.activeSocket = null;
            this.pendingCommands.clear();
            this.metricCycles.clear();
        }, SOCKET_CLOSE_GRACE_MS);

        this.activeSocketErrorTimer = timer;
        this.timers.add(timer);
    }

    #clearSocketErrorTimer() {
        if (!this.activeSocketErrorTimer) return;

        clearTimeout(this.activeSocketErrorTimer);
        this.timers.delete(this.activeSocketErrorTimer);
        this.activeSocketErrorTimer = null;
    }

    #sendCommand(method, generation, pending = null) {
        if (
            generation !== this.activeSocketGeneration
            || !this.activeSocket
            || !this.activeSocketConnected
        ) {
            return null;
        }

        const id = ++this.nextCommandId;

        if (pending) {
            this.pendingCommands.set(id, { ...pending, generation });
        }

        try {
            this.activeSocket.send(JSON.stringify({ id, method }));
            return id;
        } catch {
            if (pending) this.pendingCommands.delete(id);
            this.#handleSocketDisconnect(generation, 'socket-error');
            return null;
        }
    }

    #handleSocketMessage(value, generation) {
        if (generation !== this.activeSocketGeneration) return;

        const serialized = unwrapSocketMessage(value);
        let message;

        if (!serialized) return;

        try {
            message = JSON.parse(serialized);
        } catch {
            return;
        }

        if (message?.method === 'Inspector.detached') {
            this.record('cdp-inspector', {
                detachedReason: classifyInspectorDetachedReason(message?.params?.reason),
                state: 'detached'
            });
            return;
        }

        if (message?.method === 'Inspector.targetCrashed') {
            this.record('cdp-inspector', {
                detachedReason: 'not-applicable',
                state: 'target-crashed'
            });
            return;
        }

        if (message?.method === 'Runtime.exceptionThrown') {
            this.record('cdp-exception', {
                exceptionCategory: classifyException(message)
            });
            return;
        }

        if (!Number.isSafeInteger(message?.id)) return;

        const pending = this.pendingCommands.get(message.id);

        if (!pending || pending.generation !== generation) return;
        this.pendingCommands.delete(message.id);
        this.#acceptMetricResponse(pending, message.result);
    }

    #acceptMetricResponse(pending, result) {
        const cycle = this.metricCycles.get(pending.cycle);

        if (!cycle || cycle.generation !== pending.generation) return;

        if (pending.type === 'dom') {
            cycle.domComplete = true;
            cycle.domValues = {
                documents: safeNullableCount(result?.documents),
                jsEventListeners: safeNullableCount(result?.jsEventListeners),
                nodes: safeNullableCount(result?.nodes)
            };
        } else {
            cycle.heapComplete = true;
            cycle.heapValues = {
                jsHeapTotalBytes: safeNullableCount(result?.totalSize),
                jsHeapUsedBytes: safeNullableCount(result?.usedSize)
            };
        }

        if (!cycle.domComplete || !cycle.heapComplete) return;

        this.metricCycles.delete(pending.cycle);
        this.record('cdp-resource-sample', {
            documents: cycle.domValues?.documents ?? null,
            jsEventListeners: cycle.domValues?.jsEventListeners ?? null,
            jsHeapTotalBytes: cycle.heapValues?.jsHeapTotalBytes ?? null,
            jsHeapUsedBytes: cycle.heapValues?.jsHeapUsedBytes ?? null,
            nodes: cycle.domValues?.nodes ?? null
        });
    }

    #scheduleLoop(operation, initialDelay, interval) {
        const schedule = delay => {
            const timer = setTimeout(async () => {
                this.timers.delete(timer);

                if (!this.running) return;

                await operation();

                if (this.running) schedule(interval);
            }, delay);

            this.timers.add(timer);
        };

        const run = () => {
            if (!this.running) return;
            schedule(initialDelay);
        };

        run();
    }
}

export function parseArguments(argv) {
    const options = {};
    let index = 0;

    while (index < argv.length) {
        const argument = argv[index];

        if (argument === '--help') return { help: true };
        const optionKey = CLI_OPTION_KEYS[argument];

        if (!optionKey) {
            throw new TypeError('Unknown watcher argument');
        }

        const value = argv[index + 1];

        if (!value) throw new TypeError('Missing watcher argument value');

        options[optionKey] = value;
        index += 2;
    }

    return options;
}

function printUsage() {
    process.stdout.write(
        'Usage: node scripts/ptv-webos-attribution/watcher.mjs '
        + '--cdp http://127.0.0.1:<port>/json '
        + '--ares-launch-script <absolute-path-to-ares-launch.js> '
        + '--device <configured-device> '
        + '--app-id <validation-app-id> '
        + '--session-started-at <ISO-8601-UTC> '
        + '--validation-session validation-<32-hex>\n'
    );
}

function runCli() {
    let options;

    try {
        options = parseArguments(process.argv.slice(2));

        if (options.help) {
            printUsage();
            return;
        }

        const watcher = new ValidationProcessWatcher({
            ...options,
            emit: record => process.stdout.write(`${JSON.stringify(record)}\n`)
        });

        const stop = () => {
            watcher.stop();
            process.exitCode = 0;
        };

        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
        watcher.start();
    } catch {
        process.stderr.write('Invalid validation watcher configuration.\n');
        process.exitCode = 1;
    }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    runCli();
}

/* eslint-enable compat/compat */
