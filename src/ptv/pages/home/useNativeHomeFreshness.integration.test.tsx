import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
};

const mocks = vi.hoisted(() => ({
    apiClient: {
        getCurrentUserId: () => 'user-a',
        serverId: () => 'server-a',
        serverInfo: () => ({ Id: 'server-a' })
    } as Record<string, unknown>,
    getCachedFeaturedContentPayload: vi.fn(),
    getFeaturedContentCacheDocument: vi.fn(),
    getItems: vi.fn(),
    getRecentlyAdded: vi.fn(),
    getResumeItems: vi.fn(),
    getRows: vi.fn(),
    getSettings: vi.fn(),
    getStatus: vi.fn(),
    getCurrentUser: vi.fn(),
    recordEvent: vi.fn(),
    requestJson: vi.fn()
}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: { currentApiClient: () => null, getApiClient: () => null }
}));
vi.mock('../../api', () => ({
    getCurrentPtvApiClient: () => mocks.apiClient,
    getPtvCurrentUser: mocks.getCurrentUser,
    getPtvCurrentUserId: () => 'user-a',
    getPtvItems: mocks.getItems,
    getPtvRecentlyAdded: mocks.getRecentlyAdded,
    getPtvResumeItems: mocks.getResumeItems,
    getPtvServerId: () => 'server-a',
    isPtvAdminUser: () => true,
    requestPtvJson: mocks.requestJson
}));
vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: () => ({
        getFeaturedContentCacheDocument: mocks.getFeaturedContentCacheDocument,
        getRows: mocks.getRows,
        getSettings: mocks.getSettings,
        getStatus: mocks.getStatus
    }),
    normalizePtvApiError: (error: unknown) => ({
        kind: 'server',
        message: error instanceof Error ? error.message : String(error)
    })
}));
vi.mock('../../modules/cache/featuredContentCache', () => ({
    getCachedFeaturedContentPayload: mocks.getCachedFeaturedContentPayload,
    getFeaturedContentCacheStatus: () => ({
        adoptionResult: 'accepted',
        cacheVersion: 1,
        isFresh: true,
        lastRejectionReason: null,
        payloadClassification: 'usable'
    }),
    getPtvFeaturedRowConfigHash: () => 'fixture-row-config-hash'
}));
vi.mock('../../core/clientProfile', () => ({
    getPtvPerformanceProfile: () => ({ isFireTv: false, isLowPower: false })
}));
vi.mock('../../core/observability', () => ({
    recordPtvEvent: mocks.recordEvent,
    recordPtvTiming: vi.fn(),
    shouldCollectDiagnostics: () => false,
    timePtvAsync: (_category: string, _name: string, task: () => Promise<unknown>) => task()
}));
vi.mock('../../shell/foundation', () => ({
    clearPtvShellStatus: vi.fn(),
    setPtvShellError: vi.fn(),
    setPtvShellLoading: vi.fn()
}));

import {
    retireNativeHomeIdentityState,
    useNativeHomeData
} from './hooks';
import { retireConfiguredRowFreshness } from './configuredRowFreshness';

const scope = 'a'.repeat(64);
const generation = '1'.repeat(64);
const rule = 'b'.repeat(64);
const section = 'c'.repeat(64);
const configuredItem = { Id: 'configured-item', Name: 'Configured', Type: 'Movie' };
const genericItem = { Id: 'generic-item', Name: 'Generic', Type: 'Movie' };
const resumeItem = { Id: 'resume-item', Name: 'Resume', Type: 'Movie' };
const authority = () => ({ version: 1, scope, generation });
const settings = () => ({
    configuredRowAssociations: {
        rules: [ { association: rule, ruleId: 'latest-rule' } ],
        scope,
        sections: [ { rule, section } ],
        version: 1
    },
    currentPresentationAuthority: authority(),
    enableConfiguredRows: true,
    enabled: true,
    rowSettings: { enableConfiguredRows: true, showConfiguredRowsOnHome: true },
    rules: [ {
        id: 'latest-rule',
        itemLimit: 16,
        mediaType: 'Movie',
        name: 'Latest Movies',
        rowCount: 1,
        sourceType: 'latest'
    } ],
    schemaVersion: 2,
    showConfiguredRowsOnHome: true
});
const settingsWithContinueWatching = () => {
    const value = settings();

    return {
        ...value,
        rules: [
            {
                id: 'continue-rule',
                itemLimit: 16,
                mediaType: 'Video',
                name: 'Continue Watching',
                rowCount: 1,
                sourceType: 'continueWatching'
            },
            ...value.rules
        ]
    };
};
const featured = () => ({
    currentPresentationAuthority: authority(),
    heroItems: [],
    sectionItems: {
        configured: [ configuredItem ],
        generic: [ genericItem ]
    },
    sections: [
        {
            configuredRowAssociation: { version: 1, scope, rule, section },
            id: 'configured',
            mediaType: 'Movie',
            rowType: 'configured-rule',
            source: 'authorized',
            sourceType: 'latest',
            title: 'Featured'
        },
        {
            id: 'generic',
            mediaType: 'Movie',
            rowType: 'fallback',
            source: 'authorized',
            sourceType: 'latest',
            title: 'Generic'
        }
    ]
});
const status = () => ({
    configuredPresentationBindings: [ { rule, section } ],
    currentPresentationAuthority: authority(),
    currentHomeTopology: { version: 1, epoch: 'f'.repeat(64), held: false },
    currentHomeUserAccess: { version: 1, userId: 'user-a', accessEpoch: 'e'.repeat(64),
        held: false, policyProven: true }
});

function deferred<T>(): Deferred<T> {
    let resolve!: Deferred<T>['resolve'];
    const promise = new Promise<T>(next => {
        resolve = next;
    });
    return { promise, resolve };
}

function stageInputs() {
    const rowSettings = deferred<ReturnType<typeof settings>>();
    const featuredPayload = deferred<ReturnType<typeof featured>>();
    const finalStatus = deferred<ReturnType<typeof status>>();
    mocks.getSettings.mockImplementationOnce(() => rowSettings.promise);
    mocks.getCachedFeaturedContentPayload.mockImplementationOnce(() => featuredPayload.promise);
    mocks.getStatus.mockImplementationOnce(() => finalStatus.promise);
    return { featuredPayload, finalStatus, rowSettings };
}

let latestState: ReturnType<typeof useNativeHomeData> | null = null;

function Harness() {
    latestState = useNativeHomeData();
    return <div data-rows={latestState.rows.map(row => row.id).join(',')} />;
}

const reactActEnvironment = globalThis as typeof globalThis & {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe('useNativeHomeData configured-row final proof integration', () => {
    let container: HTMLDivElement;
    let root: Root;

    async function flush(turns = 120) {
        await act(async () => {
            for (let index = 0; index < turns; index++) await Promise.resolve();
        });
    }

    beforeEach(() => {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 73));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        Object.values(mocks).forEach(value => {
            if (typeof value === 'function' && 'mockReset' in value) {
                (value as ReturnType<typeof vi.fn>).mockReset();
            }
        });
        mocks.getCurrentUser.mockResolvedValue({ Id: 'user-a' });
        mocks.getItems.mockResolvedValue({ Items: [ configuredItem, genericItem ], TotalRecordCount: 2 });
        mocks.getRecentlyAdded.mockResolvedValue([]);
        mocks.getResumeItems.mockResolvedValue({ Items: [] });
        mocks.getRows.mockResolvedValue(null);
        mocks.getFeaturedContentCacheDocument.mockResolvedValue(null);
        mocks.requestJson.mockResolvedValue({ Items: [] });
        retireConfiguredRowFreshness('test-reset');
        retireNativeHomeIdentityState('server-a', 'user-a');
        latestState = null;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    });

    it('starts the final bypass read only after both actual inputs and renders configured output only after it resolves', async () => {
        const staged = stageInputs();
        await act(async () => root.render(<Harness />));
        await flush();
        expect(mocks.getSettings).toHaveBeenCalledOnce();
        expect(mocks.getCachedFeaturedContentPayload).toHaveBeenCalledOnce();
        expect(mocks.getStatus).not.toHaveBeenCalled();

        staged.rowSettings.resolve(settings());
        await flush();
        expect(mocks.getStatus).not.toHaveBeenCalled();
        expect(latestState?.rows.some(row => row.rowType === 'configured-rule')).toBe(false);

        staged.featuredPayload.resolve(featured());
        await flush();
        expect(mocks.getStatus).toHaveBeenCalledOnce();
        expect(mocks.getStatus).toHaveBeenCalledWith(expect.objectContaining({
            bypassCache: true,
            signal: expect.any(AbortSignal)
        }));
        expect(latestState?.rows.some(row => row.rowType === 'configured-rule')).toBe(false);

        staged.finalStatus.resolve(status());
        await flush();
        const configured = latestState?.rows.find(row => row.rowType === 'configured-rule');
        expect(configured).toMatchObject({
            configuredPresentationAuthority: `${scope}.${generation}`,
            id: `featured-associated-${section}`,
            items: [ configuredItem ],
            title: 'Latest Movies'
        });
        expect(mocks.getFeaturedContentCacheDocument).not.toHaveBeenCalled();
    });

    it('retires configured output and withholds the Plugin generic shelf until remount proof resolves', async () => {
        const initial = stageInputs();
        await act(async () => root.render(<Harness />));
        initial.rowSettings.resolve(settings());
        initial.featuredPayload.resolve(featured());
        await flush();
        initial.finalStatus.resolve(status());
        await flush();
        expect(latestState?.rows.some(row => row.rowType === 'configured-rule')).toBe(true);
        expect(latestState?.rows.some(row => row.id === 'featured-generic-latest-authorized')).toBe(true);

        await act(async () => {
            retireConfiguredRowFreshness('observed-mutation');
        });
        expect(latestState?.rows.some(row => row.rowType === 'configured-rule')).toBe(false);
        expect(latestState?.rows.some(row => row.id === 'featured-generic-latest-authorized')).toBe(true);

        act(() => root.unmount());
        root = createRoot(container);
        mocks.getStatus.mockClear();
        stageInputs();
        await act(async () => root.render(<Harness />));
        await flush();

        expect(mocks.getStatus).not.toHaveBeenCalled();
        expect(latestState?.rows.map(row => row.id)).not.toContain('featured-generic-latest-authorized');
        expect(latestState?.rows.some(row => row.rowType === 'configured-rule')).toBe(false);
    });

    it('keeps presentation references stable on a parent render but retires them on a new freshness snapshot', async () => {
        const staged = stageInputs();
        await act(async () => root.render(<Harness />));
        staged.rowSettings.resolve(settings());
        staged.featuredPayload.resolve(featured());
        await flush();
        staged.finalStatus.resolve(status());
        await flush();
        const settledRows = latestState!.rows;
        const settledAuthorities = latestState!.configuredHeroAuthorities;
        expect(settledRows.some(row => row.rowType === 'configured-rule')).toBe(true);

        act(() => root.render(<Harness />));
        expect(latestState!.rows).toBe(settledRows);
        expect(latestState!.configuredHeroAuthorities).toBe(settledAuthorities);

        act(() => retireConfiguredRowFreshness('observed-mutation'));
        expect(latestState!.rows).not.toBe(settledRows);
        expect(latestState!.rows.some(row => row.rowType === 'configured-rule')).toBe(false);
    });

    it('loads configured Continue Watching when a featured cache is usable', async () => {
        const staged = stageInputs();
        mocks.getResumeItems.mockResolvedValue({ Items: [ resumeItem ], TotalRecordCount: 1 });
        await act(async () => root.render(<Harness />));
        staged.rowSettings.resolve(settingsWithContinueWatching());
        staged.featuredPayload.resolve(featured());
        await flush();
        staged.finalStatus.resolve(status());
        await flush();

        expect(mocks.getResumeItems).toHaveBeenCalledOnce();
        expect(mocks.getResumeItems).toHaveBeenCalledWith(expect.objectContaining({
            Limit: 16,
            MediaTypes: 'Video'
        }), expect.objectContaining({
            signal: expect.any(AbortSignal),
            userId: 'user-a'
        }));
        expect(latestState?.rows).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'resume',
                items: [ resumeItem ],
                title: 'Continue Watching'
            })
        ]));
    });

    it('leaves an unconfigured cache-backed resume read to the supplemental owner', async () => {
        mocks.getSettings.mockResolvedValue(null);
        mocks.getCachedFeaturedContentPayload.mockResolvedValue({
            ...featured(),
            rowConfigApplied: true,
            rowConfigHash: 'legacy-current-row-config'
        });
        mocks.getStatus.mockResolvedValue(status());
        mocks.getResumeItems.mockResolvedValue({ Items: [ resumeItem ], TotalRecordCount: 1 });
        await act(async () => root.render(<Harness />));
        await flush(200);

        const frameCallbacks = vi.mocked(window.requestAnimationFrame).mock.calls
            .map(([ callback ]) => callback);
        expect(frameCallbacks.length).toBeGreaterThan(0);
        await act(async () => {
            frameCallbacks.forEach(callback => {
                callback(performance.now());
            });
            await vi.runOnlyPendingTimersAsync();
            for (let index = 0; index < 120; index++) await Promise.resolve();
        });

        const videoResumeCalls = mocks.getResumeItems.mock.calls
            .filter(([ query ]) => query.MediaTypes === 'Video');
        expect(videoResumeCalls).toHaveLength(1);
        expect(mocks.getResumeItems).toHaveBeenCalledTimes(3);
    });
});
