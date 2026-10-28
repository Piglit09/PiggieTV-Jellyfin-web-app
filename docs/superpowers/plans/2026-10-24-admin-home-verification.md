# Admin Home Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the `.125` administrator's ability to review and confirm exact Home access while making reservation and creation failures visible and recoverable.

**Architecture:** Keep Jellyfin as the owner of accounts and policy, and the Plugin as the owner of durable Home proof. Normalize the Plugin's current-policy response once in the Web API client for every administration consumer, show request state beside the selected candidate, and refresh sibling administration panels after a confirmed creation recovery. Repeated identical batch verification must return the existing Plugin proof so an uncertain response can be reconciled without replacing durable evidence. Preserve the existing fail-closed verification and bootstrap sequence.

**Tech Stack:** React, TypeScript, Vitest/Testing Library, Jellyfin Plugin API, .NET tests.

**Spec:** The user request in this task, dated 2026-10-24; this plan records its scope and acceptance below.

## Global Constraints

- Local source fixes only. Do not deploy, restart Jellyfin, contact production `.50`, or mutate `.125` accounts, permissions, media, or Plugin records.
- Preserve existing accounts, library restrictions, reservations, batch cohort, and verification records.
- The first batch remains a fixed existing-user cohort; verification requires an administrator's explicit confirmation of current policy and Plugin readback.
- A new account remains unverified until its intended policy, binding, and Plugin proof complete. Do not infer success from stock Create acknowledgment alone.
- Exactly one PTV Web version bump and, if the Plugin idempotence change lands, exactly one Plugin version bump for this logical request.

## Atlas Impact Record

ATLAS IMPACT RECORD

Scope: Web administration review, error feedback, reservation recovery refresh, and restricted new-account bootstrap safeguards.
Baseline (repository / branch / HEAD / product version / dirty paths): Jellyfin-Web-PiggieTV / integration/responsive-playback-jf122-stage4 / 3ed4bb60b7f266f6b431e37c186c699b7c333483 / Web 0.5.78, Plugin 0.5.24.0 / clean; preflight `edit` passed.
Stock authoritative owner and contract: Jellyfin UserManager owns account creation, policy, folder preferences, and user-aware visibility (`04`, `15`, `24`); HTTP success alone is not durable cross-owner convergence (`25`). VERIFIED_FROM_SOURCE.
Current PTV owner(s) and modification class: Web `PtvAdminUserVerification`, `PtvAdminCreationRecovery`, `AddAdminUserDialog`, and Plugin API client; Plugin `PtvHomeUserAccessController`/ledger retain Home proof. Web boundary and interaction repair plus Plugin ledger idempotence for an identical repeated batch verification; no owner or route change. VERIFIED_FROM_SOURCE.
Affected map nodes, edges, mutations, routes, and risk boundaries: `systems.permissionsAndLibraryAccess`, `systems.settingsAndAdmin`, `systems.home`; `components.jellyfinAuthorization`, `components.ptvPlugin`; `owners.authenticatedPrincipal`, `owners.userPermissions`; `mutations.controlledExistingUserAccess`, `mutations.newUserBootstrapAndMigration`; `apiContracts.ptvV1.homeUserAccess`; `ptvOverrides.controlledHomeAuthorityTransitions`; `riskBoundaries.controlledHomeAuthorityTransition`, `riskBoundaries.serverAuthorizationVsWebVisibility`; settings/admin and permissions-to-Home edges. `GET /Ptv/v1/home-user-access/current`, verification batch/summary/verify, creations/current/reserve/recover/bind.
Identity, permission, and security scope: Administrator-only Plugin routes; exact candidate ID and batch ID; never treat Web display as authorization or fabricate broader intended policy. VERIFIED_FROM_SOURCE.
DTO projection, mutation, readback, and convergence risks: Outer `currentAccess` is named in JSON; nested policy model has unannotated PascalCase members while Web expects camelCase (INFERRED wire mismatch, to prove by test/transport observation). Preserve all exact policy fields, including retained folder preferences with `EnableAllFolders`; preserve confirmed mutation result if follow-up GET fails. An uncertain verify POST must not silently issue a duplicate write; repeated identical requests should return existing Plugin proof only after the same batch, topology, user, policy and library checks. UNKNOWN: actual HTTP status/body from the reproduced `.125` click.
Additional terminal creation-state read: a missing operation in `creations/current` may have been bound or recovered by another administrator. A browser hint may clear after an administrator-only Plugin read of that operation ID reports `bound` or `recovered`. `absent` clears only a `prepared` hint, because stock Create has not begun at that stage; `create-started` and legacy hints remain held. `reserved` stays held. This adds a read-only operation-status route to the existing Plugin authority. A corrupt or unavailable ledger must fail closed, never report `absent`.
The persisted verification record also needs its originating batch ID: a replacement batch at the same topology must create new proof, while an exact replay within the same batch may preserve the original epoch. Existing records without a stored batch ID remain valid for reads but cannot claim exact replay. After an uncertain bind/recovery POST, a fresh pending-list read that shows an operation left pending refreshes the sibling verification summary without asserting which terminal state occurred.
Affected cache, lifecycle, request, image, playback, and configuration owners: Current-policy and summary GETs bypass Plugin response cache; local React request state and sibling refresh change. No image, playback, or Plugin configuration owner changes.
Downstream surfaces that can regress: Existing-user Home verification, Add User and recovery dialogs, fixed cohort, restricted account bootstrap, Featured/Home gating.
Pre-code characterization/security tests: Failing Web test for PascalCase nested current policy and exact verify payload; failing visible pending/error test; failing recovery/readback and reservation ambiguity tests; retained malformed-policy rejection; failing Plugin replay test proving the current code replaces the epoch.
Post-code focused, boundary, integration, and physical tests: Focused Vitest, full PTV and repository Vitest, TypeScript, ESLint, Plugin Home access tests, production build, Web and Plugin version checks. Local rendered behavior where feasible; deployed `.125` physical acceptance remains unrun because deployment is prohibited.
Conflicts or UNKNOWN items: No authority conflict identified. Actual `.125` current-response body is UNKNOWN; local state shows valid one-user batch and no pending reservation. A successful GET rejected by Web is the leading INFERRED cause, not yet a captured wire fact.
Active known deviations and stabilization-backlog entries/order affected: No closure or reordering; restricted-user physical acceptance and Stage 2/release gates stay open.
Atlas update: required if the Plugin idempotence change lands, because retry behavior and required proof for the durable verification mutation change. Update the relevant Home user-access contract/risk description in chapter 20 or 23 and `system-map.json`; recheck final diff.

## Review Focus

- A valid PascalCase nested Plugin policy opens review and preserves the exact intended-access values sent to verify.
- A request rejection shows a row-local error and leaves confirmation unavailable.
- A broad policy with saved folder preferences remains reviewable without silently deleting those preferences.
- A confirmed recovery remains confirmed if the following status read fails; the administrator can retry the read without repeating the mutation.
- A failed or uncertain reservation never starts stock account creation, and a restricted new account is never verified using broad access.
- A local creation hint whose operation is missing from pending can be reconciled against a read-only terminal status; another administrator's bind or recovery must not permanently block this browser.
- A pending creation reservation holds an existing batch's Review and Verify actions.
- A confirmed verification remains confirmed after a failed status read; an uncertain verify response does not invite an unexamined repeat mutation.
- An identical repeated Plugin batch verification returns the existing proof and epoch only after all authoritative preconditions still hold.

## Tasks

### Task 1: Review current policy at the Web boundary

**Files:** `src/ptv/core/pluginApi.ts`, `src/ptv/core/pluginApiHomeUserAccess.test.ts`, `src/ptv/modules/settings/admin/users/PtvAdminUserVerification.tsx`, `src/ptv/modules/settings/admin/users/AdminUsersUi.test.tsx`.

**Interfaces:** `getCurrentHomeUserAccess(userId)` returns the existing `HomeUserAccessResponse` with complete camelCase `currentAccess`, `expectedAccess`, and `intendedAccess` definitions even when the Plugin wire uses PascalCase. `verifyHomeUserVerificationBatchCandidate(batchId, userId, request)` receives the exact normalized current readback as `intendedAccess`.

- [ ] Add a failing API-client case for a PascalCase nested policy, proving the current-policy GET targets the selected user ID on the active server and returns complete normalized access.
- [ ] Add failing UI cases for retained broad-policy folder preferences, visible loading/error next to Review access, and malformed policy remaining blocked.
- [ ] Run focused tests and capture the expected red failures.
- [ ] Implement strict central boundary normalization and row-local status/error; use safe status-specific wording without exposing arbitrary server bodies.
- [ ] Run focused tests and confirm green.

### Task 2: Coordinate reservation recovery with verification

**Files:** `src/ptv/modules/settings/admin/users/PtvAdminCreationRecovery.tsx`, `PtvAdminUsersPage.tsx`, `PtvAdminUserVerification.tsx`, `AdminUsersUi.test.tsx`.

**Interfaces:** A confirmed recovery/bind calls a parent `onChanged` callback; the parent refreshes users and increments a verification refresh revision. Verification refetches summary/current batch on that revision. Mutation confirmation and subsequent GET failure have separate messages.

- [ ] Add failing UI cases for a settled zero-ID reservation, the sibling verification refresh, and a refresh failure after confirmed recovery.
- [ ] Run focused tests and capture red failures.
- [ ] Implement the callback/refetch and preserve confirmed mutation results; gate batch start when the summary reports pending reservations.
- [ ] Run focused tests and confirm green.

### Task 3: Keep Add User safe under reserve uncertainty

**Files:** `src/ptv/modules/settings/admin/users/AdminUserDialogs.tsx`, `AdminUsersUi.test.tsx`, and the existing new-account bootstrap service tests if needed.

**Interfaces:** `reserveNewAdminUserCreation` must succeed before stock `createAdminUser`; a rejected reserve has uncertain server outcome and retains the same operation hint until authoritative readback. No retry may create a second account automatically.

- [ ] Add failing UI cases for reserve rejection with no stock Create and a restricted-library creation path that sends the exact selected policy to bootstrap.
- [ ] Run focused tests and capture red failures.
- [ ] Implement accurate reservation-status wording and reconciliation without weakening the blocked-create boundary.
- [ ] Run focused tests and confirm green.

### Task 4: Keep verification proof stable under an uncertain response

**Files:** `PtvAdminUserVerification.tsx`, `AdminUsersUi.test.tsx`, `src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Services/PtvHomeUserAccessLedger.cs`, and focused Plugin ledger tests.

- [ ] Add failing Web tests for an existing batch held by a pending reservation, confirmed verify POST followed by failed status read, and an uncertain POST response.
- [ ] Add a failing Plugin test showing that an identical repeated verification currently replaces the durable proof epoch.
- [ ] Gate Review and Verify during a reservation, separate verification confirmation from status refresh, and require fresh authoritative readback before retry after uncertainty.
- [ ] Make an identical verified Plugin request idempotent while preserving all current policy, cohort, topology, library, and reservation checks.
- [ ] Run focused Web and Plugin tests and confirm green.

### Task 5: Release gates and handoff

- [ ] Reconcile actual source diff against the Atlas record, then update Atlas only if the architecture/contract changed.
- [ ] Verify the existing single Web bump and bump Plugin once if its code changed; run both version checks.
- [ ] Run TypeScript, focused/full Web tests, applicable Plugin tests, lint, and production build after `ptv-workspace-preflight.mjs build`.
- [ ] Verify final source root, remote, branch, HEAD/status, versions, changed paths, and artifacts. Record that `.125` physical acceptance was not run because the user prohibited deployment.

## Final reconciliation, 2026-10-24

The actual diff adds the read-only creation-operation status route, persisted verification batch identity, staged local creation hints, sibling-panel refresh, row-local review feedback, and strict current-policy normalization. The later `Check verification` action now only reads Plugin status; a policy write requires the account review path. The recovery panel retains Plugin-marked account IDs as review links after both direct and cross-administrator recovery. Atlas chapters 20 and 23 plus `system-map.json` were updated for these contracts. Jellyfin remains the account and library-policy owner; the Plugin remains the durable Home-proof owner.

The whole-diff review found three additional recovery gaps before freezing the source candidate. Administrator current readback now reports the proof's nullable `verificationBatchId`; uncertain Web verification accepts proof only from the same active batch. The Plugin's batch progress counts only that batch's proofs, while its global summary still counts all valid proofs. When the batch changes or becomes stale, the Web shows the earlier outcome and permits current-batch review. A locally `prepared` creation hint with no readable Plugin operation can explicitly retry reservation with the same operation ID, without starting stock Create or clearing the hold. Focused red/green regressions cover these cases.

Focused Web tests, the complete Web suite, TypeScript, targeted lint, Plugin tests, contract/version checks, and the local production build passed. Physical `.125` acceptance remains unrun under the user's no-deploy and no-restart boundary. No `.50` request was made. The live `.125` HTTP response body for the original Review click remains unknown; the nested casing mismatch is supported by source and regression tests, while the exact live failure cannot be confirmed until a permitted test install.
