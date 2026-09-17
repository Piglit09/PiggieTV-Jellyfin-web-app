import type { ApiClient } from 'jellyfin-apiclient';

/**
 * Returns the authenticated Jellyfin server identity used to isolate all PTV
 * administration queries and actions. Administration must fail closed until a
 * concrete server id is available; a shared fallback would mix server caches.
 */
export function getResolvedAdminServerId(apiClient?: ApiClient | null): string | null {
    try {
        const serverId = apiClient?.serverId?.();
        return typeof serverId === 'string' && serverId.trim() ? serverId.trim() : null;
    } catch {
        return null;
    }
}
