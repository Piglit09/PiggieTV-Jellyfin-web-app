import { describe, expect, it } from 'vitest';

import { getEpisodePlaybackTitle } from './videoDisplayTitle';

describe('getEpisodePlaybackTitle', () => {
    it('keeps the bottom episode label separate from the Series identity', () => {
        expect(getEpisodePlaybackTitle({
            IndexNumber: 4,
            Name: 'Rise of Apocalypse (2)',
            ParentIndexNumber: 2,
            SeriesName: 'X-Men',
            Type: 'Episode'
        })).toBe('S02E04 \u2014 Rise of Apocalypse (2)');
    });

    it('leaves movie title formatting to the existing path', () => {
        expect(getEpisodePlaybackTitle({ Name: 'Movie', Type: 'Movie' })).toBeNull();
    });

    it('does not repeat a known parent title in the bottom episode label', () => {
        expect(getEpisodePlaybackTitle({
            IndexNumber: 1,
            Name: 'Pilot',
            ParentIndexNumber: 1,
            Type: 'Episode'
        })).toBe('S01E01 \u2014 Pilot');
    });

    it('preserves a genuine specials season and larger episode index', () => {
        expect(getEpisodePlaybackTitle({
            IndexNumber: 123,
            Name: 'Special',
            ParentIndexNumber: 0,
            SeriesName: 'Series',
            Type: 'Episode'
        })).toBe('S00E123 \u2014 Special');
    });

    it('does not fabricate episode identity for a Movie with index fields', () => {
        expect(getEpisodePlaybackTitle({
            IndexNumber: 4,
            Name: 'Movie',
            ParentIndexNumber: 2,
            SeriesName: 'Collection',
            Type: 'Movie'
        })).toBeNull();
    });
});
