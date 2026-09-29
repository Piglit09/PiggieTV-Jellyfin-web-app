# Before-you-modify checklists

## Scope and evidence

These are review gates for changes to stock-compatible Jellyfin `10.11.11` and current PTV behavior. Every checkbox is a `RECOMMENDATION`; it becomes `VERIFIED_BY_TEST` only when a task records the exact command/environment/fixture/outcome. Architecture statements are labeled and cited to:

- Jellyfin Web `10.11.11` @ `35c0793ece3adbd247eab290ae1effab851f3d37` (`W@35c0793`).
- Jellyfin Server `10.11.11` @ `1fbd8739292cce610231be93daf43368733edf63` (`S@1fbd873`).
- current dirty `Jellyfin-Web-PiggieTV` worktree inspected `2026-09-04`, base HEAD `0e9c6284c91003fc64bbe02bf675f1ff6ffd9337`, PTV Web `0.5.57` (`PTV-WEB@worktree`).

Use [22-change-impact-matrix](22-change-impact-matrix.md) to find adjacent subsystem gates. Do not mark an item complete from a similarly named file or a successful HTTP status alone.

## Local Web 0.5.60 Pass 01 regression contract

- [x] Same-type Shows/Anime/Cartoons fixtures use disjoint IDs; no type/genre/provider/title heuristic grants library membership.
- [x] Read one ordinary Jellyfin `ParentId` per resolved root; merge/deduplicate bounded pages without unsupported `AncestorIds` or `Ids` shortcuts.
- [x] Reject missing resolution, foreign/missing/error nested ancestry, retired server/user identity and aborted owners before publication.
- [x] Rank only fresh scoped DTOs; empty/small/error fallback cannot fill with a foreign library. Warm global rank data remains non-authoritative.
- [x] Keep focused/directory cache identity rooted in server/user/library/route/filter/page; version incompatible focused entries rather than disabling caching.
- [x] Repeated Home preview callbacks converge while changed DTOs and exact freshness-snapshot retirement still work.
- [x] Projected/grouped UserViews require ordinary per-root paged Series membership before Season reads when physical ancestry cannot represent the view; foreign/exhausted/cancelled/retired and non-Season/BoxSet cases stay closed.
- [x] Multi-root Random pools do not starve later roots; library backdrop retirement rejects late callbacks and same-scope unavailable-to-ready resurrection.
- [ ] Complete manual local Home/library route, details/back and hard-refresh acceptance; record a missing Cartoons library as unavailable rather than populated acceptance.

These entries describe the local `fix/web-library-isolation` source and focused regressions, not production qualification. They leave Plugin, global Home rows, Premium Collections, versioning and the remaining stabilization backlog unchanged.

## Universal preflight

- [ ] State the intended behavior and the one authoritative owner that should change.
- [ ] Record repository, branch, HEAD, product version and dirty paths before editing; isolate pre-existing work.
- [ ] Classify each touched path as stock unchanged/styled/wrapped/extended/replaced/bypassed, duplicate implementation, or new PTV system.
- [ ] Draw the request/mutation from trigger through authentication, API, persistence, readback, cache, render and cleanup.
- [ ] List every identity dimension: server, user/security scope, route generation, item/library ID, operation generation, schema and build generation.
- [ ] List every terminal state: success, empty, partial, error, timeout, cancellation/unmount, stale/late result and retry.
- [ ] Name the authoritative readback and the fields it may omit. A DTO is a projection controlled by requested options and conditional relationship attachment. `VERIFIED_FROM_SOURCE` — S@1fbd873, `Emby.Server.Implementations/Dto/DtoService.cs`, `AttachBasicFields`/relationship attachment, lines 782-882 and 1010-1097; `MediaBrowser.Model/Dto/BaseItemDto.cs`, lines 285-499.
- [ ] Identify every cache and invalidator. Stock Query, legacy view, browser image and playback state are independent owners. `VERIFIED_FROM_SOURCE` — W@35c0793, `src/utils/query/queryClient.ts`, lines 1-12; `src/components/viewManager/viewManager.js`, lines 101-145; `src/components/cardbuilder/Card/useCardImageUrl.ts`, lines 261-290; `src/components/playback/playbackmanager.js`, lines 102-146 and 3163-3240.
- [ ] Decide whether a live server/device check is necessary and define a safe fixture before coding.
- [ ] Define the rollback boundary before a release/deploy-affecting change.
- [ ] Keep unresolved behavior as `UNKNOWN`; do not convert an inference into a contract.

## Startup, authentication and session

Stock connection restoration validates a saved token and hydrates current user/preferences across multiple owners; explicit logout clears Query data and retained legacy views. PTV wraps the stock initializer with a shared promise and explicitly leaves Jellyfin session/API creation authoritative. `VERIFIED_FROM_SOURCE` — W@35c0793, `src/lib/jellyfin-apiclient/connectionManager.js`, lines 204-258 and 424-628; `src/lib/jellyfin-apiclient/ServerConnections.js`, lines 41-49 and 137-146; `src/utils/dashboard.js`, lines 104-112; PTV-WEB@worktree, `src/ptv/core/initialization/webAppBootstrap.ts`, `initializePtvWebAppOnce`, lines 13-45; `src/ptv/core/initialization/webCoreRuntime.ts`, adapter, lines 120-176.

- [ ] Preserve the ordering: stock connection/API setup → token validation → user/preferences hydration → route-ready presentation.
- [ ] Do not create a second token store, current-user authority or API-client lifecycle in PTV.
- [ ] Distinguish “credential present,” “authenticated request succeeded,” “current user loaded” and “UI ready.”
- [ ] Keep bootstrap idempotent under concurrent/repeated calls; a rejected initialization must have an explicit retry/terminal path.
- [ ] On runtime 401, define which owner revokes local state and how caches/views retire; do not leave a half-authenticated PTV shell.
- [ ] Preserve logout completion even when remote logout/revocation fails.
- [ ] Keep post-login redirection bounded to an allowed route and single navigation. PTV's guard rejects stale settings/unknown targets and commits once. `VERIFIED_FROM_SOURCE` — PTV-WEB@worktree, `src/ptv/shell/authenticationRoutes.ts`, `getPtvLoginRedirectDecision`/`createPtvPostLoginNavigationGuard`, lines 178-214.
- [ ] Test cold start: no token, valid token, rejected/expired token, unreachable server and current-user failure.
- [ ] Test password login, Quick Connect approval/poll/expiry, restart restore, server switch, logout, force-stop/hard refresh and fresh login after rejection.
- [ ] Assert Query data, UserSettings, retained views and PTV identity-scoped caches do not cross users/servers.

## Routing, navigation, dialogs and lifecycle

React Router owns the hash route, while legacy navigation/view cache and dialogs retain separate lifecycle rules. PTV adds native/enhanced/fallback ownership plus route generations. `VERIFIED_FROM_SOURCE` — W@35c0793, `src/RootAppRouter.tsx`, lines 21-42; `src/components/viewManager/ViewManagerPage.tsx`, lines 95-139; `src/components/viewContainer.js`, lines 167-247; `src/components/dialogHelper/dialogHelper.js`, lines 47-155 and 157-197; PTV-WEB@worktree, `src/ptv/shell/routeController.ts`, `getControllerMode`/`normalizeRoute`/generation functions, lines 235-290 and 445-570.

- [ ] Declare one owner for each route: native, enhanced stock page, or stock fallback.
- [ ] Treat the canonical browser URL/hash as route identity authority. DOM classes, visibility, mounted-component state, and deferred teardown markers may describe presentation only; they must not claim a different URL.
- [ ] Do not mount a native renderer and DOM enhancer for the same content unless the wrapper contract explicitly requires both.
- [ ] Give every asynchronous route task a generation/item/identity check or abort signal before it writes.
- [ ] Dispose timers, global/document listeners, observers, portals and focus ownership on unmount/viewhide/viewdestroy as appropriate.
- [ ] Preserve dialog history: Escape/back closes the top layer; modal open does not remount the underlying legacy view; focus returns safely.
- [ ] Preserve legacy direct links and fallback behavior when a PTV native module cannot load.
- [ ] Test direct URL, sidebar link, programmatic navigation, back/forward, same-route query change, modal history and hard refresh.
- [ ] Test rapid A→B→A navigation with delayed A and B work; assert no stale DOM/state commit and no duplicate listener.
- [ ] Test authenticated and unauthenticated deep links, including protected/admin routes.

## Permissions and per-user library access

Authentication is not item authorization. Stock request policies, folder/item visibility and user-aware item queries are the security boundary. Low-level item lookup with no real user can be permissive, so Plugin code must resolve the authenticated Jellyfin user and fail closed. `VERIFIED_FROM_SOURCE` — S@1fbd873, `Jellyfin.Api/Auth/DefaultAuthorizationPolicy/DefaultAuthorizationHandler.cs`, `HandleRequirementAsync`, lines 41-93; `MediaBrowser.Controller/Entities/BaseItem.cs`, visibility, lines 1337-1370, 1591-1640, 1660-1699 and 1736-1750; `Emby.Server.Implementations/Library/LibraryManager.cs`, user-aware item lookup/visibility, lines 1380-1406 and 3355-3367; `Jellyfin.Api/Controllers/ItemsController.cs`, `GetItems`, lines 160-340 and 465-534.

- [ ] Resolve request identity from Jellyfin's authenticated principal; reject missing, empty, ambiguous and deleted users.
- [ ] Use Jellyfin's user-aware library/item API—not names, paths, client visibility or an invented ACL.
- [ ] Authorize before DTO/JSON serialization and before logging any item-derived value.
- [ ] If raw candidates are shared, never expose them directly; keep per-user projection outside shared-cache mutation.
- [ ] Include authoritative user/security scope in every response cache key, or mark the response private/no-store.
- [ ] Never treat Web filtering as the security boundary.
- [ ] Test admin A+B; restricted A-only; second restricted B-only; anonymous; unresolved/deleted user; permission change.
- [ ] Pre-populate shared cache, issue concurrent differently scoped requests, then issue admin again; assert no poisoning/cross-contamination.
- [ ] Search the entire restricted wire payload for forbidden ID, name, overview, tags/genres, image tags and provider IDs.
- [ ] Verify diagnostics use only fixed categories/counts—no usernames, IDs, titles, paths, tokens or provider values.

Current PTV Featured follows that shape by resolving one authenticated claim and projecting the shared document through user-aware `ILibraryManager.GetItemById(itemId, user)` before returning a private/no-store response. `VERIFIED_FROM_SOURCE` — PTV-WEB@worktree, `src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvStatusController.cs`, `GetFeaturedContent`/`TryGetAuthenticatedUserId`, lines 329-395 and 3032-3082; `src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Services/PtvFeaturedContentAuthorizationService.cs`, `AuthorizeForUser`, lines 203-304.

## Libraries, identities, scans and relationships

User Views, virtual folders, collection folders, item parents and filesystem locations are different identities. Server DTOs expose projections of entity relationships. `VERIFIED_FROM_SOURCE` — S@1fbd873, `Emby.Server.Implementations/Library/UserViewManager.cs`, `GetUserViews`, lines 45-159; `Emby.Server.Implementations/Dto/DtoService.cs`, lines 818-882 and 1010-1097; `Jellyfin.Api/Controllers/LibraryStructureController.cs`, lines 29-357.

- [ ] Write an identity table: display name, virtual-folder record, collection-folder/item ID, parent/top-parent ID and path; mark which endpoint expects each.
- [ ] Capture actions by stable ID, not array position, display name or path.
- [ ] Keep every user-facing library query user-scoped, including cached discovery.
- [ ] Treat fields/children/image limits as request shape; never promote a list DTO to a relationship-complete authority.
- [ ] Separate global scan from exact-library refresh. Never fall back from individual to global.
- [ ] Label `204` from item refresh as accepted/queued unless completion is actually observed. `VERIFIED_FROM_SOURCE` — S@1fbd873, `Jellyfin.Api/Controllers/ItemRefreshController.cs`, `RefreshItem`, lines 21-91.
- [ ] Test two libraries with similar names, reordered/deleted/renamed library, restricted user, empty library and scan already active.
- [ ] Test duplicate clicks, timeout/cancel/error, exact outgoing ID/method and terminal UI state.
- [ ] Invalidate User Views/library-index/downstream list consumers only after a successful authority change; preserve unrelated caches.
- [ ] Observe Jellyfin evidence that the intended library starts refreshing and that PTV did not issue a global scan.

PTV's individual path currently single-flights by exact ID and calls the generated `refreshItem` API with default metadata/image modes and no full replacement. `VERIFIED_FROM_SOURCE` — PTV-WEB@worktree, `src/ptv/modules/settings/admin/libraries/adminLibrariesService.ts`, `startAdminLibraryScan`, lines 579-613.

## Home, Featured and recommendations

Stock Home is a fan-out of user views, resume, Next Up, Latest and optional Live TV sections; it is not one atomic snapshot. PTV Native Home adds Plugin Featured content, preference/personalization state, image candidates and an active server/user identity guard. `VERIFIED_FROM_SOURCE` — W@35c0793, `src/hooks/useUserViews.ts`, lines 9-39; `src/components/homesections/sections/resume.ts`, lines 18-39; `src/components/homesections/sections/recentlyAdded.ts`, lines 17-48 and 132-158; PTV-WEB@worktree, `src/ptv/pages/home/NativeHome.tsx`, dependencies/identity guard, lines 11-92 and 3095-3163.

- [ ] List every Home request and which rows consume it; set a request/concurrency budget before changing orchestration.
- [ ] Keep `serverId + userId` (and relevant configuration/schema) in data/cache identity.
- [ ] Make each optional row reach success/empty/error/cancel independently; do not let a degraded provider hold the primary Home lock.
- [ ] Authorize Featured server-side before response; keep Web reconciliation as defense-in-depth.
- [ ] Retire stale hero/preload/preference tasks on route or identity change. PTV currently uses identity matching and hero request tokens. `VERIFIED_FROM_SOURCE` — PTV-WEB@worktree, `NativeHome.tsx`, lines 3131-3155 and 3538-3589.
- [ ] Bound image preloads/failures and timer/listener state; ensure hidden/unmounted Home is quiet.
- [ ] Test cold and warm cache, Plugin absent/old/unhealthy, one failed row, no libraries, restricted user and server/user switch.
- [ ] Measure transports, peak concurrency, first content, settle time, image attempts/errors and post-navigation background work.
- [ ] Verify preference/feedback save generation cannot overwrite a newer identity/document.

Current PTV Featured preserves the Plugin's per-user response through Web transport and memory: `getPtvAuthenticatedDisplayIdentityKey` requires one unambiguous immutable Jellyfin server ID plus the authenticated user ID and canonicalizes them through `getPtvDisplayIdentityKey`; authenticated Plugin GET cache/coalescing includes that key; authenticated Featured candidates are restricted to the active ApiClient root and same-root compatibility routes; the Featured module retains one active identity generation, reasserts it for queued memory, and rejects old-owner completion; dashboard readback captures an owner-bound hydrator and identity guard. Missing or contradictory identity cannot read/join shared state. Forced Home row images retain exact consumer handles and release them on row/route retirement without cancelling another valid consumer. `VERIFIED_FROM_SOURCE` / `VERIFIED_BY_TEST` — `src/ptv/services/displayIdentity.ts`; `src/ptv/core/pluginApi.ts`; `src/ptv/modules/cache/featuredContentCache.ts`; `src/ptv/modules/dashboard/PiggieTvRowsPage.tsx`; `src/ptv/pages/home/ptvRows.js`; `src/ptv/core/imageManager.ts`; `pluginApiIdentityCache.test.ts`; `featuredContentCacheIdentity.test.ts`; `ptvRows.lifecycle.test.ts`; `imageManager.test.ts`.

### Isolated configured-presentation freshness candidate

The isolated Plugin 0.5.17.0 startup-recovery derivative passes local qualification; Web remains 0.5.57 and physical post-fix validation is pending. CURRENT is **current at the final verified authoritative server read**, not a promise about an unobserved later mutation.

- [ ] Obtain both administrator settings/rows and authorized Featured inputs before initiating the final protected status verification; matching cached pairs are insufficient.
- [ ] Prove existing `bypassCache:true` skips both Plugin GET cache and pre-input in-flight reuse without changing generic coalescing, TTL, deadlines or concurrency.
- [ ] Match exact version/scope/generation and administrator issued rule/section pairs. Reject missing, malformed, ambiguous, stale, unissued, or relabeled metadata; do not fall back to titles/order/raw IDs.
- [ ] Test the SEC-01 hashless authorized payload through actual `useNativeHomeData`: only the live final-read proof may replace the removed private legacy configuration-hash check; configured section matching is still mandatory.
- [ ] Keep Jellyfin item authorization independent. Opaque presentation proof is not a permission token, payload signature, or defense against arbitrary browser-code rewriting.
- [ ] Retire on observed status/settings/Featured mismatch or uncertainty, configuration mutation, connection uncertainty, route retirement, logout, user/server switch; ordinary cached observations never promote.
- [ ] Cover matching stale inputs, A→B→A, identical save, same-config regeneration, restart and old untrusted disk cache; require explicit new final verification after retirement.
- [ ] Keep content freshness separate from current-process binding readiness. A fresh old-process cache must remain untrusted and trigger one normal generation through the existing refresh owner, not retrospective registration.
- [ ] Prove conditional callers recheck under the same semaphore; failed/config-retired recovery retries on the bounded owner deadline, wakes an already-sleeping owner, and does not change ordinary expiry/failure cadence or forced-refresh behavior. Test worker retirement with zero live timers.
- [ ] Test exact Latest Movies/Shows/Music rule pairs and synthetic item membership, empty configured source, zero/partial authorized survivors and unchanged SEC-01 redaction; physical post-fix restart/reload/retained-last-good proof is separate from component tests.
- [ ] Guard configured cache/last-good/settled rows, row-derived Hero, pending/focused/active previews, stale focus/rotation callbacks and retained image fades at presentation time, not only an after-paint effect.
- [ ] Legacy Home without the verifier must omit configured rows, including malformed markers, and never restore old/unproven configured HTML. Preserve explicit generic HTML.
- [ ] Preserve independently owned Hero, generic Continue, Made For You, Hidden Gems and personalization; do not broaden recommendation/playback/request policies.
- [ ] Record race after final read/no observation as allowed point-in-time behavior. After observed change, prove immediate configured retirement and no old-generation revival.
- [ ] Run issuer/controller, parser/freshness, Plugin cache/bypass, hooks, preview, legacy and backdrop tests; then full Plugin/PTV/repository, TypeScript, lint/stylelint baselines, production build, provenance/version, Atlas and diff gates.
- [ ] Only after full local gates, perform authorized CT103 matched samples and membership/pressure checks, then restore exact normal lab artifacts. No production action or version bump is implied by local tests.

## Cards and item actions

Cards consume a DTO projection and delegate actions to authoritative Jellyfin mutations/playback; PTV also watches and enhances stock-rendered card DOM. `VERIFIED_FROM_SOURCE` — W@35c0793, `src/components/cardbuilder/Card/useCardImageUrl.ts`, lines 156-290; `src/elements/emby-itemscontainer/ItemsContainer.tsx`, lines 176-225; PTV-WEB@worktree, `src/ptv/modules/cards/CardEnhancer.ts`, `enhanceCard`/`enhancePtvCards`, lines 100-126; `src/ptv/modules/cards/index.js`, lines 4-16.

- [ ] Identify whether the card is stock-rendered, PTV-native, or stock DOM enhanced; do not create two action/image owners.
- [ ] Make enhancement idempotent and reversible; avoid selecting library tiles or detached nodes accidentally.
- [ ] Close context menus on action, outside click, Escape, another menu, navigation and owner unmount.
- [ ] Preserve item ID, server/user scope and `UserData`; do not replace the entire item with an action response unless it is authoritative and complete.
- [ ] Update/invalidate every visible projection of the same item or document the surface-local behavior.
- [ ] Keep focus/keyboard/TV navigation stable across rerender and menu/modal transitions.
- [ ] Test sparse/full DTOs, missing image, inaccessible action, mutation failure, rapid repeated action and card removal during request.
- [ ] Test the same item on Home, Search, Details and a library grid; ensure one surface cannot roll back newer UserData on another.

## Details, seasons and episodes

Stock Details owns a controller-local primary DTO while auxiliary sections settle independently; a restored legacy view can reuse state without a readback. PTV adds an enhancement generation and optional user-scoped Plugin relationship hydration. `VERIFIED_FROM_SOURCE` — W@35c0793, `src/controllers/itemDetails/index.js`, primary/auxiliary/reload/lifecycle, lines 547-599, 778-810, 1145-1519 and 1926-2147; PTV-WEB@worktree, `src/ptv/modules/details/index.js`, generation functions, lines 51-83 and enhancement lifecycle lines 344-536; `src/ptv/modules/details/detailsAuthoritativeRelationships.ts`, lines 113-193.

- [ ] Define primary item authority separately from seasons/episodes/related/lyrics/relationship projections.
- [ ] Require current route generation, item ID and server/user identity before every late auxiliary commit.
- [ ] Do not let a sparse list/Plugin/Identify DTO erase children, relationships, `UserData`, media sources or selected playback streams.
- [ ] Authorize every relationship target with the current Jellyfin user before it reaches the response/UI.
- [ ] Reset and restore DOM moves/classes/listeners on item change, viewhide and destroy.
- [ ] Test Series→Season→Episode and A→B overlap with delayed primary and auxiliary responses.
- [ ] Test mutation/readback, retained-view return, missing child section, inaccessible relationship and image fallback.
- [ ] Verify play/resume/selected version/audio/subtitle still read the current item and that queue/Now Playing remain unchanged by metadata-only work.

## Search

Stock Search uses multiple user-scoped requests aggregated in React Query; some keys omit server/user identity. PTV Native Search adds scoped history, abort/request generations and bounded recovery. `VERIFIED_FROM_SOURCE` — W@35c0793, `src/apps/stable/features/search/api/useSearchItems.ts`, lines 26-98; `src/apps/stable/features/search/api/useLiveTvSearch.ts`, lines 12-149; PTV-WEB@worktree, `src/ptv/pages/search/NativeSearchPage.tsx`, request lifecycle, lines 850-926 and 936-1131; `src/ptv/pages/search/resilientSearchService.ts`, bounded fan-out, lines 477-562 and 614-737.

- [ ] Put normalized term, result scope, parent/library, server and user in the cache/history identity.
- [ ] Assign one generation to a user-visible search; abort and reject older term/route completions.
- [ ] Inventory primary and recovery requests; prevent recovery from repeating a successful primary path.
- [ ] Bound concurrency, page count, hydration and recovery duration without converting timeouts into higher limits.
- [ ] Distinguish empty, partial, timeout, cancellation and hard failure in visible state.
- [ ] Dedupe by stable Jellyfin identity, not title text.
- [ ] Test rapid typing, clear, retry, direct URL query, navigate away/back, hard refresh and route unmount.
- [ ] Test partial endpoint failure, restricted user, server/user switch, no-result and duplicate-result fixtures.
- [ ] Verify card actions and Details navigation receive the correct authoritative item/server identity.

## Music

Album, album-artist, artist and Audio child relationships are separate Server fields/entities. Music list controllers and PTV discovery/list loaders are independent of playback queue ownership. `VERIFIED_FROM_SOURCE` — S@1fbd873, `MediaBrowser.Controller/Entities/Audio/MusicAlbum.cs`, lines 27-67 and 136-163; `MediaBrowser.Model/Dto/BaseItemDto.cs`, lines 395-455; W@35c0793, `src/components/playback/playbackmanager.js`, queue paths, lines 3163-3240; PTV-WEB@worktree, `src/ptv/modules/music/musicApi.ts`, discovery/display/list paths, lines 966-1051, 1209-1258 and 1319-1415.

- [ ] Preserve distinctions among `AlbumArtist`, `AlbumArtists`, `Artists`, `ArtistItems`, album ID and child tracks.
- [ ] If deriving display artist from children, require bounded credible consensus; never infer from title text or rewrite Jellyfin metadata.
- [ ] Preserve the previous valid relationship when a sparse same-item readback omits it; do not preserve across a different item/generation.
- [ ] Keep exact track IDs/order/`UserData` and media sources separate from album metadata adoption.
- [ ] Coalesce library discovery and identical list requests; record a cold/warm transport and concurrency budget.
- [ ] Retire route work on abort/unmount/identity change. PTV's music coordinator exposes route-work cancellation and scoped discovery. `VERIFIED_FROM_SOURCE` — PTV-WEB@worktree, `musicApi.ts`, lines 241-425 and 526-605.
- [ ] Test album relationship present, sparse omission, unanimous children, disagreeing children, zero children and old/new Identify generations.
- [ ] Test albums/artists/tracks/playlists independently and one section failure without destroying others.
- [ ] Verify Play, Shuffle, Mix, Play Next, queue, Favorite and Now Playing before/during/after metadata adoption.

## Reading and reader lifecycle

Book authority remains Jellyfin, while reader engines own format-specific transient rendering/progress. Stock EPUB, PDF and comics use different progress units; PTV adds its own source resolver, reader document, zoom/settings and local progress. `VERIFIED_FROM_SOURCE` — S@1fbd873, `MediaBrowser.Controller/Entities/Book.cs`, lines 13-38 and 60-85; W@35c0793, `src/plugins/bookPlayer/plugin.js`, lines 63-109 and 327-395; `src/plugins/pdfPlayer/plugin.js`, lines 37-73 and 195-234; `src/plugins/comicsPlayer/plugin.js`, lines 40-73 and 276-310; PTV-WEB@worktree, `src/ptv/modules/reader/ReaderApp.tsx`, lines 37-173 and 251-306.

- [ ] Identify the engine and its exact position unit for EPUB, PDF and comic formats; never reuse a raw value across formats.
- [ ] Keep source resolution and authenticated download authority separate from locally persisted progress/settings.
- [ ] Abort document extraction/load on close or source change; reject late completion for the retired `openedAt`/source.
- [ ] Release document listeners, timers, rendition/document objects, archive object URLs and focus/scroll locks.
- [ ] Scope progress, bookmarks, zoom and settings by stable item/source identity and current user/server where the store can cross accounts.
- [ ] Preserve unsupported-format fallback; a Book media type alone does not prove an engine can open its extension.
- [ ] Test EPUB, PDF, CBZ and CBR where available: open, next/previous, zoom/fit, progress, close, reopen, Escape and load failure.
- [ ] Test close during load, source A→B, navigation/unmount, hard refresh and authenticated-download rejection.
- [ ] Confirm reader work does not replace or disturb video/audio player/queue state.

## Images and artwork cache

Effective image identity is owner item + type/index + tag + transform. A tagged Server response may be public-cacheable for one year, so a new authoritative tag/readback is the normal cache-busting boundary. `VERIFIED_FROM_SOURCE` — S@1fbd873, `Jellyfin.Api/Controllers/ImageController.cs`, lines 546-574, 1819-1916 and 1992-2048; W@35c0793, `src/components/cardbuilder/Card/useCardImageUrl.ts`, lines 156-290.

- [ ] Record image owner ID, requested type/index, tag, dimensions/quality and inherited parent/album/series fallback.
- [ ] Prefer tagged candidates from an authoritative DTO; do not manufacture tag freshness from a timestamp or object identity.
- [ ] Bound known-bad URL/candidate retries and expire/clear failure state when the authoritative item/tag changes.
- [ ] Do not globally suppress a URL failure across a different server/security scope.
- [ ] Keep untagged fallback explicit and finite; it must not loop behind a failed tagged request.
- [ ] On artwork mutation, read back image tags and target only the affected item/surface caches.
- [ ] Test own/inherited/album/series images, missing tag, wrong/stale tag, 404/403, decode error and fallback exhaustion.
- [ ] Test one artwork replacement across grid, Details, Home and Music/Reading without full-page reload.
- [ ] Measure requested/loaded/errored/duplicate URLs and ensure no remount/retry storm.

PTV's current candidate layer records bounded failed URLs/candidates and stable keys from owner/type/index/tag. `VERIFIED_FROM_SOURCE` — PTV-WEB@worktree, `src/ptv/api/images.ts`, lines 39-215, 283-365, 489-525 and 530-721.

## Identify and metadata

A remote result is not a `BaseItemDto`. Server Apply performs provider refresh/full replacement and returns `204` without an updated DTO, image tag, child list or structured partial-success result. `VERIFIED_FROM_SOURCE` — S@1fbd873, `MediaBrowser.Model/Providers/RemoteSearchResult.cs`, lines 10-53; `Jellyfin.Api/Controllers/ItemLookupController.cs`, `ApplySearchCriteria`, lines 244-280; `MediaBrowser.Providers/Manager/MetadataService.cs`, lines 89-222 and 720-871.

- [ ] Keep provider candidate, mutation acknowledgment, authoritative readback and UI adoption as four distinct objects/states.
- [ ] Preserve locked fields and unrelated relationship/child/`UserData`/media-source state when a bounded same-item readback is sparse.
- [ ] Never adopt provider-proposed values as server authority after Apply; use the authoritative readback, including server normalization.
- [ ] Define `FULL_SUCCESS`, `PARTIAL_SUCCESS` and `FAILURE` from metadata, artwork and readback phases.
- [ ] Give search/apply/readback a current item+route+operation generation; older work cannot close or overwrite a newer dialog/state.
- [ ] Ensure every branch settles spinner/button/modal/route blocker. Optional image/readback failure must not leave the primary lock indefinitely.
- [ ] Test metadata success, artwork success, artwork skip, artwork failure, mutation failure, readback failure and timeout/cancel.
- [ ] Test sparse/full readbacks, overlapping generations, navigation/unmount, retry and accurate notifications.
- [ ] Verify affected grid/Details image tags refresh and Music/Reading relationships plus playback queue/Now Playing remain intact.

## Playback, HLS, queue and reporting

Server PlaybackInfo/device profile determines the delivery path; `PlaySessionId` links media requests, progress/ping/stop and FFmpeg jobs. Client queue and Server session projection are separate state owners. `VERIFIED_FROM_SOURCE` — S@1fbd873, `Jellyfin.Api/Helpers/MediaInfoHelper.cs`, lines 87-396; `Jellyfin.Api/Controllers/DynamicHlsController.cs`, lines 1448-1567 and 1945-2036; `MediaBrowser.MediaEncoding/Transcoding/TranscodeManager.cs`, lines 118-245 and 371-715; `Emby.Server.Implementations/Session/SessionManager.cs`, lines 420-480, 746-935 and 1012-1113.

- [ ] Preserve negotiated media-source flags/URL; never derive direct-play support from codec/container labels alone.
- [ ] Keep one `PlaySessionId` through stream URL, fragments, progress/ping and final stop.
- [ ] Give each player source a generation; destroy old HLS/player listeners/session before the replacement can report or recover.
- [ ] Keep queue/Now Playing state independent from displayed metadata DTO replacement.
- [ ] Preserve audio/subtitle selections, start ticks and seek semantics through source recreation.
- [ ] Report final stop after success, error and user cancellation where possible; observe Server session and FFmpeg job convergence.
- [ ] Do not classify a successful report/segment HTTP status as proof that the renderer displayed uninterrupted frames.
- [ ] Test direct play, remux/direct stream and transcode; start, pause, seek backward/forward, stream change, end, error and stop.
- [ ] Test source A→B rapidly, HLS fragment stall/error recovery, background/foreground and remote-control socket/no-socket.
- [ ] Verify one active player/HLS instance/listener set and stable queue/Now Playing after unrelated Identify/Details changes.
- [ ] Keep continuous-session HTML video gain/mute on the retained media element through autoplay/manual Next; do not write an item-specific default over it. Keep full-teardown and non-video initialization semantics separate.
- [ ] Retire owned transient menus through the existing controls visibility lease. Abort root/child sheets and fence lazy imports, user lookup, selections and finalization after hide, error, takeover or teardown; do not add another hide timer.
- [ ] Defer the existing timers during active pointer/touch/held-key interaction, release on cancel/keyup/blur, and do not let lingering pointer focus keep Web controls visible indefinitely.
- [ ] Verify top Movie/Series logo-or-title plus existing Back ownership, episode-only bottom identity, hidden Back focus, failed/stale logo fallback and cleanup before DOM reconciliation.

PTV currently embeds an HLS session/source generation inside the stock HTML player; therefore edits on either side share one lifecycle boundary. `VERIFIED_FROM_SOURCE` — PTV-WEB@worktree, `src/plugins/htmlVideoPlayer/plugin.js`, imports/state/set source/disposal, lines 12-15, 323-340, 473-645 and 925-964; `src/ptv/modules/playback/hlsPlaybackSession.ts`, `createHlsPlaybackSession`, lines 277-824.

## Query, request and persistent caches

Stock has independent TanStack, legacy view/controller, image and playback caches. PTV adds request coalescing and persistent IndexedDB envelopes; neither is a universal authority. `VERIFIED_FROM_SOURCE` — W@35c0793, `src/utils/query/queryClient.ts`, lines 1-12; `src/hooks/useItem.ts`, lines 9-29; `src/hooks/useFetchItems.ts`, lines 35-72; PTV-WEB@worktree, `src/ptv/services/requestCoordinator.ts`, lines 379-720; `src/ptv/utils/libraryIndexCache.ts`, lines 10-37 and 150-305.

- [ ] For every key, list server, user/security scope, endpoint/method, parameters/fields, item/library identity, schema and feature configuration.
- [ ] Decide whether the cache stores raw shared candidates, a per-user response, or presentation state; never blur them.
- [ ] Define fresh, stale-while-revalidate, expired, corrupt, version mismatch, scope mismatch and missing behavior.
- [ ] Define mutation invalidators and logout/server/user/library/permission-change retirement.
- [ ] For coalescing, prove identical consumers share one request but different scopes/options do not.
- [ ] One aborted consumer must not cancel remaining consumers; all consumers retired may abort the transport.
- [ ] For a PTV route-scoped `requestPtvJson` read, supply the exact route lifetime signal; never downgrade to a no-signal legacy transport.
- [ ] Distinguish the physical transport owner from each consumer lease, and reject a late completion even when the adapter ignores abort.
- [ ] If cache generation intentionally outlives a route, bind it to the full server/user authority and separately guard every route adoption boundary.

### Legacy Home route-lifetime proof

- [ ] Acquire the Home lifetime from `routeController`; do not derive currentness from the DOM, route string, or a mutable owner reference alone.
- [ ] Capture the exact immutable lifetime in Hero/card/image/deferred callbacks so generation A cannot borrow generation B's currentness.
- [ ] Retire before pause/destroy cleanup; clear owned listeners, observers, timers, React roots, image probes, row refreshes, and callback references idempotently.
- [ ] Test delayed A → destroy/navigate → start B → resolve A last, same-route remount, repeated cycles, and out-of-order route churn.
- [ ] Never cache a failed/cancelled/unauthorized response as success or allow a stale write after invalidation.
- [ ] Test cold/warm hit, concurrent hit, failure, timeout, cancellation, invalidation during flight, expiry, schema mismatch and corrupt storage.
- [ ] Test logout/server/user switch and permission/library change with persistent storage pre-populated.
- [ ] Record before/after request count, peak concurrency and stale/late result count; do not increase timeouts as a substitute for ownership.

## Settings and administration

Stock configuration saves often replace whole documents without revision/ETag semantics; item refresh/task stop can be queued/cooperative beyond the response. PTV adds bounded save generations, semantic conflict checks and confirmed readback. `VERIFIED_FROM_SOURCE` — S@1fbd873, `Jellyfin.Api/Controllers/ConfigurationController.cs`, lines 23-162; `Emby.Server.Implementations/AppBase/BaseConfigurationManager.cs`, lines 94-197 and 270-362; `Emby.Server.Implementations/ScheduledTasks/ScheduledTaskWorker.cs`, lines 284-396; PTV-WEB@worktree, `src/ptv/modules/settings/admin/configuration/useAdminConfigurationSave.ts`, lines 39-164; `src/ptv/modules/settings/admin/metadata/adminMetadataService.ts`, lines 90-154.

- [ ] Enumerate persisted fields; exclude transient, default-normalized, secret and response-only values from comparison/write payload.
- [ ] Load an authoritative baseline and compare only meaningful managed state before a whole-document write.
- [ ] Preserve genuine conflict protection; semantically identical normalization/refetch must not warn.
- [ ] Single-flight saves and bound the entire primary mutation. Every success/failure/timeout/cancel/unmount reaches a terminal UI.
- [ ] Separate “write accepted/persisted” from optional readback/invalidation; accurately report write-success/readback-failure.
- [ ] Adopt confirmed server state as the new baseline, clear dirty state and disarm navigation blockers after success.
- [ ] Preserve dirty state and retry/cancel usability after failure.
- [ ] Never return/log/display raw tokens, passwords, SMTP/API secrets or private paths.
- [ ] Test 400, 401/403, 409, 500, timeout, network failure, cancellation, duplicate click, Page A→B→A and two-admin real conflict.
- [ ] For task/scan/plugin lifecycle operations, display accepted/running/stopping separately from completed and observe restart requirements.

## WebSockets and pushed state

Stock WebSockets are authenticated transports with listener-specific payload authorization. They have keepalive/reconnect but no durable replay cursor or cross-listener ordering guarantee. `VERIFIED_FROM_SOURCE` — S@1fbd873, `Emby.Server.Implementations/HttpServer/WebSocketConnection.cs`, lines 48-280; `Jellyfin.Api/WebSocketListeners/SessionInfoWebSocketListener.cs`, lines 29-143; `Emby.Server.Implementations/EntryPoints/LibraryChangedNotifier.cs`, lines 100-330; `Emby.Server.Implementations/EntryPoints/UserDataChangeNotifier.cs`, lines 48-155. Lack of replay/order is `INFERRED` from those structures.

- [ ] Authenticate with the current Jellyfin credential and resolve the connection's user/security scope for every payload.
- [ ] Filter Plugin extension payloads before serialization; never broadcast a server-wide item DTO list to restricted sockets.
- [ ] Treat messages as invalidation/current-snapshot hints; refetch authoritative HTTP state after connect/reconnect.
- [ ] Make listener/subscription registration idempotent and remove it on socket replacement/logout/unmount.
- [ ] Handle duplicate, coalesced, late, missing, malformed and out-of-order messages.
- [ ] Do not let a matching `UserDataChanged` overwrite newer full item metadata or vice versa; merge only the owned slice.
- [ ] Distinguish successful server dispatch from renderer execution acknowledgment.
- [ ] Test invalid token, restricted/admin users, forced disconnect/reconnect, multiple sockets, malformed/duplicate messages and permission change.
- [ ] Verify no request storm on reconnect and no stale session/task/library state if messages were missed.

## Build, service worker, assets and provenance

Stock webpack emits fixed entry/service-worker names and content-hashed lazy chunks; its service worker handles notifications/client claim, not application fetch caching. PTV adds explicit commit/version/build constants, chunk URL versioning and an update/reload lifecycle. `VERIFIED_FROM_SOURCE` — W@35c0793, `webpack.common.js`, lines 60-79 and 119-137; `src/serviceworker.js`, complete file lines 1-40; PTV-WEB@worktree, `webpack.common.js`, lines 1-11, 24-33, 52-73 and 119-158; `scripts/ptv-build-provenance.cjs`, lines 1-48; `src/ptv/services/chunkLoadRecovery.ts`, lines 23-118; `src/ptv/services/updateService.ts`, lines 110-145 and 228-249.

- [ ] Treat `ptv-version.json` as PTV Web release authority; keep upstream `package.json` compatibility version unchanged.
- [ ] Resolve provenance from the actual build HEAD/dirty state or an explicitly verified override; fail invalid values.
- [ ] Build from one source snapshot and create a complete asset manifest/hash set before deployment.
- [ ] Keep service worker standalone and verify registration/controller origin; do not assume it caches the app.
- [ ] Bound update/chunk recovery to one generation-aware reload and preserve a usable current app after update-check failure.
- [ ] Compare the worker's verified embedded webpack generation with the running bundle, not merely waiting/installed state. Equal/older/unknown identities do not notify; a genuine later identity does.
- [ ] Bind dismissal/reload attempts to the candidate and use one observation epoch across startup/controller registration reads, worker events and identity replies. A late result or error must not replace/erase newer availability.
- [ ] Recheck playback/reading/mutation/unsaved activity immediately before every reload, including activation completion/fallback. Keep the stable worker URL and standalone notification/claim behavior; do not infer an application fetch cache.
- [ ] Test production build, typecheck/lint/style checks, version check, build-info contract and emitted lazy chunks/routes.
- [ ] Compare two clean builds where reproducibility is required; record intentional nondeterministic metadata.
- [ ] Before deploy, verify exact previous rollback generation; atomically switch the full asset set; do not mix files.
- [ ] After deploy, verify LAN/public version, build ID/provenance, main/runtime/lazy chunks, authenticated session and hard refresh.
- [ ] Test an old open tab and a new tab; prove no reload loop and rollback if a required lazy chunk or session path regresses.

## Plugin API, capabilities, schemas and integrations

The Plugin owns `/Ptv/v1/...` responses; Jellyfin request auth/policies remain its security authority. The PTV Web client discovers a root, waits for authenticated client readiness, keys/coalesces reads, retries bounded candidate roots and clears GET response cache after mutations. `VERIFIED_FROM_SOURCE` — PTV-WEB@worktree, `src/ptv/core/pluginApi.ts`, lines 176-285, 555-855, 1220-1430 and 1608-1664.

- [ ] Declare endpoint owner, route, method, auth policy, request schema, response schema, status/error semantics and cancellation.
- [ ] Resolve authenticated user from Jellyfin context and apply per-user item/library policy before serialization.
- [ ] Keep secrets server-side; Web should receive configured/healthy/redacted status, never integration tokens.
- [ ] Make advertised capability, implemented route and Web feature gate one explicit contract.
- [ ] Version schema/cache contracts deliberately and define current/previous compatibility or fail closed with actionable state.
- [ ] Include server and user/security scope in response identity; mutation must invalidate affected read/status caches.
- [ ] A shared raw cache must remain immutable under per-user projection and must never be directly exposed.
- [ ] Test route/method/schema, missing/invalid/auth-failed/degraded/partial responses, admin/restricted/anonymous and concurrent users.
- [ ] Test Plugin absent, previous supported version, capability missing, endpoint missing and config change appearing without browser refresh.
- [ ] Test one healthy + one failed external provider; healthy data remains, failure is terminal/actionable, and no credential appears in URL/DOM/storage/log/diagnostic export.
- [ ] Run the static Web/Plugin API/cache/capability contract check and full relevant Plugin/Web contract suites.
- [ ] If the Plugin binary changes, follow its version/restart/rollback policy; do not restart Jellyfin for a Web-only change.

PTV Web's compatibility classifier compares Plugin API/cache versions and required capabilities, while its static checker verifies corresponding source contracts. `VERIFIED_FROM_SOURCE` — PTV-WEB@worktree, `src/ptv/core/buildInfo.ts`, lines 110-179; `scripts/ptv-plugin-contract-check.mjs`, lines 20-114.

## Current local closure checklist — READ-01 / DIAG-01–04

- [x] **READ-01:** Keep Jellyfin section/list/cache outcomes authoritative and derive mutually exclusive `loading`, `populated`, `partial`, `failed`, and `authoritative-empty` Reading presentation states. All-failed, mixed, genuine-empty, cached-refresh-failure, benign-drop, and stale-generation fixtures pass. `VERIFIED_BY_TEST`.
- [x] **DIAG-01 candidate:** Use routeController canonical navigation identity and generation for diagnostic sessions, and derive Request ownership from `isPtvRequestFeatureRoute(hash)` rather than `ptv-request-active`. Request matches before its presentation class mounts; deferred Request teardown cannot claim Manga; later class removal preserves the same Reading generation. `VERIFIED_BY_TEST` locally for the Web 0.5.57 release candidate.
- [x] **DIAG-02:** Require a matching captured route owner and route-owned terminal critical state. A visible undeclared shell and a pending route remain unsettled; current success/partial/empty/failed/cancelled may settle, while stale or retired owners cannot. `VERIFIED_BY_TEST`.
- [x] **DIAG-03:** Propagate one recommendation run generation through existing producer events. Failure remains sticky until proven current/newer-generation success; partial and stale/out-of-order completions cannot claim recovery. `VERIFIED_BY_TEST`.
- [x] **DIAG-04:** Classify concurrency from active physical transports before completion. Seven active transports degrade; coalesced consumers do not inflate the count; cancellation-only retirement recovers without a false failure. `VERIFIED_BY_TEST`.
- [x] Confirm this implementation adds **zero network requests**: it classifies existing Reading data, emits local route/recommendation observability, and derives concurrency from the existing request ledger. `VERIFIED_FROM_SOURCE`.
- [x] Deploy the exact validated generation. Web 0.5.56 was atomically deployed; LAN/public active app assets matched the validated generation and Jellyfin did not restart. `VERIFIED_BY_TEST`.
- [x] **READ-01 physical:** Books, Manga, and Comics failed-timeout cases rendered explicit failure and never authoritative empty. True-empty, populated, and cached-refresh-failure production variants remain `UNKNOWN`.
- [ ] **DIAG-01 physical:** production 0.5.56 remains `FAIL` and the operational gate remains `HOLD` — one direct Manga navigation created `route-69` generation 9 and `route-6h` generation 10 only 50 ms apart. The Web 0.5.57 URL-authoritative candidate is **NOT DEPLOYED** and its physical result is `VALIDATION_PENDING`.
- [x] **DIAG-02 physical:** observed failed Reading and successful Calendar routes reached terminal state before settling 586–694 ms later with zero active requests. The global pending-image counter does not close DIAG-05.
- [ ] **DIAG-03 physical:** `PARTIAL_PASS` — observed recommendation failure stayed degraded; complete-success recovery remains `UNKNOWN`.
- [ ] **DIAG-04 physical:** `UNKNOWN` — production peak physical concurrency was 5, below the required threshold of 7; no synthetic load was created.
- [ ] Close DIAG-05 image disposal accounting and IMG-01 Hero failure lifetime. Both remain `OPEN`; consequently STAB-02 and STAB-03 remain `OPEN`.
- [x] **DIAG-01 implementation gates:** focused route/Request/diagnostic matrix **6 files / 86 tests**, full PTV **364 files / 3056 tests**, full repository **438 files / 3589 tests**, TypeScript, targeted ESLint, Stylelint baseline, version tests, diff checks, and production build all pass. Build warnings are limited to the standard asset-size warnings.
- [x] **DIAG-01 release gate:** repository ESLint passes after annotating `loadMusicLibraryIndex` with its existing `Promise<null | void>` return contract. Both fire-and-forget `void` call sites remain; Music request, lifecycle, cache, queue, and playback behavior are unchanged. Focused Music and DIAG-01 tests plus all required local release gates pass. Web was bumped once to 0.5.57; no deployment occurred.

Focused local evidence: the Web 0.5.57 candidate passes its implementation and local release gates. Production evidence remains `C:/Users/Piggie/Documents/PTV_WEB_0.5.56_PRODUCTION_DEPLOYMENT_ACCEPTANCE_REPORT.md`, especially sections 8–13; it remains authoritative because 0.5.57 is not deployed and physical validation is pending.

## Persisted recommendations authorization — Plugin 0.5.18 derivative

- [ ] Invoke the actual v1 controller through its production dependencies, not a bypassable helper; serialize the returned object and assert the exact user-aware Jellyfin lookup overload receives the resolved user.
- [ ] Cover visible, partially/mostly hidden, empty, deleted, malformed, unavailable-library, parental-policy, admin/restricted, duplicate and unsupported synthetic/non-library candidates.
- [ ] Preserve existing schema and authorized survivor order; scores and response-local row ordinals must not retain hidden-position gaps.
- [ ] Check the entire response for hidden item IDs/titles and unproven row subject IDs/headings/explanations/reasons, including a watched subject absent from candidate Items.
- [ ] Reject anonymous/invalid/ambiguous/unresolved identities and preserve user/server-scope mismatch failures; keep v2 rank behavior unchanged.
- [ ] Exercise simultaneous users, repeated requests, permission loss/gain and shared-configuration mutation; authorization must run outside the configuration snapshot lock, and serialization must not revisit shared objects.
- [ ] Do not normalize, persist or overwrite global recommendations during per-user projection; no cached historical allow/deny result may authorize a later request.
- [ ] Retain private/no-store response policy, no sensitive removal reasons/logging, and unchanged Featured/startup/Web owners.
- [ ] Run focused/complete Plugin, complete repository, version/compatibility and two deterministic Release builds; report actual results separately from unexecuted CT103 checks.

These are requirements, not completion assertions. The isolated repair report records evidence and completion. No new deployment or harness qualification is authorized by this checklist.

## Final handoff gate

- [ ] Re-run the impact matrix for the actual diff, not the original plan.
- [ ] Confirm no unrelated source/config/dependency/lockfile/version change entered the task.
- [ ] Record every file changed and why its owner needed to change.
- [ ] Record focused tests, full relevant tests, static analysis, production build and version/provenance checks separately.
- [ ] Record before/after request counts, concurrency, errors and lifecycle evidence when the change affects data flow.
- [ ] Record physical validation against the actual authoritative Server/Plugin/device when required.
- [ ] Label unexecuted tests and unverified runtime behavior `UNKNOWN`.
- [ ] Preserve a rollback for release/deploy or Plugin/Jellyfin runtime changes.
- [ ] Assign `PASS` only when the requested invariant is proven at its actual trust/lifecycle boundary; use `PASS_WITH_GAPS` or `HOLD` when evidence is incomplete.
