# Physical WebOS hosted-app document-exit isolation

## Status

**ROOT CAUSE PROVEN FOR THE SYSTEM ERROR AND BACK ESCAPE**

**SEPARATE MUSIC PERFORMANCE DEFECT DEGRADED**

**DEDICATED TOP-LEVEL VALIDATION HOST BACK RETEST PASSED**

The production server is healthy, reports Jellyfin 10.11.11, and serves the
exact Phase 2 bundle previously validated on the LG. Production code and server
configuration were not changed.

## Hosted-container root cause

The television was running `com.sdk.ares.hostedapp` version 1.1.0. This is the
WebOS SDK's temporary development container, not a packaged PiggieTV
application.

Its installed manifest and package source prove:

- its main document is a local `index.html`;
- the main document contains a single iframe;
- `webOSLaunch` assigns the `hostedurl` launch parameter to that iframe;
- `webOSRelaunch` reloads whatever document the iframe already contains;
- `disableBackHistoryAPI` is `false`.

The original Phase 3 session began with WebOS load-error documents behind the
manually navigated production child page. Back therefore exposed the retained
WebOS `Application Error -6` document. Relaunching the SDK container without a
fresh valid `hostedurl` merely reloaded the failed iframe.

This proves the earlier `Application Error -6` as a validation-harness
provenance defect. It is not evidence that production Jellyfin or the Phase 2
bundle became unavailable.

## Controlled Music trial

A fresh SDK-container session was launched with an explicit production
`hostedurl`. The wrapper and production child frame were intact before any
physical input.

Physical sequence:

1. Right
2. Right
3. Right
4. Enter once on Music

Music navigation succeeded at `2026-07-26T05:49:47.948Z` and did not reproduce
Error `-6`, a frame detach, a target crash, a runtime exception, or a network
loading failure.

The Music route was nevertheless severely degraded:

- initial Music route focus existed after about five seconds;
- focus later detached to `body`;
- live document count rose from 13 to 49;
- live frame count rose from 12 to 39;
- DOM nodes rose from about 2,800 to about 7,300;
- JavaScript heap rose from about 18 MB to about 27 MB;
- two screenshot requests timed out, including one after the sampler stopped;
- the route eventually recovered and rendered visible Music content with
  visible focus.

The existing Music home implementation schedules a full library-index load
five seconds after initial home data, even on the Music home view. That boundary
fetches artists, albums, tracks, and playlists with concurrency two, a page size
of 48, and a cap of 360 items per section. This is temporally correlated with
the observed growth but is not yet proven causal.

Classification: `delayed-render`, with secondary `focus-detached`.

## Controlled dropdown Back trial

A second fresh session used the same explicit production `hostedurl`.

Physical sequence:

1. Right once to Movies
2. Enter once to open the dropdown
3. Down once
4. Up once
5. Back exactly once

The owner observed the menu close. Passive evidence then proved:

- the PiggieTV child route remained Home;
- focus was not on body after the menu closed;
- no PiggieTV route navigation occurred;
- the application changed from visible to hidden;
- `com.sdk.ares.hostedapp` disappeared from the running-app list;
- the inspector target then became unavailable.

The dropdown close succeeded inside PiggieTV, but WebOS also handled the same
physical Back at the SDK-container level. Classification:
`browser-default-interception`.

No duplicate PiggieTV Back action is proven.

## Dedicated top-level validation-host retest

A removable WebOS validation host was packaged and installed as
`com.piggietv.validation` version 1.0.0. It opens production as its top-level
document, contains no iframe, starts with one production-origin Home history
entry, and sets `disableBackHistoryAPI` to `true`. It changes no production
frontend, server, route, focus, playback, scrolling, or television setting.

The owner repeated the same physical sequence:

1. Right once to Movies
2. Enter once to open the dropdown
3. Down once
4. Up once
5. Back exactly once
6. Wait ten seconds

The owner observed that the menu closed. Post-Back evidence proved:

- visible focus returned to Movies;
- the dropdown was no longer visible;
- the production document remained top-level, visible, and on Home;
- focus did not fall to `body`;
- the history still contained exactly one production-origin Home entry at
  index zero;
- the app remained in the WebOS running-app list;
- the inspector target remained available;
- no route navigation, frame detach, runtime exception, network loading
  failure, or target crash was captured.

Classification: **PASS**.

This closes the Back discrepancy. PiggieTV correctly closes the dropdown and
restores header focus. The earlier app hide/exit was introduced by the Ares SDK
hosted container's native Back policy, while the earlier Error `-6` came from
that container's retained load-error/iframe history. Neither is a production
PiggieTV Back defect.

## Decision

The SDK hosted container cannot be used to validate production Back behavior.
It adds iframe history and native Back policy that do not belong to PiggieTV.

The narrowly scoped correction was the dedicated, removable WebOS validation
host that:

- launches the production origin as its top-level document;
- creates no retained load-error history;
- sets `disableBackHistoryAPI` to `true`;
- changes no production frontend, server, focus, route, playback, or scrolling
  code.

The corrected-host dropdown Back sequence passed. Phase 3 remains **HOLD**
because Scenario 2 is incomplete, the separate Music route still has a severe
delayed-render/focus-detachment result, and Scenarios 3 through 12 have not
started. Further physical validation must use the dedicated host, not
`com.sdk.ares.hostedapp`.
