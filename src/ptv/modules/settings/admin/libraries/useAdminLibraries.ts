import type { Api } from '@jellyfin/sdk';
import type { VirtualFolderInfo } from '@jellyfin/sdk/lib/generated-client/models/virtual-folder-info';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';

import type { ApiClient } from 'jellyfin-apiclient';

import { getResolvedAdminServerId } from '../adminServerIdentity';
import {
    normalizeAdminLibraries,
    normalizeAdminLibraryDetail
} from './adminLibrariesAdapters';
import {
    loadAdminLibraries,
    loadAdminLibraryOptionsInfo,
    loadAdminLibraryTasks,
    resolveAdminLibrary
} from './adminLibrariesService';

const ADMIN_LIBRARIES_QUERY_SCOPE = 'PtvAdminLibraries';

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
    const libraries = useMemo(() => normalizeAdminLibraries(
        listQuery.data || [],
        tasksQuery.data || [],
        !tasksQuery.isError
    ), [listQuery.data, tasksQuery.data, tasksQuery.isError]);
    const refreshFlight = useRef<Promise<unknown> | null>(null);
    const refetchList = listQuery.refetch;
    const refetchTasks = tasksQuery.refetch;
    const refresh = useCallback(() => {
        if (!api || !serverKey) return Promise.resolve();
        if (refreshFlight.current) return refreshFlight.current;
        const promise = Promise.allSettled([
            refetchList({ cancelRefetch: true }),
            refetchTasks({ cancelRefetch: true })
        ]).finally(() => {
            refreshFlight.current = null;
        });
        refreshFlight.current = promise;
        return promise;
    }, [api, refetchList, refetchTasks, serverKey]);
    const invalidate = useCallback(async () => {
        if (!serverKey) return;
        await Promise.allSettled([
            queryClient.invalidateQueries({ queryKey: keys.list }),
            invalidateAdminLibraryConsumers(queryClient, serverKey)
        ]);
    }, [keys.list, queryClient, serverKey]);

    return {
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
    const detailQuery = useQuery({
        enabled: Boolean(api && serverKey && libraryId),
        queryFn: async ({ signal }) => {
            const libraries = await queryClient.fetchQuery({
                queryFn: ({ signal: listSignal }) => loadAdminLibraries(api!, listSignal || signal),
                queryKey: keys.list,
                staleTime: 30_000
            });
            return resolveAdminLibrary(libraries, libraryId);
        },
        queryKey: keys.detail,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 20_000
    });
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
    const tasksQuery = useQuery({
        enabled: Boolean(api && serverKey && libraryId),
        queryFn: ({ signal }) => loadAdminLibraryTasks(api!, signal),
        queryKey: keys.tasks,
        refetchInterval: 10_000,
        refetchIntervalInBackground: false,
        retry: 1,
        staleTime: 5_000
    });
    const providerOptions = providerQuery.isError ? null : providerQuery.data;
    const detail = useMemo(() => detailQuery.data ? normalizeAdminLibraryDetail(
        detailQuery.data,
        providerOptions,
        tasksQuery.data?.find(task => task.Key === 'RefreshLibrary'),
        !tasksQuery.isError
    ) : null, [detailQuery.data, providerOptions, tasksQuery.data, tasksQuery.isError]);
    const invalidate = useCallback(async () => {
        if (!serverKey) return;
        await Promise.allSettled([
            queryClient.invalidateQueries({ queryKey: keys.list }),
            queryClient.invalidateQueries({ queryKey: keys.detail }),
            invalidateAdminLibraryConsumers(queryClient, serverKey)
        ]);
    }, [keys.detail, keys.list, queryClient, serverKey]);
    const removeCachedDetail = useCallback(() => {
        queryClient.removeQueries({ queryKey: keys.detail });
    }, [keys.detail, queryClient]);
    const adoptLibrary = useCallback(async (library: VirtualFolderInfo) => {
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
    }, [keys.detail, keys.list, queryClient, serverKey]);

    return {
        adoptLibrary,
        detail,
        error: detailQuery.isError,
        invalidate,
        loading: detailQuery.isPending && !detailQuery.data,
        providerError: providerQuery.isError,
        providerLoading: hasAuthoritativeOptions && providerQuery.isPending && !providerQuery.data,
        providerOptions,
        refetch: detailQuery.refetch,
        refetchProviders: providerQuery.refetch,
        removeCachedDetail,
        scanStatusError: tasksQuery.isError
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
