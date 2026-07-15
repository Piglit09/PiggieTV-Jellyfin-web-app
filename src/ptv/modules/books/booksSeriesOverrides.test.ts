import { beforeEach, describe, expect, it, vi } from 'vitest';

const pluginState = vi.hoisted(() => ({
    get: vi.fn(),
    save: vi.fn()
}));

vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: vi.fn(() => ({
        getReadingSeriesOverrides: pluginState.get,
        saveReadingSeriesOverrides: pluginState.save
    }))
}));

import {
    getPtvReadingOverridePersistenceState,
    loadPtvReadingSeriesOverridesFromServer,
    savePtvReadingSeriesOverrides
} from './booksSeriesOverrides';

describe('Reading series override persistence', () => {
    beforeEach(() => {
        window.localStorage.clear();
        pluginState.get.mockReset();
        pluginState.save.mockReset();
    });

    it('migrates legacy browser overrides to plugin persistence once', async () => {
        window.localStorage.setItem('ptv:reading:series-overrides:v1:manga', JSON.stringify({
            volume1: {
                itemId: 'volume1',
                seriesTitle: "The Ancient Magus' Bride",
                volumeNumber: 1
            }
        }));
        pluginState.get.mockResolvedValue({ overrides: {} });
        pluginState.save.mockImplementation((_routeKind, body) => Promise.resolve(body));

        const overrides = await loadPtvReadingSeriesOverridesFromServer('manga');

        expect(overrides.volume1?.seriesTitle).toBe("The Ancient Magus' Bride");
        expect(pluginState.save).toHaveBeenCalledTimes(1);
        expect(pluginState.save).toHaveBeenCalledWith('manga', {
            overrides: expect.objectContaining({
                volume1: expect.objectContaining({ volumeNumber: 1 })
            })
        });
    });

    it('uses plugin state as authoritative after a reload', async () => {
        let serverOverrides: Record<string, unknown> = {};

        pluginState.get.mockImplementation(() => Promise.resolve({ overrides: serverOverrides }));
        pluginState.save.mockImplementation((_routeKind, body: { overrides: Record<string, unknown> }) => {
            serverOverrides = body.overrides;

            return Promise.resolve({ overrides: serverOverrides });
        });

        await savePtvReadingSeriesOverrides('comics', {
            issue3: {
                issueNumber: 3,
                itemId: 'issue3',
                seriesTitle: 'Absolute Carnage vs. Deadpool'
            }
        });
        window.localStorage.clear();

        const reloadedOverrides = await loadPtvReadingSeriesOverridesFromServer('comics');

        expect(reloadedOverrides.issue3).toMatchObject({
            issueNumber: 3,
            seriesTitle: 'Absolute Carnage vs. Deadpool'
        });
        expect(getPtvReadingOverridePersistenceState('comics')).toMatchObject({
            authority: 'server',
            endpointAvailable: true,
            serverPersistenceConfirmed: true
        });
    });

    it('labels an unavailable server contract as browser cache only', async () => {
        pluginState.get.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));

        await loadPtvReadingSeriesOverridesFromServer('manga');

        expect(getPtvReadingOverridePersistenceState('manga')).toEqual({
            authority: 'browser-cache',
            endpointAvailable: false,
            lastCategory: 'endpoint-missing',
            routeKind: 'manga',
            serverPersistenceConfirmed: false
        });
    });
});
