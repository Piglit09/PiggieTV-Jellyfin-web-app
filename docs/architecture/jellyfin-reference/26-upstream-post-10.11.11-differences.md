# Selected Upstream Changes After Jellyfin 10.11.11

## Scope and isolation rule

This chapter is a **bounded secondary comparison**, not part of the stock 10.11.11 baseline. Every observation about a newer source tree is labeled `UPSTREAM_NEWER_THAN_10.11.11`. Nothing in this chapter changes the ownership or behavior documented for Jellyfin 10.11.11 elsewhere in this atlas.

The compared source identities are:

| Role | Repository | Exact revision | Declared version | Evidence |
|---|---|---|---|---|
| Baseline Web | `jellyfin/jellyfin-web` | `35c0793ece3adbd247eab290ae1effab851f3d37` | `10.11.11` | `VERIFIED_FROM_SOURCE` — official `release-10.11.z`/`v10.11.11` revision and the verified local baseline. |
| Baseline Server | `jellyfin/jellyfin` | `1fbd8739292cce610231be93daf43368733edf63` | `10.11.11` | `VERIFIED_FROM_SOURCE` — official `release-10.11.z`/`v10.11.11` revision and the verified local baseline. |
| Newer Web sample | `jellyfin/jellyfin-web` | [`0510499cd5096e553732ddb85a067d9cb7a419db`](https://github.com/jellyfin/jellyfin-web/commit/0510499cd5096e553732ddb85a067d9cb7a419db) | `12.0.0` | `UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` — [`package.json`, lines 1-5](https://github.com/jellyfin/jellyfin-web/blob/0510499cd5096e553732ddb85a067d9cb7a419db/package.json#L1-L5), at this exact revision. |
| Newer Server sample | `jellyfin/jellyfin` | [`6e4d98e6dbdb72f4dd6b2f65c34aba265193c459`](https://github.com/jellyfin/jellyfin/commit/6e4d98e6dbdb72f4dd6b2f65c34aba265193c459) | `12.0.0` | `UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` — [`SharedVersion.cs`, lines 1-4](https://github.com/jellyfin/jellyfin/blob/6e4d98e6dbdb72f4dd6b2f65c34aba265193c459/SharedVersion.cs#L1-L4), at this exact revision. |

The newer revisions were the official `master` heads inspected on 2026-09-02. Their `12.0.0` declarations identify source state; this audit does **not** claim that either head is a stable release. GitHub reports both comparisons as diverged rather than a small linear patch series: [Web comparison](https://github.com/jellyfin/jellyfin-web/compare/35c0793ece3adbd247eab290ae1effab851f3d37...0510499cd5096e553732ddb85a067d9cb7a419db) and [Server comparison](https://github.com/jellyfin/jellyfin/compare/1fbd8739292cce610231be93daf43368733edf63...6e4d98e6dbdb72f4dd6b2f65c34aba265193c459). `UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE`.

For compact citations below, `W12` means Web `0510499c`; `S12` means Server `6e4d98e6`; `W10` and `S10` mean the two 10.11.11 revisions above.

## High-value delta summary

| Area | Selected newer shape | Practical impact when comparing or porting PTV work | Classification |
|---|---|---|---|
| Web cache | TanStack state is persisted in IndexedDB, build-busted, stale for one minute, retained for up to one day, retried selectively, and cleared per failed query on HTTP 401. | Cache/user/build boundaries must be reviewed before moving a 10.11.11 invalidation fix. | `UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` |
| Web invalidation | A document `REFRESH_NEEDED` event now invalidates a user-scoped Items query prefix. | Legacy event producers can affect React query owners; a port must account for both lifecycles. | `UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` |
| Web routing | The selectable application families are now `modern` and `legacy`, with a separately mounted dashboard and wizard. | 10.11.11 `stable`/`experimental` route assumptions and import paths are stale upstream. | `UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` |
| Web API bridge | `ApiProvider` obtains the SDK `Api` through `ServerConnections.getApi(...)` instead of the 10.11 compatibility adapter `toApi(...)`. | Changes around auth/session/API ownership need revalidation against the newer connection manager. | `UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` |
| Server auth compatibility | Legacy authorization is default-off and an explicit migration writes it off. | Clients or reverse proxies relying on old authorization syntax need a deliberate compatibility review. | `UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` |
| Server search | Search is provider-oriented and async; a SQL fallback performs projected/scored queries, and access filtering is explicit for user-scoped internal and external candidates. | Search correctness, performance, and authorization patches should not be transplanted by filename alone. | `UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` |
| Metadata Identify | The sampled Web dialog and Server Apply contract remain legacy-shaped: POST Apply, full refresh, `204 No Content`, and no authoritative DTO in the response. | Newer upstream does not, in this sample, remove the need for client readback/convergence logic. | `UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` |
| Playback | The sampled Web playback owner remains a process-wide singleton with queue/reporting methods. | Do not assume upstream 12 has replaced the legacy playback lifecycle with a React query/store model. | `UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` |

## Web query cache became persistent and policy-bearing

`UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` — W12 `src/RootApp.tsx`, `RootApp`, lines 17-36, uses `PersistQueryClientProvider`, a build-version buster, and an IndexedDB-backed persister. W12 `src/utils/query/queryClient.ts`, lines 7-15 and 41-76, defines:

- a 24-hour garbage-collection horizon;
- a one-minute stale horizon;
- at most two retries, with no retry on HTTP 401;
- per-query cancellation and replacement with `null` after HTTP 401;
- an IndexedDB key named `jellyfin-query-cache`.

Official source: [W12 RootApp](https://github.com/jellyfin/jellyfin-web/blob/0510499cd5096e553732ddb85a067d9cb7a419db/src/RootApp.tsx#L17-L36), [W12 queryClient](https://github.com/jellyfin/jellyfin-web/blob/0510499cd5096e553732ddb85a067d9cb7a419db/src/utils/query/queryClient.ts#L7-L76).

The 10.11.11 baseline used an in-memory `QueryClientProvider` and only set `networkMode: 'always'`; it had no persister, stale/GC policy, retry policy, or global 401 cache callback in that file. `VERIFIED_FROM_SOURCE` — W10 `src/RootApp.tsx`, lines 1-28; `src/utils/query/queryClient.ts`, lines 1-12. Official source: [W10 RootApp](https://github.com/jellyfin/jellyfin-web/blob/35c0793ece3adbd247eab290ae1effab851f3d37/src/RootApp.tsx#L1-L28), [W10 queryClient](https://github.com/jellyfin/jellyfin-web/blob/35c0793ece3adbd247eab290ae1effab851f3d37/src/utils/query/queryClient.ts#L1-L12).

### Impact boundary

`UPSTREAM_NEWER_THAN_10.11.11 / INFERRED` — A future port of a PTV cache fix must identify whether it is correcting server authority, current-memory query state, or restored IndexedDB state. The W12 build buster protects build generations, but it does not by itself prove cross-user isolation for every feature key. User identity still has to be present in each sensitive query key or the cache has to be retired at the session boundary.

## Web now bridges legacy refresh events into TanStack invalidation

`UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` — W12 `src/components/QueryClientEventHandler.tsx`, `QueryClientEventHandler`, lines 8-27, listens for the document-level `REFRESH_NEEDED` event and invalidates the prefix `['User', user?.Id, 'Items']`; W12 `src/RootApp.tsx`, lines 25-30, mounts that handler inside the API/user-settings/web-config providers. Official source: [event handler](https://github.com/jellyfin/jellyfin-web/blob/0510499cd5096e553732ddb85a067d9cb7a419db/src/components/QueryClientEventHandler.tsx#L8-L27), [mount point](https://github.com/jellyfin/jellyfin-web/blob/0510499cd5096e553732ddb85a067d9cb7a419db/src/RootApp.tsx#L25-L30).

The W10 `RootApp` had no such mounted handler. `VERIFIED_FROM_SOURCE` — W10 `src/RootApp.tsx`, lines 16-28.

`UPSTREAM_NEWER_THAN_10.11.11 / INFERRED` — This creates an intentional ownership bridge: a legacy document event can now retire React-owned item projections. It is not proof that every query family is invalidated; the cited key is specifically the current user's `Items` prefix.

## Web route families changed from stable/experimental to legacy/modern

`UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` — W12 `src/RootAppRouter.tsx`, lines 10-35, composes one hash router from either `MODERN_APP_ROUTES` or `LEGACY_APP_ROUTES`, plus dashboard and wizard routes. The selection uses `layoutManager.modern`. W12 `src/apps/modern/routes/routes.tsx`, lines 14-54, combines async and view-manager-backed routes behind `ConnectionRequired`; W12 `src/apps/dashboard/routes/routes.tsx`, lines 18-54, separately gates dashboard routes at admin access. Official source: [root router](https://github.com/jellyfin/jellyfin-web/blob/0510499cd5096e553732ddb85a067d9cb7a419db/src/RootAppRouter.tsx#L10-L35), [modern routes](https://github.com/jellyfin/jellyfin-web/blob/0510499cd5096e553732ddb85a067d9cb7a419db/src/apps/modern/routes/routes.tsx#L14-L54), [dashboard routes](https://github.com/jellyfin/jellyfin-web/blob/0510499cd5096e553732ddb85a067d9cb7a419db/src/apps/dashboard/routes/routes.tsx#L18-L54).

W10 instead selected `EXPERIMENTAL_APP_ROUTES` or `STABLE_APP_ROUTES` from `localStorage.getItem('layout')`. `VERIFIED_FROM_SOURCE` — W10 `src/RootAppRouter.tsx`, lines 10-35. Official source: [W10 root router](https://github.com/jellyfin/jellyfin-web/blob/35c0793ece3adbd247eab290ae1effab851f3d37/src/RootAppRouter.tsx#L10-L35).

`UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` — The newer tree still deliberately hosts view-manager legacy pages: `toViewManagerPageRoute` returns a `ViewManagerPage`, and dashboard metadata remains mapped to the `edititemmetadata` controller. W12 `src/components/router/LegacyRoute.tsx`, lines 5-14; `src/apps/dashboard/routes/routes.tsx`, lines 38-45. This is a migration architecture, not proof that route/view lifecycle ownership has become uniform.

## Web SDK API acquisition moved into `ServerConnections`

`UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` — W12 `src/hooks/useApi.tsx`, `ApiProvider`, lines 18-27 and 29-61, continues to derive user and legacy client state from `ServerConnections`, but creates the SDK `Api` with `ServerConnections.getApi(legacyApiClient.serverId())` at lines 59-61. Official source: [W12 ApiProvider](https://github.com/jellyfin/jellyfin-web/blob/0510499cd5096e553732ddb85a067d9cb7a419db/src/hooks/useApi.tsx#L18-L61).

W10 imported `toApi` and converted the legacy client locally. `VERIFIED_FROM_SOURCE` — W10 `src/hooks/useApi.tsx`, lines 6-9 and 60-62. Official source: [W10 ApiProvider](https://github.com/jellyfin/jellyfin-web/blob/35c0793ece3adbd247eab290ae1effab851f3d37/src/hooks/useApi.tsx#L6-L9), [W10 conversion](https://github.com/jellyfin/jellyfin-web/blob/35c0793ece3adbd247eab290ae1effab851f3d37/src/hooks/useApi.tsx#L60-L62).

`UPSTREAM_NEWER_THAN_10.11.11 / INFERRED` — A session/auth port should treat `ServerConnections` as the newer API-instance owner and should not preserve a 10.11-only compatibility conversion without rechecking token refresh, server switching, and sign-out behavior.

## Server legacy authorization is now forcibly disabled

`UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` — S12 `MediaBrowser.Model/Configuration/ServerConfiguration.cs`, `EnableLegacyAuthorization`, lines 287-290, no longer initializes the option to `true`. S12 `Jellyfin.Server/Migrations/Routines/20260531160000_DisableLegacyAuthorization.cs`, `DisableLegacyAuthorization.PerformAsync`, lines 7-30, explicitly sets the option to `false` and saves configuration. Official source: [S12 configuration](https://github.com/jellyfin/jellyfin/blob/6e4d98e6dbdb72f4dd6b2f65c34aba265193c459/MediaBrowser.Model/Configuration/ServerConfiguration.cs#L287-L290), [S12 migration](https://github.com/jellyfin/jellyfin/blob/6e4d98e6dbdb72f4dd6b2f65c34aba265193c459/Jellyfin.Server/Migrations/Routines/20260531160000_DisableLegacyAuthorization.cs#L7-L30).

S10 initialized the same option to `true`. `VERIFIED_FROM_SOURCE` — S10 `MediaBrowser.Model/Configuration/ServerConfiguration.cs`, lines 287-290. Official source: [S10 configuration](https://github.com/jellyfin/jellyfin/blob/1fbd8739292cce610231be93daf43368733edf63/MediaBrowser.Model/Configuration/ServerConfiguration.cs#L287-L290).

`UPSTREAM_NEWER_THAN_10.11.11 / INFERRED` — Any PTV native or Web auth code that happens to work because 10.11.11 accepts a legacy authorization form is an upgrade risk. This finding does not identify which PTV requests, if any, use those forms; that requires a separate client-header comparison.

## Server search is now a provider pipeline with explicit access filters

`UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` — S12 `Emby.Server.Implementations/Library/Search/SearchManager.cs`, `SearchManager`, lines 21-120:

- registers ordered external and internal search providers;
- executes external and internal provider collections concurrently;
- prefers non-empty external results and otherwise uses internal fallback results;
- explicitly filters external candidates for the requested user before returning them.

`FilterByUserAccessAsync`, lines 123-166, constructs a user access filter and applies `_queryHelpers.ApplyAccessFiltering` to candidate IDs. Official source: [S12 SearchManager orchestration](https://github.com/jellyfin/jellyfin/blob/6e4d98e6dbdb72f4dd6b2f65c34aba265193c459/Emby.Server.Implementations/Library/Search/SearchManager.cs#L21-L120), [external candidate authorization](https://github.com/jellyfin/jellyfin/blob/6e4d98e6dbdb72f4dd6b2f65c34aba265193c459/Emby.Server.Implementations/Library/Search/SearchManager.cs#L123-L166).

`UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` — S12 `Emby.Server.Implementations/Library/Search/SqlSearchProvider.cs`, `SearchAsync`, lines 21-142, provides a database fallback with a lightweight projection, scoring, deterministic order, and a bounded limit. `ApplyUserAccessFilter`, lines 196-215, maps the user scope to `_queryHelpers.ApplyAccessFiltering`. S12 `SearchQueryAccessFilter.Build`, lines 20-37, carries type filters and calls `libraryManager.ConfigureUserAccess`. Official source: [SQL provider](https://github.com/jellyfin/jellyfin/blob/6e4d98e6dbdb72f4dd6b2f65c34aba265193c459/Emby.Server.Implementations/Library/Search/SqlSearchProvider.cs#L21-L142), [SQL access filter](https://github.com/jellyfin/jellyfin/blob/6e4d98e6dbdb72f4dd6b2f65c34aba265193c459/Emby.Server.Implementations/Library/Search/SqlSearchProvider.cs#L196-L215), [filter builder](https://github.com/jellyfin/jellyfin/blob/6e4d98e6dbdb72f4dd6b2f65c34aba265193c459/Emby.Server.Implementations/Library/Search/SearchQueryAccessFilter.cs#L20-L37).

S10 used a synchronous `SearchEngine.GetSearchHints` which built one `InternalItemsQuery`, called `GetAllArtists` for the artist special case or `GetItemList` otherwise, and then projected `SearchHintInfo`. `VERIFIED_FROM_SOURCE` — S10 `Emby.Server.Implementations/Library/SearchEngine.cs`, lines 18-54, 71-173, and 175-198. Official source: [S10 SearchEngine](https://github.com/jellyfin/jellyfin/blob/1fbd8739292cce610231be93daf43368733edf63/Emby.Server.Implementations/Library/SearchEngine.cs#L18-L198).

`UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` — The S12 provider methods only apply user filtering when a non-empty, resolvable `UserId` is supplied: `SearchManager` lines 101-108 and `SqlSearchProvider` lines 201-214. This is a caller contract, not by itself evidence of an anonymous-data disclosure. `UPSTREAM_NEWER_THAN_10.11.11 / UNKNOWN` — This bounded pass did not trace every S12 HTTP search entry point to prove that each always supplies the intended user ID.

## Metadata Identify remains acknowledgment-based in the sampled path

`UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` — W12 `src/components/itemidentifier/itemidentifier.js`, `submitIdentficationResult`, lines 258-282, still POSTs the selected result to `Items/RemoteSearch/Apply/{itemId}` and closes the dialog on both success and failure. It receives no replacement item DTO in the success callback. Official source: [W12 Identify submit](https://github.com/jellyfin/jellyfin-web/blob/0510499cd5096e553732ddb85a067d9cb7a419db/src/components/itemidentifier/itemidentifier.js#L258-L282).

`UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` — S12 `Jellyfin.Api/Controllers/ItemLookupController.cs`, `ApplySearchCriteria`, lines 233-281, remains elevation-gated, resolves the item for the request user, applies provider IDs, requests full metadata and image refresh, and returns `204 No Content`. Official source: [S12 ApplySearchCriteria](https://github.com/jellyfin/jellyfin/blob/6e4d98e6dbdb72f4dd6b2f65c34aba265193c459/Jellyfin.Api/Controllers/ItemLookupController.cs#L233-L281).

The relevant W10 submit and S10 endpoint are materially the same shape. `VERIFIED_FROM_SOURCE` — W10 `src/components/itemidentifier/itemidentifier.js`, lines 258-282; S10 `Jellyfin.Api/Controllers/ItemLookupController.cs`, lines 232-280. Official source: [W10 Identify submit](https://github.com/jellyfin/jellyfin-web/blob/35c0793ece3adbd247eab290ae1effab851f3d37/src/components/itemidentifier/itemidentifier.js#L258-L282), [S10 ApplySearchCriteria](https://github.com/jellyfin/jellyfin/blob/1fbd8739292cce610231be93daf43368733edf63/Jellyfin.Api/Controllers/ItemLookupController.cs#L232-L280).

`UPSTREAM_NEWER_THAN_10.11.11 / INFERRED` — Current upstream's sampled legacy Identify UI does not provide an authoritative readback/generation solution that PTV can simply inherit. PTV's richer convergence rules should be compared on their own merits rather than removed because the route moved upstream.

## Playback remains legacy-singleton-owned in the sampled Web path

`UPSTREAM_NEWER_THAN_10.11.11 / VERIFIED_FROM_SOURCE` — W12 `src/components/playback/playbackmanager.js` still defines `reportPlayback` at lines 78-101, queue operations at lines 3179-3187, and exports one `new PlaybackManager()` at lines 4340-4350 with media-segment/session subscribers and an unload hook. Official source: [W12 playback reporting](https://github.com/jellyfin/jellyfin-web/blob/0510499cd5096e553732ddb85a067d9cb7a419db/src/components/playback/playbackmanager.js#L78-L101), [W12 queue](https://github.com/jellyfin/jellyfin-web/blob/0510499cd5096e553732ddb85a067d9cb7a419db/src/components/playback/playbackmanager.js#L3179-L3187), [W12 singleton](https://github.com/jellyfin/jellyfin-web/blob/0510499cd5096e553732ddb85a067d9cb7a419db/src/components/playback/playbackmanager.js#L4340-L4350).

W10 has the same owner pattern at lines 75-98, 3163-3171, and 4290-4300. `VERIFIED_FROM_SOURCE` — W10 `src/components/playback/playbackmanager.js`. Official source: [W10 reporting](https://github.com/jellyfin/jellyfin-web/blob/35c0793ece3adbd247eab290ae1effab851f3d37/src/components/playback/playbackmanager.js#L75-L98), [W10 queue](https://github.com/jellyfin/jellyfin-web/blob/35c0793ece3adbd247eab290ae1effab851f3d37/src/components/playback/playbackmanager.js#L3163-L3171), [W10 singleton](https://github.com/jellyfin/jellyfin-web/blob/35c0793ece3adbd247eab290ae1effab851f3d37/src/components/playback/playbackmanager.js#L4290-L4300).

`UPSTREAM_NEWER_THAN_10.11.11 / UNKNOWN` — This pass did not audit the many internal playback/transcoding changes between the revisions. The only supported conclusion is ownership continuity for this Web manager, not behavioral equivalence or codec/session compatibility.

## Change-impact guidance

For a PTV change that may later target upstream 12, review these boundaries first:

1. **Auth/header work:** compare the exact header form against default-off legacy authorization and the newer `ServerConnections` API owner.
2. **Query/cache work:** define memory, IndexedDB, build-generation, server, and user identity; do not copy a 10.11 invalidation key without inspecting the W12 key family.
3. **Routing/lifecycle work:** map the target to `modern`, `legacy`, dashboard, or wizard ownership; route filenames alone no longer identify lifecycle style.
4. **Search work:** preserve the provider priority/fallback contract and carry the authenticated user into both internal and external candidate filtering.
5. **Metadata/Identify work:** retain explicit readback and stale-generation controls where required; the sampled upstream Apply response remains an acknowledgment, not a complete DTO.
6. **Playback work:** treat the singleton manager, queue, player, session reporting, and React callers as separate owners until a source trace proves otherwise.

These are `UPSTREAM_NEWER_THAN_10.11.11 / INFERRED` review controls grounded in the verified deltas above, not claims about deployed PTV behavior.

## Deliberate gaps

The following remain `UPSTREAM_NEWER_THAN_10.11.11 / UNKNOWN`:

- the commit-by-commit or PR-by-PR chronology across the thousands of commits on the two diverged branch histories;
- complete OpenAPI/schema compatibility between 10.11.11 and the inspected 12.0.0 heads;
- all Server playback, HLS, transcoding, image-cache, metadata-provider, database, and migration changes;
- all Web service-worker, asset-generation, media-player, and platform-specific changes;
- runtime behavior, because the newer heads were not built, started, or tested in this read-only source pass;
- whether either inspected `master` head corresponds byte-for-byte to a published stable release;
- downstream PTV compatibility with the newer heads.

No conclusion from this chapter should replace the exact 10.11.11 baseline or be used as a deployment recommendation. A future upgrade assessment should pin a released Web/Server pair, regenerate the API compatibility matrix, and run PTV's auth, permissions, metadata, playback, cache, and cross-user tests against that pair.
