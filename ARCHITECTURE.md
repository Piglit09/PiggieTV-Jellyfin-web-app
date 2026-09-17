# PiggieTV Architecture

## Current Architecture Status

### Native multi-library Shows query boundary (2026-08-31)

The native Shows catalog must not use an unscoped recursive `Users/{user}/Items` Series request on this deployment. `ShowsLibraryScreen` resolves `Users/{user}/Views`, selects all typed `tvshows` roots (falling back to typed mixed roots only when no TV root exists), caches that scope per authenticated media-cache identity, and fans out parent-scoped pages with a maximum concurrency of three. Results are merged by stable item ID and ordered by the requested scalar DateCreated or SortName key. Each parent retains an independent 24-item cursor and completion check, while the screen advances its shared page offset by 24.

Native catalog list requests must remain lean. The Shows grid requests only `DateCreated` or `SortName`, sets `EnableTotalRecordCount=false`, and obtains user data through its dedicated query flag. It must not restore `Overview`, `Genres`, `ChildCount`, or `RecursiveItemCount` to this list boundary; those expansions caused no useful grid behavior and correlated with the slow global catalog path. Do not increase the 12-second request timeout to disguise server or proxy latency.

Server origin is part of the native credential binding, not mutable display metadata. Changing a persisted session URL without rewriting its protected AES-GCM binding correctly invalidates and clears the session. Production origin changes must therefore use normal sign-in against the new origin; tokens must not be copied between origins. The accepted LG session now targets `http://10.16.0.50:8096`, where three parent pages completed in 2.4 to 9.9 seconds. `https://piggietv.com` remains a separate unaccepted native path because the same workload timed out and its unbounded diagnostic probe returned 504 after 102.1 seconds.

This boundary is native-client architecture only. It does not change Jellyfin Web routing, service-worker behavior, plugin APIs, or the separate authenticated Items-latency release gate.

### Native webOS deployment and startup-error ownership (2026-08-31)

The LG application is a separately packaged React/Vite client from `C:\Users\Piggie\Documents\GitHub\PiggieTV-WebOS`; it is not a wrapper around the currently deployed Jellyfin Web `/web` document. Native package builds, versions, chunks, installation, and cache adoption must therefore be diagnosed independently from the Jellyfin Web frontend and service worker.

Native startup connectivity state and authentication state have distinct owners. Startup restore may publish `state.startupError` when initial server recovery fails. After `validateServer` succeeds, `AuthScreen` clears that startup-only error and marks startup complete. Session-controller and credential errors remain untouched and continue to own authentication failure presentation. A successful reachability check must not clear credentials, manufacture a session, or hide a real authentication error.

The installed `0.1.18` package loaded `main-legacy-B92NAWM6.js` and restored authenticated Home on the physical LG. Slow Jellyfin responses remain an external runtime condition surfaced through bounded row timeout/retry states; do not mask them by increasing interaction timeouts or conflating them with native startup-error ownership. Native and Web release acceptance remain separate, and neither this physical recovery nor a successful server test closes the existing authenticated Items-latency blocker.

As of 2026-08-01, Web reliability and performance work through Phase F2D-B1
is approved. Phase H1 is repository-only hygiene and does not alter playback,
routing, request/cache ownership, connection ownership, or native application
scope. The next feature phase after H1 approval is F3: TV-first Collections
and cross-library discovery.

Dated HOLD and BLOCK decisions below are retained as point-in-time architecture
records. They do not override the current project status in `PROJECT_STATE.md`.

## WebOS playback presentation and resource policy (Phase 3A)

Playback engine authority is unchanged: Jellyfin owns video and PTV
`musicQueue` owns native Music audio. `playbackStateService` adapts those
engines, while `playbackPresentationService` derives the one visible surface:
mini-player, full-screen Music, stock video controls/video surface, or none.
Presentation state is not persisted.

The existing TV focus manager remains the only PTV directional/Back owner and
the existing `inputManager` remains the transport normalization owner. PTV
Music registers an adapter with that path; it does not install a second key
listener. The stock video bubble path yields capture-owned input.

The persistent runtime root is viewport-fixed and its media slot is
viewport-sized. WebOS uses literal Chrome 68-safe mini-player placement.
Loaded PTV audio outside full-screen/video therefore retains one reachable
mini-player through route changes.

WebOS platform policy excludes Reading and Request navigation/routes/chunks and
uses bounded Music rendering with deferred lyrics/backdrops. This is a client
resource policy, not a server, playback, route-stack, or content-contract
migration. Non-WebOS clients keep both features and their existing rendering.

Diagnostics remains passive and records category-only presentation changes.
See `docs/diagnostics/phase3a-playback-correction-report.md`.

Current as of 2026-07-23.

This document describes the architecture present in the current worktree. It records stable boundaries and ownership. Use `PROJECT_STATE.md` for delivery state, `HANDOFF.md` for continuation instructions, and `DEBUG_LOG.md` for issue history.

Project-memory maintenance is part of project completion: every completed project prompt updates `HANDOFF.md`, `PROJECT_STATE.md`, and `ARCHITECTURE.md` so operational guidance, current state, and architectural boundaries cannot silently diverge.

## Logout Action Boundary

Logout is owned by Jellyfin Web and is never represented as a PTV route. The
authoritative owner is `Dashboard.logout()`, which delegates remote/session
work to `ServerConnections.logout()`, receives the established
`localusersignedout` lifecycle, clears Jellyfin query/view state, and lets the
current multi-server capability select Login or Select Server.

PTV-visible controls may do only two things: retire their transient menu state
and request that stock action. A Web-local in-flight adapter shares one promise
across overlapping pointer, keyboard, and remote activation and clears on
settlement. It does not inspect or mutate credentials, emit auth events, choose
routes, or translate errors. The adapter is a UI safety boundary, not a PTV
Core auth service.

`#/logout` is intentionally unregistered and must not appear in PTV navigation
or auth-route classification. A compatibility logout page would create a
second ownership path and is prohibited. Jellyfin's stock toolbar/legacy drawer
remain direct callers of the same `Dashboard.logout()` function.

## PTV Core v1 Shared Boundary

PTV Core v1 is a contract-first, platform-native boundary. The canonical wire
definitions live in `contracts/ptv-core/v1`, the behavioral specification lives
in `docs/architecture/PTV_CORE_CONTRACTS.md`, and TypeScript, Kotlin, and C#
map to those definitions without introducing a shared runtime or generated
universal media model.

The portable TypeScript API is `src/ptv/core/index.ts`. It exposes focused
contracts/services for results and errors, API policy, authentication,
settings, feature flags, cache envelopes, media, recommendations, diagnostics,
navigation, playback, capabilities, and controlled initialization. Browser
profile mapping stays in the explicit `webCapabilityAdapter` module and is not
re-exported from the portable barrel, so a core import cannot trigger browser
profile or feature-setting side effects.

Android TV and Android mobile retain exact-byte-identical, dependency-free
`com.piggietv.core` source plus app-local capability adapters. A physical
shared Gradle module is intentionally deferred: the apps are separate
repositories with incompatible AGP/Kotlin/JVM conventions and independent
release lifecycles. UI, Activities, Fragments, Compose, Android Auto, TV focus,
Media3, notifications, permissions, and storage remain platform-owned.

The plugin status DTO adds camelCase v1 version/capability metadata while
retaining every active field, endpoint, and current casing behavior. Existing
web API, authentication, cache v7, Row Builder, routing, playback, diagnostics,
and device-detection implementations remain authoritative compatibility paths.
They may adopt core interfaces incrementally; none may be removed until the
migration and rollback gates in `PTV_CORE_MIGRATION.md` are satisfied.

Phases 2A and 2B add narrow active seams without moving those owners. The public
`getPtvItem` facade coordinates one in-flight Jellyfin `ApiClient.getItem`
transport, passes its response/error through the focused Core details boundary,
then returns the original item or rethrows the original platform error. One
native Home details-card action creates a v1 navigation intent; the web adapter
reconstructs the exact existing hash and delegates once to `appRouter`.

Phase 2B adds one separate metadata seam at Series details. A compatibility
facade calls the existing `ApiClient.getSeasons` transport once with the
unchanged series/user/Fields options and returns its raw query-result object.
The Core-only view validates parent scope and mixed children and projects
season identity/title/index/count/artwork without owning the renderer, request
transport, paging, cancellation, or error UI. Native Search Movie, Series,
Season, Episode, and BoxSet cards reuse the Phase 2A details adapter for
unmodified primary activation. Their anchors continue to own deep links,
modifier/middle-click behavior, and specialized Reading/Music destinations.
Immediate duplicate activation shares one in-flight route operation.

Phase 2C adds the adjacent Season-details episode-list seam only. The facade
delegates once to `ApiClient.getEpisodes(item.SeriesId, options)`, passing the
original lowercase `seasonId`, user ID, and Fields options by reference. It
returns the raw response or original transport error, so Jellyfin remains the
owner of authentication, URL/query construction, automatic networking/
failover, timeout, local-ID compatibility, and parsing. No coordinator, retry,
page, sort, `EnableUserData`, recursive option, or cancellation layer is added.

The Core episode projection is deliberately not a universal item or playback
model. It contains raw-item identity plus optional title, season/episode
indexes, runtime milliseconds, premiere date, overview, present Primary
artwork, and present played/position/percentage. Requested series and season
scope are authoritative when child DTOs omit scope. Conflicting scope or
missing IDs drop children with bounded counts; invalid envelopes and requested
or envelope scope fail. The raw response and ticks remain untouched.

Phase 2D adds no application-runtime ownership. Its authenticated validation
boundary is an external current-Chrome CDP harness. The repository helper binds
CDP only to loopback port 9223 and creates an OS-temporary profile; Jellyfin's
normal UI remains the sole authentication owner. The runner refuses wrong
origins, backend mismatch, unauthenticated or duplicate frontend pages, stale
PTV/Core runtime, missing appRouter/route controller, mismatched service
worker, and unavailable Home before any acceptance action.

The harness observes only sanitized operation/route categories and bounded
method/status/duration/count/pass-fail fields. It does not retain IDs, media
titles, URLs, query values, bodies, headers, cookies, tokens, account identity,
or auth state. It does not mutate favorite/played state, invoke playback,
change focus/UI, or close an externally owned browser. Helper-owned browser
state is identified by an OS-temporary marker and removed after the run.

Authenticated acceptance is staged against semantic ownership rather than one
page-wide timeout. Native Home exposes media type on its existing media anchor
through a layout-neutral, non-identifying diagnostic attribute. The harness
separately observes real pointer/keyboard activation, capture-phase default
prevention, `appRouter`, History route-category changes, route ownership,
usable details content, Back/Forward/refresh, populated Home authority, and
approximate shelf/card restoration. History transition is authoritative;
native `hashchange` may remain zero when the router commits through
`pushState`.

Browser instrumentation is idempotent and reversible. Installation restores a
previous harness installation before wrapping `appRouter` and History once;
scenario reset clears only harness-owned counters; cleanup restores every
function, event listener, debug observer, and session marker. Search, Series,
Season, and error scenarios establish independent route state and cannot
consume a prior scenario's observations. The Jellyfin all-zero GUID is a
root-folder sentinel, not a missing-item fixture; error compatibility uses a
nonempty unallocated GUID and asserts the external HTTP 404/client-rejection
contract without serializing the identifier or response.

Phase 2E establishes a durable admission rule without adding a runtime
boundary: a new focused Core read must have a distinct portable consumer or
policy that is not already supplied by `getPtvItem` or a list projection.
Removing one direct method call, achieving model symmetry, or labeling a rare
fallback is insufficient when the normal path already reuses the
authoritative raw DTO.

The audited PTV details enhancement fallback remains legacy-owned. Jellyfin's
details controller normally emits its already-loaded raw item; PTV uses that
object for shell classification and artwork. Its guarded route-item fallback
is Web-specific, normally bypassed, and has no distinct Episode metadata
consumer. Adopting the coordinated generic item facade would change its
request-sharing behavior, while a new Episode projection would duplicate
Phase 2C. The decision is HOLD until a portable consumer or diagnostic
requirement demonstrates otherwise.

Single-item validation also differs from list normalization. If a future
focused item boundary is approved, wrong/missing requested identity, wrong
required type, or conflicting supplied parent scope must fail the whole Core
result rather than drop an item. Missing optional parent scope and additive
unknown fields remain compatible; public compatibility must preserve the raw
object and original platform error, with no implicit retry, timeout,
coordinator, auth, route, or UI change.

Portable normalization never recases the complete Jellyfin payload, and bounded
diagnostics never contain raw IDs, hosts/query values, headers, bodies, or media
paths. More From Season, episode details, playback/Next Up/autoplay, Search
APIs/rendering, all other API calls, and all other navigation actions remain
legacy-owned.

The enforced dependency direction is UI to feature services to PTV Core to
platform adapters/external APIs. Core modules do not import UI, React,
Activities, Media3, controllers, or transport-specific DTO owners.

## Physical Production Acceptance Boundary

Physical acceptance must prove loaded provenance before interpreting layout or data behavior. The authoritative evidence is the child document origin, compile-time build ID/commit/date/mode from the LG-loaded asset, loaded runtime/main/Home asset identities, service-worker controller/scope/script state, API/plugin origins, render profile, TV platform, and root geometry classes. A server deployment claim or local `dist` match is insufficient by itself.

Home acceptance has two independent stability phases. A continuously mounted Home must retain hero/actions/shelves/cards through the fixed observation window, and a route generation that leaves and returns must restore an equally usable populated model. Passing the first phase cannot close Home P1 when the second phase returns hero-only or section-only content. Route-return evidence must use the same account, unchanged application timeouts, and exact shelf/scroller/card markers.

Lease-bound physical diagnostics are captured on the target Home route and preserved locally plus server-side before opening Dashboard or stopping collection. A later shutdown snapshot may replace the server's latest report, so the downloaded target-route artifact is the acceptance authority. Collection is revoked after preservation and must become inactive on the next heartbeat.

Correct shell geometry and Home data restoration remain separate ownership boundaries. `ptv-render-webos` plus `ptv-render-tv` own the former; route generation, cache/model authority, and Home loaders own the latter. A physical `first-shelf-missing` report with correct header/brand/focus geometry is not a reason to change CSS or add a page-local TV layout workaround.

## Home Cache Semantics and Atomic Model Authority

Featured cache v7 has one semantic usability contract across browser memory, browser persistence, plugin validation, and plugin refresh. A payload is classified as complete, partial, degraded, configuration-only, empty, or intentional-empty from hero, generated-row, section, and generation-state evidence. Only a populated complete payload or an explicitly confirmed intentional-empty library may replace persisted state. Freshness alone never makes an empty or configuration-only payload authoritative.

Plugin refresh builds only populated configured rows. A Row Builder definition with zero selected candidates is configuration, not Home content, and must not become a section shell merely because the rule is enabled. Semantic validation happens before trimming and again before persistence; validation failure retains the previous cache and does not affect request/playback behavior. This contract does not change cache schema v7.

Native Home owns a second, render-level atomicity boundary. A candidate model may commit only when its route generation and route hash still match and its completeness is not weaker than the populated model already displayed. Empty late aggregates, partial refreshes, and section-only shells are observable degraded outcomes, not replacement models. Explicit intentional-empty state may settle only when there is no populated model to preserve.

Home diagnostics emit bounded count-only lifecycle evidence for route entry, memory/plugin reads, cache adoption or rejection, first hero/shelf, live request start, recommendation receipt, final commit, and route retirement. Diagnostics may contain source/classification/count/timing/replacement reason fields, but never media identity, titles, raw responses, request URLs, credentials, or server/user/item IDs. External physical harness snapshots remain valid evidence when an embedded build does not expose the named events.

## LG Hosted Split-Origin Contract

The tracked hosted-development wrapper targets the frontend document literally at `http://<development-frontend>:8082/`. Development startup supplies `PTV_DEV_JELLYFIN_URL=http://<test-server>:8096`, so authenticated Jellyfin, Items, and `/Ptv/v1` traffic remain on the backend while scripts, styles, HMR, and the document remain on the development origin. Hostname-derived `:8096` wrapper redirects are prohibited because they can pin the TV to the wrong server before saved-server selection or `ApiClient` readiness.

The webOS hosted app remains a local `file://` container with one full-viewport child frame. Runtime provenance must report the wrapper container, child document origin, API/plugin origin, resource-origin counts, build/mode, and service-worker control separately. Cross-origin comparison may navigate only that child frame and must not mutate the remote Jellyfin web root, plugin, database, or server configuration.

## TV-tier Geometry and webOS Compatibility Contract

Render profiles have two simultaneous class identities. The exact profile class, such as `ptv-render-webos`, owns platform-specific cost and compatibility decisions. Every profile whose tier is `tv` also receives `ptv-render-tv`, which owns shared ten-foot geometry. Reconciliation must never make those classes mutually exclusive.

The shared shell is the sole header geometry owner. Its grid tracks and children use explicit min-size containment so intrinsic image dimensions cannot enlarge a row. Brand containers clip overflow and their images have explicit width, height, max dimensions, block layout, and `object-fit`. TV and webOS profiles may refine those values, but pages must not create competing header transforms or sizing rules.

LG webOS Chrome 68 compatibility cannot depend exclusively on `clamp()` or modern intrinsic sizing behavior. The webOS profile supplies literal 720p, 1080p, and 4K header heights, brand dimensions, side columns, and top/side offsets before any optional modern enhancement. Its focus treatment is static and bounded: border/outline/glow are allowed, while focus transforms remain disabled.

Stable `data-ptv-layout-node` markers identify shell main, Home root, hero, row container, shelf, and shelf scroller nodes. They are diagnostic selectors only and must not become route, data-loading, cache, or focus ownership boundaries. `physicalLayoutSnapshot.ts` may fall back to legacy selectors while deployed generations converge, and its report schema remains backward compatible.

Physical LG evidence confirms the contract: `ptv-render-webos` and `ptv-render-tv` coexist; the 1920x1080 shell is 1788x80 at `(66,36)`; the brand is 220x64; navigation is centered; utilities are bounded; overflow is zero; and one ArrowRight transition retained visible focus. A later authenticated persistence run rendered 25 semantic rows and held them for 100 seconds, superseding the earlier zero-row capture; complete user-operated remote navigation remains unverified.

## Embedded Physical Layout Diagnostics Contract

Physical LG/webOS layout evidence is part of the existing local Remote Diagnostics system, not a second telemetry or transport stack. Collection is administrator-initiated, capability-gated, lease-bound, bounded, memory-limited, privacy-sanitized, and delivered through the existing check-in, command, report, and Dashboard endpoints.

The collector owns a fixed semantic selector registry for the shell header, shell brand/image, primary navigation, utilities, shell main, Home root/hero/content/logo/actions, first shelf/scroller, media dock, and legacy header. It captures only geometry, visibility, bounded computed-style categories, intrinsic image dimensions, allowlisted root/body PTV state, build/runtime/profile evidence, and fixed issue codes. It never captures page text, HTML, media titles or IDs, URLs beyond a path-only service-worker value, arbitrary attributes, raw CSS rules, or screenshots.

Seven fixed milestones cover lease start, runtime readiness, shell readiness, hero readiness, shelf readiness, route settlement, and report generation. Only the latest sample for each milestone is retained. The physical snapshot shares the report's existing serialized-size budget and is trimmed before transport rather than creating an unbounded secondary payload.

`PTVShell` exposes stable `data-ptv-owner` markers for the shell brand and brand image. These markers identify component ownership without changing geometry or introducing page-local TV rules. Browser-side winning-cascade attribution is deliberately reported as unsupported because reliable source-rule ownership cannot be guaranteed from this webOS runtime; diagnostics must not guess a stylesheet or selector.

Plugin DTO responses may be serialized as PascalCase even though TypeScript contracts are camelCase. The frontend response boundary therefore normalizes either casing for client rows, capabilities, boot markers, command leases, and stored report wrappers. Malformed rows are still rejected, and absent optional command values remain absent.

The latest server report is replaceable by a subsequent route or shutdown snapshot. Acceptance workflow must capture and view/download the target-route report before navigation or Stop. This is provenance behavior, not permission to merge evidence from different routes.

The 2026-07-22 Home capture proves the shell brand image rendered at 1077x500 inside a 1920x500 header and obscured Home content, but it does not prove the exact winning CSS rule. The corrective architecture remains centralized in the shared shell/webOS profile; do not add a page-local transform or global scale workaround.

## Consolidation Program

PiggieTV has reached the point where the remaining work is architectural. The current feature modules remain supported, but they are transitional consumers of shared Jellyfin and PTV primitives, not the desired final platform boundary. Do not respond to cross-module regressions by adding another page-local cache, image loader, recommendation helper, diagnostic format, or direct plugin request.

The target dependency direction is:

```text
Route/page adapter
  -> shared platform service or framework
    -> normalized Jellyfin/PTV API client
      -> Jellyfin API and optional /Ptv/v1 plugin API
```

The migration must use adapters and contract tests. Existing Movie, Show, Music, Reading, Live TV, and dashboard behavior cannot be replaced wholesale or allowed to change ownership during a refactor. New shared services become the only place for cross-media policy; modules contribute typed media-specific fields, renderers, and route configuration.

The planned shared platforms are:

| Platform | Target responsibility | Transitional owners to retire |
| --- | --- | --- |
| `RecommendationEngine` | Provider lifecycle, profile inputs, scoring, diversity, overlap, rows, and normalized diagnostics | module-local Music/Reading and page-specific recommendation behavior |
| `MetadataService` | Provider selection, normalized metadata, provider IDs, field-selective apply, and failure state | media-specific lookup/apply paths |
| `ArtworkService` | Preferred/alternate/fallback selection, tag-aware success/failure cache, request ownership, and image diagnostics | page-local image handlers and URL failure sets |
| `PTVCache` | Scoped identity, memory/persistent tiers, stale-while-revalidate, TTL, migration, invalidation, and atomic replacement | module-local cache precedence rules |
| `BrowseFramework` | Hero, filters, search, sort, grid, shelf, pagination, loading/empty states, and diagnostics | independently assembled browse pages |
| `DetailsFramework` | Shared hero, backdrop, actions, chips, credits, related content, and plug-in media panels | route-specific details layout orchestration |
| `PlaybackService` | Queue, progress, resume, history, Media Session, up-next, and ownership handoff | feature-local playback orchestration |
| `PTVApiClient` | Authentication readiness, request ownership, deduplication, retry/backoff, cancellation, and endpoint metrics | direct component/plugin endpoint access |
| `PTVDiagnostics` | Normalized recommendation, browse, playback, cache, artwork, performance, remote, and plugin evidence | incompatible page-local debug payloads |
| `PerformanceManager` | Render/network/cache/image/focus/long-task attribution and adaptive client budgets | module-local performance timing decisions |
| `FocusManager` | TV focus scopes, graph lifecycle, restoration, activation, and modal ownership | duplicate navigation handlers |

Migration order is intentionally foundation-first: API client and diagnostics contracts; cache and artwork services; recommendation providers; browse/details adapters; then metadata/playback/focus consolidation. Each phase must remove or route through a duplicate boundary before the next phase begins. New code may not create a second implementation of any listed platform.

## System Boundary

PiggieTV is a native experience embedded in Jellyfin Web. It adds its own shell, routes, pages, caching, playback surfaces, diagnostics, and an optional Jellyfin server plugin while retaining Jellyfin authentication, libraries, item APIs, playback, and fallback pages.

```text
Browser / TV client
  -> Jellyfin Web 10.11.11
  -> PiggieTV frontend under src/ptv
       -> Jellyfin ApiClient and item APIs
       -> PiggieTV plugin API under /Ptv/v1
       -> leased local remote-diagnostics agent and plugin transport
       -> browser memory/local storage caches

Jellyfin server
  -> Jellyfin libraries, users, playback, and metadata providers
  -> Jellyfin.Plugin.PiggieTV (net9.0, plugin version <private-address>)
       -> featured cache v7
       -> settings and Row Builder persistence
       -> integrations and signup services
       -> Google Books proxy search
       -> durable Reading series overrides
       -> bounded in-memory remote-diagnostics coordination
```

The plugin extends Jellyfin; it does not replace Jellyfin's database or media pipeline. The frontend must continue to degrade to Jellyfin behavior when a native PTV route or plugin capability is unavailable.

## Frontend Runtime

`src/ptv/index.js` imports the PTV styles and `src/ptv/core/app.js`. Startup is gated by Jellyfin readiness and the `once('ptv-app', ...)` guard.

`src/ptv/core/runtime.ts` owns the singleton runtime. `core/app.js` is the authoritative bootstrap and registers these runtime features exactly once:

- router
- performance monitor
- route controller
- shell foundation
- persistent runtime root
- capability-gated remote-diagnostics agent and plugin transport

Feature and listener registration are keyed and duplicate attempts are suppressed and exposed through runtime diagnostics. Individual components should consume `getPtvRuntime()` or `awaitPtvRuntimeReady()` and must not run the full initializer.

`src/ptv/shell/PTVRuntimeRoot.tsx` provides the persistent React root. It keeps global runtime UI, including the media dock, alive across PTV route changes so navigation does not destroy playback state.

## Shared Shell And Routing

`src/ptv/shell/PTVShell.tsx` is the shared PTV application shell. It owns:

- PiggieTV brand link
- primary Movies, Shows, Music, Reading, and Request navigation
- contextual section navigation
- grouped search entry
- notification and user panels
- admin/settings utilities
- responsive and remote-focus behavior
- the persistent page backdrop surface

Contextual navigation is derived from the current hash route. Music exposes Home, Explore, Artists, Albums, Songs, and Playlists. Reading exposes Home, Explore, Books, Comics, Manga, and Collections. Movies, Shows, Anime, Cartoons, Requests, Dashboard, and Settings expose their own route-backed context links.

`src/ptv/shell/routes.js` declares route ownership. `src/ptv/shell/routeController.ts` resolves hash/location changes into native, enhanced, or fallback route descriptors. `src/ptv/core/config.ts` is the canonical route and plugin-endpoint registry. `src/ptv/core/itemRoutes.ts` centralizes item routing for music, Reading, video, and Jellyfin fallbacks.

Major native route families include:

- `#/home`
- `#/movies`, `#/shows`, and `#/collections`
- `#/music` and its child routes
- `#/reading`, `#/books`, `#/comics`, and `#/manga`
- `#/requests` and `#/calendar`
- `#/recommendations`
- `#/dashboard/piggietv/*`

The PTV shell hides Jellyfin's legacy header and drawer only while the native shell is mounted. Route transitions must remove and reapply ownership classes deterministically; global CSS should not hide Jellyfin chrome on fallback pages.

### TV Focus And Remote Navigation

`src/ptv/core/tvFocus.ts` is the sole PTV spatial-navigation and focus-lifecycle owner. It keeps a cached four-direction graph for the active route or topmost modal layer, remembers stable focus keys per route, restores layer openers and exact playback origins, and uses a temporary sentinel while async pages have no usable control. Pages publish stable `data-ptv-focus-key` values and call `notifyPtvTvFocusContentReady()` when dynamic rows become interactive; they do not implement competing global D-pad movement.

The manager normalizes desktop, Android/Fire TV, LG webOS, and Samsung Tizen key signatures. It traps dialogs/menus, delegates text and native control editing, and prevents Jellyfin's later window-level keyboard handler from applying duplicate navigation while a PTV scope is active. `#/tv-navigation-debug` exposes current focus, history, route/key evidence, candidate counts, the cached graph, and broken paths. The full ownership and release matrix is recorded in `src/ptv/docs/tv-navigation-audit.md`.

## Feature Ownership

| Area | Primary implementation | Ownership |
| --- | --- | --- |
| Home | `src/ptv/pages/home` | Hero, recommendations, configured rows, card hydration, row virtualization, diagnostics |
| Browse | `src/ptv/pages/browse`, route shell | Movies, Shows, Anime, Cartoons, Collections, contextual shelves |
| Music | `src/ptv/modules/music` | Home/browse routes, metadata, queue, player, playlists, likes, MusicBrainz/Discogs integration |
| Reading | `src/ptv/modules/books` | Books/Comics/Manga discovery, staged shelves, details, series grouping, cache, diagnostics |
| Cards | `src/ptv/modules/cards` | Shared poster behavior and quality-tag resolution |
| Recommendations | `src/ptv/modules/recommendations` | Candidate generation, accepted-row persistence, explanations, diagnostics |
| Featured cache | `src/ptv/modules/cache/featuredContentCache.ts` | Cache v7 validation, memory/server reads, stale-while-revalidate, invalidation |
| Playback | `src/ptv/modules/playback`, `src/ptv/services/playbackStateService.ts` | Shared playback state and startup orchestration |
| Dashboard | `src/ptv/modules/dashboard` | Status, settings, recommendations, Row Builder, integrations, debug surfaces |
| Remote diagnostics | `src/ptv/core/remoteDiagnosticsModel.ts`, `src/ptv/services/remoteDiagnostics.ts`, `src/ptv/services/pluginRemoteDiagnosticsTransport.ts`, `src/ptv/modules/dashboard/RemoteDiagnosticsPanel.tsx`, companion plugin | Temporary local client presence, leased collectors, sanitized reports, admin control/read surfaces, defensive dashboard normalization |
| Shell services | `src/ptv/services`, `src/ptv/shell` | Notifications, performance, route lifecycle, global media dock |

Remote diagnostics test fixtures avoid committing credential-shaped `authorization`/token literals in source by composing synthetic values at runtime with concatenated fragments. This preserves authorization sanitization coverage while keeping the repository secret scanner policy strict and unchanged.

## Home And Recommendation Data

Home composes Jellyfin resume/latest data, featured cache data, persisted recommendation rows, and explicitly configured Row Builder rows. Recommendation Settings is authoritative for generated recommendation rows: only persisted, accepted, enabled rows belong in Home. Configured Row Builder rows remain a separate source and carry source/config hashes in diagnostics.

The featured-content cache schema is version 7. The browser key is `ptv:featured-content:v7`; the default TTL is 12 hours and accepted server payloads must pass version and shape validation. The cache supports memory, browser, and plugin-backed stale-while-revalidate behavior. Cache hashes prevent stale recommendation/configured rows from being mixed with current settings.

Home and browse card data should be fetched in lightweight list form and hydrated in batches only when richer fields are required. Offscreen rows should not compete with the hero and first visible shelf.

## Reading Data Path

### Discovery And Staged Loading

`src/ptv/modules/books/booksApi.ts` discovers Jellyfin book libraries and resolves the active Books, Comics, Manga, or combined Reading route. Initial work is bounded: summary/cache data is rendered first, shelf work is independent, and library pages use 50-item pages instead of a first-render full-library scan.

Reading has a separate cache boundary:

- memory cache for active data
- local-storage home cache schema version 5
- fresh TTL of 5 minutes
- stale render window of 24 hours
- per-library, image-profile, and in-flight request caches
- per-shelf timeout and retry diagnostics

Shelf failure is isolated. A slow Continue Reading or library page must not erase a ready Recently Added shelf or make the entire route appear empty.

### Classification

`booksClassification.ts` is the dependency-light classification boundary. Precedence is:

1. explicit manual item override
2. explicit library-kind hint
3. reliable Manga/Comic metadata and path evidence
4. comic archive format
5. Book fallback

Provider identity is deliberately excluded from this precedence. A ComicVine result cannot reclassify an item that belongs to a Manga library.

### Filename And Series Identity

`readingFilename.ts` is shared by grouping, Identify defaults, provider lookup, ranking, and fallback labels. It extracts cleaned title, normalized key, series, volume/issue/chapter, year, format/edition signals, confidence, and removed release tokens. Publication year is descriptive metadata and never part of inferred series identity.

`booksSeries.ts` applies this series precedence:

1. server-persisted administrator override
2. stable provider series ID
3. explicit Jellyfin series metadata
4. high-confidence filename/folder inference
5. singleton item fallback

`booksSeriesOverrides.ts` treats the plugin as authoritative. Browser storage is an instant cache and one-time migration/fallback, not the durable source of truth.

### Identify And Metadata Apply

Jellyfin's Identify component remains the shared UI entry point. Reading-specific logic in `src/components/itemidentifier` normalizes Jellyfin remote results, ComicVine results, and native Google Books results into one ranked candidate model.

The plugin endpoint `GET /Ptv/v1/reading/metadata/googlebooks/search` performs Google Books requests server-side so API credentials and cross-origin behavior are not delegated to the browser. ComicVine continues to arrive through Jellyfin remote-search providers. External provider links are allowlisted.

Ranking uses local structured identity rather than provider display copy. Stable provider IDs, ISBN, canonical title/series, issue/volume, year, and creator evidence are scored deterministically. Description/deck text is kept separate from the canonical title.

Reading apply is field-selective. It can update Name, OriginalTitle, SeriesName, IndexNumber, ProductionYear, PremiereDate, People, Studios, Genres, Overview, ProviderIds, and Primary artwork. Empty provider values do not erase existing Jellyfin data. Existing artwork defaults to preservation. Metadata and artwork are saved and reported independently; Reading does not use the legacy broad `ReplaceAllMetadata` operation.

### Reading Diagnostics

`readingDiagnostics.ts` gates Reading diagnostics on both administrator access and explicit PTV debug mode. Output is collapsed, size-bounded, grouped by concern, and redacts credentials, authorization values, user/item identifiers, hosts, URLs, and local paths.

Dashboard copy/export has a separate final boundary in `debugExportSanitizer.ts`. Live administrator-only debug panels may keep their operational detail, but any serialized or copied global export is recursively bounded and removes credentials, authorization/query secrets, private origins, user/item identifiers, local paths, and sensitive signup/SMTP values. Data-image payloads and blob URLs are replaced as complete values, semantic versions/build identifiers remain useful, and credential-shape fields such as lengths or SMTP password state are omitted. Export sanitization is the last step before serialization so newly added dashboard sections cannot bypass it accidentally.

## Plugin API

The plugin controller is rooted at `/Ptv/v1`. Important endpoint groups are:

| Group | Endpoints |
| --- | --- |
| Runtime | `GET /status`, image diagnostics |
| Featured cache | `GET/PUT/DELETE /featured`, `POST /featured/refresh` |
| Settings | `GET/POST /settings`, `POST /settings/reset` |
| Row Builder | `GET/POST /rows`, `POST /rows/validate`, `POST /rows/preview` |
| Reading | `GET /reading/metadata/googlebooks/search`, `GET/PUT /reading/series-overrides/{routeKind}` |
| Music | `GET /music/metadata/search` |
| Remote diagnostics | `POST /diagnostics/clients/check-in`, `POST /diagnostics/clients/report`, `GET /diagnostics/clients`, `POST/DELETE /diagnostics/clients/{clientId}/sessions`, `POST /diagnostics/clients/{clientId}/snapshot`, `GET /diagnostics/clients/{clientId}/report`, `GET /diagnostics/clients/{clientId}/report/download` |
| Integrations | status, Seerr, Sonarr/Radarr/Lidarr/Prowlarr tests, calendar, downloads, tags, random items |
| Signup | create user, verification, password reset, admin settings/invites |

Mutating settings, featured content, and Reading series overrides require the plugin's write/admin authorization checks. Remote-diagnostics presence and report upload require authentication; client listing, session commands, snapshots, and report reads/downloads require administrator elevation. Secrets belong in plugin configuration and must never be returned in diagnostics or persisted in frontend caches.

The frontend and plugin are a coupled deployment for features that depend on new API contracts. A frontend-only deployment will fall back where possible, but durable Reading overrides, native Google Books search, and remote diagnostics require the matching plugin build and a Jellyfin restart. Capability checks, rather than plugin version alone, determine whether the remote-diagnostics transport and Dashboard panel are enabled.

## Rendering And Performance

Client behavior is selected through the client/render profile. Desktop can use full backdrop transitions and blur; Fire TV and low-power profiles reduce expensive blur, animation, image sizes, and offscreen work while keeping the same information architecture.

Horizontal shelves use bounded overflow, pointer/touch scrolling, visible controls where applicable, keyboard/remote focus, and small overscan. Fixed-format cards use stable dimensions to avoid layout shifts. Long diagnostics and Identify comparisons scroll within their own bounded regions.

Browse work is scheduled by `browseLoadingPolicy.ts`: Recently Added and Featured work starts before Continue, recommendations, broad browse, and collections. Sections settle independently and publish partial UI rather than making the route wait for every shelf. Card rows retain the existing lightweight item field profile; richer hero metadata is requested separately.

Image failures use a bounded, expiring negative cache. A failed candidate advances through the shared Primary, series/parent Primary, and Thumb sequence before a letter placeholder is shown. Failure suppression expires and is capped so one transient image failure cannot poison the session or grow without bound.

TMDb featured enrichment is cache-first and runs through `PtvBoundedWorkQueue`: at most 48 remote candidates per pass, four concurrent requests, and a 3.5-second per-request budget inside the existing outer refresh budget. Completed enrichment is retained when the caller cancels or the outer budget expires. Status exposes attempted, completed, skipped, failed, cancelled, and partial counts; partial timeout is diagnostic rather than a featured-cache health failure.

### Movies And Shows Focused Browse Routes

`browseRoute.ts` is the canonical parser and URL builder for native Movies, Shows, and Collections browsing. It parses the hash query exactly once and includes every data-affecting value in `canonicalRouteKey`: media kind, view, scope alias, structured filter, collection/series context, search, sort, order, and page. `routeIdentity.ts` gives the shell/controller the same query-aware identity, so query-only navigation, refresh, and browser history no longer reuse the landing route generation. Route lifecycle counters synchronize the controller from the current browser location before recording their generation, preventing a shell mount during a query-only transition from being attributed to the previous query.

The supported focused registry is:

- Movies: `latest`, `trending`, `genres`, `genre`, `studios`, `studio`
- Shows: `continue`, `latest`, `trending`, `genres`, `genre`, `networks`, `network`, `season`
- Collections: `featured`, `genres`

Base `#/movies`, `#/shows`, and `#/collections` remain the existing progressive multi-shelf landing pages. Focused routes render one directory or paged result grid and never append the landing shelf stack. Incomplete season routes require `seriesId`; unsupported routes render a recovery state instead of silently falling back.

`browseData.ts` resolves `anime`, `animemovies`, and `cartoons` through authenticated Jellyfin user-view discovery. Alias matching uses explicit collection type plus exact normalized configured names only; once resolved, all queries use stable user-view IDs through `ParentId` or `AncestorIds`. Unknown aliases fail closed. Scope discovery is cached per server/user. Focused page cache keys include resolved library IDs, filters, search, sorting, and pagination and are capped at 80 two-minute entries.

`focusedBrowseLoader.ts` owns the canonical focused-load identity used by React effect ownership and the focused-page cache. The internal key deterministically includes media kind, normalized view, resolved scope status/alias/library IDs, collection and season parent context, exact genre/studio/network, resolved metadata IDs, focused search text, sort field/order, zero-based page, `StartIndex`, and page size. Equivalent whitespace/case and metadata-ID ordering normalize to the same identity, while every effective data-filter change produces a distinct identity. The Jellyfin API adapter does not expose an `AbortSignal`, so keyed owner tokens retire old work and suppress late responses rather than claiming transport cancellation. New-key loads reset focused state; matching page loads deduplicate and append only within that key.

Exact genre queries use `Genres` before `StartIndex`/`Limit`. Studio and network directories use Jellyfin metadata endpoints, resolve an exact normalized entry to its ID, then query with `StudioIds` before paging. Focused pages request 50 items at a time, honor `TotalRecordCount`, deduplicate accumulated pages by item ID, and suppress stale route responses. Footer metadata links use `buildPtvBrowseHref`; they do not route names through global text search.

`genreDirectory.ts` is a presentation boundary over Jellyfin's exact genre vocabulary. It normalizes Unicode/whitespace and casing for display, performs case-insensitive exact deduplication, and supports only explicit maintainable alias groups such as Science Fiction variants. It never fuzzy-merges unrelated metadata. Every entry retains its original Jellyfin value for the focused query, while an explicit group presents each exact member as a separate query choice. Counts come from the metadata directory response rather than per-genre item requests. A per-user Curated/All metadata preference hides an exact bounded sensitive-genre set by default without deleting or rewriting server metadata.

Shows `view=networks`/`view=network` remains route-compatible, but the visible label is **Studios & Networks**. The current Jellyfin adapter implements that directory with `getStudios` and exact `StudioIds`; the UI therefore does not claim a network-specific backend contract that does not exist.

Trending is deterministic and local-library-only. The score is `PlayCount * 20 + favorite 14 + played 8 + CommunityRating * 2 + CriticRating / 10 + recency`, where recency contributes 0-10 points over an approximately 180-day decay. Stable title/ID ties and a five-minute bounded ranked-pool cache keep unchanged inputs ordered consistently without per-card external requests.

Browse diagnostics require administrator access plus explicit debug mode, remain collapsed and bounded, and expose only safe route/scope/filter/count/timing state. Focused-load telemetry records a sanitized loader identity with the exact public filter label plus category, page/offset/limit, count, total, duration, scope status, and sort state. Internal keys may use stable Jellyfin IDs; exported diagnostics never expose request URLs, origins, user/item IDs, tokens, resolved library IDs, or arbitrary raw parent/search identifiers.

## Local Remote Diagnostics Boundary

Remote diagnostics is temporary local troubleshooting, not telemetry. `remoteDiagnosticsModel.ts` owns schema-1 leases, profile tags, event sanitization, ring-buffer reduction, and payload budgeting. `remoteDiagnostics.ts` owns collector lifecycle, safe presence metadata/capabilities, and the intentionally small API at `window.PTV.remoteDiagnostics`. `pluginRemoteDiagnosticsTransport.ts` connects that agent to the active authenticated plugin root only when `/status` advertises `remoteDiagnostics`, and exposes compact local debug state for bootstrap/capability/check-in status. A negative capability result is cached for five minutes so an older plugin is not polled every 30 seconds, while later plugin upgrades recover without a browser-data reset.

The client checks in every 30 seconds. No expensive collectors run without an accepted lease. Administrators may start only five- or ten-minute sessions; a snapshot command grants a one-minute lease. The server returns relative `durationMs` with its issuance time, and the browser normalizes the deadline to its local clock so server/client skew cannot prematurely expire or extend a session. Explicit disable, manual Stop, natural expiry, disposal, and capability loss tear down listeners, timers, and patched fetch/XHR hooks. Active sessions publish periodically every 15 seconds, with additional explicit and final snapshots when requested or ending; Dashboard refreshes its client list on a 15-second cadence and loads reports only on an explicit View/Download action.

Collector output is deliberately coarse: profile class, route transitions and two-frame render timing, navigation, playback state without content identity, recognized input keys, structured error category/name, failed same-origin versus cross-origin requests with sanitized paths, connectivity, long tasks, sampled FPS/stutter, rounded memory, and an allowlisted operational log tail. Raw user agents, arbitrary error/log detail, credentials, authorization, query strings, private origins, user/item/source identifiers, titles, and local/media paths are omitted or normalized. Both the client model and plugin controller sanitize independently.

The client ring retains at most 300 events and budgets serialized samples to 160 KiB, leaving headroom under the plugin's 192 KiB report request limit. Presence requests are capped at 8 KiB. The controller also bounds JSON to depth 10, 4,000 nodes, 500 array entries, 96 object properties, and 1,024 characters per string before storing a second sanitized representation.

Client IDs are opaque and session-scoped in browser session storage; only the normalized active lease is stored beside them. The plugin hashes the authenticated Jellyfin identity and binds each client ID, lease, and report to that owner. Presence/report upload requires authentication, and administrator elevation is required for listing, commands, snapshots, and report reads/downloads. The in-memory store is capped at 64 clients, expires clients and reports after 30 minutes, retains only the newest report per client/session, and writes nothing to disk or an external service. Natural expiry has a 30-second final-report grace so late final uploads can preserve the newest `generatedAt`; manual Stop revokes immediately. Presence summaries carry sanitized device/app/platform labels, first/last seen times, native-runtime hint, and explicit command/report/performance capability booleans. Internal fallback names such as `oldname_dup` are never used as the primary dashboard label.

The diagnostics client list is populated only by running PiggieTV web clients that successfully check in to `POST /Ptv/v1/diagnostics/clients/check-in`. It deliberately does not mirror Jellyfin's active playback sessions. A native Jellyfin Android TV or Fire TV app session that does not execute the PiggieTV web bundle cannot appear in Remote Client Diagnostics without a native integration or wrapper-side bridge. When safe metadata is available from a PiggieTV web runtime, Android TV/Fire OS and Fire TV signals normalize to the `firetv` profile for filtering and leases. Every real check-in also includes a tiny boot marker: detected platform, whether the PTV runtime and diagnostics module loaded, whether check-in was attempted, last check-in status/failure, loaded frontend build ID, and remote-diagnostics registration count.

The Dashboard is an administrative control surface over this state, not a passive recorder. It supports coarse profile filtering, explicit client selection, 5/10-minute Start, Stop, Snapshot, View, and Download. It clears a previously viewed report when client selection changes so stale evidence is not presented as the active client. Client display prefers safe device names and shows platform/app/version/capabilities; duplicate friendly names keep the suffix secondary to the real label. Unsupported capabilities disable the affected actions rather than inviting a lease that cannot complete.

The Dashboard also has a separate Detected Jellyfin sessions section sourced from authenticated Jellyfin session data. These rows can explain active devices such as LG Smart TV/Jellyfin for webOS or Fire TV/Jellyfin Android TV, but they are not selectable diagnostics clients unless matched to a real PTV check-in. Capability modes are explicit: `full-web`, `full-native`, `server-observed`, `unsupported`, and `stale-build`. Server-observed rows are limited to server session/playback facts and never unlock browser memory, DOM ownership, render timing, or network snapshot controls.

Dashboard client-list data crosses a defensive component boundary before render. The panel requests `unknown`, validates that the response is an array, skips non-object rows and rows without a usable `clientId`, deduplicates client keys, and normalizes optional timestamps, profile, route, booleans, and nullable strings before React maps the list. Loading, error, empty, and success states remain distinct so a partially loaded or malformed response cannot reach the error boundary. Development/debug warnings are compact and include route, component, item ID when available, item type, missing property, source row, and `plugin-cache` as the source; they do not include tokens, headers, user objects, or raw payloads.

## Validation Boundaries

The current repository uses:

- Vitest for frontend unit/regression tests
- TypeScript `--noEmit` checks
- ESLint and Stylelint
- Webpack production builds
- `dotnet build` for the companion plugin

`src/ptv/core/config.ts` must remain importable outside Webpack. Its development-server check uses `typeof __WEBPACK_SERVE__ !== 'undefined'` before reading the compile-time constant; direct access breaks Vitest and other Node-based consumers.

The historical 2026-07-14 browse audit verified 36 Vitest files/283 tests, including 6 focused browse/route/directory files with 37 tests. Its frontend-only deployment statement applies only to that dated browse correction and is superseded for the current worktree.

The authoritative 2026-07-19 verification covers 58/58 targeted frontend tests, 20/20 companion-plugin tests, TypeScript/build checking, changed-source ESLint, webOS Stylelint, the plugin contract, production Webpack, and `git diff --check`. The follow-up Remote Diagnostics dashboard crash fix adds 9/9 focused panel tests and re-ran TypeScript, targeted changed-file ESLint, and production Webpack. Webpack retains only the two established aggregate asset/entrypoint warnings. The refreshed five-file plugin payload is newer than all plugin C# source, and repository hygiene checks find no tracked `.dotnet-home`, Vite result, split-development log/PID, or nested plugin project/test `bin`/`obj` output.

The earlier development-server probe at `http://localhost:8080/` proved only that its then-current local bundle was served, not authenticated Jellyfin route behavior. Authenticated role/diagnostics checks, real-library behavior, and physical touch/TV behavior remain deployment checks for the current matching frontend/plugin build.

Local automated validation cannot prove authenticated Jellyfin behavior, live Google Books/ComicVine application, restart persistence, Fire TV input, or real-device responsive behavior. Those remain deployment checks.

### Authentication Route Shell Boundary

`src/ptv/shell/authenticationRoutes.ts` is the canonical, dependency-free classifier for login, server selection, password recovery/reset, quick-connect, manual-login, and signup routes. It normalizes hash, hashbang, pathname, and full `/web/#/...` locations, compares exact route paths, and deliberately ignores query parameters. The shared route registry and login enhancer consume this classifier instead of maintaining competing login regular expressions.

`RootAppRouter` owns the stable PiggieTV `AppHeader`; `AppLayout` owns the experimental Jellyfin-style application bar and drawer. Both consult the canonical authentication classifier. Authentication routes do not mount the visible PiggieTV header controls, sidebar, drawer handle, experimental app bar, or experimental drawer. `AppHeader` remains as a hidden compatibility host containing only Jellyfin's required `.mainDrawer .scrollContainer` and `.skinHeader` anchors because `scripts/libraryMenu` reads those anchors during module initialization, including on login. React Router location changes immediately remove or restore visible authenticated controls for direct loads, redirects, logout/login transitions, query-only changes, and browser history navigation. This is lifecycle ownership with narrowly scoped compatibility DOM, not a permanent CSS override, so native fallback, dashboard, accessibility, login-card, and authenticated-page header behavior is unchanged.

The first 2026-07-14 authentication correction correctly removed visible authenticated headers but also unmounted Jellyfin's compatibility anchors, causing `libraryMenu` null dereferences and a circular-import temporal-dead-zone error on configured login startup. The follow-up keeps only those inert anchors hidden and tests that all visible controls remain unmounted. Final validation passed 3 focused files/35 tests and the complete 38-file/315-test Vitest suite. TypeScript, scoped ESLint, `git diff --check`, and production Webpack passed; Webpack compiled in 76.139 seconds and emitted only the established aggregate asset/entrypoint-size warnings. Fresh plain/query login probes at desktop, tablet, mobile, and TV sizes found no runtime overlay or visible PiggieTV header, while confirming both required hidden anchors. No styles, plugin source, plugin API contract, or cache schema changed.

## Architecture Rules

- Keep `core/app.js` as the only full runtime initializer.
- Keep route ownership in the route registry/controller; pages must not create competing navigation state.
- Keep global playback under the persistent runtime root.
- Keep one shared card/quality/routing path across row sources.
- Keep Reading classification, filename parsing, grouping, and diagnostics in their pure boundaries.
- Keep server-persisted overrides authoritative over browser storage.
- Keep year out of inferred series identity.
- Keep provider descriptions out of canonical titles.
- Keep Reading metadata apply field-selective; do not restore broad recursive replacement.
- Preserve Jellyfin fallbacks for unsupported routes and missing plugin capabilities.
- Keep remote diagnostics inactive without an explicit bounded lease, local to the authenticated PiggieTV/Jellyfin deployment, memory-only, size-limited, and sanitized independently at client and server boundaries.
- Keep presence/report upload authenticated and every client-list/session/report administrative operation administrator-only.
- Preserve `src/ptv/plugin/bin` as the intentional five-file deployable payload; keep nested plugin project/test `bin`/`obj` and other machine-local caches/logs untracked.
- Finish every project prompt by reconciling `HANDOFF.md`, `PROJECT_STATE.md`, and `ARCHITECTURE.md` with the resulting code, tests, deployment boundary, and open risks.

## Change Record

### 2026-07-14 Production Hardening Program

- CI is split into frontend quality/build/browser jobs and a path-scoped companion-plugin contract job under `.github/workflows`. Checks use locked npm installs, Node 20, Chromium, net9.0, the recorded per-file PTV lint baseline, a zero-debt gate for new hardening files, privacy scanning, and range-aware whitespace validation.
- `webpack.common.js` injects sanitized build date, build identifier, and mode values. `core/buildInfo.ts` combines those values with frontend/plugin API, cache, and version compatibility without exposing server identity or credentials; the dashboard presents the same bounded provenance.
- `services/updateService.ts` owns service-worker update lifecycle. It offers an update, defers activation while playback is active, sends `SKIP_WAITING` only after explicit user action, and reloads only after controller replacement. `PTVUpdateNotice` is rendered by the persistent runtime root, so route changes do not lose update state.
- `BrowseDirectory.tsx` and `browseDirectoryModel.ts` own directory presentation, filtering, curated/all preference, bounded recent choices, and incremental rendering. `NativeBrowsePage.tsx` retains request ownership, focused-loader identity, cache, pagination, and stale-response suppression.
- `PTVShellBackdrop.tsx` owns shell backdrop transitions and telemetry. PTV dashboard enhancements are imported only on dashboard routes; reader engines and other established route-specific modules remain lazy.
- The Playwright harness under `e2e` imports real route, focused-loader, authentication, and update-service logic into a deterministic local browser surface. It is intentionally excluded from Vitest discovery and runs as a separate Chromium suite.
- `scripts/ptv-repository-size-report.mjs` separates project-owned files from historically tracked dependency/build trees and reports potential LFS/duplicate assets without deleting or rewriting history.

The hardening pass does not change plugin routes, cache schema v7, recommendation persistence, playback ownership, Reading metadata application, or native Jellyfin fallback contracts.

| Date | Change |
| --- | --- |
| 2026-06-16 | Initial repository architecture snapshot. |
| 2026-06-17 | Added recommendation persistence, source fallback, and diagnostics architecture. |
| 2026-07-13 | Consolidated the singleton runtime, shared shell, cache v7, current routes, plugin API, and Reading metadata/grouping architecture into one current document. |
| 2026-07-13 | Recorded the final Reading production-hardening verification boundary, guarded Webpack runtime constant, and scoped-versus-repository lint baseline. |
| 2026-07-13 | Added the final debug-export sanitizer boundary, bounded/cache-first TMDb enrichment, progressive browse scheduling, expiring image-failure isolation, and corrected shell mount telemetry. |
| 2026-07-14 | Added canonical query-aware Movies/Shows focused routes, exact scoped metadata browsing, deterministic local trending, bounded server paging/cache identity, and protected browse diagnostics. |
| 2026-07-14 | Corrected query-transition lifecycle telemetry, hardened shareable debug exports against data/blob payloads and misleading version/credential fields, and added safe focused-browse runtime evidence. |
| 2026-07-14 | Added exact-value genre directory presentation, explicit non-fuzzy alias groups, Curated/All metadata visibility, truthful Studios & Networks terminology, bounded browse diagnostics, and explicit shell-instance mount attribution. |
| 2026-07-14 | Added one exact query-insensitive authentication-route boundary and prevented both stable and experimental authenticated headers from mounting on login/server/password/quick-connect/signup routes. |
| 2026-07-14 | Restored Jellyfin's hidden login-time header/drawer compatibility anchors without remounting visible authenticated controls, eliminating the `libraryMenu` null and circular-initialization runtime cascade. |
| 2026-07-14 | Replaced Reading's 200-item terminal cap with a cancellable 50-item progressive index: the first 200 items render promptly, later pages accumulate monotonically to the server total, only complete schema-v4 library indexes persist, and card grids remain incrementally mounted. Route lifecycle events now synchronize exact Movies, Shows, Reading, Dashboard, and authentication ownership before render/unmount telemetry. |
| 2026-07-14 | Added authentication-gated/deduplicated plugin startup reads, canonical singleton runtime diagnostics, advertised and contract-tested Reading series-override routes, explicit development provenance fallbacks, and priority-aware image telemetry aggregation. |
| 2026-07-15 | Established plugin `<private-address>` as the first release advertising durable Reading series overrides, with assembly-derived runtime identity, manifest/contract verification, and capability-aware frontend compatibility. |
| 2026-07-15 | Deployment verification exposed and corrected plugin configuration XML serialization, production runtime entry ownership, authenticated plugin-client readiness, and base-path-safe service-worker registration. The corrected candidate pair is locally healthy; permanent web-root deployment and the real 1,818-item Manga completion run remain external deployment gates. |
| 2026-07-15 | Made drawer edge-swipe listener ownership lifecycle-safe: missing authentication handles fail closed, exact bound targets are retired, replacement handles rebind once, and page-show reconciliation no longer depends on a page-type change. |
| 2026-07-15 | Corrected split-origin development discovery with explicit `PTV_DEV_JELLYFIN_URL` precedence and stale plugin-root retirement. Restricted shell geometry to PTV-owned containers so native Jellyfin page hosts no longer insert a viewport spacer ahead of Home, Reading, or Dashboard. |
| 2026-07-16 | Restricted the global media dock to PTV Music-owned audio and made frontend update activation idempotent, controller-driven, timeout-bounded, and reload-safe. |

### Plugin Release Compatibility Boundary

Plugin `<private-address>` is the first release in this line that advertises durable `readingSeriesOverrides`. `PtvPluginVersion` in the plugin project is authoritative; assembly/file metadata and runtime status derive from the built assembly, while source and published `meta.json` files are contract-checked against it. Plugin API v1, featured cache schema v7, Jellyfin package target `10.11.8`, and manifest target ABI `<private-address>` are independent compatibility axes and must not be patch-bumped with the plugin.

The frontend evaluates transport compatibility and feature capability separately. Plugin `<private-address>` without `readingSeriesOverrides` remains connected but cannot claim server-persisted Reading corrections; reads may use browser cache and writes request a plugin upgrade. Plugin `<private-address>` with the advertised feature is compatible. The dashboard shows this distinction without creating a second runtime or treating cache fallback as server persistence.

The release payload is the five-file `src/ptv/plugin/bin` publish output. Replacing the DLL/manifest requires a Jellyfin restart before deploying the matching frontend behavior.

### Deployment Runtime Boundary

Plugin configuration cannot serialize `ReadingSeriesOverrideSettings.Routes` as a nested dictionary through Jellyfin's XML serializer. The runtime model therefore keeps the dictionary out of XML and exposes a deterministic persisted route-list surrogate that reconstructs case-insensitive route and item maps. JSON/status behavior continues to use the runtime dictionary. A configuration round-trip test protects this boundary.

The production Jellyfin-web entry imports `ptv/core/app` exactly once so the canonical PiggieTV runtime exists outside the development-only entry path. Plugin API consumers obtain the current authenticated Jellyfin API client through the shared readiness boundary; concurrent startup reads remain endpoint-deduplicated and do not issue pre-authentication requests. Dashboard diagnostics consume that singleton and never create a diagnostic runtime.

Service-worker registration uses a path-relative `serviceworker.js` URL. This resolves to `/web/serviceworker.js` when Jellyfin is hosted under `/web` instead of incorrectly requesting a server-root asset. Update deferral during playback and unsaved workflows remains owned by `updateService`.

The 2026-07-15 local deployment candidate verified plugin `<private-address>`, API v1, cache v7, `readingSeriesOverrides=true`, healthy cache/status, authenticated override GET/PUT for books/comics/manga/reading, and persistence across a clean Jellyfin restart. The installed plugin directory and web root were backed up before replacement and those backups must be retained until production sign-off. The permanent Jellyfin web root was not replaced because the current process lacked the required filesystem permission; the matching production `dist` was served through Jellyfin's explicit web-directory option for verification only.

### Primary Navigation Dropdown Boundary

Movies and Shows dropdown panels are body-level React portals owned by `PtvShellPrimaryDropdown`. They must not be rendered inside `.ptv-shell-nav-primary`: that container scrolls horizontally on compact layouts, and its overflow plus backdrop-filter containing block clips inline or fixed descendants on Android Chromium regardless of z-index.

The trigger remains in the shared shell navigation and owns `aria-expanded`, `aria-controls`, keyboard activation, and touch gesture classification. The portal owns outside-pointer dismissal, Escape handling, focus return, and visual-viewport positioning. Its fixed overlay is clamped to the effective visual viewport and repositions after viewport resize/scroll, orientation changes, window scroll, and navigation-row scrolling. Page content remains below the overlay while dialogs, loading surfaces, and toasts retain higher layers. Route/history changes continue to close transient shell state through `PTVShell`.

Pointer Events are the single input path. A normal touch releases into one native click, while movement beyond the horizontal gesture threshold suppresses that pointer-derived click so swiping the navigation row cannot open a menu. Do not add parallel touchstart/click handlers or timing-based dismissal workarounds.

### Drawer Edge-Swipe Lifecycle Boundary

The authentication compatibility host deliberately retains Jellyfin's hidden `.mainDrawer .scrollContainer` and `.skinHeader` anchors, but it must not mount the authenticated `.mainDrawerHandle`. `NavDrawer` therefore cannot capture the drawer handle during class construction or assume that a touch-capable route always owns one.

`NavDrawer.setEdgeSwipeEnabled` resolves `.mainDrawerHandle` at lifecycle time and fails closed when it is absent. It records the exact element that received touch listeners, removes listeners from that same element when disabled or replaced, and marks edge swipe enabled only after a valid target is bound. `libraryMenu` reconciles edge-swipe ownership on every page-show event, not only when the coarse page type changes, so authentication-to-application and same-type DOM replacement transitions are safe and idempotent.

This boundary fixes the cross-platform blank-screen regression caused by `dom.addEventListener(null, ...)` on touch-capable login startup. The body-level Movies/Shows dropdown portal did not create the null target and remains in place. Authentication still has no visible authenticated header, while successful navigation to an application route can bind the newly mounted handle exactly once.

### Development Server-Origin And Login Layout Boundary

Development server selection is explicit and split-origin safe. `PTV_DEV_JELLYFIN_URL` is injected only into development bundles; production always receives an empty value. The frontend host is never treated as evidence of the Jellyfin host, and loopback candidates are never rebased to the frontend hostname. Candidate precedence is the explicit development Jellyfin URL, the saved server matching the requested `serverid`, a valid authenticated `ApiClient`, and then bounded saved/configured fallbacks. `serverOriginSelection.ts` owns this ordering, while `urlOrigins.ts` only normalizes an already selected URL. Plugin API ownership follows the same active root and retires a stale pinned root when Jellyfin changes servers. Discovery and transition diagnostics do not log raw candidate URLs or credentials.

Jellyfin's `.mainAnimatedPages`, `.mainAnimatedPage`, and generic `.page` elements retain their native positioning and height ownership. Shared shell styles apply geometry only to PTV-owned `.ptv-shell-main` and `.ptv-shell-page` elements. The previous global relative/min-height overrides inserted a viewport-height stock container before native PTV pages, producing the black Home spacer, bottom-displaced Reading navigation, and blank Dashboard content. Authentication retains its separately verified full-viewport, internally scrollable layout.

Real-runtime verification is opt-in through `PTV_LIVE_DEV_URL` and `PTV_LIVE_JELLYFIN_URL`; it bypasses the isolated Playwright server and tests the actual Webpack/HMR bundle. It checks desktop, Pixel-sized, and iPad-sized login geometry, explicit split-origin discovery despite stale loopback storage, NavDrawer chunk provenance, service-worker ownership, unauthenticated Home redirect population, and browser errors. This is stronger than the static harness but does not replace authenticated physical-device verification of Home, Reading, and Dashboard.

### Canonical Music Playback Presentation Boundary

`PTVRuntimeRoot` is the persistent playback presentation owner and renders exactly one compact `PTVMediaDock` across PTV routes. Music's separately loaded body root is an overlay host only: it may render the full-screen player, queue drawer, and playlist dialog, but it must never render another compact player. Its root and load promise live on `window` so route remounts and HMR reuse the same overlay host.

`musicQueue.ts` continues to own the single module-level native audio element (`data-ptv-music-native-player`) and queue. Queue publication from `timeupdate` is limited to once per second, and subscribers no longer create independent polling intervals. The global playback service subscribes once, removes playback-manager listeners during disposal, and suppresses its low-frequency reconcile while the native Music queue has a current item. Progress remains event-driven without multiplying state traffic by subscriber count.

While a PTV-native route has an active dock item, `PTVMediaDock` applies `ptv-playback-presentation-owned`. The narrowly scoped native-route selector suppresses Jellyfin's `.nowPlayingBar`; cleanup restores stock presentation automatically when playback stops, the dock unmounts, or a native fallback owns the route. Do not replace this lifecycle boundary with a global `.nowPlayingBar { display: none }` rule.

Music library count presentation has explicit `scheduled`, `loading`, `ready`, and `failed` states. Cached content immediately reports a cached count; a failed live index reports an unavailable-live-count fallback. `Loading library tracks` is reserved for an active current-generation request. Shared Music coordinator requests are logically retired through route/request generation and stale-response suppression; they are not represented as physically aborted when the shared API layer has no per-owner transport cancellation.

Plugin startup selects an authenticated `ServerConnections` client first, then an authenticated `window.ApiClient`, before considering an unauthenticated fallback. This prevents a stale connection client from blocking candidate generation and leaving Dashboard diagnostics with null roots/responses. Split-origin development still takes its Jellyfin root from the explicit development backend, never from the frontend hostname.

### Media Dock And Frontend Update Ownership Boundary

`playbackStateService` is intentionally a universal state observer, but `PTVMediaDock` is not a universal Jellyfin playback renderer. The dock positively requires an active `ptv-music` source with audio media/item identity. Video playback routes retire dock presentation immediately, even during the brief handoff before a stale Music snapshot is replaced. Movie, Episode, Series, Trailer, and other video sessions remain owned by Jellyfin's video player UI and never acquire `ptv-playback-presentation-owned`.

Frontend update application has one in-flight owner. A waiting worker receives `SKIP_WAITING`; `controllerchange` triggers exactly one reload. If the transition never arrives, a bounded activation timer performs the same one-shot reload. Missing worker activation support falls back directly. The reload marker is scoped to the current attempt and cleared when the service starts or a new waiting worker is adopted, so an old session marker cannot suppress future updates. The notice leaves its applying state before reload and repeated clicks/controller events cannot multiply attempts.

### XML-Safe Reading Override Configuration Boundary

Jellyfin configuration types must not expose public `Dictionary` or `IDictionary` properties, even when a property is annotated with `XmlIgnore`. `ReadingSeriesOverrideSettings` therefore owns its case-insensitive dictionary privately and exposes only a deterministic `ReadingSeriesOverrideRouteEntry[] Routes` XML property. The array retains the established `<Routes><Route ...>` wire shape so existing persisted list-form data round-trips without a schema or capability change.

Runtime callers use `GetRoute`, `SetRoute`, and `RemoveRoute`; they never mutate serialized storage directly. Route and item entries are sorted before serialization, input keys are normalized, and returned dictionaries are defensive snapshots. Reflection and XML round-trip tests protect the complete public configuration graph from future `IDictionary` regressions.

Plugin API transport failures are classified separately from HTTP failures. A response with status 500 or greater is a `server` error and the dashboard reports `plugin server error`; network failures remain `network` errors. Sanitized response bodies and status codes remain bounded in diagnostics without credentials or authorization data.

### Production Bundle Coherency Boundary

The document entry is the deployment commit point for Jellyfin-web. Deployment copies and SHA-256 verifies every bundle, stylesheet, and content-hashed async chunk before replacing root `index.html` atomically. Existing content-hashed chunks are retained so clients running an older runtime can finish loading while a new build is published.

Production startup wraps Webpack's async JavaScript and extracted-CSS filename resolvers once. Requests retain their immutable emitted filenames and add a build-scoped `ptv_asset` query derived from frontend build and commit identity. This prevents a CDN failure cached against a bare chunk pathname from poisoning every client and separates otherwise identical paths across release generations.

Route chunk failures remain recoverable without a reload loop. The router error boundary recognizes only same-origin JavaScript/CSS chunk failures, records one build-and-request-scoped attempt in session storage, and reloads the current document with its hash route preserved. Successful startup removes the visible recovery marker. Ordinary application errors and cross-origin failures are not reloaded.

### Shell, Reading Progress, Playback Reconcile, And Plugin Diagnostics Boundary

Shell header diagnostics are valid only while a mounted native shell matches the active route owner. `shellHeaderState.ts` reconciles the live route with the mounted header section, and fallback/admin routes intentionally expose no native page-header state. The final native shell unmount clears all retained header fields; a replacement shell may keep ownership without an empty-state race.

Reading background indexing may accumulate every server page, but it does not publish every transport page into React. Progress publication is monotonic and bounded to meaningful milestones, while render telemetry keys off route, partial/final stage, and section readiness instead of raw accumulated count. Completion is always published, so a 2,911/2,911 index remains observable without producing a render and shell-ready event for each background batch.

Low-frequency Jellyfin playback reconcile exists only while an active Jellyfin playback source is present. Idle state, native Music queue state, and stopped sessions own no interval. This does not alter the video mini-player presentation boundary or the event-driven native Music queue.

Plugin API attempted-response diagnostics contain both success and failure outcomes. Each bounded entry records a sanitized endpoint path, HTTP status, success flag, and request duration; query strings, origins, credentials, and authorization data are excluded. A connected status/settings/featured sequence is therefore visible as successful transport evidence instead of leaving an empty attempted-response list.

### Details Route And Video Playback Ownership Boundary

Hash routes rooted at `#/details` and `#/item` are PiggieTV-native presentation routes. The existing Jellyfin details view continues to own item metadata and actions, but PiggieTV mounts one header-only `PTVShell`, suppresses the legacy Jellyfin header through native route ownership, and applies header-safe top geometry to the details content. The matcher is boundary-aware so `#/music/item/...` remains a Music route and `#/video` remains owned by Jellyfin's video player.

Video playback owns the global playback surface as soon as the route enters `#/video` or Jellyfin publishes an active video session. The ownership handoff pauses the single native PiggieTV audio element through `pausePtvMusicPlayback`; it preserves queue, current index, source playlist, and playback position, but clears active PiggieTV Music publication while video owns playback. Leaving video does not resume Music. A paused Music state may return to the dock after video ownership ends, and playback resumes only after an explicit user command.

### Native Details Layout Isolation Boundary

PiggieTV-owned details presentation uses the existing Jellyfin details controller for metadata and actions, but it cannot inherit Jellyfin's stock document-flow geometry. `detailsLayout.js` gives the active page explicit native root/content/primary/secondary classes and temporarily moves the stock logo into the native ribbon; teardown restores the original DOM position so fallback ownership remains reversible.

The native primary section has named grid areas for poster, ribbon, and content. This is required because Jellyfin supplies three primary children; an unnamed two-column grid placed the third child on an implicit second row and retained stock viewport-width padding. Details styles reset the flowing `40vh` backdrop, fixed ribbon height, `32.45vw` primary-content inset, stock section margins, and absolute logo positioning only below `.ptv-detail-page`. Overview and metadata keep a readable bounded width, taxonomy/external links wrap as horizontal chips, and Cast & Crew/related shelves share the same centered container. Mobile switches the named grid to one column without transform-based scaling or horizontal overflow. The secondary container reserves bottom space for the persistent Music dock while leaving `#/video` playback ownership unchanged.

### Native Details Artwork And Glass Boundary

Native details pages own one fixed, page-wide artwork layer independent of Jellyfin's flowing `.itemBackdrop`. After item hydration, the details controller resolves `Backdrop`, `Thumb`, and `Primary` candidates in that order and hands the bounded list to `detailsLayout.js`. Failed candidates advance without remounting the page; an empty or exhausted list retains a themed purple gradient. The layer is removed with the details lifecycle and cannot affect Music-owned item routes or Jellyfin-owned video playback.

All details glass is scoped below `.ptv-detail-page`. The page defines translucent fill, strong-fill, border, highlight, glow, and blur/saturation tokens used by the title ribbon, poster, action group, metadata, primary sections, Cast & Crew, and related shelves. The fixed backdrop remains visible through those surfaces behind readability masks and a restrained purple wash. Unsupported backdrop filtering receives a more opaque purple fallback, while low-power and reduced-motion profiles reduce blur and transitions without changing layout or content ownership.

### Shared Shell Surface Hierarchy

`PTVShell` owns layout and interaction, but its outer `.ptv-shell-header` is never a visual surface. The header remains transparent with no border, shadow, or backdrop filter across desktop, tablet, mobile, native details, and PTV dashboard routes. The symmetric desktop grid gives the primary navigation physical viewport-center ownership independent of logo and utility widths.

Glass is limited to deliberate controls: `.ptv-shell-nav-primary` owns the centered navigation pill, while each `.ptv-shell-icon-button` owns a compact purple-tinted glass surface and Search retains the larger circular treatment. Details styles may change safe-area geometry but cannot restyle the shared header root. Android dropdowns remain portal-owned, and low-power profiles remove expensive filters from nav and utility controls without changing their hierarchy.

### Details Hydration And Video Presentation Boundary

The Jellyfin item-details controller owns one item-scoped request generation. Starting a new Movie, Series, Season, or Episode request immediately clears stale visible detail state, retires the prior generation, and permits asynchronous sections to commit only while both generation and item ID still match. The controller does not mark a native detail enhancement complete before an authenticated API client exists, avoiding the refresh-only failure where the first navigation permanently skipped artwork enhancement.

Details artwork is resolved and preloaded before display. Backdrop candidates prefer the item, then related parent/season/series artwork, then current Thumb and Primary images. Candidate failure advances without leaving a blank page, and poster/logo slots keep stable geometry while images transition from pending to ready. Independent season, episode, cast, related-item, and image requests may run concurrently, but stale responses cannot mutate the active item.

Media-version UI consumes one shared conflict-safe normalized source list. Exact normalized path equality is authoritative and always joins aliases even when probe metadata differs. Matching source IDs merge only when their shared technical fields do not conflict. A strong signature over container, runtime, bitrate, size, media name, and normalized audio/video stream details can identify mount-path or virtual-path aliases across different paths/IDs. ID- and technical-signature candidate edges join graph clusters only when doing so would introduce no hard technical conflict anywhere in the resulting alias cluster, preventing a sparse or reused-ID bridge from hiding a real playable version. The richest record represents an alias cluster; comparison diagnostics are capped at 24 and expose only candidate indices, reasons, and signal names, never paths, titles, or IDs.

Jellyfin retains ownership of `#/video`. Its PTV presentation uses translucent purple-blue control glass, with low-power and unsupported-filter fallbacks. Episode playback headings combine the series title, season/episode index, and episode title; the controller's known parent title is used when the playback DTO omits `SeriesName`. Movie title behavior and the existing Music-to-video ownership handoff are unchanged.

### Auth-Aware Shell Utilities And Details Render Handoff

Administrator shell visibility follows Jellyfin authentication lifecycle rather than a one-time mount snapshot. An unauthenticated lookup is not cached as an authoritative non-admin result; `localusersignedin` invalidates and resolves access again, while `localusersignedout` removes administrator controls immediately. The Dashboard utility therefore appears after delayed authentication without remounting the shell. Shell icon components explicitly neutralize the global icon margin rule so every glyph remains centered in its equal-size glass control.

The stock Settings lifecycle now mounts the same header-only `PTVShell` used by other native presentation routes and applies a narrowly scoped header safe area to Settings roots. Settings content and Jellyfin ownership remain unchanged; only duplicated legacy shell chrome is replaced while the route is active.

Native Details enhancement consumes the exact item emitted by the item-details controller after the active request generation commits. It no longer launches a second full item fetch during normal navigation or treats an early DOM mutation as final ownership. Direct item artwork is applied immediately, optional parent artwork resolves as a same-item background upgrade, and later Jellyfin DOM mutations only reapply native classes. Poster image markup commits with stable geometry and uses the shared image loader instead of an additional blocking preload. This closes the first-navigation/plain-layout race while retaining stale-item suppression and the existing video/Music ownership boundary.

### Authoritative TV Render Profile And Focus Boundary

TV layout is selected once by `detectPtvTvClient` and represented by the client profile, root classes, data attributes, diagnostics, and focus engine. LG webOS, Samsung Tizen, Android TV, Fire TV, Roku user agents, and explicit Jellyfin ten-foot signals enter `ptv-render-tv`; screen dimensions alone never convert an ordinary desktop browser into TV mode. The profile also records coarse pointer, hover, backdrop-filter, container-query, aspect-ratio, and content-visibility capabilities so CSS and runtime behavior share one source of truth.

`src/ptv/styles/profiles/tv.scss` is the late-loaded ten-foot override. It owns fixed card geometry, nonshrinking rails, 720p/1080p/4K variables, overscan-safe page gutters, bounded heroes and title art, visible row controls, large shell targets, details geometry, and focus elevation. Native PTV routes suppress Jellyfin's header and drawer only while the native shell is mounted. `src/ptv/styles/profiles/webos.scss` removes filter-dependent glass, expensive reflections, and scale animation while retaining the same layout. Its static regular/strong glass fills are intentionally lighter at 76%/86% opacity; blur and expensive animation remain disabled so the readability improvement does not restore the original webOS performance cost.

`tvFocus.ts` owns directional keyboard/remote movement within the mounted PTV shell, chooses the nearest candidate geometrically, scrolls the target into view, restores route-local focus, and maps supported back keys to browser history. Activation normalizes Enter, Select, OK, and Accept plus legacy select key codes 13, 23, and 66. Back handling recognizes webOS 461 and Tizen 10009. The portal-owned primary dropdown consumes those semantics exactly once, wraps arrows, focuses the first/last option appropriately, closes on Back, restores the trigger, and preserves pointer activation. TV mode disables desktop hover expansion; focus is the authoritative interaction state. Native routes include Home, Movies, Shows, Details, Music, Reading, Requests, and PTV dashboard paths, including legacy Reading aliases. Jellyfin-owned video playback remains outside this ownership boundary.

`scripts/ptv-webos.mjs` is an operational wrapper around installed LG `ares` tools, not an application packager or runtime dependency. Device, application ID, and package path are always explicit; input validation rejects shell metacharacters, dry-run shows the exact command, and the wrapper never guesses an app ID, IPK, or target. Packaging/signing stays with the host webOS application project outside this repository. Discovery and dry runs are safe verification; install, launch, close, inspect, and log attachment still require deliberate access to a configured physical device.

Physical-device evidence remains authoritative. Browser unit, style-contract, and Playwright viewport coverage can prove deterministic classification and geometry, but cannot certify firmware-specific webOS/Tizen engines or native wrapper key dispatch. A frontend deployment and cache/service-worker refresh are required before retesting the supplied LG failure cases.

### 2026-07-19 Media Identity, Remote Diagnostics, And Artifact Boundary

Media-version normalization, TV activation, and remote diagnostics share one rule: normalize equivalent platform signals at a narrow boundary, but retain conflicts and authority distinctions that affect real behavior. ID/signature aliases cannot erase hard technical conflicts while exact-path equality remains authoritative; remote key aliases cannot dispatch an action twice; and a diagnostics client cannot cross its authenticated owner/session boundary.

Remote diagnostics adds a coupled frontend/plugin contract without changing the persistent plugin configuration schema or writing captured reports to disk. The plugin advertises the capability explicitly, holds only bounded ephemeral coordination state, and applies authentication/administrator checks at the controller boundary. The frontend performs no collection until that capability and a valid bounded lease are both present.

### 2026-07-20 Reading Cache v5 And Consolidation Boundary

Reading home cache schema v5 separates complete home data from summary data. A complete entry is scoped by server, user, route kind, view, and resolved library-set identity; a v5 route-scope pointer permits a cold session to find only that matching complete persistent entry. Summary entries cannot occupy or replace the complete-cache tier.

Cache precedence is strict: fresh complete memory, fresh complete persistent data, stale complete persistent data, summary only when no complete cache is available, then network/background refresh. Stale complete data stays complete in the view model and exposes `cacheDiagnostics.staleHit`; it is retained until a matching refreshed complete result replaces it. Unscoped identities and route/library-set mismatches never render. V4 Reading-home entries are outside the v5 keyspace and are never read.

This correction is a transitional `PTVCache` contract, not a second cache framework. Future Movies, Shows, Music, Reading, Live TV, and dashboard data work must adopt the shared cache identity and precedence contract rather than copy this implementation. The architectural next step is the consolidation program above; it must replace duplicate services through adapters and tests, not through another series of isolated feature fixes.

### 2026-07-20 Library Root Normalization Boundary

`src/ptv/services/libraryRootNormalizer.ts` is the shared in-memory library identity boundary for Search and Browse result sets. It never filters by a physical filesystem root and makes no API requests. Jellyfin item ID is the primary deduplication key, followed by `PresentationUniqueKey`, then a normalized-path hash; item names alone are never used to remove a result.

Logical library roots prefer collection metadata and Jellyfin library identity. When only a path is available, known media-root segments normalize mergerfs, bind-mount, SMB, and Windows forms such as `/media/Movies`, `/media-local/Movies`, `/mnt/L/Movies`, `\\server\\share\\Movies`, and `D:\\Movies` to `Movies`. Diagnostics retain the normalized group, associated library IDs, and observed physical roots for administrators. If Jellyfin itself omits an item from a path-agnostic `Users/{user}/Items` search response, the frontend reports that upstream omission rather than inventing a root-specific fallback request.

The Remote Diagnostics dashboard crash root cause was a malformed client summary reaching render with `clientId` undefined. In the production bundle, `piggietv.12241ad2fb988bb07373.chunk.js:1:8902` was the minified `client.clientId.slice(-8)` formatter call and `:1:14043` was the surrounding `clients.map(...)` callback. No source map file was present in `dist`, so future triage should first check source-map availability and then use exact minified offsets against the built chunk when maps are absent.

Repository outputs now have an explicit ownership split. `src/ptv/plugin/bin` contains exactly the five intentional deployment artifacts and remains tracked. Nested `bin`/`obj` under plugin projects/tests, `.dotnet-home/`, the Vite result cache, and split-development logs/PID are rebuildable machine-local output and remain ignored/untracked. Production `dist` output is still deployment output rather than source. Older handoff instructions to restore those generated files are superseded.

Project-memory documents are part of the delivery boundary. `HANDOFF.md` records continuation and live verification, `PROJECT_STATE.md` records the authoritative current ledger, and `ARCHITECTURE.md` records durable ownership and security boundaries. Every completed project prompt reconciles all three before completion is reported.

The final local gate passed 58/58 targeted frontend tests, 20/20 plugin tests, TypeScript/build checking, changed-source ESLint, webOS Stylelint, the plugin contract, production Webpack, and whitespace validation. The remaining evidence boundary is authenticated coupled deployment plus physical LG/webOS and broader TV verification; live state-changing `ares` commands were intentionally not exercised.

### 2026-07-20 Bounded Movie Search Recovery

- Native global Movie search remains an authenticated, path-agnostic `GET Users/{user}/Items` request using `SearchTerm`, `IncludeItemTypes=Movie`, `Recursive=true`, and the normal 14-result limit. It does not send a filesystem root, `ParentId`, or administrator-only parameter.
- Only when that primary Movie result is underfilled (or normalized diagnostics show divergent physical roots) PTV consults the existing authenticated `GET Users/{user}/Items/Latest` Movie route with a bounded 96-item candidate window. Candidates are cached in memory for two minutes by server, user, media type, and field profile, share concurrent work, and are filtered locally by normalized title, original title, sort title, production year, then path basename.
- Recovery is deliberately unavailable to every non-Movie group, never bypasses Jellyfin authorization, never queries storage/database state, and is cancelled at the search consumer when the user changes query. The merge deduplicates in ID, provider identity plus media type, presentation key, then normalized logical-relative-path order before applying the visible limit.
- Search diagnostics expose recovery trigger/reason, candidate and match counts, source cache, primary/supplemental duration, raw `TopParentId` evidence, normalized roots, and abort/timeout state.

## Store webOS wrapper inspection boundary

LG Developer Mode device connectivity does not imply inspectability of store-installed applications. On the connected 70UN7070PUA, ares can read system information, but the tv profile cannot enumerate the store Jellyfin package, use shell/log commands, or attach Web Inspector to org.jellyfin.webos.

Physical provenance must therefore come from one of two explicit boundaries: an inspectable developer-signed wrapper loading the same frontend, or embedded privacy-safe production diagnostics that report build, service worker, profile/classes, shell/route ownership, bounded node geometry, and focus state. Neither path should silently replace the actual store-wrapper acceptance test.

Installing or launching a development wrapper changes the device test boundary and requires deliberate approval. Until then, source-supported asset attribution is not enough to select a CSS fix.

## Shell banner asset ownership on physical webOS

The native shared shell currently uses the complete banner-light artwork as its brand image. That asset contains the emblem, PiggieTV wordmark, and Powered by Jellyfin text; it is not media hero title art. PTVShell renders it under ptv-shell-brand, while presentation profiles are responsible for bounding the image independently of Home hero geometry.

The 2026-07-22 physical photo proves the banner escaped its intended shell-safe bounds. This narrows component ownership but not the runtime root cause. A missing or stale TV stylesheet, absent profile marker, unsupported base clamp sizing, or a later winning declaration remain materially different fixes. The physical runtime build, classes, computed styles, and source order must decide among them before changing CSS.

Shell branding should eventually use a compact header-appropriate asset or robust literal fallback dimensions, but that architectural choice must not be committed as a physical fix until the loaded bundle and winning rules are known.

## Physical webOS provenance before layout correction

Physical TV layout failures require bundle and ownership provenance before source changes. The inspection order is: loaded frontend build and service worker; runtime/profile classes over lifecycle; shell, hero, branding, shelf, and legacy DOM ownership; final production CSS source order and winning declarations; geometry; then focus graph behavior. Viewport or coarse-pointer emulation cannot establish these facts.

The webOS performance profile may simplify effects but must not own or collapse Home geometry. Shell branding, media hero title art, login branding, and legacy Jellyfin branding are separate owners and must remain distinguishable in markup and bounds. Do not add viewport-only TV classification or repeated important rules to compensate for an unidentified old bundle, mixed chunks, stale service worker, or leaked component.

The 2026-07-21 physical failure remains unmodified because no physical ares target was available. A source correction is permitted only after the same LG runtime proves its build, profile, DOM owner, and winning CSS.

## ItemFields boundary automated validation

The generated ItemFields request boundary has direct regression coverage for unsupported-token removal, case-insensitive canonicalization, deduplication, all-invalid omission, and preservation of unrelated query parameters. Coordinated Items coverage runs beside it to protect the shared request path. TypeScript and production Webpack validate that the deep generated SDK model import is compatible with both compile-time and production bundle resolution.

The completed automated gate establishes code and bundle correctness only. Server binder logs under representative traffic remain the operational contract proof, while database locks, endpoint latency, authentication persistence, and hardware focus remain separate release dimensions.

## ItemFields boundary verification scope

Post-deployment server evidence must distinguish contract validation from backend health. The generated-enum ItemFields boundary is considered observed when representative request URLs contain only valid enum members and the server records no comma-delimited field conversion failures. The 2026-07-21 restart sample satisfies that condition for three Latest/Resume requests.

A clean short sample cannot retire an earlier database-lock failure unless it exercises the same write path under representative concurrency. Playback progress, user-data commits, broad browse routes, and sustained load remain separate acceptance dimensions. Static-file WebRootPath warnings are deployment evidence and must not be conflated with API/database latency without a demonstrated causal path.

## Generated ItemFields Request Boundary

src/ptv/api/client.ts is the enforcement boundary for Jellyfin Fields query parameters. It derives the accepted values from @jellyfin/sdk/lib/generated-client/models/item-fields, accepts comma-delimited or array input, maps case-insensitively to canonical enum spelling, removes duplicates, drops unsupported tokens, and omits Fields when none remain. Response DTO properties such as ImageTags, ProductionYear, Container, SeriesId, and UserData must not be treated as requestable ItemFields merely because Jellyfin may return them.

Module field profiles remain presentation and payload-intent adapters; they are not compatibility authorities. New API paths must use getPtvApiUrl, requestPtvJson, or sendPtvJson rather than constructing unsanitized PTV Jellyfin URLs. The boundary deliberately leaves all non-Fields query parameters unchanged.

Server latency remains outside this boundary. The 2026-07-21 log proves a SQLite playback user-data commit lock and broad slow endpoint responses. Frontend coordination can reduce amplification, but it must not hide backend lock failures by increasing scenario or request timeouts.

## Items latency and request-ownership rule

Exact concurrent read identity is a transport-lifecycle concern, not a reason
to create a response cache or another Core API boundary. Legacy consumers that
need the same authenticated GET must use the shared request coordinator with a
server/user/operation identity, preserve the original promise value/error, and
allow a fresh request after settlement. DOM observers, route refresh, and
Back/Forward must not create page-local in-flight maps or independently ignore
an already-running shared promise.

Latency ownership is separated from amplification. If equivalent PTV shared,
Jellyfin ApiClient, direct browser, and direct-listener requests have aligned
completion/header timing and transfer is negligible, pre-header delay belongs
upstream of frontend transport. That proves the layer boundary, not the exact
database, plugin, filesystem, or host component. Assigning a deeper owner
requires timestamp-correlated server logs and bounded host/database evidence.
Absent that access, record the component as not observed and retain the
production HOLD; never compensate by raising timeouts or adding stale success.

### 2026-07-20 Movie Search Primary-Outcome Recovery

- Primary Movie search is now represented as an explicit `success`, `timeout`, `error`, or `aborted` outcome before recovery eligibility is evaluated. A timeout, recoverable request error, or successful zero-item response can use the same bounded authenticated Latest Movies candidate route; aborts and 401/403 authorization failures cannot.
- Diagnostics retain `primaryStatus`, primary error text and duration, recovery trigger/reason, supplemental status and duration, candidate/match counts, cache source, and final count. A successful recovery renders normal Movie cards while retaining degraded primary evidence for administrators.
- The initial grouped-search request now carries only card/render fields. Path, provider IDs, presentation key, sort/original title, and raw parent identity are requested only by the bounded Movie recovery route. The existing priority queue remains capped at two active requests, promotes Movies/Shows/Collections first, and commits each completed group independently.

### 2026-07-20 Search Recovery Latest-Response Normalization

- `getPtvRecentlyAddedResult` is now the shared authenticated Latest helper for consumers that need request and response diagnostics. It builds `Users/{user}/Items/Latest` with only cleaned caller parameters, normalizes both raw-array and `{ Items, TotalRecordCount }` responses, and marks malformed shapes as invalid rather than treating a wrapper as a candidate.
- Movie recovery calls that shared builder in explicit unscoped mode: `IncludeItemTypes=Movie`, `ParentId` omitted, `Limit=96`, `GroupItems=false`, user data enabled, and a Primary image request. Its diagnostics include the sanitized request contract, response shape/keys/raw count/total, up to 20 title/ID/TopParent/year/date/logical-root samples, and matched names.
# 2026-07-20 Movie Search Catalog Recovery

Movie recovery no longer samples `Items/Latest`. `movieSearchCatalog.ts` owns a server-and-user-scoped, authorized `Users/{user}/Items` catalog with unscoped `Movie`, `Recursive=true`, newest-first 500-item lightweight pages, a five-minute memory TTL, shared in-flight page requests, cached hydrated matches, and bounded foreground advancement. It reuses `libraryRootNormalizer` identity rules so root aliases merge while same-title distinct movies remain distinct.

`searchPtvItems` emits primary Movie results before catalog recovery completes. The native search page retains those cards with a small catalog-search status, then merges only hydrated catalog matches. Catalog diagnostics expose endpoint, ParentId, sort, page, cache, match location, and hydration metrics.
# 2026-07-20 Rolling Diagnostics Storage

Persistent PTV diagnostics now use one `ptv-diagnostics.log` JSONL stream in the plugin configuration directory. `PtvRollingDiagnosticsWriter` is the only disk diagnostics writer: it owns a bounded queue, one consumer, duplicate suppression, check-in/performance aggregation, five rotating files, 25 MB active-file rotation, 14-day cleanup, and capped total retention. The existing featured-content cache remains a separate single atomic cache document.

Remote check-ins and accepted sanitized reports enter the writer asynchronously. The storage API and dashboard expose status, downloads, rotation, explicit-confirmation clearing, and safe legacy consolidation. Legacy cleanup matches only verified PTV filename patterns and never selects plugin settings, featured cache, Reading overrides, or unknown files.

## Authenticated validation architecture update (2026-07-21)

### Artwork boundary

`src/ptv/api/images.ts` is the shared artwork request boundary. Candidate image types are derived from advertised Jellyfin `ImageTags`; PTV does not probe image types that Jellyfin did not claim exist. Failed source identity is independent of dimensions and request variants, preventing repeated requests for the same failed image. A missing advertised image is classified as stale server artwork metadata when the fallback renders, not as a route failure.

The validation model records four separate outcomes:

- functional route or behavior failure
- expected or stale missing artwork
- exhausted fallback chain with a broken visible image
- duplicate or unnecessary artwork request

### Browse and shell ownership

Browse route identity is path-based, with legacy query compatibility retained. Scope resolution is keyed by media kind and scope alias, so focused sibling routes reuse the mounted native shell. Movies and Shows may replace their landing layout once when entering focused browse mode; sibling focused routes do not remount it. Music and Reading keep their shell across all module subroutes. Preferences owns a single compatible shell and no longer creates horizontal overflow.

### Authorization ownership

Non-administrator consumers do not issue speculative requests to administrator-only plugin settings, row configuration, or Reading correction endpoints. Browser-safe cached data remains available where appropriate. Server authorization remains authoritative: non-admin Dashboard navigation redirects to Home and protected endpoints return forbidden responses.

### Recommendation and accessibility boundaries

Music recommendation construction includes a shared de-overlap step so independently named shelves do not present the same ordered item set. Music track-art play controls and search controls expose stable accessible names without changing visual presentation.

### Validation harnesses

`scripts/ptv-authenticated-discovery.cjs` owns broad route, responsive, network, shell, accessibility, and performance discovery. `scripts/ptv-authenticated-interactions.cjs` owns stateful behavior validation. Reports contain item identifiers only and do not persist credentials, cookies, authorization headers, playback URLs, or access tokens.

The after discovery result is 23 of 23 desktop routes and four of four responsive profiles passing. The interaction result is 13 of 13 scenarios passing. Physical-device behavior and administrator-only Dashboard profiling remain separate validation responsibilities.

## Authenticated stabilization decisions (2026-07-21)

- Movies and Shows browse subroutes have one wildcard route owner. Duplicate
  exact-route ownership is intentionally avoided.
- `NativeBrowsePage` keeps its `Page` and `PTVShell` mounted across loading,
  empty, error, and populated content states. Module transitions may replace a
  shell; query/view transitions within a module must not.
- Reading series identity uses provider identifiers before collection metadata.
  Collection names remain descriptive grouping data, not canonical identity.
- Reading index queries remain image-free. Queries that render visible cards
  explicitly request image tags and required display fields. Items without
  advertised images render placeholders rather than triggering speculative
  Primary/Thumb chains.
- Authenticated non-admin access to admin routes is an authorization redirect to
  Home, not a connection failure and not a second-shell render.
- TV focus changes are applied synchronously during focus events. Browser D-pad
  validation uses the authenticated browser identity and must not mutate the
  user agent mid-session.
- Discovery treats optional missing artwork separately from functional route
  failures. Exact duplicate URLs, intentional transform variants, fallback
  attempts, and broken visible images are separate metrics.
- Warm-cache route discovery is not sufficient for release. A production gate
  also requires the authenticated interaction suite and representative cold-path
  item latency to pass.

## Authenticated Items request ownership (2026-07-21)

`src/ptv/api/items.ts` is the list-request ownership boundary. Both
`Users/{user}/Items` and `Users/{user}/Items/Resume` must use
`requestPtvJson`; consumers must not prefer raw `ApiClient.getItems` or
`getResumableItems`, because that bypasses shared in-flight coordination.

The coordinator coalesces exact concurrent requests. It is not a response cache,
does not broaden authorization, does not alter query parameters, and does not
claim network cancellation. Route-generation/load-owner checks remain
responsible for suppressing stale commits and for avoiding new background work
after ownership is retired.

Home recommendation quality hydration is a background consumer of the Items
boundary. It must check its load owner immediately before dispatch so an old Home
generation cannot compete with Movies, Shows, Search, Music, or Reading after
navigation. Mounted Home behavior and quality fields remain unchanged.

This boundary fixes frontend amplification but does not define a Jellyfin
latency SLO. Browser, direct, and `ApiClient` benchmarks show time-before-headers
dominance and severe remote variance even after duplicate elimination. Do not
add larger UI timeouts, a second response cache, mount-specific queries, or a
frontend database workaround. Server/database/plugin/proxy changes require
read-only evidence first, explicit approval, and a rollback plan.
## 2026-07-21 Jellyfin ItemFields compatibility boundary

`UserData` is a response object, not a portable Jellyfin `ItemFields` enum
member. PTV request builders must never place `UserData` in the comma-separated
`Fields` parameter. Routes that need favorite, played, or resume state obtain it
through Jellyfin's normal user-scoped response and `EnableUserData` behavior.

This boundary applies to shared item field profiles and module-local Books,
Music, search/recommendation, browse, cache-refresh, and hydration queries. It
does not prohibit preserving `item.UserData` in typed models or bounded caches.
Keeping the response object and requesting it as an `ItemFields` value are
separate concerns.

The server-side model-binding exception is proven evidence for this contract
correction. It is not evidence that all remaining successful-request latency is
fixed; prior high time-to-first-byte samples still require server/host evidence
and clean authenticated reruns.
## 2026-07-21 ItemFields boundary validation

Live browser evidence confirms the `ItemFields` boundary is active: 44 recent
`Items` requests contained no `UserData` field token. This validates request
serialization, not endpoint latency or backend health. Eighteen Resource Timing
entries exposed HTTP 200 and the remaining entries did not expose status data;
none exposed an error status.

Cold-route validation on the shared development browser has an independent
authentication-restoration limitation. Webpack Dev Server's overlay iframe must
be excluded from geometry evidence because it is not a production surface and
alone widens the document by the scrollbar width. Even with that contaminant
prevented, a cache-disabled reload did not restore the same authenticated API
client within 30 seconds. Do not relabel a warm in-memory navigation pass as a
cold pass, and do not replace the required identity to manufacture evidence.
## PTV Core Phase 1.5 Runtime Adoption

Web, Android mobile, and Android TV now enter the shared ten-step PTV Core
initializer from their production composition roots. Runtime adapters snapshot
existing settings/session/API state, report capabilities and diagnostics, and
acknowledge existing navigation/playback owners without replacing them.
Initialization is shared across concurrent/repeated entry and keyed listener
registries prevent hot-reload or Activity recreation duplication.

The first envelope migration is the Reading/Music library-index IndexedDB
boundary. Its database/store/keys and legacy record reader remain; v1 writes
add scope/version/expiry/stale metadata and reads handle current, legacy,
corrupt, mismatched, expired, and opt-in stale records. The plugin
recommendations response boundary now uses the v1 casing/default/score
normalizer without replacing Row Builder or its engine.

Android contract parity is enforced by generated normalized manifests compared
across both repositories and against `contracts/ptv-core/v1`, with required
schema-field validation. Raw source equality is supplementary. This is partial
adoption: credential/login, route/focus execution, playback engines, Android
Auto, notifications, lock-screen controls, featured cache v7, and other cache
or recommendation boundaries remain legacy.

## F3 Collections ownership boundary

Premium Collections extends the native browse route, shared item/request APIs, `currentSettings`, item router, image pipeline, diagnostics, and global focus graph. The lazy F3 module owns only Collection normalization, explicit relationship resolution, bounded source composition, Collection preferences, and presentation. It does not own routing, requests, caching, playback, metadata, settings transport, feedback storage, or focus. See [docs/collections/phase-f3-premium-collections.md](docs/collections/phase-f3-premium-collections.md).

## F3A2 validation boundary

Phase F3A2 adds credential-blind authenticated Collections evidence tooling only. It attaches to the existing browser, router, request coordinator, ApiClient, runtime, settings, and focus owners; it does not create a product runtime or transport owner. Exact request identities are hashed in memory, failed-request handoff is separated from concurrent duplication, and persisted evidence rejects URLs, private addresses, credentials, identifiers, titles, and local paths. See `docs/collections/phase-f3a2-authenticated-latency-recovery.md`.
