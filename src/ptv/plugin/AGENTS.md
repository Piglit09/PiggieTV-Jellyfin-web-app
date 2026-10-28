# PiggieTV Plugin Agent Instructions

The repository authority, workspace preflight, artifact provenance, environment registry, and deployment restrictions in the root `AGENTS.md` also apply to the embedded Plugin. Plugin source edits and builds belong to the same approved PTV Web Git checkout; `src/ptv/plugin/bin` is build output, not a separate source authority.

## Canonical plugin release version

- `Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj` and its `PtvPluginVersion` property are the only canonical PiggieTV Plugin release-version authority. The Jellyfin package target and ABI are compatibility values, not PiggieTV release numbers.
- Treat the PiggieTV product version as three components (`major.minor.patch`), with every component constrained to `0..99`. The deployed .NET/Jellyfin form is always the product version plus a zero revision (`major.minor.patch.0`).
- For each material parent user request that changes shipped PiggieTV Plugin code, bump the plugin version exactly once with `node scripts/ptv-plugin-version.cjs bump` before final handoff.
- Do not bump for read-only investigation, test reruns, status requests, or continuation messages belonging to the same logical parent request. Before bumping, inspect the current diff and coordination messages so parallel or resumed agents never bump the same request twice.
- Automatic bumps advance one patch step and carry `x.y.99.0` to `x.(y+1).0.0`. They never change the major component. At `x.99.99.0`, stop and obtain explicit major-release direction.

## Source synchronization and publishing

- `node scripts/ptv-plugin-version.cjs check` must confirm that the project version, source `meta.json`, release contract test, and frontend/plugin contract checker all contain the same four-part deployed version.
- A source bump updates only those synchronized source declarations. It must not edit `src/ptv/plugin/bin`, a plugin catalog, a published archive, or checksums.
- After a bump or release-tooling change, run `node --test scripts/ptv-plugin-version.test.cjs`, the version `check`, the frontend/plugin contract check, and the plugin test suite before publishing.
- Publish `src/ptv/plugin/bin` only from the checked source version. Verify the built assembly and copied `meta.json` report that version before deployment.
- Update a plugin catalog only after the publish artifact is final. Its version, timestamp, checksum, and download location must describe that exact artifact; never use a source bump alone as a catalog release.
