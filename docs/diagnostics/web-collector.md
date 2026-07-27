# PTV Web diagnostics collector

## Initialization

`initializePtvWebDiagnosticPlatform()` is called by the existing Web Core
diagnostics adapter. It returns the existing instance after the first call.
Core initialization events are passed to
`recordPtvCoreInitializationDiagnostic()` by the established Core observer.

The collector is enabled by default. A developer may disable collection from the
dashboard. Disabling prevents new bounded-history entries; it does not alter the
observed application systems.

## Request boundary

`requestCoordinator.ts` is the established PTV GET coordination boundary.
Phase 1 records:

- normalized request family and method;
- start/end timestamps and duration;
- success, timeout, cancellation, safe error category, and status when exposed;
- response byte estimate for safely serializable coordinated results;
- active concurrency at start and peak concurrency;
- coalesced coordinator hits;
- route, cache, and origin classifications.

The coordinator key and raw URL continue to exist only in the coordinator's
legacy implementation. They are never passed to the new store. Generic
coordinated success cannot reliably expose an HTTP status, so status is `null`
rather than inventing `200`.

## Route boundary

The collector observes `ptv:routecontrollerchange`, `hashchange`, and `popstate`
without navigating or rewriting hashes. It records:

- request/recognition at the observed transition;
- controller initialization on the next animation frame;
- first main content and first focusable element through a DOM observer;
- a 500 ms quiet-period settle sample;
- abandonment and cleanup when another route starts;
- active request, pending image, and pending shelf counts at settle.

Route values are normalized to privacy-safe families before storage.

## Focus and input boundary

The collector subscribes to the existing TV focus-manager snapshot and
`ptv:focus-diagnostic` event. It does not attach a competing key handler or call
focus movement APIs. A non-TV profile is explicitly `unsupported`, not failing.

Input diagnostics can distinguish event observed, movement attempted, target
found, and movement succeeded. Details are mapped through a field allowlist; raw
focus keys are hashed immediately.

## Frame monitoring

One `requestAnimationFrame` loop collects frame intervals and emits one aggregate
sample per second. Each sample includes approximate FPS, jank over 50 ms,
p50/p90/p95/p99, longest interval, visibility, reduced motion, long-task count
when supported, route family, and collector overhead.

The store retains 120 aggregate samples. Hidden documents are classified as
hidden and do not pretend to provide visible FPS. This is browser-observed frame
timing, not GPU timing.

## Images and shelves

A single DOM observer and capture-phase load/error listeners record image
requested, loaded, and errored events. URLs and media identifiers never enter
the store. Role comes from safe class/data categories and defaults to `unknown`.

Shelf events bridge existing row-fetch and render observability events. The
bridge retains only family, lifecycle state, item count, duration, route, and a
generated ID. It never retains raw event detail.

## Cache and recommendations

Cache observation calls `getFeaturedContentCacheStatus({ prime: false })`.
Opening diagnostics therefore cannot initiate a cache read. Existing cache
events refresh the summary.

Recommendation events update a passive run summary. The collector does not call
generation APIs, read taste/preferences, or alter caching.

## Plugin and server

The existing plugin status endpoint is queried once during diagnostic
initialization and when an administrator presses Refresh safe status. Parsing is
allowlisted to versions, capability identifiers, status, timing, and
reachability. The existing Jellyfin client remains authoritative.

## Retention

- requests: 200;
- routes: 50;
- remote/input pipeline stages: 300;
- focus changes: 200;
- focus graph rebuilds: 50;
- focus scope events: 100;
- focus visibility/scroll events: 100;
- frame aggregates: 120 seconds;
- image events: 200;
- shelf events: 100;
- warnings: 100.

Trimming increments per-stream, total, and `retentionTrimmed` counts.
`collectorOverload` remains zero unless a collector explicitly cannot accept an
event.

## TV focus collector

The collector consumes diagnostic events emitted by the existing focus owner.
It maps every field through safe enums and reason allowlists, correlates inputs
with current frames/requests/render state, and records passive scroll start and
settle events. It never adds a key listener, calls focus, suppresses an event, or
changes a graph.
