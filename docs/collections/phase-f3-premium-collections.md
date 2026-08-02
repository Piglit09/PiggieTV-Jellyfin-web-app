# Phase F3: Premium Collections and Cross-Library Discovery

## Status

Implementation is complete and remains local. Final approval depends on the automated and authenticated acceptance matrix recorded outside this implementation note.

## Ownership audit

| Concern | Existing authoritative owner | F3 use |
| --- | --- | --- |
| Route parsing, identity, Back/Forward | PTV browse route and Jellyfin app router | Adds Collection views and one query-owned Details identity |
| Jellyfin data and user progress | Jellyfin item API | Normalizes BoxSets and members while preserving raw objects |
| Requests, coalescing, cancellation | PTV request coordinator | Uses `getPtvItems` and `getPtvItem`; no card-level fanout |
| Settings persistence | `currentSettings` | Adds a versioned server/user-scoped Collection document |
| Feedback | Existing recommendation suppression concepts | Collection visibility remains distinct from item suppression |
| Item navigation and actions | PTV item routes and Jellyfin Details/playback | BoxSets converge on Collections; members retain existing routes |
| Focus and Back | Existing shell focus manager and router | Stable focus keys only; no page-local arrow or Back handler |
| Images | Existing PTV image candidate/fallback pipeline | Bounded card/backdrop candidates with lazy card images |
| Diagnostics | Existing PTV observability store | Adds safe aggregate source/readiness/retirement events |
| Plugin | Existing `/Ptv/v1` contracts | No plugin addition; frontend fallback is complete |

## Architecture

F3 is a route-lazy module mounted through the existing native browse route registry. It contains a focused portable Collection model, an explicit relationship resolver, a bounded loader, a versioned preference adapter, and the landing/Details presentation. It is not a universal media DTO and does not own navigation, playback, request coordination, metadata, caching, focus, or authentication.

Critical Jellyfin BoxSets load first. One deferred discovery request then supplies bounded curated and cross-library candidates. Route changes abort the active generation, and generation checks prevent stale commits. Deferred failure never clears the critical result.

## Collection sources

- Jellyfin collections preserve BoxSet identity, order, artwork, permissions, user data, and raw item objects.
- Curated collections use reusable definitions over explicit genres, tags, studios, providers, and reading identity.
- Dynamic presentation derives progress, pinned, recently added, and in-progress sections from existing data.
- Cross-library collections require an explicit franchise, provider-series, reading-series, soundtrack, studio/brand, creator, or shared-tag relationship.

Weak title similarity never establishes membership. Relationship diagnostics expose reason categories and counts, not IDs or titles.

## Product behavior

The Collections landing supports Featured, All, Genres, genre filtering, and a cinematic Details route. Sections render only when usable and can include a hero, Continue This Collection, pinned items, Featured Collections, Jellyfin Collections, movie/TV universes, animation/anime, seasonal groups, cross-library worlds, and recently added groups.

Details provides a cinematic hero, member/progress summary, next unfinished action, explicit source/reason chips, grouped progressively rendered members, and collection, release, configured timeline, title, and recently-added ordering. Timeline ordering appears only when reliable configured timing exists.

## Personalization and suppression

The schema-versioned Collection preference document is scoped by Jellyfin server and user through `currentSettings`. It controls hero visibility, section visibility/order, density, pinned and hidden collections, default ordering, cross-library discovery, and personalized sections. Invalid state retires to safe defaults. Revision checks reject stale writes.

Hiding or showing fewer Collections changes Collection presentation only. It does not suppress member items elsewhere. Undo and reset are available without mutating Jellyfin metadata.

## Integrations

BoxSets opened from PTV item routes, Jellyfin app routing, and Search converge on the premium Details route. Franchise links on primary Details pages open bounded Collections discovery. Search history remains router-owned, so query and filter state restore on Back.

No Home owner was added. Existing Home collection rows can continue using Jellyfin and Row Builder ownership; F3 preferences are reusable for a future additive shelf integration without replacing Home state or cache behavior.

## Responsive, focus, and accessibility

The surface uses semantic landmarks, headings, progress semantics, accessible action names, large touch targets, stable TV focus keys, keyboard-operable native controls, reduced-motion-safe loading, and progressive member rendering. It has responsive desktop, tablet, phone, landscape, and browser-TV layouts without hover dependency or page-local directional-key handling.

## Privacy and diagnostics

Diagnostics record aggregate source type, collection/member counts, relationship-reason counts, primary/deferred readiness, failures, and retirement. They do not retain raw user IDs, item/provider IDs, titles, queries, URLs, paths, request bodies, tokens, or cookies.

## Rollback boundary

The lazy module, its focused model/tests, route additions, and BoxSet integration form the F3 rollback boundary. Removing that boundary returns `/collections` to the existing basic native browse implementation; Jellyfin data and user metadata remain unchanged.
