# PTV Plugin Responsibilities

The PiggieTV Jellyfin plugin should stay focused. It is not a second frontend.

## Owns Now

- versioned API surface
- plugin status
- shared featured-content cache storage
- featured-content cache validation
- admin-only cache mutation enforcement
- structured plugin error responses

## Owns Next

- background featured-content refresh
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

Featured-content cache writes and clears are admin/elevated-only until server-side background refresh owns cache generation. This prevents broken clients or browser extensions from poisoning the shared homepage cache for every user.

Admin-only endpoints should also be used for future plugin settings that mutate server policy or file-system paths.

## Store Rule

The plugin owns the cache file path. Clients never provide paths or file names.

Writes must:

- validate the document shape
- clamp timestamps and TTL
- reject unsafe fields
- enforce the max payload size
- write a temporary file before replacing the final cache file

Clears must remove only the fixed PiggieTV featured-content cache file.

## Compatibility Rule

The web client must keep a fallback path while the plugin is optional:

1. `/Ptv/v1/*` plugin API
2. Jellyfin named configuration
3. in-memory cache

Remove fallbacks only after plugin installation becomes required.

## Dashboard Rule

The PiggieTV dashboard is an observability and control surface, not a visual theme editor. It should show plugin connectivity, permissions, cache state, render profile, performance/debug state, and feature flags. It polls every 30 seconds while visible and pauses while hidden.
