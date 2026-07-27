# PTV Core Phase 2E Design Audit: Focused Episode-Details Lookup

Updated: 2026-07-24
Canonical contract: `ptv-core/v1`

This is an incremental checklist. “Already migrated” means a v1 contract or
compatibility adapter exists; it does not mean the legacy implementation has
been removed.

## 2026-07-24 backend attribution: Phase 2E remains HOLD

The backend attribution pass changed no Core contract, facade, projection,
runtime owner, platform adapter, route, playback, authentication, cache, or
Android source. It added only a privacy-safe operational evidence harness and
focus-detail capture to the existing browser matrix.

Current evidence is worse, not a reason to expand Core: item-read p90 is
34.906 seconds, warm/repeat/transport-cold pass 9/13, 12/13, and 11/13, and a
scheduled `Optimize database` execution is strongly correlated with the worst
68.615-second window. A severe tail also predates that task, and host CPU/disk
evidence remains unavailable. Phase 2E and production stay HOLD. The next
action is an explicitly approved operational isolation/host-observation
window, not another portable API boundary.

## 2026-07-24 stabilization status: Core expansion remains HOLD

The authenticated Items stabilization pass did not reopen Phase 2E and did not
add or adopt a Core API boundary. A legacy request-lifecycle correction shares
exact concurrent item-detail and browse-directory reads through the existing
Web request coordinator. Legacy Jellyfin transport, DTO/error identity,
rendering, and settled-request behavior remain authoritative.

This is not Episode Core adoption. The same-account final graph has zero exact
duplicates, but p90 time to headers remains 3.644 seconds and each scenario
pass remains 12/13. Current server/host/database correlation was unavailable,
so the Phase 2E HOLD and production HOLD both remain. The next architectural
work is operational read-only backend attribution, not another portable
boundary.

## Phase 2E audit decision: HOLD

Phase 2E is a design audit only. No production call, Core boundary, navigation
intent, schema, test behavior, UI, or platform owner changed.

The decision is **HOLD**. A focused single-Episode boundary is technically
possible, but the only low-coupling seam has no demonstrated portable consumer
or distinct policy value. It is normally bypassed because Jellyfin's details
controller hands the already-loaded raw item to the PTV enhancement lifecycle.
A new Episode projection would duplicate the existing generic `getPtvItem`
boundary and most of the Phase 2C season-episode projection. The higher-traffic
single-item reads are coupled to routing, media sources, playback, queues,
context mutation, editors, featured/continue presentation, or remote players
and are excluded.

### Inventory method and common contracts

The source audit found 45 direct production `.getItem(...)` expressions, two
SDK single-item helpers, one additional bound `getItem` hydration loop, the
direct item URL fallback inside `getPtvItem`, every `getEpisodes` call, and all
current `getPtvItem` consumers.

The inventory uses these common transport profiles:

- **L** — legacy `ApiClient.getItem(currentUserId, itemId)`: the selected
  Jellyfin client owns server/authentication and its normal request behavior.
  The caller supplies no fields/options, cancellation, timeout, retry, or
  coordinator unless its row says otherwise. The resolved raw DTO and unknown
  fields retain identity; rejection is the original platform error.
- **Q** — SDK/React Query `getUserLibraryApi(api).getItem({ userId, itemId },
  { signal })`: authentication remains SDK-owned; the query key coordinates
  consumers, stale time is one second in `getItemQuery`, cancellation uses the
  supplied signal, and React Query retains its configured error/retry policy.
- **C** — `getPtvItem(itemId, { serverId?, userId? })`: one legacy `getItem`
  call, or the existing direct item URL fallback when no client method exists;
  one in-flight coordinator key, generic Core item normalization/diagnostics,
  raw object identity and unknown fields retained, and original transport
  errors rethrown by identity. No Episode-specific policy exists.
- **E** — `ApiClient.getEpisodes(seriesId, options)`: a list result, not a
  single-item lookup. Each row records its distinct options and consumer.

### Episode-relevant call inventory

Every distinct call below was evaluated separately even when it shares a
transport helper.

| ID | File and function | Caller / feature and exact request | Consumer and raw/fallback contract | Async, errors, effects, coverage | Decision |
| --- | --- | --- | --- | --- | --- |
| A1 | `controllers/itemDetails/index.js:getPromise` | Stock details route; profile L with route `id`, selected server, current user, no fields | Whole raw DTO is media-source-normalized, stored as `currentItem`, and drives all details rendering/actions | `DetailRequestGate` suppresses stale responses; no request abort/timeout/retry/sharing. Failure logs and leaves details unavailable. Unit gate/lifecycle tests and Phase 2D Episode route/refresh cover it | Reject: main DTO materially drives resume, media-source selection, and playback |
| A2 | `controllers/itemDetails/index.js:onMoreCommandsClick` | More Commands; profile L with selected media-source ID or current item ID | Raw item and current user feed `itemContextMenu`; delete/update may reroute/reload | No coordination/cancellation; rejection is not locally handled. Covered indirectly by details/context-menu behavior | Reject: context mutation, deletion, playback/queue commands |
| A3 | `ptv/modules/details/index.js:enhanceDetailItem` | PTV details fallback after event/DOM inspection; profile L with hash `id`/`itemId` and hash-selected server | Raw DTO is passed unchanged to shell-section and artwork enhancement; Episode uses Type and image/parent fields | Dataset pending guard and route-current check suppress duplicate/stale application; no abort/timeout/retry/shared promise. Failure is swallowed after warning. Source lifecycle tests; Phase 2D covers normal rendered-item path, not forced fallback | Closest low-risk seam, but HOLD for duplication/insufficient value |
| A4 | `ptv/modules/details/index.js:applyDetailItem` | Optional parent artwork; one profile-L call for each distinct `ParentId`, `SeasonId`, `SeriesId` | Parent raw DTOs contribute only image candidates; direct Episode artwork paints first | `Promise.all`, each rejection becomes `null`; no cache/cancel/timeout/retry, route-current suppression. Lifecycle test proves nonblocking order | Reject: these are parent DTOs, not Episode details, and add no Episode semantics |
| A5 | `hooks/useItem.ts:fetchItem` via `appRouter.showItem(string)` | Generic navigation hydration; profile Q with route item ID | Raw SDK DTO determines route before navigation | Query coordination/cancellation/stale policy; errors log and navigation does not occur | Reject: route-stack ownership |
| A6 | `hooks/useItem.ts:fetchItem` via `themeMediaPlayer.loadThemeMedia` | View item hydration; profile Q | DTO type/collection chooses inherited theme media | Query coordination; errors log. Can start theme audio/video | Reject: playback |
| A7 | `hooks/useItem.ts:fetchItem` via `displayMirrorManager.mirrorIfEnabled` | Active-view hydration; profile Q | Name/ID/type sent to remote player | Query coordination; errors log | Reject: remote playback/display ownership |
| A8 | `hooks/useItem.ts:useItem` via experimental `ItemsView` | Parent view hydration; profile Q | Parent DTO configures the experimental library listing | Query coordination; not Episode-specific | Reject: parent/list owner, no focused Episode policy |
| A9 | `useGetItemByType` via `MoreCommandsButton` | SDK user/item request with AbortSignal and type-specific query key | Raw item builds context-menu play/queue/edit options and post-delete parent route | React Query coordination/retry policy | Reject: context mutation, playback, route behavior |
| A10 | `components/itemMediaInfo:loadMediaInfo` | Profile L with dialog item ID | Full raw `MediaSources`/streams build media-info dialog | No caller coordination/cancel/timeout/retry; current user loaded separately | Reject: media-source/stream boundary |
| A11 | `components/shortcuts:getItem` | Profile L from card dataset | Raw DTO feeds context menu, play/queue, playlist and mutation actions | No coordination; rejection propagates | Reject: context mutation and playback |
| A12 | `components/nowPlayingBar:onStateChanged` | Profile L for currently playing item | UserData and raw DTO update rating/favorite/context controls | Repeats on player state changes; no stale gate/coordination; failure not locally handled | Reject: active playback and favorite state |
| A13 | `components/playback/playbackmanager:getItemsForPlayback` | Profile L when one playback ID is requested | Full raw DTO becomes a playback item | Existing playback promise chain; no Core policy | Reject: playback negotiation |
| A14 | `playbackmanager:getPlaybackMediaSource` | Profile L for item/media-source ID | `MediaSources`/streams select playback source | Playback-owned fallback and error chain | Reject: media-source selection/transcoding |
| A15 | `playbackmanager` next-item refresh | Profile L for queued next item | Raw DTO replaces queue item | Queue-owned promise chain | Reject: queue/autoplay |
| A16 | `ptv/modules/playback:fetchRelatedItem` | Profile L for parent/season/series artwork IDs | Raw parents feed pause-overlay backdrop/logo/disc presentation | In-memory promise cache; errors become `null` | Reject: playback presentation |
| A17 | `components/remotecontrol` Play command lookup | Profile L for commanded item | Full DTO is passed to playback manager | Remote-command lifecycle | Reject: playback |
| A18 | `components/remotecontrol` Playstate command lookup | Separate profile-L call for commanded item | Full DTO drives playstate action | Remote-command lifecycle | Reject: playback/progress |
| A19 | `plugins/chromecastPlayer:getItemsForPlayback` | Profile L for one requested ID | Raw DTO becomes Cast playback item | Cast queue/error behavior | Reject: playback |
| A20 | `chromecastPlayer` single-option hydration | Separate profile-L call for first ID | Raw DTO drives Cast command | Cast-owned | Reject: playback |
| A21 | `chromecastPlayer` fetched-item update at line 1014 | Separate profile-L refresh | Raw DTO updates Cast state | Cast-owned | Reject: playback |
| A22 | `chromecastPlayer` fetched-item update at line 1027 | Separate profile-L refresh | Raw DTO updates Cast state | Cast-owned | Reject: playback |
| A23 | `plugins/syncPlay/core/Helper:getItemsForPlayback` | Profile L for one item ID | Raw DTO builds synchronized playback queue | SyncPlay-owned | Reject: playback/queue |
| A24 | `ptv/modules/hero/useHeroItems:hydrateHeroItems` | Bound legacy `getItem(userId, item.Id)` per resumable/featured candidate; Episode is allowed for continue items | Merges full raw item into candidate for hero presentation | Parallel `Promise.all`; each error falls back to partial item | Reject: featured/continue generation and Watch Now playback |
| A25 | `imageeditor:reload` | Profile L for current editable item | Refreshes editor after image changes | Editor-owned | Reject: mutation |
| A26 | `imageeditor:showEditor` | Separate profile-L initial load | Raw image metadata drives editor | Editor-owned | Reject: mutation |
| A27 | `subtitleeditor` refresh call at line 311 | Profile L after subtitle operation | Reloaded streams/subtitles update editor | Editor-owned | Reject: subtitle/media mutation |
| A28 | `subtitleeditor:showEditorInternal` | Separate profile-L initial load | Full stream DTO drives editor | Editor-owned | Reject: media-source/subtitle mutation |
| A29 | `metadataEditor:getItem` | Profile L with editor item ID | Raw DTO plus metadata-editor document drives edit form | Editor-owned | Reject: metadata mutation |
| A30 | `itemidentifier:tryRefresh` | Profile L after identify operation | Refreshes raw item and provider state | Identify workflow | Reject: metadata mutation |
| A31 | `itemidentifier:persistAppliedResultFields` | Separate profile-L reload after update | Raw item is mutated and persisted | Identify workflow | Reject: metadata mutation |
| A32 | `itemidentifier` saved-item fallback at line 1703 | Separate profile-L refresh; error falls back to saved item | Raw item feeds update/diagnostic view | Explicit fallback to prior DTO | Reject: metadata mutation |
| A33 | `itemidentifier:showEditor` | Separate profile-L initial load | Raw item drives identify editor | Editor-owned | Reject: metadata mutation |
| A34 | `multiSelect:showMenuForSelectedItems` | Profile L for first selected ID | Type and DTO configure batch commands | Batch context actions | Reject: mutation/playback |
| A35 | `ptv/modules/integrations/arrActions:loadItem` | Profile L with supplied server/item; error becomes `null` | Type/IDs build external Sonarr/Radarr/Bazarr actions | No retry/timeout/coordination | Reject: external mutation/integration ownership |
| A36 | `scripts/serverNotifications:playTrailers` | Profile L for server-command item ID | Raw DTO passed directly to trailer playback | Server-command promise | Reject: playback |

Audited direct calls that cannot be Episode lookups by their caller contract are
the Movie/Music/Shows top-parent and shuffle handlers, list-controller
genre/studio/person/parent hydration, both lyrics-editor reads, both recording/
program reads, the TV-channel-only video OSD refresh, album-normalization
playback lookup, and legacy `useHeroItem` Movie/Series hydration. These account
for the remaining 15 direct expressions. The two current `getPtvItem` feature
consumers are Reading and Music item loaders, not Episode details. No direct
call above is transported indirectly through `getPtvItem`; the overlap is
policy/model duplication, not an existing call chain. No other production code
constructs a direct
`Users/{user}/Items/{id}` request; that endpoint exists only as profile C's
fallback. Recommendation providers use list queries rather than a single
Episode lookup.

Unless a row names focused coverage, no call-site-specific unit test or
authenticated per-call assertion was found. Phase 2D directly covers A1's
Episode route/content/refresh behavior and the normal rendered-item handoff
that bypasses A3; it does not certify the playback, editor, remote-player, or
forced-fallback calls.

### Episode list and adjacent metadata inventory

| ID | Call | Exact contract | Decision |
| --- | --- | --- | --- |
| L1 | `itemDetails:renderChildren` Season branch | Existing Phase 2C facade calls `getEpisodes(seriesId, { seasonId, userId, Fields })`; raw ordered result and original errors retained | Already adopted; not a new candidate |
| L2 | `itemDetails:renderMoreFromSeason` | Profile E with `SeasonId`, `UserId`, and `Fields: ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount,MediaSources`; renders sibling cards | Reject: More From Season and media sources |
| L3 | `itemContextMenu` download-all | One profile-E call per Season with lowercase `seasonId`, lowercase `userId`, and `Fields: CanDownload,Path` | Reject: download mutation/state |
| L4 | `playbackmanager` Series/Season expansion | Profile E with queue/order/start-season options | Reject: queue, autoplay, resume |
| L5 | `syncPlay Helper` Series expansion | Profile E used to build synchronized queue | Reject: playback |

### Closest candidate: exact present contract

The closest candidate is A3, the PTV details enhancement fallback, but it is
not selected for implementation.

- **Signature/callers:** private
  `enhanceDetailItem(page, renderedItem?)`; called from `detailsrendered`, DOM
  enhancement, and a scope-owned 900 ms inspection timeout on init/refresh.
- **Normal path:** when `renderedItem.Id` equals the route ID, no lookup occurs.
  The exact raw object emitted by the stock controller is passed to
  `applyDetailItem`.
- **Fallback transport:** resolve `serverId`/`server` and `id`/`itemId` from
  the current hash, select that Jellyfin client or `window.ApiClient`, resolve
  `getCurrentUserId()`, then call `apiClient.getItem(userId, id)` with no
  fields/options. Server selection, authentication, 401/login behavior, URL,
  query casing, and network policy are Jellyfin-owned.
- **Raw compatibility:** the object is not cloned or recased. Unknown fields,
  PascalCase, object identity, image tags, and any MediaSources/UserData remain
  intact. The consumer reads PascalCase `Id`, `Type`, `MediaType`,
  `CollectionType`, parent IDs, server ID, and artwork tags. It does not read
  Episode title/index/overview/runtime/progress or media sources.
- **Validation:** current code performs no response-ID equality, Episode-type,
  parent-scope, null, or malformed-response validation. A response is applied
  only while the page, dataset route ID, and current hash still match the
  requested ID.
- **Timing/concurrency:** the dataset pending/hydrated markers suppress repeat
  work for the current page/ID. There is no shared promise, request
  coordinator, AbortSignal, explicit timeout, or retry. A route-current check
  suppresses stale application but does not cancel transport.
- **Errors/fallback:** every transport rejection, including 401, 403, 404,
  timeout, cancellation, network, and 5xx, clears the pending marker if still
  current and logs one warning. It does not route login or render an error.
  Parent artwork failures independently become `null`; direct artwork remains.
- **Effects:** the Episode path sets the shell section and optional artwork
  only. The same generic function can render Reader actions for Book items,
  including a playback-manager call, which makes the call site itself
  non-Episode-exclusive.
- **Evidence:** source proves the contract; lifecycle tests prove rendered-item
  handoff, direct-artwork-first behavior, and the 900 ms fallback arrangement.
  Phase 2D proves normal Episode details navigation, ownership, visible core
  content, Back/Forward, and refresh, but does not force or isolate A3.

### Duplication and value analysis

1. **Reuse `getPtvItem`?** Technically yes, but doing so would add profile C's
   coordinator and malformed-response behavior to a caller that currently has
   neither.
2. **Duplicate item-details normalization?** Yes. Generic ID/type/runtime/error
   normalization already exists in `itemDetailsBoundary`.
3. **Genuinely new Episode semantics?** No. A3 consumes only type and artwork
   relationships. Phase 2C already projects Episode ID, Series/Season scope,
   title, indexes, overview, date, runtime, Primary artwork, and progress.
4. **New error-policy coverage?** No. The generic boundary already maps
   cancellation, timeout, network, 401, 403, 404, and 5xx while preserving
   platform errors externally.
5. **New diagnostic value?** Minimal. It could label a rare fallback, but the
   existing details lifecycle and item boundary already expose safe readiness
   and API diagnostics.
6. **Reduce direct API ownership?** At most one normally-unused fallback call.
   It would not remove the stock controller lookup or the distinct parent
   artwork calls.
7. **Improve cross-platform parity?** No current Android or Web portable
   consumer uses this fallback projection.
8. **Reduce production risk?** No demonstrated failure is repaired. Stricter
   ID/type validation introduces a new failure mode.
9. **Keep legacy?** Yes. The rendered-item handoff is simpler and avoids the
   request entirely; retaining the guarded fallback is equally safe.

### Hypothetical projection and validation policy

If a future portable consumer creates real demand, the smallest projection
would contain only:

- `episodeId` — required; read from `Id`/`id`, trimmed but never recased, and
  used for requested-ID equality. Missing, blank, non-string, or mismatched
  values fail normalization. The raw DTO is still retained.
- `seriesId` — optional; read from `SeriesId`/`seriesId`. It supports supplied
  parent-scope validation and parent artwork. Null, blank, or malformed values
  are omitted unless they conflict with an explicitly requested scope.
- `seasonId` — optional; read from `SeasonId`/`seasonId` with the same policy
  as Series ID.
- `artwork` — optional; derived only from present `ImageTags`/`imageTags`
  entries and image aspect data into a focused reference. Malformed optional
  tags/aspect values are omitted. It is justified only if a real portable
  consumer replaces the current raw image-candidate helper.

The hypothetical pure signature would be
`normalizePtvEpisodeDetailsResponse<TEpisode>(response, { episodeId,
seriesId?, seasonId? }) -> PtvCoreResult<PtvCoreEpisodeDetails<TEpisode>>`.
No public facade is proposed while the audit is HOLD.

Title, series title, indexes, runtime, premiere date, overview, played state,
position, percentage, media sources, streams, URLs, paths, and transcoding
state are excluded: A3 does not consume them, and Phase 2C already owns the
useful list projection.

All proposed fields would accept PascalCase/camelCase aliases while the raw DTO
remains untouched. A future single-item normalizer should fail the whole Core
result—not drop the item—on missing/blank/wrong requested ID, non-Episode type,
or a conflicting supplied Series/Season scope. Missing parent scope and null
optional fields are compatible; unknown/additive fields are preserved in the
raw item. Unknown type is a wrong type. No enum coercion is needed. If runtime
is ever justified, only finite ticks convert to milliseconds; malformed
optional ticks are omitted. Malformed top-level responses are parsing
failures.

Internally, cancellation maps to cancelled; timeout/network to network;
401/403 to authentication/authorization; 404/5xx to the existing HTTP error
taxonomy; malformed/wrong ID/type/scope to parsing. A later public seam must
still return the original raw object by identity, rethrow the original platform
error by identity, preserve Jellyfin login/error behavior, perform exactly one
transport call, and add no retry or timeout. A3 has no coordinator today, so
using `getPtvItem` without an explicit compatibility decision would violate
that condition.

### Rollback, tests, and future acceptance

A later experiment would have to be isolated to one A3 call-site seam plus one
new pure boundary/test pair, with the direct legacy helper retained. It would
require no schema, persistence, plugin, route, auth, UI, Android, or data
migration and must be revertible as one bounded commit. Rollback becomes harder
if the stock controller, `detailsrendered` event, parent artwork requests,
details shell, image helpers, or shared `getPtvItem` coordinator are changed;
none should be touched.

Required tests before any later approval:

- Boundary: PascalCase/camelCase, raw identity, requested-ID equality, wrong
  ID/type, missing/conflicting parent scope, unknown fields, null optionals,
  finite/malformed ticks only if runtime is added, and malformed response.
- Transport: exact client/user/ID/options, exactly one call, no retry/timeout,
  unchanged cancellation and no new coordinator.
- Errors: cancellation, timeout, network, 401, 403, 404, 5xx, and original
  error identity.
- Diagnostics: safe operation category and success/failure with no raw ID,
  title, URL, body, or blocking diagnostic failure.
- Regression: existing generic item boundary, Series seasons, Season episodes,
  details controller/gate/lifecycle, media-source normalization, playback
  untouched, and the full Phase 2D matrix.

The existing Phase 2D harness could support a later read-only acceptance by
resetting counters immediately before an independently selected Episode route.
It would need to prove exactly one selected details request, unchanged route
and visible title/index/overview/artwork, refresh and Back/Forward, identical
error behavior, no duplicate `getItem`, no playback request, at most one safe
Core event, and no specialized-route regression. It must not force A3 by
changing product timing; a test-only forced fallback would not prove normal
production value.

### Cost/benefit score and alternatives

All scores use 5 as best/safest. Approval requires at least 38/50, no excluded
owner, and both cross-platform usefulness and duplication reduction of at
least 3.

| Factor | Score | Evidence |
| --- | ---: | --- |
| Compatibility safety | 3 | Raw/error identity can be retained, but validation/coordinator behavior would change |
| Implementation size | 5 | One narrow fallback seam is possible |
| Testability | 3 | Pure normalization is easy; the real fallback is timing-dependent |
| Browser verifiability | 2 | Normal details handoff bypasses A3 |
| Cross-platform usefulness | 1 | Web DOM/shell/artwork-specific |
| Diagnostic value | 2 | Existing item/readiness diagnostics overlap |
| Reduction of duplication | 1 | New semantics duplicate `getPtvItem` and Phase 2C |
| Rollback simplicity | 5 | One bounded seam could be reverted |
| Accidental playback-coupling safety | 3 | Episode branch is read-only, but the generic function also owns Reader actions |
| Architectural necessity | 1 | No current defect or consumer requires it |
| **Total** | **26/50** | Below approval threshold: HOLD |

Higher-value next work is production performance stabilization and release
evidence: long-tail authenticated Items latency, clean same-account regression
automation, physical TV remote/focus/playback coverage, and release/deployment
hygiene remain materially more valuable. Home route-return resilience should
remain regression-monitored after Phase 2D. Scoped lint debt reduction is safe
maintenance. Featured-cache v7 observability is useful only within its current
owner and removal gates; it does not justify a new Core migration.

**Exact next task:** stabilize and measure the production authenticated Items
pipeline with the existing same-account regression matrix and read-only
server/host evidence. Do not reopen Phase 2E until a distinct portable
single-Episode consumer or diagnostic requirement exists.

## Logout action ownership correction

The PTV shell user menu and PTV sidebar previously exposed Sign Out as
`#/logout`. Jellyfin Web registers no such route, so activation entered the
router's Page Not Found path without invoking logout.

- [x] Both PTV controls now model Sign Out as an action, close their open menu
  immediately, and invoke the existing `Dashboard.logout()` lifecycle through
  one PTV-side in-flight guard.
- [x] `Dashboard.logout()` remains authoritative and now returns its existing
  promise. It still delegates to `ServerConnections.logout()`, clears the
  Jellyfin query/view caches only after success, and lets `AppFeature.MultiServer`
  choose `selectserver` versus `login`.
- [x] Session/token clearing, `localusersignedout`, remote-logout fallback,
  NativeShell notification, cache/view ownership, server switching, and
  post-logout routing remain Jellyfin-owned. PTV Core gained no auth service,
  token store, logout route, or session event.
- [x] Concurrent mouse, Enter, remote-OK, and synthesized pointer activations
  share the same promise. The guard clears after success or failure so an
  unsuccessful request can be retried; PTV does not force a route on failure.
- [x] No compatibility `#/logout` route was added. The obsolete value was
  removed from PTV navigation and shell route allowances. The authentication
  classifier continues recognizing Jellyfin's real `login` and `selectserver`
  destinations and does not treat `logout` as a page.
- [x] Focused logout/auth/header/router/Core coverage passes 98/98 across 16
  files. The full Web Vitest suite passes 803/803 across 123 files.
- [x] TypeScript, scoped changed-file ESLint, the PTV style baseline,
  production Webpack, ten schemas, normalized Android parity, secret scan, and
  Web/mobile/TV `git diff --check` pass. Webpack retains only the two
  established size warnings. Android source was not changed, so Android
  builds/lint were not rerun.
- [x] Vitest now resolves the existing `components`, `constants`, `ptv`, and
  `utils` source aliases so the stock Dashboard and ConnectionManager modules
  are exercised directly rather than replaced by source-text assertions.
- [x] Visible helper-owned browser validation completed. Sign Out rendered as
  a `BUTTON` without an `href`, closed its menu immediately, issued exactly
  one Jellyfin session-logout request, retired the authenticated shell, and
  reached Jellyfin's Select Server flow without Page Not Found. Selecting the
  existing server and completing Jellyfin's stock login restored authenticated
  Home and the PTV shell.
- [x] The helper-owned browser/profile was removed and loopback CDP port 9223
  was closed after the separate Phase 2D attempt. No credentials, tokens,
  storage state, screenshots, or traces were retained.

This is an ownership-preserving bug fix, not additional Core adoption. Android
mobile and Android TV are unchanged.

## Phase 2D validation status

Phase 2D is complete as a validation-only phase. Its manual-authentication
gate and the independent five-scenario interaction matrix both pass. No API,
navigation, playback, authentication, focus, Android, UI, cache, plugin,
server, database, or production ownership boundary moved.

- The previous `test:e2e:authenticated:interactions` command only called
  `chromium.connectOverCDP`, defaulted to `http://127.0.0.1:9223`, selected an
  already-authenticated `http://localhost:8082` page, and required both
  `ApiClient.getCurrentUserId()` and `ApiClient.accessToken()`. It had no
  Playwright storage-state loader, credential environment variables, browser
  launcher, or safe ownership cleanup. It therefore expected an externally
  launched Chrome profile and an already-authenticated page.
- The old interaction script also mixed unrelated dashboard, favorite,
  watched-state, playback, music, reading, focus, and broad diagnostic checks;
  persisted titles, item IDs, endpoint paths, and route hashes; and called
  `browser.close()` on an externally supplied browser. Those behaviors are not
  used by the Phase 2D harness.
- The selected restoration method is a visible, helper-owned Chrome session
  bound to loopback `127.0.0.1:9223`, using a new profile under the OS
  temporary directory. `npm run test:e2e:authenticated:launch` never reuses a
  personal browser profile and passes no credentials in process arguments.
  `status` and `cleanup` commands are also available. A helper ownership marker
  lives only in the OS temporary directory and contains process/profile
  ownership metadata, not authentication data.
- `test:e2e:authenticated:interactions` now waits for manual authentication,
  accepts exactly one frontend page, validates frontend/backend origin,
  authentication, current Core runtime, `ptv-ready`, `appRouter`, route
  controller, service-worker origin, and runtime-overlay state, and fails
  closed before interacting when any check fails. It does not load credentials
  or storage state.
- The restored matrix is read-only. It counts sanitized `getItem`,
  `getSeasons`, `getEpisodes`, `appRouter`, hash-transition, and Core-event
  categories without persisting URLs, query values, IDs, bodies, headers,
  cookies, tokens, names, email, or filesystem paths. Error probes are limited
  to anonymous/read-only authorization, a missing synthetic item, and one
  browser-aborted synthetic item request. No favorite, played-state, playback,
  focus, or server-data mutation remains.
- Artifacts are limited to
  `test-results/phase2d-authenticated/core-phase2d-authenticated-browser.json`.
  Screenshots, traces, and storage-state capture are disabled. The directory is
  already gitignored.
- The corrected runner reports explicit bounded stages instead of one broad
  timeout. Instrumentation is installed once, restores any prior installation,
  resets per scenario, and restores `appRouter`, History methods, event
  listeners, debug observers, and its session marker during cleanup.

Corrective findings:

- The first deterministic Home failure was `eligible-card-found`
  (`home-card-not-found`). The old selector coupled eligibility to an optional
  descendant artwork attribute, and one staged rerun attempted a no-op Home
  entry instead of establishing a fresh route generation. The runner now
  enters Home through an established route action and selects an eligible
  native Movie/Series media anchor through one layout-neutral, non-identifying
  `data-ptv-item-type` marker. It separately proves pointer and keyboard
  activation, handler/default prevention, one `appRouter` call, History route
  transition, details ownership, usable core content, Back, populated Home
  restoration, shelf ordinal/tolerance, and refresh. Native `hashchange` is
  not required because the current router commits through History state.
- Search's opaque failure was a Playwright strict-locator exception: the
  accessible-name selector matched both shell and native Search controls. The
  runner now uses the existing `data-ptv-focus-key="search-input"` control,
  reports safe stage/error categories, waits independently for restored query
  and results, and uses stable result media types rather than titles. An Audio
  catalog item uses its in-memory artist/album search term when its item title
  is not returned by the current bounded Search behavior.
- Series and Season no longer inherit Home/Search state. Each establishes its
  own supported details route from the read-only in-memory catalog, clears
  only harness counters, and observes the production
  `#listChildrenCollapsible` renderer. Series rendered 4/4 seasons with one
  initial and one refresh `getSeasons`; Season rendered 29/29 episodes with
  one initial and one refresh `getEpisodes`. Ordering and existing field/scope
  semantics were retained.
- The all-zero GUID was not a missing item: Jellyfin treats it as `Guid.Empty`
  and returned the `UserRootFolder` fallback with HTTP 200. A nonempty
  unallocated GUID produces HTTP 404 and a rejected Jellyfin client promise;
  `getPtvItem` preserves that original platform rejection as Phase 2A
  specifies. The assertion now verifies
  `transport-404-client-rejection` without retaining the identifier or body.
- No application behavior defect was found. The only product-source change is
  the privacy-safe Home media-type marker used as a durable runtime diagnostic
  boundary; it changes neither layout nor navigation behavior. All other
  corrections are in the harness.

Latest authenticated run:

- The development frontend and configured Jellyfin public endpoint both
  returned HTTP 200. Google Chrome 149.0.7827.199 used the isolated temporary
  profile and exposed CDP only on `127.0.0.1:9223`. Exactly one matching
  frontend page was present.
- Preflight passed every gate: authenticated client, expected frontend and
  backend origins, current Core/PTV runtimes, appRouter, route controller,
  service-worker origin, Home availability, and absence of a runtime overlay.
  The read-only catalog had a usable Series/Season/Episode chain and all seven
  requested media categories.
- The complete ordered matrix passes 5/5 in one run: Home details/Back,
  Search details/navigation, Series season list, Season episode list, and
  error compatibility. Home and generic Search activations each produced one
  `appRouter`/route-category transition and at most one Core diagnostic event;
  current History routing produced zero native `hashchange` events. Specialized
  Book/Audio/Album/Artist routes produced no generic `appRouter` transition.
  The missing-item and browser-aborted network probes each issued one request,
  with no retry or forced session expiration.
- Cleanup completed automatically. The helper-owned Chrome process/profile
  was removed and port 9223 no longer listens. Personal Chrome state was not
  touched.
- Harness unit tests pass 9/9 and the explicit Phase 2A-2D focused selection
  passes 118/118 across 14 files. Retained logout/authentication coverage
  passes 57/57 across 10 files; full Vitest passes 808/808 across 123 files.
  TypeScript, Phase 2D scoped ESLint, the PTV style baseline, production
  Webpack (with the two established size warnings), ten schemas, normalized
  Android parity, the 118,241-path secret scan, and Web/mobile/TV
  `git diff --check` pass. The broader repository ESLint debt gate still
  reports pre-existing findings outside the Phase 2D scope. No Android source
  changed.

The recommended design-only audit after Phase 2D is now complete. Phase 2E
placed the focused episode-details lookup on HOLD because its closest safe seam
duplicates existing policy and has no distinct portable consumer.

## Newly wired in Phase 2C

- [x] Exactly one API boundary is adopted: the visible episode list loaded by
  `renderChildren` for a Season details view.
- [x] The old call was
  `apiClient.getEpisodes(item.SeriesId, { seasonId: item.Id, userId, Fields })`.
  The compatibility facade calls that same transport exactly once with the
  same options object and returns the same raw query-result object.
- [x] The exact `Fields` value remains
  `ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount,Overview,MediaSources`.
  No sort, page, limit, `EnableUserData`, recursive flag, or
  `IncludeItemTypes` is added. Jellyfin's current URL/authentication,
  30-second GET/failover, local-ID option mutation, and error propagation stay
  authoritative.
- [x] The internal portable view validates requested series/season scope,
  accepts PascalCase/camelCase aliases, retains opaque IDs/raw children/order,
  and projects episode title/indexes, runtime milliseconds, premiere date,
  overview, present Primary artwork, and present played/position/percentage
  data. Missing progress remains absent rather than becoming zero.
- [x] Empty lists succeed. Mixed payloads retain valid ordered children;
  missing/blank IDs, conflicting series scope, and conflicting season scope
  are dropped and counted separately. Missing child scope inherits the
  requested scope. Invalid envelopes, invalid requested scope, and conflicting
  envelope scope fail.
- [x] Cancellation, timeout, network, 401, 403, 404, 5xx, malformed response,
  and invalid-scope outcomes map to Core errors internally. The public facade
  returns raw success and rethrows original transport failures by identity.
- [x] Diagnostics contain only safe operation/category/request ID/method/
  duration/status/size/raw/valid/drop counts/success/error code. They exclude
  episode/series/season IDs, titles, paths, origins, URLs, queries, users,
  email, auth, bodies, and media-source data, and cannot block the request.
- [x] More From Season, episode details, context menus, playback, Next Up,
  autoplay, images, recommendations, navigation, UI, cache, Android, auth,
  route, and focus ownership remain unchanged.

## Newly wired in Phase 2B

- [x] Exactly one details-only metadata GET is adopted: the series-details
  season list in `renderChildren`. The compatibility facade calls the existing
  `apiClient.getSeasons(seriesId, options)` once and returns the same raw
  response object.
- [x] The existing user ID, `Fields` string, query casing, result ordering,
  paging/default limits, transport, authentication, timeout, and cancellation
  behavior are unchanged. The old call had no request coordinator or explicit
  abort signal; Phase 2B adds neither.
- [x] The internal portable view validates the parent series scope, accepts
  PascalCase/camelCase aliases, retains opaque IDs and raw children, preserves
  order, and projects season title/index/count/artwork. Empty lists succeed.
  Malformed or cross-scope children are dropped with counts; invalid envelopes
  or parent scope fail.
- [x] Cancellation, timeout, network, 401, 403, 404, 5xx, and parsing outcomes
  map to Core errors internally. The public facade rethrows the exact original
  transport error, preserving authentication and login-flow ownership.
- [x] Native Search generic details actions for Movie, Series, Season, Episode,
  and BoxSet now create a v1 details intent and reuse the Phase 2A web adapter.
  The same hash, parent/query context, push/back behavior, deep links, and
  `appRouter` executor remain authoritative.
- [x] Search keeps anchor behavior for modifier/middle-click and specialized
  music/reading routes. Unmodified primary activation prevents the duplicate
  anchor transition; an in-flight key suppresses immediate double activation.
  Invalid IDs never call the router.
- [x] API/navigation diagnostics are bounded and nonblocking. Metadata events
  contain operation/category/request ID/method/duration/status/size/counts/
  result/error only; Search navigation uses the existing ID-presence event.
  Neither contains raw IDs, hosts, queries, auth data, bodies, paths, users, or
  email addresses.

## Newly wired in Phase 2A

- [x] The read-only `getPtvItem` details lookup now executes through a focused
  Core API response/error boundary behind its unchanged public signature.
- [x] The authoritative transport remains the existing Jellyfin
  `ApiClient.getItem`; authentication headers, current user resolution, URL
  fallback generation, and login handling did not move.
- [x] Concurrent identical item lookups share the existing request coordinator
  and one transport call. The Core result is available internally through
  `getPtvItemCoreResult`; the public facade returns the original item and
  rethrows the original platform error.
- [x] The item normalizer accepts PascalCase and supported camelCase aliases,
  validates the required opaque ID, ignores additive fields, retains the raw
  item for feature-only data, and converts runtime ticks only in the focused
  Core view.
- [x] One native Home movie/show shelf-card action now creates a
  `PtvNavigationIntent(destination=details)` and passes it to a web adapter.
  The adapter emits the exact existing details hash and calls `appRouter` once.
- [x] Existing hashes, query values, optional library context, push/back
  behavior, deep links, route tables, TV focus, and all non-details item routes
  remain unchanged.
- [x] API/navigation diagnostics are bounded and nonblocking. They contain safe
  operation/route names, request ID, timing, status/size, booleans for ID
  presence, result, and Core error code; no raw ID, host/query, header, token,
  response body, or filesystem path is emitted.

## Newly wired in Phase 1.5

- [x] Web startup calls the shared ordered initializer from `core/app.js`;
  Android mobile calls it from `JellyfinApplication` and repeated
  `MainActivity` creation; Android TV calls it from `PtvApplication` and every
  Activity creation callback.
- [x] All clients run `environment`, `device-identity`, `session`, `settings`,
  `cache`, `api`, `diagnostics`, `navigation`, `playback`, and `ready` in
  order.
- [x] Settings snapshots, feature-flag documents, cache-envelope adapters,
  diagnostic events, and capability reports wrap existing platform services.
- [x] Concurrent/completed initialization is shared; listener registries
  suppress duplicate window/preference listeners and support disposal/reset.
- [x] Cache and diagnostics failures degrade startup. Authentication failures
  retain the existing login action; critical API failures do not reach ready.
- [x] The Reading/Music library-index IndexedDB boundary writes v1 envelopes
  while retaining its database, object store, legacy keys, and legacy reader.
- [x] One plugin recommendation response boundary uses the v1 camelCase/
  PascalCase Row Builder compatibility normalizer.
- [x] CI generates normalized manifests from both Kotlin files and compares
  version, models, fields, types, nullability, serialized names, enums, error
  codes, and capabilities with each other and the canonical v1 manifest.

## Already migrated in Phase 1

- [x] Repository audit across web/webOS/plugin, Android TV, and Android mobile.
- [x] Contract behavior specification and architecture overview.
- [x] Versioned JSON Schemas for errors, diagnostics, flags,
  recommendations, cache, capabilities, playback, and navigation.
- [x] TypeScript v1 result/error taxonomy and HTTP/exception mapping.
- [x] TypeScript casing helpers, URL normalization, safe retry decision, and
  diagnostics redaction.
- [x] TypeScript focused media, auth, settings, cache, recommendation,
  navigation, playback, capability, and initialization contracts.
- [x] Compatibility exports through a small web core index.
- [x] Additive plugin status metadata for core/cache/recommendation versions,
  diagnostics, server capabilities, supported flags, and compatibility
  warnings.
- [x] Identical dependency-free `com.piggietv.core` contracts in Android TV
  and Android mobile.
- [x] Focused contract tests in web, Android TV, Android mobile, and plugin.

## Partially adopted

- [x] Web API facades: `getPtvItem`, one series-details `getSeasons`, and one
  season-details `getEpisodes` boundary use Core result/error and focused
  normalization internally. All other Jellyfin API calls remain on their
  existing paths.
- [x] Web feature flags/settings: the runtime snapshots and listens to the
  current storage/fallback/DOM/global implementation, which remains
  authoritative.
- [ ] Featured-content cache: v7 stays authoritative; the v1 envelope and
  outcomes exist for new adapters.
- [x] Recommendations: one response boundary uses the core parser; the engine,
  persisted models, Row Builder, and Home models remain legacy-owned.
- [x] Navigation: native Home details cards and eligible generic native Search
  cards produce v1 intents executed by the current web router. Specialized
  Search routes, all other web actions, and every Android destination remain
  legacy-owned.
- [ ] Playback: v1 state/commands exist; existing browser/Media3 queue and
  player state remain authoritative.
- [x] Diagnostics: startup creates v1 events; current web remote
  diagnostics, Android TV export, and Android logging retain transport/control.
- [x] Capabilities: startup publishes reports; existing device/user-agent/API-level
  detection remains as adapter fallback.
- [x] Initialization: all three startup roots use the runner with
  repeat/concurrency/listener/lifecycle/disposal regression tests.
- [x] Library-index cache: envelope writes/current reads/legacy fallback,
  scope validation, corruption/version/expiry/stale outcomes, and migration
  diagnostics are active.
- [ ] Navigation and playback steps acknowledge existing owners only; route,
  focus, and player execution have not migrated.

## Not migrated

- [ ] Jellyfin credential/session persistence.
- [ ] Existing login, logout, Quick Connect, server switch, and user switch UI.
- [ ] Existing API engines or generated Jellyfin SDK models; Phases 2A-2C wrap
  three narrow read boundaries without replacing either.
- [ ] Browser, Media3, webOS, Android Auto, notification, or lock-screen player
  implementations.
- [ ] Existing route stacks, Activities, Fragments, Compose navigation, TV
  focus, and remote input.
- [ ] Featured-content cache v7 and cache boundaries other than library index.
- [ ] Full media model call sites.
- [ ] All free-form observability events.
- [ ] Feature-specific settings documents.

## Blocked

- [ ] One physical shared Kotlin `:ptv-core` module is blocked by separate
  repositories, incompatible build/toolchain conventions, and independent
  releases. Extraction needs an owned Maven/composite-build strategy and
  coordinated version policy.
- [ ] Migrating Android auth, playback, Android Auto, background services, TV
  focus, notifications, or lock-screen execution is blocked on device/emulator
  regression coverage for those owners.
- [ ] Removing PascalCase compatibility is blocked indefinitely for v1 because
  current plugin/Jellyfin responses and clients rely on it.
- [ ] Removing featured-cache v7 or other legacy readers is blocked until
  deployed-client usage and fallback telemetry are available.

## Deferred until after v1.0

- [ ] Publish/extract a single Kotlin artifact after both apps align on
  toolchain, ownership, release cadence, and binary compatibility policy.
- [ ] Generate platform models from schemas.
- [ ] Replace all direct playback-manager/Media3 call sites with adapters.
- [ ] Consolidate every feature cache into one storage engine.
- [ ] Remove legacy global namespaces and compatibility exports.
- [ ] Remove user-agent/device-detection fallbacks.
- [ ] Adopt a new telemetry backend or remote service.
- [ ] Broad UI/navigation redesign.

## Phase 1.5 validation

- [x] Web focused runtime/cache/recommendation tests: 15/15.
- [x] Web full Vitest: 695/695 across 107 files.
- [x] TypeScript, scoped ESLint, production Webpack, and ten JSON Schemas.
- [x] Android mobile focused core: 12 tests; all unit variants;
  `assembleProprietaryDebug`; `lintProprietaryDebug`.
- [x] Android TV focused core: 12 tests; all unit variants; `assembleDebug`;
  `lintDebug`.
- [x] Normalized cross-repository parity, exact-byte supplementary check,
  secret scan, and `git diff --check` in all repositories.

## Phase 2A validation

- [x] Focused API/navigation/item-route/feature tests: 41/41 across six files.
- [x] Full Vitest: 716/716 across 110 files; startup, recommendation, and
  library-index regressions remained green.
- [x] TypeScript and scoped ESLint passed.
- [x] Production Webpack passed with the two established aggregate
  asset/entrypoint size warnings.
- [x] Ten canonical schemas and normalized Android parity passed: 26 models,
  14 enums, 19 capabilities, and one error-code declaration.
- [x] Android sources were not modified, so Android build/lint reruns were not
  required by the Phase 2A validation contract.
- [x] Phase 2D subsequently closed the current-Chrome authenticated web checks
  for the adopted Home/item-details boundary. No TV-device result is inferred
  from that browser evidence.

## Phase 2B validation

- [x] Focused metadata/Search/Phase 2A regression selection: 58/58 across eight
  files.
- [x] Full Vitest: 756/756 across 114 files; initialization, cache,
  recommendation, Home navigation, item details, and item routes stayed green.
- [x] TypeScript and the Phase 2B standalone-file ESLint scope passed.
- [x] Production Webpack passed with the two established aggregate
  asset/entrypoint size warnings.
- [x] Ten canonical schemas and normalized Android parity passed: 26 models,
  14 enums, 19 capabilities, and one error-code declaration.
- [x] Secret scan passed for 118,227 repository paths. `git diff --check`
  passed in web, Android mobile, and Android TV; line-ending notices are
  informational.
- [x] Android sources were not modified by Phase 2B, so Android build/lint
  reruns were not required.
- [x] Phase 2D subsequently closed authenticated browser validation through a
  helper-owned loopback CDP session and a manual Jellyfin-owned login. The
  final independent matrix passes 5/5 without stored credentials/auth state.

## Phase 2C validation

- [x] Focused episode/details/Home/Search/Core regression selection: 124/124
  across 15 files.
- [x] Full Vitest: 781/781 across 116 files.
- [x] TypeScript and Phase 2C scoped ESLint passed.
- [x] Production Webpack passed with the two established aggregate
  asset/entrypoint size warnings.
- [x] Ten canonical schemas and normalized Android parity passed: 26 models,
  14 enums, 19 capabilities, and one error-code declaration.
- [x] Secret scan passed for 118,231 repository paths. `git diff --check`
  passed in web, Android mobile, and Android TV; line-ending notices are
  informational.
- [x] Android sources were not modified by Phase 2C, so Android build/lint
  reruns were not required.
- [x] Phase 2D subsequently closed authenticated browser validation through a
  helper-owned loopback CDP session and a manual Jellyfin-owned login. Home,
  Search, Series, Season, and error compatibility pass 5/5 in one run.
- [x] Flake protocol: the first focused run had one deterministic source-test
  regex error in `detailsEnhancementLifecycle.test.ts`; all 24 new
  boundary/facade tests passed. The regex was corrected, the 124-test focused
  rerun and full suite passed, and no timeout was changed.

## Safe subsystem order

1. [x] New feature code uses the v1 core index/contracts.
2. [x] Web API error/casing telemetry adopts core helpers behind existing exports.
3. [x] Feature flags/settings gain adapters with unknown-field preservation.
4. [x] One low-risk cache gains envelope writes while retaining fallback reads.
5. [x] One recommendation response moves behind the compatibility adapter.
6. [x] One logical details intent is active at a feature-to-router boundary.
7. Playback presentation consumes normalized state before commands are routed.
8. App initialization wires noncritical diagnostics/cache steps first.
9. Authentication/session and player adapters are migrated only with full
   platform regression coverage.

## Exact next recommendation

Phase 2E is HOLD. Stabilize and measure the production authenticated Items
pipeline with the existing same-account regression matrix and read-only
server/host evidence. Then close physical-TV and release/deployment evidence.
Do not reopen the episode-details candidate until a distinct portable consumer
or diagnostic requirement exists.

## Phase 2C manual browser regression checklist

- Open a generic Home movie/show card; confirm one details transition, Back
  restores Home and its shelf position, and refresh preserves the deep link.
- Search for a Movie, Series, and Episode; open each by pointer and keyboard,
  confirm one `appRouter` transition and one Core navigation event, then use
  Back to restore the same query/results.
- Ctrl/Cmd-click and middle-click a generic Search card; confirm native
  new-tab behavior and no programmatic same-tab route.
- Open Book, Audio, Album, and Artist Search cards; confirm their specialized
  Reading/Music routes remain unchanged.
- Open a Series details page; confirm the season request retains the same
  fields, ordering, artwork behavior, empty-state behavior, and one network
  call. Exercise a malformed child if available and confirm valid seasons
  remain.
- Open one Season from that list; confirm its episode list renders the same
  order, indexes, overview, artwork, played/progress state, and empty state.
  Confirm one seasons GET and one episodes GET, with no duplicate Core event.
- Use Back/Forward between Search, Series, Season, and episode details; confirm
  Search query/result restoration and details refresh compatibility.
- Exercise season/episode metadata 401/403 and generic details lookup errors;
  confirm existing login/visible error behavior is unchanged.

## Removal gate for a legacy path

A legacy path can be removed only when:

- all imports/callers have migrated;
- persisted fallback readers have completed their supported window;
- old and new behavior have focused parity tests;
- plugin/client version skew is supported;
- production diagnostics show no active dependency;
- rollback does not require changing credentials or user data.
