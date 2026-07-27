import { describe, expect, it, vi } from 'vitest';

import {
    executePtvSeriesSeasonsApiBoundary,
    normalizePtvSeriesSeasonsResponse
} from './seriesSeasonsBoundary';

describe('PTV Core series seasons API boundary', () => {
    it('normalizes PascalCase season metadata while retaining the raw response and order', () => {
        const response = {
            Items: [
                {
                    ChildCount: 8,
                    Id: 'season-2',
                    ImageTags: { Primary: 'tag-2' },
                    IndexNumber: 2,
                    Name: 'Season 2',
                    PrimaryImageAspectRatio: 0.67,
                    SeriesId: 'series-1',
                    Type: 'FutureSeasonKind',
                    UnknownServerField: 'retained'
                },
                {
                    Id: 'season-1',
                    IndexNumber: 1,
                    Name: 'Season 1',
                    SeriesId: 'series-1'
                }
            ],
            TotalRecordCount: 2
        };

        const result = normalizePtvSeriesSeasonsResponse<typeof response, typeof response.Items[number]>(
            response,
            { seriesId: 'series-1' }
        );

        expect(result).toMatchObject({
            success: true,
            value: {
                droppedItemCount: 0,
                raw: response,
                rawItemCount: 2,
                totalRecordCount: 2
            }
        });
        if (!result.success) throw result.error;
        expect(result.value.items.map(item => item.seasonId)).toEqual(['season-2', 'season-1']);
        expect(result.value.items[0]).toMatchObject({
            artwork: {
                aspectRatio: 0.67,
                imageType: 'Primary',
                mediaId: 'season-2',
                tag: 'tag-2'
            },
            episodeCount: 8,
            item: response.Items[0],
            seasonIndex: 2,
            seriesId: 'series-1',
            title: 'Season 2'
        });
    });

    it('accepts camelCase fields and legacy defaults', () => {
        const response = {
            items: [
                {
                    id: 'season-specials',
                    imageTags: { primary: 'special-tag' },
                    recursiveItemCount: 3,
                    type: 'Season',
                    unknownField: true
                }
            ]
        };

        const result = normalizePtvSeriesSeasonsResponse(response, {
            seriesId: 'series-1'
        });

        expect(result).toMatchObject({
            success: true,
            value: {
                droppedItemCount: 0,
                items: [{
                    episodeCount: 3,
                    seasonId: 'season-specials',
                    seriesId: 'series-1',
                    title: ''
                }],
                raw: response,
                rawItemCount: 1,
                totalRecordCount: 1
            }
        });
    });

    it('keeps valid children and drops malformed or cross-scope children without reordering', () => {
        const validFirst = { Id: 'season-1', Name: 'One', SeriesId: 'series-1' };
        const validSecond = { id: 'season-2', name: 'Two', seriesId: 'series-1' };
        const response = {
            Items: [
                validFirst,
                { Name: 'Missing ID', SeriesId: 'series-1' },
                { Id: 'foreign-season', SeriesId: 'series-2' },
                validSecond
            ],
            TotalRecordCount: 4
        };

        const result = normalizePtvSeriesSeasonsResponse(response, {
            seriesId: 'series-1'
        });

        expect(result).toMatchObject({
            success: true,
            value: {
                droppedItemCount: 2,
                rawItemCount: 4,
                totalRecordCount: 4
            }
        });
        if (!result.success) throw result.error;
        expect(result.value.items.map(item => item.item)).toEqual([validFirst, validSecond]);
    });

    it('treats an empty item list as a valid response', () => {
        const response = { Items: [], TotalRecordCount: 0 };

        expect(normalizePtvSeriesSeasonsResponse(response, {
            seriesId: 'series-1'
        })).toMatchObject({
            success: true,
            value: {
                droppedItemCount: 0,
                items: [],
                raw: response,
                rawItemCount: 0,
                totalRecordCount: 0
            }
        });
    });

    it('rejects an invalid envelope and invalid parent scope', () => {
        expect(normalizePtvSeriesSeasonsResponse({ value: [] }, {
            seriesId: 'series-1'
        })).toMatchObject({
            error: {
                code: 'API_SERIES_SEASONS_RESPONSE_INVALID',
                kind: 'parsing'
            },
            success: false
        });
        expect(normalizePtvSeriesSeasonsResponse({ Items: [] }, {
            seriesId: ' '
        })).toMatchObject({
            error: {
                code: 'API_SERIES_SEASONS_SCOPE_INVALID',
                kind: 'parsing'
            },
            success: false
        });
    });

    it('emits one privacy-safe mixed-payload diagnostic', async () => {
        const diagnostic = vi.fn();
        const result = await executePtvSeriesSeasonsApiBoundary({
            diagnostic,
            requestId: 'request-1',
            seriesId: 'series-sensitive-id',
            transport: vi.fn().mockResolvedValue({
                Items: [
                    { Id: 'season-1', SeriesId: 'series-sensitive-id' },
                    { Name: 'malformed', SeriesId: 'series-sensitive-id' }
                ]
            })
        });

        expect(result).toMatchObject({
            success: true,
            value: {
                status: 200,
                value: {
                    droppedItemCount: 1,
                    rawItemCount: 2
                }
            }
        });
        expect(diagnostic).toHaveBeenCalledTimes(1);
        expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({
            category: 'metadata',
            coreErrorCode: null,
            droppedItemCount: 1,
            method: 'GET',
            operationName: 'jellyfin-series-seasons',
            rawItemCount: 2,
            requestId: 'request-1',
            routeIdentifier: 'jellyfin:series-seasons',
            status: 200,
            success: true,
            validItemCount: 1
        }));
        expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('series-sensitive-id');
        expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('season-1');
    });

    it.each([
        [401, 'API_HTTP_401', 'authentication', false],
        [403, 'API_HTTP_403', 'authorization', false],
        [404, 'API_HTTP_404', 'server', false],
        [500, 'API_HTTP_500', 'server', true]
    ])('maps HTTP %i to %s', async (status, code, kind, retryable) => {
        const result = await executePtvSeriesSeasonsApiBoundary({
            requestId: 'request-http',
            seriesId: 'series-1',
            transport: vi.fn().mockRejectedValue({ status })
        });

        expect(result).toMatchObject({
            error: {
                code,
                httpStatus: status,
                kind,
                retryable
            },
            success: false
        });
    });

    it('distinguishes cancellation, timeout, and network failures', async () => {
        const cancelled = await executePtvSeriesSeasonsApiBoundary({
            requestId: 'request-cancel',
            seriesId: 'series-1',
            transport: vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'))
        });
        const timeout = await executePtvSeriesSeasonsApiBoundary({
            requestId: 'request-timeout',
            seriesId: 'series-1',
            transport: vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), {
                name: 'TimeoutError'
            }))
        });
        const network = await executePtvSeriesSeasonsApiBoundary({
            requestId: 'request-network',
            seriesId: 'series-1',
            transport: vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
        });

        expect(cancelled).toMatchObject({
            error: { code: 'OPERATION_CANCELLED', kind: 'cancelled' },
            success: false
        });
        expect(timeout).toMatchObject({
            error: { code: 'API_TIMEOUT', kind: 'network', retryable: true },
            success: false
        });
        expect(network).toMatchObject({
            error: { code: 'API_NETWORK_FAILURE', kind: 'network', retryable: true },
            success: false
        });
    });

    it('does not invoke transport for invalid scope and survives diagnostic failure', async () => {
        const transport = vi.fn();
        const result = await executePtvSeriesSeasonsApiBoundary({
            diagnostic: () => {
                throw new Error('diagnostic unavailable');
            },
            requestId: 'request-invalid',
            seriesId: '',
            transport
        });

        expect(result).toMatchObject({
            error: { code: 'API_SERIES_SEASONS_SCOPE_INVALID' },
            success: false
        });
        expect(transport).not.toHaveBeenCalled();
    });

    it('returns malformed payload failure even when diagnostics throw', async () => {
        const result = await executePtvSeriesSeasonsApiBoundary({
            diagnostic: () => {
                throw new Error('diagnostic unavailable');
            },
            requestId: 'request-malformed',
            seriesId: 'series-1',
            transport: vi.fn().mockResolvedValue({ Items: null })
        });

        expect(result).toMatchObject({
            error: { code: 'API_SERIES_SEASONS_RESPONSE_INVALID' },
            success: false
        });
    });
});
