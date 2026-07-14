# PiggieTV Project State

Current as of 2026-07-13. This is the current-state ledger, not a historical changelog.

## Repository Snapshot

| Field | Current value |
| --- | --- |
| Product | PiggieTV native experience embedded in Jellyfin Web |
| Current HEAD | `9851acd987` (`series fix`) |
| Jellyfin Web package | `10.11.11` |
| Node requirement | `>=20.0.0` |
| Frontend stack | React 18.3, TypeScript 5.8, Webpack 5, MUI 6, TanStack Query 5 |
| PTV frontend root | `src/ptv` |
| Plugin root | `src/ptv/plugin/Jellyfin.Plugin.PiggieTV` |
| Plugin target/version | .NET 9, `10.11.8.1` against Jellyfin packages `10.11.8` |
| Featured cache | Schema/version 7, plugin and browser stale-while-revalidate path |
| Reading home cache | Schema 4, 5-minute fresh TTL, 24-hour stale window |

The worktree is intentionally dirty. The current Reading stabilization changes, companion plugin contract changes, new regression tests, and these four project documents have not been committed. Existing development log files are unrelated artifacts and remain untouched.

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

## Reading Stabilization Scope In The Worktree

Current modified/new implementation areas:

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

## Validation Status

The current source state passed these local gates after the final classification extraction:

| Check | Result |
| --- | --- |
| Focused Reading/Identify tests | 6 files, 42 tests passed |
| Full Vitest suite | 27 files, 237 tests passed |
| TypeScript | Passed with `--noEmit --incremental false` |
| Scoped ESLint | Zero errors; eight existing nested-render warnings in `booksPage.tsx` |
| Scoped Stylelint | Passed |
| Plugin debug build | Passed with zero warnings/errors |
| Production Webpack build | Passed in 79.3 seconds |
| Webpack warnings | Existing aggregate asset-size and entrypoint-size warnings only |
| `git diff --check` | Passed |

Generated build/test artifacts were cleaned or restored after validation.

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

Package and deploy the current frontend and plugin together, run the live Reading verification matrix in `HANDOFF.md`, then commit only the intended source/tests/docs after reviewing the dirty worktree.
