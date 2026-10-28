# PTV Web Stabilization Pass 02 browser acceptance

## Boundary and pre-change Atlas impact record

Scope: Formal local browser acceptance of the existing Pass 02 player and update work, including newly reported audio/subtitle stream-selection defects. The controlled Home-transition checkpoint `678592eb86ed9b9cdcb4c351f619a6a55aa49da2` is excluded.

Baseline (repository / branch / HEAD / product version / dirty paths): `Jellyfin-Web-PiggieTV`, `fix/web-stabilization-pass-02-browser-acceptance`, `4787879406053b798d16c31bf3e943c01cda0f41`, PTV Web `0.5.62`, clean at checkout. The user explicitly prohibited a version bump.

Stock authoritative owner and contract: Jellyfin Server supplies PlaybackInfo and media-stream metadata; the active Web playback manager and HTML video player own stream-index changes and rendered media state. The native video controller builds action-sheet choices from those current indexes. An action-sheet selected flag is presentation state, not proof that subtitles rendered. Stock contract: Atlas chapters 14 and 24; non-guarantee in chapter 25 that PlaybackInfo does not prove decoder or subtitle display success.

Current PTV owners and modification class: PTV icon engine/styles normalize stock action-sheet icons; the Pass 02 native video controller transient menu wrapper remains the only menu-lifetime owner. Any change should extend those owners. No new preference store, stream index authority, or timeout.

Affected map nodes, edges, mutations, routes, and risk boundaries: `systems.playback`, `ptvOverrides.videoControlsTransientState`, stock video controller, action sheet, icon engine, playback manager, HTML video player, `MediaStreams`, subtitle text-track fetch, and PlaybackInfo stream replacement when needed. The update lifecycle is tested but not changed unless physical acceptance identifies a defect.

Identity, permission, and security scope: One local Jellyfin 12 server, authenticated local test user, active player and item, current stream indexes. No authorization change or production contact.

DTO projection, mutation, readback, and convergence risks: Media-stream availability is not active-track proof. The menu must read the actual current index when opened. A requested subtitle index may precede text-track rendering or transcoding convergence; browser acceptance must observe the selected stream and rendered/disabled subtitle state. Late subtitle fetches may outlive a later selection and require a focused regression if reproduced.

Affected cache, lifecycle, request, image, playback, and configuration owners: Stock playback manager and HTML video player for streams; native controller's Pass 02 transient operation for menu lifetime; PTV icon normalization for visual state. No cache, image, configuration, or session-owner change intended.

Downstream surfaces that can regress: Movie/Episode audio and subtitle menus, secondary subtitles, other action sheets using PTV icons, next-item playback, server session/stream changes, controls hide/reopen.

Pre-code characterization/security tests: RED tests for Off/A/B/Off and Audio A/B/reopen with exactly one visible selected icon, no unavailable selection, and actual setter indexes. Add a deferred subtitle-render test if physical/source evidence confirms late-result adoption. Run focused tests before changing product code.

Post-code focused, boundary, integration, and physical tests: Focused menu/icon/player suites, full Web tests, typecheck, lint baseline, production build, and local Jellyfin 12 browser acceptance for Episode/Movie playback plus real A/B/C service-worker lifecycle. Repeat affected browser checks after any fix.

Conflicts or UNKNOWN items: The reported subtitle switch failure has not yet been reproduced on the isolated local Jellyfin 12 fixture. The icon visibility defect is verified from source. Physical acceptance remains pending. Browser-plugin tooling is unavailable in this session, so regular Playwright will drive the local browser.

Active known deviations and stabilization-backlog entries/order affected: This is the already authorized Pass 02 acceptance gate. Home-transition limitations and unrelated stabilization entries are unchanged.

Atlas update: Required only if the actual product diff changes the documented playback/menu contract; reconcile after implementation. Preserve the stock 10.11.11 reference baseline and label Jellyfin 12 observations separately.

## Acceptance evidence

Local Jellyfin 12 (`127.0.0.1:8097`) and Pass 02 Web (`127.0.0.1:8085`) were isolated from production. The fixture contains one Movie and two Episodes, each with English/Spanish audio and subtitles. Only fixture-local libraries were indexed. Two Episode `Name` fields were edited through Jellyfin's supported local item API, read back, and used to prove the exact bottom labels. No provider refresh or global scan was initiated.

- **Player chrome:** Movie and Episode top identities and Back passed. Episodes displayed `S01E01 — First Signal` and `S01E02 — Second Signal` after fixture metadata readback. Back returned to details.
- **Streams:** Movie and Episode audio switched English → Spanish → English; Jellyfin HLS requests carried `AudioStreamIndex=2` for Spanish, playback continued, and reopened menus showed the active track as the sole computed-visible check. Subtitles switched Off → English → Spanish → Off, with subtitle stream requests and visible English/Spanish cues; Off disabled the native text track and removed subtitle text. Reopened menus showed exactly one computed-visible check at each state.
- **Controls and transitions:** Audio and subtitle popovers closed after idle; pointer movement reopened controls. Natural E1 → E2 autoplay and manual Next retained the active video element's volume and mute. The existing selected-track preference behavior carried Spanish audio and subtitle streams into E2, confirmed by stream requests and reopened menus.
- **Update:** Three same-version production bundles A/B/C with distinct build identities were served at one loopback origin in persistent Chromium profiles. In the exact required sequence, A had no first-install notice; B produced one notice; Reload activated and booted B once, cleared its notice, and stayed clear; C then produced a fresh notice while B remained controller. A separate branch proved a B-specific Later dismissal did not suppress C and that Reload booted C. Neither run cleared storage. The signed-out local stub had no page errors or missing local resources. External Google Cast resource requests were blocked.

Playback evidence: `C:/Users/Piggie/Documents/Codex/2026-10-01/ptv-pass02-browser-acceptance/work/playback-acceptance/` (sanitized probes and screenshots). Update evidence: `C:/Users/Piggie/Documents/Codex/2026-10-01/ptv-pass02-browser-acceptance/work/update-lifecycle/exact-reload-evidence.md` and `exact-browser-evidence.json` for the required A → B Reload → C sequence, plus `evidence.md` and `browser-evidence.json` for the B Later → C Reload branch. The Browser plugin was unavailable, so regular Playwright was used.

## Actual-diff Atlas reconciliation

The product diff changes only PTV icon visibility for hidden action-sheet placeholders and the existing HTML video player's subtitle continuation ownership. Menu option selection remains in the stock playback manager/controller; audio index selection and Jellyfin stream negotiation were not changed. The player now rejects late session, fetched-cue, custom renderer and import results after a newer selection, Off, media-element/source replacement or teardown. Same-track repeat retains a valid pending fetch; source replacement retires the prior subtitle track so the same index can be fetched anew. Primary and secondary selection generations are separate.

Atlas update: **required and completed** in the playback checklist and `system-map.json`. The stock 10.11.11 reference baseline was not rewritten. The observed Jellyfin 12 behavior is local acceptance evidence only. The unrelated Home-transition experimental commit was never incorporated or touched.

Regression proof: two browser cascade tests failed with every placeholder computed-visible, then passed with the scoped CSS fix; three initial subtitle race tests and later source-replacement/Off-intent tests failed before their respective player guards, then the complete eight-test boundary suite passed. The settled-diff gate results are recorded below.

## Final development gates

- Focused playback boundary tests: **62 passed** across four files. Chromium action-sheet cascade tests: **2 passed**. Both were rerun on the settled source after the player and icon changes.
- Pass 01 library-scope and Home freshness regression tests: **98 passed** across five files. This was an automated regression run, not a new manual acceptance of every library fixture.
- Full Web tests: **456 files / 3,980 tests passed**. Typecheck: **passed**.
- ESLint baseline: **passed with no new findings** (185 recorded errors and 20 recorded warnings). Stylelint baseline: **passed with zero findings**.
- PTV version check: **passed**, still `0.5.62`. Build-provenance tests: **4 passed**. Version tests: **4 passed**.
- Production Web build: **passed**. Webpack reported its two established asset/entrypoint size warnings. The built output contains no subtitle race-test chunk.
- Local physical browser acceptance: **passed** for Movie and Episode player identity, navigation, actual stream changes, one computed-visible selected check, subtitle Off, audio/subtitle idle hide and reopen, Episode autoplay/manual Next volume and mute, and the exact A → B Reload → C update lifecycle. The update proof used distinct builds at one loopback origin with persistent profiles and no storage clearing.

No production server was contacted or changed. No deployment, push, or version bump occurred. The controlled Home-transition experimental work remains outside this worktree. Pass 02 browser acceptance is complete. The then-open Pass 01 manual gate was completed in the separate local continuation below. This record does not authorize a release action.

## 2026-10-01 final Pass 01 regression acceptance

The original isolated `PTV Local JF12` 12.0.0 fixture ran at `127.0.0.1:8097` with its four existing, populated library views and a local test account. The isolated Pass 02 Web ran at `127.0.0.1:8085`. The browser sampled the first, middle, and last distinct card IDs from every populated scoped row after deferred rows mounted, then checked each sampled ID against user-aware membership in the selected Jellyfin library. It independently visited each route, used Details/Back, switched libraries and returned, and performed cache-disabled hard refreshes without clearing the authenticated profile.

| Library | Populated rows at hard refresh | Unique IDs checked across visits | Cross-library IDs |
|---|---:|---:|---:|
| Movies | 5 | 19 | 0 |
| Shows | 11 | 4 | 0 |
| Anime | 10 | 8 | 0 |
| Cartoons | 10 | 4 | 0 |

The historical Shows IDs previously observed in Recommended Anime were absent from every rendered Anime card. Shows → Anime → Shows, Anime → Cartoons → Anime, and Movies → Home → Movies all returned without stale recommendation bleed. Four route hard refreshes and Home hard refresh passed. [Per-row membership and navigation evidence](C:/Users/Piggie/Documents/Codex/2026-10-01/ptv-pass02-browser-acceptance/work/final-regression/evidence.json) is saved outside the repository.

Home fresh load, hard refresh, Details/Back, returns from Movies/Shows/Anime, scrolling, and card-preview interaction passed. An untouched Home tab showed three distinct automatic carousel heroes over 26.6 seconds. There were **0** Maximum update depth errors, **0** browser page errors, and no runaway API loop: five fetch/XHR requests in that settled interval, with no identical request repeated; another eight-second settled interval had none. The single React root-unmount warning after Details/Back matches the pre-Pass-02 historical observation. HTTP 404s were missing Jellyfin artwork variants only, not Web assets or membership responses. [Home and Episode evidence](C:/Users/Piggie/Documents/Codex/2026-10-01/ptv-pass02-browser-acceptance/work/final-regression/home-player-accepted-summary.md) records the exact checkpoints and warnings.

The bounded Episode smoke showed the expected series and `S01E01 — Episode 1` identity, opened Audio and Subtitle menus, advanced playback before and after the menus, and returned to details with no video element after Back. One nonfatal HLS buffer-stall message recovered. No product source was changed in this continuation. The prior accepted full Web tests (**3,980/3,980**), typecheck, lint baseline, and production build remain applicable to the unchanged product source.

No media-library scan or refresh was invoked; the isolated fixture log showed no such task during this run, and the prior scan record was unchanged. Both local servers were stopped after acceptance. Production, the controlled Home-transition experimental checkout, deployment, push, and version remained untouched. **Pass 01 manual regression acceptance: PASS. Overall 0.5.63 Web RC preparation: ready for a separate authorization; no commit or RC preparation was performed here.**
