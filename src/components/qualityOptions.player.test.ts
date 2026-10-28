import { describe, expect, it, vi } from 'vitest';

import { getPlayerVideoQualityOptions, getVideoQualityOptions } from './qualityOptions';

vi.mock('../lib/globalize', () => ({ default: { translate: (key: string) => ({
    PtvVideoQuality4K: '4K',
    PtvVideoQualityFullHD: 'Full HD',
    PtvVideoQualityHD: 'HD',
    PtvVideoQualityOriginal: 'Original',
    PtvVideoQualityRecommended: 'Recommended',
    PtvVideoQualitySD: 'SD',
    PtvVideoQualitySourceQuality: 'Source quality',
    PtvVideoQualityUpTo1080p: 'Up to 1080p',
    PtvVideoQualityUpTo2160p: 'Up to 2160p',
    PtvVideoQualityUpTo480p: 'Up to 480p',
    PtvVideoQualityUpTo720p: 'Up to 720p'
} as Record<string, string>)[key] || key } }));

describe('player video quality choices', () => {
    it('shows five readable tiers for a cropped 4K source', () => {
        const options = getPlayerVideoQualityOptions({
            videoWidth: 3832,
            videoHeight: 1600,
            currentSelection: 'auto'
        });

        expect(options.map(({ id, name, secondaryText }) => [ id, name, secondaryText ])).toEqual([
            [ 'auto', 'Auto', 'Recommended' ],
            [ 'original', 'Original', 'Source quality' ],
            [ '4k', '4K', 'Up to 2160p' ],
            [ 'full-hd', 'Full HD', 'Up to 1080p' ],
            [ 'hd', 'HD', 'Up to 720p' ],
            [ 'sd', 'SD', 'Up to 480p' ]
        ]);
        expect(options.filter(option => option.selected).map(option => option.id)).toEqual([ 'auto' ]);
        expect(options.find(option => option.id === '4k')?.bitrateProfiles).toEqual({
            high: 20_000_000,
            medium: 12_000_000,
            low: 8_000_000
        });
        expect(options.find(option => option.id === 'full-hd')?.bitrateProfiles).toEqual({
            high: 10_000_000,
            medium: 6_000_000,
            low: 4_000_000
        });
    });

    it('does not offer 4K for a Full HD source', () => {
        const options = getPlayerVideoQualityOptions({
            videoWidth: 1920,
            videoHeight: 1080,
            currentSelection: 'full-hd'
        });

        expect(options.map(option => option.id)).toEqual([ 'auto', 'original', 'full-hd', 'hd', 'sd' ]);
        expect(options.filter(option => option.selected).map(option => option.id)).toEqual([ 'full-hd' ]);
    });

    it.each([
        [ 1080, 1920, [ 'auto', 'original', 'full-hd', 'hd', 'sd' ] ],
        [ 720, 1280, [ 'auto', 'original', 'hd', 'sd' ] ],
        [ 2160, 3840, [ 'auto', 'original', '4k', 'full-hd', 'hd', 'sd' ] ]
    ] as const)('classifies a %sx%s portrait source by its rotated dimensions', (videoWidth, videoHeight, expected) => {
        const options = getPlayerVideoQualityOptions({ videoWidth, videoHeight });

        expect(options.map(option => option.id)).toEqual(expected);
    });

    it('only offers Auto and Original when source dimensions are unknown', () => {
        const options = getPlayerVideoQualityOptions({ videoWidth: null, videoHeight: null });

        expect(options.map(option => option.id)).toEqual([ 'auto', 'original' ]);
    });

    it('does not falsely check Auto when the active source uses a custom bitrate preference', () => {
        const options = getPlayerVideoQualityOptions({
            videoWidth: 1920,
            videoHeight: 1080,
            currentSelection: null
        });
        expect(options.filter(option => option.selected)).toEqual([]);
    });

    it('clamps internal bitrate profiles below a known connection cap', () => {
        const options = getPlayerVideoQualityOptions({
            videoWidth: 3840,
            videoHeight: 2160,
            maxAllowedBitrate: 8_000_000
        });

        for (const option of options.filter(choice => choice.bitrateProfiles)) {
            const profiles = option.bitrateProfiles;
            expect(profiles.high).toBeLessThanOrEqual(8_000_000);
            expect(profiles.medium).toBeLessThanOrEqual(8_000_000);
            expect(profiles.low).toBeLessThanOrEqual(8_000_000);
            expect(profiles.high).toBeGreaterThanOrEqual(profiles.medium);
            expect(profiles.medium).toBeGreaterThanOrEqual(profiles.low);
        }
    });

    it('does not prune a 4K resolution tier because the source bitrate is low', () => {
        const options = getPlayerVideoQualityOptions({
            videoWidth: 3832,
            videoHeight: 1600,
            videoBitRate: 3_000_000
        });

        expect(options.map(option => option.id)).toContain('4k');
    });

    it('hides a tier when the known cap cannot support its low profile', () => {
        const options = getPlayerVideoQualityOptions({
            videoWidth: 3840,
            videoHeight: 2160,
            maxAllowedBitrate: 7_000_000
        });

        expect(options.map(option => option.id)).toEqual([ 'auto', 'original', 'full-hd', 'hd', 'sd' ]);
    });

    it('withholds manual tiers when the player has no connection bitrate evidence', () => {
        const options = getPlayerVideoQualityOptions({
            videoWidth: 3840,
            videoHeight: 2160,
            maxAllowedBitrate: null
        });
        expect(options.map(option => option.id)).toEqual([ 'auto', 'original' ]);
    });

    it('keeps only the tiers at or below a known 720p source', () => {
        const options = getPlayerVideoQualityOptions({
            videoWidth: 1280,
            videoHeight: 720,
            currentSelection: '4k'
        });

        expect(options.map(option => option.id)).toEqual([ 'auto', 'original', 'hd', 'sd' ]);
        expect(options.filter(option => option.selected).map(option => option.id)).toEqual([ 'auto' ]);
    });

    it('keeps the global bitrate selector separate from player presets', () => {
        const options = getVideoQualityOptions({ enableAuto: true });

        expect(options.map(option => option?.name)).toContain('120 Mbps');
        expect(options.map(option => option?.name)).not.toContain('Full HD');
    });
});
