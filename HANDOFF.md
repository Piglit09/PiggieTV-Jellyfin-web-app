# PiggieTV Handoff

Updated 2026-07-14 for HEAD `568e7eac3b`; Reading production-hardening source is present in `71666e7d02`.

## Where The Project Is

PiggieTV is a Jellyfin Web customization with a guarded singleton runtime, shared PTV shell, native Home/media/Music/Reading/Requests routes, persistent playback UI, featured cache v7, recommendation and Row Builder tooling, and a companion .NET 9 Jellyfin plugin.

The Reading hardening task remains complete and unchanged. Movies/Shows focused browse is implemented, and the current worktree finishes focused-loader identity, exact-value genre directory presentation, truthful Studios & Networks terminology, and shell mount attribution before deployment. One complete normalized key controls focused effect ownership and cache isolation; exported diagnostics retain exact public filters while excluding raw Jellyfin IDs. The next work is review/commit followed by frontend deployment and the remaining authenticated route matrix, not another broad rewrite.

## Important Current Decisions

- `src/ptv/core/app.js` is the only full runtime initializer. Components consume the runtime; they do not bootstrap it.
- `PTVShell` and the route controller own navigation state. Do not add page-local competing route state.
- The persistent runtime root owns the global media dock and playback controls.
- Featured content remains cache schema 7.
- Reading local-storage home cache remains schema 4.
- Reading kind precedence is manual override, library hint, reliable local evidence, comic archive format, then Book.
- ComicVine provider identity must not turn a Manga-library item into a Comic.
- Year is metadata, not inferred series identity.
- Series overrides are plugin-authoritative. Browser storage is only an optimistic cache/migration fallback.
- Provider deck/description copy must not become the item title.
- Reading metadata application is field-selective. Empty provider values do not clear existing metadata, existing artwork defaults to preservation, and Reading does not use broad `ReplaceAllMetadata`.
- Reading diagnostics require both admin authorization and explicit debug mode.
- Genre display normalization never rewrites the query value. Exact case-insensitive deduplication and explicit alias groups are allowed; fuzzy genre merging is not.
- Shows `view=networks` remains URL-compatible, while its visible directory label is **Studios & Networks** because the data path is `getStudios` plus `StudioIds`.

## What Changed In The Current Worktree

### Shared Reading Identity

- `readingFilename.ts` parses title, series, volume/issue/chapter, year, edition/format, confidence, and removed release tokens.
- `booksClassification.ts` owns pure route-kind classification and has direct regressions for Manga versus ComicVine evidence.
- `booksSeries.ts` applies deterministic grouping precedence and excludes year from group identity.

### Durable Series Overrides

- `booksSeriesOverrides.ts` reads/writes the plugin endpoint and migrates browser overrides without making localStorage authoritative.
- The plugin adds `GET/PUT /Ptv/v1/reading/series-overrides/{routeKind}` plus configuration models/service support.

### Identify And Metadata Apply

- `itemidentifierUtils.js` normalizes provider candidates and ranks stable provider ID, ISBN, series, title, issue/volume, year, and creator evidence.
- `itemidentifier.js` provides Reading-specific current/proposed field selection and independent metadata/artwork status.
- Native Google Books search uses the plugin proxy. ComicVine continues through Jellyfin remote search.
- Safe provider links are allowlisted.

### Diagnostics And Layout

- `readingDiagnostics.ts` gates, groups, bounds, and redacts Reading diagnostics.
- `books.scss` and `itemidentifier.scss` provide fluid widths, touch controls, horizontal shelf overflow, and bounded internal scrolling.

### Dashboard And Performance Follow-up

- `debugExportSanitizer.ts` is the final boundary for copied/serialized dashboard reports; the live admin panel remains operationally detailed.
- `PtvTmdbMetadataService` now uses cache-first lookup, bounded parallelism, per-request cancellation, limited remote work, reusable credential validation, and partial-result counters.
- `browseLoadingPolicy.ts` prioritizes first-visible shelves and avoids the former random Featured query; sections still publish independently.
- `images.ts` uses capped expiring failure caches, while browse cards advance through shared fallback candidates.
- `PTVShell` emits its mount diagnostic once per actual shell backdrop component mount.

### Authenticated Runtime Corrective Hardening

- `debugExportSanitizer.ts` replaces complete `data:image` and `blob:` values, preserves semantic versions/build IDs, and omits credential lengths and SMTP password-state fields.
- `routeController.ts` synchronizes the current browser location before recording shell lifecycle counters, removing stale query attribution during soft navigation.
- `NativeBrowsePage.tsx` emits bounded focused-load category/filter/page/count/timing/scope/sort evidence without private IDs or request URLs.
- Regression coverage includes query-only lifecycle transitions and an exact Universal Pictures second-page query using `StudioIds`, `Limit=50`, `StartIndex=50`, and no `SearchTerm`.

### Focused Loader Identity Correction

- The old coarse loader key was diagnostic-only; route-object dependencies and route-generation checks already drove behavioral reload/suppression.
- `focusedBrowseLoader.ts` now provides the authoritative internal key for effect ownership and focused cache identity. It contains kind, view, resolved scope, parent context, exact genre/studio/network, resolved metadata IDs, search, sort, page, offset, and page size.
- The Jellyfin API adapter has no `AbortSignal` contract. Keyed owner tokens retire old work and suppress late completion; diagnostics do not claim network cancellation.
- New-key loads clear prior focused results. Matching pages accumulate with item-ID deduplication, while prior filters restore only their own bounded cache entries.
- Safe diagnostic keys keep exact public labels, for example `movies:genre:genre:unscoped:Crime:SortName:Ascending:0:50`, but omit/fingerprint private IDs and arbitrary search text.

### Genre Directory, Network Label, And Shell Attribution

- `genreDirectory.ts` presents compact searchable alphabetical genre cards while preserving every exact original Jellyfin value for requests.
- Case-only duplicates collapse deterministically. Explicit alias groups remain transparent and expose their exact member values; unrelated near-matches never merge.
- Curated mode hides only a bounded exact sensitive set. All metadata mode restores the complete server directory and is stored as a per-user browser preference.
- Metadata `ChildCount` values drive directory counts; no per-genre item-query fan-out was added.
- Shows displays **Studios & Networks**, retains `view=networks`/`view=network`, and continues exact `StudioIds` queries.
- Browse diagnostics remain admin-plus-debug only, collapsed, bounded, and privacy-safe.
- `ptv-shell-mounted` now carries a stable shell-instance identifier and `actualComponentMount: true`, so route/backdrop events are distinguishable from actual component mounts.

```text
Focused browse/route: 6 files, 37 tests passed
Full Vitest suite:     36 files, 283 tests passed
TypeScript:            passed
New/data-file ESLint:  passed, zero findings
NativeBrowse ESLint:   17 errors / 2 warnings both at HEAD and in the worktree
PTVShell ESLint:       26 errors / 1 warning both at HEAD and in the worktree
Scoped Stylelint:      1 unchanged nativeBrowse.scss:492 baseline error
Production Webpack:    passed in 211s (184.232s compilation)
git diff --check:      passed
Secret/private scan:   passed for changed source/tests/docs
Current dev bundle:    HTTP 200 at http://localhost:8080/ with current markers
Plugin build:          not required; no plugin source or contract changed
```

## Validation Already Completed

```text
Focused Reading/Identify: 6 files, 43 tests passed
Debug/performance tests:   3 files, 5 tests passed
Full Vitest suite:         30 files, 243 tests passed
TypeScript:                passed
Scoped ESLint:             zero errors; 8 existing nested-render warnings
Scoped Stylelint:          passed
Plugin Release build:      passed, 0 warnings / 0 errors
Plugin tests:              4 tests passed
Production Webpack:        passed in 110.7s (97.673s compilation)
git diff --check:          passed
```

Production Webpack emitted only the repository's existing aggregate asset-size and entrypoint-size warnings. Repository-wide ESLint still reports the exact 172-error/126-warning baseline and repository-wide Stylelint the exact 140-error baseline. New standalone files lint clean; touched legacy browse/shell findings are on unchanged lines. Generated build/test artifacts were cleaned or restored.

## Movies/Shows Focused Browse Delivery (2026-07-14)

- `browseRoute.ts` owns canonical parsing/building for view, scope, genre/studio/network, collection/series context, query, sort, order, and page.
- `routeIdentity.ts` and the shell controller now treat query-only changes as distinct route state.
- Base Movies/Shows pages retain the approved progressive shelf loader. Focused views render only their directory or paged grid.
- Movies views: Latest, Trending, Genres, exact Genre, Studios, exact Studio.
- Shows views: Continue, Latest, Trending, Genres, exact Genre, Studios & Networks, exact Studio/Network, and series-scoped Seasons. Existing network route values remain unchanged.
- `anime`, `animemovies`, and `cartoons` resolve through Jellyfin user views to real IDs; unresolved aliases show an error rather than broad media.
- Genre uses Jellyfin `Genres`; studio/network names resolve exactly to metadata IDs and use `StudioIds`; filters are applied before 50-item paging.
- Trending uses the deterministic local-library formula recorded in `ARCHITECTURE.md`; it does not alias Recently Added or make live per-card provider requests.
- Footer metadata chips now build typed browse URLs rather than ordinary Search URLs.
- Browse diagnostics are admin-plus-debug only, collapsed, bounded, and redacted.

Final local validation:

```text
Focused hardening:    5 files, 22 tests passed
Full Vitest suite:    34 files, 263 tests passed
TypeScript:           passed
New-file ESLint:      passed, zero findings
Legacy touched lint:  no new findings versus HEAD baselines
Scoped Stylelint:     one unchanged nativeBrowse.scss:492 baseline error
Production Webpack:   passed in 106.7s (92.588s compilation)
Plugin build:         not required; no plugin code changed
```

### Authenticated Evidence And Limits

The supplied authenticated dashboard export parsed successfully with 120 events. It proves Movies genre-directory loads (59 entries), exact genre loads (2/2 and 50/395 items), a 50-item first-page request completing in 634.6 ms, and a healthy fresh/stored featured cache v7 with 356 items, 25 sections, and 6 persisted recommendation rows. It also captured the stale lifecycle-route attribution that is now regression-tested.

It does **not** prove Universal Pictures/network selection, Shows focused views, Anime/AniMovies/Cartoons scope isolation, Trending stability, season routes, second-page UI accumulation, browser history/scroll restoration, or non-admin/admin-debug authorization combinations. Keep the delivery status at pending authenticated sign-off until those checks pass against the deployed bundle.

### Focused Browse Live Matrix

1. Direct-load, refresh, back, and forward on base `#/movies` and `#/shows`.
2. Verify `view=latest` differs materially and is DateCreated descending.
3. Verify Shows `view=continue` contains resumable items only.
4. Verify Trending order is stable across refresh while inputs are unchanged.
5. Open Genres, select a value containing punctuation/Unicode, load a second page, and return from item details.
6. Open Movies Studios, select Universal Pictures, and confirm exact Jellyfin metadata matches and total count.
7. Open Shows Studios & Networks, select a known network/studio such as 4Kids, and confirm exact `StudioIds` filtering with no title-search leakage.
8. Verify `topParentId=anime`, `animemovies`, and `cartoons` never leak broad libraries; verify an unknown alias fails closed.
9. Verify `view=season` without `seriesId` shows the recovery state and a complete series-scoped URL lists seasons.
10. Change filters quickly and confirm an older response never replaces the active route.
11. At desktop/mobile widths, verify grid, Load More, touch/keyboard/remote activation, visible focus, and return scroll position.
12. As non-admin and admin-with-debug-off, confirm no browse diagnostics. As admin with debug on, confirm the panel is collapsed and redacted.

Deployment is frontend-only. No plugin DLL or plugin restart is required. Install the new web bundle, allow the service worker to update or perform one hard refresh, then run the remaining matrix. Application data caches do not need clearing. The current development bundle is available at `http://localhost:8080/`; its HTTP and marker checks do not replace authenticated route testing.

## Debug/Performance Live Verification

1. Copy the global dashboard report and confirm it contains useful health/timing/count fields but no private host, user/item ID, token, authorization header, local path, SMTP credential, or raw sensitive URL.
2. Trigger a featured refresh with a warm TMDb cache and confirm cache hits do not consume the remote-work budget.
3. Trigger a cold/slow refresh and confirm attempted/completed/skipped/failed/cancelled/partial counters are coherent and completed enrichment survives timeout/cancellation.
4. Open Movies and Shows with network timing visible. Confirm the hero and first shelf become interactive before slower shelves finish, and confirm no duplicate exact shelf request is issued.
5. Confirm standard poster rows use lean list payloads and richer hero data is fetched separately.
6. Break one poster URL temporarily. Confirm the card advances to another candidate/placeholder, other images continue, and the failed candidate is retried after expiry or reload.
7. Change focused backdrops repeatedly and confirm `ptv-shell-mounted` does not increment for those changes.

## Live Verification Matrix

Deploy the rebuilt frontend and matching plugin, restart Jellyfin, then verify:

1. `#/reading`, `#/reading/books`, `#/reading/comics`, and `#/reading/manga` load directly and after refresh.
2. Reading cached content appears before background shelves when a cache exists.
3. A slow/failed shelf does not blank ready shelves.
4. ComicVine result selection keeps canonical title, issue/series, creators, overview, provider ID, and selected artwork after refresh.
5. Google Books searches by title and ISBN and applies only selected fields.
6. Existing metadata is not erased by empty provider values.
7. Existing primary art is preserved unless replacement is explicitly selected.
8. Manga library items remain Manga after ComicVine matching.
9. Ancient Magus/Slightly Older Girlfriend-style files group consistently without year becoming group identity.
10. Manual series overrides persist across devices and Jellyfin restart.
11. Non-admin and non-debug users cannot see Reading diagnostics; debug output is redacted and bounded.
12. Horizontal shelves work with touch, mouse/trackpad, keyboard, and remote controls.
13. Layout remains usable at 390, 768, 1440, and 2560 pixel widths.
14. Active music playback and the media dock survive navigation through Reading pages.
15. The legacy Jellyfin header does not reappear during soft route changes. One transient appearance was reported and cleared after hard refresh, so monitor route-class cleanup closely.

## Useful Commands

```powershell
npx vitest run src/ptv/modules/books/readingFilename.test.ts src/ptv/modules/books/booksSeries.test.ts src/ptv/modules/books/booksSeriesOverrides.test.ts src/ptv/modules/books/booksClassification.test.ts src/ptv/modules/books/readingDiagnostics.test.ts src/components/itemidentifier/itemidentifierUtils.test.js
npm test
npx tsc --noEmit --pretty false --incremental false
npx eslint src/components/itemidentifier/itemidentifier.js src/components/itemidentifier/itemidentifierUtils.js src/ptv/modules/books src/ptv/core/config.ts src/ptv/core/pluginApi.ts
npx stylelint "src/ptv/modules/books/books.scss" "src/components/itemidentifier/itemidentifier.scss"
dotnet build src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj -c Release --no-restore
npm run build:production
git diff --check
```

The broad ESLint command may report the eight known nested-render warnings in `booksPage.tsx`; treat new errors separately.

## Final Audit Worktree Guidance

- Do not discard unrelated user changes.
- The four root project-memory documents are tracked, current, and belong in the intended commit scope.
- Root `ptv-dev-server*.log` files are generated machine-local output. They are removed from tracking and narrowly ignored; the active server may keep local copies open.
- Review the focused debug/performance files, project-memory updates, `.gitignore`, and generated-log removals before committing. The Reading frontend/plugin implementation is already present in HEAD history.
- `src/components/itemidentifier/itemidentifierUtils.test.js` was already modified outside this follow-up; preserve it and decide its commit scope separately.
- Do not commit generated `dist`, plugin `bin/obj`, Vitest result, or Babel cache output.
- Confirm the plugin DLL and frontend bundle were produced from the same worktree before live testing.

## Stop Conditions

Do not claim the Reading work fully deployed until the authenticated provider/apply, restart persistence, and device checks above pass. If a live check fails, record the request/response shape and current item payload in `DEBUG_LOG.md` without credentials, tokens, item IDs, server addresses, or local paths.

## 2026-07-14 - Production Hardening Handoff

The current worktree adds CI, provenance, safe service-worker updates, deterministic browser integration tests, directory/shell decomposition, repository and bundle audits, compatibility checks, and contributor/release guidance. It deliberately preserves plugin API v1, cache v7, recommendation persistence, Reading metadata behavior, playback ownership, focused-loader identity, and Jellyfin fallback routes.

Use these commands for the release gate:

```powershell
npm run test:ptv
npm test
npm run build:check
npm run lint:ptv
npm run lint:ptv:clean
npm run stylelint:ptv
npm run test:e2e
npm run test:plugin-contract
npm run test:plugin
npm run build:production
npm run build:report
npm run repository:report
npm run secret:scan
git diff --check
```

The final local results are 165 focused PTV tests, 334 full-suite tests, 26 Chromium tests, and four plugin tests passing. TypeScript, both ESLint gates, Stylelint, plugin contract, privacy scan, and production Webpack pass. The Webpack output retains only the established asset/entrypoint warnings.

Before commit, restore tracked generated changes under `node_modules/.vite`, `node_modules/.package-lock.json`, and plugin `bin/obj`; remove ignored `dist`, `e2e/.harness`, and `test-results`. Keep root project-memory files, CI/workflow files, `.quality`, hardening scripts, e2e sources, contributor docs, and package/root lock changes in scope. Do not remove or untrack the historical dependency trees without a separate approved migration.

Deployment order: build/test the plugin and frontend from the same revision, deploy the existing compatible plugin only if the installed version is not 10.11.8.1, restart Jellyfin only when replacing that DLL, then deploy the frontend and accept the offered service-worker update. A plugin restart is not required for the frontend-only hardening changes. Application caches do not need clearing; a hard refresh/service-worker clear is recovery-only if the old bundle remains controlled.

## 2026-07-14 - Authentication header visibility checkpoint

- Root cause: `RootAppRouter` mounted the global stable `AppHeader` for every non-dashboard stable route, including login. The experimental `AppLayout` independently had the same missing authentication boundary for its Jellyfin-style app bar/drawer. The supplied header was the stable `AppHeader`, not a stale page-local `PTVShell` instance.
- Added `authenticationRoutes.ts` as the only authentication-route classifier. It accepts hash, hashbang, pathname, and full Jellyfin-web locations, ignores query parameters, and exact-matches login, server-selection, password, manual-login, quick-connect, and signup routes.
- Stable and experimental authenticated controls are absent on authentication routes and return through normal React Router lifecycle when navigation leaves authentication. The stable `AppHeader` retains only a `display:none` compatibility host with Jellyfin's `.mainDrawer .scrollContainer` and `.skinHeader` anchors; `libraryMenu` requires them during login-time module initialization. The route registry and login enhancer reuse the same classifier.
- No login card markup/style, native fallback route, authenticated page header, plugin source, playback behavior, or cache schema changed.
- The initial full unmount caused a configured-login runtime cascade because `libraryMenu` received no compatibility DOM. The follow-up preserves only the hidden anchors and keeps every visible authenticated control unmounted.
- Final verification passed: focused 3 files/35 tests; full Vitest 38 files/315 tests; TypeScript; scoped ESLint with zero findings; production Webpack in 78.6 seconds with a 76.139-second compilation and only the two established size warnings; `git diff --check` apart from line-ending notices.
- Fresh headless Chrome against plain/query login at desktop, tablet, mobile, and TV sizes found no runtime overlay, `.ptv-app-header-root`, or visible `.ptv-skinHeader`; every case found the hidden compatibility host and both required legacy anchors.
- Stylelint was not run because no style source changed. The companion plugin was not rebuilt because this is a frontend-only lifecycle correction.
- Before deployment sign-off, manually verify a real expired-session redirect, logout/login, successful login restoration, and back/forward navigation with the configured server. Confirm normal authenticated pages and native fallback pages retain their headers.
