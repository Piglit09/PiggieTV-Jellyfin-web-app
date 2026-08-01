# PiggieTV Phase R2A - Counted Physical-Remote Acceptance Against Final R2B

Status: **HOLD**

The literal Fire TV and LG remotes were unavailable. Device control was used only for uncounted, guarded, no-playback operational observations. Zero injected actions are represented as physical-remote acceptance evidence.

## 1. Frozen build identity

| Field | Frozen value |
| --- | --- |
| Build ID | `r2b-20260730T144303873Z-44899b1f-dirty` |
| Timestamp | `2026-07-30T14:43:03.873Z` |
| Full commit | `44899b1fb556f4983ae2c1fa4e861d1ad0b4f4d8` |
| Package | `jellyfin-web 10.11.11` |
| Web files | 2,527 |
| Web bytes | 63,391,153 |
| Web-tree SHA-256 | `a52d7fa8944f2c9da32252abd0d4ce742e8c29d9bce8506ba4362e0c9e529b92` |
| Manifest SHA-256 | `f21373b938132b530c683137db4b1e64893153fae08cec5cd3a0c4c455465e6c` |
| Inventory SHA-256 | `2a50cb19f2ce45a775f162831567039392b918486b52897dfee8f272abd668ac` |

All 2,527 local frozen files matched the sealed inventory with zero missing, mismatched, or extra files. The frozen tree, manifest, and inventory remained read-only.

Primary frozen assets:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `index.html` | 5,379 | `d152401c7a92af203a31271ad56df520d596abd2be45aefa7a15c0e27485ed4d` |
| `runtime.bundle.js` | 48,287 | `926f3ca1eb029d60ab79e2cb394b4d8d9adfa6a4bf27601e237257d4e5079cba` |
| `main.jellyfin.bundle.js` | 1,585,550 | `4b807107405679fd7b91d9736f8ac39ff9fa83e48549307fb5646c09bb333b4b` |
| `serviceworker.js` | 912 | `8d108192a34000a536441c861b7cab5ed8d3e51c91e273d5eb719e5a8b299349` |
| Main CSS | 782,786 | `1e16ee5016f70c8c0f17bfb44aae69662005b1a6db493ec3383e1b68699f3e10` |

No replacement build was created.

## 2. Authentication handling

- Fire TV used the normal Jellyfin-owned server-selection and manual-login UI. Authenticated Home was present before uncounted navigation. Remember-login was disabled, credentials remained only in temporary process memory, residual hidden login fields were scrubbed, and temporary authenticated wrapper state was cleared during cleanup.
- LG stopped before login because the saved backend candidate was unreachable from both validation endpoints. The login form was not reached, credentials were not submitted, and no authentication state was created.
- No credentials, usernames, tokens, cookies, or session identifiers were persisted in source, logs, screenshots, traces, fixtures, or retained evidence.

## 3. Content preflight

Fire TV passed an uncounted, privacy-safe authenticated preflight:

| Category | Result |
| --- | --- |
| Movie | Available; 3,388 candidates |
| Series | Available; 1,048 candidates |
| Season | Child route available; selected visible Series candidate had 7 candidates |
| Episode | Child route available |
| Artist | Available; 668 candidates |
| Album | Child route available; 49 candidates |
| Search | Available |
| Settings | Available |

LG content preflight was unavailable because authentication did not complete. No media titles, identifiers, or fingerprints requiring retention were recorded.

## 4. Fire TV provenance

The removable Fire validation wrapper loaded the exact frozen build. All five primary assets were fetched inside the device WebView, and every byte count and SHA-256 matched the final manifest. Fire TV, TV-render, and ten-foot profile markers were active.

Observed preflight state:

- one runtime, one shell, and five core listener registrations;
- zero duplicate-listener or duplicate-feature suppressions;
- no development client or error overlay;
- no playback activity;
- exact service-worker script loaded, but no registration or controller on the private HTTP validation origin;
- no production application or server mutation.

Counted physical-remote actions: **0**. All operational navigation below was injected and uncounted.

## 5. Fire TV Season/Episode result

The former Season boundary was operationally reachable on the uncounted run:

- Shows opened once and exposed 89 visible cards;
- Series Details opened once and exposed 33 visible detail cards;
- the Season target was present in the DOM and focus graph and classified `target-reachable`;
- Season activated once and Season Details opened;
- no refresh, focus loss, route timeout, broken visible image, error overlay, or playback occurred through Season Details.

The Episode prerequisite and focus candidate were present and reachable. The Episode row exposed rating, overflow, and playback-classified controls rather than a direct Details control. The safe overflow menu opened with 12 controls, including one Details action and three playback-classified actions. Its initial focus landed on a playback-classified action, so validation stopped without activation.

First incomplete boundary: **Episode context menu to Details focus/activation**. This is an uncounted guarded stop, not a reproduced product failure. The former Season blocker is operationally improved, but the counted physical Season/Episode requirement is **not closed**.

## 6. Fire TV full matrix

**NOT RUN AS COUNTED ACCEPTANCE.**

The uncounted run covered only Home to Shows to Series Details to Season Details, followed by the guarded Episode attempt. It did not complete Movies, Movie Details, the Episode route, Back restoration, Music, Artist Details, Album, Search result Details, Settings, or return Home as one matrix.

Injected totals were 25 actions: 20 directional actions handled by the existing focus owner, five activations, three successful route transitions, and zero playback activations.

## 7. Fire TV five-cycle result

**NOT RUN. Completed cycles: 0 of 5.**

The Episode dependency and full counted matrix were incomplete. Short-run singleton and listener observations do not substitute for five-cycle stability.

## 8. LG provenance

The existing removable LG wrapper was installed and launched without rebuilding. Passive inspection showed the expected frozen build ID, validation-origin category, WebOS/TV optimized profile, splash replacement, visible React root, one runtime, one shell, no development runtime or overlay, zero observed exceptions, and no playback.

Exact loaded-device identity was not fully proven:

- 87 frozen assets were observed; 86 matched and the loaded document did not match;
- 22 of 27 initial assets were observed; 21 of 27 matched;
- the service-worker script was observed, but no service-worker controller was present;
- authentication was absent.

Per the abort rule, the LG run stopped. A matching build ID and correct local frozen host do not override the incomplete loaded-asset and authentication gates.

## 9. LG full matrix

**NOT RUN. Counted physical-remote actions: 0.**

One saved backend candidate was discovered, but none was reachable from either validation endpoint. The login/server-selection forms were not reached, no inspector input or navigation was sent, and no route dependency was started.

## 10. LG five-cycle result

**NOT RUN. Completed cycles: 0 of 5.**

Exact loaded-asset identity, authentication, content preflight, and the common matrix were incomplete.

## 11. Android TV availability/result

**NOT TESTED - PHYSICAL DEVICE UNAVAILABLE.**

No emulator, Fire TV, browser, or automated profile is substituted for physical Android TV. The existing automated Android TV profile remains green, but no physical-device claim is made.

## 12. Physical-device performance summary

No counted physical-device performance result exists. The partial Fire run produced these uncounted observations:

| Route family | Recognized | First content | Focus ready | Settled | Visible candidates | Broken visible images |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Shows | 2.128 s | 4.080 s | 2.128 s | 9.948 s | 89 | 0 |
| Series Details | 1.383 s | 1.383 s | 1.383 s | 6.393 s | 33 | 0 |
| Season Details | 1.868 s | 1.868 s | 2.242 s | 6.791 s | Not retained | 0 |

Directional handling averaged 249.3 ms with a 661 ms longest sample. No observed route crossed the 10-second readiness flag, and no observed focus-ready time crossed 3 seconds.

Active requests, pending images, image request totals, frame p95, longest frame, and long tasks were not available as trustworthy route-isolated measurements and are not claimed. LG did not reach an authenticated major route.

## 13. Runtime/listener stability

Fire TV retained one runtime, one shell, and five listener registrations through the short uncounted route sample, with zero duplicate suppressions or overlays. LG showed one runtime, one shell, and five listener registrations at its passive setup boundary.

No runtime or listener growth was observed in those short samples. Because neither device completed five cycles, long-run listener, timer, request, stale-scope, collector, and ownership stability remain unproven.

## 14. Failure classifications

| Boundary | Classification | Product failure proven? |
| --- | --- | --- |
| All counted navigation | `physical input absent` | No |
| Fire Episode Details | `activation unresolved` after playback-risk guard stop | No |
| Fire full matrix/five cycles | Dependency incomplete | No |
| LG loaded document/initial assets | `stale/wrong build` gate unresolved; exact loaded set not proven | No |
| LG reachable backend | `platform setup failure` | No |
| LG session/content/matrices | `authentication failure` / prerequisite unavailable | No |
| Android TV | Physical device unavailable | No |

No exact-build, authenticated, repeatable, physical-input product-owned failure was established. Source-change authorization was therefore not triggered.

## 15. Source changes, if any

None. No application source, focus owner, route owner, navigation owner, request owner, cache owner, authentication owner, runtime owner, listener owner, or playback behavior changed.

Only share-safe validation evidence and this report were added. The frozen web tree was not rebuilt or mutated.

## 16. Validation totals

| Validation | Result |
| --- | --- |
| Frozen local parity | 2,527/2,527 matched; 0 missing, 0 mismatched, 0 extra |
| Fire primary assets in device | 5/5 byte and SHA-256 matches |
| LG observed frozen assets | 86/87 matched |
| LG initial frozen asset set | 21/27 matched; exact gate failed |
| Counted physical actions | 0 |
| Fire uncounted actions | 25; 20/20 directional actions handled; 3 route transitions |
| Fire full matrices / cycles | 0/1 matrices; 0/5 cycles |
| LG full matrices / cycles | 0/1 matrices; 0/5 cycles |
| Android TV physical matrices / cycles | 0/1 matrices; 0/5 cycles |
| Helper syntax | 16/16 passed |
| Focused harness tests | 5 files; 65/65 tests passed |
| Privacy scan | 5 final evidence artifacts; 50 checks; 0 forbidden matches |
| Secret scan | 118,376 paths passed |
| Scoped diff check | 9 paths; 0 whitespace errors |

No implementation suite was unnecessarily rebuilt or rerun because no application source changed.

## 17. Privacy and evidence inventory

Retained share-safe evidence:

- frozen build manifest and frozen asset inventory;
- Fire uncounted operational observation;
- LG passive pre-authentication provenance;
- LG authentication-boundary DOM summary;
- LG authentication-boundary classification;
- this final decision report.

The final privacy scan covers the five device/report evidence artifacts across ten forbidden pattern families. It contains no credentials, tokens, cookies, usernames, email addresses, private addresses, full URLs, media titles or identifiers, playback/session identifiers, device identifiers, raw key codes, or local paths. A private LG screenshot was removed before retention.

The removable wrapper packages remain validation artifacts with their previously sealed hashes. Production/native applications were preserved.

## 18. Remaining physical-device debt

- Literal Fire TV remote confirmation of Series to Season to Episode Details.
- Literal Fire TV full matrix and five stability cycles.
- LG exact loaded-asset closure, reachable normal authentication, content preflight, literal-remote full matrix, and five cycles.
- Physical Android TV matrix and five cycles.
- Counted route-isolated request, image, frame, long-task, focus-restoration, and stability observations.

## 19. APPROVE/HOLD/BLOCK

**HOLD - PHYSICAL INPUT ABSENT.**

Fire exact build, authentication, content preflight, and the uncounted Season route were successful, but Episode Details, the full matrix, and five cycles were incomplete. LG exact loaded-asset identity and authentication were incomplete. Zero device actions qualify as literal physical-remote evidence. No BLOCK-level product failure was proven.

## 20. Exactly one next phase

**Resume counted R2A physical-remote acceptance against the unchanged frozen R2B build when literal Fire TV and LG remotes are available.**

## 21. Confirmation no playback, production deployment, WebOS reboot attribution, frozen-artifact mutation, or ownership change occurred

Confirmed:

- no playback;
- no production deployment or production application/server mutation;
- no WebOS reboot attribution;
- no rebuild or frozen-artifact mutation;
- no focus, route, navigation, request, cache, authentication, runtime, listener, or playback ownership change.
