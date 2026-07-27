# PiggieTV Diagnostics privacy

## Data classification

Normal snapshots are `local-only`. A bundle becomes `share-safe` only after the
on-demand export sanitizer completes. No automatic upload or background export
exists.

The collector accepts normalized families, safe enums, booleans, measurements,
versions, counts, generated event IDs, and structural fingerprints. It does not
retain raw legacy observability details.

## Forbidden export data

Exports must not contain:

- access tokens, API keys, authorization values, passwords, cookies, or secrets;
- request or response bodies;
- complete URLs, query values, private IP addresses, or private hostnames;
- Jellyfin user, media, server, or device IDs;
- media titles, personal labels, filenames, or local filesystem paths;
- complete CSS selectors or DOM text;
- SQL or database commands;
- stack traces containing private paths;
- preference or taste data.

## Collection-time minimization

Request endpoints are immediately reduced to families such as `Items list`,
`Episodes`, `Search`, or `Plugin status`. Routes are reduced to known route
families with query strings discarded. Image URLs are never read into the store.
Image observations contain only role, status, duration, route family, and a
generated diagnostic event ID.

Focus categories are limited to `nav-item`, `media-card`, `hero-action`,
`button`, `menu-item`, `dialog-control`, `player-control`, and `unknown`.
Structural fingerprints are one-way correlation hints for the current
diagnostic session, not stable identities.

Plugin parsing allowlists versions, API version, boolean capability names, status
classification, timing, and reachability. The authenticated session field is a
boolean and never includes the user identity.

## Export defense in depth

The bounded snapshot is passed through the existing PTV export sanitizer. The
sanitizer:

- redacts secret and identifier-shaped fields;
- reduces absolute URLs and removes query values;
- redacts private IPv4 hosts and local hostnames;
- redacts Windows and common Jellyfin filesystem paths;
- redacts GUID and long-hex identifiers;
- strips authorization and secret query values;
- bounds strings, arrays, object keys, and nesting depth;
- handles circular references defensively.

The share-safe bundle reports redaction and truncation counts, privacy schema,
collector availability, dropped-event counts, retention limits, and generation
time.

## Privacy test guidance

Tests must use recognizable sentinel tokens, private hosts, user IDs, media IDs,
URLs, paths, and titles. Assertions should inspect serialized output, not only
the parsed object, and must prove sentinels are absent. Tests should also confirm
useful normalized families, versions, timings, and counts remain.

Any new collector field requires a collection-time minimization review and an
export leakage test before release.

## TV input and focus minimization

Phase 2 specifically rejects raw user agents, key codes, DOM IDs, selectors,
element text, media data, query-bearing routes, exact coordinates, hosts, device
identifiers, serials, tokens, and cookies. Platform and input mapping use
allowlisted enums. Failure and rebuild reasons use allowlists rather than
arbitrary event strings. Focus fingerprints hash structural category and roles
only.

Sentinel tests inject every prohibited TV diagnostic class and assert against
the serialized share-safe bundle.
