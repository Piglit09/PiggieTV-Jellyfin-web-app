# Phase 2B protected Web deployment plan

**Status:** Local infrastructure implementation. No deployment or approval is authorized.

**Source:** Existing `Jellyfin-Web-PiggieTV` checkout on `integration/responsive-playback-jf122-stage4`. The frozen Web 0.5.78 payload remains bound to `e7c7fad8ca5fe4c751a57dd5623e39a5c35154d3` after tooling commits.

## Design

Reuse the existing exact-tree publisher and prepublication gate. A new Web-only entry point will require the standing `.125` source and target preflight, a separate protected approval check, verified candidate and rollback bytes, a fresh authenticated session check before first target mutation and again before `index.html`, and served-index verification. The standing development installer will reject Web publication and direct operators to this entry point. Its Plugin path remains separate.

The approval record must live outside the task-writable repository and artifact root, be bound by the ACL-protected Registry policy to its path and hash, and explicitly attest to maintenance window, isolated audience, and residual race acceptance or operator-controlled maintenance restriction. This task will not create that record or change the Registry policy. The running `.125` tree is untouched.

The publisher uses verified files and an index-last transaction journal with automatic rollback. Windows/Jellyfin directory-swap behavior is not established locally; no atomicity claim is made. The short mixed-asset interval remains a stated risk. Recovery of an interrupted transaction requires a separate protected recovery approval.

## Atlas impact record

- **Change:** deployment tooling, not Web runtime or Plugin assemblies.
- **Owners:** workspace preflight and exact-tree publication scripts; Web navigation, playback, cache, and diagnostics runtime are not modified.
- **Invariant:** only the registered `.125` Web target can be written after independent approval, exact artifact and rollback verification, audience attestation, and two fresh zero-playback checks.
- **Failure handling:** deny before target mutation when possible; after mutation, restore the exact baseline and record a distinct recovery-required state if restoration fails.
- **Evidence:** disposable filesystem fixtures, policy-negative tests, session API fixtures, source/artifact hashes, and read-only audience inventory.

## Implementation tasks

1. Extend the session gate with complete unfiltered `/Sessions` inventory semantics, explicit playback-field validation, dynamic expected versions, freshness, and privacy-safe results. First add failing fixtures for each unsafe state, then implement and run the gate suite.
2. Extend the exact-tree publisher to accept the Phase 2A installed-state baseline manifest with strict target/server binding and to protect `config.json`. Add failing fixtures and complete requested rollback/fault cases; then implement and run the publisher suite.
3. Add a protected Web approval validator and CLI mode that reuse the existing ACL-protected Registry read, require exact candidate/baseline/rollback hashes and paths, and reject absent or task-writable approval. Add negative tests first, then implement.
4. Add a reusable Web-only PowerShell entry point with no caller-selected target, two live session checks, index verification, and separately approved recovery. Make the broad development installer deny Web publication. Test parser and fixture wiring without invoking a live target.
5. Run affected guard, policy, manifest, publisher, rollback, path, privacy, and regression suites. Verify original candidate and rollback SHA-256 values again and confirm the `.125` installed tree was not changed.
6. Write Phase 2B reports and the operator procedure. Update the existing artifact index, preserve its historical rows, and provide a final HOLD handoff.

## Constraints

No new repository, worktree, VM, Jellyfin instance, user, library, protected approval, deploy, production contact, push, or release. Fixtures live under the system temporary directory and are checked to remain there before cleanup. Files in the ChatGPT project mirror remain read-only.
