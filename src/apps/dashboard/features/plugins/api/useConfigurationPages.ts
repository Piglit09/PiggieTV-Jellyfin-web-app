import type { Api } from '@jellyfin/sdk';
import type { DashboardApiGetConfigurationPagesRequest } from '@jellyfin/sdk/lib/generated-client/api/dashboard-api';
import { getDashboardApi } from '@jellyfin/sdk/lib/utils/api/dashboard-api';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';

import { useApi } from 'hooks/useApi';
import { usePtvAuthenticatedIdentity } from 'ptv/api/usePtvAuthenticatedIdentity';

import { getConfigurationPagesQueryKey } from './queryKey';

const fetchConfigurationPages = async (
    api: Api,
    params?: DashboardApiGetConfigurationPagesRequest,
    options?: AxiosRequestConfig
) => {
    const response = await getDashboardApi(api)
        .getConfigurationPages(params, options);
    return response.data;
};

const getConfigurationPagesQuery = (
    api?: Api,
    serverId = '',
    params?: DashboardApiGetConfigurationPagesRequest
) => queryOptions({
    queryKey: getConfigurationPagesQueryKey(serverId, params?.enableInMainMenu),
    queryFn: ({ signal }) => fetchConfigurationPages(api!, params, { signal }),
    enabled: Boolean(api && serverId)
});

export const useConfigurationPages = (
    params?: DashboardApiGetConfigurationPagesRequest
) => {
    const { api } = useApi();
    const { serverId } = usePtvAuthenticatedIdentity();
    return useQuery(getConfigurationPagesQuery(api, serverId, params));
};
