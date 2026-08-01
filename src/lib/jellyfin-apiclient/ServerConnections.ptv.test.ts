import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Events from 'utils/events';

vi.mock('jellyfin-apiclient', () => ({
    ApiClient: class {},
    Credentials: class {
        credentials(value?: unknown) {
            return value || { Servers: [] };
        }
    }
}));

vi.mock('components/apphost', () => ({
    appHost: {
        appName: () => 'test',
        appVersion: () => 'test',
        deviceId: () => 'test',
        deviceName: () => 'test'
    }
}));

vi.mock('scripts/settings/appSettings', () => ({
    default: { enableAutoLogin: () => true }
}));

vi.mock('scripts/settings/userSettings', () => ({
    setUserInfo: vi.fn(() => Promise.resolve())
}));

vi.mock('utils/dashboard', () => ({
    default: { capabilities: () => ({}) }
}));

vi.mock('utils/jellyfin-apiclient/compat', () => ({
    toApi: vi.fn()
}));

vi.mock('./connectionManager', () => ({
    default: class {
        _apiClients: unknown[] = [];
        logoutCalls = 0;

        addApiClient(apiClient: unknown) {
            this._apiClients.push(apiClient);
        }

        connect(options: unknown) {
            return Promise.resolve(options);
        }

        getApiClient() {
            return this._apiClients[0];
        }

        getApiClients() {
            return this._apiClients;
        }

        getLastUsedServer() {
            return null;
        }

        logout() {
            this.logoutCalls += 1;
            return Promise.resolve();
        }
    }
}));

import { ServerConnections } from './ServerConnections';

function createApiClient() {
    let socketActive = true;
    let authenticated = true;

    return {
        accessToken: vi.fn(() => authenticated ? 'present' : null),
        closeWebSocket: vi.fn(),
        ensureWebSocket: vi.fn(),
        isWebSocketOpenOrConnecting: vi.fn(() => socketActive),
        setAuthenticated(value: boolean) {
            authenticated = value;
        },
        setSocketActive(value: boolean) {
            socketActive = value;
        }
    };
}

describe('ServerConnections WebSocket recovery ownership', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        Reflect.deleteProperty(window, 'ApiClient');
    });

    it('owns one bounded reconnect timer and resets it after recovery', async () => {
        const connections = new ServerConnections() as ServerConnections & { logoutCalls: number };
        const apiClient = createApiClient();

        connections.setLocalApiClient(apiClient);
        apiClient.setSocketActive(false);
        Events.trigger(apiClient, 'websocketclose');
        Events.trigger(apiClient, 'websocketclose');

        expect(connections.getWebSocketReconnectSnapshot()).toEqual({
            attempt: 1,
            timerCount: 1
        });

        await vi.advanceTimersByTimeAsync(999);
        expect(apiClient.ensureWebSocket).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(apiClient.ensureWebSocket).toHaveBeenCalledTimes(1);

        apiClient.setSocketActive(true);
        Events.trigger(apiClient, 'websocketopen');

        expect(connections.getWebSocketReconnectSnapshot()).toEqual({
            attempt: 0,
            timerCount: 0
        });
    });

    it('cancels recovery before logout or client replacement', async () => {
        const connections = new ServerConnections() as ServerConnections & { logoutCalls: number };
        const firstClient = createApiClient();
        const replacementClient = createApiClient();

        connections.setLocalApiClient(firstClient);
        firstClient.setSocketActive(false);
        Events.trigger(firstClient, 'websocketclose');

        connections.setLocalApiClient(replacementClient);
        expect(firstClient.closeWebSocket).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(30000);
        expect(firstClient.ensureWebSocket).not.toHaveBeenCalled();

        replacementClient.setSocketActive(false);
        Events.trigger(replacementClient, 'websocketclose');
        await connections.logout();

        expect(connections.logoutCalls).toBe(1);
        expect(connections.getWebSocketReconnectSnapshot()).toEqual({
            attempt: 0,
            timerCount: 0
        });

        await vi.advanceTimersByTimeAsync(30000);
        expect(replacementClient.ensureWebSocket).not.toHaveBeenCalled();
    });

    it('does not recover a retired or unauthenticated client', async () => {
        const connections = new ServerConnections();
        const apiClient = createApiClient();

        connections.setLocalApiClient(apiClient);
        apiClient.setAuthenticated(false);
        apiClient.setSocketActive(false);
        Events.trigger(apiClient, 'websocketclose');

        expect(connections.getWebSocketReconnectSnapshot()).toEqual({
            attempt: 0,
            timerCount: 0
        });

        await vi.advanceTimersByTimeAsync(30000);
        expect(apiClient.ensureWebSocket).not.toHaveBeenCalled();
    });
});
