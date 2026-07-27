# Diagnostics platform adoption

## Phase 1 capability matrix

| Capability | PTV Web | WebOS native | Android TV | Android Mobile | Plugin |
| --- | --- | --- | --- | --- | --- |
| Shared v1 snapshot contract | implemented | portable | portable | portable | portable |
| Bounded local store | implemented | deferred | deferred | deferred | deferred |
| Request families | implemented for coordinated PTV Web requests | deferred | deferred | deferred | endpoint status only |
| Route lifecycle | implemented | Web collector only | deferred | deferred | unsupported |
| TV focus/input | implemented when actual TV profile is active | Web profile path | deferred | unsupported | unsupported |
| Browser frame intervals | implemented | Web profile path | unsupported | unsupported | unsupported |
| Native frame timing | unsupported | deferred | deferred | deferred | unsupported |
| Image/shelf lifecycle | implemented at Web boundary | Web profile path | deferred | deferred | unsupported |
| Plugin/server summary | implemented from existing endpoint | available through Web | deferred | deferred | provider |
| Share-safe export | implemented | Web export only | deferred | deferred | deferred |

`portable` means the Core model can represent the data. It does not mean a
collector is implemented.

## Android adoption plan

Android repositories should generate or validate Kotlin diagnostic models from
the v1 schema and retain their existing Core contract parity gate. A native
bounded store should use the same retention semantics and dropped counters.

Android TV should observe, not replace:

- the current Activity/Application Core runner;
- Media3 request/playback boundaries;
- the existing Compose/view focus owner;
- remote input dispatch;
- image loading and screen navigation.

Android Mobile should mark TV focus and remote-input metrics unsupported. Native
frame metrics must clearly name their Choreographer or platform source and must
not populate browser-only meanings.

## WebOS adoption plan

The existing PTV Web collector already runs for the WebOS profile with guarded
browser APIs. A future WebOS-specific layer may add memory, lifecycle, or native
performance signals only when exposed by supported APIs. It must retain the Web
collector's low-power safeguards and explicitly mark missing Long Task support.

## Plugin adoption plan

Phase 1 consumes the existing status endpoint and adds no plugin endpoint,
database trace, telemetry table, or scheduler. A future plugin snapshot should
be an in-memory, bounded summary of existing operations. It must not include SQL,
paths, media/user IDs, job arguments, secrets, or response bodies.

## Contract adoption checklist

Every new platform collector must:

1. validate its normalized snapshot against v1;
2. expose unsupported metrics explicitly;
3. use deterministic bounded histories and dropped counts;
4. install and dispose idempotently;
5. preserve the platform's existing auth, playback, route, focus, and cache
   owners;
6. prove share-safe export with sentinel leakage tests;
7. measure collector and dashboard overhead;
8. avoid upload or persistence unless a later phase separately approves it.

## Known unsupported Phase 1 metrics

- GPU render time and GPU profiler output;
- native Android frame, memory, network, focus, and input metrics;
- native WebOS APIs beyond browser capability detection;
- plugin database command timing and scheduler history;
- response sizes not safely exposed by the coordinated boundary;
- HTTP status for successful generic coordinated requests;
- image decode timing when the browser does not expose a safe decode signal;
- server-side request concurrency outside the observed PTV Web boundary;
- persistent fleet history and remote monitoring.

## Phase 2 browser-TV adoption

Android TV, Fire TV, and WebOS user-agent profiles are validated through the
real Web focus manager after profile eligibility is established. This is Web
runtime coverage, not native Android diagnostics and not native WebOS API
coverage. Physical LG automation was unavailable, so no physical-device claim
is made.

The next narrow adoption gate should be a physical LG WebOS remote validation
run using the share-safe Phase 2 export after each failed scenario.
