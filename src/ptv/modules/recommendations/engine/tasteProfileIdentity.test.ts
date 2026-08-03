import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../api', () => ({
    getPtvCurrentUserId: () => '',
    getPtvServerId: () => ''
}));

vi.mock('../debug/recommendationRuntimeDebug', () => ({
    logPtvRecommendationFailure: vi.fn()
}));

import { buildPtvTasteProfile, loadPtvTasteProfile, savePtvTasteProfile } from './tasteProfile';

describe('taste profile identity persistence', () => {
    beforeEach(() => window.localStorage.clear());

    it('keeps recommendation signals isolated across A to B to A', () => {
        const profileA = buildPtvTasteProfile([], { serverId: 'Server', userId: 'User-A' });
        const profileB = buildPtvTasteProfile([], { serverId: 'Server', userId: 'User-B' });
        expect(savePtvTasteProfile(profileA)).toBe(true);
        expect(savePtvTasteProfile(profileB)).toBe(true);
        expect(loadPtvTasteProfile('server', 'user-b')).toEqual(profileB);
        expect(loadPtvTasteProfile('server', 'user-a')).toEqual(profileA);
    });

    it('rejects unscoped and poisoned persisted profiles', () => {
        expect(savePtvTasteProfile(buildPtvTasteProfile([], { serverId: '', userId: 'user-a' }))).toBe(false);
        window.localStorage.setItem(
            'ptv.recommendations.profile.v2:server:user-b',
            JSON.stringify(buildPtvTasteProfile([], { serverId: 'server', userId: 'user-a' }))
        );
        expect(loadPtvTasteProfile('server', 'user-b')).toBeNull();
    });
});
