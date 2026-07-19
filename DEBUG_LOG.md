# Debug Log

Last tested date: 2026-07-13

This log tracks known bugs, reproduction steps, expected behavior, actual behavior, severity, status, and current evidence. Add new issues to the summary table and create a detail section for any high or critical issue.

## Summary

| ID | Severity | Status | Area | Summary | Last tested |
| --- | --- | --- | --- | --- | --- |
| REC-PERSIST-001 | Critical | Fixed / monitor | Recommendations | Compact accepted-row persistence and structured validation are present; no current regression is recorded. | 2026-07-13 |
| REC-SOURCE-001 | High | Fixed / monitor | Recommendations | Source collection retains status/body diagnostics and simplified query fallbacks; no current regression is recorded. | 2026-07-13 |
| ROW-HOME-001 | High | Historical / monitor | Home / Row Builder | The June mismatch predates accepted-row source diagnostics and cache-hash selection; no current automated failure is recorded. | 2026-07-13 |
| REC-DIAG-001 | Medium | Fixed / monitor | Diagnostics | Recommendation source failures normalize rejected values into endpoint/status/body diagnostics. | 2026-07-13 |
| UI-ROWS-001 | Medium | Historical / monitor | Home UI | The June visual report predates the current native shelf/card layout; retain for regression history. | 2026-07-13 |
| TS-MUSIC-001 | Medium | Resolved / monitor | Music | `PtvMusicQueueSnapshot` was missing `isMuted` and `volumeLevel` in some snapshots. Later logs show no TypeScript errors. | 2026-06-16 |
| TS-MUSIC-002 | Medium | Resolved / monitor | Music API | `requestPtvJson` call used `Fields` outside `params`. Later logs show no TypeScript errors. | 2026-06-16 |
| TS-HOME-001 | Medium | Resolved / monitor | Music home | `PtvMusicHomeData` objects were missing required `library`. Later logs show no TypeScript errors. | 2026-06-16 |
| ROUTE-MUSIC-001 | Medium | Resolved / monitor | Music route | `musicPage` module was temporarily unresolved. Later logs show the module built successfully. | 2026-06-16 |
| TS-MUSIC-003 | Low | Resolved / monitor | Music playback | `playPtvMusicTracks` was called with three arguments where one or two were expected. Later logs show no TypeScript errors. | 2026-06-16 |
| READ-STAB-001 | High | Verified locally / pending deployment verification | Reading | Shared filename parsing, classification, grouping, selective Identify apply, protected diagnostics, and responsive layout pass the final automated gate. | 2026-07-13 |
| READ-OVERRIDE-001 | High | Verified locally / pending plugin deployment | Reading series | Durable admin series overrides use the plugin endpoint; cross-device and restart persistence require live verification. | 2026-07-13 |
| READ-PROVIDER-001 | High | Verified locally / pending live provider verification | Reading metadata | Google Books/ComicVine normalization, ranking, canonical title handling, and field-selective apply pass local coverage but require authenticated provider checks. | 2026-07-13 |
| SHELL-LEGACY-001 | Medium | Intermittent / monitor | Shared shell | The legacy Jellyfin header appeared once during a soft runtime state and cleared after hard refresh; no automated reproduction is available. | 2026-07-13 |

## REC-PERSIST-001: Recommendation Save Rejected

| Field | Detail |
| --- | --- |
| Severity | Critical |
| Status | Fixed / monitor |
| Affected area | Recommendation dashboard, recommendation persistence, home recommendation rows |
| Reproduction steps | Open the recommendation dashboard. Generate recommendation rows. Observe generated rows. Save or allow save to run. Refresh the browser. |
| Expected behavior | `recommendation-save-success` occurs. Plugin accepts the payload. `persistedRowCount` matches generated row count. Refresh keeps recommendation rows on Home. |
| Actual behavior | Previously generation succeeded but save failed, so refresh lost rows. |
| Evidence | Runtime diagnostics show `candidateCount = 55`, `rowCount = 6`, and generated rows `recommended-for-you`, `because-you-listen`, `ptv-discovery`, `rediscover`, `made-for-you-music`, `because-you-like-rock`. Save starts with `payloadSize = 227627`, then `recommendation-save-failure` with `Bad request: plugin rejected the payload`. After refresh, `loadedRowCount = 0` and `persistedRowCount = 0`. |
| Root cause | Row Builder persisted `row.items.map(item => item.item)`, which sent raw Jellyfin item objects into `recommendations.rows[].items`. The plugin endpoint bound the body directly to `PtvPluginSettingsPatchDto`; rich item fields could include arrays/objects that did not match `RecommendationItemSnapshot` fields such as `List<string>` and small image-tag DTOs, causing ASP.NET model binding to reject the request with HTTP 400 before plugin storage ran. The payload also carried source timing/debug data that should not be durable state. |
| Fix | Frontend recommendation persistence now converts generated scores to a compact `PtvPersistedRecommendationItem` reference payload and strips source timings/debug before save. The plugin settings endpoint now deserializes inside `SaveSettings`, logs payload size/top-level keys/per-row item counts, returns structured `PTV_SETTINGS_INVALID_PAYLOAD` or `PTV_SETTINGS_INVALID_RECOMMENDATIONS` errors, validates row/item references, clears source timing blobs in normalization, and logs the plugin-configuration storage result. |
| Relevant files | `src/ptv/modules/dashboard/PiggieTvRowsPage.tsx`, `src/ptv/modules/recommendations/recommendationSettings.ts`, `src/ptv/core/pluginApi.ts`, `src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvStatusController.cs`, `src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Services/PtvPluginSettingsService.cs`, `src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Services/PtvPluginSettingsNormalizer.cs`, `src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Configuration/PluginConfiguration.cs` |
| Verification | The fix passed its original frontend/plugin build gates and later Home diagnostics showed persisted accepted recommendation rows. Keep restart persistence in the deployment regression matrix. |
| Next action | Monitor compact persistence and hash invalidation during future recommendation/plugin changes. |

## REC-SOURCE-001: Recommendation Source Collection Fails

| Field | Detail |
| --- | --- |
| Severity | High |
| Status | Fixed / monitor |
| Affected area | Recommendation generation source collection |
| Reproduction steps | Open the recommendation dashboard. Generate recommendations. Observe partial generation warning. |
| Expected behavior | Favorites, history, resume, recently-added, and broad-candidates either return item/candidate counts or explicit actionable failures. Generated rows appear when enough sources are available. |
| Actual behavior | Initial failure showed `favorites: undefined`, `history: undefined`, `recently-added: Jellyfin API request failed`, `resume: undefined`, and `broad-candidates: undefined`. After source diagnostics were deployed, favorites and recently-added succeeded while history, resume, and broad-candidates still failed on their primary `Users/{userId}/Items` queries. |
| Root cause | The first root cause was opaque source requests and `String(error)` formatting, which hid Jellyfin failures as `undefined` or generic API errors. Current evidence points to primary query compatibility for `SortBy=DatePlayed,PlayCount`, `Filters=IsResumable` with `SortBy=DatePlayed,SortName`, and `SortBy=DateCreated,SortName`; exact Jellyfin status/body still need live verification. |
| Fix | Recommendation source collection uses explicit `requestPtvJson` calls and the API wrapper now captures HTTP status plus cloned `Response` bodies when available. History falls back from `SortBy=DatePlayed,PlayCount` to `SortBy=DateCreated` and then `SortBy=SortName`. Resume probes `Filters=IsFavorite` with the failing sort to isolate filter vs sort behavior, then falls back to `Filters=IsResumable` with `SortBy=SortName`, then unfiltered `SortBy=SortName`. Broad-candidates falls back from `SortBy=DateCreated,SortName` to `SortBy=SortName`. Variant diagnostics include endpoint, status, response body summary, query, parameter under test, item count, and whether the variant was used. |
| Relevant files | `src/ptv/modules/recommendations/providers/jellyfinRecommendationProvider.ts`, `src/ptv/modules/recommendations/engine/recommendationEngine.ts`, `src/ptv/modules/recommendations/debug/recommendationRuntimeDebug.ts`, `src/ptv/modules/recommendations/types/recommendationTypes.ts`, `src/ptv/api/client.ts` |
| Verification | The fallback and diagnostic paths passed their original build gate, and no current source-collection regression is recorded. |
| Next action | If generation regresses, inspect `recommendation-source-query-variant-*`, `recommendation-source-request-*`, and `recommendation-diagnostic-report` before changing query behavior. |

## ROW-HOME-001: Home Rows Do Not Match Row Builder Settings

| Field | Detail |
| --- | --- |
| Severity | High |
| Status | Historical / monitor |
| Affected area | Home row pipeline, dashboard Row Builder, recommendation rows |
| Reproduction steps | Configure Row Builder rows in the dashboard. Generate or refresh rows. Return to Home or refresh the browser. Compare the rendered rows to dashboard row settings. |
| Expected behavior | Home renders enabled rows in the configured order, with configured limits and generated recommendation rows where enabled. |
| Actual behavior | Historical behavior: rendered Home rows did not consistently match dashboard settings and recommendation rows did not stick after refresh. |
| Evidence | User screenshots show many Home rows with row names such as Latest, Anime, Seasons/Holidays, Because You Watched, Horror, Horror Picks, Disney, Science Fiction, and Action while the dashboard Row Builder has its own active rules and recommendation rows. |
| Relevant files | `src/ptv/pages/home/hooks.ts`, `src/ptv/pages/home/NativeHome.tsx`, `src/ptv/modules/recommendations/recommendationSettings.ts`, `src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Models/PtvRowBuilderModels.cs`, `src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Configuration/PluginConfiguration.cs` |
| Next action | Reopen only if rendered-row diagnostics show a row missing from current accepted recommendation settings or enabled Row Builder configuration. |

## REC-DIAG-001: Recommendation Diagnostics Lose Error Detail

| Field | Detail |
| --- | --- |
| Severity | Medium |
| Status | Fixed / monitor |
| Affected area | Recommendation dashboard diagnostics |
| Reproduction steps | Generate recommendations when one or more sources fail. Review the recommendation warning banner and diagnostics. |
| Expected behavior | Diagnostics show source name, endpoint, status code, response body, and validation errors. |
| Actual behavior | Banner previously could show `history: [object Response]`, `resume: [object Response]`, `broad-candidates: [object Response]`, or `source: undefined`. |
| Evidence | User screenshot shows partial generation warning with source failures rendered as `[object Response]`. |
| Relevant files | `src/ptv/modules/recommendations/engine/recommendationEngine.ts`, `src/ptv/modules/recommendations/providers/jellyfinRecommendationProvider.ts`, `src/ptv/core/pluginApi.ts`, `src/ptv/api/client.ts` |
| Next action | Monitor live diagnostics after source collection verification. |

## UI-ROWS-001: Row Layout Has Excess Empty Space

| Field | Detail |
| --- | --- |
| Severity | Medium |
| Status | Historical / monitor |
| Affected area | Home row layout and row virtualization |
| Reproduction steps | Open Home on a wide desktop viewport with generated rows. Scroll through multiple sections. |
| Expected behavior | Rows use configured item limits and layout density without large disconnected empty regions. |
| Actual behavior | Historical behavior: rows displayed cards at the left with a large empty right-side region and row surfaces extending across the viewport. |
| Evidence | User screenshots show wide rows with content clustered on the left and empty space across the rest of the viewport. |
| Relevant files | `src/ptv/pages/home/NativeHome.tsx`, `src/ptv/pages/home/hooks.ts`, `src/ptv/styles`, feature SCSS under modules |
| Next action | Reopen only with a current viewport, route, row ID, item count, and render-profile reproduction. |

## Resolved / Monitor Items

| ID | Evidence | Follow-up |
| --- | --- | --- |
| TS-MUSIC-001 | Earlier TypeScript errors reported missing `isMuted` and `volumeLevel`; later logs report `No typescript errors found`. | Keep queue snapshot defaults aligned with `musicTypes.ts`. |
| TS-MUSIC-002 | Earlier error showed `Fields` outside the `params` option for `requestPtvJson`; later logs report no TypeScript errors. | Keep all PTV API query strings inside `params`. |
| TS-HOME-001 | Earlier errors showed `library` missing from `PtvMusicHomeData`; later logs report no TypeScript errors. | Keep empty music home data consistent with `musicTypes.ts`. |
| ROUTE-MUSIC-001 | Earlier `musicPage` module resolution failed; later logs show `musicPage.tsx` built successfully. | Avoid route imports that omit existing module paths. |
| TS-MUSIC-003 | Earlier playback call used three args; later logs report no TypeScript errors. | Keep playback helper API and call sites synchronized. |

## READ-STAB-001: Reading Identity And Layout Stabilization

| Field | Detail |
| --- | --- |
| Severity | High |
| Status | Fixed in code / pending deployment verification |
| Affected area | Reading discovery, classification, grouping, Identify, diagnostics, responsive layout |
| Expected behavior | Books, Comics, and Manga classify and group consistently; metadata selection is safe; debug output is protected; shelves remain usable across supported inputs and widths. |
| Actual behavior | Before this pass, parsing/grouping rules were duplicated, provider wording could influence classification/title, diagnostics were overly broad, and shelf/Identify layouts could overflow. |
| Fix | Added shared parser/classification/diagnostics boundaries, deterministic grouping and ranking, selective metadata application, and bounded responsive layouts. |
| Evidence | 43 focused tests and the 238-test full suite pass; TypeScript, scoped styles/lint, plugin build, and production Webpack pass. |
| Next action | Run the authenticated provider, device, and viewport matrix after deploying the matching frontend and plugin. |

## READ-OVERRIDE-001: Reading Series Override Persistence

| Field | Detail |
| --- | --- |
| Severity | High |
| Status | Fixed in code / pending plugin deployment |
| Affected area | Manual Reading series grouping overrides |
| Expected behavior | Administrator overrides remain authoritative across browsers, devices, and Jellyfin restarts. |
| Actual behavior | Browser localStorage was previously the durable source, so overrides were device-local. |
| Fix | Added plugin-backed `GET/PUT /Ptv/v1/reading/series-overrides/{routeKind}` persistence with browser cache/migration fallback. |
| Evidence | Override regression tests and the companion plugin build pass. |
| Next action | Install the matching plugin, restart Jellyfin, and verify cross-device/restart persistence. |

## READ-PROVIDER-001: Reading Provider Selection And Apply

| Field | Detail |
| --- | --- |
| Severity | High |
| Status | Fixed in code / pending live provider verification |
| Affected area | Google Books and ComicVine Identify results and metadata application |
| Expected behavior | Canonical identity ranks first, provider description stays descriptive, selected fields persist, and existing data/art is not erased unintentionally. |
| Actual behavior | Provider deck text could become the title, Google Books result handling was inconsistent, and broad replacement obscured metadata versus artwork failures. |
| Fix | Added normalized ranked candidates, plugin-proxied Google Books search, allowlisted provider links, and field-selective metadata/artwork application with independent status. |
| Evidence | Identify normalization/ranking/safety regressions and all local validation gates pass. |
| Next action | Verify title/ISBN searches and selected ComicVine/Google Books application against an authenticated Jellyfin server. |

## Future Bug Template

| ID | Severity | Status | Area | Summary | Last tested |
| --- | --- | --- | --- | --- | --- |
| TBD | TBD | Open | TBD | TBD | YYYY-MM-DD |

### Detail Template

| Field | Detail |
| --- | --- |
| Severity | TBD |
| Status | Open |
| Affected area | TBD |
| Reproduction steps | TBD |
| Expected behavior | TBD |
| Actual behavior | TBD |
| Evidence | TBD |
| Relevant files | TBD |
| Next action | TBD |
## 2026-07-13 - Reading stabilization audit

- Confirmed `booksSeries.ts` included publication year in inferred grouping keys, splitting volumes across years.
- Confirmed filename cleanup was duplicated between `booksSeries.ts` and `itemidentifierUtils.js`.
- Confirmed manual series overrides were authoritative in `localStorage` only.
- Confirmed Identify defaulted Replace Existing Images on and submitted a broad provider result followed by `ReplaceAllMetadata: true` refresh.
- Confirmed Reading diagnostics could render without the required admin plus explicit-debug gate.
- Planned fixes preserve provider lookup and existing metadata persistence while narrowing writes and adding deterministic ranking.

## 2026-07-13 - Reading filename, grouping, and durable override checkpoint

- Shared parsing now recognizes requested volume/issue forms, strips release noise, preserves meaningful punctuation, and normalizes apostrophe variants.
- Confirmed year-dependent grouping was the Ancient Magus split cause; inferred group keys no longer include publication year.
- Added plugin-backed route-scoped series overrides with one-time migration from legacy browser state. Browser storage is no longer the durable authority.
- Corrected classification precedence so an explicit Manga library hint wins over provider terms such as Comic Vine.
- Validation: TypeScript passed, plugin debug build passed with zero warnings/errors, and 28 focused parser/grouping/persistence tests passed.

## 2026-07-13 - Reading provider normalization and ranking checkpoint

- Root cause: remote `Name` was used both for result display and persistence, allowing ComicVine deck copy to overwrite canonical Reading identity.
- Added canonical result normalization that keeps provider display copy separate, repairs bare issue names, and retains marketing copy as overview text.
- Identify payloads now use the shared Reading filename parser for clean title, series, year, and issue/volume fields.
- Added deterministic scoring for provider IDs, ISBN, series, issue/volume, title, author, and year, with penalties for conflicting identity.
- Validation: 33 targeted tests pass, including ComicVine deck-title and exact-volume regressions.

## 2026-07-13 - Reading preview/apply and artwork-safety checkpoint

- Replaced the minimal confirmation state with a current-versus-proposed field table and explicit per-field selections.
- Empty proposed values and unrelated titles are not selected automatically; safe-select and clear-selection actions are available.
- Current/proposed primary covers render side by side. Existing cover replacement defaults off, while a missing cover may default on.
- Reading saves selected metadata directly and never calls the legacy recursive `ReplaceAllMetadata` refresh. Metadata and artwork report independent statuses.
- Non-Reading Identify still uses the existing Jellyfin remote-apply path.
- Validation: TypeScript check passed and focused preview safety tests pass.

## 2026-07-13 - Reading diagnostics and responsive-layout checkpoint

- Root cause: the Reading page rendered a large flat diagnostic record without enforcing both administrator authorization and explicit debug mode; raw URLs and long values could also expand the normal layout.
- Added a pure diagnostics boundary that gates on admin plus debug, redacts credentials/authorization/host/user/item/path data, bounds values, and groups output into readable request, cache, artwork, grouping, library, and shelf sections.
- Reading, series, details, Identify, and Apply Metadata layouts now use fluid desktop/ultrawide constraints, readable card minimums, 44px controls, visible horizontal shelf overflow, and bounded independent scrolling for diagnostics and field comparison.
- Validation: four focused diagnostics/security tests, TypeScript, and scoped stylelint passed. Full focused lint/tests and production build are the next validation gate.

## 2026-07-13 - Reading full test-suite checkpoint

- The first repository-wide test run exposed a non-Reading harness failure: `config.ts` evaluated webpack's `__WEBPACK_SERVE__` compile constant directly, but Vitest does not define it.
- Added a `typeof` guard so webpack development detection remains unchanged while tests and other non-webpack runtimes can import PTV configuration safely.
- Validation: focused Reading/Identify tests pass (5 files, 40 tests), and the complete Vitest suite now passes (26 files, 235 tests). Production webpack validation is next.

## 2026-07-13 - Reading final validation checkpoint

- Production webpack completed successfully in 115.7 seconds. Its two warnings are the existing aggregate asset-size and entrypoint-size notices; no module, TypeScript, or compatibility error was emitted.
- The companion plugin debug build passed with zero warnings/errors. TypeScript, scoped stylelint, and scoped ESLint also passed; ESLint retains eight non-blocking nested-render warnings in the existing `booksPage.tsx` component tree.
- Build/test artifacts were removed or restored after validation so only source, focused tests, plugin contract changes, and the four persistent context documents remain in task scope.
- Live authenticated provider application, Jellyfin restart persistence, and representative viewport verification remain deployment checks rather than local-shell claims.

## 2026-07-13 - Reading classification regression checkpoint

- A direct `booksApi.ts` classification test initially could not collect because that API module imports Jellyfin modules through webpack-only aliases.
- Extracted format and item-kind classification into pure `booksClassification.ts` and retained `booksApi.ts` re-exports, so existing runtime callers are unchanged.
- Added regressions proving a Manga library hint survives ComicVine metadata and an explicit manual override still wins over a library hint.
- Validation: 42 focused tests pass across six files; the repository suite passes 27 files and 237 tests; TypeScript and scoped classification/API ESLint pass.

## 2026-07-13 - Reading post-classification production build checkpoint

- Final production webpack build passed after the pure classification extraction in 79.3 seconds.
- Webpack emitted only the two existing aggregate asset-size and entrypoint-size warnings; no module resolution, type, or compatibility error was emitted.
- Generated `dist`, Babel cache entries, and Vitest result changes were removed/restored after validation. Pre-existing development logs remain untouched.

## 2026-07-13 - Project document reconciliation checkpoint

- Reconciled `ARCHITECTURE.md`, `PROJECT_STATE.md`, and `HANDOFF.md` against HEAD `9851acd987`, package version `10.11.11`, the current runtime/shell route registry, featured cache version 7, Reading cache schema 4, plugin `/Ptv/v1` routes, and the uncommitted Reading stabilization work.
- Removed stale June current-state claims from the operational documents while preserving this file's historical issue details.
- The final local validation baseline is 43 focused Reading/Identify tests, 238 full-suite tests, passing TypeScript/scoped-style/plugin builds, and a passing production Webpack build with only existing bundle-size warnings.
- Deployment remains the next gate. Live provider application, server-restart persistence, real-device input, representative authenticated viewports, and the intermittent legacy-header report are not marked verified by local automation.

## 2026-07-13 - Reading production-hardening final audit

- Confirmed every intended Reading hardening source/test/plugin change remains present in HEAD history, with the implementation in `71666e7d02` and the final audit based on HEAD `476f994f01`.
- Confirmed `config.ts` protects the Webpack compile constant with `typeof __WEBPACK_SERVE__ !== 'undefined'` before reading it. The full Vitest suite passes after this guard: 27 files and 238 tests. The focused Reading/Identify suite passes 6 files and 43 tests, including an explicit Saki v02 ranking regression.
- TypeScript passes. The plugin Release build passes with zero warnings/errors. Production Webpack passes in 135 seconds with only its two existing asset/entrypoint size warnings.
- Repository ESLint reports 298 baseline findings (172 errors, 126 warnings), while the changed Reading/Identify scope has zero errors and eight warnings traced to pre-hardening commits. Repository Stylelint reports 140 baseline errors only in files outside the hardening diff; both changed SCSS files pass.
- Manually audited all requested invariants: year-free grouping; apostrophe normalization; plugin-authoritative overrides; Manga classification precedence; canonical-title protection; exact volume ranking; non-destructive empty-field/artwork defaults; independent metadata/artwork status; protected, bounded, redacted diagnostics; provider URL allowlisting; bounded Identify/apply scrolling; and fluid Reading layouts without page-level scaling.
- A redacted scan of 30 source/test/project-memory files found no real API keys, Jellyfin tokens, authorization credentials, or local-only secrets in added production code. Two matches are deliberate fake values in diagnostics redaction tests. Generated dev logs contained machine-local URLs and were removed from Git tracking; a narrow root-log ignore rule prevents recommit.
- Generated production `dist`, Babel cache, Vitest result, and plugin `bin/obj` changes were removed or restored after verification. Live provider application, restart persistence, device input, and authenticated responsive checks remain deployment verification.

## 2026-07-13 - Global debug export and performance follow-up

- Debug-export root cause: the dashboard assembled multiple authoritative live sections but copied the merged object without a final shared redaction/bounding boundary. Added recursive final sanitization for copy/serialization while preserving the admin-only live view.
- TMDb root cause: enrichment scheduled too much remote work under one outer timeout, repeated credential validation, and treated caller cancellation as an all-or-nothing refresh failure. It is now cache-first with a 48-item remote cap, four workers, 3.5-second request budgets, reusable credential validation, partial-result retention, and explicit attempted/completed/skipped/failed/cancelled/partial counters.
- Browse root cause: independent shelves already rendered progressively, but task ordering allowed slower broad work to compete with first-visible content and Featured used an expensive random query. Added explicit priority scheduling and a bounded recent Featured query while retaining the existing lean card field profile and request coordinator.
- Image root cause: failed-image sets never expired and browse cards did not consistently advance through shared candidates. Added capped five-minute negative caches and candidate fallback before the placeholder.
- Shell diagnostics root cause: `ptv-shell-mounted` was tied to backdrop source changes rather than an actual mount. It now emits once per component mount.
- Validation: 3 focused files/5 tests, 6 Reading files/43 tests, and the full 30-file/243-test Vitest suite pass. TypeScript, scoped lint/style, four plugin tests, plugin Release build, `git diff --check`, and production Webpack pass. Webpack completed in 110.7 seconds with only the two known bundle-size warnings.
- Repository lint baselines are unchanged: ESLint 172 errors/126 warnings and Stylelint 140 errors. New standalone files lint clean; touched legacy-file findings are on unchanged lines. No real credential or supplied sensitive export value appears in added source/tests/docs; fixtures are synthetic. One private Seerr default URL remains on an unchanged pre-existing dashboard line and is removed by export sanitization.

## 2026-07-14 - Movies/Shows focused browse root-cause checkpoint

- Confirmed the shared route controller removed hash query parameters from `routeKey`, so query-only navigation did not advance route generation even though the browser URL changed.
- Confirmed `NativeBrowsePage` parsed only `topParentId`/`kind`; it never parsed or applied `view`, selected genre, studio, network, sort, or page state.
- Confirmed Anime, AniMovies, and Cartoons aliases were converted into broad genre guesses instead of resolved Jellyfin user-view IDs, allowing scoped pages to leak unrelated media.
- Confirmed every focused URL ran the same six landing queries and reused landing presentation. Genre/studio footer chips routed metadata names into ordinary text search, and their values came only from already limited shelf payloads.
- Confirmed the existing Anime `view=season` navigation omitted a series/parent ID, so the advertised URL could not represent a meaningful season page.
- Planned correction preserves the existing landing shelves and recent progressive-loading work while adding one canonical route model, server-side exact metadata filters, resolved parent scope, bounded paging, and admin-plus-debug-only route diagnostics.

## 2026-07-14 - Movies/Shows focused browse completion checkpoint

- Added one canonical typed browse-route model and query-aware shell route identity. Query-only navigation, equivalent query ordering, unsupported values, structured filters, sort, and paging now have deterministic state.
- Preserved the existing landing loader while adding focused Latest, Continue, Trending, genre, studio, network, and series-season pages with truthful loading/error/empty states.
- Replaced alias-as-label behavior with cached Jellyfin user-view discovery. Anime, Anime Movies, and Cartoons use resolved library IDs; unknown aliases fail closed.
- Exact genre/studio/network filters are applied server-side before 50-item paging. Studio/network names resolve to exact metadata IDs. Accumulated pages dedupe item IDs, use `TotalRecordCount`, share a bounded page cache keyed by resolved scope/filter/sort/page, and suppress stale route responses.
- Replaced footer plain-search links with canonical typed browse URLs and removed the incomplete Anime Season navigation link. Raw browse diagnostics are now admin-plus-debug only, collapsed, bounded, and redacted.
- Trending is a stable local-library ranking: play count, favorite/played engagement, community/critic rating, and recency; no per-card external requests are introduced.
- Final validation: focused 4 files/17 tests; full 33 files/258 tests; TypeScript passed; new standalone files ESLint-clean. Touched legacy lint findings are unchanged or reduced versus HEAD; Stylelint retains only the unchanged `nativeBrowse.scss:492` baseline selector-order error. Production Webpack passed in 76.7 seconds with only the two established size warnings. No plugin code changed, so no plugin build was required.
- Generated `dist`, Babel-loader cache, and Vitest result artifacts were removed/restored. Authenticated desktop/mobile/TV behavior and real-library metadata/counts remain deployment checks.

## 2026-07-14 - Authenticated browse/export corrective hardening checkpoint

- Parsed the supplied authenticated dashboard export: 120 events, healthy fresh/stored featured cache v7, 356 cached items, 25 sections, and 6 persisted recommendation rows.
- Runtime evidence confirms Movies genre-directory loads with 59 entries and exact genre loads of 2/2 and 50/395 items. The 50-item first page completed in 634.6 ms. A base Movies six-section completion event was from an earlier route generation and is not treated as proof that focused routes append landing shelves.
- Found a real telemetry race: shell lifecycle counters could read the prior canonical query before the scheduled route transition updated controller state. Counters now synchronize from browser location before selecting the route generation; a query-only navigation regression test covers this.
- Found sanitizer regressions in the export: semantic versions were redacted as private IPv4 hosts, credential lengths and SMTP password-state fields were retained, and complete data-image/blob replacement required explicit coverage. The final sanitizer now preserves safe version/build values, omits credential-shape fields, and replaces complete data/blob values with bounded placeholders.
- Added bounded `focused-browse-loaded` evidence for category, filter, page/offset/limit, item/total counts, duration, scope status, and sort state without request URLs or private identifiers.
- Added an exact Universal Pictures page-two regression proving `StudioIds`, `Limit=50`, `StartIndex=50`, and absence of `SearchTerm`.
- Final automated validation: focused hardening 5 files/22 tests; full Vitest 34 files/263 tests; TypeScript passed; production Webpack passed in 106.7 seconds (92.588-second compilation) with only the two established size warnings. New standalone files are ESLint-clean; touched legacy lint findings reproduce against HEAD, and no style source changed.
- Authenticated sign-off remains pending for Universal/network selection, Shows focused routes, scoped aliases, Trending, season routes, second-page UI accumulation, browser history/scroll restoration, and diagnostics role/debug combinations. No plugin source or contract changed, so no plugin build or restart is required for this frontend-only pass.

## 2026-07-14 - Focused browse loader identity checkpoint

- Audited every use of the reported coarse loader key. It existed only in `focused-browse-loaded` diagnostics; behavioral loading depended on the parsed route/scope effect and suppressed stale completion with cancellation state plus route generation. The omission was diagnostic-only, not the cause of a known cross-filter result leak.
- Added one deterministic internal focused-loader identity containing media kind, normalized view, resolved scope/library identity, collection/season parent context, exact genre/studio/network, resolved metadata IDs, focused search, sort field/order, page, `StartIndex`, and page size. The same identity now drives React effect ownership and focused cache keys.
- Added token-based request ownership because the shared Jellyfin API adapter does not expose `AbortSignal`. A newer key retires the previous token; an older late response cannot update active state. New-filter loads reset state, matching pages deduplicate/append, and returning to a prior filter restores only that filter's cache.
- Added a separate sanitized diagnostic key. Exact public filters remain visible (`movies:genre:genre:unscoped:Crime:SortName:Ascending:0:50`), while raw scope/library/parent/provider IDs and arbitrary search values are never exported.
- Regression coverage includes Crime to Horror, Horror to Comedy, Universal Pictures to Warner Bros., HBO to Netflix, unscoped to Anime-scoped Horror, alien to predator, ascending to descending, page zero to page one, a late Crime result after Horror, page accumulation, and prior-filter cache restoration.
- Final validation: focused 5 files/31 tests; full Vitest 35 files/277 tests; TypeScript passed; new/data files ESLint-clean. `NativeBrowsePage.tsx` reports the same 17 errors/2 warnings in HEAD and the worktree. Production Webpack passed in 80.9 seconds (78.352-second compilation) with only the two established size warnings. `git diff --check` passed apart from line-ending notices. No plugin code changed, so no plugin rebuild or restart is required.

## 2026-07-14 - Genre directory and current-bundle verification checkpoint

- Added a pure genre presentation boundary that preserves exact Jellyfin query values, normalizes display casing, performs case-insensitive exact deduplication, and supports only explicit maintainable alias groups. Fuzzy merges are deliberately excluded.
- Added compact searchable/alphabetical genre cards with metadata-directory counts and per-user Curated/All metadata visibility. Curated mode hides a bounded exact sensitive set; it does not delete or rewrite Jellyfin metadata and adds no per-genre request fan-out.
- Confirmed Shows network browsing is implemented by Jellyfin `getStudios` and `StudioIds`. The visible label is now **Studios & Networks** while existing `view=networks`/`view=network` URLs and exact values remain compatible.
- Browse diagnostics remain admin-plus-debug only, collapsed, bounded, and sanitized. Shell mount telemetry now includes a stable instance identifier plus `actualComponentMount: true` for explicit attribution.
- The previously supplied authenticated export contains 120 historical events and predates these final changes. It remains evidence for the earlier 59-entry Movies genre directory and exact genre loads, but it is not claimed as current runtime proof.
- Final validation: focused browse/route/directory 6 files/37 tests; full Vitest 36 files/283 tests; TypeScript passed; production Webpack passed in 211 seconds (184.232-second compilation) with only the two established size warnings; `git diff --check` passed.
- New standalone/data files are ESLint-clean. `NativeBrowsePage.tsx` retains the exact 17-error/2-warning HEAD baseline, `PTVShell.tsx` retains the exact 26-error/1-warning HEAD baseline, and Stylelint retains the exact `nativeBrowse.scss:492` HEAD baseline.
- Changed source/tests/docs contain no credential assignment, bearer value, raw HTTP URL, raw stable Jellyfin ID, or real private address. Generated production/Babel/Vitest artifacts were removed or restored.
- The existing development server returns HTTP 200 at `http://localhost:8080/` and serves current shell/network-label markers. Authenticated route behavior, role/debug combinations, real-library counts, browser history/scroll restoration, and touch/TV input remain manual deployment checks.

## 2026-07-14 - Login header visibility regression

- Reproduced ownership from source: the screenshot controls map to `src/ptv/modules/header/AppHeader.tsx`, mounted globally by `RootAppRouter`. It was not a page-local `PTVShell`. The experimental application bar/drawer had an equivalent missing route exclusion.
- Root cause: header visibility considered experimental/dashboard layout state but did not classify authentication routes. The login enhancer and shell registry also used separate broad regular expressions, allowing route-ownership rules to drift.
- Added one exact authentication classifier and reused it in the stable root, experimental layout, shell route registry, and login enhancer. Query parameters do not affect classification, while unrelated routes containing the word `login` do not match.
- Visible authenticated header trees now unmount on authentication routes and remount through router state when leaving them. No global CSS hiding, delay, login-card change, native fallback change, or plugin change was introduced.
- Corrective finding after the initial pass: fully unmounting stable `AppHeader` also removed `.mainDrawer .scrollContainer` and `.skinHeader`. Jellyfin's `scripts/libraryMenu` reads them during module evaluation from the login path, producing the reported null `querySelector`/`classList`, undefined `setTabs`, and circular `__WEBPACK_DEFAULT_EXPORT__` temporal-dead-zone errors.
- Corrective implementation: keep `AppHeader` as a hidden authentication compatibility host containing only those two anchors. Do not mount the visible PiggieTV header, sidebar, or drawer handle. Use a relative lazy import for `libraryMenu` so the same lifecycle is testable outside Webpack aliases.
- Final automated result: 3 focused files/35 tests and all 38 full-suite files/315 tests passed. TypeScript, scoped ESLint, production Webpack, and `git diff --check` passed. Webpack compiled in 76.139 seconds and emitted only the known aggregate asset/entrypoint-size warnings.
- Corrective current-bundle runtime result: fresh plain/query login Chrome DOM probes at 2560x1271, 1024x1366, 390x844, and 1920x1080 found no runtime overlay or visible PiggieTV header and confirmed the hidden compatibility host plus both required legacy anchors in every case.
- Remaining live checks: expired-session redirect, logout/login, successful login navigation, browser back/forward, and normal authenticated/native-fallback header retention against the configured Jellyfin server.

## 2026-07-14 - Production hardening and final verification

- Added two local CI-equivalent quality boundaries: the inherited PTV lint gate records per-file debt and rejects increases, while `lint:ptv:clean` requires every new hardening/tooling file to remain finding-free. PTV Stylelint currently has zero findings.
- Added deterministic Chromium integration coverage for authentication shell ownership, query-aware focused browsing, stale-response suppression, history restoration, paging, Curated/All directory preference, keyboard focus, and user-mediated service-worker updates. All 26 tests pass at the requested desktop, tablet, mobile, and TV viewport sizes.
- Added build provenance and a safe update lifecycle. Waiting service workers are offered to the user, activation is deferred during playback, and reload follows `controllerchange`; no unconditional startup reload is introduced.
- Extracted browse-directory presentation and shell-backdrop lifecycle while keeping request/cache/stale ownership in `NativeBrowsePage` and shell navigation/dropdown ownership in `PTVShell`. Dashboard enhancement code now loads only on dashboard routes.
- Final verification found a new runner-boundary defect: full Vitest discovered the Playwright `.spec.ts` files and produced three Playwright framework-context failures. All 334 actual Vitest tests were green. Vitest discovery is now explicitly limited to tests under `src`; the corrected full suite passes 41 files/334 tests.
- Final local results: 28 focused PTV files/165 tests, 41 full-suite files/334 tests, 26 Playwright tests, and 4 net9.0 plugin tests pass. TypeScript, inherited and clean-file ESLint gates, PTV Stylelint, API/cache contract check, secret scan, YAML parse, and production Webpack pass.
- Production Webpack completed in 199.6 seconds with the two established size warnings. The emitted main script is 857.5 KiB, combined main entrypoint 4.1 MiB, and service worker 246 KiB.
- Repository audit reports 119,114 tracked files/1333.48 MiB, of which 1303.83 MiB is historical generated/dependency material. Two project-owned PNGs exceed 1 MiB and six duplicate binary groups are candidates for a separately approved LFS/asset cleanup. No files were untracked, deleted, or history-rewritten in this pass.
- Privacy scan covers tracked and untracked non-ignored repository paths. A deliberately token-shaped dashboard sanitizer fixture was replaced with a short synthetic value; no real credential, API key, authorization value, or private key remains in the intended source/test/documentation scope.

## 2026-07-14 - Authenticated debug corrective pass

- Evidence: Manga reported 1,818 server items but stopped at 200 with 1,618 cap drops; grouping later regressed from 200 items/16 series to 50 items/7 series. Lifecycle events for Reading/Dashboard retained the prior Shows network owner; override endpoints returned 404; startup recorded status/settings/featured counts 6/3/4 and eight pre-authentication 401s; dashboard runtime was false/zero/null; build values were unknown; 101 Reading image cache-hit events and a 160-second logo observer age obscured useful evidence.
- Correction: progressive Reading paging now indexes the exact 1,818-item fixture in 37 50-item pages after a bounded 200-item initial stage. Dedupe, stale retirement, complete-only persistence, monotonic merge, stage/page/accumulated/final diagnostics, and incremental card mounting preserve first render and prevent the 50-item regression.
- Correction: route lifecycle ownership is synchronized before render/unmount and distinguishes Movies, Shows, Reading, Dashboard, and authentication. Tested sequence: `shows` -> `reading` -> `dashboard` -> history `reading` -> history `shows` -> `login`.
- Correction: current frontend and plugin source already agree on `/Ptv/v1/reading/series-overrides/{routeKind}` GET/PUT. The installed 404 response is an outdated DLL, not a path mismatch. Feature reporting and source/reflective contract tests now protect the routes; frontend state explicitly reports server authority versus browser-cache-only fallback.
- Correction: six pre-auth callers produce zero network requests/401s; after sign-in they collapse to three reads (one status, one settings, one featured) and one controlled auth retry. Dashboard diagnostics read the canonical `window.__PTV_RUNTIME_STATE__` singleton. Dev/prod provenance is explicit. Image-cache totals are aggregated and 101 hits retain only seven representative events; the 160-second observer age is discarded rather than labeled load duration.
- Verification: focused Vitest 10 files/38 tests; full Vitest 45 files/348 tests; TypeScript passed; PTV Stylelint zero; inherited PTV ESLint baseline unchanged at 170 errors/23 warnings; plugin contract passed; plugin tests 7/7; plugin Release build succeeded with zero warnings/errors; Playwright 27/27; production Webpack succeeded with only known size warnings.
- Deployment boundary: build/deploy the companion plugin DLL, restart Jellyfin, then deploy the matching frontend. Verify override GET/PUT returns success and status advertises `readingSeriesOverrides`; no routine cache/service-worker purge is required.

## 2026-07-15 - Plugin 10.11.8.2 release pairing

- Root cause: plugin `10.11.8.1` and corrected source shared the same version even though only the corrected source advertised and served `readingSeriesOverrides`. Version-only deployment checks could not distinguish the stale DLL.
- Correction: bumped project/assembly/file/manifest/status identity to `10.11.8.2`, made status fallbacks and the provider user agent use assembly identity, and added source/published manifest plus assembly contract tests. API v1, cache v7, Jellyfin target `10.11.8`, and target ABI `10.11.8.0` were intentionally unchanged.
- Frontend behavior: old `10.11.8.1` remains connected but reports a capability-specific upgrade requirement. New `10.11.8.2` with `readingSeriesOverrides` reports compatible. Reading persistence state now distinguishes server authority, upgrade-required browser cache, and transient browser-cache fallback.
- Verification: focused compatibility 2 files/12 tests; full Vitest 45 files/351 tests; plugin tests 9/9; frontend/plugin contract passed; TypeScript and scoped ESLint passed; plugin Release build/publish passed with zero warnings/errors; production Webpack passed in 116.3 seconds with two established aggregate size warnings; secret scan passed across 119,152 paths.
- Release payload: five files in `src/ptv/plugin/bin` (`.dll`, `.deps.json`, `.pdb`, `.xml`, and `meta.json`). DLL assembly and manifest versions both resolve to `10.11.8.2`. Deployment has not occurred.

## 2026-07-15 - Plugin/frontend deployment-stage verification

- Preflight found installed plugin `10.11.8.1` with the expected five files. The complete plugin directory and existing web root were backed up and verified before replacement. The Release payload contained exactly DLL, deps JSON, PDB, XML documentation, and `meta.json`; DLL and manifest both reported `10.11.8.2`.
- The first `10.11.8.2` deployment loaded its assembly but full status returned HTTP 500. Startup evidence identified Jellyfin XML serialization of the nested Reading series-override dictionary as the cause. A deterministic XML surrogate plus a configuration round-trip test corrected it; plugin tests now pass 10/10.
- After clean restart, startup loaded plugin `10.11.8.2` without dependency/controller/ABI errors. Authenticated full status returned HTTP 200, `ok=true`, `degraded=false`, API v1, cache v7, healthy cache, and `readingSeriesOverrides=true`.
- Authenticated override GET/PUT returned HTTP 200 for books, comics, manga, and reading. A synthetic correction survived restart. Original documents were restored and confirmed empty; no real Reading metadata remains changed.
- Production entry omission was corrected by importing the canonical PTV runtime from `src/index.jsx`. Shared plugin API readiness now waits for Jellyfin authentication, supports the current API client, deduplicates startup resources, and aborts Dashboard waits on unmount. Live Dashboard startup made one HTTP 200 call per distinct resource and no pre-authentication request.
- A live service-worker 404 revealed root-relative registration. Registration now uses the Jellyfin web base; `/web/serviceworker.js` became active at `/web/` scope with one registration, a controlling worker after normal reload, and no reload loop.
- Build `10.11.11-ptv-20260715.7-78a6e2b6` served successfully from the candidate `dist`. Permanent web-root replacement was denied by Windows filesystem permissions, so production provenance has not yet been proven from the normal installed web directory.
- Login probes at desktop and mobile found zero visible authenticated headers, a visible login form, retained hidden compatibility anchors, and zero plugin requests. Route telemetry advanced cleanly through Shows(1), Reading(2), Dashboard(3), Reading(4), Shows(5), back Reading(6), forward Shows(7), and Login(8).
- The live local server has no Manga items. The 1,818-item implementation remains verified by regression fixture: initial 200, page size 50, 37 pages, concurrency two, deduplicated monotonic completion, and no late partial replacement. Real-library completion time remains unavailable.
- Sanitized debug export reports production provenance, plugin `10.11.8.2`, compatible API/cache/capability state, canonical runtime owner `core-app`, runtime ready with create count one, and no bearer/auth/token/local-path findings.
- Final checks passed: 45 Vitest files/354 tests, plugin 10/10, plugin contract, TypeScript, scoped ESLint, secret scan, production Webpack in 77.647 seconds, and whitespace validation. Webpack emitted only established size warnings; no styles changed.
- Deployment recommendation: HOLD. The corrected pair is healthy, but an administrator must deploy the matching frontend to the permanent web root and verify 1,818/1,818 on the actual Manga server. No rollback occurred and backups remain retained.

## 2026-07-15 - Android primary-navigation dropdown correction

- Evidence: on physical Android Chrome, tapping Movies or Shows changed the chevron/open state but produced no usable panel. The same navigation worked on Apple mobile. The panel existed in the DOM under `.ptv-shell-nav-primary`; compact-layout horizontal overflow and the backdrop-filter containing block clipped it on Android Chromium, so this was a rendering/ownership defect rather than failed route state.
- Correction: extracted the primary dropdown into a portaled component with visual-viewport clamping, above/below placement, resize/orientation/scroll repositioning, deterministic one-menu ownership, outside/Escape/route dismissal, ARIA relationships, and focus restoration. Pointer movement over 10 pixels suppresses only the following pointer-derived click; taps, mouse clicks, keyboard activation, and remote focus remain single-event paths.
- Regression coverage: pure geometry/gesture tests plus component tests prove Android tap, portal placement, keyboard focus, outside and Escape dismissal, one navigation per selection, swipe suppression, and listener cleanup. The Android Playwright suite covers Home, Movies, Shows, Music, Reading, selection, outside/route/Escape, a real CDP touch swipe, orientation resize, and nav scrolling.
- Verification: focused Vitest 11/11; full Vitest 47 files/365 tests; TypeScript passed; changed-file ESLint passed; PTV lint baseline held at 169 errors/23 warnings with no increase; Stylelint passed; Android Playwright 9/9 and full Playwright 36/36 passed; final production Webpack completed in 74.715 seconds with only established asset/entrypoint size warnings.
- Scope: frontend shell/tests/styles only. No plugin source, deployment, API contract, route definition, cache version, commit, or remote state changed. Physical Android/iOS/TV checks remain required because local verification used Chromium mobile emulation and CDP touch input.

## 2026-07-15 - Urgent blank-screen runtime correction

- Evidence: Pixel Android Chrome and iPad Safari showed incomplete/blank rendering after authentication-route startup; iPad reported `null is not an object (evaluating 'target.addEventListener')` from `setEdgeSwipeEnabled -> updateMenuForPageType -> dispatchEvent -> React passive effects`.
- Exact null target: `NavDrawer.edgeContainer`, populated by a construction-time lookup for `.mainDrawerHandle`. Authentication correctly omits that visible authenticated control, so touch-capable edge-swipe enablement passed null to `dom.addEventListener`. The method also marked itself enabled before binding and cleanup did not retain the actual bound element.
- Correction: resolve the handle per lifecycle reconciliation; fail closed when absent; bind only after a valid target exists; retain and clean up the exact target; handle replacement without duplicate listeners; and reconcile on every page show. Regression tests cover missing, late, disabled, and replaced handles plus login-hidden to authenticated-handle to logout-hidden lifecycle.
- Portal finding: the body portal was not the crash source. Its diff does not touch drawer edge-swipe ownership or authentication compatibility DOM, so it remains enabled with its separate Android visibility tests.
- Automated result: focused 3 files/32 tests, full Vitest 48 files/370 tests, TypeScript, scoped ESLint, PTV Stylelint, Chromium Playwright 36/36, WebKit Playwright 34 passed/1 platform-policy skip, production Webpack, 119,158-path secret scan, and whitespace validation pass. The WebKit skip is limited to Safari's platform-controlled link-Tab-order assertion; all runtime, login, route, history, dropdown, and viewport cases pass. Production Webpack completed in 92.766 seconds with only established aggregate size warnings.
- Runtime probes: desktop Chrome, Pixel-class touch Chromium, and iPad WebKit plain login had populated roots, no page errors or runtime overlay, and no visible authenticated header. Static production smoke had populated roots and no page errors; authenticated production Home still requires a configured Jellyfin origin and physical-device verification.
- Environment-only noise: the standalone Webpack/static probes cannot reach a configured Jellyfin `/System/Info/Public` backend and may report server-unavailable/connection-refused messages. Those probes are not evidence of an edge-swipe or shell lifecycle failure.

## 2026-07-15 - Split-origin runtime and authenticated geometry correction

- Corrected evidence: the frontend host and Jellyfin host are deliberately different. The previous loopback-rebasing fix inferred the wrong backend host. Console evidence showed ordinary Jellyfin traffic eventually recovering the saved server while plugin API traffic remained pinned to the initial loopback root.
- Origin correction: added a pure precedence model for the explicit development backend, exact requested saved server, authenticated API client, and controlled fallbacks. URL normalization no longer rewrites hostnames. Plugin API candidates retire stale authoritative roots after a server transition. Startup logs expose only candidate counts/state, not server URLs. Production DefinePlugin output is always empty for the development backend value.
- Layout correction: removed shared-shell positioning/min-height ownership from stock `.mainAnimatedPages`, `.mainAnimatedPage`, and generic `.page`. These rules had inserted a viewport-height stock container before Home/Reading/Dashboard native content. PTV geometry remains on PTV-owned shell elements; login ownership is unchanged.
- Live result: Chromium 6/6 and WebKit 6/6 across desktop, Pixel, and iPad profiles. An explicit split-origin test seeds stale loopback values and proves the first discovery request uses the configured Jellyfin backend and never the frontend host. Login geometry, NavDrawer provenance, service-worker state, and unauthenticated Home reload also pass without browser errors.
- Validation: focused 18/18; full Vitest 51 files/385 tests; TypeScript; scoped ESLint; shell Stylelint; production Webpack in 110.1 seconds; production-address scan; 119,166-path secret scan; and `git diff --check` pass. One first-run featured-cache timeout was isolated (4/4 in 235 ms) and the immediate full rerun passed 385/385. Webpack emitted only established size warnings.
- Security: no supplied token or credential was printed, stored, or copied into the repository. The token visible in the original capture must be revoked.
- Release decision: HOLD until the existing development server is restarted with the explicit backend setting and authenticated Home, Reading, Dashboard, history, dropdown, and logout/login behavior are verified on physical clients. No deployment, plugin change, commit, push, or remote operation occurred.

## 2026-07-15 - Music duplicate player and live-loading correction

- Duplicate-player root cause: `PTVRuntimeRoot` already rendered the persistent bottom-right `PTVMediaDock`, while the Music module independently mounted `PtvMusicPlayerDock` into a body root. That second PTV renderer existed only after Music loaded, explaining the route-specific duplication. It reused the same queue/audio singleton; it was not evidence of a second native audio element.
- Ownership correction: the Music body root is now `PtvMusicOverlayHost` and renders only full-screen, queue, and playlist overlays. Its window-owned root/load promise prevents Strict Mode/HMR/remount duplication. The global dock is the only compact renderer. Jellyfin's stock bar is hidden through the active native-playback ownership class and restored when that ownership ends.
- Event-flood root cause: native audio `timeupdate` emitted unbounded queue snapshots, each queue subscriber created its own one-second timer, and the global playback service also reconciled once per second. Queue progress now publishes at most once per second, subscriber timers are gone, and global reconcile pauses while native Music has a current item. Playback-manager listeners are explicitly retired on disposal.
- Plugin-null root cause: a stale unauthenticated `ServerConnections.currentApiClient()` was selected before an authenticated `window.ApiClient`. Authentication waiting therefore expired before candidate generation, leaving candidates/responses/roots null. Authenticated-client precedence fixes that lifecycle while the configured split Jellyfin origin remains authoritative.
- Infinite-label root cause: cached Music data commonly omitted `libraryDebug`, and the deferred library-index failure path did not publish terminal presentation state. Explicit scheduled/loading/ready/failed state now preserves cached content and produces a count or retryable unavailable-live-count message after settlement.
- Music coordinator finding: route/request generation correctly suppresses stale completions and clears deferred work. Current shared API requests do not expose per-consumer transport abort, so `music-data-coordinator-route-work-cancelled` represents logical retirement rather than a claim that the underlying network transport was cancelled.
- Read-only host evidence: `/System/Info/Public` returned HTTP 200 in 98 ms; unauthenticated `/Ptv/v1/status`, `/status?full=true`, `/settings`, and `/featured` returned HTTP 401 in 1-23 ms. Fresh browser-JavaScript requests from the unauthenticated frontend origin failed at the cross-origin browser transport boundary in 3-10 ms, including Public. No token, stored credential JSON, response body, or private authentication value was captured.
- Validation: focused 5 files/11 tests; final full Vitest 55 files/392 tests; TypeScript passed; scoped ESLint zero errors/three inherited warnings; Stylelint passed; live Chromium 6/6; live WebKit 6/6; production Webpack compiled in 90.834 seconds with two established size warnings. One cold full-suite cache import timeout passed isolated and on immediate full rerun.
- Release decision: HOLD pending authenticated physical verification of the real Music route, single visible dock/audio/controller/subscription ownership, live plugin root/status, and terminal track-count state against the intended Jellyfin backend. No deployment, restart, commit, push, remote change, or credential use occurred.

## 2026-07-16 - Video dock leakage and frontend update reload correction

- Physical evidence showed the PTV bottom-right dock rendering movie metadata over Jellyfin's video route. Root cause: `PTVMediaDock` rendered any active universal playback snapshot. It now positively gates on `source=ptv-music`, Audio media identity, and non-video route ownership. Movie, Episode, Series, and Trailer states render no dock; Music -> video hides immediately and video -> Music restores one dock.
- Physical evidence also showed Reload leaving the update notice stuck. Root cause: the service waited indefinitely for `controllerchange`, lacked a direct/timeout fallback, and retained `ptv:update:reloading` in session storage so a later controller transition could be ignored. The corrected state machine clears stale markers, permits one attempt, posts `SKIP_WAITING`, reloads once on controller change, times out after three seconds, falls back directly when messaging is unavailable, and hides the notice before reload.
- Verification: focused 3 files/22 tests; final full Vitest 55 files/403 tests; TypeScript; scoped changed-file ESLint; E2E Webpack; general Playwright 8/8; production Webpack in 92.581 seconds; 119,171-path secret scan; and `git diff --check` pass. Webpack emitted only established size warnings.
- One initial full-suite run timed out the unchanged first featured-cache adoption case at five seconds (402/403). The file passed isolated 4/4 in 261 ms and the immediate complete rerun passed 403/403, providing evidence of a transient parallel timing event rather than a patch regression.
- Scope is frontend shell/update service/tests only. Plugin source, API/cache contracts, user data, deployment, restart, commit, push, and remote state were untouched. Release remains HOLD pending authenticated physical handoff and real service-worker update adoption.

## 2026-07-16 - Reading override XML serialization correction

- Runtime evidence: authenticated `/Ptv/v1/status?full` returned HTTP 500 and Jellyfin logged `NotSupportedException` for public `ReadingSeriesOverrideSettings.Routes`, a nested dictionary implementing `IDictionary`.
- Root cause: the prior XML surrogate still left the runtime dictionary as a public configuration property. Jellyfin's configuration serialization path inspected it despite the intended ignore boundary.
- Correction: the lookup is now private; `Routes` is an XML-safe, sorted array retaining the established XML element shape. Runtime reads/writes/removals use methods and defensive dictionary snapshots. A reflection test rejects any public dictionary property in the plugin configuration namespace.
- Controller and serialization coverage: populated overrides serialize/deserialize, deterministic ordering/removal works, and status/settings/featured controller paths return successful action results in the plugin test host. Capability reporting remains true for plugin `10.11.8.2`.
- Frontend evidence: HTTP 500 normalizes to `server` with `Plugin server error: endpoint returned HTTP 500`; fetch failures remain `network`. Response bodies are bounded and credential fields redacted. The dashboard labels 5xx as `plugin server error`, not endpoint unreachable or plugin missing.
- Results: plugin 13/13; focused frontend 2 files/7 tests; full Vitest 56 files/405 tests; TypeScript; scoped ESLint; plugin contract; 119,172-path secret scan; production Webpack in 105.7 seconds; and `git diff --check` pass. Webpack emitted only its established size warnings.
- Release: staged output contains exactly five files. DLL assembly/file and manifest versions are `10.11.8.2`; corrected DLL SHA-256 is `51E6BBD8D7A742A01528DC59E5A8A21AD718A602BF868F16B64C0B64A886DD05`.
- Deployment blocker: configured SSH targets rejected available non-interactive authentication. No remote file or service changed. Unauthenticated production probes returned HTTP 401 for status, full status, settings, and featured; authenticated post-restart status remains pending.

## 2026-07-16 - Production async chunk coherency correction

- Runtime evidence: a stale production runtime failed to load async chunk `90212.432920e11e02eefe99af.chunk.js`. The exact 11,721-byte chunk existed in local production output and at the Jellyfin origin. The public bare path initially returned HTTP 503 while the same path with a cache-busting query returned HTTP 200; subsequent probes returned HTTP 200 for both. This rules out an absent chunk and identifies intermittent CDN/path-cache poisoning combined with non-atomic release generations.
- Correction: production startup versions Webpack async JavaScript and CSS requests with build/commit identity. The router error boundary permits one same-origin chunk recovery reload per build/request, preserves the hash route, and clears its query marker after successful bootstrap.
- Deployment correction: the PowerShell deploy script publishes root `index.html` last through a temporary file and verifies source/destination SHA-256 for every copied asset. A temporary clean-target run copied 2,498 files, matched the index hash, and included the affected old chunk.
- Results: focused 1 file/5 tests; full Vitest 57 files/410 tests; TypeScript passed; scoped ESLint passed; production Webpack compiled in 82.371 seconds with two established size warnings; and `git diff --check` passed. An attempted `npm test -- --runInBand` was rejected because Vitest 3 has no such option; the supported `npm test` command then passed completely.
- Deployment state: no production file, CDN rule, service, plugin, or remote state changed. The attached Jellyfin log separately proves the installed plugin labeled `10.11.8.2` still uses the pre-correction public Reading override dictionary; deploy the staged XML-safe five-file payload and restart Jellyfin independently of this frontend fix.

## 2026-07-16 - Authenticated debug-export cleanup

- Export baseline: plugin connected=true, plugin version `10.11.8.2`, API `1`, cache schema `7`, Reading overrides available, compatibility compatible, and Reading indexing 2,911/2,911.
- Stale-header root cause: shell cleanup set only `mounted=false` and retained Reading title/section/navigation fields. The foundation consumed that snapshot on a Dashboard fallback route. Cleanup now resets the complete snapshot, and route-aware reconciliation rejects fallback, unmounted, and section-mismatched header state.
- Reading churn root cause: every progressive index page updated `homeData`; the broad render effect emitted `reading-page-rendered` and reverified the shell for every update. Progress now publishes in bounded monotonic milestones, render telemetry uses semantic stage/section identity, and shell readiness remains mount-owned.
- Playback noise root cause: the global service created an unconditional one-second timer and emitted reconcile events even with no item, session, or source. The interval now exists only for active Jellyfin-owned playback and is retired on idle/native ownership transitions. Video mini-player presentation code was not changed.
- Plugin diagnostics gap: only failures were appended to attempted responses. Successful status/settings/featured calls now add bounded entries containing sanitized endpoint path, HTTP status, `ok=true`, and duration. Query strings, origins, credentials, and authorization data are omitted.
- Results: focused 5 files/13 tests; final full Vitest 59 files/415 tests; TypeScript passed; scoped ESLint for new helpers/services/API passed; the PTV lint baseline reported no per-file increase; production Webpack compiled in 107.006 seconds with the established two size-warning classes. The first full run had one featured-cache timeout; isolated 4/4 completed in 267 ms and the immediate full rerun passed 415/415.
- Scope: frontend diagnostics/scheduling only. No plugin source/payload, API/cache schema, video mini-player behavior, deployment, Jellyfin restart, commit, push, or remote state changed.

## 2026-07-16 - Details ownership and video playback handoff

- Details regression root cause: `details` remained in the enhanced Jellyfin-owned route set. PiggieTV mounted details content while Jellyfin retained its legacy shell/header and stock page spacing. The details matcher also needed an explicit route boundary around shared item paths.
- Details correction: `#/details` and `#/item` are native presentation routes; the details lifecycle mounts one header-only shared `PTVShell`, maps item type to the appropriate active section, and removes it on teardown. Existing Jellyfin details metadata/actions remain the content owner. SCSS resets the stock top offsets and replaces the large viewport-dependent gap with the shared header safe area. `#/music/item/...` and `#/video` are explicitly protected from details ownership.
- Playback regression root cause: the dock correctly hid on video, but playback state was only visually filtered. The module-level native Music audio element continued playing and queue events could republish stale `ptv-music` ownership while Jellyfin video was starting.
- Playback correction: route and playback-manager video ownership synchronizes immediately, invokes one idempotent native Music pause, preserves queue/index/position, and blocks Music publication until video ownership ends. Video stop/route exit never calls Music play; the user must resume explicitly.
- Results: focused 6 files/40 tests; final full Vitest 60 files/431 tests; TypeScript passed; scoped regression ESLint passed; changed Stylelint passed; production Webpack completed in 106.7 seconds with established size warnings; E2E harness 36 passed/6 opt-in live skipped; and `git diff --check` passed.
- Evidence boundary: the first full run timed out one unchanged featured-cache case, which passed isolated 4/4 and on the immediate 431/431 full rerun. The live dev origin returned HTTP 200 and served-bundle provenance passed, but fresh Playwright contexts had no saved server/authentication and stopped at Select Server. Five live assertions failed before authenticated details/video coverage and remain manual checks rather than verified behavior.
- Scope: frontend details shell, route classification, Music pause handoff, playback-state ownership, styles, and tests. Plugin/backend source and payload, API/cache contracts, deployment, restart, commit, push, and remote state were not changed.

## 2026-07-16 - Native details layout regression correction

- Reproduction analysis found multiple stock Jellyfin layout rules still controlling a PiggieTV-owned route: `.itemBackdrop` consumed `40vh` in normal flow; `.detailRibbon` retained a fixed height; `.detailPagePrimaryContent` retained `padding-left: 32.45vw`; the absolute `.detailLogo` sat under the fixed shell; and an unnamed two-column grid received three Jellyfin primary children, forcing content into an implicit row/column.
- Added `detailsLayout.js` to apply/release native layout classes and reversibly relocate the logo. Updated details SCSS with named grid areas, centered bounded containers, readable overview/meta widths, wrapping chip rows, aligned secondary shelves, mobile stacking, and persistent-dock bottom clearance. The selectors remain below `.ptv-detail-page`, so native fallback/admin pages and `#/video` are unchanged.
- Added DOM lifecycle tests and real-style Playwright geometry coverage. Desktop `2560x1271` asserts sane poster/content top position, centered/aligned containers, visible logo, wide overview, and wrapping metadata. Mobile `390x844` asserts one-column placement, wrapped chips, and no horizontal overflow.
- Commands/results: focused Vitest passed 7 files/42 tests; `npx vitest run` passed 61 files/433 tests; `npm run build:check` passed; scoped ESLint passed; details Stylelint passed; `npx playwright test` passed 38 with 6 opt-in live tests skipped; `npm run build:production` compiled in 101.095 seconds with the established asset/entrypoint size warnings.
- Live probe evidence: `http://10.16.0.125:8082` returned HTTP 200 and bundle/provenance inspection passed. Clean browser contexts rendered Select Server, not `#loginPage` or authenticated details. A second run with `PTV_LIVE_JELLYFIN_URL=http://10.16.0.50:8096` still observed `localhost` as the first discovery host in the retained dev selection. These failures occurred before details rendering and do not replace the passing deterministic geometry tests; authenticated physical checks remain open.
- Playback protection: the full suite still passes Music queue, playback ownership, and media-dock tests. No Music/video handoff implementation was changed in this pass.
- No plugin/backend source, deployment, restart, commit, push, or remote state changed.

## 2026-07-17 - Native details artwork and premium glass correction

- Root cause: native details geometry was isolated, but the stock flowing artwork remained visually suppressed without a replacement page-wide image layer. Existing section fills were also opaque enough to hide the themed background, leaving a flat black/purple presentation.
- Added a lifecycle-owned fixed details backdrop. Item hydration supplies bounded Backdrop, Thumb, and Primary URLs; load failure advances through the ordered candidates and exhaustion selects a themed fallback. A later DOM refresh cannot overwrite the authoritative candidate chain.
- Added details-scoped glass tokens and applied reusable glass roles to the ribbon, poster, action controls, metadata, primary sections, Cast & Crew, and related shelves. Layered dark masks, vignettes, and purple wash protect readability while keeping artwork visible. Low-power/reduced-motion/filter fallbacks are bounded and layout-stable.
- Added DOM tests for ownership, backdrop fallback order, idempotence, teardown, and glass roles. Added desktop/mobile Playwright assertions for one native header, artwork presence, header clearance, centered/aligned secondary content, readable metadata, chip wrapping, and no horizontal overflow.
- Results: focused Vitest 15/15; full Vitest 61 files/436 tests; TypeScript passed; scoped ESLint and details Stylelint passed; focused Playwright 2/2 passed; production Webpack completed in 101.809 seconds with the established asset/entrypoint warnings; `git diff --check` passed apart from repository line-ending notices.
- Scope protection: `#/video` remains Jellyfin-owned, `#/music/item` remains Music-owned, and no playback implementation changed. Passing queue/playback-state/media-dock tests protect the existing video handoff. Authenticated real-item Movie/Series/Season/Episode visual checks remain manual.

## 2026-07-17 - Shared shell full-width glass regression correction

- Root cause: `.ptv-details-shell-root .ptv-shell-header` gave the complete details header a rounded glass background, border, shadow, and blur. The shared mobile breakpoint separately applied a full-width glass surface. Desktop happened to inherit a transparent root, but that ownership was implicit and utility icons had no independent surface.
- The shared header root now explicitly owns no visual surface at every breakpoint. Its desktop grid uses equal flexible outer tracks so the existing glass primary nav stays physically centered. Utility icon buttons now own bounded purple-tinted glass with border, inset highlight, shadow, and glow; Search retains its larger circle.
- Details artwork, masks, and translucent content panels were not changed. Android portal dropdown implementation and playback implementation were not changed.
- Results: focused Vitest 6 files/26 tests; full Vitest 62 files/439 tests; TypeScript passed; scoped ESLint passed; shell/details Stylelint passed; focused Playwright 15/15 plus tablet shell 5/5; full Playwright 42 passed/6 live skipped; production Webpack passed in 90.6 seconds with established size warnings; compiled CSS contains `-webkit-backdrop-filter`; whitespace validation passed.
- Manual evidence still required on authenticated physical desktop, Pixel Chrome, and iPad Safari. No plugin/backend source, API/cache contract, deployment, restart, commit, push, or remote state changed.

## 2026-07-17 - Details lifecycle, artwork, version, and video presentation correction

- Root cause: item-details asynchronous work had no common generation owner, so prior item responses could mutate a newly selected item. The native enhancement also set its handled marker before authenticated API readiness, making the first navigation skip artwork until refresh. Image slots had no coordinated preload state or complete parent fallback chain.
- Added an item request gate and applied item/generation guards to root hydration, sections, cast, similar items, seasons, episodes, and artwork. New navigation clears stale visible content immediately. Artwork now preloads through item Backdrop, related parent/season/series Backdrop, Thumb, Primary, and themed fallback while stable poster/logo geometry prevents content jumps.
- Added shared media-source normalization before card/list badges and version selectors. Stable file/source identity removes duplicate API representations while retaining the richer record, so unique playable-source count drives the UI.
- Player presentation now supplies an episode-aware heading with parent-title fallback, lighter purple-blue OSD glass, and low-power fallbacks. Shell utility icons use explicit equal-size grid centering. Existing `#/video` ownership and Music pause/dock-hide/no-auto-resume behavior were not altered.
- Added request-gate, source-deduplication, video-title, OSD-style, shell-icon, stale-artwork, and fallback regression coverage. Final results: focused checks passed; full Vitest 66 files/450 tests; TypeScript passed; scoped ESLint no errors; changed Stylelint passed; focused Playwright 7/7; production Webpack compiled in 84.892 seconds with established size warnings; `git diff --check` passed with line-ending notices only.
- One earlier full run timed out the unchanged featured-cache test at its five-second ceiling; that suite passed isolated and the final full run passed it in 950 ms. Authenticated physical visual/audio checks remain pending. No plugin/backend source, deployment, restart, commit, push, or remote state changed.

## 2026-07-18 - Dashboard utility, Settings shell, and Details first-render correction

- Runtime symptoms: the admin Dashboard utility disappeared when the shell mounted before user readiness; shell glyphs sat left of center; Settings retained Jellyfin's legacy shell; and Details first navigation showed plain/stale layout until hard refresh while duplicating item/image work.
- Dashboard correction: provisional unauthenticated admin results are no longer cached. Jellyfin `localusersignedin` and `localusersignedout` events invalidate/reconcile access so the admin-only utility tracks the current user without remounting.
- Icon correction: shell/search contexts now override the global `.ptv-icon` right margin with zero, leaving the existing grid centering and glass button geometry authoritative.
- Settings correction: the settings lifecycle mounts/unmounts a shared header-only `PTVShell`; a route class applies header-safe spacing only to known Settings page roots.
- Details correction: the item controller publishes `detailsrendered` only after the current generation commits. The PTV enhancer consumes that item, paints direct artwork before non-blocking parent resolution, reasserts native classes after DOM changes, and avoids a redundant full item fetch and poster preload on the normal path.
- Results: focused Vitest 24/24 and admin rerun 2/2; final full Vitest 69 files/457 tests; TypeScript passed; scoped ESLint zero errors/five inherited warnings; Stylelint passed; Playwright 7/7; production Webpack passed in 106.7 seconds with established size warnings; `git diff --check` passed with line-ending notices.
- Remaining evidence boundary: authenticated physical checks on the split-origin dev runtime are still required for first-paint artwork timing, Dashboard visibility, Settings shell replacement, and real network request reduction. No plugin/backend, playback ownership, deployment, restart, commit, push, or remote operation occurred.

## 2026-07-18 - TV compatibility and webOS recovery

- Physical baseline: LG TV photographs showed giant PTV/hero branding, undersized and collapsed cards, overlap, and a legacy Jellyfin drawer on a PTV-owned Details route. The failure shape was consistent with desktop fluid CSS and capability-heavy glass being used by an older TV engine without one authoritative ten-foot profile.
- Detection correction: the client profile now identifies webOS, Tizen, Android TV, Fire TV, Roku, explicit ten-foot mode, and generic TV signals independently of resolution. It publishes platform/reason/capability state to root classes/data and sanitized diagnostics; a desktop Chrome 1920x1080 user agent remains non-TV.
- Layout correction: late-loaded `tv.scss` fixes hero, shell, card, rail, overscan, focus, and Details dimensions without global transforms. Home title art is bounded/hidden where the TV hero already supplies branding, cards cannot flex-shrink into pills, and rail controls stay visible. `webos.scss` supplies static purple glass without blur/reflection dependence.
- Interaction correction: the route-scoped focus engine performs deterministic geometric arrow movement, scrolls focused elements into view, restores per-route focus, and handles supported TV back keys. TV mode suppresses desktop hover expansion.
- Route/shell correction: native Music and Reading aliases are recognized, Jellyfin chrome suppression remains scoped to mounted native ownership, and shell ownership is established before paint. `#/video` and the existing Music pause/dock-hide handoff were not modified.
- Results: focused Vitest 4 files/23 tests; full Vitest 72 files/477 tests; TypeScript passed; scoped TV-code ESLint passed; changed Stylelint passed; Playwright 43 passed with 6 opt-in live tests skipped; production Webpack passed in 107.5 seconds with established asset/entrypoint size warnings.
- Evidence boundary: no physical TV was available to this process, so webOS/Tizen/native-wrapper acceptance remains pending after frontend deployment and cache/service-worker refresh. No plugin/backend source, deployment, restart, commit, push, or remote state changed.
