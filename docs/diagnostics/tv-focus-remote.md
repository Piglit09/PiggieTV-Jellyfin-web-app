# TV focus and remote diagnostics

Phase 2 observes the existing `PtvTvFocusManager`. It does not register another
keydown owner, call `focus()`, prevent browser defaults, normalize keys for the
application, select targets, repair focus, change routes, or suppress repeats.
The manager remains the only TV navigation owner.

## Ownership audit

The manager owns the capture-phase keydown listener, route-owner gate, safe
direction/select/Back recognition, cached candidate graph, directional search,
focus application, scrolling, modal/menu scope, playback Back behavior, route
memory, and restoration. Diagnostics are emitted from those already-executing
branches as non-cancelable `ptv:focus-diagnostic` events.

The diagnostic collector owns only bounded recording and correlation. Its
scroll listener is passive and never calls `preventDefault`, changes scrolling,
or moves focus.

## Input pipeline

Each safe local input ID may produce:

1. browser-event-received;
2. event-classified;
3. key-normalized;
4. platform-mapping-applied;
5. action-resolved;
6. focus-handler-reached or handler-rejected;
7. current-candidate-resolved;
8. target-search-started;
9. target-found or target-rejected;
10. focus-movement-requested;
11. focus-event-observed;
12. movement-confirmed or movement-timed-out;
13. completed.

The exported action is restricted to Up, Down, Left, Right, Enter, Back,
Play/Pause, Menu, color key, or Unknown. Raw key/code values and raw user-agent
strings are never stored.

## Focus graph and scope

Graph snapshots retain category counts, visible/enabled/off-screen counts,
generation, build duration, safe rebuild reason, active scope, current candidate
membership, relative region, nearest category in each direction, and rejection
counts. Nearest candidates also carry one-way fingerprints derived only from
structural category and roles. They do not contain node text, keys, IDs,
selectors, media identifiers, or coordinates.

Scopes are classified as main content, navigation, dropdown menu, context menu,
modal dialog, settings panel, player controls, full-screen music player, or
unknown. Open/active/close/orphan states, trap state, candidate count, leakage,
and restoration success are bounded observations.

## Visibility, scroll, and route correlation

Focus changes record safe category/fingerprint, scope, candidate membership, and
viewport visibility before the existing focus owner scrolls. Passive scroll
start/settle observations report container category, focus-to-visible duration,
focus changes during scrolling, detachment, virtualized replacement, and broad
obscuring class. No exact geometry is exported.

Routes correlate first graph, initial focus, first directional movement, focus
loss count, Back restoration status, and restoration duration.

Input delay classification is correlation rather than causal proof. It uses
handler duration, frame p95, active requests, pending images/shelves, and route
settled state to label target search, browser focus application, input handling,
render/frame delay, route instability, or unknown.

## Retention

- remote pipeline stages: 300;
- focus changes: 200;
- graph rebuilds: 50;
- scope events: 100;
- visibility/scroll events: 100.

Normal retention trimming is reported separately from collector overload.

## Validation evidence

Automated browser profiles establish TV eligibility before manager
initialization for Android TV, Fire TV, and WebOS user agents. Tests cover
successful movement, no target, modal isolation, Back restoration, duplicate
repeat diagnosis, off-screen focus, graph rebuild, route cleanup, listener
idempotency, and overlay non-focusability.

No physical LG device or native WebOS API automation was available during this
phase. Therefore WebOS evidence is browser-profile coverage of the production
Web focus owner, not native device-API coverage. No manual physical-device claim
is made.

No production focus defect was proven by the deterministic matrix. The existing
owner's 55 ms repeat suppression remains unchanged and is now explicitly
diagnosable as existing-owner behavior.
