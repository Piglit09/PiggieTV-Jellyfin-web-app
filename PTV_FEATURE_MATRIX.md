# PTV Cross-Client Feature Matrix

Baseline captured: 2026-08-25 (America/Chicago)

## Method and interpretation

This matrix is based on runtime wiring, focused implementation inspection, tests, and existing release/device evidence in the four active client repositories. File names alone were not accepted as proof. No build, test, server, simulator, or device run was performed during this read-only audit.

- `PASS` — implemented and supported by code wiring, tests, or existing runtime evidence.
- `PARTIAL` — a meaningful implementation exists, but scope, correctness, integration, or validation is incomplete.
- `MISSING` — no implemented user-facing capability was found.
- `UNKNOWN` — available repository evidence cannot determine the state.

`PASS` describes implementation status, not proof that the current HEAD/release artifact passed a fresh physical-device beta gate. Release-readiness exceptions are called out below and in `PTV_ECOSYSTEM_STATE.md`.

## Verified matrix

| Capability | Web | Android TV | webOS | Android Mobile |
|---|---|---|---|---|
| Login | PASS | PASS | PASS | PASS |
| Session restore | PASS | PARTIAL | PASS | PASS |
| Quick Connect | PASS | PARTIAL | PASS | MISSING |
| Home | PASS | PASS | PASS | PASS |
| Movies | PASS | PASS | PASS | PASS |
| Shows | PASS | PASS | PARTIAL | PASS |
| Search | PASS | PASS | PASS | PASS |
| Details | PASS | PASS | PASS | PASS |
| Direct Play | PASS | PASS | PARTIAL | PASS |
| Transcoding | PASS | PASS | PARTIAL | PASS |
| Seek | PASS | PASS | PARTIAL | PASS |
| Audio/subtitle selection | PASS | PASS | PARTIAL | PASS |
| Continue Watching | PASS | PASS | PASS | PASS |
| Recommendations | PASS | PASS | PARTIAL | PARTIAL |
| Music | PASS | PASS | PARTIAL | PARTIAL |
| Reading | PARTIAL | MISSING | PARTIAL | PARTIAL |
| Profiles | PARTIAL | PARTIAL | PARTIAL | MISSING |
| Email | PARTIAL | MISSING | MISSING | PARTIAL |
| Diagnostics | PASS | PASS | PASS | PARTIAL |

No cell remains `UNKNOWN` after the targeted implementation audit. Compatibility and release-certification questions that remain unknown are documented separately rather than changing an implemented feature to `UNKNOWN`.

## Evidence anchors for PASS entries

### Web

The active Web runtime wires Jellyfin authentication/session/Quick Connect, the PTV native shell/home, library and search/detail routes, Jellyfin playback source/transcode/session paths, track controls, resume rows, recommendation paths, music, and diagnostics. PTV unit/contract suites and the saved Playwright fixture result support these paths. The broad PTV API registry is in `src/ptv/core/config.ts`; the canonical plugin implementation and tests are under `src/ptv/plugin` and `src/ptv/plugin.tests`.

### Android TV

Native activities/view models and Media3 code are runtime-wired for login, Jellyfin home/browse/search/details, direct/transcode playback, seek/tracks, Continue Watching, recommendations, music, reporting, and beta/debug diagnostics. The latest saved JVM suite has 454 passing tests. This supports implementation status, but those results predate current HEAD and are not a current device-release gate.

### webOS

Native screens and API/player services wire login/session/Quick Connect, home/movies/search/details, Continue Watching, and local diagnostics. Existing 0.1.13 physical-TV evidence covers D-pad smoke navigation for Home/Movies/Search/Shows. Playback features are deliberately `PARTIAL` because current 0.1.15 moving-video/device evidence is absent.

### Android Mobile

The native runtime wires Jellyfin authentication and stored-session restore, progressive home/library/search/details, Media3 direct/direct-stream/HLS playback, seek/tracks, resume items, and progress reporting. Both debug flavors have 137 passing JVM tests in the newest saved reports. Current release artifact provenance and real-device coverage remain separate blockers.

## PARTIAL and UNKNOWN notes

### Web

| Capability | Status | Evidence/limitation |
|---|---|---|
| Reading | PARTIAL | A reader and Jellyfin Books flow exist, but enhanced provider metadata and series overrides depend on a compatible PTV Plugin; no current deployed-pair validation is recorded. |
| Profiles | PARTIAL | Jellyfin identity and PTV sidecar profile behavior are split, and the richer PTV profile behavior is Web/plugin-specific rather than ecosystem-wide. |
| Email | PARTIAL | Signup/account verification/resend/cancel/reset code exists, but compatible plugin deployment and live SMTP/delivery were not verified. |

### Android TV / Fire TV

| Capability | Status | Evidence/limitation |
|---|---|---|
| Session restore | PARTIAL | A saved session is loaded, but failed validation can leave the stale token/session active and start the app host. |
| Quick Connect | PARTIAL | The flow exists, but production retry behavior does not apply the defined timeout/error policy and may continue indefinitely. |
| Profiles | PARTIAL | The current signed-in Jellyfin user is represented; no complete profile/switch-user or PTV sidecar profile flow exists. |

Reading and Email are `MISSING`: no user-facing reading or PTV account-email flow was found. Diagnostics is `PASS` for implemented beta/debug behavior; collection is intentionally disabled in release builds.

### webOS

| Capability | Status | Evidence/limitation |
|---|---|---|
| Shows | PARTIAL | Browse/details paths exist, but the saved acceptance matrix leaves deep/full-library traversal incomplete. |
| Direct Play | PARTIAL | Source selection/player code and tests exist; current 0.1.15 physical-TV moving-video proof is absent. |
| Transcoding | PARTIAL | HLS/remux/transcode paths exist; current physical-device/server proof is absent. |
| Seek | PARTIAL | Control/reporting code exists; current hardware validation is incomplete. |
| Audio/subtitle selection | PARTIAL | Menus and selection paths exist, but native behavior is described as basic and current device proof is incomplete. |
| Recommendations | PARTIAL | Local recommendation/ranking behavior is narrow, chiefly music-oriented, and does not consume the plugin recommendation service. |
| Music | PARTIAL | A music screen/audio path exists, but saved documentation and current device acceptance do not establish complete release behavior. |
| Reading | PARTIAL | A reading browse surface exists; a complete, device-proven reading experience was not established. |
| Profiles | PARTIAL | Only the active signed-in user is represented; no full PTV profile/switch-user flow exists. |

Email is `MISSING`. All saved simulator acceptance reports remain `HOLD`; that release blocker does not erase the source-supported `PASS` entries above.

### Android Mobile

| Capability | Status | Evidence/limitation |
|---|---|---|
| Recommendations | PARTIAL | Video and music ranking is client-local; no shared/plugin recommendation policy is consumed, and “Requested By You” deliberately returns no items. |
| Music | PARTIAL | Broad native implementation and unit coverage exist, but long-session, codec, background/control, interruption, and Android Auto hardware validation is explicitly outstanding. |
| Reading | PARTIAL | EPUB/PDF/CBZ/TXT reading is wired, but real-device/large-file evidence and EPUB layout, CBR/RAR, MOBI/AZW, offline shelf, and OPDS progress support are incomplete. |
| Email | PARTIAL | Plugin-backed signup verification and emailed password reset exist; account email/status/change management does not. |
| Diagnostics | PARTIAL | Startup events and media issue reporting exist, but there is no user-facing diagnostics/export surface, telemetry is disabled, and `/Ptv/v1/reports/media` has no server implementation. |

Quick Connect and Profiles are `MISSING`: their local core declarations are not runtime implementations. There are no `UNKNOWN` Android Mobile entries; the supported Jellyfin/plugin version range and exact release-artifact provenance are `UNKNOWN`, but those are compatibility/release facts rather than feature-presence states.

## Cross-client interpretation

- Login and core Jellyfin browsing are broadly implemented, but session security/recovery is not uniform.
- Playback capability is broad in source. The major gap is shared, current physical-device evidence, especially webOS, plus consistency of device profiles and reporting across four independent players.
- Web is the only full consumer of the PTV Plugin’s home, account/profile, recommendation, metadata, reading enhancement, and remote diagnostics surface.
- Music and Reading are not yet equally release-proven. Reading is absent on Android TV; Music/Reading remain hardware-validation blockers on Mobile; webOS coverage is partial.
- Profiles and Email are not ecosystem capabilities today. They are principally Web/plugin features with only Mobile signup/reset coverage.
