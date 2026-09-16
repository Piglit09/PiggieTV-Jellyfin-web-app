# 09 — Stock Search

## Reference boundary

- **Corpus:** `jellyfin/jellyfin-web` **v10.11.11**, commit **`35c0793ece3adbd247eab290ae1effab851f3d37`**. `[VERIFIED_FROM_SOURCE]` `package.json`, lines 2–5; commit identity from the Phase-1 blob inventory.
- Stable Search is a lazy React user route at `/search`, inside the authenticated `ConnectionRequired` branch. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/routes/asyncRoutes/user.ts`, lines 3–7; `src/apps/stable/routes/routes.tsx`, lines 15–30.

## Input-to-results workflow

```mermaid
sequenceDiagram
    participant U as User/URL
    participant P as Search page
    participant Q as React Query
    participant J as Jellyfin API
    participant A as Aggregator
    participant C as Legacy cards

    U->>P: type query
    P->>U: replace ?query= immediately
    Note over P: debounce value 500 ms
    alt debounced query empty
        P->>Q: SearchSuggestions(parentId)
        Q->>J: GET /Items (favorite/random, 20)
    else non-empty
        par scoped facet queries
            Q->>J: GET /Artists
            Q->>J: GET /Persons
            Q->>J: GET /Items (videos/programs)
        end
        Q-->>A: facet query data/pending state
        A->>J: GET /Items (typed main result, limit 800)
        A->>A: split by Type; add non-empty sections; sort
        A-->>C: sections + BaseItemDto arrays
        C->>C: inject scroller/custom element; build cards/images
    end
```

1. `Search` reads `parentId` and `collectionType` from URL parameters; `query` is two-way state through `useSearchParam`. The URL is replaced on every local value change, while only a 500 ms debounced value chooses suggestions versus results. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/routes/search.tsx`, `Search`, lines 13–41; `src/hooks/useSearchParam.ts`, lines 10–44.
2. An empty debounced value calls `useSearchSuggestions`, which requests 20 favorite/random Movies, Series and MusicArtists, with images disabled, and renders direct links. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useSearchSuggestions.ts`, lines 10–47; `src/apps/stable/features/search/components/SearchSuggestions.tsx`, lines 15–45.
3. A non-empty value mounts `useSearchItems`. It concurrently starts scope-appropriate artist, person, video, program and Live TV queries, waits for their initial pending conditions to clear, then runs a main typed Items query and composes sections. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useSearchItems.ts`, lines 16–39 and 42–98.
4. The main response has a limit of 800, is partitioned by `BaseItemKind`, merged with the specialist rows, empty rows are omitted, and rows are put into a fixed order. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useSearchItems.ts`, query function, lines 42–87; `src/apps/stable/features/search/utils/search.ts`, `addSection/sortSections/getItemTypesFromCollectionType`, lines 22–45 and 110–140.
5. React owns section composition, but each row injects a legacy scroller/`emby-itemscontainer` HTML shell and calls legacy `cardBuilder.buildCards` in an effect. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/components/SearchResults.tsx`, `SearchResults`, lines 45–67; `src/apps/stable/features/search/components/SearchResultsRow.tsx`, `SearchResultsRow`, lines 9–40.

## Scope and request fan-out

| Scope | Specialist queries | Main typed query | Expected initial transport shape |
|---|---|---|---|
| Global (`collectionType` absent) | Artists, People, generic Videos, Live TV Programs | Movies, Series, Episodes, Playlists, Albums, Audio, TV channels, Photos, Audiobooks, Books, Collections | Five item/facet requests; Live TV multi-row search is disabled. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useSearchItems.ts`, lines 21–33 and 60–73; `src/apps/stable/features/search/utils/search.ts`, `getItemTypesFromCollectionType`, lines 110–140 |
| Music | Artists | Playlists, Albums, Audio | Two requests. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useArtistsSearch.ts`, `useArtistsSearch`, lines 28–48; `src/apps/stable/features/search/utils/search.ts`, lines 119–124 |
| Movies | People | Movies | Two requests. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/usePeopleSearch.ts`, `usePeopleSearch`, lines 28–49; `src/apps/stable/features/search/utils/search.ts`, lines 110–114 |
| TV shows | People | Series, Episodes | Two requests. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/usePeopleSearch.ts`, `usePeopleSearch`, lines 28–49; `src/apps/stable/features/search/utils/search.ts`, lines 114–118 |
| Live TV | Seven parallel typed Item requests: movies, episodes, sports, kids, news, uncategorized programs, channels | none beyond the Live TV section return | Seven requests in one `Promise.all`. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useLiveTvSearch.ts`, `fetchLiveTv`, lines 12–133 and hook lines 136–149 |

The code has no explicit search concurrency limiter. `[VERIFIED_FROM_SOURCE]` Fan-out is created by independent `useQuery` hooks in `src/apps/stable/features/search/api/useSearchItems.ts`, `useSearchItems`, lines 16–35, and the `Promise.all` in `src/apps/stable/features/search/api/useLiveTvSearch.ts`, `fetchLiveTv`, lines 12–133; no semaphore/queue appears in these flows. `[UNKNOWN]` Browser/HTTP-agent limits are outside this corpus.

## API route and query inventory

All requests carry the current user id and pass React Query's `AbortSignal` into the SDK/Axios request options. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useArtistsSearch.ts`, `useArtistsSearch`, lines 33–47; `src/apps/stable/features/search/api/usePeopleSearch.ts`, `usePeopleSearch`, lines 33–49; `src/apps/stable/features/search/api/fetchItemsByType.ts`, `fetchItemsByType`, lines 7–22.

| Result family | Generated SDK call | HTTP route | Stock bounds |
|---|---|---|---|
| Suggestions | `getItemsApi(api).getItems(...)` | `GET /Items` | 20; recursive; favorite/random; images off. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useSearchSuggestions.ts`, `fetchGetItems`, lines 10–34; route expansion `[INFERRED]` |
| Artists | `getArtistsApi(api).getArtists(...)` | `GET /Artists` | 100; image limit 1. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useArtistsSearch.ts`, fetch helper, lines 11–25; `src/apps/stable/features/search/constants/queryOptions.ts`, lines 3–12; route expansion `[INFERRED]` |
| People | `getPersonsApi(api).getPersons(...)` | `GET /Persons` | 100; image limit 1. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/usePeopleSearch.ts`, fetch helper, lines 11–25; route expansion `[INFERRED]` |
| Videos | `getItemsApi(api).getItems(...)` | `GET /Items` | 100; recursive Video media; excludes Movie/Episode/TV channel. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useVideoSearch.ts`, fetch helper, lines 12–33; route expansion `[INFERRED]` |
| Programs | `fetchItemsByType(...LiveTvProgram)` | `GET /Items` | 100. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useProgramsSearch.ts`, fetch helper, lines 10–27; route expansion `[INFERRED]` |
| Main typed set | `fetchItemsByType` | `GET /Items` | 800; recursive; kinds chosen by collection scope. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useSearchItems.ts`, query function, lines 60–73; route expansion `[INFERRED]` |
| Live TV rows | seven `fetchItemsByType` calls | `GET /Items` | 100 each; category flags plus `LiveTvProgram`/`TvChannel`. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useLiveTvSearch.ts`, `fetchLiveTv`, lines 12–133; route expansion `[INFERRED]` |

`INFERRED` route expansions are the generated Jellyfin 10.11 API routes named by the imported API classes; generated dependency bodies are not present in the stock snapshot.

## Ownership, cache and invalidation

| State | Owner / writer | Reader | Cache / cleanup |
|---|---|---|---|
| Raw input | `useSearchParam` local state; URL is synchronized with `replace` | Search field and debounce | Back/URL changes are adopted into local state. `[VERIFIED_FROM_SOURCE]` `src/hooks/useSearchParam.ts`, lines 17–44 |
| Debounced input | `useDebounceValue(query,500)` | results/suggestions branch | Hook lifecycle; not stored globally. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/routes/search.tsx`, lines 17–40 |
| API/user | `ApiProvider` | every search hook | enabled only with API + user id; provider clears them on sign-out. `[VERIFIED_FROM_SOURCE]` `src/hooks/useApi.tsx`, lines 19–68 |
| Specialist results | global React Query client | aggregate query function | keys include search scope/term, but **not server or user id**. `[VERIFIED_FROM_SOURCE]` hooks: `src/apps/stable/features/search/api/useArtistsSearch.ts`, lines 36–47; `usePeopleSearch.ts`, lines 38–49; `useVideoSearch.ts`, lines 44–56; `useProgramsSearch.ts`, lines 37–49; `useLiveTvSearch.ts`, lines 144–149 (all in the same `api` directory) |
| Aggregated sections | React Query query `['Search','Items',collectionType,parentId,searchTerm]` | `SearchResults` | no explicit invalidation or cache timing in feature code. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useSearchItems.ts`, `useSearchItems`, lines 35–98 |
| Suggestions | React Query `['SearchSuggestions',{parentId}]` | `SearchSuggestions` | window-focus refetch disabled; key omits search server/user. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useSearchSuggestions.ts`, `useSearchSuggestions`, lines 37–47 |
| Rendered cards | legacy row DOM | item shortcuts/images | React unmount removes row DOM; custom element handles its own detached subscriptions. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/components/SearchResultsRow.tsx`, effect/render, lines 25–40; `src/elements/emby-itemscontainer/emby-itemscontainer.js`, lifecycle lines 316–338 |

The global query client sets `networkMode:'always'` but no feature-independent stale/cache timing. `[VERIFIED_FROM_SOURCE]` `src/utils/query/queryClient.ts`, lines 1–12. Explicit Dashboard logout clears the entire query cache, but Search itself performs no invalidation. `[VERIFIED_FROM_SOURCE]` `src/utils/dashboard.js`, `logout`, lines 104–112.

## Cancellation, stale data and concurrency semantics

- All modern search network functions forward the query function's `signal`; a superseded/unmounted query can therefore be canceled by React Query/Axios where supported. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useSearchSuggestions.ts`, `useSearchSuggestions`, lines 41–46; `src/apps/stable/features/search/api/useSearchItems.ts`, query function, lines 35–73; `src/apps/stable/features/search/api/fetchItemsByType.ts`, lines 7–22.
- Query keys include term and collection/parent scope, so different debounced terms do not intentionally share one cache record. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useSearchItems.ts`, line 36; `src/apps/stable/features/search/api/useArtistsSearch.ts`, lines 36–47; `src/apps/stable/features/search/api/usePeopleSearch.ts`, lines 38–49.
- `[VERIFIED_FROM_SOURCE]` Keys omit API server and user identity even though query functions close over `api` and `userId`. `src/apps/stable/features/search/api/useSearchItems.ts`, `useSearchItems`, lines 26–37; `src/apps/stable/features/search/api/useArtistsSearch.ts`, `useArtistsSearch`, lines 28–47. `[INFERRED]` A server/user switch without full query-cache clear can momentarily reuse a same-key result from another authority. Explicit logout clears the cache; ordinary provider replacement is not an invalidation in this feature.
- `[VERIFIED_FROM_SOURCE]` The aggregate query key does not include specialist result data; it reads those captured results when it runs. `src/apps/stable/features/search/api/useSearchItems.ts`, `useSearchItems`, lines 35–87. `[INFERRED]` Later background specialist refetches do not themselves invalidate the already-cached aggregate section list.
- `[VERIFIED_FROM_SOURCE]` The 500 ms debounce limits query-key churn, but the URL is still updated per keystroke. `src/apps/stable/routes/search.tsx`, `Search`, lines 17–40; `src/hooks/useSearchParam.ts`, `useSearchParam`, lines 22–42.

## Failure and empty-state semantics

- `SearchSuggestions` handles `isPending` only; once no longer pending it maps optional data and has no explicit error UI. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/components/SearchSuggestions.tsx`, `SearchSuggestions`, lines 15–45.
- `SearchResults` handles `isPending`, then treats absent/empty aggregate data as `SearchResultsEmpty`; in a scoped search it offers a global retry link. It does not render `isError` or an error reason. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/components/SearchResults.tsx`, `SearchResults`, lines 20–43.
- The aggregate can omit a failed/absent specialist family because `addSection` ignores missing/empty inputs, then still request the main typed set. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useSearchItems.ts`, query function, lines 42–87; `src/apps/stable/features/search/utils/search.ts`, `addSection`, lines 22–31. Exact React Query retry/error-state timing is `[UNKNOWN]` from application source because it depends on dependency defaults.
- Live TV uses one `Promise.all` for seven rows, so one rejected category rejects that query rather than returning other completed rows. `[VERIFIED_FROM_SOURCE]` `src/apps/stable/features/search/api/useLiveTvSearch.ts`, `fetchLiveTv`, lines 12–133.
- `cardBuilder.buildCards` declines to update a row container already removed from `document.body`, bounding late render effects. `[VERIFIED_FROM_SOURCE]` `src/components/cardbuilder/cardBuilder.js`, `buildCards`, lines 1207–1239.

## Durable comparison points

1. Stock Search is a React Query fan-out/aggregation pipeline, not one server search endpoint.
2. Query cancellation exists and term/scope are keyed, but server/user authority is not part of the keys.
3. The result model is section-level and read-only; card interactions delegate to shared card/container infrastructure.
4. Error and empty states are not distinguished in the visible Search components.
