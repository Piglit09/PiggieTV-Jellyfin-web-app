import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const deployScript = path.join(scriptDir, 'deploy-jellyfin-web.ps1');
const webosScript = path.join(scriptDir, 'ptv-webos.mjs');
const pwsh = process.env.PTV_PWSH ?? 'pwsh';

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptv-web-deploy-denial-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const target = path.join(root, 'target');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'sentinel.txt'), 'untouched');
    const archive = path.join(root, 'candidate.zip');
    const manifest = path.join(root, 'candidate-manifest.json');
    const approval = path.join(root, 'approval.json');
    const rollback = path.join(root, 'rollback.json');
    for (const file of [archive, manifest, approval, rollback]) fs.writeFileSync(file, '{}');
    return { root, target, archive, manifest, approval, rollback };
}

function invoke(f, extra = [], environment = 'JF_DEVELOPMENT_125') {
    return spawnSync(pwsh, [ '-NoProfile', '-File', deployScript,
        '-EnvironmentId', environment, '-Artifact', f.archive,
        '-ArtifactManifest', f.manifest, '-ApprovalRecord', f.approval,
        '-RollbackReference', f.rollback, ...extra ], { encoding: 'utf8', windowsHide: true });
}

function unchanged(f) {
    assert.deepEqual(fs.readdirSync(f.target), [ 'sentinel.txt' ]);
    assert.equal(fs.readFileSync(path.join(f.target, 'sentinel.txt'), 'utf8'), 'untouched');
}

function recoveryEvidenceFixture(t, mutate = null) {
    const f = fixture(t);
    const approval = {
        schemaVersion: 1, operatorApproved: true, taskId: 'PTV-WEB-075-RECOVER',
        environmentId: 'JF_DEVELOPMENT_125', operation: 'web-only-frozen-artifact-deployment',
        serverId: 'c1858e3f2d09468fb546ad9cfe438283',
        expiresAt: '2026-10-17T19:00:00Z', maintenanceWindowStartUtc: '2026-10-17T17:45:00Z',
        maintenanceWindowEndUtc: '2026-10-17T18:30:00Z', userImpactAttested: true,
        betaIsolationAttested: true, betaRouteBoundToExpectedServer: true,
        noUnapprovedAudience: true, betaRouteVerifiedAtUtc: '2026-10-17T17:59:40Z',
        recoveryAuthorized: true, recoveryTransactionId: 'a'.repeat(32),
        maintenanceUserIds: ['11111111111111111111111111111111']
    };
    const observation = {
        origin: 'http://127.0.0.1:8096', environmentId: 'JF_DEVELOPMENT_125',
        capturedAtUtc: '2026-10-17T17:59:55Z',
        system: { Id: approval.serverId, ServerName: 'PTV Testing', Version: '12.2.0' },
        plugin: { ok: true, pluginVersion: '0.5.22.0' },
        sessions: { authenticated: true, administrator: true,
            requesterUserId: '11111111111111111111111111111111',
            capturedAtUtc: '2026-10-17T17:59:55Z', recentActivityWindowSeconds: 960,
            items: [{ UserId: '11111111111111111111111111111111',
                LastActivityDate: '2026-10-17T17:59:40Z', IsActive: true,
                NowPlayingItem: null, PlayState: null, TranscodingInfo: null }] },
        betaIsolation: { verified: true, routeBoundToExpectedServer: true,
            noUnapprovedAudience: true, approvalTaskId: approval.taskId,
            checkedAtUtc: approval.betaRouteVerifiedAtUtc },
        conflictingDeployment: false
    };
    if (mutate) mutate(approval, observation);
    fs.writeFileSync(f.approval, JSON.stringify(approval));
    fs.writeFileSync(f.manifest, JSON.stringify(observation));
    const harness = path.join(f.root, 'recovery-evidence.ps1');
    fs.writeFileSync(harness, `
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile('${deployScript.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors)
$definition = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Test-RecoveryEvidence' }, $true)
if ($null -eq $definition) { throw 'Test-RecoveryEvidence function missing' }
Invoke-Expression $definition.Extent.Text
$approval = Get-Content -LiteralPath '${f.approval.replaceAll("'", "''")}' -Raw | ConvertFrom-Json -AsHashtable
$observation = Get-Content -LiteralPath '${f.manifest.replaceAll("'", "''")}' -Raw | ConvertFrom-Json -AsHashtable
Test-RecoveryEvidence -Approval $approval -Observation $observation -ExpectedServerId 'c1858e3f2d09468fb546ad9cfe438283' -TransactionId ('a' * 32) -NowUtc ([DateTimeOffset]::Parse('2026-10-17T18:00:00Z')) | Out-Null
`);
    return spawnSync(pwsh, ['-NoProfile', '-File', harness], { encoding: 'utf8', windowsHide: true });
}

test('unknown and production environments are denied before any target write', t => {
    const f = fixture(t);
    for (const id of ['JF_PRODUCTION_50', 'JF_UNKNOWN']) {
        const result = invoke(f, [], id);
        assert.notEqual(result.status, 0, `${id} was unexpectedly accepted`);
        assert.match(result.stderr + result.stdout, /JF_DEVELOPMENT_125|environment|target/i);
        unchanged(f);
    }
});

test('an arbitrary target override is rejected before any target write', t => {
    const f = fixture(t);
    const result = invoke(f, ['-Target', f.target]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /Target|parameter/u);
    unchanged(f);
});

test('the wrapper rejects a substitute artifact before asking for live access', t => {
    const f = fixture(t);
    const result = invoke(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /frozen artifact path|approved candidate|frozen candidate/i);
    unchanged(f);
});

test('explicit recovery mode still denies a substitute artifact without touching a fixture target', t => {
    const f = fixture(t);
    const result = invoke(f, ['-Recover']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /frozen artifact path|approved candidate/i);
    unchanged(f);
});

test('deployment entrypoint has no arbitrary target parameter or legacy overlay publisher', () => {
    const source = fs.readFileSync(deployScript, 'utf8');
    assert.doesNotMatch(source, /\[string\]\$Target\b/u);
    assert.match(source, /Invoke-PTVWebExactTreePublication/u);
    assert.match(source, /Test-PTVWebPrepublicationGate/u);
    assert.match(source, /--frozen-source-commit/u);
    assert.match(source, /System\/Info\/Public/u);
    assert.match(source, /\.ptv-web-exact-tree\.lock/u);
    assert.match(source, /Restore-PTVWebExactTreePublication/u);
    assert.match(source, /A recovery-only approval cannot authorize a new Web publication/u);
    assert.match(source, /recoveryTransactionJournalSha256/u);
    const recoveryCollector = source.slice(source.indexOf('function Get-PTVWebRecoveryObservation'),
        source.indexOf('function Test-ServedIndex'));
    assert.match(recoveryCollector, /\/Sessions/u);
    assert.doesNotMatch(recoveryCollector, /\/web\/index\.html/u);
});

test('reviewed recovery journal rejects post-approval modification before publication writes', t => {
    const f = fixture(t);
    const journal = path.join(f.root, 'transaction.json');
    const transactionId = 'a'.repeat(32);
    fs.writeFileSync(journal, JSON.stringify({ transactionId, state: 'PUBLISHING' }));
    const reviewedSha = createHash('sha256').update(fs.readFileSync(journal)).digest('hex');
    const harness = path.join(f.root, 'journal-binding.ps1');
    fs.writeFileSync(harness, `
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile('${deployScript.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Deployer does not parse.' }
$definition = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Assert-RecoveryJournalBinding' }, $true)
if ($null -eq $definition) { throw 'Journal binding validator missing.' }
Invoke-Expression $definition.Extent.Text
Assert-RecoveryJournalBinding -JournalPath '${journal.replaceAll("'", "''")}' -ReviewedSha256 '${reviewedSha}' -TransactionId '${transactionId}' | Out-Null
`);
    const accepted = spawnSync(pwsh, ['-NoProfile', '-File', harness], { encoding: 'utf8', windowsHide: true });
    assert.equal(accepted.status, 0, accepted.stderr + accepted.stdout);
    fs.writeFileSync(journal, JSON.stringify({ transactionId, state: 'ROLLBACK_REQUIRED' }));
    const rejected = spawnSync(pwsh, ['-NoProfile', '-File', harness], { encoding: 'utf8', windowsHide: true });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr + rejected.stdout, /changed after operator approval/u);
    unchanged(f);
});

test('protected recovery accepts a partial-index observation when server and users are safe', t => {
    const result = recoveryEvidenceFixture(t);
    assert.equal(result.status, 0, result.stderr + result.stdout);
});

test('protected recovery rejects active playback, stale Beta proof, and wrong server', t => {
    for (const mutate of [
        (a, o) => { o.sessions.items[0].NowPlayingItem = { Id: 'playing' }; },
        (a, o) => {
            a.betaRouteVerifiedAtUtc = '2026-10-17T17:45:00Z';
            o.betaIsolation.checkedAtUtc = a.betaRouteVerifiedAtUtc;
        },
        (a, o) => { o.system.Id = 'different'; },
        (a) => { a.recoveryAuthorized = false; },
        (a) => { a.recoveryAuthorized = 'true'; },
        (a) => { a.recoveryTransactionId = 'b'.repeat(32); }
    ]) {
        const result = recoveryEvidenceFixture(t, mutate);
        assert.notEqual(result.status, 0);
    }
});

test('webOS helper allows offline command previews but denies live device operations', () => {
    const preview = spawnSync(process.execPath, [ webosScript, 'install', '--device', 'fixture', '--package', 'fixture.ipk', '--dry-run' ], { encoding: 'utf8' });
    assert.equal(preview.status, 0);
    assert.match(preview.stdout, /ares-install/u);
    const live = spawnSync(process.execPath, [ webosScript, 'install', '--device', 'fixture', '--package', 'fixture.ipk' ], { encoding: 'utf8' });
    assert.notEqual(live.status, 0);
    assert.match(live.stderr, /disabled/u);
});
