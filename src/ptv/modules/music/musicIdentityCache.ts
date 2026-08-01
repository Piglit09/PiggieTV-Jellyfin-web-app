type PtvMusicIdentityCacheEntry<TValue> = Readonly<{
    identityKey: string;
    resourceKey: string;
    value: TValue;
}>;

export class PtvMusicIdentityResourceCache<TValue> {
    private readonly entries = new Map<string, PtvMusicIdentityCacheEntry<TValue>>();
    private readonly maxEntries: number;

    constructor(maxEntries: number) {
        this.maxEntries = Math.max(1, Math.floor(maxEntries));
    }

    get size() {
        return this.entries.size;
    }

    clear() {
        this.entries.clear();
    }

    get(identityKey: string | null, resourceKey: string): TValue | undefined {
        const cacheKey = this.getCacheKey(identityKey, resourceKey);

        if (!cacheKey) return undefined;

        const entry = this.entries.get(cacheKey);

        if (!entry) return undefined;

        this.entries.delete(cacheKey);
        this.entries.set(cacheKey, entry);

        return entry.value;
    }

    has(identityKey: string | null, resourceKey: string) {
        return this.get(identityKey, resourceKey) !== undefined;
    }

    set(identityKey: string | null, resourceKey: string, value: TValue) {
        const cacheKey = this.getCacheKey(identityKey, resourceKey);

        if (!cacheKey || !identityKey) return false;

        this.entries.delete(cacheKey);
        this.entries.set(cacheKey, {
            identityKey,
            resourceKey,
            value
        });

        while (this.entries.size > this.maxEntries) {
            const oldestKey = this.entries.keys().next().value;

            if (typeof oldestKey !== 'string') break;
            this.entries.delete(oldestKey);
        }

        return true;
    }

    valuesForIdentity(identityKey: string | null, limit = this.maxEntries) {
        if (!identityKey) return [];

        const safeLimit = Math.max(0, Math.floor(limit));

        if (!safeLimit) return [];

        return Array.from(this.entries.values())
            .filter(entry => entry.identityKey === identityKey)
            .slice(-safeLimit)
            .map(entry => entry.value);
    }

    private getCacheKey(identityKey: string | null, resourceKey: string) {
        if (!identityKey || !resourceKey) return null;

        return JSON.stringify([ identityKey, resourceKey ]);
    }
}
