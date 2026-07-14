# PiggieTV Handoff

Updated 2026-07-13 for HEAD `476f994f01`; Reading production-hardening source is present in `71666e7d02`.

## Where The Project Is

PiggieTV is a Jellyfin Web customization with a guarded singleton runtime, shared PTV shell, native Home/media/Music/Reading/Requests routes, persistent playback UI, featured cache v7, recommendation and Row Builder tooling, and a companion .NET 9 Jellyfin plugin.

The Reading hardening task remains complete and unchanged. A separate focused dashboard/performance pass is now complete locally: copied debug exports are sanitized, TMDb enrichment is bounded and cancellation-aware, browse shelves settle progressively, isolated image failures expire, and shell mount telemetry no longer duplicates on backdrop changes. The next work is review/commit followed by deployment and live verification, not another broad rewrite.

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
- Shows views: Continue, Latest, Trending, Genres, exact Genre, Networks, exact Network, and series-scoped Seasons.
- `anime`, `animemovies`, and `cartoons` resolve through Jellyfin user views to real IDs; unresolved aliases show an error rather than broad media.
- Genre uses Jellyfin `Genres`; studio/network names resolve exactly to metadata IDs and use `StudioIds`; filters are applied before 50-item paging.
- Trending uses the deterministic local-library formula recorded in `ARCHITECTURE.md`; it does not alias Recently Added or make live per-card provider requests.
- Footer metadata chips now build typed browse URLs rather than ordinary Search URLs.
- Browse diagnostics are admin-plus-debug only, collapsed, bounded, and redacted.

Final local validation:

```text
Focused browse:       4 files, 17 tests passed
Full Vitest suite:    33 files, 258 tests passed
TypeScript:           passed
New-file ESLint:      passed, zero findings
Legacy touched lint:  no new findings versus HEAD baselines
Scoped Stylelint:     one unchanged nativeBrowse.scss:492 baseline error
Production Webpack:   passed in 76.7s (74.173s compilation)
Plugin build:         not required; no plugin code changed
```

### Focused Browse Live Matrix

1. Direct-load, refresh, back, and forward on base `#/movies` and `#/shows`.
2. Verify `view=latest` differs materially and is DateCreated descending.
3. Verify Shows `view=continue` contains resumable items only.
4. Verify Trending order is stable across refresh while inputs are unchanged.
5. Open Genres, select a value containing punctuation/Unicode, load a second page, and return from item details.
6. Open Movies Studios, select Universal Pictures, and confirm exact Jellyfin metadata matches and total count.
7. Open Shows Networks, select a network, and confirm no title-search leakage.
8. Verify `topParentId=anime`, `animemovies`, and `cartoons` never leak broad libraries; verify an unknown alias fails closed.
9. Verify `view=season` without `seriesId` shows the recovery state and a complete series-scoped URL lists seasons.
10. Change filters quickly and confirm an older response never replaces the active route.
11. At desktop/mobile widths, verify grid, Load More, touch/keyboard/remote activation, visible focus, and return scroll position.
12. As non-admin and admin-with-debug-off, confirm no browse diagnostics. As admin with debug on, confirm the panel is collapsed and redacted.

Deployment is frontend-only. No Jellyfin/plugin restart is required. A hard refresh or service-worker update is recommended once after installing the new web bundle; application data caches do not need clearing.

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
