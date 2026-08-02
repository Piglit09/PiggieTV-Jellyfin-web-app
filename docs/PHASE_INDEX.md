# PiggieTV Phase and Evidence Index

This index distinguishes current project status from historical decisions.
Dated reports retain the decision supported by evidence available at that
time. The authoritative current status is [Project State](../PROJECT_STATE.md),
with operational context in [Handoff](../HANDOFF.md) and ownership rules in
[Architecture](../ARCHITECTURE.md).

## Current Boundary

- Web reliability and performance through F2D-B1: approved.
- H1 repository hygiene: classification, recovery, and local commit boundary.
- Next feature after H1 approval: F3, TV-first Collections and cross-library discovery.

## PTV Core

- [Core audit](architecture/PTV_CORE_AUDIT.md)
- [Core contracts](architecture/PTV_CORE_CONTRACTS.md)
- [Core migration ledger](architecture/PTV_CORE_MIGRATION.md)
- [Core overview](architecture/PTV_CORE_OVERVIEW.md)
- [PTV source map](../src/ptv/README.md)

## Diagnostics and Web Reliability

- [Diagnostics architecture](diagnostics/architecture.md)
- [R1 route and data rendering stabilization](diagnostics/phase-r1-route-data-rendering-stabilization.md)
- [R2 residual legacy transport closure](diagnostics/phase-r2-residual-legacy-transport-closure.md)
- [R2A exact-build physical navigation closure](diagnostics/phase-r2a-exact-build-physical-navigation-acceptance-closure.md)
- [R2A final counted physical-remote acceptance](diagnostics/phase-r2a-final-r2b-counted-physical-remote-acceptance.md)
- [R2B main web application optimization](diagnostics/phase-r2b-main-web-app-optimization.md)

## Historical WebOS Evidence

- [Phase 3 playback ownership audit](diagnostics/phase3a-playback-ownership-audit.md)
- [Phase 3 playback correction](diagnostics/phase3a-playback-correction-report.md)
- [Phase 3A1 physical remote and lint acceptance](diagnostics/phase3a1-final-physical-remote-lint-acceptance.md)
- [Phase 3A1R renderer restart attribution](diagnostics/phase3a1r-renderer-restart-attribution.md)
- [Phase 3A1R1 playback reboot isolation](diagnostics/phase3a1r1-no-instrumentation-playback-reboot-isolation.md)
- [Phase 3A2 playback surface composition](diagnostics/phase3a2-webos-playback-surface-composition.md)

## Repository Hygiene

- [Phase H1 summary](repository-hygiene/phase-h1-summary.md)
- [Phase H1 dirty-path ledger](repository-hygiene/phase-h1-dirty-path-ledger.json)
- [Phase H1 intentionally uncommitted ledger](repository-hygiene/phase-h1-uncommitted-ledger.json)

## Product phase F3

- [Phase F3: Premium Collections and Cross-Library Discovery](collections/phase-f3-premium-collections.md) - route-lazy Collections landing and Details, explicit cross-library relationships, scoped personalization, integration boundaries, and rollback notes.
