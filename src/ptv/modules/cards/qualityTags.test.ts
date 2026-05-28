import { describe, expect, test } from 'vitest';

import {
    getPtvQualityAttribute,
    getPtvQualityTags,
    type PtvQualityItem
} from './qualityTags';

describe('PiggieTV quality tags', () => {
    test('derives rich Jellyfin-Enhanced style tags from media streams', () => {
        const item: PtvQualityItem = {
            MediaType: 'Video',
            Type: 'Movie',
            MediaSources: [
                {
                    Name: 'Movie.2160p.BluRay.REMUX',
                    MediaStreams: [
                        {
                            Codec: 'hevc',
                            Type: 'Video',
                            VideoRange: 'DOVI HDR10',
                            Width: 3840
                        },
                        {
                            Channels: 8,
                            Codec: 'truehd',
                            DisplayTitle: 'TrueHD Atmos 7.1',
                            Type: 'Audio'
                        }
                    ],
                    Path: 'Movie.2160p.BluRay.REMUX.mkv'
                }
            ]
        };

        expect(getPtvQualityTags(item).map(tag => tag.label)).toEqual([
            '4K',
            'BluRay',
            'Dolby Vision',
            'HDR',
            'HEVC',
            'ATMOS'
        ]);
    });

    test('does not invent a resolution tag when stream dimensions are missing', () => {
        const item: PtvQualityItem = {
            MediaType: 'Video',
            Type: 'Series'
        };

        expect(getPtvQualityTags(item)).toEqual([]);
    });

    test('detects physical media source tags conservatively', () => {
        const item: PtvQualityItem = {
            MediaSources: [
                {
                    Type: 'Placeholder'
                }
            ],
            MediaType: 'Video',
            Type: 'Movie',
            Width: 720
        };

        expect(getPtvQualityAttribute(item)).toBe('480p,Physical');
    });
});
