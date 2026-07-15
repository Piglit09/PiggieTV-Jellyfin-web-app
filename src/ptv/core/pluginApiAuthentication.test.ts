import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectionMocks = vi.hoisted(() => ({
    client: null as null | {
        accessToken: () => string;
        getCurrentUserId: () => string;
        getJSON: ReturnType<typeof vi.fn>;
        getUrl: (path: string) => string;
    }
}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: () => connectionMocks.client
    }
}));

import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from '../../utils/events';

import {
    getCurrentPtvPluginApiClient,
    getPtvPluginApiDiagnostics,
    resetPtvPluginApiAvailability
} from './pluginApi';

describe('plugin API authentication startup', () => {
    beforeEach(() => {
        window.localStorage.clear();
        resetPtvPluginApiAvailability();
    });

    it('waits for authentication and deduplicates status, settings, and featured startup reads', async () => {
        let token = '';
        let userId = '';
        const getJSON = vi.fn(async (url: string) => ({ url }));

        connectionMocks.client = {
            accessToken: () => token,
            getCurrentUserId: () => userId,
            getJSON,
            getUrl: path => `http://jellyfin.test/${path}`
        };

        const pluginApi = getCurrentPtvPluginApiClient(connectionMocks.client);

        expect(pluginApi).not.toBeNull();

        const requests = [
            pluginApi!.getStatus(),
            pluginApi!.getStatus(),
            pluginApi!.getSettings(),
            pluginApi!.getSettings(),
            pluginApi!.getFeaturedContentCacheDocument(),
            pluginApi!.getFeaturedContentCacheDocument()
        ];

        await Promise.resolve();
        expect(getJSON).not.toHaveBeenCalled();

        token = 'authenticated';
        userId = 'user';
        Events.trigger(ServerConnections, 'localusersignedin');

        await Promise.all(requests);

        const diagnostics = getPtvPluginApiDiagnostics();

        expect(getJSON).toHaveBeenCalledTimes(3);
        expect(diagnostics.statusAttemptCount).toBe(1);
        expect(diagnostics.settingsAttemptCount).toBe(1);
        expect(diagnostics.featuredAttemptCount).toBe(1);
        expect(diagnostics.deduplicatedRequestCount).toBe(3);
        expect(diagnostics.authenticationReadyRetryCount).toBe(1);
        expect(diagnostics.startupReasonCounts).toMatchObject({
            'authenticated-retry': 1,
            'pre-authentication-wait': 6
        });
        expect(diagnostics.attemptedResponses.every(entry => entry.status !== 401)).toBe(true);
    });
});
