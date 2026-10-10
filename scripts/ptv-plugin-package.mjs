/* eslint-disable sonarjs/no-hardcoded-ip -- Node-only tooling;
    dotted literals are Jellyfin ABI versions. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
export function composePackage(root, { sourceCommit, version }) {
    assert(/^[0-9a-f]{40}$/.test(sourceCommit), 'A clean source commit is required');
    const files = validatePayload(root, version);
    const records = files.map(name => {
        const bytes = fs.readFileSync(path.join(root, name));
        assert(bytes.length > 0, `Empty payload: ${name}`);
        return { path: name, size: bytes.length, sha256: hash(bytes), mode: name === 'helpers/linux-x64/Ptv.ComicInfo.Helper' ? '0755' : '0644' };
    });
    const archive = Buffer.concat([...records.map(record => tarEntry(record.path, fs.readFileSync(path.join(root, record.path)), record.mode)), Buffer.alloc(1024)]);
    const manifest = { schemaVersion: 1, sourceCommit, version, targetAbi: '12.2.0.0', resourceBoundary: boundary, files: records, archiveSha256: hash(archive) };
    verifyPackage(archive, manifest);
    return { archive, manifest };
}
export function verifyPackage(archive, manifest) {
    assert.equal(manifest.schemaVersion, 1);
    assert(/^[0-9a-f]{40}$/.test(manifest.sourceCommit));
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

// Always publish into a fresh directory. The CLI refuses dirty tracked or untracked
// source so a sourceCommit can never disguise modified inputs as an accepted build.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Build operator supplies a trusted Git/.NET PATH.
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '', 'Commit source before packaging');
    const sourceCommit = git('rev-parse', 'HEAD');
    const project = path.join(root, 'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj');
    const version = fs.readFileSync(project, 'utf8').match(/<PtvPluginVersion>([^<]+)</)[1];
    const output = path.join(root, 'src/ptv/plugin/bin/packages', sourceCommit);
    assert(!fs.existsSync(output), 'Use a new clean output directory. Never merge release payloads');
    fs.mkdirSync(output, { recursive: true });
    const payload = path.join(output, 'payload');
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Build operator supplies the required .NET 10 SDK on PATH.
    const publish = (projectPath, destination, extra = []) => execFileSync('dotnet', ['publish', projectPath, '--configuration', 'Release', '--output', destination, '-p:ContinuousIntegrationBuild=true', ...extra], { cwd: root, stdio: 'inherit' });
    publish(project, payload);
    for (const rid of ['linux-x64', 'win-x64']) publish(path.join(root, 'src/ptv/plugin/Ptv.ComicInfo.Helper/Ptv.ComicInfo.Helper.csproj'), path.join(payload, 'helpers', rid), ['--runtime', rid, '--self-contained', 'true']);
    assert.equal(git('rev-parse', 'HEAD'), sourceCommit);
    assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '');
    const result = composePackage(payload, { sourceCommit, version });
    fs.writeFileSync(path.join(output, 'PiggieTV.tar'), result.archive);
    fs.writeFileSync(path.join(output, 'package-manifest.json'), JSON.stringify(result.manifest, null, 2) + '\n');
    console.log(JSON.stringify({ sourceCommit, version, archiveSha256: result.manifest.archiveSha256, output }));
}
/* eslint-enable sonarjs/no-hardcoded-ip */
