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
- `GET /Ptv/v1/integrations/status` (administrator)
- `GET /Ptv/v1/integrations/calendar-availability` (secret-free client capability)
- `GET /Ptv/v1/calendar`
- `GET /Ptv/v1/integrations/arr/calendar` (alias)
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
- `POST /Ptv/v1/reports/media`
- `GET /Ptv/v1/reports/media` (administrator)
- `DELETE /Ptv/v1/reports/media/{reportId}` (administrator)
- `GET /Ptv/v1/metadata-quality/status`
- `POST /Ptv/v1/metadata-quality/ai/test`
- `GET /Ptv/v1/metadata-quality/summary`
- `GET /Ptv/v1/metadata-quality/results`
- `GET /Ptv/v1/metadata-quality/results/{itemId}`
- `POST /Ptv/v1/metadata-quality/scan`
- `POST /Ptv/v1/metadata-quality/scan/cancel`
- `POST /Ptv/v1/metadata-quality/results/{itemId}/resolve`
- `GET /Ptv/v1/metadata-quality/settings`
- `POST /Ptv/v1/metadata-quality/settings`
- `POST /Ptv/v1/metadata-quality/index/rebuild`

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

All endpoints require an authenticated Jellyfin user. Featured-content reads, authoritative relationship reads, minimal diagnostic client check-in/report publication, and media issue submission are available to authenticated clients. Featured-content reads resolve the authenticated Jellyfin user and apply Jellyfin's item-visibility policy before serialization; the expensive source cache stays shared and is never replaced by a user's filtered response. Relationship reads and media issue submissions verify that the referenced item is visible to the current user. `PUT /Ptv/v1/featured`, `DELETE /Ptv/v1/featured`, `POST /Ptv/v1/featured/refresh`, all relationship mutations, Reading override writes, all settings endpoints, all Metadata Quality endpoints, all media-report reads/deletes, and all diagnostic client listing/command/report reads require Jellyfin admin/elevated permissions. Remote diagnostics state is bounded, memory-only, automatically expires, and is described in [Remote client diagnostics](../docs/remote-diagnostics.md). Media issue intake uses a separate bounded, atomic server-local queue described in [Media issue reports](../docs/media-reports.md).

The Calendar endpoints aggregate a bounded date range from enabled Sonarr, Radarr, and Lidarr integrations. Prowlarr is reported as unsupported because it has no media release calendar. Provider credentials remain in Plugin configuration and are sent only in server-side `X-Api-Key` requests. The authenticated client availability response exposes only capability and configured/enabled booleans; detailed integration status is administrator-only and returns null API-key fields. A failed provider is represented in its service result without discarding healthy providers' events.

Metadata Quality persists immutable scan generations in a server-local SQLite index and serves filtered, sorted, 50-row pages without loading the retained result document into memory. The original atomic JSON document remains a migration/reference/rollback snapshot rather than a second authority. New generations are built and validated while readers continue using the current generation, then activated atomically; interrupted builds never replace the active generation. The confirmed rebuild endpoint is a recovery operation that stages and validates a replacement from JSON before installation and retains only the two newest replaced-database backups.

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

## Metadata Quality

The `PTV Metadata Quality Scan` scheduled task and `/Ptv/v1/metadata-quality/*` API provide a read-only metadata audit and human review queue. Scans run server-side in bounded batches, persist only privacy-reduced item evidence, skip unchanged fingerprints, and use Jellyfin's configured remote metadata providers only for uncertain items. The API exposes no automatic metadata-fix or provider-apply operation; corrections remain in PiggieTV Metadata Manager/Jellyfin Identify.

Optional AI reasoning is disabled by default. `OPENAI_API_KEY` is the only supported credential source and is read only from the Jellyfin process environment:

```text
OPENAI_API_KEY
PTV_METADATA_QUALITY_OPENAI_MODEL   # optional environment model override
```

The model resolves from the environment override, then the non-secret Metadata Quality model setting, then `gpt-5.6-luna`. That default was verified on 2026-08-13 against the [OpenAI API model catalog](https://developers.openai.com/api/docs/models/gpt-5.6-luna) for Responses API and Structured Outputs support.

The key is never returned to the browser, written to plugin/Metadata Quality settings, backed up by the PiggieTV account backup, or logged. Unknown persisted settings remain server-side and are excluded from API projections. A model value that exactly matches the active credential is rejected. There is no browser-managed credential write/delete API. The administrator-only status and connection-test APIs expose only safe configured/source/model/result fields; the test uses one tiny synthetic structured request and never library metadata. AI input contains only bounded identity evidence and verified candidate summaries, uses `store: false`, and cannot supply a provider ID.

For systemd production, keep the secret in a server-only file outside this repository, owned by the Jellyfin service account with mode `0600`:

```text
# /etc/jellyfin/piggietv-openai.env
OPENAI_API_KEY=<secret>
PTV_METADATA_QUALITY_OPENAI_MODEL=gpt-5.6-luna
```

Reference it from a Jellyfin service override and restart Jellyfin after changes:

```ini
[Service]
EnvironmentFile=/etc/jellyfin/piggietv-openai.env
```

Use a dedicated OpenAI project/key with restricted permissions and spend alerts where practical. Rotate an environment credential by changing the protected server file and restarting Jellyfin; PiggieTV cannot reveal or rotate it. See [Metadata Quality architecture](../../../docs/ptv-metadata-quality.md).

Build:

The current Plugin release requires the .NET 10 SDK and targets Jellyfin Server 12.2 or newer (`targetAbi` is a minimum, not proof of runtime compatibility with later releases). A 12.0 server must keep its prior Plugin until the Server and Plugin can be upgraded together.

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
- [Media issue reports](../docs/media-reports.md)
