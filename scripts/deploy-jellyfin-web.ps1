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

$files = @(Get-ChildItem -LiteralPath $sourcePath -Recurse -File)
$indexFile = $files | Where-Object { $_.FullName.Substring($sourcePath.Length).TrimStart('\') -eq 'index.html' }

if (@($indexFile).Count -ne 1) {
    throw "Deployment source must contain exactly one root index.html. Found $(@($indexFile).Count)."
}

# Publish the document entry last. New HTML must never advertise a runtime before
# every bundle and content-hashed async chunk from that build is in place.
$orderedFiles = @($files | Where-Object { $_.FullName -ne $indexFile.FullName }) + @($indexFile)
$copied = 0

foreach ($file in $orderedFiles) {
    $relativePath = $file.FullName.Substring($sourcePath.Length).TrimStart('\')
    $destination = Join-Path $targetPath $relativePath
    $destinationDirectory = Split-Path -Path $destination -Parent

    if (-not (Test-Path -LiteralPath $destinationDirectory)) {
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    }

    if ($relativePath -eq 'index.html') {
        $temporaryIndex = Join-Path $destinationDirectory ".ptv-index-$([guid]::NewGuid().ToString('N')).tmp"
        try {
            Copy-Item -LiteralPath $file.FullName -Destination $temporaryIndex -Force
            Move-Item -LiteralPath $temporaryIndex -Destination $destination -Force
        }
        finally {
            Remove-Item -LiteralPath $temporaryIndex -Force -ErrorAction SilentlyContinue
        }
    }
    else {
        Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
    }
    $copied++
}

$invalid = foreach ($file in $files) {
    $relativePath = $file.FullName.Substring($sourcePath.Length).TrimStart('\')
    $destination = Join-Path $targetPath $relativePath

    if (-not (Test-Path -LiteralPath $destination)) {
        "$relativePath (missing)"
        continue
    }

    $sourceHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    $destinationHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    if ($sourceHash -ne $destinationHash) {
        "$relativePath (hash mismatch)"
    }
}

Write-Host "Copied $copied file(s)."

if (@($invalid).Count -gt 0) {
    Write-Error "Deploy verification failed for $(@($invalid).Count) file(s): $($invalid -join ', ')"
}

Write-Host "Deploy complete."
