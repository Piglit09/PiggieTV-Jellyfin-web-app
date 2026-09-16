import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
};

type RefreshResult = {
    Items: Array<{ Id: string }>;
};

type ItemsContainerPrototype = HTMLDivElement & {
    detachedCallback: () => void;
    pause: () => void;
    refreshItems: () => Promise<unknown>;
    resume: (options?: { refresh?: boolean }) => Promise<unknown>;
};

type TestItemsContainer = HTMLDivElement & {
    afterRefresh: ReturnType<typeof vi.fn> | null;
    fetchData: (() => Promise<RefreshResult>) | null;
    getItemsHtml: ((items: Array<{ Id: string }>) => string) | null;
    isDataOwnerCurrent: (() => boolean) | null;
    needsRefresh?: boolean;
    pause: () => void;
    paused?: boolean;
    ptvDataOwner: object | null;
    ptvRefreshGeneration?: number;
    ptvRefreshInFlightGeneration?: number;
    refreshTimeout?: number | null;
    refreshItems: () => Promise<unknown>;
    resume: (options?: { refresh?: boolean }) => Promise<unknown>;
};

const mocks = vi.hoisted(() => ({
    lazyChildren: vi.fn()
}));

vi.mock('webcomponents.js/webcomponents-lite', () => ({}));
vi.mock('sortablejs', () => ({ default: class TestSortable {} }));
vi.mock('components/shortcuts', () => ({
    default: {
        off: vi.fn(),
        on: vi.fn(),
        onClick: vi.fn()
    }
}));
vi.mock('scripts/inputManager', () => ({ default: { handleCommand: vi.fn() } }));
vi.mock('components/playback/playbackmanager', () => ({ playbackManager: {} }));
vi.mock('components/images/imageLoader', () => ({
    default: { lazyChildren: mocks.lazyChildren }
}));
vi.mock('components/layoutManager', () => ({
    default: {
        desktop: false,
        mobile: false,
        tv: false
    }
}));
vi.mock('scripts/browser', () => ({ default: { touch: false } }));
vi.mock('utils/dom', () => ({ default: { parentWithAttribute: vi.fn() } }));
vi.mock('components/loading/loading', () => ({
    default: {
        hide: vi.fn(),
        show: vi.fn()
    }
}));
vi.mock('components/focusManager', () => ({
    default: {
        autoFocus: vi.fn(),
        focus: vi.fn()
    }
}));
vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: { getApiClient: vi.fn() }
}));
vi.mock('scripts/serverNotifications', () => ({ default: {} }));
vi.mock('utils/events.ts', () => ({
    default: {
        off: vi.fn(),
        on: vi.fn()
    }
}));

let itemsContainerPrototype: ItemsContainerPrototype;

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(promiseResolve => {
        resolve = promiseResolve;
    });

    return { promise, resolve };
}

function createItemsContainer(owner: object): TestItemsContainer {
    const element = document.createElement('div') as TestItemsContainer;

    Object.setPrototypeOf(element, itemsContainerPrototype);
    element.afterRefresh = vi.fn();
    element.getItemsHtml = items => items.map(item => item.Id).join(',');
    element.isDataOwnerCurrent = () => true;
    element.ptvDataOwner = owner;

    return element;
}

beforeAll(async () => {
    Object.defineProperty(document, 'registerElement', {
        configurable: true,
        value: vi.fn((_name: string, options: { prototype: ItemsContainerPrototype }) => {
            itemsContainerPrototype = options.prototype;
        })
    });

    await import('./emby-itemscontainer');
});

beforeEach(() => {
    mocks.lazyChildren.mockClear();
});

describe('PTV ItemsContainer refresh ownership', () => {
    it('allows only the newest overlapping refresh for the same owner to publish', async () => {
        const older = createDeferred<RefreshResult>();
        const newer = createDeferred<RefreshResult>();
        const element = createItemsContainer({ generation: 1 });

        element.fetchData = vi.fn()
            .mockReturnValueOnce(older.promise)
            .mockReturnValueOnce(newer.promise);

        const olderRefresh = element.refreshItems();
        const newerRefresh = element.refreshItems();

        newer.resolve({ Items: [{ Id: 'newer' }] });
        await newerRefresh;
        older.resolve({ Items: [{ Id: 'older' }] });
        await olderRefresh;

        expect(element.innerHTML).toBe('newer');
        expect(element.afterRefresh).toHaveBeenCalledTimes(1);
        expect(element.afterRefresh).toHaveBeenCalledWith({ Items: [{ Id: 'newer' }] });
        expect(mocks.lazyChildren).toHaveBeenCalledTimes(1);
    });

    it('retries once on resume while suppressing the retired pre-pause refresh', async () => {
        const older = createDeferred<RefreshResult>();
        const newer = createDeferred<RefreshResult>();
        const originalOwner = { generation: 1 };
        const element = createItemsContainer(originalOwner);

        element.fetchData = vi.fn()
            .mockReturnValueOnce(older.promise)
            .mockReturnValueOnce(newer.promise);

        const olderRefresh = element.refreshItems();
        const olderGeneration = element.ptvRefreshInFlightGeneration;

        expect(olderGeneration).toBeGreaterThan(0);

        element.pause();

        expect(element.paused).toBe(true);
        expect(element.needsRefresh).toBe(true);

        element.ptvDataOwner = { generation: 2 };
        element.isDataOwnerCurrent = () => true;

        const resumedRefresh = element.resume();
        const resumedGeneration = element.ptvRefreshInFlightGeneration;

        expect(element.fetchData).toHaveBeenCalledTimes(2);
        expect(element.paused).toBe(false);
        expect(element.needsRefresh).toBe(false);
        expect(resumedGeneration).toBeGreaterThan(olderGeneration ?? 0);
        expect(element.ptvRefreshGeneration).toBe(resumedGeneration);

        older.resolve({ Items: [{ Id: 'retired' }] });
        await olderRefresh;

        expect(element.innerHTML).toBe('');
        expect(element.afterRefresh).not.toHaveBeenCalled();
        expect(element.ptvRefreshInFlightGeneration).toBe(resumedGeneration);

        newer.resolve({ Items: [{ Id: 'resumed' }] });
        await resumedRefresh;

        expect(element.innerHTML).toBe('resumed');
        expect(element.afterRefresh).toHaveBeenCalledTimes(1);
        expect(element.afterRefresh).toHaveBeenCalledWith({ Items: [{ Id: 'resumed' }] });
        expect(element.ptvRefreshInFlightGeneration).toBe(0);
    });

    it('suppresses an in-flight result after its owner changes', async () => {
        const pending = createDeferred<RefreshResult>();
        const originalOwner = { generation: 1 };
        const element = createItemsContainer(originalOwner);

        element.fetchData = vi.fn(() => pending.promise);
        const refresh = element.refreshItems();

        element.ptvDataOwner = { generation: 2 };
        pending.resolve({ Items: [{ Id: 'stale-owner' }] });
        await refresh;

        expect(element.innerHTML).toBe('');
        expect(element.afterRefresh).not.toHaveBeenCalled();
        expect(mocks.lazyChildren).not.toHaveBeenCalled();
    });

    it('suppresses an in-flight result after the container is detached', async () => {
        const pending = createDeferred<RefreshResult>();
        const element = createItemsContainer({ generation: 1 });

        element.fetchData = vi.fn(() => pending.promise);
        element.refreshTimeout = window.setTimeout(vi.fn(), 10000);
        const refresh = element.refreshItems();

        itemsContainerPrototype.detachedCallback.call(element);
        expect(element.refreshTimeout).toBeNull();
        pending.resolve({ Items: [{ Id: 'stale-detached' }] });
        await refresh;

        expect(element.innerHTML).toBe('');
        expect(mocks.lazyChildren).not.toHaveBeenCalled();
    });
});
