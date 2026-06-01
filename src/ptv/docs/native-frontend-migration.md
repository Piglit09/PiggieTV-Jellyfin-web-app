# PiggieTV Native Frontend Migration Plan

PiggieTV is moving toward a native Jellyfin-compatible frontend shell. The migration should happen in layers so Jellyfin authentication, playback, permissions, plugins, and admin pages continue to work while PTV replaces pages one at a time.

## Foundation Added

- `src/ptv/api/` now provides a PTV API facade over Jellyfin's existing web API client.
- `src/ptv/shell/routeController.ts` classifies routes as `native`, `enhanced`, or `fallback`.
- `src/ptv/shell/foundation.ts` exposes shared shell loading/error/route state.
- `src/ptv/core/app.js` boots the API namespace, route controller, and shell foundation before modules.

## Current PTV Modules

- `core`: lifecycle, router, observability, plugin API, image manager, client/render profiles, shell classes.
- `shell`: navigation, route ownership registry, overlays, route controller, shell foundation.
- `modules`: header, sidebar, cards, dashboard, signup, request, calendar, details enhancements, hero, playback chrome, reader, integrations.
- `pages`: home sections, hero mounting, row virtualization, row fetching.

## Already Native Or PTV-Owned

- Branded login/signup surfaces.
- Native signup, password reset, email verification, and invite/dashboard controls through the PiggieTV plugin.
- Release calendar page powered by PTV integration APIs.
- Request page and integration controls.
- Homepage hero, row cards, row virtualization, and featured cache rendering.
- PTV dashboard and row builder UI.
- PTV reader module scaffold and provider abstraction.
- Header/sidebar visual shell enhancements.

## Still Jellyfin Web Dependent

- App router and low-level route rendering.
- Login session creation and Jellyfin auth persistence.
- Playback engine and player routing.
- Library/list controller base pages.
- Item detail page base layout and actions.
- Search page base controller.
- Admin dashboard, user management, plugins, server settings.
- Some direct `ServerConnections`, `window.ApiClient`, and `playbackManager` calls in PTV modules.

## API Migration Rules

- New PTV code should call `src/ptv/api` instead of directly using `window.ApiClient` or `ServerConnections`.
- Existing direct calls can migrate incrementally when touching a feature.
- Playback should stay behind the existing Jellyfin playback manager until a native PTV player is deliberately scoped.
- Admin wrappers are frontend convenience only. Server-side plugin/admin endpoints must still enforce admin authorization.

## Recommended Replacement Order

1. API layer and route controller foundation.
2. Home page data loading and row/card rendering.
3. Library pages, especially Books, Comics, Manga, and mixed media grids.
4. Details pages and reader handoff.
5. Search page.
6. Login/signup route polish and session edge cases.
7. User settings.
8. Dashboard/admin pages last, preserving Jellyfin admin behavior until full parity exists.

## Security Rules

- Do not expose arbitrary backend files, Jellyfin files, logs, config files, SMTP passwords, API keys, tokens, or local paths.
- Reject path traversal, encoded traversal, null bytes, absolute paths, and double-encoded traversal in any backend file-like request.
- Public signup endpoints should expose only signup creation, email verification, password reset request, and password reset confirmation.
- Admin APIs must require an authenticated Jellyfin administrator.
- Debug export must redact secrets and avoid raw stack traces.
- Frontend route control must never bypass Jellyfin permissions or server policy.

## Files Changed In This Foundation Pass

- `src/ptv/api/types.ts`
- `src/ptv/api/client.ts`
- `src/ptv/api/auth.ts`
- `src/ptv/api/libraries.ts`
- `src/ptv/api/items.ts`
- `src/ptv/api/images.ts`
- `src/ptv/api/search.ts`
- `src/ptv/api/playback.ts`
- `src/ptv/api/admin.ts`
- `src/ptv/api/index.ts`
- `src/ptv/shell/routeController.ts`
- `src/ptv/shell/foundation.ts`
- `src/ptv/shell/index.ts`
- `src/ptv/core/app.js`
- `src/ptv/modules/signup/InviteAdminPage.tsx`

## Manual Test Checklist

- Load the login route and confirm Jellyfin login fields appear.
- Navigate Home, Details, Library, Dashboard, Signup, Request, and Release Calendar.
- Confirm unsupported/non-PTV routes still render through Jellyfin Web.
- Confirm `window.PTV.api` exists and can resolve current user, media folders, and item image URLs.
- Confirm `window.PTV.routeController.getState()` reports `native`, `enhanced`, or `fallback`.
- Confirm `window.PTV.shell.getFoundationStatus()` reports the current route and no stale errors.
- Confirm playback still starts through Jellyfin's playback manager.
- Confirm admin dashboard routes still require Jellyfin admin permissions server-side.

