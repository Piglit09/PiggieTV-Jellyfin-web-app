/* eslint-disable compat/compat, sonarjs/no-hardcoded-ip -- Node-only tooling;
    dotted literals are Jellyfin ABI versions. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const modulePath = new URL('./ptv-plugin-package.mjs', import.meta.url);
const sha = 'a'.repeat(40);
const version = '0.5.20.0';
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptv-package-'));
    const put = (name, data = 'fixture') => {
        const file = path.join(root, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, data);
    };
    for (const suffix of ['dll', 'deps.json', 'pdb', 'xml']) put(`Jellyfin.Plugin.PiggieTV.${suffix}`);
    put('meta.json', JSON.stringify({ version, targetAbi: '12.2.0.0', assemblies: ['Jellyfin.Plugin.PiggieTV.dll'] }));
    for (const rid of ['linux-x64', 'win-x64']) {
        const prefix = `helpers/${rid}/`;
        const assets = rid === 'linux-x64' ? ['libcoreclr.so', 'libhostfxr.so', 'libhostpolicy.so'] : ['coreclr.dll', 'hostfxr.dll', 'hostpolicy.dll'];
        assets.push('Ptv.ComicInfo.Helper.dll', 'SharpCompress.dll', 'System.Private.CoreLib.dll');
        for (const name of assets) put(prefix + name);
        put(prefix + 'Ptv.ComicInfo.Helper.runtimeconfig.json', JSON.stringify({ runtimeOptions: { includedFrameworks: [{ name: 'Microsoft.NETCore.App', version: '10.0.0' }] } }));
        put(prefix + 'Ptv.ComicInfo.Helper.deps.json', JSON.stringify({ runtimeTarget: { name: `.NETCoreApp,Version=v10.0/${rid}` }, targets: { [`.NETCoreApp,Version=v10.0/${rid}`]: { 'fixture/1': { runtime: Object.fromEntries(assets.map(name => [name, {}])) } } } }));
        put(prefix + 'Ptv.ComicInfo.Helper' + (rid === 'win-x64' ? '.exe' : ''));
    }
    return { root, put };
}
async function api() {
    let result;
    try {
        result = await import(modulePath);
    } catch {
        assert.fail('Deterministic package implementation is missing');
    }
    return result;
}
test('package round trip is deterministic, preserves Linux executable mode, and binds every byte to source', async () => {
    const { composePackage, verifyPackage } = await api();
    const { root } = fixture();
    try {
        const one = composePackage(root, { sourceCommit: sha, version });
        const two = composePackage(root, { sourceCommit: sha, version });
        assert.deepEqual(one, two);
        assert.equal(one.manifest.sourceCommit, sha);
        assert.equal(one.manifest.resourceBoundary.memoryBytes, 536870912);
        assert.equal(one.manifest.files.find(file => file.path === 'helpers/linux-x64/Ptv.ComicInfo.Helper').mode, '0755');
        assert.equal(verifyPackage(one.archive, one.manifest), true);
        const tampered = Buffer.from(one.archive);
        tampered[600] ^= 1;
        assert.throws(() => verifyPackage(tampered, one.manifest));
        const badMode = structuredClone(one.manifest);
        badMode.files.find(file => file.path === 'helpers/linux-x64/Ptv.ComicInfo.Helper').mode = '0644';
        assert.throws(() => verifyPackage(one.archive, badMode));
        const badBoundary = structuredClone(one.manifest);
        delete badBoundary.resourceBoundary;
        assert.throws(() => verifyPackage(one.archive, badBoundary));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
for (const missing of ['helpers/linux-x64/Ptv.ComicInfo.Helper', 'helpers/win-x64/Ptv.ComicInfo.Helper.exe', 'helpers/linux-x64/libcoreclr.so', 'helpers/win-x64/SharpCompress.dll']) {
    test(`rejects missing runtime payload ${missing}`, async () => {
        const { composePackage } = await api();
        const { root } = fixture();
        try {
            fs.unlinkSync(path.join(root, missing));
            assert.throws(() => composePackage(root, { sourceCommit: sha, version }));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
}
test('rejects wrong declared version, helper assembly loading, extra root file, and non-commit provenance', async () => {
    const { composePackage } = await api();
    const { root, put } = fixture();
    try {
        assert.throws(() => composePackage(root, { sourceCommit: sha, version: '0.0.0.0' }));
        assert.throws(() => composePackage(root, { sourceCommit: 'dirty', version }));
        put('unexpected.dll');
        assert.throws(() => composePackage(root, { sourceCommit: sha, version }));
        fs.unlinkSync(path.join(root, 'unexpected.dll'));
        put('meta.json', JSON.stringify({ version, targetAbi: '12.2.0.0', assemblies: ['Ptv.ComicInfo.Helper.dll'] }));
        assert.throws(() => composePackage(root, { sourceCommit: sha, version }));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
/* eslint-enable compat/compat, sonarjs/no-hardcoded-ip */
