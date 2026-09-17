import { getLiveTvApi } from '@jellyfin/sdk/lib/utils/api/live-tv-api';
import { useQuery } from '@tanstack/react-query';
import { useConfigurationPages } from 'apps/dashboard/features/plugins/api/useConfigurationPages';
import { useMemo } from 'react';

import { useApi } from '../../../../hooks/useApi';
import { usePtvAuthenticatedIdentity } from '../../../api/usePtvAuthenticatedIdentity';

import {
    createDynamicPluginDestinations,
    createPtvAdminNavigationGroups,
    getAdminLiveTvQueryKey
} from './adminNavigation';

export function usePtvAdminNavigation() {
    const { api } = useApi();
    const { serverId } = usePtvAuthenticatedIdentity();
    const configurationPages = useConfigurationPages({ enableInMainMenu: true });
    const liveTvInfo = useQuery({
        enabled: Boolean(api && serverId),
        queryFn: async ({ signal }) => {
            const response = await getLiveTvApi(api!).getLiveTvInfo({ signal });
            return response.data;
        },
        queryKey: getAdminLiveTvQueryKey(serverId),
        staleTime: 5 * 60_000
    });
    const dynamicPluginDestinations = useMemo(
        () => createDynamicPluginDestinations(configurationPages.data),
        [configurationPages.data]
    );
    const groups = useMemo(
        () => createPtvAdminNavigationGroups(dynamicPluginDestinations, liveTvInfo.data?.IsEnabled),
        [dynamicPluginDestinations, liveTvInfo.data?.IsEnabled]
    );

    return {
        dynamicPluginDestinations,
        groups,
        isLiveTvAvailable: liveTvInfo.data?.IsEnabled,
        isPluginNavigationError: configurationPages.isError,
        isPluginNavigationPending: configurationPages.isPending,
        retryPluginNavigation: configurationPages.refetch
    };
}
