# PiggieTV Project State

Current as of 2026-07-14. This is the current-state ledger, not a historical changelog.

## Repository Snapshot

| Field | Current value |
| --- | --- |
| Product | PiggieTV native experience embedded in Jellyfin Web |
| Current HEAD | `568e7eac3b` (`route fix`); Reading hardening source is in `71666e7d02` (`bookshelf`) |
| Jellyfin Web package | `10.11.11` |
| Node requirement | `>=20.0.0` |
| Frontend stack | React 18.3, TypeScript 5.8, Webpack 5, MUI 6, TanStack Query 5 |
| PTV frontend root | `src/ptv` |
| Plugin root | `src/ptv/plugin/Jellyfin.Plugin.PiggieTV` |
| Plugin target/version | .NET 9, `10.11.8.2` against Jellyfin packages `10.11.8` |
| Featured cache | Schema/version 7, plugin and browser stale-while-revalidate path |
| Reading home cache | Schema 4, 5-minute fresh TTL, 24-hour stale window |

The Reading implementation and its focused tests are present in HEAD history. The current worktree contains the frontend-only Movies/Shows focused-loader identity correction, exact-value genre directory presentation, truthful Studios & Networks labeling, shell mount attribution, regression tests, and these project-memory updates. Generated build/test output is removed or restored after verification.

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
- Movies and Shows now distinguish base landing routes from focused URL-addressable views. Movies support Latest, Trending, Genres/exact Genre, and Studios/exact Studio. Shows support Continue, Latest, Trending, Genres/exact Genre, Studios & Networks/exact Studio or Network, and series-scoped Seasons. Existing `view=networks`/`view=network` URLs remain compatible.
- Hash query state participates in route identity. Focused pages use structured server-side filters, 50-item paging, exact metadata-ID resolution, bounded page caching, item-ID deduplication, and stale-response suppression.
- One canonical internal focused-loader key now owns effect reloads, request-generation ownership, page accumulation, and cache isolation. It includes scope/parent/filter/search/sort/page/size state; shareable diagnostics emit a separate sanitized identity that keeps exact public filter names without raw Jellyfin IDs.
- Anime, Anime Movies, and Cartoons aliases resolve to real authenticated Jellyfin user-view IDs and fail closed when unavailable; scoped queries no longer broaden silently.
- Genre directories preserve each exact Jellyfin query value while normalizing presentation casing, deduplicating case-insensitive exact matches, and offering only explicit non-fuzzy alias groups. Curated mode hides a bounded sensitive-genre set per user; All metadata mode exposes the unmodified directory. Counts reuse Jellyfin metadata-directory totals.

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

- Deploy the rebuilt frontend. The existing matching PiggieTV plugin remains required for its previously delivered Reading/plugin features, but this browse pass changes no plugin source or contract.
- A plugin DLL update and Jellyfin plugin restart are not required for this pass.
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

Review the focused-loader diff and project-memory updates, then deploy the rebuilt frontend. This pass is web-only and does not require a plugin DLL update or plugin restart. Allow the service worker to update or perform one hard refresh before running the remaining authenticated Movies/Shows matrix in `HANDOFF.md`.

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
