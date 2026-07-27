import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectionMocks = vi.hoisted(() => ({
    trigger: vi.fn()
}));

vi.mock('utils/events', () => ({
    default: {
        trigger: connectionMocks.trigger
    }
}));

vi.mock('utils/fetch', () => ({
    ajax: vi.fn()
}));

vi.mock('utils/string', () => ({
    equalsIgnoreCase: vi.fn((first: string, second: string) => (
        first.toLowerCase() === second.toLowerCase()
    ))
}));

vi.mock('jellyfin-apiclient', () => ({
    ApiClient: vi.fn()
}));

import ConnectionManager from './connectionManager';

type StoredServer = {
    AccessToken: string | null;
    ExchangeToken: string | null;
    Id: string;
    UserId: string | null;
    UserLinkType: string;
};

function createManager(server: StoredServer, remoteLogout: () => Promise<void>) {
    const credentialProvider = {
        credentials: vi.fn(() => ({
            Servers: [server]
        }))
    };
    const manager = new ConnectionManager(
        credentialProvider,
        'Jellyfin Web',
        'test',
        'Browser',
        'device',
        {}
    );
    const apiClient = {
        accessToken: vi.fn(() => server.AccessToken),
        logout: vi.fn(remoteLogout),
        serverInfo: vi.fn(() => ({ Id: server.Id }))
    };

    manager._apiClients.push(apiClient);

    return { apiClient, manager };
}

describe('Jellyfin ConnectionManager logout state and events', () => {
    beforeEach(() => {
        connectionMocks.trigger.mockReset();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    it('publishes localusersignedout and clears stored session credentials', async () => {
        const server = {
            AccessToken: 'access-token',
            ExchangeToken: 'exchange-token',
            Id: 'server-one',
            UserId: 'user-one',
            UserLinkType: 'LinkedUser'
        };
        const { apiClient, manager } = createManager(server, () => Promise.resolve());

        await manager.logout();

        expect(apiClient.logout).toHaveBeenCalledTimes(1);
        expect(connectionMocks.trigger).toHaveBeenCalledWith(
            manager,
            'localusersignedout',
            [{ serverId: 'server-one' }]
        );
        expect(server).toMatchObject({
            AccessToken: null,
            ExchangeToken: null,
            UserId: null
        });
    });

    it('retains Jellyfin fallback clearing and sign-out events when remote logout fails', async () => {
        const server = {
            AccessToken: 'access-token',
            ExchangeToken: 'exchange-token',
            Id: 'server-two',
            UserId: 'user-two',
            UserLinkType: 'LinkedUser'
        };
        const { manager } = createManager(
            server,
            () => Promise.reject(new Error('remote endpoint unavailable'))
        );

        await expect(manager.logout()).resolves.toBeUndefined();

        expect(connectionMocks.trigger).toHaveBeenCalledWith(
            manager,
            'localusersignedout',
            [{ serverId: 'server-two' }]
        );
        expect(server).toMatchObject({
            AccessToken: null,
            ExchangeToken: null,
            UserId: null
        });
    });
});
