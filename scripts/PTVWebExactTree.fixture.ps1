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

function New-Manifest([string]$Directory, [string]$Path,
                      [string]$WebVersion = '0.5.78', [string]$SourceCommit = ('a' * 40)) {
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
        sourceCommit = $SourceCommit
        sourceDirty = $false
        sourceVersions = @{ web = $WebVersion; plugin = '0.5.22.0' }
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
    Set-File $baseline 'service-worker.js' 'old worker'
    Set-File $baseline 'config.json' '{"server":"fixture"}'
    Set-File $candidate 'index.html' 'new index'
    Set-File $candidate 'shared.js' 'new shared'
    Set-File $candidate 'service-worker.js' 'new worker'
    Set-File $candidate 'config.json' '{"server":"fixture"}'
    for ($i = 1; $i -le 7; $i++) {
        Set-File $baseline "old/old-$i.js" "old $i"
        Set-File $candidate "new/new-$i.js" "new $i"
    }
    foreach ($entry in Get-ChildItem -LiteralPath $baseline -Force) {
        Copy-Item -LiteralPath $entry.FullName -Destination $target -Recurse -Force
    }
    $baselineManifest = Join-Path $root 'baseline-manifest.json'
    $candidateManifest = Join-Path $root 'candidate-manifest.json'
    New-Manifest $baseline $baselineManifest '0.5.77' ('f' * 40)
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
        candidateVersions = @{ web = '0.5.78'; plugin = '0.5.22.0' }
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

function Set-InstalledStateBaselineManifest($Fixture) {
    $package = Get-Content -LiteralPath $Fixture.BaselineManifest -Raw | ConvertFrom-Json
    [ordered]@{
        schemaVersion = 1
        environmentId = 'JF_FIXTURE'
        serverId = ('c' * 32)
        installedRoot = $Fixture.Target
        webVersion = '0.5.77'
        sourceCommit = ('f' * 40)
        capturedAt = [DateTimeOffset]::UtcNow.AddMinutes(-2).ToString('o')
        fileCount = @($package.files).Count
        totalBytes = [long](@($package.files | Measure-Object -Property size -Sum)[0].Sum)
        files = @($package.files)
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Fixture.BaselineManifest -Encoding utf8
    return (Get-FileHash -LiteralPath $Fixture.BaselineManifest -Algorithm SHA256).Hash.ToLowerInvariant()
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

function New-SyntheticGate($Fixture, $ApprovalDecision, $SessionApiResponse) {
    return {
        return [bool]($ApprovalDecision.approved -and
            $ApprovalDecision.environmentId -ceq 'JF_FIXTURE' -and
            $ApprovalDecision.serverId -ceq ('c' * 32) -and
            $ApprovalDecision.targetPath -ceq $Fixture.Target -and
            $ApprovalDecision.candidateSha256 -ceq $Fixture.CandidateSha256 -and
            [DateTimeOffset]$ApprovalDecision.expiresAt -gt [DateTimeOffset]::UtcNow -and
            $SessionApiResponse.statusCode -eq 200 -and
            $SessionApiResponse.complete -and
            $SessionApiResponse.serverId -ceq ('c' * 32) -and
            @($SessionApiResponse.activePlaybacks).Count -eq 0)
    }.GetNewClosure()
}

function New-SyntheticApproval($Fixture) {
    return [pscustomobject]@{
        approved = $true
        environmentId = 'JF_FIXTURE'
        serverId = ('c' * 32)
        targetPath = $Fixture.Target
        candidateSha256 = $Fixture.CandidateSha256
        expiresAt = [DateTimeOffset]::UtcNow.AddMinutes(5).ToString('o')
    }
}

function New-SyntheticSessions {
    return [pscustomobject]@{
        statusCode = 200
        complete = $true
        serverId = ('c' * 32)
        activePlaybacks = @()
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
    $recoveryArgs['RecoveryRefreshCheck'] = { return $true }
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
    $recoveryArgs['RecoveryRefreshCheck'] = { return $true }
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
    $recoveryArgs['RecoveryRefreshCheck'] = { return $true }
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
    $recoveryArgs['RecoveryRefreshCheck'] = { return $true }
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
    $recoveryArgs['RecoveryRefreshCheck'] = { return $true }
    Assert-Throws { Restore-PTVWebExactTreePublication @recoveryArgs } 'rollback reference|transaction'
    Assert-Tree $f.Target $f.CandidateManifest
}

Invoke-Fixture 'accepts a hash-pinned installed-state baseline bound to this environment server and target' {
    param($f)
    $baselineManifestSha = Set-InstalledStateBaselineManifest $f
    $publishArgs = Get-PublishArguments $f
    $publishArgs.ExpectedServerId = ('c' * 32)
    $publishArgs.ExpectedBaselineManifestSha256 = $baselineManifestSha
    $result = Invoke-PTVWebExactTreePublication @publishArgs
    Assert-True ($result.State -ceq 'COMPLETE') 'Installed-state baseline publication did not complete.'
    Assert-Tree $f.Target $f.CandidateManifest
    $journal = Get-Content -LiteralPath (Join-Path $f.TransactionRoot 'transaction.json') -Raw | ConvertFrom-Json
    Assert-True ($journal.baselineManifestSha256 -ceq $baselineManifestSha) 'Installed-state baseline digest was not journaled.'
}

Invoke-Fixture 'rejects an installed-state baseline for another environment' {
    param($f)
    Set-InstalledStateBaselineManifest $f | Out-Null
    $manifest = Get-Content -LiteralPath $f.BaselineManifest -Raw | ConvertFrom-Json
    $manifest.environmentId = 'JF_OTHER'
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $f.BaselineManifest
    $publishArgs = Get-PublishArguments $f
    $publishArgs.ExpectedServerId = ('c' * 32)
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'environment'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'rejects an installed-state baseline for another server' {
    param($f)
    Set-InstalledStateBaselineManifest $f | Out-Null
    $manifest = Get-Content -LiteralPath $f.BaselineManifest -Raw | ConvertFrom-Json
    $manifest.serverId = ('d' * 32)
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $f.BaselineManifest
    $publishArgs = Get-PublishArguments $f
    $publishArgs.ExpectedServerId = ('c' * 32)
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'server identity|serverId.*mismatch'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'rejects an installed-state baseline for another target' {
    param($f)
    Set-InstalledStateBaselineManifest $f | Out-Null
    $manifest = Get-Content -LiteralPath $f.BaselineManifest -Raw | ConvertFrom-Json
    $manifest.installedRoot = Join-Path $f.Root 'other-target'
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $f.BaselineManifest
    $publishArgs = Get-PublishArguments $f
    $publishArgs.ExpectedServerId = ('c' * 32)
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'target|root'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'rejects an installed-state baseline with the wrong pinned digest' {
    param($f)
    Set-InstalledStateBaselineManifest $f | Out-Null
    $publishArgs = Get-PublishArguments $f
    $publishArgs.ExpectedServerId = ('c' * 32)
    $publishArgs.ExpectedBaselineManifestSha256 = ('0' * 64)
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'baseline manifest SHA|baseline manifest hash'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'rejects candidate config.json content changes before target mutation' {
    param($f)
    Set-File (Join-Path $f.Root 'candidate') 'config.json' '{"server":"other"}'
    New-Manifest (Join-Path $f.Root 'candidate') $f.CandidateManifest
    Remove-Item -LiteralPath $f.CandidateArchive -Force
    [IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $f.Root 'candidate'), $f.CandidateArchive)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.CandidateSha256 = (Get-FileHash -LiteralPath $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'config.json'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'rejects a candidate that omits config.json before target mutation' {
    param($f)
    Remove-Item -LiteralPath (Join-Path $f.Root 'candidate\config.json') -Force
    New-Manifest (Join-Path $f.Root 'candidate') $f.CandidateManifest
    Remove-Item -LiteralPath $f.CandidateArchive -Force
    [IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $f.Root 'candidate'), $f.CandidateArchive)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.CandidateSha256 = (Get-FileHash -LiteralPath $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'config.json'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'rejects an installed-state baseline without an expected server identity' {
    param($f)
    Set-InstalledStateBaselineManifest $f | Out-Null
    $publishArgs = Get-PublishArguments $f
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'expected server identity'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'rejects installed-state file-count mismatch before target mutation' {
    param($f)
    Set-InstalledStateBaselineManifest $f | Out-Null
    $manifest = Get-Content -LiteralPath $f.BaselineManifest -Raw | ConvertFrom-Json
    $manifest.fileCount++
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $f.BaselineManifest
    $publishArgs = Get-PublishArguments $f
    $publishArgs.ExpectedServerId = ('c' * 32)
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'count'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'rejects installed-state total-byte mismatch before target mutation' {
    param($f)
    Set-InstalledStateBaselineManifest $f | Out-Null
    $manifest = Get-Content -LiteralPath $f.BaselineManifest -Raw | ConvertFrom-Json
    $manifest.totalBytes++
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $f.BaselineManifest
    $publishArgs = Get-PublishArguments $f
    $publishArgs.ExpectedServerId = ('c' * 32)
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'total bytes'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'staging fault after copied entries leaves the installed baseline exact' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.PublicationObserver = {
        param($event, $path)
        if ($event -ceq 'stage' -and $path -ceq 'new/new-2.js') { throw 'fixture staging fault' }
    }
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'staging fault'
    Assert-Tree $f.Target $f.BaselineManifest
    $journal = Get-Content -LiteralPath (Join-Path $f.TransactionRoot 'transaction.json') -Raw | ConvertFrom-Json
    Assert-True ($journal.state -ceq 'ROLLED_BACK') 'Staging failure left a nonterminal transaction.'
}

Invoke-Fixture 'session gates run immediately before the first write and index write' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $events = [Collections.Generic.List[string]]::new()
    $gateCount = [pscustomobject]@{ Value = 0 }
    $publishArgs.PrePublishCheck = {
        $gateCount.Value++
        $events.Add("gate:$($gateCount.Value)")
        return $true
    }.GetNewClosure()
    $publishArgs.PublicationObserver = {
        param($event, $path)
        if ($event -ceq 'before-copy') { $events.Add("copy:$path") }
    }.GetNewClosure()
    Invoke-PTVWebExactTreePublication @publishArgs | Out-Null
    Assert-True ($gateCount.Value -eq 2) 'Expected exactly two session gates.'
    $firstGate = $events.IndexOf('gate:1')
    $secondGate = $events.IndexOf('gate:2')
    Assert-True ($firstGate -ge 0 -and $events[$firstGate + 1] -ceq 'copy:new/new-1.js') 'First gate was not directly before the first asset write.'
    Assert-True ($secondGate -ge 0 -and $events[$secondGate + 1] -ceq 'copy:index.html') 'Second gate was not directly before index publication.'
    Assert-Tree $f.Target $f.CandidateManifest
}

Invoke-Fixture 'fault after all new chunks are copied restores the baseline' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.PublicationObserver = {
        param($event, $path)
        if ($event -ceq 'publish' -and $path -ceq 'new/new-7.js') { throw 'fixture after new chunks' }
    }
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'after new chunks'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'fault during old-only retirement restores every old asset' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.PublicationObserver = {
        param($event, $path)
        if ($event -ceq 'retire' -and $path -ceq 'old/old-3.js') { throw 'fixture cleanup fault' }
    }
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'cleanup fault'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'fault after index publication restores the baseline entry point' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.PublicationObserver = {
        param($event, $path)
        if ($event -ceq 'publish' -and $path -ceq 'index.html') { throw 'fixture post-index fault' }
    }
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'post-index fault'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'post-publication hash mismatch restores the baseline' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.PublicationObserver = {
        param($event, $path)
        if ($event -ceq 'publish' -and $path -ceq 'index.html') {
            Set-File $f.Target 'shared.js' 'corrupted candidate asset'
        }
    }.GetNewClosure()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'differs from the manifest'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'locked destination enters recovery-required state and recovers after unlock' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $lockState = [pscustomobject]@{ Stream = $null }
    $publishArgs.PublicationObserver = {
        param($event, $path)
        if ($event -ceq 'publish' -and $path -ceq 'new/new-2.js') {
            $lockState.Stream = [IO.File]::Open((Join-Path $f.Target 'shared.js'), [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        }
    }.GetNewClosure()
    try {
        $lockedFailure = $null
        try { Invoke-PTVWebExactTreePublication @publishArgs | Out-Null }
        catch { $lockedFailure = $_.Exception.Message }
        Assert-True ($lockedFailure -match 'rollback failed') "Unexpected locked destination result: $lockedFailure"
        $journal = Get-Content -LiteralPath (Join-Path $f.TransactionRoot 'transaction.json') -Raw | ConvertFrom-Json
        Assert-True ($journal.state -ceq 'FAILED_RECOVERY') 'Locked destination did not require explicit recovery.'
    }
    finally { if ($lockState.Stream) { $lockState.Stream.Dispose() } }
    $recoveryArgs = $publishArgs.Clone()
    $recoveryArgs.Remove('PrePublishCheck')
    $recoveryArgs.Remove('PublicationObserver')
    $recoveryArgs['RecoveryCheck'] = { return $true }
    $recoveryArgs['RecoveryRefreshCheck'] = { return $true }
    Restore-PTVWebExactTreePublication @recoveryArgs | Out-Null
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'simulated disk-full during asset copy restores the baseline' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.PublicationObserver = {
        param($event, $path)
        if ($event -ceq 'before-copy' -and $path -ceq 'new/new-3.js') {
            throw [IO.IOException]::new('There is not enough space on the disk.')
        }
    }
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'enough space'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'external rollback archive changed after mutation restores from protected stage' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.PublicationObserver = {
        param($event, $path)
        if ($event -ceq 'publish' -and $path -ceq 'new/new-2.js') {
            [IO.File]::AppendAllText($f.BaselineArchive, 'tampered')
            throw 'fixture rollback archive fault'
        }
    }.GetNewClosure()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'fixture rollback archive fault'
    $journal = Get-Content -LiteralPath (Join-Path $f.TransactionRoot 'transaction.json') -Raw | ConvertFrom-Json
    Assert-True ($journal.state -ceq 'ROLLED_BACK') 'Changed external rollback archive defeated automatic rollback.'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'external rollback archive removed after mutation restores from protected stage' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.PublicationObserver = {
        param($event, $path)
        if ($event -ceq 'publish' -and $path -ceq 'new/new-2.js') {
            Remove-Item -LiteralPath $f.BaselineArchive -Force
            throw 'fixture rollback archive removed'
        }
    }.GetNewClosure()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'fixture rollback archive removed'
    $journal = Get-Content -LiteralPath (Join-Path $f.TransactionRoot 'transaction.json') -Raw | ConvertFrom-Json
    Assert-True ($journal.state -ceq 'ROLLED_BACK') 'Missing external rollback archive defeated automatic rollback.'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'tampered protected baseline stage fails before rollback writes and recovers after repair' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $targetBeforeRollback = [pscustomobject]@{ Value = $null }
    $publishArgs.PublicationObserver = {
        param($event, $path)
        if ($event -ceq 'publish' -and $path -ceq 'new/new-2.js') {
            $journal = Get-Content -LiteralPath (Join-Path $f.TransactionRoot 'transaction.json') -Raw | ConvertFrom-Json
            Set-File $journal.baselineStagePath 'old/old-1.js' 'tampered protected stage'
            $targetBeforeRollback.Value = [string]::Join('|', @(Get-ChildItem -LiteralPath $f.Target -File -Recurse | ForEach-Object {
                '{0}:{1}' -f [IO.Path]::GetRelativePath($f.Target, $_.FullName), (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
            } | Sort-Object))
            throw 'fixture protected stage fault'
        }
    }.GetNewClosure()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'rollback failed|protected stage|baseline stage'
    $afterRollback = [string]::Join('|', @(Get-ChildItem -LiteralPath $f.Target -File -Recurse | ForEach-Object {
        '{0}:{1}' -f [IO.Path]::GetRelativePath($f.Target, $_.FullName), (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    } | Sort-Object))
    Assert-True ($afterRollback -ceq $targetBeforeRollback.Value) 'Tampered stage caused unsafe rollback target writes.'
    $journal = Get-Content -LiteralPath (Join-Path $f.TransactionRoot 'transaction.json') -Raw | ConvertFrom-Json
    Assert-True ($journal.state -ceq 'FAILED_RECOVERY') 'Tampered stage did not require explicit recovery.'
    Copy-Item -LiteralPath (Join-Path $f.Root 'baseline/old/old-1.js') -Destination (Join-Path $journal.baselineStagePath 'old/old-1.js') -Force
    $recoveryArgs = $publishArgs.Clone()
    $recoveryArgs.Remove('PrePublishCheck')
    $recoveryArgs.Remove('PublicationObserver')
    $recoveryArgs['RecoveryCheck'] = { return $true }
    $recoveryArgs['RecoveryRefreshCheck'] = { return $true }
    Restore-PTVWebExactTreePublication @recoveryArgs | Out-Null
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'repeated rollback invocation does not mutate a restored baseline' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.PublicationObserver = {
        param($event, $path)
        if ($event -ceq 'publish' -and $path -ceq 'new/new-2.js') { throw 'fixture one rollback' }
    }
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'one rollback'
    Assert-Tree $f.Target $f.BaselineManifest
    $recoveryArgs = $publishArgs.Clone()
    $recoveryArgs.Remove('PrePublishCheck')
    $recoveryArgs.Remove('PublicationObserver')
    $recoveryArgs['RecoveryCheck'] = { return $true }
    $recoveryArgs['RecoveryRefreshCheck'] = { return $true }
    Assert-Throws { Restore-PTVWebExactTreePublication @recoveryArgs } 'not recoverable'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'synthetic protected approval and session response permit 0.5.78 publication and restart rollback' {
    param($f)
    $baselineManifestSha = Set-InstalledStateBaselineManifest $f
    $publishArgs = Get-PublishArguments $f
    $publishArgs.ExpectedServerId = ('c' * 32)
    $publishArgs.ExpectedBaselineManifestSha256 = $baselineManifestSha
    $approval = New-SyntheticApproval $f
    $sessions = New-SyntheticSessions
    $publishArgs.PrePublishCheck = New-SyntheticGate $f $approval $sessions
    $outside = Join-Path $f.Root 'outside-target-marker.txt'
    [IO.File]::WriteAllText($outside, 'untouched')
    $artifactPaths = @($f.BaselineArchive, $f.CandidateArchive, $f.BaselineManifest,
        $f.CandidateManifest, $f.RollbackReference)
    $artifactHashes = @($artifactPaths | ForEach-Object {
        (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
    })
    Invoke-PTVWebExactTreePublication @publishArgs | Out-Null
    Assert-Tree $f.Target $f.CandidateManifest
    $journalPath = Join-Path $f.TransactionRoot 'transaction.json'
    $journal = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
    $journal.state = 'PUBLISHING'
    $journal | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $journalPath
    $recoveryArgs = $publishArgs.Clone()
    $recoveryArgs.Remove('PrePublishCheck')
    $recoveryArgs['RecoveryCheck'] = New-SyntheticGate $f $approval $sessions
    $recoveryArgs['RecoveryRefreshCheck'] = New-SyntheticGate $f $approval $sessions
    Restore-PTVWebExactTreePublication @recoveryArgs | Out-Null
    Assert-Tree $f.Target $f.BaselineManifest
    Assert-True ([IO.File]::ReadAllText($outside) -ceq 'untouched') 'Publication touched a path outside the target.'
    $artifactHashesAfter = @($artifactPaths | ForEach-Object {
        (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
    })
    Assert-True ([string]::Join('|', $artifactHashes) -ceq [string]::Join('|', $artifactHashesAfter)) 'Publication modified fixture artifacts.'
}

Invoke-Fixture 'synthetic denied approval prevents any target write' {
    param($f)
    Set-InstalledStateBaselineManifest $f | Out-Null
    $publishArgs = Get-PublishArguments $f
    $publishArgs.ExpectedServerId = ('c' * 32)
    $approval = New-SyntheticApproval $f
    $approval.approved = $false
    $sessions = New-SyntheticSessions
    $publishArgs.PrePublishCheck = New-SyntheticGate $f $approval $sessions
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'pre-publication approval'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'synthetic incomplete session response prevents any target write' {
    param($f)
    Set-InstalledStateBaselineManifest $f | Out-Null
    $publishArgs = Get-PublishArguments $f
    $publishArgs.ExpectedServerId = ('c' * 32)
    $approval = New-SyntheticApproval $f
    $sessions = New-SyntheticSessions
    $sessions.complete = $false
    $publishArgs.PrePublishCheck = New-SyntheticGate $f $approval $sessions
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'pre-publication approval'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'synthetic active playback at the second session check restores baseline' {
    param($f)
    Set-InstalledStateBaselineManifest $f | Out-Null
    $publishArgs = Get-PublishArguments $f
    $publishArgs.ExpectedServerId = ('c' * 32)
    $approval = New-SyntheticApproval $f
    $sessions = New-SyntheticSessions
    $gate = New-SyntheticGate $f $approval $sessions
    $gateCount = [pscustomobject]@{ Value = 0 }
    $publishArgs.PrePublishCheck = {
        $gateCount.Value++
        if ($gateCount.Value -eq 2) { $sessions.activePlaybacks = @([pscustomobject]@{ id = 'fixture-playback' }) }
        return (& $gate)
    }.GetNewClosure()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'pre-index approval'
    Assert-True ($gateCount.Value -eq 2) 'Second session gate was not reached.'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'interrupted prewrite states require a verified served baseline index' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.PrePublishCheck = { return $false }
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'pre-publication approval'
    $journalPath = Join-Path $f.TransactionRoot 'transaction.json'
    $recoveryArgs = $publishArgs.Clone()
    $recoveryArgs.Remove('PrePublishCheck')
    $recoveryArgs['RecoveryCheck'] = { return $true }
    $recoveryArgs['RecoveryRefreshCheck'] = { return $true }
    $recoveryArgs['ServedIndexVerifier'] = { param($expectedSha256) return $false }
    foreach ($state in @('PREFLIGHT', 'STAGED', 'READY_TO_PUBLISH')) {
        $journal = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
        $journal.state = $state
        $journal | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $journalPath
        Assert-Throws { Restore-PTVWebExactTreePublication @recoveryArgs } 'served index'
        $after = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
        Assert-True ($after.state -ceq 'FAILED_RECOVERY') "State $state bypassed failed served-index verification."
        Assert-Tree $f.Target $f.BaselineManifest
    }
    $journal = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
    $journal.state = 'READY_TO_PUBLISH'
    $journal | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $journalPath
    $baseline = Get-Content -LiteralPath $f.BaselineManifest -Raw | ConvertFrom-Json
    $expectedIndexSha = @($baseline.files | Where-Object path -ceq 'index.html')[0].sha256
    $seenSha = [pscustomobject]@{ Value = $null }
    $recoveryArgs['ServedIndexVerifier'] = {
        param($expectedSha256)
        $seenSha.Value = $expectedSha256
        return $true
    }.GetNewClosure()
    Restore-PTVWebExactTreePublication @recoveryArgs | Out-Null
    Assert-True ($seenSha.Value -ceq $expectedIndexSha) 'Recovery did not verify the baseline index hash.'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'fresh recovery gate denies before any target write after staging' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    Invoke-PTVWebExactTreePublication @publishArgs | Out-Null
    $journalPath = Join-Path $f.TransactionRoot 'transaction.json'
    $journal = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
    $journal.state = 'PUBLISHING'
    $tempRelative = "new/.ptv-publish-$('a' * 32).tmp"
    $journal.temporaryPaths = @($tempRelative)
    $journal | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $journalPath
    Set-File $f.Target $tempRelative 'unfinished publication temporary file'
    $beforeTarget = [string]::Join('|', @(Get-ChildItem -LiteralPath $f.Target -File -Recurse | ForEach-Object {
        '{0}:{1}' -f [IO.Path]::GetRelativePath($f.Target, $_.FullName), (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    } | Sort-Object))
    $recoveryArgs = $publishArgs.Clone()
    $recoveryArgs.Remove('PrePublishCheck')
    $gateCount = [pscustomobject]@{ Value = 0 }
    $fullCount = [pscustomobject]@{ Value = 0 }
    $recoveryArgs['RecoveryCheck'] = {
        $fullCount.Value++
        return $true
    }.GetNewClosure()
    $recoveryArgs['RecoveryRefreshCheck'] = {
        $gateCount.Value++
        return $false
    }.GetNewClosure()
    Assert-Throws { Restore-PTVWebExactTreePublication @recoveryArgs } 'recovery pre-write|true boolean'
    Assert-True ($fullCount.Value -eq 1) 'Full journal-bound recovery approval was not called exactly once.'
    Assert-True ($gateCount.Value -eq 1) 'Recovery did not refresh authorization after staging.'
    $afterTarget = [string]::Join('|', @(Get-ChildItem -LiteralPath $f.Target -File -Recurse | ForEach-Object {
        '{0}:{1}' -f [IO.Path]::GetRelativePath($f.Target, $_.FullName), (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    } | Sort-Object))
    Assert-True ($afterTarget -ceq $beforeTarget) 'Denied refresh changed the target or removed its temporary file.'
    $after = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
    Assert-True ($after.state -ceq 'FAILED_RECOVERY') 'Denied recovery was not left recovery-required.'
    $recoveryArgs['RecoveryRefreshCheck'] = { return $true }
    Restore-PTVWebExactTreePublication @recoveryArgs | Out-Null
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'fresh recovery gate denies before index restoration and later recovers' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    Invoke-PTVWebExactTreePublication @publishArgs | Out-Null
    $journalPath = Join-Path $f.TransactionRoot 'transaction.json'
    $journal = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
    $journal.state = 'PUBLISHING'
    $journal | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $journalPath
    $recoveryArgs = $publishArgs.Clone()
    $recoveryArgs.Remove('PrePublishCheck')
    $gateCount = [pscustomobject]@{ Value = 0 }
    $fullCount = [pscustomobject]@{ Value = 0 }
    $recoveryArgs['RecoveryCheck'] = {
        $fullCount.Value++
        return $true
    }.GetNewClosure()
    $recoveryArgs['RecoveryRefreshCheck'] = {
        $gateCount.Value++
        return ($gateCount.Value -eq 1)
    }.GetNewClosure()
    Assert-Throws { Restore-PTVWebExactTreePublication @recoveryArgs } 'recovery pre-index|true boolean'
    Assert-True ($fullCount.Value -eq 1) 'Full journal-bound recovery approval was not called exactly once.'
    Assert-True ($gateCount.Value -eq 2) 'Recovery did not refresh authorization before index restoration.'
    Assert-True ([IO.File]::ReadAllText((Join-Path $f.Target 'index.html')) -ceq 'new index') 'Index was restored despite failed gate.'
    $after = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
    Assert-True ($after.state -ceq 'FAILED_RECOVERY') 'Denied index restoration was not left recovery-required.'
    $recoveryArgs['RecoveryRefreshCheck'] = { return $true }
    Restore-PTVWebExactTreePublication @recoveryArgs | Out-Null
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'failed prepublication verifies served baseline before closing journal' {
    param($f)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.PrePublishCheck = { return $false }
    $publishArgs.ServedIndexVerifier = { param($expectedSha256) return $false }
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'baseline|served index|recovery'
    $journal = Get-Content -LiteralPath (Join-Path $f.TransactionRoot 'transaction.json') -Raw | ConvertFrom-Json
    Assert-True ($journal.state -ceq 'FAILED_RECOVERY') 'Unverified served baseline was marked rolled back.'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'candidate index rejects a missing literal local script' {
    param($f)
    $candidateRoot = Join-Path $f.Root 'candidate'
    Set-File $candidateRoot 'index.html' '<html><script defer src="runtime-missing.js?build=1"></script></html>'
    New-Manifest $candidateRoot $f.CandidateManifest
    Remove-Item -LiteralPath $f.CandidateArchive -Force
    [IO.Compression.ZipFile]::CreateFromDirectory($candidateRoot, $f.CandidateArchive)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.CandidateSha256 = (Get-FileHash -LiteralPath $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'index.html.*script|referenced asset|runtime-missing'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'candidate index rejects a missing literal local stylesheet' {
    param($f)
    $candidateRoot = Join-Path $f.Root 'candidate'
    Set-File $candidateRoot 'index.html' '<html><link href="style-missing.css?build=1" rel="stylesheet"></html>'
    New-Manifest $candidateRoot $f.CandidateManifest
    Remove-Item -LiteralPath $f.CandidateArchive -Force
    [IO.Compression.ZipFile]::CreateFromDirectory($candidateRoot, $f.CandidateArchive)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.CandidateSha256 = (Get-FileHash -LiteralPath $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'index.html.*stylesheet|referenced asset|style-missing'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'candidate index maps literal percent-encoded local assets with query strings' {
    param($f)
    $candidateRoot = Join-Path $f.Root 'candidate'
    Set-File $candidateRoot 'index.html' '<html><script defer src="node_modules.%40jellyfin.sdk.bundle.js?build=1"></script><link href="main.css?build=1" rel="stylesheet"></html>'
    Set-File $candidateRoot 'node_modules.@jellyfin.sdk.bundle.js' 'runtime'
    Set-File $candidateRoot 'main.css' 'style'
    New-Manifest $candidateRoot $f.CandidateManifest
    Remove-Item -LiteralPath $f.CandidateArchive -Force
    [IO.Compression.ZipFile]::CreateFromDirectory($candidateRoot, $f.CandidateArchive)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.CandidateSha256 = (Get-FileHash -LiteralPath $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Invoke-PTVWebExactTreePublication @publishArgs | Out-Null
    Assert-Tree $f.Target $f.CandidateManifest
}

Invoke-Fixture 'candidate index rejects external script loading' {
    param($f)
    $candidateRoot = Join-Path $f.Root 'candidate'
    Set-File $candidateRoot 'index.html' '<html><script src="https://cdn.example.invalid/runtime.js"></script></html>'
    New-Manifest $candidateRoot $f.CandidateManifest
    Remove-Item -LiteralPath $f.CandidateArchive -Force
    [IO.Compression.ZipFile]::CreateFromDirectory($candidateRoot, $f.CandidateArchive)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.CandidateSha256 = (Get-FileHash -LiteralPath $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'external|nonlocal|script'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'candidate index rejects protocol-relative stylesheet loading' {
    param($f)
    $candidateRoot = Join-Path $f.Root 'candidate'
    Set-File $candidateRoot 'index.html' '<html><link rel="stylesheet" href="//cdn.example.invalid/main.css"></html>'
    New-Manifest $candidateRoot $f.CandidateManifest
    Remove-Item -LiteralPath $f.CandidateArchive -Force
    [IO.Compression.ZipFile]::CreateFromDirectory($candidateRoot, $f.CandidateArchive)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.CandidateSha256 = (Get-FileHash -LiteralPath $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'external|nonlocal|stylesheet'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'candidate index rejects an unscoped root-relative runtime asset' {
    param($f)
    $candidateRoot = Join-Path $f.Root 'candidate'
    Set-File $candidateRoot 'index.html' '<html><script src="/runtime.js"></script></html>'
    Set-File $candidateRoot 'runtime.js' 'runtime exists in the package'
    New-Manifest $candidateRoot $f.CandidateManifest
    Remove-Item -LiteralPath $f.CandidateArchive -Force
    [IO.Compression.ZipFile]::CreateFromDirectory($candidateRoot, $f.CandidateArchive)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.CandidateSha256 = (Get-FileHash -LiteralPath $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'root-relative|unscoped|/runtime.js'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'candidate index rejects base href redirecting a local runtime asset' {
    param($f)
    $candidateRoot = Join-Path $f.Root 'candidate'
    Set-File $candidateRoot 'index.html' '<html><base href="https://cdn.example.invalid/"><script src="runtime.js"></script></html>'
    Set-File $candidateRoot 'runtime.js' 'runtime exists in the package'
    New-Manifest $candidateRoot $f.CandidateManifest
    Remove-Item -LiteralPath $f.CandidateArchive -Force
    [IO.Compression.ZipFile]::CreateFromDirectory($candidateRoot, $f.CandidateArchive)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.CandidateSha256 = (Get-FileHash -LiteralPath $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'base href|base element|cdn'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'candidate index rejects external script after quoted greater-than' {
    param($f)
    $candidateRoot = Join-Path $f.Root 'candidate'
    Set-File $candidateRoot 'index.html' '<html><script data-x=">" src="https://example.invalid/a.js"></script></html>'
    New-Manifest $candidateRoot $f.CandidateManifest
    Remove-Item -LiteralPath $f.CandidateArchive -Force
    [IO.Compression.ZipFile]::CreateFromDirectory($candidateRoot, $f.CandidateArchive)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.CandidateSha256 = (Get-FileHash -LiteralPath $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'external|nonlocal|script'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'candidate index ignores a script src decoy inside another attribute' {
    param($f)
    $candidateRoot = Join-Path $f.Root 'candidate'
    Set-File $candidateRoot 'index.html' '<html><script data-note=''src="runtime.bundle.js"'' src="https://example.invalid/x.js"></script></html>'
    Set-File $candidateRoot 'runtime.bundle.js' 'decoy runtime'
    New-Manifest $candidateRoot $f.CandidateManifest
    Remove-Item -LiteralPath $f.CandidateArchive -Force
    [IO.Compression.ZipFile]::CreateFromDirectory($candidateRoot, $f.CandidateArchive)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.CandidateSha256 = (Get-FileHash -LiteralPath $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'external|nonlocal|script'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'candidate index rejects external stylesheet after quoted greater-than' {
    param($f)
    $candidateRoot = Join-Path $f.Root 'candidate'
    Set-File $candidateRoot 'index.html' '<html><link data-x=">" href="https://example.invalid/main.css" rel="stylesheet"></html>'
    New-Manifest $candidateRoot $f.CandidateManifest
    Remove-Item -LiteralPath $f.CandidateArchive -Force
    [IO.Compression.ZipFile]::CreateFromDirectory($candidateRoot, $f.CandidateArchive)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.CandidateSha256 = (Get-FileHash -LiteralPath $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'external|nonlocal|stylesheet'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'candidate index ignores a stylesheet href decoy inside another attribute' {
    param($f)
    $candidateRoot = Join-Path $f.Root 'candidate'
    Set-File $candidateRoot 'index.html' '<html><link data-note=''href="main.css"'' href="https://example.invalid/x.css" rel="stylesheet"></html>'
    Set-File $candidateRoot 'main.css' 'decoy style'
    New-Manifest $candidateRoot $f.CandidateManifest
    Remove-Item -LiteralPath $f.CandidateArchive -Force
    [IO.Compression.ZipFile]::CreateFromDirectory($candidateRoot, $f.CandidateArchive)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.CandidateSha256 = (Get-FileHash -LiteralPath $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'external|nonlocal|stylesheet'
    Assert-Tree $f.Target $f.BaselineManifest
}

Invoke-Fixture 'candidate index decodes HTML entities before checking script origin' {
    param($f)
    $candidateRoot = Join-Path $f.Root 'candidate'
    Set-File $candidateRoot 'index.html' '<html><script src="&#x2f;&#x2f;example.invalid/x.js"></script></html>'
    Set-File $candidateRoot '&' 'decoy asset matching a truncated literal URL'
    New-Manifest $candidateRoot $f.CandidateManifest
    Remove-Item -LiteralPath $f.CandidateArchive -Force
    [IO.Compression.ZipFile]::CreateFromDirectory($candidateRoot, $f.CandidateArchive)
    $publishArgs = Get-PublishArguments $f
    $publishArgs.CandidateSha256 = (Get-FileHash -LiteralPath $f.CandidateArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Throws { Invoke-PTVWebExactTreePublication @publishArgs } 'external|nonlocal|script'
    Assert-Tree $f.Target $f.BaselineManifest
}

Write-Host "EXACT_TREE_FIXTURES: $script:passed passed, $script:failed failed"
if ($script:failed -ne 0) { exit 1 }
