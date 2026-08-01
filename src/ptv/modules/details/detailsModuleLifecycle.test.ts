import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

type DetailsModule = {
    destroy: () => void;
    init: (context: { scope: ReturnType<typeof createScope>['scope'] }) => void;
    refresh: (context: { scope: ReturnType<typeof createScope>['scope'] }) => void;
};

type DetailItem = {
    Id: string;
    Name?: string;
    ServerId?: string;
    Type?: string;
};

const detailsMocks = vi.hoisted(() => ({
    claimImageRepair: vi.fn(() => true),
    clearImageRepairAttempts: vi.fn(),
    coordinatedDetail: vi.fn(),
    detailsRenderedHandler: null as ((event: CustomEvent) => void) | null,
    getApiClient: vi.fn(),
    getImageCandidates: vi.fn(() => []),
    prepareLayout: vi.fn(),
    registeredModule: null as DetailsModule | null,
    releaseLayout: vi.fn(),
    resetBackdrop: vi.fn(),
    setBackdropCandidates: vi.fn(),
    setShellSection: vi.fn()
}));

vi.mock('../../core/events', () => ({
    on: vi.fn((_eventName: string, handler: (event: CustomEvent) => void) => {
        detailsMocks.detailsRenderedHandler = handler;
        return vi.fn();
    })
}));

vi.mock('../../core/lifecycle', () => ({
    registerModule: vi.fn((module: DetailsModule) => {
        detailsMocks.registeredModule = module;
        return module;
    })
}));

vi.mock('../../utils/icons', () => ({
    runIconEngine: vi.fn()
}));

vi.mock('../../../components/playback/playbackmanager', () => ({
    playbackManager: {
        play: vi.fn()
    }
}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        getApiClient: detailsMocks.getApiClient
    }
}));

vi.mock('../reader/sourceResolver', () => ({
    isPiggieTvReaderItem: vi.fn(() => false),
    resolveReaderSource: vi.fn()
}));

vi.mock('../reader/readerProgressStore', () => ({
    loadReaderProgress: vi.fn(() => null)
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    shouldCollectDiagnostics: vi.fn(() => false)
}));

vi.mock('../../api', () => ({
    getPtvItemImageCandidates: detailsMocks.getImageCandidates
}));

vi.mock('../../core/clientProfile', () => ({
    getPtvPerformanceProfile: vi.fn(() => ({
        heroBackdropMaxWidth: 1280
    }))
}));

vi.mock('../../services/coordinatedLegacyItemDetail', () => ({
    getCoordinatedLegacyItemDetail: detailsMocks.coordinatedDetail
}));

vi.mock('./detailsShell', () => ({
    getPtvDetailsShellSection: vi.fn(() => 'movies'),
    mountPtvDetailsShell: vi.fn(() => vi.fn()),
    setPtvDetailsShellSection: detailsMocks.setShellSection
}));

vi.mock('./detailsLayout', () => ({
    preparePtvDetailsLayout: detailsMocks.prepareLayout,
    releasePtvDetailsLayout: detailsMocks.releaseLayout,
    resetPtvDetailsBackdrop: detailsMocks.resetBackdrop,
    setPtvDetailsBackdropCandidates: detailsMocks.setBackdropCandidates
}));

vi.mock('./detailImageRepairState', () => ({
    claimPtvDetailImageRepair: detailsMocks.claimImageRepair,
    clearPtvDetailImageRepairAttempts: detailsMocks.clearImageRepairAttempts
}));

import './index.js';

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

function createScope() {
    const scheduled: Array<{
        callback: () => void;
        cancelled: boolean;
    }> = [];
    const scope = {
        add: vi.fn((disposer?: () => void) => disposer),
        timeout: vi.fn((callback: () => void) => {
            const entry = {
                callback,
                cancelled: false
            };

            scheduled.push(entry);

            return () => {
                entry.cancelled = true;
            };
        }),
        watchDom: vi.fn(() => vi.fn())
    };

    return {
        runInspection() {
            const entry = scheduled.find(candidate => !candidate.cancelled);

            if (!entry) throw new Error('No active details inspection was scheduled.');

            entry.cancelled = true;
            entry.callback();
        },
        scheduled,
        scope
    };
}

function renderDetailsPage(itemId = 'item-a') {
    window.location.hash = `#/details?id=${itemId}&serverId=server-a`;
    document.body.innerHTML = `
        <main id="itemDetailPage" class="itemDetailPage">
            <div class="detailImageContainer ptv-detail-artwork-pending">
                <img src="https://example.test/Items/${itemId}/Images/Primary?tag=old">
            </div>
            <div class="mainDetailButtons"></div>
        </main>
    `;

    return document.querySelector<HTMLElement>('#itemDetailPage')!;
}

function getRegisteredModule() {
    if (!detailsMocks.registeredModule) {
        throw new Error('Details module was not registered.');
    }

    return detailsMocks.registeredModule;
}

async function settlePromises() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('details enhancement module lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        detailsMocks.detailsRenderedHandler = null;
        detailsMocks.getApiClient.mockReturnValue({
            getCurrentUserId: () => 'user-a',
            getItem: vi.fn(),
            serverId: () => 'server-a'
        });
    });

    afterEach(() => {
        getRegisteredModule().destroy();
        document.body.innerHTML = '';
        window.location.hash = '';
    });

    it('aborts and rejects an older same-item enhancement after leave and reopen', async () => {
        const page = renderDetailsPage();
        const first = createDeferred<DetailItem>();
        const second = createDeferred<DetailItem>();
        const firstScope = createScope();
        const secondScope = createScope();

        detailsMocks.coordinatedDetail
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        const module = getRegisteredModule();

        module.init({ scope: firstScope.scope });
        firstScope.runInspection();

        const firstSignal = detailsMocks.coordinatedDetail.mock.calls[0]?.[2]?.signal as AbortSignal;

        expect(firstSignal.aborted).toBe(false);
        expect(page.dataset.ptvDetailsPendingItemId).toBe('item-a');

        module.destroy();

        expect(firstSignal.aborted).toBe(true);
        expect(page.dataset.ptvDetailsItemId).toBeUndefined();
        expect(page.dataset.ptvDetailsPendingItemId).toBeUndefined();

        module.init({ scope: secondScope.scope });
        secondScope.runInspection();

        first.resolve({ Id: 'item-a', Name: 'stale', Type: 'Movie' });
        await settlePromises();

        expect(detailsMocks.setShellSection).not.toHaveBeenCalled();

        second.resolve({ Id: 'item-a', Name: 'current', Type: 'Movie' });
        await settlePromises();

        expect(detailsMocks.setShellSection).toHaveBeenCalledTimes(1);
        expect(page.dataset.ptvDetailsHydratedItemId).toBe('item-a');
    });

    it('removes image listeners and page-local enhancement state on destroy', () => {
        const page = renderDetailsPage();
        const scope = createScope();
        const module = getRegisteredModule();
        const image = page.querySelector<HTMLImageElement>('img')!;

        module.init({ scope: scope.scope });
        page.dataset.ptvDetailsItemId = 'item-a';
        page.dataset.ptvDetailsHydratedItemId = 'item-a';
        page.insertAdjacentHTML('beforeend', '<div class="ptv-reader-detail-actions"></div>');

        image.dispatchEvent(new Event('error'));
        expect(detailsMocks.claimImageRepair).toHaveBeenCalledTimes(1);

        module.destroy();
        detailsMocks.claimImageRepair.mockClear();
        image.dispatchEvent(new Event('error'));

        expect(detailsMocks.claimImageRepair).not.toHaveBeenCalled();
        expect(image.dataset.ptvImageRepairInstalled).toBeUndefined();
        expect(page.dataset.ptvDetailsItemId).toBeUndefined();
        expect(page.dataset.ptvDetailsHydratedItemId).toBeUndefined();
        expect(page.querySelector('.ptv-reader-detail-actions')).toBeNull();
    });

    it('lets the authoritative rendered item supersede the slow inspection consumer', async () => {
        const page = renderDetailsPage();
        const inspection = createDeferred<DetailItem>();
        const scope = createScope();
        const module = getRegisteredModule();

        detailsMocks.coordinatedDetail.mockReturnValueOnce(inspection.promise);

        module.init({ scope: scope.scope });
        scope.runInspection();

        const inspectionSignal = detailsMocks.coordinatedDetail.mock.calls[0]?.[2]?.signal as AbortSignal;

        detailsMocks.detailsRenderedHandler?.(new CustomEvent('detailsrendered', {
            detail: {
                item: {
                    Id: 'item-a',
                    Name: 'rendered',
                    ServerId: 'server-a',
                    Type: 'Movie'
                },
                page
            }
        }));

        expect(inspectionSignal.aborted).toBe(true);
        expect(detailsMocks.setShellSection).toHaveBeenCalledTimes(1);

        inspection.resolve({ Id: 'item-a', Name: 'stale', Type: 'Movie' });
        await settlePromises();

        expect(detailsMocks.setShellSection).toHaveBeenCalledTimes(1);
    });

    it('ignores a rendered event from the wrong server without retiring current work', () => {
        const page = renderDetailsPage();
        const inspection = createDeferred<DetailItem>();
        const scope = createScope();
        const module = getRegisteredModule();

        detailsMocks.coordinatedDetail.mockReturnValueOnce(inspection.promise);

        module.init({ scope: scope.scope });
        scope.runInspection();

        const inspectionSignal = detailsMocks.coordinatedDetail.mock.calls[0]?.[2]?.signal as AbortSignal;

        detailsMocks.detailsRenderedHandler?.(new CustomEvent('detailsrendered', {
            detail: {
                item: {
                    Id: 'item-a',
                    ServerId: 'server-b',
                    Type: 'Movie'
                },
                page
            }
        }));

        expect(inspectionSignal.aborted).toBe(false);
        expect(detailsMocks.setShellSection).not.toHaveBeenCalled();
    });
});
