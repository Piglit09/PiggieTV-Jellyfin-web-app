# PiggieTV Handoff

Updated 2026-07-13 for HEAD `9851acd987` plus the current uncommitted Reading stabilization work.

## Where The Project Is

PiggieTV is a Jellyfin Web customization with a guarded singleton runtime, shared PTV shell, native Home/media/Music/Reading/Requests routes, persistent playback UI, featured cache v7, recommendation and Row Builder tooling, and a companion .NET 9 Jellyfin plugin.

The latest local task is complete in code: stabilize Reading classification, filename parsing, series grouping, Google Books/ComicVine Identify behavior, selective metadata application, diagnostics authorization/redaction, and responsive Reading/Identify layouts. Automated validation is green. The next work is deployment and live verification, not another local rewrite.

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

## Validation Already Completed

```text
Focused Reading/Identify: 6 files, 42 tests passed
Full Vitest suite:         27 files, 237 tests passed
TypeScript:                passed
Scoped ESLint:             zero errors; 8 existing nested-render warnings
Scoped Stylelint:          passed
Plugin debug build:        passed, 0 warnings / 0 errors
Production Webpack:        passed in 79.3s
git diff --check:          passed
```

Production Webpack emitted only the repository's existing aggregate asset-size and entrypoint-size warnings. Generated build/test artifacts were cleaned or restored.

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
dotnet build src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj --no-restore
npm run build:production
git diff --check
```

The broad ESLint command may report the eight known nested-render warnings in `booksPage.tsx`; treat new errors separately.

## Dirty Worktree Guidance

- Do not discard unrelated user changes or development logs.
- The four root project documents are currently untracked and intentionally updated by this task.
- Review frontend and plugin changes as one feature set before committing.
- Do not commit generated `dist`, plugin `bin/obj`, Vitest result, or Babel cache output.
- Confirm the plugin DLL and frontend bundle were produced from the same worktree before live testing.

## Stop Conditions

Do not claim the Reading work fully deployed until the authenticated provider/apply, restart persistence, and device checks above pass. If a live check fails, record the request/response shape and current item payload in `DEBUG_LOG.md` without credentials, tokens, item IDs, server addresses, or local paths.
