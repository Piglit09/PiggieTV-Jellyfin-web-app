import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT_IDS = new Map([ [ 'web', 'PTV_WEB' ], [ 'plugin', 'PTV_PLUGIN' ] ]);
const BUILD_MODES = new Set([ 'development', 'production', 'package', 'transformed-production' ]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

function hash(bytes) {
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        const fields = Object.keys(value).sort().map(key => {
            const encodedKey = JSON.stringify(key);
            return `${encodedKey}:${canonical(value[key])}`;
        });
        return `{${fields.join(',')}}`;
    }
    return JSON.stringify(value);
}

export function canonicalDigest(manifest) {
    const unsigned = { ...manifest };
    delete unsigned.manifestDigest;
    return hash(Buffer.from(canonical(unsigned), 'utf8'));
}

function git(sourceRoot, ...args) {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Node-only tooling uses the operator-provided trusted Git PATH.
    return execFileSync('git', args, {
        cwd: sourceRoot,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
        encoding: 'utf8',
        stdio: [ 'ignore', 'pipe', 'ignore' ]
    }).trim();
}

function realDirectory(value, label) {
    assert(value, `${label} is required`);
    const resolved = path.resolve(value);
    const entry = fs.lstatSync(resolved);
    assert(entry.isDirectory() && !entry.isSymbolicLink(), `${label} must be a real directory, not a symlink or reparse point`);
    const real = fs.realpathSync.native(resolved);
    assert.equal(real.toLowerCase(), resolved.toLowerCase(), `${label} may not escape through a symlink or junction`);
    return real;
}

function sourceInfo(sourceRoot) {
    const root = realDirectory(sourceRoot, 'Source root');
    assert.equal(fs.realpathSync.native(git(root, 'rev-parse', '--show-toplevel')).toLowerCase(), root.toLowerCase(), 'Source root must equal the Git root');
    const sourceCommit = git(root, 'rev-parse', 'HEAD').toLowerCase();
    assert(COMMIT_PATTERN.test(sourceCommit), 'Git HEAD must be a full 40-character SHA');
    let sourceBranch;
    try {
        sourceBranch = git(root, 'symbolic-ref', '--quiet', '--short', 'HEAD');
    } catch {
        sourceBranch = 'DETACHED';
    }
    const sourceDirty = Boolean(git(root, 'status', '--porcelain=v1', '--untracked-files=normal'));
    const web = JSON.parse(fs.readFileSync(path.join(root, 'ptv-version.json'), 'utf8')).version;
    const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    const pluginProject = fs.readFileSync(path.join(root, 'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj'), 'utf8');
    const plugin = pluginProject.match(/<PtvPluginVersion>([^<]+)<\/PtvPluginVersion>/u)?.[1];
    assert(typeof web === 'string' && web && typeof packageVersion === 'string' && packageVersion && plugin, 'Source version authorities are incomplete');
    return {
        sourceRoot: root,
        sourceCommit,
        sourceBranch,
        sourceDirty,
        sourceVersions: { web, plugin, package: packageVersion }
    };
}

function committedVersions(root, commit) {
    assert(COMMIT_PATTERN.test(commit) && git(root, 'cat-file', '-t', commit) === 'commit', 'Unknown frozen source Git commit');
    const web = JSON.parse(git(root, 'show', `${commit}:ptv-version.json`)).version;
    const packageVersion = JSON.parse(git(root, 'show', `${commit}:package.json`)).version;
    const pluginProject = git(root, 'show', `${commit}:src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj`);
    const plugin = pluginProject.match(/<PtvPluginVersion>([^<]+)<\/PtvPluginVersion>/u)?.[1];
    assert(typeof web === 'string' && web && typeof packageVersion === 'string' && packageVersion && plugin,
        'Frozen source version authorities are incomplete');
    return { web, plugin, package: packageVersion };
}

export function validateFrozenPluginEvidence({ commit, head, commitType, reachable, sourceDirty,
    currentProductTree, frozenProductTree, currentPluginVersion, frozenPluginVersion }) {
    assert(COMMIT_PATTERN.test(commit) && COMMIT_PATTERN.test(head), 'Frozen Plugin source needs full Git commits');
    assert.equal(sourceDirty, false, 'Frozen Plugin packaging requires a clean checkout');
    assert.equal(commitType, 'commit', 'Unknown frozen Plugin source commit');
    assert.equal(reachable, true, 'Frozen Plugin source must be an ancestor of current HEAD');
    assert(COMMIT_PATTERN.test(currentProductTree) && COMMIT_PATTERN.test(frozenProductTree), 'Invalid Plugin source tree identity');
    assert.equal(currentProductTree, frozenProductTree, 'Plugin source tree differs from frozen commit');
    assert.equal(currentPluginVersion, frozenPluginVersion, 'Plugin version differs from frozen commit');
    return true;
}

export function frozenPluginSourceInfo(sourceRoot, commit) {
    const source = sourceInfo(sourceRoot);
    assert(COMMIT_PATTERN.test(commit), 'Frozen Plugin source needs a full Git commit');
    let commitType;
    let reachable = false;
    try {
        commitType = git(source.sourceRoot, 'cat-file', '-t', commit);
        git(source.sourceRoot, 'merge-base', '--is-ancestor', commit, source.sourceCommit);
        reachable = true;
    } catch {
        // Unknown or unrelated commits cannot authorize a frozen package.
    }
    const versions = commitType === 'commit' ? committedVersions(source.sourceRoot, commit) : null;
    const currentProductTree = git(source.sourceRoot, 'rev-parse', 'HEAD:src/ptv/plugin');
    const frozenProductTree = commitType === 'commit' ? git(source.sourceRoot, 'rev-parse', `${commit}:src/ptv/plugin`) : null;
    validateFrozenPluginEvidence({ commit, head: source.sourceCommit, commitType, reachable,
        sourceDirty: source.sourceDirty, currentProductTree, frozenProductTree,
        currentPluginVersion: source.sourceVersions.plugin, frozenPluginVersion: versions?.plugin });
    return { ...source, sourceCommit: commit, sourceVersions: versions, sourceProductTree: frozenProductTree };
}

function validRelativePath(name) {
    return typeof name === 'string' && name.length > 0 && !name.includes('\\') && !name.includes(':')
        && !name.startsWith('/') && name.split('/').every(part => part && part !== '.' && part !== '..');
}

function inventory(root, prefix = '') {
    const entries = fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).sort((left, right) => {
        if (left.name < right.name) return -1;
        if (left.name > right.name) return 1;
        return 0;
    });
    const files = [];
    for (const entry of entries) {
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        assert(validRelativePath(name), `Invalid artifact path: ${name}`);
        const entryPath = path.join(root, ...name.split('/'));
        const stat = fs.lstatSync(entryPath);
        assert(!stat.isSymbolicLink(), `Artifact symlink or reparse point is prohibited: ${name}`);
        if (stat.isDirectory()) {
            files.push(...inventory(root, name));
        } else {
            assert(stat.isFile(), `Artifact entry must be a regular file: ${name}`);
            const bytes = fs.readFileSync(entryPath);
            files.push({ path: name, size: bytes.length, sha256: hash(bytes) });
        }
    }
    return files.sort((left, right) => {
        if (left.path < right.path) return -1;
        if (left.path > right.path) return 1;
        return 0;
    });
}

function assertWebPayload(artifactRoot, files, sourceCommit, sourceDirty) {
    const names = new Set(files.map(file => file.path));
    assert(names.has('index.html') && names.has('config.json'), 'Web artifact is missing required package files');
    const expected = sourceCommit + (sourceDirty ? '-dirty' : '');
    const embedded = files.filter(file => file.path.endsWith('.js')).some(file => {
        const content = fs.readFileSync(path.join(artifactRoot, ...file.path.split('/')));
        return content.includes(Buffer.from(expected, 'utf8'));
    });
    assert(embedded, 'Web artifact has no embedded current source commit');
}

function assertPluginPayload(artifactRoot, files, sourceCommit, pluginVersion, sourceProductTree) {
    const names = files.map(file => file.path);
    assert.deepEqual(names, [ 'PiggieTV.tar', 'package-manifest.json' ], 'Plugin package files are incomplete or unexpected');
    const packageManifest = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'package-manifest.json'), 'utf8'));
    assert.equal(packageManifest.sourceCommit, sourceCommit, 'Plugin package source commit mismatch');
    assert.equal(packageManifest.version, pluginVersion, 'Plugin package version mismatch');
    assert.equal(packageManifest.archiveSha256, hash(fs.readFileSync(path.join(artifactRoot, 'PiggieTV.tar'))), 'Plugin archive hash mismatch');
    if (sourceProductTree) assert.equal(packageManifest.sourceProductTree, sourceProductTree, 'Plugin package source tree mismatch');
}

function validateBuildMode(buildMode, sourceDirty) {
    assert(BUILD_MODES.has(buildMode), 'Unknown build mode');
    if (buildMode !== 'development') assert(!sourceDirty, 'Release/package artifact requires clean committed source');
}

export function assertFrozenManifestKind(manifest) {
    assert(manifest?.projectId === 'PTV_WEB' || manifest?.projectId === 'PTV_PLUGIN',
        'Frozen artifact project is invalid');
    const expectedBuildMode = manifest.projectId === 'PTV_WEB' ? 'production' : 'package';
    assert.equal(manifest.buildMode, expectedBuildMode,
        `Frozen ${manifest.projectId === 'PTV_WEB' ? 'Web' : 'Plugin'} artifact requires ${expectedBuildMode} build mode`);
    return true;
}

export function buildManifest({ artifactRoot, sourceRoot, projectId = 'PTV_WEB', buildMode,
    frozenSourceCommit, createdAt = new Date().toISOString() }) {
    const artifact = realDirectory(artifactRoot, 'Artifact root');
    assert([ ...PROJECT_IDS.values() ].includes(projectId), 'Unknown project ID');
    const source = frozenSourceCommit === undefined ? sourceInfo(sourceRoot) : frozenPluginSourceInfo(sourceRoot, frozenSourceCommit);
    if (frozenSourceCommit !== undefined) {
        assert.equal(projectId, 'PTV_PLUGIN', 'Frozen manifest creation is Plugin-only');
        assert.equal(buildMode, 'package', 'Frozen Plugin manifest creation requires package mode');
    }
    validateBuildMode(buildMode, source.sourceDirty);
    assert(!Number.isNaN(Date.parse(createdAt)), 'Invalid build timestamp');
    const files = inventory(artifact);
    assert(files.length > 0, 'Artifact has no files');
    if (projectId === 'PTV_WEB') assertWebPayload(artifact, files, source.sourceCommit, source.sourceDirty);
    else assertPluginPayload(artifact, files, source.sourceCommit, source.sourceVersions.plugin, source.sourceProductTree);
    const unsigned = { schemaVersion: 1, projectId, buildMode, ...source, createdAt, files };
    return { ...unsigned, manifestDigest: canonicalDigest(unsigned) };
}

export function verifyManifest(manifest, { artifactRoot, sourceRoot, buildMode, frozenSourceCommit } = {}) {
    assert(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'Invalid artifact manifest');
    assert.equal(manifest.schemaVersion, 1, 'Unsupported artifact manifest schema');
    assert(SHA256_PATTERN.test(manifest.manifestDigest), 'Invalid manifest digest');
    assert.equal(manifest.manifestDigest, canonicalDigest(manifest), 'Artifact manifest digest mismatch');
    assert(COMMIT_PATTERN.test(manifest.sourceCommit), 'Invalid source commit');
    assert([ ...PROJECT_IDS.values() ].includes(manifest.projectId), 'Unknown project ID');
    assert(!buildMode || buildMode === manifest.buildMode, 'Build mode mismatch');
    const source = sourceInfo(sourceRoot);
    assert.equal(manifest.sourceRoot.toLowerCase(), source.sourceRoot.toLowerCase(), 'Source root mismatch');
    if (frozenSourceCommit !== undefined) {
        assertFrozenManifestKind(manifest);
        assert.equal(manifest.sourceCommit, frozenSourceCommit, 'Frozen artifact source commit mismatch');
        assert.equal(manifest.sourceDirty, false, 'Frozen artifact requires clean committed source');
        assert.equal(source.sourceDirty, false, 'Frozen artifact verification requires a clean current checkout');
        assert.deepEqual(manifest.sourceVersions, committedVersions(source.sourceRoot, frozenSourceCommit), 'Frozen source version mismatch');
        if (manifest.projectId === 'PTV_PLUGIN') {
            const frozenSource = frozenPluginSourceInfo(source.sourceRoot, frozenSourceCommit);
            assert.equal(manifest.sourceProductTree, frozenSource.sourceProductTree, 'Frozen Plugin source tree mismatch');
        }
    } else {
        assert.equal(manifest.sourceCommit, source.sourceCommit, 'Artifact source commit differs from current Git HEAD');
        assert.equal(manifest.sourceBranch, source.sourceBranch, 'Source branch mismatch');
        assert.equal(manifest.sourceDirty, source.sourceDirty, 'Source dirty state mismatch');
        assert.deepEqual(manifest.sourceVersions, source.sourceVersions, 'Source version mismatch');
    }
    validateBuildMode(manifest.buildMode, manifest.sourceDirty);
    assert(Array.isArray(manifest.files) && manifest.files.length > 0, 'Manifest file inventory missing');
    let previous = '';
    for (const file of manifest.files) {
        assert(validRelativePath(file.path), `Invalid manifest file path: ${file.path}`);
        assert(file.path > previous, 'Manifest file paths must be unique and sorted');
        // eslint-disable-next-line sonarjs/no-collection-size-mischeck -- file.size is untrusted JSON metadata, not an Array collection.
        assert(Number.isSafeInteger(file.size) && file.size >= 0, 'Invalid file size');
        assert(SHA256_PATTERN.test(file.sha256), 'Invalid file hash');
        previous = file.path;
    }
    const artifact = realDirectory(artifactRoot, 'Artifact root');
    const actual = inventory(artifact);
    assert.deepEqual(actual.map(file => file.path), manifest.files.map(file => file.path), 'Artifact file inventory mismatch');
    for (let index = 0; index < actual.length; index++) {
        assert.equal(actual[index].size, manifest.files[index].size, `Artifact file size mismatch: ${actual[index].path}`);
        assert.equal(actual[index].sha256, manifest.files[index].sha256, `Artifact file hash mismatch: ${actual[index].path}`);
    }
    if (manifest.projectId === 'PTV_WEB') assertWebPayload(artifact, actual, manifest.sourceCommit, manifest.sourceDirty);
    else assertPluginPayload(artifact, actual, manifest.sourceCommit, manifest.sourceVersions.plugin, manifest.sourceProductTree);
    return true;
}

function argumentsFromCli(argv) {
    const [ operation, ...rest ] = argv;
    assert(operation === 'create' || operation === 'verify', 'Use create or verify');
    assert(rest.length % 2 === 0, 'Every option needs a value');
    const values = new Map();
    const allowed = new Set([ '--artifact', '--output', '--manifest', '--mode', '--project', '--source-root', '--frozen-source-commit' ]);
    for (let index = 0; index < rest.length; index += 2) {
        assert(allowed.has(rest[index]) && !values.has(rest[index]), `Invalid or duplicate option: ${rest[index]}`);
        values.set(rest[index], rest[index + 1]);
    }
    return { operation, values };
}

function cli() {
    const { operation, values } = argumentsFromCli(process.argv.slice(2));
    const sourceRoot = values.get('--source-root') || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const artifactRoot = values.get('--artifact');
    assert(artifactRoot, '--artifact is required');
    if (operation === 'create') {
        const output = values.get('--output');
        assert(output && values.get('--mode'), '--output and --mode are required');
        const mode = values.get('--mode');
        assert(BUILD_MODES.has(mode), 'Unknown build mode');
        const artifact = realDirectory(artifactRoot, 'Artifact root');
        const outputPath = path.resolve(output);
        const outputParent = realDirectory(path.dirname(outputPath), 'Manifest output parent');
        const relative = path.relative(artifact, path.join(outputParent, path.basename(outputPath)));
        assert(relative.startsWith('..') || path.isAbsolute(relative), 'Manifest must be outside artifact root');
        const preflight = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ptv-workspace-preflight.mjs');
        const preflightMode = mode === 'development' ? 'build' : 'package';
        const ciRef = process.env.GITHUB_ACTIONS === 'true' ? [ '--ci-ref', git(sourceRoot, 'rev-parse', 'HEAD') ] : [];
        execFileSync(process.execPath, [ preflight, preflightMode, ...ciRef ], { cwd: sourceRoot, stdio: 'inherit' });
        const projectId = PROJECT_IDS.get(values.get('--project') || 'web');
        const manifest = buildManifest({ artifactRoot, sourceRoot, projectId, buildMode: mode,
            frozenSourceCommit: values.get('--frozen-source-commit') });
        fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
        console.log(manifest.manifestDigest);
    } else {
        const manifestPath = values.get('--manifest');
        assert(manifestPath, '--manifest is required');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        verifyManifest(manifest, { artifactRoot, sourceRoot, frozenSourceCommit: values.get('--frozen-source-commit') });
        console.log(manifest.manifestDigest);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        cli();
    } catch (error) {
        console.error(`PTV artifact manifest: ${error.message}`);
        process.exitCode = 1;
    }
}
