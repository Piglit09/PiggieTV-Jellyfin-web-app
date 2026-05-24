# PiggieTV Jellyfin Plugin

Minimal server-side companion for the PiggieTV web client.

Initial endpoints only:

- `GET /Ptv/v1/Status`
- `GET /Ptv/v1/FeaturedContent`
- `PUT /Ptv/v1/FeaturedContent`
- `DELETE /Ptv/v1/FeaturedContent`

Temporary compatibility aliases are also available:

- `GET /Ptv/Status`
- `GET /Ptv/FeaturedContent`
- `PUT /Ptv/FeaturedContent`
- `DELETE /Ptv/FeaturedContent`

All endpoints require an authenticated Jellyfin user. Featured-content reads are available to any authenticated user, while `PUT /Ptv/v1/FeaturedContent` and `DELETE /Ptv/v1/FeaturedContent` require Jellyfin admin/elevated permissions.

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

Build:

```powershell
dotnet publish src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj --configuration Release --output src/ptv/plugin/bin
```

Install manually by copying the published DLLs into a Jellyfin plugin folder such as:

```text
<Jellyfin config>/plugins/PiggieTV/
```

Then restart Jellyfin.

Architecture docs:

- [API contracts](../docs/api-contracts.md)
- [Cache lifecycle](../docs/cache-lifecycle.md)
- [Render profiles](../docs/render-profiles.md)
- [Static assets](../docs/static-assets.md)
- [Plugin responsibilities](../docs/plugin-responsibilities.md)
