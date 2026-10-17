<# Pure evidence fixtures. No HTTP calls, registry writes, or Jellyfin paths. #>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'PTVWebPrepublicationGate.psm1') -Force

$script:passed = 0
$script:failed = 0
$now = [DateTimeOffset]::Parse('2026-10-17T18:00:00Z')
$serverId = 'c1858e3f2d09468fb546ad9cfe438283'
$indexHash = 'a' * 64

function New-Approval {
    return [ordered]@{
        schemaVersion = 1
        operatorApproved = $true
        taskId = 'PTV-WEB-075-TEST'
        environmentId = 'JF_DEVELOPMENT_125'
        operation = 'web-only-frozen-artifact-deployment'
        serverId = $serverId
        expiresAt = '2026-10-17T19:00:00Z'
        maintenanceWindowStartUtc = '2026-10-17T17:45:00Z'
        maintenanceWindowEndUtc = '2026-10-17T18:30:00Z'
        userImpactAttested = $true
        betaIsolationAttested = $true
        betaRouteBoundToExpectedServer = $true
        noUnapprovedAudience = $true
        betaRouteVerifiedAtUtc = '2026-10-17T17:59:40Z'
        maintenanceUserIds = @('11111111111111111111111111111111')
    }
}

function New-Observation {
    return [ordered]@{
        origin = 'http://127.0.0.1:8096'
        environmentId = 'JF_DEVELOPMENT_125'
        capturedAtUtc = '2026-10-17T17:59:55Z'
        system = [ordered]@{
            Id = $serverId
            ServerName = 'PTV Testing'
            Version = '12.2.0'
        }
        plugin = [ordered]@{ ok = $true; pluginVersion = '0.5.22.0' }
        web = [ordered]@{ version = '0.5.74'; indexSha256 = $indexHash }
        sessions = [ordered]@{
            authenticated = $true
            administrator = $true
            requesterUserId = '11111111111111111111111111111111'
            capturedAtUtc = '2026-10-17T17:59:55Z'
            recentActivityWindowSeconds = 960
            items = @(
                [ordered]@{
                    UserId = '11111111111111111111111111111111'
                    LastActivityDate = '2026-10-17T17:59:40Z'
                    IsActive = $true
                    NowPlayingItem = $null
                    PlayState = $null
                }
            )
        }
        betaIsolation = [ordered]@{
            verified = $true
            approvalTaskId = 'PTV-WEB-075-TEST'
            checkedAtUtc = '2026-10-17T17:59:40Z'
            routeBoundToExpectedServer = $true
            noUnapprovedAudience = $true
        }
        conflictingDeployment = $false
    }
}

function Copy-Data($Data) {
    return ($Data | ConvertTo-Json -Depth 20 | ConvertFrom-Json -AsHashtable)
}

function Invoke-Gate($Approval, $Observation) {
    $provider = { return $Observation }.GetNewClosure()
    return Test-PTVWebPrepublicationGate -ObservationProvider $provider -Approval $Approval `
        -ExpectedServerId $serverId -ExpectedBaselineIndexSha256 $indexHash -NowUtc $now
}

function Assert-Case([string]$Name, [scriptblock]$Edit, [bool]$ExpectedPass) {
    $approval = Copy-Data (New-Approval)
    $observation = Copy-Data (New-Observation)
    & $Edit $approval $observation
    $allowed = $false
    $failureMessage = ''
    try {
        $result = Invoke-Gate $approval $observation
        $allowed = $result.Passed -eq $true
    }
    catch {
        $failureMessage = $_.Exception.Message
    }
    if ($allowed -eq $ExpectedPass) {
        $script:passed++
        Write-Host "PASS $Name"
        return
    }
    $script:failed++
    Write-Host ("FAIL {0}: expected allowed={1}; actual allowed={2}; {3}" -f $Name, $ExpectedPass, $allowed, $failureMessage)
}

Assert-Case 'fresh direct-local authorized maintenance observation is accepted' { param($a, $o) } $true
Assert-Case 'operator UTC offset timestamps parsed as local DateTime are accepted' {
    param($a, $o)
    $a.expiresAt = ('{"t":"2026-10-17T19:00:00.0000000+00:00"}' | ConvertFrom-Json -AsHashtable).t
    $a.maintenanceWindowStartUtc = ('{"t":"2026-10-17T17:45:00.0000000+00:00"}' | ConvertFrom-Json -AsHashtable).t
    $a.maintenanceWindowEndUtc = ('{"t":"2026-10-17T18:30:00.0000000+00:00"}' | ConvertFrom-Json -AsHashtable).t
    $a.betaRouteVerifiedAtUtc = ('{"t":"2026-10-17T17:59:40.0000000+00:00"}' | ConvertFrom-Json -AsHashtable).t
} $true
Assert-Case 'server reached through production address is denied' { param($a, $o) $o.origin = 'http://10.16.0.50:8096' } $false
Assert-Case 'localhost alias is denied because it can resolve elsewhere' { param($a, $o) $o.origin = 'http://localhost:8096' } $false
Assert-Case 'wrong server identity is denied' { param($a, $o) $o.system.Id = 'other-server' } $false
Assert-Case 'wrong server version is denied' { param($a, $o) $o.system.Version = '10.11.8' } $false
Assert-Case 'wrong installed Web version is denied' { param($a, $o) $o.web.version = '0.5.75' } $false
Assert-Case 'wrong installed Web index hash is denied' { param($a, $o) $o.web.indexSha256 = 'b' * 64 } $false
Assert-Case 'wrong Plugin version is denied' { param($a, $o) $o.plugin.pluginVersion = '0.5.20.0' } $false
Assert-Case 'Plugin health failure is denied' { param($a, $o) $o.plugin.ok = $false } $false
Assert-Case 'unauthenticated sessions response is denied' { param($a, $o) $o.sessions.authenticated = $false } $false
Assert-Case 'non-admin sessions response is denied' { param($a, $o) $o.sessions.administrator = $false } $false
Assert-Case 'stale sessions response is denied' { param($a, $o) $o.sessions.capturedAtUtc = '2026-10-17T17:59:00Z' } $false
Assert-Case 'missing session list is denied' { param($a, $o) $o.sessions.Remove('items') } $false
Assert-Case 'active playback is denied, including paused playback' { param($a, $o) $o.sessions.items[0].NowPlayingItem = @{ Id = 'item' }; $o.sessions.items[0].PlayState = @{ IsPaused = $true } } $false
Assert-Case 'play-state evidence alone is denied' { param($a, $o) $o.sessions.items[0].PlayState = @{ IsPaused = $true } } $false
Assert-Case 'transcoding evidence alone is denied' { param($a, $o) $o.sessions.items[0].TranscodingInfo = @{ VideoCodec = 'h264' } } $false
Assert-Case 'recent non-maintenance session is denied' { param($a, $o) $o.sessions.items += @{ UserId = 'other'; LastActivityDate = '2026-10-17T17:59:59Z'; IsActive = $true; NowPlayingItem = $null; PlayState = $null } } $false
Assert-Case 'stale non-maintenance session marked active is denied' { param($a, $o) $o.sessions.items += @{ UserId = 'other'; LastActivityDate = '2026-10-17T17:30:00Z'; IsActive = $true; NowPlayingItem = $null; PlayState = $null } } $false
Assert-Case 'unknown session activity is denied' { param($a, $o) $o.sessions.items[0].LastActivityDate = $null } $false
Assert-Case 'missing session user is denied' { param($a, $o) $o.sessions.items[0].UserId = $null } $false
Assert-Case 'recent non-maintenance session marked inactive is still denied' { param($a, $o) $o.sessions.items += @{ UserId = 'other'; LastActivityDate = '2026-10-17T17:59:50Z'; IsActive = $false; NowPlayingItem = $null; PlayState = $null } } $false
Assert-Case 'missing optional IsActive is allowed for approved maintenance session' { param($a, $o) $o.sessions.items[0].Remove('IsActive') } $true
Assert-Case 'missing optional IsActive with recent other user is denied' { param($a, $o) $o.sessions.items += @{ UserId = 'other'; LastActivityDate = '2026-10-17T17:59:50Z'; NowPlayingItem = $null; PlayState = $null } } $false
Assert-Case 'missing optional IsActive with stale other user is allowed' { param($a, $o) $o.sessions.items += @{ UserId = 'other'; LastActivityDate = '2026-10-17T17:30:00Z'; NowPlayingItem = $null; PlayState = $null } } $true
Assert-Case 'malformed optional IsActive is denied' { param($a, $o) $o.sessions.items[0].IsActive = 'false' } $false
Assert-Case 'stale observation is denied' { param($a, $o) $o.capturedAtUtc = '2026-10-17T17:59:00Z' } $false
Assert-Case 'unverified Beta isolation is denied' { param($a, $o) $o.betaIsolation.verified = $false } $false
Assert-Case 'Beta attestation for another task is denied' { param($a, $o) $o.betaIsolation.approvalTaskId = 'other-task' } $false
Assert-Case 'stale Beta route proof is denied' { param($a, $o) $o.betaIsolation.checkedAtUtc = '2026-10-17T17:50:00Z' } $false
Assert-Case 'unapproved Beta audience is denied' { param($a, $o) $o.betaIsolation.noUnapprovedAudience = $false } $false
Assert-Case 'missing operator maintenance window is denied' { param($a, $o) $a.Remove('maintenanceWindowStartUtc') } $false
Assert-Case 'expired maintenance window is denied' { param($a, $o) $a.maintenanceWindowEndUtc = '2026-10-17T17:59:59Z' } $false
Assert-Case 'missing user-impact attestation is denied' { param($a, $o) $a.userImpactAttested = $false } $false
Assert-Case 'missing Beta attestation is denied' { param($a, $o) $a.betaIsolationAttested = $false } $false
Assert-Case 'protected Beta route binding is required' { param($a, $o) $a.betaRouteBoundToExpectedServer = $false } $false
Assert-Case 'protected Beta audience clearance is required' { param($a, $o) $a.noUnapprovedAudience = $false } $false
Assert-Case 'non-GUID maintenance identity is denied' { param($a, $o) $a.maintenanceUserIds = @('test-admin'); $o.sessions.requesterUserId = 'test-admin'; $o.sessions.items[0].UserId = 'test-admin' } $false
Assert-Case 'approval for another server is denied' { param($a, $o) $a.serverId = 'other-server' } $false
Assert-Case 'conflicting deployment is denied' { param($a, $o) $o.conflictingDeployment = $true } $false
Assert-Case 'unknown conflict status is denied' { param($a, $o) $o.Remove('conflictingDeployment') } $false

$approval = New-Approval
$observation = New-Observation
$secret = 'fixture-sensitive-token-never-print'
try {
    $provider = { throw $secret }.GetNewClosure()
    Test-PTVWebPrepublicationGate -ObservationProvider $provider -Approval $approval `
        -ExpectedServerId $serverId -ExpectedBaselineIndexSha256 $indexHash -NowUtc $now | Out-Null
    $script:failed++
    Write-Host 'FAIL provider exception was allowed'
}
catch {
    if ($_.Exception.Message.Contains($secret)) {
        $script:failed++
        Write-Host 'FAIL provider exception leaked sensitive content'
    }
    else {
        $script:passed++
        Write-Host 'PASS provider exception is redacted and denied'
    }
}

$responses = @{
    '/System/Info/Public' = '{"Id":"c1858e3f2d09468fb546ad9cfe438283","ServerName":"PTV Testing","Version":"12.2.0"}'
    '/Users/Me' = '{"Id":"11111111111111111111111111111111","Policy":{"IsAdministrator":true}}'
    '/Ptv/v1/status?full=false' = '{"ok":true,"pluginVersion":"0.5.22.0"}'
    '/Sessions' = '[{"UserId":"11111111111111111111111111111111","LastActivityDate":"2026-10-17T17:59:40Z","IsActive":true,"NowPlayingItem":null,"PlayState":null}]'
    '/web/index.html' = '<html>fixture-only</html>'
}
$calls = [Collections.Generic.List[string]]::new()
$requestProvider = {
    param($route, $authenticated)
    $calls.Add("$route|$authenticated")
    return ,([Text.Encoding]::UTF8.GetBytes($responses[$route]))
}.GetNewClosure()
try {
    $module = Get-Module PTVWebPrepublicationGate
    $collected = & $module {
        param($provider, $beta)
        Get-PTVWebLocalObservationCore -RequestProvider $provider -BaselineWebVersion '0.5.74' -BetaIsolationEvidence $beta -ConflictingDeployment $false
    } $requestProvider (New-Observation).betaIsolation
    $expectedCalls = '/System/Info/Public|False,/Users/Me|True,/Ptv/v1/status?full=false|True,/Sessions|True,/web/index.html|False'
    $expectedIndexHash = [Convert]::ToHexString(
        [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes('<html>fixture-only</html>'))
    ).ToLowerInvariant()
    if ($calls.Count -ne 5 -or [string]::Join(',', $calls) -cne $expectedCalls -or
        $collected.sessions.items.Count -ne 1 -or
        $collected.sessions.administrator -ne $true -or
        $collected.web.indexSha256 -cne $expectedIndexHash) {
        throw 'Collector did not preserve authenticated session evidence and exact local routes.'
    }
    $script:passed++
    Write-Host 'PASS collector uses direct-local routes and preserves complete session evidence'
}
catch {
    $script:failed++
    Write-Host ("FAIL collector fixture: {0}" -f $_.Exception.Message)
}

$badResponses = $responses.Clone()
$badResponses['/Sessions'] = '{}'
$badProvider = {
    param($route, $authenticated)
    return ,([Text.Encoding]::UTF8.GetBytes($badResponses[$route]))
}.GetNewClosure()
$collectorAllowedMalformed = $false
try {
    $module = Get-Module PTVWebPrepublicationGate
    & $module {
        param($provider, $beta)
        Get-PTVWebLocalObservationCore -RequestProvider $provider -BaselineWebVersion '0.5.74' -BetaIsolationEvidence $beta -ConflictingDeployment $false
    } $badProvider (New-Observation).betaIsolation | Out-Null
    $collectorAllowedMalformed = $true
}
catch {}
if ($collectorAllowedMalformed) {
    $script:failed++
    Write-Host 'FAIL collector accepted malformed Sessions payload'
}
else {
    $script:passed++
    Write-Host 'PASS collector denies malformed Sessions payload'
}

$dynamicNow = [DateTimeOffset]::UtcNow
$dynamicApproval = New-Approval
$dynamicApproval.expiresAt = $dynamicNow.AddHours(1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$dynamicApproval.maintenanceWindowStartUtc = $dynamicNow.AddMinutes(-1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$dynamicApproval.maintenanceWindowEndUtc = $dynamicNow.AddMinutes(30).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$dynamicApproval.betaRouteVerifiedAtUtc = $dynamicNow.AddSeconds(-1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$dynamicObservation = New-Observation
$dynamicObservation.betaIsolation.checkedAtUtc = $dynamicApproval.betaRouteVerifiedAtUtc
$delayedProvider = {
    Start-Sleep -Milliseconds 120
    $captured = [DateTimeOffset]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $dynamicObservation.capturedAtUtc = $captured
    $dynamicObservation.sessions.capturedAtUtc = $captured
    $dynamicObservation.sessions.items[0].LastActivityDate = $captured
    return $dynamicObservation
}.GetNewClosure()
try {
    $result = Test-PTVWebPrepublicationGate -ObservationProvider $delayedProvider -Approval $dynamicApproval -ExpectedServerId $serverId -ExpectedBaselineIndexSha256 $indexHash
    if ($result.Passed -ne $true) { throw 'Delayed fresh observation was denied.' }
    $script:passed++
    Write-Host 'PASS gate evaluates freshness after the live callback finishes'
}
catch {
    $script:failed++
    Write-Host ("FAIL delayed live observation: {0}" -f $_.Exception.Message)
}

Write-Host "PREPUBLICATION_GATE_FIXTURES: $script:passed passed, $script:failed failed"
if ($script:failed -ne 0) { exit 1 }
