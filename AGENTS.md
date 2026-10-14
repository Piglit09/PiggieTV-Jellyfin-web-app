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

## Repository authority and workspace boundary

- The sole writable local source checkout for PTV Web and its embedded Plugin is `C:\Users\Piggie\Documents\GitHub\Jellyfin-Web-PiggieTV`. Verify its resolved Git root, Git common directory, origin remote, branch, full HEAD, and staged/unstaged/untracked status before each task. Stop source mutations if any identity check fails.
- Use `node scripts/ptv-workspace-preflight.mjs audit` for read-only inspection and the `edit`, `build`, `package`, or `deploy` mode before the corresponding supported operation. The policy in `config/ptv-workspace-policy.json` identifies the approved source root; a local policy edit is not deployment authorization.
- Historical Primary, Canonical, integration, experimental, archived, and disposable Codex directories are read-only evidence. Do not edit or build from them. A temporary linked worktree requires explicit task-scoped operator approval, registration, and a reconciliation/retirement plan; it never becomes another source authority.
- Do not create a persistent clone, alternate source root, repository, Git worktree, VM, LXC, or Jellyfin installation without explicit operator authorization. Do not edit deployed Jellyfin application files as a source-development shortcut.
- Keep Web version authority in `ptv-version.json` and Plugin version authority in `src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj`. Record both and the shared full source commit for a Web/Plugin build. Preserve the version-bump rules above for shipped product changes.
- Use `C:\Users\Piggie\Documents\GitHub\_PTV-Artifacts` for durable reports, captures, manifests, and build evidence. Generated outputs under ignored `dist/`, `tmp/`, or `bin/` are transient. Never commit credentials, tokens, keys, private environment files, or a generated artifact as source.
- Release packages require a clean committed source and a complete SHA-256 artifact manifest. Verify the final packaged bytes after any configuration transformation. Do not trust a version label, one bundle hash, or a caller-supplied commit override as package provenance.
- Consult `docs/operations/ptv-environments.json` before contacting Jellyfin. Production is denied by default. Test environment classification alone grants no mutation permission. Deployment requires a registered target, exact artifact manifest and source commit, independently controlled task-specific approval, and verified rollback evidence. Do not deploy or restart a service from an ordinary development task.
- Preserve all pre-existing uncommitted work. Do not reset, clean, overwrite, switch over dirty files, or silently reconcile another checkout. Commit changes to this repository when authorized, and report changed paths, branch/commit, untracked files, artifacts outside the repository, tests, and any unfinished gates.
- **Final source-of-truth check:** before handoff, confirm the resolved source root and common directory, origin, full HEAD, worktree status, versions, changed paths, and artifact hashes. State any enforcement limits: repository scripts protect supported entrypoints but cannot prevent arbitrary manual filesystem writes.
