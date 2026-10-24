# PiggieTV Diagnostics contracts

## Versioning

The Phase 1 contract uses:

- PTV Core contract version `1.0`;
- diagnostic schema version `1`;
- export privacy schema version `1`.

The canonical TypeScript contract is
`src/ptv/core/diagnostics/diagnosticContracts.ts`. The portable JSON Schema is
`contracts/ptv-core/v1/diagnostic-snapshot.schema.json` and is validated with the
other PTV Core v1 schemas.

## Snapshot model

`PtvDiagnosticSnapshot` contains:

- diagnostic session and generation timestamps;
- build, platform, Core, server, and plugin summaries;
- bounded request, route, frame, input, image, and shelf histories;
- current focus, cache, and recommendation summaries;
- explicit collector capability flags;
- retention limits and dropped-event counts;
- collector self-diagnostics and warnings;
- a privacy classification.

All values are JSON primitives, arrays, or plain objects. Core contracts do not
contain DOM nodes, browser Request or Response instances, Error instances,
functions, class instances, circular values, or platform handles.

## Health model

Every subsystem summary uses one of:

- `healthy`: observed and operating normally;
- `degraded`: usable with an observed problem;
- `failing`: an observed critical subsystem did not operate;
- `unavailable`: a normally supported collector or service is absent;
- `unsupported`: the current platform cannot provide the metric;
- `unknown`: insufficient observations exist.

Health contains a concise reason, timestamp, primitive supporting metrics,
warnings, and a collector-availability boolean. Unsupported does not contribute
a failing result.

## Identity and correlation

Diagnostic request, route, image, and shelf IDs are generated locally for the
diagnostic session. They are not Jellyfin user, media, server, device, or request
IDs. Focus correlation uses a short hash derived from structural category and
roles; no label, title, explicit element ID, URL, selector, or media key appears
in the contract.

## Compatibility rules

Readers must:

- reject unsupported major Core contract versions;
- treat unknown health values as `unknown`;
- ignore unknown object fields for forward compatibility;
- respect the published retention limits rather than assuming array sizes;
- use collector flags before interpreting an empty stream;
- distinguish local snapshots from `share-safe` exports.

Schema validation permits additive fields while enforcing the portable top-level
shape, version, health vocabulary, dropped counts, and retention types.

## Platform adoption

The contracts intentionally do not describe browser APIs. Android, WebOS, and
plugin collectors should map their native timing and lifecycle events into the
same semantic fields and explicitly set unsupported capabilities. They must not
simulate browser frame data or claim support for metrics they cannot observe.

## Phase 2 additive v1 fields

The additive v1 TV model includes safe platform eligibility, input pipeline
stages, focus changes, graph summaries, scope events, visibility/scroll events,
and route focus/restoration timings. New histories publish their own retention
limits. `retentionTrimmed` describes expected ring-buffer eviction;
`collectorOverload` is reserved for events the collector could not accept.

Graph relationships contain only categories and relative regions. Input
relationships use locally generated diagnostic input IDs and safe enums.

## Web 0.5.78 local diagnostic extensions

These additive fields leave the Core `1.0`, diagnostic schema `1`, and privacy
schema `1` versions unchanged. Older exports may omit
`slowRequestObservation`; readers treat that as unavailable evidence.

- `cache` describes the **Web Featured cache**. `countsObserved` and
  `countsObservedAt` distinguish an observed empty projection from missing
  counts. `observedAt` and `observationAgeMs` describe the passive snapshot;
  `ageMs` describes the cached document. Read and write attempts/outcomes are
  separate. `lastReadFailureAt` and `lastReadFailureCategory` retain dated
  history after a later successful read. `fallbackAvailable` reports retained
  Web memory during a failed or rejected read; it does not prove current Plugin
  storage or permission convergence. A Plugin GET cannot establish a Web write.
  A Web write is verified only after readback matches stable entry metadata and
  the requested refresh interval when one was written.
- `recommendations` describes the current owned generation. `terminalOutcome`
  is `success`, `partial`, `failed`, or `cancelled`; a progress event cannot
  complete it. `runDurationMs` and `renderedItemCount` remain `null` when not
  observed. Provider, taste-signal, candidate, generated-row/item, fallback,
  and rejection counters belong to that generation. Identity-duplicate and
  diversity-cap counters count **row selection rejection attempts**, so one
  candidate may be counted more than once. Dated failure and resolution fields
  are historical observations scoped to the current identity.
- `slowRequestObservation`, when present, explains the unchanged
  `SLOW_API_REQUESTS` decision using a retained session request time, duration,
  family, trigger, eligible/retained/trimmed counts, and scope. It does not
  assert current latency. No URL, query, response body, or item identity enters
  the summary.
- Route `criticalWorkCoverage` records whether an owner published critical-work
  lifecycle data. `departureReason: superseded-by-navigation` distinguishes
  leaving a route from a failed critical operation. It is not a route
  settlement or evidence of completed work.
