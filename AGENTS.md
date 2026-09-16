# PiggieTV Web Agent Instructions

## PTV Web release version

- `ptv-version.json` is the only PTV Web release-version authority. `package.json` remains the upstream Jellyfin Web compatibility version and must not be used for PTV release bumps.
- For each material user request that changes shipped PiggieTV Web product code in this repository, bump the PTV Web version exactly once with `npm run version:ptv:bump` before final handoff.
- Do not bump for read-only questions, investigation that makes no product change, test reruns, status requests, or continuation messages that belong to the same logical user request.
- All Codex agents and compacted/continued turns working on one logical request share the same single bump. Before bumping, inspect the request's current diff or coordination messages and do not bump again if another agent already performed it.
- Automatic bumps advance one patch step and carry `x.y.99` to `x.(y+1).0`. They must never change the major version. At `x.99.99`, stop and obtain explicit major-release direction.
- Run `npm run version:ptv:check` after version or release-tooling changes.

## Mandatory Atlas impact pass

- Before editing shipped PTV Web or embedded Plugin code for a significant change, read `docs/architecture/jellyfin-reference/CHANGE-PROTOCOL.md` and complete its Atlas Impact Record in the task plan or report. Do not modify product code until that pre-change record is complete.
- A significant change alters runtime behavior, authority or ownership, an API/schema/capability, authentication or user scope, DTO adoption, cache/request/image identity, async lifecycle or invalidation, mutation/readback, playback/session behavior, persisted configuration, build/service-worker/deployment behavior, or more than one subsystem. Read-only work, documentation-only work, test reruns, and mechanical changes with no shipped behavior are exempt. Pure styling with unchanged DOM structure and interaction may use the protocol's abbreviated path.
- Use `docs/architecture/jellyfin-reference/INDEX.md` and `docs/architecture/jellyfin-reference/system-map.json` to identify the stock authority and contract, current PTV owner(s), affected dependencies, risk boundaries and non-guarantees, downstream surfaces, and required pre/post tests. Read the applicable material in chapters 20–25. If authority is `UNKNOWN` or the plan conflicts with the Atlas, stop and explain the conflict before editing product code.
- Re-run the impact pass against the actual diff before handoff. Update the Atlas and `docs/architecture/jellyfin-reference/system-map.json` in the same work item when ownership, contract, dependency, lifecycle/cache/security boundary, modification class, risk, or required proof changes; otherwise record `Atlas update: not required` and the reason.
