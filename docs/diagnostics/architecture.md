# PiggieTV Diagnostics architecture

## Phase 1 decision

PiggieTV Diagnostics is a passive, local observability layer. It extends existing
boundaries and does not own application behavior. PTV Web is the only Phase 1
collector implementation; the Core contract is portable so other clients can
adopt it later.

The architecture has four layers:

1. `src/ptv/core/diagnostics/diagnosticContracts.ts` defines serializable,
   platform-neutral contracts.
2. `src/ptv/services/diagnostics/diagnosticStore.ts` owns one bounded,
   in-memory diagnostic session.
3. `webDiagnosticPlatform.ts` observes existing Web boundaries and converts
   their events into privacy-safe contract values.
4. The dashboard and optional overlay consume snapshots. They do not control
   requests, routing, focus, cache generation, or recommendations.

## Existing diagnostics audit

Phase 1 found usable shared boundaries rather than introducing replacement
owners:

- Core already has an ordered, idempotent initialization runner in
  `coreInitialization.ts` and `webCoreRuntime.ts`.
- PTV API GET traffic already passes through `requestCoordinator.ts`.
- PTV route ownership already emits `ptv:routecontrollerchange`.
- TV focus is centralized in `tvFocus.ts` and already publishes snapshots and
  `ptv:focus-diagnostic` events.
- `observability.ts` already receives cache, recommendation, row, render, and
  image-adjacent events.
- the featured-content cache already exposes a summary function;
- the plugin already exposes a safe status endpoint;
- the prior debug-export sanitizer already has strong secret, URL, identifier,
  path, and size controls.

The legacy debug report, performance report, and remote diagnostics platform
remain separate. Phase 1 does not replace them.

## Ownership boundaries

Diagnostics observes but does not own:

- Jellyfin authentication, sessions, login, or logout;
- playback engines, media state, notifications, or lock-screen controls;
- hash routing, route selection, or route stacks;
- remote-key handling, directional target selection, or focus movement;
- Jellyfin API models or response contracts;
- recommendation generation or user preference data;
- cache reads, writes, invalidation, refresh, or persistence;
- plugin scheduling or server jobs.

The request coordinator receives additional recording calls but its key,
deduplication, returned promises, errors, and request contracts are unchanged.
The route and focus collectors only subscribe to their existing public events.

## Lifecycle

The Web collector starts during the existing `diagnostics` initialization step.
Core step events are recorded from the initialization observer, including steps
that occur before the collector starts. Initialization is idempotent, and the
collector itself uses one module-level instance.

Disposal cancels animation frames and timers, disconnects performance and DOM
observers, removes window/document listeners, and unsubscribes from the store,
preferences, focus manager, and legacy observability tap. Repeated initialization
therefore does not install duplicate listeners.

Dashboard subscriptions exist only while the page is mounted. The overlay
subscribes only to its boolean preference and reads a snapshot at most once per
second while enabled.

## Failure behavior

Diagnostic observers are isolated from application execution. Subscriber
exceptions cannot fail Core initialization, requests, route changes, or focus
movement. Unsupported browser metrics use `unsupported` or an unavailable
collector flag; they are not classified as failures.

Plugin status failure and absent cache data degrade their diagnostic sections.
They do not change server reachability, authentication, plugin availability
backoff, or cache behavior.

## No persistent telemetry

Histories exist only in memory. Local storage contains two developer booleans:
collection enabled and overlay enabled. There is no telemetry database, upload,
background report, analytics pipeline, or server persistence. Export is created
only after a user presses Copy or Download.

## Phase 2 TV adoption

TV focus and remote diagnostics are emitted inside the existing
`PtvTvFocusManager` branches and consumed by the same Web store. The diagnostic
layer installs no keyboard handler and performs no focus or route action.
Lifecycle counters expose requested/active state, actual initialization and
disposal, listener installations, and duplicate listener count.

See [TV focus and remote diagnostics](tv-focus-remote.md) for the stage model,
graph/scope summaries, visibility correlation, and validation boundary.
