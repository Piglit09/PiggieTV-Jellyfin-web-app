# PiggieTV Phase R2 — Residual Legacy Transport Closure

Date: 2026-07-29

Scope: close the highest-impact residual legacy reads through the existing identity-aware coordinator; correct the Reading long-request attribution; stage cold Album artwork and optional Music work; and attempt navigation-only acceptance on available physical TV hardware. This report attributes only Phase R2 work and excludes unrelated pre-existing dirty-tree changes.

## 1. Residual transport inventory

The existing router, route generations, request coordinator, caches, shell, focus manager, playback engines, authentication/session owner, and diagnostics platform remain authoritative. “Retained” below means the path was inspected but deliberately not migrated in R2.

| Caller/path | Transport | Route owner and identity | Cancellation / guard | Timeout / retry | Work after retirement and stale risk | Result / difficulty |
| --- | --- | --- | --- | --- | --- | --- |
| Playlist edit permission | Legacy playlist helper → `Playlists/{id}/Users/{user}` | Details child generation; server + user + playlist | Route `AbortSignal`; current-generation check | 30 s coordinator bound; 404 is optional; no fallback | Final consumer abort stops transport; stale catch cannot mutate | **Migrated**, low |
| Playlist contents | `PlaylistViewer` → `Playlists/{id}/Items` | Details child generation; server + user + playlist | Route abort; A1/A2 guard | 30 s; existing refresh remains one owned request | No retired backend work after final consumer | **Migrated**, medium |
| Artist-style named shelves | `ItemsByName` → `Users/{user}/Items` | Details child generation; server + user + named item + query | Route abort and shelf-local generation guard | 30 s; one visible shelf Retry | Final-consumer cancellation; late success/failure rejected | **Migrated**, high |
| Album-artist named shelf | `ItemsByName` → `Artists/AlbumArtists` | Same owner; server + user + item + query | Same | Same | Same | **Migrated**, high |
| Primary item Details | Coordinated legacy item facade | Existing primary Details generation; server + user + item | Independent coordinator consumer; hide/destroy/retry abort | 20 s primary bound; one Retry | Final consumer aborts shared transport; stale commit rejected | Already authoritative |
| Named Genre/MusicGenre/Artist and SeriesTimer primary | Legacy `ApiClient` getters | Primary Details generation; server + user + encoded name/id | Primary signal; generation check | 20 s primary bound; one Retry | No continuation after final owner | **Migrated**, high |
| SeriesTimer schedule | Legacy Live TV timer getter | Details child generation; server + user + timer | Child signal; current-item guard | 30 s; no automatic retry | Cancelled on hide/reload; optional failure cannot clear primary | **Migrated**, high |
| More from Artist | Legacy unbounded `getItems` | Details child generation; server + user + artist/album | Child signal; current-item guard | 30 s; hard limit 24 | Cancelled; optional failure hides only its shelf | **Migrated**, high |
| More from Season | Legacy `getEpisodes` | Details child generation; server + user + series + season | Child signal; guarded result and delayed scroll | 30 s; hard limit 100 | Cancelled; late timer/result rejected | **Migrated**, medium |
| Similar items | Legacy `getSimilarItems` | Details child generation; server + user + item | Child signal and current-item guard | 30 s; limit 12 | Cancelled; failure is shelf-local | **Migrated**, medium |
| Legacy Audio Details lyrics | Legacy `ajax` | Details child generation; server + user + audio item | Child signal and guarded success/failure | 30 s; no fallback | Cancelled; an A1 failure cannot hide A2 lyrics | **Migrated**, medium |
| Reading library discovery, counts, preview, and paged index | PTV API facade → coordinator | Reading route generation; server + user + route kind + library/page | Parent/child signals; route and index-generation checks | Counts 10 s; pages 20 s; 50-item pages | Final owner cancels; retired pages cannot write cache/state | **Migrated**, high |
| Reading optional Home shelves | PTV API facade → coordinator | Reading route/shelf owner; server + user + route kind + shelf | Per-shelf child controller linked to route | Physical 7 s optional bound; one shelf Retry | A timed-out shelf aborts backend work without blanking siblings | **Migrated**, high |
| Recommendation favorites/history/recent/resume/broad sources | Five `Users/{user}/Items` or `Items/Latest` requests | Recommendation run; one captured server + user + source/query | Shared run signal reaches every coordinated request; abort is rethrown | 30 s; exactly one compatibility fallback only after a non-abort failure | Route retirement cancels all five; no post-abort fallback or stale reuse | **Migrated**, highest |
| Music Album/Playlist item and tracks | PTV API facade → coordinator | Music route generation; server + user + item | Independent primary/track signals and commit guards | 30 s; no automatic duplicate retry | Route exit aborts both; one failure does not erase the other result | **Migrated**, high |
| Music playlist probes and lyrics | PTV API facade → coordinator | Music route/panel owner; server + user + candidate/item | Probe concurrency four; abort stops queued starts; lyrics signal follows selected panel | 30 s; cancellation does not fallback | Final owner cancels; no error shown for cancellation | **Migrated**, high |
| Theme songs | Jellyfin SDK `getThemeMedia` plus established identity LRU/in-flight owner | Existing theme generation; server + user + item | SDK signal, active request abort, current-enhancement guard | No separate hard bound; no automatic retry | Active request is aborted; no stale chip commit | **Retained**, medium/high migration risk |
| Next Up | Legacy `getNextUpEpisodes` | Details item generation; server + user + series | Success guarded; no physical route signal | Legacy client default; no UI retry | Backend may continue after retirement; stale commit prevented | **Retained**, medium |
| Live TV channel guide / series schedule | Legacy `getLiveTvPrograms` | Details item generation; server + user + channel/series | Success guarded; no physical route signal | Legacy client default; no UI retry | Backend may continue; stale commit prevented | **Retained**, medium |
| Music videos / additional parts / special features | Legacy item APIs | Details item generation; server + user + item | Success guarded; no physical route signal | Legacy client default; no UI retry | Backend may continue; stale commit prevented | **Retained**, low/medium |
| Current-user promise | Existing authentication/session owner | Primary Details request; server + current session | Primary generation rejects late combined commit; underlying call is not independently abortable | 20 s outer Details bound | User read may finish after retirement but cannot commit | **Retained**, authentication frozen |
| MusicBrainz / Discogs modules | Direct third-party `fetch` | Explicit metadata/admin code; third-party query identity | Not imported by the active Music route; Discogs race timeout does not abort fetch | Discogs 6.5 s race; MusicBrainz provider policy only | Dormant code can continue if later invoked | **Retained**, separate third-party semantics |
| Playback, mutations, downloads, setup/login | Existing platform/Jellyfin owners | User action or frozen media/session owner | Existing behavior | Existing behavior | Outside read-only R2 transport scope | **Excluded by design** |

## 2. Prioritized migration list

1. **P0 — recommendation source bundle:** corrected the 53–55 s attribution and propagated one captured identity/signal across all five sources.
2. **P0 — PlaylistViewer and ItemsByName:** removed duplicated permission/fan-out work and closed the proven same-item A1 → hide → A2 stale paths.
3. **P0 — Reading request tree:** physically bounded optional shelves, paged the index, and made direct routes independent of broad Home work.
4. **P1 — Music Album/Playlist/Lyrics:** split primary metadata from tracks, stopped queued work after abort, and tied lyrics to the selected panel.
5. **P1 — SeriesTimer and named Details primary reads:** moved them to the existing coordinator with full identity.
6. **P1 — More-from-Artist/Season, Similar, and legacy Lyrics:** added limits, route cancellation, and guarded optional failure behavior.
7. **P2 — retained optional Details reads and theme media:** generation-safe today; migration is deferred because response/playback semantics or established cache ownership need a dedicated proof.

## 3. Root causes

1. The R1 discovery harness labeled a response with the route active at completion, not the route active when the request began. Two Movies/Shows recommendation requests were therefore falsely labeled Reading.
2. Several legacy Details helpers called `ApiClient` directly. They had partial success guards but no final-consumer transport cancellation, and some failure/timer callbacks were not uniformly generation-guarded.
3. Playlist editability was requested by more than one consumer, while `ItemsByName` launched multiple weakly owned shelves without one shared route signal.
4. The recommendation provider launched five broad, 48-item sources with a 29-field profile. A retired recommendations consumer could previously leave this backend work alive and trigger compatibility fallback after cancellation.
5. Album catalogs assigned real artwork to too many cards at once. The page had stable list ownership, but initial request/decode pressure was not tied to viewport proximity.
6. Optional Music CPU and network work was interleaved with primary route work. Lyrics, recommendation-row construction, related content, and below-fold images needed explicit interaction/idle/viewport staging.

## 4. Files changed

Only R2-attributable files are listed.

- Legacy Details: `src/controllers/itemDetails/index.js`; `src/scripts/{playlistViewer,itemsByName}.js`; `src/components/{itemHelper,itemContextMenu}.js`; `src/ptv/modules/details/detailsEnhancementLifecycle.test.ts`; and new `src/scripts/{playlistViewer,itemsByName}.test.ts`.
- Reading and attribution: `src/ptv/modules/books/{booksApi,booksPage}.ts[x]`; new `readingLifecycleOwnership.test.ts` and `readingRequestOwnership.test.ts`; `src/ptv/modules/recommendations/providers/jellyfinRecommendationProvider.ts` and its new test.
- Music: `src/ptv/modules/music/{musicApi,musicPage}.ts[x]`; new `musicArtwork.tsx`, `musicProgressiveDetail.ts`, `musicRoutePolicy.ts`, and their tests; new `musicApiRequests.test.ts` and `musicLifecycleOwnership.test.ts`; `musicPlayerResourcePolicy.ts` and its test.
- Measurement: new `scripts/ptv-authenticated-album.cjs` and the `test:e2e:authenticated:album` script in `package.json`.
- Reporting: this document.

No unrelated dirty-tree change is attributed to R2.

## 5. Coordinator migrations

- Every migrated authenticated read supplies complete server identity and captures user identity before work starts. Incomplete identity is never shared across users or servers.
- `requestPtvJson`, `getPtvItems`, and the existing season/item facades remain the only transport boundary; R2 introduced no parallel transport abstraction or request cache.
- Independent consumers retain independent abort ownership. One consumer can leave shared work alive for another; the final consumer aborts the transport and immediately retires its key.
- Cancellation remains cancellation. It is rethrown, never rendered as a shelf error, and never followed by a fallback request.
- The coordinator’s 30-second GET bound and Jellyfin authorization, `lastFetch`, and request-failure bookkeeping remain intact.
- Details primary work keeps its 20-second visible failure/Retry boundary. Optional Reading shelves use a stricter physical seven-second child abort.
- Every state/cache write rechecks route generation, identity, or current-item ownership at commit time.

## 6. Unabortable paths retained and why

| Retained path | Why retained | Protection that remains | Honest limitation |
| --- | --- | --- | --- |
| Current user | Authentication/session ownership is frozen; changing it would widen scope materially | Primary Details generation and 20 s outer bound | Underlying user lookup can finish after retirement |
| Next Up | Legacy response normalization and media-source behavior need dedicated equivalence proof | Current-item guard; optional section | Backend work may continue |
| Live TV guide/schedule | Live TV semantics and generated client behavior were not fully proven for a generic replacement | Current-item guard; bounded result limits where already present | Backend work may continue |
| Music videos, additional parts, specials | Low-frequency optional reads; no evidence they caused R1 pressure | Current-item guard; cannot clear ready primary content | Backend work may continue |
| Theme media | Existing SDK signal, identity LRU, in-flight owner, and playback-adjacent behavior are already authoritative | Physical abort and generation guard | Not deduplicated by the general coordinator and lacks a separate hard timeout |
| Dormant MusicBrainz/Discogs | Third-party rate limits, credentials, and caches are not Jellyfin coordinator semantics; active route does not import them | Discogs queue/cache/6.5 s race; no active first-render caller | A future caller must add physical abort before activation |

These paths are not claimed as fully cancelled. Playback calls, mutation APIs, downloads, login/setup, and media negotiation were intentionally excluded.

## 7. Reading long-request correction

The two long R1 responses were:

- `GET /Users/{user}/Items`: 53,014.5 ms, recorded on `reading-comics`;
- `GET /Users/{user}/Items/Latest`: 54,647.2 ms, recorded on `reading-manga`.

The recorded route was the response-time route. Timing reconstruction places both starts around the Movies/Shows recommendation interval, before Reading. A second pressure artifact repeated the pattern: 34,490.3–40,565.8 ms recommendation responses completed later on Reading/Search routes.

Source attribution identifies the caller as the Browse/Recommendations provider. It launches favorites, history, recently added, resumable, and broad-candidate sources; each is capped at 48 items, uses six candidate item types and a 29-field profile, and can contribute at most 240 pre-deduplication items. The archived harness removed query strings and did not record response cardinality or server logs, so actual returned cardinality and server-only execution time are not recoverable; the browser durations above are the honest available latency evidence.

R2 captures server/user identity once, passes the route signal to every source URL and coordinated request, rethrows abort, and prohibits fallback after abort. Reading itself now uses 50-item pages, 20-second page bounds, a 10-second count bound, seven-second optional shelves, and route-linked controllers. Direct Books/Comics/Manga routes render their shell and scoped progressive index without waiting for broad Home data. A retired or broad result cannot replace scoped catalog state.

## 8. Cold Album baseline

The closest retained R1 comparison is `discovery-report-r1-final-clean.json`, route `music-albums`, 1920×1080:

| Metric | R1 observation |
| --- | ---: |
| Observation window | 3,052.1 ms |
| Completed responses | 72 total: 70 image, 2 fetch |
| DOM images | 50 |
| Exact duplicate image requests / duplicate paths / multi-variant paths | 0 / 0 / 0 |
| Slow responses ≥1 s | 25 |
| Slow-response p95 / maximum | 3,286.0 / 8,957.1 ms |
| Long tasks | 0 |
| Heap used / delta | 184,619,485 / +1,690,196 bytes |
| Broken visible images / fallback failures / functional errors | 0 / 0 / 0 |
| Horizontal overflow | none |

This is a high-request, cold-ish comparison point, not an isolated cold-cache baseline. The old harness counted responses by completion route and did not clear browser/application caches. It did not record response bytes, decode tasks, frame timing, DOM delta, visible-card count, or below-fold-card count. Other R1 cache states produced 28 and 0 image responses for the same 50 DOM images. The suggested 35% target translates to at most 45 initial image requests.

## 9. Cold Album after measurements

Three authenticated harness-v3 samples used a dedicated Chrome profile at
1920×1080 with browser cache, CacheStorage, and the PTV image manager memory
cleared before each run. The normal login UI was used, the reported render
profile was `PTV_DESKTOP`, and no playback was invoked. This is isolated
browser-profile evidence, not physical-device evidence.

| Metric | Sample 1 | Sample 2 | Sample 3 | Median |
| --- | ---: | ---: | ---: | ---: |
| Album cards (visible / below fold) | 32 (15 / 17) | 32 (15 / 17) | 32 (15 / 17) | 32 (15 / 17) |
| Image requests | 24 | 19 | 19 | **19** |
| Reduction from the 70-response R1 comparison | 65.7% | 72.9% | 72.9% | **72.9%** |
| Maximum concurrent image requests | 17 | 16 | 16 | 16 |
| Exact duplicate image keys / maximum multiplicity | 0 / 1 | 0 / 1 | 0 / 1 | 0 / 1 |
| Known image-response bytes | 831,891 | 896,338 | 862,504 | 862,504 |
| Responses with unknown byte length | 2 | 0 | 0 | 0 |
| Image decode observations | 69 | 63 | 54 | 63 |
| First meaningful content | 6,253.8 ms | 118.0 ms | 107.2 ms | 118.0 ms |
| Route settled | 41,859.5 ms | 14,136.7 ms | 16,449.9 ms | 16,449.9 ms |
| Frame p95 / longest frame | 6.1 / 121.2 ms | 6.2 / 42.4 ms | 6.1 / 38.4 ms | 6.1 / 42.4 ms |
| Long tasks | 0 | 0 | 0 | 0 |
| Heap delta | +6,009,008 B | −4,002,992 B | −1,370,720 B | −1,370,720 B |
| DOM node delta | +602 | +602 | +602 | +602 |
| Broken visible images / page errors | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

All three samples beat the suggested 35% request target, prioritized all 15
visible cards, and produced zero duplicate image keys, broken visible images,
page errors, or long tasks. Each sample recorded 15 primary-image requests and
one backdrop request; later card elements retained stable placeholders until
admitted by the viewport policy. The old R1 harness did not record decode
observations or bytes, so the after values are disclosed but no unsupported
decode- or byte-reduction percentage is claimed.

Sample 1 is a material cold-tail outlier and is retained rather than averaged
away: first meaningful content took 6.25 seconds and full settling took 41.86
seconds. Sample 2 also recorded three uncategorized console errors even though
it had no page error, request-failure category, broken image, or long task.
Those residual observations remain technical debt.

Evidence is preserved as
`test-results/authenticated-album/album-cold-r2-after-{1,2,3}.json` with a
matching PNG for each run. The sanitized artifacts contain no backend address,
session identity, credential, or playback state.

The implementation budget is 34 initial image requests on Desktop (32 catalog cards plus two shell images) and 26 on low-power/WebOS (24 plus two), representing 51.4% and 62.9% reductions from the 70-response R1 comparison. The first 16 Desktop or 12 low-power cards receive real artwork immediately; later cards retain a stable data-URI placeholder until an `IntersectionObserver` root margin admits them. This uses the existing image URL/failure/cache pipeline and does not create a second cache.

## 10. Music optional-work deferral

| Work | Classification after R2 | Behavior |
| --- | --- | --- |
| Route shell/header and first catalog page | Required for first render | Plural and singular Music routes are Home-independent; 32 Desktop or 24 low-power cards render first |
| Album/Playlist primary metadata | Required for first render | Loads and commits independently of tracks |
| Album/Playlist tracks | Progressive required content | Independent request/error state; cannot blank primary metadata |
| Lyrics | Required after interaction | Requested only for the selected lyrics panel/item; selection change or route exit aborts it |
| Recommendation rows | Idle/background | Row construction runs after initial commit in a cancellable zero-delay task |
| Related artists/tracks | Idle/background | Deferred task; late completion is retired |
| Below-fold artwork | Viewport/background | Stable placeholders, async decode, route/card observer cleanup |
| Metadata lookup / MusicBrainz / Discogs | Admin interaction only | Not imported into first-render work |
| Low-power page/player backdrops | Unnecessary first-render work | Suppressed by the existing profile policy; Desktop quality remains enabled |
| Queue/mini-player | Existing interactive owner | Ownership and full-screen behavior unchanged |

## 11. Details residual closure

- Playlist permission and content now share the Details child controller and one permission promise.
- Every `ItemsByName` shelf uses the coordinated path, has shelf-local partial failure, and exposes one guarded Retry.
- SeriesTimer primary/schedule and named Genre/MusicGenre/Artist reads now preserve identity and cancellation.
- More-from-Artist is capped at 24; More-from-Season at 100; Similar at 12. Lyrics, Similar, season, and artist requests all use the current detail signal.
- Optional abort/failure cannot clear ready primary metadata or remove an A2 result.
- A1 → hide → A2 → late A1 success and late A1 failure are covered for PlaylistViewer and ItemsByName. The final focused set passed 27/27 tests across those three files.

## 12. Failure/retry results

| Scenario | Result |
| --- | --- |
| Abort during route exit | PASS — transport signal aborts; cancellation is not rendered |
| Timeout | PASS — Details primary 20 s; Reading pages 20 s/count 10 s/optional shelf physical 7 s |
| 404 | PASS — missing playlist permission remains optional and launches no fallback |
| 500 | PASS — recommendation compatibility launches exactly one fallback only for a live non-abort request |
| Malformed optional metadata | PASS — contained to its shelf |
| Partial shelf failure | PASS — ready siblings and primary route remain visible |
| Retry after failure | PASS — one new owned request; repeated activation cannot create a storm |
| Concurrent consumers | PASS — exact request is shared without merging ownership |
| One consumer aborts | PASS — other consumer continues |
| All consumers abort | PASS — final owner aborts transport and retires the key |
| Identity switch | PASS — no cross-server/user cache or source reuse |
| Logout/session retirement | PASS at contract/unit level — authentication routes discard shell auth state and coordinator keys remain identity-scoped; no live logout mutation was needed |
| Same-item late success/failure | PASS — A1 callbacks cannot affect A2 |

## 13. Physical LG navigation result

**INCOMPLETE — HOLD.** The physical LG target was reachable. The existing Jellyfin wrapper launched, but bounded `ares` inspection returned no endpoint. A no-install hosted validation wrapper was inspectable, but exposed only the wrapper/blank document; the exact current R2 application and authenticated state were never proven.

No navigation key, Select action, playback action, install, deployment, reboot, or server change was performed. The launched test surfaces were no longer visible afterward, and the inspector/hosted helpers were stopped. Browser-profile WebOS passes are reported separately in section 16 and are not substituted for physical evidence.

## 14. Android TV result

**NOT AVAILABLE / NOT TESTED.** No separate physical Android TV device was connected. Automated Android TV user-agent coverage passed, but it is not claimed as physical-device evidence.

## 15. Fire TV result

**INCOMPLETE — HOLD.** On the connected physical Fire TV, the installed debug client restored a valid saved session and the backend was TCP-reachable from the workstation.

Safe path completed without playback:

`Home → Movies → Movie Details → Back → Shows → Series Details → Back`

Movies was still loading at 6 seconds and settled by 14 seconds; Shows was still loading at 12 seconds and settled by 22 seconds. Movie and series cards exposed explicit non-playback Details actions. Details auto-focused Play, so Center was never pressed there; only DPAD and Back were used.

The run stopped at Season because the Series page exposed zero accessible season targets and Down remained on one unlabeled, non-clickable region. Music, Artists, Album, Search, and Settings were therefore not attempted. A 53-line target-process log sample contained zero fatal exceptions, ANRs, crashes, or OOM signals. The app was left safely on Shows.

This is physical Fire TV evidence from its installed native debug client, not proof that the current web bundle ran on that device.

## 16. Automated validation totals

| Gate | Final result |
| --- | --- |
| Focused Details closure | PASS — 27/27 |
| Authenticated cold Album harness | PASS target — 3/3 sanitized samples; 19-request median, 0 duplicate keys, 0 long tasks, 0 broken visible images; cold-tail and console caveats retained in section 9 |
| Complete Vitest | PASS — 167/167 files; 1,156/1,156 tests; 0 failed/skipped |
| Diagnostics regression | PASS — 14/14 files; 70/70 tests |
| TypeScript | PASS — zero errors |
| Scoped PiggieTV ESLint debt gate | PASS — current 258 errors/26 warnings/33 files vs baseline 307/31/40; no per-file increase |
| Stylelint | PASS — 0 errors, 0 warnings |
| Production bundle | PASS — 0 errors; 2 size-budget warnings; 17 oversized assets; `main.jellyfin` 4.88 MiB |
| ES compatibility | PASS — no matching errors |
| Standard Playwright | PASS — 55 passed, 6 expected skips, 0 failed |
| Chrome/Edge/Firefox | PASS — 164 passed, 19 expected skips, 0 failed; Chrome 55/6, Edge 55/6, Firefox 54/7 |
| TV-profile Playwright | PASS — per engine: generic TV 2, Android TV 3, Fire TV 1, WebOS 5; 33 matrix passes plus 11 default-Chromium passes |
| PTV Core schemas | PASS — 11 v1 schemas and compatibility fixtures |
| Android contract parity | PASS — 26 models, 14 enums, 19 capabilities, 1 error-code set |
| Plugin contract | PASS — API v1/cache v7 and required routes compatible |
| Plugin .NET tests | PASS — 33 passed, 0 failed/skipped |
| Secret scan | PASS — 118,372 repository paths; generated dependency/build trees excluded |
| `git diff --check` | PASS — no whitespace errors; line-ending notices only |

Authenticated R1 route/interaction/soak results remain prior evidence; R2 did not replay video, run playback checks, or repeat the 30-minute soak. The dedicated R2 Album harness is reported only in section 9.

## 17. Remaining technical debt

- Physical LG exact-build/authenticated navigation is missing.
- Fire TV navigation is blocked by inaccessible Season targets; the remaining Music/Search/Settings sequence is missing.
- No separate physical Android TV was available.
- The R1 Album comparison is not a true isolated pre-change cold run; any after comparison must retain that caveat.
- Authenticated Album sample 1 retained a 6.25-second first-content / 41.86-second settle cold tail, and sample 2 recorded three uncategorized console errors.
- Next Up, Live TV guide/schedule, Music videos, additional parts, special features, and current-user reads remain legacy transports that may continue backend work after retirement.
- Theme media remains outside the general coordinator, though it is identity-scoped, abortable, bounded in memory, and generation-guarded.
- Actual result cardinality and server-only duration for the 53–55 s recommendation requests were not recorded in R1.
- The production bundle retains 17 oversized assets, and accepted lint debt remains 258 errors/26 warnings.
- A current-build authenticated full route matrix, interaction suite, and long navigation soak were not repeated in R2.

## 18. APPROVE/HOLD/BLOCK

**HOLD**

The source closure is successful: highest-impact legacy reads use the existing coordinator; cancellation, identity, and stale-commit tests pass; Reading is progressive and bounded; Music work is staged; all automated reliability gates are green; no second owner or cross-identity sharing was introduced.

R2 cannot be approved because physical navigation-only acceptance is incomplete on LG and Fire TV, no separate Android TV was available, and the full requested hardware sequence did not complete. This is not BLOCK: no stale overwrite, cross-user/server sharing, parallel router/cache/transport owner, playback/focus ownership change, or unauthorized production change was found.

## 19. Exactly one next phase

**Phase R2A — Exact-build Physical Navigation Acceptance Closure.** Establish one inspectable authenticated current-build surface on LG, restore accessible Season navigation on Fire TV, and complete the prescribed no-playback route sequence on every available physical TV while retaining the existing owners.

## 20. Confirmation playback, WebOS reboot attribution, production, and frozen ownership remained untouched

- No video or Music playback was started. Playback engines, queue, mini-player, codec/media paths, and playback state ownership were not changed.
- WebOS reboot attribution remained paused. No reboot experiment, renderer attribution run, or media-path investigation occurred.
- Production was not deployed or modified. Only local builds, isolated test servers, disposable browser profiles, and no-install inspection surfaces were used and cleaned up.
- The existing router, route generation, request coordinator, cache owners, PTV shell, TV focus manager, authentication/session owner, diagnostics platform, and PTV Core contracts remain authoritative. R2 added no second router, request cache, playback store, focus owner, global fallback listener, or parallel transport abstraction.
