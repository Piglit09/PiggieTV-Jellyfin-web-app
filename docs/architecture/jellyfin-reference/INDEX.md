# Jellyfin / PTV Architecture Atlas — Concept Index

This index is the fast entry point for Jellyfin Server/Web 10.11.11 and the current PTV comparison. It is navigation, not a substitute for the evidence ledgers in each chapter. Follow a link, then use the cited repository, file, symbol, line range, version, and evidence label before changing code.

## Start here

| Need | Read first | Then use |
|---|---|---|
| Understand the baseline and evidence rules | [00 — Reference README](00-README.md) | [01 — System overview](01-system-overview.md) |
| Trace a stock feature end to end | The relevant chapter in [Stock system chapters](#stock-system-chapters) | [24 — API contracts](24-stock-api-contract-reference.md), [25 — non-guarantees](25-known-jellyfin-non-guarantees.md) |
| Compare PTV with stock | [20 — PTV versus stock](20-ptv-vs-stock-map.md) | [21 — ownership conflicts](21-ownership-conflicts.md) |
| Plan a significant PTV change | [PTV Change Protocol](CHANGE-PROTOCOL.md) | [22 — Change-impact matrix](22-change-impact-matrix.md), [23 — Before-you-modify checklists](23-before-you-modify-checklists.md) |
| Assess a proposed change | [22 — Change-impact matrix](22-change-impact-matrix.md) | [23 — Before-you-modify checklists](23-before-you-modify-checklists.md) |
| Review active deviations and stabilization order | [system-map.json](system-map.json) → `activeKnownDeviations` / `stabilizationBacklog` | Follow each entry's evidence and closure criteria; do not infer closure from a local implementation alone |
| Query the atlas mechanically | [system-map.json](system-map.json) | Use node references, `chapterRefs`, and each entry's `evidence` array |
| Evaluate a newer Jellyfin implementation | [26 — Post-10.11.11 differences](26-upstream-post-10.11.11-differences.md) | Keep every such finding labeled `UPSTREAM_NEWER_THAN_10.11.11` |
| Review the Jellyfin 12.2 PTV Plugin candidate and staged rollout | [27 — Jellyfin 12.2 compatibility](27-jellyfin-12-2-compatibility.md) | Distinguish build/test evidence from live .125 and VM115 acceptance |

## Stock system chapters

| Chapter | Primary scope |
|---|---|
| [00 — Reference README](00-README.md) | Verified source identity, evidence vocabulary, interpretation rules, maintenance procedure |
| [01 — System overview](01-system-overview.md) | Boot/composition, HTTP authority, canonical data flow, authority boundaries, hotspots |
| [02 — Startup, session, authentication](02-startup-session-auth.md) | Browser boot, connection restoration, login, Quick Connect, logout |
| [03 — Routing, navigation, lifecycle](03-routing-navigation-lifecycle.md) | Hash/history, access gate, modern/legacy views, dialogs, teardown |
| [04 — Users, permissions, library access](04-user-permissions-library-access.md) | Tokens, policy, restricted users, admin checks, user-aware item access |
| [05 — Library and item relationships](05-library-item-relationships.md) | User Views, virtual folders, item hierarchy, DTO projection, scans |
| [06 — Home data flow](06-home-data-flow.md) | Section discovery, resume, Next Up, recent/favorites, refresh and cleanup |
| [07 — Cards and item state](07-cards-and-item-state.md) | Card renderers, images, actions, menus, `UserData`, invalidation |
| [08 — Details, seasons, episodes](08-details-seasons-episodes.md) | Details load, television hierarchy, related data, mutation reconciliation |
| [09 — Search](09-search.md) | Input lifecycle, scopes, fan-out, cancellation, result ownership |
| [10 — Music](10-music.md) | Albums/artists/audio relationships, discovery, queues, playback, Identify |
| [11 — Reading](11-reading.md) | Books/formats, reader open/progress/preferences, images and metadata |
| [12 — Images, artwork, cache](12-images-artwork-cache.md) | Image tags/types, fallback, URLs, transforms, browser cache, image editing |
| [13 — Metadata and Identify](13-metadata-identify.md) | Remote search, apply, provider data, field preservation, completion semantics |
| [14 — Playback, sessions, transcoding](14-playback-session-transcoding.md) | PlaybackInfo, media-source selection, direct/HLS/transcode, reports, queues |
| [15 — Settings and admin mutations](15-settings-admin-mutations.md) | Configuration documents, users, libraries, scans, tasks, plugins, Live TV |
| [16 — Caching and invalidation](16-caching-invalidation.md) | Query/legacy/image caches, events, identity retirement, mutation/readback |
| [17 — WebSocket events](17-websocket-events.md) | Connection/reconnect, messages, subscriptions, session commands and state |
| [18 — Build, service worker, assets](18-build-service-worker-assets.md) | Webpack, chunks, assets, provenance, service-worker generations |
| [19 — Failure, race, lifecycle](19-failure-race-lifecycle.md) | Async ownership, terminal states, cross-owner races, cleanup obligations |

## PTV and change-safety chapters

| Chapter | Primary scope |
|---|---|
| [PTV Change Protocol](CHANGE-PROTOCOL.md) | Mandatory pre-change impact record, stop conditions, actual-diff recheck, and Atlas update gate |
| [20 — PTV versus stock map](20-ptv-vs-stock-map.md) | Per-feature classification: unchanged, styled, wrapped, extended, replaced, bypassed, duplicate, new |
| [21 — Ownership conflicts](21-ownership-conflicts.md) | Duplicate owners, wrappers, DOM/React overlap, competing caches and lifecycle risks |
| [22 — Change-impact matrix](22-change-impact-matrix.md) | A changed subsystem mapped to downstream consumers, breakage modes, and tests |
| [23 — Before-you-modify checklists](23-before-you-modify-checklists.md) | Concrete pre-change and verification checklists by feature family |
| [24 — Stock API contract reference](24-stock-api-contract-reference.md) | Authentication envelope, endpoint families, payload/status/completion semantics |
| [25 — Known Jellyfin non-guarantees](25-known-jellyfin-non-guarantees.md) | Negative contract: behavior callers must not assume |
| [26 — Post-10.11.11 differences](26-upstream-post-10.11.11-differences.md) | Selected newer-upstream changes, isolated from the 10.11.11 baseline |
| [27 — Jellyfin 12.2 compatibility](27-jellyfin-12-2-compatibility.md) | Staged .125-to-VM115 Server upgrade, Plugin target, and evidence gates |

## Concept locator

| Concept | Primary chapters | Impact / pre-change |
|---|---|---|
| Admin authorization and policies | [04](04-user-permissions-library-access.md), [15](15-settings-admin-mutations.md), [24](24-stock-api-contract-reference.md) | [22](22-change-impact-matrix.md), [23](23-before-you-modify-checklists.md) |
| AlbumArtist, Artists, ArtistItems | [05](05-library-item-relationships.md), [10](10-music.md), [13](13-metadata-identify.md) | [22](22-change-impact-matrix.md), [23](23-before-you-modify-checklists.md) |
| API client creation / current client | [01](01-system-overview.md), [02](02-startup-session-auth.md), [24](24-stock-api-contract-reference.md) | [20](20-ptv-vs-stock-map.md), [21](21-ownership-conflicts.md) |
| API keys | [04](04-user-permissions-library-access.md), [24](24-stock-api-contract-reference.md) | [23](23-before-you-modify-checklists.md) |
| Application host / dependency injection / plugins | [01](01-system-overview.md), [15](15-settings-admin-mutations.md) | [20](20-ptv-vs-stock-map.md), [24](24-stock-api-contract-reference.md) |
| Artwork replacement / provider images | [12](12-images-artwork-cache.md), [13](13-metadata-identify.md), [24](24-stock-api-contract-reference.md) | [22](22-change-impact-matrix.md), [23](23-before-you-modify-checklists.md) |
| Embedded comic identity and Reading Apply review | [11](11-reading.md), [13](13-metadata-identify.md), [24](24-stock-api-contract-reference.md) | [20](20-ptv-vs-stock-map.md), [21](21-ownership-conflicts.md), [23](23-before-you-modify-checklists.md), [25](25-known-jellyfin-non-guarantees.md) |
| Authentication / login / token restoration | [02](02-startup-session-auth.md), [04](04-user-permissions-library-access.md), [24](24-stock-api-contract-reference.md) | [16](16-caching-invalidation.md), [23](23-before-you-modify-checklists.md) |
| Back navigation / dialogs / history | [03](03-routing-navigation-lifecycle.md), [19](19-failure-race-lifecycle.md) | [21](21-ownership-conflicts.md), [23](23-before-you-modify-checklists.md) |
| Books / EPUB / PDF / comic archives | [05](05-library-item-relationships.md), [11](11-reading.md) | [20](20-ptv-vs-stock-map.md), [23](23-before-you-modify-checklists.md) |
| Browser cache / service worker | [12](12-images-artwork-cache.md), [18](18-build-service-worker-assets.md) | [16](16-caching-invalidation.md), [22](22-change-impact-matrix.md) |
| Build provenance / chunks / asset identity | [18](18-build-service-worker-assets.md) | [20](20-ptv-vs-stock-map.md), [23](23-before-you-modify-checklists.md) |
| Cancellation / AbortSignal / stale result | [03](03-routing-navigation-lifecycle.md), [09](09-search.md), [19](19-failure-race-lifecycle.md) | [21](21-ownership-conflicts.md), [23](23-before-you-modify-checklists.md) |
| Cards / item menus / favorite / resume | [07](07-cards-and-item-state.md) | [12](12-images-artwork-cache.md), [20](20-ptv-vs-stock-map.md), [22](22-change-impact-matrix.md) |
| CollectionType / virtual folders | [04](04-user-permissions-library-access.md), [05](05-library-item-relationships.md) | [06](06-home-data-flow.md), [15](15-settings-admin-mutations.md) |
| Configuration document / settings baseline | [15](15-settings-admin-mutations.md), [24](24-stock-api-contract-reference.md) | [16](16-caching-invalidation.md), [21](21-ownership-conflicts.md), [23](23-before-you-modify-checklists.md) |
| Continue Watching / Resume | [06](06-home-data-flow.md), [07](07-cards-and-item-state.md) | [14](14-playback-session-transcoding.md), [22](22-change-impact-matrix.md) |
| Details / related content / media versions | [08](08-details-seasons-episodes.md), [14](14-playback-session-transcoding.md) | [20](20-ptv-vs-stock-map.md), [22](22-change-impact-matrix.md) |
| Direct Play / Direct Stream / transcoding / HLS | [14](14-playback-session-transcoding.md), [24](24-stock-api-contract-reference.md) | [19](19-failure-race-lifecycle.md), [23](23-before-you-modify-checklists.md) |
| DTO projection / sparse fields / authoritative readback | [05](05-library-item-relationships.md), [13](13-metadata-identify.md), [24](24-stock-api-contract-reference.md) | [19](19-failure-race-lifecycle.md), [22](22-change-impact-matrix.md), [25](25-known-jellyfin-non-guarantees.md) |
| Favorites / UserData | [05](05-library-item-relationships.md), [07](07-cards-and-item-state.md), [16](16-caching-invalidation.md) | [22](22-change-impact-matrix.md), [23](23-before-you-modify-checklists.md) |
| Featured / recommendations / generated rows | [06](06-home-data-flow.md), [20](20-ptv-vs-stock-map.md) | [04](04-user-permissions-library-access.md), [21](21-ownership-conflicts.md), [22](22-change-impact-matrix.md) |
| Controlled Home library scope, user proof, and held transitions | [20](20-ptv-vs-stock-map.md), [21](21-ownership-conflicts.md), [24](24-stock-api-contract-reference.md) | [22](22-change-impact-matrix.md), [23](23-before-you-modify-checklists.md), [25](25-known-jellyfin-non-guarantees.md) |
| Home sections / Next Up / Recently Added | [06](06-home-data-flow.md) | [04](04-user-permissions-library-access.md), [16](16-caching-invalidation.md), [23](23-before-you-modify-checklists.md) |
| Identify / RemoteSearchResult / apply | [13](13-metadata-identify.md), [24](24-stock-api-contract-reference.md) | [10](10-music.md), [11](11-reading.md), [12](12-images-artwork-cache.md), [22](22-change-impact-matrix.md) |
| ImageTags / parent images / fallback | [07](07-cards-and-item-state.md), [12](12-images-artwork-cache.md), [16](16-caching-invalidation.md) | [13](13-metadata-identify.md), [22](22-change-impact-matrix.md), [23](23-before-you-modify-checklists.md) |
| Item hierarchy / ParentId / AlbumId / AlbumIds | [05](05-library-item-relationships.md), [08](08-details-seasons-episodes.md), [10](10-music.md) | [13](13-metadata-identify.md), [22](22-change-impact-matrix.md) |
| Library scan / individual refresh / scheduled task | [05](05-library-item-relationships.md), [15](15-settings-admin-mutations.md), [24](24-stock-api-contract-reference.md) | [19](19-failure-race-lifecycle.md), [23](23-before-you-modify-checklists.md) |
| Live TV | [05](05-library-item-relationships.md), [14](14-playback-session-transcoding.md), [15](15-settings-admin-mutations.md) | [22](22-change-impact-matrix.md), [23](23-before-you-modify-checklists.md) |
| Metadata refresh / provider IDs / People / Studios | [08](08-details-seasons-episodes.md), [13](13-metadata-identify.md) | [12](12-images-artwork-cache.md), [22](22-change-impact-matrix.md), [25](25-known-jellyfin-non-guarantees.md) |
| Music discovery / album children | [05](05-library-item-relationships.md), [10](10-music.md) | [16](16-caching-invalidation.md), [20](20-ptv-vs-stock-map.md), [23](23-before-you-modify-checklists.md) |
| Now Playing / queue / autoplay / Next Episode | [10](10-music.md), [14](14-playback-session-transcoding.md), [17](17-websocket-events.md) | [19](19-failure-race-lifecycle.md), [22](22-change-impact-matrix.md), [23](23-before-you-modify-checklists.md) |
| Permission change / restricted user | [04](04-user-permissions-library-access.md), [05](05-library-item-relationships.md) | [16](16-caching-invalidation.md), [21](21-ownership-conflicts.md), [23](23-before-you-modify-checklists.md) |
| PlaybackInfo / media sources / stream selection | [14](14-playback-session-transcoding.md), [24](24-stock-api-contract-reference.md) | [17](17-websocket-events.md), [22](22-change-impact-matrix.md) |
| Plugin API / PTV `/Ptv/v1` | [20](20-ptv-vs-stock-map.md), [24](24-stock-api-contract-reference.md) | [21](21-ownership-conflicts.md), [22](22-change-impact-matrix.md) |
| Quick Connect | [02](02-startup-session-auth.md), [04](04-user-permissions-library-access.md), [24](24-stock-api-contract-reference.md) | [19](19-failure-race-lifecycle.md), [23](23-before-you-modify-checklists.md) |
| Reader progress / bookmarks / view preferences | [11](11-reading.md), [16](16-caching-invalidation.md) | [20](20-ptv-vs-stock-map.md), [23](23-before-you-modify-checklists.md) |
| React/TanStack versus legacy views | [01](01-system-overview.md), [03](03-routing-navigation-lifecycle.md), [16](16-caching-invalidation.md) | [19](19-failure-race-lifecycle.md), [21](21-ownership-conflicts.md) |
| Route registration / teardown / generation | [03](03-routing-navigation-lifecycle.md), [19](19-failure-race-lifecycle.md) | [20](20-ptv-vs-stock-map.md), [21](21-ownership-conflicts.md), [23](23-before-you-modify-checklists.md) |
| Search fan-out / grouping | [09](09-search.md) | [16](16-caching-invalidation.md), [22](22-change-impact-matrix.md) |
| Server restart / reconnect | [02](02-startup-session-auth.md), [17](17-websocket-events.md), [19](19-failure-race-lifecycle.md) | [23](23-before-you-modify-checklists.md) |
| Session reporting / progress / stop | [14](14-playback-session-transcoding.md), [17](17-websocket-events.md), [24](24-stock-api-contract-reference.md) | [19](19-failure-race-lifecycle.md), [23](23-before-you-modify-checklists.md) |
| User Views / library discovery | [04](04-user-permissions-library-access.md), [05](05-library-item-relationships.md), [06](06-home-data-flow.md) | [09](09-search.md), [10](10-music.md), [11](11-reading.md), [20](20-ptv-vs-stock-map.md) |
| WebSocket connection / commands / subscriptions | [02](02-startup-session-auth.md), [17](17-websocket-events.md) | [14](14-playback-session-transcoding.md), [19](19-failure-race-lifecycle.md) |

## Source-symbol locator

| Symbol / source area | Why locate it | Chapters |
|---|---|---|
| `Program.StartServer`, `ApplicationHost.Init`, `Startup.Configure` | Server boot, DI, middleware, API/security boundary | [01](01-system-overview.md), [04](04-user-permissions-library-access.md), [17](17-websocket-events.md) |
| `ServerConnections`, `ConnectionManager` | Current API client, saved server/token, sign-in/out lifecycle | [02](02-startup-session-auth.md), [20](20-ptv-vs-stock-map.md) |
| `RootAppRouter`, `ConnectionRequired`, `ViewManagerPage` | Route tree, UX authorization gate, legacy-view bridge | [03](03-routing-navigation-lifecycle.md), [19](19-failure-race-lifecycle.md), [20](20-ptv-vs-stock-map.md) |
| `UserManager`, `LibraryManager`, `DtoService` | User policy, item visibility, DTO projection | [04](04-user-permissions-library-access.md), [05](05-library-item-relationships.md), [24](24-stock-api-contract-reference.md) |
| `home.js`, `homesections.js`, Home hooks | Home sections and their refresh lifecycle | [06](06-home-data-flow.md), [20](20-ptv-vs-stock-map.md) |
| `cardBuilder`, React `Card` | Card rendering, interaction, image choice | [07](07-cards-and-item-state.md), [12](12-images-artwork-cache.md), [20](20-ptv-vs-stock-map.md) |
| `itemDetailPage`, episode/season hooks | Details and television relationship loading | [08](08-details-seasons-episodes.md) |
| `itemidentifier`, `ItemLookupController` | Identify search/apply and acknowledgment boundary | [13](13-metadata-identify.md), [24](24-stock-api-contract-reference.md), [25](25-known-jellyfin-non-guarantees.md) |
| `ImageController`, card image resolver | Image delivery, editing, tag/cache identity | [12](12-images-artwork-cache.md), [24](24-stock-api-contract-reference.md) |
| `PlaybackInfoController`, `MediaInfoController`, session reporting | Playback negotiation, delivery and session state | [14](14-playback-session-transcoding.md), [17](17-websocket-events.md), [24](24-stock-api-contract-reference.md) |
| `queryClient`, `viewManager` | Modern query cache and legacy view cache | [03](03-routing-navigation-lifecycle.md), [16](16-caching-invalidation.md), [19](19-failure-race-lifecycle.md) |
| PTV `routeController`, `requestCoordinator` | PTV route ownership/generation and request coalescing | [20](20-ptv-vs-stock-map.md), [21](21-ownership-conflicts.md) |
| PTV `featuredContentCache`, `NativeHome` | PTV featured/Home cache and native page | [20](20-ptv-vs-stock-map.md), [21](21-ownership-conflicts.md) |
| PTV `musicIdentifyAdoption`, `musicQueue` | Sparse DTO preservation and PTV Music queue/player ownership | [20](20-ptv-vs-stock-map.md), [21](21-ownership-conflicts.md), [22](22-change-impact-matrix.md) |
| PTV `ReaderApp`, `readerProgressStore` | Reader lifecycle and PTV-owned local progress | [20](20-ptv-vs-stock-map.md), [21](21-ownership-conflicts.md) |
| PTV `PtvApiRoutes`, Plugin service registrator | Plugin endpoint inventory and DI composition | [20](20-ptv-vs-stock-map.md), [24](24-stock-api-contract-reference.md) |

## Ownership locator

The concise labels below point to the evidence-backed ownership tables; they do not supersede them.

| State/resource | Start with | Conflict/impact follow-up |
|---|---|---|
| Authenticated principal, access token, server connection | [02](02-startup-session-auth.md), [04](04-user-permissions-library-access.md) | [16](16-caching-invalidation.md), [21](21-ownership-conflicts.md) |
| User policy and visible library/item set | [04](04-user-permissions-library-access.md), [05](05-library-item-relationships.md) | [20](20-ptv-vs-stock-map.md), [21](21-ownership-conflicts.md) |
| Route, dialog history and view lifecycle | [03](03-routing-navigation-lifecycle.md) | [19](19-failure-race-lifecycle.md), [21](21-ownership-conflicts.md) |
| Item metadata and relationships | [05](05-library-item-relationships.md), [13](13-metadata-identify.md) | [22](22-change-impact-matrix.md), [25](25-known-jellyfin-non-guarantees.md) |
| Home composition | [06](06-home-data-flow.md) | [20](20-ptv-vs-stock-map.md), [21](21-ownership-conflicts.md) |
| Artwork and failure state | [12](12-images-artwork-cache.md) | [16](16-caching-invalidation.md), [21](21-ownership-conflicts.md) |
| Playback media source and transcode | [14](14-playback-session-transcoding.md) | [17](17-websocket-events.md), [22](22-change-impact-matrix.md) |
| Queue and Now Playing view state | [10](10-music.md), [14](14-playback-session-transcoding.md) | [20](20-ptv-vs-stock-map.md), [21](21-ownership-conflicts.md) |
| Configuration documents and form baselines | [15](15-settings-admin-mutations.md) | [16](16-caching-invalidation.md), [21](21-ownership-conflicts.md) |
| Cache identity, invalidation and retirement | [16](16-caching-invalidation.md) | [19](19-failure-race-lifecycle.md), [21](21-ownership-conflicts.md) |
| Built asset generation and active service worker | [18](18-build-service-worker-assets.md) | [19](19-failure-race-lifecycle.md), [22](22-change-impact-matrix.md) |

## Modification quick paths

Before editing a subsystem, complete the [PTV Change Protocol](CHANGE-PROTOCOL.md). Its applicable reading in chapters 20–25 remains mandatory; the table below is a supplemental subsystem path and does not replace that gate.

| Planned change | Subsystem-specific supplemental path |
|---|---|
| Startup, auth or session | [02](02-startup-session-auth.md) → [04](04-user-permissions-library-access.md) → [20](20-ptv-vs-stock-map.md) → [22](22-change-impact-matrix.md) → [23](23-before-you-modify-checklists.md) |
| Route, header, sidebar, modal or teardown | [03](03-routing-navigation-lifecycle.md) → [19](19-failure-race-lifecycle.md) → [21](21-ownership-conflicts.md) → [22](22-change-impact-matrix.md) → [23](23-before-you-modify-checklists.md) |
| Library discovery or user visibility | [04](04-user-permissions-library-access.md) → [05](05-library-item-relationships.md) → [16](16-caching-invalidation.md) → [22](22-change-impact-matrix.md) → [23](23-before-you-modify-checklists.md) |
| Home or recommendations | [06](06-home-data-flow.md) → [07](07-cards-and-item-state.md) → [20](20-ptv-vs-stock-map.md) → [21](21-ownership-conflicts.md) → [23](23-before-you-modify-checklists.md) |
| Card, menu, image or artwork | [07](07-cards-and-item-state.md) → [12](12-images-artwork-cache.md) → [16](16-caching-invalidation.md) → [21](21-ownership-conflicts.md) → [23](23-before-you-modify-checklists.md) |
| Details, television relationships or media versions | [05](05-library-item-relationships.md) → [08](08-details-seasons-episodes.md) → [14](14-playback-session-transcoding.md) → [22](22-change-impact-matrix.md) → [23](23-before-you-modify-checklists.md) |
| Search | [09](09-search.md) → [16](16-caching-invalidation.md) → [19](19-failure-race-lifecycle.md) → [22](22-change-impact-matrix.md) → [23](23-before-you-modify-checklists.md) |
| Music album/artist/track state | [05](05-library-item-relationships.md) → [10](10-music.md) → [13](13-metadata-identify.md) → [20](20-ptv-vs-stock-map.md) → [22](22-change-impact-matrix.md) → [23](23-before-you-modify-checklists.md) |
| Reader or Reading metadata | [05](05-library-item-relationships.md) → [11](11-reading.md) → [13](13-metadata-identify.md) → [20](20-ptv-vs-stock-map.md) → [23](23-before-you-modify-checklists.md) |
| Identify / metadata apply | [13](13-metadata-identify.md) → [12](12-images-artwork-cache.md) → [16](16-caching-invalidation.md) → [19](19-failure-race-lifecycle.md) → [25](25-known-jellyfin-non-guarantees.md) |
| Playback, queue, session reporting or transcoding | [14](14-playback-session-transcoding.md) → [17](17-websocket-events.md) → [19](19-failure-race-lifecycle.md) → [20](20-ptv-vs-stock-map.md) → [23](23-before-you-modify-checklists.md) |
| Settings, library scan, task or Plugin administration | [15](15-settings-admin-mutations.md) → [16](16-caching-invalidation.md) → [24](24-stock-api-contract-reference.md) → [21](21-ownership-conflicts.md) → [23](23-before-you-modify-checklists.md) |
| Request cache, query key or invalidation | [16](16-caching-invalidation.md) → [17](17-websocket-events.md) → [19](19-failure-race-lifecycle.md) → [21](21-ownership-conflicts.md) → [22](22-change-impact-matrix.md) |
| Build, service worker, deployment asset or provenance | [18](18-build-service-worker-assets.md) → [19](19-failure-race-lifecycle.md) → [22](22-change-impact-matrix.md) → [23](23-before-you-modify-checklists.md) |
| PTV Plugin endpoint or response cache | [04](04-user-permissions-library-access.md) → [20](20-ptv-vs-stock-map.md) → [21](21-ownership-conflicts.md) → [24](24-stock-api-contract-reference.md) → [23](23-before-you-modify-checklists.md) |

## Evidence and uncertainty

- The baseline is Jellyfin Web/Server **10.11.11**. Treat chapter 26 as secondary future-compatibility evidence only.
- `VERIFIED_FROM_SOURCE`, `VERIFIED_BY_TEST`, `INFERRED`, and `UNKNOWN` have the exact meanings defined in [00 — Reference README](00-README.md).
- A link to a chapter means “inspect its exact citation,” not “assume every adjacent subsystem behaves the same.”
- If a source, optional provider, platform, codec, or runtime path is not proven, preserve `UNKNOWN` rather than promoting it to a contract.
