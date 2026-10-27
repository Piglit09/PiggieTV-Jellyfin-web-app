# PTV Web cloud development

This procedure applies only to the existing Linux Codex checkout at
`/workspace/PiggieTV-Jellyfin-web-app`. The Windows source root remains
`C:\Users\Piggie\Documents\GitHub\Jellyfin-Web-PiggieTV`. The cloud entry in
`config/ptv-workspace-policy.json` is pinned in the preflight code; editing
the task-writable JSON alone cannot broaden it.

## Scope and trust boundary

- Cloud development permits `edit` and `build` only. It does not grant
  `package`, `deploy`, `deploy-development`, release, merge, or server access.
  The Windows protected operator policy and target registry remain separate.
- The guard checks the resolved root, a real `.git` directory at that root,
  Git common directory, HTTPS origin, a `codex/bugfix/<topic>` branch, and
  ancestry from `db38180035a9e413510414bd8b75940806952b7f`. A detached
  HEAD, linked worktree, other branch, missing baseline, or unrelated history
  fails closed. `--ci-ref` cannot substitute for cloud development identity.
- These checks prevent accidental use of the supported entrypoints from the
  wrong checkout. The cloud checkout and guard code are writable by the same
  worker. This repository provides no protected cloud identity or signed
  grant, and this task has not verified a platform-provided one. These checks
  are **not** an independent security credential. They cannot prevent
  arbitrary manual writes or a modified script. GitHub
  permissions and human review remain the boundary for pushed code. Genuine
  GitHub Actions exact-ref builds retain their existing separate path.

## Set up the existing cloud checkout

The support branch is `support/cloud-development-workflow-20261027`. Review
its draft PR and exact commit before use. In the already provisioned cloud
checkout, verify the origin, clean status, and current branch. Stop if the
checkout differs or has uncommitted work. Do not create a clone or worktree.

```bash
cd /workspace/PiggieTV-Jellyfin-web-app
test "$(pwd -P)" = /workspace/PiggieTV-Jellyfin-web-app
test "$(git rev-parse --show-toplevel)" = /workspace/PiggieTV-Jellyfin-web-app
test "$(git rev-parse --path-format=absolute --git-common-dir)" = /workspace/PiggieTV-Jellyfin-web-app/.git
case "$(git remote get-url origin)" in
  https://github.com/Piglit09/PiggieTV-Jellyfin-web-app.git|https://github.com/Piglit09/PiggieTV-Jellyfin-web-app) ;;
  *) echo 'Unexpected origin'; exit 1 ;;
esac
case "$(git remote get-url --push origin)" in
  https://github.com/Piglit09/PiggieTV-Jellyfin-web-app.git|https://github.com/Piglit09/PiggieTV-Jellyfin-web-app) ;;
  *) echo 'Unexpected push destination'; exit 1 ;;
esac
test -z "$(git status --porcelain=v1)"
git fetch origin support/cloud-development-workflow-20261027
topic=cloud-smoke
git switch -c "codex/bugfix/$topic" origin/support/cloud-development-workflow-20261027
git merge-base --is-ancestor db38180035a9e413510414bd8b75940806952b7f HEAD
node scripts/ptv-workspace-preflight.mjs edit
node scripts/ptv-workspace-preflight.mjs build
```

Replace `cloud-smoke` with a unique short lowercase topic for actual work.
The suffix may contain letters, digits, dots, underscores, or hyphens; no
nested branch suffix. The guard accepts the origin with or without its
optional `.git` suffix. Do not change a remote just to make a check pass.

The branch creation step is the one-time bootstrap. Do not edit product files
until `edit` passes. The support branch itself does not pass cloud `edit`:
the worker must use a named bug-fix branch. If `.git` is a file or the cloud
platform resolves the checkout to a different path, stop and report the
observed layout for review rather than weakening the guard.

After `edit` passes, follow root `AGENTS.md` for source changes and version
rules. Re-run `edit` before editing and `build` before supported local builds;
run focused tests, then commit and push only the bug-fix branch for review.
Until the support PR is merged, open any dependent bug-fix PR against the
support branch so the changes stay separately reviewable. Retarget it to the
integration branch after the support PR merges. Do not merge, package,
release, or deploy from the cloud checkout.

## Validation and revocation

The Windows fixture suite exercises allowed and denied cloud operations by
injecting a Linux runtime value into disposable local repositories. That is
**simulated validation**, not a smoke test in the actual cloud checkout. A
cloud worker must run the two preflight commands above and report the root,
common directory, branch, HEAD, and results before product work. A real
cloud package/deployment denial can be checked with the non-executing
preflight commands only; never invoke deployment scripts or contact Jellyfin.

To end new use of this exception, remove the cloud policy and pinned entry
in a reviewed change, stop relevant cloud tasks, and revoke the worker's
GitHub write access if necessary. Existing clones can retain old code, so
repository changes alone do not revoke GitHub credentials or prevent manual
filesystem writes. No operator Registry step is needed for this edit/build
exception; protected deployment authority is neither installed nor changed.
