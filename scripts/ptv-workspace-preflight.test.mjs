import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import * as preflight from './ptv-workspace-preflight.mjs';
import { buildManifest } from './ptv-artifact-manifest.mjs';

const { approvalAclSafe, approvalProtectedFromCurrentProcess, evaluatePreflight, operatorAclSafe } = preflight;

const fixtures = [];
const remote = 'https://github.com/Piglit09/PiggieTV-Jellyfin-web-app.git';
const gitExecutable = process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : '/usr/bin/git';

function git(cwd, ...args) {
    return execFileSync(gitExecutable, args, { cwd, encoding: 'utf8' }).trim();
}

function fixture() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ptv-preflight-'));
    fixtures.push(base);
    const root = path.join(base, 'source');
    fs.mkdirSync(root);
    git(root, 'init', '-q');
    git(root, 'config', 'user.name', 'Fixture');
    git(root, 'config', 'user.email', 'fixture@example.invalid');
    git(root, 'remote', 'add', 'origin', remote);
    fs.writeFileSync(path.join(root, 'ptv-version.json'), '{"version":"0.5.71"}\n');
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"10.11.11"}\n');
    const plugin = path.join(root, 'src', 'ptv', 'plugin', 'Jellyfin.Plugin.PiggieTV');
    fs.mkdirSync(plugin, { recursive: true });
    fs.writeFileSync(path.join(plugin, 'Jellyfin.Plugin.PiggieTV.csproj'), '<Project><PropertyGroup><PtvPluginVersion>0.5.22.0</PtvPluginVersion></PropertyGroup></Project>\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'fixture');
    const head = git(root, 'rev-parse', 'HEAD');
    const policy = {
        schemaVersion: 1,
        projectId: 'PTV_WEB',
        sourceRoot: root,
        gitCommonDirectory: path.join(root, '.git'),
        expectedRemote: remote,
        artifactRoot: path.join(base, 'artifacts'),
        environmentRegistry: 'docs/operations/ptv-environments.json',
        versionSources: {
            web: 'ptv-version.json',
            plugin: 'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj'
        },
        ci: { repository: 'Piglit09/PiggieTV-Jellyfin-web-app' },
        operatorPolicy: { kind: 'windows-registry', key: 'HKLM\\SOFTWARE\\PiggieTV\\WorkspaceAuthority', value: 'PolicyJson' }
    };
    const authority = {
        sourceRoot: root,
        gitCommonDirectory: path.join(root, '.git'),
        expectedRemote: remote,
        artifactRoot: path.join(base, 'artifacts'),
        environmentRegistry: 'docs/operations/ptv-environments.json',
        ciRepository: 'Piglit09/PiggieTV-Jellyfin-web-app'
    };
    const registry = {
        schemaVersion: 1,
        projectId: 'PTV_WEB',
        environments: [
            { id: 'JF_PRODUCTION_50', role: 'PRODUCTION', host: null, deployment: { enabled: false, targetPath: null } },
            { id: 'JF_DEVELOPMENT_125', role: 'DEVELOPMENT', host: null, deployment: { enabled: false, targetPath: null } }
        ]
    };
    return { base, root, head, policy, authority, registry };
}

function check(f, mode, extra = {}) {
    return evaluatePreflight({ mode, cwd: f.root, policy: f.policy, authority: f.authority, registry: f.registry,
        protectedApprovalProbe: () => true, ...extra });
}

function cloudFixture() {
    const f = fixture();
    const cloudDevelopment = {
        sourceRoot: f.root,
        gitCommonDirectory: path.join(f.root, '.git'),
        expectedRemote: remote,
        baseCommit: f.head,
        branchPrefix: 'codex/bugfix/',
        allowedModes: ['edit', 'build']
    };
    git(f.root, 'switch', '-q', '-c', 'codex/bugfix/fixture');
    git(f.root, 'commit', '--allow-empty', '-qm', 'bugfix fixture');
    return { ...f, policy: { ...f.policy, cloudDevelopment }, authority: { ...f.authority, cloudDevelopment } };
}

function frozenFixture() {
    const f = fixture();
    const artifactRoot = path.join(f.base, 'frozen-artifact');
    fs.mkdirSync(artifactRoot);
    fs.writeFileSync(path.join(artifactRoot, 'index.html'), '<html>fixture</html>');
    fs.writeFileSync(path.join(artifactRoot, 'config.json'), '{}');
    fs.writeFileSync(path.join(artifactRoot, 'main.js'), `const commit = '${f.head}';`);
    const manifest = buildManifest({ artifactRoot, sourceRoot: f.root, projectId: 'PTV_WEB', buildMode: 'production' });
    const manifestPath = path.join(f.base, 'frozen-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const archive = path.join(f.base, 'frozen.zip');
    fs.writeFileSync(archive, 'fixture frozen archive bytes');
    const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const archiveSha256 = sha256(archive);
    const sourceTree = git(f.root, 'rev-parse', `${f.head}^{tree}`);
    const target = path.join(f.base, 'mock-target');
    fs.mkdirSync(target);
    f.registry.environments.push({ id: 'MOCK', role: 'TEST', host: null, deployment: { enabled: true, targetPath: target } });
    const backup = path.join(f.base, 'backup.zip');
    fs.writeFileSync(backup, 'fixture previous Web archive');
    const rollback = path.join(f.base, 'rollback.json');
    fs.writeFileSync(rollback, JSON.stringify({
        schemaVersion: 1, environmentId: 'MOCK', targetPath: target,
        candidateSourceCommit: f.head, candidateSourceTree: sourceTree,
        artifactManifestDigest: manifest.manifestDigest, candidateArchiveSha256: archiveSha256,
        candidateVersions: { web: '0.5.71', plugin: '0.5.22.0' },
        backupPath: backup, backupSha256: sha256(backup), createdAt: new Date(Date.now() - 1000).toISOString()
    }));
    const approvalBinding = {
        taskId: 'frozen-fixture', serverId: 'c1858e3f2d09468fb546ad9cfe438283',
        maintenanceWindowStartUtc: new Date(Date.now() - 60_000).toISOString(),
        maintenanceWindowEndUtc: new Date(Date.now() + 60_000).toISOString(),
        userImpactAttested: true, betaIsolationAttested: true,
        betaRouteBoundToExpectedServer: true, noUnapprovedAudience: true,
        betaRouteVerifiedAtUtc: new Date(Date.now() - 30_000).toISOString(),
        maintenanceUserIds: ['test-maintainer']
    };
    const approval = path.join(f.base, 'approval.json');
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    fs.writeFileSync(approval, JSON.stringify({
        schemaVersion: 1, operatorApproved: true, operation: 'web-only-frozen-artifact-deployment',
        ...approvalBinding, environmentId: 'MOCK', sourceCommit: f.head, sourceTree,
        artifactManifestDigest: manifest.manifestDigest, artifactArchiveSha256: archiveSha256,
        rollbackBackupSha256: sha256(backup), targetPath: target, rollbackReference: rollback,
        expiresAt
    }));
    const authorization = {
        environmentId: 'MOCK', enabled: true, targetPath: target,
        operation: 'web-only-frozen-artifact-deployment', ...approvalBinding, expiresAt,
        sourceCommit: f.head, sourceTree, artifactManifestDigest: manifest.manifestDigest,
        artifactArchiveSha256: archiveSha256, rollbackBackupSha256: sha256(backup),
        approvalRecordPath: approval, approvalSha256: sha256(approval),
        rollbackReference: rollback, rollbackSha256: sha256(rollback)
    };
    const operatorPolicy = {
        schemaVersion: 1, projectId: 'PTV_WEB', sourceRoot: f.root,
        gitCommonDirectory: path.join(f.root, '.git'), expectedRemote: remote,
        deployments: [authorization]
    };
    const flags = { environmentId: 'MOCK', artifactManifest: manifestPath, artifactArchive: archive,
        artifactRoot, frozenSourceCommit: f.head, approvalRecord: approval, rollbackReference: rollback };
    fs.writeFileSync(path.join(f.root, 'handoff.md'), 'Documentation-only follow-up.\n');
    git(f.root, 'add', 'handoff.md');
    git(f.root, 'commit', '-qm', 'docs follow-up');
    return { ...f, flags, operatorPolicy, authorization, manifest, manifestPath, archive,
        archiveSha256, sourceTree, target, backup, rollback, approval, sha256 };
}

afterEach(() => {
    while (fixtures.length) {
        const base = fixtures.pop();
        if (base.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
            fs.rmSync(base, { recursive: true, force: true });
        }
    }
});

test('accepts approved root and nested directory without changing source', () => {
    const f = fixture();
    const before = git(f.root, 'status', '--porcelain=v1');
    const rootResult = check(f, 'edit');
    const nestedResult = check(f, 'build', { cwd: path.join(f.root, 'src', 'ptv') });
    assert.equal(rootResult.head, f.head);
    assert.equal(nestedResult.sourceRoot, fs.realpathSync.native(f.root));
    assert.equal(git(f.root, 'status', '--porcelain=v1'), before);
});

test('cloud development allows edit and build only at the pinned root on a descendant bugfix branch', () => {
    const f = cloudFixture();
    fs.writeFileSync(path.join(f.root, 'in-progress.txt'), 'fixture work\n');
    const before = git(f.root, 'status', '--porcelain=v1');
    const head = git(f.root, 'rev-parse', 'HEAD');
    assert.equal(check(f, 'edit', { runtimePlatform: 'linux' }).authority, 'cloud-development');
    assert.equal(check(f, 'build', { runtimePlatform: 'linux', cwd: path.join(f.root, 'src', 'ptv') }).head, head);
    assert.equal(git(f.root, 'status', '--porcelain=v1'), before);
});

test('cloud development rejects wrong root, linked worktree, policy, common directory and remote', () => {
    const f = cloudFixture();
    const other = path.join(f.base, 'other');
    git(f.root, 'worktree', 'add', '-q', '-b', 'codex/bugfix/other', other);
    assert.throws(() => check(f, 'edit', { cwd: other, runtimePlatform: 'linux' }), /approved source root|cloud development/i);
    assert.throws(() => check({ ...f, policy: { ...f.policy, cloudDevelopment: {
        ...f.policy.cloudDevelopment, sourceRoot: other
    } } }, 'edit', { runtimePlatform: 'linux' }), /pinned.*cloud.*source root/i);
    assert.throws(() => check({ ...f, policy: { ...f.policy, cloudDevelopment: {
        ...f.policy.cloudDevelopment, gitCommonDirectory: other
    } } }, 'edit', { runtimePlatform: 'linux' }), /pinned.*cloud.*common directory/i);
    assert.throws(() => check({ ...f, policy: { ...f.policy, cloudDevelopment: {
        ...f.policy.cloudDevelopment, allowedModes: ['edit', 'build', 'package']
    } } }, 'edit', { runtimePlatform: 'linux' }), /pinned.*cloud.*permissions/i);
    assert.throws(() => check({ ...f, policy: { ...f.policy, cloudDevelopment: {
        ...f.policy.cloudDevelopment, baseCommit: '0'.repeat(40)
    } } }, 'edit', { runtimePlatform: 'linux' }), /pinned.*cloud.*baseline/i);
    git(f.root, 'remote', 'set-url', 'origin', 'https://example.invalid/other.git');
    assert.throws(() => check(f, 'edit', { runtimePlatform: 'linux' }), /remote/i);
});

test('cloud development rejects a linked Git file even when its common directory is allowlisted', () => {
    const f = cloudFixture();
    const linked = path.join(f.base, 'linked-cloud');
    git(f.root, 'worktree', 'add', '-q', '-b', 'codex/bugfix/linked', linked);
    const cloudDevelopment = { ...f.policy.cloudDevelopment,
        sourceRoot: linked, gitCommonDirectory: path.join(f.root, '.git') };
    const linkedFixture = { ...f, policy: { ...f.policy, cloudDevelopment },
        authority: { ...f.authority, cloudDevelopment } };
    assert.throws(() => check(linkedFixture, 'edit', { cwd: linked, runtimePlatform: 'linux' }),
        /standalone Git directory/i);
});

test('cloud development rejects a different effective origin push URL', () => {
    const f = cloudFixture();
    git(f.root, 'remote', 'set-url', '--push', 'origin', 'https://example.invalid/other.git');
    assert.throws(() => check(f, 'edit', { runtimePlatform: 'linux' }), /cloud.*push remote/i);
});

test('cloud development rejects wrong branch, detached HEAD and unrelated or unavailable baseline', () => {
    const f = cloudFixture();
    git(f.root, 'switch', '-q', '-c', 'feature/unapproved');
    assert.throws(() => check(f, 'edit', { runtimePlatform: 'linux' }), /cloud.*branch/i);
    const head = git(f.root, 'rev-parse', 'HEAD');
    assert.throws(() => check(f, 'build', { runtimePlatform: 'linux',
        ciContext: { actions: true, repository: 'Piglit09/PiggieTV-Jellyfin-web-app', workspace: f.root, sha: head }
    }), /cloud.*branch/i);
    git(f.root, 'switch', '-q', 'codex/bugfix/fixture');
    git(f.root, 'checkout', '-q', '--detach');
    assert.throws(() => check(f, 'edit', { runtimePlatform: 'linux' }), /cloud.*branch/i);
    git(f.root, 'switch', '-q', 'codex/bugfix/fixture');
    const unrelated = git(f.root, 'commit-tree', 'HEAD^{tree}', '-m', 'unrelated root');
    assert.throws(() => check({ ...f, policy: { ...f.policy, cloudDevelopment: {
        ...f.policy.cloudDevelopment, baseCommit: unrelated
    } }, authority: { ...f.authority, cloudDevelopment: {
        ...f.authority.cloudDevelopment, baseCommit: unrelated
    } } }, 'edit', { runtimePlatform: 'linux' }), /cloud.*ancestor|cloud.*baseline/i);
    assert.throws(() => check({ ...f, policy: { ...f.policy, cloudDevelopment: {
        ...f.policy.cloudDevelopment, baseCommit: '0'.repeat(40)
    } }, authority: { ...f.authority, cloudDevelopment: {
        ...f.authority.cloudDevelopment, baseCommit: '0'.repeat(40)
    } } }, 'edit', { runtimePlatform: 'linux' }), /cloud.*baseline/i);
});

test('cloud development cannot be used for package or deployment, including CI-looking inputs', () => {
    const f = cloudFixture();
    const head = git(f.root, 'rev-parse', 'HEAD');
    const ci = { actions: true, repository: 'Piglit09/PiggieTV-Jellyfin-web-app', workspace: f.root, sha: head };
    for (const mode of ['package', 'deploy', 'deploy-development']) {
        assert.throws(() => check(f, mode, { runtimePlatform: 'linux' }), /cloud development.*edit\/build/i);
        assert.throws(() => check(f, mode, { runtimePlatform: 'linux', ciContext: ci }),
            /cloud development.*edit\/build/i);
        assert.throws(() => check(f, mode, { runtimePlatform: 'linux', flags: { ciRef: head }, ciContext: ci }),
            /cloud development.*edit\/build/i);
    }
    assert.throws(() => check(f, 'build', { runtimePlatform: 'linux', flags: { ciRef: head }, ciContext: ci }),
        /cloud development.*CI/i);
});

test('cloud policy preserves genuine exact-ref CI outside the cloud development root', () => {
    const f = cloudFixture();
    const ciRoot = path.join(f.base, 'ci-checkout');
    git(f.root, 'worktree', 'add', '-q', '--detach', ciRoot, f.head);
    const ci = { actions: true, repository: 'Piglit09/PiggieTV-Jellyfin-web-app', workspace: ciRoot, sha: f.head };
    assert.equal(check(f, 'build', { cwd: ciRoot, runtimePlatform: 'linux', ciContext: ci }).head, f.head);
    assert.equal(check(f, 'package', { cwd: ciRoot, runtimePlatform: 'linux', ciContext: ci }).head, f.head);
});

test('rejects wrong root and linked worktree for mutation but allows historical audit', () => {
    const f = fixture();
    const other = path.join(f.base, 'other');
    git(f.root, 'worktree', 'add', '--detach', other, f.head);
    assert.throws(() => check(f, 'edit', { cwd: other }), /approved source root/i);
    assert.throws(() => check(f, 'build', { cwd: other }), /approved source root/i);
    assert.equal(check(f, 'audit', { cwd: other }).mode, 'audit');
});

test('rejects a copied worktree that rewrites its task-writable policy to self-authorize', () => {
    const f = fixture();
    const other = path.join(f.base, 'other');
    git(f.root, 'worktree', 'add', '--detach', other, f.head);
    const forgedPolicy = { ...f.policy, sourceRoot: other };
    assert.throws(() => check({ ...f, policy: forgedPolicy }, 'build', { cwd: other }), /pinned.*source root/i);
    assert.equal(check({ ...f, policy: forgedPolicy }, 'audit', { cwd: other }).authority, 'historical-read-only');
});

test('rejects wrong remote, common directory, project and version source', () => {
    const f = fixture();
    assert.throws(() => check({ ...f, policy: { ...f.policy, expectedRemote: 'https://example.invalid/other.git' } }, 'edit'), /remote/i);
    assert.throws(() => check({ ...f, policy: { ...f.policy, gitCommonDirectory: path.join(f.base, 'other.git') } }, 'edit'), /common directory/i);
    assert.throws(() => check({ ...f, policy: { ...f.policy, projectId: 'UNKNOWN' } }, 'edit'), /project/i);
    assert.throws(() => check({ ...f, policy: { ...f.policy, versionSources: { ...f.policy.versionSources, web: 'wrong-version.json' } } }, 'edit'), /version source/i);
});

test('accepts the same GitHub remote with or without its optional .git suffix', () => {
    const f = fixture();
    git(f.root, 'remote', 'set-url', 'origin', remote.slice(0, -4));
    assert.equal(check(f, 'build').head, f.head);
});

test('rejects a dirty release package and forged commit override', () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.root, 'dirty.txt'), 'dirty\n');
    assert.throws(() => check(f, 'package'), /clean/i);
    assert.throws(() => check(f, 'build', { env: { PTV_COMMIT_SHA: '0'.repeat(40) } }), /commit/i);
});

test('rejects unknown and protected deployment targets before touching files', () => {
    const f = fixture();
    const before = git(f.root, 'status', '--porcelain=v1');
    assert.throws(() => check(f, 'deploy', { flags: { environmentId: 'UNKNOWN' } }), /unregistered/i);
    assert.throws(() => check(f, 'deploy', { flags: { environmentId: 'JF_PRODUCTION_50' } }), /deployment.*denied/i);
    assert.throws(() => check(f, 'deploy', { flags: { environmentId: 'JF_DEVELOPMENT_125' } }), /deployment.*denied/i);
    assert.equal(git(f.root, 'status', '--porcelain=v1'), before);
});

test('rejects missing approval, rollback, and tampered approval record', () => {
    const f = fixture();
    const target = path.join(f.base, 'mock-target');
    fs.mkdirSync(target);
    f.registry.environments.push({ id: 'MOCK', role: 'TEST', host: null, deployment: { enabled: true, targetPath: target } });
    assert.throws(() => check(f, 'deploy', { flags: { environmentId: 'MOCK' } }), /artifact manifest/i);
    const manifest = path.join(f.base, 'manifest.json');
    fs.writeFileSync(manifest, JSON.stringify({ sourceCommit: f.head, manifestDigest: 'a'.repeat(64), sourceDirty: false, sourceRoot: f.root,
        sourceVersions: { web: '0.5.71', plugin: '0.5.22.0' } }));
    assert.throws(() => check(f, 'deploy', { flags: { environmentId: 'MOCK', artifactManifest: manifest } }), /approval record/i);
    const approval = path.join(f.base, 'approval.json');
    fs.writeFileSync(approval, '{}');
    assert.throws(() => check(f, 'deploy', { flags: { environmentId: 'MOCK', artifactManifest: manifest, approvalRecord: approval } }), /rollback/i);
});

test('accepts only an exact protected mock deployment approval', () => {
    const f = fixture();
    const target = path.join(f.base, 'mock-target');
    fs.mkdirSync(target);
    f.registry.environments.push({ id: 'MOCK', role: 'TEST', host: null, deployment: { enabled: true, targetPath: target } });
    const manifest = path.join(f.base, 'manifest.json');
    const manifestDigest = 'a'.repeat(64);
    fs.writeFileSync(manifest, JSON.stringify({ sourceCommit: f.head, manifestDigest, sourceDirty: false, sourceRoot: f.root,
        sourceVersions: { web: '0.5.71', plugin: '0.5.22.0' } }));
    const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const backup = path.join(f.base, 'backup.zip');
    fs.writeFileSync(backup, 'verified mock backup payload\n');
    const rollback = path.join(f.base, 'rollback.txt');
    fs.writeFileSync(rollback, JSON.stringify({
        schemaVersion: 1, environmentId: 'MOCK', targetPath: target,
        candidateSourceCommit: f.head, artifactManifestDigest: manifestDigest,
        candidateVersions: { web: '0.5.71', plugin: '0.5.22.0' },
        backupPath: backup, backupSha256: sha256(backup),
        createdAt: new Date(Date.now() - 1000).toISOString()
    }));
    const approval = path.join(f.base, 'operator-approval.json');
    fs.writeFileSync(approval, JSON.stringify({
        taskId: 'fixture-task',
        environmentId: 'MOCK', sourceCommit: f.head, artifactManifestDigest: manifestDigest,
        targetPath: target, rollbackReference: rollback,
        expiresAt: new Date(Date.now() + 60_000).toISOString()
    }));
    const operatorPolicy = {
        schemaVersion: 1,
        projectId: 'PTV_WEB',
        sourceRoot: f.root,
        gitCommonDirectory: path.join(f.root, '.git'),
        expectedRemote: remote,
        deployments: [{
            environmentId: 'MOCK', enabled: true, targetPath: target,
            approvalRecordPath: approval, approvalSha256: sha256(approval),
            rollbackReference: rollback, rollbackSha256: sha256(rollback)
        }]
    };
    const flags = { environmentId: 'MOCK', artifactManifest: manifest, approvalRecord: approval, rollbackReference: rollback };
    assert.throws(() => check(f, 'deploy', { flags, operatorPolicy: { ...operatorPolicy, expectedRemote: 'https://example.invalid/other.git' } }), /Operator policy source identity mismatch/i);
    assert.equal(check(f, 'deploy', { flags, operatorPolicy }).targetPath, target);
    const rollbackRecord = JSON.parse(fs.readFileSync(rollback, 'utf8'));
    rollbackRecord.candidateVersions.web = '0.0.0';
    fs.writeFileSync(rollback, JSON.stringify(rollbackRecord));
    operatorPolicy.deployments[0].rollbackSha256 = sha256(rollback);
    assert.throws(() => check(f, 'deploy', { flags, operatorPolicy }), /rollback.*version/i);
    rollbackRecord.candidateVersions.web = '0.5.71';
    fs.writeFileSync(rollback, JSON.stringify(rollbackRecord));
    operatorPolicy.deployments[0].rollbackSha256 = sha256(rollback);
    fs.appendFileSync(backup, 'tamper');
    assert.throws(() => check(f, 'deploy', { flags, operatorPolicy }), /backup.*hash mismatch/i);
    fs.appendFileSync(approval, 'tamper');
    assert.throws(() => check(f, 'deploy', { flags, operatorPolicy }), /hash mismatch/i);
    assert.deepEqual(fs.readdirSync(target), []);
});

test('accepts a clean later HEAD only for the exact independently approved frozen Web archive', () => {
    const f = frozenFixture();
    assert.throws(() => check(f, 'deploy', { flags: { ...f.flags, frozenSourceCommit: undefined },
        operatorPolicy: f.operatorPolicy }), /source commit|manifest provenance/i);
    const result = check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy });
    assert.equal(result.sourceCommit, f.head);
    assert.equal(result.sourceTree, f.sourceTree);
    assert.equal(result.archiveSha256, f.archiveSha256);
    assert.equal(result.artifactManifestDigest, f.manifest.manifestDigest);
    assert.equal(result.targetPath, f.target);
    assert.deepEqual(result.approvalIdentity, {
        taskId: 'frozen-fixture', serverId: 'c1858e3f2d09468fb546ad9cfe438283',
        maintenanceWindowStartUtc: f.authorization.maintenanceWindowStartUtc,
        maintenanceWindowEndUtc: f.authorization.maintenanceWindowEndUtc,
        betaRouteVerifiedAtUtc: f.authorization.betaRouteVerifiedAtUtc,
        betaRouteBoundToExpectedServer: true, noUnapprovedAudience: true
    });
    assert.equal(JSON.stringify(result).includes('test-maintainer'), false);
    assert.deepEqual(fs.readdirSync(f.target), []);
});

test('frozen deployment requires matching and current operator maintenance evidence', () => {
    const f = frozenFixture();
    const original = JSON.parse(fs.readFileSync(f.approval, 'utf8'));
    const deniedApproval = (field, value) => {
        const modified = { ...original, [field]: value };
        fs.writeFileSync(f.approval, JSON.stringify(modified));
        f.authorization.approvalSha256 = f.sha256(f.approval);
        assert.throws(() => check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy }), /approval/i);
    };
    for (const field of ['taskId', 'serverId', 'maintenanceWindowStartUtc', 'maintenanceWindowEndUtc',
        'userImpactAttested', 'betaIsolationAttested', 'betaRouteVerifiedAtUtc', 'maintenanceUserIds',
        'betaRouteBoundToExpectedServer', 'noUnapprovedAudience']) {
        deniedApproval(field, undefined);
    }
    deniedApproval('taskId', 'wrong-task');
    deniedApproval('serverId', '0'.repeat(32));
    deniedApproval('maintenanceWindowStartUtc', new Date(Date.now() + 10_000).toISOString());
    deniedApproval('maintenanceWindowEndUtc', new Date(Date.now() - 10_000).toISOString());
    deniedApproval('userImpactAttested', false);
    deniedApproval('betaIsolationAttested', false);
    deniedApproval('betaRouteBoundToExpectedServer', false);
    deniedApproval('noUnapprovedAudience', false);
    deniedApproval('betaRouteVerifiedAtUtc', new Date(Date.now() - 301_000).toISOString());
    deniedApproval('maintenanceUserIds', ['different-maintainer']);
    deniedApproval('maintenanceUserIds', []);
    deniedApproval('maintenanceUserIds', ['test-maintainer', 'TEST-maintainer']);
    deniedApproval('expiresAt', new Date(Date.now() - 1000).toISOString());
    assert.deepEqual(fs.readdirSync(f.target), []);
});

test('frozen deployment denies inconsistent protected-policy maintenance evidence', () => {
    const f = frozenFixture();
    for (const field of ['taskId', 'serverId', 'maintenanceWindowStartUtc', 'maintenanceWindowEndUtc',
        'userImpactAttested', 'betaIsolationAttested', 'betaRouteVerifiedAtUtc', 'maintenanceUserIds',
        'betaRouteBoundToExpectedServer', 'noUnapprovedAudience']) {
        const original = f.authorization[field];
        delete f.authorization[field];
        assert.throws(() => check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy }), /approval/i);
        f.authorization[field] = original;
    }
    f.authorization.taskId = 'other-task';
    assert.throws(() => check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy }), /approval/i);
    assert.deepEqual(fs.readdirSync(f.target), []);
});

test('frozen recovery approval pins the transaction and journal hash in protected policy', () => {
    const f = frozenFixture();
    const transactionId = 'a'.repeat(32);
    const journalSha256 = 'b'.repeat(64);
    const approval = JSON.parse(fs.readFileSync(f.approval, 'utf8'));
    approval.recoveryAuthorized = true;
    approval.recoveryTransactionId = transactionId;
    fs.writeFileSync(f.approval, JSON.stringify(approval));
    f.authorization.approvalSha256 = f.sha256(f.approval);
    f.authorization.recoveryAuthorized = true;
    f.authorization.recoveryTransactionId = transactionId;
    f.authorization.recoveryTransactionJournalSha256 = journalSha256;
    const result = check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy });
    assert.equal(result.approvalIdentity.recoveryAuthorized, true);
    assert.equal(result.approvalIdentity.recoveryTransactionId, transactionId);
    assert.equal(result.approvalIdentity.recoveryTransactionJournalSha256, journalSha256);
    assert.deepEqual(fs.readdirSync(f.target), []);

    delete approval.recoveryTransactionId;
    fs.writeFileSync(f.approval, JSON.stringify(approval));
    f.authorization.approvalSha256 = f.sha256(f.approval);
    assert.throws(() => check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy }), /approval/i);
    approval.recoveryTransactionId = 'c'.repeat(32);
    fs.writeFileSync(f.approval, JSON.stringify(approval));
    f.authorization.approvalSha256 = f.sha256(f.approval);
    assert.throws(() => check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy }), /approval/i);
    approval.recoveryTransactionId = transactionId;
    fs.writeFileSync(f.approval, JSON.stringify(approval));
    f.authorization.approvalSha256 = f.sha256(f.approval);
    f.authorization.recoveryTransactionJournalSha256 = 'not-a-sha';
    assert.throws(() => check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy }), /approval/i);
    f.authorization.recoveryTransactionJournalSha256 = journalSha256;
    delete f.authorization.recoveryTransactionId;
    assert.throws(() => check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy }), /approval/i);
    f.authorization.recoveryTransactionId = transactionId;
    delete f.authorization.recoveryTransactionJournalSha256;
    assert.throws(() => check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy }), /approval/i);
    f.authorization.recoveryTransactionJournalSha256 = journalSha256;
    f.authorization.recoveryAuthorized = false;
    assert.throws(() => check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy }), /approval/i);
    assert.deepEqual(fs.readdirSync(f.target), []);
});

test('ordinary frozen deployment rejects every recovery field on either approval or policy', () => {
    const f = frozenFixture();
    const original = JSON.parse(fs.readFileSync(f.approval, 'utf8'));
    const recoveryFields = [
        ['recoveryAuthorized', false],
        ['recoveryTransactionId', 'a'.repeat(32)],
        ['recoveryTransactionJournalSha256', 'b'.repeat(64)]
    ];
    for (const [field, value] of recoveryFields) {
        fs.writeFileSync(f.approval, JSON.stringify({ ...original, [field]: value }));
        f.authorization.approvalSha256 = f.sha256(f.approval);
        assert.throws(() => check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy }), /approval/i);
    }
    fs.writeFileSync(f.approval, JSON.stringify(original));
    f.authorization.approvalSha256 = f.sha256(f.approval);
    for (const [field, value] of recoveryFields) {
        f.authorization[field] = value;
        assert.throws(() => check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy }), /approval/i);
        delete f.authorization[field];
    }
    assert.deepEqual(fs.readdirSync(f.target), []);
});

test('frozen deployment denies archive tampering and approval for a different tree', () => {
    const f = frozenFixture();
    fs.appendFileSync(f.archive, 'tampered');
    assert.throws(() => check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy }), /rollback|approval|archive hash/i);
    fs.writeFileSync(f.archive, 'fixture frozen archive bytes');
    const approval = JSON.parse(fs.readFileSync(f.approval, 'utf8'));
    approval.sourceTree = '0'.repeat(40);
    fs.writeFileSync(f.approval, JSON.stringify(approval));
    f.authorization.approvalSha256 = f.sha256(f.approval);
    assert.throws(() => check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy }), /approval/i);
    assert.deepEqual(fs.readdirSync(f.target), []);
});

test('frozen deployment denies approval material writable by the current task token', () => {
    const f = frozenFixture();
    assert.equal(approvalProtectedFromCurrentProcess(f.approval), false);
    assert.throws(() => check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy,
        protectedApprovalProbe: () => false }), /approval.*writable|approval.*protected/i);
    assert.deepEqual(fs.readdirSync(f.target), []);
});

test('frozen deployment denies a missing staged file, unknown commit and dirty current checkout', () => {
    const f = frozenFixture();
    fs.rmSync(path.join(f.flags.artifactRoot, 'config.json'));
    assert.throws(() => check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy }), /inventory|artifact verification/i);
    fs.writeFileSync(path.join(f.flags.artifactRoot, 'config.json'), '{}');
    assert.throws(() => check(f, 'deploy', { flags: { ...f.flags, frozenSourceCommit: '0'.repeat(40) },
        operatorPolicy: f.operatorPolicy }), /commit|provenance/i);
    fs.writeFileSync(path.join(f.root, 'uncommitted.txt'), 'dirty');
    assert.throws(() => check(f, 'deploy', { flags: f.flags, operatorPolicy: f.operatorPolicy }), /clean/i);
    assert.deepEqual(fs.readdirSync(f.target), []);
});

test('artifact archive and staged-root options cannot silently fall back to current-HEAD deployment', () => {
    const f = fixture();
    assert.throws(() => check(f, 'deploy', { flags: {
        environmentId: 'JF_DEVELOPMENT_125', artifactArchive: path.join(f.base, 'candidate.zip')
    } }), /frozen|archive/i);
});

test('production role remains denied even if a task-writable registry entry is enabled', () => {
    const f = fixture();
    const target = path.join(f.base, 'mock-production');
    fs.mkdirSync(target);
    f.registry.environments[0].deployment = { enabled: true, targetPath: target };
    assert.throws(() => check(f, 'deploy', { flags: { environmentId: 'JF_PRODUCTION_50' } }), /production.*denied/i);
    assert.deepEqual(fs.readdirSync(target), []);
});

test('CI exact ref exception requires clean source and matching GitHub Actions identity', () => {
    const f = fixture();
    const ci = { actions: true, repository: 'Piglit09/PiggieTV-Jellyfin-web-app', workspace: f.root, sha: f.head };
    assert.throws(() => check(f, 'build', { flags: { ciRef: f.head }, ciContext: ci }), /CI.*runner platform/i);
    assert.equal(check(f, 'build', { flags: { ciRef: f.head }, ciContext: ci, runtimePlatform: 'linux' }).head, f.head);
    assert.throws(() => check(f, 'build', { flags: { ciRef: '0'.repeat(40) }, ciContext: ci, runtimePlatform: 'linux' }), /CI.*commit/i);
    assert.throws(() => check(f, 'build', { flags: { ciRef: f.head }, ciContext: { ...ci, repository: 'other/repo' }, runtimePlatform: 'linux' }), /CI.*repository/i);
    const other = path.join(f.base, 'ci-checkout');
    git(f.root, 'worktree', 'add', '--detach', other, f.head);
    assert.equal(check(f, 'build', { cwd: other, flags: { ciRef: f.head }, ciContext: { ...ci, workspace: other }, runtimePlatform: 'linux' }).head, f.head);
    assert.equal(check(f, 'package', { cwd: other, flags: { ciRef: f.head }, ciContext: { ...ci, workspace: other }, runtimePlatform: 'linux' }).head, f.head);
    assert.equal(check(f, 'build', { cwd: other, ciContext: { ...ci, workspace: other }, runtimePlatform: 'linux' }).head, f.head);
    assert.equal(check(f, 'package', { cwd: other, ciContext: { ...ci, workspace: other }, runtimePlatform: 'linux' }).head, f.head);
    assert.throws(() => check(f, 'build', { cwd: other, ciContext: { ...ci, workspace: other } }), /approved source root/i);
    assert.throws(() => check(f, 'deploy', { cwd: other, flags: { ciRef: f.head }, ciContext: { ...ci, workspace: other }, runtimePlatform: 'linux' }), /approved source root|CI.*only/i);
    const pullRequestCi = { ...ci, workspace: other, sha: '0'.repeat(40), eventName: 'pull_request', eventHeadSha: f.head };
    assert.equal(check(f, 'package', { cwd: other, flags: { ciRef: f.head }, ciContext: pullRequestCi, runtimePlatform: 'linux' }).head, f.head);
    assert.throws(() => check(f, 'package', { cwd: other, flags: { ciRef: f.head }, ciContext: { ...pullRequestCi, eventName: 'push' }, runtimePlatform: 'linux' }), /CI exact commit/i);
});

test('rejects an escaping symlink for mutating modes', () => {
    const f = fixture();
    const link = path.join(f.base, 'source-link');
    fs.symlinkSync(f.root, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => check(f, 'edit', { cwd: link }), /symlink|reparse|approved source root/i);
});

test('rejects operator Registry ACLs that grant task users write access', () => {
    const key = { ownerSid: 'S-1-5-32-544', aces: [
        { sid: 'S-1-5-18', type: 'Allow', rights: 0xF003F },
        { sid: 'S-1-5-32-545', type: 'Allow', rights: 0x20019 }
    ] };
    const safe = { currentTokenCanWrite: false, records: [ key, { ...key, aces: [...key.aces] } ] };
    assert.equal(operatorAclSafe(safe), true);
    assert.equal(operatorAclSafe({ ...safe, records: [{ ...key, ownerSid: 'S-1-5-21-1234' }, key] }), false);
    assert.equal(operatorAclSafe({ ...safe, records: [key, { ...key, aces: [...key.aces,
        { sid: 'S-1-5-32-545', type: 'Allow', rights: 0x4 }] }] }), false);
    assert.equal(operatorAclSafe({ ...safe, currentTokenCanWrite: true }), false);
    assert.equal(operatorAclSafe({ currentTokenCanWrite: false, records: [key] }), false);
    assert.equal(operatorAclSafe({ ...safe, records: [key, { ownerSid: 'S-1-5-32-544', aces: [] }] }), true);
    assert.equal(operatorAclSafe(null), false);
});

test('Web Registry policy accepts elevated reader but rejects nonprivileged mutation rights', () => {
    const { webOperatorAclSafe } = preflight;
    assert.equal(typeof webOperatorAclSafe, 'function');
    const record = { ownerSid: 'S-1-5-32-544', aces: [
        { sid: 'S-1-5-32-545', type: 'Allow', rights: 0x20019 },
        { sid: 'S-1-5-18', type: 'Allow', rights: 0xF003F }
    ] };
    const safe = { currentTokenCanWrite: true, records: [record, { ...record, aces: [...record.aces] }] };
    assert.equal(operatorAclSafe(safe), false);
    assert.equal(webOperatorAclSafe(safe), true);
    assert.equal(webOperatorAclSafe({ ...safe, currentTokenCanWrite: false }), true);
    assert.equal(webOperatorAclSafe({ ...safe, records: [{ ...record, ownerSid: 'S-1-5-21-1234' }, record] }), false);
    assert.equal(webOperatorAclSafe({ ...safe, records: [record, { ...record, aces: [
        ...record.aces, { sid: 'S-1-5-32-545', type: 'Allow', rights: 0x4 }
    ] }] }), false);
    assert.equal(webOperatorAclSafe({ ...safe, records: [record, { ...record, aces: [
        ...record.aces, { sid: 'S-1-3-0', type: 'Allow', rights: 0x4, propagation: 'None' }
    ] }] }), false);
    assert.equal(webOperatorAclSafe({ ...safe, records: [record, { ...record, aces: [
        ...record.aces, { sid: 'S-1-3-0', type: 'Allow', rights: 0x4, propagation: 'InheritOnly' }
    ] }] }), true);
    assert.equal(webOperatorAclSafe(null), false);
});

test('protected approval requires privileged ownership and every ancestor to deny replacement', () => {
    const protectedRecord = { ownerSid: 'S-1-5-32-544', aces: [
        { sid: 'S-1-5-32-544', type: 'Allow', rights: 0x1F01FF },
        { sid: 'S-1-5-32-545', type: 'Allow', rights: 0x1200A9 }
    ] };
    const safe = { elevated: false, records: Array.from({ length: 4 }, () => ({
        ...protectedRecord, aces: [...protectedRecord.aces]
    })) };
    assert.equal(approvalAclSafe(safe), true);
    assert.equal(approvalAclSafe({ ...safe, records: [
        { ...protectedRecord, ownerSid: 'S-1-5-21-1234' }, ...safe.records.slice(1)
    ] }), false);
    assert.equal(approvalAclSafe({ ...safe, records: [
        ...safe.records.slice(0, 3), { ...protectedRecord, aces: [
            ...protectedRecord.aces, { sid: 'S-1-5-32-545', type: 'Allow', rights: 0x10000 }
        ] }
    ] }), false);
    assert.equal(approvalAclSafe({ ...safe, records: safe.records.slice(0, 2) }), false);
    assert.equal(approvalAclSafe({ ...safe, elevated: true }), false);
});

test('Web approval accepts an elevated operator only when every protected path has safe ACLs', () => {
    const { webApprovalAclSafe } = preflight;
    assert.equal(typeof webApprovalAclSafe, 'function');
    const protectedRecord = { ownerSid: 'S-1-5-32-544', reparsePoint: false, aces: [
        { sid: 'S-1-5-18', type: 'Allow', rights: 0x1F01FF },
        { sid: 'S-1-5-32-545', type: 'Allow', rights: 0x1200A9 }
    ] };
    const parentRecord = { ownerSid: 'S-1-5-18', reparsePoint: false, aces: [
        { sid: 'S-1-5-32-545', type: 'Allow', rights: 0x1201BF }
    ] };
    const safe = { elevated: true, records: [
        ...Array.from({ length: 4 }, () => ({ ...protectedRecord, aces: [...protectedRecord.aces] })),
        parentRecord
    ] };
    assert.equal(webApprovalAclSafe(safe), true);
    assert.equal(webApprovalAclSafe({ ...safe, elevated: false }), true);
    assert.equal(webApprovalAclSafe({ ...safe, records: [
        { ...protectedRecord, aces: [{ sid: 'S-1-5-32-545', type: 'Allow', rights: -0x80000000 }] },
        ...safe.records.slice(1)
    ] }), true);
    for (const index of [0, 1, 2, 3]) {
        const records = [...safe.records];
        records[index] = { ...protectedRecord, ownerSid: 'S-1-5-21-1234' };
        assert.equal(webApprovalAclSafe({ ...safe, records }), false, `owner ${index}`);
        records[index] = { ...protectedRecord, reparsePoint: true };
        assert.equal(webApprovalAclSafe({ ...safe, records }), false, `reparse ${index}`);
        records[index] = { ...protectedRecord, aces: [...protectedRecord.aces,
            { sid: 'S-1-5-32-545', type: 'Allow', rights: 0x10000 }] };
        assert.equal(webApprovalAclSafe({ ...safe, records }), false, `write ACE ${index}`);
    }
    for (const rights of [0x40000000, 0x10000000]) {
        const records = [{ ...protectedRecord, aces: [
            { sid: 'S-1-5-32-545', type: 'Allow', rights }
        ] }, ...safe.records.slice(1)];
        assert.equal(webApprovalAclSafe({ ...safe, records }), false, `generic write ${rights}`);
    }
    assert.equal(webApprovalAclSafe({ ...safe, records: safe.records.slice(0, 4) }), false);
    assert.equal(webApprovalAclSafe({ ...safe, records: [
        ...safe.records.slice(0, -1), { ...parentRecord, ownerSid: 'S-1-5-21-1234' }
    ] }), false);
    assert.equal(webApprovalAclSafe({ ...safe, records: [
        ...safe.records.slice(0, -1), { ...parentRecord, reparsePoint: true }
    ] }), false);
    for (const rights of [0x40, 0x10000, 0x40000, 0x80000, 0x10000000, 0x40000000]) {
        assert.equal(webApprovalAclSafe({ ...safe, records: [
            ...safe.records.slice(0, -1), { ...parentRecord, aces: [
                ...parentRecord.aces, { sid: 'S-1-5-32-545', type: 'Allow', rights }
            ] }
        ] }), false, `parent replacement ${rights}`);
    }
    assert.equal(webApprovalAclSafe({ ...safe, elevated: 'true' }), false);
    assert.equal(webApprovalAclSafe({ ...safe, records: [
        { ...protectedRecord, aces: [{ sid: 'S-1-5-32-545', type: 'Unknown', rights: 0x1F01FF }] },
        ...safe.records.slice(1)
    ] }), false);
    assert.equal(webApprovalAclSafe(null), false);
});

test('Web approval ACL parser fails closed on malformed or incomplete PowerShell output', () => {
    const { parseWebApprovalAclEvidence } = preflight;
    assert.equal(typeof parseWebApprovalAclEvidence, 'function');
    const record = { ownerSid: 'S-1-5-18', reparsePoint: false,
        aces: [{ sid: 'S-1-5-32-545', type: 'Allow', rights: 0x1200A9 }] };
    const parent = { ...record, aces: [{ sid: 'S-1-5-32-545', type: 'Allow', rights: 0x1201BF }] };
    const safe = JSON.stringify({ elevated: true, records: [record, record, record, record, parent] });
    assert.equal(parseWebApprovalAclEvidence(safe), true);
    assert.equal(parseWebApprovalAclEvidence('{broken'), false);
    assert.equal(parseWebApprovalAclEvidence(JSON.stringify({ elevated: true,
        records: [record, record, record, record] })), false);
    assert.equal(parseWebApprovalAclEvidence(JSON.stringify({ elevated: true,
        records: [{ ...record, reparsePoint: null }, record, record, record, parent] })), false);
});

test('Web approval path must stay below the pinned protected root', () => {
    const { webApprovalPathPinned } = preflight;
    assert.equal(typeof webApprovalPathPinned, 'function');
    const root = 'C:\\ProgramData\\PiggieTV\\WorkspaceAuthority\\Approvals';
    assert.equal(webApprovalPathPinned(root + '\\ticket.json'), true);
    assert.equal(webApprovalPathPinned(root + '\\nested\\ticket.json'), true);
    assert.equal(webApprovalPathPinned(root), false);
    assert.equal(webApprovalPathPinned(root + '-other\\ticket.json'), false);
    assert.equal(webApprovalPathPinned(root + '\\..\\ticket.json'), false);
    assert.equal(webApprovalPathPinned('D:\\ProgramData\\PiggieTV\\WorkspaceAuthority\\Approvals\\ticket.json'), false);
    assert.equal(webApprovalPathPinned('ticket.json'), false);
});

test('workspace Git inspection ignores a task-controlled PATH', () => {
    const f = fixture();
    const prior = process.env.PATH;
    try {
        process.env.PATH = path.join(f.base, 'untrusted-tools');
        assert.equal(check(f, 'audit').head, f.head);
    } finally {
        process.env.PATH = prior;
    }
});

test('workspace Git inspection does not execute a checkout-controlled filesystem monitor', () => {
    const f = fixture();
    const marker = path.join(f.base, 'fsmonitor-ran.txt');
    const monitor = path.join(f.base, 'fsmonitor.cjs');
    fs.writeFileSync(monitor, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.exit(1);`);
    git(f.root, 'config', 'core.fsmonitor', `"${process.execPath}" "${monitor}"`);
    git(f.root, 'status', '--porcelain=v1');
    assert.equal(fs.existsSync(marker), true, 'fixture must prove Git would execute the monitor');
    fs.rmSync(marker);
    assert.equal(check(f, 'audit').head, f.head);
    assert.equal(fs.existsSync(marker), false);
});

test('workspace Git inspection does not execute a checkout-controlled clean filter', () => {
    const f = fixture();
    const tracked = path.join(f.root, 'ptv-version.json');
    const marker = path.join(f.base, 'clean-filter-ran.txt');
    const filter = path.join(f.base, 'clean-filter.cjs');
    fs.writeFileSync(path.join(f.root, '.gitattributes'), 'ptv-version.json filter=marker\n');
    git(f.root, 'add', '.gitattributes');
    git(f.root, 'commit', '-qm', 'fixture attributes');
    f.head = git(f.root, 'rev-parse', 'HEAD');
    fs.writeFileSync(filter, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.stdin.pipe(process.stdout);`);
    git(f.root, 'config', 'filter.marker.clean', `"${process.execPath}" "${filter}"`);
    fs.utimesSync(tracked, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    git(f.root, '-c', 'core.fsmonitor=false', 'status', '--porcelain=v1');
    assert.equal(fs.existsSync(marker), true, 'fixture must prove Git status would execute the filter');
    fs.rmSync(marker);
    const result = check(f, 'audit');
    assert.equal(result.head, f.head);
    assert.equal(result.dirty, false);
    assert.equal(fs.existsSync(marker), false);
    fs.writeFileSync(tracked, '{"version":"0.5.71"} \n');
    assert.equal(check(f, 'audit').dirty, true);
    assert.equal(fs.existsSync(marker), false);
});

test('workspace Git inspection marks staged-only changes dirty', () => {
    const f = fixture();
    const tracked = path.join(f.root, 'ptv-version.json');
    const original = fs.readFileSync(tracked);
    fs.writeFileSync(tracked, '{"version":"0.5.72"}\n');
    git(f.root, 'add', 'ptv-version.json');
    fs.writeFileSync(tracked, original);
    assert.equal(check(f, 'audit').dirty, true);
});

test('workspace Git inspection ignores inherited repository locator overrides', () => {
    const f = fixture();
    const prior = process.env.GIT_DIR;
    try {
        process.env.GIT_DIR = path.join(f.base, 'untrusted-git-dir');
        assert.equal(check(f, 'audit').head, f.head);
    } finally {
        if (prior === undefined) delete process.env.GIT_DIR;
        else process.env.GIT_DIR = prior;
    }
});
