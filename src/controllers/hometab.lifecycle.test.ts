import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
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

const controllerMocks = vi.hoisted(() => ({
    autoFocus: vi.fn(),
    currentApiClient: vi.fn(),
    destroySections: vi.fn(),
    error: vi.fn(),
    hideLoading: vi.fn(),
    loadSections: vi.fn(),
    pauseSections: vi.fn(),
    resumeSections: vi.fn(),
    routeLifetimeAcquire: vi.fn(),
    routeLifetimeRetire: vi.fn(),
    requestJson: vi.fn(),
    showLoading: vi.fn()
}));

vi.mock('../scripts/settings/userSettings', () => ({
    get: vi.fn()
}));

vi.mock('../components/loading/loading', () => ({
    default: {
        hide: controllerMocks.hideLoading,
        show: controllerMocks.showLoading
    }
}));

vi.mock('../components/focusManager', () => ({
    default: {
        autoFocus: controllerMocks.autoFocus
    }
}));

vi.mock('../components/homesections/homesections', () => ({
    default: {
        destroySections: controllerMocks.destroySections,
        loadSections: controllerMocks.loadSections,
        pause: controllerMocks.pauseSections,
        resume: controllerMocks.resumeSections
    }
}));

vi.mock('../elements/emby-itemscontainer/emby-itemscontainer', () => ({}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: controllerMocks.currentApiClient
    }
}));

vi.mock('ptv/core/safeConsole', () => ({
    ptvSafeConsole: {
        error: controllerMocks.error
    }
}));

vi.mock('ptv/api/client', () => ({
    requestPtvJson: controllerMocks.requestJson
}));

vi.mock('ptv/shell/routeController', () => ({
    acquirePtvRouteLifetime: controllerMocks.routeLifetimeAcquire,
    retirePtvRouteLifetime: controllerMocks.routeLifetimeRetire
}));

import HomeTab from './hometab';

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(promiseResolve => {
        resolve = promiseResolve;
    });

    return { promise, resolve };
}

async function flushPromises() {
    for (let turn = 0; turn < 6; turn++) {
        await Promise.resolve();
    }
}

function createLifetimeFactory() {
    let generation = 0;
    let currentLifetime: TestLifetime | null = null;
    const owners = new WeakMap<TestLifetime, {
        abortController: AbortController;
        retired: boolean;
    }>();

    const retire = (lifetime: TestLifetime) => {
        const owner = owners.get(lifetime);

        if (!owner || owner.retired) return false;

        owner.retired = true;
        owner.abortController.abort();
        if (currentLifetime === lifetime) currentLifetime = null;

        return true;
    };

    const acquire = (routeFamily: string) => {
        if (currentLifetime) retire(currentLifetime);

        // eslint-disable-next-line compat/compat -- The production lifetime contract requires an AbortSignal.
        const abortController = new AbortController();
        const owner = {
            abortController,
            retired: false
        };
        const nextGeneration = ++generation;
        const lifetime: TestLifetime = Object.freeze({
            get active() {
                return !owner.retired;
            },
            generation: nextGeneration,
            identity: `legacy-home-${nextGeneration}`,
            isCurrent: () => currentLifetime === lifetime
                && !owner.retired
                && !abortController.signal.aborted,
            get retired() {
                return owner.retired;
            },
            routeFamily,
            routeKey: '/home.html',
            signal: abortController.signal
        });
        owners.set(lifetime, owner);
        currentLifetime = lifetime;

        return lifetime;
    };

    return { acquire, retire };
}

function createView() {
    const view = document.createElement('div');

    view.innerHTML = '<div class="sections"></div>';
    document.body.append(view);

    return {
        sections: view.querySelector('.sections') as HTMLElement,
        view
    };
}

describe('legacy HomeTab route lifetime ownership', () => {
    beforeEach(() => {
        const lifetimeFactory = createLifetimeFactory();

        controllerMocks.routeLifetimeAcquire.mockImplementation(lifetimeFactory.acquire);
        controllerMocks.routeLifetimeRetire.mockImplementation(lifetimeFactory.retire);
        controllerMocks.loadSections.mockImplementation((
            elem: HTMLElement,
            _apiClient: unknown,
            user: { Id: string },
            _userSettings: unknown,
            lifetime?: TestLifetime
        ) => {
            if (!lifetime || lifetime.isCurrent()) {
                elem.dataset.publishedGeneration = user.Id;
            }

            return Promise.resolve();
        });
        controllerMocks.resumeSections.mockResolvedValue(undefined);
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('lets generation B win when delayed same-route generation A resolves last', async () => {
        const generationA = createDeferred<{ Id: string }>();
        const generationB = createDeferred<{ Id: string }>();
        controllerMocks.requestJson
            .mockReturnValueOnce(generationA.promise)
            .mockReturnValueOnce(generationB.promise);
        const { sections, view } = createView();

        controllerMocks.currentApiClient.mockReturnValue({
            getCurrentUserId: () => 'current-user',
            serverId: () => 'server-a'
        });

        const tab = new HomeTab(view, {});
        const loadA = tab.onResume({ autoFocus: false });

        sections.dispatchEvent(new Event('settingschange'));
        const requestAOptions = controllerMocks.requestJson.mock.calls[0]?.[1] as {
            scope?: string;
            serverId?: string;
            signal?: AbortSignal;
        };
        const requestBOptions = controllerMocks.requestJson.mock.calls[1]?.[1] as {
            scope?: string;
            serverId?: string;
            signal?: AbortSignal;
        };

        expect(controllerMocks.requestJson.mock.calls.map(call => call[0])).toEqual([
            'Users/current-user',
            'Users/current-user'
        ]);
        expect(requestAOptions).toMatchObject({ scope: 'route', serverId: 'server-a' });
        expect(requestBOptions).toMatchObject({ scope: 'route', serverId: 'server-a' });
        expect(requestAOptions.signal?.aborted).toBe(true);
        expect(requestBOptions.signal?.aborted).toBe(false);
        generationB.resolve({ Id: 'generation-b' });
        await flushPromises();
        expect(sections.dataset.publishedGeneration).toBe('generation-b');
        const loadingHidesAfterB = controllerMocks.hideLoading.mock.calls.length;

        generationA.resolve({ Id: 'generation-a' });
        await loadA;
        await flushPromises();

        expect(controllerMocks.routeLifetimeAcquire).toHaveBeenCalledTimes(2);
        expect(controllerMocks.routeLifetimeAcquire).toHaveBeenNthCalledWith(1, 'legacy-home');
        expect(controllerMocks.routeLifetimeAcquire).toHaveBeenNthCalledWith(2, 'legacy-home');
        expect(controllerMocks.loadSections).toHaveBeenCalledTimes(1);
        expect(controllerMocks.loadSections.mock.calls[0]?.[2]).toEqual({ Id: 'generation-b' });
        expect(controllerMocks.loadSections.mock.calls[0]?.[4]?.routeFamily).toBe('legacy-home');
        expect(sections.dataset.publishedGeneration).toBe('generation-b');
        expect(controllerMocks.autoFocus).not.toHaveBeenCalled();
        expect(controllerMocks.hideLoading).toHaveBeenCalledTimes(loadingHidesAfterB);
    });

    it('retires navigation work before pause and restarts an incomplete load with a fresh lifetime', async () => {
        const delayedUser = createDeferred<{ Id: string }>();
        controllerMocks.requestJson
            .mockReturnValueOnce(delayedUser.promise)
            .mockResolvedValueOnce({ Id: 'return-generation' });
        const { sections, view } = createView();

        controllerMocks.currentApiClient.mockReturnValue({
            getCurrentUserId: () => 'current-user',
            serverId: () => 'server-a'
        });

        const tab = new HomeTab(view, {});
        const delayedLoad = tab.onResume({ autoFocus: true });
        const firstLifetime = controllerMocks.routeLifetimeAcquire.mock.results[0]?.value as TestLifetime;

        tab.onPause();
        expect(firstLifetime.signal.aborted).toBe(true);
        expect(firstLifetime.isCurrent()).toBe(false);
        expect(controllerMocks.requestJson.mock.calls[0]?.[1]?.signal.aborted).toBe(true);
        expect(controllerMocks.pauseSections).toHaveBeenCalledWith(sections);

        await tab.onResume({ refresh: true });
        const secondLifetime = controllerMocks.routeLifetimeAcquire.mock.results[1]?.value as TestLifetime;

        expect(secondLifetime.isCurrent()).toBe(true);
        expect(controllerMocks.loadSections).toHaveBeenCalledWith(
            sections,
            expect.anything(),
            { Id: 'return-generation' },
            expect.anything(),
            secondLifetime
        );
        expect(controllerMocks.resumeSections).not.toHaveBeenCalled();

        delayedUser.resolve({ Id: 'retired-navigation' });
        await delayedLoad;

        expect(sections.dataset.publishedGeneration).toBe('return-generation');
        expect(controllerMocks.autoFocus).not.toHaveBeenCalled();
    });

    it('removes the exact settings listener and retires once across repeated pause/resume cycles', async () => {
        const { sections, view } = createView();
        const addListener = vi.spyOn(sections, 'addEventListener');
        const removeListener = vi.spyOn(sections, 'removeEventListener');

        controllerMocks.currentApiClient.mockReturnValue({
            getCurrentUserId: () => 'current-user',
            serverId: () => 'server-a'
        });
        controllerMocks.requestJson.mockResolvedValue({ Id: 'current-user' });

        const tab = new HomeTab(view, {});

        await tab.onResume({});
        for (let cycle = 0; cycle < 3; cycle++) {
            tab.onPause();
            await tab.onResume({ refresh: true });
        }

        const currentLifetime = controllerMocks.routeLifetimeAcquire.mock.results.at(-1)?.value as TestLifetime;
        const settingsRegistration = addListener.mock.calls.find(call => call[0] === 'settingschange');

        tab.destroy();

        expect(settingsRegistration).toBeDefined();
        expect(removeListener).toHaveBeenCalledWith('settingschange', settingsRegistration?.[1]);
        expect(currentLifetime.signal.aborted).toBe(true);
        expect(controllerMocks.routeLifetimeAcquire).toHaveBeenCalledTimes(4);
        expect(controllerMocks.routeLifetimeRetire).toHaveBeenCalledTimes(4);

        const loadCountAfterDestroy = controllerMocks.loadSections.mock.calls.length;
        const resumeCountAfterDestroy = controllerMocks.resumeSections.mock.calls.length;

        sections.dispatchEvent(new Event('settingschange'));
        await flushPromises();

        expect(controllerMocks.loadSections).toHaveBeenCalledTimes(loadCountAfterDestroy);
        expect(controllerMocks.resumeSections).toHaveBeenCalledTimes(resumeCountAfterDestroy);
    });
});
