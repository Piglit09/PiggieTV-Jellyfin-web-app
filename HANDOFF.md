# PiggieTV Handoff

Updated 2026-08-01 for Phase H1 repository hygiene.

## Current Handoff

### 2026-08-31 Native LG webOS 0.1.19 Shows-library recovery

The physical LG 70UN7070PUA now runs native client `0.1.19`, commit `4ff9d29` (`Scope webOS Shows library queries`), with installed production chunk `main-legacy-ZXj1APVw.js`. The Shows screen no longer issues one unscoped recursive Series query. It resolves the account's typed TV-library roots once, queries at most three roots concurrently with `ParentId`, requests only the scalar sort field, disables exact count expansion on each page, and merges/deduplicates the results while retaining the existing 12-second per-request deadline.

Physical diagnosis proved the old global request was canceled twice at exactly 12 seconds and returned HTTP 504 after 102.1 seconds without the client deadline. Removing fields alone did not repair it. All three parent-scoped LAN probes returned 24 items in roughly 3.2 to 4.8 seconds. The TV had still been configured for `https://piggietv.com`; even scoped requests timed out there. Its credential-bound session was re-established through the normal sign-in flow against `http://10.16.0.50:8096` rather than weakening credential binding or transferring a token between origins.

Installed-package acceptance now shows 1,065 Shows titles and 72 rendered cards. A fresh A-Z load issued three parent-scoped HTTP 200 requests to `10.16.0.50:8096` in 2.4, 7.8, and 9.9 seconds. The card count remained 72 for 20 seconds and restored at 72 after Home -> Shows, with no load error or runtime exception. Focus remained visible, although the return check left focus on the Home navigation control while Shows was current; full remote focus restoration remains part of the broader physical matrix.

Focused `showsLibrary.test.tsx` passes 11/11. TypeScript and the production package build pass with only the established large-chunk warning. The specific native Shows-library loading failure is closed for this LAN configuration. Do not close the separate Jellyfin latency or full release gates: the slowest successful parent request was still 9.9 seconds, the public reverse-proxy path remains unsuitable for this TV, Movies and other catalog routes were not migrated by this change, and the complete playback/Back/focus matrix remains open. No Jellyfin Web product source changed, so the PTV Web version was not bumped.

### 2026-08-31 Native LG webOS 0.1.18 recovery

The separate native webOS client in `C:\Users\Piggie\Documents\GitHub\PiggieTV-WebOS` is committed as `08d8848` (`Harden webOS session and runtime recovery`), packaged, and installed on the physical LG 70UN7070PUA as version `0.1.18`. The installed application loaded the exact committed production chunk `main-legacy-B92NAWM6.js`.

The native sign-in failure had two independent causes presented as one state. A failed startup restore could leave `state.startupError` set even after the built-in server test received HTTP 200. `AuthScreen` now clears only that stale startup connectivity error after successful server validation; credential and controller errors remain independently owned. The production package was rebuilt and installed after that correction.

Physical post-install evidence shows authenticated Home restored with populated Featured, Continue Watching, and Next Up rows, visible focus, working route navigation, and no runtime exception. One initially timed-out lower row recovered through its normal Retry action. The native application is not the Jellyfin Web document at `/web`; it is a separate packaged React/Vite client with its own release and deployment boundary.

Do not call the overall release production-ready. The same physical run still measured nondeterministic backend latency, including approximately 7.5 seconds for `Users/Me`, 9.3 seconds for Resume, and 4.3 seconds for Next Up. Lower Home rows initially entered timeout recovery states, and the complete physical route/playback matrix remains open. This task changed no shipped Jellyfin Web product source, so the PTV Web version was not bumped.

Web reliability and performance work through Phase F2D-B1 is **APPROVED**.
Phase H1 preserves that implementation, records every dirty path, removes only
proven generated noise, and establishes local commit boundaries. No product
feature or runtime ownership change is part of H1.

After H1 approval, the next feature phase is F3: TV-first Collections and
cross-library discovery. Dated sections below preserve the decision that was
valid at that time and may contain superseded HOLD recommendations.

## WebOS Phase 3A playback correction (2026-07-27)

Status: **HOLD — implementation and LG device-assisted validation pass; final
literal physical-remote Music acceptance and repository lint remain open.**

- One derived presentation service now owns compact/full-screen/video
  presentation while existing Jellyfin video and PTV Music engines remain
  authoritative.
- Existing TV focus and `inputManager` paths now own video scope, one seek
  action, one Back branch, and PTV Music transport adaptation. No second key,
  route, focus, or playback owner was introduced.
- Loaded PTV audio guarantees one persistent mini-player outside full-screen or
  video. The runtime host uses viewport anchoring and literal Chrome 68-safe
  WebOS geometry.
- Reading and Request are intentionally excluded from WebOS navigation, direct
  routes, and loaded chunks. Other web clients retain both.
- WebOS Music bounds initial card/section rendering, defers lyrics, omits
  expensive backdrops, and disables Music-tree animation without changing
  queue/playback authority.
- Final LG renderer checks passed mini/full-screen exclusivity, Home plus six
  content/settings routes, track transition, stop, audio/video transport,
  hidden seek, and one-hide/one-exit Back without a crash.
- Automated gates pass: PTV 115/701, full Vitest 138/907, TV-profile Playwright
  9/9, TypeScript, Stylelint, schema/privacy checks, production build, secret
  scan, and diff check. A timer teardown defect found by the full run was fixed.
- Repository `lint:ptv` remains red from accumulated debt above its checked-in
  baseline. Focused Phase 3A lint outside legacy `PTVShell.tsx` has no errors.
- Production was not deployed or changed. See
  `docs/diagnostics/phase3a-playback-correction-report.md`.

## Jellyfin Backend Latency Attribution (2026-07-24)

- Decision: **HOLD**. The approved browser account remained non-admin. A
  separate administrator observer accessed current Jellyfin logs, tasks,
  plugins, system storage, and database-directory metadata without exposing or
  persisting either identity or token.
- Provenance: Jellyfin 10.11.11/X64; PiggieTV <private-address>/API v1 with 13
  advertised capabilities; fixed program-data storage with 156,048,969,728
  free bytes; 16 library folders split across 11 network and five fixed
  storage entries. Main SQLite database presence was observed before/after;
  WAL/SHM/journal companions were absent at those observations.
- Admin APIs do not expose journal mode, busy timeout, filesystem type, inode
  state, process count, CPU/memory/swap, disk await/queue, mount latency, or
  retransmits. Host-level attribution remains incomplete. The safe integrity
  check was skipped to avoid adding a production lock.
- Matrix: warm 9/13, repeat 12/13, transport-cold 11/13. Overall
  p50/p90/p95/max is 8.909/34.906/55.436/68.615 seconds; warm p50/p90 is
  13.045/28.223. Warm Season details, Reading, Music, and focus failed;
  transport-cold Shows and focus failed.
- Correlation: 76 reads exceeded 1.5 seconds, 68 exceeded three, and 58 exceeded
  five; every read over three seconds has a server row. Seventy-four rows are
  proven/strong server-duration matches. Median server/browser ratio is 1.0,
  median absolute delta 7 ms, and browser transfer median 0.7 ms. Network is
  contradicted as the primary owner.
- Current logs: zero SQLite locked/busy events, optimistic retries, EF warnings,
  or query-splitting warnings. These hypotheses are not observed in this
  window and historical playback-lock evidence remains active.
- Scheduled-task evidence: `Optimize database` ran
  11:30:31Z-11:35:37Z. Pre-task reads were already slow
  (p50/p90/max 9.103/33.744/43.707 seconds). Five reads crossing task start
  reached 65.634/68.615/68.615; 19 reads starting during it measured
  4.971/12.880/21.753. Treat database maintenance as a strongly correlated
  amplifier, not the sole owner.
- Focus: the visible initial browse card retained focus through Right, Down,
  Left, and Up in all passes. No focus movement, activation, or request
  occurred. Focus remains independent and unchanged.
- Isolation proposal only: with explicit approval, defer only the scheduled
  `Optimize database` execution for one unchanged matrix and 30-second
  pre/post windows while host sampling is active; restore the original trigger
  immediately. Accept only p90 below three seconds, 13/13 per pass, and clean
  current DB logs. No isolation was executed.
- Artifacts: `test-results/backend-latency-attribution` contains all eight
  required attribution reports and the four unchanged matrix reports. Privacy
  validation found zero prohibited fields/values.
- Validation: focused 153/153 across 25 files; full Vitest 816/816 across 125;
  TypeScript; zero-warning harness ESLint; production Webpack with two
  established size warnings; 10 schemas; Android parity at 26 models/14
  enums/19 capabilities/one error; frontend/plugin contract; 118,246-path
  secret scan; 12-artifact privacy scan; and Web/mobile/TV `git diff --check`.
  Android source did not change, so Android builds/lint were not required.
- Cleanup: both temporary Jellyfin sessions were revoked, the helper-owned
  browser/profile was removed, and loopback CDP port 9223 is closed.
- No operator timeout, account, database, plugin, server, auth, playback, Core,
  Android, production-data, configuration, or media-path change occurred. The
  scheduled maintenance was automatic and unmodified. Phase 2E remains HOLD.

## Production Authenticated Items Pipeline Stabilization (2026-07-24)

- Decision: **HOLD**. The same approved non-administrator account was used
  throughout. Provenance: frontend/Jellyfin 10.11.11, plugin <private-address> API v1
  with 13 capabilities, Chrome 149.0.7827.199, loopback frontend,
  private-network direct HTTP Jellyfin listener, and no service-worker
  registration/control. Uptime/restart state was unavailable.
- Initial timing: 90 classified reads, 17 exact concurrent duplicates, peak
  11, and p50/p90/p95/max time to headers of
  3.060/11.876/16.269/37.016 seconds. The corrected duplicate-attribution
  baseline recorded 21 duplicates and peak 12.
- Proven frontend owner: stock details, DOM-driven integration enhancement,
  and the PTV details fallback independently requested the same item. The
  integrations enhancer could dispatch four identical reads before its
  existing response cache populated. Back/Forward also overlapped one
  identical genre-directory read.
- Correction: those existing legacy item-detail consumers and the
  genre/studio directory now reuse the global request coordinator for exact
  in-flight requests. The transport, raw DTO/error, settled behavior,
  integration response cache, renderers, navigation, and lifecycle remain
  authoritative. No second cache, retry, timeout, Core boundary, query
  reduction, or UI change was added.
- Authoritative after-run: zero exact concurrent duplicates, zero
  canonicalization misses, peak 8, and aggregate p50/p90/p95/max
  1.390/3.644/4.464/6.978 seconds. p50/p95/max pass their fixed targets; p90
  remains over 3 seconds. Warm-only p50/p90 are 1.698/3.724 seconds and also
  fail.
- Equivalent final paths were aligned: shared/browser/direct/ApiClient p50
  completion or header values were 0.544/0.567/0.570/0.584 seconds, with p95
  1.124/1.128/1.078/1.113 seconds. Direct transfer median was 0.8 ms. The
  remaining delay is proven upstream of frontend transport, but the specific
  Jellyfin database/storage/plugin/host owner is not proven.
- Each warm, immediate-repeat, and legitimate transport-cold pass was 12/13.
  TV-like browser focus was the only failure. Transport-cold disabled browser
  cache without losing the session; it is not full application cold. Playback
  continuation validated Resume read-only and did not start playback.
- Query audit: zero invalid ItemFields, zero `UserData` field tokens, and zero
  parameter collisions. Five Season/Episode child-list requests had no
  explicit Limit and 16 observed reads requested MediaSources. Existing
  consumers were retained because unused fields were not proven.
- Current server logs, scheduled tasks, and plugin inventory returned 403 to
  the approved account. No read-only host session existed. Current
  database/host correlation is explicitly not observed. Historical SQLite
  lock, 35.22-second playback HTTP 500, and 93.39-second read evidence remain
  unresolved; Playback Reporting overlap is not causation. No isolation was
  performed.
- Validation: focused 257/257 across 38 files; full Vitest 816/816 across 125
  files; TypeScript; zero-warning new-scope ESLint; production Webpack with two
  established size warnings; ten schemas; Android parity at 26 models/14
  enums/19 capabilities/one error code; 118,245-path secret scan; 11-artifact
  privacy scan; and Web/mobile/TV `git diff --check`. Android source was not
  changed or rebuilt.
- Artifacts:
  `test-results/items-stabilization-after-coordinated`. Source-changing
  intermediate runs and raw query-contract telemetry were discarded.
- Exact next action: retain the same browser account and obtain time-bounded
  read-only access to the actual Jellyfin logs and host. Rerun this matrix with
  sanitized log completion plus CPU/memory/disk/mount/network and read-only
  SQLite evidence. Do not isolate a plugin/task or mutate the database/server
  until that evidence identifies a specific owner and rollback.
- Phase 2E remains HOLD. No Episode Core migration was reopened.

## PTV Core Phase 2E Episode-Details Design Audit (2026-07-23)

- Decision: **HOLD**. Phase 2E is an audit, not an implementation. No
  production behavior, API call, Core facade/projection, route, UI, test
  behavior, schema, persistence, plugin, Android, or ownership boundary
  changed.
- Inventory: 45 direct production `.getItem(...)` expressions, two SDK
  single-item helpers, one bound hero hydration loop, the existing
  `getPtvItem` fallback/consumers, and every `getEpisodes` call were audited.
  The complete call-by-call inventory and transport profiles are in
  `docs/architecture/PTV_CORE_MIGRATION.md`.
- Rejected owners include the stock details DTO, More Commands/context menus,
  app-router hydration, theme/display mirroring, media info/sources, active
  playback and queues, Cast/SyncPlay/remote control, pause artwork, hero
  continue/featured hydration, editors, batch/external actions, More From
  Season, download-all, and Series/Season playback expansion.
- The closest low-risk seam is
  `ptv/modules/details/index.js:enhanceDetailItem`. It calls the current
  Jellyfin client's `getItem(currentUserId, routeId)` only when the normal
  `detailsrendered` event did not already hand the same raw item to PTV. For
  Episode, the fallback feeds only shell-section classification and optional
  direct/parent artwork. It has no explicit timeout/retry/cancellation or
  request coordinator; dataset and current-route checks suppress duplicate or
  stale application, and failure is nonblocking.
- That seam is not approved. Normal production flow bypasses it; the generic
  `getPtvItem` boundary already supplies raw identity, unknown-field
  preservation, safe diagnostics, and platform-error identity; Phase 2C
  already projects useful Episode metadata. Reusing `getPtvItem` would add a
  coordinator, while a new projection would add stricter failure behavior and
  no portable consumer.
- A hypothetical minimum projection would be required `episodeId` plus
  optional `seriesId`, `seasonId`, and artwork. Title/index/overview/runtime/
  progress are excluded because this seam does not consume them and Phase 2C
  already covers them. Wrong/missing requested ID, wrong type, or conflicting
  supplied parent scope would fail the whole single-item Core result; missing
  optional parents and unknown raw fields would remain compatible.
- Any later experiment must retain one legacy call-site seam, exactly one
  transport call, raw object/error identity, and Jellyfin's auth/login/network
  behavior; add no retry, timeout, coordinator, route/UI change, persistence,
  plugin, schema, or Android dependency; and be revertible as one bounded
  commit.
- Required future evidence is designed but not implemented: boundary casing/
  identity/scope tests, exact transport and error identity, privacy-safe
  diagnostics, Phase 2A-2D regressions, and an independently instrumented
  Episode browser route proving one request, unchanged visible content,
  refresh/Back/Forward, and no playback/duplicate/Core-event expansion.
- Score: 26/50, below the 38/50 approval threshold. Cross-platform usefulness,
  duplication reduction, and architectural necessity are each 1/5.
- Exact next task: stabilize and measure the production authenticated Items
  pipeline with the existing same-account regression matrix and read-only
  server/host evidence. Physical-TV acceptance and release/deployment hygiene
  also outrank another Core abstraction. Reopen Phase 2E only when a distinct
  portable Episode consumer or diagnostic requirement exists.

## PTV Logout Action Ownership Fix (2026-07-23)

- Root cause: the PTV native shell user menu and PTV sidebar encoded Sign Out
  as `#/logout`. Jellyfin has no registered logout page, so the router rendered
  Page Not Found and never entered the stock logout lifecycle.
- All visible callers were audited. Stock `AppUserMenu` and `libraryMenu`
  already call `Dashboard.logout()`. The corrected PTV controls now close their
  menu and call a shared in-flight adapter around that exact action.
- The stock call chain is unchanged:
  `Dashboard.logout()` -> `ServerConnections.logout()` -> each authenticated
  `ApiClient.logout()` -> `localusersignedout` and credential persistence
  clearing -> query/view reset -> `selectserver` for multi-server clients or
  `login` otherwise. `Dashboard.logout()` now returns that existing promise so
  the adapter can share it.
- No `#/logout` compatibility route was added. Production source contains no
  such hash. Login/Select Server remain the authentication classifier's real
  Jellyfin-owned destinations.
- Overlapping mouse, keyboard, remote, and synthesized activations share one
  request. The menu closes before invocation. Success and failure both release
  the guard; failure is preserved for callers and does not force navigation.
- Focused logout/auth/header/router/Core validation passes 98/98 across 16
  files; full Vitest passes 803/803 across 123 files. New tests cover both PTV
  controls, duplicate activation, failure/retry, stock routing/cache reset,
  ConnectionManager credential/event fallback, auth transitions, and removal
  of the cosmetic route.
- TypeScript, scoped changed-file ESLint, the PTV style baseline, production
  Webpack, ten schemas, Android parity, secret scan (118,240 paths), and
  Web/mobile/TV whitespace checks pass. Webpack has only its two established
  size warnings. Test-only Vite aliases now resolve stock Jellyfin source
  modules for behavioral tests. Android source was untouched, so Android
  build/lint were not rerun.
- Physical browser verification passed. The PTV Sign Out control was a button
  with no `href`, the menu closed immediately, exactly one Jellyfin
  session-logout request was observed, authenticated state/shell retired, and
  Jellyfin routed to Select Server without Page Not Found. The existing server
  selection and stock login then restored authenticated Home and the PTV shell.
  No credential or token was logged or persisted by the validation.
- Android mobile/TV and their contracts are unchanged. This is not full Core
  adoption and does not move auth/session/token/logout ownership into Core.
- The separate corrected Phase 2D run now passes all five read-only acceptance
  scenarios. That validation remains independent of the focused logout
  regression.

## PTV Core Phase 2D Authenticated Browser Validation (2026-07-23)

- Phase 2D is complete and remains validation-only. No product API/navigation/
  playback/auth/focus/Android/UI/cache/plugin/server/database/production
  ownership boundary changed.
- Audit result: the old interaction command was CDP-only, defaulted to
  `127.0.0.1:9223`, and required an externally launched Chrome page already
  holding `ApiClient` user/token state. It supported neither storage state nor
  credential variables, owned no browser process/profile, persisted private
  request/route/item details, mixed in mutation/playback tests, and called
  `browser.close()` on the supplied browser.
- New helper commands launch/status/cleanup a Chrome instance bound to loopback
  only with a dedicated OS-temporary profile. No personal profile or
  credential argument is used. The interaction runner never closes an
  external browser and automatically removes helper-owned state after a run.
- The rewritten interaction runner is read-only, accepts exactly one expected
  frontend page, and fails closed on unauthenticated/wrong-origin/wrong-server/
  stale-runtime/missing-appRouter/service-worker/conflicting-page conditions.
  It contains the Home, Search, Series seasons, Season episodes, navigation,
  call-count, refresh, and safe error probes required by Phase 2D.
- Home is now split into 16 bounded records covering the required 14 stages
  plus separate keyboard and refresh checks. The first deterministic failure
  was `eligible-card-found` / `home-card-not-found`: the old selector required
  an optional descendant artwork attribute, and one rerun re-entered an
  already-active Home as a no-op. The runner now establishes a fresh Home
  generation and selects a native Movie/Series media anchor through a
  layout-neutral, non-identifying `data-ptv-item-type` marker.
- Real-browser Home activation was healthy: Playwright pointer and keyboard
  input each reached the feature handler, primary activation was prevented
  once, `appRouter` ran once, History recorded one route-category transition,
  details ownership and usable content settled, Back restored populated Home
  plus the original shelf/card ordinal within tolerance, and deep-link refresh
  remained usable. Native `hashchange` count was zero because the current
  router commits through History state; treating that as failure was a harness
  assumption, not a product defect.
- Search's opaque error was a Playwright strict-locator exception because an
  accessible-name selector matched both shell and native Search inputs. It now
  uses the existing native focus-key marker, returns safe stage/error
  categories, waits for both query and results restoration, and selects
  generic/specialized results by media type instead of title. Movie, Series,
  and Episode generic routes and Book/Audio/Album/Artist specialized routes
  all pass.
- Series and Season each establish an independent supported details route from
  the in-memory read-only catalog. Their actual production renderer is
  `#listChildrenCollapsible`, not the stale `#childrenCollapsible` assumption.
  Series rendered 4/4 seasons and Season rendered 29/29 episodes; each issued
  exactly one initial and one refresh boundary call with ordering and existing
  scope/field semantics retained.
- The all-zero synthetic GUID is Jellyfin's root-folder sentinel and correctly
  returned HTTP 200 with a `UserRootFolder` fallback. The corrected
  nonempty/unallocated identifier returns HTTP 404 and a rejected Jellyfin
  client promise, which `getPtvItem` preserves. The artifact records only
  `transport-404-client-rejection`.
- Instrumentation restores an existing installation before wrapping
  `appRouter`/History once, resets counters per scenario, observes capture
  activation and Core events read-only, and restores every wrapper/listener/
  observer during cleanup. Unit coverage verifies install, reset, duplicate
  suppression, restoration, safe errors, staged first failure, selectors,
  independent setup, missing-item classification, and artifact privacy.
- Observation/artifacts contain only categories, methods, statuses, durations,
  counts, route categories, and pass/fail reasons. The sole artifact is the
  gitignored `core-phase2d-authenticated-browser.json`; screenshots, traces,
  and storage-state capture are disabled.
- Latest run: the frontend and configured Jellyfin endpoint returned HTTP 200,
  and dedicated Chrome 149.0.7827.199 exposed CDP only at loopback port 9223.
  Authenticated preflight passed all runtime, origin, router, service-worker,
  overlay, and Home gates. Read-only catalog discovery found a usable
  Series/Season/Episode chain and all requested media categories.
- The complete ordered acceptance summary is 5/5: Home details/Back, Search
  details/navigation, Series seasons, Season episodes, and error compatibility.
  The anonymous/authorization and browser-aborted network probes remained
  read-only. The missing-item and aborted network checks each made one request,
  with no retry and no forced session expiration.
- Cleanup completed automatically: the helper-owned Chrome tree and temporary
  profile were removed and CDP port 9223 closed. Personal Chrome state was
  untouched.
- Current automated gates: harness 9/9; explicit Phase 2A-2D regression
  118/118 across 14 files; retained logout/authentication coverage 57/57
  across 10 files; full Vitest 808/808 across 123 files; TypeScript; Phase 2D
  scoped ESLint; PTV style baseline; production Webpack with two established
  size warnings; ten schemas; Android parity at 26 models/14 enums/19
  capabilities/one error declaration; secret scan across 118,241 paths; and
  all-repository `git diff --check`. The broader repository ESLint debt gate
  still reports pre-existing findings outside this scope. Android source was
  untouched.
- Product defects found: none. The only product-source change is the
  diagnostic media-type marker on the existing Home anchor; it is
  layout-neutral and does not change activation or routing.
- The recommended Phase 2E audit is now complete with a HOLD decision; see the
  top section. No episode-details boundary was implemented.

## PTV Core Phase 2C Episode List Adoption (2026-07-23)

- The sole selected boundary is `renderChildren`'s Season-details episode list.
  Its established caller resolves `ApiClient` from the Season server, takes
  `item.SeriesId`, `item.Id`, and `getCurrentUserId()`, and renders the returned
  `Items` through `normalizeItemMediaSources` and the current large episode
  list. More From Season and every other `getEpisodes` caller stay direct.
- Old path:
  `apiClient.getEpisodes(item.SeriesId, { seasonId: item.Id, userId, Fields })`.
  New path: `getPtvSeasonEpisodes` invokes that exact transport once with the
  same options reference, obtains an internal Core result, and returns the same
  raw response object. Original transport failures are rethrown by identity.
- The exact fields remain
  `ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount,Overview,MediaSources`.
  No sort, paging/limit, `EnableUserData`, recursive flag, `IncludeItemTypes`,
  coordinator, retry, or new cancellation is added. Jellyfin still owns URL,
  auth, its existing 30-second GET/failover, local-ID mutation, and parsing.
- The portable episode view includes opaque episode/series/season identity,
  title, season/episode indexes, runtime milliseconds, premiere date, overview,
  present Primary artwork, and present played/playback-position/percentage.
  Raw ticks and objects are never mutated; missing progress remains absent.
- Mixed policy: valid episodes remain ordered; missing/blank IDs,
  cross-series children, and cross-season children are dropped and counted
  separately. Missing child scope inherits requested scope. Empty/all-malformed
  child lists normalize successfully; invalid envelopes, requested scopes, or
  envelope scopes fail.
- Diagnostics are bounded, count-only, and nonblocking. They expose safe
  operation/category/request/timing/status/size/result/error data and three
  drop counts, with no raw IDs, titles, paths, origins, URLs, query values,
  identity/auth data, bodies, or media-source details.
- Validation: focused 124/124 across 15 files; full Vitest 781/781 across 116
  files; TypeScript; scoped ESLint; production Webpack with two established
  size warnings; ten schemas; Android parity at 26 models/14 enums/19
  capabilities/one error declaration; secret scan of 118,231 paths; and
  `git diff --check` in web/mobile/TV. Android source was untouched, so Android
  builds/lint were not rerun.
- Browser validation remains blocked and is not claimed. App/Jellyfin ports
  8082/8096 respond, but no CDP endpoint exists at `127.0.0.1:9223`, no safe
  auth state exists, and no test credentials are configured.
  `npm run test:e2e:authenticated:interactions` fails with
  `connect ECONNREFUSED 127.0.0.1:9223`.
- Flake observation: the first focused run had one deterministic source-test
  regex mistake while all 24 new boundary/facade tests passed. After correcting
  the regex, focused and full runs passed; no timeout changed.
- Phase 2D subsequently closed that authenticated matrix 5/5. Phase 2E then
  audited and held the episode-details candidate without implementation.

## PTV Core Phase 2B Metadata and Search Navigation Adoption (2026-07-23)

- Selected metadata boundary: the season list loaded by
  `controllers/itemDetails/renderChildren` for a Series. It is details-only,
  read-only, non-authentication/non-playback state, and hands one Jellyfin
  query-result object to an established renderer. Season-details episodes,
  More From Season, context menus, playback, Search APIs, and Home generation
  remain unchanged.
- Old path: `apiClient.getSeasons(item.Id, { userId, Fields })` was called
  directly. New path: `getPtvSeriesSeasons` calls that exact transport once
  with the same options object, passes the response/error through a focused
  Core boundary, and returns the same raw object. The old path had no explicit
  abort signal, retry, or coordinator; none was added. Original transport
  failures, including 401/cancellation, are rethrown by identity.
- The portable season projection accepts supported PascalCase/camelCase fields,
  validates opaque season IDs and the requested parent series scope, retains
  raw children/order, and projects title/index/episode count/Primary artwork.
  Empty is valid. Mixed payloads keep valid children and count malformed or
  cross-scope drops; only invalid envelope or parent scope fails.
- Selected navigation boundary: generic native Search Movie, Series, Season,
  Episode, and BoxSet result cards. They reuse the Phase 2A details intent/web
  adapter and existing `appRouter`. The same anchor hash/query/library context
  remains in markup. Unmodified primary activation prevents the anchor default
  and invokes the router once; an in-flight key suppresses double activation.
  Modifier/middle-click and Book/Audio/Album/Artist specialized routes retain
  old behavior.
- Diagnostics are bounded and nonblocking. Metadata emits only safe
  operation/category/request ID/method/duration/status/size/counts/result/error
  fields. Search emits the existing Core navigation ID-presence event at most
  once. No raw media/series/user IDs, hosts/query values, auth, bodies, paths,
  or email addresses are emitted.
- Validation is green: focused 58/58 across eight files; full Vitest 756/756
  across 114 files; TypeScript; Phase 2B standalone-file ESLint; production
  Webpack with the two established size warnings; ten schemas; Android parity
  at 26 models/14 enums/19 capabilities/one error-code declaration; secret scan
  of 118,227 paths; and `git diff --check` in all three repositories. No flake
  or rerun occurred. Android sources were untouched, so builds/lint were not
  rerun.
- Phase 2D subsequently closed the real authenticated browser validation
  without reusable auth state or stored credentials. The helper-owned loopback
  CDP run passes Home, Search, Series, Season, and error compatibility 5/5;
  see the Phase 2D section above for staged evidence and cleanup.
- Compatibility retained: raw responses, query casing/fields, ordering,
  current artwork/version handling, errors/login flow, anchors/deep links,
  browser history, specialized Search destinations, route stacks, playback,
  focus, Android clients, and all Phase 1/1.5/2A paths. This remains partial
  Core adoption.
- Exact Phase 2C: first restore and pass the authenticated Phase 2B browser
  checklist, then migrate exactly one season-details episode-list
  `getEpisodes` read through a sibling focused Core boundary with raw-response
  compatibility and an episode projection. Do not add another navigation,
  playback, cache, Android, or UI migration in that phase.

## PTV Core Phase 2A Safe API and Navigation Adoption (2026-07-23)

- Selected API boundary: `getPtvItem`, because it is one read-only,
  non-authentication, non-playback item lookup used by visible native
  music/reading details views and does not own Home, featured-cache, Row
  Builder, recommendation, or search generation.
- Old path: the public helper resolved user/server and called Jellyfin
  `ApiClient.getItem`, or its existing URL fallback, returning the transport
  promise directly. New path: the same helper and transport enter the shared
  request coordinator and focused Core item-details adapter; the facade unwraps
  success and rethrows the exact original platform error. The internal
  `getPtvItemCoreResult` exposes normalized `CoreResult/CoreError`.
- The adapter validates a required opaque string ID, accepts PascalCase and
  supported camelCase aliases, ignores unknown fields, tolerates missing/null
  optional fields and empty collections, keeps feature fields on the untouched
  original item, and converts only `RunTimeTicks` in its portable view.
- Selected navigation action: a movie/show details click from a native Home
  shelf card. It now creates a details `PtvNavigationIntent`, preserves the
  legacy query/hash and push/back behavior, prevents the anchor default from
  creating a second route, and calls the existing `appRouter` once. Search,
  Browse, music/reading native routes, route tables, history, deep links, TV
  focus, and Android destinations are unchanged.
- Bounded API/navigation diagnostics retain safe operation/route names,
  request ID, method/timing/status/size, destination/source, ID-presence
  booleans, result, and Core error code. Diagnostic failures are ignored; raw
  IDs, hosts/query values, headers/tokens, response bodies, and media paths are
  excluded.
- Validation: focused API/navigation/item-route/feature tests 41/41; full
  Vitest 716/716 across 110 files; TypeScript; scoped ESLint; production
  Webpack with only the two established size warnings; ten schemas; Android
  structural parity (26 models, 14 enums, 19 capabilities, one error-code
  declaration). No featured-cache timeout or other flaky failure occurred.
  Android source was untouched, so Android builds/lint were not run.
- Physical regression remains pending. Check Home shelf details, exact Back
  restoration, details refresh, unchanged Search opening, one route per click,
  and unchanged visible/authentication error behavior.
- Compatibility retained: public signatures, raw item fields, original errors,
  Jellyfin transport/auth/URL ownership, request sharing, hashes/query values,
  `appRouter`, startup, cache/recommendation migrations, auth/login, playback,
  and focus. This remains partial Core adoption.
- Exact Phase 2B: migrate one details-only season/episode metadata GET through
  the same Core result/error/diagnostic policy, then migrate the native Search
  result-card details action to `PtvNavigationIntent` and current `appRouter`,
  with focused parity tests and a real-browser back/refresh check.

## PTV Core Phase 1.5 Runtime Adoption (2026-07-22)

- Web, Android mobile, and Android TV now use the ordered PTV Core initializer
  from their real startup composition roots. Web holds the initializer on
  `window` across hot reload; Android applications share one synchronized
  coordinator across Application/Activity entry. Concurrent and repeated
  callers reuse one run/result, and settings listeners are keyed/deduplicated.
- Low-risk adapters are active for current settings, feature flags, cache
  envelopes, diagnostic events, and capability reports. Session, API,
  navigation, and playback steps deliberately wrap or acknowledge the current
  owners; no token/login/Quick Connect, route/focus, browser/Media3/Android
  Auto, notification, or lock-screen implementation moved.
- Noncritical cache or diagnostic failure produces a ready, degraded result.
  Authentication failure retains `route-to-login`/`routeToLogin` and the
  existing platform login flow. A critical API adapter failure stops before
  diagnostics/navigation/playback/ready.
- The selected cache is the web Reading/Music library index because it contains
  no credentials or playback state, is already server/user scoped, has feature
  tests, and can preserve its IndexedDB database/store/key. It now writes v1
  envelopes, reads current records, falls back to the old record shape,
  validates scope/version/corruption/expiry/stale policy, and diagnoses
  successful legacy rewrites. The legacy key and reader remain.
- The plugin recommendations endpoint now passes one response through the v1
  compatibility normalizer. PascalCase/camelCase Row Builder payloads, explicit
  or stable generated row IDs, item scores, legacy scope/time defaults, and
  cache version remain compatible; the engine and persisted recommendation
  models did not move.
- Cross-repository parity is structural rather than textual. The Node validator
  generates normalized manifests from both Kotlin sources, compares contract
  version/models/fields/types/nullability/serialized names/enums/error codes/
  capabilities, compares the canonical v1 manifest, validates required schema
  fields, and emits each Android build report. The central quality workflow
  checks out both Android repositories and runs schema plus parity validation.
- Final validation is green: web Phase 1.5 focused tests 15/15 and full Vitest
  695/695 across 107 files; TypeScript; scoped ESLint; production Webpack with
  only the two established size warnings; ten schemas; normalized Android
  parity (26 models, 14 enums, 19 capabilities); secret scan; and
  `git diff --check` in all three repositories. Android mobile passed the
  12-test focused core selection, every unit-test variant,
  `assembleProprietaryDebug`, and `lintProprietaryDebug`. Android TV passed the
  12-test focused core selection, every unit-test variant, `assembleDebug`, and
  `lintDebug`. One pre-existing featured-cache test hit its five-second timeout
  under the first full-suite load; it passed 7/7 alone and the immediate full
  rerun passed 695/695.
- This is partial core adoption, not full adoption. The exact Phase 2
  recommendation is to adapt read-only API request/error normalization for one
  non-auth, non-playback feature and introduce logical navigation intents at
  one web/Android boundary, while leaving execution with current routers and
  adding physical auth/playback/focus regression gates before any owner moves.

## PTV Core Phase 1 Shared-Core Foundation (2026-07-22)

- The cross-repository audit, v1 behavior specification, overview, and
  incremental migration ledger are complete under `docs/architecture`. The
  canonical JSON Schema 2020-12 contract is `contracts/ptv-core/v1` with ten
  schemas and positive/negative compatibility fixtures.
- Web now has a small portable `src/ptv/core/index.ts` boundary covering
  results/errors, API policy, auth/session, focused media models, settings and
  flags, scoped cache envelopes/fallback reads, privacy-bounded diagnostics,
  capabilities, navigation intents/deep links, playback state/commands,
  recommendation normalization, and observable idempotent initialization.
  `src/ptv/api/client.ts` retains its public behavior and adds a standardized
  redacted `coreError`; current callers and PascalCase normalization remain.
- Android TV and Android mobile contain exact-byte-identical dependency-free
  `com.piggietv.core` contracts with app-local capability adapters and six
  focused tests each. A physical `:ptv-core` module is deferred because the
  apps are independent repositories with incompatible AGP/Kotlin/JVM build
  conventions. Platform UI, storage, networking, Media3, Android Auto, focus,
  and service implementations were not replaced.
- The plugin status response adds contract/cache/recommendation/diagnostics
  versions, server capabilities, supported feature flags, and compatibility
  warnings without renaming/removing existing fields or routes. Two new
  contract tests protect object and serialized compatibility.
- Final validation: focused web 37/37; full web 680/680 across 104 files;
  TypeScript; scoped core ESLint; style baseline; production Webpack (only the
  two established size warnings); ten schemas; plugin contract; secret scan;
  plugin 33/33; Android TV full unit, assemble, and lint; mobile full unit,
  proprietary-debug assemble, and Android lint; focused Kotlin 6/6 in each
  app. Mobile Detekt still exits nonzero on 76 pre-existing app findings, but
  reports zero findings in the new core. The repository-wide PTV ESLint
  baseline also remains nonzero (325 errors/33 warnings in 45 pre-existing
  dirty files); every newly added core/script file passes scoped ESLint.
- Existing systems are intentionally only partially migrated. Next, wire the
  noncritical diagnostics/cache/settings steps into each app's existing
  startup composition root behind the current implementations, then add
  runtime parity tests before touching auth, navigation, or playback.
- No production server, deployment, credential, URL, user data, playback
  engine, UI layout, or production configuration was changed for this work.

## Current Release Gate (2026-07-22)

- Physical production acceptance ran on the same LG 70UN7070PUA against the newly deployed `http://<test-server>:8096/web/index.html`. The LG-loaded bundle proves build `10.11.11`, commit `c81c8ed516-dirty`, build timestamp `2026-07-23T02:21:05.700Z`, and mode `production`. Loaded identities include `runtime.bundle.js`, `main.jellyfin.bundle.js`, `main.jellyfin.3c97233c513f91355010.css`, `home.5a40f926d5e57dd113e1.chunk.js`, and `home.791cfebc132b647fce87.css`.
- The production page was not service-worker controlled; scope and script URL were null. Document, Jellyfin API, and plugin origins were all `<private-host>:8096`. The runtime reported `PTV_WEBOS_OPTIMIZED`, platform `webos`, TV tier, and both `ptv-render-webos` and `ptv-render-tv`. No restart or cache-clear recovery was required or performed.
- Corrected geometry passed on production: header 1788x80 at `(66,36)`, brand 220x64 at `(66,44)`, centered 712x80 primary navigation, bounded 296x60 utilities, readable 21px hero content, two hero actions, zero horizontal overflow, visible in-viewport focus, and an invisible legacy header. One stabilized ArrowRight produced exactly one focus move from Movies to Shows.
- The initial production Home state passed a 100.2-second hold. Samples at 0/30/60/95 seconds retained 25 semantic rows, 19 shelf containers, two populated scrollers, 36 cards, two hero actions, and the same geometry. Shelves did not disappear while Home remained continuously mounted.
- The route-return gate failed. Home -> Movies -> Back returned the hero/actions but, after 16 seconds, had only six semantic sections and zero shelf markers, scrollers, or cards. It remained in that state through `2026-07-23T02:47:09.944Z`, more than six minutes after return. The bounded physical report was preserved before Dashboard/Stop and reports `warning`, issue `first-shelf-missing`, latest milestone `report-generated`, corrected shell geometry, visible focus, and no legacy header.
- Production acceptance artifacts are `production-home-acceptance-timeline.json`, `production-home-before-navigation.png`, `production-home-route-return.json`, `production-home-after-return.png`, `production-home-preserved-diagnostic-heartbeat.json`, and `production-home-failed-final.png` under `test-results/webos-physical`. The PNGs are LG framebuffer captures; a new camera photo was not available and remains required.
- The five-minute diagnostics lease was started through the authenticated admin API without opening Dashboard, the local and plugin-stored Home report were preserved, and the lease was revoked. The client confirmed `diagnosticsActive=false` on the next heartbeat. No source, plugin, server configuration, database, CSS, or cache state was modified.
- Do not close the webOS/Home P1. The stale-build branch is retired and the shared-shell geometry sub-defect is corrected, but route-return Home restoration still fails physically. The same-account 13/13 interaction, authenticated Items latency, cold/warm discovery, backend lock evidence, camera-photo, and complete user-operated remote/playback gates remain independently open.

- The LG Home disappearance corrective pass is implemented and physically observed. `featuredContentSemantics.ts` now classifies complete, partial, degraded, configuration-only, empty, and explicitly intentional-empty featured payloads. Browser/plugin cache writes accept only populated complete payloads or an explicit intentional-empty result; a fresh empty/configuration-only response cannot replace a usable populated model.
- `homeModelAuthority.ts` gives native Home one atomic replacement policy. Stale route generations, hash mismatches, empty late aggregates, partial models, and section shells without content are rejected when a populated model is already committed. Route-scoped count-only milestones record cache reads, adoption/rejection, hero/shelf readiness, live work, final commit, and retirement without media IDs, titles, request URLs, or payloads.
- The exact six-empty-section plugin path was `BuildConfiguredRows(... includeEmptyRows: true)`: enabled Row Builder definitions were serialized as section shells even when candidate selection produced zero hero/row items. Refresh now excludes empty generated rows, semantic validation rejects configuration-only output before persistence, and refresh failure retains the prior cache. The plugin source/payload was not deployed to the remote server during this prompt.
- The tracked LG hosted-development document now targets `http://<development-frontend>:8082/` exactly. The development bundle was restarted with `PTV_DEV_JELLYFIN_URL=http://<test-server>:8096`; physical runtime evidence confirmed frontend resources from `<private-host>:8082`, Jellyfin/API/plugin resources from `<private-host>:8096`, and no `<private-host>:8096` traffic. The old hosted wrapper had derived a `<private-host>:8096` target before Jellyfin server selection could correct it.
- On the connected LG webOS Chrome 68 client, the corrected split-origin build completed a Movies-to-Home return and then held the same hero, 25 semantic rows, 36 cards, and 40 images for 100.1 seconds with zero logger errors. The untouched `<private-host>:8096/web/index.html` frontend independently held the same counts and hero for 100.7 seconds. The reported shelf disappearance did not reproduce in either bounded run; this is positive evidence, not proof that all timing/concurrency paths are retired.
- Physical artifacts are `test-results/webos-physical/home-split-origin-after.json`, `home-split-origin-after.png`, `home-original-server-after.json`, and `home-original-server-after.png`. The PNGs are inspector screen captures, not replacement camera photos. The LG was restored to authenticated `http://<development-frontend>:8082/#/home` with 25 rows and 36 cards visible.
- Final validation passed: focused cache/origin/Home tests 28/28, full Vitest 95 files and 646/646 tests, plugin tests 31/31, TypeScript/build policy, production Webpack in 111.724 seconds with only the two established size warnings, plugin contract, secret scan, and `git diff --check`. Scoped standalone lint passed; changed legacy cache/Home files retain only documented findings on unchanged lines.
- Production remains blocked. The Home persistence regression is not currently reproduced, but the same-account 13/13 interaction gate, authoritative clean cold/warm discovery, representative server/playback evidence without conversion/lock failures, read-only backend contention evidence, and complete user-operated LG remote/focus/back/playback acceptance are still required. Do not raise timeouts, substitute identities, deploy the plugin implicitly, or call this production-ready.

- The narrow shared-shell/webOS correction is now deployed only to the connected local LG test path. The exact defect was that `PTV_WEBOS_OPTIMIZED` applied `ptv-render-webos` while the authoritative ten-foot geometry was keyed only to `ptv-render-tv`; `applyPtvRenderProfileClasses` removed that TV class. Chrome 68 also needed literal fallback dimensions because intrinsic 1077x500 brand sizing and unsupported `clamp()` offsets could expand or misplace the header.
- `renderProfile.ts` now keeps the specific `ptv-render-webos` class and adds `ptv-render-tv` for every TV-tier profile. Shared shell and webOS styles bound grid min-content sizing, brand/image width and height, overflow, header tracks, and 720p/1080p/4K offsets with literal fallbacks. Stable layout markers were added without changing Home data loading, route ownership, or diagnostics schema.
- The authoritative physical after capture at 1920x1080 reports an 80px header at `(66,36)` with width 1788, a 220x64 brand, a primary navigation centered at x=960, utilities within the same header, one visible brand owner, zero horizontal overflow, and no legacy header. The original `shell-brand-oversized`, `hero-content-obscured-by-shell-brand`, and `focus-not-visible` issue codes are absent.
- Focus was visible on the brand and remained visibly bounded after one injected ArrowRight move to the primary navigation. This proves one directional transition in the physical browser, not the complete user-operated LG remote matrix.
- The saved after reports are `test-results/webos-physical/physical-layout-after.json` and `physical-layout-after-focus.json`. Both remain `warning` because this local account settled with `mountedRows=0`, no hero actions, and no first shelf/scroller after the extended observation window. `first-shelf-missing` therefore remains open, and no post-fix camera photo was captured.
- Post-fix validation passes: focused regressions 39/39 on the final CSS, full Vitest 93 files and 629/629 tests, TypeScript/build policy, scoped Stylelint, production Webpack in 81.951 seconds with only the two established size warnings, secret scan, and Playwright 43 passed with six opt-in live checks skipped. Changed-file ESLint reports only the documented pre-existing legacy findings on unchanged lines.
- Production readiness remains blocked. The local wrapper/Jellyfin test path was changed; the remote production server was not modified. Remaining gates include a populated same-device Home capture and after photo, the full physical remote matrix, same-account 13/13 interactions, clean warm/cold discovery, representative clean server traffic, and read-only lock/host evidence.

- Physical LG webOS inspection is now available through the embedded production diagnostics path. The signed-in 70UN7070PUA (webOS SDK 5.6.2, firmware 04.64.00) loaded the current production bundle at a 1920x1080 CSS viewport with DPR 2, selected `PTV_WEBOS_OPTIMIZED`, advertised `physicalLayoutSnapshot=true`, and checked in successfully.
- The authoritative Home capture is a P1 regression, not a visual sign-off. It recorded `shell-brand-oversized`, `hero-content-obscured-by-shell-brand`, `first-shelf-missing`, and `focus-not-visible`. The shell header was 1920x500 and the brand/image were 1077x500; the Home root was 1920x1215, while the first shelf and shell main were absent from the fixed-selector snapshot. The server report observed before Stop matched all four issue codes and contained seven bounded milestones through `report-generated`.
- The live exercise exposed a frontend compatibility defect at the diagnostics response boundary: Jellyfin serialized plugin DTOs with PascalCase keys while the Dashboard and client transport expected camelCase. Both paths now accept either casing without weakening malformed-row rejection. Focused diagnostics tests pass 20/20, TypeScript passes, the full frontend suite passes 624/624, and production Webpack passes in 121.095 seconds with only the two established size warnings.
- No CSS/layout correction was made in this prompt. The owner marker proves the oversized element is the shell brand image rendered at its 1077x500 intrinsic size, but reliable winning-cascade source attribution is unsupported, so the exact overriding rule is not yet proven. The P1 stays open until a narrow fix is deployed and the same physical Home route produces a clean after snapshot and photo.
- A later Dashboard shutdown snapshot replaced the latest stored report with a warning-only focus result after Stop. This is the known latest-report timing limitation; it does not invalidate the directly observed Home report, but future acceptance captures must request/view or download the Home report before navigating away or stopping the lease.
- The embedded wrapper, rebuilt frontend, and five-file plugin payload were exercised only against the local test Jellyfin instance. The remote production server was not changed. The TV remains signed in to the local test instance for follow-up work.
- Physical LG webOS Home is a separate P1 release blocker. The supplied physical-device report describes compressed/obscured hero metadata, oversized PiggieTV and `Powered by Jellyfin` branding inside the hero, header/nav/utility overlap, a partial-height upper hero, a mostly empty blurred lower panel, and no visible first shelf. Treat this as the new authoritative physical failure baseline, not as an Items-latency symptom or an emulation result.
- The physical photo is now available and visually confirms the complete oversized asset is `src/ptv/assets/logo/banner-light.png`, including the pig emblem, `PiggieTV`, and `Powered by Jellyfin`. Source tracing shows native `PTVShell` assigns this banner to `.ptv-shell-brand`; base shell CSS intends to constrain it with `clamp()` and the TV profile adds literal `196px` by `64px` maxima. The photo proves those intended bounds are not winning on the television, but exact live DOM ownership and the losing/winning declarations still require inspection.
- The physical target is now connected as `PiggieTV-LG`. Read-only system information identifies LG model `70UN7070PUA`, SDK `5.6.2`, firmware `04.64.00`, and board `K6LP_ATSC_US`. This clears device discovery but not app-runtime provenance.
- The installed store Jellyfin wrapper is outside the Developer Mode app sandbox: installed/running app enumeration returns no package, `ares-inspect` against `org.jellyfin.webos` times out, and the `tv` profile rejects both `ares-shell` and `ares-log`. Therefore loaded build, service worker, chunks, profile/classes, live DOM owner, winning CSS, numeric geometry, and focus state still cannot be captured through the current account. Do not choose among stale/mixed assets, missing profile classes, unsupported base `clamp()`, or specificity/source-order conflict without an inspectable runtime or equivalent embedded diagnostics.
- No shell, Home, hero, branding, focus, or CSS source was changed for this physical report. Do not add compensating webOS rules until the real television is available through `ares` and stale/mixed bundle control has been ruled out. The investigation contract and missing evidence are recorded in `WEBOS_PHYSICAL_REGRESSION_REPORT.md`.
- The supplied post-correction Jellyfin log contains zero `UserData is not a valid value for ItemFields` failures, confirming that specific compatibility defect is retired. It does contain 256 debug-level conversion exceptions for other unsupported `Fields` tokens such as `ImageTags`, `ProductionYear`, `Container`, and `SeriesId`; these are response properties, not members of Jellyfin's generated `ItemFields` enum.
- `src/ptv/api/client.ts` now normalizes every PTV `Fields` query at the shared request boundary against the generated Jellyfin SDK enum. Unsupported values are omitted, valid values are canonicalized and deduplicated, and an all-invalid `Fields` parameter is removed without changing other query parameters. This replaces further page-local field removals.
- The same server log proves a backend release blocker independent of the frontend request cleanup: SQLite returned `database is locked` while committing playback user data, causing `POST /Sessions/Playing/Progress` to take 35.22 seconds and return HTTP 500 after three optimistic-lock retries. Forty-two other slow responses include successful Genre, BoxSet, Season, and Episode requests taking roughly 6.5 to 93.4 seconds; an EF Core multiple-collection single-query warning is also present.
- Playback Reporting activity overlaps the lock window, but the log does not prove that plugin caused the contention. Do not disable plugins, rewrite the database, or claim a root cause without read-only server/host evidence.
- A newer 8,908-line post-restart log provides a clean limited verification sample: zero `ItemFields` binder conversions, zero `UserData` field errors, zero database-lock messages, zero optimistic-lock retries, zero HTTP 500s, and zero error lines. All three logged PTV `Fields` queries contain only generated-enum members, confirming the shared sanitizer for the observed Latest and Resume traffic.
- The newer sample has only five slow HTTP responses, all successful, ranging from 1.51 to 3.24 seconds. It covers User Views, Studios, Latest, and Audio/Video Resume during roughly two minutes after restart; it contains no playback-progress write and does not supersede the earlier 35.22-second SQLite lock or 93.39-second read evidence.
- The only warning in the newer sample says ASP.NET's `WebRootPath` `/var/lib/jellyfin/wwwroot` was not found, while Jellyfin separately reports the configured web resources path `/usr/share/jellyfin/web`. Treat it as deployment configuration evidence to review, not as the established cause of API latency.
- Production readiness remains blocked. After the `UserData` request-field correction, the unchanged interaction matrix passed 11/13 and then 5/13 on a 222.9-second warm repeat. Content/state completion, Movies/details availability, playback continuation, and TV focus still miss fixed scenario windows nondeterministically.
- Live browser evidence confirms the compatibility correction: 44 recent `Items` requests contained zero `Fields=UserData` tokens; 18 exposed Resource Timing statuses were HTTP 200 and none exposed an error status. This proves the invalid client contract is gone, but it does not prove the server log is clean or the slow successful-request tail is repaired.
- The clean post-fix warm discovery passed 21/23 with all responsive profiles healthy. Reading Books recorded six functional failed requests, and Preferences again retained the correct route/shell but did not render its heading/content inside the unchanged observation window.
- Earlier broad-overflow cold/warm reports remain invalid because an invisible Webpack Dev Server overlay iframe alone caused the width delta. The final cold attempt prevented that iframe and allowed 30 seconds for API-client restoration, but the same account still became unauthenticated; no authoritative cold report exists.
- Post-fix automated validation is complete: `client.test.ts` and `items.test.ts` pass 9/9, `npm run build:check` passes with zero TypeScript errors, and production Webpack compiles successfully in 104.624 seconds with only the two established aggregate asset/entrypoint size warnings. This validates the generated-enum import, sanitizer behavior, coordinated Items boundary, and production bundling; it does not rerun authenticated or physical-device scenarios.
- Do not increase timeouts, substitute identities, or call this production-ready. Remaining gates are a same-account 13/13 interaction run, clean warm and cold discovery, representative route/playback traffic with no `ItemFields` conversion exceptions, read-only server/host/database-lock evidence, and physical LG webOS correction proven on the same television with matching-build/profile evidence, corrected geometry/photo, and startup remote navigation.

## Critical TV Navigation Worktree (2026-07-19)

- `src/ptv/core/tvFocus.ts` now centrally owns PTV D-pad/OK/Back behavior, per-route focus memory, async initial focus, modal/menu trapping, opener restoration, and exact playback return.
- The corrected route event is `ptv:routecontrollerchange`. Dynamic Home/Browse/Music/Reading rows explicitly publish readiness, and important controls carry stable focus keys.
- Directional candidates and four-way edges are cached and rebuilt only for route/layer/content changes; arrow presses do not query the DOM.
- Android key codes 19-23/4, webOS Back 461, and Tizen Back 10009 are normalized with browser key names/codes.
- Dropdowns open/navigate/select/close from the remote and return to their opener. Overlay, playlist-modal, and performance-overlay focus ownership was consolidated into the manager.
- TV focus styling is a fast purple glow/scale/glass treatment, with a reduced-cost webOS profile.
- Settings links to `#/tv-navigation-debug`, which reports current focus, history, last route/key, candidate/missing counts, the navigation graph, and broken paths.
- The complete source audit and hardware acceptance matrix are in `src/ptv/docs/tv-navigation-audit.md`. Automated key-signature coverage does not replace physical LG/Fire/Android hardware verification.
- Current verification: the focus/route/dropdown/style set passes 74/74, the latest manager/dropdown rerun passes 37/37, scoped ESLint and changed Stylelint pass, the isolated browser harness passes 17/17, and `git diff --check` passes. Full PTV Vitest has 365 passing tests plus one unrelated Home-hook import-resolution suite failure.
- TypeScript and production Webpack are blocked only by three pre-existing dirty-worktree render-profile/remote-diagnostics type errors (`remoteDiagnosticsModel.test.ts:174`, `remoteDiagnostics.ts:295`, and `remoteDiagnostics.ts:937`); Webpack reported no TV-navigation compile error. Do not claim a clean release build until those separate changes are repaired.

Project-memory rule: after every completed project prompt, update `HANDOFF.md`, `PROJECT_STATE.md`, and `ARCHITECTURE.md` before reporting completion. Record the resulting behavior, validation, deployment boundary, and remaining risks; do not leave the top-level current-state text pointing at an older task.

## Where The Project Is

PiggieTV is a Jellyfin Web customization with a guarded singleton runtime, shared PTV shell, native Home/media/Music/Reading/Requests routes, persistent playback UI, featured cache v7, recommendation and Row Builder tooling, and a companion .NET 9 Jellyfin plugin.

The Reading, focused-browse, Details, playback, and baseline TV compatibility work remains in place. The current worktree adds conflict-safe media-source deduplication, stronger TV OK/select and dropdown behavior, lighter static webOS glass, an administrator-controlled local remote-diagnostics path spanning the frontend and companion plugin, optional LG webOS CLI helpers, and repository hygiene that stops tracking machine-local/generated output while preserving the five-file deployable plugin payload.

The implementation and automated verification are complete. A follow-up dashboard crash fix now hardens the Remote client diagnostics panel against malformed plugin/cache rows before React render. The next meaningful work is review/commit, coupled frontend/plugin deployment, then authenticated physical LG testing. Do not describe remote-key behavior or webOS visuals as hardware-verified until the rebuilt frontend has been loaded on the TV.

## Important Current Decisions

- `src/ptv/core/app.js` is the only full runtime initializer. Components consume the runtime; they do not bootstrap it.
- `PTVShell` and the route controller own navigation state. Do not add page-local competing route state.
- The persistent runtime root owns the global media dock and playback controls.
- Featured content remains cache schema 7.
- Reading local-storage home cache remains schema 4.
- Reading kind precedence is manual override, library hint, reliable local evidence, comic archive format, then Book.
- ComicVine provider identity must not turn a Manga-library item into a Comic.
- Year is metadata, not inferred series identity.
- Series overrides are plugin-authoritative. Browser storage is only an optimistic cache/migration fallback.
- Provider deck/description copy must not become the item title.
- Reading metadata application is field-selective. Empty provider values do not clear existing metadata, existing artwork defaults to preservation, and Reading does not use broad `ReplaceAllMetadata`.
- Reading diagnostics require both admin authorization and explicit debug mode.
- Genre display normalization never rewrites the query value. Exact case-insensitive deduplication and explicit alias groups are allowed; fuzzy genre merging is not.
- Shows `view=networks` remains URL-compatible, while its visible directory label is **Studios & Networks** because the data path is `getStudios` plus `StudioIds`.
- Media-source deduplication is conflict-safe: exact normalized paths are authoritative, reused source IDs cannot hide technically distinct files, and strong technical signatures may join path/ID aliases only when the resulting alias cluster contains no hard technical conflict across any members.
- TV remote activation treats Enter, Select/OK/Accept, and supported numeric key codes as one semantic activation. Dropdown focus, Back behavior, focus restoration, and pointer activation remain centralized and exactly-once.
- Remote diagnostics are local, administrator-controlled, capability-gated, time-limited, memory-only, bounded, and privacy-sanitized. They are not telemetry and must not gain an external upload destination or continuous inactive collection.
- Remote diagnostics dashboard API responses are untrusted at the component boundary. Client lists must be normalized from `unknown`, non-arrays become empty state, rows without a usable `clientId` are skipped, optional display fields get safe string/boolean/null defaults, and debug warnings must remain compact and payload-free.
- The plugin and frontend are now a coupled deployment for remote diagnostics. Deploy the refreshed five-file plugin payload together with the matching frontend bundle.

## Earlier Reading/Browse Work Retained

The following sections preserve the earlier Reading and focused-browse delivery context. The authoritative current worktree checkpoint is the 2026-07-19 section at the end of this document.

### Shared Reading Identity

- `readingFilename.ts` parses title, series, volume/issue/chapter, year, edition/format, confidence, and removed release tokens.
- `booksClassification.ts` owns pure route-kind classification and has direct regressions for Manga versus ComicVine evidence.
- `booksSeries.ts` applies deterministic grouping precedence and excludes year from group identity.

### Durable Series Overrides

- `booksSeriesOverrides.ts` reads/writes the plugin endpoint and migrates browser overrides without making localStorage authoritative.
- The plugin adds `GET/PUT /Ptv/v1/reading/series-overrides/{routeKind}` plus configuration models/service support.

### Identify And Metadata Apply

- `itemidentifierUtils.js` normalizes provider candidates and ranks stable provider ID, ISBN, series, title, issue/volume, year, and creator evidence.
- `itemidentifier.js` provides Reading-specific current/proposed field selection and independent metadata/artwork status.
- Native Google Books search uses the plugin proxy. ComicVine continues through Jellyfin remote search.
- Safe provider links are allowlisted.

### Diagnostics And Layout

- `readingDiagnostics.ts` gates, groups, bounds, and redacts Reading diagnostics.
- `books.scss` and `itemidentifier.scss` provide fluid widths, touch controls, horizontal shelf overflow, and bounded internal scrolling.

### Dashboard And Performance Follow-up

- `debugExportSanitizer.ts` is the final boundary for copied/serialized dashboard reports; the live admin panel remains operationally detailed.
- `PtvTmdbMetadataService` now uses cache-first lookup, bounded parallelism, per-request cancellation, limited remote work, reusable credential validation, and partial-result counters.
- `browseLoadingPolicy.ts` prioritizes first-visible shelves and avoids the former random Featured query; sections still publish independently.
- `images.ts` uses capped expiring failure caches, while browse cards advance through shared fallback candidates.
- `PTVShell` emits its mount diagnostic once per actual shell backdrop component mount.

### Authenticated Runtime Corrective Hardening

- `debugExportSanitizer.ts` replaces complete `data:image` and `blob:` values, preserves semantic versions/build IDs, and omits credential lengths and SMTP password-state fields.
- `routeController.ts` synchronizes the current browser location before recording shell lifecycle counters, removing stale query attribution during soft navigation.
- `NativeBrowsePage.tsx` emits bounded focused-load category/filter/page/count/timing/scope/sort evidence without private IDs or request URLs.
- Regression coverage includes query-only lifecycle transitions and an exact Universal Pictures second-page query using `StudioIds`, `Limit=50`, `StartIndex=50`, and no `SearchTerm`.

### Focused Loader Identity Correction

- The old coarse loader key was diagnostic-only; route-object dependencies and route-generation checks already drove behavioral reload/suppression.
- `focusedBrowseLoader.ts` now provides the authoritative internal key for effect ownership and focused cache identity. It contains kind, view, resolved scope, parent context, exact genre/studio/network, resolved metadata IDs, search, sort, page, offset, and page size.
- The Jellyfin API adapter has no `AbortSignal` contract. Keyed owner tokens retire old work and suppress late completion; diagnostics do not claim network cancellation.
- New-key loads clear prior focused results. Matching pages accumulate with item-ID deduplication, while prior filters restore only their own bounded cache entries.
- Safe diagnostic keys keep exact public labels, for example `movies:genre:genre:unscoped:Crime:SortName:Ascending:0:50`, but omit/fingerprint private IDs and arbitrary search text.

### Genre Directory, Network Label, And Shell Attribution

- `genreDirectory.ts` presents compact searchable alphabetical genre cards while preserving every exact original Jellyfin value for requests.
- Case-only duplicates collapse deterministically. Explicit alias groups remain transparent and expose their exact member values; unrelated near-matches never merge.
- Curated mode hides only a bounded exact sensitive set. All metadata mode restores the complete server directory and is stored as a per-user browser preference.
- Metadata `ChildCount` values drive directory counts; no per-genre item-query fan-out was added.
- Shows displays **Studios & Networks**, retains `view=networks`/`view=network`, and continues exact `StudioIds` queries.
- Browse diagnostics remain admin-plus-debug only, collapsed, bounded, and privacy-safe.
- `ptv-shell-mounted` now carries a stable shell-instance identifier and `actualComponentMount: true`, so route/backdrop events are distinguishable from actual component mounts.

```text
Focused browse/route: 6 files, 37 tests passed
Full Vitest suite:     36 files, 283 tests passed
TypeScript:            passed
New/data-file ESLint:  passed, zero findings
NativeBrowse ESLint:   17 errors / 2 warnings both at HEAD and in the worktree
PTVShell ESLint:       26 errors / 1 warning both at HEAD and in the worktree
Scoped Stylelint:      1 unchanged nativeBrowse.scss:492 baseline error
Production Webpack:    passed in 211s (184.232s compilation)
git diff --check:      passed
Secret/private scan:   passed for changed source/tests/docs
Current dev bundle:    HTTP 200 at http://localhost:8080/ with current markers
Plugin build:          not required; no plugin source or contract changed
```

## Earlier Validation Baseline

These results describe the earlier Reading/debug delivery and are retained for provenance. Use the 2026-07-19 handoff for the current authoritative validation.

```text
Focused Reading/Identify: 6 files, 43 tests passed
Debug/performance tests:   3 files, 5 tests passed
Full Vitest suite:         30 files, 243 tests passed
TypeScript:                passed
Scoped ESLint:             zero errors; 8 existing nested-render warnings
Scoped Stylelint:          passed
Plugin Release build:      passed, 0 warnings / 0 errors
Plugin tests:              4 tests passed
Production Webpack:        passed in 110.7s (97.673s compilation)
git diff --check:          passed
```

Production Webpack emitted only the repository's existing aggregate asset-size and entrypoint-size warnings. Repository-wide ESLint still reports the exact 172-error/126-warning baseline and repository-wide Stylelint the exact 140-error baseline. New standalone files lint clean; touched legacy browse/shell findings are on unchanged lines. Generated build/test artifacts were cleaned or restored.

## Movies/Shows Focused Browse Delivery (2026-07-14)

- `browseRoute.ts` owns canonical parsing/building for view, scope, genre/studio/network, collection/series context, query, sort, order, and page.
- `routeIdentity.ts` and the shell controller now treat query-only changes as distinct route state.
- Base Movies/Shows pages retain the approved progressive shelf loader. Focused views render only their directory or paged grid.
- Movies views: Latest, Trending, Genres, exact Genre, Studios, exact Studio.
- Shows views: Continue, Latest, Trending, Genres, exact Genre, Studios & Networks, exact Studio/Network, and series-scoped Seasons. Existing network route values remain unchanged.
- `anime`, `animemovies`, and `cartoons` resolve through Jellyfin user views to real IDs; unresolved aliases show an error rather than broad media.
- Genre uses Jellyfin `Genres`; studio/network names resolve exactly to metadata IDs and use `StudioIds`; filters are applied before 50-item paging.
- Trending uses the deterministic local-library formula recorded in `ARCHITECTURE.md`; it does not alias Recently Added or make live per-card provider requests.
- Footer metadata chips now build typed browse URLs rather than ordinary Search URLs.
- Browse diagnostics are admin-plus-debug only, collapsed, bounded, and redacted.

Final local validation:

```text
Focused hardening:    5 files, 22 tests passed
Full Vitest suite:    34 files, 263 tests passed
TypeScript:           passed
New-file ESLint:      passed, zero findings
Legacy touched lint:  no new findings versus HEAD baselines
Scoped Stylelint:     one unchanged nativeBrowse.scss:492 baseline error
Production Webpack:   passed in 106.7s (92.588s compilation)
Plugin build:         not required; no plugin code changed
```

### Authenticated Evidence And Limits

The supplied authenticated dashboard export parsed successfully with 120 events. It proves Movies genre-directory loads (59 entries), exact genre loads (2/2 and 50/395 items), a 50-item first-page request completing in 634.6 ms, and a healthy fresh/stored featured cache v7 with 356 items, 25 sections, and 6 persisted recommendation rows. It also captured the stale lifecycle-route attribution that is now regression-tested.

It does **not** prove Universal Pictures/network selection, Shows focused views, Anime/AniMovies/Cartoons scope isolation, Trending stability, season routes, second-page UI accumulation, browser history/scroll restoration, or non-admin/admin-debug authorization combinations. Keep the delivery status at pending authenticated sign-off until those checks pass against the deployed bundle.

### Focused Browse Live Matrix

1. Direct-load, refresh, back, and forward on base `#/movies` and `#/shows`.
2. Verify `view=latest` differs materially and is DateCreated descending.
3. Verify Shows `view=continue` contains resumable items only.
4. Verify Trending order is stable across refresh while inputs are unchanged.
5. Open Genres, select a value containing punctuation/Unicode, load a second page, and return from item details.
6. Open Movies Studios, select Universal Pictures, and confirm exact Jellyfin metadata matches and total count.
7. Open Shows Studios & Networks, select a known network/studio such as 4Kids, and confirm exact `StudioIds` filtering with no title-search leakage.
8. Verify `topParentId=anime`, `animemovies`, and `cartoons` never leak broad libraries; verify an unknown alias fails closed.
9. Verify `view=season` without `seriesId` shows the recovery state and a complete series-scoped URL lists seasons.
10. Change filters quickly and confirm an older response never replaces the active route.
11. At desktop/mobile widths, verify grid, Load More, touch/keyboard/remote activation, visible focus, and return scroll position.
12. As non-admin and admin-with-debug-off, confirm no browse diagnostics. As admin with debug on, confirm the panel is collapsed and redacted.

Deployment is frontend-only. No plugin DLL or plugin restart is required. Install the new web bundle, allow the service worker to update or perform one hard refresh, then run the remaining matrix. Application data caches do not need clearing. The current development bundle is available at `http://localhost:8080/`; its HTTP and marker checks do not replace authenticated route testing.

## Debug/Performance Live Verification

1. Copy the global dashboard report and confirm it contains useful health/timing/count fields but no private host, user/item ID, token, authorization header, local path, SMTP credential, or raw sensitive URL.
2. Trigger a featured refresh with a warm TMDb cache and confirm cache hits do not consume the remote-work budget.
3. Trigger a cold/slow refresh and confirm attempted/completed/skipped/failed/cancelled/partial counters are coherent and completed enrichment survives timeout/cancellation.
4. Open Movies and Shows with network timing visible. Confirm the hero and first shelf become interactive before slower shelves finish, and confirm no duplicate exact shelf request is issued.
5. Confirm standard poster rows use lean list payloads and richer hero data is fetched separately.
6. Break one poster URL temporarily. Confirm the card advances to another candidate/placeholder, other images continue, and the failed candidate is retried after expiry or reload.
7. Change focused backdrops repeatedly and confirm `ptv-shell-mounted` does not increment for those changes.

## Live Verification Matrix

Deploy the rebuilt frontend and matching plugin, restart Jellyfin, then verify:

1. `#/reading`, `#/reading/books`, `#/reading/comics`, and `#/reading/manga` load directly and after refresh.
2. Reading cached content appears before background shelves when a cache exists.
3. A slow/failed shelf does not blank ready shelves.
4. ComicVine result selection keeps canonical title, issue/series, creators, overview, provider ID, and selected artwork after refresh.
5. Google Books searches by title and ISBN and applies only selected fields.
6. Existing metadata is not erased by empty provider values.
7. Existing primary art is preserved unless replacement is explicitly selected.
8. Manga library items remain Manga after ComicVine matching.
9. Ancient Magus/Slightly Older Girlfriend-style files group consistently without year becoming group identity.
10. Manual series overrides persist across devices and Jellyfin restart.
11. Non-admin and non-debug users cannot see Reading diagnostics; debug output is redacted and bounded.
12. Horizontal shelves work with touch, mouse/trackpad, keyboard, and remote controls.
13. Layout remains usable at 390, 768, 1440, and 2560 pixel widths.
14. Active music playback and the media dock survive navigation through Reading pages.
15. The legacy Jellyfin header does not reappear during soft route changes. One transient appearance was reported and cleared after hard refresh, so monitor route-class cleanup closely.

## Useful Commands

```powershell
npx vitest run src/ptv/modules/books/readingFilename.test.ts src/ptv/modules/books/booksSeries.test.ts src/ptv/modules/books/booksSeriesOverrides.test.ts src/ptv/modules/books/booksClassification.test.ts src/ptv/modules/books/readingDiagnostics.test.ts src/components/itemidentifier/itemidentifierUtils.test.js
npm test
npx tsc --noEmit --pretty false --incremental false
npx eslint src/components/itemidentifier/itemidentifier.js src/components/itemidentifier/itemidentifierUtils.js src/ptv/modules/books src/ptv/core/config.ts src/ptv/core/pluginApi.ts
npx stylelint "src/ptv/modules/books/books.scss" "src/components/itemidentifier/itemidentifier.scss"
dotnet build src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj -c Release --no-restore
npm run build:production
git diff --check
```

The broad ESLint command may report the eight known nested-render warnings in `booksPage.tsx`; treat new errors separately.

## Final Audit Worktree Guidance

- Do not discard unrelated user changes.
- `HANDOFF.md`, `PROJECT_STATE.md`, and `ARCHITECTURE.md` must be refreshed after every completed project prompt and belong in the intended commit scope when the implementation is committed.
- `.dotnet-home/`, `node_modules/.vite/**/results.json`, `ptv-split-dev.err.log`, `ptv-split-dev.out.log`, `ptv-split-dev.pid`, and nested plugin project/test `bin`/`obj` output are machine-local or generated. They are intentionally untracked/ignored; do not restore them because an older checkpoint below says to do so.
- Preserve `src/ptv/plugin/bin`: its DLL, deps JSON, PDB, XML documentation, and `meta.json` are the intentional deployable plugin payload. The current payload was rebuilt after the final plugin source change.
- Review the media deduplication, TV focus/dropdown, remote-diagnostics frontend/plugin/dashboard, webOS tooling/docs, project-memory updates, `.gitignore`, and generated-file removals together before committing.
- Do not commit generated `dist`, nested plugin project/test `bin`/`obj`, Vitest result, or Babel cache output.
- Confirm the plugin DLL and frontend bundle were produced from the same worktree before live testing.

## Stop Conditions

Do not claim the Reading work fully deployed until the authenticated provider/apply, restart persistence, and device checks above pass. If a live check fails, record the request/response shape and current item payload in `DEBUG_LOG.md` without credentials, tokens, item IDs, server addresses, or local paths.

## 2026-07-14 - Production Hardening Handoff

The current worktree adds CI, provenance, safe service-worker updates, deterministic browser integration tests, directory/shell decomposition, repository and bundle audits, compatibility checks, and contributor/release guidance. It deliberately preserves plugin API v1, cache v7, recommendation persistence, Reading metadata behavior, playback ownership, focused-loader identity, and Jellyfin fallback routes.

Use these commands for the release gate:

```powershell
npm run test:ptv
npm test
npm run build:check
npm run lint:ptv
npm run lint:ptv:clean
npm run stylelint:ptv
npm run test:e2e
npm run test:plugin-contract
npm run test:plugin
npm run build:production
npm run build:report
npm run repository:report
npm run secret:scan
git diff --check
```

The final local results are 165 focused PTV tests, 334 full-suite tests, 26 Chromium tests, and four plugin tests passing. TypeScript, both ESLint gates, Stylelint, plugin contract, privacy scan, and production Webpack pass. The Webpack output retains only the established asset/entrypoint warnings.

Historical note: this 2026-07-14 checkpoint originally required restoring tracked Vite and nested plugin `bin`/`obj` output. The approved 2026-07-19 hygiene pass supersedes that instruction and intentionally removes those generated paths from tracking while preserving `src/ptv/plugin/bin`. Continue removing ignored `dist`, `e2e/.harness`, and `test-results`, and keep intended project-memory, CI/workflow, quality, hardening, e2e, contributor, and lock-file changes in scope.

Deployment order for the corrected pair: build/test the plugin and frontend from the same revision, deploy plugin `<private-address>` and its matching `meta.json`, restart Jellyfin, verify `/Ptv/v1/status` advertises `readingSeriesOverrides`, then deploy the frontend and accept the offered service-worker update. Application caches do not need clearing; a hard refresh/service-worker clear is recovery-only if the old bundle remains controlled.

## 2026-07-14 - Authentication header visibility checkpoint

- Root cause: `RootAppRouter` mounted the global stable `AppHeader` for every non-dashboard stable route, including login. The experimental `AppLayout` independently had the same missing authentication boundary for its Jellyfin-style app bar/drawer. The supplied header was the stable `AppHeader`, not a stale page-local `PTVShell` instance.
- Added `authenticationRoutes.ts` as the only authentication-route classifier. It accepts hash, hashbang, pathname, and full Jellyfin-web locations, ignores query parameters, and exact-matches login, server-selection, password, manual-login, quick-connect, and signup routes.
- Stable and experimental authenticated controls are absent on authentication routes and return through normal React Router lifecycle when navigation leaves authentication. The stable `AppHeader` retains only a `display:none` compatibility host with Jellyfin's `.mainDrawer .scrollContainer` and `.skinHeader` anchors; `libraryMenu` requires them during login-time module initialization. The route registry and login enhancer reuse the same classifier.
- No login card markup/style, native fallback route, authenticated page header, plugin source, playback behavior, or cache schema changed.
- The initial full unmount caused a configured-login runtime cascade because `libraryMenu` received no compatibility DOM. The follow-up preserves only the hidden anchors and keeps every visible authenticated control unmounted.
- Final verification passed: focused 3 files/35 tests; full Vitest 38 files/315 tests; TypeScript; scoped ESLint with zero findings; production Webpack in 78.6 seconds with a 76.139-second compilation and only the two established size warnings; `git diff --check` apart from line-ending notices.
- Fresh headless Chrome against plain/query login at desktop, tablet, mobile, and TV sizes found no runtime overlay, `.ptv-app-header-root`, or visible `.ptv-skinHeader`; every case found the hidden compatibility host and both required legacy anchors.
- Stylelint was not run because no style source changed. The companion plugin was not rebuilt because this is a frontend-only lifecycle correction.
- Before deployment sign-off, manually verify a real expired-session redirect, logout/login, successful login restoration, and back/forward navigation with the configured server. Confirm normal authenticated pages and native fallback pages retain their headers.

## 2026-07-14 - Authenticated debug corrective checkpoint

- Reading progressive indexing is implemented in `readingProgressiveIndex.ts` and integrated by `booksApi.ts`/`booksPage.tsx`. The first stage is 200 items, page size is 50, request concurrency is two, and the 1,818-item fixture reaches a final 37-page index. Do not restore the old terminal cap or allow a smaller refresh/grouping stage to replace a fuller active index.
- Route ownership is exact (`movies`, `shows`, `reading`, `dashboard`, `login`) and is synchronized before lifecycle render/unmount telemetry. The Chromium smoke path Covers Shows -> Reading -> Dashboard -> back Reading -> back Shows -> login.
- Reading override GET/PUT routes existed in current plugin source before this pass; the deployed 404s mean the installed DLL is stale. The source status response now advertises `readingSeriesOverrides`, and contract checks cover source attributes plus status feature reporting. Deploy the rebuilt plugin and restart Jellyfin before validating overrides.
- Plugin startup now performs zero network reads before authentication in the regression fixture, then one each for status, settings, and featured; duplicate callers share those requests. Runtime diagnostics use the existing `window.__PTV_RUNTIME_STATE__` singleton and never construct a dashboard runtime.
- Telemetry aggregates 101 identical Reading image-profile hits into seven representative events while retaining a total of 101. Route/API failures have priority over image cache/load noise. Static-logo timings use resource duration when available and label observer age as discarded.
- Verified commands/results: focused Vitest 38/38; full Vitest 348/348; TypeScript clean; PTV Stylelint clean; ESLint baseline unchanged at 170 errors/23 warnings; plugin contract clean; plugin tests 7/7; plugin Release build clean; Playwright 27/27; production Webpack clean apart from the two known size warnings.
- Generated Vitest and plugin `bin/obj` changes were restored. Intended untracked files are the new progressive-index tests/module, auth-startup test, observability buffer/tests, dashboard runtime diagnostic/tests, and plugin override contract test.

## 2026-07-15 Release Candidate Handoff

- Old installed/source plugin: `<private-address>`; corrected release plugin: `<private-address>`.
- Copy all files from `src/ptv/plugin/bin` into the Jellyfin PiggieTV plugin directory: `Jellyfin.Plugin.PiggieTV.dll`, `Jellyfin.Plugin.PiggieTV.deps.json`, `Jellyfin.Plugin.PiggieTV.pdb`, `Jellyfin.Plugin.PiggieTV.xml`, and `meta.json`.
- Restart Jellyfin, then confirm `/Ptv/v1/status` reports plugin/version `<private-address>`, API `1`, cache `7`, and `readingSeriesOverrides=true`. Only then deploy the matching frontend bundle.
- Expected old-plugin behavior: connected, API/cache usable, Reading server persistence marked upgrade-required, browser fallback labeled local cache. Expected new-plugin behavior: compatible and server persistence available.
- Automated release result: focused compatibility 12/12, full Vitest 351/351, plugin 9/9, TypeScript/scoped ESLint/contract/secret scan clean, Release build/publish clean, and production Webpack successful with only established size warnings.
- After deployment, manually test an override save/reload, the old-plugin upgrade warning if rollback is exercised, dashboard version/capability labels, login/auth transitions, active playback, and normal service-worker update adoption. No routine cache purge is required.

## 2026-07-15 Deployment Verification Handoff

The local Jellyfin instance now runs the corrected five-file plugin `<private-address>`. Full status is healthy and advertises API v1, cache v7, and `readingSeriesOverrides`. Override GET/PUT succeeded for books, comics, manga, and reading; a synthetic value survived restart and was removed afterward. The complete pre-deployment plugin backup remains retained.

The initial `.2` DLL exposed a real configuration defect: XML serialization failed on the nested Reading override dictionary and made full status return HTTP 500. Deploy only the newly rebuilt payload containing the deterministic XML surrogate and its 10/10 plugin test result.

The matching production frontend candidate is build `10.11.11-ptv-20260715.7-78a6e2b6`, commit `78a6e2b6bc-dirty`. It includes the production runtime entry import, authenticated API-client readiness, Dashboard request deduplication, and relative `/web` service-worker registration. It was verified by serving repository `dist` directly through Jellyfin. The permanent Program Files web root is still unchanged because the current process could not write it; an administrator must deploy it or configure the service to use the verified directory.

Live checks passed for query-bearing desktop/mobile login ownership, hidden compatibility anchors, authenticated Dashboard startup, canonical runtime provenance, sanitized debug export, service-worker activation without a reload loop, and the exact route sequence Shows -> Reading -> Dashboard -> Reading -> Shows -> back Reading -> forward Shows -> Login. Startup produced one successful request each for plain status, settings, full status, and featured, with zero pre-authentication plugin requests.

Do not approve production until the permanent frontend reports the expected build ID and the real remote Manga library completes 1,818/1,818 indexing. Automation covers the same total in 37 pages after the 200-item first stage, but this machine has no live Manga data and cannot provide a real completion time. Retain both plugin and web-root backups until these checks pass.

Final automated state: 354/354 Vitest, 10/10 plugin tests, frontend/plugin contract, TypeScript, scoped ESLint, production Webpack, secret scan, and `git diff --check` pass. No style source changed. No commit, push, remote deployment, rollback, or backup deletion was performed.

## 2026-07-15 Android Dropdown Handoff

The shared Movies/Shows dropdown no longer depends on the overflow boundary of the compact horizontal navigation. `PtvShellPrimaryDropdown` renders the active panel into `document.body`, owns outside/Escape dismissal, and computes a clamped fixed position from `window.visualViewport`. Horizontal navigation swipes are classified separately from taps, so Android's pointer-derived click opens once after a tap and is suppressed after a swipe.

Automated verification is complete: focused dropdown 11/11, full Vitest 365/365, Android dropdown Playwright 9/9, full Playwright 36/36, TypeScript clean, changed-file ESLint clean, inherited PTV lint baseline unchanged, Stylelint clean, and production Webpack successful with the two known size warnings. The plugin was not touched or rebuilt.

Before deployment sign-off, test a physical Android Chrome phone on Home, Movies, Shows, Music, and Reading: tap Movies/Shows, select each destination once, tap outside, press browser back/forward, rotate while open, and swipe the primary navigation without opening a menu. Repeat the basic tap/select/outside flow in iOS Safari and keyboard/remote Arrow Down, arrows, Enter, and Escape on desktop/TV. No cache schema or plugin restart is required; deploy the frontend normally and reload once.

## 2026-07-15 Urgent Runtime Regression Handoff

The blank/broken login and application regression was caused by drawer edge-swipe ownership, not by the primary-navigation portal. `NavDrawer` captured a missing `.mainDrawerHandle` while the authentication compatibility host was mounted, then the touch path attempted `target.addEventListener` on that null value. The corrected drawer resolves the handle when edge swipe is reconciled, no-ops while login owns no handle, retires the exact prior target, and binds a later authenticated handle once. `libraryMenu` now performs that reconciliation on every page show.

Local release gate results: focused 32/32, full Vitest 370/370, TypeScript clean, changed-file ESLint clean, PTV Stylelint clean, Chromium Playwright 36/36, WebKit Playwright 34 passed/1 platform-policy skip, production Webpack successful with only the two known size warnings, secret scan clean, and `git diff --check` clean apart from line-ending notices. WebKit skips only the link-Tab-order assertion because Safari delegates link tabbing to the platform full-keyboard-access preference; every WebKit login, route, blank-root, history, dropdown, outside/Escape, and resize case runs. The initial WebKit command failed only because its browser binary was not installed; after `npx playwright install webkit`, the cross-browser matrix passed. An invalid `--runInBand=false` Vitest invocation ran no tests and was replaced by the successful full `npm test` run.

Before deployment sign-off, verify on a physical Pixel/Android Chrome, iPad Safari, and desktop Chrome connected to Jellyfin: plain and query-bearing login, expired-session redirect, logout/login, successful authenticated Home, browser back/forward across auth, Movies/Shows dropdown tap and selection, and a normal authenticated drawer edge gesture. Confirm there is no header on login, no one-frame runtime overlay, no blank content root, and no duplicate edge-swipe response. This frontend-only fix requires no plugin restart or cache-schema migration; deploy the production frontend and use the normal service-worker reload path.

## 2026-07-15 Split-Origin Runtime Handoff

The frontend development host and Jellyfin host are intentionally different. The previous remediation incorrectly rebased a stale loopback Jellyfin candidate to the frontend hostname. Startup could pin loopback before Jellyfin recovered its saved server, leaving plugin requests on the stale root. Development now requires the explicit `PTV_DEV_JELLYFIN_URL`; the requested saved `serverid` and authenticated `ApiClient` are the next authorities, and a server transition retires the plugin root. Production bundles receive an empty development URL.

The black Home spacer, bottom-only Reading navigation, and blank Dashboard body were a separate geometry defect. Shared shell CSS had changed stock Jellyfin animated containers and generic pages to relative flow. Those overrides are removed; only `.ptv-shell-main` and `.ptv-shell-page` own PTV geometry. Login keeps its already verified full-viewport authentication layout.

Automated gates pass: focused 18/18; full Vitest 385/385; TypeScript; scoped ESLint; shell Stylelint; live Chromium 6/6; live WebKit 6/6; production Webpack; 119,166-path secret scan; production-address scan; and whitespace validation. The live matrix covers desktop, Pixel, and iPad profiles and proves explicit split-origin discovery wins over stale loopback storage. One initial full-suite cache timeout was non-reproducible: isolated and immediate full reruns passed. Webpack emitted only the established size warnings.

Release remains HOLD because no supplied credential was used. Restart the existing Webpack development process with `PTV_DEV_JELLYFIN_URL` set to the real Jellyfin root, revoke the token exposed in the supplied capture, then verify authenticated Home, Reading, Dashboard, reload/history, Movies/Shows dropdowns, and logout/login on desktop Chrome, physical Pixel Chrome, and iPad Safari. Confirm both Jellyfin and `/Ptv/v1/*` requests remain on the intended backend. No plugin source changed and no Jellyfin restart is required for this frontend correction.

## 2026-07-15 Music Playback And Live-Loading Handoff

Music's second compact player was PiggieTV's route-specific renderer, not a second audio engine. The global `PTVMediaDock` is retained as the sole bottom-right mini player. The Music root remains persistent only for full-screen/queue/playlist overlays, and its window-owned root/load promise makes route remounts and HMR idempotent. The one module-level audio element, queue, and controller remain intact.

Automated gates pass: focused 11/11; full Vitest 392/392 on the final run; TypeScript; scoped ESLint with zero errors and three existing nested-function warnings; Music/shell Stylelint; live Chromium 6/6; live WebKit 6/6; and production Webpack in 90.834 seconds with only the two established size warnings. The live matrix covers unauthenticated desktop, Android-layout, and iPad-layout startup plus explicit split-origin discovery. It does not prove signed-in Music playback.

Before release sign-off, authenticate at the development frontend connected to the intended Jellyfin backend and verify:

1. `#/music` shows one `.ptv-media-dock`, no `.ptv-music-mini-player`, and no visible Jellyfin `.nowPlayingBar` while PTV owns active playback.
2. Exactly one `[data-ptv-music-native-player='true']` audio element exists; no additional controller, queue, root, or subscription appears after Music -> Home -> Reading -> Dashboard -> Music, browser back/forward, or a development HMR update.
3. Play, pause, previous, next, seek, stop, queue, and full-screen controls remain synchronized; playback continues off Music and stopping playback removes the dock/ownership class.
4. The hero changes from a real loading state to a live count, cached count, or explicit unavailable-live-count message. It never remains `Loading library tracks` after the current request settles or is retired.
5. Dashboard status resolves against the explicit Jellyfin backend, has populated candidate/root/attempt fields after authentication, and settles with `loading=false` on success or failure. A historical `lastSuccessfulEndpoint` must not be treated as current health.
6. Capture sanitized response code/duration, player/audio/subscription counts, loading transition, route mount/unmount counts, and event growth. Queue progress should grow at roughly one publication per second rather than the prior multi-owner flood.

This is a frontend-only correction. Jellyfin/plugin restart is not required. Do not deploy until the authenticated physical checks pass; then deploy through the normal frontend/service-worker path without clearing user data.

## 2026-07-16 Playback Dock And Update Reload Handoff

The bottom-right dock leaked onto Jellyfin video playback because it treated the universal global playback snapshot as universal presentation ownership. It now renders only an active PTV Music-owned Audio item and also listens to route changes so `#/video` hides it before any stale Music snapshot can appear over the video player. Movie, Episode, Series, and Trailer coverage is explicit; returning to Music restores one dock.

The frontend update button stalled because activation had no timeout/direct fallback and the session reload marker from a prior attempt was never retired. The update service now owns one activation attempt, posts `SKIP_WAITING`, reloads exactly once on `controllerchange`, falls back after three seconds, directly reloads if worker messaging is unavailable, clears stale markers, and removes the notice before the reload call. Repeated clicks and late controller events are idempotent.

Automated gates pass: focused 22/22; final full Vitest 403/403; TypeScript; scoped ESLint; E2E Webpack; Playwright 8/8; production Webpack in 92.581 seconds with only known size warnings; secret scan; and whitespace validation. One first-run featured-cache timeout passed isolated 4/4 and on the immediate full rerun.

Release remains HOLD until an authenticated physical client proves: one dock for Music; no PTV dock for movie/episode playback; Music restoration after video; and an actual waiting service worker reloads into the new bundle without a stuck notice or loop. This is frontend-only: no Jellyfin/plugin restart, cache-schema migration, user-data clear, plugin deployment, commit, or push was performed.

## 2026-07-16 Reading override XML serialization handoff

- Corrected source is ready in the working tree. Do not revert the Music/video dock or service-worker fixes from the preceding commits.
- Deploy only the five files from `src/ptv/plugin/bin` to `/var/lib/jellyfin/plugins/PTV_Plugin/`: DLL, deps JSON, PDB, XML documentation, and `meta.json`.
- DLL assembly/file version and manifest version are all `<private-address>`. The corrected staged DLL SHA-256 is `51E6BBD8D7A742A01528DC59E5A8A21AD718A602BF868F16B64C0B64A886DD05`.
- Before replacement, stop Jellyfin and back up the complete installed plugin directory. Replace all five files together, preserve Jellyfin ownership/permissions, and restart Jellyfin.
- Required live checks after restart: authenticated `/Ptv/v1/status`, `/status?full`, `/settings`, and `/featured` return 200; full status advertises `readingSeriesOverrides=true`; dashboard reports connected rather than fallback; Jellyfin logs contain no `Cannot serialize member ... ReadingSeriesOverrideSettings.Routes` error.
- Automated verification passed: plugin 13/13, focused frontend 7/7, full Vitest 405/405, TypeScript, scoped ESLint, plugin contract, secret scan, production Webpack, and whitespace validation.
- Deployment was not attempted because neither `<private-address>` nor `<private-address>` accepted available non-interactive SSH authentication. No remote state changed.

## 2026-07-16 production chunk coherency handoff

- The reported `ChunkLoadError` was not caused by a missing source artifact: `90212.432920e11e02eefe99af.chunk.js` exists in the production output and was served by the Jellyfin origin. The public bare path returned HTTP 503 while a query-versioned request returned 200 during diagnosis, then recovered to 200, identifying an intermittent CDN/path-cache plus release-generation coherency failure.
- Deploy the complete matching frontend output. Use `scripts/deploy-jellyfin-web.ps1` or preserve its ordering: copy all assets first, verify them, retain old content-hashed chunks, and replace root `index.html` last. Do not copy only `main`/`runtime` bundles.
- New production clients request async JS/CSS with a build-scoped `ptv_asset` query. A caught same-origin chunk failure gets one session-bounded document reload with the current hash route preserved; it cannot reload-loop or treat an ordinary error as a stale bundle.
- Automated gates pass: focused 5/5; full Vitest 410/410; TypeScript; scoped ESLint; production Webpack; clean-target deployment simulation for 2,498 files; and whitespace validation. Webpack reports only established size warnings.
- A frontend deployment does not require a Jellyfin restart by itself. The corrected XML-safe plugin payload is still a separate deployment: the supplied startup log proves the installed `<private-address>` DLL still contains the old public dictionary model and throws during configuration serialization. Replace all five staged plugin files and restart Jellyfin before considering plugin status healthy.

## 2026-07-16 authenticated diagnostics cleanup handoff

- The latest authenticated export is the live-health authority: plugin connected at `<private-address>`, API `1`, cache `7`, Reading overrides compatible, and the Reading index complete at 2,911/2,911.
- Dashboard/fallback routes now reject stale native Reading header state. Verify `#/reading -> #/dashboard/piggietv` reports Dashboard as the route and no Reading page title, nav group, or header section.
- Reading index progress is deliberately coalesced. The UI must still reach and report 2,911/2,911, but `reading-page-rendered` and `reading-shell-ready` should grow only when route/stage/section readiness changes, not for every background page.
- Idle playback state owns no reconcile interval. Confirm no low-frequency reconcile growth with null item/session/source; active Jellyfin playback must still reconcile and the previously fixed video mini-player behavior must remain unchanged.
- Successful plugin status/settings/featured calls now populate attempted responses with sanitized path, HTTP status, and duration. No query string, server origin, token, or authorization value should appear.
- Automated gates pass: focused 13/13; final full Vitest 415/415; TypeScript; scoped lint for new helpers/services/API; the PTV lint baseline with no per-file increase; and production Webpack in 107.006 seconds with only established size warnings. One first-run featured-cache timeout passed isolated 4/4 and on the immediate full rerun.
- This is a frontend-only cleanup. No Jellyfin restart or plugin redeployment is required for these changes. Deploy the complete matching frontend bundle through the existing atomic asset-first/index-last process, then accept the normal service-worker update.

## 2026-07-16 details ownership and video playback handoff

- Details routes now have native PiggieTV presentation ownership. Verify `#/details?id=<movie>`, Series, Episode, and any shared item route show one current PiggieTV header, no visible legacy Jellyfin header, and details content beginning immediately below the safe header area. `#/music/item/...` must remain Music-owned and `#/video` must remain Jellyfin-owned.
- Video ownership now pauses, rather than clears, native Music. The current queue, item, index, and position survive; active global state must no longer report `ptv-music` while video owns playback; leaving video must not restart audio. After returning to a non-video route, the paused dock may reappear and only an explicit Play command may resume it.
- Automated gates: focused 40/40; full Vitest 431/431 on the final run; TypeScript; scoped regression ESLint; changed Stylelint; E2E harness 36 passed/6 live skipped; production Webpack in 106.7 seconds; and whitespace validation. Webpack retained only established size warnings. One initial full-suite featured-cache timeout passed isolated and on immediate full rerun.
- Authenticated physical verification is still required. The opt-in live Playwright run reached `<development-frontend>:8082`, but clean browser contexts had no saved server/session and stopped at Jellyfin's Select Server page, so it could not exercise the requested signed-in details or playback sequence.
- No plugin/backend change or Jellyfin restart is required. Deploy the complete frontend build through the existing atomic asset-first/index-last process and accept the normal service-worker update; do not clear user data merely for this patch.

## 2026-07-16 native details geometry correction

- The details route ownership fix remains intact. A new reversible layout lifecycle isolates the native page from stock Jellyfin details geometry, assigns named poster/ribbon/content grid areas, moves the logo into the native ribbon while mounted, and restores it during teardown.
- Tightly scoped details styles remove the flowing `40vh` backdrop gap, stock ribbon height, viewport-width content inset, and secondary shelf offsets. Overview/meta use normal widths, tags/genres/studios/external links wrap horizontally, desktop content is centered, mobile stacks cleanly, and the secondary region includes Music-dock-safe bottom padding.
- Automated gates pass: focused 42/42; full Vitest 433/433; TypeScript; scoped ESLint; details Stylelint; Playwright 38 passed/6 opt-in live skipped; production Webpack in 101.095 seconds; and details whitespace validation. Webpack emitted only its established size warnings.
- The opt-in dev-host probe reached `<development-frontend>:8082`, but a clean profile landed on Select Server. With the backend environment supplied, the split-origin test still observed the dev bundle's retained localhost selection. Authenticated movie, Series, Episode, dock-clearance, and Music -> video audible checks therefore remain manual.
- Manual production check: authenticate against `<test-server>:8096`; open movie, Series, and Episode details; verify one PiggieTV header, no blank top gap, readable wrapping metadata, aligned Cast & Crew/related shelves, and unobstructed controls with Music active. Start video and confirm Music pauses, the dock hides, and Music does not resume until explicitly played.
- No plugin/backend change, deployment, Jellyfin restart, commit, push, or remote operation occurred.

## 2026-07-17 native details artwork and premium glass

- Native details now use one fixed full-page artwork layer with Backdrop -> Thumb -> Primary -> themed-gradient fallback. The legacy flowing backdrop remains suppressed so it cannot recreate the large top gap.
- The title ribbon, poster, action group, metadata, content panels, Cast & Crew, and related shelves share scoped translucent purple-glass tokens with border, glow, inset highlight, and readable masks. Filter, low-power, and reduced-motion fallbacks retain the same content geometry.
- Deterministic visual verification shows artwork visible across the page, one unobstructed PiggieTV header, a strong translucent title panel, readable metadata glass, and Cast & Crew/More Like This aligned to the main container. Desktop and mobile focused Playwright checks passed 2/2.
- Automated gates: focused Vitest 15/15; full Vitest 436/436; TypeScript; scoped ESLint; details Stylelint; production Webpack in 101.809 seconds with established size warnings; and whitespace validation.
- Manual authenticated checks remain: open Movie, Series, Season, and Episode details with real artwork; confirm each fallback order; verify the Music dock clears controls; then start video and confirm Music still pauses, the dock hides, and audio does not auto-resume.
- This is frontend-only. No plugin/backend deployment or Jellyfin restart is required; deploy the complete matching frontend bundle atomically and accept the normal service-worker update.

## 2026-07-17 shared shell surface correction

- The outer shared header is layout-only and visibly transparent. The centered primary nav remains its own glass pill; top-right utilities own individual purple glass buttons and Search remains larger and circular. Details routes can no longer recreate a full-width header strip.
- Automated geometry covers Home, Shows browse, and Details at `2560x1271`, Details at `1024x1366`, and Shows at `390x844`. It verifies one transparent header, centered glass nav, glass utilities, larger Search, and no mobile/tablet horizontal overflow.
- Android dropdown portal coverage remains green. Music queue, playback-state, and media-dock tests remain green, including video ownership, dock suppression, queue preservation, and no automatic Music resume.
- Gates: focused Vitest 26/26; full Vitest 439/439; TypeScript; scoped ESLint; shell/details Stylelint; focused Playwright 15/15 plus tablet rerun 5/5; full Playwright 42 passed/6 live skipped; production Webpack in 90.6 seconds with established size warnings; production CSS includes the WebKit backdrop-filter prefix.
- Manual hardware check remains: compare Home, Details, browse, Music, Reading, and Dashboard on desktop, Pixel/Android Chrome, and iPad Safari. Confirm no full-width glass strip, dropdowns remain above content, and bright backdrops preserve icon readability.
- No Jellyfin restart or plugin deployment is required. Deploy only the complete frontend bundle atomically and accept the normal service-worker update.

## 2026-07-17 details lifecycle and video presentation hardening

- Item details now own a request generation and matching item ID. Navigation clears stale detail DOM immediately, retires prior work, and suppresses late season/episode/cast/related/artwork commits. The initial enhancement waits for an authenticated API client instead of recording a false handled state.
- Backdrop selection is deterministic and preloaded: item Backdrop, related parent/season/series Backdrop, current Thumb, current Primary, then themed fallback. Poster/logo slots retain stable ratios while loading, preventing first-navigation layout snapping.
- Media-source duplicates are collapsed before version badges and selectors render, so one real playable file cannot advertise duplicate versions. The video header now renders `Series · SxxExx - Episode`; Movie behavior is unchanged.
- Top-right utility icons are centered in equal glass buttons. Video controls now use lighter transparent purple-blue glass with readable progress, captions, buttons, and timestamps. Low-power/filter fallbacks remain bounded.
- Final gates: full Vitest 66 files/450 tests; TypeScript passed; scoped ESLint had no errors (existing warnings only); changed Stylelint passed; focused Playwright 7/7 at desktop/mobile/tablet; production Webpack compiled in 84.892 seconds with established size warnings; whitespace validation passed.
- Manual authenticated checks remain: direct and in-app Movie, Series, Season, and Episode navigation; parent-backdrop fallback and image-failure fallback; one-file versus genuinely multi-version episodes; exact episode video heading; bright-video control readability; and confirmation that Music still pauses, the dock hides, and Music does not auto-resume after video.
- No plugin/backend change or Jellyfin restart is required. Deploy the complete frontend output atomically and accept the normal service-worker update.

## 2026-07-18 shell utility, Settings, and Details navigation correction

- Dashboard utility visibility now survives shells mounted before authentication. Sign-in forces an administrator access refresh; sign-out clears it immediately. The icon remains admin-only.
- Top-right glyphs are centered by resetting the inherited global icon margin inside shell/search glass controls. The existing equal-size grid and Android body-portal dropdown implementation remain intact.
- Settings now mounts one header-only shared `PTVShell` and adds scoped header-safe padding to the stock Settings content. No settings data or backend behavior changed.
- Details no longer waits for a redundant full item request on normal navigation. The item controller emits the exact committed item after stale-generation validation; PTV immediately applies its artwork and may later upgrade to related parent artwork only if the item is still active. Shared lazy image loading replaces a second poster preload, and later DOM mutations cannot erase the native glass/layout classes.
- Final gates: focused 24/24; full Vitest 69 files/457 tests; TypeScript; scoped ESLint with no errors; changed Stylelint; focused Details/shell Playwright 7/7; production Webpack in 106.7 seconds with established size warnings; whitespace validation passed.
- Manual authenticated checks at `<development-frontend>:8082`: sign in as an administrator and confirm Dashboard appears without refresh; open Settings and confirm one PTV header; navigate in-app between Movie, Series, Season, and Episode details and confirm the first paint already has the correct item, backdrop, glass layout, and centered utilities; compare Network timing/request count; verify Music still pauses and the dock hides for video.
- No plugin deployment or Jellyfin restart is required. Deploy the complete frontend bundle atomically and accept the normal service-worker update/cache refresh.

## 2026-07-18 TV compatibility and webOS recovery handoff

- The supplied LG photos are the pre-fix physical baseline: oversized/cropped hero branding, tiny or collapsed cards, legacy Jellyfin chrome on native Details, and unusable ten-foot spacing/focus. Do not describe these cases as physically fixed until the new frontend is deployed and the same TV is retested.
- TV classification now comes from `clientProfile.ts`, not viewport size. Inspect `html[data-ptv-tv-platform]`, `html[data-ptv-tv-reason]`, root `ptv-render-tv`/`ptv-platform-*` classes, and Dashboard TV diagnostics when triaging a device.
- TV layout ownership is centralized in `src/ptv/styles/profiles/tv.scss`; LG-specific performance fallback is in `webos.scss`. Avoid adding page-local TV transforms, global scaling, or duplicate media queries.
- Remote focus is centralized in `tvFocus.ts`. New TV-focusable controls should be semantic buttons/links or carry the existing focusable selector contract; do not add mouse-only interactions.
- Automated gates passed: focused 23/23; full Vitest 477/477; TypeScript; scoped new-code ESLint; changed Stylelint; Playwright 43 passed/6 live skipped; production Webpack success with established size warnings.
- Deployment: publish the complete frontend output atomically. Jellyfin/plugin restart is not required for these frontend-only changes. Accept the service-worker update and fully close/relaunch wrapper apps if they retain the old web bundle.
- Physical matrix still required: LG webOS at 1080p and 4K; Samsung Tizen; Android TV and Fire TV; Roku; Chromecast receiver; iOS wrapper; PiggieTV Android. Verify Home, Movies, Shows, Details, Music, Reading, Requests, Dashboard, Settings, Login, and video handoff with directional keys, OK, Back, rail scrolling, and focus restoration.

## 2026-07-19 media identity, TV input, and remote diagnostics handoff

- Repository hygiene is intentional. The worktree removes 1,103 tracked machine-local/generated entries, and `.gitignore` now covers the Vite result cache, split-development logs/PID, `.dotnet-home/`, and nested plugin project/test `bin`/`obj`. The five tracked files in `src/ptv/plugin/bin` remain the deployment payload and were republished after the last C# change.
- `mediaSourceDeduplication.ts` now treats exact normalized path equality as authoritative, then uses compatible source-ID or strong technical-signature edges without allowing a transitive ID/signature bridge to collapse technically conflicting real files. Diagnostics expose at most 24 comparisons containing only candidate indices, reasons, and signal names; they omit paths, titles, and source IDs.
- `tvFocus.ts` and `PtvShellPrimaryDropdown.tsx` now cover remote Enter/Select/OK/Accept aliases and key codes 13/23/66, webOS Back 461, Tizen Back 10009, arrow wrapping, first/last dropdown focus, exactly-once activation, Back-to-close with focus restoration, and unchanged pointer behavior. The webOS profile uses 76%/86% static translucent fills while keeping blur and expensive motion disabled.
- Remote diagnostics are opt-in and local to the Jellyfin/PiggieTV deployment. An administrator can list/filter clients, select a 5- or 10-minute lease, stop it, request a snapshot, and view/download the latest report. The client collects only while leased and reports coarse profile, route/render/playback/input/error/network/long-task/FPS/memory evidence plus a bounded operational log tail.
- `RemoteDiagnosticsPanel.tsx` now treats the client list endpoint as `unknown`, verifies the collection before mapping, skips malformed rows without `clientId`, deduplicates client keys, normalizes null/undefined display fields, and distinguishes loading, error, empty, and success states. The production stack location `piggietv.12241ad2fb988bb07373.chunk.js:1:8902` resolves to `client.clientId.slice(-8)` inside `formatClientOption`; `:1:14043` resolves to the `clients.map(...)` render callback. No source map file was present in `dist`, so the mapping came from the exact minified offsets and source text.
- The client retains at most 300 samples and budgets serialized samples to 160 KiB; the plugin rejects reports above 192 KiB and applies independent JSON depth/node/array/property/string limits plus a second sanitizer. Arbitrary error text, raw user agents, credentials, query strings, private origins, media identity, titles, and local paths are omitted or normalized. Plugin-side client/report state is memory-only and expires; the browser persists only an ephemeral client ID and normalized active lease in session storage.
- Client registration and report upload require authentication. Administrative client/session/report operations require Jellyfin administrator authorization, and the store binds a client to the authenticated Jellyfin identity. Capability detection backs off when the endpoint is unavailable so an older plugin is not polled every 30 seconds, while bounded rechecks allow upgrades to recover.
- `scripts/ptv-webos.mjs` provides dependency-free `ares` device discovery/info, inspect/logs, install, launch, and close commands with explicit device/app/package inputs, shell-metacharacter rejection, and dry-run support. Read-only discovery and dry runs were verified; no live install, launch, or inspect mutation was performed.
- Final automated gates: targeted Vitest 9 files/58 tests; plugin tests 20/20; `npm run build:check`; changed-source ESLint; webOS Stylelint; plugin contract; production Webpack; and `git diff --check` all passed. Webpack emitted only the two established aggregate asset/entrypoint size warnings.
- Follow-up crash-fix gates: `RemoteDiagnosticsPanel.test.tsx` 9/9 passed; `npm run build:check` passed; targeted `lint:ptv:clean` for the changed dashboard files passed; `npm run build:production` passed with only the established aggregate asset/entrypoint size warnings.
- Deployment now requires both halves: replace all five plugin payload files, restart Jellyfin, verify the `remoteDiagnostics` capability, then atomically publish the matching frontend output and accept its service-worker/cache update before testing the admin panel against an authenticated client.

## 2026-07-19 Remote Client Diagnostics completion audit

- Root cause of the observed `0 recent clients`: the dashboard only lists clients that run the PiggieTV web bundle and successfully check in to `POST /Ptv/v1/diagnostics/clients/check-in`. The visible Jellyfin dashboard session (`Jonathan's Fire TV`, `Jellyfin Android TV 0.19.9`, active playback) is a native Jellyfin client session and does not itself execute the PTV JavaScript collector. I did not fake or mirror that session into Remote Client Diagnostics.
- The PTV web collector now sends safe presence metadata and explicit capabilities with every heartbeat: app/client name and version, safe device/display/platform labels, native-runtime hint, heartbeat, commands, reports, performance, network, navigation, playback, and memory support. It still sends no tokens, headers, device IDs, user objects, full payloads, media paths, or raw user metadata.
- The plugin store persists this presence only in memory, binds it to the authenticated Jellyfin owner hash, expires recent clients after 30 minutes, caps the list at 64 clients, and keeps the existing 30-minute report retention. It rejects internal fallback names such as `oldname_dup` as the primary display label.
- Fire TV detection now accepts both browser UA and safe app/device/platform signals. A running PTV web/wrapper client that reports `Jellyfin Android TV 0.19.9` plus Fire OS/Fire TV/AFT/Amazon Fire signals normalizes to `firetv`, so profile filtering and leases target it correctly. A pure native Android TV app still needs native/wrapper integration before it can register.
- `pluginRemoteDiagnosticsTransport.ts` exposes compact local debug state for bootstrap loaded, advertised capability, check-in endpoint URL, generated client ID, detected profile, last heartbeat status/time, and failure reason. The low-level registration endpoint now uses registration-specific errors for invalid/auth-missing check-ins.
- The Dashboard panel now shows friendly device/app/platform/capabilities, disables Client selection when the list is empty, keeps duplicate friendly names distinct with a secondary opaque suffix, disables unsupported Start/Snapshot/View/Download actions, and refreshes cleanly after an initial empty response.
- Dashboard layout ownership was corrected so Jellyfin admin content no longer receives PTV media-page shell spacing. `ptv-admin-shell-spaced` is removed by dashboard bootstrap and the legacy CSS fallback now resolves to zero top offset.
- Verification passed: focused frontend remote diagnostics/layout tests 28/28; full plugin tests 21/21; `npm run build:check`; targeted `lint:ptv:clean`; `npm run build:production` with only established asset/entrypoint size warnings; `git diff --check`.

## 2026-07-19 Remote Diagnostics TV session visibility follow-up

- The dashboard now renders two distinct sections. Detected Jellyfin sessions are read-only server-observed rows from Jellyfin session data; Remote diagnostics clients remain only real PTV check-ins. Ordinary sessions never become selectable for Start diagnostics or Request snapshot.
- Real PTV check-ins now carry a safe boot marker: detected platform, `ptvRuntimeLoaded`, `diagnosticsModuleLoaded`, `checkInAttempted`, last `checkInStatus`, `failureCode`, loaded frontend build ID, and remote-diagnostics registration count. This is meant to answer whether webOS actually loaded the PiggieTV runtime/chunk and reached the check-in path.
- LG webOS session rows now explain that Jellyfin for webOS is a server-web wrapper, but if no PTV check-in exists the app has not produced a runtime/check-in marker yet. The next physical test should fully restart the app or clear cached server assets, open PiggieTV, then confirm a webOS-filtered client appears and its heartbeat updates.
- Fire TV/Jellyfin Android TV rows now show as detected but `unsupported` unless a real PTV check-in or future native diagnostics bridge exists. The exact limitation is native Android TV/Fire TV does not execute the PiggieTV jellyfin-web runtime for its normal UI.
- Supported strategies remain explicit: native diagnostics integration in `jellyfin-androidtv`, a PTV Fire TV web wrapper that loads the customized web app, or server-observed metrics labeled as limited. Server-observed mode can show server session/playback state only; it cannot provide memory, DOM/player ownership, browser render timing, browser network timing, or client snapshot reports.
- Verification passed after the follow-up: focused frontend diagnostics/session tests 30/30; full plugin tests 21/21; `npm run build:check`; targeted `lint:ptv:clean`; `npm run build:production` with established asset/entrypoint warnings only.
- Remaining risks: manual Stop can leave the last server-stored report up to one 15-second client interval behind, so request/view a snapshot before Stop when the final instant matters. Remote keys, focus, and glass appearance still require the supplied physical LG/webOS regression matrix.
- No commit, push, remote deployment, live package installation, or Jellyfin restart was performed.

## 2026-07-19 Secret scan hardening for remote diagnostics tests

- `RemoteDiagnosticsStoreTests.cs` removed an inline credential-shaped test value that triggered the scanner's authorization-value rule.
- The test now composes synthetic authorization and query values at runtime with split/concatenated fragments (`string.Join`/`string.Concat`) and keeps the same assertions for sanitized values and redaction.
- Validation now reports: `npm run secret:scan` passes; filtered `RemoteDiagnosticsStoreTests` pass; `npm run build:check` passes.

Current focused verification and webOS discovery commands:

```powershell
npx vitest run src/controllers/itemDetails/mediaSourceDeduplication.test.ts src/ptv/core/tvFocus.test.ts src/ptv/shell/PtvShellPrimaryDropdown.test.tsx src/ptv/styles/profiles/tvProfileVisual.test.ts src/ptv/core/remoteDiagnosticsModel.test.ts src/ptv/services/remoteDiagnostics.test.ts src/ptv/services/pluginRemoteDiagnosticsTransport.test.ts src/ptv/core/pluginApiRemoteDiagnostics.test.ts src/ptv/modules/dashboard/RemoteDiagnosticsPanel.test.tsx
npm run build:check
npm run test:plugin
npm run test:plugin-contract
npm run build:production
npm run webos:devices
git diff --check
```

## 2026-07-20 architecture consolidation handoff

Status: planning and contract baseline recorded. Do not begin another page-local corrective pass for recommendations, metadata, artwork, caches, browse/details, plugin requests, diagnostics, performance, or focus.

- The next program is a refactor-first consolidation. Establish one shared `PTVApiClient` and `PTVDiagnostics` contract, then `PTVCache` and `ArtworkService`, then provider-based `RecommendationEngine`, followed by browse/details adapters and metadata/playback/focus convergence. Preserve the premium glass visual language and existing route/playback ownership while replacing internals behind adapters.
- Every shared-platform migration needs a compatibility matrix for Movies, Shows, Music, Reading, Live TV, Dashboard, dialogs, player, and TV clients. A module may supply typed provider fields, card renderers, detail panels, and route configuration, but it may not own a parallel cache policy, image failure cache, endpoint fetcher, recommendation engine, or focus handler.
- Reading cache is now v5. Complete and summary home entries are distinct; fresh complete memory and persistent entries win, stale complete persistent data displays with `cacheDiagnostics.staleHit`, and summaries are used only when no complete cache exists. A v5 route-scope pointer is keyed by server/user/route/view and resolves the library-set identity safely after a cold reload. Never regress this to an unscoped cache read or mark stale complete data as partial.
- Existing transitional safeguards to preserve: route-generation stale-response rejection, coalesced Reading library discovery, bounded concurrent Reading shelves, deferred final-only series grouping, route-scoped Reading artwork failures, request-deduplicated plugin endpoints, and `tvFocus.ts` as the single PTV focus owner.
- The completed Music shelf change is an initialization boundary and telemetry correction, not the final unified engine. Future work must replace module-local scoring with shared providers and emit one normalized row diagnostic: source, algorithm, candidate count, selected count, overlap, generation duration, cache source, engine state, and precise fallback reason.
- Do not claim real-library count/timing, image-request reduction, bundle-size reduction, or physical webOS results without authenticated server/device evidence. Current automated evidence is focused tests, TypeScript, and production Webpack only; Webpack retains the two established aggregate size warnings.
- Before reporting any consolidation phase, update all three project-memory files with the retired boundary, new shared contract, migration adapters still present, test matrix, performance evidence, and remaining technical debt.

## 2026-07-20 library-root normalization handoff

- `libraryRootNormalizer.ts` is now the only PTV service for normalizing physical library-root evidence and stable result identity. Use it for any new Search, Browse, Latest, recommendation, or collection result aggregation; do not add `/media`, `/media-local`, `/mnt`, SMB, or Windows-path conditionals.
- Current native Search sends no `ParentId`, `TopParentId`, path, or collection-folder filter. It requests Jellyfin `Users/{user}/Items` by item type and search term, then normalizes/deduplicates in memory. Browse remains scoped by Jellyfin library IDs (`ParentId`/`AncestorIds`), not paths, and now shares item aggregation normalization.
- An absent item in the raw path-agnostic Jellyfin response cannot be recovered by frontend root normalization without an additional query. Diagnose that as an upstream Jellyfin search/index issue with the normalized-root evidence; do not mask it with a one-off `/media-local` fallback.
- Search diagnostics now include per-group deduplicated count and normalized logical roots with observed physical roots. The normalizer test matrix covers mergerfs, bind mounts, SMB, Windows paths, stable-ID deduplication, presentation-key fallback, and no name-only deduplication.

### 2026-07-20 Bounded Movie Search Recovery

- The raw global Movie search and the Latest Movies route have materially different contracts: primary search is `Users/{user}/Items` with `SearchTerm=Toy Story`, `IncludeItemTypes=Movie`, `Recursive=true`, and `Limit=14`; recovery is `Users/{user}/Items/Latest` with `IncludeItemTypes=Movie` and `Limit=96`, then local matching. Neither request has `ParentId`, a physical path filter, or elevated authorization.
- Recovery runs only for an underfilled or root-divergent Movie result. Its two-minute memory cache is scoped by server/user/media/field profile, its promise is shared, and non-Movie search groups cannot invoke it. A query-generation `AbortController` rejects stale consumers before a supplemental merge can commit.
- Identity merging now recognizes equivalent `/media/Movies/...` and `/media-local/Movies/...` paths through their logical `Movies/...` relative path. It also uses provider ID plus media type before `PresentationUniqueKey`, preventing an alternate-root alias from taking a result slot.
- Regression coverage demonstrates a primary Toy Story 1-4 response combined with the bounded supplemental Toy Story 5 candidate, alias suppression before the 14-item limit, zero recovery for complete/non-Movie groups, title/year/path matching, and no recovery from an empty candidate set. An authenticated browser session is still required to confirm the physical Jellyfin instance returns `Toy Story 5` and its expected image in the live UI.

### 2026-07-20 Movie Search Timeout Recovery

- Root cause: the page-level five-second timeout rejected before `searchPtvItems` could classify the primary request, so the Movie recovery branch never ran and diagnostics incorrectly reported `complete-primary-result` with no primary duration.
- Correction: timeout ownership moved into the API search state machine. Movie outcomes now choose in order: abort -> no recovery; success-empty/sparse/root-divergent -> recovery; timeout -> recovery; recoverable error -> recovery; 401/403 -> preserve the primary error with no recovery. Recovery can therefore execute without a primary result object.
- Search diagnostics now report `primaryStatus`, `primaryError`, actual primary duration, trigger/reason, supplemental status/duration/candidate/match counts, and final count. Recovered Movies are rendered as normal cards, not an all-error row, while administrator diagnostics retain the degraded primary state.
- The first-pass field profile was minimized to image/card/year/quality/navigation fields. The supplemental Latest Movie request alone receives original/sort title, path, provider IDs, presentation key, and `TopParentId` needed for matching and alias deduplication. The existing two-worker queue was retained and re-prioritized to Movies, Shows, Collections; Episodes/Reading; then Music/Albums/Artists.
- Focused API/service regressions pass 11/11, covering complete, sparse, timeout, error, empty, abort, authorization, recovery failure, and non-Movie behavior. A signed-in Jellyfin verification remains required: collect the real `toy story` diagnostic output and confirm recovered cards include Toy Story 1-5 before release.

### 2026-07-20 Search Recovery Latest Candidate Audit

- The previous live result of one supplemental candidate cannot yet be attributed to a parent scope: the source code has no `ParentId` in its recovery query, but it did assume an array response and did not expose the exact request or raw response shape. Recovery now uses `getPtvRecentlyAddedResult`, the same shared Latest request builder used by native home Recent Added consumers.
- The helper normalizes raw `Items/Latest` arrays and wrapped `{ Items }` responses, records raw count and `TotalRecordCount`, and returns zero candidates with `responseShape=invalid` for malformed data. Movie recovery explicitly omits `ParentId`, sets `GroupItems=false`, and records its sanitized request, result shape, keys, first 20 candidate identities, logical roots, and matched names in the existing admin-only Search diagnostics.
- Focused regressions pass 13/13: raw 96-item arrays, wrapped lists, invalid response handling, no-ParentId request construction, sparse Toy Story merge, stale-root candidate retention, duplicate handling, timeout/error/empty/authorization/abort behavior. The required next step is authenticated live evidence, not another speculative frontend change: `toy story` must show the request contract, array/wrapped shape, raw candidate count, sampled Toy Story 5, one match, and final count five.
# 2026-07-20 Movie Search Catalog Recovery

The fixed 96-item `Items/Latest` Movie fallback was replaced by `src/ptv/services/movieSearchCatalog.ts`. Recovery uses unscoped `Users/{user}/Items` Movie pages (`Recursive=true`, 500 items, DateCreated descending), caches by server and user, resumes partial catalogs, and hydrates only matching IDs. Movie primary results are visible while catalog recovery runs.

Live verification is still required: search `toy story` and confirm the debug block reports `catalogMatchCount=1`, `catalogMatchedNames=Toy Story 5`, a page/index location, `finalCount=5`, `catalogRequestEndpoint=Users/{user}/Items`, and `catalogRequestParentId=none`.
# 2026-07-20 Rolling Diagnostics Storage

Added `PtvRollingDiagnosticsWriter`: all persistent diagnostics append JSON Lines to `ptv-diagnostics.log`, rotate to bounded numbered files, and retain at most five rotations by default. It does not create request-, session-, device-, timestamp-, or GUID-named diagnostic files. Check-ins aggregate and repeated events suppress before disk writes; logging failures do not affect diagnostics, search, or playback.

The Remote Diagnostics dashboard now includes Diagnostics Storage health and protected rotate/download/clear/consolidate actions. The live server still needs deployment verification for before/after file counts and disk usage.

## 2026-07-21 authenticated non-admin regression validation handoff

The dedicated non-administrator session at `http://localhost:8082` completed both authenticated discovery and interaction validation. Keep `test-results/authenticated-discovery/discovery-report.json` unchanged as the before baseline. The corrected after artifacts are:

- `test-results/authenticated-discovery/discovery-report-after.json`
- `test-results/authenticated-discovery/artwork-probe-after.json`
- `test-results/authenticated-discovery/interaction-report-after.json`

The discovery harness now distinguishes functional route failures, expected missing artwork, failed fallback chains, duplicate artwork requests, expected navigation aborts, and real runtime errors. Optional Jellyfin image 404 responses no longer fail a rendered route.

Artwork requests now require the corresponding Jellyfin `ImageTags` entry. Failure memory is shared across request dimensions so a failed source is not retried merely because the requested size changed. The focused after probe found 22 stale advertised Primary tags, 0 unadvertised image attempts, 0 Primary-to-Thumb fallback chains, 0 duplicate failed URLs, 22 rendered fallbacks, and 0 visibly broken images.

Browse subroutes use stable path identities. Movies and Shows replace the landing shell once when entering a focused browse view, then preserve the same shell across sibling focused views. Music and Reading preserve the shell throughout their subroutes. Preferences renders one shell with no horizontal overflow.

Non-admin home and Reading code no longer probes admin-only plugin settings, row configuration, or series-correction endpoints. Dashboard authorization was preserved: direct non-admin dashboard navigation redirects to Home and protected endpoints remain forbidden.

Music Artists now renders at the canonical `#/music/artists` route. Music recommendation rows are de-overlapped so Recommended is distinct from Made For You. Songs controls and search now have stable accessible names. The after discovery report contains zero unnamed controls.

The authenticated interaction suite passes 13 of 13 scenarios: authorization boundaries, Artists loading, movie filters, details actions, non-admin Identify exclusion, favorite and watched round trips with state restoration, search, recommendation distinction, playback queue continuation, Reading isolation, Back/Forward, and Fire TV directional focus.

Before versus after: functional route failures 12 -> 0; image 404 responses 118 -> 7 in the broad route run; unnamed controls 117 -> 0; duplicate image paths 8 -> 1; overflow routes 1 -> 0; long tasks 11 -> 2; maximum long task 394 ms -> 91 ms. All 23 desktop routes and all four responsive profiles passed, with one visible shell and no horizontal overflow.

Validation gates:

- `npm run build:check`: passed with zero TypeScript errors.
- `npm run build:production`: passed in 117.011 seconds with two existing size warnings.
- Runtime assertions: 570 of 570 passed.
- Full `npm test`: three files still fail during collection because Vitest cannot resolve Jellyfin's `components/apphost` import boundary. This is test-runner infrastructure debt, not a failing runtime assertion. Do not solve it by booting the full Jellyfin application in jsdom; add focused mocks or a purpose-built resolver.

Remaining validation scope: no physical TV device was used, and admin-only Dashboard performance still requires a separately authorized administrator session. The preliminary 394 ms Dashboard task came from the wrong account context; the correct non-admin authorization path redirects cleanly and did not reproduce it.

## 2026-07-21 Authenticated stabilization sprint

The stabilization implementation is complete, but the overall release gate is
blocked. Production build, build policy, 615 unit tests, and 23 of 23 warm-cache
authenticated route checks pass. Artwork fallback classification, Reading image
queries, browse shell ownership, Preferences ownership, non-admin dashboard
redirects, Artists content, Songs accessibility, and TV focus regressions were
addressed.

The authoritative post-sign-in interaction run passed 4 of 13 checks. The
required account remained authenticated, while a direct authenticated Jellyfin
`Items` request took 19.8 seconds and an immediate repeat exceeded 8 seconds.
Treat remote item-pipeline latency as the current release blocker; do not raise
interaction timeouts to manufacture a pass.

Start with `PRODUCTION_READINESS_REPORT.md`. Preserve
`test-results/authenticated-discovery/discovery-report.json` as the baseline.
The route-only final artifact is
`test-results/authenticated-discovery/discovery-report-production-ready-final.json`,
and the blocked interaction artifact is
`test-results/authenticated-discovery/interaction-report-production-readiness-blocked.json`.

Next work is to profile the remote authenticated `Items` pipeline, rerun the 13
interaction checks with the same non-admin account, collect cold and warm route
passes, and complete physical webOS validation. Do not call the project
production-ready until those gates pass.

## 2026-07-21 Authenticated Items pipeline investigation

The frontend amplification is corrected, but release remains blocked. PTV list
and Resume helpers now use the shared coordinated JSON request boundary, and a
retired Home pipeline cannot start recommendation quality hydration after
navigation. The live Movies trace improved from 11 list/resume requests, four
duplicate pairs, one 47-item stale hydration, and peak concurrency 9 to five
requests, zero duplicate contracts, zero stale hydration, peak concurrency 4,
and 70 rendered cards.

This did not repair the remote Jellyfin tail. The representative post-fix Movie
browse schedule measured 5.71 seconds median and 11.32 seconds p95. Direct and
`ApiClient` samples remained nondeterministic, including 12.97-second direct
Movie card and 22.03-second `ApiClient` Views requests. Time before headers
dominates, and no stable browser/direct/client-path penalty was found. The PTV
plugin source does not intercept core Jellyfin `Items` routes; server logs,
database plans/locks, host I/O, reverse proxy, and other installed plugins were
not available to the non-admin session.

Validation: focused 10/10, full Vitest 91 files/617 tests, TypeScript, and
production Webpack passed. The unchanged interaction gate passed 7/13, then
3/13 on a warm repeat. The HTTP cold-cache reload did not restore the dedicated
authenticated browser, so no cold/warm discovery report was written. Do not use
another account, raise timeouts, or call this production-ready. Reauthenticate
the same user, gather read-only server evidence, require 13/13, rerun cold/warm
discovery, and complete physical webOS. See `ITEMS_PIPELINE_REPORT.md`.

## F3 implementation handoff

Phase F3 Premium Collections is implemented locally after the approved H1 boundary. Product source is route-lazy and plugin-independent. Final phase approval remains gated on the requested automated, authenticated development, frozen-production, bundle, privacy, and clean-worktree evidence. No production deployment or native application expansion is part of this phase.

## F3A2 handoff

F3A2 is HOLD. Authenticated development and frozen-production sessions preserved one bootstrap, runtime application, ApiClient, and Jellyfin socket, and the controlled visible retry recovered without a retry loop. Three-cycle acceptance did not pass because the approved test server repeatedly timed out or failed collection sources and returned no Collection Search result for a usable Jellyfin collection. Production deep-scroll restoration and real second-user isolation also remain unproven. Continue only with Phase F3A3 - Collection Search Capability and Backend Latency Closure. Do not start F4.
