import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfiguredRowFreshnessSnapshot } from './configuredRowFreshness';
import { getHomeLibraryAuthoritySnapshot, retireHomeLibraryAuthority, subscribeHomeLibraryAuthority, beginHomeLibraryVerification, acceptHomeLibraryAuthority, observeHomeLibraryAuthority } from './homeLibraryTransitionFreshness';

const retirementHintKey = 'ptv-home-library-retired-v1';
const clearRetirementHints = () => {
    window.localStorage.removeItem(retirementHintKey);
    for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith('ptv-home-user-access-retired-v1:')) window.localStorage.removeItem(key);
    }
};
const statusFor = (epoch: string, held = false) => ({
    currentHomeTopology: { version: 1, epoch, held },
    currentHomeUserAccess: { version: 1, userId: 'identity', accessEpoch: 'c'.repeat(64),
        held: false, policyProven: true }
});
beforeEach(clearRetirementHints);
afterEach(clearRetirementHints);

describe('library-only Home transition retirement', () => {
    it('keeps a first-install account unverified when topology is current but user access proof is absent', async () => {
        vi.resetModules();
        const transition = await import('./homeLibraryTransitionFreshness');
        const revision = transition.beginHomeLibraryVerification(`server:${'1'.repeat(32)}`);
        const status = { currentHomeTopology: { version: 1, epoch: 'a'.repeat(64), held: false } };
        expect(transition.acceptHomeLibraryAuthority(status, revision, `server:${'1'.repeat(32)}`)).toBeNull();
    });

    it('rejects an unproven or mismatched user even when the topology and previous owned row are current', async () => {
        vi.resetModules();
        const transition = await import('./homeLibraryTransitionFreshness');
        const identity = `server:${'1'.repeat(32)}`;
        const current = { currentHomeTopology: { version: 1, epoch: 'a'.repeat(64), held: false },
            currentHomeUserAccess: { version: 1, userId: '1'.repeat(32), accessEpoch: 'b'.repeat(64),
                held: false, policyProven: true } };
        const revision = transition.beginHomeLibraryVerification(identity);
        expect(transition.acceptHomeLibraryAuthority(current, revision, identity)).toEqual(current.currentHomeTopology);
        for (const userAccess of [
            { ...current.currentHomeUserAccess, held: true },
            { ...current.currentHomeUserAccess, policyProven: false },
            { ...current.currentHomeUserAccess, userId: '2'.repeat(32) },
            { ...current.currentHomeUserAccess, accessEpoch: 'c'.repeat(64) }
        ]) {
            transition.observeHomeLibraryAuthority({ ...current, currentHomeUserAccess: userAccess });
            expect(transition.isHomeLibraryAuthorityRetired()).toBe(true);
        }
    });

    it('accepts a fresh user access epoch after a controlled existing-user write without a topology change', async () => {
        vi.resetModules();
        const transition = await import('./homeLibraryTransitionFreshness');
        const identity = `server:${'1'.repeat(32)}`;
        const old = { currentHomeTopology: { version: 1, epoch: 'a'.repeat(64), held: false },
            currentHomeUserAccess: { version: 1, userId: '1'.repeat(32), accessEpoch: 'b'.repeat(64),
                held: false, policyProven: true } };
        const first = transition.beginHomeLibraryVerification(identity);
        expect(transition.acceptHomeLibraryAuthority(old, first, identity)).toEqual(old.currentHomeTopology);
        transition.retireHomeUserAccessAuthority('1'.repeat(32), 'controlled-user-access');
        const next = transition.beginHomeLibraryVerification(identity);
        expect(transition.acceptHomeLibraryAuthority(old, next, identity)).toBeNull();
        const completed = { ...old, currentHomeUserAccess: { ...old.currentHomeUserAccess,
            accessEpoch: 'c'.repeat(64) } };
        expect(transition.acceptHomeLibraryAuthority(completed, next, identity)).toEqual(completed.currentHomeTopology);
    });
    it('targets a user access retirement to that account and leaves another account mounted', async () => {
        vi.resetModules();
        const transition = await import('./homeLibraryTransitionFreshness');
        const identity = `server:${'2'.repeat(32)}`;
        const status = { currentHomeTopology: { version: 1, epoch: 'a'.repeat(64), held: false },
            currentHomeUserAccess: { version: 1, userId: '2'.repeat(32), accessEpoch: 'b'.repeat(64),
                held: false, policyProven: true } };
        const revision = transition.beginHomeLibraryVerification(identity);
        expect(transition.acceptHomeLibraryAuthority(status, revision, identity)).toEqual(status.currentHomeTopology);
        transition.retireHomeUserAccessAuthority('1'.repeat(32), 'other-user-policy-write');
        expect(transition.isHomeLibraryAuthorityRetired()).toBe(false);
        transition.retireHomeUserAccessAuthority('2'.repeat(32), 'own-policy-write');
        expect(transition.isHomeLibraryAuthorityRetired()).toBe(true);
    });
    it('rebroadcasts a validated user-access Begin before the stock write and rejects the old ready epoch', async () => {
        vi.resetModules();
        const transition = await import('./homeLibraryTransitionFreshness');
        const identity = `server:${'1'.repeat(32)}`;
        const baseline = { currentHomeTopology: { version: 1, epoch: 'a'.repeat(64), held: false },
            currentHomeUserAccess: { version: 1, userId: '1'.repeat(32), accessEpoch: 'b'.repeat(64),
                held: false, policyProven: true } };
        const first = transition.beginHomeLibraryVerification(identity);
        expect(transition.acceptHomeLibraryAuthority(baseline, first, identity)).toEqual(baseline.currentHomeTopology);
        const writeHint = vi.spyOn(Storage.prototype, 'setItem');
        try {
            transition.retireHomeUserAccessAuthority('1'.repeat(32), 'before-access-begin');
            transition.acknowledgeHomeUserAccessBeginEpoch('1'.repeat(32), 'c'.repeat(64));
            expect(writeHint).toHaveBeenCalledTimes(2);
            const next = transition.beginHomeLibraryVerification(identity);
            expect(transition.acceptHomeLibraryAuthority(baseline, next, identity)).toBeNull();
            const completed = { ...baseline, currentHomeUserAccess: {
                ...baseline.currentHomeUserAccess, accessEpoch: 'c'.repeat(64) } };
            expect(transition.acceptHomeLibraryAuthority(completed, next, identity)).toEqual(completed.currentHomeTopology);
        } finally {
            writeHint.mockRestore();
        }
    });
    it('makes the second access hint distinct when an administrator changes another account in one clock tick', async () => {
        vi.resetModules();
        const transition = await import('./homeLibraryTransitionFreshness');
        const now = vi.spyOn(Date, 'now').mockReturnValue(123);
        const writeHint = vi.spyOn(Storage.prototype, 'setItem');
        try {
            transition.retireHomeUserAccessAuthority('1'.repeat(32), 'before-access-begin');
            transition.acknowledgeHomeUserAccessBeginEpoch('1'.repeat(32), 'c'.repeat(64));
            expect(writeHint).toHaveBeenCalledTimes(2);
            expect(writeHint.mock.calls[0]?.[1]).not.toBe(writeHint.mock.calls[1]?.[1]);
        } finally {
            writeHint.mockRestore();
            now.mockRestore();
        }
    });
    it('keeps a new visit held against an old unheld status during the pre-Begin gap', async () => {
        vi.resetModules();
        const transition = await import('./homeLibraryTransitionFreshness');
        const oldStatus = statusFor('a'.repeat(64));
        const first = transition.beginHomeLibraryVerification('identity');
        expect(transition.acceptHomeLibraryAuthority(oldStatus, first, 'identity')).not.toBeNull();
        transition.retireHomeLibraryAuthority('controlled-write');
        const next = transition.beginHomeLibraryVerification('identity');
        expect(transition.acceptHomeLibraryAuthority(oldStatus, next, 'identity')).toBeNull();
        expect(transition.isHomeLibraryAuthorityRetired()).toBe(true);
        const newStatus = statusFor('b'.repeat(64));
        expect(transition.acceptHomeLibraryAuthority(newStatus, next, 'identity')).toEqual(newStatus.currentHomeTopology);
        expect(transition.isHomeLibraryAuthorityRetired()).toBe(false);
    });
    it('fails closed without a prior epoch until it observes a held Begin epoch', async () => {
        vi.resetModules();
        const transition = await import('./homeLibraryTransitionFreshness');
        transition.retireHomeLibraryAuthority('controlled-write-without-mounted-home');
        const revision = transition.beginHomeLibraryVerification('identity');
        const unheld = statusFor('a'.repeat(64));
        expect(transition.acceptHomeLibraryAuthority(unheld, revision, 'identity')).toBeNull();
        expect(transition.isHomeLibraryAuthorityRetired()).toBe(true);
        const held = statusFor('b'.repeat(64), true);
        expect(transition.acceptHomeLibraryAuthority(held, revision, 'identity')).toBeNull();
        expect(transition.acceptHomeLibraryAuthority({ ...held, currentHomeTopology: { ...held.currentHomeTopology, held: false } },
            revision, 'identity')).toEqual({ ...held.currentHomeTopology, held: false });
    });
    it('recovers after an authenticated Begin when a tab misses the held interval', async () => {
        vi.resetModules();
        const transition = await import('./homeLibraryTransitionFreshness');
        transition.retireHomeLibraryAuthority('controlled-write-without-mounted-home');
        const revision = transition.beginHomeLibraryVerification('identity');
        const oldStatus = statusFor('a'.repeat(64));
        const newStatus = statusFor('b'.repeat(64));
        expect(transition.acceptHomeLibraryAuthority(oldStatus, revision, 'identity')).toBeNull();
        transition.acknowledgeHomeLibraryBeginEpoch(newStatus.currentHomeTopology.epoch);
        expect(transition.isHomeLibraryAuthorityRetired()).toBe(true);
        expect(transition.acceptHomeLibraryAuthority(newStatus, revision, 'identity')).toBeNull();
        const next = transition.beginHomeLibraryVerification('identity');
        expect(transition.acceptHomeLibraryAuthority(oldStatus, next, 'identity')).toBeNull();
        expect(transition.acceptHomeLibraryAuthority(newStatus, next, 'identity')).toEqual(newStatus.currentHomeTopology);
    });
    it('reads an existing same-origin retirement hint when a tab opens after the first broadcast', async () => {
        window.localStorage.setItem(retirementHintKey, 'already-pending');
        vi.resetModules();
        const transition = await import('./homeLibraryTransitionFreshness');
        transition.getHomeLibraryAuthoritySnapshot();
        expect(transition.isHomeLibraryAuthorityRetired()).toBe(true);
        const revision = transition.beginHomeLibraryVerification('identity');
        const oldStatus = statusFor('a'.repeat(64));
        expect(transition.acceptHomeLibraryAuthority(oldStatus, revision, 'identity')).toBeNull();
    });
    it('re-proves the same epoch after an ordinary status outage without inventing a controlled transition', async () => {
        vi.resetModules();
        const transition = await import('./homeLibraryTransitionFreshness');
        const status = statusFor('a'.repeat(64));
        const first = transition.beginHomeLibraryVerification('identity');
        expect(transition.acceptHomeLibraryAuthority(status, first, 'identity')).not.toBeNull();
        transition.observeHomeLibraryAuthority(null);
        expect(transition.isHomeLibraryAuthorityRetired()).toBe(true);
        const next = transition.beginHomeLibraryVerification('identity');
        expect(transition.acceptHomeLibraryAuthority(status, next, 'identity')).toEqual(status.currentHomeTopology);
    });
    it('retires memoized proof when a recheck changes epoch even if the pinned ID is unchanged', () => {
        const revision = beginHomeLibraryVerification('identity');
        acceptHomeLibraryAuthority(statusFor('a'.repeat(64)), revision, 'identity');
        expect(acceptHomeLibraryAuthority(statusFor('b'.repeat(64)), revision, 'identity')).toBeNull();
        expect(getHomeLibraryAuthoritySnapshot().revision).toBeGreaterThan(revision);
    });
    it('never lets ordinary status promote or a late final response restore retired proof', () => {
        const revision = beginHomeLibraryVerification('identity');
        const status = statusFor('a'.repeat(64));
        observeHomeLibraryAuthority(status);
        expect(getHomeLibraryAuthoritySnapshot().topology).toBeUndefined();
        retireHomeLibraryAuthority('controlled-write');
        expect(acceptHomeLibraryAuthority(status, revision, 'identity')).toBeNull();
    });
    it('retires a route locally without broadcasting a controlled-mutation hint to other tabs', () => {
        const writeHint = vi.spyOn(Storage.prototype, 'setItem');
        try {
            retireHomeLibraryAuthority('home-route-retired', { broadcast: false });
            expect(writeHint).not.toHaveBeenCalled();
        } finally {
            writeHint.mockRestore();
        }
    });
    it('retires synchronously without changing global presentation freshness', () => {
        const global = getConfiguredRowFreshnessSnapshot();
        const before = getHomeLibraryAuthoritySnapshot();
        const listener = vi.fn();
        const unsubscribe = subscribeHomeLibraryAuthority(listener);
        retireHomeLibraryAuthority('before-write');
        expect(getHomeLibraryAuthoritySnapshot().revision).toBe(before.revision + 1);
        expect(listener).toHaveBeenCalledOnce();
        expect(getConfiguredRowFreshnessSnapshot()).toBe(global);
        unsubscribe();
    });
    it('treats a same-origin message solely as another invalidation hint', () => {
        const before = getHomeLibraryAuthoritySnapshot();
        window.dispatchEvent(new StorageEvent('storage', { key: 'ptv-home-library-retired-v1', newValue: '{"held":false,"epoch":"forged"}' }));
        expect(getHomeLibraryAuthoritySnapshot()).toEqual({ revision: before.revision + 1, reason: 'same-origin-transition-hint' });
    });
});
