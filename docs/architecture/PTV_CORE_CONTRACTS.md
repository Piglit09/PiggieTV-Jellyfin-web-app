# PTV Core Contracts v1

Status: active Phase 1 specification
Wire contract: `ptv-core/v1`
Contract version value: `1.0`

The JSON Schemas in `contracts/ptv-core/v1` are the machine-readable source of
truth. This document defines behavior that JSON Schema cannot express on its
own.

## Common rules

- New wire fields use `camelCase`. Readers must continue accepting known
  PascalCase plugin/Jellyfin aliases during migration.
- `contractVersion` is the PTV Core wire version. Version `1.0` readers accept
  unknown fields and reject unknown required enum values.
- `schemaVersion` versions a persisted payload inside the stable wire contract.
  `cacheVersion` versions recommendation or feature cache compatibility.
- Wire timestamps are RFC 3339 UTC strings. Existing epoch-millisecond values
  may be read by compatibility adapters but are emitted as UTC strings by new
  core code.
- Durations and playback positions use integer milliseconds. Jellyfin tick
  adapters convert at the boundary (`10,000` ticks = `1` millisecond).
- IDs are opaque strings. They must not be parsed as UUIDs unless a
  platform-specific API requires it.
- Missing means unavailable. `null` is used only where a schema explicitly
  permits it. Empty strings are not substitutes for missing optional values.
- Parsers preserve unknown settings fields where round-tripping is expected.
  They do not copy unknown data into diagnostics.
- Invalid external data returns a parsing/contract error. It is not silently
  treated as an empty successful response.

## Result and error

In-memory result types are a discriminated union:

```text
Success<T> { success: true, value: T }
Failure    { success: false, error: CoreError }
```

`CoreError.kind` is one of:

| Kind | Meaning | Default retryability |
| --- | --- | --- |
| `network` | DNS, connection, TLS, timeout, or offline failure | true when safe |
| `authentication` | Missing, invalid, or expired session | false until re-auth |
| `authorization` | Authenticated but not permitted | false |
| `server` | HTTP/API failure or server rejection | status-dependent |
| `validation` | Invalid caller input | false |
| `parsing` | Malformed or incompatible contract | false |
| `cache` | Storage, corruption, version, or size failure | operation-dependent |
| `playback` | Playback negotiation, command, or engine failure | operation-dependent |
| `unsupported-platform` | Capability is unavailable | false |
| `cancelled` | Caller or lifecycle cancellation | false |
| `unknown` | No safer classification exists | false |

Every error has a stable machine `code`, user-safe `message`, `retryable`
decision, and timestamp. It may include bounded developer detail, HTTP status,
operation/endpoint, request/correlation ID, and a safe cause name. Original
exception objects stay in process and are never serialized directly.

Codes are stable uppercase tokens such as `API_HTTP_503`,
`AUTH_SESSION_EXPIRED`, or `CACHE_VERSION_MISMATCH`. UI must branch on
`kind`/`code`, not message text.

HTTP mapping:

- `401` -> `authentication`
- `403` -> `authorization`
- other `4xx` -> `validation` for proven client-input rejection, otherwise
  `server`
- `5xx` -> `server`
- abort/cancellation exceptions -> `cancelled`
- timeout/DNS/TLS/connection exceptions -> `network`

No error field may contain credentials, authorization headers, cookies,
passwords, secrets, raw private payloads, email addresses, or unbounded
response bodies.

## Media domain

PTV Core uses focused models rather than one universal media object:

- `MediaIdentity`: media, server, optional library/user IDs, normalized media
  type, title, and sort title.
- `SeriesRelationship`: series and season IDs/names and episode/season index.
- `MusicRelationship`: artist IDs/names and album ID/name.
- `ReadingRelationship`: book/series identifiers, reading kind
  (`book|comic|manga|audiobook`), volume/chapter/page metadata.
- `ArtworkReference`: owner media ID, image type/tag/index, aspect ratio, and
  optional safe URL reference. Full filesystem paths are never portable fields.
- `PlaybackProgress`: position/duration milliseconds, played/completed state,
  percentage, play count, and last-played time.
- `UserMediaData`: favorite/played flags plus progress.
- `MediaSourceInfo`: source/version ID, container/protocol, direct-play and
  transcoding support, and selected track IDs.
- `QualityMetadata`: width, height, bitrate, codec, HDR, channels, and sample
  rate where known.
- `RecommendationMetadata`: score, source, affinity/discovery classification,
  reasons, and generation time.

Normalized media types are:
`movie`, `show`, `season`, `episode`, `music`, `album`, `artist`, `playlist`,
`book`, `comic`, `manga`, `audiobook`, `live-tv`, `game`, and `unknown`.
Adapters retain the original platform type separately when needed.

## Authentication and session

`SessionService` exposes:

- current server connection and authentication state;
- restore, logout, token invalidation, server switch, and user switch commands;
- safe token access only for an authorized API adapter;
- Quick Connect availability/initiation/polling hooks;
- `auth-required` and `auth-expired` events.

Authentication states are `signed-out`, `restoring`, `authenticated`,
`expired`, and `error`.

PTV Core does not persist tokens. Web continues using Jellyfin
`ServerConnections`; Android TV continues using its session store; Android
mobile continues using its Jellyfin SDK/Room/Koin session infrastructure.
Diagnostics may record an authentication state but never token values.

An authentication failure during initialization is a critical step outcome
with action `route-to-login`. Logout and server/user switching invalidate
server/user-scoped caches before the next authenticated feature load.

## API client

`CoreApiClient.request<T>` accepts:

- method, relative path or absolute URL, query, and headers;
- optional body, timeout, cancellation signal/token, request ID, and response
  parser;
- authentication requirement;
- retry policy.

Base URLs remove trailing slashes, preserve an intentional path prefix, and
reject unsupported schemes. Relative paths remove duplicate leading slashes.
Query values omit missing/null/empty values without changing meaningful
`false` or `0`.

Authentication is applied by the platform adapter using the platform's
existing session system. Caller-supplied logs and diagnostics never receive
authorization headers.

Default timeouts are explicit per platform and operation. Cancellation maps to
`cancelled`, not `network`.

Automatic retry is allowed only for idempotent `GET`/`HEAD`/`OPTIONS` requests,
or a mutation with an explicit idempotency contract. Retryable statuses are
bounded (normally `408`, `429`, and `5xx`), honor `Retry-After` when practical,
use capped backoff, and stop on cancellation. Authentication, authorization,
validation, and parsing failures are not retried.

JSON compatibility readers accept a named field and its PascalCase/camelCase
alias. They do not recursively recase arbitrary media payloads. Unknown fields
are ignored unless a round-trip settings contract requires preservation.

Each completed request may emit request ID, safe operation/path (without query
or private host data), method, status, duration, response byte count, success,
and mapped error code. Response bodies are never diagnostic metadata.

## Navigation

`NavigationIntent` describes intent, not a router:

Destinations are `home`, `movies`, `shows`, `music`, `reading`, `live-tv`,
`search`, `requests`, `library`, `details`, `player`, `settings`, `profile`,
and `diagnostics`.

An intent contains optional `mediaId`, `libraryId`, string query values,
`backBehavior` (`default|preserve|replace|modal`), optional deep link, and
required capabilities. `details` and `player` require `mediaId`.

Adapters map the intent to web hashes, Android destinations/Activities, or TV
shell routes. Invalid destinations and malformed deep links return validation
errors. Existing web hash routes and Android back stacks remain authoritative.

## Playback

Portable commands are:

- play, pause, seek, next, previous;
- replace queue, add to queue, play next;
- set repeat (`off|one|all`) and shuffle;
- select audio/subtitle track.

`PlaybackState` describes `idle`, `loading`, `playing`, `paused`, `buffering`,
`ended`, or `error`, plus current media, audio/video kind, position/duration,
queue/index, repeat/shuffle, completion, selected tracks, and a core error.

Platform adapters own Media3, Jellyfin/browser players, webOS playback,
notifications, lock-screen controls, Media Session, and background services.
Core commands never assume an engine.

Progress reporting is monotonic unless a seek occurred, bounded to duration,
and scoped to the active session/media source. Completion is explicit.
Autoplay-next is a pure decision over completion reason, next item, setting,
capability, and user cancellation; the platform engine performs the action.

## Recommendations

`RecommendationResponse` requires contract/cache versions, generation time,
server/user scope, and rows. Each row has a stable ID, title, optional
explanation/media filter/source, and items. Each item has a media ID/title/type,
score, source, affinity/discovery classification, and reason list.

Scores are finite numbers; consumers must not assume one global score range.
Empty rows are valid only when the producer intentionally includes them. A
missing/invalid item is dropped with a parsing diagnostic; an invalid response
scope/version fails the response. Stable row IDs are producer-defined and must
not depend on localized title text.

Compatibility adapters accept:

- camelCase and PascalCase fields;
- current web recommendation engine rows/scores;
- current plugin Row Builder/persisted recommendation rows;
- missing v1 metadata by applying explicit legacy defaults.

Adapters preserve current Row Builder behavior and do not require simultaneous
plugin/client upgrades. Debug metadata is bounded and must not contain full
private payloads or identifiers outside the declared scope.

## Settings and feature flags

Every settings document declares:

- scope kind (`global|user|server|device`) and applicable opaque IDs;
- `schemaVersion`;
- default values and validation;
- a migration sequence and reset behavior.

Readers merge defaults, migrated known values, and validated stored values.
Unknown fields are preserved when the same document is written back. A failed
migration retains the old record and returns a cache/settings error.

Feature flags are boolean values in a versioned document. Missing known flags
use documented defaults. Unknown flags are preserved but evaluate false unless
the feature explicitly recognizes them. Reset removes only the selected scope.

Existing web `ptv:feature-flags:v1`, Android preferences, Room state, and plugin
settings remain in place; platform adapters map them to this contract.

## Cache

`CacheEnvelope<T>` contains:

- contract and payload schema versions;
- cache key and server/user/device scope;
- creation and expiration times;
- optional stale-while-revalidate deadline;
- payload and optional bounded payload byte count.

Outcomes are `hit`, `stale`, `miss`, `expired`, `version-mismatch`,
`corrupt`, or `error`. A stale value is returned only when the caller opts in
and the stale deadline has not passed. Corrupt/incompatible records are not
overwritten until a fallback read/migration is attempted.

Cache keys include the relevant scope. Switching server or user cannot expose a
different scope's payload. Maximum payload size is adapter/configuration
specific and checked before persistence. Cache telemetry records outcome,
duration, schema version, and size—not payload contents.

Featured-content cache v7 and feature-specific Android/web caches remain
readable. The v1 envelope is introduced for new/migrated data; Phase 1 does not
delete old keys or records.

## Telemetry and diagnostics

`DiagnosticEvent` supports:

- app startup;
- navigation duration/failure;
- API duration/failure;
- image load;
- cache hit/miss/error;
- playback start/failure/end;
- recommendation generation;
- UI long task/memory warning;
- TV focus/navigation failure;
- reader navigation;
- crash/fatal failure.

Every event has contract version, stable event name/category, platform, app
version, device class, session ID, timestamp, success, and sanitized metadata.
Duration, error code, and hashed/safe server/user identifiers are optional.

Collection follows the platform's current opt-in/debug/diagnostics setting.
Disabled telemetry is a successful no-op. Diagnostic transport or serialization
failure never blocks startup/playback/navigation. Metadata is recursively
bounded and redacts keys/values related to authorization, cookies, credentials,
passwords, secrets, tokens, API/access/refresh keys, email, and full media
paths. Events have a platform-defined byte limit and drop oversized metadata
before dropping the required envelope.

## Client capabilities

`ClientCapabilityReport` contains platform/device class and boolean support for:

`videoPlayback`, `audioPlayback`, `backgroundAudio`, `downloads`,
`androidAuto`, `tvFocusNavigation`, `pointerInput`, `touchInput`,
`keyboardInput`, `remoteInput`, `reader`, `comicPaging`,
`nativeNotifications`, `lockScreenControls`, `hardwareDecoding`, `telemetry`,
`offlineCache`, `quickConnect`, and `deepLinks`.

Unknown capabilities are allowed for additive evolution. Feature code checks a
capability report. Existing user-agent, SDK-level, and device-profile checks
remain as adapter inputs/fallbacks until capability behavior is proven.

## Core initialization

Applicable clients run these observable steps in order:

1. `environment`
2. `device-identity`
3. `session`
4. `settings`
5. `cache`
6. `api`
7. `diagnostics`
8. `navigation`
9. `playback`
10. `ready`

Each step reports start/end time, status (`success|degraded|failed|skipped`),
criticality, and optional core error. Authentication failure stops with
`route-to-login`. Cache corruption and diagnostics failure degrade safely.
Other critical failures stop readiness.

Initialization is idempotent per runtime instance. Concurrent callers share
one in-flight result; completed initialization is reused. Development hot
reload must dispose platform listeners or reuse the same controlled instance.

## Mapping by platform

- TypeScript: discriminated unions, focused interfaces, parser/normalizer
  functions, and explicit adapter interfaces in `src/ptv/core`.
- Kotlin: dependency-free data/sealed classes and pure normalizers under
  `com.piggietv.core`; Android adapters remain in each app namespace.
- C#: additive DTO properties with explicit JSON names and compatibility tests.
  Existing route DTOs remain valid when new fields are absent.

The platforms share behavior and wire schemas, not compiled binaries.
