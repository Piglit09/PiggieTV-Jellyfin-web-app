# PTV Cache Lifecycle

The featured-content cache is shared across users on the same Jellyfin server.

## Current Flow

1. Web client asks the plugin for `/Ptv/v1/FeaturedContent`.
2. If the plugin is unavailable, the client falls back to Jellyfin named configuration.
3. The plugin background worker refreshes the cache on startup when it is missing or expired.
4. The plugin background worker refreshes the cache every 12 hours by default.
5. Clients reuse the payload until `expiresAt`.
6. If expired, clients show stale content immediately while the server refreshes in the background.

Normal users can read plugin cache data. If a normal user cannot write or manually refresh the shared cache, the web client keeps rendering from memory or fallback storage without surfacing an error.

Current fallback order:

1. Plugin file cache: `/Ptv/v1/FeaturedContent`
2. Jellyfin named configuration: `ptv`
3. In-memory cache for the current browser session

`DELETE /Ptv/v1/FeaturedContent` is the preferred clear path. It is admin-only. When unavailable, the web client clears local memory and attempts the named-configuration fallback.

`POST /Ptv/v1/FeaturedContent/Refresh` is the preferred manual refresh path. It is admin-only and runs the plugin refresh worker. When unavailable, the dashboard falls back to the older client-generated refresh path.

## Payload Shape

```json
{
  "heroItems": [],
  "sectionItems": {}
}
```

The web cache entry wraps this payload with:

- `version`
- `createdAt`
- `expiresAt`

## TTL

Default TTL is 12 hours. The dashboard task can adjust the interval and force a refresh.

The plugin never blocks `GET /Ptv/v1/FeaturedContent` while a refresh is running. Failed refreshes keep the previous cache document in place so stale content can still render.

The PiggieTV dashboard shows:

- cache source
- fresh/stale/missing state
- created and expires timestamps
- next refresh countdown
- item counts
- last refresh duration
- last refresh or write error
- server refresh in-progress state
- next server refresh time

The dashboard refreshes status every 30 seconds while visible and pauses polling while the browser page is hidden.

## Server Worker

The plugin now owns the first server-side refresh layer:

1. Server boots.
2. Plugin reads cache state.
3. If missing or expired, a background worker prepares featured content.
4. Worker writes the server cache internally.
5. TV clients render an already-prepared payload.

The worker intentionally starts with deterministic ranking and filtering only:

- weighted ranking
- seasonal pools
- profile-aware pools
- hero batch preselection
- image preselection

When configured server-side, the worker may enrich row matching with TMDb facts for items that already have TMDb provider ids in Jellyfin metadata. This improves category accuracy for rows such as Disney, family animation, and anime without exposing TMDb credentials to browser clients. Supported secret locations:

- `PTV_TMDB_READ_ACCESS_TOKEN`
- `PTV_TMDB_API_KEY`
- PiggieTV plugin configuration fields on the Jellyfin server

Do not add AI to this layer.
