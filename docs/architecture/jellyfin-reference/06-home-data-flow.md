# 06 — Stock Home data flow

## Reference boundary

- **Corpus:** `jellyfin/jellyfin-web` **v10.11.11**, commit **`35c0793ece3adbd247eab290ae1effab851f3d37`**. `[VERIFIED_FROM_SOURCE]` Package identity is declared in `package.json`, `name`/`version`, lines 2–5; the commit is the Phase-1 blob-verified corpus identity.
- **Scope:** stock Home only. Stable mode maps `/home` to the legacy `home` controller/view; experimental mode supplies a React route but still lazy-loads the same `hometab` controller. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/routes/legacyRoutes/user.ts`, `LEGACY_USER_ROUTES`, lines 90–94; `src/apps/experimental/routes/asyncRoutes/user.ts`, `ASYNC_USER_ROUTES`, lines 4–15; `src/apps/experimental/routes/home.tsx`, `Home`, lines 57–100.

## End-to-end workflow

```mermaid
sequenceDiagram
    participant R as Router/Home view
    participant T as HomeTab
    participant Q as React Query
    participant J as Jellyfin API
    participant S as homeSections
    participant C as emby-itemscontainer(s)
    participant D as Card DOM/images

    R->>T: lazy-load hometab; onResume(refresh?)
    T->>J: getCurrentUser()
    T->>Q: fetchQuery(User, userId, Views)
    Q->>J: GET /Users/{userId}/Views
    S->>D: create configured section shells
    S->>C: assign fetchData/getItemsHtml/parentContainer
    S->>C: resume({ refresh: true }) for every container
    par section requests
        C->>J: Resume / NextUp / Latest / Live TV / Recordings
    and per-library Latest
        C->>J: GET /Items/Latest?ParentId=...
    end
    J-->>C: DTO list
    C->>D: replace HTML; lazy-load tagged images
```

1. `HomeView` defines Home/Favorites tabs, dynamically imports `hometab`, creates each tab controller once, and retains it in `tabControllers`. `[VERIFIED_FROM_SOURCE]` `src/controllers/home.js`, `HomeView.getTabs/getTabController`, lines 27–61.
2. First Home resume captures the current API client, shows the global loader, destroys old sections, gets the current user, then calls `homeSections.loadSections`; errors are logged and the loader is hidden in `finally`. Later resumes reuse existing section controllers and call `homeSections.resume`. `[VERIFIED_FROM_SOURCE]` `src/controllers/hometab.js`, `HomeTab.constructor/onResume`, lines 9–44.
3. `loadSections` resolves the user id and uses the process-wide React Query client for User Views. Its query key is `['User', userId, 'Views', params]`; a one-second `staleTime` intentionally coalesces three initial consumers, and the request receives React Query's `AbortSignal`. `[VERIFIED_FROM_SOURCE]` `src/components/homesections/homesections.js`, `loadSections`, lines 55–60; `src/hooks/useUserViews.ts`, `getUserViewsQuery`, lines 20–30.
4. Ten user-selectable slots are read from `homesection0..9` (with stock defaults); TV mode prepends library tiles if neither library representation is configured. Empty User Views render administrator/non-administrator guidance instead of sections. `[VERIFIED_FROM_SOURCE]` `src/components/homesections/homesections.js`, `getAllSectionsToShow/loadSections`, lines 24–53 and 63–108; `src/types/homeSectionType.ts`, `DEFAULT_SECTIONS`, lines 18–27.
5. Section loaders either render immediately from User Views (library tiles/buttons), probe availability (Live TV), or install `fetchData`, `getItemsHtml`, and `parentContainer` callbacks on an `emby-itemscontainer`. `[VERIFIED_FROM_SOURCE]` `src/components/homesections/homesections.js`, `loadSection`, lines 143–176; `src/components/homesections/sections/resume.ts`, `loadResume`, lines 72–104; `src/components/homesections/sections/recentlyAdded.ts`, `renderLatestSection`, lines 87–130.
6. Once shells exist, `loadSections` calls `resume({refresh:true})`; `homeSections.resume` gathers every container promise with `Promise.all`, so section fetches—and every per-library Latest fetch—fan out concurrently. `[VERIFIED_FROM_SOURCE]` `src/components/homesections/homesections.js`, `loadSections/resume`, lines 74–87 and 130–140.
7. A legacy container normalizes `result.Items || result`, shows/hides its parent, replaces its HTML, starts lazy images, restores focus by item id, and resets any refresh interval. `[VERIFIED_FROM_SOURCE]` `src/elements/emby-itemscontainer/emby-itemscontainer.js`, `onDataFetched`, lines 423–472.

## Section/API inventory

The route strings below are the Jellyfin 10.11 API routes corresponding to the named SDK/client calls. Where this snapshot contains only the client method call and not the dependency implementation, the method-to-route expansion is marked `INFERRED`.

| Home input | Client call and important query | HTTP route | Evidence |
|---|---|---|---|
| Current user | `getCurrentUser()` | `GET /Users/Me` | `[INFERRED]` call site: `src/controllers/hometab.js`, `onResume`, lines 28–43 |
| User libraries/views | SDK `getUserViews({userId})` | `GET /Users/{userId}/Views` | `[VERIFIED_FROM_SOURCE]` `src/hooks/useUserViews.ts`, `fetchUserViews`, lines 9–17; route expansion `[INFERRED]` |
| Continue Watching/Listening/Reading | `getResumableItems(userId)`; recursive, media type, limit 12/5 | `GET /Users/{userId}/Items/Resume` | `[VERIFIED_FROM_SOURCE]` `src/components/homesections/sections/resume.ts`, `getItemsToResumeFn`, lines 18–39; route expansion `[INFERRED]` |
| Next Up | `getNextUpEpisodes`; user id, cutoff, rewatching, limit 24/15 | `GET /Shows/NextUp` | `[VERIFIED_FROM_SOURCE]` `src/components/homesections/sections/nextUp.ts`, `getNextUpFetchFn`, lines 14–35; route expansion `[INFERRED]` |
| Latest per eligible view | `getLatestItems`; `ParentId`, image fields, layout-dependent limit | `GET /Items/Latest` | `[VERIFIED_FROM_SOURCE]` `src/components/homesections/sections/recentlyAdded.ts`, `getFetchLatestItemsFn`, lines 17–48 and `loadRecentlyAdded`, lines 132–158; route expansion `[INFERRED]` |
| Live TV probe + On Now | `getLiveTvRecommendedPrograms`; `IsAiring=true`, user id, limits 1 then 24 | `GET /LiveTv/Programs` | `[VERIFIED_FROM_SOURCE]` `src/components/homesections/sections/liveTv.ts`, `getOnNowFetchFn/loadLiveTV`, lines 14–28 and 158–180; route expansion `[INFERRED]` |
| Active recordings | `getLiveTvRecordings`; in-progress only | `GET /LiveTv/Recordings` | `[VERIFIED_FROM_SOURCE]` `src/components/homesections/sections/activeRecordings.ts`, `getLatestRecordingsFetchFn`, lines 10–25; route expansion `[INFERRED]` |
| Images | generated scaled image URLs include item, image type, dimensions, quality and image tag | `GET /Items/{itemId}/Images/{imageType}` | `[VERIFIED_FROM_SOURCE]` `src/components/cardbuilder/cardBuilder.js`, `getCardImageUrl`, lines 268–406; route expansion `[INFERRED]` |

## Ownership and state

| Concern | Owner / writer | Reader | Cache / invalidation / cleanup |
|---|---|---|---|
| API/user session | `ServerConnections`; `HomeTab` snapshots its current client in the constructor | all section fetch closures reacquire by `serverId` | HomeTab nulls references in `destroy`. `[VERIFIED_FROM_SOURCE]` `src/controllers/hometab.js`, lines 9–16 and 52–64 |
| User Views | Jellyfin is authoritative; React Query stores the response | `loadSections`, tiles/buttons, Latest section creation | Key includes user id; 1 s stale window; request is abortable. `[VERIFIED_FROM_SOURCE]` `src/hooks/useUserViews.ts`, lines 20–39 |
| Home layout preferences | `UserSettings` writes local storage and, by default, a cached server DisplayPreferences object; server write is debounced 50 ms | `getAllSectionsToShow` | save triggers settings UI `saved`; active Home marks sections unrendered and rebuilds. `[VERIFIED_FROM_SOURCE]` `src/scripts/settings/userSettings.js`, `saveServerPreferences/set/get`, lines 6–18 and 93–123; `src/scripts/settings/appSettings.js`, `set/get`, lines 263–274; `src/controllers/hometab.js`, lines 68–75 |
| Section DTO lists | individual `fetchData` promise; not a central Home store | `getItemsHtml` | rendered DOM is the retained state; refresh replaces all section HTML. `[VERIFIED_FROM_SOURCE]` `src/elements/emby-itemscontainer/emby-itemscontainer.js`, `refreshItems/onDataFetched`, lines 366–378 and 423–452 |
| Card user data | Jellyfin notifications | card DOM indicators/data attributes | `UserDataChanged` patches matching `.card-withuserdata`; selected monitor types also schedule a full section refresh. `[VERIFIED_FROM_SOURCE]` `src/elements/emby-itemscontainer/emby-itemscontainer.js`, `onUserDataChanged`, lines 145–160; `src/components/cardbuilder/cardBuilder.js`, `onUserDataChanged`, lines 1348–1359 |

## Refresh, concurrency, stale-result and cleanup rules

- `UserDataChanged`, timer changes, `LibraryChanged`, and playback stop are attached on custom-element connection. Background changes debounce section reload by 10 seconds; foreground playback completion reloads immediately. A parent-id filter limits library updates when the container declares one. `[VERIFIED_FROM_SOURCE]` `src/elements/emby-itemscontainer/emby-itemscontainer.js`, lines 145–260 and 381–396.
- Pause clears intervals and turns later notifications into `needsRefresh`; resume reloads if that bit or `options.refresh` is set. Detach removes event handlers, multi-select/drag support, and callback references. `[VERIFIED_FROM_SOURCE]` `src/elements/emby-itemscontainer/emby-itemscontainer.js`, `detachedCallback/pause/resume`, lines 316–378.
- Destroying all Home sections also nulls callbacks before clearing markup. `[VERIFIED_FROM_SOURCE]` `src/components/homesections/homesections.js`, `destroySections`, lines 112–121.
- `[VERIFIED_FROM_SOURCE]` Legacy section requests receive no `AbortSignal`, carry no request generation, and `onDataFetched` does not check attachment or request identity before writing. `src/elements/emby-itemscontainer/emby-itemscontainer.js`, `refreshItems/onDataFetched`, lines 366–378 and 423–456.
- `[INFERRED]` Therefore overlapping refreshes can complete out of order, and a response that completes after detach can reach callbacks that detach has nulled. The stock source supplies cleanup of listeners/timers, not cancellation or latest-generation ownership.
- `[VERIFIED_FROM_SOURCE]` Card-builder insertion has a stronger disposal check (`document.body.contains(itemsContainer)`), but Home's legacy `onDataFetched` writes directly and does not use it. `src/components/cardbuilder/cardBuilder.js`, `buildCards`, lines 1207–1239.

## Failure semantics

- First-load current-user/User-Views/section setup failure is logged by `HomeTab`, and its global loader always clears. `[VERIFIED_FROM_SOURCE]` `src/controllers/hometab.js`, lines 28–43.
- Live TV's initial availability probe participates in section `Promise.all`; its rejection rejects the Home load rather than degrading only that section. `[VERIFIED_FROM_SOURCE]` `src/components/homesections/homesections.js`, lines 74–87 and 158–160; `src/components/homesections/sections/liveTv.ts`, lines 158–180.
- A section `fetchData()` rejection has no local catch in the legacy container. `[VERIFIED_FROM_SOURCE]` `src/elements/emby-itemscontainer/emby-itemscontainer.js`, `refreshItems`, lines 366–378.
- No-libraries is an explicit terminal UI with administrator-aware guidance. `[VERIFIED_FROM_SOURCE]` `src/components/homesections/homesections.js`, lines 88–108.
- `[UNKNOWN]` Stock source does not define a Home-wide concurrency cap, request timeout, retry budget, or rollback of partially rendered sections; those may be supplied by API/dependency/browser layers outside this corpus.

## Durable comparison points

1. Stock Home is **not one authoritative response**: it is User Views plus independently fetched sections.
2. User Views alone is React Query-coalesced and abortable; legacy section fetches are neither.
3. Home lifecycle cleanup is listener/timer/DOM cleanup, not in-flight network cancellation.
4. Stock invalidation is event-driven and section-wide; fine-grained card `UserData` patching coexists with delayed full refresh.

## PTV legacy Home lifetime extension

This section records the current PTV legacy-compatible Home path; the stock observations above remain unchanged.

- `[VERIFIED_FROM_SOURCE]` `HomeTab` owns the active legacy Home consumer, while `routeController` owns its immutable route lifetime. `loadSections` uses the lifetime signal for User Views and carries the exact lifetime through rows, Hero, deferred resume work, listeners, observers, timers, cards, and image/backdrop callbacks. Pause/destroy retires the lifetime before resource cleanup. `src/controllers/hometab.js`, lines 14–86; `src/ptv/pages/home/homesections.js`, lines 95–217 and 1394–1875.
- `[VERIFIED_FROM_SOURCE]` Each route-scoped row or Hero request uses an owned child signal. Shared Featured work is application-owned, but every Web response layer now preserves one canonical immutable Jellyfin `serverId + userId` identity: `pluginApi` includes it in authenticated GET response-cache/coalescing keys, while `featuredContentCache` retains only the current identity owner and generation. Authenticated Featured GET candidates are restricted to the active ApiClient root plus compatibility route names on that same root; another configured, remembered, page or development server root is never a fallback. Missing or contradictory identity never joins a shared request or reads a prior Featured payload; a user/server transition retires the old owner, and late completion cannot publish into the new owner. Genre/studio support reads use the bounded coordinator-owned background transport rather than legacy unowned `ApiClient.getJSON`. `src/ptv/pages/home/ptvRows.js`, `createOwnedHomeApiClient/createFeaturedContentFetcher/createFetchData/loadGenreMap/loadStudioMap`; `src/ptv/modules/cache/featuredContentCache.ts`, `requireCurrentFeaturedCacheOwner/assertFeaturedCacheOwnerCurrent`; `src/ptv/core/pluginApi.ts`, `getPluginRootCandidates/getPluginUrlCandidates/getPluginAuthenticatedIdentity/getPluginRequestCacheKey/requestPluginJson`.
- `[VERIFIED_FROM_SOURCE]` Dashboard Featured operations capture the current identity before readback. Each readback creates an owner-bound hydrator, identity is rechecked after transport and retry delay, and an old owner's document cannot hydrate the current memory cache. Even an already-selected memory hit resolves on a queued microtask that reasserts its captured owner before publication. `src/ptv/modules/dashboard/PiggieTvRowsPage.tsx`, `readFeaturedCacheDocumentReadback/readFreshFeaturedCacheDocumentReadback/observeStoredFeaturedCacheDocumentAfterSave`; `src/ptv/modules/cache/featuredContentCache.ts`, `resolveForFeaturedCacheOwner/createFeaturedContentCacheDocumentHydrator/createFeaturedContentCacheIdentityGuard`.
- `[VERIFIED_FROM_SOURCE]` Forced row-image work now retains the exact `loadPtvImage` consumer handle by row container, image element, route owner and URL. Row/route cleanup cancels that consumer, URL or owner replacement retires the old consumer, and the settled callback checks both the retained entry and current route before invoking the lazy-image DOM publisher. The shared image task remains available to another valid consumer under `imageManager`'s existing lease contract. `src/ptv/pages/home/ptvRows.js`, `forcedRowImageLoads/retireForcedRowImageLoads/loadRowImageElementsNow`; `src/ptv/core/imageManager.ts`, consumer cancellation and final-consumer transport retirement.
- `[VERIFIED_FROM_SOURCE]` `emby-itemscontainer` tracks a monotonically increasing refresh generation and exact data owner. Only the newest current-owner result may write HTML or invoke `afterRefresh`; pause preserves a retry bit, while detach clears timers/callbacks and invalidates the generation. `src/elements/emby-itemscontainer/emby-itemscontainer.js`, `detachedCallback/pause/resume/refreshItems/onDataFetched`, lines 316–457.
- `[VERIFIED_BY_TEST]` Delayed A/B publication, route churn, pause/resume, listener/observer/timer cleanup, row transport retirement, image/backdrop invalidation, card probes, Hero callbacks, and container overlap/detach are covered by the `*.lifecycle.test.*` files beside these modules. Featured admin/restricted, server, concurrent, stale-completion, logout, missing-identity, active-root-only, queued-memory and delayed-hydrator isolation is covered by `featuredContentCacheIdentity.test.ts` and `pluginApiIdentityCache.test.ts`; forced image reuse/cancellation/late-publication behavior is covered by `ptvRows.lifecycle.test.ts` and `imageManager.test.ts`.

Deterministic request shape is unchanged for the migrated Home reads: one User Views request, one genre support request, one studio support request, and the pre-existing Featured/row queries. The change replaces transport ownership and publication rules; it does not add a reload, retry, or discovery request.
