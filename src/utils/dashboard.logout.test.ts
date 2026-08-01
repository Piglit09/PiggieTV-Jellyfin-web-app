import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logoutMocks = vi.hoisted(() => ({
    buildServerCandidates: vi.fn(),
    clearQueryCache: vi.fn(),
    currentApiClient: vi.fn(),
    getLastUsedServer: vi.fn(),
    getServerInfo: vi.fn(),
    getServers: vi.fn(),
    logout: vi.fn<() => Promise<void>>(),
    resetViews: vi.fn(),
    showRoute: vi.fn(),
    supports: vi.fn()
}));

vi.mock('components/apphost', () => ({
    appHost: {
        supports: logoutMocks.supports
    }
}));

vi.mock('components/viewContainer', () => ({
    default: {
        reset: logoutMocks.resetViews
    }
}));

vi.mock('constants/appFeature', () => ({
    AppFeature: {
        MultiServer: 'MultiServer'
    }
}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: logoutMocks.currentApiClient,
        getLastUsedServer: logoutMocks.getLastUsedServer,
        getServerInfo: logoutMocks.getServerInfo,
        logout: logoutMocks.logout
    }
}));

vi.mock('../components/toast/toast', () => ({ default: vi.fn() }));
vi.mock('../components/loading/loading', () => ({ default: {} }));
vi.mock('../components/router/appRouter', () => ({
    appRouter: {
        show: logoutMocks.showRoute
    }
}));
vi.mock('../components/alert', () => ({ default: vi.fn() }));
vi.mock('../components/confirm/confirm', () => ({ default: vi.fn() }));
vi.mock('../lib/globalize', () => ({ default: {} }));
vi.mock('../scripts/settings/webSettings', () => ({
    getServers: logoutMocks.getServers
}));
vi.mock('../scripts/datetime', () => ({ default: {} }));
vi.mock('../components/backdrop/backdrop', () => ({ setBackdropTransparency: vi.fn() }));
vi.mock('../components/directorybrowser/directorybrowser', () => ({ default: {} }));
vi.mock('../components/dialogHelper/dialogHelper', () => ({ default: {} }));
vi.mock('../components/itemidentifier/itemidentifier', () => ({ default: {} }));
vi.mock('./url.ts', () => ({ getLocationSearch: vi.fn(() => '') }));
vi.mock('./query/queryClient', () => ({
    queryClient: {
        clear: logoutMocks.clearQueryCache
    }
}));
vi.mock('ptv/core/config', () => ({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    PTV_CONFIG: {
        runtime: {
            devJellyfinServerUrl: '',
            mode: 'production'
        }
    }
}));
vi.mock('ptv/core/serverOriginSelection', () => ({
    buildPtvServerOriginCandidates: logoutMocks.buildServerCandidates,
    getRequestedPtvServerId: vi.fn(() => ''),
    getRequestedPtvServerUrl: vi.fn(() => '')
}));
vi.mock('ptv/core/urlOrigins', () => ({
    isPtvWebpackDevServerOrigin: vi.fn(() => false)
}));

import { logout, serverAddress } from './dashboard';

function deferred<T>() {
    let reject!: (reason?: unknown) => void;
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, reject, resolve };
}

describe('stock Jellyfin Dashboard lifecycle', () => {
    beforeEach(() => {
        Object.values(logoutMocks).forEach(mock => {
            mock.mockReset();
        });
        logoutMocks.buildServerCandidates.mockReturnValue([]);
        logoutMocks.currentApiClient.mockReturnValue(undefined);
        logoutMocks.getLastUsedServer.mockReturnValue(null);
        logoutMocks.getServerInfo.mockReturnValue(undefined);
        logoutMocks.getServers.mockResolvedValue([]);
        logoutMocks.showRoute.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('continues server discovery when stale restored state cannot create a current API client', async () => {
        const fallbackApiClient = {};
        const staleServer = {
            ManualAddress: 'https://media.example.test'
        };
        const fetchMock = vi.fn().mockResolvedValue({
            json: vi.fn().mockResolvedValue({
                ProductName: 'Jellyfin'
            }),
            ok: true
        });

        vi.stubGlobal('ApiClient', fallbackApiClient);
        vi.stubGlobal('fetch', fetchMock);
        logoutMocks.currentApiClient.mockImplementation(() => {
            throw new Error('item or serverId cannot be null');
        });
        logoutMocks.getLastUsedServer.mockReturnValue(staleServer);
        logoutMocks.buildServerCandidates.mockReturnValue([ 'https://media.example.test' ]);

        await expect(serverAddress()).resolves.toBe('https://media.example.test');

        expect(logoutMocks.buildServerCandidates).toHaveBeenCalledWith(expect.objectContaining({
            apiClient: fallbackApiClient,
            fallbackServer: staleServer
        }));
        expect(fetchMock).toHaveBeenCalledWith(
            'https://media.example.test/System/Info/Public',
            { cache: 'no-cache' }
        );
    });

    it('returns the authoritative asynchronous logout and routes multi-server clients to Select Server', async () => {
        const pending = deferred<void>();
        logoutMocks.logout.mockReturnValue(pending.promise);
        logoutMocks.supports.mockReturnValue(true);

        const result = logout();

        expect(logoutMocks.logout).toHaveBeenCalledTimes(1);
        expect(logoutMocks.clearQueryCache).not.toHaveBeenCalled();
        expect(logoutMocks.resetViews).not.toHaveBeenCalled();

        pending.resolve();
        await result;

        expect(logoutMocks.clearQueryCache).toHaveBeenCalledTimes(1);
        expect(logoutMocks.resetViews).toHaveBeenCalledTimes(1);
        expect(logoutMocks.showRoute).toHaveBeenCalledWith('selectserver');
    });

    it('retains the stock single-server Login destination', async () => {
        logoutMocks.logout.mockResolvedValue(undefined);
        logoutMocks.supports.mockReturnValue(false);

        await logout();

        expect(logoutMocks.showRoute).toHaveBeenCalledWith('login');
    });

    it('preserves a failed Jellyfin logout without clearing views or forcing a route', async () => {
        logoutMocks.logout.mockRejectedValue(new Error('server logout failed'));

        await expect(logout()).rejects.toThrow('server logout failed');

        expect(logoutMocks.clearQueryCache).not.toHaveBeenCalled();
        expect(logoutMocks.resetViews).not.toHaveBeenCalled();
        expect(logoutMocks.showRoute).not.toHaveBeenCalled();
    });
});
