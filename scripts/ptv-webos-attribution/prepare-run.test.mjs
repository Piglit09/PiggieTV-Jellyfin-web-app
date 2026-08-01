import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { prepareAttributionRun } from './prepare-run.mjs';

function hash(value) {
    return createHash('sha256').update(value).digest('hex');
}

test('prepares a private-value-free run identity without changing the static artifacts', t => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'ptv-attribution-run-'));
    t.after(() => {
        const resolved = resolve(temporaryRoot);
        if (resolved.startsWith(resolve(tmpdir()))) rmSync(resolved, { force: true, recursive: true });
    });

    const dist = join(temporaryRoot, 'dist');
    const output = join(temporaryRoot, 'evidence', 'run-01');
    const values = new Map([
        ['index.html', '<!doctype html><title>PRIVATE-TITLE-SENTINEL</title>'],
        ['runtime.bundle.js', 'window.runtimeSentinel = "PRIVATE-RUNTIME-SENTINEL";'],
        ['main.jellyfin.bundle.js', 'window.bundleSentinel = "PRIVATE-BUNDLE-SENTINEL";']
    ]);
    mkdirSync(dist, { recursive: true });
    for (const [name, value] of values) writeFileSync(join(dist, name), value);

    const result = prepareAttributionRun({
        dist,
        output,
        workspace: temporaryRoot
    });
    const session = JSON.parse(readFileSync(join(output, 'session.json'), 'utf8'));
    const identity = JSON.parse(readFileSync(join(output, 'build-identity.json'), 'utf8'));
    const persisted = JSON.stringify({ identity, session });

    assert.match(result.validationSession, /^validation-[0-9a-f]{32}$/u);
    assert.equal(session.validationSession, result.validationSession);
    assert.equal(identity.validationSession, result.validationSession);
    assert.deepEqual(
        identity.artifacts.map(artifact => ({
            name: artifact.name,
            sha256: artifact.sha256
        })),
        Array.from(values, ([name, value]) => ({
            name,
            sha256: hash(value)
        }))
    );
    assert.doesNotMatch(persisted, /PRIVATE-/u);
    assert.throws(
        () => prepareAttributionRun({ dist, output, workspace: temporaryRoot }),
        /already exists/u
    );
});

test('refuses output inside the served static distribution', t => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'ptv-attribution-run-boundary-'));
    t.after(() => {
        const resolved = resolve(temporaryRoot);
        if (resolved.startsWith(resolve(tmpdir()))) rmSync(resolved, { force: true, recursive: true });
    });
    const dist = join(temporaryRoot, 'dist');
    mkdirSync(dist, { recursive: true });
    for (const name of ['index.html', 'runtime.bundle.js', 'main.jellyfin.bundle.js']) {
        writeFileSync(join(dist, name), name);
    }

    assert.throws(
        () => prepareAttributionRun({
            dist,
            output: join(dist, 'evidence'),
            workspace: temporaryRoot
        }),
        /outside the static distribution/u
    );
});
