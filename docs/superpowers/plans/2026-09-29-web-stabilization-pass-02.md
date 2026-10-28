# PTV Web Stabilization Pass 02 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this bounded plan. Independent leaf work may run alongside the main implementer; one integrated review follows convergence.

**Goal:** Correct update notification and the existing Web video player's transient controls, continuous-session preferences and identity, locally only.

**Architecture:** Preserve existing owners: webpack build provenance, UpdateService, the registered native video-controls visibility handler, the active HTML video element and appRouter. Extend those owners rather than adding another timeout, preference store, router or update manifest. Restore the already-styled PTV top bar and make the bottom episode label episode-only.

**Tech Stack:** Existing TypeScript/JavaScript, webpack, Vitest/jsdom and local Jellyfin 12; no new dependencies.

**Spec:** The user's September 29 “broader bounded Pass 02 scope” message. This document records its design and implementation sequence. The user explicitly authorized implementation after writing the design; no additional design-approval checkpoint applies.

## Global Constraints

- Local checkout: `C:/Users/Piggie/Documents/GitHub/Jellyfin-Web-PiggieTV-Canonical`.
- Baseline: `9345d88380ee57352131b04184d63f7fa1224300`, clean `fix/web-library-isolation` worktree.
- Web stays **0.5.61**. This explicit user instruction overrides the normal version-bump convention.
- Preserve accepted Pass 01 library isolation, cache/security guards and Home-loop behavior.
- Production contact/change, deployment, push, merge and release-candidate preparation: **NO**.
- Do not change Plugin, native applications, media, libraries or normalization.
- Do not absorb image/performance work, visual redesign or unrelated warnings.
- Browser acceptance is a separate gate after this implementation and bounded local developer smoke.

## Bounded Design / AtlasImpactRecord (before implementation)

**Consulted:** Atlas CHANGE-PROTOCOL, INDEX, build/service-worker chapter 18 and relevant ownership, extension, failure and playback contracts in chapters 20–25; repository safety and AGENTS instructions; actual owners below.

**Change classes:** STOCK_EXTENDED build/update observer; STOCK_WRAPPED video controls/identity. No PlaybackInfo, stream negotiation, queue, progress reporting or Jellyfin persistence change.

**Authorities and reproduction evidence:**

1. `updateService.ts` treats any waiting/installed worker as an update without comparing its generation. Reload clears a generic marker and announces the same waiter again. Dismissal is not candidate-bound. The unmodified standalone worker was byte-identical across two different webpack build identities. Actual source probes reproduced same-build, first-install, stale activation and reload-loop cases; the existing 14 tests still passed.
2. The existing PTV 4200ms hide timer calls the registered stock `hideOsd()`. That method hides controls but does not retire action sheets. Exact-source execution with the real action sheet reproduced a visible dialog after controls hid, plus late import/user-lookup opens after hide or player replacement. Native stock timer also pauses for any open dialog. The native view/controller remains the visibility authority.
3. Native same-element Next/autoplay retains gain/mute, but the PTV playback-start hook forces 50% on each item/session. Exact-source local execution reproduced 35% -> 50% and slider-zero -> audible on both transitions. True `muted` already survives; it must remain so. The active video element is the continuous-session preference authority; existing fresh-element initialization and audio/remote behavior remain unchanged.
4. `getOrCreatePlayerHeader()` removes all top bars and returns null. Its intended glass styles and navigation owner already exist. The actual title helper currently puts Series identity at the bottom. Local execution reproduced no top bar and `Series · S02E12 - Episode` bottom text.

**Chosen design:**

- Embed existing webpack provenance in the standalone worker and answer a bounded identity message. UpdateService compares a verified candidate with the running bundle; equal/older or first-install generations do not manufacture a notice. Bind dismissal/activation cleanup to the candidate, ignore stale/late identity results and recheck the existing activity gate before reload. Keep the stable worker URL; do not add a fetch cache, cache purge or second build manifest.
- One native-controller-local transient operation starts before asynchronous work, captures player/item/view identity and exposes one AbortSignal. Pass it through audio, primary/secondary subtitle and settings child sheets. Retire it on normal hide and existing teardown/replacement events; guard every post-await mutation and identity-safe cleanup. Reuse actionSheet's existing abort API. Active interaction defers the **existing** hide callbacks via the current visibility bridge; no new timer.
- Exempt `htmlvideoplayer` from the PTV per-start forced-volume write. Retain existing native fresh-element initialization and all non-video behavior. Test actual reused-element transitions for gain, mute and zero volume.
- Restore a singleton header in the existing chrome root, Back routed through `goBackFromPlayback()`, and the existing hide/show CSS lifecycle. Use Movie logo/title or Series logo/title for Episodes; wrong/absent/failed logos fall back to accessible text. Render `SxxExx — Episode Title` at the bottom for Episodes only. Preserve existing Movie identity rendering.

**Failure boundaries:** Late worker/menu completions cannot act on replacement generations. Hidden/teardown menus cannot change tracks/settings or resurrect UI. Back must retain stock stop/navigation behavior. No scope broadening or API recommendation changes. Full teardown remains a new video preference session. Missing identity data uses title fallback, not fabricated Movie episode data.

**Proof plan:** Test-first focused lifecycle and generation regressions, existing relevant suites, one converged full test run, typecheck, baseline lint/stylelint and a verification production-mode build outside the repository. Then bounded local episode/manual-Next/autoplay/Movie/update smoke and Pass 01 regression checks. Formal browser acceptance and production behavior remain unclaimed.

**Atlas update required:** YES — current build-generation and notification ownership wording, continuous-video state and transient-menu lifecycle. Preserve historical baseline claims and unrelated sections.

## Review Focus

- Late/out-of-order worker identity responses: never resurrect stale notices or reload unsafe activity (Task 1).
- Late menu imports, user lookup and selection after hide/replacement: no mounted dialog or mutation (Task 2).
- Submenu handoff and old cleanup: one operation remains current until the child finishes; newer operation survives (Task 2).
- Zero volume, true mute and latest user adjustment across both Next paths: preserve active element, not a default (Task 3).
- Missing/incorrect/failed logo and item transition: title fallback, correct identity, no stale header or duplicate Back handlers (Task 4).

### Task 1: Update generation

**Files:** `src/ptv/services/updateService.ts`, its test, `src/serviceworker.js`, a worker-safe generation helper/test if needed. Do not import browser-dependent config into the worker.

**Interface:** Existing UpdateService subscription/apply API remains unchanged; the worker message returns webpack-derived version/build ID/commit/date through a MessagePort.

- [ ] Add behavioral regressions for same/older/later builds, first install, reload into target, external activation, malformed/timeout/out-of-order identity, candidate-specific dismissal and all existing activity gates immediately before reload.
- [ ] Run the new tests against the old behavior and record the expected failures.
- [ ] Implement the bounded identity handshake and candidate-bound observer cleanup.
- [ ] Run update/build-provenance focused suites; prove differing worker identity changes built worker bytes without version bump.

### Task 2: Transient video menus

**Files:** `src/controllers/playback/video/index.js`, adjacent `videoTransientMenuLifecycle.ts` and tests, `src/components/playback/playersettingsmenu.js` and focused tests; narrow existing visibility/timer bridge and tests if needed.

**Interface:** Local operation `{ signal, isCurrent(), finish() }`; controller `retire()` aborts owned work. Optional settings operation preserves other callers. Existing actionSheet AbortSignal closes only the owned sheet.

- [ ] Add regressions executing real caller wiring: hide/teardown abort, held interaction deferral, late import/user/selection, operation replacement, submenu handoff and cancellation handling.
- [ ] Run new tests red before changing callers.
- [ ] Thread the operation through current callers and existing hide/replacement lifecycle; reuse existing timers.
- [ ] Run lifecycle, action-sheet abort, visibility ownership and timer suites green.

### Task 3: Continuous video preferences

**Files:** Narrow `setPlaybackStartupVolume()` hunk in `src/ptv/modules/playback/index.js` and an isolated regression test.

**Interface:** Native HTML video startup/retained-element state unchanged; PTV does not overwrite that state. Existing audio/remote start behavior unchanged.

- [ ] Add tests for autoplay/manual Next: 35%/true mute, zero volume, repeat/new item and session IDs, user change between stop/start; also full-teardown defaults and non-video behavior.
- [ ] Run red and prove the real per-start hook overwrites retained gain.
- [ ] Add the HTML video guard only; run focused preference tests green.

### Task 4: Video identity

**Files:** `src/ptv/modules/playback/playerHeader.ts` and test, header wiring in playback `index.js`; `src/controllers/playback/video/videoDisplayTitle.ts` and its test. Reuse existing `playback.scss`; change styling only if required by this contract.

**Interface:** Header factory/update receives the existing root, Back callback, correct display title and optional verified logo URL; title remains fallback. Existing native bottom title uses episode-only format.

- [ ] Add red regressions for singleton/Back, Episode-Series vs Movie identity, logo failure/text fallback, item switch/cleanup and `S02E12 — Episode Title`; Movies return no episode label.
- [ ] Implement the minimal header DOM owner and existing render/visibility wiring.
- [ ] Run identity/navigation/visibility focused suites green.

### Task 5: Converged verification and stop

- [ ] Run all affected focused suites and accepted Pass 01 scope/Home regression suites.
- [ ] Run `npm test -- --reporter=dot --maxWorkers=4`, `npm run build:check`, baseline lint/stylelint, version/provenance/secret gates and a production-mode verification build with external output.
- [ ] Complete one integrated diff review; correct only demonstrated in-scope findings with regression tests.
- [ ] Perform bounded developer smoke on existing local frontend `127.0.0.1:8085` and local Jellyfin `127.0.0.1:8097`, never production. Record gaps honestly rather than converting this into formal browser acceptance.
- [ ] Update narrow current Atlas contracts and the external report/evidence; verify version unchanged and no excluded paths touched.
- [ ] STOP with the user's exact report fields. No release, push or deployment; browser acceptance remains a separate gate.

**Self-review:** All five requested behaviors map to the tasks above. The update and player leaf work do not share implementation ownership. No new safety authority or unrelated qualification infrastructure is introduced.

## Post-change implementation checkpoint

- Update generation, transient-menu lifetime, continuous-video preferences, and player identity were implemented within the owners above. Red regressions preceded their corresponding fixes; the converged integrated review has no open findings.
- Focused affected suites passed (173 tests). Full local suite: 454 files / 3,969 tests passed. Typecheck, version/provenance and secret gates passed. Baseline lint passed without increased findings (185 existing errors, 20 warnings); stylelint had zero findings. The production-mode verification build compiled with two existing size warnings and wrote only to the external verification directory, not to a release or deployment path.
- Local developer smoke on `127.0.0.1:8085` backed by `127.0.0.1:8097`: Movie playback advanced and displayed Back + Movie identity; Episode playback advanced and displayed Series identity above `S01E01 — Episode 1` below. Manual Next preserved 35% volume and mute into Episodes 2/3. Near-end autoplay advanced Episode 1 to Episode 2 with 37% volume and mute preserved. The agent-owned test player was stopped after each check. Genuine worker build transitions are covered by offline regression tests; no production update notification was induced locally.
- Accepted Pass 01 library isolation/Home-loop tests remain green in the full suite. Web version remains 0.5.61; no Plugin, production, media, library, normalization, release, push or deployment change. Formal browser acceptance remains a separate gate.
