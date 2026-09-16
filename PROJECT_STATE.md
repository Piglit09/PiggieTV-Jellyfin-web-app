# PiggieTV Project State

Current as of 2026-08-01. This is the current-state ledger; dated sections retain delivery history.

Maintenance rule: after every completed project prompt, update `HANDOFF.md`, `PROJECT_STATE.md`, and `ARCHITECTURE.md` before reporting completion. Current behavior, verification, deployment requirements, and open risks must agree across all three documents.

## Current Status

### 2026-08-31 Native Shows library: physically accepted on LAN

Native `PiggieTV-WebOS` version `0.1.19` is committed at `4ff9d29`, packaged, and installed on the LG 70UN7070PUA. The installed chunk is `main-legacy-ZXj1APVw.js`. Shows discovery is now scoped to all typed `tvshows` user views with a maximum concurrency of three, lean scalar sort fields, no exact-count expansion, merged identity deduplication, and the unchanged 12-second request deadline.

The TV is signed in against `http://10.16.0.50:8096`. Physical acceptance rendered 72 cards from three libraries, reported 1,065 titles, held 72 cards for 20 seconds, and restored 72 cards after Home -> Shows. A fresh A-Z request set completed HTTP 200 in 2.4, 7.8, and 9.9 seconds with no runtime exception or library error. Focus remained visible, but the route-return sample retained focus on Home while Shows was current.

The focused Shows suite passes 11/11, and TypeScript plus the production package build pass with only the established large-chunk warning. Status remains **HOLD** for overall production: the public proxy produced 12-second aborts and a 102.1-second 504, successful LAN requests still approach the deadline, other catalog routes retain their existing contracts, and complete physical playback/Back/focus acceptance remains unfinished. This task changed the native package only; no Jellyfin Web release version changed.

### 2026-08-31 Native webOS recovery: deployed with partial physical acceptance

The native `PiggieTV-WebOS` client is now version `0.1.18`, committed at `08d8848`, packaged successfully, and installed on the LG 70UN7070PUA. The installed build identity is `main-legacy-B92NAWM6.js`. A successful server test now retires stale startup-connectivity errors without clearing or masking independent authentication errors.

Physical evidence confirms that the installed app can restore an authenticated session, render populated Home rows, maintain visible focus, navigate routes, and recover an initially timed-out row through Retry without a runtime exception. This closes the specific stale timeout-banner defect and confirms the corrected native package is running on the TV.

Overall production status remains **HOLD**. Backend response latency remains nondeterministic on the physical client, with observed requests taking roughly 4.3 to 9.3 seconds and lower rows initially timing out. Full route, playback, Back, focus-restoration, and long-duration physical acceptance is still required. The native package and Jellyfin Web frontend are separate deployment artifacts; no PTV Web source or Web release version changed in this task.

Web reliability and performance work through Phase F2D-B1 is **APPROVED**.
Phase H1 is a repository hygiene and commit-boundary pass. It preserves all
approved PiggieTV behavior and does not expand features or change playback,
routing, request/cache, connection, or native application ownership.

After H1 approval, the next feature phase is F3: TV-first Collections and
cross-library discovery. Earlier HOLD and BLOCK entries below remain historical
evidence and do not supersede this current status.

## 2026-07-27 WebOS Phase 3A playback correction

Decision: **HOLD pending final literal physical-remote Music acceptance and
repository lint reconciliation.**

The existing playback engines are unchanged. A non-persisted derived service
selects exactly one of mini-player, full-screen Music, stock video
controls/surface, or none. The existing TV focus manager owns scope and Back;
the existing input manager owns one PTV Music transport adapter; the stock
video handler yields capture-owned events.

The mini-player is viewport-anchored with Chrome 68-safe literal WebOS
geometry. Active audio remained visible/reachable across Home, Music, Artists,
Albums, Songs, Playlists, Search, Settings, track transition, and rapid route
cycles on the LG validation app. Full-screen Music no longer terminated the
app in the device-assisted run. Video scope, one hidden Right seek, transport,
and two-stage Back also passed.

WebOS intentionally excludes Reading and Request from navigation, direct-route
ownership, and chunks. Its Music policy uses bounded initial rendering,
deferred lyrics, no expensive backdrops, and no Music-tree animation.
Non-WebOS behavior is retained.

Diagnostics remains passive. Scroll collection snapshots once per burst, and
runtime timeout cleanup no longer calls browser work after window teardown.
Route cycling retained one app/runtime and five listeners with no duplicate
growth.

Validation passed PTV Vitest 115 files/701 tests, full Vitest 138/907,
TV-profile Playwright 9/9, TypeScript, Stylelint, production Webpack with its
two established size warnings, schema/privacy checks, secret scan, and diff
check. `lint:ptv` remains red because 18 accumulated-worktree files exceed the
checked-in baseline; focused Phase 3A lint outside legacy `PTVShell.tsx` has no
errors.

Production was not changed. See
`docs/diagnostics/phase3a-playback-correction-report.md`.

## 2026-07-24 Jellyfin Backend Latency Attribution

Status: **partial backend attribution complete; production HOLD**.

The approved browser session remained the same non-administrator account. A
separate administrator observer obtained current Jellyfin 10.11.11 logs,
scheduled-task state/history, plugin inventory, system storage, and
database-directory presence. PiggieTV is <private-address>/API v1 with 13 capabilities.
Program data is fixed storage with 156,048,969,728 free bytes; configured
library folders are 11 network and five fixed. The SQLite main database was
present before and after, with no WAL/SHM/journal companion visible at either
observation.

The unchanged matrix regressed sharply: warm/repeat/transport-cold passed
9/13, 12/13, and 11/13. Item-read p50/p90/p95/max was
8.909/34.906/55.436/68.615 seconds and warm p50/p90 was 13.045/28.223.
All 68 requests over three seconds have server correlation rows. Seventy-four
of 76 requests over 1.5 seconds are proven/strong duration matches; median
server/browser ratio is 1.0, median absolute delta is 7 ms, and browser
transfer median is 0.7 ms. Network is not the primary owner.

No current SQLite locked/busy/retry event or EF/query-splitting warning was
observed. The scheduled `Optimize database` task ran from 11:30:31Z to
11:35:37Z. The pre-task p90 was already 33.744 seconds, while five requests
crossing task start reached p50 65.634 and max 68.615 seconds. It is a strongly
correlated database-maintenance amplifier, not a sole proven cause. The
automatic task was not started, stopped, deferred, or reconfigured by Codex.

TV-like focus separately failed in all passes: the visible browse card retained
focus through all four arrow directions without activation or requests. No
focus behavior changed.

The administrator API does not expose host CPU/process/memory/swap, disk
await/queue, filesystem/mount latency, inode, retransmit, journal-mode, or
busy-timeout evidence. Therefore this pass does not satisfy the required host
sample or no-background-mutation conditions. `ARCHITECTURE.md` is not extended
because a durable deeper owner is not proven.

Next action requires explicit approval: activate host observation and defer
only `Optimize database` for one unchanged warm/repeat/transport-cold matrix
plus 30-second pre/post windows, then restore its original schedule. The
proposal was recorded and not executed. Release still requires p90 under three
seconds, 13/13 every pass, a clean representative playback-progress write, and
independent physical-TV acceptance. Phase 2E stays HOLD.

Validation passes: focused 153/153, full Vitest 816/816, TypeScript, changed-
harness ESLint, production Webpack with two established size warnings, 10
schemas, Android parity, plugin contract, secret scan, 12-artifact privacy
validation, and Web/mobile/TV whitespace checks. Temporary browser and
observer sessions were revoked; the helper profile and CDP listener are gone.

## 2026-07-24 Production Authenticated Items Pipeline Stabilization

Status: **frontend amplification corrected; production HOLD**.

The same approved non-admin account completed privacy-safe warm,
immediate-repeat, and authenticated transport-cold passes against the direct
Jellyfin listener. Initial evidence reached 37.016 seconds before headers and
showed 17 exact duplicates/peak 11; the attribution baseline showed 21/peak
12. Details activation independently loaded the same item from the stock
controller, repeated integration enhancement, and PTV fallback. Back/Forward
also overlapped one exact directory read.

All of those existing consumers now share the established in-flight request
coordinator. No response cache, Core boundary, timeout, retry, DTO/error
translation, route, UI, auth, playback, focus, plugin, database, or Android
ownership moved. The final graph has zero exact duplicates, zero semantic
canonicalization misses, and peak 8.

Final aggregate p50/p90/p95/max time to headers is
1.390/3.644/4.464/6.978 seconds. p90 still fails the fixed 3-second target.
Warm-only p50/p90 are 1.698/3.724 seconds and also fail.
Shared, browser fetch, direct-listener, and ApiClient samples were closely
aligned, and direct median transfer was 0.8 ms. The remaining tail is assigned
upstream of frontend transport; its exact backend component is unproven.

Warm/repeat/transport-cold each pass 12/13. Browser TV-like focus remains the
sole failure. The third pass preserved the same session and disabled transport
cache; it is not a full app cold launch. Playback continuation was read-only
Resume validation, not playback execution.

Current server log/task/plugin inventory access was denied to the approved
account and no host observer session existed. Database and host evidence for
the exact run is not observed. Historical SQLite locking, the 35.22-second
playback HTTP 500, and 93.39-second successful read remain active blockers.
No plugin/task isolation, server restart/configuration, database command, or
production-data mutation occurred.

Validation passes: focused 257/257, full Vitest 816/816, TypeScript, scoped
ESLint, production Webpack, ten schemas, Android parity, secret scan,
artifact privacy validation, and Web/mobile/TV whitespace checks. Production
is blocked on current read-only log/host/database correlation, p90 under 3
seconds, 13/13 interactions, representative playback-write evidence, and the
independent physical-TV acceptance gates.

Exact next action: obtain time-bounded read-only log and host observation for
the actual backend while keeping the same browser account, then rerun the
privacy-safe matrix with timestamped server completion, SQLite warning, CPU,
memory, disk, mount, and network samples. Do not perform isolation or
mutation without separate evidence and approval.

## 2026-07-23 PTV Core Phase 2E Episode-Details Design Audit

Phase 2E is complete as a design audit with a **HOLD** decision. It is not an
implemented Core phase. No production source, runtime behavior, API call,
facade, projection, route, UI, schema, test behavior, persistence, plugin,
Android code, or ownership boundary changed.

The Web inventory covered 45 direct production `getItem` expressions, two SDK
single-item helpers, a bound hero hydration loop, the `getPtvItem` transport
fallback and consumers, every `getEpisodes` call, parent-artwork lookups,
navigation hydration, details controllers, playback headers, More From Season,
context menus, recommendations, queues, editors, and remote players.

All higher-traffic Episode-capable candidates were rejected because they own or
materially affect the stock details DTO, media sources, resume/playback, queues/
autoplay, route hydration, context mutation, downloads, metadata/subtitles,
remote playback, hero featured/continue generation, or external integrations.
The two current `getPtvItem` consumers are Reading and Music, not Episode
details. Recommendation Episode reads are list queries rather than one focused
item.

The closest low-coupling seam is the PTV details enhancement fallback in
`ptv/modules/details/index.js`. The normal `detailsrendered` lifecycle gives it
the stock controller's already-loaded raw item, so no request is made. Only if
that handoff is unavailable does it call the current Jellyfin client once with
the route ID/current user. For an Episode, the result drives shell-section
classification and optional direct/parent artwork only. Dataset and route
checks suppress duplicate/stale application; there is no explicit timeout,
retry, cancellation, shared promise, or coordinator, and failure is
nonblocking.

The fallback does not justify migration. `getPtvItem` already preserves raw
object and platform-error identity while providing generic ID/type/runtime
normalization and safe diagnostics. Phase 2C already supplies the useful
Episode ID, Series/Season scope, title, indexes, overview, date, runtime,
artwork, and progress projection. A new boundary would duplicate those
policies, add stricter failure behavior, potentially add a coordinator, and
serve no portable Android or cross-platform consumer.

The hypothetical minimum—still unimplemented—is required `episodeId` plus
optional `seriesId`, `seasonId`, and artwork. A future single-item normalizer
would fail the whole Core result for wrong/missing requested ID, wrong item
type, or conflicting supplied parent scope, while accepting missing optional
parents and preserving the untouched raw DTO/unknown fields. Any public seam
would have to retain one call, original raw/error identity, and current
Jellyfin auth/login/network behavior with no new retry or timeout.

The candidate scores 26/50 against a 38/50 approval threshold. Its
cross-platform usefulness, reduction of duplication, and architectural
necessity each score 1/5. The full inventory, present contract, proposed
validation/error policy, rollback, required tests, and later browser acceptance
design are recorded in `docs/architecture/PTV_CORE_MIGRATION.md`.

The exact next task is production authenticated Items pipeline stabilization:
use the existing same-account regression matrix and read-only server/host
evidence to measure and reduce long-tail failure. Physical-TV acceptance and
release/deployment hygiene also rank above another Core abstraction. Reopen
Phase 2E only after a distinct portable Episode consumer or diagnostic need is
demonstrated.

## 2026-07-23 PTV Logout Action Ownership Fix

The invalid `#/logout` navigation bug is fixed in Web. Both PTV-visible Sign
Out controls are semantic actions that close their shell/sidebar menu and enter
the established Jellyfin `Dashboard.logout()` lifecycle. One shared in-flight
PTV adapter prevents overlapping click, Enter, remote-OK, and pointer synthesis
from issuing duplicate requests and releases after success or failure.

Jellyfin remains the sole owner of remote logout, credential/session clearing,
`localusersignedout`, query/view reset, server selection, Login routing, and
failure semantics. No logout route, token store, session service, or auth event
moved into PTV Core. The obsolete hash is absent from production source and
was not added to the auth classifier; Jellyfin's actual Login and Select Server
destinations remain recognized.

Focused logout/auth/header/router/Core tests pass 98/98 across 16 files and the
full Web suite passes 803/803 across 123 files. TypeScript and scoped new-file
ESLint pass; the PTV style baseline has no new finding. Production Webpack,
ten schemas, normalized Android parity, the 118,240-path secret scan, and
Web/mobile/TV whitespace checks pass. Webpack retains its two established size
warnings. Android source is unchanged, so its builds/lint were not rerun.

Physical browser verification passed. The semantic PTV control had no `href`,
closed its menu immediately, issued exactly one Jellyfin session-logout
request, retired authenticated state/shell, and reached Select Server without
Page Not Found. Existing server selection and Jellyfin's stock login restored
authenticated Home and the PTV shell. No credential/token was logged or
retained. The helper-owned browser/profile was removed and loopback CDP port
9223 was closed.

## 2026-07-23 PTV Core Phase 2D Authenticated Browser Validation

Phase 2D is complete as a validation-only phase. The helper launches current
Chrome with CDP bound only to loopback port 9223 and a dedicated OS-temporary
profile, while the interaction runner requires exactly one expected frontend
page and validates frontend/backend origin, Jellyfin authentication, current
PTV/Core runtime, appRouter, route controller, service-worker origin, and Home
readiness before interacting.

The prior harness's mutation, playback, broad diagnostics, private artifact
fields, and externally owned `browser.close()` behavior were removed. The new
matrix is read-only and retains only operation/route categories, method,
status, duration, count, and pass/fail. It neither accepts credentials nor
captures storage state, screenshots, or traces. Helper-owned temporary state
is removed automatically; externally supplied CDP browsers are never closed.

The latest run proved frontend/configured-backend HTTP 200, one isolated Chrome
149.0.7827.199 page, loopback-only CDP, authenticated state, current runtimes,
router/service-worker agreement, Home readiness, and a usable read-only media
catalog. Preflight passed.

The first deterministic Home failure was `eligible-card-found`
(`home-card-not-found`). The previous selector required optional descendant
artwork metadata and a staged rerun used a no-op Home re-entry. A fresh route
generation plus one layout-neutral, non-identifying media-type marker now
selects the actual native Movie/Series anchor. Real Playwright pointer and
keyboard activation each run the feature handler and `appRouter` once, produce
one History route-category transition, mount details ownership and usable
content, and retain refresh. Back restores populated Home and the original
shelf/card position within tolerance. The current router does not emit native
`hashchange` for this History transition; that was an instrumentation
assumption, not a product failure.

Search's opaque error was a strict-locator exception caused by matching both
shell and native Search inputs. The runner now uses the existing native
focus-key marker, stages safe failures, waits for query/results restoration,
and selects by media type. Series and Season each use independent in-memory
catalog setup and the actual `#listChildrenCollapsible` renderer. Series
rendered 4/4 seasons and Season 29/29 episodes, with exactly one initial and
one refresh call for each boundary and ordering/field/scope semantics retained.

The all-zero GUID is Jellyfin's `Guid.Empty` root-folder sentinel, so its
HTTP 200 `UserRootFolder` fallback was correct. The missing-item probe now uses
a nonempty unallocated GUID and proves HTTP 404 plus Jellyfin client rejection;
`getPtvItem` preserves the original platform error. No identifier or response
body is retained.

The independent acceptance result is 5/5 in one ordered run: Home details/
Back, Search details/navigation, Series seasons, Season episodes, and error
compatibility. Instrumentation installs once, resets per scenario, restores all
router/History/debug/event hooks, and cannot contaminate the next scenario.
Cleanup removed the helper-owned Chrome tree/profile and closed port 9223.
The single artifact passed its forbidden-field scan; no storage state,
screenshots, traces, credentials, tokens, account identity, raw IDs, titles,
full hashes/URLs, query values, headers, bodies, or cookies were retained.

No application behavior defect was found. The only product-source change is
the layout-neutral Home media-type diagnostic marker; all functional
corrections are in the validation harness. No new Core API, navigation,
playback, authentication, focus, Android, cache, plugin, server, database, or
UI ownership boundary moved.

Automated validation is green for the required scope: harness 9/9, explicit
Phase 2A-2D 118/118, retained logout/authentication 57/57, full Vitest 808/808
across 123 files, TypeScript, Phase 2D scoped ESLint, PTV style baseline,
production Webpack, ten schemas, Android parity, the 118,241-path secret scan,
and Web/mobile/TV whitespace checks. Webpack retains its two established size
warnings. The optional broad repository ESLint debt gate remains red from
pre-existing findings outside the Phase 2D files. No Android source changed.

That recommended design-only audit is now complete. Phase 2E placed the
episode-details candidate on HOLD and did not authorize a migration.

## 2026-07-23 PTV Core Phase 2C Episode List Adoption

Phase 2C is implemented in the web repository. Exactly one API request moved:
the Season-details `getEpisodes` list consumed by `renderChildren`. The
compatibility facade invokes the existing Jellyfin client once with the same
series ID and exact options object, returns the identical raw query result, and
rethrows original platform failures. The current renderer, media-source
normalization, list markup, authentication, URL/query construction, timeout/
failover, local-ID compatibility, error/login behavior, and request timing
remain authoritative.

The Core-only episode projection validates requested series and season scope
and supports PascalCase/camelCase input. It preserves raw items and ordering
while exposing episode identity, title, indexes, runtime milliseconds,
premiere date, overview, present Primary artwork, and present played/position/
percentage. Missing optional values are not fabricated. Invalid-ID,
cross-series, and cross-season children are dropped with distinct counts;
missing child scope inherits requested scope. Empty/all-malformed child lists
remain valid, while invalid envelopes or parent/envelope scopes fail.

Diagnostics are privacy-bounded and nonblocking. Automated validation is green:
focused 124/124, full 781/781, TypeScript, scoped ESLint, production Webpack,
ten schemas, Android parity, secret scan, and all-repository whitespace checks.
One first-run source-regression test used an incorrect extraction regex; it was
corrected and the focused/full reruns passed without timeout changes.

Authenticated browser validation remains explicitly blocked. Local ports 8082
and 8096 respond, but the expected authenticated CDP endpoint on 9223 refuses
connection and no reusable auth state or safe configured credentials exist.
No browser pass is claimed.

Core adoption remains partial. More From Season, episode details, playback/
media-source requests, Next Up, autoplay, Search, context menus, images,
recommendations, caches, auth, route/focus ownership, Android, and UI remain
legacy-owned. Phase 2D subsequently passed the authenticated matrix 5/5, and
Phase 2E subsequently held the episode-details candidate without migration.

## 2026-07-23 PTV Core Phase 2B Metadata and Search Navigation Adoption

Phase 2B is implemented in the web repository without Android or production
mutation. Exactly one details-only season/episode metadata GET moved: the
Series-details season list. The current `ApiClient.getSeasons` transport,
series/user/Fields parameters, raw query result, ordering, paging/defaults,
authentication, and thrown platform errors remain authoritative. No new retry,
timeout, cancellation mechanism, or request coordinator was introduced.

The internal Core result validates parent scope and response shape, accepts
PascalCase/camelCase aliases, preserves unknown fields and raw children, and
projects season identity/title/index/count/artwork. Empty lists succeed. Mixed
payloads retain valid ordered children while counting invalid-ID or cross-scope
drops; invalid envelope or parent scope fails. Diagnostics are count-only and
privacy-bounded.

Native Search generic details cards now produce the same v1 details intent used
by Home and execute through the existing web adapter/`appRouter`. The anchor
href remains authoritative for deep links and modifier/middle-click behavior.
Unmodified primary activation causes exactly one programmatic route, immediate
double activation shares one in-flight operation, invalid IDs do not reach the
router, and Book/Music specialized routes remain legacy-owned.

Automated validation is green: focused 58/58, full Vitest 756/756 across 114
files, TypeScript, scoped standalone-file ESLint, production Webpack with two
established warnings, ten schemas, normalized Android parity, secret scan, and
whitespace checks in all three repositories. No flake occurred. Android source
was not changed, so Android build/lint reruns were not required.

Authenticated browser validation is blocked and not claimed. The development
app and Jellyfin server are reachable on ports 8082 and 8096, but the shared
authenticated CDP endpoint on port 9223 is absent and there is no reusable auth
state or configured test credential set. The manual Home/Search/Series
acceptance checklist is recorded in `PTV_CORE_MIGRATION.md`.

Adoption remains partial. Existing episode-list and focused-episode lookups,
Search submission/API/filter/render/focus, specialized routes, token/login,
playback, route stacks, Android destinations, featured cache, and UI remain
legacy. Exact Phase 2C: after authenticated Phase 2B evidence passes, migrate
only the season-details episode-list `getEpisodes` call through a sibling Core
boundary with a focused episode projection and full raw-response compatibility.

## 2026-07-23 PTV Core Phase 2A Safe API and Navigation Adoption

Phase 2A is complete in the web repository without Android or production
mutation. The selected API boundary is the read-only `getPtvItem` lookup used by
native music and reading details. Its public signature and Jellyfin
`ApiClient.getItem` transport remain authoritative. Identical concurrent reads
share one request; the internal boundary returns Core API response/error data,
while the facade returns the original raw item and rethrows the original
platform error so authentication/login behavior remains compatible.

The focused response model validates an opaque string ID, accepts Jellyfin
PascalCase and supported camelCase aliases, preserves unknown/feature fields on
the untouched raw object, permits absent/null optional values and empty
collections, and converts ticks only for the Core runtime view. Network,
timeout, cancellation, 401, 403, 404, 5xx, and parsing failures remain
distinguishable without retries or response-body diagnostics.

The selected navigation boundary is a native Home movie/show shelf-card details
click. It creates a v1 details intent and uses a web adapter to produce the
exact existing hash and invoke `appRouter` once. Browser history/back, deep-link
format, query/library context, route tables, search/browse behavior, Android
destinations, TV focus, and playback are unchanged.

Focused diagnostics are bounded, privacy-safe, and nonblocking. Validation is
green: focused 41/41, full Vitest 716/716 across 110 files, TypeScript, scoped
ESLint, production Webpack with two established warnings, ten schemas, and
normalized Android parity. No flake occurred. Android builds/lint were not
required because Android source was not changed. Physical browser/device
regression remains pending and is not claimed.

Adoption remains partial. The exact next Phase 2B task is a details-only
season/episode metadata GET through the same Core boundary, followed by the
native Search result-card details action through `PtvNavigationIntent` and the
current `appRouter`, with real-browser Back/refresh verification before any
additional ownership migration.

## 2026-07-22 PTV Core Phase 1.5 Runtime Adoption

The initialization foundation is now used by web, Android mobile, and Android
TV. Each executes the same ten-step lifecycle from its actual startup root,
shares repeated/concurrent entry, suppresses duplicate settings listeners, and
supports test disposal/reset. Existing session/login, API engines, route
execution, playback engines, Android Auto, TV focus, notifications, and lock
controls remain authoritative.

Low-risk adoption includes settings and feature-flag snapshots, capability
reports, v1 diagnostic events, and cache-envelope adapters. Cache/diagnostic
failures are degraded startup; authentication retains the existing login
action; critical API adapter failure does not reach ready.

The first migrated persisted boundary is the server/user-scoped web library
index used by Reading and Music. It keeps the current IndexedDB database,
object store, key, and legacy reader while adding envelope writes, current and
fallback reads, scope isolation, corruption/version/expiry/stale behavior, and
migration diagnostics. One plugin recommendation response now uses the v1
compatibility normalizer without replacing Row Builder or the recommendation
engine.

Android parity is automatically enforced through normalized generated
manifests rather than source text alone. The central CI workflow compares both
Kotlin contracts with the canonical v1 manifest and schemas, including model
and wire details, enum values, error codes, and capability identifiers. The
files remain exact-byte-identical as an additional property.

Validation is green across the requested matrix: web focused 15/15 and full
695/695, TypeScript, scoped ESLint, production Webpack, ten schemas, parity,
secret scan, and whitespace checks; mobile focused 12 tests plus all unit
variants/Proprietary Debug assemble/lint; TV focused 12 tests plus all unit
variants/Debug assemble/lint. The first web full run had one unrelated
featured-cache five-second timeout; its isolated 7/7 run and the complete
695/695 rerun were clean.

Adoption remains partial. Phase 2 should migrate one read-only, non-auth,
non-playback API error/response boundary and introduce logical navigation
intents at one client boundary while current routers remain executors. Moving
auth, route stacks/focus, or playback requires physical platform regression
coverage first.

## 2026-07-22 PTV Core v1 Shared-Core Foundation

The Phase 1 foundation now spans the web/plugin repository, Android TV, and
Android mobile. Canonical JSON Schemas and architecture documents define v1;
the web has a portable TypeScript core plus an explicit browser capability
adapter; both Android apps have exact-byte-identical dependency-free Kotlin
contracts plus platform capability adapters; and the plugin exposes additive
version/capability metadata without breaking current clients.

This milestone establishes contracts and compatibility seams rather than
replacing working systems. Existing Jellyfin auth/token storage, cache v7,
Row Builder, route stacks, browser/Media3 playback, diagnostics transports,
device detection, Android Auto, TV focus, reader behavior, notifications, and
UI remain authoritative. Controlled initialization is implemented and tested
as an observable/idempotent runner, but app startup wiring is still an
incremental migration item.

Validation is green for the new work and all executable build/test gates:
web focused 37/37 and full 680/680, TypeScript, production Webpack, scoped core
ESLint, Stylelint baseline, schemas, plugin compatibility, secret scan, plugin
33/33, Android TV tests/assemble/lint, mobile tests/proprietary assemble/lint,
and focused Kotlin 6/6 per app. Mobile Detekt retains 76 findings outside the
new core, and the dirty web repository's PTV ESLint baseline retains 325
errors/33 warnings outside the newly added clean core files.

The next implementation slice is startup composition: adapt existing
settings/cache/diagnostics services to the core initializer, beginning with
noncritical degraded-start behavior and parity tests. Auth, navigation, and
playback adoption remain behind their platform regression gates. No
production deployment/server/configuration, credentials, URLs, or user data
changed.

## 2026-07-22 Physical Production Acceptance: Route Return Failed

The connected LG loaded the newly deployed production web root, not an older service-worker generation. Runtime and loaded-asset evidence identifies frontend build `10.11.11`, commit `c81c8ed516-dirty`, timestamp `2026-07-23T02:21:05.700Z`, and production mode. The document, Jellyfin API, and plugin all resolve to `<private-host>:8096`; the page is not service-worker controlled. `PTV_WEBOS_OPTIMIZED`, `webos`, TV tier, `ptv-render-webos`, and `ptv-render-tv` are active.

Production shell/Home geometry is corrected. The 1920x1080 viewport has a 1788x80 header, 220x64 brand, centered 712x80 navigation, 296x60 utilities, a 1920x620 hero, readable 21px metadata, two hero actions, zero horizontal overflow, visible focus, and no visible legacy header. One stabilized ArrowRight caused one focus transition from Movies to Shows.

Continuous Home stability passed: four samples over 100.2 seconds retained 25 semantic rows, 19 shelves, two scrollers, 36 cards, and two actions. Route restoration failed independently. After Home -> Movies -> Back, the hero and actions returned but shelves collapsed to six semantic sections, zero shelf/scroller markers, and zero cards after 16 seconds and stayed absent for more than six minutes.

The lease-bound physical report was captured and downloaded before diagnostics was stopped. It reports `warning` with only `first-shelf-missing`, while confirming corrected shell geometry, visible focus, build provenance, no service-worker controller, and hidden legacy header. The lease was subsequently revoked and the client confirmed inactive collection. No implementation source or remote state was changed during acceptance.

The webOS/Home P1 remains open. Stale build and catastrophic shell geometry are retired as explanations, but physical route-return Home restoration is not accepted. A camera photo, full user-operated remote/playback matrix, same-account 13/13 interactions, authoritative cold/warm discovery, authenticated Items latency, and backend lock evidence remain required.

## 2026-07-22 Home Cache Authority and Physical LG Persistence

The Home disappearance corrective pass is complete in the worktree. Shared featured-content semantics now distinguish populated complete data from partial, degraded, configuration-only, ordinary empty, and explicit intentional-empty payloads. Browser and plugin persistence reject unusable refreshes before replacing memory or disk state. Native Home separately applies an atomic route-generation replacement decision, so late empty aggregates, section-only shells, partial results, and retired routes cannot erase an already populated model.

The plugin's six empty section definitions came from configured-row refresh using `includeEmptyRows: true` even when selection produced no hero or row items. Refresh now excludes empty generated rows; the validator rejects configuration-only output and preserves the previous cache. Cache schema remains v7. The plugin correction is source-tested but was not deployed to the remote server in this prompt.

The LG hosted wrapper now has a tracked exact development target at `http://<development-frontend>:8082/`, while the development environment points Jellyfin/API/plugin work to `http://<test-server>:8096`. Runtime inspection on the connected LG verified those two origins and no `<private-host>:8096` traffic. The old hosted wrapper had constructed the incorrect frontend/server combination before Jellyfin selection could recover it.

Physical Home persistence is positive but bounded. After a Movies-to-Home return, the split-origin development build retained one stable hero, 25 semantic rows, 36 cards, and 40 images through four snapshots over 100.1 seconds with zero logger errors. The untouched `<private-host>:8096` frontend repeated the same stable counts over 100.7 seconds. The disappearance did not reproduce in either run. Inspector JSON/PNG evidence is stored under `test-results/webos-physical`; the PNGs are runtime screen captures rather than new camera photographs. The LG was returned to authenticated split-origin Home.

Validation passed: focused 28/28, full Vitest 646/646 across 95 files, plugin 31/31, TypeScript/build policy, production Webpack with only established size warnings, plugin contract, secret scan, and whitespace validation. Production remains HOLD because same-account 13/13 interactions, authoritative cold/warm route runs, representative clean server/playback traffic, backend lock/latency evidence, and the complete user-operated LG remote/focus/back/playback matrix remain open.

## 2026-07-22 Shared Shell and LG webOS Physical Correction

The narrow compatibility correction is implemented, built, and loaded on the connected LG test television. The root cause was a render-profile contract gap: webOS received `ptv-render-webos`, but the centralized ten-foot geometry was guarded by `ptv-render-tv`, which the profile-class reconciler removed. Chrome 68 additionally required literal dimensions and offsets rather than relying on intrinsic-image/min-content behavior and `clamp()`.

`renderProfile.ts` now applies the additive `ptv-render-tv` tier alias while preserving the specific webOS class. Shared shell, TV, and webOS CSS explicitly contain the brand image and header tracks, provide 720p/1080p/4K literals, and retain static visible focus. Home and shell components expose layout-neutral markers consumed by the unchanged physical snapshot schema; no page-local TV layout owner or alternate focus manager was introduced.

On the physical 1920x1080 LG viewport, the final bundle measured an 80px header, 220x64 brand, centered primary navigation, bounded utilities, one brand owner, zero overflow, and no legacy header. The after diagnostics retire the oversized-brand, obscured-hero, and invisible-focus findings. One injected ArrowRight transition preserved the visible focus ring.

The remaining physical report warning is `first-shelf-missing`: the local authenticated Home route settled with zero mounted rows, no hero action, and no shelf/scroller. The correction intentionally did not alter content loading. There is also no post-fix camera photo, so P1 is improved but not closed and production readiness remains HOLD.

Validation passed with 39/39 final focused tests, 629/629 full Vitest tests, TypeScript/build policy, scoped Stylelint, production Webpack, secret scan, and Playwright 43 passed/6 opt-in live skipped. Local wrapper assets were refreshed; no remote production host, plugin contract, cache schema, or user data was changed.

## 2026-07-22 Embedded Production LG Diagnostics

- The local embedded production path is operational on the signed-in LG 70UN7070PUA running webOS SDK 5.6.2 and firmware 04.64.00. The current production bundle reports a 1920x1080 CSS viewport, DPR 2, `PTV_WEBOS_OPTIMIZED`, `physicalLayoutSnapshot=true`, and a successful diagnostics check-in.
- Physical layout collection reuses the existing administrator-controlled lease, command, report, and Dashboard transport. It runs only during an active lease, captures seven fixed milestones, retains the latest sample per milestone, and excludes text, HTML, URLs, media identity, arbitrary attributes, and raw CSS rules.
- The authoritative Home report is `regression` with `shell-brand-oversized`, `hero-content-obscured-by-shell-brand`, `first-shelf-missing`, and `focus-not-visible`. The header is 1920x500; the shell brand and its image are 1077x500, matching the image's intrinsic dimensions. The Home root is 1920x1215. The fixed first-shelf, shelf-scroller, and shell-main selectors were absent.
- The live plugin response used PascalCase DTO keys. Dashboard client/report normalization and the client command transport now accept both PascalCase and camelCase while preserving malformed-row rejection and optional-field semantics.
- CSS source attribution is explicitly unsupported because the browser cannot reliably identify the winning cascade source. The evidence narrows ownership to the shell brand image but does not establish the exact overriding rule. No CSS or layout fix was made.
- The server-side Home report was observed before Stop with all four issue codes and seven milestones. A later Dashboard shutdown report replaced the latest stored entry with a focus warning, preserving the known requirement to request/view or download the target-route report before navigation or Stop.
- Validation: focused diagnostics tests 20/20, full frontend Vitest 624/624, TypeScript clean, plugin baseline 28/28, plugin contract clean, and production Webpack successful in 121.095 seconds with only the two established size warnings.
- Deployment boundary: the rebuilt frontend and five-file plugin payload were exercised against the local test Jellyfin instance only. The remote production server was not changed. P1 remains open pending a narrow CSS correction, same-device after capture/photo, remote-key focus verification, and the other existing production-readiness gates.

## Repository Snapshot

| Field | Current value |
| --- | --- |
| Product | PiggieTV native experience embedded in Jellyfin Web |
| Current HEAD | `6d483399b3` (`TV compatibility and webOS recovery handoff`) plus the current uncommitted worktree |
| Jellyfin Web package | `10.11.11` |
| Node requirement | `>=20.0.0` |
| Frontend stack | React 18.3, TypeScript 5.8, Webpack 5, MUI 6, TanStack Query 5 |
| PTV frontend root | `src/ptv` |
| Plugin root | `src/ptv/plugin/Jellyfin.Plugin.PiggieTV` |
| Plugin target/version | .NET 9, `<private-address>` against Jellyfin packages `10.11.8` |
| Featured cache | Schema/version 7, plugin and browser stale-while-revalidate path |
| Reading home cache | Schema 5, complete/summary separation, 5-minute fresh TTL, 24-hour stale window, route-scoped persistent pointer |

The current worktree adds conflict-safe media-source deduplication, a complete TV navigation corrective audit, lighter static webOS glass, an administrator-controlled local remote-diagnostics system across the frontend and companion plugin, a Remote Diagnostics dashboard crash hardening pass, optional LG webOS CLI helpers, repository hygiene, and these project-memory updates. Machine-local/generated artifacts are intentionally untracked; the five-file `src/ptv/plugin/bin` deployment payload is intentionally tracked and refreshed. C# diagnostics tests now build synthetic credential-shaped strings at runtime to keep authorization coverage while avoiding committed secrets that match repository scan rules.

## Current Product State

### Runtime And Shell

- PTV has one guarded runtime initialized from `src/ptv/core/app.js`.
- The persistent runtime root owns the global media dock and survives route changes.
- `PTVShell` is the shared shell for native Home, Movies, Shows, Anime/Cartoons, Music, Reading, Requests, Dashboard, and settings surfaces.
- Primary and contextual navigation are route-backed and centralized in the shell/route controller.
- Item routing is centralized for PTV Music, Reading, video, and Jellyfin fallbacks.
- TV activation and directional focus are centralized in `tvFocus.ts`. The cached four-way graph, per-route memory, initial-page rules, loading sentinel, modal/menu trap, opener return, exact playback return, and desktop/Android/webOS/Tizen key aliases share one lifecycle. Shell dropdowns keep only a non-TV keyboard fallback and skip it when the central TV handler owns an event.
- `#/tv-navigation-debug` exposes current focus, focus history, last route/key, candidate/missing counts, graph edges, and broken paths. The complete source inventory and physical-device matrix are in `src/ptv/docs/tv-navigation-audit.md`.

### Home, Browse, And Recommendations

- Native Home, media browse pages, hero/card surfaces, configured rows, recommendation rows, quality tags, route diagnostics, and featured cache v7 are present.
- Recommendation Settings and configured Row Builder rows are separate row sources. Persisted accepted/enabled recommendation rows are the authoritative generated recommendation source.
- Movies, Shows, Anime, Cartoons, and Collections have native browse route ownership and contextual navigation.
- Movies and Shows now distinguish base landing routes from focused URL-addressable views. Movies support Latest, Trending, Genres/exact Genre, and Studios/exact Studio. Shows support Continue, Latest, Trending, Genres/exact Genre, Studios & Networks/exact Studio or Network, and series-scoped Seasons. Existing `view=networks`/`view=network` URLs remain compatible.
- Hash query state participates in route identity. Focused pages use structured server-side filters, 50-item paging, exact metadata-ID resolution, bounded page caching, item-ID deduplication, and stale-response suppression.
- One canonical internal focused-loader key now owns effect reloads, request-generation ownership, page accumulation, and cache isolation. It includes scope/parent/filter/search/sort/page/size state; shareable diagnostics emit a separate sanitized identity that keeps exact public filter names without raw Jellyfin IDs.
- Anime, Anime Movies, and Cartoons aliases resolve to real authenticated Jellyfin user-view IDs and fail closed when unavailable; scoped queries no longer broaden silently.
- Genre directories preserve each exact Jellyfin query value while normalizing presentation casing, deduplicating case-insensitive exact matches, and offering only explicit non-fuzzy alias groups. Curated mode hides a bounded sensitive-genre set per user; All metadata mode exposes the unmodified directory. Counts reuse Jellyfin metadata-directory totals.

### Music And Playback

- Music Home, Explore, Artists, Albums, Songs, and Playlists routes are present.
- Queue, player, persistent dock, likes/playlists, recommendations, MusicBrainz, and Discogs integrations are present.
- Playback state is owned outside page-local route mounts so route changes do not intentionally reset an active queue.
- Details/video media-version UI consumes conflict-safe normalized media-source clusters, so path aliases collapse without allowing reused IDs or sparse ID/signature bridges to hide technically distinct playable files.

### Reading

- Books, Comics, Manga, Explore, Collections, details, series, and reader routes are present.
- Reading uses staged shelf loading, per-shelf failure isolation, pagination, and a separate stale-while-revalidate cache.
- One structured filename parser now drives Identify defaults, provider lookup/ranking, grouping, and fallback labels.
- Classification now honors manual and library-kind evidence before provider or archive-format hints.
- Series grouping uses durable admin overrides, provider IDs, Jellyfin metadata, high-confidence inference, then singleton fallback.
- The companion plugin persists series overrides at `GET/PUT /Ptv/v1/reading/series-overrides/{routeKind}`.
- Google Books search is proxied through `GET /Ptv/v1/reading/metadata/googlebooks/search`; ComicVine remains a Jellyfin remote provider source.
- Reading metadata preview/apply is field-selective and independently reports metadata and artwork results.
- Reading diagnostics require administrator access plus explicit debug mode and redact sensitive values.
- Reading and Identify layouts have fluid desktop widths, touch-sized controls, bounded modal/debug regions, and horizontal shelf overflow.

### Plugin

- `/Ptv/v1` provides status, settings, featured cache, Row Builder, music metadata, Google Books search, Reading series overrides, local remote diagnostics, integrations, tags, random item, and signup endpoints.
- Featured cache version 7 is the accepted schema.
- Frontend-only operation remains possible for Jellyfin-backed routes, but plugin-dependent features require the matching DLL and a Jellyfin restart.

### Debug Export And Performance Hardening

- Final copied/serialized dashboard exports pass through one shared recursive sanitizer. It bounds output, removes secrets/private origins/IDs/local paths/sensitive SMTP detail, replaces complete data-image/blob values, preserves safe version/build identifiers, and omits credential-shape fields without changing administrator-only live panels.
- TMDb enrichment is cache-first, validates credentials once per bounded reuse window, limits each pass to 48 remote candidates and four concurrent requests, and retains completed partial results when cancellation arrives.
- Browse section work uses an explicit priority policy and publishes each shelf independently; card-list payloads continue to use the existing lean field profile.
- Failed images advance through shared candidates and enter capped five-minute negative caches instead of retrying forever or remaining suppressed for the whole session.
- Shell mount telemetry now records an actual component mount once, rather than recording every backdrop-source change as a duplicate mount.

### Local Remote Diagnostics And webOS Operations

- The plugin advertises `remoteDiagnostics` only when the matching API is present. Authenticated PiggieTV web clients check in through a bounded capability-aware transport at `POST /Ptv/v1/diagnostics/clients/check-in`; administrators list/filter clients, start 5- or 10-minute sessions, stop them, request snapshots, and view/download the latest report from Dashboard.
- Remote Client Diagnostics intentionally does not synthesize entries from Jellyfin's active playback sessions. A native Jellyfin Android TV/Fire TV playback session appears only after that runtime also executes the PTV web bundle or a future native/wrapper bridge sends equivalent safe check-ins. Fire TV web/wrapper clients are normalized from UA plus safe app/device/platform metadata, including `Jellyfin Android TV 0.19.9` on Fire OS/Fire TV signals.
- Remote diagnostics summaries now include sanitized display/device/app/version/platform labels, first/last seen times, native-runtime hint, explicit heartbeat/command/report/performance/network/playback/memory capability booleans, and a tiny boot marker with platform/runtime/module/check-in/build/registration state. Internal fallback names such as `oldname_dup` are rejected as primary labels, duplicate friendly names keep the opaque suffix secondary, unsupported actions are disabled, and client/report state remains memory-only with 30-minute expiry.
- The Dashboard now separates Detected Jellyfin sessions from Remote diagnostics clients. Session rows explain LG webOS and Fire TV/Android TV devices as `unsupported`, `server-observed`, `stale-build`, or diagnostics-ready when a real check-in matches; Start diagnostics and Request snapshot remain available only to real full diagnostics clients.
- The Dashboard treats remote-diagnostics client-list responses as untrusted. It normalizes from `unknown`, rejects missing/non-array responses to the empty state, skips rows without a usable `clientId`, deduplicates keys, safely defaults optional strings/booleans/nullables, and logs only compact debug-mode warnings with route/component/source-row metadata.
- Collection is inactive without a valid lease and tears down on expiry, revocation, agent disposal, or an explicit unsupported-capability command. Plugin-side reports are memory-only, expire automatically, and are bound to the authenticated Jellyfin identity.
- Client payloads contain coarse profile, route/render/playback/input/error/network/long-task/FPS/memory evidence and a bounded allowlisted operational log tail. They exclude raw user agents, arbitrary errors/log details, credentials, query strings, private origins, local/media paths, titles, and user/item/source identifiers.
- The client retains at most 300 samples and budgets 160 KiB; the plugin caps presence at 8 KiB and reports at 192 KiB, independently bounds JSON shape/string sizes, and sanitizes again before storage.
- `scripts/ptv-webos.mjs` wraps supported `ares` discovery, information, inspect/log, install, launch, and close flows with explicit inputs, validation, and dry-run support. No live TV mutation was performed during this implementation.

## Reading Production-Hardening Scope

Verified implementation areas from the Reading hardening commit:

- `src/components/itemidentifier/*`
- `src/ptv/modules/books/booksApi.ts`
- `booksClassification.ts`
- `readingFilename.ts`
- `booksSeries.ts`
- `booksSeriesOverrides.ts`
- `readingDiagnostics.ts`
- `booksPage.tsx` and `books.scss`
- plugin configuration, controller, service interface/service, and Reading override models
- focused tests for classification, filename parsing, series grouping/overrides, diagnostics, and Identify normalization/ranking

## Current TV Navigation Validation

| Check | Result |
| --- | --- |
| Focus/route/dropdown/style regression | 6 files, 74 tests passed |
| Central manager/dropdown focused rerun | 2 files, 37 tests passed, including capture-phase exactly-once integration |
| Full PTV Vitest | 61 files and 365 tests passed; one unrelated `pages/home/hooks.test.ts` suite cannot resolve the existing `components/apphost` import through its current dependency graph |
| New manager/debug scoped ESLint | Passed |
| TV/webOS/debug-page Stylelint | Passed |
| Isolated browser harness | 17 tests passed for keyboard focus, TV viewport/runtime, Android portal dropdown, Back/Escape restoration, resize, swipe, and route behavior |
| TypeScript | Blocked by three pre-existing dirty-worktree errors in remote-diagnostics/render-profile code; no TV-navigation error reported |
| Production Webpack | Asset compilation completed, then the same three unrelated TypeScript errors failed the build gate |
| `git diff --check` | Passed with line-ending notices only |
| Physical devices | Required before release; no physical LG, Fire TV, Android TV, or Tizen pass is claimed |

The automated suite covers desktop keyboard semantics and Android/Fire TV, LG webOS, and Tizen event signatures. It cannot prove firmware event delivery or overscan/focus visibility on real hardware.

## Prior 2026-07-19 Worktree Validation Status

Before the later uncommitted render-profile/remote-diagnostics edits and TV navigation corrective audit, the 2026-07-19 worktree had this successful baseline:

| Check | Result |
| --- | --- |
| Targeted frontend tests | 9 files, 58 tests passed |
| Secret scanner | `npm run secret:scan` passed |
| RemoteDiagnosticsStoreTests | `dotnet test ... --filter "FullyQualifiedName~RemoteDiagnosticsStoreTests"` passed |
| Media-source deduplication | 13 tests passed, including conflict bridges and transitive aliases |
| TV focus/dropdown/style contracts | 21 tests passed across focus, dropdown, and TV/webOS visual contracts |
| Remote-diagnostics frontend/API/dashboard | 24 tests passed |
| Remote Diagnostics dashboard crash/session/capability regression | `RemoteDiagnosticsPanel.test.tsx` 14/14 passed for undefined client ID, null display fields, missing/non-array response, malformed row, empty response, partial loading, valid response, duplicate names, unsupported capabilities, refresh recovery, detected Fire TV native unsupported state, and LG webOS runtime/cache explanation |
| Companion plugin tests | 20 tests passed |
| Type/build check | `npm run build:check` passed |
| Changed-source ESLint | Passed |
| webOS Stylelint | Passed |
| Plugin contract | API 1, cache 7, plugin `<private-address>`, target `10.11.8`, web `10.11.11` passed |
| Production Webpack build | Passed in 90.3 seconds |
| Follow-up production Webpack build | Passed after the dashboard crash fix |
| Webpack warnings | Existing aggregate asset-size and entrypoint-size warnings only |
| `git diff --check` | Passed |
| Repository hygiene audit | No tracked `.dotnet-home`, Vite result, split-development log/PID, or nested plugin project/test `bin`/`obj`; no physical nested plugin `bin`/`obj` remained |
| Deployable plugin payload | Five files preserved and rebuilt after the latest plugin source change |

The older dated validation sections below remain historical evidence; they do not override the current TV navigation table or the current coupled frontend/plugin deployment boundary.

### 2026-07-14 Movies/Shows Browse Validation

| Check | Result |
| --- | --- |
| Focused browse tests | 4 files, 17 tests passed |
| Full Vitest suite | 33 files, 258 tests passed |
| TypeScript | Passed with `--noEmit` |
| New standalone-file ESLint | Passed with zero findings |
| Touched legacy ESLint | No new findings; `NativeBrowsePage.tsx` improves from the 20-finding HEAD baseline to 19, and shell/controller retain the same 32-finding HEAD baseline |
| Scoped Stylelint | One unchanged `nativeBrowse.scss:492` selector-order baseline error; all added style rules pass |
| Production Webpack | Passed; final compile 74.173 seconds |
| Webpack warnings | Existing aggregate asset-size and entrypoint-size warnings only |
| Companion plugin | Not rebuilt because no plugin source or API contract changed |

### 2026-07-14 Authenticated Runtime Corrective Hardening

| Check | Result |
| --- | --- |
| Authenticated export | Parsed successfully: 120 events from `dashboard-live-merged` |
| Proven focused Movies behavior | Genre directory reported 59 entries; exact genre loads reported 2/2 and 50/395 items, with the 50-item first page completing in 634.6 ms |
| Proven cache/plugin health | Featured cache v7 adopted from plugin storage, fresh/stored, 356 items, 25 sections, 6 persisted recommendation rows |
| Export defects found | Semantic versions misclassified as private hosts; credential length/SMTP password-state fields retained |
| Export defects fixed | Safe versions/build IDs retained; credential-shape fields omitted; complete data-image/blob payloads replaced |
| Route telemetry defect fixed | Lifecycle counters now synchronize current browser location before selecting route generation |
| Focused regression suite | 5 files, 22 tests passed |
| Full Vitest suite | 34 files, 263 tests passed |
| TypeScript | Passed with `--noEmit` |
| Scoped ESLint | New standalone files passed; touched legacy-file findings reproduce against HEAD |
| Scoped Stylelint | No style changed; unchanged `nativeBrowse.scss:492` baseline remains |
| Production Webpack | Passed in 106.7 seconds; compilation 92.588 seconds |
| Webpack warnings | Existing aggregate asset-size and entrypoint-size warnings only |
| Companion plugin | Not rebuilt because no plugin source or API contract changed |

This export does not prove Universal Pictures or network selection, Shows focused routes, scoped alias isolation, Trending stability, season routes, second-page UI accumulation, back/forward restoration, or the three diagnostics authorization combinations. Automated contracts cover these paths, but authenticated deployment verification remains required before blanket production sign-off.

### 2026-07-14 Focused Loader Identity Correction

The previously reported loader key (`movies:genre:genre:unscoped:0`) was generated only for diagnostics. Behavioral reloads already depended on the parsed route object, and late responses were guarded by cancellation state plus route generation, so the omission was diagnostic-only. The correction nevertheless promotes one complete identity into effect ownership and the focused cache, making the invariant explicit and independently testable.

| Check | Result |
| --- | --- |
| Focused browse/route tests | 5 files, 31 tests passed |
| Full Vitest suite | 35 files, 277 tests passed |
| TypeScript | Passed with `--noEmit` |
| New/data-file ESLint | Passed with zero findings |
| Legacy touched ESLint | `NativeBrowsePage.tsx` reports 17 errors and 2 warnings both before and after this change; no new findings |
| Production Webpack | Passed in 80.9 seconds; compilation 78.352 seconds |
| Webpack warnings | Existing aggregate asset-size and entrypoint-size warnings only |
| `git diff --check` | Passed; line-ending notices only |
| Companion plugin | Not rebuilt because no plugin source or API contract changed |

Regression coverage proves distinct keys for sequential genre, studio, network, scope, search, sort, and page transitions; keyed state reset; same-filter page accumulation; cached prior-filter restoration; and suppression of a late Crime response after Horror becomes active. The shared Jellyfin API path does not accept an `AbortSignal`, so old requests are retired and their results suppressed rather than transport-cancelled.

Live authenticated desktop/mobile/TV verification remains required for real library counts, exact Universal Pictures/network metadata, multi-page scrolling, and history/return scroll behavior. No Reading implementation or plugin contract was changed by this browse pass.

### 2026-07-14 Genre Directory And Deployment Verification

| Check | Result |
| --- | --- |
| Focused browse/route/directory tests | 6 files, 37 tests passed |
| Full Vitest suite | 36 files, 283 tests passed |
| TypeScript | Passed with `--noEmit` |
| New standalone/data ESLint | Passed with zero findings |
| Legacy touched ESLint | `NativeBrowsePage.tsx` remains 17 errors/2 warnings and `PTVShell.tsx` remains 26 errors/1 warning, exactly matching HEAD baselines |
| Scoped Stylelint | One unchanged `nativeBrowse.scss:492` selector-order error, identical at HEAD and in the worktree |
| Production Webpack | Passed in 211 seconds; compilation 184.232 seconds |
| Webpack warnings | Existing aggregate asset-size and entrypoint-size warnings only |
| `git diff --check` | Passed |
| Changed-file secret/private-data scan | Passed; no credentials, tokens, authorization values, raw private URLs, or raw stable Jellyfin IDs |
| Current local bundle | `http://localhost:8080/` returned HTTP 200 and contains current shell/network-label markers |
| Companion plugin | Not rebuilt; no plugin source or API contract changed |

The Shows directory is intentionally labeled **Studios & Networks** because it is backed by Jellyfin `getStudios` and `StudioIds`. Genre aliases affect presentation only; focused requests retain the exact original server value. The newest local bundle is confirmed served, but authenticated route interactions and device input remain manual deployment checks.

The global lint/style failures are demonstrated pre-existing and non-blocking for this delivery: counts exactly match the prior baseline, new standalone files lint clean, touched legacy-file findings are on unchanged lines, the Reading scope has zero errors, and the failing Stylelint files were not changed by this pass. Generated `dist`, Babel cache, Vitest result, and plugin `bin/obj` changes were cleaned or restored. Four generated root development logs are removed from tracking and ignored because they contain machine-local runtime output.

## Deployment Verification Still Required

- Replace all five files from `src/ptv/plugin/bin` together, restart Jellyfin, and confirm `/Ptv/v1/status?full` advertises `remoteDiagnostics` before publishing the matching frontend.
- Deploy the complete rebuilt frontend atomically, accept the service-worker update or fully relaunch cached wrapper clients, then verify the Dashboard client list and an administrator-started 5-minute session against an authenticated client.
- Verify Google Books and ComicVine result selection and field application against a live authenticated server.
- Verify durable Reading series overrides across browser/device changes and Jellyfin restart.
- Verify representative 390, 768, 1440, and 2560 pixel viewports with real data.
- Verify touch shelf scrolling, Enter/Select/OK/Accept activation, dropdown wrapping/Back restoration, and Fire TV low-power behavior on devices.
- Retest the supplied LG webOS cases for static glass readability, card/hero geometry, focus visibility, one-action-per-OK press, and Music/video ownership.
- Monitor the one reported transient legacy Jellyfin header appearance. It cleared after hard refresh and has not been reproduced in local automated validation.

## Known Constraints And Risks

- The frontend package is `10.11.11`, while the plugin currently targets Jellyfin package `10.11.8`; compatibility must be checked when either side is upgraded.
- A frontend/plugin capability mismatch can make Google Books search, durable series overrides, or remote diagnostics appear unavailable even when the frontend renders normally; verify advertised capabilities rather than version text alone.
- Automated tests cannot validate third-party provider availability or server metadata-provider behavior.
- Webpack bundle-size warnings remain a performance debt; no new build error is present.
- Do not treat localStorage as authoritative for Reading series overrides.
- A manual remote-diagnostics Stop can leave the server's newest stored report up to one 15-second client interval behind. Request and view a snapshot before Stop when the final instant matters.
- Browser tests cannot certify firmware-specific LG/Tizen key dispatch or the visual/performance result on physical TVs.
- Remote diagnostics is deliberately transient and memory-only; it is not a historical observability store and must not be expanded into external telemetry without a separate security/privacy design.

## Next Delivery Step

Review and commit the complete worktree, including generated-file removals and these project-memory updates. Deploy the five-file companion-plugin payload, restart Jellyfin and verify its capability, then atomically publish the matching frontend, accept the frontend update, verify authenticated remote diagnostics, and run the physical LG/webOS and broader TV matrix in `HANDOFF.md`.

### 2026-07-14 Production Hardening Program

Status: locally verified and ready for deployment-stage manual checks.

Delivered boundaries:

- GitHub Actions for frontend tests/types/lint/privacy/build/browser checks and path-scoped plugin contract/tests.
- Build provenance and frontend/plugin compatibility reporting in the PTV dashboard.
- User-mediated service-worker updates that defer while playback is active.
- Extracted browse-directory and shell-backdrop ownership without changing focused loader, cache, route, playback, or plugin contracts.
- Searchable/alphabetical directory UX with Curated/All preference, bounded per-user recents, 120-entry incremental rendering, responsive focus, and no request fan-out.
- Route-aware dashboard enhancement loading plus existing lazy reader boundaries.
- Deterministic Chromium coverage for authentication ownership, focused browse lifecycle, service-worker updates, keyboard focus, and exact desktop/tablet/mobile/TV viewports.
- Repository size, bundle size, secret, and frontend/plugin contract reports; contributor, PR, issue, and release-checklist guidance.

Final local results:

| Check | Result |
| --- | --- |
| Focused PTV Vitest | 28 files, 165 tests passed |
| Full Vitest | 41 files, 334 tests passed |
| Playwright Chromium | 26 tests passed |
| TypeScript | Passed with `--noEmit` |
| PTV inherited ESLint gate | Passed at recorded baseline: 170 errors, 23 warnings |
| New hardening-file ESLint | Passed with zero findings |
| PTV Stylelint | Passed with zero findings |
| Plugin contract | Frontend/plugin API v1 and cache v7 compatible |
| Plugin tests | 4 passed on net9.0 |
| Production Webpack | Passed in 199.6 seconds; two established size warnings |
| Main production output | 857.5 KiB main script; 4.1 MiB combined main entrypoint; 246 KiB service worker |
| Secret scan | Passed for tracked and untracked, non-ignored repository paths |
| Repository report | 119,114 tracked files, 1333.48 MiB; 1303.83 MiB is generated/dependency material |

One new integration defect was found and fixed during final verification: Vitest initially collected the new Playwright specs, causing three framework-mismatch suite failures while 334 unit tests passed. `vite.config.ts` now limits Vitest discovery to `src/**/*.{test,spec}.{js,jsx,ts,tsx}`; the corrected full suite passes.

Known non-blocking debt remains explicit: the inherited PTV ESLint baseline, Webpack size warnings, historically tracked dependency/build trees, two project assets over 1 MiB that are future Git LFS candidates, and six duplicate project-owned binary groups. No history rewrite, LFS migration, tracked dependency removal, or asset deletion was performed.

### 2026-07-14 Authentication Header Visibility Correction

The header visible over the custom login page was the globally mounted stable `AppHeader` from `RootAppRouter`, not a page-local `PTVShell`. The experimental layout had the same missing authentication exclusion for its Jellyfin-style app bar and drawer. Both header owners now use the shared exact route classifier in `authenticationRoutes.ts`. Visible authenticated controls remain unmounted on authentication routes, while the stable header owner retains a hidden compatibility host containing only Jellyfin's required drawer and skin-header anchors. The existing PTV login enhancer and shell route registry use the same classifier, eliminating divergent login parsing.

Authentication classification ignores query parameters and covers plain/query login, server selection, manual login, password recovery/reset, quick connect, and signup. React Router location ownership restores authenticated headers immediately after leaving authentication and handles query-only and browser history changes without a timing delay or broad CSS selector.

| Check | Result |
| --- | --- |
| Focused authentication/header/shell tests | 3 files, 35 tests passed |
| Full Vitest suite | 38 files, 315 tests passed |
| TypeScript | Passed with `--noEmit` |
| Scoped ESLint | Passed with zero findings |
| Stylelint | Not run; no style source changed |
| Production Webpack | Passed in 78.6 seconds; compilation 76.139 seconds |
| Webpack warnings | Existing aggregate asset-size and entrypoint-size warnings only |
| `git diff --check` | Passed; line-ending notices only |
| Corrective local runtime probes | Plain/query login at desktop, tablet, mobile, and TV sizes rendered without the runtime-error overlay or visible PiggieTV header; the hidden compatibility host, drawer anchor, and skin-header anchor were present in every case |
| Companion plugin | Not rebuilt; no plugin source or API contract changed |

Manual deployment verification remains required for a real expired-session redirect, logout/login, successful authenticated navigation, and back/forward transitions against the configured Jellyfin server. Native Jellyfin fallback pages and normal authenticated headers were not changed.

The first visibility implementation fully unmounted `AppHeader`. That exposed an existing Jellyfin lifecycle contract: `scripts/libraryMenu` queries `.mainDrawer .scrollContainer` and `.skinHeader` during module evaluation, including from the login controller. Missing anchors caused the reported `querySelector`, `setTabs`, `classList`, and circular `__WEBPACK_DEFAULT_EXPORT__` initialization cascade. `AppHeader.test.tsx` now protects the corrected boundary: hidden anchors remain available, but the visible header, sidebar, and drawer handle do not mount.

### 2026-07-14 Authenticated Debug Corrective Pass

- Reading no longer treats 200 items as a terminal browser cap. It loads 50-item pages with concurrency two, exposes initial/background/complete/cache/retired progress, renders the first 200 promptly, cancels stale server/user/library/route ownership, deduplicates item identities, and persists only complete library indexes under Reading index schema 4. The 1,818-item regression fixture completes in 37 pages, and a late 50/200-item stage cannot replace a fuller 1,818-item active result.
- Movies and Shows now have distinct shell owners. Lifecycle telemetry synchronizes from the current location before each render/unmount event, including Shows -> Reading -> Dashboard -> history -> authentication transitions.
- The frontend override paths already matched source controller routes. The authenticated 404 evidence therefore identifies an outdated installed plugin DLL. The current plugin status now advertises `readingSeriesOverrides`, and frontend/plugin contract tests enforce both GET and PUT routes. Browser storage is reported as cache-only whenever server authority is unavailable.
- Plugin startup reads wait for Jellyfin authentication and deduplicate by endpoint. The regression test reduces six concurrent callers to three authenticated network reads (status/settings/featured), with zero pre-authentication requests or 401 responses and one controlled authentication retry.
- Dashboard runtime diagnostics read `window.__PTV_RUNTIME_STATE__` through the canonical singleton and report that source explicitly. Build provenance reports development for the dev server and uses `development-fallback`/`unavailable` instead of ambiguous `unknown` compile-time values.
- Reading image-profile cache-hit telemetry keeps exact aggregate totals by profile/type while sampling representative counts 1, 2, 3, 10, 25, 50, and each 100. A 101-hit sequence retains 7 events instead of 101, and the bounded buffer retires image noise before route/API errors. Static-logo observer age is no longer reported as network load duration.
- Final local verification: focused 10 files/38 tests; full Vitest 45 files/348 tests; TypeScript passed; PTV Stylelint has zero findings; scoped ESLint remains at its recorded 170-error/23-warning inherited baseline with no increase; plugin contract passed; plugin tests 7/7 and Release build passed; Playwright 27/27 passed; production Webpack passed with only the established asset/entrypoint size warnings.

Deployment requires the frontend and companion plugin from the same revision. Replace the installed plugin DLL and restart Jellyfin before expecting Reading override server authority or the new advertised feature. A routine browser cache clear is not required; accept/reload the new frontend bundle normally.

### 2026-07-15 Plugin/Frontend Release Pair

Status: locally release-verified; deployment has not been performed.

- The companion plugin patch is `<private-address>`, replacing installed/source release `<private-address>`. API major `1`, featured cache schema `7`, Jellyfin package target `10.11.8`, and manifest target ABI `<private-address>` are unchanged.
- Plugin version authority is the `PtvPluginVersion` project property. Assembly/file versions, status responses, the provider user agent, source/published manifests, contract checks, and release documentation now resolve from or verify that value.
- Frontend compatibility keeps `<private-address>` connected for the supported API/cache contract but reports `readingSeriesOverrides` as upgrade-required. `<private-address>` advertising the feature is compatible. Browser storage remains explicitly labeled a local cache fallback, never server authority.
- Published payload: `Jellyfin.Plugin.PiggieTV.dll`, `.deps.json`, `.pdb`, `.xml`, and `meta.json` in `src/ptv/plugin/bin`. The DLL and manifest both report `<private-address>`.
- Final verification: focused compatibility 12/12, full Vitest 351/351, plugin 9/9, plugin contract passed, TypeScript passed, scoped ESLint passed, Release build/publish passed with zero .NET warnings/errors, production Webpack passed with the established asset/entrypoint size warnings, and the 119,152-path secret scan passed.
- Deployment order is plugin payload -> Jellyfin restart -> capability/status verification -> matching frontend. A routine browser/service-worker purge is not required; use the normal update/reload path first.

### 2026-07-15 Deployment-Stage Verification

Status: corrected local plugin/frontend candidate passes; production deployment remains on hold.

- Installed plugin advanced from `<private-address>` to `<private-address>` using the complete five-file payload. The pre-deployment plugin and web-root backups were hash/count verified and retained.
- The first `<private-address>` startup returned HTTP 500 from full status because Jellyfin's XML serializer cannot persist the nested Reading override dictionary. `PluginConfiguration` now persists a sorted XML route-list surrogate and reconstructs the runtime dictionaries. Plugin tests pass 10/10, including configuration round-trip coverage.
- Corrected startup loads `Jellyfin.Plugin.PiggieTV, Version=<private-address>` without plugin dependency, controller, ABI, or configuration errors. Authenticated full status returns HTTP 200 with plugin `<private-address>`, API `1`, cache `7`, `readingSeriesOverrides=true`, `ok=true`, and `degraded=false`.
- Authenticated GET and PUT succeeded for books, comics, manga, and reading override routes. A synthetic correction survived a clean Jellyfin restart, then all original empty documents were restored and reverified.
- Production frontend build `10.11.11-ptv-20260715.7-78a6e2b6` reports commit `78a6e2b6bc-dirty` and production environment. It passed when Jellyfin served the repository `dist` as its web directory. The permanent Program Files web root was not modified because Windows denied replacement without elevated filesystem permission.
- The production entry now imports the canonical PTV runtime. Dashboard plugin calls wait for the current authenticated Jellyfin API client, deduplicate status/settings/featured reads, and abort cleanly on unmount. Live Dashboard verification produced one HTTP 200 request for each distinct startup resource and no page errors.
- Service-worker registration now resolves relative to Jellyfin's `/web` base. `/web/serviceworker.js` is active with `/web/` scope after one normal reload; there was one registration, a controlling worker, and no reload loop.
- Desktop and mobile query-bearing login probes rendered the login form with zero visible authenticated PTV/native headers and retained the hidden compatibility host. No plugin request was made before authentication.
- Route ownership remained exact through Shows -> Reading -> Dashboard -> Reading -> Shows -> browser back Reading -> browser forward Shows -> Login, with successive generations and no cross-owner render attribution.
- The exact 1,818-item Manga path remains automation-verified (200-item initial stage, 50-item pages, 37 total pages, bounded concurrency two, complete monotonic merge) but could not be timed against the real remote content server. The local verification server contains no Manga library data.
- Final checks: full Vitest 45 files/354 tests, plugin 10/10, plugin contract, TypeScript, scoped ESLint, secret scan, production Webpack, and `git diff --check` pass. Stylelint was not rerun because no style source changed. Webpack retains only established asset/entrypoint size warnings.
- Production recommendation is HOLD until an administrator deploys the matching frontend to the permanent web root and the real 1,818-item Manga library reaches 1,818/1,818. No rollback was performed; both backups remain available.

### 2026-07-15 Android Primary-Navigation Dropdown Correction

Status: implementation and automated verification pass; physical Android Chrome and iOS Safari confirmation remain manual deployment checks.

- The Movies/Shows menu state was changing correctly on Android, but the panel was an inline descendant of the horizontally scrolling, backdrop-filtered primary navigation. Android Chromium clipped that panel at the navigation stacking/overflow boundary, so the menu existed in the DOM but was not visible or usable.
- Primary menus now render through a body portal, use visual-viewport-aware fixed positioning, remain above page rows and below dialogs, and reposition on resize, orientation, visual viewport, page scroll, and navigation-row scroll. Outside tap, Escape, route/history changes, selection, and opening another menu close the current menu deterministically.
- Pointer Events distinguish a tap from a horizontal nav swipe without duplicate touch/click handlers. Keyboard Arrow Down opens and focuses the first item; menu arrows cycle focus; Escape restores trigger focus. ARIA ownership links the trigger and portal panel.
- Focused Vitest passed 11/11; full Vitest passed 365/365; TypeScript, scoped ESLint, PTV ESLint baseline enforcement, Stylelint, 36/36 Playwright tests, production Webpack, and the Android-specific 9/9 Playwright matrix passed. Webpack retained only the established aggregate asset and entrypoint size warnings.
- No plugin source, API contract, cache schema, route, or visual layout was changed for this correction.

### 2026-07-15 Urgent Cross-Platform Runtime Correction

Status: source and automated browser verification pass; physical-device confirmation against the configured Jellyfin server remains required.

- Exact failure: `NavDrawer.edgeContainer` captured `document.querySelector('.mainDrawerHandle')` during construction. Authentication routes intentionally omit that visible authenticated handle, so touch-capable startup later called `dom.addEventListener` with a null target. The failure occurred in `setEdgeSwipeEnabled` and could abort login/application rendering on Android Chrome, iPad Safari, and desktop bundles that exercised the same lifecycle.
- Correction: edge-swipe setup now resolves its target at lifecycle time, fails closed if no handle exists, stores the exact bound element, removes from that exact element, and binds each replacement target once. `libraryMenu` reconciles edge swipe on every page show so login-to-app and same-page-type replacements do not retain stale ownership.
- The body-level Movies/Shows dropdown portal remains. It did not modify `NavDrawer`, `libraryMenu`, or authentication compatibility markup and was not the null-target source.
- Verification: 3 focused files/32 tests; full Vitest 48 files/370 tests; TypeScript; scoped ESLint; PTV Stylelint; Chromium Playwright 36/36; WebKit Playwright 34 passed/1 platform-policy skip; production Webpack; secret scan; and `git diff --check` all pass. Webpack retains only the two established aggregate size warnings. The WebKit skip is the harness's link-Tab-order check because Safari delegates link tabbing to the platform full-keyboard-access preference; all WebKit login, routing, blank-root, history, dropdown, and resize cases run.
- Fresh development probes for desktop Chrome, Pixel-class touch Chromium, and iPad WebKit rendered plain login without page errors, runtime overlay, or visible authenticated header. Production static smoke produced populated login/home roots without page errors, but a static server cannot prove authenticated Home against Jellyfin. The deterministic browser harness covers login-to-application/history lifecycle; physical Pixel, iPad Safari, and configured desktop checks remain the deployment gate.
- No plugin source, API contract, cache schema, route, login-card design, or authenticated header design changed.

### 2026-07-15 Split-Origin Runtime And Authenticated Geometry Correction

Status: corrected source and live split-origin development bundle pass automated unauthenticated verification; release remains HOLD pending authenticated physical-device Home, Reading, and Dashboard verification.

- Corrected origin root cause: the frontend and Jellyfin hosts are intentionally different. The prior loopback-rebasing remediation incorrectly inferred the Jellyfin hostname from the Webpack hostname. Startup could first pin loopback, Jellyfin could later recover the saved server, and plugin calls could remain pinned to the stale root. `PTV_DEV_JELLYFIN_URL` is now the development-only authority, exact `serverid` selection and authenticated clients follow it, and the plugin API retires stale roots. Production bundles cannot embed the development value.
- Corrected layout root cause: global shell rules changed Jellyfin's stock `.mainAnimatedPages`, `.mainAnimatedPage`, and `.page` geometry. The stock animated container entered normal flow at viewport height ahead of native PTV content, causing the Home black spacer, Reading content at the bottom, and blank Dashboard body. Geometry is now scoped to PTV-owned shell elements.
- Live checks passed 6/6 in Chromium and 6/6 in WebKit across desktop, Pixel, and iPad profiles. With stale loopback storage seeded, the first server discovery request used the explicit Jellyfin backend and never the frontend hostname. Login geometry, NavDrawer provenance, service-worker ownership, and unauthenticated Home redirect/reload also passed without console/page/overlay errors.
- Final automated gates: focused origin/plugin/layout 18/18; full Vitest 51 files/385 tests; TypeScript; scoped ESLint; shell Stylelint; Chromium live Playwright 6/6; WebKit live Playwright 6/6; secret scan over 119,166 paths; production Webpack in 110.1 seconds; production-address scan; and `git diff --check` pass. The first full run had one featured-cache timeout; its isolated rerun passed in 235 ms and the immediate complete rerun passed 385/385. Webpack retains only the two established aggregate size warnings.
- No credential from supplied evidence was copied into source, tests, documentation, commands, or diagnostics. The exposed token must still be revoked. No plugin source, API/cache contract, deployment, commit, push, or remote state changed.
- Remaining gate: restart the intended development server with `PTV_DEV_JELLYFIN_URL` set, then authenticate on physical desktop/Pixel/iPad clients and verify Home, Reading, Dashboard, reload/history, dropdowns, logout/login, and Jellyfin/plugin request ownership. Until then this is not release-ready.

### 2026-07-15 Music Playback Duplication And Live-Loading Correction

Status: source and automated validation pass; release remains **HOLD** until the authenticated real `#/music` route is physically verified against the configured Jellyfin backend.

- Music alone showed two PTV players because its route module mounted a persistent `PtvMusicPlayerDock` in addition to the global `PTVMediaDock`. The route root now hosts overlays only; the global bottom-right dock is the sole compact renderer. Controller/audio/queue ownership remains one-to-one and the single native audio element is unchanged.
- Jellyfin's stock `.nowPlayingBar` is suppressed only while a PTV-native route actively owns playback presentation. The class is lifecycle-controlled by the global dock, so fallback/native Jellyfin presentation returns without a permanent global CSS override.
- Queue progress publication is capped at one event per second, subscriber-owned one-second timers were removed, and global low-frequency reconciliation pauses while native Music owns the current item. Playback-manager event handlers are detached during test/HMR disposal.
- A stale unauthenticated `ServerConnections` client previously masked an authenticated window client, so plugin startup timed out before URL candidates or attempted responses existed. Authenticated-client precedence now allows candidate/root resolution while retaining explicit split-origin backend authority.
- Cached Music home data no longer depends on `libraryDebug` to leave the loading label. The library index now exposes scheduled/loading/ready/failed state and settles to cached count, live count, or an explicit unavailable-live-count fallback. Current request generations alone may update terminal state.
- Host read-only probes reached Jellyfin Public with HTTP 200 and protected plugin status/settings/featured endpoints with HTTP 401 while unauthenticated, proving network and route reachability without credentials. Fresh unauthenticated browser-origin fetches failed at the browser transport boundary, including Public, which is consistent with cross-origin/session context and is not an authenticated plugin result.
- Validation: focused Music/plugin playback tests 5 files/11 tests; full Vitest 55 files/392 tests on the final rerun; TypeScript passed; scoped ESLint had zero errors and three inherited nested-function warnings in `musicPage.tsx`; changed Music/shell Stylelint passed; live Chromium 6/6 and live WebKit 6/6; production Webpack compiled in 90.834 seconds with the two established aggregate size warnings.
- One cold full-suite run timed out the first `featuredContentCache` dynamic import at five seconds. Its isolated rerun passed 4/4 in 253 ms and the immediate complete rerun passed all 392 tests. The failed invocation `--project=chromium` was a command/config mismatch because this Playwright configuration has no named project; the corrected live command passed 6/6.
- No plugin source or API/cache contract was changed by this corrective pass. No deployment, Jellyfin restart, commit, push, credential extraction, or user-data change occurred.

### 2026-07-16 Video Dock Leakage And Update Reload Correction

Status: source and automated verification pass; release remains **HOLD** pending authenticated physical playback and deployed service-worker verification.

- The global playback service observes Jellyfin and PTV sources, but the dock previously rendered every active item. `PTVMediaDock` now requires PTV Music ownership plus Audio media identity and retires immediately on video playback routes. Movie, Episode, Series, and Trailer states never render the PTV dock or suppress Jellyfin's native presentation.
- The update service previously relied indefinitely on `controllerchange`, and a session reload marker could remain set after the prior update and suppress later reloads. Update application now has one in-flight attempt, posts `SKIP_WAITING`, reloads once on controller change, falls back after three seconds or immediately when activation messaging is unavailable, clears stale markers, and hides the notice at the terminal reload transition.
- Focused playback/update tests pass 22/22. The final full Vitest run passes 55 files/403 tests. The first full run had one unchanged featured-cache test exceed its five-second timeout; its isolated rerun passed 4/4 in 261 ms and the immediate full rerun passed 403/403.
- TypeScript and scoped changed-file ESLint pass. The E2E bundle builds and the general Playwright matrix passes 8/8. Production Webpack compiled in 92.581 seconds with only the established aggregate asset/entrypoint size warnings. The 119,171-path secret scan and `git diff --check` pass.
- No style, plugin, API/cache contract, route, deployment, restart, user data, commit, push, or remote state changed. Physical Music -> video -> Music handoff and a real waiting-service-worker reload remain the release gate.

### 2026-07-16 Reading Override XML Serialization Correction

Status: source, tests, and release payload pass; server deployment is blocked by unavailable non-interactive SSH credentials.

- Root cause: Jellyfin attempted to serialize the public nested `ReadingSeriesOverrideSettings.Routes` dictionary and threw `NotSupportedException`, causing authenticated plugin status requests to return HTTP 500.
- Correction: Reading override dictionaries are private runtime state. The only public persisted property is a deterministic XML-safe route/override array, accessed through `GetRoute`, `SetRoute`, and `RemoveRoute` helpers.
- Frontend correction: HTTP 5xx responses are classified as plugin server errors and remain distinct from endpoint/network failures. Status and bounded redacted response details remain available in diagnostics.
- Verification: plugin 13/13, focused plugin API 7/7, full Vitest 405/405, TypeScript, scoped ESLint, plugin contract, secret scan, production Webpack, and `git diff --check` pass. Production Webpack retains only established asset/entrypoint size warnings.
- Release payload: exactly five files in `src/ptv/plugin/bin`; DLL assembly/file version and `meta.json` all report `<private-address>`.
- Deployment boundary: SSH to both the Proxmox hop and Jellyfin guest rejected non-interactive authentication. No server file, service, or backup was changed. Anonymous endpoint probes correctly returned HTTP 401, so authenticated post-restart 200 verification remains pending.

### 2026-07-16 Production Chunk Coherency Correction

Status: source and automated verification pass; production frontend deployment remains pending.

- Physical evidence showed a stale production runtime requesting async chunk `90212.432920e11e02eefe99af.chunk.js`. The chunk existed locally and at the Jellyfin origin. During diagnosis the public bare URL returned HTTP 503 while the same path with a query returned HTTP 200; later probes returned 200 for both, confirming an intermittent CDN/path-cache failure rather than a missing build artifact.
- Production async JavaScript and CSS requests now carry a build-scoped `ptv_asset` query. The route error boundary performs at most one same-origin chunk recovery reload per build/request and preserves the hash route.
- `scripts/deploy-jellyfin-web.ps1` now copies assets before `index.html`, atomically replaces the entry document last, and SHA-256 verifies every deployed source file. A clean-target simulation copied and verified 2,498 files, including the reported chunk.
- Verification: focused chunk recovery 5/5; full Vitest 57 files/410 tests; TypeScript; scoped ESLint; production Webpack in 82.371 seconds; and `git diff --check` pass. Webpack retains only the established aggregate size warnings.
- No frontend or corrected plugin payload was deployed. The supplied server log shows an installed assembly labeled `<private-address>` still exposing the old public Reading override dictionary, so the previously staged XML-safe five-file plugin payload and Jellyfin restart remain separately required.

### 2026-07-16 Authenticated Diagnostics Cleanup

Status: source and automated verification pass. The supplied authenticated export reports plugin connected, version `<private-address>`, API `1`, cache schema `7`, `readingSeriesOverrides` available, compatibility compatible, and Reading indexing complete at 2,911/2,911.

- Fallback/admin route diagnostics no longer retain a native Reading header. Native shell cleanup resets all header fields, and the foundation rejects an unmounted, mismatched, or fallback-owned header snapshot.
- Reading background index publication is coalesced into bounded monotonic milestones. Completion always publishes, but repeated partial batches no longer trigger equivalent `reading-page-rendered` or `reading-shell-ready` work.
- Playback reconciliation owns no interval while item, session, and playback source are absent. Active Jellyfin playback still receives its one-second reconcile; native Music and the fixed video mini-player presentation behavior are unchanged.
- Successful status/settings/featured plugin responses now appear in the bounded attempted-response diagnostics with sanitized path, status, success, and duration. Failure classification and redaction remain intact.
- Validation: focused 5 files/13 tests; final full Vitest 59 files/415 tests; TypeScript passed; new helper/service/API scoped ESLint passed; the PTV ESLint baseline passed with no per-file increase; production Webpack compiled in 107.006 seconds with only the established asset/entrypoint size warnings; final `git diff --check` passed.
- The first full-suite run had one unchanged featured-cache test exceed its five-second timeout. That file passed isolated 4/4 in 267 ms and the immediate full rerun passed 415/415, demonstrating transient suite contention rather than a patch regression.
- No plugin source, plugin payload, API/cache contract, video mini-player behavior, deployment, restart, commit, push, or remote state changed in this pass.

### 2026-07-16 Details Ownership And Video Playback Handoff

Status: source and automated verification pass; authenticated live playback remains a manual release check.

- `#/details?id=...` and `#/item...` now classify as PiggieTV-native routes. A header-only shared shell replaces the visible legacy Jellyfin header while retaining Jellyfin's working details metadata/actions. Header-safe layout rules remove the inherited large top spacer. `#/music/item/...` remains Music-owned and `#/video` remains Jellyfin playback-owned.
- Entering `#/video` or receiving active Jellyfin video playback now pauses native PiggieTV Music immediately, preserves its queue/index/position, suppresses stale `ptv-music` global state during video ownership, and prevents automatic resume when video ends. The media dock remains hidden during video and can return only with paused Music state after leaving video.
- Verification: focused 6 files/40 tests; final full Vitest 60 files/431 tests; TypeScript passed; scoped regression ESLint and changed Stylelint passed; production Webpack compiled in 106.7 seconds with only the established aggregate size warnings; isolated E2E harness passed 36 tests with 6 opt-in live tests skipped; `git diff --check` passed.
- The first full Vitest run had one unchanged featured-cache timeout (430/431); that file passed isolated 4/4 and the immediate full rerun passed 431/431. Full-file PTVShell/route-controller ESLint still reports exactly the pre-existing 31 errors and one warning present at `HEAD`; the new/changed regression scope adds no lint debt.
- Live Playwright reached the development frontend and passed served-bundle provenance, but fresh contexts had no saved Jellyfin server or authenticated session and stopped at Select Server. Five authenticated-route assertions therefore did not execute. Signed-in Music -> details -> video -> details -> explicit Music resume remains required against the intended split-origin backend.
- No plugin/backend source, API/cache schema, deployment, Jellyfin restart, commit, push, or remote state changed for this correction.

### 2026-07-16 Native Details Geometry Correction

Status: source and deterministic automated verification pass; authenticated physical item verification remains pending.

- Root cause: the PiggieTV details shell owned the route but still inherited stock Jellyfin geometry. The flowing `40vh` backdrop created the blank top gap, an unnamed two-column grid mishandled Jellyfin's three primary children, and stock ribbon height, absolute logo placement, `32.45vw` content padding, and secondary-section margins collapsed and displaced native content.
- Correction: a reversible details-layout lifecycle now applies native root/primary/secondary classes and relocates/restores the logo. Named grid areas stabilize poster/ribbon/content placement; tightly scoped SCSS resets stock offsets, restores readable metadata widths and wrapping chips, aligns secondary shelves, and reserves dock-safe bottom space. Desktop and mobile retain the current PiggieTV header and do not affect `#/video` or `#/music/item/...` ownership.
- Verification: focused Vitest 7 files/42 tests; full Vitest 61 files/433 tests; TypeScript passed; scoped ESLint and details Stylelint passed; Playwright harness 38 passed/6 opt-in live skipped, including new 2560x1271 and 390x844 geometry checks; production Webpack completed in 101.095 seconds with only the established aggregate asset/entrypoint size warnings; details `git diff --check` passed.
- Live boundary: `<development-frontend>:8082` served HTTP 200 and passed bundle/provenance inspection. Fresh Playwright profiles stopped at Jellyfin Select Server instead of authenticated details; supplying `<test-server>:8096` did not replace the dev bundle's retained localhost selection. No authenticated movie/show/episode geometry or audible playback sequence was claimed.
- Scope: frontend details layout, styles, isolated E2E fixture, and tests only. Plugin/backend source, deployment, restart, commit, push, and remote state were not changed. The verified Music-to-video pause/no-auto-resume behavior remains covered by the passing full suite.

### 2026-07-17 Native Details Artwork And Premium Glass

Status: implementation and deterministic automated verification pass; authenticated movie/show/season/episode visual inspection remains pending.

- Details now render a dedicated fixed artwork layer behind the full native page. Candidate order is Backdrop, Thumb, Primary, then the existing themed gradient; image failures advance deterministically and late Jellyfin DOM refreshes cannot replace the authoritative item candidate list.
- Scoped purple-glass tokens and reusable glass classes now cover the title ribbon, poster, action controls, metadata, primary sections, Cast & Crew, and related shelves. Dark masks retain readability while allowing artwork to remain visible. Low-power, reduced-motion, and unsupported-filter fallbacks preserve the same layout.
- Regression coverage verifies route ownership, one PiggieTV header, artwork/fallback lifecycle, glass classification, header clearance, aligned secondary sections, readable overview width, mobile stacking, chip wrapping, and absence of horizontal overflow.
- Verification: focused Vitest 3 files/15 tests; final full Vitest 61 files/436 tests; TypeScript passed; scoped ESLint passed; details Stylelint passed; focused Playwright 2/2 passed at desktop and mobile geometry; production Webpack completed in 101.809 seconds with only established asset/entrypoint size warnings; `git diff --check` passed with line-ending notices only.
- The passing full suite includes Music queue, global playback-state, and media-dock regression coverage. No plugin/backend, API contract, route ownership, video ownership, or Music/video handoff implementation changed in this pass.

### 2026-07-17 Shared Shell Surface Correction

Status: implementation and deterministic desktop/tablet/mobile verification pass; physical Pixel Chrome and iPad Safari inspection remains pending.

- Root cause: native details styling recreated a rounded glass surface on the complete shared header, and the mobile breakpoint independently applied another full-width glass strip. Utility icons were transparent, so removing the strip also required assigning glass ownership to the controls themselves.
- The shared header root is now explicitly transparent with no border, shadow, or blur at every breakpoint. The center navigation remains the only navigation glass pill and is physically centered by a symmetric grid. Top-right utility icons now have individual purple glass, while Search keeps its larger circular surface.
- Details artwork and panel glass remain unchanged. Android portal dropdown behavior and the video-to-Music playback handoff remain protected by passing tests. Production Autoprefixer emits `-webkit-backdrop-filter` for the shell utility glass.
- Verification: focused Vitest 6 files/26 tests; full Vitest 62 files/439 tests; TypeScript passed; scoped ESLint passed; shell/details Stylelint passed; focused shell/details/dropdown Playwright 15/15 plus the added tablet rerun 5/5; full Playwright 42 passed/6 opt-in live skipped; production Webpack completed in 90.6 seconds with only established size warnings; `git diff --check` passed with line-ending notices only.
- Frontend-only scope. No plugin/backend, cache schema, playback ownership, deployment, restart, commit, push, or remote state changed.

### 2026-07-17 Details Lifecycle, Artwork, Versions, And Video Polish

Status: implementation and deterministic automated verification pass; authenticated physical Movie/Series/Season/Episode and video inspection remains pending.

- Root causes fixed: old detail generations could commit after navigation; first navigation could be marked handled before the authenticated API client was available; artwork lacked parent fallbacks and preload ownership; duplicated media-source rows drove false version counts; shell icons inherited line-height offsets; and video controls retained an overly dark stock surface.
- Details now clear stale state immediately, gate all asynchronous commits by generation and item ID, preload stable poster/logo/backdrop slots, resolve parent artwork fallbacks, and preserve a themed background when all candidates fail. Series/season supporting requests run concurrently without allowing late data to replace the active item.
- Version indicators and selectors share deterministic media-source deduplication. Episode video headings render `Series · SxxExx - Episode`, including a parent-title fallback. Top-right utility icons use equal grid-centered controls, and the video OSD uses readable translucent purple-blue glass.
- Verification: focused suites passed; final full Vitest passed 66 files/450 tests; TypeScript passed; scoped ESLint passed with six pre-existing warning comments/comparator warnings and no errors; changed Stylelint passed; focused desktop/mobile/tablet Playwright passed 7/7; production Webpack compiled in 84.892 seconds with only established asset/entrypoint size warnings; `git diff --check` passed with repository line-ending notices only.
- Scope remains frontend-only. Plugin/backend source, API/cache contracts, video ownership, Music pause-on-video/no-auto-resume behavior, deployment, restart, commit, push, and remote state were not changed.

### 2026-07-18 Shell Utilities, Settings Shell, And First-Navigation Details Correction

Status: implementation and deterministic verification pass; authenticated physical timing and visual confirmation remain pending.

- Dashboard icon root cause: the shared admin-visibility hook cached an unauthenticated `false` before Jellyfin user readiness and never reconsidered it. It now reacts to Jellyfin sign-in/sign-out lifecycle, invalidates provisional access, and restores/removes administrator controls without a shell remount.
- Icon alignment root cause: a late global `.ptv-icon` rule forced a right margin into shell utility buttons. Shell/search utility contexts now reset that margin, preserving equal-size grid centering inside the individual glass controls.
- Details first-navigation root cause: the PTV enhancer could run before the Jellyfin controller finished replacing/populating details DOM, mark the page handled, and separately refetch the item and preload its poster. The controller now emits the committed active item; PTV consumes it, applies direct artwork immediately, upgrades parent artwork only for the same active item, and reapplies layout classes after later DOM mutations without duplicate item/image work.
- Settings root cause: the route only restyled stock content and never mounted `PTVShell`. Settings now mounts a lifecycle-owned header-only shell and scoped header-safe content spacing.
- Verification: focused Vitest 6 files/24 tests plus clean admin teardown rerun 2/2; final full Vitest 69 files/457 tests; TypeScript passed; scoped ESLint zero errors with five inherited item-details warnings; Stylelint passed; focused Playwright shell/details 7/7; production Webpack compiled in 106.7 seconds with only established asset/entrypoint size warnings; `git diff --check` passed with line-ending notices only.
- Scope remains frontend-only. Plugin/backend code, API/cache contracts, `#/video`, Music pause-on-video/no-auto-resume behavior, deployment, restart, commit, push, and remote state were not changed.

### 2026-07-18 TV Compatibility And webOS Recovery Pass

Status: source and automated validation pass; physical TV verification remains open.

- Replaced dimension-driven TV assumptions with an authoritative client-profile decision covering LG webOS, Samsung Tizen, Android TV, Fire TV, Roku, explicit ten-foot clients, capabilities, platform classes, and a bounded detection reason. A normal 1920x1080 desktop browser remains desktop.
- Added centralized TV and webOS profile styles. Ten-foot mode now uses fixed nonshrinking cards, overscan-safe gutters, bounded heroes/title art, large shell controls, visible rail navigation, details geometry, and 720p/1080p/4K tokens. webOS receives static translucent purple surfaces without relying on backdrop-filter, reflections, or scale-heavy animation.
- Added a route-scoped TV focus engine with geometric arrow navigation, focus restoration, scroll-into-view, back-key handling, and strong visible focus. Desktop hover expansion is disabled in TV mode.
- Native Music/Reading aliases now participate in route ownership, and `PTVShell` establishes shell ownership in the layout phase to reduce first-frame legacy-header exposure. Jellyfin video ownership and the Music-to-video handoff were not changed.
- Diagnostics now report TV platform/reason, coarse-pointer and hover flags, CSS capabilities, applied root classes, a clipped user agent, and bounded mounted row/card counts.
- Verification: focused Vitest 4 files/23 tests; full Vitest 72 files/477 tests; TypeScript passed; scoped new-code ESLint passed; changed Stylelint passed; Playwright 43 passed with 6 opt-in live-server cases skipped; production Webpack compiled successfully with the two established size warnings.
- Deployment boundary: frontend only. No plugin build, API/cache schema, Jellyfin restart, commit, push, or remote deployment occurred. Deploy the complete frontend bundle atomically, accept the service-worker update or clear the wrapper cache, then physically retest LG webOS, Tizen, Android TV/Fire TV, and the remaining client wrappers.

### 2026-07-19 Media Identity, Remote Input, Diagnostics, And Repository Hygiene

Status: implementation and automated validation pass; coupled deployment and physical TV verification remain open.

- Media-source alias clustering now uses normalized path, compatible source ID, and strong technical signature evidence. Exact path matches always remain authoritative; same-ID records merge only when shared technical fields are compatible; technically conflicting graph clusters cannot be joined by a sparse ID/signature bridge. Privacy-safe comparison evidence is capped at 24 and contains no paths, titles, or source IDs.
- TV input normalization now includes Enter/Select/OK/Accept names and key codes 13/23/66, plus webOS Back 461 and Tizen Back 10009. Shell dropdown coverage protects exactly-once activation, arrow wrapping, initial focus, Back close/restore, and pointer behavior. webOS static glass alpha is lighter while blur, reflections, and scale-heavy animation remain disabled.
- Local remote diagnostics adds a schema-1 leased client agent, capability-aware plugin transport, administrator Dashboard panel, authenticated plugin controller, bounded in-memory store, identity binding, request-size/JSON-shape enforcement, expiry/revocation, and privacy regression coverage. The server keeps one latest report per client and accepts the newest final uploads during the short natural-expiry grace period.
- Repository cleanup removes tracked `.dotnet-home`, Vite result, split-development log/PID, and nested plugin project/test `bin`/`obj` output. The top-level five-file plugin deployment payload remains tracked and was rebuilt after the final C# change.
- The optional `ares` wrapper and `src/ptv/docs/webos-cli.md` document safe discovery, information, inspect/log, install, launch, and close workflows. Actual device discovery was read-only; state-changing commands were dry-run only.
- Verification passed as recorded in the current Final Validation Status table. No commit, push, frontend/plugin deployment, package installation, remote state change, or Jellyfin restart occurred.

### 2026-07-20 Architecture Consolidation Baseline And Reading Cache v5

Status: current architecture documented; consolidation implementation has not started. The next delivery program is refactor-first and must replace duplicate cross-media systems through shared adapters rather than add more isolated fixes.

- The target platform has one `RecommendationEngine`, `MetadataService`, `ArtworkService`, `PTVCache`, `BrowseFramework`, `DetailsFramework`, `PlaybackService`, `PTVApiClient`, `PTVDiagnostics`, `PerformanceManager`, and `FocusManager`. Existing Movie, Show, Music, Reading, Live TV, Dashboard, dialog, and player implementations remain supported transitional consumers until each is migrated and its duplicate boundary is removed.
- Reading home cache now uses schema v5. Complete entries and partial summaries use separate tiers. A v5 route-scope pointer is written only after a successful complete persistent write and is keyed by server, user, route, and view; it enables a cold session to locate only the current route's resolved-library complete cache. Stale complete entries retain `isPartial: false` and report `cacheDiagnostics.staleHit` while a matching refresh runs.
- Strict Reading precedence is: fresh complete memory, fresh complete persistent, stale complete persistent, summary only when complete data is absent, then refresh. Full-cache writes reject partial payloads, and complete-cache reads reject malformed partial entries. V4 Reading-home cache keys are not read by v5.
- Existing performance protections remain in place: shared Reading library-resolution promises, bounded shelf concurrency, deferred final-only grouping, route-generation stale-response rejection, and route-scoped artwork failure state. The exact real-server Books/Comics/Manga totals and latency targets remain unverified pending authenticated Jellyfin access.
- Focused Reading validation passed 4 files/25 tests. `npm run build:check` and `npm run build:production` passed; production Webpack emitted only the established asset/entrypoint-size warnings. No deployment, restart, commit, push, or remote state change occurred.
- Consolidation order: establish shared API-client and diagnostics contracts; migrate cache and artwork; migrate recommendation providers; adapt browse and details; then converge metadata, playback, performance, and focus. Every phase must publish old/new dependency evidence, removed duplicates, compatibility tests, metrics, and open technical debt in all project-memory files.

### 2026-07-20 Library Root Normalization And Search Audit

Status: shared normalization service implemented for native Search and focused Browse aggregation; no physical-root filter was found in the current native Search request.

- `libraryRootNormalizer.ts` groups equivalent mergerfs, bind-mount, SMB, and Windows physical roots into logical media roots without issuing a request. It prefers collection metadata and Jellyfin IDs, uses path normalization only as a fallback, and deduplicates only by item ID, `PresentationUniqueKey`, or path hash.
- Native Search is already path-agnostic: it queries Jellyfin `Users/{user}/Items` by `IncludeItemTypes` and `SearchTerm` without `ParentId` or filesystem-path parameters. It now normalizes and deduplicates the returned group data and reports normalized roots, physical roots, library IDs, and duplicate suppression in administrator diagnostics. Focused Browse uses the same result aggregation service while retaining correct Jellyfin ID-based scope queries.
- Therefore, if an item such as `Toy Story 5` is absent from the raw path-agnostic Jellyfin response, that is upstream search/index behavior rather than a PTV physical-root exclusion. The diagnostics now provide the evidence needed to distinguish that case without adding requests or fabricating a `/media-local` exception.

### 2026-07-20 Bounded Movie Search Recovery

Status: implementation and targeted regression coverage added; authenticated live-server reproduction remains pending.

- PTV preserves the standard global Movie search as the primary path and conditionally supplements only a sparse/root-divergent Movie result from the user-authorized Latest Movies endpoint. The recovery pool is bounded to 96, shared and TTL-cached for two minutes by server/user/media/field profile, locally matched, and merged before the result limit.
- The recovery path has no storage, database, admin, or hard-coded mount dependency. It is unavailable to Shows, Music, Reading, and every other non-Movie category. Existing logical query cancellation prevents stale group state from committing after a new search begins.
- Diagnostics now retain the primary/supplemental timing, cache source, trigger/reason, candidate/match/final counts, raw parent IDs, normalized roots, and timeout/abort status. The remaining release gate is a signed-in browser verification that `Toy Story` displays all five expected Movies, including `Toy Story 5`, under the actual Jellyfin server and its artwork permissions.

## 2026-07-22 connected LG inspection boundary

The physical television is connected through ares as PiggieTV-LG. Read-only system information identifies LG 70UN7070PUA, webOS SDK 5.6.2, firmware 04.64.00, and board K6LP_ATSC_US.

The official installed Jellyfin wrapper remains outside the Developer Mode sandbox. Installed and running app enumeration returns no package, inspector attachment to org.jellyfin.webos times out, and the tv profile rejects ares-shell and ares-log. Device access is therefore healthy while store-app runtime access is unavailable.

No frontend or TV mutation was performed. The physical P1 remains blocked on either an explicitly approved inspectable development wrapper or equivalent embedded runtime diagnostics from the production web bundle. Items, database contention, authenticated interaction, and physical correction gates remain unchanged.

## 2026-07-22 physical photo and branding-owner audit

The physical LG photo is now directly available and supersedes the earlier photo-unavailable limitation. It confirms The Simpsons hero metadata is compressed behind a giant combined PiggieTV banner, the shared navigation and utilities overlap that region, the first shelf is absent, and a large empty blurred lower panel occupies much of the display.

Visual comparison proves the oversized artwork is src/ptv/assets/logo/banner-light.png. Source tracing shows native PTVShell assigns that asset to the ptv-shell-brand image. The base shell rule intends to cap it with clamp-based dimensions, and the TV profile provides literal 196 by 64 pixel maxima. The physical output proves those bounds are not effective on the television, but no live DOM/CSS evidence exists to distinguish stale or mixed assets, missing TV profile classes, unsupported base clamp declarations, or a source-order/specificity override.

The physical LG still is not configured in ares; discovery lists only the local emulator. No source, CSS, tests, build, deployment, cache, service worker, or TV state changed. The P1 remains open pending real-device provenance and a narrow evidence-based correction.

## 2026-07-21 physical LG webOS Home regression

Production readiness has a new independent P1 blocker. A real LG webOS television shows broken Home shell/hero ownership: oversized PiggieTV and Powered by Jellyfin branding inside the hero, compressed obscured metadata, header/navigation/utility overlap, no visible first shelf, and a large empty blurred lower surface. Desktop and emulated TV results do not supersede this physical baseline.

Required provenance could not be collected. The local webOS CLI lists only the emulator at 127.0.0.1:6622, with no physical LG device configured, and the supplied attachment directory contains only the text report rather than the referenced photo. Loaded build, service-worker state, chunks, TV profile, classes, live DOM owner, CSS winners, geometry, and focus state remain unknown.

No frontend source, CSS, tests, build, deployment, server, plugin, or TV state was changed. Next work must connect the same physical LG through the supported ares developer-mode path, capture provenance before CSS changes, rule out stale or mixed assets, then inspect DOM/CSS and apply the narrowest verified correction. Items latency and authenticated interaction blockers remain unchanged.

## 2026-07-21 post-fix automated validation

The deferred automated gate is now complete. Focused shared-client and coordinated Items coverage passed 2 files and 9 tests. TypeScript/build policy passed with zero errors. Production Webpack compiled successfully in 104.624 seconds and emitted only the two established aggregate asset and entrypoint size warnings.

This validates the generated Jellyfin ItemFields enum import, query normalization behavior, coordinated Items path, and production bundling. It does not replace authenticated interaction, warm/cold discovery, representative playback-write logging, read-only SQLite/host investigation, or physical webOS acceptance. Production readiness remains blocked on those live gates.

## 2026-07-21 clean post-restart verification sample

The new 8,908-line Jellyfin restart log validates the shared ItemFields sanitizer for the traffic it observed. Three PTV Latest/Resume field queries contain only generated-enum members, with zero field binder conversion errors, zero UserData field errors, zero database-lock messages, zero optimistic retries, zero HTTP 500s, and zero error lines.

Five successful requests crossed Jellyfin's slow-response threshold at 1.51 to 3.24 seconds. This is materially healthier than the preceding sample but spans only about two minutes after restart and includes no playback-progress write. The earlier SQLite lock and broad 6.5-to-93.4-second tail remain unresolved release evidence.

One static-file warning reports a missing /var/lib/jellyfin/wwwroot while Jellyfin is configured with /usr/share/jellyfin/web. Review that deployment distinction separately; the sample does not connect it to API latency. No code, test, build, deployment, plugin, database, or server configuration change was made for this verification prompt.

## 2026-07-21 ItemFields Boundary and Server Lock Evidence

Production readiness remains blocked. The supplied post-correction Jellyfin log has no UserData ItemFields conversion failure, but it has 256 debug conversion exceptions for other unsupported PTV field tokens. The shared API client now filters every PTV Fields query through the generated Jellyfin SDK ItemFields enum, canonicalizes and deduplicates valid values, and removes an empty field parameter.

The same log proves server-side contention: playback user-data commit hit SQLite database is locked after three optimistic retries, and /Sessions/Playing/Progress returned HTTP 500 after 35.22 seconds. Forty-two slow responses span Genre, Studio, BoxSet, Season, Episode, and playback endpoints, including successful reads up to 93.39 seconds. Playback Reporting events overlap the lock window, but causation is not established.

No test or build was run for this log-audit prompt. Required follow-up is focused/type/build validation, fresh traffic with zero ItemFields binder exceptions, read-only database/host/plugin timing evidence, the unchanged same-account live gates, and physical webOS acceptance. Do not raise timeouts or call the release ready.

### 2026-07-20 Movie Search Timeout Recovery

Status: implementation and targeted automated validation complete; authenticated live-server validation is required before release.

- Movie recovery is now based on an explicit primary outcome, so `timeout`, recoverable `error`, and successful empty results no longer fall through to `complete-primary-result`. Aborted requests and authorization failures intentionally do not use recovery.
- The Movie group can render user-authorized Latest results after primary timeout/error and exposes the retained primary status/error/duration through administrator diagnostics. The supplemental candidate window remains bounded to 96 and shares the existing two-minute scoped cache.
- Grouped search continues to use two queued workers, not one request per category. The priority order is Movies/Shows/Collections, then Episodes/Reading, then Music/Albums/Artists; each completed group commits immediately.
- Validation: 11 focused tests passed. Pending live evidence: signed-in `toy story` search showing `primaryStatus`, triggered recovery reason when applicable, nonzero candidates/matches, and Toy Story 1-5 including correct details navigation/artwork.

### 2026-07-20 Search Recovery Latest Candidate Audit

Status: parser/request diagnostics and automated coverage complete; live server population evidence remains pending.

- The shared Latest helper now supports both Jellyfin response shapes and reports invalid payloads safely. Movie recovery remains user-authorized and unscoped across accessible Movie roots, with an explicit `ParentId` omission and a bounded 96-item request.
- Administrator Search diagnostics now retain the exact sanitized Latest contract plus response shape, raw/total count, response keys, candidate sample, logical roots, and matched names. This will establish whether a low candidate count originates in Jellyfin's actual Latest response or client parsing.
- Focused tests: 13 passed. Release remains blocked on an authenticated live `toy story` result proving Toy Story 5 appears in the supplemental candidate sample and final Movie cards.
# 2026-07-20 Movie Search Catalog Recovery

Implemented bounded, cached global Movie catalog recovery in `movieSearchCatalog.ts`; it replaces the newest-96 `Items/Latest` pool. The catalog is server/user scoped, parent-unscoped, paged, deduplicated with logical-root identities, and only hydrates discovered matches. Native Movie search renders primary results before catalog completion.

Pending production evidence: an authenticated live `toy story` search must report Toy Story 5 from a catalog page and `finalCount=5` without duplicates.
# 2026-07-20 Rolling Diagnostics Storage

Implemented centralized bounded JSONL diagnostics persistence with rolling logs, retention, privacy sanitizer reuse, storage status/actions, and legacy cleanup safeguards. Existing remote diagnostics remains in-memory for active sessions; only sanitized summaries/reports are persisted asynchronously through the rolling writer.

Pending live verification: repeated check-ins and searches must append to one `ptv-diagnostics.log`, never create per-event files, rotate at the configured size, and report bounded retention in the dashboard.

## Project state: authenticated non-admin validation (2026-07-21)

Status: scoped regression fixes complete and authenticated non-admin validation passing.

Completed:

- Preserved before baseline at `test-results/authenticated-discovery/discovery-report.json`.
- Generated corrected after route report, focused artwork probe, and interaction report.
- Corrected route-failure classification so optional image 404 responses do not fail functional pages.
- Prevented unadvertised image probes and cross-dimension retries.
- Stabilized Movies and Shows focused browse shell ownership.
- Removed Preferences double-shell/overflow behavior.
- Suppressed non-admin calls to administrator-only plugin endpoints.
- Confirmed Music Artists content and corrected the harness route.
- Added accessible names to Music controls; unnamed controls are now 0.
- De-overlapped Music recommendation shelves.
- Passed all requested stateful interactions, including playback continuation and TV-like focus.

Measured before -> after:

- Functional route failures: 12 -> 0
- Broad-run image 404 responses: 118 -> 7
- Unnamed controls: 117 -> 0
- Duplicate image paths: 8 -> 1
- Overflow routes: 1 -> 0
- Long tasks: 11 -> 2
- Maximum long task: 394 ms -> 91 ms
- Broken visible images: 0 -> 0

Validation:

- Authenticated discovery: 23/23 desktop routes passed.
- Responsive discovery: 4/4 profiles passed.
- Authenticated interactions: 13/13 passed.
- TypeScript build check: passed.
- Production build: passed with two existing size warnings.
- Test assertions: 570/570 passed.
- Full test file collection: 87 passed and 3 failed because Vitest cannot resolve Jellyfin's `components/apphost` boundary.

Open work:

- Add focused test mocks or a purpose-built Vitest resolver for the three Jellyfin bootstrap-dependent suites.
- Profile administrator-only Dashboard work using a separately authorized admin session.
- Run the TV focus checks on a physical Fire TV, Android TV, or webOS device.
- Repair or refresh the remaining stale Jellyfin image metadata; PTV already renders fallbacks without retry storms.

## 2026-07-21 Production-readiness checkpoint

Status: **blocked, not production-ready**.

Completed gates:

- Production webpack build passed with known size warnings.
- Build policy check passed.
- 91 unit-test files and 615 tests passed.
- Final warm-cache authenticated discovery passed 23 of 23 routes.
- Final route pass recorded no image 404s, broken visible images, exact duplicate
  artwork URLs, transform variants, or failed fallbacks.
- All four responsive target sizes had one shell and no horizontal overflow.

Blocked gates:

- Final authenticated interactions passed 4 of 13 checks.
- Authenticated Jellyfin `Items` latency measured 19.8 seconds and remained above
  8 seconds on immediate repeat.
- Physical webOS validation has not been run.

Severity state: P0 release gate blocked, P1 authenticated item-pipeline latency,
P2 physical webOS verification gap, and P3 webpack size warnings/warm-cache
measurement limitations. See `PRODUCTION_READINESS_REPORT.md` for evidence and
next steps.

## Project state: authenticated Items pipeline (2026-07-21)

Status: frontend request amplification fixed; production release remains
blocked by remote Jellyfin tail latency, failed interactions, missing cold/warm
route reruns, and physical webOS.

- `getPtvItems` and `getPtvResumeItems` now preserve their Jellyfin endpoint and
  query contracts while entering the shared `requestPtvJson` in-flight
  coordinator.
- Retired Home loads skip recommendation quality hydration before dispatch and
  emit a bounded route-retired diagnostic.
- Movies fan-out improved from 11 requests/peak 9/four duplicate pairs/one stale
  47-item hydration to five requests/peak 4/no duplicates/no stale hydration.
- Remaining remote evidence is not healthy: Movie browse p95 11.32 seconds,
  direct Movie card maximum 12.97 seconds, and `ApiClient` Views maximum 22.03
  seconds. Transport path did not explain the variance; time before headers
  dominates.
- Interaction results are 7/13 corrected and 3/13 warm. Existing thresholds
  were unchanged.
- Local gates pass: focused 10/10, full 617/617, TypeScript, and production
  Webpack with two established warnings.
- The dedicated browser became unauthenticated after the non-destructive HTTP
  cold-cache reload. Cold/warm discovery remains blocked until that same account
  is signed in again.
- No database, plugin, reverse-proxy, mount, server, cache schema, route, UI,
  playback, focus, or user-data configuration was changed.
## 2026-07-21 ItemFields compatibility state

- Release remains blocked after two reauthenticated 12/13 interaction runs.
- A live Jellyfin `System.FormatException` proved that `UserData` was incorrectly serialized as an `ItemFields` request value.
- Shared PTV item profiles and the Books, Music, and Jellyfin recommendation request lists now omit `UserData`; response models, caches, favorites, progress, and `EnableUserData` behavior remain intact.
- The first warm discovery was 22/23. The later broad-overflow cold/warm artifacts were contaminated by the invisible Webpack Dev Server overlay iframe and are not release evidence.
- The clean cold retry invalidated the dedicated session. Post-fix authenticated interaction/discovery validation and physical webOS validation remain required.
## 2026-07-21 Post-ItemFields live state

- Live traffic observed 44 recent `Items` requests with zero `UserData` values in `Fields`; the client-side compatibility correction is active.
- Unchanged interactions passed 11/13, then 5/13 over 222.9 seconds. Release remains blocked by nondeterministic content/state completion and remote tail latency.
- Clean warm discovery passed 21/23; Reading Books had six functional failed requests and Preferences missed required content. Responsive geometry passed.
- The clean cold attempt filtered the dev-only overlay but lost same-account authentication after reload, so no authoritative cold result exists.
- Final source still needs unit/type/build validation. Physical webOS and read-only server/host investigation remain outstanding.

## Phase F3 current state

Premium Collections and cross-library discovery implementation is present on the local branch. Existing router, request coordinator, cache, settings transport, recommendation, playback, authentication, and focus owners remain authoritative. Acceptance status must be taken from the final F3 validation report; implementation alone is not an approval claim.

## Current status: F3A2 HOLD

Authenticated latency attribution shows fast frontend route recognition and request admission, with backend/proxy transport dominating slow Collections settlement. A one-shot browser transport failure recovered through one visible retry. Browser-TV focus passed in development and frozen production, but three-cycle acceptance, live Collection Search capability, production deep-scroll proof, and real second-user isolation are incomplete. Product source is unchanged; only validation tooling, tests, and documentation were added. The sole next phase is F3A3 - Collection Search Capability and Backend Latency Closure.
