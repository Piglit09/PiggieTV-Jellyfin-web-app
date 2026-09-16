# PTV Ecosystem State

Baseline captured: 2026-08-25 (America/Chicago)

## Audit basis

This is a read-only implementation audit of the local first-party PiggieTV/PTV repositories. Git metadata, manifests, build configuration, existing reports/artifacts, focused source entry points, and repository documentation were inspected. No source, configuration, dependency, service, database, or media changes were made; no build, test, install, Git history-changing, or network operation was run. The only new files are this requested report and `PTV_FEATURE_MATRIX.md`.

“Latest evidence” below means evidence already present on disk. It was not regenerated during this audit. A feature is not treated as implemented merely because a similarly named file exists: runtime wiring, tests, or both had to support the finding. Unverifiable details are marked `UNKNOWN`.

The Web worktree status was captured before the two requested reports were created. It initially had 2,890 untracked files; these reports add two expected untracked files to that count.

## 1. Executive summary

### Verified facts

- Nine local Git repositories were audited, plus the canonical PTV Plugin source embedded inside the Web repository.
- The active product set is PTV Web, the embedded PTV Plugin and its catalog, Android TV/Fire TV, webOS, and Android Mobile. The standalone Signup plugin/catalog, injected Jellyfin theme, and old Web checkout are legacy or superseded components.
- Jellyfin is still the practical authority for authentication, users, library visibility, media records, playback negotiation, streams/transcoding, and playback-session reporting.
- The PTV Plugin is a sidecar extension. It owns PTV profile/email state, signup/reset/invites, configurable Web home data, shared recommendation ranking, relationships, metadata enhancements/quality, reading metadata, and remote diagnostics. It does not replace Jellyfin’s user or playback authority.
- Web is the only client using most of that plugin surface. Android TV uses no `/Ptv/v1` routes; webOS only checks `/Ptv/v1/status`; Android Mobile uses the signup/reset subset and attempts one media-report route that the plugin does not implement.
- There is no verified, same-revision, ecosystem-wide beta candidate. Android TV and Mobile evidence predates their current HEAD or lacks release provenance; webOS 0.1.15 has no current physical-device acceptance record and every saved simulator acceptance report is `HOLD`.
- Authentication/session handling, home construction, playback negotiation/reporting, recommendations, diagnostics, and API models are substantially reimplemented per client. Android contract copies have a Web parity check; webOS is outside that check.

### What currently prevents an ecosystem-wide beta

1. Native-client credential/session safety is not beta-ready. Android TV stores the server, user, and access token in ordinary `SharedPreferences` while backup is enabled, and may keep a stale session after validation failure. Android Mobile stores Jellyfin access tokens unencrypted in a Room database included by its backup policy; its network policy also permits cleartext traffic and user-added certificate authorities.
2. Current release candidates do not have a common, reproducible, current-HEAD physical-device/server acceptance record. Mobile explicitly records Music, Books, and Android Auto hardware validation as blocked; webOS acceptance remains on hold; Android TV’s saved tests/lint predate HEAD and current performance is unverified.
3. The Web worktree contains 2,890 non-ignored untracked files at baseline, including operational/runtime and release-artifact areas plus `src/ptv/modules/account.zip`. Filenames indicate deployment, backup, configuration, and account-related material. Contents were deliberately not opened. This is an accidental-inclusion and release-hygiene risk.
4. The client/server contract is not closed: Android Mobile posts `/Ptv/v1/reports/media`, but no current plugin controller implements it. Other version/capability and dead-route mismatches are documented below.

### Recommended first development target

After protecting the Web worktree’s operational/untracked material, the first product-code target should be **Android TV authentication and session hardening**: secure token persistence, reject invalid saved sessions, bound Quick Connect recovery, and prove the result against the supported Jellyfin server on a physical TV/Fire TV candidate. It is the tightest cluster of P0 security and reliability defects in an otherwise broadly implemented client.

## 2. Repository inventory

| Role | Repository/path | Branch and HEAD | Baseline status | Version |
|---|---|---|---|---|
| Main PTV Web; canonical plugin source is under `src/ptv/plugin` | `C:\Users\Piggie\Documents\GitHub\Jellyfin-Web-PiggieTV` | `agent/p2-ux-user-isolation` — `71dc409532a4ea212b4bd2e36b23113d15563c10` | DIRTY: 2,890 untracked files before these reports; no tracked/staged changes | PTV Web `0.5.37`; upstream Jellyfin Web `10.11.11`; embedded plugin `0.5.13.0` |
| Published PTV Plugin catalog | `C:\Users\Piggie\Documents\GitHub\PiggieTV-Plugin-Repo` | `agent/publish-plugin-0.5.0` — `eef5e417149fba5e3b53583c67450e6e52298690` | Clean | latest catalog package `0.5.12.0` |
| Android TV / Fire TV | `C:\Users\Piggie\Documents\GitHub\PiggieTV-AndoidTV` | `agent/android-tv-playback-ui-polish` — `90fbbeff821c5aabe6ae86ae614f790b4ca4b02f` | Clean | `0.8.9` (`80999`) |
| webOS native client | `C:\Users\Piggie\Documents\GitHub\PiggieTV-WebOS` | `phase-2-ptv-interface` — `12db522b140b34a6a60d42c6a1cb5128736e6721` | Clean | `0.1.15` |
| Android Mobile | `C:\Users\Piggie\Documents\GitHub\PiggieTV-Android` | `agent/premium-recommendations-search-0.2.66` — `a0a76f126d105f3da54ae2115058cf4e6fb56132` | Clean | `0.2.68` (`26899`) |
| Superseded standalone Signup plugin source | `C:\Users\Piggie\Documents\GitHub\Jellyfin-Signup-plugin` | `main` — `5dcb84ba5dc243e356a9e2316f9621b22ce799f4` | Clean | `0.1.6` / assembly `0.1.6.0` |
| Standalone Signup plugin catalog | `C:\Users\Piggie\Documents\GitHub\jellyfin-plugin-signup-repo` | `main` — `abf3a86541c3aaf155337e6d1d2a9c1260d30005` | Clean | latest catalog package `0.1.6.0` |
| Legacy injected Jellyfin theme | `C:\Users\Piggie\Documents\GitHub\piggietv-jellyfin-theme` | `main` — `4188505dcdf64b7b72bca783c95ed4b8be142e5e` | Clean | `2.0.1` |
| Explicitly deprecated older Web checkout | `C:\Users\Piggie\Documents\GitHub\depricated\piggietv-jellyfin-web` | `master` — `b6085734d10cff9c5ba3fd43485140fed511248e` | DIRTY: 7 modified tracked and 3 untracked files | upstream package `12.0.0`; PTV release version `UNKNOWN` |

The configured workspace name `PiggieTV-Jellyfin-Android` does not exist locally; the actual mobile repository is `PiggieTV-Android`. `Piggie Migration` identifies itself as Storage Migrator and was excluded as instructed. `Rebuild-Jellyfinm-DB` has no commits or evidence establishing it as a shipped PTV component, so it was not included. Bogey Cartel and other unrelated repositories were excluded.

## 3. Repository health and status

### 3.1 PTV Web and embedded PTV Plugin

**Purpose and runtime.** A TV-first Jellyfin Web fork with the PTV shell, navigation/focus behavior, native home composition, cache and identity-scoped preferences, account/signup/email UI, recommendations, music, reading, admin tools, and browser diagnostics. It uses React 18.3.1, TypeScript 5.8.3, Webpack 5.99.9, MUI 6.4.12, TanStack Query 5.80.10, Vitest 3.2.4, Playwright 1.61.1, Jellyfin SDK 0.12.0, and `jellyfin-apiclient` 1.11.0. The declared runtime is Node 20 with npm 9.6.4 through 10.x.

The embedded plugin is .NET 9, targets Jellyfin 10.11.11 packages/ABI, and uses SQLite 9.0.11. It is the canonical plugin source; the catalog repository only publishes packages.

**Build/test/lint commands.** Existing package commands include development and production builds, build checks/analyze/report/ES checks, Vitest/full/PTV tests, Playwright/cross-browser/authenticated suites, plugin unit and contract tests, Android contract parity validation, TypeScript checks, ESLint, Stylelint, and secret scanning. The CI quality workflow combines contracts/parity, tests, type checking, lint/style, secret scan, production build, and Playwright. Plugin CI uses `dotnet test`.

**Latest evidence and artifacts.** The newest saved Playwright marker is dated 2026-08-25 and records zero failures, but it is a deterministic fixture run with no recorded live server, test count, filter, or commit. An older cross-browser marker passed on 2026-08-04. The ignored Web distribution is dated 2026-08-25 and identifies PTV Web 0.5.37, but its exact source provenance is not recorded. The embedded plugin binary metadata is 0.5.13.0 and dated 2026-08-17. There is no current, HEAD-bound result for the complete plugin/unit/type/lint matrix.

**Implemented.** Full Jellyfin login/session/Quick Connect flows; native PTV shell and home; library browse/search/details; direct play/transcode/seek/tracks; Continue Watching; local and plugin-assisted recommendations; music; reading; PTV profile/email/signup surfaces; admin metadata and library tools; browser diagnostics.

**Incomplete or blocked.** Reading enhancements and sidecar profile/email behavior depend on a compatible installed plugin and were not live-verified. The Native Home transition still retains legacy home/row paths. No current deployed Web 0.5.37 plus plugin 0.5.13 integration result exists.

**Evidence-backed debt.** The only production TODO found in the targeted PTV source is a Native Home redirect fallback that should eventually become an in-shell transition. `NativeHome`, legacy home sections, and PTV row implementations overlap. Several root/plugin responsibility documents describe older phases or versions. Three Web API helpers expose routes with no plugin controller and no external call site: `/Ptv/v1/Backdrops/Preprocess`, `/Ptv/v1/HeroBatches`, and `/Ptv/v1/ImageProxy`.

**Worktree risk.** All 2,890 baseline changes are untracked: 2,771 under `.codex-runtime`, 118 under `artifacts`, and `src/ptv/modules/account.zip`. Representative files are not ignored. The audit did not inspect sensitive contents.

### 3.2 PTV Plugin catalog

**Purpose and runtime.** Generated/catalog metadata and packaged release ZIPs for the embedded PTV Plugin. It has no independent runtime implementation.

**Commands/evidence/artifacts.** Catalog validation and package checksum generation are the meaningful release operations. Packages for 0.5.0, 0.5.11, and 0.5.12 are present. The 0.5.12 ZIP MD5 matches its manifest (`94EEF...`).

**Health finding.** The latest catalog release is 0.5.12.0 while canonical source/binary metadata is 0.5.13.0. Whether any production server already has 0.5.13 installed outside the catalog is `UNKNOWN`. There is no separate application feature or TODO surface here.

### 3.3 Android TV / Fire TV

**Purpose and runtime.** Native, zero-WebView TV client using Kotlin, Gradle 9.5, AGP 9.3.1, Kotlin 2.2.10, JVM 17, compile/target SDK 35, minimum SDK 24, Leanback, Media3 1.5.1, OkHttp, and Coil. Retrofit is declared but unused. The code uses Jellyfin 10.11-era fields, but an enforced minimum/maximum server version is `UNKNOWN`.

**PTV dependency.** No `/Ptv/v1` route is referenced. Home, recommendations, account/session behavior, diagnostics, and playback are client-local over Jellyfin APIs.

**Build/test/lint commands.** Gradle tasks include debug, beta, and release assembly, `testDebugUnitTest`, and `lintDebug`. There is no device/instrumentation suite and no repository CI workflow.

**Latest evidence and artifacts.** Existing reports dated 2026-08-17 contain 105 suites/454 tests with zero failures/errors/skips and lint with zero errors/254 warnings. They predate the 2026-08-22 HEAD. Local APKs identify 0.8.9, including beta and release outputs; tracked `dist` release material is still 0.8.6-beta.1. The latest broad saved frame report is older and records 47.1% jank; current performance versus the documented 60fps gate is `UNKNOWN`.

**Implemented.** Native login, home, movies/shows/search/details, video and music playback, direct play/transcode/seek/tracks, Continue Watching, recommendations, Jellyfin progress reporting, and beta/debug diagnostics.

**Incomplete or blocked.** Saved-session validation can preserve and start from a stale session after a failure. Quick Connect’s production path does not apply its timeout/error policy and can retry indefinitely. Profile support is limited to the active user. Reading and email/account-verification surfaces are absent. Diagnostics collection is intentionally disabled in release builds.

**Evidence-backed bugs/debt.** `SecureSessionStore` is named as secure but uses ordinary `SharedPreferences` for the token/server/user, and the manifest permits backup. Core runtime scaffolding can report ready without proving authenticated API readiness. Recovery activity, repository abstractions, Retrofit, and reader fragments are orphaned or unused. Android PTV core models are copied locally; Web’s parity check limits schema drift, but runtime ownership remains in existing app code.

### 3.4 webOS

**Purpose and runtime.** Native React/TypeScript living-room client, not an embedded Web wrapper. It uses React 18.3.1, Vite 6, TypeScript 5.8.2, Vitest 2.1.8, and a Chrome 68-compatible target. The app is designed at 1920×1080.

**Jellyfin/PTV dependency.** Documents record Jellyfin 10.11.11 on an LG 70UN7070PUA/webOS SDK 5.6.2, but runtime server-version enforcement is absent. The only PTV API call is `/Ptv/v1/status`; home, recommendations, library, and playback call Jellyfin directly or use local logic.

**Build/test/lint commands.** `dev`, typecheck plus Vite production build, typecheck, lint, Vitest, integration tests, package/inspect, install/launch/log/health helpers, simulator validation, and version checks.

**Latest evidence and artifacts.** `dist/pkgs/com.piggietv.webosnative_0.1.15_all.ipk` is present. Physical-TV evidence is for 0.1.13 and covers a remote/D-pad smoke path plus Home/Movies/Search/Shows screenshots. All saved simulator acceptance reports are `HOLD`; the latest has passing D-pad, metrics, and console checks but incomplete details-back, endurance, full-library, pointer, and render-window coverage. No current 0.1.15 hardware acceptance or HEAD-bound full unit/lint result is present.

**Implemented.** Login/session/Quick Connect; native home, browse/search/details; direct play/direct stream/transcoding, seek, track menus, and Jellyfin playback reporting; Continue Watching; music; reading browse; and local diagnostics.

**Incomplete or blocked.** Current hardware moving-video proof is missing for direct play/transcode/seek/track changes. Shows deep traversal and the full device acceptance matrix remain incomplete. Recommendations are local/narrow rather than shared PTV recommendations. Reading is a browse surface without a proven complete reader. Profiles are active-user-only; email is absent. Saved documentation lags newer Music/Reading code. The webOS status model types `apiVersion` as string/null while the plugin serializes a number, and webOS is not included in Android contract parity checks.

### 3.5 Android Mobile

**Purpose and runtime.** Native Android client derived from Jellyfin Android, with PTV-native home, login, playback, music, reading, signup/reset, Requests, and media reporting. It combines Jetpack Compose with retained Fragments/ViewBinding, Koin, Room, OkHttp/Coil, and Media3/ExoPlayer. It uses Gradle 9.5.0, AGP 9.2.1, Kotlin 2.3.21, JVM target 11, compile/target SDK 36, and minimum SDK 21. Jellyfin SDK is 1.7.1; Media3 and the Jellyfin FFmpeg package are 1.8.0.

**Compatibility.** A supported Jellyfin server range is `UNKNOWN`; connection compatibility is delegated to SDK discovery/ranking. A compatible PTV Plugin version is `UNKNOWN`; hard-coded routes have no capability/version negotiation.

**Build/test/lint commands.** Gradle debug/release assembly, `test`, Detekt, Android lint, `:app:verifyPublicBetaRelease`, and the PowerShell public-beta artifact verifier. Release packaging requires signing configuration and produces two APK flavors plus a proprietary AAB.

**Latest evidence and artifacts.** On 2026-08-22, each debug flavor recorded 137 JVM tests with zero failures/errors/skips; Detekt had no findings; proprietary-debug lint had zero errors, 130 warnings, and one hint. Release lint dated 2026-08-16 also had zero errors. Only one instrumented test exists and there is no end-to-end device/server suite. Ignored 0.2.68 APKs/AABs exist, but release outputs predate the 2026-08-17 author date of HEAD and `build/public-beta` is absent, so source/signature provenance is `UNKNOWN`. A tracked obsolete 0.0.0-dev.1 output remains.

**Implemented.** Native Jellyfin login/session restore; plugin-backed signup and emailed password reset; native home/movies/shows/search/details; Media3 direct play/direct stream/HLS transcoding, seek/tracks/recovery/Cast/reporting; Continue Watching; client-ranked video/music recommendations; broad native music; EPUB/PDF/CBZ/TXT reading; downloads; Requests WebView; issue reporting; adaptive phone/foldable/tablet layouts.

**Incomplete or blocked.** Quick Connect and deep links are explicitly unsupported. Profiles/switch-user and user-facing diagnostics/export are missing. Email support covers signup/reset, not account email status/change. Games is a placeholder. “Requested By You” is deliberately returned empty. Repository release-prep evidence says Music long sessions/codecs/background behavior, Books hardware/large-file behavior, and Android Auto/DHU are not runtime-approved. EPUB layout/CSS, CBR/RAR, MOBI/AZW, a Books offline shelf, and OPDS server-side progress are incomplete.

**Evidence-backed bugs/security/debt.** Any current-user API failure can be treated as an expired session, so transient outages may force login. `downloadToInternal` writes the value under the wrong preference key. Player selection is inconsistent between settings and native launch paths. Access tokens are unencrypted in a Room database that backup rules include. Cleartext traffic and user-added CAs are allowed; the JavaScript-enabled Requests WebView disables Safe Browsing. Native Compose paths coexist with retained WebView/session-browser/player bridges and unimplemented legacy adapter methods. Video and music duplicate progress reporting; home and recommendation logic are client-local.

### 3.6 Legacy Signup plugin and catalog

**Purpose/runtime.** A standalone .NET 9 signup/email-verification/password-reset plugin targeting Jellyfin ABI 10.11.10. It uses `/Signup/v1` and `/signup` routes. Its behavior has since been incorporated into the main PTV Plugin under `/Ptv/v1/signup/...`.

**Commands/evidence/artifacts.** Build/publish uses `dotnet`; no test project or CI evidence was found. Version 0.1.6/0.1.6.0 is packaged, and the catalog ZIP checksum matches (`EAF9...`).

**Health finding.** This is duplicated, superseded architecture. Whether it remains installed on any server is `UNKNOWN`; simultaneous installation could create competing account/email configuration and operational confusion even though route prefixes differ. Its README contains an early-use warning. No focused TODO/FIXME signal was found.

### 3.7 Legacy injected theme

**Purpose/runtime.** CSS/JavaScript customization intended for Jellyfin’s JavaScript Injector/File Transformation plugins and externally served assets. Version 2.0.1 was last built on 2026-04-14 and documentation says it was tested with Jellyfin 10.11.7.

**Commands/evidence/artifacts.** A concatenation/version-bump script and built distribution exist; there is no package-managed test/lint suite or CI evidence.

**Health finding.** No active core repository references this theme. The current Web fork owns equivalent branding/navigation behavior, so this is a legacy duplicate unless an external deployment still injects it; deployment status is `UNKNOWN`.

### 3.8 Deprecated older Web checkout

**Purpose/runtime.** An upstream Jellyfin Web checkout with local PTV theme/UI edits under an explicitly misspelled `depricated` directory. Its remote points to upstream Jellyfin rather than the current PTV fork.

**Health.** It is on `master`, package version 12.0.0, and locally dirty with seven tracked modifications and three untracked PTV files. It is hundreds of commits behind the available upstream reference. It has no PTV version authority or release evidence. This is obvious obsolete/duplicated architecture and must not be mistaken for the active Web repository.

### 3.9 Targeted TODO/FIXME and dead-code indicators

This was a targeted signal check, not an exhaustive repository-wide keyword census.

| Component | Worth-attention indicator |
|---|---|
| Web | One production TODO keeps a Native Home redirect fallback pending replacement by an in-shell transition; overlapping Native Home/legacy home-row paths are the larger architectural signal. |
| Embedded plugin | No material TODO/FIXME was found in the targeted plugin source/tests; stale responsibility/version documents are the main maintenance signal. |
| Plugin catalog | No runtime code or material feature TODO surface. |
| Android TV | The important signals are implemented-but-orphaned recovery/reader/repository scaffolding and a core runtime that can report readiness without validating API/auth state, rather than a useful keyword count. |
| webOS | No material production TODO/FIXME was found in the targeted paths; saved acceptance `HOLD` items and stale roadmap text are actionable evidence. |
| Android Mobile | Pending startup has no loading indicator; remote volume predicts rather than receives authoritative state; Cast conversion retains missing-attribute TODOs; legacy WebView player adapters contain empty stub methods. |
| Signup source/catalog | No material TODO/FIXME was found in the focused review; supersession by the main plugin is the key issue. |
| Theme | Automated test/compatibility work is absent; current deployment status is `UNKNOWN`. |
| Deprecated Web | Further TODO classification is not useful until the checkout is formally disposed; the entire tree is an obsolete duplicate. |

## 4. Current versions and compatibility

| Component | Product version | Framework/runtime | Jellyfin compatibility | PTV API/plugin relationship |
|---|---|---|---|---|
| PTV Web | `0.5.37` | React/TS/Webpack; Node 20 | upstream Web `10.11.11`; SDK `0.12.0` | Broad consumer of embedded plugin API |
| PTV Plugin source/bin | `0.5.13.0` | .NET 9; SQLite 9.0.11 | Jellyfin packages/ABI `10.11.11` | Server implementation |
| Plugin catalog | `0.5.12.0` latest | catalog/ZIP | target ABI `10.11.11.0` | One patch behind canonical source |
| Android TV | `0.8.9` (`80999`) | Kotlin/JVM 17; Android 24–35 | exact supported range `UNKNOWN`; 10.11-era API | No PTV API use |
| webOS | `0.1.15` | React/TS/Vite; Chrome ≥68 target | tested docs mention 10.11.11; no runtime guard | Status endpoint only |
| Android Mobile | `0.2.68` (`26899`) | Kotlin/JVM 11; Android 21–36 | exact range `UNKNOWN`; Jellyfin SDK 1.7.1 | Signup/reset plus unmatched media report |
| Signup plugin/catalog | `0.1.6` / `0.1.6.0` | .NET 9 | ABI `10.11.10` | Legacy standalone API |
| Injected theme | `2.0.1` | CSS/JS injection | docs say tested 10.11.7 | None |
| Deprecated Web | upstream `12.0.0` | Jellyfin Web checkout | current support `UNKNOWN` | None established |

Additional version drift: Mobile’s latest tag is 0.2.67 and its branch name says 0.2.66 while the configured app is 0.2.68. Android TV’s README says 0.8.8 Beta and tracked distribution says 0.8.6-beta.1 while the app is 0.8.9. Plugin/root documents still mention older 0.5.0/10.11.8 states in places.

## 5. Architecture and ownership map

| Concern | Practical authority today | PTV extension/client behavior |
|---|---|---|
| Authentication | Jellyfin | Every client implements its own login, token persistence, validation, and recovery UI. The plugin does not authenticate media requests independently. |
| Users | Jellyfin user records, policies, and access | Plugin signup can create Jellyfin users and keeps sidecar account records; clients display subsets. |
| Profiles | Split: Jellyfin identity; PTV Plugin sidecar metadata | Web exposes the richest profile behavior. TV/webOS only represent the active user; Mobile has no profile/switch surface. |
| Email/verification | PTV Plugin | Web exposes full account/signup flows; Mobile exposes signup/reset only; TV/webOS do not consume it. |
| Media/library access | Jellyfin | Clients query libraries/items directly. Plugin relationship results additionally respect Jellyfin visibility. |
| Playback | Jellyfin playback-info, streams/transcodes, and session APIs | Each client independently implements device profiles, source choice, player behavior, seek/tracks, recovery, and reporting cadence. Plugin does not own transcoding. |
| Home composition | No ecosystem-wide owner | Web combines client UI with plugin featured/row configuration. TV, webOS, and Mobile independently compose Jellyfin-driven rows. |
| Recommendations | Split | Plugin offers shared candidates/ranking policy to Web; all native clients use independent/local logic, and webOS coverage is narrow. |
| Metadata enhancements | Jellyfin item metadata remains canonical; PTV Plugin extends | Plugin supplies provider search, relationships/overrides, and metadata-quality/admin tools primarily consumed by Web. Native clients mostly rank existing Jellyfin fields locally. |
| Reading | Jellyfin Books/items as base | Web supplies a reader plus plugin metadata/overrides. Mobile supplies its own reader and optional OPDS. webOS is partial; TV is absent. |
| Diagnostics | Split per client; plugin has remote Web-oriented service | Web integrates the broadest remote surface. TV diagnostics are beta/debug-local, webOS is local, and Mobile has no user-facing diagnostics surface. |
| Client preferences | Jellyfin user settings plus independent local stores | Plugin settings are mostly server/admin/global, not a cross-client per-user preference service. |
| Future Channels/Live TV | Jellyfin | Web currently routes to Jellyfin Live TV/admin surfaces. Native PTV clients have contracts/placeholders at most; implemented cross-client PTV channel behavior is absent. |

## 6. PTV API compatibility findings

### Important implemented surface

The active plugin’s important `/Ptv/v1` surface is grouped as follows:

- Health/capabilities: status.
- Web home/admin: featured items, refresh, settings/reset, rows/validation/preview, tags, random, calendar, and integrations.
- Accounts: profile, email verification/resend/cancel/verify, admin health/users/backups.
- Signup: create user, verify email, password reset, settings, email test, and invites.
- Content intelligence: reading/music metadata search, reading series overrides, relationships, recommendation candidates, `/Ptv/v2/recommendations/rank`, and metadata-quality scan/results/settings.
- Operations: remote diagnostic check-ins/reports/commands/download/storage.

### Consumer coverage

| Surface | Web | Android TV | webOS | Android Mobile |
|---|---|---|---|---|
| Status/capabilities | Broad use | None | Status only | None |
| Featured/settings/rows | Yes | None | None | None |
| Recommendations v1/v2 | Yes | None | None | None |
| Relationships/reading/music metadata | Yes | None | None | None |
| Profile/account/email | Yes | None | None | Signup/reset subset only |
| Metadata quality/admin | Yes | None | None | None |
| Remote diagnostics | Yes | None | None | None |
| Media issue reports | Client helper only; no matching server controller | None | None | Posts `/Ptv/v1/reports/media` |

### Verified mismatches and gaps

1. **Missing server endpoint:** Android Mobile posts authenticated issue reports to `/Ptv/v1/reports/media`; no route/controller exists in plugin 0.5.13.0. The client explicitly maps 404/501/503 to “unavailable,” so report submission degrades rather than succeeding.
2. **Dead Web helpers:** Web exposes `/Ptv/v1/Backdrops/Preprocess`, `/Ptv/v1/HeroBatches`, and `/Ptv/v1/ImageProxy`; the plugin has no corresponding controllers and no external call sites were found.
3. **Capability-shape inconsistency:** the plugin’s safe/default status response advertises a wider feature-flag set than its typed full response. Consumers cannot assume identical capabilities for `full=false` and `full=true`.
4. **webOS type mismatch:** webOS models `apiVersion` as string/null while the plugin sends a number. There is no generated schema/runtime validation to catch future status-shape drift.
5. **Mobile success parsing:** any 2xx signup/reset response with empty or malformed JSON is treated as `ok=true`, which can mask an incompatible server response.
6. **No version negotiation:** Mobile hard-codes routes without checking plugin version/capabilities; TV has no plugin awareness; webOS only checks reachability. A compatible deployed client/plugin matrix is `UNKNOWN`.
7. **Narrow automated contract coverage:** Web has schemas and targeted plugin/Android parity checks, but there is no exhaustive route contract or live client-plugin integration suite. webOS models are excluded.
8. **Release drift:** canonical plugin source/bin is 0.5.13.0 while the local catalog publishes only through 0.5.12.0.

## 7. Known blockers

### Verified P0 blockers

- **Android TV credential/session path:** plaintext token persistence with backup enabled, stale-session continuation after validation failure, and unbounded Quick Connect retry behavior.
- **Native credential exposure:** Mobile’s unencrypted backed-up token database and permissive cleartext/user-CA network policy are unsuitable for an ecosystem beta without an explicit security disposition.
- **No current ecosystem candidate:** no single set of current-HEAD, provenance-verifiable Web/plugin/APK/IPK artifacts has passed the same Jellyfin/PTV server and physical-device matrix.
- **webOS release acceptance:** all saved simulator acceptance reports are `HOLD`; current 0.1.15 physical playback/endurance evidence is absent.
- **Mobile scoped-feature acceptance:** repository evidence explicitly blocks runtime approval for Music, Books, and Android Auto hardware paths if those features are included in beta.
- **Web release hygiene:** operational/artifact/account-related material is untracked and not ignored in the active product repository.

### Other confirmed blockers or defects

- Android Mobile’s media issue reporting has no server endpoint.
- Mobile can turn transient server/network errors into apparent authentication expiry.
- Android TV evidence predates current HEAD, and current device performance is unknown.
- Plugin 0.5.13.0 is not present in the local release catalog.
- Mobile has no Quick Connect or profiles; TV has no Reading or Email; webOS email is absent and reading/playback acceptance is partial.

## 8. Cross-project risks

### P0 — blocks ecosystem beta/reliability

| Risk | Evidence-backed impact |
|---|---|
| Native auth/session security and recovery | Tokens/backups and stale/outage session behavior can expose credentials or strand users at login. |
| Candidate provenance and physical-device validation gaps | A beta declaration would not identify one reproducible set of source revisions/artifacts that passed Web, TV, webOS, and Mobile gates. |
| Active Web worktree release hygiene | Non-ignored operational, backup, artifact, and account-named files create a high accidental-staging/distribution risk. |

### P1 — important next work

| Risk | Evidence-backed impact |
|---|---|
| API incompatibility | Mobile media reports cannot reach a current plugin endpoint; status shapes/types and permissive parsing can hide drift. |
| Plugin/source/catalog version drift | Developers can build 0.5.13 while ordinary catalog installation stops at 0.5.12. |
| Duplicated client logic | Auth recovery, home rows, recommendations, playback selection/reporting, diagnostics, and models can behave differently under the same server state. |
| Jellyfin compatibility ambiguity | TV and Mobile do not declare/enforce a server range; webOS records a tested version but does not gate it. |
| Playback/reporting differences | Four independent player/reporting implementations lack one live conformance suite; Mobile even duplicates video and music reporting internally. |
| Missing integration tests | Unit/fixture evidence cannot verify Jellyfin plus plugin plus client behavior, redirects, permissions, transcoding, or device codecs. |
| Split account/profile behavior | Web has sidecar PTV account features, Mobile has signup/reset only, and living-room clients lack them, creating inconsistent user expectations. |

### P2 — enhancement/future work

| Risk | Evidence-backed impact |
|---|---|
| Legacy/superseded repositories | Standalone Signup, injected theme, and deprecated Web checkout can be mistaken for active release inputs. |
| Transitional/dead architecture | Web home variants, Mobile WebView/player bridges, Android TV scaffolding, and dead API helpers increase maintenance cost. |
| Documentation/version drift | Several READMEs, branch names, tracked artifacts, and responsibility documents describe older behavior or releases. |
| No shared Channels/Live TV contract | Future work could become another independent per-client implementation unless ownership is decided first. |

## 9. Recommendations

Recommendations below are not claims about the current implementation.

### P0

1. Protect and inventory the active Web repository’s untracked operational/artifact material before any staging or release action; establish explicit ignore and secret-handling policy after confirming what must be retained.
2. Harden Android TV and Mobile credential storage, backup rules, network trust policy, and session error classification. Treat transient failure separately from token invalidation.
3. Produce source-bound, signed release candidates for all clients/plugin, record hashes and exact commits, and run one supported Jellyfin/PTV server matrix with physical-device direct play, transcode, seek, tracks, progress, resume, and session-recovery checks.
4. Close the webOS `HOLD` items and Mobile’s explicitly blocked Music/Books/Android Auto matrix, or remove those paths from declared beta scope.

### P1

1. Resolve `/Ptv/v1/reports/media` by either implementing and testing the server contract or removing/redirecting the client feature; define expected authorization and response schema first.
2. Align plugin source, binary, catalog, Web expectations, and compatibility metadata on one released version.
3. Publish one machine-checked PTV API contract for status, accounts/signup, recommendations, diagnostics, and reports; include Web, both Android clients, and webOS in validation.
4. Add a minimal live integration suite for login restore, signup/reset, plugin capability detection, home/recommendations, direct/transcode playback, track changes, progress/stop reporting, and logout/token expiry.
5. Decide whether native clients will consume shared plugin home/recommendation/account behavior or explicitly remain Jellyfin-direct. Test the chosen split rather than leaving it implicit.

### P2

1. Archive or clearly label the standalone Signup plugin/catalog, injected theme, and deprecated Web checkout after confirming deployments no longer use them.
2. Retire unused scaffolding, dead API helpers, obsolete tracked artifacts, and duplicate legacy player/home paths in separate, test-backed changes.
3. Reconcile version/readiness documentation with manifests and define Channels/Live TV ownership before implementation.

## 10. Recommended development order

1. **Operational prerequisite:** protect the active Web repository’s untracked operational/account/release material.
2. **Android TV auth/session hardening:** secure storage, deterministic saved-session invalidation, bounded Quick Connect, then current-HEAD physical-device proof.
3. **Android Mobile security and session correction:** token/backup/network/WebView policy, transient-vs-auth failures, followed by signed current-HEAD Music/Reading/Android Auto validation.
4. **PTV API and plugin release closure:** media-report decision, status schema alignment, plugin 0.5.13 catalog/release alignment, and cross-client contract tests.
5. **Ecosystem integration gate:** one Jellyfin/plugin fixture and reproducible client artifact matrix for auth, home, playback, reporting, and resume.
6. **webOS beta closure:** current 0.1.15+ hardware playback, long-run, pointer/D-pad, full-library, and back-navigation validation.
7. **Parity and cleanup:** profiles/email/reading gaps by product priority, then legacy repository and duplicated architecture retirement.
