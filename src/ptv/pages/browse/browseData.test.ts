import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    getPtvUserViews: vi.fn()
}));

vi.mock('../../api', () => ({
    getCurrentPtvApiClient: vi.fn(() => null),
    getPtvCurrentUserId: vi.fn(() => 'user'),
    getPtvItems: vi.fn(),
    getPtvResumeItems: vi.fn(),
    getPtvServerId: vi.fn(() => 'server'),
    getPtvUserViews: apiMocks.getPtvUserViews,
    serializePtvItemFieldProfile: vi.fn((profile: string) => profile)
}));

import {
    applyPtvBrowseScope,
    buildPtvFocusedBrowseQuery,
    findExactPtvBrowseDirectoryEntry,
    getPtvBrowseTrendingScore,
    getPtvFocusedBrowseCacheKey,
    rankPtvBrowseTrendingItems,
    resetPtvBrowseDataCachesForTests,
    resolvePtvBrowseScope,
    type PtvBrowseResolvedScope
} from './browseData';
import { parsePtvBrowseRoute } from './browseRoute';

const scopedAnime: PtvBrowseResolvedScope = {
    alias: 'anime',
    error: '',
    libraryIds: ['anime-library'],
    libraryNames: ['Anime'],
    status: 'resolved'
};

describe('browseData', () => {
    beforeEach(() => {
        resetPtvBrowseDataCachesForTests();
        apiMocks.getPtvUserViews.mockReset();
    });

    it('resolves aliases to exact Jellyfin user-view IDs and rejects unknown scopes', async () => {
        apiMocks.getPtvUserViews.mockResolvedValue({
            Items: [
                { CollectionType: 'tvshows', Id: 'anime-library', Name: 'Anime' },
                { CollectionType: 'movies', Id: 'anime-movies-library', Name: 'Anime Movies' },
                { CollectionType: 'tvshows', Id: 'cartoon-library', Name: 'Cartoons' }
            ]
        });

        await expect(resolvePtvBrowseScope(parsePtvBrowseRoute('/shows', '?topParentId=anime')))
            .resolves.toMatchObject({ libraryIds: ['anime-library'], status: 'resolved' });
        await expect(resolvePtvBrowseScope(parsePtvBrowseRoute('/movies', '?topParentId=animemovies')))
            .resolves.toMatchObject({ libraryIds: ['anime-movies-library'], status: 'resolved' });
        await expect(resolvePtvBrowseScope(parsePtvBrowseRoute('/shows', '?topParentId=cartoons')))
            .resolves.toMatchObject({ libraryIds: ['cartoon-library'], status: 'resolved' });
        await expect(resolvePtvBrowseScope(parsePtvBrowseRoute('/shows', '?topParentId=unknown')))
            .resolves.toMatchObject({ libraryIds: [], status: 'error' });
    });

    it('applies resolved library scope before server pagination', () => {
        expect(applyPtvBrowseScope({ Limit: 50, StartIndex: 50 }, scopedAnime)).toEqual({
            Limit: 50,
            ParentId: 'anime-library',
            StartIndex: 50
        });
    });

    it('preserves selected parents while enforcing the resolved library ancestor', () => {
        expect(applyPtvBrowseScope({ ParentId: 'series-id' }, scopedAnime)).toEqual({
            AncestorIds: 'anime-library',
            ParentId: 'series-id'
        });
    });

    it('maps exact structured filters and paging to Jellyfin query fields', () => {
        const genreRoute = parsePtvBrowseRoute('/shows', '?topParentId=anime&view=genre&genre=Drama&page=2');
        const networkRoute = parsePtvBrowseRoute('/shows', '?view=network&network=HBO');

        expect(buildPtvFocusedBrowseQuery(genreRoute, scopedAnime)).toMatchObject({
            Genres: 'Drama',
            Limit: 50,
            ParentId: 'anime-library',
            StartIndex: 100
        });
        expect(buildPtvFocusedBrowseQuery(networkRoute, {
            alias: '', error: '', libraryIds: [], libraryNames: [], status: 'unscoped'
        }, 'network-id')).toMatchObject({
            StudioIds: 'network-id',
            StartIndex: 0
        });
        expect(buildPtvFocusedBrowseQuery(
            parsePtvBrowseRoute('/movies', '?view=latest'),
            { alias: '', error: '', libraryIds: [], libraryNames: [], status: 'unscoped' }
        )).toMatchObject({
            SortBy: 'DateCreated',
            SortOrder: 'Descending'
        });
    });

    it('uses the resolved Universal Pictures studio ID before paging without text search', () => {
        const route = parsePtvBrowseRoute(
            '/movies',
            '?view=studio&studio=Universal%20Pictures&page=1'
        );
        const query = buildPtvFocusedBrowseQuery(route, {
            alias: '', error: '', libraryIds: [], libraryNames: [], status: 'unscoped'
        }, 'universal-pictures-id');

        expect(query).toMatchObject({
            Limit: 50,
            StartIndex: 50,
            StudioIds: 'universal-pictures-id'
        });
        expect(query).not.toHaveProperty('SearchTerm');
    });

    it('matches metadata directory entries exactly', () => {
        const entries = [{ count: 10, id: 'studio-id', name: 'Warner Bros.' }];

        expect(findExactPtvBrowseDirectoryEntry(entries, 'warner bros.')).toEqual(entries[0]);
        expect(findExactPtvBrowseDirectoryEntry(entries, 'Warner')).toBeNull();
    });

    it('keys focused results by resolved scope, filters, sort, and page', () => {
        const firstPage = parsePtvBrowseRoute('/shows', '?topParentId=anime&view=genre&genre=Drama&page=0');
        const secondPage = parsePtvBrowseRoute('/shows', '?topParentId=anime&view=genre&genre=Drama&page=1');
        const otherScope = { ...scopedAnime, libraryIds: ['other-library'] };

        expect(getPtvFocusedBrowseCacheKey(firstPage, scopedAnime))
            .not.toBe(getPtvFocusedBrowseCacheKey(secondPage, scopedAnime));
        expect(getPtvFocusedBrowseCacheKey(firstPage, scopedAnime))
            .not.toBe(getPtvFocusedBrowseCacheKey(firstPage, otherScope));
        expect(getPtvFocusedBrowseCacheKey(firstPage, scopedAnime))
            .not.toBe(getPtvFocusedBrowseCacheKey({ ...firstPage, sortOrder: 'Descending' }, scopedAnime));
    });

    it('uses a deterministic library-data trending score', () => {
        const now = Date.parse('2026-07-14T12:00:00Z');
        const popular = {
            Id: 'popular',
            Name: 'Popular',
            UserData: { IsFavorite: true, PlayCount: 4, Played: true }
        };
        const newItem = {
            DateCreated: '2026-07-14T10:00:00Z',
            Id: 'new',
            Name: 'New',
            UserData: { PlayCount: 1 }
        };

        expect(getPtvBrowseTrendingScore(popular, now)).toBeGreaterThan(getPtvBrowseTrendingScore(newItem, now));
        expect(rankPtvBrowseTrendingItems([newItem, popular], now).map(item => item.Id))
            .toEqual(['popular', 'new']);
    });
});
