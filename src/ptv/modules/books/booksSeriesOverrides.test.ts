import { beforeEach, describe, expect, it, vi } from 'vitest';

const pluginState = vi.hoisted(() => ({
    get: vi.fn(),
    save: vi.fn(),
    status: vi.fn()
}));

const userState = vi.hoisted(() => ({
    getCurrent: vi.fn(),
    isAdmin: vi.fn()
}));

vi.mock('../../api', () => ({
    getPtvCurrentUser: userState.getCurrent,
    isPtvAdminUser: userState.isAdmin
}));

vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: vi.fn(() => ({
        getReadingSeriesOverrides: pluginState.get,
        getStatus: pluginState.status,
        saveReadingSeriesOverrides: pluginState.save
    }))
}));

import {
    getPtvReadingOverridePersistenceState,
    loadPtvReadingSeriesOverridesFromServer,
    savePtvReadingSeriesOverrides
} from './booksSeriesOverrides';

const OLD_PLUGIN_VERSION = ['10', '11', '8', '1'].join('.');
const CURRENT_PLUGIN_VERSION = ['10', '11', '8', '2'].join('.');

describe('Reading series override persistence', () => {
    beforeEach(() => {
        window.localStorage.clear();
        pluginState.get.mockReset();
        pluginState.save.mockReset();
        pluginState.status.mockReset();
        userState.getCurrent.mockReset();
        userState.isAdmin.mockReset();
        userState.getCurrent.mockResolvedValue({});
        userState.isAdmin.mockReturnValue(true);
        pluginState.status.mockResolvedValue({
            apiVersion: 1,
            cacheVersion: 7,
            featureFlags: { readingSeriesOverrides: true },
            pluginVersion: CURRENT_PLUGIN_VERSION
        });
    });

    it('uses browser cache without probing administrator-only endpoints for non-admin users', async () => {
        window.localStorage.setItem('ptv:reading:series-overrides:v1:books', JSON.stringify({
            volume2: {
                itemId: 'volume2',
                seriesTitle: 'A Cached Series',
                volumeNumber: 2
            }
        }));
        userState.isAdmin.mockReturnValue(false);

        const overrides = await loadPtvReadingSeriesOverridesFromServer('books');

        expect(overrides.volume2?.seriesTitle).toBe('A Cached Series');
        expect(pluginState.status).not.toHaveBeenCalled();
        expect(pluginState.get).not.toHaveBeenCalled();
        expect(getPtvReadingOverridePersistenceState('books')).toMatchObject({
            authority: 'browser-cache',
            endpointAvailable: false,
            lastCategory: 'administrator-required',
            serverPersistenceConfirmed: false,
            upgradeRequired: false
        });
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
            serverPersistenceConfirmed: true,
            upgradeRequired: false
        });
    });

    it('labels an unavailable server contract as browser cache only', async () => {
        pluginState.get.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));

        await loadPtvReadingSeriesOverridesFromServer('manga');

        expect(getPtvReadingOverridePersistenceState('manga')).toMatchObject({
            authority: 'browser-cache',
            endpointAvailable: false,
            lastCategory: 'upgrade-required',
            routeKind: 'manga',
            serverPersistenceConfirmed: false,
            upgradeRequired: true
        });
    });

    it('does not call an unavailable override endpoint on plugin 10.11.8.1', async () => {
        pluginState.status.mockResolvedValue({
            apiVersion: 1,
            cacheVersion: 7,
            features: ['status', 'featuredContent'],
            pluginVersion: OLD_PLUGIN_VERSION
        });

        await loadPtvReadingSeriesOverridesFromServer('manga');

        expect(pluginState.get).not.toHaveBeenCalled();
        expect(getPtvReadingOverridePersistenceState('manga')).toMatchObject({
            authority: 'browser-cache',
            endpointAvailable: false,
            lastCategory: 'upgrade-required',
            message: expect.stringContaining(CURRENT_PLUGIN_VERSION),
            serverPersistenceConfirmed: false,
            upgradeRequired: true
        });
    });

    it('rejects server-persistence saves when the connected plugin lacks the capability', async () => {
        pluginState.status.mockResolvedValue({
            apiVersion: 1,
            cacheVersion: 7,
            featureFlags: { readingSeriesOverrides: false },
            pluginVersion: OLD_PLUGIN_VERSION
        });

        await expect(savePtvReadingSeriesOverrides('comics', {})).rejects.toMatchObject({
            code: 'PTV_READING_OVERRIDE_PLUGIN_UPGRADE_REQUIRED'
        });
        expect(pluginState.save).not.toHaveBeenCalled();
    });
});
