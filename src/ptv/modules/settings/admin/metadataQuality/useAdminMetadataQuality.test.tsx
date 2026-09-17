import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    DEFAULT_ADMIN_METADATA_QUALITY_FILTERS,
    type AdminMetadataQualityAiStatus,
    type AdminMetadataQualityAiTestResult,
    type AdminMetadataQualityDetail,
    type AdminMetadataQualityResultPage,
    type AdminMetadataQualitySettings,
    type AdminMetadataQualitySummary
} from './adminMetadataQualityModel';

const pluginClient = {};
const serviceMocks = vi.hoisted(() => ({
    cancelScan: vi.fn(),
    loadDetail: vi.fn(),
    loadAiStatus: vi.fn(),
    loadResults: vi.fn(),
    loadSettings: vi.fn(),
    loadSummary: vi.fn(),
    resolveResult: vi.fn(),
    saveSettings: vi.fn(),
    startScan: vi.fn(),
    testAi: vi.fn()
}));

vi.mock('../../../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: () => pluginClient
}));

vi.mock('./adminMetadataQualityService', () => ({
    cancelAdminMetadataQualityScan: serviceMocks.cancelScan,
    loadAdminMetadataQualityAiStatus: serviceMocks.loadAiStatus,
    loadAdminMetadataQualityDetail: serviceMocks.loadDetail,
    loadAdminMetadataQualityResults: serviceMocks.loadResults,
    loadAdminMetadataQualitySettings: serviceMocks.loadSettings,
    loadAdminMetadataQualitySummary: serviceMocks.loadSummary,
    resolveAdminMetadataQualityResult: serviceMocks.resolveResult,
    saveAdminMetadataQualitySettings: serviceMocks.saveSettings,
    startAdminMetadataQualityScan: serviceMocks.startScan,
    testAdminMetadataQualityAiConnection: serviceMocks.testAi
}));

import {
    getAdminMetadataQualityQueryKeys,
    getAdminMetadataQualityRefreshInterval,
    useAdminMetadataQuality
} from './useAdminMetadataQuality';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

const apiClient = (serverId = 'server-a') => ({ serverId: () => serverId } as ApiClient);

const summary: AdminMetadataQualitySummary = {
    counts: {
        dismissed: 0,
        healthy: 10,
        incomplete: 1,
        likelyIncorrect: 2,
        needsReview: 3,
        resolved: 0,
        totalScanned: 16,
        unavailable: 0
    },
    lastScanAt: '2026-08-13T12:00:00Z',
    libraries: [ { id: 'library-a', name: 'Movies' } ],
    ruleVersion: '1',
    scan: {
        completedAt: '2026-08-13T12:00:00Z',
        errorMessage: null,
        itemCount: 16,
        mode: 'changed',
        processedCount: 16,
        runId: 'run-a',
        startedAt: '2026-08-13T11:59:00Z',
        state: 'completed'
    },
    scannerVersion: '1'
};

const detail: AdminMetadataQualityDetail = {
    aiReviewed: false,
    candidates: [],
    completenessScore: 90,
    currentMatch: null,
    fileName: null,
    folderName: null,
    itemId: 'item-a',
    itemType: 'Movie',
    libraryId: 'library-a',
    libraryName: 'Movies',
    matchConfidence: 40,
    providerVerified: false,
    reasons: [],
    resolutionState: null,
    scannedAt: '2026-08-13T12:00:00Z',
    signals: {},
    status: 'likely_wrong',
    suggestedMatch: null,
    title: 'Review me'
};

const resultPage: AdminMetadataQualityResultPage = {
    items: [ detail ],
    limit: 50,
    startIndex: 0,
    totalRecordCount: 1
};

const settings: AdminMetadataQualitySettings = {
    aiEnabled: false,
    aiMaxItemsPerRun: 100,
    aiMinimumConfidence: 35,
    aiModel: 'test-model',
    aiThreshold: 70,
    enabled: true,
    likelyWrongThreshold: 50,
    providerMaximumRequestsPerRun: 250,
    providerVerificationEnabled: true,
    providerVerificationThreshold: 85,
    reviewThreshold: 70,
    revision: 2,
    scheduledIncrementalScan: true,
    selectedLibraryIds: []
};

const aiStatus: AdminMetadataQualityAiStatus = {
    configuredModel: 'test-model',
    credentialConfigured: true,
    credentialSource: 'environment',
    effectiveModel: 'test-model',
    enabled: false,
    lastTestAt: null,
    lastTestErrorCode: null,
    lastTestModel: null,
    lastTestStatus: null,
    modelSource: 'environment'
};

const aiTestResult: AdminMetadataQualityAiTestResult = {
    message: 'OpenAI connection succeeded.',
    model: 'test-model',
    status: 'success',
    success: true,
    testedAt: '2026-08-13T12:00:00Z'
};

type HookState = ReturnType<typeof useAdminMetadataQuality>;

function Harness({
    client = apiClient(),
    itemId = '',
    settingsOpen = false,
    stateRef
}: Readonly<{
    client?: ApiClient;
    itemId?: string;
    settingsOpen?: boolean;
    stateRef: { current?: HookState };
}>) {
    stateRef.current = useAdminMetadataQuality(
        client,
        itemId,
        DEFAULT_ADMIN_METADATA_QUALITY_FILTERS,
        settingsOpen
    );
    return null;
}

async function flushQueries() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

describe('Metadata Quality query orchestration', () => {
    let container: HTMLDivElement;
    let queryClient: QueryClient;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        serviceMocks.loadSummary.mockResolvedValue(summary);
        serviceMocks.loadAiStatus.mockResolvedValue(aiStatus);
        serviceMocks.loadResults.mockResolvedValue(resultPage);
        serviceMocks.loadDetail.mockResolvedValue(detail);
        serviceMocks.loadSettings.mockResolvedValue(settings);
        serviceMocks.startScan.mockResolvedValue(summary);
        serviceMocks.cancelScan.mockResolvedValue(summary);
        serviceMocks.resolveResult.mockResolvedValue(detail);
        serviceMocks.saveSettings.mockResolvedValue(settings);
        serviceMocks.testAi.mockResolvedValue(aiTestResult);
        queryClient = new QueryClient({
            defaultOptions: { queries: { gcTime: Infinity, retry: false } }
        });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        queryClient.clear();
        container.remove();
    });

    async function render(stateRef: { current?: HookState }, props: Readonly<{
        client?: ApiClient;
        itemId?: string;
        settingsOpen?: boolean;
    }> = {}) {
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness stateRef={stateRef} {...props} />
            </QueryClientProvider>
        ));
        await flushQueries();
    }

    it('uses source-, server-, entity-, and argument-scoped query identities', () => {
        const serverA = getAdminMetadataQualityQueryKeys('server-a', DEFAULT_ADMIN_METADATA_QUALITY_FILTERS, 'item-a');
        const serverB = getAdminMetadataQualityQueryKeys('server-b', DEFAULT_ADMIN_METADATA_QUALITY_FILTERS, 'item-a');

        expect(serverA.summary).toEqual([ 'PtvAdminMetadataQuality', 'server-a', 'status-summary' ]);
        expect(serverA.detail).toEqual([ 'PtvAdminMetadataQuality', 'server-a', 'detail', { itemId: 'item-a' } ]);
        expect(serverA.results[serverA.results.length - 1]).toMatchObject({ limit: 50, startIndex: 0, status: 'review' });
        expect(serverA.summary).not.toEqual(serverB.summary);
    });

    it('uses visible-only scan polling and no idle page polling', () => {
        const running = { ...summary, scan: { ...summary.scan, state: 'scanning' as const } };
        expect(getAdminMetadataQualityRefreshInterval(running, 'visible')).toBe(8_000);
        expect(getAdminMetadataQualityRefreshInterval(running, 'hidden')).toBe(false);
        expect(getAdminMetadataQualityRefreshInterval(summary, 'visible')).toBe(false);
        expect(getAdminMetadataQualityRefreshInterval(summary, 'visible', true)).toBe(90_000);
    });

    it('loads exactly summary plus the first result page and performs no mutation on queue load', async () => {
        const requestOrder: string[] = [];
        serviceMocks.loadResults.mockImplementation(async () => {
            requestOrder.push('results');
            return resultPage;
        });
        serviceMocks.loadSummary.mockImplementation(async () => {
            requestOrder.push('summary');
            return summary;
        });
        const stateRef: { current?: HookState } = {};
        await render(stateRef);

        expect(stateRef.current?.summary).toEqual(summary);
        expect(stateRef.current?.resultPage).toEqual(resultPage);
        expect(serviceMocks.loadSummary).toHaveBeenCalledOnce();
        expect(serviceMocks.loadResults).toHaveBeenCalledOnce();
        expect(serviceMocks.loadDetail).not.toHaveBeenCalled();
        expect(serviceMocks.loadAiStatus).not.toHaveBeenCalled();
        expect(serviceMocks.loadSettings).not.toHaveBeenCalled();
        expect(serviceMocks.startScan).not.toHaveBeenCalled();
        expect(serviceMocks.testAi).not.toHaveBeenCalled();
        expect(serviceMocks.cancelScan).not.toHaveBeenCalled();
        expect(serviceMocks.resolveResult).not.toHaveBeenCalled();
        expect(serviceMocks.saveSettings).not.toHaveBeenCalled();
        expect(requestOrder).toEqual([ 'results', 'summary' ]);
    });

    it('loads exactly summary plus selected detail on a direct detail route', async () => {
        const requestOrder: string[] = [];
        serviceMocks.loadDetail.mockImplementation(async () => {
            requestOrder.push('detail');
            return detail;
        });
        serviceMocks.loadSummary.mockImplementation(async () => {
            requestOrder.push('summary');
            return summary;
        });
        const stateRef: { current?: HookState } = {};
        await render(stateRef, { itemId: 'item-a' });

        expect(stateRef.current?.detail).toEqual(detail);
        expect(serviceMocks.loadSummary).toHaveBeenCalledOnce();
        expect(serviceMocks.loadDetail).toHaveBeenCalledOnce();
        expect(serviceMocks.loadResults).not.toHaveBeenCalled();
        expect(serviceMocks.loadSettings).not.toHaveBeenCalled();
        expect(requestOrder).toEqual([ 'detail', 'summary' ]);
    });

    it('reuses a recently loaded bounded result page when the queue remounts', async () => {
        const stateRef: { current?: HookState } = {};
        await render(stateRef);
        expect(serviceMocks.loadResults).toHaveBeenCalledOnce();

        await act(async () => root.unmount());
        root = createRoot(container);
        await render(stateRef);

        expect(stateRef.current?.resultPage).toEqual(resultPage);
        expect(serviceMocks.loadResults).toHaveBeenCalledOnce();
    });

    it('loads settings lazily only after the dialog opens', async () => {
        const stateRef: { current?: HookState } = {};
        await render(stateRef);
        expect(serviceMocks.loadSettings).not.toHaveBeenCalled();

        await render(stateRef, { settingsOpen: true });
        expect(serviceMocks.loadSettings).toHaveBeenCalledOnce();
        expect(serviceMocks.loadAiStatus).toHaveBeenCalledOnce();
        expect(stateRef.current?.settings).toEqual(settings);
        expect(stateRef.current?.aiStatus).toEqual(aiStatus);
    });

    it('keeps result data usable when the independent summary request fails', async () => {
        serviceMocks.loadSummary.mockRejectedValue(new Error('summary unavailable'));
        const stateRef: { current?: HookState } = {};
        await render(stateRef);

        await act(async () => new Promise(resolve => setTimeout(resolve, 1_100)));
        await flushQueries();
        expect(stateRef.current?.summaryError).toBeTruthy();
        expect(stateRef.current?.resultPage).toEqual(resultPage);
    });

    it('fails closed before a stable server identity exists', async () => {
        const stateRef: { current?: HookState } = {};
        await render(stateRef, { client: apiClient('') });

        expect(stateRef.current?.enabled).toBe(false);
        expect(serviceMocks.loadSummary).not.toHaveBeenCalled();
        expect(serviceMocks.loadResults).not.toHaveBeenCalled();
    });

    it('single-flights connection tests without saving settings, enabling AI, or starting a scan', async () => {
        let resolveTest!: (result: AdminMetadataQualityAiTestResult) => void;
        serviceMocks.testAi.mockReturnValue(new Promise(resolve => {
            resolveTest = resolve;
        }));
        const stateRef: { current?: HookState } = {};
        await render(stateRef, { settingsOpen: true });

        let first!: Promise<boolean>;
        let second!: Promise<boolean>;
        act(() => {
            first = stateRef.current!.testAiConnection('test-model');
            second = stateRef.current!.testAiConnection('test-model');
        });

        expect(first).toBe(second);
        expect(serviceMocks.testAi).toHaveBeenCalledOnce();
        expect(serviceMocks.testAi).toHaveBeenCalledWith(pluginClient, 'test-model');
        expect(stateRef.current?.activeAction).toBe('test-ai');

        await act(async () => {
            resolveTest(aiTestResult);
            await Promise.all([ first, second ]);
        });
        await flushQueries();

        expect(stateRef.current?.aiTestResult).toEqual(aiTestResult);
        expect(stateRef.current?.activeAction).toBeNull();
        expect(serviceMocks.saveSettings).not.toHaveBeenCalled();
        expect(serviceMocks.startScan).not.toHaveBeenCalled();
        expect(settings.aiEnabled).toBe(false);
    });
});
