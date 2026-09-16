import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
};

type TestApiClient = {
    getCurrentUserId: () => string;
    marker: string;
};

type TestLifetime = Readonly<{
    active: boolean;
    generation: number;
    identity: string;
    isCurrent: () => boolean;
    retired: boolean;
    routeFamily: string;
    routeKey: string;
    signal: AbortSignal;
}>;

type TestHomeContainer = HTMLElement & {
    ptvFeaturedCacheCleanup?: (() => void) | null;
    ptvRowMountCleanup?: (() => void) | null;
    ptvRowMountObserver?: TestIntersectionObserver | null;
    ptvVirtualRowContext?: {
        apiClient: TestApiClient;
    } | null;
};

const sectionMocks = vi.hoisted(() => ({
    cancelImageScope: vi.fn(),
    captureRouteCriticalOwner: vi.fn(() => ({
        lifecycleId: 'home-critical-1',
        navigationKey: '/home',
        routeFamily: 'home',
        routeGeneration: 1,
        routeKey: 'home-route-key'
    })),
    cleanupCardEnhancements: vi.fn(),
    cleanupDisconnectedHeroes: vi.fn(),
    cleanupRowBackdrops: vi.fn(),
    createOwnedHomeApiClient: vi.fn((apiClient: TestApiClient) => apiClient),
    enhanceCards: vi.fn(),
    featuredEvent: 'ptv-test-featured-cache-updated',
    getFeaturedContent: vi.fn(),
    mountHero: vi.fn(),
    queryResponses: [] as Array<Promise<{ Items: Array<{ Id: string }> }>>,
    recordEvent: vi.fn(),
    recordRouteCriticalPending: vi.fn(),
    recordRouteCriticalTerminal: vi.fn(),
    renderLibraryRow: vi.fn(),
    renderMediaRow: vi.fn(),
    resumeRowVisuals: vi.fn(),
    trimImageMemory: vi.fn(),
    unmountHero: vi.fn()
}));

vi.mock('ptv/pages/home/mountHero', () => ({
    cleanupDisconnectedPtvHomeHeroes: sectionMocks.cleanupDisconnectedHeroes,
    default: sectionMocks.mountHero,
    unmountPtvHomeHero: sectionMocks.unmountHero
}));

vi.mock('ptv/core/imageManager', () => ({
    cancelPtvImageScope: sectionMocks.cancelImageScope,
    trimPtvImageManagerMemory: sectionMocks.trimImageMemory
}));

vi.mock('ptv/modules/cards/CardEnhancer', () => ({
    cleanupPtvCardEnhancements: sectionMocks.cleanupCardEnhancements,
    enhancePtvCards: sectionMocks.enhanceCards
}));

vi.mock('ptv/modules/cache/featuredContentCache', () => ({
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Mirrors the production module export.
    FEATURED_CACHE_UPDATED_EVENT: sectionMocks.featuredEvent,
    getFeaturedContent: sectionMocks.getFeaturedContent
}));

vi.mock('ptv/core/clientProfile', () => ({
    getPtvPerformanceProfile: vi.fn(() => ({
        clientKind: 'desktop',
        homeInitialRowCount: 1,
        homeRowLimit: 1,
        homeRowViewportRootMargin: '0px',
        isLowPower: false,
        renderProfile: {
            id: 'test-profile',
            tier: 'test-tier'
        },
        sectionResumeBatchDelayMs: 10,
        sectionResumeBatchSize: 1
    }))
}));

vi.mock('ptv/core/featureSettings', () => ({
    getPtvFeatureSettings: vi.fn(() => ({
        heroEnabled: true,
        homeRowsEnabled: true
    }))
}));

vi.mock('ptv/core/observability', () => ({
    recordPtvEvent: sectionMocks.recordEvent,
    timePtvAsync: vi.fn((_category: string, _name: string, work: () => unknown) => work())
}));

vi.mock('ptv/core/safeConsole', () => ({
    ptvSafeConsole: {
        warn: vi.fn()
    }
}));

vi.mock('ptv/api/libraries', () => ({
    getPtvUserViews: vi.fn(() => {
        const response = sectionMocks.queryResponses.shift();

        if (!response) throw new Error('Missing queued User Views response');

        return response;
    })
}));

vi.mock('ptv/shell/routeController', () => ({
    retirePtvRouteLifetime: vi.fn(() => true)
}));

vi.mock('ptv/shell/routeCriticalLifecycle', () => ({
    capturePtvRouteCriticalLifecycleOwner: sectionMocks.captureRouteCriticalOwner,
    recordPtvRouteCriticalPending: sectionMocks.recordRouteCriticalPending,
    recordPtvRouteCriticalTerminal: sectionMocks.recordRouteCriticalTerminal
}));

vi.mock('hooks/useUserViews', () => ({
    getUserViewsQuery: vi.fn((apiClient: TestApiClient) => ({ apiClient }))
}));

vi.mock('lib/globalize', () => ({
    default: {
        translate: vi.fn((key: string) => key)
    }
}));

vi.mock('types/homeSectionType', () => ({
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Mirrors the production module export.
    DEFAULT_SECTIONS: []
}));

vi.mock('utils/dashboard', () => ({
    default: {
        navigate: vi.fn()
    }
}));

vi.mock('utils/jellyfin-apiclient/compat', () => ({
    toApi: vi.fn((apiClient: TestApiClient) => apiClient)
}));

vi.mock('utils/query/queryClient', () => ({
    queryClient: {
        fetchQuery: vi.fn(() => {
            const response = sectionMocks.queryResponses.shift();

            if (!response) throw new Error('Missing queued User Views response');

            return response;
        })
    }
}));

vi.mock('./ptvRows', () => ({
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Mirrors the production module export.
    PTV_HOME_ROWS: [{
        id: 'seed-row',
        title: 'Seed row',
        type: 'libraries'
    }],
    cleanupPtvRowBackdrops: sectionMocks.cleanupRowBackdrops,
    createOwnedHomeApiClient: sectionMocks.createOwnedHomeApiClient,
    createFeaturedContentFetcher: vi.fn((apiClient: TestApiClient) => () => Promise.resolve({
        heroItems: [],
        rowConfigApplied: true,
        rows: [{
            id: `row-${apiClient.marker}`,
            title: `Row ${apiClient.marker}`,
            type: 'libraries'
        }],
        sectionItems: {},
        sections: [{ id: `row-${apiClient.marker}` }]
    })),
    getRowsFromFeaturedPayload: vi.fn((payload: { rows?: unknown[] }) => payload?.rows || []),
    loadGenreMap: vi.fn(() => Promise.resolve(new Map())),
    loadStudioMap: vi.fn(() => Promise.resolve(new Map())),
    renderLibraryRow: sectionMocks.renderLibraryRow,
    renderMediaRow: sectionMocks.renderMediaRow,
    resumePtvRowVisuals: sectionMocks.resumeRowVisuals
}));

vi.mock('elements/emby-button/paper-icon-button-light', () => ({}));
vi.mock('elements/emby-itemscontainer/emby-itemscontainer', () => ({}));
vi.mock('elements/emby-scroller/emby-scroller', () => ({}));
vi.mock('elements/emby-button/emby-button', () => ({}));

import {
    destroySections,
    loadSections,
    pause,
    resume
} from './homesections';

class TestIntersectionObserver {
    // eslint-disable-next-line sonarjs/public-static-readonly -- Reset between isolated test cases.
    static instances: TestIntersectionObserver[] = [];

    disconnect = vi.fn();
    observe = vi.fn();
    unobserve = vi.fn();

    constructor() {
        TestIntersectionObserver.instances.push(this);
    }
}

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(promiseResolve => {
        resolve = promiseResolve;
    });

    return { promise, resolve };
}

function createLifetime(generation: number) {
    // eslint-disable-next-line compat/compat -- The production lifetime contract requires an AbortSignal.
    const abortController = new AbortController();
    let retired = false;
    const lifetime: TestLifetime = Object.freeze({
        get active() {
            return !retired;
        },
        generation,
        identity: `legacy-home-${generation}`,
        isCurrent: () => !retired && !abortController.signal.aborted,
        get retired() {
            return retired;
        },
        routeFamily: 'legacy-home',
        routeKey: '/home.html',
        signal: abortController.signal
    });

    return {
        lifetime,
        retire: () => {
            if (retired) return;

            retired = true;
            abortController.abort();
        }
    };
}

function createApiClient(marker: string): TestApiClient {
    return {
        getCurrentUserId: () => `user-${marker}`,
        marker
    };
}

function createHomeContainer() {
    const elem = document.createElement('div') as TestHomeContainer;

    elem.className = 'sections';
    document.body.append(elem);

    return elem;
}

async function resolveLoad(
    deferred: Deferred<{ Items: Array<{ Id: string }> }>,
    load: Promise<unknown>,
    marker: string
) {
    deferred.resolve({ Items: [{ Id: `library-${marker}` }] });
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await load;
}

function getFeaturedListenerAdds(addEventListener: ReturnType<typeof vi.spyOn>) {
    return addEventListener.mock.calls.filter(call => call[0] === sectionMocks.featuredEvent);
}

function getCaptureOption(options: unknown) {
    if (typeof options === 'boolean') return options;

    return Boolean((options as AddEventListenerOptions | undefined)?.capture);
}

function expectOwnedListenersRemoved(
    addEventListener: ReturnType<typeof vi.spyOn>,
    removeEventListener: ReturnType<typeof vi.spyOn>,
    eventNames: Set<string>
) {
    const ownedRegistrations = addEventListener.mock.calls.filter(call => eventNames.has(String(call[0])));

    for (const registration of ownedRegistrations) {
        expect(removeEventListener.mock.calls.some(removal => (
            removal[0] === registration[0]
            && removal[1] === registration[1]
            && getCaptureOption(removal[2]) === getCaptureOption(registration[2])
        ))).toBe(true);
    }
}

describe('legacy Home section lifetime publication barrier', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        TestIntersectionObserver.instances = [];

        sectionMocks.getFeaturedContent.mockImplementation((fetcher: () => Promise<unknown>) => fetcher());
        sectionMocks.mountHero.mockImplementation((elem: HTMLElement, options: { apiClient: TestApiClient }) => {
            elem.dataset.heroOwner = options.apiClient.marker;
        });
        sectionMocks.unmountHero.mockImplementation((elem: HTMLElement) => {
            delete elem.dataset.heroOwner;
        });
        sectionMocks.renderLibraryRow.mockImplementation((elem: HTMLElement, apiClient: TestApiClient) => {
            elem.innerHTML = `<div class="itemsContainer" data-owner="${apiClient.marker}"></div>`;
            const itemsContainer = elem.querySelector('.itemsContainer') as HTMLElement & {
                parentContainer?: HTMLElement;
                pause?: () => void;
                resume?: () => Promise<void>;
            };

            itemsContainer.parentContainer = elem;
            itemsContainer.pause = vi.fn();
            itemsContainer.resume = vi.fn().mockResolvedValue(undefined);
        });
    });

    afterEach(() => {
        document.body.querySelectorAll<HTMLElement>('.sections').forEach(elem => {
            destroySections(elem);
        });
        document.body.innerHTML = '';
        sectionMocks.queryResponses.length = 0;
        vi.clearAllMocks();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('does not mount or revive unverified configured rows beside independent generic rows', async () => {
        sectionMocks.getFeaturedContent.mockResolvedValueOnce({
            heroItems: [],
            rowConfigApplied: true,
            rows: [
                { id: 'unverified', title: 'Unverified', type: 'featured', rowType: 'configured-rule' },
                { id: 'generic', title: 'Generic', type: 'libraries' }
            ],
            sectionItems: {},
            sections: []
        });
        const elem = createHomeContainer();
        const views = createDeferred<{ Items: Array<{ Id: string }> }>();
        const owner = createLifetime(1);
        sectionMocks.queryResponses.push(views.promise);
        const load = loadSections(elem, createApiClient('A'), { Id: 'user-A' }, {}, owner.lifetime);
        await resolveLoad(views, load, 'A');
        expect(elem.querySelector('[data-ptv-row-id="unverified"]')).toBeNull();
        expect(elem.querySelector('[data-ptv-row-id="generic"]')).not.toBeNull();
        expect(sectionMocks.renderMediaRow).not.toHaveBeenCalled();
        pause(elem);
        await resume(elem, {}, createLifetime(2).lifetime);
        expect(elem.querySelector('[data-ptv-row-id="unverified"]')).toBeNull();
        expect(sectionMocks.renderMediaRow).not.toHaveBeenCalled();
    });

    it('does not let retired A overwrite B or publish Hero, shelves, listeners, observers, timers, or current state', async () => {
        const addEventListener = vi.spyOn(window, 'addEventListener');
        const setTimeout = vi.spyOn(window, 'setTimeout');
        const viewsA = createDeferred<{ Items: Array<{ Id: string }> }>();
        const viewsB = createDeferred<{ Items: Array<{ Id: string }> }>();
        const generationA = createLifetime(1);
        const generationB = createLifetime(2);
        const elem = createHomeContainer();

        sectionMocks.queryResponses.push(viewsA.promise, viewsB.promise);

        const loadA = loadSections(
            elem,
            createApiClient('A'),
            { Id: 'user-A' },
            {},
            generationA.lifetime
        );

        generationA.retire();
        destroySections(elem);

        const loadB = loadSections(
            elem,
            createApiClient('B'),
            { Id: 'user-B' },
            {},
            generationB.lifetime
        );

        await resolveLoad(viewsB, loadB, 'B');
        viewsA.resolve({ Items: [{ Id: 'library-A' }] });
        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
        await loadA;

        expect(elem.dataset.heroOwner).toBe('B');
        expect(elem.querySelector('.itemsContainer')?.getAttribute('data-owner')).toBe('B');
        expect(elem.ptvVirtualRowContext?.apiClient.marker).toBe('B');
        expect(sectionMocks.mountHero).toHaveBeenCalledTimes(1);
        expect(sectionMocks.mountHero.mock.calls[0]?.[1]?.apiClient.marker).toBe('B');
        expect(sectionMocks.renderLibraryRow).toHaveBeenCalledTimes(1);
        expect(sectionMocks.renderLibraryRow.mock.calls[0]?.[1]?.marker).toBe('B');
        expect(getFeaturedListenerAdds(addEventListener)).toHaveLength(1);
        expect(TestIntersectionObserver.instances).toHaveLength(1);
        expect(sectionMocks.recordRouteCriticalPending).toHaveBeenCalledTimes(2);
        expect(sectionMocks.recordRouteCriticalTerminal).toHaveBeenCalledWith(
            expect.anything(),
            'success'
        );
        expect(sectionMocks.recordRouteCriticalTerminal).toHaveBeenCalledWith(
            expect.anything(),
            'cancelled'
        );

        for (const delay of [ 250, 420, 780, 1000 ]) {
            expect(setTimeout.mock.calls.filter(call => Number(call[1]) === delay)).toHaveLength(1);
        }
    });

    it('keeps only the newest publication across out-of-order navigation churn', async () => {
        const views = [
            createDeferred<{ Items: Array<{ Id: string }> }>(),
            createDeferred<{ Items: Array<{ Id: string }> }>(),
            createDeferred<{ Items: Array<{ Id: string }> }>()
        ];
        const generations = [ createLifetime(1), createLifetime(2), createLifetime(3) ];
        const elem = createHomeContainer();

        sectionMocks.queryResponses.push(...views.map(view => view.promise));

        const loads = generations.map((generation, index) => loadSections(
            elem,
            createApiClient(String.fromCharCode(65 + index)),
            { Id: `user-${index}` },
            {},
            generation.lifetime
        ));

        generations[0].retire();
        generations[1].retire();

        await resolveLoad(views[2], loads[2], 'C');
        await resolveLoad(views[0], loads[0], 'A');
        await resolveLoad(views[1], loads[1], 'B');

        expect(elem.dataset.heroOwner).toBe('C');
        expect(elem.querySelector('.itemsContainer')?.getAttribute('data-owner')).toBe('C');
        expect(elem.ptvVirtualRowContext?.apiClient.marker).toBe('C');
        expect(sectionMocks.mountHero).toHaveBeenCalledTimes(1);
        expect(sectionMocks.renderLibraryRow).toHaveBeenCalledTimes(1);
    });

    it('fully releases route-owned listeners, observers, and timers on every pause cycle', async () => {
        const elem = createHomeContainer();
        const windowAddEventListener = vi.spyOn(window, 'addEventListener');
        const windowRemoveEventListener = vi.spyOn(window, 'removeEventListener');
        const documentAddEventListener = vi.spyOn(document, 'addEventListener');
        const documentRemoveEventListener = vi.spyOn(document, 'removeEventListener');

        for (let cycle = 1; cycle <= 3; cycle++) {
            const views = createDeferred<{ Items: Array<{ Id: string }> }>();
            const generation = createLifetime(cycle);

            sectionMocks.queryResponses.push(views.promise);
            const load = loadSections(
                elem,
                createApiClient(`cycle-${cycle}`),
                { Id: `user-cycle-${cycle}` },
                {},
                generation.lifetime
            );

            await resolveLoad(views, load, `cycle-${cycle}`);
            const observer = elem.ptvRowMountObserver;

            expect(elem.ptvFeaturedCacheCleanup).toEqual(expect.any(Function));
            expect(elem.ptvRowMountCleanup).toEqual(expect.any(Function));

            generation.retire();
            pause(elem);

            expect(observer?.disconnect).toHaveBeenCalledTimes(1);
            expect(elem.ptvFeaturedCacheCleanup).toBeNull();
            expect(elem.ptvRowMountCleanup).toBeNull();
            expect(elem.ptvRowMountObserver).toBeNull();
            expect(vi.getTimerCount()).toBe(0);
            expectOwnedListenersRemoved(
                windowAddEventListener,
                windowRemoveEventListener,
                new Set([ sectionMocks.featuredEvent, 'resize' ])
            );
            expectOwnedListenersRemoved(
                documentAddEventListener,
                documentRemoveEventListener,
                new Set([ 'keydown', 'scroll', 'touchmove', 'wheel' ])
            );
        }

        expect(TestIntersectionObserver.instances).toHaveLength(3);
        expect(TestIntersectionObserver.instances.every(observer => observer.disconnect.mock.calls.length === 1)).toBe(true);
    });

    it('reinstalls virtual-row and visual ownership exactly once when a paused Home is resumed', async () => {
        const elem = createHomeContainer();
        const views = createDeferred<{ Items: Array<{ Id: string }> }>();
        const generationA = createLifetime(1);
        const generationB = createLifetime(2);

        sectionMocks.queryResponses.push(views.promise);
        const load = loadSections(
            elem,
            createApiClient('A'),
            { Id: 'user-A' },
            {},
            generationA.lifetime
        );

        await resolveLoad(views, load, 'A');
        const firstObserver = elem.ptvRowMountObserver;
        const firstHeroOptions = sectionMocks.mountHero.mock.calls[0]?.[1] as {
            isCurrent: () => boolean;
        };

        expect(sectionMocks.createOwnedHomeApiClient).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
            scope: 'route',
            signal: generationA.lifetime.signal
        }));
        expect(firstHeroOptions.isCurrent()).toBe(true);

        generationA.retire();
        pause(elem);

        expect(firstObserver?.disconnect).toHaveBeenCalledTimes(1);
        expect(elem.ptvRowMountObserver).toBeNull();
        expect(firstHeroOptions.isCurrent()).toBe(false);

        await resume(elem, {}, generationB.lifetime);

        const secondObserver = elem.ptvRowMountObserver;
        const secondHeroOptions = sectionMocks.mountHero.mock.calls[1]?.[1] as {
            isCurrent: () => boolean;
        };

        expect(secondObserver).toBeTruthy();
        expect(secondObserver).not.toBe(firstObserver);
        expect(secondHeroOptions).not.toBe(firstHeroOptions);
        expect(firstHeroOptions.isCurrent()).toBe(false);
        expect(secondHeroOptions.isCurrent()).toBe(true);
        expect(sectionMocks.createOwnedHomeApiClient).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({
            scope: 'route',
            signal: generationB.lifetime.signal
        }));
        expect(sectionMocks.resumeRowVisuals).toHaveBeenCalledTimes(1);
        expect(TestIntersectionObserver.instances).toHaveLength(2);
        expect(firstObserver?.disconnect).toHaveBeenCalledTimes(1);
        expect(secondObserver?.disconnect).not.toHaveBeenCalled();
    });
});
