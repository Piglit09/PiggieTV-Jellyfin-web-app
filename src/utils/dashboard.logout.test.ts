import { beforeEach, describe, expect, it, vi } from 'vitest';

const logoutMocks = vi.hoisted(() => ({
    clearQueryCache: vi.fn(),
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
vi.mock('../scripts/settings/webSettings', () => ({}));
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
    buildPtvServerOriginCandidates: vi.fn(() => []),
    getRequestedPtvServerId: vi.fn(() => ''),
    getRequestedPtvServerUrl: vi.fn(() => '')
}));
vi.mock('ptv/core/urlOrigins', () => ({
    isPtvWebpackDevServerOrigin: vi.fn(() => false)
}));

import { logout } from './dashboard';

function deferred<T>() {
    let reject!: (reason?: unknown) => void;
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, reject, resolve };
}

describe('stock Jellyfin Dashboard logout lifecycle', () => {
    beforeEach(() => {
        Object.values(logoutMocks).forEach(mock => {
            mock.mockReset();
        });
        logoutMocks.showRoute.mockResolvedValue(undefined);
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
