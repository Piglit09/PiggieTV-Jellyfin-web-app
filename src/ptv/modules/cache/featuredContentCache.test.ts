import { beforeEach, describe, expect, it, vi } from 'vitest';

const featuredCacheMocks = vi.hoisted(() => ({
    currentApiClient: {
        getCurrentUserId: () => 'user-a',
        serverId: () => 'server-a',
        serverInfo: () => ({ Id: 'server-a' })
    },
    getPluginApiClient: vi.fn()
}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: vi.fn(() => featuredCacheMocks.currentApiClient),
        getLocalApiClient: vi.fn(() => featuredCacheMocks.currentApiClient)
    }
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    recordPtvPluginApiRetryState: vi.fn(),
    registerPtvDebugCacheStatusProvider: vi.fn(),
    timePtvAsync: (_category: string, _name: string, task: () => Promise<unknown>) => task()
}));

vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: featuredCacheMocks.getPluginApiClient,
    normalizePtvApiError: vi.fn((error: unknown) => ({
        message: error instanceof Error ? error.message : 'Unknown plugin API error'
    })),
    recordPtvPluginApiRetryState: vi.fn()
}));

async function loadFeaturedCache() {
    vi.resetModules();

    return import('./featuredContentCache');
}

function hydrateFeaturedCache(
    cache: Awaited<ReturnType<typeof loadFeaturedCache>>,
    document: unknown,
    reason: string
) {
    const hydrate = cache.createFeaturedContentCacheDocumentHydrator(reason);

    expect(hydrate).not.toBeNull();
    return hydrate?.(document) || null;
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
        scopeSchemaVersion: 2,
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

function createCacheEntry(version: number | string | undefined = 9) {
    const entry: Record<string, unknown> = {
        createdAt: Date.now() - 1000,
        expiresAt: Date.now() + 60000,
        payload: createPayload()
    };

    if (version) entry.version = version;

    return entry;
}

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });

    return { promise, resolve };
}

describe('featuredContentCache server document adoption', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        featuredCacheMocks.getPluginApiClient.mockReset();
        featuredCacheMocks.getPluginApiClient.mockReturnValue(null);
    });

    it('keeps version-9 owned scope only as a Home candidate until per-user endpoint proof', async () => {
        const cache = await loadFeaturedCache();
        featuredCacheMocks.getPluginApiClient.mockReturnValue({ getStatus: vi.fn().mockResolvedValue({
            currentHomeTopology: { version: 1, epoch: 'A'.repeat(64), held: false },
            currentHomeUserAccess: { version: 1, userId: 'user-a', accessEpoch: 'B'.repeat(64),
                held: false, policyProven: true }
        }) });
        const entry = createCacheEntry(9);
        const payload = entry.payload as ReturnType<typeof createPayload> & { scopeSchemaVersion: number };
        payload.scopeSchemaVersion = 2;
        Object.assign(payload.sections[0], {
            scopeType: 'library',
            libraryId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            sourceRuleId: 'latest-anime',
            resolvedScopeHash: '12345', topologyEpoch: 'A'.repeat(64), bindingGeneration: 0
        });

        cache.invalidateFeaturedContentMemoryCache('test');
        hydrateFeaturedCache(cache, { version: 1, featuredContent: entry }, 'version-9-scope');
        const adopted = await cache.getCachedFeaturedContentPayload();

        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            adoptionResult: 'adopted', cacheVersion: 9, detectedCacheVersion: 9
        });
        expect(adopted?.scopeSchemaVersion).toBe(2);
        expect(adopted?.sections?.[0]).not.toMatchObject({ scopeType: 'library' });
        const candidates = await cache.getCachedFeaturedContentPayload({ homeVerificationCandidates: true });
        expect(candidates?.sections?.[0]).toMatchObject({
            scopeType: 'library', libraryId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            sourceRuleId: 'latest-anime', resolvedScopeHash: '12345'
        });
        expect(JSON.stringify(candidates)).not.toContain('userAccessEpoch');
    });

    it.each([ 7, undefined ])('rejects unproven legacy version %s without promoting it to version 9', async version => {
        const cache = await loadFeaturedCache();
        const entry = createCacheEntry(version);
        if (version === undefined) delete entry.version;

        cache.invalidateFeaturedContentMemoryCache('test');
        hydrateFeaturedCache(cache, { version: 1, featuredContent: entry }, 'legacy-scope');

        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            adoptionResult: 'rejected', cacheVersion: null,
            detectedCacheVersion: version ?? null,
            lastRejectionReason: 'legacy-unproven-scope'
        });
        await expect(cache.getCachedFeaturedContentPayload()).resolves.toBeNull();
    });

    it('rejects version 9 without a current scope marker', async () => {
        const cache = await loadFeaturedCache();
        const entry = createCacheEntry(9);
        delete (entry.payload as Partial<ReturnType<typeof createPayload>>).scopeSchemaVersion;
        cache.invalidateFeaturedContentMemoryCache('test');
        hydrateFeaturedCache(cache, { version: 1, featuredContent: entry }, 'unscoped-v8');

        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            adoptionResult: 'rejected', cacheVersion: null,
            detectedCacheVersion: 9, lastRejectionReason: 'missing-scope-schema'
        });
    });

    it('reads featured content without waiting for the diagnostic status request', async () => {
        const pendingStatus = deferred<Record<string, unknown>>();
        const globalOnly = createCacheEntry(9);
        (globalOnly.payload as ReturnType<typeof createPayload>).heroItems = [];
        const pluginApi = {
            getFeaturedContentCacheDocument: vi.fn().mockResolvedValue({
                featuredContent: globalOnly,
                version: 1
            }),
            getStatus: vi.fn(() => pendingStatus.promise)
        };

        featuredCacheMocks.getPluginApiClient.mockReturnValue(pluginApi);
        const cache = await loadFeaturedCache();

        cache.invalidateFeaturedContentMemoryCache('test');
        const payloadPromise = cache.getCachedFeaturedContentPayload();
        const earlyResult = await Promise.race([
            payloadPromise.then(payload => ({ payload, source: 'featured' })),
            new Promise(resolve => window.setTimeout(() => resolve({ payload: null, source: 'deadline' }), 100))
        ]);

        pendingStatus.resolve({
            featureFlags: { featuredContent: true },
            ok: true
        });

        expect(earlyResult).toMatchObject({
            source: 'featured'
        });
        await expect(payloadPromise).resolves.toMatchObject({
            heroItems: expect.any(Array),
            sectionItems: expect.any(Object)
        });
        expect(pluginApi.getFeaturedContentCacheDocument).toHaveBeenCalledTimes(1);
        expect(pluginApi.getStatus).toHaveBeenCalledTimes(1);
    });

    it('adopts numeric featured cache version 9 from the plugin document', async () => {
        const cache = await loadFeaturedCache();

        cache.invalidateFeaturedContentMemoryCache('test');
        hydrateFeaturedCache(cache, {
            version: 1,
            featuredContent: createCacheEntry(9),
            updatedAt: Date.now()
        }, 'version-9');

        expect(cache.getFeaturedContentCacheStatus()).toMatchObject({
            adoptionResult: 'adopted',
            cacheVersion: 9,
            detectedCacheVersion: 9,
            heroCount: 15,
            itemCount: 340,
            sectionCount: 25,
            storage: 'plugin-file'
        });
    });

    it('adopts string version, wrapper document, and cased payload fields', async () => {
        const cache = await loadFeaturedCache();
        const entry = createCacheEntry('9');

        cache.invalidateFeaturedContentMemoryCache('test');
        hydrateFeaturedCache(cache, {
            Document: {
                FeaturedContent: {
                    ...entry,
                    Payload: createPayload()
                },
                UpdatedAt: Date.now(),
                Version: 1
            }
        }, 'wrapped-version-9');

        expect(cache.getFeaturedContentCacheStatus()).toMatchObject({
            adoptionResult: 'adopted',
            cacheVersion: 9,
            detectedCacheVersion: 9,
            heroCount: 15,
            itemCount: 340,
            sectionCount: 25
        });
    });

    it('preserves the previous valid cache when a future version is rejected', async () => {
        const cache = await loadFeaturedCache();

        cache.invalidateFeaturedContentMemoryCache('test');
        hydrateFeaturedCache(cache, {
            version: 1,
            featuredContent: createCacheEntry(9)
        }, 'valid');
        hydrateFeaturedCache(cache, {
            version: 1,
            featuredContent: createCacheEntry(99)
        }, 'future-version');

        expect(cache.getFeaturedContentCacheStatus()).toMatchObject({
            adoptionResult: 'preserved-memory',
            cacheVersion: 9,
            heroCount: 15,
            itemCount: 340,
            lastRejectionReason: 'unsupported-cache-version',
            storage: 'plugin-file'
        });
    });

    it('does not promote a structurally valid legacy payload with no explicit entry version', async () => {
        const cache = await loadFeaturedCache();
        const entry = createCacheEntry(9);

        delete entry.version;

        cache.invalidateFeaturedContentMemoryCache('test');
        hydrateFeaturedCache(cache, {
            version: 1,
            featuredContent: entry
        }, 'legacy-missing-version');

        expect(cache.getFeaturedContentCacheStatus()).toMatchObject({
            adoptionResult: 'rejected',
            cacheVersion: null,
            detectedCacheVersion: null,
            lastRejectionReason: 'legacy-unproven-scope'
        });
    });

    it('preserves populated memory when a fresh section-shell plugin cache arrives', async () => {
        const cache = await loadFeaturedCache();
        const emptyEntry = createCacheEntry(9);

        emptyEntry.payload = {
            scopeSchemaVersion: 2,
            heroItems: [],
            sections: Array.from({ length: 6 }, (_value, index) => ({ id: `empty-${index}` })),
            sectionItems: Object.fromEntries(Array.from({ length: 6 }, (_value, index) => [ `empty-${index}`, [] ]))
        };
        emptyEntry.createdAt = Date.now();
        cache.invalidateFeaturedContentMemoryCache('test');
        hydrateFeaturedCache(cache, { version: 1, featuredContent: createCacheEntry(9) }, 'populated');
        hydrateFeaturedCache(cache, { version: 1, featuredContent: emptyEntry }, 'empty-plugin');

        expect(cache.getFeaturedContentCacheStatus()).toMatchObject({
            adoptionResult: 'preserved-memory',
            heroCount: 15,
            itemCount: 340,
            lastRejectionReason: 'semantic-configuration-only'
        });
    });

    it('rejects a section-shell plugin cache when no populated cache exists', async () => {
        const cache = await loadFeaturedCache();
        const emptyEntry = createCacheEntry(9);

        emptyEntry.payload = {
            scopeSchemaVersion: 2,
            heroItems: [],
            sections: Array.from({ length: 6 }, (_value, index) => ({ id: `empty-${index}` })),
            sectionItems: Object.fromEntries(Array.from({ length: 6 }, (_value, index) => [ `empty-${index}`, [] ]))
        };
        cache.invalidateFeaturedContentMemoryCache('test');
        hydrateFeaturedCache(cache, { version: 1, featuredContent: emptyEntry }, 'empty-plugin');

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
        const staleEntry = createCacheEntry(9);

        staleEntry.expiresAt = Date.now() - 1;
        cache.invalidateFeaturedContentMemoryCache('test');
        hydrateFeaturedCache(cache, { version: 1, featuredContent: staleEntry }, 'stale-populated');

        const payload = await cache.getFeaturedContent(async () => ({
            generationState: 'timed-out',
            heroItems: [],
            sections: Array.from({ length: 6 }, (_value, index) => ({ id: `empty-${index}` })),
            sectionItems: Object.fromEntries(Array.from({ length: 6 }, (_value, index) => [ `empty-${index}`, [] ]))
        }));

        expect(payload.heroItems).toHaveLength(0);
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
