# Details theme route ownership — Issue 53

> **For agentic workers:** Execute this approved task with the existing debugging/TDD workflow. Do not commit or publish before independent review and final verification.

**Goal:** Stop automatically started Details themes after Home navigation while preserving intentional playback and queues.

**Architecture:** Keep automatic theme lifecycle in `themeMediaPlayer`, route presentation in `NativeHome`/`Page`, and playback/request/queue arbitration in `PlaybackManager`. Start with the incorrect Home theme-support opt-in; extend established owners only when failing preservation tests demonstrate a necessary boundary correction.

**Tech stack:** Existing JavaScript/TypeScript, React 18, Vitest/jsdom and Playwright; locked npm dependencies.

**Spec:** GitHub Issue #53 and the operator-approved cloud implementation task. No new feature, authority change, package, deployment, merge, server access, account/media mutation or credentials change.

## Atlas impact record — completed before product edits

- **Scope:** Issue #53 automatic Details theme retirement and necessary playback preservation only.
- **Baseline:** `/workspace/PiggieTV-Jellyfin-web-app`, common directory `/workspace/PiggieTV-Jellyfin-web-app/.git`, origin fetch/push `https://github.com/Piglit09/PiggieTV-Jellyfin-web-app.git`; branch `codex/bugfix/details-theme-route-ownership-53`; HEAD `31c770c87a87cecf957a71418ad8fa2cbfb2a506`; Web `0.5.81`, Plugin `0.5.25.0`; initially clean. The unchanged edit preflight passed with `cloud-development` authority. The audit mode still labels non-Windows paths historical; the explicit edit result is the operation gate. No pre-existing uncommitted work.
- **Stock authoritative owner and contract:** React Router hash history owns URL identity; legacy ViewManager owns legacy view instances; PlaybackManager and its request/start guards own stock client playback and queues. Jellyfin owns user-aware item access, streams and session reporting. `VERIFIED_FROM_SOURCE`: Atlas chapters 03, 08, 14, 19, 20–25 and source call sites.
- **Current PTV owners/modification class:** Home `STOCK_REPLACED`, Details `STOCK_WRAPPED`; themeMediaPlayer owns automatic theme lookup/start/retirement; global dock is a derived view. Native Music remains a separate established audio/queue owner. No new playback owner.
- **Affected graph:** routingAndViewLifecycle → cardsAndDetails/playback; playbackState; authenticatedPrincipal; routeTeardown and dualRouteLifecycle; existing stock/native Music playback conflict boundary. No server mutation or API schema change.
- **Identity/permission/security scope:** Capture server/user/item/visit identity for automatic work and preserve request/source provenance where tests establish need. Browser state remains a lifecycle gate, never server authorization. No restricted-user live proof is claimed.
- **DTO/mutation/readback/convergence:** No metadata mutation/readback. Item ID alone does not prove automatic-playback ownership. Audio item objects and their playOptions can be reused/mutated, so do not promote those mutable fields into session authority without proof.
- **Affected lifecycle/cache/request/playback/configuration owners:** Home Page options; theme load/play generations and available-theme state; existing PlaybackManager request/start guards if preservation regressions require an extension. No image, persisted configuration, Plugin, or shared query-cache redesign.
- **Downstream surfaces:** automatic songs/videos, blocked-autoplay retry, manual same/different-ID audio/video, intentional queue transfers, global dock, native Music, Back/Forward/replace and rapid navigation, user/server retirement, stop/start/session reporting.
- **Pre-code tests:** Real NativeHome + Page rendered Home exit regression; deferred theme reads/starts; real-manager same-ID/pending-manual and queue characterization. Observe expected assertion failures before product changes.
- **Post-code proof:** Focused rendered/lifecycle/guard/Next/dock tests; full repository unit suite; TypeScript; targeted/repository ESLint and Stylelint baselines; version/provenance tests; allowed production build; local rendered browser flow using Playwright because Browser plugin is unavailable. Screenshots/logs in `/tmp`. Hosted/physical acceptance remains pending.
- **Conflicts/UNKNOWN:** Source owners are established. Exact same-ID/pending/manual queue race behavior is to be characterized before changing it. Physical playback, remote players and live session convergence remain UNKNOWN and outside cloud authorization. Stop if a required owner becomes unresolved.
- **Known deviations/backlog:** No unrelated deviation closure or backlog reorder. Inherited support validation failures remain separately reported, never repaired in this product diff.
- **Atlas update:** Required for the final theme retirement/provenance contract; reconcile actual changed files and update relevant lifecycle/playback chapters plus system-map.json. Preserve stock 10.11.11 baseline.

## Review focus

- User explicitly selects the same media ID as an automatic theme: preserve the intentional source.
- User playback has begun negotiating but has not emitted playbackstart: late theme work cannot interrupt it.
- User adds/selects a queue item: automatic cleanup must not erase intentional queue ownership.
- Route/identity changes while theme lookup or player start is pending: no stale restart.
- Old asynchronous stop completes after a newer same-player start: preserve the newer source.

## Execution

- [x] Add rendered actual Home regression and observe red.
- [x] Add real-manager preservation and focused lifecycle characterization; record red evidence and distinguish unrelated findings.
- [x] Remove Home theme opt-in; add only necessary owner-scoped lifecycle/provenance corrections justified by tests.
- [x] Run focused regressions, then update Atlas against actual diff.
- [x] Bump Web exactly once with `npm run version:ptv:bump` to `0.5.82`; preserve Plugin `0.5.25.0`.
- [x] Run final unit/static/version/provenance/build and local rendered browser gates; classify inherited failures.
- [x] Obtain independent code review; resolve applicable findings and repeat affected gates.
- [x] Prepare evidence and PC/device acceptance steps. Local checkpoint commit authorized after review/gates; parent coordinates push/draft PR targeting the support branch.

## Inherited support baseline

Parent's real cloud smoke passed identity, exact support SHA/ancestry, edit/build and all seven cloud tests. Harmless package/deploy/deploy-development preflights denied as expected. Combined guard tests had 48 passes and three pre-existing Linux fixture assumption failures (two Windows path expectations and one default non-Linux runtime expectation). PR57's exact-head quality/plugin CI is already red; collect actual local overlap without modifying authority/support behavior.

## Actual-diff impact and decisions

- The actual Home regression failed three assertions before the one-line opt-in removal, then passed all four rendered cases.
- Real-manager tests exposed same-ID accepted manual requests, accepted queue transfer, explicit selection and replay failures. The correction adds accepted-intent notification to the existing manager and relinquishes theme ownership. Queue adoption clones only actual carried entry options; it does not authorize captured pending automatic options. Sixteen real-manager ownership cases pass.
- Two captured-user tests failed before adding server/user/item route identity and post-await/start revalidation. Sign-in/out listeners bind at first viewshow, keeping connection-barrel reads out of module evaluation.
- Independent review identified the existing desktop audio fade interruption boundary. Actual HtmlAudioPlayer/media-helper/DOM/storage/timer tests reproduced three failures against an uninterrupted-fade control. The exact fade owner now settles cancellation, restores selected gain and event delivery, and fences stop completion to the source generation. No general stop scheduler or alternate player was added. This is the only additional playback owner touched, under the same stop/start preservation scope.
- Initial full tests under system Node 24 passed 4,801 tests but failed Request route Close with an undici/jsdom AbortSignal mismatch and one unhandled rejection. The same unchanged ten-test Request file passes under repository-CI Node 20.20.2. Final full validation uses that supported CI runtime; Request source/tests are unchanged.
- No dependency/lockfile, authority, configuration, Plugin or server change. Web bumped once to 0.5.82; Plugin remains 0.5.25.0.

## Final validation and acceptance limits

- Final full repository Vitest run under CI-matching Node 20.20.2: **498 files / 4,806 tests PASS**. Focused route/ownership/theme-chip/global-state/dock matrix: **9 files / 93 tests PASS**; the separate actual-audio file adds **4 passing tests**, including an uninterrupted fade control.
- TypeScript PASS. Changed JavaScript/tests ESLint: zero errors, one existing HLS deprecation warning. NativeHome's 22 errors/one warning match the exact support baseline ignoring line shifts. PTV ESLint baseline PASS (187 existing errors/20 warnings; no increase); Stylelint baseline PASS (zero findings).
- Web version check and four version tests PASS; five build-provenance tests PASS. Production compilation PASS with two existing asset/entrypoint-size warnings. This was a development validation of dirty product source at support HEAD `31c770c87a87cecf957a71418ad8fa2cbfb2a506`, not a package or accepted release artifact.
- Playwright/system Chromium local fixture: **32 desktop/mobile route/dock/identity checks PASS**, source hashes stable, no console/page errors or external requests. Actual Home/Page/theme owner/dock are used; API/transport snapshots are fixtures. An additional real HtmlAudioPlayer/media-helper/native decoder check using generated local blob WAVs passed ten transition assertions, including restored selected volume and native B playback beyond the canceled fade duration.
- Emitted-dist cold-bootstrap assertions PASS with installed system Chromium. The original remote-dependent run failed only on unavailable Google Cast SDK delivery; the deterministic rerun fulfilled that exact optional script locally and denied other external requests. Core emitted assets, ConnectionManager, PTV runtime, rendered root and splash retirement passed with zero page/static/fatal errors. Chrome/Edge channels were unavailable; no browser installation or harness assertion change.
- Independent review reports no remaining must-fix item. Atlas update required and completed in chapters 14/19 and system-map.json for theme retirement, accepted queue ownership and actual-audio cancellation. No unrelated deviation closure/backlog reorder.
- Logs, screenshots and hash manifests are temporary under `/tmp/ptv-53-*`, intentionally uncommitted. No package, deployment, merge, release, live Jellyfin/Seerr/email request, account/media mutation or credential change.

On the PC, pull the review branch and test Series/Episode Details → header/sidebar Home, Back/Forward, rapid repeated navigation, music selected with the same theme ID, queue/Play Next/Previous, and a manual start during the stop fade. Confirm one audible source and matching dock, unchanged selected volume, advancing progress and no stale theme restart. Hosted sessions/stop-report convergence, remote players, physical devices and identity changes without the established authentication/view events remain unverified.
