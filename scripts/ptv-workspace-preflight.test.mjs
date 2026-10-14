import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import { evaluatePreflight, operatorAclSafe } from './ptv-workspace-preflight.mjs';

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
    return evaluatePreflight({ mode, cwd: f.root, policy: f.policy, authority: f.authority, registry: f.registry, ...extra });
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
    const safe = { ownerSid: 'S-1-5-32-544', aces: [
        { sid: 'S-1-5-18', type: 'Allow', rights: 0xF003F },
        { sid: 'S-1-5-32-545', type: 'Allow', rights: 0x20019 }
    ] };
    assert.equal(operatorAclSafe(safe), true);
    assert.equal(operatorAclSafe({ ...safe, ownerSid: 'S-1-5-21-1234' }), false);
    assert.equal(operatorAclSafe({ ...safe, aces: [...safe.aces, { sid: 'S-1-5-32-545', type: 'Allow', rights: 0x2 }] }), false);
    assert.equal(operatorAclSafe({ ownerSid: 'S-1-5-32-544', aces: [] }), true);
    assert.equal(operatorAclSafe(null), false);
});
