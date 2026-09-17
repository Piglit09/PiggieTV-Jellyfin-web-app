# Media issue reports

## Owner

PiggieTV Plugin owns user-initiated PTV media issue intake. Jellyfin remains authoritative for users, item visibility, playback sessions, progress, streams, and transcoding. This route does not replace Jellyfin playback reporting and is not telemetry.

## Route and method

```text
POST /Ptv/v1/reports/media
```

The Plugin also exposes administrator-only queue operations:

```text
GET    /Ptv/v1/reports/media?limit=100
DELETE /Ptv/v1/reports/media/{reportId}
```

## Authentication and authorization

Every route requires Jellyfin authentication. Any authenticated user may submit a report only for a Jellyfin item visible to that user. Missing and non-visible items both return `404` to avoid disclosing library contents. Queue reads and deletes require Jellyfin administrator/elevated authorization.

## Request

The request is JSON, has a 16 KiB body limit, and uses schema version 1:

```json
{
  "schemaVersion": 1,
  "itemId": "0123456789abcdef0123456789abcdef",
  "source": "playback",
  "reason": "subtitle-sync",
  "itemType": "Movie",
  "playbackPositionMs": 120000,
  "mediaSourceId": "source-1",
  "playMethod": "DirectPlay",
  "details": "Subtitles are approximately two seconds late."
}
```

`itemId`, `source`, and `reason` are required. `source` is `native-home` or `playback`. `reason` is one of `sound-sync`, `audio-language`, `playback`, `wrong-movie`, `wrong-subtitles`, `subtitle-sync`, or `custom`; `custom` requires `details`. Details are limited to 1,024 characters. Playback position is limited to 0 through 31 days in milliseconds. Unknown properties are ignored and never retained.

## Response

After an atomic server-local write succeeds, the Plugin returns `202 Accepted`:

```json
{
  "schemaVersion": 1,
  "reportId": "0123456789abcdef0123456789abcdef",
  "receivedAtUtc": "2026-08-26T12:00:00Z",
  "status": "accepted"
}
```

The response means the report is present in the Plugin's local review queue. It does not claim delivery to a third-party system.

## Failure semantics and client behavior

- `400`: invalid schema, category, identifier, position, or field bound.
- `401`: Jellyfin authentication is missing or rejected.
- `404`: the item is absent or is not visible to the authenticated user.
- `413`: the JSON body exceeds 16 KiB.
- `429`: more than five accepted submissions for the authenticated user within ten minutes; `Retry-After` is returned.
- `503`: the bounded local store could not safely accept the report.

Mobile performs one foreground submission for an explicit user action. It does not queue or retry reports, treats `404` and `503` as unavailable, treats `429` as rate-limited, and leaves ordinary endpoint/network failures to degrade without clearing credentials. Only a genuine current-session `401` enters the shared authentication recovery path.

## Privacy and retention

The contract has no dedicated media-title, subtitle, user-identity, authentication-material, URL, filename, filesystem-path, or raw request/response-body field. The server uses the authenticated user ID transiently for item-visibility authorization and a one-way in-memory owner key for rate limiting; neither is written to the report queue. Optional free-form details remain user-controlled after bounded sanitation; credential-like content, URLs, paths, and filename-shaped values are redacted, but clients should not intentionally place private identity or media-title data in that field.

Reports are stored at:

```text
<Jellyfin PluginConfigurations path>/PiggieTV/media-reports.json
```

Writes use a same-directory temporary file followed by replacement; an incomplete temporary snapshot is removed on restart. The queue retains at most 500 records for at most 30 days. Expired and oldest-over-cap records are removed on submission, administrator read, or Plugin restart followed by either operation. A malformed existing store is left untouched and submissions return `503`; the Plugin does not overwrite unverified data. Deleting a report removes it from the next atomic snapshot. No report is copied to rolling diagnostics or sent off-server.
