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
    normalizeAdminMetadataCountries,
    normalizeAdminMetadataLanguages
} from './adminMetadataAdapters';
import {
    AdminMetadataServiceError,
    type AdminMetadataSettings,
    type AdminMetadataSnapshot
} from './adminMetadataModel';
import {
    loadAdminMetadataConfiguration,
    loadAdminMetadataCountries,
    loadAdminMetadataCultures,
    saveAdminMetadata
} from './adminMetadataService';

const ADMIN_METADATA_QUERY_SCOPE = 'PtvAdminMetadata';
const ADMIN_METADATA_SAVE_TIMEOUT_MESSAGE =
    'Metadata settings were not confirmed in time. Reload the latest values before trying again.';

function createAdminMetadataTimeoutError(message: string) {
    return new AdminMetadataServiceError('save-timeout', message);
}

export function getAdminMetadataQueryKeys(serverKey: string) {
    const scope = [ ADMIN_METADATA_QUERY_SCOPE, serverKey ] as const;
    return {
        configuration: [ ...scope, 'configuration', 'System/Configuration' ] as const,
        countries: [ ...scope, 'catalog', 'Localization/Countries' ] as const,
        cultures: [ ...scope, 'catalog', 'Localization/Cultures' ] as const
    };
}

export function useAdminMetadata(
    api?: Api,
    apiClient?: ApiClient,
    saveTimeoutMs?: number
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const keys = useMemo(
        () => getAdminMetadataQueryKeys(serverKey || 'unresolved-server'),
        [ serverKey ]
    );
    const saveResourceKeys = useMemo(() => [
        getAdminConfigurationSaveResourceKey(
            serverKey || 'unresolved-server',
            'System/Configuration'
        )
    ], [ serverKey ]);
    const queryClient = useQueryClient();
    const enabled = Boolean(api && serverKey);
    const configurationQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminMetadataConfiguration(api!, signal),
        queryKey: keys.configuration,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 60_000
    });
    const culturesQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminMetadataCultures(api!, signal),
        queryKey: keys.cultures,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 60_000
    });
    const countriesQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminMetadataCountries(api!, signal),
        queryKey: keys.countries,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 60_000
    });
    const saveCoordinator = useAdminConfigurationSave<AdminMetadataSnapshot>({
        createTimeoutError: createAdminMetadataTimeoutError,
        resourceKeys: saveResourceKeys,
        timeoutMessage: ADMIN_METADATA_SAVE_TIMEOUT_MESSAGE,
        timeoutMs: saveTimeoutMs
    });
    const settings = configurationQuery.data?.settings || null;
    const languageOptions = useMemo(() => settings ? normalizeAdminMetadataLanguages(
        culturesQuery.data || [],
        settings.preferredLanguage
    ) : [], [ culturesQuery.data, settings ]);
    const countryOptions = useMemo(() => settings ? normalizeAdminMetadataCountries(
        countriesQuery.data || [],
        settings.preferredCountryCode
    ) : [], [ countriesQuery.data, settings ]);

    const save = useCallback((
        desiredSettings: AdminMetadataSettings,
        confirmedSettings?: AdminMetadataSettings
    ) => saveCoordinator.run(async signal => {
        if (!api || !serverKey) {
            throw new AdminMetadataServiceError(
                'load-unavailable',
                'Metadata settings could not be loaded.'
            );
        }
        await queryClient.cancelQueries({
            exact: true,
            queryKey: keys.configuration
        });
        throwIfAdminConfigurationSaveRetired(signal);
        const cached = queryClient.getQueryData<AdminMetadataSnapshot>(keys.configuration);
        const baseline = confirmedSettings || cached?.settings;
        if (!baseline) {
            throw new AdminMetadataServiceError(
                'load-unavailable',
                'Metadata settings could not be loaded.'
            );
        }
        const saved = await saveCoordinator.runResourceOperation(
            signal,
            writeSignal => saveAdminMetadata(
                api,
                desiredSettings,
                baseline,
                writeSignal
            )
        );
        throwIfAdminConfigurationSaveRetired(signal);
        queryClient.setQueryData(keys.configuration, saved);
        return saved;
    }), [
        api,
        keys.configuration,
        queryClient,
        saveCoordinator.run,
        saveCoordinator.runResourceOperation,
        serverKey
    ]);

    const refetch = useCallback(async () => {
        const currentSave = saveCoordinator.getCurrent();
        if (currentSave) return currentSave;
        const result = await configurationQuery.refetch({ cancelRefetch: true });
        return result.isSuccess ? result.data : null;
    }, [ configurationQuery.refetch, saveCoordinator.getCurrent ]);
    const refetchLanguages = useCallback(
        () => culturesQuery.refetch({ cancelRefetch: true }),
        [ culturesQuery.refetch ]
    );
    const refetchCountries = useCallback(
        () => countriesQuery.refetch({ cancelRefetch: true }),
        [ countriesQuery.refetch ]
    );
    const reset = useCallback(() => (
        queryClient.getQueryData<AdminMetadataSnapshot>(keys.configuration)?.settings || null
    ), [ keys.configuration, queryClient ]);

    return {
        countries: countryOptions,
        countriesError: countriesQuery.error instanceof Error ? countriesQuery.error : null,
        countriesLoading: countriesQuery.isPending && !countriesQuery.data,
        error: configurationQuery.error instanceof Error ? configurationQuery.error : null,
        fetching: configurationQuery.isFetching,
        languages: languageOptions,
        languagesError: culturesQuery.error instanceof Error ? culturesQuery.error : null,
        languagesLoading: culturesQuery.isPending && !culturesQuery.data,
        loading: configurationQuery.isPending && !configurationQuery.data,
        refetch,
        refetchCountries,
        refetchLanguages,
        reset,
        save,
        saving: saveCoordinator.saving,
        settings,
        snapshot: configurationQuery.data || null
    } as const;
}
