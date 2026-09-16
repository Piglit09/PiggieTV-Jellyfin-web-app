import { describe, expect, it, vi } from 'vitest';

import {
    DEFAULT_HLS_BUFFER_LENGTH_SECONDS,
    HIGH_BITRATE_HLS_BUFFER_LENGTH_SECONDS,
    VOD_TRANSCODE_FRAGMENT_TTFB_TIMEOUT_MS,
    bindHlsBufferPolicy,
    createHlsBufferPolicyController,
    createVodTranscodeFragmentLoadPolicy,
    getHlsBufferLength,
    getHlsLevelBitrate,
    getParsedManifestBitrate
} from '../../plugins/htmlVideoPlayer/hlsPlaybackPolicy';

describe('HLS playback policy', () => {
    it.each([
        [11269052, true, DEFAULT_HLS_BUFFER_LENGTH_SECONDS],
        [24999999, true, DEFAULT_HLS_BUFFER_LENGTH_SECONDS],
        [25000000, true, HIGH_BITRATE_HLS_BUFFER_LENGTH_SECONDS],
        [120000000, true, HIGH_BITRATE_HLS_BUFFER_LENGTH_SECONDS],
        [null, true, DEFAULT_HLS_BUFFER_LENGTH_SECONDS],
        [120000000, false, DEFAULT_HLS_BUFFER_LENGTH_SECONDS]
    ])('chooses the expected buffer for bitrate %s (affected browser: %s)', (bitrate, isAffectedBrowser, expected) => {
        expect(getHlsBufferLength(bitrate, isAffectedBrowser)).toBe(expected);
    });

    it('treats missing manifest bandwidth as unknown and keeps the conservative default buffer', () => {
        expect(getParsedManifestBitrate({ firstLevel: 0, levels: [ {} ] })).toBeNull();
        expect(getHlsBufferLength(null, true)).toBe(DEFAULT_HLS_BUFFER_LENGTH_SECONDS);
    });

    it('uses the selected manifest level rather than the highest advertised level', () => {
        expect(getParsedManifestBitrate({
            firstLevel: 0,
            levels: [
                { maxBitrate: 11269052 },
                { maxBitrate: 120000000 }
            ]
        })).toBe(11269052);
    });

    it('uses stable bitrate fallbacks when maxBitrate is unavailable', () => {
        expect(getHlsLevelBitrate({ bitrate: 12000000, averageBitrate: 11000000 })).toBe(12000000);
        expect(getHlsLevelBitrate({ averageBitrate: 11000000 })).toBe(11000000);
        expect(getHlsLevelBitrate({})).toBeNull();
    });

    it('updates buffer buckets on level switches without resetting an unchanged bucket', () => {
        const config = {
            maxBufferLength: DEFAULT_HLS_BUFFER_LENGTH_SECONDS,
            maxMaxBufferLength: DEFAULT_HLS_BUFFER_LENGTH_SECONDS
        };
        const hls = { config };
        const applyBitrate = createHlsBufferPolicyController(hls, true);

        expect(applyBitrate(11269052)).toBe(false);
        expect(applyBitrate(120000000)).toBe(true);
        expect(config).toEqual({
            maxBufferLength: HIGH_BITRATE_HLS_BUFFER_LENGTH_SECONDS,
            maxMaxBufferLength: HIGH_BITRATE_HLS_BUFFER_LENGTH_SECONDS
        });

        const maxMaxBufferLengthSetter = vi.fn();
        Object.defineProperty(config, 'maxMaxBufferLength', {
            configurable: true,
            get: () => 4,
            set: maxMaxBufferLengthSetter
        });

        expect(applyBitrate(120000000)).toBe(false);
        expect(maxMaxBufferLengthSetter).not.toHaveBeenCalled();
        expect(applyBitrate(11269052)).toBe(true);
        expect(config.maxBufferLength).toBe(DEFAULT_HLS_BUFFER_LENGTH_SECONDS);
        expect(maxMaxBufferLengthSetter).toHaveBeenCalledExactlyOnceWith(DEFAULT_HLS_BUFFER_LENGTH_SECONDS);
    });

    it('keeps buffer policy state isolated per HLS instance', () => {
        const first = { config: { maxBufferLength: 30, maxMaxBufferLength: 30 } };
        const second = { config: { maxBufferLength: 30, maxMaxBufferLength: 30 } };
        const applyFirst = createHlsBufferPolicyController(first, true);
        const applySecond = createHlsBufferPolicyController(second, true);

        applyFirst(120000000);

        expect(first.config.maxBufferLength).toBe(6);
        expect(second.config.maxBufferLength).toBe(30);
        expect(applySecond(11269052)).toBe(false);
    });

    it('binds manifest and level-switch events to the active-level policy', () => {
        const listeners = new Map();
        const hls = {
            config: { maxBufferLength: 30, maxMaxBufferLength: 30 },
            on: vi.fn((event, listener) => listeners.set(event, listener))
        };
        const events = {};

        events['MANIFEST_PARSED'] = 'manifest-parsed';
        events['LEVEL_SWITCHING'] = 'level-switching';

        bindHlsBufferPolicy(hls, events, true);

        expect(hls.on).toHaveBeenCalledTimes(2);
        listeners.get(events.MANIFEST_PARSED)(events.MANIFEST_PARSED, {
            firstLevel: 0,
            levels: [ { maxBitrate: 11269052 }, { maxBitrate: 120000000 } ]
        });
        expect(hls.config.maxBufferLength).toBe(30);

        listeners.get(events.LEVEL_SWITCHING)(events.LEVEL_SWITCHING, { maxBitrate: 120000000 });
        expect(hls.config).toEqual({ maxBufferLength: 6, maxMaxBufferLength: 6 });
    });

    it('extends only the VOD transcode fragment TTFB budget', () => {
        const timeoutRetry = { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 };
        const errorRetry = { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 };
        const defaultPolicy = {
            default: {
                maxTimeToFirstByteMs: 10000,
                maxLoadTimeMs: 120000,
                timeoutRetry,
                errorRetry
            }
        };

        const policy = createVodTranscodeFragmentLoadPolicy(defaultPolicy, {
            playMethod: 'Transcode',
            mediaSource: { RunTimeTicks: 1200000000 }
        });

        expect(policy).not.toBe(defaultPolicy);
        expect(policy.default).not.toBe(defaultPolicy.default);
        expect(policy.default.maxTimeToFirstByteMs).toBe(VOD_TRANSCODE_FRAGMENT_TTFB_TIMEOUT_MS);
        expect(policy.default.maxLoadTimeMs).toBe(120000);
        expect(policy.default.timeoutRetry).toBe(timeoutRetry);
        expect(policy.default.errorRetry).toBe(errorRetry);
        expect(defaultPolicy.default.maxTimeToFirstByteMs).toBe(10000);
    });

    it.each([
        ['live transcode', { playMethod: 'Transcode', mediaSource: {} }],
        ['direct play', { playMethod: 'DirectPlay', mediaSource: { RunTimeTicks: 1200000000 } }]
    ])('preserves the default fragment policy for %s', (_label, options) => {
        expect(createVodTranscodeFragmentLoadPolicy({ default: {} }, options)).toBeNull();
    });
});
