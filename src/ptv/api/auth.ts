import {
    getPtvCurrentUserId,
    requestPtvJson
} from './client';
import type { PtvUser } from './types';

export function isPtvAuthenticated(serverId?: string | null): boolean {
    return Boolean(getPtvCurrentUserId(serverId));
}

export function getPtvCurrentUser(serverId?: string | null): Promise<PtvUser | null> {
    const userId = getPtvCurrentUserId(serverId);

    if (!userId) {
        return Promise.resolve(null);
    }

    return requestPtvJson<PtvUser>(`Users/${userId}`, { serverId });
}

export function requirePtvCurrentUser(serverId?: string | null): Promise<PtvUser> {
    return getPtvCurrentUser(serverId).then(user => {
        if (!user?.Id) {
            throw new Error('A signed-in Jellyfin user is required.');
        }

        return user;
    });
}

export function isPtvAdminUser(user?: PtvUser | null): boolean {
    return Boolean(user?.Policy?.IsAdministrator);
}

export function requirePtvAdminUser(serverId?: string | null): Promise<PtvUser> {
    return requirePtvCurrentUser(serverId).then(user => {
        if (!isPtvAdminUser(user)) {
            throw new Error('A Jellyfin administrator account is required.');
        }

        return user;
    });
}

