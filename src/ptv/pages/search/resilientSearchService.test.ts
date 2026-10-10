import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    getPtvSearchPrimaryOutcome,
    PtvSearchAbortedError,
    PtvSearchPrimaryTimeoutError,
    requestPtvJson,
    searchPtvAuthoritativeSeries,
    searchPtvItems,
    searchPtvHints
} = vi.hoisted(() => {
    class SearchAbortedError extends Error {
        constructor() {
            super('Search request was cancelled');
            this.name = 'PtvSearchAbortedError';
        }
    }
    class SearchTimeoutError extends Error {
        constructor(timeoutMs: number) {
            super(`Primary search timed out after ${timeoutMs}ms`);
            this.name = 'PtvSearchPrimaryTimeoutError';
        }
    }

    return {
        getPtvSearchPrimaryOutcome: vi.fn(),
        PtvSearchAbortedError: SearchAbortedError,
        PtvSearchPrimaryTimeoutError: SearchTimeoutError,
        requestPtvJson: vi.fn(),
        searchPtvAuthoritativeSeries: vi.fn(),
        searchPtvItems: vi.fn(),
        searchPtvHints: vi.fn()
    };
});

vi.mock('../../api/search', () => ({
    getPtvSearchPrimaryOutcome,
    PtvSearchAbortedError,
    PtvSearchPrimaryTimeoutError,
    searchPtvItems
}));
vi.mock('../../api/client', () => ({ requestPtvJson }));
vi.mock('./authoritativeSeriesSearch', () => ({ searchPtvAuthoritativeSeries }));
vi.mock('./searchHintService', () => ({
    getPtvSearchHintFailureKind: (error: unknown) => {
        const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';

        if (name === 'AbortError' || name === 'PtvSearchAbortedError') return 'aborted';
        if (name === 'PtvSearchPrimaryTimeoutError') return 'timeout';
        return 'error';
    },
    searchPtvHints
}));

import {
    PTV_SEARCH_DIRECT_BATCH_TIMEOUT_MS,
    PTV_SEARCH_DIRECT_GROUP_TIMEOUT_MS,
    PTV_SEARCH_HINT_PRIMARY_TIMEOUT_MS,
    PTV_SEARCH_MAX_CONCURRENCY,
    retryPtvFailedSearchGroups,
    searchPtvWithRecovery
} from './resilientSearchService';
import type { PtvGroupedSearchHints } from './searchHintService';
import { createPtvAbortController } from '../../core/abortController';
import { createPtvSearchRecoveryDiagnostics } from '../../services/searchRecovery';

function emptyGroups(): PtvGroupedSearchHints {
    return {
        albums: [],
        artists: [],
        collections: [],
        episodes: [],
        genres: [],
        movies: [],
        music: [],
        people: [],
        reading: [],
        shows: [],
        studios: []
    };
}

function movieSearchResult(
    items: Array<{ Id: string; Name: string; Type: string }> = [],
    diagnosticOverrides: Parameters<typeof createPtvSearchRecoveryDiagnostics>[0] = {}
) {
    const emptyResult = items.length === 0;

    return {
        Items: items,
        TotalRecordCount: items.length,
        ptvLibraryRootDiagnostics: {
            deduplicatedCount: 0,
            groups: [],
            inputCount: items.length,
            outputCount: items.length
        },
        ptvSearchRecoveryDiagnostics: createPtvSearchRecoveryDiagnostics({
            catalogExhausted: emptyResult,
            catalogStatus: emptyResult ? 'complete' : 'not-requested',
            catalogStopReason: emptyResult ? 'exhausted' : 'not-requested',
            finalItemCount: items.length,
            primaryItemCount: items.length,
            primaryStatus: 'success',
            recoveryAttempted: emptyResult,
            recoveryReason: emptyResult ? 'empty-primary-result' : 'complete-primary-result',
            ...diagnosticOverrides
        })
    };
}

function options(includeItemTypes = ['Movie', 'Series', 'Episode']) {
    return {
        includeItemTypes,
        limit: includeItemTypes.length * 14,
        perGroupLimit: 14,
        query: 'digimon',
        serverId: 'server-1',
        signal: createPtvAbortController().signal,
        userId: 'user-1'
    };
}

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>(nextResolve => {
        resolve = nextResolve;
    });

    return { promise, resolve };
}

function waitForSearchAbort(signal: AbortSignal) {
    return new Promise<{
        durationMs: number;
        items: never[];
        status: 'aborted';
    }>(resolve => {
        const finishAborted = () => resolve({
            durationMs: PTV_SEARCH_DIRECT_BATCH_TIMEOUT_MS,
            items: [],
            status: 'aborted'
        });

        if (signal.aborted) {
            finishAborted();
        } else {
            signal.addEventListener('abort', finishAborted, { once: true });
        }
    });
}

function rejectOnSearchAbort(signal: AbortSignal) {
    return new Promise<never>((resolve, reject) => {
        const finishAborted = () => {
            const error = new Error('request aborted');

            error.name = 'AbortError';
            reject(error);
        };

        if (signal.aborted) {
            finishAborted();
        } else {
            signal.addEventListener('abort', finishAborted, { once: true });
        }
    });
}

function rejectSearchAfter(error: Error, delayMs: number) {
    return new Promise<never>((_resolve, reject) => {
        globalThis.setTimeout(() => reject(error), delayMs);
    });
}

function resolveSearchAfterUnlessAborted<T>(value: T, delayMs: number, signal: AbortSignal) {
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => {
            globalThis.clearTimeout(timeout);
            const error = new Error('request aborted');

            error.name = 'AbortError';
            reject(error);
        };
        const timeout = globalThis.setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve(value);
        }, delayMs);

        signal.addEventListener('abort', onAbort, { once: true });
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    searchPtvAuthoritativeSeries.mockResolvedValue({ items: [], pagesLoaded: 1, totalRecordCount: 0 });
    searchPtvItems.mockResolvedValue(movieSearchResult());
    getPtvSearchPrimaryOutcome.mockResolvedValue({
        durationMs: 2,
        items: [],
        result: { Items: [] },
        status: 'success'
    });
    requestPtvJson.mockResolvedValue({ Items: [], TotalRecordCount: 0 });
});

describe('resilient web search', () => {
    it('retries only failed groups with the original user and query scope', async () => {
        getPtvSearchPrimaryOutcome.mockResolvedValue({
            durationMs: 2,
            items: [{ Id: 'episode-recovered', Name: 'Digimon', Type: 'Episode' }],
            result: { Items: [] },
            status: 'success'
        });

        const result = await retryPtvFailedSearchGroups({
            ...options(['Movie', 'Episode']),
            failedGroupIds: ['episodes', 'shows']
        });

        expect(result.groups.episodes).toEqual([expect.objectContaining({ Id: 'episode-recovered' })]);
        expect(result.failedGroupStatuses).toEqual({});
        expect(result.requestCount).toBe(1);
        expect(searchPtvHints).not.toHaveBeenCalled();
        expect(searchPtvItems).not.toHaveBeenCalled();
        expect(searchPtvAuthoritativeSeries).not.toHaveBeenCalled();
        expect(getPtvSearchPrimaryOutcome).toHaveBeenCalledWith(expect.objectContaining({
            IncludeItemTypes: 'Episode',
            SearchTerm: 'digimon'
        }), expect.objectContaining({ serverId: 'server-1', userId: 'user-1' }));
    });

    it('classifies a failed retry without replacing successful groups', async () => {
        getPtvSearchPrimaryOutcome.mockResolvedValue({
            durationMs: 4500,
            error: new PtvSearchPrimaryTimeoutError(4500),
            items: [],
            status: 'timeout'
        });

        const result = await retryPtvFailedSearchGroups({
            ...options(['Movie', 'Episode']),
            failedGroupIds: ['episodes']
        });

        expect(result.groups).toEqual({});
        expect(result.failedGroupStatuses).toEqual({ episodes: 'timeout' });
        expect(result.failedGroupReasons).toEqual({ episodes: 'client-group-deadline' });
        expect(result.endpointPaths).toEqual({ episodes: ['Users/{user}/Items'] });
    });

    it('classifies a client batch deadline separately from a server response', async () => {
        vi.useFakeTimers();

        try {
            getPtvSearchPrimaryOutcome.mockImplementation((_query, requestOptions) => waitForSearchAbort(requestOptions.signal));
            const resultPromise = retryPtvFailedSearchGroups({
                ...options(['Episode']),
                failedGroupIds: ['episodes']
            });

            await vi.advanceTimersByTimeAsync(PTV_SEARCH_DIRECT_BATCH_TIMEOUT_MS + 1);
            const result = await resultPromise;

            expect(result.failedGroupStatuses).toEqual({ episodes: 'timeout' });
            expect(result.failedGroupReasons).toEqual({ episodes: 'client-batch-deadline' });
            expect(result.endpointPaths).toEqual({ episodes: ['Users/{user}/Items'] });
            expect(result.requestCount).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects a retry cancelled by a new query', async () => {
        const controller = createPtvAbortController();

        getPtvSearchPrimaryOutcome.mockImplementation((_query, requestOptions) => waitForSearchAbort(requestOptions.signal));
        const resultPromise = retryPtvFailedSearchGroups({
            ...options(['Episode']),
            failedGroupIds: ['episodes'],
            signal: controller.signal
        });

        controller.abort();
        await expect(resultPromise).rejects.toMatchObject({ name: 'PtvSearchAbortedError' });
    });

    it('reports observed HTTP failure and the directory endpoints actually requested', async () => {
        requestPtvJson.mockRejectedValue(Object.assign(new Error('Unavailable'), { status: 503 }));

        const result = await retryPtvFailedSearchGroups({
            ...options(['Genre', 'MusicGenre', 'Studio']),
            failedGroupIds: ['genres', 'studios']
        });

        expect(result.failedGroupReasons).toEqual({ genres: 'http-503', studios: 'http-503' });
        expect(result.endpointPaths).toEqual({
            genres: ['Genres', 'MusicGenres'],
            studios: ['Studios']
        });
    });

    it('redacts user identity from observed Movie catalog endpoint diagnostics', async () => {
        searchPtvItems.mockResolvedValue(movieSearchResult([], {
            catalogRequestEndpoint: 'Users/user-1/Items',
            catalogRequestsThisSearch: 1
        }));

        const result = await retryPtvFailedSearchGroups({
            ...options(['Movie']),
            failedGroupIds: ['movies']
        });

        expect(result.endpointPaths.movies).toEqual(['Users/{user}/Items', 'Users/{user}/Items']);
    });

    it('keeps a successful broad hint search to one hint request plus Movie and Series enrichment', async () => {
        const groups = emptyGroups();
        let activeRequests = 0;
        let peakRequests = 0;
        const trackRequest = async <T>(value: T, delayMs: number) => {
            activeRequests += 1;
            peakRequests = Math.max(peakRequests, activeRequests);
            await new Promise(resolve => globalThis.setTimeout(resolve, delayMs));
            activeRequests -= 1;
            return value;
        };

        groups.movies = [{ Id: 'movie-1', Name: 'Batman', Type: 'Movie' }];
        searchPtvHints.mockImplementation(() => trackRequest({
            groups,
            hintCount: 1,
            totalRecordCount: 1
        }, 5));
        searchPtvAuthoritativeSeries.mockImplementation(() => trackRequest({
            items: [{ Id: 'series-1', Name: 'Batman', RecursiveItemCount: 12, Type: 'Series' }],
            pagesLoaded: 1,
            totalRecordCount: 1
        }, 10));

        const result = await searchPtvWithRecovery(options([
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
        ]));

        expect(searchPtvAuthoritativeSeries).toHaveBeenCalledTimes(1);
        expect(getPtvSearchPrimaryOutcome).not.toHaveBeenCalled();
        expect(peakRequests).toBe(PTV_SEARCH_MAX_CONCURRENCY);
        expect(result.requestCount).toBe(3);
        expect(result.groups.movies).toHaveLength(1);
        expect(result.groups.shows).toHaveLength(1);
    });

    it('does not downgrade successful hints when optional direct enrichment times out', async () => {
        const groups = emptyGroups();

        groups.movies = [{ Id: 'movie-1', Name: 'Rocky', Type: 'Movie' }];
        searchPtvHints.mockResolvedValue({ groups, hintCount: 1, totalRecordCount: 1 });
        searchPtvAuthoritativeSeries.mockImplementation(() => rejectSearchAfter(
            new PtvSearchPrimaryTimeoutError(4000),
            10
        ));

        const result = await searchPtvWithRecovery(options(['Movie', 'Series']));

        expect(result.primaryStatus).toBe('success');
        expect(result.failedGroupIds).toEqual([]);
        expect(result.groups.movies).toEqual([expect.objectContaining({ Id: 'movie-1' })]);
    });

    it('marks an empty Movie hint as incomplete when catalog recovery resolves after an error', async () => {
        searchPtvHints.mockResolvedValue({
            groups: emptyGroups(),
            hintCount: 0,
            totalRecordCount: 0
        });
        searchPtvItems.mockResolvedValue(movieSearchResult([], {
            catalogExhausted: false,
            catalogStatus: 'partial',
            catalogStopReason: 'request-error',
            recoveryAttempted: true,
            recoveryReason: 'supplemental-failed',
            supplementalStatus: 'error'
        }));

        const result = await searchPtvWithRecovery(options(['Movie']));

        expect(result.primaryStatus).toBe('success');
        expect(result.groups.movies).toEqual([]);
        expect(result.failedGroupIds).toContain('movies');
    });

    it('marks a page-limited empty Movie catalog search as incomplete', async () => {
        searchPtvHints.mockResolvedValue({
            groups: emptyGroups(),
            hintCount: 0,
            totalRecordCount: 0
        });
        searchPtvItems.mockResolvedValue(movieSearchResult([], {
            catalogExhausted: false,
            catalogStatus: 'partial',
            catalogStopReason: 'page-budget',
            recoveryAttempted: true
        }));

        const result = await searchPtvWithRecovery(options(['Movie']));

        expect(result.groups.movies).toEqual([]);
        expect(result.failedGroupIds).toContain('movies');
    });

    it('routes broad Movie recovery through the catalog-aware search boundary', async () => {
        const groups = emptyGroups();

        searchPtvHints.mockResolvedValue({ groups, hintCount: 0, totalRecordCount: 0 });
        searchPtvItems.mockResolvedValue(movieSearchResult([
            { Id: 'movie-catalog', Name: 'Alien', Type: 'Movie' }
        ]));

        const result = await searchPtvWithRecovery(options(['Movie', 'Series']));

        expect(searchPtvItems).toHaveBeenCalledWith(expect.objectContaining({
            includeItemTypes: 'Movie',
            limit: 14,
            onPrimaryResult: expect.any(Function),
            recoveryFields: expect.stringContaining('ProviderIds'),
            searchTerm: 'digimon'
        }));
        expect(result.groups.movies).toEqual([
            expect.objectContaining({ Id: 'movie-catalog' })
        ]);
        expect(result.failedGroupIds).not.toContain('movies');
    });

    it('still starts authoritative Series when hints settle during Movie recovery', async () => {
        const movieResult = createDeferred<ReturnType<typeof movieSearchResult>>();

        searchPtvHints.mockResolvedValue({
            groups: emptyGroups(),
            hintCount: 0,
            totalRecordCount: 0
        });
        searchPtvItems.mockReturnValue(movieResult.promise);

        const resultPromise = searchPtvWithRecovery(options(['Movie', 'Series']));

        await vi.waitFor(() => expect(searchPtvItems).toHaveBeenCalledTimes(1));
        movieResult.resolve(movieSearchResult());
        await resultPromise;

        expect(searchPtvAuthoritativeSeries).toHaveBeenCalledTimes(1);
    });

    it('accepts Movie catalog recovery between the primary and batch deadlines', async () => {
        vi.useFakeTimers();

        try {
            const movie = { Id: 'movie-catalog-late', Name: 'Alien', Type: 'Movie' };
            const onGroupResult = vi.fn();
            const recoveryDelayMs = PTV_SEARCH_DIRECT_GROUP_TIMEOUT_MS + 1000;

            searchPtvHints.mockImplementation(({ signal }) => rejectOnSearchAbort(signal));
            searchPtvItems.mockImplementation(({ signal }) => resolveSearchAfterUnlessAborted(
                movieSearchResult([movie], {
                    catalogExhausted: false,
                    catalogMatchCount: 1,
                    catalogRequestsThisSearch: 1,
                    catalogStatus: 'partial',
                    catalogStopReason: 'exact-match-found',
                    recoveryAttempted: true
                }),
                recoveryDelayMs,
                signal
            ));

            const resultPromise = searchPtvWithRecovery({
                ...options(['Movie', 'Series']),
                onGroupResult
            });

            await vi.advanceTimersByTimeAsync(recoveryDelayMs);
            expect(onGroupResult).toHaveBeenCalledWith(expect.objectContaining({
                groupId: 'movies',
                items: [expect.objectContaining({ Id: 'movie-catalog-late' })],
                source: 'direct'
            }));

            await vi.advanceTimersByTimeAsync(PTV_SEARCH_HINT_PRIMARY_TIMEOUT_MS - recoveryDelayMs);
            const result = await resultPromise;

            expect(recoveryDelayMs).toBeGreaterThan(PTV_SEARCH_DIRECT_GROUP_TIMEOUT_MS);
            expect(recoveryDelayMs).toBeLessThan(PTV_SEARCH_DIRECT_BATCH_TIMEOUT_MS);
            expect(result.groups.movies).toEqual([
                expect.objectContaining({ Id: 'movie-catalog-late' })
            ]);
            expect(result.failedGroupIds).not.toContain('movies');
        } finally {
            vi.useRealTimers();
        }
    });

    it('preserves progressive Movie results when catalog recovery reaches the batch deadline', async () => {
        vi.useFakeTimers();

        try {
            const movie = { Id: 'movie-primary', Name: 'Alien', Type: 'Movie' };
            const onGroupResult = vi.fn();

            searchPtvHints.mockImplementation(({ signal }) => rejectOnSearchAbort(signal));
            searchPtvItems.mockImplementation(searchOptions => {
                searchOptions.onPrimaryResult?.(movieSearchResult([movie]));
                return rejectOnSearchAbort(searchOptions.signal);
            });

            const resultPromise = searchPtvWithRecovery({
                ...options(['Movie', 'Series']),
                onGroupResult
            });

            await vi.advanceTimersByTimeAsync(PTV_SEARCH_DIRECT_BATCH_TIMEOUT_MS + 1);
            await vi.advanceTimersByTimeAsync(
                PTV_SEARCH_HINT_PRIMARY_TIMEOUT_MS - PTV_SEARCH_DIRECT_BATCH_TIMEOUT_MS
            );
            const result = await resultPromise;

            expect(onGroupResult).toHaveBeenCalledWith(expect.objectContaining({
                groupId: 'movies',
                items: [expect.objectContaining({ Id: 'movie-primary' })],
                source: 'direct'
            }));
            expect(result.groups.movies).toEqual([
                expect.objectContaining({ Id: 'movie-primary' })
            ]);
            expect(result.failedGroupIds).not.toContain('movies');
        } finally {
            vi.useRealTimers();
        }
    });

    it('adds the authoritative Series result when global hints are crowded by Episodes', async () => {
        const groups = emptyGroups();
        groups.episodes = [{ Id: 'episode-1', Name: 'Digimon Adventure', Type: 'Episode' }];
        searchPtvHints.mockResolvedValue({ groups, hintCount: 126, totalRecordCount: 400 });
        searchPtvAuthoritativeSeries.mockResolvedValue({
            items: [{ Id: 'series-valid', Name: 'Digimon Adventure', RecursiveItemCount: 54, Type: 'Series' }],
            pagesLoaded: 2,
            totalRecordCount: 54
        });

        const result = await searchPtvWithRecovery(options());

        expect(result.groups.shows.map(item => item.Id)).toEqual(['series-valid']);
        expect(result.groups.episodes).toHaveLength(1);
        expect(result.primaryStatus).toBe('success');
        expect(result.recoveredGroupIds).toContain('shows');
    });

    it('publishes fast hint groups before optional direct enrichment settles', async () => {
        const groups = emptyGroups();
        const seriesDeferred = createDeferred<{
            items: never[];
            pagesLoaded: number;
            totalRecordCount: number;
        }>();
        const onGroupResult = vi.fn();
        let completed = false;

        groups.movies = [{ Id: 'movie-fast', Name: 'Batman', Type: 'Movie' }];
        searchPtvHints.mockResolvedValue({ groups, hintCount: 1, totalRecordCount: 1 });
        searchPtvAuthoritativeSeries.mockReturnValue(seriesDeferred.promise);

        const resultPromise = searchPtvWithRecovery({
            ...options(['Movie', 'Series']),
            onGroupResult
        });

        void resultPromise.then(() => {
            completed = true;
        });
        await vi.waitFor(() => expect(onGroupResult).toHaveBeenCalledWith(expect.objectContaining({
            groupId: 'movies',
            items: [expect.objectContaining({ Id: 'movie-fast' })],
            source: 'hints'
        })));
        expect(completed).toBe(false);

        seriesDeferred.resolve({ items: [], pagesLoaded: 1, totalRecordCount: 0 });
        await resultPromise;
    });

    it('recovers every requested group with bounded Items searches after a hint failure', async () => {
        searchPtvHints.mockRejectedValue(new Error('Search/Hints unavailable'));
        searchPtvItems.mockResolvedValue(movieSearchResult([
            { Id: 'Movie-1', Name: 'Digimon', Type: 'Movie' }
        ]));
        searchPtvAuthoritativeSeries.mockResolvedValue({
            items: [{ Id: 'series-1', Name: 'Digimon', RecursiveItemCount: 10, Type: 'Series' }],
            pagesLoaded: 1,
            totalRecordCount: 1
        });
        getPtvSearchPrimaryOutcome.mockImplementation(async query => ({
            durationMs: 3,
            items: [{ Id: `${query.IncludeItemTypes}-1`, Name: 'Digimon', Type: query.IncludeItemTypes }],
            result: { Items: [] },
            status: 'success'
        }));

        const result = await searchPtvWithRecovery(options());

        expect(result.primaryStatus).toBe('error');
        expect(result.failedGroupIds).toEqual([]);
        expect(result.groups.movies).toHaveLength(1);
        expect(result.groups.shows).toHaveLength(1);
        expect(result.groups.episodes).toHaveLength(1);
    });

    it('preserves successful recovery groups when another fallback group fails', async () => {
        searchPtvHints.mockRejectedValue(new Error('Search/Hints unavailable'));
        searchPtvItems.mockRejectedValue(new Error('group unavailable'));
        searchPtvAuthoritativeSeries.mockResolvedValue({
            items: [{ Id: 'series-1', Name: 'Digimon', RecursiveItemCount: 10, Type: 'Series' }],
            pagesLoaded: 1,
            totalRecordCount: 1
        });
        getPtvSearchPrimaryOutcome.mockResolvedValue({
            durationMs: 3,
            error: new Error('group unavailable'),
            items: [],
            status: 'error'
        });

        const result = await searchPtvWithRecovery(options());

        expect(result.groups.shows).toHaveLength(1);
        expect(result.failedGroupIds).toEqual(expect.arrayContaining(['movies', 'episodes']));
        expect(result.primaryStatus).toBe('error');
    });

    it('bounds broad fallback concurrency, omits duplicate directory fallbacks, and reports partial groups progressively', async () => {
        const includeItemTypes = [
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
        ];
        const onGroupResult = vi.fn();
        let activeRequests = 0;
        let peakRequests = 0;
        const trackRequest = async <T>(value: T) => {
            activeRequests += 1;
            peakRequests = Math.max(peakRequests, activeRequests);
            await new Promise(resolve => globalThis.setTimeout(resolve, 5));
            activeRequests -= 1;
            return value;
        };

        searchPtvHints.mockRejectedValue(new Error('Search/Hints unavailable'));
        searchPtvAuthoritativeSeries.mockImplementation(() => trackRequest({
            items: [{ Id: 'series-1', Name: 'Batman', RecursiveItemCount: 12, Type: 'Series' }],
            pagesLoaded: 1,
            totalRecordCount: 1
        }));
        getPtvSearchPrimaryOutcome.mockImplementation(query => trackRequest({
            durationMs: 3,
            items: [{ Id: `${query.IncludeItemTypes}-1`, Name: 'Batman', Type: query.IncludeItemTypes }],
            result: { Items: [] },
            status: 'success' as const
        }));
        requestPtvJson.mockImplementation((path: string) => trackRequest({
            Items: [{ Id: `${path}-1`, Name: 'Batman' }],
            TotalRecordCount: 1
        }));

        const result = await searchPtvWithRecovery({
            ...options(includeItemTypes),
            onGroupResult
        });

        expect(peakRequests).toBeLessThanOrEqual(PTV_SEARCH_MAX_CONCURRENCY);
        expect(result.failedGroupIds).toEqual(expect.arrayContaining(['genres', 'studios']));
        expect(result.requestCount).toBe(10);
        expect(requestPtvJson).not.toHaveBeenCalled();
        expect(onGroupResult).toHaveBeenCalledWith(expect.objectContaining({
            groupId: 'shows',
            items: [expect.objectContaining({ Id: 'series-1' })]
        }));
        expect(onGroupResult).toHaveBeenCalledTimes(9);
    });

    it('loads video and music genres through one consolidated hint request', async () => {
        const groups = emptyGroups();

        groups.genres = [
            { Id: 'video-genre', Name: 'Drama', ServerId: 'server-1', Type: 'Genre' },
            { Id: 'music-genre', Name: 'Rock', ServerId: 'server-1', Type: 'MusicGenre' }
        ];
        searchPtvHints.mockResolvedValue({ groups, hintCount: 2, totalRecordCount: 2 });

        const result = await searchPtvWithRecovery(options(['Genre', 'MusicGenre']));

        expect(searchPtvHints).toHaveBeenCalledTimes(1);
        expect(searchPtvHints).toHaveBeenCalledWith(expect.objectContaining({
            includeItemTypes: ['Genre', 'MusicGenre'],
            query: 'digimon',
            serverId: 'server-1',
            userId: 'user-1'
        }));
        expect(requestPtvJson).not.toHaveBeenCalled();
        expect(result.groups.genres).toEqual([
            expect.objectContaining({ Id: 'video-genre', Type: 'Genre' }),
            expect.objectContaining({ Id: 'music-genre', Type: 'MusicGenre' })
        ]);
        expect(result.requestCount).toBe(1);
    });

    it('loads studios through one consolidated hint request without a direct endpoint wave', async () => {
        const groups = emptyGroups();

        groups.studios = [{
            Id: 'studio-1',
            Name: 'Marvel Studios',
            ServerId: 'server-1',
            Type: 'Studio'
        }];
        searchPtvHints.mockResolvedValue({ groups, hintCount: 1, totalRecordCount: 1 });

        const result = await searchPtvWithRecovery(options(['Studio']));

        expect(searchPtvHints).toHaveBeenCalledTimes(1);
        expect(searchPtvHints).toHaveBeenCalledWith(expect.objectContaining({
            includeItemTypes: ['Studio'],
            query: 'digimon'
        }));
        expect(requestPtvJson).not.toHaveBeenCalled();
        expect(result.groups.studios).toEqual([
            expect.objectContaining({ Id: 'studio-1', ServerId: 'server-1', Type: 'Studio' })
        ]);
        expect(result.requestCount).toBe(1);
    });

    it('accepts a cold primary response after the direct fallback batch deadline', async () => {
        vi.useFakeTimers();

        try {
            const groups = emptyGroups();
            const primaryDelayMs = PTV_SEARCH_DIRECT_BATCH_TIMEOUT_MS + 500;

            groups.movies = [{ Id: 'movie-cold', Name: 'Digimon', Type: 'Movie' }];
            groups.shows = [{ Id: 'series-cold', Name: 'Digimon', RecursiveItemCount: 54, Type: 'Series' }];
            groups.episodes = [{ Id: 'episode-cold', Name: 'Digimon', Type: 'Episode' }];
            searchPtvHints.mockImplementation(({ signal }) => resolveSearchAfterUnlessAborted({
                groups,
                hintCount: 3,
                totalRecordCount: 3
            }, primaryDelayMs, signal));
            searchPtvAuthoritativeSeries.mockImplementation(({ signal }) => rejectOnSearchAbort(signal));

            const resultPromise = searchPtvWithRecovery(options());
            let settled = false;

            void resultPromise.then(() => {
                settled = true;
            });
            await vi.advanceTimersByTimeAsync(PTV_SEARCH_DIRECT_BATCH_TIMEOUT_MS + 1);
            expect(settled).toBe(false);

            await vi.advanceTimersByTimeAsync(primaryDelayMs - PTV_SEARCH_DIRECT_BATCH_TIMEOUT_MS);
            const result = await resultPromise;

            expect(PTV_SEARCH_HINT_PRIMARY_TIMEOUT_MS).toBeGreaterThan(primaryDelayMs);
            expect(result.primaryStatus).toBe('success');
            expect(result.failedGroupIds).toEqual([]);
            expect(result.groups.movies).toEqual([expect.objectContaining({ Id: 'movie-cold' })]);
            expect(result.groups.shows).toEqual([expect.objectContaining({ Id: 'series-cold' })]);
            expect(result.groups.episodes).toEqual([expect.objectContaining({ Id: 'episode-cold' })]);
            expect(searchPtvItems).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('settles a timed-out broad search at the primary deadline without starting a directory fallback wave', async () => {
        vi.useFakeTimers();

        try {
            searchPtvHints.mockImplementation(({ signal }) => rejectOnSearchAbort(signal));
            searchPtvAuthoritativeSeries.mockImplementation(({ signal }) => rejectOnSearchAbort(signal));

            const resultPromise = searchPtvWithRecovery(options([
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
            ]));

            await vi.advanceTimersByTimeAsync(PTV_SEARCH_DIRECT_BATCH_TIMEOUT_MS + 1);

            await vi.advanceTimersByTimeAsync(
                PTV_SEARCH_HINT_PRIMARY_TIMEOUT_MS - PTV_SEARCH_DIRECT_BATCH_TIMEOUT_MS
            );
            const result = await resultPromise;

            expect(result.primaryStatus).toBe('timeout');
            expect(result.requestCount).toBe(
                1
                + searchPtvItems.mock.calls.length
                + searchPtvAuthoritativeSeries.mock.calls.length
                + getPtvSearchPrimaryOutcome.mock.calls.length
            );
            expect(result.failedGroupIds).toEqual(expect.arrayContaining([
                'shows',
                'genres',
                'studios'
            ]));
            expect(result.failedGroupIds).not.toContain('movies');
            expect(searchPtvItems).toHaveBeenCalledTimes(1);
            expect(requestPtvJson).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('returns structured group failures when hints and every fallback time out', async () => {
        searchPtvHints.mockRejectedValue(new PtvSearchPrimaryTimeoutError(PTV_SEARCH_HINT_PRIMARY_TIMEOUT_MS));
        searchPtvItems.mockRejectedValue(new PtvSearchPrimaryTimeoutError(PTV_SEARCH_DIRECT_GROUP_TIMEOUT_MS));
        searchPtvAuthoritativeSeries.mockRejectedValue(new PtvSearchPrimaryTimeoutError(4000));
        getPtvSearchPrimaryOutcome.mockResolvedValue({
            durationMs: 4000,
            error: new PtvSearchPrimaryTimeoutError(4000),
            items: [],
            status: 'timeout'
        });

        const result = await searchPtvWithRecovery(options());

        expect(result.primaryStatus).toBe('timeout');
        expect(result.failedGroupIds).toEqual(expect.arrayContaining(['movies', 'shows', 'episodes']));
        expect(result.failedGroupStatuses).toEqual({
            movies: 'timeout',
            shows: 'timeout',
            episodes: 'timeout'
        });
        expect(result.groups.movies).toEqual([]);
        expect(result.groups.shows).toEqual([]);
        expect(result.groups.episodes).toEqual([]);
    });

    it('prioritizes songs so slow metadata probes cannot prevent Audio search from starting', async () => {
        searchPtvHints.mockRejectedValue(new Error('Search/Hints unavailable'));
        getPtvSearchPrimaryOutcome.mockImplementation(async () => ({
            durationMs: 3,
            items: [],
            result: { Items: [] },
            status: 'success' as const
        }));

        await searchPtvWithRecovery(options(['Audio', 'MusicAlbum', 'MusicArtist']));

        expect(getPtvSearchPrimaryOutcome.mock.calls.map(([query]) => query.IncludeItemTypes))
            .toEqual(['Audio', 'MusicAlbum', 'MusicArtist']);
        expect(getPtvSearchPrimaryOutcome).toHaveBeenCalledWith(expect.objectContaining({
            EnableTotalRecordCount: false,
            EnableUserData: false,
            GroupItems: false
        }), expect.any(Object));
    });

    it('returns song results when album and artist searches occupy the batch deadline', async () => {
        vi.useFakeTimers();

        try {
            searchPtvHints.mockRejectedValue(new Error('Search/Hints unavailable'));
            getPtvSearchPrimaryOutcome.mockImplementation((query, requestOptions) => {
                if (query.IncludeItemTypes === 'Audio') {
                    return Promise.resolve({
                        durationMs: 3,
                        items: [{ Id: 'song-1', Name: 'Marvel', Type: 'Audio' }],
                        result: { Items: [] },
                        status: 'success' as const
                    });
                }

                return waitForSearchAbort(requestOptions.signal);
            });

            const resultPromise = searchPtvWithRecovery(options(['Audio', 'MusicAlbum', 'MusicArtist']));

            await vi.advanceTimersByTimeAsync(0);
            expect(getPtvSearchPrimaryOutcome.mock.calls.map(([query]) => query.IncludeItemTypes))
                .toEqual(['Audio', 'MusicAlbum']);

            await vi.advanceTimersByTimeAsync(PTV_SEARCH_DIRECT_BATCH_TIMEOUT_MS + 1);
            const result = await resultPromise;

            expect(result.groups.music).toEqual([expect.objectContaining({ Id: 'song-1' })]);
            expect(result.failedGroupIds).toEqual(expect.arrayContaining(['albums', 'artists']));
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not recover an externally cancelled search', async () => {
        const controller = createPtvAbortController();
        controller.abort();

        await expect(searchPtvWithRecovery({
            ...options(),
            signal: controller.signal
        })).rejects.toMatchObject({ name: 'PtvSearchAbortedError' });
        expect(getPtvSearchPrimaryOutcome).not.toHaveBeenCalled();
    });
});
