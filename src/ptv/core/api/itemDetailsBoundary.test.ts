import { describe, expect, it, vi } from 'vitest';

import {
    executePtvItemDetailsApiBoundary,
    normalizePtvItemDetailsResponse,
    PTV_ITEM_DETAILS_OPERATION,
    PTV_ITEM_DETAILS_ROUTE_IDENTIFIER
} from './itemDetailsBoundary';

describe('PTV Core item details response boundary', () => {
    it('normalizes a PascalCase Jellyfin response without modifying the original object', () => {
        const response = Object.freeze({
            Id: 'movie:opaque/1',
            Name: 'Example Movie',
            ParentId: 'library-1',
            RunTimeTicks: 72_000_000,
            ServerId: 'server-1',
            SortName: 'Example Movie, The',
            Type: 'Movie',
            UnknownFutureField: { enabled: true }
        });
        const result = normalizePtvItemDetailsResponse<typeof response>(response, {
            userId: 'user-1'
        });

        expect(result).toEqual({
            success: true,
            value: {
                item: response,
                media: {
                    id: 'movie:opaque/1',
                    libraryId: 'library-1',
                    mediaType: 'movie',
                    originalMediaType: 'Movie',
                    serverId: 'server-1',
                    sortTitle: 'Example Movie, The',
                    title: 'Example Movie',
                    userId: 'user-1'
                },
                runtimeMs: 7200
            }
        });
        expect(response.UnknownFutureField).toEqual({ enabled: true });
    });

    it('accepts supported camelCase aliases, missing optional fields, nulls, and empty collections', () => {
        const response = {
            genres: [],
            id: 'episode-1',
            name: null,
            parentId: null,
            runTimeTicks: null,
            serverId: 'server-2',
            type: 'Episode'
        };
        const result = normalizePtvItemDetailsResponse<typeof response>(response);

        expect(result).toMatchObject({
            success: true,
            value: {
                item: response,
                media: {
                    id: 'episode-1',
                    mediaType: 'episode',
                    serverId: 'server-2',
                    title: ''
                },
                runtimeMs: undefined
            }
        });
    });

    it.each([
        null,
        {},
        { Id: null },
        { Id: '' },
        { Id: 42 }
    ])('rejects a malformed required ID in %j', response => {
        expect(normalizePtvItemDetailsResponse(response)).toMatchObject({
            error: {
                code: 'API_ITEM_DETAILS_ID_INVALID',
                kind: 'parsing',
                operation: PTV_ITEM_DETAILS_OPERATION
            },
            success: false
        });
    });
});

describe('PTV Core item details API execution', () => {
    it('returns a Core API response and one bounded success diagnostic', async () => {
        const diagnostic = vi.fn();
        const transport = vi.fn().mockResolvedValue({
            Id: 'private-media-id',
            Name: 'Movie',
            Type: 'Movie'
        });

        const result = await executePtvItemDetailsApiBoundary({
            diagnostic,
            requestId: 'request-1',
            serverId: 'private-server-id',
            transport,
            userId: 'private-user-id'
        });

        expect(result).toMatchObject({
            success: true,
            value: {
                correlationId: 'request-1',
                headers: {},
                status: 200,
                value: {
                    media: {
                        id: 'private-media-id',
                        serverId: 'private-server-id',
                        userId: 'private-user-id'
                    }
                }
            }
        });
        expect(transport).toHaveBeenCalledTimes(1);
        expect(diagnostic).toHaveBeenCalledTimes(1);
        expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({
            coreErrorCode: null,
            method: 'GET',
            operationName: PTV_ITEM_DETAILS_OPERATION,
            requestId: 'request-1',
            routeIdentifier: PTV_ITEM_DETAILS_ROUTE_IDENTIFIER,
            status: 200,
            success: true
        }));
        expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private-media-id');
        expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private-server-id');
        expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private-user-id');
    });

    it('maps cancellation, timeouts, network failures, and HTTP failures without retrying', async () => {
        const cases = [
            {
                error: new DOMException('Stopped', 'AbortError'),
                expected: { code: 'OPERATION_CANCELLED', kind: 'cancelled', retryable: false }
            },
            {
                error: Object.assign(new Error('Request timed out'), { name: 'TimeoutError' }),
                expected: { code: 'API_TIMEOUT', kind: 'network', retryable: true }
            },
            {
                error: new TypeError('Network request failed'),
                expected: { code: 'API_NETWORK_FAILURE', kind: 'network', retryable: true }
            },
            {
                error: { status: 401 },
                expected: { code: 'API_HTTP_401', kind: 'authentication', retryable: false }
            },
            {
                error: { statusCode: 403 },
                expected: { code: 'API_HTTP_403', kind: 'authorization', retryable: false }
            },
            {
                error: { response: { status: 404 } },
                expected: { code: 'API_HTTP_404', kind: 'server', retryable: false }
            },
            {
                error: { response: { status: 503 } },
                expected: { code: 'API_HTTP_503', kind: 'server', retryable: true }
            }
        ] as const;

        for (const testCase of cases) {
            const transport = vi.fn().mockRejectedValue(testCase.error);
            const result = await executePtvItemDetailsApiBoundary({
                requestId: 'request-failure',
                transport
            });

            expect(result).toMatchObject({
                error: testCase.expected,
                success: false
            });
            expect(transport).toHaveBeenCalledTimes(1);
        }
    });

    it('reports malformed responses once without leaking response bodies', async () => {
        const diagnostic = vi.fn();
        const privateValue = ['private', 'token'].join('-');
        const result = await executePtvItemDetailsApiBoundary({
            diagnostic,
            requestId: 'request-malformed',
            transport: () => Promise.resolve({
                Authorization: `Bearer ${privateValue}`,
                Items: []
            })
        });

        expect(result).toMatchObject({
            error: { code: 'API_ITEM_DETAILS_ID_INVALID' },
            success: false
        });
        expect(diagnostic).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(privateValue);
        expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('Authorization');
    });

    it('keeps diagnostics failures nonblocking', async () => {
        await expect(executePtvItemDetailsApiBoundary({
            diagnostic: () => {
                throw new Error('diagnostic sink failed');
            },
            requestId: 'request-diagnostic-failure',
            transport: () => Promise.resolve({ Id: 'movie-1' })
        })).resolves.toMatchObject({
            success: true
        });
    });
});
