# PTV Account Creation Wire Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the administrator creation flow proceed after the Plugin's successful reserved response when its nullable `userId` is omitted, while keeping recovery and Home access safeguards visible.

**Architecture:** Web accepts only `null` or an omitted `userId` on a confirmed unbound reservation. The existing Plugin reservation, Jellyfin create, ID binding, restricted policy write, and Home proof sequence remains authoritative. The Add User dialog reports the current transaction phase and preserves the saved recovery hint on failure.

**Tech Stack:** React, TypeScript, Vitest, Jellyfin SDK; existing .NET Plugin tests for unchanged server contracts.

**Spec:** `C:\Users\Piggie\Desktop\PTV2.txt` (task brief supplied by user; not a source of higher priority instructions).

## Global Constraints

- Source root: `C:\Users\Piggie\Documents\GitHub\Jellyfin-Web-PiggieTV`, branch `integration/responsive-playback-jf122-stage4`, base `15750d00a88c3dc83a558aa9e311f26e2a8e3d17`.
- Read-only `.125` runtime inspection; no deployment, restart, live account/config/reservation mutation, `.50` contact, push, or release.
- Do not relax reservation operation ID, state, migration hold, bootstrap flag, or bound-user checks; never grant all libraries by default to a selected-library account.
- Web product source change receives exactly one Web patch version bump; Plugin version stays at 0.5.25.0 unless Plugin product source changes.

## Review Focus

- Omitted nullable `userId` on a successful reserve must lead to exactly one Jellyfin Create; explicit non-null `userId` must fail closed.
- An uncertain reservation must retain the `prepared` hint and never call Jellyfin Create.
- A confirmed reservation must persist `create-started` before Jellyfin Create so a lost response cannot trigger an unsafe retry.
- A post-create permission or Home proof failure must leave a recoverable known ID and display the failed phase.
- Selected-library intent must reach the policy writer unchanged and must never turn into all-library access.

## Atlas Impact Record (pre-code)

ATLAS IMPACT RECORD

Scope: Restore Web interpretation of an omitted nullable field in `POST /Ptv/v1/home-user-access/creations/reserve`; expose Add User progress and failure phase. No Plugin behavior change proposed.

Baseline (repository / branch / HEAD / product version / dirty paths): `Jellyfin-Web-PiggieTV` / `integration/responsive-playback-jf122-stage4` / `15750d00a88c3dc83a558aa9e311f26e2a8e3d17` / Web 0.5.79, Plugin 0.5.25.0 / clean. `audit` and `edit` preflight passed.

Stock authoritative owner and contract: `VERIFIED_FROM_SOURCE` Jellyfin `POST /Users/New` creates user identity; Jellyfin owns policy and user-aware library access (Atlas chapters 04, 15, 24). A successful reserve is not proof of account existence.

Current PTV owner(s) and modification class: `VERIFIED_FROM_SOURCE` Web `AdminUserDialogs` and `adminNewUserBootstrapService` own staged local creation hint, response validation, and orchestration; Plugin `PtvHomeUserAccessLedger` owns durable reservation and per-user Home proof (`STOCK_EXTENDED` / `NEW_PTV_SYSTEM`).

Affected map nodes, edges, mutations, routes, and risk boundaries: `mutations.newUserBootstrapAndMigration`, `apiContracts.ptvV1.homeUserAccess`, `ptvOverrides.controlledHomeAuthorityTransitions`, `riskBoundaries.controlledHomeAuthorityTransition`, `owners.userPermissions`; Web reserve → stock Create → Plugin bind → policy writes → Home proof. Exact route contract remains unchanged.

Identity, permission, and security scope: `VERIFIED_FROM_SOURCE` the reserved response's `migrationVerificationHeld=true` excludes concurrent migration capture; `bootstrapRequired=false` means no known ID yet. Accept only omitted or null `userId`, never a non-null ID or incorrect state/flags. Restricted library policy remains selected IDs.

DTO projection, mutation, readback, and convergence risks: `VERIFIED_FROM_SOURCE` nullable C# `UserId` is unassigned in the reserved view. `VERIFIED_FROM_USER_CAPTURE` serialized response omitted `userId`; serializer cause remains `INFERRED`. Keep uncertain POST and lost Jellyfin Create response recoverable; no success before known ID and proof.

Affected cache, lifecycle, request, image, playback, and configuration owners: Server-scoped browser creation hint and request lifecycle only. No image, playback, Plugin configuration, or deployment owner changes.

Downstream surfaces that can regress: Add User dialog, creation recovery panel, migration verification siblings, account list, Home/Featured eligibility for newly created restricted users.

Pre-code characterization/security tests: Existing tests prove `userId:null` only; add red tests for omitted `userId` leading to stock Create and non-null `userId` blocked. Verify `create-started` is written before Create.

Post-code focused, boundary, integration, and physical tests: Focused Add User/service/recovery tests; full Web and Plugin suites; TypeScript, contract, lint/version/privacy, Web and Plugin builds. Live `.125` restricted-user acceptance remains unexecuted because this task forbids account mutation and deployment.

Conflicts or UNKNOWN items: No ownership conflict found. Exact runtime serializer setting is `UNKNOWN`; captured omission is sufficient wire evidence. Current `.125` reservation remains held until authorized recovery.

Active known deviations and stabilization-backlog entries/order affected: None resolved or reordered by this Web parsing change; Stage 2 physical restricted-user acceptance stays pending.

Atlas update: required after actual diff review — session-aware continuation, library-first new-account bootstrap, and privilege-aware recovery write ordering change the lifecycle and security risk description. Updated `system-map.json` and chapter 25; the stock and Plugin authority boundaries remain unchanged.

## Task 1: Confirm the reserved wire response

**Files:** Modify `src/ptv/modules/settings/admin/users/AdminUserDialogsCreation.test.tsx`, `src/ptv/modules/settings/admin/users/adminNewUserBootstrapService.test.ts`, `src/ptv/modules/settings/admin/users/adminNewUserBootstrapService.ts`, `src/ptv/core/pluginApi.ts`.

- [x] Change a positive test fixture to the captured reserve body with omitted `userId`; assert stock Create once, `create-started` before Create, bind and restrictive policy proof afterward. Run it and observe failure at the reservation guard.
- [x] Add a service boundary test that rejects a reserved response with a non-null `userId`.
- [x] Type the reserved `userId` as optional null and accept null or undefined in the Web guard, preserving every other strict confirmation condition.
- [x] Run focused tests to green and confirm recovery/duplicate protections remain green.

## Task 2: Report transaction phases and actionable failures

**Files:** Modify `src/ptv/modules/settings/admin/users/AdminUserDialogs.tsx`, `src/ptv/modules/settings/admin/users/adminNewUserBootstrapService.ts`, `src/ptv/modules/settings/admin/users/AdminUserDialogsCreation.test.tsx`.

- [x] Add red dialog tests for a pending phase during reservation/Create/policy/Home proof and a visible recovery message at the failing phase, using deferred external operations.
- [x] Set a single dialog phase at each authoritative boundary; emit policy/Home progress from the existing bootstrap owner. Keep confirmed vs uncertain reservation errors distinct and retain hints.
- [x] Run focused tests to green; check selected-folder IDs remain exact and duplicate submission remains blocked.

## Task 3: Protect account and session changes during creation

**Files:** `AdminUserDialogs.tsx`, `PtvAdminUsersPage.tsx`, `adminNewUserBootstrapService.ts`, and focused tests.

- [x] Reproduce server switch, same-server administrator switch, token change, unmount, and overlapping submit races with deferred requests.
- [x] Stop before stock Create when the confirmed reservation outlives the initiating context. Persist a known Jellyfin ID before stopping after an in-flight Create.
- [x] Check the live Plugin session between bootstrap mutations and suppress stale UI completion. Write selected library restrictions before role and enabled-state policy.
- [x] Keep Plugin holds and browser hints for deliberate recovery after an interrupted bootstrap.

## Task 4: Validate and checkpoint

**Files:** Web version source, report under `C:\Users\Piggie\Documents\GitHub\_PTV-Artifacts\Reports`; update this plan's checkboxes as work completes.

- [x] Bump Web version exactly once, then run the required Web/Plugin focused and full gates and builds from approved source.
- [x] Review actual diff, secret scan, Atlas disposition, and source/build provenance. Record remaining live `.125` acceptance and safe reservation recovery implications.
- [x] Commit locally on the existing integration branch without push; verify clean status and report commit/hash/test counts.
