# PiggieTV WebOS Phase 3A.1R.1 playback reboot isolation

Date: 2026-07-28 UTC

Decision: **BLOCK - NATIVE/PLATFORM REPRODUCED**

Experiment A reproduced a full WebOS platform reboot during video playback
without renderer injection, CDP, Web Inspector, browser mutation, or input
after playback started. An allowed external process/resource query remained
active every five seconds. The initiating trigger is unresolved, and no
application correction is justified.

The prescribed native/platform label is a decision category. It does not prove
that the native decoder, media delivery path, firmware, power system, thermal
system, renderer, or application JavaScript caused the reboot.

## 1. Approval and risk acknowledgment

The operator explicitly continued the destructive-risk experiment after being
warned that the television might reboot. The operator used the physical LG
remote to start one video and reported no further input. When the operator
reported `Tv rebooted`, Experiment A stopped immediately. The validation
application was not relaunched and no additional playback trial was run.

## 2. Exact build identity

| Property | Counted Experiment A value |
|---|---|
| Git commit | `44899b1fb556f4983ae2c1fa4e861d1ad0b4f4d8` |
| Package version | `10.11.11` |
| `index.html` SHA-256 | `9187f5ba5c1ac71abff98e7eab0a550fd59ca63305de8465c7b6e47ed2d2f5fc` |
| `runtime.bundle.js` SHA-256 | `93ce794233526fc506b6cf58777397ea22f203b9387f808caad8912150656043` |
| `main.jellyfin.bundle.js` SHA-256 | `8320ae8655682107692777ba8d62d74d014bbaa01b6c3648a60b0caf0f265161` |
| Validation app | removable `com.piggietv.validation` 1.2.0 |

All three required artifact hashes matched before launch and again after
recovery. The working tree was already dirty, so these three hashes, rather
than Git commit alone, are the effective retained identity. The phase did not
create a full lazy-chunk tree manifest.

## 3. Instrumentation absence proof

Confirmed absent:

- injected document observer;
- event sink client;
- heartbeat;
- Back-path or lifecycle observer;
- response or browser-script injection;
- CDP, Web Inspector, or renderer target attachment;
- DOM inspection or JavaScript evaluation;
- developer-channel key input or synthetic input;
- automatic reload or relaunch.

The static server used direct file-byte streaming. Its reviewed helper hash was
`8b8d4c66f9bd18a0bb033eda2ac424ae95633563fb221846a16cd8a293e6cb81`;
the served index hash matched and contained no attribution marker.

One allowed renderer-external WebOS process/resource query ran every five
seconds. Therefore, the result excludes the injected observer and CDP as
required causes, but it does not exclude every possible interaction or
probability effect from external resource polling.

## 4. Device and pre-run uptime

| Property | Value |
|---|---|
| Television | LG 70UN7070PUA |
| WebOS | 5.6.2 |
| Firmware | 04.64.00 |
| Board/profile | K6LP_ATSC_US / TV |
| Pre-run uptime | 3,483.57 seconds |
| Pre-run observation | 2026-07-28T05:19:40.717Z |
| Network | available |
| Validation app before launch | installed, not running |
| External input state | not observed |

One setup-only launch was stopped before video playback after an incorrect
listener-readiness interpretation. It is retained separately and is not a
counted experiment.

## 5. Media-path category

Static source establishes that Jellyfin Web's HTML5 video element was used.
This does not establish a hardware-decoder path.

| Category | Result |
|---|---|
| Renderer surface | HTML5 video element |
| Direct play / direct stream / transcode | unknown |
| Video codec | unknown |
| Audio codec | unknown |
| Container | unknown |
| Resolution | unknown |
| Frame rate | unknown |
| HDR/SDR | unknown |
| Subtitle state | unknown |
| Duration class | unknown |
| High-bit-depth decode | unknown |
| Hardware/native decoder path | unknown |

The bounded, read-only server-log review exposed no safe per-playback fields
that could prove these categories. No media title, ID, filename, URL, or
playback-session identifier was retained.

## 6. Experiment A timeline

All times are UTC.

| Event | Time / duration |
|---|---|
| Application launch succeeded | 2026-07-28T05:20:40.893Z |
| Operator visually confirmed video playing with controls visible | 2026-07-28T05:23:51.868Z |
| Last healthy external process sample | 2026-07-28T05:25:22.000Z |
| Derived new platform boot | 2026-07-28T05:25:39.925Z |
| Developer channel connection reset recorded | 2026-07-28T05:26:17.763Z |
| Read-only uptime probe unreachable | 2026-07-28T05:27:04.094Z |
| First successful recovery probe | 2026-07-28T05:28:11.955Z |
| Launch to derived reboot | 299.032 seconds |
| Video confirmation to derived reboot | 108.057 seconds |
| Last healthy sample to derived reboot | 17.925 seconds |

The reboot occurred before the ten-minute minimum. The terminal-reboot safety
rule required the phase to stop rather than continue or repeat the run.
Controls remaining visible and the absence of further input are
operator-reported; their later markers preserve ordering but do not invent
exact observation timestamps.

## 7. External process/resource observations

- One application PID was observed.
- 56 five-second samples were retained.
- RSS was 85,736 KB in the first sample and 222,824 KB in the last.
- Maximum observed RSS was 237,100 KB.
- Maximum observed CPU was 61.09%.
- The last healthy sample preceded the derived new boot by 17.925 seconds.

RSS and CPU alone do not prove OOM, resource kill, decoder failure, or any
other cause.

## 8. Network and app-presence observations

The validation app was absent before launch, present after launch, became
unobservable when the developer channel reset, and was absent after platform
recovery. Network/developer connectivity was available at the last healthy
sample, then reset, then was unreachable, and later recovered.

The static host and validation workstation remained available. This sequence,
combined with post-recovery uptime, proves a platform restart rather than only
an application route change.

## 9. Post-run uptime result

The first recovery probe measured 152.03 seconds of uptime at
2026-07-28T05:28:11.955Z. A confirmation probe measured 206.77 seconds at
2026-07-28T05:29:07.322Z. Both independently derive a new platform boot near
05:25:40Z and are consistent within normal probe and rounding tolerance.

## 10. Full platform reboot proof

**Proven.** The proof combines:

- a final healthy application-process sample;
- developer-channel and network loss;
- visual operator report of the television rebooting;
- two consistent low post-recovery uptime values;
- validation application absence after recovery.

The evidence proves that the full WebOS platform rebooted during video
playback. It does not identify the initiating mechanism.

## 11. Experiments B and C

- Experiment B, CDP only: **not run by design**.
- Experiment C, observer only: **not run by design**.

Experiment A reached the terminal A1 outcome. The safety protocol prohibited
automatically running B, C, or another A trial.

## 12. Proven facts

- The three required retained artifacts matched before launch and after
  recovery.
- The removable validation app served the static bundle without renderer
  injection.
- No CDP, Web Inspector, passive observer, sink, heartbeat, browser mutation,
  developer input, or synthetic input was present.
- The operator reported zero input after playback began.
- The app process remained externally observable shortly before connectivity
  disappeared.
- Post-recovery uptime proves a full WebOS platform reboot.
- Injected observer and CDP instrumentation are not required for the reboot to
  occur.
- No production deployment or application ownership change occurred.

## 13. Rejected or unproven causes

The following remain unproven:

- application JavaScript fatal failure;
- renderer crash;
- renderer or application resource kill;
- OOM;
- native decoder crash;
- firmware fault;
- thermal or power event;
- direct-play, direct-stream, transcode, HLS, or container fault;
- codec, HDR, high-bit-depth, subtitle, or audio-path fault;
- external resource-monitor interaction.

This single clean reproduction establishes possibility, not frequency or
determinism.

## 14. Evidence inventory

The frozen evidence root is
`test-results/webos-phase3a1r1-20260728-051424Z/`.

Required artifacts are present:

- `README.md`;
- `phase-summary.json`;
- `artifact-inventory.json`;
- `privacy-scan.json`;
- counted Experiment A build, device, monitor, uptime, run, launch, operator,
  resource, session, and static-delivery records.

The inventory contains SHA-256 and size for every retained evidence file
except its own self-referential hash. The setup-only aborted launch is clearly
separated from counted Experiment A.

## 15. Privacy and validation results

Privacy scan: **PASS**.

The evidence contains no private network address, raw URL, title, filename,
media/user/device/session identifier, username, absolute path, raw command
line, token, cookie, credential, boot identifier, or raw key code. Generated
validation correlation values, artifact hashes, the validation app package,
and one application PID are explicitly allowlisted safe values.

Validation commands:

| Validation | Result |
|---|---|
| Evidence schema, privacy, build identity, reboot proof, and inventory hash validator | PASS |
| Attribution harness tests | 25/25 PASS |
| Scoped ESLint for the evidence validator | PASS |
| Repository secret scan | PASS; 118,308 repository paths scanned |
| Exact bundle hash parity | 3/3 PASS |
| `git diff --check` | PASS; line-ending conversion warnings only |

## 16. Decision

**BLOCK - NATIVE/PLATFORM REPRODUCED**

Operational interpretation: a full WebOS reboot reproduced during video
playback with the renderer observer and CDP absent. The exact initiating
trigger remains unresolved. No application source correction is justified by
this experiment.

## 17. Exactly one next phase

**WebOS native media-path isolation**

Use controlled codec/container/direct-play/transcode comparisons, one
potentially rebooting run at a time, with explicit owner approval before each
run. The first run should establish a low-complexity SDR H.264/AAC direct-play
baseline if a privacy-safe test item is available; later comparisons remain
inside the same phase and must change only one media-path dimension at a time.

The upstream WebOS repository confirms that the app is primarily a wrapper
around server-provided Jellyfin Web, so playback investigation belongs at the
Jellyfin Web/player and platform media boundary:

- [Jellyfin WebOS repository](https://github.com/jellyfin/jellyfin-webos)
- [WebOS playback crash report #339](https://github.com/jellyfin/jellyfin-webos/issues/339)
- [HLS segment-stall report #327](https://github.com/jellyfin/jellyfin-webos/issues/327)
- [fMP4-HLS seek/resume report #279](https://github.com/jellyfin/jellyfin-webos/issues/279)
- [Dolby Vision resume report #343](https://github.com/jellyfin/jellyfin-webos/issues/343)

Those reports motivate direct-play, HLS/transcode, audio-transcode, HDR, and
Dolby Vision comparison dimensions. They do not prove that any of those paths
caused this television's reboot.

## 18. Production and ownership boundaries

Production was not deployed, restarted, reconfigured, or modified. No
playback, input, Back, focus, route, navigation, storage, session, or other
product source was changed in Phase 3A.1R.1. The only repository additions are
this diagnostic report and a validation-only evidence checker. Temporary
validation helpers were stopped after recovery.
