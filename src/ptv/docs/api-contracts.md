# PTV API Contracts

PiggieTV plugin APIs are versioned from the start. The current public version is:

```text
/Ptv/v1
```

Unversioned aliases may exist temporarily for compatibility, but new client code must use the versioned routes.

## v1 Endpoints

### GET /Ptv/v1/status

Authenticated Jellyfin users may call this endpoint. Admin policy is not required.

Returns plugin health and capability metadata:

```json
{
  "ok": true,
  "name": "PiggieTV",
  "pluginName": "PiggieTV",
  "version": "0.0.0.0",
  "pluginVersion": "0.0.0.0",
  "apiVersion": 1,
  "apiPath": "/Ptv/v1",
  "serverTime": 0,
  "serverTimeUtc": "2026-05-24T00:00:00+00:00",
  "cacheBackend": "plugin-file",
  "features": ["status", "featuredContent", "featuredContentRefresh"],
  "canReadFeaturedContent": true,
  "canWriteFeaturedContent": false,
  "cachePathExists": true,
  "cachePathWritable": true,
  "cachePath": "/config/plugins/configurations/PiggieTV",
  "cacheFilePath": "/config/plugins/configurations/PiggieTV/featured-content-cache.json",
  "cacheWriteError": null,
  "featuredCacheExists": true,
  "featuredCacheFresh": true,
  "featuredCacheCreatedAt": 0,
  "featuredCacheExpiresAt": 0,
  "refreshInProgress": false,
  "lastRefreshStartedAt": 0,
  "lastRefreshCompletedAt": 0,
  "lastRefreshDurationMs": 1200,
  "lastRefreshError": null,
  "lastRefreshWarning": null,
  "nextRefreshAt": 0,
  "tmdbMetadata": {
    "enabled": true,
    "configured": false,
    "cacheSize": 0,
    "cacheHits": 0,
    "cacheMisses": 0,
    "lastError": null,
    "lastDurationMs": null
  },
  "maxCachePayloadBytes": 4194304,
  "featuredContent": {
    "hasPayload": true,
    "cacheVersion": 7,
    "heroCount": 20,
    "sectionCount": 19,
    "itemCount": 276,
    "createdAt": 0,
    "expiresAt": 0,
    "updatedAt": 0
  }
}
```

`canWriteFeaturedContent` is user-specific. It is `true` only when the current Jellyfin user can pass the admin/elevated write policy.

Refresh fields describe the server-side featured-content worker. `refreshInProgress` may be true while the plugin is preparing a new payload; reads continue to serve the current cache during refresh.

`tmdbMetadata` describes optional server-side TMDb enrichment used during featured row generation. Credentials must stay on the Jellyfin server through plugin configuration or environment variables; frontend JavaScript must never receive TMDb secrets.

The dashboard uses these fields to distinguish:

- connected
- plugin missing or endpoint unreachable
- unauthorized
- version mismatch
- stale or missing cache
- fallback storage in use

### GET /Ptv/v1/featured

Authenticated Jellyfin users may call this endpoint. Admin policy is not required.

Returns the shared featured-content cache document:

```json
{
  "version": 1,
  "featuredContent": {
    "version": 7,
    "createdAt": 0,
    "expiresAt": 0,
    "payload": {
      "heroItems": [],
      "sectionItems": {}
    }
  },
  "featuredContentSettings": {
    "ttlMs": 43200000
  },
  "updatedAt": 0
}
```

### PUT /Ptv/v1/featured

Only Jellyfin admins/elevated users may call this endpoint.

Replaces the shared featured-content cache document and returns the stored document. The plugin validates the document before saving:

- outer document `version` must be `1`
- inner featured-content payload `version` must be supported by the plugin
- `featuredContent.payload.heroItems` must be an array
- `featuredContent.payload.sectionItems` must be an object containing arrays
- serialized payload must stay under the plugin safety limit
- `createdAt`, `expiresAt`, `updatedAt`, and `ttlMs` are normalized or clamped server-side
- client-provided file/path fields and unsafe strings are rejected

The plugin always writes to its own fixed cache file and never accepts client-provided storage paths or file names.

Non-admin callers receive `403` with a structured error response.

### DELETE /Ptv/v1/featured

Only Jellyfin admins/elevated users may call this endpoint.

Clears the shared server-side featured-content cache and returns an empty cache document. The frontend dashboard uses this endpoint when available, then falls back to memory-only behavior if the plugin is unavailable.

### POST /Ptv/v1/featured/refresh

Only Jellyfin admins/elevated users may call this endpoint.

Triggers a server-side featured-content refresh and returns the updated status response. The plugin uses a single refresh lock, so concurrent calls do not start duplicate generation work. If refresh fails, the endpoint returns status with `lastRefreshError` while the existing stale cache remains readable through `GET /Ptv/v1/featured`.

Clients should prefer this endpoint for manual dashboard refresh and fall back to client-side generation only when the endpoint is unavailable on older plugin builds.

### GET /Ptv/v1/settings

Only Jellyfin admins/elevated users may call this endpoint.

Returns public PiggieTV plugin settings used by the custom dashboard. TMDb secrets are never returned. The response only includes `tmdbApiTokenConfigured`.

```json
{
  "featureSettings": {
    "heroEnabled": true,
    "homeRowsEnabled": true,
    "dynamicBackdropsEnabled": true,
    "tvLowPowerModeEnabled": true,
    "debugModeEnabled": false
  },
  "heroSettings": {
    "heroAutoRotateEnabled": true,
    "heroRotationSeconds": 12,
    "heroMaxItems": 15,
    "heroBackdropMaxWidth": 1920,
    "heroLogoMaxWidth": 800
  },
  "rowSettings": {
    "rowMaxItems": 16,
    "rowRefreshHours": 12,
    "enableSeasonalRows": true,
    "enableCollectionRows": true,
    "enableRecentlyAddedRows": true,
    "enableRecommendedRows": true
  },
  "performanceSettings": {
    "maxCachePayloadBytes": 4194304,
    "imagePreloadLimit": 4,
    "enableAnimatedRows": true,
    "enableBackdropBlur": true,
    "lowPowerDisableBlur": true,
    "lowPowerDisableAnimations": true
  },
  "tmdbSettings": {
    "tmdbEnabled": true,
    "tmdbApiTokenConfigured": false,
    "tmdbLanguage": "en-US",
    "tmdbRegion": "US",
    "useTmdbForRowAccuracy": true
  }
}
```

### POST /Ptv/v1/settings

Only Jellyfin admins/elevated users may call this endpoint.

Saves PiggieTV plugin settings. Numeric fields are clamped server-side:

- `heroRotationSeconds`: 5-120
- `heroMaxItems`: 1-50
- `rowMaxItems`: 5-100
- `rowRefreshHours`: 1-168
- `imagePreloadLimit`: 1-10
- `maxCachePayloadBytes`: 1048576-52428800

`tmdbSettings.tmdbApiToken` is write-only. If omitted or empty, the existing stored token is preserved. If provided, it replaces the stored token and is never returned by subsequent reads.

### POST /Ptv/v1/settings/reset

Only Jellyfin admins/elevated users may call this endpoint.

Restores default PiggieTV plugin settings. This resets the plugin configuration to defaults and returns the public settings DTO.

### Authoritative Relationship Endpoints

`GET /Ptv/v1/relationships/{sourceItemId}` is available to authenticated Jellyfin users. It returns only enabled mappings for which both the requested source and destination are visible to the current user. Missing, malformed, same-family, disabled, or unavailable mappings are omitted. A source that is unavailable to the current user returns `404`.

```json
{
  "schemaVersion": 1,
  "relationships": [
    {
      "mappingId": "opaque-mapping-id",
      "targetItemId": "opaque-jellyfin-item-id",
      "category": "soundtrack",
      "direction": "source-to-target",
      "displayOrder": 0,
      "enabled": true,
      "schemaVersion": 1
    }
  ]
}
```

The payload intentionally contains no titles, provider IDs, paths, or raw metadata. Bidirectional mappings are returned relative to the requested source.

Relationship mutations require Jellyfin administrator/elevated permission:

```text
POST   /Ptv/v1/relationships
PUT    /Ptv/v1/relationships/{mappingId}
DELETE /Ptv/v1/relationships/{mappingId}
```

Create requests provide `sourceItemId`, `targetItemId`, `category`, and optional `direction`, `displayOrder`, and `enabled`. Source and target must resolve through Jellyfin, must differ, and must belong to different supported media families. Categories are limited to `soundtrack`, `adaptation`, `based-on`, `spin-off`, `companion-reading`, `companion-video`, `related-game`, `related-comic`, and `related-book`. Directions are limited to `source-to-target` and `bidirectional`. Equivalent mappings are rejected with `409`. Updates may change category, direction, display order, or enabled state; endpoint identities remain immutable. Delete removes the mapping immediately from plugin configuration.

### Native Signup Endpoints

PiggieTV owns native signup, email verification, password reset, and invite management through server-side plugin routes. Frontend JavaScript never receives Jellyfin admin tokens or SMTP credentials.

```text
POST   /Ptv/v1/signup/create-user
POST   /Ptv/v1/signup/verify-email
POST   /Ptv/v1/signup/password-reset/request
POST   /Ptv/v1/signup/password-reset/confirm
GET    /Ptv/v1/signup/admin/settings
POST   /Ptv/v1/signup/admin/settings
POST   /Ptv/v1/signup/admin/email/test
GET    /Ptv/v1/signup/admin/invites
POST   /Ptv/v1/signup/admin/invites
POST   /Ptv/v1/signup/admin/invites/{id}/disable
DELETE /Ptv/v1/signup/admin/invites/{id}
```

Admin signup routes require Jellyfin admin permissions. Public signup routes validate pending signup state, email verification tokens, and password reset codes server-side before creating or updating Jellyfin users.

Signup security and cleanup notes:

- Email verification is required for native signup.
- Verification links expire after 30 minutes by default.
- Verification emails are sent as branded HTML with a plain-text fallback.
- Verification/reset tokens are generated with secure randomness and stored as hashes.
- Tokens and reset codes are single-use; used or expired records are deleted during signup, verification, admin settings load, and a hosted cleanup timer.
- Public signup and reset routes apply basic IP/email rate limiting with hashed rate-limit keys.
- Signup debug/status payloads expose only redacted booleans, counts, sender domain, and route discovery.

Invite DTO shape:

```json
{
  "invites": [
    {
      "id": "invite-id",
      "code": "optional-code",
      "label": "Friends",
      "expiresAt": "2026-06-01T00:00:00Z",
      "maxUses": 10,
      "uses": 0,
      "preset": "Standard User",
      "disabled": false
    }
  ]
}
```

### Error Shape

Plugin errors are structured:

```json
{
  "error": "Only Jellyfin administrators can write the shared PiggieTV featured-content cache.",
  "code": "PTV_CACHE_WRITE_FORBIDDEN"
}
```

Common codes include:

- `PTV_CACHE_NULL_DOCUMENT`
- `PTV_CACHE_UNSUPPORTED_VERSION`
- `PTV_CACHE_UNSUPPORTED_PAYLOAD_VERSION`
- `PTV_CACHE_MISSING_PAYLOAD`
- `PTV_CACHE_PAYLOAD_TOO_LARGE`
- `PTV_CACHE_UNSAFE_CLIENT_FIELD`
- `PTV_CACHE_WRITE_FORBIDDEN`
- `PTV_CACHE_CLEAR_FORBIDDEN`
- `PTV_CACHE_REFRESH_FORBIDDEN`
- `PTV_SETTINGS_READ_FORBIDDEN`
- `PTV_SETTINGS_WRITE_FORBIDDEN`
- `PTV_SETTINGS_RESET_FORBIDDEN`

## Future Versions

Use a new route prefix when changing payload shape in a way older clients cannot safely parse:

```text
/Ptv/v2
```

Examples that require a new API version:

- featured payload schema changes
- recommendation scoring output changes
- render-profile metadata shape changes
- image proxy/preprocessing contracts change

Additive fields can remain on the current version when old clients can ignore them safely.
