# PTV Music Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the existing VM115 Music mount safely and ensure a stale, confirmed-empty PTV Music Home snapshot always yields to one live catalog request without weakening useful cache behavior.

**Architecture:** The host/guest mount repair is an operational restoration of the already-configured automount chain; it makes no configuration or library mutation. The Web repair is limited to the persistent Music Home cache-admission boundary: fresh confirmed-empty snapshots remain valid, but stale confirmed-empty snapshots are retained on disk and bypassed so the established Home loader makes its normal live request and writes a fresh successful snapshot.

**Tech Stack:** TypeScript, Vitest 3, Jellyfin Web/SDK, browser `localStorage`, systemd automount and mount units, VirtioFS, Jellyfin 12.0.0.

**Spec:** `docs/superpowers/specs/2026-09-20-ptv-jellyfin12-stabilization-design.md`

## Global Constraints

- PTV Web changes receive exactly one release bump through `npm run version:ptv:bump`; `ptv-version.json` is the sole Web version authority.
- Jellyfin remains 12.0.0 and FFmpeg remains 8.1.2.
- Do not modify public routing, Jellyfin database contents, media contents, library definitions, media ownership, `/etc/fstab`, VirtioFS mappings, SQLite settings, timeout settings, concurrency settings, or thread-pool settings.
- Do not manually edit the Metadata Quality SQLite store, run a broad library scan, or restart Jellyfin merely to restore the mount.
- Preserve existing stale non-empty Music snapshot behavior, fresh confirmed-empty behavior, force-refresh behavior, error behavior, request coordination, and persistence format.
- A stale confirmed-empty snapshot must not be deleted before the live request succeeds; a transient live failure must not destructively clear it.
- Update the Atlas Impact Record before product edits and repeat the impact pass against the final diff. Update the Atlas/system map only if the final impact pass proves an ownership, contract, dependency, lifecycle, or required-proof change.
- Preserve the previous deployed Web bundle, plugin payload, and compatible cache/configuration artifact before deployment. Stop at any failed validation boundary and use the existing rollback; do not expand scope.

## Review Focus

- Stale confirmed-empty full snapshot: it must trigger one normal live load and be overwritten only by a successful populated response.
- Fresh confirmed-empty full snapshot: it must remain an immediate cache hit during the five-minute TTL and make no transport request.
- Stale useful snapshot: it must retain existing stale fallback behavior and make no transport request.
- Stale confirmed-empty snapshot plus a transport failure: the call must keep its existing failure result while retaining the old persistent JSON unchanged.
- Cache promotion: a stale confirmed-empty full snapshot must not be promoted into memory before the normal live loader runs.

---

## File Structure

- Modify: `src/ptv/modules/music/musicApi.ts` — owns persistent Music Home cache keys, validation, admission, in-memory promotion, normal Music Home loading, and persistence.
- Modify: `src/ptv/modules/music/musicApiRequests.test.ts` — already supplies the API/observability mocks, clears Music Home cache in `beforeEach`, and contains Home request scheduling tests.
- Deferred to the shared release plan: `ptv-version.json` — receives the single PTV Web patch version bump only after all three product changes pass.
- Modify if the final impact pass requires it: `docs/architecture/jellyfin-reference/system-map.json` and the applicable Atlas chapter — cache-lifecycle ownership evidence only; otherwise record `Atlas update: not required` in the handoff.

## Atlas Impact Record

**Change:** A stale confirmed-empty persistent Music Home snapshot is no longer admissible as a stale fallback; it triggers the existing live Home request while the persisted snapshot remains recoverable until a successful write replaces it.

**Authority and owner:** Jellyfin’s user-scoped Items APIs and configured Music library remain the authoritative catalog owner. `musicApi.ts` remains the PTV browser cache owner. No server API, DTO, user scope, library root, playback queue, or media ownership changes.

**Affected contract:** Browser `localStorage` keys remain `ptv:music-home-snapshot:<serverId>:<userId>:<initial|full>:v2`; schema version, cache TTL, and stored `MusicHomeCacheEntry` shape do not change. The admission rule changes only for expired confirmed-empty entries.

**Downstream surfaces:** Music Home initial load, full load, Refresh, reload persistence, observability events, and normal item/artist/album navigation. Movies, Shows, Reading, playback queue ownership, public routing, Plugin behavior, and Jellyfin library configuration are out of scope.

**Risk and proof:** The principal risk is deleting a stale empty snapshot before a failing live request, or accidentally making stale non-empty snapshots live-only. The five focused tests below prove the intended state matrix; production verification proves mount visibility, a populated Music page after reload without Refresh, artist/album navigation, and track playback.

### Task 1: Add Music Home persistent-cache admission regressions

**Files:**

- Modify: `src/ptv/modules/music/musicApiRequests.test.ts:1-520`

**Interfaces:**

- Consumes: `getPtvMusicHome(options?: PtvMusicHomeRequestOptions): Promise<PtvMusicHomeData>`, `invalidatePtvMusicHomeCache(): void`, mocked `getPtvServerId(): 'server-1'`, and mocked `getPtvCurrentUserId(): 'user-1'`.
- Produces: Five regression tests defining admission of `MusicHomeCacheEntry` stored under `ptv:music-home-snapshot:server-1:user-1:full:v2`.

- [ ] **Step 1: Extend the existing type import and add shared test fixtures below `createPtvMusicRequestTracker`**

```ts
import type { PtvMusicHomeData, PtvMusicItem } from './musicTypes';

const fullMusicHomeStorageKey = 'ptv:music-home-snapshot:server-1:user-1:full:v2';

function confirmedEmptyHomeEntry(expiresAt: number): { data: PtvMusicHomeData; expiresAt: number; schemaVersion: number } {
    return {
        data: {
            completeness: 'complete' as const,
            generatedAt: 1,
            isPartial: false,
            library: { id: 'music-library-1', name: 'Music' },
            nextEligibleRefreshAt: 1,
            refreshReason: 'full-home-snapshot',
            sectionTimings: [{ durationMs: 1, id: 'tracks', itemCount: 0, status: 'ok' as const }],
            sections: [],
            stats: { albumCount: 0, artistCount: 0, trackCount: 0 }
        },
        expiresAt,
        schemaVersion: 2
    };
}

function populatedHomeMocks() {
    vi.mocked(getPtvUserViews).mockResolvedValue({
        Items: [{ CollectionType: 'music', Id: 'music-library-1', Name: 'Music', Type: 'CollectionFolder' }],
        TotalRecordCount: 1
    });
    vi.mocked(getPtvItems).mockImplementation(async query => {
        const type = String(query?.IncludeItemTypes || 'Audio');
        return {
            Items: [{ Id: `${type}-1`, Name: `${type} 1`, Type: type === 'MusicAlbum' ? 'MusicAlbum' : type === 'MusicArtist' ? 'MusicArtist' : 'Audio' }],
            TotalRecordCount: 1
        };
    });
    vi.mocked(getPtvRecentlyAdded).mockResolvedValue([{ Id: 'recent-1', Name: 'Recent', Type: 'Audio' }]);
    vi.mocked(getPtvResumeItems).mockResolvedValue({ Items: [], TotalRecordCount: 0 });
    vi.mocked(getPtvFavoriteItems).mockResolvedValue({ Items: [], TotalRecordCount: 0 });
}
```

- [ ] **Step 2: Write the stale-confirmed-empty recovery test**

```ts
it('bypasses a stale confirmed-empty persistent Home snapshot and replaces it with live Music data', async () => {
    localStorage.setItem(fullMusicHomeStorageKey, JSON.stringify(confirmedEmptyHomeEntry(Date.now() - 1)));
    populatedHomeMocks();

    const data = await getPtvMusicHome();
    const stored = JSON.parse(localStorage.getItem(fullMusicHomeStorageKey) || '{}');

    expect(getPtvItems).toHaveBeenCalled();
    expect(data.stats.trackCount).toBeGreaterThan(0);
    expect(stored.data.stats.trackCount).toBeGreaterThan(0);
    expect(stored.expiresAt).toBeGreaterThan(Date.now());
});
```

- [ ] **Step 3: Run the new test to verify the unmodified implementation fails**

Run: `npx vitest run --config vite.config.ts src/ptv/modules/music/musicApiRequests.test.ts -t "bypasses a stale confirmed-empty"`

Expected: FAIL because `getPtvMusicHome()` returns the persisted empty data before calling `getPtvItems`.

- [ ] **Step 4: Write the fresh-confirmed-empty TTL test**

```ts
it('uses a fresh confirmed-empty persistent Home snapshot without a transport request', async () => {
    localStorage.setItem(fullMusicHomeStorageKey, JSON.stringify(confirmedEmptyHomeEntry(Date.now() + 60_000)));

    await expect(getPtvMusicHome()).resolves.toMatchObject({
        sections: [],
        stats: { albumCount: 0, artistCount: 0, trackCount: 0 }
    });
    expect(getPtvUserViews).not.toHaveBeenCalled();
    expect(getPtvItems).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Run the fresh-empty test to verify its existing intended behavior passes before the production change**

Run: `npx vitest run --config vite.config.ts src/ptv/modules/music/musicApiRequests.test.ts -t "uses a fresh confirmed-empty"`

Expected: PASS.

- [ ] **Step 6: Write the stale-nonempty compatibility test**

```ts
it('continues to use a stale non-empty persistent Home snapshot when stale reads are allowed', async () => {
    const entry = confirmedEmptyHomeEntry(Date.now() - 1);
    entry.data.sections = [{ id: 'songs', items: [{ Id: 'track-1', Name: 'Track 1', Type: 'Audio' }], kind: 'track', title: 'Songs' }];
    entry.data.stats.trackCount = 1;
    localStorage.setItem(fullMusicHomeStorageKey, JSON.stringify(entry));

    await expect(getPtvMusicHome()).resolves.toMatchObject({ stats: { trackCount: 1 } });
    expect(getPtvUserViews).not.toHaveBeenCalled();
    expect(getPtvItems).not.toHaveBeenCalled();
});
```

- [ ] **Step 7: Run the stale-nonempty compatibility test to verify the existing intended behavior passes before the production change**

Run: `npx vitest run --config vite.config.ts src/ptv/modules/music/musicApiRequests.test.ts -t "continues to use a stale non-empty"`

Expected: PASS.

- [ ] **Step 8: Write the failed-live-request retention test**

```ts
it('retains a stale confirmed-empty persistent snapshot when the required live Home load fails', async () => {
    const entry = confirmedEmptyHomeEntry(Date.now() - 1);
    const serialized = JSON.stringify(entry);
    localStorage.setItem(fullMusicHomeStorageKey, serialized);
    vi.mocked(getPtvUserViews).mockRejectedValue(new Error('Jellyfin unavailable'));
    vi.mocked(getPtvItems).mockRejectedValue(new Error('Jellyfin unavailable'));
    vi.mocked(getPtvRecentlyAdded).mockRejectedValue(new Error('Jellyfin unavailable'));
    vi.mocked(getPtvResumeItems).mockRejectedValue(new Error('Jellyfin unavailable'));
    vi.mocked(getPtvFavoriteItems).mockRejectedValue(new Error('Jellyfin unavailable'));

    await expect(getPtvMusicHome()).rejects.toThrow('Music full load failed before any library items were confirmed');
    expect(getPtvItems).toHaveBeenCalled();
    expect(localStorage.getItem(fullMusicHomeStorageKey)).toBe(serialized);
});
```

- [ ] **Step 9: Run the failed-live-request retention test to verify the unmodified implementation fails**

Run: `npx vitest run --config vite.config.ts src/ptv/modules/music/musicApiRequests.test.ts -t "retains a stale confirmed-empty"`

Expected: FAIL because the unmodified code serves the stale confirmed-empty snapshot instead of attempting the live loader; after the fix, the live error is surfaced and the original JSON remains byte-identical.

- [ ] **Step 10: Write the normal Refresh replacement test**

```ts
it('replaces a persistent Home snapshot during normal force refresh', async () => {
    localStorage.setItem(fullMusicHomeStorageKey, JSON.stringify(confirmedEmptyHomeEntry(Date.now() + 60_000)));
    populatedHomeMocks();

    await expect(getPtvMusicHome({ forceRefresh: true })).resolves.toMatchObject({
        completeness: 'complete',
        isPartial: false
    });
    const stored = JSON.parse(localStorage.getItem(fullMusicHomeStorageKey) || '{}');

    expect(getPtvItems).toHaveBeenCalled();
    expect(stored.data.stats.trackCount).toBeGreaterThan(0);
});
```

- [ ] **Step 11: Run the Refresh replacement test to verify current behavior passes before the production change**

Run: `npx vitest run --config vite.config.ts src/ptv/modules/music/musicApiRequests.test.ts -t "replaces a persistent Home snapshot"`

Expected: PASS.

- [ ] **Step 12: Commit the demonstrated red regression test before changing production code**

```bash
git add src/ptv/modules/music/musicApiRequests.test.ts
git commit -m "test: cover stale empty music home cache recovery"
```

### Task 2: Make stale confirmed-empty snapshots live-only without destructive removal

**Files:**

- Modify: `src/ptv/modules/music/musicApi.ts:449-494`
- Test: `src/ptv/modules/music/musicApiRequests.test.ts:105-520`

**Interfaces:**

- Consumes: `readPersistentMusicHomeCache(cacheKey: string, initialOnly?: boolean, allowStale?: boolean): PtvMusicHomeData | null`, `isConfirmedEmptyMusicHomeCache(data)`, `canUseMusicHomeCache(data)`, and `removePtvLocalStorageKey(storageKey)`.
- Produces: stale confirmed-empty persistent entries return `null` without deletion or memory promotion; `getPtvMusicHome()` then follows its existing coordinator and persistence path.

- [ ] **Step 1: Confirm the full five-test file fails only in the two specified stale-confirmed-empty cases**

Run: `npx vitest run --config vite.config.ts src/ptv/modules/music/musicApiRequests.test.ts`

Expected: the stale-confirmed-empty recovery and failed-live-request retention tests fail; fresh-empty, stale-nonempty, Refresh, and pre-existing tests pass.

- [ ] **Step 2: Replace the persistent-cache admission branch with the minimal state split**

```ts
function readPersistentMusicHomeCache(cacheKey: string, initialOnly = false, allowStale = true) {
    const startedAt = getMusicPerformanceNow();
    const storageKey = getMusicHomeStorageKey(cacheKey, initialOnly);
    const entry = readPtvLocalStorageJson<MusicHomeCacheEntry | null>(storageKey, null);
    const homeCacheReadMs = Number((getMusicPerformanceNow() - startedAt).toFixed(1));
    const isFresh = Boolean(entry && entry.expiresAt > Date.now());
    const hasValidEntry = Boolean(
        entry?.schemaVersion === MUSIC_HOME_PERSISTENT_CACHE_SCHEMA_VERSION
        && entry.data
        && canUseMusicHomeCache(entry.data)
    );
    const isStaleConfirmedEmpty = Boolean(
        hasValidEntry
        && !isFresh
        && isConfirmedEmptyMusicHomeCache(entry!.data)
    );
    const canReadEntry = Boolean(
        hasValidEntry
        && (isFresh || (allowStale && !isStaleConfirmedEmpty))
    );

    if (canReadEntry) {
        const activeCache = initialOnly ? musicHomeSummaryCache : musicHomeCache;
        activeCache.set(cacheKey, {
            ...entry!,
            expiresAt: isFresh ? entry!.expiresAt : Date.now() + 1000
        });
        recordPtvEvent('cache', 'music-home-persistent-cache-hit', {
            cacheAgeMs: Math.max(0, Date.now() - entry!.data.generatedAt),
            completeness: entry!.data.completeness || null,
            homeCacheHit: true,
            homeCacheReadMs,
            initialOnly,
            itemCount: getMusicHomeItemCount(entry!.data),
            staleHit: !isFresh,
            sectionCount: entry!.data.sections.length
        });
        return entry!.data;
    }

    if (isStaleConfirmedEmpty && allowStale) {
        recordPtvEvent('cache', 'music-home-persistent-cache-miss', {
            homeCacheHit: false,
            homeCacheReadMs,
            initialOnly,
            reason: 'stale-confirmed-empty'
        });
        return null;
    }

    if (entry) removePtvLocalStorageKey(storageKey);
    recordPtvEvent('cache', 'music-home-persistent-cache-miss', {
        homeCacheHit: false,
        homeCacheReadMs,
        initialOnly,
        reason: entry ? 'expired-invalid-or-empty' : 'missing'
    });
    return null;
}
```

- [ ] **Step 3: Run the focused Music cache test file**

Run: `npx vitest run --config vite.config.ts src/ptv/modules/music/musicApiRequests.test.ts`

Expected: PASS. The stale-empty recovery test observes live transport and overwritten persistent data; the failed-live-request test observes the exact original JSON still present.

- [ ] **Step 4: Run adjacent Music snapshot tests**

Run: `npx vitest run --config vite.config.ts src/ptv/modules/music/musicApiRequests.test.ts src/ptv/modules/music/musicApi.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the implementation**

```bash
git add src/ptv/modules/music/musicApi.ts
git commit -m "fix: refresh stale empty music home cache"
```

### Task 3: Review the Web diff and run focused build gates

**Files:**

- Verify: `src/ptv/modules/music/musicApi.ts`, `src/ptv/modules/music/musicApiRequests.test.ts`

**Interfaces:**

- Consumes: the final Music cache diff and repository quality scripts.
- Produces: a checked Music implementation ready for the shared release plan. The shared release owns the sole Web version bump and final Atlas actual-diff decision.

- [ ] **Step 1: Review the scoped diff against the approved Atlas record**

Run: `git show --stat --oneline HEAD~2..HEAD`

Run: `git diff HEAD~2..HEAD -- src/ptv/modules/music/musicApi.ts src/ptv/modules/music/musicApiRequests.test.ts`

Expected: only stale confirmed-empty cache admission and its five tests changed. Stop on any new owner, route, schema, TTL, storage key, retry, or destructive cache behavior; the shared release plan owns the final cross-subsystem Atlas reconciliation.

- [ ] **Step 2: Run required quality and build gates**

Run: `npm run build:check`

Expected: PASS with no TypeScript errors.

Run: `npm run lint:ptv`

Expected: PASS under the repository’s established PTV quality baseline.

Run: `npm run build:production`

Expected: PASS; only pre-existing documented bundle-size warnings are acceptable.

- [ ] **Step 3: Review scope and secrets**

Run: `git diff --check`

Expected: PASS with no whitespace errors.

Run: `npm run secret:scan`

Expected: PASS with no credential or private-media data added.

- [ ] **Step 4: Leave versioning and release metadata untouched**

Run: `git status --short`

Expected: no uncommitted Music files and no change to `ptv-version.json`. Do not run `npm run version:ptv:bump` in this subplan.

### Task 4: Restore and validate the existing Music mount before release deployment

**Files:**

- Verify only: existing host systemd automount/mount configuration, VM115 VirtioFS mapping, existing Jellyfin Music library configuration, and a representative already-indexed music file.

**Interfaces:**

- Consumes: the pre-existing host T7 automount/mount unit and device UUID, guest path `/mnt/ptv-media/_External/T7/Music`, and Jellyfin’s existing Music library ID/path.
- Produces: evidence that the same host filesystem is mounted, the same guest path is available through VirtioFS, Jellyfin can read it, and the existing Music library remains unchanged.

- [ ] **Step 1: Capture the known-good deployment rollback artifact before any runtime activation**

Record the currently deployed Web bundle identifier, the current PiggieTV Plugin payload identifier, the current Music library ID/path, and the existing host mount-unit/UUID evidence. Keep the current Web bundle, plugin DLL/payload, and compatible configuration available. Do not alter files, media, database, mount configuration, library configuration, or service state in this step.

- [ ] **Step 2: Discover and record the existing host mount chain without changing it**

Run on the host: `systemctl list-unit-files --type=automount --type=mount --no-legend`

Run on the host: `findmnt --list --output TARGET,SOURCE,FSTYPE,UUID`

Run on the host: `lsblk --fs --output NAME,FSTYPE,LABEL,UUID,MOUNTPOINTS`

Expected: identify one existing automount/mount pair whose configured target is the host T7 location and whose UUID matches the expected T7 device UUID retained by the current system. If either the existing unit pair or expected UUID cannot be identified from these commands and the known-good baseline, stop. Do not guess a unit name, create a unit, edit `/etc/fstab`, or mount an unverified device.

- [ ] **Step 3: Activate only the discovered existing automount or mount unit**

Use the exact unit name recorded in Step 2 with `systemctl start`; if the existing configuration is an automount, access its configured target once to trigger the existing mount rather than replacing it with a manual mount command.

Expected: `systemctl status` for the recorded units shows the existing configuration active and `findmnt` reports the recorded expected UUID at the recorded target. If activation fails, reports another UUID, or mounts at a different target, stop and preserve `systemctl status` and `journalctl -u` evidence. Do not change configuration or retry with a different device.

- [ ] **Step 4: Verify the host directory and guest VirtioFS path**

Run `find` with the exact target reported by the verified Step 3 `findmnt` record, using `-maxdepth 1 -mindepth 1 -type d -name Music -print -quit`.

Run in VM115: `findmnt --target /mnt/ptv-media`

Run in VM115: `test -d /mnt/ptv-media/_External/T7/Music && printf '%s\n' mounted`

Expected: the host prints exactly its existing `Music` directory, the VM reports its existing VirtioFS mapping, and the VM prints `mounted`. If any result is absent or points to another source, stop; do not modify VirtioFS or mount mappings.

- [ ] **Step 5: Verify Jellyfin account traversal and a representative read**

Run in VM115 without printing the private media path:

```bash
sample="$(sudo -u jellyfin find /mnt/ptv-media/_External/T7/Music -type f -readable -print -quit)"
test -n "$sample"
sudo -u jellyfin head -c 1 -- "$sample" >/dev/null
printf 'JELLYFIN_MUSIC_READ=PASS\n'
```

Expected: the Jellyfin account performs an actual one-byte read and prints only the PASS marker. If no readable file exists or the read exits unsuccessfully, stop and preserve the error without recording the filename; do not change ownership, ACLs, or media files.

- [ ] **Step 6: Verify the existing library identity before any Web or Plugin deployment**

Using the Jellyfin administration UI or authenticated API already used by the production baseline, record the existing Music library ID and require its sole configured path to equal `/mnt/ptv-media/_External/T7/Music`.

Expected: the same library ID and path captured in Step 1. If either differs, stop. Do not edit library definitions, trigger a scan, or restart Jellyfin.

- [ ] **Step 7: Commit no infrastructure change**

No commit is made: this task is runtime verification and restoration only. Attach the captured evidence to the deployment record.

### Task 5: Hand the verified Music change to the shared release

**Files:**

- Verify only: the completed Music commits and Task 4 mount evidence.

**Interfaces:**

- Consumes: the green Music code/tests and restored mount evidence.
- Produces: exact inputs for the shared release plan; no version bump, artifact deployment, or production restart occurs here.

- [ ] **Step 1: Record the two Music commits and the mount evidence in the shared release implementation report.**
- [ ] **Step 2: Continue with `2026-09-20-ptv-stabilization-release-validation.md`; it performs the sole Web version bump, paired Web/Plugin deployment, one restart, and production Music acceptance.**
- [ ] **Step 3: Do not commit or mutate production state in this handoff task.**

## Final Verification Matrix

- [ ] `npx vitest run --config vite.config.ts src/ptv/modules/music/musicApiRequests.test.ts`
- [ ] `npx vitest run --config vite.config.ts src/ptv/modules/music/musicApiRequests.test.ts src/ptv/modules/music/musicApi.test.ts`
- [ ] `npm run build:check`
- [ ] `npm run lint:ptv`
- [ ] `npm run build:production`
- [ ] `git diff --check`
- [ ] `npm run secret:scan`
- [ ] Host expected-UUID mount, host `Music` directory, guest VirtioFS, Jellyfin readable-file, and unchanged library-ID/path evidence
- [ ] Shared release plan records signed-in Music normal-reload population, reload persistence, artist navigation, album navigation, and track playback without manual Refresh
