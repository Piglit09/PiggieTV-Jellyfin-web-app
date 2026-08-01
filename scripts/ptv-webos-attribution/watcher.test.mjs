/* eslint-disable compat/compat, sonarjs/no-clear-text-protocols -- Node-only synthetic tests exercise loopback CDP and redaction of untrusted URLs. */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { resolve as resolvePath } from 'node:path';
import test from 'node:test';

import {
    createAresRunningAppsQuery,
    createSynchronizedRecorder,
    parseArguments,
    ValidationProcessWatcher
} from './watcher.mjs';

const VALIDATION_SESSION = 'validation-0123456789abcdef0123456789abcdef';
const SESSION_STARTED_AT = '2026-07-28T00:00:00.000Z';
const ARES_LAUNCH_SCRIPT = resolvePath('synthetic-tools', 'ares-launch.js');

class FakeSocket extends EventEmitter {
    constructor() {
        super();
        this.readyState = 0;
        this.sent = [];
    }

    open() {
        this.readyState = 1;
        this.emit('open');
    }

    message(value) {
        this.emit('message', JSON.stringify(value));
    }

    send(value) {
        this.sent.push(JSON.parse(value));
    }

    close() {
        this.readyState = 3;
        this.emit('close');
    }

    remoteClose(code, reason) {
        this.readyState = 3;
        this.emit('close', code, Buffer.from(reason));
    }

    remoteErrorThenClose(code, reason) {
        this.emit('error', new Error('private socket error detail'));
        this.remoteClose(code, reason);
    }
}

function okJson(value) {
    return {
        json: async () => value,
        ok: true
    };
}

function createWatcher(overrides = {}) {
    const records = [];
    let tick = 100;

    const watcher = new ValidationProcessWatcher({
        cdpListUrl: 'http://127.0.0.1:9222/json',
        createWebSocket: () => new FakeSocket(),
        device: 'synthetic-device',
        emit: record => records.push(record),
        fetchImpl: async () => okJson([]),
        monotonicNow: () => tick++,
        queryRunningApps: async () => ({
            appPresent: false,
            queryStatus: 'ok'
        }),
        sessionStartedAt: SESSION_STARTED_AT,
        validationAppId: 'com.piggietv.validation',
        validationSession: VALIDATION_SESSION,
        wallNow: () => Date.UTC(2026, 6, 28),
        ...overrides
    });

    return { records, watcher };
}

test('recorder anchors all source timestamps to one monotonic timeline', () => {
    const records = [];
    const ticks = [50, 55, 72];
    const record = createSynchronizedRecorder(value => records.push(value), {
        monotonicNow: () => ticks.shift(),
        sessionStartedAt: SESSION_STARTED_AT,
        validationSession: VALIDATION_SESSION,
        wallNow: () => Date.UTC(2026, 6, 28)
    });

    record('watcher-status', { state: 'started' });
    record('system-log-status', { status: 'unavailable' });

    assert.deepEqual(records.map(value => value.sessionMs), [5, 22]);
    assert.deepEqual(records.map(value => value.sequence), [1, 2]);
    assert.equal(records[0].observedAt, '2026-07-28T00:00:00.005Z');
    assert.equal(records[1].source, 'external-process-watcher');
    assert.ok(records.every(value => value.validationSession === VALIDATION_SESSION));
});

test('recorder uses the shared UTC session anchor when watcher startup is delayed', () => {
    const records = [];
    const ticks = [500, 507];
    const record = createSynchronizedRecorder(value => records.push(value), {
        monotonicNow: () => ticks.shift(),
        sessionStartedAt: SESSION_STARTED_AT,
        validationSession: VALIDATION_SESSION,
        wallNow: () => Date.UTC(2026, 6, 28, 0, 0, 12, 345)
    });

    record('watcher-status', { state: 'started' });

    assert.equal(records[0].sessionMs, 12_352);
    assert.equal(records[0].observedAt, '2026-07-28T00:00:12.352Z');
});

test('recorder rejects absent or malformed correlation inputs', () => {
    const emit = () => undefined;

    assert.throws(
        () => createSynchronizedRecorder(emit, {
            sessionStartedAt: SESSION_STARTED_AT
        }),
        /Validation session is required/u
    );
    assert.throws(
        () => createSynchronizedRecorder(emit, {
            sessionStartedAt: '2026-07-28T00:00:00-05:00',
            validationSession: VALIDATION_SESSION
        }),
        /UTC anchor/u
    );
    assert.throws(
        () => createWatcher({ validationSession: 'validation-private-value' }),
        /Validation session is required/u
    );
});

test('CLI accepts both required shared-correlation arguments', () => {
    assert.deepEqual(
        parseArguments([
            '--ares-launch-script',
            ARES_LAUNCH_SCRIPT,
            '--cdp',
            'http://127.0.0.1:9222/json',
            '--device',
            'synthetic-device',
            '--app-id',
            'com.piggietv.validation',
            '--session-started-at',
            SESSION_STARTED_AT,
            '--validation-session',
            VALIDATION_SESSION
        ]),
        {
            aresLaunchScript: ARES_LAUNCH_SCRIPT,
            cdpListUrl: 'http://127.0.0.1:9222/json',
            device: 'synthetic-device',
            sessionStartedAt: SESSION_STARTED_AT,
            validationAppId: 'com.piggietv.validation',
            validationSession: VALIDATION_SESSION
        }
    );
});

test('watcher rejects a non-loopback CDP endpoint', () => {
    assert.throws(
        () => createWatcher({ cdpListUrl: 'http://192.0.2.10:9222/json' }),
        /loopback-only/u
    );
});

test('CDP polling reports present, replaced, and missing without retaining identity fields', async () => {
    const secretTargetA = 'target-secret-a';
    const secretTargetB = 'target-secret-b';
    const targetLists = [
        [{
            id: secretTargetA,
            title: 'private title',
            type: 'page',
            url: 'http://private.invalid/private-path',
            webSocketDebuggerUrl: `ws://192.0.2.10:9999/devtools/page/${secretTargetA}`
        }],
        [{
            id: secretTargetA,
            title: 'private title',
            type: 'page',
            url: 'http://private.invalid/private-path',
            webSocketDebuggerUrl: `ws://192.0.2.10:9999/devtools/page/${secretTargetA}`
        }],
        [{
            id: secretTargetB,
            title: 'another private title',
            type: 'page',
            url: 'http://private.invalid/other-path',
            webSocketDebuggerUrl: `ws://192.0.2.11:9999/devtools/page/${secretTargetB}`
        }],
        []
    ];
    const sockets = [];
    const { records, watcher } = createWatcher({
        createWebSocket: () => {
            const socket = new FakeSocket();
            sockets.push(socket);
            return socket;
        },
        fetchImpl: async () => okJson(targetLists.shift())
    });

    await watcher.pollCdpOnce();
    await watcher.pollCdpOnce();
    await watcher.pollCdpOnce();
    await watcher.pollCdpOnce();

    assert.deepEqual(
        records.filter(value => value.kind === 'cdp-target').map(value => value.state),
        ['present', 'replaced', 'missing']
    );
    assert.equal(sockets.length, 2);

    const serialized = JSON.stringify(records);
    assert.doesNotMatch(serialized, /target-secret|private title|private-path|other-path/u);
    assert.doesNotMatch(serialized, /192\.0\.2\./u);
    assert.doesNotMatch(serialized, /webSocketDebuggerUrl|title|url|headers/u);
});

test('CDP socket records only safe exception category, inspector state, and aggregate counts', async () => {
    const socket = new FakeSocket();
    const { records, watcher } = createWatcher({
        createWebSocket: () => socket,
        fetchImpl: async () => okJson([{
            type: 'page',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/private-target'
        }])
    });

    await watcher.pollCdpOnce();
    socket.open();

    socket.message({
        method: 'Runtime.exceptionThrown',
        params: {
            exceptionDetails: {
                exception: {
                    className: 'TypeError',
                    description: 'private exception message'
                },
                stackTrace: { callFrames: [{ url: 'http://private.invalid/source.js' }] },
                text: 'private raw text'
            }
        }
    });
    socket.message({
        method: 'Inspector.detached',
        params: { reason: 'replaced_with_devtools private detail' }
    });
    socket.message({
        method: 'Inspector.targetCrashed',
        params: { status: 'private crash detail' }
    });

    const domCommand = socket.sent.find(value => value.method === 'Memory.getDOMCounters');
    const heapCommand = socket.sent.find(value => value.method === 'Runtime.getHeapUsage');

    assert.ok(domCommand);
    assert.ok(heapCommand);

    socket.message({
        id: domCommand.id,
        result: {
            documents: 4,
            jsEventListeners: 17,
            nodes: 208
        }
    });
    socket.message({
        id: heapCommand.id,
        result: {
            totalSize: 8_192,
            usedSize: 4_096
        }
    });

    assert.deepEqual(
        records.filter(value => value.kind === 'cdp-inspector').map(value => value.state),
        ['detached', 'target-crashed']
    );
    assert.deepEqual(
        records.filter(value => value.kind === 'cdp-inspector').map(value => value.detachedReason),
        ['replaced-by-another-debugger', 'not-applicable']
    );
    assert.deepEqual(
        records.find(value => value.kind === 'cdp-exception')?.exceptionCategory,
        'type-error'
    );
    assert.deepEqual(
        records.find(value => value.kind === 'cdp-resource-sample'),
        {
            documents: 4,
            jsEventListeners: 17,
            jsHeapTotalBytes: 8_192,
            jsHeapUsedBytes: 4_096,
            kind: 'cdp-resource-sample',
            nodes: 208,
            observedAt: '2026-07-28T00:00:00.007Z',
            sequence: 7,
            sessionMs: 7,
            source: 'external-process-watcher',
            validationSession: VALIDATION_SESSION
        }
    );

    const serialized = JSON.stringify(records);
    assert.doesNotMatch(serialized, /private|source\.js|detach reason|crash detail/u);
});

test('CDP socket close retains only numeric code and safe class, never close reason', async () => {
    const socket = new FakeSocket();
    const { records, watcher } = createWatcher({
        createWebSocket: () => socket,
        fetchImpl: async () => okJson([{
            type: 'page',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/private-target'
        }])
    });

    await watcher.pollCdpOnce();
    socket.open();
    socket.remoteClose(1_012, 'private renderer shutdown explanation');

    const closeRecord = records.find(value => (
        value.kind === 'cdp-connection'
        && value.cause === 'socket-close'
    ));

    assert.deepEqual(
        {
            closeCode: closeRecord?.closeCode,
            closeCodeClass: closeRecord?.closeCodeClass,
            state: closeRecord?.state
        },
        {
            closeCode: 1_012,
            closeCodeClass: 'service-restart',
            state: 'disconnected'
        }
    );
    assert.doesNotMatch(JSON.stringify(records), /private renderer|shutdown explanation|reason/u);
});

test('CDP socket error waits for close so the safe close code remains attributable', async () => {
    const socket = new FakeSocket();
    const { records, watcher } = createWatcher({
        createWebSocket: () => socket,
        fetchImpl: async () => okJson([{
            type: 'page',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/private-target'
        }])
    });

    await watcher.pollCdpOnce();
    socket.open();
    socket.remoteErrorThenClose(1_006, 'private crash-like transport explanation');

    assert.deepEqual(
        records.filter(value => value.kind === 'cdp-connection').map(value => ({
            cause: value.cause,
            closeCode: value.closeCode,
            closeCodeClass: value.closeCodeClass
        })),
        [
            {
                cause: 'socket-open',
                closeCode: null,
                closeCodeClass: 'not-applicable'
            },
            {
                cause: 'socket-error',
                closeCode: null,
                closeCodeClass: 'not-applicable'
            },
            {
                cause: 'socket-close',
                closeCode: 1_006,
                closeCodeClass: 'abnormal-closure'
            }
        ]
    );
    assert.doesNotMatch(
        JSON.stringify(records),
        /private socket|private crash-like|transport explanation/u
    );
});

test('app-manager polling shares one in-flight query and emits only presence plus status', async () => {
    let release;
    let calls = 0;
    const pending = new Promise(resolve => {
        release = resolve;
    });
    const { records, watcher } = createWatcher({
        queryRunningApps: async () => {
            calls += 1;
            await pending;
            return {
                appPresent: true,
                queryStatus: 'ok',
                rawOutput: 'must never be retained'
            };
        }
    });

    const first = watcher.pollAppManagerOnce();
    const second = watcher.pollAppManagerOnce();
    release();
    await Promise.all([first, second]);

    assert.equal(calls, 1);
    assert.deepEqual(
        records.filter(value => value.kind === 'app-manager-sample').map(value => ({
            appPresent: value.appPresent,
            queryStatus: value.queryStatus
        })),
        [{ appPresent: true, queryStatus: 'ok' }]
    );
    assert.doesNotMatch(JSON.stringify(records), /rawOutput|must never/u);
});

test('ares query invokes the absolute JavaScript entrypoint without a shell and discards raw output', async () => {
    const calls = [];
    const query = createAresRunningAppsQuery({
        aresLaunchScript: ARES_LAUNCH_SCRIPT,
        execFileImpl: (command, args, options, callback) => {
            calls.push({ args, command, options });
            callback(
                null,
                'running apps:\ncom.piggietv.validation\nprivate-unrelated-output',
                ''
            );
        }
    });

    const result = await query('synthetic-device', 'com.piggietv.validation');

    assert.deepEqual(result, {
        appPresent: true,
        queryStatus: 'ok'
    });
    assert.equal(calls[0].command, process.execPath);
    assert.deepEqual(
        calls[0].args,
        [ARES_LAUNCH_SCRIPT, '-r', '-d', 'synthetic-device']
    );
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.windowsHide, true);
    assert.doesNotMatch(JSON.stringify(result), /private-unrelated-output/u);
});

test('ares query reports unavailable official command without inventing app state', async () => {
    const query = createAresRunningAppsQuery({
        aresLaunchScript: ARES_LAUNCH_SCRIPT,
        execFileImpl: (_command, _args, _options, callback) => {
            const error = new Error('raw command error');
            error.code = 'ENOENT';
            callback(error, 'raw stdout', 'raw stderr');
        }
    });

    assert.deepEqual(
        await query('synthetic-device', 'com.piggietv.validation'),
        {
            appPresent: null,
            queryStatus: 'command-unavailable'
        }
    );
});

test('ares query rejects unsafe script paths and identifiers before process launch', async () => {
    assert.throws(
        () => createAresRunningAppsQuery({
            aresLaunchScript: 'relative/ares-launch.js'
        }),
        /Invalid ares-launch script path/u
    );
    assert.throws(
        () => createAresRunningAppsQuery({
            aresLaunchScript: resolvePath('synthetic-tools', 'other.js')
        }),
        /Invalid ares-launch script path/u
    );

    let processLaunches = 0;
    const query = createAresRunningAppsQuery({
        aresLaunchScript: ARES_LAUNCH_SCRIPT,
        execFileImpl: () => {
            processLaunches += 1;
        }
    });

    await assert.rejects(
        query('synthetic-device;unsafe', 'com.piggietv.validation'),
        /Invalid device name/u
    );
    await assert.rejects(
        query('synthetic-device', 'com.piggietv.validation;unsafe'),
        /Invalid validation app id/u
    );
    assert.equal(processLaunches, 0);
});

/* eslint-enable compat/compat, sonarjs/no-clear-text-protocols */
