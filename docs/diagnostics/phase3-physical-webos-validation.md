# Phase 3 physical LG WebOS validation

## Decision

**HOLD**

The owner-deployed Phase 2 frontend passed physical-device preflight and
matched the locally validated bundle exactly. The complete feasible first pass
was performed with the physical LG remote on the dedicated top-level
`com.piggietv.validation` host. Scenarios 1 through 11 were started except
Scenario 4, whose shelf prerequisite had zero candidates. Scenario 12 was
closed as NOT TESTABLE because Season, Episode, full-screen music, and
controlled playback prerequisites were already blocked.

The original Scenario 2 `Application Error -6` and dropdown Back exit remain
classified as Ares SDK iframe-container artifacts, not production PiggieTV
defects. The same dropdown sequence passed on the dedicated top-level host.

The final physical result remains **HOLD**. Scenario 8 failed because video
controls did not retain player focus, two seek attempts did not commit, and one
Back over-navigated directly to Home. Scenario 9 has mixed results: primary
dropdown, profile dropdown, and Settings Back cases passed, while Movie
details, Series details, playback, and a Music context menu restored the wrong
route or focus target. Scenario 10 failed before full-screen entry because the
visible mini-player Player control was present but physically unreachable.
Scenario 11 failed when audio continued on Home with no visible mini-player and
both hardware Pause and Play were ignored.

This is not APPROVE because not all twelve prescribed scenarios were directly
testable, multiple FAIL results remain, and the device entered an orphaned
playback-presentation state. It is not BLOCK because no evidence shows that
diagnostics changed focus behavior, installed a second navigation owner,
leaked private data, or materially worsened input latency.

The orphaned audio could not be stopped through the visible UI or hardware
transport keys. For safe cleanup, only the dedicated validation app was closed
through the WebOS developer interface. It was not uninstalled. The production
app, production server, service worker, plugin, television settings, and
configuration were not changed.

## Device and build identity

- Device: LG 70UN7070PUA
- webOS SDK: 5.6.2
- Firmware: 04.64.00
- Inspectable hosted-app wrapper: 1.1.0
- Viewport: 1920 × 1080 CSS pixels
- Device pixel ratio: 1
- Jellyfin/PTV package version: 10.11.11
- Frontend commit label: `c81c8ed516-dirty`
- Frontend build timestamp: `2026-07-26T04:55:42.456Z`
- PiggieTV plugin version: 10.11.8.2
- Render profile: `PTV_WEBOS_OPTIMIZED`
- Platform/profile: WebOS TV
- Eligibility source: `webos-user-agent`
- Service worker: supported but not controlling the page
- Production/local main bundle: 1,549,084 bytes
- Production/local SHA-256:
  `a16bd3bf65fe4841c490c9b6465303a83170f535fa7d4b6e96009464bbb7cf9c`
- Exact production/local match: yes

The production origin and device network address were verified but are not
retained in the share-safe artifacts. No serial number was collected.

## Physical remote and preflight confirmation

The owner performed the requested scenarios using the physical LG remote.
Scenario 1 retained ten trusted events classified as `webos-remote`. They
reached the authoritative focus handler. No keyboard, mouse, phone touchpad,
synthetic key dispatch, focus API, or remote-control API was used as scenario
input.

Before Scenario 1 the runtime reported:

- WebOS eligibility active before focus initialization;
- focus engine requested and ready;
- initialization count 1;
- disposal count 0;
- listener install count 1;
- duplicate listener count 0;
- diagnostics collection enabled;
- diagnostics overlay disabled and absent;
- all ten PTV Core startup steps ready.

Developer tools were used only for preflight inspection, a single
cache-bypassing reload after the owner deployed the new build, diagnostics
session reset, route setup, passive capture, privacy-safe state checkpoints,
inspector reconnection, on-demand share-safe export, and final closure of the
dedicated validation app after playback controls became unavailable. Those
actions are not counted as physical remote evidence.

## Scenario matrix

| # | Scenario | Result | First proven failure stage |
|---|---|---|---|
| 1 | Home initial focus | DEGRADED | delayed-render |
| 2 | Header navigation | DEGRADED | delayed-render |
| 3 | Shelf horizontal movement | DEGRADED (incomplete) | target-not-found |
| 4 | Vertical shelf movement | NOT TESTABLE | zero-candidates |
| 5 | Details page | DEGRADED | wrong-target-category |
| 6 | Dropdown menu | DEGRADED | duplicate-input |
| 7 | Settings panel | DEGRADED | scope-leak |
| 8 | Playback controls | FAIL | scope-leak |
| 9 | Back navigation and restoration | FAIL | restoration-failed |
| 10 | Full-screen music player | FAIL | scope-leak |
| 11 | Mini-player and music routes | FAIL | scope-leak |
| 12 | Route return / long session | NOT TESTABLE | blocked prerequisites |

## Scenario 1: Home initial focus

The first retained Right input moved from a visible button to a header
navigation item and was confirmed in 48.6 ms. Across the retained scenario
events:

- 10 trusted physical WebOS inputs;
- 10 events reached the focus handler;
- 8 confirmed movements;
- 2 boundary presses with no directional target;
- no diagnostic failure reason;
- no duplicate input;
- one listener installation and no duplicate listener;
- focus remained visible;
- route remained settled;
- zero active requests at input time;
- 13 pending images and 37 pending shelves;
- collector overload remained false.

The result is DEGRADED because a Down press completed in 524.8 ms while a Home
focus-graph refresh took 473.8 ms and the graph grew from 245 to 324
candidates. Frame p95 in the physical-input window peaked at 716.6 ms. The
first directional input completed in 100.2 ms, and the maximum confirmed
movement time was 48.6 ms.

The held sequence produced multiple trusted keydowns, but this WebOS browser
reported `repeat=false` on each. No double movement or repeat storm was
proven. These are diagnostic observations, not a formal performance benchmark.

## Scenario 2: Header navigation

The following first two incidents are retained as original evidence, but their
terminal WebOS result is now classified as a validation-harness artifact.

In the first session, the owner reported:

1. selecting a dropdown did not permit a return to the top navigation;
2. pressing Back navigated to the Jellyfin administrator dashboard;
3. the owner recovered Home;
4. the application then died and left an error visible.

Immediate passive inspection proved that PiggieTV's document had been replaced
by the WebOS system load-error document:

- document title `Application Error`;
- `file:` document protocol;
- WebOS error code `-6`;
- visible message: file or directory cannot be found;
- the hostname parameter was empty;
- Home and dashboard app routes existed only as forward-history entries.

This proves `route-instability`. The history shape is consistent with Back
escaping behind the app document, but it does not prove why. In particular,
duplicate or delayed Back is not assigned because document replacement
destroyed the input pipeline and in-memory diagnostics before export. That
exact Back sequence was not retested.

The preserved error screenshot contains no host, media, account, or device
identifiers. No Retry, Exit App, reload, route navigation, or repair was
performed after the failure.

The owner then independently relaunched the app and reported that header
navigation initially worked better. Selecting Music caused the visible app to
freeze. The original inspector tunnel then contained no page target at all. A
read-only inspector reattachment—without launching or reloading the app—found
only:

- the same WebOS `Application Error` document;
- the same error code `-6`;
- an empty hostname parameter;
- two load-error history entries;
- no surviving PiggieTV route;
- no surviving Phase 2 diagnostic context.

The second error screenshot is byte-identical to the first. The terminal WebOS
failure is therefore observed in two sessions, but the trigger sequence differs.
The first incident involved Back/history; the second involved Music selection.
A shared handler, renderer, wrapper, or network cause is not proven.

The owner's visible frozen Music frame and the inspectable load-error document
may indicate that the television retained the last rendered frame after losing
the app document. This is an inference only.

### Isolation result

Read-only inspection of the installed `com.sdk.ares.hostedapp` package proved
that it is a local iframe wrapper with `disableBackHistoryAPI=false`.
`webOSLaunch` assigns its `hostedurl` launch parameter to the iframe, while
`webOSRelaunch` reloads the iframe's current document. The original session
retained WebOS load-error documents behind the manually navigated production
child page.

With an explicit hosted URL, a controlled Movies dropdown Back trial showed
that PiggieTV closed the menu and retained focus, after which WebOS also handled
the same Back at the Ares-container level and hid/exited the app. This proved
`browser-default-interception` by the invalid test harness; no duplicate
PiggieTV Back action was proven.

The dedicated `com.piggietv.validation` host removed the iframe and stale
history and enabled `disableBackHistoryAPI`. Under that host, the owner repeated
Right to Movies, Enter, Down, Up, and Back exactly once. Post-Back evidence
proved:

- the menu was closed and visible focus was restored to Movies;
- the production Home document stayed top-level and visible;
- focus did not fall to `body`;
- navigation history remained one production-origin Home entry at index zero;
- the app and inspector target remained available;
- no route navigation, frame detach, runtime exception, network loading
  failure, or target crash was captured.

The corrected dropdown Back trial therefore **passed**.

The separate controlled Music trial navigated to Music without document exit.
It was classified `delayed-render`, with secondary `focus-detached`. During the
delay, live documents rose from 13 to 49, frames from 12 to 39, DOM nodes from
about 2,800 to about 7,300, and JavaScript heap from about 18 MB to about
27 MB. The route eventually recovered with visible content and focus. The
existing five-second deferred full library-index load is temporally correlated
but not proven causal.

### Corrected-host Shows continuation

The Shows primary dropdown passed its scope and close behavior. Enter focused
the first of three items, Up wrapped to the last item as the implementation
specifies, and Back closed the menu and restored visible focus to Shows. Focus
did not leak outside the menu.

Selecting the first Shows item then loaded the Shows route exactly once, but
visible focus moved to the PiggieTV brand logo instead of remaining on Shows or
moving to Shows content. The included repeated attempt recorded four expected
physical inputs, four remote-key events, and four default-prevented results.
The route remained visible and stable, with no frame detach, target crash,
runtime exception, or network loading failure.

The route was expensive on the LG:

- 57 long tasks were observed during the included Shows activation window;
- the longest was 1,010.7 ms;
- the two retained route-render durations were 877.3 ms and 439.1 ms.

The owner then pressed Back exactly once. A temporary passive focus-event probe
captured the complete authoritative pipeline and was removed immediately after
the result:

- source `webos-remote`;
- eight ordered Back stages;
- `repeat=false`, repeat count one;
- handler reached;
- current candidate resolved;
- default prevented after handling;
- completed in 22.8 ms;
- restoration started for `back-navigation`;
- Home focus was lost after the route change;
- restoration then reported success for `shell-overlays-updated`;
- the reported scope was main content and `previousFocusRestored=true`;
- DOM, screenshot, and owner observation all proved the actual target was the
  PiggieTV logo, not the Shows trigger.

The first proven Back failure stage is `restoration-failed`, with secondary
`wrong-target-category`. No duplicate Back or repeat storm occurred. Home
rendering also retained 13 long tasks, with a maximum of 1,175.5 ms.

The owner separately observed that Featured Shows contained Anime-library and
Cartoons content, and confirmed the production browser client behaves the same
way. Source correlation proves why: the Shows route supplies no library-scope
hint, scope resolution therefore returns `unscoped`, and the resulting Series
queries retain neither a parent-library nor ancestor-library filter. This is a
cross-client content-scope issue, not a WebOS-specific defect. Product intent
must be decided separately; it was not changed during validation.

### Corrected-host Reading continuation

The owner moved from the Home logo to Reading with four physical Right presses
and activated Reading once. Diagnostics retained five expected remote inputs:
all four directional movements were confirmed and Enter completed in 191.4 ms
with `repeat=false`.

The Reading route opened and retained visible focus on its Refresh control. A
single focus-loss event occurred during route settlement and recovered to a
Reading-page button. The route did not crash, detach, or navigate away.

The content result was nevertheless DEGRADED:

- four shelves rendered explicit timeout and Retry states;
- configured deadlines represented in those states were 2,500 ms and 6,500 ms;
- no Reading row survived after the timeout transition;
- DOM nodes fell from 3,027 to 1,178 across that transition;
- route render durations reached 2,158.2 ms and 1,376.5 ms;
- 22 long tasks were observed, with a maximum of 1,919.8 ms;
- no browser `Network.loadingFailed`, remote network diagnostic, or remote error
  diagnostic was captured.

The implementation runs four full-home shelf tasks with concurrency two and
races each task against its shelf deadline. Timeout errors are converted to
error sections with Retry controls. The first proven failure stage is
`delayed-render`, with secondary `focus-detached`. Heavy main-thread work is
temporally correlated with the deadlines, but the underlying request or
computation boundary that failed to finish is not yet proven.

Reading Back restoration passed for correctness. One physical WebOS Back
traversed eight pipeline stages, reached the focus handler, completed in
31.9 ms with `repeat=false`, returned to Home, and ultimately restored visible
focus to the originating Reading trigger.

It remained performance-degraded. Focus was lost during the Home route change,
and the first successful nav-item restoration followed the input by about
4,652 ms. Home route rendering reached 1,730.9 ms and its longest captured long
task was 1,317.9 ms. This contrast narrows the Shows result: Reading restored
the correct origin despite delay, while Shows restored the wrong target.

### Corrected-host Request continuation

From Home with Reading focused, the owner pressed Right once to Request and
Enter once. Request opened, but no focus outline was visible. DOM and computed
style evidence proved that an underlying link still had the PTV focus-visible
class and a three-pixel outline inside the viewport. The center of that link
was covered by the cross-origin Request iframe, so the outline was not usable
on screen. Focus never entered the Request view or iframe.

The Request view declares no dialog role, modal state, or PTV focus scope and
does not assign initial focus to its Open or Close controls. The Request page
type also has no initial-focus selector in the authoritative focus owner. The
first proven failure stage is `offscreen-or-obscured`, with secondary
`scope-leak`.

The activation attempt expected two remote inputs but retained only the Right
input in the authoritative focus pipeline and remote key collector. The view
opening proves that the physical Enter reached the Request activation path.
That path listens during document capture and calls `stopImmediatePropagation`;
the authoritative focus owner also listens during document capture. This is a
source-supported mechanism capable of excluding the focus owner. The runtime
proves the Enter omission, although exact listener registration order was not
independently instrumented.

The Request window retained one uncaught runtime exception without an available
message, two canceled document loads, 12 long tasks, and a longest long task of
331.7 ms. Neither canceled load was a terminal network failure, and the route
remained visible.

The owner then pressed Back exactly once. The complete authoritative pipeline
proved:

- source `webos-remote`;
- eight ordered stages;
- `repeat=false`, repeat count one;
- handler reached and current candidate resolved;
- default prevented after handling;
- completion in 27.7 ms;
- Request closed and Home returned;
- diagnostics reported successful restoration to a button with
  `previousFocusRestored=true`;
- owner, DOM, and screenshot evidence proved the target was the Home hero Play
  action, not Request.

The Request Back failure is `restoration-failed`, with secondary
`wrong-target-category`. Three long tasks were retained, with a maximum of
297.9 ms; route-render durations were 325.6 ms and 167.9 ms. No duplicate Back
or repeat storm occurred.

### Corrected-host Settings header continuation

From Home with the hero Play action focused, the owner pressed Up once to the
PiggieTV logo, Right exactly eight times to Settings, and Enter once.
The authoritative focus pipeline retained all ten expected physical inputs:
one Up, eight Right, and one Enter. Every input completed exactly once; Enter
completed in 171.6 ms.

The `mypreferencesmenu` route loaded with visible focus on the first Settings
row. The owner reported an old sidebar over the page. Layer identity and
computed-style evidence proved this was not Jellyfin's legacy main drawer:

- no legacy drawer was present or visible;
- the PiggieTV sidebar was present and visible;
- neither the sidebar open class nor the body open-state class was set;
- despite that logically closed state, its computed transform was identity;
- opacity was one and pointer events remained enabled;
- it overlapped the left 337 CSS pixels of Settings;
- the overlap covered 363,960 square CSS pixels of the page and 4,480 square
  CSS pixels of the focused first row.

The base sidebar styling defines a closed translation of
`translateX(-105%)`, but the failing runtime computed identity without the open
class. This proves a `scope-leak`, with secondary `offscreen-or-obscured`.
The exact cascade or lifecycle boundary producing the identity transform is
not yet proven, and no source change was made.

The owner then pressed Back exactly once. An in-page passive probe retained
eight ordered pipeline stages with `repeat=false`, handler reached, current
candidate resolved, default prevented, and 43.8 ms completion. Home returned,
the sidebar was absent, and owner, DOM, and screenshot evidence agreed that
focus was restored to the originating Settings trigger.

The generic Back pipeline left its optional restoration flags unset even
though the final target was correct. That is an observability gap, not a
restoration failure. Settings Back therefore **passed**, while Settings
activation remains DEGRADED because the closed sidebar obscured live content.
Scenario 2 is complete.

## Scenario 3: Shelf horizontal movement

Scenario 3 could not reach its required horizontal movement sequence because
Home rendered no shelves. From the Settings header trigger, the owner's first
Down reached the handler and moved to the hero Details action in 84.6 ms. A
second Down reached the handler and began target search, but was rejected with
`no-directional-target`; no movement was confirmed and the pipeline completed
in 45 ms.

The owner reported that the shelves never loaded. DOM state proved this was not
a visible loading or explicit error state:

- the Home route and hero were present;
- the rows container was present and visible;
- loading UI was absent;
- error UI was absent;
- row groups, row anchors, mounted rows, rendered shelves, cards, focusable
  card targets, and card images were all zero.

One clean physical re-entry attempt reproduced the result. The owner pressed
Up twice to the PiggieTV logo, Enter once, and waited fifteen seconds. All three
inputs completed once with `repeat=false`; the Enter caused one within-document
Home navigation and a 261 ms Home render. The same zero-row terminal state
remained after the wait.

The first proven failure stage is `target-not-found`, with two consistent
observations of the rendered-empty state. Continue Watching, Recently Added,
one recommendation row, and a long scrolling row could not be exercised. The
cause of the empty Home row set is not proven, and no reload, repair, or source
change was performed.

## Scenario 4: Vertical shelf movement

Scenario 4 is **NOT TESTABLE** in the current state. Scenario 3 proved zero
shelf and card candidates, so there is no shelf origin from which to perform
Up/Down movement. Its prerequisite classification is `zero-candidates`.

## Scenario 5: Details page

Scenario 5 completed with one Series and one Movie. Both details routes opened
exactly once and remained visible, but both selected the PiggieTV logo as their
initial focus target instead of a details action or content target. The first
proven failure stage is `wrong-target-category`.

On Series details, owner and pipeline evidence then proved:

- Down from the logo reached the authoritative handler;
- current candidate and target search were reached;
- the target was rejected as `no-directional-target`;
- no movement was confirmed and the input completed in 49.1 ms;
- the visible page contained 67 focusable elements, 10 primary buttons, one
  Play button, three reader actions, and four child items;
- a Movies-dropdown path and a Music-header path also failed to enter details;
- season and episode selection were blocked because focus never reached the
  four visible child items.

Series Back traversed eight stages, reached the handler once, completed in
26.7 ms with `repeat=false`, and was default-prevented. Home returned, but focus
restored to Music instead of the originating hero Details action. Route renders
reached 2,898.3 ms and the longest retained task was 1,502.7 ms. The owner also
observed shelves appear briefly and disappear; final DOM state again contained
zero shelves. The transient interval was not instrumented precisely.

The Movie path opened Movies through its header dropdown, reached the Movies
hero Open action, and activated details exactly once. Movie details reproduced
the same initial-logo and Down-rejection behavior despite 94 visible focusable
elements and five primary buttons. The failing Down completed in 50.7 ms with
`no-directional-target`.

Movie Back also traversed eight stages and completed once in 33.6 ms, returning
to Movies. It restored the PiggieTV logo instead of the originating hero Open
action. Movies route rendering reached 1,589.7 ms, and one retained long task
reached 7,881 ms.

The secondary classifications are `target-not-found` for details-control entry
and `restoration-failed` for both Back paths. The exact focus-graph exclusion
cause is not proven, and no source change was made.

## Scenario 6: Dropdown menu

The owner reached the top-right user trigger from Home using the physical
remote. Enter opened the profile dropdown, activated its scope, and focused its
first item. Main-content focus did not leak behind the menu.

The first movement instruction exposed a new discrepancy. The owner was asked
to press Down exactly once, but the authoritative pipeline retained two
separate trusted Down browser events. Both reported `repeat=false`, each
reached the handler once, and each confirmed movement in 76.6 ms and 83.7 ms.
The application did not duplicate handling of either event; the physical
remote, WebOS, or lower delivery layer that produced two browser events is not
proven. The first proven failure stage is `duplicate-input`.

One Up remained inside the menu. Back then closed the dropdown once, reported
the closed scope state, completed in 34.5 ms, and correctly restored focus to
the user trigger. The core dropdown scope, closure, and restoration behavior
therefore passed.

For safe Enter validation, the owner reopened the menu and activated its first
Profile item exactly once. Source configuration maps that item to
`profilePreferences`, whose runtime route is `mypreferencesmenu`. The owner
described the destination as Settings rather than a distinct profile page.
This destination-label observation is retained without assigning product
intent. The route reproduced the already-proven closed-but-visible PTV sidebar
defect.

Back from that Profile destination completed once in 34.8 ms and returned
Home, but restored hero Play instead of the originating user trigger. That
follow-up is `restoration-failed`; Home route rendering reached 1,833.9 ms and
the longest retained task was 1,280.5 ms.

## Scenario 7: Settings panel

The enhanced Jellyfin `mypreferencesmenu` route is the focus engine's
`settings-panel` scope; no separate native PTV Settings modal exists. From
Home, the owner reached Settings with one Up, eight Right presses, and one
Enter. All ten inputs completed once. The first of nine enabled Settings items
received visible focus.

Eight Down presses then reached every remaining item exactly once. The page
scrolled while moving from item 6 to item 7, reached 44 CSS pixels of nested
scroll, and did not detach focus. The route contained no toggles, so toggle
activation was not applicable.

The previously isolated layer defect reproduced for the full traversal. The
PiggieTV sidebar was logically closed, had no open class, but remained visible
at identity transform, fully opaque, and pointer-enabled. It overlapped
363,960 square CSS pixels of Settings and 4,480 square CSS pixels of the final
focused control. The first proven failure stage is `scope-leak`, with secondary
`offscreen-or-obscured`.

One Back completed in 35.5 ms with `repeat=false`, returned Home, removed the
sidebar, and correctly restored the Settings trigger. Settings Back passed.
The route remains DEGRADED because the closed sidebar obstructed the complete
control traversal.

## Scenario 8: Playback controls

The owner started video playback from Home with Down to Details, Up to Play,
and one Enter. All three activation inputs reached the authoritative focus
pipeline exactly once. Video was playing and the player root was visible.

One Up during playback woke the controls briefly. The owner observed focus on
Back, but the controls auto-hid instead of remaining visible while focused. At
the checkpoint, the focus outline still existed but the active element was
outside the recognized player root and zero controls were visible. The first
proven failure stage is `scope-leak`.

Two separate Right/Enter seek attempts reproduced the same visible result:

- Right advanced the seek presentation and showed the current-scene trickplay
  image;
- the underlying video position did not seek;
- Enter briefly froze playback and then paused it;
- a physical Play press resumed the first attempt, but the repeated attempt
  failed identically;
- after the second attempt, ten controls were visible while focus remained
  outside the recognized player root.

The two retained Right completions were 44.3 ms and 39.3 ms. The playback layer
intercepted the Enter and hardware Play actions before the authoritative focus
pipeline, so the pipeline cannot classify their internal mapping. Physical
behavior proves the failed seek result; `mapping-failed` is the secondary
classification.

One Back was observed once with `repeat=false` and was default-prevented. It
returned directly to Home, discarded the originating details route, and
focused the Home hero primary action. Home route renders reached 4,289 ms and
the longest retained task was 4,620.1 ms. No delayed second Back or route loop
was observed. The Back result is `restoration-failed`.

Scenario 8 is **FAIL**.

## Scenario 9: Back navigation and restoration

The Back matrix consolidates the physical cases already captured in their
originating scenarios:

| Origin | Result | Actual outcome |
|---|---|---|
| Movie details | FAIL | Returned Movies, but restored the brand logo instead of the originating hero action |
| Series details | FAIL | Returned Home and restored Music instead of the originating hero action |
| Season | NOT TESTABLE | Series child controls were visible but unreachable |
| Episode | NOT TESTABLE | Season could not be entered |
| Primary dropdown | PASS | Closed once and restored its header trigger |
| Profile dropdown | PASS | Closed once and restored its user trigger |
| Settings | PASS | Returned Home, removed the sidebar, and restored Settings |
| Playback controls | FAIL | Skipped details, returned Home, and restored the hero primary action |
| Music track menu | FAIL | Returned Home instead of closing the menu |
| Full-screen music | NOT TESTABLE | The mini-player Player control was present but unreachable |

Across the retained Back cases, no duplicate Back, repeat storm, delayed second
Back, or route loop was proven. Correct owner selection and focus restoration
were not consistent. Scenario 9 is **FAIL**, first classified
`restoration-failed`; the Music context-menu case adds `scope-leak`.

## Scenario 10: Full-screen music player

From Home, the owner moved to Music and activated it once. The route loaded
after a severe delay. It first left focus on the Music header item, then
temporarily sampled body focus before eventually focusing the first shelf
track cover. Down reached that track's name.

One Enter started playback after another delay. The mini-player appeared and
Pause received focus, proving that the mini-player itself could initially be
reached. Source and privacy-safe DOM evidence showed seven visible dock
controls: art, track, Previous, primary Pause, Next, Player, and Stop.

From Pause, two separate Right presses should have reached Player through the
declared control order. Instead, focus leaked into the shelf and landed on a
second track. A second path also failed:

1. re-entering Music restored the mini-player but initially left no visible
   focus;
2. focus eventually restored to the second track cover;
3. Up moved to a three-dot track control rather than the dock;
4. another Up activated that track menu instead of moving focus;
5. Back navigated to Home instead of closing the menu.

The visible Player control was therefore not physically reachable, and the
`#/music/player` route never opened. Full-screen-only layer, controls,
next/previous, transition, and Back requirements could not be exercised.
Scenario 10 is **FAIL** at `scope-leak`, with secondary `route-instability`.

Repeated runtime exception records appeared when new inspector collectors
attached, but the collector may have replayed buffered entries. They are not
assigned as a Music-specific cause.

## Scenario 11: Mini-player and music routes

Mini-player reachability passed only at initial track activation: the dock
appeared and Pause received focus. Scope retention failed immediately when
Right moved into shelf content instead of adjacent dock controls.

Activating the second shelf target then navigated to Home while audio continued.
The mini-player was absent and focus returned to Music in the header. Re-entering
Music restored the mini-player, but initial focus was invisible and only later
restored to the shelf. Back from the subsequently opened track menu again
returned Home while audio continued and the mini-player disappeared.

The terminal state was orphaned playback presentation:

- route: Home;
- audio still audible;
- no mini-player or other playback control visible;
- physical Pause had no effect;
- physical Play had no effect;
- neither hardware transport key appeared in the authoritative focus pipeline.

Artists, Albums, Songs, and Playlists were not continued after the orphaned
state because controlled playback and focus ownership had already failed.
Only the dedicated validation app was closed for safe cleanup; it was not
uninstalled. Scenario 11 is **FAIL** at `scope-leak`, with secondary
`route-instability` and `mapping-failed`.

## Scenario 12: Route return and long session

Scenario 12 is **NOT TESTABLE**. The prescribed sequence requires Series to
Season to Episode and Music to full-screen player. Scenario 5 had already
proved Season and Episode unreachable, while Scenario 10 proved the present
Player control unreachable. Scenario 11 then left audio active without a
visible playback owner.

The long sequence was not replaced with a partial substitute because that
would not validate listener-count stability, initialization-count stability,
graph generations, stale candidates, orphaned scopes, duplicate-key trends,
route restoration, retained-event trimming, collector overload, or progressive
frame health under the required route path.

## Performance observations

Scenario 1 has the only complete scenario-level frame sample suitable for the
requested summary:

- input handling median: 67 ms;
- input handling maximum: 524.8 ms;
- first-direction handling: 100.2 ms;
- focus confirmation maximum: 48.6 ms;
- graph build maximum in the input window: 473.8 ms;
- frame p95 maximum in the input window: 716.6 ms;
- longest frame in the input window: 716.6 ms;
- focus-to-visible maximum: 0 ms;
- collector overhead maximum: 3.7 ms;
- duplicate input count: 0;
- duplicate listener count: 0.

Scenario 2 does not have a final on-demand Phase 2 store export. Corrected-host
isolation nevertheless retained bounded passive and remote-diagnostic
performance observations for Music, Shows, Reading, Request, and the Settings
header route. Scenario 5 retained route renders up to 2,898.3 ms and a long
task up to 7,881 ms. Scenario 7 Settings Back retained route renders up to
1,743.3 ms and a long task up to 1,902.6 ms.

Scenario 8 retained focus-pipeline completions from 39.3 ms to 237 ms. Its
Back-to-Home route renders reached 4,289 ms and the longest retained task was
4,620.1 ms. Music entry and focus settlement were visibly and passively delayed,
but the page did not provide a complete per-input performance export for
Scenarios 10 and 11. A privacy-safe checkpoint took roughly 30 seconds to
return while the Music route was active. This is a diagnostic observation, not
a formal benchmark or a proven root cause.

Frame p95, longest frame, janky percentage, graph-build duration,
focus-to-visible duration, active requests, pending images, pending shelves,
and scroll duration are therefore not claimed for every scenario. Missing
fields remain evidence limits, not zero values.

## Artifacts and privacy

Share-safe:

- `device-build-identity.json`
- `scenario-matrix.json`
- `artifact-inventory.json`
- `scenario-01-home-live.json`
- `scenario-01-home-summary.json`
- `scenario-01-home-diagnostics.json`
- `scenario-02-header-crash-live.json`
- `scenario-02-header-crash.png`
- `scenario-02-music-freeze-reattach.json`
- `scenario-02-music-freeze-reattach.png`
- `scenario-02-isolation-music-trial.json`
- `scenario-02-isolation-dropdown-back-trial.json`
- `scenario-02-dedicated-host-back-trial.json`
- `scenario-02-dedicated-host-back-events.ndjson`
- `scenario-02-dedicated-host-shows-dropdown-back-trial.json`
- `scenario-02-dedicated-host-shows-route-back-trial.json`
- `scenario-02-dedicated-host-reading-timeout-trial.json`
- `scenario-02-dedicated-host-request-focus-back-trial.json`
- `scenario-02-dedicated-host-request-back-events.ndjson`
- `scenario-02-dedicated-host-request-back-live.json`
- `scenario-02-dedicated-host-settings-route-back-trial.json`
- `scenario-02-dedicated-host-settings-activation-live.json`
- `scenario-02-dedicated-host-settings-layer-final.json`
- `scenario-02-dedicated-host-settings-back-events.ndjson`
- `scenario-02-dedicated-host-settings-back-live.json`
- `scenario-02-dedicated-host-header-continuation-events.ndjson`
- `scenario-03-home-shelves-unavailable-trial.json`
- `scenario-03-shelf-horizontal-events.ndjson`
- `scenario-03-home-shelves-missing-live.json`
- `scenario-03-home-shelves-dom-state.json`
- `scenario-03-home-reentry-events.ndjson`
- `scenario-03-home-reentry-live.json`
- `scenario-05-details-page-trial.json`
- `scenario-05-series-details-events.ndjson`
- `scenario-05-series-details-initial-live.json`
- `scenario-05-series-details-controls-events.ndjson`
- `scenario-05-series-details-down-failure-live.json`
- `scenario-05-series-details-alternate-entry-events.ndjson`
- `scenario-05-series-details-alternate-entry-live.json`
- `scenario-05-series-details-back-events.ndjson`
- `scenario-05-series-details-back-live.json`
- `scenario-05-movie-details-events.ndjson`
- `scenario-05-movie-details-down-failure-live.json`
- `scenario-05-movie-details-back-events.ndjson`
- `scenario-05-movie-details-back-live.json`
- `scenario-06-profile-dropdown-trial.json`
- `scenario-06-profile-dropdown-clean-events.ndjson`
- `scenario-06-profile-dropdown-activation-live.json`
- `scenario-06-profile-route-back-events.ndjson`
- `scenario-06-profile-route-back-live.json`
- `scenario-07-settings-panel-trial.json`
- `scenario-07-settings-panel-events.ndjson`
- `scenario-07-settings-panel-bottom-live.json`
- `scenario-07-settings-panel-scroll-state.json`
- `scenario-07-settings-panel-back-events.ndjson`
- `scenario-07-settings-panel-back-live.json`
- `scenario-08-playback-controls-trial.json`
- `scenario-08-playback-controls-events.ndjson`
- `scenario-08-playback-start-wake-live.json`
- `scenario-08-playback-seek-events.ndjson`
- `scenario-08-playback-seek-live.json`
- `scenario-08-playback-back-events.ndjson`
- `scenario-08-playback-back-live.json`
- `scenario-09-back-restoration-trial.json`
- `scenario-10-fullscreen-music-trial.json`
- `scenario-10-fullscreen-music-events.ndjson`
- `scenario-10-music-navigation-events.ndjson`
- `scenario-10-track-activation-events.ndjson`
- `scenario-10-player-open-path-events.ndjson`
- `scenario-10-music-restored-focus-quick4.json`
- `scenario-11-mini-player-music-routes-trial.json`
- `scenario-12-long-session-trial.json`

Local-private:

- `scenario-01-home-after.png` — contains visible media titles and must not be
  shared.
- `scenario-02-isolation-baseline.png` — contains visible media titles.
- `scenario-02-isolation-music-result.png` — contains visible media titles.
- `scenario-02-dedicated-host-baseline.png` — contains visible media titles.
- `scenario-02-dedicated-host-back-result.png` — contains visible media titles.
- `scenario-02-dedicated-host-shows-up-wrap.png` — contains visible media
  titles.
- `scenario-02-dedicated-host-shows-back-result.png` — contains visible media
  titles.
- `scenario-02-dedicated-host-shows-route-diagnostics-result.png` — contains
  visible media titles.
- `scenario-02-dedicated-host-shows-back-diagnostics-result.png` — contains
  visible media titles.
- `scenario-02-dedicated-host-reading-timeout-result.png` — contains Reading
  timeout and Retry UI; retain as local-private pending privacy review.
- `scenario-02-dedicated-host-reading-back-result.png` — contains visible media
  titles.

- `scenario-02-dedicated-host-request-focus-missing-result.png` - contains an
  external login UI and remains local-private.
- `scenario-02-dedicated-host-request-back-result.png` - contains visible media
  titles.
- `scenario-02-dedicated-host-settings-activation-result.png` - contains
  private library names.
- `scenario-02-dedicated-host-settings-back-result.png` - contains visible
  media titles.
- `scenario-03-home-shelves-missing-result.png` - contains visible media
  titles.
- `scenario-03-home-reentry-result.png` - contains visible media titles.
- `scenario-05-series-details-initial-result.png` - contains private media
  metadata.
- `scenario-05-series-details-down-failure-result.png` - contains private
  media metadata.
- `scenario-05-series-details-alternate-entry-result.png` - contains private
  media metadata.
- `scenario-05-series-details-back-result.png` - contains visible media titles.
- `scenario-05-movie-details-down-failure-result.png` - contains private media
  metadata.
- `scenario-05-movie-details-back-result.png` - contains private media
  metadata.
- `scenario-06-profile-dropdown-activation-result.png` - contains private
  library names.
- `scenario-06-profile-route-back-result.png` - contains visible media titles.
- `scenario-07-settings-panel-bottom-result.png` - contains private library
  names.
- `scenario-07-settings-panel-back-result.png` - contains visible media titles.
- `scenario-08-playback-start-wake-result.png` - contains private media
  imagery.
- `scenario-08-playback-seek-result.png` - contains private media imagery.
- `scenario-10-music-restored-focus-result3.png` - contains private media
  metadata.

The JSON privacy sentinel scan found no private hosts, complete URLs,
credentials, media titles, tokens, or API keys. The Phase 2 export reports no
secret, URL, path, or identifier redactions and one bounded truncation.

## Proven production defects

The WebOS `Application Error -6` and dropdown Back exit are not production
PiggieTV defects. They were produced by the Ares SDK iframe development
container. The same dropdown Back sequence passed in the dedicated top-level
validation host.

One production degradation remains proven: Music navigation can enter a severe
delayed-render interval with temporary focus detachment and substantial live
document/frame/DOM/heap growth before recovering. The exact responsible
boundary is not yet proven. Scenario 1 render and graph delays remain separate
degraded performance observations.

A second focus defect is proven: Shows activation selects the brand logo rather
than Shows/content, and Back reports restoration success while again selecting
the logo instead of the originating Shows trigger. The Back input itself is
received, normalized, handled, and prevented exactly once; the first proven
failure stage is `restoration-failed`.

The unscoped Shows query also explains the owner's cross-client mixed-library
content observation. The implementation cause is proven, but whether Shows
should exclude the separately exposed Anime and Cartoons libraries remains a
product-requirement decision.

Reading also has a proven application-level degradation: four shelves can time
out and render Retry states on the physical LG while route rendering and
main-thread work substantially exceed the Phase 3 performance thresholds. No
browser network failure was captured, so the slow request/computation boundary
remains unresolved.

Request has two proven focus defects. Opening the view leaves focus outside its
visual layer and obscured behind the cross-origin iframe. Its capture listener
also prevents the activation Enter from reaching the authoritative focus
pipeline. Back closes Request once, but restoration reports success while
selecting the Home hero action instead of the originating Request trigger.

The Settings header route has a separate proven layer defect. The PiggieTV
sidebar is logically closed but remains at identity transform, fully opaque,
and pointer-enabled over Settings, partially covering the focused first row.
This is not Jellyfin's legacy drawer. Back correctly removes the layer and
restores Settings; the exact CSS cascade or lifecycle cause remains unresolved.

Home has a separately proven rendered-empty degradation. The hero and rows
container remain present with loading and error UI absent, but the runtime has
zero row groups, shelves, cards, or focusable card targets. One physical Home
re-entry reproduced the same state. The target-not-found boundary is proven;
the data or configuration boundary producing the empty row set is not.

Movie and Series details share a reproduced focus defect. Each route selects
the brand logo, then rejects Down with `no-directional-target` even though the
details page contains many visible focusable controls. Both Back paths also
restore the wrong target. The route-focus, target-search, and restoration
boundaries are proven; the graph-construction cause is not.

The profile-dropdown check also proved a physical-press/input-count mismatch:
one instructed Down produced two trusted WebOS browser events, both
`repeat=false` and both movement-confirmed. The application handled each event
once, so the layer that duplicated delivery is unresolved. The dropdown itself
closed and restored correctly; Back from its Profile destination did not.

Video playback has three additional proven physical defects. Controls wake but
do not retain their player scope or visibility; two seek attempts show
trickplay without committing a new position and Enter pauses instead; and one
Back skips the originating details route and returns directly to Home. The
playback layer intercepts some inputs before the focus pipeline, so internal
mapping ownership remains only partially observable.

Music playback has a proven focus-scope and presentation-ownership failure.
The mini-player initially appears and focuses Pause, but directional input
leaks to shelf content even though adjacent dock controls, including Player,
are present. The full-screen route is therefore unreachable by the tested
physical paths. Track/context-menu interactions can also navigate to Home while
audio continues and the mini-player disappears. In that orphaned state,
hardware Pause and Play have no effect.

The consolidated Back matrix proves that Back normalization itself is not
duplicated, but owner selection and restoration are inconsistent across
details, playback, and Music menu scopes. Dropdown and Settings closures pass;
the failing cases restore the wrong target or skip the expected intermediate
route.

## Ownership and change confirmation

Diagnostics remained passive during the available evidence window. The
overlay stayed disabled. Listener count remained one, duplicate listener count
remained zero, collector overload remained false, and no second focus owner
appeared.

The production diagnostics check-in disabled an ad-hoc validation lease after
about eleven seconds. For the included repeat, only that client-side diagnostic
transport was detached and a bounded local passive lease was applied. A
read-only focus-event probe was installed for each included one-attempt capture
and removed immediately afterward. Neither action owned, stopped, or
synthesized input or focus.

A privacy-safe quick-state mode was added only to the local Phase 3 capture
helper after the full Music capture became too expensive. It read route, focus
geometry, player-layer presence, and whitelisted dock-control semantics without
removing the active probe. It did not execute app navigation or input.

No focus movement, key mapping, remote ownership, route ownership, playback
implementation, scrolling implementation, product frontend source, server,
plugin, service worker, television setting, or production configuration was
changed during this pass. Runtime playback was exercised only through the
physical remote. The dedicated validation app was closed after its visible and
hardware controls could not stop orphaned audio; it was not uninstalled, and
the production app was not closed.

## Exactly one next phase

Begin **Phase 3A: Playback Input and Presentation Ownership Correction**.
Limit it to video/Music playback scopes, mini-player/full-screen-player
reachability, one-owner Back behavior, visible playback presentation while
audio is active, and LG transport/seek mapping. Add focused automated coverage,
then physically rerun Scenarios 8, 10, 11, and only the playback-related cases
of Scenario 9 on the dedicated top-level host. Do not combine the Home,
Details, Reading, Request, Settings-layer, Shows-scope, or duplicate-input
findings into that correction.
