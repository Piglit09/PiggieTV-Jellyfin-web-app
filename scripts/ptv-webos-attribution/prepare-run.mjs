/* eslint-disable sonarjs/no-os-command-from-path -- Validation-only helper uses the configured Git CLI and persists no raw command output. */

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
    closeSync,
    existsSync,
    fsyncSync,
    mkdirSync,
    openSync,
    readFileSync,
    statSync,
    writeSync
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const REQUIRED_ARTIFACTS = Object.freeze([
    'index.html',
    'runtime.bundle.js',
    'main.jellyfin.bundle.js'
]);

function fail(message) {
    throw new TypeError(message);
}

function isWithin(parent, child) {
    const path = relative(parent, child);
    return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function writeDurableJson(path, value) {
    const handle = openSync(path, 'wx');

    try {
        const payload = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
        let offset = 0;

        while (offset < payload.length) {
            const written = writeSync(handle, payload, offset, payload.length - offset, null);
            if (!Number.isSafeInteger(written) || written <= 0) {
                throw new Error('Evidence write failed');
            }
            offset += written;
        }
        fsyncSync(handle);
    } finally {
        closeSync(handle);
    }
}

function sha256(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function safeGitIdentity(workspace) {
    try {
        const commit = execFileSync(
            'git',
            ['rev-parse', 'HEAD'],
            {
                cwd: workspace,
                encoding: 'utf8',
                maxBuffer: 64 * 1024,
                shell: false,
                stdio: ['ignore', 'pipe', 'ignore'],
                windowsHide: true
            }
        ).trim();
        const status = execFileSync(
            'git',
            ['status', '--porcelain=v1', '--untracked-files=normal'],
            {
                cwd: workspace,
                encoding: 'utf8',
                maxBuffer: 1024 * 1024,
                shell: false,
                stdio: ['ignore', 'pipe', 'ignore'],
                windowsHide: true
            }
        );

        return {
            commit: /^[0-9a-f]{40}$/u.test(commit) ? commit : null,
            dirty: status.length > 0,
            statusEntryCount: status.split(/\r?\n/u).filter(Boolean).length
        };
    } catch {
        return {
            commit: null,
            dirty: null,
            statusEntryCount: null
        };
    }
}

function parseArguments(argv) {
    const values = {};

    for (let index = 0; index < argv.length; index += 2) {
        const name = argv[index];
        const value = argv[index + 1];

        if (!['--dist', '--output', '--workspace'].includes(name) || !value) {
            fail('Invalid prepare-run arguments');
        }
        if (Object.prototype.hasOwnProperty.call(values, name)) {
            fail('Duplicate prepare-run argument');
        }
        values[name] = value;
    }

    for (const required of ['--dist', '--output', '--workspace']) {
        if (!values[required]) fail('Missing prepare-run argument');
    }

    return {
        dist: values['--dist'],
        output: values['--output'],
        workspace: values['--workspace']
    };
}

export function prepareAttributionRun({
    dist,
    output,
    workspace
}) {
    const safeWorkspace = resolve(workspace);
    const safeDist = resolve(dist);
    const safeOutput = resolve(output);

    if (!existsSync(safeWorkspace) || !statSync(safeWorkspace).isDirectory()) {
        fail('Workspace is unavailable');
    }
    if (!isWithin(safeWorkspace, safeDist) || !existsSync(safeDist) || !statSync(safeDist).isDirectory()) {
        fail('Static distribution is unavailable');
    }
    if (!isWithin(safeWorkspace, safeOutput) || isWithin(safeDist, safeOutput)) {
        fail('Evidence output must be inside the workspace and outside the static distribution');
    }
    if (existsSync(safeOutput)) fail('Evidence output already exists');

    const artifacts = REQUIRED_ARTIFACTS.map(name => {
        const path = resolve(safeDist, name);
        if (!isWithin(safeDist, path) || !existsSync(path) || !statSync(path).isFile()) {
            fail('Required static artifact is unavailable');
        }

        return {
            name,
            sha256: sha256(path),
            sizeBytes: statSync(path).size
        };
    });
    const validationSession = `validation-${randomBytes(16).toString('hex')}`;
    const sessionStartedAt = new Date().toISOString();

    mkdirSync(safeOutput, { recursive: true });
    writeDurableJson(resolve(safeOutput, 'session.json'), {
        schemaVersion: 1,
        sessionStartedAt,
        validationSession
    });
    writeDurableJson(resolve(safeOutput, 'build-identity.json'), {
        artifacts,
        capturedAt: sessionStartedAt,
        git: safeGitIdentity(safeWorkspace),
        schemaVersion: 1,
        validationSession
    });

    return Object.freeze({
        output: safeOutput,
        sessionStartedAt,
        validationSession
    });
}

async function main() {
    try {
        const result = prepareAttributionRun(parseArguments(process.argv.slice(2)));
        process.stdout.write(`attribution-run-prepared:${JSON.stringify({
            sessionStartedAt: result.sessionStartedAt,
            validationSession: result.validationSession
        })}\n`);
    } catch {
        process.stderr.write('Attribution run preparation failed.\n');
        process.exitCode = 1;
    }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    void main();
}

/* eslint-enable sonarjs/no-os-command-from-path */
