import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    apiClient: null as null | {
        getGenres?: ReturnType<typeof vi.fn>;
        getStudios?: ReturnType<typeof vi.fn>;
    },
    getPtvItems: vi.fn(),
    getPtvUserViews: vi.fn()
}));
const coordinatorState = vi.hoisted(() => ({
    inFlight: new Map<string, Promise<unknown>>()
}));

vi.mock('../../api', () => ({
    getCurrentPtvApiClient: vi.fn(() => apiMocks.apiClient),
    getPtvApiUrl: vi.fn((endpoint: string, query: Record<string, unknown>) => (
        `${endpoint}:${JSON.stringify(query)}`
    )),
    getPtvCurrentUserId: vi.fn(() => 'user'),
    getPtvItems: apiMocks.getPtvItems,
    getPtvResumeItems: vi.fn(),
    getPtvServerId: vi.fn(() => 'server'),
    getPtvUserViews: apiMocks.getPtvUserViews,
    serializePtvItemFieldProfile: vi.fn((profile: string) => profile)
}));
vi.mock('../../services/requestCoordinator', () => ({
    coordinatePtvJsonRequest<T>(key: string, task: () => Promise<T>): Promise<T> {
        const existing = coordinatorState.inFlight.get(key) as Promise<T> | undefined;
        if (existing) return existing;

        const promise = task().finally(() => {
            if (coordinatorState.inFlight.get(key) === promise) {
                coordinatorState.inFlight.delete(key);
            }
        });
        coordinatorState.inFlight.set(key, promise);

        return promise;
    },
    getPtvRequestCoordinatorKey(method: string, identity: string, includeAuthorization: boolean) {
        return `${method} ${includeAuthorization ? 'auth' : 'anon'} ${identity}`;
    }
}));

import {
    applyPtvBrowseScope,
    buildPtvFocusedBrowseQuery,
    findExactPtvBrowseDirectoryEntry,
    getPtvBrowseTrendingScore,
    getPtvFocusedBrowseCacheKey,
    loadPtvBrowseDirectory,
    loadPtvFocusedBrowsePage,
    loadPtvFocusedBrowsePages,
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
        apiMocks.apiClient = null;
        apiMocks.getPtvItems.mockReset();
        apiMocks.getPtvUserViews.mockReset();
        coordinatorState.inFlight.clear();
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
        }, '4kids-studio-id')).toMatchObject({
            StudioIds: '4kids-studio-id',
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

    it('sends the exact original genre value without presentation normalization', () => {
        const route = parsePtvBrowseRoute('/movies', '?view=genre&genre=sCi-Fi');
        const query = buildPtvFocusedBrowseQuery(route, {
            alias: '', error: '', libraryIds: [], libraryNames: [], status: 'unscoped'
        });

        expect(query.Genres).toBe('sCi-Fi');
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

    it('shares an exact in-flight metadata-directory request', async () => {
        let resolve!: (value: { Items: Array<{ ChildCount: number; Id: string; Name: string }> }) => void;
        const response = new Promise<{ Items: Array<{ ChildCount: number; Id: string; Name: string }> }>(
            complete => {
                resolve = complete;
            }
        );
        const getGenres = vi.fn(() => response);
        apiMocks.apiClient = { getGenres };
        const route = parsePtvBrowseRoute('/movies', '?view=genres');
        const scope: PtvBrowseResolvedScope = {
            alias: '',
            error: '',
            libraryIds: [],
            libraryNames: [],
            status: 'unscoped'
        };

        const first = loadPtvBrowseDirectory(route, scope, 'genre');
        const second = loadPtvBrowseDirectory(route, scope, 'genre');

        expect(getGenres).toHaveBeenCalledTimes(1);

        resolve({
            Items: [{ ChildCount: 1, Id: 'genre-id', Name: 'Genre' }]
        });

        await expect(first).resolves.toEqual([{ count: 1, id: 'genre-id', name: 'Genre' }]);
        await expect(second).resolves.toEqual([{ count: 1, id: 'genre-id', name: 'Genre' }]);
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

    it('accumulates page two only from the matching filter identity', async () => {
        apiMocks.getPtvItems.mockImplementation(async query => ({
            Items: [{ Id: `${query.Genres}-${query.StartIndex}` }],
            TotalRecordCount: 100
        }));
        const horrorPageTwo = parsePtvBrowseRoute('/movies', '?view=genre&genre=Horror&page=1');
        const result = await loadPtvFocusedBrowsePages(horrorPageTwo, {
            alias: '', error: '', libraryIds: [], libraryNames: [], status: 'unscoped'
        });

        expect(result.items.map(item => item.Id)).toEqual(['Horror-0', 'Horror-50']);
        expect(apiMocks.getPtvItems).toHaveBeenCalledTimes(2);
        expect(apiMocks.getPtvItems.mock.calls.map(([query]) => query.Genres)).toEqual(['Horror', 'Horror']);
        expect(apiMocks.getPtvItems.mock.calls.map(([query]) => query.StartIndex)).toEqual([0, 50]);
    });

    it('restores a cached prior filter without mixing the intervening filter', async () => {
        apiMocks.getPtvItems.mockImplementation(async query => ({
            Items: [{ Id: `${query.Genres}-item` }],
            TotalRecordCount: 1
        }));
        const scope: PtvBrowseResolvedScope = {
            alias: '', error: '', libraryIds: [], libraryNames: [], status: 'unscoped'
        };
        const crime = parsePtvBrowseRoute('/movies', '?view=genre&genre=Crime');
        const horror = parsePtvBrowseRoute('/movies', '?view=genre&genre=Horror');

        await expect(loadPtvFocusedBrowsePage(crime, scope)).resolves.toMatchObject({
            items: [{ Id: 'Crime-item' }]
        });
        await expect(loadPtvFocusedBrowsePage(horror, scope)).resolves.toMatchObject({
            items: [{ Id: 'Horror-item' }]
        });
        await expect(loadPtvFocusedBrowsePage(crime, scope)).resolves.toMatchObject({
            items: [{ Id: 'Crime-item' }]
        });
        expect(apiMocks.getPtvItems).toHaveBeenCalledTimes(2);
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
