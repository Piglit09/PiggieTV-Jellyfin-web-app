import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const diagnosticMocks = vi.hoisted(() => ({
    document: { version: 1 } as unknown,
    serverId: 'server-a',
    userId: 'user-a',
    getFeaturedContentCacheDocument: vi.fn<() => Promise<unknown>>(),
    getStatus: vi.fn(async () => ({ featureFlags: { featuredContent: true }, ok: true })),
    writeFeaturedContentCacheDocument: vi.fn<(_document: unknown) => Promise<void>>()
}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: () => ({
            getCurrentUserId: () => diagnosticMocks.userId,
            serverId: () => diagnosticMocks.serverId,
            serverInfo: () => ({ Id: diagnosticMocks.serverId })
        }),
        getLocalApiClient: () => ({
            getCurrentUserId: () => diagnosticMocks.userId,
            serverId: () => diagnosticMocks.serverId,
            serverInfo: () => ({ Id: diagnosticMocks.serverId })
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
    getCurrentPtvPluginApiClient: () => ({
        getFeaturedContentCacheDocument: diagnosticMocks.getFeaturedContentCacheDocument,
        getStatus: diagnosticMocks.getStatus,
        writeFeaturedContentCacheDocument: diagnosticMocks.writeFeaturedContentCacheDocument
    }),
    normalizePtvApiError: (error: unknown) => ({ message: String(error) }),
    recordPtvPluginApiRetryState: vi.fn()
}));

function payload() {
    return {
        scopeSchemaVersion: 2,
        heroItems: [],
        sections: [{ id: 'main', title: 'Main' }],
        sectionItems: { main: [{ Id: 'item-a', Name: 'Private title', Type: 'Movie' }] }
    };
}

function document(createdAt = Date.now(), expiresAt = createdAt + 60_000) {
    return {
        version: 1,
        featuredContent: { version: 9, createdAt, expiresAt, payload: payload() }
    };
}

async function loadCache() {
    vi.resetModules();
    return import('./featuredContentCache');
}

describe('Featured cache diagnostic provenance', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-24T10:00:00.000Z'));
        diagnosticMocks.userId = 'user-a';
        diagnosticMocks.serverId = 'server-a';
        diagnosticMocks.document = { version: 1, featuredContent: null };
        diagnosticMocks.getFeaturedContentCacheDocument.mockReset().mockImplementation(async () => diagnosticMocks.document);
        diagnosticMocks.getStatus.mockClear();
        diagnosticMocks.writeFeaturedContentCacheDocument.mockReset().mockImplementation(async next => {
            diagnosticMocks.document = next;
        });
    });

    afterEach(() => vi.useRealTimers());

    it('distinguishes an unattempted read from a successful empty document', async () => {
        const cache = await loadCache();
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            countsObserved: false,
            lastReadOutcome: 'not-attempted',
            lastWriteOutcome: 'not-attempted'
        });
        expect(diagnosticMocks.getFeaturedContentCacheDocument).not.toHaveBeenCalled();

        await expect(cache.getCachedFeaturedContentPayload()).resolves.toBeNull();
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            adoptionResult: 'empty',
            countsObserved: true,
            itemCount: 0,
            lastReadOutcome: 'empty',
            lastWriteOutcome: 'not-attempted',
            sectionCount: 0
        });
    });

    it('records a populated Plugin read without claiming a Web write', async () => {
        diagnosticMocks.document = document();
        const cache = await loadCache();
        await expect(cache.getCachedFeaturedContentPayload()).resolves.toBeTruthy();
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            adoptionResult: 'adopted',
            countsObserved: true,
            itemCount: 1,
            lastReadOutcome: 'adopted',
            lastWriteOutcome: 'not-attempted',
            sectionCount: 1
        });
        expect(diagnosticMocks.writeFeaturedContentCacheDocument).not.toHaveBeenCalled();
    });

    it('does not call a malformed missing document an observed empty cache', async () => {
        diagnosticMocks.document = {};
        const cache = await loadCache();
        await expect(cache.getCachedFeaturedContentPayload()).resolves.toBeNull();
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            countsObserved: false,
            lastReadOutcome: 'rejected'
        });
    });

    it('reports a write as verified only after the Plugin readback matches', async () => {
        const cache = await loadCache();
        await cache.getFeaturedContent(async () => payload());
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            lastWriteAttemptAt: expect.any(Number),
            lastWriteOutcome: 'verified',
            writeError: null
        });
        expect(diagnosticMocks.writeFeaturedContentCacheDocument).toHaveBeenCalledOnce();
    });

    it('does not verify a readback with different cache revision metadata', async () => {
        diagnosticMocks.writeFeaturedContentCacheDocument.mockImplementationOnce(async next => {
            const changed = JSON.parse(JSON.stringify(next)) as ReturnType<typeof document>;
            changed.featuredContent.createdAt += 1;
            diagnosticMocks.document = changed;
        });
        const cache = await loadCache();
        await cache.getFeaturedContent(async () => payload());
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            lastWriteOutcome: 'unverified',
            writeError: expect.any(String)
        });
    });

    it('does not verify a settings-only write when the Plugin still returns the previous TTL', async () => {
        diagnosticMocks.document = {
            version: 1,
            featuredContent: null,
            featuredContentSettings: { ttlMs: 2 * 60 * 60_000 }
        };
        diagnosticMocks.writeFeaturedContentCacheDocument.mockImplementationOnce(async () => undefined);
        const cache = await loadCache();
        cache.setFeaturedContentCacheTtlMs(60 * 60_000);
        await vi.waitFor(() => expect(diagnosticMocks.writeFeaturedContentCacheDocument).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(cache.getFeaturedContentCacheStatus({ prime: false }).lastWriteOutcome).toBe('unverified'));
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            lastWriteOutcome: 'unverified',
            writeError: expect.any(String)
        });
    });

    it('does not verify malformed projected content with matching revision metadata', async () => {
        diagnosticMocks.writeFeaturedContentCacheDocument.mockImplementationOnce(async next => {
            const malformed = JSON.parse(JSON.stringify(next)) as ReturnType<typeof document>;
            malformed.featuredContent.payload.scopeSchemaVersion = 1;
            diagnosticMocks.document = malformed;
        });
        const cache = await loadCache();
        await cache.getFeaturedContent(async () => payload());
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            lastWriteOutcome: 'unverified',
            writeError: expect.any(String)
        });
    });

    it('verifies a Plugin readback that projects content for the current user', async () => {
        diagnosticMocks.writeFeaturedContentCacheDocument.mockImplementationOnce(async next => {
            const projected = JSON.parse(JSON.stringify(next)) as ReturnType<typeof document>;
            projected.featuredContent.payload.heroItems = [];
            projected.featuredContent.payload.sections = [];
            projected.featuredContent.payload.sectionItems.main = [];
            diagnosticMocks.document = projected;
        });
        const cache = await loadCache();
        await cache.getFeaturedContent(async () => payload());
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            lastWriteOutcome: 'verified',
            writeError: null
        });
    });

    it('does not let an older settings write readback replace the latest write outcome', async () => {
        let releaseFirstWrite!: () => void;
        diagnosticMocks.writeFeaturedContentCacheDocument.mockImplementationOnce(async next => {
            diagnosticMocks.document = next;
            await new Promise<void>(resolve => {
                releaseFirstWrite = resolve;
            });
        });
        const cache = await loadCache();
        cache.setFeaturedContentCacheTtlMs(30_000);
        await vi.waitFor(() => expect(diagnosticMocks.writeFeaturedContentCacheDocument).toHaveBeenCalledTimes(1));

        await cache.getFeaturedContent(async () => payload());
        expect(cache.getFeaturedContentCacheStatus({ prime: false }).lastWriteOutcome).toBe('verified');

        releaseFirstWrite();
        await vi.waitFor(() => expect(diagnosticMocks.getFeaturedContentCacheDocument).toHaveBeenCalledTimes(5));
        await Promise.resolve();
        await Promise.resolve();
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            lastWriteOutcome: 'verified',
            writeError: null
        });
    });

    it('treats a document-like response with omitted featuredContent as unobserved', async () => {
        diagnosticMocks.document = { version: 1, updatedAt: Date.now() };
        const cache = await loadCache();
        await expect(cache.getCachedFeaturedContentPayload()).resolves.toBeNull();
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            countsObserved: false,
            lastReadOutcome: 'rejected',
            lastReadFailureCategory: 'parse'
        });
    });

    it('dates observed in-memory counts even when the generated fallback cannot be written', async () => {
        diagnosticMocks.getFeaturedContentCacheDocument.mockRejectedValueOnce(new Error('Network unavailable'));
        diagnosticMocks.writeFeaturedContentCacheDocument.mockRejectedValueOnce(new Error('Storage unavailable'));
        const cache = await loadCache();
        await cache.getFeaturedContent(async () => payload());
        const status = cache.getFeaturedContentCacheStatus({ prime: false });
        expect(status).toMatchObject({
            countsObserved: true,
            countsObservedAt: status.createdAt,
            lastWriteOutcome: 'failed'
        });
        expect(status.countsObservedAt).not.toBeNull();
    });

    it('retains a failed read with fallback, then records verified recovery without erasing history', async () => {
        const cache = await loadCache();
        const old = document(Date.now() - 120_000, Date.now() - 60_000);
        cache.createFeaturedContentCacheDocumentHydrator('test-fallback')?.(old);
        diagnosticMocks.getFeaturedContentCacheDocument.mockRejectedValueOnce(new Error('Private host 192.168.1.5 timed out'));
        await expect(cache.getCachedFeaturedContentPayload()).resolves.toBeNull();
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            fallbackAvailable: true,
            lastReadFailureCategory: 'timeout',
            lastReadOutcome: 'failed',
            lastWriteOutcome: 'not-attempted'
        });

        vi.setSystemTime(Date.now() + 2_000);
        diagnosticMocks.document = document();
        await expect(cache.getCachedFeaturedContentPayload()).resolves.toBeTruthy();
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            adoptionResult: 'adopted',
            lastReadFailureCategory: 'timeout',
            lastReadOutcome: 'adopted',
            readError: null
        });
    });

    it('resolves a failed read only after a generated fallback is written and read back', async () => {
        diagnosticMocks.getFeaturedContentCacheDocument.mockRejectedValueOnce(new Error('Network unavailable'));
        const cache = await loadCache();
        await expect(cache.getCachedFeaturedContentPayload()).resolves.toBeNull();
        const failed = cache.getFeaturedContentCacheStatus({ prime: false });
        expect(failed).toMatchObject({
            lastReadFailureCategory: 'transport',
            lastReadOutcome: 'failed',
            readError: expect.any(String)
        });

        await cache.getFeaturedContent(async () => payload());
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            lastReadAttemptAt: expect.any(Number),
            lastReadFailureAt: failed.lastReadFailureAt,
            lastReadFailureCategory: 'transport',
            lastReadOutcome: 'adopted',
            lastWriteOutcome: 'verified',
            readError: null,
            writeError: null
        });
    });

    it('resolves a failed read after valid owner-guarded document hydration', async () => {
        diagnosticMocks.getFeaturedContentCacheDocument.mockRejectedValueOnce(new Error('Network unavailable'));
        const cache = await loadCache();
        await expect(cache.getCachedFeaturedContentPayload()).resolves.toBeNull();
        const failedAt = cache.getFeaturedContentCacheStatus({ prime: false }).lastReadFailureAt;

        const hydrate = cache.createFeaturedContentCacheDocumentHydrator('verified-plugin-response');
        expect(hydrate?.(document())).toBeTruthy();
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            lastReadFailureAt: failedAt,
            lastReadFailureCategory: 'transport',
            lastReadOutcome: 'adopted',
            readError: null
        });
    });

    it('retains a failed regeneration after reading the same stale Plugin document', async () => {
        diagnosticMocks.document = document(Date.now() - 120_000, Date.now() - 60_000);
        const cache = await loadCache();
        await expect(cache.getCachedFeaturedContentPayload({ allowStale: true })).resolves.toBeTruthy();
        await cache.forceRefreshFeaturedContentCache(async () => {
            throw new Error('Regeneration unavailable');
        });
        expect(cache.getFeaturedContentCacheStatus({ prime: false }).lastRefreshError).toContain('Regeneration unavailable');

        await expect(cache.getCachedFeaturedContentPayload({ allowStale: false })).resolves.toBeNull();
        expect(cache.getFeaturedContentCacheStatus({ prime: false }).lastRefreshError).toContain('Regeneration unavailable');
    });

    it('does not leave a superseded read permanently in progress after library authority changes', async () => {
        let resolve!: (value: unknown) => void;
        diagnosticMocks.getFeaturedContentCacheDocument.mockImplementationOnce(() => new Promise(done => {
            resolve = done;
        }));
        const cache = await loadCache();
        const pending = cache.getCachedFeaturedContentPayload();
        await vi.waitFor(() => expect(diagnosticMocks.getFeaturedContentCacheDocument).toHaveBeenCalledOnce());
        const { retireHomeLibraryAuthority } = await import('../../pages/home/homeLibraryTransitionFreshness');
        retireHomeLibraryAuthority('test-revision-change', { broadcast: false });
        resolve(document());
        await pending;
        expect(cache.getFeaturedContentCacheStatus({ prime: false }).lastReadOutcome).not.toBe('in-progress');
    });

    it('resolves a superseded read when a nonretiring Home verification changes revision', async () => {
        let resolve!: (value: unknown) => void;
        diagnosticMocks.getFeaturedContentCacheDocument.mockImplementationOnce(() => new Promise(done => {
            resolve = done;
        }));
        const cache = await loadCache();
        const pending = cache.getCachedFeaturedContentPayload();
        await vi.waitFor(() => expect(diagnosticMocks.getFeaturedContentCacheDocument).toHaveBeenCalledOnce());
        const { beginHomeLibraryVerification } = await import('../../pages/home/homeLibraryTransitionFreshness');
        beginHomeLibraryVerification(null);
        resolve(document());
        await pending;
        expect(cache.getFeaturedContentCacheStatus({ prime: false }).lastReadOutcome).not.toBe('in-progress');
    });

    it('separates semantic rejection from transport failure', async () => {
        diagnosticMocks.document = { version: 1, featuredContent: { version: 7, payload: payload() } };
        const cache = await loadCache();
        await expect(cache.getCachedFeaturedContentPayload()).resolves.toBeNull();
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            countsObserved: false,
            lastReadFailureCategory: 'semantic',
            lastReadOutcome: 'rejected'
        });
    });

    it.each([
        [ 'transport', new Error('Network request failed') ],
        [ 'authentication', Object.assign(new Error('Unauthorized'), { status: 401 }) ],
        [ 'timeout', new Error('Cache request timed out') ]
    ])('classifies %s read failures without exporting error text', async (category, error) => {
        diagnosticMocks.getFeaturedContentCacheDocument.mockRejectedValueOnce(error);
        const cache = await loadCache();
        await expect(cache.getCachedFeaturedContentPayload()).resolves.toBeNull();
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            countsObserved: false,
            lastReadFailureCategory: category,
            lastReadOutcome: 'failed'
        });
    });

    it('records a failed actual write without treating a later read as a write recovery', async () => {
        diagnosticMocks.writeFeaturedContentCacheDocument.mockRejectedValueOnce(new Error('disk unavailable'));
        const cache = await loadCache();
        await cache.getFeaturedContent(async () => payload());
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            lastWriteOutcome: 'failed'
        });
        vi.setSystemTime(Date.now() + 12 * 60 * 60 * 1000 + 1);
        diagnosticMocks.document = document();
        await cache.getCachedFeaturedContentPayload();
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            lastReadOutcome: 'adopted',
            lastWriteOutcome: 'failed',
            writeError: expect.any(String)
        });
    });

    it('does not publish a pending previous owner read after an identity change', async () => {
        let resolve!: (value: unknown) => void;
        diagnosticMocks.getFeaturedContentCacheDocument.mockImplementationOnce(() => new Promise(done => {
            resolve = done;
        }));
        const cache = await loadCache();
        const oldRead = cache.getCachedFeaturedContentPayload();
        await vi.waitFor(() => expect(diagnosticMocks.getFeaturedContentCacheDocument).toHaveBeenCalledOnce());
        diagnosticMocks.serverId = 'server-b';
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            countsObserved: false,
            lastReadOutcome: 'not-attempted'
        });
        resolve(document());
        await expect(oldRead).rejects.toMatchObject({ name: 'AbortError' });
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            countsObserved: false,
            lastReadOutcome: 'not-attempted'
        });
    });

    it('keeps passive status observation from changing cache ownership', async () => {
        const cache = await loadCache();
        await cache.getFeaturedContent(async () => payload());
        const ownerStatus = cache.getFeaturedContentCacheStatus({ prime: false });
        const reads = diagnosticMocks.getFeaturedContentCacheDocument.mock.calls.length;
        const writes = diagnosticMocks.writeFeaturedContentCacheDocument.mock.calls.length;

        diagnosticMocks.userId = 'user-b';
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            cacheVersion: null,
            countsObserved: false,
            lastReadOutcome: 'not-attempted',
            lastWriteOutcome: 'not-attempted'
        });
        diagnosticMocks.userId = 'user-a';
        expect(cache.getFeaturedContentCacheStatus({ prime: false })).toMatchObject({
            cacheVersion: ownerStatus.cacheVersion,
            createdAt: ownerStatus.createdAt,
            lastWriteOutcome: 'verified'
        });
        expect(diagnosticMocks.getFeaturedContentCacheDocument).toHaveBeenCalledTimes(reads);
        expect(diagnosticMocks.writeFeaturedContentCacheDocument).toHaveBeenCalledTimes(writes);
    });
});
