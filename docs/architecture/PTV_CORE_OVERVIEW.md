# PTV Core Architecture Overview

PTV Core gives cross-platform behavior one documented contract while allowing
each application to use its native runtime, UI, storage, networking, and
playback engine. It is an incremental boundary around working systems, not a
replacement application framework.

## Contract-first architecture

The canonical wire contract is `contracts/ptv-core/v1`. Human-readable behavior
is specified in `PTV_CORE_CONTRACTS.md`. TypeScript, Kotlin, and C# implement
the same names, enum meanings, timestamps, error categories, scoping, and
compatibility rules in platform-native code.

The schemas are intentionally focused. Media identity, artwork, relationships,
progress, sources, quality, and recommendation metadata are separate concepts.
PTV Core does not introduce a universal object carrying every field used by
every UI.

## Dependency direction

```text
UI / pages / Activities / Compose
                  |
feature services and compatibility facades
                  |
PTV Core contracts and focused services
                  |
platform adapters / Jellyfin SDK / storage / playback engines
```

Core contract modules do not import React, DOM components, Android UI,
Activities, Media3, or C# controllers. Platform adapters implement core
interfaces and translate to existing systems.

## Platform adapters

- Web adapters use Jellyfin `ServerConnections`, the current PTV API/plugin
  facades, hash routes, browser/Jellyfin playback, local storage, and existing
  diagnostics opt-in behavior.
- webOS continues using the web core with its render/input/playback capability
  adapter and existing device-detection fallback.
- Android TV adapters use its native OkHttp/Jellyfin facade, session store,
  SharedPreferences/file caches, native shell, Media3, service, and D-pad focus
  systems.
- Android mobile adapters use the Jellyfin SDK, Room/Koin session state,
  preferences/secure credentials, Compose/Fragment navigation, Media3/Android
  Auto, notifications, and existing caches.
- The plugin exposes additive capability/version metadata while retaining
  `/Ptv/v1`, current fields, and casing compatibility.

## Logout ownership

Logout is an action, not a PTV route and not a PTV Core authentication service.
PTV Web controls may adapt the stock Jellyfin `Dashboard.logout()` action and
deduplicate overlapping UI activations, but they must not clear credentials,
publish session events, select a server/login destination, or implement a
replacement token/session lifecycle.

The authoritative chain is:

```text
PTV action -> Dashboard.logout() -> ServerConnections.logout()
           -> per-server ApiClient.logout()
           -> localusersignedout + stored credential clearing
           -> Jellyfin query/view reset
           -> selectserver or login
```

Jellyfin's stock toolbar and legacy drawer call the same `Dashboard.logout()`
owner directly. PTV's native shell and sidebar close their own transient menu
state, then call a shared in-flight adapter around that owner. Failure leaves
routing unchanged and releases the guard for retry. There is deliberately no
`#/logout` compatibility route, and PTV's authentication-route classifier
recognizes only the real Jellyfin login-flow destinations.

The Android repositories currently cannot share one physical Gradle module
safely. Phase 1 therefore keeps identical dependency-free
`com.piggietv.core` contracts in each app. The JSON Schemas prevent those
copies from becoming independent designs. Phase 1.5 adds a normalized-manifest
CI validator: it parses both Kotlin sources, emits build reports, compares
models/fields/types/nullability/serialized names/enums/errors/capabilities, and
checks required fields against `contracts/ptv-core/v1`. Raw byte equality is
not the enforcement mechanism.

## Initialization lifecycle

Core initialization is an observable ordered pipeline:

```text
environment -> device identity -> session -> settings -> cache
            -> API -> diagnostics -> navigation -> playback -> ready
```

Each step reports success, degraded operation, failure, or skip. Authentication
failure requests login. Cache corruption and diagnostics failure degrade
without crashing startup. Initialization is idempotent and concurrent callers
share the same run so hot reload or repeated Android lifecycle entry does not
install duplicate listeners/services.

Phase 1.5 makes this lifecycle active. Web enters from `core/app.js`; Android
mobile enters from `JellyfinApplication` and `MainActivity`; Android TV enters
from `PtvApplication` and its Activity lifecycle callback. These roots observe
existing services. They do not take ownership of login, route execution,
focus, or playback.

## Authenticated browser validation boundary

Phase 2D adds no product runtime boundary. It restores validation around the
Phase 2A-2C web seams. A dedicated current Chrome process may be launched with
CDP bound only to `127.0.0.1:9223` and a new OS-temporary profile.
Authentication remains a manual Jellyfin-owned action. No credential, token
injection, tracked storage state, or personal browser profile is part of the
harness.

The interaction runner accepts one expected frontend page and fails closed
until frontend/backend origins, the authenticated Jellyfin client, current
PTV/Core runtime, appRouter, route controller, service-worker origin, and Home
availability all agree. Network and route observation retains only operation
category, method, status, duration, count, route category, and pass/fail data.
It does not retain private URLs, IDs, query values, bodies, headers, cookies,
tokens, account identity, or media titles.

Acceptance is staged at semantic ownership boundaries. Home separates card
eligibility, real pointer/keyboard activation, handler/default prevention,
`appRouter` execution, History route-category transition, details owner,
usable details content, Back, populated-model restoration, and approximate
shelf restoration. Search and both list scenarios use independent setup.
Instrumentation is idempotent and reversible: prior wrappers are restored
before installation, counters reset per scenario, and router/History wrappers
plus event/debug observers are removed at cleanup. Current Jellyfin routing
uses History state, so a route-category transition does not require a native
`hashchange` event.

The helper owns and removes only sessions identified by its OS-temporary
marker. It never calls `Browser.close` on an externally supplied CDP browser.
The artifact is one gitignored summarized JSON file; storage-state capture,
traces, and screenshots are disabled. Authenticated preflight, the separate
physical logout/login-back-in regression, and the independent Phase 2D matrix
now pass. The matrix result is 5/5 across Home details/Back, Search
details/navigation, Series seasons, Season episodes, and error compatibility.
The all-zero Jellyfin GUID is a root-folder sentinel rather than a missing
item; the error scenario uses a nonempty unallocated GUID and verifies the
established HTTP 404/client-rejection contract without retaining it.

## Phase 2E episode-details design audit

Phase 2E is not implemented. The design-only audit decision is **HOLD**.

The repository has 45 direct production `getItem` expressions plus SDK/query
and bound hero hydrations. Higher-traffic Episode-capable reads belong to the
stock details controller, route hydration, media-source dialogs, context
menus/editors, playback/queues, remote players, or featured/continue
presentation. Those owners are explicitly outside the next Core seam.

The closest low-coupling call is the PTV details enhancement fallback. It
reads the current route item only when the normal `detailsrendered` handoff did
not provide the already-loaded raw DTO. For Episode, its only consumers are
shell-section classification and optional direct/parent artwork. It adds no
title/index/overview/runtime/progress consumer, performs no playback, and
suppresses stale application through current-route checks.

That fallback does not justify a new boundary:

- normal details rendering bypasses its request;
- `getPtvItem` already owns generic single-item normalization, safe
  diagnostics, and platform-error preservation;
- Phase 2C already projects the useful Episode identity, scope, title,
  indexes, overview, date, runtime, artwork, and progress fields;
- adopting `getPtvItem` would add an in-flight coordinator to a caller that
  currently has none;
- stricter ID/type/scope validation would create new behavior without fixing a
  demonstrated defect;
- the fallback is Web DOM/shell/artwork-specific and has no portable Android
  consumer.

The hypothetical minimum would be required `episodeId` plus optional
`seriesId`, `seasonId`, and a focused artwork reference. A single-item
normalizer would fail the whole Core result on wrong/missing requested ID,
wrong type, or conflicting supplied parent scope; it would accept missing
optional parent scope and preserve the untouched raw item and unknown fields.
This projection remains unimplemented.

The audit score is 26/50 against a 38-point approval threshold, with only 1/5
for cross-platform usefulness, duplication reduction, and architectural
necessity. Production Items latency/regression evidence, physical-TV
acceptance, and release hygiene are higher-value next work.

## Error handling

All portable operations use the v1 `CoreResult`/`CoreError` taxonomy. Stable
kind/code values drive recovery; user-safe messages drive UI; bounded developer
detail supports diagnostics. Platform exceptions can remain attached in
memory, but serialized errors contain only a safe cause name.

Authentication, authorization, validation, parsing, cache, playback,
unsupported-platform, cancellation, and unknown failures remain distinguishable
from network/server failures. Errors are redacted and never silently converted
into successful empty data.

## Cache versioning

New persisted data uses `CacheEnvelope<T>` with explicit contract/schema
versions, cache key, scope, creation/expiry/stale times, payload, and optional
size. Reads distinguish hit, stale, miss, expiry, corruption, and version
mismatch.

Existing feature caches remain authoritative during migration. Featured
content v7 and current web/Android storage keys are not deleted or renamed.
Adapters attempt current and legacy readers before migrating to an envelope.

The first adopted boundary is the web library index used by Reading and Music.
It is non-authentication and non-playback data, already keyed by server/user,
and covered by existing feature tests. Its IndexedDB name, object store, and
legacy keys remain unchanged. New writes use a v1 envelope; reads accept the
current envelope and legacy `{data, createdAt, expiresAt, schemaVersion}`
record, enforce scope, handle corruption/version/expiry, optionally return
bounded stale data, and diagnose legacy rewrites.

## Phase 2A API and navigation boundaries

Phase 2A adopts one narrow read without replacing the Jellyfin API client.
`getPtvItem` still resolves the active server/user and calls the current
`ApiClient.getItem` transport. The request coordinator shares identical
in-flight reads. A focused Core adapter validates the response ID, reads only
supported PascalCase/camelCase aliases, exposes portable media identity and
runtime milliseconds, and retains the original object for current music and
reading details callers. Success is unwrapped by the existing facade. Failures
are mapped to `CoreError` internally while the original platform error is
re-thrown so authentication and UI error ownership do not change.

One native Home shelf-card details action is the first real navigation intent
adoption. The feature creates `PtvNavigationIntent(destination=details)` with
preserved query/library context and `backBehavior=preserve`. The web adapter
generates the same `#/details?id=...` route and calls the existing `appRouter`
once. It does not own route tables, browser history, deep links, Android
destinations, TV focus, back-button handling, or any non-details route.

Both adapters emit bounded nonblocking diagnostics. API diagnostics use a safe
operation and route identifier plus request ID, method, duration, status,
response byte count, success, and error code. Navigation diagnostics use
destination/source, ID-presence booleans, duration, adapter result, and error
code. They never include raw identifiers, private hosts/query values,
authorization data, response bodies, or media paths.

## Phase 2B metadata and Search boundaries

Phase 2B adopts the existing series-details season list, not the broader TV
metadata subsystem. `renderChildren` still supplies the same series ID, user
ID, and `Fields` options to Jellyfin's `ApiClient.getSeasons`. The compatibility
facade performs exactly one transport call, returns the untouched query-result
object to the current renderer, and rethrows the original transport exception.
It does not introduce a retry, timeout, abort signal, request coordinator,
page, sort, filter, or artwork request.

The internal Core projection validates a nonblank parent series scope and
accepts supported PascalCase/camelCase aliases. It retains each valid raw child
and original ordering while projecting season ID, series ID, title, index,
episode count, and Primary artwork reference. Empty lists are valid. In a mixed
payload, an invalid-ID or cross-scope child is omitted and counted; an invalid
envelope or parent scope fails. Unknown enum and additive fields do not fail
the response.

Native Search reuses the Phase 2A details-intent/web-router adapter for generic
Movie, Series, Season, Episode, and BoxSet cards. The original anchor href
remains the deep-link and modified-click authority. Only an unmodified primary
activation is intercepted, preventing a parallel anchor transition while
`appRouter` executes the same details hash. Immediate double activation shares
one in-flight navigation. Book, Audio, MusicAlbum, MusicArtist, and unsupported
types retain their existing specialized or anchor behavior.

Metadata diagnostics contain only a safe operation/category, request ID,
method, duration, status, response size, item/drop counts, success, and Core
error code. Search continues to use the Phase 2A ID-presence navigation event.
Diagnostic failure cannot block either operation.

## Phase 2C episode-list boundary

Phase 2C adopts only the episode list rendered by the Season branch of
`renderChildren`. The compatibility facade delegates once to the existing
`ApiClient.getEpisodes(seriesId, options)`, passing the original options object
with its lowercase `seasonId`, current user ID, and unchanged case-sensitive
`Fields` string. The facade returns the same raw query-result object or rethrows
the original transport error. Jellyfin continues to own URL construction,
authorization, automatic networking/failover, local-ID compatibility, timeout,
and response parsing. No PTV coordinator, retry, paging, cancellation, sorting,
or user-data flag is introduced.

The Core-only projection validates requested series and season scope. Each
valid episode retains its raw object and order and may expose title,
season/episode indexes, runtime milliseconds, premiere date, overview, present
Primary artwork, and present played/position/percentage progress. Tick
conversion affects only the projection. Missing optional fields and child scope
are compatible; requested scope supplies omitted child scope. Missing/blank
IDs and conflicting child scopes are dropped with separate counts. Empty and
all-malformed child lists remain successful normalized lists, while invalid
envelopes, invalid requested scopes, and conflicting envelope scopes fail.

This boundary does not include More From Season, playback/media sources,
episode-details lookup, Next Up, autoplay, images, context menus,
recommendations, Search, or any Android call.

## Current adoption boundary

Newly wired: lifecycle execution, settings/feature-flag snapshots, capability
reports, diagnostic events, cache-envelope adapters, the library-index cache,
one recommendation response normalizer, one item-details API response/error
boundary, one series-details season-list boundary, one season-details
episode-list boundary, native Home details navigation, and eligible generic
native Search details navigation.

Partially adopted: API has three narrow active reads and navigation has two
feature entry points using the same details adapter;
session/playback initialization steps still only observe or acknowledge
existing owners. Jellyfin transport and `appRouter` remain the executors.

Still legacy: token persistence, login/logout/Quick Connect, featured cache v7,
route stacks, TV focus, browser/Media3 playback, Android Auto, notifications,
lock-screen controls, Search submission/results API and
rendering, specialized Search routes, More From Season/episode detail/Next Up
and all other episode requests, and all other cache/recommendation engine
boundaries.

Blocked: removing those owners before device and version-skew regression
coverage. Phase 2D has closed the authenticated Phase 2A-2C web matrix through
a helper-owned loopback CDP session without stored credentials or auth state.
Deferred: a published shared Kotlin artifact, generated platform models,
broad cache consolidation, and any UI/navigation redesign. The next candidate
was audited and placed on HOLD. Reconsider a focused episode-details boundary
only when a distinct portable consumer or diagnostic requirement exists.

## Diagnostics and privacy

Diagnostic events have a shared category/name/platform/time/success envelope
with optional duration/error and sanitized metadata. Existing platform opt-in
or debug settings remain authoritative. Disabled diagnostics are a no-op, and
transport failure never blocks the app.

Credentials, authorization headers, cookies, passwords, tokens, secrets, email
addresses, full media paths, and private response payloads are prohibited.
Metadata is bounded by key count, depth, strings, arrays, and serialized bytes.

## Capability detection

Clients publish a versioned capability report for playback, inputs, reader,
downloads, notifications, hardware decode, telemetry/cache, Quick Connect,
deep links, Android Auto, and TV focus. Features ask for capabilities instead
of embedding new user-agent branches.

Existing browser/user-agent, Android API-level, codec, and device-profile
detection remains as adapter evidence until capability checks are validated.

## Adding a core service

1. Confirm the behavior is shared or duplicated and belongs below feature/UI
   code.
2. Add or amend the v1 behavior specification. Additive optional fields remain
   v1; breaking changes require `v2`.
3. Add/update the JSON Schema and cross-platform fixtures.
4. Define the smallest framework-free interface/model and pure validation.
5. Implement a platform adapter around the existing system.
6. Add contract tests plus adapter compatibility tests.
7. Export only the intended public surface.
8. Migrate one caller while retaining the old facade/export.
9. Document fallback, deprecation, and rollback behavior.

## Adding a platform implementation

1. Map platform types to the canonical fields and enum meanings.
2. Keep UI, secure storage, API engine, playback engine, and device lifecycle in
   the platform layer.
3. Implement redaction, cancellation, timing, and failure mapping.
4. Declare capabilities from real platform evidence.
5. Implement observable initialization without global duplication.
6. Validate canonical fixtures and platform-specific backward compatibility.
7. Record unsupported behavior explicitly rather than simulating success.

## Public boundary

For web, `src/ptv/core/index.ts` is the small public entry point for new code.
Existing flat core/API exports remain compatibility surfaces. Android core
contracts live under `com.piggietv.core`; app adapters remain under their
existing namespaces. C# continues using explicit DTOs and additive response
fields.

See `PTV_CORE_AUDIT.md` for the evidence and risks and
`PTV_CORE_MIGRATION.md` for current adoption status.
