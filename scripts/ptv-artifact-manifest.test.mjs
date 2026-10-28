import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildManifest, verifyManifest, canonicalDigest, sourceTreeDirty } from './ptv-artifact-manifest.mjs';

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ptv-artifact-manifest.mjs');
const pinnedGit = process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : '/usr/bin/git';

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

test('manifest verification ignores a checkout-controlled filesystem monitor', () => withFixture(data => {
    const manifest = buildManifest(options(data));
    const marker = path.join(data.base, 'fsmonitor-ran.txt');
    const monitor = path.join(data.base, 'fsmonitor.cjs');
    fs.writeFileSync(monitor, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.exit(1);`);
    execFileSync(pinnedGit, [ 'config', 'core.fsmonitor', `"${process.execPath}" "${monitor}"` ],
        { cwd: data.sourceRoot });
    execFileSync(pinnedGit, [ 'status', '--porcelain=v1' ], { cwd: data.sourceRoot });
    assert.equal(fs.existsSync(marker), true, 'fixture must prove Git would execute the monitor');
    fs.rmSync(marker);
    assert.equal(verifyManifest(manifest, options(data)), true);
    assert.equal(fs.existsSync(marker), false);
}));

test('manifest verification does not execute a checkout-controlled clean filter', () => withFixture(data => {
    const tracked = path.join(data.sourceRoot, 'ptv-version.json');
    const marker = path.join(data.base, 'clean-filter-ran.txt');
    const filter = path.join(data.base, 'clean-filter.cjs');
    fs.writeFileSync(path.join(data.sourceRoot, '.gitattributes'), 'ptv-version.json filter=marker\n');
    execFileSync(pinnedGit, [ 'add', '.gitattributes' ], { cwd: data.sourceRoot });
    execFileSync(pinnedGit, [ 'commit', '-qm', 'fixture attributes' ], { cwd: data.sourceRoot });
    data.commit = execFileSync(pinnedGit, [ 'rev-parse', 'HEAD' ], { cwd: data.sourceRoot, encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(data.artifactRoot, 'main.jellyfin.bundle.js'), `const sourceCommit = '${data.commit}';`);
    const manifest = buildManifest(options(data));
    fs.writeFileSync(filter, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.stdin.pipe(process.stdout);`);
    execFileSync(pinnedGit, [ 'config', 'filter.marker.clean', `"${process.execPath}" "${filter}"` ],
        { cwd: data.sourceRoot });
    fs.utimesSync(tracked, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    execFileSync(pinnedGit, [ '-c', 'core.fsmonitor=false', 'status', '--porcelain=v1' ], { cwd: data.sourceRoot });
    assert.equal(fs.existsSync(marker), true, 'fixture must prove Git status would execute the filter');
    fs.rmSync(marker);
    assert.equal(verifyManifest(manifest, options(data)), true);
    assert.equal(fs.existsSync(marker), false);
    fs.writeFileSync(tracked, '{"version":"0.5.71"} \n');
    assert.equal(sourceTreeDirty(data.sourceRoot), true);
    assert.equal(fs.existsSync(marker), false);
}));

test('cleanliness accepts only Git-authorized CRLF normalization', () => withFixture(data => {
    const tracked = path.join(data.sourceRoot, 'ptv-version.json');
    fs.writeFileSync(path.join(data.sourceRoot, '.gitattributes'), 'ptv-version.json text\n');
    execFileSync(pinnedGit, [ 'add', '.gitattributes' ], { cwd: data.sourceRoot });
    execFileSync(pinnedGit, [ 'commit', '-qm', 'fixture attributes' ], { cwd: data.sourceRoot });
    fs.writeFileSync(tracked, '{"version":"0.5.71"}\r\n');
    assert.equal(sourceTreeDirty(data.sourceRoot), false);
    fs.writeFileSync(path.join(data.sourceRoot, '.gitattributes'), 'ptv-version.json -text\n');
    execFileSync(pinnedGit, [ 'add', '.gitattributes' ], { cwd: data.sourceRoot });
    execFileSync(pinnedGit, [ 'commit', '-qm', 'disable text conversion' ], { cwd: data.sourceRoot });
    assert.equal(sourceTreeDirty(data.sourceRoot), true);
}));

test('cleanliness rejects unrelated untracked files and a clean nested contract checkout', () => withFixture(data => {
    assert.equal(sourceTreeDirty(data.sourceRoot), false);
    const unrelated = path.join(data.sourceRoot, 'untracked.txt');
    fs.writeFileSync(unrelated, 'untracked fixture');
    assert.equal(sourceTreeDirty(data.sourceRoot), true);
    fs.unlinkSync(unrelated);
    assert.equal(sourceTreeDirty(data.sourceRoot), false);

    const checkout = path.join(data.sourceRoot, '.contract-repositories', 'mobile');
    fs.mkdirSync(checkout, { recursive: true });
    const git = (...args) => execFileSync(pinnedGit, [ '-c', 'core.hooksPath=/dev/null', ...args ], {
        cwd: checkout, encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'ignore' ]
    }).trim();
    git('init', '-q');
    fs.writeFileSync(path.join(checkout, 'contract.json'), '{"fixture":true}\n');
    git('add', 'contract.json');
    git('-c', 'user.name=PTV fixture', '-c', 'user.email=ptv-fixture@example.invalid', 'commit', '-qm', 'nested fixture');
    assert.equal(git('status', '--porcelain=v1'), '');
    assert.equal(sourceTreeDirty(data.sourceRoot), true);
}));

test('cleanliness rejects a tracked symlink or reparse path', context => withFixture(data => {
    const tracked = path.join(data.sourceRoot, 'src/ptv/plugin/Jellyfin.Plugin.PiggieTV');
    const outside = path.join(data.base, 'outside-directory');
    fs.renameSync(tracked, outside);
    try {
        fs.symlinkSync(outside, tracked, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        if (error.code === 'EPERM') {
            context.skip('This Windows token cannot create junctions');
            return;
        }
        throw error;
    }
    assert.equal(sourceTreeDirty(data.sourceRoot), true);
}));

test('cleanliness never lazy-fetches a missing object through a configured transport', () => withFixture(data => {
    const marker = path.join(data.base, 'transport-ran.txt');
    const helper = path.join(data.base, 'transport.cjs');
    fs.writeFileSync(helper, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.exit(1);`);
    const extCommand = `ext::${process.execPath.replaceAll('\\', '/')} ${helper.replaceAll('\\', '/')}`;
    execFileSync(pinnedGit, [ 'config', 'remote.origin.url', extCommand ], { cwd: data.sourceRoot });
    execFileSync(pinnedGit, [ 'config', 'remote.origin.promisor', 'true' ], { cwd: data.sourceRoot });
    execFileSync(pinnedGit, [ 'config', 'remote.origin.partialclonefilter', 'blob:none' ], { cwd: data.sourceRoot });
    execFileSync(pinnedGit, [ 'config', 'extensions.partialClone', 'origin' ], { cwd: data.sourceRoot });
    execFileSync(pinnedGit, [ 'config', 'protocol.ext.allow', 'always' ], { cwd: data.sourceRoot });
    const tree = execFileSync(pinnedGit, [ 'rev-parse', 'HEAD^{tree}' ],
        { cwd: data.sourceRoot, encoding: 'utf8' }).trim();
    const object = path.join(data.sourceRoot, '.git', 'objects', tree.slice(0, 2), tree.slice(2));
    assert.equal(fs.existsSync(object), true, 'fixture needs a loose tree object');
    fs.rmSync(object);
    let unsafeError;
    try {
        execFileSync(pinnedGit, [ 'ls-tree', '-r', 'HEAD' ], { cwd: data.sourceRoot, stdio: 'pipe' });
    } catch (error) {
        unsafeError = error;
    }
    assert(unsafeError, 'fixture must fail after deleting the tree');
    assert.equal(fs.existsSync(marker), true,
        `fixture must prove Git would invoke the configured transport: ${String(unsafeError.stderr)}`);
    fs.rmSync(marker);
    assert.throws(() => sourceTreeDirty(data.sourceRoot));
    assert.equal(fs.existsSync(marker), false);
}));

test('manifest verification uses pinned Git despite a task-controlled PATH', () => withFixture(data => {
    const manifest = buildManifest(options(data));
    const prior = process.env.PATH;
    try {
        process.env.PATH = path.join(data.base, 'untrusted-tools');
        assert.equal(verifyManifest(manifest, options(data)), true);
    } finally {
        process.env.PATH = prior;
    }
}));

test('manifest verification ignores inherited repository locator overrides', () => withFixture(data => {
    const manifest = buildManifest(options(data));
    const prior = process.env.GIT_DIR;
    try {
        process.env.GIT_DIR = path.join(data.base, 'untrusted-git-dir');
        assert.equal(verifyManifest(manifest, options(data)), true);
    } finally {
        if (prior === undefined) delete process.env.GIT_DIR;
        else process.env.GIT_DIR = prior;
    }
}));

test('sorts nested artifact paths globally before signing and verification', () => withFixture(data => {
    fs.mkdirSync(path.join(data.artifactRoot, 'a'));
    fs.writeFileSync(path.join(data.artifactRoot, 'a', 'nested.txt'), 'nested');
    fs.writeFileSync(path.join(data.artifactRoot, 'a.txt'), 'sibling');
    const manifest = buildManifest(options(data));
    assert.deepEqual(manifest.files.map(file => file.path).slice(0, 2), [ 'a.txt', 'a/nested.txt' ]);
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
    const target = path.join(data.artifactRoot, 'assets');
    fs.symlinkSync(target, link, 'junction');
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.throws(() => buildManifest(options(data)), /symlink|reparse/u);
    fs.unlinkSync(link);
    assert.throws(() => fs.lstatSync(link), { code: 'ENOENT' });
    assert.equal(fs.lstatSync(target).isDirectory(), true);
    assert.equal(fs.readFileSync(path.join(target, 'logo.svg'), 'utf8'), '<svg/>');
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

test('verifies a frozen Web artifact against its committed source after a documentation-only HEAD advance', () => withFixture(data => {
    const manifest = buildManifest(options(data));
    fs.writeFileSync(path.join(data.sourceRoot, 'handoff.md'), 'Documentation-only follow-up.\n');
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Disposable fixture Git uses the test runner's trusted PATH.
    execFileSync('git', [ 'add', 'handoff.md' ], { cwd: data.sourceRoot });
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Disposable fixture Git uses the test runner's trusted PATH.
    execFileSync('git', [ 'commit', '-qm', 'docs follow-up' ], { cwd: data.sourceRoot });
    assert.throws(() => verifyManifest(manifest, options(data)), /source commit/u);
    assert.equal(verifyManifest(manifest, { ...options(data), frozenSourceCommit: data.commit }), true);
    assert.throws(() => verifyManifest(manifest, { ...options(data), frozenSourceCommit: '0'.repeat(40) }), /source commit|Git commit/u);
}));

test('frozen verification uses version authorities from the artifact commit and rejects forged versions', () => withFixture(data => {
    const manifest = buildManifest(options(data));
    fs.writeFileSync(path.join(data.sourceRoot, 'ptv-version.json'), '{"version":"0.5.72"}\n');
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Disposable fixture Git uses the test runner's trusted PATH.
    execFileSync('git', [ 'add', 'ptv-version.json' ], { cwd: data.sourceRoot });
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Disposable fixture Git uses the test runner's trusted PATH.
    execFileSync('git', [ 'commit', '-qm', 'advance Web version' ], { cwd: data.sourceRoot });
    assert.equal(verifyManifest(manifest, { ...options(data), frozenSourceCommit: data.commit }), true);
    const forged = { ...manifest, sourceVersions: { ...manifest.sourceVersions, web: '0.5.72' } };
    forged.manifestDigest = canonicalDigest(forged);
    assert.throws(() => verifyManifest(forged, { ...options(data), frozenSourceCommit: data.commit }), /Frozen source version/u);
}));

test('frozen verification rejects a payload with a forged embedded commit marker', () => withFixture(data => {
    const manifest = buildManifest(options(data));
    const bundle = path.join(data.artifactRoot, 'main.jellyfin.bundle.js');
    fs.writeFileSync(bundle, 'const sourceCommit = "forged";');
    const bytes = fs.readFileSync(bundle);
    const entry = manifest.files.find(file => file.path === 'main.jellyfin.bundle.js');
    entry.size = bytes.length;
    entry.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    manifest.manifestDigest = canonicalDigest(manifest);
    assert.throws(() => verifyManifest(manifest, { ...options(data), frozenSourceCommit: data.commit }), /embedded.*commit/u);
}));

test('frozen deployment verification rejects a development-mode artifact even when clean', () => withFixture(data => {
    const manifest = buildManifest({ ...options(data), buildMode: 'development' });
    assert.throws(() => verifyManifest(manifest, {
        artifactRoot: data.artifactRoot, sourceRoot: data.sourceRoot, frozenSourceCommit: data.commit
    }), /production|release mode/u);
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
        const preflight = JSON.parse(execFileSync(process.execPath,
            [ path.join(sourceRoot, 'scripts/ptv-workspace-preflight.mjs'), 'audit' ],
            { cwd: sourceRoot, encoding: 'utf8' }));
        const embedded = preflight.head + (preflight.dirty ? '-dirty' : '');
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
