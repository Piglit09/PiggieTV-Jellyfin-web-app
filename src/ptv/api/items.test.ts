import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
    cleanPtvQuery: (query: Record<string, unknown> | undefined) => {
        if (!query) return undefined;

        const entries = Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== '');

        return entries.length ? Object.fromEntries(entries) : undefined;
    },
    getPtvApiClient: vi.fn(),
    getPtvCurrentUserId: vi.fn(),
    requestPtvJson: vi.fn()
}));

vi.mock('../core/observability', () => ({
    recordPtvEvent: vi.fn()
}));

vi.mock('../services/requestCoordinator', () => {
    const inFlight = new Map<string, Promise<unknown>>();

    return {
        coordinatePtvJsonRequest: <T>(key: string, task: () => Promise<T>) => {
            const existing = inFlight.get(key) as Promise<T> | undefined;
            if (existing) return existing;

            const promise = task().finally(() => {
                if (inFlight.get(key) === promise) inFlight.delete(key);
            });
            inFlight.set(key, promise);

            return promise;
        },
        getPtvRequestCoordinatorKey: (method: string, url: string, includeAuthorization = true) => [
            method.toUpperCase(),
            includeAuthorization ? 'auth' : 'anon',
            url
        ].join(' ')
    };
});

import {
    buildPtvRecentlyAddedRequest,
    getPtvItem,
    getPtvItemCoreResult,
    getPtvItems,
    getPtvResumeItems,
    normalizeJellyfinItemListResponse
} from './items';
import {
    getPtvApiClient,
    getPtvCurrentUserId,
    requestPtvJson
} from './client';
import { recordPtvEvent } from '../core/observability';

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPtvCurrentUserId).mockReturnValue('user-1');
});

describe('Jellyfin Latest item response normalization', () => {
    it('retains every item from a raw Items/Latest array', () => {
        const items = Array.from({ length: 96 }, (_, index) => ({ Id: String(index), Name: `Movie ${index}` }));

        const result = normalizeJellyfinItemListResponse(items);

        expect(result.responseShape).toBe('array');
        expect(result.rawItemCount).toBe(96);
        expect(result.items).toHaveLength(96);
    });

    it('supports wrapped Jellyfin item responses without treating the wrapper as an item', () => {
        const result = normalizeJellyfinItemListResponse({
            Items: [{ Id: 'toy-story-5', Name: 'Toy Story 5' }],
            TotalRecordCount: 96
        });

        expect(result.responseShape).toBe('wrapped-items');
        expect(result.items).toEqual([{ Id: 'toy-story-5', Name: 'Toy Story 5' }]);
        expect(result.totalRecordCount).toBe(96);
    });

    it('returns an explicit invalid shape instead of inventing a candidate from an invalid response', () => {
        const result = normalizeJellyfinItemListResponse({ TotalRecordCount: 96 });

        expect(result.responseShape).toBe('invalid');
        expect(result.items).toEqual([]);
        expect(result.rawItemCount).toBe(0);
    });

    it('builds an unscoped, user-authorized Latest Movies request without ParentId', () => {
        const request = buildPtvRecentlyAddedRequest({
            IncludeItemTypes: 'Movie',
            Limit: 96,
            ParentId: undefined
        }, { userId: 'user-1' });

        expect(request.endpoint).toBe('Users/user-1/Items/Latest');
        expect(request.params).toEqual({ IncludeItemTypes: 'Movie', Limit: 96 });
        expect(request.params.ParentId).toBeUndefined();
    });
});

describe('coordinated Jellyfin item requests', () => {
    it('routes one item details lookup through Core while preserving the legacy facade value', async () => {
        const response = {
            Id: 'movie-1',
            Name: 'Movie One',
            RunTimeTicks: 10_000_000,
            Type: 'Movie'
        };
        const getItem = vi.fn().mockResolvedValue(response);

        vi.mocked(getPtvApiClient).mockReturnValue({
            getItem,
            serverId: () => 'server-1'
        });

        await expect(getPtvItem('movie-1')).resolves.toBe(response);
        expect(getItem).toHaveBeenCalledTimes(1);
        expect(getItem).toHaveBeenCalledWith('user-1', 'movie-1');

        const coreResult = await getPtvItemCoreResult('movie-2');
        expect(coreResult).toMatchObject({
            success: true,
            value: {
                status: 200,
                value: {
                    media: {
                        id: 'movie-1',
                        mediaType: 'movie'
                    },
                    runtimeMs: 1000
                }
            }
        });
    });

    it('shares one in-flight item lookup without creating a duplicate request', async () => {
        let resolveRequest: ((value: { Id: string }) => void) | undefined;
        const pending = new Promise<{ Id: string }>(resolve => {
            resolveRequest = resolve;
        });
        const getItem = vi.fn().mockReturnValue(pending);

        vi.mocked(getPtvApiClient).mockReturnValue({
            getItem,
            serverId: () => 'server-1'
        });

        const first = getPtvItem('movie-deduplicated');
        const second = getPtvItem('movie-deduplicated');

        expect(getItem).toHaveBeenCalledTimes(1);
        resolveRequest?.({ Id: 'movie-deduplicated' });

        await expect(Promise.all([first, second])).resolves.toEqual([
            { Id: 'movie-deduplicated' },
            { Id: 'movie-deduplicated' }
        ]);
        expect(getItem).toHaveBeenCalledTimes(1);
    });

    it('preserves the existing facade error object while exposing a mapped CoreError', async () => {
        const legacyError = Object.assign(new Error('Not authorized'), { status: 401 });
        const getItem = vi.fn().mockRejectedValue(legacyError);

        vi.mocked(getPtvApiClient).mockReturnValue({
            getItem,
            serverId: () => 'server-1'
        });

        await expect(getPtvItem('private-movie')).rejects.toBe(legacyError);
        await expect(getPtvItemCoreResult('private-movie')).resolves.toMatchObject({
            error: {
                code: 'API_HTTP_401',
                kind: 'authentication'
            },
            success: false
        });
        expect(getItem).toHaveBeenCalledTimes(2);
    });

    it('rejects one missing-item lookup after one 404 transport without retrying', async () => {
        const legacyError = Object.assign(new Error('Item not found'), { status: 404 });
        const getItem = vi.fn().mockRejectedValue(legacyError);

        vi.mocked(getPtvApiClient).mockReturnValue({
            getItem,
            serverId: () => 'server-1'
        });

        await expect(getPtvItem('missing-movie')).rejects.toBe(legacyError);

        expect(getItem).toHaveBeenCalledTimes(1);
        expect(getItem).toHaveBeenCalledWith('user-1', 'missing-movie');
        expect(recordPtvEvent).toHaveBeenCalledTimes(1);
        expect(recordPtvEvent).toHaveBeenCalledWith(
            'api',
            'ptv-core-item-details-request',
            expect.objectContaining({
                coreErrorCode: 'API_HTTP_404',
                status: 404,
                success: false
            })
        );
    });

    it('sends list reads through the shared JSON request boundary', async () => {
        const response = { Items: [{ Id: 'movie-1' }], TotalRecordCount: 1 };

        vi.mocked(requestPtvJson).mockResolvedValue(response);

        await expect(getPtvItems({
            EnableTotalRecordCount: false,
            IncludeItemTypes: 'Movie',
            Limit: 20
        })).resolves.toBe(response);
        expect(requestPtvJson).toHaveBeenCalledWith('Users/user-1/Items', {
            params: {
                EnableTotalRecordCount: false,
                IncludeItemTypes: 'Movie',
                Limit: 20
            },
            serverId: undefined
        });
    });

    it('preserves the Jellyfin resume endpoint while using the shared boundary', async () => {
        const response = { Items: [{ Id: 'resume-1' }], TotalRecordCount: 1 };

        vi.mocked(requestPtvJson).mockResolvedValue(response);

        await expect(getPtvResumeItems({
            IncludeItemTypes: 'Movie',
            Limit: 20,
            SortBy: 'DatePlayed',
            SortOrder: 'Descending'
        })).resolves.toBe(response);
        expect(requestPtvJson).toHaveBeenCalledWith('Users/user-1/Items/Resume', {
            params: {
                IncludeItemTypes: 'Movie',
                Limit: 20,
                SortBy: 'DatePlayed',
                SortOrder: 'Descending'
            },
            serverId: undefined
        });
    });
});
