# Metadata Quality Empty-Store Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a first-run Metadata Quality store with no legacy `metadata-quality.json` export and activate an empty indexed generation successfully.

**Architecture:** `PtvMetadataQualityIndexedStore.InitializeCoreAsync` creates an empty document when the legacy JSON source is absent. `ImportDocumentAsync` must leave that no-source generation in `BUILDING` until the existing export path writes the rollback snapshot and promotes it to `VALIDATING`; existing legacy-file imports must continue to enter `VALIDATING` directly. No schema, controller, scanner, database, or API-contract change is required.

**Tech Stack:** C# / .NET 9, Microsoft.Data.Sqlite, xUnit, Jellyfin Plugin runtime.

**Spec:** `docs/superpowers/specs/2026-09-20-ptv-jellyfin12-stabilization-design.md`

## Global Constraints

- Target the VM115 Jellyfin 12 production baseline, PTV Web 0.5.59, and PiggieTV Plugin 0.5.18.0 before the coordinated release bump.
- Change only the Plugin's empty-store Metadata Quality initialization state; preserve legacy JSON import behavior.
- Do not manually edit the Metadata Quality SQLite store or `metadata-quality.json` in production.
- Do not rebuild, replace, or manually edit the Jellyfin database; do not modify media files or library definitions.
- Do not run a broad library scan, change public routing, or change Jellyfin, FFmpeg, SQLite, timeout, concurrency, or thread-pool settings.
- The Plugin release bump occurs exactly once in the shared release plan after all Plugin code changes: `0.5.18.0` to `0.5.19.0`.
- The production activation is a single required Jellyfin restart through the established deployment procedure; stop and roll back at the first failed validation boundary.

## Review Focus

- Absent `metadata-quality.json`: `EmptyStoreBootstrapExportsAndActivatesAnEmptyGeneration` must create the JSON rollback snapshot instead of returning `PTV_METADATA_QUALITY_GENERATION_INVALID`.
- Empty document contents: that test must report `TotalScanned == 0`, zero result records, and an empty result list.
- Activation state: that test must prove exactly one `ACTIVE` generation and no residual `BUILDING`, `VALIDATING`, or `FAILED` generation.
- Error recovery surface: that test must prove `GetErrorCodeAsync()` is null after successful bootstrap.
- Legacy source compatibility: the existing `ConcurrentInitializationImportsOneGenerationAndPreservesLegacyJsonExactly` test remains in the full Plugin suite and proves a pre-existing JSON source is imported without replacing its bytes.

---

## File Structure

- Modify: `src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/PtvMetadataQualityIndexedStoreTests.cs` — adds the regression test beside existing indexed-store initialization tests. The file already owns isolated temporary store roots and SQLite assertion helpers.
- Modify: `src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Services/PtvMetadataQualityIndexedStore.cs` — makes the imported generation's final state conditional on whether a legacy source hash exists.
- Deferred to the shared release plan: `src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj`, source `meta.json`, `PluginReleaseVersionContractTests.cs`, and `scripts/ptv-plugin-contract-check.mjs` — the version script updates these synchronized declarations together.

### Task 1: Lock down empty-store first-run activation

**Files:**
- Modify: `src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/PtvMetadataQualityIndexedStoreTests.cs:17-45`
- Test: `src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/PtvMetadataQualityIndexedStoreTests.cs`

**Interfaces:**
- Consumes: `PtvMetadataQualityStore.ResultsPath`, `PtvMetadataQualityIndexedStore.EnsureReadyAsync(CancellationToken)`, `ReadSummaryAsync(CancellationToken)`, `QueryResultsAsync(PtvMetadataQualityResultQuery, CancellationToken)`, and `GetErrorCodeAsync(CancellationToken)`.
- Produces: `EmptyStoreBootstrapExportsAndActivatesAnEmptyGeneration`, an xUnit regression test proving empty-store export and activation through the public indexed-store read interfaces.

- [ ] **Step 1: Add the failing first-run regression test directly after `ConcurrentInitializationImportsOneGenerationAndPreservesLegacyJsonExactly`**

```csharp
    [Fact]
    public async Task EmptyStoreBootstrapExportsAndActivatesAnEmptyGeneration()
    {
        var legacy = CreateLegacyStore();
        Assert.False(File.Exists(legacy.ResultsPath));
        var indexed = CreateIndexedStore(legacy);

        await indexed.EnsureReadyAsync();

        var summary = await indexed.ReadSummaryAsync();
        var page = await indexed.QueryResultsAsync(new PtvMetadataQualityResultQuery { Limit = 50 });
        var generationId = summary.GenerationId;

        Assert.True(File.Exists(legacy.ResultsPath));
        Assert.Equal(0, summary.Counts.TotalScanned);
        Assert.Equal(0, page.TotalRecordCount);
        Assert.Empty(page.Items);
        Assert.Empty((await legacy.ReadAsync()).ItemResults);
        Assert.Null(await indexed.GetErrorCodeAsync());

        await using var connection = OpenDatabase(indexed.DatabasePath);
        await connection.OpenAsync();
        Assert.Equal(1L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation;"));
        Assert.Equal(1L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation WHERE state = 'ACTIVE';"));
        Assert.Equal(0L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation WHERE state IN ('BUILDING', 'VALIDATING', 'FAILED');"));
        Assert.Equal(0L, await ScalarLongAsync(
            connection,
            "SELECT COUNT(*) FROM mq_generation WHERE pending_source_hash IS NOT NULL OR (state = 'ACTIVE' AND snapshot_dirty = 1);"));

        var restarted = CreateIndexedStore(legacy);
        var restartedSummary = await restarted.ReadSummaryAsync();
        Assert.Equal(generationId, restartedSummary.GenerationId);
        Assert.Equal(0, restartedSummary.Counts.TotalScanned);
    }
```

- [ ] **Step 2: Run the focused test before changing production code**

Run from repository root:

```powershell
dotnet test src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/Jellyfin.Plugin.PiggieTV.Tests.csproj --configuration Release --filter FullyQualifiedName~EmptyStoreBootstrapExportsAndActivatesAnEmptyGeneration
```

Expected: FAIL at `await indexed.EnsureReadyAsync()` with `PtvMetadataQualityStoreException` code `PTV_METADATA_QUALITY_GENERATION_INVALID`, because `ImportDocumentAsync` puts the empty generation in `VALIDATING` before `ExportAndMarkGenerationAsync` executes its `state = BUILDING` guarded update.

- [ ] **Step 3: Commit the red regression test only**

```powershell
git add src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/PtvMetadataQualityIndexedStoreTests.cs
git commit -m "test: cover empty metadata quality bootstrap"
```

### Task 2: Preserve BUILDING until empty-store export completes

**Files:**
- Modify: `src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Services/PtvMetadataQualityIndexedStore.cs:769-787`
- Test: `src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/PtvMetadataQualityIndexedStoreTests.cs` (the test added in Task 1)

**Interfaces:**
- Consumes: nullable `string? sourceHash` supplied to `ImportDocumentAsync(SqliteConnection, PtvMetadataQualityDocument, string?, long, CancellationToken)`.
- Produces: no new public interface. A legacy-source import finishes as `VALIDATING`; a no-source import remains `BUILDING` until `ExportAndMarkGenerationAsync` performs the existing guarded `BUILDING -> VALIDATING` snapshot promotion.

- [ ] **Step 1: Replace the unconditional imported-state parameter with the source-aware state**

In `ImportDocumentAsync`, replace this line:

```csharp
            command.Parameters.AddWithValue("@state", GenerationValidating);
```

with this exact code:

```csharp
            command.Parameters.AddWithValue(
                "@state",
                sourceHash is null ? GenerationBuilding : GenerationValidating);
```

Do not change `ExportAndMarkGenerationAsync`, `ActivateGenerationAsync`, the schema, or `ImportJsonStreamAsync`. The existing `if (sourceHash is null)` call immediately after the UPDATE remains responsible for exporting the empty document, recording its generated source hash, promoting it to `VALIDATING`, and permitting activation.

- [ ] **Step 2: Run the focused regression test**

Run:

```powershell
dotnet test src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/Jellyfin.Plugin.PiggieTV.Tests.csproj --configuration Release --filter FullyQualifiedName~EmptyStoreBootstrapExportsAndActivatesAnEmptyGeneration
```

Expected: PASS. It proves the generated empty JSON exists, the read APIs return an empty active generation, `GetErrorCodeAsync()` is null, and the SQLite state contains no unfinished generation.

- [ ] **Step 3: Run all indexed-store coverage and then the full Plugin suite**

Run:

```powershell
dotnet test src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/Jellyfin.Plugin.PiggieTV.Tests.csproj --configuration Release --filter FullyQualifiedName~PtvMetadataQualityIndexedStoreTests
dotnet test src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/Jellyfin.Plugin.PiggieTV.Tests.csproj --configuration Release
```

Expected: PASS. The first command covers the retained legacy-file initialization path, concurrent initialization, recovery states, and the new empty-store path; the second confirms the full Plugin test project remains green.

- [ ] **Step 4: Review the scoped diff and commit the implementation**

Run:

```powershell
git diff --check
git diff -- src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Services/PtvMetadataQualityIndexedStore.cs src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/PtvMetadataQualityIndexedStoreTests.cs
```

Expected: no whitespace errors; the production diff is only the conditional `@state` value and the test was committed in Task 1.

Commit:

```powershell
git add src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Services/PtvMetadataQualityIndexedStore.cs
git commit -m "fix: activate empty metadata quality store"
```

## Shared Release and Deployment Boundary

The shared stabilization release plan owns the sole Plugin version bump and production deployment because Web and Plugin changes ship together. Do not create a second Plugin release, publish artifact, catalog entry, checksum, or deployment from this plan's two commits.

Do not run the Plugin version bump, publish a Plugin artifact, or deploy from this subplan. The shared release plan performs the sole `0.5.18.0` to `0.5.19.0` bump, publishes the five-file payload, installs it at `/var/lib/jellyfin/plugins/PiggieTV_0.5.19.0`, and owns the single production restart. A stale `meta.json` may keep the Plugin disabled, so the shared release must deploy `Jellyfin.Plugin.PiggieTV.dll`, `Jellyfin.Plugin.PiggieTV.deps.json`, `Jellyfin.Plugin.PiggieTV.pdb`, `Jellyfin.Plugin.PiggieTV.xml`, and `meta.json` from the same build. Do not manually create, delete, or edit `/var/lib/jellyfin/plugins/configurations/PiggieTV/metadata-quality/metadata-quality.json` or its SQLite database.

After the single restart, verify Jellyfin health and Plugin version `0.5.19.0`. Then, using an authenticated administrator, request exactly once each:

```text
GET /Ptv/v1/metadata-quality/status
GET /Ptv/v1/metadata-quality/summary
GET /Ptv/v1/metadata-quality/results?limit=50
```

Require HTTP 200 from all three. `status` is observational; `summary` is the first request that initializes the indexed store. Require no `storeErrorCode`, summary `totalScanned` equal to zero for an empty store, and results with zero total and an empty item collection. Do not issue a scan, rebuild, retry loop, or cleanup action. Stop immediately, preserve logs and request evidence, and use the existing rollback if any request fails, any `PTV_METADATA_QUALITY_*` error appears, Plugin health/version is wrong, an unexpected scan starts, or any Jellyfin database/media change is observed.

## Self-Review

- Spec coverage: the no-legacy-source BUILDING requirement is Task 2; first-run regression coverage is Task 1; Plugin version, one restart, one-shot status/summary/results validation, and failure stop conditions are in the shared release boundary.
- Placeholder scan: no deferred implementation marker, unspecified code block, or undefined symbol is used. The only angle-bracketed deployment directory is the repository README's documented deployment target and is deliberately not an invented VM path.
- Type consistency: the plan uses the existing `ImportDocumentAsync` nullable `string? sourceHash`, state constants, indexed-store public APIs, and existing test helpers exactly as declared.
- Review focus: the new test explicitly checks absent-source export, empty output, ACTIVE state, no residual generations, and cleared error state; the full indexed-store suite retains legacy JSON compatibility coverage.
