# Phase H1 Repository Hygiene Summary

## Safety Snapshot

The non-shared snapshot `PiggieTV-H1-safety-20260801T163945Z` was validated
before repository edits. It contains the complete tracked binary patch, status
inventories, untracked-file inventory, selective untracked archive, and hash
manifest.

- Hash-manifest SHA-256: `123dfb1d05382f6ec317a87f6d2ed40149215acbf55a78d984c9518178a0142f`
- Tracked-patch SHA-256: `d85616ec2022b3ba13ddf39cb67e73e6dad28b975109a60d1f3dfad8770fa54f`
- Untracked-archive SHA-256: `3f7ddd458b0f3099c441fac1ce0524fde61d04b0fcada7705bf12a16a83555d5`
- Tracked patch: 118,949,883 bytes
- Untracked archive: 179 files, 402,566 bytes
- Hash failures: 0

The archive excludes three private user attachment images and nine reproducible
npm cache files. Those paths remain untouched and are recorded separately.

## Initial Dirty State

- Total dirty paths: 6,498
- Modified tracked paths: 162
- Deleted tracked paths: 6,145
- Untracked paths: 191
- Staged paths: 0
- Unknown paths after classification: 0

Category totals follow the Phase H1 category definitions:

| Category | Count | Meaning |
| --- | ---: | --- |
| A | 172 | Approved PiggieTV product source |
| B | 129 | Approved tests |
| C | 1 | Approved contract or dependency lock |
| D | 9 | Approved documentation |
| E | 28 | Approved validation or developer tooling |
| G | 1 | Local test evidence |
| H | 6,155 | Dependency or tool cache |
| L | 3 | Unrelated user work |

## Mass-Deletion Finding

All 6,145 deleted tracked paths are under `node_modules/.cache`. HEAD contains
11,382 tracked cache blobs totaling 174,648,081 bytes. The sampled blobs are
Babel/compiler cache JSON, source has no references to the cache path, the
worktree is not sparse, no skip-worktree flags are present, and Git history
shows the cache existed from the initial repository import. The current
deletions are therefore retained as generated-noise deletions rather than
restored.

The repository also historically tracks 116,152 `node_modules` paths. H1 does
not perform broad de-vendoring because bulk deletion is explicitly prohibited.
That historical condition is documented debt rather than silently rewritten.

## Generated and Local Output Policy

- Commit `package-lock.json`; it is the authoritative dependency lock.
- Ignore `node_modules`, compiler caches, `dist`, coverage, browser reports,
  Playwright output, plugin `bin`/`obj`, and local .NET state.
- Keep test evidence under ignored `test-results` unless a sanitized report is
  deliberately promoted to documentation.
- Keep root `test-results.zip`, Codex attachment inputs, and the local npm cache
  outside Git.
- Do not add a broad `/build/` rule because that name is not proven to be only
  generated output across all repository subprojects.
- Preserve APKs, Gradle output, downloaded tools, browser profiles, and local
  Jellyfin data outside Git unless a separately approved release policy names
  a specific artifact.

## Phase and Rollback Boundaries

| Boundary | Initial paths | Purpose |
| --- | ---: | --- |
| Core foundation | 78 | PTV Core Phase 1 and Core 2A-2D |
| Web reliability | 72 | R1, R2, and R2B request/route reliability |
| Home and Search | 49 | F1 personalization and cross-surface Search |
| Music experience | 51 | F2 and F2B Music behavior and continuity |
| Runtime and diagnostics | 36 | Diagnostics, F2C0, F2D, and F2D-B1 |
| Validation tooling | 43 | Contracts, build gates, evidence, and browser harnesses |
| Documentation ledger | 9 | Historical phase reports before H1 additions |
| Repository hygiene | 6,146 | Cache deletions and ignore policy |
| Local only | 14 | Evidence, local caches, generated metadata, and user inputs |

Files touched by multiple phases are assigned to the smallest safe consolidated
boundary. No automated hunk splitting is used. Final assembled-branch gates,
rather than untested historical intermediate builds, are authoritative.

## Low-Value and Privacy Review

- Four duplicate `node_modules` ignore lines are consolidated into the existing
  anchored rule.
- The unused accidental npm dependency named `package` is removed from the root
  manifest and lockfile; no source reference exists in HEAD, tracked changes,
  or untracked source.
- Environment-specific private hosts are replaced with role labels in current
  authoritative documentation.
- Loopback endpoints, user-facing private-network examples, redaction sentinels,
  and synthetic test fixtures are retained because they are functional test data.
- No focused `.only` tests or newly disabled `.skip` tests were detected.
- Existing diagnostic logging and lint suppressions are retained where static
  pattern matching alone cannot prove them temporary or dead.
