# PTV Stabilization Backlog Reconciliation

Date: 2026-09-20

This document reconciles the named stabilization backlog against the current source and focused automated verification. It is not a production-acceptance record and does not expand the 0.5.60 / 0.5.19.0 release scope.

The focused Web run passed 10 test files and 80 tests. The focused Plugin run using the `FeaturedContent|Recommendation` filter passed 67 tests. A bounded local Playwright inspection at 390x844 used the exact Browse and Metadata Manager source DOM structures with their compiled production styles because the existing browser harness does not mount those complete chip surfaces. Production acceptance remains a separate later gate.

| Item | Classification | Evidence | Release action |
| --- | --- | --- | --- |
| PDF zoom | ALREADY_IMPLEMENTED | `ReaderApp.test.tsx` and `ReaderToolbar.test.tsx` passed in the 80-test focused Web run. Named cases cover bounded keyboard shortcuts, rejected-renderer rollback, persisted fit mode, format-specific fit/scaling, one-dispatch toolbar actions, semantic bounds, and hidden inactive chrome. | No code change. |
| Reading artwork | ALREADY_IMPLEMENTED | `readingArtworkResolution.test.ts` and `readingArtworkLifecycle.test.ts` passed in the focused Web run. Named cases cover Primary/Backdrop fallback, placeholder termination, arbitrary candidate order, generation and identity reset, stale load/error suppression, and isolation from User Views requests. | No code change. |
| Calendar | ALREADY_IMPLEMENTED | `PiggieTvCalendarPage.test.tsx` passed in the focused Web run. Named cases cover healthy, partial, unavailable, and missing-configuration states; bounded ranges; deduplicated refresh; cancellation and stale settlement; and local-date grouping and ordering. | No code change. |
| Generated rows | ALREADY_IMPLEMENTED | The 67-test focused Plugin run passed. `FeaturedContentStoreTests`, `FeaturedContentSemanticValidationTests`, `PtvConfiguredRowAssociationTests`, and `PtvFeaturedContentAuthorizationTests` exercise featured-content serialization and semantic validation, generated-row association and persistence, generation retirement/recovery, and user-scoped authorization/redaction. | No code change. |
| Recommendation persistence | ALREADY_IMPLEMENTED | `recommendationMutationSafety.test.ts` passed in the focused Web run, covering complete snapshot comparison, authoritative baseline confirmation, conflict rejection, fail-closed behavior, and single-flight mutation. The 67-test Plugin run also passed `PtvRecommendationPolicyServiceTests` and `PtvPersistedRecommendationAuthorizationTests`, covering policy validation and authenticated, user-scoped projection of persisted recommendations. | No code change. |
| Home backdrop | ALREADY_IMPLEMENTED | `PTVShellBackdrop.test.tsx` passed in the focused Web run. Named cases cover teardown before late callbacks, stale-load suppression, normal transition cleanup, presentation retirement, and reuse without a duplicate request. | No code change. |
| Settings save/warning | ALREADY_IMPLEMENTED | `useAdminLibraryDisplay.test.tsx` and `AdminLibraryDisplayUi.test.tsx` passed in the focused Web run. Named cases cover single-flight save, read cancellation, direct cache publication, retained data after failure, stale-read suppression, dirty/reset state, unload warning, conflict handling, and uncertain successful writes. | No code change. |
| Reading Identify | ALREADY_IMPLEMENTED | `AdminReadingIdentifyWorkflow.test.tsx` passed in the focused Web run. Named cases cover structured fields, lazy provider status, punctuation-tolerant provider identity, ranked partial-provider results, explicit apply confirmation, bounded plain text, unsafe URL rejection, and phone-stacking classes. | No code change. |
| Chip overflow | NOT_REPRODUCED | No chip crossed its viewport or hid an action at 390x844 in the bounded inspection. | No code change; keep as a separately reproducible UI issue if new evidence appears. |

## Post-R3 Deferred Follow-up

The following issues were recorded during release validation and are explicitly outside the R3 scope. They remain open until separately reproduced, designed, implemented, and verified. No item below is a production-acceptance blocker for Web 0.5.60 / Plugin 0.5.19.0.

| Item | Classification | Evidence | Follow-up |
| --- | --- | --- | --- |
| Library scope bleed | OPEN DEFECT | A library-specific recommendation row can contain items from another library; `Recommended Cartoons` was observed with general Shows content. | Reproduce and trace library-ID scoping versus media-type-only scoping. |
| Extreme image churn / performance | OPEN PERFORMANCE ISSUE | Diagnostics recorded thousands of image lifecycle events and long-tail Items requests of approximately 4–10 seconds. | Investigate the image lifecycle and long-tail Items request behavior separately. |
| Recommendation generation degraded | OPEN DEFECT | Recommendation generation was observed in a degraded state; its relationship to library scope bleed is unknown. | Diagnose independently, then correlate with scope bleed only if evidence supports it. |
| Player flyout lifecycle | OPEN DEFECT | Audio and Subtitles menus can remain visible after playback controls auto-hide. | Align flyout dismissal with the playback-controls lifecycle. |
| Player volume persistence | OPEN DEFECT | User volume was observed to reset during episode autoplay, from 100% to 50% on the next episode. | Preserve the active user volume across autoplay transitions. |
| Player top header / episode label | DEFERRED UX WORK | Playback lacks the intended top header/back button. Series playback should show series logo/title; movie playback should show movie logo/title. Episode controls should show `SxxExx · Episode Title` without repeating series identity. | Design and verify the header and episode-label contract across playback types and input modes. |
| Media topology / Anime discovery | DEFERRED INFRASTRUCTURE AUDIT | VM115, DAS, and Servarr directory layouts are inconsistent; some Anime present in Sonarr is not visible in PTV/Jellyfin. | Perform a separate read-only topology audit before any move, rename, mount, or library change. |
| Calibre/Caliweb → PTV Reading migration | DEFERRED PROJECT | Books, Comics, and Manga are not yet inventoried and migrated into PTV Reading. | Inventory and migrate content, prove PTV authoritative, then retire CT108 separately. |
| Premium UI 2.0 | DEFERRED PROJECT | A post-stability visual system is desired: PTV-purple translucent/reactive glass, stronger depth/refraction/highlights, shared semantic glass levels, and native-client-appropriate performance. | Treat as a separately designed and performance-qualified facelift. |
| PTV Games | DEFERRED PROJECT | Games integration is a long-term product goal. | Start with romM or another specialized backend rather than immediately rebuilding the game backend. |
