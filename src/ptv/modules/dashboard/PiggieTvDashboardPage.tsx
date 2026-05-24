import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid2';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import React, { useCallback, useEffect, useState } from 'react';

import Page from 'components/Page';
import { getUserViewsQuery } from 'hooks/useUserViews';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { toApi } from 'utils/jellyfin-apiclient/compat';
import { queryClient } from 'utils/query/queryClient';

import { getPtvClientProfile, getPtvPerformanceProfile } from '../../core/clientProfile';
import { PTV_PLUGIN_API } from '../../core/config';
import {
    getPtvFeatureSettings,
    PTV_FEATURE_SETTINGS_CHANGE_EVENT,
    setPtvFeatureSetting,
    type PtvFeatureSettingKey,
    type PtvFeatureSettings
} from '../../core/featureSettings';
import { getPtvDebugReport, isPtvDebugEnabled, setPtvDebug } from '../../core/observability';
import {
    getCurrentPtvPluginApiClient,
    isPtvPluginApiCoolingDown,
    normalizePtvApiError
} from '../../core/pluginApi';
import {
    clearFeaturedContentCache,
    FEATURED_CACHE_UPDATED_EVENT,
    forceRefreshFeaturedContentCache,
    getFeaturedContentCacheStatus,
    type FeaturedPayload
} from '../cache/featuredContentCache';
import {
    createFeaturedContentFetcher,
    loadGenreMap,
    loadStudioMap,
    PTV_HOME_ROWS
} from '../../pages/home/ptvRows';

type PtvPluginFeaturedStatus = {
    cacheVersion?: number;
    createdAt?: number | null;
    expiresAt?: number | null;
    hasPayload?: boolean;
    heroCount?: number;
    itemCount?: number;
    sectionCount?: number;
    updatedAt?: number;
};

type PtvPluginStatus = {
    apiPath?: string;
    apiVersion?: number;
    cacheBackend?: string;
    cachePathExists?: boolean;
    canReadFeaturedContent?: boolean;
    canWriteFeaturedContent?: boolean;
    featuredContent?: PtvPluginFeaturedStatus;
    featuredCacheCreatedAt?: number | null;
    featuredCacheExists?: boolean;
    featuredCacheExpiresAt?: number | null;
    featuredCacheFresh?: boolean;
    features?: string[];
    lastRefreshCompletedAt?: number | null;
    lastRefreshDurationMs?: number | null;
    lastRefreshError?: string | null;
    lastRefreshStartedAt?: number | null;
    maxCachePayloadBytes?: number;
    name?: string;
    nextRefreshAt?: number | null;
    ok?: boolean;
    pluginName?: string;
    pluginVersion?: string;
    refreshInProgress?: boolean;
    serverTimeUtc?: string;
    version?: string;
};

type PluginConnectionState =
    | 'connected'
    | 'endpoint-unreachable'
    | 'plugin-missing'
    | 'timeout'
    | 'unauthorized'
    | 'using-fallback'
    | 'version-mismatch';

type PluginState = {
    connected: boolean;
    connectionState: PluginConnectionState;
    error: string;
    loading: boolean;
    status: PtvPluginStatus | null;
};

type PtvGlobal = Record<string, unknown> & {
    debug?: {
        report?: () => unknown;
    };
    performance?: {
        report?: () => unknown;
    };
    performanceOverlay?: (enabled?: boolean) => unknown;
};

type PtvWindow = Window & {
    PTV?: PtvGlobal;
};

const EMPTY_PLUGIN_STATE: PluginState = {
    connected: false,
    connectionState: 'endpoint-unreachable',
    error: '',
    loading: true,
    status: null
};

const PLUGIN_STATUS_TIMEOUT_MS = 8000;
const PTV_PLUGIN_INSTALL_NOTE = [
    'Build plugin Release',
    'Copy Jellyfin.Plugin.PiggieTV.dll to Jellyfin plugin folder',
    'Restart Jellyfin',
    'Refresh this page'
].join('\n');

function getErrorMessage(err: unknown) {
    return normalizePtvApiError(err).message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
            reject(Object.assign(new Error('PTV plugin status request timed out.'), {
                code: 'PTV_PLUGIN_TIMEOUT'
            }));
        }, timeoutMs);

        promise
            .then(resolve)
            .catch(reject)
            .finally(() => {
                window.clearTimeout(timer);
            });
    });
}

function classifyPluginError(err: unknown): PluginConnectionState {
    const normalizedError = normalizePtvApiError(err);

    if (normalizedError.kind === 'unauthorized' || normalizedError.kind === 'forbidden') return 'unauthorized';
    if (normalizedError.kind === 'missing') return 'plugin-missing';
    if (normalizedError.kind === 'timeout') return 'timeout';
    if (isPtvPluginApiCoolingDown()) return 'endpoint-unreachable';

    return 'endpoint-unreachable';
}

function isPluginApiVersionMatch(status?: PtvPluginStatus | null) {
    return status?.apiVersion === undefined || status.apiVersion === PTV_PLUGIN_API.version;
}

function createPluginStateFromStatus(status: PtvPluginStatus): PluginState {
    const isVersionMatch = isPluginApiVersionMatch(status);

    return {
        connected: Boolean(status?.ok !== false && isVersionMatch),
        connectionState: isVersionMatch ? 'connected' : 'version-mismatch',
        error: isVersionMatch ? '' : `Version mismatch: expected v${PTV_PLUGIN_API.version} but received v${status?.apiVersion ?? 'unknown'}.`,
        loading: false,
        status
    };
}

function getPluginStateLabel(state: PluginConnectionState) {
    return {
        connected: 'connected',
        'endpoint-unreachable': 'endpoint unreachable',
        'plugin-missing': 'plugin missing',
        timeout: 'timeout',
        unauthorized: 'unauthorized',
        'using-fallback': 'using fallback',
        'version-mismatch': 'version mismatch'
    }[state];
}

function getPluginHelpMessage(
    state: PluginConnectionState,
    pluginStatus: PtvPluginStatus | null,
    cacheSource: string
) {
    if (state === 'plugin-missing' || state === 'endpoint-unreachable') {
        return 'PTV plugin backend is not installed or Jellyfin was not restarted after installation.';
    }

    if (state === 'using-fallback') {
        return cacheSource === 'memory' ?
            'Using memory fallback. Cache will reset after reload.' :
            'Using fallback cache while the plugin endpoint is unavailable.';
    }

    if (state === 'unauthorized') {
        return 'Plugin endpoint responded, but this user is not authorized for that action.';
    }

    if (state === 'version-mismatch') {
        return 'Plugin connected, but its API version does not match the frontend.';
    }

    if (state === 'connected' && pluginStatus?.canWriteFeaturedContent === false) {
        return 'Plugin connected but write access is disabled.';
    }

    return '';
}

function formatDate(timestamp?: number | null) {
    if (!timestamp) return 'n/a';

    return new Date(timestamp).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    });
}

function getFreshnessLabel(status: ReturnType<typeof getFeaturedContentCacheStatus>) {
    if (!status.heroCount && !status.itemCount) return 'missing';

    return status.isFresh ? 'fresh' : 'stale';
}

function getDashboardCacheSource(
    status: ReturnType<typeof getFeaturedContentCacheStatus>,
    pluginStatus: PtvPluginStatus | null
) {
    if (status.storage !== 'none') return status.storage;
    if (pluginStatus?.featuredCacheExists) return 'plugin';

    return 'missing';
}

function getDashboardCacheFreshness(
    status: ReturnType<typeof getFeaturedContentCacheStatus>,
    pluginStatus: PtvPluginStatus | null
) {
    if (status.heroCount || status.itemCount) return getFreshnessLabel(status);
    if (!pluginStatus?.featuredCacheExists) return 'missing';

    return pluginStatus.featuredCacheFresh ? 'fresh' : 'stale';
}

function formatCountdown(timestamp?: number | null) {
    if (!timestamp) return 'n/a';

    const remainingMs = timestamp - Date.now();

    if (remainingMs <= 0) return 'now';

    const totalMinutes = Math.ceil(remainingMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (!hours) return `${minutes}m`;

    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatDuration(durationMs?: number | null) {
    if (!durationMs) return 'n/a';
    if (durationMs < 1000) return `${durationMs} ms`;

    return `${(durationMs / 1000).toFixed(1)} s`;
}

function formatBytes(bytes?: number) {
    if (!bytes) return 'n/a';

    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    return `${value.toFixed(unitIndex ? 1 : 0)} ${units[unitIndex]}`;
}

function getNestedRecord(source: unknown, key: string) {
    if (!isRecord(source)) return null;

    const value = source[key];

    return isRecord(value) ? value : null;
}

function getNumberValue(source: unknown, key: string) {
    if (!isRecord(source)) return null;

    const value = source[key];

    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getPerformanceSnapshot() {
    return getPtvGlobal()?.performance?.report?.() || null;
}

function getMemoryLabel(performanceReport: unknown) {
    const memory = getNestedRecord(performanceReport, 'memory');

    if (!memory) return 'n/a';

    const usedJsHeap = getNumberValue(memory, 'usedJsHeap');
    const jsHeapLimit = getNumberValue(memory, 'jsHeapLimit');
    const deviceMemory = getNumberValue(memory, 'deviceMemory');

    if (usedJsHeap) {
        const limitLabel = jsHeapLimit ? ` / ${formatBytes(jsHeapLimit)}` : '';

        return `${formatBytes(usedJsHeap)}${limitLabel}`;
    }

    return deviceMemory ? `${deviceMemory} GB device` : 'n/a';
}

function getCacheTimingLabel(debugReport: unknown) {
    const cache = getNestedRecord(debugReport, 'cache');
    const timings = getNestedRecord(cache, 'timings');
    const count = getNumberValue(timings, 'count') || 0;
    const averageMs = getNumberValue(timings, 'averageMs') || 0;

    return count ? `${count} samples / ${averageMs} ms avg` : 'n/a';
}

function isDebugLoggingEnabled() {
    return (window as unknown as Record<string, unknown>)['PTV_DEBUG'] === true;
}

function copyTextToClipboard(text: string) {
    if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text);
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand('copy');
    textarea.remove();

    return Promise.resolve();
}

function isPerformanceOverlayActive() {
    return document.documentElement.classList.contains('ptv-performance-overlay-active');
}

function getPtvGlobal() {
    return (window as PtvWindow).PTV;
}

function getCurrentApiClient() {
    return ServerConnections.currentApiClient?.();
}

function fetchDashboardFeaturedContent(): Promise<FeaturedPayload> {
    const apiClient = getCurrentApiClient();
    const userId = apiClient?.getCurrentUserId?.();

    if (!apiClient || !userId) {
        return Promise.reject(new Error('No active Jellyfin API client is available.'));
    }

    return queryClient
        .fetchQuery(getUserViewsQuery(toApi(apiClient), userId))
        .catch(() => (
            typeof apiClient.getUserViews === 'function' ?
                apiClient.getUserViews({}, userId) :
                { Items: [] }
        ))
        .then(result => result.Items || [])
        .then(userViews => Promise.all([
            loadGenreMap(apiClient, userId),
            loadStudioMap(apiClient, userId)
        ])
            .then(([genresByName, studiosByName]) => createFeaturedContentFetcher(
                apiClient,
                userId,
                PTV_HOME_ROWS,
                {
                    genresByName,
                    studiosByName
                },
                userViews
            )()));
}

function isFeatureSettingKey(value: string): value is PtvFeatureSettingKey {
    return Object.prototype.hasOwnProperty.call(getPtvFeatureSettings(), value);
}

function getEffectivePluginConnectionState(
    connected: boolean,
    cacheSource: string,
    connectionState: PluginConnectionState
): PluginConnectionState {
    if (connected) return 'connected';

    const canUseFallbackState = ['endpoint-unreachable', 'plugin-missing', 'timeout'].includes(connectionState);

    if (cacheSource !== 'missing' && canUseFallbackState) return 'using-fallback';

    return connectionState;
}

function getCacheChipIcon(isRefreshing: boolean) {
    return isRefreshing ? <Box component='span' className='ptv-cache-refresh-spinner' /> : undefined;
}

function getCacheChipLabel(isRefreshing: boolean, cacheFreshness: string) {
    return isRefreshing ? 'refreshing' : cacheFreshness;
}

function getRefreshCacheButtonLabel(isRefreshing: boolean) {
    return isRefreshing ? 'Refreshing...' : 'Refresh Cache';
}

function getRefreshStatusButtonLabel(isRefreshing: boolean) {
    return isRefreshing ? 'Refreshing...' : 'Refresh Status';
}

function getClearCacheButtonLabel(isClearing: boolean) {
    return isClearing ? 'Clearing...' : 'Clear Cache';
}

function getStatusMessageSeverity(message: string) {
    return message.includes('failed') ? 'error' : 'info';
}

function isPluginRefreshFallbackError(err: unknown) {
    const normalizedError = normalizePtvApiError(err);

    return (
        normalizedError.kind === 'missing'
        || normalizedError.status === 405
        || normalizedError.kind === 'network'
    );
}

function getPluginHelpSeverity(state: PluginConnectionState) {
    return state === 'connected' ? 'info' : 'warning';
}

function getFpsLabel(currentFps: number | null, averageFps: number | null) {
    if (!averageFps) return currentFps === null ? 'n/a' : String(currentFps);

    return `${currentFps ?? 'n/a'} avg ${averageFps}`;
}

function StatusMessageAlert({ message }: Readonly<{ message: string }>) {
    if (!message) return null;

    return (
        <Alert severity={getStatusMessageSeverity(message)}>
            {message}
        </Alert>
    );
}

function PluginHelpAlert({
    message,
    state
}: Readonly<{
    message: string;
    state: PluginConnectionState;
}>) {
    if (!message) return null;

    return (
        <Alert severity={getPluginHelpSeverity(state)}>
            {message}
        </Alert>
    );
}

function PluginInstallGuidance({
    onCopy,
    state
}: Readonly<{
    onCopy: () => void;
    state: PluginConnectionState;
}>) {
    if (state !== 'plugin-missing' && state !== 'endpoint-unreachable') return null;

    return (
        <Alert severity='info'>
            <Stack spacing={1}>
                <Typography>
                    Expected endpoint: /{PTV_PLUGIN_API.endpoints.status}
                </Typography>
                <Box component='pre' className='ptv-debug-report-preview'>
                    {PTV_PLUGIN_INSTALL_NOTE}
                </Box>
                <Button
                    type='button'
                    variant='outlined'
                    onClick={onCopy}
                >
                    Copy Install Note
                </Button>
            </Stack>
        </Alert>
    );
}

function CacheStateAlerts({
    cacheFreshness,
    cacheSource
}: Readonly<{
    cacheFreshness: string;
    cacheSource: string;
}>) {
    return (
        <>
            {cacheFreshness === 'missing' ? (
                <Alert severity='warning'>Featured cache is missing. The next home load may need to generate content.</Alert>
            ) : null}
            {cacheFreshness === 'stale' ? (
                <Alert severity='warning'>Cache is stale; stale content is currently being served.</Alert>
            ) : null}
            {cacheSource === 'memory' ? (
                <Alert severity='warning'>Using memory fallback. Cache will reset after reload.</Alert>
            ) : null}
        </>
    );
}

function WarningAlert({ message }: Readonly<{ message: string }>) {
    if (!message) return null;

    return <Alert severity='warning'>{message}</Alert>;
}

function DebugReportPreview({ text }: Readonly<{ text: string }>) {
    if (!text) return null;

    return (
        <Box component='pre' className='ptv-debug-report-preview'>
            {text}
        </Box>
    );
}

const PiggieTvDashboardPage = () => {
    const [pluginState, setPluginState] = useState<PluginState>(EMPTY_PLUGIN_STATE);
    const [cacheStatus, setCacheStatus] = useState(getFeaturedContentCacheStatus);
    const [debugEnabled, setDebugEnabledState] = useState(isPtvDebugEnabled);
    const [overlayEnabled, setOverlayEnabled] = useState(isPerformanceOverlayActive);
    const [featureSettings, setFeatureSettingsState] = useState(getPtvFeatureSettings);
    const [statusMessage, setStatusMessage] = useState('');
    const [debugReport, setDebugReport] = useState<unknown>(null);
    const [performanceReport, setPerformanceReport] = useState<unknown>(getPerformanceSnapshot);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isClearing, setIsClearing] = useState(false);

    const clientProfile = getPtvClientProfile();
    const performanceProfile = getPtvPerformanceProfile();

    const syncCacheStatus = useCallback(() => {
        setCacheStatus(getFeaturedContentCacheStatus());
    }, []);

    const syncPerformanceReport = useCallback(() => {
        setPerformanceReport(getPerformanceSnapshot());
    }, []);

    const refreshPluginStatus = useCallback(() => {
        const pluginApi = getCurrentPtvPluginApiClient();

        if (!pluginApi) {
            setPluginState({
                connected: false,
                connectionState: 'endpoint-unreachable',
                error: 'PTV plugin API client is unavailable.',
                loading: false,
                status: null
            });
            return;
        }

        setPluginState(previousState => ({
            ...previousState,
            loading: true
        }));

        withTimeout(pluginApi.getStatus<PtvPluginStatus>(), PLUGIN_STATUS_TIMEOUT_MS)
            .then(status => {
                setPluginState(createPluginStateFromStatus(status));
            })
            .catch((err: unknown) => {
                const connectionState = classifyPluginError(err);

                setPluginState({
                    connected: false,
                    connectionState,
                    error: getErrorMessage(err),
                    loading: false,
                    status: null
                });
            });
    }, []);

    const refreshCacheWithClientFallback = useCallback(() => forceRefreshFeaturedContentCache(fetchDashboardFeaturedContent)
        .then(() => {
            syncCacheStatus();
            syncPerformanceReport();
            refreshPluginStatus();
            setStatusMessage('Featured cache refresh finished.');
        }), [refreshPluginStatus, syncCacheStatus, syncPerformanceReport]);

    const refreshCache = useCallback(() => {
        const pluginApi = getCurrentPtvPluginApiClient();
        const canUseServerRefresh = Boolean(
            pluginApi?.refreshFeaturedContentCacheDocument
            && pluginState.connected
            && pluginState.status?.canWriteFeaturedContent !== false
            && pluginState.status?.features?.includes('featuredContentRefresh') !== false
        );

        setIsRefreshing(true);
        setStatusMessage(canUseServerRefresh ? 'Refreshing featured cache on server...' : 'Refreshing featured cache...');

        const refreshTask = canUseServerRefresh && pluginApi ?
            withTimeout(
                pluginApi.refreshFeaturedContentCacheDocument<PtvPluginStatus>(),
                PLUGIN_STATUS_TIMEOUT_MS
            )
                .then(status => {
                    setPluginState(createPluginStateFromStatus(status));
                    syncCacheStatus();
                    syncPerformanceReport();
                    setStatusMessage('Server featured cache refresh finished.');
                })
                .catch((err: unknown) => {
                    if (isPluginRefreshFallbackError(err)) {
                        return refreshCacheWithClientFallback();
                    }

                    throw err;
                }) :
            refreshCacheWithClientFallback();

        refreshTask
            .then(() => {
                syncCacheStatus();
                syncPerformanceReport();
                refreshPluginStatus();
            })
            .catch((err: unknown) => {
                setStatusMessage(`Featured cache refresh failed: ${getErrorMessage(err)}`);
            })
            .finally(() => {
                setIsRefreshing(false);
            });
    }, [
        pluginState.connected,
        pluginState.status?.canWriteFeaturedContent,
        pluginState.status?.features,
        refreshCacheWithClientFallback,
        refreshPluginStatus,
        syncCacheStatus,
        syncPerformanceReport
    ]);

    const clearCache = useCallback(() => {
        setIsClearing(true);
        setStatusMessage('Clearing featured cache...');
        clearFeaturedContentCache();

        window.setTimeout(() => {
            syncCacheStatus();
            syncPerformanceReport();
            refreshPluginStatus();
            setIsClearing(false);
            setStatusMessage('Featured cache clear requested.');
        }, 250);
    }, [refreshPluginStatus, syncCacheStatus, syncPerformanceReport]);

    const toggleDebug = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const enabled = event.target.checked;

        setPtvDebug(enabled);
        setDebugEnabledState(enabled);
    }, []);

    const togglePerformanceOverlay = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const enabled = event.target.checked;

        getPtvGlobal()?.performanceOverlay?.(enabled);
        setOverlayEnabled(isPerformanceOverlayActive());
    }, []);

    const toggleFeatureSetting = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const key = event.target.name;

        if (!isFeatureSettingKey(key)) return;

        const settings = setPtvFeatureSetting(key, event.target.checked);

        setFeatureSettingsState(settings);
    }, []);

    const runDebugReport = useCallback(() => {
        const report = getPtvGlobal()?.debug?.report?.() || getPtvDebugReport();

        setDebugReport(report);
        setPerformanceReport(getPerformanceSnapshot());

        if (isDebugLoggingEnabled()) {
            console.info('[PTV Debug Report]', report);
        }
    }, []);

    const buildDebugSnapshot = useCallback(() => JSON.stringify({
        cacheStatus: getFeaturedContentCacheStatus(),
        clientProfile,
        debugReport: debugReport || getPtvDebugReport(),
        featureSettings,
        performanceReport: getPerformanceSnapshot(),
        pluginState,
        timestamp: new Date().toISOString()
    }, null, 2), [clientProfile, debugReport, featureSettings, pluginState]);

    const copyDebugSnapshot = useCallback(() => {
        copyTextToClipboard(buildDebugSnapshot())
            .then(() => {
                setStatusMessage('Debug snapshot copied.');
            })
            .catch((err: unknown) => {
                setStatusMessage(`Debug snapshot copy failed: ${getErrorMessage(err)}`);
            });
    }, [buildDebugSnapshot]);

    const copyDebugReport = useCallback(() => {
        const report = debugReport || getPtvGlobal()?.debug?.report?.() || getPtvDebugReport();

        copyTextToClipboard(JSON.stringify(report, null, 2))
            .then(() => {
                setStatusMessage('Debug report copied.');
            })
            .catch((err: unknown) => {
                setStatusMessage(`Debug report copy failed: ${getErrorMessage(err)}`);
            });
    }, [debugReport]);

    const copyPluginInstallNote = useCallback(() => {
        copyTextToClipboard(PTV_PLUGIN_INSTALL_NOTE)
            .then(() => {
                setStatusMessage('Plugin install note copied.');
            })
            .catch((err: unknown) => {
                setStatusMessage(`Plugin install note copy failed: ${getErrorMessage(err)}`);
            });
    }, []);

    useEffect(() => {
        refreshPluginStatus();
        syncCacheStatus();
        syncPerformanceReport();

        const handleCacheUpdate = () => {
            syncCacheStatus();
            syncPerformanceReport();
            refreshPluginStatus();
        };

        const handleDebugChange = () => {
            setDebugEnabledState(isPtvDebugEnabled());
            setOverlayEnabled(isPerformanceOverlayActive());
            syncPerformanceReport();
        };

        const handleFeatureSettingsChange = (event: Event) => {
            const nextSettings = (event as CustomEvent<PtvFeatureSettings>).detail;

            setFeatureSettingsState(nextSettings || getPtvFeatureSettings());
        };
        const statusTimer = window.setInterval(() => {
            if (document.hidden) return;

            syncCacheStatus();
            syncPerformanceReport();
            refreshPluginStatus();
        }, 30000);
        const handleVisibilityChange = () => {
            if (document.hidden) return;

            syncCacheStatus();
            syncPerformanceReport();
            refreshPluginStatus();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener(FEATURED_CACHE_UPDATED_EVENT, handleCacheUpdate);
        window.addEventListener('ptv:debug:change', handleDebugChange);
        window.addEventListener(PTV_FEATURE_SETTINGS_CHANGE_EVENT, handleFeatureSettingsChange);

        return () => {
            window.clearInterval(statusTimer);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener(FEATURED_CACHE_UPDATED_EVENT, handleCacheUpdate);
            window.removeEventListener('ptv:debug:change', handleDebugChange);
            window.removeEventListener(PTV_FEATURE_SETTINGS_CHANGE_EVENT, handleFeatureSettingsChange);
        };
    }, [refreshPluginStatus, syncCacheStatus, syncPerformanceReport]);

    const pluginStatus = pluginState.status;
    const pluginFeaturedStatus = pluginStatus?.featuredContent;
    const cacheSource = getDashboardCacheSource(cacheStatus, pluginStatus);
    const cacheFreshness = getDashboardCacheFreshness(cacheStatus, pluginStatus);
    const isCacheRefreshing = isRefreshing || Boolean(pluginStatus?.refreshInProgress);
    const pluginConnectionState = getEffectivePluginConnectionState(
        pluginState.connected,
        cacheSource,
        pluginState.connectionState
    );
    const statusLabel = getPluginStateLabel(pluginConnectionState);
    const pluginHelpMessage = getPluginHelpMessage(pluginConnectionState, pluginStatus, cacheSource);
    const statusError = pluginStatus?.lastRefreshError || cacheStatus.lastRefreshError || cacheStatus.writeError || pluginState.error;
    const pluginVersion = pluginStatus?.pluginVersion || pluginStatus?.version || 'n/a';
    const pluginName = pluginStatus?.pluginName || pluginStatus?.name || 'PiggieTV';
    const createdAt = cacheStatus.createdAt || pluginFeaturedStatus?.createdAt || pluginStatus?.featuredCacheCreatedAt;
    const expiresAt = cacheStatus.expiresAt || pluginFeaturedStatus?.expiresAt || pluginStatus?.featuredCacheExpiresAt;
    const nextRefreshAt = pluginStatus?.nextRefreshAt || expiresAt;
    const heroCount = cacheStatus.heroCount || pluginFeaturedStatus?.heroCount || 0;
    const itemCount = cacheStatus.itemCount || pluginFeaturedStatus?.itemCount || 0;
    const sectionCount = cacheStatus.sectionCount || pluginFeaturedStatus?.sectionCount || 0;
    const lastRefreshDurationMs = pluginStatus?.lastRefreshDurationMs || cacheStatus.lastRefreshDurationMs;
    const performanceDebug = getNestedRecord(performanceReport, 'debug') || getPtvDebugReport();
    const imageManagerMetrics = getNestedRecord(performanceReport, 'imageManager');
    const currentFps = getNumberValue(performanceReport, 'currentFps');
    const averageFps = getNumberValue(performanceReport, 'averageFps');
    const droppedFrames = getNumberValue(performanceReport, 'droppedFrameCount');
    const activeImageRequests = getNumberValue(imageManagerMetrics, 'activeRequests');
    const queuedImageRequests = getNumberValue(imageManagerMetrics, 'queuedRequests');
    const imageCacheHits = getNumberValue(imageManagerMetrics, 'cacheHits');
    const imageCacheMisses = getNumberValue(imageManagerMetrics, 'cacheMisses');
    const imageDedupeHits = getNumberValue(imageManagerMetrics, 'dedupeHits');
    const imageFailedSuppressions = getNumberValue(imageManagerMetrics, 'failedImageSuppressions');
    const debugReportText = debugReport ? JSON.stringify(debugReport, null, 2) : '';

    return (
        <Page
            id='ptvDashboardPage'
            title='PiggieTV'
            className='mainAnimatedPage type-interior ptv-dashboard-control-page'
        >
            <Box className='content-primary ptv-dashboard-control-content'>
                <Stack spacing={2}>
                    <Box>
                        <Typography variant='h1'>PiggieTV</Typography>
                        <Typography variant='body1' color='text.secondary'>
                            Plugin, cache, status, and performance controls.
                        </Typography>
                    </Box>

                    <StatusMessageAlert message={statusMessage} />

                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12, lg: 6 }}>
                            <Card
                                className='ptv-dashboard-card ptv-control-card ptv-control-card-compact ptv-control-card-status'
                                data-ptv-plugin-state={pluginConnectionState}
                            >
                                <CardContent>
                                    <Stack className='ptv-control-stack ptv-control-stack-compact' spacing={1.25}>
                                        <Stack direction='row' justifyContent='space-between' alignItems='center'>
                                            <Typography variant='h2'>Plugin Status</Typography>
                                            <Chip
                                                className='ptv-live-status-chip'
                                                color={pluginState.connected ? 'success' : 'error'}
                                                icon={<Box component='span' className='ptv-live-status-dot' />}
                                                label={statusLabel}
                                                size='small'
                                            />
                                        </Stack>
                                        <Box className='ptv-badge-row'>
                                            <Chip className='ptv-status-badge ptv-status-badge-info' label={`API v${pluginStatus?.apiVersion ?? PTV_PLUGIN_API.version}`} size='small' />
                                            <Chip className='ptv-status-badge ptv-status-badge-path' label={pluginStatus?.apiPath || `/${PTV_PLUGIN_API.endpoints.status}`} size='small' />
                                            <Chip className='ptv-status-badge ptv-status-badge-backend' label={pluginStatus?.cacheBackend || cacheSource} size='small' />
                                        </Box>
                                        <WarningAlert message={pluginState.error} />
                                        <PluginHelpAlert message={pluginHelpMessage} state={pluginConnectionState} />
                                        <PluginInstallGuidance
                                            onCopy={copyPluginInstallNote}
                                            state={pluginConnectionState}
                                        />
                                        <Divider />
                                        <Stack className='ptv-dashboard-status-list' spacing={0.5}>
                                            <Typography>Plugin: {pluginName}</Typography>
                                            <Typography>Plugin version: {pluginVersion}</Typography>
                                            <Typography>Server UTC: {pluginStatus?.serverTimeUtc || 'n/a'}</Typography>
                                            <Typography>Cache path exists: {String(pluginStatus?.cachePathExists ?? false)}</Typography>
                                            <Typography>Max payload: {formatBytes(pluginStatus?.maxCachePayloadBytes)}</Typography>
                                            <Typography>canReadFeaturedContent: {String(pluginStatus?.canReadFeaturedContent ?? false)}</Typography>
                                            <Typography>canWriteFeaturedContent: {String(pluginStatus?.canWriteFeaturedContent ?? false)}</Typography>
                                        </Stack>
                                        <Button
                                            type='button'
                                            variant='outlined'
                                            onClick={refreshPluginStatus}
                                            disabled={pluginState.loading}
                                        >
                                            {getRefreshStatusButtonLabel(pluginState.loading)}
                                        </Button>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 6 }}>
                            <Card
                                className='ptv-dashboard-card ptv-control-card ptv-control-card-cache'
                                data-ptv-cache-state={cacheFreshness}
                            >
                                <CardContent>
                                    <Stack spacing={2}>
                                        <Stack direction='row' justifyContent='space-between' alignItems='center'>
                                            <Typography variant='h2'>Featured Cache</Typography>
                                            <Chip
                                                className='ptv-cache-state-chip'
                                                icon={getCacheChipIcon(isCacheRefreshing)}
                                                label={getCacheChipLabel(isCacheRefreshing, cacheFreshness)}
                                                size='small'
                                            />
                                        </Stack>
                                        <Divider />
                                        <CacheStateAlerts cacheFreshness={cacheFreshness} cacheSource={cacheSource} />
                                        <Grid container spacing={1.5}>
                                            <Grid size={{ xs: 12, sm: 6 }}>
                                                <Typography>Source: {cacheSource}</Typography>
                                                <Typography>Created: {formatDate(createdAt)}</Typography>
                                                <Typography>Expires: {formatDate(expiresAt)}</Typography>
                                                <Typography>Next refresh: {formatCountdown(nextRefreshAt)}</Typography>
                                            </Grid>
                                            <Grid size={{ xs: 12, sm: 6 }}>
                                                <Typography>Hero items: {heroCount}</Typography>
                                                <Typography>Row items: {itemCount}</Typography>
                                                <Typography>Sections: {sectionCount}</Typography>
                                                <Typography>Last refresh: {formatDuration(lastRefreshDurationMs)}</Typography>
                                                <Typography>Completed: {formatDate(pluginStatus?.lastRefreshCompletedAt)}</Typography>
                                            </Grid>
                                        </Grid>
                                        <WarningAlert message={statusError ? `Last error: ${statusError}` : ''} />
                                        <Stack direction='row' spacing={2} flexWrap='wrap' useFlexGap>
                                            <Button
                                                type='button'
                                                variant='contained'
                                                onClick={refreshCache}
                                                disabled={isCacheRefreshing}
                                            >
                                                {getRefreshCacheButtonLabel(isCacheRefreshing)}
                                            </Button>
                                            <Button
                                                type='button'
                                                variant='outlined'
                                                color='warning'
                                                onClick={clearCache}
                                                disabled={isClearing || (pluginState.connected && pluginStatus?.canWriteFeaturedContent === false)}
                                            >
                                                {getClearCacheButtonLabel(isClearing)}
                                            </Button>
                                            <Button
                                                type='button'
                                                variant='outlined'
                                                onClick={copyDebugSnapshot}
                                            >
                                                Copy Debug Snapshot
                                            </Button>
                                        </Stack>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 6 }}>
                            <Card className='ptv-dashboard-card ptv-control-card ptv-control-card-compact ptv-control-card-debug'>
                                <CardContent>
                                    <Stack className='ptv-control-stack ptv-control-stack-compact' spacing={1.25}>
                                        <Stack direction='row' justifyContent='space-between' alignItems='center'>
                                            <Typography variant='h2'>Performance / Debug</Typography>
                                            <Chip
                                                className='ptv-render-profile-badge'
                                                data-ptv-render-profile={performanceProfile.renderProfile.id}
                                                label={performanceProfile.renderProfile.id}
                                                size='small'
                                            />
                                        </Stack>
                                        <Divider />
                                        <Box className='ptv-badge-row'>
                                            <Chip className='ptv-status-badge ptv-status-badge-info' label={`client: ${clientProfile.kind}`} size='small' />
                                            <Chip className='ptv-status-badge ptv-status-badge-backend' label={`cache: ${getCacheTimingLabel(performanceDebug)}`} size='small' />
                                        </Box>
                                        <Typography>Render profile: {performanceProfile.renderProfile.id}</Typography>
                                        <Typography>Client profile: {clientProfile.kind}</Typography>
                                        <Typography>
                                            Flags: fireTv={String(clientProfile.isFireTv)}, webOs={String(clientProfile.isWebOs)}, tv={String(clientProfile.isTv)}, mobile={String(clientProfile.isMobile)}, lowPower={String(performanceProfile.isLowPower)}
                                        </Typography>
                                        <Typography>FPS: {getFpsLabel(currentFps, averageFps)}</Typography>
                                        <Typography>Dropped frames: {droppedFrames ?? 'n/a'}</Typography>
                                        <Typography>Memory: {getMemoryLabel(performanceReport)}</Typography>
                                        <Typography>
                                            Image requests: {activeImageRequests ?? 0} active / {queuedImageRequests ?? 0} queued
                                        </Typography>
                                        <Typography>
                                            Image cache: {imageCacheHits ?? 0} hits / {imageCacheMisses ?? 0} misses / {imageDedupeHits ?? 0} deduped
                                        </Typography>
                                        <Typography>
                                            Failed image suppressions: {imageFailedSuppressions ?? 0}
                                        </Typography>
                                        <FormControlLabel
                                            control={<Switch checked={debugEnabled} onChange={toggleDebug} />}
                                            label='Enable PTV_DEBUG'
                                        />
                                        <FormControlLabel
                                            control={<Switch checked={overlayEnabled} onChange={togglePerformanceOverlay} />}
                                            label='Enable performance overlay'
                                        />
                                        <Button
                                            type='button'
                                            variant='outlined'
                                            onClick={runDebugReport}
                                        >
                                            Run Debug Report
                                        </Button>
                                        <Button
                                            type='button'
                                            variant='outlined'
                                            onClick={copyDebugReport}
                                        >
                                            Copy Debug Report
                                        </Button>
                                        <DebugReportPreview text={debugReportText} />
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 6 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={2}>
                                        <Typography variant='h2'>Feature Toggles</Typography>
                                        <Divider />
                                        <FormControlLabel
                                            control={<Switch name='heroEnabled' checked={featureSettings.heroEnabled} onChange={toggleFeatureSetting} />}
                                            label='Hero enabled'
                                        />
                                        <FormControlLabel
                                            control={<Switch name='homeRowsEnabled' checked={featureSettings.homeRowsEnabled} onChange={toggleFeatureSetting} />}
                                            label='PTV home rows enabled'
                                        />
                                        <FormControlLabel
                                            control={<Switch name='dynamicBackdropsEnabled' checked={featureSettings.dynamicBackdropsEnabled} onChange={toggleFeatureSetting} />}
                                            label='Dynamic backdrops enabled'
                                        />
                                        <FormControlLabel
                                            control={<Switch name='tvLowPowerModeEnabled' checked={featureSettings.tvLowPowerModeEnabled} onChange={toggleFeatureSetting} />}
                                            label='TV low-power mode enabled'
                                        />
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>
                    </Grid>
                </Stack>
            </Box>
        </Page>
    );
};

PiggieTvDashboardPage.displayName = 'PiggieTvDashboardPage';

export default PiggieTvDashboardPage;
