# PiggieTV Web Agent Instructions

## PTV Web release version

- `ptv-version.json` is the only PTV Web release-version authority. `package.json` remains the upstream Jellyfin Web compatibility version and must not be used for PTV release bumps.
- For each material user request that changes shipped PiggieTV Web product code in this repository, bump the PTV Web version exactly once with `npm run version:ptv:bump` before final handoff.
- Do not bump for read-only questions, investigation that makes no product change, test reruns, status requests, or continuation messages that belong to the same logical user request.
- All Codex agents and compacted/continued turns working on one logical request share the same single bump. Before bumping, inspect the request's current diff or coordination messages and do not bump again if another agent already performed it.
- Automatic bumps advance one patch step and carry `x.y.99` to `x.(y+1).0`. They must never change the major version. At `x.99.99`, stop and obtain explicit major-release direction.
- Run `npm run version:ptv:check` after version or release-tooling changes.
