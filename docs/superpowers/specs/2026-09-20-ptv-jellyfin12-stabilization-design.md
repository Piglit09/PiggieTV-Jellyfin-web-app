# PTV Jellyfin 12 Stabilization Design

Date: 2026-09-20

Status: Approved direction; awaiting written-spec confirmation

Target: VM115 Jellyfin 12 production baseline, PTV Web 0.5.59, PiggieTV Plugin 0.5.18.0

## Objective

Stabilize the current working VM115 production system with the smallest proven changes for four bounded areas:

1. Restore dependable Music availability and prevent PTV Web from remaining stuck on a stale empty Music result.
2. Repair Metadata Quality first-run initialization.
3. Prevent the mobile Libraries page from scrolling content beneath the glass navigation header.
4. Reconcile the named backlog items and create a reference-client document without reopening recovery, migration, or broad infrastructure work.

The existing production baseline, public routing, Jellyfin database, working Movies/Shows/Music definitions, and media files must remain intact.

## Evidence and Root Causes

### Music

- Jellyfin still indexes 33,645 audio tracks, 2,979 albums, and 723 artists for the Music library.
- The configured path is `/mnt/ptv-media/_External/T7/Music`.
- VM115's VirtioFS parent is present, but the host T7 filesystem is not mounted after the latest host reboot. The existing systemd automount is waiting; its configuration and device UUID remain present.
- Jellyfin 12 returns the indexed Music items successfully through the same user-scoped item APIs used by PTV Web.
- PTV Web initially displayed the empty-state message. A single manual Refresh immediately populated the Music page, and the populated state survived reload.
- `musicApi.ts` treats a stale, previously confirmed-empty persistent snapshot as usable when stale cache reads are allowed, so initial page load may return that snapshot without a live request.

There are therefore two separate Music defects:

1. A production path-availability failure at the existing host automount-to-VirtioFS boundary.
2. A PTV Web cache-validity defect that can preserve an obsolete empty catalog after the server has items.

### Metadata Quality

On a store with no legacy `metadata-quality.json`, initialization creates an empty generation. `ImportDocumentAsync` moves that generation to `VALIDATING`, while `ExportAndMarkGenerationAsync` requires it to remain `BUILDING` before performing the guarded transition. The guarded update affects zero rows and throws `PTV_METADATA_QUALITY_GENERATION_INVALID`.

This is a deterministic Plugin bootstrap-state bug. It is not an authentication failure, a scan failure, or a proven Jellyfin 12 API incompatibility.

### Mobile Libraries

At a 390x844 viewport, the 126px PTV shell header is sticky while `#ptvSettingsPage` remains an independently scrolling viewport beginning at the top of the screen. Its initial padding clears the header only at scroll origin. After scrolling, library cards move through the area behind the transparent header and glass navigation.

The affected surface is the global mobile shell header/navigation over the settings page, not the normal-flow Admin Libraries filter group.

## Chosen Approach

Use a minimal layered repair: restore the existing mount at runtime, correct only the invalid cache/state/layout rules, add focused regressions, and validate each layer independently before production deployment.

Two alternatives were rejected:

- Runtime-only Music refresh: restoring the mount and manually refreshing would leave the stale-empty cache defect able to recur.
- Broad cache, Plugin, or shell redesign: the observed failures have narrow causes and do not justify wider production risk.

## Detailed Design

### 1. Restore the Existing Music Path

No mount configuration will be rewritten. Activate the existing T7 mount through its current systemd automount/mount unit, then verify in this order:

1. The expected UUID is mounted at the existing host path.
2. The host path exposes the expected `Music` directory.
3. VM115 sees `/mnt/ptv-media/_External/T7/Music` through the existing VirtioFS mapping.
4. Jellyfin's service account can traverse, list, and read a representative media file.
5. The existing Jellyfin Music library still has the same ID and configured path.

Do not change `/etc/fstab`, VirtioFS mappings, library configuration, media ownership, or media contents. Do not restart Jellyfin unless deployment later requires it. Do not trigger a full-library scan. If the existing index and files are already usable, no scan is needed; otherwise any refresh must be scoped to Music only.

### 2. Correct Stale Empty Music Cache Handling

Preserve the existing fast path for useful cached Music data and the short-lived empty-cache behavior. Change only the stale-empty case:

- A fresh confirmed-empty snapshot remains usable for its normal TTL.
- A stale confirmed-empty snapshot is not terminal and must cause a live Music request.
- A successful live response replaces the obsolete snapshot using the existing persistence path.
- Existing stale non-empty cache behavior remains unchanged unless a test proves it shares the defect.
- Failed live requests retain current error/fallback semantics; the change must not turn a transient API error into destructive cache clearing.

The implementation should make the freshness requirement explicit at the cache-admission boundary rather than add page-specific retries. No automatic mutation or duplicate request loop will be introduced.

Focused regression cases:

1. A stale confirmed-empty snapshot plus a now-populated Jellyfin response performs the live request and returns populated sections.
2. A fresh confirmed-empty snapshot remains usable within its TTL.
3. A non-empty cache continues to follow the existing accepted behavior.
4. Refresh still replaces the cache normally.

### 3. Repair Metadata Quality Initialization

When no legacy source document exists, keep the new generation in `BUILDING` until the normal export/validation activation path advances it. When a legacy source document exists, preserve the current `VALIDATING` import behavior.

The state assignment becomes logically equivalent to:

```csharp
sourceHash is null ? GenerationBuilding : GenerationValidating
```

The normal sequence for an empty first run is then `BUILDING -> VALIDATING -> ACTIVE`.

Focused regression coverage initializes a fresh store without a legacy JSON file and requires:

- initialization succeeds;
- the empty rollback JSON is written;
- summary count is zero;
- exactly one generation is `ACTIVE`;
- no generation remains `BUILDING` or `VALIDATING`;
- there is no pending snapshot;
- reopening the store retains the same active generation.

Existing failed or stranded initialization records will be handled by the store's supported retirement path. There will be no manual SQLite editing, store wipe, or Jellyfin database work.

### 4. Fix the Mobile Libraries Overlap

Keep the mobile sticky shell header and its glass navigation. On the narrow-screen settings/admin surface only, inset the independent settings scroll viewport below the mobile header. Adjust redundant route padding so the initial content position remains visually unchanged.

Constraints:

- Scope the geometry change to the PTV settings/admin page at the existing mobile breakpoint.
- Do not change desktop shell behavior or unrelated routes.
- Do not make the global header non-sticky.
- Do not merely hide the overlap with an opaque mask.
- Preserve access to library cards, filter controls, and action buttons without horizontal overflow.

Browser regression checks will cover 390x844 after scrolling, a tablet/control width, and desktop. At narrow width, visible settings content must not enter the header's occupied region.

### 5. Backlog Reconciliation and Reference Client

After the three functional repairs are verified, classify the named backlog items against the current source and tests:

- PDF zoom
- reading artwork
- calendar
- generated rows
- recommendation persistence
- Home backdrop
- settings save/warning behavior
- Reading Identify
- chip overflow

Each item will be marked as already implemented, reproduced defect, not reproduced, or deferred with concrete evidence. No unrelated backlog fix will be folded into this release without a proven direct dependency.

Create the requested reference-client document from the verified production behavior and repository contracts. It will describe the supported Music, Metadata Quality, Libraries, and responsive client behavior without embedding credentials or private media data.

## Versioning and Release Boundaries

- PTV Web receives one version bump because the Music cache and mobile layout ship Web changes. The expected next version is 0.5.60, subject to repository convention verification.
- PiggieTV Plugin receives one version bump because Metadata Quality code changes. The expected next version is 0.5.19.0, subject to repository convention verification.
- Jellyfin remains 12.0.0 and FFmpeg remains 8.1.2.
- No other component is bumped for symmetry.
- Required Atlas/change-protocol records will be updated for the shipped behavior.

## Verification Sequence

### Development

1. Add each focused regression test first and demonstrate that it fails for the expected reason.
2. Apply the smallest implementation change.
3. Run the focused Music, Metadata Quality, and responsive checks.
4. Run the relevant existing Web and Plugin tests.
5. Run Web type checking, linting, and production build.
6. Run Plugin test/build verification.
7. Review the final diff for unrelated changes and secrets.

### Production

1. Confirm the rollback artifact and current healthy baseline before deployment.
2. Restore the existing T7 mount and validate host, guest, and Jellyfin-account access.
3. Deploy the versioned Web and Plugin artifacts through the established path.
4. Perform only the restart required to activate the Plugin/Web release, recording the count.
5. Verify Jellyfin health, identity, Plugin health, public routing, Movies, Shows, Music, and existing playback.
6. Verify Music page population, artist navigation, album navigation, track playback, and persistence across reload without relying on manual Refresh.
7. Call Metadata Quality status, summary, and results once; require successful empty-store activation rather than repeated initialization attempts.
8. Verify mobile Libraries scrolling at the target viewport and desktop controls.
9. Confirm no unexpected full-library scan, database integrity regression, or media modification.

If a production validation step fails, stop at that boundary, preserve the evidence, and use the existing rollback rather than expanding scope.

## Safety Invariants

- Do not change public routing.
- Do not rebuild, replace, or manually edit the Jellyfin database.
- Do not manually edit the Metadata Quality SQLite store.
- Do not modify media files or working library definitions.
- Do not run a broad library scan.
- Do not change Jellyfin, FFmpeg, SQLite, timeout, concurrency, or thread-pool settings.
- Do not reopen VM/CT recovery or migration work.
- Ignore active user test streams unless a required deployment restart is reached; restart only when needed and record it.

## Completion Criteria

The task is complete when:

- the existing Music path is available and Music navigation/playback works;
- stale empty Music cache state no longer blocks live catalog recovery;
- Metadata Quality initializes and serves status/summary/results without manual cleanup;
- mobile Libraries content no longer scrolls beneath the glass navigation;
- the named backlog is reconciled and the reference-client document exists;
- focused and relevant existing tests, builds, and production health checks pass;
- no media files or Jellyfin database contents were manually modified.
