import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

const module = await import('./ptv-protected-web-approval.mjs').catch(() => ({}));
const temporaryRoots = [];
const sha = value => createHash('sha256').update(value).digest('hex');
const commit = 'e7c7fad8ca5fe4c751a57dd5623e39a5c35154d3';
const serverId = 'c1858e3f2d09468fb546ad9cfe438283';

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptv-web-approval-'));
    temporaryRoots.push(root);
    const artifactRoot = path.join(root, 'artifacts');
    const protectedRoot = path.join(root, 'protected');
    fs.mkdirSync(artifactRoot);
    fs.mkdirSync(protectedRoot);
    const files = Object.fromEntries(['candidateArchive', 'candidateManifest', 'baselineManifest',
        'rollbackArchive', 'rollbackReference'].map(name => {
        const file = path.join(artifactRoot, name + '.json');
        fs.writeFileSync(file, name);
        return [name, file];
    }));
    const now = Date.parse('2026-10-24T16:00:00Z');
    const targetPath = path.join(root, 'web-target');
    const evidence = {
        environmentId: 'JF_DEVELOPMENT_125', targetPath, serverId,
        sourceCommit: commit, sourceTree: '1'.repeat(40),
        candidateVersion: '0.5.78', pluginVersion: '0.5.24.0', baselineVersion: '0.5.77',
        candidateManifestDigest: '2'.repeat(64),
        ...Object.fromEntries(Object.entries(files).flatMap(([name, file]) => [
            [name + 'Path', file], [name + 'Sha256', sha(fs.readFileSync(file))]
        ]))
    };
    const approvalPath = path.join(protectedRoot, 'approval.json');
    const approval = {
        schemaVersion: 1, operatorApproved: true,
        operation: 'web-only-frozen-artifact-deployment', authorizedAction: 'publish',
        taskId: 'ptv-phase2b-fixture', environmentId: evidence.environmentId,
        targetPath, serverId, sourceCommit: commit, sourceTree: evidence.sourceTree,
        candidateVersion: evidence.candidateVersion, pluginVersion: evidence.pluginVersion,
        baselineVersion: evidence.baselineVersion,
        candidateManifestDigest: evidence.candidateManifestDigest,
        ...Object.fromEntries(Object.entries(files).flatMap(([name, file]) => [
            [name + 'Path', file], [name + 'Sha256', evidence[name + 'Sha256']]
        ])),
        maintenanceWindowStartUtc: '2026-10-24T15:55:00Z',
        maintenanceWindowEndUtc: '2026-10-24T16:15:00Z',
        expiresAt: '2026-10-24T17:00:00Z',
        betaRouteVerifiedAtUtc: '2026-10-24T15:59:00Z',
        audienceIsolationAttested: true, betaIsolationAttested: true,
        maintenanceUserIds: ['0123456789abcdef0123456789abcdef'],
        betaRouteBoundToExpectedServer: true,
        noUnapprovedAudience: true, testIdentityIsolationAttested: true,
        mediaScopeIsolationAttested: true, userImpactAttested: true,
        residualRaceAccepted: true, operatorControlledMaintenanceRestriction: false
    };
    const project = { projectId: 'PTV_WEB', developmentWebPublication: { enabled: true,
        operation: approval.operation, approvalRecordPath: approvalPath, approvalSha256: '' } };
    const operatorPolicy = { projects: [project] };
    const save = () => {
        fs.writeFileSync(approvalPath, JSON.stringify(approval));
        project.developmentWebPublication.approvalSha256 = sha(fs.readFileSync(approvalPath));
    };
    save();
    const options = { evidence, operatorPolicy, artifactRoot, sourceRoot: path.join(root, 'source'),
        approvalPath, protectedApprovalProbe: () => true, now, action: 'publish' };
    return { root, artifactRoot, protectedRoot, files, evidence, approvalPath, approval,
        project, operatorPolicy, options, save };
}

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
        const relative = path.relative(os.tmpdir(), root);
        assert.ok(relative.startsWith('ptv-web-approval-') && !relative.includes('..'));
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('protected approval validator accepts only exact bound publish evidence', () => {
    assert.equal(typeof module.validateProtectedWebApproval, 'function');
    const f = fixture();
    const result = module.validateProtectedWebApproval(f.options);
    assert.equal(result.taskId, f.approval.taskId);
    assert.equal(result.authorizedAction, 'publish');
    assert.equal(result.serverId, serverId);
    assert.equal(result.approvalSha256, sha(fs.readFileSync(f.approvalPath)));
});

test('missing or task-writable approval and disabled protected grant deny', () => {
    const f = fixture();
    assert.throws(() => module.validateProtectedWebApproval({ ...f.options,
        approvalPath: path.join(f.artifactRoot, 'approval.json') }), /approval|protected/i);
    assert.throws(() => module.validateProtectedWebApproval({ ...f.options,
        protectedApprovalProbe: () => false }), /writable|protected/i);
    f.project.developmentWebPublication.enabled = false;
    assert.throws(() => module.validateProtectedWebApproval(f.options), /authorize|disabled|approval/i);
});

test('candidate, baseline, rollback, source, server and target bindings deny mismatch', () => {
    const f = fixture();
    for (const [field, value] of [
        ['candidateArchiveSha256', '0'.repeat(64)],
        ['candidateManifestSha256', '0'.repeat(64)],
        ['candidateManifestDigest', '0'.repeat(64)],
        ['baselineManifestSha256', '0'.repeat(64)],
        ['rollbackArchiveSha256', '0'.repeat(64)],
        ['rollbackReferenceSha256', '0'.repeat(64)],
        ['sourceCommit', '0'.repeat(40)],
        ['serverId', '0'.repeat(32)],
        ['targetPath', path.join(f.root, 'wrong-target')]
    ]) {
        assert.throws(() => module.validateProtectedWebApproval({ ...f.options,
            evidence: { ...f.evidence, [field]: value } }), /mismatch|binding|identity/i, field);
    }
});

test('tampered approval bytes and artifact bytes deny', () => {
    const f = fixture();
    fs.appendFileSync(f.approvalPath, ' ');
    assert.throws(() => module.validateProtectedWebApproval(f.options), /hash|mismatch/i);
    f.save();
    fs.appendFileSync(f.files.candidateArchive, 'tampered');
    assert.throws(() => module.validateProtectedWebApproval(f.options), /hash|mismatch/i);
});

test('artifact evidence outside the approved artifact root denies even when signed off', () => {
    const f = fixture();
    const outside = path.join(f.root, 'outside.zip');
    fs.writeFileSync(outside, 'outside');
    f.approval.candidateArchivePath = outside;
    f.approval.candidateArchiveSha256 = sha(fs.readFileSync(outside));
    f.save();
    assert.throws(() => module.validateProtectedWebApproval({ ...f.options,
        evidence: { ...f.evidence, candidateArchivePath: outside,
            candidateArchiveSha256: f.approval.candidateArchiveSha256 } }), /artifact|path|root/i);
});

test('expired window, stale audience proof and unknown isolation deny', () => {
    const f = fixture();
    for (const [field, value] of [
        ['expiresAt', '2026-10-24T15:59:00Z'],
        ['maintenanceWindowEndUtc', '2026-10-24T15:59:00Z'],
        ['betaRouteVerifiedAtUtc', '2026-10-24T15:50:00Z'],
        ['audienceIsolationAttested', false],
        ['betaIsolationAttested', false],
        ['testIdentityIsolationAttested', false],
        ['mediaScopeIsolationAttested', false],
        ['residualRaceAccepted', false]
    ]) {
        const original = f.approval[field];
        f.approval[field] = value;
        f.save();
        assert.throws(() => module.validateProtectedWebApproval(f.options), /approval|window|audience|race|isolation/i, field);
        f.approval[field] = original;
    }
});

test('maintenance identity scope must be nonempty, unique and well formed', () => {
    const f = fixture();
    for (const ids of [[], ['not-a-user-id'],
        ['0123456789abcdef0123456789abcdef', '0123456789abcdef0123456789abcdef']]) {
        f.approval.maintenanceUserIds = ids;
        f.save();
        assert.throws(() => module.validateProtectedWebApproval(f.options), /maintenance|identity|approval/i);
    }
});

test('recovery requires separately bound journal and recovery action', () => {
    const f = fixture();
    assert.throws(() => module.validateProtectedWebApproval({ ...f.options, action: 'recover' }), /recovery|action/i);
    const journalPath = path.join(f.artifactRoot, 'journal.json');
    fs.writeFileSync(journalPath, '{"transactionId":"' + 'a'.repeat(32) + '"}');
    f.approval.authorizedAction = 'recover';
    f.approval.recoveryJournalPath = journalPath;
    f.approval.recoveryJournalSha256 = sha(fs.readFileSync(journalPath));
    f.approval.recoveryTransactionId = 'a'.repeat(32);
    f.save();
    const result = module.validateProtectedWebApproval({ ...f.options, action: 'recover',
        recoveryJournalPath: journalPath, recoveryJournalSha256: f.approval.recoveryJournalSha256,
        recoveryTransactionId: f.approval.recoveryTransactionId });
    assert.equal(result.authorizedAction, 'recover');
    assert.throws(() => module.validateProtectedWebApproval({ ...f.options, action: 'recover',
        recoveryJournalPath: journalPath, recoveryJournalSha256: '0'.repeat(64),
        recoveryTransactionId: f.approval.recoveryTransactionId }), /recovery|hash|mismatch/i);
});

test('recovery refresh keeps original approval and journal identity after journal mutation', () => {
    const f = fixture();
    const journalPath = path.join(f.artifactRoot, 'journal.json');
    const transactionId = 'a'.repeat(32);
    fs.writeFileSync(journalPath, JSON.stringify({ transactionId, state: 'READY_TO_PUBLISH' }));
    f.approval.authorizedAction = 'recover';
    f.approval.recoveryJournalPath = journalPath;
    f.approval.recoveryJournalSha256 = sha(fs.readFileSync(journalPath));
    f.approval.recoveryTransactionId = transactionId;
    f.save();
    const recovery = { ...f.options, action: 'recover', recoveryJournalPath: journalPath,
        recoveryJournalSha256: f.approval.recoveryJournalSha256,
        recoveryTransactionId: transactionId };
    const initial = module.validateProtectedWebApproval(recovery);
    assert.equal(initial.recoveryJournalSha256, f.approval.recoveryJournalSha256);
    fs.writeFileSync(journalPath, JSON.stringify({ transactionId, state: 'ROLLBACK_REQUIRED' }));
    assert.throws(() => module.validateProtectedWebApproval(recovery), /journal|hash|mismatch/i);
    const refresh = { ...recovery,
        recoveryContinuationOriginalSha256: initial.recoveryJournalSha256,
        expectedApprovalSha256: initial.approvalSha256 };
    assert.equal(module.validateProtectedWebApproval(refresh).taskId, f.approval.taskId);
    assert.throws(() => module.validateProtectedWebApproval({ ...refresh,
        recoveryContinuationOriginalSha256: '0'.repeat(64) }), /journal|hash|mismatch/i);
    assert.throws(() => module.validateProtectedWebApproval({ ...refresh,
        expectedApprovalSha256: '0'.repeat(64) }), /approval|hash|mismatch/i);
    fs.writeFileSync(journalPath, JSON.stringify({ transactionId: 'b'.repeat(32),
        state: 'ROLLBACK_REQUIRED' }));
    assert.throws(() => module.validateProtectedWebApproval(refresh), /journal|transaction|mismatch/i);
    fs.writeFileSync(journalPath, JSON.stringify({ transactionId, state: 'ROLLBACK_REQUIRED' }));
    f.project.developmentWebPublication.enabled = false;
    assert.throws(() => module.validateProtectedWebApproval(refresh), /approval|authorize/i);
});
