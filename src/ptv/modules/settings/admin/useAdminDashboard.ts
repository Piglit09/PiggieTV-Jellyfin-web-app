import type { Api } from '@jellyfin/sdk';
import type { ApiClient } from 'jellyfin-apiclient';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { getCurrentPtvPluginApiClient } from '../../../core/pluginApi';
import {
    createAdminDashboardSnapshot,
    createUnavailableAdminLibraries,
    createUnavailableAdminPlayback,
    createUnavailableAdminPtv,
    createUnavailableAdminServer,
    createUnavailableAdminTasks
} from './adminDashboardAdapters';
import type { AdminDashboardSourceKey } from './adminDashboardModel';
import {
    loadAdminLibraries,
    loadAdminPlayback,
    loadAdminPtv,
    loadAdminServer,
    loadAdminTasks
} from './adminDashboardService';
import { getResolvedAdminServerId } from './adminServerIdentity';

const ADMIN_DASHBOARD_QUERY_SCOPE = 'PtvAdminDashboard';
const SESSION_REFRESH_INTERVAL_MS = 30_000;
const SUMMARY_REFRESH_INTERVAL_MS = 90_000;

// React Query uses false to disable an otherwise numeric interval.
// eslint-disable-next-line sonarjs/function-return-type
function visibleRefreshInterval(interval: number): number | false {
    if (typeof document === 'undefined') return interval;
    // eslint-disable-next-line compat/compat
    return document.visibilityState === 'visible' ? interval : false;
}

export function resolveAdminDashboardQueryData<T>(
    data: T | undefined,
    isError: boolean,
    createUnavailable: () => T
) {
    return !isError && data !== undefined ? data : createUnavailable();
}

export type AdminDashboardQueryState = Readonly<{
    error: boolean;
    fetching: boolean;
    loading: boolean;
}>;

export type AdminDashboardSourceStates = Readonly<Record<
    AdminDashboardSourceKey,
    AdminDashboardQueryState
>>;

export function useAdminDashboard(
    api?: Api,
    apiClient?: ApiClient
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const enabled = Boolean(api && serverKey);
    const ptvApiClient = useMemo(
        () => getCurrentPtvPluginApiClient(apiClient),
        [apiClient]
    );
    const bypassPtvCacheRef = useRef(false);
    const refreshPromiseRef = useRef<Promise<void> | null>(null);

    const serverQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminServer(api!, signal),
        queryKey: [ADMIN_DASHBOARD_QUERY_SCOPE, serverKey, 'server'],
        refetchInterval: () => visibleRefreshInterval(SUMMARY_REFRESH_INTERVAL_MS),
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: SUMMARY_REFRESH_INTERVAL_MS / 2
    });
    const ptvQuery = useQuery({
        enabled,
        queryFn: async ({ signal }) => {
            const bypassCache = bypassPtvCacheRef.current;
            bypassPtvCacheRef.current = false;
            return loadAdminPtv(ptvApiClient, signal, bypassCache);
        },
        queryKey: [ADMIN_DASHBOARD_QUERY_SCOPE, serverKey, 'ptv'],
        refetchInterval: () => visibleRefreshInterval(SUMMARY_REFRESH_INTERVAL_MS),
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: SUMMARY_REFRESH_INTERVAL_MS / 2
    });
    const librariesQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminLibraries(api!, signal),
        queryKey: [ADMIN_DASHBOARD_QUERY_SCOPE, serverKey, 'libraries'],
        refetchInterval: () => visibleRefreshInterval(SUMMARY_REFRESH_INTERVAL_MS),
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: SUMMARY_REFRESH_INTERVAL_MS / 2
    });
    const playbackQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminPlayback(api!, signal),
        queryKey: [ADMIN_DASHBOARD_QUERY_SCOPE, serverKey, 'playback'],
        refetchInterval: () => visibleRefreshInterval(SESSION_REFRESH_INTERVAL_MS),
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: SESSION_REFRESH_INTERVAL_MS / 2
    });
    const tasksQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminTasks(api!, signal),
        queryKey: [ADMIN_DASHBOARD_QUERY_SCOPE, serverKey, 'tasks'],
        refetchInterval: () => visibleRefreshInterval(SUMMARY_REFRESH_INTERVAL_MS),
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: SUMMARY_REFRESH_INTERVAL_MS / 2
    });
    const refetchServer = serverQuery.refetch;
    const refetchPtv = ptvQuery.refetch;
    const refetchLibraries = librariesQuery.refetch;
    const refetchPlayback = playbackQuery.refetch;
    const refetchTasks = tasksQuery.refetch;

    const snapshot = useMemo(() => createAdminDashboardSnapshot({
        libraries: resolveAdminDashboardQueryData(
            librariesQuery.data,
            librariesQuery.isError,
            createUnavailableAdminLibraries
        ),
        playback: resolveAdminDashboardQueryData(
            playbackQuery.data,
            playbackQuery.isError,
            createUnavailableAdminPlayback
        ),
        ptv: resolveAdminDashboardQueryData(
            ptvQuery.data,
            ptvQuery.isError,
            createUnavailableAdminPtv
        ),
        server: resolveAdminDashboardQueryData(
            serverQuery.data,
            serverQuery.isError,
            createUnavailableAdminServer
        ),
        tasks: resolveAdminDashboardQueryData(
            tasksQuery.data,
            tasksQuery.isError,
            createUnavailableAdminTasks
        )
    }), [
        librariesQuery.data,
        librariesQuery.isError,
        playbackQuery.data,
        playbackQuery.isError,
        ptvQuery.data,
        ptvQuery.isError,
        serverQuery.data,
        serverQuery.isError,
        tasksQuery.data,
        tasksQuery.isError
    ]);

    const sourceStates = useMemo<AdminDashboardSourceStates>(() => ({
        libraries: {
            error: librariesQuery.isError,
            fetching: librariesQuery.isFetching,
            loading: librariesQuery.isPending && !librariesQuery.data
        },
        playback: {
            error: playbackQuery.isError,
            fetching: playbackQuery.isFetching,
            loading: playbackQuery.isPending && !playbackQuery.data
        },
        ptv: {
            error: ptvQuery.isError,
            fetching: ptvQuery.isFetching,
            loading: ptvQuery.isPending && !ptvQuery.data
        },
        server: {
            error: serverQuery.isError,
            fetching: serverQuery.isFetching,
            loading: serverQuery.isPending && !serverQuery.data
        },
        tasks: {
            error: tasksQuery.isError,
            fetching: tasksQuery.isFetching,
            loading: tasksQuery.isPending && !tasksQuery.data
        }
    }), [
        librariesQuery.data,
        librariesQuery.isError,
        librariesQuery.isFetching,
        librariesQuery.isPending,
        playbackQuery.data,
        playbackQuery.isError,
        playbackQuery.isFetching,
        playbackQuery.isPending,
        ptvQuery.data,
        ptvQuery.isError,
        ptvQuery.isFetching,
        ptvQuery.isPending,
        serverQuery.data,
        serverQuery.isError,
        serverQuery.isFetching,
        serverQuery.isPending,
        tasksQuery.data,
        tasksQuery.isError,
        tasksQuery.isFetching,
        tasksQuery.isPending
    ]);

    const refreshAll = useCallback((bypassPtvCache = false) => {
        if (!api || !serverKey) return Promise.resolve();
        if (refreshPromiseRef.current) return refreshPromiseRef.current;

        bypassPtvCacheRef.current = bypassPtvCache;
        const refreshPromise = Promise.allSettled([
            refetchServer({ cancelRefetch: true }),
            refetchPtv({ cancelRefetch: true }),
            refetchLibraries({ cancelRefetch: true }),
            refetchPlayback({ cancelRefetch: true }),
            refetchTasks({ cancelRefetch: true })
        ]).then(() => undefined).finally(() => {
            refreshPromiseRef.current = null;
        });

        refreshPromiseRef.current = refreshPromise;
        return refreshPromise;
    }, [
        api,
        refetchLibraries,
        refetchPlayback,
        refetchPtv,
        refetchServer,
        refetchTasks,
        serverKey
    ]);

    const retrySource = useCallback(async (source: AdminDashboardSourceKey) => {
        if (!api || !serverKey) return;

        switch (source) {
            case 'server':
                await refetchServer({ cancelRefetch: true });
                return;
            case 'ptv':
                bypassPtvCacheRef.current = true;
                await refetchPtv({ cancelRefetch: true });
                return;
            case 'libraries':
                await refetchLibraries({ cancelRefetch: true });
                return;
            case 'playback':
                await refetchPlayback({ cancelRefetch: true });
                return;
            case 'tasks':
                await refetchTasks({ cancelRefetch: true });
        }
    }, [api, refetchLibraries, refetchPlayback, refetchPtv, refetchServer, refetchTasks, serverKey]);
    const refresh = useCallback(() => refreshAll(true), [refreshAll]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void refreshAll(false);
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [refreshAll]);

    const queryStates = Object.values(sourceStates);
    const isInitialLoading = queryStates.every(state => state.loading);
    const isRefreshing = queryStates.some(state => state.fetching) && !isInitialLoading;
    const lastUpdatedAt = Math.max(
        serverQuery.dataUpdatedAt,
        ptvQuery.dataUpdatedAt,
        librariesQuery.dataUpdatedAt,
        playbackQuery.dataUpdatedAt,
        tasksQuery.dataUpdatedAt
    );

    return {
        isInitialLoading,
        isRefreshing,
        lastUpdatedAt,
        refresh,
        retrySource,
        snapshot,
        sourceStates
    } as const;
}
