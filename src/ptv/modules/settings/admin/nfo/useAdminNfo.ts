import type { Api } from '@jellyfin/sdk';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import { useCallback, useMemo } from 'react';

import { getResolvedAdminServerId } from '../adminServerIdentity';
import {
    getAdminConfigurationSaveResourceKey,
    throwIfAdminConfigurationSaveRetired,
    useAdminConfigurationSave
} from '../configuration/useAdminConfigurationSave';
import { preserveConfiguredAdminNfoUser } from './adminNfoAdapters';
import {
    AdminNfoServiceError,
    type AdminNfoSettings,
    type AdminNfoSnapshot
} from './adminNfoModel';
import {
    loadAdminNfo,
    loadAdminNfoUsers,
    NFO_CONFIGURATION_KEY,
    saveAdminNfo
} from './adminNfoService';

const ADMIN_NFO_QUERY_SCOPE = 'PtvAdminNfo';
const ADMIN_NFO_SAVE_TIMEOUT_MESSAGE =
    'NFO settings were not confirmed in time. Reload the latest values before trying again.';

function createAdminNfoTimeoutError(message: string) {
    return new AdminNfoServiceError('save-timeout', message);
}

export function getAdminNfoQueryKey(serverKey: string) {
    return [
        ADMIN_NFO_QUERY_SCOPE,
        serverKey,
        'named',
        NFO_CONFIGURATION_KEY
    ] as const;
}

export function getAdminNfoUsersQueryKey(serverKey: string) {
    return [
        ADMIN_NFO_QUERY_SCOPE,
        serverKey,
        'users'
    ] as const;
}

export function useAdminNfo(
    api?: Api,
    apiClient?: ApiClient,
    saveTimeoutMs?: number
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const queryClient = useQueryClient();
    const queryKey = useMemo(
        () => getAdminNfoQueryKey(serverKey || 'unresolved-server'),
        [ serverKey ]
    );
    const usersQueryKey = useMemo(
        () => getAdminNfoUsersQueryKey(serverKey || 'unresolved-server'),
        [ serverKey ]
    );
    const saveResourceKeys = useMemo(() => [
        getAdminConfigurationSaveResourceKey(
            serverKey || 'unresolved-server',
            `System/Configuration/${NFO_CONFIGURATION_KEY}`
        )
    ], [ serverKey ]);
    const query = useQuery({
        enabled: Boolean(api && serverKey),
        queryFn: ({ signal }) => loadAdminNfo(api!, signal),
        queryKey,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 60_000
    });
    const usersQuery = useQuery({
        enabled: Boolean(api && serverKey),
        queryFn: ({ signal }) => loadAdminNfoUsers(api!, signal),
        queryKey: usersQueryKey,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 60_000
    });
    const saveCoordinator = useAdminConfigurationSave<AdminNfoSnapshot>({
        createTimeoutError: createAdminNfoTimeoutError,
        resourceKeys: saveResourceKeys,
        timeoutMessage: ADMIN_NFO_SAVE_TIMEOUT_MESSAGE,
        timeoutMs: saveTimeoutMs
    });

    const save = useCallback((
        desiredSettings: AdminNfoSettings,
        confirmedSettings?: AdminNfoSettings
    ) => saveCoordinator.run(async signal => {
        if (!api || !serverKey) {
            throw new AdminNfoServiceError(
                'load-unavailable',
                'NFO settings could not be loaded.'
            );
        }
        await queryClient.cancelQueries({ exact: true, queryKey });
        throwIfAdminConfigurationSaveRetired(signal);
        const cached = queryClient.getQueryData<AdminNfoSnapshot>(queryKey);
        const baseline = confirmedSettings || cached?.settings;
        if (!baseline) {
            throw new AdminNfoServiceError(
                'load-unavailable',
                'NFO settings could not be loaded.'
            );
        }

        const saved = await saveCoordinator.runResourceOperation(
            signal,
            writeSignal => saveAdminNfo(
                api,
                desiredSettings,
                baseline,
                writeSignal
            )
        );
        throwIfAdminConfigurationSaveRetired(signal);
        queryClient.setQueryData(queryKey, saved);
        return saved;
    }), [
        api,
        queryClient,
        queryKey,
        saveCoordinator.run,
        saveCoordinator.runResourceOperation,
        serverKey
    ]);

    const refetch = useCallback(async () => {
        const currentSave = saveCoordinator.getCurrent();
        if (currentSave) return currentSave;
        const result = await query.refetch({ cancelRefetch: true });
        return result.isSuccess ? result.data : null;
    }, [ query.refetch, saveCoordinator.getCurrent ]);

    const refetchUsers = useCallback(async () => {
        const result = await usersQuery.refetch({ cancelRefetch: true });
        return result.isSuccess ? result.data : null;
    }, [ usersQuery.refetch ]);

    const reset = useCallback(() => (
        queryClient.getQueryData<AdminNfoSnapshot>(queryKey)?.settings || null
    ), [ queryClient, queryKey ]);

    const users = useMemo(() => preserveConfiguredAdminNfoUser(
        usersQuery.data || [],
        query.data?.settings.userId || null
    ), [ query.data?.settings.userId, usersQuery.data ]);

    return {
        error: query.error instanceof Error ? query.error : null,
        fetching: query.isFetching,
        loading: query.isPending && !query.data,
        refetch,
        refetchUsers,
        reset,
        save,
        saving: saveCoordinator.saving,
        settings: query.data?.settings || null,
        snapshot: query.data || null,
        users,
        usersError: usersQuery.error instanceof Error ? usersQuery.error : null,
        usersLoading: usersQuery.isPending && !usersQuery.data
    } as const;
}
