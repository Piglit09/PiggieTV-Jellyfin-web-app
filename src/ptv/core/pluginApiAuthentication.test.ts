import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectionMocks = vi.hoisted(() => ({
    client: null as null | {
        accessToken: () => string;
        ajax?: ReturnType<typeof vi.fn>;
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
        expect(diagnostics.attemptedResponses.slice(-3)).toEqual([
            expect.objectContaining({ endpoint: 'status', ok: true, status: 200, url: 'endpoint:status' }),
            expect.objectContaining({ endpoint: 'settings', ok: true, status: 200, url: 'endpoint:settings' }),
            expect.objectContaining({ endpoint: 'featuredContent', ok: true, status: 200, url: 'endpoint:featuredContent' })
        ]);
        expect(diagnostics.attemptedResponses.slice(-3).every(entry => entry.durationMs >= 0)).toBe(true);
    });

    it('posts public account and signup actions without waiting for Jellyfin authentication', async () => {
        const ajax = vi.fn(async (request: { url: string }) => ({
            ok: true,
            url: request.url
        }));
        const getJSON = vi.fn();

        connectionMocks.client = {
            accessToken: () => '',
            ajax,
            getCurrentUserId: () => '',
            getJSON,
            getUrl: path => `http://localhost:8096/${path}`
        };

        const authenticationWaitCountBefore = getPtvPluginApiDiagnostics().authenticationWaitCount;
        const pluginApi = getCurrentPtvPluginApiClient(connectionMocks.client)!;

        await expect(Promise.all([
            pluginApi.verifyAccountEmail({ request: 'account-verification' }),
            pluginApi.createSignupUser({ email: 'new-user@example.test' }),
            pluginApi.verifySignupEmail({ request: 'signup-verification' }),
            pluginApi.requestSignupPasswordReset({ email: 'new-user@example.test' }),
            pluginApi.confirmSignupPasswordReset({ request: 'password-reset-confirmation' })
        ])).resolves.toHaveLength(5);

        expect(ajax.mock.calls.map(([request]) => request.url)).toEqual([
            'http://localhost:8096/Ptv/v1/account/email/verify',
            'http://localhost:8096/Ptv/v1/signup/create-user',
            'http://localhost:8096/Ptv/v1/signup/verify-email',
            'http://localhost:8096/Ptv/v1/signup/password-reset/request',
            'http://localhost:8096/Ptv/v1/signup/password-reset/confirm'
        ]);
        expect(getJSON).not.toHaveBeenCalled();
        expect(getPtvPluginApiDiagnostics().authenticationWaitCount).toBe(authenticationWaitCountBefore);
    });

    it('keeps general and signup settings response caches isolated', async () => {
        const getJSON = vi.fn(async (url: string) => url.endsWith('/Ptv/v1/settings') ?
            { generalSetting: true } :
            { policyPresets: [{ id: 'standard' }] });

        connectionMocks.client = {
            accessToken: () => 'authenticated',
            getCurrentUserId: () => 'user',
            getJSON,
            getUrl: path => `http://localhost:8096/${path}`
        };

        const pluginApi = getCurrentPtvPluginApiClient(connectionMocks.client)!;
        const generalSettings = await pluginApi.getSettings<{ generalSetting: boolean }>();
        const signupSettings = await pluginApi.getSignupSettings<{ policyPresets: Array<{ id: string }> }>();

        expect(generalSettings.generalSetting).toBe(true);
        expect(signupSettings.policyPresets).toEqual([{ id: 'standard' }]);
        expect(getJSON).toHaveBeenCalledTimes(2);
    });

    it('keeps cached plugin reads isolated when the active Jellyfin server changes', async () => {
        const firstGetJSON = vi.fn(async () => ({ server: 'first' }));
        const nextGetJSON = vi.fn(async () => ({ server: 'next' }));
        const firstClient = {
            accessToken: () => 'authenticated',
            getCurrentUserId: () => 'user',
            getJSON: firstGetJSON,
            getUrl: (path: string) => `https://media.example.test/${path}`,
            serverId: () => 'server-a'
        };
        const nextClient = {
            accessToken: () => 'authenticated',
            getCurrentUserId: () => 'user',
            getJSON: nextGetJSON,
            getUrl: (path: string) => `https://media.example.test/${path}`,
            serverId: () => 'server-b'
        };

        connectionMocks.client = firstClient;
        const firstSettings = await getCurrentPtvPluginApiClient(firstClient)!.getSettings();

        connectionMocks.client = nextClient;
        const nextSettings = await getCurrentPtvPluginApiClient(nextClient)!.getSettings();

        expect(firstSettings).toEqual({ server: 'first' });
        expect(nextSettings).toEqual({ server: 'next' });
        expect(firstGetJSON).toHaveBeenCalledOnce();
        expect(nextGetJSON).toHaveBeenCalledOnce();
    });

    it('does not deduplicate concurrent plugin reads across Jellyfin servers', async () => {
        let resolveFirst: ((value: unknown) => void) | undefined;
        let resolveNext: ((value: unknown) => void) | undefined;
        const firstGetJSON = vi.fn(() => new Promise(resolve => {
            resolveFirst = resolve;
        }));
        const nextGetJSON = vi.fn(() => new Promise(resolve => {
            resolveNext = resolve;
        }));
        const firstClient = {
            accessToken: () => 'authenticated',
            getCurrentUserId: () => 'user',
            getJSON: firstGetJSON,
            getUrl: (path: string) => `https://media.example.test/${path}`,
            serverId: () => 'server-a'
        };
        const nextClient = {
            accessToken: () => 'authenticated',
            getCurrentUserId: () => 'user',
            getJSON: nextGetJSON,
            getUrl: (path: string) => `https://media.example.test/${path}`,
            serverId: () => 'server-b'
        };

        connectionMocks.client = firstClient;
        const firstSettings = getCurrentPtvPluginApiClient(firstClient)!.getSettings();

        connectionMocks.client = nextClient;
        const nextSettings = getCurrentPtvPluginApiClient(nextClient)!.getSettings();

        expect(firstGetJSON).toHaveBeenCalledOnce();
        expect(nextGetJSON).toHaveBeenCalledOnce();

        resolveFirst?.({ server: 'first' });
        resolveNext?.({ server: 'next' });

        await expect(firstSettings).resolves.toEqual({ server: 'first' });
        await expect(nextSettings).resolves.toEqual({ server: 'next' });
    });

    it('loads administrator profile summaries from the dedicated batch route', async () => {
        const getJSON = vi.fn(async () => ({ ok: true, users: [] }));

        connectionMocks.client = {
            accessToken: () => 'authenticated',
            getCurrentUserId: () => 'admin-user',
            getJSON,
            getUrl: path => `http://localhost:8096/${path}`
        };

        const pluginApi = getCurrentPtvPluginApiClient(connectionMocks.client)!;

        await expect(pluginApi.getAccountAdminUsers()).resolves.toEqual({ ok: true, users: [] });
        expect(getJSON).toHaveBeenCalledWith(
            'http://localhost:8096/Ptv/v1/account/admin/users',
            true
        );
    });

    it('deduplicates only identical settings routes while both are in flight', async () => {
        const pendingRequests = new Map<string, (value: unknown) => void>();
        const getJSON = vi.fn((url: string) => new Promise(resolve => pendingRequests.set(url, resolve)));

        connectionMocks.client = {
            accessToken: () => 'authenticated',
            getCurrentUserId: () => 'user',
            getJSON,
            getUrl: path => `http://localhost:8096/${path}`
        };

        const pluginApi = getCurrentPtvPluginApiClient(connectionMocks.client)!;
        const generalSettings = pluginApi.getSettings();
        const firstSignupSettings = pluginApi.getSignupSettings();
        const secondSignupSettings = pluginApi.getSignupSettings();

        await Promise.resolve();
        expect(getJSON).toHaveBeenCalledTimes(2);

        pendingRequests.get('http://localhost:8096/Ptv/v1/settings')?.({ generalSetting: true });
        pendingRequests.get('http://localhost:8096/Ptv/v1/signup/admin/settings')?.({ policyPresets: [] });

        await expect(generalSettings).resolves.toEqual({ generalSetting: true });
        await expect(firstSignupSettings).resolves.toEqual({ policyPresets: [] });
        await expect(secondSignupSettings).resolves.toEqual({ policyPresets: [] });
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

    it('exports relationship diagnostics as categories without origins or item identities', async () => {
        const privateOrigin = 'https://private-media.example.test';
        const sourceItemId = 'source-item-private';
        const targetItemId = 'target-item-private';
        const getJSON = vi.fn(async () => ({
            relationships: [{ targetItemId }],
            schemaVersion: 1
        }));
        const client = {
            accessToken: () => 'authenticated',
            getCurrentUserId: () => 'user',
            getJSON,
            getUrl: (path: string) => `${privateOrigin}/${path}`
        };

        await getCurrentPtvPluginApiClient(client)!.getItemRelationships(sourceItemId, { bypassCache: true });

        const serializedDiagnostics = JSON.stringify(getPtvPluginApiDiagnostics());

        expect(getJSON).toHaveBeenCalledWith(
            `${privateOrigin}/Ptv/v1/relationships/${sourceItemId}`,
            true
        );
        expect(serializedDiagnostics).toContain('endpoint:relationships');
        expect(serializedDiagnostics).not.toContain(privateOrigin);
        expect(serializedDiagnostics).not.toContain(sourceItemId);
        expect(serializedDiagnostics).not.toContain(targetItemId);
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
        expect(getPtvPluginApiDiagnostics().resolvedRoot).toBe('state:resolved');
    });
});
