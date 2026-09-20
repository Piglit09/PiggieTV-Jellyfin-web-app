# PTV 0.5.60 Provenance Correction And Fresh Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the abbreviated Web commit identity, build a completely fresh PTV Web 0.5.60 / Plugin 0.5.19.0 candidate, prove the full source commit offline, and perform one controlled VM115 acceptance attempt.

**Architecture:** Keep `scripts/ptv-build-provenance.cjs` as the sole Git-to-Webpack identity resolver and retain the existing `webpack.common.js` → `__COMMIT_SHA__` → `buildInfo` runtime path. Correct only the resolver's default Git command, cover it with a real-behavior regression, then reuse the accepted immutable-artifact and one-attempt deployment/rollback procedure with new `r2` artifact names.

**Tech Stack:** Node.js built-in test runner, Webpack 5, TypeScript/React, .NET 9 Plugin build, PowerShell, SSH/QEMU Guest Agent, Jellyfin 12.0.0.

**Spec:** `C:/Users/Piggie/Desktop/PTV2.txt`

## Global Constraints

- Production remains Web `0.5.59` / Plugin `0.5.18.0` until the fresh candidate passes every offline gate.
- Rejected `r1` archives, manifests, selector, and VM payloads are evidence only and must never be reused.
- Keep release versions at Web `0.5.60` and Plugin `0.5.19.0`; do not bump again for the rejected pre-acceptance artifact.
- Do not redesign or reimplement Music, Metadata Quality, or Mobile Libraries.
- Do not weaken the full-commit acceptance check.
- No production retry: one candidate stop/start; on any hard failure, one rollback stop/start and stop.
- Do not modify media, Jellyfin databases manually, public routing, libraries, mount configuration, Jellyfin/FFmpeg packages, or SEC-01.
- Do not run a broad library scan.
- Use the exact access, dead-man, backup, staging, activation, rollback, and retirement controls in `docs/superpowers/plans/2026-09-20-ptv-stabilization-release-validation.md`, carrying forward its recorded Task 6 and Task 7 rulings.

## Review Focus

- A clean Git checkout must emit all 40 hexadecimal characters of `HEAD`, not an abbreviated prefix.
- A validated `PTV_COMMIT_SHA` override must retain its existing supported format; the release gate independently requires the exact clean 40-character `HEAD`.
- The production bundle, archive, manifest, and runtime diagnostics must all report one identical source identity.
- Fresh `r2` artifacts must be byte-derived from the final clean repository `HEAD`; no tracked commit may occur afterward.
- A failed activation must not trigger a candidate retry or leave temporary root access/restart guards installed.

## Atlas Impact Record

```text
ATLAS IMPACT RECORD
Scope: Correct PTV Web build provenance from an abbreviated clean Git SHA to the complete clean Git SHA; rebuild and deploy a fresh release candidate.
Baseline (repository / branch / HEAD / product version / dirty paths): Jellyfin-Web-PiggieTV linked worktree / release/ptv-web-0.5.60 / e7cd02d460217fb82198e496a3e1726933e71b47 / Web 0.5.60, Plugin 0.5.19.0 / clean.
Stock authoritative owner and contract: Webpack owns one coherent emitted asset generation; stock build-time Git provenance and fixed entry/content-hashed chunk rules are documented in Atlas chapter 18.
Current PTV owner(s) and modification class: scripts/ptv-build-provenance.cjs resolves Git identity; webpack.common.js injects it; buildInfo/runtime diagnostics observe it. STOCK_EXTENDED / HIGH build-provenance boundary.
Affected map nodes, edges, mutations, routes, and risk boundaries: systems.buildServiceWorkerAssets; owners.builtAssetGeneration; riskBoundaries.mixedAssetGeneration; no API route or data mutation.
Identity, permission, and security scope: Build-generation identity only. No user/server/token/authorization change; SEC-01 remains unchanged.
DTO projection, mutation, readback, and convergence risks: None.
Affected cache, lifecycle, request, image, playback, and configuration owners: Asset/chunk and browser generation identity only; no request, image, playback, database, media, or Jellyfin configuration owner changes.
Downstream surfaces that can regress: console/runtime build diagnostics, chunk-version suffix, Dashboard build information, artifact manifest comparison, deployment acceptance, old/new browser asset generation.
Pre-code characterization/security tests: prove HEAD is 40 characters; resolver returns only the 12-character prefix; rejected bundle contains that prefix and not full HEAD; r1 manifest contains full HEAD; production remains untouched.
Post-code focused, boundary, integration, and physical tests: Node provenance RED→GREEN; buildInfo/version checks; complete Web/Plugin gates; clean production build; full-SHA scan of dist and r2 archive; manifest/tree/hash verification; one controlled production activation; public authenticated Home/Movies/Shows; bounded Music, Metadata Quality, and mobile checks; rollback proof on failure.
Conflicts or UNKNOWN items: Reverse-proxy/browser cache behavior remains runtime-verified rather than source-guaranteed. The rejected candidate identity is e7cd02d..., while the fresh candidate identity must be the final post-fix clean HEAD.
Active known deviations and stabilization-backlog entries/order affected: No closure is inferred from this build-tool fix. Existing backlog order is preserved; the already-approved bounded reconciliation document is completed before artifact freeze so provenance remains exact.
Atlas update: not required — the authoritative resolver, owner graph, public contract, and deployment topology are unchanged; only the resolver stops abbreviating its existing Git identity.
```

---

### Task 1: Regression And Minimal Provenance Fix

**Files:**

- Modify: `scripts/ptv-build-provenance.test.cjs`
- Modify: `scripts/ptv-build-provenance.cjs`
- Modify: `package.json`

**Interfaces:**

- Consumes: clean repository `HEAD` and optional `PTV_COMMIT_SHA`.
- Produces: `resolvePtvCommitSha(options): string`, passed unchanged to Webpack's `__COMMIT_SHA__` definition.

- [ ] **Step 1: Write the failing regression**

Update the Git stub so `git rev-parse --short=12 HEAD` realistically returns the first 12 characters of a literal 40-character SHA. Change the clean-checkout test to require the complete literal SHA and the exact Git arguments `[ 'rev-parse', 'HEAD' ]`. Retain dirty-suffix and override coverage with complete literal identities. Add `test:ptv-provenance` to `package.json` as `node --test scripts/ptv-build-provenance.test.cjs`.

- [ ] **Step 2: Run the regression and prove RED**

Run: `npm run test:ptv-provenance`

Expected: FAIL because the resolver invokes `--short=12` and returns only the 12-character prefix.

- [ ] **Step 3: Implement the minimal fix**

In `resolvePtvCommitSha`, replace `[ 'rev-parse', '--short=12', 'HEAD' ]` with `[ 'rev-parse', 'HEAD' ]`. Do not change Webpack, `buildInfo`, runtime diagnostics, override precedence, dirty detection, or the accepted override grammar.

- [ ] **Step 4: Prove GREEN and adjacent contracts**

Run:

```powershell
npm run test:ptv-provenance
npx vitest run --config vite.config.ts src/ptv/core/buildInfo.test.ts
npm run version:ptv:check
node scripts/ptv-plugin-version.cjs check
git diff --check
```

Expected: all commands exit zero; Web remains `0.5.60`, Plugin remains `0.5.19.0`.

- [ ] **Step 5: Commit the bounded correction**

```powershell
git add package.json scripts/ptv-build-provenance.cjs scripts/ptv-build-provenance.test.cjs
git commit -m "fix: embed full Web source commit"
```

### Task 2: Complete Deferred Repository Documents Before Artifact Freeze

**Files:**

- Create: `docs/diagnostics/2026-09-20-stabilization-backlog-reconciliation.md`
- Create: `docs/architecture/ptv-web-reference-client.md`

**Interfaces:**

- Consumes: the already-approved exact content contracts in Tasks 1 and 2 of `docs/superpowers/plans/2026-09-20-ptv-stabilization-release-validation.md`.
- Produces: the final tracked release `HEAD` consumed by artifact construction and provenance verification.

- [ ] Execute the exact bounded content requirements and source checks from Tasks 1 and 2 of the accepted release plan. Do not add Android TV, Android Mobile, webOS implementation, or new backlog scope.
- [ ] Verify links, exact named sections, no placeholders, `git diff --check`, and that neither document changes product/version files.
- [ ] Commit both documents before building the candidate so the immutable manifest, embedded commit, deployed Web, local branch, and later remote branch can remain identical.

### Task 3: Full Local Gate, Fresh R2 Artifacts, And Offline Acceptance Simulation

**Files:**

- Recreate locally: `dist/`, `src/ptv/plugin/bin/`
- Create without overwrite: `C:/Users/Piggie/Documents/GitHub/_PTV-Artifacts/Deployment/ptv-web-0.5.60-jf12-vm115-r2.tar.gz`
- Create without overwrite: `C:/Users/Piggie/Documents/GitHub/_PTV-Artifacts/Deployment/PiggieTV.Plugin_0.5.19.0-r2.zip`
- Create without overwrite: `C:/Users/Piggie/Documents/GitHub/_PTV-Artifacts/Deployment/ptv-0.5.60-0.5.19.0-r2-manifest.json`
- Create without overwrite: `C:/Users/Piggie/Documents/GitHub/_PTV-Artifacts/Deployment/ptv-0.5.60-0.5.19.0-r2.sha256`
- Create without overwrite: `C:/Users/Piggie/Documents/GitHub/_PTV-Artifacts/Deployment/ptv-recovery-web-0.5.60-jf12-vm115-r2.env`

**Interfaces:**

- Consumes: final clean source `HEAD`, Web `0.5.60`, Plugin `0.5.19.0`.
- Produces: complete immutable `r2` candidate and hashes; selector points to `/opt/ptv-web-0.5.60-jf12-vm115-r2`.

- [ ] Run the exact Task 4 local release matrix from the accepted release plan, adding `npm run test:ptv-provenance` before the production Web build. Require focused Music, focused Metadata, mobile browser, full Web, full Plugin, Plugin contract, TypeScript, lint/style baselines, versions, E2E, production Web build, Plugin Release publish, secret scan, and clean tracked tree.
- [ ] Record the final 40-character clean `HEAD`; require the production `dist` JavaScript to contain that exact identity and `getPtvBuildInfo` to consume the same `__COMMIT_SHA__` path.
- [ ] Reuse the canonical Task 5 tree-summary/archive-safety/hash program with only the five `r2` names above and the `r2` Web selector target changed. Rebuild the Plugin from source; do not copy the rejected ZIP or payload.
- [ ] Independently scan the compressed Web archive for the exact full manifest commit and simulate the production one-shot provenance comparison locally. Require the manifest commit, `git rev-parse HEAD`, bundle value, and archive value to be identical before any VM115 access is armed.
- [ ] If any offline assertion fails, stop without contacting production.

### Task 4: One Controlled VM115 Deployment And Bounded Acceptance

**Files:**

- Create on success/failure: a new non-colliding VM115 run root dedicated to the `r2` attempt.
- Preserve: prior `/var/lib/ptv-vm115-stabilization-20260920` evidence and all rejected `r1` local artifacts.

**Interfaces:**

- Consumes: verified `r2` artifacts and the accepted Task 6–11 access/deployment/rollback procedure.
- Produces on success: live Web `0.5.60`, full expected source commit, Plugin `0.5.19.0` Active/Healthy.
- Produces on failure: restored Web `0.5.59`, Plugin `0.5.18.0`, preserved failure evidence, and no retry.

- [ ] Revalidate production Web `0.5.59` / Plugin `0.5.18.0`, Jellyfin 12.0.0 identity, stable PID/NRestarts, health, rollback selector/payload, idle scan, and retained backup before mutation.
- [ ] Arm the existing persistent dead-man, install only the verified ephemeral key, and carry forward the approved active-automount canonical UUID ruling and `runuser` working-directory ruling. T7 and guest Music access checks are read-only.
- [ ] Transfer and stage only the fresh `r2` candidate. Recompute archive, tree, selector, Plugin member/version, and manifest hashes in-guest before the service stop.
- [ ] Perform exactly one candidate stop/start. Run the one-shot identity/health/version/Plugin/provenance assertion with the new manifest's full commit.
- [ ] On hard-gate failure, capture status and bounded journal, perform the accepted rollback exactly once, prove Web `0.5.59` / Plugin `0.5.18.0`, retire access, write a failure report, and stop without retry or push.
- [ ] On success, verify public authenticated Home, Movies, Shows; bounded Music artists/albums/tracks, hard refresh, navigation and one representative playback/stop; Metadata Quality empty-store bootstrap to one healthy ACTIVE generation; Mobile Libraries narrow viewport/header/card/control geometry and desktop control; SEC-01; no unexpected broad scan; no unrelated transcode after controlled playback stops.
- [ ] Always retire the key through direct cleanup plus QEMU Guest Agent proof, remove the dead-man/restart guard, and require `Restart=on-failure`.

### Task 5: Final Evidence, Exact Push, And Handoff

**Files:**

- Create: final production or rollback report under `C:/Users/Piggie/Documents/GitHub/_PTV-Artifacts/Reports/`
- Update only if already present: bounded campaign/index metadata under `C:/Users/Piggie/Documents/GitHub/_PTV-Artifacts/`

**Interfaces:**

- Consumes: immutable manifest, local clean `HEAD`, production acceptance/rollback evidence.
- Produces: the exact requested final report and, on success only, remote `release/ptv-web-0.5.60` equal to the deployed manifest commit.

- [ ] Reconcile the Atlas record against the actual diff. Update Atlas files only if the owner/contract/risk map changed; otherwise record the concrete no-update reason.
- [ ] Require `git diff --check`, Web/Plugin version and contract checks, provenance test, clean status, manifest commit equal to local `HEAD`, and public health.
- [ ] Push `release/ptv-web-0.5.60` only after full candidate acceptance; verify the remote ref equals the manifest/local/deployed source commit. Do not merge or create a pull request.
- [ ] Return every field requested by `PTV2.txt`. On success declare `PTV_0.5.60_PLUGIN_0.5.19_PRODUCTION: PASS`; on failure report rollback truth without a PASS declaration.
