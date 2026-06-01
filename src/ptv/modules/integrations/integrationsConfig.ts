import { PTV_SERVICES } from '../../core/config';
import { getCurrentPtvPluginApiClient } from '../../core/pluginApi';

type IntegrationServiceSettings = {
    apiKeyConfigured?: boolean;
    enabled?: boolean;
    externalUrl?: string;
    internalUrl?: string;
};

type SeerrSettings = IntegrationServiceSettings & {
    displayName?: string;
    enableRequestsPage?: boolean;
    enableSearchIntegration?: boolean;
    openExternalFallback?: boolean;
    openRequestsInPtv?: boolean;
};

type DownloadSettings = {
    enabled?: boolean;
    externalUrl?: string;
    internalUrl?: string;
    passwordConfigured?: boolean;
    provider?: string;
    usernameConfigured?: boolean;
};

type IntegrationSettingsResponse = {
    arrSettings?: Record<string, IntegrationServiceSettings | undefined>;
    downloadSettings?: DownloadSettings;
    seerrSettings?: SeerrSettings;
};

export type PtvIntegrationsSettings = {
    arr: Record<string, IntegrationServiceSettings>;
    downloads: DownloadSettings;
    seerr: Required<Pick<SeerrSettings,
        'displayName' |
        'enableRequestsPage' |
        'enableSearchIntegration' |
        'enabled' |
        'externalUrl' |
        'internalUrl' |
        'openExternalFallback' |
        'openRequestsInPtv'
    >> & {
        apiKeyConfigured: boolean;
    };
};

const SETTINGS_TTL_MS = 60 * 1000;
const DEFAULT_INTEGRATIONS: PtvIntegrationsSettings = {
    arr: {},
    downloads: {
        enabled: false,
        externalUrl: '',
        internalUrl: '',
        passwordConfigured: false,
        provider: 'qbittorrent',
        usernameConfigured: false
    },
    seerr: {
        apiKeyConfigured: false,
        displayName: 'Jellyseerr',
        enabled: true,
        enableRequestsPage: true,
        enableSearchIntegration: true,
        externalUrl: PTV_SERVICES.requestPortalUrl,
        internalUrl: '',
        openExternalFallback: true,
        openRequestsInPtv: true
    }
};

let settingsCache: {
    expiresAt: number;
    promise: Promise<PtvIntegrationsSettings> | null;
    settings: PtvIntegrationsSettings;
} = {
    expiresAt: 0,
    promise: null,
    settings: DEFAULT_INTEGRATIONS
};

function cleanUrl(value: unknown) {
    if (typeof value !== 'string') return '';

    let nextValue = value.trim();

    while (nextValue.endsWith('/')) {
        nextValue = nextValue.slice(0, -1);
    }

    return nextValue;
}

function normalizeService(service: IntegrationServiceSettings | undefined): IntegrationServiceSettings {
    return {
        apiKeyConfigured: Boolean(service?.apiKeyConfigured),
        enabled: Boolean(service?.enabled || service?.apiKeyConfigured),
        externalUrl: cleanUrl(service?.externalUrl),
        internalUrl: cleanUrl(service?.internalUrl)
    };
}

function normalizeSettings(settings: IntegrationSettingsResponse | null | undefined): PtvIntegrationsSettings {
    const seerr = settings?.seerrSettings || {};
    const arrSettings = settings?.arrSettings || {};
    const arr = Object.entries(arrSettings).reduce<Record<string, IntegrationServiceSettings>>((result, [key, service]) => {
        result[key.toLowerCase()] = normalizeService(service);

        return result;
    }, {});

    return {
        arr,
        downloads: {
            enabled: Boolean(settings?.downloadSettings?.enabled),
            externalUrl: cleanUrl(settings?.downloadSettings?.externalUrl),
            internalUrl: cleanUrl(settings?.downloadSettings?.internalUrl),
            passwordConfigured: Boolean(settings?.downloadSettings?.passwordConfigured),
            provider: typeof settings?.downloadSettings?.provider === 'string' ? settings.downloadSettings.provider : 'qbittorrent',
            usernameConfigured: Boolean(settings?.downloadSettings?.usernameConfigured)
        },
        seerr: {
            apiKeyConfigured: Boolean(seerr.apiKeyConfigured),
            displayName: seerr.displayName || DEFAULT_INTEGRATIONS.seerr.displayName,
            enabled: seerr.enabled !== false,
            enableRequestsPage: seerr.enableRequestsPage !== false,
            enableSearchIntegration: seerr.enableSearchIntegration !== false,
            externalUrl: cleanUrl(seerr.externalUrl) || DEFAULT_INTEGRATIONS.seerr.externalUrl,
            internalUrl: cleanUrl(seerr.internalUrl),
            openExternalFallback: seerr.openExternalFallback !== false,
            openRequestsInPtv: seerr.openRequestsInPtv !== false
        }
    };
}

export function clearPtvIntegrationSettingsCache() {
    settingsCache = {
        expiresAt: 0,
        promise: null,
        settings: DEFAULT_INTEGRATIONS
    };
}

export function getPtvIntegrationSettings(options: { force?: boolean } = {}) {
    const now = Date.now();

    if (!options.force && settingsCache.settings && settingsCache.expiresAt > now) {
        return Promise.resolve(settingsCache.settings);
    }

    if (!options.force && settingsCache.promise) {
        return settingsCache.promise;
    }

    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi?.getSettings) {
        return Promise.resolve(DEFAULT_INTEGRATIONS);
    }

    settingsCache.promise = pluginApi.getSettings<IntegrationSettingsResponse>()
        .then(settings => normalizeSettings(settings))
        .catch(() => DEFAULT_INTEGRATIONS)
        .then(settings => {
            settingsCache = {
                expiresAt: Date.now() + SETTINGS_TTL_MS,
                promise: null,
                settings
            };

            return settings;
        });

    return settingsCache.promise;
}

export async function getPtvRequestPortalUrl(query?: string) {
    const settings = await getPtvIntegrationSettings();
    const baseUrl = settings.seerr.externalUrl || PTV_SERVICES.requestPortalUrl;

    if (!query) return baseUrl;

    const separator = baseUrl.includes('?') ? '&' : '?';

    return `${baseUrl}${separator}search=${encodeURIComponent(query)}`;
}

export function getConfiguredServiceUrl(service: IntegrationServiceSettings | undefined) {
    return cleanUrl(service?.externalUrl) || cleanUrl(service?.internalUrl);
}
