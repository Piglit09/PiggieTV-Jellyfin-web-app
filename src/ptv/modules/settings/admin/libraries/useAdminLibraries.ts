import type { Api } from '@jellyfin/sdk';
import type { VirtualFolderInfo } from '@jellyfin/sdk/lib/generated-client/models/virtual-folder-info';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ApiClient } from 'jellyfin-apiclient';

import { getResolvedAdminServerId } from '../adminServerIdentity';
import {
    getAdminLibraryLocations,
    isAdminLibraryRefreshActive,
    normalizeAdminLibraries,
    normalizeAdminLibraryDetail
} from './adminLibrariesAdapters';
import {
    AdminLibrariesServiceError,
    loadAdminLibraries,
    loadAdminLibraryOptionsInfo,
    loadAdminLibraryTasks,
    loadAdminLibraryTransition,
    resolveAdminLibrary
} from './adminLibrariesService';

const ADMIN_LIBRARIES_QUERY_SCOPE = 'PtvAdminLibraries';
export const ADMIN_LIBRARY_SCAN_OBSERVATION_MS = 20_000;
export const ADMIN_LIBRARY_SCAN_POLL_INTERVAL_MS = 1_500;

export function shouldPollAdminLibraryScan(
    folder: VirtualFolderInfo | undefined,
    observing: boolean,
    queryStatus: 'error' | 'pending' | 'success'
): boolean {
    if (queryStatus === 'error') return false;
    return observing || isAdminLibraryRefreshActive(folder);
}

export function getAdminLibrariesQueryKeys(
    serverKey: string | null,
    libraryId?: string,
    collectionType?: string,
    isNewLibrary = false
) {
    const scope = [ ADMIN_LIBRARIES_QUERY_SCOPE, serverKey ] as const;
    return {
        detail: [ ...scope, 'detail', (libraryId || '').trim().toLowerCase() ] as const,
        list: [ ...scope, 'virtual-folders', { includeLibraryOptions: true } ] as const,
        options: [
            ...scope,
            'available-options',
            (libraryId || 'new').trim().toLowerCase(),
            collectionType?.trim().toLowerCase() || 'mixed',
            { isNewLibrary }
        ] as const,
        transition: [ ...scope, 'transition' ] as const,
        tasks: [ ...scope, 'scan-task', { isHidden: false } ] as const
    };
}

async function invalidateAdminLibraryConsumers(
    queryClient: ReturnType<typeof useQueryClient>,
    serverKey: string
) {
    await Promise.allSettled([
        queryClient.invalidateQueries({ exact: true, queryKey: [ 'VirtualFolders' ] }),
        queryClient.invalidateQueries({
            exact: true,
            queryKey: [ 'PtvAdminDashboard', serverKey, 'libraries' ]
        }),
        queryClient.invalidateQueries({
            exact: true,
            queryKey: [ 'PtvAdminUsers', serverKey, 'libraries' ]
        }),
        queryClient.invalidateQueries({
            exact: true,
            queryKey: [ 'PtvAdminUsers', serverKey, 'creation-libraries' ]
        })
    ]);
}

export function useAdminLibraries(api?: Api, apiClient?: ApiClient) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const enabled = Boolean(api && serverKey);
    const queryClient = useQueryClient();
    const keys = getAdminLibrariesQueryKeys(serverKey);
    const transitionQuery = useQuery({
        enabled: Boolean(api && serverKey),
        queryKey: keys.transition,
        queryFn: ({ signal }) => loadAdminLibraryTransition(api!, signal),
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 0
    });
    const listQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminLibraries(api!, signal),
        queryKey: keys.list,
        retry: 1,
        staleTime: 30_000
    });
    const tasksQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminLibraryTasks(api!, signal),
        queryKey: keys.tasks,
        refetchInterval: 10_000,
        refetchIntervalInBackground: false,
        retry: 1,
        staleTime: 5_000
    });
    const libraries = useMemo(
        () => normalizeAdminLibraries(listQuery.data || []),
        [listQuery.data]
    );
    const refreshFlight = useRef<Promise<unknown> | null>(null);
    const refetchList = listQuery.refetch;
    const refetchTasks = tasksQuery.refetch;
    const refresh = useCallback(() => {
        if (!api || !serverKey) return Promise.resolve();
        if (refreshFlight.current) return refreshFlight.current;
        const promise = Promise.allSettled([
            refetchList({ cancelRefetch: true }),
            refetchTasks({ cancelRefetch: true }),
            transitionQuery.refetch({ cancelRefetch: true })
        ]).finally(() => {
            refreshFlight.current = null;
        });
        refreshFlight.current = promise;
        return promise;
    }, [api, refetchList, refetchTasks, serverKey, transitionQuery]);
    const invalidate = useCallback(async () => {
        if (!serverKey) return;
        await Promise.allSettled([
            queryClient.invalidateQueries({ queryKey: keys.list }),
            queryClient.invalidateQueries({ queryKey: keys.transition }),
            invalidateAdminLibraryConsumers(queryClient, serverKey)
        ]);
    }, [keys.list, keys.transition, queryClient, serverKey]);

    return {
        transition: transitionQuery.data,
        transitionError: transitionQuery.isError,
        refreshTransition: transitionQuery.refetch,
        globalScanTask: tasksQuery.data?.find(task => task.Key === 'RefreshLibrary') || null,
        isInitialLoading: listQuery.isPending && !listQuery.data,
        isRefreshing: listQuery.isFetching || tasksQuery.isFetching,
        invalidate,
        libraries,
        listError: listQuery.isError,
        refresh,
        scanStatusError: tasksQuery.isError
    } as const;
}

export function useAdminLibrary(
    api: Api | undefined,
    apiClient: ApiClient | undefined,
    libraryId: string
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const queryClient = useQueryClient();
    const keys = getAdminLibrariesQueryKeys(serverKey, libraryId);
    const transitionQuery = useQuery({
        enabled: Boolean(api && serverKey),
        queryKey: keys.transition,
        queryFn: ({ signal }) => loadAdminLibraryTransition(api!, signal),
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 0
    });
    const scanObservationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [ scanObservation, setScanObservation ] = useState(false);
    useEffect(() => () => {
        if (scanObservationTimer.current) globalThis.clearTimeout(scanObservationTimer.current);
    }, []);
    const detailQuery = useQuery({
        enabled: Boolean(api && serverKey && libraryId),
        queryFn: async ({ signal }) => {
            const libraries = await queryClient.fetchQuery({
                queryFn: ({ signal: listSignal }) => loadAdminLibraries(api!, listSignal || signal),
                queryKey: keys.list,
                staleTime: 0
            });
            return resolveAdminLibrary(libraries, libraryId);
        },
        queryKey: keys.detail,
        refetchInterval: query => shouldPollAdminLibraryScan(
            query.state.data,
            scanObservation,
            query.state.status
        ) ? ADMIN_LIBRARY_SCAN_POLL_INTERVAL_MS : false,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 0
    });
    const refetchDetail = detailQuery.refetch;
    const collectionType = detailQuery.data?.CollectionType || 'mixed';
    const hasAuthoritativeOptions = Boolean(detailQuery.data?.LibraryOptions);
    const optionsKeys = getAdminLibrariesQueryKeys(serverKey, libraryId, collectionType, false);
    const providerQuery = useQuery({
        enabled: Boolean(api && serverKey && libraryId && hasAuthoritativeOptions),
        queryFn: ({ signal }) => loadAdminLibraryOptionsInfo(api!, collectionType, false, signal),
        queryKey: optionsKeys.options,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 60_000
    });
    const providerOptions = providerQuery.isError ? null : providerQuery.data;
    const detailMissing = detailQuery.error instanceof AdminLibrariesServiceError
        && detailQuery.error.code === 'invalid-library';
    const cachedLibraries = queryClient.getQueryData<readonly VirtualFolderInfo[]>(keys.list) || [];
    const configuredLocations = useMemo(() => Array.from(new Set(
        cachedLibraries.flatMap(getAdminLibraryLocations)
    )), [cachedLibraries]);
    const detail = useMemo(() => detailQuery.data && !detailMissing ? normalizeAdminLibraryDetail(
        detailQuery.data,
        providerOptions
    ) : null, [detailMissing, detailQuery.data, providerOptions]);
    const invalidate = useCallback(async () => {
        if (!serverKey) return;
        await Promise.allSettled([
            queryClient.invalidateQueries({ queryKey: keys.list }),
            queryClient.invalidateQueries({ queryKey: keys.transition }),
            queryClient.invalidateQueries({ queryKey: keys.detail }),
            invalidateAdminLibraryConsumers(queryClient, serverKey)
        ]);
    }, [keys.detail, keys.list, keys.transition, queryClient, serverKey]);
    const removeCachedDetail = useCallback(() => {
        queryClient.removeQueries({ queryKey: keys.detail });
    }, [keys.detail, queryClient]);
    const adoptLibrary = useCallback(async (library: VirtualFolderInfo) => {
        if (!library.ItemId || library.ItemId.trim().toLowerCase() !== libraryId.trim().toLowerCase()) return;
        await Promise.allSettled([
            queryClient.cancelQueries({ exact: true, queryKey: keys.detail }),
            queryClient.cancelQueries({ exact: true, queryKey: keys.list })
        ]);
        queryClient.setQueryData(keys.detail, library);
        queryClient.setQueryData<readonly VirtualFolderInfo[]>(keys.list, current => {
            if (!current) return current;
            const id = library.ItemId?.trim().toLowerCase();
            return current.map(entry => (
                id && entry.ItemId?.trim().toLowerCase() === id ? library : entry
            ));
        });
        if (serverKey) await invalidateAdminLibraryConsumers(queryClient, serverKey);
    }, [keys.detail, keys.list, libraryId, queryClient, serverKey]);
    const beginScanObservation = useCallback(() => {
        if (!api || !serverKey || !libraryId) return;
        if (scanObservationTimer.current) globalThis.clearTimeout(scanObservationTimer.current);
        setScanObservation(true);
        scanObservationTimer.current = globalThis.setTimeout(() => {
            scanObservationTimer.current = null;
            setScanObservation(false);
        }, ADMIN_LIBRARY_SCAN_OBSERVATION_MS);
        void refetchDetail({ cancelRefetch: true });
    }, [api, libraryId, refetchDetail, serverKey]);

    return {
        transition: transitionQuery.data,
        transitionError: transitionQuery.isError,
        refreshTransition: transitionQuery.refetch,
        adoptLibrary,
        beginScanObservation,
        configuredLocations,
        detail,
        error: detailMissing || (detailQuery.isError && !detailQuery.data),
        invalidate,
        loading: detailQuery.isPending && !detailQuery.data,
        providerError: providerQuery.isError,
        providerLoading: hasAuthoritativeOptions && providerQuery.isPending && !providerQuery.data,
        providerOptions,
        refetch: detailQuery.refetch,
        refetchProviders: providerQuery.refetch,
        removeCachedDetail,
        scanStatusError: detailQuery.isError && Boolean(detailQuery.data) && !detailMissing
    } as const;
}

export function useAdminLibraryCreationOptions(
    api: Api | undefined,
    apiClient: ApiClient | undefined,
    collectionType: string,
    enabled: boolean
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const keys = getAdminLibrariesQueryKeys(serverKey, undefined, collectionType, true);
    return useQuery({
        enabled: Boolean(api && serverKey && enabled && collectionType),
        queryFn: ({ signal }) => loadAdminLibraryOptionsInfo(api!, collectionType, true, signal),
        queryKey: keys.options,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 60_000
    });
}
