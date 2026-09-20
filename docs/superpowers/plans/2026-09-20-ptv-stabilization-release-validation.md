# PTV Stabilization Release And Production Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate the three approved stabilization fixes, reconcile the named backlog, produce immutable and fully verified PTV Web 0.5.60 and PiggieTV Plugin 0.5.19.0 artifacts, deploy them once to VM115, validate production, and push the accepted release branch.

**Architecture:** Treat source validation, versioning, artifact construction, mount restoration, production deployment, and browser acceptance as separate gates. Stage immutable artifacts alongside SHA-256 manifests, preserve the live Web selector and complete Plugin directory, deploy the Plugin before the dependent Web selector, and use one candidate activation stop/start to activate both. If a hard gate fails, preserve evidence and use one additional rollback stop/start rather than retrying the candidate.

**Tech Stack:** Git, Node.js/npm, Vitest, ESLint, Stylelint, TypeScript, Webpack, Playwright, .NET 9/xUnit, tar, SHA-256, SSH, systemd, Jellyfin 12.0.0, FFmpeg 8.1.2.

**Spec:** [2026-09-20 PTV Jellyfin 12 stabilization design](../specs/2026-09-20-ptv-jellyfin12-stabilization-design.md)

## Global Constraints

- This plan runs only after the Music, Metadata, and mobile implementation plans pass and are committed on `release/ptv-web-0.5.60`.
- Do not add another functional fix during integration. A failing unrelated backlog check is classified and deferred, not folded into this release.
- Do not publish or deploy from a dirty tree. Do not alter `package.json` to bump PTV Web.
- Use `C:\Users\Piggie\Documents\GitHub\_PTV-Artifacts` for generated release manifests and final reports; do not commit credentials, browser storage, tokens, private media names, or runtime state.
- Production identity is VM115 `piggietv`, `10.16.0.50`, Jellyfin `12.0.0`, server ID `8fbfa3299eec41ae99d84c25df4fa002`, PTV Web `0.5.59`, and Plugin `0.5.18.0` before deployment.
- Immediate rollback inputs are the live `/opt/ptv-web-0.5.59-jf12-vm115-r1`, `/etc/jellyfin/ptv-recovery-web.env`, and complete `/var/lib/jellyfin/plugins/PiggieTV_0.5.18.0` payload. Require and copy them before mutation; also verify the retained Jellyfin 12 rollout backup by its stored manifests, but do not compare the current database hash to its pre-upgrade hash.
- No public routing, database, library, media, mount configuration, Jellyfin package, or FFmpeg package changes are permitted.

## Review Focus

- The release diff must contain only the three fixes, their focused tests/harness fixture, approved documentation, generated version metadata, and release records.
- Backlog reconciliation must distinguish source/test evidence from physical proof. `UNKNOWN` stays `UNKNOWN`.
- Artifact hashes are generated after the final build and verified again after transfer; no prewritten hash is trusted.
- A successful deployment performs exactly one candidate activation stop/start. A failed candidate may perform exactly one additional rollback stop/start; neither path permits an ad hoc candidate retry.
- A runtime-only `/run` systemd guard sets `Restart=no` only across each controlled start so `Restart=on-failure` cannot create hidden retries; every exit removes it, reloads systemd, and restores the normal `on-failure` policy without restarting a healthy PID.
- User streams are observed but not stopped individually. The service restart is the only authorized interruption.

### Task 1: Reconcile The Named Backlog Without Expanding Scope

**Files:**

- Create: `docs/diagnostics/2026-09-20-stabilization-backlog-reconciliation.md`
- Read: `src/ptv/modules/reader/ReaderApp.tsx`
- Read: `src/ptv/modules/reader/ReaderToolbar.tsx`
- Read: `src/ptv/modules/reader/engines/pdfReaderEngine.ts`
- Read: `src/ptv/modules/books/readingArtworkImage.tsx`
- Read: `src/ptv/modules/books/readingArtworkLifecycle.ts`
- Read: `src/ptv/modules/calendar/PiggieTvCalendarPage.tsx`
- Read: `src/ptv/modules/recommendations/recommendationSettings.ts`
- Read: `src/ptv/shell/PTVShellBackdrop.tsx`
- Read: `src/ptv/modules/settings/admin/libraryDisplay/PtvAdminLibraryDisplayPage.tsx`
- Read: `src/ptv/modules/settings/admin/libraryDisplay/useAdminLibraryDisplay.ts`
- Read: `src/ptv/modules/settings/admin/metadataManager/AdminReadingIdentifyWorkflow.tsx`
- Read: `src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Services/PtvFeaturedContentRefreshService.cs`

- [ ] Run the focused existing tests that prove the eight source-backed items:

```powershell
npx vitest run --config vite.config.ts `
  src/ptv/modules/reader/ReaderApp.test.tsx `
  src/ptv/modules/reader/ReaderToolbar.test.tsx `
  src/ptv/modules/books/readingArtworkResolution.test.ts `
  src/ptv/modules/books/readingArtworkLifecycle.test.ts `
  src/ptv/modules/calendar/PiggieTvCalendarPage.test.tsx `
  src/ptv/modules/dashboard/recommendationMutationSafety.test.ts `
  src/ptv/shell/PTVShellBackdrop.test.tsx `
  src/ptv/modules/settings/admin/libraryDisplay/useAdminLibraryDisplay.test.tsx `
  src/ptv/modules/settings/admin/libraryDisplay/AdminLibraryDisplayUi.test.tsx `
  src/ptv/modules/settings/admin/metadataManager/AdminReadingIdentifyWorkflow.test.tsx
dotnet test src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/Jellyfin.Plugin.PiggieTV.Tests.csproj --configuration Release --filter "FullyQualifiedName~FeaturedContent|FullyQualifiedName~Recommendation"
```

- [ ] Inspect the Browse and Metadata Manager chip surfaces at 390x844 using the existing app/browser route. Record `NOT_REPRODUCED` if no chip crosses its viewport or hides an action; record `REPRODUCED_DEFECT` and defer it if the overlap is visible. Do not fix it in this release.
- [ ] Create the reconciliation document with this exact table and replace evidence wording only with observed test names/results; do not change the intended classifications unless a focused test or browser reproduction contradicts them:

```markdown
| Item | Classification | Evidence | Release action |
| --- | --- | --- | --- |
| PDF zoom | ALREADY_IMPLEMENTED | Reader zoom controls, keyboard bindings, bounds, fit modes, and persistence are covered by focused Reader tests. | No code change. |
| Reading artwork | ALREADY_IMPLEMENTED | Fallback, generation reset, and stale-image event suppression are covered by focused artwork tests. | No code change. |
| Calendar | ALREADY_IMPLEMENTED | Healthy, partial, failure, deduplication, cancellation, and local-date behavior are covered by the Calendar suite. | No code change. |
| Generated rows | ALREADY_IMPLEMENTED | Featured-content generation/storage and authorization are covered by Plugin tests. | No code change. |
| Recommendation persistence | ALREADY_IMPLEMENTED | Web persistence and Plugin policy/authorization contracts are covered by focused tests. | No code change. |
| Home backdrop | ALREADY_IMPLEMENTED | Backdrop teardown, stale-load suppression, and generic reuse are covered by the shell test. | No code change. |
| Settings save/warning | ALREADY_IMPLEMENTED | Single-flight save, dirty/unload warning, stale read suppression, and conflict handling are covered by focused tests. | No code change. |
| Reading Identify | ALREADY_IMPLEMENTED | Structured fields, provider status, ranking, confirmation, URL safety, and phone stacking are covered by focused tests. | No code change. |
```

Append exactly one of these rows after the bounded phone inspection; the release action is deferred in either case:

```markdown
| Chip overflow | NOT_REPRODUCED | No chip crossed its viewport or hid an action at 390x844 in the bounded inspection. | No code change; keep as a separately reproducible UI issue if new evidence appears. |
```

or

```markdown
| Chip overflow | REPRODUCED_DEFECT | The bounded 390x844 inspection records the exact overlapping chip/action and route. | Defer to a separate UI task; do not fold it into this release. |
```

- [ ] Commit the evidence document:

```powershell
git add docs/diagnostics/2026-09-20-stabilization-backlog-reconciliation.md
git diff --cached --check
git commit -m "docs: reconcile PTV stabilization backlog"
```

### Task 2: Create The Reference-Client Contract

**Files:**

- Create: `docs/architecture/PTV_WEB_REFERENCE_CLIENT.md`
- Read: `src/ptv/docs/compatibility.md`
- Read: `docs/architecture/jellyfin-reference/20-ptv-vs-stock-map.md`
- Read: `docs/architecture/jellyfin-reference/24-stock-api-contract-reference.md`
- Read: `docs/architecture/jellyfin-reference/25-known-jellyfin-non-guarantees.md`

- [ ] Write a concise reference-client document with these exact sections and contracts:

```markdown
# PTV Web Reference Client

## Supported Baseline

The release target and supported pair are Jellyfin 12.0.0, PTV Web 0.5.60, and PiggieTV Plugin 0.5.19.0. PTV does not replace Jellyfin's authority for users, libraries, item identity, playback, sessions, or media paths. Production verification is recorded only after deployment acceptance.

## Music

Music reads user-scoped Jellyfin Views and Items data. Persistent home snapshots are scoped by server, user, mode, and schema. A fresh confirmed-empty snapshot may satisfy its TTL; an expired confirmed-empty snapshot must yield to a live request. A failed live request must not destructively erase the persisted fallback.

## Metadata Quality

Metadata Quality is an administrator-only Plugin surface. A fresh store creates an empty generation through BUILDING, export/validation, and ACTIVE states. Status is observational; summary and results may initialize the indexed store. Clients must surface a Plugin error rather than retry initialization in a loop.

## Admin Libraries

Jellyfin owns virtual-folder creation, identifiers, configured paths, and scans. PTV performs one mutation and reconciles uncertain outcomes with reads. At narrow widths, the settings page remains its own scroll viewport below the sticky PTV shell header; filters, cards, Manage, Scan, and Add Library controls remain reachable.

## Responsive And Accessibility Contract

The reference widths are 390x844 phone, 1024x1366 tablet, 2560x1271 desktop, and 1920x1080 TV. Responsive changes must preserve focus, keyboard/touch/remote access, action visibility, independent page scrolling where owned, and no horizontal overflow.

## Non-Guarantees

HTTP success does not universally prove mutation, cache, image, indexing, playback, or UI convergence. PTV must not infer missing projection fields as deletion, use Web filtering as an authorization boundary, or add broad retries/timeouts to hide an unresolved owner.

## Release Verification

Every release runs focused owner tests, relevant Web and Plugin suites, type and style checks, production builds, version/contract checks, authenticated production health/identity checks, representative navigation/playback, and a final no-unexpected-scan/no-lingering-transcode observation.
```

- [ ] Cross-check the document against the actual source and Atlas. If an assertion is not supported, narrow the wording instead of expanding implementation.
- [ ] Commit it:

```powershell
git add docs/architecture/PTV_WEB_REFERENCE_CLIENT.md
git diff --cached --check
git commit -m "docs: add PTV Web reference client"
```

### Task 3: Reconcile The Actual Diff And Version Exactly Once

**Files:**

- Modify through script: `ptv-version.json`
- Modify through script: `src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj`
- Modify through script: `src/ptv/plugin/Jellyfin.Plugin.PiggieTV/meta.json`
- Modify through script: `src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/PluginReleaseVersionContractTests.cs`
- Modify through script: `scripts/ptv-plugin-contract-check.mjs`
- Review: all changed product, test, harness, and documentation files

- [ ] Review every changed path and compare it with the Atlas record:

```powershell
git status --short
git diff --stat ff7d6185c33d2ffb6ff36a893b2bb19b9742f93e..HEAD
git diff --name-only ff7d6185c33d2ffb6ff36a893b2bb19b9742f93e..HEAD
git log --oneline --decorate ff7d6185c33d2ffb6ff36a893b2bb19b9742f93e..HEAD
```

Expected product paths are the Music API and tests, Metadata store and tests, settings SCSS, shell-header visual test/harness, version authorities/contracts, and the approved docs. Stop on any unrelated product file.

- [ ] Re-read changed code against Atlas chapters 20–25. Keep `Atlas update: not required` only if the actual diff introduces no owner, route, schema, contract, lifecycle, or non-guarantee change. Otherwise update only the affected Atlas files and explain why.
- [ ] Bump Web and Plugin once:

```powershell
npm run version:ptv:bump
node scripts/ptv-plugin-version.cjs bump
```

Expected: `ptv-version.json` resolves to `0.5.60`; the Plugin project and generated contract sources resolve to `0.5.19.0`.

- [ ] Verify generated version changes and commit them together:

```powershell
npm run test:ptv-version
npm run version:ptv:check
node --test scripts/ptv-plugin-version.test.cjs
node scripts/ptv-plugin-version.cjs check
npm run test:plugin-contract
git diff --check
git add ptv-version.json src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj src/ptv/plugin/Jellyfin.Plugin.PiggieTV/meta.json src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/PluginReleaseVersionContractTests.cs scripts/ptv-plugin-contract-check.mjs
git diff --cached --check
git commit -m "chore: release PTV Web 0.5.60 and Plugin 0.5.19.0"
```

### Task 4: Run The Complete Local Release Gate

**Files:**

- Verify: complete repository
- Create locally: `dist/`
- Create locally: `src/ptv/plugin/bin/`

- [ ] Run focused and relevant suites in this order:

```powershell
npx vitest run --config vite.config.ts src/ptv/modules/music/musicApiRequests.test.ts src/ptv/modules/music/musicApi.test.ts
dotnet test src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/Jellyfin.Plugin.PiggieTV.Tests.csproj --configuration Release --filter FullyQualifiedName~EmptyStoreBootstrapExportsAndActivatesAnEmptyGeneration
npm run test:e2e:build
npm exec playwright -- test e2e/tests/shell-header-visual.spec.ts --workers=1
npm run test:ptv
npm run test:plugin
npm run test:plugin-contract
npm run build:check
npm run lint:ptv
npm run stylelint:ptv
npm run test:ptv-version
npm run version:ptv:check
node --test scripts/ptv-plugin-version.test.cjs
node scripts/ptv-plugin-version.cjs check
npm run test:e2e
npm run build:production
dotnet publish src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj --configuration Release --output src/ptv/plugin/bin
```

- [ ] Require all commands to exit zero. Inspect `dist` for `ptv-web-0.5.60`, and inspect the Plugin assembly plus `src/ptv/plugin/bin/meta.json` for `0.5.19.0`.
- [ ] Require the Plugin payload to contain exactly the published release files required by the repository contract: `Jellyfin.Plugin.PiggieTV.dll`, `Jellyfin.Plugin.PiggieTV.deps.json`, `Jellyfin.Plugin.PiggieTV.pdb`, `Jellyfin.Plugin.PiggieTV.xml`, and `meta.json`. Stop if publish output or README contract differs; do not deploy a partial payload.
- [ ] Run secret and whitespace checks without printing secret values:

```powershell
git diff --check ff7d6185c33d2ffb6ff36a893b2bb19b9742f93e..HEAD
npm run secret:scan
git status --short
```

Expected: the grep prints no committed credential; the tracked tree is clean. Build outputs may be ignored but must be the outputs just produced.

### Task 5: Build Immutable Release Artifacts And Manifests

**Files:**

- Create: `C:\Users\Piggie\Documents\GitHub\_PTV-Artifacts\Deployment\ptv-web-0.5.60-jf12-vm115-r1.tar.gz`
- Create: `C:\Users\Piggie\Documents\GitHub\_PTV-Artifacts\Deployment\PiggieTV.Plugin_0.5.19.0.zip`
- Create: `C:\Users\Piggie\Documents\GitHub\_PTV-Artifacts\Deployment\ptv-0.5.60-0.5.19.0.sha256`
- Create: `C:\Users\Piggie\Documents\GitHub\_PTV-Artifacts\Deployment\ptv-0.5.60-0.5.19.0-manifest.json`
- Create: `C:\Users\Piggie\Documents\GitHub\_PTV-Artifacts\Deployment\ptv-recovery-web-0.5.60-jf12-vm115-r1.env`

- [ ] Create the Web selector with exact coherent values:

```text
JELLYFIN_WEB_OPT="--webdir=/opt/ptv-web-0.5.60-jf12-vm115-r1"
JELLYFIN_WEB_DIR=/opt/ptv-web-0.5.60-jf12-vm115-r1
```

- [ ] From the repository root, create all artifacts without overwriting an earlier candidate:

```powershell
$releaseRoot = 'C:\Users\Piggie\Documents\GitHub\_PTV-Artifacts\Deployment'
$repositoryRoot = (Get-Location).Path
$webArchive = Join-Path $releaseRoot 'ptv-web-0.5.60-jf12-vm115-r1.tar.gz'
$pluginArchive = Join-Path $releaseRoot 'PiggieTV.Plugin_0.5.19.0.zip'
$selectorFile = Join-Path $releaseRoot 'ptv-recovery-web-0.5.60-jf12-vm115-r1.env'
$manifestFile = Join-Path $releaseRoot 'ptv-0.5.60-0.5.19.0-manifest.json'
$hashFile = Join-Path $releaseRoot 'ptv-0.5.60-0.5.19.0.sha256'
$pluginBin = Join-Path $repositoryRoot 'src\ptv\plugin\bin'
$expectedPluginFiles = @(
    'Jellyfin.Plugin.PiggieTV.deps.json',
    'Jellyfin.Plugin.PiggieTV.dll',
    'Jellyfin.Plugin.PiggieTV.pdb',
    'Jellyfin.Plugin.PiggieTV.xml',
    'meta.json'
)
$treeSummaryProgram = @'
import hashlib
import json
import os
import stat
import sys

root = os.path.abspath(sys.argv[1])
requested = sys.argv[2:]
paths = []
if requested:
    paths = [(name.replace("\\", "/"), os.path.join(root, name)) for name in requested]
else:
    for base, directories, files in os.walk(root, followlinks=False):
        directories.sort()
        files.sort()
        for directory in directories:
            if os.path.islink(os.path.join(base, directory)):
                raise SystemExit("tree_symlink")
        for name in files:
            path = os.path.join(base, name)
            relative = os.path.relpath(path, root).replace(os.sep, "/")
            paths.append((relative, path))
paths.sort(key=lambda entry: entry[0].encode("utf-8"))
rows = []
total = 0
for relative, path in paths:
    if not stat.S_ISREG(os.lstat(path).st_mode):
        raise SystemExit(f"tree_non_regular:{relative}")
    file_digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            file_digest.update(chunk)
    size = os.path.getsize(path)
    total += size
    rows.append(f"{relative}\0{size}\0{file_digest.hexdigest()}\n".encode("utf-8"))
print(json.dumps({
    "fileCount": len(rows),
    "uncompressedBytes": total,
    "treeSha256": hashlib.sha256(b"".join(rows)).hexdigest(),
}, separators=(",", ":")))
'@

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
foreach ($output in @($webArchive, $pluginArchive, $selectorFile, $manifestFile, $hashFile)) {
    if (Test-Path -LiteralPath $output) { throw "Release output already exists: $output" }
}
$actualPluginFiles = @(Get-ChildItem -LiteralPath $pluginBin -File | Select-Object -ExpandProperty Name | Sort-Object)
if (Compare-Object ($expectedPluginFiles | Sort-Object) $actualPluginFiles) {
    throw 'Plugin publish output is not the exact five-file payload.'
}
$pluginMeta = Get-Content -Raw -LiteralPath (Join-Path $pluginBin 'meta.json') | ConvertFrom-Json
$assemblyVersion = [Reflection.AssemblyName]::GetAssemblyName((Join-Path $pluginBin 'Jellyfin.Plugin.PiggieTV.dll')).Version.ToString()
if ($pluginMeta.version -ne '0.5.19.0' -or $assemblyVersion -ne '0.5.19.0') {
    throw "Plugin version mismatch: meta=$($pluginMeta.version), assembly=$assemblyVersion"
}

tar.exe -czf $webArchive -C (Join-Path $repositoryRoot 'dist') .
if ($LASTEXITCODE -ne 0) { throw 'Web archive creation failed.' }
Compress-Archive -LiteralPath ($expectedPluginFiles | ForEach-Object { Join-Path $pluginBin $_ }) -DestinationPath $pluginArchive -CompressionLevel Optimal
[IO.File]::WriteAllText(
    $selectorFile,
    "JELLYFIN_WEB_OPT=`"--webdir=/opt/ptv-web-0.5.60-jf12-vm115-r1`"`nJELLYFIN_WEB_DIR=/opt/ptv-web-0.5.60-jf12-vm115-r1`n",
    [Text.UTF8Encoding]::new($false)
)

$webTree = $treeSummaryProgram | python - (Join-Path $repositoryRoot 'dist') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Web tree summary failed.' }
$pluginTree = $treeSummaryProgram | python - $pluginBin @expectedPluginFiles | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Plugin tree summary failed.' }
$manifest = [ordered]@{
    schema = 'ptv.stabilization.release.v1'
    gitCommit = (& git rev-parse HEAD).Trim()
    webVersion = '0.5.60'
    pluginVersion = '0.5.19.0'
    webFileCount = [int]$webTree.fileCount
    webUncompressedBytes = [long]$webTree.uncompressedBytes
    webTreeSha256 = [string]$webTree.treeSha256
    pluginFileCount = [int]$pluginTree.fileCount
    pluginUncompressedBytes = [long]$pluginTree.uncompressedBytes
    pluginTreeSha256 = [string]$pluginTree.treeSha256
    pluginMembers = $expectedPluginFiles
    webArchiveSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $webArchive).Hash.ToLowerInvariant()
    pluginArchiveSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $pluginArchive).Hash.ToLowerInvariant()
    selectorSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $selectorFile).Hash.ToLowerInvariant()
}
[IO.File]::WriteAllText($manifestFile, (($manifest | ConvertTo-Json -Depth 4) + "`n"), [Text.UTF8Encoding]::new($false))
$releaseFiles = @($webArchive, $pluginArchive, $selectorFile, $manifestFile)
$hashLines = $releaseFiles | ForEach-Object {
    '{0}  {1}' -f (Get-FileHash -Algorithm SHA256 -LiteralPath $_).Hash.ToLowerInvariant(), (Split-Path -Leaf $_)
}
[IO.File]::WriteAllLines($hashFile, $hashLines, [Text.UTF8Encoding]::new($false))
```

- [ ] Independently validate archive layout and every recorded hash:

```powershell
$releaseRoot = 'C:\Users\Piggie\Documents\GitHub\_PTV-Artifacts\Deployment'
$webArchive = Join-Path $releaseRoot 'ptv-web-0.5.60-jf12-vm115-r1.tar.gz'
$pluginArchive = Join-Path $releaseRoot 'PiggieTV.Plugin_0.5.19.0.zip'
$selectorFile = Join-Path $releaseRoot 'ptv-recovery-web-0.5.60-jf12-vm115-r1.env'
$manifestFile = Join-Path $releaseRoot 'ptv-0.5.60-0.5.19.0-manifest.json'
$hashFile = Join-Path $releaseRoot 'ptv-0.5.60-0.5.19.0.sha256'
$expectedPluginFiles = @(
    'Jellyfin.Plugin.PiggieTV.deps.json',
    'Jellyfin.Plugin.PiggieTV.dll',
    'Jellyfin.Plugin.PiggieTV.pdb',
    'Jellyfin.Plugin.PiggieTV.xml',
    'meta.json'
)
$releaseFiles = @($webArchive, $pluginArchive, $selectorFile, $manifestFile)
$webMembers = @(tar.exe -tzf $webArchive)
if ($LASTEXITCODE -ne 0 -or -not $webMembers.Count) { throw 'Web archive is unreadable or empty.' }
if ($webMembers | Where-Object { $_ -match '^(?:/|\\)' -or $_ -match '(^|[\\/])\.\.([\\/]|$)' }) {
    throw 'Web archive contains an unsafe member path.'
}
$archiveAuditProgram = @'
import pathlib
import sys
import tarfile
import zipfile

web_archive, plugin_archive, *expected_plugin_members = sys.argv[1:]
with tarfile.open(web_archive, "r:gz") as archive:
    members = archive.getmembers()
    if not members:
        raise SystemExit("empty_web_archive")
    for member in members:
        if "\\" in member.name:
            raise SystemExit(f"unsafe_web_backslash:{member.name}")
        normalized = member.name.removeprefix("./")
        path = pathlib.PurePosixPath(normalized)
        if path.is_absolute() or ".." in path.parts:
            raise SystemExit(f"unsafe_web_path:{member.name}")
        if not (member.isfile() or member.isdir()):
            raise SystemExit(f"unsafe_web_type:{member.name}")
with zipfile.ZipFile(plugin_archive) as archive:
    members = archive.infolist()
    actual = sorted(member.filename for member in members if not member.is_dir())
    if actual != sorted(expected_plugin_members):
        raise SystemExit("plugin_member_set_mismatch")
    for member in members:
        if "\\" in member.filename:
            raise SystemExit(f"unsafe_plugin_backslash:{member.filename}")
        path = pathlib.PurePosixPath(member.filename)
        unix_type = (member.external_attr >> 16) & 0o170000
        if path.is_absolute() or ".." in path.parts:
            raise SystemExit(f"unsafe_plugin_path:{member.filename}")
        if not member.is_dir() and unix_type not in (0, 0o100000):
            raise SystemExit(f"unsafe_plugin_type:{member.filename}")
'@
$archiveAuditProgram | python - $webArchive $pluginArchive @expectedPluginFiles
if ($LASTEXITCODE -ne 0) { throw 'Archive safety audit failed.' }
$pluginMembers = @(tar.exe -tf $pluginArchive | Where-Object { $_ -and -not $_.EndsWith('/') } | Sort-Object)
if (Compare-Object ($expectedPluginFiles | Sort-Object) $pluginMembers) {
    throw 'Plugin ZIP member set differs from the exact five-file contract.'
}
$recordedHashes = @{}
$hashLines = @(Get-Content -LiteralPath $hashFile)
if ($hashLines.Count -ne 4) { throw 'Hash manifest must contain exactly four entries.' }
$hashLines | ForEach-Object {
    if ($_ -notmatch '^([0-9a-f]{64})  ([^/\\]+)$') { throw "Invalid hash manifest line: $_" }
    if ($recordedHashes.ContainsKey($Matches[2])) { throw "Duplicate hash manifest entry: $($Matches[2])" }
    $recordedHashes[$Matches[2]] = $Matches[1]
}
$expectedHashNames = @(
    'ptv-web-0.5.60-jf12-vm115-r1.tar.gz',
    'PiggieTV.Plugin_0.5.19.0.zip',
    'ptv-recovery-web-0.5.60-jf12-vm115-r1.env',
    'ptv-0.5.60-0.5.19.0-manifest.json'
)
if (Compare-Object ($expectedHashNames | Sort-Object) ($recordedHashes.Keys | Sort-Object)) {
    throw 'Hash manifest member set mismatch.'
}
foreach ($releaseFile in $releaseFiles) {
    $name = Split-Path -Leaf $releaseFile
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $releaseFile).Hash.ToLowerInvariant()
    if ($recordedHashes[$name] -ne $actual) { throw "Hash readback failed: $name" }
}
if ((Get-Content -Raw -LiteralPath $selectorFile) -ne "JELLYFIN_WEB_OPT=`"--webdir=/opt/ptv-web-0.5.60-jf12-vm115-r1`"`nJELLYFIN_WEB_DIR=/opt/ptv-web-0.5.60-jf12-vm115-r1`n") {
    throw 'Selector content mismatch.'
}
```

Do not hard-code final SHA-256 values before this build; the generated hash and JSON manifests are the deployment authority.

### Task 6: Establish Bounded Access, Then Restore And Verify The Existing T7 Runtime Mount

**Files:**

- Read only: Proxmox host mount/unit state for `/mnt/media/_External/T7`
- Read only: VM115 `/mnt/ptv-media/_External/T7/Music`
- Modify only if inactive: activate the existing automount by accessing `/mnt/media/_External/T7`
- Modify temporarily: VM115 `/root/.ssh/authorized_keys` through the already-audited QEMU Guest Agent access script
- Modify temporarily: VM115 `/usr/local/sbin/ptv-vm115-ephemeral-access-expiry` and its two named persistent systemd unit files; Task 11 removes all three plus the timer enablement and stamp

Before invoking the installer, arm the persistent QEMU Guest Agent dead-man below. It independently restores the preserved empty authorization file at one absolute UTC expiry 120 minutes later, removes any runtime Jellyfin restart guard, survives a VM reboot through an enabled `Persistent=true` timer, and is disarmed only after Task 11 proves retirement. This makes cleanup independent of the lifetime of any local shell, agent turn, or guest boot; if it fires during the work, stop rather than reinstalling the key or retrying deployment.

- [ ] Arm and verify the persistent guest dead-man through the Proxmox/QEMU Guest Agent path before adding the key:

```powershell
$pveKey = 'C:\Users\Piggie\Documents\Codex\2026-09-08\ptv-production-incident-readonly\work\parallel-recovery\private\pve-ephemeral-20260912T185233Z'
$pveKnownHosts = 'C:\Users\Piggie\Documents\Codex\2026-09-08\ptv-production-incident-readonly\work\parallel-recovery\private\pve_known_hosts'
$deadman = @'
#!/bin/bash
set -euo pipefail
deadman_script=/usr/local/sbin/ptv-vm115-ephemeral-access-expiry
deadman_service=/etc/systemd/system/ptv-vm115-ephemeral-access-expiry.service
deadman_timer=/etc/systemd/system/ptv-vm115-ephemeral-access-expiry.timer
deadman_wants=/etc/systemd/system/timers.target.wants/ptv-vm115-ephemeral-access-expiry.timer
deadman_stamp=/var/lib/systemd/timers/stamp-ptv-vm115-ephemeral-access-expiry.timer
access_lock=/run/ptv-vm115-ephemeral-access.lock
directory=/root/.ssh
authorized=$directory/authorized_keys
backup=$directory/authorized_keys.pre-jf12-production-20260915
install_tmp=$directory/.authorized_keys.codex-jf12.tmp
direct_tmp=$directory/.authorized_keys.codex-direct-retire.tmp
deadman_tmp=$directory/.authorized_keys.codex-deadman-retire.tmp
qga_tmp=$directory/.authorized_keys.codex-qga-retire.tmp
key_sha=694b070540b87357c71553421c93e55f9573d7e4465e8e706bf58787910f28e5
empty_sha=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
exec 9>"$access_lock"
flock -x 9
test -f "$authorized"
authorized_sha="$(sha256sum "$authorized" | cut -d' ' -f1)"
if test -e "$backup"; then
    test "$(stat -c '%U:%G:%a:%s' "$backup")" = root:root:600:0
    test "$(sha256sum "$backup" | cut -d' ' -f1)" = "$empty_sha"
    test "$authorized_sha" = "$key_sha" || test "$authorized_sha" = "$empty_sha"
    rm -f -- "$install_tmp" "$direct_tmp" "$deadman_tmp" "$qga_tmp"
    cp -a -- "$backup" "$deadman_tmp"
    mv -f -- "$deadman_tmp" "$authorized"
    rm -f -- "$backup"
else
    test "$authorized_sha" = "$empty_sha"
    rm -f -- "$install_tmp" "$direct_tmp" "$deadman_tmp" "$qga_tmp"
fi
chown root:root "$authorized"
chmod 0600 "$authorized"
test "$(stat -c '%U:%G:%a:%s' "$authorized")" = root:root:600:0
test "$(sha256sum "$authorized" | cut -d' ' -f1)" = "$empty_sha"
rm -f -- \
  /run/systemd/system/jellyfin.service.d/zzzz-ptv-stabilization-one-attempt.conf \
  /run/systemd/system/jellyfin.service.d/.zzzz-ptv-stabilization-one-attempt.conf.tmp
systemctl daemon-reload
test "$(systemctl show jellyfin.service -p Restart --value)" = on-failure
rm -f -- "$deadman_wants" "$deadman_timer" "$deadman_service" "$deadman_stamp" "$deadman_script"
systemctl daemon-reload
'@
$deadmanB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($deadman))
$armDeadman = @'
set -euo pipefail
command -v flock >/dev/null
deadman_script=/usr/local/sbin/ptv-vm115-ephemeral-access-expiry
deadman_service=/etc/systemd/system/ptv-vm115-ephemeral-access-expiry.service
deadman_timer=/etc/systemd/system/ptv-vm115-ephemeral-access-expiry.timer
deadman_wants=/etc/systemd/system/timers.target.wants/ptv-vm115-ephemeral-access-expiry.timer
deadman_stamp=/var/lib/systemd/timers/stamp-ptv-vm115-ephemeral-access-expiry.timer
script_tmp=/usr/local/sbin/.ptv-vm115-ephemeral-access-expiry.tmp
service_tmp=/etc/systemd/system/.ptv-vm115-ephemeral-access-expiry.service.tmp
timer_tmp=/etc/systemd/system/.ptv-vm115-ephemeral-access-expiry.timer.tmp
for path in "$deadman_script" "$deadman_service" "$deadman_timer" "$deadman_wants" "$deadman_stamp" "$script_tmp" "$service_tmp" "$timer_tmp"; do
    test ! -e "$path"
done
armed=0
cleanup_arm_failure() {
    if test "$armed" -eq 0; then
        systemctl stop ptv-vm115-ephemeral-access-expiry.timer ptv-vm115-ephemeral-access-expiry.service 2>/dev/null || true
        rm -f -- "$deadman_wants" "$deadman_timer" "$deadman_service" "$deadman_stamp" "$deadman_script" "$script_tmp" "$service_tmp" "$timer_tmp"
        systemctl daemon-reload
    fi
}
trap cleanup_arm_failure EXIT
umask 077
printf '%s' '__DEADMAN_B64__' | base64 -d > "$script_tmp"
chown root:root "$script_tmp"
chmod 0700 "$script_tmp"
mv -T -- "$script_tmp" "$deadman_script"
expires="$(date -u -d '+120 minutes' '+%Y-%m-%d %H:%M:%S UTC')"
printf '%s\n' \
  '[Unit]' \
  'Description=Expire VM115 PTV ephemeral root access' \
  '' \
  '[Service]' \
  'Type=oneshot' \
  'ExecStart=/usr/local/sbin/ptv-vm115-ephemeral-access-expiry' > "$service_tmp"
printf '%s\n' \
  '[Unit]' \
  'Description=Expire VM115 PTV ephemeral root access at its absolute deadline' \
  '' \
  '[Timer]' \
  "OnCalendar=$expires" \
  'Persistent=true' \
  'AccuracySec=1min' \
  'Unit=ptv-vm115-ephemeral-access-expiry.service' \
  '' \
  '[Install]' \
  'WantedBy=timers.target' > "$timer_tmp"
chown root:root "$service_tmp" "$timer_tmp"
chmod 0644 "$service_tmp" "$timer_tmp"
mv -T -- "$service_tmp" "$deadman_service"
mv -T -- "$timer_tmp" "$deadman_timer"
systemctl daemon-reload
systemctl enable --now ptv-vm115-ephemeral-access-expiry.timer
test "$(systemctl is-active ptv-vm115-ephemeral-access-expiry.timer)" = active
test "$(systemctl is-enabled ptv-vm115-ephemeral-access-expiry.timer)" = enabled
test "$(systemctl show ptv-vm115-ephemeral-access-expiry.timer -p Triggers --value)" = ptv-vm115-ephemeral-access-expiry.service
test "$(systemctl show ptv-vm115-ephemeral-access-expiry.timer -p Persistent --value)" = yes
next_expiry="$(systemctl show ptv-vm115-ephemeral-access-expiry.timer -p NextElapseUSecRealtime --value)"
remaining_seconds="$(( $(date -d "$next_expiry" +%s) - $(date +%s) ))"
test "$remaining_seconds" -ge 6900
armed=1
trap - EXIT
printf 'VM115_EPHEMERAL_ACCESS_DEADMAN=ARMED expiry=%s\n' "$expires"
'@
$armDeadman = $armDeadman.Replace('__DEADMAN_B64__', $deadmanB64)
$armDeadmanB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($armDeadman))
$qgaCommand = "qm guest exec 115 -- bash -lc `"printf '%s' '$armDeadmanB64' | base64 -d | bash`""
& ssh -T -F none -i $pveKey -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o "UserKnownHostsFile=$pveKnownHosts" -o ConnectTimeout=8 root@10.16.0.254 $qgaCommand
if ($LASTEXITCODE -ne 0) { throw 'VM115 ephemeral-access dead-man failed to arm.' }
```

The arming block has its own failure trap and removes any partial script, unit, enablement, or timer stamp before returning nonzero. If arming fails, verify that cleanup through QEMU Guest Agent and stop before invoking the key installer.

- [ ] Reinstall only the previously verified ephemeral key, preserving the current empty authorization file for retirement after acceptance:

```powershell
& 'C:\Users\Piggie\Documents\Codex\2026-09-14\vm115-ptv-recovery\work\install-vm115-ephemeral-access.ps1'
if ($LASTEXITCODE -ne 0) { throw 'VM115 ephemeral access installation failed.' }
$pveKey = 'C:\Users\Piggie\Documents\Codex\2026-09-08\ptv-production-incident-readonly\work\parallel-recovery\private\pve-ephemeral-20260912T185233Z'
$pveKnownHosts = 'C:\Users\Piggie\Documents\Codex\2026-09-08\ptv-production-incident-readonly\work\parallel-recovery\private\pve_known_hosts'
$vmKnownHosts = 'C:\Users\Piggie\Documents\Codex\2026-09-14\vm115-ptv-recovery\work\vm115_known_hosts.tmp'
$sshCommon = @('-T', '-F', 'none', '-i', $pveKey, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', "UserKnownHostsFile=$vmKnownHosts", '-o', 'ConnectTimeout=8')
& ssh @sshCommon root@10.16.0.50 "test `"`$(hostname)`" = piggietv; ip -4 -o addr show dev ens18 | grep -Eq ' 10\.16\.0\.50/24 '; printf 'VM115_TARGET=PASS\n'"
if ($LASTEXITCODE -ne 0) { throw 'VM115 target identity failed before mount or release mutation.' }
$publicIdentityCheck = @'
import json
import urllib.request

with urllib.request.urlopen("http://127.0.0.1:8096/System/Info/Public", timeout=10) as response:
    payload = json.load(response)
assert response.status == 200
assert payload.get("Version") == "12.0.0"
assert payload.get("ServerName") == "piggietv"
assert payload.get("Id") == "8fbfa3299eec41ae99d84c25df4fa002"
assert payload.get("StartupWizardCompleted") is True
print("VM115_PUBLIC_IDENTITY=PASS")
'@
$publicIdentityB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($publicIdentityCheck))
& ssh @sshCommon root@10.16.0.50 "python3 -c `"import base64;exec(base64.b64decode('$publicIdentityB64'))`""
if ($LASTEXITCODE -ne 0) { throw 'VM115 Jellyfin identity failed before mount activation.' }
```

The access installer itself requires `/root/.ssh/authorized_keys` to be the preserved empty root-owned mode-0600 file and verifies public-key SHA-256 `694b070540b87357c71553421c93e55f9573d7e4465e8e706bf58787910f28e5`. Stop if any precondition differs.

The dead-man plus Task 11 retirement applies to mount validation, preflight, transfer, staging, activation, acceptance, and rollback. The QEMU Guest Agent path is authorized specifically to guarantee or verify cleanup if direct SSH retirement or the local task fails.

- [ ] On the Proxmox host, require the generated unit and stable filesystem identity while accepting either the expected inactive automount backing filesystem or the same filesystem already active:

```powershell
$pveKey = 'C:\Users\Piggie\Documents\Codex\2026-09-08\ptv-production-incident-readonly\work\parallel-recovery\private\pve-ephemeral-20260912T185233Z'
$pveKnownHosts = 'C:\Users\Piggie\Documents\Codex\2026-09-08\ptv-production-incident-readonly\work\parallel-recovery\private\pve_known_hosts'
$hostCheck = @'
set -euo pipefail
test "$(hostname)" = 'odin.piggietv.com'
test "$(systemctl show mnt-media-_External-T7.automount -p LoadState --value)" = loaded
test "$(systemctl show mnt-media-_External-T7.automount -p ActiveState --value)" = active
test "$(systemctl show mnt-media-_External-T7.automount -p SubState --value)" = waiting
test "$(systemctl show mnt-media-_External-T7.mount -p LoadState --value)" = loaded
mount_state="$(systemctl show mnt-media-_External-T7.mount -p ActiveState --value)"
test "$mount_state" = inactive || test "$mount_state" = active
test "$(systemctl show mnt-media-_External-T7.mount -p What --value)" = /dev/disk/by-uuid/6EDB-0114
test "$(systemctl show mnt-media-_External-T7.mount -p Where --value)" = /mnt/media/_External/T7
test -b "$(blkid -U 6EDB-0114)"
grep -Fxq 'UUID=6EDB-0114 /mnt/media/_External/T7 exfat rw,nofail,x-systemd.automount,x-systemd.device-timeout=10s,uid=65534,gid=65534,fmask=0111,dmask=0000 0 0' /etc/fstab
if test "$mount_state" = inactive; then
    findmnt -rn -T /mnt/media/_External/T7 -o TARGET,SOURCE,FSTYPE | grep -Fx '/mnt/media/_External/T7 systemd-1 autofs'
else
    source="$(findmnt -rn -T /mnt/media/_External/T7 -o SOURCE)"
    test -b "$source"
    test "$(blkid -s UUID -o value "$source")" = 6EDB-0114
    test "$(findmnt -rn -T /mnt/media/_External/T7 -o FSTYPE)" = exfat
fi
printf 'T7_PREACTIVATION=PASS\n'
'@
& ssh -T -F none -i $pveKey -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o "UserKnownHostsFile=$pveKnownHosts" -o ConnectTimeout=8 root@10.16.0.254 $hostCheck
if ($LASTEXITCODE -ne 0) { throw 'T7 pre-activation identity gate failed.' }
```

This is the source-backed chain observed on 2026-09-20. Accept either its inactive/autofs state or an already-triggered active/exfat state with the same UUID; user testing or the Music subplan may already have activated it. Stop on any mismatch and never substitute a `/dev/sdX` name.

- [ ] Trigger only the existing automount, then require the backing filesystem and Music directory:

```powershell
$pveKey = 'C:\Users\Piggie\Documents\Codex\2026-09-08\ptv-production-incident-readonly\work\parallel-recovery\private\pve-ephemeral-20260912T185233Z'
$pveKnownHosts = 'C:\Users\Piggie\Documents\Codex\2026-09-08\ptv-production-incident-readonly\work\parallel-recovery\private\pve_known_hosts'
$hostActivation = @'
set -euo pipefail
test -d /mnt/media/_External/T7/Music
test "$(systemctl show mnt-media-_External-T7.mount -p ActiveState --value)" = active
source="$(findmnt -rn -T /mnt/media/_External/T7/Music -o SOURCE)"
test -b "$source"
test "$(blkid -s UUID -o value "$source")" = 6EDB-0114
findmnt -rn -T /mnt/media/_External/T7/Music -o TARGET,SOURCE,FSTYPE,OPTIONS
printf 'T7_ACTIVATION=PASS\n'
'@
& ssh -T -F none -i $pveKey -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o "UserKnownHostsFile=$pveKnownHosts" -o ConnectTimeout=8 root@10.16.0.254 $hostActivation
if ($LASTEXITCODE -ne 0) { throw 'Existing T7 automount activation failed.' }
```

- [ ] On VM115, require the existing read-only VirtioFS mapping and Jellyfin-account access:

```powershell
$pveKey = 'C:\Users\Piggie\Documents\Codex\2026-09-08\ptv-production-incident-readonly\work\parallel-recovery\private\pve-ephemeral-20260912T185233Z'
$vmKnownHosts = 'C:\Users\Piggie\Documents\Codex\2026-09-14\vm115-ptv-recovery\work\vm115_known_hosts.tmp'
$sshCommon = @('-T', '-F', 'none', '-i', $pveKey, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', "UserKnownHostsFile=$vmKnownHosts", '-o', 'ConnectTimeout=8')
$guestMountCheck = @'
set -euo pipefail
fstype="$(findmnt -rn -T /mnt/ptv-media/_External/T7/Music -o FSTYPE)"
options="$(findmnt -rn -T /mnt/ptv-media/_External/T7/Music -o OPTIONS)"
test "$fstype" = virtiofs
printf '%s\n' "$options" | tr ',' '\n' | grep -Fxq ro
test -d /mnt/ptv-media/_External/T7/Music
sample="$(runuser -u jellyfin -- find /mnt/ptv-media/_External/T7/Music -type f -readable -print -quit)"
test -n "$sample"
runuser -u jellyfin -- test -r "$sample"
runuser -u jellyfin -- head -c 1 -- "$sample" >/dev/null
printf 'VM115_T7_MUSIC_ACCESS=PASS\n'
'@
& ssh @sshCommon root@10.16.0.50 $guestMountCheck
if ($LASTEXITCODE -ne 0) { throw 'VM115 VirtioFS or Jellyfin-account Music access failed.' }
```

Require VirtioFS, `ro`, and a nonempty representative readable-file result. The command prints no media filename or contents and performs no ownership mutation.

- [ ] Using one in-memory administrator token, require the exact Music identity and path without printing or persisting the token:

```python
import json
import sqlite3
import urllib.request

database = sqlite3.connect("file:/var/lib/jellyfin/data/jellyfin.db?mode=ro", uri=True)
database.execute("PRAGMA query_only=ON")
row = database.execute("""
    SELECT d.AccessToken
    FROM Devices AS d
    JOIN Users AS u ON u.Id = d.UserId
    WHERE u.Username = 'ptv-recovery-admin'
      AND d.AccessToken IS NOT NULL
      AND length(d.AccessToken) > 0
    ORDER BY d.DateLastActivity DESC
    LIMIT 1
""").fetchone()
database.close()
if row is None:
    raise SystemExit("admin_token_not_found")
request = urllib.request.Request(
    "http://127.0.0.1:8096/Library/VirtualFolders",
    headers={"Authorization": f'MediaBrowser Token="{row[0]}"', "Accept": "application/json"},
)
with urllib.request.urlopen(request, timeout=20) as response:
    folders = json.load(response)
music = [entry for entry in folders if entry.get("ItemId") == "7e64e319657a9516ec78490da03edccb"]
assert len(music) == 1
assert music[0].get("Name") == "Music"
assert music[0].get("Locations") == ["/mnt/ptv-media/_External/T7/Music"]
print("VM115_MUSIC_LIBRARY_IDENTITY=PASS")
```

Run this through the same Base64-over-SSH pattern as the public-identity check. Do not update the library and do not start a scan.

### Task 7: Production Preflight, Backup, And Staging

**Files:**

- Preserve: `/etc/jellyfin/ptv-recovery-web.env`
- Preserve: `/opt/ptv-web-0.5.59-jf12-vm115-r1`
- Preserve: `/var/lib/jellyfin/plugins/PiggieTV_0.5.18.0`
- Stage: `/opt/.ptv-web-0.5.60-jf12-vm115-r1.staging`
- Stage outside Plugin discovery: `/var/lib/ptv-vm115-stabilization-20260920/stage/PiggieTV_0.5.19.0`
- Install Web after verification: `/opt/ptv-web-0.5.60-jf12-vm115-r1`
- Prepare but do not select: `/etc/jellyfin/.ptv-recovery-web.env.0.5.60-r1.tmp`

- [ ] Run this fail-closed baseline before creating the run directory. It binds the exact service, selector, Plugin, Metadata Quality, primary database, and retained Jellyfin 12 rollback evidence without comparing the current database hash to the pre-upgrade database:

```bash
set -euo pipefail
run=/var/lib/ptv-vm115-stabilization-20260920
selector=/etc/jellyfin/ptv-recovery-web.env
old_web=/opt/ptv-web-0.5.59-jf12-vm115-r1
old_plugin=/var/lib/jellyfin/plugins/PiggieTV_0.5.18.0
metadata_root=/var/lib/jellyfin/plugins/configurations/PiggieTV/metadata-quality
rollout=/var/lib/ptv-vm115-jf12-production-20260914/backup

test "$(hostname)" = piggietv
test ! -e "$run"
test "$(systemctl is-active jellyfin.service)" = active
test "$(systemctl show jellyfin.service -p Restart --value)" = on-failure
test "$(systemctl show jellyfin.service -p NeedDaemonReload --value)" = no
pre_pid="$(systemctl show jellyfin.service -p MainPID --value)"
pre_nrestarts="$(systemctl show jellyfin.service -p NRestarts --value)"
test "$pre_pid" != 0
sleep 5
test "$(systemctl show jellyfin.service -p MainPID --value)" = "$pre_pid"
test "$(ss -ltnH 'sport = :8096' | wc -l)" -eq 1
test "$(curl -fsS --max-time 5 http://127.0.0.1:8096/health)" = Healthy

test "$(stat -c '%U:%G:%a' "$selector")" = root:root:644
test "$(sha256sum "$selector" | cut -d' ' -f1)" = a32a8d02e2eefe457ab985a73f084cb978b99b37f81b88dd7952d7d312a9633f
test "$(wc -l < "$selector")" -eq 2
grep -Fxq 'JELLYFIN_WEB_OPT="--webdir=/opt/ptv-web-0.5.59-jf12-vm115-r1"' "$selector"
grep -Fxq 'JELLYFIN_WEB_DIR=/opt/ptv-web-0.5.59-jf12-vm115-r1' "$selector"
test -d "$old_web"
tr '\0' '\n' < "/proc/${pre_pid}/cmdline" | grep -Fxq -- "--webdir=${old_web}"
served_index_sha="$(curl -fsSL --max-time 10 'http://127.0.0.1:8096/web/index.html?ptv-preflight=0.5.59' | sha256sum | cut -d' ' -f1)"
test "$served_index_sha" = "$(sha256sum "$old_web/index.html" | cut -d' ' -f1)"

expected_plugin_files="$(printf '%s\n' Jellyfin.Plugin.PiggieTV.deps.json Jellyfin.Plugin.PiggieTV.dll Jellyfin.Plugin.PiggieTV.pdb Jellyfin.Plugin.PiggieTV.xml meta.json | LC_ALL=C sort)"
actual_plugin_files="$(find "$old_plugin" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)"
test "$actual_plugin_files" = "$expected_plugin_files"
test "$(stat -c '%u:%g:%a' "$old_plugin")" = 110:110:755
while IFS= read -r path; do test "$(stat -c '%u:%g:%a' "$path")" = 110:110:644; done < <(find "$old_plugin" -mindepth 1 -maxdepth 1 -type f -print)
test "$(find /var/lib/jellyfin/plugins -type f -name Jellyfin.Plugin.PiggieTV.dll -print | wc -l)" -eq 1
test "$(find /var/lib/jellyfin/plugins -type f -name Jellyfin.Plugin.PiggieTV.dll -print)" = "$old_plugin/Jellyfin.Plugin.PiggieTV.dll"
test "$(sha256sum "$old_plugin/Jellyfin.Plugin.PiggieTV.dll" | cut -d' ' -f1)" = 94d1980e28c22ff61609ad57d7bac5abdba0e07dfcca19c91874e754a1d2aa4a

for evidence in \
  vm115-jellyfin-app-state-pre12.tar.zst \
  pre12-files-manifest.jsonl \
  archive-member-report.txt; do
    test -f "$rollout/$evidence"
    test -f "$rollout/$evidence.sha256"
    (cd "$rollout" && sha256sum -c --status "$evidence.sha256")
done
test -f "$rollout/PRE12_BACKUP_QUALIFIED"
grep -Fxq 'RUN=vm115-jf12-production-20260914' "$rollout/PRE12_BACKUP_QUALIFIED"

test ! -e "$metadata_root/metadata-quality.json"
test -f "$metadata_root/metadata-quality-index-v2.db"
python3 - <<'PY'
import sqlite3

metadata_path = "/var/lib/jellyfin/plugins/configurations/PiggieTV/metadata-quality/metadata-quality-index-v2.db"
metadata = sqlite3.connect("file:" + metadata_path + "?mode=ro", uri=True)
metadata.execute("PRAGMA query_only=ON")
scalar = lambda sql: metadata.execute(sql).fetchone()[0]
assert scalar("SELECT COUNT(*) FROM mq_result") == 0
assert scalar("SELECT COUNT(*) FROM mq_generation WHERE state='ACTIVE'") == 0
assert scalar("SELECT COUNT(*) FROM mq_generation WHERE state='BUILDING'") == 0
assert scalar("SELECT COUNT(*) FROM mq_generation WHERE state NOT IN ('FAILED','VALIDATING')") == 0
assert scalar("SELECT COUNT(*) FROM mq_generation WHERE pending_source_hash IS NOT NULL OR (state='ACTIVE' AND snapshot_dirty=1)") == 0
assert scalar("SELECT active_generation_id IS NULL FROM mq_store_state WHERE id=1") == 1
metadata.close()

database = sqlite3.connect("file:/var/lib/jellyfin/data/jellyfin.db?mode=ro", uri=True)
database.execute("PRAGMA query_only=ON")
assert [row[0] for row in database.execute("PRAGMA quick_check")] == ["ok"]
database.close()
print("VM115_DATABASE_PREFLIGHT=PASS")
PY
```

Do not run `PRAGMA quick_check` against the Metadata Quality database with the generic SQLite CLI; its registered PTV collation exists only in the Plugin process. Stop on any mismatch and leave production unchanged.

- [ ] Only after the preceding checks pass, create the one-attempt run root and exact rollback copies:

```bash
set -euo pipefail
run=/var/lib/ptv-vm115-stabilization-20260920
selector=/etc/jellyfin/ptv-recovery-web.env
old_plugin=/var/lib/jellyfin/plugins/PiggieTV_0.5.18.0
test ! -e "$run"
test "$(systemctl is-active jellyfin.service)" = active
pre_pid="$(systemctl show jellyfin.service -p MainPID --value)"
pre_nrestarts="$(systemctl show jellyfin.service -p NRestarts --value)"
test "$pre_pid" != 0
sleep 3
test "$(systemctl show jellyfin.service -p MainPID --value)" = "$pre_pid"
test "$(systemctl show jellyfin.service -p NRestarts --value)" = "$pre_nrestarts"
test "$(curl -fsS --max-time 5 http://127.0.0.1:8096/health)" = Healthy
test "$(sha256sum "$selector" | cut -d' ' -f1)" = a32a8d02e2eefe457ab985a73f084cb978b99b37f81b88dd7952d7d312a9633f
test -d "$old_plugin"
install -d -o root -g root -m 0700 \
  "$run" "$run/control" "$run/incoming" "$run/rollback" "$run/retired" "$run/stage" "$run/failed"
printf 'PRE_PID=%s\nPRE_NRESTARTS=%s\n' "$pre_pid" "$pre_nrestarts" > "$run/control/service-before.env"
chmod 0600 "$run/control/service-before.env"
cp -a -- "$selector" "$run/rollback/ptv-recovery-web.env"
cp -a -- "$old_plugin" "$run/rollback/PiggieTV_0.5.18.0"
test "$(sha256sum "$run/rollback/ptv-recovery-web.env" | cut -d' ' -f1)" = a32a8d02e2eefe457ab985a73f084cb978b99b37f81b88dd7952d7d312a9633f
(cd "$old_plugin" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum) > "$run/control/plugin-0.5.18.0.sha256"
(cd "$run/rollback/PiggieTV_0.5.18.0" && sha256sum -c --status "$run/control/plugin-0.5.18.0.sha256")
chmod 0600 "$run/control/plugin-0.5.18.0.sha256"
python3 - <<'PY'
import json
import os

processes = []
for entry in os.scandir('/proc'):
    if not entry.name.isdigit():
        continue
    try:
        with open(f'/proc/{entry.name}/comm', encoding='utf-8') as stream:
            name = stream.read().strip()
        if name not in {'ffmpeg', 'ffprobe'}:
            continue
        with open(f'/proc/{entry.name}/stat', encoding='utf-8') as stream:
            start_ticks = stream.read().split()[21]
        processes.append({'pid': int(entry.name), 'startTicks': start_ticks, 'executable': name})
    except (FileNotFoundError, ProcessLookupError, PermissionError, IndexError):
        continue
path = '/var/lib/ptv-vm115-stabilization-20260920/control/media-processes-before.json'
with open(path, 'x', encoding='utf-8') as stream:
    json.dump(processes, stream, separators=(',', ':'), sort_keys=True)
    stream.write('\n')
os.chmod(path, 0o600)
PY
```

- [ ] Run this authenticated preflight audit through the Base64-over-SSH pattern used in Task 6. It retains the administrator token only in memory and writes only bounded non-secret evidence:

```python
import json
import os
import sqlite3
import urllib.request

run = "/var/lib/ptv-vm115-stabilization-20260920"
database = sqlite3.connect("file:/var/lib/jellyfin/data/jellyfin.db?mode=ro", uri=True)
database.execute("PRAGMA query_only=ON")
row = database.execute("""
    SELECT d.AccessToken
    FROM Devices AS d
    JOIN Users AS u ON u.Id = d.UserId
    WHERE u.Username = 'ptv-recovery-admin'
      AND d.AccessToken IS NOT NULL
      AND length(d.AccessToken) > 0
    ORDER BY d.DateLastActivity DESC
    LIMIT 1
""").fetchone()
database.close()
if row is None:
    raise SystemExit("admin_token_not_found")
headers = {"Authorization": f'MediaBrowser Token="{row[0]}"', "Accept": "application/json"}

def get_json(path):
    request = urllib.request.Request("http://127.0.0.1:8096" + path, headers=headers)
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise SystemExit(f"unexpected_http:{path}:{response.status}")
        return json.load(response)

public = get_json("/System/Info/Public")
assert public.get("Version") == "12.0.0"
assert public.get("ServerName") == "piggietv"
assert public.get("Id") == "8fbfa3299eec41ae99d84c25df4fa002"
assert public.get("StartupWizardCompleted") is True
status = get_json("/Ptv/v1/status")
assert status.get("ok") is True and status.get("degraded") is False
assert status.get("pluginVersion") == "0.5.18.0"
plugins = [
    plugin for plugin in get_json("/Plugins")
    if str(plugin.get("Id", "")).lower() == "27c90ee7-7d56-4591-98f8-b0ebcda8c5fd"
]
assert len(plugins) == 1
assert plugins[0].get("Version") == "0.5.18.0" and plugins[0].get("Status") == "Active"
scan = [task for task in get_json("/ScheduledTasks") if task.get("Key") == "RefreshLibrary"]
assert len(scan) == 1 and scan[0].get("State") == "Idle"
sessions = get_json("/Sessions")
evidence = {
    "activePlaybackCount": sum(1 for session in sessions if session.get("NowPlayingItem") is not None),
    "activePlaybackSessionIds": sorted(
        str(session.get("Id"))
        for session in sessions
        if session.get("NowPlayingItem") is not None and session.get("Id")
    ),
    "scanMediaLibrary": {
        "Id": scan[0].get("Id"),
        "Key": scan[0].get("Key"),
        "State": scan[0].get("State"),
        "LastExecutionResult": scan[0].get("LastExecutionResult"),
    },
}
path = os.path.join(run, "control", "api-before.json")
with open(path, "x", encoding="utf-8") as stream:
    json.dump(evidence, stream, separators=(",", ":"), sort_keys=True)
    stream.write("\n")
os.chmod(path, 0o600)
print("VM115_AUTHENTICATED_PREFLIGHT=PASS")
```

Never write or print the token. Keep the opaque session IDs root-only so later checks can distinguish pre-existing user streams from the acceptance playback; report only the aggregate count and do not stop individual user sessions.

- [ ] Transfer all five deployment files and require exact incoming ownership/mode:

```powershell
$releaseRoot = 'C:\Users\Piggie\Documents\GitHub\_PTV-Artifacts\Deployment'
$pveKey = 'C:\Users\Piggie\Documents\Codex\2026-09-08\ptv-production-incident-readonly\work\parallel-recovery\private\pve-ephemeral-20260912T185233Z'
$vmKnownHosts = 'C:\Users\Piggie\Documents\Codex\2026-09-14\vm115-ptv-recovery\work\vm115_known_hosts.tmp'
$sshCommon = @('-T', '-F', 'none', '-i', $pveKey, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', "UserKnownHostsFile=$vmKnownHosts", '-o', 'ConnectTimeout=8')
$scpCommon = @('-F', 'none', '-i', $pveKey, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', "UserKnownHostsFile=$vmKnownHosts", '-o', 'ConnectTimeout=8')
$releaseFiles = @(
    (Join-Path $releaseRoot 'ptv-web-0.5.60-jf12-vm115-r1.tar.gz'),
    (Join-Path $releaseRoot 'PiggieTV.Plugin_0.5.19.0.zip'),
    (Join-Path $releaseRoot 'ptv-recovery-web-0.5.60-jf12-vm115-r1.env'),
    (Join-Path $releaseRoot 'ptv-0.5.60-0.5.19.0-manifest.json'),
    (Join-Path $releaseRoot 'ptv-0.5.60-0.5.19.0.sha256')
)
$candidateCommit = (& git rev-parse HEAD).Trim()
$localManifest = Get-Content -Raw -LiteralPath (Join-Path $releaseRoot 'ptv-0.5.60-0.5.19.0-manifest.json') | ConvertFrom-Json
if ($candidateCommit -notmatch '^[0-9a-f]{40}$' -or $localManifest.gitCommit -ne $candidateCommit) {
    throw 'Local candidate commit is not bound to the release manifest.'
}
& ssh @sshCommon root@10.16.0.50 "set -euo pipefail; test ! -e /var/lib/ptv-vm115-stabilization-20260920/control/expected-git-commit; umask 077; printf '%s\n' '$candidateCommit' > /var/lib/ptv-vm115-stabilization-20260920/control/expected-git-commit"
if ($LASTEXITCODE -ne 0) { throw 'Remote candidate commit binding failed.' }
& scp @scpCommon @releaseFiles 'root@10.16.0.50:/var/lib/ptv-vm115-stabilization-20260920/incoming/'
if ($LASTEXITCODE -ne 0) { throw 'Release transfer failed.' }
```

On VM115, require exactly those five files, set them root:root mode 0600, and run `(cd "$run/incoming" && sha256sum -c --status ptv-0.5.60-0.5.19.0.sha256)`. The hash manifest covers the Web archive, Plugin ZIP, selector, and JSON manifest; it is itself protected by the already-verified SSH transfer and exact incoming path/set gate.

- [ ] Stage with a one-shot Python program that uses the identical Task 5 canonical tree algorithm. It must:

  1. Recheck the JSON manifest says Web `0.5.60`, Plugin `0.5.19.0`, and the committed candidate `gitCommit`.
  2. Reject duplicate, absolute, parent-traversal, symlink, hard-link, device, and other non-regular archive members.
  3. Require the Plugin ZIP member set to equal the five manifest members exactly.
  4. Extract Web to `/opt/.ptv-web-0.5.60-jf12-vm115-r1.staging` and Plugin to `$run/stage/PiggieTV_0.5.19.0`; both paths and both final target paths must be absent first.
  5. Recompute and match each file count, uncompressed byte count, and canonical tree SHA-256 from the JSON manifest.
  6. Set Web to root:root, directories 0755/files 0644; set Plugin to 110:110, directories 0755/files 0644; then recompute both tree summaries.
  7. Atomically move only the verified Web staging directory to `/opt/ptv-web-0.5.60-jf12-vm115-r1`. Leave the Plugin outside `/var/lib/jellyfin/plugins`.
  8. Install the verified selector as root:root mode 0644 at `/etc/jellyfin/.ptv-recovery-web.env.0.5.60-r1.tmp`, verify its SHA against the JSON manifest, and require exactly the two intended lines without printing them.

Use this exact remote staging body; it fails if any path from a prior attempt exists:

```bash
set -euo pipefail
run=/var/lib/ptv-vm115-stabilization-20260920
incoming="$run/incoming"
web_stage=/opt/.ptv-web-0.5.60-jf12-vm115-r1.staging
web_target=/opt/ptv-web-0.5.60-jf12-vm115-r1
plugin_stage="$run/stage/PiggieTV_0.5.19.0"
plugin_target=/var/lib/jellyfin/plugins/PiggieTV_0.5.19.0
selector_candidate=/etc/jellyfin/.ptv-recovery-web.env.0.5.60-r1.tmp
expected_incoming="$(printf '%s\n' PiggieTV.Plugin_0.5.19.0.zip ptv-0.5.60-0.5.19.0-manifest.json ptv-0.5.60-0.5.19.0.sha256 ptv-recovery-web-0.5.60-jf12-vm115-r1.env ptv-web-0.5.60-jf12-vm115-r1.tar.gz | LC_ALL=C sort)"
actual_incoming="$(find "$incoming" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' | LC_ALL=C sort)"
test "$actual_incoming" = "$expected_incoming"
chown root:root "$incoming"/*
chmod 0600 "$incoming"/*
test "$(find "$incoming" -mindepth 1 -maxdepth 1 ! -type f -print -quit)" = ''
while IFS= read -r path; do test "$(stat -c '%U:%G:%a' "$path")" = root:root:600; done < <(find "$incoming" -mindepth 1 -maxdepth 1 -type f -print)
(cd "$incoming" && sha256sum -c --status ptv-0.5.60-0.5.19.0.sha256)
test ! -e "$web_stage"
test ! -e "$web_target"
test ! -e "$plugin_stage"
test ! -e "$plugin_target"
test ! -e "$selector_candidate"

python3 - "$incoming" "$web_stage" "$plugin_stage" <<'PY'
import hashlib
import json
import os
import pathlib
import pwd
import shutil
import stat
import sys
import tarfile
import zipfile

incoming, web_stage, plugin_stage = map(os.path.abspath, sys.argv[1:])
manifest_path = os.path.join(incoming, "ptv-0.5.60-0.5.19.0-manifest.json")
web_archive = os.path.join(incoming, "ptv-web-0.5.60-jf12-vm115-r1.tar.gz")
plugin_archive = os.path.join(incoming, "PiggieTV.Plugin_0.5.19.0.zip")
selector = os.path.join(incoming, "ptv-recovery-web-0.5.60-jf12-vm115-r1.env")
with open(manifest_path, encoding="utf-8") as stream:
    manifest = json.load(stream)
with open("/var/lib/ptv-vm115-stabilization-20260920/control/expected-git-commit", encoding="ascii") as stream:
    expected_git_commit = stream.read().strip()
assert manifest["schema"] == "ptv.stabilization.release.v1"
assert manifest["webVersion"] == "0.5.60"
assert manifest["pluginVersion"] == "0.5.19.0"
assert len(expected_git_commit) == 40 and all(character in "0123456789abcdef" for character in expected_git_commit)
assert manifest["gitCommit"] == expected_git_commit

def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

assert sha256(web_archive) == manifest["webArchiveSha256"]
assert sha256(plugin_archive) == manifest["pluginArchiveSha256"]
assert sha256(selector) == manifest["selectorSha256"]

def safe_member(name):
    if "\\" in name:
        raise SystemExit(f"archive_backslash:{name}")
    normalized = name.removeprefix("./")
    path = pathlib.PurePosixPath(normalized)
    if path.is_absolute() or ".." in path.parts:
        raise SystemExit(f"archive_unsafe_path:{name}")
    return normalized

with tarfile.open(web_archive, "r:gz") as archive:
    members = archive.getmembers()
    names = [safe_member(member.name) for member in members]
    if len(names) != len(set(names)):
        raise SystemExit("web_archive_duplicate_member")
    if not members or any(not (member.isfile() or member.isdir()) for member in members):
        raise SystemExit("web_archive_unsafe_member_type")
    os.mkdir(web_stage, 0o755)
    archive.extractall(web_stage, members=members, filter="data")

expected_plugin = sorted(manifest["pluginMembers"])
with zipfile.ZipFile(plugin_archive) as archive:
    members = archive.infolist()
    names = [safe_member(member.filename) for member in members]
    files = sorted(member.filename for member in members)
    if len(names) != len(set(names)) or files != expected_plugin or any(member.is_dir() for member in members):
        raise SystemExit("plugin_archive_member_mismatch")
    for member in members:
        unix_type = (member.external_attr >> 16) & 0o170000
        if not member.is_dir() and unix_type not in (0, stat.S_IFREG):
            raise SystemExit(f"plugin_archive_unsafe_member_type:{member.filename}")
    os.mkdir(plugin_stage, 0o755)
    archive.extractall(plugin_stage)

def summarize(root):
    root = os.path.abspath(root)
    paths = []
    for base, directories, files in os.walk(root, followlinks=False):
        directories.sort()
        files.sort()
        for directory in directories:
            if os.path.islink(os.path.join(base, directory)):
                raise SystemExit("tree_symlink")
        for name in files:
            path = os.path.join(base, name)
            relative = os.path.relpath(path, root).replace(os.sep, "/")
            paths.append((relative, path))
    paths.sort(key=lambda entry: entry[0].encode("utf-8"))
    rows = []
    total = 0
    for relative, path in paths:
        if not stat.S_ISREG(os.lstat(path).st_mode):
            raise SystemExit(f"tree_non_regular:{relative}")
        file_digest = sha256(path)
        size = os.path.getsize(path)
        total += size
        rows.append(f"{relative}\0{size}\0{file_digest}\n".encode("utf-8"))
    return {
        "fileCount": len(rows),
        "uncompressedBytes": total,
        "treeSha256": hashlib.sha256(b"".join(rows)).hexdigest(),
    }

def require_summary(prefix, actual):
    expected = {
        "fileCount": manifest[prefix + "FileCount"],
        "uncompressedBytes": manifest[prefix + "UncompressedBytes"],
        "treeSha256": manifest[prefix + "TreeSha256"],
    }
    if actual != expected:
        raise SystemExit(f"{prefix}_tree_mismatch")

require_summary("web", summarize(web_stage))
require_summary("plugin", summarize(plugin_stage))
jellyfin = pwd.getpwnam("jellyfin")
if (jellyfin.pw_uid, jellyfin.pw_gid) != (110, 110):
    raise SystemExit("jellyfin_identity_mismatch")
for root, uid, gid in ((web_stage, 0, 0), (plugin_stage, 110, 110)):
    for base, directories, files in os.walk(root, followlinks=False):
        os.chown(base, uid, gid)
        os.chmod(base, 0o755)
        for name in files:
            path = os.path.join(base, name)
            os.chown(path, uid, gid)
            os.chmod(path, 0o644)
require_summary("web", summarize(web_stage))
require_summary("plugin", summarize(plugin_stage))
print("VM115_RELEASE_EXTRACTION=PASS")
PY

mv -T -- "$web_stage" "$web_target"
install -o root -g root -m 0644 "$incoming/ptv-recovery-web-0.5.60-jf12-vm115-r1.env" "$selector_candidate"
selector_expected="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1],encoding="utf-8"))["selectorSha256"])' "$incoming/ptv-0.5.60-0.5.19.0-manifest.json")"
test "$(sha256sum "$selector_candidate" | cut -d' ' -f1)" = "$selector_expected"
test "$(wc -l < "$selector_candidate")" -eq 2
grep -Fxq 'JELLYFIN_WEB_OPT="--webdir=/opt/ptv-web-0.5.60-jf12-vm115-r1"' "$selector_candidate"
grep -Fxq 'JELLYFIN_WEB_DIR=/opt/ptv-web-0.5.60-jf12-vm115-r1' "$selector_candidate"
```

After staging, run this executable gate. It recomputes both candidate trees rather than trusting the earlier extraction result:

```bash
set -euo pipefail
run=/var/lib/ptv-vm115-stabilization-20260920
. "$run/control/service-before.env"
test "$(systemctl is-active jellyfin.service)" = active
test "$(systemctl show jellyfin.service -p MainPID --value)" = "$PRE_PID"
test "$(systemctl show jellyfin.service -p NRestarts --value)" = "$PRE_NRESTARTS"
test "$(ss -ltnH 'sport = :8096' | wc -l)" -eq 1
test "$(curl -fsS --max-time 5 http://127.0.0.1:8096/health)" = Healthy
tr '\0' '\n' < "/proc/${PRE_PID}/cmdline" | grep -Fxq -- '--webdir=/opt/ptv-web-0.5.59-jf12-vm115-r1'
test "$(sha256sum /etc/jellyfin/ptv-recovery-web.env | cut -d' ' -f1)" = a32a8d02e2eefe457ab985a73f084cb978b99b37f81b88dd7952d7d312a9633f
test "$(find /var/lib/jellyfin/plugins -type f -name Jellyfin.Plugin.PiggieTV.dll -print | wc -l)" -eq 1
test "$(find /var/lib/jellyfin/plugins -type f -name Jellyfin.Plugin.PiggieTV.dll -print)" = /var/lib/jellyfin/plugins/PiggieTV_0.5.18.0/Jellyfin.Plugin.PiggieTV.dll
(cd "$run/rollback/PiggieTV_0.5.18.0" && sha256sum -c --status "$run/control/plugin-0.5.18.0.sha256")
test "$(sha256sum "$run/rollback/ptv-recovery-web.env" | cut -d' ' -f1)" = a32a8d02e2eefe457ab985a73f084cb978b99b37f81b88dd7952d7d312a9633f

python3 - "$run/incoming/ptv-0.5.60-0.5.19.0-manifest.json" /opt/ptv-web-0.5.60-jf12-vm115-r1 "$run/stage/PiggieTV_0.5.19.0" <<'PY'
import hashlib
import json
import os
import stat
import sys

manifest_path, web_root, plugin_root = sys.argv[1:]
with open(manifest_path, encoding='utf-8') as stream:
    manifest = json.load(stream)
with open('/var/lib/ptv-vm115-stabilization-20260920/control/expected-git-commit', encoding='ascii') as stream:
    assert manifest['gitCommit'] == stream.read().strip()

def summary(root):
    rows = []
    total = 0
    paths = []
    for base, directories, files in os.walk(root, followlinks=False):
        directories.sort()
        files.sort()
        if any(os.path.islink(os.path.join(base, name)) for name in directories):
            raise SystemExit('tree_symlink')
        for name in files:
            path = os.path.join(base, name)
            paths.append((os.path.relpath(path, root).replace(os.sep, '/'), path))
    paths.sort(key=lambda entry: entry[0].encode('utf-8'))
    for relative, path in paths:
        if not stat.S_ISREG(os.lstat(path).st_mode):
            raise SystemExit('tree_non_regular')
        digest = hashlib.sha256()
        with open(path, 'rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
        size = os.path.getsize(path)
        total += size
        rows.append(f'{relative}\0{size}\0{digest.hexdigest()}\n'.encode('utf-8'))
    return len(rows), total, hashlib.sha256(b''.join(rows)).hexdigest()

assert summary(web_root) == (manifest['webFileCount'], manifest['webUncompressedBytes'], manifest['webTreeSha256'])
assert summary(plugin_root) == (manifest['pluginFileCount'], manifest['pluginUncompressedBytes'], manifest['pluginTreeSha256'])
print('VM115_POST_STAGE=PASS')
PY

selector_expected="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1],encoding="utf-8"))["selectorSha256"])' "$run/incoming/ptv-0.5.60-0.5.19.0-manifest.json")"
test "$(sha256sum /etc/jellyfin/.ptv-recovery-web.env.0.5.60-r1.tmp | cut -d' ' -f1)" = "$selector_expected"
```

Do not restart or call Metadata Quality endpoints during staging.

### Task 8: Activate The Paired Release With One Restart

**Files:**

- Replace atomically: `/etc/jellyfin/ptv-recovery-web.env`
- Move out of discovery: `/var/lib/jellyfin/plugins/PiggieTV_0.5.18.0`
- Move into discovery: `/var/lib/jellyfin/plugins/PiggieTV_0.5.19.0`
- Preserve: all rollback paths from Task 7

- [ ] Immediately before activation, rerun Task 7's complete executable post-stage gate to recompute both candidate trees, selector hash, rollback hashes, PID, `NRestarts`, and health. Then run the following as one remote command. Jellyfin discovers Plugin assemblies under `/var/lib/jellyfin/plugins`, so no candidate assembly enters that tree before the service is stopped:

```bash
set -euo pipefail
run=/var/lib/ptv-vm115-stabilization-20260920
old_plugin=/var/lib/jellyfin/plugins/PiggieTV_0.5.18.0
new_plugin=/var/lib/jellyfin/plugins/PiggieTV_0.5.19.0
staged_plugin="$run/stage/PiggieTV_0.5.19.0"
retired_plugin="$run/retired/PiggieTV_0.5.18.0"
selector=/etc/jellyfin/ptv-recovery-web.env
selector_candidate=/etc/jellyfin/.ptv-recovery-web.env.0.5.60-r1.tmp
restart_guard=/run/systemd/system/jellyfin.service.d/zzzz-ptv-stabilization-one-attempt.conf
restart_guard_tmp=/run/systemd/system/jellyfin.service.d/.zzzz-ptv-stabilization-one-attempt.conf.tmp
. "$run/control/service-before.env"

test ! -e "$run/control/release-boundary.env"
test ! -e "$run/control/candidate-start-attempted"
test ! -e "$run/control/service-after.env"
test "$(systemctl is-active jellyfin.service)" = active
test "$(systemctl show jellyfin.service -p MainPID --value)" = "$PRE_PID"
test "$(systemctl show jellyfin.service -p NRestarts --value)" = "$PRE_NRESTARTS"
test -d "$old_plugin"
test -d "$staged_plugin"
test ! -e "$new_plugin"
test ! -e "$retired_plugin"
test -f "$selector_candidate"
test "$(find /var/lib/jellyfin/plugins -type f -name Jellyfin.Plugin.PiggieTV.dll -print | wc -l)" -eq 1
test "$(sha256sum "$selector" | cut -d' ' -f1)" = a32a8d02e2eefe457ab985a73f084cb978b99b37f81b88dd7952d7d312a9633f
deadman_timer=ptv-vm115-ephemeral-access-expiry.timer
test "$(systemctl is-active "$deadman_timer")" = active
test "$(systemctl is-enabled "$deadman_timer")" = enabled
test "$(systemctl show "$deadman_timer" -p Persistent --value)" = yes
next_expiry="$(systemctl show "$deadman_timer" -p NextElapseUSecRealtime --value)"
remaining_seconds="$(( $(date -d "$next_expiry" +%s) - $(date +%s) ))"
test "$remaining_seconds" -ge 3600

install -d -o root -g root -m 0755 /run/systemd/system/jellyfin.service.d
test ! -e "$restart_guard" && test ! -e "$restart_guard_tmp"
printf '[Service]\nRestart=no\n' > "$restart_guard_tmp"
chown root:root "$restart_guard_tmp"
chmod 0644 "$restart_guard_tmp"
mv -T -- "$restart_guard_tmp" "$restart_guard"
systemctl daemon-reload
test "$(systemctl show jellyfin.service -p Restart --value)" = no
cleanup_restart_guard() {
    rm -f -- "$restart_guard_tmp" "$restart_guard"
    systemctl daemon-reload
}
trap cleanup_restart_guard EXIT
python3 - <<'PY'
import json
import os
import sqlite3
import urllib.request

run = "/var/lib/ptv-vm115-stabilization-20260920"
database = sqlite3.connect("file:/var/lib/jellyfin/data/jellyfin.db?mode=ro", uri=True)
database.execute("PRAGMA query_only=ON")
row = database.execute("""
    SELECT d.AccessToken
    FROM Devices AS d
    JOIN Users AS u ON u.Id = d.UserId
    WHERE u.Username = 'ptv-recovery-admin'
      AND d.AccessToken IS NOT NULL
      AND length(d.AccessToken) > 0
    ORDER BY d.DateLastActivity DESC
    LIMIT 1
""").fetchone()
database.close()
if row is None:
    raise SystemExit("admin_token_not_found")
request = urllib.request.Request(
    "http://127.0.0.1:8096/Sessions",
    headers={"Authorization": f'MediaBrowser Token="{row[0]}"', "Accept": "application/json"}
)
with urllib.request.urlopen(request, timeout=20) as response:
    if response.status != 200:
        raise SystemExit(f"unexpected_http:/Sessions:{response.status}")
    sessions = json.load(response)
active_ids = sorted(
    str(session.get("Id"))
    for session in sessions
    if session.get("NowPlayingItem") is not None and session.get("Id")
)
evidence = {"activePlaybackCount": len(active_ids), "activePlaybackSessionIds": active_ids}
path = os.path.join(run, "control", "sessions-at-restart.json")
with open(path, "x", encoding="utf-8") as stream:
    json.dump(evidence, stream, separators=(",", ":"), sort_keys=True)
    stream.write("\n")
os.chmod(path, 0o600)
print(f"ACTIVE_PLAYBACK_AT_RESTART_COUNT={len(active_ids)}")
PY
release_stop_since="$(date --iso-8601=seconds)"
(set -o noclobber; printf 'RELEASE_STOP_SINCE=%s\n' "$release_stop_since" > "$run/control/release-boundary.env")
chmod 0600 "$run/control/release-boundary.env"
systemctl stop jellyfin.service
for attempt in $(seq 1 30); do
    test "$(systemctl show jellyfin.service -p MainPID --value)" = 0 && break
    sleep 1
done
test "$(systemctl show jellyfin.service -p MainPID --value)" = 0
test -z "$(ss -ltnH 'sport = :8096')"

mv -T -- "$old_plugin" "$retired_plugin"
mv -T -- "$staged_plugin" "$new_plugin"
mv -T -- "$selector_candidate" "$selector"

test "$(find /var/lib/jellyfin/plugins -type f -name Jellyfin.Plugin.PiggieTV.dll -print | wc -l)" -eq 1
test "$(find /var/lib/jellyfin/plugins -type f -name Jellyfin.Plugin.PiggieTV.dll -print)" = "$new_plugin/Jellyfin.Plugin.PiggieTV.dll"
test "$(wc -l < "$selector")" -eq 2
grep -Fxq 'JELLYFIN_WEB_OPT="--webdir=/opt/ptv-web-0.5.60-jf12-vm115-r1"' "$selector"
grep -Fxq 'JELLYFIN_WEB_DIR=/opt/ptv-web-0.5.60-jf12-vm115-r1' "$selector"

(set -o noclobber; printf 'CANDIDATE_START_ATTEMPTED=1\n' > "$run/control/candidate-start-attempted")
chmod 0600 "$run/control/candidate-start-attempted"
systemctl start jellyfin.service
post_pid=
ready=0
for attempt in $(seq 1 90); do
    current_pid="$(systemctl show jellyfin.service -p MainPID --value)"
    if test "$current_pid" != 0; then
        if test -z "$post_pid"; then post_pid="$current_pid"; else test "$current_pid" = "$post_pid"; fi
    fi
    if test -n "$post_pid" \
      && test "$(systemctl is-active jellyfin.service)" = active \
      && test "$(ss -ltnH 'sport = :8096' | wc -l)" -eq 1 \
      && test "$(curl -fsS --max-time 3 http://127.0.0.1:8096/health 2>/dev/null || true)" = Healthy; then
        ready=1
        break
    fi
    sleep 1
done
test "$ready" -eq 1
test "$post_pid" != "$PRE_PID"
sleep 15
test "$(systemctl show jellyfin.service -p MainPID --value)" = "$post_pid"
test "$(systemctl show jellyfin.service -p NRestarts --value)" = "$PRE_NRESTARTS"
test "$(systemctl is-active jellyfin.service)" = active
test "$(curl -fsS --max-time 5 http://127.0.0.1:8096/health)" = Healthy
tr '\0' '\n' < "/proc/${post_pid}/cmdline" | grep -Fxq -- '--webdir=/opt/ptv-web-0.5.60-jf12-vm115-r1'
cleanup_restart_guard
trap - EXIT
test "$(systemctl show jellyfin.service -p Restart --value)" = on-failure
test "$(systemctl show jellyfin.service -p MainPID --value)" = "$post_pid"
printf 'POST_PID=%s\nCANDIDATE_STOP_CALLS=1\nCANDIDATE_START_CALLS=1\nROLLBACK_STOP_CALLS=0\nROLLBACK_START_CALLS=0\n' "$post_pid" > "$run/control/service-after.env"
chmod 0600 "$run/control/service-after.env"
```

The guard is runtime-only under `/run`, exists solely to prevent `Restart=on-failure` from turning one candidate start into automatic retries, and is removed with `daemon-reload` on every shell exit. The block fails closed before installing that guard unless the persistent access dead-man is active, enabled, and has at least 60 minutes remaining; do not extend or re-arm it. The authenticated `/Sessions` read occurs inside this same command after the guard is installed and immediately before the release-boundary marker and stop; retain IDs only in the root-only evidence file and report only the count. Execute this block through an outer SSH exit-code check: if it returns nonzero after `release-boundary.env` exists, invoke Task 10 immediately and exactly once. If it fails before that marker, production was not stopped; preserve evidence, retire access, and stop. Never invoke this activation block a second time.

- [ ] Run this exact one-shot in-guest acceptance. It proves the running server, loaded Plugin, served Web, and build provenance without printing the token:

```python
import hashlib
import json
import pathlib
import sqlite3
import urllib.request

run = pathlib.Path("/var/lib/ptv-vm115-stabilization-20260920")
web = pathlib.Path("/opt/ptv-web-0.5.60-jf12-vm115-r1")
with (run / "incoming/ptv-0.5.60-0.5.19.0-manifest.json").open(encoding="utf-8") as stream:
    manifest = json.load(stream)
with (run / "control/expected-git-commit").open(encoding="ascii") as stream:
    expected_commit = stream.read().strip()
assert manifest["gitCommit"] == expected_commit

database = sqlite3.connect("file:/var/lib/jellyfin/data/jellyfin.db?mode=ro", uri=True)
database.execute("PRAGMA query_only=ON")
row = database.execute("""
    SELECT d.AccessToken FROM Devices AS d JOIN Users AS u ON u.Id = d.UserId
    WHERE u.Username = 'ptv-recovery-admin'
      AND d.AccessToken IS NOT NULL AND length(d.AccessToken) > 0
    ORDER BY d.DateLastActivity DESC LIMIT 1
""").fetchone()
database.close()
if row is None:
    raise SystemExit("admin_token_not_found")
headers = {"Authorization": f'MediaBrowser Token="{row[0]}"', "Accept": "application/json"}

def get_json(path):
    request = urllib.request.Request("http://127.0.0.1:8096" + path, headers=headers)
    with urllib.request.urlopen(request, timeout=20) as response:
        assert response.status == 200
        return json.load(response)

public = get_json("/System/Info/Public")
assert public.get("Version") == "12.0.0"
assert public.get("ServerName") == "piggietv"
assert public.get("Id") == "8fbfa3299eec41ae99d84c25df4fa002"
assert public.get("StartupWizardCompleted") is True
status = get_json("/Ptv/v1/status")
assert status.get("ok") is True and status.get("degraded") is False
assert status.get("pluginVersion") == "0.5.19.0"
plugins = [
    plugin for plugin in get_json("/Plugins")
    if str(plugin.get("Id", "")).lower() == "27c90ee7-7d56-4591-98f8-b0ebcda8c5fd"
]
assert len(plugins) == 1
assert plugins[0].get("Version") == "0.5.19.0" and plugins[0].get("Status") == "Active"

request = urllib.request.Request("http://127.0.0.1:8096/web/index.html?ptv-release=0.5.60")
with urllib.request.urlopen(request, timeout=20) as response:
    served_index = response.read()
assert hashlib.sha256(served_index).hexdigest() == hashlib.sha256((web / "index.html").read_bytes()).hexdigest()
needles = (b"0.5.60", expected_commit.encode("ascii"))
found = [False, False]
for path in web.rglob("*.js"):
    data = path.read_bytes()
    found = [prior or needle in data for prior, needle in zip(found, needles)]
    if all(found):
        break
assert all(found)
print("VM115_PAIRED_RELEASE_ACTIVATION=PASS")
```

Run it through the established Base64-over-SSH pattern, then recheck the `POST_PID` and `PRE_NRESTARTS` values from the control files. Any failure invokes Task 10; it does not permit a candidate retry.
- [ ] If any gate after activation begins fails, execute Task 10 exactly once; its first action captures `systemctl status` and the bounded journal into new evidence files before rollback. Do not patch production or retry the candidate.

### Task 9: Run Bounded Production Acceptance

**Files:**

- Create: `C:\Users\Piggie\Documents\GitHub\_PTV-Artifacts\Reports\PTV_0.5.60_PLUGIN_0.5.19.0_STABILIZATION_REPORT.md`

- [ ] Direct and public health: require direct VM115 and `https://piggietv.com/` `/health` HTTP 200 `Healthy`; require `/System/Info/Public` HTTP 200 with the expected name, ID, Jellyfin version, and setup-complete state.
- [ ] Authenticated browser regression through `https://piggietv.com/`: login, Home, Movies, Shows, Music, and existing iCarly S02E12 playback. Report only the aggregate interruption count from root-only `sessions-at-restart.json`. Immediately before the controlled playback, take a new authenticated `/Sessions` snapshot into root-only `sessions-before-acceptance-playback.json`; protect the union of its session IDs, `sessions-at-restart.json`, and `api-before.json`. Record the logged-in browser user's Jellyfin user ID and the selected episode item ID without recording credentials. After starting playback, require DirectPlay to advance and identify the controlled session by that exact user ID plus item ID and the browser session's observed client/device identity; do not classify it merely as a session ID absent from the old preflight. Stop playback only with the same browser's playback control, then prove that matched session is no longer playing. Never invoke a Sessions stop endpoint or stop another user's session.
- [ ] Music regression without pressing Refresh: require the page to populate, open one artist, open one album, play one track, return to Music, hard reload, and require it to remain populated. Record the existing Jellyfin counts—33,645 tracks, 2,979 albums, 723 artists—as identity evidence, not as a scan request.
- [ ] Metadata Quality regression: use the in-memory administrator-token pattern and issue exactly one request each, in order, to `/Ptv/v1/metadata-quality/status`, `/Ptv/v1/metadata-quality/summary`, and `/Ptv/v1/metadata-quality/results?limit=50`. Require HTTP 200 for each; `status.storeErrorCode is null`; `summary.counts.totalScanned == 0`; `results.totalRecordCount == 0`; and `results.items == []`. Do not repeat any request if initialization fails.
- [ ] After those three calls, inspect the Metadata Quality database read-only without its generic `quick_check`. Require exactly one `ACTIVE` generation, zero `BUILDING` generations, zero `VALIDATING` generations, zero rows in `mq_result`, `mq_store_state.active_generation_id` equal to that active generation, and zero pending rows under `pending_source_hash IS NOT NULL OR (state='ACTIVE' AND snapshot_dirty=1)`. Record the generated `metadata-quality.json` hash as Plugin-created rollback evidence; do not edit, replace, or delete it.

Use one process for both bullets so no hidden retry is possible:

```python
import hashlib
import json
import os
import sqlite3
import urllib.request

main = sqlite3.connect("file:/var/lib/jellyfin/data/jellyfin.db?mode=ro", uri=True)
main.execute("PRAGMA query_only=ON")
row = main.execute("""
    SELECT d.AccessToken
    FROM Devices AS d JOIN Users AS u ON u.Id = d.UserId
    WHERE u.Username = 'ptv-recovery-admin'
      AND d.AccessToken IS NOT NULL AND length(d.AccessToken) > 0
    ORDER BY d.DateLastActivity DESC LIMIT 1
""").fetchone()
main.close()
if row is None:
    raise SystemExit("admin_token_not_found")
headers = {"Authorization": f'MediaBrowser Token="{row[0]}"', "Accept": "application/json"}

def get_once(path):
    request = urllib.request.Request("http://127.0.0.1:8096" + path, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise SystemExit(f"metadata_http:{path}:{response.status}")
        return json.load(response)

status = get_once("/Ptv/v1/metadata-quality/status")
summary = get_once("/Ptv/v1/metadata-quality/summary")
results = get_once("/Ptv/v1/metadata-quality/results?limit=50")
assert status.get("storeErrorCode") is None
assert summary.get("counts", {}).get("totalScanned") == 0
assert results.get("totalRecordCount") == 0
assert results.get("items") == []

root = "/var/lib/jellyfin/plugins/configurations/PiggieTV/metadata-quality"
indexed = sqlite3.connect("file:" + root + "/metadata-quality-index-v2.db?mode=ro", uri=True)
indexed.execute("PRAGMA query_only=ON")
active = [row[0] for row in indexed.execute("SELECT generation_id FROM mq_generation WHERE state='ACTIVE'")]
assert len(active) == 1
assert indexed.execute("SELECT COUNT(*) FROM mq_generation WHERE state='BUILDING'").fetchone()[0] == 0
assert indexed.execute("SELECT COUNT(*) FROM mq_generation WHERE state='VALIDATING'").fetchone()[0] == 0
assert indexed.execute("SELECT COUNT(*) FROM mq_result").fetchone()[0] == 0
assert indexed.execute("SELECT active_generation_id FROM mq_store_state WHERE id=1").fetchone()[0] == active[0]
assert indexed.execute("SELECT COUNT(*) FROM mq_generation WHERE pending_source_hash IS NOT NULL OR (state='ACTIVE' AND snapshot_dirty=1)").fetchone()[0] == 0
indexed.close()
rollback_json = root + "/metadata-quality.json"
assert os.path.isfile(rollback_json) and not os.path.islink(rollback_json)
with open(rollback_json, "rb") as stream:
    rollback_hash = hashlib.sha256(stream.read()).hexdigest()
print("VM115_METADATA_QUALITY_BOOTSTRAP=PASS")
print("METADATA_ROLLBACK_JSON_SHA256=" + rollback_hash)
```
- [ ] Responsive regression: at 390x844, require Admin Libraries scroll viewport top at or below the sticky header bottom before and after scrolling; require page `scrollTop > 0`, visible library rows below the viewport top, usable Search/Filter/Add Library controls, and no horizontal overflow. At 740x900, 1024x1366, and 2560x1271, require no 126px phone inset, unchanged normal geometry, and accessible controls.
- [ ] Production stability: reload `/ScheduledTasks` once and require Scan Media Library is Idle and its task `Id`, `Key`, and complete `LastExecutionResult` equal `$run/control/api-before.json`; a changed last-run fingerprint is an unexpected scan. Compare current FFmpeg/ffprobe `(pid,startTicks,executable)` identities with `media-processes-before.json`; after the recorded acceptance session stops and stabilization completes, require no process identity created by this acceptance run, while leaving every baseline/user-owned identity alone.
- [ ] Reopen `/var/lib/jellyfin/data/jellyfin.db` with `mode=ro` and `PRAGMA query_only=ON`; require `PRAGMA quick_check` returns exactly `ok`. Do not compare the live database SHA with an older hash and do not manually write the database.
- [ ] Record `candidate_stop_calls=1`, `candidate_start_calls=1`, `rollback_stop_calls=0`, `rollback_start_calls=0`, the aggregate `active_playback_at_restart_count` from `sessions-at-restart.json`, artifact hashes/tree summaries, selected Web/Plugin paths, stable PID, `NRestarts` comparison, health/identity, focused and full tests, backlog classification, Atlas decision, and `MEDIA_MODIFIED: NO` / `DATABASE_MANUALLY_MODIFIED: NO` in the final report. Keep session IDs private. `NRestarts` is an automatic-restart counter, not the planned stop/start count.

### Task 10: Roll Back On A Hard Gate Failure

- [ ] On a hard gate failure after activation began, capture status and the bounded journal first. Then run exactly one rollback stop/start; retain candidate Web and Plugin trees as evidence and never delete or overwrite either:

```bash
set -euo pipefail
run=/var/lib/ptv-vm115-stabilization-20260920
old_plugin=/var/lib/jellyfin/plugins/PiggieTV_0.5.18.0
new_plugin=/var/lib/jellyfin/plugins/PiggieTV_0.5.19.0
retired_plugin="$run/retired/PiggieTV_0.5.18.0"
failed_plugin="$run/failed/PiggieTV_0.5.19.0"
selector=/etc/jellyfin/ptv-recovery-web.env
selector_candidate=/etc/jellyfin/.ptv-recovery-web.env.0.5.60-r1.tmp
selector_failed="$run/failed/ptv-recovery-web.env.0.5.60"
selector_failed_staged="$run/failed/ptv-recovery-web.env.0.5.60.staged"
selector_rollback="$run/rollback/ptv-recovery-web.env"
selector_rollback_tmp=/etc/jellyfin/.ptv-recovery-web.env.rollback-0.5.60-r1.tmp
restart_guard=/run/systemd/system/jellyfin.service.d/zzzz-ptv-stabilization-one-attempt.conf
restart_guard_tmp=/run/systemd/system/jellyfin.service.d/.zzzz-ptv-stabilization-one-attempt.conf.tmp
candidate_selector_sha="$(sha256sum "$run/incoming/ptv-recovery-web-0.5.60-jf12-vm115-r1.env" | cut -d' ' -f1)"
old_selector_sha=a32a8d02e2eefe457ab985a73f084cb978b99b37f81b88dd7952d7d312a9633f
. "$run/control/service-before.env"
. "$run/control/release-boundary.env"
test ! -e "$run/control/rollback-attempted"
test ! -e "$run/control/rollback-start-attempted"
test ! -e "$run/control/service-after-rollback.env"
(set -o noclobber; printf 'ROLLBACK_ATTEMPTED=1\n' > "$run/control/rollback-attempted")
chmod 0600 "$run/control/rollback-attempted"

test ! -e "$run/failed/candidate-systemctl-status.txt"
test ! -e "$run/failed/candidate-jellyfin-journal.txt"
systemctl status jellyfin.service --no-pager --full > "$run/failed/candidate-systemctl-status.txt" 2>&1 || true
journalctl -u jellyfin.service -b --since "$RELEASE_STOP_SINCE" --no-pager > "$run/failed/candidate-jellyfin-journal.txt" 2>&1 || true
rm -f -- "$restart_guard" "$restart_guard_tmp"
install -d -o root -g root -m 0755 /run/systemd/system/jellyfin.service.d
printf '[Service]\nRestart=no\n' > "$restart_guard_tmp"
chown root:root "$restart_guard_tmp"
chmod 0644 "$restart_guard_tmp"
mv -T -- "$restart_guard_tmp" "$restart_guard"
systemctl daemon-reload
test "$(systemctl show jellyfin.service -p Restart --value)" = no
cleanup_restart_guard() {
    rm -f -- "$restart_guard_tmp" "$restart_guard"
    systemctl daemon-reload
}
trap cleanup_restart_guard EXIT
rollback_nrestarts_before="$(systemctl show jellyfin.service -p NRestarts --value)"
systemctl stop jellyfin.service || true
for attempt in $(seq 1 30); do
    test "$(systemctl show jellyfin.service -p MainPID --value)" = 0 && break
    sleep 1
done
test "$(systemctl show jellyfin.service -p MainPID --value)" = 0
test -z "$(ss -ltnH 'sport = :8096')"

if test -d "$new_plugin"; then
    test ! -e "$failed_plugin"
    mv -T -- "$new_plugin" "$failed_plugin"
fi
if test -d "$retired_plugin" && test ! -e "$old_plugin"; then
    mv -T -- "$retired_plugin" "$old_plugin"
elif ! test -d "$old_plugin" || test -e "$retired_plugin"; then
    printf 'rollback_error=ambiguous_old_plugin_state\n' >&2
    exit 1
fi
(cd "$old_plugin" && sha256sum -c --status "$run/control/plugin-0.5.18.0.sha256")

test -f "$selector"
live_selector_sha="$(sha256sum "$selector" | cut -d' ' -f1)"
if test "$live_selector_sha" = "$candidate_selector_sha"; then
    test ! -e "$selector_failed"
    cp -a -- "$selector" "$selector_failed"
elif test "$live_selector_sha" != "$old_selector_sha"; then
    printf 'rollback_error=ambiguous_selector_state\n' >&2
    exit 1
fi
if test -f "$selector_candidate"; then
    test ! -e "$selector_failed_staged"
    cp -a -- "$selector_candidate" "$selector_failed_staged"
    rm -f -- "$selector_candidate"
fi
test ! -e "$selector_rollback_tmp"
install -o root -g root -m 0644 "$selector_rollback" "$selector_rollback_tmp"
test "$(sha256sum "$selector_rollback_tmp" | cut -d' ' -f1)" = "$old_selector_sha"
mv -T -- "$selector_rollback_tmp" "$selector"
test "$(sha256sum "$selector" | cut -d' ' -f1)" = "$old_selector_sha"
test "$(find /var/lib/jellyfin/plugins -type f -name Jellyfin.Plugin.PiggieTV.dll -print | wc -l)" -eq 1
test "$(find /var/lib/jellyfin/plugins -type f -name Jellyfin.Plugin.PiggieTV.dll -print)" = "$old_plugin/Jellyfin.Plugin.PiggieTV.dll"

(set -o noclobber; printf 'ROLLBACK_START_ATTEMPTED=1\n' > "$run/control/rollback-start-attempted")
chmod 0600 "$run/control/rollback-start-attempted"
systemctl start jellyfin.service
rollback_pid=
ready=0
for attempt in $(seq 1 90); do
    current_pid="$(systemctl show jellyfin.service -p MainPID --value)"
    if test "$current_pid" != 0; then
        if test -z "$rollback_pid"; then rollback_pid="$current_pid"; else test "$current_pid" = "$rollback_pid"; fi
    fi
    if test -n "$rollback_pid" \
      && test "$(systemctl is-active jellyfin.service)" = active \
      && test "$(ss -ltnH 'sport = :8096' | wc -l)" -eq 1 \
      && test "$(curl -fsS --max-time 3 http://127.0.0.1:8096/health 2>/dev/null || true)" = Healthy; then
        ready=1
        break
    fi
    sleep 1
done
test "$ready" -eq 1
sleep 15
test "$(systemctl show jellyfin.service -p MainPID --value)" = "$rollback_pid"
test "$(systemctl show jellyfin.service -p NRestarts --value)" = "$rollback_nrestarts_before"
tr '\0' '\n' < "/proc/${rollback_pid}/cmdline" | grep -Fxq -- '--webdir=/opt/ptv-web-0.5.59-jf12-vm115-r1'
cleanup_restart_guard
trap - EXIT
test "$(systemctl show jellyfin.service -p Restart --value)" = on-failure
candidate_start_calls=0
test ! -e "$run/control/candidate-start-attempted" || candidate_start_calls=1
printf 'ROLLBACK_PID=%s\nCANDIDATE_STOP_CALLS=1\nCANDIDATE_START_CALLS=%s\nROLLBACK_STOP_CALLS=1\nROLLBACK_START_CALLS=1\nNRESTARTS_BEFORE_RELEASE=%s\nNRESTARTS_BEFORE_ROLLBACK=%s\nNRESTARTS_AFTER_ROLLBACK=%s\n' \
  "$rollback_pid" "$candidate_start_calls" "$PRE_NRESTARTS" "$rollback_nrestarts_before" "$(systemctl show jellyfin.service -p NRestarts --value)" \
  > "$run/control/service-after-rollback.env"
chmod 0600 "$run/control/service-after-rollback.env"
```

- [ ] Execute Task 10 through a one-shot outer SSH check. If the rollback start or its validation fails, capture a second `systemctl status` and bounded journal under `$run/failed/rollback-*`, restore the normal `Restart=on-failure` policy through the runtime-guard cleanup, report the actual state, and stop without another start.
- [ ] Require original VM115 identity, Jellyfin 12.0.0, Web 0.5.59 served-index equality, exactly one Plugin 0.5.18.0 Active, `/health` Healthy, stable PID, Home, Movies, and Shows. The candidate fix changes no Metadata Quality schema; if it already created the empty `ACTIVE` generation and rollback JSON before a later gate failed, verify Plugin 0.5.18.0 reads that supported state without error and do not restore or edit the Metadata Quality database/JSON. Report the candidate failure and rollback result; do not push the failed release and do not retry it.
- [ ] Do not change routing to CT113 unless the user separately authorizes that materially different recovery action.

### Task 11: Final Verification And Push

**Files:**

- Verify: complete repository and release report

- [ ] Treat access retirement as a mandatory final step for every path after Task 6 installs the key: acceptance, successful rollback, mount failure, preflight failure, transfer failure, staging failure, activation failure, or rollback failure. The already-armed persistent guest dead-man remains the independent interruption/reboot fallback. Attempt direct retirement over the last live SSH connection, then always run the idempotent QEMU Guest Agent repair/proof and disarm the dead-man so a partial direct cleanup cannot strand access:

```powershell
$pveKey = 'C:\Users\Piggie\Documents\Codex\2026-09-08\ptv-production-incident-readonly\work\parallel-recovery\private\pve-ephemeral-20260912T185233Z'
$pveKnownHosts = 'C:\Users\Piggie\Documents\Codex\2026-09-08\ptv-production-incident-readonly\work\parallel-recovery\private\pve_known_hosts'
$vmKnownHosts = 'C:\Users\Piggie\Documents\Codex\2026-09-14\vm115-ptv-recovery\work\vm115_known_hosts.tmp'
$sshCommon = @('-T', '-F', 'none', '-i', $pveKey, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', "UserKnownHostsFile=$vmKnownHosts", '-o', 'ConnectTimeout=8')
$retireScript = @'
set -euo pipefail
access_lock=/run/ptv-vm115-ephemeral-access.lock
directory=/root/.ssh
authorized=$directory/authorized_keys
backup=$directory/authorized_keys.pre-jf12-production-20260915
temporary=$directory/.authorized_keys.codex-direct-retire.tmp
exec 9>"$access_lock"
flock -x 9
test "$(sha256sum "$authorized" | cut -d' ' -f1)" = 694b070540b87357c71553421c93e55f9573d7e4465e8e706bf58787910f28e5
test "$(sha256sum "$backup" | cut -d' ' -f1)" = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
test ! -e "$temporary"
cp -a -- "$backup" "$temporary"
mv -f -- "$temporary" "$authorized"
rm -f -- "$backup"
test "$(stat -c '%U:%G:%a:%s' "$authorized")" = root:root:600:0
test "$(sha256sum "$authorized" | cut -d' ' -f1)" = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
printf 'VM115_EPHEMERAL_KEY_DIRECT_RETIRE=PASS\n'
'@

& ssh @sshCommon root@10.16.0.50 $retireScript
$directRetireExit = $LASTEXITCODE

$qgaRepair = @'
set -euo pipefail
deadman_script=/usr/local/sbin/ptv-vm115-ephemeral-access-expiry
deadman_service=/etc/systemd/system/ptv-vm115-ephemeral-access-expiry.service
deadman_timer=/etc/systemd/system/ptv-vm115-ephemeral-access-expiry.timer
deadman_wants=/etc/systemd/system/timers.target.wants/ptv-vm115-ephemeral-access-expiry.timer
deadman_stamp=/var/lib/systemd/timers/stamp-ptv-vm115-ephemeral-access-expiry.timer
deadman_script_tmp=/usr/local/sbin/.ptv-vm115-ephemeral-access-expiry.tmp
deadman_service_tmp=/etc/systemd/system/.ptv-vm115-ephemeral-access-expiry.service.tmp
deadman_timer_tmp=/etc/systemd/system/.ptv-vm115-ephemeral-access-expiry.timer.tmp
access_lock=/run/ptv-vm115-ephemeral-access.lock
directory=/root/.ssh
authorized=$directory/authorized_keys
backup=$directory/authorized_keys.pre-jf12-production-20260915
install_temporary=$directory/.authorized_keys.codex-jf12.tmp
direct_temporary=$directory/.authorized_keys.codex-direct-retire.tmp
deadman_temporary=$directory/.authorized_keys.codex-deadman-retire.tmp
qga_temporary=$directory/.authorized_keys.codex-qga-retire.tmp
key_sha=694b070540b87357c71553421c93e55f9573d7e4465e8e706bf58787910f28e5
empty_sha=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
exec 9>"$access_lock"
flock -x 9
test -f "$authorized"
authorized_sha="$(sha256sum "$authorized" | cut -d' ' -f1)"
if test "$authorized_sha" = "$key_sha"; then
    test -f "$backup"
    test "$(sha256sum "$backup" | cut -d' ' -f1)" = "$empty_sha"
    rm -f -- "$qga_temporary"
    cp -a -- "$backup" "$qga_temporary"
    mv -f -- "$qga_temporary" "$authorized"
    rm -f -- "$backup"
elif test "$authorized_sha" = "$empty_sha"; then
    if test -e "$backup"; then
        test "$(sha256sum "$backup" | cut -d' ' -f1)" = "$empty_sha"
        rm -f -- "$backup"
    fi
else
    printf 'access_retirement_error=unexpected_authorized_keys_hash\n' >&2
    exit 1
fi
rm -f -- "$install_temporary" "$direct_temporary" "$deadman_temporary" "$qga_temporary"
chown root:root "$authorized"
chmod 0600 "$authorized"
test "$(stat -c '%U:%G:%a:%s' "$authorized")" = root:root:600:0
test "$(sha256sum "$authorized" | cut -d' ' -f1)" = "$empty_sha"
test ! -e "$backup" && test ! -e "$install_temporary" && test ! -e "$direct_temporary" && test ! -e "$deadman_temporary" && test ! -e "$qga_temporary"
rm -f -- \
  /run/systemd/system/jellyfin.service.d/zzzz-ptv-stabilization-one-attempt.conf \
  /run/systemd/system/jellyfin.service.d/.zzzz-ptv-stabilization-one-attempt.conf.tmp
systemctl daemon-reload
test "$(systemctl show jellyfin.service -p Restart --value)" = on-failure
systemctl stop ptv-vm115-ephemeral-access-expiry.timer ptv-vm115-ephemeral-access-expiry.service 2>/dev/null || true
test "$(systemctl is-active ptv-vm115-ephemeral-access-expiry.timer 2>/dev/null || true)" != active
test "$(systemctl is-active ptv-vm115-ephemeral-access-expiry.service 2>/dev/null || true)" != active
rm -f -- "$deadman_wants" "$deadman_timer" "$deadman_service" "$deadman_stamp" "$deadman_script" "$deadman_script_tmp" "$deadman_service_tmp" "$deadman_timer_tmp"
systemctl daemon-reload
for path in "$deadman_script" "$deadman_service" "$deadman_timer" "$deadman_wants" "$deadman_stamp" "$deadman_script_tmp" "$deadman_service_tmp" "$deadman_timer_tmp"; do test ! -e "$path"; done
flock -u 9
rm -f -- "$access_lock"
printf 'VM115_EPHEMERAL_KEY_QGA_REPAIR=PASS\n'
'@
$qgaRepairB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($qgaRepair))
$qgaCommand = "qm guest exec 115 -- bash -lc `"printf '%s' '$qgaRepairB64' | base64 -d | bash`""
& ssh -T -F none -i $pveKey -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o "UserKnownHostsFile=$pveKnownHosts" -o ConnectTimeout=8 root@10.16.0.254 $qgaCommand
if ($LASTEXITCODE -ne 0) { throw 'QGA access-retirement proof failed.' }
& ssh @sshCommon root@10.16.0.50 true
if ($LASTEXITCODE -eq 0) { throw 'Retired VM115 key still authenticates.' }
if ($directRetireExit -ne 0) { Write-Output 'Direct retirement needed the verified QGA fallback.' }
```

Stop if cleanup cannot be proven.

- [ ] If the candidate rolled back, write the failure/rollback report in `_PTV-Artifacts`, preserve all evidence, do not push the failed release branch, and stop.
- [ ] On full candidate acceptance only, apply `superpowers:verification-before-completion`. Re-run the shortest authoritative local gates without changing the candidate:

```powershell
git diff --check
npm run version:ptv:check
node scripts/ptv-plugin-version.cjs check
npm run test:plugin-contract
git status --short
git log --oneline --decorate -12
```

- [ ] Require the repository tree to be clean and the immutable artifact manifest to name the exact local `HEAD`. The production report stays outside the repository; there is no post-build repository commit:

```powershell
$manifestPath = 'C:\Users\Piggie\Documents\GitHub\_PTV-Artifacts\Deployment\ptv-0.5.60-0.5.19.0-manifest.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$localHead = (& git rev-parse HEAD).Trim()
if (git status --porcelain) { throw 'Repository changed after artifact build.' }
if ($manifest.gitCommit -ne $localHead) { throw 'Artifact commit differs from local HEAD.' }
```

If any repository-owned evidence must change after artifact construction, stop, commit it deliberately, rerun the release gate, and build a new candidate. Never push a commit that differs from the deployed artifact manifest.

- [ ] Push only the accepted clean branch, then compare the exact remote ref with local `HEAD`:

```powershell
git status --short --branch
$localHead = (& git rev-parse HEAD).Trim()
$currentBranch = (& git branch --show-current).Trim()
if ($currentBranch -ne 'release/ptv-web-0.5.60') { throw "Unexpected release branch: $currentBranch" }
git push --set-upstream origin HEAD:refs/heads/release/ptv-web-0.5.60
if ($LASTEXITCODE -ne 0) { throw 'Release branch push failed.' }
$remoteLine = (& git ls-remote --heads origin refs/heads/release/ptv-web-0.5.60).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Remote release ref readback failed.' }
$remoteHead = ($remoteLine -split '\s+')[0]
if (-not $remoteHead -or $remoteHead -ne $localHead) { throw 'Remote release head differs from local HEAD.' }
```

- [ ] Do not merge to `master` or create a pull request unless the user separately asks.
