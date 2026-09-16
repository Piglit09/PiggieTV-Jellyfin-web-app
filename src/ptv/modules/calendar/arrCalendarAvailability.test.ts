import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/naming-convention
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const availabilityMocks = vi.hoisted(() => ({
    getArrCalendarAvailability: vi.fn(),
    serverId: 'server-a',
    userId: 'user-a'
}));

vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: () => ({
        getCurrentServerId: () => availabilityMocks.serverId,
        getCurrentUserId: () => availabilityMocks.userId,
        getArrCalendarAvailability: availabilityMocks.getArrCalendarAvailability
    }),
    normalizePtvApiError: (error: unknown) => ({
        message: error instanceof Error ? error.message : 'Integration status failed.'
    })
}));

import {
    getPtvArrCalendarAvailabilitySnapshot,
    invalidatePtvArrCalendarAvailability,
    normalizePtvArrCalendarAvailability,
    refreshPtvArrCalendarAvailability,
    resetPtvArrCalendarAvailabilityForTests,
    subscribePtvArrCalendarAvailability,
    usePtvArrCalendarAvailability
} from './arrCalendarAvailability';

const CALENDAR_CAPABILITY = {
    available: true,
    canonicalRoute: '/Ptv/v1/calendar',
    compatibilityRoute: '/Ptv/v1/integrations/arr/calendar'
};

function configuredService(enabled = true) {
    return {
        configured: true,
        enabled,
        supported: true
    };
}

function service(serviceName: 'lidarr' | 'radarr' | 'sonarr', overrides = {}) {
    return { service: serviceName, ...configuredService(), ...overrides };
}

function AvailabilityHarness() {
    usePtvArrCalendarAvailability();
    return null;
}

describe('Servarr Calendar availability', () => {
    beforeEach(() => {
        resetPtvArrCalendarAvailabilityForTests();
        availabilityMocks.getArrCalendarAvailability.mockReset();
        availabilityMocks.serverId = 'server-a';
        availabilityMocks.userId = 'user-a';
    });

    it.each(['sonarr', 'radarr', 'lidarr'] as const)(
        'shows the Calendar entry for saved, enabled %s configuration and advertised capability',
        serviceName => {
            const snapshot = normalizePtvArrCalendarAvailability('server:user', {
                capability: CALENDAR_CAPABILITY,
                services: [service(serviceName)],
                ok: true
            });

            expect(snapshot).toMatchObject({
                capabilityAvailable: true,
                configuredServices: [serviceName],
                showEntry: true,
                status: 'available'
            });
        }
    );

    it('keeps the feature available when one supported service is configured and another is not', () => {
        const snapshot = normalizePtvArrCalendarAvailability('server:user', {
            capability: CALENDAR_CAPABILITY,
            services: [service('radarr'), service('sonarr', { configured: false })],
            ok: true
        });

        expect(snapshot.configuredServices).toEqual(['radarr']);
        expect(snapshot.showEntry).toBe(true);
    });

    it('does not show the feature when nothing is configured or a configured service is disabled', () => {
        expect(normalizePtvArrCalendarAvailability('server:user', {
            capability: CALENDAR_CAPABILITY,
            services: [service('sonarr', { enabled: false })],
            ok: true
        })).toMatchObject({ showEntry: false, status: 'not-configured' });
    });

    it('requires the Plugin to advertise the authoritative Calendar route', () => {
        expect(normalizePtvArrCalendarAvailability('server:user', {
            capability: { available: false },
            services: [service('sonarr')],
            ok: true
        })).toMatchObject({
            capabilityAvailable: false,
            configuredServices: ['sonarr'],
            showEntry: false,
            status: 'unsupported'
        });
    });

    it('never projects a returned credential into the availability snapshot', () => {
        const credentialCanary = 'PTV_CALENDAR_PRIVATE_CREDENTIAL';
        const snapshot = normalizePtvArrCalendarAvailability('server:user', {
            capability: CALENDAR_CAPABILITY,
            services: [{ ...service('sonarr'), apiKey: credentialCanary }],
            ok: true
        } as never);

        expect(JSON.stringify(snapshot)).not.toContain(credentialCanary);
    });

    it('deduplicates concurrent status reads for the same server and user', async () => {
        let resolveStatus: ((value: unknown) => void) | undefined;
        availabilityMocks.getArrCalendarAvailability.mockReturnValue(new Promise(resolve => {
            resolveStatus = resolve;
        }));

        const first = refreshPtvArrCalendarAvailability();
        const second = refreshPtvArrCalendarAvailability();

        expect(availabilityMocks.getArrCalendarAvailability).toHaveBeenCalledTimes(1);
        resolveStatus?.({ capability: CALENDAR_CAPABILITY, services: [service('sonarr')], ok: true });

        await expect(Promise.all([first, second])).resolves.toEqual([
            expect.objectContaining({ showEntry: true }),
            expect.objectContaining({ showEntry: true })
        ]);
    });

    it('publishes a saved configuration change without a page reload', async () => {
        availabilityMocks.getArrCalendarAvailability
            .mockResolvedValueOnce({ capability: CALENDAR_CAPABILITY, services: [], ok: true })
            .mockResolvedValueOnce({ capability: CALENDAR_CAPABILITY, services: [service('radarr')], ok: true });
        const listener = vi.fn();
        const unsubscribe = subscribePtvArrCalendarAvailability('server-a:user-a', listener);

        await refreshPtvArrCalendarAvailability();
        expect(getPtvArrCalendarAvailabilitySnapshot()).toMatchObject({ showEntry: false, status: 'not-configured' });

        await invalidatePtvArrCalendarAvailability();
        expect(getPtvArrCalendarAvailabilitySnapshot()).toMatchObject({
            configuredServices: ['radarr'],
            showEntry: true,
            status: 'available'
        });
        expect(listener).toHaveBeenCalled();
        unsubscribe();
    });

    it('retains a previously verified entry while reporting a terminal refresh error', async () => {
        availabilityMocks.getArrCalendarAvailability
            .mockResolvedValueOnce({ capability: CALENDAR_CAPABILITY, services: [service('sonarr')], ok: true })
            .mockRejectedValueOnce(new Error('Plugin unavailable'));

        await refreshPtvArrCalendarAvailability();
        await invalidatePtvArrCalendarAvailability();

        expect(getPtvArrCalendarAvailabilitySnapshot()).toMatchObject({
            error: 'Plugin unavailable',
            showEntry: true,
            status: 'error'
        });
    });

    it('retries a first transient failure while subscribed and recovers without a reload', async () => {
        vi.useFakeTimers();
        availabilityMocks.getArrCalendarAvailability
            .mockRejectedValueOnce(new Error('Plugin unavailable'))
            .mockResolvedValueOnce({ capability: CALENDAR_CAPABILITY, services: [service('sonarr')], ok: true });
        const unsubscribe = subscribePtvArrCalendarAvailability('server-a:user-a', vi.fn());

        try {
            await refreshPtvArrCalendarAvailability();
            expect(getPtvArrCalendarAvailabilitySnapshot()).toMatchObject({ status: 'error' });

            await vi.advanceTimersByTimeAsync(5_000);

            expect(availabilityMocks.getArrCalendarAvailability).toHaveBeenCalledTimes(2);
            expect(getPtvArrCalendarAvailabilitySnapshot()).toMatchObject({
                showEntry: true,
                status: 'available'
            });
        } finally {
            unsubscribe();
            vi.useRealTimers();
        }
    });

    it('bounds automatic retries and permits a later focus-triggered recovery', async () => {
        vi.useFakeTimers();
        availabilityMocks.getArrCalendarAvailability
            .mockRejectedValueOnce(new Error('First failure'))
            .mockRejectedValueOnce(new Error('Second failure'))
            .mockRejectedValueOnce(new Error('Third failure'))
            .mockResolvedValueOnce({ capability: CALENDAR_CAPABILITY, services: [service('radarr')], ok: true });
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);

        try {
            await act(async () => {
                root.render(createElement(AvailabilityHarness));
                await Promise.resolve();
            });
            expect(availabilityMocks.getArrCalendarAvailability).toHaveBeenCalledTimes(1);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(5_000);
            });
            await act(async () => {
                await vi.advanceTimersByTimeAsync(10_000);
            });
            expect(availabilityMocks.getArrCalendarAvailability).toHaveBeenCalledTimes(3);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(20_000);
            });
            expect(availabilityMocks.getArrCalendarAvailability).toHaveBeenCalledTimes(3);

            await act(async () => {
                window.dispatchEvent(new Event('focus'));
                await Promise.resolve();
            });
            expect(availabilityMocks.getArrCalendarAvailability).toHaveBeenCalledTimes(4);
            expect(getPtvArrCalendarAvailabilitySnapshot()).toMatchObject({
                configuredServices: ['radarr'],
                showEntry: true,
                status: 'available'
            });
        } finally {
            act(() => root.unmount());
            container.remove();
            vi.useRealTimers();
        }
    });

    it('isolates cached availability by server and user identity', async () => {
        availabilityMocks.getArrCalendarAvailability
            .mockResolvedValueOnce({ capability: CALENDAR_CAPABILITY, services: [service('sonarr')], ok: true })
            .mockResolvedValueOnce({ capability: CALENDAR_CAPABILITY, services: [], ok: true });

        await refreshPtvArrCalendarAvailability();
        availabilityMocks.serverId = 'server-b';
        await refreshPtvArrCalendarAvailability();

        expect(getPtvArrCalendarAvailabilitySnapshot()).toMatchObject({
            identityKey: 'server-b:user-a',
            showEntry: false
        });
        availabilityMocks.serverId = 'server-a';
        expect(getPtvArrCalendarAvailabilitySnapshot()).toMatchObject({
            identityKey: 'server-a:user-a',
            showEntry: true
        });
    });

    it('starts a fresh bypassed request when configuration changes during an older request', async () => {
        let resolveOldStatus: ((value: unknown) => void) | undefined;
        const oldRequest = new Promise(resolve => {
            resolveOldStatus = resolve;
        });
        availabilityMocks.getArrCalendarAvailability
            .mockReturnValueOnce(oldRequest)
            .mockResolvedValueOnce({ capability: CALENDAR_CAPABILITY, services: [service('lidarr')], ok: true });

        const staleRefresh = refreshPtvArrCalendarAvailability();
        await invalidatePtvArrCalendarAvailability();

        expect(availabilityMocks.getArrCalendarAvailability).toHaveBeenCalledTimes(2);
        expect(availabilityMocks.getArrCalendarAvailability).toHaveBeenNthCalledWith(2, { bypassCache: true });
        expect(getPtvArrCalendarAvailabilitySnapshot()).toMatchObject({
            configuredServices: ['lidarr'],
            showEntry: true
        });

        resolveOldStatus?.({ capability: CALENDAR_CAPABILITY, services: [], ok: true });
        await staleRefresh;
        expect(getPtvArrCalendarAvailabilitySnapshot()).toMatchObject({ configuredServices: ['lidarr'] });
    });

    it('does not fetch or cache under fallback identities while authentication is unsettled', async () => {
        availabilityMocks.serverId = '';

        await expect(refreshPtvArrCalendarAvailability()).resolves.toMatchObject({
            identityKey: '',
            showEntry: false,
            status: 'idle'
        });
        expect(availabilityMocks.getArrCalendarAvailability).not.toHaveBeenCalled();

        availabilityMocks.serverId = 'server-a';
        availabilityMocks.getArrCalendarAvailability.mockResolvedValueOnce({
            capability: CALENDAR_CAPABILITY,
            services: [service('sonarr')],
            ok: true
        });
        await refreshPtvArrCalendarAvailability();
        expect(getPtvArrCalendarAvailabilitySnapshot()).toMatchObject({
            identityKey: 'server-a:user-a',
            showEntry: true
        });
    });
});
