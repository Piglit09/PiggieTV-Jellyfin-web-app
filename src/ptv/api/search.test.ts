import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./items', () => ({
    getPtvItems: vi.fn()
}));

import { getPtvItems } from './items';
import {
    PtvSearchAbortedError,
    resetPtvMovieSearchRecoveryCacheForTests,
    searchPtvItems
} from './search';
import type { PtvItem, PtvItemQuery } from './types';

function movie(id: string, name: string, providerId: string): PtvItem {
    return {
        Id: id,
        Name: name,
        Path: `/media-local/Movies/${name}/movie.mkv`,
        ProductionYear: 2025,
        ProviderIds: { Tmdb: providerId },
        Type: 'Movie'
    };
}

const toyStoryOneToFour = [
    movie('1', 'Toy Story', '101'),
    movie('2', 'Toy Story 2', '102'),
    movie('3', 'Toy Story 3', '103'),
    movie('4', 'Toy Story 4', '104')
];
const toyStoryFive = movie('5', 'Toy Story 5', '105');

function movieSearchOptions(overrides: Partial<Parameters<typeof searchPtvItems>[0]> = {}) {
    return {
        fields: 'Name,ProductionYear',
        includeItemTypes: 'Movie',
        limit: 14,
        primaryTimeoutMs: 5,
        recoveryFields: 'Name,OriginalTitle,Path,ProductionYear,ProviderIds,SortName,TopParentId',
        searchTerm: 'toy story',
        ...overrides
    };
}

function queryIds(query?: PtvItemQuery): string[] {
    const value = query?.Ids;
    return (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(String);
}

function mockMovieSearch(primaryItems: PtvItem[], catalogItems: PtvItem[] = [toyStoryFive]) {
    vi.mocked(getPtvItems).mockImplementation((query?: PtvItemQuery, _options?) => {
        if (!query) return Promise.resolve({ Items: [] });
        if (query.SearchTerm) return Promise.resolve({ Items: primaryItems });
        const ids = queryIds(query);
        if (ids.length) return Promise.resolve({ Items: catalogItems.filter(item => ids.includes(String(item.Id))) });

        return Promise.resolve({ Items: catalogItems, TotalRecordCount: catalogItems.length });
    });
}

afterEach(() => {
    resetPtvMovieSearchRecoveryCacheForTests();
    vi.clearAllMocks();
});

describe('Movie search primary outcomes', () => {
    it('does not recover a complete primary Movie result', async () => {
        vi.mocked(getPtvItems).mockResolvedValue({ Items: toyStoryOneToFour });

        const result = await searchPtvItems(movieSearchOptions({ limit: 4 }));

        expect(result.ptvSearchRecoveryDiagnostics.recoveryReason).toBe('complete-primary-result');
        expect(result.ptvSearchRecoveryDiagnostics.recoveryAttempted).toBe(false);
        expect(getPtvItems).toHaveBeenCalledTimes(1);
    });

    it('recovers Toy Story 5 from the global catalog after a sparse successful primary result', async () => {
        mockMovieSearch(toyStoryOneToFour);

        const result = await searchPtvItems(movieSearchOptions());

        expect(result.Items?.map(item => item.Name)).toEqual([
            'Toy Story',
            'Toy Story 2',
            'Toy Story 3',
            'Toy Story 4',
            'Toy Story 5'
        ]);
        expect(result.ptvSearchRecoveryDiagnostics.recoveryReason).toBe('underfilled-primary-result');
        expect(result.ptvSearchRecoveryDiagnostics.catalogMatchCount).toBe(1);
        expect(result.ptvSearchRecoveryDiagnostics.catalogMatchedNames).toEqual(['Toy Story 5']);
    });

    it('renders recovered Movies while retaining a timed-out primary diagnostic and duration', async () => {
        vi.mocked(getPtvItems).mockImplementation((query?: PtvItemQuery, _options?) => {
            if (!query) return Promise.resolve({ Items: [] });
            if (query.SearchTerm) return new Promise(() => undefined);
            if (query.Ids) return Promise.resolve({ Items: [toyStoryFive] });
            return Promise.resolve({ Items: [...toyStoryOneToFour, toyStoryFive], TotalRecordCount: 5 });
        });

        const result = await searchPtvItems(movieSearchOptions());

        expect(result.Items).toHaveLength(5);
        expect(result.ptvSearchRecoveryDiagnostics.primaryStatus).toBe('timeout');
        expect(result.ptvSearchRecoveryDiagnostics.primaryDurationMs).toBeGreaterThanOrEqual(5);
        expect(result.ptvSearchRecoveryDiagnostics.recoveryReason).toBe('primary-timeout');
        expect(result.ptvSearchRecoveryDiagnostics.recoveryAttempted).toBe(true);
    });

    it('recovers a generic primary error and preserves it if catalog recovery also fails', async () => {
        const primaryError = new Error('primary unavailable');
        vi.mocked(getPtvItems).mockImplementation((query?: PtvItemQuery, _options?) => {
            if (!query) return Promise.resolve({ Items: [] });
            if (query.SearchTerm) return Promise.reject(primaryError);
            if (query.Ids) return Promise.resolve({ Items: [toyStoryFive] });
            return Promise.resolve({ Items: [toyStoryFive], TotalRecordCount: 1 });
        });

        const recovered = await searchPtvItems(movieSearchOptions());

        expect(recovered.ptvSearchRecoveryDiagnostics.primaryStatus).toBe('error');
        expect(recovered.ptvSearchRecoveryDiagnostics.primaryError).toBe('primary unavailable');
        expect(recovered.ptvSearchRecoveryDiagnostics.recoveryReason).toBe('primary-error');

        resetPtvMovieSearchRecoveryCacheForTests();
        vi.mocked(getPtvItems).mockImplementation((query?: PtvItemQuery, _options?) => {
            if (!query) return Promise.resolve({ Items: [] });
            return query.SearchTerm
                ? Promise.reject(primaryError)
                : Promise.reject(new Error('catalog unavailable'));
        });

        await expect(searchPtvItems(movieSearchOptions())).rejects.toThrow('primary unavailable');
    });

    it('does not recover an authentication error, aborted request, or non-Movie group', async () => {
        const authenticationError = Object.assign(new Error('Forbidden'), { status: 403 });
        vi.mocked(getPtvItems).mockRejectedValueOnce(authenticationError);

        await expect(searchPtvItems(movieSearchOptions())).rejects.toThrow('Forbidden');
        expect(getPtvItems).toHaveBeenCalledTimes(1);

        const controller = new AbortController();
        controller.abort();
        await expect(searchPtvItems(movieSearchOptions({ signal: controller.signal }))).rejects.toBeInstanceOf(PtvSearchAbortedError);

        vi.mocked(getPtvItems).mockResolvedValueOnce({ Items: [] });
        const nonMovieResult = await searchPtvItems(movieSearchOptions({ includeItemTypes: 'Audio' }));

        expect(nonMovieResult.ptvSearchRecoveryDiagnostics.recoveryReason).toBe('disabled-non-movie-group');
    });

    it('uses an unscoped user-authorized Movie catalog and records the actual Items endpoint', async () => {
        const staleRootToyStoryFive = { ...toyStoryFive, TopParentId: 'stale-movies-root' };
        mockMovieSearch(toyStoryOneToFour, [staleRootToyStoryFive]);

        const result = await searchPtvItems(movieSearchOptions({ userId: 'user-1' }));
        const request = vi.mocked(getPtvItems).mock.calls.find(([query]) => !query?.SearchTerm && !query?.Ids)?.[0];

        expect(request).toBeDefined();
        if (!request) throw new Error('Expected a catalog request.');
        expect(request.ParentId).toBeUndefined();
        expect(request.IncludeItemTypes).toBe('Movie');
        expect(result.ptvSearchRecoveryDiagnostics.catalogRequestEndpoint).toBe('Users/user-1/Items');
        expect(result.ptvSearchRecoveryDiagnostics.catalogRequestStartIndex).toBe(0);
        expect(result.ptvSearchRecoveryDiagnostics.catalogRequestParentId).toBe('none');
    });

    it('commits primary Movie results before catalog recovery resolves', async () => {
        let resolveCatalog: ((result: { Items: PtvItem[]; TotalRecordCount: number }) => void) | undefined;
        const partialResults: string[][] = [];

        vi.mocked(getPtvItems).mockImplementation((query?: PtvItemQuery, _options?) => {
            if (!query) return Promise.resolve({ Items: [] });
            if (query.SearchTerm) return Promise.resolve({ Items: toyStoryOneToFour });
            if (query.Ids) return Promise.resolve({ Items: [toyStoryFive] });
            return new Promise(resolve => {
                resolveCatalog = resolve;
            });
        });

        const search = searchPtvItems(movieSearchOptions({
            onPrimaryResult: result => partialResults.push((result.Items || []).map(item => String(item.Name)))
        }));

        await vi.waitFor(() => {
            expect(partialResults).toEqual([['Toy Story', 'Toy Story 2', 'Toy Story 3', 'Toy Story 4']]);
        });

        resolveCatalog?.({ Items: [toyStoryFive], TotalRecordCount: 1 });
        await expect(search).resolves.toMatchObject({ TotalRecordCount: 5 });
    });
});
