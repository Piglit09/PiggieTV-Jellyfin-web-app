# PTV Core Phase 1 Architecture Audit

Status: completed before Phase 1 core implementation
Audit date: 2026-07-22
Contract target: `ptv-core/v1`

## Scope inspected

The audited repositories are:

- `Jellyfin-Web-PiggieTV`: Jellyfin Web, PiggieTV web features, the webOS
  browser profile/adapter, and the C# Jellyfin PiggieTV plugin/tests.
- `PiggieTV-AndoidTV`: the native Android TV/Fire TV application
  (`com.piggie.tv`). The directory name intentionally reflects the existing
  repository spelling.
- `PiggieTV-Jellyfin-Android`: the native Android mobile application
  (`org.jellyfin.mobile`, application id `com.piggietv.android`).

The two Android applications are separate Git/Gradle repositories, not modules
of one build. Android TV currently uses AGP 8.13.2, Kotlin 2.1, JVM 17, a
single `:app` module, and JUnit 4/Robolectric. Android mobile uses AGP 9.2.1,
Kotlin 2.3.21, JVM 11, a version catalog, product flavors, Koin, Kotlin
serialization, and JUnit 6/Kotest. A single physical `:ptv-core` module cannot
be added to both builds without introducing a new publishing/composite-build
relationship and coordinated release dependency. That is too risky for Phase
1. The safe fallback required by the task is identical platform-neutral Kotlin
contract source under the same `com.piggietv.core` package in each app, ready
for later extraction after build alignment.

The audit covered:

- `src/ptv/api`, including the Jellyfin API compatibility facade.
- `src/ptv/core`, including runtime, profile, plugin, observability, settings,
  route, lifecycle, and TV-focus helpers.
- `src/ptv/services`, including request coordination, playback state,
  diagnostics, navigation, recovery, and library normalization.
- `src/ptv/modules/cache`, `src/ptv/modules/recommendations`,
  `src/ptv/modules/books`, and representative feature modules.
- `src/ptv/shell` and stable app routes.
- Jellyfin's existing session/credential owners under
  `src/lib/jellyfin-apiclient` and `src/controllers/session`.
- PiggieTV plugin controllers, DTOs, stores, validation, and tests under
  `src/ptv/plugin`.
- Existing Vitest, plugin, E2E, build, lint, contract, and secret-scan entry
  points in `package.json`.
- Android TV API transport, native Jellyfin facade, session store, settings,
  media/playback/queue models, navigation shell, reader cache, diagnostics,
  app initialization, and unit tests.
- Android mobile Jellyfin SDK controller, Room server/user records, app
  preferences and secure Library credentials, navigation routes, Media3 queue
  and playback state, native Music/Books models and caches, app initialization,
  and unit tests.

## Current architecture

### API wrappers

`src/ptv/api/client.ts` is the main web API facade. It resolves a Jellyfin
client through `ServerConnections`, cleans queries, delegates URL creation and
authenticated transport to Jellyfin, coordinates duplicate GETs, emits
observability events, redacts bounded error bodies, and exposes compatibility
functions through `window.PTV.api`. Domain wrappers live in `auth.ts`,
`libraries.ts`, `items.ts`, `images.ts`, `search.ts`, `playback.ts`, and
`admin.ts`.

`src/ptv/core/pluginApi.ts` is a second, larger transport boundary for `/Ptv/v1`
plugin routes. It handles the authenticated Jellyfin client, availability
state, retry timing, route-specific functions, response caching, and plugin
error normalization. Several feature modules also call `ServerConnections` or
the Jellyfin playback manager directly.

### Authentication and session

Jellyfin remains authoritative. `ServerConnections`, its credential provider,
and the existing login/select-server/add-server controllers own persisted
servers, tokens, session restoration, logout, switching, and Quick Connect.
PTV's `api/auth.ts`, `startupReadiness.js`, `serverOriginSelection.ts`, and
plugin API authentication listeners are consumers/adapters. PTV must not copy
tokens into a new store or replace this lifecycle.

### Navigation

Logical route constants are in `src/ptv/core/config.ts`; menu presentation and
permissions are in `src/ptv/shell/navigation.ts`; route ownership and
normalization are split among `shell/routes.js`, `routeIdentity.ts`,
`routeController.ts`, `itemRoutes.ts`, app route tables, and the legacy
navigation service. Web routes are hash-based. TV focus/back behavior is
correctly platform-specific in `tvFocus.ts`.

### Playback

Jellyfin's playback manager and browser players remain authoritative engines.
`src/ptv/api/playback.ts` exposes convenience commands, while
`src/ptv/services/playbackStateService.ts` normalizes global playback state for
the PTV shell/media dock. Feature modules still invoke the manager directly in
places. Queue semantics also remain in Jellyfin's legacy playback components.

### Recommendations

The client recommendation engine has focused types, providers, scoring,
taste-profile persistence, row construction, debug reports, and settings under
`src/ptv/modules/recommendations`. Plugin Row Builder DTOs and featured-content
documents are separate contracts. `recommendationSettings.ts` already performs
extensive PascalCase/camelCase compatibility parsing, but the behavior is local
to that feature and its version fields are optional.

### Settings and feature flags

Runtime constants live in `core/config.ts`. User-facing web feature settings
live in `core/featureSettings.ts` under `ptv:feature-flags:v1`, with fallback
reads from older keys. Theme, diagnostics, recommendation settings, reading
settings, and plugin settings use separate stores and schemas. The feature
settings module mixes pure parsing, browser storage, DOM class application, a
global namespace, and event dispatch.

### Cache implementations

Featured content has a mature memory/plugin-backed v7 cache with TTL,
validation, semantic completeness checks, fallback behavior, invalidation, and
diagnostics. Reading has independent local-storage and memory cache versions,
keys, fallback paths, and index caches. Search, images, theme songs,
recommendation data, integrations, and request coordination maintain additional
in-memory or storage caches. There is no small common cache-envelope contract,
even though several implementations carry equivalent key/version/time/scope
metadata.

### Telemetry and diagnostics

`core/observability.ts`, its bounded buffer, the logger, performance monitor,
remote diagnostics service/transport, and `remoteDiagnosticsModel.ts` provide
substantial diagnostics. The remote-report model is explicitly versioned and
has strong redaction and size limits. Other `recordPtvEvent` call sites use
free-form categories/names/details and do not share one portable event shape.
Diagnostics are gated by existing debug/remote-diagnostics settings; that
behavior must remain.

### Media models

`api/types.ts`, recommendation types, reading types, hero types, Jellyfin SDK
models, feature-local item aliases, and C# DTOs repeat IDs, names, media types,
images, relationships, and user progress. These are not identical use cases,
so a universal media object would be harmful. Focused identity, artwork,
relationship, progress, source/quality, and recommendation metadata contracts
are the appropriate shared seam.

### Plugin/API

The plugin source is present. `/Ptv/v1` and current endpoints are explicitly
versioned. The status response exposes API/cache/plugin versions, feature
availability, and subsystem health. Featured content uses cache version 7.
Remote diagnostics uses schema version 1. Active DTOs mostly declare camelCase
JSON names, while client normalization also accepts observed PascalCase
responses. Existing endpoints and fields are public compatibility surfaces.

### Android TV / Fire TV

`JellyfinNativeApi.kt` is a native JSON facade over
`NativeHttpTransport.kt`/OkHttp. It owns URL construction, Jellyfin auth
headers, password and Quick Connect calls, media parsing, progress calls, and
diagnostic summaries. `SecureSessionStore.kt` and `NativeSession.kt` own the
persisted session shape. `NativeSettings.kt` and `ReadingSettings.kt` wrap
SharedPreferences. `NativeRoute`/`NativeRouteNavigator`/`NativePtvShell` own
native destinations and TV navigation. Media3 and app-specific queue/autoplay
logic live under `data/playback` and `services/AudioPlayerService.kt`.

The app has a rich diagnostics implementation under `diagnostics`, including
network, route, focus, image, playback, reader, memory/performance, redaction,
export, and crash reporting. `PtvDiagnosticExporter` already writes a local
schema-version-1 report. `ReaderCache` scopes files by server and user but does
not use a shared cache envelope. `PtvApplication` initializes crash and
diagnostics; session/API/settings/navigation/playback initialization remains
distributed across Activities and services.

This repository had substantial pre-existing uncommitted native reader,
playback, diagnostics, UI, and release work at audit time. Phase 1 additions
must stay in new `com.piggietv.core` files and avoid overlapping or
reformatting those changes.

### Android mobile

`ApiClientController.kt`, Jellyfin SDK operations, Room server/user entities,
and Koin modules own server and authenticated API state. `AppPreferences`,
`SecureLibraryCredentials`, feature-specific SharedPreferences stores, and
Room own settings and persistence. `LibraryRoute` and Compose/Fragment event
paths represent navigation. Media3 `QueueManager`, `PlayerViewModel`, native
Music playback/Android Auto services, notifications, and player UI own
playback.

The native Music and Books features define their own overlapping item,
playback, queue, reader, progress, source, and cache models. Kotlin
serialization readers correctly ignore unknown fields for persisted Music and
Books state. Logging uses Timber and feature-specific status records; there is
no shared PTV diagnostic event contract. `JellyfinApplication` initializes
Koin/SDK infrastructure, while feature services restore their own state. The
mobile worktree was clean at audit time.

## Existing public interfaces

The following interfaces already have callers and must be retained while
adapters are introduced:

- All exports from `src/ptv/api/index.ts`, including `PtvApiError`,
  `requestPtvJson`, `sendPtvJson`, auth helpers, item/image/search/playback
  helpers, and the `window.PTV.api` namespace.
- `createPtvPluginApiClient`, current-client helpers, plugin error contracts,
  retry/availability state, and route methods in `core/pluginApi.ts`.
- `getPtvFeatureSettings`, `setPtvFeatureSetting`,
  `PTV_FEATURE_SETTINGS_CHANGE_EVENT`, and `window.PTV.features`.
- `PTV_CONFIG`, `PTV_ROUTES`, `PTV_CACHE`, `PTV_PLUGIN_API`, and other exported
  configuration objects.
- Observability/logger/remote-diagnostics exports and their current opt-in
  behavior.
- `getPtvGlobalPlaybackState`, playback subscriptions/controls, and shell media
  dock expectations.
- Shell route/navigation exports and route registration behavior.
- Featured cache exports, cache key/version 7, plugin document shape, and
  existing fallback readers.
- Recommendation module types, engine/provider/row exports, persisted Row
  Builder settings, and casing normalizers.
- Plugin `/Ptv/v1` endpoints, response fields, status feature names, and
  camelCase plus observed PascalCase client parsing.
- Android TV `JellyfinNativeApi`, `NativeSession`, `SecureSessionStore`,
  `NativeSettings`, `NativeRoute`, `MusicQueueManager`, playback/autoplay
  models, diagnostics export schema, and their Activity/service callers.
- Android mobile `ApiClientController`, Room entities/DAOs, `AppPreferences`,
  `LibraryRoute`, `QueueManager`, `PlayerException`, native Music/Books models,
  serialized resume stores, and Koin registrations.

## Existing test coverage

- API client, item query, image, and search unit tests.
- Plugin transport authentication, error, and remote-diagnostics tests.
- Feature-settings consumers and runtime/profile/server-origin tests.
- Featured-content cache and semantic-validation tests.
- Recommendation route, settings, engine/provider/scoring/row/debug tests.
- Playback state and shell media-dock tests.
- Route identity/controller/authentication/navigation tests.
- Diagnostics model, redaction, buffer, transport, and service tests.
- C# plugin tests for featured content, diagnostics storage, release
  compatibility, reading overrides, and bounded work.
- Android TV JUnit/Robolectric coverage for authentication/recovery, server URL
  normalization, media parsing/presentation, playback negotiation and
  autoplay, music queue, reader/cache/settings, diagnostics/redaction, TV
  layout/focus, and state policies.
- Android mobile JUnit/Kotest coverage for native Music queue/playback/actions,
  Android Auto resume serialization, native Books/reader/cache behavior, and
  native signup.
- Repository scripts for frontend/plugin API and cache version compatibility,
  secrets, quality baselines, TypeScript, production builds, and E2E.

Coverage is implementation-focused; there is no machine-readable cross-platform
schema suite yet, and no single suite covers the portable contract boundary.

## Duplicated responsibilities

1. HTTP status/message/body mapping is implemented independently in the web API
   facade and plugin API facade.
2. Secret redaction exists in API errors, observability, remote diagnostics,
   reading diagnostics, and plugin sanitizers with different key sets/limits.
3. Case-insensitive field access and PascalCase/camelCase parsing are repeated
   in recommendation settings, featured cache, diagnostics transport, and
   feature APIs.
4. Cache envelopes, expiry checks, schema rejection, corruption handling, and
   scoping are implemented per feature.
5. Media type normalization and fallback item-type selection are repeated in
   recommendations, reading, home, browse, and playback presentation.
6. Route intent is represented variously as constants, href strings, pathname
   classifications, route-table objects, and feature-specific parameters.
7. Playback commands and normalized state are separate without a portable
   command/state contract.
8. Client/device detection is used directly by features even though
   `clientProfile.ts` already centralizes many signals.
9. Android TV and mobile independently define media identity, playback state,
   repeat/shuffle/queue behavior, reader progress, settings stores, HTTP
   failures, and diagnostic records.
10. Android TV uses hand-written `org.json` casing access while Android mobile
    primarily uses generated Jellyfin SDK models and Kotlin serialization, so
    cross-platform plugin response compatibility has no common adapter.

## Inconsistent contracts

- Error kinds and stable codes differ between `PtvApiError`, plugin errors,
  diagnostics failures, cache rejection strings, and playback errors.
- `timestamp`, `generatedAt`, `updatedAt`, `createdAt`, `expiresAt`, and UTC
  strings are used without one documented unit/format rule.
- Featured content uses cache version 7, remote diagnostics schema version 1,
  recommendation profile versions, and feature-specific settings versions
  without a shared `contractVersion`.
- Server and user scope is explicit in recommendation profiles but implicit or
  partial in some cache keys and diagnostic events.
- Web TypeScript typically consumes Jellyfin PascalCase item fields; plugin DTOs
  advertise camelCase JSON names; real clients have observed PascalCase plugin
  responses. Parsers must continue accepting both.
- Feature flags are currently a fixed typed object, while plugin feature flags
  are a boolean map. Unknown-field preservation and reset/migration semantics
  are not shared.
- Diagnostic events range from portable records to free-form tuples.
- User-agent/profile inference is available, but no feature-facing capability
  report exists.
- Android duration units vary by model (`ticks`, milliseconds, and Kotlin
  `Duration`), while web contracts primarily expose Jellyfin ticks.
- Android TV `HttpRequestFailure`, Android mobile `PlayerException`/repository
  exceptions, plugin errors, and web errors do not map to shared kinds/codes.
- Android initialization is distributed and not observable as one ordered
  lifecycle with critical/noncritical step results.

## High-risk areas

- Authentication/session/token storage: Jellyfin-owned and security-sensitive.
- Playback engine, queue, progress reporting, Media Session, and TV return
  behavior: timing-sensitive and widely coupled.
- Featured-content v7 cache and plugin persistence: production data continuity
  depends on fallback readers and semantic validation.
- Plugin response casing: clients have already encountered serializer casing
  differences.
- Remote diagnostics: privacy, size bounds, lease behavior, and failure
  isolation are established and must not regress.
- Route ownership and TV focus: hash navigation, legacy routes, React routes,
  overlays, and hardware input all interact.
- `core/config.ts`, `pluginApi.ts`, `observability.ts`, and reading APIs are
  large, high-fan-out modules. Phase 1 should adapt them, not relocate them.
- The working tree contains unrelated active changes and generated plugin
  binaries. Phase 1 must not overwrite or reformat those changes.
- Android TV's heavily dirty worktree overlaps most runtime subsystems. Only
  additive core files/tests and narrowly necessary build-independent wiring are
  safe in this pass.
- Android mobile playback and Android Auto are Media3/service/notification
  state machines with process-death restoration; contract introduction must
  not change those engines.
- A cross-repository Gradle dependency would couple release pipelines and must
  not be introduced without an explicit artifact ownership/versioning plan.

## Target architecture

```text
UI / pages / components
          |
feature services and compatibility facades
          |
src/ptv/core/<domain> portable contracts and focused services
          |
web/Jellyfin/webOS adapters and external APIs
```

`src/ptv/core/index.ts` is the small public PTV Core surface. New domain
directories contain framework-free interfaces, parsing, validation, redaction,
envelopes, and lifecycle orchestration. Existing high-fan-out modules remain in
place and become compatibility facades or platform adapters incrementally.
React, DOM mutation, browser playback engines, hash-router execution, TV focus,
and credential persistence stay outside the portable contracts.

Both Android repositories expose the same contract names under
`com.piggietv.core`. The initial implementation is dependency-free Kotlin so it
can compile with both toolchains. App-specific adapters remain under the
existing application namespaces. The duplicated Kotlin source is deliberate,
contract-tested, and temporary; the JSON schemas remain the canonical
cross-platform definition.

## What should be shared

- Contract version constants and result/error taxonomy.
- Focused media identity/relationship/artwork/progress/source metadata.
- Session state and auth event interfaces, not token storage.
- API request/response, timeout, cancellation, safe retry, casing, error,
  request-ID, timing, size, and redaction policies.
- Logical navigation intents and destination validation.
- Playback commands, queue mutations, normalized state, capabilities, and
  autoplay decision inputs.
- Versioned recommendation rows/items/responses and compatibility parsing.
- Settings scope/schema/migration interfaces and feature-flag access.
- Cache envelopes, scope keys, expiry/stale/version/corruption outcomes.
- Safe diagnostic event construction and metadata redaction.
- Client capability reports and capability checks.
- Observable, idempotent initialization step/result contracts.

## What must remain platform-specific

- Jellyfin credential provider, connection manager, token persistence, login,
  logout, Quick Connect UI, and server discovery.
- Browser/Jellyfin playback manager and players; Android Media3 in its owning
  repository.
- React pages/components, DOM classes, themes, image elements, and hash-router
  execution.
- webOS/TV detection fallbacks, remote input, focus graph, and embedded-browser
  compatibility work.
- Browser storage adapters, Android secure storage, plugin file storage, and
  their actual eviction mechanisms.
- Notifications, lock-screen controls, Android services/permissions, reader
  gestures, device identity implementations, and platform crash capture.
- C# controller execution, authorization attributes, stores, and serializers.
- Android SDK/Jellyfin SDK client construction, OkHttp interceptors, Room/Koin
  wiring, Activities/Fragments/Compose, Media3/ExoPlayer, Android Auto, TV
  focus/remote behavior, reader bitmap decoders, notifications, permissions,
  and platform lifecycle callbacks.

## Safe migration sequence

1. Publish `ptv-core/v1` documentation and machine-readable schemas.
2. Add framework-free TypeScript contracts and focused unit tests.
3. Add compatibility adapters for existing errors, casing, feature settings,
   cache documents, recommendations, navigation, playback, diagnostics, and
   capabilities.
4. Keep current exports, storage keys, cache v7 readers, plugin endpoints, and
   observed casing support.
5. Route new code through `src/ptv/core/index.ts`.
6. Migrate one existing subsystem at a time after targeted behavior tests:
   first API errors/normalization, then settings/cache/recommendations,
   navigation intents, and playback state.
7. Add identical dependency-free Kotlin contract models in both Android
   repositories, then adapt one subsystem per app without changing engines or
   persistence.
8. Map additive C# DTO capability/version fields in the plugin without
   requiring simultaneous client upgrades.
9. Deprecate duplicate helpers only after import/call-site searches and release
   telemetry show that compatibility paths are unused.

## Files expected to change in Phase 1

- New architecture documents under `docs/architecture`.
- New schemas and version policy under `contracts/ptv-core`.
- New focused modules and tests under domain directories in `src/ptv/core`.
- A small compatibility import/use in `src/ptv/api/client.ts` only where it can
  preserve the current public API.
- Additive plugin capability/version DTO fields and contract tests, if they can
  be applied without changing active fields or serializer behavior.
- New identical `com.piggietv.core` Kotlin contract/initialization files and
  focused tests in each Android app.
- `package.json` only for a contract validation command if no new dependency is
  needed.
- The repository's existing handoff/project-state documentation, by appending a
  scoped Phase 1 entry rather than rewriting current status.

No shared Gradle artifact, Maven publication, credential-store migration,
Media3 replacement, or Android UI/navigation rewrite is expected in Phase 1.

## Explicit non-goals

- No UI redesign or route visual changes.
- No replacement of Jellyfin authentication, credentials, playback, browser
  players, Media3, or plugin endpoints.
- No universal media mega-model and no generated application rewrite.
- No new microservice, cloud dependency, telemetry vendor, DI framework, or
  automatic mutation retry.
- No cache v7 removal, storage-key rename, or persisted-schema cutover.
- No removal of user-agent/device detection in Phase 1.
- No production deployment, server modification, credential change, or user
  data operation.
- No claim that Android/Android TV core integration is complete until their
  repositories are inspected, changed, and built.
