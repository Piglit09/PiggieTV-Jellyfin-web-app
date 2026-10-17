<#
    Web-only pre-publication evidence gate. Its live collector contacts only
    127.0.0.1:8096, and the guarded deployer must invoke it anew for each gate
    check. Do not serialize credentials, sessions, user IDs, or the raw
    observation into transaction records.
#>
Set-StrictMode -Version Latest

function Get-GateField {
    param($Value, [string]$Name)
    if ($null -eq $Value) { return $null }
    if ($Value -is [System.Collections.IDictionary]) {
        if ($Value.Contains($Name)) { return ,$Value[$Name] }
        return $null
    }
    $property = $Value.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return ,$property.Value
}

function Deny-Gate {
    param([string]$Code)
    # Never concatenate external values or exception text: providers may contain
    # access tokens, private user names, paths, or server response bodies.
    throw "PTV Web pre-publication gate denied: $Code"
}

function Assert-Gate {
    param([bool]$Condition, [string]$Code)
    if (-not $Condition) { Deny-Gate $Code }
}

function Get-GateTime {
    param($Value, [string]$Code)
    # PowerShell ConvertFrom-Json materializes a +00:00 timestamp as a Local
    # DateTime on Windows. Preserve that instant when validating a protected
    # operator approval; reject timestamps without an offset/zone.
    if ($Value -is [DateTime]) {
        if ($Value.Kind -eq [DateTimeKind]::Unspecified) { Deny-Gate $Code }
        return [DateTimeOffset]::new($Value)
    }
    if ($Value -is [DateTimeOffset]) {
        if ($Value.Offset -ne [TimeSpan]::Zero) { Deny-Gate $Code }
        return $Value
    }
    if ($Value -isnot [string] -or
        $Value -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$') {
        Deny-Gate $Code
    }
    $parsed = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse(
        $Value,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AssumeUniversal,
        [ref]$parsed
    )) {
        Deny-Gate $Code
    }
    return $parsed.ToUniversalTime()
}

function Assert-GateFreshness {
    param($Value, [DateTimeOffset]$NowUtc, [int]$MaxAgeSeconds, [string]$Code)
    $time = Get-GateTime $Value $Code
    $age = ($NowUtc - $time).TotalSeconds
    Assert-Gate ($age -ge 0 -and $age -le $MaxAgeSeconds) $Code
    return $time
}

function Get-PTVWebLocalObservationCore {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$RequestProvider,
        [Parameter(Mandatory = $true)][string]$BaselineWebVersion,
        [Parameter(Mandatory = $true)]$BetaIsolationEvidence,
        [Parameter(Mandatory = $true)][bool]$ConflictingDeployment
    )
    function Read-LocalJson([string]$Route, [bool]$Authenticated) {
        try {
            $bytes = & $RequestProvider $Route $Authenticated
            if ($bytes -isnot [byte[]] -or $bytes.Length -eq 0) { Deny-Gate 'LOCAL_RESPONSE_INVALID' }
            $value = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json -AsHashtable -NoEnumerate -ErrorAction Stop
            if ($null -eq $value) { Deny-Gate 'LOCAL_RESPONSE_INVALID' }
            return ,$value
        }
        catch {
            Deny-Gate 'LOCAL_RESPONSE_INVALID'
        }
    }

    $system = Read-LocalJson '/System/Info/Public' $false
    $user = Read-LocalJson '/Users/Me' $true
    $plugin = Read-LocalJson '/Ptv/v1/status?full=false' $true
    # Ask for every session. A server-side recent filter could hide a paused
    # stream whose last activity timestamp is older than the display window.
    $sessions = Read-LocalJson '/Sessions' $true
    Assert-Gate ($sessions -is [array]) 'SESSIONS_LIST_INVALID'
    try {
        $indexBytes = & $RequestProvider '/web/index.html' $false
        Assert-Gate ($indexBytes -is [byte[]] -and $indexBytes.Length -gt 0) 'WEB_INDEX_UNAVAILABLE'
        $indexHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($indexBytes)).ToLowerInvariant()
    }
    catch {
        Deny-Gate 'WEB_INDEX_UNAVAILABLE'
    }

    $captured = [DateTimeOffset]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    return [ordered]@{
        origin = 'http://127.0.0.1:8096'
        environmentId = 'JF_DEVELOPMENT_125'
        capturedAtUtc = $captured
        system = $system
        plugin = $plugin
        web = [ordered]@{ version = $BaselineWebVersion; indexSha256 = $indexHash }
        sessions = [ordered]@{
            authenticated = $true
            administrator = (Get-GateField (Get-GateField $user 'Policy') 'IsAdministrator')
            requesterUserId = (Get-GateField $user 'Id')
            capturedAtUtc = $captured
            recentActivityWindowSeconds = 960
            items = $sessions
        }
        betaIsolation = $BetaIsolationEvidence
        conflictingDeployment = $ConflictingDeployment
    }
}

function Get-PTVWebLocalObservation {
    <#
      Collects a fresh direct-loopback HTTP observation. The Beta-route
      isolation proof and deployment-lock state must be supplied independently;
      this function does not infer either from zero active streams.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][Security.SecureString]$AccessToken,
        [Parameter(Mandatory = $true)][string]$BaselineWebVersion,
        [Parameter(Mandatory = $true)]$BetaIsolationEvidence,
        [Parameter(Mandatory = $true)][bool]$ConflictingDeployment
    )
    Assert-Gate ($null -ne $BetaIsolationEvidence) 'BETA_ISOLATION_UNVERIFIED'
    Assert-Gate ($BaselineWebVersion -ceq '0.5.74') 'WEB_BASELINE_MISMATCH'

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
        Assert-Gate (-not [string]::IsNullOrWhiteSpace($token)) 'ADMIN_TOKEN_UNAVAILABLE'
        $allowedRoutes = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($route in @('/System/Info/Public', '/Users/Me', '/Ptv/v1/status?full=false',
            '/Sessions', '/web/index.html')) {
            $null = $allowedRoutes.Add($route)
        }
        $requestProvider = {
            param($route, $authenticated)
            if (-not $allowedRoutes.Contains($route)) {
                throw 'Local route unapproved.'
            }
            $uri = [Uri]::new('http://127.0.0.1:8096' + $route)
            $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, $uri)
            $request.Headers.CacheControl = [Net.Http.Headers.CacheControlHeaderValue]::new()
            $request.Headers.CacheControl.NoCache = $true
            if ($authenticated) {
                $null = $request.Headers.TryAddWithoutValidation('X-Emby-Token', $token)
            }
            try {
                $response = $client.SendAsync($request).GetAwaiter().GetResult()
                try {
                    if ($response.StatusCode -ne [Net.HttpStatusCode]::OK) {
                        throw 'Local HTTP request failed.'
                    }
                    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
                    return ,$bytes
                }
                finally {
                    $response.Dispose()
                }
            }
            finally {
                $request.Dispose()
            }
        }.GetNewClosure()
        return Get-PTVWebLocalObservationCore -RequestProvider $requestProvider -BaselineWebVersion $BaselineWebVersion -BetaIsolationEvidence $BetaIsolationEvidence -ConflictingDeployment $ConflictingDeployment
    }
    catch {
        Deny-Gate 'LOCAL_OBSERVATION_FAILED'
    }
    finally {
        $token = $null
        if ($secretPtr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
        }
        $client.Dispose()
        $handler.Dispose()
    }
}

function Test-PTVWebPrepublicationGate {
    <#
      .SYNOPSIS
      Checks a newly collected .125 observation before staging or publication.
      .DESCRIPTION
      Each invocation calls ObservationProvider exactly once. The provider must
      read System/Info, Ptv/v1/status, the served Web index, Users/Me, and
      unfiltered admin Sessions from http://127.0.0.1:8096,
      with redirects and proxies disabled. It must return the complete
      observation shape exercised by fixture tests. It may retain an admin
      token as an in-memory SecureString; no token is accepted or emitted here.
      Separate governance verifies policy, artifact, target, and rollback.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][scriptblock]$ObservationProvider,
        [Parameter(Mandatory = $true)]$Approval,
        [Parameter(Mandatory = $true)][string]$ExpectedServerId,
        [Parameter(Mandatory = $true)][string]$ExpectedBaselineIndexSha256,
        [DateTimeOffset]$NowUtc = [DateTimeOffset]::UtcNow
    )

    Assert-Gate ($ExpectedServerId -cmatch '^[0-9a-f]{32}$') 'EXPECTED_SERVER_ID_INVALID'
    Assert-Gate ($ExpectedBaselineIndexSha256 -cmatch '^[0-9a-f]{64}$') 'EXPECTED_INDEX_HASH_INVALID'

    $taskId = Get-GateField $Approval 'taskId'
    Assert-Gate ((Get-GateField $Approval 'schemaVersion') -eq 1) 'APPROVAL_SCHEMA_INVALID'
    Assert-Gate ((Get-GateField $Approval 'operatorApproved') -is [bool] -and
        (Get-GateField $Approval 'operatorApproved') -eq $true) 'OPERATOR_APPROVAL_MISSING'
    Assert-Gate ($taskId -is [string] -and $taskId -cmatch '^[A-Za-z0-9][A-Za-z0-9._-]{3,127}$') 'APPROVAL_TASK_INVALID'
    Assert-Gate ((Get-GateField $Approval 'environmentId') -ceq 'JF_DEVELOPMENT_125') 'APPROVAL_TARGET_INVALID'
    Assert-Gate ((Get-GateField $Approval 'operation') -ceq 'web-only-frozen-artifact-deployment') 'APPROVAL_OPERATION_INVALID'
    Assert-Gate ((Get-GateField $Approval 'serverId') -ceq $ExpectedServerId) 'APPROVAL_SERVER_ID_MISMATCH'

    $expiry = Get-GateTime (Get-GateField $Approval 'expiresAt') 'APPROVAL_EXPIRY_INVALID'
    Assert-Gate ($expiry -gt $NowUtc -and ($expiry - $NowUtc).TotalHours -le 24) 'APPROVAL_EXPIRED'
    $windowStart = Get-GateTime (Get-GateField $Approval 'maintenanceWindowStartUtc') 'MAINTENANCE_WINDOW_INVALID'
    $windowEnd = Get-GateTime (Get-GateField $Approval 'maintenanceWindowEndUtc') 'MAINTENANCE_WINDOW_INVALID'
    Assert-Gate ($windowStart -le $NowUtc -and $windowEnd -ge $NowUtc -and
        $windowEnd -gt $windowStart -and ($windowEnd - $windowStart).TotalHours -le 2) 'MAINTENANCE_WINDOW_CLOSED'
    Assert-Gate ((Get-GateField $Approval 'userImpactAttested') -is [bool] -and
        (Get-GateField $Approval 'userImpactAttested') -eq $true) 'USER_IMPACT_UNATTESTED'
    Assert-Gate ((Get-GateField $Approval 'betaIsolationAttested') -is [bool] -and
        (Get-GateField $Approval 'betaIsolationAttested') -eq $true) 'BETA_ISOLATION_UNATTESTED'
    Assert-Gate ((Get-GateField $Approval 'betaRouteBoundToExpectedServer') -is [bool] -and
        (Get-GateField $Approval 'betaRouteBoundToExpectedServer') -eq $true) 'BETA_ROUTE_UNATTESTED'
    Assert-Gate ((Get-GateField $Approval 'noUnapprovedAudience') -is [bool] -and
        (Get-GateField $Approval 'noUnapprovedAudience') -eq $true) 'BETA_AUDIENCE_UNATTESTED'
    $approvedBetaTime = Assert-GateFreshness (Get-GateField $Approval 'betaRouteVerifiedAtUtc') $NowUtc 300 'BETA_ATTESTATION_STALE'
    $maintenanceIds = Get-GateField $Approval 'maintenanceUserIds'
    Assert-Gate ($maintenanceIds -is [array] -and $maintenanceIds.Count -gt 0) 'MAINTENANCE_USERS_MISSING'
    $approvedMaintenanceIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($id in $maintenanceIds) {
        Assert-Gate ($id -is [string] -and $id -match '^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$') 'MAINTENANCE_USER_INVALID'
        Assert-Gate ($approvedMaintenanceIds.Add($id)) 'MAINTENANCE_USER_DUPLICATE'
    }

    try {
        $observation = & $ObservationProvider
    }
    catch {
        Deny-Gate 'LIVE_PROBE_FAILED'
    }
    if (-not $PSBoundParameters.ContainsKey('NowUtc')) {
        # Network collection may finish after the initial clock read. Check
        # evidence freshness against completion time, not the invocation time.
        $NowUtc = [DateTimeOffset]::UtcNow
        Assert-Gate ($expiry -gt $NowUtc -and $windowStart -le $NowUtc -and
            $windowEnd -ge $NowUtc) 'APPROVAL_OR_WINDOW_EXPIRED_DURING_PROBE'
        Assert-Gate (($NowUtc - $approvedBetaTime).TotalSeconds -le 300) 'BETA_ATTESTATION_STALE'
    }
    Assert-Gate ($null -ne $observation -and $observation -isnot [array]) 'OBSERVATION_INVALID'
    Assert-Gate ((Get-GateField $observation 'origin') -ceq 'http://127.0.0.1:8096') 'DIRECT_LOCAL_ORIGIN_REQUIRED'
    Assert-Gate ((Get-GateField $observation 'environmentId') -ceq 'JF_DEVELOPMENT_125') 'OBSERVED_TARGET_INVALID'
    $null = Assert-GateFreshness (Get-GateField $observation 'capturedAtUtc') $NowUtc 30 'OBSERVATION_STALE'
    Assert-Gate ((Get-GateField $observation 'conflictingDeployment') -is [bool] -and
        (Get-GateField $observation 'conflictingDeployment') -eq $false) 'DEPLOYMENT_CONFLICT_UNVERIFIED'

    $system = Get-GateField $observation 'system'
    Assert-Gate ((Get-GateField $system 'Id') -ceq $ExpectedServerId -and
        (Get-GateField $system 'ServerName') -ceq 'PTV Testing' -and
        (Get-GateField $system 'Version') -ceq '12.2.0') 'SERVER_IDENTITY_MISMATCH'
    $plugin = Get-GateField $observation 'plugin'
    Assert-Gate ((Get-GateField $plugin 'ok') -is [bool] -and
        (Get-GateField $plugin 'ok') -eq $true -and
        (Get-GateField $plugin 'pluginVersion') -ceq '0.5.22.0') 'PLUGIN_BASELINE_MISMATCH'
    $web = Get-GateField $observation 'web'
    Assert-Gate ((Get-GateField $web 'version') -ceq '0.5.74' -and
        (Get-GateField $web 'indexSha256') -ceq $ExpectedBaselineIndexSha256) 'WEB_BASELINE_MISMATCH'

    $beta = Get-GateField $observation 'betaIsolation'
    Assert-Gate ((Get-GateField $beta 'verified') -is [bool] -and (Get-GateField $beta 'verified') -eq $true -and
        (Get-GateField $beta 'routeBoundToExpectedServer') -is [bool] -and (Get-GateField $beta 'routeBoundToExpectedServer') -eq $true -and
        (Get-GateField $beta 'noUnapprovedAudience') -is [bool] -and (Get-GateField $beta 'noUnapprovedAudience') -eq $true -and
        (Get-GateField $beta 'approvalTaskId') -ceq $taskId) 'BETA_ISOLATION_UNVERIFIED'
    $betaTime = Assert-GateFreshness (Get-GateField $beta 'checkedAtUtc') $NowUtc 300 'BETA_PROOF_STALE'
    Assert-Gate ($betaTime -eq $approvedBetaTime) 'BETA_PROOF_UNBOUND'

    $sessions = Get-GateField $observation 'sessions'
    Assert-Gate ((Get-GateField $sessions 'authenticated') -is [bool] -and
        (Get-GateField $sessions 'authenticated') -eq $true -and
        (Get-GateField $sessions 'administrator') -is [bool] -and
        (Get-GateField $sessions 'administrator') -eq $true) 'SESSIONS_NOT_ADMIN_AUTHENTICATED'
    $requesterUserId = Get-GateField $sessions 'requesterUserId'
    Assert-Gate ($requesterUserId -is [string] -and $approvedMaintenanceIds.Contains($requesterUserId)) 'SESSION_REQUESTER_UNAPPROVED'
    $null = Assert-GateFreshness (Get-GateField $sessions 'capturedAtUtc') $NowUtc 30 'SESSIONS_STALE'
    Assert-Gate ((Get-GateField $sessions 'recentActivityWindowSeconds') -eq 960) 'SESSION_WINDOW_UNVERIFIED'
    $items = Get-GateField $sessions 'items'
    Assert-Gate ($items -is [array]) 'SESSIONS_LIST_INVALID'
    foreach ($session in $items) {
        $userId = Get-GateField $session 'UserId'
        $active = Get-GateField $session 'IsActive'
        Assert-Gate ($userId -is [string] -and -not [string]::IsNullOrWhiteSpace($userId)) 'SESSION_IDENTITY_UNCERTAIN'
        # Jellyfin's SessionInfo declares IsActive optional. Use its true
        # value when present, but derive recent activity from the required
        # LastActivityDate rather than rejecting a valid omitted field.
        if ($null -ne $active) {
            Assert-Gate ($active -is [bool]) 'SESSION_ACTIVITY_UNCERTAIN'
        }
        $lastActivity = Get-GateTime (Get-GateField $session 'LastActivityDate') 'SESSION_ACTIVITY_UNCERTAIN'
        Assert-Gate ($lastActivity -le $NowUtc) 'SESSION_ACTIVITY_UNCERTAIN'
        # A paused stream still affects a user and must block publication.
        Assert-Gate ($null -eq (Get-GateField $session 'NowPlayingItem') -and
            $null -eq (Get-GateField $session 'PlayState') -and
            $null -eq (Get-GateField $session 'TranscodingInfo')) 'ACTIVE_PLAYBACK_PRESENT'
        $recent = ($NowUtc - $lastActivity).TotalSeconds -le 960
        if ($recent -or $active) {
            Assert-Gate ($approvedMaintenanceIds.Contains($userId)) 'NON_MAINTENANCE_USER_ACTIVE'
        }
    }

    return [pscustomobject]@{
        Passed = $true
        EnvironmentId = 'JF_DEVELOPMENT_125'
        CheckedAtUtc = $NowUtc.ToUniversalTime().ToString('o')
        ActivePlaybackCount = 0
        SessionsChecked = $items.Count
    }
}

Export-ModuleMember -Function Test-PTVWebPrepublicationGate, Get-PTVWebLocalObservation
