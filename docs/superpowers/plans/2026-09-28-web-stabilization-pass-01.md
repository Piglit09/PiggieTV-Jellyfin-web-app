# Web stabilization Pass 01 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Native implementation; one whole-diff review after verification. Steps use checkbox syntax.

**Goal:** Prevent Movies/Shows/Anime/Cartoons browse rows from crossing their selected Jellyfin library, and eliminate the reproduced Home render loop.

**Architecture:** Keep Jellyfin's user-aware library tree authoritative. Reuse ordinary recursive per-ParentId reads for membership, including recommendation presentation; global recommendation ranking remains global and is never membership proof. Preserve configured Home freshness proofs while stabilizing derived presentation and making identical preview updates no-ops.

**Tech Stack:** React 18, TypeScript, Vitest, existing Webpack local workflow.

**Spec:** `C:/Users/Piggie/Desktop/PTV2.txt`, approved bounded design in this task.

## Global constraints

- Canonical checkout only; base `4eda45c8c6bd56a8f6ab9e31fa81ddc13d5e0073`; branch `fix/web-library-isolation`.
- Web remains 0.5.60 by explicit user override of the repository bump default. Plugin unchanged.
- LOCAL ONLY: Web 127.0.0.1:8085, Jellyfin 12.0.0 at 127.0.0.1:8097, F-drive test media.
- No production contact, deploy, push, server restart/scan/refresh, or media changes.
- No remaining player/update/mobile/native-app backlog work or new recommendation/diagnostic system.
- Preserve old dirty checkout/worktrees and existing configured-row security/freshness tests.

## Review focus

- Same media type in three distinct libraries must not establish membership.
- Missing/failed library resolution and failed membership reads must never issue global fallback.
- Warm global ranking, empty/small results, back/refresh/route changes must retain scope.
- Multiple roots and nested parents must not rely on unsupported AncestorIds or Ids+ParentId shortcuts.
- Stable Home previews must still retire exact old proofs and accept genuinely changed DTOs.

## Atlas Impact Record (pre-code)

Scope: Web browse request/presentation scope and Native Home render lifecycle only.
Baseline: canonical checkout / fix/web-library-isolation / 4eda45c8c6bd56a8f6ab9e31fa81ddc13d5e0073 / 0.5.60 / initially clean.
Stock authoritative owner and contract: Jellyfin UserViewManager, library item tree, authenticated user-aware Items/Resume/Ancestors reads; DTOs are projections, not whole-tree identity. VERIFIED_FROM_SOURCE via Atlas 05/06/16/19/24/25 and exact controller evidence.
Current PTV owners/modification class: NativeBrowsePage/browseData (STOCK_REPLACED); existing recommendation engine (NEW_PTV_SYSTEM, ranking preserved); hooks/useConfiguredHomePreview/NativeHome (STOCK_REPLACED, configured proof owner preserved).
Affected map nodes/edges/routes/risks: systems.home, systems.libraryAndItemRelationships, owners.configuredHomePresentation, owners.route; configuredPresentationFreshness and dualRouteLifecycle; /movies, /shows, /tv, /home and scoped query routes.
Identity/security: server + user + resolved library IDs + route generation; server authorization remains independent. No ACL/auth/token/policy change. Library membership is presentation correctness, not a new security boundary.
DTO/mutation/readback/convergence: ordinary per-root reads without Ids; do not authorize membership from type/genre/provider/name. No mutations. AncestorIds is not a supported stock Items HTTP scope; Ids can bypass normal folder querying.
Cache/lifecycle/request/image/playback/config: global ranking cache unchanged; fresh scoped reads mediate library recommendation presentation. Existing scoped focused/directory cache identities retained and versioned where interpretation changes. Route cancellation/identity guards retained. Stable Home presentation and idempotent preview state preserve exact freshness snapshots; no playback/config/image-owner redesign.
Downstream surfaces: Featured/Continue/Recommended/generated tag shelves/focused Latest/Genres/Studios/Networks; global Home/hub rows unchanged; hero fallback and Details/back must remain local.
Pre-code proof: captured Anime row contains Shows IDs 513ff0775ebdd75183659ffdd6bfac04 and 32498cf190b17f5b47ca7c928d58a1b4; Home Maximum update depth exceeded stack names NativeHomeHero. Add failing scope and preview tests before behavioral fixes.
Post-code proof: focused scope/recommendation/cache/route/Home-freshness tests; full Web tests, typecheck, targeted/baseline lint, production build; local Home/Shows/Anime/Cartoons/Movies and specified navigation/refresh matrix.
Conflicts/UNKNOWN: no conflicting owner; user version override intentional. Local Cartoons library absent, so manual check must prove unavailable/empty without bleed; populated Cartoons membership covered by fixtures. Extra previously captured unknown rejection/root-unmount warning not yet reproduced in this pass; do not claim a cause without evidence.
Active deviations/order: only Pass 01 library isolation and Home runtime errors; prior recovery/normalization and remaining backlog remain closed/out of scope.
Atlas update: required for library presentation/request scope and Home idempotent lifecycle contract; append current local-only evidence to chapter 21/23 and system-map without overwriting historical deployment claims.

## Task 1: Library isolation

Files: browseData.ts + tests; shared browse scope/recommendation seams + tests; NativeBrowsePage.tsx; relevant Atlas additions.

- [x] Trace route → resolved ID → each row producer → ranking/cache/fallback → cards. Classify global Home/hub/Collections separately.
- [x] Add failing tests for Shows/Anime/Cartoons same-type fixtures; missing roots; multiple/nested roots; no Ids membership shortcut; ranking-cache reuse; empty/small/failure/cancellation; route reconstruction/back/refresh fixtures. Manual matrix remains separate.
- [x] Reuse ordinary per-library reads; select ranked IDs only from returned scoped DTOs; retain same-library fallback and fail closed before missing-scope landing requests.
- [x] Verify all focused/library route caches and publication guards; no cache disabling or Plugin changes.
- [x] Run focused tests; inspect diff; record actual red/green results, including grouped-view/Random/backdrop review corrections.

## Task 2: Home lifecycle and final validation

Files: hooks.ts; useConfiguredHomePreview.ts + tests; related integration tests; Atlas additions.

- [x] Add failing tests for callback/effect render-cycle convergence, duplicate preview no-op, changed DTO adoption, and exact freshness-proof retirement.
- [x] Memoize derived current presentation on authoritative state/identity/freshness snapshot; avoid duplicate Preview wrapper updates while retaining captured proof lifetime.
- [x] Reproduce any additional Home-owned error separately before changing its owner; fix only proven causes within Pass 01. Historical unknown-promise/root-unmount observations not reproduced and not claimed fixed.
- [x] Run focused suites, `npm test`, `npm run build:check`, targeted ESLint and `npm run lint:ptv`, `npm run build:production` with external output. Final full suite: 449 files / 3847 tests; focused: 14 files / 196 tests; unchanged quality gate; build's two existing size warnings only.
- [ ] Manually verify specified local navigation and hard-refresh matrix; record returned IDs and distinct console errors, no credentials.
- [x] Reconcile Atlas against actual diff; one fresh read-only whole-diff review and bounded finding closures; stage explicit paths and commit logical fixes only after verification. Product commits `bab66ca834` (library isolation/backdrop) and `08bf4bdccd` (Home loop).
- [x] Produce exact PTV2 PARTIAL checkpoint fields with linked evidence; stop before remaining backlog. Manual acceptance remains explicitly pending, not passed. No push/deploy/version bump.

## Local acceptance interruption

At the deliberate post-fix Anime hard reload, the existing local Jellyfin process/listener had stopped; Web remained online. Browser rendered Server Unavailable. The user administration tab had earlier shown Restart request accepted, which the agent did not click. No restart or production fallback was attempted. Async direction requested one unchanged existing local test-instance start, user start, or offline-only checkpoint. Until this is resolved, manual acceptance is pending and the checkpoint cannot be PASS.
