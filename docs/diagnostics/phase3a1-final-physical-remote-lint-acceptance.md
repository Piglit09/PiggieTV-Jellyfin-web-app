# Phase 3A.1 final physical-remote and lint acceptance

Date: 2026-07-27

Decision: **HOLD**

> Follow-up: the presentation defects that produced this HOLD were corrected
> and revalidated in
> [Phase 3A.2 WebOS playback surface composition](phase3a2-webos-playback-surface-composition.md).
> This historical Phase 3A.1 decision is retained unchanged; Phase 3A.2 does
> not retroactively substitute its evidence for the unrun final-build video
> matrix or long cycle.

The exact final production bundle passed build identity, automated regression,
privacy, and Phase 3A lint-delta checks. Literal LG-remote testing then exposed
two presentation defects: the mini-player is covered on the Music route, and
the full-screen Music layout is substantially larger than the WebOS viewport.
The final-build video matrix and long cycle were not substituted from an older
build. This is therefore not an approval.

## 1. Final build and device identity

| Field | Final value |
| --- | --- |
| Commit | `44899b1fb556f4983ae2c1fa4e861d1ad0b4f4d8` |
| Build worktree | Clean at build time |
| Build | Production, completed `2026-07-27T12:56:11.7388637Z` |
| Package version | `10.11.11` |
| Main bundle | 1,556,631 bytes; SHA-256 `6BFDD163E323328BEAF100237F17EA4CFB4CC4E012E5DE6456E2992076B2900F` |
| Runtime bundle | 47,856 bytes; SHA-256 `2D841587CABCB8AC135E86B2BBCF39725938EE101FB1290C44F0C67E3F541DC4` |
| Service worker | 912 bytes; SHA-256 `8D108192A34000A536441C861B7CAB5ED8D3E51C91E273D5EB719E5A8B299349` |
| Validation application | `com.piggietv.validation` 1.2.0, removable |
| TV | LG 70UN7070PUA; firmware 04.64.00 |
| WebOS profile | SDK/profile 5.6.2 / `webos` |
| Viewport | 1920 x 1080; DPR 2 |
| Active origin | Share-safe category `local-static-validation` |
| Focus engine | Ready; one connected candidate |
| Diagnostics session | `phase3a1-physical` |

The loaded main and runtime decoded byte counts matched the final files.
Exactly one of each bundle was loaded. There was no service-worker controller,
Webpack development client, or error overlay. The validation application was
fully closed and relaunched after an earlier stale build was detected. Only
the removable validation application was used; production was untouched.

The lint-ledger and this report are validation-only changes made after the
bundle was built. They are not bundle inputs and do not alter the identity
tested on the TV.

## 2. Physical-remote proof

All acceptance actions recorded below came from the operator's literal LG
remote. The observer only read and exported device state; it did not inject
keys, click, type, or dispatch browser events. Trusted WebOS remote samples,
operator confirmation, and passive page state were cross-checked. No keyboard,
mouse, phone touchpad, or inspector input was counted.

The retained input data is normalized to safe actions such as `right`,
`select`, `pause`, and `play`. Raw key codes, titles, item IDs, sessions, URLs,
private addresses, user/device IDs, credentials, tokens, and cookies were not
retained.

## 3. Music scenario matrix

| ID | Result | Literal physical sequence and observed outcome |
| --- | --- | --- |
| M1 Start Music | **FAIL** | `right x7`, `select x2`. One playback action started audio in 821 ms and reached playing in 2,527 ms. One mini-player existed in the viewport and no full-screen player opened, but Music content painted and hit-tested above the dock; the operator could not see it. |
| M2 Mini-player reachability | **PASS, isolated on Home** | After returning to Home, the mini-player was visible. `right x1`, `select x1` reached Open Player and opened one full-screen route. No duplicate playback action occurred. |
| M3 Full-screen Music | **FAIL** | One full-screen player replaced the mini-player and focus landed on Pause, but its 1,908 x 2,074 root was shifted to `top: -1099`; art was 1,310 x 2,074 and also off-screen. The renderer stayed alive. |
| M4 Transport | **DEGRADED** | The operator performed physical Pause then Play; the final playing state, full-screen route, and Pause focus were corroborated. A temporary diagnostic lease had expired before the pair, so no retained per-event trace proves the intermediate full-screen Pause state. Earlier exact-build mini-player evidence recorded one Pause and one Play, one state transition each, in 16 ms and 7 ms. Toggle, Previous, and held-repeat coverage remain incomplete. |
| M5 Track transition | **NOT TESTABLE** | A bounded 204 ms pause-to-playing load transition completed with one stable full-screen surface and valid Pause focus, but no privacy-safe item-boundary signal proves that a track changed. The same sample is consistent with buffering. |
| M6 Music Back | **NOT RUN** | Testing stopped after the blocking visual failures. An earlier Music-to-Home Back observation is not substituted for the required Back from full-screen. |
| M7 Route persistence | **FAIL** | With audio active, Music had one covered, imperceptible mini-player; Home had one visible, unobscured mini-player. Artists, Albums, Songs, Playlists, Search, and Settings were not run after the blocker. |

## 4. Video scenario matrix

| ID | Result | Reason |
| --- | --- | --- |
| V1 Hidden seek | **NOT RUN** | Exact-final-build testing stopped after the blocking Music failures. |
| V2 Control scope | **NOT RUN** | Exact-final-build testing stopped after the blocking Music failures. |
| V3 Two-stage Back | **NOT RUN** | Exact-final-build testing stopped after the blocking Music failures. |
| V4 Video transport | **NOT RUN** | Exact-final-build testing stopped after the blocking Music failures. |

Earlier-build video observations were deliberately not promoted to final-build
acceptance evidence.

## 5. Long-cycle result

**NOT TESTABLE.** The required Music mini-player and full-screen segments
failed before the prescribed long route cycle could be validly completed.

## 6. Transport results

The sampled exact-build state showed a single Music playback owner and no
duplicate action in the retained physical samples. Mini-player media Pause and Play each produced
one event and one state transition. The operator then completed Pause and Play
on full-screen Music and the passive final state was playing. Because the
diagnostic lease was inactive during that final pair, M4 remains DEGRADED
rather than being upgraded from operator confirmation alone. Unsupported or
unrun toggle/Previous/held cases are not called failures and are not called
passes.

## 7. Back and restoration results

A physical Back from Music returned to Home while audio continued; the same
mini-player then became visible and focus remained connected. This comparison
helped isolate the Music-route stacking defect. It does not satisfy M6 because
the Back did not begin from the exact final full-screen acceptance state.
Full-screen Music Back and final-build video two-stage Back remain unaccepted.

## 8. Presentation invariants

- M1 retained exactly one mini-player DOM surface and zero full-screen surfaces,
  but the mini-player was not perceptible or reachable visually on Music.
- M2/M3 retained zero mini-players and exactly one full-screen Music surface.
- No automatic mini/full-screen duplication, route bounce, detached focused
  node, renderer termination, or orphaned audio was observed on the final
  static build.
- The WebOS policy remained active: Reading and Request controls were absent
  and their feature chunks were not loaded.

The M1 cause is composition, not playback ownership. `PTVRuntimeRoot` appends a
separate host to `body`; its dock z-index remains trapped in that host's
stacking plane beneath the positioned route shell. The Home comparison proves
that the same playing dock becomes unobscured when the covering Music shell is
absent.

The M3 cause is also presentation-specific. The mounted class is
`.ptv-music-fullscreen-player`, while the existing fixed viewport rule targets
`.ptv-music-fullscreen`. WebOS Chrome 68 also drops the later `aspect-ratio` and
`min()`-based bounds. A long queue can therefore grow the normal-flow grid,
stretch the art, and allow initial focus scrolling to shift the route upward.

## 9. Runtime and listener stability

Each sampled checkpoint in the bounded final-build Music session retained:

- application creation count: 1;
- runtime creation count: 1;
- listener registrations: 5;
- duplicate listener suppressions: 0;
- duplicate feature registrations: 0.

There was no sampled growth during Music start, Home comparison, full-screen
open, transport, or the bounded pause-to-playing observation. This does not
prove video or long-cycle stability; those checks were not run.

## 10. Share-safe export inventory

The machine-readable inventory is
`test-results/webos-phase3a1-2026-07-27/artifact-inventory.json`.
The primary exports are:

- `final-build-device-identity.json`;
- `physical-remote-scenario-matrix.json`;
- `m1-mini-not-visible-failure.json`;
- `m3-fullscreen-oversized-failure.json`;
- `m7-route-persistence-failure.json`;
- `m4-physical-pause-play-final-state.json`;
- `m7-home-mini-visible-snapshot.json`;
- `m5-next-after-wait-snapshot.json`;
- `automated-acceptance-results.json`;
- `eslint-changed-line-attribution.json`;
- `eslint-attribution-manifest.json`.

`m1-pass-snapshot.json` is explicitly catalogued as a pre-visual-confirmation
DOM snapshot, not as a PASS claim. The large observer snapshots were
mechanically sanitized before retention: client/user/device/media identifiers,
raw route/URL strings, raw key codes, titles, private network locations, and
filesystem paths are redacted or normalized. A post-sanitization scan found
none of the original client identifier, raw URL tokens, raw routes, or network
locations. Each actual FAIL has a dedicated share-safe export.

## 11. Lint baseline methodology

The repository was already dirty when Phase 3A began, so the later commit
parent could not honestly represent the pre-phase worktree. The exact
pre-Phase-3A JavaScript/TypeScript state was reconstructed from the retained
successful patch records:

- 103 successful patches were audited;
- 96 JavaScript/TypeScript change records were classified;
- 23 pre-existing files and 11 phase-added files were identified;
- 69 reverse updates rebuilt the pre-phase file set;
- every reconstructed file matched its retained reverse-patch provenance.

ESLint JSON was then produced for the reconstructed baseline and the same
current file set. A separate comparator mapped current findings to Phase 3A
changed lines and compared normalized file/rule/message signatures.

The stale checked-in ledger was refreshed only after this attribution proved
that the repository findings predated Phase 3A. No source cleanup, formatting
sweep, or broad ESLint disable was applied.

## 12. Baseline, current, and focused lint comparison

| Scope | Errors | Warnings | Scanned / finding files | Result |
| --- | ---: | ---: | ---: | --- |
| Exact reconstructed pre-Phase-3A file set | 25 | 4 | 23 / 3 | Baseline |
| Current Phase 3A file set | 25 | 4 | 34 / 3 | No count increase |
| Phase 3A changed lines | 0 | 0 | 34 / 0 | PASS |
| New normalized signatures | 0 | 0 | n/a / 0 | PASS |
| Current PTV repository ledger | 307 | 31 | n/a / 40 | Accepted proven legacy debt |
| Focused Stylelint | 0 | 0 | focused / 0 | PASS |
| PTV Stylelint ledger | 0 | 0 | PTV / 0 | PASS |

The different baseline/current file counts reflect 11 newly added files with
no new findings; all findings remain in the same three legacy files. The 25
errors and 4 warnings are unchanged. The repository is **not lint-clean**.
`npm run lint:ptv` passes only because no per-file finding increased beyond the
accurately refreshed legacy-debt ledger.

## 13. New-error attribution

Phase 3A introduced zero ESLint errors and zero warnings on changed lines, and
zero new normalized finding signatures. All 11 phase-added files are 0/0. The
`PTVShell.tsx` WebOS platform filter lines add no finding. Its current 25
errors are inherited; the nearby `react/jsx-no-bind` finding maps to the
reconstructed legacy line rather than to the new filter. The remaining four
warnings are also reconstructed legacy warnings. The machine-readable
`eslint-attribution-manifest.json` records, for every scanned file and rule,
baseline/current errors and warnings plus explicit `baselineExisting`,
`introduced`, and `removed` counts. No new lint error is attributable to Phase
3A.

## 14. Automated test and build results

The validation commands and retained results were:

| Command/gate | Passed | Skipped | Failed |
| --- | ---: | ---: | ---: |
| Focused presentation/platform/player Vitest command | 94 tests in 6 files | 0 | 0 |
| Focused lifecycle/resource/layout Vitest command | 7 tests in 3 files | 0 | 0 |
| Explicit privacy Vitest command | 44 tests in 8 files | 0 | 0 |
| `npm run test:ptv -- --run` | 701 tests in 115 files | 0 | 0 |
| `npm test -- --run` | 907 tests in 138 files | 0 | 0 |
| `npm run test:e2e:build` | Harness build | 0 | 0 |
| `npm exec playwright -- test e2e/tests/diagnostics.spec.ts --workers=1` | 9 | 0 | 0 |
| `npm run build:check` | TypeScript, 0 diagnostics | 0 | 0 |
| Exact Phase 3A ESLint comparator | 0 changed-line findings | 0 | 0 |
| `npm run lint:ptv` | No increase over accepted ledger | 0 | 0 gate failures |
| Focused Stylelint command | 0 findings | 0 | 0 |
| `npm run stylelint:ptv` | 0 findings | 0 | 0 |
| `npm run contracts:validate` | 11 schemas/fixtures | 0 | 0 |
| Share-safe export sanitization scan | 6 observer exports; 0 forbidden findings | 0 | 0 |
| `npm run secret:scan` | 118,286 repository paths | 0 | 0 |
| `git diff --check` | PASS | 0 | 0 |
| `npm run build:production` | Webpack 5.99.9; 0 errors | 0 | 0 |

The production build emitted two standard asset-size warnings and no error.
The PTV ESLint result is a baseline no-increase pass, not repository-wide
ESLint success. Machine-readable counts are retained in
`automated-acceptance-results.json`.

## 15. Remaining defects

1. The persistent runtime host is below the Music route shell's stacking plane,
   making the mini-player covered and visually unreachable on Music.
2. The mounted full-screen Music class is not governed by the existing fixed
   viewport selector, and Chrome-68-incompatible sizing leaves the player
   oversized and shifted off-screen.
3. Exact-final-build M5, V1-V4, M6, the remaining M7 routes, and the long cycle
   have no valid physical-remote acceptance result.

There is no evidence in this final static session of a renderer crash,
orphaned playback, duplicate playback/input ownership, diagnostic privacy leak,
or new Phase 3A lint finding. The correct classification is HOLD, not BLOCK.

## 16. Final decision

**HOLD.** M1, M3, and M7 fail. M4 is degraded. M5 and the long cycle are not
testable. M6, V1-V4, and most of M7 are not run. Automated and lint-delta
gates passing cannot override the literal physical presentation failures.

## 17. Exactly one next phase

**Phase 3A.2 — WebOS Playback Surface Composition Correction.** Promote the
persistent runtime host into the intended application overlay plane without
changing playback, focus, routing, or input ownership; bind the actual
full-screen Music class to a Chrome-68-safe 1920 x 1080 layout with explicit
square-art bounds and an internally scrolling queue; add real host-plus-shell
hit-test and no-`aspect-ratio` long-queue layout coverage; then rerun the
unfinished literal-remote M1-M7, V1-V4, and long-cycle matrix on one exact
production build.

## 18. Production and ownership confirmation

Phase 3A.1 did not deploy to or modify production. Validation used only the
removable local-static WebOS application. It did not change Jellyfin playback
engines, the existing Music queue/audio element, navigation, TV focus
execution, or input ownership. This phase changed only validation evidence,
the proven lint-debt ledger, and this acceptance report.

## Final exact-build continuation — 2026-07-28

### Decision

**BLOCK**

The remaining acceptance work continued on the removable
`com.piggietv.validation` application. A physical held hidden-Right failure was
reproduced on an intermediate build: the first directional event woke the
controls, while six browser repeat events crossed into focus navigation. The
correction retained Jellyfin as the sole seek owner by using the
video-controller's already-installed capture listener. It added no listener,
playback engine, or input owner. Focused event-order coverage proves one hidden
Right plus six repeats produces seven stock seeks, zero focus moves, zero
slider handling, and no downstream duplicate command.

The resulting exact production-mode bundle used:

- source commit `44899b1fb556f4983ae2c1fa4e861d1ad0b4f4d8`;
- 36 dirty paths at fingerprint time;
- `main.jellyfin.bundle.js` at 1,563,245 bytes with SHA-256
  `8320AE8655682107692777BA8D62D74D014BBAA01B6C3648A60B0CAF0F265161`;
- one main bundle, one runtime bundle, no development client, and no
  service-worker controller.

Preflight passed with one application, one runtime, five listeners, zero
duplicate listener suppressions, zero duplicate feature registrations,
diagnostics active, and the overlay off. Physical video playback started
normally. The first physical Back from visible controls then restarted the
validation application and returned it to Home instead of hiding the controls.
The post-event document had a fresh runtime plus an empty, inactive diagnostic
buffer. The local static server and inspection tunnel remained alive, isolating
the reset to the validation application document or renderer. No recovery input
was used.

The restart destroyed the pre-event in-memory buffer, so this evidence does not
distinguish a JavaScript renderer termination from a WebOS application-document
restart. The task explicitly classifies a returning renderer termination as
BLOCK, and further physical input stopped.

Final corrected-source validation totals:

| Gate | Result |
| --- | --- |
| Focused held-seek/focus tests | 71/71 |
| Complete PTV Vitest | 119 files, 762 tests |
| Complete repository Vitest | 142 files, 968 tests |
| TV-profile Playwright | 12/12 |
| TypeScript | PASS |
| Scoped ESLint | 0 errors; one pre-existing warning |
| ESLint ledger | PASS; 302 errors and 31 warnings remain accepted legacy debt |
| Stylelint | 0 errors, 0 warnings |
| Core schemas/fixtures | 11 |
| Android contract parity | 26 models, 14 enums, 19 capabilities, 1 error code |
| Secret scan | 118,295 repository paths |
| Production build | PASS; two established size warnings |
| `git diff --check` | PASS |

Final physical status on this exact bundle:

- V1: incomplete;
- V2: incomplete;
- V3: FAIL/BLOCK at its first Back;
- V4: incomplete;
- long route cycle: not started.

Exactly one next phase is **Phase 3A.1 Renderer-Restart Attribution**: pre-arm
persistent WebOS process logging and an external crash-safe event sink, then
reproduce only video playback followed by one Back. The broader physical matrix
must not resume until that restart is attributed and corrected.

Production and all authoritative playback, navigation, focus, and input
ownership boundaries remained unchanged.
