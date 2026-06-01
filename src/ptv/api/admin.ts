import {
    getPtvApiClient,
    requestPtvJson
} from './client';
import { requirePtvAdminUser } from './auth';
import type {
    PtvItemsResult,
    PtvLibrary,
    PtvUser
} from './types';

export function getPtvUsers<TUser = PtvUser>(options: {
    requireAdmin?: boolean;
    serverId?: string | null;
} = {}): Promise<TUser[]> {
    const loadUsers = () => {
        const apiClient = getPtvApiClient(options.serverId);

        if (typeof apiClient?.getUsers === 'function') {
            return apiClient.getUsers<TUser>();
        }

        return requestPtvJson<TUser[]>('Users', {
            serverId: options.serverId
        });
    };

    if (options.requireAdmin !== false) {
        return requirePtvAdminUser(options.serverId).then(loadUsers);
    }

    return loadUsers();
}

export function getPtvPublicUsers<TUser = PtvUser>(options: {
    serverId?: string | null;
} = {}): Promise<TUser[]> {
    const apiClient = getPtvApiClient(options.serverId);

    if (typeof apiClient?.getPublicUsers === 'function') {
        return apiClient.getPublicUsers<TUser>();
    }

    return requestPtvJson<TUser[]>('Users/Public', {
        serverId: options.serverId
    });
}

export function getPtvAdminLibraries(options: {
    requireAdmin?: boolean;
    serverId?: string | null;
} = {}): Promise<PtvItemsResult<PtvLibrary>> {
    const loadLibraries = () => requestPtvJson<PtvItemsResult<PtvLibrary>>('Library/MediaFolders', {
        params: {
            IsHidden: false
        },
        serverId: options.serverId
    });

    if (options.requireAdmin !== false) {
        return requirePtvAdminUser(options.serverId).then(loadLibraries);
    }

    return loadLibraries();
}

