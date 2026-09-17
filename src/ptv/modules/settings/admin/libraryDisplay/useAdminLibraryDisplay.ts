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
import {
    AdminLibraryDisplayServiceError,
    type AdminLibraryDisplaySettings,
    type AdminLibraryDisplaySnapshot
} from './adminLibraryDisplayModel';
import {
    loadAdminLibraryDisplay,
    saveAdminLibraryDisplay
} from './adminLibraryDisplayService';

const ADMIN_LIBRARY_DISPLAY_QUERY_SCOPE = 'PtvAdminLibraryDisplay';
const ADMIN_LIBRARY_DISPLAY_SAVE_TIMEOUT_MESSAGE =
    'Library Display settings were not confirmed in time. Reload the latest values before trying again.';

function createAdminLibraryDisplayTimeoutError(message: string) {
    return new AdminLibraryDisplayServiceError('save-timeout', message);
}

export function getAdminLibraryDisplayQueryKey(serverKey: string) {
    return [
        ADMIN_LIBRARY_DISPLAY_QUERY_SCOPE,
        serverKey,
        'composite',
        { general: 'System/Configuration', named: 'metadata' }
    ] as const;
}

export function useAdminLibraryDisplay(
    api?: Api,
    apiClient?: ApiClient,
    saveTimeoutMs?: number
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const queryKey = useMemo(
        () => getAdminLibraryDisplayQueryKey(serverKey || 'unresolved-server'),
        [ serverKey ]
    );
    const saveResourceKeys = useMemo(() => {
        const resolvedServerKey = serverKey || 'unresolved-server';
        return [
            getAdminConfigurationSaveResourceKey(
                resolvedServerKey,
                'System/Configuration'
            ),
            getAdminConfigurationSaveResourceKey(
                resolvedServerKey,
                'System/Configuration/metadata'
            )
        ];
    }, [ serverKey ]);
    const queryClient = useQueryClient();
    const query = useQuery({
        enabled: Boolean(api && serverKey),
        queryFn: ({ signal }) => loadAdminLibraryDisplay(api!, signal),
        queryKey,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 60_000
    });
    const saveCoordinator = useAdminConfigurationSave<AdminLibraryDisplaySnapshot>({
        createTimeoutError: createAdminLibraryDisplayTimeoutError,
        resourceKeys: saveResourceKeys,
        timeoutMessage: ADMIN_LIBRARY_DISPLAY_SAVE_TIMEOUT_MESSAGE,
        timeoutMs: saveTimeoutMs
    });

    const save = useCallback((
        desiredSettings: AdminLibraryDisplaySettings,
        confirmedSettings?: AdminLibraryDisplaySettings
    ) => saveCoordinator.run(async signal => {
        if (!api || !serverKey) {
            throw new AdminLibraryDisplayServiceError(
                'load-unavailable',
                'Library display settings could not be loaded.'
            );
        }
        await queryClient.cancelQueries({ exact: true, queryKey });
        throwIfAdminConfigurationSaveRetired(signal);
        const cached = queryClient.getQueryData<AdminLibraryDisplaySnapshot>(queryKey);
        const baseline = confirmedSettings || cached?.settings;
        if (!baseline) {
            throw new AdminLibraryDisplayServiceError(
                'load-unavailable',
                'Library display settings could not be loaded.'
            );
        }

        const saved = await saveCoordinator.runResourceOperation(
            signal,
            writeSignal => saveAdminLibraryDisplay(
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

    const reset = useCallback(() => (
        queryClient.getQueryData<AdminLibraryDisplaySnapshot>(queryKey)?.settings || null
    ), [ queryClient, queryKey ]);

    return {
        error: query.error instanceof Error ? query.error : null,
        fetching: query.isFetching,
        loading: query.isPending && !query.data,
        refetch,
        reset,
        save,
        saving: saveCoordinator.saving,
        settings: query.data?.settings || null,
        snapshot: query.data || null
    } as const;
}
