import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../core/observability', () => ({
    recordPtvEvent: vi.fn()
}));

import { recordPtvEvent } from '../core/observability';
import {
    getPtvSeasonEpisodes,
    getPtvSeasonEpisodesCoreResult
} from './seasonEpisodes';

describe('season details episode metadata facade', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calls the existing transport once with the exact series and options object and returns raw identity', async () => {
        const response = {
            Items: [{
                Id: 'episode-1',
                SeasonId: 'season-1',
                SeriesId: 'series-1'
            }],
            TotalRecordCount: 1
        };
        const fields = 'ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount,Overview,MediaSources';
        const query = {
            Fields: fields,
            seasonId: 'season-1',
            userId: 'user-1'
        };
        const getEpisodes = vi.fn().mockResolvedValue(response);

        const result = await getPtvSeasonEpisodes(
            { getEpisodes },
            'series-1',
            'season-1',
            query
        );

        expect(result).toBe(response);
        expect(getEpisodes).toHaveBeenCalledTimes(1);
        expect(getEpisodes).toHaveBeenCalledWith('series-1', query);
        expect(getEpisodes.mock.calls[0][1]).toBe(query);
        expect(query).toEqual({
            Fields: fields,
            seasonId: 'season-1',
            userId: 'user-1'
        });
        expect(query).not.toHaveProperty('EnableUserData');
        expect(query).not.toHaveProperty('IncludeItemTypes');
        expect(query).not.toHaveProperty('Limit');
        expect(query).not.toHaveProperty('Recursive');
        expect(query).not.toHaveProperty('SortBy');
        expect(recordPtvEvent).toHaveBeenCalledTimes(1);
        expect(recordPtvEvent).toHaveBeenCalledWith(
            'api',
            'ptv-core-season-episodes-request',
            expect.objectContaining({
                category: 'metadata',
                success: true,
                validItemCount: 1
            })
        );
    });

    it('offers a Core result without causing an extra request or mutating response order', async () => {
        const first = {
            Id: 'episode-2',
            SeasonId: 'season-1',
            SeriesId: 'series-1'
        };
        const second = {
            Id: 'episode-1',
            SeasonId: 'season-1',
            SeriesId: 'series-1'
        };
        const response = { Items: [first, second] };
        const getEpisodes = vi.fn().mockResolvedValue(response);

        const result = await getPtvSeasonEpisodesCoreResult(
            { getEpisodes },
            'series-1',
            'season-1'
        );

        expect(result).toMatchObject({
            success: true,
            value: {
                value: {
                    items: [
                        { episodeId: 'episode-2' },
                        { episodeId: 'episode-1' }
                    ],
                    rawItemCount: 2
                }
            }
        });
        if (!result.success) throw result.error;
        expect(result.value.value.raw).toBe(response);
        expect(result.value.value.items.map(item => item.item)).toEqual([first, second]);
        expect(getEpisodes).toHaveBeenCalledTimes(1);
    });

    it('rethrows original authentication, cancellation, and network errors without retry', async () => {
        const authError = { status: 401 };
        const cancelError = new DOMException('cancelled', 'AbortError');
        const networkError = new TypeError('Failed to fetch');
        const authTransport = vi.fn().mockRejectedValue(authError);
        const cancelTransport = vi.fn().mockRejectedValue(cancelError);
        const networkTransport = vi.fn().mockRejectedValue(networkError);

        await expect(getPtvSeasonEpisodes(
            { getEpisodes: authTransport },
            'series-1',
            'season-1'
        )).rejects.toBe(authError);
        await expect(getPtvSeasonEpisodes(
            { getEpisodes: cancelTransport },
            'series-1',
            'season-1'
        )).rejects.toBe(cancelError);
        await expect(getPtvSeasonEpisodes(
            { getEpisodes: networkTransport },
            'series-1',
            'season-1'
        )).rejects.toBe(networkError);
        expect(authTransport).toHaveBeenCalledTimes(1);
        expect(cancelTransport).toHaveBeenCalledTimes(1);
        expect(networkTransport).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['', 'season-1', 'API_SEASON_EPISODES_SERIES_SCOPE_INVALID'],
        ['series-1', '', 'API_SEASON_EPISODES_SEASON_SCOPE_INVALID']
    ])('does not call transport for invalid requested scope', async (seriesId, seasonId, code) => {
        const getEpisodes = vi.fn();

        await expect(getPtvSeasonEpisodes(
            { getEpisodes },
            seriesId,
            seasonId
        )).rejects.toMatchObject({
            coreError: { code },
            name: 'PtvApiError'
        });
        expect(getEpisodes).not.toHaveBeenCalled();
    });

    it('keeps metadata reads successful when event diagnostics fail', async () => {
        vi.mocked(recordPtvEvent).mockImplementation(() => {
            throw new Error('event sink unavailable');
        });
        const response = { Items: [] };

        await expect(getPtvSeasonEpisodes({
            getEpisodes: vi.fn().mockResolvedValue(response)
        }, 'series-1', 'season-1')).resolves.toBe(response);
    });
});
