import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connectionMocks = vi.hoisted(() => ({
    ajax: vi.fn(() => Promise.reject(new Error('fixture server unavailable'))),
    clientUrls: [] as string[],
    trigger: vi.fn()
}));

vi.mock('utils/events', () => ({
    default: { trigger: connectionMocks.trigger }
}));
vi.mock('utils/fetch', () => ({ ajax: connectionMocks.ajax }));
vi.mock('utils/string', () => ({
    equalsIgnoreCase: vi.fn((left: string, right: string) => (
        String(left || '').toLowerCase() === String(right || '').toLowerCase()
    ))
}));
vi.mock('jellyfin-apiclient', () => ({
    ApiClient: class {
        private readonly serverUrl: string;
        private server?: SavedServer;

        constructor(serverUrl: string) {
            connectionMocks.clientUrls.push(serverUrl);
            this.serverUrl = serverUrl;
        }

        serverAddress() { return this.serverUrl; }
        serverInfo(next?: SavedServer) {
            if (next) this.server = next;
            return this.server;
        }
    }
}));

import ConnectionManager from './connectionManager';

type SavedServer = {
    DateLastAccessed: number;
    Id: string;
    LocalAddress?: string;
    ManualAddress?: string;
    RemoteAddress?: string;
    LastConnectionMode?: number;
};

function createManager(servers: SavedServer[]) {
    let stored = { Servers: servers.map(server => ({ ...server })) };
    const credentialProvider = {
        addOrUpdateServer: vi.fn(),
        credentials: vi.fn((next?: typeof stored) => {
            if (next) stored = next;
            return stored;
        })
    };

    return new ConnectionManager(
        credentialProvider,
        'Jellyfin Web',
        'test',
        'Browser',
        'device',
        {}
    );
}

describe('Jellyfin-hosted connection origin', () => {
    beforeEach(() => {
        window.history.replaceState(null, '', '/web/index.html');
        connectionMocks.ajax.mockClear();
        connectionMocks.clientUrls.length = 0;
    });

    afterEach(() => {
        window.history.replaceState(null, '', '/');
    });

    it('selects the hosted server even when another saved server was used more recently', async () => {
        const hostedOrigin = window.location.origin;
        const otherOrigin = 'https://other-server.example.test';
        const manager = createManager([
            { DateLastAccessed: 200, Id: 'other', ManualAddress: otherOrigin },
            { DateLastAccessed: 100, Id: 'hosted', ManualAddress: hostedOrigin }
        ]);

        expect(manager.getSavedServers().map((server: SavedServer) => server.Id)).toEqual([ 'hosted' ]);
        expect(manager.getLastUsedServer()?.Id).toBe('hosted');
        await manager.connect();

        expect(connectionMocks.ajax).toHaveBeenCalledWith(expect.objectContaining({
            url: `${hostedOrigin}/System/Info/Public`
        }));
        expect(connectionMocks.ajax).not.toHaveBeenCalledWith(expect.objectContaining({
            url: `${otherOrigin}/System/Info/Public`
        }));
    });

    it('does not probe a remote address attached to the hosted saved server', async () => {
        const hostedOrigin = window.location.origin;
        const otherOrigin = 'https://other-server.example.test';
        const manager = createManager([{
            DateLastAccessed: 100,
            Id: 'hosted',
            LocalAddress: hostedOrigin,
            RemoteAddress: otherOrigin
        }]);

        await manager.connect();

        expect(connectionMocks.ajax).toHaveBeenCalledWith(expect.objectContaining({
            url: `${hostedOrigin}/System/Info/Public`
        }));
        expect(connectionMocks.ajax).not.toHaveBeenCalledWith(expect.objectContaining({
            url: `${otherOrigin}/System/Info/Public`
        }));
    });

    it('never initializes a client at a remote address from a mixed saved server', () => {
        const hostedRoot = window.location.origin;
        const otherOrigin = 'https://other-server.example.test';
        const manager = createManager([{
            DateLastAccessed: 100,
            Id: 'hosted',
            LastConnectionMode: 1,
            LocalAddress: hostedRoot,
            RemoteAddress: otherOrigin
        }]);

        const clients = manager.getApiClients();

        expect(connectionMocks.clientUrls).toEqual([ hostedRoot ]);
        expect(clients.map(client => client.serverAddress())).toEqual([ hostedRoot ]);
        expect(manager.getOrCreateApiClient('hosted').serverAddress()).toBe(hostedRoot);
    });

    it('does not reuse another Jellyfin BaseUrl on the same host', () => {
        window.history.replaceState(null, '', '/jellyfin/web/index.html');
        const hostedRoot = `${window.location.origin}/jellyfin`;
        const manager = createManager([{
            DateLastAccessed: 100,
            Id: 'wrong-base',
            ManualAddress: window.location.origin
        }, {
            DateLastAccessed: 90,
            Id: 'hosted',
            ManualAddress: hostedRoot
        }]);

        expect(manager.getSavedServers().map((server: SavedServer) => server.Id)).toEqual([ 'hosted' ]);
        expect(manager.getApiClients().map(client => client.serverAddress())).toEqual([ hostedRoot ]);
    });

    it('rejects a direct cross-origin connection before sending a request', async () => {
        const otherOrigin = 'https://other-server.example.test';
        const manager = createManager([]);

        await expect(manager.connectToAddress(otherOrigin)).resolves.toMatchObject({
            State: 'Unavailable'
        });
        expect(connectionMocks.ajax).not.toHaveBeenCalled();
    });

    it('keeps other saved credentials when the hosted client is first initialized', () => {
        const hostedOrigin = window.location.origin;
        const otherOrigin = 'https://other-server.example.test';
        const manager = createManager([{
            DateLastAccessed: 200,
            Id: 'other',
            ManualAddress: otherOrigin
        }]);
        let hostedServer = { Id: 'hosted', ManualAddress: hostedOrigin };
        const apiClient = {
            serverAddress: () => hostedOrigin,
            serverInfo: (next?: typeof hostedServer) => {
                if (next) hostedServer = next;
                return hostedServer;
            }
        };

        manager.addApiClient(apiClient);

        expect(manager.credentialProvider().credentials().Servers.map((server: SavedServer) => server.Id)).toEqual([
            'other', 'hosted'
        ]);
        expect(manager.getSavedServers().map((server: SavedServer) => server.Id)).toEqual([ 'hosted' ]);
    });
});
