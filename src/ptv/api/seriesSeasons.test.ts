import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../core/observability', () => ({
    recordPtvEvent: vi.fn()
}));

vi.mock('./client', () => ({
    requestPtvJson: vi.fn()
}));

import { recordPtvEvent } from '../core/observability';
import { createPtvAbortController } from '../core/abortController';
import { requestPtvJson } from './client';
import {
    getPtvSeriesSeasonItems,
    getPtvSeriesSeasons,
    getPtvSeriesSeasonsCoreResult
} from './seriesSeasons';

describe('series details season metadata facade', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calls the existing transport once with the same scope and options and returns raw bytes-equivalent data', async () => {
        const response = {
            Items: [{ Id: 'season-1', SeriesId: 'series-1' }],
            TotalRecordCount: 1
        };
        const query = {
            Fields: 'ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount',
            userId: 'user-1'
        };
        const getSeasons = vi.fn().mockResolvedValue(response);

        const result = await getPtvSeriesSeasons({ getSeasons }, 'series-1', query);

        expect(result).toBe(response);
        expect(getSeasons).toHaveBeenCalledTimes(1);
        expect(getSeasons).toHaveBeenCalledWith('series-1', query);
        expect(getSeasons.mock.calls[0][1]).toBe(query);
        expect(recordPtvEvent).toHaveBeenCalledTimes(1);
        expect(recordPtvEvent).toHaveBeenCalledWith(
            'api',
            'ptv-core-series-seasons-request',
            expect.objectContaining({
                category: 'metadata',
                success: true,
                validItemCount: 1
            })
        );
    });

    it('offers a Core result without causing a duplicate network call', async () => {
        const getSeasons = vi.fn().mockResolvedValue({
            Items: [{ id: 'season-1', seriesId: 'series-1' }]
        });

        const result = await getPtvSeriesSeasonsCoreResult({ getSeasons }, 'series-1');

        expect(result).toMatchObject({
            success: true,
            value: {
                value: {
                    items: [{ seasonId: 'season-1', seriesId: 'series-1' }],
                    rawItemCount: 1
                }
            }
        });
        expect(getSeasons).toHaveBeenCalledTimes(1);
    });

    it('returns only Core-approved season rows without changing their order or identity', async () => {
        type Season = Readonly<{
            Id?: string;
            Name?: string;
            SeriesId?: string;
        }>;
        const first: Season = {
            Id: 'season-2',
            Name: 'Season 2',
            SeriesId: 'series-1'
        };
        const second: Season = {
            Id: 'season-1',
            Name: 'Season 1',
            SeriesId: 'series-1'
        };
        const response = {
            Items: [
                first,
                null,
                { Name: 'Missing ID', SeriesId: 'series-1' },
                { Id: 'foreign-season', SeriesId: 'series-2' },
                second
            ]
        };
        const getSeasons = vi.fn().mockResolvedValue(response);

        const result = await getPtvSeriesSeasonItems<Season>(
            { getSeasons },
            'series-1'
        );

        expect(result).toEqual([first, second]);
        expect(result[0]).toBe(first);
        expect(result[1]).toBe(second);
        expect(getSeasons).toHaveBeenCalledTimes(1);
        expect(recordPtvEvent).toHaveBeenCalledWith(
            'api',
            'ptv-core-series-seasons-request',
            expect.objectContaining({
                droppedItemCount: 3,
                success: true,
                validItemCount: 2
            })
        );
    });

    it('rethrows the original legacy transport failure for authentication and cancellation compatibility', async () => {
        const authError = { status: 401 };
        const cancelError = new DOMException('cancelled', 'AbortError');
        const authTransport = vi.fn().mockRejectedValue(authError);
        const cancelTransport = vi.fn().mockRejectedValue(cancelError);

        await expect(getPtvSeriesSeasons({ getSeasons: authTransport }, 'series-1'))
            .rejects.toBe(authError);
        await expect(getPtvSeriesSeasonItems({ getSeasons: cancelTransport }, 'series-1'))
            .rejects.toBe(cancelError);
        expect(authTransport).toHaveBeenCalledTimes(1);
        expect(cancelTransport).toHaveBeenCalledTimes(1);
    });

    it('does not call the transport for an invalid parent scope', async () => {
        const getSeasons = vi.fn();

        await expect(getPtvSeriesSeasons({ getSeasons }, ' '))
            .rejects.toMatchObject({
                coreError: {
                    code: 'API_SERIES_SEASONS_SCOPE_INVALID'
                },
                name: 'PtvApiError'
            });
        expect(getSeasons).not.toHaveBeenCalled();
    });

    it('keeps metadata reads successful when event diagnostics fail', async () => {
        vi.mocked(recordPtvEvent).mockImplementation(() => {
            throw new Error('event sink unavailable');
        });
        const response = { Items: [] };

        await expect(getPtvSeriesSeasons({
            getSeasons: vi.fn().mockResolvedValue(response)
        }, 'series-1')).resolves.toBe(response);
    });

    it('uses the abortable route transport without changing the legacy query contract', async () => {
        const controller = createPtvAbortController();
        const response = { Items: [{ Id: 'season-1' }] };
        const query = {
            Fields: 'ItemCounts',
            userId: 'user-1'
        };
        const getSeasons = vi.fn();

        vi.mocked(requestPtvJson).mockResolvedValue(response);

        await expect(getPtvSeriesSeasonItems(
            { getSeasons },
            'series-1',
            query,
            {
                serverId: 'server-1',
                signal: controller.signal
            }
        )).resolves.toEqual(response.Items);
        expect(requestPtvJson).toHaveBeenCalledWith('Shows/series-1/Seasons', {
            params: query,
            serverId: 'server-1',
            signal: controller.signal
        });
        expect(getSeasons).not.toHaveBeenCalled();
    });
});
