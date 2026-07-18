import { describe, expect, it } from 'vitest';

import { getEpisodePlaybackTitle } from './videoDisplayTitle';

describe('getEpisodePlaybackTitle', () => {
    it('combines the series and indexed episode title for the video header', () => {
        expect(getEpisodePlaybackTitle({
            IndexNumber: 4,
            Name: 'Rise of Apocalypse (2)',
            ParentIndexNumber: 2,
            SeriesName: 'X-Men',
            Type: 'Episode'
        })).toBe('X-Men  \u00b7  S02E04 - Rise of Apocalypse (2)');
    });

    it('leaves movie title formatting to the existing path', () => {
        expect(getEpisodePlaybackTitle({ Name: 'Movie', Type: 'Movie' })).toBeNull();
    });

    it('uses the known parent title when the playback item omits SeriesName', () => {
        expect(getEpisodePlaybackTitle({
            IndexNumber: 1,
            Name: 'Pilot',
            ParentIndexNumber: 1,
            Type: 'Episode'
        }, 'Fallback Series')).toBe('Fallback Series  \u00b7  S01E01 - Pilot');
    });
});
