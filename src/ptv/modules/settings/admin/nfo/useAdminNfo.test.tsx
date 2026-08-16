import type { Api } from '@jellyfin/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
    loadAdminNfo: vi.fn(),
    loadAdminNfoUsers: vi.fn(),
    saveAdminNfo: vi.fn()
}));

vi.mock('./adminNfoService', () => ({
    loadAdminNfo: serviceMocks.loadAdminNfo,
    loadAdminNfoUsers: serviceMocks.loadAdminNfoUsers,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    NFO_CONFIGURATION_KEY: 'xbmcmetadata',
    saveAdminNfo: serviceMocks.saveAdminNfo
}));

import {
    getAdminNfoQueryKey,
    getAdminNfoUsersQueryKey,
    useAdminNfo
} from './useAdminNfo';
import {
    AdminNfoServiceError,
    type AdminNfoSettings,
    type AdminNfoSnapshot
} from './adminNfoModel';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

const api = {} as Api;
const apiClient = (serverId: string) => ({
    serverId: () => serverId
} as unknown as ApiClient);

const confirmed: AdminNfoSettings = {
    enableExtraThumbsDuplication: false,
    enablePathSubstitution: true,
    saveImagePathsInNfo: true,
    userId: null
};

function snapshot(settings: AdminNfoSettings = confirmed): AdminNfoSnapshot {
    return {
        configuration: {
            EnableExtraThumbsDuplication: settings.enableExtraThumbsDuplication,
            EnablePathSubstitution: settings.enablePathSubstitution,
            ReleaseDateFormat: 'yyyy-MM-dd',
            SaveImagePathsInNfo: settings.saveImagePathsInNfo,
            UserId: settings.userId
        },
        settings
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

type HookState = ReturnType<typeof useAdminNfo>;

function Harness({
    client = apiClient('server-a'),
    jellyfinApi = api,
    stateRef
}: Readonly<{
    client?: ApiClient;
    jellyfinApi?: Api;
    stateRef: { current?: HookState };
}>) {
    stateRef.current = useAdminNfo(jellyfinApi, client);
    return null;
}

async function flushQueries() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

describe('administrator NFO hook', () => {
    let container: HTMLDivElement;
    let queryClient: QueryClient;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        serviceMocks.loadAdminNfo.mockResolvedValue(snapshot());
        serviceMocks.loadAdminNfoUsers.mockResolvedValue([
            { id: 'user-a', label: 'Piggie', unavailable: false }
        ]);
        serviceMocks.saveAdminNfo.mockResolvedValue(snapshot());
        queryClient = new QueryClient({
            defaultOptions: { queries: { gcTime: Infinity, retry: false } }
        });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        queryClient.clear();
        container.remove();
    });

    it('uses exact source-specific identities isolated by server', () => {
        expect(getAdminNfoQueryKey('server-a')).toEqual([
            'PtvAdminNfo', 'server-a', 'named', 'xbmcmetadata'
        ]);
        expect(getAdminNfoUsersQueryKey('server-a')).toEqual([
            'PtvAdminNfo', 'server-a', 'users'
        ]);
        expect(getAdminNfoQueryKey('server-a')).not.toEqual(getAdminNfoQueryKey('server-b'));
    });

    it('loads configuration and optional users concurrently with AbortSignals and does not poll', async () => {
        const stateRef: { current?: HookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(stateRef.current?.settings).toEqual(confirmed);
        expect(stateRef.current?.users).toEqual([
            { id: 'user-a', label: 'Piggie', unavailable: false }
        ]);
        expect(serviceMocks.loadAdminNfo).toHaveBeenCalledWith(api, expect.any(AbortSignal));
        expect(serviceMocks.loadAdminNfoUsers).toHaveBeenCalledWith(api, expect.any(AbortSignal));
        expect(serviceMocks.loadAdminNfo).toHaveBeenCalledOnce();
        expect(serviceMocks.loadAdminNfoUsers).toHaveBeenCalledOnce();

        await new Promise(resolve => setTimeout(resolve, 20));
        expect(serviceMocks.loadAdminNfo).toHaveBeenCalledOnce();
        expect(serviceMocks.loadAdminNfoUsers).toHaveBeenCalledOnce();
    });

    it('does not load either source without a stable server identity', async () => {
        const stateRef: { current?: HookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness client={apiClient('')} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(serviceMocks.loadAdminNfo).not.toHaveBeenCalled();
        expect(serviceMocks.loadAdminNfoUsers).not.toHaveBeenCalled();
    });

    it('keeps settings usable and preserves the configured ID when optional users fail', async () => {
        const stateRef: { current?: HookState } = {};
        const withDeletedUser = snapshot({ ...confirmed, userId: 'deleted-user' });
        serviceMocks.loadAdminNfo.mockResolvedValue(withDeletedUser);
        serviceMocks.loadAdminNfoUsers.mockRejectedValue(
            new AdminNfoServiceError('users-unavailable', 'NFO watch-data users could not be loaded.')
        );
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(stateRef.current?.error).toBeNull();
        expect(stateRef.current?.settings).toEqual(withDeletedUser.settings);
        expect(stateRef.current?.usersError).toMatchObject({ code: 'users-unavailable' });
        expect(stateRef.current?.users).toEqual([
            { id: 'deleted-user', label: 'Unavailable user', unavailable: true }
        ]);

        await act(async () => {
            await stateRef.current!.save({
                ...withDeletedUser.settings,
                saveImagePathsInNfo: false
            }, withDeletedUser.settings);
        });
        expect(serviceMocks.saveAdminNfo).toHaveBeenCalledOnce();
    });

    it('keeps save single-flight, cancels only the exact config query, and installs cache directly', async () => {
        const stateRef: { current?: HookState } = {};
        const desired = { ...confirmed, enablePathSubstitution: false };
        const saved = snapshot(desired);
        const pending = deferred<AdminNfoSnapshot>();
        serviceMocks.saveAdminNfo.mockReturnValue(pending.promise);
        const cancelSpy = vi.spyOn(queryClient, 'cancelQueries');
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        let first!: Promise<AdminNfoSnapshot>;
        let second!: Promise<AdminNfoSnapshot>;
        await act(async () => {
            first = stateRef.current!.save(desired, confirmed);
            second = stateRef.current!.save(desired, confirmed);
            await Promise.resolve();
        });

        expect(first).toBe(second);
        expect(serviceMocks.saveAdminNfo).toHaveBeenCalledOnce();
        expect(cancelSpy).toHaveBeenCalledWith({
            exact: true,
            queryKey: getAdminNfoQueryKey('server-a')
        });

        await act(async () => {
            pending.resolve(saved);
            await first;
        });

        expect(queryClient.getQueryData(getAdminNfoQueryKey('server-a'))).toEqual(saved);
        expect(stateRef.current?.settings).toEqual(desired);
        expect(stateRef.current?.saving).toBe(false);
        expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it('retains confirmed cache data after a failed save', async () => {
        const stateRef: { current?: HookState } = {};
        serviceMocks.saveAdminNfo.mockRejectedValue(
            new AdminNfoServiceError('save-failed', "We couldn't save NFO settings.")
        );
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        await act(async () => {
            await expect(stateRef.current!.save({
                ...confirmed,
                saveImagePathsInNfo: false
            }, confirmed)).rejects.toMatchObject({ code: 'save-failed' });
        });

        expect(stateRef.current?.settings).toEqual(confirmed);
        expect(stateRef.current?.saving).toBe(false);
    });

    it('prevents a cancelled stale read from replacing a newer saved snapshot', async () => {
        const stateRef: { current?: HookState } = {};
        const oldRead = deferred<AdminNfoSnapshot>();
        const saved = snapshot({ ...confirmed, saveImagePathsInNfo: false });
        serviceMocks.loadAdminNfo.mockReturnValue(oldRead.promise);
        serviceMocks.saveAdminNfo.mockResolvedValue(saved);
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness stateRef={stateRef} />
            </QueryClientProvider>
        ));

        await act(async () => {
            await stateRef.current!.save(saved.settings, confirmed);
        });
        await act(async () => {
            oldRead.resolve(snapshot(confirmed));
            await oldRead.promise;
            await Promise.resolve();
        });

        expect(stateRef.current?.settings).toEqual(saved.settings);
        expect(queryClient.getQueryData<AdminNfoSnapshot>(
            getAdminNfoQueryKey('server-a')
        )?.settings).toEqual(saved.settings);
    });
});
