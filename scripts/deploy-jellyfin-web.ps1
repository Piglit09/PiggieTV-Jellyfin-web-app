#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$EnvironmentId,

    [Parameter(Mandatory = $true)]
    [string]$Artifact,

    [Parameter(Mandatory = $true)]
    [string]$ArtifactManifest,

    [Parameter(Mandatory = $true)]
    [string]$ApprovalRecord,

    [Parameter(Mandatory = $true)]
    [string]$RollbackReference,

    [switch]$Recover
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# This entrypoint publishes only the signed-off Web 0.5.75 ZIP to the existing
# .125 installation. There is intentionally no caller-supplied target path.
$expected = [ordered]@{
    EnvironmentId = 'JF_DEVELOPMENT_125'
    TargetPath = 'C:\Program Files\Jellyfin\Server\jellyfin-web'
    SourceCommit = '965c89bcdf6a1c74b0b7c1389c81fa71ed29a5f9'
    SourceTree = '3e159973fcbdd0962caa62fcaa4505117e180e2f'
    ServerId = 'c1858e3f2d09468fb546ad9cfe438283'
    ArchiveSha256 = 'f88c5b7755f1f0f84a015e880a8e123b2cd78c3d790bfc2d6ad68ce2104059a5'
    ManifestDigest = '3135ca667e38f18e81d8ed68fa1d1b70d5eb35bf7875bfd7a9ef5f8b2484ed4e'
    ManifestSha256 = 'cab8438e078294c0dd54f53d3db652b3f5d1f7298a021e71096b12d434f3fc95'
    BaselineSha256 = '8e99cdca2703ba6d472731a06eeef0deec7c7816a48559ee5db0451a60e30d9b'
    BaselineIndexSha256 = '3c1d3fd09cedc892c193c6c5169bddb6b3ed1627d260551c2335fd40497a072b'
    RollbackReferenceSha256 = '9cb54a9d6338059d049d63f8db2c9cdde1e521cdbbfc4dc4e0416fabef056ce7'
}

$artifactRoot = 'C:\Users\Piggie\Documents\GitHub\_PTV-Artifacts'
$expected.ArchivePath = Join-Path $artifactRoot 'Builds\Web\web-0.5.75-965c89bc-frozen-20261017.zip'
$expected.ManifestPath = Join-Path $artifactRoot 'Reports\Acceptance\Web\2026-10-16-issue-33-home-shelf\web-0.5.75-965c89bc-dist-manifest.json'
$expected.BaselineArchive = Join-Path $artifactRoot 'Archive\Recovery-Bundles\web-0.5.74-dc96f1c-125-current-20261017.zip'
$expected.BaselineManifest = Join-Path $artifactRoot 'Manifests\Web\dc96f1c36099675d5e527cf441fd4929a9b324fe-0.5.74-artifact-manifest.json'
$expected.RollbackReference = Join-Path $artifactRoot 'Reports\Acceptance\Web\2026-10-17-web075-deployment-enablement\web-075-125-rollback-reference-v2.json'
$transactionRoot = Join-Path $artifactRoot 'Reports\Acceptance\Web\2026-10-17-web075-deployment-enablement\transactions\JF_DEVELOPMENT_125'
$stageParent = Join-Path $artifactRoot 'Builds\Web\Staging'
$stagePath = $null

function Assert-SamePath {
    param([string]$Actual, [string]$Pinned, [string]$Label)
    if ([IO.Path]::GetFullPath($Actual) -ine [IO.Path]::GetFullPath($Pinned)) {
        throw "$Label differs from the approved PTV Web 0.5.75 deployment path."
    }
}

function Assert-NoReparsePoint {
    param([string]$Path)
    $current = [IO.Path]::GetFullPath($Path)
    while (-not [string]::IsNullOrWhiteSpace($current)) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Deployment path contains a reparse point: $current"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -ceq $current) { break }
        $current = $parent
    }
}

function Assert-Hash {
    param([string]$Path, [string]$Sha256, [string]$Label)
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Sha256) {
        throw "$Label SHA-256 differs from its signed-off value."
    }
}

function Assert-RecoveryJournalBinding {
    param([string]$JournalPath, [string]$ReviewedSha256, [string]$TransactionId)
    if ($ReviewedSha256 -cnotmatch '^[0-9a-f]{64}$' -or
        $TransactionId -cnotmatch '^[0-9a-f]{32}$' -or
        -not (Test-Path -LiteralPath $JournalPath -PathType Leaf)) {
        throw 'Protected recovery journal binding is incomplete.'
    }
    $item = Get-Item -LiteralPath $JournalPath -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Protected recovery journal path is a reparse point.'
    }
    $actual = (Get-FileHash -LiteralPath $JournalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -cne $ReviewedSha256) {
        throw 'Interrupted transaction journal changed after operator approval.'
    }
    $journal = Get-Content -LiteralPath $JournalPath -Raw -ErrorAction Stop |
        ConvertFrom-Json -AsHashtable -ErrorAction Stop
    if ($journal.transactionId -cne $TransactionId) {
        throw 'Interrupted transaction journal ID changed after operator approval.'
    }
    return $journal
}

if ($EnvironmentId -cne $expected.EnvironmentId) {
    throw 'Only registered JF_DEVELOPMENT_125 is permitted by this deployment entrypoint.'
}

Assert-SamePath $Artifact $expected.ArchivePath 'Frozen artifact path'
Assert-SamePath $ArtifactManifest $expected.ManifestPath 'Approved candidate manifest path'
Assert-SamePath $RollbackReference $expected.RollbackReference 'Approved rollback reference path'

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$preflightScript = Join-Path $PSScriptRoot 'ptv-workspace-preflight.mjs'
$exactTreeModule = Join-Path $PSScriptRoot 'PTVWebExactTree.psm1'
$sessionGateModule = Join-Path $PSScriptRoot 'PTVWebPrepublicationGate.psm1'
foreach ($file in @($preflightScript, $exactTreeModule, $sessionGateModule, $expected.ArchivePath,
        $expected.ManifestPath, $expected.BaselineArchive, $expected.BaselineManifest,
        $expected.RollbackReference, $ApprovalRecord)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required deployment evidence is missing: $file" }
    Assert-NoReparsePoint $file
}
Assert-NoReparsePoint $stageParent
Assert-NoReparsePoint $transactionRoot
Assert-NoReparsePoint $expected.TargetPath

Assert-Hash $expected.ArchivePath $expected.ArchiveSha256 'Frozen candidate archive'
Assert-Hash $expected.ManifestPath $expected.ManifestSha256 'Frozen candidate manifest'
Assert-Hash $expected.BaselineArchive $expected.BaselineSha256 'Web-only rollback archive'
Assert-Hash $expected.RollbackReference $expected.RollbackReferenceSha256 'Candidate-bound rollback reference'

Import-Module -Name $exactTreeModule -ErrorAction Stop
Import-Module -Name $sessionGateModule -ErrorAction Stop

function Invoke-WorkspacePreflight {
    param([string]$StagedRoot)
    Push-Location -LiteralPath $repositoryRoot
    try {
        $arguments = @($preflightScript, 'deploy', '--project', 'PTV_WEB',
            '--environment-id', $EnvironmentId,
            '--artifact-manifest', $expected.ManifestPath,
            '--artifact-archive', $expected.ArchivePath,
            '--artifact-root', $StagedRoot,
            '--frozen-source-commit', $expected.SourceCommit,
            '--approval-record', $ApprovalRecord,
            '--rollback-reference', $expected.RollbackReference)
        $output = & node @arguments 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Protected deployment preflight rejected the operation: $($output -join [Environment]::NewLine)"
        }
        try { $result = ($output -join [Environment]::NewLine) | ConvertFrom-Json -AsHashtable -ErrorAction Stop }
        catch { throw 'Protected deployment preflight returned invalid JSON.' }
        $manifest = Get-Content -LiteralPath $expected.ManifestPath -Raw -ErrorAction Stop |
            ConvertFrom-Json -AsHashtable -ErrorAction Stop
        if ($result.environmentId -cne $expected.EnvironmentId -or
            [string]::IsNullOrWhiteSpace([string]$result.targetPath) -or
            [IO.Path]::GetFullPath([string]$result.targetPath) -ine [IO.Path]::GetFullPath($expected.TargetPath) -or
            $result.sourceCommit -cne $expected.SourceCommit -or
            $result.sourceTree -cne $expected.SourceTree -or
            $result.archiveSha256 -cne $expected.ArchiveSha256 -or
            $result.artifactManifestDigest -cne $expected.ManifestDigest -or
            $manifest.manifestDigest -cne $expected.ManifestDigest -or
            $manifest.sourceCommit -cne $expected.SourceCommit -or
            $manifest.sourceDirty -ne $false -or
            $manifest.sourceVersions.web -cne '0.5.75' -or
            $manifest.sourceVersions.plugin -cne '0.5.22.0' -or
            $result.approvalIdentity.serverId -cne $expected.ServerId -or
            [string]::IsNullOrWhiteSpace([string]$result.approvalIdentity.taskId)) {
            throw 'Protected preflight result differs from the approved frozen artifact or .125 target.'
        }
        Assert-NoReparsePoint $result.targetPath
        return $result
    }
    finally { Pop-Location }
}

function Assert-TransactionAvailable {
    if (-not (Test-Path -LiteralPath $transactionRoot -PathType Container)) {
        [void][IO.Directory]::CreateDirectory($transactionRoot)
    }
    Assert-NoReparsePoint $transactionRoot
    $journalPath = Join-Path $transactionRoot 'transaction.json'
    if (Test-Path -LiteralPath $journalPath) {
        Assert-NoReparsePoint $journalPath
        $journal = Get-Content -LiteralPath $journalPath -Raw -ErrorAction Stop |
            ConvertFrom-Json -AsHashtable -ErrorAction Stop
        if ($journal.state -notin @('COMPLETE', 'ROLLED_BACK')) {
            throw 'An interrupted Web publication requires a separately approved recovery operation.'
        }
    }
    $lockPath = Join-Path $transactionRoot '.ptv-web-exact-tree.lock'
    Assert-NoReparsePoint $lockPath
    try { $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch { throw 'A conflicting Web publication currently holds the transaction lock.' }
    $lock.Dispose()
}

function Assert-RecoverableTransaction {
    param([switch]$SkipLockProbe)
    if (-not (Test-Path -LiteralPath $transactionRoot -PathType Container)) {
        throw 'No approved interrupted Web transaction exists to recover.'
    }
    Assert-NoReparsePoint $transactionRoot
    $journalPath = Join-Path $transactionRoot 'transaction.json'
    if (-not (Test-Path -LiteralPath $journalPath -PathType Leaf)) {
        throw 'No approved interrupted Web transaction journal exists to recover.'
    }
    Assert-NoReparsePoint $journalPath
    $journal = Get-Content -LiteralPath $journalPath -Raw -ErrorAction Stop |
        ConvertFrom-Json -AsHashtable -ErrorAction Stop
    if ($journal.transactionId -notmatch '^[0-9a-f]{32}$' -or
        $journal.state -notin @('PREFLIGHT', 'STAGED', 'READY_TO_PUBLISH',
            'PUBLISHING', 'VERIFYING', 'ROLLBACK_REQUIRED', 'FAILED_RECOVERY') -or
        $journal.environmentId -cne $expected.EnvironmentId -or
        $journal.candidateSourceCommit -cne $expected.SourceCommit -or
        $journal.candidateArchiveSha256 -cne $expected.ArchiveSha256 -or
        $journal.baselineArchiveSha256 -cne $expected.BaselineSha256) {
        throw 'Interrupted journal is outside the approved frozen Web transaction.'
    }
    if (-not $SkipLockProbe) {
        $lockPath = Join-Path $transactionRoot '.ptv-web-exact-tree.lock'
        Assert-NoReparsePoint $lockPath
        try { $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
        catch { throw 'Another Web publication or recovery currently holds the transaction lock.' }
        $lock.Dispose()
    }
    return $journal
}

function Test-FreshLiveGate {
    param($Approval, [Security.SecureString]$Token)
    $betaEvidence = [ordered]@{
        verified = $Approval.betaIsolationAttested
        routeBoundToExpectedServer = $Approval.betaRouteBoundToExpectedServer
        noUnapprovedAudience = $Approval.noUnapprovedAudience
        approvalTaskId = $Approval.taskId
        checkedAtUtc = $Approval.betaRouteVerifiedAtUtc
    }
    # The initial call verifies no existing transaction. The publisher itself
    # holds the exclusive transaction lock when it invokes this callback.
    $observationProvider = {
        Get-PTVWebLocalObservation -AccessToken $Token -BaselineWebVersion '0.5.74' `
            -BetaIsolationEvidence $betaEvidence -ConflictingDeployment:$false
    }.GetNewClosure()
    $result = Test-PTVWebPrepublicationGate -ObservationProvider $observationProvider `
        -Approval $Approval -ExpectedServerId $expected.ServerId `
        -ExpectedBaselineIndexSha256 $expected.BaselineIndexSha256
    if ($result.Passed -ne $true -or $result.ActivePlaybackCount -ne 0) {
        throw 'Fresh .125 Beta-user and zero-stream publication gate failed.'
    }
    return $true
}

function Test-RecoveryEvidence {
    param($Approval, $Observation, [string]$ExpectedServerId, [string]$TransactionId,
        [DateTimeOffset]$NowUtc = [DateTimeOffset]::UtcNow)

    function Get-Utc([object]$Value) {
        if ($Value -is [DateTimeOffset]) { return $Value.ToUniversalTime() }
        if ($Value -is [DateTime]) {
            if ($Value.Kind -eq [DateTimeKind]::Unspecified) { throw 'Recovery evidence time lacks a zone.' }
            return [DateTimeOffset]::new($Value).ToUniversalTime()
        }
        if ($Value -isnot [string] -or
            $Value -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$') {
            throw 'Recovery evidence contains an invalid UTC timestamp.'
        }
        return [DateTimeOffset]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture).ToUniversalTime()
    }
    function Assert-Fresh([object]$Value, [int]$MaxAgeSeconds) {
        $date = Get-Utc $Value
        if ($date -gt $NowUtc -or ($NowUtc - $date).TotalSeconds -gt $MaxAgeSeconds) {
            throw 'Recovery evidence is stale or future-dated.'
        }
        return $date
    }

    if ($ExpectedServerId -cnotmatch '^[0-9a-f]{32}$' -or
        $TransactionId -cnotmatch '^[0-9a-f]{32}$' -or
        $Approval.schemaVersion -ne 1 -or $Approval.operatorApproved -ne $true -or
        $Approval.environmentId -cne 'JF_DEVELOPMENT_125' -or
        $Approval.operation -cne 'web-only-frozen-artifact-deployment' -or
        $Approval.serverId -cne $ExpectedServerId -or
        $Approval.recoveryAuthorized -isnot [bool] -or $Approval.recoveryAuthorized -ne $true -or
        $Approval.recoveryTransactionId -cne $TransactionId -or
        $Approval.userImpactAttested -ne $true -or
        $Approval.betaIsolationAttested -ne $true -or
        $Approval.betaRouteBoundToExpectedServer -ne $true -or
        $Approval.noUnapprovedAudience -ne $true) {
        throw 'Protected operator approval does not authorize this exact recovery.'
    }
    $windowStart = Get-Utc $Approval.maintenanceWindowStartUtc
    $windowEnd = Get-Utc $Approval.maintenanceWindowEndUtc
    $expires = Get-Utc $Approval.expiresAt
    $betaTime = Assert-Fresh $Approval.betaRouteVerifiedAtUtc 300
    if ($windowStart -gt $NowUtc -or $windowEnd -lt $NowUtc -or
        $windowEnd -le $windowStart -or ($windowEnd - $windowStart).TotalHours -gt 2 -or
        $expires -le $NowUtc -or ($expires - $NowUtc).TotalHours -gt 24) {
        throw 'Protected recovery approval or maintenance window is not current.'
    }
    $maintenanceIds = @($Approval.maintenanceUserIds)
    if ($maintenanceIds.Count -eq 0) { throw 'Protected recovery approval lacks maintenance users.' }
    $allowedUsers = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($id in $maintenanceIds) {
        if ($id -isnot [string] -or $id -notmatch '^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$' -or
            -not $allowedUsers.Add($id)) {
            throw 'Protected recovery maintenance user proof is invalid.'
        }
    }
    if ($null -eq $Observation -or
        $Observation.origin -cne 'http://127.0.0.1:8096' -or
        $Observation.environmentId -cne 'JF_DEVELOPMENT_125' -or
        $Observation.conflictingDeployment -isnot [bool] -or
        $Observation.conflictingDeployment -ne $false -or
        $Observation.system.Id -cne $ExpectedServerId -or
        $Observation.system.ServerName -cne 'PTV Testing' -or
        $Observation.system.Version -cne '12.2.0' -or
        $Observation.plugin.ok -isnot [bool] -or $Observation.plugin.ok -ne $true -or
        $Observation.plugin.pluginVersion -cne '0.5.22.0') {
        throw 'Direct .125 recovery server or Plugin observation is invalid.'
    }
    [void](Assert-Fresh $Observation.capturedAtUtc 30)
    $beta = $Observation.betaIsolation
    if ($beta.verified -ne $true -or
        $beta.routeBoundToExpectedServer -ne $true -or
        $beta.noUnapprovedAudience -ne $true -or
        $beta.approvalTaskId -cne $Approval.taskId -or
        (Get-Utc $beta.checkedAtUtc) -ne $betaTime) {
        throw 'Recovery Beta-route isolation is unverified.'
    }
    $sessions = $Observation.sessions
    if ($sessions.authenticated -ne $true -or $sessions.administrator -ne $true -or
        -not $allowedUsers.Contains([string]$sessions.requesterUserId) -or
        $sessions.recentActivityWindowSeconds -ne 960 -or
        $sessions.items -isnot [array]) {
        throw 'Recovery session observation is not administrator-authenticated.'
    }
    [void](Assert-Fresh $sessions.capturedAtUtc 30)
    foreach ($session in $sessions.items) {
        $userId = [string]$session.UserId
        $lastActivity = Get-Utc $session.LastActivityDate
        if ([string]::IsNullOrWhiteSpace($userId) -or $lastActivity -gt $NowUtc -or
            ($null -ne $session.IsActive -and $session.IsActive -isnot [bool]) -or
            $null -ne $session.NowPlayingItem -or $null -ne $session.PlayState -or
            $null -ne $session.TranscodingInfo) {
            throw 'Recovery is denied while playback or uncertain sessions exist.'
        }
        if ((($NowUtc - $lastActivity).TotalSeconds -le 960 -or $session.IsActive -eq $true) -and
            -not $allowedUsers.Contains($userId)) {
            throw 'Recovery is denied while an unapproved Beta user is active.'
        }
    }
    # A partly published transaction may have either Web index, or neither;
    # recovery must not forge the baseline index to satisfy a deploy gate.
    return $true
}

function Get-PTVWebRecoveryObservation {
    param([Security.SecureString]$AccessToken, $Approval)
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.UseProxy = $false
    $handler.UseCookies = $false
    $handler.UseDefaultCredentials = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(10)
    $secretPtr = [IntPtr]::Zero
    $token = $null
    try {
        $secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($AccessToken)
        $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
        if ([string]::IsNullOrWhiteSpace($token)) { throw 'Recovery administrator token is empty.' }
        function Read-RecoveryJson([string]$Route, [bool]$Authenticated) {
            if ($Route -notin @('/System/Info/Public', '/Users/Me', '/Ptv/v1/status?full=false', '/Sessions')) {
                throw 'Unapproved recovery observation route.'
            }
            $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get,
                [Uri]::new('http://127.0.0.1:8096' + $Route))
            $request.Headers.CacheControl = [Net.Http.Headers.CacheControlHeaderValue]::new()
            $request.Headers.CacheControl.NoCache = $true
            if ($Authenticated) { [void]$request.Headers.TryAddWithoutValidation('X-Emby-Token', $token) }
            try {
                $response = $client.SendAsync($request).GetAwaiter().GetResult()
                try {
                    if ($response.StatusCode -ne [Net.HttpStatusCode]::OK) {
                        throw 'Direct .125 recovery observation failed.'
                    }
                    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
                    $value = [Text.Encoding]::UTF8.GetString($bytes) |
                        ConvertFrom-Json -AsHashtable -NoEnumerate -ErrorAction Stop
                    return ,$value
                }
                finally { $response.Dispose() }
            }
            finally { $request.Dispose() }
        }
        $system = Read-RecoveryJson '/System/Info/Public' $false
        $user = Read-RecoveryJson '/Users/Me' $true
        $plugin = Read-RecoveryJson '/Ptv/v1/status?full=false' $true
        $sessions = Read-RecoveryJson '/Sessions' $true
        $captured = [DateTimeOffset]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        return [ordered]@{
            origin = 'http://127.0.0.1:8096'
            environmentId = 'JF_DEVELOPMENT_125'
            capturedAtUtc = $captured
            system = $system
            plugin = $plugin
            sessions = [ordered]@{
                authenticated = $true
                administrator = $user.Policy.IsAdministrator
                requesterUserId = $user.Id
                capturedAtUtc = $captured
                recentActivityWindowSeconds = 960
                items = $sessions
            }
            betaIsolation = [ordered]@{
                verified = $Approval.betaIsolationAttested
                routeBoundToExpectedServer = $Approval.betaRouteBoundToExpectedServer
                noUnapprovedAudience = $Approval.noUnapprovedAudience
                approvalTaskId = $Approval.taskId
                checkedAtUtc = $Approval.betaRouteVerifiedAtUtc
            }
            conflictingDeployment = $false
        }
    }
    catch { throw 'Direct .125 recovery observation could not be verified.' }
    finally {
        $token = $null
        if ($secretPtr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
        }
        $client.Dispose()
        $handler.Dispose()
    }
}

function Test-ServedIndex {
    param([string]$ExpectedSha256)
    if ($ExpectedSha256 -notmatch '^[0-9a-f]{64}$') { throw 'Expected served-index hash is invalid.' }
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.UseProxy = $false
    $handler.UseCookies = $false
    $handler.UseDefaultCredentials = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(10)
    try {
        function Read-DirectLocalBytes([string]$Route) {
            $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get,
                [Uri]::new('http://127.0.0.1:8096' + $Route))
            $request.Headers.CacheControl = [Net.Http.Headers.CacheControlHeaderValue]::new()
            $request.Headers.CacheControl.NoCache = $true
            try {
                $response = $client.SendAsync($request).GetAwaiter().GetResult()
                try {
                    if ($response.StatusCode -ne [Net.HttpStatusCode]::OK) {
                        throw 'Direct .125 post-publication HTTP verification failed.'
                    }
                    return ,$response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
                }
                finally { $response.Dispose() }
            }
            finally { $request.Dispose() }
        }
        $systemBytes = Read-DirectLocalBytes '/System/Info/Public'
        $system = [Text.Encoding]::UTF8.GetString($systemBytes) | ConvertFrom-Json -AsHashtable -ErrorAction Stop
        if ($system.Id -cne $expected.ServerId -or $system.Version -cne '12.2.0' -or
            $system.ServerName -cne 'PTV Testing') {
            throw 'Direct post-publication Jellyfin server identity changed.'
        }
        $indexBytes = Read-DirectLocalBytes '/web/index.html'
        $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($indexBytes)).ToLowerInvariant()
        if ($hash -cne $ExpectedSha256) { throw 'Direct .125 served index differs from the approved package.' }
        return $true
    }
    finally { $client.Dispose(); $handler.Dispose() }
}

try {
    if (-not (Test-Path -LiteralPath $stageParent -PathType Container)) {
        [void][IO.Directory]::CreateDirectory($stageParent)
    }
    Assert-NoReparsePoint $stageParent
    $stagePath = Join-Path $stageParent ('web-075-' + [guid]::NewGuid().ToString('N'))
    $staged = Stage-PTVWebVerifiedArtifact -ArchivePath $expected.ArchivePath `
        -ManifestPath $expected.ManifestPath -ExpectedSha256 $expected.ArchiveSha256 `
        -StageRoot $stagePath -ForbiddenTargetRoot $expected.TargetPath
    if ($staged.SourceCommit -cne $expected.SourceCommit -or
        $staged.ArchiveSha256 -cne $expected.ArchiveSha256 -or
        $staged.ManifestSha256 -cne $expected.ManifestSha256 -or
        $staged.FileCount -ne 2652) {
        throw 'Staged candidate differs from the frozen approved package.'
    }

    $preflight = Invoke-WorkspacePreflight -StagedRoot $staged.StagePath
    $approval = Get-Content -LiteralPath $ApprovalRecord -Raw -ErrorAction Stop |
        ConvertFrom-Json -AsHashtable -ErrorAction Stop
    $approvalHash = (Get-FileHash -LiteralPath $ApprovalRecord -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($approval.taskId -cne $preflight.approvalIdentity.taskId -or
        $approval.serverId -cne $preflight.approvalIdentity.serverId -or
        $approval.betaRouteVerifiedAtUtc -cne $preflight.approvalIdentity.betaRouteVerifiedAtUtc) {
        throw 'Protected approval changed after deployment preflight.'
    }
    $recoveryJournal = $null
    if ($Recover) {
        if ($preflight.approvalIdentity.recoveryAuthorized -ne $true -or
            $preflight.approvalIdentity.recoveryTransactionId -cne $approval.recoveryTransactionId -or
            $preflight.approvalIdentity.recoveryTransactionJournalSha256 -notmatch '^[0-9a-f]{64}$') {
            throw 'Protected policy does not bind this exact reviewed recovery journal.'
        }
        $journalPath = Join-Path $transactionRoot 'transaction.json'
        [void](Assert-RecoveryJournalBinding -JournalPath $journalPath `
            -ReviewedSha256 $preflight.approvalIdentity.recoveryTransactionJournalSha256 `
            -TransactionId $preflight.approvalIdentity.recoveryTransactionId)
        $recoveryJournal = Assert-RecoverableTransaction
        if ($approval.recoveryAuthorized -ne $true -or
            $approval.recoveryTransactionId -cne $recoveryJournal.transactionId -or
            $preflight.approvalIdentity.recoveryTransactionId -cne $recoveryJournal.transactionId) {
            throw 'A separate protected operator recovery approval for this transaction is required.'
        }
    }
    else {
        if ($approval.recoveryAuthorized -eq $true -or $null -ne $approval.recoveryTransactionId -or
            $preflight.approvalIdentity.recoveryAuthorized -eq $true) {
            throw 'A recovery-only approval cannot authorize a new Web publication.'
        }
        Assert-TransactionAvailable
    }
    $adminToken = Read-Host -AsSecureString 'Enter the local .125 Jellyfin administrator API token'
    if ($null -eq $adminToken) { throw 'The in-memory .125 administrator token is required.' }
    if ($Recover) {
        $recoveryObservation = Get-PTVWebRecoveryObservation -AccessToken $adminToken -Approval $approval
        [void](Test-RecoveryEvidence -Approval $approval -Observation $recoveryObservation `
            -ExpectedServerId $expected.ServerId -TransactionId $recoveryJournal.transactionId)
    }
    else { [void](Test-FreshLiveGate -Approval $approval -Token $adminToken) }

    $servedIndexCheck = { param($hash) Test-ServedIndex -ExpectedSha256 $hash }.GetNewClosure()
    if ($Recover) {
        $recoveryCheck = {
            $again = Invoke-WorkspacePreflight -StagedRoot $staged.StagePath
            Assert-Hash $expected.ArchivePath $expected.ArchiveSha256 'Frozen candidate archive'
            Assert-Hash $expected.ManifestPath $expected.ManifestSha256 'Frozen candidate manifest'
            Assert-Hash $expected.BaselineArchive $expected.BaselineSha256 'Web-only rollback archive'
            Assert-Hash $expected.RollbackReference $expected.RollbackReferenceSha256 'Candidate-bound rollback reference'
            Assert-Hash $ApprovalRecord $approvalHash 'Protected recovery approval'
            if ($again.approvalIdentity.taskId -cne $approval.taskId -or
                $again.approvalIdentity.betaRouteVerifiedAtUtc -cne $approval.betaRouteVerifiedAtUtc -or
                $again.approvalIdentity.recoveryTransactionId -cne $recoveryJournal.transactionId -or
                $again.approvalIdentity.recoveryTransactionJournalSha256 -cne `
                    $preflight.approvalIdentity.recoveryTransactionJournalSha256) {
                throw 'Protected recovery approval changed during rollback.'
            }
            [void](Assert-RecoveryJournalBinding -JournalPath (Join-Path $transactionRoot 'transaction.json') `
                -ReviewedSha256 $again.approvalIdentity.recoveryTransactionJournalSha256 `
                -TransactionId $again.approvalIdentity.recoveryTransactionId)
            $currentJournal = Assert-RecoverableTransaction -SkipLockProbe
            if ($currentJournal.transactionId -cne $recoveryJournal.transactionId) {
                throw 'Interrupted transaction identity changed during recovery.'
            }
            $observation = Get-PTVWebRecoveryObservation -AccessToken $adminToken -Approval $approval
            [void](Test-RecoveryEvidence -Approval $approval -Observation $observation `
                -ExpectedServerId $expected.ServerId -TransactionId $currentJournal.transactionId)
            return $true
        }.GetNewClosure()
        $result = Restore-PTVWebExactTreePublication -EnvironmentId $EnvironmentId `
            -TargetPath $preflight.targetPath -CandidateArchive $expected.ArchivePath `
            -CandidateManifest $expected.ManifestPath -CandidateSha256 $expected.ArchiveSha256 `
            -BaselineArchive $expected.BaselineArchive -BaselineManifest $expected.BaselineManifest `
            -BaselineSha256 $expected.BaselineSha256 -RollbackReference $expected.RollbackReference `
            -TransactionRoot $transactionRoot -RecoveryCheck $recoveryCheck `
            -ServedIndexVerifier $servedIndexCheck
        if ($result.State -cne 'ROLLED_BACK') { throw 'Protected Web recovery did not complete.' }
        [void](Test-ServedIndex -ExpectedSha256 $expected.BaselineIndexSha256)
        Write-Host "Verified Web-only recovery on $EnvironmentId; transaction $($result.TransactionId)."
        return
    }

    $prePublishCheck = {
        $again = Invoke-WorkspacePreflight -StagedRoot $staged.StagePath
        Assert-Hash $expected.ArchivePath $expected.ArchiveSha256 'Frozen candidate archive'
        Assert-Hash $expected.ManifestPath $expected.ManifestSha256 'Frozen candidate manifest'
        Assert-Hash $expected.BaselineArchive $expected.BaselineSha256 'Web-only rollback archive'
        Assert-Hash $expected.RollbackReference $expected.RollbackReferenceSha256 'Candidate-bound rollback reference'
        Assert-Hash $ApprovalRecord $approvalHash 'Protected operator approval'
        if ($again.approvalIdentity.taskId -cne $approval.taskId -or
            $again.approvalIdentity.betaRouteVerifiedAtUtc -cne $approval.betaRouteVerifiedAtUtc) {
            throw 'Protected operator approval changed during publication.'
        }
        [void](Test-FreshLiveGate -Approval $approval -Token $adminToken)
        return $true
    }.GetNewClosure()
    $result = Invoke-PTVWebExactTreePublication -EnvironmentId $EnvironmentId `
        -TargetPath $preflight.targetPath -CandidateArchive $expected.ArchivePath `
        -CandidateManifest $expected.ManifestPath -CandidateSha256 $expected.ArchiveSha256 `
        -BaselineArchive $expected.BaselineArchive -BaselineManifest $expected.BaselineManifest `
        -BaselineSha256 $expected.BaselineSha256 -RollbackReference $expected.RollbackReference `
        -TransactionRoot $transactionRoot -PrePublishCheck $prePublishCheck `
        -ServedIndexVerifier $servedIndexCheck
    if ($result.State -cne 'COMPLETE') { throw 'Web publication did not complete.' }
    Write-Host "Verified exact-tree Web deployment on $EnvironmentId; transaction $($result.TransactionId)."
}
finally {
    # Only this invocation's transient stage is removed. Never clean the
    # historical archive, registered target, or another transaction's files.
    if ($null -ne $stagePath -and (Test-Path -LiteralPath $stagePath)) {
        $parent = [IO.Path]::GetFullPath($stageParent).TrimEnd('\') + '\'
        $owned = [IO.Path]::GetFullPath($stagePath)
        if (-not $owned.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Transient stage escaped the approved artifact staging directory.'
        }
        Assert-NoReparsePoint $stagePath
        Remove-Item -LiteralPath $stagePath -Recurse -Force -ErrorAction Stop
    }
}
