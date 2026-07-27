# Phase 3A playback correction report

Date: 2026-07-27

Decision: **HOLD — implementation and device-assisted LG validation pass;
final physical-remote acceptance is incomplete.**

The final correction is running only in the removable
`com.piggietv.validation` application against a local static production build.
Production was not changed.

## Ownership audits

The pre-edit trace is retained in
[phase3a-playback-ownership-audit.md](phase3a-playback-ownership-audit.md).
The authoritative engines remain Jellyfin `playbackManager` and its stock
video controller for video, and the existing PiggieTV `musicQueue` with its one
native audio element for Music. `playbackStateService` remains their read-only
adaptation boundary.

`playbackPresentationService` is now the single non-persisted derived
presentation owner. It does not play media. It selects one of `idle`,
`audio-mini`, `audio-fullscreen`, `video-playing-controls-hidden`,
`video-playing-controls-visible`, `video-paused-controls-visible`,
`transitioning`, or `unavailable`.

The existing input path remains authoritative:

`keyboardNavigation` -> `inputManager` -> current playback adapter/engine.

`inputManager` gained one registered PTV Music transport adapter, not another
key listener. The TV focus manager remains the one PTV Back decision owner:

1. close a transient menu or dialog;
2. hide visible video controls once;
3. close full-screen Music once while retaining audio;
4. exit video playback;
5. restore the retained route/focus fingerprint;
6. use normal route Back.

## Root causes

The correction addresses these proven causes:

1. TV focus capture and the stock video bubble handler could both act on one
   Left/Right or Back event.
2. Visible OSD controls were not the active focus scope, and the PTV hide timer
   ignored focused controls.
3. The persistent mini-player was outside the recognized focus graph.
4. Full-screen Music had no recognized scope or initial-focus marker.
5. WebOS transport keys reached `inputManager`, but that owner had no adapter
   for the independent PTV Music engine.
6. Mini and full-screen visibility were derived separately, allowing engine
   and presentation state to diverge.
7. Incomplete Jellyfin audio metadata could classify an authoritative Music
   queue item as unavailable.
8. The persistent runtime host was in document flow. On the LG's Chrome 68
   renderer it began below the viewport, and unsupported `clamp()`/`min()`
   declarations dropped the dock's bottom/right placement.
9. Eager Reading/Request bundles plus unbounded Music presentation caused
   avoidable WebOS memory and compositor pressure.
10. The diagnostic scroll collector copied its full store on every scroll.
11. Runtime-scope timeouts could dereference `window` after teardown.

The red Webpack “Script error” screen came from the development-server overlay.
The static production bundle did not reproduce that harness-only overlay.

## Files and corrections

Playback/focus changes are in:

- `src/ptv/services/playbackPresentationService.ts`
- `src/ptv/services/playbackStateService.ts`
- `src/ptv/shell/PTVMediaDock.tsx`
- `src/ptv/shell/PTVRuntimeRoot.tsx`
- `src/ptv/core/tvFocus.ts`
- `src/ptv/modules/playback/index.js`
- `src/ptv/modules/playback/videoInputOwnership.ts`
- `src/controllers/playback/video/index.js`
- `src/scripts/inputManager.js`
- `src/ptv/shell/overlays.js`

WebOS resource/compatibility changes are in:

- `src/ptv/core/platformFeatures.ts`
- `src/ptv/modules/index.js`
- `src/ptv/modules/header/AppHeader.tsx`
- `src/ptv/modules/header/index.js`
- `src/ptv/shell/navigation.ts`
- `src/ptv/shell/PTVShell.tsx`
- `src/ptv/modules/music/musicPlayerResourcePolicy.ts`
- `src/ptv/modules/music/musicPage.tsx`
- `src/ptv/shell/ptvShell.scss`
- `src/ptv/styles/profiles/webos.scss`

Passive lifecycle changes are in
`src/ptv/services/diagnostics/webDiagnosticPlatform.ts` and
`src/ptv/core/scope.js`. Focused tests accompany each boundary.

### Presentation and mini-player invariant

The presentation service derives state from global playback, route family,
full-screen mount availability, and stock video UI availability. It publishes
only when the signature changes and exposes category-only document markers.
There is no second media state store.

If PTV Music owns loaded active or paused audio and full-screen Music is not
active, `PTVMediaDock` renders exactly once. The final LG renderer run proved
one visible, focusable dock on Home, Music, Artists, Albums, Songs, Playlists,
Search, and Settings. It remained after track transition and rapid route
cycles. Stop produced `idle`, `surface=none`, and no music surfaces.

The runtime host and slot are viewport-anchored. The dock is absolutely
positioned within the slot, with literal WebOS safe-area values replacing
unsupported Chrome 68 positioning functions.

### Full-screen reachability

The existing player route/component was retained. Scope metadata and initial
focus were added, and overlays cannot steal focus. On the LG renderer:

- mini-player Player opened `#/music/player` once;
- state became `audio-fullscreen`;
- one full-screen player and zero mini-players were visible;
- Pause received initial focus;
- Right stayed within visible full-screen controls;
- one Back returned Home with continued audio and one mini-player;
- the application did not terminate.

### Video scope, seek, transport, and Back

Visible stock OSD controls now own `player-controls`; page content is excluded.
Focused controls do not auto-hide. The focus owner invokes one existing seek
interval for hidden-player Left/Right and the stock bubble handler yields a
default-prevented event.

On the final LG run, one hidden Right changed position once, woke the OSD,
focused its seekbar, kept playback running, and did not move into page content.
Transport paused/resumed audio and video once per event. Back from visible
video hid controls once; the next Back exited once and restored a connected,
visible Home hero target.

### Route/lifecycle cleanup

A rapid Home/Music route cycle retained one application, one runtime, five
registered listeners, and zero duplicate listener/feature growth. The timeout
disposer now captures its scheduler and suppresses a callback after its window
is destroyed, removing six post-teardown errors from the complete PTV suite.

## Diagnostics and privacy

No diagnostic key, focus, playback, route, or transport owner was added.
Existing playback events record category-only state/surface transitions. The
scroll collector now snapshots once per continuous burst.

No schema changed. Device results retain no title, item/media/user/device or
session ID, URL, key code, token, cookie, credential, or file path.

## Automated results

Passed:

- focused presentation/platform/player tests: 57/57;
- focused scope/cache lifecycle tests: 9/9;
- complete PTV Vitest: 115 files, 701 tests;
- complete repository Vitest: 138 files, 907 tests;
- diagnostics TV-profile Playwright matrix: 9/9;
- TypeScript;
- focused and baseline Stylelint;
- production Webpack, with only two established size warnings;
- core schema validation, privacy tests, secret scan, and `git diff --check`.

Focused Phase 3A ESLint outside legacy `PTVShell.tsx` has zero errors and four
existing warnings. The repository PTV ESLint baseline gate remains red: 307
errors and 31 warnings, with debt above baseline in 18 accumulated-worktree
files. `PTVShell.tsx` retains 25 existing compatibility/JSX errors; none are on
the new platform-filter lines. This prevents a completely green lint claim.

## LG evidence

Owner-operated physical-remote evidence on the same Phase 3A input code passed
visible video scope, one-stage hide and second-stage exit, hidden Right seek,
continued playback, and Home focus restoration. Physical full-screen Music
then reached the resource-related app termination.

The final resource, metadata, and viewport corrections were exercised in the
actual LG application process through the developer input channel. That run
passed Music load, mini/full-screen exclusivity, all listed routes, track
change, transport, Music Back, video scope/seek/transport, and two-stage video
Back without a crash.

Developer-channel input validates the real WebOS renderer and complete
normalization/action pipeline, but it is not a literal physical remote press.
The final Music path therefore lacks the task's last physical-remote proof.

## Remaining defects and decision

- Final physical-remote Music acceptance is incomplete.
- Repository ESLint debt exceeds its checked-in baseline.
- WebOS intentionally shows fewer initial Music cards/sections and defers
  lyrics/backdrops. Queues and playback are unchanged.
- The run used a local static production bundle, not a production deployment.

Reading and Request are intentionally unavailable on WebOS. Navigation entries
are removed, chunks are not loaded, and direct excluded hashes return Home.
Other web clients retain both features.

Decision: **HOLD**. This is not BLOCK: playback and presentation remain aligned,
diagnostics is passive, privacy checks pass, and no competing owner exists.
It cannot receive final APPROVE without post-correction physical-remote Music
evidence and lint reconciliation.

## Exactly one next phase

Begin **Phase 3A.1: Final Physical-Remote and Lint Acceptance**.

Use one production-mode LG session with the final static bundle to repeat Music
mini -> full-screen -> transport -> next/previous -> Back and video hidden seek
plus two-stage Back at slow, normal, and repeat speeds. Confirm one
runtime/listener set and reconcile only the existing lint baseline. Do not add
features or change playback ownership.

## Ownership confirmation

No second playback engine, state store, focus engine, route stack, remote
listener, Back owner, transport owner, or diagnostic input layer was added.
