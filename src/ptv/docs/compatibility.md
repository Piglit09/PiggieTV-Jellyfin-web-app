# PiggieTV Compatibility

PiggieTV compatibility is determined by the public plugin API and featured-cache schema, not by visually identical patch numbers.

| Component | Current source value | Status |
| --- | --- | --- |
| Jellyfin Web | 10.11.11 | Tested |
| PiggieTV frontend API | v1 | Tested |
| Featured cache | v7 | Tested |
| PiggieTV plugin | 0.5.0.0 | Tested |
| Plugin Jellyfin packages | 10.11.8 | Expected-compatible with Jellyfin 10.11.x |

## Compatibility policy

- Matching API major and cache schema versions are required.
- A different API major or cache schema is unsupported and shown as a version mismatch.
- The PiggieTV product version is independent of the Jellyfin compatibility line. `targetAbi` and the Jellyfin package target describe server compatibility; the plugin release version describes PiggieTV itself.
- Plugin `0.5.0.0` starts the canonical PiggieTV companion release line and advertises `readingSeriesOverrides`, `detailsRelationships`, and recommendation policy v2.
- Capability flags, rather than historical Jellyfin-derived PiggieTV release labels, determine whether durable Reading corrections and authoritative Details mappings are available.
- A missing plugin remains a supported degraded frontend mode for Jellyfin-native fallbacks, but plugin-backed cache, metadata, signup, and integration features are unavailable.
- PiggieTV does not automatically upgrade Jellyfin or plugin package targets to make version labels match.

Run `npm run test:plugin-contract` whenever frontend plugin routes, `PTV_PLUGIN_API.version`, cache v7, plugin routes, or plugin package versions change.
