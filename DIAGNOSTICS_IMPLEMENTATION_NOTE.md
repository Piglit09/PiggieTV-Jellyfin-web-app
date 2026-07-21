# PTV diagnostics implementation note

## Persistent-write audit

| File | Function | Pattern | Frequency | Retention | Action |
| --- | --- | --- | --- | --- | --- |
| `PtvRollingDiagnosticsWriter.cs` | queued writer | `ptv-diagnostics.log`, bounded `.N.log` rotations | batched background writes | size, count, and age bounded | retained as the sole diagnostics disk writer |
| `PtvFeaturedContentStore.cs` | featured-cache persistence | `featured-content-cache.json` | cache refresh only | atomic replacement | explicitly excluded; not diagnostics |
| `PtvRemoteDiagnosticsController.cs` | report download | in-memory response filename only | admin download | browser-owned | no server file is created |

## Noise controls

- Detailed browser events remain in the bounded remote diagnostics ring buffer and require an expiring diagnostics lease.
- Remote snapshot exports retain at most 20 representative samples per kind, with total counts, omission counts, and repeated signatures preserved in the summary.
- Unchanged remote client check-ins are coalesced for one minute; route, profile, or diagnostics-session changes still send immediately.
- The diagnostics dashboard shares an in-flight clients/sessions/storage refresh, polls only while visible, and uses a 30-second interval.

## Remaining live-validation requirement

Deployment file-count and disk-usage before/after measurements require an active Jellyfin instance and are intentionally not fabricated by local tests.
