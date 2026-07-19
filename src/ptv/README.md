# PiggieTV Source Map

This folder contains the PiggieTV native frontend, shared UI system, Jellyfin API wrappers, and the PiggieTV Jellyfin plugin source. Use this map as the label sheet for tracking edits.

Generated plugin output and static assets are intentionally not documented file-by-file. Avoid hand-editing `plugin/bin`, `plugin/obj`, PNGs, and SVG icon files unless the task is specifically about build output or assets.

## First Places To Check

| Label | Path | What It Controls |
| --- | --- | --- |
| App bootstrap | `index.js` | Starts PiggieTV and connects it to the Jellyfin web runtime. |
| Shell startup | `core/app.js` | Initializes core services, shell state, modules, lifecycle cleanup, and theme/profile hooks. |
| Route table | `shell/routes.js` | Registers hash routes and lazy-loaded page targets. Check here when a page does not mount. |
| Route controller | `shell/routeController.ts` | Converts hash/location into route id, page type, and mounted component behavior. |
| Navigation helpers | `shell/navigation.ts` | Central helpers for moving between PTV pages without stock Jellyfin route drift. |
| Native Home | `pages/home/NativeHome.tsx` | Main PiggieTV Home render pipeline, hero, rows, cache usage, and deferred loading. |
| Music page | `modules/music/musicPage.tsx` | Main Music UI state machine: home, library, artist, album, playlist, and now-playing views. |
| Music API | `modules/music/musicApi.ts` | Jellyfin music library detection, paged artist/album/track fetches, and metadata normalization. |
| Reading page | `modules/books/booksPage.tsx` | PTV Reading library page for books, comics, and manga views. |
| Reading API | `modules/books/booksApi.ts` | Jellyfin reading library detection, paged item fetches, kind classification, and row building. |
| Reader app | `modules/reader/ReaderApp.tsx` | Book/comic/PDF reader shell and active reader state. |
| Reader toolbar | `modules/reader/ReaderToolbar.tsx` | Top reader controls, labels, and button actions. |
| Recommendations engine | `modules/recommendations/engine/recommendationEngine.ts` | Creates recommendation output from provider data, taste profiles, scoring, and row rules. |
| Recommendation rows | `modules/recommendations/rows/recommendationRows.ts` | Converts engine output into Home/Hub/Music/Reading row structures. |
| Recommendation settings | `modules/recommendations/recommendationSettings.ts` | Per-user/server settings for enabled recommendation rows. |
| Dashboard home | `modules/dashboard/PiggieTvDashboardPage.tsx` | PTV admin dashboard landing page and dashboard cards. |
| Row builder | `modules/dashboard/PiggieTvRowsPage.tsx` | User-created row settings and recommendation row toggles. |
| Plugin API backend | `plugin/Jellyfin.Plugin.PiggieTV/Api` | Jellyfin plugin HTTP endpoints. |
| Plugin services | `plugin/Jellyfin.Plugin.PiggieTV/Services` | Server-side cache, settings, signup, refresh, and metadata work. |

## Routing Blocks

| Label | Path | Edit Notes |
| --- | --- | --- |
| Route definitions | `shell/routes.js` | Add or fix user-facing hash routes here. Match the exact working pattern of nearby routes. |
| Async page loading | `shell/routes.js` | Lazy imports live beside route definitions. If a route shows fallback/dashboard instead of the expected page, check import path and route id here. |
| Route diagnostics | `shell/routeController.ts` | Route id, page type, and debug labels come from this layer. |
| Shell overlays | `shell/overlays.js` | Controls overlay surfaces that sit above page content. |
| Foundation mount | `shell/foundation.ts` | Shared shell foundation helpers used by native PTV routes. |

When adding a route, update the route table, any drawer/card navigation target, and the route id/page type diagnostics together.

## Native Home Blocks

| Label | Path | Edit Notes |
| --- | --- | --- |
| Home component | `pages/home/NativeHome.tsx` | Main render state, cache-first loading, row ordering, debug fields, and interaction timing. |
| Home hooks | `pages/home/hooks.ts` | Reusable Home data hooks and route-aware helpers. |
| Home section helpers | `pages/home/homesections.js` | Legacy-compatible section construction. |
| PTV row helpers | `pages/home/ptvRows.js` | Row type matching and PTV-specific row generation helpers. |
| Native Home styles | `pages/home/nativeHome.scss` | Home hero, rows, side links, mobile layout, and performance-sensitive visual styles. |
| Brand matchers | `pages/home/rowMatchers` | Row/category matching for branded collections such as Disney/media brands. |

Home should render from fresh plugin cache first, then refresh/defer slow Jellyfin work in the background.

## Music Blocks

| Label | Path | Edit Notes |
| --- | --- | --- |
| Music route entry | `modules/music/index.ts` | Exposes the Music module to the PTV router/module loader. |
| Music data API | `modules/music/musicApi.ts` | Fetch full library counts and paged Jellyfin data. Watch for limits, filters, and metadata fallback order. |
| Music UI shell | `modules/music/musicPage.tsx` | Owns Music navigation, Library/Artist/Album/Playlist views, debug panel, and view-specific rendering. |
| Now playing UI | `modules/music/musicPage.tsx` (`PlayerView`) | Authoritative current-song player, queue, controls, backdrop, lyrics, and progress UI. |
| Playlist modal | `modules/music/musicPlaylistModal.tsx` | Add-to-playlist and quick-create dialog. |
| Playlist storage | `modules/music/musicPlaylists.ts` | User/server scoped playlist persistence. |
| Liked songs | `modules/music/musicLikes.ts` | User/server scoped liked songs list and favorite state. |
| Queue helpers | `modules/music/musicQueue.ts` | Queue persistence and track ordering helpers. |
| Music recommendations | `modules/music/musicRecommendations.ts` | Music-specific adapter for recommendation rows and liked-song influence. |
| MusicBrainz lookup | `modules/music/musicBrainz.ts` | MusicBrainz metadata enrichment helpers. |
| Discogs lookup | `modules/music/musicDiscogs.ts` | Discogs metadata enrichment helpers. |
| Music types | `modules/music/musicTypes.ts` | Shared Music item, debug, playlist, and view types. |
| Music styles | `modules/music/music.scss` | All Music page layout and control styling. Check here for clipped titles, icon button collisions, and mobile layout issues. |

For missing artists or album art, start in `musicApi.ts` normalization before changing card rendering.

## Reading And Library Blocks

| Label | Path | Edit Notes |
| --- | --- | --- |
| Reading route entry | `modules/books/index.ts` | Exposes PTV Reading routes. |
| Reading API | `modules/books/booksApi.ts` | Fetches books/comics/manga with paging, classifies item kind, and builds Reading rows. |
| Reading page | `modules/books/booksPage.tsx` | Renders Books, Comics, Manga, and unified Library views. |
| Reading types | `modules/books/booksTypes.ts` | Shared reading item, route, debug, and row types. |
| Metadata providers | `modules/books/booksMetadataProviders.ts` | Provider enrichment labels for Google Books, Open Library, and Comic Vine metadata. |
| Reading styles | `modules/books/books.scss` | Reading library hero, tabs, cards, and mobile layout. |

If Books, Comics, and Manga show identical content, check item kind classification and route stale-data guards in `booksApi.ts` and `booksPage.tsx`.

## Reader Blocks

| Label | Path | Edit Notes |
| --- | --- | --- |
| Reader shell | `modules/reader/ReaderApp.tsx` | Reader state, selected item, provider handoff, and view mounting. |
| Reader view | `modules/reader/ReaderView.tsx` | Actual page/canvas/text presentation. |
| Reader toolbar | `modules/reader/ReaderToolbar.tsx` | Top action buttons, labels, and control visibility. |
| Settings panel | `modules/reader/ReaderSettingsPanel.tsx` | Reader appearance/settings controls. |
| Settings store | `modules/reader/readerSettingsStore.ts` | Persisted reader settings. |
| Progress store | `modules/reader/readerProgressStore.ts` | Persisted reading progress. |
| Repository | `modules/reader/readerRepository.ts` | Reader item lookup and local state coordination. |
| Source resolver | `modules/reader/sourceResolver.ts` | Converts Jellyfin items into reader-consumable sources. |
| Comic engine | `modules/reader/engines/comicReaderEngine.ts` | CBZ/CBR-style reading engine. |
| EPUB engine | `modules/reader/engines/epubReaderEngine.ts` | EPUB reading engine. |
| PDF engine | `modules/reader/engines/pdfReaderEngine.ts` | PDF reading engine. |
| Jellyfin provider | `modules/reader/providers/jellyfinBookProvider.ts` | Reads book files from Jellyfin. |
| OPDS provider | `modules/reader/providers/opdsBookProvider.ts` | OPDS source support. |
| Plugin provider | `modules/reader/providers/pluginMetadataProvider.ts` | Server/plugin metadata enrichment for reader items. |
| Reader styles | `modules/reader/reader.scss` | Reader layout, toolbar, page view, and responsive controls. |

Reader toolbar buttons should have distinct icons, labels, and title text so they are understandable at a glance.

## Recommendation Blocks

| Label | Path | Edit Notes |
| --- | --- | --- |
| Recommendation entry | `modules/recommendations/index.ts` | Public exports consumed by Home, Music, Dashboard, and Hub pages. |
| Settings gate | `modules/recommendations/recommendationSettings.ts` | Determines which rows are enabled per server/user. |
| Dashboard page | `modules/recommendations/RecommendationDashboardPage.tsx` | Runtime diagnostics, debug export, and manual engine visibility. |
| Hub page | `modules/recommendations/RecommendationsHubPage.tsx` | Dedicated recommendations destination for rows that should not flood Home. |
| Jellyfin provider | `modules/recommendations/providers/jellyfinRecommendationProvider.ts` | Pulls real Jellyfin library/user signals for the engine. |
| Taste profile | `modules/recommendations/engine/tasteProfile.ts` | Builds and stores per-user/server taste signals. |
| Engine | `modules/recommendations/engine/recommendationEngine.ts` | Scores candidates, dedupes rows, and produces recommendation results. |
| Scoring model | `modules/recommendations/scoring/scoringModel.ts` | Score weights, normalization, diversity, and reason generation. |
| Metadata scoring | `modules/recommendations/scoring/metadata.ts` | Metadata extraction helpers used by scoring. |
| Row adapter | `modules/recommendations/rows/recommendationRows.ts` | Converts engine results into renderable rows for Home, Hub, Music, and Reading. |
| Runtime debug | `modules/recommendations/debug/recommendationRuntimeDebug.ts` | Global route/runtime debug state. |
| Debug export | `modules/recommendations/debug/recommendationDebug.ts` | JSON debug fields for engine, provider, rows, and scoring. |
| Types | `modules/recommendations/types/recommendationTypes.ts` | Strict recommendation data contracts. |
| Styles | `modules/recommendations/recommendations.scss` | Recommendation dashboard and hub styling. |

Do not debug recommendation quality until the route mounts and `recommendationEngineLoaded` is true.

## Dashboard Blocks

| Label | Path | Edit Notes |
| --- | --- | --- |
| Dashboard module entry | `modules/dashboard/index.js` | Loads dashboard module behavior. |
| Dashboard page | `modules/dashboard/PiggieTvDashboardPage.tsx` | Admin dashboard home, cards, and navigation targets. |
| Row builder page | `modules/dashboard/PiggieTvRowsPage.tsx` | User-created rows and recommendation enable/disable settings. |
| Dashboard styles | `modules/dashboard/dashboard.scss` | Dashboard layout and visual system. |
| Admin forms | `modules/dashboard/admin-forms.scss` | Form-specific dashboard styling. |
| Admin system | `modules/dashboard/admin-system.scss` | System/status dashboard styling. |

If a dashboard card opens the wrong route, compare its navigation target with the matching route in `shell/routes.js`.

## Shared UI Blocks

| Label | Path | What It Controls |
| --- | --- | --- |
| Primitives | `primitives` | Reusable button, dialog, dropdown, form, card, overlay, table, tabs, pagination, panel, and section title components. |
| Layouts | `layouts` | Reusable admin, data table, media grid, and settings page shells. |
| Icons | `modules/icons` and `icons/ptvIcons.ts` | PTV icon registry, renderer, and icon class generation. |
| Header | `modules/header` | Top app header, brand, nav, and header actions. |
| Sidebar | `modules/sidebar` | Sidebar sections/items and sidebar styling. |
| Hero | `modules/hero` | Reusable hero component, metadata, background, actions, progress, and Home hero hooks. |
| Cards | `modules/cards` | Card overlays, metadata badges, hover behavior, layout, and quality tags. |
| Details | `modules/details` | PTV details page shell, poster, metadata, ribbons, and sections. |
| Playback | `modules/playback` | Playback chrome and playback-specific styling. |
| Media bar | `modules/media-bar` | Shared media bar behavior and styles. |

Use primitives/layouts for new dashboard-style UI before adding one-off controls.

## Core Runtime Blocks

| Label | Path | What It Controls |
| --- | --- | --- |
| Config | `core/config.ts` | PTV config constants and feature defaults. |
| Feature settings | `core/featureSettings.ts` | Client feature flags and persisted settings helpers. |
| Client profile | `core/clientProfile.ts` | Device/client capability decisions. |
| Render profile | `core/renderProfile.ts` | Render/performance profile selection. |
| Plugin API | `core/pluginApi.ts` | Frontend calls to PiggieTV plugin endpoints. |
| Images | `core/images.ts` and `core/imageManager.ts` | Image URL generation, loading, and image cache helpers. |
| Observer | `core/observer.js` | DOM observation and mutation wiring. |
| Scheduler | `core/scheduler.js` | Deferred work and animation frame scheduling helpers. |
| Performance | `core/performance.js` | Runtime performance measurements. |
| Observability | `core/observability.ts` | Structured debug/telemetry helpers. |
| Logger | `core/logger.ts` | PTV logging wrappers. |
| Lifecycle | `core/lifecycle.js` and `core/lifecycleSafety.js` | Mount/unmount cleanup and safety guards. |
| Events | `core/events.js` | Shared event bus helpers. |
| Shell scope | `core/scope.js` | PTV DOM scope detection and class handling. |
| Theme | `core/theme.js` | Theme class and skin integration. |
| Compatibility | `core/compatibility.js` | Jellyfin compatibility patches. |
| Jellyfin hooks | `core/jellyfin-hooks.js` | Integration hooks into Jellyfin web behavior. |
| URL origins | `core/urlOrigins.ts` | Server/base URL origin helpers. |

Core files should stay generic. Put feature-specific logic inside modules unless it truly affects every route.

## API Blocks

| Label | Path | What It Controls |
| --- | --- | --- |
| Client wrapper | `api/client.ts` | Shared Jellyfin API fetch wrapper and URL construction. |
| Auth | `api/auth.ts` | Current user/server auth helpers. |
| Admin | `api/admin.ts` | Admin-specific Jellyfin calls. |
| Libraries | `api/libraries.ts` | Library discovery and library metadata. |
| Items | `api/items.ts` | Generic item fetches and item helpers. |
| Images | `api/images.ts` | Jellyfin image URL helpers. |
| Search | `api/search.ts` | Search API helpers. |
| Playback | `api/playback.ts` | Playback/session API helpers. |
| Types | `api/types.ts` | Shared API response and Jellyfin item types. |
| Barrel exports | `api/index.ts` | Central exports for API consumers. |

Prefer these API helpers over direct ad hoc Jellyfin URLs in page components.

## Plugin Backend Blocks

| Label | Path | What It Controls |
| --- | --- | --- |
| Plugin entry | `plugin/Jellyfin.Plugin.PiggieTV/Plugin.cs` | Jellyfin plugin identity and configuration wiring. |
| Service registration | `plugin/Jellyfin.Plugin.PiggieTV/PluginServiceRegistrator.cs` | Registers PiggieTV services with Jellyfin DI. |
| API routes | `plugin/Jellyfin.Plugin.PiggieTV/Api/PtvApiRoutes.cs` | Shared route constants for plugin endpoints. |
| Status API | `plugin/Jellyfin.Plugin.PiggieTV/Api/PtvStatusController.cs` | Plugin health, cache status, and featured-content diagnostics. |
| Signup API | `plugin/Jellyfin.Plugin.PiggieTV/Api/PtvSignupController.cs` | Invite/signup backend endpoints. |
| Featured cache store | `plugin/Jellyfin.Plugin.PiggieTV/Services/PtvFeaturedContentStore.cs` | Server-side featured-content cache read/write. |
| Featured refresh | `plugin/Jellyfin.Plugin.PiggieTV/Services/PtvFeaturedContentRefreshService.cs` | Builds refreshed cache payloads. |
| Featured validation | `plugin/Jellyfin.Plugin.PiggieTV/Services/PtvFeaturedContentValidator.cs` | Validates featured cache payload shape and size. |
| Plugin settings | `plugin/Jellyfin.Plugin.PiggieTV/Services/PtvPluginSettingsService.cs` | Reads/writes plugin configuration settings. |
| Settings normalizer | `plugin/Jellyfin.Plugin.PiggieTV/Services/PtvPluginSettingsNormalizer.cs` | Sanitizes plugin settings. |
| TMDb metadata | `plugin/Jellyfin.Plugin.PiggieTV/Services/PtvTmdbMetadataService.cs` | Server-only TMDb metadata enrichment. |
| Signup services | `plugin/Jellyfin.Plugin.PiggieTV/Services/PtvSignupService.cs` and `PtvSignupCleanupService.cs` | Invite creation, signup flow, and cleanup. |
| Models | `plugin/Jellyfin.Plugin.PiggieTV/Models` | DTOs exchanged by plugin API and frontend. |
| Configuration | `plugin/Jellyfin.Plugin.PiggieTV/Configuration` | Plugin and signup settings objects. |

Do not edit compiled plugin output under `plugin/bin` or `plugin/obj`; rebuild the plugin source instead.

## Style Blocks

| Label | Path | What It Controls |
| --- | --- | --- |
| Global PTV styles | `styles/ptv.scss` | Main PTV style bundle import point. |
| Tokens | `styles/tokens.scss` and `styles/variables.scss` | Shared CSS variables and design tokens. |
| Base | `styles/base.scss` | Baseline PTV element styling. |
| Layout | `styles/layout.scss` | Global layout utilities and shell layout. |
| Shell | `styles/shell.scss` | Shell/root PTV page structure. |
| Header/sidebar | `styles/header.scss` and `styles/sidebar.scss` | Global shell header/sidebar styles. |
| Cards/glass | `styles/cards.scss` and `styles/glass.scss` | Shared cards and glass surfaces. |
| Dashboard | `styles/dashboard.scss` | Shared dashboard visuals. |
| Debug | `styles/debug.scss` | Debug panel styling. |
| Performance | `styles/performance.scss` | Low-cost/performance-mode visual overrides. |
| Responsive | `styles/responsive.scss` | Global responsive behavior. |
| Compatibility | `styles/compatibility.scss` | Jellyfin compatibility CSS. |
| Accessibility | `styles/accessibility.scss` | Focus, reduced-motion, and accessibility helpers. |
| Animations | `styles/animations.scss` | Shared animation definitions. |
| Themes | `themes` | Default, compact, OLED, low-fx, and theme bundle styles. |

For page-specific layout bugs, check the module SCSS first. Use global styles only when the behavior should apply across PTV.

## Small Utility Blocks

| Label | Path | What It Controls |
| --- | --- | --- |
| DOM helpers | `utils/dom.js` | Shared DOM query/class helpers. |
| Guards | `utils/guards.js` | Defensive runtime checks. |
| Icon helpers | `utils/icons.js` | Icon helper functions. |
| String helpers | `utils/strings.js` | Formatting and string normalization helpers. |
| Services | `services` | Legacy-style state, navigation, icon, backdrop, and animation services. |
| Instrumentation | `instrumentation` | Performance/debug instrumentation entry and styles. |

## Edit Patterns

### Add or fix a route

1. Add the route in `shell/routes.js`.
2. Confirm route id and page type in `shell/routeController.ts`.
3. Update drawer, dashboard card, top nav, or sidebar link targets.
4. Add a temporary mount log only while debugging.

### Add a data-backed row

1. Fetch/normalize data in the module API file.
2. Build render rows in the module page or row adapter.
3. Add user/server scoping for local storage.
4. Add debug fields for counts, dropped items, and query source.
5. Keep initial render cache-first and defer slow calls.

### Fix wrong or missing metadata

1. Start in the API normalization layer.
2. Check Jellyfin field names before adding frontend fallbacks.
3. Keep fallback order explicit.
4. Only show `Unknown` labels as the final fallback.

### Fix clipped UI

1. Check the module SCSS first.
2. Look for shared button/icon styles overriding text controls.
3. Add stable grid/flex dimensions.
4. Make long text wrap or clamp intentionally.

### Debug slow Home or library loading

1. Confirm plugin cache availability and freshness.
2. Check whether direct Jellyfin fallbacks are blocking render.
3. Add abort/timeouts for slow background work.
4. Keep expensive rows lazy and non-blocking.

## Comment Label Convention

When adding inline comments, prefer short section labels over line-by-line narration:

```ts
// Route matching: translate hash paths into PTV page ids.
// Data normalization: make Jellyfin fields safe for UI rendering.
// Cache-first render: show stored rows before background refresh.
// Debug export: collect fields used by the dashboard/debug panel.
```

Avoid comments that restate obvious code. Add comments where a future edit needs to know why the block exists or which subsystem it protects.
