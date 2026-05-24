# PTV API Contracts

PiggieTV plugin APIs are versioned from the start. The current public version is:

```text
/Ptv/v1
```

Unversioned aliases may exist temporarily for compatibility, but new client code must use the versioned routes.

## v1 Endpoints

### GET /Ptv/v1/Status

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
  "features": ["status", "featuredContent"],
  "canReadFeaturedContent": true,
  "canWriteFeaturedContent": false,
  "cachePathExists": true,
  "featuredCacheExists": true,
  "featuredCacheFresh": true,
  "featuredCacheCreatedAt": 0,
  "featuredCacheExpiresAt": 0,
  "maxCachePayloadBytes": 4194304,
  "featuredContent": {
    "hasPayload": true,
    "cacheVersion": 6,
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

The dashboard uses these fields to distinguish:

- connected
- plugin missing or endpoint unreachable
- unauthorized
- version mismatch
- stale or missing cache
- fallback storage in use

### GET /Ptv/v1/FeaturedContent

Authenticated Jellyfin users may call this endpoint. Admin policy is not required.

Returns the shared featured-content cache document:

```json
{
  "version": 1,
  "featuredContent": {
    "version": 6,
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

### PUT /Ptv/v1/FeaturedContent

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

### DELETE /Ptv/v1/FeaturedContent

Only Jellyfin admins/elevated users may call this endpoint.

Clears the shared server-side featured-content cache and returns an empty cache document. The frontend dashboard uses this endpoint when available, then falls back to named configuration or memory behavior if the plugin is unavailable.

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
