import { afterEach, describe, expect, it } from 'vitest';

import {
    abortPtvMusicRouteWork,
    beginPtvMusicRouteWork,
    createPtvMusicRouteWork,
    getPtvMusicRouteWorkSnapshot,
    isPtvMusicRouteWorkCurrent,
    retirePtvMusicRouteWork,
    settlePtvMusicRouteWork
} from './musicRouteWork';

const TEST_OWNER = 'music-route-test';

afterEach(() => {
    abortPtvMusicRouteWork(TEST_OWNER);
});

describe('PiggieTV Music route work ownership', () => {
    it('aborts the prior generation when a refresh supersedes it', () => {
        const firstSignal = createPtvMusicRouteWork(TEST_OWNER);
        const secondSignal = createPtvMusicRouteWork(TEST_OWNER);

        expect(firstSignal.aborted).toBe(true);
        expect(secondSignal.aborted).toBe(false);
        expect(getPtvMusicRouteWorkSnapshot().activeRouteWorkOwners).toContain(TEST_OWNER);
    });

    it('aborts and releases route work on exit', () => {
        const signal = createPtvMusicRouteWork(TEST_OWNER);

        expect(abortPtvMusicRouteWork(TEST_OWNER)).not.toBeNull();
        expect(signal.aborted).toBe(true);
        expect(getPtvMusicRouteWorkSnapshot().activeRouteWorkOwners).not.toContain(TEST_OWNER);
        expect(abortPtvMusicRouteWork(TEST_OWNER)).toBeNull();
    });

    it('uses identity and generation to reject a superseded sub-route response', () => {
        const first = beginPtvMusicRouteWork(TEST_OWNER, 'server-a:user-a:artist-1');
        const second = beginPtvMusicRouteWork(TEST_OWNER, 'server-a:user-a:artist-2');

        expect(first.signal.aborted).toBe(true);
        expect(isPtvMusicRouteWorkCurrent(first)).toBe(false);
        expect(isPtvMusicRouteWorkCurrent(second)).toBe(true);
        expect(retirePtvMusicRouteWork(first)).toBeNull();
        expect(second.signal.aborted).toBe(false);
    });

    it('settles only the active generation without aborting its completed signal', () => {
        const work = beginPtvMusicRouteWork(TEST_OWNER, 'server:user:search:term');

        expect(settlePtvMusicRouteWork(work)).toBe(true);
        expect(work.signal.aborted).toBe(false);
        expect(isPtvMusicRouteWorkCurrent(work)).toBe(false);
        expect(settlePtvMusicRouteWork(work)).toBe(false);
    });
});
