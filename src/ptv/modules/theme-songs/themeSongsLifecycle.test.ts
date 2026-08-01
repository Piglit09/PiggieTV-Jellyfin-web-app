import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ThemeSongsModule = {
    destroy: () => void;
    init: (context: { scope: ReturnType<typeof createScope>['scope'] }) => void;
    refresh: () => void;
};

type ThemeMediaResponse = {
    data: {
        ThemeSongsResult: {
            Items: Array<{ Id: string }>;
        };
    };
};

const themeSongMocks = vi.hoisted(() => ({
    enableThemeSongs: vi.fn(),
    getApiClient: vi.fn(),
    getCurrentUserId: vi.fn(),
    getThemeMedia: vi.fn(),
    registeredModule: null as ThemeSongsModule | null,
    toApi: vi.fn()
}));

vi.mock('@jellyfin/sdk/lib/generated-client/models/item-sort-by', () => ({
    ItemSortBy: {
        Random: 'Random'
    }
}));

vi.mock('@jellyfin/sdk/lib/utils/api/library-api', () => ({
    getLibraryApi: vi.fn(() => ({
        getThemeMedia: themeSongMocks.getThemeMedia
    }))
}));

vi.mock('../../../lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        getApiClient: themeSongMocks.getApiClient
    }
}));

vi.mock('../../../scripts/settings/userSettings', () => ({
    currentSettings: {
        enableThemeSongs: themeSongMocks.enableThemeSongs
    }
}));

vi.mock('../../../utils/jellyfin-apiclient/compat', () => ({
    toApi: themeSongMocks.toApi
}));

vi.mock('../../core/lifecycle', () => ({
    registerModule: vi.fn((module: ThemeSongsModule) => {
        themeSongMocks.registeredModule = module;

        return module;
    })
}));

vi.mock('../../core/observer', () => ({
    watchElement: vi.fn()
}));

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return {
        promise,
        reject,
        resolve
    };
}

function createResponse(...ids: string[]): ThemeMediaResponse {
    return {
        data: {
            ThemeSongsResult: {
                Items: ids.map(Id => ({ Id }))
            }
        }
    };
}

function createScope() {
    const handles: {
        detailsFound?: (page: Element) => void;
        detailsMissing?: () => void;
        pageMutations?: (mutations: MutationRecord[]) => void;
        viewShow?: (event: { detail?: { params?: Record<string, string> } }) => void;
    } = {};
    const stopListening = vi.fn();
    const stopObservingPage = vi.fn();
    const stopWatchingDetails = vi.fn();
    const scope = {
        listen: vi.fn((
            _target: EventTarget,
            _eventName: string,
            callback: typeof handles.viewShow
        ) => {
            handles.viewShow = callback;

            return stopListening;
        }),
        mutationObserver: vi.fn((callback: typeof handles.pageMutations) => {
            handles.pageMutations = callback;

            return stopObservingPage;
        }),
        timeout: vi.fn((callback: () => void, delay: number) => {
            const timer = window.setTimeout(callback, delay);

            return () => window.clearTimeout(timer);
        }),
        watchElement: vi.fn((
            _selector: string,
            callback: typeof handles.detailsFound,
            options: { onMissing?: () => void }
        ) => {
            handles.detailsFound = callback;
            handles.detailsMissing = options.onMissing;

            return stopWatchingDetails;
        })
    };

    return {
        handles,
        scope,
        stopListening,
        stopObservingPage,
        stopWatchingDetails
    };
}

function setDetailsRoute(itemId: string, serverId = 'server-a') {
    window.location.hash = `#/details?id=${itemId}&serverId=${serverId}`;
}

function renderDetailsPage() {
    document.body.innerHTML = `
        <div id="itemDetailPage">
            <div class="detailRibbon">
                <div class="infoWrapper"></div>
                <div class="mainDetailButtons"></div>
            </div>
        </div>
    `;
}

function getRegisteredModule() {
    if (!themeSongMocks.registeredModule) {
        throw new Error('Theme songs module was not registered.');
    }

    return themeSongMocks.registeredModule;
}

async function settlePromises() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

function createAbortableThemeMediaResponse(signal: AbortSignal) {
    return new Promise<ThemeMediaResponse>((_resolve, reject) => {
        const rejectAbort = () => {
            const error = new Error('cancelled');

            error.name = 'CanceledError';
            reject(error);
        };

        signal.addEventListener('abort', rejectAbort, { once: true });
    });
}

describe('theme song details lifecycle', () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        vi.resetModules();
        document.body.innerHTML = '';
        window.location.hash = '';
        themeSongMocks.enableThemeSongs.mockReset();
        themeSongMocks.getApiClient.mockReset();
        themeSongMocks.getCurrentUserId.mockReset();
        themeSongMocks.getThemeMedia.mockReset();
        themeSongMocks.toApi.mockReset();
        themeSongMocks.registeredModule = null;
        themeSongMocks.enableThemeSongs.mockReturnValue(true);
        themeSongMocks.getCurrentUserId.mockReturnValue('user-a');
        themeSongMocks.getApiClient.mockImplementation(() => ({
            getCurrentUserId: themeSongMocks.getCurrentUserId
        }));
        themeSongMocks.toApi.mockReturnValue({});

        await import('./index.js');
    });

    afterEach(() => {
        themeSongMocks.registeredModule?.destroy();
        vi.useRealTimers();
    });

    it('uses one transport while repeated action-area mutations wait on the same response', async () => {
        const response = createDeferred<ThemeMediaResponse>();

        renderDetailsPage();
        setDetailsRoute('item-a');
        themeSongMocks.getThemeMedia.mockReturnValue(response.promise);

        const harness = createScope();
        const module = getRegisteredModule();

        module.init({ scope: harness.scope });
        await vi.advanceTimersByTimeAsync(16);

        const page = document.querySelector('#itemDetailPage');
        const target = document.querySelector('.mainDetailButtons');
        const addedButton = document.createElement('button');
        const mutation = {
            addedNodes: [addedButton],
            removedNodes: [],
            target
        } as unknown as MutationRecord;
        const unrelatedMutation = {
            addedNodes: [document.createElement('span')],
            removedNodes: [],
            target: document.querySelector('.infoWrapper')
        } as unknown as MutationRecord;
        const scheduledBeforeUnrelatedMutation = harness.scope.timeout.mock.calls.length;

        harness.handles.pageMutations?.([unrelatedMutation]);

        expect(harness.scope.timeout).toHaveBeenCalledTimes(scheduledBeforeUnrelatedMutation);

        module.refresh();

        for (let index = 0; index < 20; index += 1) {
            if (page) {
                harness.handles.detailsFound?.(page);
            }
            harness.handles.pageMutations?.([mutation]);
        }
        await vi.advanceTimersByTimeAsync(16);

        expect(themeSongMocks.getThemeMedia).toHaveBeenCalledTimes(1);
        expect(themeSongMocks.getThemeMedia).toHaveBeenCalledWith(
            {
                inheritFromParent: true,
                itemId: 'item-a',
                sortBy: ['Random'],
                userId: 'user-a'
            },
            {
                signal: expect.any(AbortSignal)
            }
        );

        response.resolve(createResponse('song-a'));
        await settlePromises();

        expect(document.querySelectorAll('.ptv-theme-song-chip')).toHaveLength(1);
        expect(document.querySelector('.ptv-theme-song-chip-count')?.textContent).toBe('1');
        expect(document.querySelector('.ptv-theme-song-chip')?.parentElement).toBe(target);
    });

    it('moves a cached chip from the ribbon fallback when the action container appears', async () => {
        renderDetailsPage();
        document.querySelector('.mainDetailButtons')?.remove();
        setDetailsRoute('item-a');
        themeSongMocks.getThemeMedia.mockResolvedValue(createResponse('song-a'));

        const harness = createScope();

        getRegisteredModule().init({ scope: harness.scope });
        await vi.advanceTimersByTimeAsync(16);
        await settlePromises();

        const ribbon = document.querySelector('.detailRibbon');
        const actionContainer = document.createElement('div');

        actionContainer.className = 'mainDetailButtons';
        expect(document.querySelector('.ptv-theme-song-chip')?.parentElement).toBe(ribbon);
        ribbon?.append(actionContainer);
        harness.handles.pageMutations?.([{
            addedNodes: [actionContainer],
            removedNodes: [],
            target: ribbon
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(16);
        await settlePromises();

        expect(themeSongMocks.getThemeMedia).toHaveBeenCalledTimes(1);
        expect(document.querySelector('.ptv-theme-song-chip')?.parentElement).toBe(actionContainer);
    });

    it('rejects a stale item response after a newer details generation wins', async () => {
        const firstResponse = createDeferred<ThemeMediaResponse>();
        const secondResponse = createDeferred<ThemeMediaResponse>();
        const thirdResponse = createDeferred<ThemeMediaResponse>();
        const responsesByItem = {
            'item-a': firstResponse,
            'item-b': secondResponse,
            'item-c': thirdResponse
        };

        renderDetailsPage();
        setDetailsRoute('item-a');
        themeSongMocks.getThemeMedia.mockImplementation(
            ({ itemId }: { itemId: keyof typeof responsesByItem }) => responsesByItem[itemId].promise
        );

        const harness = createScope();

        getRegisteredModule().init({ scope: harness.scope });
        await vi.advanceTimersByTimeAsync(16);

        firstResponse.resolve(createResponse('old-a', 'old-b', 'old-c'));
        await settlePromises();
        expect(document.querySelector('.ptv-theme-song-chip-count')?.textContent).toBe('3');

        harness.handles.viewShow?.({
            detail: {
                params: {
                    id: 'item-b',
                    serverId: 'server-a'
                }
            }
        });

        expect(document.querySelector('.ptv-theme-song-chip')).toBeNull();
        expect(document.querySelector('#itemDetailPage')?.classList.contains('ptv-has-theme-songs')).toBe(false);

        await vi.advanceTimersByTimeAsync(16);
        harness.handles.viewShow?.({
            detail: {
                params: {
                    id: 'item-c',
                    serverId: 'server-a'
                }
            }
        });
        await vi.advanceTimersByTimeAsync(16);

        expect(themeSongMocks.getThemeMedia).toHaveBeenCalledTimes(3);

        thirdResponse.resolve(createResponse('new-song'));
        await settlePromises();
        expect(document.querySelector('.ptv-theme-song-chip-count')?.textContent).toBe('1');

        secondResponse.resolve(createResponse('stale-a', 'stale-b'));
        await settlePromises();

        expect(document.querySelectorAll('.ptv-theme-song-chip')).toHaveLength(1);
        expect(document.querySelector('.ptv-theme-song-chip-count')?.textContent).toBe('1');
    });

    it('scopes in-flight work by user and prevents a disposed generation from committing', async () => {
        const firstResponse = createDeferred<ThemeMediaResponse>();
        const secondResponse = createDeferred<ThemeMediaResponse>();

        renderDetailsPage();
        setDetailsRoute('shared-item');
        themeSongMocks.getThemeMedia.mockImplementation(({ userId }: { userId: string }) => (
            userId === 'user-a' ? firstResponse.promise : secondResponse.promise
        ));

        const firstHarness = createScope();
        const module = getRegisteredModule();

        module.init({ scope: firstHarness.scope });
        await vi.advanceTimersByTimeAsync(16);
        module.destroy();

        expect(firstHarness.stopListening).toHaveBeenCalledTimes(1);
        expect(firstHarness.stopObservingPage).toHaveBeenCalledTimes(1);
        expect(firstHarness.stopWatchingDetails).toHaveBeenCalledTimes(1);

        themeSongMocks.getCurrentUserId.mockReturnValue('user-b');

        const secondHarness = createScope();

        module.init({ scope: secondHarness.scope });
        await vi.advanceTimersByTimeAsync(16);

        expect(themeSongMocks.getThemeMedia).toHaveBeenCalledTimes(2);
        expect(themeSongMocks.getThemeMedia.mock.calls.map(([request]) => request.userId)).toEqual([
            'user-a',
            'user-b'
        ]);

        secondResponse.resolve(createResponse('new-song'));
        await settlePromises();
        firstResponse.resolve(createResponse('stale-a', 'stale-b', 'stale-c'));
        await settlePromises();

        expect(document.querySelectorAll('.ptv-theme-song-chip')).toHaveLength(1);
        expect(document.querySelector('.ptv-theme-song-chip-count')?.textContent).toBe('1');

        module.destroy();

        expect(document.querySelector('.ptv-theme-song-chip')).toBeNull();
        expect(document.querySelector('#itemDetailPage')?.classList.contains('ptv-has-theme-songs')).toBe(false);
    });

    it('does not deduplicate the same user and item across different servers', async () => {
        const firstResponse = createDeferred<ThemeMediaResponse>();
        const secondResponse = createDeferred<ThemeMediaResponse>();

        renderDetailsPage();
        setDetailsRoute('shared-item', 'server-a');
        themeSongMocks.getThemeMedia
            .mockReturnValueOnce(firstResponse.promise)
            .mockReturnValueOnce(secondResponse.promise);

        const harness = createScope();

        getRegisteredModule().init({ scope: harness.scope });
        await vi.advanceTimersByTimeAsync(16);
        harness.handles.viewShow?.({
            detail: {
                params: {
                    id: 'shared-item',
                    serverId: 'server-b'
                }
            }
        });
        await vi.advanceTimersByTimeAsync(16);

        expect(themeSongMocks.getThemeMedia).toHaveBeenCalledTimes(2);
        expect(themeSongMocks.getApiClient).toHaveBeenCalledWith('server-a');
        expect(themeSongMocks.getApiClient).toHaveBeenCalledWith('server-b');

        secondResponse.resolve(createResponse('server-b-song'));
        await settlePromises();
        firstResponse.resolve(createResponse('server-a-stale'));
        await settlePromises();

        expect(document.querySelector('.ptv-theme-song-chip-count')?.textContent).toBe('1');
    });

    it('evicts old identity results instead of growing the cache without a bound', async () => {
        renderDetailsPage();
        setDetailsRoute('item-0');
        themeSongMocks.getThemeMedia.mockImplementation(
            ({ itemId }: { itemId: string }) => Promise.resolve(createResponse(`${itemId}-song`))
        );

        const harness = createScope();
        const module = getRegisteredModule();

        module.init({ scope: harness.scope });
        await vi.advanceTimersByTimeAsync(16);
        await settlePromises();

        for (let index = 1; index < 70; index += 1) {
            harness.handles.viewShow?.({
                detail: {
                    params: {
                        id: `item-${index}`,
                        serverId: 'server-a'
                    }
                }
            });
            await vi.advanceTimersByTimeAsync(16);
            await settlePromises();
        }

        expect(themeSongMocks.getThemeMedia).toHaveBeenCalledTimes(70);

        harness.handles.viewShow?.({
            detail: {
                params: {
                    id: 'item-0',
                    serverId: 'server-a'
                }
            }
        });
        await vi.advanceTimersByTimeAsync(16);
        await settlePromises();

        expect(themeSongMocks.getThemeMedia).toHaveBeenCalledTimes(71);
    });

    it('cancels a scheduled lookup when destroyed before the debounce elapses', async () => {
        renderDetailsPage();
        setDetailsRoute('item-a');
        themeSongMocks.getThemeMedia.mockResolvedValue(createResponse('song-a'));

        const harness = createScope();
        const module = getRegisteredModule();

        module.init({ scope: harness.scope });
        module.destroy();
        await vi.advanceTimersByTimeAsync(16);
        await settlePromises();

        expect(themeSongMocks.getThemeMedia).not.toHaveBeenCalled();
        expect(harness.stopListening).toHaveBeenCalledTimes(1);
        expect(harness.stopObservingPage).toHaveBeenCalledTimes(1);
        expect(harness.stopWatchingDetails).toHaveBeenCalledTimes(1);
    });

    it('aborts active transport on route disposal and permits a fresh same-item request', async () => {
        const transportSignals: AbortSignal[] = [];

        renderDetailsPage();
        setDetailsRoute('item-a');
        themeSongMocks.getThemeMedia.mockImplementation((
            _request: unknown,
            options: { signal: AbortSignal }
        ) => {
            transportSignals.push(options.signal);
            return createAbortableThemeMediaResponse(options.signal);
        });

        const module = getRegisteredModule();

        module.init({ scope: createScope().scope });
        await vi.advanceTimersByTimeAsync(16);
        expect(transportSignals[0]?.aborted).toBe(false);

        module.destroy();
        expect(transportSignals[0]?.aborted).toBe(true);

        module.init({ scope: createScope().scope });
        await vi.advanceTimersByTimeAsync(16);

        expect(themeSongMocks.getThemeMedia).toHaveBeenCalledTimes(2);
        expect(transportSignals[1]?.aborted).toBe(false);
    });
});
