import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheMocks = vi.hoisted(() => ({
    userId: 'admin',
    serverId: 'server-a',
    client: {
        getFeaturedContentCacheDocument: vi.fn<() => Promise<unknown>>(async () => ({ version: 1 })),
        getStatus: vi.fn<() => Promise<unknown>>(async () => ({ ok: true })),
        writeFeaturedContentCacheDocument: vi.fn(async () => undefined),
        clearFeaturedContentCacheDocument: vi.fn(async () => undefined)
    }
}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        getLocalApiClient: () => ({
            getCurrentUserId: () => cacheMocks.userId,
            serverId: () => cacheMocks.serverId,
            serverInfo: () => ({ Id: cacheMocks.serverId })
        })
    }
}));
vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    registerPtvDebugCacheStatusProvider: vi.fn(),
    timePtvAsync: (_category: string, _name: string, run: () => Promise<unknown>) => run()
}));
vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: () => cacheMocks.client,
    normalizePtvApiError: (error: unknown) => ({ message: String(error) }),
    recordPtvPluginApiRetryState: vi.fn()
}));
vi.mock('../../core/scope', () => ({
    getRuntimeScope: () => ({ timeout: vi.fn() })
}));

const epoch = 'A'.repeat(64);
const topology = { version: 1, epoch, held: false };
const access = { version: 1, userId: 'admin', accessEpoch: 'B'.repeat(64), held: false, policyProven: true };
function payload() {
    return { scopeSchemaVersion: 2, heroItems: [] as Array<{ Id: string }>, sections: [
        { id: 'owned', scopeType: 'library', libraryId: '1'.repeat(32), topologyEpoch: epoch,
            userAccessEpoch: access.accessEpoch, bindingGeneration: 0 },
        { id: 'global', scopeType: 'global' }
    ], sectionItems: { owned: [{ Id: 'owned-item' }], global: [{ Id: 'global-item' }] } };
}
function document(value = payload(), version = 9) {
    return { version: 1, featuredContent: { version, createdAt: Date.now(), expiresAt: Date.now() + 60000, payload: value } };
}

describe('Featured topology cache boundary', () => {
    beforeEach(() => {
        window.localStorage.removeItem('ptv-home-library-retired-v1');
        vi.resetModules();
        cacheMocks.client.getStatus.mockResolvedValue({ currentHomeTopology: topology, currentHomeUserAccess: access });
    });
    it('withholds owned cached rows for a first-install user without per-user proof', async () => {
        cacheMocks.client.getStatus.mockResolvedValue({ currentHomeTopology: topology });
        const withHero = payload();
        withHero.heroItems = [{ Id: 'unproven-hero' }];
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue(document(withHero));
        const cache = await import('./featuredContentCache');
        const value = await cache.getCachedFeaturedContentPayload();
        expect(value?.sectionItems.owned).toBeUndefined();
        expect(value?.sectionItems.global).toEqual([{ Id: 'global-item' }]);
        expect(value?.heroItems).toEqual([]);
    });
    it('returns Home verification candidates without status or memory publication and preserves their actual version', async () => {
        cacheMocks.client.getStatus.mockClear();
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue(document());
        const cache = await import('./featuredContentCache');
        const candidates = await cache.getCachedFeaturedContentPayload({ homeVerificationCandidates: true });
        expect(candidates?.sectionItems.owned).toBeDefined();
        expect((candidates as Record<string, unknown>)?.homeFeaturedCacheVersion).toBe(9);
        expect(cacheMocks.client.getStatus).not.toHaveBeenCalled();
        expect(cache.isFeaturedContentCacheFresh()).toBe(false);
        cacheMocks.client.getStatus.mockResolvedValue({ currentHomeTopology: { ...topology, held: true } });
        expect((await cache.getCachedFeaturedContentPayload())?.sectionItems.owned).toBeUndefined();
    });

    it('rejects a late generic cache response after local retirement', async () => {
        let resolve!: (value: unknown) => void;
        cacheMocks.client.getFeaturedContentCacheDocument.mockReturnValue(new Promise(next => {
            resolve = next;
        }));
        const cache = await import('./featuredContentCache');
        const transition = await import('../../pages/home/homeLibraryTransitionFreshness');
        const pending = cache.getCachedFeaturedContentPayload();
        transition.retireHomeLibraryAuthority('controlled-write');
        resolve(document());
        const value = await pending;
        expect(value?.sectionItems.owned).toBeUndefined();
        expect(value?.sectionItems.global).toBeDefined();
        expect(cache.isFeaturedContentCacheFresh()).toBe(false);
    });

    it('rejects a same-identity hydrator captured before library retirement', async () => {
        const cache = await import('./featuredContentCache');
        const transition = await import('../../pages/home/homeLibraryTransitionFreshness');
        const hydrate = cache.createFeaturedContentCacheDocumentHydrator('before-controlled-write');
        transition.retireHomeLibraryAuthority('controlled-write');
        expect(hydrate?.(document())).toBeNull();
        expect(cache.isFeaturedContentCacheFresh()).toBe(false);
    });

    it('does not persist an old refresh result completed after library retirement', async () => {
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue({ version: 1 });
        const cache = await import('./featuredContentCache');
        const transition = await import('../../pages/home/homeLibraryTransitionFreshness');
        let complete!: (value: ReturnType<typeof payload>) => void;
        const pending = cache.getFeaturedContent(() => new Promise(resolve => {
            complete = resolve;
        }));
        await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
        transition.retireHomeLibraryAuthority('begin-during-refresh');
        complete(payload());
        const result = await pending;
        expect(result.sectionItems.owned).toBeUndefined();
        expect(result.sectionItems.global).toEqual([{ Id: 'global-item' }]);
        expect(cache.isFeaturedContentCacheFresh()).toBe(false);
        expect(cacheMocks.client.writeFeaturedContentCacheDocument).not.toHaveBeenCalled();
    });

    it('drops a staged old refresh when retirement occurs during its store read', async () => {
        let completeRead!: (value: unknown) => void;
        cacheMocks.client.getFeaturedContentCacheDocument.mockReset()
            .mockResolvedValueOnce({ version: 1 })
            .mockImplementationOnce(() => new Promise(resolve => {
                completeRead = resolve;
            }));
        const cache = await import('./featuredContentCache');
        const transition = await import('../../pages/home/homeLibraryTransitionFreshness');
        const pending = cache.getFeaturedContent(async () => payload());
        await vi.waitFor(() => expect(completeRead).toBeTypeOf('function'));
        transition.retireHomeLibraryAuthority('begin-during-store-read');
        completeRead({ version: 1 });
        const result = await pending;
        expect(result.sectionItems.owned).toBeUndefined();
        expect(result.sectionItems.global).toEqual([{ Id: 'global-item' }]);
        expect(cache.isFeaturedContentCacheFresh()).toBe(false);
        expect(cacheMocks.client.writeFeaturedContentCacheDocument).not.toHaveBeenCalled();
    });

    it('does not promote a per-user claim found in a shared document even under matching status', async () => {
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue(document());
        const cache = await import('./featuredContentCache');
        const value = await cache.getCachedFeaturedContentPayload();
        expect(value?.sectionItems.owned).toBeUndefined();
        expect(value?.sectionItems.global).toEqual([{ Id: 'global-item' }]);
        const candidates = await cache.getCachedFeaturedContentPayload({ homeVerificationCandidates: true });
        expect(candidates?.sectionItems.owned).toEqual([{ Id: 'owned-item' }]);
        expect(JSON.stringify(candidates)).not.toContain('userAccessEpoch');
        expect(cacheMocks.client.getStatus).toHaveBeenCalledWith(expect.objectContaining({ bypassCache: true }));
    });
    it('never persists a per-user access epoch into the shared Plugin cache', async () => {
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue({ version: 1 });
        const cache = await import('./featuredContentCache');
        await cache.getFeaturedContent(async () => payload());
        expect(cacheMocks.client.writeFeaturedContentCacheDocument).toHaveBeenCalled();
        expect(JSON.stringify(cacheMocks.client.writeFeaturedContentCacheDocument.mock.calls)).not.toContain('userAccessEpoch');
    });
    it.each([ undefined, 'C'.repeat(64) ])('rejects an owned cache section with access epoch %s while preserving globals', async value => {
        const changed = payload();
        (changed.sections[0] as { userAccessEpoch?: string }).userAccessEpoch = value;
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue(document(changed));
        const cache = await import('./featuredContentCache');
        const result = await cache.getCachedFeaturedContentPayload();
        expect(result?.sectionItems.owned).toBeUndefined();
        expect(result?.sectionItems.global).toEqual([{ Id: 'global-item' }]);
    });
    it('does not re-adopt old memory under a stale status immediately after local retirement', async () => {
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue(document());
        const cache = await import('./featuredContentCache');
        const transition = await import('../../pages/home/homeLibraryTransitionFreshness');
        expect((await cache.getCachedFeaturedContentPayload({ homeVerificationCandidates: true }))?.sectionItems.owned).toBeDefined();
        expect((await cache.getCachedFeaturedContentPayload())?.sectionItems.owned).toBeUndefined();
        transition.retireHomeLibraryAuthority('controlled-write-before-plugin-begin');
        const value = await cache.getCachedFeaturedContentPayload();
        expect(value?.sectionItems.owned).toBeUndefined();
        expect(value?.sectionItems.global).toEqual([{ Id: 'global-item' }]);
    });
    it('keeps shared owned cache as a candidate even after a new final Home status', async () => {
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue(document());
        const cache = await import('./featuredContentCache');
        const transition = await import('../../pages/home/homeLibraryTransitionFreshness');
        expect((await cache.getCachedFeaturedContentPayload({ homeVerificationCandidates: true }))?.sectionItems.owned).toBeDefined();
        transition.retireHomeLibraryAuthority('controlled-write');
        expect((await cache.getCachedFeaturedContentPayload())?.sectionItems.owned).toBeUndefined();
        const revision = transition.beginHomeLibraryVerification('server-a:admin');
        const nextEpoch = 'B'.repeat(64);
        expect(transition.acceptHomeLibraryAuthority({ currentHomeTopology: { ...topology, epoch: nextEpoch, held: true },
            currentHomeUserAccess: access }, revision, 'server-a:admin')).toBeNull();
        const nextPayload = payload();
        (nextPayload.sections[0] as { topologyEpoch: string }).topologyEpoch = nextEpoch;
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue(document(nextPayload));
        cacheMocks.client.getStatus.mockResolvedValue({ currentHomeTopology: { ...topology, epoch: nextEpoch },
            currentHomeUserAccess: access });
        transition.acceptHomeLibraryAuthority({ currentHomeTopology: { ...topology, epoch: nextEpoch },
            currentHomeUserAccess: access }, revision, 'server-a:admin');
        const current = await cache.getCachedFeaturedContentPayload();
        expect(current?.sectionItems.owned).toBeUndefined();
        expect((await cache.getCachedFeaturedContentPayload({ homeVerificationCandidates: true }))?.sectionItems.owned)
            .toEqual([{ Id: 'owned-item' }]);
    });
    it.each([
        ['missing', {}], ['held', { currentHomeTopology: { ...topology, held: true } }],
        ['old epoch', { currentHomeTopology: { ...topology, epoch: 'B'.repeat(64) } }],
        ['malformed', { currentHomeTopology: { ...topology, held: 'false' } }],
        ['private fields', { currentHomeTopology: { ...topology, definitions: ['secret'] } }]
    ])('withholds owned sections and items for %s while keeping global rows', async (_name, status) => {
        cacheMocks.client.getStatus.mockResolvedValue(status);
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue(document());
        const cache = await import('./featuredContentCache');
        const value = await cache.getCachedFeaturedContentPayload();
        expect(value?.sections).toEqual([{ id: 'global', scopeType: 'global' }]);
        expect(value?.sectionItems).toEqual({ global: [{ Id: 'global-item' }] });
    });
    it('never promotes v8 owned cache on a new visit and preserves separable globals', async () => {
        const legacy = { ...payload(), scopeSchemaVersion: 1 };
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue(document(legacy, 8));
        const cache = await import('./featuredContentCache');
        const value = await cache.getCachedFeaturedContentPayload();
        expect(value?.sectionItems).toEqual({ global: [{ Id: 'global-item' }] });
        expect(value?.scopeSchemaVersion).not.toBe(2);
    });
    it('does not expose owned content from synchronous hydration without fresh authority', async () => {
        const cache = await import('./featuredContentCache');
        const hydrated = cache.createFeaturedContentCacheDocumentHydrator()?.(document());
        expect(hydrated?.payload.sectionItems.owned).toBeUndefined();
    });
    it.each(['topologyEpoch', 'bindingGeneration'])('rejects ambiguous %s during shared compaction', async field => {
        const cache = await import('./featuredContentCache');
        const input = payload();
        Object.assign(input.sections[0], { [field[0].toUpperCase() + field.slice(1)]: input.sections[0][field as 'topologyEpoch'] });
        const result = cache.sanitizeFeaturedPayloadForSharedCache(input);
        expect(result.sectionItems.owned).toBeUndefined();
        expect(result.sectionItems.global).toBeDefined();
    });

    it.each(['memory', 'failed refresh', 'rejected incoming'])('does not resurrect old owned items through %s', async route => {
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue(document());
        const cache = await import('./featuredContentCache');
        expect((await cache.getCachedFeaturedContentPayload({ homeVerificationCandidates: true }))?.sectionItems.owned).toBeDefined();
        expect((await cache.getCachedFeaturedContentPayload())?.sectionItems.global).toBeDefined();
        cacheMocks.client.getStatus.mockResolvedValue({ currentHomeTopology: { ...topology, held: true } });
        if (route === 'rejected incoming') cache.createFeaturedContentCacheDocumentHydrator()?.({ version: 1, featuredContent: { version: 99 } });
        const result = route === 'failed refresh' ?
            await cache.forceRefreshFeaturedContentCache(async () => { throw new Error('offline'); }) :
            await cache.getCachedFeaturedContentPayload();
        expect(result?.sectionItems.owned).toBeUndefined();
        expect(result?.sectionItems.global).toBeDefined();
    });
});
