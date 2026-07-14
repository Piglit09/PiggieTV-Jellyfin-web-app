# PiggieTV Project State

Current as of 2026-07-14. This is the current-state ledger, not a historical changelog.

## Repository Snapshot

| Field | Current value |
| --- | --- |
| Product | PiggieTV native experience embedded in Jellyfin Web |
| Current HEAD | `603c13d56a` (`pages`); Reading hardening source is in `71666e7d02` (`bookshelf`) |
| Jellyfin Web package | `10.11.11` |
| Node requirement | `>=20.0.0` |
| Frontend stack | React 18.3, TypeScript 5.8, Webpack 5, MUI 6, TanStack Query 5 |
| PTV frontend root | `src/ptv` |
| Plugin root | `src/ptv/plugin/Jellyfin.Plugin.PiggieTV` |
| Plugin target/version | .NET 9, `10.11.8.1` against Jellyfin packages `10.11.8` |
| Featured cache | Schema/version 7, plugin and browser stale-while-revalidate path |
| Reading home cache | Schema 4, 5-minute fresh TTL, 24-hour stale window |

The Reading implementation and its focused tests are present in HEAD history. The current worktree contains a frontend-only corrective hardening pass for shareable debug exports, query-transition lifecycle telemetry, focused-browse runtime evidence, and exact Universal Pictures server paging coverage. Generated build/test output is removed or restored after verification.

## Current Product State

### Runtime And Shell

- PTV has one guarded runtime initialized from `src/ptv/core/app.js`.
- The persistent runtime root owns the global media dock and survives route changes.
- `PTVShell` is the shared shell for native Home, Movies, Shows, Anime/Cartoons, Music, Reading, Requests, Dashboard, and settings surfaces.
- Primary and contextual navigation are route-backed and centralized in the shell/route controller.
- Item routing is centralized for PTV Music, Reading, video, and Jellyfin fallbacks.

### Home, Browse, And Recommendations

- Native Home, media browse pages, hero/card surfaces, configured rows, recommendation rows, quality tags, route diagnostics, and featured cache v7 are present.
- Recommendation Settings and configured Row Builder rows are separate row sources. Persisted accepted/enabled recommendation rows are the authoritative generated recommendation source.
- Movies, Shows, Anime, Cartoons, and Collections have native browse route ownership and contextual navigation.
- Movies and Shows now distinguish base landing routes from focused URL-addressable views. Movies support Latest, Trending, Genres/exact Genre, and Studios/exact Studio. Shows support Continue, Latest, Trending, Genres/exact Genre, Networks/exact Network, and series-scoped Seasons.
- Hash query state participates in route identity. Focused pages use structured server-side filters, 50-item paging, exact metadata-ID resolution, bounded page caching, item-ID deduplication, and stale-response suppression.
- Anime, Anime Movies, and Cartoons aliases resolve to real authenticated Jellyfin user-view IDs and fail closed when unavailable; scoped queries no longer broaden silently.

### Music And Playback

- Music Home, Explore, Artists, Albums, Songs, and Playlists routes are present.
- Queue, player, persistent dock, likes/playlists, recommendations, MusicBrainz, and Discogs integrations are present.
- Playback state is owned outside page-local route mounts so route changes do not intentionally reset an active queue.

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

- `/Ptv/v1` provides status, settings, featured cache, Row Builder, music metadata, Google Books search, Reading series overrides, integrations, tags, random item, and signup endpoints.
- Featured cache version 7 is the accepted schema.
- Frontend-only operation remains possible for Jellyfin-backed routes, but plugin-dependent features require the matching DLL and a Jellyfin restart.

### Debug Export And Performance Hardening

- Final copied/serialized dashboard exports pass through one shared recursive sanitizer. It bounds output, removes secrets/private origins/IDs/local paths/sensitive SMTP detail, replaces complete data-image/blob values, preserves safe version/build identifiers, and omits credential-shape fields without changing administrator-only live panels.
- TMDb enrichment is cache-first, validates credentials once per bounded reuse window, limits each pass to 48 remote candidates and four concurrent requests, and retains completed partial results when cancellation arrives.
- Browse section work uses an explicit priority policy and publishes each shelf independently; card-list payloads continue to use the existing lean field profile.
- Failed images advance through shared candidates and enter capped five-minute negative caches instead of retrying forever or remaining suppressed for the whole session.
- Shell mount telemetry now records an actual component mount once, rather than recording every backdrop-source change as a duplicate mount.

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

## Final Validation Status

The current source state was reverified after completing the guarded `__WEBPACK_SERVE__` access in `src/ptv/core/config.ts`:

| Check | Result |
| --- | --- |
| Focused Reading/Identify tests | 6 files, 43 tests passed |
| Debug/performance focused tests | 3 files, 5 tests passed |
| Full Vitest suite | 30 files, 243 tests passed |
| TypeScript | Passed with `--noEmit --incremental false` |
| Repository ESLint | Fails existing baseline: 298 findings (172 errors, 126 warnings) across broad legacy PTV/Jellyfin files |
| Scoped ESLint | New standalone files have zero findings; Reading scope has zero errors and eight pre-existing nested-render warnings |
| Repository Stylelint | Fails existing baseline: 140 errors in `card.scss`, `homesections.scss`, `themes/dark/theme.scss`, and `nativeBrowse.scss`; none are in the Reading hardening diff |
| Scoped Stylelint | Passed |
| Companion plugin tests | 4 tests passed |
| Plugin Release build | Passed with zero warnings/errors |
| Production Webpack build | Passed in 110.7 seconds; Webpack compilation 97.673 seconds |
| Webpack warnings | Existing aggregate asset-size and entrypoint-size warnings only |
| `git diff --check` | Passed |
| Secret/local-data scan | No real credentials or supplied sensitive export values in added source/tests/docs; fake fixtures only. One private Seerr default URL remains on a pre-existing unchanged dashboard line and is sanitized from exports. |

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

Live authenticated desktop/mobile/TV verification remains required for real library counts, exact Universal Pictures/network metadata, multi-page scrolling, and history/return scroll behavior. No Reading implementation or plugin contract was changed by this browse pass.

The global lint/style failures are demonstrated pre-existing and non-blocking for this delivery: counts exactly match the prior baseline, new standalone files lint clean, touched legacy-file findings are on unchanged lines, the Reading scope has zero errors, and the failing Stylelint files were not changed by this pass. Generated `dist`, Babel cache, Vitest result, and plugin `bin/obj` changes were cleaned or restored. Four generated root development logs are removed from tracking and ignored because they contain machine-local runtime output.

## Deployment Verification Still Required

- Deploy the rebuilt frontend and matching PiggieTV plugin together.
- Restart Jellyfin after installing the plugin DLL.
- Verify Google Books and ComicVine result selection and field application against a live authenticated server.
- Verify durable Reading series overrides across browser/device changes and Jellyfin restart.
- Verify representative 390, 768, 1440, and 2560 pixel viewports with real data.
- Verify touch shelf scrolling, remote focus, and Fire TV low-power behavior on devices.
- Monitor the one reported transient legacy Jellyfin header appearance. It cleared after hard refresh and has not been reproduced in local automated validation.

## Known Constraints And Risks

- The frontend package is `10.11.11`, while the plugin currently targets Jellyfin package `10.11.8`; compatibility must be checked when either side is upgraded.
- A frontend/plugin version mismatch can make Google Books search or durable series overrides appear unavailable even when the frontend renders normally.
- Automated tests cannot validate third-party provider availability or server metadata-provider behavior.
- Webpack bundle-size warnings remain a performance debt; no new build error is present.
- Do not treat localStorage as authoritative for Reading series overrides.

## Next Delivery Step

Review the corrective hardening diff and project-memory updates, then deploy the rebuilt frontend. This pass is web-only and does not require a plugin DLL update or plugin restart. Allow the service worker to update or perform one hard refresh before running the remaining authenticated Movies/Shows matrix in `HANDOFF.md`.
