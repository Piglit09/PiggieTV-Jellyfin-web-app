import { beforeEach, describe, expect, it, vi } from 'vitest';

const integrationMocks = vi.hoisted(() => ({
    currentServerId: 'server-a',
    getSettings: vi.fn()
}));

vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: () => ({
        getCurrentServerId: () => integrationMocks.currentServerId,
        getSettings: integrationMocks.getSettings
    })
}));

import {
    clearPtvIntegrationSettingsCache,
    getPtvIntegrationSettings
} from './integrationsConfig';

describe('PiggieTV integration settings cache', () => {
    beforeEach(() => {
        clearPtvIntegrationSettingsCache();
        integrationMocks.currentServerId = 'server-a';
        integrationMocks.getSettings.mockReset();
    });

    it('isolates cached settings by active server identity', async () => {
        integrationMocks.getSettings
            .mockResolvedValueOnce({ seerrSettings: { displayName: 'Server A' } })
            .mockResolvedValueOnce({ seerrSettings: { displayName: 'Server B' } });

        await expect(getPtvIntegrationSettings()).resolves.toMatchObject({
            seerr: { displayName: 'Server A' }
        });

        integrationMocks.currentServerId = 'server-b';
        await expect(getPtvIntegrationSettings()).resolves.toMatchObject({
            seerr: { displayName: 'Server B' }
        });
        expect(integrationMocks.getSettings).toHaveBeenCalledTimes(2);

        integrationMocks.currentServerId = 'server-a';
        await expect(getPtvIntegrationSettings()).resolves.toMatchObject({
            seerr: { displayName: 'Server A' }
        });
        expect(integrationMocks.getSettings).toHaveBeenCalledTimes(2);
    });

    it('deduplicates concurrent reads only within the same server', async () => {
        let resolveSettings: ((value: unknown) => void) | undefined;
        integrationMocks.getSettings.mockReturnValue(new Promise(resolve => {
            resolveSettings = resolve;
        }));

        const first = getPtvIntegrationSettings();
        const second = getPtvIntegrationSettings();

        expect(integrationMocks.getSettings).toHaveBeenCalledTimes(1);
        resolveSettings?.({ seerrSettings: { displayName: 'Shared' } });
        await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    });
});
