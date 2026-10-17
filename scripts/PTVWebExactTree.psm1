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
    return [pscustomobject]@{ Document = $manifest; Entries = $map }
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
    param([string]$ArchivePath, [string]$Destination, $Manifest)
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
        if (-not $allowed) { throw "Recovery found an unexpected or modified Web file: $relative" }
    }
}

function Invoke-ExactTreeRollback {
    param([string]$TargetRoot, [string]$BaselineArchive, $Baseline,
          [string]$BaselineSha256, $Candidate, [string]$TransactionRoot, $Journal,
          [scriptblock]$ServedIndexVerifier, [string]$RollbackReference)
    Set-TransactionState $TransactionRoot $Journal 'ROLLBACK_REQUIRED'
    $reference = Assert-RollbackReference $RollbackReference $Journal.environmentId $TargetRoot $Candidate $BaselineArchive $BaselineSha256
    if ($reference.Path -ine $Journal.rollbackReferencePath -or
        $reference.Sha256 -cne $Journal.rollbackReferenceSha256) {
        throw 'Approved rollback reference changed during publication.'
    }
    Assert-ArchiveMatchesManifest $BaselineArchive $BaselineSha256 $Baseline
    Assert-CurrentTreeRecoverable $TargetRoot $Baseline $Candidate $Journal
    foreach ($relative in @($Journal.temporaryPaths)) {
        if ($relative -notmatch '(?:^|/)\.ptv-publish-[0-9a-f]{32}\.tmp$') {
            throw "Unsafe recorded publication temporary path: $relative"
        }
        $path = Join-SafePackagePath $TargetRoot $relative
        if ([IO.File]::Exists($path)) { [IO.File]::Delete($path) }
    }
    $Journal.temporaryPaths = @()
    Write-TransactionJournal $TransactionRoot $Journal
    $restoreRoot = Join-Path $TransactionRoot ('restore-' + $Journal.transactionId + '-' + [guid]::NewGuid().ToString('N'))
    if (Test-Path -LiteralPath $restoreRoot) { throw 'Recovery staging directory unexpectedly exists.' }
    Expand-VerifiedArchive $BaselineArchive $restoreRoot $Baseline
    foreach ($relative in @($Baseline.Entries.Keys | Where-Object { $_ -cne 'index.html' } | Sort-Object)) {
        Copy-VerifiedFileAtomically $restoreRoot $TargetRoot $relative $Baseline $TransactionRoot $Journal
    }
    foreach ($relative in @($Candidate.Entries.Keys | Where-Object { -not $Baseline.Entries.ContainsKey($_) } | Sort-Object)) {
        $path = Join-SafePackagePath $TargetRoot $relative
        if ([IO.File]::Exists($path)) { [IO.File]::Delete($path) }
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
    $baseline = Read-PackageManifest $BaselineManifest
    $rollbackRecord = Assert-RollbackReference $RollbackReference $EnvironmentId $target $candidate $BaselineArchive $BaselineSha256
    $candidateManifestSha256 = (Get-FileHash -LiteralPath $CandidateManifest -Algorithm SHA256).Hash.ToLowerInvariant()
    $baselineManifestSha256 = (Get-FileHash -LiteralPath $BaselineManifest -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-ArchiveMatchesManifest $CandidateArchive $CandidateSha256 $candidate
    Assert-ArchiveMatchesManifest $BaselineArchive $BaselineSha256 $baseline
    Assert-TreeMatchesManifest $target $baseline
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
            publicationFileSet = $delta
            temporaryPaths = @()
            state = 'PREFLIGHT'
            startedAt = [DateTimeOffset]::UtcNow.ToString('o')
            updatedAt = $null
            completedAt = $null
        }
        Write-TransactionJournal $transaction $journal
        Expand-VerifiedArchive $CandidateArchive $stage $candidate
        Set-TransactionState $transaction $journal 'STAGED'
        Set-TransactionState $transaction $journal 'READY_TO_PUBLISH'
        $targetMutationStarted = $false
        try {
            Assert-BooleanApproval $PrePublishCheck 'Fresh pre-publication approval and session check'
            Assert-TreeMatchesManifest $target $baseline
            Assert-ArchiveMatchesManifest $CandidateArchive $CandidateSha256 $candidate
            if ((Assert-RollbackReference $RollbackReference $EnvironmentId $target $candidate $BaselineArchive $BaselineSha256).Sha256 -cne $rollbackRecord.Sha256) {
                throw 'Approved rollback reference changed before publication.'
            }
            if ((Get-FileHash -LiteralPath $CandidateManifest -Algorithm SHA256).Hash.ToLowerInvariant() -cne $candidateManifestSha256 -or
                (Get-FileHash -LiteralPath $BaselineManifest -Algorithm SHA256).Hash.ToLowerInvariant() -cne $baselineManifestSha256) {
                throw 'Package manifest changed before publication.'
            }
            Set-TransactionState $transaction $journal 'PUBLISHING'
            $targetMutationStarted = $true
            foreach ($relative in @($candidate.Entries.Keys | Where-Object { $_ -cne 'index.html' -and
                    ($delta.Added -contains $_ -or $delta.Changed -contains $_) } | Sort-Object)) {
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
            else { Set-TransactionState $transaction $journal 'ROLLED_BACK' }
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
        [Parameter(Mandatory)][string]$RollbackReference,
        [Parameter(Mandatory)][string]$TransactionRoot,
        [Parameter(Mandatory)][scriptblock]$RecoveryCheck,
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
    $baseline = Read-PackageManifest $BaselineManifest
    $rollbackRecord = Assert-RollbackReference $RollbackReference $EnvironmentId $target $candidate $BaselineArchive $BaselineSha256
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
        Assert-BooleanApproval $RecoveryCheck 'Protected recovery authorization check'
        Assert-ArchiveMatchesManifest $CandidateArchive $CandidateSha256 $candidate
        Assert-ArchiveMatchesManifest $BaselineArchive $BaselineSha256 $baseline
        try {
            if ($journal.state -in @('PREFLIGHT', 'STAGED', 'READY_TO_PUBLISH')) {
                Assert-TreeMatchesManifest $target $baseline
                Set-TransactionState $transaction $journal 'ROLLED_BACK'
            }
            else {
                Invoke-ExactTreeRollback $target $BaselineArchive $baseline $BaselineSha256 $candidate $transaction $journal $ServedIndexVerifier $RollbackReference
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
