# Repository Safety

This repository must contain source and intentional project documentation only. Operational/runtime data belongs outside the active worktree.

## Never use casually

- `git clean`
- recursive deletion of untracked files
- blanket `git add .`

Ignored files can still contain the only copy of important data. Ignore rules prevent accidental staging; they are not backups.

## Operational data policy

Production configuration, runtime state, deployment packages, logs, backups, and private QA captures must be stored outside this repository. The current operational archive is maintained under the user’s Documents-area `PTV-Operational-Archive/Jellyfin-Web-PiggieTV/` location.

Do not recreate `.codex-runtime/` or `artifacts/` as operational storage inside the repository. If tools need scratch space, point them to an external, access-controlled location.

## Sensitive data policy

Credentials, tokens, account exports, production configuration, private runtime state, and user or media-library data must never be committed. Use approved secret/runtime channels and keep redacted templates separate from live values.

## Safe staging

Inspect status first, then stage explicit paths only:

```text
git status --short
git add -- <specific-files>
```

Review the staged diff before committing.

## Before destructive cleanup

1. Run `git status`.
2. Inspect every untracked path and its purpose.
3. Verify required backups by count, size, and hash.
4. Confirm no operational/runtime or sensitive data remains in the worktree.
5. Obtain approval and perform only targeted cleanup of explicit paths.
