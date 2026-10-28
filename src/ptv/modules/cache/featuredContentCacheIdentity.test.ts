import { beforeEach, describe, expect, it, vi } from 'vitest';

const identityMocks = vi.hoisted(() => ({
    pluginClient: {
        clearFeaturedContentCacheDocument: vi.fn(async () => undefined),
        getFeaturedContentCacheDocument: vi.fn(async (): Promise<unknown> => ({ version: 1 })),
        getStatus: vi.fn(async () => ({ featureFlags: { featuredContent: true }, ok: true,
            currentHomeTopology: { version: 1, epoch: 'A'.repeat(64), held: false },
            currentHomeUserAccess: { version: 1, userId: identityMocks.userId,
                accessEpoch: 'B'.repeat(64), held: false, policyProven: true } })),
        writeFeaturedContentCacheDocument: vi.fn(async (document?: unknown) => {
            expect(document).toBeDefined();
        })
    },
    serverId: 'server-a',
    userId: 'admin'
}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: () => ({
            getCurrentUserId: () => identityMocks.userId,
            serverId: () => identityMocks.serverId,
            serverInfo: () => ({ Id: identityMocks.serverId })
        }),
        getLocalApiClient: () => ({
            getCurrentUserId: () => identityMocks.userId,
            serverId: () => identityMocks.serverId,
            serverInfo: () => ({ Id: identityMocks.serverId })
        })
    }
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    recordPtvPluginApiRetryState: vi.fn(),
    registerPtvDebugCacheStatusProvider: vi.fn(),
    timePtvAsync: (_category: string, _name: string, task: () => Promise<unknown>) => task()
}));

vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: () => identityMocks.pluginClient,
    normalizePtvApiError: vi.fn((error: unknown) => ({
        message: error instanceof Error ? error.message : 'Unknown plugin API error'
    })),
    recordPtvPluginApiRetryState: vi.fn()
}));

import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from '../../../utils/events';

function createPayload(label: string) {
    return {
        scopeSchemaVersion: 2,
        heroItems: [{ Id: label, Name: label, Type: 'Movie' }],
        sections: [{ id: 'featured', title: 'Featured' }],
        sectionItems: {
            featured: [{ Id: `${label}-row`, Name: `${label} row`, Type: 'Movie' }]
        }
    };
}

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });

    return { promise, resolve };
}

async function loadCache() {
    vi.resetModules();
    return import('./featuredContentCache');
}

describe('Featured cache authenticated identity ownership', () => {
    beforeEach(() => {
        identityMocks.serverId = 'server-a';
        identityMocks.userId = 'admin';
        Object.values(identityMocks.pluginClient).forEach(mock => {
            mock.mockClear();
        });
        identityMocks.pluginClient.getFeaturedContentCacheDocument.mockResolvedValue({ version: 1 });
    });

    it('retains only Plugin-response Hero epoch provenance and rejects a stale epoch on a remote first visit', async () => {
        const cache = await loadCache();
        const oldEpoch = 'C'.repeat(64);
        const now = Date.now();
        identityMocks.pluginClient.getFeaturedContentCacheDocument.mockResolvedValue({
            version: 1,
            featuredContent: {
                version: cache.FEATURED_CACHE_VERSION,
                createdAt: now,
                expiresAt: now + 60_000,
                payload: { ...createPayload('old-hero'), heroAccessEpoch: oldEpoch }
            }
        });

        const candidates = await cache.getCachedFeaturedContentPayload({ homeVerificationCandidates: true });
        expect(candidates?.heroAccessEpoch).toBe(oldEpoch);
        const projected = await cache.getCachedFeaturedContentPayload();
        expect(projected?.heroItems).toEqual([]);
        expect(projected?.sections).toEqual([ expect.objectContaining({ id: 'featured' }) ]);
        expect(cache.sanitizeFeaturedPayloadForSharedCache({ ...createPayload('shared'), heroAccessEpoch: oldEpoch }))
            .not.toHaveProperty('heroAccessEpoch');
    });

    it('accepts Plugin-authorized Hero only when its epoch matches fresh current access', async () => {
        const cache = await loadCache();
        const now = Date.now();
        identityMocks.pluginClient.getFeaturedContentCacheDocument.mockResolvedValue({
            version: 1,
            featuredContent: {
                version: cache.FEATURED_CACHE_VERSION,
                createdAt: now,
                expiresAt: now + 60_000,
                payload: { ...createPayload('current-hero'), heroAccessEpoch: 'B'.repeat(64) }
            }
        });

        await expect(cache.getCachedFeaturedContentPayload()).resolves.toMatchObject({
            heroItems: [ expect.objectContaining({ Id: 'current-hero' }) ],
            heroAccessEpoch: 'B'.repeat(64)
        });

        cache.setFeaturedContentCacheTtlMs(60_000);
        await vi.waitFor(() => expect(identityMocks.pluginClient.writeFeaturedContentCacheDocument).toHaveBeenCalled());
        const written = identityMocks.pluginClient.writeFeaturedContentCacheDocument.mock.calls.at(-1)?.[0];
        expect(JSON.stringify(written)).not.toContain('heroAccessEpoch');
    });

    it('isolates administrator and restricted payloads in both directions', async () => {
        const cache = await loadCache();
        const adminPayload = await cache.getFeaturedContent(async () => createPayload('admin-only'));

        identityMocks.userId = 'restricted';
        const restrictedPayload = await cache.getFeaturedContent(async () => createPayload('restricted-only'));

        expect(adminPayload.heroItems).toEqual([]);
        expect(restrictedPayload.heroItems).toEqual([]);
        expect(adminPayload.sectionItems.featured).toEqual([ expect.objectContaining({ Id: 'admin-only-row' }) ]);
        expect(restrictedPayload.sectionItems.featured).toEqual([ expect.objectContaining({ Id: 'restricted-only-row' }) ]);
        expect(JSON.stringify(restrictedPayload)).not.toContain('admin-only');

        identityMocks.userId = 'admin';
        const adminAgain = await cache.getFeaturedContent(async () => createPayload('admin-return'));

        expect(adminAgain.heroItems).toEqual([]);
        expect(adminAgain.sectionItems.featured).toEqual([ expect.objectContaining({ Id: 'admin-return-row' }) ]);
        expect(JSON.stringify(adminAgain)).not.toContain('restricted-only');
    });

    it('isolates the same user identifier across Jellyfin servers', async () => {
        const cache = await loadCache();
        const serverA = await cache.getFeaturedContent(async () => createPayload('server-a-payload'));

        identityMocks.serverId = 'server-b';
        const serverB = await cache.getFeaturedContent(async () => createPayload('server-b-payload'));

        expect(JSON.stringify(serverA)).toContain('server-a-payload');
        expect(JSON.stringify(serverB)).toContain('server-b-payload');
        expect(JSON.stringify(serverB)).not.toContain('server-a-payload');
    });

    it('rejects a delayed prior-user completion and preserves the current user cache', async () => {
        const cache = await loadCache();
        const admin = deferred<ReturnType<typeof createPayload>>();
        const restricted = deferred<ReturnType<typeof createPayload>>();
        const adminFetcher = vi.fn(() => admin.promise);
        const restrictedFetcher = vi.fn(() => restricted.promise);
        const adminRequest = cache.getFeaturedContent(adminFetcher);

        await vi.waitFor(() => expect(adminFetcher).toHaveBeenCalledOnce());

        identityMocks.userId = 'restricted';
        const restrictedRequest = cache.getFeaturedContent(restrictedFetcher);

        await vi.waitFor(() => expect(restrictedFetcher).toHaveBeenCalledOnce());
        restricted.resolve(createPayload('restricted-current'));
        await expect(restrictedRequest).resolves.toMatchObject({
            heroItems: [], sectionItems: { featured: [ expect.objectContaining({ Id: 'restricted-current-row' }) ] }
        });

        admin.resolve(createPayload('admin-late'));
        await expect(adminRequest).rejects.toMatchObject({ name: 'AbortError' });
        await expect(cache.getCachedFeaturedContentPayload()).resolves.toMatchObject({
            heroItems: [], sectionItems: { featured: [ expect.objectContaining({ Id: 'restricted-current-row' }) ] }
        });
    });

    it('rejects queued memory hits when their identity retires before publication', async () => {
        const cache = await loadCache();

        await cache.getFeaturedContent(async () => createPayload('admin-memory'));
        const cachedRead = cache.getCachedFeaturedContentPayload();
        const featuredRead = cache.getFeaturedContent(async () => createPayload('should-not-run'));

        identityMocks.userId = 'restricted';

        await expect(cachedRead).rejects.toMatchObject({ name: 'AbortError' });
        await expect(featuredRead).rejects.toMatchObject({ name: 'AbortError' });
        await expect(cache.getCachedFeaturedContentPayload()).resolves.toBeNull();
    });

    it('rejects an externally supplied document whose captured hydration owner retired', async () => {
        const cache = await loadCache();
        const hydrateAdminDocument = cache.createFeaturedContentCacheDocumentHydrator('delayed-readback');
        const now = Date.now();

        expect(hydrateAdminDocument).not.toBeNull();
        identityMocks.userId = 'restricted';

        expect(hydrateAdminDocument?.({
            featuredContent: {
                createdAt: now,
                expiresAt: now + 60_000,
                payload: createPayload('admin-document'),
                version: cache.FEATURED_CACHE_VERSION
            },
            version: 1
        })).toBeNull();
        await expect(cache.getCachedFeaturedContentPayload()).resolves.toBeNull();
    });

    it('coalesces same-identity consumers while separating concurrent identities', async () => {
        const cache = await loadCache();
        const sameIdentity = deferred<ReturnType<typeof createPayload>>();
        const sameFetcher = vi.fn(() => sameIdentity.promise);
        const first = cache.getFeaturedContent(sameFetcher);
        const second = cache.getFeaturedContent(sameFetcher);

        await vi.waitFor(() => expect(sameFetcher).toHaveBeenCalledOnce());
        sameIdentity.resolve(createPayload('same-user'));
        await expect(Promise.all([ first, second ])).resolves.toHaveLength(2);

        cache.invalidateFeaturedContentMemoryCache('test');
        const admin = deferred<ReturnType<typeof createPayload>>();
        const restricted = deferred<ReturnType<typeof createPayload>>();
        const adminFetcher = vi.fn(() => admin.promise);
        const restrictedFetcher = vi.fn(() => restricted.promise);
        const adminRequest = cache.getFeaturedContent(adminFetcher);

        await vi.waitFor(() => expect(adminFetcher).toHaveBeenCalledOnce());
        identityMocks.userId = 'restricted';
        const restrictedRequest = cache.getFeaturedContent(restrictedFetcher);
        await vi.waitFor(() => expect(restrictedFetcher).toHaveBeenCalledOnce());

        restricted.resolve(createPayload('restricted-concurrent'));
        admin.resolve(createPayload('admin-concurrent'));

        await expect(restrictedRequest).resolves.toBeDefined();
        await expect(adminRequest).rejects.toMatchObject({ name: 'AbortError' });
        expect(adminFetcher).toHaveBeenCalledOnce();
        expect(restrictedFetcher).toHaveBeenCalledOnce();
    });

    it('retires old payloads across logout, user switch, and server switch', async () => {
        const cache = await loadCache();

        await cache.getFeaturedContent(async () => createPayload('old-session'));
        Events.trigger(ServerConnections, 'localusersignedout');
        identityMocks.userId = 'next-user';
        Events.trigger(ServerConnections, 'localusersignedin');

        await expect(cache.getCachedFeaturedContentPayload()).resolves.toBeNull();
        const nextUser = await cache.getFeaturedContent(async () => createPayload('next-user'));
        expect(JSON.stringify(nextUser)).not.toContain('old-session');

        identityMocks.serverId = 'server-b';
        Events.trigger(ServerConnections, 'localusersignedin');
        await expect(cache.getCachedFeaturedContentPayload()).resolves.toBeNull();
    });

    it('fails closed for missing or ambiguous identity without a global cache fallback', async () => {
        const cache = await loadCache();
        const fetcher = vi.fn(async () => createPayload('must-not-run'));

        identityMocks.userId = '';
        await expect(cache.getFeaturedContent(fetcher)).rejects.toMatchObject({
            code: 'PTV_FEATURED_CACHE_IDENTITY_UNAVAILABLE'
        });
        await expect(cache.getCachedFeaturedContentPayload()).resolves.toBeNull();
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('retains at most one authenticated identity state', async () => {
        const cache = await loadCache();

        for (let index = 0; index < 12; index += 1) {
            identityMocks.userId = `user-${index}`;
            await cache.getFeaturedContent(async () => createPayload(`payload-${index}`));
            expect(cache.getFeaturedContentCacheStatus({ prime: false }).retainedIdentityCount).toBe(1);
        }

        identityMocks.userId = 'user-0';
        await expect(cache.getCachedFeaturedContentPayload()).resolves.toBeNull();
    });
});
