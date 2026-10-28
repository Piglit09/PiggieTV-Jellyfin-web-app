#requires -Version 7.0
# Exact-tree file publication mechanics only. The guarded caller owns target,
# operator approval, session isolation, and rollback authorization.
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Assert-NoReparsePoint {
    param([Parameter(Mandatory)][string]$Path)
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "A publication path contains a reparse point: $current"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if (-not $parent -or $parent -ceq $current) { break }
        $current = $parent
    }
}

function Assert-OutsideTarget {
    param([string]$Target, [string]$Other)
    $targetFull = [IO.Path]::GetFullPath($Target).TrimEnd('\', '/')
    $otherFull = [IO.Path]::GetFullPath($Other).TrimEnd('\', '/')
    if ($otherFull.Equals($targetFull, [StringComparison]::OrdinalIgnoreCase) -or
        $otherFull.StartsWith($targetFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Publication artifacts and transaction data must remain outside the Web target.'
    }
}

function Assert-SafeRelativePath {
    param([string]$RelativePath)
    if ([string]::IsNullOrWhiteSpace($RelativePath) -or
        $RelativePath.Contains('\') -or $RelativePath.Contains(':') -or
        $RelativePath.StartsWith('/') -or $RelativePath.EndsWith('/') -or
        $RelativePath.Contains('//')) {
        throw "Unsafe package path: $RelativePath"
    }
    foreach ($part in $RelativePath.Split('/')) {
        if ($part -in @('.', '..') -or $part -notmatch '^[^<>:"|?*\x00-\x1f]+$' -or
            $part.EndsWith('.') -or $part.EndsWith(' ')) {
            throw "Unsafe package path: $RelativePath"
        }
        $stem = $part.Split('.')[0]
        if ($stem -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$') {
            throw "Unsafe Windows device path: $RelativePath"
        }
    }
}

function Join-SafePackagePath {
    param([string]$Root, [string]$RelativePath)
    Assert-SafeRelativePath $RelativePath
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $joined = [IO.Path]::GetFullPath((Join-Path $rootFull $RelativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)))
    if (-not $joined.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Package path escaped its root: $RelativePath"
    }
    Assert-NoReparsePoint $joined
    return $joined
}

function Read-PackageManifest {
    param([Parameter(Mandatory)][string]$Path)
    Assert-NoReparsePoint $Path
    $readSha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifest = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ($manifest.schemaVersion -ne 1 -or $manifest.projectId -cne 'PTV_WEB' -or
        @($manifest.files).Count -eq 0) {
        throw 'Invalid PTV Web package manifest.'
    }
    $map = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in @($manifest.files)) {
        $relative = [string]$entry.path
        Assert-SafeRelativePath $relative
        if ($map.ContainsKey($relative)) { throw "Case-colliding or duplicate package path: $relative" }
        if ([string]$entry.sha256 -cnotmatch '^[0-9a-f]{64}$' -or
            $null -eq $entry.size -or [long]$entry.size -lt 0) {
            throw "Package manifest has an invalid size or SHA-256 for $relative"
        }
        $map.Add($relative, $entry)
    }
    if (-not $map.ContainsKey('index.html') -or $map['index.html'].path -cne 'index.html') {
        throw 'Package manifest must contain one root index.html.'
    }
    Assert-NoReparsePoint $Path
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $readSha256) {
        throw 'Package manifest changed while it was read.'
    }
    return [pscustomobject]@{ Document = $manifest; Entries = $map }
}

function Read-BaselineManifest {
    param([Parameter(Mandatory)][string]$Path,
          [Parameter(Mandatory)][string]$EnvironmentId,
          [string]$ExpectedServerId,
          [Parameter(Mandatory)][string]$TargetPath,
          [object]$ExpectedSha256)
    Assert-NoReparsePoint $Path
    $file = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($file -isnot [IO.FileInfo]) { throw 'Baseline manifest must be a regular file.' }
    $actualSha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($null -ne $ExpectedSha256) {
        if ($ExpectedSha256 -cnotmatch '^[0-9a-f]{64}$' -or $actualSha256 -cne $ExpectedSha256) {
            throw 'Baseline manifest SHA-256 does not match the pinned value.'
        }
    }
    $manifest = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ($manifest.PSObject.Properties.Name -contains 'projectId') {
        $package = Read-PackageManifest $Path
        if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $actualSha256) {
            throw 'Baseline manifest changed while it was read.'
        }
        return $package
    }
    if ($ExpectedServerId -cnotmatch '^[0-9a-f]{32}$') {
        throw 'Installed-state baseline requires an exact expected server identity.'
    }
    if ($manifest.schemaVersion -ne 1 -or
        $manifest.environmentId -cne $EnvironmentId -or
        $manifest.serverId -cnotmatch '^[0-9a-f]{32}$' -or
        $manifest.serverId -cne $ExpectedServerId -or
        -not [IO.Path]::IsPathFullyQualified([string]$manifest.installedRoot) -or
        [IO.Path]::GetFullPath([string]$manifest.installedRoot) -ine [IO.Path]::GetFullPath($TargetPath) -or
        $manifest.webVersion -cnotmatch '^\d+\.\d+\.\d+$' -or
        $manifest.sourceCommit -cnotmatch '^[0-9a-f]{40}$') {
        throw 'Installed-state baseline environment, server identity, target root, or metadata does not match.'
    }
    $capturedAt = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$manifest.capturedAt, [ref]$capturedAt) -or
        $capturedAt -gt [DateTimeOffset]::UtcNow -or
        $manifest.files -isnot [array] -or @($manifest.files).Count -eq 0 -or
        $manifest.fileCount -isnot [long] -or $manifest.totalBytes -isnot [long] -or
        [long]$manifest.fileCount -ne @($manifest.files).Count -or [long]$manifest.totalBytes -lt 0) {
        throw 'Installed-state baseline count, capture time, or file list is invalid.'
    }
    $map = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::OrdinalIgnoreCase)
    [decimal]$totalBytes = 0
    foreach ($entry in $manifest.files) {
        $relative = [string]$entry.path
        Assert-SafeRelativePath $relative
        if ($map.ContainsKey($relative)) { throw "Case-colliding or duplicate installed-state path: $relative" }
        if ([string]$entry.sha256 -cnotmatch '^[0-9a-f]{64}$' -or
            $entry.size -isnot [long] -or [long]$entry.size -lt 0) {
            throw "Installed-state baseline has an invalid size or SHA-256 for $relative"
        }
        $totalBytes += [decimal]$entry.size
        $map.Add($relative, $entry)
    }
    if ($totalBytes -ne [long]$manifest.totalBytes -or
        -not $map.ContainsKey('index.html') -or $map['index.html'].path -cne 'index.html' -or
        -not $map.ContainsKey('config.json') -or $map['config.json'].path -cne 'config.json') {
        throw 'Installed-state baseline total bytes or root index.html/config.json is invalid.'
    }
    Assert-NoReparsePoint $Path
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $actualSha256) {
        throw 'Baseline manifest changed while it was read.'
    }
    return [pscustomobject]@{ Document = $manifest; Entries = $map }
}

function Assert-ConfigIdentity {
    param($Baseline, $Candidate)
    if (-not $Baseline.Entries.ContainsKey('config.json') -or
        -not $Candidate.Entries.ContainsKey('config.json') -or
        $Baseline.Entries['config.json'].path -cne 'config.json' -or
        $Candidate.Entries['config.json'].path -cne 'config.json' -or
        [long]$Baseline.Entries['config.json'].size -ne [long]$Candidate.Entries['config.json'].size -or
        [string]$Baseline.Entries['config.json'].sha256 -cne [string]$Candidate.Entries['config.json'].sha256) {
        throw 'Candidate config.json must exactly match the installed baseline.'
    }
}

function Get-IndexStartTags {
    param([string]$Html)
    $tags = [Collections.Generic.List[object]]::new()
    $position = 0
    while ($position -lt $Html.Length) {
        if ($Html[$position] -cne '<') { $position++; continue }
        if ($position + 4 -le $Html.Length -and $Html.Substring($position, 4) -ceq '<!--') {
            $endComment = $Html.IndexOf('-->', $position + 4, [StringComparison]::Ordinal)
            if ($endComment -lt 0) { throw 'index.html has an unterminated comment.' }
            $position = $endComment + 3
            continue
        }
        $cursor = $position + 1
        $closing = $false
        if ($cursor -lt $Html.Length -and $Html[$cursor] -ceq '/') { $closing = $true; $cursor++ }
        if ($cursor -ge $Html.Length -or $Html[$cursor] -cnotmatch '[A-Za-z]') {
            $position++
            continue
        }
        $nameStart = $cursor
        while ($cursor -lt $Html.Length -and $Html[$cursor] -cmatch '[A-Za-z0-9:-]') { $cursor++ }
        $name = $Html.Substring($nameStart, $cursor - $nameStart).ToLowerInvariant()
        $attributesStart = $cursor
        $quote = [char]0
        while ($cursor -lt $Html.Length) {
            $character = $Html[$cursor]
            if ($quote -ne [char]0) {
                if ($character -ceq $quote) { $quote = [char]0 }
            }
            elseif ($character -ceq '"' -or $character -ceq "'") { $quote = $character }
            elseif ($character -ceq '>') { break }
            elseif ($character -ceq '<') { throw 'index.html has a malformed start tag.' }
            $cursor++
        }
        if ($cursor -ge $Html.Length) { throw 'index.html has an unterminated tag or attribute.' }
        if (-not $closing -and $name -in @('script', 'link', 'base')) {
            $rawAttributes = $Html.Substring($attributesStart, $cursor - $attributesStart)
            $attributes = [Collections.Generic.Dictionary[string, string]]::new([StringComparer]::OrdinalIgnoreCase)
            $offset = 0
            while ($offset -lt $rawAttributes.Length) {
                while ($offset -lt $rawAttributes.Length -and [char]::IsWhiteSpace($rawAttributes[$offset])) { $offset++ }
                if ($offset -ge $rawAttributes.Length) { break }
                if ($rawAttributes[$offset] -ceq '/' -and $offset -eq $rawAttributes.Length - 1) { break }
                $attributeStart = $offset
                while ($offset -lt $rawAttributes.Length -and
                    -not [char]::IsWhiteSpace($rawAttributes[$offset]) -and
                    $rawAttributes[$offset] -cne '=' -and $rawAttributes[$offset] -cne '/' -and
                    $rawAttributes[$offset] -cne '"' -and $rawAttributes[$offset] -cne "'") { $offset++ }
                if ($offset -eq $attributeStart) { throw "index.html has a malformed $name attribute." }
                $attributeName = $rawAttributes.Substring($attributeStart, $offset - $attributeStart)
                while ($offset -lt $rawAttributes.Length -and [char]::IsWhiteSpace($rawAttributes[$offset])) { $offset++ }
                $value = ''
                if ($offset -lt $rawAttributes.Length -and $rawAttributes[$offset] -ceq '=') {
                    $offset++
                    while ($offset -lt $rawAttributes.Length -and [char]::IsWhiteSpace($rawAttributes[$offset])) { $offset++ }
                    if ($offset -ge $rawAttributes.Length) { throw "index.html has an empty $attributeName attribute." }
                    if ($rawAttributes[$offset] -ceq '"' -or $rawAttributes[$offset] -ceq "'") {
                        $delimiter = $rawAttributes[$offset]
                        $offset++
                        $valueStart = $offset
                        while ($offset -lt $rawAttributes.Length -and $rawAttributes[$offset] -cne $delimiter) { $offset++ }
                        if ($offset -ge $rawAttributes.Length) { throw "index.html has an unterminated $attributeName attribute." }
                        $value = $rawAttributes.Substring($valueStart, $offset - $valueStart)
                        $offset++
                    }
                    else {
                        $valueStart = $offset
                        while ($offset -lt $rawAttributes.Length -and -not [char]::IsWhiteSpace($rawAttributes[$offset])) { $offset++ }
                        $value = $rawAttributes.Substring($valueStart, $offset - $valueStart)
                        if ($value -match '["''<=>]') { throw "index.html has an ambiguous $attributeName attribute." }
                    }
                }
                if ($attributes.ContainsKey($attributeName)) { throw "index.html has a duplicate $attributeName attribute." }
                $attributes.Add($attributeName, [Net.WebUtility]::HtmlDecode($value))
            }
            $tags.Add([pscustomobject]@{ Name = $name; Attributes = $attributes })
        }
        $position = $cursor + 1
    }
    return $tags.ToArray()
}

function Assert-IndexLiteralAssets {
    param([string]$Root, $Manifest)
    $indexPath = Join-SafePackagePath $Root 'index.html'
    $html = [IO.File]::ReadAllText($indexPath, [Text.Encoding]::UTF8)
    $references = [Collections.Generic.List[object]]::new()
    foreach ($tag in Get-IndexStartTags $html) {
        if ($tag.Name -ceq 'base') {
            throw 'index.html base element is unsupported because it can redirect relative runtime assets.'
        }
        if ($tag.Name -ceq 'script' -and $tag.Attributes.ContainsKey('src')) {
            $references.Add([pscustomobject]@{ Kind = 'script'; Url = $tag.Attributes['src'] })
        }
        if ($tag.Name -ceq 'link' -and $tag.Attributes.ContainsKey('rel') -and
            $tag.Attributes['rel'] -match '(?i)(?:^|\s)stylesheet(?:\s|$)') {
            if (-not $tag.Attributes.ContainsKey('href')) { throw 'index.html stylesheet link has no literal href.' }
            $references.Add([pscustomobject]@{ Kind = 'stylesheet'; Url = $tag.Attributes['href'] })
        }
    }
    foreach ($reference in $references) {
        $url = [string]$reference.Url
        if ([string]::IsNullOrWhiteSpace($url)) {
            throw "index.html $($reference.Kind) has an empty asset URL."
        }
        # Every literal runtime reference must resolve inside the verified Web
        # tree; dynamic imports remain outside this entry-point check.
        if ($url -match '^(?i:[a-z][a-z0-9+.-]*:)' -or $url.StartsWith('//') -or $url.StartsWith('#')) {
            throw "index.html $($reference.Kind) references an external or nonlocal runtime asset: $url"
        }
        $cut = $url.IndexOfAny([char[]]@('?', '#'))
        $relative = if ($cut -ge 0) { $url.Substring(0, $cut) } else { $url }
        $relative = [Uri]::UnescapeDataString($relative)
        if ($relative.StartsWith('/')) {
            throw "index.html $($reference.Kind) uses an unscoped root-relative runtime asset: $url"
        }
        while ($relative.StartsWith('./')) { $relative = $relative.Substring(2) }
        Assert-SafeRelativePath $relative
        if (-not $Manifest.Entries.ContainsKey($relative) -or
            $Manifest.Entries[$relative].path -cne $relative) {
            throw "index.html $($reference.Kind) referenced asset is absent from the manifest: $relative"
        }
        $assetPath = Join-SafePackagePath $Root $relative
        if (-not [IO.File]::Exists($assetPath) -or
            (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne
            [string]$Manifest.Entries[$relative].sha256) {
            throw "index.html $($reference.Kind) referenced asset is absent or changed: $relative"
        }
    }
}

function Assert-ArchiveMatchesManifest {
    param([string]$ArchivePath, [string]$ExpectedSha256, $Manifest)
    if ($ExpectedSha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'Archive SHA-256 is invalid.' }
    Assert-NoReparsePoint $ArchivePath
    $file = Get-Item -LiteralPath $ArchivePath -Force -ErrorAction Stop
    if ($file -isnot [IO.FileInfo]) { throw 'Package archive must be a regular file.' }
    $actualSha = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha -cne $ExpectedSha256) { throw "Archive SHA-256 mismatch: $ArchivePath" }
    $zip = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($entry in $zip.Entries) {
            $relative = [string]$entry.FullName
            Assert-SafeRelativePath $relative
            if (-not $seen.Add($relative)) { throw "Archive has a case-colliding path: $relative" }
            if (-not $Manifest.Entries.ContainsKey($relative) -or
                $Manifest.Entries[$relative].path -cne $relative) {
                throw "Archive has a missing or unexpected manifest entry: $relative"
            }
            $unixType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
            if ($unixType -ne 0 -and $unixType -ne 0x8000) {
                throw "Archive contains an unsupported file type: $relative"
            }
            if ($entry.Name -ceq '' -or $entry.Length -ne [long]$Manifest.Entries[$relative].size) {
                throw "Archive file type or size differs from manifest: $relative"
            }
            $stream = $entry.Open()
            try {
                $sha = [Security.Cryptography.SHA256]::Create()
                try { $digest = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
                finally { $sha.Dispose() }
            }
            finally { $stream.Dispose() }
            if ($digest -cne [string]$Manifest.Entries[$relative].sha256) {
                throw "Archive member SHA-256 mismatch: $relative"
            }
        }
        if ($seen.Count -ne $Manifest.Entries.Count) { throw 'Archive is missing package manifest files.' }
    }
    finally { $zip.Dispose() }
}

function Assert-RollbackReference {
    param([string]$ReferencePath, [string]$EnvironmentId, [string]$TargetPath,
          $CandidateManifest, [string]$BaselineArchive, [string]$BaselineSha256)
    if (-not [IO.Path]::IsPathRooted($ReferencePath)) {
        throw 'Approved rollback reference must have an absolute path.'
    }
    $reference = [IO.Path]::GetFullPath($ReferencePath)
    Assert-NoReparsePoint $reference
    Assert-OutsideTarget $TargetPath $reference
    $file = Get-Item -LiteralPath $reference -Force -ErrorAction Stop
    if ($file -isnot [IO.FileInfo]) { throw 'Approved rollback reference must be a regular file.' }
    $record = Get-Content -LiteralPath $reference -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    $createdAt = [DateTimeOffset]::MinValue
    if ($record.schemaVersion -ne 1 -or
        $record.environmentId -cne $EnvironmentId -or
        [IO.Path]::GetFullPath([string]$record.targetPath) -ine [IO.Path]::GetFullPath($TargetPath) -or
        $record.candidateSourceCommit -cne [string]$CandidateManifest.Document.sourceCommit -or
        $record.candidateVersions.web -cne [string]$CandidateManifest.Document.sourceVersions.web -or
        $record.candidateVersions.plugin -cne [string]$CandidateManifest.Document.sourceVersions.plugin -or
        $record.artifactManifestDigest -cne [string]$CandidateManifest.Document.manifestDigest -or
        [IO.Path]::GetFullPath([string]$record.backupPath) -ine [IO.Path]::GetFullPath($BaselineArchive) -or
        $record.backupSha256 -cne $BaselineSha256 -or
        -not [DateTimeOffset]::TryParse([string]$record.createdAt, [ref]$createdAt) -or
        $createdAt -gt [DateTimeOffset]::UtcNow) {
        throw 'Approved rollback reference does not bind this target, candidate, manifest, and backup.'
    }
    return [pscustomobject]@{
        Path = $reference
        Sha256 = (Get-FileHash -LiteralPath $reference -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

function Get-PackageTree {
    param([string]$Root)
    Assert-NoReparsePoint $Root
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw "Web target does not exist: $Root" }
    $map = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::OrdinalIgnoreCase)
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push([IO.Path]::GetFullPath($Root))
    while ($pending.Count -gt 0) {
        $dir = $pending.Pop()
        foreach ($item in Get-ChildItem -LiteralPath $dir -Force -ErrorAction Stop) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Web target contains a reparse point: $($item.FullName)"
            }
            if ($item -is [IO.DirectoryInfo]) { $pending.Push($item.FullName); continue }
            if ($item -isnot [IO.FileInfo]) { throw "Web target contains an unexpected file type: $($item.FullName)" }
            $relative = [IO.Path]::GetRelativePath($Root, $item.FullName).Replace('\', '/')
            Assert-SafeRelativePath $relative
            if ($map.ContainsKey($relative)) { throw "Web target contains a case collision: $relative" }
            $map.Add($relative, $item)
        }
    }
    return $map
}

function Assert-TreeMatchesManifest {
    param([string]$Root, $Manifest)
    $actual = Get-PackageTree $Root
    if ($actual.Count -ne $Manifest.Entries.Count) {
        throw "Installed Web tree differs from the manifest: expected $($Manifest.Entries.Count) files, found $($actual.Count)."
    }
    foreach ($relative in $Manifest.Entries.Keys) {
        if (-not $actual.ContainsKey($relative) -or
            [IO.Path]::GetRelativePath($Root, $actual[$relative].FullName).Replace('\', '/') -cne $relative) {
            throw "Installed Web tree has a missing, unexpected, or case-different path: $relative"
        }
        if ($actual[$relative].Length -ne [long]$Manifest.Entries[$relative].size -or
            (Get-FileHash -LiteralPath $actual[$relative].FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne
            [string]$Manifest.Entries[$relative].sha256) {
            throw "Installed Web file differs from the manifest: $relative"
        }
    }
}

function Assert-BooleanApproval {
    param([scriptblock]$Callback, [string]$Label, [object[]]$CallbackArguments = @())
    $responses = @(& $Callback @CallbackArguments)
    if ($responses.Count -ne 1 -or $responses[0] -isnot [bool] -or -not $responses[0]) {
        throw "$Label must return exactly one true boolean value."
    }
}

function Get-ManifestDelta {
    param($Baseline, $Candidate)
    $added = @($Candidate.Entries.Keys | Where-Object { -not $Baseline.Entries.ContainsKey($_) } | Sort-Object)
    $removed = @($Baseline.Entries.Keys | Where-Object { -not $Candidate.Entries.ContainsKey($_) } | Sort-Object)
    $changed = @($Candidate.Entries.Keys | Where-Object {
        $Baseline.Entries.ContainsKey($_) -and
        $Baseline.Entries[$_].sha256 -cne $Candidate.Entries[$_].sha256
    } | Sort-Object)
    $unchanged = @($Candidate.Entries.Keys | Where-Object {
        $Baseline.Entries.ContainsKey($_) -and
        $Baseline.Entries[$_].sha256 -ceq $Candidate.Entries[$_].sha256
    } | Sort-Object)
    return [pscustomobject]@{ Added = $added; Removed = $removed; Changed = $changed; Unchanged = $unchanged }
}

function Expand-VerifiedArchive {
    param([string]$ArchivePath, [string]$Destination, $Manifest,
          [scriptblock]$PublicationObserver)
    [IO.Directory]::CreateDirectory($Destination) | Out-Null
    Assert-NoReparsePoint $Destination
    $zip = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        foreach ($entry in $zip.Entries) {
            $destinationFile = Join-SafePackagePath $Destination $entry.FullName
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destinationFile)) | Out-Null
            $source = $entry.Open()
            try {
                $output = [IO.File]::Open($destinationFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
                try { $source.CopyTo($output) }
                finally { $output.Dispose() }
            }
            finally { $source.Dispose() }
            if ($PublicationObserver) { & $PublicationObserver 'stage' $entry.FullName | Out-Null }
        }
    }
    finally { $zip.Dispose() }
    Assert-TreeMatchesManifest $Destination $Manifest
}

function Write-TransactionJournal {
    param([string]$TransactionRoot, $Journal)
    $path = Join-Path $TransactionRoot 'transaction.json'
    $temporary = Join-Path $TransactionRoot ('transaction-' + [guid]::NewGuid().ToString('N') + '.tmp')
    Assert-NoReparsePoint $path
    Assert-NoReparsePoint $temporary
    $Journal.updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    [IO.File]::WriteAllText($temporary, ($Journal | ConvertTo-Json -Depth 12), [Text.Encoding]::UTF8)
    try {
        if ([IO.File]::Exists($path)) { [IO.File]::Move($temporary, $path, $true) }
        else { [IO.File]::Move($temporary, $path) }
    }
    finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}

function Set-TransactionState {
    param([string]$TransactionRoot, $Journal, [string]$State)
    $Journal.state = $State
    if ($State -in @('COMPLETE', 'ROLLED_BACK', 'FAILED_RECOVERY')) {
        $Journal.completedAt = [DateTimeOffset]::UtcNow.ToString('o')
    }
    Write-TransactionJournal $TransactionRoot $Journal
}

function Copy-VerifiedFileAtomically {
    param([string]$SourceRoot, [string]$TargetRoot, [string]$Relative,
          $Manifest, [string]$TransactionRoot, $Journal)
    $source = Join-SafePackagePath $SourceRoot $Relative
    $target = Join-SafePackagePath $TargetRoot $Relative
    $parent = [IO.Path]::GetDirectoryName($target)
    [IO.Directory]::CreateDirectory($parent) | Out-Null
    Assert-NoReparsePoint $parent
    $temporary = Join-Path $parent ('.ptv-publish-' + $Journal.transactionId + '.tmp')
    if (Test-Path -LiteralPath $temporary) { throw "Publication temporary file already exists: $temporary" }
    $tempRelative = [IO.Path]::GetRelativePath($TargetRoot, $temporary).Replace('\', '/')
    $Journal.temporaryPaths = @($Journal.temporaryPaths) + @($tempRelative)
    Write-TransactionJournal $TransactionRoot $Journal
    try {
        [IO.File]::Copy($source, $temporary)
        Assert-NoReparsePoint $temporary
        $expected = $Manifest.Entries[$Relative]
        if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$expected.sha256) {
            throw "Staged publication file changed: $Relative"
        }
        if ([IO.File]::Exists($target)) { [IO.File]::Move($temporary, $target, $true) }
        else { [IO.File]::Move($temporary, $target) }
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$expected.sha256) {
            throw "Published file differs from the manifest: $Relative"
        }
    }
    finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
        $Journal.temporaryPaths = @($Journal.temporaryPaths | Where-Object { $_ -cne $tempRelative })
        Write-TransactionJournal $TransactionRoot $Journal
    }
}

function Assert-CurrentTreeRecoverable {
    param([string]$TargetRoot, $Baseline, $Candidate, $Journal)
    $current = Get-PackageTree $TargetRoot
    $delta = Get-ManifestDelta $Baseline $Candidate
    $temporaryPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($relative in @($Journal.temporaryPaths)) { [void]$temporaryPaths.Add([string]$relative) }
    foreach ($relative in $current.Keys) {
        if ($temporaryPaths.Contains($relative)) { continue }
        $allowed = $false
        $actualSha = (Get-FileHash -LiteralPath $current[$relative].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        foreach ($manifest in @($Baseline, $Candidate)) {
            if ($manifest.Entries.ContainsKey($relative) -and
                $manifest.Entries[$relative].path -ceq $relative -and
                $manifest.Entries[$relative].sha256 -ceq $actualSha) { $allowed = $true }
        }
        # A post-write mismatch in a transaction-owned asset is precisely the
        # condition rollback must repair. Never relax this for config or old-only files.
        if (-not $allowed -and $relative -cne 'config.json' -and
            $Candidate.Entries.ContainsKey($relative) -and
            $Candidate.Entries[$relative].path -ceq $relative -and
            ($delta.Added -ccontains $relative -or $delta.Changed -ccontains $relative)) {
            $allowed = $true
        }
        if (-not $allowed) { throw "Recovery found an unexpected or modified Web file: $relative" }
    }
}

function Assert-ProtectedBaselineStage {
    param([string]$TargetRoot, [string]$TransactionRoot, $Journal, $Baseline)
    if ([string]$Journal.transactionId -cnotmatch '^[0-9a-f]{32}$') {
        throw 'Protected baseline stage has an invalid transaction identity.'
    }
    $stage = Join-Path $TransactionRoot ('baseline-' + [string]$Journal.transactionId)
    if (-not [IO.Path]::IsPathFullyQualified([string]$Journal.baselineStagePath) -or
        [IO.Path]::GetFullPath([string]$Journal.baselineStagePath) -ine [IO.Path]::GetFullPath($stage)) {
        throw 'Protected baseline stage does not match the transaction journal.'
    }
    Assert-OutsideTarget $TargetRoot $stage
    Assert-NoReparsePoint $stage
    if (-not (Test-Path -LiteralPath $stage -PathType Container)) {
        throw 'Protected baseline stage is missing.'
    }
    Assert-TreeMatchesManifest $stage $Baseline
    Assert-IndexLiteralAssets $stage $Baseline
    return $stage
}

function Invoke-ExactTreeRollback {
    param([string]$TargetRoot, [string]$BaselineArchive, $Baseline,
          [string]$BaselineSha256, $Candidate, [string]$TransactionRoot, $Journal,
          [scriptblock]$ServedIndexVerifier, [string]$RollbackReference,
          [scriptblock]$RecoveryRefreshCheck)
    Set-TransactionState $TransactionRoot $Journal 'ROLLBACK_REQUIRED'
    # The external backup and reference were verified before baseline staging.
    # Automatic rollback must remain possible if either changes after publication starts.
    $restoreRoot = Assert-ProtectedBaselineStage $TargetRoot $TransactionRoot $Journal $Baseline
    Assert-CurrentTreeRecoverable $TargetRoot $Baseline $Candidate $Journal
    $temporaryTargets = @(
      foreach ($relative in @($Journal.temporaryPaths)) {
        if ($relative -notmatch '(?:^|/)\.ptv-publish-[0-9a-f]{32}\.tmp$') {
            throw "Unsafe recorded publication temporary path: $relative"
        }
        Join-SafePackagePath $TargetRoot $relative
      }
    )
    # Full RecoveryCheck is journal-SHA-bound and runs once before journal mutation.
    # Refresh checks preserve that transaction binding while checking live state.
    if ($RecoveryRefreshCheck) {
        Assert-BooleanApproval $RecoveryRefreshCheck 'Fresh recovery pre-write authorization and session check'
    }
    foreach ($path in $temporaryTargets) {
        if ([IO.File]::Exists($path)) { [IO.File]::Delete($path) }
    }
    $Journal.temporaryPaths = @()
    Write-TransactionJournal $TransactionRoot $Journal
    foreach ($relative in @($Baseline.Entries.Keys | Where-Object { $_ -cne 'index.html' } | Sort-Object)) {
        Copy-VerifiedFileAtomically $restoreRoot $TargetRoot $relative $Baseline $TransactionRoot $Journal
    }
    foreach ($relative in @($Candidate.Entries.Keys | Where-Object { -not $Baseline.Entries.ContainsKey($_) } | Sort-Object)) {
        $path = Join-SafePackagePath $TargetRoot $relative
        if ([IO.File]::Exists($path)) { [IO.File]::Delete($path) }
    }
    if ($RecoveryRefreshCheck) {
        Assert-BooleanApproval $RecoveryRefreshCheck 'Fresh recovery pre-index authorization and session check'
    }
    Copy-VerifiedFileAtomically $restoreRoot $TargetRoot 'index.html' $Baseline $TransactionRoot $Journal
    Assert-TreeMatchesManifest $TargetRoot $Baseline
    Assert-BooleanApproval $ServedIndexVerifier 'Restored served index verification' @([string]$Baseline.Entries['index.html'].sha256)
    Set-TransactionState $TransactionRoot $Journal 'ROLLED_BACK'
}

function Enter-TransactionLock {
    param([string]$TransactionRoot)
    Assert-NoReparsePoint $TransactionRoot
    if (-not (Test-Path -LiteralPath $TransactionRoot -PathType Container)) {
        throw 'Approved transaction root must exist before publication.'
    }
    $lockPath = Join-Path $TransactionRoot '.ptv-web-exact-tree.lock'
    Assert-NoReparsePoint $lockPath
    try {
        return [IO.File]::Open($lockPath,
            [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    }
    catch [IO.IOException] { throw 'Concurrent exact-tree publication lock is held.' }
}

function Stage-PTVWebVerifiedArtifact {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ArchivePath,
        [Parameter(Mandatory)][string]$ManifestPath,
        [Parameter(Mandatory)][string]$ExpectedSha256,
        [Parameter(Mandatory)][string]$StageRoot,
        [Parameter(Mandatory)][string]$ForbiddenTargetRoot
    )
    $archive = [IO.Path]::GetFullPath($ArchivePath)
    $manifestPathFull = [IO.Path]::GetFullPath($ManifestPath)
    $stage = [IO.Path]::GetFullPath($StageRoot)
    $target = [IO.Path]::GetFullPath($ForbiddenTargetRoot)
    foreach ($path in @($archive, $manifestPathFull, $stage, $target)) {
        Assert-NoReparsePoint $path
    }
    if (-not (Test-Path -LiteralPath $target -PathType Container)) {
        throw 'Pinned forbidden Web target must exist for staging containment.'
    }
    foreach ($path in @($stage, $archive, $manifestPathFull)) {
        Assert-OutsideTarget $target $path
    }
    if (Test-Path -LiteralPath $stage) {
        throw 'Verified artifact stage root must be a new, unoccupied path.'
    }
    $manifestSha = (Get-FileHash -LiteralPath $manifestPathFull -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifest = Read-PackageManifest $manifestPathFull
    Assert-ArchiveMatchesManifest $archive $ExpectedSha256 $manifest
    # This function never reads from or writes to the forbidden Web target.
    Expand-VerifiedArchive $archive $stage $manifest
    Assert-IndexLiteralAssets $stage $manifest
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedSha256 -or
        (Get-FileHash -LiteralPath $manifestPathFull -Algorithm SHA256).Hash.ToLowerInvariant() -cne
        $manifestSha) {
        throw 'Frozen artifact changed during staging.'
    }
    return [pscustomobject]@{
        StagePath = $stage
        ArchiveSha256 = $ExpectedSha256
        ManifestSha256 = $manifestSha
        SourceCommit = [string]$manifest.Document.sourceCommit
        FileCount = $manifest.Entries.Count
    }
}

function Test-TransactionJournalReady {
    param([string]$TransactionRoot)
    $path = Join-Path $TransactionRoot 'transaction.json'
    if (-not [IO.File]::Exists($path)) { return }
    Assert-NoReparsePoint $path
    $journal = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -ErrorAction Stop
    if ($journal.state -notin @('COMPLETE', 'ROLLED_BACK')) {
        throw "Previous exact-tree transaction requires explicit recovery: $($journal.state)"
    }
}

function Invoke-PTVWebExactTreePublication {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$EnvironmentId,
        [Parameter(Mandatory)][string]$TargetPath,
        [Parameter(Mandatory)][string]$CandidateArchive,
        [Parameter(Mandatory)][string]$CandidateManifest,
        [Parameter(Mandatory)][string]$CandidateSha256,
        [Parameter(Mandatory)][string]$BaselineArchive,
        [Parameter(Mandatory)][string]$BaselineManifest,
        [Parameter(Mandatory)][string]$BaselineSha256,
        [string]$ExpectedServerId,
        [string]$ExpectedBaselineManifestSha256,
        [Parameter(Mandatory)][string]$RollbackReference,
        [Parameter(Mandatory)][string]$TransactionRoot,
        [Parameter(Mandatory)][scriptblock]$PrePublishCheck,
        [Parameter(Mandatory)][scriptblock]$ServedIndexVerifier,
        [scriptblock]$PublicationObserver
    )
    $target = [IO.Path]::GetFullPath($TargetPath)
    $transaction = [IO.Path]::GetFullPath($TransactionRoot)
    foreach ($path in @($target, $transaction, $CandidateArchive, $CandidateManifest, $BaselineArchive, $BaselineManifest, $RollbackReference)) {
        Assert-NoReparsePoint $path
    }
    foreach ($path in @($transaction, $CandidateArchive, $CandidateManifest, $BaselineArchive, $BaselineManifest, $RollbackReference)) {
        Assert-OutsideTarget $target $path
    }
    $candidate = Read-PackageManifest $CandidateManifest
    $expectedBaselineSha = if ($PSBoundParameters.ContainsKey('ExpectedBaselineManifestSha256')) { $ExpectedBaselineManifestSha256 } else { $null }
    $baseline = Read-BaselineManifest $BaselineManifest $EnvironmentId $ExpectedServerId $target $expectedBaselineSha
    Assert-ConfigIdentity $baseline $candidate
    $rollbackRecord = Assert-RollbackReference $RollbackReference $EnvironmentId $target $candidate $BaselineArchive $BaselineSha256
    $candidateManifestSha256 = (Get-FileHash -LiteralPath $CandidateManifest -Algorithm SHA256).Hash.ToLowerInvariant()
    $baselineManifestSha256 = (Get-FileHash -LiteralPath $BaselineManifest -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($null -ne $expectedBaselineSha -and $baselineManifestSha256 -cne $expectedBaselineSha) {
        throw 'Baseline manifest SHA-256 changed after identity validation.'
    }
    Assert-ArchiveMatchesManifest $CandidateArchive $CandidateSha256 $candidate
    Assert-ArchiveMatchesManifest $BaselineArchive $BaselineSha256 $baseline
    Assert-TreeMatchesManifest $target $baseline
    Assert-IndexLiteralAssets $target $baseline
    $delta = Get-ManifestDelta $baseline $candidate
    $lock = Enter-TransactionLock $transaction
    try {
        Test-TransactionJournalReady $transaction
        # Repeat all mutable-byte checks after obtaining the exclusive lock.
        Assert-ArchiveMatchesManifest $CandidateArchive $CandidateSha256 $candidate
        Assert-ArchiveMatchesManifest $BaselineArchive $BaselineSha256 $baseline
        if ((Assert-RollbackReference $RollbackReference $EnvironmentId $target $candidate $BaselineArchive $BaselineSha256).Sha256 -cne $rollbackRecord.Sha256) {
            throw 'Approved rollback reference changed during preflight.'
        }
        if ((Get-FileHash -LiteralPath $CandidateManifest -Algorithm SHA256).Hash.ToLowerInvariant() -cne $candidateManifestSha256 -or
            (Get-FileHash -LiteralPath $BaselineManifest -Algorithm SHA256).Hash.ToLowerInvariant() -cne $baselineManifestSha256) {
            throw 'Package manifest changed during exact-tree preflight.'
        }
        Assert-TreeMatchesManifest $target $baseline
        $id = [guid]::NewGuid().ToString('N')
        $stage = Join-Path $transaction ('stage-' + $id)
        $baselineStage = Join-Path $transaction ('baseline-' + $id)
        $journal = [ordered]@{
            schemaVersion = 1
            transactionId = $id
            environmentId = $EnvironmentId
            targetPath = $target
            candidateSourceCommit = [string]$candidate.Document.sourceCommit
            candidateArchiveSha256 = $CandidateSha256
            baselineArchiveSha256 = $BaselineSha256
            candidateManifestSha256 = $candidateManifestSha256
            baselineManifestSha256 = $baselineManifestSha256
            candidateManifestPath = [IO.Path]::GetFullPath($CandidateManifest)
            baselineManifestPath = [IO.Path]::GetFullPath($BaselineManifest)
            candidateArchivePath = [IO.Path]::GetFullPath($CandidateArchive)
            baselineArchivePath = [IO.Path]::GetFullPath($BaselineArchive)
            rollbackReferencePath = $rollbackRecord.Path
            rollbackReferenceSha256 = $rollbackRecord.Sha256
            baselineStagePath = $baselineStage
            publicationFileSet = $delta
            temporaryPaths = @()
            state = 'PREFLIGHT'
            startedAt = [DateTimeOffset]::UtcNow.ToString('o')
            updatedAt = $null
            completedAt = $null
        }
        Write-TransactionJournal $transaction $journal
        try {
            Expand-VerifiedArchive $CandidateArchive $stage $candidate $PublicationObserver
            Assert-IndexLiteralAssets $stage $candidate
            if (Test-Path -LiteralPath $baselineStage) { throw 'Protected baseline stage unexpectedly exists.' }
            Expand-VerifiedArchive $BaselineArchive $baselineStage $baseline
            Assert-IndexLiteralAssets $baselineStage $baseline
        }
        catch {
            $stageFailure = $_
            try {
                Assert-TreeMatchesManifest $target $baseline
                Assert-BooleanApproval $ServedIndexVerifier 'Unchanged baseline served index verification' @([string]$baseline.Entries['index.html'].sha256)
                Set-TransactionState $transaction $journal 'ROLLED_BACK'
            }
            catch {
                Set-TransactionState $transaction $journal 'FAILED_RECOVERY'
                throw "Candidate staging failed: $($stageFailure.Exception.Message). Baseline verification failed; explicit recovery is required: $($_.Exception.Message)"
            }
            throw $stageFailure
        }
        Set-TransactionState $transaction $journal 'STAGED'
        Set-TransactionState $transaction $journal 'READY_TO_PUBLISH'
        $targetMutationStarted = $false
        try {
            Assert-TreeMatchesManifest $target $baseline
            Assert-ArchiveMatchesManifest $CandidateArchive $CandidateSha256 $candidate
            if ((Assert-RollbackReference $RollbackReference $EnvironmentId $target $candidate $BaselineArchive $BaselineSha256).Sha256 -cne $rollbackRecord.Sha256) {
                throw 'Approved rollback reference changed before publication.'
            }
            if ((Get-FileHash -LiteralPath $CandidateManifest -Algorithm SHA256).Hash.ToLowerInvariant() -cne $candidateManifestSha256 -or
                (Get-FileHash -LiteralPath $BaselineManifest -Algorithm SHA256).Hash.ToLowerInvariant() -cne $baselineManifestSha256) {
                throw 'Package manifest changed before publication.'
            }
            Assert-ProtectedBaselineStage $target $transaction $journal $baseline | Out-Null
            Assert-BooleanApproval $PrePublishCheck 'Fresh pre-publication approval and session check'
            Set-TransactionState $transaction $journal 'PUBLISHING'
            $targetMutationStarted = $true
            foreach ($relative in @($candidate.Entries.Keys | Where-Object { $_ -cne 'index.html' -and
                    ($delta.Added -contains $_ -or $delta.Changed -contains $_) } | Sort-Object)) {
                if ($PublicationObserver) { & $PublicationObserver 'before-copy' $relative | Out-Null }
                Copy-VerifiedFileAtomically $stage $target $relative $candidate $transaction $journal
                if ($PublicationObserver) { & $PublicationObserver 'publish' $relative | Out-Null }
            }
            foreach ($relative in $delta.Removed) {
                $path = Join-SafePackagePath $target $relative
                if (-not [IO.File]::Exists($path) -or
                    (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne
                    [string]$baseline.Entries[$relative].sha256) {
                    throw "Obsolete asset changed before retirement: $relative"
                }
                [IO.File]::Delete($path)
                if ($PublicationObserver) { & $PublicationObserver 'retire' $relative | Out-Null }
            }
            Assert-BooleanApproval $PrePublishCheck 'Fresh pre-index approval and session check'
            if ($PublicationObserver) { & $PublicationObserver 'before-copy' 'index.html' | Out-Null }
            Copy-VerifiedFileAtomically $stage $target 'index.html' $candidate $transaction $journal
            if ($PublicationObserver) { & $PublicationObserver 'publish' 'index.html' | Out-Null }
            Set-TransactionState $transaction $journal 'VERIFYING'
            Assert-TreeMatchesManifest $target $candidate
            Assert-BooleanApproval $ServedIndexVerifier 'Candidate served index verification' @([string]$candidate.Entries['index.html'].sha256)
            Set-TransactionState $transaction $journal 'COMPLETE'
            return [pscustomobject]@{ State = 'COMPLETE'; Delta = $delta; TransactionId = $id }
        }
        catch {
            $failure = $_
            if ($targetMutationStarted) {
                try { Invoke-ExactTreeRollback $target $BaselineArchive $baseline $BaselineSha256 $candidate $transaction $journal $ServedIndexVerifier $RollbackReference }
                catch {
                    Set-TransactionState $transaction $journal 'FAILED_RECOVERY'
                    throw "Publication failed: $($failure.Exception.Message). Web-only rollback failed: $($_.Exception.Message)"
                }
            }
            else {
                try {
                    Assert-TreeMatchesManifest $target $baseline
                    Assert-IndexLiteralAssets $target $baseline
                    Assert-BooleanApproval $ServedIndexVerifier 'Unchanged baseline served index verification' @([string]$baseline.Entries['index.html'].sha256)
                    Set-TransactionState $transaction $journal 'ROLLED_BACK'
                }
                catch {
                    Set-TransactionState $transaction $journal 'FAILED_RECOVERY'
                    throw "Publication failed: $($failure.Exception.Message). Baseline or served index verification failed; explicit recovery is required: $($_.Exception.Message)"
                }
            }
            throw $failure
        }
    }
    finally { $lock.Dispose() }
}

function Restore-PTVWebExactTreePublication {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$EnvironmentId,
        [Parameter(Mandatory)][string]$TargetPath,
        [Parameter(Mandatory)][string]$CandidateArchive,
        [Parameter(Mandatory)][string]$CandidateManifest,
        [Parameter(Mandatory)][string]$CandidateSha256,
        [Parameter(Mandatory)][string]$BaselineArchive,
        [Parameter(Mandatory)][string]$BaselineManifest,
        [Parameter(Mandatory)][string]$BaselineSha256,
        [string]$ExpectedServerId,
        [string]$ExpectedBaselineManifestSha256,
        [Parameter(Mandatory)][string]$RollbackReference,
        [Parameter(Mandatory)][string]$TransactionRoot,
        [Parameter(Mandatory)][scriptblock]$RecoveryCheck,
        [Parameter(Mandatory)][scriptblock]$RecoveryRefreshCheck,
        [Parameter(Mandatory)][scriptblock]$ServedIndexVerifier,
        [scriptblock]$PublicationObserver
    )
    $target = [IO.Path]::GetFullPath($TargetPath)
    $transaction = [IO.Path]::GetFullPath($TransactionRoot)
    foreach ($path in @($target, $transaction, $CandidateArchive, $CandidateManifest, $BaselineArchive, $BaselineManifest, $RollbackReference)) {
        Assert-NoReparsePoint $path
    }
    foreach ($path in @($transaction, $CandidateArchive, $CandidateManifest, $BaselineArchive, $BaselineManifest, $RollbackReference)) {
        Assert-OutsideTarget $target $path
    }
    $candidate = Read-PackageManifest $CandidateManifest
    $expectedBaselineSha = if ($PSBoundParameters.ContainsKey('ExpectedBaselineManifestSha256')) { $ExpectedBaselineManifestSha256 } else { $null }
    $baseline = Read-BaselineManifest $BaselineManifest $EnvironmentId $ExpectedServerId $target $expectedBaselineSha
    Assert-ConfigIdentity $baseline $candidate
    $rollbackRecord = Assert-RollbackReference $RollbackReference $EnvironmentId $target $candidate $BaselineArchive $BaselineSha256
    if ($null -ne $expectedBaselineSha -and
        (Get-FileHash -LiteralPath $BaselineManifest -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expectedBaselineSha) {
        throw 'Baseline manifest SHA-256 changed after identity validation.'
    }
    Assert-ArchiveMatchesManifest $CandidateArchive $CandidateSha256 $candidate
    Assert-ArchiveMatchesManifest $BaselineArchive $BaselineSha256 $baseline
    $lock = Enter-TransactionLock $transaction
    try {
        $journalPath = Join-Path $transaction 'transaction.json'
        if (-not [IO.File]::Exists($journalPath)) { throw 'There is no interrupted exact-tree transaction to recover.' }
        Assert-NoReparsePoint $journalPath
        $journal = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json -ErrorAction Stop
        if ($journal.schemaVersion -ne 1 -or
            $journal.environmentId -cne $EnvironmentId -or
            [IO.Path]::GetFullPath([string]$journal.targetPath) -ine $target -or
            $journal.candidateSourceCommit -cne [string]$candidate.Document.sourceCommit -or
            $journal.candidateArchiveSha256 -cne $CandidateSha256 -or
            $journal.baselineArchiveSha256 -cne $BaselineSha256 -or
            [IO.Path]::GetFullPath([string]$journal.rollbackReferencePath) -ine $rollbackRecord.Path -or
            $journal.rollbackReferenceSha256 -cne $rollbackRecord.Sha256 -or
            $journal.candidateManifestSha256 -cne (Get-FileHash -LiteralPath $CandidateManifest -Algorithm SHA256).Hash.ToLowerInvariant() -or
            $journal.baselineManifestSha256 -cne (Get-FileHash -LiteralPath $BaselineManifest -Algorithm SHA256).Hash.ToLowerInvariant() -or
            [IO.Path]::GetFullPath([string]$journal.candidateArchivePath) -ine [IO.Path]::GetFullPath($CandidateArchive) -or
            [IO.Path]::GetFullPath([string]$journal.baselineArchivePath) -ine [IO.Path]::GetFullPath($BaselineArchive) -or
            [IO.Path]::GetFullPath([string]$journal.candidateManifestPath) -ine [IO.Path]::GetFullPath($CandidateManifest) -or
            [IO.Path]::GetFullPath([string]$journal.baselineManifestPath) -ine [IO.Path]::GetFullPath($BaselineManifest)) {
            throw 'Interrupted transaction does not bind the exact target, source, artifact, and rollback.'
        }
        if ($journal.state -notin @('PREFLIGHT', 'STAGED', 'READY_TO_PUBLISH',
                'PUBLISHING', 'VERIFYING', 'ROLLBACK_REQUIRED', 'FAILED_RECOVERY')) {
            throw "Transaction is not recoverable in state $($journal.state)."
        }
        Assert-ArchiveMatchesManifest $CandidateArchive $CandidateSha256 $candidate
        Assert-ArchiveMatchesManifest $BaselineArchive $BaselineSha256 $baseline
        # This full check binds the original journal SHA. Subsequent refreshes
        # check the live continuation without rehashing the mutated journal.
        Assert-BooleanApproval $RecoveryCheck 'Protected recovery authorization check'
        try {
            if ($journal.state -in @('PREFLIGHT', 'STAGED', 'READY_TO_PUBLISH')) {
                Assert-TreeMatchesManifest $target $baseline
                Assert-IndexLiteralAssets $target $baseline
                Assert-BooleanApproval $ServedIndexVerifier 'Unchanged baseline served index verification' @([string]$baseline.Entries['index.html'].sha256)
                Assert-BooleanApproval $RecoveryRefreshCheck 'Fresh recovery completion authorization and session check'
                Set-TransactionState $transaction $journal 'ROLLED_BACK'
            }
            else {
                Invoke-ExactTreeRollback $target $BaselineArchive $baseline $BaselineSha256 $candidate $transaction $journal $ServedIndexVerifier $RollbackReference $RecoveryRefreshCheck
            }
        }
        catch {
            Set-TransactionState $transaction $journal 'FAILED_RECOVERY'
            throw
        }
        return [pscustomobject]@{ State = 'ROLLED_BACK'; TransactionId = [string]$journal.transactionId }
    }
    finally { $lock.Dispose() }
}

Export-ModuleMember -Function Invoke-PTVWebExactTreePublication, Restore-PTVWebExactTreePublication, Stage-PTVWebVerifiedArtifact
