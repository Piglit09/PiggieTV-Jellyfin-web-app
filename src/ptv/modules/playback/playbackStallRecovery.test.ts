import { describe, expect, it } from 'vitest';

import { getPlaybackStallRecoveryStrategy } from './playbackStallRecovery';

describe('playback stall recovery strategy', () => {
    it('delegates an active HLS load to its source-session owner', () => {
        expect(getPlaybackStallRecoveryStrategy({
            loadingEnabled: true,
            startLoad: () => undefined
        })).toBe('hls-session-owner');
    });

    it('does not independently restart an explicitly stopped HLS load', () => {
        expect(getPlaybackStallRecoveryStrategy({
            loadingEnabled: false,
            startLoad: () => undefined
        })).toBe('hls-session-owner');
    });

    it('delegates HLS recovery when loadingEnabled is unavailable', () => {
        expect(getPlaybackStallRecoveryStrategy({
            startLoad: () => undefined
        })).toBe('hls-session-owner');
    });

    it('delegates native HLS recovery even when no hls.js instance exists', () => {
        expect(getPlaybackStallRecoveryStrategy(null, true)).toBe('hls-session-owner');
    });

    it.each([null, undefined, {}, { startLoad: true }])('uses native recovery for non-HLS playback', hlsPlayer => {
        expect(getPlaybackStallRecoveryStrategy(hlsPlayer)).toBe('native-reload');
    });
});
