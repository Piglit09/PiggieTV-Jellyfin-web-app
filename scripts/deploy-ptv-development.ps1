#requires -Version 7.0
<# Standing, component-scoped installer for the disposable PTV Testing server.
   Protected deployment authority comes only from ptv-workspace-preflight.mjs.
   This script never accepts a destination path or contacts production. #>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$EnvironmentId,
    [string]$WebArtifactRoot,
    [string]$WebManifest,
    [string]$PluginArtifactRoot,
    [string]$PluginManifest,
    [string]$FrozenSourceCommit,
    [Security.SecureString]$AdminToken,
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($EnvironmentId -cne 'JF_DEVELOPMENT_125') { throw 'Only JF_DEVELOPMENT_125 is supported.' }
$web = -not [string]::IsNullOrWhiteSpace($WebArtifactRoot) -or -not [string]::IsNullOrWhiteSpace($WebManifest)
$plugin = -not [string]::IsNullOrWhiteSpace($PluginArtifactRoot) -or -not [string]::IsNullOrWhiteSpace($PluginManifest)
if (-not $web -and -not $plugin) { throw 'At least one complete Web or Plugin component pair is required.' }
if ($web -and ([string]::IsNullOrWhiteSpace($WebArtifactRoot) -or [string]::IsNullOrWhiteSpace($WebManifest))) {
    throw 'Web component pair requires WebArtifactRoot and WebManifest.'
}
if ($plugin -and ([string]::IsNullOrWhiteSpace($PluginArtifactRoot) -or [string]::IsNullOrWhiteSpace($PluginManifest))) {
    throw 'Plugin component pair requires PluginArtifactRoot and PluginManifest.'
}
if ($FrozenSourceCommit -and $FrozenSourceCommit -cnotmatch '^[0-9a-f]{40}$') { throw 'Frozen source commit is invalid.' }
if ($plugin -and -not $VerifyOnly -and $null -eq $AdminToken) {
    throw 'Plugin installation requires a .125 administrator token for graceful shutdown and restart.'
}

$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$artifactRoot = 'C:\Users\Piggie\Documents\GitHub\_PTV-Artifacts'
$webTarget = 'C:\Program Files\Jellyfin\Server\jellyfin-web'
$pluginTarget = 'C:\JFData\plugins\PiggieTV_Plugin (testing)'
$expectedServerId = 'c1858e3f2d09468fb546ad9cfe438283'
$baselineWebManifest = Join-Path $artifactRoot 'Manifests\Web\dc96f1c36099675d5e527cf441fd4929a9b324fe-0.5.74-artifact-manifest.json'
$currentWebManifest = Join-Path $artifactRoot 'Manifests\Web\development-125-current.json'
$runRoot = Join-Path $artifactRoot 'Reports\Development\JF_DEVELOPMENT_125'
$pluginStageParent = Join-Path $artifactRoot 'Builds\Plugin\Staging'

function Assert-Same([string]$Actual, [string]$Expected, [string]$Label) {
    if ([IO.Path]::GetFullPath($Actual) -ine [IO.Path]::GetFullPath($Expected)) { throw "$Label differs from PTV Testing." }
}
function Assert-NoReparse([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Development path contains a reparse point.' }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if (-not $parent -or $parent -ceq $cursor) { break }
        $cursor = $parent
    }
}
function Get-LocalJellyfinProcess {
    $running = @(Get-CimInstance Win32_Process -Filter "Name='jellyfin.exe'" -ErrorAction Stop |
        Where-Object { $_.ExecutablePath -ieq 'C:\Program Files\Jellyfin\Server\jellyfin.exe' -and
            $_.CommandLine -match '--datadir\s+"?C:\\JFData"?(?:\s|$)' })
    if ($running.Count -ne 1) { throw 'Expected one pinned local Jellyfin process.' }
    $listener = @(Get-NetTCPConnection -State Listen -LocalPort 8096 -ErrorAction Stop |
        Where-Object { $_.OwningProcess -eq $running[0].ProcessId })
    if ($listener.Count -eq 0) { throw 'Pinned Jellyfin process does not own port 8096.' }
    return $running[0]
}
function Get-LocalBytes([string]$Route, [string]$Method = 'GET', [bool]$Authenticated = $false) {
    if ($Route -notin @('/System/Info/Public', '/Users/Me', '/Sessions', '/Ptv/v1/status?full=false',
        '/Plugins', '/System/Shutdown', '/web/index.html')) { throw 'Unexpected local smoke route.' }
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method),
        [Uri]::new('http://127.0.0.1:8096' + $Route))
    try {
        $request.Headers.CacheControl = [Net.Http.Headers.CacheControlHeaderValue]::new()
        $request.Headers.CacheControl.NoCache = $true
        if ($Authenticated) {
            if ([string]::IsNullOrWhiteSpace($script:tokenText) -or $script:tokenText -match '[\r\n"]') {
                throw 'The .125 administrator token has an invalid header format.'
            }
            if (-not $request.Headers.TryAddWithoutValidation('Authorization',
                ('MediaBrowser Token="' + $script:tokenText + '"'))) {
                throw 'Cannot set the Jellyfin 12.2 Authorization header.'
            }
        }
        $response = $script:http.SendAsync($request).GetAwaiter().GetResult()
        try {
            if (-not $response.IsSuccessStatusCode) { throw "Local $Route returned HTTP $([int]$response.StatusCode)." }
            return ,$response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        }
        finally { $response.Dispose() }
    }
    finally { $request.Dispose() }
}
function Get-LocalJson([string]$Route, [bool]$Authenticated = $false) {
    $bytes = Get-LocalBytes $Route 'GET' $Authenticated
    return [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json -ErrorAction Stop
}
function Assert-ServerIdentity {
    $system = Get-LocalJson '/System/Info/Public'
    if ($system.Id -cne $expectedServerId -or $system.ServerName -cne 'PTV Testing' -or $system.Version -cne '12.2.0') {
        throw 'Local Jellyfin identity differs from registered PTV Testing.'
    }
    return $system
}
function Assert-AdminIdentity {
    $user = Get-LocalJson '/Users/Me' $true
    if ($user.Policy.IsAdministrator -ne $true) { throw 'Development smoke token is not a Jellyfin administrator.' }
}
function Get-SessionWarning {
    try {
        $sessions = @(Get-LocalJson '/Sessions' $true)
        $active = @($sessions | Where-Object { $_.IsActive -eq $true -or $null -ne $_.NowPlayingItem })
        return "Development install may interrupt $($active.Count) active session(s); continuing."
    }
    catch { return 'Development install may interrupt active sessions; session inventory unavailable, continuing.' }
}
function Assert-JellyfinStopped {
    $processes = @(Get-CimInstance Win32_Process -Filter "Name='jellyfin.exe'" -ErrorAction Stop)
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8096 -ErrorAction SilentlyContinue)
    if ($processes.Count -ne 0 -or $listeners.Count -ne 0) {
        throw 'The development Jellyfin server is not fully stopped.'
    }
}
function Stop-OnlyJellyfin([int]$OldPid) {
    # The installed Windows tray launches this exact server command; it does not
    # automatically relaunch on process exit. See the official tray source:
    # https://github.com/jellyfin/jellyfin-server-windows/blob/master/Jellyfin.Windows.Tray/TrayApplicationContext.cs
    try { [void](Get-LocalBytes '/System/Shutdown' 'POST' $true) }
    catch [Net.Http.HttpRequestException] { } # The accepted shutdown can close its own connection.
    catch [System.Threading.Tasks.TaskCanceledException] { }
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(90)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        Start-Sleep -Seconds 1
        try {
            Assert-JellyfinStopped
            return
        }
        catch { }
    }
    if (Get-Process -Id $OldPid -ErrorAction SilentlyContinue) {
        throw 'Pinned Jellyfin process did not shut down gracefully within 90 seconds.'
    }
    throw 'Jellyfin shutdown left another process or port 8096 listener active.'
}
function Start-OnlyJellyfin([int]$OldPid) {
    Assert-JellyfinStopped
    $started = [DateTimeOffset]::UtcNow
    $launched = Start-Process -FilePath 'C:\Program Files\Jellyfin\Server\jellyfin.exe' `
        -ArgumentList '--datadir "C:\JFData"' -WorkingDirectory 'C:\Program Files\Jellyfin\Server' `
        -WindowStyle Hidden -PassThru
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(150)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        Start-Sleep -Seconds 2
        try {
            $process = Get-LocalJellyfinProcess
            if ($process.ProcessId -eq $launched.Id -and $process.ProcessId -ne $OldPid) {
                [void](Assert-ServerIdentity)
                return $started
            }
        }
        catch { }
    }
    throw 'Development Jellyfin did not return with the launched PID and pinned identity within 150 seconds.'
}
function Assert-PluginInitialized([string]$ExpectedVersion, [DateTimeOffset]$RestartAt) {
    $status = Get-LocalJson '/Ptv/v1/status?full=false' $true
    if ($status.ok -ne $true -or $status.pluginVersion -cne $ExpectedVersion) {
        throw 'Authenticated Plugin status version or health differs from candidate.'
    }
    $plugins = @(Get-LocalJson '/Plugins' $true)
    $active = @($plugins | Where-Object { $_.Name -eq 'PiggieTV' -and
        ([string]$_.Version -eq $ExpectedVersion) -and $_.Status -in @('Active', 0) })
    if ($active.Count -ne 1) { throw 'Jellyfin Plugin inventory does not show one active candidate.' }
    $dll = Join-Path $pluginTarget 'Jellyfin.Plugin.PiggieTV.dll'
    if (([Reflection.AssemblyName]::GetAssemblyName($dll)).Version.ToString() -cne $ExpectedVersion) {
        throw 'Installed Plugin DLL version differs from candidate.'
    }
    $meta = Get-Content -LiteralPath (Join-Path $pluginTarget 'meta.json') -Raw | ConvertFrom-Json
    if ($meta.version -cne $ExpectedVersion) { throw 'Installed Plugin metadata version differs from candidate.' }
    $logFiles = @(Get-ChildItem -LiteralPath 'C:\JFData\log' -Filter 'log_*.log' -File -ErrorAction Stop |
        Where-Object { $_.LastWriteTimeUtc -ge $RestartAt.UtcDateTime.AddMinutes(-1) })
    $pluginLines = 0
    $pluginErrors = 0
    foreach ($file in $logFiles) {
        foreach ($line in Get-Content -LiteralPath $file.FullName -Tail 5000) {
            if ($line -notmatch '^\[(?<stamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)? [+-]\d{2}:\d{2})\]') { continue }
            $stamp = [DateTimeOffset]::MinValue
            if (-not [DateTimeOffset]::TryParse($Matches.stamp, [ref]$stamp) -or $stamp -lt $RestartAt) { continue }
            if ($line -match 'PiggieTV') {
                $pluginLines++
                if ($line -match '\[(?:ERR|FTL)\]') { $pluginErrors++ }
            }
        }
    }
    if ($pluginLines -eq 0 -or $pluginErrors -gt 0) { throw 'Plugin initialization log is absent or contains an error.' }
    return [pscustomobject]@{ status = 'PASS'; pluginLogLines = $pluginLines; pluginErrors = $pluginErrors }
}
function Get-RecentLogSummary([DateTimeOffset]$Since) {
    $errors = 0
    $checked = 0
    foreach ($file in @(Get-ChildItem -LiteralPath 'C:\JFData\log' -Filter 'log_*.log' -File -ErrorAction Stop |
        Where-Object { $_.LastWriteTimeUtc -ge $Since.UtcDateTime.AddMinutes(-1) })) {
        foreach ($line in Get-Content -LiteralPath $file.FullName -Tail 5000) {
            if ($line -notmatch '^\[(?<stamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)? [+-]\d{2}:\d{2})\]') { continue }
            $stamp = [DateTimeOffset]::MinValue
            if (-not [DateTimeOffset]::TryParse($Matches.stamp, [ref]$stamp) -or $stamp -lt $Since) { continue }
            $checked++
            if ($line -match '\[(?:ERR|FTL)\]') { $errors++ }
        }
    }
    return [pscustomobject]@{ status = if ($errors -eq 0) { 'PASS' } else { 'WARN' };
        checkedLines = $checked; errors = $errors }
}
function Remove-OwnedTransaction([string]$Path) {
    $parent = [IO.Path]::GetFullPath($pluginStageParent).TrimEnd('\') + '\'
    $full = [IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase) -or
        -not [IO.Path]::GetFileName($full).StartsWith('ptv-dev-transaction-')) {
        throw 'Plugin transaction cleanup path escaped its intended parent.'
    }
    Assert-NoReparse $full
    Remove-Item -LiteralPath $full -Recurse -Force
}

$preflight = Join-Path $PSScriptRoot 'ptv-workspace-preflight.mjs'
$arguments = @($preflight, 'deploy-development', '--environment-id', $EnvironmentId)
if ($web) { $arguments += @('--web-manifest', $WebManifest, '--web-artifact-root', $WebArtifactRoot) }
if ($plugin) { $arguments += @('--plugin-manifest', $PluginManifest, '--plugin-artifact-root', $PluginArtifactRoot) }
if ($FrozenSourceCommit) { $arguments += @('--frozen-source-commit', $FrozenSourceCommit) }
Push-Location -LiteralPath $sourceRoot
try { $preflightOutput = & node @arguments 2>&1; if ($LASTEXITCODE -ne 0) { throw "Protected development preflight denied: $($preflightOutput -join ' ')" } }
finally { Pop-Location }
$gate = ($preflightOutput -join [Environment]::NewLine) | ConvertFrom-Json -AsHashtable -ErrorAction Stop
if ($gate.mode -cne 'deploy-development' -or $gate.environmentId -cne 'JF_DEVELOPMENT_125' -or
    $gate.host -cne '10.16.0.125' -or $gate.serverId -cne $expectedServerId -or
    $gate.serverName -cne 'PTV Testing' -or $gate.sourceCommit -cnotmatch '^[0-9a-f]{40}$') {
    throw 'Protected development preflight returned an unexpected target or source identity.'
}
Assert-Same $gate.sourceRoot $sourceRoot 'Source root'
Assert-Same $gate.webTargetPath $webTarget 'Web target'
Assert-Same $gate.pluginTargetRoot $pluginTarget 'Plugin target'
foreach ($path in @($webTarget, $pluginTarget, $artifactRoot)) { Assert-NoReparse $path }
$ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -ceq '10.16.0.125' })
if ($ips.Count -ne 1) { throw 'The current host is not the registered .125 development server.' }
$process = Get-LocalJellyfinProcess
$handler = [Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$handler.UseProxy = $false
$handler.UseCookies = $false
$handler.UseDefaultCredentials = $false
$script:http = [Net.Http.HttpClient]::new($handler)
$script:http.Timeout = [TimeSpan]::FromSeconds(12)
$secretPtr = [IntPtr]::Zero
$script:tokenText = $null
$stagePath = $null
$transactionPath = $null
$lock = $null
$phase = 'identity'
try {
    [void](Assert-ServerIdentity)
    if ($VerifyOnly) {
        [pscustomobject]@{ sourceCommit = $gate.sourceCommit; environmentId = $EnvironmentId;
            webVersion = $gate.versions.web; pluginVersion = $gate.versions.plugin; result = 'VERIFIED_ONLY' } | ConvertTo-Json -Compress
        return
    }
    if ($null -ne $AdminToken) {
        $secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($AdminToken)
        $script:tokenText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
        if ([string]::IsNullOrWhiteSpace($script:tokenText)) { throw 'The .125 administrator token is empty.' }
        Assert-AdminIdentity
        Write-Warning (Get-SessionWarning)
    }
    else { Write-Warning 'Development install may interrupt active sessions; continuing without session inventory.' }
    $installStarted = [DateTimeOffset]::UtcNow
    $phase = 'lock'
    [void][IO.Directory]::CreateDirectory($runRoot)
    Assert-NoReparse $runRoot
    $lockPath = Join-Path $runRoot '.ptv-development-install.lock'
    $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    Import-Module (Join-Path $PSScriptRoot 'PTVDevelopmentPublisher.psm1') -Force
    if ($plugin) {
        $phase = 'plugin-stage'
        [void][IO.Directory]::CreateDirectory($pluginStageParent)
        Assert-NoReparse $pluginStageParent
        $stagePath = Join-Path $pluginStageParent ('ptv-dev-' + [guid]::NewGuid().ToString('N'))
        $stageArgs = @((Join-Path $PSScriptRoot 'ptv-development-plugin-stage.mjs'),
            '--artifact-root', $PluginArtifactRoot, '--artifact-manifest', $PluginManifest,
            '--stage-root', $stagePath, '--expected-commit', $gate.sourceCommit,
            '--expected-version', $gate.versions.plugin,
            '--expected-manifest-digest', $gate.manifestDigests.plugin)
        $stageOutput = & node @stageArgs 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Verified Plugin staging failed: $($stageOutput -join ' ')" }
        $stage = ($stageOutput -join [Environment]::NewLine) | ConvertFrom-Json -ErrorAction Stop
        Assert-Same $stage.stageRoot $stagePath 'Plugin stage'
    }
    # Identity is checked again immediately before the first installed-file write.
    [void](Get-LocalJellyfinProcess)
    [void](Assert-ServerIdentity)
    if ($web) {
        $phase = 'web-manifest-recheck'
        $verifyArgs = @((Join-Path $PSScriptRoot 'ptv-artifact-manifest.mjs'), 'verify',
            '--artifact', $WebArtifactRoot, '--manifest', $WebManifest, '--source-root', $sourceRoot)
        if ($gate.sourceCommit -cne $gate.head) { $verifyArgs += @('--frozen-source-commit', $gate.sourceCommit) }
        $verifyOutput = & node @verifyArgs 2>&1
        if ($LASTEXITCODE -ne 0 -or ($verifyOutput -join '').Trim() -cne $gate.manifestDigests.web) {
            throw "Web artifact differs from protected preflight: $($verifyOutput -join ' ')"
        }
        $phase = 'web-publication'
        $installedManifest = if (Test-Path -LiteralPath $currentWebManifest) { $currentWebManifest } else { $baselineWebManifest }
        [void](Publish-PTVDevelopmentWeb -EnvironmentId $EnvironmentId -TargetPath $webTarget `
            -CandidateRoot $WebArtifactRoot -CandidateManifest $WebManifest -InstalledManifest $installedManifest)
        $manifestTemp = Join-Path ([IO.Path]::GetDirectoryName($currentWebManifest)) ('development-125-' + [guid]::NewGuid().ToString('N') + '.tmp')
        [IO.File]::Copy($WebManifest, $manifestTemp)
        try { [IO.File]::Move($manifestTemp, $currentWebManifest, $true) }
        finally { if (Test-Path -LiteralPath $manifestTemp) { Remove-Item -LiteralPath $manifestTemp -Force } }
    }
    $restartAt = $null
    if ($plugin) {
        $phase = 'plugin-shutdown'
        Stop-OnlyJellyfin ([int]$process.ProcessId)
        $rollbackComplete = $false
        try {
            $phase = 'plugin-installation'
            $transactionPath = Join-Path $pluginStageParent ('ptv-dev-transaction-' + [guid]::NewGuid().ToString('N'))
            [void](Install-PTVDevelopmentPlugin -EnvironmentId $EnvironmentId -TargetPath $pluginTarget `
                -StageRoot $stagePath -StageManifest (Join-Path $PluginArtifactRoot 'package-manifest.json') `
                -Version $gate.versions.plugin -TransactionRoot $transactionPath `
                -BeforeSwitch { Assert-JellyfinStopped } -RollbackComplete ([ref]$rollbackComplete))
        }
        catch {
            $installFailure = $_
            if ($rollbackComplete) {
                $phase = 'plugin-restore-startup'
                try { [void](Start-OnlyJellyfin ([int]$process.ProcessId)) }
                catch { throw "Plugin installation failed; prior files were restored but Jellyfin did not restart: $($_.Exception.Message)" }
            }
            throw $installFailure
        }
        $phase = 'plugin-startup'
        $restartAt = Start-OnlyJellyfin ([int]$process.ProcessId)
    }
    $phase = 'smoke'
    [void](Assert-ServerIdentity)
    $authSmoke = 'PENDING'
    if ($null -ne $AdminToken) {
        Assert-AdminIdentity
        $authSmoke = 'PASS'
    }
    $webSmoke = 'SKIPPED'
    if ($web) {
        $indexBytes = Get-LocalBytes '/web/index.html'
        $servedHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($indexBytes)).ToLowerInvariant()
        $manifest = Get-Content -LiteralPath $WebManifest -Raw | ConvertFrom-Json -ErrorAction Stop
        $expectedIndex = @($manifest.files | Where-Object { $_.path -ceq 'index.html' })
        if ($expectedIndex.Count -ne 1 -or $servedHash -cne $expectedIndex[0].sha256) {
            throw 'Served development Web index differs from the candidate manifest.'
        }
        $webSmoke = 'PASS'
    }
    $pluginSmoke = if ($plugin) { Assert-PluginInitialized $gate.versions.plugin $restartAt } else { 'SKIPPED' }
    if ($null -ne $AdminToken -and -not $plugin) {
        $status = Get-LocalJson '/Ptv/v1/status?full=false' $true
        if ($status.ok -ne $true) { throw 'Authenticated Plugin status is unhealthy.' }
    }
    $installedPluginVersion = ([Reflection.AssemblyName]::GetAssemblyName((Join-Path $pluginTarget 'Jellyfin.Plugin.PiggieTV.dll'))).Version.ToString()
    $webManifestToRead = if (Test-Path -LiteralPath $currentWebManifest) { $currentWebManifest } else { $baselineWebManifest }
    $installedWebManifest = Get-Content -LiteralPath $webManifestToRead -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    $installedWebVersion = [string]$installedWebManifest.sourceVersions.web
    if ($web -and $installedWebVersion -cne $gate.versions.web) { throw 'Installed Web manifest version differs from the candidate.' }
    if ($plugin -and $installedPluginVersion -cne $gate.versions.plugin) { throw 'Installed Plugin DLL version differs from the candidate.' }
    $logSmoke = Get-RecentLogSummary $installStarted
    if ($plugin -and $pluginSmoke.status -ceq 'PASS' -and $transactionPath) {
        Remove-OwnedTransaction $transactionPath
        $transactionPath = $null
    }
    [pscustomobject]@{ sourceCommit = $gate.sourceCommit; environmentId = $EnvironmentId;
        webVersion = $installedWebVersion; pluginVersion = $installedPluginVersion;
        result = 'INSTALLED'; webSmoke = $webSmoke; pluginSmoke = $pluginSmoke;
        authenticatedSmoke = $authSmoke; logSmoke = $logSmoke } | ConvertTo-Json -Compress -Depth 4
}
catch {
    $failure = $_
    try {
        if (Test-Path -LiteralPath $runRoot -PathType Container) {
            $diagnostic = [ordered]@{
                checkedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
                environmentId = 'JF_DEVELOPMENT_125'
                sourceCommit = $gate.sourceCommit
                webSelected = $web
                pluginSelected = $plugin
                phase = $phase
                result = 'FAILED'
                error = $failure.Exception.Message
                pluginTransaction = $transactionPath
            }
            [IO.File]::WriteAllText((Join-Path $runRoot 'last-install-diagnostic.json'),
                ($diagnostic | ConvertTo-Json -Depth 4), [Text.Encoding]::UTF8)
        }
    }
    catch { } # Diagnostic write failure must not hide the installation error.
    throw $failure
}
finally {
    if ($null -ne $lock) { $lock.Dispose() }
    if ($null -ne $stagePath -and (Test-Path -LiteralPath $stagePath)) {
        $parent = [IO.Path]::GetFullPath($pluginStageParent).TrimEnd('\') + '\'
        $stageFull = [IO.Path]::GetFullPath($stagePath)
        if (-not $stageFull.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase) -or
            -not [IO.Path]::GetFileName($stageFull).StartsWith('ptv-dev-')) {
            throw 'Plugin stage cleanup path escaped its intended parent.'
        }
        Assert-NoReparse $stageFull
        Remove-Item -LiteralPath $stageFull -Recurse -Force
    }
    $script:tokenText = $null
    if ($secretPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr) }
    $script:http.Dispose()
    $handler.Dispose()
}
