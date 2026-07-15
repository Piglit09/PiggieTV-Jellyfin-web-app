# PiggieTV Release Checklist

## Compatibility

- [ ] Record Jellyfin Web, PiggieTV frontend, plugin, plugin API, and cache schema versions.
- [ ] Run `npm run test:plugin-contract` and review `src/ptv/docs/compatibility.md`.
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
- [ ] Clear browser/service-worker data only when the normal update flow cannot adopt the new bundle.
- [ ] Keep the previous frontend bundle and plugin DLL available for rollback.
- [ ] After rollback, verify API/cache compatibility before reusing newer cached payloads.
