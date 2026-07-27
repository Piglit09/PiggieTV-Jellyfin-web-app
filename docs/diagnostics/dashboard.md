# PiggieTV Diagnostics dashboard

## Access

The protected administrator route is:

`#/dashboard/piggietv/diagnostics`

It uses the existing Jellyfin dashboard route type and shell. Links appear in
the server dashboard drawer and in the administrator section of user settings.
No new authentication or authorization mechanism was added.

## Sections

The dashboard provides:

- **Overview**: overall, platform, Core, server, plugin, requests, frames, focus,
  route, cache, and recommendation cards;
- **Performance**: frame aggregates, long tasks, route usability, and request
  percentiles;
- **Requests**: the newest 50 entries from the bounded 200-event history;
- **Navigation & Focus**: profile eligibility, engine state, candidates, current
  safe category, latest movement, and a 20-entry input timeline;
- **Routes**: the bounded route lifecycle table;
- **Images & Shelves**: aggregate success/failure and bounded recent events;
- **Core & Capabilities**: versions, initialization, adapters, and support
  matrix;
- **Plugin & Server**: safe connectivity and compatibility summaries;
- **Cache & Recommendations**: passive existing summaries;
- **Export**: guarantees, Copy, Download, and Reset.

Expandable technical details are deliberately small key/value lists. The page
does not render a full JSON wall.

## Session controls

Collection can be disabled without disabling the application systems being
observed. Reset clears bounded histories, counters, warnings, and the diagnostic
session ID while retaining current platform/build context.

Copy and Download construct and sanitize the export on demand. Neither action
uploads data.

## Developer overlay

The compact overlay is disabled by default. When enabled it displays FPS, frame
p95, active requests, request p95, route, focus category, and engine state.

It:

- updates at most once per second;
- has `pointer-events: none`;
- is `aria-hidden`;
- contains no controls or focusable elements;
- sits in the persistent runtime root away from the main interaction flow;
- does not subscribe to or rerender on every store event.

## Dashboard overhead

Histories are bounded and event tables render at most 50 rows per class. Frame
data is pre-aggregated. Snapshot serialization does not run during normal
navigation; JSON is generated only for export. The store estimates its memory
footprint and the page reports its most recent render duration.

The dashboard unsubscribes on unmount. Closing it leaves only the lightweight
platform collectors installed through Core initialization.

## Test coverage

Focused tests cover route registration, overview rendering, store subscription
cleanup, reset, disabled overlay behavior, absence of overlay focus targets,
normalization, retention, route timing, frame percentiles, privacy, deterministic
export, unsupported collectors, and Core initialization lifecycle.

## Phase 2 Navigation & Focus

The section now contains TV eligibility, engine lifecycle, current focus,
latest remote input, passive remote tester, category-level graph inspector,
scope/visibility state, and a received-to-confirmed input timeline. It displays
correlation as correlation and never provides a control that sends a key or
moves focus.

The overlay adds TV profile, candidate count, last safe action, movement result,
and handling duration while retaining its one-second refresh, disabled default,
`aria-hidden`, pointer-disabled, non-focusable design.
