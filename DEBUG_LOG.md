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
