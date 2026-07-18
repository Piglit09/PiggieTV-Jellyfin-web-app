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

Deployment order for the corrected pair: build/test the plugin and frontend from the same revision, deploy plugin `10.11.8.2` and its matching `meta.json`, restart Jellyfin, verify `/Ptv/v1/status` advertises `readingSeriesOverrides`, then deploy the frontend and accept the offered service-worker update. Application caches do not need clearing; a hard refresh/service-worker clear is recovery-only if the old bundle remains controlled.

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

## 2026-07-14 - Authenticated debug corrective checkpoint

- Reading progressive indexing is implemented in `readingProgressiveIndex.ts` and integrated by `booksApi.ts`/`booksPage.tsx`. The first stage is 200 items, page size is 50, request concurrency is two, and the 1,818-item fixture reaches a final 37-page index. Do not restore the old terminal cap or allow a smaller refresh/grouping stage to replace a fuller active index.
- Route ownership is exact (`movies`, `shows`, `reading`, `dashboard`, `login`) and is synchronized before lifecycle render/unmount telemetry. The Chromium smoke path Covers Shows -> Reading -> Dashboard -> back Reading -> back Shows -> login.
- Reading override GET/PUT routes existed in current plugin source before this pass; the deployed 404s mean the installed DLL is stale. The source status response now advertises `readingSeriesOverrides`, and contract checks cover source attributes plus status feature reporting. Deploy the rebuilt plugin and restart Jellyfin before validating overrides.
- Plugin startup now performs zero network reads before authentication in the regression fixture, then one each for status, settings, and featured; duplicate callers share those requests. Runtime diagnostics use the existing `window.__PTV_RUNTIME_STATE__` singleton and never construct a dashboard runtime.
- Telemetry aggregates 101 identical Reading image-profile hits into seven representative events while retaining a total of 101. Route/API failures have priority over image cache/load noise. Static-logo timings use resource duration when available and label observer age as discarded.
- Verified commands/results: focused Vitest 38/38; full Vitest 348/348; TypeScript clean; PTV Stylelint clean; ESLint baseline unchanged at 170 errors/23 warnings; plugin contract clean; plugin tests 7/7; plugin Release build clean; Playwright 27/27; production Webpack clean apart from the two known size warnings.
- Generated Vitest and plugin `bin/obj` changes were restored. Intended untracked files are the new progressive-index tests/module, auth-startup test, observability buffer/tests, dashboard runtime diagnostic/tests, and plugin override contract test.

## 2026-07-15 Release Candidate Handoff

- Old installed/source plugin: `10.11.8.1`; corrected release plugin: `10.11.8.2`.
- Copy all files from `src/ptv/plugin/bin` into the Jellyfin PiggieTV plugin directory: `Jellyfin.Plugin.PiggieTV.dll`, `Jellyfin.Plugin.PiggieTV.deps.json`, `Jellyfin.Plugin.PiggieTV.pdb`, `Jellyfin.Plugin.PiggieTV.xml`, and `meta.json`.
- Restart Jellyfin, then confirm `/Ptv/v1/status` reports plugin/version `10.11.8.2`, API `1`, cache `7`, and `readingSeriesOverrides=true`. Only then deploy the matching frontend bundle.
- Expected old-plugin behavior: connected, API/cache usable, Reading server persistence marked upgrade-required, browser fallback labeled local cache. Expected new-plugin behavior: compatible and server persistence available.
- Automated release result: focused compatibility 12/12, full Vitest 351/351, plugin 9/9, TypeScript/scoped ESLint/contract/secret scan clean, Release build/publish clean, and production Webpack successful with only established size warnings.
- After deployment, manually test an override save/reload, the old-plugin upgrade warning if rollback is exercised, dashboard version/capability labels, login/auth transitions, active playback, and normal service-worker update adoption. No routine cache purge is required.

## 2026-07-15 Deployment Verification Handoff

The local Jellyfin instance now runs the corrected five-file plugin `10.11.8.2`. Full status is healthy and advertises API v1, cache v7, and `readingSeriesOverrides`. Override GET/PUT succeeded for books, comics, manga, and reading; a synthetic value survived restart and was removed afterward. The complete pre-deployment plugin backup remains retained.

The initial `.2` DLL exposed a real configuration defect: XML serialization failed on the nested Reading override dictionary and made full status return HTTP 500. Deploy only the newly rebuilt payload containing the deterministic XML surrogate and its 10/10 plugin test result.

The matching production frontend candidate is build `10.11.11-ptv-20260715.7-78a6e2b6`, commit `78a6e2b6bc-dirty`. It includes the production runtime entry import, authenticated API-client readiness, Dashboard request deduplication, and relative `/web` service-worker registration. It was verified by serving repository `dist` directly through Jellyfin. The permanent Program Files web root is still unchanged because the current process could not write it; an administrator must deploy it or configure the service to use the verified directory.

Live checks passed for query-bearing desktop/mobile login ownership, hidden compatibility anchors, authenticated Dashboard startup, canonical runtime provenance, sanitized debug export, service-worker activation without a reload loop, and the exact route sequence Shows -> Reading -> Dashboard -> Reading -> Shows -> back Reading -> forward Shows -> Login. Startup produced one successful request each for plain status, settings, full status, and featured, with zero pre-authentication plugin requests.

Do not approve production until the permanent frontend reports the expected build ID and the real remote Manga library completes 1,818/1,818 indexing. Automation covers the same total in 37 pages after the 200-item first stage, but this machine has no live Manga data and cannot provide a real completion time. Retain both plugin and web-root backups until these checks pass.

Final automated state: 354/354 Vitest, 10/10 plugin tests, frontend/plugin contract, TypeScript, scoped ESLint, production Webpack, secret scan, and `git diff --check` pass. No style source changed. No commit, push, remote deployment, rollback, or backup deletion was performed.

## 2026-07-15 Android Dropdown Handoff

The shared Movies/Shows dropdown no longer depends on the overflow boundary of the compact horizontal navigation. `PtvShellPrimaryDropdown` renders the active panel into `document.body`, owns outside/Escape dismissal, and computes a clamped fixed position from `window.visualViewport`. Horizontal navigation swipes are classified separately from taps, so Android's pointer-derived click opens once after a tap and is suppressed after a swipe.

Automated verification is complete: focused dropdown 11/11, full Vitest 365/365, Android dropdown Playwright 9/9, full Playwright 36/36, TypeScript clean, changed-file ESLint clean, inherited PTV lint baseline unchanged, Stylelint clean, and production Webpack successful with the two known size warnings. The plugin was not touched or rebuilt.

Before deployment sign-off, test a physical Android Chrome phone on Home, Movies, Shows, Music, and Reading: tap Movies/Shows, select each destination once, tap outside, press browser back/forward, rotate while open, and swipe the primary navigation without opening a menu. Repeat the basic tap/select/outside flow in iOS Safari and keyboard/remote Arrow Down, arrows, Enter, and Escape on desktop/TV. No cache schema or plugin restart is required; deploy the frontend normally and reload once.

## 2026-07-15 Urgent Runtime Regression Handoff

The blank/broken login and application regression was caused by drawer edge-swipe ownership, not by the primary-navigation portal. `NavDrawer` captured a missing `.mainDrawerHandle` while the authentication compatibility host was mounted, then the touch path attempted `target.addEventListener` on that null value. The corrected drawer resolves the handle when edge swipe is reconciled, no-ops while login owns no handle, retires the exact prior target, and binds a later authenticated handle once. `libraryMenu` now performs that reconciliation on every page show.

Local release gate results: focused 32/32, full Vitest 370/370, TypeScript clean, changed-file ESLint clean, PTV Stylelint clean, Chromium Playwright 36/36, WebKit Playwright 34 passed/1 platform-policy skip, production Webpack successful with only the two known size warnings, secret scan clean, and `git diff --check` clean apart from line-ending notices. WebKit skips only the link-Tab-order assertion because Safari delegates link tabbing to the platform full-keyboard-access preference; every WebKit login, route, blank-root, history, dropdown, outside/Escape, and resize case runs. The initial WebKit command failed only because its browser binary was not installed; after `npx playwright install webkit`, the cross-browser matrix passed. An invalid `--runInBand=false` Vitest invocation ran no tests and was replaced by the successful full `npm test` run.

Before deployment sign-off, verify on a physical Pixel/Android Chrome, iPad Safari, and desktop Chrome connected to Jellyfin: plain and query-bearing login, expired-session redirect, logout/login, successful authenticated Home, browser back/forward across auth, Movies/Shows dropdown tap and selection, and a normal authenticated drawer edge gesture. Confirm there is no header on login, no one-frame runtime overlay, no blank content root, and no duplicate edge-swipe response. This frontend-only fix requires no plugin restart or cache-schema migration; deploy the production frontend and use the normal service-worker reload path.

## 2026-07-15 Split-Origin Runtime Handoff

The frontend development host and Jellyfin host are intentionally different. The previous remediation incorrectly rebased a stale loopback Jellyfin candidate to the frontend hostname. Startup could pin loopback before Jellyfin recovered its saved server, leaving plugin requests on the stale root. Development now requires the explicit `PTV_DEV_JELLYFIN_URL`; the requested saved `serverid` and authenticated `ApiClient` are the next authorities, and a server transition retires the plugin root. Production bundles receive an empty development URL.

The black Home spacer, bottom-only Reading navigation, and blank Dashboard body were a separate geometry defect. Shared shell CSS had changed stock Jellyfin animated containers and generic pages to relative flow. Those overrides are removed; only `.ptv-shell-main` and `.ptv-shell-page` own PTV geometry. Login keeps its already verified full-viewport authentication layout.

Automated gates pass: focused 18/18; full Vitest 385/385; TypeScript; scoped ESLint; shell Stylelint; live Chromium 6/6; live WebKit 6/6; production Webpack; 119,166-path secret scan; production-address scan; and whitespace validation. The live matrix covers desktop, Pixel, and iPad profiles and proves explicit split-origin discovery wins over stale loopback storage. One initial full-suite cache timeout was non-reproducible: isolated and immediate full reruns passed. Webpack emitted only the established size warnings.

Release remains HOLD because no supplied credential was used. Restart the existing Webpack development process with `PTV_DEV_JELLYFIN_URL` set to the real Jellyfin root, revoke the token exposed in the supplied capture, then verify authenticated Home, Reading, Dashboard, reload/history, Movies/Shows dropdowns, and logout/login on desktop Chrome, physical Pixel Chrome, and iPad Safari. Confirm both Jellyfin and `/Ptv/v1/*` requests remain on the intended backend. No plugin source changed and no Jellyfin restart is required for this frontend correction.

## 2026-07-15 Music Playback And Live-Loading Handoff

Music's second compact player was PiggieTV's route-specific renderer, not a second audio engine. The global `PTVMediaDock` is retained as the sole bottom-right mini player. The Music root remains persistent only for full-screen/queue/playlist overlays, and its window-owned root/load promise makes route remounts and HMR idempotent. The one module-level audio element, queue, and controller remain intact.

Automated gates pass: focused 11/11; full Vitest 392/392 on the final run; TypeScript; scoped ESLint with zero errors and three existing nested-function warnings; Music/shell Stylelint; live Chromium 6/6; live WebKit 6/6; and production Webpack in 90.834 seconds with only the two established size warnings. The live matrix covers unauthenticated desktop, Android-layout, and iPad-layout startup plus explicit split-origin discovery. It does not prove signed-in Music playback.

Before release sign-off, authenticate at the development frontend connected to the intended Jellyfin backend and verify:

1. `#/music` shows one `.ptv-media-dock`, no `.ptv-music-mini-player`, and no visible Jellyfin `.nowPlayingBar` while PTV owns active playback.
2. Exactly one `[data-ptv-music-native-player='true']` audio element exists; no additional controller, queue, root, or subscription appears after Music -> Home -> Reading -> Dashboard -> Music, browser back/forward, or a development HMR update.
3. Play, pause, previous, next, seek, stop, queue, and full-screen controls remain synchronized; playback continues off Music and stopping playback removes the dock/ownership class.
4. The hero changes from a real loading state to a live count, cached count, or explicit unavailable-live-count message. It never remains `Loading library tracks` after the current request settles or is retired.
5. Dashboard status resolves against the explicit Jellyfin backend, has populated candidate/root/attempt fields after authentication, and settles with `loading=false` on success or failure. A historical `lastSuccessfulEndpoint` must not be treated as current health.
6. Capture sanitized response code/duration, player/audio/subscription counts, loading transition, route mount/unmount counts, and event growth. Queue progress should grow at roughly one publication per second rather than the prior multi-owner flood.

This is a frontend-only correction. Jellyfin/plugin restart is not required. Do not deploy until the authenticated physical checks pass; then deploy through the normal frontend/service-worker path without clearing user data.

## 2026-07-16 Playback Dock And Update Reload Handoff

The bottom-right dock leaked onto Jellyfin video playback because it treated the universal global playback snapshot as universal presentation ownership. It now renders only an active PTV Music-owned Audio item and also listens to route changes so `#/video` hides it before any stale Music snapshot can appear over the video player. Movie, Episode, Series, and Trailer coverage is explicit; returning to Music restores one dock.

The frontend update button stalled because activation had no timeout/direct fallback and the session reload marker from a prior attempt was never retired. The update service now owns one activation attempt, posts `SKIP_WAITING`, reloads exactly once on `controllerchange`, falls back after three seconds, directly reloads if worker messaging is unavailable, clears stale markers, and removes the notice before the reload call. Repeated clicks and late controller events are idempotent.

Automated gates pass: focused 22/22; final full Vitest 403/403; TypeScript; scoped ESLint; E2E Webpack; Playwright 8/8; production Webpack in 92.581 seconds with only known size warnings; secret scan; and whitespace validation. One first-run featured-cache timeout passed isolated 4/4 and on the immediate full rerun.

Release remains HOLD until an authenticated physical client proves: one dock for Music; no PTV dock for movie/episode playback; Music restoration after video; and an actual waiting service worker reloads into the new bundle without a stuck notice or loop. This is frontend-only: no Jellyfin/plugin restart, cache-schema migration, user-data clear, plugin deployment, commit, or push was performed.

## 2026-07-16 Reading override XML serialization handoff

- Corrected source is ready in the working tree. Do not revert the Music/video dock or service-worker fixes from the preceding commits.
- Deploy only the five files from `src/ptv/plugin/bin` to `/var/lib/jellyfin/plugins/PTV_Plugin/`: DLL, deps JSON, PDB, XML documentation, and `meta.json`.
- DLL assembly/file version and manifest version are all `10.11.8.2`. The corrected staged DLL SHA-256 is `51E6BBD8D7A742A01528DC59E5A8A21AD718A602BF868F16B64C0B64A886DD05`.
- Before replacement, stop Jellyfin and back up the complete installed plugin directory. Replace all five files together, preserve Jellyfin ownership/permissions, and restart Jellyfin.
- Required live checks after restart: authenticated `/Ptv/v1/status`, `/status?full`, `/settings`, and `/featured` return 200; full status advertises `readingSeriesOverrides=true`; dashboard reports connected rather than fallback; Jellyfin logs contain no `Cannot serialize member ... ReadingSeriesOverrideSettings.Routes` error.
- Automated verification passed: plugin 13/13, focused frontend 7/7, full Vitest 405/405, TypeScript, scoped ESLint, plugin contract, secret scan, production Webpack, and whitespace validation.
- Deployment was not attempted because neither `10.16.0.240` nor `10.16.0.50` accepted available non-interactive SSH authentication. No remote state changed.

## 2026-07-16 production chunk coherency handoff

- The reported `ChunkLoadError` was not caused by a missing source artifact: `90212.432920e11e02eefe99af.chunk.js` exists in the production output and was served by the Jellyfin origin. The public bare path returned HTTP 503 while a query-versioned request returned 200 during diagnosis, then recovered to 200, identifying an intermittent CDN/path-cache plus release-generation coherency failure.
- Deploy the complete matching frontend output. Use `scripts/deploy-jellyfin-web.ps1` or preserve its ordering: copy all assets first, verify them, retain old content-hashed chunks, and replace root `index.html` last. Do not copy only `main`/`runtime` bundles.
- New production clients request async JS/CSS with a build-scoped `ptv_asset` query. A caught same-origin chunk failure gets one session-bounded document reload with the current hash route preserved; it cannot reload-loop or treat an ordinary error as a stale bundle.
- Automated gates pass: focused 5/5; full Vitest 410/410; TypeScript; scoped ESLint; production Webpack; clean-target deployment simulation for 2,498 files; and whitespace validation. Webpack reports only established size warnings.
- A frontend deployment does not require a Jellyfin restart by itself. The corrected XML-safe plugin payload is still a separate deployment: the supplied startup log proves the installed `10.11.8.2` DLL still contains the old public dictionary model and throws during configuration serialization. Replace all five staged plugin files and restart Jellyfin before considering plugin status healthy.

## 2026-07-16 authenticated diagnostics cleanup handoff

- The latest authenticated export is the live-health authority: plugin connected at `10.11.8.2`, API `1`, cache `7`, Reading overrides compatible, and the Reading index complete at 2,911/2,911.
- Dashboard/fallback routes now reject stale native Reading header state. Verify `#/reading -> #/dashboard/piggietv` reports Dashboard as the route and no Reading page title, nav group, or header section.
- Reading index progress is deliberately coalesced. The UI must still reach and report 2,911/2,911, but `reading-page-rendered` and `reading-shell-ready` should grow only when route/stage/section readiness changes, not for every background page.
- Idle playback state owns no reconcile interval. Confirm no low-frequency reconcile growth with null item/session/source; active Jellyfin playback must still reconcile and the previously fixed video mini-player behavior must remain unchanged.
- Successful plugin status/settings/featured calls now populate attempted responses with sanitized path, HTTP status, and duration. No query string, server origin, token, or authorization value should appear.
- Automated gates pass: focused 13/13; final full Vitest 415/415; TypeScript; scoped lint for new helpers/services/API; the PTV lint baseline with no per-file increase; and production Webpack in 107.006 seconds with only established size warnings. One first-run featured-cache timeout passed isolated 4/4 and on the immediate full rerun.
- This is a frontend-only cleanup. No Jellyfin restart or plugin redeployment is required for these changes. Deploy the complete matching frontend bundle through the existing atomic asset-first/index-last process, then accept the normal service-worker update.

## 2026-07-16 details ownership and video playback handoff

- Details routes now have native PiggieTV presentation ownership. Verify `#/details?id=<movie>`, Series, Episode, and any shared item route show one current PiggieTV header, no visible legacy Jellyfin header, and details content beginning immediately below the safe header area. `#/music/item/...` must remain Music-owned and `#/video` must remain Jellyfin-owned.
- Video ownership now pauses, rather than clears, native Music. The current queue, item, index, and position survive; active global state must no longer report `ptv-music` while video owns playback; leaving video must not restart audio. After returning to a non-video route, the paused dock may reappear and only an explicit Play command may resume it.
- Automated gates: focused 40/40; full Vitest 431/431 on the final run; TypeScript; scoped regression ESLint; changed Stylelint; E2E harness 36 passed/6 live skipped; production Webpack in 106.7 seconds; and whitespace validation. Webpack retained only established size warnings. One initial full-suite featured-cache timeout passed isolated and on immediate full rerun.
- Authenticated physical verification is still required. The opt-in live Playwright run reached `10.16.0.125:8082`, but clean browser contexts had no saved server/session and stopped at Jellyfin's Select Server page, so it could not exercise the requested signed-in details or playback sequence.
- No plugin/backend change or Jellyfin restart is required. Deploy the complete frontend build through the existing atomic asset-first/index-last process and accept the normal service-worker update; do not clear user data merely for this patch.

## 2026-07-16 native details geometry correction

- The details route ownership fix remains intact. A new reversible layout lifecycle isolates the native page from stock Jellyfin details geometry, assigns named poster/ribbon/content grid areas, moves the logo into the native ribbon while mounted, and restores it during teardown.
- Tightly scoped details styles remove the flowing `40vh` backdrop gap, stock ribbon height, viewport-width content inset, and secondary shelf offsets. Overview/meta use normal widths, tags/genres/studios/external links wrap horizontally, desktop content is centered, mobile stacks cleanly, and the secondary region includes Music-dock-safe bottom padding.
- Automated gates pass: focused 42/42; full Vitest 433/433; TypeScript; scoped ESLint; details Stylelint; Playwright 38 passed/6 opt-in live skipped; production Webpack in 101.095 seconds; and details whitespace validation. Webpack emitted only its established size warnings.
- The opt-in dev-host probe reached `10.16.0.125:8082`, but a clean profile landed on Select Server. With the backend environment supplied, the split-origin test still observed the dev bundle's retained localhost selection. Authenticated movie, Series, Episode, dock-clearance, and Music -> video audible checks therefore remain manual.
- Manual production check: authenticate against `10.16.0.50:8096`; open movie, Series, and Episode details; verify one PiggieTV header, no blank top gap, readable wrapping metadata, aligned Cast & Crew/related shelves, and unobstructed controls with Music active. Start video and confirm Music pauses, the dock hides, and Music does not resume until explicitly played.
- No plugin/backend change, deployment, Jellyfin restart, commit, push, or remote operation occurred.

## 2026-07-17 native details artwork and premium glass

- Native details now use one fixed full-page artwork layer with Backdrop -> Thumb -> Primary -> themed-gradient fallback. The legacy flowing backdrop remains suppressed so it cannot recreate the large top gap.
- The title ribbon, poster, action group, metadata, content panels, Cast & Crew, and related shelves share scoped translucent purple-glass tokens with border, glow, inset highlight, and readable masks. Filter, low-power, and reduced-motion fallbacks retain the same content geometry.
- Deterministic visual verification shows artwork visible across the page, one unobstructed PiggieTV header, a strong translucent title panel, readable metadata glass, and Cast & Crew/More Like This aligned to the main container. Desktop and mobile focused Playwright checks passed 2/2.
- Automated gates: focused Vitest 15/15; full Vitest 436/436; TypeScript; scoped ESLint; details Stylelint; production Webpack in 101.809 seconds with established size warnings; and whitespace validation.
- Manual authenticated checks remain: open Movie, Series, Season, and Episode details with real artwork; confirm each fallback order; verify the Music dock clears controls; then start video and confirm Music still pauses, the dock hides, and audio does not auto-resume.
- This is frontend-only. No plugin/backend deployment or Jellyfin restart is required; deploy the complete matching frontend bundle atomically and accept the normal service-worker update.

## 2026-07-17 shared shell surface correction

- The outer shared header is layout-only and visibly transparent. The centered primary nav remains its own glass pill; top-right utilities own individual purple glass buttons and Search remains larger and circular. Details routes can no longer recreate a full-width header strip.
- Automated geometry covers Home, Shows browse, and Details at `2560x1271`, Details at `1024x1366`, and Shows at `390x844`. It verifies one transparent header, centered glass nav, glass utilities, larger Search, and no mobile/tablet horizontal overflow.
- Android dropdown portal coverage remains green. Music queue, playback-state, and media-dock tests remain green, including video ownership, dock suppression, queue preservation, and no automatic Music resume.
- Gates: focused Vitest 26/26; full Vitest 439/439; TypeScript; scoped ESLint; shell/details Stylelint; focused Playwright 15/15 plus tablet rerun 5/5; full Playwright 42 passed/6 live skipped; production Webpack in 90.6 seconds with established size warnings; production CSS includes the WebKit backdrop-filter prefix.
- Manual hardware check remains: compare Home, Details, browse, Music, Reading, and Dashboard on desktop, Pixel/Android Chrome, and iPad Safari. Confirm no full-width glass strip, dropdowns remain above content, and bright backdrops preserve icon readability.
- No Jellyfin restart or plugin deployment is required. Deploy only the complete frontend bundle atomically and accept the normal service-worker update.

## 2026-07-17 details lifecycle and video presentation hardening

- Item details now own a request generation and matching item ID. Navigation clears stale detail DOM immediately, retires prior work, and suppresses late season/episode/cast/related/artwork commits. The initial enhancement waits for an authenticated API client instead of recording a false handled state.
- Backdrop selection is deterministic and preloaded: item Backdrop, related parent/season/series Backdrop, current Thumb, current Primary, then themed fallback. Poster/logo slots retain stable ratios while loading, preventing first-navigation layout snapping.
- Media-source duplicates are collapsed before version badges and selectors render, so one real playable file cannot advertise duplicate versions. The video header now renders `Series · SxxExx - Episode`; Movie behavior is unchanged.
- Top-right utility icons are centered in equal glass buttons. Video controls now use lighter transparent purple-blue glass with readable progress, captions, buttons, and timestamps. Low-power/filter fallbacks remain bounded.
- Final gates: full Vitest 66 files/450 tests; TypeScript passed; scoped ESLint had no errors (existing warnings only); changed Stylelint passed; focused Playwright 7/7 at desktop/mobile/tablet; production Webpack compiled in 84.892 seconds with established size warnings; whitespace validation passed.
- Manual authenticated checks remain: direct and in-app Movie, Series, Season, and Episode navigation; parent-backdrop fallback and image-failure fallback; one-file versus genuinely multi-version episodes; exact episode video heading; bright-video control readability; and confirmation that Music still pauses, the dock hides, and Music does not auto-resume after video.
- No plugin/backend change or Jellyfin restart is required. Deploy the complete frontend output atomically and accept the normal service-worker update.

## 2026-07-18 shell utility, Settings, and Details navigation correction

- Dashboard utility visibility now survives shells mounted before authentication. Sign-in forces an administrator access refresh; sign-out clears it immediately. The icon remains admin-only.
- Top-right glyphs are centered by resetting the inherited global icon margin inside shell/search glass controls. The existing equal-size grid and Android body-portal dropdown implementation remain intact.
- Settings now mounts one header-only shared `PTVShell` and adds scoped header-safe padding to the stock Settings content. No settings data or backend behavior changed.
- Details no longer waits for a redundant full item request on normal navigation. The item controller emits the exact committed item after stale-generation validation; PTV immediately applies its artwork and may later upgrade to related parent artwork only if the item is still active. Shared lazy image loading replaces a second poster preload, and later DOM mutations cannot erase the native glass/layout classes.
- Final gates: focused 24/24; full Vitest 69 files/457 tests; TypeScript; scoped ESLint with no errors; changed Stylelint; focused Details/shell Playwright 7/7; production Webpack in 106.7 seconds with established size warnings; whitespace validation passed.
- Manual authenticated checks at `10.16.0.125:8082`: sign in as an administrator and confirm Dashboard appears without refresh; open Settings and confirm one PTV header; navigate in-app between Movie, Series, Season, and Episode details and confirm the first paint already has the correct item, backdrop, glass layout, and centered utilities; compare Network timing/request count; verify Music still pauses and the dock hides for video.
- No plugin deployment or Jellyfin restart is required. Deploy the complete frontend bundle atomically and accept the normal service-worker update/cache refresh.
