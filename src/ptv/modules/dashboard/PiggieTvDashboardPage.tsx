/* eslint-disable react/jsx-no-bind */
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid2';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Page from 'components/Page';
import { getUserViewsQuery } from 'hooks/useUserViews';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { toApi } from 'utils/jellyfin-apiclient/compat';
import { queryClient } from 'utils/query/queryClient';

import { getPtvClientProfile, getPtvPerformanceProfile } from '../../core/clientProfile';
import { PTV_CACHE, PTV_PLUGIN_API } from '../../core/config';
import {
    getPtvFeatureSettings,
    isPtvPlaybackMode,
    PTV_FEATURE_SETTINGS_CHANGE_EVENT,
    setPtvFeatureSetting,
    type PtvFeatureSettings,
    type PtvPlaybackMode
} from '../../core/featureSettings';
import { getPtvDebugReport, isPtvDebugEnabled, setPtvDebug } from '../../core/observability';
import { getPtvPerformanceReport } from '../../services/performanceMonitor';
import {
    getCurrentPtvPluginApiClient,
    getPtvPluginApiDiagnostics,
    getPtvPluginApiResolvedUrl,
    isPtvPluginApiCoolingDown,
    normalizePtvApiError,
    resetPtvPluginApiAvailability
} from '../../core/pluginApi';
import {
    clearFeaturedContentCache,
    FEATURED_CACHE_UPDATED_EVENT,
    forceRefreshFeaturedContentCache,
    getFeaturedContentCacheStatus,
    setFeaturedContentCacheTtlMs,
    type FeaturedPayload
} from '../cache/featuredContentCache';
import {
    createFeaturedContentFetcher,
    loadGenreMap,
    loadStudioMap,
    PTV_HOME_ROWS
} from '../../pages/home/ptvRows';
import { clearPtvIntegrationSettingsCache } from '../integrations/integrationsConfig';
import { normalizePtvRecommendationRowSettings } from '../recommendations/recommendationSettings';

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

type PtvTmdbMetadataStatus = {
    cacheHits?: number;
    cacheMisses?: number;
    cacheSize?: number;
    configured?: boolean;
    credentialLength?: number;
    credentialStatus?: string | null;
    credentialType?: string | null;
    enabled?: boolean;
    lastDurationMs?: number | null;
    lastError?: string | null;
    lastErrorBody?: string | null;
    lastErrorCode?: string | null;
    lastStatusCode?: number | null;
    lastValidatedAt?: string | null;
    negativeCacheHits?: number;
    negativeCacheSize?: number;
    negativeCacheWrites?: number;
};

type PtvPluginStatus = {
    apiPath?: string;
    apiVersion?: number;
    cacheBackend?: string;
    cacheFilePath?: string | null;
    cachePath?: string | null;
    cachePathExists?: boolean;
    cachePathWritable?: boolean;
    cachePayloadBytes?: number;
    cacheWriteError?: string | null;
    canReadFeaturedContent?: boolean;
    canWriteFeaturedContent?: boolean;
    degraded?: boolean;
    error?: string | null;
    featuredContent?: PtvPluginFeaturedStatus;
    featuredCacheCreatedAt?: number | null;
    featuredCacheExists?: boolean;
    featuredCacheExpiresAt?: number | null;
    featuredCacheFresh?: boolean;
    featureFlags?: Record<string, boolean>;
    features?: Record<string, boolean> | string[];
    lastRefreshCompletedAt?: number | null;
    lastRefreshDurationMs?: number | null;
    lastRefreshError?: string | null;
    lastRefreshWarning?: string | null;
    lastRefreshStartedAt?: number | null;
    integrations?: Record<string, unknown>;
    maxCachePayloadBytes?: number;
    name?: string;
    nextRefreshAt?: number | null;
    ok?: boolean;
    pluginName?: string;
    pluginVersion?: string;
    refreshInProgress?: boolean;
    serverTimeUtc?: string;
    settingsAvailable?: boolean;
    signup?: {
        emailConfigured?: boolean;
        emailEnabled?: boolean;
        enabled?: boolean;
        fromDomain?: string | null;
        nativeUserCount?: number;
        pendingResetCount?: number;
        pendingVerificationCount?: number;
        smtpPasswordConfigured?: boolean;
    };
    tmdbMetadata?: PtvTmdbMetadataStatus;
    tmdbMetadataStatus?: PtvTmdbMetadataStatus;
    version?: string;
};

type PtvFeatureSettingsDto = {
    debugModeEnabled: boolean;
    dynamicBackdropsEnabled: boolean;
    heroEnabled: boolean;
    homeRowsEnabled: boolean;
    playbackMode: PtvPlaybackMode;
    tvLowPowerModeEnabled: boolean;
};

type PtvHeroSettingsDto = {
    heroAutoRotateEnabled: boolean;
    heroBackdropMaxWidth: number;
    heroLogoMaxWidth: number;
    heroMaxItems: number;
    heroRotationSeconds: number;
};

type PtvRowSettingsDto = {
    enableCollectionRows: boolean;
    enableRecentlyAddedRows: boolean;
    enableRecommendedRows: boolean;
    enableSeasonalRows: boolean;
    rowMaxItems: number;
    rowRefreshHours: number;
};

type PtvCacheSettingsDto = {
    refreshIntervalHours: number;
};

type PtvPerformanceSettingsDto = {
    enableAnimatedRows: boolean;
    enableBackdropBlur: boolean;
    imagePreloadLimit: number;
    lowPowerDisableAnimations: boolean;
    lowPowerDisableBlur: boolean;
    maxCachePayloadBytes: number;
};

type PtvTmdbSettingsDto = {
    tmdbApiToken?: string | null;
    tmdbApiTokenConfigured: boolean;
    tmdbEnabled: boolean;
    tmdbLanguage: string;
    tmdbRegion: string;
    useTmdbForRowAccuracy: boolean;
};

type PtvMusicMetadataSettingsDto = {
    discogsEnabled: boolean;
    discogsToken?: string | null;
    discogsTokenConfigured: boolean;
    maxResults: number;
    musicBrainzEnabled: boolean;
};

type PtvGoogleBooksSettingsDto = {
    clearGoogleBooksApiKey?: boolean;
    googleBooksApiKey?: string | null;
    googleBooksApiKeyConfigured: boolean;
    googleBooksEnabled: boolean;
    maxResults: number;
};

type PtvSeerrSettingsDto = {
    apiKey?: string | null;
    apiKeyConfigured: boolean;
    displayName: string;
    enabled: boolean;
    enableAutoRequest: boolean;
    enableRequestsPage: boolean;
    enableSearchIntegration: boolean;
    externalUrl: string;
    internalUrl: string;
    openExternalFallback: boolean;
    openRequestsInPtv: boolean;
};

type PtvArrServiceSettingsDto = {
    apiKey?: string | null;
    apiKeyConfigured: boolean;
    enabled: boolean;
    externalUrl: string;
    internalUrl: string;
};

type PtvArrSettingsDto = {
    lidarr: PtvArrServiceSettingsDto;
    prowlarr: PtvArrServiceSettingsDto;
    radarr: PtvArrServiceSettingsDto;
    sonarr: PtvArrServiceSettingsDto;
};

type PtvDownloadSettingsDto = {
    enabled: boolean;
    externalUrl: string;
    internalUrl: string;
    password?: string | null;
    passwordConfigured: boolean;
    provider: string;
    username?: string | null;
    usernameConfigured: boolean;
};

type PtvTagRowDefinitionDto = {
    enabled: boolean;
    id: string;
    includeItemTypes: string[];
    limit: number;
    name: string;
    sortBy: string;
    tags: string[];
};

type PtvTagSettingsDto = {
    enabled: boolean;
    enableTagFilters: boolean;
    enableTagRows: boolean;
    excludeTags: string[];
    includeTags: string[];
    rowDefinitions: PtvTagRowDefinitionDto[];
};

type PtvRandomSettingsDto = {
    behavior: string;
    enabled: boolean;
    enableRandomAnime: boolean;
    enableRandomEpisode: boolean;
    enableRandomFromCurrentLibrary: boolean;
    enableRandomMovie: boolean;
    respectHiddenContent: boolean;
    respectParentalRating: boolean;
    useUnwatchedOnlyOption: boolean;
};

type PtvPluginSettings = {
    arrSettings: PtvArrSettingsDto;
    cache?: PtvCacheSettingsDto;
    cacheSettings: PtvCacheSettingsDto;
    downloadSettings: PtvDownloadSettingsDto;
    featureSettings: PtvFeatureSettingsDto;
    googleBooksSettings: PtvGoogleBooksSettingsDto;
    heroSettings: PtvHeroSettingsDto;
    musicMetadataSettings: PtvMusicMetadataSettingsDto;
    performanceSettings: PtvPerformanceSettingsDto;
    randomSettings: PtvRandomSettingsDto;
    rowSettings: PtvRowSettingsDto;
    seerrSettings: PtvSeerrSettingsDto;
    tagSettings: PtvTagSettingsDto;
    tmdbSettings: PtvTmdbSettingsDto;
};

type PtvPluginSettingsPatch = {
    arrSettings?: Partial<PtvArrSettingsDto>;
    cache?: Partial<PtvCacheSettingsDto>;
    cacheSettings?: Partial<PtvCacheSettingsDto>;
    downloadSettings?: Partial<PtvDownloadSettingsDto>;
    featureSettings?: Partial<PtvFeatureSettingsDto>;
    googleBooksSettings?: Partial<PtvGoogleBooksSettingsDto>;
    heroSettings?: Partial<PtvHeroSettingsDto>;
    musicMetadataSettings?: Partial<PtvMusicMetadataSettingsDto>;
    performanceSettings?: Partial<PtvPerformanceSettingsDto>;
    randomSettings?: Partial<PtvRandomSettingsDto>;
    rowSettings?: Partial<PtvRowSettingsDto>;
    seerrSettings?: Partial<PtvSeerrSettingsDto>;
    tagSettings?: Partial<PtvTagSettingsDto>;
    tmdbSettings?: Partial<PtvTmdbSettingsDto>;
};

type PtvSettingsSection =
    | 'arrSettings'
    | 'cacheSettings'
    | 'downloadSettings'
    | 'featureSettings'
    | 'googleBooksSettings'
    | 'heroSettings'
    | 'musicMetadataSettings'
    | 'performanceSettings'
    | 'randomSettings'
    | 'refreshInterval'
    | 'rowSettings'
    | 'seerrSettings'
    | 'tagSettings'
    | 'tmdbSettings';

const PTV_ROW_BUILDER_HASH = '#/dashboard/piggietv/rows';
const PTV_RECOMMENDATIONS_HASH = '#/dashboard/piggietv/recommendations';
const PTV_ROW_BUILDER_PATH = '/dashboard/piggietv/rows';
const PTV_RECOMMENDATIONS_PATH = '/dashboard/piggietv/recommendations';

type ApplyPluginSettingsStateOptions = {
    forceDraftHydration?: boolean;
    hydrateDrafts?: boolean;
};

type LoadPluginSettingsOptions = {
    force?: boolean;
    hydrateDrafts?: boolean;
    origin?: string;
};

type FeaturedRefreshState = 'idle' | 'refreshing' | 'success' | 'error';

type PluginConnectionState =
    | 'connected'
    | 'degraded'
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

type DashboardDebugState = 'active' | 'degraded' | 'disabled' | 'disconnected' | 'initializing';

type DashboardDebugSourceDetail = {
    note?: string;
    source: string;
    timestamp: string;
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

const PLUGIN_STATUS_TIMEOUT_MS = 30000;
const FEATURED_REFRESH_TRIGGER_TIMEOUT_MS = 30000;
const FEATURED_REFRESH_POLL_INTERVAL_MS = 1500;
const FEATURED_REFRESH_MAX_WAIT_MS = 30000;
const PTV_PLUGIN_INSTALL_NOTE = [
    'Build plugin Release',
    'Copy Jellyfin.Plugin.PiggieTV.dll to Jellyfin plugin folder',
    'Restart Jellyfin',
    'Refresh this page'
].join('\n');
const PTV_SETTINGS_LIMITS = {
    cacheRefreshHours: [1, 168],
    googleBooksMetadataResults: [1, 20],
    heroBackdropMaxWidth: [640, 3840],
    heroLogoMaxWidth: [160, 1600],
    heroMaxItems: [1, 50],
    heroRotationSeconds: [5, 120],
    imagePreloadLimit: [1, 10],
    maxCachePayloadBytes: [1048576, 52428800],
    musicMetadataResults: [1, 12],
    rowMaxItems: [5, 100],
    rowRefreshHours: [1, 168]
} as const;
const ARR_SERVICE_NAMES = ['sonarr', 'radarr', 'lidarr', 'prowlarr'] as const;
const ARR_CALENDAR_SERVICE_NAMES = ['sonarr', 'radarr', 'lidarr'] as const;
type PtvIntegrationTestKey = 'discogs' | 'googleBooks' | 'seerr' | 'tmdb' | typeof ARR_SERVICE_NAMES[number];
const DEFAULT_PLUGIN_SETTINGS: PtvPluginSettings = {
    arrSettings: {
        lidarr: {
            apiKey: null,
            apiKeyConfigured: false,
            enabled: false,
            externalUrl: '',
            internalUrl: ''
        },
        prowlarr: {
            apiKey: null,
            apiKeyConfigured: false,
            enabled: false,
            externalUrl: '',
            internalUrl: ''
        },
        radarr: {
            apiKey: null,
            apiKeyConfigured: false,
            enabled: false,
            externalUrl: '',
            internalUrl: ''
        },
        sonarr: {
            apiKey: null,
            apiKeyConfigured: false,
            enabled: false,
            externalUrl: '',
            internalUrl: ''
        }
    },
    cacheSettings: {
        refreshIntervalHours: 12
    },
    downloadSettings: {
        enabled: false,
        externalUrl: '',
        internalUrl: '',
        password: null,
        passwordConfigured: false,
        provider: 'qbittorrent',
        username: null,
        usernameConfigured: false
    },
    featureSettings: {
        debugModeEnabled: false,
        dynamicBackdropsEnabled: true,
        heroEnabled: true,
        homeRowsEnabled: true,
        playbackMode: 'auto',
        tvLowPowerModeEnabled: true
    },
    googleBooksSettings: {
        googleBooksApiKey: null,
        googleBooksApiKeyConfigured: false,
        googleBooksEnabled: true,
        maxResults: 10
    },
    heroSettings: {
        heroAutoRotateEnabled: true,
        heroBackdropMaxWidth: 1920,
        heroLogoMaxWidth: 800,
        heroMaxItems: 15,
        heroRotationSeconds: 12
    },
    musicMetadataSettings: {
        discogsEnabled: false,
        discogsToken: null,
        discogsTokenConfigured: false,
        maxResults: 6,
        musicBrainzEnabled: true
    },
    performanceSettings: {
        enableAnimatedRows: true,
        enableBackdropBlur: true,
        imagePreloadLimit: 4,
        lowPowerDisableAnimations: true,
        lowPowerDisableBlur: true,
        maxCachePayloadBytes: 4194304
    },
    randomSettings: {
        behavior: 'details',
        enabled: true,
        enableRandomAnime: true,
        enableRandomEpisode: true,
        enableRandomFromCurrentLibrary: true,
        enableRandomMovie: true,
        respectHiddenContent: true,
        respectParentalRating: true,
        useUnwatchedOnlyOption: true
    },
    rowSettings: {
        enableCollectionRows: true,
        enableRecentlyAddedRows: true,
        enableRecommendedRows: true,
        enableSeasonalRows: true,
        rowMaxItems: 16,
        rowRefreshHours: 12
    },
    seerrSettings: {
        apiKey: null,
        apiKeyConfigured: false,
        displayName: 'Jellyseerr',
        enabled: false,
        enableAutoRequest: false,
        enableRequestsPage: true,
        enableSearchIntegration: true,
        externalUrl: 'https://request.piggietv.com',
        // eslint-disable-next-line sonarjs/no-clear-text-protocols
        internalUrl: 'http://10.16.0.226:5055',
        openExternalFallback: true,
        openRequestsInPtv: true
    },
    tagSettings: {
        enabled: true,
        enableTagFilters: true,
        enableTagRows: true,
        excludeTags: [],
        includeTags: [],
        rowDefinitions: [
            {
                enabled: true,
                id: 'disney-animation',
                includeItemTypes: ['Movie', 'Series'],
                limit: 16,
                name: 'Disney Animation',
                sortBy: 'Random',
                tags: ['disney', 'animation']
            }
        ]
    },
    tmdbSettings: {
        tmdbApiToken: null,
        tmdbApiTokenConfigured: false,
        tmdbEnabled: true,
        tmdbLanguage: 'en-US',
        tmdbRegion: 'US',
        useTmdbForRowAccuracy: true
    }
};

function getErrorMessage(err: unknown) {
    return normalizePtvApiError(err).message;
}

function delay(ms: number) {
    return new Promise(resolve => {
        window.setTimeout(resolve, ms);
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clonePluginSettings(settings: PtvPluginSettings): PtvPluginSettings {
    return JSON.parse(JSON.stringify(settings)) as PtvPluginSettings;
}

function clampNumber(value: number, min: number, max: number) {
    if (!Number.isFinite(value)) return min;

    return Math.min(max, Math.max(min, Math.round(value)));
}

function clampNumberWithFallback(value: number, fallback: number, min: number, max: number) {
    if (!Number.isFinite(value) || value <= 0) {
        return clampNumber(fallback, min, max);
    }

    return clampNumber(value, min, max);
}

function normalizePtvPlaybackMode(value: unknown): PtvPlaybackMode {
    return isPtvPlaybackMode(value) ? value : 'auto';
}

function normalizePluginSettings(settings: Partial<PtvPluginSettings>): PtvPluginSettings {
    const incomingCacheSettings = settings.cacheSettings || settings.cache || {};
    const nextSettings = clonePluginSettings({
        arrSettings: {
            lidarr: {
                ...DEFAULT_PLUGIN_SETTINGS.arrSettings.lidarr,
                ...(settings.arrSettings?.lidarr || {})
            },
            prowlarr: {
                ...DEFAULT_PLUGIN_SETTINGS.arrSettings.prowlarr,
                ...(settings.arrSettings?.prowlarr || {})
            },
            radarr: {
                ...DEFAULT_PLUGIN_SETTINGS.arrSettings.radarr,
                ...(settings.arrSettings?.radarr || {})
            },
            sonarr: {
                ...DEFAULT_PLUGIN_SETTINGS.arrSettings.sonarr,
                ...(settings.arrSettings?.sonarr || {})
            }
        },
        cacheSettings: {
            ...DEFAULT_PLUGIN_SETTINGS.cacheSettings,
            ...incomingCacheSettings
        },
        downloadSettings: {
            ...DEFAULT_PLUGIN_SETTINGS.downloadSettings,
            ...(settings.downloadSettings || {})
        },
        featureSettings: {
            ...DEFAULT_PLUGIN_SETTINGS.featureSettings,
            ...(settings.featureSettings || {})
        },
        googleBooksSettings: {
            ...DEFAULT_PLUGIN_SETTINGS.googleBooksSettings,
            ...(settings.googleBooksSettings || {})
        },
        heroSettings: {
            ...DEFAULT_PLUGIN_SETTINGS.heroSettings,
            ...(settings.heroSettings || {})
        },
        musicMetadataSettings: {
            ...DEFAULT_PLUGIN_SETTINGS.musicMetadataSettings,
            ...(settings.musicMetadataSettings || {})
        },
        performanceSettings: {
            ...DEFAULT_PLUGIN_SETTINGS.performanceSettings,
            ...(settings.performanceSettings || {})
        },
        randomSettings: {
            ...DEFAULT_PLUGIN_SETTINGS.randomSettings,
            ...(settings.randomSettings || {})
        },
        rowSettings: {
            ...DEFAULT_PLUGIN_SETTINGS.rowSettings,
            ...(settings.rowSettings || {})
        },
        seerrSettings: {
            ...DEFAULT_PLUGIN_SETTINGS.seerrSettings,
            ...(settings.seerrSettings || {})
        },
        tagSettings: {
            ...DEFAULT_PLUGIN_SETTINGS.tagSettings,
            ...(settings.tagSettings || {})
        },
        tmdbSettings: {
            ...DEFAULT_PLUGIN_SETTINGS.tmdbSettings,
            ...(settings.tmdbSettings || {})
        }
    });

    if (!settings.cacheSettings?.refreshIntervalHours && !settings.cache?.refreshIntervalHours && settings.rowSettings?.rowRefreshHours) {
        nextSettings.cacheSettings.refreshIntervalHours = settings.rowSettings.rowRefreshHours;
    }

    nextSettings.featureSettings.playbackMode = normalizePtvPlaybackMode(nextSettings.featureSettings.playbackMode);
    nextSettings.heroSettings.heroRotationSeconds = clampNumber(
        nextSettings.heroSettings.heroRotationSeconds,
        ...PTV_SETTINGS_LIMITS.heroRotationSeconds
    );
    nextSettings.heroSettings.heroMaxItems = clampNumber(
        nextSettings.heroSettings.heroMaxItems,
        ...PTV_SETTINGS_LIMITS.heroMaxItems
    );
    nextSettings.rowSettings.rowMaxItems = clampNumber(
        nextSettings.rowSettings.rowMaxItems,
        ...PTV_SETTINGS_LIMITS.rowMaxItems
    );
    nextSettings.cacheSettings.refreshIntervalHours = clampNumber(
        nextSettings.cacheSettings.refreshIntervalHours,
        ...PTV_SETTINGS_LIMITS.cacheRefreshHours
    );
    nextSettings.rowSettings.rowRefreshHours = clampNumber(
        nextSettings.rowSettings.rowRefreshHours,
        ...PTV_SETTINGS_LIMITS.rowRefreshHours
    );
    nextSettings.performanceSettings.imagePreloadLimit = clampNumber(
        nextSettings.performanceSettings.imagePreloadLimit,
        ...PTV_SETTINGS_LIMITS.imagePreloadLimit
    );
    nextSettings.performanceSettings.maxCachePayloadBytes = clampNumber(
        nextSettings.performanceSettings.maxCachePayloadBytes,
        ...PTV_SETTINGS_LIMITS.maxCachePayloadBytes
    );
    nextSettings.musicMetadataSettings.maxResults = clampNumber(
        nextSettings.musicMetadataSettings.maxResults,
        ...PTV_SETTINGS_LIMITS.musicMetadataResults
    );
    nextSettings.musicMetadataSettings.discogsToken = null;
    nextSettings.googleBooksSettings.maxResults = clampNumber(
        nextSettings.googleBooksSettings.maxResults,
        ...PTV_SETTINGS_LIMITS.googleBooksMetadataResults
    );
    nextSettings.googleBooksSettings.googleBooksApiKey = nextSettings.googleBooksSettings.googleBooksApiKey?.trim() || null;
    nextSettings.tmdbSettings.tmdbLanguage = nextSettings.tmdbSettings.tmdbLanguage.trim() || 'en-US';
    nextSettings.tmdbSettings.tmdbRegion = nextSettings.tmdbSettings.tmdbRegion.trim() || 'US';
    nextSettings.tmdbSettings.tmdbApiToken = nextSettings.tmdbSettings.tmdbApiToken?.trim() || null;
    nextSettings.seerrSettings.apiKey = null;
    nextSettings.arrSettings.sonarr.apiKey = null;
    nextSettings.arrSettings.radarr.apiKey = null;
    nextSettings.arrSettings.lidarr.apiKey = null;
    nextSettings.arrSettings.prowlarr.apiKey = null;
    ARR_SERVICE_NAMES.forEach(serviceName => {
        if (nextSettings.arrSettings[serviceName].apiKeyConfigured) {
            nextSettings.arrSettings[serviceName].enabled = true;
        }
    });
    nextSettings.downloadSettings.username = null;
    nextSettings.downloadSettings.password = null;

    return nextSettings;
}

function applyPluginFeatureSettings(settings: PtvFeatureSettingsDto) {
    setPtvFeatureSetting('heroEnabled', settings.heroEnabled);
    setPtvFeatureSetting('homeRowsEnabled', settings.homeRowsEnabled);
    setPtvFeatureSetting('dynamicBackdropsEnabled', settings.dynamicBackdropsEnabled);
    setPtvFeatureSetting('tvLowPowerModeEnabled', settings.tvLowPowerModeEnabled);
    setPtvFeatureSetting('playbackMode', settings.playbackMode);
}

function getIntegrationTestResultMessage(serviceName: string, result: Record<string, unknown>) {
    const nestedResult = isRecord(result.result) ? result.result : null;
    const ok = result.ok === true && (!nestedResult || nestedResult.ok !== false);
    const error = String(
        result.message
        || result.error
        || nestedResult?.error
        || nestedResult?.message
        || (nestedResult?.statusCode ? `${serviceName} returned HTTP ${nestedResult.statusCode}.` : '')
        || `${serviceName} test failed.`
    );

    return {
        message: ok ? `${serviceName} connection succeeded.` : error,
        ok
    };
}

function getApiTokenBadgeLabel(service: { apiKeyConfigured: boolean }, apiKeyInput: string) {
    if (apiKeyInput.trim()) return 'Unsaved token';

    return service.apiKeyConfigured ? 'Token configured' : 'No token';
}

function getDiscogsCredentialLabel(settings: PtvMusicMetadataSettingsDto, discogsTokenInput: string) {
    if (discogsTokenInput.trim()) return 'Unsaved Discogs token';

    return settings.discogsTokenConfigured ? 'Discogs token configured' : 'Discogs token missing';
}

function getGoogleBooksCredentialLabel(settings: PtvGoogleBooksSettingsDto, googleBooksApiKeyInput: string) {
    if (googleBooksApiKeyInput.trim()) return 'Unsaved Google Books key';

    return settings.googleBooksApiKeyConfigured ? 'Google Books key configured' : 'No Google Books key';
}

function createSeerrSettingsPayload(
    settings: PtvSeerrSettingsDto,
    apiKeyInput: string
): Partial<PtvSeerrSettingsDto> {
    const nextSettings = normalizePluginSettings({
        seerrSettings: settings
    });
    const seerrSettings: Partial<PtvSeerrSettingsDto> = {
        displayName: nextSettings.seerrSettings.displayName,
        enabled: nextSettings.seerrSettings.enabled,
        enableAutoRequest: nextSettings.seerrSettings.enableAutoRequest,
        enableRequestsPage: nextSettings.seerrSettings.enableRequestsPage,
        enableSearchIntegration: nextSettings.seerrSettings.enableSearchIntegration,
        externalUrl: nextSettings.seerrSettings.externalUrl,
        internalUrl: nextSettings.seerrSettings.internalUrl,
        openExternalFallback: nextSettings.seerrSettings.openExternalFallback,
        openRequestsInPtv: nextSettings.seerrSettings.openRequestsInPtv
    };
    const apiKey = apiKeyInput.trim();

    if (apiKey) {
        seerrSettings.apiKey = apiKey;
        seerrSettings.enabled = true;
        seerrSettings.enableRequestsPage = true;
        seerrSettings.enableSearchIntegration = true;
        seerrSettings.openRequestsInPtv = true;
    }

    return seerrSettings;
}

function createArrSettingsPayload(
    settings: PtvArrSettingsDto,
    apiKeyInputs: Record<keyof PtvArrSettingsDto, string>
) {
    const nextSettings = normalizePluginSettings({
        arrSettings: settings
    });
    const arrSettings = clonePluginSettings(nextSettings).arrSettings;

    (Object.keys(arrSettings) as Array<keyof PtvArrSettingsDto>).forEach(serviceName => {
        const apiKey = apiKeyInputs[serviceName]?.trim();

        if (apiKey) {
            arrSettings[serviceName].apiKey = apiKey;
            arrSettings[serviceName].enabled = true;
        } else {
            delete arrSettings[serviceName].apiKey;
        }
    });

    return arrSettings;
}

function createArrServiceSettingsPayload(
    settings: PtvArrSettingsDto,
    apiKeyInputs: Record<keyof PtvArrSettingsDto, string>,
    serviceName: keyof PtvArrSettingsDto
): Partial<PtvArrServiceSettingsDto> {
    const currentServiceSettings = settings[serviceName];
    const serviceSettings: Partial<PtvArrServiceSettingsDto> = {
        enabled: currentServiceSettings.enabled,
        externalUrl: currentServiceSettings.externalUrl,
        internalUrl: currentServiceSettings.internalUrl
    };
    const apiKey = apiKeyInputs[serviceName]?.trim();

    if (apiKey) {
        serviceSettings.apiKey = apiKey;
        serviceSettings.enabled = true;
    }

    return serviceSettings;
}

function createMusicMetadataSettingsPayload(
    settings: PtvMusicMetadataSettingsDto,
    discogsTokenInput: string
): Partial<PtvMusicMetadataSettingsDto> {
    const nextSettings = normalizePluginSettings({
        musicMetadataSettings: settings
    });
    const musicMetadataSettings: Partial<PtvMusicMetadataSettingsDto> = {
        discogsEnabled: nextSettings.musicMetadataSettings.discogsEnabled,
        maxResults: nextSettings.musicMetadataSettings.maxResults,
        musicBrainzEnabled: nextSettings.musicMetadataSettings.musicBrainzEnabled
    };
    const discogsToken = discogsTokenInput.trim();

    if (discogsToken) {
        musicMetadataSettings.discogsToken = discogsToken;
        musicMetadataSettings.discogsEnabled = true;
    }

    return musicMetadataSettings;
}

function createGoogleBooksSettingsPayload(
    settings: PtvGoogleBooksSettingsDto,
    googleBooksApiKeyInput: string
): Partial<PtvGoogleBooksSettingsDto> {
    const nextSettings = normalizePluginSettings({
        googleBooksSettings: settings
    });
    const googleBooksSettings: Partial<PtvGoogleBooksSettingsDto> = {
        googleBooksEnabled: nextSettings.googleBooksSettings.googleBooksEnabled,
        maxResults: nextSettings.googleBooksSettings.maxResults
    };
    const googleBooksApiKey = googleBooksApiKeyInput.trim();

    if (googleBooksApiKey) {
        googleBooksSettings.googleBooksApiKey = googleBooksApiKey;
        googleBooksSettings.googleBooksEnabled = true;
    }

    return googleBooksSettings;
}

type PtvGoogleBooksLookupResponse = {
    Candidates?: unknown[];
    candidates?: unknown[];
    diagnostics?: string[];
    ok?: boolean;
    provider?: {
        cached?: boolean;
        candidateCount?: number;
        configured?: boolean;
        durationMs?: number | null;
        enabled?: boolean;
        error?: string | null;
        statusCode?: number | null;
    };
};

function redactSettingsForDebug<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map(item => redactSettingsForDebug(item)) as T;
    }

    if (!isRecord(value)) {
        return value;
    }

    return Object.entries(value).reduce<Record<string, unknown>>((redacted, [key, entry]) => {
        if (/apiKey|token|password|secret|credential/i.test(key)) {
            redacted[key] = entry ? '[redacted]' : entry;
            return redacted;
        }

        redacted[key] = redactSettingsForDebug(entry);
        return redacted;
    }, {}) as T;
}

function debugPluginSettingsSave(message: string, details?: Record<string, unknown>) {
    if (!isDebugLoggingEnabled()) return;

    console.debug(`[PTV Dashboard] ${message}`, details ? redactSettingsForDebug(details) : undefined);
}

function debugFeaturedRefresh(message: string, details?: Record<string, unknown>) {
    if (!isDebugLoggingEnabled()) return;

    console.debug(`[PTV Dashboard] featured cache ${message}`, details ? redactSettingsForDebug(details) : undefined);
}

function createDashboardAbortController() {
    // eslint-disable-next-line compat/compat
    return typeof AbortController === 'function' ? new AbortController() : null;
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
    const isDegraded = Boolean(status?.degraded || status?.ok === false);
    let connectionState: PluginConnectionState = 'connected';
    let error = '';

    if (!isVersionMatch) {
        connectionState = 'version-mismatch';
        error = `Version mismatch: expected v${PTV_PLUGIN_API.version} but received v${status?.apiVersion ?? 'unknown'}.`;
    } else if (isDegraded) {
        connectionState = 'degraded';
        error = status?.error || 'Plugin connected with degraded subsystem status.';
    }

    return {
        connected: Boolean(isVersionMatch),
        connectionState,
        error,
        loading: false,
        status
    };
}

function hasCompletedFeaturedRefresh(status: PtvPluginStatus | null | undefined) {
    return Boolean(status && status.refreshInProgress === false && status.featuredCacheExists === true);
}

function hasUsableFeaturedCache(status: PtvPluginStatus | null | undefined) {
    const featuredContent = status?.featuredContent;

    return Boolean(
        status?.featuredCacheExists
        && (
            status.featuredCacheFresh
            || featuredContent?.hasPayload
            || (featuredContent?.heroCount || 0) > 0
            || (featuredContent?.sectionCount || 0) > 0
            || (featuredContent?.itemCount || 0) > 0
        )
    );
}

function isFeaturedRefreshSatisfied(status: PtvPluginStatus | null | undefined) {
    return hasCompletedFeaturedRefresh(status) || hasUsableFeaturedCache(status);
}

function getTmdbMetadataStatus(status: PtvPluginStatus | null | undefined): PtvTmdbMetadataStatus | null {
    return status?.tmdbMetadataStatus || status?.tmdbMetadata || null;
}

function isTmdbUnauthorized(status: PtvTmdbMetadataStatus | null | undefined) {
    const errorText = [
        status?.credentialStatus,
        status?.lastErrorCode,
        status?.lastError,
        status?.lastStatusCode
    ].join(' ').toLowerCase();

    return errorText.includes('unauthorized') || errorText.includes('401') || errorText.includes('403');
}

function getTmdbCredentialLabel(status: PtvTmdbMetadataStatus | null | undefined, settings: PtvTmdbSettingsDto) {
    const configured = status?.configured ?? settings.tmdbApiTokenConfigured;
    const credentialStatus = status?.credentialStatus;

    if (credentialStatus === 'valid') return 'Credential valid';
    if (credentialStatus === 'unauthorized') return 'Unauthorized';
    if (credentialStatus === 'missing') return 'No token';
    if (credentialStatus === 'disabled') return 'Disabled';
    if (credentialStatus === 'timeout') return 'Validation timed out';
    if (credentialStatus === 'invalid' || credentialStatus === 'error') return 'Credential failed';

    return configured ? 'Token configured' : 'No token';
}

function sanitizeTmdbCredentialInput(value: string) {
    const withoutBearerPrefix = value.trim().replace(/^Bearer\s+/i, '');

    return withoutBearerPrefix.replace(/\s+/g, '');
}

function getTmdbCredentialExpectation(status: PtvTmdbMetadataStatus | null | undefined) {
    if (status?.credentialType === 'v3-api-key') {
        return 'TMDb is testing a legacy v3 API key using api_key= mode.';
    }

    if (status?.credentialType === 'v4-bearer') {
        return 'TMDb is testing a v4 Read Access Token using Authorization: Bearer.';
    }

    return 'TMDb expects a v4 Read Access Token. Legacy v3 API keys are only used when the saved value looks like a 32-character hex key.';
}

function getTmdbMetadataWarning(status: PtvTmdbMetadataStatus | null | undefined) {
    if (!status?.enabled) return '';

    if (!status.configured) {
        return 'TMDb metadata is enabled, but no v4 Read Access Token or legacy v3 API key is configured.';
    }

    if (isTmdbUnauthorized(status)) {
        const statusCode = status.lastStatusCode ? ` HTTP ${status.lastStatusCode}.` : '';
        const expectation = getTmdbCredentialExpectation(status);

        return `TMDb metadata failed: unauthorized.${statusCode} ${expectation}`;
    }

    if (!status.lastError) return '';

    return `TMDb metadata failed: ${status.lastError}`;
}

function getFeaturedRefreshSuccessMessage(status: PtvPluginStatus | null | undefined, elapsedMs: number) {
    const tmdbWarning = getTmdbMetadataWarning(getTmdbMetadataStatus(status));

    if (tmdbWarning) {
        return `Featured cache refreshed. ${tmdbWarning}`;
    }

    return `Featured cache refresh finished in ${formatDuration(elapsedMs)}.`;
}

function getPluginStatusChipColor(pluginState: PluginState) {
    if (pluginState.connectionState === 'degraded') return 'warning';

    return pluginState.connected ? 'success' : 'error';
}

function getPluginStateLabel(state: PluginConnectionState) {
    return {
        connected: 'connected',
        degraded: 'degraded',
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

    if (state === 'degraded') {
        return pluginStatus?.error || 'Plugin connected, but one or more status subsystems reported degraded data.';
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

function formatDateTimeString(timestamp?: string | null) {
    if (!timestamp) return 'n/a';

    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) return 'n/a';

    return date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    });
}

function getFreshnessLabel(status: ReturnType<typeof getFeaturedContentCacheStatus>) {
    if (!status.heroCount && !status.itemCount) return 'missing';

    return status.isFresh ? 'fresh' : 'stale';
}

function hasEmptyFeaturedContentPayload(
    status: ReturnType<typeof getFeaturedContentCacheStatus>,
    pluginStatus: PtvPluginStatus | null
) {
    const pluginFeaturedStatus = pluginStatus?.featuredContent;
    const heroCount = status.heroCount || pluginFeaturedStatus?.heroCount || 0;
    const itemCount = status.itemCount || pluginFeaturedStatus?.itemCount || 0;
    const sectionCount = status.sectionCount || pluginFeaturedStatus?.sectionCount || 0;
    const hasPayload = status.storage !== 'none' || pluginStatus?.featuredCacheExists || pluginFeaturedStatus?.hasPayload === true;

    return Boolean(hasPayload && !heroCount && !itemCount && sectionCount);
}

function getDashboardCacheSource(
    status: ReturnType<typeof getFeaturedContentCacheStatus>,
    pluginStatus: PtvPluginStatus | null
) {
    if (status.storage !== 'none') return status.storage;
    if (pluginStatus?.featuredCacheExists || statusSupportsFeature(pluginStatus, 'featuredContent')) return 'plugin-file';

    return 'missing';
}

function getDashboardCacheFreshness(
    status: ReturnType<typeof getFeaturedContentCacheStatus>,
    pluginStatus: PtvPluginStatus | null
) {
    if (hasEmptyFeaturedContentPayload(status, pluginStatus)) return 'empty';
    if (status.heroCount || status.itemCount) return getFreshnessLabel(status);
    if (pluginStatus?.featuredCacheExists) {
        return pluginStatus.featuredCacheFresh ? 'fresh' : 'stale';
    }

    if (status.readInProgress || statusSupportsFeature(pluginStatus, 'featuredContent')) return 'loading';

    return 'missing';
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

function formatIntervalHours(ttlMs?: number | null) {
    return Math.max(1, Math.round((ttlMs || PTV_CACHE.featuredContentTtlMs) / (60 * 60 * 1000)));
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

function getNestedBoolean(source: unknown, key: string) {
    if (!isRecord(source)) return null;

    const value = source[key];

    return typeof value === 'boolean' ? value : null;
}

function getNumberValue(source: unknown, key: string) {
    if (!isRecord(source)) return null;

    const value = source[key];

    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getPersistedRecommendationRowCount(settings: unknown) {
    return normalizePtvRecommendationRowSettings(settings)?.rows?.length || 0;
}

function getDebugSourceDetail(source: string, note?: string): DashboardDebugSourceDetail {
    return {
        note,
        source,
        timestamp: new Date().toISOString()
    };
}

function formatDebugReportTimestamp(report: unknown) {
    const timestamp = getNumberValue(report, 'timestamp');

    if (!timestamp) return 'n/a';
    if (timestamp > 1000000000000) return formatDate(timestamp);

    return `${Math.round(timestamp)} ms after runtime start`;
}

function hasUsableDashboardCacheStatus(status: ReturnType<typeof getFeaturedContentCacheStatus>) {
    return Boolean(
        status
        && (
            status.storage !== 'none'
            || status.heroCount
            || status.itemCount
            || status.sectionCount
            || status.ttlMs
        )
    );
}

function hasAuthoritativeLiveDashboardState(
    pluginState: PluginState,
    cacheStatus: ReturnType<typeof getFeaturedContentCacheStatus>
) {
    return pluginState.connected && hasUsableDashboardCacheStatus(cacheStatus);
}

function getDashboardDebugState(
    report: unknown,
    pluginState: PluginState,
    cacheStatus: ReturnType<typeof getFeaturedContentCacheStatus>,
    debugEnabled: boolean
): DashboardDebugState {
    const reportActive = getNestedBoolean(report, 'active');
    const hasLiveState = hasAuthoritativeLiveDashboardState(pluginState, cacheStatus);

    if (pluginState.loading) return 'initializing';
    if (!pluginState.connected) return 'disconnected';
    if (pluginState.connectionState === 'degraded' || pluginState.error || cacheStatus.writeError || cacheStatus.lastRefreshError) return 'degraded';
    if (hasLiveState) return 'active';
    if (reportActive === false && pluginState.connected) return 'initializing';
    if (!debugEnabled && reportActive !== true) return 'disabled';

    return 'active';
}

function getDashboardDebugStateMessage(state: DashboardDebugState, report: unknown, pluginState: PluginState) {
    if (state === 'active' && getNestedBoolean(report, 'active') === false && pluginState.connected) {
        return 'Plugin and cache diagnostics are live. PTV runtime snapshot is not initialized yet on this route.';
    }

    if (state === 'initializing' && getNestedBoolean(report, 'active') === false && pluginState.connected) {
        return 'PTV runtime not initialized yet.';
    }

    return {
        active: 'PTV diagnostics are active.',
        degraded: 'PTV is connected, but one or more live status sources reported a warning.',
        disabled: 'PTV debug collection is disabled.',
        disconnected: 'PTV plugin is disconnected.',
        initializing: 'PTV diagnostics are initializing from live plugin and cache state.'
    }[state];
}

function getDashboardDebugStateColor(state: DashboardDebugState): 'default' | 'error' | 'info' | 'success' | 'warning' {
    return {
        active: 'success',
        degraded: 'warning',
        disabled: 'default',
        disconnected: 'error',
        initializing: 'info'
    }[state] as 'default' | 'error' | 'info' | 'success' | 'warning';
}

function getDashboardDebugAlertSeverity(state: DashboardDebugState): 'error' | 'info' | 'success' | 'warning' {
    const color = getDashboardDebugStateColor(state);

    return color === 'default' ? 'info' : color;
}

function getDashboardDebugSectionSources(
    report: unknown,
    pluginState: PluginState,
    cacheStatus: ReturnType<typeof getFeaturedContentCacheStatus>
) {
    const reportActive = getNestedBoolean(report, 'active');

    return {
        cache: getDebugSourceDetail('live cacheStatus', cacheStatus.readInProgress ? 'read in progress' : cacheStatus.storage),
        clientProfile: getDebugSourceDetail('live clientProfile'),
        debugReport: getDebugSourceDetail(
            report ? 'debug report snapshot' : 'not captured',
            report ? `active=${String(reportActive)}, timestamp=${formatDebugReportTimestamp(report)}` : 'waiting for capture'
        ),
        pluginApi: getDebugSourceDetail('live pluginApi diagnostics'),
        pluginState: getDebugSourceDetail('live pluginState', pluginState.connectionState),
        recommendations: getDebugSourceDetail('plugin settings persistence'),
        renderProfile: getDebugSourceDetail('live performance profile'),
        shell: getDebugSourceDetail(getNestedRecord(report, 'shell') ? 'debug report shell provider' : 'not initialized')
    };
}

function mergeDashboardDebugReport(options: {
    cacheStatus: ReturnType<typeof getFeaturedContentCacheStatus>;
    clientProfile: ReturnType<typeof getPtvClientProfile>;
    debugEnabled: boolean;
    performanceProfile: ReturnType<typeof getPtvPerformanceProfile>;
    persistedRecommendationRows: number;
    pluginApi: ReturnType<typeof getPtvPluginApiDiagnostics>;
    pluginState: PluginState;
    report: unknown;
}) {
    const {
        cacheStatus,
        clientProfile,
        debugEnabled,
        performanceProfile,
        persistedRecommendationRows,
        pluginApi,
        pluginState,
        report
    } = options;
    const baseReport = isRecord(report) ? report : {};
    const cache = {
        ...(getNestedRecord(baseReport, 'cache') || {}),
        status: cacheStatus
    };
    const recommendations = {
        ...(getNestedRecord(baseReport, 'recommendations') || {}),
        persistedRecommendationRows,
        persistedRowsLoaded: persistedRecommendationRows > 0
    };
    const debugState = getDashboardDebugState(baseReport, pluginState, cacheStatus, debugEnabled);
    const sectionSources = getDashboardDebugSectionSources(baseReport, pluginState, cacheStatus);

    return {
        ...baseReport,
        cache,
        clientProfile,
        debugState,
        debugStateMessage: getDashboardDebugStateMessage(debugState, baseReport, pluginState),
        pluginApi,
        pluginState,
        recommendations,
        renderProfile: performanceProfile.renderProfile,
        sectionSources,
        source: 'dashboard-live-merged',
        sourceTimestamp: new Date().toISOString()
    };
}

function getDebugSectionSourceText(sources: unknown, key: string) {
    const source = getNestedRecord(sources, key);

    if (!source) return 'source: n/a';

    const label = typeof source.source === 'string' ? source.source : 'n/a';
    const timestamp = typeof source.timestamp === 'string' ? source.timestamp : 'n/a';
    const note = typeof source.note === 'string' && source.note ? `, ${source.note}` : '';

    return `source: ${label}, captured: ${timestamp}${note}`;
}

function getPerformanceSnapshot() {
    const browserReport = getPtvGlobal()?.performance?.report?.();
    const runtimeReport = getPtvPerformanceReport();

    if (isRecord(browserReport)) {
        return {
            ...browserReport,
            longTaskCount: runtimeReport.longTaskCount,
            longTaskTotalMs: runtimeReport.longTaskTotalMs,
            largestLongTaskMs: runtimeReport.largestLongTaskMs,
            runtimeMonitor: runtimeReport
        };
    }

    return {
        longTaskCount: runtimeReport.longTaskCount,
        longTaskTotalMs: runtimeReport.longTaskTotalMs,
        largestLongTaskMs: runtimeReport.largestLongTaskMs,
        runtimeMonitor: runtimeReport
    };
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

function getEffectivePluginConnectionState(
    connected: boolean,
    cacheSource: string,
    connectionState: PluginConnectionState
): PluginConnectionState {
    if (connected) return connectionState;

    const canUseFallbackState = ['endpoint-unreachable', 'plugin-missing', 'timeout'].includes(connectionState);

    if (cacheSource !== 'missing' && canUseFallbackState) return 'using-fallback';

    return connectionState;
}

function statusSupportsFeature(status: PtvPluginStatus | null | undefined, feature: string) {
    if (!status) return false;

    const featureFlagValue = status.featureFlags?.[feature];

    if (typeof featureFlagValue === 'boolean') {
        if (isDebugLoggingEnabled()) {
            console.debug(`[PTV Dashboard] Feature detected: ${feature}=${featureFlagValue}`);
        }

        return featureFlagValue;
    }

    if (Array.isArray(status.features)) {
        const isDetected = status.features.includes(feature);

        if (isDebugLoggingEnabled()) {
            console.debug(`[PTV Dashboard] Feature detected: ${feature}=${isDetected}`);
        }

        return isDetected;
    }

    const featureValue = status.features?.[feature];

    if (typeof featureValue === 'boolean') {
        if (isDebugLoggingEnabled()) {
            console.debug(`[PTV Dashboard] Feature detected: ${feature}=${featureValue}`);
        }

        return featureValue;
    }

    if (isDebugLoggingEnabled()) {
        console.debug(`[PTV Dashboard] Feature detected: ${feature}=false`);
    }

    return false;
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
    attemptedUrl,
    onCopy,
    state
}: Readonly<{
    attemptedUrl?: string | null;
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
                {attemptedUrl ? (
                    <Typography>
                        Last attempted URL: {attemptedUrl}
                    </Typography>
                ) : null}
                <Typography>
                    If this ends with /web/Ptv/v1/status, the plugin API path is being resolved under Jellyfin Web instead of the server root.
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
            {cacheFreshness === 'empty' ? (
                <Alert severity='warning'>Featured cache is fresh but empty. Home may need a rebuild or valid row data before content appears.</Alert>
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

// eslint-disable-next-line sonarjs/cognitive-complexity
const PiggieTvDashboardPage = () => {
    const navigate = useNavigate();
    const [pluginState, setPluginState] = useState<PluginState>(EMPTY_PLUGIN_STATE);
    const [cacheStatus, setCacheStatus] = useState(getFeaturedContentCacheStatus);
    const [debugEnabled, setDebugEnabledState] = useState(isPtvDebugEnabled);
    const [overlayEnabled, setOverlayEnabled] = useState(isPerformanceOverlayActive);
    const [featureSettings, setFeatureSettingsState] = useState(getPtvFeatureSettings);
    const [statusMessage, setStatusMessage] = useState('');
    const [debugReport, setDebugReport] = useState<unknown>(null);
    const [performanceReport, setPerformanceReport] = useState<unknown>(getPerformanceSnapshot);
    const [persistedRecommendationRows, setPersistedRecommendationRows] = useState(0);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [featuredRefreshState, setFeaturedRefreshState] = useState<FeaturedRefreshState>('idle');
    const [isClearing, setIsClearing] = useState(false);
    const [refreshIntervalHours, setRefreshIntervalHours] = useState(() => String(formatIntervalHours(getFeaturedContentCacheStatus().ttlMs)));
    const [pluginSettings, setPluginSettings] = useState<PtvPluginSettings | null>(null);
    const [featureSettingsDraft, setFeatureSettingsDraft] = useState<PtvFeatureSettingsDto>(() => ({ ...DEFAULT_PLUGIN_SETTINGS.featureSettings }));
    const [heroSettingsDraft, setHeroSettingsDraft] = useState<PtvHeroSettingsDto>(() => ({ ...DEFAULT_PLUGIN_SETTINGS.heroSettings }));
    const [rowSettingsDraft, setRowSettingsDraft] = useState<PtvRowSettingsDto>(() => ({ ...DEFAULT_PLUGIN_SETTINGS.rowSettings }));
    const [performanceSettingsDraft, setPerformanceSettingsDraft] = useState<PtvPerformanceSettingsDto>(() => ({ ...DEFAULT_PLUGIN_SETTINGS.performanceSettings }));
    const [tmdbSettingsDraft, setTmdbSettingsDraft] = useState<PtvTmdbSettingsDto>(() => ({ ...DEFAULT_PLUGIN_SETTINGS.tmdbSettings }));
    const [musicMetadataSettingsDraft, setMusicMetadataSettingsDraft] = useState<PtvMusicMetadataSettingsDto>(() => ({ ...DEFAULT_PLUGIN_SETTINGS.musicMetadataSettings }));
    const [googleBooksSettingsDraft, setGoogleBooksSettingsDraft] = useState<PtvGoogleBooksSettingsDto>(() => ({ ...DEFAULT_PLUGIN_SETTINGS.googleBooksSettings }));
    const [cacheSettingsDraft, setCacheSettingsDraft] = useState<PtvCacheSettingsDto>(() => ({ ...DEFAULT_PLUGIN_SETTINGS.cacheSettings }));
    const [seerrSettingsDraft, setSeerrSettingsDraft] = useState<PtvSeerrSettingsDto>(() => ({ ...DEFAULT_PLUGIN_SETTINGS.seerrSettings }));
    const [arrSettingsDraft, setArrSettingsDraft] = useState<PtvArrSettingsDto>(() => clonePluginSettings(DEFAULT_PLUGIN_SETTINGS).arrSettings);
    const [downloadSettingsDraft, setDownloadSettingsDraft] = useState<PtvDownloadSettingsDto>(() => ({ ...DEFAULT_PLUGIN_SETTINGS.downloadSettings }));
    const [settingsLoading, setSettingsLoading] = useState(false);
    const [settingsSaving, setSettingsSaving] = useState(false);
    const [settingsSavingSection, setSettingsSavingSection] = useState<PtvSettingsSection | null>(null);
    const [settingsResetting, setSettingsResetting] = useState(false);
    const [settingsDirty, setSettingsDirtyState] = useState(false);
    const [tmdbTokenInput, setTmdbTokenInput] = useState('');
    const [discogsTokenInput, setDiscogsTokenInput] = useState('');
    const [googleBooksApiKeyInput, setGoogleBooksApiKeyInput] = useState('');
    const [seerrApiKeyInput, setSeerrApiKeyInput] = useState('');
    const [arrApiKeyInputs, setArrApiKeyInputs] = useState<Record<keyof PtvArrSettingsDto, string>>({
        lidarr: '',
        prowlarr: '',
        radarr: '',
        sonarr: ''
    });
    const [downloadCredentialInputs, setDownloadCredentialInputs] = useState({
        password: '',
        username: ''
    });
    const [integrationTestMessages, setIntegrationTestMessages] = useState<Partial<Record<PtvIntegrationTestKey, string>>>({});
    const [integrationTesting, setIntegrationTesting] = useState<Partial<Record<PtvIntegrationTestKey, boolean>>>({});
    const pluginSettingsRequestRef = useRef<Promise<PtvPluginSettings | null> | null>(null);
    const pluginStatusRequestRef = useRef<Promise<void> | null>(null);
    const featuredRefreshStateRef = useRef<FeaturedRefreshState>('idle');
    const featuredRefreshRequestRef = useRef<Promise<void> | null>(null);
    const integrationTestRequestRef = useRef<Partial<Record<PtvIntegrationTestKey, Promise<void>>>>({});
    const integrationTestAbortRef = useRef<Partial<Record<PtvIntegrationTestKey, AbortController>>>({});
    const settingsDirtyRef = useRef(settingsDirty);
    const hydratedRef = useRef(false);
    const initialHydrationStartedRef = useRef(false);
    const pluginSettingsLoadedRef = useRef(false);

    const openPtvDashboardRoute = useCallback((
        path: string,
        hash: string,
        event?: React.MouseEvent<HTMLElement>
    ) => {
        event?.preventDefault();
        console.info('[PTV Recommendations] Dashboard navigation requested', {
            currentHash: window.location.hash,
            currentPathname: window.location.pathname,
            targetHash: hash,
            targetPath: path
        });
        navigate(path);
        window.setTimeout(() => {
            if (window.location.hash !== hash) {
                window.location.hash = hash;
            }

            const routeController = (window as unknown as {
                PTV?: {
                    routeController?: {
                        refresh?: () => unknown;
                    };
                };
            }).PTV?.routeController;

            routeController?.refresh?.();
        }, 0);
    }, [navigate]);

    const openPtvRowBuilder = useCallback((event?: React.MouseEvent<HTMLElement>) => {
        openPtvDashboardRoute(PTV_ROW_BUILDER_PATH, PTV_ROW_BUILDER_HASH, event);
    }, [openPtvDashboardRoute]);

    const openPtvRecommendations = useCallback((event?: React.MouseEvent<HTMLElement>) => {
        openPtvDashboardRoute(PTV_RECOMMENDATIONS_PATH, PTV_RECOMMENDATIONS_HASH, event);
    }, [openPtvDashboardRoute]);

    const setSettingsDirty = useCallback((nextValue: boolean) => {
        settingsDirtyRef.current = nextValue;
        setSettingsDirtyState(nextValue);
    }, []);

    const setFeaturedRefreshStateValue = useCallback((nextState: FeaturedRefreshState) => {
        featuredRefreshStateRef.current = nextState;
        setFeaturedRefreshState(nextState);
    }, []);

    useEffect(() => {
        settingsDirtyRef.current = settingsDirty;
    }, [settingsDirty]);

    const clientProfile = useMemo(() => getPtvClientProfile(), []);
    const performanceProfile = useMemo(() => getPtvPerformanceProfile(), []);
    const arrCalendarReady = ARR_CALENDAR_SERVICE_NAMES.some(serviceName => {
        const service = arrSettingsDraft[serviceName];

        return Boolean(
            service.internalUrl.trim()
            && (service.apiKeyConfigured || arrApiKeyInputs[serviceName]?.trim())
        );
    });

    const syncCacheStatus = useCallback(() => {
        setCacheStatus(getFeaturedContentCacheStatus());
    }, []);

    const syncPerformanceReport = useCallback(() => {
        setPerformanceReport(getPerformanceSnapshot());
    }, []);

    const applyPluginSettingsState = useCallback((
        settings: PtvPluginSettings,
        options: ApplyPluginSettingsStateOptions = {}
    ) => {
        const normalizedSettings = normalizePluginSettings(settings);
        const shouldHydrateDrafts = options.forceDraftHydration
            || (options.hydrateDrafts !== false && !settingsDirtyRef.current);

        setPluginSettings(normalizedSettings);

        if (shouldHydrateDrafts) {
            setFeatureSettingsDraft({ ...normalizedSettings.featureSettings });
            setHeroSettingsDraft({ ...normalizedSettings.heroSettings });
            setRowSettingsDraft({ ...normalizedSettings.rowSettings });
            setPerformanceSettingsDraft({ ...normalizedSettings.performanceSettings });
            setTmdbSettingsDraft({ ...normalizedSettings.tmdbSettings });
            setMusicMetadataSettingsDraft({ ...normalizedSettings.musicMetadataSettings });
            setGoogleBooksSettingsDraft({ ...normalizedSettings.googleBooksSettings });
            setCacheSettingsDraft({ ...normalizedSettings.cacheSettings });
            setSeerrSettingsDraft({ ...normalizedSettings.seerrSettings });
            setArrSettingsDraft(clonePluginSettings(normalizedSettings).arrSettings);
            setDownloadSettingsDraft({ ...normalizedSettings.downloadSettings });
            setSettingsDirty(false);
            settingsDirtyRef.current = false;
            setTmdbTokenInput('');
            setDiscogsTokenInput('');
            setGoogleBooksApiKeyInput('');
            setSeerrApiKeyInput('');
            setArrApiKeyInputs({
                lidarr: '',
                prowlarr: '',
                radarr: '',
                sonarr: ''
            });
            setDownloadCredentialInputs({
                password: '',
                username: ''
            });
            setRefreshIntervalHours(String(normalizedSettings.cacheSettings.refreshIntervalHours));
        }

        setFeaturedContentCacheTtlMs(
            normalizedSettings.cacheSettings.refreshIntervalHours * 60 * 60 * 1000,
            { persist: false }
        );
        applyPluginFeatureSettings(normalizedSettings.featureSettings);
        setFeatureSettingsState(getPtvFeatureSettings());
        setDebugEnabledState(isPtvDebugEnabled());

        return normalizedSettings;
    }, [setSettingsDirty]);

    const loadPluginSettings = useCallback((options: LoadPluginSettingsOptions = {}) => {
        const origin = options.origin || (options.force ? 'explicit reload' : 'mount');

        if (hydratedRef.current && !options.force) {
            debugPluginSettingsSave('plugin settings fetch skipped; already hydrated', {
                dirty: settingsDirtyRef.current,
                hydrated: hydratedRef.current,
                origin
            });
            return Promise.resolve(null);
        }

        if (pluginSettingsRequestRef.current) return pluginSettingsRequestRef.current;

        const pluginApi = getCurrentPtvPluginApiClient();

        if (!pluginApi?.getSettings) return Promise.resolve(null);

        setSettingsLoading(true);
        debugPluginSettingsSave('plugin settings hydration started', {
            dirty: settingsDirtyRef.current,
            force: Boolean(options.force),
            hydrated: hydratedRef.current,
            origin
        });

        const settingsRequest = pluginApi.getSettings<PtvPluginSettings>()
            .then(settings => {
                setPersistedRecommendationRows(getPersistedRecommendationRowCount(settings));
                debugPluginSettingsSave('plugin settings fetch completed', {
                    dirtyBeforeHydration: settingsDirtyRef.current,
                    origin,
                    settings
                });

                const normalizedSettings = applyPluginSettingsState(settings, {
                    forceDraftHydration: options.force,
                    hydrateDrafts: options.hydrateDrafts
                });
                pluginSettingsLoadedRef.current = true;
                hydratedRef.current = true;
                debugPluginSettingsSave('plugin settings hydration finished', {
                    dirtyAfterHydration: settingsDirtyRef.current,
                    hydrated: hydratedRef.current,
                    origin,
                    settings: normalizedSettings
                });

                return normalizedSettings;
            })
            .catch((err: unknown) => {
                debugPluginSettingsSave('plugin settings hydration failed', {
                    error: normalizePtvApiError(err),
                    origin
                });

                return null;
            })
            .finally(() => {
                setSettingsLoading(false);
                pluginSettingsRequestRef.current = null;
            });

        pluginSettingsRequestRef.current = settingsRequest;

        return settingsRequest;
    }, [applyPluginSettingsState]);

    const applyPluginStatus = useCallback((status: PtvPluginStatus) => {
        setPluginState(createPluginStateFromStatus(status));

        if (isFeaturedRefreshSatisfied(status) && featuredRefreshStateRef.current === 'error') {
            setFeaturedRefreshStateValue('success');
            setStatusMessage(getFeaturedRefreshSuccessMessage(status, status.lastRefreshDurationMs || 0));
            debugFeaturedRefresh('cleared stale error from status refresh', {
                featuredCacheExists: status.featuredCacheExists,
                featuredCacheFresh: status.featuredCacheFresh,
                lastRefreshDurationMs: status.lastRefreshDurationMs,
                refreshInProgress: status.refreshInProgress,
                tmdbMetadata: getTmdbMetadataStatus(status)
            });
        }
    }, [setFeaturedRefreshStateValue]);

    const refreshPluginStatus = useCallback(() => {
        if (pluginStatusRequestRef.current) return pluginStatusRequestRef.current;

        const pluginApi = getCurrentPtvPluginApiClient();

        if (!pluginApi) {
            setPluginState({
                connected: false,
                connectionState: 'endpoint-unreachable',
                error: 'PTV plugin API client is unavailable.',
                loading: false,
                status: null
            });
            return Promise.resolve();
        }

        resetPtvPluginApiAvailability();
        setPluginState(previousState => ({
            ...previousState,
            loading: true
        }));

        const statusRequest = withTimeout(
            pluginApi.getStatus<PtvPluginStatus>({ params: { full: true } })
                .catch((err: unknown) => {
                    if (isDebugLoggingEnabled()) {
                        console.debug('[PTV Dashboard] Full plugin status failed, falling back to safe status', normalizePtvApiError(err));
                    }

                    return pluginApi.getStatus<PtvPluginStatus>()
                        .then(status => ({
                            ...status,
                            degraded: true,
                            error: status.error || getErrorMessage(err)
                        }));
                }),
            PLUGIN_STATUS_TIMEOUT_MS
        )
            .then(status => {
                applyPluginStatus(status);
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
            })
            .finally(() => {
                pluginStatusRequestRef.current = null;
            });

        pluginStatusRequestRef.current = statusRequest;

        return statusRequest;
    }, [applyPluginStatus]);

    const fetchFullPluginStatus = useCallback(() => {
        const pluginApi = getCurrentPtvPluginApiClient();

        if (!pluginApi) {
            return Promise.reject(new Error('PTV plugin API client is unavailable.'));
        }

        return withTimeout(
            pluginApi.getStatus<PtvPluginStatus>({ params: { full: true } }),
            PLUGIN_STATUS_TIMEOUT_MS
        )
            .then(status => {
                applyPluginStatus(status);
                return status;
            });
    }, [applyPluginStatus]);

    const waitForFeaturedRefreshCompletion = useCallback(async (origin: string, startedAt: number) => {
        let latestStatus: PtvPluginStatus | null = null;

        while (Date.now() - startedAt < FEATURED_REFRESH_MAX_WAIT_MS) {
            const status = await fetchFullPluginStatus();
            latestStatus = status;
            syncCacheStatus();
            syncPerformanceReport();
            debugFeaturedRefresh('poll status', {
                elapsedMs: Date.now() - startedAt,
                featuredCacheExists: status.featuredCacheExists,
                lastRefreshDurationMs: status.lastRefreshDurationMs,
                origin,
                refreshInProgress: status.refreshInProgress
            });

            if (isFeaturedRefreshSatisfied(status)) {
                if (status.refreshInProgress === true) {
                    debugFeaturedRefresh('treating stale progress flag as success because cache is usable', {
                        elapsedMs: Date.now() - startedAt,
                        featuredCacheExists: status.featuredCacheExists,
                        featuredCacheFresh: status.featuredCacheFresh,
                        itemCount: status.featuredContent?.itemCount,
                        origin,
                        refreshInProgress: status.refreshInProgress,
                        sectionCount: status.featuredContent?.sectionCount
                    });
                }

                return status;
            }

            if (status.refreshInProgress === false) {
                if (status.featuredCacheExists) return status;

                throw new Error('Featured cache refresh completed, but no featured cache was reported.');
            }

            await delay(FEATURED_REFRESH_POLL_INTERVAL_MS);
        }

        if (latestStatus && isFeaturedRefreshSatisfied(latestStatus)) return latestStatus;

        throw Object.assign(new Error('Featured cache refresh did not finish before the polling timeout.'), {
            code: 'PTV_FEATURED_REFRESH_POLL_TIMEOUT'
        });
    }, [fetchFullPluginStatus, syncCacheStatus, syncPerformanceReport]);

    const refreshCacheWithClientFallback = useCallback(() => forceRefreshFeaturedContentCache(fetchDashboardFeaturedContent)
        .then(() => {
            syncCacheStatus();
            syncPerformanceReport();
            void refreshPluginStatus();
            setStatusMessage('Featured cache refresh finished.');
        }), [refreshPluginStatus, syncCacheStatus, syncPerformanceReport]);

    const refreshCache = useCallback(() => {
        const backendRefreshBlocking = Boolean(pluginState.status?.refreshInProgress && !hasUsableFeaturedCache(pluginState.status));

        if (featuredRefreshRequestRef.current || backendRefreshBlocking) {
            setStatusMessage('Refreshing featured cache...');
            debugFeaturedRefresh('duplicate refresh ignored', {
                backendRefreshBlocking,
                refreshInProgress: pluginState.status?.refreshInProgress,
                state: featuredRefreshStateRef.current
            });
            return;
        }

        const pluginApi = getCurrentPtvPluginApiClient();
        const canUseServerRefresh = Boolean(
            pluginApi?.refreshFeaturedContentCacheDocument
            && pluginState.connected
            && pluginState.status?.canWriteFeaturedContent !== false
            && statusSupportsFeature(pluginState.status, 'featuredContentRefresh')
        );
        const refreshStartedAt = Date.now();

        setIsRefreshing(true);
        setFeaturedRefreshStateValue('refreshing');
        setStatusMessage('Refreshing featured cache...');
        debugFeaturedRefresh('start', {
            canUseServerRefresh,
            refreshInProgress: pluginState.status?.refreshInProgress
        });

        const refreshTask = (async () => {
            if (!canUseServerRefresh || !pluginApi) {
                await refreshCacheWithClientFallback();
                setFeaturedRefreshStateValue('success');
                return;
            }

            try {
                const triggerStatus = await withTimeout(
                    pluginApi.refreshFeaturedContentCacheDocument<PtvPluginStatus>(),
                    FEATURED_REFRESH_TRIGGER_TIMEOUT_MS
                );

                applyPluginStatus(triggerStatus);
                debugFeaturedRefresh('trigger response', {
                    elapsedMs: Date.now() - refreshStartedAt,
                    featuredCacheExists: triggerStatus.featuredCacheExists,
                    lastRefreshDurationMs: triggerStatus.lastRefreshDurationMs,
                    refreshInProgress: triggerStatus.refreshInProgress
                });
            } catch (err) {
                debugFeaturedRefresh('trigger error; checking backend status before failing', {
                    elapsedMs: Date.now() - refreshStartedAt,
                    error: normalizePtvApiError(err)
                });

                if (isPluginRefreshFallbackError(err)) {
                    await refreshCacheWithClientFallback();
                    setFeaturedRefreshStateValue('success');
                    return;
                }

                const latestStatus = await fetchFullPluginStatus().catch(() => null);

                if (!latestStatus?.refreshInProgress && !isFeaturedRefreshSatisfied(latestStatus)) {
                    throw err;
                }
            }

            const finalStatus = await waitForFeaturedRefreshCompletion('server-refresh', refreshStartedAt);
            setFeaturedRefreshStateValue('success');
            setStatusMessage(getFeaturedRefreshSuccessMessage(finalStatus, Date.now() - refreshStartedAt));
            debugFeaturedRefresh('success', {
                elapsedMs: Date.now() - refreshStartedAt,
                featuredCacheExists: finalStatus.featuredCacheExists,
                heroCount: finalStatus.featuredContent?.heroCount,
                itemCount: finalStatus.featuredContent?.itemCount,
                lastRefreshDurationMs: finalStatus.lastRefreshDurationMs,
                sectionCount: finalStatus.featuredContent?.sectionCount,
                tmdbMetadata: getTmdbMetadataStatus(finalStatus)
            });
        })()
            .then(() => {
                syncCacheStatus();
                syncPerformanceReport();
                void refreshPluginStatus();
            })
            .catch((err: unknown) => {
                setFeaturedRefreshStateValue('error');
                setStatusMessage(`Featured cache refresh failed: ${getErrorMessage(err)}`);
                debugFeaturedRefresh('failed', {
                    elapsedMs: Date.now() - refreshStartedAt,
                    error: normalizePtvApiError(err)
                });
            })
            .finally(() => {
                setIsRefreshing(false);
                featuredRefreshRequestRef.current = null;
            });

        featuredRefreshRequestRef.current = refreshTask;
    }, [
        applyPluginStatus,
        fetchFullPluginStatus,
        pluginState.connected,
        pluginState.status,
        refreshCacheWithClientFallback,
        refreshPluginStatus,
        setFeaturedRefreshStateValue,
        syncCacheStatus,
        syncPerformanceReport,
        waitForFeaturedRefreshCompletion
    ]);

    const clearCache = useCallback(() => {
        setIsClearing(true);
        setStatusMessage('Clearing featured cache...');
        clearFeaturedContentCache();

        window.setTimeout(() => {
            syncCacheStatus();
            syncPerformanceReport();
            void refreshPluginStatus();
            setIsClearing(false);
            setStatusMessage('Featured cache clear requested.');
        }, 250);
    }, [refreshPluginStatus, syncCacheStatus, syncPerformanceReport]);

    const savePluginSettings = useCallback((
        settingsPatch: PtvPluginSettingsPatch,
        section: PtvSettingsSection,
        successMessage: string
    ) => {
        const pluginApi = getCurrentPtvPluginApiClient();

        if (!pluginApi?.saveSettings) {
            setStatusMessage('Plugin settings API is unavailable.');
            return Promise.resolve();
        }

        setSettingsSaving(true);
        setSettingsSavingSection(section);
        setStatusMessage('Saving PiggieTV plugin settings...');
        debugPluginSettingsSave('plugin settings save started', {
            dirtyBeforeSave: settingsDirtyRef.current,
            endpoint: PTV_PLUGIN_API.endpoints.settings,
            method: 'POST',
            payload: settingsPatch,
            section
        });

        return pluginApi.saveSettings<PtvPluginSettings, PtvPluginSettingsPatch>(settingsPatch)
            .then(savedSettings => {
                debugPluginSettingsSave('plugin settings save response received', {
                    dirtyBeforeApply: settingsDirtyRef.current,
                    response: savedSettings,
                    section,
                    status: 'resolved'
                });

                const normalizedSavedSettings = applyPluginSettingsState(savedSettings, {
                    forceDraftHydration: true
                });
                pluginSettingsLoadedRef.current = true;
                hydratedRef.current = true;
                clearPtvIntegrationSettingsCache();

                return loadPluginSettings({
                    force: true,
                    hydrateDrafts: true,
                    origin: `save verification:${section}`
                })
                    .then(reloadedSettings => reloadedSettings || normalizedSavedSettings)
                    .catch((err: unknown) => {
                        debugPluginSettingsSave('plugin settings reload after save failed', {
                            dirtyAfterSaveApply: settingsDirtyRef.current,
                            error: getErrorMessage(err),
                            section
                        });

                        return normalizedSavedSettings;
                    });
            })
            .then(normalizedSettings => {
                if (section === 'refreshInterval' || section === 'cacheSettings') {
                    setFeaturedContentCacheTtlMs(
                        normalizedSettings.cacheSettings.refreshIntervalHours * 60 * 60 * 1000,
                        { persist: false }
                    );
                }

                syncCacheStatus();
                syncPerformanceReport();
                debugPluginSettingsSave('plugin settings save finished', {
                    dirtyAfterSave: settingsDirtyRef.current,
                    section,
                    settings: normalizedSettings
                });
                setStatusMessage(successMessage);
                return normalizedSettings;
            })
            .catch((err: unknown) => {
                debugPluginSettingsSave('plugin settings save failed', {
                    dirtyAfterFailure: settingsDirtyRef.current,
                    error: getErrorMessage(err),
                    section,
                    status: 'failed'
                });
                setStatusMessage(`PiggieTV plugin settings save failed: ${getErrorMessage(err)}`);
            })
            .finally(() => {
                setSettingsSaving(false);
                setSettingsSavingSection(null);
            });
    }, [
        applyPluginSettingsState,
        loadPluginSettings,
        syncCacheStatus,
        syncPerformanceReport
    ]);

    const resetPluginSettings = useCallback(() => {
        const pluginApi = getCurrentPtvPluginApiClient();

        if (!pluginApi?.resetSettings) {
            setStatusMessage('Plugin settings reset API is unavailable.');
            return;
        }

        setSettingsResetting(true);
        setStatusMessage('Resetting PiggieTV plugin settings...');

        pluginApi.resetSettings<PtvPluginSettings>()
            .then(settings => {
                applyPluginSettingsState(settings, {
                    forceDraftHydration: true
                });
                pluginSettingsLoadedRef.current = true;
                hydratedRef.current = true;
                syncCacheStatus();
                syncPerformanceReport();
                setStatusMessage('PiggieTV plugin settings reset.');
            })
            .catch((err: unknown) => {
                setStatusMessage(`PiggieTV plugin settings reset failed: ${getErrorMessage(err)}`);
            })
            .finally(() => {
                setSettingsResetting(false);
            });
    }, [applyPluginSettingsState, syncCacheStatus, syncPerformanceReport]);

    const saveFeatureSettings = useCallback(() => {
        const nextSettings = normalizePluginSettings({
            featureSettings: featureSettingsDraft
        });

        void savePluginSettings({
            featureSettings: nextSettings.featureSettings
        }, 'featureSettings', 'Feature toggles saved.');
    }, [featureSettingsDraft, savePluginSettings]);

    const saveHeroSettings = useCallback(() => {
        const fallbackSettings = pluginSettings?.heroSettings || DEFAULT_PLUGIN_SETTINGS.heroSettings;
        const nextHeroSettings: PtvHeroSettingsDto = {
            ...heroSettingsDraft,
            heroBackdropMaxWidth: clampNumberWithFallback(
                heroSettingsDraft.heroBackdropMaxWidth,
                fallbackSettings.heroBackdropMaxWidth,
                ...PTV_SETTINGS_LIMITS.heroBackdropMaxWidth
            ),
            heroLogoMaxWidth: clampNumberWithFallback(
                heroSettingsDraft.heroLogoMaxWidth,
                fallbackSettings.heroLogoMaxWidth,
                ...PTV_SETTINGS_LIMITS.heroLogoMaxWidth
            ),
            heroMaxItems: clampNumberWithFallback(
                heroSettingsDraft.heroMaxItems,
                fallbackSettings.heroMaxItems,
                ...PTV_SETTINGS_LIMITS.heroMaxItems
            ),
            heroRotationSeconds: clampNumberWithFallback(
                heroSettingsDraft.heroRotationSeconds,
                fallbackSettings.heroRotationSeconds,
                ...PTV_SETTINGS_LIMITS.heroRotationSeconds
            )
        };

        void savePluginSettings({
            heroSettings: nextHeroSettings
        }, 'heroSettings', 'Hero settings saved.');
    }, [heroSettingsDraft, pluginSettings, savePluginSettings]);

    const saveRowSettings = useCallback(() => {
        const nextSettings = normalizePluginSettings({
            rowSettings: rowSettingsDraft
        });

        void savePluginSettings({
            rowSettings: nextSettings.rowSettings
        }, 'rowSettings', 'Row settings saved.');
    }, [rowSettingsDraft, savePluginSettings]);

    const savePerformanceSettings = useCallback(() => {
        const nextSettings = normalizePluginSettings({
            performanceSettings: performanceSettingsDraft
        });

        void savePluginSettings({
            performanceSettings: nextSettings.performanceSettings
        }, 'performanceSettings', 'Performance settings saved.');
    }, [performanceSettingsDraft, savePluginSettings]);

    const saveTmdbSettings = useCallback(() => {
        const wasConfigured = tmdbSettingsDraft.tmdbApiTokenConfigured;
        const nextSettings = normalizePluginSettings({
            tmdbSettings: tmdbSettingsDraft
        });
        const tmdbSettings: Partial<PtvTmdbSettingsDto> = {
            tmdbEnabled: nextSettings.tmdbSettings.tmdbEnabled,
            tmdbLanguage: nextSettings.tmdbSettings.tmdbLanguage,
            tmdbRegion: nextSettings.tmdbSettings.tmdbRegion,
            useTmdbForRowAccuracy: nextSettings.tmdbSettings.useTmdbForRowAccuracy
        };
        const token = sanitizeTmdbCredentialInput(tmdbTokenInput);

        if (token) {
            tmdbSettings.tmdbApiToken = token;
        }

        void savePluginSettings({
            tmdbSettings
        }, 'tmdbSettings', 'TMDB settings saved.')
            .then(savedSettings => {
                if (!savedSettings) return;

                const isConfigured = savedSettings.tmdbSettings.tmdbApiTokenConfigured;
                const changedText = token ?
                    ` Credential configured: ${String(wasConfigured)} -> ${String(isConfigured)}.` :
                    '';

                setIntegrationTestMessages(previous => ({
                    ...previous,
                    tmdb: `TMDb settings saved.${changedText} ${getTmdbCredentialExpectation(null)}`
                }));
                setTmdbTokenInput('');
            });
    }, [savePluginSettings, tmdbSettingsDraft, tmdbTokenInput]);

    const saveMusicMetadataSettings = useCallback(() => {
        void savePluginSettings({
            musicMetadataSettings: createMusicMetadataSettingsPayload(musicMetadataSettingsDraft, discogsTokenInput)
        }, 'musicMetadataSettings', 'Music metadata settings saved.')
            .then(savedSettings => {
                if (!savedSettings) return;

                const discogsConfigured = savedSettings.musicMetadataSettings.discogsTokenConfigured;

                setIntegrationTestMessages(previous => ({
                    ...previous,
                    discogs: discogsConfigured ? 'Discogs token is configured for backend song metadata lookup.' : 'Discogs token is not configured.'
                }));
                setDiscogsTokenInput('');
            });
    }, [discogsTokenInput, musicMetadataSettingsDraft, savePluginSettings]);

    const saveGoogleBooksSettings = useCallback(() => {
        void savePluginSettings({
            googleBooksSettings: createGoogleBooksSettingsPayload(googleBooksSettingsDraft, googleBooksApiKeyInput)
        }, 'googleBooksSettings', 'Google Books settings saved.')
            .then(savedSettings => {
                if (!savedSettings) return;

                const googleBooksConfigured = savedSettings.googleBooksSettings.googleBooksApiKeyConfigured;

                setIntegrationTestMessages(previous => ({
                    ...previous,
                    googleBooks: googleBooksConfigured ? 'Google Books API key is configured for backend reading metadata lookup.' : 'Google Books can run without a key; add one for higher quota.'
                }));
                setGoogleBooksApiKeyInput('');
            });
    }, [googleBooksApiKeyInput, googleBooksSettingsDraft, savePluginSettings]);

    const clearGoogleBooksApiKey = useCallback(() => {
        void savePluginSettings({
            googleBooksSettings: {
                clearGoogleBooksApiKey: true
            }
        }, 'googleBooksSettings', 'Google Books API key cleared.')
            .then(savedSettings => {
                if (!savedSettings) return;

                setGoogleBooksSettingsDraft({ ...savedSettings.googleBooksSettings });
                setGoogleBooksApiKeyInput('');
                setIntegrationTestMessages(previous => ({
                    ...previous,
                    googleBooks: 'Google Books API key cleared. Lookup can still run without a key at public quota.'
                }));
            });
    }, [savePluginSettings]);

    const testGoogleBooksConnection = useCallback(() => {
        if (integrationTestRequestRef.current.googleBooks) {
            debugPluginSettingsSave('integration test deduped', {
                origin: 'click',
                service: 'googleBooks'
            });
            return;
        }

        const pluginApi = getCurrentPtvPluginApiClient();

        if (!pluginApi?.searchGoogleBooksMetadata) {
            setIntegrationTestMessages(previous => ({
                ...previous,
                googleBooks: 'Google Books test endpoint is unavailable.'
            }));
            return;
        }

        const abortController = createDashboardAbortController();

        if (abortController) {
            integrationTestAbortRef.current.googleBooks = abortController;
        }

        setIntegrationTesting(previous => ({ ...previous, googleBooks: true }));
        setIntegrationTestMessages(previous => ({ ...previous, googleBooks: 'Testing Google Books lookup...' }));
        debugPluginSettingsSave('integration test triggered', {
            origin: 'click',
            service: 'googleBooks'
        });

        const testRequest = pluginApi.searchGoogleBooksMetadata<PtvGoogleBooksLookupResponse>({
            author: 'Marc Bernabe',
            isbn: '9781462923007',
            limit: Math.min(5, googleBooksSettingsDraft.maxResults || 5),
            title: 'Learn Japanese with Manga Volume One',
            year: 2022
        }, {
            signal: abortController?.signal
        })
            .then(result => {
                let candidates: unknown[] = [];

                if (Array.isArray(result.candidates)) {
                    candidates = result.candidates;
                } else if (Array.isArray(result.Candidates)) {
                    candidates = result.Candidates;
                }

                const provider = result.provider || {};
                const resultCount = Number(provider.candidateCount ?? candidates.length);
                const statusCode = provider.statusCode ? ` HTTP ${provider.statusCode}.` : '';
                const duration = provider.durationMs ? ` Duration ${provider.durationMs}ms.` : '';
                const cache = provider.cached ? ' Cache hit.' : '';
                const key = provider.configured || googleBooksSettingsDraft.googleBooksApiKeyConfigured ?
                    ' API key configured.' :
                    ' No API key configured.';
                const error = provider.error ? ` Provider warning: ${provider.error}` : '';

                setIntegrationTestMessages(previous => ({
                    ...previous,
                    googleBooks: `Google Books lookup ${result.ok === false ? 'completed with warnings' : 'succeeded'} with ${resultCount} result${resultCount === 1 ? '' : 's'}.${key}${statusCode}${duration}${cache}${error}`
                }));
            })
            .catch((err: unknown) => {
                if (abortController?.signal.aborted) {
                    debugPluginSettingsSave('integration test aborted', {
                        origin: 'abort',
                        service: 'googleBooks'
                    });
                    return;
                }

                setIntegrationTestMessages(previous => ({
                    ...previous,
                    googleBooks: `Google Books test failed: ${getErrorMessage(err)}`
                }));
            })
            .finally(() => {
                delete integrationTestRequestRef.current.googleBooks;
                delete integrationTestAbortRef.current.googleBooks;
                setIntegrationTesting(previous => ({ ...previous, googleBooks: false }));
            });

        integrationTestRequestRef.current.googleBooks = testRequest;
    }, [googleBooksSettingsDraft.googleBooksApiKeyConfigured, googleBooksSettingsDraft.maxResults]);

    const testTmdbConnection = useCallback(() => {
        if (integrationTestRequestRef.current.tmdb) {
            debugPluginSettingsSave('integration test deduped', {
                origin: 'click',
                service: 'tmdb'
            });
            return;
        }

        const pluginApi = getCurrentPtvPluginApiClient();

        if (!pluginApi?.testTmdbMetadata) {
            setIntegrationTestMessages(previous => ({
                ...previous,
                tmdb: 'TMDb test endpoint is unavailable.'
            }));
            return;
        }

        const abortController = createDashboardAbortController();
        const hasUnsavedToken = Boolean(sanitizeTmdbCredentialInput(tmdbTokenInput));

        if (abortController) {
            integrationTestAbortRef.current.tmdb = abortController;
        }

        setIntegrationTesting(previous => ({ ...previous, tmdb: true }));
        setIntegrationTestMessages(previous => ({ ...previous, tmdb: 'Testing TMDb credential...' }));
        debugPluginSettingsSave('integration test triggered', {
            origin: 'click',
            service: 'tmdb'
        });

        const testRequest = pluginApi.testTmdbMetadata<PtvTmdbMetadataStatus>({
            signal: abortController?.signal
        })
            .then(result => {
                setPluginState(previousState => ({
                    ...previousState,
                    status: previousState.status ?
                        {
                            ...previousState.status,
                            tmdbMetadata: result,
                            tmdbMetadataStatus: result
                        } :
                        previousState.status
                }));

                const statusCode = result.lastStatusCode ? ` HTTP ${result.lastStatusCode}.` : '';
                const credentialStatus = result.credentialStatus || (result.configured ? 'unknown' : 'missing');
                const expectation = getTmdbCredentialExpectation(result);
                const tmdbErrorBody = result.lastErrorBody ? ` TMDb said: ${result.lastErrorBody}` : '';
                const fallbackMessage = `TMDb credential status: ${credentialStatus}.${statusCode}`;
                const message = result.credentialStatus === 'valid' ?
                    `TMDb credential validated successfully. ${expectation}` :
                    `${result.lastError || fallbackMessage} ${expectation}${tmdbErrorBody}`;
                const saveHint = hasUnsavedToken ? ' Save TMDB settings before testing the new token.' : '';

                setIntegrationTestMessages(previous => ({ ...previous, tmdb: `${message}${saveHint}` }));
            })
            .catch((err: unknown) => {
                if (abortController?.signal.aborted) {
                    debugPluginSettingsSave('integration test aborted', {
                        origin: 'abort',
                        service: 'tmdb'
                    });
                    return;
                }

                setIntegrationTestMessages(previous => ({
                    ...previous,
                    tmdb: `TMDb test failed: ${getErrorMessage(err)}`
                }));
            })
            .finally(() => {
                delete integrationTestRequestRef.current.tmdb;
                delete integrationTestAbortRef.current.tmdb;
                setIntegrationTesting(previous => ({ ...previous, tmdb: false }));
            });

        integrationTestRequestRef.current.tmdb = testRequest;
    }, [tmdbTokenInput]);

    const saveSeerrSettings = useCallback(() => {
        void savePluginSettings({
            seerrSettings: createSeerrSettingsPayload(seerrSettingsDraft, seerrApiKeyInput)
        }, 'seerrSettings', 'Jellyseerr settings saved.');
    }, [savePluginSettings, seerrApiKeyInput, seerrSettingsDraft]);

    const saveArrSettings = useCallback(() => {
        void savePluginSettings({
            arrSettings: createArrSettingsPayload(arrSettingsDraft, arrApiKeyInputs)
        }, 'arrSettings', '*Arr integration settings saved.');
    }, [arrApiKeyInputs, arrSettingsDraft, savePluginSettings]);

    const saveArrServiceSettings = useCallback((serviceName: keyof PtvArrSettingsDto) => {
        void savePluginSettings({
            arrSettings: createArrSettingsPayload(arrSettingsDraft, arrApiKeyInputs)
        }, 'arrSettings', `${serviceName} integration settings saved.`);
    }, [arrApiKeyInputs, arrSettingsDraft, savePluginSettings]);

    const saveDownloadSettings = useCallback(() => {
        const nextSettings = normalizePluginSettings({
            downloadSettings: downloadSettingsDraft
        });
        const downloadSettings: Partial<PtvDownloadSettingsDto> = {
            enabled: nextSettings.downloadSettings.enabled,
            externalUrl: nextSettings.downloadSettings.externalUrl,
            internalUrl: nextSettings.downloadSettings.internalUrl,
            provider: nextSettings.downloadSettings.provider
        };
        const username = downloadCredentialInputs.username.trim();
        const password = downloadCredentialInputs.password.trim();

        if (username) {
            downloadSettings.username = username;
        }

        if (password) {
            downloadSettings.password = password;
        }

        void savePluginSettings({
            downloadSettings
        }, 'downloadSettings', 'Download settings saved.');
    }, [downloadCredentialInputs.password, downloadCredentialInputs.username, downloadSettingsDraft, savePluginSettings]);

    const handleHeroEnabledChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setFeatureSettingsDraft(previousSettings => ({ ...previousSettings, heroEnabled: event.target.checked }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleHomeRowsEnabledChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setFeatureSettingsDraft(previousSettings => ({ ...previousSettings, homeRowsEnabled: event.target.checked }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleRecommendedRowsChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setRowSettingsDraft(previousSettings => ({ ...previousSettings, enableRecommendedRows: event.target.checked }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleDynamicBackdropsEnabledChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setFeatureSettingsDraft(previousSettings => ({ ...previousSettings, dynamicBackdropsEnabled: event.target.checked }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleTvLowPowerModeEnabledChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setFeatureSettingsDraft(previousSettings => ({ ...previousSettings, tvLowPowerModeEnabled: event.target.checked }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handlePlaybackModeChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setFeatureSettingsDraft(previousSettings => ({
            ...previousSettings,
            playbackMode: normalizePtvPlaybackMode(event.target.value)
        }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleDebugModeEnabledChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setFeatureSettingsDraft(previousSettings => ({ ...previousSettings, debugModeEnabled: event.target.checked }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleHeroAutoRotateChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setHeroSettingsDraft(previousSettings => ({ ...previousSettings, heroAutoRotateEnabled: event.target.checked }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleHeroRotationSecondsChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setHeroSettingsDraft(previousSettings => ({ ...previousSettings, heroRotationSeconds: Number(event.target.value || 0) }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleHeroMaxItemsChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setHeroSettingsDraft(previousSettings => ({ ...previousSettings, heroMaxItems: Number(event.target.value || 0) }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleHeroBackdropMaxWidthChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setHeroSettingsDraft(previousSettings => ({ ...previousSettings, heroBackdropMaxWidth: Number(event.target.value || 0) }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleHeroLogoMaxWidthChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setHeroSettingsDraft(previousSettings => ({ ...previousSettings, heroLogoMaxWidth: Number(event.target.value || 0) }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleMaxCachePayloadBytesChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setPerformanceSettingsDraft(previousSettings => ({ ...previousSettings, maxCachePayloadBytes: Number(event.target.value || 0) }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleImagePreloadLimitChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setPerformanceSettingsDraft(previousSettings => ({ ...previousSettings, imagePreloadLimit: Number(event.target.value || 0) }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleAnimatedRowsChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setPerformanceSettingsDraft(previousSettings => ({ ...previousSettings, enableAnimatedRows: event.target.checked }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleBackdropBlurChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setPerformanceSettingsDraft(previousSettings => ({ ...previousSettings, enableBackdropBlur: event.target.checked }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleLowPowerDisableBlurChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setPerformanceSettingsDraft(previousSettings => ({ ...previousSettings, lowPowerDisableBlur: event.target.checked }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleLowPowerDisableAnimationsChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setPerformanceSettingsDraft(previousSettings => ({ ...previousSettings, lowPowerDisableAnimations: event.target.checked }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleTmdbEnabledChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setTmdbSettingsDraft(previousSettings => ({ ...previousSettings, tmdbEnabled: event.target.checked }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleTmdbRowAccuracyChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setTmdbSettingsDraft(previousSettings => ({ ...previousSettings, useTmdbForRowAccuracy: event.target.checked }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleTmdbLanguageChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setTmdbSettingsDraft(previousSettings => ({ ...previousSettings, tmdbLanguage: event.target.value }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleTmdbRegionChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setTmdbSettingsDraft(previousSettings => ({ ...previousSettings, tmdbRegion: event.target.value }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleTmdbTokenInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setTmdbTokenInput(event.target.value);
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleMusicBrainzEnabledChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setMusicMetadataSettingsDraft(previousSettings => ({ ...previousSettings, musicBrainzEnabled: event.target.checked }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleDiscogsEnabledChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setMusicMetadataSettingsDraft(previousSettings => ({ ...previousSettings, discogsEnabled: event.target.checked }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleMusicMetadataMaxResultsChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setMusicMetadataSettingsDraft(previousSettings => ({ ...previousSettings, maxResults: Number(event.target.value || 0) }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleDiscogsTokenInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setDiscogsTokenInput(event.target.value);
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleGoogleBooksEnabledChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setGoogleBooksSettingsDraft(previousSettings => ({ ...previousSettings, googleBooksEnabled: event.target.checked }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleGoogleBooksMaxResultsChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setGoogleBooksSettingsDraft(previousSettings => ({ ...previousSettings, maxResults: Number(event.target.value || 0) }));
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const handleGoogleBooksApiKeyInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setGoogleBooksApiKeyInput(event.target.value);
        setSettingsDirty(true);
    }, [setSettingsDirty]);

    const testSeerrConnection = useCallback(() => {
        if (integrationTestRequestRef.current.seerr) {
            debugPluginSettingsSave('integration test deduped', {
                origin: 'click',
                service: 'seerr'
            });
            return;
        }

        const pluginApi = getCurrentPtvPluginApiClient();

        if (!pluginApi?.testSeerr) {
            setIntegrationTestMessages(previous => ({
                ...previous,
                seerr: 'Jellyseerr test endpoint is unavailable.'
            }));
            return;
        }

        const testPayload = createSeerrSettingsPayload(seerrSettingsDraft, seerrApiKeyInput);
        const apiKey = seerrApiKeyInput.trim();
        const abortController = createDashboardAbortController();

        if (abortController) {
            integrationTestAbortRef.current.seerr = abortController;
        }

        setIntegrationTesting(previous => ({ ...previous, seerr: true }));
        setIntegrationTestMessages(previous => ({ ...previous, seerr: 'Testing Jellyseerr connection...' }));
        debugPluginSettingsSave('integration test triggered', {
            origin: 'click',
            payload: testPayload,
            service: 'seerr'
        });

        const testRequest = pluginApi.testSeerr<Record<string, unknown>, Partial<PtvSeerrSettingsDto>>(testPayload, {
            signal: abortController?.signal
        })
            .then(result => {
                const { message, ok } = getIntegrationTestResultMessage('Jellyseerr', result || {});
                const saveHint = ok && apiKey ? ' Save Jellyseerr settings to store this token.' : '';

                setIntegrationTestMessages(previous => ({ ...previous, seerr: `${message}${saveHint}` }));
            })
            .catch((err: unknown) => {
                if (abortController?.signal.aborted) {
                    debugPluginSettingsSave('integration test aborted', {
                        origin: 'abort',
                        service: 'seerr'
                    });
                    return;
                }

                setIntegrationTestMessages(previous => ({
                    ...previous,
                    seerr: `Jellyseerr test failed: ${getErrorMessage(err)}`
                }));
            })
            .finally(() => {
                delete integrationTestRequestRef.current.seerr;
                delete integrationTestAbortRef.current.seerr;
                setIntegrationTesting(previous => ({ ...previous, seerr: false }));
            });

        integrationTestRequestRef.current.seerr = testRequest;
    }, [seerrApiKeyInput, seerrSettingsDraft]);

    const testArrConnection = useCallback((serviceName: keyof PtvArrSettingsDto) => {
        if (integrationTestRequestRef.current[serviceName]) {
            debugPluginSettingsSave('integration test deduped', {
                origin: 'click',
                service: serviceName
            });
            return;
        }

        const pluginApi = getCurrentPtvPluginApiClient();

        if (!pluginApi?.testArrService) {
            setIntegrationTestMessages(previous => ({
                ...previous,
                [serviceName]: '*Arr test endpoint is unavailable.'
            }));
            return;
        }

        const testPayload = createArrServiceSettingsPayload(arrSettingsDraft, arrApiKeyInputs, serviceName);
        const apiKey = arrApiKeyInputs[serviceName]?.trim();
        const abortController = createDashboardAbortController();

        if (abortController) {
            integrationTestAbortRef.current[serviceName] = abortController;
        }

        setIntegrationTesting(previous => ({ ...previous, [serviceName]: true }));
        setIntegrationTestMessages(previous => ({ ...previous, [serviceName]: `Testing ${serviceName} connection...` }));
        debugPluginSettingsSave('integration test triggered', {
            origin: 'click',
            payload: testPayload,
            service: serviceName
        });

        const testRequest = pluginApi.testArrService<Record<string, unknown>, Partial<PtvArrServiceSettingsDto>>(serviceName, testPayload, {
            signal: abortController?.signal
        })
            .then(result => {
                const { message, ok } = getIntegrationTestResultMessage(serviceName, result || {});
                const saveHint = ok && apiKey ? ` Save ${serviceName} to store this token.` : '';

                setIntegrationTestMessages(previous => ({ ...previous, [serviceName]: `${message}${saveHint}` }));
            })
            .catch((err: unknown) => {
                if (abortController?.signal.aborted) {
                    debugPluginSettingsSave('integration test aborted', {
                        origin: 'abort',
                        service: serviceName
                    });
                    return;
                }

                setIntegrationTestMessages(previous => ({
                    ...previous,
                    [serviceName]: `${serviceName} test failed: ${getErrorMessage(err)}`
                }));
            })
            .finally(() => {
                delete integrationTestRequestRef.current[serviceName];
                delete integrationTestAbortRef.current[serviceName];
                setIntegrationTesting(previous => ({ ...previous, [serviceName]: false }));
            });

        integrationTestRequestRef.current[serviceName] = testRequest;
    }, [arrApiKeyInputs, arrSettingsDraft]);

    const saveRefreshInterval = useCallback(() => {
        const hours = Number(refreshIntervalHours || cacheSettingsDraft.refreshIntervalHours);

        if (!Number.isFinite(hours) || hours < 1) {
            setStatusMessage('Refresh interval must be at least 1 hour.');
            return;
        }

        const normalizedHours = clampNumber(
            hours,
            ...PTV_SETTINGS_LIMITS.cacheRefreshHours
        );
        setRefreshIntervalHours(String(normalizedHours));
        setCacheSettingsDraft({ refreshIntervalHours: normalizedHours });

        void savePluginSettings({
            cache: {
                refreshIntervalHours: normalizedHours
            }
        }, 'refreshInterval', `Refresh interval saved at ${normalizedHours} hour${normalizedHours === 1 ? '' : 's'}.`);
    }, [cacheSettingsDraft.refreshIntervalHours, refreshIntervalHours, savePluginSettings]);

    const handleRefreshIntervalChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setRefreshIntervalHours(event.target.value);
        setCacheSettingsDraft({ refreshIntervalHours: Number(event.target.value || 0) });
        setSettingsDirty(true);
    }, [setSettingsDirty]);

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

    const getMergedDebugReport = useCallback((report?: unknown, overrides: {
        cacheStatus?: ReturnType<typeof getFeaturedContentCacheStatus>;
        pluginApi?: ReturnType<typeof getPtvPluginApiDiagnostics>;
    } = {}) => mergeDashboardDebugReport({
        cacheStatus: overrides.cacheStatus || cacheStatus,
        clientProfile,
        debugEnabled,
        performanceProfile,
        persistedRecommendationRows,
        pluginApi: overrides.pluginApi || getPtvPluginApiDiagnostics(),
        pluginState,
        report: report || getPtvGlobal()?.debug?.report?.() || getPtvDebugReport()
    }), [
        cacheStatus,
        clientProfile,
        debugEnabled,
        performanceProfile,
        persistedRecommendationRows,
        pluginState
    ]);

    const runDebugReport = useCallback(() => {
        const report = getMergedDebugReport();

        setDebugReport(report);
        setPerformanceReport(getPerformanceSnapshot());

        if (isDebugLoggingEnabled()) {
            console.info('[PTV Debug Report]', report);
        }
    }, [getMergedDebugReport]);

    const buildDebugSnapshot = useCallback(() => {
        const liveCacheStatus = getFeaturedContentCacheStatus();
        const livePluginApi = getPtvPluginApiDiagnostics();
        const liveDebugReport = getMergedDebugReport(debugReport, {
            cacheStatus: liveCacheStatus,
            pluginApi: livePluginApi
        });

        return JSON.stringify({
            cacheStatus: liveCacheStatus,
            clientProfile,
            debugReport: liveDebugReport,
            debugState: getDashboardDebugState(liveDebugReport, pluginState, liveCacheStatus, debugEnabled),
            featureSettings,
            performanceReport: getPerformanceSnapshot(),
            persistedRecommendationRows,
            pluginApi: livePluginApi,
            pluginState,
            sectionSources: getNestedRecord(liveDebugReport, 'sectionSources'),
            source: 'dashboard-live-merged',
            signup: pluginState.status?.signup || null,
            timestamp: new Date().toISOString()
        }, null, 2);
    }, [clientProfile, debugEnabled, debugReport, featureSettings, getMergedDebugReport, persistedRecommendationRows, pluginState]);

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
        const report = getMergedDebugReport(debugReport);

        copyTextToClipboard(JSON.stringify(report, null, 2))
            .then(() => {
                setStatusMessage('Debug report copied.');
            })
            .catch((err: unknown) => {
                setStatusMessage(`Debug report copy failed: ${getErrorMessage(err)}`);
            });
    }, [debugReport, getMergedDebugReport]);

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
        if (!initialHydrationStartedRef.current) {
            initialHydrationStartedRef.current = true;
            void refreshPluginStatus();
            void loadPluginSettings({
                hydrateDrafts: true,
                origin: 'dashboard mount'
            });
        }

        syncCacheStatus();
        syncPerformanceReport();

        const handleCacheUpdate = () => {
            syncCacheStatus();
            syncPerformanceReport();
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
        const handleVisibilityChange = () => {
            if (document.hidden) return;

            syncCacheStatus();
            syncPerformanceReport();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener(FEATURED_CACHE_UPDATED_EVENT, handleCacheUpdate);
        window.addEventListener('ptv:debug:change', handleDebugChange);
        window.addEventListener(PTV_FEATURE_SETTINGS_CHANGE_EVENT, handleFeatureSettingsChange);

        return () => {
            Object.values(integrationTestAbortRef.current).forEach(controller => {
                controller?.abort();
            });
            integrationTestAbortRef.current = {};
            integrationTestRequestRef.current = {};
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener(FEATURED_CACHE_UPDATED_EVENT, handleCacheUpdate);
            window.removeEventListener('ptv:debug:change', handleDebugChange);
            window.removeEventListener(PTV_FEATURE_SETTINGS_CHANGE_EVENT, handleFeatureSettingsChange);
        };
    // The dashboard bootstraps plugin settings once; explicit reloads go through save/reset handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (pluginState.loading) return undefined;

        const timeoutId = window.setTimeout(() => {
            setDebugReport(getMergedDebugReport());
            setPerformanceReport(getPerformanceSnapshot());
        }, 0);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [
        cacheStatus.createdAt,
        cacheStatus.heroCount,
        cacheStatus.itemCount,
        cacheStatus.storage,
        getMergedDebugReport,
        pluginState.connected,
        pluginState.connectionState,
        pluginState.loading
    ]);

    const pluginStatus = pluginState.status;
    const tmdbMetadataStatus = getTmdbMetadataStatus(pluginStatus);
    const tmdbMetadataWarning = getTmdbMetadataWarning(tmdbMetadataStatus);
    const pluginApiDiagnostics = getPtvPluginApiDiagnostics();
    const pluginFeaturedStatus = pluginStatus?.featuredContent;
    const cacheSource = getDashboardCacheSource(cacheStatus, pluginStatus);
    const cacheFreshness = getDashboardCacheFreshness(cacheStatus, pluginStatus);
    const backendRefreshActive = Boolean(pluginStatus?.refreshInProgress && !hasUsableFeaturedCache(pluginStatus));
    const isCacheRefreshing = featuredRefreshState === 'refreshing' || isRefreshing || backendRefreshActive;
    const pluginConnectionState = getEffectivePluginConnectionState(
        pluginState.connected,
        cacheSource,
        pluginState.connectionState
    );
    const statusLabel = getPluginStateLabel(pluginConnectionState);
    const pluginHelpMessage = getPluginHelpMessage(pluginConnectionState, pluginStatus, cacheSource);
    const statusError = pluginStatus?.lastRefreshError || pluginStatus?.cacheWriteError || cacheStatus.lastRefreshError || cacheStatus.writeError || pluginState.error;
    const attemptedPluginApiUrl = pluginApiDiagnostics.resolvedUrl || pluginApiDiagnostics.attemptedUrl;
    const statusPluginApiUrl = getPtvPluginApiResolvedUrl() || attemptedPluginApiUrl;
    const pluginVersion = pluginStatus?.pluginVersion || pluginStatus?.version || 'n/a';
    const pluginName = pluginStatus?.pluginName || pluginStatus?.name || 'PiggieTV';
    const createdAt = cacheStatus.createdAt || pluginFeaturedStatus?.createdAt || pluginStatus?.featuredCacheCreatedAt;
    const expiresAt = cacheStatus.expiresAt || pluginFeaturedStatus?.expiresAt || pluginStatus?.featuredCacheExpiresAt;
    const nextRefreshAt = pluginStatus?.nextRefreshAt || expiresAt;
    const heroCount = cacheStatus.heroCount || pluginFeaturedStatus?.heroCount || 0;
    const itemCount = cacheStatus.itemCount || pluginFeaturedStatus?.itemCount || 0;
    const sectionCount = cacheStatus.sectionCount || pluginFeaturedStatus?.sectionCount || 0;
    const lastRefreshDurationMs = pluginStatus?.lastRefreshDurationMs || cacheStatus.lastRefreshDurationMs;
    const mergedDebugReport = getMergedDebugReport(debugReport || getPtvDebugReport());
    const dashboardDebugState = getDashboardDebugState(mergedDebugReport, pluginState, cacheStatus, debugEnabled);
    const dashboardDebugMessage = getDashboardDebugStateMessage(dashboardDebugState, mergedDebugReport, pluginState);
    const debugSectionSources = getNestedRecord(mergedDebugReport, 'sectionSources');
    const debugRecommendations = getNestedRecord(mergedDebugReport, 'recommendations');
    const recommendationEngineLoaded = getNestedBoolean(debugRecommendations, 'recommendationEngineLoaded') === true;
    const performanceDebug = getNestedRecord(performanceReport, 'debug') || mergedDebugReport;
    const imageManagerMetrics = getNestedRecord(performanceReport, 'imageManager');
    const currentFps = getNumberValue(performanceReport, 'currentFps');
    const averageFps = getNumberValue(performanceReport, 'averageFps');
    const droppedFrames = getNumberValue(performanceReport, 'droppedFrameCount');
    const longTaskCount = getNumberValue(performanceReport, 'longTaskCount');
    const longTaskTotalMs = getNumberValue(performanceReport, 'longTaskTotalMs');
    const largestLongTaskMs = getNumberValue(performanceReport, 'largestLongTaskMs');
    const activeImageRequests = getNumberValue(imageManagerMetrics, 'activeRequests');
    const queuedImageRequests = getNumberValue(imageManagerMetrics, 'queuedRequests');
    const imageCacheHits = getNumberValue(imageManagerMetrics, 'cacheHits');
    const imageCacheMisses = getNumberValue(imageManagerMetrics, 'cacheMisses');
    const imageDedupeHits = getNumberValue(imageManagerMetrics, 'dedupeHits');
    const imageFailedSuppressions = getNumberValue(imageManagerMetrics, 'failedImageSuppressions');
    const debugReportText = mergedDebugReport ? JSON.stringify(mergedDebugReport, null, 2) : '';
    const canEditPluginSettings = pluginState.connected && pluginStatus?.canWriteFeaturedContent !== false;
    const settingsActionDisabled = settingsSaving || settingsLoading || !canEditPluginSettings || !pluginSettings;

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
                        <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap sx={{ mt: 1 }}>
                            <Button href={PTV_ROW_BUILDER_HASH} onClick={openPtvRowBuilder} variant='outlined' className='ptv-button'>
                                Open Row Builder
                            </Button>
                            <Button href={PTV_RECOMMENDATIONS_HASH} onClick={openPtvRecommendations} variant='outlined' className='ptv-button'>
                                Open Recommendations
                            </Button>
                        </Stack>
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
                                                color={getPluginStatusChipColor(pluginState)}
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
                                            attemptedUrl={attemptedPluginApiUrl}
                                            onCopy={copyPluginInstallNote}
                                            state={pluginConnectionState}
                                        />
                                        <Divider />
                                        <Stack className='ptv-dashboard-status-list' spacing={0.5}>
                                            <Typography>Plugin: {pluginName}</Typography>
                                            <Typography>Plugin version: {pluginVersion}</Typography>
                                            <Typography>API endpoint: {statusPluginApiUrl || 'n/a'}</Typography>
                                            <Typography>Connection state: {pluginState.connectionState}</Typography>
                                            <Typography>Server UTC: {pluginStatus?.serverTimeUtc || 'n/a'}</Typography>
                                            <Typography>Cache path exists: {String(pluginStatus?.cachePathExists ?? false)}</Typography>
                                            <Typography>Cache path writable: {String(pluginStatus?.cachePathWritable ?? false)}</Typography>
                                            <Typography>Featured cache exists: {String(pluginStatus?.featuredCacheExists ?? false)}</Typography>
                                            <Typography>Cache storage mode: {cacheSource}</Typography>
                                            <Typography>Cache payload: {formatBytes(pluginStatus?.cachePayloadBytes)}</Typography>
                                            <Typography>Max payload: {formatBytes(pluginStatus?.maxCachePayloadBytes)}</Typography>
                                            <Typography>Refresh in progress: {String(pluginStatus?.refreshInProgress ?? false)}</Typography>
                                            <Typography>settingsAvailable: {String(pluginStatus?.settingsAvailable ?? false)}</Typography>
                                            <Typography>canReadFeaturedContent: {String(pluginStatus?.canReadFeaturedContent ?? false)}</Typography>
                                            <Typography>canWriteFeaturedContent: {String(pluginStatus?.canWriteFeaturedContent ?? false)}</Typography>
                                            <Typography>Signup enabled: {String(pluginStatus?.signup?.enabled ?? false)}</Typography>
                                            <Typography>Signup email configured: {String(pluginStatus?.signup?.emailConfigured ?? false)}</Typography>
                                            <Typography>Signup pending verify/reset: {pluginStatus?.signup?.pendingVerificationCount ?? 0}/{pluginStatus?.signup?.pendingResetCount ?? 0}</Typography>
                                        </Stack>
                                        <WarningAlert message={pluginStatus?.cacheWriteError ? `Cache write error: ${pluginStatus.cacheWriteError}` : ''} />
                                        <Button
                                            type='button'
                                            variant='outlined'
                                            onClick={refreshPluginStatus}
                                            disabled={pluginState.loading}
                                        >
                                            {pluginState.connected ? getRefreshStatusButtonLabel(pluginState.loading) : 'Retry Connection'}
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
                                        <Stack
                                            direction={{ xs: 'column', sm: 'row' }}
                                            spacing={1.5}
                                            alignItems={{ xs: 'stretch', sm: 'center' }}
                                        >
                                            <TextField
                                                className='ptv-featured-cache-interval-field'
                                                slotProps={{
                                                    htmlInput: {
                                                        max: formatIntervalHours(PTV_CACHE.maxFeaturedContentTtlMs),
                                                        min: formatIntervalHours(PTV_CACHE.minFeaturedContentTtlMs),
                                                        step: 1
                                                    }
                                                }}
                                                label='Refresh interval'
                                                onChange={handleRefreshIntervalChange}
                                                size='small'
                                                type='number'
                                                value={refreshIntervalHours}
                                            />
                                            <Typography color='text.secondary'>hours</Typography>
                                            <Button
                                                type='button'
                                                variant='outlined'
                                                onClick={saveRefreshInterval}
                                                disabled={settingsActionDisabled || (pluginState.connected && pluginStatus?.canWriteFeaturedContent === false)}
                                            >
                                                {settingsSavingSection === 'refreshInterval' ? 'Saving...' : 'Save Interval'}
                                            </Button>
                                        </Stack>
                                        <Grid container spacing={1.5}>
                                            <Grid size={{ xs: 12, sm: 6 }}>
                                                <Typography>Source: {cacheSource}</Typography>
                                                <Typography>Stored on plugin: {String(pluginStatus?.featuredCacheExists ?? cacheStatus.isStored)}</Typography>
                                                <Typography>Memory fallback: {String(cacheSource === 'memory')}</Typography>
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
                                                <Typography>Last write failure: {pluginStatus?.cacheWriteError || cacheStatus.writeError || 'none'}</Typography>
                                            </Grid>
                                        </Grid>
                                        <WarningAlert message={statusError ? `Last error: ${statusError}` : ''} />
                                        <WarningAlert message={pluginStatus?.lastRefreshWarning ? `Warning: ${pluginStatus.lastRefreshWarning}` : ''} />
                                        <WarningAlert message={tmdbMetadataWarning} />
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
                                            <Stack direction='row' spacing={1} flexWrap='wrap' justifyContent='flex-end'>
                                                <Chip
                                                    className='ptv-live-status-chip'
                                                    color={getDashboardDebugStateColor(dashboardDebugState)}
                                                    label={dashboardDebugState}
                                                    size='small'
                                                />
                                                <Chip
                                                    className='ptv-render-profile-badge'
                                                    data-ptv-render-profile={performanceProfile.renderProfile.id}
                                                    label={performanceProfile.renderProfile.id}
                                                    size='small'
                                                />
                                            </Stack>
                                        </Stack>
                                        <Divider />
                                        <Alert severity={getDashboardDebugAlertSeverity(dashboardDebugState)}>
                                            {dashboardDebugMessage}
                                        </Alert>
                                        <Box className='ptv-badge-row'>
                                            <Chip className='ptv-status-badge ptv-status-badge-info' label={`client: ${clientProfile.kind}`} size='small' />
                                            <Chip className='ptv-status-badge ptv-status-badge-backend' label={`cache: ${getCacheTimingLabel(performanceDebug)}`} size='small' />
                                            <Chip className='ptv-status-badge ptv-status-badge-info' label={`persisted rec rows: ${persistedRecommendationRows}`} size='small' />
                                        </Box>
                                        <Stack className='ptv-dashboard-status-list' spacing={0.5}>
                                            <Typography>Debug state: {dashboardDebugState}</Typography>
                                            <Typography>Debug collector active: {String(getNestedBoolean(mergedDebugReport, 'active') === true)}</Typography>
                                            <Typography>Runtime connected: {String(pluginState.connected)}</Typography>
                                            <Typography>Plugin state source: {getDebugSectionSourceText(debugSectionSources, 'pluginState')}</Typography>
                                            <Typography>Plugin API source: {getDebugSectionSourceText(debugSectionSources, 'pluginApi')}</Typography>
                                            <Typography>Cache source: {getDebugSectionSourceText(debugSectionSources, 'cache')}</Typography>
                                            <Typography>Client profile source: {getDebugSectionSourceText(debugSectionSources, 'clientProfile')}</Typography>
                                            <Typography>Render profile source: {getDebugSectionSourceText(debugSectionSources, 'renderProfile')}</Typography>
                                            <Typography>Shell source: {getDebugSectionSourceText(debugSectionSources, 'shell')}</Typography>
                                            <Typography>Recommendation engine loaded: {String(recommendationEngineLoaded)}</Typography>
                                            <Typography>Persisted recommendation rows: {persistedRecommendationRows}</Typography>
                                        </Stack>
                                        <Typography>Render profile: {performanceProfile.renderProfile.id}</Typography>
                                        <Typography>Client profile: {clientProfile.kind}</Typography>
                                        <Typography>
                                            Flags: fireTv={String(clientProfile.isFireTv)}, webOs={String(clientProfile.isWebOs)}, tv={String(clientProfile.isTv)}, mobile={String(clientProfile.isMobile)}, lowPower={String(performanceProfile.isLowPower)}
                                        </Typography>
                                        <Typography>FPS: {getFpsLabel(currentFps, averageFps)}</Typography>
                                        <Typography>Dropped frames: {droppedFrames ?? 'n/a'}</Typography>
                                        <Typography>Long tasks: {longTaskCount ?? 0} ({formatDuration(longTaskTotalMs)}, largest {formatDuration(largestLongTaskMs)})</Typography>
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
                                        {debugEnabled || debugReport ? (
                                            <DebugReportPreview text={debugReportText} />
                                        ) : (
                                            <Typography color='text.secondary'>Enable PTV_DEBUG to collect detailed event history. Live plugin, cache, profile, and persisted recommendation state is shown above.</Typography>
                                        )}
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 6 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={2}>
                                        <Stack direction='row' justifyContent='space-between' alignItems='center' flexWrap='wrap' gap={1}>
                                            <Typography variant='h2'>Music Metadata</Typography>
                                            <Chip
                                                className='ptv-status-badge ptv-status-badge-info'
                                                label={getDiscogsCredentialLabel(musicMetadataSettingsDraft, discogsTokenInput)}
                                                size='small'
                                            />
                                        </Stack>
                                        <Divider />
                                        <WarningAlert message={integrationTestMessages.discogs || ''} />
                                        <Stack className='ptv-dashboard-status-list' spacing={0.5}>
                                            <Typography>MusicBrainz enabled: {String(musicMetadataSettingsDraft.musicBrainzEnabled)}</Typography>
                                            <Typography>Discogs enabled: {String(musicMetadataSettingsDraft.discogsEnabled)}</Typography>
                                            <Typography>Discogs token configured: {String(musicMetadataSettingsDraft.discogsTokenConfigured)}</Typography>
                                            <Typography>Lookup candidates per provider: {musicMetadataSettingsDraft.maxResults}</Typography>
                                        </Stack>
                                        <FormControlLabel
                                            control={<Switch checked={musicMetadataSettingsDraft.musicBrainzEnabled} disabled={settingsActionDisabled} onChange={handleMusicBrainzEnabledChange} />}
                                            label='Enable MusicBrainz'
                                        />
                                        <FormControlLabel
                                            control={<Switch checked={musicMetadataSettingsDraft.discogsEnabled} disabled={settingsActionDisabled} onChange={handleDiscogsEnabledChange} />}
                                            label='Enable Discogs'
                                        />
                                        <TextField
                                            label='Lookup results per provider'
                                            size='small'
                                            type='number'
                                            value={musicMetadataSettingsDraft.maxResults}
                                            disabled={settingsActionDisabled}
                                            slotProps={{ htmlInput: { min: PTV_SETTINGS_LIMITS.musicMetadataResults[0], max: PTV_SETTINGS_LIMITS.musicMetadataResults[1] } }}
                                            onChange={handleMusicMetadataMaxResultsChange}
                                        />
                                        <TextField
                                            label='Discogs personal access token'
                                            size='small'
                                            type='password'
                                            value={discogsTokenInput}
                                            disabled={settingsActionDisabled}
                                            placeholder={musicMetadataSettingsDraft.discogsTokenConfigured ? 'Token configured - enter a new token to replace it' : 'Paste Discogs token'}
                                            onChange={handleDiscogsTokenInputChange}
                                            autoComplete='off'
                                        />
                                        <Typography variant='body2' color='text.secondary'>
                                            MusicBrainz works without a token. Discogs requires a personal access token and is called only from the PiggieTV backend.
                                        </Typography>
                                        <Stack direction='row' spacing={1.5} flexWrap='wrap' useFlexGap>
                                            <Button
                                                type='button'
                                                variant='contained'
                                                onClick={saveMusicMetadataSettings}
                                                disabled={settingsActionDisabled}
                                            >
                                                {settingsSavingSection === 'musicMetadataSettings' ? 'Saving...' : 'Save Music Metadata Settings'}
                                            </Button>
                                        </Stack>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 6 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={2}>
                                        <Stack direction='row' justifyContent='space-between' alignItems='center' flexWrap='wrap' gap={1}>
                                            <Typography variant='h2'>Google Books Metadata</Typography>
                                            <Chip
                                                className='ptv-status-badge ptv-status-badge-info'
                                                label={getGoogleBooksCredentialLabel(googleBooksSettingsDraft, googleBooksApiKeyInput)}
                                                size='small'
                                            />
                                        </Stack>
                                        <Divider />
                                        <WarningAlert message={integrationTestMessages.googleBooks || ''} />
                                        <Stack className='ptv-dashboard-status-list' spacing={0.5}>
                                            <Typography>Google Books enabled: {String(googleBooksSettingsDraft.googleBooksEnabled)}</Typography>
                                            <Typography>API key configured: {String(googleBooksSettingsDraft.googleBooksApiKeyConfigured)}</Typography>
                                            <Typography>Lookup candidates per search: {googleBooksSettingsDraft.maxResults}</Typography>
                                        </Stack>
                                        <FormControlLabel
                                            control={<Switch checked={googleBooksSettingsDraft.googleBooksEnabled} disabled={settingsActionDisabled} onChange={handleGoogleBooksEnabledChange} />}
                                            label='Enable Google Books'
                                        />
                                        <TextField
                                            label='Lookup results per search'
                                            size='small'
                                            type='number'
                                            value={googleBooksSettingsDraft.maxResults}
                                            disabled={settingsActionDisabled}
                                            slotProps={{ htmlInput: { min: PTV_SETTINGS_LIMITS.googleBooksMetadataResults[0], max: PTV_SETTINGS_LIMITS.googleBooksMetadataResults[1] } }}
                                            onChange={handleGoogleBooksMaxResultsChange}
                                        />
                                        <TextField
                                            label='Google Books API key'
                                            size='small'
                                            type='password'
                                            value={googleBooksApiKeyInput}
                                            disabled={settingsActionDisabled}
                                            placeholder={googleBooksSettingsDraft.googleBooksApiKeyConfigured ? 'Key configured - enter a new key to replace it' : 'Optional Google Books API key'}
                                            onChange={handleGoogleBooksApiKeyInputChange}
                                            autoComplete='off'
                                        />
                                        <Typography variant='body2' color='text.secondary'>
                                            Google Books can run without a key. Add a restricted API key for higher quota; PiggieTV stores it only in the server plugin settings and never returns it to the browser.
                                        </Typography>
                                        <Stack direction='row' spacing={1.5} flexWrap='wrap' useFlexGap>
                                            <Button
                                                type='button'
                                                variant='contained'
                                                onClick={saveGoogleBooksSettings}
                                                disabled={settingsActionDisabled}
                                            >
                                                {settingsSavingSection === 'googleBooksSettings' ? 'Saving...' : 'Save Google Books Settings'}
                                            </Button>
                                            <Button
                                                type='button'
                                                variant='outlined'
                                                color='warning'
                                                onClick={clearGoogleBooksApiKey}
                                                disabled={settingsActionDisabled || (!googleBooksSettingsDraft.googleBooksApiKeyConfigured && !googleBooksApiKeyInput)}
                                            >
                                                Clear API Key
                                            </Button>
                                            <Button
                                                type='button'
                                                variant='outlined'
                                                onClick={testGoogleBooksConnection}
                                                disabled={settingsActionDisabled || Boolean(integrationTesting.googleBooks)}
                                            >
                                                {integrationTesting.googleBooks ? 'Testing...' : 'Test Google Books Connection'}
                                            </Button>
                                            <Button
                                                component='a'
                                                href='https://developers.google.com/books/docs/v1/getting_started'
                                                target='_blank'
                                                rel='noreferrer'
                                                type='button'
                                                variant='outlined'
                                            >
                                                Google Books API Docs
                                            </Button>
                                        </Stack>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 6 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={2}>
                                        <Stack direction='row' justifyContent='space-between' alignItems='center' flexWrap='wrap' gap={1}>
                                            <Typography variant='h2'>Feature Toggles</Typography>
                                            <Chip
                                                className='ptv-status-badge ptv-status-badge-backend'
                                                label={settingsDirty ? 'unsaved' : 'saved'}
                                                size='small'
                                            />
                                        </Stack>
                                        <Divider />
                                        <FormControlLabel
                                            control={<Switch checked={featureSettingsDraft.heroEnabled} disabled={settingsActionDisabled} onChange={handleHeroEnabledChange} />}
                                            label='Hero enabled'
                                        />
                                        <FormControlLabel
                                            control={<Switch checked={featureSettingsDraft.homeRowsEnabled} disabled={settingsActionDisabled} onChange={handleHomeRowsEnabledChange} />}
                                            label='PTV home rows enabled'
                                        />
                                        <FormControlLabel
                                            control={<Switch checked={featureSettingsDraft.dynamicBackdropsEnabled} disabled={settingsActionDisabled} onChange={handleDynamicBackdropsEnabledChange} />}
                                            label='Dynamic backdrops enabled'
                                        />
                                        <FormControlLabel
                                            control={<Switch checked={featureSettingsDraft.tvLowPowerModeEnabled} disabled={settingsActionDisabled} onChange={handleTvLowPowerModeEnabledChange} />}
                                            label='TV low-power mode enabled'
                                        />
                                        <TextField
                                            select
                                            fullWidth
                                            helperText='Auto lets Jellyfin decide, Compatible favors stable H264/AAC playback, Performance favors direct play/direct stream.'
                                            label='PTV Playback Mode'
                                            value={featureSettingsDraft.playbackMode}
                                            onChange={handlePlaybackModeChange}
                                            disabled={settingsActionDisabled}
                                        >
                                            <MenuItem value='auto'>Auto</MenuItem>
                                            <MenuItem value='compatible'>Compatible</MenuItem>
                                            <MenuItem value='performance'>Performance</MenuItem>
                                        </TextField>
                                        <FormControlLabel
                                            control={<Switch checked={featureSettingsDraft.debugModeEnabled} disabled={settingsActionDisabled} onChange={handleDebugModeEnabledChange} />}
                                            label='Debug mode enabled'
                                        />
                                        <Stack direction='row' spacing={1.5} flexWrap='wrap' useFlexGap>
                                            <Button
                                                type='button'
                                                variant='contained'
                                                onClick={saveFeatureSettings}
                                                disabled={settingsActionDisabled}
                                            >
                                                {settingsSavingSection === 'featureSettings' ? 'Saving...' : 'Save Feature Toggles'}
                                            </Button>
                                            <Button
                                                type='button'
                                                variant='outlined'
                                                color='warning'
                                                onClick={resetPluginSettings}
                                                disabled={settingsResetting || !canEditPluginSettings}
                                            >
                                                {settingsResetting ? 'Resetting...' : 'Reset Defaults'}
                                            </Button>
                                        </Stack>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 6 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={2}>
                                        <Typography variant='h2'>Hero Settings</Typography>
                                        <Divider />
                                        <FormControlLabel
                                            control={<Switch checked={heroSettingsDraft.heroAutoRotateEnabled} disabled={settingsActionDisabled} onChange={handleHeroAutoRotateChange} />}
                                            label='Auto rotate enabled'
                                        />
                                        <Box className='ptv-settings-field-grid'>
                                            <TextField
                                                label='Rotation seconds'
                                                size='small'
                                                type='number'
                                                value={heroSettingsDraft.heroRotationSeconds}
                                                disabled={settingsActionDisabled}
                                                onChange={handleHeroRotationSecondsChange}
                                                slotProps={{ htmlInput: { min: 5, max: 120, step: 1 } }}
                                            />
                                            <TextField
                                                label='Max hero items'
                                                size='small'
                                                type='number'
                                                value={heroSettingsDraft.heroMaxItems}
                                                disabled={settingsActionDisabled}
                                                onChange={handleHeroMaxItemsChange}
                                                slotProps={{ htmlInput: { min: 1, max: 50, step: 1 } }}
                                            />
                                            <TextField
                                                label='Backdrop max width'
                                                size='small'
                                                type='number'
                                                value={heroSettingsDraft.heroBackdropMaxWidth}
                                                disabled={settingsActionDisabled}
                                                onChange={handleHeroBackdropMaxWidthChange}
                                                slotProps={{ htmlInput: { min: 480, max: 3840, step: 40 } }}
                                            />
                                            <TextField
                                                label='Logo max width'
                                                size='small'
                                                type='number'
                                                value={heroSettingsDraft.heroLogoMaxWidth}
                                                disabled={settingsActionDisabled}
                                                onChange={handleHeroLogoMaxWidthChange}
                                                slotProps={{ htmlInput: { min: 160, max: 1600, step: 20 } }}
                                            />
                                        </Box>
                                        <Button
                                            type='button'
                                            variant='contained'
                                            onClick={saveHeroSettings}
                                            disabled={settingsActionDisabled}
                                        >
                                            {settingsSavingSection === 'heroSettings' ? 'Saving...' : 'Save Hero Settings'}
                                        </Button>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 6 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={2}>
                                        <Typography variant='h2'>Rows</Typography>
                                        <Divider />
                                        <Typography variant='body2' color='text.secondary'>
                                            Row categories, random generation, recommendation rows, preview, and diagnostics live in the dedicated Row Builder.
                                        </Typography>
                                        <FormControlLabel
                                            control={<Switch checked={rowSettingsDraft.enableRecommendedRows} disabled={settingsActionDisabled} onChange={handleRecommendedRowsChange} />}
                                            label='Recommendation rows'
                                        />
                                        <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                                            <Button href={PTV_ROW_BUILDER_HASH} onClick={openPtvRowBuilder} type='button' variant='contained'>
                                                Open Row Builder
                                            </Button>
                                            <Button href={PTV_RECOMMENDATIONS_HASH} onClick={openPtvRecommendations} type='button' variant='outlined'>
                                                Open Recommendations
                                            </Button>
                                            <Button
                                                type='button'
                                                variant='outlined'
                                                onClick={saveRowSettings}
                                                disabled={settingsActionDisabled}
                                            >
                                                {settingsSavingSection === 'rowSettings' ? 'Saving...' : 'Save Row Settings'}
                                            </Button>
                                        </Stack>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 6 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={2}>
                                        <Typography variant='h2'>Performance</Typography>
                                        <Divider />
                                        <Box className='ptv-settings-field-grid'>
                                            <TextField
                                                label='Max cache payload bytes'
                                                size='small'
                                                type='number'
                                                value={performanceSettingsDraft.maxCachePayloadBytes}
                                                disabled={settingsActionDisabled}
                                                onChange={handleMaxCachePayloadBytesChange}
                                                slotProps={{ htmlInput: { min: 1048576, max: 52428800, step: 262144 } }}
                                            />
                                            <TextField
                                                label='Image preload limit'
                                                size='small'
                                                type='number'
                                                value={performanceSettingsDraft.imagePreloadLimit}
                                                disabled={settingsActionDisabled}
                                                onChange={handleImagePreloadLimitChange}
                                                slotProps={{ htmlInput: { min: 1, max: 10, step: 1 } }}
                                            />
                                        </Box>
                                        <FormControlLabel
                                            control={<Switch checked={performanceSettingsDraft.enableAnimatedRows} disabled={settingsActionDisabled} onChange={handleAnimatedRowsChange} />}
                                            label='Animated rows'
                                        />
                                        <FormControlLabel
                                            control={<Switch checked={performanceSettingsDraft.enableBackdropBlur} disabled={settingsActionDisabled} onChange={handleBackdropBlurChange} />}
                                            label='Backdrop blur'
                                        />
                                        <FormControlLabel
                                            control={<Switch checked={performanceSettingsDraft.lowPowerDisableBlur} disabled={settingsActionDisabled} onChange={handleLowPowerDisableBlurChange} />}
                                            label='Low power disables blur'
                                        />
                                        <FormControlLabel
                                            control={<Switch checked={performanceSettingsDraft.lowPowerDisableAnimations} disabled={settingsActionDisabled} onChange={handleLowPowerDisableAnimationsChange} />}
                                            label='Low power disables animations'
                                        />
                                        <Button
                                            type='button'
                                            variant='contained'
                                            onClick={savePerformanceSettings}
                                            disabled={settingsActionDisabled}
                                        >
                                            {settingsSavingSection === 'performanceSettings' ? 'Saving...' : 'Save Performance Settings'}
                                        </Button>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 6 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={2}>
                                        <Stack direction='row' justifyContent='space-between' alignItems='center' flexWrap='wrap' gap={1}>
                                            <Typography variant='h2'>TMDB Settings</Typography>
                                            <Chip
                                                className='ptv-status-badge ptv-status-badge-info'
                                                label={getTmdbCredentialLabel(tmdbMetadataStatus, tmdbSettingsDraft)}
                                                size='small'
                                            />
                                        </Stack>
                                        <Divider />
                                        <WarningAlert message={tmdbMetadataWarning} />
                                        <WarningAlert message={integrationTestMessages.tmdb || ''} />
                                        <Stack className='ptv-dashboard-status-list' spacing={0.5}>
                                            <Typography>Metadata enabled: {String(tmdbMetadataStatus?.enabled ?? tmdbSettingsDraft.tmdbEnabled)}</Typography>
                                            <Typography>Credential configured: {String(tmdbMetadataStatus?.configured ?? tmdbSettingsDraft.tmdbApiTokenConfigured)}</Typography>
                                            <Typography>Credential status: {tmdbMetadataStatus?.credentialStatus || 'not tested'}</Typography>
                                            <Typography>Credential type: {tmdbMetadataStatus?.credentialType || 'not detected'}</Typography>
                                            <Typography>Credential length: {tmdbMetadataStatus?.credentialLength ?? 'n/a'}</Typography>
                                            <Typography>Last TMDb status code: {tmdbMetadataStatus?.lastStatusCode ?? 'n/a'}</Typography>
                                            <Typography>Last validated: {formatDateTimeString(tmdbMetadataStatus?.lastValidatedAt)}</Typography>
                                            <Typography>Cache hits: {tmdbMetadataStatus?.cacheHits ?? 0}</Typography>
                                            <Typography>Cache misses: {tmdbMetadataStatus?.cacheMisses ?? 0}</Typography>
                                            <Typography>Negative cache: {tmdbMetadataStatus?.negativeCacheSize ?? 0} entries / {tmdbMetadataStatus?.negativeCacheHits ?? 0} hits / {tmdbMetadataStatus?.negativeCacheWrites ?? 0} writes</Typography>
                                            <Typography>Last TMDb duration: {formatDuration(tmdbMetadataStatus?.lastDurationMs)}</Typography>
                                            <Typography>Last TMDb error: {tmdbMetadataStatus?.lastError || 'none'}</Typography>
                                            <Typography>Last TMDb error body: {tmdbMetadataStatus?.lastErrorBody || 'none'}</Typography>
                                        </Stack>
                                        <FormControlLabel
                                            control={<Switch checked={tmdbSettingsDraft.tmdbEnabled} disabled={settingsActionDisabled} onChange={handleTmdbEnabledChange} />}
                                            label='Enable TMDB'
                                        />
                                        <FormControlLabel
                                            control={<Switch checked={tmdbSettingsDraft.useTmdbForRowAccuracy} disabled={settingsActionDisabled} onChange={handleTmdbRowAccuracyChange} />}
                                            label='Use TMDB for row accuracy'
                                        />
                                        <Box className='ptv-settings-field-grid'>
                                            <TextField
                                                label='Language'
                                                size='small'
                                                value={tmdbSettingsDraft.tmdbLanguage}
                                                disabled={settingsActionDisabled}
                                                onChange={handleTmdbLanguageChange}
                                            />
                                            <TextField
                                                label='Region'
                                                size='small'
                                                value={tmdbSettingsDraft.tmdbRegion}
                                                disabled={settingsActionDisabled}
                                                onChange={handleTmdbRegionChange}
                                            />
                                        </Box>
                                        <TextField
                                            label='TMDB API token'
                                            size='small'
                                            type='password'
                                            value={tmdbTokenInput}
                                            disabled={settingsActionDisabled}
                                            placeholder={tmdbSettingsDraft.tmdbApiTokenConfigured ? 'Token configured - enter a new token to replace it' : 'Paste TMDB read access token'}
                                            onChange={handleTmdbTokenInputChange}
                                            autoComplete='off'
                                        />
                                        <Typography variant='body2' color='text.secondary'>
                                            Paste a TMDb v4 Read Access Token when possible. Legacy v3 API keys are only used when the saved value looks like a 32-character hex key. You can paste with or without &quot;Bearer&quot;; whitespace and newlines are removed before saving.
                                        </Typography>
                                        <Typography variant='body2' color='text.secondary'>
                                            {getTmdbCredentialExpectation(tmdbMetadataStatus)}
                                        </Typography>
                                        <Stack direction='row' spacing={1.5} flexWrap='wrap' useFlexGap>
                                            <Button
                                                type='button'
                                                variant='contained'
                                                onClick={saveTmdbSettings}
                                                disabled={settingsActionDisabled}
                                            >
                                                {settingsSavingSection === 'tmdbSettings' ? 'Saving...' : 'Save TMDB Settings'}
                                            </Button>
                                            <Button
                                                type='button'
                                                variant='outlined'
                                                onClick={testTmdbConnection}
                                                disabled={settingsActionDisabled || Boolean(integrationTesting.tmdb)}
                                            >
                                                {integrationTesting.tmdb ? 'Testing...' : 'Test TMDB Connection'}
                                            </Button>
                                        </Stack>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 6 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={2}>
                                        <Stack direction='row' justifyContent='space-between' alignItems='center' flexWrap='wrap' gap={1}>
                                            <Typography variant='h2'>Jellyseerr</Typography>
                                            <Chip
                                                className='ptv-status-badge ptv-status-badge-info'
                                                label={seerrSettingsDraft.apiKeyConfigured ? 'Token configured' : 'No token'}
                                                size='small'
                                            />
                                        </Stack>
                                        <Divider />
                                        <FormControlLabel
                                            control={(
                                                <Switch
                                                    checked={seerrSettingsDraft.enabled}
                                                    disabled={settingsActionDisabled}
                                                    onChange={event => {
                                                        setSeerrSettingsDraft(previous => ({ ...previous, enabled: event.target.checked }));
                                                        setSettingsDirty(true);
                                                    }}
                                                />
                                            )}
                                            label='Enable Jellyseerr'
                                        />
                                        <Box className='ptv-settings-field-grid'>
                                            <TextField
                                                label='Display name'
                                                size='small'
                                                value={seerrSettingsDraft.displayName}
                                                disabled={settingsActionDisabled}
                                                onChange={event => {
                                                    setSeerrSettingsDraft(previous => ({ ...previous, displayName: event.target.value }));
                                                    setSettingsDirty(true);
                                                }}
                                            />
                                            <TextField
                                                label='Internal URL'
                                                size='small'
                                                value={seerrSettingsDraft.internalUrl}
                                                disabled={settingsActionDisabled}
                                                onChange={event => {
                                                    setSeerrSettingsDraft(previous => ({ ...previous, internalUrl: event.target.value }));
                                                    setSettingsDirty(true);
                                                }}
                                            />
                                            <TextField
                                                label='External URL'
                                                size='small'
                                                value={seerrSettingsDraft.externalUrl}
                                                disabled={settingsActionDisabled}
                                                onChange={event => {
                                                    setSeerrSettingsDraft(previous => ({ ...previous, externalUrl: event.target.value }));
                                                    setSettingsDirty(true);
                                                }}
                                            />
                                        </Box>
                                        <TextField
                                            label='Jellyseerr API key'
                                            size='small'
                                            type='password'
                                            value={seerrApiKeyInput}
                                            disabled={settingsActionDisabled}
                                            placeholder={seerrSettingsDraft.apiKeyConfigured ? 'Token configured - enter a new key to replace it' : 'Paste Jellyseerr API key'}
                                            onChange={event => {
                                                setSeerrApiKeyInput(event.target.value);
                                                setSettingsDirty(true);
                                            }}
                                            autoComplete='off'
                                        />
                                        <FormControlLabel
                                            control={(
                                                <Switch
                                                    checked={seerrSettingsDraft.enableSearchIntegration}
                                                    disabled={settingsActionDisabled}
                                                    onChange={event => {
                                                        setSeerrSettingsDraft(previous => ({ ...previous, enableSearchIntegration: event.target.checked }));
                                                        setSettingsDirty(true);
                                                    }}
                                                />
                                            )}
                                            label='Search integration'
                                        />
                                        <FormControlLabel
                                            control={(
                                                <Switch
                                                    checked={seerrSettingsDraft.enableRequestsPage}
                                                    disabled={settingsActionDisabled}
                                                    onChange={event => {
                                                        setSeerrSettingsDraft(previous => ({ ...previous, enableRequestsPage: event.target.checked }));
                                                        setSettingsDirty(true);
                                                    }}
                                                />
                                            )}
                                            label='Requests page'
                                        />
                                        <FormControlLabel
                                            control={(
                                                <Switch
                                                    checked={seerrSettingsDraft.enableAutoRequest}
                                                    disabled={settingsActionDisabled}
                                                    onChange={event => {
                                                        setSeerrSettingsDraft(previous => ({ ...previous, enableAutoRequest: event.target.checked }));
                                                        setSettingsDirty(true);
                                                    }}
                                                />
                                            )}
                                            label='Auto-request'
                                        />
                                        <Stack direction='row' spacing={1.5} flexWrap='wrap' useFlexGap>
                                            <Button type='button' variant='contained' onClick={saveSeerrSettings} disabled={settingsActionDisabled}>
                                                {settingsSavingSection === 'seerrSettings' ? 'Saving...' : 'Save Jellyseerr Settings'}
                                            </Button>
                                            <Button type='button' variant='outlined' onClick={testSeerrConnection} disabled={settingsActionDisabled || Boolean(integrationTesting.seerr)}>
                                                {integrationTesting.seerr ? 'Testing...' : 'Test Connection'}
                                            </Button>
                                            <Button type='button' variant='outlined' href={seerrSettingsDraft.externalUrl} target='_blank' rel='noreferrer'>
                                                Open Jellyseerr
                                            </Button>
                                        </Stack>
                                        <WarningAlert message={integrationTestMessages.seerr || ''} />
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 6 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={2}>
                                        <Typography variant='h2'>*Arr Integrations</Typography>
                                        <Divider />
                                        <Alert severity={arrCalendarReady ? 'success' : 'info'}>
                                            {arrCalendarReady ?
                                                'Calendar is enabled automatically for configured Sonarr, Radarr, and Lidarr services.' :
                                                'Save a Sonarr, Radarr, or Lidarr API key to enable the PiggieTV calendar.'}
                                        </Alert>
                                        {ARR_SERVICE_NAMES.map(serviceName => {
                                            const service = arrSettingsDraft[serviceName];

                                            return (
                                                <Box key={serviceName} className='ptv-dashboard-card ptv-control-card-compact'>
                                                    <Stack spacing={1.25}>
                                                        <Stack direction='row' justifyContent='space-between' alignItems='center' flexWrap='wrap' gap={1}>
                                                            <FormControlLabel
                                                                control={(
                                                                    <Switch
                                                                        checked={service.enabled}
                                                                        disabled={settingsActionDisabled}
                                                                        onChange={event => {
                                                                            setArrSettingsDraft(previous => ({
                                                                                ...previous,
                                                                                [serviceName]: {
                                                                                    ...previous[serviceName],
                                                                                    enabled: event.target.checked
                                                                                }
                                                                            }));
                                                                            setSettingsDirty(true);
                                                                        }}
                                                                    />
                                                                )}
                                                                label={serviceName}
                                                            />
                                                            <Chip
                                                                className='ptv-status-badge ptv-status-badge-info'
                                                                label={getApiTokenBadgeLabel(service, arrApiKeyInputs[serviceName])}
                                                                size='small'
                                                            />
                                                        </Stack>
                                                        <Box className='ptv-settings-field-grid'>
                                                            <TextField
                                                                label='Internal URL'
                                                                size='small'
                                                                value={service.internalUrl}
                                                                disabled={settingsActionDisabled}
                                                                onChange={event => {
                                                                    setArrSettingsDraft(previous => ({
                                                                        ...previous,
                                                                        [serviceName]: {
                                                                            ...previous[serviceName],
                                                                            internalUrl: event.target.value
                                                                        }
                                                                    }));
                                                                    setSettingsDirty(true);
                                                                }}
                                                            />
                                                            <TextField
                                                                label='External URL'
                                                                size='small'
                                                                value={service.externalUrl}
                                                                disabled={settingsActionDisabled}
                                                                onChange={event => {
                                                                    setArrSettingsDraft(previous => ({
                                                                        ...previous,
                                                                        [serviceName]: {
                                                                            ...previous[serviceName],
                                                                            externalUrl: event.target.value
                                                                        }
                                                                    }));
                                                                    setSettingsDirty(true);
                                                                }}
                                                            />
                                                        </Box>
                                                        <TextField
                                                            label={`${serviceName} API key`}
                                                            size='small'
                                                            type='password'
                                                            value={arrApiKeyInputs[serviceName]}
                                                            disabled={settingsActionDisabled}
                                                            placeholder={service.apiKeyConfigured ? 'Token configured - enter a new key to replace it' : 'Paste API key'}
                                                            onChange={event => {
                                                                setArrApiKeyInputs(previous => ({ ...previous, [serviceName]: event.target.value }));
                                                                setSettingsDirty(true);
                                                            }}
                                                            autoComplete='off'
                                                        />
                                                        <Button
                                                            type='button'
                                                            variant='outlined'
                                                            onClick={() => testArrConnection(serviceName)}
                                                            disabled={settingsActionDisabled || Boolean(integrationTesting[serviceName])}
                                                        >
                                                            {integrationTesting[serviceName] ? 'Testing...' : `Test ${serviceName}`}
                                                        </Button>
                                                        <Button
                                                            type='button'
                                                            variant='contained'
                                                            onClick={() => saveArrServiceSettings(serviceName)}
                                                            disabled={settingsActionDisabled}
                                                        >
                                                            {settingsSavingSection === 'arrSettings' ? 'Saving...' : `Save ${serviceName}`}
                                                        </Button>
                                                        <WarningAlert message={integrationTestMessages[serviceName] || ''} />
                                                    </Stack>
                                                </Box>
                                            );
                                        })}
                                        <Button type='button' variant='contained' onClick={saveArrSettings} disabled={settingsActionDisabled}>
                                            {settingsSavingSection === 'arrSettings' ? 'Saving...' : 'Save *Arr Settings'}
                                        </Button>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 6 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={2}>
                                        <Typography variant='h2'>Downloads</Typography>
                                        <Divider />
                                        <FormControlLabel
                                            control={(
                                                <Switch
                                                    checked={downloadSettingsDraft.enabled}
                                                    disabled={settingsActionDisabled}
                                                    onChange={event => {
                                                        setDownloadSettingsDraft(previous => ({ ...previous, enabled: event.target.checked }));
                                                        setSettingsDirty(true);
                                                    }}
                                                />
                                            )}
                                            label='Enable qBittorrent'
                                        />
                                        <Box className='ptv-settings-field-grid'>
                                            <TextField
                                                label='Provider'
                                                size='small'
                                                value={downloadSettingsDraft.provider}
                                                disabled={settingsActionDisabled}
                                                onChange={event => {
                                                    setDownloadSettingsDraft(previous => ({ ...previous, provider: event.target.value }));
                                                    setSettingsDirty(true);
                                                }}
                                            />
                                            <TextField
                                                label='Internal URL'
                                                size='small'
                                                value={downloadSettingsDraft.internalUrl}
                                                disabled={settingsActionDisabled}
                                                onChange={event => {
                                                    setDownloadSettingsDraft(previous => ({ ...previous, internalUrl: event.target.value }));
                                                    setSettingsDirty(true);
                                                }}
                                            />
                                            <TextField
                                                label='External URL'
                                                size='small'
                                                value={downloadSettingsDraft.externalUrl}
                                                disabled={settingsActionDisabled}
                                                onChange={event => {
                                                    setDownloadSettingsDraft(previous => ({ ...previous, externalUrl: event.target.value }));
                                                    setSettingsDirty(true);
                                                }}
                                            />
                                            <TextField
                                                label='Username'
                                                size='small'
                                                value={downloadCredentialInputs.username}
                                                disabled={settingsActionDisabled}
                                                placeholder={downloadSettingsDraft.usernameConfigured ? 'Username configured' : 'Optional username'}
                                                onChange={event => setDownloadCredentialInputs(previous => ({ ...previous, username: event.target.value }))}
                                            />
                                            <TextField
                                                label='Password'
                                                size='small'
                                                type='password'
                                                value={downloadCredentialInputs.password}
                                                disabled={settingsActionDisabled}
                                                placeholder={downloadSettingsDraft.passwordConfigured ? 'Password configured' : 'Optional password'}
                                                onChange={event => setDownloadCredentialInputs(previous => ({ ...previous, password: event.target.value }))}
                                                autoComplete='off'
                                            />
                                        </Box>
                                        <Button type='button' variant='contained' onClick={saveDownloadSettings} disabled={settingsActionDisabled}>
                                            {settingsSavingSection === 'downloadSettings' ? 'Saving...' : 'Save Download Settings'}
                                        </Button>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 6 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={2}>
                                        <Typography variant='h2'>Tag Rows</Typography>
                                        <Divider />
                                        <Typography variant='body2' color='text.secondary'>
                                            Tag/search based rows are configured as Row Builder categories with source type Custom Tag/Search.
                                        </Typography>
                                        <Button href={PTV_ROW_BUILDER_HASH} onClick={openPtvRowBuilder} type='button' variant='contained'>
                                            Open Row Builder
                                        </Button>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 6 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={2}>
                                        <Typography variant='h2'>Random Rows</Typography>
                                        <Divider />
                                        <Typography variant='body2' color='text.secondary'>
                                            Random row generation is now category based. Choose media type, source type, and row count in Row Builder.
                                        </Typography>
                                        <Button href={PTV_ROW_BUILDER_HASH} onClick={openPtvRowBuilder} type='button' variant='contained'>
                                            Open Row Builder
                                        </Button>
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

/* eslint-enable react/jsx-no-bind */

export default PiggieTvDashboardPage;
