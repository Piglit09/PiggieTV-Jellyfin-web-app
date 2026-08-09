# PiggieTV Jellyfin Plugin

Minimal server-side companion for the PiggieTV web client.

Primary endpoints include:

- `GET /Ptv/v1/status`
- `GET /Ptv/v1/featured`
- `PUT /Ptv/v1/featured`
- `DELETE /Ptv/v1/featured`
- `POST /Ptv/v1/featured/refresh`
- `GET /Ptv/v1/settings`
- `POST /Ptv/v1/settings`
- `POST /Ptv/v1/settings/reset`
- `GET /Ptv/v1/reading/series-overrides/{routeKind}`
- `PUT /Ptv/v1/reading/series-overrides/{routeKind}`
- `GET /Ptv/v1/relationships/{sourceItemId}`
- `POST /Ptv/v1/relationships`
- `PUT /Ptv/v1/relationships/{mappingId}`
- `DELETE /Ptv/v1/relationships/{mappingId}`
- `POST /Ptv/v1/diagnostics/clients/check-in`
- `POST /Ptv/v1/diagnostics/clients/report`
- `GET /Ptv/v1/diagnostics/clients`
- `POST /Ptv/v1/diagnostics/clients/{clientId}/sessions`
- `POST /Ptv/v1/diagnostics/clients/{clientId}/snapshot`
- `GET /Ptv/v1/diagnostics/clients/{clientId}/report`

Temporary compatibility aliases are also available:

- `GET /Ptv/v1/Status`
- `GET /Ptv/v1/FeaturedContent`
- `PUT /Ptv/v1/FeaturedContent`
- `DELETE /Ptv/v1/FeaturedContent`
- `POST /Ptv/v1/FeaturedContent/Refresh`
- `GET /Ptv/Status`
- `GET /Ptv/FeaturedContent`
- `PUT /Ptv/FeaturedContent`
- `DELETE /Ptv/FeaturedContent`
- `POST /Ptv/FeaturedContent/Refresh`

All endpoints require an authenticated Jellyfin user. Featured-content reads, authoritative relationship reads, and minimal diagnostic client check-in/report publication are available to authenticated clients. Relationship reads omit mappings when either endpoint is not visible to the current user. `PUT /Ptv/v1/featured`, `DELETE /Ptv/v1/featured`, `POST /Ptv/v1/featured/refresh`, all relationship mutations, Reading override writes, all settings endpoints, and all diagnostic client listing/command/report reads require Jellyfin admin/elevated permissions. Remote diagnostics state is bounded, memory-only, automatically expires, and is described in [Remote client diagnostics](../docs/remote-diagnostics.md).

Release `0.5.0.0` starts the canonical PiggieTV companion version line. PiggieTV release numbers are independent of the Jellyfin ABI: this release still targets Jellyfin `10.11.8.0` and keeps plugin API v1 and featured cache v7 compatibility.

Release `0.5.0.0` advertises `readingSeriesOverrides`, `detailsRelationships`, and recommendation policy v2. Relationship mappings use stable Jellyfin item identities, an allowlisted relationship category, optional direction and display order, and plugin-configuration persistence. The API returns no titles or raw metadata, and the service keeps no relationship cache.

The cache write endpoint validates payload version, required fields, timestamps, unsafe client fields, and serialized size before saving. The plugin writes only to its fixed PiggieTV cache file and never accepts client-provided storage paths or file names. Validation errors use structured JSON:

```json
{
  "error": "message",
  "code": "PTV_CACHE_INVALID_PAYLOAD"
}
```

The cache is stored at:

```text
<Jellyfin plugin configurations path>/PiggieTV/featured-content-cache.json
```

The plugin refreshes this cache in the background on startup when the cache is missing or expired, then on the configured refresh interval. Manual dashboard refresh calls `POST /Ptv/v1/featured/refresh`. Reads continue serving the current cache during refresh; failed refreshes keep stale cache available. Refreshes are protected by a single lock and timeout so `refreshInProgress` cannot stay true forever.

## Settings

Plugin settings are stored in Jellyfin plugin configuration storage. The PiggieTV dashboard uses `/Ptv/v1/settings` to edit feature toggles, hero behavior, row limits, refresh interval, performance limits, and TMDb enrichment options.

TMDb tokens are write-only:

- `GET /Ptv/v1/settings` returns only `tmdbApiTokenConfigured`.
- `POST /Ptv/v1/settings` may include `tmdbSettings.tmdbApiToken` to replace the stored token.
- The plugin never returns or logs the token.

## Optional TMDb Enrichment

TMDb can improve category accuracy for rows such as Disney, family animation, and anime when Jellyfin items already have TMDb provider ids. Keep TMDb secrets on the Jellyfin server only. Do not place them in frontend JavaScript.

Preferred server environment variables:

```text
PTV_TMDB_READ_ACCESS_TOKEN
PTV_TMDB_API_KEY
```

The read access token is preferred. The API key is a fallback. If neither is configured, PiggieTV keeps using Jellyfin metadata only.

Build:

```powershell
dotnet publish src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj --configuration Release --output src/ptv/plugin/bin
```

Install manually by replacing the production plugin folder with the published files, including `meta.json`, such as:

```text
<Jellyfin config>/plugins/PiggieTV/
```

Then restart Jellyfin. Replacing `meta.json` matters because Jellyfin persists plugin support status there; a stale `NotSupported` manifest can keep the plugin disabled even after the DLL is fixed.

Copy the complete publish payload from `src/ptv/plugin/bin`:

```text
Jellyfin.Plugin.PiggieTV.dll
Jellyfin.Plugin.PiggieTV.deps.json
Jellyfin.Plugin.PiggieTV.pdb
Jellyfin.Plugin.PiggieTV.xml
meta.json
```

The DLL and `meta.json` are the required runtime/manifest pair. Keep the generated dependency manifest with the release; the PDB and XML documentation are safe operational diagnostics and should come from the same build rather than an older release.

Architecture docs:

- [API contracts](../docs/api-contracts.md)
- [Cache lifecycle](../docs/cache-lifecycle.md)
- [Render profiles](../docs/render-profiles.md)
- [Static assets](../docs/static-assets.md)
- [Plugin responsibilities](../docs/plugin-responsibilities.md)
- [Remote client diagnostics](../docs/remote-diagnostics.md)
