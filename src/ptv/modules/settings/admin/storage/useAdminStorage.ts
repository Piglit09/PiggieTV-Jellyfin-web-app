import type { Api } from '@jellyfin/sdk';
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';

import { getPtvAuthenticatedDisplayIdentityKey } from '../../../../services/displayIdentity';
import { getResolvedAdminServerId } from '../adminServerIdentity';

function connectionIdentity(address: unknown): string | null {
    if (typeof address !== 'string') return null;

    try {
        // eslint-disable-next-line compat/compat -- Jellyfin's supported browser targets all provide URL.
        const url = new URL(address);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
        let pathname = url.pathname;
        while (pathname.endsWith('/')) pathname = pathname.slice(0, -1);
        return `${url.origin}${pathname}`;
    } catch {
        return null;
    }
}

/** The legacy identity and SDK request transport must describe the same session. */
export function getAdminStorageAuthority(api?: Api, apiClient?: ApiClient) {
    const serverId = getResolvedAdminServerId(apiClient);
    const authenticatedIdentity = getPtvAuthenticatedDisplayIdentityKey(apiClient);
    try {
        const legacyConnection = connectionIdentity(apiClient?.serverAddress?.());
        const sdkConnection = connectionIdentity(api?.basePath);
        const legacyToken = apiClient?.accessToken?.();
        if (!serverId || !authenticatedIdentity || !legacyConnection || legacyConnection !== sdkConnection
            || !legacyToken || legacyToken !== api?.accessToken) return null;
        return { authenticatedIdentity, connection: legacyConnection, serverId };
    } catch {
        return null;
    }
}

export function getAdminStorageQueryOptions(api?: Api, apiClient?: ApiClient) {
    const authority = getAdminStorageAuthority(api, apiClient);
    return queryOptions({
        enabled: Boolean(authority),
        queryFn: async ({ signal }) => {
            if (!authority || !api) throw new Error('Administrator storage authority unavailable');
            const response = await getSystemApi(api!).getSystemStorage({ signal });
            return response.data;
        },
        queryKey: authority ?
            [ 'PtvAdminStorage', authority.serverId, authority.authenticatedIdentity, authority.connection, 'System/Info/Storage' ] as const :
            [ 'PtvAdminStorage', 'UNVERIFIED', 'System/Info/Storage' ] as const,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 60_000
    });
}

export function useAdminStorage(api?: Api, apiClient?: ApiClient) {
    return useQuery(getAdminStorageQueryOptions(api, apiClient));
}
