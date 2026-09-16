import type { Api } from '@jellyfin/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    deleteDevice: vi.fn(),
    getDeviceInfo: vi.fn(),
    getDevices: vi.fn(),
    getLogEntries: vi.fn(),
    getSessions: vi.fn(),
    getUsers: vi.fn()
}));

vi.mock('@jellyfin/sdk/lib/utils/api/activity-log-api', () => ({
    getActivityLogApi: () => apiMocks
}));
vi.mock('@jellyfin/sdk/lib/utils/api/devices-api', () => ({
    getDevicesApi: () => apiMocks
}));
vi.mock('@jellyfin/sdk/lib/utils/api/session-api', () => ({
    getSessionApi: () => apiMocks
}));
vi.mock('@jellyfin/sdk/lib/utils/api/user-api', () => ({
    getUserApi: () => apiMocks
}));

import {
    getAdminPeopleQueryKeys,
    getAdminPeopleVisibleRefreshInterval,
    useAdminActivity,
    useAdminDevices
} from './useAdminPeople';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

const api = { deviceInfo: { id: 'current-device' } } as Api;
const apiClient = { serverId: () => 'server-a' } as unknown as ApiClient;

type DevicesState = ReturnType<typeof useAdminDevices>;
type ActivityState = ReturnType<typeof useAdminActivity>;

function DevicesHarness({ client = apiClient, stateRef }: Readonly<{
    client?: ApiClient;
    stateRef: { current?: DevicesState };
}>) {
    stateRef.current = useAdminDevices(api, client);
    return null;
}

function ActivityHarness({ stateRef }: Readonly<{
    stateRef: { current?: ActivityState };
}>) {
    stateRef.current = useAdminActivity(api, apiClient, { pageIndex: 0, view: 'all' });
    return null;
}

function CombinedHarness({ stateRef }: Readonly<{
    stateRef: { current?: { activity: ActivityState; devices: DevicesState } };
}>) {
    stateRef.current = {
        activity: useAdminActivity(api, apiClient, { pageIndex: 0, view: 'all' }),
        devices: useAdminDevices(api, apiClient)
    };
    return null;
}

async function flushQueries() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe('administrator People hooks', () => {
    let container: HTMLDivElement;
    let queryClient: QueryClient;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        apiMocks.deleteDevice.mockResolvedValue({ data: undefined });
        apiMocks.getDeviceInfo.mockResolvedValue({
            data: { Id: 'device-a', Name: 'Living Room' }
        });
        apiMocks.getDevices.mockResolvedValue({
            data: {
                Items: [ {
                    AppName: 'PiggieTV',
                    DateLastActivity: '2026-08-12T12:00:00Z',
                    Id: 'device-a',
                    LastUserId: 'user-a',
                    Name: 'Living Room'
                } ]
            }
        });
        apiMocks.getLogEntries.mockResolvedValue({
            data: {
                Items: [ {
                    Date: '2026-08-12T12:00:00Z',
                    Id: 1,
                    Name: 'Signed in',
                    Severity: 'Information',
                    Type: 'AuthenticationSucceeded',
                    UserId: 'user-a'
                } ],
                StartIndex: 0,
                TotalRecordCount: 1
            }
        });
        apiMocks.getSessions.mockResolvedValue({
            data: [ {
                DeviceId: 'device-a',
                DeviceName: 'Living Room',
                Id: 'session-a',
                IsActive: true,
                UserId: 'user-a',
                UserName: 'Piggie'
            } ]
        });
        apiMocks.getUsers.mockResolvedValue({
            data: [ { Id: 'user-a', Name: 'Piggie' } ]
        });
        queryClient = new QueryClient({
            defaultOptions: { queries: { gcTime: Infinity, retry: false } }
        });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await act(async () => root.unmount());
        queryClient.clear();
        container.remove();
    });

    it('does not load or mutate People data before the server id resolves', async () => {
        const stateRef: { current?: DevicesState } = {};
        const unresolved = { serverId: () => '' } as unknown as ApiClient;
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <DevicesHarness client={unresolved} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(apiMocks.getDevices).not.toHaveBeenCalled();
        expect(apiMocks.getSessions).not.toHaveBeenCalled();
        expect(apiMocks.getUsers).not.toHaveBeenCalled();
        let prepareError: unknown;
        let removed = true;
        await act(async () => {
            try {
                await stateRef.current?.prepareRemoval('device-a');
            } catch (error) {
                prepareError = error;
            }
            removed = await stateRef.current!.removeDevice('device-a');
        });
        expect(prepareError).toMatchObject({
            code: 'devices-unavailable'
        });
        expect(removed).toBe(false);
        expect(apiMocks.deleteDevice).not.toHaveBeenCalled();
    });

    it('loads all device sources once and exposes only normalized data', async () => {
        const stateRef: { current?: DevicesState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <DevicesHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(apiMocks.getDevices).toHaveBeenCalledOnce();
        expect(apiMocks.getSessions).toHaveBeenCalledOnce();
        expect(apiMocks.getSessions).toHaveBeenCalledWith({
            activeWithinSeconds: 960,
            deviceId: undefined
        }, expect.any(Object));
        expect(apiMocks.getUsers).toHaveBeenCalledOnce();
        expect(stateRef.current?.devices).toHaveLength(1);
        expect(stateRef.current?.devices[0]).toMatchObject({
            id: 'device-a',
            name: 'Living Room',
            status: 'active'
        });
        expect(stateRef.current?.devices[0]).not.toHaveProperty('AccessToken');
    });

    it('deduplicates users when Devices and Activity mount together', async () => {
        const stateRef: {
            current?: { activity: ActivityState; devices: DevicesState };
        } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <CombinedHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(apiMocks.getUsers).toHaveBeenCalledOnce();
        expect(stateRef.current?.activity.entries[0].user?.username).toBe('Piggie');
        expect(stateRef.current?.devices.devices[0].users[0].username).toBe('Piggie');
    });

    it('keeps registry data usable when the session source fails', async () => {
        apiMocks.getSessions.mockRejectedValue(new Error('session source failed'));
        const stateRef: { current?: DevicesState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <DevicesHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 1_100));
        });
        await flushQueries();

        expect(stateRef.current?.sessionsError).toBe(true);
        expect(stateRef.current?.registryError).toBe(false);
        expect(stateRef.current?.devices[0]).toMatchObject({
            activeSessionCount: null,
            name: 'Living Room',
            status: 'unavailable'
        });
    });

    it('keeps a manual Refresh single-flight while refetching every source', async () => {
        const stateRef: { current?: DevicesState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <DevicesHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();
        const registry = deferred<{ data: { Items: never[] } }>();
        const sessions = deferred<{ data: never[] }>();
        const users = deferred<{ data: never[] }>();
        apiMocks.getDevices.mockReturnValueOnce(registry.promise);
        apiMocks.getSessions.mockReturnValueOnce(sessions.promise);
        apiMocks.getUsers.mockReturnValueOnce(users.promise);

        let first!: Promise<void>;
        let second!: Promise<void>;
        act(() => {
            first = stateRef.current!.refresh();
            second = stateRef.current!.refresh();
        });
        expect(first).toBe(second);
        expect(apiMocks.getDevices).toHaveBeenCalledTimes(2);
        expect(apiMocks.getSessions).toHaveBeenCalledTimes(2);
        expect(apiMocks.getUsers).toHaveBeenCalledTimes(2);

        registry.resolve({ data: { Items: [] } });
        sessions.resolve({ data: [] });
        users.resolve({ data: [] });
        await act(async () => first);
    });

    it('keeps the confirmed device visible until a single-flight removal succeeds', async () => {
        const stateRef: { current?: DevicesState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <DevicesHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();
        await act(async () => {
            await stateRef.current!.prepareRemoval('device-a');
        });
        const deletion = deferred<{ data: undefined }>();
        apiMocks.deleteDevice.mockReturnValueOnce(deletion.promise);

        let first!: Promise<boolean>;
        let second!: Promise<boolean>;
        act(() => {
            first = stateRef.current!.removeDevice('device-a');
            second = stateRef.current!.removeDevice('device-a');
        });
        expect(first).toBe(second);
        await vi.waitFor(() => expect(apiMocks.deleteDevice).toHaveBeenCalledOnce());
        expect(stateRef.current?.devices.map(item => item.id)).toEqual([ 'device-a' ]);
        expect(queryClient.getQueryData(getAdminPeopleQueryKeys('server-a').devices))
            .toMatchObject([ { Id: 'device-a' } ]);

        deletion.resolve({ data: undefined });
        await act(async () => {
            await expect(first).resolves.toBe(true);
        });
        expect(apiMocks.deleteDevice).toHaveBeenCalledOnce();
        expect(apiMocks.getDevices).toHaveBeenCalledTimes(2);
    });

    it('uses server/request-isolated keys and pauses numeric polling while hidden', () => {
        const serverA = getAdminPeopleQueryKeys('server-a', { pageIndex: 1, view: 'user' });
        const serverB = getAdminPeopleQueryKeys('server-b', { pageIndex: 1, view: 'user' });
        expect(serverA.activity).toEqual([
            'PtvAdminPeople',
            'server-a',
            'activity',
            { hasUserId: true, limit: 50, startIndex: 50 }
        ]);
        expect(serverA.devices).not.toEqual(serverB.devices);
        expect(serverA.sessions).toEqual([
            'PtvAdminPeople',
            'server-a',
            'sessions',
            { activeWithinSeconds: 960, deviceId: undefined }
        ]);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        expect(getAdminPeopleVisibleRefreshInterval(30_000)).toBe(false);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        expect(getAdminPeopleVisibleRefreshInterval(30_000)).toBe(30_000);
    });

    it('aborts query requests when the final observer unmounts', async () => {
        const never = new Promise(() => undefined);
        apiMocks.getDevices.mockReturnValue(never);
        apiMocks.getSessions.mockReturnValue(never);
        apiMocks.getUsers.mockReturnValue(never);
        const stateRef: { current?: DevicesState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <DevicesHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await act(async () => Promise.resolve());
        const signals = [
            apiMocks.getDevices.mock.calls[0][1].signal,
            apiMocks.getSessions.mock.calls[0][1].signal,
            apiMocks.getUsers.mock.calls[0][1].signal
        ] as AbortSignal[];

        await act(async () => root.unmount());
        expect(signals.every(signal => signal.aborted)).toBe(true);
        root = createRoot(container);
    });

    it('loads a bounded Activity page independently from optional users', async () => {
        apiMocks.getUsers.mockRejectedValue(new Error('users unavailable'));
        const stateRef: { current?: ActivityState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <ActivityHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 1_100));
        });
        await flushQueries();

        expect(stateRef.current?.usersError).toBe(true);
        expect(stateRef.current?.error).toBe(false);
        expect(stateRef.current?.entries).toHaveLength(1);
        expect(stateRef.current).toMatchObject({
            pageSize: 50,
            startIndex: 0,
            totalCount: 1
        });
    });
});
