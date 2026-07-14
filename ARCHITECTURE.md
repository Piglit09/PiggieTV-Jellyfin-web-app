# PiggieTV Architecture

Current as of 2026-07-13.

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
  -> Jellyfin.Plugin.PiggieTV (net9.0, plugin version 10.11.8.1)
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

## Validation Boundaries

The current repository uses:

- Vitest for frontend unit/regression tests
- TypeScript `--noEmit` checks
- ESLint and Stylelint
- Webpack production builds
- `dotnet build` for the companion plugin

Local automated validation cannot prove authenticated Jellyfin behavior, live Google Books/ComicVine application, restart persistence, Fire TV input, or real-device responsive behavior. Those remain deployment checks.

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

| Date | Change |
| --- | --- |
| 2026-06-16 | Initial repository architecture snapshot. |
| 2026-06-17 | Added recommendation persistence, source fallback, and diagnostics architecture. |
| 2026-07-13 | Consolidated the singleton runtime, shared shell, cache v7, current routes, plugin API, and Reading metadata/grouping architecture into one current document. |
