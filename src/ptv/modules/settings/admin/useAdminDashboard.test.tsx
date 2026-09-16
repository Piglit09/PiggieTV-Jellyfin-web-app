import type { Api } from '@jellyfin/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    createUnavailableAdminServer,
    normalizeAdminLibraries,
    normalizeAdminPlayback,
    normalizeAdminPtvStatus,
    normalizeAdminServer,
    normalizeAdminTasks
} from './adminDashboardAdapters';

const dashboardService = vi.hoisted(() => ({
    loadAdminLibraries: vi.fn(),
    loadAdminPlayback: vi.fn(),
    loadAdminPtv: vi.fn(),
    loadAdminServer: vi.fn(),
    loadAdminTasks: vi.fn()
}));

const pluginApi = vi.hoisted(() => ({
    getCurrentPtvPluginApiClient: vi.fn()
}));

vi.mock('./adminDashboardService', () => dashboardService);
vi.mock('../../../core/pluginApi', () => pluginApi);

import type { AdminDashboardSourceKey } from './adminDashboardModel';
import {
    resolveAdminDashboardQueryData,
    useAdminDashboard
} from './useAdminDashboard';

const api = {} as Api;
const pluginClient = { getStatus: vi.fn() };
const legacyApiClient = {
    serverId: () => 'server-a'
} as unknown as ApiClient;

type HookResult = ReturnType<typeof useAdminDashboard>;
type HookStateRef = { current: HookResult | undefined };

function setReactActEnvironment(value: boolean) {
    const environment = globalThis as typeof globalThis & Record<string, unknown>;

    environment['IS_REACT_ACT_ENVIRONMENT'] = value;
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(next => {
        resolve = next;
    });

    return { promise, resolve };
}

function serverSummary() {
    return normalizeAdminServer({
        ServerName: 'Piggie Server',
        Version: '10.11.11'
    });
}

function ptvSummary() {
    return normalizeAdminPtvStatus({
        cacheHealthy: true,
        featuredCacheFresh: true,
        featuredContent: {
            hasPayload: true,
            heroCount: 2,
            itemCount: 20,
            sectionCount: 4
        },
        ok: true,
        pluginVersion: '2.4.1'
    });
}

function librariesSummary() {
    return normalizeAdminLibraries([ {
        CollectionType: 'movies',
        Name: 'Movies'
    } ]);
}

function playbackSummary() {
    return normalizeAdminPlayback([]);
}

function tasksSummary() {
    return normalizeAdminTasks([]);
}

function HookHarness({ apiClient = legacyApiClient, stateRef }: Readonly<{
    apiClient?: ApiClient;
    stateRef: HookStateRef;
}>) {
    stateRef.current = useAdminDashboard(api, apiClient);
    return null;
}

describe('useAdminDashboard', () => {
    let container: HTMLDivElement;
    const stateRef: HookStateRef = { current: undefined };
    let queryClient: QueryClient;
    let root: Root;
    let visibilityState: DocumentVisibilityState;

    const getState = () => {
        if (!stateRef.current) throw new Error('Dashboard hook has not rendered.');
        return stateRef.current;
    };

    async function flushQueryUpdates() {
        await act(async () => {
            await Promise.resolve();
            await vi.advanceTimersByTimeAsync(0);
            await Promise.resolve();
        });
    }

    async function mount(apiClient = legacyApiClient) {
        await act(async () => {
            root.render(
                <QueryClientProvider client={queryClient}>
                    <HookHarness apiClient={apiClient} stateRef={stateRef} />
                </QueryClientProvider>
            );
        });
        await flushQueryUpdates();
    }

    it('waits for a resolved server id and keeps A to B query data isolated', async () => {
        const unresolved = { serverId: () => '' } as unknown as ApiClient;
        await mount(unresolved);

        expect(dashboardService.loadAdminServer).not.toHaveBeenCalled();
        expect(dashboardService.loadAdminPtv).not.toHaveBeenCalled();
        expect(dashboardService.loadAdminLibraries).not.toHaveBeenCalled();
        expect(dashboardService.loadAdminPlayback).not.toHaveBeenCalled();
        expect(dashboardService.loadAdminTasks).not.toHaveBeenCalled();

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <HookHarness apiClient={legacyApiClient} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueryUpdates();
        const nextApiClient = { serverId: () => 'server-b' } as unknown as ApiClient;
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <HookHarness apiClient={nextApiClient} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueryUpdates();

        expect(dashboardService.loadAdminServer).toHaveBeenCalledTimes(2);
        expect(dashboardService.loadAdminPtv).toHaveBeenCalledTimes(2);
        expect(dashboardService.loadAdminLibraries).toHaveBeenCalledTimes(2);
        expect(dashboardService.loadAdminPlayback).toHaveBeenCalledTimes(2);
        expect(dashboardService.loadAdminTasks).toHaveBeenCalledTimes(2);
        expect(queryClient.getQueryData([ 'PtvAdminDashboard', 'server-a', 'server' ])).toBeDefined();
        expect(queryClient.getQueryData([ 'PtvAdminDashboard', 'server-b', 'server' ])).toBeDefined();
        expect(queryClient.getQueryData([ 'PtvAdminDashboard', null, 'server' ])).toBeUndefined();
    });

    beforeEach(() => {
        setReactActEnvironment(true);
        vi.useFakeTimers();
        visibilityState = 'visible';
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => visibilityState
        });

        dashboardService.loadAdminServer.mockReset().mockResolvedValue(serverSummary());
        dashboardService.loadAdminPtv.mockReset().mockResolvedValue(ptvSummary());
        dashboardService.loadAdminLibraries.mockReset().mockResolvedValue(librariesSummary());
        dashboardService.loadAdminPlayback.mockReset().mockResolvedValue(playbackSummary());
        dashboardService.loadAdminTasks.mockReset().mockResolvedValue(tasksSummary());
        pluginApi.getCurrentPtvPluginApiClient.mockReset().mockReturnValue(pluginClient);

        queryClient = new QueryClient({
            defaultOptions: {
                queries: { gcTime: Infinity }
            }
        });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        queryClient.clear();
        container.remove();
        Reflect.deleteProperty(document, 'visibilityState');
        stateRef.current = undefined;
        setReactActEnvironment(false);
        vi.useRealTimers();
    });

    it('loads all five sources once and exposes their normalized data independently', async () => {
        await mount();

        expect(dashboardService.loadAdminServer).toHaveBeenCalledTimes(1);
        expect(dashboardService.loadAdminPtv).toHaveBeenCalledTimes(1);
        expect(dashboardService.loadAdminLibraries).toHaveBeenCalledTimes(1);
        expect(dashboardService.loadAdminPlayback).toHaveBeenCalledTimes(1);
        expect(dashboardService.loadAdminTasks).toHaveBeenCalledTimes(1);
        expect(dashboardService.loadAdminPtv.mock.calls[0][0]).toBe(pluginClient);
        expect(dashboardService.loadAdminPtv.mock.calls[0][2]).toBe(false);
        expect(getState().snapshot).toMatchObject({
            libraries: { count: 1, sourceState: 'ready' },
            playback: { activeStreamCount: 0, sourceState: 'ready' },
            ptv: { pluginVersion: '2.4.1', sourceState: 'ready' },
            server: { name: 'Piggie Server', sourceState: 'ready' },
            tasks: { runningCount: 0, sourceState: 'ready' }
        });
    });

    it('marks stale query data unavailable after its refresh retries fail', () => {
        const resolved = resolveAdminDashboardQueryData(
            serverSummary(),
            true,
            createUnavailableAdminServer
        );

        expect(resolved).toMatchObject({
            name: null,
            sourceState: 'unavailable',
            statusLabel: 'Unavailable'
        });
    });

    it('keeps successful source data available while another source is still loading', async () => {
        const pendingPtv = createDeferred<ReturnType<typeof ptvSummary>>();
        dashboardService.loadAdminPtv.mockReset().mockReturnValue(pendingPtv.promise);

        await mount();

        expect(dashboardService.loadAdminPtv).toHaveBeenCalledTimes(1);
        expect(getState().sourceStates.ptv.loading).toBe(true);
        expect(getState().snapshot.ptv.sourceState).toBe('unavailable');
        expect(getState().snapshot.server.name).toBe('Piggie Server');
        expect(getState().snapshot.libraries.count).toBe(1);
        expect(getState().snapshot.tasks.runningCount).toBe(0);

        await act(async () => {
            pendingPtv.resolve(ptvSummary());
            await Promise.resolve();
        });
        await flushQueryUpdates();

        expect(getState().snapshot.ptv).toMatchObject({
            pluginVersion: '2.4.1',
            sourceState: 'ready'
        });
    });

    it('refreshes playback after 30 seconds without refreshing slow sources', async () => {
        await mount();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(29_999);
        });
        expect(dashboardService.loadAdminPlayback).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
            await Promise.resolve();
        });

        expect(dashboardService.loadAdminPlayback).toHaveBeenCalledTimes(2);
        expect(dashboardService.loadAdminServer).toHaveBeenCalledTimes(1);
        expect(dashboardService.loadAdminPtv).toHaveBeenCalledTimes(1);
        expect(dashboardService.loadAdminLibraries).toHaveBeenCalledTimes(1);
        expect(dashboardService.loadAdminTasks).toHaveBeenCalledTimes(1);
    });

    it('refreshes summary sources after 90 seconds', async () => {
        await mount();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(89_999);
        });
        expect(dashboardService.loadAdminServer).toHaveBeenCalledTimes(1);
        expect(dashboardService.loadAdminPtv).toHaveBeenCalledTimes(1);
        expect(dashboardService.loadAdminLibraries).toHaveBeenCalledTimes(1);
        expect(dashboardService.loadAdminTasks).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
            await Promise.resolve();
        });

        expect(dashboardService.loadAdminServer).toHaveBeenCalledTimes(2);
        expect(dashboardService.loadAdminPtv).toHaveBeenCalledTimes(2);
        expect(dashboardService.loadAdminLibraries).toHaveBeenCalledTimes(2);
        expect(dashboardService.loadAdminTasks).toHaveBeenCalledTimes(2);
    });

    it('pauses polling while hidden and refreshes once when visibility resumes', async () => {
        visibilityState = 'hidden';
        await mount();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(120_000);
        });
        expect(dashboardService.loadAdminPlayback).toHaveBeenCalledTimes(1);
        expect(dashboardService.loadAdminServer).toHaveBeenCalledTimes(1);

        visibilityState = 'visible';
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
            await Promise.resolve();
        });
        await flushQueryUpdates();

        expect(dashboardService.loadAdminPlayback).toHaveBeenCalledTimes(2);
        expect(dashboardService.loadAdminServer).toHaveBeenCalledTimes(2);
        expect(dashboardService.loadAdminPtv.mock.calls.at(-1)?.[2]).toBe(false);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(30_000);
            await Promise.resolve();
        });
        expect(dashboardService.loadAdminPlayback).toHaveBeenCalledTimes(3);
        expect(dashboardService.loadAdminServer).toHaveBeenCalledTimes(2);
    });

    it('does not duplicate intervals after rerender and stops polling after unmount', async () => {
        await mount();

        await act(async () => {
            root.render(
                <QueryClientProvider client={queryClient}>
                    <HookHarness stateRef={stateRef} />
                </QueryClientProvider>
            );
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(30_000);
            await Promise.resolve();
        });
        expect(dashboardService.loadAdminPlayback).toHaveBeenCalledTimes(2);

        act(() => root.unmount());
        root = createRoot(container);
        const callsAfterUnmount = {
            libraries: dashboardService.loadAdminLibraries.mock.calls.length,
            playback: dashboardService.loadAdminPlayback.mock.calls.length,
            ptv: dashboardService.loadAdminPtv.mock.calls.length,
            server: dashboardService.loadAdminServer.mock.calls.length,
            tasks: dashboardService.loadAdminTasks.mock.calls.length
        };

        await vi.advanceTimersByTimeAsync(180_000);

        expect(dashboardService.loadAdminLibraries).toHaveBeenCalledTimes(callsAfterUnmount.libraries);
        expect(dashboardService.loadAdminPlayback).toHaveBeenCalledTimes(callsAfterUnmount.playback);
        expect(dashboardService.loadAdminPtv).toHaveBeenCalledTimes(callsAfterUnmount.ptv);
        expect(dashboardService.loadAdminServer).toHaveBeenCalledTimes(callsAfterUnmount.server);
        expect(dashboardService.loadAdminTasks).toHaveBeenCalledTimes(callsAfterUnmount.tasks);
    });

    it('coalesces concurrent manual refreshes and bypasses the PTV status cache', async () => {
        await mount();
        const serverRefresh = createDeferred<ReturnType<typeof serverSummary>>();
        const ptvRefresh = createDeferred<ReturnType<typeof ptvSummary>>();
        const librariesRefresh = createDeferred<ReturnType<typeof librariesSummary>>();
        const playbackRefresh = createDeferred<ReturnType<typeof playbackSummary>>();
        const tasksRefresh = createDeferred<ReturnType<typeof tasksSummary>>();
        dashboardService.loadAdminServer.mockReturnValueOnce(serverRefresh.promise);
        dashboardService.loadAdminPtv.mockReturnValueOnce(ptvRefresh.promise);
        dashboardService.loadAdminLibraries.mockReturnValueOnce(librariesRefresh.promise);
        dashboardService.loadAdminPlayback.mockReturnValueOnce(playbackRefresh.promise);
        dashboardService.loadAdminTasks.mockReturnValueOnce(tasksRefresh.promise);

        let firstRefresh!: Promise<void>;
        let secondRefresh!: Promise<void>;
        await act(async () => {
            firstRefresh = getState().refresh();
            secondRefresh = getState().refresh();
            await Promise.resolve();
        });

        expect(firstRefresh).toBe(secondRefresh);
        expect(dashboardService.loadAdminServer).toHaveBeenCalledTimes(2);
        expect(dashboardService.loadAdminPtv).toHaveBeenCalledTimes(2);
        expect(dashboardService.loadAdminLibraries).toHaveBeenCalledTimes(2);
        expect(dashboardService.loadAdminPlayback).toHaveBeenCalledTimes(2);
        expect(dashboardService.loadAdminTasks).toHaveBeenCalledTimes(2);
        expect(dashboardService.loadAdminPtv.mock.calls.at(-1)?.[2]).toBe(true);

        await act(async () => {
            serverRefresh.resolve(serverSummary());
            ptvRefresh.resolve(ptvSummary());
            librariesRefresh.resolve(librariesSummary());
            playbackRefresh.resolve(playbackSummary());
            tasksRefresh.resolve(tasksSummary());
            await firstRefresh;
        });
    });

    it('retries only the selected source and bypasses cache for a PTV retry', async () => {
        await mount();
        const loaderBySource = {
            libraries: dashboardService.loadAdminLibraries,
            playback: dashboardService.loadAdminPlayback,
            ptv: dashboardService.loadAdminPtv,
            server: dashboardService.loadAdminServer,
            tasks: dashboardService.loadAdminTasks
        } satisfies Record<AdminDashboardSourceKey, ReturnType<typeof vi.fn>>;
        const sources: AdminDashboardSourceKey[] = [
            'server',
            'ptv',
            'libraries',
            'playback',
            'tasks'
        ];

        for (const source of sources) {
            const callsBefore = Object.fromEntries(
                sources.map(key => [ key, loaderBySource[key].mock.calls.length ])
            ) as Record<AdminDashboardSourceKey, number>;

            await act(async () => {
                await getState().retrySource(source);
            });

            for (const key of sources) {
                expect(loaderBySource[key]).toHaveBeenCalledTimes(
                    callsBefore[key] + (key === source ? 1 : 0)
                );
            }
        }

        expect(dashboardService.loadAdminPtv.mock.calls.at(-1)?.[2]).toBe(true);
    });
});
