#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const officialVersionSources = {
    web: 'ptv-version.json',
    plugin: 'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj'
};
const operatorRegistryKey = 'HKLM\\SOFTWARE\\PiggieTV\\WorkspaceAuthority';
const operatorRegistryValue = 'PolicyJson';
const pinnedAuthority = Object.freeze({
    sourceRoot: 'C:\\Users\\Piggie\\Documents\\GitHub\\Jellyfin-Web-PiggieTV',
    gitCommonDirectory: 'C:\\Users\\Piggie\\Documents\\GitHub\\Jellyfin-Web-PiggieTV\\.git',
    expectedRemote: 'https://github.com/Piglit09/PiggieTV-Jellyfin-web-app.git',
    artifactRoot: 'C:\\Users\\Piggie\\Documents\\GitHub\\_PTV-Artifacts',
    environmentRegistry: 'docs/operations/ptv-environments.json',
    ciRepository: 'Piglit09/PiggieTV-Jellyfin-web-app'
});
const allowedModes = new Set(['audit', 'edit', 'build', 'package', 'deploy']);
const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gitExecutable = process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : '/usr/bin/git';
const powershellExecutable = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const regExecutable = 'C:\\Windows\\System32\\reg.exe';

export class PreflightError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PreflightError';
    }
}

function deny(message) {
    throw new PreflightError(message);
}

function samePath(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
    const normalize = value => {
        const normalized = path.normalize(value).replace(/[\\/]$/, '');
        return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    };
    return normalize(a) === normalize(b);
}

function sameRemote(actual, expected) {
    try {
        const first = new URL(actual);
        const second = new URL(expected);
        const repoPath = url => url.pathname.replace(/\.git$/i, '').replace(/\/$/, '').toLowerCase();
        return first.protocol === 'https:' && second.protocol === 'https:'
            && !first.username && !first.password && !second.username && !second.password
            && !first.search && !first.hash && !second.search && !second.hash
            && first.host.toLowerCase() === second.host.toLowerCase() && repoPath(first) === repoPath(second);
    } catch {
        return false;
    }
}

function policyMatchesAuthority(policy, authority) {
    return policy?.schemaVersion === 1 && policy.projectId === 'PTV_WEB'
        && samePath(policy.sourceRoot, authority.sourceRoot)
        && samePath(policy.gitCommonDirectory, authority.gitCommonDirectory)
        && sameRemote(policy.expectedRemote, authority.expectedRemote)
        && samePath(policy.artifactRoot, authority.artifactRoot)
        && policy.environmentRegistry === authority.environmentRegistry
        && policy.ci?.repository === authority.ciRepository
        && policy.operatorPolicy?.kind === 'windows-registry'
        && policy.operatorPolicy.key === operatorRegistryKey
        && policy.operatorPolicy.value === operatorRegistryValue;
}

function validatePolicy(policy, authority) {
    if (policy?.schemaVersion !== 1 || policy.projectId !== 'PTV_WEB') deny('Unknown or invalid project workspace policy');
    if (!samePath(policy.sourceRoot, authority.sourceRoot)) deny('Pinned source root does not match workspace policy');
    if (!samePath(policy.gitCommonDirectory, authority.gitCommonDirectory)) deny('Pinned Git common directory does not match workspace policy');
    if (!sameRemote(policy.expectedRemote, authority.expectedRemote)) deny('Pinned Git remote does not match workspace policy');
    if (!samePath(policy.artifactRoot, authority.artifactRoot)) deny('Pinned artifact root does not match workspace policy');
    if (policy.environmentRegistry !== authority.environmentRegistry) deny('Pinned environment registry does not match workspace policy');
    if (policy.ci?.repository !== authority.ciRepository) deny('Pinned CI repository does not match workspace policy');
    if (policy.operatorPolicy?.kind !== 'windows-registry' || policy.operatorPolicy.key !== operatorRegistryKey
        || policy.operatorPolicy.value !== operatorRegistryValue) deny('Pinned operator policy does not match workspace policy');
}

function insidePath(candidate, parent) {
    if (typeof parent !== 'string' || !parent) return false;
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function existingRealPath(value, label) {
    if (typeof value !== 'string' || !value.trim()) deny(`${label} is missing`);
    try {
        return fs.realpathSync.native(path.resolve(value));
    } catch {
        deny(`${label} does not exist`);
    }
}

function git(cwd, ...args) {
    try {
        return execFileSync(gitExecutable, ['-C', cwd, ...args], {
            encoding: 'utf8',
            env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
    } catch {
        deny(`Git identity check failed: ${args.join(' ')}`);
    }
}

function inspectGit(cwd) {
    const root = existingRealPath(git(cwd, 'rev-parse', '--show-toplevel'), 'Git root');
    const rawCommonDir = git(root, 'rev-parse', '--git-common-dir');
    const commonDir = existingRealPath(path.resolve(root, rawCommonDir), 'Git common directory');
    const remote = git(root, 'config', '--get', 'remote.origin.url');
    const head = git(root, 'rev-parse', 'HEAD');
    let branch = 'DETACHED';
    try {
        branch = execFileSync(gitExecutable, ['-C', root, 'symbolic-ref', '--quiet', '--short', 'HEAD'], {
            encoding: 'utf8',
            env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim() || 'DETACHED';
    } catch {
        // Detached HEAD is expected for exact-ref CI and historical inspection.
    }
    const dirty = git(root, 'status', '--porcelain=v1', '--untracked-files=all').length > 0;
    return { root, commonDir, remote, head, branch, dirty };
}

function sourceVersions(root, policy) {
    for (const [component, officialPath] of Object.entries(officialVersionSources)) {
        if (policy.versionSources?.[component]?.replaceAll('\\', '/') !== officialPath) {
            deny(`Invalid ${component} version source`);
        }
    }
    const webFile = path.join(root, officialVersionSources.web);
    const pluginFile = path.join(root, officialVersionSources.plugin);
    if (!fs.existsSync(webFile) || !fs.existsSync(pluginFile)) deny('Official version source is missing');
    const web = JSON.parse(fs.readFileSync(webFile, 'utf8')).version;
    const pluginText = fs.readFileSync(pluginFile, 'utf8');
    const plugin = pluginText.match(/<PtvPluginVersion>([^<]+)<\/PtvPluginVersion>/)?.[1];
    if (!/^\d+\.\d+\.\d+$/.test(web ?? '') || !/^\d+\.\d+\.\d+\.\d+$/.test(plugin ?? '')) {
        deny('Official source version is invalid');
    }
    return { web, plugin };
}

function validFullSha(value) {
    return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function validateCi(ciRef, ciContext, identity, policy, runtimePlatform) {
    if (runtimePlatform !== 'linux') deny('CI runner platform is not approved for exact-ref exception');
    const eventCommit = ciContext?.eventName === 'pull_request' ? ciContext?.eventHeadSha : null;
    if (!validFullSha(ciRef) || ciRef !== identity.head || (ciContext?.sha !== identity.head && eventCommit !== identity.head)) {
        deny('CI exact commit mismatch');
    }
    if (ciContext?.actions !== true || ciContext?.repository !== policy.ci?.repository) deny('CI repository identity mismatch');
    if (!samePath(existingRealPath(ciContext.workspace, 'CI workspace'), identity.root)) deny('CI workspace mismatch');
    if (identity.dirty) deny('CI exact-ref build requires clean source');
}

function hashFile(file) {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file, label) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        deny(`${label} is missing or invalid`);
    }
}

function registeredEnvironment(flags, registry) {
    if (typeof flags.environmentId !== 'string' || !flags.environmentId) deny('Deployment environment ID is required');
    const environment = registry.environments?.find(item => item.id === flags.environmentId);
    if (!environment) deny('Unregistered deployment environment');
    if (environment.deployment?.enabled !== true || !environment.deployment?.targetPath) deny('Deployment is denied for this environment');
    return environment;
}

function verifiedManifest(flags, identity, versions) {
    if (!flags.artifactManifest) deny('Exact artifact manifest is required');
    const manifest = readJson(flags.artifactManifest, 'Artifact manifest');
    if (manifest.sourceCommit !== identity.head || !/^[0-9a-f]{64}$/.test(manifest.manifestDigest ?? '') || manifest.sourceDirty !== false) {
        deny('Artifact manifest provenance does not match clean source');
    }
    if (!manifest.sourceRoot || !samePath(manifest.sourceRoot, identity.root)) deny('Artifact source root mismatch');
    if (manifest.sourceVersions?.web !== versions.web || manifest.sourceVersions?.plugin !== versions.plugin) {
        deny('Artifact manifest source version mismatch');
    }
    return manifest;
}

function verifiedAuthorization({ flags, identity, policy, environment, operatorPolicy }) {
    if (!flags.approvalRecord) deny('Operator approval record is required');
    if (!flags.rollbackReference) deny('Verified rollback reference is required');
    if (!operatorPolicy || operatorPolicy.schemaVersion !== 1 || operatorPolicy.projectId !== 'PTV_WEB') {
        deny('Operator-controlled deployment policy is absent');
    }
    if (!samePath(operatorPolicy.sourceRoot, identity.root) || !samePath(operatorPolicy.gitCommonDirectory, identity.commonDir)
        || !sameRemote(operatorPolicy.expectedRemote, identity.remote)) {
        deny('Operator policy source identity mismatch');
    }
    const authorization = operatorPolicy.deployments?.find(item => item.environmentId === environment.id);
    if (!authorization || authorization.enabled !== true) deny('Operator policy does not authorize environment');
    if (!samePath(authorization.targetPath, environment.deployment.targetPath)) deny('Deployment target path mismatch');
    const targetPath = existingRealPath(authorization.targetPath, 'Deployment target');
    if (!samePath(targetPath, authorization.targetPath)) deny('Deployment target is a symlink or reparse path');
    const approvalPath = existingRealPath(flags.approvalRecord, 'Operator approval record');
    if (insidePath(approvalPath, identity.root) || insidePath(approvalPath, policy.artifactRoot)) {
        deny('Operator approval record cannot be stored in a task-writable source or artifact directory');
    }
    if (!samePath(authorization.approvalRecordPath, approvalPath) || hashFile(approvalPath) !== authorization.approvalSha256) {
        deny('Operator approval record identity or hash mismatch');
    }
    const rollbackPath = existingRealPath(flags.rollbackReference, 'Rollback evidence');
    if (!samePath(authorization.rollbackReference, rollbackPath) || hashFile(rollbackPath) !== authorization.rollbackSha256) {
        deny('Rollback evidence identity or hash mismatch');
    }
    return { authorization, targetPath, approvalPath, rollbackPath };
}

function validateRollback({ rollbackPath, environment, targetPath, identity, manifest, versions }) {
    const rollback = readJson(rollbackPath, 'Rollback evidence');
    const backupPath = rollback.backupPath && path.isAbsolute(rollback.backupPath) ?
        existingRealPath(rollback.backupPath, 'Rollback backup') : null;
    const backupDate = Date.parse(rollback.createdAt);
    const matchingIdentity = [
        rollback.schemaVersion === 1,
        rollback.environmentId === environment.id,
        samePath(rollback.targetPath, targetPath),
        rollback.candidateSourceCommit === identity.head,
        rollback.artifactManifestDigest === manifest.manifestDigest
    ];
    const validBackup = backupPath && /^[0-9a-f]{64}$/.test(rollback.backupSha256 ?? '')
        && !insidePath(backupPath, identity.root) && !insidePath(backupPath, targetPath)
        && fs.statSync(backupPath).isFile();
    const validDate = Number.isFinite(backupDate) && backupDate <= Date.now() + 300_000;
    if (!matchingIdentity.every(Boolean) || !validBackup || !validDate) deny('Rollback evidence is incomplete or mismatched');
    if (rollback.candidateVersions?.web !== versions.web || rollback.candidateVersions?.plugin !== versions.plugin) {
        deny('Rollback candidate version mismatch');
    }
    if (hashFile(backupPath) !== rollback.backupSha256) deny('Rollback backup hash mismatch');
}

function validateApproval({ approvalPath, environment, identity, manifest, authorization, rollbackPath }) {
    const approval = readJson(approvalPath, 'Operator approval record');
    const expiration = Date.parse(approval.expiresAt);
    const valid = [
        typeof approval.taskId === 'string' && Boolean(approval.taskId.trim()),
        approval.environmentId === environment.id,
        approval.sourceCommit === identity.head,
        approval.artifactManifestDigest === manifest.manifestDigest,
        samePath(approval.targetPath, authorization.targetPath),
        samePath(approval.rollbackReference, rollbackPath),
        Number.isFinite(expiration) && expiration > Date.now()
    ];
    if (!valid.every(Boolean)) deny('Invalid or expired operator approval record');
}

function validateDeployment({ flags, identity, policy, registry, operatorPolicy, versions }) {
    const environment = registeredEnvironment(flags, registry);
    const manifest = verifiedManifest(flags, identity, versions);
    const evidence = verifiedAuthorization({ flags, identity, policy, environment, operatorPolicy });
    validateRollback({ rollbackPath: evidence.rollbackPath, environment, targetPath: evidence.targetPath, identity, manifest, versions });
    validateApproval({ approvalPath: evidence.approvalPath, environment, identity, manifest,
        authorization: evidence.authorization, rollbackPath: evidence.rollbackPath });
    return { environmentId: environment.id, targetPath: evidence.targetPath, artifactManifestDigest: manifest.manifestDigest };
}

function auditResult(base, identity, policy, authority) {
    const approved = policyMatchesAuthority(policy, authority)
        && samePath(identity.root, authority.sourceRoot) && samePath(identity.commonDir, authority.gitCommonDirectory)
        && sameRemote(identity.remote, authority.expectedRemote);
    return { ...base, authority: approved ? 'approved' : 'historical-read-only' };
}

function ciReference(mode, flags, identity, ciContext, runtimePlatform) {
    const eligible = mode === 'build' || mode === 'package';
    if (flags.ciRef && !eligible) deny('CI exact-ref exception is build/package-only');
    if (flags.ciRef) return flags.ciRef;
    return eligible && runtimePlatform === 'linux' && ciContext?.actions === true ? identity.head : null;
}

function validateSourceLocation(identity, policy, ciRef) {
    if (ciRef) return;
    if (!samePath(existingRealPath(policy.sourceRoot, 'Approved source root'), policy.sourceRoot)) {
        deny('Approved source root is a symlink');
    }
    if (!samePath(identity.root, policy.sourceRoot)) deny('Working directory is not inside the approved source root');
    if (!samePath(identity.commonDir, policy.gitCommonDirectory)) deny('Unexpected Git common directory');
}

function validateSourceProvenance({ identity, policy, ciRef, ciContext, runtimePlatform, env }) {
    if (!sameRemote(identity.remote, policy.expectedRemote)) deny('Unexpected Git remote');
    if (!validFullSha(identity.head)) deny('Git HEAD is not a full commit');
    if (ciRef) validateCi(ciRef, ciContext, identity, policy, runtimePlatform);
    if (env.PTV_COMMIT_SHA && (env.PTV_COMMIT_SHA !== identity.head || !validFullSha(env.PTV_COMMIT_SHA))) {
        deny('Forged or stale PTV_COMMIT_SHA does not match Git commit');
    }
}

export function evaluatePreflight({
    mode,
    cwd,
    policy,
    authority = pinnedAuthority,
    registry,
    flags = {},
    env = process.env,
    ciContext,
    operatorPolicy,
    runtimePlatform = process.platform
}) {
    if (!allowedModes.has(mode)) deny('Unknown preflight mode');
    const requestedPath = path.resolve(cwd);
    const physicalCwd = existingRealPath(requestedPath, 'Working directory');
    if (mode !== 'audit' && !samePath(requestedPath, physicalCwd)) deny('Symlink or reparse-point working directory is not authorized');
    const identity = inspectGit(physicalCwd);
    const base = {
        mode,
        sourceRoot: identity.root,
        gitCommonDirectory: identity.commonDir,
        remote: identity.remote,
        branch: identity.branch,
        head: identity.head,
        dirty: identity.dirty
    };
    if (mode === 'audit') return auditResult(base, identity, policy, authority);
    validatePolicy(policy, authority);
    const ciRef = ciReference(mode, flags, identity, ciContext, runtimePlatform);
    validateSourceLocation(identity, policy, ciRef);
    validateSourceProvenance({ identity, policy, ciRef, ciContext, runtimePlatform, env });
    const versions = sourceVersions(identity.root, policy);
    if ((mode === 'package' || mode === 'deploy') && identity.dirty) deny('Release package or deployment requires clean committed source');
    if (mode === 'deploy') {
        if (registry?.schemaVersion !== 1 || registry.projectId !== 'PTV_WEB') deny('Environment registry is invalid');
        const deployment = validateDeployment({ flags, identity, policy, registry, operatorPolicy, versions });
        return { ...base, versions, authority: 'approved', ...deployment };
    }
    return { ...base, versions, authority: 'approved' };
}

function parseArgs(argv) {
    const [mode, ...rest] = argv;
    const names = {
        '--project': 'projectId',
        '--source-root': 'sourceRoot',
        '--environment-id': 'environmentId',
        '--artifact-manifest': 'artifactManifest',
        '--approval-record': 'approvalRecord',
        '--rollback-reference': 'rollbackReference',
        '--ci-ref': 'ciRef'
    };
    const flags = {};
    for (let index = 0; index < rest.length; index += 2) {
        const key = names[rest[index]];
        if (!key || !rest[index + 1] || rest[index + 1].startsWith('--')) deny(`Unknown or incomplete option: ${rest[index]}`);
        flags[key] = rest[index + 1];
    }
    if (flags.sourceRoot && mode !== 'audit') deny('Source-root override is audit-only');
    if (flags.projectId && flags.projectId !== 'PTV_WEB') deny('Unknown project ID');
    return { mode, flags };
}

function readOperatorPolicy(policy) {
    if (process.platform !== 'win32' || policy.operatorPolicy?.kind !== 'windows-registry'
        || policy.operatorPolicy.key !== operatorRegistryKey || policy.operatorPolicy.value !== operatorRegistryValue) return null;
    try {
        const aclScript = [
            "$ErrorActionPreference='Stop'",
            "$acl=Get-Acl -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\PiggieTV\\WorkspaceAuthority'",
            '$owner=(New-Object System.Security.Principal.NTAccount($acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value',
            '$aces=@($acl.Access | ForEach-Object { @{ sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; type=$_.AccessControlType.ToString(); rights=[int64]$_.RegistryRights } })',
            '@{ ownerSid=$owner; aces=$aces } | ConvertTo-Json -Compress -Depth 4'
        ].join(';');
        const aclOutput = execFileSync(powershellExecutable, ['-NoProfile', '-NonInteractive', '-Command', aclScript], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
        if (!operatorAclSafe(JSON.parse(aclOutput))) return null;
        const output = execFileSync(regExecutable, ['query', operatorRegistryKey, '/v', operatorRegistryValue], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const line = output.split(/\r?\n/).find(value => value.includes(operatorRegistryValue) && value.includes('REG_SZ'));
        const marker = 'REG_SZ';
        const markerIndex = line?.indexOf(marker);
        const json = markerIndex >= 0 ? line.slice(markerIndex + marker.length).trim() : null;
        return json ? JSON.parse(json) : null;
    } catch {
        return null;
    }
}

export function operatorAclSafe(acl) {
    const privilegedSids = new Set(['S-1-5-18', 'S-1-5-32-544']);
    if (!acl || !privilegedSids.has(acl.ownerSid) || !Array.isArray(acl.aces)) return false;
    const writeMask = 0x2 | 0x4 | 0x10000 | 0x40000 | 0x80000;
    return acl.aces.every(ace => {
        if (ace.type !== 'Allow') return true;
        if (typeof ace.rights !== 'number' || typeof ace.sid !== 'string') return false;
        return (ace.rights & writeMask) === 0 || privilegedSids.has(ace.sid);
    });
}

function readCiEventHeadSha() {
    if (process.env.GITHUB_EVENT_NAME !== 'pull_request' || !process.env.GITHUB_EVENT_PATH) return null;
    try {
        return JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request?.head?.sha ?? null;
    } catch {
        return null;
    }
}

function main() {
    try {
        const { mode, flags } = parseArgs(process.argv.slice(2));
        const policy = readJson(path.join(scriptRoot, 'config', 'ptv-workspace-policy.json'), 'Workspace policy');
        const registry = readJson(path.join(scriptRoot, policy.environmentRegistry), 'Environment registry');
        const result = evaluatePreflight({
            mode,
            cwd: flags.sourceRoot ?? process.cwd(),
            policy,
            registry,
            flags,
            ciContext: {
                actions: process.env.GITHUB_ACTIONS === 'true',
                repository: process.env.GITHUB_REPOSITORY,
                workspace: process.env.GITHUB_WORKSPACE,
                sha: process.env.GITHUB_SHA,
                eventName: process.env.GITHUB_EVENT_NAME,
                eventHeadSha: readCiEventHeadSha()
            },
            operatorPolicy: mode === 'deploy' ? readOperatorPolicy(policy) : null
        });
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
        process.stderr.write(`PTV workspace preflight denied: ${error.message}\n`);
        process.exitCode = 1;
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
