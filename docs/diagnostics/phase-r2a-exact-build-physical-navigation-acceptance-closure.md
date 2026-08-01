# PiggieTV Phase R2A — Exact-Build Physical Navigation Acceptance Closure

Status: **HOLD**

This report freezes the evidence available for R2A without reopening the R2 reliability implementation. A counted physical-device route requires input from the device's literal physical remote. No such route evidence was counted. Passive inspection and operator-authorized injected setup/diagnostic control are reported separately and do not satisfy the physical-remote matrix.

Fire TV diagnostics completed at the first Season boundary. They provide a reproducible focus-graph classification but remain non-counted because the input method was injected.

## 1. Frozen build identity

One production-mode static build was created and then sealed for every device. No device-specific rebuild is permitted.

| Field | Frozen value |
| --- | --- |
| Build ID | `r2a-20260730T103702491Z-44899b1f-dirty` |
| Full Git commit | `44899b1fb556f4983ae2c1fa4e861d1ad0b4f4d8` |
| Embedded commit marker | `44899b1fb5-dirty` |
| Package | `jellyfin-web` |
| Package version | `10.11.11` |
| Build timestamp | `2026-07-30T10:37:02.491Z` |
| Build mode | `production` |
| Build-input files | 2,395 |
| Build-input SHA-256 | `d62d568899c65880c4ac8c8d5e105adc61f0feccd42a4e802df4d5c762eba28b` |
| Frozen web files | 2,527 |
| Frozen web bytes | 63,392,485 |
| Frozen web-tree SHA-256 | `481581e12dbd25976692f5f12f19a7fa55ddf91dffb7e887e906229d73020b03` |

The build-input fingerprint was identical before and after compilation. The worktree was dirty at freeze time:

| Dirty state | Count |
| --- | ---: |
| Modified | 104 |
| Deleted | 6,145 |
| Untracked | 58 |
| Added | 0 |
| Renamed | 0 |
| Copied | 0 |
| Conflicted | 0 |
| Total status entries | 6,307 |

Primary artifact hashes:

| Asset | SHA-256 |
| --- | --- |
| `index.html` | `fe6506fe83d0b2e80dd136d241eaf0e0caea4626f3edd61f6a91578aa92531ca` |
| `runtime.bundle.js` | `c7f68850253f1b39a7afc839c42662fe4889bdc122ae484770d1535ae169be59` |
| `main.jellyfin.bundle.js` | `cff7a63b137052e01bc41cecf2d3183517979e727e8df5dfba75863f8101bef7` |
| Main CSS | `1e16ee5016f70c8c0f17bfb44aae69662005b1a6db493ec3383e1b68699f3e10` |
| `serviceworker.js` | `8d108192a34000a536441c861b7cab5ed8d3e51c91e273d5eb719e5a8b299349` |

Matrix route-entry hashes:

| Route family asset | SHA-256 |
| --- | --- |
| Shared route JavaScript | `93a8c6a9f1ebe28a4f438662ca47cdd93df752879d8a0f8e86e926e824c81b19` |
| Shared route CSS | `19482d1971eb47d7a593787fe1b627e13e1baeb0d6962d2aea08121693533912` |
| Home entry CSS | `1b6bd0c2db9f379a4cead7db6861f567dde8a89d821952b57a77302fbcc33fdd` |
| Movies entry JavaScript | `7affaaae45f749a47627c094cf332ffb6b6525027736e8e948679af6d2d0f97b` |
| Shows entry JavaScript | `fb4cdfe48b2ca4dfd22553ee3721df52af2090d4c0845bf16ccbee8a359a3d52` |
| Details controller JavaScript | `a4fc9b600f6a3a15d929f72d7b69156124e37163b4ebad4cc6a78d5eec9b59e9` |
| Details CSS | `a268549368a16b8c9a0e4326803193964e918226e8266624db16eb0b46eab7b9` |
| Details document chunk | `0bdf2fb0f383ae33998c6266faa1bb15b427413efd2c9cb27c89173990f768b5` |
| Music entry JavaScript | `9a89449d361c1761dc358ae2bf23d7c39dfd427ca02266d5e1a33bc824fe3ea6` |
| Search entry JavaScript | `0c05b13854d6c7d32289e84af66e4143677c077da6d5bc57c7a4528ecdaa91a2` |
| Search CSS | `7f892722771842b6dbb005f2173a0927a9338db1e8ebacd1046370359f58fc06` |
| Settings entry JavaScript | `4dcf314c6ebbe9d106f4fdcb02e69b34c0d0748820d307d04e2121d05bf38ee7` |

The 142 CSS files have a set SHA-256 of `83ca7892472ef08379b6cb9c4f8c28b54213df6402fbd2494f433289f260557c`; every individual CSS hash is present in the sealed checksum inventory.

PTV Core contract version is `1.0`, schema version is `1`, frontend/plugin API compatibility is version `1`, and featured-cache compatibility is version `7`. The compiled profile contracts include WebOS, Fire TV, Android TV, generic TV, TV render, WebOS optimized render, and low-power render markers. Development-server, hot-runtime, refresh-runtime, and development-overlay markers are absent.

## 2. Authentication and credential handling

The dedicated account must be authenticated through the normal Jellyfin-owned flow before any device route can count. Credentials were not written to source, scripts, reports, screenshots, traces, storage-state artifacts, or share-safe evidence. The repository secret scan passed.

The LG passive snapshot reported no authenticated session. Its setup-only injected navigation did not expose a visible login or server-selection surface. Consequently, LG authentication is incomplete and no LG route can count.

Fire TV authenticated successfully through the normal Jellyfin-owned login flow in 3.016 seconds. The active-session check and authenticated Home content both passed before diagnostics began. No account substitution occurred. Credentials were held only for the interactive setup operation and were not retained.

Android TV was unavailable.

After validation, the Fire TV wrapper's authenticated data was cleared and the wrapper was uninstalled. The LG validation wrapper was also removed and verified neither installed nor running. Native applications and production state were untouched.

## 3. Content preflight

No device completed a counted physical-remote run. Fire TV nevertheless passed a separate privacy-safe authenticated content preflight:

| Prerequisite | Fire TV preflight |
| --- | --- |
| Movie | Available; 3,388 items |
| Series | Available; 1,048 items |
| Season/Episode chain | Available; selected safe chain had 4 Seasons and 29 Episodes |
| Artist | Available; 668 items |
| Album | Available; 49 items |
| Search | Route control available |
| Settings | Route control available |

The Series chain fingerprint was `bcb03ed6e40d86d2`; the Artist/Album chain fingerprint was `74f042f82936f814`. A separate first-visible-candidate check used during the Fire TV blocker reproduction also found 7 Seasons and an Episode. Only anonymous fingerprints and aggregate counts were retained.

- LG: not available because the session was unauthenticated and the post-relaunch document stopped at bootstrap splash.
- Fire TV: **READY — AUTHENTICATED PREFLIGHT PASSED**, but not counted physical-remote evidence.
- Android TV: **NOT TESTED — DEVICE UNAVAILABLE**.

Automated fixtures do not substitute for account-visible physical-device content. No titles or media identifiers are retained.

## 4. LG build provenance

The removable validation application matched its expected package identity and loaded from the expected validation-origin category. The passive provenance snapshot established:

- expected build ID, production mode, package version, and timestamp;
- correct `webos` client and platform classification;
- `PTV_WEBOS_OPTIMIZED`, WebOS render, and TV geometry classes;
- one application creation, one runtime creation, one runtime host, and one visible shell;
- five listener registrations with zero duplicate-listener or duplicate-feature suppressions;
- zero development resources and zero error overlays;
- zero playback, audio, or video activity;
- Reading and Request controls absent as intended.

Asset observation found 87 frozen assets, of which 86 matched. The runtime bundle, main bundle, shared route bundle, and service-worker script matched. The observed `index.html` did not match the frozen hash, some initial CSS assets were not observed, and the page had no service-worker controller. The exact-initial-asset-set and service-worker-control gates therefore failed. A matching build ID and matching local frozen directory do not override those failures.

After a setup-only cache clear and relaunch, the document reached a narrower **Jellyfin RootApp/bootstrap splash boundary**:

- document ready state was complete and the viewport was valid;
- WebOS and TV profile markers were present;
- one PTV runtime host, runtime root, and shell were visible;
- the splash remained visible;
- the document retained its preload state;
- the React root existed but was not visible;
- no Jellyfin main-pages host, route page, login page, server selector, or Home content was present;
- no startup error marker, network failure, or runtime exception was observed.

This is not counted physical-remote evidence. It establishes that the frozen client reached the PTV runtime/shell bootstrap but did not complete the Jellyfin RootApp/authenticated route bootstrap. Exact authenticated LG build provenance remains unproven.

## 5. LG route matrix

**Counted physical-remote routes: 0.**

The common Home → Movies → Details → Shows → Series → Season → Episode → Music → Artists → Album → Search → Settings → Home matrix was not started.

Passive inspector observation sent no input. One later operator-authorized inspector navigation was injected solely to reach setup state after cache clearing. That action was marked setup-only, retained no input value, did not start playback, and is excluded from acceptance. It did not produce a visible login or server-selection page.

No injected input, DevTools navigation, keyboard, mouse, phone remote, or synthetic event is being represented as physical-remote proof.

## 6. LG long-cycle result

**NOT RUN.**

The five-cycle navigation-only check cannot begin until exact asset identity, service-worker state, authentication, content preflight, and the single common physical-remote matrix pass. The one-runtime and one-shell passive snapshot is useful setup evidence but is not a long-cycle stability result.

## 7. Fire TV build provenance

The removable validation application used identifier `com.piggietv.validation.r2a`. Its signed APK, installed APK, and expected validation package matched SHA-256 `4ee7cf769575d14f06ba161f9b6ade3104b8148cb82bc978ec0aae9181b24d54`.

Before diagnostic navigation, passive inspection established:

- expected validation-origin category and frozen build ID;
- full commit, production mode, package version, and build timestamp matching Section 1;
- expected index, runtime, main, shared-route, and service-worker asset identities;
- `firetv` platform profile, TV render profile, and ten-foot geometry classes;
- authenticated session and authenticated Home content;
- one foreground validation activity, one inspectable page, one shell, one application creation, and one runtime creation;
- five core listener registrations with zero duplicate-listener and duplicate-feature suppressions;
- one remote-diagnostics instance;
- zero development clients, error overlays, audio activity, and video activity.

The stale native client was stopped before setup, and a wrapper task-stack fault found during setup was removed by making the removable wrapper single-task. That was a validation-helper correction, not an application-source change.

The exact service-worker script was served and hash-matched, but it did not register or control the page because the removable wrapper loaded a private HTTP validation origin that WebView does not treat as a secure service-worker context. This unsupported validation-origin state prevents a counted service-worker-control claim; it is not represented as a product-navigation failure.

## 8. Fire TV Season blocker attribution

The R2 baseline blocker was reproduced diagnostically through Shows and Series Details, then stopped at the first Season boundary. The privacy-safe classification is **CARD OUTSIDE FOCUS GRAPH**.

| Stage | Evidence |
| --- | --- |
| Shows | Route ready; 89 visible cards; no broken visible image |
| Selected visible Series candidate | First checked candidate; 7 Seasons; an Episode available |
| Series Details | Route passed and settled; 33 visible detail cards; no broken visible image |
| Current focus | `nav-item` in `main-content` |
| Season target | 3 DOM carriers; present, interactive, and visible but outside the viewport |
| Existing focus graph | 11 candidates: 6 buttons, 5 navigation items, 0 media cards |
| Directional target | None; target absent from the focus graph |
| Season activation/transition | Not attempted because no directional target existed |
| Passive repeat | Same boundary twice |

The normalized injected sequence used two directional moves and one activation to open the Shows menu, one activation to enter Shows, one downward move to the preflight-matched Details action, and one activation to enter Series Details. All three directional moves were handled by the existing focus owner. Six actions produced two route transitions and zero playback actions.

Exact build, authentication, and usable content were proven for this diagnostic. The observation strongly isolates the existing focus graph as the first product-owned boundary, but it does not satisfy the brief's literal physical-remote reproduction condition. The blocker therefore remains unresolved for counted R2A acceptance, and no source correction was authorized.

## 9. Fire TV route matrix

**Counted physical-remote actions: 0. Common matrix: NOT RUN.**

The operator-authorized injected diagnostic covered only Home → Shows → Series Details and then stopped at the first dependency failure. It is not counted acceptance.

| Route | Recognized | First content | Focus ready | Settled | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Shows | 2.191 s | 4.205 s | 2.191 s | Not claimed | Route ready; one pre-existing image-manager request remained |
| Series Details | 1.517 s | 1.517 s | 1.517 s | 5.520 s | Passed |

Across those observations there was one shell, one runtime creation, five core listener registrations, zero error overlays, zero coordinated requests at the final sample, and zero broken visible images. The Series Details boundary had no directional target for Season, so no Season route action was attempted.

Because the required Season dependency did not pass, the diagnostic did not advance to Episode or the common Movies, Music, Search, Settings, Back-restoration, and Home sequence. No route required refresh during the limited observation, but no full-matrix claim is made.

## 10. Fire TV long-cycle result

**NOT RUN.**

The five navigation-only cycles could not begin because the Season/Episode dependency and common physical-remote matrix did not pass. Short diagnostic samples showed stable one-shell, one-runtime, and five-listener counts, but timer, focus-scope, request, image, collector, and ownership stability over five cycles remain unproven.

## 11. Android TV availability and result

**NOT TESTED — DEVICE UNAVAILABLE.**

No emulator, Fire TV profile, or browser profile is being substituted for physical Android TV. The automated Android TV contract and browser-profile gates are green, but they are not a physical-device claim.

## 12. Cross-device performance summary

No cross-device physical performance comparison is available because no physical-remote route counted.

LG stopped before authenticated first meaningful content, and Android TV was unavailable. The non-counted Fire TV diagnostic recorded the route timings in Section 9, plus three directional-focus samples averaging 170.7 ms with a 210 ms maximum. Shows ended with zero coordinated requests and one pre-existing image-manager request; Series Details settled with the same request counts. Both routes had zero broken visible images.

Route-isolated frame p95, longest-frame, and long-task data were unavailable because the legacy performance monitor deactivated during route replacement; cumulative values were deliberately not represented as route-isolated evidence.

## 13. Runtime/listener stability

LG passive setup evidence showed one application, one runtime, one runtime host, one visible shell, five listener registrations, zero duplicate listener suppressions, and zero duplicate feature suppressions. The clean-relaunch snapshot again showed one runtime and shell at the splash boundary.

Fire TV retained one shell, one application/runtime creation, five listener registrations, and zero duplicate suppressions or error overlays through Shows and Series Details. Two passive snapshots of the failing focus graph were identical.

Automated diagnostics, focus, shell, and ownership regression tests passed. These facts show no static or short-run ownership growth, but they do not satisfy physical long-cycle stability on either device. Android TV has no physical result.

## 14. Failure classifications

| Boundary | Classification | Counted product failure? |
| --- | --- | --- |
| LG exact initial asset set | Build-identity/setup failure: one observed document hash mismatch and initial CSS not fully observed | No |
| LG service worker | Platform/setup state: script matched but no controller was present | No |
| LG session | Authentication incomplete | No |
| LG post-relaunch state | RootApp/bootstrap splash boundary; authenticated route host never appeared | No |
| LG injected setup navigation | Operator-authorized diagnostic control, explicitly excluded from counted input | No |
| Fire TV service worker | Unsupported insecure validation-origin state; exact script matched but no controller/registration | No |
| Fire TV Season chain | Card outside focus graph; repeatable twice in non-counted injected diagnostics | Diagnostic product-owned indication only |
| Fire TV common matrix/long cycle | Dependency stopped at Season; not run | No |
| Android TV | Device unavailable | No |

Fire TV exact build, authentication, content preflight, and a twice-stable first product-owned boundary were established diagnostically. A counted product defect was not established because no literal physical-remote input was available, so the source-correction threshold was not met.

## 15. Source changes, if any

No application source was changed for R2A. The production artifact was compiled once from the final R2 source and then left unchanged.

Validation helpers and removable wrapper artifacts were confined to validation evidence. They did not alter the frozen web tree, focus ownership, navigation ownership, authentication ownership, request ownership, cache ownership, route ownership, diagnostics scope, or playback behavior.

## 16. Automated validation totals

All release-relevant automated gates passed. Focused reruns overlap the complete suites and are not additive test totals.

| Gate | Result |
| --- | --- |
| Static-host helper syntax | Passed |
| Served frozen hashes | 17 matched / 17 served; 0 mismatches |
| Production build | Passed once; 2 size-limit warning classes; not rebuilt |
| Complete Vitest | 167 files; 1,156 passed; 0 failed; 0 skipped |
| TypeScript | Passed |
| Scoped ESLint debt gate | Passed; current 258 errors and 26 warnings across 33 files versus baseline 307 and 31 across 40; no per-file increase |
| Stylelint debt gate | 0 errors; 0 warnings |
| Frozen-output equivalence | 2,527 matched; 0 missing; 0 mismatched; 0 extra |
| ES5 compatibility | Passed for 999 candidates; 13 intentional exclusions |
| Standard Playwright | 55 passed; 6 skipped; 0 failed |
| Cross-browser Playwright | 164 passed; 19 skipped; 0 failed |
| Chrome | 55 passed; 6 skipped; 0 failed |
| Edge | 55 passed; 6 skipped; 0 failed |
| Firefox | 54 passed; 7 skipped; 0 failed |
| Explicit TV-profile cross-browser | 33 passed; 0 skipped; 0 failed |
| Generic TV profile | 6 passed total; 2 per browser engine |
| Android TV profile | 9 passed total; 3 per browser engine |
| Fire TV profile | 3 passed total; 1 per browser engine |
| WebOS profile | 15 passed total; 5 per browser engine |
| Focused TV-profile Vitest | 4 files; 36 passed |
| PTV Core contracts | 11 version-1 schemas and compatibility fixtures validated |
| Android contract parity | 26 models; 14 enums; 19 capabilities; 1 error code |
| Plugin API/cache contract | Passed at API 1 and cache 7 |
| Plugin .NET tests | 33 passed; 0 failed; 0 skipped |
| Focused diagnostics Vitest | 15 files; 75 passed |
| Focused diagnostics Playwright | 10 passed; 0 failed |
| Secret scan | Passed across 118,372 repository paths |
| `git diff --check` | Passed; no whitespace errors |

The E2E harness builds were test-only and did not replace or modify the sealed production artifact.

## 17. Privacy and artifact inventory

Sealed artifact records:

| Record | SHA-256 |
| --- | --- |
| Frozen archive | `fee788b1891c1ef3f5c2318d9f0f6ccb18fdebf523154fc7dab50f0d0d037713` |
| Share-safe manifest | `1209c7d8aafd73b40ee0756c1f3963f5710f5a083bee075b4c68c528514bd4df` |
| Full checksum inventory | `5488fbd18e4886c1a5719a66dbcae5ff35b3592979980cb0593816be48f4f37a` |

The archive contains 2,527 files and the checksum inventory contains 2,527 records. Every frozen file was reverified after automated validation with zero mismatches. The web files, archive, checksum inventory, and manifest are read-only.

Share-safe LG evidence consists of passive provenance, setup-navigation classification, pre-recovery DOM classification, post-relaunch DOM classification, and splash-boundary classification. Private screenshots were permanently removed after inspection; raw device/setup helpers are not share-safe evidence.

The Fire TV Season-boundary record is `fire-non-counted-season-boundary.share-safe.json`, SHA-256 `a1f6bf7bc116466dcb6fe9bf206ca96d96f7f96d8214cdc5ed4379b4211c8839`. It contains aggregate route, focus-graph, timing, build, authentication, content-preflight, and privacy fields only.

The report and share-safe records exclude credentials, tokens, cookies, account identifiers, private network addresses, full URLs, media titles, media identifiers, session identifiers, device serials, raw input values, and local filesystem paths.

Temporary validation cleanup removed both removable device wrappers, their transient authentication state, the temporary remote/local Fire TV screenshots, and the validation-only static host. The frozen build and share-safe evidence remain intact.

## 18. Remaining physical-device debt

- LG must prove every loaded initial and route asset, a controlling service worker or an explicitly supported equivalent state, the authenticated session, content preflight, the common physical-remote matrix, and five long cycles on this same frozen build.
- Fire TV requires a literal-remote reproduction of the isolated Season focus-graph boundary on the current frozen build. If confirmed, it must meet the source-correction gate before any change; any authorized correction would require one newly frozen build shared by all retested devices. Fire TV must then pass Season → Episode, the common physical-remote matrix, and five long cycles.
- Physical Android TV remains a future release-candidate gate because no device was available.
- Per-route physical timing, image, request, frame, listener, runtime, and ownership metrics remain outstanding.

## 19. APPROVE/HOLD/BLOCK

**HOLD**

R2A cannot be approved because:

- no counted physical-remote route evidence exists yet;
- LG exact initial asset identity, service-worker state, authentication, route matrix, and long-cycle acceptance are incomplete;
- Fire TV remains blocked at Season for acceptance, with only non-counted injected evidence that the card is outside the focus graph;
- physical Android TV is unavailable.

No condition currently establishes BLOCK under the brief: the Fire TV boundary was not reproduced using the required literal physical remote, and no authorized source correction was attempted.

## 20. Exactly one next phase

**Next phase: R2B — Literal-Remote Boundary Confirmation and Exact-Build Closure.** First use the current frozen artifact and literal remotes to confirm the Fire TV Season boundary and recover the LG Jellyfin RootApp/authenticated bootstrap. If the source-correction gate is met, apply only the proven correction without changing ownership and create one new frozen production artifact for every retested device; otherwise retain the current artifact. Then complete both devices' physical-remote matrices and five-cycle checks. Physical Android TV remains explicitly unavailable until a real device is supplied.

## 21. Confirmation no playback, production deployment, WebOS reboot attribution, or frozen ownership change occurred

Confirmed:

- no playback was started;
- no production deployment or production modification occurred;
- no WebOS reboot attribution was resumed or claimed;
- no focus, navigation, playback, authentication, request, cache, route, runtime, listener, or diagnostics owner was changed;
- no application source was changed;
- the frozen production artifact was not rebuilt after sealing;
- operator-authorized injected LG setup and Fire TV diagnostics were excluded from physical-remote acceptance;
- both removable validation wrappers and transient test sessions were removed afterward;
- the validation-only host was stopped and its dedicated listener closed.
