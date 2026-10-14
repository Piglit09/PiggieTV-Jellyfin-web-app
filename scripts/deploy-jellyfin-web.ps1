[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')]
    [string]$EnvironmentId,

    [Parameter(Mandatory = $true)]
    [string]$Artifact,

    [Parameter(Mandatory = $true)]
    [string]$ArtifactManifest,

    [Parameter(Mandatory = $true)]
    [string]$ApprovalRecord,

    [Parameter(Mandatory = $true)]
    [string]$RollbackReference
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop

# There is deliberately no Target parameter. Only the protected preflight
# may resolve a registered deployment destination.
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$artifactPath = (Resolve-Path -LiteralPath $Artifact).Path
$manifestPath = (Resolve-Path -LiteralPath $ArtifactManifest).Path
$approvalPath = (Resolve-Path -LiteralPath $ApprovalRecord).Path
$rollbackPath = (Resolve-Path -LiteralPath $RollbackReference).Path
$preflightScript = Join-Path $PSScriptRoot 'ptv-workspace-preflight.mjs'
$manifestScript = Join-Path $PSScriptRoot 'ptv-artifact-manifest.mjs'

foreach ($requiredFile in @($preflightScript, $manifestScript)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required governance verifier is missing: $requiredFile"
    }
}
if (-not (Test-Path -LiteralPath $artifactPath -PathType Container)) {
    throw 'Artifact must be an existing directory.'
}

function Assert-NoReparsePoint {
    param([Parameter(Mandatory = $true)][string]$Path)
    $current = [System.IO.Path]::GetFullPath($Path)
    while (-not [string]::IsNullOrEmpty($current)) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "A deployment path contains a reparse point: $current"
            }
        }
        $parent = Split-Path -Path $current -Parent
        if ([string]::IsNullOrEmpty($parent) -or $parent -ceq $current) { break }
        $current = $parent
    }
}

function Invoke-GovernanceCommand {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    Push-Location -LiteralPath $repositoryRoot
    try {
        $output = & node @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Governance verification rejected the operation: $($output -join [Environment]::NewLine)"
        }
        return ($output -join [Environment]::NewLine)
    }
    finally {
        Pop-Location
    }
}

function Assert-Manifest {
    Invoke-GovernanceCommand -Arguments @(
        $manifestScript, 'verify',
        '--artifact', $artifactPath,
        '--manifest', $manifestPath,
        '--source-root', $repositoryRoot
    ) | Out-Null
}

function Get-ApprovedTarget {
    $result = Invoke-GovernanceCommand -Arguments @(
        $preflightScript, 'deploy',
        '--project', 'PTV_WEB',
        '--environment-id', $EnvironmentId,
        '--artifact-manifest', $manifestPath,
        '--approval-record', $approvalPath,
        '--rollback-reference', $rollbackPath
    )
    try {
        $approval = $result | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw 'Deployment preflight did not return a valid authorization record.'
    }
    if ($null -eq $approval -or [string]::IsNullOrWhiteSpace([string]$approval.targetPath)) {
        throw 'Deployment preflight did not identify a registered target path.'
    }
    if ($approval.environmentId -ne $EnvironmentId) {
        throw 'Deployment preflight authorized a different environment.'
    }
    $currentManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -ErrorAction Stop
    if ($approval.artifactManifestDigest -cne $currentManifest.manifestDigest) {
        throw 'Deployment preflight authorized a different artifact manifest.'
    }
    $path = [System.IO.Path]::GetFullPath([string]$approval.targetPath)
    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
        throw 'The registered deployment target does not exist.'
    }
    Assert-NoReparsePoint -Path $path
    return $path
}

function Assert-RollbackReference {
    param(
        [Parameter(Mandatory = $true)][string]$Target,
        [Parameter(Mandatory = $true)]$Manifest
    )
    try {
        $record = Get-Content -LiteralPath $rollbackPath -Raw | ConvertFrom-Json -ErrorAction Stop
        $backupPath = [string]$record.backupPath
        $createdAt = [DateTimeOffset]::MinValue
        if ($record.schemaVersion -ne 1 -or
            $record.environmentId -cne $EnvironmentId -or
            [System.IO.Path]::GetFullPath([string]$record.targetPath) -ine $Target -or
            $record.candidateSourceCommit -cne $Manifest.sourceCommit -or
            $record.candidateVersions.web -cne $Manifest.sourceVersions.web -or
            $record.candidateVersions.plugin -cne $Manifest.sourceVersions.plugin -or
            $record.artifactManifestDigest -cne $Manifest.manifestDigest -or
            -not [DateTimeOffset]::TryParse([string]$record.createdAt, [ref]$createdAt) -or
            $createdAt -gt [DateTimeOffset]::UtcNow -or
            -not [System.IO.Path]::IsPathRooted($backupPath) -or
            [string]$record.backupSha256 -notmatch '^[0-9a-f]{64}$') {
            throw 'Rollback record does not bind this target, source commit, artifact, and a dated backup.'
        }
        $backup = Get-Item -LiteralPath $backupPath -Force -ErrorAction Stop
        if ($backup -isnot [System.IO.FileInfo]) {
            throw 'Rollback backup must be an existing regular file.'
        }
        $backupFullPath = [System.IO.Path]::GetFullPath($backupPath)
        $sourcePrefix = $repositoryRoot.TrimEnd('\\') + [System.IO.Path]::DirectorySeparatorChar
        $targetPrefix = $Target.TrimEnd('\\') + [System.IO.Path]::DirectorySeparatorChar
        if ($backupFullPath.StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase) -or
            $backupFullPath.StartsWith($targetPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Rollback backup must be outside source and deployment target.'
        }
        Assert-NoReparsePoint -Path $backupPath
        if ((Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$record.backupSha256) {
            throw 'Rollback backup does not match its recorded SHA-256.'
        }
    }
    catch {
        throw "Rollback evidence is not recoverable or does not match this deployment: $($_.Exception.Message)"
    }
}

foreach ($path in @($artifactPath, $manifestPath, $approvalPath, $rollbackPath)) {
    Assert-NoReparsePoint -Path $path
}

# Both checks happen before the first target write. They are repeated
# immediately before publication so changed approvals or artifacts are denied.
$targetPath = Get-ApprovedTarget
Assert-Manifest
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -ErrorAction Stop
if ($manifest.projectId -ne 'PTV_WEB' -or $manifest.sourceDirty -ne $false -or
    [string]$manifest.sourceCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'Deployment requires a clean, committed PTV Web artifact manifest.'
}

$files = @($manifest.files)
if ($files.Count -eq 0) {
    throw 'Deployment manifest has no package files.'
}
$indexFiles = @($files | Where-Object { $_.path -ceq 'index.html' })
if ($indexFiles.Count -ne 1) {
    throw "Deployment manifest must contain exactly one root index.html. Found $($indexFiles.Count)."
}
foreach ($entry in $files) {
    $relativePath = [string]$entry.path
    if ($relativePath -notmatch '^[^/\\:]+(?:/[^/\\:]+)*$' -or
        @($relativePath.Split('/')) -contains '..' -or
        @($relativePath.Split('/')) -contains '.') {
        throw "Deployment manifest contains an unsafe path: $relativePath"
    }
}

Assert-RollbackReference -Target $targetPath -Manifest $manifest
$secondTarget = Get-ApprovedTarget
if ($secondTarget -cne $targetPath) {
    throw 'Registered deployment target changed during preflight.'
}
Assert-Manifest
Assert-RollbackReference -Target $targetPath -Manifest $manifest

Write-Host "Publishing $($files.Count) verified PTV Web files to registered environment $EnvironmentId."
# Publish index.html last so it cannot advertise assets that are not present.
$orderedFiles = @($files | Where-Object { $_.path -cne 'index.html' }) + $indexFiles
$copied = 0
foreach ($entry in $orderedFiles) {
    $relativePath = [string]$entry.path
    $nativePath = $relativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $sourceFile = Join-Path $artifactPath $nativePath
    $destination = Join-Path $targetPath $nativePath
    $destinationDirectory = Split-Path -Path $destination -Parent
    Assert-NoReparsePoint -Path $sourceFile
    if (-not (Test-Path -LiteralPath $destinationDirectory)) {
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    }
    Assert-NoReparsePoint -Path $destinationDirectory
    if (Test-Path -LiteralPath $destination) {
        Assert-NoReparsePoint -Path $destination
    }
    $sourceHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sourceHash -cne [string]$entry.sha256) {
        throw "Artifact changed before publication: $relativePath"
    }
    if ($relativePath -ceq 'index.html') {
        $temporaryIndex = Join-Path $destinationDirectory ".ptv-index-$([guid]::NewGuid().ToString('N')).tmp"
        try {
            Copy-Item -LiteralPath $sourceFile -Destination $temporaryIndex -Force
            if ((Get-FileHash -LiteralPath $temporaryIndex -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$entry.sha256) {
                throw 'Staged index.html does not match the approved manifest.'
            }
            Move-Item -LiteralPath $temporaryIndex -Destination $destination -Force
        }
        finally {
            Remove-Item -LiteralPath $temporaryIndex -Force -ErrorAction SilentlyContinue
        }
    }
    else {
        Copy-Item -LiteralPath $sourceFile -Destination $destination -Force
    }
    if ((Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$entry.sha256 -or
        (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$entry.sha256) {
        throw "Post-copy verification failed: $relativePath"
    }
    $copied++
}

Write-Host "Verified $copied deployed file(s) against the complete artifact manifest."
