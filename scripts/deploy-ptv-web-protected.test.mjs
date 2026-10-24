import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'deploy-ptv-web-protected.ps1');
const pwsh = [process.env.PTV_PWSH,
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime',
        'dependencies', 'native', 'powershell', 'pwsh.exe')
].find(candidate => candidate && path.isAbsolute(candidate) && fs.existsSync(candidate));

function run(args) {
    return spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-File', script, ...args],
        { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
}

test('protected Web entry point is parseable and has no caller-selected target', () => {
    assert.ok(pwsh);
    const command = `$e=$null;$t=$null;$a=[Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'", "''")}',[ref]$t,[ref]$e);if($e.Count -gt 0){throw "PowerShell parser error"}; $a.ParamBlock.Parameters.Name.VariablePath.UserPath | ConvertTo-Json -Compress`;
    const parse = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    assert.equal(parse.status, 0, parse.stderr + parse.stdout);
    const parameters = JSON.parse(parse.stdout);
    assert.ok(!parameters.includes('TargetPath'));
    assert.ok(!parameters.includes('ServerId'));
    assert.ok(parameters.includes('ApprovalRecord'));
    assert.ok(parameters.includes('AdminToken'));
});

test('production and absent administrator token deny before approval or target checks', () => {
    const common = ['-CandidateArchive', 'missing.zip', '-CandidateManifest', 'missing.json',
        '-CandidateArtifactRoot', 'missing-root', '-BaselineArchive', 'old.zip',
        '-BaselineManifest', 'old.json', '-RollbackReference', 'rollback.json',
        '-ApprovalRecord', 'approval.json', '-FrozenSourceCommit', 'a'.repeat(40)];
    const production = run(['-EnvironmentId', 'JF_PRODUCTION_50', ...common]);
    assert.notEqual(production.status, 0);
    assert.match(production.stderr + production.stdout, /JF_DEVELOPMENT_125/u);
    const absentToken = run(['-EnvironmentId', 'JF_DEVELOPMENT_125', ...common]);
    assert.notEqual(absentToken.status, 0);
    assert.match(absentToken.stderr + absentToken.stdout, /administrator token|AdminToken/u);
    assert.doesNotMatch(absentToken.stderr + absentToken.stdout, /protected Web approval denied/u);
});

test('task-writable script location and nonprivileged staging ACL deny before import or approval', () => {
    const command = `
        $ErrorActionPreference='Stop'
        $tokens=$null; $errors=$null
        $ast=[Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'", "''")}',[ref]$tokens,[ref]$errors)
        if($errors.Count -ne 0){throw 'Wrapper did not parse'}
        $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-PrivilegedAclRecord'},$true)
        if($null -eq $definition){throw 'Protected ACL check is absent'}
        . ([scriptblock]::Create($definition.Extent.Text))
        $safe=@([pscustomobject]@{Sid='S-1-5-32-544';Type='Allow';Rights=2032127},
            [pscustomobject]@{Sid='S-1-5-32-545';Type='Allow';Rights=1})
        $unsafe=@([pscustomobject]@{Sid='S-1-5-32-545';Type='Allow';Rights=2})
        if(-not (Test-PrivilegedAclRecord -OwnerSid 'S-1-5-18' -Aces $safe)){throw 'Privileged ACL denied'}
        if(Test-PrivilegedAclRecord -OwnerSid 'S-1-5-32-545' -Aces $safe){throw 'User-owned ACL accepted'}
        if(Test-PrivilegedAclRecord -OwnerSid 'S-1-5-18' -Aces $unsafe){throw 'Task-writable ACL accepted'}
        if(-not (Test-PrivilegedAclRecord -OwnerSid 'S-1-5-18' -Aces $unsafe -ParentOnly)){throw 'Safe parent create right denied'}
        $replace=@([pscustomobject]@{Sid='S-1-5-32-545';Type='Allow';Rights=65536})
        if(Test-PrivilegedAclRecord -OwnerSid 'S-1-5-18' -Aces $replace -ParentOnly){throw 'Parent replacement right accepted'}
        $taskWrite=@([pscustomobject]@{Sid='S-1-5-21-9003605-1436556115-40747736-1001';Type='Allow';Rights=2})
        if(Test-PrivilegedAclRecord -OwnerSid 'S-1-5-32-544' -Aces $taskWrite -TargetTree){throw 'Task-writable target accepted'}
        if(Test-PrivilegedAclRecord -OwnerSid 'S-1-5-21-9003605-1436556115-40747736-1001' -Aces $safe -TargetTree){throw 'Task-owned target accepted'}
        $token=ConvertTo-SecureString 'disposable fixture' -AsPlainText -Force
        try {
            & '${script.replaceAll("'", "''")}' -EnvironmentId JF_DEVELOPMENT_125 -CandidateArchive missing.zip -CandidateManifest missing.json -CandidateArtifactRoot missing-root -BaselineArchive old.zip -BaselineManifest old.json -RollbackReference rollback.json -ApprovalRecord approval.json -FrozenSourceCommit $('a'*40) -AdminToken $token
            throw 'Task-writable wrapper ran'
        }
        catch {
            if($_.Exception.Message -eq 'Task-writable wrapper ran'){throw}
            if($_.Exception.Message -notmatch 'independently installed PowerShell 7 host|operator-owned script directory'){throw}
        }
        Write-Output 'Protected runtime guard checks passed.'
    `;
    const result = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64')], {
        encoding: 'utf8', windowsHide: true, timeout: 15_000
    });
    assert.equal(result.status, 0, JSON.stringify({ stderr: result.stderr, stdout: result.stdout, error: result.error?.message }));
});

test('target ACL permits only the current independent operator as an additional owner and writer', () => {
    const command = `
        $ErrorActionPreference='Stop'
        $tokens=$null; $errors=$null
        $ast=[Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'", "''")}',[ref]$tokens,[ref]$errors)
        if($errors.Count -ne 0){throw 'Wrapper did not parse'}
        $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-PrivilegedAclRecord'},$true)
        if($null -eq $definition){throw 'Target ACL check is absent'}
        . ([scriptblock]::Create($definition.Extent.Text))
        $operator='S-1-5-21-100-200-300-1002'
        $task='S-1-5-21-9003605-1436556115-40747736-1001'
        $other='S-1-5-21-100-200-300-1003'
        $operatorWrite=@([pscustomobject]@{Sid=$operator;Type='Allow';Rights=2;InheritOnly=$false})
        $taskWrite=@([pscustomobject]@{Sid=$task;Type='Allow';Rights=2;InheritOnly=$false})
        $otherWrite=@([pscustomobject]@{Sid=$other;Type='Allow';Rights=2;InheritOnly=$false})
        if(-not (Test-PrivilegedAclRecord -OwnerSid $operator -Aces $operatorWrite -TargetTree -OperatorSid $operator)){
            throw 'Independent operator-owned target denied'
        }
        if(Test-PrivilegedAclRecord -OwnerSid $operator -Aces $operatorWrite -TargetTree){
            throw 'Target accepted without a current operator SID'
        }
        if(Test-PrivilegedAclRecord -OwnerSid $other -Aces $operatorWrite -TargetTree -OperatorSid $operator){
            throw 'Unrelated target owner accepted'
        }
        if(Test-PrivilegedAclRecord -OwnerSid $operator -Aces $taskWrite -TargetTree -OperatorSid $operator){
            throw 'Task write ACE accepted'
        }
        if(Test-PrivilegedAclRecord -OwnerSid $operator -Aces $otherWrite -TargetTree -OperatorSid $operator){
            throw 'Unrelated write ACE accepted'
        }
        if(Test-PrivilegedAclRecord -OwnerSid $task -Aces $operatorWrite -TargetTree -OperatorSid $task){
            throw 'Task SID accepted as operator'
        }
        if(Test-PrivilegedAclRecord -OwnerSid $task -Aces $operatorWrite -TargetTree -OperatorSid $operator){
            throw 'Task-owned target accepted'
        }
        if(Test-PrivilegedAclRecord -OwnerSid $operator -Aces $operatorWrite -OperatorSid $operator){
            throw 'Operator SID admitted to protected runtime ACL'
        }
    `;
    const result = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64')], {
        encoding: 'utf8', windowsHide: true, timeout: 15_000
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal((fs.readFileSync(script, 'utf8').match(/-TargetTree -OperatorSid \$identity\.User\.Value/gu) ?? []).length, 2);
});

test('approval helper ignores inherited Node startup injection', t => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptv-web-node-env-'));
    t.after(() => {
        if (path.dirname(fixtureRoot) === os.tmpdir()
            && path.basename(fixtureRoot).startsWith('ptv-web-node-env-')) {
            fs.rmSync(fixtureRoot, { recursive: true, force: true });
        }
    });
    const maliciousModule = path.join(fixtureRoot, 'startup.cjs');
    const helper = path.join(fixtureRoot, 'approval.mjs');
    const marker = path.join(fixtureRoot, 'startup-marker.txt');
    const helperMarker = path.join(fixtureRoot, 'helper-marker.txt');
    fs.writeFileSync(maliciousModule,
        "require('node:fs').writeFileSync(process.env.PTV_STARTUP_MARKER, 'injected')\n");
    fs.writeFileSync(helper,
        "import fs from 'node:fs'; fs.writeFileSync(process.env.PTV_HELPER_MARKER, 'launched'); process.stdout.write('{}');\n");
    const quote = value => value.replaceAll("'", "''");
    const command = `
        $ErrorActionPreference='Stop'
        $tokens=$null; $errors=$null
        $ast=[Management.Automation.Language.Parser]::ParseFile('${quote(script)}',[ref]$tokens,[ref]$errors)
        if($errors.Count -ne 0){throw 'Wrapper did not parse'}
        $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-ProtectedApprovalCheck'},$true)
        if($null -eq $definition){throw 'Protected approval check is absent'}
        . ([scriptblock]::Create($definition.Extent.Text))
        $nodeExe='${quote(process.execPath)}'
        $approvalTool='${quote(helper)}'
        $EnvironmentId='JF_DEVELOPMENT_125'
        $CandidateManifest='candidate.json'; $CandidateArtifactRoot='artifacts'
        $CandidateArchive='candidate.zip'; $BaselineManifest='baseline.json'
        $BaselineArchive='baseline.zip'; $RollbackReference='rollback.json'
        $ApprovalRecord='approval.json'; $FrozenSourceCommit=('a'*40)
        $serverId='c1858e3f2d09468fb546ad9cfe438283'
        $target='C:\\Program Files\\Jellyfin\\Server\\jellyfin-web'
        try { Invoke-ProtectedApprovalCheck 'publish'; throw 'Invalid helper result was accepted' }
        catch { if($_.Exception.Message -eq 'Invalid helper result was accepted'){throw}; Write-Output $_.Exception.Message }
        if($env:NODE_OPTIONS -cne $env:PTV_EXPECTED_NODE_OPTIONS){throw 'Node environment was not restored'}
        if($env:NODE_PATH -cne $env:PTV_EXPECTED_NODE_PATH){throw 'Node path was not restored'}
    `;
    const nodeOptions = `--require=${maliciousModule.replaceAll('\\', '/')}`;
    const nodePath = fixtureRoot;
    const result = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64')], {
        encoding: 'utf8', windowsHide: true, timeout: 15_000,
        env: { ...process.env, NODE_OPTIONS: nodeOptions, NODE_PATH: nodePath,
            PTV_EXPECTED_NODE_OPTIONS: nodeOptions, PTV_EXPECTED_NODE_PATH: nodePath,
            PTV_STARTUP_MARKER: marker, PTV_HELPER_MARKER: helperMarker }
    });
    assert.equal(result.status, 0, JSON.stringify({ stderr: result.stderr, stdout: result.stdout,
        error: result.error?.message, signal: result.signal,
        helperRan: fs.existsSync(helperMarker), injectedRan: fs.existsSync(marker) }));
    assert.equal(fs.existsSync(helperMarker), true, 'approval helper did not run');
    assert.equal(fs.existsSync(marker), false, 'inherited Node startup module ran');
});

test('wrapper removes task-written PowerShell modules before command autoload', t => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptv-web-psmodule-'));
    t.after(() => {
        if (path.dirname(fixtureRoot) === os.tmpdir()
            && path.basename(fixtureRoot).startsWith('ptv-web-psmodule-')) {
            fs.rmSync(fixtureRoot, { recursive: true, force: true });
        }
    });
    const moduleRoot = path.join(fixtureRoot, 'PTVStartupProbe');
    fs.mkdirSync(moduleRoot);
    const marker = path.join(fixtureRoot, 'module-marker.txt');
    fs.writeFileSync(path.join(moduleRoot, 'PTVStartupProbe.psm1'),
        "function Invoke-PTVStartupProbe { [IO.File]::WriteAllText($env:PTV_PS_MODULE_MARKER, 'injected') }; Export-ModuleMember -Function Invoke-PTVStartupProbe\n");
    const command = `
        $ErrorActionPreference='Stop'
        $tokens=$null; $errors=$null
        $ast=[Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'", "''")}',[ref]$tokens,[ref]$errors)
        if($errors.Count -ne 0){throw 'Wrapper did not parse'}
        $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Set-TrustedPSModulePath'},$true)
        if($null -eq $definition){throw 'PowerShell module path guard is absent'}
        . ([scriptblock]::Create($definition.Extent.Text))
        Set-TrustedPSModulePath
        if($env:PSModulePath.Contains('${fixtureRoot.replaceAll("'", "''")}')){throw 'Task module path remains'}
        try { Invoke-PTVStartupProbe; throw 'Task module autoloaded' }
        catch { if($_.Exception.Message -eq 'Task module autoloaded'){throw} }
        Write-Output 'Task module autoload denied'
    `;
    const result = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64')], {
        encoding: 'utf8', windowsHide: true, timeout: 15_000,
        env: { ...process.env, PSModulePath: [fixtureRoot, process.env.PSModulePath ?? ''].join(path.delimiter),
            PTV_PS_MODULE_MARKER: marker }
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(fs.existsSync(marker), false, 'task-written module autoloaded');
    const wrapper = fs.readFileSync(script, 'utf8');
    assert.ok(wrapper.indexOf('\nSet-TrustedPSModulePath\n') < wrapper.indexOf('$publisherRoot = Join-Path'));
    const hostGuard = wrapper.indexOf('\nAssert-TrustedPowerShellHost\n');
    assert.ok(hostGuard >= 0 && hostGuard < wrapper.indexOf('$publisherRoot = Join-Path'),
        'trusted PowerShell host must be checked before module-backed path commands');
});

test('known development installer lock conflict denies the publication observation', t => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptv-web-conflict-'));
    t.after(() => {
        if (path.dirname(fixtureRoot) === os.tmpdir()
            && path.basename(fixtureRoot).startsWith('ptv-web-conflict-')) {
            fs.rmSync(fixtureRoot, { recursive: true, force: true });
        }
    });
    const command = `
        $ErrorActionPreference='Stop'
        $tokens=$null; $errors=$null
        $ast=[Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'", "''")}',[ref]$tokens,[ref]$errors)
        if($errors.Count -ne 0){throw 'Wrapper did not parse'}
        $names=@('Assert-LocalPathHasNoReparsePoint','Test-KnownDeploymentConflict')
        $definitions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $names -contains $node.Name},$true))
        if($definitions.Count -ne 2){throw 'Conflict probe is absent'}
        . ([scriptblock]::Create(($definitions.Extent.Text -join [Environment]::NewLine)))
        $artifactRoot=$env:PTV_TEST_ROOT
        $lockDir=Join-Path $artifactRoot 'Reports\\Development\\JF_DEVELOPMENT_125'
        [void][IO.Directory]::CreateDirectory($lockDir)
        if(Test-KnownDeploymentConflict){throw 'Empty fixture is conflicted'}
        $lockPath=Join-Path $lockDir '.ptv-development-install.lock'
        [IO.File]::WriteAllBytes($lockPath,[byte[]]@())
        $held=[IO.File]::Open($lockPath,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        try { if(-not (Test-KnownDeploymentConflict)){throw 'Held installer lock was ignored'} }
        finally { $held.Dispose() }
        if(Test-KnownDeploymentConflict){throw 'Released fixture remains conflicted'}
    `;
    const result = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64')], {
        encoding: 'utf8', windowsHide: true, timeout: 15_000,
        env: { ...process.env, PTV_TEST_ROOT: fixtureRoot }
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
});

test('local identity requires the pinned process to own loopback and .125 listeners', () => {
    const command = `
        $ErrorActionPreference='Stop'
        $tokens=$null; $errors=$null
        $ast=[Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'", "''")}',[ref]$tokens,[ref]$errors)
        if($errors.Count -ne 0){throw 'Wrapper did not parse'}
        $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-Local125Identity'},$true)
        if($null -eq $definition){throw 'Local identity check is absent'}
        . ([scriptblock]::Create($definition.Extent.Text))
        function Get-NetIPAddress { [pscustomobject]@{IPAddress='10.16.0.125'} }
        function Get-CimInstance { [pscustomobject]@{
            ExecutablePath='C:\\Program Files\\Jellyfin\\Server\\jellyfin.exe'
            CommandLine='"C:\\Program Files\\Jellyfin\\Server\\jellyfin.exe" --datadir "C:\\JFData"'
            ProcessId=4242
        } }
        function Get-NetTCPConnection { return $script:testListeners }
        function Expect-Denied {
            try { Assert-Local125Identity; throw 'Unexpected identity success' }
            catch { if($_.Exception.Message -eq 'Unexpected identity success'){ throw } }
        }
        $script:testListeners=@([pscustomobject]@{LocalAddress='0.0.0.0';OwningProcess=4242})
        Assert-Local125Identity
        $script:testListeners=@(
            [pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=4242},
            [pscustomobject]@{LocalAddress='10.16.0.125';OwningProcess=4242})
        Assert-Local125Identity
        $script:testListeners=@(
            [pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=9999},
            [pscustomobject]@{LocalAddress='10.16.0.125';OwningProcess=4242})
        Expect-Denied
        $script:testListeners=@(
            [pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=4242},
            [pscustomobject]@{LocalAddress='10.16.0.125';OwningProcess=9999})
        Expect-Denied
        $script:testListeners=@([pscustomobject]@{LocalAddress='10.16.0.125';OwningProcess=4242})
        Expect-Denied
        $script:testListeners=@([pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=4242})
        Expect-Denied
    `;
    const result = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64')], {
        encoding: 'utf8', windowsHide: true, timeout: 15_000
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
});

test('recovery denies an approval that expires during the session probe', () => {
    const command = `
        $ErrorActionPreference='Stop'
        $tokens=$null; $errors=$null
        $ast=[Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'", "''")}',[ref]$tokens,[ref]$errors)
        if($errors.Count -ne 0){throw 'Wrapper did not parse'}
        $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-RecoveryFinalGate'},$true)
        if($null -eq $definition){throw 'Final recovery gate is absent'}
        . ([scriptblock]::Create($definition.Extent.Text))
        $approved=@{approvalSha256='a'*64;recoveryJournalSha256='b'*64;recoveryTransactionId='c'*32}
        $script:expired=$false
        function Invoke-ProtectedApprovalCheck {
            param([string]$Action,[switch]$RecoveryContinuation)
            if($script:expired){throw 'Maintenance window closed after session probe'}
            return $approved
        }
        $fresh=[pscustomobject]@{Passed=$true;ActivePlaybackCount=0;SessionCapturedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')}
        if(-not (Assert-RecoveryFinalGate -SessionResult $fresh -Continuation)){throw 'Fresh recovery gate denied'}
        $script:expired=$true
        try { Assert-RecoveryFinalGate -SessionResult $fresh -Continuation; throw 'Expired gate passed' }
        catch { if($_.Exception.Message -eq 'Expired gate passed'){throw} }
        $script:expired=$false
        $stale=[pscustomobject]@{Passed=$true;ActivePlaybackCount=0;SessionCapturedAtUtc=[DateTimeOffset]::UtcNow.AddSeconds(-31).ToString('o')}
        try { Assert-RecoveryFinalGate -SessionResult $stale -Continuation; throw 'Stale gate passed' }
        catch { if($_.Exception.Message -eq 'Stale gate passed'){throw} }
        Write-Output 'Recovery final gate checks passed.'
    `;
    const result = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64')], {
        encoding: 'utf8', windowsHide: true, timeout: 15_000
    });
    assert.equal(result.status, 0, JSON.stringify({ stderr: result.stderr, stdout: result.stdout, error: result.error?.message, signal: result.signal }));
});

test('publication denies approval revocation after the live observation', () => {
    const command = `
        $ErrorActionPreference='Stop'
        $tokens=$null; $errors=$null
        $ast=[Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'", "''")}',[ref]$tokens,[ref]$errors)
        if($errors.Count -ne 0){throw 'Wrapper did not parse'}
        $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-PublishFinalGate'},$true)
        if($null -eq $definition){throw 'Final publication gate is absent'}
        . ([scriptblock]::Create($definition.Extent.Text))
        $approved=@{approvalSha256='a'*64}
        $script:revoked=$false
        function Invoke-ProtectedApprovalCheck {
            param([string]$Action)
            if($script:revoked){throw 'Protected grant revoked during live observation'}
            return $approved
        }
        $fresh=[pscustomobject]@{Passed=$true;ActivePlaybackCount=0;SessionCapturedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')}
        if(-not (Assert-PublishFinalGate -SessionResult $fresh)){throw 'Fresh publication gate denied'}
        $script:revoked=$true
        try { Assert-PublishFinalGate -SessionResult $fresh; throw 'Revoked publication passed' }
        catch { if($_.Exception.Message -eq 'Revoked publication passed'){throw} }
        $script:revoked=$false
        $stale=[pscustomobject]@{Passed=$true;ActivePlaybackCount=0;SessionCapturedAtUtc=[DateTimeOffset]::UtcNow.AddSeconds(-31).ToString('o')}
        try { Assert-PublishFinalGate -SessionResult $stale; throw 'Stale publication passed' }
        catch { if($_.Exception.Message -eq 'Stale publication passed'){throw} }
        Write-Output 'Publication final gate checks passed.'
    `;
    const result = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64')], {
        encoding: 'utf8', windowsHide: true, timeout: 15_000
    });
    assert.equal(result.status, 0, JSON.stringify({ stderr: result.stderr, stdout: result.stdout, error: result.error?.message }));
});
