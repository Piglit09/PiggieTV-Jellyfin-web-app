import { PTV_CACHE, PTV_PLUGIN_API, PTV_RUNTIME } from './config';

export type PtvBuildCompatibility =
    | 'capability-upgrade-required'
    | 'compatible'
    | 'plugin-unavailable'
    | 'unknown'
    | 'version-mismatch';

export type PtvPluginCapabilityCompatibility =
    | 'available'
    | 'unknown'
    | 'upgrade-required';

export type PtvPluginBuildStatus = {
    apiVersion?: number;
    cacheVersion?: number;
    featuredContent?: {
        cacheVersion?: number;
    };
    featureFlags?: Record<string, boolean>;
    features?: Record<string, boolean> | string[];
    pluginVersion?: string;
    version?: string;
};

export type PtvBuildInfo = {
    cacheSchemaVersion: number;
    compatibility: PtvBuildCompatibility;
    compatibilityMessage: string;
    environment: 'development' | 'production' | 'unknown';
    frontendBuildDate: string;
    frontendBuildId: string;
    frontendCommitSha: string;
    jellyfinWebVersion: string;
    pluginApiVersion: number | 'unknown';
    pluginVersion: string;
    readingSeriesOverrides: PtvPluginCapabilityCompatibility;
};

type PtvBuildInfoOverrides = Partial<Pick<
    PtvBuildInfo,
    'environment' | 'frontendBuildDate' | 'frontendBuildId' | 'frontendCommitSha' | 'jellyfinWebVersion'
>> & {
    pluginConnected?: boolean;
};

const SAFE_BUILD_VALUE = /^[0-9A-Za-z][0-9A-Za-z._+:/-]{0,95}$/;

function safeBuildValue(value: unknown, fallback = 'unknown') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized && SAFE_BUILD_VALUE.test(normalized) ? normalized : fallback;
}

function safeBuildDate(value: unknown, fallback = 'unavailable') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized && !Number.isNaN(Date.parse(normalized)) ? normalized : fallback;
}

function readCompileTimeValues() {
    const fallbackLabel = PTV_RUNTIME.mode === 'development' ? 'development-fallback' : 'unavailable';

    return {
        environment: typeof __PTV_BUILD_MODE__ === 'string' ? __PTV_BUILD_MODE__ : PTV_RUNTIME.mode,
        fallbackLabel,
        frontendBuildDate: typeof __PTV_BUILD_DATE__ === 'string' ? __PTV_BUILD_DATE__ : fallbackLabel,
        frontendBuildId: typeof __PTV_BUILD_ID__ === 'string' ? __PTV_BUILD_ID__ : fallbackLabel,
        frontendCommitSha: typeof __COMMIT_SHA__ === 'string' ? __COMMIT_SHA__ : fallbackLabel,
        jellyfinWebVersion: typeof __PACKAGE_JSON_VERSION__ === 'string' ? __PACKAGE_JSON_VERSION__ : fallbackLabel
    };
}

function getVersionParts(value: string) {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value);
    return match ? match.slice(1, 4).map(Number) : null;
}

export function classifyPtvPluginCapability(
    pluginStatus: PtvPluginBuildStatus | null | undefined,
    capability: string
): PtvPluginCapabilityCompatibility {
    if (!pluginStatus) return 'unknown';

    const normalizedCapability = capability.toLowerCase();
    const featureFlag = Object.entries(pluginStatus.featureFlags || {})
        .find(([name]) => name.toLowerCase() === normalizedCapability)?.[1];

    if (typeof featureFlag === 'boolean') return featureFlag ? 'available' : 'upgrade-required';

    if (Array.isArray(pluginStatus.features)) {
        return pluginStatus.features.some(name => name.toLowerCase() === normalizedCapability) ?
            'available' :
            'upgrade-required';
    }

    const feature = Object.entries(pluginStatus.features || {})
        .find(([name]) => name.toLowerCase() === normalizedCapability)?.[1];

    return feature === true ? 'available' : 'upgrade-required';
}

export function classifyPtvBuildCompatibility(
    pluginStatus: PtvPluginBuildStatus | null | undefined,
    options: { jellyfinWebVersion?: string; pluginConnected?: boolean } = {}
): Pick<PtvBuildInfo, 'compatibility' | 'compatibilityMessage'> {
    if (options.pluginConnected === false) {
        return {
            compatibility: 'plugin-unavailable',
            compatibilityMessage: 'PiggieTV plugin status is unavailable.'
        };
    }

    if (!pluginStatus) {
        return {
            compatibility: 'unknown',
            compatibilityMessage: 'Compatibility has not been checked.'
        };
    }

    const pluginApiVersion = pluginStatus.apiVersion;
    const pluginCacheVersion = pluginStatus.cacheVersion ?? pluginStatus.featuredContent?.cacheVersion;

    if (typeof pluginApiVersion === 'number' && pluginApiVersion !== PTV_PLUGIN_API.version) {
        return {
            compatibility: 'version-mismatch',
            compatibilityMessage: `Plugin API v${pluginApiVersion} is incompatible with frontend API v${PTV_PLUGIN_API.version}.`
        };
    }

    if (typeof pluginCacheVersion === 'number' && pluginCacheVersion !== PTV_CACHE.featuredContentVersion) {
        return {
            compatibility: 'version-mismatch',
            compatibilityMessage: `Plugin cache schema v${pluginCacheVersion} is incompatible with frontend schema v${PTV_CACHE.featuredContentVersion}.`
        };
    }

    const pluginVersion = pluginStatus.pluginVersion || pluginStatus.version || '';
    const webParts = getVersionParts(options.jellyfinWebVersion || '');
    const pluginParts = getVersionParts(pluginVersion);

    if (webParts && pluginParts && (webParts[0] !== pluginParts[0] || webParts[1] !== pluginParts[1])) {
        return {
            compatibility: 'version-mismatch',
            compatibilityMessage: `Plugin ${pluginVersion} does not target the Jellyfin ${webParts[0]}.${webParts[1]} compatibility line.`
        };
    }

    if (classifyPtvPluginCapability(pluginStatus, 'readingSeriesOverrides') !== 'available') {
        return {
            compatibility: 'capability-upgrade-required',
            compatibilityMessage: 'Plugin connected, but an upgrade to PiggieTV 10.11.8.2 or newer is required for server-persisted Reading corrections.'
        };
    }

    return {
        compatibility: 'compatible',
        compatibilityMessage: 'Frontend, plugin API, cache schema, and Reading persistence capability are compatible.'
    };
}

export function getPtvBuildInfo(
    pluginStatus?: PtvPluginBuildStatus | null,
    overrides: PtvBuildInfoOverrides = {}
): PtvBuildInfo {
    const compileTime = readCompileTimeValues();
    const environment = overrides.environment || compileTime.environment;
    const jellyfinWebVersion = safeBuildValue(
        overrides.jellyfinWebVersion || compileTime.jellyfinWebVersion,
        compileTime.fallbackLabel
    );
    const compatibility = classifyPtvBuildCompatibility(pluginStatus, {
        jellyfinWebVersion,
        pluginConnected: overrides.pluginConnected
    });

    return {
        cacheSchemaVersion: PTV_CACHE.featuredContentVersion,
        ...compatibility,
        environment: environment === 'development' || environment === 'production' ? environment : 'unknown',
        frontendBuildDate: safeBuildDate(
            overrides.frontendBuildDate || compileTime.frontendBuildDate,
            compileTime.fallbackLabel
        ),
        frontendBuildId: safeBuildValue(
            overrides.frontendBuildId || compileTime.frontendBuildId,
            compileTime.fallbackLabel
        ),
        frontendCommitSha: safeBuildValue(
            overrides.frontendCommitSha || compileTime.frontendCommitSha,
            compileTime.fallbackLabel
        ),
        jellyfinWebVersion,
        pluginApiVersion: pluginStatus?.apiVersion ?? 'unknown',
        pluginVersion: safeBuildValue(pluginStatus?.pluginVersion || pluginStatus?.version),
        readingSeriesOverrides: classifyPtvPluginCapability(pluginStatus, 'readingSeriesOverrides')
    };
}

export function formatPtvBuildInfoCompact(buildInfo: PtvBuildInfo) {
    return [
        `frontend=${buildInfo.frontendBuildId}`,
        `commit=${buildInfo.frontendCommitSha}`,
        `web=${buildInfo.jellyfinWebVersion}`,
        `mode=${buildInfo.environment}`,
        `plugin=${buildInfo.pluginVersion}`,
        `api=${buildInfo.pluginApiVersion}`,
        `cache=${buildInfo.cacheSchemaVersion}`,
        `readingOverrides=${buildInfo.readingSeriesOverrides}`,
        `compatibility=${buildInfo.compatibility}`
    ].join('; ');
}
