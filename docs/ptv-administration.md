# PiggieTV Administration architecture

PiggieTV Web owns the administrator overview at `#/settings/admin` and the native PiggieTV, People, Media, Playback, Live TV/DVR, Plugin Manager, Server, Logs, Backups, and Scheduled Tasks workspaces documented below. The administration shell also surrounds third-party plugin configuration pages without taking ownership of their contracts. Jellyfin remains authoritative for server configuration and runtime state, accounts, registered devices, sessions, activity records, libraries, media paths, policies, permissions, passwords, item metadata, artwork, identification, refresh operations, playback and Live TV configuration, tuners, listings providers, installed plugins, package catalogs, repositories, API keys, Jellyfin backup manifests, log files, restart-required state, and scheduled-task execution. The PiggieTV plugin remains authoritative for PTV configuration, Home Row configuration, PTV profiles, verified email state, Signup & Invites, and PiggieTV account-backup health and operations.

The first-party administration migration is complete. PiggieTV Configuration, Home Rows, and Diagnostics are native Settings/Admin destinations. Their former Dashboard URLs remain replacement redirects for bookmarks. Arbitrary third-party dynamic plugin configuration pages remain **PLUGIN_OWNED** because their schemas and persistence belong to the installed plugins, and parental controls remain a documented **LEGACY_COMPATIBILITY** user-detail workflow.

## Ownership and architecture

```text
PTV Administration UI
        |
        +-- centralized administration destination registry
        |       +-- static Jellyfin and PTV routes
        |       +-- server-discovered plugin configuration pages
        |
        +-- centralized dashboard queries and normalization
                +-- System API
                +-- Sessions API
                +-- Scheduled Tasks API
                +-- Library API
                +-- PiggieTV status API

        +-- centralized user queries and normalization
                +-- Jellyfin Users and User Policy APIs
                +-- Jellyfin Sessions and Media Folders APIs
                +-- PiggieTV administrator profile summary API

        +-- centralized Signup and invitation queries
                +-- PiggieTV Signup settings, email-test, and invitation APIs
                +-- PiggieTV account-administration health API
                +-- Jellyfin Media Folders API for default library access

        +-- shared People queries and normalization
                +-- Jellyfin registered Devices API
                +-- Jellyfin Sessions and Users APIs
                +-- Jellyfin paged Activity Log API

        +-- centralized library queries and normalization
                +-- Jellyfin Virtual Folders and Library Options APIs
                +-- Jellyfin Environment directory-browser APIs
                +-- Jellyfin Scheduled Tasks and item-refresh APIs

        +-- centralized Scheduled Tasks queries and normalization
                +-- Jellyfin task list and detail APIs
                +-- Jellyfin start, stop, and trigger APIs

        +-- centralized Library Display query and normalization
                +-- Jellyfin Server Configuration API
                +-- Jellyfin named metadata Configuration API

        +-- centralized Metadata and NFO configuration queries
                +-- Jellyfin Server Configuration and Localization APIs
                +-- Jellyfin named xbmcmetadata Configuration API
                +-- Jellyfin Users API for NFO user labels

        +-- centralized item-level Metadata Manager queries
                +-- Jellyfin item catalog, search, and detail APIs
                +-- Jellyfin item update and image APIs
                +-- Jellyfin remote-search/identify and item-refresh APIs

        +-- centralized Metadata Quality queries
                +-- PiggieTV scanner status, summary, settings, and review-result APIs
                +-- Jellyfin bounded item enumeration and configured provider searches
                +-- optional server-side OpenAI structured reasoning

        +-- centralized Playback configuration queries
                +-- Jellyfin full Server Configuration API
                +-- Jellyfin named encoding Configuration API

        +-- centralized Live TV and DVR queries
                +-- Jellyfin Live TV capability and tuner APIs
                +-- Jellyfin guide-provider and lineup APIs
                +-- Jellyfin named livetv Configuration API
                +-- shared Scheduled Tasks API for Refresh Guide

        +-- centralized Plugin Administration queries
                +-- Jellyfin installed Plugins API
                +-- Jellyfin Packages and Repositories APIs
                +-- Jellyfin plugin action APIs
                +-- shared ConfigurationPages discovery

        +-- centralized Server Administration queries
                +-- Jellyfin general, branding, network, and system APIs
                +-- Jellyfin API-key, backup, and log APIs
                +-- PiggieTV account-backup APIs
```

The primary implementation boundaries are:

- `adminNavigation.ts`: the single static destination/category registry, route aliases, explicit detail-route exclusions, active-route resolution, and dynamic plugin destination normalization.
- `useAdminNavigation.ts`: combines the static registry with configuration pages reported by the connected server.
- `PtvAdminLayout.tsx`: renders the same grouped administration navigation around PTV Settings routes and legacy Dashboard routes.
- `adminDashboardService.ts` and `adminDashboardAdapters.ts`: authenticated source loaders and the normalization layer between backend response shapes and dashboard-facing models.
- `useAdminDashboard.ts`: independent React Query source state, polling, retry, abort, stale-data, and coordinated manual-refresh behavior.
- `PtvAdminDashboard.tsx`: presentation only; cards and panels consume normalized dashboard data.
- `adminUsersService.ts` and `adminUsersAdapters.ts`: authoritative Jellyfin account operations plus the normalization and merge boundary for Jellyfin users, PTV profile summaries, sessions, and library access.
- `useAdminUsers.ts`: server- and user-scoped React Query state, bounded batch enrichment, abort propagation, partial failures, cache invalidation, and single-flight list refresh.
- `AdminUsersRoute.tsx`, `PtvAdminUsersPage.tsx`, and `PtvAdminUserDetail.tsx`: the native list/detail route boundary and presentation.
- The native Signup & Invites module: separate component-local settings/invitation/account-health/library source ownership, stale-response guards, explicit mutations, secret-safe SMTP handling, and the route boundary at `#/settings/admin/users/signup-invites`.
- `adminPeopleService.ts`, `adminPeopleModel.ts`, and `adminPeopleAdapters.ts`: source-isolated registered-device/session/user/activity loaders, the shared normalized People model, privacy filtering, and authoritative device-removal safety checks.
- `useAdminPeople.ts`: server/source/page/scope query identities, partial-source state, visibility-aware Sessions and Activity refresh, manual-refresh single-flight behavior, and mutation invalidation.
- `AdminPeopleRoute.tsx`, `PtvAdminDevicesPage.tsx`, and `PtvAdminActivityPage.tsx`: the administrator-gated native Devices and Activity route boundaries and presentation.
- `adminLibrariesService.ts` and `adminLibrariesAdapters.ts`: authoritative library reads and focused mutations plus the normalization/merge boundary that preserves unmanaged Jellyfin options.
- `useAdminLibraries.ts`: server-, source-, and library-scoped queries, bounded scan-task refresh, mutation invalidation, and independent provider-summary failure state.
- `AdminLibrariesRoute.tsx`, `PtvAdminLibrariesPage.tsx`, and `PtvAdminLibraryDetail.tsx`: the native list/detail route boundary and presentation.
- `adminLibraryDisplayService.ts` and `adminLibraryDisplayAdapters.ts`: the composite two-resource read, strict six-field normalization, conflict check, and lossless focused merge boundary.
- `useAdminLibraryDisplay.ts` and `PtvAdminLibraryDisplayPage.tsx`: server-scoped query/mutation ownership and the explicit-save native form.
- The native Metadata and NFO modules: strict global-setting normalization, server-scoped query ownership, conflict-aware full-document preservation, and explicit-save forms. Per-library provider/saver state remains owned by Libraries.
- The native Plugin Administration module: server-scoped installed, catalog, repository, detail, and configuration-page normalization with source-isolated failures and explicit Jellyfin-owned actions. Arbitrary plugin configuration forms remain plugin-owned.
- The native Metadata Manager module: bounded catalog/search queries, normalized item detail, explicit metadata/artwork/identify/refresh actions, server/item/source-scoped cache ownership, request cancellation, and conflict-aware item saves. Jellyfin remains the metadata and mutation authority.
- The native Metadata Quality module: server-side bounded scanning, deterministic rule scoring, Jellyfin-provider verification, optional server-only AI reasoning, versioned atomic result persistence, and a paginated review queue that delegates corrections to Metadata Manager.
- The native Playback module: section-scoped normalization and query identities for Streaming, Transcoding, Resume, and Trickplay; fresh-authority conflict checks; and lossless full-document persistence over Jellyfin configuration APIs.
- `AdminLiveTvRoute.tsx`, `adminLiveTvService.ts`, `adminLiveTvAdapters.ts`, and `useAdminLiveTv.ts`: route normalization, source-specific Live TV/DVR authority, lossless configuration updates, explicit-only discovery/lookups, and server-scoped cache ownership.
- `AdminServerRoute.tsx` and the native Server configuration/operations modules: route-backed General, Branding, Networking, API Keys, Backups, and Logs presentation; fresh-authority configuration writes; opaque secret/path identities; and source-specific cache ownership.

Missing source values remain unknown or unavailable. They are never converted to a misleading zero.

## Native PiggieTV administration workspaces

The PiggieTV group has three first-party destinations under the common `PtvAdminLayout`. Configuration owns plugin feature, integration, cache, and operational defaults; Home Rows owns row rules, recommendation preview/generation, ordering, visibility, import/export, and featured-cache refresh; Diagnostics owns observational runtime inspection, privacy-bounded export, and explicit remote-diagnostics operations. Diagnostics does not write Configuration, Configuration does not edit row rules, and the legacy Recommendations URL does not create a fourth owner.

| Workspace | Canonical route | Authoritative read sources | Normal initial request budget | Dynamic refresh |
| --- | --- | --- | --- | --- |
| PiggieTV Configuration | `#/settings/admin/piggietv` | `GET /Ptv/v1/status?full=true` and `GET /Ptv/v1/settings` | Two parallel GETs. If the full status shape is unavailable, one safe status fallback GET is allowed without blocking Settings. | No polling. Manual status/cache actions are explicit. |
| Home Rows | `#/settings/admin/piggietv/rows` | `GET /Ptv/v1/settings` and `GET /Ptv/v1/rows` | Two parallel GETs. The Settings response is reused for recommendation and integration state; a legacy plugin missing `/rows` may use the existing Settings compatibility fallback. | No polling. Preview, recommendation generation, save, refresh, import, and restore actions require an explicit control. |
| Diagnostics | `#/settings/admin/piggietv/diagnostics` | In-memory bounded web diagnostics plus `GET /Ptv/v1/status`; the Remote section uses `GET /Ptv/v1/diagnostics/clients`, one bounded Jellyfin Sessions read, and `GET /Ptv/v1/diagnostics/storage` when supported | One plugin-status GET for the local dashboard. Opening Remote adds three parallel, independently settled reads. | Remote sources refresh every 30 seconds only while visible; local event rendering is subscription-driven and bounded. |

Configuration and Rows share the authenticated plugin transport rather than creating another token or server client. Transport response and in-flight identities include the active server and exact endpoint; integration settings are likewise server-scoped. Rows keeps Settings and Rows as separate source identities and reuses the single Settings response instead of issuing an enrichment request. Remote Diagnostics single-flights by server and selected client profile, settles clients, Sessions, and storage independently, and rejects late results after a server or request-generation change. One failed source therefore does not erase successful sibling data.

Opening any of the three canonical routes is observational. It performs only the reads listed above, does not persist returned Configuration values to browser storage, and never saves settings, rebuilds featured content, generates recommendations, rotates/clears diagnostics, or starts a remote diagnostics session. Every mutation is tied to an explicit labeled action; destructive cache, storage, and reset operations require confirmation. Configuration and Rows explicit saves preserve the authoritative plugin document boundaries and protect dirty drafts from stale responses.

The exact legacy routes `#/dashboard/piggietv`, `#/dashboard/piggietv/rows`, and `#/dashboard/piggietv/diagnostics` replacement-redirect to their canonical native destinations. `#/dashboard/piggietv/recommendations` replacement-redirects to Home Rows because recommendation administration is part of that workspace. These aliases exist only for bookmarks and compatibility and never appear as normal Administration navigation entries.

## Administration navigation registry

`PTV_ADMIN_CATEGORIES` and `PTV_ADMIN_DESTINATIONS` are the canonical static navigation source. The registry contains 26 destinations grouped in this order:

1. Overview
2. PiggieTV
3. People
4. Media
5. Playback
6. Live TV
7. Plugins
8. Server

Each destination owns a stable ID, category, label, description, icon, canonical URL, route type, source, migration metadata, and optional compatibility aliases. Dashboard management shortcuts are derived from the same registry rather than maintaining a second route list.

Most Overview Management cards link to `#/settings/admin?section=<category>` and open the corresponding rail group. Playback and Plugins link directly to their native workspaces at `#/settings/admin/playback` and `#/settings/admin/plugins`, while the Overview task summary links directly to `#/settings/admin/tasks`.

The shared navigation adapter also reads `GET /LiveTv/Info`. When the server explicitly reports Live TV disabled, the Live TV group and its Overview launcher are omitted. An unknown or temporarily unavailable capability result does not erase the routes, so an unrelated transient failure cannot strand an administrator.

Route inventory uses these production classifications:

- **PTV_NATIVE**: first-party PiggieTV route and visible workspace.
- **PTV_WRAPPED**: first-party PiggieTV workspace intentionally retained on an established Dashboard route inside the common PTV administration shell.
- **PLUGIN_OWNED**: server-discovered third-party configuration contract; PiggieTV owns only safe discovery, qualification, authorization, and shell presentation.
- **LEGACY_REDIRECT**: compatibility-only route that replacement-redirects to a canonical native destination.
- **LEGACY_COMPATIBILITY**: retained contextual workflow for which native equivalence is deliberately absent.
- **INTERNAL_DETAIL**: canonical native section or immutable-ID detail route represented by its parent destination in navigation.
- **DEAD**: unregistered upstream source with no active router or navigation ownership; source is retained only when upstream imports or compatibility make deletion unsafe.

Live TV/DVR, Server General/Branding/Networking/API Keys/Backups/Logs, and Signup & Invites are all **PTV_NATIVE**. Their former Dashboard URLs are **LEGACY_REDIRECT** aliases only.

### Canonical static routes

| Group | Visible title | Canonical route | Current owner | Status |
| --- | --- | --- | --- | --- |
| Overview | Overview / PiggieTV Administration | `#/settings/admin` | PiggieTV dashboard | **PTV_NATIVE** |
| PiggieTV | PiggieTV Configuration | `#/settings/admin/piggietv` | PiggieTV Configuration workspace | **PTV_NATIVE** |
| PiggieTV | Home Rows | `#/settings/admin/piggietv/rows` | PiggieTV Home Rows workspace | **PTV_NATIVE** |
| PiggieTV | Diagnostics | `#/settings/admin/piggietv/diagnostics` | PiggieTV Diagnostics workspace | **PTV_NATIVE** |
| People | Users | `#/settings/admin/users` | PiggieTV Users workspace | **PTV_NATIVE** |
| People | Signup & Invites | `#/settings/admin/users/signup-invites` | PiggieTV Signup & Invites workspace | **PTV_NATIVE** |
| People | Devices | `#/settings/admin/devices` | PiggieTV Devices workspace | **PTV_NATIVE** |
| People | Activity | `#/settings/admin/activity` | PiggieTV Activity workspace | **PTV_NATIVE** |
| Media | Libraries | `#/settings/admin/libraries` | PiggieTV Libraries workspace | **PTV_NATIVE** |
| Media | Library Display | `#/settings/admin/libraries/display` | PiggieTV Library Display workspace | **PTV_NATIVE** |
| Media | Metadata | `#/settings/admin/libraries/metadata` | PiggieTV global Metadata workspace | **PTV_NATIVE** |
| Media | NFO Settings | `#/settings/admin/libraries/nfo` | PiggieTV global NFO workspace | **PTV_NATIVE** |
| Media | Media Management | `#/settings/admin/media` | PiggieTV media administration hub | **PTV_NATIVE** |
| Media | Metadata Quality | `#/settings/admin/media/metadata-quality` | PiggieTV metadata audit and review queue | **PTV_NATIVE** |
| Media | Metadata Manager | `#/settings/admin/media/metadata-manager` | PiggieTV item-level metadata workspace | **PTV_NATIVE** |
| Playback | Playback | `#/settings/admin/playback` | PiggieTV server Playback workspace | **PTV_NATIVE** |
| Live TV | Live TV | `#/settings/admin/livetv` | PiggieTV Live TV workspace | **PTV_NATIVE** |
| Live TV | DVR | `#/settings/admin/livetv/dvr` | PiggieTV DVR workspace | **PTV_NATIVE** |
| Plugins | Plugin Manager | `#/settings/admin/plugins` | PiggieTV Plugin Administration workspace | **PTV_NATIVE** |
| Server | General | `#/settings/admin/server/general` | PiggieTV General workspace | **PTV_NATIVE** |
| Server | Branding | `#/settings/admin/server/branding` | PiggieTV Branding workspace | **PTV_NATIVE** |
| Server | Networking | `#/settings/admin/server/networking` | PiggieTV Networking workspace | **PTV_NATIVE** |
| Server | API Keys | `#/settings/admin/server/api-keys` | PiggieTV API Keys workspace | **PTV_NATIVE** |
| Server | Backups | `#/settings/admin/server/backups` | PiggieTV Backups workspace | **PTV_NATIVE** |
| Server | Logs | `#/settings/admin/server/logs` | PiggieTV bounded Logs workspace | **PTV_NATIVE** |
| Server | Scheduled Tasks | `#/settings/admin/tasks` | PiggieTV Scheduled Tasks workspace | **PTV_NATIVE** |

### Canonical section and detail routes

These routes are canonical but intentionally resolve to a single parent navigation destination. Every route is gated by the authenticated Jellyfin administrator policy before its lazy module or data queries mount.

| Route family | Active destination | Classification | Identity / reason |
| --- | --- | --- | --- |
| `#/settings/admin/users/:userId` | Users | **INTERNAL_DETAIL** | Immutable Jellyfin user ID; Signup & Invites is matched before the dynamic segment. |
| `#/settings/admin/libraries/:libraryId` | Libraries | **INTERNAL_DETAIL** | Immutable virtual-folder item ID; Display, Metadata, and NFO are matched as static routes first. |
| `#/settings/admin/media/metadata-quality/:itemId` | Metadata Quality | **INTERNAL_DETAIL** | Immutable Jellyfin item ID; review is observational and correction opens Metadata Manager. |
| `#/settings/admin/media/metadata-manager/:itemId` | Metadata Manager | **INTERNAL_DETAIL** | Immutable Jellyfin item ID. |
| `#/settings/admin/playback/streaming` | Playback | **INTERNAL_DETAIL** | Route-backed Streaming section. |
| `#/settings/admin/playback/transcoding` | Playback | **INTERNAL_DETAIL** | Route-backed Transcoding section. |
| `#/settings/admin/playback/resume` | Playback | **INTERNAL_DETAIL** | Route-backed Resume section. |
| `#/settings/admin/playback/trickplay` | Playback | **INTERNAL_DETAIL** | Route-backed Trickplay section. |
| `#/settings/admin/livetv/tuners` | Live TV | **INTERNAL_DETAIL** | Native tuner inventory. |
| `#/settings/admin/livetv/tuners/new` | Live TV | **INTERNAL_DETAIL** | Explicit create workflow; `new` is matched before the dynamic segment. |
| `#/settings/admin/livetv/tuners/:tunerId` | Live TV | **INTERNAL_DETAIL** | Immutable tuner ID, resolved against current authoritative configuration. |
| `#/settings/admin/livetv/guide` | Live TV | **INTERNAL_DETAIL** | Native guide-provider inventory. |
| `#/settings/admin/livetv/guide/new` | Live TV | **INTERNAL_DETAIL** | Explicit provider create workflow. |
| `#/settings/admin/livetv/guide/:providerId` | Live TV | **INTERNAL_DETAIL** | Immutable provider ID, resolved against current authoritative configuration. |
| `#/settings/admin/plugins/installed` | Plugin Manager | **INTERNAL_DETAIL** | Route-backed installed inventory and default Plugin Manager section. |
| `#/settings/admin/plugins/catalog` | Plugin Manager | **INTERNAL_DETAIL** | Route-backed package catalog. |
| `#/settings/admin/plugins/repositories` | Plugin Manager | **INTERNAL_DETAIL** | Route-backed repository management. |
| `#/settings/admin/plugins/:pluginId` | Plugin Manager | **INTERNAL_DETAIL** | Immutable Jellyfin plugin ID, not a display label. |
| `#/settings/admin/server/logs/:file` | Logs | **INTERNAL_DETAIL** | Decoded once, separator-safe route value exact-matched to the fresh authoritative log list before read. |
| `#/settings/admin/tasks/:taskId` | Scheduled Tasks | **INTERNAL_DETAIL** | Immutable task ID; task actions fresh-validate the selected task. |

### Compatibility aliases and redirects

The registry keeps aliases for active-state resolution, while the router remains the source of redirect behavior:

| Compatibility route | Canonical destination | Behavior |
| --- | --- | --- |
| `#/dashboard` | `#/settings/admin` | Exact legacy landing route redirects to the PTV overview. Nested Dashboard routes are not intercepted. |
| `#/dashboard/users` | `#/settings/admin/users` | Legacy user list redirects to the native PiggieTV list. |
| `#/dashboard/users/add` | `#/settings/admin/users?action=add` | Legacy add-user route opens the native Add User dialog. |
| `#/dashboard/users/profile?userId=<id>` | `#/settings/admin/users/<id>` | Legacy profile links preserve the immutable user ID and open the native detail workspace. Missing IDs fall back safely to the native list. |
| `#/dashboard/users/access?userId=<id>` | `#/settings/admin/users/<id>?panel=access` | Legacy access links preserve the user ID and target the native Access section. |
| `#/dashboard/users/password?userId=<id>` | `#/settings/admin/users/<id>?panel=security` | Legacy password links preserve the user ID and target the native Security section. |
| `#/dashboard/users/signup-invites` | `#/settings/admin/users/signup-invites` | The exact retained Signup & Invites route replaces history with the native People workspace. |
| `#/dashboard/devices` | `#/settings/admin/devices` | The exact server-wide registered-device route replaces history with the native workspace. Legacy query parameters are dropped because Jellyfin does not provide a reliable exact-user device view. |
| `#/dashboard/activity` | `#/settings/admin/activity` | The exact legacy Activity route replaces history with the native All view. |
| `#/dashboard/activity?useractivity=true` | `#/settings/admin/activity?view=user` | The legacy user-event scope is translated to the native User view with replacement history. |
| `#/dashboard/activity?useractivity=false` | `#/settings/admin/activity?view=system` | The legacy system-event scope is translated to the native System view with replacement history. Missing, duplicate, or unsupported legacy scope values fall back safely to All; unsupported query parameters are dropped. |
| `#/dashboard/libraries` | `#/settings/admin/libraries` | The exact migrated Libraries landing route redirects; unrelated library sub-routes are not intercepted. |
| `#/dashboard/libraries/display` | `#/settings/admin/libraries/display` | The exact legacy Display route redirects with replacement history to the native form. |
| `#/dashboard/libraries/metadata` | `#/settings/admin/libraries/metadata` | The exact legacy global Metadata route redirects with replacement history. This remains distinct from item-level Metadata Manager. |
| `#/dashboard/libraries/nfo` | `#/settings/admin/libraries/nfo` | The exact legacy NFO route redirects with replacement history; per-library saver state is not rewritten. |
| `#/metadata` | `#/settings/admin/media/metadata-manager` | The exact legacy Metadata Manager catalog route redirects with replacement history. No unrelated route family is intercepted. |
| `#/metadata?id=<itemId>` | `#/settings/admin/media/metadata-manager/<itemId>` | The legacy query-form item link encodes and preserves the immutable Jellyfin item ID, then redirects with replacement history to native item detail. |
| `#/dashboard/playback/streaming` | `#/settings/admin/playback/streaming` | Exact legacy Streaming route redirects with replacement history. |
| `#/dashboard/playback/transcoding` | `#/settings/admin/playback/transcoding` | Exact legacy Transcoding route redirects with replacement history. |
| `#/dashboard/playback/resume` | `#/settings/admin/playback/resume` | Exact legacy Resume route redirects with replacement history. |
| `#/dashboard/playback/trickplay` | `#/settings/admin/playback/trickplay` | Exact legacy Trickplay route redirects with replacement history. |
| `#/dashboard/livetv` | `#/settings/admin/livetv` | Exact legacy Live TV landing route redirects with replacement history. |
| `#/dashboard/livetv/tuner?id=<id>` | `#/settings/admin/livetv/tuners/<id>` | The immutable tuner ID is preserved and encoded; a missing ID opens `tuners/new`. |
| `#/dashboard/livetv/guide?id=<id>` | `#/settings/admin/livetv/guide/<id>` | The immutable listings-provider ID is preserved and encoded. |
| `#/dashboard/livetv/guide?type=<supported-type>` | `#/settings/admin/livetv/guide/new?type=<supported-type>` | `xmltv` and `schedulesdirect` creation types are preserved; other or missing values open the native Guide list. |
| `#/dashboard/livetv/recordings` | `#/settings/admin/livetv/dvr` | The exact legacy recording-settings route redirects with replacement history. |
| `#/dashboard/tasks` | `#/settings/admin/tasks` | The exact legacy Scheduled Tasks list route redirects with replacement history. |
| `#/dashboard/tasks/<taskId>` | `#/settings/admin/tasks/<taskId>` | The legacy detail route preserves and encodes the immutable task ID, then redirects with replacement history. Missing IDs fall back safely to the native list. |
| `#/dashboard/piggietv` | `#/settings/admin/piggietv` | Exact legacy configuration route redirects with replacement history. |
| `#/dashboard/piggietv/rows` | `#/settings/admin/piggietv/rows` | Exact legacy Home Rows route redirects with replacement history. |
| `#/dashboard/piggietv/recommendations` | `#/settings/admin/piggietv/rows` | Recommendations is a compatibility alias for Home Rows, not a distinct workspace. |
| `#/dashboard/piggietv/diagnostics` | `#/settings/admin/piggietv/diagnostics` | Exact legacy Diagnostics route redirects with replacement history. |
| `#/dashboard/plugins` | `#/settings/admin/plugins/installed` | The exact legacy Plugin Manager landing route opens the native Installed tab with replacement history. |
| `#/dashboard/plugins/catalog` | `#/settings/admin/plugins/catalog` | The exact legacy Catalog route opens the native route-backed Catalog tab. |
| `#/dashboard/plugins/repositories` | `#/settings/admin/plugins/repositories` | The exact legacy repository route opens native repository management. |
| `#/dashboard/plugins/<pluginId>` | `#/settings/admin/plugins/<pluginId>` | The immutable plugin ID is preserved and encoded for native detail; a legacy display-name query is not treated as identity. |
| `#/dashboard/settings` | `#/settings/admin/server/general` | Exact legacy General route redirects with replacement history. |
| `#/dashboard/branding` | `#/settings/admin/server/branding` | Exact legacy Branding route redirects with replacement history. |
| `#/dashboard/networking` | `#/settings/admin/server/networking` | Exact legacy Networking route redirects with replacement history. |
| `#/dashboard/keys` | `#/settings/admin/server/api-keys` | Exact legacy API Keys route redirects with replacement history. |
| `#/dashboard/backups` | `#/settings/admin/server/backups` | Exact legacy Backups route redirects with replacement history. |
| `#/dashboard/logs` | `#/settings/admin/server/logs` | Exact legacy Logs route redirects with replacement history. |
| `#/dashboard/logs/<filename>` | `#/settings/admin/server/logs/<filename>` | The encoded filename is preserved for route selection, then resolved against the fresh authoritative log list before content is read. |

Retained, non-redirect compatibility routes are separately classified so they cannot be mistaken for stale first-party navigation:

| Retained route | Classification | Owner | Reason retained |
| --- | --- | --- | --- |
| `#/dashboard/users/parentalcontrol?userId=<id>` | **LEGACY_COMPATIBILITY** | Jellyfin | Contextual parental-control equivalence is deliberately deferred; the immutable user ID is encoded and the route remains administrator-gated. |
| `#/configurationpage?name=<name>` | **PLUGIN_OWNED** | Installed plugin | Arbitrary server-discovered plugin schemas and persistence remain plugin-owned; resources are restricted to server-qualified configuration-page assets. |

The old fixed Jellyfin Dashboard page modules are no longer registered as normal destinations. Unregistered upstream source components are classified **DEAD** only for route ownership; they are not deleted while upstream imports or plugin compatibility could still require their source.

Nested routes resolve to the closest canonical parent for rail highlighting. For example, a user profile route highlights Users, a Metadata Manager item route highlights Metadata Manager, a log file highlights Logs, a task detail highlights Scheduled Tasks, and every native Plugin Manager tab/detail route highlights Plugin Manager.

## Dynamic plugin configuration pages

Plugin configuration pages cannot be represented by a complete hardcoded list because the installed plugins vary by server. `useAdminNavigation` reuses the existing authenticated Jellyfin query for:

`GET /web/ConfigurationPages?enableInMainMenu=true`

For each returned page, PiggieTV uses the reported `Name`, `DisplayName`, `PluginId`, `MenuIcon`, and `EnableInMainMenu` fields to add a destination to the Plugins group:

`#/configurationpage?name=<encoded configuration page name>`

Normalization rules are centralized:

- entries without a usable name are omitted;
- entries explicitly disabled for the main menu are omitted;
- names are deduplicated case-insensitively;
- multiple distinct pages from one plugin are retained;
- labels fall back from `DisplayName` to `Name`;
- icon values pass through the PiggieTV icon registry and use a safe text-derived or Plugins fallback;
- server strings are rendered as text and are not treated as markup.

Dynamic discovery has an independent loading note, failure state, and Retry action inside the Plugins navigation group. A discovery failure does not remove the static Plugin Manager destination or affect dashboard health queries. Dynamic plugin configuration pages remain **PLUGIN_OWNED** workspaces even though PiggieTV discovers and presents their navigation; PiggieTV does not parse or recreate third-party configuration schemas.

Configuration-page and Live TV capability query identities include the active Jellyfin server ID. Switching between authenticated servers therefore cannot reuse another server's plugin destinations or Live TV availability state.

## Native Plugin Administration workspace

`#/settings/admin/plugins` is the canonical Plugin Manager and defaults to Installed. Its route-backed destinations are `#/settings/admin/plugins/installed`, `#/settings/admin/plugins/catalog`, and `#/settings/admin/plugins/repositories`; `#/settings/admin/plugins/:pluginId` uses the immutable Jellyfin plugin GUID/ID for native detail. The centralized registry contains only one static Plugin Manager entry. Server-discovered configuration pages remain separate dynamic destinations, preventing plugin rows or the first-party PiggieTV configuration workspace from becoming duplicate rail entries.

PiggieTV owns list/detail presentation, local search and filters, source-isolated loading and errors, confirmations, normalized status/version text, and safe navigation. Jellyfin remains authoritative through `GET /Plugins`, `GET /Packages`, `GET /Repositories`, `POST /Packages/Installed/{name}`, plugin Enable/Disable endpoints, version-specific plugin uninstall, and full repository-list replacement. The existing PiggieTV plugin is identified by its immutable plugin GUID and links to `#/settings/admin/piggietv`; its first-party settings are not duplicated in Plugin Manager.

Dynamic configuration discovery continues to use the shared, server-scoped ConfigurationPages query. A single or multiple Configure action opens the exact encoded `#/configurationpage?name=...` route. Configuration metadata is rendered as text, and a missing discovery response does not erase installed or catalog state.

The configuration form, validation, and persistence remain plugin-owned. `ServerContentPage` only qualifies Jellyfin-reported relative `configurationpage?...` script and stylesheet resources through the connected server's existing URL builder; this keeps plugin-owned pages functional when PiggieTV Web is hosted separately (including local development) without parsing or recreating their schemas. The retained page wrapper is bounded to the administration content column so legacy absolute page positioning cannot cover the global PTV header or administration rail.

Plugin reads have no normal polling. Opening Installed targets one installed-plugin request plus the administration shell's shared configuration discovery, Catalog targets one bounded package request, and Repositories targets one repository request. Detail is derived from bounded list/catalog/configuration sources rather than per-plugin fan-out. No tab performs per-card package or configuration requests; Refresh and successful mutations invalidate only the affected server-scoped sources.

Install, update, enable/disable, uninstall, and repository changes require explicit administrator intent. Mutation state is not reported complete until Jellyfin's authoritative state is refetched, and restart-required presentation comes only from Jellyfin plugin status. Opening the workspace never installs, updates, uninstalls, edits repositories, runs a task, or restarts the server. The server's Update Plugins scheduled task remains owned by `#/settings/admin/tasks`; Plugin Manager does not create a second update scheduler or execute that task on load.

## Grouped desktop rail and mobile drawer

`PtvAdminLayout` is the single administration navigation owner.

On desktop it renders a grouped left rail. Overview is always expanded, the active destination's group opens automatically, and other groups can be expanded or collapsed independently. Expanded groups are retained for the browser session under the optional `sessionStorage` key `ptv-admin-expanded-groups`; storage failure does not prevent navigation.

On narrow viewports the persistent rail is replaced by an Administration button and a modal-style navigation drawer with a dismiss backdrop, explicit close control, the same grouped destinations, current-page labeling, and automatic close after navigation. Keyboard focus is contained within the open dialog, Escape closes it and returns focus to the launcher, and drawer controls retain 44-pixel minimum touch targets. The mobile context row also retains a direct path back to Settings.

The desktop rail and mobile drawer consume the same navigation groups, including server-discovered plugin pages, so they cannot drift into different route inventories.

## Shell compatibility strategy

The global PiggieTV header remains the application-level navigation owner. `PtvAdminLayout` is used in two modes:

- Settings mode wraps `#/settings/admin`, native Users, Signup & Invites, Devices, Activity, Libraries, Library Display, global Metadata, NFO Settings, Metadata Manager, Playback, Live TV/DVR, Plugin Manager, Server, Logs, Backups, and Scheduled Tasks routes inside the PTV Settings application.
- Dashboard mode wraps the existing Dashboard `Outlet`, which means retained Jellyfin and PTV management pages receive the same grouped rail and mobile drawer without being rewritten.

The Dashboard compatibility layout preserves `AppHeader`, `AppTabs`, `AppBody`, localization, and Dashboard theme CSS. Page-specific Jellyfin tabs continue to work. The former Jellyfin Dashboard drawer is no longer a competing navigation system.

The exact `#/dashboard` landing route redirects to `#/settings/admin`. Migrated People, Media, Playback, Live TV/DVR, Plugin Manager, Server, Logs, Backups, and Scheduled Tasks paths remain registered only as admin-only compatibility routes that replace history with their native destinations. Exact `#/metadata` opens the native catalog, while `#/metadata?id=<itemId>` opens the encoded native item-detail route. Dynamic `#/configurationpage?...` routes remain registered under the existing admin-only router so plugin-owned forms, browser bookmarks, Back/Forward history, and internal workflows continue to work. No administration page is embedded in an iframe.

## Native Users workspace

### Routes and retained user workflows

`#/settings/admin/users` is the canonical compact user list. `#/settings/admin/users/:userId` is the canonical user detail route; the user ID segment is encoded and remains the immutable Jellyfin identity key. `?action=add`, `?panel=access`, and `?panel=security` are contextual entry points used by compatibility redirects and do not create alternate data owners.

The native list supplies username/email search, All/Administrators/Members/Disabled filters, deterministic Username/Last activity/Role sorting, PTV/Jellyfin status labels, and an explicit Add User action. User detail presents Profile, Access, Playback, Content restrictions, Devices & Activity, Security, and Danger Zone sections without exposing raw policy objects.

Two related workflows remain intentionally separate from direct account creation:

- **Signup & Invites** is native at `#/settings/admin/users/signup-invites`; the Users list links there instead of treating an invitation as a direct Jellyfin user creation.
- **Parental controls** remain at `#/dashboard/users/parentalcontrol?userId=<id>` because complete native equivalence is not part of this migration.

The detail page links to the native server-wide Devices and Activity workspaces. Jellyfin's Activity Log supports only the presence or absence of a user ID, not an exact user ID, and the registered-device association is not a reliable account-ownership boundary. The links are therefore intentionally unfiltered and are not described as scoped views.

### Field ownership and data sources

| Field or concern | Authority | Read source | Write source |
| --- | --- | --- | --- |
| User ID, username, avatar, enabled/disabled state, administrator role, login/activity timestamps, password state | Jellyfin | Users API (`GET /Users`, `GET /Users/{userId}`) and Jellyfin image service | Jellyfin User, User Policy, and Password APIs |
| Library access | Jellyfin | User Policy plus `GET /Library/MediaFolders?isHidden=false` | Jellyfin User Policy API |
| Playback and account policy | Jellyfin | User Policy returned with the user | Jellyfin User Policy API |
| Current sessions | Jellyfin | One batched `GET /Sessions?activeWithinSeconds=960` request | Observational only in this workspace |
| PTV email and verification state | PiggieTV account profile service | Administrator-only `GET /Ptv/v1/account/admin/users` | Read-only in Users; owner-managed verification flows remain authoritative |

The PTV administrator profile endpoint returns one batch keyed by immutable Jellyfin user ID. A canonical email is returned only when verified. If a verified account is changing address, its existing canonical email remains available while the pending replacement stays masked. Recovery addresses remain masked, and missing profile data remains explicitly missing. The Users workspace does not invent email storage, write email into Jellyfin fields, mark an administrator-entered address verified, or create/synchronize PTV profiles during page load.

### Mutations and safety

The native workspace reuses Jellyfin's authenticated APIs for these deliberate administrator actions:

- create a user by name, with an optional initial password;
- update username;
- enable or disable an account;
- promote or demote administrator role;
- update the exposed playback/account policy fields without replacing unrelated policy fields;
- grant all-library access or update an explicit library selection;
- set or reset a password;
- delete a user after explicit confirmation.

Policy writes are serialized per detail workspace, then refetch and clone the complete authoritative Jellyfin policy before applying a focused patch. Library-access saves additionally refetch both the user policy and folder inventory; if either is unavailable, the operation fails closed and performs no write. Folder IDs absent from the latest inventory but present in the saved policy are preserved. Current administrators cannot delete, disable, or demote themselves. Immediately before delete, disable, or demote, the UI reloads the administrator set, resolves the exact target from that fresh response, and fails closed if either cannot be verified; last-enabled-administrator checks prevent an action that would strand server administration.

Passwords stay in dialog component state for the duration of the operation and are not cached, persisted, placed in URLs, or logged. A signed-in user changing their own configured password must provide the current password; administrators setting another user's password use the existing elevated Jellyfin behavior. Loading the list or detail route is observational and never triggers a profile creation, email change, policy update, password operation, or other mutation. Unsaved profile, library, and playback changes are protected for both browser unload and internal route navigation.

### Request budget, cache identity, and partial failure

The user list has a fixed three-request data budget independent of user count:

1. one Jellyfin users request;
2. one batched PTV administrator profile-summary request;
3. one Jellyfin sessions request.

There are no per-user profile or activity requests. The detail route reuses the shared profile and sessions caches when available. A cold direct detail load has five bounded sources: the core user list required for dangerous-action guards, the selected Jellyfin user, the batch PTV profile summary, the batch Jellyfin sessions list, and the media-folder inventory required for library-access presentation.

The core Jellyfin users source is required for the list. PTV profile and session enrichment are optional and independent: if profile summaries fail, the list still renders core users and labels email status unavailable; if sessions fail, users and profile state remain usable and session activity is labelled unavailable rather than zero. Missing policy, password, restriction, or playback fields also remain unavailable and disable affected mutations instead of being coerced into active/member/no-password/false defaults. A failed folder or policy request produces an unavailable library editor rather than an empty selection, so failure can never be mistaken for zero access.

React Query identities include the active server ID, source/endpoint family, relevant user ID, and any response-shaping arguments. User A detail therefore cannot consume User B detail, a server switch cannot reuse another server's users, and full PTV profile summaries cannot collide with count-only health data merely because both concern users. Abort signals propagate to source requests, mutations invalidate the scoped list/detail queries, and list Refresh is single-flight.

## Native Signup & Invites workspace

`#/settings/admin/users/signup-invites` is the canonical first-party Signup & Invites route. The exact `#/dashboard/users/signup-invites` compatibility route replacement-redirects to it. `SettingsPage` verifies the current Jellyfin user's `Policy.IsAdministrator` before the route component mounts or any Signup source begins.

The PiggieTV plugin is the settings and invitation authority through `GET/POST /Ptv/v1/signup/admin/settings`, `POST /Ptv/v1/signup/admin/email/test`, `GET/POST /Ptv/v1/signup/admin/invites`, `POST /Ptv/v1/signup/admin/invites/{id}/disable`, and `DELETE /Ptv/v1/signup/admin/invites/{id}`. `GET /Ptv/v1/account/admin/health` supplies account/email and latest-backup health, while Jellyfin `GET /Library/MediaFolders` supplies the current library choices for default signup access. The page does not create another signup store or rewrite Jellyfin user policy outside the plugin's established signup operation.

Opening the page is observational: it does not save settings, test SMTP, create/disable/delete an invitation, create a user, run a backup, or restore account data. Account-backup health may produce a warning, but backup creation, verification, dry-run, and live restore are owned exclusively by native Server Backups at `#/settings/admin/server/backups`. Settings, invitations, account health, and media folders retain independent source/error ownership so an optional health failure cannot erase valid configuration or invitations.

Initial load starts four bounded, independent reads for settings, invitations, account health, and media folders. The page uses component-local source state, per-source request-generation guards, and an unmount guard rather than installing those responses in a shared query cache. It does not poll or refetch on focus. Manual invitation/account/library refreshes are source-specific, and all mutations share one in-flight guard so repeated Save, test-email, create, disable, delete, or verification-cancel actions cannot overlap.

The stored SMTP password is never returned; the UI receives only `passwordConfigured`, and a blank password preserves the existing secret. A replacement password and test-recipient address remain transient form/action state and are not written to routes, shared cache, logs, or browser storage. Invite GET/create/disable results are stripped of any clear `code` before entering list state; established rows expose only their safe preview. Only the create response may feed a transient one-time reveal, which clears after successful Copy, Dismiss, or unmount. Clear codes never enter debug output, logs, URLs, storage, or list state.

## Native Devices and Activity workspaces

### Routes and scope

`#/settings/admin/devices` is the canonical server-wide registered-device inventory. `#/settings/admin/activity` is the canonical paged server activity log; `?view=user|system` selects the backend scope and `?page=<one-based-page>` preserves navigation state, while omitted or invalid values fall back safely to All and page 1. Both live in the People group and reuse the existing administration shell and authorization boundary. Their exact legacy aliases are translated with replacement history as documented above; no unrelated Dashboard route is intercepted.

The administrator Devices inventory is intentionally distinct from the member-facing `#/settings/devices` Settings page. The member page owns personal device and Quick Connect workflows. The administration page observes registered devices across the server, correlates active Jellyfin sessions, and exposes the server-wide removal action. A device is a server registration keyed by immutable `DeviceId`; it is not treated as a permanent owner relationship to the last user recorded on it.

### Shared People data model and source ownership

| Concern | Authority | Read source | Mutation source |
| --- | --- | --- | --- |
| Registered device identity, name, client/version, last recorded user, and last activity | Jellyfin | `GET /Devices` | `DELETE /Devices?id=<deviceId>` for explicit removal |
| Current device sessions, playback state, and concurrent sessions | Jellyfin | One `GET /Sessions?activeWithinSeconds=960` request for registry enrichment; focused `GET /Sessions?deviceId=<deviceId>&activeWithinSeconds=960` reads during removal confirmation | Observational, except that Jellyfin ends matching sessions as part of device removal |
| User labels used for display | Jellyfin | One `GET /Users` request | Observational only |
| Activity entries, total count, and User/System scope | Jellyfin | `GET /System/ActivityLog/Entries?startIndex=<offset>&limit=50` with optional `hasUserId` set to `true` or `false` | Observational only |

The shared People normalization layer treats the registered Devices response as the inventory and joins every matching recent session by case-normalized immutable `DeviceId`, so multiple simultaneous sessions are retained rather than collapsed. Unmatched session rows never create device cards: this server can retain hundreds of session-only identifiers and report historical rows as active, so neither `IsActive` nor recency safely proves a registered/current client. Removal is offered only when Jellyfin returned a registered device record and the target is not the current client. User DTOs are indexed once by normalized immutable Jellyfin user ID and reused by both workspaces. Friendly device, client, media, playback-method, user, time, activity severity, and activity-category labels are presentation fields only. Unknown and plugin-defined values remain renderable and do not become guessed identities.

Device state is derived only when the Sessions source succeeds: playing and paused sessions take priority, followed by active registration state and then no active session. A Sessions failure leaves device status unavailable; it never turns all devices into a fabricated Offline state. A Users failure does not blank the inventory or activity log; labels already recorded by Jellyfin may remain visible, while unresolved current-user details are shown as unavailable.

Activity uses Jellyfin's server-side All/User/System scope through `hasUserId` and 50-entry pages. Search applies only to the currently loaded page and is labelled accordingly; it does not imply a server-wide search. Jellyfin exposes no exact-user activity filter, so the View Activity link on Users detail remains unfiltered instead of presenting a partial current-page filter as authoritative. Pagination and totals continue to describe the backend-selected All/User/System result set.

An activity entry links to native Users only when its immutable `UserId` still resolves in the current Users response. Playback and library entries may link to native Metadata Manager when Jellyfin supplies an immutable `ItemId`. The Activity Log contract does not expose a device ID, so PiggieTV does not construct device links from a client or device name and does not issue per-entry resolution requests.

### Request, polling, and cache behavior

The Devices initial request budget is three parallel GETs: `/Devices`, `/Sessions?activeWithinSeconds=960`, and `/Users`. Registry and user sources use 60-second stale windows and do not poll. Session data uses a 15-second stale window and refreshes every 30 seconds only while the document is visible. A coordinated manual Refresh revalidates all three sources without reloading the browser; source failures remain independent, and requests are shared through server- and source-scoped query identities rather than repeated per row. Search and filters always evaluate the full loaded registry; presentation mounts the first 50 matching cards and adds 50 at a time on request so unusually large registries do not create hundreds of DOM rows at once.

The Activity initial request budget is one paged Activity Log GET plus one shared Users GET for labels, issued in parallel. Activity data uses a 30-second stale window and refreshes every 60 seconds only while visible; users retain the shared 60-second stale window and do not poll. Changing page or All/User/System scope changes the activity query identity, while local search performs no request. Manual Refresh revalidates the current page and available user labels. Neither workspace performs per-device, per-session, per-user, or per-entry enrichment requests during ordinary loading.

The cache boundary includes the connected Jellyfin server ID, People source, and normalized page/scope request where applicable. Focused removal reads use the immutable device ID directly and are not installed as broad cached authority. Aborted requests are not committed, hidden tabs do not continue polling, and returning to a visible tab refreshes the dynamic Sessions or Activity source once. Partial success remains usable: registry, session, user, and activity failures each retain their own loading/error/retry state.

### Device removal contract

Opening Devices is observational. Removal is the only mutation: Jellyfin deletes the registered `DeviceId`, revokes all authorization tokens registered to that device ID, and ends all matching sessions. PiggieTV describes those consequences explicitly and requires confirmation; it does not offer a misleading single-session sign-out action.

Before confirmation, PiggieTV refetches `GET /Devices/Info?id=<deviceId>` and `GET /Sessions?deviceId=<deviceId>&activeWithinSeconds=960` to show the current device and explicitly active recent-session impact. Immediately before `DELETE /Devices?id=<deviceId>`, it repeats both authoritative reads. The complete removal interaction therefore uses two observational GETs to prepare confirmation, then two fresh GETs plus one DELETE after confirmation. Missing `IsActive` values are never counted as active. If the session count or active-session warning changed, the deletion is blocked until the administrator reviews a new confirmation. The current device is fail-closed and cannot be removed from the page, duplicate confirmations share one in-flight mutation, failures preserve the row, and success is not shown until Jellyfin confirms deletion and the affected People data is refreshed. No optimistic removal is used.

### Privacy boundary

The People model is deliberately narrower than the raw Jellyfin DTOs. Device `AccessToken`, session `RemoteEndPoint`, authorization data, and raw response objects never enter rendered models or searchable text. For core authentication and session activity types whose `ShortOverview` contains a remote endpoint, PiggieTV omits that field and uses the non-IP `Overview` when available. IP addresses, device tokens, access tokens, email addresses, and raw user/session objects are not exposed in DOM attributes or client logs.

## Explicit internal-route exclusions

The following routes are intentionally excluded from the primary rail because they are contextual detail or creation workflows. Their parent destinations remain responsible for reaching them.

| Internal route | Reason for exclusion |
| --- | --- |
| `#/settings/admin/server/logs/:filename` | A bounded native log-file detail reached from Logs; no second rail destination is created. |
| `#/dashboard/plugins/:pluginId` | An internal compatibility detail route that preserves the immutable ID while redirecting to native Plugin Manager detail. |
| `#/dashboard/tasks/:id` | An internal compatibility detail route that redirects to the native Scheduled Tasks parent destination. |
| `#/dashboard/users/parentalcontrol` | A user detail workflow reached from Users. |
| `#/settings/admin/livetv/tuners/:tunerId` | A contextual tuner editor reached from Live TV. |
| `#/settings/admin/livetv/guide/:providerId` | A contextual guide-provider editor reached from Live TV. |
| `#/settings/admin/media/metadata-manager/:itemId` | A contextual item editor reached from Metadata Manager; the parent destination remains highlighted. |

`#/configurationpage?name=...` is also excluded from the static registry because it is a dynamic server-reported route family rather than a fixed destination.

## Dashboard backend sources

| Dashboard area | Existing source | Normalized use |
| --- | --- | --- |
| Server | `GET /System/Info` | Reachability, name, version, operating system, restart/shutdown state |
| Sessions | `GET /Sessions` | Active and paused media sessions, playback method, progress, and transcode summary |
| Scheduled Tasks | `GET /ScheduledTasks?isHidden=false` | Running tasks and actual failed, cancelled, or aborted execution results |
| Libraries | `GET /Library/VirtualFolders` | Configured library count and cheap collection-type breakdown |
| PiggieTV Plugin | `GET /Ptv/v1/status?full=true` | Plugin reachability/version plus returned Featured Content and cache fields |

Warnings are derived only from normalized source results, such as an unavailable source, an empty or stale Featured Content cache, a pending server restart, or a reported task failure. Phase 1 does not download or parse Jellyfin log files to manufacture a warning feed.

Server uptime, next scheduled-task execution, CPU usage, RAM usage, storage usage, and client-version distribution are omitted because existing APIs do not provide them reliably enough for this dashboard.

## Network and refresh behavior

Opening `#/settings/admin` starts seven logical authenticated query sources:

1. System Info
2. Sessions
3. Scheduled Tasks
4. Virtual Folders
5. PiggieTV full status
6. Plugin configuration-page discovery
7. Live TV capability discovery

The five dashboard sources load independently. Their shared service also supports an all-settled aggregate load, while the hook keeps individual query state so one failure cannot blank unrelated cards.

- Sessions poll every 30 seconds while the document is visible.
- System Info, Scheduled Tasks, Virtual Folders, and PiggieTV status poll every 90 seconds while visible.
- Dashboard queries do not poll in the background and do not refetch merely because the window gains focus.
- Returning the document to visible state triggers a coordinated dashboard refresh.
- Manual Refresh re-fetches the five dashboard sources without reloading the browser, uses single-flight protection, cancels superseded query work, and bypasses the normal PiggieTV status cache for that refresh.
- A card-level Retry re-fetches only its source where practical.
- Existing successful data remains visible during background refreshes.
- Configuration-page discovery has no administration-specific polling interval. React Query caches/deduplicates it, and its independent Retry action refetches it after failure.
- Live TV capability discovery has no administration-specific polling interval and remains fresh for five minutes.
- Manual dashboard Refresh does not refetch plugin navigation discovery; the two concerns have separate retry ownership.

Dashboard loading is observational. It does not regenerate Featured Content, start library scans, execute tasks, restart services, or mutate server configuration.

The native Users list independently starts the three bounded source requests documented above. Its sessions query refreshes every 30 seconds while the page is mounted and visible; the user and PTV profile sources use finite stale times and explicit/invalidation-driven refresh. A manual list Refresh coordinates those three sources with single-flight protection and preserves partial results. The administration shell's plugin-page and Live TV capability discovery retain their own cache and retry ownership and are not per-user enrichment.

## Native Libraries workspace

### Routes, identity, and retained media tools

`#/settings/admin/libraries` is the canonical PiggieTV library list and `#/settings/admin/libraries/:libraryId` is the canonical detail route. The route segment is Jellyfin's `VirtualFolderInfo.ItemId`, which is the immutable identity returned for the configured virtual folder; display names and filesystem paths are never used as route identity. Arbitrary library names remain presentation only, and unknown collection types normalize to a safe Other type.

The exact legacy `#/dashboard/libraries` route redirects to the native list. Library Display, global Metadata, and NFO Settings remain separate native server-configuration routes. Item-level Metadata Manager is also native, but remains a distinct workspace rather than becoming part of global or per-library configuration:

| Tool | Canonical route | Scope | Status |
| --- | --- | --- | --- |
| Library Display | `#/settings/admin/libraries/display` | Six server-side presentation/data-shaping settings | **PTV_NATIVE** |
| Metadata | `#/settings/admin/libraries/metadata` | Global metadata language, country, dummy-chapter duration, and chapter-image resolution defaults | **PTV_NATIVE** |
| NFO Settings | `#/settings/admin/libraries/nfo` | Global `xbmcmetadata` writer behavior; per-library NFO enablement remains a metadata-saver choice | **PTV_NATIVE** |
| Metadata Quality | `#/settings/admin/media/metadata-quality` | Server-side audit, explainable scoring, and a human review queue; no item mutation | **PTV_NATIVE** |
| Metadata Manager | `#/settings/admin/media/metadata-manager` | Item catalog plus item-level metadata, artwork, identify, and refresh workflows | **PTV_NATIVE** |

`#/settings/admin/media` is the first-party Media Management hub. It links native Libraries, Library Display, Metadata, NFO Settings, Metadata Quality, and Metadata Manager while keeping observational quality review, item-level editing, and global/per-library configuration distinct.

### Authoritative sources and normalized model

| Concern | Authority | Read source | Focused write/action |
| --- | --- | --- | --- |
| Library identity, name, type, paths, and stored options | Jellyfin | `GET /Library/VirtualFolders` | Virtual-folder rename/remove, media-path add/remove, and library-options APIs |
| Create capabilities and provider/image-fetcher inventory | Jellyfin | Library options-info API for the selected collection type | `POST /Library/VirtualFolders` with server-compatible defaults and paths |
| Safe server-folder browsing and validation | Jellyfin | Environment default-directory, drives, directory-contents, parent-path, and validate-path APIs | Observational browsing; path validation only |
| Global scan state and action | Jellyfin Scheduled Tasks | `GET /ScheduledTasks?isHidden=false`, task key `RefreshLibrary` | Start the authoritative scheduled task after an explicit click |
| Single-library scan | Jellyfin item refresh | Selected virtual-folder `ItemId` | Existing recursive `refreshItem` contract after an explicit click |
| Metadata and image providers | Jellyfin library options-info and the selected folder's library options | Provider names/orders normalize into a read-only summary | Per-library provider-order editing remains deferred; global Metadata does not reconstruct provider arrays |
| NFO persistence | Jellyfin library metadata savers plus named `xbmcmetadata` configuration | Per-library saver names plus the native global NFO page | Library detail owns saver state; NFO Settings owns global writer behavior |

Components consume `AdminLibrarySummary` and `AdminLibraryDetail` rather than raw `VirtualFolderInfo` response shapes. The normalized model supplies user-facing collection labels, exact path arrays, manageability/removal safety, folder count, library scan state, exposed option values, and read-only metadata/image-provider summaries. Missing required source data remains unavailable and disables the affected action; it is not converted into an empty options object or an apparently empty library.

Collections (`boxsets`) are treated as server-managed. They can be inspected and scanned, but folder mutation and library removal controls are withheld. Other malformed entries without a usable server ID/name are presented with a warning and no destructive controls.

### Mutations and fail-closed behavior

The workspace supports deliberate create, rename, media-path add/remove, grouped option save, global scan, individual scan, and library removal operations. Library type is read-only after creation because Jellyfin has no focused safe type-change operation. Folder browsing uses only Jellyfin's existing authenticated Environment API; the browser never accesses the filesystem directly, rewrites separators, resolves symlinks, or changes meaningful path content.

Creation requires a usable name, collection type, and at least one server-validated path. Jellyfin's add-virtual-folder request carries the paths and server-compatible default library options in one create operation, so the client does not retry a partially completed multi-step create. The returned list is fetched once to discover the server-assigned `ItemId`. Folder add/remove and rename use focused endpoints and do not silently start a scan.

Before a grouped options write, the service refetches the selected library from the authoritative virtual-folder list, clones its complete `LibraryOptions`, applies only recognized changed fields, and sends the merged object. If the library or options cannot be verified, no write occurs. Unknown Jellyfin/plugin fields, provider arrays, path information, and future fields survive a known-option edit. A failed read therefore cannot become a default or empty destructive write.

Global and individual scans are explicit, single-flight actions and never run on load, route navigation, Refresh, create, rename, folder changes, or options save. The global operation starts the existing `RefreshLibrary` task; the single-library action uses the existing recursive item refresh contract. The task source reports authoritative running/progress state when available, otherwise the UI reports only that a request was accepted or status is unavailable.

Remove is isolated in Danger Zone, requires a named PTV confirmation, blocks duplicate submission, and refetches the exact target before invoking Jellyfin's remove-virtual-folder operation. The copy states that it removes the server library configuration; the UI does not claim to delete, move, or otherwise manipulate media files. After success the scoped list is invalidated, stale detail state is removed, and navigation returns to Libraries.

### Option coverage

PiggieTV deliberately exposes a bounded, understandable subset of Jellyfin's library options. All unexposed and unknown fields remain intact on save.

| Jellyfin option or option family | Classification | PiggieTV treatment |
| --- | --- | --- |
| `Enabled`, `EnableRealtimeMonitor`, `EnablePhotos` | **CORE** | Exposed with user-facing labels where applicable. |
| `EnableAutomaticSeriesGrouping`, `EnableEmbeddedTitles`, `EnableEmbeddedExtrasTitles`, `EnableEmbeddedEpisodeInfos`, `AutomaticallyAddToCollection` | **ADVANCED** | Exposed in the collapsed Advanced Library Options group where supported. |
| `EnableLUFSScan`, chapter-image generation/during-scan flags, trickplay generation/during-scan flags, and `SaveTrickplayWithMedia` | **ADVANCED** | Exposed as library-scoped analysis/extraction controls; no scan is launched by save. |
| `PathInfos` | **CORE, focused operation** | Shown in Folders and changed only through add/remove media-path endpoints, never reconstructed by the options form. |
| Metadata saver/reader/fetcher order, image fetcher order, subtitle/lyric/media-segment provider order, and type/image options | **UNSUPPORTED for editing in this phase** | Provider names are summarized read-only where available. Per-library provider-order editing is deferred; the native global Metadata defaults page is not presented as an equivalent editor. |
| Per-library preferred metadata language/country, season-zero name, automatic refresh interval, embedded-subtitle policy, subtitle/lyric download behavior, music tag delimiters, and local metadata-save behavior | **UNSUPPORTED for editing in this phase** | Left unchanged and preserved. The native Metadata page owns only server-wide language/country defaults, not these per-library overrides. |
| Any unrecognized future Jellyfin or plugin option | **UNSUPPORTED** | Never rendered as a guessed control and always preserved during a focused save. |

No discovered library option is classified `HIDDEN_PTV_IRRELEVANT` merely because PiggieTV does not yet expose it. Unproven settings stay unsupported and preserved, not deleted or silently reset.

### Native Library Display

`#/settings/admin/libraries/display` is a first-party PiggieTV form over two existing Jellyfin configuration resources. The exact legacy `#/dashboard/libraries/display` route redirects to it. Global Metadata, NFO Settings, and item-level Metadata Manager use their own native routes and data boundaries.

| Setting | Backend property | Authoritative resource |
| --- | --- | --- |
| Use file creation time for date added | `UseFileCreationTimeForDateAdded` | Named `metadata` configuration |
| Display a folder view | `EnableFolderView` | Full server configuration |
| Display specials within seasons | `DisplaySpecialsWithinSeasons` | Full server configuration |
| Group movies into collections | `EnableGroupingMoviesIntoCollections` | Full server configuration |
| Group series into collections | `EnableGroupingShowsIntoCollections` | Full server configuration |
| Include external content in suggestions | `EnableExternalContentInSuggestions` | Full server configuration |

The adapter accepts only actual booleans for all six properties. If either source fails or any managed field is missing, null, or malformed, the page shows one unavailable state and cannot save; missing data is never displayed or persisted as `false`.

The page performs two parallel GETs on initial load because Jellyfin 10.11.11 does not expose a one-request contract spanning both resources. It does not poll. Before an explicit Save, the service refetches both authoritative documents, verifies that the six managed values still match the confirmed editing baseline, and aborts with a conflict if another administrator changed them. It shallow-clones both complete documents, patches only the changed managed booleans, and preserves unrelated, future, plugin-added, and nested values. Only resources with changed managed values are written. When both resources change, writes are coordinated sequentially and the first is restored from the just-refetched document if the second fails; the UI never claims success for a partial operation.

The query key begins with `PtvAdminLibraryDisplay`, includes the active Jellyfin server ID, identifies both source contracts, and cannot collide with Libraries, Metadata, or general settings queries. Before save, the hook cancels in-flight reads; after success it places the returned authoritative merged snapshot directly into this scoped cache. This prevents an older response from replacing the saved baseline. Dirty form state is not overwritten by background cache changes, and internal navigation plus browser unload use the existing unsaved-change protection.

### Native Metadata and NFO Settings

`#/settings/admin/libraries/metadata` owns the four global defaults from Jellyfin's full Server Configuration: `PreferredMetadataLanguage`, `MetadataCountryCode`, `DummyChapterDuration`, and `ChapterImageResolution`. Language and country labels come from Jellyfin's Localization APIs, and resolution values come from Jellyfin's SDK enum; PiggieTV does not maintain substitute catalogs. Empty language/country codes retain their backend meaning, and an exact dummy-chapter duration of zero disables dummy-chapter generation. Negative and fractional durations are rejected rather than treated as alternate sentinels. Provider, saver, and ordering arrays remain per-library and are not reconstructed by this page.

`#/settings/admin/libraries/nfo` owns four visible global values from named `xbmcmetadata`: the configured watch-data user, saved image paths, path substitution, and extra-thumbnail compatibility behavior. `ReleaseDateFormat` is a required invariant in the authoritative document but is not edited by this page; every save preserves it exactly. Jellyfin's Users API supplies friendly user labels only. The page never enables the NFO saver for a library, scans media, refreshes metadata, or generates sidecar files. Per-library NFO enablement remains a metadata-saver choice in Library Options.

Both pages load observationally, do not poll, and disable window-focus refresh so active edits are not disrupted. Metadata begins its full configuration and Localization requests in parallel; NFO begins the named configuration and user-label request in parallel. Localization and user-label failures remain optional enrichment failures rather than blanking an otherwise valid configuration form. A manual Retry/Reload is explicit. Before Save, each service refetches its authoritative configuration, compares managed values with the confirmed baseline, clones the complete current document, patches only fields owned by that page, and writes that one resource. Unknown, future, nested, and plugin-added fields remain intact. A conflict performs no write, failed saves retain edits, and successful saves replace only the exact server-scoped configuration cache. Because each page writes one authoritative resource, no client transaction or rollback layer is required.

The exact legacy `#/dashboard/libraries/metadata` and `#/dashboard/libraries/nfo` routes use replacement redirects to these native workspaces. Item-level Metadata Manager is a separate native workspace and does not read or write either global configuration document.

### Query identity, request budget, and partial failure

React Query keys begin with `PtvAdminLibraries` and include the active Jellyfin server ID, endpoint/source family, immutable library ID where applicable, collection type, and `isNewLibrary` response-shaping argument. Virtual-folder list, selected-library detail, provider capabilities, and scan-task results cannot collide; two libraries and two servers cannot share detail state.

The list performs one virtual-folders request plus one optional scheduled-task request, independent of library count. Jellyfin includes stored options in the virtual-folder response; PiggieTV does not issue a per-library request. A cold detail view reuses or refetches that scoped list, loads one collection-type options/provider response, and shares the one scan-task source. Directory browsing and creation capabilities load only when their dialogs are opened, and no media items are enumerated for decorative counts.

The virtual-folder list is required. Scan-task failure leaves the libraries manageable with scan status marked unavailable. Provider/options-info failure leaves general and folder management usable while the Metadata section shows unavailable with a focused Retry. The scan-task query refreshes at a bounded 10-second cadence only while the page is active; list refresh is explicit/invalidation driven and single-flight.

Successful mutations invalidate both the native Libraries keys and the existing virtual-folder consumers used by the Administration overview and Users access editors. PiggieTV does not maintain a second media categorization layer: Home, Movies, Shows, Music, Reading, Search, recommendations, and playback continue to consume Jellyfin's authoritative library views and item APIs, so a server-confirmed library change flows into those surfaces through their normal server queries and cache lifecycles.

## Native Metadata Quality workspace

`#/settings/admin/media/metadata-quality` is the PTV-native, administrator-only review queue for observational metadata audits. Its immutable-ID detail route is `#/settings/admin/media/metadata-quality/:itemId`. The scanner runs inside the PiggieTV Jellyfin plugin rather than in the browser, processes bounded 200-item batches, persists schema/rule/scanner-versioned fingerprints, and exposes no metadata mutation endpoint.

The initial queue load uses one combined summary/status request and one bounded 50-result page. Detail replaces the list request with one selected-result request; settings load only after the administrator opens the Settings dialog. While a scan is running, the shared summary query refreshes every eight seconds and pauses while the document is hidden. Idle queue pages do not poll. The Overview card reuses the same server-scoped summary query.

Deterministic rules remain useful without any external service. Suspicious supported item types may be verified through Jellyfin's configured remote providers under bounded concurrency and a per-run budget. Optional OpenAI reasoning is server-side, disabled by default, constrained to verified candidates, and receives only privacy-reduced identity evidence. It cannot invent or apply provider IDs. `Keep Current` and `Dismiss` update only the audit result; `Open Metadata Manager` is the correction path.

The complete scanner, API, persistence, confidence, provider, AI, and security design is documented in [PiggieTV Metadata Quality architecture](ptv-metadata-quality.md).

## Native Metadata Manager workspace

### Routes, scope, and ownership

`#/settings/admin/media/metadata-manager` is the canonical catalog route. `#/settings/admin/media/metadata-manager/:itemId` is the canonical item-detail route; the encoded route segment is the immutable Jellyfin item ID, never a title, path, provider ID, or list position. The exact legacy `#/metadata` route replaces history with the native catalog, and exact `#/metadata?id=<itemId>` links preserve and encode the item ID when redirecting to native detail. This compatibility handling does not claim unrelated hash routes.

Metadata Manager owns the PTV-native catalog, item metadata, Artwork, Identify, and Refresh presentation. Jellyfin remains authoritative for item discovery, metadata, images, provider lookups, matching, and refresh operations. This item-level boundary does not own global Metadata defaults, global NFO writer behavior, library creation/options, or per-library provider and saver ordering. The legacy metadata-editor and image-editor controllers remain in source only for established modal callers, such as item context menus and retained Music/Reading edit dialogs; they are not the routed Metadata Manager implementation.

### Catalog, query identity, and cancellation

Catalog and search reads are bounded and paginated. The workspace does not load every server item, recursively expand a complete tree, enumerate every child merely to render counts, or make one secondary request per visible row. Search uses the authoritative Jellyfin item query and its own normalized result state rather than filtering a previously downloaded full catalog. Empty catalog, empty search, core failure, and item-deleted states remain distinct.

Query identity includes the active server, authenticated user where the response is user-sensitive, catalog/source scope, search text, page/cursor, and immutable item ID as applicable. Item detail, image inventory, remote artwork, identify results, and catalog pages cannot collide. Superseded list, search, item, identify, and remote-artwork requests are cancelled where the client supports abort signals; request-generation checks prevent a slower prior response from overwriting a newer selection. Existing successful catalog data may remain visible while a next page refreshes, but item detail does not display stale data for a newly selected ID.

Opening the catalog or an item is observational. There is no Metadata Manager polling or focus-driven form replacement, and navigation does not refresh metadata, scan a library, run identification, search remote artwork, upload/delete/reorder images, or perform any other mutation. Remote artwork requests begin only when the administrator opens the relevant Artwork search workflow, and result paging remains bounded.

### Metadata editing and save safety

The editor consumes a normalized, type-aware model instead of exposing a raw Jellyfin item document. Unsupported or unavailable fields remain read-only or hidden, and missing data is never converted to a destructive empty value. Structured values such as provider identifiers, locked fields, taglines, studios, artist references, album artists, and people retain their complete backend objects. People and other structured-array edits use whole-item update semantics only where the implementation can preserve every member property; otherwise those arrays remain unowned and survive Save unchanged.

Metadata changes use explicit Save and Reset Changes actions. Immediately before Save, the service refetches the exact item, verifies that it still exists, compares the managed editing baseline with the authoritative managed values, clones the complete update payload, and patches only fields owned by the active editor. Unknown, plugin-added, future, type-specific, and unexposed fields are preserved. A detected external change blocks the write and offers Reload instead of silently merging or overwriting it. In-flight item reads are cancelled before mutation, stale responses cannot replace the confirmed result, and only the exact server/item caches are updated or invalidated after server confirmation. Failed saves retain the administrator's edits, and dirty item changes are protected across item selection, internal navigation, and browser unload.

### Artwork

Artwork uses Jellyfin's existing image inventory and image mutation APIs. Existing image information is loaded for the selected item; remote providers and results are lazy, independently retryable, and bounded. Upload, delete, set-from-remote, and supported ordering operations occur only after explicit administrator actions, with confirmation for destructive removal. A remote-artwork failure does not blank valid item metadata, and successful mutations invalidate the exact item and image caches without treating image URLs as metadata identity.

### Identify and Refresh

Identify is a deliberate two-step workflow: an explicit search returns normalized Jellyfin remote-search candidates, and a separate Apply action confirms the selected match. Apply invokes Jellyfin's matching/metadata-refresh operation with `replaceAllImages` disabled; it is not represented as an ordinary local field save. Official identify support is limited to the item types Jellyfin exposes through its existing rule: Movie, Trailer, Series, BoxSet, Person, Book, MusicAlbum, MusicArtist, and MusicVideo. Other types show Identify as unavailable instead of attempting a guessed generic lookup. Unknown providers and provider-specific identifiers render safely without becoming PTV-owned catalogs.

Refresh remains a separate, explicit maintenance action with clear scope and replacement choices. It never runs because an item was opened, selected, edited, saved, or identified. The client applies single-flight protection and reports only that Jellyfin accepted/queued the refresh request; acceptance is not proof that background metadata work has completed successfully. This workspace does not expose a server-wide mass refresh or automatically recurse across the catalog.

## Native Playback workspace

### Routes and ownership

`#/settings/admin/playback` opens Streaming by default. The four bookmarkable sections are:

- `#/settings/admin/playback/streaming`
- `#/settings/admin/playback/transcoding`
- `#/settings/admin/playback/resume`
- `#/settings/admin/playback/trickplay`

They share one PTV-native workspace and one Playback rail destination. Each exact legacy Dashboard route replacement-redirects to its matching section. This server administration domain remains completely separate from member `#/settings/playback`, which continues to own user and device playback preferences.

### Backend resources and managed fields

Streaming, Resume, and Trickplay read `GET /System/Configuration` and write the complete document with `POST /System/Configuration`. Streaming owns only `RemoteClientBitrateLimit`; its UI uses decimal Mbps and converts with `1 Mbps = 1,000,000 bits/second`, preserving zero as Jellyfin's unlimited sentinel. Resume owns the five global video/audiobook thresholds: `MinResumePct`, `MaxResumePct`, `MinResumeDurationSeconds`, `MinAudiobookResume`, and `MaxAudiobookResume`. Trickplay owns the twelve values inside `TrickplayOptions` used for global frame generation, quality, tiling, priority, and hardware behavior. Per-library trickplay enablement and storage remain owned by Libraries.

Transcoding reads and writes the complete named `encoding` configuration at `/System/Configuration/encoding`. The native form exposes the retained Jellyfin hardware mode, compatible decoding formats, output codecs, CRF/preset/thread controls, read-only FFmpeg path, transcode/font paths, audio, subtitles, deinterlacing, muxing, throttling, segment cleanup, and applicable tone-mapping controls. Hardware choices come from Jellyfin's SDK enum and codec visibility from Jellyfin Web's compatibility matrix; the page does not claim to detect installed GPUs or drivers and retains the compatibility warning used when acceleration is active. Transcode and fallback-font paths can use Jellyfin Web's existing authenticated server directory picker, remain verbatim server paths, and preserve an omitted/unset value unless an administrator edits it. `EncoderAppPath`, on-demand keyframe-extension configuration, unknown future properties, and unknown codec entries are unowned and preserved.

### Save, query, and operational safety

Every section loads only its active authoritative resource. Query identities begin with `PtvAdminPlayback`, include the connected server ID, section, and exact source, and cannot collide with the legacy `[Configuration]` cache or member Playback state. There is no polling or window-focus form replacement. Manual Retry/Reload is explicit, and duplicate saves are single-flight.

Before Save, the service refetches the complete authoritative resource, validates every managed field, compares the fresh managed projection with the confirmed baseline, deep-clones the current document, patches only the owned values, and writes only when something changed. External managed-field changes block the write and require Reload. Unknown, nested, future, plugin-added, and cross-section fields remain intact. Successful saves replace only the exact scoped cache. Missing or malformed required values make that section unavailable; they never become zero, false, empty arrays, or guessed defaults.

Each route-backed tab owns independent dirty state. Switching tabs while dirty opens the PTV Keep Editing / Discard Changes dialog, while other internal navigation and browser unload use the shared administration unsaved-change protection. Tab switching and discard remain blocked while a Save is in flight. Save and Reset remain in the current section rather than becoming a global floating action.

Loading configuration is observational. Saving does not start playback, disconnect sessions, generate trickplay images, scan libraries, run scheduled tasks, clear transcodes, or restart Jellyfin; the audited legacy flows do not report a restart requirement for these resources. Most Transcoding changes affect newly created jobs; Jellyfin may reread throttling and segment-cleanup settings for active jobs. Trickplay changes affect future generation only, and Resume thresholds are used on subsequent playback progress updates.

Initial request budget is one GET for the active section. Save is one authoritative GET followed by one POST when managed values changed; a no-op after the fresh read performs no POST.

## Native Live TV and DVR workspace

### Routes and authority

`#/settings/admin/livetv` is the native overview. Its contextual, bookmarkable routes are:

- `#/settings/admin/livetv/tuners`
- `#/settings/admin/livetv/tuners/new`
- `#/settings/admin/livetv/tuners/:tunerId`
- `#/settings/admin/livetv/guide`
- `#/settings/admin/livetv/guide/new?type=xmltv|schedulesdirect`
- `#/settings/admin/livetv/guide/:providerId`
- `#/settings/admin/livetv/dvr`

The native route parser also accepts `#/settings/admin/livetv/recordings` as a compatibility alias for DVR. Exact legacy Live TV, tuner, guide-provider, and recording routes replacement-redirect as shown in the compatibility table; IDs are decoded once, encoded for the native route, and never replaced by display labels.

| Concern | Jellyfin authority |
| --- | --- |
| Availability and runtime summary | Live TV API `getLiveTvInfo` (`GET /LiveTv/Info`) |
| Complete configured tuner/provider/DVR document | Configuration API `getNamedConfiguration` / `updateNamedConfiguration` with key `livetv` |
| Tuner capabilities and explicit discovery | Live TV API `getTunerHostTypes` and `discoverTuners({ newDevicesOnly: true })` |
| Tuner create/update/delete | Live TV API `addTunerHost` and `deleteTunerHost` |
| XMLTV and Schedules Direct providers | Live TV API `getDefaultListingProvider`, `addListingProvider`, and `deleteListingProvider` |
| Schedules Direct countries and lineups | Live TV API `getSchedulesDirectCountries` and `getLineups` |
| Guide refresh | Existing Scheduled Tasks API and the authoritative `RefreshGuide` task |
| Recording and XMLTV server paths | Existing authenticated Jellyfin server-directory browser |

Opening Live TV is observational. Tuner discovery, Schedules Direct country loading, and lineup lookup begin only after their explicit UI actions; loading the page never scans the network, validates a login, refreshes guide data, runs a task, or starts a recording. Guide refresh is a separate explicit Scheduled Task action and reports request acceptance rather than background completion.

### Save, cache, and secret safety

DVR Save refetches the full named `livetv` document, validates the managed projection against the confirmed baseline, clones the authoritative document, patches only owned values, posts the complete document, and confirms the result. Tuner and provider actions likewise refetch the current configuration, resolve the immutable ID, preserve the existing raw object and unowned fields, detect conflicting managed changes, perform the focused Jellyfin mutation, and confirm from a fresh configuration read. Destructive tuner/provider removal requires confirmation and a fresh existence check. Duplicate operations are single-flight.

Query identities begin with `PtvAdminLiveTv`, include the active Jellyfin server ID, and separate named configuration, Live TV capability, tuner types, explicit discovery, country catalog, and provider/country/postal-code lineup results. Configuration is fresh for 30 seconds; capability and tuner types are fresh for 120 seconds; the explicit country catalog may be reused for 24 hours; discovery and lineup results are action-scoped. The shared task query retains Scheduled Tasks' visible-document refresh behavior. No Live TV source refetches merely because the window gains focus, no expensive lookup polls, and coordinated Refresh uses all-settled source reads so a task or capability failure does not erase valid configuration.

Stored Schedules Direct passwords never enter the normalized model; a blank password preserves the existing secret, and a replacement remains transient component state. Persisted tuner URLs and XMLTV paths/URLs are reduced to safe summaries in presentation/query data; before Save, the service refetches the authoritative raw object and preserves the stored value unless an administrator explicitly replaces it. User-facing errors omit credentials, raw server paths, response objects, and request details.

Channel mapping is intentionally deferred: the native phase does not bulk-rewrite channel identities or invent a mapping API. Unknown/plugin-provided tuner or guide-provider types remain visible as preserved unavailable configuration and are not forced through a guessed editor. Page load and ordinary saves do not trigger guide refreshes, library scans, or recording-file rewrites.

## Native Server Administration workspace

### Routes and backend ownership

`#/settings/admin/server` replacement-normalizes to General. The six canonical section routes are:

- `#/settings/admin/server/general`
- `#/settings/admin/server/branding`
- `#/settings/admin/server/networking`
- `#/settings/admin/server/api-keys`
- `#/settings/admin/server/backups`
- `#/settings/admin/server/logs` and contextual `#/settings/admin/server/logs/:encodedFilename`

| Section | Authoritative source and operation |
| --- | --- |
| General | Jellyfin `GET/POST /System/Configuration`, `GET /System/Info`, `GET /Localization/Options`, and explicit System API restart/shutdown actions |
| Branding | Jellyfin `GET /Branding/Configuration`, focused `POST /System/Configuration/Branding`, and explicit custom splash-screen upload/delete |
| Networking | Complete named `network` configuration through `GET/POST /System/Configuration/network` |
| API Keys | Jellyfin API Key API `getKeys`, `createKey`, and `revokeKey` |
| Jellyfin Backups | Jellyfin Backup API `listBackups`, `createBackup`, `getBackup`, and `startRestoreBackup` |
| PiggieTV account backup | `GET /Ptv/v1/account/admin/health`, `POST /Ptv/v1/account/admin/backups`, `/verify`, and `/restore` |
| Logs | Jellyfin System API `getServerLogs` and `getLogFile` |

General owns the audited server name, locale, Quick Connect availability, cache/metadata paths, and bounded concurrency controls; System Info is read-only. Branding owns custom CSS, login disclaimer, splash-screen enablement, and explicit image upload/delete. Networking owns the complete retained listener/port/protocol/base URL/certificate/bind/subnet/proxy/published-URI/filter surface. PiggieTV does not add CPU, RAM, storage, filesystem, or remote-management collectors.

### Configuration and query safety

Every full-document General or Networking save performs a fresh authoritative read, compares the managed projection with the confirmed baseline, clones the complete document, patches only owned fields, preserves unknown/nested/future/plugin-added values, writes once, and post-verifies. Branding follows the same conflict and confirmation standard over its focused configuration document. Missing or malformed managed values make the affected form unavailable; they never become guessed empty strings, zeros, false values, or empty arrays. Dirty forms use explicit Save/Reset and the shared unsaved-navigation protection.

Configuration query identities begin with `PtvAdminServerConfiguration`; operational query identities begin with `PtvAdminServerOperations`. Both include the connected server ID and then the exact source, with opaque row IDs for API keys, backup manifests, and log detail. General/Branding/Networking, API Keys, backups, and PiggieTV backup health use 60-second stale windows; System Info and logs use 30 seconds; Localization uses five minutes. There is no polling or focus-driven form replacement. Mutations are single-flight, cancel the affected in-flight query before writing, and update or invalidate only the exact server/source cache. General's System Info/Localization enrichment, Jellyfin backup inventory, PiggieTV backup health, and log list/detail fail independently.

Networking changes that can interrupt connectivity require a dedicated confirmation. The authoritative certificate password remains in a private service-side authority vault; query/UI models expose only whether it is configured, blank means preserve, and replace/clear are explicit modes. If the write succeeds but the browser cannot reconnect for verification, the result is reported as accepted but unverified instead of false success or false rollback.

### Operational and secret safety

API-key rows are normalized with opaque IDs and masked metadata; raw tokens remain in a private per-API vault and never enter the query cache, DOM attributes, routes, storage, or logs. Because Jellyfin's create call does not return the new token, PiggieTV compares fresh before/after inventories and reveals a token once only when exactly one unambiguous key with the requested application name appeared. Revocation fresh-validates the protected token and fingerprint before sending it.

Jellyfin backup filesystem paths likewise remain private and are represented by opaque row IDs. Restore reloads the inventory, fetches the selected manifest, and verifies both path identity and manifest fingerprint immediately before the confirmed restore request. Database content is always included; metadata, subtitles, and trickplay are explicit optional creation choices. The available backend does not expose safe delete, download, or truthful progress contracts, so those controls are intentionally absent.

PiggieTV account-backup status exposes only normalized health. The backup ID remains private; Verify and dry-run resolve the latest authoritative ID at action time, and live restore requires an immediately successful verified dry-run followed by explicit destructive confirmation. Signup & Invites may display the health warning, but all backup operations live here.

Log navigation never sends a route filename directly to Jellyfin. The page first loads the authoritative log list, exact-matches the decoded filename to a normalized row, replaces it with an opaque ID, and the service fresh-validates the list again before reading. Jellyfin's existing log-file API returns the file without a range contract; native detail therefore bounds the retained/rendered UTF-8 preview to 512 KiB rather than claiming a server-side partial read. Explicit Download performs a separate full read and does not retain that full body in the query cache. Log search, tailing, parsing, clearing, and synthetic warning extraction are deferred; Diagnostics therefore remains a separate partial workspace even though Logs itself is migrated.

Server restart, shutdown, backup creation/restore, splash changes, key creation/revocation, and log download all require explicit actions. Page load never performs a mutation. Power actions use focused confirmation and single-flight protection; no additional process-control surface is introduced.

## Native Scheduled Tasks workspace

`#/settings/admin/tasks` is the canonical task list and `#/settings/admin/tasks/:taskId` is the canonical detail route. The immutable Jellyfin task ID is the route identity; task names, categories, and list positions remain presentation only. Exact legacy `#/dashboard/tasks` and `#/dashboard/tasks/:id` routes replace history with their native equivalents without intercepting unrelated Dashboard routes.

The list reads `GET /ScheduledTasks?isHidden=false`; detail reads `GET /ScheduledTasks/{taskId}`. Explicit Run and Stop actions use Jellyfin's existing running-task endpoints, and trigger changes use the complete-array `POST /ScheduledTasks/{taskId}/Triggers` contract. Opening either route is observational: it never starts, stops, or reschedules a task. Missing task IDs, trigger arrays, state, progress, or execution results remain unavailable rather than becoming invented defaults, and the UI does not claim an enabled state or next execution time because `TaskInfo` does not provide those values.

Task query identities include the connected server ID, list/detail source, visibility filter, and immutable task ID. The native workspace does not reuse the legacy global `['Tasks']` cache as its authority. Successful operations invalidate the exact native task data and the Overview task summary; library-scan consumers are also refreshed when the authoritative library task changes.

The task list and selected detail poll every 8 seconds while a task is running or cancelling and every 45 seconds while idle. Polling is disabled while the document is hidden; returning to a visible tab performs one coordinated, single-flight refresh. Manual Refresh uses the same single-flight protection, never reloads the browser, and never executes a task. The list remains one request regardless of task count, while a detail request begins only after selecting or directly loading one task.

Task discovery is dynamic and has no allowlist. PiggieTV ownership is identified only from its stable `Ptv*` task key or `PiggieTV` category; all other core and plugin tasks remain visible under server-provided categories without guessed source labels. Unknown task and trigger types render with safe fallbacks. The registered `PTV Account Data Backup` task therefore appears naturally as PiggieTV maintenance, while backup artifacts and restore operations remain outside this workspace.

Trigger editing uses explicit Save and Reset. Before replacing the complete trigger array, the service refetches the authoritative task, compares it with the confirmed baseline, preserves unknown or unavailable trigger types and fields, and blocks conflicting writes. A failed save keeps edits visible and never reports success. Run and Stop remain separate explicit operations and do not rewrite triggers.

## Authorization and security boundary

All retained `#/dashboard/...` and `#/configurationpage` routes, plus the exact legacy `#/metadata` compatibility route, remain inside the existing `ConnectionRequired level='admin'` router boundary. It verifies the current authenticated Jellyfin user's `Policy.IsAdministrator` value before mounting the Dashboard layout or legacy redirect.

The PTV Settings application is an authenticated user route, so `SettingsPage` performs an additional administrator-policy check before mounting `#/settings/admin` or any native People, Media (including Metadata Quality), Playback, Live TV/DVR, Plugin Manager, Server, Logs, Backups, or Scheduled Tasks route; non-administrators are redirected to `#/settings` before administration data loads. A failed policy lookup remains fail-closed, loads no administration data, and presents Retry authorization plus a safe path back to Settings instead of leaving a permanent spinner. The Settings hub and settings navigation also omit administrator entries for normal members.

Navigation visibility is not treated as authorization. `PtvAdminLayout` is presentation, while the authenticated Jellyfin policy and route boundaries remain the enforcement layer. Direct navigation to every retained management route is therefore still protected.

Administration-facing models intentionally exclude access tokens, authorization headers, SMTP and Schedules Direct passwords, certificate passwords, persisted tuner/XMLTV locations, backup filesystem paths and IDs, remote endpoints, known IP-bearing core Activity Log `ShortOverview` values, raw plugin/package manifests, raw plugin response objects, and filesystem credentials. Immutable user, device, item, task, library, plugin, tuner, provider, and opaque operation IDs remain route/mutation keys only and are not presented as human-facing labels. Plugin names, descriptions, repository text, dynamic labels, and icons are normalized and rendered as text rather than trusted markup.

## Cross-domain ownership guardrails

The final audit found no deliberate PTV controls with competing write ownership. These potentially confusing pairs remain separated by scope:

| Setting or action | Canonical PTV owner | Backend authority / write | Other surface behavior |
| --- | --- | --- | --- |
| Member playback preferences and client bitrate | Member Playback Settings | Jellyfin user configuration plus existing app preferences | Admin Streaming does not write member preferences. |
| Server remote-stream bitrate limit | Admin Playback → Streaming | Jellyfin `System/Configuration.RemoteClientBitrateLimit` | Member Playback does not write server configuration. |
| Global preferred metadata language/country | Admin Media → Metadata | Jellyfin full System Configuration | Server General does not duplicate these controls. |
| Per-library metadata language/provider/saver state | Admin Media → Libraries detail | Jellyfin virtual-folder library options | Global Metadata and NFO do not reconstruct per-library provider/saver arrays. |
| Global NFO writer behavior | Admin Media → NFO Settings | Jellyfin named `xbmcmetadata` configuration | Metadata Manager edits item data; it does not own writer configuration. |
| Metadata-quality scan and review state | Admin Media → Metadata Quality | PiggieTV plugin audit store over observational Jellyfin item/provider reads | Metadata Manager remains the only first-party item correction surface; Metadata Quality has no fix/apply endpoint. |
| Global trickplay generation defaults | Admin Playback → Trickplay | Jellyfin System Configuration `TrickplayOptions` | Per-library extraction/storage enablement remains in Library detail. |
| Verified account email and recovery state | PiggieTV account/profile flows | PiggieTV account service keyed by immutable Jellyfin user ID | Jellyfin Users remains account/policy authority and does not become a second email store. |
| Plugin installation and repositories | Admin Plugins | Jellyfin Plugins/Packages/Repositories APIs | Arbitrary configuration fields remain **PLUGIN_OWNED**. |
| Scheduled backup execution | Tasks & Maintenance | Jellyfin scheduled-task authority | Backups owns artifact inventory, validation, and restore; it does not create a second scheduler. |

Every full-document configuration writer uses a domain-specific variant of the same invariant: fresh authoritative read, managed-field baseline comparison, conflict rejection, complete-document clone, focused patch, unknown/future/plugin field preservation, write, and authoritative cache adoption or verification. Multi-resource Library Display save uses deterministic ordering and a managed-field rollback that preserves concurrent unknown-field updates. This is intentionally not hidden behind a single generic administration service because resource validation and rollback semantics differ.

## Query, request, and polling inventory

All server-derived native Administration keys include the resolved active server ID, a source/resource family, and immutable entity or response-shaping arguments where applicable. If server identity is unavailable, the associated query remains disabled; no generic `current-server`, `settings`, `users`, `plugins`, `metadata`, `tasks`, or `devices` key becomes cached authority. The full endpoint-path identity regression between `/Ptv/v1/settings` and `/Ptv/v1/signup/admin/settings` remains covered, and plugin transport response/in-flight caches are additionally scoped by active server and request root.

| Workspace | Representative initial request budget | Fan-out / DOM bound |
| --- | --- | --- |
| Users list | 3: Users, batched PTV profile summaries, shared Sessions | No per-user calls. |
| Libraries list | 2: virtual folders and scan-task summary | No per-library item/detail calls. |
| Metadata Manager catalog | 2 bounded catalog/root sources; selected item adds a bounded detail bundle | 50-item catalog page; artwork, remote results, and Identify are interaction-lazy. |
| Metadata Quality queue | 2: combined status/summary and one bounded result page; direct detail replaces the list request with one detail request | 50-result page, top-three list reasons, and no per-result calls; settings are interaction-lazy. |
| Tasks | 1 list request; selected task adds 1 detail request | No per-task detail fan-out. |
| Devices | 3: Devices, shared Sessions, Users | No per-device calls; renders 50 matching cards at a time. |
| Activity | 1 bounded 50-entry page plus shared Users labels | No per-entry enrichment. |
| Plugins | One source for the active Installed/Catalog/Repositories section plus shared configuration discovery where needed | No per-plugin package/config calls. |
| Logs | 1 authoritative log list; selected log adds 1 lazy read | No per-log content reads; preview is capped at 512 KiB. |

Dynamic polling is limited to Overview Sessions (30 seconds) and summary sources (90 seconds), the cheap Metadata Quality Overview summary (90 seconds), Metadata Quality scan status while running (8 seconds), Users/Devices Sessions (30 seconds), Activity (60 seconds), Libraries scan-task state (10 seconds), and Tasks (8 seconds running/cancelling; 45 seconds idle). These intervals suspend while the document is hidden and refresh once when visibility returns. Metadata Quality stops polling when idle. Static configuration, plugin inventory, Live TV configuration/discovery, Server forms, Logs, and Signup settings do not poll or replace dirty forms on window focus.

## Final administration destination inventory

| Destination | Canonical route | UI owner | Backend authority | Status | Legacy alias |
| --- | --- | --- | --- | --- | --- |
| Overview | `#/settings/admin` | PiggieTV | Jellyfin System/Sessions/Tasks/Libraries plus PTV status | **PTV_NATIVE** | `#/dashboard` |
| PiggieTV Configuration | `#/settings/admin/piggietv` | PiggieTV | PiggieTV plugin | **PTV_NATIVE** | `#/dashboard/piggietv` |
| Home Rows | `#/settings/admin/piggietv/rows` | PiggieTV | PiggieTV row configuration | **PTV_NATIVE** | `#/dashboard/piggietv/rows` and `/recommendations` |
| Diagnostics | `#/settings/admin/piggietv/diagnostics` | PiggieTV | PiggieTV runtime diagnostics | **PTV_NATIVE** | `#/dashboard/piggietv/diagnostics` |
| Users | `#/settings/admin/users` | PiggieTV | Jellyfin Users/Policy/Passwords plus read-only PTV profile summaries | **PTV_NATIVE** | `#/dashboard/users*` except parental controls |
| Signup & Invites | `#/settings/admin/users/signup-invites` | PiggieTV | PiggieTV Signup/account services | **PTV_NATIVE** | `#/dashboard/users/signup-invites` |
| Devices | `#/settings/admin/devices` | PiggieTV | Jellyfin Devices/Sessions/Users | **PTV_NATIVE** | `#/dashboard/devices` |
| Activity | `#/settings/admin/activity` | PiggieTV | Jellyfin Activity Log | **PTV_NATIVE** | `#/dashboard/activity` |
| Libraries | `#/settings/admin/libraries` | PiggieTV | Jellyfin Virtual Folders/library options | **PTV_NATIVE** | `#/dashboard/libraries` |
| Library Display | `#/settings/admin/libraries/display` | PiggieTV | Jellyfin System + named metadata configuration | **PTV_NATIVE** | `#/dashboard/libraries/display` |
| Metadata | `#/settings/admin/libraries/metadata` | PiggieTV | Jellyfin System Configuration/localization | **PTV_NATIVE** | `#/dashboard/libraries/metadata` |
| NFO Settings | `#/settings/admin/libraries/nfo` | PiggieTV | Jellyfin named `xbmcmetadata` configuration | **PTV_NATIVE** | `#/dashboard/libraries/nfo` |
| Media Management | `#/settings/admin/media` | PiggieTV | Navigation only | **PTV_NATIVE** | None |
| Metadata Quality | `#/settings/admin/media/metadata-quality` | PiggieTV | PiggieTV scanner/result store plus observational Jellyfin item/provider APIs | **PTV_NATIVE** | None |
| Metadata Manager | `#/settings/admin/media/metadata-manager` | PiggieTV | Jellyfin item metadata/artwork/identify/refresh APIs | **PTV_NATIVE** | `#/metadata` |
| Playback | `#/settings/admin/playback` | PiggieTV | Jellyfin System + named encoding configuration | **PTV_NATIVE** | `#/dashboard/playback/*` |
| Live TV | `#/settings/admin/livetv` | PiggieTV | Jellyfin Live TV tuners/guide/capability | **PTV_NATIVE** | `#/dashboard/livetv*` |
| DVR | `#/settings/admin/livetv/dvr` | PiggieTV | Jellyfin named `livetv` configuration | **PTV_NATIVE** | `#/dashboard/livetv/recordings` |
| Plugin Manager | `#/settings/admin/plugins` | PiggieTV | Jellyfin Plugins/Packages/Repositories | **PTV_NATIVE** | `#/dashboard/plugins*` |
| Dynamic plugin configuration | `#/configurationpage?name=…` | Installed plugin | Installed plugin | **PLUGIN_OWNED** | Canonical retained route |
| Server General | `#/settings/admin/server/general` | PiggieTV | Jellyfin System Configuration/System Info | **PTV_NATIVE** | `#/dashboard/settings` |
| Branding | `#/settings/admin/server/branding` | PiggieTV | Jellyfin Branding configuration | **PTV_NATIVE** | `#/dashboard/branding` |
| Networking | `#/settings/admin/server/networking` | PiggieTV | Jellyfin named network configuration | **PTV_NATIVE** | `#/dashboard/networking` |
| API Keys | `#/settings/admin/server/api-keys` | PiggieTV | Jellyfin API Keys | **PTV_NATIVE** | `#/dashboard/keys` |
| Backups | `#/settings/admin/server/backups` | PiggieTV | Jellyfin backups plus PiggieTV account backups | **PTV_NATIVE** | `#/dashboard/backups` |
| Logs | `#/settings/admin/server/logs` | PiggieTV | Jellyfin log list/file APIs | **PTV_NATIVE** | `#/dashboard/logs*` |
| Tasks & Maintenance | `#/settings/admin/tasks` | PiggieTV | Jellyfin Scheduled Tasks | **PTV_NATIVE** | `#/dashboard/tasks*` |
| Parental controls | `#/dashboard/users/parentalcontrol?userId=…` | Jellyfin | Jellyfin user policy | **LEGACY_COMPATIBILITY** | Canonical retained route |

## Intentional exceptions and deferred capabilities

Normal first-party PiggieTV administration is native. The following boundaries are deliberate and do not make the administration migration incomplete:

- Parental controls remain **LEGACY_COMPATIBILITY** until native equivalence can be delivered without conflating them with user policy fields already owned by Users.
- Live TV channel mapping is **DEFERRED** until Jellyfin exposes a safe authoritative contract suitable for accessible editing.
- Jellyfin backup delete/download/progress and PiggieTV historical backup browse/download/delete are **DEFERRED** where no safe backend contract exists.
- Log tailing, server-wide search/parsing, clearing, and synthetic warning extraction are **DEFERRED** pending bounded, privacy-reviewed backend support.
- PiggieTV Configuration, Home Rows, and Diagnostics are **PTV_NATIVE**. Their Dashboard routes are compatibility redirects only.

Arbitrary third-party dynamic configuration forms are not a migration backlog item: they remain **PLUGIN_OWNED** by design. The centralized registry and shared layout allow future first-party destinations to move without another administration shell rewrite.
