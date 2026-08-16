import type { Api } from '@jellyfin/sdk';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import { useCallback, useMemo, useRef, useState } from 'react';

import { getResolvedAdminServerId } from '../adminServerIdentity';
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

export function getAdminMetadataQueryKeys(serverKey: string) {
    const scope = [ ADMIN_METADATA_QUERY_SCOPE, serverKey ] as const;
    return {
        configuration: [ ...scope, 'configuration', 'System/Configuration' ] as const,
        countries: [ ...scope, 'catalog', 'Localization/Countries' ] as const,
        cultures: [ ...scope, 'catalog', 'Localization/Cultures' ] as const
    };
}

export function useAdminMetadata(api?: Api, apiClient?: ApiClient) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const keys = useMemo(
        () => getAdminMetadataQueryKeys(serverKey || 'unresolved-server'),
        [ serverKey ]
    );
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
    const savePromiseRef = useRef<Promise<AdminMetadataSnapshot> | null>(null);
    const [ saving, setSaving ] = useState(false);
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
    ) => {
        if (savePromiseRef.current) return savePromiseRef.current;
        const promise = (async () => {
            if (!api || !serverKey) {
                throw new AdminMetadataServiceError(
                    'load-unavailable',
                    'Metadata settings could not be loaded.'
                );
            }
            setSaving(true);
            await queryClient.cancelQueries({
                exact: true,
                queryKey: keys.configuration
            });
            const cached = queryClient.getQueryData<AdminMetadataSnapshot>(keys.configuration);
            const baseline = confirmedSettings || cached?.settings;
            if (!baseline) {
                throw new AdminMetadataServiceError(
                    'load-unavailable',
                    'Metadata settings could not be loaded.'
                );
            }
            const saved = await saveAdminMetadata(api, desiredSettings, baseline);
            queryClient.setQueryData(keys.configuration, saved);
            return saved;
        })().finally(() => {
            savePromiseRef.current = null;
            setSaving(false);
        });
        savePromiseRef.current = promise;
        return promise;
    }, [ api, keys.configuration, queryClient, serverKey ]);

    const refetch = useCallback(async () => {
        if (savePromiseRef.current) return savePromiseRef.current;
        const result = await configurationQuery.refetch({ cancelRefetch: true });
        return result.isSuccess ? result.data : null;
    }, [ configurationQuery.refetch ]);
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
        saving,
        settings,
        snapshot: configurationQuery.data || null
    } as const;
}
