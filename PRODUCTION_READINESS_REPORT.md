# Production Readiness Report

## 2026-07-24 Jellyfin backend latency attribution

**Decision: HOLD.** A separate Jellyfin administrator observer ran alongside
the unchanged approved non-admin browser session. Current logs, tasks, plugins,
system storage, and database-directory presence were collected read-only.
Jellyfin is 10.11.11/X64, PiggieTV is 10.11.8.2/API v1, program data is on
fixed storage with about 145.3 GiB free, and the configured libraries include
11 network and five fixed-storage folders.

The run is substantially worse than the preceding stabilization sample:
p50/p90/p95/max time to headers is 8.909/34.906/55.436/68.615 seconds;
warm-only p50/p90 is 13.045/28.223 seconds. Warm/repeat/transport-cold pass
9/13, 12/13, and 11/13. All 68 reads over three seconds have server correlation
rows. For the 75 direct matches, median server/browser duration ratio is 1.0,
median absolute delta is 7 ms, and median response transfer is 0.7 ms.
Network transport is not the primary owner.

No current SQLite lock/busy/retry or EF/query-splitting warning occurred.
However, Jellyfin's scheduled `Optimize database` task began during the matrix
and ran for 306.7 seconds. Five requests crossing its start measured p50
65.634 seconds and max 68.615 seconds, versus a still-failing pre-task p90 of
33.744 seconds. It is strongly correlated as an extreme-tail amplifier, not
proven as the sole cause. No plugin or task was disabled and no isolation was
executed.

The administrator API cannot supply host CPU, process, memory, swap, disk
await/queue, filesystem latency, inode, or retransmit samples. Journal mode and
busy timeout also remain unavailable. Consequently the pass does not meet its
host-sampling or no-background-mutation acceptance conditions, even though no
operator mutation occurred. Production remains blocked on p90 under three
seconds, 13/13 in every pass, a clean representative playback-progress write,
physical-TV acceptance, and host-level attribution.

The exact next action is a separately approved bounded isolation window:
temporarily defer only `Optimize database`, retain the same browser account and
request contracts, activate a host observer, rerun the unchanged matrix, and
restore the original trigger immediately. The proposal is recorded only; it
was not executed.

Automated gates pass: focused 153/153, full Vitest 816/816, TypeScript, scoped
ESLint, production Webpack with two established size warnings, 10 schemas,
Android parity, frontend/plugin contract, secret scan, artifact privacy, and
Web/mobile/TV whitespace checks. No Android source changed.

## 2026-07-24 authenticated Items stabilization

**Decision: HOLD.** The same approved account completed a new privacy-safe
warm/immediate-repeat/transport-cold matrix. The frontend amplification gate is
now healthy: exact concurrent duplicates fell from 21 to zero, canonicalization
misses are zero, and peak concurrency fell from 12 to 8. The correction only
routes legacy detail and browse-directory reads through the existing in-flight
coordinator; it adds no cache, timeout, Core boundary, UI, navigation, auth,
playback, plugin, database, or Android change.

Overall time-to-headers p50/p90/p95/max are
1.390/3.644/4.464/6.978 seconds. The p90 target under 3 seconds still fails.
The warm pass measured 1.698/3.724/4.464/6.978 seconds, so warm p50 and p90
also fail.
Warm, repeat, and legitimate transport-cold each pass 12/13; TV-like browser
focus remains the sole failure, and no focus redesign was authorized. The
read-only playback-continuation scenario did not execute playback or mutate
progress.

Equivalent shared/browser/direct-listener/ApiClient requests had closely
aligned medians of 0.544 to 0.584 seconds. Direct-listener median transfer was
0.8 ms. Together with the earlier 37.016-second pre-header maximum, this
assigns the remaining delay upstream of frontend transport. It does not prove
whether Jellyfin database, storage, plugin/task, or host resources own the
tail.

Current server logs/tasks/plugin inventory returned 403 to the non-admin
account, and no host observer session was available. Database and host
correlation are therefore not observed. Historical SQLite lock/35.22-second
playback HTTP 500 and 93.39-second successful read evidence remain unresolved;
the clean current browser responses do not retire them. The browser uses the
direct HTTP listener, not a reverse proxy.

Automated validation passes: focused 257/257, full Vitest 816/816, TypeScript,
scoped ESLint, production Webpack with the two established size warnings, ten
schemas, Android parity, secret scan, artifact privacy validation, and
Web/mobile/TV whitespace checks. Production remains blocked on a same-account
13/13 result, p90 under 3 seconds, current server/host/database correlation,
representative playback-write evidence, and the independent physical-TV gates.

## 2026-07-22 physical production acceptance

**Decision: HOLD. Do not close webOS/Home P1.** The LG loaded the newly deployed production generation, and corrected shell geometry plus continuously mounted Home stability passed. Route-return Home restoration failed.

Loaded provenance is authoritative: build `10.11.11`, commit `c81c8ed516-dirty`, timestamp `2026-07-23T02:21:05.700Z`, production mode, document/API/plugin origin `.50:8096`, no service-worker controller, `PTV_WEBOS_OPTIMIZED`, platform `webos`, and both TV/webOS geometry classes. Therefore stale wrapper/service-worker adoption is not the acceptance blocker and no restart/cache-clear action was performed.

Header, 220x64 brand, centered navigation, utilities, hero metadata/actions, focus, overflow, and legacy-header checks passed. Continuous Home retained 25 rows, 19 shelves, two scrollers, 36 cards, and two actions through 100.2 seconds. One ArrowRight generated exactly one focus move.

Home -> Movies -> Back failed: after 16 seconds Home had six semantic sections, zero shelves, zero scrollers, and zero cards. The failure persisted for more than six minutes. The pre-stop physical report was preserved locally and in the plugin store with status `warning` and issue `first-shelf-missing`; diagnostics was then revoked and confirmed inactive.

Artifacts are under `test-results/webos-physical`, including the production timeline, route-return report, preserved diagnostic, and before/failed framebuffer captures. A new camera photo was not captured and remains outstanding. No implementation source, CSS, plugin, database, server configuration, timeout, or cache state changed during this acceptance run.

The webOS shell geometry correction is accepted as a sub-result, but overall Home P1 stays open until the same deployed LG restores populated shelves/cards after route return and a camera photo plus full user-operated remote/playback matrix pass. Authenticated Items latency, same-account 13/13 interactions, authoritative cold/warm discovery, and backend database-lock evidence remain separate release blockers.

## 2026-07-22 Home cache authority and physical LG persistence

**Decision: HOLD.** The Home disappearance corrective pass is implemented and its target regression did not reproduce during two controlled physical LG observations. This clears neither the complete physical matrix nor the independent authenticated/backend release blockers.

Featured cache v7 now has a shared semantic boundary. Partial, degraded, configuration-only, and ordinary empty results cannot replace populated browser/plugin cache state; intentional empty is authoritative only with explicit confirmation. Native Home also rejects stale route generations, hash mismatches, empty late aggregates, partial candidates, and section-only shells when a populated model is already committed.

The plugin's six empty section definitions were traced to configured-row refresh with `includeEmptyRows: true`. Enabled rules with zero selected candidates produced section shells despite zero hero/row items. Refresh now excludes empty generated rows, validation rejects configuration-only output, and failure retains the previous cache. This plugin change passed local tests but was not deployed to the remote server.

The LG wrapper/backend split is now explicit and physically verified: frontend `http://10.16.0.125:8082`, Jellyfin/API/plugin `http://10.16.0.50:8096`, and no `.125:8096` resource traffic. The old hosted wrapper had constructed the incorrect `.125:8096` target before Jellyfin server selection could recover it.

After a Movies-to-Home return, the development build retained one hero, 25 semantic rows, 36 cards, and 40 images at 0, 30, 60, and 95 seconds during a 100.1-second observation, with zero logger errors. The untouched `.50:8096/web/index.html` frontend independently retained the same counts and hero over 100.7 seconds. The disappearance did not reproduce in either bounded window. The LG was returned to authenticated split-origin Home. Inspector JSON and PNG artifacts are under `test-results/webos-physical`; the PNGs are not camera photos.

Automated gates pass: focused 28/28; full Vitest 95 files and 646/646 tests; plugin 31/31; TypeScript/build policy; production Webpack in 111.724 seconds with two established size warnings; plugin contract; secret scan; and whitespace validation. Scoped new-file lint is clean; legacy changed files retain documented findings on unchanged lines.

Approval remains denied until the same account passes 13/13 interactions, valid cold and warm discovery completes, representative route/playback traffic remains free of ItemFields conversion and database-lock failures, read-only backend contention evidence is resolved, and a user-operated LG remote/focus/OK/Back/playback matrix passes. No timeout was increased, no identity was substituted, and no remote production frontend, plugin, database, or server configuration was changed.

## 2026-07-22 Shared Shell/webOS Correction Result

**Decision: HOLD.** The connected LG now runs the narrow shared-shell correction from the local test deployment, and the original catastrophic brand/header geometry is no longer reproduced. This does not satisfy the complete physical or authenticated release gate.

The root cause was confirmed as a class-contract and compatibility combination. `PTV_WEBOS_OPTIMIZED` retained only `ptv-render-webos`, while shared TV geometry required `ptv-render-tv`; Chrome 68 also resolved intrinsic brand sizing and unsupported `clamp()` fallbacks differently. The fix adds the TV-tier alias and literal, min-content-safe shell/webOS dimensions without changing Home loading behavior.

Physical after evidence at 1920x1080 records an 80px header at `(66,36)`, a 220x64 brand, centered primary navigation, bounded utilities, one brand owner, zero overflow, no legacy header, and visible focus before and after one injected ArrowRight transition. The after reports contain none of `shell-brand-oversized`, `hero-content-obscured-by-shell-brand`, or `focus-not-visible`.

Both after reports retain only `first-shelf-missing`. The local Home route reported `loading=false`, `fallback=false`, `mountedRows=0`, no hero actions, and no shelf/scroller after the extended wait. Because content loading was out of scope and no post-fix camera photo exists, the physical P1 is only partially resolved.

Automated validation passes: final focused 39/39; full Vitest 629/629 across 93 files; TypeScript/build policy; scoped Stylelint; production Webpack in 81.951 seconds with established size warnings only; secret scan; and Playwright 43 passed/6 opt-in live skipped. Legacy changed-file ESLint findings remain on unchanged lines.

Deployment was local-only to the connected LG wrapper and repository-served Jellyfin test instance. No production server, plugin API/schema, cache schema, database, or user data was modified. Production still requires a populated same-device Home capture and photo, complete physical remote navigation, same-account 13/13 interactions, clean warm/cold discovery, representative clean server traffic, and backend lock/host evidence.

## 2026-07-22 Embedded LG Diagnostics Result

**Decision: HOLD.** The embedded production path now makes the signed-in physical LG runtime inspectable, superseding earlier statements that the connected device could not provide runtime evidence. It does not clear the physical gate.

The LG 70UN7070PUA (webOS SDK 5.6.2, firmware 04.64.00) loaded the current production bundle with a 1920x1080 CSS viewport, DPR 2, `PTV_WEBOS_OPTIMIZED`, and a successful diagnostics check-in. The authoritative Home report is `regression` with these fixed issue codes: `shell-brand-oversized`, `hero-content-obscured-by-shell-brand`, `first-shelf-missing`, and `focus-not-visible`.

Measured geometry is decisive: the shell header is 1920x500, the owned shell brand and image are 1077x500, and the image's intrinsic size is also 1077x500. The Home root is 1920x1215; the fixed first-shelf/scroller and shell-main selectors were absent. The server report observed before Stop matched all four codes and reached `report-generated` across seven milestones.

No CSS/layout fix was made. Reliable cascade-source attribution is unsupported, so the exact overriding rule remains unproven even though component ownership is narrowed to the shell brand image. P1 remains open until a narrowly scoped shared shell/webOS correction is deployed and the same TV produces a clean after snapshot, visible focus evidence, completed remote-key navigation, and an after photo.

Live validation also found and corrected a PascalCase plugin-response compatibility defect in the Dashboard and client command transport. Focused diagnostics tests pass 20/20, the full frontend suite passes 624/624, TypeScript passes, the plugin baseline remains 28/28 with contract checks clean, and production Webpack passes in 121.095 seconds with only established size warnings.

The final latest stored report is not the authoritative Home report: navigating to Dashboard and stopping the lease allowed a later warning-only shutdown snapshot to replace it. Future physical acceptance must request/view or download the target-route report before navigation or Stop.

Deployment was local-test-only. The remote production server was not changed. Existing release blockers remain: the same-account 13/13 interaction gate, authoritative warm and cold discovery, representative playback/server evidence without lock or conversion failures, the physical LG after-fix matrix, and the broader backend latency/database-lock investigation.

## Connected LG remains runtime-uninspectable

Status remains HOLD. The physical LG is now connected and identified as model 70UN7070PUA on SDK 5.6.2 and firmware 04.64.00. This resolves device discovery but not the physical Home root-cause investigation.

The store Jellyfin app is not exposed to Developer Mode enumeration, shell, logs, or inspector attachment. No build, service-worker, profile, DOM, CSS-winner, geometry, or focus evidence was obtained, and no source or TV state was changed.

Closing the physical P1 requires an explicitly approved inspectable-wrapper path or equivalent embedded diagnostics, followed by the same store-app physical rerun and corrected photo. All non-webOS release blockers remain active.

## Physical photo confirms shell banner escape

Status remains HOLD. The directly supplied physical LG image confirms a severe Home presentation failure and is now the authoritative visual baseline. The oversized artwork exactly matches banner-light.png, and source tracing assigns that asset to native PTVShell branding rather than to the selected media item.

The expected shell and TV rules should bound the banner, but the physical device does not. The LG remains absent from ares discovery, so loaded build, service-worker generation, profile markers, live DOM owner, winning CSS, numeric geometry, and remote focus cannot be verified. No CSS correction was attempted without this provenance.

Closure still requires the same LG, matching production bundle evidence, corrected shell/header/hero/shelf geometry, a corrected physical photo, and startup remote navigation. Items latency, database contention, and authenticated interaction blockers remain active.

## Physical LG webOS Home regression blocker

Status remains HOLD. Physical LG webOS Home is now an independent P1 blocker alongside authenticated Jellyfin Items latency. The physical report shows shell/hero/branding overlap, collapsed upper geometry, an empty lower panel, and no visible first shelf. Desktop Playwright and TV emulation cannot close this gate.

Phase 1 is blocked because ares discovery lists only the local emulator and no physical LG target. The referenced photo is not present in the supplied attachment directory. No CSS or source correction was attempted without loaded-build, service-worker, profile, DOM, CSS-winner, geometry, and focus evidence.

Closure requires the same television, a fresh matching production bundle, captured build/profile state, one correct shell, bounded hero and branding, visible first shelf, no empty lower panel, and working startup remote navigation. The authenticated interaction and database/latency gates remain active.

## Post-fix automated gate completed

The previously deferred automated validation now passes: 2 focused files and 9 tests, TypeScript/build policy with zero errors, and production Webpack in 104.624 seconds. Webpack retained only the two established aggregate asset and entrypoint size warnings.

Status remains HOLD. Automated success clears the code/build portion of the ItemFields correction but does not clear the earlier SQLite lock, authenticated 13/13 interaction, authoritative warm/cold discovery, representative clean playback traffic, or physical webOS gates.

## Clean limited ItemFields deployment sample

Status remains HOLD. A clean 8,908-line post-restart sample confirms enum-valid Fields parameters for three observed PTV requests and records no field conversion, lock, retry, HTTP 500, or error event. Five successful requests still took 1.51 to 3.24 seconds.

This is a limited positive gate, not production approval. It does not exercise playback user-data commits, sustained concurrency, the complete route matrix, authenticated cold/warm behavior, or physical webOS. The earlier SQLite lock and long read tail remain authoritative until equivalent read-only investigation and representative clean traffic address them.

## 2026-07-21 Server-log release blocker

Status remains **HOLD**. The original UserData ItemFields exception is absent from the supplied post-fix log, but 256 other invalid field conversion traces required a shared generated-enum sanitizer. That correction is implemented with a focused regression test, but no automated gate was run during this log-audit prompt.

The server log independently confirms a production blocker: SQLite user-data commit contention caused playback progress to return HTTP 500 after 35.22 seconds, and broad successful content reads took up to 93.39 seconds. These timings explain fixed-window interaction failures without proving a single root cause. Playback Reporting overlap must not be presented as causation.

Approval requires the existing automated gates, zero new ItemFields binder exceptions under representative traffic, read-only server/database/host evidence and remediation, a same-account 13/13 interaction run, authoritative warm and cold discovery, and physical webOS acceptance. Do not increase timeouts, switch accounts, disable components speculatively, or claim production readiness.

Date: 2026-07-21

## Decision

PiggieTV is **not production-ready**. The identified frontend `Items` fan-out
amplification is corrected and all local code/build gates pass, but the remote
Jellyfin server still produces release-blocking authenticated tail latency. The
unchanged 13-scenario gate passed 7 checks on the first corrected run and only 3
on the warm repeat. Physical webOS verification also remains open.

Timeouts were not increased and no backend configuration was changed.

## What was fixed

- List and Resume reads now use the existing coordinated PTV JSON boundary
  instead of bypassing it through raw `ApiClient` convenience methods.
- Exact in-flight duplicate route requests are coalesced without changing the
  endpoint, query, authorization, response, or cache contract.
- Retired Home work no longer starts its broad recommendation quality hydration
  after navigation.
- A corrected Movies trace rendered 70 cards with five list requests, zero
  duplicate contracts, zero stale Home hydration requests, and peak concurrency
  four. The pre-fix trace had 11 requests, four duplicate pairs, one 47-item
  hydration request, and peak concurrency nine.

## Remaining release blocker

Server-side timing remains highly variable and is dominated by time before
response headers. Representative corrected-run evidence includes:

| Request shape | Result |
| --- | ---: |
| Movie browse full schedule | 5.71 s median, 11.32 s p95 |
| Direct Movie card | 12.97 s maximum |
| `ApiClient` Movie browse | 8.82 s maximum |
| `ApiClient` Views | 22.03 s maximum |

Browser, direct, and `ApiClient` paths did not show a stable path-specific
penalty. The remaining cause is therefore classified as remote Jellyfin
server/host contention until logs and query plans identify a narrower layer.
The available PTV plugin source does not intercept core Jellyfin `Items` routes.

## Validation status

### Passed

- Focused tests: 10/10.
- Full unit suite: 91 files, 617 tests.
- TypeScript build check.
- Production Webpack in 90.764 seconds with two established size warnings.
- Corrected authenticated Movies fan-out trace.

### Failed or blocked

- Corrected interaction run: 7/13.
- Warm interaction repeat: 3/13.
- Cold/warm discovery rerun: blocked after reload did not restore the dedicated
  authenticated browser session; no invalid report was written.
- Physical webOS: not run.
- Broad changed-file lint: legacy `hooks.ts` baseline remains non-clean.

## Severity ledger

### P0

- Production approval denied because the authoritative interaction gate is not
  13/13.

### P1

- Authenticated Jellyfin request tails still exceed existing interaction bounds,
  including a 22-second Views request.

### P2

- Physical webOS navigation, focus, back-stack, and playback validation remains
  unavailable.

### P3

- Production Webpack retains its two known aggregate size warnings.

## Evidence and next step

The complete matrix, root-cause split, artifacts, and safe next actions are in
`ITEMS_PIPELINE_REPORT.md`. Reauthenticate the same dedicated account, collect
read-only Jellyfin host/log/database timing evidence, then require 13/13
interactions plus valid cold/warm route reports. Do not approve database,
plugin, proxy, mount, or server changes without an explicit rollback plan.
## 2026-07-21 ItemFields compatibility update

Decision remains **NOT PRODUCTION-READY**.

- Reauthenticated interaction results improved to 12/13 twice, but the required 13/13 result was not achieved.
- The first warm discovery passed 22/23; only Preferences missed required content inside the unchanged observation window.
- Later cold/warm reports showing broad horizontal overflow are invalid for release comparison because an invisible Webpack Dev Server overlay iframe alone caused the width delta. A clean cold retry then lost authentication on reload.
- Jellyfin logs prove that `Fields=...UserData...` is invalid for this server's `ItemFields` enum. PiggieTV request-field definitions have been corrected to omit that token while preserving normal user-data response behavior.
- The compatibility correction is not yet authenticated or physically validated. Do not approve release until the same account produces 13/13 interactions, clean cold and warm route passes, no repeated `ItemFields` conversion exception, and completed physical webOS acceptance.
## 2026-07-21 Post-correction gate result

Decision remains **NOT PRODUCTION-READY**.

- Live traffic validates that the corrected frontend no longer serializes `UserData` in `Fields`: 0 invalid tokens across 44 observed recent `Items` requests.
- The unchanged interactions passed 11/13, then 5/13 on a 222.9-second warm repeat. Required result: 13/13.
- Clean warm discovery passed 21/23. Reading Books had six functional failed requests and Preferences missed required content; all responsive profiles passed.
- The final cache-disabled cold reload prevented the dev-overlay artifact but did not restore the same account within 30 seconds, so no authoritative cold report exists.
- No post-edit unit/type/build gate was run, and physical webOS validation remains absent.

Approval still requires clean automated gates for the final source, same-account
13/13 interactions, clean cold and warm route matrices, confirmation that the
server no longer logs the `ItemFields` conversion exception, and physical webOS
acceptance. Timeout inflation and identity substitution remain prohibited.
