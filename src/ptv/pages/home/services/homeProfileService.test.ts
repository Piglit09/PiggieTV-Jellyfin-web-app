import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadNativeHomeProfile, saveNativeHomeProfile, type NativeHomeProfile } from './homeProfileService';

vi.mock('../../../api', () => ({ getPtvServerId: () => 'server-a' }));

const createProfile = (serverId: string, userId: string) => ({
    context: { isWeekend: false, timeOfDay: 'morning' },
    continueCounts: { listening: 0, reading: 0, watching: 0 },
    favoriteCount: 0,
    mediaCounts: {},
    mood: 'balanced',
    moodConfidence: 0,
    moodSignals: [],
    profileVersion: 2,
    seasonal: {},
    serverId,
    topArtists: [],
    topAuthors: [],
    topGenres: [],
    topStudios: [],
    updatedAt: 1,
    userId
}) as unknown as NativeHomeProfile;

describe('native Home profile identity persistence', () => {
    beforeEach(() => window.localStorage.clear());

    it('keeps profiles isolated across A to B to A', () => {
        const profileA = createProfile('Server', 'User-A');
        const profileB = createProfile('Server', 'User-B');
        expect(saveNativeHomeProfile(profileA)).toBe(true);
        expect(saveNativeHomeProfile(profileB)).toBe(true);
        expect(loadNativeHomeProfile('server', 'user-b')).toEqual(profileB);
        expect(loadNativeHomeProfile('server', 'user-a')).toEqual(profileA);
    });

    it('rejects missing or mismatched identity state', () => {
        expect(saveNativeHomeProfile(createProfile('', 'user-a'))).toBe(false);
        window.localStorage.setItem(
            'ptv.home.profile.v2:server:user-b',
            JSON.stringify(createProfile('server', 'user-a'))
        );
        expect(loadNativeHomeProfile('server', 'user-b')).toBeNull();
    });
});
