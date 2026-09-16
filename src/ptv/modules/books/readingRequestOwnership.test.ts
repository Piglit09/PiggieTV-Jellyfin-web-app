import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    getPtvItems: vi.fn(),
    getPtvUserViews: vi.fn()
}));
const cacheMocks = vi.hoisted(() => ({
    clearLocalStorageByPrefix: vi.fn<(prefixes: string[]) => number>(() => 0),
    deleteLibraryIndex: vi.fn(async () => undefined),
    deleteLibraryIndexesByPrefix: vi.fn(async () => undefined)
}));

vi.mock('../../api', () => ({
    cleanPtvQuery: vi.fn((query: Record<string, unknown> | undefined) => query),
    getPtvApiUrl: vi.fn((endpoint: string) => `https://jellyfin.test/${endpoint}`),
    getPtvCurrentUserId: vi.fn(() => 'user-a'),
    getPtvItem: vi.fn(async (itemId: string) => ({
        Id: itemId,
        Name: 'Item'
    })),
    getPtvItemImageCandidates: vi.fn(() => []),
    getPtvItems: apiMocks.getPtvItems,
    getPtvServerId: vi.fn(() => 'server-a'),
    getPtvUserViews: apiMocks.getPtvUserViews
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    recordPtvTiming: vi.fn(),
    timePtvAsync: vi.fn(async (
        _category: string,
        _name: string,
        task: () => Promise<unknown>
    ) => task())
}));

vi.mock('../../services/runtimeStability', () => ({
    clearPtvLocalStorageByPrefix: cacheMocks.clearLocalStorageByPrefix,
    readPtvLocalStorageJson: vi.fn((_key: string, fallback: unknown) => fallback),
    removePtvLocalStorageKey: vi.fn(),
    writePtvLocalStorageJson: vi.fn(() => true)
}));

vi.mock('../../utils/libraryIndexCache', () => ({
    deletePtvLibraryIndexCache: cacheMocks.deleteLibraryIndex,
    deletePtvLibraryIndexCacheByPrefix: cacheMocks.deleteLibraryIndexesByPrefix,
    ['PTV_LIBRARY_INDEX_CACHE_TTL_MS']: 24 * 60 * 60 * 1000,
    readPtvLibraryIndexCache: vi.fn(async () => null),
    writePtvLibraryIndexCache: vi.fn(async () => true)
}));

type PtvItemsOptions = {
    signal?: AbortSignal;
};

function createAbortError() {
    return Object.assign(new Error('Request aborted.'), {
        name: 'AbortError'
    });
}

function installAbortableItemsRequest(observedSignals: AbortSignal[]) {
    apiMocks.getPtvItems.mockImplementation((
        _query: Record<string, unknown>,
        options: PtvItemsOptions
    ) => new Promise((_resolve, reject) => {
        if (options.signal) observedSignals.push(options.signal);
        options.signal?.addEventListener('abort', () => reject(createAbortError()), {
            once: true
        });
    }));
}

async function loadBooksApi() {
    return import('./booksApi');
}

describe('Reading request ownership', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useRealTimers();
        localStorage.clear();
        apiMocks.getPtvItems.mockReset();
        apiMocks.getPtvUserViews.mockReset();
        cacheMocks.clearLocalStorageByPrefix.mockClear();
        cacheMocks.deleteLibraryIndex.mockClear();
        cacheMocks.deleteLibraryIndexesByPrefix.mockClear();
        apiMocks.getPtvUserViews.mockResolvedValue({
            Items: [{
                CollectionType: 'books',
                Id: 'books-library',
                Name: 'Books'
            }],
            TotalRecordCount: 1
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('physically aborts the coordinated item consumer on route retirement without fallback', async () => {
        const observedSignals: AbortSignal[] = [];

        installAbortableItemsRequest(observedSignals);
        // eslint-disable-next-line compat/compat -- Jellyfin installs its AbortController polyfill before PTV starts.
        const controller = new AbortController();
        const { fetchPtvReadingItems } = await loadBooksApi();
        const request = fetchPtvReadingItems('books', {}, 12, {
            signal: controller.signal
        });

        await vi.waitFor(() => {
            expect(apiMocks.getPtvItems).toHaveBeenCalledTimes(1);
        });
        controller.abort();

        await expect(request).rejects.toMatchObject({
            name: 'AbortError'
        });
        expect(observedSignals).toHaveLength(1);
        expect(observedSignals[0]?.aborted).toBe(true);
        expect(apiMocks.getPtvItems).toHaveBeenCalledTimes(1);
    });

    it('physically aborts an optional shelf at seven seconds and records a shelf-local timeout', async () => {
        vi.useFakeTimers();
        const observedSignals: AbortSignal[] = [];

        installAbortableItemsRequest(observedSignals);
        const { fetchPtvReadingHomeSection } = await loadBooksApi();
        const request = fetchPtvReadingHomeSection('books', 'continue-reading');

        await vi.advanceTimersByTimeAsync(0);
        expect(apiMocks.getPtvItems).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(7_000);

        const section = await request;

        expect(section.error).toMatch(/timed out after 7000ms/i);
        expect(section.diagnostics).toMatchObject({
            status: 'error',
            timeoutReason: expect.stringMatching(/timed out after 7000ms/i)
        });
        expect(observedSignals).toHaveLength(1);
        expect(observedSignals[0]?.aborted).toBe(true);
        expect(apiMocks.getPtvItems).toHaveBeenCalledTimes(1);
    });

    it('does not promote unrelated Jellyfin views into Reading libraries', async () => {
        apiMocks.getPtvUserViews.mockResolvedValue({
            Items: [
                { CollectionType: 'movies', Id: 'movies', Name: 'Movies' },
                { CollectionType: 'tvshows', Id: 'shows', Name: 'Shows' },
                { CollectionType: 'music', Id: 'music', Name: 'Music' },
                { CollectionType: 'books', Id: 'books', Name: 'Books and Comics' }
            ],
            TotalRecordCount: 4
        });
        const { getPtvReadingLibraries } = await loadBooksApi();

        await expect(getPtvReadingLibraries()).resolves.toEqual([
            expect.objectContaining({
                id: 'books',
                name: 'Books and Comics'
            })
        ]);
    });

    it('requests the card metadata and primary image identity used by the progressive library index', async () => {
        apiMocks.getPtvItems.mockResolvedValue({
            Items: [{
                Container: 'epub',
                Id: 'book-with-cover',
                ImageTags: { Primary: 'cover-tag' },
                Name: 'Book with cover',
                Path: '/Books/Book with cover.epub',
                Type: 'Book'
            }],
            TotalRecordCount: 1
        });
        const { fetchPtvReadingLibraryIndex } = await loadBooksApi();
        const index = await fetchPtvReadingLibraryIndex('books', { forceRefresh: true });
        const imageRequest = apiMocks.getPtvItems.mock.calls
            .map(([query]) => query as Record<string, unknown>)
            .find(query => query.EnableImages === true);

        expect(imageRequest).toMatchObject({
            EnableImageTypes: 'Primary,Backdrop,Thumb',
            EnableImages: true,
            ImageTypeLimit: 1
        });
        expect(String(imageRequest?.Fields)).toContain('ImageTags');
        expect(String(imageRequest?.Fields)).toContain('People');
        expect(String(imageRequest?.Fields)).toContain('ProductionYear');
        expect(String(imageRequest?.Fields)).toContain('ProviderIds');
        expect(String(imageRequest?.Fields)).toContain('SeriesName');
        expect(index.items[0]?.ImageTags?.Primary).toBe('cover-tag');
    });

    it('invalidates only affected persisted routes after a Manga metadata update', async () => {
        const { invalidatePtvReadingMetadataCache } = await loadBooksApi();

        invalidatePtvReadingMetadataCache({
            Container: 'cbz',
            Id: 'private-item',
            Name: 'Private title',
            PtvReadingKindOverride: 'manga',
            Type: 'Book'
        });

        expect(cacheMocks.clearLocalStorageByPrefix).toHaveBeenCalledTimes(1);
        const prefixes = cacheMocks.clearLocalStorageByPrefix.mock.calls[0]?.[0] as string[];

        expect(prefixes).toEqual(expect.arrayContaining([
            'ptv:reading-home:server-a:user-a:reading:',
            'ptv:reading-home:server-a:user-a:books:',
            'ptv:reading-home:server-a:user-a:manga:'
        ]));
        expect(prefixes.some(prefix => prefix.includes(':comics:'))).toBe(false);
        expect(cacheMocks.deleteLibraryIndex).toHaveBeenCalledTimes(3);
        expect(cacheMocks.deleteLibraryIndexesByPrefix).not.toHaveBeenCalled();
        expect(apiMocks.getPtvUserViews).not.toHaveBeenCalled();
        expect(apiMocks.getPtvItems).not.toHaveBeenCalled();
    });
});
