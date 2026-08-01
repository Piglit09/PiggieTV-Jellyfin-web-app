# Phase 3A.2 WebOS playback surface composition

Date: 2026-07-27

Targeted correction decision: **PASS**

Broader Phase 3A.1 acceptance decision: **HOLD**

The playback-surface, full-screen Music, related-autoplay, and Music-header
defects found during Phase 3A.1 are corrected in the removable LG validation
application. The operator physically confirmed that the corrected Music header
matches the desktop reference. Production was not changed.

The broader HOLD remains because this correction pass does not substitute for
the still-unrun exact-build video matrix and prescribed long route cycle.

## Scope and ownership

No playback, input, focus, route, or navigation owner was added.

- Jellyfin remains authoritative for browser/video playback.
- The existing PiggieTV Music queue and its one native audio element remain
  authoritative for Music.
- The existing TV focus manager remains the one PTV focus and Back owner.
- The existing shell remains the one navigation owner.
- The runtime overlay change only corrects presentation stacking.
- Diagnostics remained passive and never injected remote input.

Reading and Request remain excluded from WebOS. The final validation process
contained no controls or loaded chunks for either feature.

## Corrected defects

### Persistent mini-player composition

The persistent runtime host previously lived below the positioned Music shell
in the LG renderer's stacking plane. The runtime overlay occlusion adapter now
places the persistent host in the intended application overlay plane and
lowers it only while a true blocking overlay owns the screen.

The existing dock and playback state remain unchanged. Corrected physical
testing retained one mini-player, one runtime, and one audio owner.

### Full-screen Music viewport and queue

The mounted player uses `.ptv-music-fullscreen-player`, while the older rule
targeted a different class. The actual mounted surface now has literal WebOS
viewport bounds and does not depend on Chrome-68-unsupported `inset`,
`aspect-ratio`, `min()`, or `clamp()` geometry.

At 1920 x 1080 the corrected player has:

- a fixed 1920 x 1080 root with internal overflow containment;
- 18 px player typography under the 21 px TV root;
- square artwork bounded to 400 px;
- a literal 420 px progress and volume width;
- a 520 px queue panel;
- 76 px horizontal queue rows with internal scrolling;
- fixed shell navigation rows at 36 px and 124 px.

The operator physically observed the compact player and queue, and physical
Back returned to Music while audio continued.

### Related autoplay and virtual queues

A natural track end could receive a non-track related item and then fail to
load it as audio. The compatibility boundary now admits playable track items
only. The recommendation and virtual-queue paths share that guard.

Physical testing proved:

- initial Music playback started once;
- physical Next changed to a playable track and continued;
- natural completion advanced to a playable Audio item;
- full-screen Back retained playback and restored the mini-player.

No recommendation engine or playback engine was rewritten.

### Music header parity and icon centering

LG Chrome 68 dropped the regular Music page's `clamp()` and `min()` declarations.
That placed the context links at the upper-left and left the hidden Refresh
under Search. Literal WebOS fallbacks now reserve the header band, bound the
main content width, and position the Music links beneath the utility row.

The browser also mis-centers fixed-size children when a native button uses CSS
Grid. WebOS utility and full-screen transport buttons now use a scoped Flex
centering fallback. SVG assets, button dimensions, focus rings, and semantics
are unchanged.

Final physical LG measurements on the regular Music page:

| Surface | Result |
| --- | --- |
| Header | 80 px high at y=36 |
| Music context row | y=124, right-aligned to Search |
| Inter-link spacing | 8 px for all five gaps |
| Refresh | y=227; no Search intersection |
| Notifications icon | exact horizontal and vertical center |
| Dashboard icon | exact horizontal and vertical center |
| Settings icon | exact horizontal and vertical center |
| User icon | exact horizontal and vertical center |
| Search icon | exact horizontal and vertical center |

The operator confirmed that the physical TV now matches the supplied desktop
reference.

## Runtime and compatibility proof

The final regular-Music checkpoint retained:

- application creation count: 1;
- runtime creation count: 1;
- listener registrations: 5;
- duplicate listener suppressions: 0;
- duplicate feature registrations: 0;
- one main bundle and one runtime bundle;
- no development-server client;
- no service-worker controller;
- no diagnostics overlay.

The final validation build identity is recorded in the share-safe evidence
inventory. It was served only by the local static validation origin and
relaunched only as `com.piggietv.validation`.

## Automated validation

| Gate | Result |
| --- | --- |
| Focused WebOS layout/platform tests | 24/24 |
| Complete PTV unit suite | 117 files, 720 tests |
| Complete repository unit suite | 140 files, 926 tests |
| WebOS Music Playwright layout checks | 2/2 |
| Combined diagnostics and WebOS layout checks | 12/12 |
| TypeScript | PASS |
| Scoped Stylelint | 0 errors, 0 warnings |
| PTV ESLint ledger | PASS; 302 errors and 31 warnings remain accepted legacy debt |
| Production Webpack build | PASS; two established size warnings |
| Core schema validation | 11 schemas/fixtures |
| Android contract parity | 26 models, 14 enums, 19 capabilities, 1 error code |
| Secret scan | 118,292 repository paths |
| `git diff --check` | PASS |

The lint result is a no-increase baseline pass, not a claim that the repository
is lint-clean.

## Privacy and evidence

The retained Phase 3A.2 evidence is share-safe. It contains no media titles,
item IDs, user/device/session IDs, raw routes or URLs, private network
locations, key codes, credentials, tokens, cookies, or local filesystem paths.
The operator's reference photographs were used for local visual comparison
only and are not copied into the share-safe evidence set.

Machine-readable evidence is under
`test-results/webos-phase3a2-2026-07-27/`.

## Remaining acceptance work

The targeted Phase 3A.2 composition correction is complete. The exact current
build still needs the unfinished Phase 3A.1 video V1-V4 matrix and long route
cycle before the broader HOLD can become APPROVE. Those checks must use the
literal physical LG remote; browser or developer-channel key injection cannot
substitute for them.

## Production confirmation

Phase 3A.2 did not deploy to or modify production. It did not change Jellyfin
server state, data, configuration, playback engines, authentication, route
ownership, notifications, or external clients.
