import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/observability', () => ({ recordPtvEvent: vi.fn() }));

import { recordPtvEvent } from '../../core/observability';
import {
    classifyPlaybackRoute,
    createHlsPlaybackSession,
    getPlaybackMediaMode,
    reduceHlsPlaybackState
} from './hlsPlaybackSession';

const EVENTS = Object.freeze(Object.fromEntries([
    [ 'ERROR', 'error' ],
    [ 'FRAG_LOADED', 'fragment-loaded' ],
    [ 'FRAG_LOADING', 'fragment-loading' ],
    [ 'FRAG_LOAD_EMERGENCY_ABORTED', 'fragment-aborted' ],
    [ 'LEVEL_SWITCHING', 'level-switching' ],
    [ 'MANIFEST_LOADED', 'manifest-loaded' ],
    [ 'MANIFEST_LOADING', 'manifest-loading' ],
    [ 'MANIFEST_PARSED', 'manifest-parsed' ],
    [ 'STALL_RESOLVED', 'stall-resolved' ]
]));

class FakeHls {
    loadingEnabled = true;
    recoverMediaError = vi.fn();
    startLoad = vi.fn();
    swapAudioCodec = vi.fn();
    private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    on(event: string, listener: (...args: unknown[]) => void) {
        const listeners = this.listeners.get(event) || new Set();

        listeners.add(listener);
        this.listeners.set(event, listeners);
    }

    off(event: string, listener: (...args: unknown[]) => void) {
        this.listeners.get(event)?.delete(listener);
    }

    emit(event: string, data: Record<string, unknown> = {}) {
        this.listeners.get(event)?.forEach(listener => {
            listener(event, data);
        });
    }
}

function createMedia() {
    const media = document.createElement('video');
    let currentTime = 0;
    let bufferAhead = 0;
    let paused = false;
    let ended = false;
    let seeking = false;
    let readyState = 0;

    Object.defineProperties(media, {
        buffered: {
            configurable: true,
            get: () => ({
                end: () => currentTime + bufferAhead,
                length: bufferAhead >= 0 ? 1 : 0,
                start: () => 0
            })
        },
        currentTime: {
            configurable: true,
            get: () => currentTime,
            set: value => {
                currentTime = Number(value);
            }
        },
        ended: { configurable: true, get: () => ended },
        paused: { configurable: true, get: () => paused },
        readyState: { configurable: true, get: () => readyState },
        seeking: { configurable: true, get: () => seeking }
    });

    return {
        media,
        setBufferAhead: (value: number) => {
            bufferAhead = value;
        },
        setCurrentTime: (value: number) => {
            currentTime = value;
        },
        setEnded: (value: boolean) => {
            ended = value;
        },
        setPaused: (value: boolean) => {
            paused = value;
        },
        setReadyState: (value: number) => {
            readyState = value;
        },
        setSeeking: (value: boolean) => {
            seeking = value;
        }
    };
}

function createSession(overrides: { current?: () => boolean; hls?: FakeHls } = {}) {
    const hls = overrides.hls || new FakeHls();
    const mediaState = createMedia();
    const session = createHlsPlaybackSession({
        events: EVENTS,
        hls,
        isCurrent: overrides.current || (() => true),
        media: mediaState.media,
        mediaMode: 'HLS Transcode',
        routeClassification: 'LAN_DIRECT',
        routeFamily: 'playback',
        sourceGeneration: 7
    });

    return { hls, mediaState, session };
}

describe('HLS playback session ownership', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.mocked(recordPtvEvent).mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('uses deterministic state transitions', () => {
        expect(reduceHlsPlaybackState('IDLE', 'SOURCE_ASSIGNED')).toBe('LOADING');
        expect(reduceHlsPlaybackState('LOADING', 'MANIFEST_READY')).toBe('BUFFERING');
        expect(reduceHlsPlaybackState('BUFFERING', 'PLAYING')).toBe('PLAYING');
        expect(reduceHlsPlaybackState('PLAYING', 'LOW_BUFFER')).toBe('DEGRADED');
        expect(reduceHlsPlaybackState('DEGRADED', 'STALL_CONFIRMED')).toBe('STALLED');
        expect(reduceHlsPlaybackState('STALLED', 'RECOVERY_STARTED')).toBe('RECOVERING');
        expect(reduceHlsPlaybackState('RECOVERING', 'RECOVERY_SUCCEEDED')).toBe('PLAYING');
        expect(reduceHlsPlaybackState('RECOVERING', 'FAILED')).toBe('FAILED');
        expect(reduceHlsPlaybackState('FAILED', 'PLAYING')).toBe('FAILED');
    });

    it('classifies only route topology and media mode, never a raw URL', () => {
        expect(classifyPlaybackRoute('https://10.16.0.50/video', 'https://10.16.0.50/web/')).toBe('LAN_DIRECT');
        expect(classifyPlaybackRoute('https://media.example/video', 'https://10.16.0.50/web/')).toBe('LOCAL_VIA_PUBLIC_HOSTNAME');
        expect(classifyPlaybackRoute('https://media.example/video', 'https://media.example/web/')).toBe('PUBLIC_PROXY');
        expect(classifyPlaybackRoute('not a url', 'not a page')).toBe('UNKNOWN');
        expect(getPlaybackMediaMode('Transcode', true)).toBe('HLS Transcode');
        expect(getPlaybackMediaMode('DirectPlay', false)).toBe('Direct Play');
    });

    it('records bounded fragment latency, retry, and duplicate aggregates', () => {
        const { hls, mediaState, session } = createSession();

        mediaState.setBufferAhead(8);
        mediaState.media.dispatchEvent(new Event('playing'));
        hls.emit(EVENTS.MANIFEST_LOADING);
        vi.advanceTimersByTime(250);
        hls.emit(EVENTS.MANIFEST_LOADED, { stats: { loading: { end: 250, start: 0 } } });
        hls.emit(EVENTS.FRAG_LOADING, { frag: { level: 1, sn: 5, type: 'main' } });
        hls.emit(EVENTS.FRAG_LOADING, { frag: { level: 1, sn: 5, type: 'main' } });
        hls.emit(EVENTS.FRAG_LOADED, {
            frag: {
                level: 1,
                sn: 5,
                stats: { loading: { end: 1_750, start: 250 }, retry: 2 },
                type: 'main'
            }
        });

        const snapshot = session.getSnapshot();

        expect(snapshot.hls).toMatchObject({
            duplicateFragmentRequestCount: 1,
            fragmentAverageLatencyMs: 1_500,
            fragmentP95LatencyMs: 1_500,
            fragmentRequestCount: 2,
            fragmentRetryCount: 2,
            fragmentSuccessCount: 1,
            manifestAverageLatencyMs: 250,
            manifestRequestCount: 1,
            manifestSuccessCount: 1
        });
        session.dispose();
    });

    it('does not restart an active slow fragment', () => {
        const { hls, mediaState, session } = createSession();

        mediaState.setBufferAhead(0);
        mediaState.setCurrentTime(1);
        mediaState.media.dispatchEvent(new Event('playing'));
        hls.emit(EVENTS.FRAG_LOADING, { frag: { level: 0, sn: 1, type: 'main' } });
        vi.advanceTimersByTime(20_000);

        expect(hls.startLoad).not.toHaveBeenCalled();
        expect(session.getSnapshot().player.activeLoadRestarts).toBe(0);
        session.dispose();
    });

    it('permits one controller-owned fatal recovery after confirmed depletion', () => {
        const { hls, mediaState, session } = createSession();

        mediaState.setBufferAhead(0);
        mediaState.setCurrentTime(1);
        mediaState.media.dispatchEvent(new Event('playing'));
        vi.advanceTimersByTime(13_000);

        expect(session.recoverFromFatalNetwork(hls, 504)).toBe(true);
        expect(session.recoverFromFatalNetwork(hls, 504)).toBe(false);
        expect(hls.startLoad).toHaveBeenCalledTimes(1);
        expect(session.getSnapshot().player).toMatchObject({
            activeLoadRestarts: 1,
            recoveryActions: 1
        });
        session.dispose();
    });

    it('ignores a late fatal error from a retired quality level', () => {
        const { hls, mediaState, session } = createSession();

        mediaState.setBufferAhead(0);
        mediaState.setCurrentTime(1);
        mediaState.media.dispatchEvent(new Event('playing'));
        hls.emit(EVENTS.LEVEL_SWITCHING, { level: 2 });
        vi.advanceTimersByTime(13_000);

        expect(session.recoverFromFatalNetwork(hls, 504, { frag: { level: 1 } })).toBe(true);
        expect(hls.startLoad).not.toHaveBeenCalled();
        expect(session.getSnapshot().player.staleEventsIgnored).toBe(1);

        expect(session.recoverFromFatalNetwork(hls, 504, { frag: { level: 2 } })).toBe(true);
        expect(hls.startLoad).toHaveBeenCalledTimes(1);
        session.dispose();
    });

    it('suppresses duplicate media-error signals without spending both attempts', () => {
        const { hls, session } = createSession();

        expect(session.recoverFromMediaError(hls)).toBe(true);
        expect(session.recoverFromMediaError(hls)).toBe(true);
        expect(hls.recoverMediaError).toHaveBeenCalledTimes(1);
        expect(session.getSnapshot().player.recoveryActions).toBe(1);

        vi.advanceTimersByTime(3_001);
        expect(session.recoverFromMediaError(hls)).toBe(true);
        expect(hls.recoverMediaError).toHaveBeenCalledTimes(2);
        expect(hls.swapAudioCodec).toHaveBeenCalledTimes(1);

        expect(session.recoverFromMediaError(hls)).toBe(true);
        expect(hls.recoverMediaError).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(3_001);
        expect(session.recoverFromMediaError(hls)).toBe(false);
        session.dispose();
    });

    it('disarms recovery during pause and seek', () => {
        const paused = createSession();

        paused.mediaState.setBufferAhead(0);
        paused.mediaState.setCurrentTime(1);
        paused.mediaState.media.dispatchEvent(new Event('playing'));
        paused.mediaState.setPaused(true);
        vi.advanceTimersByTime(13_000);
        expect(paused.session.recoverFromFatalNetwork(paused.hls, 504)).toBe(false);
        paused.session.dispose();

        const seeking = createSession();

        seeking.mediaState.setBufferAhead(0);
        seeking.mediaState.setCurrentTime(1);
        seeking.mediaState.media.dispatchEvent(new Event('playing'));
        seeking.mediaState.setSeeking(true);
        seeking.mediaState.media.dispatchEvent(new Event('seeking'));
        vi.advanceTimersByTime(13_000);
        expect(seeking.session.recoverFromFatalNetwork(seeking.hls, 504)).toBe(false);
        seeking.session.dispose();
    });

    it('ignores stale fragment completion after source generation changes', () => {
        let current = true;
        const { hls, session } = createSession({ current: () => current });

        current = false;
        hls.emit(EVENTS.FRAG_LOADED, {
            frag: { level: 0, sn: 9, stats: { loading: { end: 100, start: 0 } }, type: 'main' }
        });

        expect(session.getSnapshot().hls.fragmentSuccessCount).toBe(0);
        expect(session.getSnapshot().player.staleEventsIgnored).toBe(1);
        session.dispose();
    });

    it('cancels sampling and recovery ownership on route exit', () => {
        const { hls, session } = createSession();
        const publishCountBeforeDispose = vi.mocked(recordPtvEvent).mock.calls.length;

        session.dispose('route-exit');
        const publishCountAfterDispose = vi.mocked(recordPtvEvent).mock.calls.length;

        expect(publishCountAfterDispose).toBeGreaterThan(publishCountBeforeDispose);
        expect(session.recoverFromFatalNetwork(hls, 504)).toBe(false);
        vi.advanceTimersByTime(30_000);
        expect(vi.mocked(recordPtvEvent)).toHaveBeenCalledTimes(publishCountAfterDispose);
    });

    it('keeps direct play free of HLS recovery actions', () => {
        const mediaState = createMedia();
        const session = createHlsPlaybackSession({
            isCurrent: () => true,
            media: mediaState.media,
            mediaMode: 'Direct Play',
            routeClassification: 'LAN_DIRECT',
            routeFamily: 'playback',
            sourceGeneration: 1
        });

        mediaState.setBufferAhead(6);
        session.recordPlayerAction('play');
        mediaState.media.dispatchEvent(new Event('playing'));

        expect(session.getSnapshot()).toMatchObject({
            mediaMode: 'Direct Play',
            player: { activeLoadRestarts: 0, playCalls: 1, recoveryActions: 0 }
        });
        session.dispose();
    });
});
