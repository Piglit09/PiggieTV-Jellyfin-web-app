import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPtvAbortController } from '../../core/abortController';

const { requestPtvJson } = vi.hoisted(() => ({
    requestPtvJson: vi.fn()
}));

vi.mock('../../api', () => ({ requestPtvJson }));

import {
    getPtvSearchHintFailureKind,
    groupPtvSearchHints,
    mapPtvSearchHintToItem,
    searchPtvHints
} from './searchHintService';

describe('searchHintService', () => {
    beforeEach(() => {
        requestPtvJson.mockReset();
    });

    it('maps lightweight hint artwork and context to the shared card model', () => {
        expect(mapPtvSearchHintToItem({
            BackdropImageItemId: 'backdrop-owner',
            BackdropImageTag: 'backdrop-tag',
            Id: 'episode-1',
            Name: 'Episode',
            PrimaryImageTag: 'primary-tag',
            ProductionYear: 2026,
            Series: 'Series',
            ThumbImageItemId: 'thumb-owner',
            ThumbImageTag: 'thumb-tag',
            Type: 'Episode'
        })).toMatchObject({
            Id: 'episode-1',
            ImageTags: { Primary: 'primary-tag' },
            ParentBackdropImageTags: ['backdrop-tag'],
            ParentBackdropItemId: 'backdrop-owner',
            ParentThumbImageTag: 'thumb-tag',
            ParentThumbItemId: 'thumb-owner',
            ProductionYear: 2026,
            SeriesName: 'Series',
            Type: 'Episode'
        });
    });

    it('uses a direct backdrop only when the hint identifies the item as its owner', () => {
        expect(mapPtvSearchHintToItem({
            BackdropImageItemId: 'movie-1',
            BackdropImageTag: 'backdrop-tag',
            Id: 'movie-1',
            Name: 'Movie',
            Type: 'Movie'
        })).toMatchObject({
            BackdropImageTags: ['backdrop-tag'],
            ParentBackdropImageTags: ['backdrop-tag'],
            ParentBackdropItemId: 'movie-1'
        });
    });

    it('preserves tagged Thumb fallback ownership when Primary artwork is unavailable', () => {
        expect(mapPtvSearchHintToItem({
            Id: 'episode-1',
            Name: 'Episode',
            ThumbImageItemId: 'series-1',
            ThumbImageTag: 'thumb-tag',
            Type: 'Episode'
        })).toMatchObject({
            Id: 'episode-1',
            ParentThumbItemId: 'series-1',
            ParentThumbImageTag: 'thumb-tag'
        });
        expect(mapPtvSearchHintToItem({
            Id: 'episode-1',
            Name: 'Episode',
            Type: 'Episode'
        })?.ImageTags).toBeUndefined();
    });

    it('groups supported types, removes duplicates, and prioritizes exact titles', () => {
        const grouped = groupPtvSearchHints([
            { Id: 'movie-2', Name: 'A Query Story', Type: 'Movie' },
            { Id: 'movie-1', Name: 'Query', Type: 'Movie' },
            { Id: 'movie-1', Name: 'Query duplicate', Type: 'Movie' },
            { Id: 'series-1', Name: 'Query Series', Type: 'Series' },
            { Id: 'album-1', Name: 'Query Album', Type: 'MusicAlbum' },
            { Id: 'artist-1', Name: 'Query Artist', Type: 'MusicArtist' },
            { Id: 'unsupported-1', Name: 'Query Genre', Type: 'Genre' }
        ], 'query', 14);

        expect(grouped.movies.map(item => item.Id)).toEqual(['movie-1', 'movie-2']);
        expect(grouped.shows.map(item => item.Id)).toEqual(['series-1']);
        expect(grouped.albums.map(item => item.Id)).toEqual(['album-1']);
        expect(grouped.artists.map(item => item.Id)).toEqual(['artist-1']);
        expect(Object.values(grouped).flat()).toHaveLength(5);
    });

    it('uses one coordinated Search Hints request for every supported group', async () => {
        requestPtvJson.mockResolvedValue({
            SearchHints: [
                { Id: 'movie-1', Name: 'Query', Type: 'Movie' },
                { Id: 'episode-1', Name: 'Query episode', Type: 'Episode' }
            ],
            TotalRecordCount: 2
        });
        const controller = createPtvAbortController();

        const result = await searchPtvHints({
            includeItemTypes: [
                'Movie',
                'Series',
                'BoxSet',
                'Episode',
                'Person',
                'Book',
                'Audio',
                'MusicAlbum',
                'MusicArtist'
            ],
            limit: 90,
            perGroupLimit: 14,
            query: 'query',
            serverId: 'server-1',
            signal: controller.signal,
            userId: 'user-1'
        });

        expect(requestPtvJson).toHaveBeenCalledTimes(1);
        expect(requestPtvJson).toHaveBeenCalledWith('Search/Hints', expect.objectContaining({
            params: expect.objectContaining({
                IncludeItemTypes: expect.stringContaining('MusicArtist'),
                SearchTerm: 'query',
                UserId: 'user-1'
            }),
            serverId: 'server-1',
            signal: controller.signal
        }));
        expect(result.groups.movies).toHaveLength(1);
        expect(result.groups.episodes).toHaveLength(1);
    });

    it('rejects with the coordinated request error so the page owns retry state', async () => {
        const error = new DOMException('cancelled', 'AbortError');
        requestPtvJson.mockRejectedValue(error);

        await expect(searchPtvHints({
            includeItemTypes: ['Movie'],
            limit: 90,
            perGroupLimit: 14,
            query: 'query',
            serverId: 'server-1',
            signal: createPtvAbortController().signal,
            userId: 'user-1'
        })).rejects.toBe(error);
    });

    it('scopes a focused filter to one bounded type request', async () => {
        requestPtvJson.mockResolvedValue({
            SearchHints: [],
            TotalRecordCount: 0
        });

        await searchPtvHints({
            includeItemTypes: ['Person'],
            limit: 14,
            perGroupLimit: 14,
            query: 'query',
            serverId: 'server-1',
            signal: createPtvAbortController().signal,
            userId: 'user-1'
        });

        expect(requestPtvJson).toHaveBeenCalledTimes(1);
        expect(requestPtvJson).toHaveBeenCalledWith('Search/Hints', expect.objectContaining({
            params: expect.objectContaining({
                IncludeItemTypes: 'Person',
                Limit: 14
            })
        }));
    });

    it('classifies aborts and transpiled timeout errors without relying on instanceof', () => {
        expect(getPtvSearchHintFailureKind({ name: 'AbortError' })).toBe('aborted');
        expect(getPtvSearchHintFailureKind({ name: 'PtvSearchAbortedError' })).toBe('aborted');
        expect(getPtvSearchHintFailureKind({ name: 'PtvSearchPrimaryTimeoutError' })).toBe('timeout');
        expect(getPtvSearchHintFailureKind(new Error('failed'))).toBe('error');
        expect(getPtvSearchHintFailureKind(new Error('aborted too late'), true)).toBe('timeout');
    });
});
