#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { canonicalDigest, verifyManifest } from './ptv-artifact-manifest.mjs';

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

export function approvalProtectedFromCurrentProcess(approvalPath) {
    if (process.platform !== 'win32') return false;
    const protectedRoot = 'C:\\ProgramData\\PiggieTV\\WorkspaceAuthority\\Approvals';
    if (!insidePath(approvalPath, protectedRoot) || samePath(approvalPath, protectedRoot)) return false;
    let handle;
    try {
        handle = fs.openSync(approvalPath, 'r+');
        return false;
    } catch (error) {
        if (error?.code !== 'EACCES' && error?.code !== 'EPERM') return false;
    } finally {
        if (handle !== undefined) fs.closeSync(handle);
    }
    try {
        const script = [
            "$ErrorActionPreference='Stop'",
            '$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent()',
            '$principal=[System.Security.Principal.WindowsPrincipal]::new($identity)',
            '$elevated=$identity.IsSystem -or $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)',
            "$protectedRoot='C:\\ProgramData\\PiggieTV\\WorkspaceAuthority\\Approvals'",
            "$protectedAncestor='C:\\ProgramData\\PiggieTV'",
            '$approval=[System.IO.Path]::GetFullPath($env:PTV_APPROVAL_PATH)',
            '$prefix=[System.IO.Path]::GetFullPath($protectedRoot).TrimEnd("\\")+"\\"',
            'if(-not $approval.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw "Approval root mismatch"}',
            '$paths=@($approval)',
            '$parent=[System.IO.Path]::GetDirectoryName($approval)',
            'while($true){ $paths+= $parent; if($parent -ieq $protectedAncestor){break};',
            '  $parent=[System.IO.Path]::GetDirectoryName($parent);',
            '  if(-not $parent -or -not $parent.StartsWith($protectedAncestor,[StringComparison]::OrdinalIgnoreCase)){throw "Approval ancestor mismatch"} }',
            '$records=@(foreach($p in $paths) {',
            '  $acl=Get-Acl -LiteralPath $p',
            '  @{ ownerSid=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;',
            '     aces=@($acl.Access | ForEach-Object { @{ sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;',
            '       type=$_.AccessControlType.ToString(); rights=[int64]$_.FileSystemRights } }) }',
            '})',
            '@{ elevated=[bool]$elevated; records=$records } | ConvertTo-Json -Compress -Depth 5'
        ].join('\n');
        const output = execFileSync(powershellExecutable, ['-NoProfile', '-NonInteractive', '-Command', script], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, PTV_APPROVAL_PATH: approvalPath }
        });
        const evidence = JSON.parse(output);
        return approvalAclSafe(evidence);
    } catch {
        return false;
    }
}

export function approvalAclSafe(evidence) {
    const privileged = new Set(['S-1-5-18', 'S-1-5-32-544']);
    const writeMask = 0x2 | 0x4 | 0x10 | 0x40 | 0x100 | 0x10000 | 0x40000 | 0x80000;
    return evidence?.elevated === false && Array.isArray(evidence.records) && evidence.records.length >= 4
        && evidence.records.every(record => privileged.has(record.ownerSid) && Array.isArray(record.aces)
            && record.aces.every(ace => ace.type !== 'Allow'
                || (typeof ace.rights === 'number' && typeof ace.sid === 'string'
                    && ((ace.rights & writeMask) === 0 || privileged.has(ace.sid)))));
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
    if (environment.role === 'PRODUCTION' || environment.id === 'JF_PRODUCTION_50') deny('Production deployment is denied');
    if (environment.deployment?.enabled !== true || !environment.deployment?.targetPath) deny('Deployment is denied for this environment');
    return environment;
}

function verifiedManifest(flags, identity, versions) {
    if (!flags.artifactManifest) deny('Exact artifact manifest is required');
    const manifest = readJson(flags.artifactManifest, 'Artifact manifest');
    const frozen = flags.frozenSourceCommit !== undefined;
    const sourceCommit = frozen ? flags.frozenSourceCommit : identity.head;
    if (!validFullSha(sourceCommit) || manifest.sourceCommit !== sourceCommit
        || !/^[0-9a-f]{64}$/.test(manifest.manifestDigest ?? '') || manifest.sourceDirty !== false) {
        deny('Artifact manifest provenance does not match clean source');
    }
    if (!manifest.sourceRoot || !samePath(manifest.sourceRoot, identity.root)) deny('Artifact source root mismatch');
    if (!frozen && (manifest.sourceVersions?.web !== versions.web || manifest.sourceVersions?.plugin !== versions.plugin)) {
        deny('Artifact manifest source version mismatch');
    }
    if (!frozen) return { manifest, sourceCommit, sourceTree: git(identity.root, 'rev-parse', 'HEAD^{tree}'), archiveSha256: null };
    if (git(identity.root, 'cat-file', '-t', sourceCommit) !== 'commit') deny('Frozen source is not a Git commit');
    const sourceTree = git(identity.root, 'rev-parse', `${sourceCommit}^{tree}`);
    if (!validFullSha(sourceTree)) deny('Frozen source tree identity is invalid');
    if (!flags.artifactRoot || !flags.artifactArchive) deny('Frozen artifact requires staged files and exact archive');
    if (manifest.manifestDigest !== canonicalDigest(manifest)) deny('Artifact manifest digest mismatch');
    try {
        verifyManifest(manifest, { artifactRoot: flags.artifactRoot, sourceRoot: identity.root, frozenSourceCommit: sourceCommit });
    } catch (error) {
        deny(`Frozen artifact verification failed: ${error.message}`);
    }
    const archive = existingRealPath(flags.artifactArchive, 'Frozen artifact archive');
    if (!samePath(path.resolve(flags.artifactArchive), archive) || !fs.lstatSync(archive).isFile()) {
        deny('Frozen artifact archive must be a regular file at its approved path');
    }
    return { manifest, sourceCommit, sourceTree, archiveSha256: hashFile(archive) };
}

function verifiedAuthorization({ flags, identity, policy, environment, operatorPolicy, protectedApprovalProbe }) {
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
    if (!protectedApprovalProbe(approvalPath)) deny('Operator approval is writable by the current task token or lacks protected ACLs');
    const rollbackPath = existingRealPath(flags.rollbackReference, 'Rollback evidence');
    if (!samePath(authorization.rollbackReference, rollbackPath) || hashFile(rollbackPath) !== authorization.rollbackSha256) {
        deny('Rollback evidence identity or hash mismatch');
    }
    return { authorization, targetPath, approvalPath, rollbackPath };
}

function validateRollback({ rollbackPath, environment, targetPath, identity, verified, versions }) {
    const rollback = readJson(rollbackPath, 'Rollback evidence');
    const { manifest, sourceCommit, sourceTree, archiveSha256 } = verified;
    const backupPath = rollback.backupPath && path.isAbsolute(rollback.backupPath) ?
        existingRealPath(rollback.backupPath, 'Rollback backup') : null;
    const backupDate = Date.parse(rollback.createdAt);
    const matchingIdentity = [
        rollback.schemaVersion === 1,
        rollback.environmentId === environment.id,
        samePath(rollback.targetPath, targetPath),
        rollback.candidateSourceCommit === sourceCommit,
        rollback.artifactManifestDigest === manifest.manifestDigest
    ];
    if (archiveSha256) {
        matchingIdentity.push(rollback.candidateSourceTree === sourceTree,
            rollback.candidateArchiveSha256 === archiveSha256);
    }
    const validBackup = backupPath && /^[0-9a-f]{64}$/.test(rollback.backupSha256 ?? '')
        && !insidePath(backupPath, identity.root) && !insidePath(backupPath, targetPath)
        && fs.statSync(backupPath).isFile();
    const validDate = Number.isFinite(backupDate) && backupDate <= Date.now() + 300_000;
    if (!matchingIdentity.every(Boolean) || !validBackup || !validDate) deny('Rollback evidence is incomplete or mismatched');
    const expectedVersions = archiveSha256 ? manifest.sourceVersions : versions;
    if (rollback.candidateVersions?.web !== expectedVersions.web || rollback.candidateVersions?.plugin !== expectedVersions.plugin) {
        deny('Rollback candidate version mismatch');
    }
    if (hashFile(backupPath) !== rollback.backupSha256) deny('Rollback backup hash mismatch');
    return rollback;
}

function utcTimestamp(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) ?
        Date.parse(value) : Number.NaN;
}

function validMaintenanceUserIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return false;
    const valid = ids.every(id => typeof id === 'string' && /^[A-Za-z0-9._-]{2,128}$/.test(id));
    return valid && new Set(ids.map(id => id.toLowerCase())).size === ids.length;
}

function validRecoveryApproval(approval, authorization) {
    const fields = ['recoveryAuthorized', 'recoveryTransactionId', 'recoveryTransactionJournalSha256'];
    if (approval.recoveryAuthorized !== true) {
        return fields.every(field => !Object.hasOwn(approval, field) && !Object.hasOwn(authorization, field));
    }
    return authorization.recoveryAuthorized === true
        && /^[0-9a-f]{32}$/.test(approval.recoveryTransactionId ?? '')
        && authorization.recoveryTransactionId === approval.recoveryTransactionId
        && /^[0-9a-f]{64}$/.test(authorization.recoveryTransactionJournalSha256 ?? '')
        && (!Object.hasOwn(approval, 'recoveryTransactionJournalSha256')
            || approval.recoveryTransactionJournalSha256 === authorization.recoveryTransactionJournalSha256);
}

function validFrozenMaintenanceApproval(approval, authorization, now) {
    const start = utcTimestamp(approval.maintenanceWindowStartUtc);
    const end = utcTimestamp(approval.maintenanceWindowEndUtc);
    const betaRouteVerified = utcTimestamp(approval.betaRouteVerifiedAtUtc);
    const expiration = utcTimestamp(approval.expiresAt);
    const fields = ['taskId', 'serverId', 'maintenanceWindowStartUtc', 'maintenanceWindowEndUtc',
        'userImpactAttested', 'betaIsolationAttested', 'betaRouteVerifiedAtUtc',
        'betaRouteBoundToExpectedServer', 'noUnapprovedAudience', 'expiresAt'];
    return approval.schemaVersion === 1 && approval.operatorApproved === true
        && approval.operation === 'web-only-frozen-artifact-deployment'
        && authorization.operation === approval.operation
        && /^[A-Za-z0-9][A-Za-z0-9._-]{3,127}$/.test(approval.taskId ?? '')
        && /^[0-9a-f]{32}$/.test(approval.serverId ?? '')
        && fields.every(field => authorization[field] === approval[field])
        && approval.userImpactAttested === true && approval.betaIsolationAttested === true
        && approval.betaRouteBoundToExpectedServer === true && approval.noUnapprovedAudience === true
        && Number.isFinite(start) && Number.isFinite(end) && start <= now && end > now
        && end - start <= 2 * 60 * 60 * 1000
        && Number.isFinite(betaRouteVerified) && betaRouteVerified <= now && now - betaRouteVerified <= 5 * 60 * 1000
        && Number.isFinite(expiration) && expiration > now && expiration - now <= 24 * 60 * 60 * 1000
        && validMaintenanceUserIds(approval.maintenanceUserIds)
        && validMaintenanceUserIds(authorization.maintenanceUserIds)
        && approval.maintenanceUserIds.length === authorization.maintenanceUserIds.length
        && approval.maintenanceUserIds.every((id, index) => id === authorization.maintenanceUserIds[index])
        && validRecoveryApproval(approval, authorization);
}

function validateApproval({ approvalPath, environment, verified, authorization, rollbackPath, rollback }) {
    const approval = readJson(approvalPath, 'Operator approval record');
    const { manifest, sourceCommit, sourceTree, archiveSha256 } = verified;
    const expiration = Date.parse(approval.expiresAt);
    const now = Date.now();
    const valid = [
        typeof approval.taskId === 'string' && Boolean(approval.taskId.trim()),
        approval.environmentId === environment.id,
        approval.sourceCommit === sourceCommit,
        approval.artifactManifestDigest === manifest.manifestDigest,
        samePath(approval.targetPath, authorization.targetPath),
        samePath(approval.rollbackReference, rollbackPath),
        Number.isFinite(expiration) && expiration > now
    ];
    if (archiveSha256) {
        valid.push(
            approval.sourceTree === sourceTree,
            approval.artifactArchiveSha256 === archiveSha256,
            approval.rollbackBackupSha256 === rollback.backupSha256,
            authorization.sourceCommit === sourceCommit,
            authorization.sourceTree === sourceTree,
            authorization.artifactManifestDigest === manifest.manifestDigest,
            authorization.artifactArchiveSha256 === archiveSha256,
            authorization.rollbackBackupSha256 === rollback.backupSha256,
            validFrozenMaintenanceApproval(approval, authorization, now)
        );
    }
    if (!valid.every(Boolean)) deny('Invalid or expired operator approval record');
    return archiveSha256 ? {
        taskId: approval.taskId,
        serverId: approval.serverId,
        maintenanceWindowStartUtc: approval.maintenanceWindowStartUtc,
        maintenanceWindowEndUtc: approval.maintenanceWindowEndUtc,
        betaRouteVerifiedAtUtc: approval.betaRouteVerifiedAtUtc,
        betaRouteBoundToExpectedServer: approval.betaRouteBoundToExpectedServer,
        noUnapprovedAudience: approval.noUnapprovedAudience,
        ...(approval.recoveryAuthorized === true ? {
            recoveryAuthorized: true,
            recoveryTransactionId: approval.recoveryTransactionId,
            recoveryTransactionJournalSha256: authorization.recoveryTransactionJournalSha256
        } : {})
    } : { taskId: approval.taskId };
}

function validateDeployment({ flags, identity, policy, registry, operatorPolicy, versions, protectedApprovalProbe }) {
    const frozenFields = [flags.artifactArchive, flags.artifactRoot, flags.frozenSourceCommit];
    if (frozenFields.some(Boolean) && !frozenFields.every(Boolean)) {
        deny('Frozen deployment requires archive, staged artifact root and exact source commit together');
    }
    const environment = registeredEnvironment(flags, registry);
    const verified = verifiedManifest(flags, identity, versions);
    const evidence = verifiedAuthorization({ flags, identity, policy, environment, operatorPolicy, protectedApprovalProbe });
    const rollback = validateRollback({ rollbackPath: evidence.rollbackPath, environment, targetPath: evidence.targetPath,
        identity, verified, versions });
    const approvalIdentity = validateApproval({ approvalPath: evidence.approvalPath, environment, verified,
        authorization: evidence.authorization, rollbackPath: evidence.rollbackPath, rollback });
    return { environmentId: environment.id, targetPath: evidence.targetPath,
        sourceCommit: verified.sourceCommit, sourceTree: verified.sourceTree,
        archiveSha256: verified.archiveSha256, artifactManifestDigest: verified.manifest.manifestDigest,
        approvalIdentity };
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
    protectedApprovalProbe = approvalProtectedFromCurrentProcess,
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
    if (mode !== 'deploy' && (flags.artifactArchive || flags.artifactRoot || flags.frozenSourceCommit)) {
        deny('Frozen artifact options are deployment-only');
    }
    validatePolicy(policy, authority);
    const ciRef = ciReference(mode, flags, identity, ciContext, runtimePlatform);
    validateSourceLocation(identity, policy, ciRef);
    validateSourceProvenance({ identity, policy, ciRef, ciContext, runtimePlatform, env });
    const versions = sourceVersions(identity.root, policy);
    if ((mode === 'package' || mode === 'deploy') && identity.dirty) deny('Release package or deployment requires clean committed source');
    if (mode === 'deploy') {
        if (registry?.schemaVersion !== 1 || registry.projectId !== 'PTV_WEB') deny('Environment registry is invalid');
        const deployment = validateDeployment({ flags, identity, policy, registry, operatorPolicy, versions, protectedApprovalProbe });
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
        '--artifact-root': 'artifactRoot',
        '--artifact-archive': 'artifactArchive',
        '--frozen-source-commit': 'frozenSourceCommit',
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
            "$keys=@('Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\PiggieTV\\WorkspaceAuthority','Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\PiggieTV')",
            '$records=@(foreach($key in $keys){',
            '  $acl=Get-Acl -LiteralPath $key',
            '  @{ownerSid=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;',
            '    aces=@($acl.Access | ForEach-Object { @{sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; type=$_.AccessControlType.ToString(); rights=[int64]$_.RegistryRights} })}',
            '})',
            '$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent()',
            '$principal=[System.Security.Principal.WindowsPrincipal]::new($identity)',
            '$writable=$identity.IsSystem -or $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)',
            '$base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryView]::Default)',
            "foreach($keyName in @('SOFTWARE\\PiggieTV\\WorkspaceAuthority','SOFTWARE\\PiggieTV')) {",
            "  foreach($rightName in @('SetValue','CreateSubKey','Delete','ChangePermissions','TakeOwnership')) {",
            '    $right=[Enum]::Parse([Microsoft.Win32.RegistryRights],$rightName)',
            '    try { $probe=$base.OpenSubKey($keyName,$right); if($null -ne $probe) { $writable=$true; $probe.Dispose() } }',
            '    catch [System.UnauthorizedAccessException] {}',
            '    catch [System.Security.SecurityException] {}',
            '  }',
            '}',
            '$base.Dispose()',
            '@{ records=$records; currentTokenCanWrite=[bool]$writable } | ConvertTo-Json -Compress -Depth 5'
        ].join('\n');
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
    if (!acl || acl.currentTokenCanWrite !== false || !Array.isArray(acl.records) || acl.records.length !== 2) return false;
    const writeMask = 0x2 | 0x4 | 0x10000 | 0x40000 | 0x80000;
    return acl.records.every(record => privilegedSids.has(record.ownerSid) && Array.isArray(record.aces)
        && record.aces.every(ace => ace.type !== 'Allow'
            || (typeof ace.rights === 'number' && typeof ace.sid === 'string'
                && ((ace.rights & writeMask) === 0 || privilegedSids.has(ace.sid)))));
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
