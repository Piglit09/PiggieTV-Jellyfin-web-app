# PTV Jellyfin 12 Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship three bounded, proven fixes—Music stale-empty recovery, Metadata Quality empty-store bootstrap, and mobile Admin Libraries header clearance—then deploy and validate PTV Web 0.5.60 with PiggieTV Plugin 0.5.19.0 on the working VM115 Jellyfin 12 production baseline.

**Architecture:** Keep each behavior change inside its current owner and regression suite, integrate them through one release branch and one paired deployment, and preserve the existing Web selector, Plugin directory, Jellyfin database, libraries, media, routing, and rollback baseline. The Music mount is restored through the already-configured host automount; no mount configuration or library definition changes are permitted.

**Tech Stack:** TypeScript, React, Vitest, Sass, Webpack, Playwright, C#/.NET 9, xUnit, Jellyfin 12.0.0, FFmpeg 8.1.2, systemd, VirtioFS, PowerShell, Git.

**Spec:** [2026-09-20 PTV Jellyfin 12 stabilization design](../specs/2026-09-20-ptv-jellyfin12-stabilization-design.md)

## Global Constraints

- Work from `C:\Users\Piggie\Documents\Codex\2026-09-14\vm115-ptv-recovery\work\ptv-source-release-0.5.59` and preserve unrelated user changes.
- Create `release/ptv-web-0.5.60` from the approved documentation baseline before product edits; do not implement on `master` or rewrite published history.
- Do not change public routing, Jellyfin 12.0.0, FFmpeg 8.1.2, library definitions, media roots, media ownership, media contents, SQLite settings, timeouts, concurrency, thread-pool settings, or the Jellyfin database manually.
- Do not create another diagnostic harness, VM, or CT; extend the existing focused test owners only.
- Do not run a broad library scan. Restoring the T7 mount must not itself restart Jellyfin. Ignore the user's active streams until the single deployment restart is required, then record the interruption and restart count.
- Bump PTV Web exactly once with `npm run version:ptv:bump`; bump the Plugin exactly once with `node scripts/ptv-plugin-version.cjs bump`. Do not edit `package.json` for the PTV Web version and do not bump either product for documentation-only commits.
- Plugin deployment is the complete five-file publish payload, not a DLL-only copy. Keep the complete 0.5.18.0 directory and the 0.5.59 Web tree available for rollback.
- Stop on a failed red test that does not fail for the expected reason, an unexpected product diff, a mount identity mismatch, a production identity mismatch, a failed single Jellyfin start, an unexpected scan, or a failed database integrity check. Preserve evidence; do not broaden scope or retry automatically.

## Atlas Impact Record

```text
ATLAS IMPACT RECORD
Scope: Reject stale confirmed-empty Music snapshots only after their TTL; preserve Metadata Quality empty bootstrap in BUILDING until its normal export transition; inset only the narrow-screen settings/admin scroll viewport below the existing 126px sticky shell header.
Baseline (repository / branch / HEAD / product version / dirty paths): Piglit09/PiggieTV-Jellyfin-web-app / release/ptv-web-0.5.59 / ff7d6185c33d2ffb6ff36a893b2bb19b9742f93e / PTV Web 0.5.59 and PiggieTV Plugin 0.5.18.0 / documentation-plan paths only before product implementation.
Stock authoritative owner and contract: Jellyfin user-scoped Views/Items APIs own Music catalog and hierarchy; the PiggieTV Plugin indexed store owns Metadata Quality generation persistence; the PTV shell owns the sticky mobile header while the settings Page owns its independent scroll viewport.
Current PTV owner(s) and modification class: src/ptv/modules/music/musicApi.ts cache admission; PtvMetadataQualityIndexedStore.ImportDocumentAsync generation-state initialization; src/ptv/modules/settings/settings.scss mobile viewport geometry. These are narrow defect corrections inside existing owners.
Affected map nodes, edges, mutations, routes, and risk boundaries: Music home persistent snapshot read/write and live fallback; /Ptv/v1/metadata-quality/status, /summary, and /results bootstrap path; Settings -> Admin Libraries layout beneath the shell header. No new route, schema, API major, or owner is introduced.
Identity, permission, and security scope: Existing serverId:userId Music cache key and authenticated Jellyfin/Plugin calls remain unchanged. Metadata endpoints retain administrator authorization. No credential, token, permission, or cross-user behavior changes.
DTO projection, mutation, readback, and convergence risks: A stale confirmed-empty snapshot must not be promoted to current memory state; a failed live request must leave its persisted fallback intact. Legacy Metadata JSON imports must remain VALIDATING while source-less bootstrap remains BUILDING until export. Mobile CSS must not change DOM, focus, controls, or desktop geometry.
Affected cache, lifecycle, request, image, playback, and configuration owners: Music home snapshot schema v2 only; no featured cache, image, identity, playback, or settings-persistence change. Metadata Quality generation lifecycle only; no manual SQLite mutation. Settings scroll viewport only; no Admin Libraries data or mutation path change.
Downstream surfaces that can regress: Music initial load, manual refresh, artist -> album navigation, track playback, reload persistence; Metadata Quality first status/summary/results; mobile Admin Libraries scrolling, filters, Add Library action, horizontal overflow; tablet and desktop Settings layouts.
Pre-code characterization/security tests: Five focused Music persistent-cache cases; fresh empty Metadata Quality store test; Playwright geometry failure at 390x844 plus 1024x1366 and 2560x1271 controls. Existing authorization contracts remain in the Plugin suite.
Post-code focused, boundary, integration, and physical tests: Focused Vitest, xUnit, and Playwright tests; full relevant Web and Plugin suites; typecheck, lint/stylelint, production builds, version/contract checks; VM115 health/identity, Music navigation/playback/reload, one Metadata status/summary/results call each, mobile and desktop browser acceptance, no broad scan, no post-stabilization FFmpeg, and database quick_check.
Conflicts or UNKNOWN items: Exact live deployment hashes are intentionally generated from the final build and recorded before mutation. Chip overflow remains UNKNOWN until the bounded responsive inspection in the release plan; it must not be folded into this release without a direct reproduction and separate approval.
Active known deviations and stabilization-backlog entries/order affected: Resolves the documented stale-empty Music cache, empty Metadata Quality bootstrap, and mobile Admin Libraries overlap. The named non-blocking backlog is classified without changing its implementation order.
Atlas update: not required unless actual-diff review shows a changed owner, route, schema, contract, lifecycle, or non-guarantee. These changes correct implementation within already documented owners; the release report must record the final actual-diff decision.
```

## Review Focus

- The Music change must distinguish freshness from cache usefulness without deleting the persisted stale-empty fallback.
- The Plugin change must alter only the state parameter for `sourceHash is null`; legacy-import behavior must be byte-for-byte equivalent outside that expression.
- The mobile change must move the settings scroll viewport, not paint over content or modify library-card behavior.
- Version bumps must happen only after all three implementation diffs are green and only once per product.
- Production rollout must use the live selector and Plugin directory discovered and verified at preflight; it must preserve `/opt/ptv-web-0.5.59-jf12-vm115-r1` and `/var/lib/jellyfin/plugins/PiggieTV_0.5.18.0` as rollback inputs.

## Plan Package And Order

- [ ] Treat this approved spec and five-plan package as the documentation baseline committed by the planning task before implementation handoff. Execution must begin from that documentation commit with a clean tree; if `git status --porcelain` is nonempty, stop rather than folding unrelated work into the release branch.
- [ ] Execute [Music stabilization](2026-09-20-ptv-music-stabilization.md) first. It has no Plugin dependency and proves both cache admission and mount safety.
- [ ] Execute [Metadata Quality bootstrap](2026-09-20-metadata-quality-bootstrap.md) second. Keep its source and tests isolated from Web changes.
- [ ] Execute [mobile Libraries overlap](2026-09-20-mobile-libraries-overlap.md) third. Use the existing E2E harness and do not touch Admin Libraries data code.
- [ ] Execute [release integration and production validation](2026-09-20-ptv-stabilization-release-validation.md) last. It owns backlog reconciliation, reference documentation, one-time version bumps, complete validation, artifact creation, paired deployment, production acceptance, and the final push.

### Task 1: Prepare The Full Release Branch

**Files:**

- Read: `AGENTS.md`
- Read: `src/ptv/plugin/AGENTS.md`
- Read: `docs/architecture/jellyfin-reference/INDEX.md`
- Read: `docs/architecture/jellyfin-reference/system-map.json`
- Read: `docs/architecture/jellyfin-reference/05-library-item-relationships.md`
- Read: `docs/architecture/jellyfin-reference/10-music.md`
- Read: `docs/architecture/jellyfin-reference/13-metadata-identify.md`
- Read: `docs/architecture/jellyfin-reference/15-settings-admin-mutations.md`
- Read: `docs/architecture/jellyfin-reference/16-caching-invalidation.md`
- Read: `docs/architecture/jellyfin-reference/19-failure-race-lifecycle.md`
- Read: `docs/architecture/jellyfin-reference/20-ptv-vs-stock-map.md`
- Read: `docs/architecture/jellyfin-reference/21-ownership-conflicts.md`
- Read: `docs/architecture/jellyfin-reference/22-change-impact-matrix.md`
- Read: `docs/architecture/jellyfin-reference/23-before-you-modify-checklists.md`
- Read: `docs/architecture/jellyfin-reference/24-stock-api-contract-reference.md`
- Read: `docs/architecture/jellyfin-reference/25-known-jellyfin-non-guarantees.md`

- [ ] Verify the planning baseline and populate the sparse worktree before creating a release branch:

```powershell
Set-Location 'C:\Users\Piggie\Documents\Codex\2026-09-14\vm115-ptv-recovery\work\ptv-source-release-0.5.59'
git status --short --branch
git rev-parse HEAD
git sparse-checkout disable
git status --short --branch
git switch -c release/ptv-web-0.5.60
```

Expected: the starting tree is clean, the full source appears without content changes, and the new branch points at the approved documentation commit.

- [ ] Read the files above and query `system-map.json` for Music, Metadata Quality, settings, shell, caches, routes, mutations, risk boundaries, deviations, and backlog entries. Stop if the actual owners conflict with the completed Atlas record.
- [ ] Run the baseline focused suites before edits:

```powershell
npx vitest run --config vite.config.ts src/ptv/modules/music/musicApiRequests.test.ts src/ptv/modules/music/musicApi.test.ts
dotnet test src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/Jellyfin.Plugin.PiggieTV.Tests.csproj --configuration Release --filter FullyQualifiedName~PtvMetadataQualityIndexedStoreTests
npm run test:e2e:build
npm exec playwright -- test e2e/tests/shell-header-visual.spec.ts --workers=1
```

Expected: all existing tests pass. A baseline failure is a stop condition; do not hide it with the new changes.

- [ ] Commit no changes in this task. Record the baseline output in the implementation report used by the release plan.

### Task 2: Execute The Three Independent Fix Plans

- [ ] For each child plan, the selected `superpowers:subagent-driven-development` workflow supplies two explicit gates after implementation: a spec-compliance review followed by a code-quality review. If native execution is selected, dispatch the same two bounded reviews manually. Record the reviewed commit SHA, reviewer, findings, resolutions, and final PASS in the implementation report outside the repository; do not integrate a child plan until both reviews pass.
- [ ] Implement the Music plan completely, obtain both required reviews, and keep its commits isolated.
- [ ] Implement the Metadata plan completely, obtain both required reviews, and keep its commit isolated.
- [ ] Implement the mobile plan completely, obtain both required reviews, and keep its commits isolated.
- [ ] After each plan, run `git status --short`, `git diff --check`, and `git log -1 --oneline`; stop if files outside that plan's declared scope changed.

### Task 3: Execute Release Integration And Production Validation

- [ ] Follow the release plan only after all three focused plans are green and reviewed.
- [ ] Do not deploy any artifact until the release plan's local validation, identity, rollback, mount, and hash gates all pass.
- [ ] Push only after production acceptance and final verification succeed.

### Task 4: Final Handoff

- [ ] Report actual owners/contracts changed or preserved, actual-diff blast radius, tests run, production checks, restart count, remaining `UNKNOWN` items, backlog classification, Atlas-update decision, Web/Plugin versions, artifact hashes, commit IDs, and pushed branch.
- [ ] Explicitly state `MEDIA_MODIFIED: NO` and `DATABASE_MANUALLY_MODIFIED: NO`; if either cannot be stated truthfully, the release is not complete.
