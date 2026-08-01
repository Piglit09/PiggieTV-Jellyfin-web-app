// Node-only tests use synthetic identifiers and a fake exec implementation.

import assert from 'node:assert/strict';
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import process from 'node:process';

import {
    LAUNCH_BOUNDARY_USAGE,
    parseLaunchBoundaryArguments,
    recordValidationLaunch
} from './launch-boundary.mjs';

const VALIDATION_SESSION = 'validation-0123456789abcdef0123456789abcdef';
const SESSION_STARTED_AT = '2026-07-28T02:00:00.000Z';

function temporaryDirectory(t) {
    const directory = mkdtempSync(join(tmpdir(), 'ptv-launch-boundary-'));
    t.after(() => {
        rmSync(directory, { force: true, recursive: true });
    });
    return directory;
}

function parseManifest(path) {
    return readFileSync(path, 'utf8')
        .trim()
        .split(/\r?\n/u)
        .filter(Boolean)
        .map(line => JSON.parse(line));
}

function syntheticOptions(output, execFileImpl) {
    const monotonicValues = [100, 100, 125];
    const aresLaunchScript = join(output, '..', 'ares-launch.js');
    writeFileSync(aresLaunchScript, '// synthetic test script\n', 'utf8');
    return {
        aresLaunchScript,
        device: 'Synthetic-LG',
        execFileImpl,
        monotonicNow: () => monotonicValues.shift() ?? 125,
        output,
        sessionStartedAt: SESSION_STARTED_AT,
        timeoutMs: 5_000,
        validationAppId: 'com.example.validation',
        validationSession: VALIDATION_SESSION,
        wallNow: () => Date.parse(SESSION_STARTED_AT) + 5_000
    };
}

test('successful launch writes a durable privacy-safe boundary and discards raw command output', async t => {
    const directory = temporaryDirectory(t);
    const output = join(directory, 'run-manifest.ndjson');
    const calls = [];
    const fakeExec = (command, args, options, callback) => {
        calls.push({ args, command, options });
        callback(
            null,
            'PRIVATE-TITLE PRIVATE-URL com.example.validation Synthetic-LG',
            'PRIVATE-TOKEN PRIVATE-STDERR'
        );
    };

    const result = await recordValidationLaunch(syntheticOptions(output, fakeExec));
    assert.deepEqual(result, {
        commandSucceeded: true,
        recordsWritten: 2,
        validationSession: VALIDATION_SESSION
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, process.execPath);
    assert.deepEqual(
        calls[0].args,
        [
            join(directory, 'ares-launch.js'),
            '-d',
            'Synthetic-LG',
            'com.example.validation'
        ]
    );
    assert.deepEqual(
        {
            maxBuffer: calls[0].options.maxBuffer,
            shell: calls[0].options.shell,
            timeout: calls[0].options.timeout,
            windowsHide: calls[0].options.windowsHide
        },
        {
            maxBuffer: 8 * 1024,
            shell: false,
            timeout: 5_000,
            windowsHide: true
        }
    );

    const records = parseManifest(output);
    assert.deepEqual(records.map(record => record.state), ['requested', 'succeeded']);
    assert.deepEqual(records.map(record => record.commandSucceeded), [null, true]);
    assert.deepEqual(records.map(record => record.sequence), [1, 2]);
    assert.deepEqual(records.map(record => record.sessionMs), [5_000, 5_025]);
    assert.deepEqual(
        records.map(record => record.observedAt),
        ['2026-07-28T02:00:05.000Z', '2026-07-28T02:00:05.025Z']
    );
    assert.ok(records.every(record => (
        record.category === 'app-launch'
        && record.documentGeneration === 0
        && record.schemaVersion === 1
        && record.source === 'external-launch-boundary'
        && record.validationSession === VALIDATION_SESSION
    )));

    const serialized = readFileSync(output, 'utf8');
    assert.doesNotMatch(
        serialized,
        /PRIVATE|Synthetic-LG|com\.example\.validation|ares-launch|https?:|token|stderr/iu
    );
});

test('failed launch persists only a safe boolean and never raw errors or output', async t => {
    const directory = temporaryDirectory(t);
    const output = join(directory, 'run-manifest.ndjson');
    const fakeExec = (_command, _args, _options, callback) => {
        const rawError = new Error('PRIVATE command failure with device, app, token, and URL');
        callback(rawError, 'PRIVATE RAW STDOUT', 'PRIVATE RAW STDERR');
    };

    const result = await recordValidationLaunch(syntheticOptions(output, fakeExec));
    assert.equal(result.commandSucceeded, false);

    const records = parseManifest(output);
    assert.deepEqual(records.map(record => record.state), ['requested', 'failed']);
    assert.deepEqual(records.map(record => record.commandSucceeded), [null, false]);
    assert.doesNotMatch(
        readFileSync(output, 'utf8'),
        /PRIVATE|command failure|STDOUT|STDERR|device|token|URL/u
    );
});

test('existing output and unsafe correlation inputs fail before invoking the command', async t => {
    const directory = temporaryDirectory(t);
    const existingOutput = join(directory, 'existing.ndjson');
    writeFileSync(existingOutput, 'retained\n', 'utf8');
    let calls = 0;
    const fakeExec = () => {
        calls += 1;
    };

    await assert.rejects(
        recordValidationLaunch(syntheticOptions(existingOutput, fakeExec)),
        /already exists/u
    );
    assert.equal(readFileSync(existingOutput, 'utf8'), 'retained\n');

    const invalidOutput = join(directory, 'invalid.ndjson');
    await assert.rejects(
        recordValidationLaunch({
            ...syntheticOptions(invalidOutput, fakeExec),
            validationSession: 'PRIVATE-SESSION'
        }),
        /validation session/u
    );
    assert.equal(existsSync(invalidOutput), false);

    await assert.rejects(
        recordValidationLaunch({
            ...syntheticOptions(invalidOutput, fakeExec),
            aresLaunchScript: join(directory, 'not-ares-launch.js')
        }),
        /ares-launch script path/u
    );
    await assert.rejects(
        recordValidationLaunch({
            ...syntheticOptions(invalidOutput, fakeExec),
            aresLaunchScript: 'ares-launch.js'
        }),
        /ares-launch script path/u
    );
    assert.equal(calls, 0);
});

test('CLI parser requires the absolute launcher script and shared correlation fields', () => {
    const absoluteScript = join(process.cwd(), 'synthetic', 'ares-launch.js');
    assert.deepEqual(
        parseLaunchBoundaryArguments([
            '--device', 'Synthetic-LG',
            '--app-id', 'com.example.validation',
            '--output', 'manifest.ndjson',
            '--validation-session', VALIDATION_SESSION,
            '--session-started-at', SESSION_STARTED_AT,
            '--ares-launch-script', absoluteScript,
            '--timeout-ms', '5000'
        ]),
        {
            aresLaunchScript: absoluteScript,
            device: 'Synthetic-LG',
            output: 'manifest.ndjson',
            sessionStartedAt: SESSION_STARTED_AT,
            timeoutMs: '5000',
            validationAppId: 'com.example.validation',
            validationSession: VALIDATION_SESSION
        }
    );
    assert.match(LAUNCH_BOUNDARY_USAGE, /--device <configured-device>/u);
    assert.match(LAUNCH_BOUNDARY_USAGE, /--app-id <validation-app-id>/u);
    assert.match(
        LAUNCH_BOUNDARY_USAGE,
        /--ares-launch-script <absolute-path-to-ares-launch\.js>/u
    );
    assert.match(LAUNCH_BOUNDARY_USAGE, /--session-started-at <ISO-8601-UTC>/u);
    assert.throws(
        () => parseLaunchBoundaryArguments(['--device', 'Synthetic-LG']),
        /Missing required/u
    );
});
