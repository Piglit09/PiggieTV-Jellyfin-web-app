import { afterEach, describe, expect, it, vi } from 'vitest';

const queueMocks = vi.hoisted(() => ({
    apiClient: {
        accessToken: vi.fn(() => 'test-token'),
        deviceId: vi.fn(() => 'test-device'),
        getCurrentUserId: vi.fn(() => 'test-user'),
        getUrl: vi.fn((path: string) => `https://media.invalid/${path}`),
        reportPlaybackProgress: vi.fn(async () => undefined),
        reportPlaybackStart: vi.fn(async () => undefined),
        reportPlaybackStopped: vi.fn(async () => undefined)
    }
}));

vi.mock('../../api', () => ({
    getPtvApiClient: vi.fn(() => queueMocks.apiClient),
    getPtvCurrentUserId: vi.fn(() => 'test-user')
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn()
}));

vi.mock('./musicPlaylists', () => ({
    savePtvMusicPlaylist: vi.fn()
}));

import {
    getPtvMusicQueueSnapshot,
    pausePtvMusicPlayback,
    playPtvMusicTracks,
    stopPtvMusicPlayback,
    subscribeToPtvMusicQueue
} from './musicQueue';

describe('native Music queue subscriptions', () => {
    afterEach(() => {
        if (getPtvMusicQueueSnapshot().currentItem) {
            void stopPtvMusicPlayback('test-cleanup');
        }
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

    it('pauses for video ownership without clearing the queue or playback position', async () => {
        let paused = true;
        const loadSpy = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
        const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
            paused = false;
            Object.defineProperty(this, 'paused', {
                configurable: true,
                get: () => paused
            });
            this.dispatchEvent(new Event('play'));
            return Promise.resolve();
        });
        const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
            paused = true;
            Object.defineProperty(this, 'paused', {
                configurable: true,
                get: () => paused
            });
            this.dispatchEvent(new Event('pause'));
        });
        const tracks = [
            { Id: 'track-one', MediaType: 'Audio', Name: 'Track One', Type: 'Audio' },
            { Id: 'track-two', MediaType: 'Audio', Name: 'Track Two', Type: 'Audio' }
        ];

        await playPtvMusicTracks(tracks, 0);
        const audio = document.querySelector<HTMLAudioElement>('[data-ptv-music-native-player="true"]');

        expect(audio).not.toBeNull();
        audio!.currentTime = 12;
        expect(getPtvMusicQueueSnapshot()).toMatchObject({
            currentIndex: 0,
            isPlaying: true
        });
        expect(getPtvMusicQueueSnapshot().playlist).toHaveLength(2);

        await pausePtvMusicPlayback('jellyfin-video-start');
        const pausedSnapshot = getPtvMusicQueueSnapshot();

        expect(pausedSnapshot).toMatchObject({
            currentIndex: 0,
            isPlaying: false,
            positionTicks: 120_000_000
        });
        expect(pausedSnapshot.currentItem?.Id).toBe('track-one');
        expect(pausedSnapshot.playlist.map(item => item.Id)).toEqual(['track-one', 'track-two']);
        expect(playSpy).toHaveBeenCalledTimes(1);
        expect(pauseSpy).toHaveBeenCalled();
        expect(loadSpy).toHaveBeenCalled();
    });
});
