import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiIdentity = vi.hoisted(() => ({
    serverId: 'server-a',
    userId: 'user-a'
}));
const apiUrlServerIds = vi.hoisted<Array<string | null | undefined>>(() => []);
const apiMocks = vi.hoisted(() => ({
    getPtvApiUrl: vi.fn((
        endpoint: string,
        query: Record<string, unknown> | undefined,
        serverId?: string | null
    ) => {
        apiUrlServerIds.push(serverId);

        return `https://shared.test/${endpoint.endsWith('/Latest') ? 'latest' : 'items'}?query=${encodeURIComponent(JSON.stringify(query || {}))}`;
    }),
    requestPtvJson: vi.fn()
}));
const providerEventMocks = vi.hoisted(() => ({
    logFailure: vi.fn(),
    logStage: vi.fn()
}));

vi.mock('../../../api', () => ({
    cleanPtvQuery: vi.fn((query: Record<string, unknown> | undefined) => query),
    getPtvApiUrl: apiMocks.getPtvApiUrl,
    getPtvCurrentUserId: vi.fn(() => apiIdentity.userId),
    getPtvServerId: vi.fn(() => apiIdentity.serverId),
    PtvApiError: class PtvApiError extends Error {
        responseBody = '';
        statusCode: number | null = null;
    },
    requestPtvJson: apiMocks.requestPtvJson
}));

vi.mock('../../books/booksApi', () => ({
    getPtvReadingHome: vi.fn()
}));

vi.mock('../../music/musicApi', () => ({
    getPtvMusicHome: vi.fn(),
    getPtvMusicLibrary: vi.fn(async () => null)
}));

vi.mock('../debug/recommendationRuntimeDebug', () => ({
    logPtvRecommendationFailure: providerEventMocks.logFailure,
    logPtvRecommendationStage: providerEventMocks.logStage
}));

type RequestOptions = {
    params?: Record<string, unknown>;
    serverId?: string | null;
    signal?: AbortSignal;
};

function emptyPayload(endpoint: string): unknown {
    return endpoint.endsWith('/Items/Latest') ? [] : {
        Items: [],
        TotalRecordCount: 0
    };
}

function createAbortError() {
    return Object.assign(new Error('Request aborted.'), {
        name: 'AbortError'
    });
}

async function loadProvider() {
    return import('./jellyfinRecommendationProvider');
}

describe('Jellyfin recommendation provider request lifecycle', () => {
    beforeEach(() => {
        vi.resetModules();
        apiIdentity.serverId = 'server-a';
        apiIdentity.userId = 'user-a';
        apiUrlServerIds.length = 0;
        apiMocks.getPtvApiUrl.mockClear();
        apiMocks.requestPtvJson.mockReset();
        providerEventMocks.logFailure.mockReset();
        providerEventMocks.logStage.mockReset();
    });

    it('propagates one captured server/user identity and signal to every coordinated request', async () => {
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill for legacy web runtimes.
        const controller = new AbortController();

        apiMocks.requestPtvJson.mockImplementation(async (endpoint: string) => {
            apiIdentity.serverId = 'server-after-start';
            apiIdentity.userId = 'user-after-start';

            return emptyPayload(endpoint);
        });

        const { getPtvRecommendationDataBundle } = await loadProvider();

        await getPtvRecommendationDataBundle({ signal: controller.signal });

        expect(apiMocks.requestPtvJson).toHaveBeenCalledTimes(5);
        apiMocks.requestPtvJson.mock.calls.forEach(([endpoint, options]) => {
            expect(endpoint).toContain('Users/user-a/');
            expect(options as RequestOptions).toMatchObject({
                serverId: 'server-a',
                signal: controller.signal
            });
        });
        apiUrlServerIds.forEach(serverId => {
            expect(serverId).toBe('server-a');
        });
    });

    it('carries the engine diagnostic generation through provider and source lifecycle events', async () => {
        const diagnosticGenerationId = 'recommendation-generation-test';

        apiMocks.requestPtvJson.mockImplementation(async endpoint => emptyPayload(endpoint));

        const { getPtvRecommendationDataBundle } = await loadProvider();

        await getPtvRecommendationDataBundle({ diagnosticGenerationId });

        const lifecycleStages = new Set([
            'Candidate fetch completed',
            'Candidate fetch started',
            'Provider created',
            'Provider loaded',
            'Provider prerequisites resolved',
            'Source fetch completed',
            'Source fetch started',
            'Source request completed',
            'Source request started'
        ]);
        const lifecycleCalls = providerEventMocks.logStage.mock.calls.filter(([ stage ]) => lifecycleStages.has(stage));

        expect(lifecycleCalls.length).toBeGreaterThan(0);
        lifecycleCalls.forEach(([, detail ]) => {
            expect(detail).toMatchObject({ generationId: diagnosticGenerationId });
        });
    });

    it('keeps provider failures scoped to the same diagnostic generation', async () => {
        const diagnosticGenerationId = 'recommendation-generation-failure-test';

        apiMocks.requestPtvJson.mockRejectedValue(new Error('bounded source failure'));

        const { getPtvRecommendationDataBundle } = await loadProvider();

        await getPtvRecommendationDataBundle({ diagnosticGenerationId });

        expect(providerEventMocks.logFailure.mock.calls.length).toBeGreaterThan(0);
        providerEventMocks.logFailure.mock.calls.forEach(([, , detail ]) => {
            expect(detail).toMatchObject({ generationId: diagnosticGenerationId });
        });
    });

    it('physically aborts active wrapper requests without launching queued sources or fallbacks', async () => {
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill for legacy web runtimes.
        const controller = new AbortController();
        const observedSignals: AbortSignal[] = [];

        apiMocks.requestPtvJson.mockImplementation((
            _endpoint: string,
            options: RequestOptions
        ) => new Promise((_resolve, reject) => {
            if (options.signal) observedSignals.push(options.signal);
            // eslint-disable-next-line sonarjs/no-nested-functions -- The request must reject from its abort listener.
            options.signal?.addEventListener('abort', () => reject(createAbortError()), { once: true });
        }));

        const { getPtvRecommendationDataBundle } = await loadProvider();
        const request = getPtvRecommendationDataBundle({ signal: controller.signal });

        await vi.waitFor(() => {
            expect(apiMocks.requestPtvJson).toHaveBeenCalledTimes(2);
        });
        controller.abort();

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(observedSignals).toHaveLength(2);
        expect(observedSignals.every(signal => signal.aborted)).toBe(true);
        expect(apiMocks.requestPtvJson).toHaveBeenCalledTimes(2);
    });

    it('caps source traffic at two while preserving canonical result order', async () => {
        const pending: Array<() => void> = [];
        const startOrder: string[] = [];
        let activeRequests = 0;
        let maxActiveRequests = 0;

        apiMocks.requestPtvJson.mockImplementation((
            endpoint: string,
            options: RequestOptions
        ) => new Promise(resolve => {
            let source = 'broad-candidates';

            if (endpoint.endsWith('/Items/Latest')) {
                source = 'recently-added';
            } else if (options.params?.Filters === 'IsFavorite') {
                source = 'favorites';
            } else if (options.params?.Filters === 'IsResumable') {
                source = 'resume';
            } else if (options.params?.SortBy === 'DatePlayed') {
                source = 'history';
            }

            startOrder.push(source);
            activeRequests += 1;
            maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
            // eslint-disable-next-line sonarjs/no-nested-functions -- Deferred releases expose the provider pool's live concurrency.
            pending.push(() => {
                activeRequests -= 1;
                const item = {
                    Id: source,
                    Name: source,
                    Type: 'Movie'
                };

                resolve(endpoint.endsWith('/Items/Latest') ? [item] : {
                    Items: [item],
                    TotalRecordCount: 1
                });
            });
        }));

        const { getPtvRecommendationDataBundle } = await loadProvider();
        const bundleRequest = getPtvRecommendationDataBundle();

        await vi.waitFor(() => {
            expect(apiMocks.requestPtvJson).toHaveBeenCalledTimes(2);
        });
        expect(startOrder).toEqual(['favorites', 'history']);

        for (const expectedCallCount of [3, 4, 5]) {
            pending.shift()?.();
            await vi.waitFor(() => {
                expect(apiMocks.requestPtvJson).toHaveBeenCalledTimes(expectedCallCount);
            });
        }

        pending.splice(0).forEach(resolve => {
            resolve();
        });

        const bundle = await bundleRequest;

        expect(maxActiveRequests).toBe(2);
        expect(startOrder).toEqual([
            'favorites',
            'history',
            'recently-added',
            'resume',
            'broad-candidates'
        ]);
        expect(bundle.profileSignals.map(input => input.item.Id)).toEqual([
            'favorites',
            'history',
            'resume'
        ]);
        expect(bundle.candidates.map(input => input.item.Id)).toEqual([
            'broad-candidates',
            'recently-added',
            'favorites',
            'resume'
        ]);
    });

    it('launches exactly one fallback when the latest endpoint returns 500', async () => {
        let latestFailed = false;
        let resolveBroadCandidates: ((value: unknown) => void) | undefined;

        apiMocks.requestPtvJson.mockImplementation((
            endpoint: string,
            options: RequestOptions
        ) => {
            if (endpoint.endsWith('/Items/Latest') && !latestFailed) {
                latestFailed = true;
                return Promise.reject(Object.assign(new Error('Server failure.'), {
                    statusCode: 500
                }));
            }

            const isUnfilteredDateCreatedQuery = options.params?.SortBy === 'DateCreated'
                && options.params.Filters === undefined;
            const payload = emptyPayload(endpoint);

            if (isUnfilteredDateCreatedQuery && !resolveBroadCandidates) {
                return new Promise(resolve => {
                    resolveBroadCandidates = resolve;
                });
            }

            if (isUnfilteredDateCreatedQuery) resolveBroadCandidates?.(payload);

            return Promise.resolve(payload);
        });

        const { getPtvRecommendationDataBundle } = await loadProvider();

        await getPtvRecommendationDataBundle();

        expect(apiMocks.requestPtvJson).toHaveBeenCalledTimes(6);
        expect(apiMocks.requestPtvJson.mock.calls.filter(([endpoint]) => (
            String(endpoint).endsWith('/Items/Latest')
        ))).toHaveLength(1);

        const lastCall = apiMocks.requestPtvJson.mock.calls[apiMocks.requestPtvJson.mock.calls.length - 1];

        expect(lastCall?.[0]).toBe('Users/user-a/Items');
        expect((lastCall?.[1] as RequestOptions | undefined)?.params).toMatchObject({
            SortBy: 'DateCreated',
            SortOrder: 'Descending'
        });
    });

    it('rethrows transport cancellation without starting a recently-added fallback', async () => {
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill for legacy web runtimes.
        const controller = new AbortController();

        apiMocks.requestPtvJson.mockImplementation(async (endpoint: string) => {
            if (endpoint.endsWith('/Items/Latest')) {
                throw createAbortError();
            }

            return emptyPayload(endpoint);
        });

        const { getPtvRecommendationDataBundle } = await loadProvider();
        const request = getPtvRecommendationDataBundle({ signal: controller.signal });

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });

        expect(apiMocks.requestPtvJson).toHaveBeenCalledTimes(5);
        expect(apiMocks.requestPtvJson.mock.calls.filter(([endpoint]) => (
            String(endpoint).endsWith('/Items/Latest')
        ))).toHaveLength(1);
    });

    it('does not let a response that arrives after retirement satisfy a later consumer', async () => {
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill for legacy web runtimes.
        const controller = new AbortController();
        let resolveLatest: ((value: unknown[]) => void) | undefined;

        apiMocks.requestPtvJson.mockImplementation((endpoint: string) => {
            if (endpoint.endsWith('/Items/Latest')) {
                return new Promise<unknown[]>(resolve => {
                    resolveLatest = resolve;
                });
            }

            return Promise.resolve(emptyPayload(endpoint));
        });

        const { getPtvRecommendationDataBundle } = await loadProvider();
        const retiredRequest = getPtvRecommendationDataBundle({ signal: controller.signal });

        await vi.waitFor(() => {
            expect(apiMocks.requestPtvJson).toHaveBeenCalledTimes(5);
        });
        controller.abort();
        await expect(retiredRequest).rejects.toMatchObject({ name: 'AbortError' });

        resolveLatest?.([]);
        await Promise.resolve();
        apiMocks.requestPtvJson.mockImplementation(async (endpoint: string) => emptyPayload(endpoint));

        await getPtvRecommendationDataBundle();

        expect(apiMocks.requestPtvJson.mock.calls.filter(([endpoint]) => (
            String(endpoint).endsWith('/Items/Latest')
        ))).toHaveLength(2);
    });

    it('does not share source responses across invocations or server/user identities', async () => {
        apiMocks.requestPtvJson.mockImplementation(async (endpoint: string) => emptyPayload(endpoint));

        const { getPtvRecommendationDataBundle } = await loadProvider();

        await getPtvRecommendationDataBundle();
        await getPtvRecommendationDataBundle();
        expect(apiMocks.requestPtvJson).toHaveBeenCalledTimes(10);

        apiIdentity.serverId = 'server-b';
        await getPtvRecommendationDataBundle();
        expect(apiMocks.requestPtvJson).toHaveBeenCalledTimes(15);

        apiIdentity.userId = 'user-b';
        await getPtvRecommendationDataBundle();
        expect(apiMocks.requestPtvJson).toHaveBeenCalledTimes(20);

        const serverIds = apiMocks.requestPtvJson.mock.calls.map(([, options]) => (
            (options as RequestOptions).serverId
        ));

        expect(serverIds.slice(0, 10)).toEqual(Array(10).fill('server-a'));
        expect(serverIds.slice(10, 15)).toEqual(Array(5).fill('server-b'));
        expect(serverIds.slice(15, 20)).toEqual(Array(5).fill('server-b'));
        expect(apiMocks.requestPtvJson.mock.calls.slice(15).every(([endpoint]) => (
            String(endpoint).includes('Users/user-b/')
        ))).toBe(true);
    });
});
