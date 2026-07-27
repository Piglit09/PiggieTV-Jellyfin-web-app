import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PtvMusicQueueSnapshot } from '../modules/music/musicTypes';

const playbackMocks = vi.hoisted(() => ({
    currentItem: null as Record<string, unknown> | null,
    currentPlayer: null as Record<string, unknown> | null,
    eventOff: vi.fn(),
    eventOn: vi.fn(),
    eventHandlers: new Map<string, () => void>(),
    incrementCounter: vi.fn(),
    pauseMusic: vi.fn(async () => undefined),
    playbackCommandHandler: null as ((command: string) => boolean) | null,
    playbackCommandUnregister: vi.fn(),
    queueListener: null as ((snapshot: PtvMusicQueueSnapshot) => void) | null,
    queueUnsubscribe: vi.fn(),
    toggleMusic: vi.fn(async () => undefined)
}));

vi.mock('../../scripts/inputManager', () => ({
    registerPlaybackCommandHandler: vi.fn((_owner: string, handler: (command: string) => boolean) => {
        playbackMocks.playbackCommandHandler = handler;
        return playbackMocks.playbackCommandUnregister;
    })
}));

vi.mock('../../components/playback/playbackmanager', () => ({
    playbackManager: {
        currentItem: vi.fn(() => playbackMocks.currentItem),
        getCurrentPlayer: vi.fn(() => playbackMocks.currentPlayer),
        getPlayerState: vi.fn(() => ({}))
    }
}));

vi.mock('../../utils/events', () => ({
    default: {
        off: playbackMocks.eventOff,
        on: playbackMocks.eventOn
    }
}));

vi.mock('../api', () => ({
    getPtvItemImageUrl: vi.fn(() => ''),
    playPtvItem: vi.fn(async () => undefined)
}));

vi.mock('../core/itemRoutes', () => ({
    recordPtvItemRouteClick: vi.fn(),
    resolvePtvItemRoute: vi.fn(() => ({ href: '#/music/item/track' }))
}));

vi.mock('../core/observability', () => ({
    recordPtvEvent: vi.fn()
}));

vi.mock('../modules/music/musicQueue', () => ({
    nextPtvMusicTrack: vi.fn(),
    openPtvMusicPlayer: vi.fn(),
    pausePtvMusicPlayback: playbackMocks.pauseMusic,
    previousPtvMusicTrack: vi.fn(),
    stopPtvMusicPlayback: vi.fn(),
    subscribeToPtvMusicQueue: vi.fn((listener: (snapshot: PtvMusicQueueSnapshot) => void) => {
        playbackMocks.queueListener = listener;

        return playbackMocks.queueUnsubscribe;
    }),
    togglePtvMusicPlayPause: playbackMocks.toggleMusic
}));

vi.mock('./performanceMonitor', () => ({
    incrementPtvPerformanceCounter: playbackMocks.incrementCounter,
    recordPtvPerformanceEntry: vi.fn(),
    setPtvPlaybackSubscriptionCount: vi.fn()
}));

import {
    disposePtvPlaybackStateServiceForTests,
    getPtvGlobalPlaybackState,
    startPtvPlaybackStateService
} from './playbackStateService';

function createMusicSnapshot(
    currentItem: PtvMusicQueueSnapshot['currentItem'],
    isPlaying = Boolean(currentItem)
): PtvMusicQueueSnapshot {
    return {
        autoQueueSeedItem: null,
        autoQueueSeedRevision: 0,
        currentIndex: currentItem ? 0 : -1,
        currentItem,
        isAudio: Boolean(currentItem),
        isMuted: false,
        isPlaying,
        isShuffled: false,
        playlist: currentItem ? [currentItem] : [],
        positionTicks: 0,
        repeatMode: 'RepeatNone',
        runtimeTicks: currentItem?.RunTimeTicks || 0,
        volumeLevel: 50
    };
}

describe('global playback state reconciliation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        playbackMocks.eventOff.mockClear();
        playbackMocks.eventOn.mockClear();
        playbackMocks.eventOn.mockImplementation((_target, name: string, handler: () => void) => {
            playbackMocks.eventHandlers.set(name, handler);
        });
        playbackMocks.eventHandlers.clear();
        playbackMocks.incrementCounter.mockClear();
        playbackMocks.pauseMusic.mockClear();
        playbackMocks.playbackCommandHandler = null;
        playbackMocks.playbackCommandUnregister.mockClear();
        playbackMocks.queueUnsubscribe.mockClear();
        playbackMocks.toggleMusic.mockClear();
        playbackMocks.queueListener = null;
        playbackMocks.currentItem = null;
        playbackMocks.currentPlayer = null;
        window.location.hash = '#/home';
    });

    afterEach(() => {
        disposePtvPlaybackStateServiceForTests();
        vi.useRealTimers();
    });

    it('uses queue events as authoritative and retires global playback listeners', () => {
        const intervalSpy = vi.spyOn(window, 'setInterval');

        startPtvPlaybackStateService();
        expect(intervalSpy).not.toHaveBeenCalled();
        expect(playbackMocks.eventOn).toHaveBeenCalledTimes(5);

        playbackMocks.queueListener?.(createMusicSnapshot({
            Id: 'track',
            MediaType: 'Audio',
            Name: 'Track',
            RunTimeTicks: 30_000_000,
            Type: 'Audio'
        }));
        playbackMocks.incrementCounter.mockClear();

        vi.advanceTimersByTime(3_100);
        expect(playbackMocks.incrementCounter).not.toHaveBeenCalledWith(
            'playbackEventsReceived',
            expect.objectContaining({ lastPlaybackEvent: 'low-frequency-reconcile' })
        );

        playbackMocks.queueListener?.(createMusicSnapshot(null));
        playbackMocks.incrementCounter.mockClear();
        vi.advanceTimersByTime(3_000);
        expect(playbackMocks.incrementCounter).not.toHaveBeenCalledWith(
            'playbackEventsReceived',
            expect.objectContaining({ lastPlaybackEvent: 'low-frequency-reconcile' })
        );

        disposePtvPlaybackStateServiceForTests();
        expect(playbackMocks.queueUnsubscribe).toHaveBeenCalledTimes(1);
        expect(playbackMocks.eventOff).toHaveBeenCalledTimes(5);
    });

    it('routes hardware play and pause through the existing input owner exactly once for PTV music', () => {
        const track = {
            Id: 'track',
            MediaType: 'Audio',
            Name: 'Track',
            RunTimeTicks: 30_000_000,
            Type: 'Audio'
        };

        startPtvPlaybackStateService();
        playbackMocks.queueListener?.(createMusicSnapshot(track, true));
        playbackMocks.playbackCommandHandler?.('pause');
        expect(playbackMocks.toggleMusic).toHaveBeenCalledTimes(1);

        playbackMocks.queueListener?.(createMusicSnapshot(track, false));
        playbackMocks.playbackCommandHandler?.('play');
        expect(playbackMocks.toggleMusic).toHaveBeenCalledTimes(2);

        playbackMocks.playbackCommandHandler?.('play');
        expect(playbackMocks.toggleMusic).toHaveBeenCalledTimes(3);

        playbackMocks.queueListener?.(createMusicSnapshot(track, true));
        playbackMocks.playbackCommandHandler?.('play');
        expect(playbackMocks.toggleMusic).toHaveBeenCalledTimes(3);
    });

    it('classifies the authoritative PTV music queue as audio when Jellyfin metadata is incomplete', () => {
        startPtvPlaybackStateService();
        playbackMocks.queueListener?.(createMusicSnapshot({
            Id: 'album-shaped-audio',
            Name: 'Queue item',
            RunTimeTicks: 30_000_000,
            Type: 'MusicAlbum'
        }, false));

        expect(getPtvGlobalPlaybackState()).toMatchObject({
            active: true,
            itemType: 'MusicAlbum',
            mediaType: 'Audio',
            paused: true,
            source: 'ptv-music'
        });
    });

    it('polls only while a Jellyfin playback source is active', () => {
        const intervalSpy = vi.spyOn(window, 'setInterval');

        startPtvPlaybackStateService();
        playbackMocks.currentPlayer = {};
        playbackMocks.currentItem = {
            Id: 'video',
            MediaType: 'Video',
            Name: 'Video',
            Type: 'Movie'
        };
        playbackMocks.eventHandlers.get('playbackstart')?.();
        vi.advanceTimersByTime(80);

        expect(intervalSpy).toHaveBeenCalledTimes(1);
        playbackMocks.incrementCounter.mockClear();
        vi.advanceTimersByTime(1_000);
        expect(playbackMocks.incrementCounter).toHaveBeenCalledWith(
            'playbackEventsReceived',
            expect.objectContaining({ lastPlaybackEvent: 'low-frequency-reconcile' })
        );

        playbackMocks.currentItem = null;
        playbackMocks.currentPlayer = null;
        playbackMocks.eventHandlers.get('playbackstop')?.();
        vi.advanceTimersByTime(80);
        playbackMocks.incrementCounter.mockClear();
        vi.advanceTimersByTime(3_000);
        expect(playbackMocks.incrementCounter).not.toHaveBeenCalledWith(
            'playbackEventsReceived',
            expect.objectContaining({ lastPlaybackEvent: 'low-frequency-reconcile' })
        );
    });

    it('hands playback ownership to video immediately and preserves a paused music queue', async () => {
        const track = {
            Id: 'track',
            MediaType: 'Audio',
            Name: 'Track',
            RunTimeTicks: 30_000_000,
            Type: 'Audio'
        };

        startPtvPlaybackStateService();
        playbackMocks.queueListener?.(createMusicSnapshot(track));
        expect(getPtvGlobalPlaybackState()).toMatchObject({
            paused: false,
            queueLength: 1,
            source: 'ptv-music'
        });

        window.location.hash = '#/video';
        window.dispatchEvent(new HashChangeEvent('hashchange'));

        expect(playbackMocks.pauseMusic).toHaveBeenCalledTimes(1);
        expect(playbackMocks.pauseMusic).toHaveBeenCalledWith('playback-route-change');
        expect(getPtvGlobalPlaybackState()).toMatchObject({
            active: false,
            source: 'none'
        });

        playbackMocks.currentPlayer = {};
        playbackMocks.currentItem = {
            Id: 'video',
            MediaType: 'Video',
            Name: 'Video',
            Type: 'Movie'
        };
        playbackMocks.eventHandlers.get('playbackstart')?.();
        vi.advanceTimersByTime(80);

        expect(playbackMocks.pauseMusic).toHaveBeenCalledTimes(1);
        expect(getPtvGlobalPlaybackState()).toMatchObject({
            itemId: 'video',
            source: 'jellyfin-player'
        });

        playbackMocks.queueListener?.(createMusicSnapshot(track, false));
        playbackMocks.currentPlayer = null;
        playbackMocks.currentItem = null;
        playbackMocks.eventHandlers.get('playbackstop')?.();
        vi.advanceTimersByTime(80);

        window.location.hash = '#/details?id=video';
        window.dispatchEvent(new HashChangeEvent('hashchange'));

        expect(getPtvGlobalPlaybackState()).toMatchObject({
            paused: true,
            queueLength: 1,
            source: 'ptv-music'
        });
        expect(playbackMocks.pauseMusic).toHaveBeenCalledTimes(1);
    });
});
