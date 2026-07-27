# PiggieTV Physical LG webOS Regression Report

## 2026-07-22 deployed production acceptance

**Result: stale build disproven, geometry corrected, route-return Home failed. P1 remains open.** No source or server state was modified during this acceptance run.

### Loaded production provenance

| Evidence | LG-loaded value |
| --- | --- |
| Document | `http://10.16.0.50:8096/web/index.html#/home` |
| Frontend build | `10.11.11` |
| Commit | `c81c8ed516-dirty` |
| Build timestamp | `2026-07-23T02:21:05.700Z` |
| Mode | `production` |
| Runtime JS | `/web/runtime.bundle.js` |
| Main JS | `/web/main.jellyfin.bundle.js` |
| Main CSS | `/web/main.jellyfin.3c97233c513f91355010.css` |
| Home JS | `/web/home.5a40f926d5e57dd113e1.chunk.js` |
| Home CSS | `/web/home.791cfebc132b647fce87.css` |
| Service worker | supported, not controlling; scope/script null |
| Jellyfin API | `http://10.16.0.50:8096` |
| Plugin API | `http://10.16.0.50:8096` |
| Render profile | `PTV_WEBOS_OPTIMIZED`, TV tier |
| TV platform | `webos` |
| Geometry classes | `ptv-render-webos`, `ptv-render-tv` |

No normal restart or cache clear was needed because the loaded identity matched the new deployment and no service worker controlled the page.

### Geometry and continuous Home result

The 1920x1080 production page measured a 1788x80 header at `(66,36)`, 220x64 brand/image at `(66,44)`, 712x80 primary navigation centered at x=960, and 296x60 utilities. Hero content measured 700x246 at `(66,322)`, used 21px readable text, and exposed two actions. The first shelf initially measured 1788x553 at `(66,620)` with a 1758x369 scroller at `(81,789)`. Horizontal overflow was zero and the legacy header was invisible.

| Elapsed | Semantic rows | Shelves | Scrollers | Cards | Hero actions | Overflow |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 s | 25 | 19 | 2 | 36 | 2 | 0 |
| 30 s | 25 | 19 | 2 | 36 | 2 | 0 |
| 60 s | 25 | 19 | 2 | 36 | 2 | 0 |
| 95 s | 25 | 19 | 2 | 36 | 2 | 0 |

One stabilized ArrowRight moved focus from Movies to Shows with exactly one `focusin` event. Both targets had a 3px visible outline/glow and remained inside the viewport.

### Route-return failure

Before leaving Home, counts were 25 semantic rows, 19 shelves, two scrollers, and 36 cards. Movies loaded at `#/movies`. Browser Back returned `#/home` with the hero and two actions, but after 16 seconds only six semantic sections remained and shelf/scroller/card counts were all zero. The state remained unchanged through `2026-07-23T02:47:09.944Z`, more than six minutes after return.

The preserved physical report has status `warning`, issue code `first-shelf-missing`, and latest milestone `report-generated`. It independently confirms the corrected header/brand/navigation/utility geometry, readable hero/actions, visible in-viewport focus, hidden legacy header, production build provenance, and absent first shelf/scroller.

### Preserved evidence

- `test-results/webos-physical/production-home-acceptance-timeline.json`
- `test-results/webos-physical/production-home-before-navigation.png`
- `test-results/webos-physical/production-home-route-return.json`
- `test-results/webos-physical/production-home-after-return.png`
- `test-results/webos-physical/production-home-preserved-diagnostic-heartbeat.json`
- `test-results/webos-physical/production-home-failed-final.png`

The PNG files are LG framebuffer captures, not camera photographs. A new camera photo remains required. The real five-minute diagnostics lease was created through the authenticated admin API without opening Dashboard; local and plugin-stored reports were preserved before revocation, and the LG later confirmed `diagnosticsActive=false`.

The shell geometry sub-defect is physically corrected, but Home P1 cannot close because route-return restoration failed. No CSS change is indicated by this evidence. Separate authenticated Items latency, same-account interaction, cold/warm discovery, backend lock, and full remote/playback acceptance blockers remain open.

## 2026-07-22 Home persistence and split-origin physical rerun

**Result: the reported shelf disappearance did not reproduce in two bounded same-LG runs. Production remains HOLD.** This section supersedes the earlier zero-row local capture for Home content availability, while preserving that capture as historical shell-correction evidence.

### Origin correction

The hosted webOS container remained a local `file://com.sdk.ares.hostedapp-webos` document with one child frame. The corrected child document was exactly `http://10.16.0.125:8082/`. Its authenticated `ApiClient` root was `http://10.16.0.50:8096/`; observed resource origins were limited to those two origins, with no `.125:8096` traffic. The development process was started with `PTV_DEV_JELLYFIN_URL=http://10.16.0.50:8096`.

The prior hosted-development file derived a Jellyfin target from the TV-visible frontend host and redirected to `.125:8096`, before normal server selection could repair the route. `scripts/webos-hosted-dev/index.html` now records the exact `.125:8082` frontend contract instead of a hostname-derived production port.

### Home cache correction

Shared featured-content semantics now reject partial, degraded, configuration-only, and ordinary empty payloads as persistence replacements. Native Home rejects stale-route, empty-late, partial, and section-shell model commits when a populated model is already visible. Plugin refresh no longer requests empty configured rows and retains the previous cache when semantic validation fails.

The six previously observed empty section definitions were generated by `BuildConfiguredRows(... includeEmptyRows: true)` from enabled rules whose candidate selection produced no hero/row items. They were configuration shells, not usable Home content. The plugin safeguard was tested locally but was not deployed to the remote server during this physical run.

### Split-origin development observation

After authentication, Home initially rendered a real hero, 25 semantic rows, 36 cards, and 40 images. Diagnostics were enabled only in the development client, the route moved Movies -> Home once, and four snapshots were captured over 100.1 seconds.

| Elapsed | Route | Rows | Cards | Images | Hero | Logger errors |
| ---: | --- | ---: | ---: | ---: | --- | ---: |
| 0 s | `#/home` | 25 | 36 | 40 | stable | 0 |
| 30 s | `#/home` | 25 | 36 | 40 | stable | 0 |
| 60 s | `#/home` | 25 | 36 | 40 | stable | 0 |
| 95 s | `#/home` | 25 | 36 | 40 | stable | 0 |

The named embedded timeline event array remained empty on this loaded development generation, so the authoritative persistence evidence is the external four-snapshot count/cache report rather than an invented event history.

### Untouched original-server comparison

The hosted child frame was temporarily navigated to the untouched `http://10.16.0.50:8096/web/index.html`, authenticated separately, and observed in place without enabling debug mode or modifying the server. Four snapshots over 100.7 seconds retained the same hero, 25 rows, 36 cards, and 40 images with zero logger errors. The disappearance therefore did not reproduce on the original frontend during this window either; this does not prove every prior concurrency/timing path is retired.

### Artifacts and disposition

- `test-results/webos-physical/home-split-origin-after.json`
- `test-results/webos-physical/home-split-origin-after.png`
- `test-results/webos-physical/home-original-server-after.json`
- `test-results/webos-physical/home-original-server-after.png`

The PNGs are inspector screen captures from the physical browser, not camera photographs. The TV was restored to authenticated `http://10.16.0.125:8082/#/home`, where 25 rows and 36 cards remained visible.

Automated validation passed: focused 28/28; full Vitest 646/646 across 95 files; plugin 31/31; TypeScript/build policy; production Webpack in 111.724 seconds with only established size warnings; plugin contract; secret scan; and `git diff --check`. Complete user-operated remote navigation, OK/Back exactly-once behavior, focus restoration, playback handoff, same-account 13/13 interactions, authoritative cold/warm discovery, and backend lock/latency evidence remain open. P1 Home persistence has positive physical evidence but the overall release gate is not closed.

## 2026-07-22 shared shell correction and physical after capture

The narrow shared shell/LG CSS correction was built and deployed to the same connected local LG path used for the authoritative before capture. The production server was not touched.

### Confirmed cause

The webOS optimized profile applied `ptv-render-webos`, but the centralized ten-foot layout rules were guarded by `ptv-render-tv`. Profile reconciliation removed that class, so the TV inherited base shell behavior. Chrome 68 then allowed the 1077x500 intrinsic brand and min-content sizing to influence the header and ignored unsupported `clamp()` offsets. The final correction keeps the webOS-specific class, adds the TV-tier class, contains intrinsic sizing, and supplies literal 720p/1080p/4K geometry.

### Measured result

| Measurement | Before | Final after |
| --- | ---: | ---: |
| Viewport | 1920x1080 | 1920x1080 |
| Shell header | 1920x500 | 1788x80 at `(66,36)` |
| Brand | 1077x500 | 220x64 at `(66,44)` |
| Primary navigation | obscured/misaligned | 712x80, center x=960 |
| Utilities | displaced | 296x60, within header |
| Brand owners | one oversized owner | one bounded owner |
| Horizontal overflow | not authoritative | 0px |
| Legacy header | hidden | hidden |

The hero content measured 700x148 at `(66,420)` and is no longer obscured by the brand. The initial focus was visible on the brand with a 3px outline and glow. One injected ArrowRight event moved focus to a primary-navigation button at `(612,48)`, still inside the viewport with the same visible outline. This is one physical-browser transition, not a complete user-operated remote acceptance run.

### Embedded report disposition

The authoritative artifacts are:

- `test-results/webos-physical/physical-layout-after.json`
- `test-results/webos-physical/physical-layout-after-focus.json`

Both reports retire `shell-brand-oversized`, `hero-content-obscured-by-shell-brand`, and `focus-not-visible`. Both retain `first-shelf-missing` because the local authenticated Home route settled with zero mounted rows, no hero actions, and no shelf/scroller after the extended observation period. The diagnostics lease was stopped after the reports were preserved.

No post-fix camera photo was captured. The supplied photograph remains before evidence only. P1 is therefore **partially corrected, not closed**: header/brand/hero/focus geometry is physically corrected, while populated shelf geometry, the full physical remote path, and visual after-photo acceptance remain outstanding.

### Validation and boundary

Final validation passed with 39/39 focused regressions, 629/629 full Vitest tests, TypeScript/build policy, scoped Stylelint, production Webpack, secret scan, and Playwright 43 passed/6 opt-in live skipped. Changed-file ESLint surfaced only existing legacy findings on unchanged lines. No plugin source or schema changed, and the remote production deployment remained untouched.

## 2026-07-22 authoritative embedded production capture

**Status: P1 confirmed and open.** This section supersedes older statements below that the connected LG runtime was uninspectable. The embedded production wrapper reached the real local Jellyfin origin, the user signed in, and the existing administrator-controlled Remote Diagnostics transport completed a physical layout capture.

### Device and runtime

| Evidence | Observed value |
| --- | --- |
| Device | LG 70UN7070PUA |
| webOS SDK | 5.6.2 |
| Firmware | 04.64.00 |
| Browser family | webOS Chrome 68 |
| CSS viewport | 1920x1080 |
| Device pixel ratio | 2 |
| Render profile | `PTV_WEBOS_OPTIMIZED` |
| Physical snapshot capability | `true` |
| Diagnostics check-in | HTTP 200 |

### Authoritative Home result

| Node | Top | Left | Width | Height | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| Shell header | 0 | 0 | 1920 | 500 | Full viewport width |
| Shell brand | 0 | 0 | 1077 | 500 | Owned by `shell-brand` marker |
| Shell brand image | 0 | 0 | 1077 | 500 | Intrinsic size also 1077x500 |
| Home root | 0 | 0 | 1920 | 1215 | Extends below viewport |
| First shelf/scroller | n/a | n/a | n/a | n/a | Fixed selectors absent |
| Shell main | n/a | n/a | n/a | n/a | Fixed selector absent |
| Legacy header | 0 | 0 | 0 | 0 | Present but invisible |

The report status is `regression`. Its exact issue codes are:

- `shell-brand-oversized`
- `hero-content-obscured-by-shell-brand`
- `first-shelf-missing`
- `focus-not-visible`

The target-route server report was directly observed before Stop with the same four issue codes, seven bounded milestones, and latest milestone `report-generated`. The Dashboard's dedicated Physical TV Layout Snapshot section also rendered live. Navigation to Dashboard followed by Stop allowed a later warning-only shutdown snapshot to replace the latest stored report, so future captures must request/view or download the Home report before leaving the route.

### Evidence and privacy contract

The snapshot uses fixed semantic selectors and fixed milestones. It records geometry, visibility, bounded style categories, intrinsic image dimensions, allowlisted PTV root/body state, build/profile evidence, and fixed issue codes. It excludes page text, HTML, media identity, arbitrary attributes, raw URLs, raw CSS rules, credentials, and screenshots. CSS ownership reports `unsupported` with reason `reliable-cascade-source-attribution-unavailable`; the implementation does not invent a stylesheet attribution.

### Root-cause boundary

The evidence proves that the shared shell brand image is rendering at its 1077x500 intrinsic size inside a 500-pixel-tall header and obscuring Home content. It does not prove which cascade rule wins. No CSS/layout correction was made during this diagnostics prompt, and page-local transforms or global scaling remain prohibited.

### Compatibility correction and validation

Jellyfin serialized live plugin DTOs with PascalCase keys. The Dashboard and diagnostics client transport now normalize PascalCase and camelCase client rows, capabilities, boot markers, commands, leases, and stored reports while retaining malformed-row rejection.

- Focused Dashboard/transport tests: 20/20 passed.
- Full frontend Vitest: 93 files, 624/624 passed.
- TypeScript: passed.
- Plugin baseline: 28/28 passed; plugin contract passed.
- Production Webpack: passed in 121.095 seconds with only the two established size warnings.

### Deployment and closure

The rebuilt frontend, embedded wrapper, and five-file plugin payload were exercised only against the local test Jellyfin instance. The remote production server was not changed. The TV remains authenticated to the local test instance for follow-up.

P1 closure requires a narrow shared shell/webOS CSS correction, a new Home capture with none of the four regression codes, visible focus and remote navigation evidence, and a corrected physical photo. The server-latency, interaction, cold/warm discovery, and playback/database-lock release gates remain separate and open.

The earlier sections below are retained as historical pre-embedded-path evidence. Their inspectability limitation is superseded; their visual baseline remains useful.

## 2026-07-22 connected-device inspection result

### Physical device

The LG is connected as PiggieTV-LG. ares-device reports model 70UN7070PUA, SDK 5.6.2, firmware 04.64.00, and board K6LP_ATSC_US. Active CSS viewport, devicePixelRatio, visual viewport, and screen dimensions remain unknown.

### Store-app access result

Device discovery and system information succeed. ares-install and ares-launch enumeration expose no store package. ares-inspect targeting org.jellyfin.webos remains active without returning an endpoint and times out. The current tv CLI profile explicitly rejects ares-shell and ares-log.

This establishes a Developer Mode sandbox limitation, not a disconnected TV and not a failed PiggieTV runtime.

### Proven and unproven state

The physical photo and source audit prove that banner-light is escaping its intended visual bounds and that native PTVShell is a source owner of that asset. They do not prove the loaded frontend revision, service-worker controller, actual mounted node, profile state, CSS source order, computed dimensions, or focus graph.

### Changes

Documentation only. No package was installed, launched, closed, replaced, or removed. No frontend, CSS, service worker, Jellyfin server, plugin, or television state changed.

### Required next boundary

Proceed only after choosing an inspectable developer-wrapper deployment or an embedded production-diagnostics route. A development wrapper can diagnose the engine and frontend but cannot by itself close the official store-wrapper physical acceptance gate. The final correction still requires a matching production bundle and rerun on the same physical Home route.

## 2026-07-22 photo and source attribution update

The physical photo is now available in the conversation and supersedes the earlier statement that no image could be inspected. It is the authoritative before screenshot.

### Confirmed visual evidence

The selected media appears to be The Simpsons. Its title, year/rating/runtime, genres, score, overview, and actions are compressed in the upper-left and partially covered. The complete PiggieTV banner spans the hero area, the centered navigation pill crosses the banner, utility buttons occupy the same horizontal region, no card shelf is visible, and the lower portion is a large empty blurred surface.

### Exact artwork match

The oversized artwork is an exact visual match for src/ptv/assets/logo/banner-light.png. The asset itself includes the pig emblem, PiggieTV wordmark, and Powered by Jellyfin text. This rules out a Jellyfin media-item logo and explains why Powered by Jellyfin appears as part of one image rather than as leaked text markup.

### Source-supported owner

Native PTVShell resolves PTV_ASSETS.logos.bannerLight and renders it inside the ptv-shell-brand anchor. Shell CSS intends to cap the image, and the TV profile adds literal 196px maximum width and 64px maximum height. The physical result proves those constraints are not effective in the loaded television runtime.

This is strong source attribution, not a live DOM capture. AppHeader and drawer paths also reference the banner asset, so the exact mounted node and duplicate-owner state still require physical inspection.

### Root-cause boundary

Exact root cause remains unproven. Current candidates are stale or mixed frontend assets, stale service-worker control, absent or replaced ptv-render-tv/ptv-platform-webos state, unsupported clamp sizing without the TV override, or a higher-specificity/later rule defeating the intended bounds. Adding CSS before distinguishing these would violate the physical investigation contract.

### Device access

The second read-only npm run webos:devices check again lists only emulator (default) at developer@127.0.0.1:6622. The physical LG build, service worker, chunks, classes, DOM, computed styles, geometry, and focus state remain unavailable.

### Changes and validation

Documentation only. No shell, Home, hero, branding, profile, focus, or CSS source changed. No emulated regression suite was run because there is no proposed source correction. No after screenshot or after geometry exists.

### Remaining closure evidence

Connect the same LG through ares, capture Phase 1 provenance and Phase 2 DOM/CSS ownership, correct stale deployment first if found, otherwise apply the narrowest source fix, run the multi-profile matrix, deploy the matching bundle, and capture the corrected physical Home plus startup remote-navigation results.

## 2026-07-21 authoritative physical failure baseline

Status: P1 BLOCKED. Investigation stopped before CSS changes because the physical runtime is not available through the configured webOS CLI.

## 1. Physical device and resolution

The evidence identifies a real LG webOS television. Exact model, webOS version, and active 1080p or 4K resolution were not supplied in the accessible attachment.

## 2. Loaded frontend build

Unknown. No physical LG ares target is configured, so frontend build ID and commit/build identifier could not be captured.

## 3. Service-worker and cache state

Unknown. Active service-worker version, scope, controller, cache generation, and old/new chunk coherency could not be inspected.

## 4. Detected TV and webOS profile

Unknown on the physical device. Required ptv-render-tv, ptv-platform-webos, data-ptv-tv-platform, and data-ptv-tv-reason evidence was not captured.

## 5. Root and body classes

Unknown. Initial, runtime-start, authenticated, Home-mounted, hero-ready, and shelf-ready class snapshots remain required.

## 6. Oversized PiggieTV logo owner

Not established. The physical report shows oversized PiggieTV and Powered by Jellyfin branding inside the hero area, but no DOM inspection is available to distinguish shell brand, hero fallback/title art, login branding leakage, global branding, stale markup, legacy injection, or duplicate roots.

## 7. Exact root cause

Not established. The observed result is classified as a physical webOS shell/layout ownership regression. Stale or mixed frontend assets, profile initialization race, DOM ownership leakage, and final CSS source-order conflict must be ruled in or out before source changes.

## 8. Winning CSS rules before correction

Not captured. Final declarations for header, shell logo, primary navigation, utilities, shell main/page geometry, hero bounds/content/logo, first shelf, and webOS fallback remain required from the physical runtime.

## 9. Files changed

Documentation only: HANDOFF.md, PROJECT_STATE.md, ARCHITECTURE.md, PRODUCTION_READINESS_REPORT.md, and this report. No shell, Home, hero, branding, focus, profile, or CSS source changed.

## 10. Before and after node geometry

Before is qualitative only: metadata compressed and obscured in the upper-left; oversized branding inside hero; header controls over hero; upper content occupies part of the screen; lower half mostly empty; first shelf not visible. Numeric rectangles were not captured. There is no after geometry because no correction was attempted.

## 11. Before and after screenshots

The textual report declares the physical photo authoritative, but the accessible attachment directory contains only pasted-text.txt. No image file was available to inspect or preserve here. No after screenshot exists.

## 12. Focus and remote results

Not tested in this prompt. Initial focus, nav-to-hero, hero-to-shelf, card traversal, exactly-once OK, Back restoration, dropdown layering, focus rectangles, movement duration, and duplicate activation count remain required on the physical television.

## 13. Performance impact

No performance change was made or measured. Any future correction must retain static translucent webOS surfaces and bounded effects without letting the performance profile alter layout ownership.

## 14. Cross-platform regression results

Not run because no source changed. Existing desktop/mobile/Android TV/Fire TV automation remains historical evidence only and cannot close the physical LG gate.

## 15. Remaining physical-device issues

Configure the same LG television in Developer Mode and add it to ares. Capture build, service worker, chunks, profile/classes, viewport/screen, runtime/shell registration counts, route owner, DOM ownership, computed geometry, source-order winners, and focus state. If stale or mixed assets are present, repair deployment coherency and recapture before CSS work. Then make the narrowest verified source correction, run the required multi-profile regression matrix, redeploy, and provide a corrected photo plus startup remote-navigation evidence.

## Discovery evidence

The read-only command npm run webos:devices completed successfully and listed only emulator (default), developer@127.0.0.1:6622. No physical LG device or remote state was available or modified.
