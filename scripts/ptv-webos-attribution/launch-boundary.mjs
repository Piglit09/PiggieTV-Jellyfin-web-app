/* eslint-disable compat/compat -- Validation-only Node.js launcher; it is never bundled for supported browsers. */

import { execFile } from 'node:child_process';
import {
    closeSync,
    existsSync,
    fsyncSync,
    mkdirSync,
    openSync,
    realpathSync,
    statSync,
    writeSync
} from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

import { isValidationSession } from './protocol.mjs';

const SOURCE = 'external-launch-boundary';
const DEFAULT_TIMEOUT_MS = 10_000;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;
const SESSION_STARTED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CLI_OPTION_KEYS = Object.freeze({
    '--app-id': 'validationAppId',
    '--ares-launch-script': 'aresLaunchScript',
    '--device': 'device',
    '--output': 'output',
    '--session-started-at': 'sessionStartedAt',
    '--timeout-ms': 'timeoutMs',
    '--validation-session': 'validationSession'
});

export const LAUNCH_BOUNDARY_USAGE = [
    'Usage: node scripts/ptv-webos-attribution/launch-boundary.mjs',
    '--device <configured-device>',
    '--app-id <validation-app-id>',
    '--output <new-manifest.ndjson>',
    '--validation-session validation-<32-hex>',
    '--session-started-at <ISO-8601-UTC>',
    '--ares-launch-script <absolute-path-to-ares-launch.js>',
    '[--timeout-ms 10000]'
].join(' ');

function fail(message) {
    throw new TypeError(message);
}

function requireIdentifier(value, name) {
    if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
        fail(`Invalid ${name}`);
    }
    return value;
}

function requireSessionStartedAt(value) {
    if (
        typeof value !== 'string'
        || !SESSION_STARTED_AT_PATTERN.test(value)
        || Number.isNaN(Date.parse(value))
    ) {
        fail('Invalid session start');
    }
    return Date.parse(value);
}

function requireTimeout(value) {
    const timeout = value === undefined ? DEFAULT_TIMEOUT_MS : Number(value);
    if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 60_000) {
        fail('Invalid launch timeout');
    }
    return timeout;
}

function requireAresLaunchScript(value) {
    if (typeof value !== 'string' || !isAbsolute(value)) {
        fail('Invalid ares-launch script path');
    }

    const requestedPath = resolve(value);
    if (
        basename(requestedPath).toLowerCase() !== 'ares-launch.js'
        || !existsSync(requestedPath)
        || !statSync(requestedPath).isFile()
    ) {
        fail('Invalid ares-launch script path');
    }

    const realPath = realpathSync(requestedPath);
    if (basename(realPath).toLowerCase() !== 'ares-launch.js') {
        fail('Invalid ares-launch script path');
    }
    return realPath;
}

function requireOutput(value) {
    if (typeof value !== 'string' || !value.trim()) fail('Invalid manifest output');
    const output = resolve(value);
    if (existsSync(output)) fail('Launch manifest already exists');
    return output;
}

function writeAll(handle, payload) {
    let offset = 0;
    while (offset < payload.length) {
        const written = writeSync(handle, payload, offset, payload.length - offset, null);
        if (!Number.isSafeInteger(written) || written <= 0) {
            throw new Error('Launch manifest write failed');
        }
        offset += written;
    }
}

function createDurableRecorder({
    handle,
    monotonicNow,
    sessionStartedAt,
    validationSession,
    wallNow
}) {
    const sessionStartedWallMs = requireSessionStartedAt(sessionStartedAt);
    const monotonicOrigin = monotonicNow();
    const wallOrigin = wallNow();
    const sessionOffsetMs = Math.max(0, Math.round(wallOrigin - sessionStartedWallMs));
    let lastSessionMs = sessionOffsetMs;
    let sequence = 0;

    return (state, commandSucceeded) => {
        const elapsed = Math.max(0, Math.round(monotonicNow() - monotonicOrigin));
        const sessionMs = Math.max(lastSessionMs, sessionOffsetMs + elapsed);
        lastSessionMs = sessionMs;

        const record = Object.freeze({
            category: 'app-launch',
            commandSucceeded,
            documentGeneration: 0,
            observedAt: new Date(sessionStartedWallMs + sessionMs).toISOString(),
            schemaVersion: 1,
            sequence: ++sequence,
            sessionMs,
            source: SOURCE,
            state,
            validationSession
        });
        const payload = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
        writeAll(handle, payload);
        fsyncSync(handle);
        return record;
    };
}

function invokeAresLaunch({
    aresLaunchScript,
    device,
    execFileImpl,
    timeoutMs,
    validationAppId
}) {
    return new Promise(resolveLaunch => {
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            resolveLaunch(!error);
        };

        try {
            execFileImpl(
                process.execPath,
                [aresLaunchScript, '-d', device, validationAppId],
                {
                    encoding: 'utf8',
                    maxBuffer: 8 * 1024,
                    shell: false,
                    timeout: timeoutMs,
                    windowsHide: true
                },
                error => finish(error)
            );
        } catch (error) {
            finish(error);
        }
    });
}

export function parseLaunchBoundaryArguments(argv) {
    const values = {};
    let index = 0;

    while (index < argv.length) {
        const argument = argv[index];
        if (argument === '--help') return { help: true };

        const optionKey = CLI_OPTION_KEYS[argument];
        if (!optionKey || Object.prototype.hasOwnProperty.call(values, optionKey)) {
            fail('Invalid launch-boundary argument');
        }

        const value = argv[index + 1];
        if (!value || value.startsWith('--')) fail('Missing launch-boundary argument value');
        values[optionKey] = value;
        index += 2;
    }

    for (const required of [
        'aresLaunchScript',
        'device',
        'output',
        'sessionStartedAt',
        'validationAppId',
        'validationSession'
    ]) {
        if (!Object.prototype.hasOwnProperty.call(values, required)) {
            fail('Missing required launch-boundary argument');
        }
    }

    return values;
}

export async function recordValidationLaunch({
    aresLaunchScript,
    device,
    execFileImpl = execFile,
    monotonicNow = () => performance.now(),
    output,
    sessionStartedAt,
    timeoutMs,
    validationAppId,
    validationSession,
    wallNow = () => Date.now()
}) {
    const safeAresLaunchScript = requireAresLaunchScript(aresLaunchScript);
    const safeDevice = requireIdentifier(device, 'device');
    const safeValidationAppId = requireIdentifier(validationAppId, 'validation app id');
    const safeOutput = requireOutput(output);
    const safeTimeoutMs = requireTimeout(timeoutMs);

    if (!isValidationSession(validationSession)) fail('Invalid validation session');
    requireSessionStartedAt(sessionStartedAt);
    if (typeof execFileImpl !== 'function') fail('Invalid exec implementation');
    if (typeof monotonicNow !== 'function' || typeof wallNow !== 'function') {
        fail('Invalid clock implementation');
    }

    mkdirSync(dirname(safeOutput), { recursive: true });
    const handle = openSync(safeOutput, 'wx');
    let commandSucceeded = false;
    let recordsWritten = 0;

    try {
        const record = createDurableRecorder({
            handle,
            monotonicNow,
            sessionStartedAt,
            validationSession,
            wallNow
        });
        record('requested', null);
        recordsWritten += 1;

        commandSucceeded = await invokeAresLaunch({
            aresLaunchScript: safeAresLaunchScript,
            device: safeDevice,
            execFileImpl,
            timeoutMs: safeTimeoutMs,
            validationAppId: safeValidationAppId
        });
        record(commandSucceeded ? 'succeeded' : 'failed', commandSucceeded);
        recordsWritten += 1;
    } finally {
        try {
            fsyncSync(handle);
        } finally {
            closeSync(handle);
        }
    }

    return Object.freeze({
        commandSucceeded,
        recordsWritten,
        validationSession
    });
}

async function main() {
    try {
        const options = parseLaunchBoundaryArguments(process.argv.slice(2));
        if (options.help) {
            process.stdout.write(`${LAUNCH_BOUNDARY_USAGE}\n`);
            return;
        }

        const result = await recordValidationLaunch(options);
        process.stdout.write(`launch-boundary-complete:${JSON.stringify(result)}\n`);
        if (!result.commandSucceeded) process.exitCode = 1;
    } catch {
        process.stderr.write('Validation launch-boundary recording failed.\n');
        process.exitCode = 1;
    }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    void main();
}

/* eslint-enable compat/compat */
