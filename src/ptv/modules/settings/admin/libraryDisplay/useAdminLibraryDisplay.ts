import type { Api } from '@jellyfin/sdk';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import { useCallback, useRef, useState } from 'react';

import { getResolvedAdminServerId } from '../adminServerIdentity';
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

export function getAdminLibraryDisplayQueryKey(serverKey: string) {
    return [
        ADMIN_LIBRARY_DISPLAY_QUERY_SCOPE,
        serverKey,
        'composite',
        { general: 'System/Configuration', named: 'metadata' }
    ] as const;
}

export function useAdminLibraryDisplay(api?: Api, apiClient?: ApiClient) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const queryKey = getAdminLibraryDisplayQueryKey(serverKey || 'unresolved-server');
    const queryClient = useQueryClient();
    const query = useQuery({
        enabled: Boolean(api && serverKey),
        queryFn: ({ signal }) => loadAdminLibraryDisplay(api!, signal),
        queryKey,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 60_000
    });
    const savePromiseRef = useRef<Promise<AdminLibraryDisplaySnapshot> | null>(null);
    const [ saving, setSaving ] = useState(false);

    const save = useCallback((
        desiredSettings: AdminLibraryDisplaySettings,
        confirmedSettings?: AdminLibraryDisplaySettings
    ) => {
        if (savePromiseRef.current) return savePromiseRef.current;

        const promise = (async () => {
            if (!api || !serverKey) {
                throw new AdminLibraryDisplayServiceError(
                    'load-unavailable',
                    'Library display settings could not be loaded.'
                );
            }
            setSaving(true);
            await queryClient.cancelQueries({ exact: true, queryKey });
            const cached = queryClient.getQueryData<AdminLibraryDisplaySnapshot>(queryKey);
            const baseline = confirmedSettings || cached?.settings;
            if (!baseline) {
                throw new AdminLibraryDisplayServiceError(
                    'load-unavailable',
                    'Library display settings could not be loaded.'
                );
            }

            const saved = await saveAdminLibraryDisplay(
                api,
                desiredSettings,
                baseline
            );
            queryClient.setQueryData(queryKey, saved);
            return saved;
        })().finally(() => {
            savePromiseRef.current = null;
            setSaving(false);
        });
        savePromiseRef.current = promise;
        return promise;
    }, [ api, queryClient, queryKey, serverKey ]);

    const refetch = useCallback(async () => {
        if (savePromiseRef.current) return savePromiseRef.current;
        const result = await query.refetch({ cancelRefetch: true });
        return result.isSuccess ? result.data : null;
    }, [ query.refetch ]);

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
        saving,
        settings: query.data?.settings || null,
        snapshot: query.data || null
    } as const;
}
