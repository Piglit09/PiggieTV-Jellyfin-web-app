/* eslint-disable sonarjs/no-hardcoded-ip -- Dotted 12.2.0.0 values are the Jellyfin ABI, not network addresses. */
// Stage the verified Windows part of a PiggieTV Plugin package for .125 only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPackage } from './ptv-plugin-package.mjs';
import { canonicalDigest } from './ptv-artifact-manifest.mjs';

const rootFiles = new Set(['Jellyfin.Plugin.PiggieTV.deps.json', 'Jellyfin.Plugin.PiggieTV.dll',
    'Jellyfin.Plugin.PiggieTV.pdb', 'Jellyfin.Plugin.PiggieTV.xml', 'meta.json']);
const requiredWindows = ['Ptv.ComicInfo.Helper.exe', 'Ptv.ComicInfo.Helper.dll',
    'Ptv.ComicInfo.Helper.deps.json', 'Ptv.ComicInfo.Helper.runtimeconfig.json',
    'SharpCompress.dll', 'System.Private.CoreLib.dll', 'coreclr.dll', 'hostfxr.dll', 'hostpolicy.dll'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
const isSha = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const isCommit = value => typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value);

function safeRelative(relative) {
    assert(typeof relative === 'string' && relative && !relative.includes('\\')
        && !relative.includes(':') && !relative.startsWith('/') && !relative.endsWith('/')
        && !relative.includes('//'), `Unexpected Plugin package path: ${relative}`);
    for (const part of relative.split('/')) {
        const hasControl = [...part].some(character => character.charCodeAt(0) <= 31);
        assert(part && part !== '.' && part !== '..' && !/[<>:"|?*]/u.test(part) && !hasControl
            && !part.endsWith('.') && !part.endsWith(' ')
            && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(part),
        `Unexpected Plugin package path: ${relative}`);
    }
}

function assertRegularTree(root, expectedNames) {
    const names = fs.readdirSync(root, { withFileTypes: true });
    assert.deepEqual(names.map(entry => entry.name).sort(), expectedNames, 'Unexpected Plugin artifact file');
    assert(names.every(entry => entry.isFile() && !entry.isSymbolicLink()), 'Plugin artifact contains a non-file');
}

function assertOuterFile(root, entry) {
    // eslint-disable-next-line sonarjs/no-collection-size-mischeck -- entry.size is untrusted manifest metadata.
    assert(entry && Number.isSafeInteger(entry.size) && entry.size >= 0 && isSha(entry.sha256),
        'Invalid outer Plugin artifact manifest entry');
    const file = path.join(root, entry.path);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.length, entry.size, `Outer Plugin artifact size differs: ${entry.path}`);
    assert.equal(digest(bytes), entry.sha256, `Outer Plugin artifact hash differs: ${entry.path}`);
    return bytes;
}

export function stageDevelopmentPlugin({ artifactRoot, artifactManifest, stageRoot, expectedCommit, expectedVersion,
    expectedManifestDigest }) {
    assert(process.platform === 'win32', 'Development Plugin staging requires the Windows .125 host');
    assert(isCommit(expectedCommit), 'Expected source commit is invalid');
    assert(/^\d+\.\d+\.\d+\.0$/u.test(expectedVersion), 'Expected Plugin version is invalid');
    const root = fs.realpathSync.native(artifactRoot);
    const outer = readJson(artifactManifest);
    assert(outer.schemaVersion === 1 && outer.projectId === 'PTV_PLUGIN', 'Invalid outer Plugin artifact manifest');
    assert(isSha(expectedManifestDigest) && outer.manifestDigest === expectedManifestDigest
        && canonicalDigest(outer) === expectedManifestDigest, 'Outer Plugin manifest digest differs from protected preflight');
    assert.equal(outer.sourceCommit, expectedCommit, 'Outer Plugin source commit differs');
    assert.equal(outer.sourceVersions?.plugin, expectedVersion, 'Outer Plugin version differs');
    assertRegularTree(root, ['PiggieTV.tar', 'package-manifest.json']);
    assert.deepEqual(outer.files?.map(entry => entry.path).sort(), ['PiggieTV.tar', 'package-manifest.json'],
        'Unexpected outer Plugin artifact inventory');
    const outerEntries = new Map(outer.files.map(entry => [entry.path, entry]));
    const archive = assertOuterFile(root, outerEntries.get('PiggieTV.tar'));
    const packageBytes = assertOuterFile(root, outerEntries.get('package-manifest.json'));
    const packageManifest = JSON.parse(packageBytes.toString('utf8'));
    assert.equal(packageManifest.sourceCommit, expectedCommit, 'Package source commit differs');
    assert.equal(packageManifest.version, expectedVersion, 'Package version differs');
    assert.equal(packageManifest.targetAbi, '12.2.0.0', 'Package Jellyfin ABI differs');
    verifyPackage(archive, packageManifest);
    const records = packageManifest.files;
    const names = new Set();
    const install = [];
    for (const record of records) {
        safeRelative(record.path);
        assert(!names.has(record.path.toLowerCase()), `Duplicate Plugin package path: ${record.path}`);
        names.add(record.path.toLowerCase());
        assert(rootFiles.has(record.path) || record.path.startsWith('helpers/win-x64/')
            || record.path.startsWith('helpers/linux-x64/'), `Unexpected Plugin package entry: ${record.path}`);
        if (rootFiles.has(record.path) || record.path.startsWith('helpers/win-x64/')) install.push(record);
    }
    for (const name of rootFiles) assert(names.has(name.toLowerCase()), `Missing Plugin root file: ${name}`);
    for (const name of requiredWindows) {
        assert(names.has(`helpers/win-x64/${name}`.toLowerCase()), `Missing Windows helper file: ${name}`);
    }
    const meta = JSON.parse(archive.subarray(archiveOffset(records, 'meta.json'),
        archiveOffset(records, 'meta.json') + records.find(record => record.path === 'meta.json').size).toString('utf8'));
    assert(meta.version === expectedVersion && meta.targetAbi === '12.2.0.0'
        && JSON.stringify(meta.assemblies) === JSON.stringify(['Jellyfin.Plugin.PiggieTV.dll']),
    'Plugin metadata version, ABI, or assembly differs');
    const stage = path.resolve(stageRoot);
    const stageParent = fs.realpathSync.native(path.dirname(stage));
    assert.equal(path.dirname(stage), stageParent, 'Stage parent contains a reparse point');
    assert(!fs.existsSync(stage), 'Plugin stage already exists');
    assert(stage !== root && !stage.startsWith(root + path.sep), 'Plugin stage must be outside package root');
    fs.mkdirSync(stage);
    try {
        for (const record of install) {
            const destination = path.resolve(stage, ...record.path.split('/'));
            assert(destination.startsWith(stage + path.sep), 'Plugin stage path escaped root');
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            const bytes = archive.subarray(archiveOffset(records, record.path),
                archiveOffset(records, record.path) + record.size);
            fs.writeFileSync(destination, bytes, { flag: 'wx' });
            assert.equal(digest(fs.readFileSync(destination)), record.sha256, `Staged Plugin file differs: ${record.path}`);
        }
    } catch (error) {
        if (path.dirname(stage) === stageParent && fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
        throw error;
    }
    return { sourceCommit: expectedCommit, version: expectedVersion, fileCount: install.length, stageRoot: stage };
}

function archiveOffset(records, desired) {
    let offset = 0;
    for (const record of records) {
        if (record.path === desired) return offset + 512;
        offset += 512 + Math.ceil(record.size / 512) * 512;
    }
    throw new Error(`Plugin package entry absent: ${desired}`);
}

function cli(argv) {
    assert(argv.length % 2 === 0, 'Every stage option needs a value');
    const options = new Map();
    const allowed = new Set(['--artifact-root', '--artifact-manifest', '--stage-root', '--expected-commit',
        '--expected-version', '--expected-manifest-digest']);
    for (let i = 0; i < argv.length; i += 2) {
        assert(allowed.has(argv[i]) && !options.has(argv[i]), `Unexpected stage option: ${argv[i]}`);
        options.set(argv[i], argv[i + 1]);
    }
    assert(options.size === allowed.size, 'Stage options are incomplete');
    const result = stageDevelopmentPlugin({
        artifactRoot: options.get('--artifact-root'), artifactManifest: options.get('--artifact-manifest'),
        stageRoot: options.get('--stage-root'), expectedCommit: options.get('--expected-commit'),
        expectedVersion: options.get('--expected-version'),
        expectedManifestDigest: options.get('--expected-manifest-digest')
    });
    process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        cli(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`PTV development Plugin stage: ${error.message}\n`);
        process.exitCode = 1;
    }
}
/* eslint-enable sonarjs/no-hardcoded-ip */
