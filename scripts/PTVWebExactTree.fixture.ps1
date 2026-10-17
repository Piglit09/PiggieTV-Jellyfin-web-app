<# Disposable exact-tree publication fixtures. Never points at a Jellyfin installation. #>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Import-Module (Join-Path $PSScriptRoot 'PTVWebExactTree.psm1') -Force -DisableNameChecking

$script:passed = 0
$script:failed = 0
$script:tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'

function Assert-True($Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Assert-Throws([scriptblock]$Operation, [string]$Pattern) {
    try { & $Operation | Out-Null }
    catch {
        if ($_.Exception.Message -notmatch $Pattern) {
            throw "Expected rejection matching '$Pattern', got: $($_.Exception.Message)"
        }
        return
    }
    throw "Expected rejection matching '$Pattern'"
}

function New-Manifest([string]$Directory, [string]$Path) {
    $entries = @(Get-ChildItem -LiteralPath $Directory -Recurse -File | ForEach-Object {
        $relative = [IO.Path]::GetRelativePath($Directory, $_.FullName).Replace('\', '/')
        [ordered]@{
            path = $relative
            size = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    } | Sort-Object { $_.path })
    $manifest = [ordered]@{
        schemaVersion = 1
        projectId = 'PTV_WEB'
        sourceCommit = ('a' * 40)
        sourceDirty = $false
        sourceVersions = @{ web = '0.5.75'; plugin = '0.5.22.0' }
        manifestDigest = ('b' * 64)
        files = $entries
    }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Set-File([string]$Directory, [string]$Relative, [string]$Content) {
    $path = Join-Path $Directory $Relative
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)) | Out-Null
    [IO.File]::WriteAllText($path, $Content)
}

function New-Fixture {
    $root = Join-Path $script:tempRoot ('ptv-exact-tree-' + [guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($root) | Out-Null
    $baseline = Join-Path $root 'baseline'
    $candidate = Join-Path $root 'candidate'
    $target = Join-Path $root 'target'
    $transaction = Join-Path $root 'transaction'
    foreach ($dir in @($baseline, $candidate, $target, $transaction)) {
        [IO.Directory]::CreateDirectory($dir) | Out-Null
    }
    Set-File $baseline 'index.html' 'old index'
    Set-File $baseline 'shared.js' 'old shared'
    Set-File $candidate 'index.html' 'new index'
    Set-File $candidate 'shared.js' 'new shared'
    for ($i = 1; $i -le 7; $i++) {
        Set-File $baseline "old/old-$i.js" "old $i"
        Set-File $candidate "new/new-$i.js" "new $i"
    }
    foreach ($entry in Get-ChildItem -LiteralPath $baseline -Force) {
        Copy-Item -LiteralPath $entry.FullName -Destination $target -Recurse -Force
    }
    $baselineManifest = Join-Path $root 'baseline-manifest.json'
    $candidateManifest = Join-Path $root 'candidate-manifest.json'
    New-Manifest $baseline $baselineManifest
    New-Manifest $candidate $candidateManifest
    $baselineArchive = Join-Path $root 'baseline.zip'
    $candidateArchive = Join-Path $root 'candidate.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($baseline, $baselineArchive)
    [IO.Compression.ZipFile]::CreateFromDirectory($candidate, $candidateArchive)
    $rollbackReference = Join-Path $root 'rollback-reference.json'
    [ordered]@{
        schemaVersion = 1
        environmentId = 'JF_FIXTURE'
        targetPath = $target
        candidateSourceCommit = ('a' * 40)
        candidateVersions = @{ web = '0.5.75'; plugin = '0.5.22.0' }
        artifactManifestDigest = ('b' * 64)
        createdAt = [DateTimeOffset]::UtcNow.AddMinutes(-1).ToString('o')
        backupPath = $baselineArchive
        backupSha256 = (Get-FileHash $baselineArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $rollbackReference -Encoding utf8
    return [pscustomobject]@{
        Root = $root
        Target = $target
        TransactionRoot = $transaction
        BaselineArchive = $baselineArchive
        CandidateArchive = $candidateArchive
        BaselineManifest = $baselineManifest
        CandidateManifest = $candidateManifest
        BaselineSha256 = (Get-FileHash $baselineArchive -Algorithm SHA256).Hash.ToLowerInvariant()
        CandidateSha256 = (Get-FileHash $candidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
        RollbackReference = $rollbackReference
    }
}

function Get-PublishArguments($Fixture) {
    return @{
        EnvironmentId = 'JF_FIXTURE'
        TargetPath = $Fixture.Target
        CandidateArchive = $Fixture.CandidateArchive
        CandidateManifest = $Fixture.CandidateManifest
        CandidateSha256 = $Fixture.CandidateSha256
        BaselineArchive = $Fixture.BaselineArchive
        BaselineManifest = $Fixture.BaselineManifest
        BaselineSha256 = $Fixture.BaselineSha256
        RollbackReference = $Fixture.RollbackReference
        TransactionRoot = $Fixture.TransactionRoot
        ServedIndexVerifier = { param($expectedSha256) return $true }
        PrePublishCheck = { return $true }
    }
}

function Assert-Tree([string]$Target, [string]$ManifestPath) {
    $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    $actual = @(Get-ChildItem -LiteralPath $Target -File -Recurse | ForEach-Object {
        [IO.Path]::GetRelativePath($Target, $_.FullName).Replace('\', '/')
    } | Sort-Object)
    $expected = @($manifest.files | ForEach-Object { $_.path } | Sort-Object)
    Assert-True ([string]::Join('|', $actual) -ceq [string]::Join('|', $expected)) 'The target file set differs from the expected manifest.'
    foreach ($entry in $manifest.files) {
        $file = Join-Path $Target $entry.path.Replace('/', '\')
        Assert-True ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $entry.sha256) "Wrong file hash: $($entry.path)"
    }
}

function Invoke-Fixture([string]$Name, [scriptblock]$Body) {
    $fixture = New-Fixture
    try {
        & $Body $fixture
        $script:passed++
        Write-Host "PASS $Name"
    }
    catch {
        $script:failed++
        Write-Host "FAIL $Name`: $($_.Exception.Message)"
    }
    finally {
        $resolved = [IO.Path]::GetFullPath($fixture.Root)
        if (-not $resolved.StartsWith($script:tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Fixture path escaped system temp: $resolved"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

Invoke-Fixture 'publishes exact tree and retires seven obsolete assets before index' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $events = [Collections.Generic.List[string]]::new()
    $publishArgs.PublicationObserver = { param($event, $path) $events.Add("$event`:$path") }.GetNewClosure()
    $result = Invoke-PTVWebExactTreePublication @publishArgs
    Assert-Tree $f.Target $f.CandidateManifest
    Assert-True ($result.State -ceq 'COMPLETE') 'Transaction did not complete.'
    Assert-True ($result.Delta.Removed.Count -eq 7) 'Expected seven retired assets.'
    Assert-True ($result.Delta.Added.Count -eq 7) 'Expected seven new assets.'
    Assert-True ($events[$events.Count - 1] -ceq 'publish:index.html') 'HTML index was not published last.'
}

Invoke-Fixture 'rejects unexpected destination file without target mutation' {
    param($f)
    Set-File $f.Target 'untracked.txt' 'do not delete'
    $publishArgs = Get-PublishArguments $f
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'unexpected|baseline|manifest'
    Assert-True ([IO.File]::ReadAllText((Join-Path $f.Target 'untracked.txt')) -ceq 'do not delete') 'Unexpected destination file changed.'
    Assert-True ([IO.File]::ReadAllText((Join-Path $f.Target 'index.html')) -ceq 'old index') 'Baseline index changed.'
}

Invoke-Fixture 'rejects modified candidate archive before target mutation' {
    param($f)
    [IO.File]::AppendAllText($f.CandidateArchive, 'tamper')
    $publishArgs = Get-PublishArguments $f
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'hash|SHA'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'rejects a traversal path before target mutation' {
    param($f)
    $manifest = Get-Content $f.CandidateManifest -Raw | ConvertFrom-Json
    $manifest.files[0].path = '../escape.txt'
    $manifest | ConvertTo-Json -Depth 8 | Set-Content $f.CandidateManifest
    $publishArgs = Get-PublishArguments $f
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'path|unsafe'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'rejects wrong rollback archive before target mutation' {
    param($f)
    [IO.File]::AppendAllText($f.BaselineArchive, 'tamper')
    $publishArgs = Get-PublishArguments $f
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'hash|SHA'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'publication fault restores complete baseline' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.PublicationObserver = {
        param($event, $path)
        if ($event -eq 'publish' -and $path -ceq 'new/new-2.js') {
            throw 'fixture fault after partial publication'
        }
    }.GetNewClosure()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'fixture fault'
    Assert-Tree $f.Target $f.BaselineManifest
    $journal = Get-Content (Join-Path $f.TransactionRoot 'transaction.json') -Raw | ConvertFrom-Json
    Assert-True ($journal.state -ceq 'ROLLED_BACK') 'Rollback transaction state was not recorded.'
}

Invoke-Fixture 'served-index mismatch restores complete baseline' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.ServedIndexVerifier = { param($expectedSha256) return $false }
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'served index'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'exclusive transaction lock denies concurrent publication' {
    param($f)
    $lockPath = Join-Path $f.TransactionRoot '.ptv-web-exact-tree.lock'
    $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        $publishArgs = Get-PublishArguments $f
        Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'lock|concurrent'
        Assert-Tree $f.Target $f.BaselineManifest
    }
    finally { $lock.Dispose() }
}

Invoke-Fixture 'fresh approval and session gate rejects without target mutation' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.PrePublishCheck = { throw 'fixture active stream' }
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'active stream'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'late pre-index gate failure restores baseline' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $checkState = [pscustomobject]@{ Count = 0 }
    $publishArgs.PrePublishCheck = {
        $checkState.Count++
        if ($checkState.Count -eq 2) { throw 'fixture late active stream' }
        return $true
    }.GetNewClosure()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'late active stream'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'recovery restores baseline from interrupted publishing journal' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    Invoke-PTVWebExactTreePublication @publishArgs | Out-Null
    $journalPath = Join-Path $f.TransactionRoot 'transaction.json'
    $journal = Get-Content $journalPath -Raw | ConvertFrom-Json
    $journal.state = 'PUBLISHING'
    $journal | ConvertTo-Json -Depth 12 | Set-Content $journalPath
    Set-File $f.Target 'index.html' 'old index'
    $recoveryArgs = $publishArgs.Clone()
    $recoveryArgs.Remove('PrePublishCheck')
    $recoveryArgs['RecoveryCheck'] = { return $true }
    $result = Restore-PTVWebExactTreePublication @recoveryArgs
    Assert-True ($result.State -ceq 'ROLLED_BACK') 'Recovery did not reach rolled-back state.'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'recovery authorization failure leaves interrupted target unchanged' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    Invoke-PTVWebExactTreePublication @publishArgs | Out-Null
    $journalPath = Join-Path $f.TransactionRoot 'transaction.json'
    $journal = Get-Content $journalPath -Raw | ConvertFrom-Json
    $journal.state = 'PUBLISHING'
    $journal | ConvertTo-Json -Depth 12 | Set-Content $journalPath
    $recoveryArgs = $publishArgs.Clone()
    $recoveryArgs.Remove('PrePublishCheck')
    $recoveryArgs['RecoveryCheck'] = { throw 'fixture recovery denied' }
    Assert-Throws { Restore-PTVWebExactTreePublication @recoveryArgs } 'recovery denied'
    Assert-Tree $f.Target $f.CandidateManifest
}

Invoke-Fixture 'case-colliding manifest paths are denied before target mutation' {
    param($f)
    $manifest = Get-Content $f.CandidateManifest -Raw | ConvertFrom-Json
    $duplicate = $manifest.files[0].PSObject.Copy()
    $duplicate.path = $duplicate.path.ToUpperInvariant()
    $manifest.files = @($manifest.files) + @($duplicate)
    $manifest | ConvertTo-Json -Depth 8 | Set-Content $f.CandidateManifest
    $publishArgs = Get-PublishArguments $f
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'case-colliding|duplicate'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'archive traversal is denied before target mutation' {
    param($f)
    $zip = [IO.Compression.ZipFile]::Open($f.CandidateArchive, [IO.Compression.ZipArchiveMode]::Update)
    try {
        $entry = $zip.CreateEntry('../escape.txt')
        $writer = [IO.StreamWriter]::new($entry.Open())
        try { $writer.Write('escape') }
        finally { $writer.Dispose() }
    }
    finally { $zip.Dispose() }
    $publishArgs = Get-PublishArguments $f
    $publishArgs.CandidateSha256 = (Get-FileHash $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'unsafe|path'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'target reparse point is denied before target mutation' {
    param($f)
    $outside = Join-Path $f.Root 'outside'
    [IO.Directory]::CreateDirectory($outside) | Out-Null
    New-Item -ItemType Junction -Path (Join-Path $f.Target 'escape') -Target $outside | Out-Null
    $publishArgs = Get-PublishArguments $f
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'reparse'
    Assert-True ([IO.File]::ReadAllText((Join-Path $f.Target 'index.html')) -ceq 'old index') 'Target changed after reparse rejection.'
}

Invoke-Fixture 'case-different installed directory is rejected before mutation' {
    param($f)
    Move-Item -LiteralPath (Join-Path $f.Target 'old') -Destination (Join-Path $f.Target 'intermediate')
    Move-Item -LiteralPath (Join-Path $f.Target 'intermediate') -Destination (Join-Path $f.Target 'OLD')
    $publishArgs = Get-PublishArguments $f
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'case-different|case|path'
    Assert-True ([IO.File]::ReadAllText((Join-Path $f.Target 'index.html')) -ceq 'old index') 'Target changed after path-case rejection.'
}

Invoke-Fixture 'ambiguous pre-publication callback result is rejected without mutation' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.PrePublishCheck = { return 'approved' }
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'pre-publication|check|boolean'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'archive member absent from manifest is denied before mutation' {
    param($f)
    $zip = [IO.Compression.ZipFile]::Open($f.CandidateArchive, [IO.Compression.ZipArchiveMode]::Update)
    try {
        $entry = $zip.CreateEntry('extra.js')
        $writer = [IO.StreamWriter]::new($entry.Open())
        try { $writer.Write('not listed') }
        finally { $writer.Dispose() }
    }
    finally { $zip.Dispose() }
    $publishArgs = Get-PublishArguments $f
    $publishArgs.CandidateSha256 = (Get-FileHash $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'unexpected manifest entry|manifest'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'Unix symlink member is denied before mutation' {
    param($f)
    $zip = [IO.Compression.ZipFile]::Open($f.CandidateArchive, [IO.Compression.ZipArchiveMode]::Update)
    try {
        $entry = $zip.GetEntry('new/new-1.js')
        $entry.ExternalAttributes = [int]::Parse('A1FF0000', [Globalization.NumberStyles]::HexNumber)
    }
    finally { $zip.Dispose() }
    $publishArgs = Get-PublishArguments $f
    $publishArgs.CandidateSha256 = (Get-FileHash $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'unsupported file type'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'changed installed baseline is denied before mutation' {
    param($f)
    Set-File $f.Target 'shared.js' 'unexpected target change'
    $publishArgs = Get-PublishArguments $f
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'differs from the manifest'
    Assert-True ([IO.File]::ReadAllText((Join-Path $f.Target 'shared.js')) -ceq 'unexpected target change') 'Denied deployment modified the target.'
}

Invoke-Fixture 'recovery rejects a changed rollback manifest without target mutation' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    Invoke-PTVWebExactTreePublication @publishArgs | Out-Null
    $journalPath = Join-Path $f.TransactionRoot 'transaction.json'
    $journal = Get-Content $journalPath -Raw | ConvertFrom-Json
    $journal.state = 'PUBLISHING'
    $journal | ConvertTo-Json -Depth 12 | Set-Content $journalPath
    [IO.File]::AppendAllText($f.BaselineManifest, ' ')
    $recoveryArgs = $publishArgs.Clone()
    $recoveryArgs.Remove('PrePublishCheck')
    $recoveryArgs['RecoveryCheck'] = { return $true }
    Assert-Throws { Restore-PTVWebExactTreePublication @recoveryArgs } 'manifest|rollback'
    Assert-Tree $f.Target $f.CandidateManifest
}

Invoke-Fixture 'unverified served rollback records failed recovery' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.ServedIndexVerifier = { param($expectedSha256) return $false }
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'rollback failed'
    Assert-Tree $f.Target $f.BaselineManifest
    $journal = Get-Content (Join-Path $f.TransactionRoot 'transaction.json') -Raw | ConvertFrom-Json
    Assert-True ($journal.state -ceq 'FAILED_RECOVERY') 'Failed served-index rollback was falsely marked complete.'
}

Invoke-Fixture 'verified frozen archive stages outside Web target without target mutation' {
    param($f)
    $stage = Join-Path $f.Root 'preflight-stage'
    $result = Stage-PTVWebVerifiedArtifact -ArchivePath $f.CandidateArchive -ManifestPath $f.CandidateManifest `
        -ExpectedSha256 $f.CandidateSha256 -StageRoot $stage -ForbiddenTargetRoot $f.Target
    Assert-True ($result.StagePath -ceq [IO.Path]::GetFullPath($stage)) 'Staging returned the wrong root.'
    Assert-Tree $stage $f.CandidateManifest
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'staging refuses a path inside Web target' {
    param($f)
    $stage = Join-Path $f.Target 'preflight-stage'
    Assert-Throws {
        Stage-PTVWebVerifiedArtifact -ArchivePath $f.CandidateArchive -ManifestPath $f.CandidateManifest `
            -ExpectedSha256 $f.CandidateSha256 -StageRoot $stage -ForbiddenTargetRoot $f.Target
    } 'outside|target'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'staging rejects tampered archive without writing target' {
    param($f)
    [IO.File]::AppendAllText($f.CandidateArchive, 'tamper')
    $stage = Join-Path $f.Root 'preflight-stage'
    Assert-Throws {
        Stage-PTVWebVerifiedArtifact -ArchivePath $f.CandidateArchive -ManifestPath $f.CandidateManifest `
            -ExpectedSha256 $f.CandidateSha256 -StageRoot $stage -ForbiddenTargetRoot $f.Target
    } 'SHA|hash'
    Assert-True (-not (Test-Path -LiteralPath $stage)) 'Rejected artifact created staging output.'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'staging rejects traversal member before extracting' {
    param($f)
    $zip = [IO.Compression.ZipFile]::Open($f.CandidateArchive, [IO.Compression.ZipArchiveMode]::Update)
    try {
        $entry = $zip.CreateEntry('../escape.txt')
        $writer = [IO.StreamWriter]::new($entry.Open())
        try { $writer.Write('escape') }
        finally { $writer.Dispose() }
    }
    finally { $zip.Dispose() }
    $stage = Join-Path $f.Root 'preflight-stage'
    Assert-Throws {
        Stage-PTVWebVerifiedArtifact -ArchivePath $f.CandidateArchive -ManifestPath $f.CandidateManifest `
            -ExpectedSha256 (Get-FileHash $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant() `
            -StageRoot $stage -ForbiddenTargetRoot $f.Target
    } 'Unsafe package path'
    Assert-True (-not (Test-Path -LiteralPath $stage)) 'Rejected traversal created staging output.'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'staging rejects manifest case collision before extracting' {
    param($f)
    $manifest = Get-Content $f.CandidateManifest -Raw | ConvertFrom-Json
    $duplicate = $manifest.files[0].PSObject.Copy()
    $duplicate.path = $duplicate.path.ToUpperInvariant()
    $manifest.files = @($manifest.files) + @($duplicate)
    $manifest | ConvertTo-Json -Depth 8 | Set-Content $f.CandidateManifest
    $stage = Join-Path $f.Root 'preflight-stage'
    Assert-Throws {
        Stage-PTVWebVerifiedArtifact -ArchivePath $f.CandidateArchive -ManifestPath $f.CandidateManifest `
            -ExpectedSha256 $f.CandidateSha256 -StageRoot $stage -ForbiddenTargetRoot $f.Target
    } 'case-colliding|duplicate'
    Assert-True (-not (Test-Path -LiteralPath $stage)) 'Rejected manifest created staging output.'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'staging rejects a reparse-point destination' {
    param($f)
    $outside = Join-Path $f.Root 'outside'
    [IO.Directory]::CreateDirectory($outside) | Out-Null
    $stage = Join-Path $f.Root 'preflight-stage'
    New-Item -ItemType Junction -Path $stage -Target $outside | Out-Null
    Assert-Throws {
        Stage-PTVWebVerifiedArtifact -ArchivePath $f.CandidateArchive -ManifestPath $f.CandidateManifest `
            -ExpectedSha256 $f.CandidateSha256 -StageRoot $stage -ForbiddenTargetRoot $f.Target
    } 'reparse'
    Assert-True (@(Get-ChildItem -LiteralPath $outside -Force).Count -eq 0) 'Rejected reparse staging wrote through junction.'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'transaction journal binds the approved rollback record path and hash' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    Invoke-PTVWebExactTreePublication @publishArgs | Out-Null
    $journal = Get-Content (Join-Path $f.TransactionRoot 'transaction.json') -Raw | ConvertFrom-Json
    Assert-True ($journal.rollbackReferencePath -ceq [IO.Path]::GetFullPath($f.RollbackReference)) 'Journal omitted the approved rollback record path.'
    Assert-True ($journal.rollbackReferenceSha256 -ceq (Get-FileHash $f.RollbackReference -Algorithm SHA256).Hash.ToLowerInvariant()) 'Journal omitted the approved rollback record hash.'
    Assert-Tree $f.Target $f.CandidateManifest
}

Invoke-Fixture 'publication rejects mismatched rollback record without touching target' {
    param($f)
    $record = Get-Content $f.RollbackReference -Raw | ConvertFrom-Json
    $record.backupSha256 = ('c' * 64)
    $record | ConvertTo-Json -Depth 8 | Set-Content $f.RollbackReference
    $publishArgs = Get-PublishArguments $f
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'rollback reference|rollback record'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'interrupted recovery rejects a different rollback record path' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    Invoke-PTVWebExactTreePublication @publishArgs | Out-Null
    $journalPath = Join-Path $f.TransactionRoot 'transaction.json'
    $journal = Get-Content $journalPath -Raw | ConvertFrom-Json
    $journal.state = 'PUBLISHING'
    $journal | ConvertTo-Json -Depth 12 | Set-Content $journalPath
    $other = Join-Path $f.Root 'alternate-rollback-reference.json'
    Copy-Item -LiteralPath $f.RollbackReference -Destination $other
    $recoveryArgs = $publishArgs.Clone()
    $recoveryArgs.Remove('PrePublishCheck')
    $recoveryArgs['RecoveryCheck'] = { return $true }
    $recoveryArgs['RollbackReference'] = $other
    Assert-Throws { Restore-PTVWebExactTreePublication @recoveryArgs } 'rollback reference|transaction'
    Assert-Tree $f.Target $f.CandidateManifest
}

Invoke-Fixture 'interrupted recovery rejects a modified rollback record' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    Invoke-PTVWebExactTreePublication @publishArgs | Out-Null
    $journalPath = Join-Path $f.TransactionRoot 'transaction.json'
    $journal = Get-Content $journalPath -Raw | ConvertFrom-Json
    $journal.state = 'PUBLISHING'
    $journal | ConvertTo-Json -Depth 12 | Set-Content $journalPath
    [IO.File]::AppendAllText($f.RollbackReference, ' ')
    $recoveryArgs = $publishArgs.Clone()
    $recoveryArgs.Remove('PrePublishCheck')
    $recoveryArgs['RecoveryCheck'] = { return $true }
    Assert-Throws { Restore-PTVWebExactTreePublication @recoveryArgs } 'rollback reference|transaction'
    Assert-Tree $f.Target $f.CandidateManifest
}

Write-Host "EXACT_TREE_FIXTURES: $script:passed passed, $script:failed failed"
if ($script:failed -ne 0) { exit 1 }
