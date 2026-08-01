/* eslint-disable compat/compat, sonarjs/no-clear-text-protocols -- Node-only tests intentionally exercise the loopback HTTP validation boundary. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync
} from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

import { JSDOM } from 'jsdom';

import {
    ATTRIBUTION_CATEGORIES,
    ATTRIBUTION_SCHEMA_VERSION,
    AttributionProtocolError,
    createServerRecord,
    validateRendererEnvelope
} from './protocol.mjs';
import { startAttributionServer } from './server.mjs';

const OBSERVER_SOURCE = readFileSync(
    resolve(import.meta.dirname, 'observer.js'),
    'utf8'
);
const SERVER_SOURCE = readFileSync(
    resolve(import.meta.dirname, 'server.mjs'),
    'utf8'
);
const VALIDATION_SESSION = `validation-${'a'.repeat(32)}`;
const PIPELINE_STAGES = [
    'browser-event-received',
    'event-classified',
    'key-normalized',
    'platform-mapping-applied',
    'action-resolved',
    'focus-handler-reached',
    'handler-rejected',
    'current-candidate-resolved',
    'target-search-started',
    'target-found',
    'target-rejected',
    'focus-movement-requested',
    'focus-event-observed',
    'movement-confirmed',
    'movement-timed-out',
    'completed'
];

function heartbeatData(overrides = {}) {
    return {
        activeFocus: 'body',
        appCreateCount: 1,
        controlsVisible: false,
        listenerRegistrationCount: 4,
        presentationCategory: 'idle',
        readyState: 'complete',
        routeFamily: 'home',
        routeGeneration: 1,
        runtimeCreateCount: 1,
        runtimePresent: true,
        runtimeReady: true,
        videoPaused: null,
        videoPresent: false,
        visibilityState: 'visible',
        ...overrides
    };
}

function backData(overrides = {}) {
    return {
        controlsVisible: false,
        defaultPrevented: false,
        duplicate: false,
        handlerReached: false,
        historyClass: 'single',
        inputSource: 'synthetic-test',
        propagationStopped: false,
        repeat: false,
        routeFamily: 'home',
        stage: 'capture',
        trusted: false,
        ...overrides
    };
}

function envelope(overrides = {}) {
    return {
        category: 'heartbeat',
        data: heartbeatData(),
        documentGeneration: 1,
        documentMs: 10,
        documentSeq: 1,
        schemaVersion: ATTRIBUTION_SCHEMA_VERSION,
        state: 'alive',
        validationSession: VALIDATION_SESSION,
        ...overrides
    };
}

function sha256(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function directoryHashes(root) {
    const hashes = {};

    function walk(directory) {
        for (const entry of readdirSync(directory)) {
            const path = join(directory, entry);
            if (statSync(path).isDirectory()) walk(path);
            else hashes[relative(root, path)] = sha256(path);
        }
    }

    walk(root);
    return hashes;
}

function httpCall({ body, headers = {}, method = 'GET', path = '/', port }) {
    return new Promise((resolveCall, rejectCall) => {
        const req = request({
            headers,
            host: '127.0.0.1',
            method,
            path,
            port
        }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                resolveCall({
                    body: Buffer.concat(chunks).toString('utf8'),
                    headers: response.headers,
                    status: response.statusCode
                });
            });
        });
        req.once('error', rejectCall);
        if (body !== undefined) req.end(body);
        else req.end();
    });
}

function wait(milliseconds) {
    return new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
}

function parseJsonLines(path) {
    const text = readFileSync(path, 'utf8').trim();
    return text ? text.split(/\r?\n/u).map(line => JSON.parse(line)) : [];
}

function installObserverHarness() {
    const dom = new JSDOM('<!doctype html><html><head></head><body><button id="target">Target</button></body></html>', {
        runScripts: 'outside-only',
        url: 'http://192.168.1.50:8123/#/home'
    });
    const { window } = dom;
    const records = [];
    const intervalCallbacks = [];
    const stockCallbacks = [];
    let stockRegistrationCount = 0;

    class FakeXMLHttpRequest {
        open(method, url, asynchronous) {
            this.method = method;
            this.url = url;
            this.asynchronous = asynchronous;
        }

        setRequestHeader() {
            return undefined;
        }

        send(body) {
            records.push(JSON.parse(body));
            if (typeof this.onload === 'function') this.onload();
        }
    }

    Object.defineProperty(window, 'XMLHttpRequest', {
        configurable: true,
        value: FakeXMLHttpRequest
    });
    Object.defineProperty(window.navigator, 'sendBeacon', {
        configurable: true,
        value: () => false
    });
    window.setInterval = callback => {
        intervalCallbacks.push(callback);
        return intervalCallbacks.length;
    };
    window.Events = {
        on(target, name, callback) {
            assert.equal(target, window.document);
            assert.equal(name, 'SHOW_VIDEO_OSD');
            stockRegistrationCount += 1;
            stockCallbacks.push(callback);
        }
    };
    window.__PTV_ATTRIBUTION_BOOTSTRAP__ = {
        documentGeneration: 1,
        enabled: true,
        endpoint: '/_ptv-attribution/events',
        validationSession: VALIDATION_SESSION
    };
    window.document.documentElement.dataset.ptvRoutePageType = 'home';
    window.eval(OBSERVER_SOURCE);

    return {
        close: () => dom.window.close(),
        dom,
        intervalCallbacks,
        records,
        stockCallbacks,
        stockRegistrationCount: () => stockRegistrationCount,
        window
    };
}

test('protocol exposes only the exact category allowlist and requires a safe top-level state', () => {
    assert.deepEqual(ATTRIBUTION_CATEGORIES, [
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

    const accepted = validateRendererEnvelope(envelope(), {
        maximumDocumentGeneration: 1,
        validationSession: VALIDATION_SESSION
    });
    assert.equal(accepted.state, 'alive');
    assert.equal(accepted.data.presentationCategory, 'idle');

    const missingState = envelope();
    delete missingState.state;
    assert.throws(
        () => validateRendererEnvelope(missingState, {
            maximumDocumentGeneration: 1,
            validationSession: VALIDATION_SESSION
        }),
        AttributionProtocolError
    );
    assert.throws(
        () => validateRendererEnvelope(envelope({ state: 'arbitrary-private-value' }), {
            maximumDocumentGeneration: 1,
            validationSession: VALIDATION_SESSION
        }),
        AttributionProtocolError
    );
});

test('protocol rejects unknown/private fields, mismatched states, and non-enum route values', () => {
    const privateField = envelope({
        data: {
            ...heartbeatData(),
            mediaTitle: 'PRIVATE SENTINEL TITLE'
        }
    });
    assert.throws(
        () => validateRendererEnvelope(privateField, {
            maximumDocumentGeneration: 1,
            validationSession: VALIDATION_SESSION
        }),
        /unknown-field/u
    );

    assert.throws(
        () => validateRendererEnvelope(envelope({
            category: 'route-family',
            data: {
                routeFamily: 'http://192.168.1.2/private',
                routeGeneration: 1,
                source: 'hashchange'
            },
            state: 'home'
        }), {
            maximumDocumentGeneration: 1,
            validationSession: VALIDATION_SESSION
        }),
        /invalid-enum/u
    );
    assert.throws(
        () => validateRendererEnvelope(envelope({
            category: 'back-received',
            data: backData({ stage: 'final' }),
            state: 'capture'
        }), {
            maximumDocumentGeneration: 1,
            validationSession: VALIDATION_SESSION
        }),
        /state-data-mismatch/u
    );
});

test('server records have absolute time, strict state, and same-session correlation fields', () => {
    const observedAt = '2026-07-27T12:00:00.000Z';
    const record = createServerRecord({
        category: 'document-start',
        data: {},
        documentGeneration: 1,
        observedAt,
        seq: 1,
        sessionMs: 0,
        state: 'served',
        validationSession: VALIDATION_SESSION
    });

    assert.equal(record.observedAt, observedAt);
    assert.equal(record.validationSession, VALIDATION_SESSION);
    assert.throws(
        () => createServerRecord({
            ...record,
            observedAt: 'local/private/time',
            seq: 2
        }),
        /invalid-observed-at/u
    );
});

test('observer is idempotent, passive, privacy-safe, and distinguishes Back pipeline stages', async t => {
    const harness = installObserverHarness();
    t.after(harness.close);
    const {
        intervalCallbacks,
        records,
        stockCallbacks,
        window
    } = harness;
    const startupCount = records.length;

    assert.equal(harness.stockRegistrationCount(), 1);
    assert.equal(intervalCallbacks.length, 1);
    assert.equal(records[0].category, 'document-start');
    assert.equal(records[0].state, 'observer-installed');
    assert.ok(records.some(record => (
        record.category === 'document-start'
        && record.state === 'observer-installed'
    )));
    assert.ok(records.some(record => (
        record.category === 'heartbeat'
        && record.state === 'alive'
        && record.data.presentationCategory === 'idle'
    )));

    window.eval(OBSERVER_SOURCE);
    assert.equal(records.length, startupCount);
    assert.equal(harness.stockRegistrationCount(), 1);

    const target = window.document.getElementById('target');
    let reachedTarget = 0;
    let preventCalls = 0;
    let stopCalls = 0;
    let stopImmediateCalls = 0;
    let focusCalls = 0;
    let historyBackCalls = 0;
    const originalFocus = window.HTMLElement.prototype.focus;

    window.HTMLElement.prototype.focus = function passiveFocusSpy() {
        focusCalls += 1;
        return originalFocus.call(this);
    };
    Object.defineProperty(window.history, 'back', {
        configurable: true,
        value: () => {
            historyBackCalls += 1;
        }
    });
    target.addEventListener('keydown', () => {
        reachedTarget += 1;
    });

    const backEvent = new window.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Escape'
    });
    const originalPreventDefault = backEvent.preventDefault.bind(backEvent);
    const originalStopPropagation = backEvent.stopPropagation.bind(backEvent);
    const originalStopImmediatePropagation = backEvent.stopImmediatePropagation.bind(backEvent);
    backEvent.preventDefault = () => {
        preventCalls += 1;
        return originalPreventDefault();
    };
    backEvent.stopPropagation = () => {
        stopCalls += 1;
        return originalStopPropagation();
    };
    backEvent.stopImmediatePropagation = () => {
        stopImmediateCalls += 1;
        return originalStopImmediatePropagation();
    };

    const beforeBack = records.length;
    target.dispatchEvent(backEvent);
    await wait(5);
    const backRecords = records.slice(beforeBack).filter(record => record.category === 'back-received');

    assert.equal(reachedTarget, 1);
    assert.equal(preventCalls, 0);
    assert.equal(stopCalls, 0);
    assert.equal(stopImmediateCalls, 0);
    assert.equal(focusCalls, 0);
    assert.equal(historyBackCalls, 0);
    assert.equal(backEvent.defaultPrevented, false);
    assert.deepEqual(
        backRecords.map(record => record.state),
        ['capture', 'bubble', 'final']
    );
    assert.ok(backRecords.every(record => record.data.routeFamily === 'home'));

    const beforeCommand = records.length;
    target.dispatchEvent(new window.CustomEvent('command', {
        bubbles: true,
        cancelable: true,
        detail: {
            command: 'back',
            privateInputId: 'PRIVATE-INPUT-SENTINEL'
        }
    }));
    const commandRecords = records.slice(beforeCommand);
    assert.equal(
        commandRecords.filter(record => (
            record.category === 'back-received'
            && record.state === 'command'
        )).length,
        1
    );
    assert.equal(commandRecords.some(record => record.category === 'back-owner'), false);
    assert.equal(commandRecords.some(record => record.category === 'playback-exit-requested'), false);

    const beforePipeline = records.length;
    for (const stage of PIPELINE_STAGES) {
        window.dispatchEvent(new window.CustomEvent('ptv:focus-diagnostic', {
            detail: {
                detail: {
                    defaultPreventedAfter: stage === 'completed',
                    defaultPreventedBefore: false,
                    duplicate: stage === 'handler-rejected',
                    handlerReached: stage !== 'browser-event-received',
                    inputId: 'PRIVATE-INPUT-SENTINEL',
                    inputSource: 'webos-remote',
                    inputStage: stage,
                    keyCategory: 'back',
                    propagationStopped: stage === 'completed',
                    repeat: false
                },
                name: 'ptv-tv-input-pipeline'
            }
        }));
    }
    const pipelineRecords = records.slice(beforePipeline).filter(record => (
        record.category === 'back-received'
        && record.state === 'focus-pipeline'
    ));
    assert.deepEqual(
        pipelineRecords.map(record => record.data.stage),
        PIPELINE_STAGES
    );
    assert.doesNotMatch(JSON.stringify(pipelineRecords), /PRIVATE-INPUT-SENTINEL/u);

    window.document.documentElement.dataset.ptvRoutePageType = '';
    window.history.replaceState({}, '', '#/music');
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    window.history.replaceState({}, '', '#/movies');
    window.dispatchEvent(new window.PopStateEvent('popstate'));
    assert.ok(records.some(record => (
        record.category === 'route-family'
        && record.data.source === 'hashchange'
        && record.state === 'music'
    )));
    assert.ok(records.some(record => (
        record.category === 'route-family'
        && record.data.source === 'popstate'
        && record.state === 'movies'
    )));

    const beforeHideSources = records.length;
    stockCallbacks[0](null, false);
    window.dispatchEvent(new window.CustomEvent('ptv:focus-diagnostic', {
        detail: {
            detail: { backOwner: 'video-controls' },
            name: 'ptv-tv-focus-back'
        }
    }));
    const hideRequests = records.slice(beforeHideSources).filter(record => (
        record.category === 'controls-hide-requested'
        && record.state === 'observed'
    ));
    assert.deepEqual(
        hideRequests.map(record => record.data.source),
        ['show-video-osd', 'ptv-focus-owner']
    );

    const dock = window.document.createElement('div');
    dock.className = 'ptv-media-dock';
    dock.dataset.ptvPlaybackSurface = 'mini-player';
    window.document.body.append(dock);
    window.document.documentElement.classList.add('ptv-playing');
    intervalCallbacks[0]();
    assert.ok(records.some(record => (
        record.category === 'heartbeat'
        && record.data.presentationCategory === 'audio-mini'
    )));

    for (const record of records) {
        validateRendererEnvelope(record, {
            maximumDocumentGeneration: 1,
            validationSession: VALIDATION_SESSION
        });
    }
    assert.doesNotMatch(JSON.stringify(records), /PRIVATE-INPUT-SENTINEL/u);
    window.HTMLElement.prototype.focus = originalFocus;
});

test('document-bubble Back observation disappears when an existing target owner stops propagation', async t => {
    const harness = installObserverHarness();
    t.after(harness.close);
    const { records, window } = harness;
    const target = window.document.getElementById('target');

    target.addEventListener('keydown', event => {
        event.preventDefault();
        event.stopPropagation();
    });
    const before = records.length;
    target.dispatchEvent(new window.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Escape'
    }));
    await wait(5);

    const observed = records.slice(before).filter(record => record.category === 'back-received');
    assert.deepEqual(observed.map(record => record.state), ['capture', 'final']);
    assert.equal(observed[0].data.defaultPrevented, false);
    assert.equal(observed[1].data.defaultPrevented, true);
});

test('server enforces LAN/same-origin/privacy boundaries, fsync sequencing, generations, and unchanged hashes', async t => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'ptv-attribution-'));
    t.after(() => {
        const resolved = resolve(temporaryRoot);
        if (resolved.startsWith(resolve(tmpdir()))) rmSync(resolved, { force: true, recursive: true });
    });
    const staticRoot = join(temporaryRoot, 'static');
    const output = join(temporaryRoot, 'evidence', 'events.jsonl');
    mkdirSync(staticRoot, { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><html><head></head><body>Validation</body></html>');
    writeFileSync(join(staticRoot, 'bundle.js'), 'window.validationBundle = true;\n');
    const hashesBefore = directoryHashes(staticRoot);

    await assert.rejects(
        startAttributionServer({
            allowLoopbackForTests: true,
            bind: '0.0.0.0',
            output: join(temporaryRoot, 'invalid-bind.jsonl'),
            port: 0,
            root: staticRoot
        }),
        /explicit private-LAN IPv4/u
    );
    await assert.rejects(
        startAttributionServer({
            allowLoopbackForTests: true,
            bind: '127.0.0.1',
            output: join(staticRoot, 'must-not-write.jsonl'),
            port: 0,
            root: staticRoot
        }),
        /outside the served static root/u
    );

    const sessionStartedAt = new Date(Date.now() - 1000).toISOString();
    const server = await startAttributionServer({
        allowLoopbackForTests: true,
        bind: '127.0.0.1',
        disconnectMs: 500,
        output,
        port: 0,
        root: staticRoot,
        sessionStartedAt,
        validationSession: VALIDATION_SESSION
    });
    t.after(server.close);

    assert.deepEqual(server.sessionAnchor, {
        observedAt: sessionStartedAt,
        validationSession: VALIDATION_SESSION
    });

    const head = await httpCall({ method: 'HEAD', port: server.port });
    assert.equal(head.status, 200);
    assert.equal(parseJsonLines(output).length, 0);

    const firstIndex = await httpCall({ port: server.port });
    assert.equal(firstIndex.status, 200);
    assert.match(firstIndex.body, /__PTV_ATTRIBUTION_BOOTSTRAP__/u);
    assert.match(firstIndex.body, /\/_ptv-attribution\/observer\.js/u);
    let persisted = parseJsonLines(output);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].category, 'document-start');
    assert.equal(persisted[0].documentGeneration, 1);
    assert.equal(persisted[0].state, 'served');

    const heartbeat = JSON.stringify(envelope({
        data: heartbeatData(),
        documentSeq: 1
    }));
    const accepted = await httpCall({
        body: heartbeat,
        headers: {
            'Content-Type': 'application/json',
            Origin: server.origin
        },
        method: 'POST',
        path: '/_ptv-attribution/events',
        port: server.port
    });
    assert.equal(accepted.status, 204);
    persisted = parseJsonLines(output);
    assert.equal(persisted.at(-1).category, 'heartbeat');
    assert.equal(persisted.at(-1).state, 'alive');

    const privateSentinel = 'PRIVATE-MEDIA-TITLE-SENTINEL';
    const rejected = await httpCall({
        body: JSON.stringify(envelope({
            data: {
                ...heartbeatData(),
                title: privateSentinel
            },
            documentSeq: 2
        })),
        headers: {
            'Content-Type': 'application/json',
            Origin: server.origin
        },
        method: 'POST',
        path: '/_ptv-attribution/events',
        port: server.port
    });
    assert.equal(rejected.status, 400);
    assert.doesNotMatch(readFileSync(output, 'utf8'), new RegExp(privateSentinel, 'u'));

    const wrongOrigin = await httpCall({
        body: heartbeat,
        headers: {
            'Content-Type': 'application/json',
            Host: 'evil.invalid',
            Origin: 'http://evil.invalid'
        },
        method: 'POST',
        path: '/_ptv-attribution/events',
        port: server.port
    });
    assert.equal(wrongOrigin.status, 403);

    const secondIndex = await httpCall({ port: server.port });
    assert.equal(secondIndex.status, 200);
    persisted = parseJsonLines(output);
    assert.ok(persisted.some(record => (
        record.category === 'document-recreated'
        && record.documentGeneration === 2
        && record.state === 'served'
    )));

    await wait(1100);
    await server.close();
    persisted = parseJsonLines(output);
    assert.ok(persisted.some(record => (
        record.category === 'renderer-disconnected'
        && record.documentGeneration === 2
        && record.state === 'heartbeat-timeout'
    )));
    assert.deepEqual(
        persisted.map(record => record.seq),
        persisted.map((_record, index) => index + 1)
    );
    assert.ok(persisted.every(record => (
        record.validationSession === VALIDATION_SESSION
        && /^\d{4}-\d{2}-\d{2}T/u.test(record.observedAt)
    )));
    assert.deepEqual(directoryHashes(staticRoot), hashesBefore);
    assert.doesNotMatch(readFileSync(output, 'utf8'), /192\.168\.|PRIVATE-/u);

    const readyOutput = SERVER_SOURCE.slice(SERVER_SOURCE.indexOf('attribution-ready:'));
    assert.doesNotMatch(readyOutput, /attribution\.origin/u);
});
/* eslint-enable compat/compat, sonarjs/no-clear-text-protocols */
