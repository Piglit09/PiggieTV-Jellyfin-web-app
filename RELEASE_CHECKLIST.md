# PiggieTV Release Checklist

## Compatibility

- [ ] Record Jellyfin Web, PiggieTV frontend, plugin, plugin API, and cache schema versions.
- [ ] Run `npm run test:plugin-contract` and review `src/ptv/docs/compatibility.md`.
- [ ] Confirm project, assembly, status response, publish manifest, and provider user agent all resolve to plugin `10.11.8.2`.
- [ ] Confirm `/Ptv/v1/status` advertises `readingSeriesOverrides`; plugin `10.11.8.1` must show an upgrade requirement for server-persisted Reading corrections without being reported disconnected.
- [ ] Confirm cache v7 remains readable or document the migration/invalidation.
- [ ] Confirm the release does not require an unplanned Jellyfin/plugin target change.

## Frontend

- [ ] Run focused tests, full Vitest, TypeScript, quality baselines, secret scan, Playwright, and `git diff --check`.
- [ ] Run `npm run build:production` and `npm run build:report`; compare initial assets with the prior release.
- [ ] Verify compile-time provenance in the PiggieTV dashboard and sanitized debug export.
- [ ] Verify the service worker offers, defers, dismisses, and safely activates an update without a reload loop.
- [ ] Confirm login/auth routes remain header-free and native Jellyfin fallback pages retain their header.

## Plugin

- [ ] Run `npm run test:plugin` and build the Release DLL with .NET 9.
- [ ] Verify `/Ptv/v1/status`, API major, plugin version, and cache schema after installation.
- [ ] Copy the complete `src/ptv/plugin/bin` payload and verify DLL/manifest versions match before restarting Jellyfin.
- [ ] Keep credentials in plugin configuration or host environment; never package local configuration.
- [ ] Restart Jellyfin after installing or replacing the plugin DLL.

## Manual Checks

- [ ] Desktop 2560x1271, tablet 1024x1366, mobile 390x844, and TV 1920x1080.
- [ ] Keyboard, touch, and remote focus/navigation.
- [ ] Movies/Shows exact filters, history, pagination, and stale-response suppression.
- [ ] Music playback and global controls survive route changes.
- [ ] Reading metadata, series grouping, and progress behavior.
- [ ] Admin/debug authorization and sanitized bounded diagnostics.

## Deployment And Rollback

- [ ] Back up the currently deployed web bundle, plugin DLL, and compatible plugin cache/configuration.
- [ ] Deploy the plugin before a frontend that requires a newer compatible API; otherwise deploy frontend independently.
- [ ] For this paired release, deploy plugin `10.11.8.2`, restart Jellyfin, verify the capability/status contract, and only then deploy the matching frontend.
- [ ] Clear browser/service-worker data only when the normal update flow cannot adopt the new bundle.
- [ ] Keep the previous frontend bundle and plugin DLL available for rollback.
- [ ] After rollback, verify API/cache compatibility before reusing newer cached payloads.

## 10.11.8.2 Candidate Record (2026-07-15)

- [x] Project, assembly, status, user agent, source manifest, and published manifest resolve to `10.11.8.2`.
- [x] Plugin API v1, cache v7, Jellyfin target `10.11.8`, and target ABI `10.11.8.0` remain unchanged.
- [x] Focused compatibility, full Vitest, plugin tests, contract, TypeScript, scoped ESLint, Release build/publish, production Webpack, secret scan, and whitespace checks passed.
- [ ] Deploy the five-file plugin payload, restart Jellyfin, verify status/capability, then deploy the paired frontend.
- [ ] Complete authenticated Reading override persistence and rollback-warning smoke tests.
