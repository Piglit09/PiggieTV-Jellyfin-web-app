import { useMemo } from 'react';

import { useApi } from '../../hooks/useApi';

import {
    getPtvCurrentUserId,
    getPtvServerId
} from './client';

export type PtvAuthenticatedIdentity = Readonly<{
    identityKey: string;
    serverId: string;
    status: 'ready' | 'restoring';
    userId: string;
}>;

/**
 * Projects the existing Jellyfin ApiProvider lifecycle into a stable PTV
 * identity. It observes ownership only; ApiProvider remains authoritative for
 * client creation, authentication restoration, and sign-in/out events.
 */
export function usePtvAuthenticatedIdentity(): PtvAuthenticatedIdentity {
    const { __legacyApiClient__: apiClient, user } = useApi();
    const serverId = apiClient?.serverId?.() || user?.ServerId || getPtvServerId();
    const userId = user?.Id || apiClient?.getCurrentUserId?.() || getPtvCurrentUserId(serverId);

    return useMemo(() => ({
        identityKey: serverId && userId ? `${serverId}\u001f${userId}` : '',
        serverId,
        status: serverId && userId ? 'ready' : 'restoring',
        userId
    }), [serverId, userId]);
}
