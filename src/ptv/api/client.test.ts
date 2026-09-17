import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {}
}));

import { ServerConnections } from 'lib/jellyfin-apiclient';
import {
    cleanPtvQuery,
    normalizePtvApiLayerError,
    normalizePtvItemFields,
    PtvApiError,
    requestPtvJson
} from './client';
import { createPtvAbortController } from '../core/abortController';
import Events from '../../utils/events';

function createAbortableFetchMock() {
    return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        const rejectAbort = () => {
            const error = new Error('fetch aborted');
            error.name = 'AbortError';
            reject(error);
        };

        if (init?.signal?.aborted) {
            rejectAbort();
        } else {
            init?.signal?.addEventListener('abort', rejectAbort, { once: true });
        }
    }));
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });

    return {
        promise,
        resolve
    };
}

afterEach(() => {
    delete (window as unknown as { ApiClient?: unknown }).ApiClient;
    delete (ServerConnections as unknown as { getApiClient?: unknown }).getApiClient;
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('PTV ItemFields query normalization', () => {
    it('keeps only generated Jellyfin ItemFields values', () => {
        expect(normalizePtvItemFields(
            'Container,DateCreated,ImageTags,Overview,UserData,MediaSources'
        )).toBe('DateCreated,Overview,MediaSources');
    });

    it('canonicalizes and deduplicates array values', () => {
        expect(normalizePtvItemFields([
            'genres',
            'DateCreated,Overview',
            'Genres'
        ])).toBe('Genres,DateCreated,Overview');
    });

    it('preserves non-Fields query values and removes an empty Fields query', () => {
        expect(cleanPtvQuery({
            Fields: 'Container,ImageTags,UserData',
            IncludeItemTypes: 'Movie',
            Limit: 50
        })).toEqual({
            IncludeItemTypes: 'Movie',
            Limit: 50
        });
    });
});

describe('PTV API error credential safety', () => {
    it('does not retain secret-bearing endpoints or response details on the error object', () => {
        const accessCanary = [ 'PTV_TEST', 'ACCESS_TOKEN', 'api-error' ].join('_');
        const error = new PtvApiError(
            `Request failed with Bearer ${accessCanary}`,
            `https://server.invalid/Items?api_key=${accessCanary}`,
            401,
            JSON.stringify({ accessToken: accessCanary })
        );
        const serialized = JSON.stringify(error);

        expect(serialized).not.toContain(accessCanary);
        expect(serialized).toContain('[REDACTED]');
    });

    it('structurally redacts provider credentials in response objects', () => {
        const accessCanary = [ 'PTV_TEST', 'ACCESS_KEY', 'api-error' ].join('_');
        const error = normalizePtvApiLayerError({
            data: {
                accessKey: accessCanary,
                nested: { certificatePassword: accessCanary }
            },
            message: 'Request failed',
            status: 500
        }, '/Ptv/v1/status');

        expect(JSON.stringify(error)).not.toContain(accessCanary);
        expect(error.responseBody).toContain('[REDACTED]');
    });
});

describe('PTV abortable JSON transport', () => {
    it('uses the coordinator-owned bounded fetch even without an external consumer signal', async () => {
        const getJSON = vi.fn().mockResolvedValue({ transport: 'legacy' });
        const fetchMock = vi.fn().mockResolvedValue({
            json: () => Promise.resolve({ transport: 'owned' }),
            ok: true
        });

        (window as unknown as { ApiClient: Record<string, unknown> }).ApiClient = {
            getJSON,
            getUrl: (path: string) => `https://jellyfin.test/${path}`,
            setRequestHeaders: vi.fn()
        };
        vi.stubGlobal('fetch', fetchMock);

        await expect(requestPtvJson('Users/test/OwnedWithoutConsumerSignal'))
            .resolves.toEqual({ transport: 'owned' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
            method: 'GET',
            signal: expect.any(AbortSignal)
        });
        expect(getJSON).not.toHaveBeenCalled();
    });

    it('applies the owned 30-second bound when there is no external consumer signal', async () => {
        vi.useFakeTimers();
        const fetchMock = createAbortableFetchMock();

        (window as unknown as { ApiClient: Record<string, unknown> }).ApiClient = {
            getJSON: vi.fn(),
            getUrl: (path: string) => `https://jellyfin.test/${path}`,
            setRequestHeaders: vi.fn()
        };
        vi.stubGlobal('fetch', fetchMock);

        const request = requestPtvJson('Users/test/OwnedTimeoutWithoutConsumerSignal');
        const rejection = expect(request).rejects.toMatchObject({
            message: 'Jellyfin API request timed out after 30000ms.',
            name: 'PtvApiError'
        });

        await vi.advanceTimersByTimeAsync(30_000);
        await rejection;
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects route-scoped work without a consumer signal before starting transport', async () => {
        const getJSON = vi.fn().mockResolvedValue({ transport: 'legacy' });
        const fetchMock = vi.fn().mockResolvedValue({
            json: () => Promise.resolve({ transport: 'owned' }),
            ok: true
        });

        (window as unknown as { ApiClient: Record<string, unknown> }).ApiClient = {
            getJSON,
            getUrl: (path: string) => `https://jellyfin.test/${path}`,
            setRequestHeaders: vi.fn()
        };
        vi.stubGlobal('fetch', fetchMock);

        const request = requestPtvJson('Users/test/RouteSignalRequired', {
            scope: 'route'
        } as Parameters<typeof requestPtvJson>[1] & { scope: 'route' });

        await expect(request).rejects.toMatchObject({
            message: expect.stringMatching(/route.*signal/i),
            name: 'PtvApiError'
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(getJSON).not.toHaveBeenCalled();
    });

    it('fails closed instead of sending an explicit missing server identity through the current client', async () => {
        const getJSON = vi.fn();
        const fetchMock = vi.fn();

        (window as unknown as { ApiClient: Record<string, unknown> }).ApiClient = {
            getJSON,
            getUrl: (path: string) => `https://wrong-current-server.test/${path}`,
            serverId: () => 'server-a',
            setRequestHeaders: vi.fn()
        };
        vi.stubGlobal('fetch', fetchMock);

        expect(() => requestPtvJson('Users/test/Views', {
            serverId: 'missing-server-b'
        })).toThrow(PtvApiError);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(getJSON).not.toHaveBeenCalled();
    });

    it.each([
        {
            label: 'unbound',
            serverId: () => '',
            serverInfo: () => null
        },
        {
            label: 'mismatched',
            serverId: () => 'server-a',
            serverInfo: () => ({ Id: 'server-a' })
        }
    ])('fails closed when Jellyfin returns an $label client for an explicit server identity', ({ serverId, serverInfo }) => {
        const fetchMock = vi.fn();
        const getApiClient = vi.fn(() => ({
            getUrl: (path: string) => `https://wrong-server.test/${path}`,
            serverId,
            serverInfo,
            setRequestHeaders: vi.fn()
        }));

        (ServerConnections as unknown as { getApiClient: typeof getApiClient }).getApiClient = getApiClient;
        vi.stubGlobal('fetch', fetchMock);

        expect(() => requestPtvJson('Users/test/Views', {
            serverId: 'server-b'
        })).toThrow(PtvApiError);
        expect(getApiClient).toHaveBeenCalledWith('server-b');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails closed when an authenticated route has no abort-capable transport', async () => {
        const getJSON = vi.fn().mockResolvedValue({ transport: 'legacy' });
        const fetchMock = vi.fn();
        const controller = createPtvAbortController();

        (window as unknown as { ApiClient: Record<string, unknown> }).ApiClient = {
            getJSON,
            getUrl: (path: string) => `https://jellyfin.test/${path}`
        };
        vi.stubGlobal('fetch', fetchMock);

        const request = requestPtvJson('Users/test/AbortTransportRequired', {
            scope: 'route',
            signal: controller.signal
        } as Parameters<typeof requestPtvJson>[1] & { scope: 'route' });

        await expect(request).rejects.toMatchObject({
            message: expect.stringMatching(/owned.*transport.*unavailable/i),
            name: 'PtvApiError'
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(getJSON).not.toHaveBeenCalled();
    });

    it('keeps route cancellation distinct from the owned transport timeout', async () => {
        vi.useFakeTimers();
        const fetchMock = createAbortableFetchMock();
        const apiClient = {
            getJSON: vi.fn(),
            getUrl: (path: string) => `https://jellyfin.test/${path}`,
            setRequestHeaders: vi.fn()
        };
        const routeController = createPtvAbortController();
        const timeoutController = createPtvAbortController();

        (window as unknown as { ApiClient: Record<string, unknown> }).ApiClient = apiClient;
        vi.stubGlobal('fetch', fetchMock);

        const routeRequest = requestPtvJson('Users/test/RouteCancellation', {
            scope: 'route',
            signal: routeController.signal
        } as Parameters<typeof requestPtvJson>[1] & { scope: 'route' });

        await Promise.resolve();
        routeController.abort();

        await expect(routeRequest).rejects.toMatchObject({
            message: 'PTV request consumer was cancelled.',
            name: 'AbortError'
        });

        const timeoutRequest = requestPtvJson('Users/test/TransportTimeout', {
            scope: 'route',
            signal: timeoutController.signal
        } as Parameters<typeof requestPtvJson>[1] & { scope: 'route' });
        const timeoutRejection = expect(timeoutRequest).rejects.toMatchObject({
            message: 'Jellyfin API request timed out after 30000ms.',
            name: 'PtvApiError'
        });

        await vi.advanceTimersByTimeAsync(30_000);
        await timeoutRejection;
        expect(routeController.signal.aborted).toBe(true);
        expect(timeoutController.signal.aborted).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(apiClient.getJSON).not.toHaveBeenCalled();
    });

    it('does not deduplicate an authenticated URL across user identities', async () => {
        const first = createDeferred<{ owner: string }>();
        const second = createDeferred<{ owner: string }>();
        let userId = 'user-a';
        const getJSON = vi.fn();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({
                json: () => first.promise,
                ok: true
            })
            .mockResolvedValueOnce({
                json: () => second.promise,
                ok: true
            });

        (window as unknown as { ApiClient: Record<string, unknown> }).ApiClient = {
            getCurrentUserId: () => userId,
            getJSON,
            getUrl: (path: string) => `https://jellyfin.test/${path}`,
            serverId: () => 'server-a',
            setRequestHeaders: vi.fn()
        };
        vi.stubGlobal('fetch', fetchMock);

        const firstRequest = requestPtvJson<{ owner: string }>('Library/MediaFolders');

        userId = 'user-b';
        const secondRequest = requestPtvJson<{ owner: string }>('Library/MediaFolders');

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(getJSON).not.toHaveBeenCalled();

        first.resolve({ owner: 'user-a' });
        second.resolve({ owner: 'user-b' });

        await expect(firstRequest).resolves.toEqual({ owner: 'user-a' });
        await expect(secondRequest).resolves.toEqual({ owner: 'user-b' });
    });

    it('uses authenticated fetch so an owned route request can be physically cancelled', async () => {
        const getJSON = vi.fn();
        const setRequestHeaders = vi.fn((headers: Record<string, string>) => {
            headers.Authorization = 'MediaBrowser test-token';
        });
        const controller = createPtvAbortController();
        const fetchMock = createAbortableFetchMock();

        (window as unknown as { ApiClient: Record<string, unknown> }).ApiClient = {
            getJSON,
            getUrl: (path: string) => `https://jellyfin.test/${path}`,
            setRequestHeaders
        };
        vi.stubGlobal('fetch', fetchMock);

        const request = requestPtvJson('Users/test/Items', {
            signal: controller.signal
        });

        await Promise.resolve();
        controller.abort();

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
            credentials: 'same-origin',
            method: 'GET',
            signal: expect.any(AbortSignal)
        });
        expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
            Authorization: 'MediaBrowser test-token',
            accept: 'application/json'
        });
        expect(setRequestHeaders).toHaveBeenCalledTimes(1);
        expect(getJSON).not.toHaveBeenCalled();
    });

    it('preserves API client success and request-failure lifecycle signals', async () => {
        const apiClient = {
            getJSON: vi.fn(),
            getUrl: (path: string) => `https://jellyfin.test/${path}`,
            lastFetch: 0,
            setRequestHeaders: vi.fn()
        };
        const requestFailure = vi.fn();

        (window as unknown as { ApiClient: Record<string, unknown> }).ApiClient = apiClient;
        Events.on(apiClient, 'requestfail', requestFailure);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
            json: () => Promise.resolve({ Items: [] }),
            ok: true
        }));

        await expect(requestPtvJson('Users/test/Items', {
            signal: createPtvAbortController().signal
        })).resolves.toEqual({ Items: [] });
        expect(apiClient.lastFetch).toBeGreaterThan(0);
        expect(requestFailure).not.toHaveBeenCalled();

        apiClient.lastFetch = 0;
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
            headers: {
                get: () => 'server-error'
            },
            ok: false,
            status: 503,
            text: () => Promise.resolve('temporarily unavailable')
        }));

        await expect(requestPtvJson('Users/test/Latest', {
            signal: createPtvAbortController().signal
        })).rejects.toMatchObject({
            statusCode: 503
        });
        expect(apiClient.lastFetch).toBeGreaterThan(0);
        expect(requestFailure).toHaveBeenCalledTimes(1);
        expect(requestFailure.mock.calls[0]?.[1]).toMatchObject({
            errorCode: 'server-error',
            status: 503,
            url: 'https://jellyfin.test/Users/test/Latest'
        });
    });

    it('aborts the owned transport after the Jellyfin 30-second request bound', async () => {
        vi.useFakeTimers();
        const fetchMock = createAbortableFetchMock();
        const apiClient = {
            getJSON: vi.fn(),
            getUrl: (path: string) => `https://jellyfin.test/${path}`,
            lastFetch: 0,
            setRequestHeaders: vi.fn()
        };
        const requestFailure = vi.fn();
        const consumerController = createPtvAbortController();

        (window as unknown as { ApiClient: Record<string, unknown> }).ApiClient = apiClient;
        Events.on(apiClient, 'requestfail', requestFailure);
        vi.stubGlobal('fetch', fetchMock);

        const request = requestPtvJson('Users/test/Items', {
            signal: consumerController.signal
        });
        const rejection = expect(request).rejects.toMatchObject({
            message: 'Jellyfin API request timed out after 30000ms.',
            statusCode: null
        });

        await vi.advanceTimersByTimeAsync(30_000);

        await rejection;
        expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
        expect(consumerController.signal.aborted).toBe(false);
        expect(apiClient.lastFetch).toBe(0);
        expect(requestFailure).toHaveBeenCalledTimes(1);
        expect(requestFailure.mock.calls[0]?.[1]).toMatchObject({
            errorCode: null,
            status: 0,
            url: 'https://jellyfin.test/Users/test/Items'
        });
    });
});
