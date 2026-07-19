# PiggieTV Project State

Current as of 2026-07-19. This is the current-state ledger; dated sections retain delivery history.

Maintenance rule: after every completed project prompt, update `HANDOFF.md`, `PROJECT_STATE.md`, and `ARCHITECTURE.md` before reporting completion. Current behavior, verification, deployment requirements, and open risks must agree across all three documents.

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
| Plugin target/version | .NET 9, `10.11.8.2` against Jellyfin packages `10.11.8` |
| Featured cache | Schema/version 7, plugin and browser stale-while-revalidate path |
| Reading home cache | Schema 4, 5-minute fresh TTL, 24-hour stale window |

The current worktree adds conflict-safe media-source deduplication, TV remote activation/dropdown regressions, lighter static webOS glass, an administrator-controlled local remote-diagnostics system across the frontend and companion plugin, optional LG webOS CLI helpers, repository hygiene, and these project-memory updates. Machine-local/generated artifacts are intentionally untracked; the five-file `src/ptv/plugin/bin` deployment payload is intentionally tracked and refreshed.

## Current Product State

### Runtime And Shell

- PTV has one guarded runtime initialized from `src/ptv/core/app.js`.
- The persistent runtime root owns the global media dock and survives route changes.
- `PTVShell` is the shared shell for native Home, Movies, Shows, Anime/Cartoons, Music, Reading, Requests, Dashboard, and settings surfaces.
- Primary and contextual navigation are route-backed and centralized in the shell/route controller.
- Item routing is centralized for PTV Music, Reading, video, and Jellyfin fallbacks.
- TV activation and directional focus are centralized in `tvFocus.ts`; shell dropdowns share its normalized OK/select and Back semantics and restore focus on close.

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

- The plugin advertises `remoteDiagnostics` only when the matching API is present. Authenticated clients check in through a bounded capability-aware transport; administrators list/filter clients, start 5- or 10-minute sessions, stop them, request snapshots, and view/download the latest report from Dashboard.
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

## Final Validation Status

The 2026-07-19 worktree was reverified after the final frontend, plugin, documentation, and payload changes:

| Check | Result |
| --- | --- |
| Targeted frontend tests | 9 files, 58 tests passed |
| Media-source deduplication | 13 tests passed, including conflict bridges and transitive aliases |
| TV focus/dropdown/style contracts | 21 tests passed across focus, dropdown, and TV/webOS visual contracts |
| Remote-diagnostics frontend/API/dashboard | 24 tests passed |
| Companion plugin tests | 20 tests passed |
| Type/build check | `npm run build:check` passed |
| Changed-source ESLint | Passed |
| webOS Stylelint | Passed |
| Plugin contract | API 1, cache 7, plugin `10.11.8.2`, target `10.11.8`, web `10.11.11` passed |
| Production Webpack build | Passed in 90.3 seconds |
| Webpack warnings | Existing aggregate asset-size and entrypoint-size warnings only |
| `git diff --check` | Passed |
| Repository hygiene audit | No tracked `.dotnet-home`, Vite result, split-development log/PID, or nested plugin project/test `bin`/`obj`; no physical nested plugin `bin`/`obj` remained |
| Deployable plugin payload | Five files preserved and rebuilt after the latest plugin source change |

The older dated validation sections below remain historical evidence; they do not override this table or the current coupled frontend/plugin deployment boundary.

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

- The companion plugin patch is `10.11.8.2`, replacing installed/source release `10.11.8.1`. API major `1`, featured cache schema `7`, Jellyfin package target `10.11.8`, and manifest target ABI `10.11.8.0` are unchanged.
- Plugin version authority is the `PtvPluginVersion` project property. Assembly/file versions, status responses, the provider user agent, source/published manifests, contract checks, and release documentation now resolve from or verify that value.
- Frontend compatibility keeps `10.11.8.1` connected for the supported API/cache contract but reports `readingSeriesOverrides` as upgrade-required. `10.11.8.2` advertising the feature is compatible. Browser storage remains explicitly labeled a local cache fallback, never server authority.
- Published payload: `Jellyfin.Plugin.PiggieTV.dll`, `.deps.json`, `.pdb`, `.xml`, and `meta.json` in `src/ptv/plugin/bin`. The DLL and manifest both report `10.11.8.2`.
- Final verification: focused compatibility 12/12, full Vitest 351/351, plugin 9/9, plugin contract passed, TypeScript passed, scoped ESLint passed, Release build/publish passed with zero .NET warnings/errors, production Webpack passed with the established asset/entrypoint size warnings, and the 119,152-path secret scan passed.
- Deployment order is plugin payload -> Jellyfin restart -> capability/status verification -> matching frontend. A routine browser/service-worker purge is not required; use the normal update/reload path first.

### 2026-07-15 Deployment-Stage Verification

Status: corrected local plugin/frontend candidate passes; production deployment remains on hold.

- Installed plugin advanced from `10.11.8.1` to `10.11.8.2` using the complete five-file payload. The pre-deployment plugin and web-root backups were hash/count verified and retained.
- The first `10.11.8.2` startup returned HTTP 500 from full status because Jellyfin's XML serializer cannot persist the nested Reading override dictionary. `PluginConfiguration` now persists a sorted XML route-list surrogate and reconstructs the runtime dictionaries. Plugin tests pass 10/10, including configuration round-trip coverage.
- Corrected startup loads `Jellyfin.Plugin.PiggieTV, Version=10.11.8.2` without plugin dependency, controller, ABI, or configuration errors. Authenticated full status returns HTTP 200 with plugin `10.11.8.2`, API `1`, cache `7`, `readingSeriesOverrides=true`, `ok=true`, and `degraded=false`.
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
- Release payload: exactly five files in `src/ptv/plugin/bin`; DLL assembly/file version and `meta.json` all report `10.11.8.2`.
- Deployment boundary: SSH to both the Proxmox hop and Jellyfin guest rejected non-interactive authentication. No server file, service, or backup was changed. Anonymous endpoint probes correctly returned HTTP 401, so authenticated post-restart 200 verification remains pending.

### 2026-07-16 Production Chunk Coherency Correction

Status: source and automated verification pass; production frontend deployment remains pending.

- Physical evidence showed a stale production runtime requesting async chunk `90212.432920e11e02eefe99af.chunk.js`. The chunk existed locally and at the Jellyfin origin. During diagnosis the public bare URL returned HTTP 503 while the same path with a query returned HTTP 200; later probes returned 200 for both, confirming an intermittent CDN/path-cache failure rather than a missing build artifact.
- Production async JavaScript and CSS requests now carry a build-scoped `ptv_asset` query. The route error boundary performs at most one same-origin chunk recovery reload per build/request and preserves the hash route.
- `scripts/deploy-jellyfin-web.ps1` now copies assets before `index.html`, atomically replaces the entry document last, and SHA-256 verifies every deployed source file. A clean-target simulation copied and verified 2,498 files, including the reported chunk.
- Verification: focused chunk recovery 5/5; full Vitest 57 files/410 tests; TypeScript; scoped ESLint; production Webpack in 82.371 seconds; and `git diff --check` pass. Webpack retains only the established aggregate size warnings.
- No frontend or corrected plugin payload was deployed. The supplied server log shows an installed assembly labeled `10.11.8.2` still exposing the old public Reading override dictionary, so the previously staged XML-safe five-file plugin payload and Jellyfin restart remain separately required.

### 2026-07-16 Authenticated Diagnostics Cleanup

Status: source and automated verification pass. The supplied authenticated export reports plugin connected, version `10.11.8.2`, API `1`, cache schema `7`, `readingSeriesOverrides` available, compatibility compatible, and Reading indexing complete at 2,911/2,911.

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
- Live boundary: `10.16.0.125:8082` served HTTP 200 and passed bundle/provenance inspection. Fresh Playwright profiles stopped at Jellyfin Select Server instead of authenticated details; supplying `10.16.0.50:8096` did not replace the dev bundle's retained localhost selection. No authenticated movie/show/episode geometry or audible playback sequence was claimed.
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
