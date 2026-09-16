import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getCurrentPtvPluginApiClient } from '../../../../core/pluginApi';
import { getResolvedAdminServerId } from '../adminServerIdentity';
import {
    ADMIN_METADATA_QUALITY_OVERVIEW_REFRESH_INTERVAL_MS,
    ADMIN_METADATA_QUALITY_PAGE_SIZE,
    ADMIN_METADATA_QUALITY_RUNNING_REFRESH_INTERVAL_MS,
    AdminMetadataQualityServiceError,
    type AdminMetadataQualityAiTestResult,
    type AdminMetadataQualityFilters,
    type AdminMetadataQualityResolutionAction,
    type AdminMetadataQualityScanMode,
    type AdminMetadataQualitySettings,
    type AdminMetadataQualitySummary
} from './adminMetadataQualityModel';
import {
    cancelAdminMetadataQualityScan,
    loadAdminMetadataQualityAiStatus,
    loadAdminMetadataQualityDetail,
    loadAdminMetadataQualityResults,
    loadAdminMetadataQualitySettings,
    loadAdminMetadataQualitySummary,
    resolveAdminMetadataQualityResult,
    saveAdminMetadataQualitySettings,
    startAdminMetadataQualityScan,
    testAdminMetadataQualityAiConnection
} from './adminMetadataQualityService';

const ADMIN_METADATA_QUALITY_QUERY_SCOPE = 'PtvAdminMetadataQuality';
const ADMIN_METADATA_QUALITY_SEARCH_DEBOUNCE_MS = 350;
const ADMIN_METADATA_QUALITY_RESULT_STALE_TIME_MS = 60_000;

export type AdminMetadataQualityAction =
    | 'cancel-scan'
    | 'resolve'
    | 'save-settings'
    | 'start-scan'
    | 'test-ai';

function normalizeText(value: string) {
    return value.trim();
}

function normalizeFilters(filters: AdminMetadataQualityFilters): AdminMetadataQualityFilters {
    return {
        ...filters,
        itemType: normalizeText(filters.itemType),
        libraryId: normalizeText(filters.libraryId),
        maxConfidence: filters.maxConfidence === null ? null : Math.min(100, Math.max(0, filters.maxConfidence)),
        minConfidence: filters.minConfidence === null ? null : Math.min(100, Math.max(0, filters.minConfidence)),
        provider: normalizeText(filters.provider),
        reason: normalizeText(filters.reason),
        search: normalizeText(filters.search),
        startIndex: Math.max(0, Math.floor(filters.startIndex))
    };
}

export function getAdminMetadataQualityQueryKeys(
    serverKey: string,
    filters?: AdminMetadataQualityFilters,
    itemId?: string
) {
    const scope = [ ADMIN_METADATA_QUALITY_QUERY_SCOPE, serverKey.trim() || 'unresolved-server' ] as const;
    const normalizedFilters = filters ? normalizeFilters(filters) : undefined;
    return {
        detail: [ ...scope, 'detail', { itemId: itemId?.trim() || '' } ] as const,
        results: [
            ...scope,
            'results',
            {
                ...normalizedFilters,
                limit: ADMIN_METADATA_QUALITY_PAGE_SIZE
            }
        ] as const,
        resultsRoot: [ ...scope, 'results' ] as const,
        aiStatus: [ ...scope, 'ai-status' ] as const,
        settings: [ ...scope, 'settings' ] as const,
        summary: [ ...scope, 'status-summary' ] as const
    };
}

// React Query uses false to disable an otherwise numeric interval.
// eslint-disable-next-line sonarjs/function-return-type
export function getAdminMetadataQualityRefreshInterval(
    summary: AdminMetadataQualitySummary | undefined,
    visibilityState?: DocumentVisibilityState,
    overview = false
): number | false {
    // eslint-disable-next-line compat/compat
    const visibility = visibilityState ?? (typeof document === 'undefined' ? 'visible' : document.visibilityState);
    if (visibility !== 'visible') return false;
    if (summary?.scan.state === 'scanning') return ADMIN_METADATA_QUALITY_RUNNING_REFRESH_INTERVAL_MS;
    return overview ? ADMIN_METADATA_QUALITY_OVERVIEW_REFRESH_INTERVAL_MS : false;
}

function useDebouncedText(value: string) {
    const [ debounced, setDebounced ] = useState(value);

    useEffect(() => {
        const timeout = window.setTimeout(() => setDebounced(value), ADMIN_METADATA_QUALITY_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timeout);
    }, [ value ]);

    return debounced;
}

function useVisibleSummaryRefresh(
    isRunning: boolean,
    refresh: () => Promise<unknown>
) {
    useEffect(() => {
        if (!isRunning || typeof document === 'undefined') return;

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') void refresh();
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [ isRunning, refresh ]);
}

export function useAdminMetadataQualitySummary(
    apiClient?: ApiClient,
    overview = false
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const client = useMemo(() => getCurrentPtvPluginApiClient(apiClient), [ apiClient ]);
    const keys = useMemo(
        () => getAdminMetadataQualityQueryKeys(serverKey || 'unresolved-server'),
        [ serverKey ]
    );
    const enabled = Boolean(client && serverKey);
    const query = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminMetadataQualitySummary(client, signal),
        queryKey: keys.summary,
        refetchInterval: current => getAdminMetadataQualityRefreshInterval(current.state.data, undefined, overview),
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: overview ? 45_000 : 10_000
    });
    const refetch = query.refetch;
    const isRunning = query.data?.scan.state === 'scanning';
    useVisibleSummaryRefresh(isRunning, () => refetch({ cancelRefetch: true }));

    return {
        enabled,
        error: query.error,
        fetching: query.isFetching,
        loading: enabled && query.isPending && !query.data,
        refetch: () => refetch({ cancelRefetch: true }),
        serverKey,
        summary: query.data
    } as const;
}

export function useAdminMetadataQuality(
    apiClient: ApiClient | undefined,
    itemId: string,
    filters: AdminMetadataQualityFilters,
    settingsOpen: boolean
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const client = useMemo(() => getCurrentPtvPluginApiClient(apiClient), [ apiClient ]);
    const debouncedSearch = useDebouncedText(filters.search);
    const queryFilters = useMemo(
        () => normalizeFilters({ ...filters, search: debouncedSearch }),
        [ debouncedSearch, filters ]
    );
    const keys = useMemo(
        () => getAdminMetadataQualityQueryKeys(serverKey || 'unresolved-server', queryFilters, itemId),
        [ itemId, queryFilters, serverKey ]
    );
    const queryClient = useQueryClient();
    const enabled = Boolean(client && serverKey);
    const isQueue = itemId === '';
    // Start the route's primary bounded payload before the summary. The plugin
    // store serializes cold reads, so this lets the queue/detail become useful
    // first without adding requests or coupling either source's failure state.
    const resultsQuery = useQuery({
        enabled: Boolean(enabled && isQueue),
        placeholderData: keepPreviousData,
        queryFn: ({ signal }) => loadAdminMetadataQualityResults(client, queryFilters, signal),
        queryKey: keys.results,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: ADMIN_METADATA_QUALITY_RESULT_STALE_TIME_MS
    });
    const detailQuery = useQuery({
        enabled: Boolean(enabled && itemId),
        queryFn: ({ signal }) => loadAdminMetadataQualityDetail(client, itemId, signal),
        queryKey: keys.detail,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: ADMIN_METADATA_QUALITY_RESULT_STALE_TIME_MS
    });
    const summaryQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminMetadataQualitySummary(client, signal),
        queryKey: keys.summary,
        refetchInterval: current => getAdminMetadataQualityRefreshInterval(current.state.data),
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 10_000
    });
    const settingsQuery = useQuery({
        enabled: Boolean(enabled && settingsOpen),
        queryFn: ({ signal }) => loadAdminMetadataQualitySettings(client, signal),
        queryKey: keys.settings,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 60_000
    });
    const aiStatusQuery = useQuery({
        enabled: Boolean(enabled && settingsOpen),
        queryFn: ({ signal }) => loadAdminMetadataQualityAiStatus(client, signal),
        queryKey: keys.aiStatus,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 30_000
    });
    const previousScanState = useRef(summaryQuery.data?.scan.state);
    const actionFlight = useRef<Promise<boolean> | null>(null);
    const [ activeAction, setActiveAction ] = useState<AdminMetadataQualityAction | null>(null);
    const [ actionError, setActionError ] = useState<string | null>(null);
    const [ actionMessage, setActionMessage ] = useState<string | null>(null);
    const [ aiTestError, setAiTestError ] = useState<string | null>(null);
    const [ aiTestResult, setAiTestResult ] = useState<AdminMetadataQualityAiTestResult | null>(null);
    const refetchSummary = summaryQuery.refetch;
    const isRunning = summaryQuery.data?.scan.state === 'scanning';

    useVisibleSummaryRefresh(isRunning, () => refetchSummary({ cancelRefetch: true }));

    useEffect(() => {
        previousScanState.current = undefined;
        setAiTestError(null);
        setAiTestResult(null);
    }, [ serverKey ]);

    useEffect(() => {
        const previous = previousScanState.current;
        const current = summaryQuery.data?.scan.state;
        previousScanState.current = current;
        if (previous !== 'scanning' || !current || current === 'scanning' || !serverKey) return;

        void Promise.allSettled([
            queryClient.invalidateQueries({ queryKey: keys.resultsRoot }),
            itemId ? queryClient.invalidateQueries({ exact: true, queryKey: keys.detail }) : Promise.resolve()
        ]);
    }, [ itemId, keys.detail, keys.resultsRoot, queryClient, serverKey, summaryQuery.data?.scan.state ]);

    const runExclusive = useCallback((
        action: AdminMetadataQualityAction,
        operation: () => Promise<void>
    ) => {
        if (actionFlight.current) return actionFlight.current;
        setActiveAction(action);
        setActionError(null);
        setActionMessage(null);
        if (action === 'test-ai') {
            setAiTestError(null);
            setAiTestResult(null);
        }
        const promise = operation()
            .then(() => true)
            .catch(error => {
                const message = error instanceof Error ? error.message : 'The Metadata Quality action could not be completed.';
                if (action === 'test-ai') setAiTestError(message);
                else setActionError(message);
                return false;
            })
            .finally(() => {
                actionFlight.current = null;
                setActiveAction(null);
            });
        actionFlight.current = promise;
        return promise;
    }, []);

    const startScan = useCallback((mode: AdminMetadataQualityScanMode) => runExclusive('start-scan', async () => {
        await startAdminMetadataQualityScan(client, mode);
        setActionMessage(mode === 'full' ? 'Full audit started.' : 'New and changed item scan started.');
        await queryClient.invalidateQueries({ exact: true, queryKey: keys.summary });
    }), [ client, keys.summary, queryClient, runExclusive ]);

    const cancelScan = useCallback(() => runExclusive('cancel-scan', async () => {
        await cancelAdminMetadataQualityScan(client);
        setActionMessage('Scan cancellation requested. Already-scanned results remain available.');
        await queryClient.invalidateQueries({ exact: true, queryKey: keys.summary });
    }), [ client, keys.summary, queryClient, runExclusive ]);

    const resolveResult = useCallback((action: AdminMetadataQualityResolutionAction) => runExclusive('resolve', async () => {
        const result = await resolveAdminMetadataQualityResult(client, itemId, action);
        queryClient.setQueryData(keys.detail, result);
        setActionMessage(action === 'dismiss' ? 'Finding dismissed.' : 'Current metadata kept.');
        await Promise.allSettled([
            queryClient.invalidateQueries({ exact: true, queryKey: keys.summary }),
            queryClient.invalidateQueries({ queryKey: keys.resultsRoot })
        ]);
    }), [ client, itemId, keys.detail, keys.resultsRoot, keys.summary, queryClient, runExclusive ]);

    const testAiConnection = useCallback((model: string) => runExclusive('test-ai', async () => {
        const result = await testAdminMetadataQualityAiConnection(client, model);
        setAiTestResult(result);
        await queryClient.invalidateQueries({ exact: true, queryKey: keys.aiStatus });
    }), [ client, keys.aiStatus, queryClient, runExclusive ]);

    const saveSettings = useCallback((settings: AdminMetadataQualitySettings) => runExclusive('save-settings', async () => {
        const authoritative = await loadAdminMetadataQualitySettings(client);
        if (authoritative.revision !== settings.revision) {
            queryClient.setQueryData(keys.settings, authoritative);
            throw new AdminMetadataQualityServiceError(
                'conflict',
                'Metadata Quality settings changed on the server. Reload the latest settings and try again.'
            );
        }
        const saved = await saveAdminMetadataQualitySettings(client, settings);
        queryClient.setQueryData(keys.settings, saved);
        setActionMessage('Metadata Quality settings saved.');
        await queryClient.invalidateQueries({ exact: true, queryKey: keys.aiStatus });
    }), [ client, keys.aiStatus, keys.settings, queryClient, runExclusive ]);

    return {
        actionError,
        actionMessage,
        activeAction,
        aiStatus: aiStatusQuery.data,
        aiStatusError: aiStatusQuery.error,
        aiStatusLoading: enabled && settingsOpen && aiStatusQuery.isPending && !aiStatusQuery.data,
        aiTestError,
        aiTestResult,
        cancelScan,
        clearActionFeedback: () => {
            setActionError(null);
            setActionMessage(null);
        },
        detail: detailQuery.data,
        detailError: detailQuery.error,
        detailFetching: detailQuery.isFetching,
        detailLoading: enabled && Boolean(itemId) && detailQuery.isPending && !detailQuery.data,
        enabled,
        refetchDetail: () => detailQuery.refetch({ cancelRefetch: true }),
        refetchAiStatus: () => aiStatusQuery.refetch({ cancelRefetch: true }),
        refetchResults: () => resultsQuery.refetch({ cancelRefetch: true }),
        refetchSettings: () => settingsQuery.refetch({ cancelRefetch: true }),
        refetchSummary: () => summaryQuery.refetch({ cancelRefetch: true }),
        resolveResult,
        resultPage: resultsQuery.data,
        resultsError: resultsQuery.error,
        resultsFetching: resultsQuery.isFetching,
        resultsLoading: enabled && isQueue && resultsQuery.isPending && !resultsQuery.data,
        saveSettings,
        serverKey,
        settings: settingsQuery.data,
        settingsError: settingsQuery.error,
        settingsFetching: settingsQuery.isFetching,
        settingsLoading: enabled && settingsOpen && settingsQuery.isPending && !settingsQuery.data,
        startScan,
        summary: summaryQuery.data,
        summaryError: summaryQuery.error,
        summaryFetching: summaryQuery.isFetching,
        summaryLoading: enabled && summaryQuery.isPending && !summaryQuery.data,
        testAiConnection
    } as const;
}
