<#
  Web-only .125 publication entry point. No target path is caller-selectable.
  Protected approval lives outside source/artifacts and is read, never issued,
  by this process. Do not invoke without a separate operator decision.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$EnvironmentId,
    [Parameter(Mandatory)][string]$CandidateArchive,
    [Parameter(Mandatory)][string]$CandidateManifest,
    [Parameter(Mandatory)][string]$CandidateArtifactRoot,
    [Parameter(Mandatory)][string]$BaselineArchive,
    [Parameter(Mandatory)][string]$BaselineManifest,
    [Parameter(Mandatory)][string]$RollbackReference,
    [Parameter(Mandatory)][string]$ApprovalRecord,
    [Parameter(Mandatory)][string]$FrozenSourceCommit,
    [Security.SecureString]$AdminToken,
    [switch]$Recover
)

$ErrorActionPreference = 'Stop'
function Set-TrustedPSModulePath {
    # Ignore user and task-writable module directories before any command can
    # autoload NetTCPIP, CimCmdlets, or a PowerShell management module.
    $trustedRoots = @('C:\Program Files\PowerShell\7\Modules',
        'C:\Windows\System32\WindowsPowerShell\v1.0\Modules')
    [Environment]::SetEnvironmentVariable('PSModulePath',
        [string]::Join([IO.Path]::PathSeparator, $trustedRoots), 'Process')
}
function Assert-TrustedPowerShellHost {
    if ([IO.Path]::GetFullPath([Environment]::ProcessPath) -ine
        'C:\Program Files\PowerShell\7\pwsh.exe') {
        throw 'Protected Web publisher requires an independently installed PowerShell 7 host.'
    }
}
Set-TrustedPSModulePath
Set-StrictMode -Version Latest
if ($EnvironmentId -cne 'JF_DEVELOPMENT_125') { throw 'Only JF_DEVELOPMENT_125 is supported.' }
if ($null -eq $AdminToken) { throw 'A .125 administrator token is required for protected Web publication or recovery.' }
if ($FrozenSourceCommit -cnotmatch '^[0-9a-f]{40}$') { throw 'Frozen source commit is invalid.' }
Assert-TrustedPowerShellHost

$sourceRoot = 'C:\Users\Piggie\Documents\GitHub\Jellyfin-Web-PiggieTV'
$artifactRoot = 'C:\Users\Piggie\Documents\GitHub\_PTV-Artifacts'
$target = 'C:\Program Files\Jellyfin\Server\jellyfin-web'
$serverId = 'c1858e3f2d09468fb546ad9cfe438283'
$protectedRoot = 'C:\ProgramData\PiggieTV\WorkspaceAuthority'
$publisherRoot = Join-Path $protectedRoot 'WebPublisher'
$expectedScriptRoot = Join-Path $publisherRoot 'scripts'
$nodeExe = Join-Path $publisherRoot 'runtime\node.exe'
$transactionRoot = Join-Path $protectedRoot 'WebTransactions\JF_DEVELOPMENT_125'
$approvalTool = Join-Path $PSScriptRoot 'ptv-protected-web-approval.mjs'
$journalPath = Join-Path $transactionRoot 'transaction.json'

function Test-PrivilegedAclRecord {
    param([Parameter(Mandatory)][string]$OwnerSid,
        [Parameter(Mandatory)][array]$Aces,
        [switch]$ParentOnly,
        [switch]$TargetTree,
        [string]$OperatorSid)
    $privileged = @('S-1-5-18', 'S-1-5-32-544')
    if ($TargetTree) {
        if ([string]::IsNullOrWhiteSpace($OperatorSid) -or
            $OperatorSid -ceq 'S-1-5-21-9003605-1436556115-40747736-1001') {
            return $false
        }
        $privileged += 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
        $privileged += $OperatorSid
    }
    $writeMask = if ($ParentOnly) {
        [int64](0x40 -bor 0x10000 -bor 0x40000 -bor 0x80000 -bor
            0x40000000 -bor 0x10000000)
    } else {
        [int64](0x2 -bor 0x4 -bor 0x10 -bor 0x40 -bor 0x100 -bor
            0x10000 -bor 0x40000 -bor 0x80000 -bor
            0x40000000 -bor 0x10000000)
    }
    if ($OwnerSid -notin $privileged) { return $false }
    foreach ($ace in $Aces) {
        if ($ParentOnly -and $ace.InheritOnly) { continue }
        if ($TargetTree -and $ace.Sid -ceq 'S-1-3-0' -and $ace.InheritOnly) { continue }
        if ($ace.Type -ceq 'Allow' -and
            (([int64]$ace.Rights -band $writeMask) -ne 0) -and
            $ace.Sid -notin $privileged) { return $false }
    }
    return $true
}

function Get-PathAclRecord {
    param([Parameter(Mandatory)][string]$Path)
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    return [pscustomobject]@{
        OwnerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
        Aces = @($acl.Access | ForEach-Object {
            [pscustomobject]@{
                Sid = $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
                Type = $_.AccessControlType.ToString()
                Rights = [int64]$_.FileSystemRights
                InheritOnly = ($_.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0
            }
        })
    }
}

function Assert-PrivilegedPath {
    param([Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$ProtectedAncestor,
        [Parameter(Mandatory)][ValidateSet('Container', 'Leaf')][string]$Kind)
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $ancestor = [IO.Path]::GetFullPath($ProtectedAncestor).TrimEnd('\', '/')
    if ($full -ine $ancestor -and
        -not $full.StartsWith(($ancestor + '\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Protected deployment path is outside its pinned ancestor.'
    }
    $systemParent = 'C:\ProgramData'
    if ($ancestor -ine $systemParent -and
        -not $ancestor.StartsWith(($systemParent + '\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Protected deployment ancestor is outside ProgramData.'
    }
    $current = $full
    while ($true) {
        $expectedKind = if ($current -ieq $full) { $Kind } else { 'Container' }
        if (-not (Test-Path -LiteralPath $current -PathType $expectedKind)) {
            throw 'Required protected deployment path has not been provisioned.'
        }
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Protected deployment path contains a reparse point.'
        }
        $record = Get-PathAclRecord $current
        if (-not (Test-PrivilegedAclRecord -OwnerSid $record.OwnerSid -Aces $record.Aces `
            -ParentOnly:($current -ieq $systemParent))) {
            throw 'Protected deployment path is writable by a nonprivileged account.'
        }
        if ($current -ieq $systemParent) { break }
        $current = [IO.Path]::GetDirectoryName($current)
        if (-not $current) { throw 'Protected ProgramData ancestor was not reached.' }
    }
}

function Assert-TargetTreeProtected {
    $taskSid = 'S-1-5-21-9003605-1436556115-40747736-1001'
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if ($identity.User.Value -ceq $taskSid -or
        (-not $identity.IsSystem -and
            -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))) {
        throw 'Protected Web publication requires an independent privileged operator identity.'
    }
    foreach ($ancestor in @('C:\Program Files', 'C:\Program Files\Jellyfin',
        'C:\Program Files\Jellyfin\Server')) {
        $item = Get-Item -LiteralPath $ancestor -Force -ErrorAction Stop
        if (-not $item.PSIsContainer -or
            ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'The Web target ancestor is not a protected directory.'
        }
        $record = Get-PathAclRecord $ancestor
        if (-not (Test-PrivilegedAclRecord -OwnerSid $record.OwnerSid -Aces $record.Aces `
            -TargetTree -OperatorSid $identity.User.Value)) {
            throw 'A Web target ancestor permits nonprivileged mutation.'
        }
    }
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push([IO.Path]::GetFullPath($target))
    while ($pending.Count -gt 0) {
        $current = $pending.Pop()
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'The Web target tree contains a reparse point.'
        }
        $record = Get-PathAclRecord $current
        if (-not (Test-PrivilegedAclRecord -OwnerSid $record.OwnerSid -Aces $record.Aces `
            -TargetTree -OperatorSid $identity.User.Value)) {
            throw 'The Web target tree permits nonprivileged mutation.'
        }
        if ($item.PSIsContainer) {
            foreach ($child in [IO.Directory]::EnumerateFileSystemEntries($current)) {
                $pending.Push($child)
            }
        }
    }
}

function Assert-TrustedDeploymentRuntime {
    if ([IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\', '/') -ine
        [IO.Path]::GetFullPath($expectedScriptRoot).TrimEnd('\', '/')) {
        throw 'Protected Web publisher must run from the operator-owned script directory.'
    }
    foreach ($scriptName in @('deploy-ptv-web-protected.ps1',
        'PTVWebExactTree.psm1', 'PTVWebPrepublicationGate.psm1',
        'ptv-protected-web-approval.mjs', 'ptv-workspace-preflight.mjs',
        'ptv-artifact-manifest.mjs')) {
        Assert-PrivilegedPath -Path (Join-Path $PSScriptRoot $scriptName) `
            -ProtectedAncestor $protectedRoot -Kind Leaf
    }
    Assert-PrivilegedPath -Path $nodeExe -ProtectedAncestor $protectedRoot -Kind Leaf
    Assert-PrivilegedPath -Path $transactionRoot -ProtectedAncestor $protectedRoot -Kind Container
}

function Assert-Local125Identity {
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object { $_.IPAddress -ceq '10.16.0.125' })
    if ($addresses.Count -ne 1) { throw 'Registered .125 host address is absent or ambiguous.' }
    $processes = @(Get-CimInstance Win32_Process -Filter "Name='jellyfin.exe'" -ErrorAction Stop |
        Where-Object { $_.ExecutablePath -ieq 'C:\Program Files\Jellyfin\Server\jellyfin.exe' -and
            $_.CommandLine -match '--datadir\s+"?C:\\JFData"?(?:\s|$)' })
    if ($processes.Count -ne 1) { throw 'Pinned local Jellyfin process is absent or ambiguous.' }
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8096 -ErrorAction Stop |
        Where-Object { $_.LocalAddress -in @('127.0.0.1', '10.16.0.125', '0.0.0.0') })
    $loopback = @($listeners | Where-Object { $_.LocalAddress -in @('127.0.0.1', '0.0.0.0') })
    $development = @($listeners | Where-Object { $_.LocalAddress -in @('10.16.0.125', '0.0.0.0') })
    if ($loopback.Count -eq 0 -or $development.Count -eq 0 -or
        @($listeners | Where-Object { $_.OwningProcess -ne $processes[0].ProcessId }).Count -ne 0) {
        throw 'Pinned Jellyfin process does not exclusively own the loopback and .125 port 8096 listeners.'
    }
}

function Invoke-ProtectedApprovalCheck {
    param([ValidateSet('publish', 'recover')][string]$Action,
        [switch]$RecoveryContinuation)
    if ($RecoveryContinuation -and $Action -cne 'recover') {
        throw 'Only a separately approved recovery may refresh after journal mutation.'
    }
    $arguments = @($approvalTool,
        '--environment-id', $EnvironmentId,
        '--web-manifest', $CandidateManifest,
        '--web-artifact-root', $CandidateArtifactRoot,
        '--artifact-archive', $CandidateArchive,
        '--baseline-manifest', $BaselineManifest,
        '--baseline-archive', $BaselineArchive,
        '--rollback-reference', $RollbackReference,
        '--approval-record', $ApprovalRecord,
        '--frozen-source-commit', $FrozenSourceCommit,
        '--action', $Action)
    if ($Action -ceq 'recover') {
        $arguments += @('--recovery-journal', $journalPath)
        if ($RecoveryContinuation) {
            $arguments += @('--recovery-original-journal-sha', $approved.recoveryJournalSha256,
                '--recovery-original-approval-sha', $approved.approvalSha256)
        }
    }
    # Node startup variables can load task-written code before the protected
    # approval helper begins. Give every invocation a clean Node environment.
    $nodeEnvironment = @{}
    foreach ($name in @([Environment]::GetEnvironmentVariables('Process').Keys)) {
        if ([string]$name -like 'NODE_*') {
            $nodeEnvironment[[string]$name] = [Environment]::GetEnvironmentVariable([string]$name, 'Process')
            [Environment]::SetEnvironmentVariable([string]$name, $null, 'Process')
        }
    }
    try {
        $output = & $nodeExe @arguments 2>&1
        $approvalExitCode = $LASTEXITCODE
    }
    finally {
        foreach ($name in $nodeEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable([string]$name, [string]$nodeEnvironment[$name], 'Process')
        }
    }
    if ($approvalExitCode -ne 0) { throw 'Independent protected Web approval is absent, expired, or mismatched.' }
    try { $result = ($output -join [Environment]::NewLine) | ConvertFrom-Json -AsHashtable -ErrorAction Stop }
    catch { throw 'Protected Web approval returned invalid evidence.' }
    if ($result.environmentId -cne 'JF_DEVELOPMENT_125' -or
        $result.serverId -cne $serverId -or
        [IO.Path]::GetFullPath([string]$result.targetPath) -ine [IO.Path]::GetFullPath($target) -or
        $result.sourceCommit -cne $FrozenSourceCommit -or
        $result.authorizedAction -cne $Action -or
        $result.approvalSha256 -cnotmatch '^[0-9a-f]{64}$' -or
        $result.candidateArchiveSha256 -cnotmatch '^[0-9a-f]{64}$' -or
        $result.rollbackArchiveSha256 -cnotmatch '^[0-9a-f]{64}$' -or
        ($Action -ceq 'recover' -and
            ($result.recoveryJournalSha256 -cnotmatch '^[0-9a-f]{64}$' -or
                $result.recoveryTransactionId -cnotmatch '^[0-9a-f]{32}$'))) {
        throw 'Protected Web approval identity differs from the pinned .125 operation.'
    }
    return $result
}

function Read-ProtectedApproval {
    param([string]$ExpectedSha256)
    # The preceding Node check verifies Registry path/hash and file ACL. Keep
    # this object in memory only; never write user IDs or tokens to the journal.
    $bytes = [IO.File]::ReadAllBytes([IO.Path]::GetFullPath($ApprovalRecord))
    $actual = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
    if ($actual -cne $ExpectedSha256) { throw 'Protected approval changed after independent validation.' }
    return [Text.Encoding]::UTF8.GetString($bytes) |
        ConvertFrom-Json -AsHashtable -ErrorAction Stop
}

function Assert-RecoveryFinalGate {
    param([Parameter(Mandatory)]$SessionResult, [switch]$Continuation)
    if ($SessionResult.Passed -ne $true -or $SessionResult.ActivePlaybackCount -ne 0) {
        return $false
    }
    # The authenticated session request can take up to thirty seconds. Check
    # protected policy and the maintenance window again after it completes.
    $finalApproved = Invoke-ProtectedApprovalCheck 'recover' -RecoveryContinuation:$Continuation
    if ($finalApproved.approvalSha256 -cne $approved.approvalSha256 -or
        $finalApproved.recoveryJournalSha256 -cne $approved.recoveryJournalSha256 -or
        $finalApproved.recoveryTransactionId -cne $approved.recoveryTransactionId) {
        throw 'Recovery approval changed after the session observation.'
    }
    $sessionAt = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$SessionResult.SessionCapturedAtUtc, [ref]$sessionAt)) {
        throw 'Recovery session observation has no valid capture time.'
    }
    $ageSeconds = ([DateTimeOffset]::UtcNow - $sessionAt).TotalSeconds
    if ($ageSeconds -lt 0 -or $ageSeconds -gt 30) {
        throw 'Recovery session observation became stale before the write boundary.'
    }
    return $true
}

function Assert-PublishFinalGate {
    param([Parameter(Mandatory)]$SessionResult)
    if ($SessionResult.Passed -ne $true -or $SessionResult.ActivePlaybackCount -ne 0) {
        return $false
    }
    # The full local observation can outlive an approval or Registry grant.
    # Recheck the independent authority after collection, before target writes.
    $finalApproved = Invoke-ProtectedApprovalCheck 'publish'
    if ($finalApproved.approvalSha256 -cne $approved.approvalSha256) {
        throw 'Publication approval changed after the live observation.'
    }
    $sessionAt = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$SessionResult.SessionCapturedAtUtc, [ref]$sessionAt)) {
        throw 'Publication session observation has no valid capture time.'
    }
    $ageSeconds = ([DateTimeOffset]::UtcNow - $sessionAt).TotalSeconds
    if ($ageSeconds -lt 0 -or $ageSeconds -gt 30) {
        throw 'Publication session observation became stale before the write boundary.'
    }
    return $true
}

function Get-BaselineIndexHash {
    $manifest = Get-Content -LiteralPath $BaselineManifest -Raw -ErrorAction Stop |
        ConvertFrom-Json -AsHashtable -ErrorAction Stop
    $entry = @($manifest.files | Where-Object { $_.path -ceq 'index.html' })
    if ($entry.Count -ne 1 -or [string]$entry[0].sha256 -cnotmatch '^[0-9a-f]{64}$') {
        throw 'Baseline entry point is missing or ambiguous.'
    }
    return [string]$entry[0].sha256
}

function Assert-LocalPathHasNoReparsePoint {
    param([string]$Path)
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $entry = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'A known development deployment lock path contains a reparse point.'
            }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if (-not $parent -or $parent -ceq $current) { break }
        $current = $parent
    }
}

function Test-KnownDeploymentConflict {
    # The other maintained .125 installers use these exclusive file locks.
    # This is a fresh conflict probe, not a claim of global exclusivity: an
    # unrelated process can start later, so protected approval still binds
    # the residual race decision.
    $paths = @(
        (Join-Path $artifactRoot 'Reports\Development\JF_DEVELOPMENT_125\.ptv-development-install.lock'),
        (Join-Path $artifactRoot 'Reports\Acceptance\Web\2026-10-17-web075-deployment-enablement\transactions\JF_DEVELOPMENT_125\.ptv-web-exact-tree.lock')
    )
    foreach ($path in $paths) {
        Assert-LocalPathHasNoReparsePoint $path
        if (-not (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($path)) -PathType Container) -or
            -not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        try {
            $probe = [IO.File]::Open($path, [IO.FileMode]::Open,
                [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
            $probe.Dispose()
        }
        catch [IO.IOException] { return $true }
    }
    return $false
}

function Test-ServedIndexHash {
    param([string]$ExpectedSha256)
    if ($ExpectedSha256 -cnotmatch '^[0-9a-f]{64}$') { return $false }
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.UseProxy = $false
    $handler.UseCookies = $false
    $handler.UseDefaultCredentials = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(10)
    try {
        $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get,
            [Uri]::new('http://127.0.0.1:8096/web/index.html'))
        $request.Headers.CacheControl = [Net.Http.Headers.CacheControlHeaderValue]::new()
        $request.Headers.CacheControl.NoCache = $true
        try {
            $response = $client.SendAsync($request).GetAwaiter().GetResult()
            try {
                if ($response.StatusCode -ne [Net.HttpStatusCode]::OK) { return $false }
                $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
                $actual = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
                return $actual -ceq $ExpectedSha256
            }
            finally { $response.Dispose() }
        }
        finally { $request.Dispose() }
    }
    catch { return $false }
    finally { $client.Dispose(); $handler.Dispose() }
}

$null = Assert-TrustedDeploymentRuntime
$null = Assert-TargetTreeProtected
Import-Module (Join-Path $PSScriptRoot 'PTVWebExactTree.psm1') -Force -ErrorAction Stop
Import-Module (Join-Path $PSScriptRoot 'PTVWebPrepublicationGate.psm1') -Force -ErrorAction Stop

$action = if ($Recover) { 'recover' } else { 'publish' }
$approved = Invoke-ProtectedApprovalCheck $action
Assert-Local125Identity
$baselineIndexHash = Get-BaselineIndexHash
$baselineManifestHash = (Get-FileHash -LiteralPath $BaselineManifest -Algorithm SHA256).Hash.ToLowerInvariant()

$common = @{
    EnvironmentId = $EnvironmentId
    TargetPath = $target
    CandidateArchive = $CandidateArchive
    CandidateManifest = $CandidateManifest
    CandidateSha256 = $approved.candidateArchiveSha256
    BaselineArchive = $BaselineArchive
    BaselineManifest = $BaselineManifest
    BaselineSha256 = $approved.rollbackArchiveSha256
    ExpectedServerId = $serverId
    ExpectedBaselineManifestSha256 = $baselineManifestHash
    RollbackReference = $RollbackReference
    TransactionRoot = $transactionRoot
}

$servedVerifier = { param($expectedSha256) return [bool](Test-ServedIndexHash $expectedSha256) }.GetNewClosure()

if ($Recover) {
    if (-not (Test-Path -LiteralPath $journalPath -PathType Leaf)) {
        throw 'No interrupted exact-tree transaction exists for separately approved recovery.'
    }
    $recoveryCheck = {
        $currentApproved = Invoke-ProtectedApprovalCheck 'recover'
        if ($currentApproved.approvalSha256 -cne $approved.approvalSha256 -or
            $currentApproved.recoveryJournalSha256 -cne $approved.recoveryJournalSha256 -or
            $currentApproved.recoveryTransactionId -cne $approved.recoveryTransactionId) {
            throw 'Recovery approval changed while preparing the transaction.'
        }
        Assert-TargetTreeProtected
        Assert-Local125Identity
        if (Test-KnownDeploymentConflict) { throw 'A known .125 deployment is active.' }
        $currentApproval = Read-ProtectedApproval $currentApproved.approvalSha256
        $observationProvider = {
            Get-PTVWebLocalSessionObservation -AccessToken $AdminToken
        }.GetNewClosure()
        $result = Test-PTVWebSessionSafety -ObservationProvider $observationProvider `
            -ExpectedServerId $serverId -MaintenanceUserIds $currentApproval.maintenanceUserIds
        return [bool](Assert-RecoveryFinalGate -SessionResult $result)
    }.GetNewClosure()
    $recoveryRefreshCheck = {
        # The transaction journal changes during recovery. Revalidate the
        # protected Registry grant and original journal binding, then make a
        # fresh complete session observation immediately before each write.
        $currentApproved = Invoke-ProtectedApprovalCheck 'recover' -RecoveryContinuation
        if ($currentApproved.approvalSha256 -cne $approved.approvalSha256 -or
            $currentApproved.recoveryJournalSha256 -cne $approved.recoveryJournalSha256 -or
            $currentApproved.recoveryTransactionId -cne $approved.recoveryTransactionId) {
            throw 'Recovery approval changed during transaction continuation.'
        }
        Assert-TargetTreeProtected
        Assert-Local125Identity
        if (Test-KnownDeploymentConflict) { throw 'A known .125 deployment is active.' }
        $currentApproval = Read-ProtectedApproval $currentApproved.approvalSha256
        $observationProvider = {
            Get-PTVWebLocalSessionObservation -AccessToken $AdminToken
        }.GetNewClosure()
        $result = Test-PTVWebSessionSafety -ObservationProvider $observationProvider `
            -ExpectedServerId $serverId -MaintenanceUserIds $currentApproval.maintenanceUserIds
        return [bool](Assert-RecoveryFinalGate -SessionResult $result -Continuation)
    }.GetNewClosure()
    $result = Restore-PTVWebExactTreePublication @common -RecoveryCheck $recoveryCheck `
        -RecoveryRefreshCheck $recoveryRefreshCheck `
        -ServedIndexVerifier $servedVerifier
}
else {
    $publishCheck = {
        $currentApproved = Invoke-ProtectedApprovalCheck 'publish'
        if ($currentApproved.approvalSha256 -cne $approved.approvalSha256) {
            throw 'Publication approval changed while preparing the transaction.'
        }
        Assert-TargetTreeProtected
        Assert-Local125Identity
        $currentApproval = Read-ProtectedApproval $currentApproved.approvalSha256
        $betaProof = [ordered]@{
            verified = $currentApproval.betaIsolationAttested
            routeBoundToExpectedServer = $currentApproval.betaRouteBoundToExpectedServer
            noUnapprovedAudience = $currentApproval.noUnapprovedAudience
            approvalTaskId = $currentApproval.taskId
            checkedAtUtc = $currentApproval.betaRouteVerifiedAtUtc
        }
        $observationProvider = {
            Get-PTVWebLocalObservation -AccessToken $AdminToken `
                -BaselineWebVersion $approved.baselineVersion `
                -BetaIsolationEvidence $betaProof `
                -ConflictingDeployment:(Test-KnownDeploymentConflict)
        }.GetNewClosure()
        $result = Test-PTVWebPrepublicationGate -ObservationProvider $observationProvider `
            -Approval $currentApproval -ExpectedServerId $serverId `
            -ExpectedBaselineIndexSha256 $baselineIndexHash `
            -ExpectedBaselineWebVersion $approved.baselineVersion `
            -ExpectedPluginVersion $currentApproval.pluginVersion
        return [bool](Assert-PublishFinalGate -SessionResult $result)
    }.GetNewClosure()
    $result = Invoke-PTVWebExactTreePublication @common -PrePublishCheck $publishCheck `
        -ServedIndexVerifier $servedVerifier
}

if ($result.State -notin @('COMPLETE', 'ROLLED_BACK')) {
    throw 'Protected Web publication did not reach a terminal state.'
}
[pscustomobject]@{
    environmentId = $EnvironmentId
    state = $result.State
    transactionId = $result.TransactionId
    taskId = $approved.taskId
    candidateVersion = $approved.candidateVersion
} | ConvertTo-Json -Compress
