import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rowMocks = vi.hoisted(() => ({
    currentApiClient: null as Record<string, unknown> | null,
    currentUserId: 'user-a',
    imageLoads: [] as Array<{
        cancel: ReturnType<typeof vi.fn>;
        promise: Promise<boolean>;
        resolve: (value: boolean) => void;
        url: string;
    }>,
    lazyImage: vi.fn(),
    requestJson: vi.fn()
}));

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(complete => {
        resolve = complete;
    });

    return { promise, resolve };
}

vi.mock('components/cardbuilder/cardBuilder', () => ({
    default: {
        getCardsHtml: vi.fn(() => '')
    }
}));

vi.mock('components/images/imageLoader', () => ({
    default: {
        lazyChildren: vi.fn(),
        lazyImage: rowMocks.lazyImage
    }
}));

vi.mock('ptv/api/client', () => ({
    getPtvApiClient: vi.fn(() => rowMocks.currentApiClient),
    getPtvCurrentUserId: vi.fn(() => rowMocks.currentUserId),
    requestPtvJson: rowMocks.requestJson
}));

vi.mock('ptv/api/images', () => ({
    getPtvImageFailureDiagnostics: vi.fn(() => ({})),
    hasPtvImageUrlFailed: vi.fn(() => false),
    markPtvImageUrlFailed: vi.fn(),
    recordPtvImageFallback: vi.fn()
}));

vi.mock('ptv/core/clientProfile', () => ({
    getPtvPerformanceProfile: vi.fn(() => ({
        enableRowBackdrops: true,
        featuredFetchConcurrency: 2,
        featuredRowLimit: 8,
        forceLoadRowImages: false,
        homeInitialRowCount: 2,
        isLowPower: false,
        isWebOs: false,
        rowBackdropMaxWidth: 1280,
        rowItemLimit: 16,
        rowPrimaryMaxWidth: 640
    }))
}));

vi.mock('ptv/core/imageManager', () => ({
    cleanupPtvLazyImages: vi.fn(),
    enhancePtvLazyImageAttributes: vi.fn(),
    loadPtvImage: vi.fn((url: string) => {
        let resolve!: (value: boolean) => void;
        const promise = new Promise<boolean>(complete => {
            resolve = complete;
        });
        const handle = {
            cancel: vi.fn(),
            promise,
            resolve,
            url
        };

        rowMocks.imageLoads.push(handle);
        return handle;
    }),
    observePtvLazyImages: vi.fn(() => vi.fn())
}));

vi.mock('ptv/core/observability', () => ({
    recordPtvEvent: vi.fn(),
    shouldCollectDiagnostics: vi.fn(() => false),
    timePtvAsync: vi.fn((_category: string, _name: string, work: () => unknown) => work())
}));

vi.mock('ptv/core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: vi.fn(() => null)
}));

vi.mock('ptv/modules/cache/featuredContentCache', () => ({
    getFeaturedContent: vi.fn((fetcher: () => Promise<unknown>) => fetcher())
}));

vi.mock('ptv/modules/cards/qualityTags', () => ({
    getPtvQualityTags: vi.fn(() => [])
}));

vi.mock('ptv/modules/hero/useHeroItems', () => ({
    loadSharedHeroItems: vi.fn((apiClient: { getItems: (userId: string, query: object) => Promise<unknown> }, userId: string) => (
        apiClient.getItems(userId, { IncludeItemTypes: 'Movie,Series', Limit: 2 })
            .then(() => [])
    ))
}));

vi.mock('utils/card', () => ({
    getBackdropShape: vi.fn(() => 'overflowBackdrop'),
    getPortraitShape: vi.fn(() => 'overflowPortrait'),
    getSquareShape: vi.fn(() => 'overflowSquare')
}));

import {
    PTV_HOME_ROWS,
    cleanupPtvRowBackdrops,
    createFeaturedContentFetcher,
    getRowsFromFeaturedPayload,
    loadGenreMap,
    loadStudioMap,
    renderLibraryRow,
    renderMediaRow,
    resumePtvRowVisuals
} from './ptvRows';

describe('legacy Featured configured omission', () => {
    it('omits unverified configured sections without replacing them with generic fallback rows', () => {
        const rows = getRowsFromFeaturedPayload({
            sections: [{ id: 'configured', title: 'Configured', rowType: 'configured-rule' }]
        }, [
            { ...PTV_HOME_ROWS[0], id: 'media', title: 'Media', type: 'libraries' },
            { ...PTV_HOME_ROWS[0], id: 'fallback', title: 'Fallback', type: 'featured' }
        ]);
        expect(rows.map((row: { id: string }) => row.id)).toEqual(['media']);
    });

    it('keeps independent generic sections while omitting malformed or valid configured metadata', () => {
        const rows = getRowsFromFeaturedPayload({
            rowConfigApplied: true,
            sections: [
                { id: 'generic', title: 'Generic', type: 'featured' },
                { id: 'malformed', title: 'Malformed', configuredRowAssociation: null },
                { id: 'configured', title: 'Configured', rowType: 'configured-rule', configuredPresentationAuthority: 'proof' }
            ]
        }, []);
        expect(rows.map((row: { id: string }) => row.id)).toEqual(['generic']);
    });

    it('rejects configured direct rendering before a shell or fetch owner is created', () => {
        const elem = document.createElement('div');
        renderMediaRow(elem, null, 'synthetic-user', { id: 'configured', rowType: 'configured-rule' }, null, [], {});
        expect(elem.innerHTML).toBe('');
    });
});

function createApiClient() {
    const apiClient = {
        getScaledImageUrl: vi.fn((itemId: string) => `https://jellyfin.test/scaled/${itemId}`),
        getUrl: vi.fn((path: string) => `https://jellyfin.test/${path}`),
        serverId: () => 'server-a'
    };

    rowMocks.currentApiClient = apiClient;
    return apiClient;
}

function createRouteOwner() {
    // eslint-disable-next-line compat/compat -- Production route ownership requires an AbortSignal.
    const controller = new AbortController();
    const lifetime = {
        identity: 'legacy-home:route-a:1',
        signal: controller.signal
    };

    return {
        controller,
        options: {
            isRouteCurrent: () => !controller.signal.aborted,
            performanceProfile: {
                enableRowBackdrops: true,
                forceLoadRowImages: false,
                isLowPower: false,
                isWebOs: false,
                rowBackdropMaxWidth: 1280,
                rowItemLimit: 16,
                rowPrimaryMaxWidth: 640
            },
            routeOwnerRef: { lifetime }
        }
    };
}

function createForcedImageRow(
    imageUrl = 'https://jellyfin.test/image/one',
    rowId = 'forced-row'
) {
    const { controller, options } = createRouteOwner();
    const itemsContainer = document.createElement('div') as HTMLDivElement & {
        ptvLazyImageCleanup?: (() => void) | null;
        ptvRowOptions?: Record<string, unknown>;
    };
    const image = document.createElement('img');

    options.performanceProfile.forceLoadRowImages = true;
    itemsContainer.className = 'itemsContainer';
    itemsContainer.dataset.ptvRowId = rowId;
    itemsContainer.ptvRowOptions = options;
    image.className = 'lazy';
    image.dataset.src = imageUrl;
    itemsContainer.append(image);
    document.body.append(itemsContainer);

    return { controller, image, itemsContainer, options };
}

describe('legacy Home row request and publication ownership', () => {
    beforeEach(() => {
        rowMocks.currentUserId = 'user-a';
        rowMocks.imageLoads.length = 0;
        rowMocks.requestJson.mockReset();
        rowMocks.requestJson.mockResolvedValue({ Items: [] });
    });

    afterEach(() => {
        cleanupPtvRowBackdrops();
        document.body.innerHTML = '';
        rowMocks.currentApiClient = null;
        vi.clearAllMocks();
    });

    it('gives a route row an owned child signal that retires with the route', async () => {
        const apiClient = createApiClient();
        const { controller, options } = createRouteOwner();
        const row = document.createElement('section');

        document.body.append(row);
        renderMediaRow(row, apiClient, 'user-a', {
            id: 'route-row',
            itemTypes: 'Movie',
            title: 'Route row',
            type: 'latest',
            userScoped: true
        }, {
            genresByName: new Map(),
            studiosByName: new Map()
        }, [], options);

        const itemsContainer = row.querySelector('.itemsContainer') as HTMLElement & {
            fetchData: () => Promise<unknown>;
        };
        const request = itemsContainer.fetchData();
        const requestOptions = rowMocks.requestJson.mock.calls[0]?.[1] as {
            scope?: string;
            signal?: AbortSignal;
        };

        expect(requestOptions.scope).toBe('route');
        expect(requestOptions.signal).toBeInstanceOf(AbortSignal);
        expect(requestOptions.signal).not.toBe(controller.signal);
        expect(requestOptions.signal?.aborted).toBe(false);

        controller.abort();

        expect(requestOptions.signal?.aborted).toBe(true);
        await request;
    });

    it('keeps shared Featured support reads application-owned and identity-bound', async () => {
        const apiClient = createApiClient();
        const fetchFeatured = createFeaturedContentFetcher(
            apiClient,
            'user-a',
            [{ id: 'featured-row', itemTypes: 'Movie', title: 'Featured', type: 'latest' }],
            { genresByName: new Map(), studiosByName: new Map() },
            [],
            { performanceProfile: { featuredFetchConcurrency: 2, featuredRowLimit: 8, homeInitialRowCount: 2 } }
        );

        await fetchFeatured();

        expect(rowMocks.requestJson).toHaveBeenCalledTimes(2);
        rowMocks.requestJson.mock.calls.forEach(([, requestOptions ]) => {
            expect(requestOptions).toMatchObject({
                scope: 'background',
                serverId: 'server-a'
            });
            expect(requestOptions).not.toHaveProperty('signal');
        });

        rowMocks.currentUserId = 'user-b';

        await expect(fetchFeatured()).rejects.toMatchObject({ name: 'AbortError' });
        expect(rowMocks.requestJson).toHaveBeenCalledTimes(2);
    });

    it('rejects an in-flight shared Featured completion after the active server changes', async () => {
        const apiClient = createApiClient();
        const response = createDeferred<{ Items: never[] }>();

        rowMocks.requestJson.mockReturnValue(response.promise);
        const fetchFeatured = createFeaturedContentFetcher(
            apiClient,
            'user-a',
            [{ id: 'featured-row', itemTypes: 'Movie', title: 'Featured', type: 'latest' }],
            { genresByName: new Map(), studiosByName: new Map() },
            [],
            { performanceProfile: { featuredFetchConcurrency: 2, featuredRowLimit: 8, homeInitialRowCount: 2 } }
        );
        const pendingFetch = fetchFeatured();

        await Promise.resolve();
        rowMocks.currentApiClient = {
            getScaledImageUrl: vi.fn(),
            getUrl: vi.fn(),
            serverId: () => 'server-b'
        };
        response.resolve({ Items: [] });

        await expect(pendingFetch).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('uses owned bounded background transport for genre and studio support reads', async () => {
        const apiClient = createApiClient();

        await Promise.all([
            loadGenreMap(apiClient, 'user-a'),
            loadStudioMap(apiClient, 'user-a')
        ]);

        expect(rowMocks.requestJson.mock.calls.map(([path]) => path)).toEqual(['Genres', 'Studios']);
        rowMocks.requestJson.mock.calls.forEach(([, requestOptions ]) => {
            expect(requestOptions).toMatchObject({
                scope: 'background',
                serverId: 'server-a'
            });
            expect(requestOptions).not.toHaveProperty('signal');
        });
    });

    it('cancels and generation-rejects an old backdrop load after a newer authoritative clear', async () => {
        const apiClient = createApiClient();
        const { options } = createRouteOwner();
        const row = document.createElement('section');

        document.body.append(row);
        renderLibraryRow(row, apiClient, [{
            BackdropImageTags: ['old-tag'],
            Id: 'old-item',
            Name: 'Old item'
        }], options, PTV_HOME_ROWS[0]);

        expect(rowMocks.imageLoads).toHaveLength(1);
        const oldLoad = rowMocks.imageLoads[0];

        renderLibraryRow(row, apiClient, [], options, PTV_HOME_ROWS[0]);

        expect(oldLoad.cancel).toHaveBeenCalledTimes(1);
        oldLoad.resolve(true);
        await oldLoad.promise;
        await Promise.resolve();

        expect(row.classList.contains('ptv-row-has-backdrop')).toBe(false);
        expect(row.style.getPropertyValue('--ptv-row-backdrop-image')).toBe('');
        expect(row.querySelector('.ptv-row-backdrop')?.getAttribute('style')).toBeNull();

        cleanupPtvRowBackdrops();
    });

    it('retains one forced row-image consumer while repeated resume calls share the same owner', () => {
        createForcedImageRow();

        resumePtvRowVisuals();
        resumePtvRowVisuals();

        expect(rowMocks.imageLoads).toHaveLength(1);
        expect(rowMocks.imageLoads[0].cancel).not.toHaveBeenCalled();
    });

    it('releases a forced row-image consumer on cleanup and rejects its late DOM publication', async () => {
        const { itemsContainer } = createForcedImageRow();

        resumePtvRowVisuals();
        const load = rowMocks.imageLoads[0];

        cleanupPtvRowBackdrops(itemsContainer);

        expect(load.cancel).toHaveBeenCalledTimes(1);
        load.resolve(true);
        await load.promise;
        await Promise.resolve();

        expect(rowMocks.lazyImage).not.toHaveBeenCalled();
    });

    it('releases only the retired row consumer while another shared-image owner remains', () => {
        const first = createForcedImageRow('https://jellyfin.test/image/shared', 'forced-row-a');
        createForcedImageRow('https://jellyfin.test/image/shared', 'forced-row-b');

        resumePtvRowVisuals();

        expect(rowMocks.imageLoads).toHaveLength(2);
        cleanupPtvRowBackdrops(first.itemsContainer);

        expect(rowMocks.imageLoads[0].cancel).toHaveBeenCalledOnce();
        expect(rowMocks.imageLoads[1].cancel).not.toHaveBeenCalled();
    });

    it('retires a replaced forced row-image URL without increasing same-URL fan-out', async () => {
        const { image } = createForcedImageRow();

        resumePtvRowVisuals();
        const firstLoad = rowMocks.imageLoads[0];

        image.dataset.src = 'https://jellyfin.test/image/two';
        resumePtvRowVisuals();
        resumePtvRowVisuals();

        expect(firstLoad.cancel).toHaveBeenCalledTimes(1);
        expect(rowMocks.imageLoads).toHaveLength(2);

        firstLoad.resolve(true);
        await firstLoad.promise;
        await Promise.resolve();
        expect(rowMocks.lazyImage).not.toHaveBeenCalled();

        rowMocks.imageLoads[1].resolve(true);
        await rowMocks.imageLoads[1].promise;
        await Promise.resolve();
        expect(rowMocks.lazyImage).toHaveBeenCalledTimes(1);
        expect(rowMocks.lazyImage).toHaveBeenCalledWith(image);
    });
});
