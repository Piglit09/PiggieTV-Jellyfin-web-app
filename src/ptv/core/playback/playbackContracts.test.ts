import { describe, expect, it } from 'vitest';

import {
    completePtvPlaybackState,
    createInitialPtvPlaybackState,
    reducePtvPlaybackState,
    shouldPtvAutoplayNext
} from './playbackContracts';

describe('PTV Core playback contracts', () => {
    it('normalizes play, pause, seek, and completion state transitions', () => {
        let state = createInitialPtvPlaybackState({
            durationMs: 10_000,
            mediaId: 'one',
            queue: ['one'],
            queueIndex: 0,
            status: 'paused'
        });
        state = reducePtvPlaybackState(state, { type: 'play' });
        expect(state.status).toBe('playing');
        state = reducePtvPlaybackState(state, { positionMs: 20_000, type: 'seek' });
        expect(state.positionMs).toBe(10_000);
        state = reducePtvPlaybackState(state, { type: 'pause' });
        expect(state.status).toBe('paused');
        expect(completePtvPlaybackState(state)).toMatchObject({
            completed: true,
            positionMs: 10_000,
            status: 'ended'
        });
    });

    it('supports queue replacement, add, play-next, next, and previous', () => {
        let state = createInitialPtvPlaybackState({ status: 'playing' });
        state = reducePtvPlaybackState(state, {
            mediaIds: ['one', 'two'],
            startIndex: 0,
            type: 'replace-queue'
        });
        state = reducePtvPlaybackState(state, { mediaIds: ['four'], type: 'add-to-queue' });
        state = reducePtvPlaybackState(state, { mediaIds: ['next'], type: 'play-next' });
        expect(state.queue).toEqual(['one', 'next', 'two', 'four']);
        state = reducePtvPlaybackState(state, { type: 'next' });
        expect(state).toMatchObject({ mediaId: 'next', queueIndex: 1 });
        state = reducePtvPlaybackState(state, { type: 'previous' });
        expect(state).toMatchObject({ mediaId: 'one', queueIndex: 0 });
    });

    it('handles repeat, shuffle, track selection, and end-of-queue behavior', () => {
        let state = createInitialPtvPlaybackState({
            mediaId: 'one',
            queue: ['one'],
            queueIndex: 0,
            status: 'playing'
        });
        state = reducePtvPlaybackState(state, { repeatMode: 'all', type: 'set-repeat' });
        state = reducePtvPlaybackState(state, { shuffled: true, type: 'set-shuffle' });
        state = reducePtvPlaybackState(state, { trackId: 'audio-2', type: 'select-audio-track' });
        state = reducePtvPlaybackState(state, { trackId: 'sub-1', type: 'select-subtitle-track' });
        expect(reducePtvPlaybackState(state, { type: 'next' })).toMatchObject({
            audioTrackId: 'audio-2',
            mediaId: 'one',
            queueIndex: 0,
            repeatMode: 'all',
            shuffled: true,
            subtitleTrackId: 'sub-1'
        });
        expect(reducePtvPlaybackState({ ...state, repeatMode: 'off' }, { type: 'next' }))
            .toMatchObject({ completed: true, status: 'ended' });
    });

    it('makes autoplay-next a pure, capability-aware decision', () => {
        expect(shouldPtvAutoplayNext({
            completionReason: 'completed',
            enabled: true,
            hasNext: true
        })).toBe(true);
        expect(shouldPtvAutoplayNext({
            completionReason: 'error',
            enabled: true,
            hasNext: true
        })).toBe(false);
        expect(shouldPtvAutoplayNext({
            backgroundPlaybackSupported: false,
            completionReason: 'completed',
            enabled: true,
            hasNext: true
        })).toBe(false);
    });
});
