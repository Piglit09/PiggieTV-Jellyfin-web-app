# TV Navigation Audit

Audited 2026-07-19. This is the implementation record for PiggieTV remote-only navigation. It covers PiggieTV pages plus the Jellyfin Web input systems that can run while the PTV shell is active.

## Outcome

`src/ptv/core/tvFocus.ts` is the single owner of PTV spatial navigation, focus memory, initial focus, focus-layer trapping, playback return, and navigation diagnostics. PTV features may add semantic markup and stable `data-ptv-focus-key` values, but must not introduce another global D-pad implementation.

The audit fixed these system-level faults:

- PTV listened for `routecontrollerchange`, while the route controller actually emits `ptv:routecontrollerchange`.
- Route restoration ran for only one animation frame, before many async pages had focus targets.
- Every arrow press queried and measured the entire DOM.
- Offscreen rail items were excluded, creating horizontal dead ends.
- Dialogs, shell panels, dropdowns, and playback each had incomplete or competing focus-return behavior.
- Android D-pad key codes and Android Back were absent.
- Checkbox and radio inputs were treated as text editors, so OK did not activate them.
- Dynamic rows did not notify the focus engine when their controls became available.

## Focus Contract

The manager maintains one cached navigation graph for the active page or topmost modal layer. It invalidates that graph on route/layer/content mutations and refreshes geometry on scroll/resize. Arrow-key handling reads the cache; it does not run a focusable-selector query per key press.

Each route remembers a stable focus key. Explicit `data-ptv-focus-key` values are preferred; item IDs, hrefs, labels, and finally structural identity provide fallbacks. Route changes, loading completion, layer close, and playback exit all resolve through the same restoration pipeline. If a page has no usable target during loading, a focus sentinel temporarily owns focus so `document.activeElement` is never left at `body`.

Initial focus policy:

| Page | Initial target |
| --- | --- |
| Home | Hero Play/primary action, then the first poster |
| Movie/series details | Play or Replay |
| Music | First row/card |
| Reading, Books, Comics, Manga | First row/card |
| Settings | First enabled control |
| Search | Search input |
| Login | First enabled control |
| Playback | First visible playback control |

Page implementations should call `notifyPtvTvFocusContentReady()` after async controls/rows mount. The manager's mutation observer is a safety net, not a replacement for the explicit ready signal.

## Key And Platform Matrix

| Semantic action | Browser/Desktop | Android/Fire TV | LG webOS | Samsung Tizen |
| --- | --- | --- | --- | --- |
| Up/Down/Left/Right | Arrow keys, 37-40 | D-pad key codes 19-22 and arrows | Arrow key names/codes | Arrow key names/codes |
| OK | Enter, Space | 23, 66, Enter | Enter/OK/Accept | Enter/OK/Accept |
| Back | Escape, BrowserBack | 4 | 461 | 10009 |

Aliases are normalized before navigation. The PTV handler runs in the `document` capture phase; when it owns an action it prevents default so component fallbacks and Jellyfin's later `window` keyboard-navigation handler cannot move focus a second time. Text inputs retain cursor editing, native select/range/date controls retain native interaction, and Reader page-turning keys remain owned by the Reader.

Physical remote verification is still required on release hardware. Automated coverage validates every listed event signature and shared behavior, but cannot certify firmware-specific event delivery.

## Directional Navigation

Candidates are semantic, visible, enabled controls within the active scope. Ancestor `hidden`, `inert`, `aria-hidden`, `display:none`, `visibility:hidden`, transparent, and disabled states exclude a target. Explicit negative tabindex remains excluded.

The four directional edges are computed from element geometry. Candidate scoring prioritizes the intended direction, overlapping rows/columns, and then distance. Horizontal shelves can reach off-viewport cards; focusing the selected card scrolls it into view. Tab and Shift+Tab wrap inside modal layers. The diagnostics graph records every node and its four resolved edges, and reports isolated or broken paths.

## Layers, Dropdowns, And Playback

Dialogs, menus, action sheets, shell panels, Reading overflow menus, music popovers, playback overlays, and the performance overlay use a shared layer stack.

- Opening a layer records its opener and focuses the first appropriate control.
- D-pad and Tab stay inside the topmost layer.
- OK activates native controls.
- Back closes the topmost closable layer; Left also closes menus and native `details` popovers.
- Closing restores the opener, or the last stable route target if the opener disappeared.
- Starting playback records the exact focused poster/control. Stopping or error cleanup restores that exact target.

`PtvShellPrimaryDropdown` retains component-level open/select semantics, but delegates imperative focus to the central manager. The older overlay and playlist/performance focus traps were removed so they cannot compete.

## Source Inventory

The repository-wide production scan found 29 files with `keydown`/`onKeyDown`, 27 files with `.focus()`, 5 files with `.blur()`, and 57 files containing `tabindex`/`tabIndex`. Tests are excluded from these counts.

PTV key handlers after consolidation:

| File | Remaining responsibility |
| --- | --- |
| `core/tvFocus.ts` | Global D-pad, OK, Back, route/layer restoration, graph cache |
| `shell/PtvShellPrimaryDropdown.tsx` | Dropdown open/select semantics; central focus API performs movement |
| `shell/PTVShell.tsx` | Search shortcut/form and transient-panel toggles |
| `modules/reader/ReaderApp.tsx` | Reader page turning |
| `modules/playback/index.js` | Playback resume/presence lifecycle; focus restoration is delegated |
| `pages/home/homesections.js` | Virtualization scheduling only |
| `modules/header/index.js`, `modules/request/index.js`, `modules/signup/index.js` | Legacy feature activation only |
| `services/remoteDiagnostics.ts` | Records sanitized key evidence; does not move focus |

The other audited key handlers are Jellyfin primitives or media viewers: notifications and responsive drawer; subtitle sync and lyrics; playback queue/video; checkbox/radio/select/slider/toggle elements; book/comics/PDF/Chromecast players; alphanumeric shortcuts; gamepad-to-key; keyboard navigation; and screensaver management. They remain necessary for fallback Jellyfin pages. PTV prevents their duplicate spatial movement only when a PTV scope is active.

All PTV production `.focus()` calls now live in `core/tvFocus.ts`. The remaining 26 focus-call files belong to Jellyfin dialog/view/focus primitives, authentication, media viewers, and clipboard/mouse helpers. They are not invoked as a second PTV spatial engine.

The five blur-call files are `components/dialogHelper/dialogHelper.js`, `components/playback/skipsegment.ts`, `components/subtitlesync/subtitlesync.js`, `controllers/playback/video/index.js`, and `ptv/shell/PTVShell.tsx`. The PTV call intentionally exits text-entry mode when the search surface closes; it immediately restores through the central focus pipeline.

Tabindex usage falls into four audited groups:

- Jellyfin templates and form/dialog components use `0` for native participation and `-1` for programmatic/roving ownership.
- Jellyfin media viewers use `-1` on canvas/player surfaces that accept their own controls.
- Legacy header/tab components use roving tabindex and remain compatible with the manager's active-scope filtering.
- PTV home, browse, header, playback, tabs, and dropdowns provide semantic targets; the manager's sentinel is `-1` and is never added to the navigation graph.

No production PTV feature outside the manager may add global directional focus movement. New controls must be native semantic elements where possible; otherwise use a correct ARIA role, enabled state, and `data-ptv-focusable`, plus a stable focus key for route/playback restoration.

## Diagnostics

`#/tv-navigation-debug` is available from Settings and updates live. It displays:

- current focused element and active scope;
- focus history and last route/key;
- focusable and missing-semantic-element counts;
- the cached four-direction navigation graph;
- broken/isolated navigation paths.

History is bounded. Element descriptions avoid text dumps and expose only compact tag/role/id/label/key evidence.

## Release Verification

Automated gates:

1. Unit coverage for desktop, Android/Fire TV, webOS, and Tizen key aliases.
2. Initial route focus, async loading restoration, dialog trap/return, dropdown behavior, native inputs, exact playback return, graph diagnostics, and no-query-per-arrow regressions.
3. Route registration and production compilation.
4. Scoped ESLint/Stylelint and `git diff --check`.

Hardware acceptance matrix:

1. Cold start and sign-in using only the remote.
2. Visit Home, Movies, series details, Music, Reading, Search, Settings, and TV Navigation Debug.
3. Traverse every rail in both directions, including initially offscreen items.
4. Open and close every dropdown, filter, context menu, and dialog using OK/Back/Left.
5. Start playback from a poster, stop it, and verify exact-poster return.
6. Trigger slow/empty/error loading and confirm focus stays visible and recovers when content appears.
7. Repeat on desktop keyboard, Fire TV, Android TV, LG webOS, and a Tizen emulator/device when supported.
