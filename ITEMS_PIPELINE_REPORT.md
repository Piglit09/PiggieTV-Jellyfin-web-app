# Authenticated Jellyfin Items Pipeline Report

## 2026-07-24 Jellyfin backend latency attribution

Decision: **HOLD**. The approved non-administrator browser account was retained
for the unchanged warm, immediate-repeat, and authenticated transport-cold
matrix. A separate administrator observer collected Jellyfin logs, scheduled
tasks, plugin inventory, system storage, and read-only database-directory
evidence. Neither identity replaced the other, and no credential, token,
identifier, title, complete request target, header, cookie, or absolute path is
present in the artifacts.

The observed backend is Jellyfin 10.11.11 on X64 with PiggieTV 10.11.8.2/API
v1 and 13 advertised capabilities. Program data, logs, cache, and metadata
report fixed storage with 156,048,969,728 free bytes. Sixteen configured
library folders comprise 11 network and five fixed-storage entries. The main
SQLite database was visible before and after; no WAL, SHM, or rollback-journal
companion was present at either directory observation. Admin APIs do not expose
journal mode, busy timeout, filesystem type, inode state, process count,
CPU/memory/swap, disk await/queue, mount latency, or retransmits, so those
facts remain `not-observed`. No integrity check was run because it could add a
production lock.

The matrix recorded 81 classified Jellyfin item reads with time-to-headers
p50/p90/p95/max of 8.909/34.906/55.436/68.615 seconds. Warm-only p50/p90 were
13.045/28.223 seconds. Warm passed 9/13, immediate repeat 12/13, and
transport-cold 11/13. Warm failed Season details, Reading, Music, and TV-like
focus; transport-cold failed Shows and focus. All 76 requests over 1.5 seconds
have privacy-safe correlation rows, including all 68 over three seconds and 58
over five seconds.

Jellyfin logged 174 slow responses during the bounded capture. Seventy-five of
76 browser slow reads have a direct server completion match; 74 are proven or
strong server-duration matches. The remaining concurrent BoxSet read is a
weak match because its server completion preceded browser headers by about ten
seconds while two sibling requests completed in the same browser millisecond.
Across matched requests, median server/browser duration ratio is 1.0, median
absolute duration delta is 7 ms, and browser transfer median is 0.7 ms. The
direct listener/network path is contradicted as primary owner.

Current logs contain zero SQLite locked/busy events, optimistic-concurrency
retries, Entity Framework warnings, or query-splitting warnings in the capture
window. This does not clear the historical locked playback write. It means
SQLite lock contention and EF query shape are not demonstrated for this run.
Host saturation and storage latency cannot be classified without the missing
host counters.

One scheduled operation is strongly correlated with the worst window:
`Optimize database` ran from 11:30:31Z to 11:35:37Z. The 57 requests completing
before it began already had p50/p90/max of 9.103/33.744/43.707 seconds. Five
in-flight requests that crossed its start rose to
65.634/68.615/68.615 seconds; 19 requests started while it ran measured
4.971/12.880/21.753 seconds. Post-window admin observation also remained
blocked until the task completed. Database maintenance is therefore a strong
amplifier, not the proven sole owner: the severe backend tail predates it.
PTV log activity was observed, but no specific plugin callback or plugin task
has causal evidence.

TV-like focus failed independently in every pass. A visible browse card
retained focus through Right, Down, Left, and Up; focus never changed, no
activation occurred, and no request was made. Focus was not redesigned or
mixed into backend attribution.

The required isolation proposal is recorded but not executed: with explicit
approval, defer only the `Optimize database` schedule for one unchanged
matrix plus 30-second pre/post windows, preferably with a host observer active.
Restore its original trigger immediately afterward. Accept only p90 below
three seconds, 13/13 in every pass, and clean current database logs. Because
the pre-task tail is already severe, obtain SSH/host-observer access for
CPU/process/disk/mount evidence in the same approved window.

Automated validation passes: focused Items/coordinator/Phase 2A-2D/logout/auth
coverage 153/153 across 25 files; full Vitest 816/816 across 125; TypeScript;
zero-warning changed-harness ESLint; production Webpack in 93.336 seconds with
the two established size warnings; 10 Core schemas; Android parity at 26
models/14 enums/19 capabilities/one error; frontend/plugin contract; the
118,246-path secret scan; 12-artifact privacy validation; and Web/mobile/TV
`git diff --check`. Android source did not change, so Android builds/lint were
not rerun.

The eight required artifacts plus the four unchanged matrix artifacts are in
`test-results/backend-latency-attribution`. The automatic maintenance task
changed backend database state during the observation, but Codex did not start,
stop, defer, reconfigure, or approve it. No timeout, browser identity, product
behavior, playback, authentication implementation, Core boundary, Android
source, database command, plugin, server configuration, or media path was
changed. Phase 2E and production remain HOLD.

## 2026-07-24 Production authenticated stabilization pass

Decision: **HOLD**. Frontend amplification is corrected, but this pass does not
clear production readiness. The fixed p90 target and the 13/13 interaction
target still fail, and current Jellyfin log, host, and database evidence could
not be collected with the approved non-administrator account.

### Identity and validity

The same approved non-administrator account was retained for every run. The
privacy-safe provenance is frontend build 10.11.11, Jellyfin 10.11.11,
PiggieTV plugin 10.11.8.2/API v1 with 13 capabilities, desktop Chrome
149.0.7827.199, loopback frontend, private-network direct HTTP Jellyfin
listener, and no service-worker registration or controller. Server uptime and
recent-restart state were unavailable. The first authenticated pass was warm.
The third pass disabled transport cache without reloading or replacing the
session and is therefore labeled `transport-cold`, not full application cold.

### Baseline, graph, and correction

The first privacy-safe run recorded 90 classified requests, 17 exact
concurrent duplicates, peak concurrency 11, and time-to-headers p50/p90/p95/max
of 3.060/11.876/16.269/37.016 seconds. A corrected attribution run recorded 21
duplicates and peak concurrency 12. The duplicate graph assigned the dominant
fan-out to Movie, Series, and Season detail activation, with one repeated
genre-directory contract during Back/Forward.

In-memory CDP attribution found the same item-detail GET being initiated by
the stock detail controller, repeated DOM-driven integration enhancement, and
the PTV detail fallback. The integrations consumer could invoke the same read
four times before its existing response cache was populated. Those legacy
consumers now share one in-flight promise through the existing global request
coordinator. The browse genre/studio directory does the same for identical
metadata requests. The legacy clients, raw DTOs/errors, integration cache,
renderers, route lifecycle, and settled-request behavior remain authoritative.
No response cache, Core API boundary, timeout, retry, UI, or navigation policy
was added.

The authoritative after-run recorded zero exact concurrent duplicates, zero
canonicalization misses, and peak concurrency 8. Across setup plus all three
passes, p50/p90/p95/max were 1.390/3.644/4.464/6.978 seconds. The aggregate
p50, p95, and maximum targets pass; p90 remains above the 3-second target.
The warm pass alone measured 1.698/3.724/4.464/6.978 seconds, so its p50 and
p90 also fail. Because server latency varied substantially between equivalent
runs, only duplicate elimination is assigned causally to the frontend
correction.

### Equivalent transport comparison

Each path ran 15 successful reads with the same account, server, query cases,
and authenticated state:

| Path | p50 | p95 | max | Header evidence |
| --- | ---: | ---: | ---: | --- |
| Shared PTV request | 0.544 s | 1.124 s | 1.138 s | completion; no distinct ResourceTiming entry |
| Direct browser fetch | 0.567 s | 1.128 s | 1.141 s | time to headers |
| Direct listener client | 0.570 s | 1.078 s | 1.125 s | time to headers; median transfer 0.8 ms |
| Jellyfin ApiClient | 0.584 s | 1.113 s | 1.159 s | completion |

The paths do not show a stable frontend transport penalty. In the severe
matrix, almost all elapsed time occurred before headers; the direct-listener
sample also shows negligible transfer time. The proven owner is therefore
upstream of frontend transport, at the Jellyfin/backend path. The specific
database, process, plugin, storage, or host-resource owner remains unproven.

### Scenario and contract results

Warm, immediate-repeat, and transport-cold each passed 12/13. The sole
scenario failure was the browser TV-like directional-focus assertion. No
focus implementation was changed. The playback-continuation check was
deliberately read-only and validated the Resume contract; it did not start
playback or write progress. The older literal 13-scenario runner is no longer
present and its recovered behavior included playback and user-data mutation,
so it was not revived under a read-only evidence mandate. This new matrix does
not convert that historical gate into a claimed pass.

The final query audit found zero invalid ItemFields requests, zero `UserData`
field tokens, and zero parameter-name/casing collisions. Five semantically
child-bounded Season/Episode requests had no explicit Limit. Sixteen bounded
or child-list reads requested MediaSources. Those contracts remain unchanged:
the current renderers still consume the response shapes, and absence of a
field requirement was not proven. No query was reduced speculatively.

### Server, database, host, plugin, and proxy evidence

The approved account received 403 for current server logs, scheduled tasks,
and installed-plugin inventory. No read-only host session was available.
Consequently current journal mode, busy timeout, database size/WAL, integrity,
mount type, free space, ownership, process count, CPU, memory, swap, disk
queue, filesystem latency, and network errors are explicitly `not-observed`.
No local Jellyfin process or database was substituted for the configured
remote backend.

Historical evidence remains authoritative but is not relabeled as current-run
correlation: SQLite locking caused a playback-progress HTTP 500 after 35.22
seconds, successful Items-family reads reached 93.39 seconds, and an EF
multiple-collection warning was present. Playback Reporting overlap remains
weak correlation, not causation. The current browser matrix saw zero HTTP 500;
its sole HTTP failure was an expected non-admin plugin-inventory 403. The
active browser uses the direct Jellyfin listener, so reverse proxy and TLS
investigation are not applicable. Host-local comparison was unavailable.
Nothing was disabled, installed, restarted, or reconfigured.

### Validation and artifacts

Focused Items/client/coordinator, Home, Search, browse/details, Phase 2A-2D,
logout, and authentication coverage passed 257/257 across 38 files. Full
Vitest passed 816/816 across 125 files. TypeScript, zero-warning new-scope
ESLint, production Webpack, ten schemas, Android contract parity
(26 models/14 enums/19 capabilities/one error code), the 118,245-path secret
scan, privacy validation of all 11 final JSON artifacts, and Web/mobile/TV
`git diff --check` passed. Webpack retained only its two established size
warnings. The legacy stock detail file retains three pre-existing lint
warnings outside edited lines. Android source did not change, so Android
builds and lint were not rerun.

Final privacy-safe evidence is under
`test-results/items-stabilization-after-coordinated`. Raw query-contract
telemetry and source-changing intermediate runs were discarded; they are not
recoverable generated artifacts.

### Exact next action

Keep Phase 2E and production release on HOLD. Provide a time-bounded,
read-only observer path to the actual Jellyfin logs and host while retaining
the same browser account. Rerun the unchanged privacy-safe matrix while
capturing sanitized request completion, SQLite lock/checkpoint warnings, and
bounded CPU/memory/disk/mount/network samples. Perform read-only database
inspection only; do not isolate a plugin/task or make a database/configuration
change until that timestamped evidence identifies a specific owner and an
approved rollback.

## Post-fix automated validation results

Focused validation passed 2 files and 9 tests across the shared client sanitizer and coordinated Items helpers. The TypeScript build check passed with zero errors. Production Webpack compiled in 104.624 seconds with only the two established size warnings.

The generated SDK import and sanitizer are therefore validated in both tests and the production bundle. No authenticated interaction, cold/warm discovery, server playback-write, database-lock, or device scenario was rerun by this automated command.

## Clean restart sample after ItemFields enforcement

The follow-up 8,908-line server log contains zero ItemFields binder errors, zero UserData conversion errors, zero database locks, zero optimistic retries, zero HTTP 500s, and zero server errors. Its three logged PTV Fields parameters are generated-enum clean. This confirms the new request boundary for the observed Latest and Resume calls.

There are five successful slow responses: User Views at 1.51 seconds, Studios at 2.84 seconds, Latest at 2.76 seconds, Audio Resume at 2.95 seconds, and Video Resume at 3.24 seconds. The window is short and contains no playback-progress write, so it does not negate the prior 35.22-second locked write or broad reads up to 93.39 seconds. No additional frontend change is justified from this sample.

## Post-correction Jellyfin log audit

The supplied 37,416-line server log contains zero occurrences of the original invalid UserData ItemFields failure. It contains 256 debug model-binding conversion exceptions for other unsupported field tokens; requests may still return 200 after Jellyfin skips those values, so HTTP status alone did not reveal the contract noise. PTV now enforces the generated SDK enum at the shared API boundary rather than deleting tokens page by page.

The log also supplies the missing backend evidence. SQLite failed a playback user-data commit with database is locked after three optimistic-lock retries; POST /Sessions/Playing/Progress completed in 35.22 seconds with HTTP 500. There are 42 slow responses, including Movie Genres at 61.0 seconds, BoxSet Items at 41.17 seconds, Seasons at 28.21 seconds, and Episodes at 61.74 and 93.39 seconds. An EF Core warning reports a multiple-collection single query without configured query splitting.

Playback Reporting was active near the lock, but the evidence is correlation only. No plugin, database, or server configuration was changed. The new boundary test was added and not run during this prompt. Release work remains blocked on clean validation, clean new server logs, read-only lock/host investigation, and the unchanged authenticated and physical-device gates.

Date: 2026-07-21

## Decision

The frontend amplification found in the authenticated `Items` path is fixed,
but PiggieTV is still **not production-ready**. The unchanged interaction gate
passed 7 of 13 checks on the first corrected run and 3 of 13 on the immediate
warm repeat. Representative Jellyfin requests still have multi-second tails,
including 11.3 seconds for a browse-shaped request and 22.0 seconds for one
`ApiClient` Views request.

No interaction timeout was raised. No database, plugin, reverse-proxy, mount,
server, or user-data configuration was changed.

## Scope and privacy

`scripts/ptv-items-latency-profile.cjs` connects to the existing authenticated
Chrome session and benchmarks the same Jellyfin server through browser fetch,
the Jellyfin `ApiClient`, and a direct Node request. Runtime credentials and the
server origin remain ephemeral. Persisted reports contain sanitized contracts,
counts, timings, and hashed query identities, not tokens, origins, user IDs,
item IDs, titles, paths, cookies, or headers.

Browser Resource Timing transfer-phase values were excluded from all
conclusions because entry correlation was not reliable for repeated identical
URLs. Request wall time, time to response headers, completion time, status, and
response counts remain the authoritative timing evidence.

## Benchmark matrix

The matrix covered minimal lists, total-count and user-data toggles, Movie card
and broad browse profiles, Search, Music Artists, Reading, Resume, and Views.
Full-mode samples included first request, immediate repeat, 5-second repeat,
30-second repeat, fifth repeat, concurrency two, concurrency four, and a
realistic startup burst.

Baseline full browser results:

| Contract | Median | P95 / maximum |
| --- | ---: | ---: |
| Minimal list | 2.00 s | 8.38 s |
| Movie card | 1.07 s | 3.42 s |
| Movie browse | 2.44 s | 10.53 s |
| Search | 1.76 s | 6.34 s |
| Music Artists | 1.74 s | 13.55 s |
| Reading | 2.58 s | 8.63 s |
| Resume | 1.73 s | 5.57 s |
| Views | 2.05 s | 3.74 s |

Removing total counts or user data did not produce a consistent serial-query
improvement. Browser, direct, and `ApiClient` paths also had no stable winner.
Most request time elapsed before response headers; transfer and parsing were
small. This rules out browser rendering and JSON transfer as the primary cause.

Concurrency was a clear amplifier. Four simultaneous broad Movie browse
requests completed at approximately 2.39, 5.27, 8.65, and 10.53 seconds in the
baseline. Four simultaneous minimal requests completed at approximately 3.0,
4.2, 5.4, and 8.38 seconds.

## Frontend fan-out root cause

A live Movies transition exposed two independent frontend problems:

- `getPtvItems` and `getPtvResumeItems` preferred raw Jellyfin `ApiClient`
  methods, bypassing the existing PTV in-flight request coordinator.
- A retired Home background pipeline could proceed to a heavy 47-item quality
  hydration request after navigation. That request included media sources and
  streams plus broad detail metadata and competed with Movies.

The pre-correction trace observed 11 list/resume requests, peak concurrency of
9, four exact duplicate request pairs, and the stale Home hydration request.

## Correction

- `getPtvItems` now sends the unchanged `Users/{user}/Items` contract through
  `requestPtvJson`, which owns the shared in-flight coordinator.
- `getPtvResumeItems` now sends the unchanged
  `Users/{user}/Items/Resume` contract through the same boundary.
- Home recommendation quality hydration checks its load owner immediately
  before dispatch. A retired route skips the request and emits one bounded,
  payload-free diagnostic.

This is request coalescing and stale-owner retirement, not response caching.
Query fields, limits, filters, image profiles, cache schemas, rendering, route
ownership, and playback behavior are unchanged.

The corrected route trace rendered 70 Movie cards with 5 completed list
requests, 0 duplicate contract groups, 0 stale hydration requests, and peak
concurrency of 4.

## Post-correction server evidence

The frontend correction did not cure the underlying Jellyfin tail:

- Full Movie browse schedule: median 5.71 seconds, p95/maximum 11.32 seconds.
- Three-sample browser Movie card maximum: 7.27 seconds.
- Three-sample browser Movie browse maximum: 5.07 seconds.
- Direct Movie card maximum: 12.97 seconds.
- `ApiClient` Movie browse maximum: 8.82 seconds.
- `ApiClient` Views maximum: 22.03 seconds.

The variability moves between direct, browser, and `ApiClient` samples. That,
combined with time-before-headers dominance, is consistent with Jellyfin-side
execution, database/disk contention, request scheduling, or upstream host load.
It is not enough to identify a specific database plan or installed plugin as
the root cause.

The local PiggieTV companion-plugin source does not intercept Jellyfin's core
`Users/{user}/Items` or Resume routes. The targeted source scan found only a PTV
image endpoint string. Other installed plugins, Jellyfin logs, database lock or
WAL state, query plans, host CPU/disk pressure, and reverse-proxy timing were not
available from the dedicated non-administrator browser session. No claims are
made about those unobserved layers.

## Validation

- Focused item/home tests: 10 of 10 passed.
- Full unit suite: 91 files and 617 tests passed.
- TypeScript `build:check`: passed.
- Production Webpack: passed in 90.764 seconds with the two established size
  warnings.
- Corrected route trace: 70 cards, 0 duplicate contracts, 0 stale hydration,
  peak concurrency 4.
- First unchanged interaction run: 7 of 13 passed.
- Warm unchanged interaction run: 3 of 13 passed.
- Changed-file ESLint exposed the legacy `hooks.ts` file baseline of 19 errors;
  `items.ts` had two existing sort warnings. No clean lint claim is made.

The requested cold/warm discovery pair could not be completed. Enabling the
non-destructive HTTP cold-cache profile required a page reload, after which the
dedicated browser did not restore an authenticated `ApiClient`. The discovery
harness correctly stopped before writing a report. No alternate account or
credential was substituted.

Physical webOS validation was not performed.

## Artifacts

- `test-results/authenticated-discovery/items-latency-profile-baseline-quick.json`
- `test-results/authenticated-discovery/items-latency-profile-baseline-browser-full.json`
- `test-results/authenticated-discovery/items-latency-profile-baseline-paths.json`
- `test-results/authenticated-discovery/items-route-fanout-after.json`
- `test-results/authenticated-discovery/items-latency-profile-after-movie-browse-full.json`
- `test-results/authenticated-discovery/items-latency-profile-after-browser-quick.json`
- `test-results/authenticated-discovery/items-latency-profile-after-paths.json`
- `test-results/authenticated-discovery/interaction-report-items-pipeline-after.json`
- `test-results/authenticated-discovery/interaction-report-items-pipeline-warm.json`

The original discovery baseline and the earlier blocked interaction artifact
remain unchanged.

## Required next work

1. Sign the same dedicated non-administrator account back into the existing
   browser; do not substitute another identity.
2. With read-only administrator/host access, correlate one slow request ID and
   timestamp with Jellyfin logs, CPU, disk latency, database lock/WAL state, and
   reverse-proxy timing.
3. Capture query plans for representative `Items` shapes before proposing any
   index, database, plugin, or storage change. Such changes require explicit
   approval and rollback plans.
4. Isolate non-PTV installed plugins only in a controlled maintenance window if
   log evidence points to an interceptor or scheduled task.
5. Require the unchanged interaction suite to pass 13 of 13, then produce valid
   cold-transport and warm discovery artifacts.
6. Complete physical webOS verification before changing the release decision.
## 2026-07-21 Reauthenticated continuation and ItemFields correction

The same non-admin account was restored and the unchanged interaction matrix
improved to 12/13 on two consecutive runs. The first run retained cards but did
not move focus through the Fire TV directional sequence; the warm repeat timed
out waiting for the Movie cards used by that scenario. The strict 13/13 release
gate therefore remains unmet.

The first warm route discovery passed 22/23. Preferences retained the expected
hash, one shell, zero overflow, zero unnamed controls, and no functional
console, request, response, or page errors, but its required heading/content did
not appear within the unchanged route window.

The subsequent cache-disabled reload initially preserved authentication, but
Webpack Dev Server injected `#webpack-dev-server-client-overlay`. Although the
iframe was not a PiggieTV surface, its viewport width exceeded the document
client width by the scrollbar width and made every affected route appear to
overflow. Removing only that iframe restored exact horizontal fit. The cold and
warm-final reports produced while it existed are diagnostic artifacts, not
valid layout evidence. A clean retry was then blocked when a second reload
nondeterministically cleared the same account's authentication.

Jellyfin server output supplied after that retry provides concrete backend
evidence: request model binding threw `System.FormatException` because
`UserData` is not a valid `ItemFields` value. PiggieTV had included that token
in shared card/playback/collection/music profiles and in Books, Music, and
recommendation field lists. Those request lists now omit `UserData`. The
`UserData` payload type, featured-cache compaction, favorites/progress
consumers, and Jellyfin `EnableUserData` semantics are unchanged.

This correction removes a proven invalid request contract but does not by
itself explain or clear the previously measured slow successful requests, whose
time before headers remained nondeterministic. No post-correction authenticated
validation has run yet. Require absence of the conversion exception, unchanged
13/13 interactions, clean cold/warm discovery, and physical webOS evidence
before changing the release decision.
## 2026-07-21 Post-correction authenticated result

After the dedicated user signed in again, live Resource Timing evidence covered
44 recent `Items` requests. Zero request `Fields` parameters contained
`UserData`; 18 entries exposed HTTP 200 and none exposed an error status. This
validates the frontend request-contract correction. Server-log access was not
available to independently prove that no later conversion exception was
written.

The unchanged interaction matrix passed 11/13, failing watched-state completion
and Movie-card availability for the TV-focus scenario. Its unchanged warm
repeat took 222.9 seconds and passed 5/13, with timeouts spanning protected
endpoint probes, Movies/details state, playback continuation, and focus-card
availability. This is worse than the required 13/13 and confirms that removing
the invalid field did not eliminate the nondeterministic remote completion
tail.

The clean warm discovery passed 21/23. Every responsive profile passed with one
shell and no horizontal overflow. Reading Books failed on six functional
request failures; Preferences had one shell, no overflow, no unnamed controls,
and no runtime/response/page errors, but its heading and required content did
not appear inside the fixed route window.

For the final cold attempt, browser cache was cleared/disabled and an init-time
observer removed only the Webpack Dev Server overlay iframe. The overlay stayed
absent and geometry stayed clean, but the same API client did not restore
authentication within 30 seconds. Cache mode was returned to normal. No clean
cold discovery artifact was produced, and no identity substitution was used.

No unit, type, lint, or production-build command was rerun after the four-list
`UserData` removal. Earlier focused 10/10, full 617-test, TypeScript, and
production-build results predate that final compatibility edit. Release remains
blocked pending clean local gates, same-account 13/13 interactions, authoritative
cold/warm discovery, server/host evidence, and physical webOS testing.
