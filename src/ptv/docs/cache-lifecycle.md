# PTV Cache Lifecycle

The featured-content cache is shared across users on the same Jellyfin server.

## Current Flow

1. Web client asks the plugin for `/Ptv/v1/FeaturedContent`.
2. If the plugin is unavailable, the client falls back to Jellyfin named configuration.
3. If no server cache exists, the client generates the payload.
4. Admin/elevated clients may write the payload back to `/Ptv/v1/FeaturedContent`.
5. Clients reuse the payload until `expiresAt`.
6. If expired, clients show stale content immediately and refresh in the background.

Normal users can read plugin cache data. If a normal user cannot write the shared cache, the web client keeps rendering from memory or fallback storage without surfacing an error.

Current fallback order:

1. Plugin file cache: `/Ptv/v1/FeaturedContent`
2. Jellyfin named configuration: `ptv`
3. In-memory cache for the current browser session

`DELETE /Ptv/v1/FeaturedContent` is the preferred clear path. It is admin-only. When unavailable, the web client clears local memory and attempts the named-configuration fallback.

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

The PiggieTV dashboard shows:

- cache source
- fresh/stale/missing state
- created and expires timestamps
- next refresh countdown
- item counts
- last refresh duration
- last refresh or write error

The dashboard refreshes status every 30 seconds while visible and pauses polling while the browser page is hidden.

## Server Worker Direction

The next backend milestone should move first-generation work off low-power clients:

1. Server boots.
2. Plugin reads cache state.
3. If missing or expired, a background worker prepares featured content.
4. Worker writes the server cache internally or through an admin/system-only path.
5. TV clients render an already-prepared payload.

The worker should start with deterministic ranking and filtering only:

- weighted ranking
- seasonal pools
- profile-aware pools
- hero batch preselection
- image preselection

Do not add AI to this layer.
