# Phase 3A playback ownership audit

Date: 2026-07-26

Status at audit: HOLD. This document records the ownership trace completed
before Phase 3A product-code changes.

The resulting correction and validation record is
[Phase 3A playback correction report](phase3a-playback-correction-report.md).

## Existing authoritative owners

| Concern | Existing owner | Evidence |
|---|---|---|
| Jellyfin video state and engine | `playbackManager`, the selected Jellyfin media-player plugin, and `controllers/playback/video/index.js` | The video controller binds the current player, issues seek/play/pause/stop commands, owns the native OSD, and stops video when its view exits. |
| PiggieTV music state and engine | `modules/music/musicQueue.ts` and its single hidden `HTMLAudioElement` | The queue owns the loaded item, native audio element, position, play/pause, seek, next/previous, repeat, shuffle, and server progress reports. |
| Cross-surface playback snapshot | `services/playbackStateService.ts` | It is the existing adapter over the two engines. It selects one normalized source, pauses PTV music for video ownership, and publishes the global snapshot. |
| Compact music presentation | persistent `PTVRuntimeRoot` -> `PTVMediaDock` | The root is process-persistent and idempotent. The dock separately derives visibility from the global playback snapshot and current hash. |
| Full-screen music presentation | `MusicPage` `PlayerView` at `#/music/player` | It renders the existing queue controls and consumes the same music queue snapshot. |
| Video presentation | Jellyfin video page plus `modules/playback/index.js` | Jellyfin owns the OSD. The PTV module only decorates it, mirrors its visibility into PTV classes, and adds the existing PTV header/pause presentation. |
| TV focus and restoration | `core/tvFocus.ts` | It owns document-capture directional, Select, and Back handling for PTV-owned routes, focus graph construction, route-keyed focus fingerprints, and playback return memory. |
| General WebOS key normalization | `scripts/keyboardNavigation.js` -> `scripts/inputManager.js` | WebOS transport key codes are normalized to `play`, `pause`, or `playpause`; `inputManager` dispatches the command and otherwise calls Jellyfin's playback manager. |
| Video key handling | `controllers/playback/video/index.js` | It also binds a document bubble `keydown` handler and an `inputManager` command listener while the video page is shown. |
| PTV playback Back action | `core/tvFocus.ts` -> `.ptv-player-top-back` -> `modules/playback/index.js` -> `appRouter.back()` | The focus owner chooses the PTV Back button, while generic Jellyfin video and router handlers remain present later in the event path. |
| Route state and cleanup | Jellyfin router/view lifecycle, PTV route controller, persistent runtime root, and each module runtime scope | The video controller removes page listeners on `viewbeforehide`; the PTV playback module and core services use idempotent scopes/disposers. Music playback intentionally survives route changes. |
| Jellyfin media-session callbacks | `MediaSessionSubscriber` attached by `playbackManager` | The subscriber delegates media-session actions to the current Jellyfin player. The independent PTV music engine is not represented by this subscriber. |
| Diagnostics | Phase 2 diagnostic collectors | They observe document/input/focus/playback state and remain passive. |

## Conflicting paths

### 1. Video directional input has two action paths

On a PTV-classified playback route, `tvFocus` receives a physical Left/Right
first in document capture. Its active scope is the whole video page, so it may
run directional focus search and prevent the event. The Jellyfin video
controller then receives the same event in document bubble and does not reject
an already-default-prevented event. With hidden controls it also focuses the
seek slider and redispatches a synthetic key. With visible controls it can call
fast-forward/rewind after the focus owner moved focus.

This is the proven competing path behind focus movement plus seek presentation
for one physical event. The slider's Enter handler calls play/pause rather than
committing a seek, matching the physical result where trickplay appeared and
Enter paused video without changing position.

### 2. Video controls are not the active focus scope

`tvFocus.findActiveScope()` chooses `#videoOsdPage`, `.videoOsdPage`, or the
non-interactive PTV chrome root whenever playback is active. It does not choose
the currently visible OSD control container. Page candidates can therefore
remain in the graph while controls are visible.

The PTV chrome timer hides controls after 4.2 seconds whenever video is not
paused. It does not test whether focus remains inside a player control. This
explains the physical state with a focused Back control whose presentation
auto-hid.

### 3. The mini-player is outside the page focus scope

`PTVMediaDock` is mounted under the persistent runtime root, outside every
selector in `PAGE_SCOPE_SELECTOR`. When a dock button receives focus, the
focus manager still builds the active graph from the route page. The dock
button is outside that graph, so the next direction is rejected and fallback
restoration selects page/shelf content. This exactly matches the physical
Pause -> shelf leak that made the visible Player button unreachable.

### 4. The full-screen music player has no recognized playback scope

The focus classifier looks for `.ptv-music-fullscreen-player` or
`.ptv-fullscreen-music-player`. The existing view actually renders
`.ptv-music-now-playing-view` and declares neither a focus scope nor an initial
focus target. It is therefore categorized as generic main content. The route
and action binding exist; focus/scope metadata is the smallest proven missing
piece.

### 5. Hardware Play/Pause cannot reach PTV music

`keyboardNavigation` correctly normalizes WebOS media keys through the existing
`inputManager` owner. `inputManager` always delegates the resulting transport
command to Jellyfin's `playbackManager`. PTV music uses an independent,
already-authoritative native-audio queue and is not a Jellyfin player, so
hardware Pause/Play has no action target. `tvFocus` classifies those keys only
for diagnostics and never executes them. Adding another document key listener
would create a forbidden second owner; the repair must be an adapter inside
the existing `inputManager` command path.

### 6. Back has no explicit presentation-first decision

The focus owner closes known layers first. During playback it only searches
for a Back button and clicks it; that button immediately calls generic
`appRouter.back()`. Full-screen music is not modeled as a player
presentation, visible video controls are not considered before video exit,
and the return route/focus target is not part of this decision. Jellyfin's
video key and input-command listeners also remain present later in the event
path. Physical evidence did not prove a duplicated Back action, but it did
prove wrong branch selection and loss of the originating details route.

### 7. Music presentation has no single invariant owner

The music engine intentionally survives route changes. Mini visibility is
computed locally by `PTVMediaDock` from two independent subscriptions (global
playback and hash), while full-screen visibility is computed by `MusicPage`
from its route. There is no explicit derived presentation snapshot, no
transition state, and no invariant that verifies one visible surface for a
loaded audio session. The persistent dock root itself was not disposed during
the physical failure; the observed Home state therefore proves presentation
and engine state diverged, not that audio correctly stopped.

The retained Phase 3 evidence was collected after the mini-player had already
disappeared and cannot identify which transient subscription/route ordering
first produced the null presentation. The conflict is still bounded: two
components independently decide mutually exclusive presentation from different
snapshots, with no common owner or recovery invariant.

## Lifecycle and subscription findings

- `PTVRuntimeRoot` is guarded by `__ptvRuntimeRootStarted` and mounts one dock.
- `playbackStateService` is guarded by `initialized`, subscribes once to the
  music queue, binds five playback-manager events, and removes them in its test
  disposer.
- `musicQueue` creates one audio element and one fixed set of native listeners.
  It intentionally has no route cleanup because audio is allowed to continue.
- `MusicPage` queue subscriptions use React effect cleanup. Track changes
  update the mounted player instead of reopening its route.
- Jellyfin's video controller installs its document/input listeners on
  `viewshow` and removes them on `viewbeforehide`.
- The PTV playback module is guarded by `moduleInitialized`, uses the module
  runtime scope, releases player/video listeners, and removes its DOM on
  destroy/stop.
- No duplicate PTV focus listener was observed in Phase 3. The problem is
  competing established listeners with overlapping responsibility, not
  repeated installation of the same listener.
- The PTV music engine has no suspend/resume or visibility listener. Native
  browser audio remains authoritative across visibility changes.
- Jellyfin's media-session subscriber remains authoritative only for Jellyfin
  players. PTV music has no current media-session action registration.

## Required correction boundary

The smallest safe correction is:

1. add one non-persisted derived presentation service over the existing global
   playback snapshot, route state, and video-control visibility;
2. make both music surfaces consume that one decision;
3. teach the existing focus owner to recognize mini, full-screen music, and
   visible video-control scopes;
4. keep WebOS normalization in `keyboardNavigation`/`inputManager`, adding one
   registered transport adapter for PTV music rather than another key listener;
5. make the existing video controller yield events already handled by the
   capture owner and make its seekbar perform one explicit seek;
6. prevent the existing chrome timer from hiding while a player control owns
   focus;
7. make the existing Back owner choose exactly one presentation branch and
   retain route-keyed focus memory.

No playback engine, route stack, focus engine, remote listener, or diagnostic
owner needs replacement.
