import { describe, expect, it } from 'vitest';

import {
    VIDEO_QUALITY_TIERS,
    createCappedVideoProfile,
    getRemoteVideoQualityLimit,
    selectManualVideoBitrate,
    validateVideoQualityNegotiation
} from './videoQualityNegotiation';

const profile = {
    CodecProfiles: [{ Type: 'Video', Codec: 'h264', Conditions: [{ Property: 'IsAnamorphic', Value: 'false' }] }],
    TranscodingProfiles: [
        { Type: 'Video', Container: 'ts', Conditions: [{ Property: 'VideoBitrate', Value: '20000000' }] },
        { Type: 'Audio', Container: 'mp3', Conditions: [] }
    ]
};

function mediaSource(width: number, height: number) {
    return { MediaStreams: [{ Type: 'Video', Width: width, Height: height }] };
}

function transcode(maxWidth: number, maxHeight: number) {
    return {
        SupportsDirectPlay: false,
        SupportsDirectStream: false,
        SupportsTranscoding: true,
        TranscodingUrl: `/Videos/movie/master.m3u8?MaxWidth=${maxWidth}&MaxHeight=${maxHeight}&ApiKey=private`
    };
}

describe('manual video quality negotiation', () => {
    it('uses a request-local required 1080p ceiling without mutating the shared profile', () => {
        const capped = createCappedVideoProfile(profile, 'full-hd');
        expect(capped).not.toBe(profile);
        expect(profile.CodecProfiles).toHaveLength(1);
        expect(profile.TranscodingProfiles[0].Conditions).toHaveLength(1);
        expect(capped.CodecProfiles).toContainEqual({
            Type: 'Video',
            Conditions: [
                { Condition: 'LessThanEqual', Property: 'Width', Value: '1920', IsRequired: true },
                { Condition: 'LessThanEqual', Property: 'Height', Value: '1080', IsRequired: true }
            ]
        });
        expect(capped.TranscodingProfiles[0].Conditions).toEqual(expect.arrayContaining([
            { Condition: 'LessThanEqual', Property: 'Width', Value: '1920', IsRequired: true },
            { Condition: 'LessThanEqual', Property: 'Height', Value: '1080', IsRequired: true }
        ]));
        expect(capped.TranscodingProfiles[1]).toEqual(profile.TranscodingProfiles[1]);
    });

    it('orients a 1080p ceiling to a portrait source without changing the shared tier', () => {
        const source = mediaSource(1080, 1920);
        const capped = createCappedVideoProfile(profile, 'full-hd', source);
        expect(capped.CodecProfiles.at(-1).Conditions).toEqual([
            { Condition: 'LessThanEqual', Property: 'Width', Value: '1080', IsRequired: true },
            { Condition: 'LessThanEqual', Property: 'Height', Value: '1920', IsRequired: true }
        ]);
        expect(validateVideoQualityNegotiation('full-hd', source, {
            SupportsDirectPlay: true,
            SupportsDirectStream: false,
            SupportsTranscoding: false
        }).valid).toBe(true);
        expect(VIDEO_QUALITY_TIERS['full-hd']).toMatchObject({ maxWidth: 1920, maxHeight: 1080 });
    });

    it('keeps the 4K envelope and a lower requested tier distinct for a cinema-aspect source', () => {
        expect(VIDEO_QUALITY_TIERS['4k']).toMatchObject({ maxWidth: 3840, maxHeight: 2160 });
        expect(VIDEO_QUALITY_TIERS['full-hd']).toMatchObject({ maxWidth: 1920, maxHeight: 1080 });
        expect(validateVideoQualityNegotiation('4k', mediaSource(3832, 1600), {
            SupportsDirectPlay: true,
            SupportsDirectStream: false,
            SupportsTranscoding: false
        }).valid).toBe(true);
        expect(validateVideoQualityNegotiation('full-hd', mediaSource(3832, 1600), transcode(1920, 1080)).valid).toBe(true);
    });

    it('rejects over-cap direct play and an unbounded transcode before replacing the old stream', () => {
        const source = mediaSource(3832, 1600);
        expect(validateVideoQualityNegotiation('full-hd', source, {
            SupportsDirectPlay: true,
            SupportsDirectStream: false,
            SupportsTranscoding: false
        }).valid).toBe(false);
        expect(validateVideoQualityNegotiation('full-hd', source, {
            SupportsDirectPlay: false,
            SupportsDirectStream: false,
            SupportsTranscoding: true,
            TranscodingUrl: '/Videos/movie/master.m3u8?ApiKey=private'
        }).valid).toBe(false);
        expect(validateVideoQualityNegotiation('full-hd', source, transcode(3840, 2160)).valid).toBe(false);
    });

    it('rejects missing dimensions and a direct-stream bypass for an over-cap source', () => {
        expect(validateVideoQualityNegotiation('hd', mediaSource(0, 0), transcode(1280, 720)).valid).toBe(false);
        expect(validateVideoQualityNegotiation('hd', mediaSource(1920, 1080), {
            SupportsDirectPlay: false,
            SupportsDirectStream: true,
            SupportsTranscoding: true,
            TranscodingUrl: '/Videos/movie/master.m3u8?MaxWidth=1280&MaxHeight=720'
        }).valid).toBe(false);
    });

    it('rejects an explicit lower envelope rather than silently calling it Full HD', () => {
        expect(validateVideoQualityNegotiation('full-hd', mediaSource(3832, 1600), transcode(1280, 720)).valid).toBe(false);
        expect(validateVideoQualityNegotiation('full-hd', mediaSource(3832, 1600), transcode(1920, 1080)).valid).toBe(true);
    });

    it('selects one supported internal bitrate profile without using source bitrate as a menu ceiling', () => {
        expect(selectManualVideoBitrate('4k', 12_500_000)).toMatchObject({ level: 'medium', bitrate: 12_000_000 });
        expect(selectManualVideoBitrate('full-hd', 12_500_000)).toMatchObject({ level: 'high', bitrate: 10_000_000 });
        expect(selectManualVideoBitrate('full-hd', 3_000_000)).toMatchObject({ level: 'low', bitrate: 4_000_000 });
        expect(selectManualVideoBitrate('full-hd', null)).toMatchObject({ level: 'medium', bitrate: 6_000_000 });
        expect(selectManualVideoBitrate('full-hd', 12_000_000, 3_000_000)).toBeNull();
    });

    it('applies a user remote limit only to public or unclassified connections', () => {
        const user = { Policy: { RemoteClientBitrateLimit: 3_000_000 } };
        expect(getRemoteVideoQualityLimit(user, { IsInNetwork: false })).toBe(3_000_000);
        expect(getRemoteVideoQualityLimit(user, { IsInNetwork: true })).toBeNull();
        expect(getRemoteVideoQualityLimit(user, null)).toBe(3_000_000);
        expect(getRemoteVideoQualityLimit({ Policy: { RemoteClientBitrateLimit: 0 } }, { IsInNetwork: false })).toBeNull();
    });
});
