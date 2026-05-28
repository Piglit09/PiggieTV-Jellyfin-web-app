# PTV Plugin Responsibilities

The PiggieTV Jellyfin plugin should stay focused. It is not a second frontend.

## Owns Now

- versioned API surface
- plugin status
- shared featured-content cache storage
- featured-content cache validation
- admin-only cache mutation enforcement
- structured plugin error responses
- background featured-content refresh
- manual admin refresh endpoint
- optional server-side TMDb metadata enrichment for featured row matching
- admin-only plugin settings storage for dashboard controls

## Owns Next

- deterministic recommendation preprocessing
- prefiltered hero batches
- seasonal content pools
- profile-aware content pools
- image preselection metadata

## Does Not Own Yet

- AI recommendation generation
- image proxying
- backdrop preprocessing
- transcoding decisions
- UI rendering

## Permission Rule

Featured-content cache reads are authenticated-user endpoints. TV clients and normal Jellyfin users must be able to read shared display data without administrative rights.

Featured-content cache writes, clears, and manual refreshes are admin/elevated-only. This prevents broken clients or browser extensions from poisoning or thrashing the shared homepage cache for every user.

Admin-only endpoints are used for plugin settings that mutate server policy, refresh behavior, performance limits, or server-side credentials.

## Secret Rule

Third-party API credentials must never be sent to frontend JavaScript. TMDb credentials are server-side only and should be supplied through the Jellyfin host environment or plugin configuration:

- `PTV_TMDB_READ_ACCESS_TOKEN`
- `PTV_TMDB_API_KEY`

The plugin may use TMDb only as an enrichment layer for items that already have TMDb provider ids. If TMDb is unavailable, cache refreshes must continue using Jellyfin metadata.

The settings API must return only `tmdbApiTokenConfigured`; it must never return the saved token. `POST /Ptv/v1/settings` treats `tmdbApiToken` as a write-only replacement field.

## Store Rule

The plugin owns the cache file path. Clients never provide paths or file names.

Writes must:

- validate the document shape
- clamp timestamps and TTL
- reject unsafe fields
- enforce the max payload size
- write a temporary file before replacing the final cache file

Clears must remove only the fixed PiggieTV featured-content cache file.

## Refresh Rule

The plugin should refresh featured content on startup when the cache is missing or expired, then continue refreshing on the configured interval. Manual dashboard refresh uses `POST /Ptv/v1/featured/refresh`.

Refresh work must:

- use a single lock so duplicate refreshes do not run
- use timeout/cancellation protection so refreshes cannot hang forever
- reset `refreshInProgress` on success, failure, timeout, or cancellation
- trim oversized payloads before writing
- return partial rows when individual row builders fail
- keep serving stale cache when refresh fails
- avoid blocking cache reads while refresh is in progress
- report timing, error, and next-refresh status through `/Ptv/v1/status`

## Compatibility Rule

The web client must keep a fallback path while the plugin is optional:

1. `/Ptv/v1/*` plugin API
2. in-memory cache

PTV frontend code must not read or write PiggieTV data through Jellyfin's legacy `/System/Configuration/*` named configuration endpoints.

## Dashboard Rule

The PiggieTV dashboard is an observability and control surface, not a visual theme editor. It should show plugin connectivity, permissions, cache state, render profile, performance/debug state, feature flags, refresh settings, row settings, performance limits, and TMDb configuration. It polls status every 30 seconds while visible and pauses while hidden.
