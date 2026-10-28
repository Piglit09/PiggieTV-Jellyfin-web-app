# Disposable publisher fixtures. No Jellyfin installation or network access.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'PTVDevelopmentPublisher.psm1') -Force
$script:passed = 0
$root = Join-Path ([IO.Path]::GetTempPath()) ('ptv-dev-publisher-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)

function Put([string]$directory, [string]$relative, [string]$body) {
    $file = Join-Path $directory $relative
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file))
    [IO.File]::WriteAllText($file, $body)
}
function Manifest([string]$directory, [string]$path, [string]$project = 'PTV_WEB') {
    $files = @(Get-ChildItem -LiteralPath $directory -Recurse -File | ForEach-Object {
        [ordered]@{
            path = [IO.Path]::GetRelativePath($directory, $_.FullName).Replace('\', '/')
            size = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    } | Sort-Object { $_.path })
    [ordered]@{
        schemaVersion = 1
        projectId = $project
        sourceCommit = ('a' * 40)
        sourceVersions = @{ web = '0.5.77'; plugin = '0.5.24.0' }
        files = $files
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path -Encoding utf8
}
function Throws([scriptblock]$action, [string]$expected) {
    try { & $action | Out-Null } catch {
        if ($_.Exception.Message -notmatch $expected) { throw "Wrong rejection: $($_.Exception.Message)" }
        return
    }
    throw "Expected rejection: $expected"
}
function Pass([string]$name) { $script:passed++; Write-Host "PASS $name" }

try {
    $old = Join-Path $root 'old'
    $new = Join-Path $root 'new'
    $target = Join-Path $root 'target'
    foreach ($dir in @($old, $new, $target)) { [void][IO.Directory]::CreateDirectory($dir) }
    Put $old 'index.html' 'old-index'
    Put $old 'old.js' 'old-asset'
    Put $old 'config.json' '{"safe":true}'
    Put $new 'index.html' 'new-index'
    Put $new 'new.js' 'new-asset'
    Put $new 'config.json' '{"safe":true}'
    Put $target 'index.html' 'old-index'
    Put $target 'old.js' 'old-asset'
    Put $target 'config.json' '{"safe":true}'
    Put $target '.ptv-dev-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.tmp' 'partial-copy'
    Put $root 'outside.txt' 'keep'
    $oldManifest = Join-Path $root 'old.json'
    $newManifest = Join-Path $root 'new.json'
    Manifest $old $oldManifest
    Manifest $new $newManifest
    $events = [Collections.Generic.List[string]]::new()
    $observer = { param($action, $relative) $events.Add("$action`:$relative") }.GetNewClosure()
    Publish-PTVDevelopmentWeb -EnvironmentId JF_DEVELOPMENT_125 -TargetPath $target `
        -CandidateRoot $new -CandidateManifest $newManifest -InstalledManifest $oldManifest `
        -PublicationObserver $observer | Out-Null
    if ((Get-Content (Join-Path $target 'index.html') -Raw) -ne 'new-index') { throw 'New index absent' }
    if (Test-Path (Join-Path $target 'old.js')) { throw 'Obsolete asset remained' }
    if (-not (Test-Path (Join-Path $target 'new.js'))) { throw 'New asset absent' }
    if (Test-Path (Join-Path $target '.ptv-dev-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.tmp')) { throw 'Orphan copy temp remained' }
    if ($events[$events.Count - 1] -ne 'publish:index.html' -or
        -not $events.Contains('retire:old.js')) { throw 'Index was not published last' }
    if ((Get-Content (Join-Path $root 'outside.txt') -Raw) -ne 'keep') { throw 'Outside file changed' }
    Pass 'manifest assets retire before index last'

    Put $new 'config.json' '{"safe":false}'
    Manifest $new $newManifest
    Throws { Publish-PTVDevelopmentWeb -EnvironmentId JF_DEVELOPMENT_125 -TargetPath $target `
        -CandidateRoot $new -CandidateManifest $newManifest -InstalledManifest $newManifest } 'config'
    if ((Get-Content (Join-Path $target 'config.json') -Raw) -ne '{"safe":true}') { throw 'Config changed' }
    Pass 'Web config change denied before mutation'

    Put $new 'config.json' '{"safe":true}'
    Manifest $new $newManifest
    Put $target 'new.js' 'tampered'
    Throws { Publish-PTVDevelopmentWeb -EnvironmentId JF_DEVELOPMENT_125 -TargetPath $target `
        -CandidateRoot $new -CandidateManifest $newManifest -InstalledManifest $newManifest } 'manifest|differs'
    if ((Get-Content (Join-Path $target 'new.js') -Raw) -ne 'tampered') { throw 'Tampered file overwritten' }
    Pass 'unknown installed state denied'

    $pluginStage = Join-Path $root 'plugin-stage'
    $pluginTarget = Join-Path $root 'plugins\PiggieTV_Plugin (testing)'
    [void][IO.Directory]::CreateDirectory($pluginStage)
    [void][IO.Directory]::CreateDirectory($pluginTarget)
    Put $pluginStage 'Jellyfin.Plugin.PiggieTV.deps.json' 'deps'
    Put $pluginStage 'Jellyfin.Plugin.PiggieTV.dll' 'dll'
    Put $pluginStage 'Jellyfin.Plugin.PiggieTV.pdb' 'pdb'
    Put $pluginStage 'Jellyfin.Plugin.PiggieTV.xml' 'xml'
    Put $pluginStage 'meta.json' '{"version":"0.5.24.0"}'
    Put $pluginStage 'helpers\win-x64\Ptv.ComicInfo.Helper.exe' 'helper'
    $pluginManifest = Join-Path $root 'plugin.json'
    Manifest $pluginStage $pluginManifest 'PTV_PLUGIN'
    Put (Join-Path $root 'plugins\configurations') 'PiggieTV.xml' 'keep-config'
    $pluginTransaction = Join-Path $root 'plugin-transaction'
    Install-PTVDevelopmentPlugin -EnvironmentId JF_DEVELOPMENT_125 `
        -TargetPath $pluginTarget -StageRoot $pluginStage -StageManifest $pluginManifest `
        -Version '0.5.24.0' -TransactionRoot $pluginTransaction | Out-Null
    if (-not (Test-Path (Join-Path $pluginTarget 'helpers\win-x64\Ptv.ComicInfo.Helper.exe'))) { throw 'Windows helper absent' }
    if ((Get-Content (Join-Path $root 'plugins\configurations\PiggieTV.xml') -Raw) -ne 'keep-config') { throw 'Plugin config changed' }
    Pass 'Plugin copy confines payload and preserves configuration'

    Put $pluginStage 'Jellyfin.Plugin.PiggieTV.dll' 'tampered'
    Throws { Install-PTVDevelopmentPlugin -EnvironmentId JF_DEVELOPMENT_125 `
        -TargetPath $pluginTarget -StageRoot $pluginStage -StageManifest $pluginManifest `
        -Version '0.5.24.0' -TransactionRoot (Join-Path $root 'tampered-transaction') } 'manifest|differs'
    if ((Get-Content (Join-Path $pluginTarget 'Jellyfin.Plugin.PiggieTV.dll') -Raw) -ne 'dll') { throw 'Target DLL changed after stage denial' }
    Pass 'Plugin stage tamper denied before copy'

    Put $pluginStage 'Jellyfin.Plugin.PiggieTV.dll' 'dll'
    Put $pluginStage 'helpers\linux-x64\other' 'bad'
    Throws { Install-PTVDevelopmentPlugin -EnvironmentId JF_DEVELOPMENT_125 `
        -TargetPath $pluginTarget -StageRoot $pluginStage -StageManifest $pluginManifest `
        -Version '0.5.24.0' -TransactionRoot (Join-Path $root 'linux-transaction') } 'unexpected|linux|manifest'
    Pass 'unexpected Plugin payload denied'

    Remove-Item -LiteralPath (Join-Path $pluginStage 'helpers\linux-x64') -Recurse -Force
    $rolledBack = $false
    $beforeIndex = (Get-FileHash -LiteralPath (Join-Path $pluginTarget 'Jellyfin.Plugin.PiggieTV.dll') -Algorithm SHA256).Hash
    Throws { Install-PTVDevelopmentPlugin -EnvironmentId JF_DEVELOPMENT_125 `
        -TargetPath $pluginTarget -StageRoot $pluginStage -StageManifest $pluginManifest `
        -Version '0.5.24.0' -TransactionRoot (Join-Path $root 'rollback-transaction') `
        -AfterOldMove { throw 'fixture-switch-failure' } -RollbackComplete ([ref]$rolledBack) } 'fixture-switch-failure'
    if (-not $rolledBack -or -not (Test-Path -LiteralPath $pluginTarget) -or
        (Get-FileHash -LiteralPath (Join-Path $pluginTarget 'Jellyfin.Plugin.PiggieTV.dll') -Algorithm SHA256).Hash -cne $beforeIndex) {
        throw 'Plugin rollback did not restore the prior target after a switch failure'
    }
    Pass 'Plugin directory switch failure restores prior target'

    Write-Host "DEVELOPMENT_PUBLISHER_FIXTURES: $script:passed passed, 0 failed"
}
finally {
    $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $owned = [IO.Path]::GetFullPath($root)
    if (-not $owned.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase) -or
        -not [IO.Path]::GetFileName($owned).StartsWith('ptv-dev-publisher-')) {
        throw 'Fixture cleanup path escaped temp root'
    }
    if (Test-Path -LiteralPath $owned) { Remove-Item -LiteralPath $owned -Recurse -Force }
}
