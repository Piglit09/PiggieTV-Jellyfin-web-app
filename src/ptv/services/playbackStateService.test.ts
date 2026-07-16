import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PtvMusicQueueSnapshot } from '../modules/music/musicTypes';

const playbackMocks = vi.hoisted(() => ({
    eventOff: vi.fn(),
    eventOn: vi.fn(),
    incrementCounter: vi.fn(),
    queueListener: null as ((snapshot: PtvMusicQueueSnapshot) => void) | null,
    queueUnsubscribe: vi.fn()
}));

vi.mock('../../components/playback/playbackmanager', () => ({
    playbackManager: {}
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
    previousPtvMusicTrack: vi.fn(),
    stopPtvMusicPlayback: vi.fn(),
    subscribeToPtvMusicQueue: vi.fn((listener: (snapshot: PtvMusicQueueSnapshot) => void) => {
        playbackMocks.queueListener = listener;

        return playbackMocks.queueUnsubscribe;
    }),
    togglePtvMusicPlayPause: vi.fn()
}));

vi.mock('./performanceMonitor', () => ({
    incrementPtvPerformanceCounter: playbackMocks.incrementCounter,
    recordPtvPerformanceEntry: vi.fn(),
    setPtvPlaybackSubscriptionCount: vi.fn()
}));

import {
    disposePtvPlaybackStateServiceForTests,
    startPtvPlaybackStateService
} from './playbackStateService';

function createMusicSnapshot(currentItem: PtvMusicQueueSnapshot['currentItem']): PtvMusicQueueSnapshot {
    return {
        autoQueueSeedItem: null,
        autoQueueSeedRevision: 0,
        currentIndex: currentItem ? 0 : -1,
        currentItem,
        isAudio: Boolean(currentItem),
        isMuted: false,
        isPlaying: Boolean(currentItem),
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
        playbackMocks.incrementCounter.mockClear();
        playbackMocks.queueUnsubscribe.mockClear();
        playbackMocks.queueListener = null;
    });

    afterEach(() => {
        disposePtvPlaybackStateServiceForTests();
        vi.useRealTimers();
    });

    it('uses queue events as authoritative and retires global playback listeners', () => {
        const intervalSpy = vi.spyOn(window, 'setInterval');

        startPtvPlaybackStateService();
        expect(intervalSpy).toHaveBeenCalledTimes(1);
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
        vi.advanceTimersByTime(1_000);
        expect(playbackMocks.incrementCounter).toHaveBeenCalledWith(
            'playbackEventsReceived',
            expect.objectContaining({ lastPlaybackEvent: 'low-frequency-reconcile' })
        );

        disposePtvPlaybackStateServiceForTests();
        expect(playbackMocks.queueUnsubscribe).toHaveBeenCalledTimes(1);
        expect(playbackMocks.eventOff).toHaveBeenCalledTimes(5);
    });
});
