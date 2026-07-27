import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: vi.fn(() => null)
    }
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    recordPtvPluginApiRetryState: vi.fn(),
    registerPtvDebugCacheStatusProvider: vi.fn(),
    timePtvAsync: (_category: string, _name: string, task: () => Promise<unknown>) => task()
}));

vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: vi.fn(() => null),
    normalizePtvApiError: vi.fn((error: unknown) => ({
        message: error instanceof Error ? error.message : 'Unknown plugin API error'
    })),
    recordPtvPluginApiRetryState: vi.fn()
}));

async function loadFeaturedCache() {
    vi.resetModules();

    return import('./featuredContentCache');
}

function createPayload(sectionCount = 25, itemCount = 340) {
    const sectionItems = Array.from({ length: sectionCount }).reduce<Record<string, unknown[]>>((items, _value, index) => {
        items[`section-${index}`] = [];

        return items;
    }, {});

    Array.from({ length: itemCount }).forEach((_value, index) => {
        const sectionId = `section-${index % sectionCount}`;

        sectionItems[sectionId].push({
            Id: `item-${index}`,
            Name: `Item ${index}`,
            Type: 'Movie'
        });
    });

    return {
        heroItems: Array.from({ length: 15 }).map((_value, index) => ({
            Id: `hero-${index}`,
            Name: `Hero ${index}`,
            Type: 'Movie'
        })),
        sections: Object.keys(sectionItems).map(sectionId => ({
            id: sectionId,
            title: sectionId
        })),
        sectionItems
    };
}

function createCacheEntry(version: number | string | undefined = 7) {
    const entry: Record<string, unknown> = {
        createdAt: Date.now() - 1000,
        expiresAt: Date.now() + 60000,
        payload: createPayload()
    };

    if (version !== undefined) entry.version = version;

    return entry;
}

describe('featuredContentCache server document adoption', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('adopts numeric featured cache version 7 from the plugin document', async () => {
        const cache = await loadFeaturedCache();

        cache.invalidateFeaturedContentMemoryCache('test');
        cache.hydrateFeaturedContentCacheFromDocument({
            version: 1,
            featuredContent: createCacheEntry(7),
            updatedAt: Date.now()
        }, 'version-7');

        expect(cache.getFeaturedContentCacheStatus()).toMatchObject({
            adoptionResult: 'adopted',
            cacheVersion: 7,
            detectedCacheVersion: 7,
            heroCount: 15,
            itemCount: 340,
            sectionCount: 25,
            storage: 'plugin-file'
        });
    });

    it('adopts string version, wrapper document, and cased payload fields', async () => {
        const cache = await loadFeaturedCache();
        const entry = createCacheEntry('7');

        cache.invalidateFeaturedContentMemoryCache('test');
        cache.hydrateFeaturedContentCacheFromDocument({
            Document: {
                FeaturedContent: {
                    ...entry,
                    Payload: createPayload()
                },
                UpdatedAt: Date.now(),
                Version: 1
            }
        }, 'wrapped-version-7');

        expect(cache.getFeaturedContentCacheStatus()).toMatchObject({
            adoptionResult: 'adopted',
            cacheVersion: 7,
            detectedCacheVersion: 7,
            heroCount: 15,
            itemCount: 340,
            sectionCount: 25
        });
    });

    it('preserves the previous valid cache when a future version is rejected', async () => {
        const cache = await loadFeaturedCache();

        cache.invalidateFeaturedContentMemoryCache('test');
        cache.hydrateFeaturedContentCacheFromDocument({
            version: 1,
            featuredContent: createCacheEntry(7)
        }, 'valid');
        cache.hydrateFeaturedContentCacheFromDocument({
            version: 1,
            featuredContent: createCacheEntry(99)
        }, 'future-version');

        expect(cache.getFeaturedContentCacheStatus()).toMatchObject({
            adoptionResult: 'preserved-memory',
            cacheVersion: 7,
            heroCount: 15,
            itemCount: 340,
            lastRejectionReason: 'unsupported-cache-version',
            storage: 'plugin-file'
        });
    });

    it('migrates a structurally valid legacy payload with no explicit entry version', async () => {
        const cache = await loadFeaturedCache();
        const entry = createCacheEntry(7);

        delete entry.version;

        cache.invalidateFeaturedContentMemoryCache('test');
        cache.hydrateFeaturedContentCacheFromDocument({
            version: 1,
            featuredContent: entry
        }, 'legacy-missing-version');

        expect(cache.getFeaturedContentCacheStatus()).toMatchObject({
            adoptionResult: 'adopted',
            cacheVersion: 7,
            detectedCacheVersion: null,
            heroCount: 15,
            itemCount: 340,
            sectionCount: 25
        });
    });

    it('preserves populated memory when a fresh section-shell plugin cache arrives', async () => {
        const cache = await loadFeaturedCache();
        const emptyEntry = createCacheEntry(7);

        emptyEntry.payload = {
            heroItems: [],
            sections: Array.from({ length: 6 }, (_value, index) => ({ id: `empty-${index}` })),
            sectionItems: Object.fromEntries(Array.from({ length: 6 }, (_value, index) => [ `empty-${index}`, [] ]))
        };
        emptyEntry.createdAt = Date.now();
        cache.invalidateFeaturedContentMemoryCache('test');
        cache.hydrateFeaturedContentCacheFromDocument({ version: 1, featuredContent: createCacheEntry(7) }, 'populated');
        cache.hydrateFeaturedContentCacheFromDocument({ version: 1, featuredContent: emptyEntry }, 'empty-plugin');

        expect(cache.getFeaturedContentCacheStatus()).toMatchObject({
            adoptionResult: 'preserved-memory',
            heroCount: 15,
            itemCount: 340,
            lastRejectionReason: 'semantic-configuration-only'
        });
    });

    it('rejects a section-shell plugin cache when no populated cache exists', async () => {
        const cache = await loadFeaturedCache();
        const emptyEntry = createCacheEntry(7);

        emptyEntry.payload = {
            heroItems: [],
            sections: Array.from({ length: 6 }, (_value, index) => ({ id: `empty-${index}` })),
            sectionItems: Object.fromEntries(Array.from({ length: 6 }, (_value, index) => [ `empty-${index}`, [] ]))
        };
        cache.invalidateFeaturedContentMemoryCache('test');
        cache.hydrateFeaturedContentCacheFromDocument({ version: 1, featuredContent: emptyEntry }, 'empty-plugin');

        expect(cache.getFeaturedContentCacheStatus()).toMatchObject({
            adoptionResult: 'rejected',
            lastRejectionReason: 'semantic-configuration-only',
            observedStorage: 'plugin-file',
            payloadClassification: 'configuration-only',
            sectionCount: 6,
            semanticUsable: false
        });
    });

    it('keeps stale populated content when refresh returns an empty partial payload', async () => {
        const cache = await loadFeaturedCache();
        const staleEntry = createCacheEntry(7);

        staleEntry.expiresAt = Date.now() - 1;
        cache.invalidateFeaturedContentMemoryCache('test');
        cache.hydrateFeaturedContentCacheFromDocument({ version: 1, featuredContent: staleEntry }, 'stale-populated');

        const payload = await cache.getFeaturedContent(async () => ({
            generationState: 'timed-out',
            heroItems: [],
            sections: Array.from({ length: 6 }, (_value, index) => ({ id: `empty-${index}` })),
            sectionItems: Object.fromEntries(Array.from({ length: 6 }, (_value, index) => [ `empty-${index}`, [] ]))
        }));

        expect(payload.heroItems).toHaveLength(15);
        await vi.waitFor(() => {
            expect(cache.getFeaturedContentCacheStatus()).toMatchObject({
                heroCount: 15,
                itemCount: 340,
                payloadClassification: 'complete'
            });
            expect(cache.getFeaturedContentCacheStatus().lastRefreshError).toContain('semantic-configuration-only');
        });
    });
});
