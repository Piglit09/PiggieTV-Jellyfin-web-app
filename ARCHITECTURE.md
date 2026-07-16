# PiggieTV Architecture

Current as of 2026-07-14.

This document describes the architecture present in the current worktree. It records stable boundaries and ownership. Use `PROJECT_STATE.md` for delivery state, `HANDOFF.md` for continuation instructions, and `DEBUG_LOG.md` for issue history.

## System Boundary

PiggieTV is a native experience embedded in Jellyfin Web. It adds its own shell, routes, pages, caching, playback surfaces, diagnostics, and an optional Jellyfin server plugin while retaining Jellyfin authentication, libraries, item APIs, playback, and fallback pages.

```text
Browser / TV client
  -> Jellyfin Web 10.11.11
  -> PiggieTV frontend under src/ptv
       -> Jellyfin ApiClient and item APIs
       -> PiggieTV plugin API under /Ptv/v1
       -> browser memory/local storage caches

Jellyfin server
  -> Jellyfin libraries, users, playback, and metadata providers
  -> Jellyfin.Plugin.PiggieTV (net9.0, plugin version 10.11.8.2)
       -> featured cache v7
       -> settings and Row Builder persistence
       -> integrations and signup services
       -> Google Books proxy search
       -> durable Reading series overrides
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
| Shell services | `src/ptv/services`, `src/ptv/shell` | Notifications, performance, route lifecycle, global media dock |

## Home And Recommendation Data

Home composes Jellyfin resume/latest data, featured cache data, persisted recommendation rows, and explicitly configured Row Builder rows. Recommendation Settings is authoritative for generated recommendation rows: only persisted, accepted, enabled rows belong in Home. Configured Row Builder rows remain a separate source and carry source/config hashes in diagnostics.

The featured-content cache schema is version 7. The browser key is `ptv:featured-content:v7`; the default TTL is 12 hours and accepted server payloads must pass version and shape validation. The cache supports memory, browser, and plugin-backed stale-while-revalidate behavior. Cache hashes prevent stale recommendation/configured rows from being mixed with current settings.

Home and browse card data should be fetched in lightweight list form and hydrated in batches only when richer fields are required. Offscreen rows should not compete with the hero and first visible shelf.

## Reading Data Path

### Discovery And Staged Loading

`src/ptv/modules/books/booksApi.ts` discovers Jellyfin book libraries and resolves the active Books, Comics, Manga, or combined Reading route. Initial work is bounded: summary/cache data is rendered first, shelf work is independent, and library pages use 50-item pages instead of a first-render full-library scan.

Reading has a separate cache boundary:

- memory cache for active data
- local-storage home cache schema version 4
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
| Integrations | status, Seerr, Sonarr/Radarr/Lidarr/Prowlarr tests, calendar, downloads, tags, random items |
| Signup | create user, verification, password reset, admin settings/invites |

Mutating settings, featured content, and Reading series overrides require the plugin's write/admin authorization checks. Secrets belong in plugin configuration and must never be returned in diagnostics or persisted in frontend caches.

The frontend and plugin are a coupled deployment for features that depend on new API contracts. A frontend-only deployment will fall back where possible, but durable Reading overrides and native Google Books search require the matching plugin build and a Jellyfin restart.

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

## Validation Boundaries

The current repository uses:

- Vitest for frontend unit/regression tests
- TypeScript `--noEmit` checks
- ESLint and Stylelint
- Webpack production builds
- `dotnet build` for the companion plugin

`src/ptv/core/config.ts` must remain importable outside Webpack. Its development-server check uses `typeof __WEBPACK_SERVE__ !== 'undefined'` before reading the compile-time constant; direct access breaks Vitest and other Node-based consumers.

The final 2026-07-14 browse audit verified 36 Vitest files/283 tests, including 6 focused browse/route/directory files with 37 tests. TypeScript and the production Webpack build pass; Webpack compiled in 184.232 seconds and emitted only the established aggregate asset/entrypoint size warnings. The new standalone/data files lint clean. `NativeBrowsePage.tsx` retains its committed 17-error/2-warning ESLint baseline, `PTVShell.tsx` retains its committed 26-error/1-warning baseline, and `nativeBrowse.scss:492` retains the same selector-order Stylelint baseline at HEAD and in the worktree. `git diff --check` and the changed-file secret/private-data scan pass. No plugin source or API contract changed, so the companion plugin was not rebuilt for this frontend-only correction.

The current development server at `http://localhost:8080/` returns HTTP 200 and serves a bundle containing the current shell mount attribution and **Studios & Networks** label. This proves the newest local bundle is being served, not authenticated Jellyfin route behavior. The live role/debug matrix, real-library counts, history/scroll restoration, and touch/TV behavior remain deployment checks.

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
| 2026-07-15 | Established plugin `10.11.8.2` as the first release advertising durable Reading series overrides, with assembly-derived runtime identity, manifest/contract verification, and capability-aware frontend compatibility. |
| 2026-07-15 | Deployment verification exposed and corrected plugin configuration XML serialization, production runtime entry ownership, authenticated plugin-client readiness, and base-path-safe service-worker registration. The corrected candidate pair is locally healthy; permanent web-root deployment and the real 1,818-item Manga completion run remain external deployment gates. |
| 2026-07-15 | Made drawer edge-swipe listener ownership lifecycle-safe: missing authentication handles fail closed, exact bound targets are retired, replacement handles rebind once, and page-show reconciliation no longer depends on a page-type change. |
| 2026-07-15 | Corrected split-origin development discovery with explicit `PTV_DEV_JELLYFIN_URL` precedence and stale plugin-root retirement. Restricted shell geometry to PTV-owned containers so native Jellyfin page hosts no longer insert a viewport spacer ahead of Home, Reading, or Dashboard. |

### Plugin Release Compatibility Boundary

Plugin `10.11.8.2` is the first release in this line that advertises durable `readingSeriesOverrides`. `PtvPluginVersion` in the plugin project is authoritative; assembly/file metadata and runtime status derive from the built assembly, while source and published `meta.json` files are contract-checked against it. Plugin API v1, featured cache schema v7, Jellyfin package target `10.11.8`, and manifest target ABI `10.11.8.0` are independent compatibility axes and must not be patch-bumped with the plugin.

The frontend evaluates transport compatibility and feature capability separately. Plugin `10.11.8.1` without `readingSeriesOverrides` remains connected but cannot claim server-persisted Reading corrections; reads may use browser cache and writes request a plugin upgrade. Plugin `10.11.8.2` with the advertised feature is compatible. The dashboard shows this distinction without creating a second runtime or treating cache fallback as server persistence.

The release payload is the five-file `src/ptv/plugin/bin` publish output. Replacing the DLL/manifest requires a Jellyfin restart before deploying the matching frontend behavior.

### Deployment Runtime Boundary

Plugin configuration cannot serialize `ReadingSeriesOverrideSettings.Routes` as a nested dictionary through Jellyfin's XML serializer. The runtime model therefore keeps the dictionary out of XML and exposes a deterministic persisted route-list surrogate that reconstructs case-insensitive route and item maps. JSON/status behavior continues to use the runtime dictionary. A configuration round-trip test protects this boundary.

The production Jellyfin-web entry imports `ptv/core/app` exactly once so the canonical PiggieTV runtime exists outside the development-only entry path. Plugin API consumers obtain the current authenticated Jellyfin API client through the shared readiness boundary; concurrent startup reads remain endpoint-deduplicated and do not issue pre-authentication requests. Dashboard diagnostics consume that singleton and never create a diagnostic runtime.

Service-worker registration uses a path-relative `serviceworker.js` URL. This resolves to `/web/serviceworker.js` when Jellyfin is hosted under `/web` instead of incorrectly requesting a server-root asset. Update deferral during playback and unsaved workflows remains owned by `updateService`.

The 2026-07-15 local deployment candidate verified plugin `10.11.8.2`, API v1, cache v7, `readingSeriesOverrides=true`, healthy cache/status, authenticated override GET/PUT for books/comics/manga/reading, and persistence across a clean Jellyfin restart. The installed plugin directory and web root were backed up before replacement and those backups must be retained until production sign-off. The permanent Jellyfin web root was not replaced because the current process lacked the required filesystem permission; the matching production `dist` was served through Jellyfin's explicit web-directory option for verification only.

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
