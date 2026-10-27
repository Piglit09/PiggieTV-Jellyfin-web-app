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
  Git common directory, existing HTTPS origin identity, every effective
  origin push destination, a `codex/bugfix/<topic>` branch, and
  ancestry from `db38180035a9e413510414bd8b75940806952b7f`. A detached
  HEAD, linked worktree, other branch, missing baseline, or unrelated history
  fails closed. Push routing includes Git URL rewrites and origin fetch URLs
  used when no explicit push URL exists. An empty/malformed destination set
  or any foreign destination fails; checking only the first is insufficient.
  This does not change the shared fetch/provenance contract. Cloud package
  and deployment modes are denied before CI handling; `--ci-ref` cannot
  substitute for cloud development identity.
- These checks prevent accidental use of the supported entrypoints from the
  wrong checkout. The cloud checkout and guard code are writable by the same
  worker. This repository provides no protected cloud identity or signed
  grant, and this task has not verified a platform-provided one. These checks
  are **not** an independent security credential. They cannot prevent
  arbitrary manual writes or a modified script. GitHub
  permissions and human review remain the boundary for pushed code. Genuine
  GitHub Actions exact-ref builds retain their existing separate path.

## Set up the existing cloud checkout

The cloud support and dependent playback changes are merged into
`integration/responsive-playback-jf122-stage4`. Start new work from a reviewed
full integration commit already available in the existing checkout. Set
`PTV_APPROVED_INTEGRATION_COMMIT` to that exact reviewed commit before using
the snippet. If it is unavailable, stop and report it rather than creating
a clone or worktree. Verify the current branch and preserve existing work;
stop if the checkout differs or has uncommitted files. Branch creation is
for a new task, not an instruction to switch an active task's branch.

```bash
(
set -euo pipefail
cd /workspace/PiggieTV-Jellyfin-web-app
resolved_root=$(pwd -P)
source_root=$(git rev-parse --show-toplevel)
common_directory=$(git rev-parse --path-format=absolute --git-common-dir)
test "$resolved_root" = /workspace/PiggieTV-Jellyfin-web-app
test "$source_root" = /workspace/PiggieTV-Jellyfin-web-app
test "$common_directory" = /workspace/PiggieTV-Jellyfin-web-app/.git
# Preserve a final empty URL instead of losing it to command substitution.
fetch_urls=$(git remote get-url --all origin && printf '.')
push_urls=$(git remote get-url --push --all origin && printf '.')
fetch_urls=${fetch_urls%$'\n.'}
push_urls=${push_urls%$'\n.'}
test -n "$fetch_urls"
test -n "$push_urls"
for destination_set in "$fetch_urls" "$push_urls"; do
  while IFS= read -r destination; do
    case "$destination" in
      https://github.com/Piglit09/PiggieTV-Jellyfin-web-app.git|https://github.com/Piglit09/PiggieTV-Jellyfin-web-app) ;;
      *) echo 'Unexpected origin destination' >&2; exit 1 ;;
    esac
  done <<< "$destination_set"
done
worktree_status=$(git status --porcelain=v1)
test -z "$worktree_status"
approved_commit=${PTV_APPROVED_INTEGRATION_COMMIT:?Set the reviewed full integration commit}
[[ "$approved_commit" =~ ^[0-9a-f]{40}$ ]]
git cat-file -e "$approved_commit^{commit}"
git merge-base --is-ancestor db38180035a9e413510414bd8b75940806952b7f "$approved_commit"
topic=cloud-smoke
git switch -c "codex/bugfix/$topic" "$approved_commit"
git merge-base --is-ancestor db38180035a9e413510414bd8b75940806952b7f HEAD
node scripts/ptv-workspace-preflight.mjs edit
node scripts/ptv-workspace-preflight.mjs build
)
```

Replace `cloud-smoke` with a unique short lowercase topic for actual work.
The suffix may contain letters, digits, dots, underscores, or hyphens; no
nested branch suffix. The guard accepts the origin with or without its
optional `.git` suffix. The shell checks all effective fetch URLs as an
additional setup precaution; runtime cloud validation retains its existing
origin identity check and validates the complete effective push set. The
preflights also reject malformed raw routing configuration that Git may
omit or reinterpret in its URL listing. The subshell exits on any failed
check or command. Do not change a remote just to make a check pass.

Do not edit product files until `edit` passes. The integration branch itself
does not pass cloud `edit`: the worker must use a named bug-fix branch.
If `.git` is a file or the cloud
platform resolves the checkout to a different path, stop and report the
observed layout for review rather than weakening the guard.

After `edit` passes, follow root `AGENTS.md` for source changes and version
rules. Re-run `edit` before editing and `build` before supported local builds;
run focused tests, then commit locally. When publication is authorized for
the task, push only the bug-fix branch and open its review against the
integration branch. Preserve any task-specific publication hold, including
one pending Cloudflare disconnection confirmation. Do not merge, package,
release, or deploy from the cloud checkout.

## Validation and revocation

The earlier Windows fixture suite exercised allowed and denied cloud
operations by injecting a Linux runtime value into disposable local
repositories. That is
**simulated validation**, not a smoke test in the actual cloud checkout. A
cloud worker must run the two preflight commands above and report the root,
common directory, origin identity, complete effective push set, branch,
HEAD, and results before product work. Disposable Git fixtures must cover
multiple push URLs, fetch-as-push fallback, Git rewrites and malformed/empty
entries without contacting a remote. Record the runtime environment for
those tests separately from actual-checkout preflight observations. The
initial actual Linux `edit`/`build` acceptance at merged commit
`8ac3dcc713cde18e94114022beede6ad820a57ce` and final push-set correction
evidence are distinguished in the [implementation record](../superpowers/plans/2026-10-27-cloud-origin-destinations.md).
A real cloud package/deployment denial can be checked with the non-executing
preflight commands only; never invoke deployment scripts or contact Jellyfin.

To end new use of this exception, remove the cloud policy and pinned entry
in a reviewed change, stop relevant cloud tasks, and revoke the worker's
GitHub write access if necessary. Existing clones can retain old code, so
repository changes alone do not revoke GitHub credentials or prevent manual
filesystem writes. No operator Registry step is needed for this edit/build
exception; protected deployment authority is neither installed nor changed.
