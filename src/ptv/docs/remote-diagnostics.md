# Remote Client Diagnostics

PiggieTV can collect a short, administrator-requested diagnostic trace from a TV, Fire TV, mobile browser, webOS browser, or desktop client. Coordination stays on the authenticated Jellyfin server through the PiggieTV plugin. There is no external analytics endpoint and reports are never persisted to disk.

## Admin workflow

1. Open the PiggieTV dashboard and find **Performance / Debug → Remote client diagnostics**.
2. Filter by coarse client profile if needed, then select a recently seen client.
3. Start a 5- or 10-minute session, or request a one-time snapshot.
4. Reproduce the issue on the selected device.
5. View or download the latest report. Stop the session early when finished.

The client receives commands on its next local check-in. The dashboard shows whether the device is online, the normalized route category, the lease expiry, pending snapshot state, and the latest report time.

## Collection boundaries

When no lease is active, the browser sends only a small presence record containing an opaque session-scoped client ID, coarse device profile, normalized route category, timestamp, and whether it believes a lease is active. Detailed collectors and their periodic report uploads are off.

During an active lease, a 300-entry in-memory ring buffer records:

- normalized route changes and route render timing;
- playback state transitions without media identifiers;
- recognized remote/D-pad keys and generic target roles/tags;
- JavaScript errors and unhandled rejections;
- failed fetch/XHR status, duration, method, and same-origin/cross-origin scope;
- long tasks, sampled FPS/frame gaps/stutter, and available memory hints;
- navigation timing and diagnostics session lifecycle events.
- a continuously refreshed, deduplicated tail of up to 20 PiggieTV client log entries, excluding verbose details and omitting messages/scopes outside fixed safe operational allowlists.

Arbitrary JavaScript error messages and log detail objects are omitted. Query strings, authorization/cookie/credential fields, media identifiers, local paths, and external hosts are removed or redacted before upload. The plugin applies a second size/depth/count/redaction pass before holding the report in memory.

## Expiry and limits

- Leases accept only 5 or 10 minutes from the admin API; the client independently rejects leases longer than 10 minutes.
- Commands include a bounded remaining duration so a skewed TV clock cannot accidentally reject or extend a lease.
- A one-time snapshot creates a one-minute lease when no session already exists.
- Clients and reports expire from the server store after 30 minutes of inactivity.
- The server retains at most 64 recent clients and one latest report per client.
- Uploaded reports are limited to 192 KiB and must match the active opaque session ID.
- Restarting Jellyfin clears all remote diagnostic state and reports.

## Local plugin API

All routes require normal Jellyfin authentication. Listing clients, issuing commands, stopping sessions, and reading reports additionally require Jellyfin elevation/admin authorization.

```text
POST   /Ptv/v1/diagnostics/clients/check-in
POST   /Ptv/v1/diagnostics/clients/report
GET    /Ptv/v1/diagnostics/clients?profile=webos
POST   /Ptv/v1/diagnostics/clients/{clientId}/sessions
DELETE /Ptv/v1/diagnostics/clients/{clientId}/sessions
POST   /Ptv/v1/diagnostics/clients/{clientId}/snapshot
GET    /Ptv/v1/diagnostics/clients/{clientId}/report
GET    /Ptv/v1/diagnostics/clients/{clientId}/report/download
```

The client-side API is available for local troubleshooting at `window.PTV.remoteDiagnostics`. Normal operation should use the dashboard so authorization and expiry remain visible.
