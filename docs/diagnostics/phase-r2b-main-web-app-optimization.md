# PiggieTV Phase R2B — Main Web App Optimization Closure

Status: **APPROVE — MAIN WEB APP OPTIMIZATION**

Physical-device acceptance status: **HOLD — intentionally deferred by the
project owner**

This closure covers the product defects and startup inefficiency found while
preparing R2A. It does not count injected device input as physical-remote
acceptance, reopen playback testing, deploy production, or replace the existing
router, focus, navigation, authentication, request, cache, or playback owners.

## 1. Outcome

Three application defects were corrected:

1. Enhanced Details could mount a header-only shell after Jellyfin's Details
   page. The focus engine selected that shell as the entire page scope, which
   excluded all Season and Episode cards from the existing focus graph.
2. A partially restored WebOS server record without an `Id` could make
   `currentApiClient()` throw during top-level discovery. Startup then remained
   on the splash even though a saved address was still recoverable.
3. Legacy settings readers and the React provider independently fetched
   `config.json`. They now share one request, one success cache, and one
   transient-failure recovery path.

The final provider also suppresses the duplicate state dispatch that would
otherwise occur when the shared successful request both notified its listener
and resolved its promise.

The fixes preserve the existing owners:

- Details continues to use the one TV focus engine. A header-only shell now
  causes the engine to use the existing common body scope.
- Server discovery continues to use `ServerConnections`; it falls back only to
  the existing `window.ApiClient` when stale restored state cannot produce a
  current client.
- `webSettings` remains the single config cache. The React provider consumes
  it and subscribes only for later recovery.

## 2. Config request and recovery behavior

Concurrent `getWebConfig`, servers, themes, plugins, and React-provider readers
share one in-flight request. A successful response is cached for later callers.

A failed wave returns the bundled config without permanently caching failure.
The in-flight promise is retired, so a later caller can retry. A later success
notifies mounted providers, allowing the UI to move from bundled defaults to
the recovered live config without a second cache owner.

Live WebOS startup changed from **2 config requests to 1**. On the final build:

- the one request returned successfully;
- the splash was present at 5 seconds and gone by 10 seconds;
- the React root had four children by 10 seconds;
- the exact build ID matched at every sample;
- no runtime exception or development overlay appeared.

## 3. Source and regression changes

Application source:

- `src/ptv/core/tvFocus.ts`
- `src/utils/dashboard.js`
- `src/scripts/settings/webSettings.js`
- `src/hooks/useWebConfig.tsx`

Focused regressions:

- `src/ptv/core/tvFocus.test.ts`
- `src/utils/dashboard.logout.test.ts`
- `src/scripts/settings/webSettings.test.ts`
- `src/hooks/useWebConfig.test.tsx`

The tests cover the header-only Details composition, stale restored server
state, concurrent config deduplication, retry after fallback, provider recovery,
unsubscription, and the final duplicate-dispatch guard.

Validation-only helpers are confined to ignored `test-results/phase-r2b`.
They are not bundled application source.

## 4. Rejected candidate

Build `r2b-20260730T141456175Z-44899b1f-dirty` was rejected after device
inspection proved two `config.json` requests. It contained the initial legacy
deduplication but not the React-provider unification. It was never accepted or
deployed.

The final build below was compiled only after the provider was moved to the
shared reader, the transient-recovery subscription was added, the duplicate
dispatch was removed, and all exact-current automated gates passed.

## 5. Final frozen build

| Field | Final value |
| --- | --- |
| Build ID | `r2b-20260730T144303873Z-44899b1f-dirty` |
| Build timestamp | `2026-07-30T14:43:03.873Z` |
| Full Git commit | `44899b1fb556f4983ae2c1fa4e861d1ad0b4f4d8` |
| Embedded commit | `44899b1fb5-dirty` |
| Package/version | `jellyfin-web` / `10.11.11` |
| Mode | `production` |
| Worktree at freeze | Dirty; pre-existing user work preserved |
| Frozen files | 2,527 |
| Frozen bytes | 63,391,153 |
| Web-tree SHA-256 | `a52d7fa8944f2c9da32252abd0d4ce742e8c29d9bce8506ba4362e0c9e529b92` |
| Checksum inventory SHA-256 | `2a50cb19f2ce45a775f162831567039392b918486b52897dfee8f272abd668ac` |

Primary assets:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `index.html` | 5,379 | `d152401c7a92af203a31271ad56df520d596abd2be45aefa7a15c0e27485ed4d` |
| `runtime.bundle.js` | 48,287 | `926f3ca1eb029d60ab79e2cb394b4d8d9adfa6a4bf27601e237257d4e5079cba` |
| `main.jellyfin.bundle.js` | 1,585,550 | `4b807107405679fd7b91d9736f8ac39ff9fa83e48549307fb5646c09bb333b4b` |
| Main CSS | 782,786 | `1e16ee5016f70c8c0f17bfb44aae69662005b1a6db493ec3383e1b68699f3e10` |
| `serviceworker.js` | 912 | `8d108192a34000a536441c861b7cab5ed8d3e51c91e273d5eb719e5a8b299349` |

An independent post-freeze comparison found 2,527 matching files, identical
byte totals, zero mismatches, and the same tree hash in `dist`, the frozen
copy, and the manifest.

Bundle inventory:

- JavaScript: 27,399.0 KiB
- CSS: 2,535.8 KiB
- main JavaScript file: 1,548.4 KiB
- main CSS file: 764.4 KiB
- webpack: passed with the two known size-warning classes

## 6. Automated validation

Focused reruns overlap the complete suites and are not additive totals.

| Gate | Result |
| --- | --- |
| Focused regressions | 56 passed; 0 failed |
| Complete Vitest | 169 files; 1,161 passed; 0 failed |
| TypeScript | Passed |
| Scoped ESLint | Passed with no errors or warnings |
| ESLint debt baseline | 258 errors / 26 warnings / 33 files; no increase |
| Stylelint debt gate | 0 errors; 0 warnings |
| Standard Playwright | 55 passed; 6 expected skips; 0 failed |
| Cross-browser Playwright | 164 passed; 19 expected skips; 0 failed |
| Chrome | 55 passed; 6 skipped; 0 failed |
| Edge | 55 passed; 6 skipped; 0 failed |
| Firefox | 54 passed; 7 skipped; 0 failed |
| Production build | Passed; 2 known size-warning classes |
| ES compatibility | Passed; no matching errors |
| PTV Core contracts | 11 passed |
| Android contract parity | 26 models; 14 enums; 19 capabilities; 1 error code |
| Plugin API/cache contract | Passed at API 1 / cache 7 |
| Plugin .NET tests | 33 passed; 0 failed |
| Development-runtime marker scan | 0 matches |
| Secret scan | Passed across 118,376 repository paths |
| Scoped `git diff --check` | Passed; line-ending notices only |

## 7. Fire TV operational smoke

This was an operator-authorized injected-input smoke, not counted
physical-remote acceptance.

Before navigation:

- authentication completed through the normal Jellyfin-owned form;
- credentials were kept only in process memory;
- exact frontend and loaded-client build IDs matched;
- Fire TV and ten-foot profile markers matched;
- one runtime and one shell were present;
- no development client or error overlay was present;
- 22 selected served assets matched the frozen hashes;
- playback was not started.

The repaired boundary then completed:

| Boundary | Result |
| --- | --- |
| Shows | Passed; 89 visible cards; 0 broken visible images |
| Content chain | Ready; 7 Season candidates and an Episode were available |
| Series Details | Passed; 33 visible cards |
| Details focus graph | 66 media-card candidates; selected Season present and reachable |
| Directional path | 9 safe moves, all handled by the existing focus owner |
| Season Details | Passed; route recognized in 1.891 s and settled in 7.317 s |

Shows recognized in 2.102 seconds, produced first content in 3.987 seconds, and
settled in 9.757 seconds. Series Details recognized in 1.377 seconds, produced
first content in 1.927 seconds, and settled in 5.938 seconds. These are
validation-wrapper smoke timings, not counted physical-remote benchmarks.

Episode activation was deliberately not attempted on the final build because
the owner deferred the physical matrix. The earlier injected Episode activation
remains inconclusive and is not represented as passed.

## 8. WebOS startup and asset smoke

This was passive/inspector startup verification with no navigation input and
no authentication claim.

The final build passed:

- exactly one `config.json` request;
- exact build ID;
- splash replacement by 10 seconds;
- populated React root;
- zero runtime exceptions;
- zero development overlays;
- correct WebOS/TV profile;
- one runtime and one shell;
- no playback.

Direct network-response provenance captured 100 loaded frozen assets on the TV:

- 100 hashes matched;
- 0 hash mismatches;
- 0 failed responses;
- exact build ID matched;
- no runtime exceptions or development overlay;
- splash was absent at the final sample;
- playback remained inactive.

The removable private-HTTP wrapper did not have a service-worker controller.
That validation-origin limitation is not treated as production service-worker
acceptance or as a product failure.

## 9. Physical acceptance and remaining debt

No literal physical remote was used in this closure. Therefore:

- the R2A common physical matrix remains uncounted;
- LG authenticated route navigation and five-cycle stability remain pending;
- Fire TV Episode, full matrix, Back restoration, and five-cycle stability
  remain pending;
- physical Android TV remains unavailable;
- the original R2A decision remains **HOLD**, now by explicit owner deferral
  rather than by a newly observed optimization failure.

The optimized web application and its frozen build are ready for that later
acceptance.

## 10. Privacy, cleanup, and non-actions

The frozen manifest and final WebOS evidence are share-safe and exclude
credentials, tokens, cookies, usernames, media titles/IDs, device identifiers,
private addresses, full URLs, and local paths.

After testing:

- the Fire TV validation state was cleared and its removable wrapper was
  uninstalled;
- the Fire TV inspector forward was removed;
- the native Fire TV debug app was preserved;
- the WebOS removable wrapper was closed and uninstalled;
- only the validation-specific WebOS inspector was stopped;
- the installed WebOS production app was preserved;
- the temporary static host was stopped.

No playback, production deployment, WebOS reboot-attribution work, production
application mutation, or frozen-artifact mutation occurred.

## 11. Decision and exactly one next phase

**APPROVE the main web application optimization.**

**HOLD R2A physical acceptance until the owner resumes counted physical-remote
testing.**

Exactly one next phase: **Resume Phase R2A — counted physical-remote acceptance
against the final R2B frozen build.**
