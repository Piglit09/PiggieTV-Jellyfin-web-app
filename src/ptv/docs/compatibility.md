# PiggieTV Compatibility

PiggieTV compatibility is determined by the public plugin API and featured-cache schema, not by visually identical patch numbers.

| Component | Current source value | Status |
| --- | --- | --- |
| Jellyfin Web | 10.11.11 | Tested |
| PiggieTV frontend API | v1 | Tested |
| Featured cache | v7 | Tested |
| PiggieTV plugin | 10.11.8.2 | Tested |
| Plugin Jellyfin packages | 10.11.8 | Expected-compatible with Jellyfin 10.11.x |

## Compatibility policy

- Matching API major and cache schema versions are required.
- A different API major or cache schema is unsupported and shown as a version mismatch.
- Jellyfin Web and plugin targets within the same Jellyfin major/minor line are expected-compatible. Plugin release patch numbers may advance independently of the Jellyfin package target.
- Plugin `10.11.8.1` remains connected for API v1/cache v7 work, but it does not advertise `readingSeriesOverrides`; the frontend reports an upgrade requirement for server-persisted Reading corrections and labels browser storage as a local cache fallback.
- Plugin `10.11.8.2` advertises `readingSeriesOverrides` and is the minimum release for durable Reading corrections.
- A missing plugin remains a supported degraded frontend mode for Jellyfin-native fallbacks, but plugin-backed cache, metadata, signup, and integration features are unavailable.
- PiggieTV does not automatically upgrade Jellyfin or plugin package targets to make version labels match.

Run `npm run test:plugin-contract` whenever frontend plugin routes, `PTV_PLUGIN_API.version`, cache v7, plugin routes, or plugin package versions change.
