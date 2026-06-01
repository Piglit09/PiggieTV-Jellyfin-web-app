param(
    [string]$Source = (Join-Path $PSScriptRoot '..\dist'),
    [string]$Target = 'C:\Program Files\Jellyfin\Server\jellyfin-web'
)

$ErrorActionPreference = 'Stop'

$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$targetPath = (Resolve-Path -LiteralPath $Target).Path

Write-Host "Syncing Jellyfin web assets"
Write-Host "  Source: $sourcePath"
Write-Host "  Target: $targetPath"

$files = Get-ChildItem -LiteralPath $sourcePath -Recurse -File
$copied = 0

foreach ($file in $files) {
    $relativePath = $file.FullName.Substring($sourcePath.Length).TrimStart('\')
    $destination = Join-Path $targetPath $relativePath
    $destinationDirectory = Split-Path -Path $destination -Parent

    if (-not (Test-Path -LiteralPath $destinationDirectory)) {
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    }

    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
    $copied++
}

$missing = foreach ($file in $files) {
    $relativePath = $file.FullName.Substring($sourcePath.Length).TrimStart('\')
    $destination = Join-Path $targetPath $relativePath

    if (-not (Test-Path -LiteralPath $destination)) {
        $relativePath
    }
}

Write-Host "Copied $copied file(s)."

if (@($missing).Count -gt 0) {
    Write-Error "Deploy finished with missing files: $(@($missing).Count)"
}

Write-Host "Deploy complete."
