import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/items', () => ({ getPtvItems: vi.fn() }));

import { getPtvItems } from '../api/items';
import type { PtvItem, PtvItemQuery } from '../api/types';
import {
    resetPtvMovieSearchCatalogForTests,
    searchPtvMovieCatalog
} from './movieSearchCatalog';

function movie(id: string, name: string): PtvItem {
    return {
        Id: id,
        Name: name,
        Path: `/media/Movies/${name}/movie.mkv`,
        ProductionYear: 2025,
        Type: 'Movie'
    };
}

function page(startIndex: number, items: PtvItem[], totalRecordCount: number) {
    return { Items: items, StartIndex: startIndex, TotalRecordCount: totalRecordCount };
}

afterEach(() => {
    resetPtvMovieSearchCatalogForTests();
    vi.clearAllMocks();
});

describe('PTV Movie search catalog', () => {
    it('finds Toy Story 5 on a page beyond the newest 96 and records its page location', async () => {
        const newest = Array.from({ length: 500 }, (_, index) => movie(`new-${index}`, `New movie ${index}`));
        const toyStoryFive = movie('toy-5', 'Toy Story 5');

        vi.mocked(getPtvItems).mockImplementation((query?: PtvItemQuery, _options?) => {
            if (!query) return Promise.resolve({ Items: [] });
            if (query.Ids) return Promise.resolve({ Items: [toyStoryFive] });
            return Promise.resolve(query.StartIndex === 0 ? page(0, newest, 501) : page(500, [toyStoryFive], 501));
        });

        const result = await searchPtvMovieCatalog('toy story', { userId: 'user-1' });

        expect(result.items.map(item => item.Name)).toEqual(['Toy Story 5']);
        expect(result.matchedLocations).toEqual(['page:2,index:0']);
        expect(vi.mocked(getPtvItems).mock.calls.map(([query]) => query?.StartIndex).filter(Boolean)).toEqual([500]);
    });

    it('continues past primary-root matches and never transmits ParentId for the global catalog', async () => {
        const primaryRootMatches = [
            movie('toy-1', 'Toy Story'),
            movie('toy-2', 'Toy Story 2'),
            movie('toy-3', 'Toy Story 3'),
            movie('toy-4', 'Toy Story 4')
        ].map(item => ({ ...item, TopParentId: 'root-a' }));
        const rootA = [
            ...primaryRootMatches,
            ...Array.from({ length: 496 }, (_, index) => ({
                ...movie(`root-a-${index}`, `Primary root movie ${index}`),
                TopParentId: 'root-a'
            }))
        ];
        const toyStoryFive = { ...movie('toy-5', 'Toy Story 5'), TopParentId: 'root-b' };

        vi.mocked(getPtvItems).mockImplementation((query, _options) => {
            if (!query) return Promise.resolve({ Items: [] });
            if (query.Ids) return Promise.resolve({ Items: [toyStoryFive] });
            return Promise.resolve(query.StartIndex === 0
                ? page(0, rootA, 501)
                : page(500, [toyStoryFive], 501));
        });

        const result = await searchPtvMovieCatalog('toy story', {
            excludeItemIds: rootA.map(item => String(item.Id)),
            userId: 'user-1'
        });
        const catalogQueries = vi.mocked(getPtvItems).mock.calls
            .map(([query]) => query)
            .filter(query => !query?.Ids);

        expect(result.items.map(item => item.Name)).toEqual(['Toy Story 5']);
        expect(result.matchedLocations).toEqual(['page:2,index:0']);
        expect(result.stopReason).toBe('exact-match-found');
        expect(catalogQueries).toHaveLength(2);
        expect(catalogQueries.every(query => query?.ParentId === undefined)).toBe(true);
    });

    it('reuses a warm catalog without another catalog or hydration request', async () => {
        const toyStoryFive = movie('toy-5', 'Toy Story 5');
        vi.mocked(getPtvItems).mockImplementation((query?: PtvItemQuery, _options?) => Promise.resolve(!query
            ? { Items: [] }
            : query.Ids
                ? { Items: [toyStoryFive] }
                : page(0, [toyStoryFive], 1)));

        await searchPtvMovieCatalog('toy story', { serverId: 'server-1', userId: 'user-1' });
        vi.clearAllMocks();
        const warm = await searchPtvMovieCatalog('toy story', { serverId: 'server-1', userId: 'user-1' });

        expect(warm.cacheSource).toBe('memory');
        expect(warm.items).toHaveLength(1);
        expect(getPtvItems).not.toHaveBeenCalled();
    });

    it('resumes a partial catalog from its next page rather than restarting', async () => {
        const firstPage = Array.from({ length: 500 }, (_, index) => movie(`first-${index}`, `Alpha ${index}`));
        const toyStoryFive = movie('toy-5', 'Toy Story 5');
        vi.mocked(getPtvItems).mockImplementation((query?: PtvItemQuery, _options?) => {
            if (!query) return Promise.resolve({ Items: [] });
            if (query.Ids) return Promise.resolve({ Items: [toyStoryFive] });
            return Promise.resolve(query.StartIndex === 0 ? page(0, firstPage, 1000) : page(500, [toyStoryFive], 1000));
        });

        await searchPtvMovieCatalog('missing title', { foregroundPageBudget: 1, userId: 'user-1' });
        vi.clearAllMocks();
        const resumed = await searchPtvMovieCatalog('toy story', { foregroundPageBudget: 1, userId: 'user-1' });

        expect(resumed.items.map(item => item.Name)).toEqual(['Toy Story 5']);
        const request = vi.mocked(getPtvItems).mock.calls[0]?.[0];
        expect(request).toBeDefined();
        if (!request) throw new Error('Expected a resumed catalog request.');
        expect(request.StartIndex).toBe(500);
    });

    it('isolates catalog caches by both server and user while retaining only authorized API items', async () => {
        const calls: Array<{ query: PtvItemQuery; userId?: string | null }> = [];
        vi.mocked(getPtvItems).mockImplementation((query, options) => {
            if (!query) return Promise.resolve({ Items: [] });
            calls.push({ query, userId: options?.userId });
            return Promise.resolve(page(0, [movie(String(options?.userId), `Visible to ${options?.userId}`)], 1));
        });

        await searchPtvMovieCatalog('visible', { serverId: 'server-a', userId: 'user-a' });
        await searchPtvMovieCatalog('visible', { serverId: 'server-b', userId: 'user-a' });
        await searchPtvMovieCatalog('visible', { serverId: 'server-a', userId: 'user-b' });

        expect(calls.filter(call => !call.query.Ids).map(call => call.userId)).toEqual(['user-a', 'user-a', 'user-b']);
    });

    it('honors the foreground page budget and hydrates only catalog matches', async () => {
        const newest = Array.from({ length: 500 }, (_, index) => movie(`new-${index}`, `New movie ${index}`));
        const toyStoryFive = movie('toy-5', 'Toy Story 5');
        vi.mocked(getPtvItems).mockImplementation((query?: PtvItemQuery, _options?) => {
            if (!query) return Promise.resolve({ Items: [] });
            if (query.Ids) return Promise.resolve({ Items: [toyStoryFive] });
            if (query.StartIndex === 0) return Promise.resolve(page(0, newest, 1500));
            if (query.StartIndex === 500) return Promise.resolve(page(500, newest, 1500));
            return Promise.resolve(page(1000, [toyStoryFive], 1500));
        });

        const bounded = await searchPtvMovieCatalog('toy story', { foregroundPageBudget: 2, userId: 'user-1' });
        expect(bounded.items).toEqual([]);
        expect(vi.mocked(getPtvItems).mock.calls.filter(([query]) => !query?.Ids)).toHaveLength(2);

        const found = await searchPtvMovieCatalog('toy story', { foregroundPageBudget: 1, userId: 'user-1' });
        const hydration = vi.mocked(getPtvItems).mock.calls.find(([query]) => Boolean(query?.Ids))?.[0];
        expect(found.items.map(item => item.Name)).toEqual(['Toy Story 5']);
        expect(hydration?.Ids).toBe('toy-5');
    });

    it('keeps the global catalog unscoped and reports its real Items request contract', async () => {
        vi.mocked(getPtvItems).mockResolvedValue(page(0, [movie('toy-5', 'Toy Story 5')], 1));

        const result = await searchPtvMovieCatalog('toy story', { userId: 'user-1' });
        const request = vi.mocked(getPtvItems).mock.calls[0]?.[0];

        expect(request).toBeDefined();
        if (!request) throw new Error('Expected a catalog request.');
        expect(request.ParentId).toBeUndefined();
        expect(request.Recursive).toBe(true);
        expect(request.SortBy).toBe('DateCreated');
        expect(result.request).toMatchObject({
            endpoint: 'Users/user-1/Items',
            limit: 500,
            parentId: 'none',
            sortOrder: 'Descending',
            startIndex: 0
        });
    });
});
