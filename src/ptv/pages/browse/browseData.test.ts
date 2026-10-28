import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    getPtvItems: vi.fn(),
    getPtvResumeItems: vi.fn(),
    getPtvUserViews: vi.fn(),
    requestPtvJson: vi.fn(),
    serverId: 'server',
    userId: 'user'
}));

vi.mock('../../api', () => ({
    getPtvCurrentUserId: vi.fn(() => apiMocks.userId),
    getPtvItems: apiMocks.getPtvItems,
    getPtvResumeItems: apiMocks.getPtvResumeItems,
    getPtvServerId: vi.fn(() => apiMocks.serverId),
    getPtvUserViews: apiMocks.getPtvUserViews,
    requestPtvJson: apiMocks.requestPtvJson,
    serializePtvItemFieldProfile: vi.fn((profile: string) => profile)
}));

import {
    applyPtvBrowseScope,
    buildPtvFocusedBrowseQuery,
    findExactPtvBrowseDirectoryEntry,
    getPtvBrowseScopedItems,
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

async function resolveGroupedShowsScope() {
    apiMocks.getPtvUserViews.mockResolvedValue({
        Items: [{ CollectionType: 'tvshows', Id: 'grouped-shows-view', Name: 'TV Shows', Type: 'UserView' }]
    });

    return resolvePtvBrowseScope(parsePtvBrowseRoute('/shows'));
}

describe('browseData', () => {
    beforeEach(() => {
        resetPtvBrowseDataCachesForTests();
        apiMocks.getPtvItems.mockReset();
        apiMocks.getPtvResumeItems.mockReset();
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

    it('does not emit an unsupported AncestorIds parameter for a nested parent', () => {
        expect(applyPtvBrowseScope({ ParentId: 'series-id' }, scopedAnime)).toEqual({
            ParentId: 'series-id'
        });
    });

    it('fails closed before constructing a query for an unavailable library', () => {
        expect(() => applyPtvBrowseScope({}, {
            ...scopedAnime, error: 'Anime unavailable', libraryIds: [], status: 'error'
        })).toThrow('Anime unavailable');
    });

    it('never reads global items or directories for a failed library scope', async () => {
        const scope: PtvBrowseResolvedScope = {
            ...scopedAnime, error: 'Anime unavailable', libraryIds: [], status: 'error'
        };
        const route = parsePtvBrowseRoute('/shows', '?topParentId=anime&view=latest');
        apiMocks.getPtvItems.mockResolvedValue({ Items: [{ Id: 'foreign-show' }] });
        apiMocks.requestPtvJson.mockResolvedValue({ Items: [{ Id: 'foreign-genre' }] });

        await expect(loadPtvFocusedBrowsePage(route, scope)).rejects.toThrow('Anime unavailable');
        await expect(loadPtvBrowseDirectory(route, scope, 'genre')).rejects.toThrow('Anime unavailable');
        expect(apiMocks.getPtvItems).not.toHaveBeenCalled();
        expect(apiMocks.requestPtvJson).not.toHaveBeenCalled();
    });

    it('reads each resolved root instead of relying on unsupported multi-root AncestorIds', async () => {
        const scope = { ...scopedAnime, libraryIds: ['anime-a', 'anime-b'] };
        apiMocks.getPtvItems.mockImplementation(async query => ({
            Items: [{ Id: query.ParentId ? `${query.ParentId}-series` : 'foreign-show', Type: 'Series' }],
            TotalRecordCount: 1
        }));

        const result = await loadPtvFocusedBrowsePage(
            parsePtvBrowseRoute('/shows', '?topParentId=anime&view=latest'), scope
        );
        expect(result.items.map(item => item.Id).sort((a, b) => String(a).localeCompare(String(b))))
            .toEqual(['anime-a-series', 'anime-b-series']);
        expect(apiMocks.getPtvItems.mock.calls.map(([query]) => query.ParentId).sort((a, b) => String(a).localeCompare(String(b))))
            .toEqual(['anime-a', 'anime-b']);
        for (const [query] of apiMocks.getPtvItems.mock.calls) {
            expect(query).not.toHaveProperty('AncestorIds');
            expect(query).not.toHaveProperty('Ids');
        }
    });

    it('rejects a nested parent belonging to a different library', async () => {
        apiMocks.requestPtvJson.mockResolvedValue([{ Id: 'shows-library' }]);
        apiMocks.getPtvItems.mockResolvedValue({ Items: [{ Id: 'foreign-season' }] });
        const route = { ...parsePtvBrowseRoute('/shows', '?topParentId=anime'), view: 'season' as const, seasonParentId: 'foreign-series' };

        await expect(loadPtvFocusedBrowsePage(route, scopedAnime)).rejects.toThrow(/outside.*library/i);
        expect(apiMocks.getPtvItems).not.toHaveBeenCalled();
    });

    it('rechecks identity after the awaited nested proof helper and before starting the child read', async () => {
        const retireIdentity = () => {
            apiMocks.userId = 'user-b';
        };
        apiMocks.requestPtvJson.mockImplementation(() => {
            const response = Promise.resolve([{ Id: 'anime-library' }]);
            void response.then(() => {
                void Promise.resolve().then(retireIdentity);
            });
            return response;
        });
        apiMocks.getPtvItems.mockResolvedValue({ Items: [{ Id: 'season', Type: 'Season' }] });

        await expect(getPtvBrowseScopedItems({ ParentId: 'anime-series', IncludeItemTypes: 'Season' }, scopedAnime))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(apiMocks.getPtvItems).not.toHaveBeenCalled();
    });

    it('verifies a nested parent through user-aware ancestors before reading its children', async () => {
        apiMocks.requestPtvJson.mockResolvedValue([{ Id: 'anime-library' }]);
        apiMocks.getPtvItems.mockResolvedValue({ Items: [{ Id: 'anime-season' }] });
        const route = { ...parsePtvBrowseRoute('/shows', '?topParentId=anime'), view: 'season' as const, seasonParentId: 'anime-series' };

        await expect(loadPtvFocusedBrowsePage(route, scopedAnime)).resolves.toMatchObject({ items: [{ Id: 'anime-season' }] });
        expect(apiMocks.requestPtvJson).toHaveBeenCalledWith('Items/anime-series/Ancestors', expect.objectContaining({ params: { userId: 'user' } }));
        expect(apiMocks.getPtvItems.mock.calls[0][0]).toMatchObject({ ParentId: 'anime-series', Recursive: false });
        expect(apiMocks.getPtvItems.mock.calls[0][0]).not.toHaveProperty('AncestorIds');
    });

    it.each(['serverId', 'userId'] as const)('discards a scoped root response after its %s changes', async identityField => {
        let resolveItems!: (value: { Items: Array<{ Id: string }> }) => void;
        const response = new Promise<{ Items: Array<{ Id: string }> }>(resolve => {
            resolveItems = resolve;
        });
        apiMocks.getPtvItems.mockReturnValue(response);

        const request = getPtvBrowseScopedItems({ Limit: 2 }, scopedAnime);
        expect(apiMocks.getPtvItems).toHaveBeenCalledWith(
            { Limit: 2, ParentId: 'anime-library' },
            expect.objectContaining({ serverId: 'server', userId: 'user' })
        );

        apiMocks[identityField] = 'retired-identity';
        resolveItems({ Items: [{ Id: 'old-account-series' }] });

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('stops root fanout when the display identity retires during the first read', async () => {
        let resolveItems!: (value: { Items: Array<{ Id: string }> }) => void;
        const response = new Promise<{ Items: Array<{ Id: string }> }>(resolve => {
            resolveItems = resolve;
        });
        apiMocks.getPtvItems.mockReturnValue(response);

        const request = getPtvBrowseScopedItems({ Limit: 2 }, {
            ...scopedAnime, libraryIds: ['anime-a', 'anime-b']
        });
        expect(apiMocks.getPtvItems).toHaveBeenCalledTimes(1);
        apiMocks.userId = 'user-b';
        resolveItems({ Items: [{ Id: 'old-account-series' }] });

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(apiMocks.getPtvItems.mock.calls.map(([query]) => query.ParentId)).toEqual(['anime-a']);
    });

    it('does not read children after the display identity retires during ancestry verification', async () => {
        let resolveAncestors!: (value: Array<{ Id: string }>) => void;
        const response = new Promise<Array<{ Id: string }>>(resolve => {
            resolveAncestors = resolve;
        });
        apiMocks.requestPtvJson.mockReturnValue(response);

        const request = getPtvBrowseScopedItems({ ParentId: 'anime-series', Recursive: false }, scopedAnime);
        apiMocks.userId = 'user-b';
        resolveAncestors([{ Id: 'anime-library' }]);

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(apiMocks.getPtvItems).not.toHaveBeenCalled();
        expect(apiMocks.getPtvResumeItems).not.toHaveBeenCalled();
    });

    it.each([false, true])('rejects explicit item IDs before membership or item API reads (resume=%s)', async resume => {
        await expect(getPtvBrowseScopedItems({
            Ids: 'foreign-show', ParentId: 'anime-series', Limit: 2
        }, scopedAnime, undefined, resume)).rejects.toThrow(/cannot establish library membership/i);

        expect(apiMocks.requestPtvJson).not.toHaveBeenCalled();
        expect(apiMocks.getPtvItems).not.toHaveBeenCalled();
        expect(apiMocks.getPtvResumeItems).not.toHaveBeenCalled();
    });

    it('merges and deduplicates bounded root reads before applying the requested page', async () => {
        const rootItems: Record<string, Array<{ Id: string; SortName: string }>> = {
            'anime-a': [
                { Id: 'anime-a-alpha', SortName: 'Alpha' },
                { Id: 'shared-charlie', SortName: 'Charlie' },
                { Id: 'anime-a-echo', SortName: 'Echo' },
                { Id: 'anime-a-golf', SortName: 'Golf' },
                { Id: 'anime-a-india', SortName: 'India' }
            ],
            'anime-b': [
                { Id: 'anime-b-bravo', SortName: 'Bravo' },
                { Id: 'shared-charlie', SortName: 'Charlie' },
                { Id: 'anime-b-delta', SortName: 'Delta' },
                { Id: 'anime-b-foxtrot', SortName: 'Foxtrot' },
                { Id: 'anime-b-hotel', SortName: 'Hotel' }
            ]
        };
        apiMocks.getPtvItems.mockImplementation(async query => {
            const items = rootItems[query.ParentId] || [{ Id: 'foreign-show', SortName: 'Foreign' }];

            return { Items: items.slice(query.StartIndex, query.StartIndex + query.Limit), TotalRecordCount: items.length };
        });

        const result = await getPtvBrowseScopedItems({
            AncestorIds: 'foreign-library', IncludeItemTypes: 'Series', Limit: 2,
            Recursive: true, SortBy: 'SortName', SortOrder: 'Ascending', StartIndex: 2
        }, { ...scopedAnime, libraryIds: ['anime-a', 'anime-b'] });

        expect(result.Items?.map(item => item.Id)).toEqual(['shared-charlie', 'anime-b-delta']);
        expect(result.TotalRecordCount).toBe(10);
        expect(apiMocks.getPtvItems.mock.calls.map(([query]) => query)).toEqual([
            { IncludeItemTypes: 'Series', Limit: 4, ParentId: 'anime-a', Recursive: true, SortBy: 'SortName', SortOrder: 'Ascending', StartIndex: 0 },
            { IncludeItemTypes: 'Series', Limit: 4, ParentId: 'anime-b', Recursive: true, SortBy: 'SortName', SortOrder: 'Ascending', StartIndex: 0 }
        ]);
        expect(apiMocks.getPtvResumeItems).not.toHaveBeenCalled();
    });

    it('waits for each root read before starting the next root', async () => {
        let resolveItems!: (value: { Items: Array<{ Id: string }> }) => void;
        const firstResponse = new Promise<{ Items: Array<{ Id: string }> }>(resolve => {
            resolveItems = resolve;
        });
        apiMocks.getPtvItems.mockReturnValueOnce(firstResponse).mockResolvedValueOnce({ Items: [{ Id: 'anime-b-series' }] });

        const request = getPtvBrowseScopedItems({ Limit: 2 }, {
            ...scopedAnime, libraryIds: ['anime-a', 'anime-b']
        });

        expect(apiMocks.getPtvItems.mock.calls.map(([query]) => query.ParentId)).toEqual(['anime-a']);
        resolveItems({ Items: [{ Id: 'anime-a-series' }] });
        const result = await request;

        expect(result.Items?.map(item => item.Id)).toEqual(['anime-a-series', 'anime-b-series']);
        expect(apiMocks.getPtvItems.mock.calls.map(([query]) => query.ParentId)).toEqual(['anime-a', 'anime-b']);
    });

    it('pages merged resume results by LastPlayedDate using only bounded per-root resume reads', async () => {
        const rootItems: Record<string, Array<{ Id: string; UserData: { LastPlayedDate: string } }>> = {
            'anime-a': [
                { Id: 'shared-episode', UserData: { LastPlayedDate: '2026-09-28T10:00:00Z' } },
                { Id: 'anime-a-older', UserData: { LastPlayedDate: '2026-09-28T08:00:00Z' } },
                { Id: 'anime-a-oldest', UserData: { LastPlayedDate: '2026-09-28T06:00:00Z' } }
            ],
            'anime-b': [
                { Id: 'anime-b-newest', UserData: { LastPlayedDate: '2026-09-28T11:00:00Z' } },
                { Id: 'shared-episode', UserData: { LastPlayedDate: '2026-09-28T10:00:00Z' } },
                { Id: 'anime-b-middle', UserData: { LastPlayedDate: '2026-09-28T09:00:00Z' } }
            ]
        };
        apiMocks.getPtvResumeItems.mockImplementation(async query => {
            const items = rootItems[query.ParentId] || [];

            return { Items: items.slice(query.StartIndex, query.StartIndex + query.Limit), TotalRecordCount: items.length };
        });

        const result = await getPtvBrowseScopedItems({
            Filters: 'IsResumable', IncludeItemTypes: 'Episode,Series', Limit: 2,
            SortBy: 'DatePlayed,DateCreated', SortOrder: 'Descending', StartIndex: 1
        }, { ...scopedAnime, libraryIds: ['anime-a', 'anime-b'] }, undefined, true);

        expect(result.Items?.map(item => item.Id)).toEqual(['shared-episode', 'anime-b-middle']);
        expect(apiMocks.getPtvResumeItems.mock.calls.map(([query, options]) => [query.ParentId, query.StartIndex, query.Limit, options.serverId, options.userId])).toEqual([
            ['anime-a', 0, 3, 'server', 'user'],
            ['anime-b', 0, 3, 'server', 'user']
        ]);
        for (const [query] of apiMocks.getPtvResumeItems.mock.calls) {
            expect(query).toMatchObject({ Filters: 'IsResumable', IncludeItemTypes: 'Episode,Series' });
            expect(query).not.toHaveProperty('AncestorIds');
            expect(query).not.toHaveProperty('Ids');
        }
        expect(apiMocks.getPtvItems).not.toHaveBeenCalled();
    });

    it.each([
        { name: 'missing', ancestors: undefined },
        { name: 'empty', ancestors: [] },
        { name: 'malformed', ancestors: { Items: [{ Id: 'anime-library' }] } }
    ])('does not read nested children with $name ancestry', async ({ ancestors }) => {
        apiMocks.requestPtvJson.mockResolvedValue(ancestors);

        await expect(getPtvBrowseScopedItems({ ParentId: 'anime-series', Recursive: false }, scopedAnime))
            .rejects.toThrow(/outside.*library/i);

        expect(apiMocks.requestPtvJson).toHaveBeenCalledWith('Items/anime-series/Ancestors', expect.objectContaining({
            params: { userId: 'user' }, serverId: 'server', userId: 'user'
        }));
        expect(apiMocks.getPtvItems).not.toHaveBeenCalled();
        expect(apiMocks.getPtvResumeItems).not.toHaveBeenCalled();
    });

    it('propagates a nested ancestry failure without an item-read fallback', async () => {
        const ancestryError = new Error('Ancestry unavailable');
        apiMocks.requestPtvJson.mockRejectedValue(ancestryError);

        await expect(getPtvBrowseScopedItems({ ParentId: 'anime-series', Recursive: false }, scopedAnime))
            .rejects.toBe(ancestryError);

        expect(apiMocks.getPtvItems).not.toHaveBeenCalled();
        expect(apiMocks.getPtvResumeItems).not.toHaveBeenCalled();
    });

    it('retains projected root provenance when resolving a grouped TV Shows UserView', async () => {
        apiMocks.getPtvUserViews.mockResolvedValue({
            Items: [
                { CollectionType: 'tvshows', Id: 'grouped-shows-view', Name: 'TV Shows', Type: 'UserView' },
                { CollectionType: 'tvshows', Id: 'physical-shows-library', Name: 'Shows Library', Type: 'CollectionFolder' }
            ]
        });

        await expect(resolvePtvBrowseScope(parsePtvBrowseRoute('/shows'))).resolves.toMatchObject({
            libraryIds: ['grouped-shows-view', 'physical-shows-library'],
            projectedLibraryIds: ['grouped-shows-view'],
            status: 'resolved'
        });
    });

    it('proves projected Series membership across two bounded root pages before reading Seasons', async () => {
        const scope = await resolveGroupedShowsScope();
        const firstPage = Array.from({ length: 200 }, (_, index) => ({ Id: `other-series-${index}`, Type: 'Series' }));
        apiMocks.requestPtvJson.mockResolvedValue([{ Id: 'physical-tv-library', Type: 'CollectionFolder' }]);
        apiMocks.getPtvItems.mockImplementation(async query => {
            if (query.ParentId === 'grouped-shows-view') {
                return {
                    Items: query.StartIndex === 0 ? firstPage : [{ Id: 'projected-series', Type: 'Series' }],
                    TotalRecordCount: 201
                };
            }
            return { Items: [{ Id: 'projected-season', Type: 'Season' }], TotalRecordCount: 1 };
        });
        const query = { IncludeItemTypes: 'Season', Limit: 3, ParentId: 'projected-series', Recursive: false, StartIndex: 0 };

        const result = await getPtvBrowseScopedItems(query, scope);

        expect(result.Items?.map(item => item.Id)).toEqual(['projected-season']);
        expect(apiMocks.getPtvItems.mock.calls.map(([params]) => [
            params.ParentId, params.IncludeItemTypes, params.Recursive, params.Limit, params.StartIndex
        ])).toEqual([
            ['grouped-shows-view', 'Series', true, 200, 0],
            ['grouped-shows-view', 'Series', true, 200, 200],
            ['projected-series', 'Season', false, 3, 0]
        ]);
        expect(apiMocks.getPtvItems.mock.calls[2][0]).toEqual(query);
        for (const [params, options] of apiMocks.getPtvItems.mock.calls) {
            expect(params).not.toHaveProperty('AncestorIds');
            expect(params).not.toHaveProperty('Ids');
            expect(options).toMatchObject({ serverId: 'server', userId: 'user' });
        }
        expect(apiMocks.getPtvResumeItems).not.toHaveBeenCalled();
    });

    it.each([
        { name: 'foreign', firstPageSize: 1, totalRecordCount: 1, starts: [0] },
        { name: 'exhausted', firstPageSize: 200, totalRecordCount: 201, starts: [0, 200] }
    ])('denies a $name Series after scanning the projected root without membership', async ({ firstPageSize, totalRecordCount, starts }) => {
        const scope = await resolveGroupedShowsScope();
        const firstPage = Array.from({ length: firstPageSize }, (_, index) => ({ Id: `other-series-${index}`, Type: 'Series' }));
        apiMocks.requestPtvJson.mockResolvedValue([{ Id: 'physical-tv-library', Type: 'CollectionFolder' }]);
        apiMocks.getPtvItems.mockImplementation(async query => {
            const rootPage = query.StartIndex === 0 ? firstPage : [];

            return {
                Items: query.ParentId === 'grouped-shows-view' ? rootPage : [{ Id: 'foreign-season', Type: 'Season' }],
                TotalRecordCount: totalRecordCount
            };
        });

        await expect(getPtvBrowseScopedItems({
            IncludeItemTypes: 'Season', Limit: 3, ParentId: 'foreign-series', Recursive: false
        }, scope)).rejects.toThrow(/outside.*library/i);

        expect(apiMocks.getPtvItems.mock.calls.map(([query]) => query.StartIndex)).toEqual(starts);
        for (const [query] of apiMocks.getPtvItems.mock.calls) {
            expect(query).toMatchObject({ ParentId: 'grouped-shows-view', IncludeItemTypes: 'Series', Recursive: true, Limit: 200 });
            expect(query).not.toHaveProperty('Ids');
            expect(query).not.toHaveProperty('AncestorIds');
        }
        expect(apiMocks.getPtvResumeItems).not.toHaveBeenCalled();
    });

    it.each(['cancelled', 'retired'] as const)('does not read Seasons after projected membership work is %s', async retirement => {
        const scope = await resolveGroupedShowsScope();
        const controller = createPtvAbortController();
        let resolveMembership!: (value: { Items: Array<{ Id: string; Type: string }>; TotalRecordCount: number }) => void;
        const response = new Promise<{ Items: Array<{ Id: string; Type: string }>; TotalRecordCount: number }>(resolve => {
            resolveMembership = resolve;
        });
        apiMocks.requestPtvJson.mockResolvedValue([{ Id: 'physical-tv-library', Type: 'CollectionFolder' }]);
        apiMocks.getPtvItems.mockReturnValue(response);

        const request = getPtvBrowseScopedItems({
            IncludeItemTypes: 'Season', Limit: 3, ParentId: 'projected-series', Recursive: false
        }, scope, controller.signal);
        const outcome = request.then(result => ({ result }), error => ({ error }));
        await vi.waitFor(() => {
            expect(apiMocks.getPtvItems.mock.calls.map(([query]) => query.ParentId)).toEqual(['grouped-shows-view']);
        });

        if (retirement === 'cancelled') controller.abort();
        else apiMocks.userId = 'user-b';
        resolveMembership({ Items: [{ Id: 'projected-series', Type: 'Series' }], TotalRecordCount: 1 });

        expect(await outcome).toMatchObject({ error: { name: 'AbortError' } });
        expect(apiMocks.getPtvItems.mock.calls.map(([query]) => query.ParentId)).toEqual(['grouped-shows-view']);
        expect(apiMocks.getPtvResumeItems).not.toHaveBeenCalled();
    });

    it.each(['Series', 'Episode', 'Movie', 'BoxSet', 'Season,BoxSet'])('does not broaden projected membership proof to %s child queries', async includeItemTypes => {
        const scope = await resolveGroupedShowsScope();
        apiMocks.requestPtvJson.mockResolvedValue([{ Id: 'physical-tv-library', Type: 'CollectionFolder' }]);
        apiMocks.getPtvItems.mockResolvedValue({ Items: [{ Id: 'foreign-parent', Type: 'Series' }], TotalRecordCount: 1 });

        await expect(getPtvBrowseScopedItems({
            IncludeItemTypes: includeItemTypes, Limit: 3, ParentId: 'foreign-parent', Recursive: false
        }, scope)).rejects.toThrow(/outside.*library/i);

        expect(apiMocks.getPtvItems).not.toHaveBeenCalled();
        expect(apiMocks.getPtvResumeItems).not.toHaveBeenCalled();
    });

    it('interleaves bounded multi-root Random results before slicing the page', async () => {
        apiMocks.getPtvItems.mockImplementation(async query => ({
            Items: query.ParentId === 'anime-a' ? [{ Id: 'a1' }, { Id: 'a2' }] : [{ Id: 'b1' }, { Id: 'b2' }],
            TotalRecordCount: 2
        }));

        const result = await getPtvBrowseScopedItems({ Limit: 2, SortBy: 'Random', StartIndex: 0 }, {
            ...scopedAnime, libraryIds: ['anime-a', 'anime-b']
        });

        expect(result.Items?.map(item => item.Id)).toEqual(['a1', 'b1']);
        expect(apiMocks.getPtvItems.mock.calls.map(([query]) => query)).toEqual([
            { Limit: 2, ParentId: 'anime-a', SortBy: 'Random', StartIndex: 0 },
            { Limit: 2, ParentId: 'anime-b', SortBy: 'Random', StartIndex: 0 }
        ]);
    });

    it('preserves item deduplication when interleaving multi-root Random results', async () => {
        apiMocks.getPtvItems.mockImplementation(async query => ({
            Items: query.ParentId === 'anime-a' ? [{ Id: 'a1' }, { Id: 'shared' }, { Id: 'a3' }] : [{ Id: 'b1' }, { Id: 'shared' }, { Id: 'b3' }],
            TotalRecordCount: 3
        }));

        const result = await getPtvBrowseScopedItems({ Limit: 5, SortBy: 'Random', StartIndex: 0 }, {
            ...scopedAnime, libraryIds: ['anime-a', 'anime-b']
        });
        const ids = result.Items?.map(item => item.Id) || [];

        expect(ids.slice(0, 2)).toEqual(['a1', 'b1']);
        expect([...ids].sort((left, right) => String(left).localeCompare(String(right)))).toEqual(['a1', 'a3', 'b1', 'b3', 'shared']);
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
