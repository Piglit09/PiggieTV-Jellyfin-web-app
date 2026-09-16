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
            { Id: 'facet-1', Name: 'Query Genre', Type: 'Genre' },
            { Id: 'facet-1', Name: 'Query Music Genre', Type: 'MusicGenre' },
            { Id: 'studio-1', Name: 'Query Studio', Type: 'Studio' }
        ], 'query', 14);

        expect(grouped.movies.map(item => item.Id)).toEqual(['movie-1', 'movie-2']);
        expect(grouped.shows.map(item => item.Id)).toEqual(['series-1']);
        expect(grouped.albums.map(item => item.Id)).toEqual(['album-1']);
        expect(grouped.artists.map(item => item.Id)).toEqual(['artist-1']);
        expect(grouped.genres.map(item => item.Type)).toEqual(['Genre', 'MusicGenre']);
        expect(grouped.studios.map(item => item.Id)).toEqual(['studio-1']);
        expect(Object.values(grouped).flat()).toHaveLength(8);
    });

    it('removes proven-empty duplicate Series and prefers the indexed exact-title copy', () => {
        const grouped = groupPtvSearchHints([
            { EpisodeCount: 0, Id: 'series-empty', Name: 'Digimon', ProductionYear: 1999, Type: 'Series' },
            { Id: 'series-unknown', Name: 'Digimon', ProductionYear: 1999, Type: 'Series' },
            { EpisodeCount: 54, Id: 'series-indexed', Name: 'Digimon', ProductionYear: 1999, Type: 'Series' },
            { EpisodeCount: 20, Id: 'series-remake', Name: 'Digimon', ProductionYear: 2020, Type: 'Series' }
        ], 'digimon', 14);

        expect(grouped.shows.map(item => item.Id)).toEqual(['series-indexed', 'series-remake']);
        expect(grouped.shows[0]?.RecursiveItemCount).toBe(54);
    });

    it('ranks Episode series context and music artist context without dropping unknown counts', () => {
        const grouped = groupPtvSearchHints([
            { Id: 'series-unknown', Name: 'Legacy Show', Type: 'Series' },
            { Id: 'episode-context', Name: 'Pilot', Series: 'Digimon', Type: 'Episode' },
            { Artists: ['Digimon'], Id: 'song-context', Name: 'Theme', Type: 'Audio' },
            { Id: 'episode-loose', Name: 'A Digimon Story', Type: 'Episode' }
        ], 'digimon', 14);

        expect(grouped.shows.map(item => item.Id)).toEqual(['series-unknown']);
        expect(grouped.episodes.map(item => item.Id)).toEqual(['episode-context', 'episode-loose']);
        expect(grouped.music.map(item => item.Id)).toEqual(['song-context']);
    });

    it('uses one coordinated Search Hints request for every supported group', async () => {
        requestPtvJson.mockResolvedValue({
            SearchHints: [
                { Id: 'movie-1', Name: 'Query', Type: 'Movie' },
                { Id: 'episode-1', Name: 'Query episode', Type: 'Episode' },
                { Id: 'genre-1', Name: 'Query genre', Type: 'Genre' },
                { Id: 'studio-1', Name: 'Query studio', Type: 'Studio' }
            ],
            TotalRecordCount: 4
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
                'Genre',
                'MusicGenre',
                'Studio',
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
                IncludeGenres: true,
                IncludeItemTypes: expect.stringContaining('MusicArtist'),
                IncludeStudios: true,
                SearchTerm: 'query',
                UserId: 'user-1'
            }),
            serverId: 'server-1',
            signal: controller.signal
        }));
        expect(result.groups.movies).toHaveLength(1);
        expect(result.groups.episodes).toHaveLength(1);
        expect(result.groups.genres).toEqual([
            expect.objectContaining({ Id: 'genre-1', ServerId: 'server-1' })
        ]);
        expect(result.groups.studios).toEqual([
            expect.objectContaining({ Id: 'studio-1', ServerId: 'server-1' })
        ]);
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
                IncludeArtists: false,
                IncludeGenres: false,
                IncludeItemTypes: 'Person',
                IncludeMedia: false,
                IncludePeople: true,
                IncludeStudios: false,
                Limit: 14
            })
        }));
    });

    it.each([
        {
            expectedGenres: true,
            expectedStudios: false,
            includeItemTypes: ['Genre', 'MusicGenre'],
            serializedTypes: 'Genre,MusicGenre'
        },
        {
            expectedGenres: false,
            expectedStudios: true,
            includeItemTypes: ['Studio'],
            serializedTypes: 'Studio'
        }
    ])('scopes a focused directory filter to its dedicated hint flags', async testCase => {
        requestPtvJson.mockResolvedValue({ SearchHints: [], TotalRecordCount: 0 });

        await searchPtvHints({
            includeItemTypes: testCase.includeItemTypes,
            limit: 14,
            perGroupLimit: 14,
            query: 'query',
            serverId: 'server-1',
            signal: createPtvAbortController().signal,
            userId: 'user-1'
        });

        expect(requestPtvJson).toHaveBeenCalledWith('Search/Hints', expect.objectContaining({
            params: expect.objectContaining({
                IncludeGenres: testCase.expectedGenres,
                IncludeItemTypes: testCase.serializedTypes,
                IncludeMedia: false,
                IncludePeople: false,
                IncludeStudios: testCase.expectedStudios,
                Limit: 14
            })
        }));
    });

    it('rejects malformed successful responses instead of caching them as empty', async () => {
        requestPtvJson.mockResolvedValue({ TotalRecordCount: 0 });

        await expect(searchPtvHints({
            includeItemTypes: ['Series'],
            limit: 14,
            perGroupLimit: 14,
            query: 'digimon',
            serverId: 'server-1',
            signal: createPtvAbortController().signal,
            userId: 'user-1'
        })).rejects.toThrow('invalid response');
    });

    it('classifies aborts and transpiled timeout errors without relying on instanceof', () => {
        expect(getPtvSearchHintFailureKind({ name: 'AbortError' })).toBe('aborted');
        expect(getPtvSearchHintFailureKind({ name: 'PtvSearchAbortedError' })).toBe('aborted');
        expect(getPtvSearchHintFailureKind({ name: 'PtvSearchPrimaryTimeoutError' })).toBe('timeout');
        expect(getPtvSearchHintFailureKind(new Error('failed'))).toBe('error');
        expect(getPtvSearchHintFailureKind(new Error('aborted too late'), true)).toBe('timeout');
    });
});
