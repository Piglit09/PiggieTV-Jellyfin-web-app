# PiggieTV Phase R1 — Web App Reliability & Performance Stabilization

Date: 2026-07-29

Scope: route, data, rendering, failure recovery, image, performance, and lifecycle stabilization. No production deployment was made. Playback, media/codec selection, TV focus ownership, diagnostics ownership, authentication behavior, and PTV Core contracts remained frozen. Navigation selection and semantics also remained frozen; the existing route controller gained only narrowly scoped generation capture/comparison used to reject stale async work. The only authentication-adjacent source change lets the existing current-user GET accept an `AbortSignal`; login, token, session, and authorization behavior were not changed.

## 1. Reliability audit

The existing router, request coordinator, and runtime remain authoritative; Phase R1 did not introduce a second router, runtime, or cache owner.

| Area | Authoritative owner after R1 | Retirement/commit rule |
| --- | --- | --- |
| Shell route | Existing route-controller key and generation | A route key/generation change retires older work; one native shell remains visible |
| Home | Route generation, display identity, and owned controller | Unmount, identity change, timeout, or superseding refresh aborts work; only current generation/identity may commit |
| Movies/Shows/Collections | Browse load key/generation plus per-route controller | Route exit, retry, or superseding load retires requests; shelf commits are monotonic |
| Music/Reading | Route-work generation plus route-local catalog ownership | Direct catalog entry starts independently of Home; unmount/supersession rejects late results |
| Search | Search epoch and owned request controller | New query or route exit aborts the old request and rejects stale results |
| Movie/Series/Season/Episode details | Page/load generation plus primary and child owners | Hide, destroy, retry, or same-item reload invalidates every prior callback |
| Artist/Album details | Music route generation plus identity-scoped work | Retired work may finish only where the legacy transport is unabortable, but cannot commit |
| Images/backdrops | Server-scoped candidate key plus per-consumer ownership | A consumer can retire without cancelling another; transport ends when the final consumer retires |
| Timers/listeners/observers | Creating route/component | Cleanup removes the exact handler, timer, frame, request, observer, or subscription |

The final authenticated matrix passed 23/23 routes. Every native snapshot contained exactly one visible shell. Four responsive profiles—3840×2160, 1280×720, 390×844, and 844×390—had no horizontal overflow, visible broken image, or runtime overlay.

## 2. Five highest-impact root causes

1. **Deduplicated transport did not have independent consumer ownership.** A timed-out or unmounted caller could leave a shared request alive, while cancelling one consumer could also threaten another. Authenticated keys did not always include complete server/user identity.
2. **Freshness was route- or item-name based instead of load-instance based.** Same-item A1→hide→A2 details loads, delayed shelf callbacks, timers, and optional metadata could outlive and mutate a newer generation.
3. **Home and Browse state was not monotonic.** Late empty, failed, omitted, or partial results could replace populated rows, hero state, or already-ready shelves.
4. **Image failure and preload state was too global.** A failure on one server could suppress another server’s candidate; one cancelled consumer could cancel a deduplicated image needed elsewhere; tagged failures did not consistently attempt an untagged fallback.
5. **Heavy catalog routes were coupled to broad Home work and oversized payloads.** Music and Reading direct-entry routes could remain behind an empty Home snapshot, while Music requested and retained metadata that cards did not render and launched avoidable artwork/probe bursts.

## 3. Files changed

Only R1-attributable work is listed here; unrelated pre-existing dirty-tree changes, including playback, focus/navigation, WebOS attribution, and separate Music player/queue work, were preserved and are not attributed to this phase.

- Request ownership/API: `src/ptv/core/abortController.ts`; `src/ptv/services/{requestCoordinator,displayIdentity,coordinatedLegacyItemDetail,movieSearchCatalog}.ts`; `src/ptv/api/{auth,client,items,libraries,search,seriesSeasons,seasonEpisodes,itemFieldProfiles,types}.ts`; colocated tests.
- Route/Home/Browse/Search: `src/ptv/shell/routeController.ts`, `src/ptv/core/app.js`, `src/ptv/pages/home/{NativeHome,hooks,homeModelAuthority}.ts[x]`, `src/ptv/pages/browse/{NativeBrowsePage,browseData,browseReliability,browseShelfState,browseLoadingPolicy}.ts[x]`, `src/ptv/pages/search/NativeSearchPage.tsx`, relevant styles and tests.
- Reading and Settings direct readiness: `src/ptv/modules/books/{booksApi,booksClassification,booksPage,readingRoutePolicy}.ts[x]`, focused classification/policy/lifecycle tests, and `src/apps/stable/routes/user/settings/index.tsx`.
- Details: `src/controllers/itemDetails/index.js`, `src/controllers/itemDetails/{detailGenerationOwner,detailChildLoadOwner,detailLoadRecovery}.ts`, `src/ptv/modules/details/{index.js,detailImageRepairState.ts,details-shell.scss}`, `src/scripts/itemsByName.js`, and focused lifecycle/recovery tests.
- Images/backdrops: `src/ptv/api/images.ts`, `src/ptv/core/imageManager.ts`, `src/ptv/shell/PTVShellBackdrop.tsx`, Browse/Home/Search image-profile call sites, and focused tests.
- Music: `src/ptv/modules/music/{musicApi,musicLoadState,musicPage,musicPaging,musicPlaylistModal,musicRoutePolicy,musicRouteWork,musicIdentityCache}.ts[x]` and focused API, policy, cache, and lifecycle tests.
- Cleanup: `src/ptv/modules/theme-songs/index.js`, `themeSongsLifecycle.test.ts`, and the route/detail/image files above.
- Validation/reporting: `.escheckrc`, `playwright.cross-browser.config.ts`, the `test:e2e:cross-browser` package script, `scripts/ptv-authenticated-{cdp,discovery,interactions,soak}.cjs`, and this report.

The CDP helper’s local-network/web-security override applies only to a disposable test profile targeting the configured LAN server. It is not bundled into the application.

## 4. Request coordination improvements

- The existing coordinator now owns one shared transport and independent consumers. A consumer abort detaches only that caller; the transport aborts when its final abortable owner retires.
- Abandoned in-flight keys are removed immediately so a hung request cannot poison the next identical call.
- Authenticated deduplication keys include server and user identity. Incomplete identity deliberately receives a unique key instead of risking cross-account sharing.
- `requestPtvJson` propagates `AbortSignal`, preserves Jellyfin request headers, `lastFetch`, and `requestfail` bookkeeping, and enforces a 30-second bound for the new abortable GET path.
- Home, Browse, Search, primary/child Details, Music, and Reading route work propagate signals and reject stale commits. Cancellation is rethrown as cancellation rather than converted into an error shelf or fallback.
- Browse directory/tag requests use the same coordinated transport and re-check generation after settled batches. Music playlist probes run with bounded concurrency of four.
- Card/list field profiles are lean. Music cards omit media sources/streams, paths, overview, provider IDs, and tags unless a detail path actually needs them.

The archived coordinated-request artifact reduced exact concurrent duplicates from 17/21 in two baselines to 0, and peak concurrency from 11/12 to 8. The final authenticated route matrix also recorded zero duplicate exact image request keys.

## 5. Route lifecycle improvements

- The existing route controller exposes capture/compare generation ownership, and the redundant forced startup check was removed.
- Every Home/Browse/Music/Reading async continuation checks active generation, identity, and disposal before commit.
- Details uses a stamped load instance, so a delayed response from the same item’s earlier visit cannot become current again. Hide/destroy also retires spinner, image, reader-action, timer, and optional-section ownership.
- Music Artists/Albums/Songs/Playlists/Library and Reading Books/Comics/Manga render their route header immediately, then use route-local loading and cached data. They no longer wait for an empty Home snapshot.
- A slower Reading Home result merges with a faster scoped catalog index instead of replacing it.
- Settings renders when the user is known; optional Quick Connect discovery appears progressively instead of blanking the page.
- The pressure-closed authenticated matrix passed 23/23 routes with 21 expected `ERR_ABORTED` route-retirement requests, three expected missing-artwork 404s, and zero functional request, response, console, or page errors.

## 6. Shelf stability improvements

Browse shelves now model `loading`, `empty`, `failed`, and `ready` explicitly. A non-empty ready shelf cannot be erased by a late loading, empty, timeout, failure, or retired result. Retry targets only the failed shelf and retains ready siblings, hero selection, tags, and focus/scroll memory.

Home uses the same monotonic rule: a populated incoming row replaces its prior version, an empty update preserves a populated prior row, and a populated omitted row survives a partial refresh. A missing final hero no longer clears the last valid hero. Image completion updates artwork without rebuilding the shelf model.

Focused tests cover partial failures, retry ownership, missing retry tasks, stale generations, identity switches, omitted rows, and same-key late arrivals. The live direct-entry Reading checks also passed after the scoped library index was decoupled from Home.

## 7. Details-page improvements

- Movie, Series, Season, and Episode details keep a stable loading surface, reach a visible terminal error after the bounded primary timeout, and expose one Retry action.
- Primary and child requests have separate generation owners. Secondary Series/Season/Episode failures cannot erase ready primary metadata.
- Same-item reload, cross-server identity change, hide, destroy, and retry reject older callbacks. Owner-scoped spinner state cannot be cleared by a retired load.
- Poster and backdrop repair remain independent and item-local. Overview expansion is idempotent, and theme-song discovery is coalesced and identity-scoped.
- Artist `ItemsByName` commits are generation-guarded; direct Artist and Album routes render progressively and do not depend on a previous Music visit.
- Final authenticated interaction result: PASS. All 5/5 scenarios passed, including Home → Details → Back, deep-link refresh, generic Movie/Series/Episode search navigation, exact clicked-Episode hash and visible active owner stamping, Series seasons, Season episodes, and compatible 404/network rejection. Details content became ready in 1,895.9 ms in the same harness.

Remaining optional legacy detail transports are listed in section 12; they are stale-commit safe but not all physically abortable.

## 8. Image pipeline improvements

- Failed-candidate keys include server origin, preventing one server’s missing artwork from suppressing another server’s image.
- A failed tagged image now attempts its untagged candidate before the fallback is considered exhausted.
- The image manager reference-counts consumers of a deduplicated task. Cancelling the first consumer does not terminate another consumer’s image; the final retirement cancels physical work.
- Preload no longer duplicates the same candidate through both a `<link>` and `Image` object.
- Browse/Search backdrop and logo widths use the active performance profile; conservative TV/WebOS sizing does not reduce Desktop’s profile.
- Shell backdrop frames, timers, previous-image handlers, and transition cleanup are deterministically owned and cancelled.

The pressure-closed matrix observed 320 image requests, zero duplicate exact keys, two paths with candidate variants, three expected missing-artwork 404s, zero failed artwork fallbacks, and zero broken visible images.

## 9. Music performance improvements

- Initial card payloads are lean and exclude large detail-only fields.
- Track/video requests propagate cancellation; abort never falls through into an alternate request path or failed section.
- Playlist probing uses concurrency four, delayed video work and playlist refresh are route-owned, and modal discovery aborts on close/unmount.
- Artists, Albums, Songs, Playlists, and Library bypass the empty Home gate, show headers immediately, display cached entries immediately, and retain route-local loading only while their own index is empty.
- Hidden duplicate backdrop rendering was removed. Image/detail caches are identity-scoped and bounded, and failed-image state is transient.
- The final three-second Music snapshot had two long tasks, 70 ms and 87 ms; Music and every catalog subroute passed without a functional error. Cold Album artwork remains a known decode/request burst from earlier runs and is tracked as debt.

Mini-player, queue, playback, codec, and media-capability behavior was not changed by R1.

## 10. Lifecycle cleanup

Home cancels request controllers, timers, and animation frames. Browse, Music, and Reading retire route work on unmount or supersession. Details retires page/load generations and owns all enhancement timers, image handlers, spinners, and reader actions. Backdrop cleanup removes detached image callbacks and transition timers. Theme-song discovery owns its observer, mutation-coalescing timer, in-flight request, generation, and bounded TTL/LRU entries.

The authenticated discovery run recorded one native shell on every native route and no duplicate runtime surface. The 30.6-minute navigation-only soak completed 55 cycles and 440 route checks with zero route-owner timeouts, one runtime, one shell, a stable five-entry listener registry, and zero duplicate-listener/runtime suppressions. It opened 106/110 sampled Details targets with zero Back fallbacks; the four missed target acquisitions did not produce an ownership timeout.

Application listener counts rose once by three document and two window handlers when legacy Details dependencies initialized, then remained stable through an isolated ten-open Details audit. Live intervals moved from one to three and timeouts from four to three; both fluctuated within bounded ranges rather than growing monotonically. All 484 failed transports were expected `ERR_ABORTED` retirements, all 99 console errors were expected missing-artwork 404s, and there were no page or functional errors.

## 11. Performance measurements before vs after

These measurements are kept in their correct evidence class. Older physical LG/WebOS figures are context only; authenticated Chrome and controlled request artifacts are not substituted for physical-TV proof.

| Measure | Before | After R1 | Interpretation |
| --- | ---: | ---: | --- |
| Authenticated route matrix | 8/23 nominal passes in archived July 21 run | 23/23 passes | Harness/classification and server state changed; strong functional evidence, not a strict timing comparison |
| Exact concurrent duplicate requests | 17 and 21 | 0 | Proven by the coordinated-request artifact |
| Peak request concurrency | 11 and 12 | 8 | Same controlled artifact |
| Request TTFH p50 | 3,059.8 / 1,194.1 ms | 1,389.7 ms | Better than baseline A, slightly slower than baseline B |
| Request TTFH p95 | 16,268.5 / 5,341.8 ms | 4,463.6 ms | Improved in the controlled artifact |
| Request TTFH maximum | 37,015.7 / 7,034 ms | 6,977.8 ms | Improved, but backend latency remains material |
| Home ready, same authenticated interaction harness | 123.3 ms | 334.2 ms | Slower in this server sample; still immediate and stable |
| Details content ready, same harness | 3,697.7 ms | 1,895.9 ms | 48.7% faster |
| Search ready, same harness | 58.5 ms | 67.0 ms | Essentially flat |
| First Movie search result, same harness | 3,221.6 ms | 2,375.6 ms | 26.3% faster |
| 30-minute route-owner readiness | Not previously measured | 96.0 ms median / 271.5 ms p95 / 330.6 ms max; 0 timeouts | Current authenticated Desktop/CDP |
| Route-retirement transport churn, prior/current soak | 912 aborts plus one `ERR_NO_BUFFER_SPACE` | 484 expected aborts; no buffer-space error | 46.9% fewer aborts despite 106 versus 25 Details opens |
| Frame-gap p95 / maximum | Prior physical Home: 716.6 ms p95/max | 6.0 ms p95 / 1,006.1 ms max; 1,213 gaps >50 ms across 161,967 frames | Different device/profile; context only |
| Long-session heap/DOM | Prior physical Music: ~18.6→26.7 MB and 2,848→7,302 nodes during delayed recovery | Cold sequence: +29.7 MB / +3,199 nodes; warmed Home cycles 10→55: +2.9 MB / −12 nodes | Warm samples were non-monotonic; current soak supports boundedness, not a formal leak proof |

The pressure-closed sequential 23-route discovery snapshot produced five long tasks (maximum 287 ms, three on the administrator dashboard) and a +8,170,782-byte heap delta. That sequence is not leak proof because routes, caches, responsive profiles, and dashboard state differ between its first and last samples; the warmed same-route soak trend is the stronger long-session signal.

## 12. Remaining technical debt

- Some optional legacy Details transports—including PlaylistViewer/SeriesTimer paths and parts of Artist lookup—cannot be physically aborted. Their generations prevent stale commits, but the backend work can continue after retirement.
- A legacy Reading/Home request in discovery completed after roughly 53–55 seconds. Progressive route rendering prevents a blank page, but that transport still needs conversion to the bounded abortable path.
- A cold Music Album snapshot previously produced 70 image requests; the pressure-closed sequential matrix reused cache state, so cold-route decode/request cost still needs an isolated budget. Deeper artwork chunking, recommendation/lyrics deferral, and playlist-detail ownership remain worthwhile.
- Four of 110 Details target acquisitions were unavailable at the soak sampling boundary. Every route-owner check passed and the exact interaction suite was green, so this is non-blocking harness/availability debt rather than evidence of stale Details ownership.
- The abortable GET adapter preserves authorization/request-failure bookkeeping but does not reproduce every Jellyfin client address-reconnection/failover behavior.
- The production bundle passed, but webpack still reports 17 oversized assets and oversized `main.jellyfin`/service-worker entrypoints.
- ESLint’s accepted baseline remains 260 errors and 30 warnings across 34 files; Phase R1 introduced no per-file increase.
- Automated WebOS, Android TV, and Fire TV profiles are green, but current-build physical-device navigation/performance was not measured.

## 13. Validation results

| Validation | Result |
| --- | --- |
| TypeScript | PASS — `build:check`, zero findings |
| Vitest | PASS — 161/161 files, 1,107/1,107 tests, no retry or flake |
| Production bundle | PASS — webpack, 0 errors; 2 bundle-size warnings |
| ES compatibility | PASS — 999 generated JavaScript targets checked, zero ES5 matching errors |
| Standard Playwright | PASS — 55 passed, 6 expected live-dev skips, 0 failed |
| Chrome/Edge/Firefox matrix | PASS — 164 passed, 19 expected skips, 0 failed |
| Authenticated discovery | PASS — 23/23 routes; one shell; 0 functional errors, broken images, or exact image duplicates |
| Authenticated interaction suite | PASS — 5/5 scenarios; exact Movie/Series/Episode navigation and visible active owner checks; one 404 request/diagnostic and one network-failure request with no retry |
| 30-minute navigation-only soak | PASS — 30.6 minutes, 55 cycles, 440 route checks, 0 owner timeouts, 106 Details opens, 0 Back fallbacks, bounded warm heap/DOM/listener/timer state |
| PiggieTV ESLint debt gate | PASS — no per-file increase; accepted baseline 260 errors/30 warnings |
| Stylelint | PASS — zero findings |
| PTV Core contracts | PASS — 11 v1 schemas/fixtures |
| Plugin contract | PASS — API 1/cache 7 compatible with the tested plugin/web versions |
| Diagnostics regression | PASS — covered by the green Vitest and Playwright suites; diagnostics ownership was not expanded |
| Script syntax/targeted lint | PASS — all four authenticated CDP/discovery/interaction/soak scripts parse and have zero targeted ESLint findings |
| Secret scan | PASS — 118,362 repository paths checked; generated dependency/build trees excluded |
| Whitespace | PASS — no `git diff --check` errors; line-ending warnings only |

Expected browser skips are six live-development-runtime cases in each browser plus one Firefox-only Android horizontal navigation-swipe case. Automated user-agent/profile coverage for WebOS, Android TV, and Fire TV remained green.

Primary evidence files are `test-results/authenticated-discovery/discovery-report-r1-pressure-closed.json`, `test-results/authenticated-soak/soak-report-r1-pressure-closed.json`, and `test-results/phase2d-authenticated/core-phase2d-authenticated-browser.json`.

## 14. APPROVE / HOLD / BLOCK

**APPROVE**

All Phase R1 reliability gates are green: unit/type/style/build/compatibility contracts, standard and cross-browser Playwright, the 23-route authenticated matrix, the 5/5 interaction suite, and the 30.6-minute navigation soak. Remaining items are bounded technical debt and do not block R1 acceptance.

This approval is limited to the reliability source/test scope; it is not a production-deployment or physical-device playback approval. WebOS reboot attribution and media-path testing remained paused, and no playback, codec experiment, device mutation, or destructive TV run occurred. The preserved media-path conclusion remains outside R1.

## 15. Exactly one next phase

**Phase R2 — Residual Legacy Transport Closure.** Convert the remaining unabortable Details, Reading, and Music legacy calls to the existing identity-aware coordinator; further stage Album artwork and optional lyrics/recommendation work; then run navigation-only physical LG, Android TV, and Fire TV performance acceptance without resuming playback or WebOS reboot attribution.
