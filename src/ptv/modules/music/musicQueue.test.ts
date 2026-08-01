import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queueMocks = vi.hoisted(() => ({
    apiClient: {
        accessToken: vi.fn(() => 'test-token'),
        deviceId: vi.fn(() => 'test-device'),
        getCurrentUserId: vi.fn(() => 'test-user'),
        getUrl: vi.fn((path: string) => `https://media.invalid/${path}`),
        reportPlaybackProgress: vi.fn(async () => undefined),
        reportPlaybackStart: vi.fn(async () => undefined),
        reportPlaybackStopped: vi.fn(async () => undefined)
    },
    identity: {
        serverId: 'test-server',
        userId: 'test-user'
    }
}));

vi.mock('../../api', () => ({
    getPtvApiClient: vi.fn(() => queueMocks.apiClient),
    getPtvCurrentUserId: vi.fn(() => queueMocks.identity.userId),
    getPtvServerId: vi.fn(() => queueMocks.identity.serverId)
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn()
}));

vi.mock('./musicPlaylists', () => ({
    savePtvMusicPlaylist: vi.fn()
}));

import {
    addPtvMusicToQueue,
    getPtvMusicQueueSnapshot,
    nextPtvMusicTrack,
    openPtvMusicPlayer,
    pausePtvMusicPlayback,
    playPtvMusicTracks,
    movePtvMusicQueueItem,
    removePtvMusicQueueItem,
    setPtvMusicVirtualQueue,
    stopPtvMusicPlayback,
    subscribeToPtvMusicQueue,
    togglePtvMusicShuffle
} from './musicQueue';
import {
    getPtvMusicContinuityStorageKey,
    loadPtvMusicContinuity
} from './musicContinuity';

describe('native Music queue subscriptions', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        if (getPtvMusicQueueSnapshot().currentItem) {
            void stopPtvMusicPlayback('test-cleanup');
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
        queueMocks.identity.serverId = 'test-server';
        queueMocks.identity.userId = 'test-user';
        queueMocks.apiClient.reportPlaybackStopped.mockClear();
        window.localStorage.clear();
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

    it('keeps track transitions separate from explicit player navigation', async () => {
        let paused = true;

        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
            paused = false;
            Object.defineProperty(this, 'paused', {
                configurable: true,
                get: () => paused
            });
            return Promise.resolve();
        });
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
            paused = true;
        });
        window.location.hash = '#/music/artist/artist-one';

        await playPtvMusicTracks([
            { Id: 'track-one', MediaType: 'Audio', Name: 'Track One', Type: 'Audio' },
            { Id: 'track-two', MediaType: 'Audio', Name: 'Track Two', Type: 'Audio' }
        ], 0);
        await nextPtvMusicTrack();

        expect(getPtvMusicQueueSnapshot().currentItem?.Id).toBe('track-two');
        expect(window.location.hash).toBe('#/music/artist/artist-one');

        openPtvMusicPlayer('test-explicit-player-button');
        expect(window.location.hash).toBe('#/music/player');
    });

    it('keeps explicit upcoming tracks ahead of progressively generated related items', async () => {
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        const firstTrack = { Id: 'track-one', MediaType: 'Audio', Name: 'Track One', Type: 'Audio' };
        const secondTrack = { Id: 'track-two', MediaType: 'Audio', Name: 'Track Two', Type: 'Audio' };
        const relatedTrack = { Id: 'track-three', MediaType: 'Audio', Name: 'Track Three', Type: 'Audio' };

        await playPtvMusicTracks([firstTrack, secondTrack], 0, {
            queueSourceLabel: 'Album'
        });
        setPtvMusicVirtualQueue(firstTrack, [relatedTrack], 'player-related');

        const snapshot = getPtvMusicQueueSnapshot();

        expect(snapshot.playlist.map(item => item.Id)).toEqual(['track-one', 'track-two']);
        expect(snapshot.queueSourceLabel).toBe('Album');
    });

    it('returns queue snapshots by value and protects the current item from queue removal', async () => {
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);

        await playPtvMusicTracks([
            { Id: 'track-one', MediaType: 'Audio', Name: 'Track One', Type: 'Audio' },
            { Id: 'track-two', MediaType: 'Audio', Name: 'Track Two', Type: 'Audio' }
        ]);
        const exposed = getPtvMusicQueueSnapshot();
        const currentPlaylistItemId = exposed.playlist[0].PlaylistItemId;

        exposed.playlist.pop();
        exposed.currentItem!.Name = 'Changed outside owner';
        await removePtvMusicQueueItem(currentPlaylistItemId || '');

        expect(getPtvMusicQueueSnapshot().playlist.map(item => item.Id)).toEqual([
            'track-one',
            'track-two'
        ]);
        expect(getPtvMusicQueueSnapshot().currentItem?.Name).toBe('Track One');
    });

    it('does not resurrect queue mutations when shuffle is disabled', async () => {
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);

        await playPtvMusicTracks([
            { Id: 'track-one', MediaType: 'Audio', Name: 'Track One', Type: 'Audio' },
            { Id: 'track-two', MediaType: 'Audio', Name: 'Track Two', Type: 'Audio' },
            { Id: 'track-three', MediaType: 'Audio', Name: 'Track Three', Type: 'Audio' }
        ]);
        togglePtvMusicShuffle();
        const removable = getPtvMusicQueueSnapshot().playlist.find((_, index) => index !== 0)!;

        await removePtvMusicQueueItem(removable.PlaylistItemId || '');
        await addPtvMusicToQueue({
            Id: 'track-four',
            MediaType: 'Audio',
            Name: 'Track Four',
            Type: 'Audio'
        });
        togglePtvMusicShuffle();

        const ids = getPtvMusicQueueSnapshot().playlist.map(item => item.Id);

        expect(ids).not.toContain(removable.Id);
        expect(ids).toContain('track-four');
    });

    it('retires an active queue when the server/user identity changes', async () => {
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);

        await playPtvMusicTracks([
            { Id: 'track-one', MediaType: 'Audio', Name: 'Track One', Type: 'Audio' }
        ]);

        queueMocks.identity.userId = 'different-user';

        expect(getPtvMusicQueueSnapshot()).toMatchObject({
            currentIndex: -1,
            currentItem: null,
            playlist: []
        });
    });

    it('retires deferred queue and history persistence when identity changes', async () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        const oldScope = {
            serverId: queueMocks.identity.serverId,
            userId: queueMocks.identity.userId
        };

        await playPtvMusicTracks([{
            Id: 'private-track',
            MediaType: 'Audio',
            Name: 'Private Track',
            RunTimeTicks: 180 * 10_000_000,
            Type: 'Audio'
        }]);
        const audio = document.querySelector<HTMLAudioElement>('[data-ptv-music-native-player="true"]')!;

        audio.currentTime = 40;
        const pauseRequest = pausePtvMusicPlayback('identity-retirement-test');

        queueMocks.identity.userId = 'next-user';
        getPtvMusicQueueSnapshot();
        await pauseRequest;
        await Promise.resolve();
        await Promise.resolve();
        vi.runAllTimers();
        await Promise.resolve();

        const oldDocument = loadPtvMusicContinuity(oldScope);
        const oldStorageKey = getPtvMusicContinuityStorageKey(oldScope) || '';

        expect(oldDocument?.recentTracks || []).toEqual([]);
        expect(window.localStorage.getItem(oldStorageKey)).toBeNull();
    });

    it('continues queue playback after ownership pause then ended', async () => {
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
        expect(playSpy).toHaveBeenCalledTimes(1);
        expect(getPtvMusicQueueSnapshot().currentItem?.Id).toBe('track-one');

        await pausePtvMusicPlayback('jellyfin-video-start');
        expect(getPtvMusicQueueSnapshot().currentItem?.Id).toBe('track-one');

        const audio = document.querySelector<HTMLAudioElement>('[data-ptv-music-native-player="true"]');

        expect(audio).not.toBeNull();

        audio!.dispatchEvent(new Event('ended'));

        await Promise.resolve();

        expect(getPtvMusicQueueSnapshot()).toMatchObject({
            currentIndex: 1,
            isPlaying: true,
            currentItem: { Id: 'track-two' }
        });
        expect(playSpy).toHaveBeenCalledTimes(2);
        expect(loadSpy).toHaveBeenCalledTimes(2);
        expect(pauseSpy).toHaveBeenCalled();
    });

    it('suppresses a duplicate ended event before it can skip another queue item', async () => {
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
        const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);

        await playPtvMusicTracks([
            { Id: 'track-one', MediaType: 'Audio', Name: 'Track One', Type: 'Audio' },
            { Id: 'track-two', MediaType: 'Audio', Name: 'Track Two', Type: 'Audio' },
            { Id: 'track-three', MediaType: 'Audio', Name: 'Track Three', Type: 'Audio' }
        ]);
        const audio = document.querySelector<HTMLAudioElement>('[data-ptv-music-native-player="true"]')!;

        audio.dispatchEvent(new Event('ended'));
        audio.dispatchEvent(new Event('ended'));
        await Promise.resolve();

        expect(getPtvMusicQueueSnapshot()).toMatchObject({
            currentIndex: 1,
            currentItem: { Id: 'track-two' }
        });
        expect(playSpy).toHaveBeenCalledTimes(2);
    });

    it('advances when queue is reordered without reloading playback', async () => {
        let paused = true;
        const loadSpy = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
        const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
            paused = false;
            Object.defineProperty(this, 'paused', {
                configurable: true,
                get: () => paused
            });
            return Promise.resolve();
        });
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
            paused = true;
            Object.defineProperty(this, 'paused', {
                configurable: true,
                get: () => paused
            });
        });

        await playPtvMusicTracks([
            { Id: 'track-one', MediaType: 'Audio', Name: 'Track One', Type: 'Audio' },
            { Id: 'track-two', MediaType: 'Audio', Name: 'Track Two', Type: 'Audio' },
            { Id: 'track-three', MediaType: 'Audio', Name: 'Track Three', Type: 'Audio' }
        ], 1);

        const snapshot = getPtvMusicQueueSnapshot();
        const currentPlaylistItemId = snapshot.playlist[snapshot.currentIndex]?.PlaylistItemId;

        expect(snapshot.currentItem?.Id).toBe('track-two');
        expect(currentPlaylistItemId).toBeTruthy();

        if (!currentPlaylistItemId) {
            throw new Error('Expected a current playlist item id.');
        }

        await movePtvMusicQueueItem(currentPlaylistItemId, 0);

        const audio = document.querySelector<HTMLAudioElement>('[data-ptv-music-native-player="true"]');
        expect(audio).not.toBeNull();

        audio!.dispatchEvent(new Event('ended'));

        await Promise.resolve();

        expect(getPtvMusicQueueSnapshot()).toMatchObject({
            currentIndex: 1,
            isPlaying: true,
            currentItem: { Id: 'track-one' }
        });
        expect(loadSpy).toHaveBeenCalledTimes(2);
        expect(playSpy).toHaveBeenCalledTimes(2);
    });

    it('skips non-track records before a natural virtual-queue transition', async () => {
        let paused = true;

        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
        const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
            paused = false;
            Object.defineProperty(this, 'paused', {
                configurable: true,
                get: () => paused
            });
            return Promise.resolve();
        });
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
            paused = true;
        });

        const firstTrack = { Id: 'track-one', MediaType: 'Audio', Name: 'Track One', Type: 'Audio' };
        const nextTrack = { Id: 'track-two', MediaType: 'Audio', Name: 'Track Two', Type: 'Audio' };

        await playPtvMusicTracks([firstTrack], 0);
        setPtvMusicVirtualQueue(firstTrack, [
            { Id: 'album-one', MediaType: 'Audio', Name: 'Album One', Type: 'MusicAlbum' },
            { Id: 'artist-one', Name: 'Artist One', Type: 'MusicArtist' },
            nextTrack
        ], 'player-related');

        const audio = document.querySelector<HTMLAudioElement>('[data-ptv-music-native-player="true"]');

        expect(audio).not.toBeNull();
        audio!.dispatchEvent(new Event('ended'));
        await Promise.resolve();

        expect(getPtvMusicQueueSnapshot()).toMatchObject({
            currentItem: { Id: 'track-two', Type: 'Audio' },
            isPlaying: true
        });
        expect(getPtvMusicQueueSnapshot().playlist.map(item => item.Id)).toEqual(['track-one', 'track-two']);
        expect(playSpy).toHaveBeenCalledTimes(2);
    });
});
