# PiggieTV for Jellyfin Web

<p align="center">
  <img alt="PiggieTV banner" src="src/ptv/assets/logo/banner-light.png" width="420" />
</p>

PiggieTV is a custom Jellyfin Web experience focused on a polished, TV-friendly media interface. It keeps Jellyfin as the media server and playback foundation, while adding a PiggieTV frontend layer, server-side featured-content cache support, a configurable home-row engine, native signup/email tools, release-calendar integrations, render profiles for low-power devices, and a dedicated PiggieTV admin dashboard.

This repository is based on [Jellyfin Web](https://github.com/jellyfin/jellyfin-web), the official web frontend for the [Jellyfin](https://jellyfin.org) media server.

## What Is Jellyfin?

Jellyfin is a free and open-source media system for hosting movies, shows, music, live TV, and other personal media. Jellyfin Web is the browser-based client used directly in desktop browsers and as the frontend foundation for many Jellyfin client experiences.

PiggieTV does not replace Jellyfin. It customizes and extends Jellyfin Web while preserving Jellyfin server compatibility.

## What PiggieTV Adds

### PiggieTV UI Layer

- Custom PiggieTV branding, logo assets, favicon variants, and shell styling.
- PiggieTV sidebar and drawer treatment.
- PiggieTV top navigation tabs and sidebar entries for Home, Favorites, Request, Release Calendar, and Signup surfaces.
- Native PiggieTV signup route at `#/signup` with email verification and password reset support.
- PiggieTV media rows, hero presentation, cards, badges, controls, and dashboard styling.
- Semantic token system for surfaces, text, elevation, density, states, motion, and theme evolution.
- Scoped PTV styles under `src/ptv` to avoid unnecessary Jellyfin core file changes.

### Home And Featured Content

- Shared featured-content system for hero and home rows.
- User-specific Continue Watching remains separate from the shared featured cache.
- Dashboard-driven Row Builder for default, latest, requested, genre, studio, collection, library, seasonal, and curated row rules.
- Homepage row hierarchy for premium rows, curated discovery rows, and lower-weight deep catalog rows.
- Desktop/browser row virtualization with lazy hydration so rows can be generated without mounting every row shell immediately.
- Featured hero mix designed around:
  - Continue Watching
  - recommended shows
  - recommended movies
  - seasonal and holiday-aware content
- Curated row support for brands and collections such as Disney, animation, cartoons, anime, horror, music, and franchise-style groupings.
- Duplicate-version cleanup so the same movie in multiple qualities appears once in rows while Jellyfin detail/playback can still choose quality.
- Reusable media brand matcher and row-rule system so rows are configuration-driven instead of one-off filters.

### PiggieTV Jellyfin Plugin

PiggieTV includes a Jellyfin plugin companion in `src/ptv/plugin`.

Current versioned API surface:

```text
GET    /Ptv/v1/status
GET    /Ptv/v1/settings
POST   /Ptv/v1/settings
POST   /Ptv/v1/settings/reset
GET    /Ptv/v1/featured
PUT    /Ptv/v1/featured
DELETE /Ptv/v1/featured
POST   /Ptv/v1/featured/refresh
GET    /Ptv/v1/integrations/status
POST   /Ptv/v1/integrations/seerr/test
GET    /Ptv/v1/integrations/seerr/search
POST   /Ptv/v1/integrations/seerr/request
GET    /Ptv/v1/integrations/seerr/requests
POST   /Ptv/v1/integrations/{sonarr|radarr|lidarr|prowlarr}/test
GET    /Ptv/v1/calendar
GET    /Ptv/v1/integrations/arr/calendar
GET    /Ptv/v1/integrations/arr/downloads
GET    /Ptv/v1/rows
POST   /Ptv/v1/rows
POST   /Ptv/v1/rows/validate
POST   /Ptv/v1/rows/preview
POST   /Ptv/v1/signup/create-user
POST   /Ptv/v1/signup/verify-email
POST   /Ptv/v1/signup/password-reset/request
POST   /Ptv/v1/signup/password-reset/confirm
GET    /Ptv/v1/signup/admin/settings
POST   /Ptv/v1/signup/admin/settings
POST   /Ptv/v1/signup/admin/email/test
GET    /Ptv/v1/signup/admin/invites
POST   /Ptv/v1/signup/admin/invites
POST   /Ptv/v1/signup/admin/invites/{id}/disable
DELETE /Ptv/v1/signup/admin/invites/{id}
GET    /Ptv/v1/tags
GET    /Ptv/v1/tags/rows
POST   /Ptv/v1/tags/rows
GET    /Ptv/v1/random/movie
GET    /Ptv/v1/random/episode
GET    /Ptv/v1/random/anime
GET    /Ptv/v1/random/library/{libraryId}
```

The plugin provides:

- plugin health/status reporting
- shared featured-content cache storage
- server-side featured cache refresh
- optional server-side TMDb metadata enrichment for Disney, family animation, anime, and other featured row matching
- startup refresh when cache is missing or expired
- 12-hour default refresh interval
- stale cache serving when refresh fails
- admin-only cache writes, clears, and manual refreshes
- authenticated-user cache reads
- structured error responses
- fixed plugin-owned cache file path
- server-side settings for native signup, SMTP email, Jellyseerr, Sonarr, Radarr, Lidarr, Prowlarr, downloads, tag rows, random discovery, and Row Builder
- write-only secret handling for SMTP passwords, TMDb, Jellyseerr, *Arr, and download-provider credentials
- redacted signup, integration, route, cache, provider, and debug diagnostics for dashboard troubleshooting

Featured cache file:

```text
<Jellyfin plugin configurations path>/PiggieTV/featured-content-cache.json
```

Optional TMDb credentials must stay server-side. The plugin can read `PTV_TMDB_READ_ACCESS_TOKEN` or `PTV_TMDB_API_KEY` from the Jellyfin host environment to improve featured row accuracy without exposing secrets to browsers.

### Media Control Integrations

PiggieTV now has a native integration foundation inspired by the UX direction of Jellyfin-Enhanced, but implemented as PTV-owned settings and routes.

- Jellyseerr request/search settings with internal and external URL support.
- Server-side Jellyseerr proxy routes for search, request actions, and connection tests.
- Jellyseerr features auto-enable once a valid API key is saved.
- Server-side *Arr connection settings and test routes for Sonarr, Radarr, Lidarr, and Prowlarr.
- Release Calendar route and sidebar entry available to users, backed by configured Sonarr, Radarr, and Lidarr services.
- *Arr calendar features auto-enable when an eligible *Arr service is configured.
- Download provider settings for qBittorrent-style dashboards without exposing credentials to frontend JavaScript.
- Tag-based smart row settings for rows such as Disney Animation, Anime Movies, Holiday, Halloween, Christmas, Marvel, DC, and Studio Ghibli.
- Random discovery settings for movie, episode, anime, and current-library random actions.

API keys and passwords are stored only in the Jellyfin plugin configuration. Public settings responses return `apiKeyConfigured`, `usernameConfigured`, and `passwordConfigured` booleans instead of secret values.

### PiggieTV Dashboard

PiggieTV adds a dashboard control surface inside the Jellyfin admin dashboard.

The dashboard shows:

- plugin connected/missing/unreachable/unauthorized/version mismatch state
- API version and API path
- read/write cache permissions
- cache source: plugin, named configuration, or memory
- cache freshness, timestamps, item counts, and refresh timing
- server refresh progress and errors
- active render profile
- client profile flags
- PTV debug and performance overlay controls
- feature toggles for hero, home rows, dynamic backdrops, and low-power mode
- Row Builder controls, preview, diagnostics, performance estimates, and cache refresh flow
- native signup defaults, email engine settings, email test action, pending verification/reset counters, and signup debug copy
- Jellyseerr, *Arr, release calendar, download provider, tag row, random discovery, and TMDb controls with section-level save buttons

### Signup And Invites

PiggieTV includes a native signup engine for creating normal local Jellyfin users through server-side plugin endpoints. Privileged Jellyfin user creation stays in the plugin backend; admin tokens and SMTP passwords are never shipped to browser JavaScript.

- Public route: `#/signup`
- Admin route: `#/dashboard/users/signup-invites`
- Email is required for new native signups.
- New accounts are held as pending verifications until the user clicks the verification email link; pending records expire and are cleaned up automatically.
- Verification links return to `#/signup?verify=...`, then the backend finalizes Jellyfin user creation and shows a branded success page with a 10-second login redirect.
- Verification email links expire after 30 minutes by default.
- Verification emails use a branded HTML template with the PiggieTV logo, a centered Verify Email button, and a plain-text fallback.
- Password reset emails send a random reset code that can reset the password through the signup route.
- SMTP settings, sender identity, email logo URL, reset-code expiry, verification-link expiry, and test email are configured in the PiggieTV dashboard.
- Signup debug output includes only redacted health data: configured flags, counts, sender domain, route discovery, rate-limit bucket counts, and timing.
- Public signup, verification, and password-reset routes use server-side validation, hashed single-use tokens/codes, expiry cleanup, and basic IP/email rate limiting.
- Native signup replaces the older external invite-engine integration path; signup/email settings live entirely in PiggieTV.

### Performance And Device Profiles

PiggieTV targets desktop browsers, mobile browsers, Fire TV, Roku-style browser clients, LG webOS, Smart TVs, and other constrained devices.

Render profiles:

```text
PTV_DESKTOP
PTV_TV
PTV_LOWPOWER
```

Performance-oriented behavior includes:

- reduced visual cost on TV and low-power clients
- lower animation pressure on embedded browsers
- reduced blur/backdrop effects for weak GPUs
- lazy loading for non-visible media assets
- preload focus on current and next hero media
- request dedupe and priority queues for hero, visible row, and offscreen row image loading
- row virtualization with overscan and debug metrics for mounted/deferred/hydrated rows
- WebP/static asset optimization direction
- server-prepared featured payloads so TVs render instead of ranking/filtering large libraries

### Observability And Debugging

PiggieTV includes debug and performance hooks for diagnosing real device problems.

Useful runtime controls:

```js
window.PTV_DEBUG = true
window.PTV?.debug?.report?.()
window.PTV?.performanceOverlay?.(true)
```

The goal is to make performance, cache behavior, route ownership, signup/email health, duplicate mounts, image churn, and fallback behavior observable instead of guessed. Debug reports redact secrets and include configured booleans instead of SMTP/API key values.

## Repository Layout

PiggieTV-specific work is kept under `src/ptv` for compatibility with upstream Jellyfin Web.

```text
src/ptv/
  assets/       PiggieTV logos, icons, and backgrounds
  core/         config, plugin API, render profile, feature flags, events, logging
  docs/         PiggieTV architecture and API notes
  modules/      cache, calendar, dashboard, integrations, reader, request, shell, signup, and UI modules
  pages/        PiggieTV page integrations such as home rows
  plugin/       Jellyfin plugin backend companion
  styles/       semantic tokens and PiggieTV Sass
```

Upstream Jellyfin Web code remains the base application. PTV changes should stay in `src/ptv` unless mounting into Jellyfin requires a narrow integration point.

## Build Requirements

Frontend:

- [Node.js](https://nodejs.org/en/download) 20.x
- npm 9.6.4 through 10.x

Plugin:

- .NET SDK 9.x

## Frontend Development

Install the exact locked dependencies:

```sh
npm ci
```

Run the local development server:

```sh
npm start
```

When the Webpack host and Jellyfin host differ, configure the backend explicitly before starting Webpack. The development server never infers or rewrites the Jellyfin hostname from the frontend hostname, and production builds ignore this variable.

```sh
PTV_DEV_JELLYFIN_URL=http://jellyfin-host:8096 npm start
```

PowerShell:

```powershell
$env:PTV_DEV_JELLYFIN_URL = 'http://jellyfin-host:8096'
npm start
```

Type-check:

```sh
npm run build:check
```

Development build:

```sh
npm run build:development
```

Production build:

```sh
npm run build:production
```

Run tests and the scoped quality gates:

```sh
npm run test:ptv
npm test
npm run lint:ptv
npm run stylelint:ptv
npm run secret:scan
```

Run deterministic Chromium integration tests and summarize a production build:

```sh
npm run test:e2e
npm run build:production
npm run build:report
```

The browser suite uses a controlled local harness and does not require Jellyfin credentials. Production builds inject a sanitized frontend commit, build date, build ID, build mode, and Jellyfin Web version. The PiggieTV dashboard combines these values with connected plugin/API/cache versions.

See [CONTRIBUTING.md](CONTRIBUTING.md) for required CI checks, commit guidance, privacy rules, and device validation. See [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) before packaging or deployment.

## Plugin Build

Build the PiggieTV Jellyfin plugin:

```sh
dotnet build src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj --configuration Release
```

Publish plugin files:

```sh
dotnet publish src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj --configuration Release --output src/ptv/plugin/bin
```

Install manually by copying the published plugin output into a Jellyfin plugin folder such as:

```text
<Jellyfin config>/plugins/PiggieTV/
```

Then restart Jellyfin.

The current companion release is `10.11.8.2`. Deploy the complete matching output from `src/ptv/plugin/bin`: `Jellyfin.Plugin.PiggieTV.dll`, `Jellyfin.Plugin.PiggieTV.deps.json`, `Jellyfin.Plugin.PiggieTV.pdb`, `Jellyfin.Plugin.PiggieTV.xml`, and `meta.json`. The DLL and manifest are required; never mix files from different plugin builds. Plugin API v1, featured cache v7, and the Jellyfin package target `10.11.8` remain unchanged.

## Documentation

PiggieTV architecture docs live in `src/ptv/docs`:

- [API contracts](src/ptv/docs/api-contracts.md)
- [Cache lifecycle](src/ptv/docs/cache-lifecycle.md)
- [Plugin responsibilities](src/ptv/docs/plugin-responsibilities.md)
- [Render profiles](src/ptv/docs/render-profiles.md)
- [Static assets](src/ptv/docs/static-assets.md)

Plugin-specific notes:

- [PiggieTV plugin README](src/ptv/plugin/README.md)
- [Frontend/plugin compatibility](src/ptv/docs/compatibility.md)

## Upstream Jellyfin

This project inherits from Jellyfin Web and should continue to respect Jellyfin's architecture, licensing, and compatibility needs.

Useful upstream links:

- [Jellyfin](https://jellyfin.org)
- [Jellyfin Web](https://github.com/jellyfin/jellyfin-web)
- [Jellyfin documentation](https://jellyfin.org/docs)
- [Jellyfin translations](https://translate.jellyfin.org/projects/jellyfin/jellyfin-web)

## Credits

- Jellyfin and Jellyfin Web provide the media server and web client foundation.
- [jfa-go](https://github.com/hrfee/jfa-go) inspired PiggieTV's native signup/invite idea.
- [Jellyfin-PauseScreen](https://github.com/BobHasNoSoul/Jellyfin-PauseScreen) inspired PiggieTV's managed pause-screen feature behavior, including pause-only metadata/artwork presentation.
- [Jellyfin-Enhanced](https://github.com/n00bcodr/Jellyfin-Enhanced) inspired PiggieTV's quality tag treatment and the native request, automation, tag filtering, and random discovery integration direction.
- [Home Screen Sections](https://github.com/IAmParadox27/jellyfin-plugin-home-sections) inspired PiggieTV's home row direction.

## License

Jellyfin Web is licensed under the GPL 2.0 license. PiggieTV modifications in this repository follow the same repository licensing unless otherwise noted in a specific file.
