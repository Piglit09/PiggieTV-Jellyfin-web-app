import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import * as preflight from './ptv-workspace-preflight.mjs';
import { canonicalDigest } from './ptv-artifact-manifest.mjs';

const root = path.resolve('C:/Users/Piggie/Documents/GitHub/Jellyfin-Web-PiggieTV');
const commonDir = path.join(root, '.git');
const artifactRoot = path.resolve('C:/Users/Piggie/Documents/GitHub/_PTV-Artifacts');
const remote = 'https://github.com/Piglit09/PiggieTV-Jellyfin-web-app.git';
const target = {
    environmentId: 'JF_DEVELOPMENT_125',
    // eslint-disable-next-line sonarjs/no-hardcoded-ip -- Exact development identity is the subject of this fixture.
    host: '10.16.0.125',
    serverId: 'c1858e3f2d09468fb546ad9cfe438283',
    serverName: 'PTV Testing',
    webTargetPath: path.resolve('C:/Program Files/Jellyfin/Server/jellyfin-web'),
    pluginTargetRoot: path.resolve('C:/JFData/plugins/PiggieTV_Plugin (testing)')
};

function fixture() {
    const now = Date.parse('2026-10-21T12:00:00Z');
    const identity = { root, commonDir, remote };
    const policy = { artifactRoot };
    const registry = { schemaVersion: 1, projectId: 'PTV_WEB', environments: [
        { id: target.environmentId, role: 'DEVELOPMENT', host: target.host,
            currentRuntimeIdentity: target.serverId,
            deployment: { enabled: true, serverId: target.serverId, serverName: target.serverName,
                webTargetPath: target.webTargetPath, pluginTargetRoot: target.pluginTargetRoot } }
    ] };
    const operatorPolicy = { schemaVersion: 3,
        issuedUtc: '2026-10-20T00:00:00Z', expiresUtc: '2027-10-20T00:00:00Z',
        projects: [{ projectId: 'PTV_WEB', state: 'ACTIVE', sourceRoot: root,
            gitCommonDir: commonDir, remote, artifactRoots: [artifactRoot],
            permissions: { sourceEdit: true, localBuild: true, debugPackage: false,
                testDeviceInstall: false, testDeploy125: true, githubPublish: false, productionDeploy50: false },
            developmentDeployment: { ...target } }] };
    return { now, identity, policy, registry, operatorPolicy, environmentId: target.environmentId };
}

test('standing development permission returns only the protected .125 target', () => {
    assert.equal(typeof preflight.validateDevelopmentAuthorization, 'function');
    assert.deepEqual(preflight.validateDevelopmentAuthorization(fixture()), target);
    const laterSchema = fixture();
    laterSchema.operatorPolicy.schemaVersion = 4;
    assert.deepEqual(preflight.validateDevelopmentAuthorization(laterSchema), target);
});

test('standing development denies production and an unregistered destination', () => {
    const f = fixture();
    assert.throws(() => preflight.validateDevelopmentAuthorization({ ...f, environmentId: 'JF_PRODUCTION_50' }), /only.*development/i);
    // eslint-disable-next-line sonarjs/no-hardcoded-ip -- Production host must remain denied.
    f.registry.environments[0].host = '10.16.0.50';
    assert.throws(() => preflight.validateDevelopmentAuthorization(f), /target identity|host/i);
});

test('standing development denies absent, held, or disabled protected authority', () => {
    const missing = fixture();
    missing.operatorPolicy = null;
    assert.throws(() => preflight.validateDevelopmentAuthorization(missing), /protected shared development policy/i);
    const held = fixture();
    held.operatorPolicy.projects[0].state = 'HOLD';
    assert.throws(() => preflight.validateDevelopmentAuthorization(held), /does not authorize/i);
    const disabled = fixture();
    disabled.operatorPolicy.projects[0].permissions.testDeploy125 = false;
    assert.throws(() => preflight.validateDevelopmentAuthorization(disabled), /does not authorize/i);
    const registryDenied = fixture();
    registryDenied.registry.environments[0].deployment.enabled = false;
    assert.throws(() => preflight.validateDevelopmentAuthorization(registryDenied), /target identity|authorization/i);
});

test('standing development denies a mismatched source, duplicate project, or wrong target folder', () => {
    const wrongSource = fixture();
    wrongSource.operatorPolicy.projects[0].sourceRoot = path.resolve('C:/Other/Source');
    assert.throws(() => preflight.validateDevelopmentAuthorization(wrongSource), /source identity/i);
    const duplicate = fixture();
    duplicate.operatorPolicy.projects.push({ ...duplicate.operatorPolicy.projects[0] });
    assert.throws(() => preflight.validateDevelopmentAuthorization(duplicate), /duplicated/i);
    const wrongTarget = fixture();
    wrongTarget.registry.environments[0].deployment.pluginTargetRoot = path.resolve('C:/JFData/plugins');
    assert.throws(() => preflight.validateDevelopmentAuthorization(wrongTarget), /pluginTargetRoot/i);
    const wrongServer = fixture();
    wrongServer.operatorPolicy.projects[0].developmentDeployment.serverId = '0'.repeat(32);
    assert.throws(() => preflight.validateDevelopmentAuthorization(wrongServer), /serverId/i);
});

test('standing development denies expired protected policy and production permission', () => {
    const expired = fixture();
    expired.operatorPolicy.expiresUtc = '2026-10-21T11:00:00Z';
    assert.throws(() => preflight.validateDevelopmentAuthorization(expired), /not current/i);
    const productionEnabled = fixture();
    productionEnabled.operatorPolicy.projects[0].permissions.productionDeploy50 = true;
    assert.throws(() => preflight.validateDevelopmentAuthorization(productionEnabled), /does not authorize/i);
});

const sourceCommit = 'f815f23f077d4df3eede68e21323f799d120b832';
const sourceVersions = { web: '0.5.77', plugin: '0.5.24.0' };

function manifest(projectId, buildMode) {
    const unsigned = { schemaVersion: 1, projectId, buildMode, sourceRoot: root, sourceCommit,
        sourceDirty: false, sourceVersions: { ...sourceVersions, package: '10.11.11' },
        files: [{ path: projectId === 'PTV_WEB' ? 'index.html' : 'PiggieTV.tar',
            size: 1, sha256: 'a'.repeat(64) }] };
    return { ...unsigned, manifestDigest: canonicalDigest(unsigned) };
}

test('development manifest headers bind both components to one clean source commit', () => {
    assert.equal(typeof preflight.validateDevelopmentManifestHeaders, 'function');
    const web = manifest('PTV_WEB', 'production');
    const plugin = manifest('PTV_PLUGIN', 'package');
    const result = preflight.validateDevelopmentManifestHeaders({
        manifests: { web, plugin }, identity: { root, head: sourceCommit },
        versions: sourceVersions, sourceCommit
    });
    assert.deepEqual(result, { components: ['web', 'plugin'],
        manifestDigests: { web: web.manifestDigest, plugin: plugin.manifestDigest } });
});

test('development artifact selection accepts complete component pairs without a caller target', () => {
    assert.equal(typeof preflight.validateDevelopmentArtifactSelection, 'function');
    assert.deepEqual(preflight.validateDevelopmentArtifactSelection({
        webManifest: 'web.json', webArtifactRoot: 'dist',
        pluginManifest: 'plugin.json', pluginArtifactRoot: 'package'
    }), ['web', 'plugin']);
    assert.deepEqual(preflight.validateDevelopmentArtifactSelection({
        pluginManifest: 'plugin.json', pluginArtifactRoot: 'package'
    }), ['plugin']);
});

test('development artifact selection rejects missing pairs and legacy approval inputs', () => {
    assert.throws(() => preflight.validateDevelopmentArtifactSelection({}), /artifact is required/i);
    assert.throws(() => preflight.validateDevelopmentArtifactSelection({ webManifest: 'web.json' }), /supplied together/i);
    assert.throws(() => preflight.validateDevelopmentArtifactSelection({
        webManifest: 'web.json', webArtifactRoot: 'dist', approvalRecord: 'caller-approval.json'
    }), /legacy release deployment evidence/i);
});

test('development manifest headers reject a forged commit, version, digest, or component kind', () => {
    const check = plugin => preflight.validateDevelopmentManifestHeaders({ manifests: { plugin },
        identity: { root, head: sourceCommit }, versions: sourceVersions, sourceCommit });
    const wrongCommit = manifest('PTV_PLUGIN', 'package');
    wrongCommit.sourceCommit = '0'.repeat(40);
    wrongCommit.manifestDigest = canonicalDigest(wrongCommit);
    assert.throws(() => check(wrongCommit), /provenance/i);
    const wrongVersion = manifest('PTV_PLUGIN', 'package');
    wrongVersion.sourceVersions.plugin = '0.5.23.0';
    wrongVersion.manifestDigest = canonicalDigest(wrongVersion);
    assert.throws(() => check(wrongVersion), /provenance/i);
    const wrongDigest = manifest('PTV_PLUGIN', 'package');
    wrongDigest.manifestDigest = 'b'.repeat(64);
    assert.throws(() => check(wrongDigest), /provenance/i);
    const wrongKind = manifest('PTV_WEB', 'production');
    assert.throws(() => check(wrongKind), /provenance/i);
});

test('frozen development source must be a full reachable commit', () => {
    assert.equal(typeof preflight.validateDevelopmentSourceSelection, 'function');
    assert.equal(preflight.validateDevelopmentSourceSelection({ head: '1'.repeat(40),
        frozenSourceCommit: sourceCommit, objectType: 'commit', reachable: true }), sourceCommit);
    assert.throws(() => preflight.validateDevelopmentSourceSelection({ head: '1'.repeat(40),
        frozenSourceCommit: sourceCommit, objectType: 'commit', reachable: false }), /reachable|ancestor/i);
});
