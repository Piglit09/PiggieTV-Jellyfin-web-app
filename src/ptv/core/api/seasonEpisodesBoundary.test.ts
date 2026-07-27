import { describe, expect, it, vi } from 'vitest';

import {
    executePtvSeasonEpisodesApiBoundary,
    normalizePtvSeasonEpisodesResponse
} from './seasonEpisodesBoundary';

describe('PTV Core season episodes API boundary', () => {
    it('normalizes PascalCase episode metadata, progress, and ticks without mutating raw data', () => {
        const episode = {
            Id: 'episode-2',
            ImageTags: { Primary: 'episode-tag' },
            IndexNumber: 2,
            Name: 'Episode Two',
            Overview: 'Existing overview',
            ParentIndexNumber: 3,
            PremiereDate: '2026-04-05T00:00:00.000Z',
            PrimaryImageAspectRatio: 1.78,
            RunTimeTicks: 72_000_000,
            SeasonId: 'season-3',
            SeriesId: 'series-1',
            Type: 'FutureEpisodeKind',
            UnknownServerField: 'retained',
            UserData: {
                PlaybackPositionTicks: 15_000_000,
                Played: false,
                PlayedPercentage: 20.5
            }
        };
        const response = {
            Items: [episode],
            TotalRecordCount: 1
        };

        const result = normalizePtvSeasonEpisodesResponse<typeof response, typeof episode>(
            response,
            {
                seasonId: 'season-3',
                seriesId: 'series-1'
            }
        );

        expect(result).toMatchObject({
            success: true,
            value: {
                droppedInvalidIdCount: 0,
                droppedItemCount: 0,
                droppedSeasonScopeCount: 0,
                droppedSeriesScopeCount: 0,
                raw: response,
                rawItemCount: 1,
                totalRecordCount: 1
            }
        });
        if (!result.success) throw result.error;
        expect(result.value.raw).toBe(response);
        expect(result.value.items[0].item).toBe(episode);
        expect(result.value.items[0]).toMatchObject({
            artwork: {
                aspectRatio: 1.78,
                imageType: 'Primary',
                mediaId: 'episode-2',
                tag: 'episode-tag'
            },
            episodeId: 'episode-2',
            episodeIndex: 2,
            overview: 'Existing overview',
            premiereDate: '2026-04-05T00:00:00.000Z',
            progress: {
                playbackPositionMilliseconds: 1500,
                played: false,
                playedPercentage: 20.5
            },
            runtimeMilliseconds: 7200,
            seasonId: 'season-3',
            seasonIndex: 3,
            seriesId: 'series-1',
            title: 'Episode Two'
        });
        expect(episode.RunTimeTicks).toBe(72_000_000);
        expect(episode.UserData.PlaybackPositionTicks).toBe(15_000_000);
    });

    it('accepts camelCase aliases, omitted child scope, and null optional values', () => {
        const scopedByRequest = {
            id: 'episode-1',
            indexNumber: 1,
            name: 'Episode One',
            overview: null,
            premiereDate: null,
            runTimeTicks: null,
            type: 'Episode',
            userData: null
        };
        const camelCaseProgress = {
            id: 'episode-2',
            seasonId: 'season-1',
            seriesId: 'series-1',
            userData: {
                playbackPositionTicks: null,
                played: true,
                playedPercentage: 0
            }
        };
        const response = {
            items: [scopedByRequest, camelCaseProgress]
        };

        const result = normalizePtvSeasonEpisodesResponse(response, {
            seasonId: 'season-1',
            seriesId: 'series-1'
        });

        expect(result).toMatchObject({
            success: true,
            value: {
                items: [
                    {
                        episodeId: 'episode-1',
                        episodeIndex: 1,
                        seasonId: 'season-1',
                        seriesId: 'series-1',
                        title: 'Episode One'
                    },
                    {
                        episodeId: 'episode-2',
                        progress: {
                            played: true,
                            playedPercentage: 0
                        }
                    }
                ],
                rawItemCount: 2,
                totalRecordCount: 2
            }
        });
        if (!result.success) throw result.error;
        expect(result.value.items[0].progress).toBeUndefined();
        expect(result.value.items[0].runtimeMilliseconds).toBeUndefined();
        expect(result.value.items[0].overview).toBeUndefined();
        expect(result.value.items[0].premiereDate).toBeUndefined();
        expect(result.value.items[1].progress?.playbackPositionMilliseconds).toBeUndefined();
    });

    it('treats an empty episode list as valid', () => {
        const response = { Items: [], TotalRecordCount: 0 };

        expect(normalizePtvSeasonEpisodesResponse(response, {
            seasonId: 'season-1',
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

    it('keeps valid children ordered and counts each mixed-payload drop category', () => {
        const validFirst = { Id: 'episode-1', Name: 'One' };
        const validSecond = {
            Id: 'episode-2',
            SeasonId: 'season-1',
            SeriesId: 'series-1'
        };
        const response = {
            Items: [
                validFirst,
                { Name: 'Missing ID' },
                { Id: '   ' },
                { Id: 'foreign-series', SeriesId: 'series-2' },
                { Id: 'foreign-season', SeasonId: 'season-2', SeriesId: 'series-1' },
                validSecond
            ],
            TotalRecordCount: 6
        };

        const result = normalizePtvSeasonEpisodesResponse(response, {
            seasonId: 'season-1',
            seriesId: 'series-1'
        });

        expect(result).toMatchObject({
            success: true,
            value: {
                droppedInvalidIdCount: 2,
                droppedItemCount: 4,
                droppedSeasonScopeCount: 1,
                droppedSeriesScopeCount: 1,
                rawItemCount: 6,
                totalRecordCount: 6
            }
        });
        if (!result.success) throw result.error;
        expect(result.value.items.map(item => item.item)).toEqual([validFirst, validSecond]);
    });

    it('returns a valid empty normalized list when all children are malformed', () => {
        const result = normalizePtvSeasonEpisodesResponse({
            Items: [
                { Name: 'No ID' },
                { Id: 'foreign-series', SeriesId: 'series-2' },
                { Id: 'foreign-season', SeasonId: 'season-2' }
            ]
        }, {
            seasonId: 'season-1',
            seriesId: 'series-1'
        });

        expect(result).toMatchObject({
            success: true,
            value: {
                droppedInvalidIdCount: 1,
                droppedItemCount: 3,
                droppedSeasonScopeCount: 1,
                droppedSeriesScopeCount: 1,
                items: [],
                rawItemCount: 3
            }
        });
    });

    it('rejects invalid requested series and season scopes', () => {
        expect(normalizePtvSeasonEpisodesResponse({ Items: [] }, {
            seasonId: 'season-1',
            seriesId: ' '
        })).toMatchObject({
            error: { code: 'API_SEASON_EPISODES_SERIES_SCOPE_INVALID' },
            success: false
        });
        expect(normalizePtvSeasonEpisodesResponse({ Items: [] }, {
            seasonId: '',
            seriesId: 'series-1'
        })).toMatchObject({
            error: { code: 'API_SEASON_EPISODES_SEASON_SCOPE_INVALID' },
            success: false
        });
    });

    it('rejects an invalid envelope instead of converting it to empty success', () => {
        expect(normalizePtvSeasonEpisodesResponse({ value: [] }, {
            seasonId: 'season-1',
            seriesId: 'series-1'
        })).toMatchObject({
            error: {
                code: 'API_SEASON_EPISODES_RESPONSE_INVALID',
                kind: 'parsing'
            },
            success: false
        });
    });

    it.each([
        { SeriesId: 'series-2' },
        { SeasonId: 'season-2' },
        { seriesId: 'series-2', seasonId: 'season-2' }
    ])('rejects conflicting envelope scope case %#', scope => {
        expect(normalizePtvSeasonEpisodesResponse({
            ...scope,
            Items: []
        }, {
            seasonId: 'season-1',
            seriesId: 'series-1'
        })).toMatchObject({
            error: { code: 'API_SEASON_EPISODES_RESPONSE_SCOPE_INVALID' },
            success: false
        });
    });

    it('emits one privacy-safe success diagnostic with exact drop counts', async () => {
        const diagnostic = vi.fn();
        const result = await executePtvSeasonEpisodesApiBoundary({
            diagnostic,
            requestId: 'request-1',
            seasonId: 'season-sensitive-id',
            seriesId: 'series-sensitive-id',
            transport: vi.fn().mockResolvedValue({
                Items: [
                    {
                        Id: 'episode-sensitive-id',
                        Path: '/private/media/episode.mkv',
                        SeasonId: 'season-sensitive-id',
                        SeriesId: 'series-sensitive-id'
                    },
                    { Name: 'Malformed episode' },
                    { Id: 'foreign-series', SeriesId: 'series-other' },
                    { Id: 'foreign-season', SeasonId: 'season-other' }
                ],
                RequestUrl: 'https://private.example/Shows/series/Episodes'
            })
        });

        expect(result).toMatchObject({
            success: true,
            value: {
                value: {
                    droppedInvalidIdCount: 1,
                    droppedItemCount: 3,
                    droppedSeasonScopeCount: 1,
                    droppedSeriesScopeCount: 1,
                    rawItemCount: 4
                }
            }
        });
        expect(diagnostic).toHaveBeenCalledTimes(1);
        expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({
            category: 'metadata',
            coreErrorCode: null,
            droppedInvalidIdCount: 1,
            droppedSeasonScopeCount: 1,
            droppedSeriesScopeCount: 1,
            method: 'GET',
            operationName: 'jellyfin-season-episodes',
            rawItemCount: 4,
            requestId: 'request-1',
            routeIdentifier: 'jellyfin:season-episodes',
            status: 200,
            success: true,
            validItemCount: 1
        }));
        const serializedDiagnostic = JSON.stringify(diagnostic.mock.calls);
        expect(serializedDiagnostic).not.toContain('episode-sensitive-id');
        expect(serializedDiagnostic).not.toContain('series-sensitive-id');
        expect(serializedDiagnostic).not.toContain('season-sensitive-id');
        expect(serializedDiagnostic).not.toContain('/private/media');
        expect(serializedDiagnostic).not.toContain('private.example');
        expect(serializedDiagnostic).not.toContain('RequestUrl');
    });

    it.each([
        [401, 'API_HTTP_401', 'authentication', false],
        [403, 'API_HTTP_403', 'authorization', false],
        [404, 'API_HTTP_404', 'server', false],
        [500, 'API_HTTP_500', 'server', true]
    ])('maps HTTP %i to %s', async (status, code, kind, retryable) => {
        const diagnostic = vi.fn();
        const result = await executePtvSeasonEpisodesApiBoundary({
            diagnostic,
            requestId: 'request-http',
            seasonId: 'season-1',
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
        expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({
            coreErrorCode: code,
            status,
            success: false
        }));
    });

    it('distinguishes cancellation, timeout, and network failures', async () => {
        const cancelled = await executePtvSeasonEpisodesApiBoundary({
            requestId: 'request-cancel',
            seasonId: 'season-1',
            seriesId: 'series-1',
            transport: vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'))
        });
        const timeout = await executePtvSeasonEpisodesApiBoundary({
            requestId: 'request-timeout',
            seasonId: 'season-1',
            seriesId: 'series-1',
            transport: vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), {
                name: 'TimeoutError'
            }))
        });
        const network = await executePtvSeasonEpisodesApiBoundary({
            requestId: 'request-network',
            seasonId: 'season-1',
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

    it('does not call transport for invalid scope and survives diagnostic failure', async () => {
        const transport = vi.fn();
        const result = await executePtvSeasonEpisodesApiBoundary({
            diagnostic: () => {
                throw new Error('diagnostic unavailable');
            },
            requestId: 'request-invalid',
            seasonId: '',
            seriesId: 'series-1',
            transport
        });

        expect(result).toMatchObject({
            error: { code: 'API_SEASON_EPISODES_SEASON_SCOPE_INVALID' },
            success: false
        });
        expect(transport).not.toHaveBeenCalled();
    });

    it('returns malformed payload failure even when diagnostics throw', async () => {
        const result = await executePtvSeasonEpisodesApiBoundary({
            diagnostic: () => {
                throw new Error('diagnostic unavailable');
            },
            requestId: 'request-malformed',
            seasonId: 'season-1',
            seriesId: 'series-1',
            transport: vi.fn().mockResolvedValue({ Items: null })
        });

        expect(result).toMatchObject({
            error: { code: 'API_SEASON_EPISODES_RESPONSE_INVALID' },
            success: false
        });
    });
});
