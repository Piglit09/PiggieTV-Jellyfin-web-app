export function normalizePtvDisplayIdentityPart(value: unknown): string {
    return String(value || '').trim().toLocaleLowerCase();
}

export function getPtvDisplayIdentityKey(
    serverId: unknown,
    userId: unknown
): string | null {
    const normalizedServerId = normalizePtvDisplayIdentityPart(serverId);
    const normalizedUserId = normalizePtvDisplayIdentityPart(userId);

    if (!normalizedServerId || !normalizedUserId) return null;

    return `${encodeURIComponent(normalizedServerId)}:${encodeURIComponent(normalizedUserId)}`;
}

export type PtvAuthenticatedIdentityClient = {
    getCurrentUserId?: () => unknown;
    serverId?: () => unknown;
    serverInfo?: () => { Id?: unknown } | null | undefined;
};

/**
 * Resolves the single canonical authenticated display identity shared by
 * user-scoped caches and request coordination. Conflicting server identity
 * observations fail closed instead of selecting one source heuristically.
 */
export function getPtvAuthenticatedDisplayIdentityKey(
    apiClient: PtvAuthenticatedIdentityClient | null | undefined
): string | null {
    if (!apiClient) return null;

    try {
        const serverIds = [
            apiClient.serverId?.(),
            apiClient.serverInfo?.()?.Id
        ]
            .map(normalizePtvDisplayIdentityPart)
            .filter(Boolean);
        const uniqueServerIds = new Set(serverIds);
        const userId = normalizePtvDisplayIdentityPart(apiClient.getCurrentUserId?.());

        if (uniqueServerIds.size !== 1 || !userId) return null;

        return getPtvDisplayIdentityKey(serverIds[0], userId);
    } catch {
        return null;
    }
}

export class PtvIdentityScopedCache<TValue> {
    private readonly entries = new Map<string, TValue>();
    private readonly maxEntries: number;

    constructor(maxEntries = 4) {
        this.maxEntries = Math.max(1, Math.floor(maxEntries));
    }

    get(serverId: unknown, userId: unknown): TValue | undefined {
        const key = getPtvDisplayIdentityKey(serverId, userId);

        if (!key) return undefined;

        const value = this.entries.get(key);

        if (value !== undefined) {
            this.entries.delete(key);
            this.entries.set(key, value);
        }

        return value;
    }

    set(serverId: unknown, userId: unknown, value: TValue): boolean {
        const key = getPtvDisplayIdentityKey(serverId, userId);

        if (!key) return false;

        this.entries.delete(key);
        this.entries.set(key, value);

        while (this.entries.size > this.maxEntries) {
            const oldestKey = this.entries.keys().next().value;

            if (oldestKey === undefined) break;
            this.entries.delete(oldestKey);
        }

        return true;
    }

    delete(serverId: unknown, userId: unknown): boolean {
        const key = getPtvDisplayIdentityKey(serverId, userId);
        return key ? this.entries.delete(key) : false;
    }

    clear(): void {
        this.entries.clear();
    }

    get size() {
        return this.entries.size;
    }
}
