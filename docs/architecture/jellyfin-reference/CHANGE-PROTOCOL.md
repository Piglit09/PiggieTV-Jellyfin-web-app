# PTV Change Protocol

## Purpose

This is the mandatory entry point for significant PTV product changes. It turns the detailed Atlas into a short pre-change gate:

**stock owner → PTV owner → affected graph → non-guarantees → plan → tests → implementation → Atlas update**

The detailed evidence remains in [INDEX.md](INDEX.md), [system-map.json](system-map.json), and chapters 20–25. This protocol does not duplicate those references.

## When it applies

Complete the full protocol before changing shipped PTV Web or embedded Plugin behavior involving any of these areas:

- authority, ownership, authentication, user scope, permissions, or security boundaries;
- API routes, schemas, capability gates, Plugin/Web contracts, or Jellyfin compatibility;
- DTO adoption, metadata mutation/readback, or async convergence;
- route, request, cache, image, observer, invalidation, or teardown lifecycles;
- playback, queue, Now Playing, sessions, reporting, transcoding, or persisted configuration;
- build, service worker, asset identity, deployment behavior, or multiple subsystems.

Read-only work, documentation-only work, test reruns, and mechanical changes with no shipped behavior are exempt. A visual-only change may use an abbreviated record only when DOM structure, interaction, focus, data flow, ownership, and lifecycle are unchanged; record that evidence explicitly.

## Mandatory sequence

1. **Record the baseline.** Capture repository, branch, `HEAD`, product version, and dirty paths. Treat pre-existing changes as user-owned and isolate the proposed diff.
2. **Locate the system.** Start with [INDEX.md](INDEX.md), then query the relevant `components`, `systems`, `owners`, `dependencies`, `mutations`, `routes`, `apiContracts`, `riskBoundaries`, `ptvOverrides`, `activeKnownDeviations`, and `stabilizationBacklog` in [system-map.json](system-map.json).
3. **Read the contracts.** Read the applicable stock feature chapter plus the relevant sections of [20 — PTV versus stock](20-ptv-vs-stock-map.md), [21 — ownership conflicts](21-ownership-conflicts.md), [22 — change impact](22-change-impact-matrix.md), [23 — checklists](23-before-you-modify-checklists.md), [24 — API contracts](24-stock-api-contract-reference.md), and [25 — non-guarantees](25-known-jellyfin-non-guarantees.md). Chapter [26](26-upstream-post-10.11.11-differences.md) is a newer-upstream watchlist and never substitutes for the 10.11.11 contract.
4. **Write the Atlas Impact Record.** Complete the template below before editing product code. Use `VERIFIED_FROM_SOURCE`, `VERIFIED_BY_TEST`, `INFERRED`, and `UNKNOWN` accurately.
5. **Define proof before implementation.** Identify characterization/security tests needed before coding and focused, boundary, integration, and physical tests needed afterward.
6. **Change one owner deliberately.** Extend an established owner where possible. If the implementation conflicts with the Atlas, changes the intended authority, or depends on an unresolved security/identity boundary, stop and explain before editing.
7. **Reconcile the actual diff.** Repeat the impact check against every changed product file and run the applicable final gates from chapter 23.
8. **Keep the Atlas living.** Update affected chapters and `system-map.json` in the same work item when the change alters architecture. Preserve the stock 10.11.11 baseline unless the supported compatibility target itself changes.

## Atlas Impact Record

Copy this into the task plan or implementation report and fill every field:

```text
ATLAS IMPACT RECORD
Scope:
Baseline (repository / branch / HEAD / product version / dirty paths):
Stock authoritative owner and contract:
Current PTV owner(s) and modification class:
Affected map nodes, edges, mutations, routes, and risk boundaries:
Identity, permission, and security scope:
DTO projection, mutation, readback, and convergence risks:
Affected cache, lifecycle, request, image, playback, and configuration owners:
Downstream surfaces that can regress:
Pre-code characterization/security tests:
Post-code focused, boundary, integration, and physical tests:
Conflicts or UNKNOWN items:
Active known deviations and stabilization-backlog entries/order affected:
Atlas update: required / not required — reason and targets:
```

For a proven visual-only change, the abbreviated record is:

```text
ABBREVIATED ATLAS IMPACT RECORD — VISUAL ONLY
Scope and baseline:
Evidence that DOM structure, interaction, focus, data flow, ownership, and lifecycle are unchanged:
Affected routes and view owners:
Visual, responsive, focus, and accessibility checks:
Atlas update: required / not required — reason and targets:
```

## Non-negotiable decisions

- Do not introduce a second owner when the established owner can safely be extended.
- Do not replace richer state with a sparse DTO or treat an omitted projection field as deletion.
- Do not use Web filtering as the server authorization boundary.
- Do not interpret HTTP success as universal mutation, cache, image, indexing, playback, or UI convergence.
- Do not add a broad reload, retry loop, or timeout increase unless the Atlas and exact source establish that the authoritative owner requires it.
- Do not promote `INFERRED` or `UNKNOWN` behavior to fact to justify implementation.

## Stop conditions

Stop before product edits and report the conflict when:

- the authoritative owner or required invalidation/retirement owner is unresolved;
- user identity, permission scope, or response-boundary authorization cannot be proven;
- the proposal creates duplicate ownership without an explicit arbitration and retirement contract;
- the proposal contradicts a stock non-guarantee or current Atlas edge;
- required boundary proof is unavailable but the requested gate would require `PASS`.

Keep unresolved behavior `UNKNOWN`; do not guess around the gate.

## Handoff requirements

The final handoff must state:

- the owners and contracts actually changed or preserved;
- the actual-diff blast radius and tests run;
- remaining `UNKNOWN` and unexecuted physical/integration proof;
- whether active known deviations or stabilization-backlog entries/order changed;
- `Atlas update: required` with updated files, or `Atlas update: not required` with a concrete reason;
- applicable Web and Plugin version-policy checks.

Repository policy remains authoritative: [PTV Web agent instructions](../../../AGENTS.md) and [Plugin agent instructions](../../../src/ptv/plugin/AGENTS.md). Atlas/documentation work does not cause an extra version bump; a material shipped Web or Plugin change still follows its applicable one-bump-per-logical-request policy.
