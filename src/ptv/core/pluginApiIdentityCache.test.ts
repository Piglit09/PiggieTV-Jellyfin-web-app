import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestClient = {
    accessToken: () => string;
    getCurrentUserId: () => string;
    getJSON: ReturnType<typeof vi.fn>;
    getUrl: (path: string) => string;
    serverId?: () => string;
    serverInfo?: () => { Id?: string };
};

const connectionMocks = vi.hoisted(() => ({
    client: null as TestClient | null
}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: () => connectionMocks.client
    }
}));

import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from '../../utils/events';
import { getCurrentPtvPluginApiClient, resetPtvPluginApiAvailability } from './pluginApi';

function createClient(serverId: string, userId: string, getJSON: TestClient['getJSON']): TestClient {
    return {
        accessToken: () => 'authenticated',
        getCurrentUserId: () => userId,
        getJSON,
        getUrl: path => `https://media.example.test/${path}`,
        serverId: () => serverId,
        serverInfo: () => ({ Id: serverId })
    };
}

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });

    return { promise, resolve };
}

describe('Plugin authenticated response cache identity', () => {
    beforeEach(() => {
        connectionMocks.client = null;
        (window as unknown as { ApiClient?: unknown }).ApiClient = undefined;
        window.localStorage.clear();
        resetPtvPluginApiAvailability();
    });

    it('isolates cached Featured payloads between administrator and restricted users in both directions', async () => {
        const adminTransport = vi.fn(async () => ({ payload: 'admin-only' }));
        const restrictedTransport = vi.fn(async () => ({ payload: 'restricted-only' }));
        const adminClient = createClient('server-a', 'admin', adminTransport);
        const restrictedClient = createClient('server-a', 'restricted', restrictedTransport);

        connectionMocks.client = adminClient;
        await expect(getCurrentPtvPluginApiClient(adminClient)!.getFeaturedContentCacheDocument())
            .resolves.toEqual({ payload: 'admin-only' });
        connectionMocks.client = restrictedClient;
        await expect(getCurrentPtvPluginApiClient(restrictedClient)!.getFeaturedContentCacheDocument())
            .resolves.toEqual({ payload: 'restricted-only' });
        connectionMocks.client = adminClient;
        await expect(getCurrentPtvPluginApiClient(adminClient)!.getFeaturedContentCacheDocument())
            .resolves.toEqual({ payload: 'admin-only' });

        expect(adminTransport).toHaveBeenCalledOnce();
        expect(restrictedTransport).toHaveBeenCalledOnce();
    });

    it('isolates the same user identifier across servers', async () => {
        const serverATransport = vi.fn(async () => ({ payload: 'server-a' }));
        const serverBTransport = vi.fn(async () => ({ payload: 'server-b' }));
        const serverAClient = createClient('server-a', 'same-user', serverATransport);
        const serverBClient = createClient('server-b', 'same-user', serverBTransport);

        connectionMocks.client = serverAClient;
        await expect(getCurrentPtvPluginApiClient(serverAClient)!.getFeaturedContentCacheDocument())
            .resolves.toEqual({ payload: 'server-a' });
        connectionMocks.client = serverBClient;
        await expect(getCurrentPtvPluginApiClient(serverBClient)!.getFeaturedContentCacheDocument())
            .resolves.toEqual({ payload: 'server-b' });

        expect(serverATransport).toHaveBeenCalledOnce();
        expect(serverBTransport).toHaveBeenCalledOnce();
    });

    it('never falls an authenticated Featured read through to another server root', async () => {
        const transport = vi.fn(async (url: string) => {
            if (url.startsWith('https://server-b.example.test/')) {
                throw Object.assign(new Error('Plugin endpoint not found.'), { status: 404 });
            }

            return { payload: 'server-a-unauthorized-fallback' };
        });
        const serverBClient = createClient('server-b', 'user', transport);

        serverBClient.getUrl = path => `https://server-b.example.test/${path}`;
        connectionMocks.client = serverBClient;

        await expect(getCurrentPtvPluginApiClient(serverBClient)!.getFeaturedContentCacheDocument())
            .rejects.toMatchObject({ status: 404 });
        expect(transport).toHaveBeenCalled();
        expect(transport.mock.calls.every(([url]) => String(url).startsWith('https://server-b.example.test/')))
            .toBe(true);
    });

    it('coalesces same-identity concurrent Featured reads', async () => {
        const adminResponse = deferred<unknown>();
        const adminTransport = vi.fn(() => adminResponse.promise);
        const adminClient = createClient('server-a', 'admin', adminTransport);

        connectionMocks.client = adminClient;
        const firstAdmin = getCurrentPtvPluginApiClient(adminClient)!.getFeaturedContentCacheDocument();
        const secondAdmin = getCurrentPtvPluginApiClient(adminClient)!.getFeaturedContentCacheDocument();
        expect(adminTransport).toHaveBeenCalledOnce();

        adminResponse.resolve({ payload: 'admin' });
        await expect(Promise.all([ firstAdmin, secondAdmin ])).resolves.toEqual([
            { payload: 'admin' },
            { payload: 'admin' }
        ]);
    });

    it('prevents a late prior-user response from publishing into the current identity cache', async () => {
        const adminResponse = deferred<unknown>();
        const adminTransport = vi.fn(() => adminResponse.promise);
        const restrictedTransport = vi.fn(async () => ({ payload: 'restricted-current' }));
        const adminClient = createClient('server-a', 'admin', adminTransport);
        const restrictedClient = createClient('server-a', 'restricted', restrictedTransport);

        connectionMocks.client = adminClient;
        const adminRequest = getCurrentPtvPluginApiClient(adminClient)!.getFeaturedContentCacheDocument();
        connectionMocks.client = restrictedClient;
        await expect(getCurrentPtvPluginApiClient(restrictedClient)!.getFeaturedContentCacheDocument())
            .resolves.toEqual({ payload: 'restricted-current' });

        adminResponse.resolve({ payload: 'admin-late' });
        await expect(adminRequest).rejects.toMatchObject({
            code: 'PTV_PLUGIN_REQUEST_IDENTITY_RETIRED',
            name: 'AbortError'
        });
        await expect(getCurrentPtvPluginApiClient(restrictedClient)!.getFeaturedContentCacheDocument())
            .resolves.toEqual({ payload: 'restricted-current' });

        connectionMocks.client = adminClient;
        await expect(getCurrentPtvPluginApiClient(adminClient)!.getFeaturedContentCacheDocument())
            .resolves.toEqual({ payload: 'admin-late' });
        expect(adminTransport).toHaveBeenCalledTimes(2);
        expect(restrictedTransport).toHaveBeenCalledOnce();
    });

    it('rejects a queued cached response when its user retires before publication', async () => {
        const adminTransport = vi.fn(async () => ({ payload: 'admin-cached' }));
        const restrictedTransport = vi.fn(async () => ({ payload: 'restricted-current' }));
        const adminClient = createClient('server-a', 'admin', adminTransport);
        const restrictedClient = createClient('server-a', 'restricted', restrictedTransport);

        connectionMocks.client = adminClient;
        const pluginApi = getCurrentPtvPluginApiClient(adminClient)!;

        await pluginApi.getFeaturedContentCacheDocument();
        const queuedAdminCacheHit = pluginApi.getFeaturedContentCacheDocument();

        connectionMocks.client = restrictedClient;

        await expect(queuedAdminCacheHit).rejects.toMatchObject({
            code: 'PTV_PLUGIN_REQUEST_IDENTITY_RETIRED',
            name: 'AbortError'
        });
        await expect(getCurrentPtvPluginApiClient(restrictedClient)!.getFeaturedContentCacheDocument())
            .resolves.toEqual({ payload: 'restricted-current' });
    });

    it('rejects a delayed authenticated response after logout even while a stale client remains addressable', async () => {
        const response = deferred<unknown>();
        const transport = vi.fn(() => response.promise);
        const client = createClient('server-a', 'admin', transport);

        connectionMocks.client = client;
        const request = getCurrentPtvPluginApiClient(client)!.getFeaturedContentCacheDocument();

        Events.trigger(ServerConnections, 'localusersignedout');
        response.resolve({ payload: 'logged-out-user' });

        await expect(request).rejects.toMatchObject({
            code: 'PTV_PLUGIN_REQUEST_IDENTITY_RETIRED',
            name: 'AbortError'
        });
        connectionMocks.client = null;
    });

    it('retires cached transport responses on logout before another login', async () => {
        const firstTransport = vi.fn(async () => ({ payload: 'first-session' }));
        const nextTransport = vi.fn(async () => ({ payload: 'next-session' }));
        const firstClient = createClient('server-a', 'first-user', firstTransport);
        const nextClient = createClient('server-a', 'next-user', nextTransport);

        connectionMocks.client = firstClient;
        await getCurrentPtvPluginApiClient(firstClient)!.getFeaturedContentCacheDocument();
        Events.trigger(ServerConnections, 'localusersignedout');
        connectionMocks.client = nextClient;
        Events.trigger(ServerConnections, 'localusersignedin');
        await expect(getCurrentPtvPluginApiClient(nextClient)!.getFeaturedContentCacheDocument())
            .resolves.toEqual({ payload: 'next-session' });

        expect(firstTransport).toHaveBeenCalledOnce();
        expect(nextTransport).toHaveBeenCalledOnce();
    });

    it('does not cache or coalesce authenticated requests with a missing or conflicting server identity', async () => {
        const missingTransport = vi.fn()
            .mockResolvedValueOnce({ generation: 1 })
            .mockResolvedValueOnce({ generation: 2 });
        const missingClient = createClient('', 'user', missingTransport);

        missingClient.serverId = () => '';
        missingClient.serverInfo = () => ({ Id: '' });
        connectionMocks.client = missingClient;

        const first = getCurrentPtvPluginApiClient(missingClient)!.getFeaturedContentCacheDocument();
        const second = getCurrentPtvPluginApiClient(missingClient)!.getFeaturedContentCacheDocument();

        await expect(first).resolves.toEqual({ generation: 1 });
        await expect(second).resolves.toEqual({ generation: 2 });
        expect(missingTransport).toHaveBeenCalledTimes(2);

        const conflictingTransport = vi.fn()
            .mockResolvedValueOnce({ generation: 3 })
            .mockResolvedValueOnce({ generation: 4 });
        const conflictingClient = createClient('server-a', 'user', conflictingTransport);

        conflictingClient.serverInfo = () => ({ Id: 'server-b' });
        connectionMocks.client = conflictingClient;

        await expect(Promise.all([
            getCurrentPtvPluginApiClient(conflictingClient)!.getFeaturedContentCacheDocument(),
            getCurrentPtvPluginApiClient(conflictingClient)!.getFeaturedContentCacheDocument()
        ])).resolves.toEqual([{ generation: 3 }, { generation: 4 }]);
        expect(conflictingTransport).toHaveBeenCalledTimes(2);
    });

    it('bounds retained authenticated response identities', async () => {
        const transports: Array<ReturnType<typeof vi.fn>> = [];

        for (let index = 0; index < 65; index += 1) {
            const transport = vi.fn(async () => ({ identity: index }));
            const client = createClient('server-a', `user-${index}`, transport);

            transports.push(transport);
            connectionMocks.client = client;
            await getCurrentPtvPluginApiClient(client)!.getFeaturedContentCacheDocument();
        }

        const firstClient = createClient('server-a', 'user-0', transports[0]);

        connectionMocks.client = firstClient;
        await getCurrentPtvPluginApiClient(firstClient)!.getFeaturedContentCacheDocument();
        expect(transports[0]).toHaveBeenCalledTimes(2);
    });
});
