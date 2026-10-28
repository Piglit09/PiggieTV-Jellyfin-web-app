# Cloud Origin Push Destinations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject a cloud development checkout when any effective origin push destination differs from the already approved GitHub repository, and reconcile the Atlas with the existing cloud exception.

**Architecture:** Extend the existing cloud-only `validateCloudDevelopment` owner to inspect the complete effective push URL set returned by Git. Keep the shared origin/provenance contract, pinned authority, Windows behavior, genuine CI path, and deployment gates unchanged. Document this enforcement and its limits in the existing governance owner and build chapter.

**Tech Stack:** Node.js ESM, `node:test`, Git, Bash, Markdown, JSON.

**Spec:** Authorized task recorded here: validate every effective origin push destination; add real disposable-repository regressions; update the missing architecture documentation; hold all publication pending Cloudflare disconnection confirmation. The user approved this follow-up after #57 and #58 merged.

## Global Constraints

- Approved checkout: `/workspace/PiggieTV-Jellyfin-web-app`; standalone common directory: `/workspace/PiggieTV-Jellyfin-web-app/.git`.
- Approved origin: `https://github.com/Piglit09/PiggieTV-Jellyfin-web-app.git`, with the existing optional `.git` normalization only.
- Cloud branches: `codex/bugfix/<topic>` descending from `db38180035a9e413510414bd8b75940806952b7f`; permitted modes: `edit`, `build`.
- No policy expansion, shared fetch/provenance changes, package, deployment, server access, remote configuration changes, push, PR, merge, release, or Cloudflare setting changes.
- Preserve local Plugin portability commit `46f9c72b10420a86768723dfd10453dbcffd3580` on its original branch.
- Tooling/docs only: Web remains `0.5.82`, Plugin remains `0.5.25.0`; no version bump.

## PRE-CODE ATLAS IMPACT RECORD

- **Scope:** Cloud-only origin push routing validation, focused guard fixtures, and reconciliation of the already approved source/build exception. No shipped Web or Plugin runtime change.
- **Baseline (repository / branch / HEAD / product version / dirty paths):** `/workspace/PiggieTV-Jellyfin-web-app`; `codex/bugfix/cloud-origin-destinations`; full HEAD `8ac3dcc713cde18e94114022beede6ad820a57ce`; Web `0.5.82`; Plugin `0.5.25.0`; clean staged/unstaged/untracked baseline before this plan. Root verified the resolved source root/common directory and approved fetch/push origin. The unchanged `edit` and `build` preflights passed in the actual Linux cloud checkout before edits, with authority `cloud-development`.
- **Stock authoritative owner and contract:** Git owns effective remote routing and URL rewrite interpretation; query `git remote get-url --push --all origin` rather than reconstructing configuration. Jellyfin Web/Server stock 10.11.11 build, API, authentication, and runtime contracts remain unchanged. Chapter 18 identifies stock webpack/service-worker authority; chapter 24 confirms server API authorization is a separate owner.
- **Current PTV owner(s) and modification class:** `scripts/ptv-workspace-preflight.mjs` `validateCloudDevelopment` and pinned `cloudDevelopment` authority; `owners.buildArtifactAndDeploymentGovernance`; `NEW_PTV_SYSTEM` for PTV workspace governance. Extend this owner; do not introduce another authority or change `identity.remote` shared consumers.
- **Affected map nodes, edges, mutations, routes, and risk boundaries:** Governance owner and its chapter 18/23 references; build provenance and supported edit/build entrypoints depend on successful source validation. Affected boundary is approved cloud source identity to effective Git push destinations. No Jellyfin route, API mutation, asset generation, service-worker, or deployment edge changes.
- **Identity, permission, and security scope:** Retain exact Linux root, standalone Git/common directory, origin identity, named bugfix branch, full source commit, and pinned ancestry. Require a nonempty complete effective push set whose every member matches the existing approved remote; preserve rejection of other repositories, credentials/SSH schemes, and Git rewrite destinations. Cloud package/deployment denial remains ahead of CI handling. Guard code and policy are task-writable and are not independently protected credentials; GitHub permissions and human review remain separate boundaries.
- **DTO projection, mutation, readback, and convergence risks:** Not applicable to this tooling change. No DTO adoption, server mutation, readback, metadata, or authorization response changes; no HTTP success or local fixture result is promoted to hosted convergence.
- **Affected cache, lifecycle, request, image, playback, and configuration owners:** Only Git remote configuration is read. No configuration mutation or Web/Plugin request, cache, image, playback, session, or async lifecycle owner changes.
- **Downstream surfaces that can regress:** Cloud `edit`/`build` can accidentally accept additional push destinations or reject valid fallback/optional-suffix configurations. Shared Windows/source provenance and genuine CI behavior must remain unchanged; package/deploy remain denied at the cloud root.
- **Pre-code characterization/security tests:** Run existing guard suite as baseline. Add failing disposable-Git fixtures for approved-first/foreign-second push URLs in both allowed modes, explicit empty destinations, reversed order, fetch-as-push fallback, approved multiple URLs/optional suffix, and effective `pushInsteadOf`/`insteadOf` rewrites. Fixtures must not modify the real checkout's remote configuration or contact remotes.
- **Post-code focused, boundary, integration, and physical tests:** Run focused new cases, complete workspace guard suite and relevant existing development/ACL guard regressions; classify inherited Linux-only fixture failures separately. Re-run actual Linux `audit`, `edit`, and `build` preflights; use only non-executing preflight modes to verify cloud package/deploy denials and the CI-ref prohibition. Check JSON parsing, Bash syntax and fail-closed routing cases, whitespace, unchanged versions and final diff. No product build, hosted publication, Jellyfin contact, physical/device acceptance, or deployment is necessary or authorized for this tooling correction.
- **Conflicts or UNKNOWN items:** The existing governance Atlas omits the already approved cloud exception; this work reconciles it without expanding authority. No unresolved intended authority. Cloudflare connection/disconnection state remains UNKNOWN, so publication is HOLD. Independent cloud identity and physical acceptance are unverified; do not infer them from repository scripts or preflights.
- **Active known deviations and stabilization-backlog entries/order affected:** None. Preserve existing product/runtime deviation statuses and backlog ordering; this correction does not close hosted or physical acceptance gates.
- **Atlas update: required — reason and targets:** Record the cloud identity/scope, trust limits, and required proof in chapter 18 and `owners.buildArtifactAndDeploymentGovernance` in `system-map.json`; update the operations procedure with complete effective push-set checks and merged integration bootstrap. Preserve historical Phase 6 evidence and distinguish actual Linux preflight observations from Windows fixtures that simulate Linux.

## Review Focus

- An approved first push URL must not hide a later foreign or empty destination; test both allowed modes.
- Git rewrites must be assessed through effective URLs; test `pushInsteadOf` and `insteadOf` without remote access.
- Missing explicit push URLs use origin fetch URLs as push fallback; test the complete fallback set.
- Existing approved URLs with and without `.git` must remain valid, including multiple approved entries.
- Documentation must not claim all-fetch runtime enforcement, independent cloud credentials, release permission, or physical acceptance.

### Task 1: Correct the existing cloud push routing gate

**Files:** Modify `scripts/ptv-workspace-preflight.mjs`; test `scripts/ptv-workspace-preflight.test.mjs`.

**Interface:** Preserve `validateCloudDevelopment(identity, cloud)` and all callers; consume Git's complete effective push URL output and the existing `sameRemote` normalization.

- [x] Add real Git fixture regressions covering the Review Focus routing cases; run them against unchanged code and record the expected failures.
- [x] Query `git remote get-url --push --all origin`; reject an empty set or any member that fails the existing approved-remote comparison. Keep this change inside cloud validation.
- [x] Run focused and existing guard tests; record exact results and any independently established inherited failures.

### Task 2: Reconcile cloud governance documentation

**Files:** Modify chapter 18, `docs/architecture/jellyfin-reference/system-map.json`, and `docs/operations/ptv-cloud-development.md`; maintain this plan as evidence.

**Interface:** Document the final Task 1 contract under the existing governance owner, using the current pinned values and existing evidence vocabulary.

- [x] Add cloud scope, identity, package/deploy/CI restrictions, task-writable trust limits and required proof to chapter 18 and the map owner; preserve historical evidence.
- [x] Replace obsolete support-draft bootstrap instructions with reviewed integration-commit setup; make the Bash snippet fail closed and validate every effective push URL, including Git rewrites and fallback.
- [x] Parse the JSON, check Bash syntax/routing cases and whitespace, review the combined diff against this impact record, and record actual Linux preflight results separately from simulations.
- [x] Hand off the local diff for review with publication HOLD and unchanged Web/Plugin versions. The local checkpoint commit is authorized and root-owned; publication remains pending Cloudflare disconnection confirmation.

## Implementation evidence

- Documentation checks: `system-map.json` parsed successfully; the original Phase 6 `localEvidence` object remained byte-for-value unchanged; all relative file links in the three changed Markdown files resolved; owned-path `git diff --check` passed.
- The operations Bash snippet passed `bash -n` and ten mocked command cases: approved single/multiple URLs, foreign push first/second, empty final push line, empty output, foreign extra fetch URL, failed push query, failed status query, and missing reviewed commit. Every rejection stopped before the mocked branch switch. No real Git mutation, network request, or remote configuration change occurred in these document checks.
- Actual Linux, Node 24.19.0: the focused characterization run passed 7 and failed 12 with the original guard, then passed all 19 after the correction. Eighteen new real disposable-repository cases exercise multiple destinations, empty/malformed raw entries, fallback, and effective rewrites. A positive `pushInsteadOf` subset case preserves Git's routing semantics rather than assuming one effective destination per configured URL. Git itself rejects LF in rewrite subsection names and valueless push URLs; those exploratory setup rejections were not classified as product failures.
- Combined workspace/development/operator guard suites: 66 passed, 3 failed, 0 skipped out of 69. All three failures reproduce on the unchanged baseline: `CI exact ref exception requires clean source and matching GitHub Actions identity` assumes the default host is not Linux; `standing development permission returns only the protected .125 target` and `standing development denies a mismatched source, duplicate project, or wrong target folder` compare host-resolved `webTargetPath` with the pinned Windows path. No assertion was weakened or removed. Logs: `/tmp/ptv-origin-guard-baseline.log`, `/tmp/ptv-origin-related-baseline.log`, `/tmp/ptv-origin-guard-red.log`, `/tmp/ptv-origin-guard-green.log`, `/tmp/ptv-origin-guards-final.log`.
- Updated actual-checkout `edit` and `build` preflights passed with `cloud-development` authority. Non-executing cloud `package`, `deploy`, `deploy-development`, and `build --ci-ref` preflights denied as required. No package or deployment operation was invoked. An independent reviewer reran actual Linux `edit`/`build` and found no must-fix issue in the combined diff.
- Passed: 34 artifact/provenance/Plugin-package unit fixtures; TypeScript `tsc --noEmit`; Core/Channels schemas and compatibility fixtures; frontend/Plugin contract check; Web version check; targeted ESLint (0 errors, 0 warnings); Node syntax; map JSON parsing; changed Markdown relative file links; Bash syntax; whitespace. Existing Phase 6 evidence, other map owners/sections, policy, and Web/Plugin versions are unchanged.
- Repository ESLint baseline check passed: 187 errors and 20 warnings across 19 files, with no increase beyond the recorded per-file baseline. Changed guard files separately passed targeted ESLint with zero errors or warnings. Evidence: `/tmp/ptv-origin-lint.log` and `/tmp/ptv-origin-targeted-eslint.json`.
- Actual Windows execution, hosted CI, rendered browser checks, full Web/Plugin product suites, production compilation and physical/device acceptance were not run for this tooling/docs-only correction. No shipped product files changed. Temporary logs are local evidence, not durable release artifacts.
- Actual-diff Atlas reconciliation is complete for the existing governance owner, chapter 18 and operations procedure; no product deviation status or stabilization-backlog order changed. The source checkpoint's final commit identity is reported at handoff. Local Plugin fix `46f9c72b10420a86768723dfd10453dbcffd3580` remains on its separate branch. Publication remains HOLD; no push, PR, merge, release, Cloudflare setting change, or live-server contact occurred.
