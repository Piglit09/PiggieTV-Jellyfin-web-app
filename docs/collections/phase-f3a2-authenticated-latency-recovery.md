# Phase F3A2 - Authenticated Collections Latency and Recovery Closure

## Decision

HOLD. Product ownership remained correct, the controlled one-shot retry recovered,
and development plus frozen-production TV focus checks passed. Approval remains
blocked by repeatable test-server transport latency/failures, missing live Collection
search results for an otherwise usable Jellyfin collection, incomplete production
deep-scroll restoration evidence, and the absence of a second approved identity for
real isolation proof.

## Repository boundary

- Starting product commit: `b0b260a3c772628407434eefce14a46aebb0c813`.
- Starting branch: `main`, one reviewed local commit ahead of `origin/main`.
- F3A1 review: 11 files, 614 insertions, and 42 deletions.
- F3A1 preserved the existing ApiProvider, request coordinator, router, settings,
  and TV focus owners.
- F3A2 changes validation tooling, tests, and documentation only.
- No product source or production service was modified.

## Build identity and topology

The development run used the approved current worktree through webpack development
output with HMR enabled and service-worker control disabled for the ephemeral profile.
The development index response digest was
`089eb90d454744f2198354a1fdc44c055ff90b59c4c6e71391de9744e34b82fb`.

The production run used one frozen `dist` tree for its complete browser session:

| Property | Value |
| --- | ---: |
| Files | 2,563 |
| Total bytes | 62,846,457 |
| JavaScript bytes | 28,353,206 |
| CSS bytes | 2,647,978 |
| Index bytes | 5,379 |
| Index SHA-256 | `f57ba48e37fbdc3240520d60fb5def2d3ed9cd228dccece34886df77f36518f6` |
| Tree SHA-256 | `05c2ef0470d7a66580f80acd92dedd9908e7c6fd7d67662500e67c4d164e7022` |

The frozen artifact is configured for single-server, same-origin operation. The
validation surface therefore used a browser-local static server with a same-origin
HTTP/WebSocket reverse proxy to the approved test server. The first file-only static
attempt was rejected as a harness-topology failure and was not counted. No server,
production frontend, or application configuration was changed.

## Authentication timeline

Credentials were entered only through normal Jellyfin login controls and remained
transient. No credential, token, cookie, server address, user identifier, screenshot,
trace, or storage-state file was retained.

| Surface | Login evidence |
| --- | --- |
| Development, cold | Login ready 1,950.3 ms; identity ready 919.2 ms after submit; Home 1,002.2 ms after submit |
| Development, recovery session | Login ready 3,093.5 ms; identity ready 469.4 ms; Home 550.5 ms |
| Frozen production | Normal login to authenticated Home in 1,449 ms |

## Latency attribution

### Development cold Collections landing

| Boundary | Duration |
| --- | ---: |
| Route recognition | 83.5 ms |
| First critical request admission | 62.2 ms |
| First content | 4,002.4 ms |
| Full settlement | 33,712.4 ms |
| Critical transport p95 | 3,618.8 ms |
| Deferred transport p95 | 17,092.2 ms |

Frontend route recognition and request admission were fast. Transport dominated both
first content and deferred settlement. Initial development startup recorded one
464 ms webpack/startup long task; this was not a steady Collections route task.

### Frozen-production cold Collections landing

| Boundary | Duration |
| --- | ---: |
| Route recognition | 76.3 ms |
| First request admission | 71.6 ms |
| First content | 1,930.8 ms |
| Visible settlement | 1,933.0 ms |
| Transport p95 | 1,516.0 ms |
| API request count | 2 |
| Failed requests | 0 |
| Visible cards | 87 |

The successful cold production route used one active request at peak and had no
duplicate exact key.

## Controlled retry

One development critical collection request was interrupted at the browser transport
boundary. The UI showed one bounded error, one visible retry was clicked, one
replacement request was admitted, and 87 cards became usable. Recovery took
27,056.3 ms during the final critical-target restoration run because the successful
server response was slow. Cancellation was not surfaced as a second product error,
the coordinator returned to zero in-flight work, and runtime, shell, client, and
socket ownership remained singular.

## Three-cycle results

Neither surface completed three passing route cycles.

Development failures were bounded to live source availability and Search capability:

- Cycle 1 reached member Details and Back, then the Collection Search result did not
  appear after the first request failed and the bounded retry returned an empty result.
- Cycle 2 again completed Details and Back but Collection Search ended empty.
- Cycle 3 reached a settled bounded All-view failure state with no collection card to
  open.

Frozen-production cycle 1 completed Landing, Featured, All, collection Details, member
Details, and return to Collections. It failed one Back-to-collection wait under failed
requests and produced no Collection Search result. Cycle 2 restored collection Details
but saw bounded Featured and final Collections source failures plus the same Search
gap. Cycle 3 retained singular ownership while multiple collection views settled to
bounded unavailable/empty states and Search again produced no Collection result.

Across the frozen-production ledger, Jellyfin collection transport had 15 requests,
8 failures, 13,491.2 ms p50, and 30,003.1 ms p95. Jellyfin item transport had 22
requests, 9 failures, 4,110.8 ms p50, and 30,004.3 ms p95. Two 8.8-10.7 ms exact-key
overlaps occurred only at failed-request replacement handoff; there was no concurrent
successful duplicate. Peak API concurrency was four overall and the F3 deferred-source
owner remained bounded by its existing limit.

## Focus, responsive, and runtime evidence

- Development critical Jellyfin target: focus restored, scroll restored at 3,731 px,
  and scroll delta was 0.
- Development Smart-TV profiles at 1920x1080 and 1280x720: directional focus moved,
  focus stayed valid, no horizontal overflow, and reduced motion matched at 720p.
- Frozen-production Smart-TV profiles rendered 87 cards at both sizes with the same
  focus, overflow, reduced-motion, and one-socket results.
- Frozen-production critical focus restoration succeeded on the repeatable target.
  A later deep deferred target returned to source-unavailable content, so deep-scroll
  production proof remains incomplete.
- Desktop, tablet, and phone portrait/landscape profiles had no horizontal overflow
  and retained keyboard focus. The generic target-size probe found 22-23 visible
  controls below 40 px, including existing shell controls, and remains accessibility
  debt requiring component-level attribution.
- One bootstrap, one runtime, one runtime application/shell, five owned runtime
  listeners, one ApiClient, one Jellyfin WebSocket, and five active mutation observers
  remained stable. Development separately classified one HMR socket.
- Production steady-state browser observation: 164.7 uncapped headless FPS, 6.2 ms
  frame p95, 12.1 ms longest frame, 719 DOM nodes in the bounded state, zero broken
  visible images, and no steady-state long task above 100 ms.

## Identity isolation

The approved topology supplied one non-admin validation identity. Real second-user
isolation was therefore not testable, and this phase did not simulate identity proof.
Existing focused server/user scoping tests remain green, but live identity isolation
is an explicit HOLD item.

## Validation tooling

`scripts/ptv-f3a2-collections-acceptance.cjs` attaches to an already authenticated CDP
browser, reloads under safe instrumentation, records three route cycles, optionally
injects exactly one collection transport failure, and emits only schema-validated,
sanitized JSON. It never accepts credentials and never writes screenshots, traces, or
storage state. `scripts/ptv-f3a2-harness-utils.cjs` owns request classification,
hashed exact-key comparison, handoff attribution, retry gating, and privacy checks.

Focused and full gate totals for the assembled branch are reported in the final phase
handoff rather than copied into a machine-specific evidence artifact.

## Next closure phase

Phase F3A3 - Collection Search Capability and Backend Latency Closure.
