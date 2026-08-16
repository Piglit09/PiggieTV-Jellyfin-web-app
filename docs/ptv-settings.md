# PiggieTV Settings architecture

PiggieTV Web owns the authenticated settings experience at `#/settings`. The UI is a first-party React surface; it does not mount, iframe, or DOM-skin the legacy preference pages. Existing service APIs remain authoritative so playback and profile behavior stay compatible with the connected installation.

## Route map

| PiggieTV route | Owner | Persistence |
| --- | --- | --- |
| `#/settings` | `SettingsPage` and `SettingsHub` | Read-only aggregation |
| `#/settings/profile` | PiggieTV account profile | PiggieTV account API; current authenticated user identity |
| `#/settings/devices` | Device settings | Quick Connect API and active sessions API |
| `#/settings/appearance` | Appearance settings | Versioned device-local key `ptv:appearance:v1` |
| `#/settings/home` | Home settings | Profile-scoped server display preference `ptv.home.preferences.v1` |
| `#/settings/playback` | Playback settings | Current user configuration plus established device bitrate settings |
| `#/settings/subtitles` | Subtitle settings | Current user configuration plus device subtitle appearance settings |
| `#/settings/controls` | Controls and accessibility | Established device control settings plus `ptv:appearance:v1` |
| `#/settings/connection` | Connection summary | Public service information; read-only in production |
| `#/settings/admin` | PTV administration control center | Administrator-only, read-only aggregation |
| `#/settings/admin/devices` | PTV native server-wide Devices | Jellyfin registered Devices, Sessions, and Users APIs; explicit removal only |
| `#/settings/admin/activity` | PTV native Activity | Paged Jellyfin Activity Log plus shared user labels; observational |
| `#/settings/admin/tasks` | PTV native Scheduled Tasks list | Jellyfin scheduled-task state plus explicit Run and Stop actions |
| `#/settings/admin/tasks/:taskId` | PTV native Scheduled Task detail | Jellyfin task detail and complete trigger-array configuration; explicit administrator save |
| `#/settings/admin/users` | PTV native user list | Jellyfin users plus batched, read-only PTV profile and Jellyfin session enrichment |
| `#/settings/admin/users/signup-invites` | PTV native Signup & Invites | PiggieTV signup settings, email test, invitation, and account-health APIs plus Jellyfin media-folder choices |
| `#/settings/admin/users/:userId` | PTV native user detail | Jellyfin account/policy/library/password APIs; PTV email state is read-only |
| `#/settings/admin/libraries` | PTV native Libraries list | Jellyfin virtual folders plus shared library-scan task state |
| `#/settings/admin/libraries/display` | PTV native Library Display | Jellyfin server configuration plus named `metadata` configuration; explicit administrator save |
| `#/settings/admin/libraries/metadata` | PTV native global Metadata | Jellyfin server configuration plus Localization cultures/countries; explicit administrator save |
| `#/settings/admin/libraries/nfo` | PTV native NFO Settings | Jellyfin named `xbmcmetadata` configuration plus user-label enrichment; explicit administrator save |
| `#/settings/admin/libraries/:libraryId` | PTV native library detail | Jellyfin virtual-folder, path, library-options, provider-summary, and explicit scan APIs |
| `#/settings/admin/media` | PTV native Media Management hub | Administrator-only, read-only navigation aggregation |
| `#/settings/admin/media/metadata-quality` | PTV native Metadata Quality queue | Server-side bounded audit summaries/results; opening the route is observational |
| `#/settings/admin/media/metadata-quality/:itemId` | PTV native Metadata Quality review | Full evidence for one immutable Jellyfin item ID; correction delegates to Metadata Manager |
| `#/settings/admin/media/metadata-manager` | PTV native Metadata Manager catalog | Bounded Jellyfin item catalog/search queries; navigation is observational |
| `#/settings/admin/media/metadata-manager/:itemId` | PTV native Metadata Manager item workspace | Jellyfin item metadata, image, remote-search/identify, and refresh APIs; explicit administrator actions only |
| `#/settings/admin/playback` and `#/settings/admin/playback/:section` | PTV native server Playback | Jellyfin full server or named `encoding` configuration; section-scoped explicit save |
| `#/settings/admin/livetv` | PTV native Live TV overview | Jellyfin named `livetv` configuration, Live TV capability, tuner types, and shared Refresh Guide task |
| `#/settings/admin/livetv/tuners`, `/tuners/new`, and `/tuners/:tunerId` | PTV native tuner management | Jellyfin tuner host APIs; discovery is explicit-only |
| `#/settings/admin/livetv/guide`, `/guide/new`, and `/guide/:providerId` | PTV native guide-provider management | Jellyfin listing-provider, country, and lineup APIs; lookups are explicit-only |
| `#/settings/admin/livetv/dvr` | PTV native DVR | Jellyfin named `livetv` configuration; conflict-aware full-document save |
| `#/settings/admin/plugins` and native tab/detail routes | PTV native Plugin Manager | Jellyfin plugins, packages, repositories, and explicit plugin actions |
| `#/settings/admin/server/general` | PTV native Server General | Jellyfin system/configuration/localization APIs plus confirmed power actions |
| `#/settings/admin/server/branding` | PTV native Branding | Jellyfin branding configuration and explicit splash-screen operations |
| `#/settings/admin/server/networking` | PTV native Networking | Jellyfin named `network` configuration; connectivity-aware explicit save |
| `#/settings/admin/server/api-keys` | PTV native API Keys | Jellyfin API Key API with masked inventory and one-time create reveal |
| `#/settings/admin/server/backups` | PTV native Backups | Jellyfin Backup API plus PiggieTV account-backup APIs |
| `#/settings/admin/server/logs` and `#/settings/admin/server/logs/:filename` | PTV native Logs | Authoritative Jellyfin log list, bounded preview, and explicit full download |

## Audit and migration decisions

| Previous surface | Previous state owner | PiggieTV disposition |
| --- | --- | --- |
| `#/mypreferencesmenu` | Jellyfin Web settings list | Redirected to `#/settings` |
| `#/profile` | PiggieTV account profile | Redirected to `#/settings/profile`; account APIs reused |
| `#/quickconnect` | Quick Connect API | Redirected to `#/settings/devices`; code authorization reused without logging codes |
| `#/mypreferencesdisplay` | Local app/user settings and theme catalog | Redirected to Appearance; upstream theme choice intentionally removed because PiggieTV owns its theme |
| `#/mypreferenceshome` | User display preferences | Redirected to Home; PiggieTV's existing scoped Home preference document is authoritative |
| `#/mypreferencesplayback` | User configuration and local bitrate settings | Redirected to Playback; existing values and update calls are adapted |
| `#/mypreferencessubtitles` | User configuration and subtitle appearance settings | Redirected to Subtitles; existing values and update calls are adapted |
| `#/mypreferencescontrols` | Local app settings | Redirected to Controls & Accessibility; unsupported controls are omitted |
| `#/userprofile` | Shared user-editor route | Retained for administrator user editing only; it is not linked from PiggieTV Settings |
| `#/dashboard/users` | Jellyfin Users list | Redirected to `#/settings/admin/users`; PiggieTV owns the visible list and detail experience |
| `#/dashboard/users/add` | Jellyfin Add User page | Redirected to the native Add User dialog through `#/settings/admin/users?action=add` |
| `#/dashboard/users/profile`, `/access`, and `/password` | Jellyfin user detail pages | Redirected by immutable `userId` to the matching native detail/profile, Access, or Security context |
| `#/dashboard/users/parentalcontrol` | Jellyfin parental-control editor | Retained until the native detail workspace has complete equivalent controls |
| `#/dashboard/users/signup-invites` | PiggieTV Signup & Invites page | Exact replacement redirect to `#/settings/admin/users/signup-invites` |
| `#/dashboard/libraries` | Jellyfin Libraries list | Redirected to `#/settings/admin/libraries`; PiggieTV owns the visible list/detail, create, folder, option, scan, and removal experience |
| `#/dashboard/libraries/display` | Jellyfin Library Display settings | Redirected to `#/settings/admin/libraries/display`; PiggieTV owns the six-setting display form while Jellyfin remains authoritative |
| `#/dashboard/libraries/metadata` | Jellyfin global metadata defaults | Redirected to `#/settings/admin/libraries/metadata`; PiggieTV owns the global defaults form while Jellyfin remains authoritative |
| `#/dashboard/libraries/nfo` | Jellyfin global NFO writer settings | Redirected to `#/settings/admin/libraries/nfo`; per-library NFO saver state remains part of library options/provider ownership |
| `#/metadata` | Legacy Jellyfin Metadata Manager catalog route | Exact replacement redirect to `#/settings/admin/media/metadata-manager` |
| `#/metadata?id=<itemId>` | Legacy Jellyfin Metadata Manager item link | Preserves and encodes the immutable item ID, then replacement-redirects to `#/settings/admin/media/metadata-manager/:itemId` |
| `#/dashboard/tasks` | Jellyfin Scheduled Tasks list | Exact replacement redirect to `#/settings/admin/tasks` |
| `#/dashboard/tasks/:id` | Jellyfin Scheduled Task detail | Preserves and encodes the immutable task ID, then replacement-redirects to `#/settings/admin/tasks/:taskId` |
| `#/dashboard/livetv`, `/tuner`, `/guide`, and `/recordings` | Jellyfin Live TV/DVR routes | Replacement-redirect to the matching native overview, tuner, guide-provider, or DVR route while preserving supported immutable IDs/types |
| `#/dashboard/settings`, `/branding`, `/networking`, `/keys`, `/backups`, and `/logs` | Jellyfin Server routes | Replacement-redirect to the matching native Server section; log filenames are encoded and revalidated against the authoritative list |
| Server-discovered `#/configurationpage?name=...` | Third-party plugin configuration | Retained as **LEGACY / PLUGIN_OWNED**; PiggieTV supplies navigation/shell only and does not recreate arbitrary schemas |
| First-party PiggieTV Dashboard configuration routes | Retained workflows | Remain administrator-only pending focused native routing equivalence |

The old HTML controllers remain in the source tree because other upstream compatibility paths can import their logic. They are no longer registered as authenticated preference routes in either the stable or experimental application.

Legacy item metadata and image editor controllers also remain for established modal callers, including item context menus and retained Music/Reading edit dialogs. They are no longer the routed Metadata Manager owner.

## State and failure behavior

- Appearance, motion, focus, and control changes apply immediately on the current web device. A failed local write reapplies the previous state.
- Home changes use the existing user/server-scoped preference document and restore the previous document if the flush fails.
- Playback and subtitle forms use explicit Save actions. A failed save restores the last confirmed settings and shows an inline error.
- Quick Connect codes and passwords are kept in component state only and are never written to logs.
- Administration routes are hidden for non-administrators and protected again at the route component boundary.
- The native Users list treats Jellyfin accounts as required and PTV profile/session enrichment as independent and optional. A profile failure never hides core users, and loading either route performs no account mutation.
- Native Signup & Invites keeps settings, invitations, account health, and media-folder choices in separate component-local source states with stale-response/unmount guards and no polling. Opening the route is observational; SMTP tests and invitation/settings mutations are explicit and single-flight. Stored SMTP passwords are represented only by configured state; clear invite codes never enter list state and the transient one-time reveal clears after Copy, Dismiss, or unmount. Backup operations live exclusively in Server Backups.
- Library-access editing fails closed when the user policy or media-folder inventory is unavailable; missing data is never normalized to an empty permission set.
- Native library option saves refetch and clone the full authoritative Jellyfin options object before applying focused changes. Missing options disable Save, unknown fields are preserved, and scans run only after explicit administrator action.
- Native Library Display loads the general and named metadata configurations as one fail-closed form. Save refetches both sources, preserves every unmanaged field, patches only the six audited booleans, and refuses to write incomplete, malformed, or conflicting data.
- Native Metadata and NFO load only their authoritative global configuration plus server-owned label catalogs. Explicit Save refetches the authoritative document, detects managed-field conflicts, clones the complete document, patches only owned fields, and preserves unknown values. Neither page polls, scans libraries, refreshes item metadata, writes sidecars on load, or changes per-library provider/saver arrays.
- Native Metadata Manager catalog/search requests are bounded, paginated, and keyed by server, user-sensitive scope, source, search, page, and immutable item ID. Superseded list, detail, artwork, and identify requests are cancelled or generation-guarded so stale responses cannot replace the active item. Remote artwork is fetched only after its search workflow opens.
- Native Metadata Quality requests are keyed by server, source, every result-shaping filter/page, and immutable item ID. Queue load is one summary plus one 50-row page; selected evidence, settings, provider verification, and optional AI work are lazy/server-side. Running-scan polling pauses while hidden and stops when idle.
- Native Scheduled Tasks list/detail queries are keyed by server, source, visibility filter, and immutable task ID. Opening either route is read-only; Run, Stop, and trigger replacement require explicit administrator intent, and full-array trigger saves refetch authority, detect baseline conflicts, and preserve unknown trigger data.
- Native Live TV query identities are keyed by server and exact source. Named configuration, capabilities, tuner types, and Scheduled Tasks load independently; tuner discovery, Schedules Direct countries/lineups, guide refresh, saves, and removals occur only after explicit actions. Full-document DVR changes and focused tuner/provider changes refetch authority, preserve unowned fields, detect conflicts, and confirm the result.
- Live TV presentation excludes stored provider passwords and redacts persisted tuner/XMLTV connection values; blank secrets preserve stored values. Channel mapping and unknown plugin-provider editors are deferred rather than guessed.
- Native Server configuration and operation queries are keyed by server, section/source, and opaque operation row IDs. Full-document General/Networking saves and focused Branding saves use fresh-authority conflict checks, lossless patching, and post-write verification. There is no Server polling or focus-driven form replacement.
- API-key tokens, certificate/SMTP/provider passwords, backup paths/IDs, and full log bodies are excluded from ordinary query models. API-key creation can reveal one unambiguous new token once; restores and revocations revalidate authority immediately before mutation. Jellyfin exposes no log-range contract, so the native detail bounds the retained/rendered preview to 512 KiB; explicit Download performs a separate full read that is not cached.
- Backup delete/download/progress, Live TV channel mapping, and log search/tail/clear remain deferred because the audited backend does not provide the required safe contracts.
- Item metadata uses explicit conflict-aware Save: the exact item is refetched, the managed baseline is checked, and only owned fields are patched into a complete Jellyfin update payload while unknown fields survive. People and other structured arrays use whole-item updates only where complete member semantics are implemented; otherwise they remain unowned and preserved.
- Opening or navigating Metadata Manager performs no mutation. Artwork actions require explicit intent, Identify Apply invokes Jellyfin matching/metadata refresh, and Refresh reports only Jellyfin's queue acceptance rather than background completion. Official Identify availability is limited to Jellyfin-supported Movie, Trailer, Series, BoxSet, Person, Book, MusicAlbum, MusicArtist, and MusicVideo items.
- Production Connection UI never exposes a raw address or server-selection control. Development builds may show the configured service address and selector.

## UI ownership boundary

`SettingsPage` is the single route boundary and `PtvSettingsLayout` is the single desktop/mobile layout boundary. It verifies the authenticated Jellyfin user's `Policy.IsAdministrator` before lazy-mounting any native People, Media, Playback, Live TV/DVR, Plugin Manager, Server, Logs, Backups, or Scheduled Tasks route beneath the shared administration layout. Non-administrators are redirected before native administration queries begin, and authorization lookup failure remains fail-closed. Exact route resolution keeps Signup & Invites, Display, global Metadata, NFO, Metadata Quality queue/detail, Playback, Live TV tuner/guide/DVR, Server sections, Scheduled Tasks list/detail, immutable-ID library detail, and Metadata Manager catalog/item routes in separate ownership domains. `settingsAdapters.ts` remains the compatibility layer for established member configuration, session, connection, subtitle, and control APIs; focused administration services/adapters own normalized data without reaching into legacy routed-page DOM.

PTV profile/email normalization is shared with the account module. The administrator view reads `GET /Ptv/v1/account/admin/users` once per list scope, keyed by active server, and merges its results by immutable Jellyfin user ID. Verified canonical email may be shown; pending or recovery addresses remain masked. Users does not add a second email store or a separate verification policy.

The module lifecycle still records that the settings enhancement is mounted for diagnostics, but its ownership payload is `piggietv` and the native route supplies the actual UI.

The complete administration route, authority, cache, redirect, secret-handling, and migration-status contract is maintained in `docs/ptv-administration.md`. Arbitrary third-party plugin configuration remains **LEGACY / PLUGIN_OWNED** even when it appears inside the shared PiggieTV administration shell.
