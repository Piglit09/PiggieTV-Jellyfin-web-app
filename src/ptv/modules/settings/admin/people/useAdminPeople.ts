import type { Api } from '@jellyfin/sdk';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ApiClient } from 'jellyfin-apiclient';
import {
    createAdminPeopleUsersMap,
    normalizeAdminActivityPage,
    normalizeAdminDevices
} from './adminPeopleAdapters';
import {
    AdminPeopleServiceError,
    type AdminActivityView,
    type AdminDeviceRemovalSnapshot,
    confirmAdminDeviceRemoval,
    getAdminActivityRequest,
    loadAdminActivityPage,
    loadAdminDeviceRegistry,
    loadAdminPeopleSessions,
    loadAdminPeopleUsers,
    prepareAdminDeviceRemoval
} from './adminPeopleService';
import { getAdminPeopleQueryKeys } from './adminPeopleQueryKeys';
import { getResolvedAdminServerId } from '../adminServerIdentity';

export { getAdminPeopleQueryKeys } from './adminPeopleQueryKeys';
export const ADMIN_PEOPLE_SESSIONS_REFRESH_INTERVAL_MS = 30_000;
export const ADMIN_PEOPLE_ACTIVITY_REFRESH_INTERVAL_MS = 60_000;

// React Query uses false to disable an otherwise numeric interval.
// eslint-disable-next-line sonarjs/function-return-type
export function getAdminPeopleVisibleRefreshInterval(interval: number): number | false {
    if (typeof document === 'undefined') return interval;
    // eslint-disable-next-line compat/compat
    return document.visibilityState === 'visible' ? interval : false;
}

function safeRemovalMessage(error: unknown) {
    return error instanceof AdminPeopleServiceError ?
        error.message :
        'The device could not be removed. No device registration was changed.';
}

async function invalidateAfterDeviceRemoval(
    queryClient: ReturnType<typeof useQueryClient>,
    serverKey: string,
    keys: ReturnType<typeof getAdminPeopleQueryKeys>
) {
    await Promise.allSettled([
        queryClient.invalidateQueries({ exact: true, queryKey: keys.devices }),
        queryClient.invalidateQueries({ exact: true, queryKey: keys.sessions }),
        queryClient.invalidateQueries({ queryKey: keys.activityRoot }),
        queryClient.invalidateQueries({
            exact: true,
            queryKey: [ 'PtvAdminDashboard', serverKey, 'playback' ]
        }),
        queryClient.invalidateQueries({ queryKey: [ 'Devices' ] }),
        queryClient.invalidateQueries({ queryKey: [ 'Sessions' ] }),
        queryClient.invalidateQueries({ queryKey: [ 'ActivityLogEntries' ] })
    ]);
}

export function useAdminDevices(
    api?: Api,
    apiClient?: ApiClient,
    currentDeviceId?: string
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const enabled = Boolean(api && serverKey);
    const keys = useMemo(() => getAdminPeopleQueryKeys(serverKey), [serverKey]);
    const queryClient = useQueryClient();
    const removalControllersRef = useRef(new Set<AbortController>());
    const removalPreparationsRef = useRef(new Map<string, AdminDeviceRemovalSnapshot>());
    const preparationFlightsRef = useRef(new Map<string, Promise<AdminDeviceRemovalSnapshot>>());
    const removalFlightsRef = useRef(new Map<string, Promise<boolean>>());
    const refreshPromiseRef = useRef<Promise<void> | null>(null);
    const [ removalBusy, setRemovalBusy ] = useState(false);
    const [ removalError, setRemovalError ] = useState<string | null>(null);

    const registryQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminDeviceRegistry(api!, signal),
        queryKey: keys.devices,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 60_000
    });
    const sessionsQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminPeopleSessions(api!, signal),
        queryKey: keys.sessions,
        refetchInterval: () => getAdminPeopleVisibleRefreshInterval(
            ADMIN_PEOPLE_SESSIONS_REFRESH_INTERVAL_MS
        ),
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: ADMIN_PEOPLE_SESSIONS_REFRESH_INTERVAL_MS / 2
    });
    const usersQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminPeopleUsers(api!, signal),
        queryKey: keys.users,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 60_000
    });
    const usersMap = useMemo(
        () => createAdminPeopleUsersMap(usersQuery.isError ? undefined : usersQuery.data),
        [usersQuery.data, usersQuery.isError]
    );
    const devices = useMemo(() => normalizeAdminDevices(
        registryQuery.data,
        sessionsQuery.data,
        usersMap,
        {
            currentDeviceId: currentDeviceId || api?.deviceInfo?.id,
            sessionSourceState: !sessionsQuery.isError && sessionsQuery.data !== undefined ?
                'ready' : 'unavailable',
            userSourceState: !usersQuery.isError && usersQuery.data !== undefined ?
                'ready' : 'unavailable'
        }
    ), [
        api?.deviceInfo?.id,
        currentDeviceId,
        registryQuery.data,
        sessionsQuery.data,
        sessionsQuery.isError,
        usersMap,
        usersQuery.isError
    ]);
    const refetchRegistry = registryQuery.refetch;
    const refetchSessions = sessionsQuery.refetch;
    const refetchUsers = usersQuery.refetch;

    const refresh = useCallback(() => {
        if (!api || !serverKey) return Promise.resolve();
        if (refreshPromiseRef.current) return refreshPromiseRef.current;
        const promise = Promise.allSettled([
            refetchRegistry({ cancelRefetch: true }),
            refetchSessions({ cancelRefetch: true }),
            refetchUsers({ cancelRefetch: true })
        ]).then(() => undefined).finally(() => {
            refreshPromiseRef.current = null;
        });
        refreshPromiseRef.current = promise;
        return promise;
    }, [api, refetchRegistry, refetchSessions, refetchUsers, serverKey]);

    const prepareRemoval = useCallback((deviceId: string) => {
        if (!api || !serverKey) {
            return Promise.reject(new AdminPeopleServiceError(
                'devices-unavailable',
                'Devices are unavailable. No device was removed.'
            ));
        }
        const key = deviceId.trim().toLowerCase();
        const existing = preparationFlightsRef.current.get(key);
        if (existing) return existing;

        // eslint-disable-next-line compat/compat
        const controller = new AbortController();
        removalControllersRef.current.add(controller);
        setRemovalError(null);
        setRemovalBusy(true);
        const promise = prepareAdminDeviceRemoval(
            api,
            deviceId,
            currentDeviceId,
            controller.signal
        ).then(snapshot => {
            removalPreparationsRef.current.set(key, snapshot);
            return snapshot;
        }).catch(error => {
            setRemovalError(safeRemovalMessage(error));
            throw error;
        }).finally(() => {
            removalControllersRef.current.delete(controller);
            preparationFlightsRef.current.delete(key);
            setRemovalBusy(
                preparationFlightsRef.current.size > 0 || removalFlightsRef.current.size > 0
            );
        });
        preparationFlightsRef.current.set(key, promise);
        return promise;
    }, [api, currentDeviceId, serverKey]);

    const removeDevice = useCallback((deviceId: string) => {
        const key = deviceId.trim().toLowerCase();
        const existing = removalFlightsRef.current.get(key);
        if (existing) return existing;
        const confirmed = removalPreparationsRef.current.get(key);
        if (!api || !serverKey || !confirmed) {
            setRemovalError('Review the latest device state before removing this device.');
            return Promise.resolve(false);
        }

        // eslint-disable-next-line compat/compat
        const controller = new AbortController();
        removalControllersRef.current.add(controller);
        setRemovalError(null);
        setRemovalBusy(true);
        const promise = confirmAdminDeviceRemoval(
            api,
            confirmed,
            currentDeviceId,
            controller.signal
        ).then(async () => {
            removalPreparationsRef.current.delete(key);
            await invalidateAfterDeviceRemoval(queryClient, serverKey, keys);
            return true;
        }).catch(error => {
            if (error instanceof AdminPeopleServiceError && error.latestSnapshot) {
                removalPreparationsRef.current.set(key, error.latestSnapshot);
            }
            setRemovalError(safeRemovalMessage(error));
            return false;
        }).finally(() => {
            removalControllersRef.current.delete(controller);
            removalFlightsRef.current.delete(key);
            setRemovalBusy(
                preparationFlightsRef.current.size > 0 || removalFlightsRef.current.size > 0
            );
        });
        removalFlightsRef.current.set(key, promise);
        return promise;
    }, [api, currentDeviceId, keys, queryClient, serverKey]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                if (serverKey) void refetchSessions({ cancelRefetch: true });
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [refetchSessions, serverKey]);

    useEffect(() => () => {
        removalControllersRef.current.forEach(controller => {
            controller.abort();
        });
        removalControllersRef.current.clear();
    }, []);

    const initialLoading = registryQuery.isPending && !registryQuery.data;
    return {
        devices,
        initialLoading,
        prepareRemoval,
        refreshing: (
            registryQuery.isFetching || sessionsQuery.isFetching || usersQuery.isFetching
        ) && !initialLoading,
        refresh,
        registryError: registryQuery.isError,
        removalBusy,
        removalError,
        removeDevice,
        sessionsError: sessionsQuery.isError,
        usersError: usersQuery.isError
    } as const;
}

export function useAdminActivity(
    api: Api | undefined,
    apiClient: ApiClient | undefined,
    options: Readonly<{ pageIndex: number; view: AdminActivityView }>
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const enabled = Boolean(api && serverKey);
    const keys = useMemo(() => getAdminPeopleQueryKeys(serverKey, options), [
        options.pageIndex,
        options.view,
        serverKey
    ]);
    const refreshPromiseRef = useRef<Promise<void> | null>(null);
    const activityQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminActivityPage(
            api!,
            options.pageIndex,
            options.view,
            signal
        ),
        queryKey: keys.activity,
        refetchInterval: () => getAdminPeopleVisibleRefreshInterval(
            ADMIN_PEOPLE_ACTIVITY_REFRESH_INTERVAL_MS
        ),
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: ADMIN_PEOPLE_ACTIVITY_REFRESH_INTERVAL_MS / 2
    });
    const usersQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminPeopleUsers(api!, signal),
        queryKey: keys.users,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 60_000
    });
    const usersMap = useMemo(
        () => createAdminPeopleUsersMap(usersQuery.isError ? undefined : usersQuery.data),
        [usersQuery.data, usersQuery.isError]
    );
    const page = useMemo(() => normalizeAdminActivityPage(
        activityQuery.data,
        usersMap,
        {
            userSourceState: !usersQuery.isError && usersQuery.data !== undefined ?
                'ready' : 'unavailable'
        }
    ), [activityQuery.data, usersMap, usersQuery.isError]);
    const refetchActivity = activityQuery.refetch;
    const refetchUsers = usersQuery.refetch;
    const refresh = useCallback(() => {
        if (!api || !serverKey) return Promise.resolve();
        if (refreshPromiseRef.current) return refreshPromiseRef.current;
        const promise = Promise.allSettled([
            refetchActivity({ cancelRefetch: true }),
            refetchUsers({ cancelRefetch: true })
        ]).then(() => undefined).finally(() => {
            refreshPromiseRef.current = null;
        });
        refreshPromiseRef.current = promise;
        return promise;
    }, [api, refetchActivity, refetchUsers, serverKey]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                if (serverKey) void refetchActivity({ cancelRefetch: true });
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [refetchActivity, serverKey]);

    const initialLoading = activityQuery.isPending && !activityQuery.data;
    return {
        entries: page.items,
        error: activityQuery.isError,
        initialLoading,
        pageSize: getAdminActivityRequest(options.pageIndex, options.view).limit,
        refresh,
        refreshing: (activityQuery.isFetching || usersQuery.isFetching) && !initialLoading,
        startIndex: page.startIndex,
        totalCount: page.totalRecordCount,
        usersError: usersQuery.isError
    } as const;
}
