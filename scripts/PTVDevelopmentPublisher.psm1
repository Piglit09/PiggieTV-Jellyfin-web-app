#requires -Version 7.0
# File publication mechanics for the registered disposable .125 installation.
# The caller must complete protected policy, artifact, and live identity checks.
Set-StrictMode -Version Latest

function Assert-DevEnvironment([string]$EnvironmentId) {
    if ($EnvironmentId -cne 'JF_DEVELOPMENT_125') { throw 'Only JF_DEVELOPMENT_125 is supported.' }
}

function Assert-DevNoReparse([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Reparse point in development publication path: $cursor"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if (-not $parent -or $parent -ceq $cursor) { break }
        $cursor = $parent
    }
}

function Assert-DevRelative([string]$Relative) {
    if (-not $Relative -or $Relative.Contains('\') -or $Relative.Contains(':') -or
        $Relative.StartsWith('/') -or $Relative.EndsWith('/') -or $Relative.Contains('//')) {
        throw "Unexpected package path: $Relative"
    }
    foreach ($part in $Relative.Split('/')) {
        if ($part -in @('.', '..') -or $part -notmatch '^[^<>:"|?*\x00-\x1f]+$' -or
            $part.EndsWith('.') -or $part.EndsWith(' ') -or
            $part.Split('.')[0] -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$') {
            throw "Unexpected package path: $Relative"
        }
    }
}

function Join-DevFile([string]$Root, [string]$Relative) {
    Assert-DevRelative $Relative
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $file = [IO.Path]::GetFullPath((Join-Path $base $Relative.Replace('/', '\')))
    if (-not $file.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Package path escaped target root.'
    }
    Assert-DevNoReparse $file
    return $file
}

function Read-DevWebManifest([string]$Path) {
    Assert-DevNoReparse $Path
    $document = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ($document.schemaVersion -ne 1 -or $document.projectId -cne 'PTV_WEB' -or
        @($document.files).Count -eq 0) { throw 'Invalid PTV Web manifest.' }
    $files = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in @($document.files)) {
        $relative = [string]$entry.path
        Assert-DevRelative $relative
        if ($files.ContainsKey($relative) -or [string]$entry.sha256 -cnotmatch '^[0-9a-f]{64}$' -or
            $null -eq $entry.size -or [long]$entry.size -lt 0) {
            throw "Invalid or duplicate Web manifest entry: $relative"
        }
        $files.Add($relative, $entry)
    }
    if (-not $files.ContainsKey('index.html') -or -not $files.ContainsKey('config.json')) {
        throw 'Web manifest lacks index or configuration.'
    }
    return $files
}

function Get-DevTree([string]$Root) {
    Assert-DevNoReparse $Root
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw "Publication root absent: $Root" }
    $files = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::OrdinalIgnoreCase)
    $stack = [Collections.Generic.Stack[string]]::new()
    $stack.Push([IO.Path]::GetFullPath($Root))
    while ($stack.Count -gt 0) {
        $directory = $stack.Pop()
        foreach ($item in Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Reparse point in publication tree: $($item.FullName)"
            }
            if ($item -is [IO.DirectoryInfo]) { $stack.Push($item.FullName); continue }
            if ($item -isnot [IO.FileInfo]) { throw 'Unexpected publication tree item.' }
            $relative = [IO.Path]::GetRelativePath($Root, $item.FullName).Replace('\', '/')
            Assert-DevRelative $relative
            if ($files.ContainsKey($relative)) { throw "Case-colliding file: $relative" }
            $files.Add($relative, $item)
        }
    }
    return $files
}

function Assert-DevFileHash($File, $Entry, [string]$Relative) {
    if ($File.Length -ne [long]$Entry.size -or
        (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$Entry.sha256) {
        throw "File differs from manifest: $Relative"
    }
}

function Assert-DevCandidate([string]$Root, $Manifest) {
    $actual = Get-DevTree $Root
    if ($actual.Count -ne $Manifest.Count) { throw 'Candidate tree differs from manifest file count.' }
    foreach ($relative in $Manifest.Keys) {
        if (-not $actual.ContainsKey($relative) -or
            [IO.Path]::GetRelativePath($Root, $actual[$relative].FullName).Replace('\', '/') -cne $relative) {
            throw "Candidate tree differs from manifest: $relative"
        }
        Assert-DevFileHash $actual[$relative] $Manifest[$relative] $relative
    }
}

function Assert-DevRecoverable([string]$Root, $Installed, $Candidate) {
    $actual = Get-DevTree $Root
    if (-not $actual.ContainsKey('index.html')) { throw 'Installed Web index is absent.' }
    foreach ($relative in $actual.Keys) {
        $matches = $false
        foreach ($manifest in @($Installed, $Candidate)) {
            if ($manifest.ContainsKey($relative) -and $manifest[$relative].path -ceq $relative) {
                try { Assert-DevFileHash $actual[$relative] $manifest[$relative] $relative; $matches = $true; break }
                catch { }
            }
        }
        if (-not $matches) { throw "Installed Web tree differs from both manifests: $relative" }
    }
    foreach ($relative in $Installed.Keys) {
        if (-not $Candidate.ContainsKey($relative) -and $actual.ContainsKey($relative)) {
            Assert-DevFileHash $actual[$relative] $Installed[$relative] $relative
        }
    }
}

function Remove-DevOrphanTemps([string]$Root) {
    # A process crash may leave a copy temporary. Only the publisher's own
    # reserved filenames can be removed; all other unknown files still block.
    Assert-DevNoReparse $Root
    foreach ($file in @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force -ErrorAction Stop |
        Where-Object { $_.Name -cmatch '^\.ptv-dev-[0-9a-f]{32}\.tmp$' })) {
        Assert-DevNoReparse $file.FullName
        [IO.File]::Delete($file.FullName)
    }
}

function Copy-DevAtomic([string]$Source, [string]$Target, [string]$ExpectedSha256) {
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Target))
    Assert-DevNoReparse ([IO.Path]::GetDirectoryName($Target))
    $temporary = Join-Path ([IO.Path]::GetDirectoryName($Target)) ('.ptv-dev-' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [IO.File]::Copy($Source, $temporary)
        if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedSha256) {
            throw 'Staged development file changed.'
        }
        [IO.File]::Move($temporary, $Target, $true)
        if ((Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedSha256) {
            throw 'Published development file changed.'
        }
    }
    finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}

function Publish-PTVDevelopmentWeb {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$EnvironmentId,
        [Parameter(Mandatory)][string]$TargetPath,
        [Parameter(Mandatory)][string]$CandidateRoot,
        [Parameter(Mandatory)][string]$CandidateManifest,
        [Parameter(Mandatory)][string]$InstalledManifest,
        [scriptblock]$PublicationObserver
    )
    Assert-DevEnvironment $EnvironmentId
    $target = [IO.Path]::GetFullPath($TargetPath)
    $candidateRootFull = [IO.Path]::GetFullPath($CandidateRoot)
    if ($target -ieq $candidateRootFull -or $candidateRootFull.StartsWith($target.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Candidate Web distribution must be outside the target.'
    }
    $candidate = Read-DevWebManifest $CandidateManifest
    $installed = Read-DevWebManifest $InstalledManifest
    if ($candidate['config.json'].sha256 -cne $installed['config.json'].sha256) {
        throw 'Web config change requires separate configuration authorization.'
    }
    Assert-DevCandidate $candidateRootFull $candidate
    Remove-DevOrphanTemps $target
    Assert-DevRecoverable $target $installed $candidate
    foreach ($relative in @($candidate.Keys | Where-Object { $_ -cne 'index.html' } | Sort-Object)) {
        $source = Join-DevFile $candidateRootFull $relative
        $destination = Join-DevFile $target $relative
        if ((Test-Path -LiteralPath $destination) -and
            (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ceq [string]$candidate[$relative].sha256) {
            continue
        }
        Copy-DevAtomic $source $destination ([string]$candidate[$relative].sha256)
        if ($PublicationObserver) { & $PublicationObserver 'publish' $relative | Out-Null }
    }
    foreach ($relative in @($installed.Keys | Where-Object { -not $candidate.ContainsKey($_) } | Sort-Object)) {
        $destination = Join-DevFile $target $relative
        if (Test-Path -LiteralPath $destination) {
            $file = Get-Item -LiteralPath $destination
            Assert-DevFileHash $file $installed[$relative] $relative
            [IO.File]::Delete($destination)
            if ($PublicationObserver) { & $PublicationObserver 'retire' $relative | Out-Null }
        }
    }
    # The new index becomes visible only after obsolete manifest-owned assets retire.
    Copy-DevAtomic (Join-DevFile $candidateRootFull 'index.html') (Join-DevFile $target 'index.html') ([string]$candidate['index.html'].sha256)
    if ($PublicationObserver) { & $PublicationObserver 'publish' 'index.html' | Out-Null }
    Assert-DevCandidate $target $candidate
    return [pscustomobject]@{ State = 'COMPLETE'; FileCount = $candidate.Count; IndexSha256 = [string]$candidate['index.html'].sha256 }
}

function Install-PTVDevelopmentPlugin {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$EnvironmentId,
        [Parameter(Mandatory)][string]$TargetPath,
        [Parameter(Mandatory)][string]$StageRoot,
        [Parameter(Mandatory)][string]$StageManifest,
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string]$TransactionRoot,
        [scriptblock]$BeforeSwitch,
        [scriptblock]$AfterOldMove,
        [ref]$RollbackComplete
    )
    Assert-DevEnvironment $EnvironmentId
    if ($RollbackComplete) { $RollbackComplete.Value = $true }
    $target = [IO.Path]::GetFullPath($TargetPath)
    $stage = [IO.Path]::GetFullPath($StageRoot)
    if ($stage -ieq $target -or $stage.StartsWith($target.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Plugin stage must be outside its target.'
    }
    $files = Get-DevTree $stage
    Assert-DevNoReparse $StageManifest
    $manifest = Get-Content -LiteralPath $StageManifest -Raw -ErrorAction Stop | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    $manifestVersion = if ($manifest.Contains('version')) { $manifest['version'] } else { $manifest['sourceVersions']['plugin'] }
    if ($manifest.schemaVersion -ne 1 -or $manifestVersion -cne $Version) {
        throw 'Plugin stage manifest version differs from the candidate.'
    }
    $expected = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in @($manifest.files)) {
        $relative = [string]$entry.path
        Assert-DevRelative $relative
        if ($relative -in @('Jellyfin.Plugin.PiggieTV.deps.json', 'Jellyfin.Plugin.PiggieTV.dll',
                'Jellyfin.Plugin.PiggieTV.pdb', 'Jellyfin.Plugin.PiggieTV.xml', 'meta.json') -or
            $relative.StartsWith('helpers/win-x64/', [StringComparison]::Ordinal)) {
            if ($expected.ContainsKey($relative) -or [string]$entry.sha256 -cnotmatch '^[0-9a-f]{64}$' -or
                $null -eq $entry.size -or [long]$entry.size -lt 0) {
                throw "Invalid Plugin stage manifest entry: $relative"
            }
            $expected.Add($relative, $entry)
        }
    }
    if ($files.Count -ne $expected.Count) { throw 'Plugin stage differs from package manifest.' }
    foreach ($relative in $expected.Keys) {
        if (-not $files.ContainsKey($relative)) { throw "Missing staged Plugin file: $relative" }
        Assert-DevFileHash $files[$relative] $expected[$relative] $relative
    }
    $roots = @('Jellyfin.Plugin.PiggieTV.deps.json', 'Jellyfin.Plugin.PiggieTV.dll', 'Jellyfin.Plugin.PiggieTV.pdb', 'Jellyfin.Plugin.PiggieTV.xml', 'meta.json')
    foreach ($name in $roots) { if (-not $files.ContainsKey($name)) { throw "Plugin payload lacks $name" } }
    if (-not $files.ContainsKey('helpers/win-x64/Ptv.ComicInfo.Helper.exe')) { throw 'Plugin payload lacks Windows helper.' }
    foreach ($relative in $files.Keys) {
        if ($relative -notin $roots -and -not $relative.StartsWith('helpers/win-x64/', [StringComparison]::Ordinal)) {
            throw "Unexpected Plugin payload: $relative"
        }
    }
    $meta = Get-Content -LiteralPath (Join-DevFile $stage 'meta.json') -Raw | ConvertFrom-Json -ErrorAction Stop
    if ($meta.version -cne $Version) { throw 'Plugin payload version differs from source.' }
    Assert-DevNoReparse $target
    if (-not (Test-Path -LiteralPath $target -PathType Container)) { throw 'Pinned Plugin target is absent.' }
    $transaction = [IO.Path]::GetFullPath($TransactionRoot)
    $targetParent = [IO.Path]::GetDirectoryName($target)
    if ($transaction -ieq $target -or $transaction.StartsWith($target.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or
        $transaction -ieq $stage -or $transaction.StartsWith($stage.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or
        $transaction.StartsWith($targetParent.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($transaction)) -PathType Container) -or
        (Test-Path -LiteralPath $transaction)) {
        throw 'Plugin transaction path is unsafe or already exists.'
    }
    Assert-DevNoReparse ([IO.Path]::GetDirectoryName($transaction))
    if (-not [IO.Path]::GetPathRoot($transaction).Equals([IO.Path]::GetPathRoot($target), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Plugin transaction must be on the same volume as its target.'
    }
    $candidate = Join-Path $transaction 'candidate'
    $previous = Join-Path $transaction 'previous'
    $failed = Join-Path $transaction 'failed-candidate'
    $oldMoved = $false
    $candidateMoved = $false
    try {
        [void][IO.Directory]::CreateDirectory($candidate)
        # Copy the existing Plugin directory into the candidate so unrelated
        # files and configuration inside it survive the version switch.
        $existing = Get-DevTree $target
        foreach ($directory in @(Get-ChildItem -LiteralPath $target -Recurse -Directory -Force)) {
            Assert-DevNoReparse $directory.FullName
            $relative = [IO.Path]::GetRelativePath($target, $directory.FullName).Replace('\', '/')
            [void][IO.Directory]::CreateDirectory((Join-DevFile $candidate $relative))
        }
        foreach ($relative in $existing.Keys) {
            $destination = Join-DevFile $candidate $relative
            [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
            [IO.File]::Copy($existing[$relative].FullName, $destination)
        }
        foreach ($relative in @($files.Keys | Sort-Object)) {
            Copy-DevAtomic (Join-DevFile $stage $relative) (Join-DevFile $candidate $relative) `
                ([string]$expected[$relative].sha256)
        }
        foreach ($relative in $files.Keys) {
            Assert-DevFileHash (Get-Item -LiteralPath (Join-DevFile $candidate $relative)) $expected[$relative] $relative
        }
        if ($BeforeSwitch) { & $BeforeSwitch | Out-Null }
        [IO.Directory]::Move($target, $previous)
        $oldMoved = $true
        if ($RollbackComplete) { $RollbackComplete.Value = $false }
        if ($AfterOldMove) { & $AfterOldMove | Out-Null }
        [IO.Directory]::Move($candidate, $target)
        $candidateMoved = $true
        foreach ($relative in $files.Keys) {
            Assert-DevFileHash (Get-Item -LiteralPath (Join-DevFile $target $relative)) $expected[$relative] $relative
        }
        if ($RollbackComplete) { $RollbackComplete.Value = $true }
        return [pscustomobject]@{ State = 'COMPLETE'; FileCount = $files.Count; Version = $Version;
            TransactionRoot = $transaction; PreviousPath = $previous }
    }
    catch {
        $failure = $_
        try {
            if ($oldMoved) {
                if ($candidateMoved) { [IO.Directory]::Move($target, $failed) }
                [IO.Directory]::Move($previous, $target)
            }
            if ($RollbackComplete) { $RollbackComplete.Value = $true }
        }
        catch {
            throw "Plugin transaction failed and rollback could not be verified; leave Jellyfin stopped. $($_.Exception.Message)"
        }
        throw $failure
    }
}

Export-ModuleMember -Function Publish-PTVDevelopmentWeb, Install-PTVDevelopmentPlugin
