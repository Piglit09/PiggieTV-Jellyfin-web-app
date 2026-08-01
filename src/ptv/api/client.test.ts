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

import {
    cleanPtvQuery,
    normalizePtvItemFields,
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

describe('PTV abortable JSON transport', () => {
    it('does not deduplicate an authenticated URL across user identities', async () => {
        const first = createDeferred<{ owner: string }>();
        const second = createDeferred<{ owner: string }>();
        let userId = 'user-a';
        const getJSON = vi.fn()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        (window as unknown as { ApiClient: Record<string, unknown> }).ApiClient = {
            getCurrentUserId: () => userId,
            getJSON,
            getUrl: (path: string) => `https://jellyfin.test/${path}`,
            serverId: () => 'server-a'
        };

        const firstRequest = requestPtvJson<{ owner: string }>('Library/MediaFolders');

        userId = 'user-b';
        const secondRequest = requestPtvJson<{ owner: string }>('Library/MediaFolders');

        expect(getJSON).toHaveBeenCalledTimes(2);

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
