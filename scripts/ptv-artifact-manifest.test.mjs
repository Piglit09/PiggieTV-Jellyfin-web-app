import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildManifest, verifyManifest, canonicalDigest } from './ptv-artifact-manifest.mjs';

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ptv-artifact-manifest.mjs');

function fixture() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ptv-manifest-'));
    const sourceRoot = path.join(base, 'source');
    const artifactRoot = path.join(base, 'artifact');
    fs.mkdirSync(sourceRoot);
    fs.mkdirSync(artifactRoot);
    fs.mkdirSync(path.join(sourceRoot, 'src/ptv/plugin/Jellyfin.Plugin.PiggieTV'), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, 'ptv-version.json'), '{"version":"0.5.71"}\n');
    fs.writeFileSync(path.join(sourceRoot, 'package.json'), '{"version":"10.11.11"}\n');
    fs.writeFileSync(path.join(sourceRoot, 'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj'), '<Project><PropertyGroup><PtvPluginVersion>0.5.22.0</PtvPluginVersion></PropertyGroup></Project>');
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Disposable fixture Git uses the test runner's trusted PATH.
    const git = (...args) => execFileSync('git', args, { cwd: sourceRoot, encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'ignore' ] }).trim();
    git('init', '-q');
    git('config', 'user.name', 'PTV fixture');
    git('config', 'user.email', 'ptv-fixture@example.invalid');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    const commit = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(artifactRoot, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(artifactRoot, 'config.json'), '{}');
    fs.mkdirSync(path.join(artifactRoot, 'assets'));
    fs.writeFileSync(path.join(artifactRoot, 'assets', 'logo.svg'), '<svg/>');
    fs.writeFileSync(path.join(artifactRoot, 'main.jellyfin.bundle.js'), `const sourceCommit = '${commit}';`);
    return { artifactRoot, base, commit, sourceRoot };
}

function withFixture(run) {
    const data = fixture();
    try {
        return run(data);
    } finally {
        fs.rmSync(data.base, { recursive: true, force: true });
    }
}

const options = data => ({ artifactRoot: data.artifactRoot, sourceRoot: data.sourceRoot, projectId: 'PTV_WEB', buildMode: 'production', createdAt: '2026-10-14T00:00:00.000Z' });

test('records every final file, versions, full commit and a deterministic digest', () => withFixture(data => {
    const manifest = buildManifest(options(data));
    assert.equal(manifest.sourceCommit, data.commit);
    assert.equal(manifest.sourceDirty, false);
    assert.equal(manifest.sourceRoot, fs.realpathSync.native(data.sourceRoot));
    assert.deepEqual(manifest.sourceVersions, { web: '0.5.71', plugin: '0.5.22.0', package: '10.11.11' });
    assert.deepEqual(manifest.files.map(file => file.path), [ 'assets/logo.svg', 'config.json', 'index.html', 'main.jellyfin.bundle.js' ]);
    assert.equal(manifest.manifestDigest, canonicalDigest(manifest));
    assert.deepEqual(buildManifest(options(data)), manifest);
    assert.equal(verifyManifest(manifest, options(data)), true);
}));

test('rejects modified, missing and extra final package files', () => withFixture(data => {
    const manifest = buildManifest(options(data));
    fs.writeFileSync(path.join(data.artifactRoot, 'config.json'), '{"changed":true}');
    assert.throws(() => verifyManifest(manifest, options(data)), /hash|size/u);
    fs.writeFileSync(path.join(data.artifactRoot, 'config.json'), '{}');
    fs.rmSync(path.join(data.artifactRoot, 'assets', 'logo.svg'));
    assert.throws(() => verifyManifest(manifest, options(data)), /inventory/u);
    fs.writeFileSync(path.join(data.artifactRoot, 'assets', 'logo.svg'), '<svg/>');
    fs.writeFileSync(path.join(data.artifactRoot, 'extra.txt'), 'extra');
    assert.throws(() => verifyManifest(manifest, options(data)), /inventory/u);
}));

test('post-transformation bytes need their own final manifest', () => withFixture(data => {
    const before = buildManifest(options(data));
    fs.writeFileSync(path.join(data.artifactRoot, 'config.json'), '{"server":"isolated"}');
    assert.throws(() => verifyManifest(before, options(data)), /hash|size/u);
    const after = buildManifest({ ...options(data), buildMode: 'transformed-production' });
    assert.notEqual(after.manifestDigest, before.manifestDigest);
    assert.equal(verifyManifest(after, { ...options(data), buildMode: 'transformed-production' }), true);
}));

test('rejects symlinked package entries and path traversal in a forged manifest', () => withFixture(data => {
    const link = path.join(data.artifactRoot, 'linked');
    fs.symlinkSync(path.join(data.artifactRoot, 'assets'), link, 'junction');
    assert.throws(() => buildManifest(options(data)), /symlink|reparse/u);
    fs.rmdirSync(link);
    const manifest = buildManifest(options(data));
    manifest.files[0].path = '../outside';
    manifest.manifestDigest = canonicalDigest(manifest);
    assert.throws(() => verifyManifest(manifest, options(data)), /path/u);
}));

test('rejects dirty release sources and an artifact without embedded Web commit', () => withFixture(data => {
    fs.writeFileSync(path.join(data.sourceRoot, 'extra.txt'), 'dirty');
    assert.throws(() => buildManifest(options(data)), /clean/u);
    fs.rmSync(path.join(data.sourceRoot, 'extra.txt'));
    fs.writeFileSync(path.join(data.artifactRoot, 'main.jellyfin.bundle.js'), 'const sourceCommit = "forged";');
    assert.throws(() => buildManifest(options(data)), /embedded.*commit/u);
}));

test('rejects forged manifest digest and different current Git HEAD', () => withFixture(data => {
    const manifest = buildManifest(options(data));
    manifest.sourceCommit = 'f'.repeat(40);
    assert.throws(() => verifyManifest(manifest, options(data)), /digest/u);
    const valid = buildManifest(options(data));
    fs.writeFileSync(path.join(data.sourceRoot, 'new.txt'), 'new');
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Disposable fixture Git uses the test runner's trusted PATH.
    execFileSync('git', [ 'add', 'new.txt' ], { cwd: data.sourceRoot });
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Disposable fixture Git uses the test runner's trusted PATH.
    execFileSync('git', [ 'commit', '-qm', 'new' ], { cwd: data.sourceRoot });
    assert.throws(() => verifyManifest(valid, options(data)), /source commit/u);
}));

test('standalone create denies an unauthorized clean fixture before writing an artifact manifest', () => withFixture(data => {
    const manifestPath = path.join(data.base, 'final-manifest.json');
    assert.throws(() => execFileSync(process.execPath, [ scriptPath, 'create', '--artifact', data.artifactRoot, '--source-root', data.sourceRoot, '--mode', 'production', '--output', manifestPath ], { stdio: 'ignore' }));
    assert.equal(fs.existsSync(manifestPath), false);
    fs.writeFileSync(manifestPath, JSON.stringify(buildManifest(options(data))));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.sourceCommit, data.commit);
    execFileSync(process.execPath, [ scriptPath, 'verify', '--artifact', data.artifactRoot, '--source-root', data.sourceRoot, '--manifest', manifestPath ]);
    fs.writeFileSync(path.join(data.artifactRoot, 'extra.bin'), 'tampered');
    assert.throws(() => execFileSync(process.execPath, [ scriptPath, 'verify', '--artifact', data.artifactRoot, '--source-root', data.sourceRoot, '--manifest', manifestPath ], { stdio: 'ignore' }));
}));

test('standalone create permits the approved local development root', () => {
    const sourceRoot = path.resolve(path.dirname(scriptPath), '..');
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ptv-authorized-manifest-'));
    const artifactRoot = path.join(base, 'artifact');
    const manifestPath = path.join(base, 'manifest.json');
    try {
        fs.mkdirSync(artifactRoot);
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- Read-only Git checks use the test runner's trusted PATH.
        const git = (...args) => execFileSync('git', args, { cwd: sourceRoot, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
        const embedded = git('rev-parse', 'HEAD') + (git('status', '--porcelain=v1', '--untracked-files=normal') ? '-dirty' : '');
        fs.writeFileSync(path.join(artifactRoot, 'index.html'), '<html></html>');
        fs.writeFileSync(path.join(artifactRoot, 'config.json'), '{}');
        fs.writeFileSync(path.join(artifactRoot, 'main.jellyfin.bundle.js'), `const commit = '${embedded}';`);
        execFileSync(process.execPath, [ scriptPath, 'create', '--artifact', artifactRoot, '--source-root', sourceRoot, '--mode', 'development', '--output', manifestPath ], { cwd: sourceRoot, stdio: 'pipe' });
        execFileSync(process.execPath, [ scriptPath, 'verify', '--artifact', artifactRoot, '--source-root', sourceRoot, '--manifest', manifestPath ], { cwd: sourceRoot, stdio: 'pipe' });
        assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).sourceCommit, embedded.replace(/-dirty$/u, ''));
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test('Plugin artifact binds archive hash, source commit and Plugin version', () => withFixture(data => {
    fs.rmSync(data.artifactRoot, { recursive: true });
    fs.mkdirSync(data.artifactRoot);
    const tar = Buffer.from('fixture archive bytes');
    fs.writeFileSync(path.join(data.artifactRoot, 'PiggieTV.tar'), tar);
    const packageManifest = {
        sourceCommit: data.commit,
        version: '0.5.22.0',
        archiveSha256: crypto.createHash('sha256').update(tar).digest('hex')
    };
    fs.writeFileSync(path.join(data.artifactRoot, 'package-manifest.json'), JSON.stringify(packageManifest));
    const pluginOptions = { ...options(data), projectId: 'PTV_PLUGIN', buildMode: 'package' };
    const manifest = buildManifest(pluginOptions);
    assert.equal(verifyManifest(manifest, pluginOptions), true);
    packageManifest.archiveSha256 = '0'.repeat(64);
    fs.writeFileSync(path.join(data.artifactRoot, 'package-manifest.json'), JSON.stringify(packageManifest));
    assert.throws(() => buildManifest(pluginOptions), /archive hash/u);
}));
