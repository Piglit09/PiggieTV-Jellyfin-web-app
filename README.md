# PiggieTV for Jellyfin Web

<p align="center">
  <img alt="PiggieTV banner" src="src/ptv/assets/logo/banner-light.png" width="420" />
</p>

PiggieTV is a custom Jellyfin Web experience focused on a polished, TV-friendly media interface. It keeps Jellyfin as the media server and playback foundation, while adding a PiggieTV frontend layer, server-side featured-content cache support, render profiles for low-power devices, and a dedicated PiggieTV admin dashboard.

This repository is based on [Jellyfin Web](https://github.com/jellyfin/jellyfin-web), the official web frontend for the [Jellyfin](https://jellyfin.org) media server.

## What Is Jellyfin?

Jellyfin is a free and open-source media system for hosting movies, shows, music, live TV, and other personal media. Jellyfin Web is the browser-based client used directly in desktop browsers and as the frontend foundation for many Jellyfin client experiences.

PiggieTV does not replace Jellyfin. It customizes and extends Jellyfin Web while preserving Jellyfin server compatibility.

## What PiggieTV Adds

### PiggieTV UI Layer

- Custom PiggieTV branding, logo assets, favicon variants, and shell styling.
- PiggieTV sidebar and drawer treatment.
- PiggieTV top navigation tabs for Home, Favorites, and Request.
- Native-feeling signup/invite route that embeds the jfa-go invite flow at `#/signup`.
- PiggieTV media rows, hero presentation, cards, badges, controls, and dashboard styling.
- Semantic token system for surfaces, text, elevation, density, states, motion, and theme evolution.
- Scoped PTV styles under `src/ptv` to avoid unnecessary Jellyfin core file changes.

### Home And Featured Content

- Shared featured-content system for hero and home rows.
- User-specific Continue Watching remains separate from the shared featured cache.
- Featured hero mix designed around:
  - Continue Watching
  - recommended shows
  - recommended movies
  - seasonal and holiday-aware content
- Curated row support for brands and collections such as Disney, animation, cartoons, anime, horror, music, and franchise-style groupings.
- Reusable media brand matcher direction, so future rows can be configuration-driven instead of one-off filters.

### PiggieTV Jellyfin Plugin

PiggieTV includes a minimal Jellyfin plugin companion in `src/ptv/plugin`.

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
POST   /Ptv/v1/integrations/{sonarr|radarr|lidarr|prowlarr}/test
GET    /Ptv/v1/integrations/arr/calendar
GET    /Ptv/v1/integrations/arr/downloads
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
- server-side settings for Jellyseerr, Sonarr, Radarr, Lidarr, Prowlarr, qBittorrent-style downloads, tag rows, and random discovery
- write-only secret handling for TMDb, Jellyseerr, *Arr, and download-provider credentials

Featured cache file:

```text
<Jellyfin plugin configurations path>/PiggieTV/featured-content-cache.json
```

Optional TMDb credentials must stay server-side. The plugin can read `PTV_TMDB_READ_ACCESS_TOKEN` or `PTV_TMDB_API_KEY` from the Jellyfin host environment to improve featured row accuracy without exposing secrets to browsers.

### Media Control Integrations

PiggieTV now has a native integration foundation inspired by the UX direction of Jellyfin-Enhanced, but implemented as PTV-owned settings and routes.

- Jellyseerr request/search settings with internal and external URL support.
- Server-side Jellyseerr proxy routes for search, request actions, and connection tests.
- Server-side *Arr connection settings and test routes for Sonarr, Radarr, Lidarr, and Prowlarr.
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
- signup and invite management entry point for the jfa-go invite engine
- Jellyseerr, *Arr, download provider, tag row, random discovery, and TMDb controls with section-level save buttons

### Signup And Invites

PiggieTV integrates [jfa-go](https://github.com/hrfee/jfa-go) as the account invite engine while keeping the UI native to PiggieTV.

- Public route: `#/signup`
- Invite backend: `https://signup.piggietv.com`
- Current invite flow: `https://signup.piggietv.com/invite/ysBDoDSMpv5fFMz9GPMxUL`
- Admin route: `#/dashboard/users/signup-invites`
- jfa-go admin/API secrets must stay server-side behind a PTV plugin/helper proxy.

The first native dashboard version embeds the jfa-go admin panel and documents the secure proxy path for future native invite create/disable/copy actions.

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

The goal is to make performance, cache behavior, route ownership, duplicate mounts, and fallback behavior observable instead of guessed.

## Repository Layout

PiggieTV-specific work is kept under `src/ptv` for compatibility with upstream Jellyfin Web.

```text
src/ptv/
  assets/       PiggieTV logos, icons, and backgrounds
  core/         config, plugin API, render profile, feature flags, events, logging
  docs/         PiggieTV architecture and API notes
  modules/      cache, dashboard, shell, performance, request, and UI modules
  pages/        PiggieTV page integrations such as home rows
  plugin/       Jellyfin plugin backend companion
  styles/       semantic tokens and PiggieTV Sass
```

Upstream Jellyfin Web code remains the base application. PTV changes should stay in `src/ptv` unless mounting into Jellyfin requires a narrow integration point.

## Build Requirements

Frontend:

- [Node.js](https://nodejs.org/en/download)
- npm

Plugin:

- .NET SDK 9.x

## Frontend Development

Install dependencies:

```sh
npm install
```

Run the local development server:

```sh
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

Lint PTV code:

```sh
npx eslint src/ptv
npx stylelint "src/ptv/**/*.{css,scss}"
```

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

## Documentation

PiggieTV architecture docs live in `src/ptv/docs`:

- [API contracts](src/ptv/docs/api-contracts.md)
- [Cache lifecycle](src/ptv/docs/cache-lifecycle.md)
- [Plugin responsibilities](src/ptv/docs/plugin-responsibilities.md)
- [Render profiles](src/ptv/docs/render-profiles.md)
- [Signup integration](src/ptv/docs/signup-integration.md)
- [Static assets](src/ptv/docs/static-assets.md)

Plugin-specific notes:

- [PiggieTV plugin README](src/ptv/plugin/README.md)

## Upstream Jellyfin

This project inherits from Jellyfin Web and should continue to respect Jellyfin's architecture, licensing, and compatibility needs.

Useful upstream links:

- [Jellyfin](https://jellyfin.org)
- [Jellyfin Web](https://github.com/jellyfin/jellyfin-web)
- [Jellyfin documentation](https://jellyfin.org/docs)
- [Jellyfin translations](https://translate.jellyfin.org/projects/jellyfin/jellyfin-web)

## Credits

- Jellyfin and Jellyfin Web provide the media server and web client foundation.
- [jfa-go](https://github.com/hrfee/jfa-go) provides the invite/signup engine used by PiggieTV's native signup surfaces.
- [Jellyfin-PauseScreen](https://github.com/BobHasNoSoul/Jellyfin-PauseScreen) inspired PiggieTV's managed pause-screen feature behavior, including pause-only metadata/artwork presentation.
- [Jellyfin-Enhanced](https://github.com/n00bcodr/Jellyfin-Enhanced) inspired PiggieTV's quality tag treatment and the native request, automation, tag filtering, and random discovery integration direction.
- [Home Screen Sections](https://github.com/IAmParadox27/jellyfin-plugin-home-sections) inspired PiggieTV's home row direction.

## License

Jellyfin Web is licensed under the GPL 2.0 license. PiggieTV modifications in this repository follow the same repository licensing unless otherwise noted in a specific file.

