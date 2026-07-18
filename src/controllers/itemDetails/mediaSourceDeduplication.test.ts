import { describe, expect, it } from 'vitest';

import {
    dedupeMediaSources,
    getUniqueMediaSourceCount,
    normalizeItemMediaSources
} from './mediaSourceDeduplication';

describe('media source deduplication', () => {
    it('collapses duplicate API entries that reference the same real file', () => {
        const sources = dedupeMediaSources([
            { Id: 'one', Path: 'D:\\Shows\\Episode.mkv', Container: 'mkv', RunTimeTicks: 42 },
            { Id: 'two', Path: 'd:/shows/episode.mkv', Container: 'MKV' }
        ]);

        expect(sources).toHaveLength(1);
    });

    it('retains genuinely distinct playable files', () => {
        const sources = dedupeMediaSources([
            { Id: 'one', Path: '/shows/episode-1080p.mkv', Container: 'mkv', RunTimeTicks: 42 },
            { Id: 'two', Path: '/shows/episode-4k.mkv', Container: 'mkv', RunTimeTicks: 42 }
        ]);

        expect(sources).toHaveLength(2);
    });

    it('corrects MediaSourceCount after normalization', () => {
        const item = normalizeItemMediaSources({
            MediaSourceCount: 2,
            MediaSources: [
                { Id: 'one', Path: '/shows/episode.mkv', Container: 'mkv', RunTimeTicks: 42 },
                { Id: 'two', Path: '/shows/episode.mkv', Container: 'mkv', RunTimeTicks: 42 }
            ]
        });

        expect(item.MediaSourceCount).toBe(1);
        expect(item.MediaSources).toHaveLength(1);
    });

    it('uses unique sources for shared card and list indicators', () => {
        expect(getUniqueMediaSourceCount({
            MediaSourceCount: 2,
            MediaSources: [
                { Id: 'one', Path: '/shows/episode.mkv', Container: 'mkv', RunTimeTicks: 42 },
                { Id: 'two', Path: '/shows/episode.mkv', Container: 'mkv', RunTimeTicks: 42 }
            ]
        })).toBe(1);
    });
});
