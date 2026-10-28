/* eslint-disable sonarjs/no-hardcoded-ip -- Dotted 12.2.0.0 values are the Jellyfin ABI, not network addresses. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalDigest } from './ptv-artifact-manifest.mjs';
import { stageDevelopmentPlugin } from './ptv-development-plugin-stage.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceCommit = 'a'.repeat(40);
const version = '0.5.24.0';
const requiredWindows = ['Ptv.ComicInfo.Helper.exe', 'Ptv.ComicInfo.Helper.dll',
    'Ptv.ComicInfo.Helper.deps.json', 'Ptv.ComicInfo.Helper.runtimeconfig.json',
    'SharpCompress.dll', 'System.Private.CoreLib.dll', 'coreclr.dll', 'hostfxr.dll', 'hostpolicy.dll'];
const payload = new Map([
    ['Jellyfin.Plugin.PiggieTV.deps.json', Buffer.from('deps')],
    ['Jellyfin.Plugin.PiggieTV.dll', Buffer.from('dll')],
    ['Jellyfin.Plugin.PiggieTV.pdb', Buffer.from('pdb')],
    ['Jellyfin.Plugin.PiggieTV.xml', Buffer.from('xml')],
    ['meta.json', Buffer.from(JSON.stringify({ version, targetAbi: '12.2.0.0', assemblies: ['Jellyfin.Plugin.PiggieTV.dll'] }))],
    ...requiredWindows.map(name => [`helpers/win-x64/${name}`, Buffer.from(name)]),
    ['helpers/linux-x64/Ptv.ComicInfo.Helper', Buffer.from('linux')]
].sort(([a], [b]) => a.localeCompare(b)));

function archiveEntry(name, bytes, mode) {
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

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptv-plugin-stage-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const packageRoot = path.join(root, 'package');
    const stageRoot = path.join(root, 'stage');
    fs.mkdirSync(packageRoot);
    const resourceBoundary = {
        memoryBytes: 536870912, maxHelpers: 2, deadlineMilliseconds: 5000,
        windows: 'JobObject-before-resume', linux: 'cgroup-v2-before-input',
        linuxEnvironment: 'PTV_COMICINFO_CGROUP_ROOT', unavailable: 'unverified'
    };
    const files = [...payload].map(([name, bytes]) => ({
        path: name, size: bytes.length, sha256: hash(bytes),
        mode: name === 'helpers/linux-x64/Ptv.ComicInfo.Helper' ? '0755' : '0644'
    }));
    const archive = Buffer.concat([
        ...files.map(file => archiveEntry(file.path, payload.get(file.path), file.mode)), Buffer.alloc(1024)
    ]);
    const packageManifest = {
        schemaVersion: 1, sourceCommit, version, targetAbi: '12.2.0.0',
        resourceBoundary, files, archiveSha256: hash(archive)
    };
    const packageManifestBytes = Buffer.from(JSON.stringify(packageManifest));
    fs.writeFileSync(path.join(packageRoot, 'PiggieTV.tar'), archive);
    fs.writeFileSync(path.join(packageRoot, 'package-manifest.json'), packageManifestBytes);
    const outerManifest = {
        schemaVersion: 1, projectId: 'PTV_PLUGIN', sourceCommit,
        sourceVersions: { web: '0.5.77', plugin: version },
        files: [
            { path: 'PiggieTV.tar', size: archive.length, sha256: hash(archive) },
            { path: 'package-manifest.json', size: packageManifestBytes.length, sha256: hash(packageManifestBytes) }
        ]
    };
    outerManifest.manifestDigest = canonicalDigest(outerManifest);
    const outerPath = path.join(root, 'outer.json');
    fs.writeFileSync(outerPath, JSON.stringify(outerManifest));
    return { root, packageRoot, stageRoot, outerPath, manifestDigest: outerManifest.manifestDigest };
}

test('verified package stages only Plugin roots and Windows helper', t => {
    const f = fixture(t);
    const result = stageDevelopmentPlugin({ artifactRoot: f.packageRoot, artifactManifest: f.outerPath,
        stageRoot: f.stageRoot, expectedCommit: sourceCommit, expectedVersion: version,
        expectedManifestDigest: f.manifestDigest });
    assert.equal(result.version, version);
    assert.ok(fs.existsSync(path.join(f.stageRoot, 'helpers/win-x64/Ptv.ComicInfo.Helper.exe')));
    assert.ok(!fs.existsSync(path.join(f.stageRoot, 'helpers/linux-x64')));
    assert.equal(fs.readFileSync(path.join(f.stageRoot, 'Jellyfin.Plugin.PiggieTV.dll'), 'utf8'), 'dll');
});

test('tampered archive fails before stage creation', t => {
    const f = fixture(t);
    fs.appendFileSync(path.join(f.packageRoot, 'PiggieTV.tar'), 'tamper');
    assert.throws(() => stageDevelopmentPlugin({ artifactRoot: f.packageRoot, artifactManifest: f.outerPath,
        stageRoot: f.stageRoot, expectedCommit: sourceCommit, expectedVersion: version,
        expectedManifestDigest: f.manifestDigest }), /hash|size|archive/i);
    assert.ok(!fs.existsSync(f.stageRoot));
});

test('wrong source commit and unexpected package entry are denied', t => {
    const f = fixture(t);
    assert.throws(() => stageDevelopmentPlugin({ artifactRoot: f.packageRoot, artifactManifest: f.outerPath,
        stageRoot: f.stageRoot, expectedCommit: 'b'.repeat(40), expectedVersion: version,
        expectedManifestDigest: f.manifestDigest }), /source commit/i);
    fs.writeFileSync(path.join(f.packageRoot, 'extra.txt'), 'keep');
    assert.throws(() => stageDevelopmentPlugin({ artifactRoot: f.packageRoot, artifactManifest: f.outerPath,
        stageRoot: f.stageRoot, expectedCommit: sourceCommit, expectedVersion: version,
        expectedManifestDigest: f.manifestDigest }), /unexpected/i);
});

test('changed outer manifest is denied against protected preflight digest', t => {
    const f = fixture(t);
    const outer = JSON.parse(fs.readFileSync(f.outerPath, 'utf8'));
    outer.sourceVersions.web = '0.5.78';
    fs.writeFileSync(f.outerPath, JSON.stringify(outer));
    assert.throws(() => stageDevelopmentPlugin({ artifactRoot: f.packageRoot, artifactManifest: f.outerPath,
        stageRoot: f.stageRoot, expectedCommit: sourceCommit, expectedVersion: version,
        expectedManifestDigest: f.manifestDigest }), /manifest digest/i);
    assert.ok(!fs.existsSync(f.stageRoot));
});
/* eslint-enable sonarjs/no-hardcoded-ip */
