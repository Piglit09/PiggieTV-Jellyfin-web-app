/*
 * Candidate-specific Web approval. The approval record is independently
 * protected by the Windows Registry policy's path/hash binding and file ACL.
 * This tool never creates or modifies either authority.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluatePreflight, webApprovalProtectedForOperator,
    readWebOperatorPolicy } from './ptv-workspace-preflight.mjs';

const sourceRoot = 'C:\\Users\\Piggie\\Documents\\GitHub\\Jellyfin-Web-PiggieTV';
const operation = 'web-only-frozen-artifact-deployment';
const boundFiles = ['candidateArchive', 'candidateManifest', 'baselineManifest',
    'rollbackArchive', 'rollbackReference'];
const boundScalars = ['environmentId', 'targetPath', 'serverId', 'sourceCommit', 'sourceTree',
    'candidateVersion', 'pluginVersion', 'baselineVersion', 'candidateManifestDigest'];
const hex64 = /^[0-9a-f]{64}$/u;

function deny(reason) {
    throw new Error(`Protected Web approval ${reason}`);
}

function samePath(first, second) {
    if (typeof first !== 'string' || typeof second !== 'string'
        || !path.isAbsolute(first) || !path.isAbsolute(second)) return false;
    const normalize = value => {
        const result = path.normalize(value).replace(/[\\/]$/u, '');
        return process.platform === 'win32' ? result.toLowerCase() : result;
    };
    return normalize(first) === normalize(second);
}

function insidePath(candidate, parent) {
    const relative = path.relative(parent, candidate);
    return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep)
        && !path.isAbsolute(relative));
}

function regularFile(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) deny('path is invalid');
    let real;
    try {
        real = fs.realpathSync.native(file);
    } catch {
        deny('file is missing');
    }
    if (!samePath(real, file) || !fs.lstatSync(file).isFile()) deny('file path is untrusted');
    return real;
}

function hashFile(file) {
    const hash = createHash('sha256');
    const descriptor = fs.openSync(regularFile(file), 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
        for (;;) {
            const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
            if (count === 0) break;
            hash.update(buffer.subarray(0, count));
        }
    } finally { fs.closeSync(descriptor); }
    return hash.digest('hex');
}

function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value)) {
        return Number.NaN;
    }
    return Date.parse(value);
}

function verifiedApprovalFile({ approvalPath, sourceRoot: repoRoot, artifactRoot, project,
    protectedApprovalProbe }) {
    const binding = project?.developmentWebPublication;
    if (binding?.enabled !== true || binding.operation !== operation
        || !hex64.test(binding.approvalSha256 ?? '')) deny('is not authorized by protected policy');
    const actual = regularFile(approvalPath);
    if (insidePath(actual, repoRoot) || insidePath(actual, artifactRoot)) {
        deny('record is in a task-writable path');
    }
    const approvedBytes = fs.readFileSync(actual);
    const approvedHash = createHash('sha256').update(approvedBytes).digest('hex');
    if (!samePath(actual, binding.approvalRecordPath) || approvedHash !== binding.approvalSha256) {
        deny('record path or hash mismatch');
    }
    if (!protectedApprovalProbe(actual)) deny('record is writable or lacks protected ACL');
    try {
        return { record: JSON.parse(approvedBytes.toString('utf8')), sha256: approvedHash };
    } catch {
        deny('record is invalid');
    }
}

function validateEvidenceBindings(approval, evidence, artifactRoot) {
    for (const field of boundScalars) {
        const matches = field === 'targetPath' ? samePath(approval[field], evidence[field]) :
            approval[field] === evidence[field];
        if (!matches) deny(`${field} binding mismatch`);
    }
    if (evidence.environmentId !== 'JF_DEVELOPMENT_125'
        || !/^[0-9a-f]{32}$/u.test(evidence.serverId)
        || !/^[0-9a-f]{40}$/u.test(evidence.sourceCommit)
        || !/^[0-9a-f]{40}$/u.test(evidence.sourceTree)
        || !hex64.test(evidence.candidateManifestDigest)) {
        deny('development target identity is invalid');
    }
    let physicalArtifactRoot;
    try {
        physicalArtifactRoot = fs.realpathSync.native(artifactRoot);
    } catch {
        deny('artifact root is missing');
    }
    if (!samePath(physicalArtifactRoot, artifactRoot)
        || !fs.lstatSync(artifactRoot).isDirectory()) deny('artifact root is untrusted');
    for (const name of boundFiles) {
        const file = evidence[name + 'Path'];
        const expected = evidence[name + 'Sha256'];
        if (!insidePath(file, physicalArtifactRoot)
            || !samePath(approval[name + 'Path'], file) || !hex64.test(expected ?? '')
            || approval[name + 'Sha256'] !== expected || hashFile(file) !== expected) {
            deny(`${name} path or hash mismatch`);
        }
    }
}

function validateWindowAndAudience(approval, now) {
    const start = timestamp(approval.maintenanceWindowStartUtc);
    const end = timestamp(approval.maintenanceWindowEndUtc);
    const expires = timestamp(approval.expiresAt);
    const routeVerified = timestamp(approval.betaRouteVerifiedAtUtc);
    if (![start, end, expires, routeVerified].every(Number.isFinite)
        || start > now || end <= now || end - start > 2 * 60 * 60 * 1000
        || expires <= now || expires - now > 24 * 60 * 60 * 1000
        || routeVerified > now || now - routeVerified > 5 * 60 * 1000) {
        deny('window or audience evidence is stale');
    }
    for (const field of ['audienceIsolationAttested', 'betaIsolationAttested',
        'betaRouteBoundToExpectedServer',
        'noUnapprovedAudience', 'testIdentityIsolationAttested', 'mediaScopeIsolationAttested',
        'userImpactAttested']) {
        if (approval[field] !== true) deny(`${field} is unverified`);
    }
    const ids = approval.maintenanceUserIds;
    if (!Array.isArray(ids) || ids.length === 0
        || !ids.every(id => typeof id === 'string'
            && /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu.test(id))
        || new Set(ids.map(id => id.toLowerCase())).size !== ids.length) {
        deny('maintenance identity scope is invalid');
    }
    if (approval.residualRaceAccepted !== true
        && approval.operatorControlledMaintenanceRestriction !== true) {
        deny('race condition is not accepted or restricted');
    }
}

function validateRecoveryBinding(approval, action, { recoveryTransactionId, recoveryJournalSha256,
    recoveryJournalPath, continuation, recoveryContinuationOriginalSha256 }) {
    if (action === 'recover') {
        if (!/^[0-9a-f]{32}$/u.test(recoveryTransactionId ?? '')
            || !hex64.test(recoveryJournalSha256 ?? '')
            || !samePath(approval.recoveryJournalPath, recoveryJournalPath)
            || approval.recoveryJournalSha256 !== recoveryJournalSha256
            || approval.recoveryTransactionId !== recoveryTransactionId
            || (continuation ?
                recoveryContinuationOriginalSha256 !== recoveryJournalSha256
                    || readJson(recoveryJournalPath).transactionId !== recoveryTransactionId :
                hashFile(recoveryJournalPath) !== recoveryJournalSha256)) {
            deny('recovery journal binding mismatch');
        }
    } else if (['recoveryJournalPath', 'recoveryJournalSha256', 'recoveryTransactionId']
        .some(field => Object.hasOwn(approval, field))) {
        deny('publish approval contains recovery authority');
    }
}

export function validateProtectedWebApproval({ evidence, operatorPolicy, artifactRoot, sourceRoot: repoRoot,
    approvalPath, protectedApprovalProbe = webApprovalProtectedForOperator,
    now = Date.now(), action = 'publish', recoveryJournalPath, recoveryJournalSha256,
    recoveryTransactionId, recoveryContinuationOriginalSha256, expectedApprovalSha256 }) {
    if (!evidence || !Number.isFinite(now) || !['publish', 'recover'].includes(action)) {
        deny('request is invalid');
    }
    const projects = operatorPolicy?.projects?.filter(project => project.projectId === 'PTV_WEB');
    if (projects?.length !== 1) deny('project binding is missing or duplicated');
    const verifiedApproval = verifiedApprovalFile({ approvalPath, sourceRoot: repoRoot, artifactRoot,
        project: projects[0], protectedApprovalProbe });
    const continuation = recoveryContinuationOriginalSha256 !== undefined
        || expectedApprovalSha256 !== undefined;
    if (continuation && (action !== 'recover'
        || !hex64.test(recoveryContinuationOriginalSha256 ?? '')
        || !hex64.test(expectedApprovalSha256 ?? '')
        || verifiedApproval.sha256 !== expectedApprovalSha256)) {
        deny('recovery continuation approval hash mismatch');
    }
    const approval = verifiedApproval.record;
    if (approval.schemaVersion !== 1 || approval.operatorApproved !== true
        || approval.operation !== operation || approval.authorizedAction !== action
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{3,127}$/u.test(approval.taskId ?? '')) {
        deny('action or identity is invalid');
    }
    validateEvidenceBindings(approval, evidence, artifactRoot);
    validateWindowAndAudience(approval, now);
    validateRecoveryBinding(approval, action, { recoveryTransactionId, recoveryJournalSha256,
        recoveryJournalPath, continuation, recoveryContinuationOriginalSha256 });
    return { taskId: approval.taskId, approvalSha256: verifiedApproval.sha256,
        authorizedAction: action, serverId: evidence.serverId,
        targetPath: evidence.targetPath, environmentId: evidence.environmentId,
        sourceCommit: evidence.sourceCommit, candidateVersion: evidence.candidateVersion,
        baselineVersion: evidence.baselineVersion, candidateArchiveSha256: evidence.candidateArchiveSha256,
        rollbackArchiveSha256: evidence.rollbackArchiveSha256,
        ...(action === 'recover' ? { recoveryJournalSha256: approval.recoveryJournalSha256,
            recoveryTransactionId: approval.recoveryTransactionId } : {}),
        betaRouteVerifiedAtUtc: approval.betaRouteVerifiedAtUtc,
        audienceIsolationAttested: true,
        residualRaceAccepted: approval.residualRaceAccepted === true,
        operatorControlledMaintenanceRestriction: approval.operatorControlledMaintenanceRestriction === true };
}

function parseArguments(argv) {
    const names = new Set(['environment-id', 'web-manifest', 'web-artifact-root', 'artifact-archive',
        'baseline-manifest', 'baseline-archive', 'rollback-reference', 'approval-record',
        'frozen-source-commit', 'action', 'recovery-journal',
        'recovery-original-journal-sha', 'recovery-original-approval-sha']);
    const flags = {};
    for (let index = 0; index < argv.length; index += 2) {
        const option = argv[index];
        const value = argv[index + 1];
        if (!option?.startsWith('--') || !names.has(option.slice(2)) || !value || value.startsWith('--')) {
            deny('command line is invalid');
        }
        flags[option.slice(2)] = value;
    }
    for (const required of ['environment-id', 'web-manifest', 'web-artifact-root', 'artifact-archive',
        'baseline-manifest', 'baseline-archive', 'rollback-reference', 'approval-record',
        'frozen-source-commit']) {
        if (!flags[required]) deny('command line is incomplete');
    }
    if (flags.action && !['publish', 'recover'].includes(flags.action)) deny('action is invalid');
    if (Boolean(flags['recovery-original-journal-sha'])
        !== Boolean(flags['recovery-original-approval-sha'])) {
        deny('recovery continuation binding is incomplete');
    }
    if (flags['recovery-original-journal-sha']
        && (flags.action !== 'recover' || !flags['recovery-journal'])) {
        deny('recovery continuation action is invalid');
    }
    return flags;
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(regularFile(file), 'utf8'));
    } catch {
        deny('evidence JSON is invalid');
    }
}

function cliEvidence(flags, preflight) {
    const manifest = readJson(flags['web-manifest']);
    const baseline = readJson(flags['baseline-manifest']);
    const rollback = readJson(flags['rollback-reference']);
    if (baseline.schemaVersion !== 1 || baseline.environmentId !== preflight.environmentId
        || baseline.serverId !== preflight.serverId
        || !samePath(baseline.installedRoot, preflight.webTargetPath)
        || !/^\d+\.\d+\.\d+$/u.test(baseline.webVersion ?? '')
        || !Array.isArray(baseline.files) || baseline.files.length !== baseline.fileCount
        || baseline.files.reduce((sum, file) => sum + file.size, 0) !== baseline.totalBytes) {
        deny('installed baseline manifest identity is invalid');
    }
    if (rollback.schemaVersion !== 1 || rollback.environmentId !== preflight.environmentId
        || !samePath(rollback.targetPath, preflight.webTargetPath)
        || rollback.candidateSourceCommit !== preflight.sourceCommit
        || rollback.artifactManifestDigest !== manifest.manifestDigest
        || !samePath(rollback.backupPath, flags['baseline-archive'])
        || rollback.backupSha256 !== hashFile(flags['baseline-archive'])) {
        deny('rollback reference binding mismatch');
    }
    const fileFlags = { candidateArchive: flags['artifact-archive'],
        candidateManifest: flags['web-manifest'], baselineManifest: flags['baseline-manifest'],
        rollbackArchive: flags['baseline-archive'], rollbackReference: flags['rollback-reference'] };
    return {
        environmentId: preflight.environmentId, targetPath: preflight.webTargetPath,
        serverId: preflight.serverId, sourceCommit: preflight.sourceCommit,
        sourceTree: preflight.sourceTree, candidateVersion: manifest.sourceVersions.web,
        pluginVersion: manifest.sourceVersions.plugin, baselineVersion: baseline.webVersion,
        candidateManifestDigest: manifest.manifestDigest,
        ...Object.fromEntries(Object.entries(fileFlags).flatMap(([name, file]) => [
            [name + 'Path', regularFile(file)], [name + 'Sha256', hashFile(file)]
        ]))
    };
}

export function runProtectedWebApproval(argv) {
    const flags = parseArguments(argv);
    const policy = readJson(path.join(sourceRoot, 'config', 'ptv-workspace-policy.json'));
    const registry = readJson(path.join(sourceRoot, policy.environmentRegistry));
    const operatorPolicy = readWebOperatorPolicy(policy);
    const preflight = evaluatePreflight({ mode: 'deploy-development', cwd: sourceRoot,
        policy, registry, operatorPolicy, flags: {
            environmentId: flags['environment-id'], webManifest: flags['web-manifest'],
            webArtifactRoot: flags['web-artifact-root'], frozenSourceCommit: flags['frozen-source-commit']
        } });
    const evidence = cliEvidence(flags, preflight);
    const journalPath = flags['recovery-journal'];
    const journal = journalPath ? readJson(journalPath) : null;
    const originalJournalSha = flags['recovery-original-journal-sha'];
    return validateProtectedWebApproval({ evidence, operatorPolicy,
        sourceRoot, artifactRoot: policy.artifactRoot,
        approvalPath: flags['approval-record'], action: flags.action ?? 'publish',
        ...(journalPath ? { recoveryJournalPath: journalPath,
            recoveryJournalSha256: originalJournalSha ?? hashFile(journalPath),
            recoveryTransactionId: journal.transactionId } : {}),
        ...(originalJournalSha ? { recoveryContinuationOriginalSha256: originalJournalSha,
            expectedApprovalSha256: flags['recovery-original-approval-sha'] } : {}) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.stdout.write(JSON.stringify(runProtectedWebApproval(process.argv.slice(2))) + '\n');
    } catch (error) {
        process.stderr.write(`PTV protected Web approval denied: ${error.message}\n`);
        process.exitCode = 1;
    }
}
