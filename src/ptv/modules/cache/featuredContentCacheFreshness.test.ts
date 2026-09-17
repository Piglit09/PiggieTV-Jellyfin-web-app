import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheMocks = vi.hoisted(() => ({
    userId: 'admin',
    serverId: 'server-a',
    client: {
        getFeaturedContentCacheDocument: vi.fn<() => Promise<unknown>>(async () => ({ version: 1 })),
        getStatus: vi.fn(async () => ({ ok: true, featureFlags: { featuredContent: true } })),
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

const authority = (generation = 'b', scope = 'a') => ({ version: 1 as const, scope: scope.repeat(64), generation: generation.repeat(64) });
const pair = { rule: 'c'.repeat(64), section: 'd'.repeat(64) };

function payload(proof: unknown = authority(), row = 'primary') {
    return {
        currentPresentationAuthority: proof,
        heroItems: [ { Id: `${row}-hero`, Name: 'Hero', Type: 'Movie' } ],
        sections: [ { id: row, title: row, rowType: 'configured-rule', configuredRowAssociation: { version: 1, scope: authority().scope, ...pair } } ],
        sectionItems: { [row]: [ { Id: `${row}-item`, Name: 'Item', Type: 'Movie' } ] }
    };
}

function document(value: ReturnType<typeof payload>) {
    return { version: 1, featuredContent: { version: 7, createdAt: Date.now(), expiresAt: Date.now() + 60_000, payload: value } };
}

async function load() {
    vi.resetModules();
    const cache = await import('./featuredContentCache');
    const freshness = await import('../../pages/home/configuredRowFreshness');
    const { ServerConnections } = await import('lib/jellyfin-apiclient');
    const { default: Events } = await import('../../../utils/events');
    return { cache, freshness, ServerConnections, Events };
}

async function establishCurrent(loaded: Awaited<ReturnType<typeof load>>) {
    const { cache, freshness } = loaded;
    cache.createFeaturedContentCacheDocumentHydrator('test')?.(document(payload()));
    const verification = freshness.beginConfiguredRowVerification('test-server-user');
    const proof = await freshness.verifyConfiguredRowFreshness({
        verification,
        settings: { currentPresentationAuthority: authority() },
        featured: payload(),
        readAuthority: async () => ({ currentPresentationAuthority: authority(), configuredPresentationBindings: [ pair ] })
    });
    expect(proof).not.toBeNull();
    expect(freshness.getConfiguredRowFreshnessSnapshot().status).toBe('CURRENT');
}

describe('Featured cache presentation-authority preservation and retirement', () => {
    beforeEach(() => {
        cacheMocks.userId = 'admin';
        cacheMocks.serverId = 'server-a';
        Object.values(cacheMocks.client).forEach(mock => {
            mock.mockClear();
        });
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue({ version: 1 });
    });

    it('preserves exact detached metadata through server normalization and memory reads without granting CURRENT', async () => {
        const { cache, freshness } = await load();
        const input = payload();
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue(document(input));
        const cached = await cache.getCachedFeaturedContentPayload();
        expect(cached?.currentPresentationAuthority).toEqual(authority());
        expect(cached?.currentPresentationAuthority).not.toBe(input.currentPresentationAuthority);
        expect(cached?.sectionItems).toEqual(input.sectionItems);
        expect(freshness.getConfiguredRowFreshnessSnapshot().status).toBe('UNKNOWN');
        await expect(cache.getCachedFeaturedContentPayload()).resolves.toMatchObject({ currentPresentationAuthority: authority() });
    });

    it('preserves valid proof through compaction without returning extra private fields', async () => {
        const { cache } = await load();
        const input = payload();
        const compact = cache.sanitizeFeaturedPayloadForSharedCache(input);
        expect(compact.currentPresentationAuthority).toEqual(authority());
        expect(compact.currentPresentationAuthority).not.toBe(input.currentPresentationAuthority);
        expect(Object.keys(compact.currentPresentationAuthority as object).sort((left, right) => left.localeCompare(right))).toEqual([ 'generation', 'scope', 'version' ]);
    });

    it.each([
        [ 'missing', undefined ],
        [ 'null', null ],
        [ 'wrong version', { ...authority(), version: 2 } ],
        [ 'short scope', { ...authority(), scope: 'a' } ],
        [ 'uppercase', { ...authority(), generation: 'B'.repeat(64) } ],
        [ 'extra secret', { ...authority(), selector: 'PRIVATE_SELECTOR' } ],
        [ 'ambiguous scope', { ...authority(), Scope: 'e'.repeat(64) } ],
        [ 'ambiguous generation', { ...authority(), Generation: 'e'.repeat(64) } ],
        [ 'array', [ authority() ] ]
    ])('does not launder %s authority into usable proof', async (_name, value) => {
        const { cache } = await load();
        const input = payload(value);
        // A default parameter deliberately cannot represent the missing case.
        if (value === undefined) input.currentPresentationAuthority = undefined;
        const compact = cache.sanitizeFeaturedPayloadForSharedCache(input);
        expect(compact.currentPresentationAuthority).toBeUndefined();
        expect(compact.sectionItems).toEqual(input.sectionItems);
        expect(JSON.stringify(compact)).not.toContain('PRIVATE_SELECTOR');
    });

    it('rejects duplicate case-variant payload authority keys instead of selecting one', async () => {
        const { cache } = await load();
        const input = { ...payload(), CurrentPresentationAuthority: authority('e') };
        expect(cache.sanitizeFeaturedPayloadForSharedCache(input).currentPresentationAuthority).toBeUndefined();
    });

    it.each([
        [ 'same authority', authority(), authority(), true ],
        [ 'different generation', authority('e'), authority(), false ],
        [ 'different scope', authority('b', 'e'), authority(), false ],
        [ 'missing primary', null, authority(), false ],
        [ 'missing fallback', authority(), null, false ],
        [ 'both missing', null, null, false ]
    ])('merges %s without inheriting proof across generations', async (_name, primaryProof, fallbackProof, retain) => {
        const { cache } = await load();
        const fallback = payload(fallbackProof, 'fallback');
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue(document(fallback));
        const primary = payload(primaryProof);
        const result = await cache.forceRefreshFeaturedContentCache(async () => primary);
        expect(result.currentPresentationAuthority).toEqual(retain ? primaryProof : undefined);
        expect(result.sectionItems).toEqual({ ...fallback.sectionItems, ...primary.sectionItems });
        expect(primary.currentPresentationAuthority).toEqual(primaryProof);
        expect(fallback.currentPresentationAuthority).toEqual(fallbackProof);
    });

    it('retains valid primary proof when there is no fallback payload', async () => {
        const { cache } = await load();
        const result = await cache.getFeaturedContent(async () => payload());
        expect(result.currentPresentationAuthority).toEqual(authority());
    });

    it.each([ 'invalidate', 'clear', 'identity-retired', 'user', 'server', 'missing-user', 'signout', 'signin' ])('retires configured CURRENT on %s', async operation => {
        const loaded = await load();
        const { cache, freshness, Events, ServerConnections } = loaded;
        await establishCurrent(loaded);
        if (operation === 'invalidate') cache.invalidateFeaturedContentMemoryCache('settings-saved');
        if (operation === 'clear') cache.clearFeaturedContentCache();
        if (operation === 'identity-retired') cache.invalidateFeaturedContentMemoryCache('identity-retired');
        if (operation === 'user' || operation === 'missing-user') {
            cacheMocks.userId = operation === 'user' ? 'restricted' : '';
            await cache.getCachedFeaturedContentPayload();
        }
        if (operation === 'server') {
            cacheMocks.serverId = 'server-b';
            await cache.getCachedFeaturedContentPayload();
        }
        if (operation === 'signout') Events.trigger(ServerConnections, 'localusersignedout');
        if (operation === 'signin') {
            cacheMocks.userId = 'restricted';
            Events.trigger(ServerConnections, 'localusersignedin');
        }
        expect(freshness.getConfiguredRowFreshnessSnapshot().status).not.toBe('CURRENT');
        expect(freshness.getConfiguredRowFreshnessSnapshot().authority).toBeNull();
    });

    it('does not retire a just-started verification on initial cache identity acquisition', async () => {
        const { cache, freshness } = await load();
        const verification = freshness.beginConfiguredRowVerification('test-server-user');
        const revision = freshness.getConfiguredRowFreshnessSnapshot().revision;
        cache.createFeaturedContentCacheDocumentHydrator('first-read')?.(document(payload()));
        expect(freshness.getConfiguredRowFreshnessSnapshot()).toMatchObject({ revision, status: 'VERIFYING' });
        const proof = await freshness.verifyConfiguredRowFreshness({ verification,
            settings: { currentPresentationAuthority: authority() }, featured: payload(),
            readAuthority: async () => ({ currentPresentationAuthority: authority(), configuredPresentationBindings: [ pair ] }) });
        expect(proof).not.toBeNull();
    });

    it.each([ 'same', 'generation', 'scope', 'missing', 'malformed', 'ambiguous', 'empty', 'older-mismatch' ])('observes newly received %s documents without promoting or silently retaining stale CURRENT', async variant => {
        const loaded = await load();
        const { cache, freshness } = loaded;
        await establishCurrent(loaded);
        const next = document(payload());
        if (variant === 'generation') next.featuredContent.payload.currentPresentationAuthority = authority('e');
        if (variant === 'scope') next.featuredContent.payload.currentPresentationAuthority = authority('b', 'e');
        if (variant === 'missing') next.featuredContent.payload.currentPresentationAuthority = undefined;
        if (variant === 'malformed') next.featuredContent.payload.currentPresentationAuthority = { ...authority(), generation: 'bad' };
        if (variant === 'ambiguous') Object.assign(next.featuredContent.payload, { CurrentPresentationAuthority: authority() });
        if (variant === 'older-mismatch') {
            next.featuredContent.createdAt = 1;
            next.featuredContent.payload.currentPresentationAuthority = authority('e');
        }
        cache.createFeaturedContentCacheDocumentHydrator('new-response')?.(variant === 'empty' ? { version: 1 } : next);
        expect(freshness.getConfiguredRowFreshnessSnapshot().status).toBe(variant === 'same' ? 'CURRENT' : 'STALE');
        expect(await cache.getCachedFeaturedContentPayload()).not.toBeNull();
    });

    it('observes direct new server-cache responses even when the read is only a write readback', async () => {
        const loaded = await load();
        const { cache, freshness } = loaded;
        await establishCurrent(loaded);
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue(document(payload(authority('e'))));
        cache.setFeaturedContentCacheTtlMs(60_000);
        await vi.waitFor(() => expect(freshness.getConfiguredRowFreshnessSnapshot().status).toBe('STALE'));
    });

    it('retires proof withheld by a mixed-generation refresh while preserving generic cached content', async () => {
        const loaded = await load();
        const { cache, freshness } = loaded;
        await establishCurrent(loaded);
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue(document(payload()));
        const result = await cache.forceRefreshFeaturedContentCache(async () => payload(authority('e'), 'fresh'));
        expect(result.currentPresentationAuthority).toBeUndefined();
        expect(result.sectionItems).toHaveProperty('fresh');
        expect(result.sectionItems).toHaveProperty('primary');
        expect(freshness.getConfiguredRowFreshnessSnapshot().status).toBe('STALE');
    });

    it('observes unknown proof on a rejected refresh before returning the old content fallback', async () => {
        const loaded = await load();
        const { cache, freshness } = loaded;
        await establishCurrent(loaded);
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue(document(payload()));
        const result = await cache.forceRefreshFeaturedContentCache(async () => ({ heroItems: [], sections: [], sectionItems: {} }));
        expect(result.currentPresentationAuthority).toEqual(authority());
        expect(freshness.getConfiguredRowFreshnessSnapshot().status).toBe('STALE');
    });

    it.each([ 'server-read', 'refresh' ])('retires observed current-owner %s uncertainty while retaining content fallback', async operation => {
        const loaded = await load();
        const { cache, freshness } = loaded;
        await establishCurrent(loaded);
        cacheMocks.client.getFeaturedContentCacheDocument.mockResolvedValue(document(payload()));
        if (operation === 'server-read') cacheMocks.client.getFeaturedContentCacheDocument.mockRejectedValueOnce(new Error('transport unavailable'));
        const result = await cache.forceRefreshFeaturedContentCache(async () => {
            if (operation === 'refresh') throw new Error('transport unavailable');
            return payload();
        });
        expect(result.sectionItems).toHaveProperty('primary');
        expect(freshness.getConfiguredRowFreshnessSnapshot().status).toBe('STALE');
    });

    it('does not observe an old hydrator completion against a newly verified cache owner', async () => {
        const loaded = await load();
        const { cache, freshness } = loaded;
        const oldHydrate = cache.createFeaturedContentCacheDocumentHydrator('old-owner');
        cacheMocks.userId = 'another-admin';
        await establishCurrent(loaded);
        const current = freshness.getConfiguredRowFreshnessSnapshot();
        expect(oldHydrate?.(document(payload(authority('e'))))).toBeNull();
        expect(freshness.getConfiguredRowFreshnessSnapshot()).toEqual(current);
        expect(await cache.getCachedFeaturedContentPayload()).not.toBeNull();
        expect(freshness.getConfiguredRowFreshnessSnapshot()).toEqual(current);
    });

    it.each([ 'response', 'failure' ])('ignores an old identity server transport %s without retiring the new CURRENT owner', async outcome => {
        const loaded = await load();
        const { cache, freshness } = loaded;
        let resolveOldRead!: (value: unknown) => void;
        let rejectOldRead!: (reason: Error) => void;
        cacheMocks.client.getFeaturedContentCacheDocument.mockReturnValueOnce(new Promise((resolve, reject) => {
            resolveOldRead = resolve;
            rejectOldRead = reject;
        }));
        const oldRead = cache.getCachedFeaturedContentPayload();
        await vi.waitFor(() => expect(cacheMocks.client.getFeaturedContentCacheDocument).toHaveBeenCalled());
        cacheMocks.userId = 'another-admin';
        await establishCurrent(loaded);
        const current = freshness.getConfiguredRowFreshnessSnapshot();
        if (outcome === 'response') resolveOldRead({ version: 1 });
        else rejectOldRead(new Error('old identity connection closed'));
        await expect(oldRead).rejects.toMatchObject({ name: 'AbortError' });
        expect(freshness.getConfiguredRowFreshnessSnapshot()).toEqual(current);
    });
});
