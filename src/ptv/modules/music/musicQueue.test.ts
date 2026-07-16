import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
    getPtvApiClient: vi.fn(() => null),
    getPtvCurrentUserId: vi.fn(() => '')
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn()
}));

vi.mock('./musicPlaylists', () => ({
    savePtvMusicPlaylist: vi.fn()
}));

import { subscribeToPtvMusicQueue } from './musicQueue';

describe('native Music queue subscriptions', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('uses native queue events without creating one polling interval per subscriber', () => {
        vi.useFakeTimers();
        vi.setSystemTime(10_000);
        const intervalSpy = vi.spyOn(window, 'setInterval');
        const listener = vi.fn();
        const unsubscribe = subscribeToPtvMusicQueue(listener);
        const audio = document.querySelector<HTMLAudioElement>('[data-ptv-music-native-player="true"]');

        expect(audio).not.toBeNull();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(intervalSpy).not.toHaveBeenCalled();

        audio!.dispatchEvent(new Event('timeupdate'));
        expect(listener).toHaveBeenCalledTimes(2);

        vi.setSystemTime(10_500);
        audio!.dispatchEvent(new Event('timeupdate'));
        expect(listener).toHaveBeenCalledTimes(2);

        vi.setSystemTime(11_001);
        audio!.dispatchEvent(new Event('timeupdate'));
        expect(listener).toHaveBeenCalledTimes(3);

        unsubscribe();
    });
});
