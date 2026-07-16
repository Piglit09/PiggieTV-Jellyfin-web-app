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
    resetPtvPluginApiAvailability,
    waitForCurrentPtvPluginApiClient
} from './pluginApi';

describe('plugin API authentication startup', () => {
    beforeEach(() => {
        connectionMocks.client = null;
        (window as unknown as { ApiClient?: unknown }).ApiClient = undefined;
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
            getUrl: path => `http://localhost:8096/${path}`
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

    it('uses the authenticated window client during a direct dashboard load', async () => {
        const getJSON = vi.fn(async (url: string) => ({ url }));
        const windowClient = {
            accessToken: () => 'authenticated',
            getCurrentUserId: () => 'user',
            getJSON,
            getUrl: (path: string) => `http://localhost:8096/${path}`
        };

        (window as unknown as { ApiClient?: typeof windowClient }).ApiClient = windowClient;

        const pluginApi = getCurrentPtvPluginApiClient();

        expect(pluginApi).not.toBeNull();
        await pluginApi!.getStatus({ bypassCache: true });
        expect(getJSON).toHaveBeenCalledTimes(1);
        expect(getJSON.mock.calls[0]?.[0]).toBe('http://localhost:8096/Ptv/v1/status');
    });

    it('prefers an authenticated window client over a stale unauthenticated connection client', async () => {
        const staleGetJSON = vi.fn(async (url: string) => ({ url }));
        const activeGetJSON = vi.fn(async (url: string) => ({ url }));

        connectionMocks.client = {
            accessToken: () => '',
            getCurrentUserId: () => '',
            getJSON: staleGetJSON,
            getUrl: path => `https://stale.example.test/${path}`
        };

        const windowClient = {
            accessToken: () => 'test-session',
            getCurrentUserId: () => 'test-user',
            getJSON: activeGetJSON,
            getUrl: (path: string) => `https://media.example.test/${path}`
        };

        (window as unknown as { ApiClient?: typeof windowClient }).ApiClient = windowClient;

        const authenticationWaitCountBefore = getPtvPluginApiDiagnostics().authenticationWaitCount;
        const pluginApi = getCurrentPtvPluginApiClient();

        expect(pluginApi).not.toBeNull();
        await pluginApi!.getStatus({ bypassCache: true });
        expect(staleGetJSON).not.toHaveBeenCalled();
        expect(activeGetJSON).toHaveBeenCalledWith('https://media.example.test/Ptv/v1/status', true);
        expect(getPtvPluginApiDiagnostics().authenticationWaitCount).toBe(authenticationWaitCountBefore);
    });

    it('waits for a late direct-dashboard client without issuing a pre-authentication request', async () => {
        const getJSON = vi.fn(async (url: string) => ({ url }));
        const lateClient = {
            accessToken: () => 'authenticated',
            getCurrentUserId: () => 'user',
            getJSON,
            getUrl: (path: string) => `http://localhost:8096/${path}`
        };
        const clientPromise = waitForCurrentPtvPluginApiClient({ timeoutMs: 1_000 });

        expect(getJSON).not.toHaveBeenCalled();
        (window as unknown as { ApiClient?: typeof lateClient }).ApiClient = lateClient;

        const pluginApi = await clientPromise;
        await pluginApi.getStatus({ bypassCache: true });

        expect(getJSON).toHaveBeenCalledTimes(1);
    });

    it('retires a pinned plugin root when the authenticated Jellyfin client changes', async () => {
        const firstGetJSON = vi.fn(async (url: string) => ({ url }));
        const nextGetJSON = vi.fn(async (url: string) => ({ url }));
        const makeClient = (root: string, getJSON: ReturnType<typeof vi.fn>) => ({
            accessToken: () => 'authenticated',
            getCurrentUserId: () => 'user',
            getJSON,
            getUrl: (path: string) => `${root}/${path}`
        });
        const firstClient = makeClient('https://old-media.example.test', firstGetJSON);
        const nextClient = makeClient('https://media.example.test', nextGetJSON);

        await getCurrentPtvPluginApiClient(firstClient)!.getStatus({ bypassCache: true });
        await getCurrentPtvPluginApiClient(nextClient)!.getStatus({ bypassCache: true });

        expect(firstGetJSON).toHaveBeenCalledWith('https://old-media.example.test/Ptv/v1/status', true);
        expect(nextGetJSON).toHaveBeenCalledWith('https://media.example.test/Ptv/v1/status', true);
        expect(getPtvPluginApiDiagnostics().resolvedRoot).toBe('https://media.example.test');
    });
});
