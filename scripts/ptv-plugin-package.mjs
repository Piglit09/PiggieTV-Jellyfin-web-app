/* eslint-disable sonarjs/no-hardcoded-ip -- Node-only tooling;
    dotted literals are Jellyfin ABI versions. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildManifest, frozenPluginSourceInfo, verifyManifest } from './ptv-artifact-manifest.mjs';

const roots = ['Jellyfin.Plugin.PiggieTV.deps.json', 'Jellyfin.Plugin.PiggieTV.dll', 'Jellyfin.Plugin.PiggieTV.pdb', 'Jellyfin.Plugin.PiggieTV.xml', 'meta.json'];
const boundary = { memoryBytes: 536870912, maxHelpers: 2, deadlineMilliseconds: 5000, windows: 'JobObject-before-resume', linux: 'cgroup-v2-before-input', linuxEnvironment: 'PTV_COMICINFO_CGROUP_ROOT', unavailable: 'unverified' };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function inventory(root, prefix = '') {
    return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1).flatMap(entry => {
        const name = prefix + entry.name;
        assert(!entry.isSymbolicLink(), 'Package symlinks are prohibited');
        if (entry.isDirectory()) return inventory(root, name + '/');
        assert(entry.isFile(), 'Package entries must be regular files');
        return [name];
    });
}
function validateRuntimeAssets(target, files, prefix, rid) {
    for (const library of Object.values(target)) {
        for (const kind of ['runtime', 'native', 'resources', 'runtimeTargets']) {
            for (const [asset, info] of Object.entries(library[kind] || {})) {
                if (asset.endsWith('/_._') || (info.rid && info.rid !== rid)) continue;
                const name = kind === 'resources' ? `${info.locale}/${path.posix.basename(asset)}` : path.posix.basename(asset);
                assert(files.includes(prefix + name), `Missing runtime dependency: ${prefix + name}`);
            }
        }
    }
}
function validatePayload(root, version) {
    const files = inventory(root);
    assert.deepEqual(files.filter(name => !name.includes('/')), roots, 'Exactly five Plugin root files are required');
    assert(files.every(name => !name.includes('/') || /^helpers\/(linux-x64|win-x64)\//.test(name)), 'Unexpected package tree');
    const meta = readJson(path.join(root, 'meta.json'));
    assert.equal(meta.version, version, 'Plugin declared version mismatch');
    assert.equal(meta.targetAbi, '12.2.0.0');
    assert.deepEqual(meta.assemblies, ['Jellyfin.Plugin.PiggieTV.dll'], 'Helper must never be a Jellyfin-loaded assembly');
    for (const rid of ['linux-x64', 'win-x64']) {
        const prefix = `helpers/${rid}/`;
        const required = ['Ptv.ComicInfo.Helper' + (rid === 'win-x64' ? '.exe' : ''), 'Ptv.ComicInfo.Helper.dll', 'Ptv.ComicInfo.Helper.deps.json', 'Ptv.ComicInfo.Helper.runtimeconfig.json', 'SharpCompress.dll', 'System.Private.CoreLib.dll', ...(rid === 'win-x64' ? ['coreclr.dll', 'hostfxr.dll', 'hostpolicy.dll'] : ['libcoreclr.so', 'libhostfxr.so', 'libhostpolicy.so'])];
        for (const name of required) assert(files.includes(prefix + name), `Missing helper payload: ${prefix + name}`);
        const config = readJson(path.join(root, prefix, 'Ptv.ComicInfo.Helper.runtimeconfig.json'));
        assert(config.runtimeOptions.includedFrameworks?.some(framework => framework.name === 'Microsoft.NETCore.App' && framework.version.startsWith('10.')), 'Helper must be self-contained .NET 10');
        const deps = readJson(path.join(root, prefix, 'Ptv.ComicInfo.Helper.deps.json'));
        assert(deps.runtimeTarget.name.endsWith('/' + rid), 'Helper RID mismatch');
        const target = deps.targets[deps.runtimeTarget.name];
        assert(target, 'Missing runtime target');
        validateRuntimeAssets(target, files, prefix, rid);
    }
    return files;
}
function tarEntry(name, bytes, mode) {
    assert(Buffer.byteLength(name) < 100, 'Tar path exceeds package bound');
    const header = Buffer.alloc(512);
    header.write(name, 0);
    const octal = (value, start, length) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', start, length);
    octal(parseInt(mode, 8), 100, 8);
    octal(0, 108, 8);
    octal(0, 116, 8);
    octal(bytes.length, 124, 12);
    octal(0, 136, 12);
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write('ustar\0', 257);
    header.write('00', 263);
    const checksum = header.reduce((sum, value) => sum + value, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}

function removeOwnedStaging(packagesRoot, staging, prefix) {
    const root = fs.realpathSync.native(packagesRoot);
    const candidate = fs.realpathSync.native(staging);
    assert.equal(path.dirname(candidate), root, 'Refusing cleanup outside the Plugin package output root');
    assert(path.basename(candidate).startsWith(prefix), 'Refusing cleanup of an unknown package directory');
    fs.rmSync(candidate, { recursive: true, force: true });
}
export function composePackage(root, { sourceCommit, version, sourceProductTree }) {
    assert(/^[0-9a-f]{40}$/.test(sourceCommit), 'A clean source commit is required');
    if (sourceProductTree !== undefined) assert(/^[0-9a-f]{40}$/.test(sourceProductTree), 'Invalid Plugin source tree');
    const files = validatePayload(root, version);
    const records = files.map(name => {
        const bytes = fs.readFileSync(path.join(root, name));
        assert(bytes.length > 0, `Empty payload: ${name}`);
        return { path: name, size: bytes.length, sha256: hash(bytes), mode: name === 'helpers/linux-x64/Ptv.ComicInfo.Helper' ? '0755' : '0644' };
    });
    const archive = Buffer.concat([...records.map(record => tarEntry(record.path, fs.readFileSync(path.join(root, record.path)), record.mode)), Buffer.alloc(1024)]);
    const manifest = { schemaVersion: 1, sourceCommit, version, targetAbi: '12.2.0.0', resourceBoundary: boundary,
        ...(sourceProductTree ? { sourceProductTree } : {}), files: records, archiveSha256: hash(archive) };
    verifyPackage(archive, manifest);
    return { archive, manifest };
}
export function verifyPackage(archive, manifest) {
    assert.equal(manifest.schemaVersion, 1);
    assert(/^[0-9a-f]{40}$/.test(manifest.sourceCommit));
    if (manifest.sourceProductTree !== undefined) assert(/^[0-9a-f]{40}$/.test(manifest.sourceProductTree));
    assert.deepEqual(manifest.resourceBoundary, boundary, 'Resource-bound setup is required');
    assert.equal(hash(archive), manifest.archiveSha256, 'Archive digest mismatch');
    let offset = 0;
    for (const record of manifest.files) {
        assert(!record.path.startsWith('/') && !record.path.split('/').includes('..'));
        const header = archive.subarray(offset, offset + 512);
        const name = header.subarray(0, 100).toString().split('\0')[0];
        const size = parseInt(header.subarray(124, 136).toString(), 8);
        const mode = parseInt(header.subarray(100, 108).toString(), 8).toString(8).padStart(4, '0');
        assert.equal(name, record.path);
        assert.equal(size, record.size);
        assert.equal(mode, record.mode);
        assert.equal(mode, name === 'helpers/linux-x64/Ptv.ComicInfo.Helper' ? '0755' : '0644');
        assert.equal(hash(archive.subarray(offset + 512, offset + 512 + size)), record.sha256);
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    assert.equal(archive.length, offset + 1024);
    assert(archive.subarray(offset).every(value => value === 0));
    return true;
}

export function writeVerifiedPackage({ packagesRoot, sourceRoot, sourceCommit, result, frozenSourceCommit }) {
    assert(/^[0-9a-f]{40}$/u.test(sourceCommit), 'A full clean source commit is required');
    assert.equal(result.manifest.sourceCommit, sourceCommit, 'Plugin package commit mismatch');
    fs.mkdirSync(packagesRoot, { recursive: true });
    const output = path.join(packagesRoot, sourceCommit);
    const externalManifest = path.join(packagesRoot, `${sourceCommit}.artifact-manifest.json`);
    assert(!fs.existsSync(output) && !fs.existsSync(externalManifest), 'Package already exists; never merge or overwrite release payloads');
    const prefix = `.final-${sourceCommit}-`;
    const staging = fs.mkdtempSync(path.join(packagesRoot, prefix));
    const prepared = path.join(staging, 'package');
    let preserveStaging = false;
    try {
        fs.mkdirSync(prepared);
        fs.writeFileSync(path.join(prepared, 'PiggieTV.tar'), result.archive);
        fs.writeFileSync(path.join(prepared, 'package-manifest.json'), JSON.stringify(result.manifest, null, 2) + '\n');
        const artifactManifest = buildManifest({ artifactRoot: prepared, sourceRoot, projectId: 'PTV_PLUGIN',
            buildMode: 'package', frozenSourceCommit });
        verifyManifest(artifactManifest, { artifactRoot: prepared, sourceRoot, buildMode: 'package', frozenSourceCommit });
        const stagedManifest = path.join(staging, 'artifact-manifest.json');
        fs.writeFileSync(stagedManifest, JSON.stringify(artifactManifest, null, 2) + '\n', { flag: 'wx' });
        assert(!fs.existsSync(output) && !fs.existsSync(externalManifest), 'Package destination appeared during staging');
        fs.renameSync(prepared, output);
        try {
            fs.renameSync(stagedManifest, externalManifest);
        } catch (error) {
            try {
                fs.renameSync(output, prepared);
            } catch (rollbackError) {
                preserveStaging = true;
                throw new AggregateError([error, rollbackError], 'Package publication failed and rollback needs manual recovery');
            }
            throw error;
        }
        return { output, externalManifest, artifactManifest };
    } finally {
        if (!preserveStaging) removeOwnedStaging(packagesRoot, staging, prefix);
    }
}

export function pluginPublishArguments(projectPath, destination, sourceCommit, extra = []) {
    assert(/^[0-9a-f]{40}$/u.test(sourceCommit), 'Plugin publish requires a full source commit');
    return [ 'publish', projectPath, '--configuration', 'Release', '--output', destination,
        '-p:ContinuousIntegrationBuild=true', `-p:SourceRevisionId=${sourceCommit}`, ...extra ];
}

function verifyEmbeddedRevision(payload, sourceCommit) {
    for (const name of [ 'Jellyfin.Plugin.PiggieTV.dll', 'helpers/win-x64/Ptv.ComicInfo.Helper.dll',
        'helpers/linux-x64/Ptv.ComicInfo.Helper.dll' ]) {
        assert(fs.readFileSync(path.join(payload, name)).includes(Buffer.from(sourceCommit, 'utf8')),
            `Plugin payload does not embed selected source commit: ${name}`);
    }
    assert(fs.readFileSync(path.join(payload, 'helpers/win-x64/Ptv.ComicInfo.Helper.exe'))
        .includes(Buffer.from(sourceCommit, 'utf16le')), 'Windows helper does not embed selected source commit');
}

// Always publish into a fresh directory. The CLI refuses dirty tracked or untracked
// source so a sourceCommit can never disguise modified inputs as an accepted build.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const args = process.argv.slice(2);
    assert(args.length === 0 || (args.length === 2 && args[0] === '--frozen-source-commit'),
        'Only --frozen-source-commit <full SHA> is supported');
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Build operator supplies a trusted Git/.NET PATH.
    const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
    assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '', 'Commit source before packaging');
    const currentHead = git('rev-parse', 'HEAD');
    const frozenSourceCommit = args.length === 2 ? args[1] : undefined;
    const frozenSource = frozenSourceCommit === undefined ? null : frozenPluginSourceInfo(root, frozenSourceCommit);
    const sourceCommit = frozenSourceCommit || currentHead;
    const ciRef = process.env.GITHUB_ACTIONS === 'true' ? ['--ci-ref', currentHead] : [];
    execFileSync(process.execPath, [path.join(root, 'scripts/ptv-workspace-preflight.mjs'), 'package', ...ciRef], { cwd: root, stdio: 'inherit' });
    const project = path.join(root, 'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj');
    const version = fs.readFileSync(project, 'utf8').match(/<PtvPluginVersion>([^<]+)</)[1];
    const packagesRoot = path.join(root, 'src/ptv/plugin/bin/packages');
    const output = path.join(packagesRoot, sourceCommit);
    const externalManifest = path.join(packagesRoot, `${sourceCommit}.artifact-manifest.json`);
    assert(!fs.existsSync(output) && !fs.existsSync(externalManifest), 'Package already exists; never merge or overwrite release payloads');
    fs.mkdirSync(packagesRoot, { recursive: true });
    const prefix = `.payload-${sourceCommit}-`;
    const staging = fs.mkdtempSync(path.join(packagesRoot, prefix));
    try {
        const payload = path.join(staging, 'payload');
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- Build operator supplies the required .NET 10 SDK on PATH.
        const publish = (projectPath, destination, extra = []) => execFileSync('dotnet',
            pluginPublishArguments(projectPath, destination, sourceCommit, extra), { cwd: root, stdio: 'inherit' });
        publish(project, payload);
        for (const rid of ['linux-x64', 'win-x64']) publish(path.join(root, 'src/ptv/plugin/Ptv.ComicInfo.Helper/Ptv.ComicInfo.Helper.csproj'), path.join(payload, 'helpers', rid), ['--runtime', rid, '--self-contained', 'true']);
        assert.equal(git('rev-parse', 'HEAD'), currentHead);
        assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '');
        if (frozenSourceCommit !== undefined) frozenPluginSourceInfo(root, frozenSourceCommit);
        verifyEmbeddedRevision(payload, sourceCommit);
        const result = composePackage(payload, { sourceCommit, version,
            ...(frozenSource ? { sourceProductTree: frozenSource.sourceProductTree } : {}) });
        const published = writeVerifiedPackage({ packagesRoot, sourceRoot: root, sourceCommit, result, frozenSourceCommit });
        console.log(JSON.stringify({ sourceCommit, version, archiveSha256: result.manifest.archiveSha256, output: published.output }));
    } finally {
        removeOwnedStaging(packagesRoot, staging, prefix);
    }
}
/* eslint-enable sonarjs/no-hardcoded-ip */
