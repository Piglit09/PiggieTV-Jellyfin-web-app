# PiggieTV WebOS Phase 3A.1R renderer-restart attribution

Date: 2026-07-27 local / 2026-07-28 UTC

Decision: **BLOCK**

Final classification: **H — full WebOS platform reboot during no-Back video
playback; initiating trigger unresolved**

The first physical Back did not restart the application. In all three isolated
physical runs, exactly one Back reached the existing TV focus manager, the
`video-controls` owner consumed it, the controls hid, and video continued in
the same document. The required no-Back control later reproduced the terminal
failure and post-recovery uptime proved that the television's WebOS platform,
not only the application renderer, had rebooted.

No Back, focus, playback, route, or production source correction was made.
Changing Back ownership would contradict the captured evidence.

## Scope and safety

This investigation used only the removable validation application and the
exact retained static bundle. It did not:

- deploy to or change production;
- test Music or the broader route cycle;
- alter playback, focus, input, route, or navigation ownership;
- emit authentication data, private origins, media metadata, or user data;
- install a second Back handler;
- restart the TV or application intentionally during a counted run.

The temporary observer was passive. It recorded the existing key decision path
but did not prevent default, stop propagation, navigate, hide controls, exit
playback, or move focus. The local sink accepted an allowlisted,
category-only schema and synchronously retained bounded events outside the
renderer.

## Exact build and device identity

All seven counted runs used one build identity:

| Property | Value |
|---|---|
| Git commit | `44899b1fb556f4983ae2c1fa4e861d1ad0b4f4d8` |
| Worktree at capture | dirty, 37 status entries |
| Package version | `10.11.11` |
| `index.html` SHA-256 | `9187f5ba5c1ac71abff98e7eab0a550fd59ca63305de8465c7b6e47ed2d2f5fc` |
| `runtime.bundle.js` SHA-256 | `93ce794233526fc506b6cf58777397ea22f203b9387f808caad8912150656043` |
| `main.jellyfin.bundle.js` SHA-256 | `8320ae8655682107692777ba8d62d74d014bbaa01b6c3648a60b0caf0f265161` |
| Validation application | removable validation app only |
| Television | LG 70UN7070PUA |
| WebOS | 5.6.2 |
| Firmware | 04.64.00 |
| Board/profile | K6LP_ATSC_US / TV |
| Official CLI | `@webos-tools/cli` 3.2.5 |

The observer was injected only into validation responses. It did not change
the retained production bundle hashes.

## External evidence boundary

Before launch, the investigation armed:

- a local-only, privacy-safe event sink;
- a one-second document heartbeat;
- document-generation tracking;
- existing Back-path observation;
- Chrome inspector target and disconnect observation;
- WebOS application-presence polling;
- application process CPU and RSS sampling;
- supported post-reboot system and uptime inspection.

Every event used a monotonic sequence, a generated validation correlation
value, relative time, document generation, safe category, safe state, and
allowlisted primitive measurements. Raw URLs, private addresses,
authentication values, titles, media/user/device identifiers, browser storage,
and response bodies were excluded.

## Physical reproduction results

| Run | One physical Back result | Post-Back proof | Result |
|---|---|---|---|
| P1 | Sole owner `video-controls`; consumed; controls hid; playback continued | Same generation and PID for 135.455 s; 102 heartbeats; no error, unload, app absence, or inspector loss | PASS |
| P2 | Same single-owner consumed path | Healthy for 165.556 s and 146 heartbeats; a separate delayed application relaunch began 166.787 s after Back | PASS for first-stage Back; delayed lifecycle event retained separately |
| P3 | Same single-owner consumed path | Same generation and PID for 194.896 s; 181 heartbeats; no error, unload, app absence, or inspector loss | PASS |

Each physical event was trusted, non-repeat, and non-duplicate. In each run:

- the focus manager reached the visible video-controls branch;
- `defaultPrevented` and propagation-stopped were true on completion;
- no document-bubble owner acted;
- no `inputManager` Back command acted;
- no playback-exit or route action followed the event;
- the final heartbeat retained one runtime and five observer registrations.

Run P2's later event was not temporally or causally part of the first-stage
Back action. The application remained healthy for more than 165 seconds after
the controls had already hidden.

## Required control results

| Control | Input and observation | Result |
|---|---|---|
| C1: controls visible, no Back | Video remained active for 223.419 s after the marker; same document and PID; no lifecycle, error, app-absence, or inspector-loss event | PASS |
| C2: controls hidden, no Back | Zero Back events. The app disappeared, all TV network/developer channels became unreachable, and the visible input returned to the external device | **FAILURE REPRODUCED WITHOUT BACK** |
| C3: non-playback physical Back | The app remained idle and stable for 336.367 s, then one physical Back was consumed by `route-history` and moved Movies to Home in the same document | PASS |
| C4: developer-channel Back | One diagnostic key pair followed the same `video-controls` path; controls hid and playback continued for 67.933 s | PASS, diagnostic only |

Developer-channel input does not count as physical acceptance.

## Proven WebOS reboot

In C2, the last renderer heartbeat showed the original document, active video,
and continued playback. There was no Back input and no normal page lifecycle
sequence. External application polling then timed out, the inspector connection
closed abnormally, and the entire TV network/developer channel disappeared.

After the TV returned, WebOS reported 675.92 seconds of uptime at
04:32:51 UTC. That derives a platform boot at 04:21:35.080 UTC:

- 8.615 seconds after the last renderer heartbeat;
- 2.304 seconds before the external heartbeat-timeout observation.

The validation application was no longer present after boot and the TV's
network address had changed. Together, these observations prove a complete
WebOS platform reboot rather than an application-only route navigation,
document reload, or isolated renderer replacement.

The developer account could not retrieve a previous-boot journal, pstore,
last-kernel message, coredump directory, or retained crash/kill reason.
Current-boot inspection contained no evidence that could identify what
initiated the reboot.

## Back ownership trace

The observed physical path was:

```text
physical Back
  -> browser capture
  -> normalized Back
  -> TV focus manager
  -> active playback scope
  -> visible player-controls branch
  -> existing controls hide request
  -> event consumed
  -> playback continues in the same document
```

The existing source agrees with the trace:

- WebOS key 461 is normalized to Back in
  `src/scripts/keyboardNavigation.js`.
- The TV focus manager's owned-key method calls `preventDefault()` and
  `stopImmediatePropagation()`.
- The visible-video-controls branch records `video-controls` only after the
  existing playback Back handler accepts the controls-hide request.
- The application exit/platform-Back tail is not reached by the consumed
  event.

There was no second application owner, delayed second Back handler, browser
history Back, playback teardown, or unconsumed platform Back in any physical
run.

## Classification

| Candidate | Finding |
|---|---|
| A. JavaScript navigation/reload | Rejected as the physical-Back mechanism. All physical Back runs stayed in document generation 1 with no unload or navigation. |
| B. Uncaught JavaScript fatal failure | Rejected. No window error, unhandled rejection, or correlated JavaScript exception was captured. |
| C. WebOS application lifecycle restart | Observed only as a delayed event in P2. It was not caused by the completed Back action and does not explain C2's full platform loss. |
| D. Renderer crash | Not proven. There was no `targetCrashed` or explicit renderer-crash reason. P2 had an orderly target close; C2 lost the complete TV platform. |
| E. Renderer resource/OOM kill | Not proven. Native process RSS grew during video playback, but no memory-pressure, OOM, or kill reason was available, and a physical run survived at a higher RSS than the rebooting control. |
| F. App-manager relaunch | Observed after the delayed P2 close, but no evidence links it to Back. |
| G. Unintended Back close/reopen | Rejected. One owner consumed the event in every physical run, and C2 reproduced the failure with no Back. |
| H. Another exact mechanism | **Selected. A full WebOS platform reboot occurred during no-Back video playback. The initiating reboot trigger remains unresolved.** |

## Process and resource observations

P2's original application PID grew to 242,396 KB RSS before the delayed
application replacement while the measured JavaScript heap remained roughly
18–21 MB. P3 remained healthy at a higher 295,508 KB RSS. C2's last sampled
RSS was 208,680 KB, with a run maximum of 220,920 KB, before the platform
reboot.

This pattern makes a fixed JavaScript-heap limit or fixed observed-RSS threshold
unlikely. It is consistent with a playback-associated native allocation path,
but it does not prove an OOM or resource kill.

Static inspection shows that WebOS uses the native video path, does not use
the hls.js buffering path, and creates its video element with `preload="auto"`.
Native media/network/decoder allocation is therefore a focused hypothesis for
the next experiment, not a cause established by this phase.

## Correction decision

No application correction was made.

The proven Back branch is single-owner, consumed, and repeatable. Editing it
would neither explain nor correct a no-input platform reboot. The initiating
platform reboot cause cannot safely be corrected until an observation boundary
separates native playback instability from validation instrumentation.

## Evidence inventory

The frozen evidence root is:

`test-results/webos-phase3a1r-20260728-032828Z/`

Its `phase-summary.json` is the machine-readable result and `README.md` is the
human index. Counted summaries are:

- `run-01/run-summary.json`
- `run-02/run-summary.json`
- `run-03-physical/run-summary.json`
- `control-01-visible-no-back/run-summary.json`
- `control-02-hidden-no-back/run-summary.json`
- `control-03-nonplayback-physical-back/run-summary.json`
- `control-04-developer-back/run-summary.json`

The preliminary `run-03` and `run-03-inspector-prearm` directories are
supporting pre-arm evidence and are not counted.

The temporary validation app was closed after the final evidence boundary.
The local sink and watcher are not production services and remain removable.

## Harness validation

- Attribution harness tests: **25 passed, 0 failed**
- Scoped ESLint: **passed with 0 warnings and 0 errors**
- `git diff --check`: **passed**
- Evidence privacy scan: no retained raw URL, private address, credential,
  private user/media/session value, local username/path, or boot identifier
- Cross-run identity: all seven counted runs used the same commit and three
  bundle hashes

The workspace contains unrelated, pre-existing Phase 3A changes. This
attribution pass did not revert or rewrite them.

## Remaining defect and exactly one next phase

The remaining blocking defect is a full WebOS platform reboot associated with
sustained video playback. The initiating platform, native-media, firmware,
resource, or instrumentation trigger is unresolved.

**Next phase: WebOS no-instrumentation playback reboot isolation.**

With owner approval, run the same one-video, no-input duration once using only
the external process/resource monitor and pre/post uptime proof: no injected
observer, no event sink, and no CDP attachment. If the TV reboots, validation
instrumentation is excluded and investigation can move to the native
media/WebOS boundary. If it remains stable, split one CDP-only run from one
observer-only run. This phase may intentionally expose the TV to the already
observed reboot condition and must not start without explicit approval.

Phase 3A.1R remains **BLOCK**. The broader video and long-cycle matrix must not
resume, and production remains unchanged.
