import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/items', () => ({ getPtvItems: vi.fn() }));

import { getPtvItems } from '../../api/items';
import type { PtvItem, PtvItemQuery } from '../../api/types';
import { createPtvAbortController } from '../../core/abortController';
import {
    PTV_AUTHORITATIVE_SERIES_FIELDS,
    PTV_AUTHORITATIVE_SERIES_PAGE_BUDGET,
    PTV_AUTHORITATIVE_SERIES_PAGE_SIZE,
    searchPtvAuthoritativeSeries
} from './authoritativeSeriesSearch';

function series(
    id: string,
    name: string,
    recursiveItemCount: number | null | undefined,
    productionYear = 1999
): PtvItem {
    return {
        Id: id,
        Name: name,
        ProductionYear: productionYear,
        RecursiveItemCount: recursiveItemCount,
        Type: 'Series'
    };
}

function searchOptions(overrides: Partial<Parameters<typeof searchPtvAuthoritativeSeries>[0]> = {}) {
    return {
        perGroupLimit: 14,
        query: 'digimon',
        serverId: 'server-1',
        signal: createPtvAbortController().signal,
        userId: 'user-1',
        ...overrides
    };
}

beforeEach(() => {
    vi.mocked(getPtvItems).mockReset();
});

describe('authoritative Series search', () => {
    it('pages past 53 explicitly empty duplicates to find the playable Series result', async () => {
        const emptyDuplicates = Array.from({ length: 53 }, (_, index) => (
            series(`empty-${index}`, 'Digimon', 0)
        ));
        const playable = series('playable', 'Digimon', 54);

        vi.mocked(getPtvItems).mockImplementation((query?: PtvItemQuery) => Promise.resolve(
            query?.StartIndex === 0 ?
                {
                    Items: emptyDuplicates.slice(0, PTV_AUTHORITATIVE_SERIES_PAGE_SIZE),
                    StartIndex: 0,
                    TotalRecordCount: 54
                } :
                {
                    Items: [...emptyDuplicates.slice(PTV_AUTHORITATIVE_SERIES_PAGE_SIZE), playable],
                    StartIndex: PTV_AUTHORITATIVE_SERIES_PAGE_SIZE,
                    TotalRecordCount: 54
                }
        ));

        const options = searchOptions();
        const result = await searchPtvAuthoritativeSeries(options);
        const requests = vi.mocked(getPtvItems).mock.calls;
        const firstQuery = requests[0]?.[0];
        const firstOptions = requests[0]?.[1];

        expect(result).toMatchObject({
            items: [playable],
            pagesLoaded: 2,
            totalRecordCount: 54
        });
        expect(requests.map(([query]) => query?.StartIndex)).toEqual([0, 50]);
        expect(firstQuery).toMatchObject({
            EnableImages: true,
            EnableUserData: true,
            GroupItems: false,
            IncludeItemTypes: 'Series',
            Limit: 50,
            Recursive: true,
            SearchTerm: 'digimon'
        });
        expect(String(firstQuery?.Fields).split(',')).toEqual(expect.arrayContaining([
            'ChildCount',
            'ImageTags',
            'PresentationUniqueKey',
            'ProviderIds',
            'RecursiveItemCount'
        ]));
        expect(firstQuery?.Fields).toBe(PTV_AUTHORITATIVE_SERIES_FIELDS.join(','));
        expect(firstOptions).toEqual({
            serverId: 'server-1',
            signal: options.signal,
            userId: 'user-1'
        });
    });

    it('retains unknown counts while filtering only an explicit numeric zero', async () => {
        const unknown = series('unknown', 'Digimon Adventure', undefined);
        const nullCount = series('null', 'Digimon Frontier', null);
        const empty = series('empty', 'Digimon Ghost Game', 0);

        vi.mocked(getPtvItems).mockResolvedValue({
            Items: [empty, unknown, nullCount],
            TotalRecordCount: 3
        });

        const result = await searchPtvAuthoritativeSeries(searchOptions());

        expect(result.items.map(item => item.Id)).toEqual(['unknown', 'null']);
    });

    it('ranks exact and prefix matches first, dedupes logical copies, and preserves remakes', async () => {
        const lowerCountDuplicate = series('duplicate-low', 'Digimon', 3, 1999);
        const preferredDuplicate = series('duplicate-high', 'Digimon', 54, 1999);
        const remake = series('remake', 'Digimon', 12, 2020);
        const prefix = series('prefix', 'Digimon Adventure', 67, 1999);
        const contains = series('contains', 'The Digimon Archive', 20, 2021);

        lowerCountDuplicate.ProviderIds = { Tvdb: 'series-1' };
        preferredDuplicate.ProviderIds = { Tvdb: 'series-1' };
        remake.ProviderIds = { Tvdb: 'series-1' };

        vi.mocked(getPtvItems).mockResolvedValue({
            Items: [contains, lowerCountDuplicate, prefix, remake, preferredDuplicate],
            TotalRecordCount: 5
        });

        const result = await searchPtvAuthoritativeSeries(searchOptions());

        expect(result.items.map(item => item.Id)).toEqual([
            'duplicate-high',
            'remake',
            'prefix',
            'contains'
        ]);
    });

    it('keeps paging when the only exact-title candidate has an unknown count', async () => {
        const unknownExact = series('unknown-exact', 'Digimon', undefined);
        const playableExact = series('playable-exact', 'Digimon', 54);
        const prefixMatches = Array.from({ length: 49 }, (_, index) => (
            series(`prefix-${index}`, `Digimon ${index}`, 1)
        ));

        unknownExact.PresentationUniqueKey = 'series-digimon';
        playableExact.PresentationUniqueKey = 'series-digimon';
        vi.mocked(getPtvItems).mockImplementation(query => Promise.resolve(query?.StartIndex === 0 ? {
            Items: [unknownExact, ...prefixMatches],
            TotalRecordCount: 51
        } : {
            Items: [playableExact],
            TotalRecordCount: 51
        }));

        const result = await searchPtvAuthoritativeSeries(searchOptions());

        expect(getPtvItems).toHaveBeenCalledTimes(2);
        expect(result.items[0]?.Id).toBe('playable-exact');
    });

    it('rejects promptly on abort while forwarding the owner signal to transport', async () => {
        const controller = createPtvAbortController();
        let transportSignal: AbortSignal | undefined;

        vi.mocked(getPtvItems).mockImplementation((_query, options) => {
            transportSignal = options?.signal;
            return new Promise(() => undefined);
        });

        const request = searchPtvAuthoritativeSeries(searchOptions({ signal: controller.signal }));

        await vi.waitFor(() => expect(getPtvItems).toHaveBeenCalledTimes(1));
        controller.abort();

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(transportSignal).toBe(controller.signal);
        expect(transportSignal?.aborted).toBe(true);
    });

    it('stops at the paging budget when every fetched Series is explicitly empty', async () => {
        vi.mocked(getPtvItems).mockImplementation(query => Promise.resolve({
            Items: Array.from({ length: PTV_AUTHORITATIVE_SERIES_PAGE_SIZE }, (_, index) => (
                series(`empty-${query?.StartIndex}-${index}`, 'Digimon', 0)
            )),
            TotalRecordCount: 10_000
        }));

        const result = await searchPtvAuthoritativeSeries(searchOptions());

        expect(result.items).toEqual([]);
        expect(result.pagesLoaded).toBe(PTV_AUTHORITATIVE_SERIES_PAGE_BUDGET);
        expect(getPtvItems).toHaveBeenCalledTimes(PTV_AUTHORITATIVE_SERIES_PAGE_BUDGET);
        expect(vi.mocked(getPtvItems).mock.calls.map(([query]) => query?.StartIndex))
            .toEqual([0, 50, 100, 150]);
    });

    it('propagates transport and timeout failures unchanged', async () => {
        const timeout = new Error('Series request timed out.');

        timeout.name = 'PtvSearchPrimaryTimeoutError';
        vi.mocked(getPtvItems).mockRejectedValue(timeout);

        await expect(searchPtvAuthoritativeSeries(searchOptions())).rejects.toBe(timeout);
        expect(getPtvItems).toHaveBeenCalledTimes(1);
    });
});
