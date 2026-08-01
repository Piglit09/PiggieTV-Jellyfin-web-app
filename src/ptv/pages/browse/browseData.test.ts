import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    getPtvItems: vi.fn(),
    getPtvUserViews: vi.fn(),
    requestPtvJson: vi.fn(),
    serverId: 'server',
    userId: 'user'
}));

vi.mock('../../api', () => ({
    getPtvCurrentUserId: vi.fn(() => apiMocks.userId),
    getPtvItems: apiMocks.getPtvItems,
    getPtvResumeItems: vi.fn(),
    getPtvServerId: vi.fn(() => apiMocks.serverId),
    getPtvUserViews: apiMocks.getPtvUserViews,
    requestPtvJson: apiMocks.requestPtvJson,
    serializePtvItemFieldProfile: vi.fn((profile: string) => profile)
}));

import {
    applyPtvBrowseScope,
    buildPtvFocusedBrowseQuery,
    findExactPtvBrowseDirectoryEntry,
    getPtvBrowseScopeIdentityKey,
    getPtvBrowseTrendingScore,
    getPtvFocusedBrowseCacheKey,
    loadPtvBrowseDirectory,
    loadPtvFocusedBrowsePage,
    loadPtvFocusedBrowsePages,
    isPtvBrowseScopeIdentityCurrent,
    rankPtvBrowseTrendingItems,
    resetPtvBrowseDataCachesForTests,
    resolvePtvBrowseScope,
    type PtvBrowseResolvedScope
} from './browseData';
import { createPtvAbortController } from '../../core/abortController';
import { parsePtvBrowseRoute } from './browseRoute';

const scopedAnime: PtvBrowseResolvedScope = {
    alias: 'anime',
    error: '',
    libraryIds: ['anime-library'],
    libraryNames: ['Anime'],
    status: 'resolved'
};

function createAbortableUserViewsMock(onSignal: (signal?: AbortSignal) => void) {
    return (options: { signal?: AbortSignal }) => {
        onSignal(options.signal);

        return new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
                const error = new Error('cancelled');

                error.name = 'AbortError';
                reject(error);
            }, { once: true });
        });
    };
}

describe('browseData', () => {
    beforeEach(() => {
        resetPtvBrowseDataCachesForTests();
        apiMocks.getPtvItems.mockReset();
        apiMocks.getPtvUserViews.mockReset();
        apiMocks.requestPtvJson.mockReset();
        apiMocks.serverId = 'server';
        apiMocks.userId = 'user';
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('resolves aliases and default kind pages to exact Jellyfin user-view IDs', async () => {
        apiMocks.getPtvUserViews.mockResolvedValue({
            Items: [
                { CollectionType: 'movies', Id: 'movies-library', Name: 'Movies Library' },
                { CollectionType: 'movies', Id: 'animovies-library', Name: 'AniMovies' },
                { CollectionType: 'tvshows', Id: 'shows-library', Name: 'Shows Library' },
                { CollectionType: 'tvshows', Id: 'anime-library', Name: 'Anime' },
                { CollectionType: 'tvshows', Id: 'cartoons-library', Name: 'Cartoons' }
            ]
        });

        await expect(resolvePtvBrowseScope(parsePtvBrowseRoute('/movies')))
            .resolves.toMatchObject({ alias: 'movies', libraryIds: ['movies-library'], status: 'resolved' });
        await expect(resolvePtvBrowseScope(parsePtvBrowseRoute('/shows')))
            .resolves.toMatchObject({ alias: 'shows', libraryIds: ['shows-library'], status: 'resolved' });
        await expect(resolvePtvBrowseScope(parsePtvBrowseRoute('/shows', '?topParentId=anime')))
            .resolves.toMatchObject({ libraryIds: ['anime-library'], status: 'resolved' });
        await expect(resolvePtvBrowseScope(parsePtvBrowseRoute('/movies', '?topParentId=animemovies')))
            .resolves.toMatchObject({ libraryIds: ['animovies-library'], status: 'resolved' });
        await expect(resolvePtvBrowseScope(parsePtvBrowseRoute('/shows', '?topParentId=cartoons')))
            .resolves.toMatchObject({ libraryIds: ['cartoons-library'], status: 'resolved' });
        await expect(resolvePtvBrowseScope(parsePtvBrowseRoute('/shows', '?topParentId=unknown')))
            .resolves.toMatchObject({ alias: 'unknown', error: 'The unknown library is not available for this account.', libraryIds: [], status: 'error' });
    });

    it('physically cancels user-view discovery when the route owner exits', async () => {
        const controller = createPtvAbortController();
        let transportSignal: AbortSignal | undefined;

        apiMocks.getPtvUserViews.mockImplementation(createAbortableUserViewsMock(signal => {
            transportSignal = signal;
        }));

        const request = resolvePtvBrowseScope(
            parsePtvBrowseRoute('/shows', '?topParentId=anime'),
            controller.signal
        );

        await vi.waitFor(() => expect(transportSignal).toBeDefined());
        controller.abort();

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(transportSignal?.aborted).toBe(true);
    });

    it('stores only bounded TTL values scoped to a complete display identity', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-28T12:00:00Z'));
        apiMocks.getPtvUserViews.mockImplementation(() => Promise.resolve({
            Items: [{ CollectionType: 'tvshows', Id: 'anime-library', Name: 'Anime' }]
        }));
        const route = parsePtvBrowseRoute('/shows', '?topParentId=anime');

        await resolvePtvBrowseScope(route);
        await resolvePtvBrowseScope(route);
        expect(apiMocks.getPtvUserViews).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(2 * 60 * 1000 + 1);
        await resolvePtvBrowseScope(route);
        expect(apiMocks.getPtvUserViews).toHaveBeenCalledTimes(2);

        for (let index = 0; index < 9; index += 1) {
            apiMocks.serverId = `server-${index}`;
            apiMocks.userId = `user-${index}`;
            await resolvePtvBrowseScope(route);
        }

        apiMocks.serverId = 'server';
        apiMocks.userId = 'user';
        await resolvePtvBrowseScope(route);

        expect(apiMocks.getPtvUserViews).toHaveBeenCalledTimes(12);
    });

    it('isolates scope values across account switches and skips incomplete identities', async () => {
        apiMocks.getPtvUserViews.mockImplementation(options => Promise.resolve({
            Items: [{
                CollectionType: 'tvshows',
                Id: `${options.serverId}-${options.userId}`,
                Name: 'Anime'
            }]
        }));
        const route = parsePtvBrowseRoute('/shows', '?topParentId=anime');

        const first = await resolvePtvBrowseScope(route);
        await resolvePtvBrowseScope(route);

        apiMocks.serverId = 'server-b';
        apiMocks.userId = 'user-b';
        const second = await resolvePtvBrowseScope(route);

        apiMocks.serverId = '';
        apiMocks.userId = '';
        await resolvePtvBrowseScope(route);
        await resolvePtvBrowseScope(route);

        expect(first.libraryIds).toEqual(['server-user']);
        expect(second.libraryIds).toEqual(['server-b-user-b']);
        expect(apiMocks.getPtvUserViews).toHaveBeenCalledTimes(4);
        expect(apiMocks.getPtvUserViews.mock.calls.map(([options]) => [
            options.serverId,
            options.userId
        ])).toEqual([
            ['server', 'user'],
            ['server-b', 'user-b'],
            [null, null],
            [null, null]
        ]);
    });

    it('invalidates an in-flight scope owner when the active identity changes', () => {
        const userAIdentity = getPtvBrowseScopeIdentityKey();

        expect(isPtvBrowseScopeIdentityCurrent(userAIdentity)).toBe(true);

        apiMocks.serverId = 'server-b';
        apiMocks.userId = 'user-b';

        expect(getPtvBrowseScopeIdentityKey()).not.toBe(userAIdentity);
        expect(isPtvBrowseScopeIdentityCurrent(userAIdentity)).toBe(false);
    });

    it('delegates concurrent in-flight deduplication instead of caching a promise', async () => {
        let resolveViews!: (value: {
            Items: Array<{ CollectionType: string; Id: string; Name: string }>;
        }) => void;
        const response = new Promise<{
            Items: Array<{ CollectionType: string; Id: string; Name: string }>;
        }>(resolve => {
            resolveViews = resolve;
        });

        apiMocks.getPtvUserViews.mockReturnValue(response);
        const route = parsePtvBrowseRoute('/shows', '?topParentId=anime');
        const first = resolvePtvBrowseScope(route);
        const second = resolvePtvBrowseScope(route);

        expect(apiMocks.getPtvUserViews).toHaveBeenCalledTimes(2);

        resolveViews({
            Items: [{ CollectionType: 'tvshows', Id: 'anime-library', Name: 'Anime' }]
        });

        await expect(first).resolves.toMatchObject({ status: 'resolved' });
        await expect(second).resolves.toMatchObject({ status: 'resolved' });
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

    it('delegates in-flight directory consumers and reuses the completed Browse metadata value', async () => {
        let resolve!: (value: { Items: Array<{ ChildCount: number; Id: string; Name: string }> }) => void;
        const response = new Promise<{ Items: Array<{ ChildCount: number; Id: string; Name: string }> }>(
            complete => {
                resolve = complete;
            }
        );
        apiMocks.requestPtvJson.mockReturnValue(response);
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

        expect(apiMocks.requestPtvJson).toHaveBeenCalledTimes(2);
        expect(apiMocks.requestPtvJson.mock.calls[0]).toEqual([
            'Genres',
            expect.objectContaining({
                params: expect.objectContaining({
                    IncludeItemTypes: 'Movie',
                    userId: 'user'
                }),
                serverId: 'server'
            })
        ]);

        resolve({
            Items: [{ ChildCount: 1, Id: 'genre-id', Name: 'Genre' }]
        });

        await expect(first).resolves.toEqual([{ count: 1, id: 'genre-id', name: 'Genre' }]);
        await expect(second).resolves.toEqual([{ count: 1, id: 'genre-id', name: 'Genre' }]);
        await expect(loadPtvBrowseDirectory(route, scope, 'genre'))
            .resolves.toEqual([{ count: 1, id: 'genre-id', name: 'Genre' }]);
        expect(apiMocks.requestPtvJson).toHaveBeenCalledTimes(2);
    });

    it('cancels a retired route consumer while its shared metadata owner completes for reuse', async () => {
        const controller = createPtvAbortController();
        let resolve!: (value: { Items: Array<{ ChildCount: number; Id: string; Name: string }> }) => void;
        const response = new Promise<{ Items: Array<{ ChildCount: number; Id: string; Name: string }> }>(
            complete => {
                resolve = complete;
            }
        );

        apiMocks.requestPtvJson.mockReturnValue(response);

        const request = loadPtvBrowseDirectory(
            parsePtvBrowseRoute('/shows'),
            {
                alias: '',
                error: '',
                libraryIds: [],
                libraryNames: [],
                status: 'unscoped'
            },
            'studio',
            controller.signal
        );

        await vi.waitFor(() => expect(apiMocks.requestPtvJson).toHaveBeenCalledTimes(1));
        expect(apiMocks.requestPtvJson.mock.calls[0]?.[1]).not.toHaveProperty('signal');
        controller.abort();

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });

        resolve({
            Items: [{ ChildCount: 3, Id: 'studio-id', Name: 'Studio' }]
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await expect(loadPtvBrowseDirectory(
            parsePtvBrowseRoute('/shows'),
            {
                alias: '',
                error: '',
                libraryIds: [],
                libraryNames: [],
                status: 'unscoped'
            },
            'studio'
        )).resolves.toEqual([{ count: 3, id: 'studio-id', name: 'Studio' }]);
        expect(apiMocks.requestPtvJson).toHaveBeenCalledTimes(1);
    });

    it('isolates directory reuse by display identity, media kind, scope, and type', async () => {
        apiMocks.requestPtvJson.mockImplementation(async endpoint => ({
            Items: [{
                ChildCount: 1,
                Id: `${apiMocks.serverId}-${apiMocks.userId}-${endpoint}`,
                Name: `${apiMocks.userId}-${endpoint}`
            }]
        }));
        const movieRoute = parsePtvBrowseRoute('/movies');
        const showRoute = parsePtvBrowseRoute('/shows');
        const unscoped: PtvBrowseResolvedScope = {
            alias: '',
            error: '',
            libraryIds: [],
            libraryNames: [],
            status: 'unscoped'
        };

        await loadPtvBrowseDirectory(movieRoute, unscoped, 'genre');
        await loadPtvBrowseDirectory(movieRoute, unscoped, 'genre');
        await loadPtvBrowseDirectory(movieRoute, unscoped, 'studio');
        await loadPtvBrowseDirectory(showRoute, unscoped, 'genre');
        await loadPtvBrowseDirectory(showRoute, scopedAnime, 'genre');
        apiMocks.userId = 'user-b';
        await loadPtvBrowseDirectory(movieRoute, unscoped, 'genre');

        expect(apiMocks.requestPtvJson).toHaveBeenCalledTimes(5);
    });

    it('does not cache a directory completion after its display identity retires', async () => {
        let resolve!: (value: { Items: Array<{ ChildCount: number; Id: string; Name: string }> }) => void;
        const response = new Promise<{ Items: Array<{ ChildCount: number; Id: string; Name: string }> }>(
            complete => {
                resolve = complete;
            }
        );
        const route = parsePtvBrowseRoute('/movies');
        const scope: PtvBrowseResolvedScope = {
            alias: '',
            error: '',
            libraryIds: [],
            libraryNames: [],
            status: 'unscoped'
        };

        apiMocks.requestPtvJson.mockReturnValue(response);
        const userARequest = loadPtvBrowseDirectory(route, scope, 'genre');

        apiMocks.userId = 'user-b';
        resolve({
            Items: [{ ChildCount: 2, Id: 'genre-id', Name: 'Genre' }]
        });
        await expect(userARequest).resolves.toHaveLength(1);

        apiMocks.userId = 'user';
        await expect(loadPtvBrowseDirectory(route, scope, 'genre')).resolves.toHaveLength(1);

        expect(apiMocks.requestPtvJson).toHaveBeenCalledTimes(2);
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

    it('scopes focused display cache keys to the active server and user', () => {
        const route = parsePtvBrowseRoute('/movies', '?view=latest');
        const userAKey = getPtvFocusedBrowseCacheKey(route, scopedAnime);

        apiMocks.userId = 'user-b';
        const userBKey = getPtvFocusedBrowseCacheKey(route, scopedAnime);
        apiMocks.userId = 'user';
        apiMocks.serverId = 'server-b';
        const serverBKey = getPtvFocusedBrowseCacheKey(route, scopedAnime);

        expect(userBKey).not.toBe(userAKey);
        expect(serverBKey).not.toBe(userAKey);
    });

    it('starts fresh focused work after an account switch without a module reload', async () => {
        const route = parsePtvBrowseRoute('/movies', '?view=latest');

        apiMocks.getPtvItems.mockResolvedValue({
            Items: [{ Id: 'movie' }],
            TotalRecordCount: 1
        });

        await loadPtvFocusedBrowsePage(route, scopedAnime);
        await loadPtvFocusedBrowsePage(route, scopedAnime);
        expect(apiMocks.getPtvItems).toHaveBeenCalledTimes(1);

        apiMocks.userId = 'user-b';
        await loadPtvFocusedBrowsePage(route, scopedAnime);

        expect(apiMocks.getPtvItems).toHaveBeenCalledTimes(2);
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
