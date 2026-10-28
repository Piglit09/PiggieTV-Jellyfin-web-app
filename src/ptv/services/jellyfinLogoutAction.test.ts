import { beforeEach, describe, expect, it, vi } from 'vitest';

const dashboardMocks = vi.hoisted(() => ({
    logout: vi.fn<() => Promise<void>>(),
    switchUser: vi.fn<() => Promise<void>>(),
    retireRecommendationDiagnosticScope: vi.fn(),
    retireMusicIdentity: vi.fn()
}));

vi.mock('../../utils/dashboard', () => ({
    default: {
        logout: dashboardMocks.logout
        ,
        switchUser: dashboardMocks.switchUser
    }
}));

vi.mock('../api', () => ({
    getPtvCurrentUserId: () => 'user-a',
    getPtvServerId: () => 'server-a'
}));

vi.mock('../modules/recommendations/engine/recommendationEngine', () => ({
    invalidatePtvRecommendationCache: vi.fn()
}));

vi.mock('../modules/recommendations/diagnostics/recommendationDiagnosticScope', () => ({
    retirePtvRecommendationDiagnosticScope: dashboardMocks.retireRecommendationDiagnosticScope
}));

vi.mock('../pages/home/hooks', () => ({
    retireNativeHomeIdentityState: vi.fn()
}));

vi.mock('../modules/cache/featuredContentCache', () => ({
    invalidateFeaturedContentMemoryCache: vi.fn()
}));

vi.mock('../modules/music/musicQueue', () => ({
    retirePtvMusicIdentityState: dashboardMocks.retireMusicIdentity
}));

import {
    isJellyfinLogoutInFlight,
    requestJellyfinLogout,
    requestJellyfinUserSwitch
} from './jellyfinLogoutAction';

function deferred<T>() {
    let reject!: (reason?: unknown) => void;
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, reject, resolve };
}

describe('PTV Jellyfin logout action adapter', () => {
    beforeEach(() => {
        dashboardMocks.logout.mockReset();
        dashboardMocks.switchUser.mockReset();
        dashboardMocks.retireRecommendationDiagnosticScope.mockReset();
        dashboardMocks.retireMusicIdentity.mockReset();
    });

    it('delegates to the stock Jellyfin logout action', async () => {
        dashboardMocks.logout.mockResolvedValue(undefined);

        await requestJellyfinLogout();

        expect(dashboardMocks.logout).toHaveBeenCalledTimes(1);
        expect(dashboardMocks.retireMusicIdentity).toHaveBeenCalledWith('logout');
        expect(isJellyfinLogoutInFlight()).toBe(false);
    });

    it('retires recommendation diagnostics before asynchronous logout or user switching settles', async () => {
        const pending = deferred<void>();
        dashboardMocks.logout.mockReturnValue(pending.promise);
        const logout = requestJellyfinLogout();
        const retiredBeforeLogoutSettled = dashboardMocks.retireRecommendationDiagnosticScope.mock.calls.length;
        pending.resolve();
        await logout;

        dashboardMocks.switchUser.mockResolvedValue(undefined);
        await requestJellyfinUserSwitch();
        expect(retiredBeforeLogoutSettled).toBe(1);
        expect(dashboardMocks.retireRecommendationDiagnosticScope).toHaveBeenCalledTimes(2);
    });

    it('switches users through the same Jellyfin logout owner and preserves the current server destination', async () => {
        dashboardMocks.switchUser.mockResolvedValue(undefined);

        await requestJellyfinUserSwitch();

        expect(dashboardMocks.switchUser).toHaveBeenCalledTimes(1);
        expect(dashboardMocks.logout).not.toHaveBeenCalled();
        expect(dashboardMocks.retireMusicIdentity).toHaveBeenCalledWith('logout');
        expect(isJellyfinLogoutInFlight()).toBe(false);
    });

    it('shares one in-flight logout across overlapping callers and input synthesis', async () => {
        const pending = deferred<void>();
        dashboardMocks.logout.mockReturnValue(pending.promise);

        const mouse = requestJellyfinLogout();
        const keyboardEnter = requestJellyfinLogout();
        const remoteOk = requestJellyfinLogout();
        const synthesizedPointerClick = requestJellyfinLogout();

        expect(keyboardEnter).toBe(mouse);
        expect(remoteOk).toBe(mouse);
        expect(synthesizedPointerClick).toBe(mouse);
        expect(dashboardMocks.logout).toHaveBeenCalledTimes(1);
        expect(isJellyfinLogoutInFlight()).toBe(true);

        pending.resolve();
        await mouse;

        expect(isJellyfinLogoutInFlight()).toBe(false);
    });

    it('allows a later logout after the prior request settles', async () => {
        dashboardMocks.logout.mockResolvedValue(undefined);

        await requestJellyfinLogout();
        await requestJellyfinLogout();

        expect(dashboardMocks.logout).toHaveBeenCalledTimes(2);
    });

    it('preserves rejection for callers while clearing the guard for recovery', async () => {
        dashboardMocks.logout
            .mockRejectedValueOnce(new Error('logout failed'))
            .mockResolvedValueOnce(undefined);

        await expect(requestJellyfinLogout()).rejects.toThrow('logout failed');
        expect(isJellyfinLogoutInFlight()).toBe(false);

        await expect(requestJellyfinLogout()).resolves.toBeUndefined();
        expect(dashboardMocks.logout).toHaveBeenCalledTimes(2);
    });
});
