import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const deployScript = path.join(scriptDir, 'deploy-jellyfin-web.ps1');
const webosScript = path.join(scriptDir, 'ptv-webos.mjs');
const windowsRoot = process.env.SystemRoot;
assert.ok(windowsRoot && path.isAbsolute(windowsRoot), 'Windows system root is required for deployment fixture tests');
const powershellExe = path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
assert.ok(fs.existsSync(powershellExe), 'The system PowerShell executable is required for deployment fixture tests');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptv-deploy-fixture-'));
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const artifact = path.join(root, 'artifact');
    const target = path.join(root, 'target');
    fs.mkdirSync(artifact);
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(artifact, 'index.html'), 'candidate');
    fs.writeFileSync(path.join(target, 'sentinel.txt'), 'accepted install unchanged');
    const manifest = path.join(root, 'manifest.json');
    const approval = path.join(root, 'approval.json');
    const rollback = path.join(root, 'rollback.json');
    fs.writeFileSync(manifest, '{}');
    fs.writeFileSync(approval, '{}');
    fs.writeFileSync(rollback, '{}');
    return { artifact, target, manifest, approval, rollback };
}

const psQuote = value => "'" + value.replaceAll("'", "''") + "'";

function deploy(f, additional = []) {
    return spawnSync(powershellExe, [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', deployScript,
        '-EnvironmentId', 'JF_PRODUCTION_50',
        '-Artifact', f.artifact,
        '-ArtifactManifest', f.manifest,
        '-ApprovalRecord', f.approval,
        '-RollbackReference', f.rollback,
        ...additional
    ], { encoding: 'utf8', windowsHide: true });
}

test('an arbitrary target override is rejected before any target write', t => {
    const f = fixture(t);
    const result = deploy(f, [ '-Target', f.target ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /Target|parameter/u);
    assert.equal(fs.readFileSync(path.join(f.target, 'sentinel.txt'), 'utf8'), 'accepted install unchanged');
    assert.deepEqual(fs.readdirSync(f.target), [ 'sentinel.txt' ]);
});

test('production is denied without a protected approval and complete artifact', t => {
    const f = fixture(t);
    const result = deploy(f);
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(path.join(f.target, 'sentinel.txt'), 'utf8'), 'accepted install unchanged');
    assert.deepEqual(fs.readdirSync(f.target), [ 'sentinel.txt' ]);
});

test('an approved mock target receives verified files with index.html last', t => {
    const f = fixture(t);
    fs.mkdirSync(path.join(f.artifact, 'assets'));
    fs.writeFileSync(path.join(f.artifact, 'assets', 'app.js'), 'fixture bundle');
    const sha256 = data => createHash('sha256').update(data).digest('hex');
    const manifest = {
        projectId: 'PTV_WEB',
        sourceDirty: false,
        sourceCommit: 'a'.repeat(40),
        sourceVersions: { web: '0.5.71', plugin: '0.5.22.0' },
        manifestDigest: 'b'.repeat(64),
        files: [
            { path: 'assets/app.js', sha256: sha256('fixture bundle') },
            { path: 'index.html', sha256: sha256('candidate') }
        ]
    };
    fs.writeFileSync(f.manifest, JSON.stringify(manifest));
    const backup = path.join(path.dirname(f.manifest), 'prior-web-backup.zip');
    fs.writeFileSync(backup, 'verified fixture backup');
    const rollbackRecord = JSON.stringify({
        schemaVersion: 1,
        environmentId: 'JF_MOCK',
        targetPath: f.target,
        candidateSourceCommit: manifest.sourceCommit,
        candidateVersions: manifest.sourceVersions,
        artifactManifestDigest: manifest.manifestDigest,
        backupPath: backup,
        backupSha256: sha256('verified fixture backup'),
        createdAt: new Date(Date.now() - 60_000).toISOString()
    });
    fs.writeFileSync(f.rollback, rollbackRecord);
    const copyLog = path.join(path.dirname(f.manifest), 'copy-order.txt');
    const preflightResult = JSON.stringify({ environmentId: 'JF_MOCK', targetPath: f.target, artifactManifestDigest: manifest.manifestDigest });
    const mockScript = path.join(path.dirname(f.manifest), 'approved-mock.ps1');
    fs.writeFileSync(mockScript, `
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop
function global:node {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    $global:LASTEXITCODE = 0
    if ($Arguments[0] -like '*ptv-workspace-preflight.mjs') {
        Write-Output ${psQuote(preflightResult)}
    } elseif ($Arguments[0] -like '*ptv-artifact-manifest.mjs') {
        Write-Output 'fixture manifest verified'
    } else {
        throw 'Unexpected governance command'
    }
}
function global:Copy-Item {
    param([string]$LiteralPath, [string]$Destination, [switch]$Force)
    Add-Content -LiteralPath ${psQuote(copyLog)} -Value ([IO.Path]::GetFileName($LiteralPath))
    Microsoft.PowerShell.Management\\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force
}
& ${psQuote(deployScript)} -EnvironmentId JF_MOCK -Artifact ${psQuote(f.artifact)} -ArtifactManifest ${psQuote(f.manifest)} -ApprovalRecord ${psQuote(f.approval)} -RollbackReference ${psQuote(f.rollback)}
if (-not $?) { exit 1 }
`);
    const execute = () => spawnSync(powershellExe, [ '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', mockScript ], { encoding: 'utf8', windowsHide: true });
    fs.writeFileSync(f.rollback, '{}');
    const emptyRollback = execute();
    assert.notEqual(emptyRollback.status, 0);
    assert.deepEqual(fs.readdirSync(f.target), [ 'sentinel.txt' ]);
    const wrongVersion = { ...JSON.parse(rollbackRecord), candidateVersions: { web: '9.9.9', plugin: '0.5.22.0' } };
    fs.writeFileSync(f.rollback, JSON.stringify(wrongVersion));
    const mismatchedRollback = execute();
    assert.notEqual(mismatchedRollback.status, 0);
    assert.deepEqual(fs.readdirSync(f.target), [ 'sentinel.txt' ]);
    fs.writeFileSync(f.rollback, rollbackRecord);
    fs.writeFileSync(backup, 'tampered backup');
    const tamperedBackup = execute();
    assert.notEqual(tamperedBackup.status, 0);
    assert.deepEqual(fs.readdirSync(f.target), [ 'sentinel.txt' ]);
    fs.writeFileSync(backup, 'verified fixture backup');
    const result = execute();
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(fs.readFileSync(path.join(f.target, 'assets', 'app.js'), 'utf8'), 'fixture bundle');
    assert.equal(fs.readFileSync(path.join(f.target, 'index.html'), 'utf8'), 'candidate');
    assert.equal(fs.readFileSync(path.join(f.target, 'sentinel.txt'), 'utf8'), 'accepted install unchanged');
    assert.deepEqual(fs.readFileSync(copyLog, 'utf8').trim().split(/\r?\n/u), [ 'app.js', 'index.html' ]);
});

test('webOS helper allows offline command previews but denies live device operations', () => {
    const preview = spawnSync(process.execPath, [ webosScript, 'install', '--device', 'fixture', '--package', 'fixture.ipk', '--dry-run' ], { encoding: 'utf8' });
    assert.equal(preview.status, 0);
    assert.match(preview.stdout, /ares-install/u);
    const live = spawnSync(process.execPath, [ webosScript, 'install', '--device', 'fixture', '--package', 'fixture.ipk' ], { encoding: 'utf8' });
    assert.notEqual(live.status, 0);
    assert.match(live.stderr, /disabled/u);
});
