import type { ConfigurationPageInfo } from '@jellyfin/sdk/lib/generated-client/models/configuration-page-info';
import type { PackageInfo } from '@jellyfin/sdk/lib/generated-client/models/package-info';
import type { PluginInfo } from '@jellyfin/sdk/lib/generated-client/models/plugin-info';
import type { RepositoryInfo } from '@jellyfin/sdk/lib/generated-client/models/repository-info';
import type { VersionInfo } from '@jellyfin/sdk/lib/generated-client/models/version-info';

import {
    AdminPluginsServiceError,
    PTV_PLUGIN_GUID,
    type PtvAdminInstalledPlugin,
    type PtvAdminPluginConfigurationPage,
    type PtvAdminPluginDetail,
    type PtvAdminPluginPackage,
    type PtvAdminPluginRepository,
    type PtvAdminPluginSource,
    type PtvAdminPluginStatus,
    type PtvAdminPluginVersion,
    type RawAdminPluginRepository
} from './adminPluginsModel';

const GUID_PATTERN = /^[0-9a-f]{32}$/;

function text(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cloneValue<T>(value: T): T {
    if (Array.isArray(value)) return value.map(item => cloneValue(item)) as T;
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([ key, item ]) => (
            [ key, cloneValue(item) ]
        ))) as T;
    }
    return value;
}

function comparableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(comparableValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .sort(([ left ], [ right ]) => left.localeCompare(right))
            .map(([ key, item ]) => [ key, comparableValue(item) ]));
    }
    return value;
}

/** Accepts dashed or compact GUIDs and returns Jellyfin's canonical API form. */
export function normalizeAdminPluginGuid(value: unknown) {
    const normalized = text(value)?.replace(/[{}-]/g, '').toLowerCase() || '';
    return GUID_PATTERN.test(normalized) ? normalized : null;
}

export function requireAdminPluginGuid(value: unknown) {
    const id = normalizeAdminPluginGuid(value);
    if (!id) {
        throw new AdminPluginsServiceError('invalid-input', 'Choose a valid plugin.');
    }
    return id;
}

function safeRemoteImageUrl(value: unknown) {
    const candidate = text(value);
    if (!candidate) return null;
    try {
        // URL is already required by the current Jellyfin browser runtime.
        // eslint-disable-next-line compat/compat
        const parsed = new URL(candidate);
        return (parsed.protocol === 'https:' || parsed.protocol === 'http:')
            && !parsed.username
            && !parsed.password ? parsed.href : null;
    } catch {
        return null;
    }
}

function normalizePluginStatus(value: unknown): Readonly<{
    label: string;
    status: PtvAdminPluginStatus;
    value: string | null;
}> {
    const statusValue = text(value);
    switch (statusValue) {
        case 'Active':
            return { label: 'Active', status: 'active', value: statusValue };
        case 'Restart':
            return { label: 'Pending Restart', status: 'restart', value: statusValue };
        case 'Deleted':
            return { label: 'Removal Pending', status: 'deleted', value: statusValue };
        case 'Superseded':
        case 'Superceded':
            return { label: 'Superseded', status: 'superseded', value: statusValue };
        case 'Malfunctioned':
            return { label: 'Malfunctioned', status: 'malfunctioned', value: statusValue };
        case 'NotSupported':
            return { label: 'Not Supported', status: 'not-supported', value: statusValue };
        case 'Disabled':
            return { label: 'Disabled', status: 'disabled', value: statusValue };
        default:
            return { label: 'Unknown', status: 'unknown', value: statusValue };
    }
}

function requireVersion(value: unknown, message = 'Plugin version information was incomplete.') {
    const version = text(value);
    if (!version) {
        throw new AdminPluginsServiceError('invalid-response', message);
    }
    return version;
}

export function normalizeAdminPluginVersion(raw: VersionInfo): PtvAdminPluginVersion {
    if (!raw || typeof raw !== 'object') {
        throw new AdminPluginsServiceError('invalid-response', 'Plugin version information could not be read.');
    }
    const version = requireVersion(raw.version);
    const repositoryUrl = text(raw.repositoryUrl);
    return {
        changelog: text(raw.changelog),
        key: `${version}\u0000${repositoryUrl || ''}`,
        repositoryName: text(raw.repositoryName),
        repositoryUrl,
        targetAbi: text(raw.targetAbi),
        timestamp: text(raw.timestamp),
        version,
        versionNumber: text(raw.VersionNumber) || version
    };
}

/**
 * `/Packages` is already compatibility filtered and server ordered. An update
 * exists only when the exact installed revision appears after a newer entry.
 * No client-side semantic or lexical version comparison is performed.
 */
export function findAdminPluginUpdateVersion(
    versions: readonly PtvAdminPluginVersion[],
    installedVersion: string | null | undefined
) {
    const exactVersion = text(installedVersion);
    if (!exactVersion) return null;
    const installedIndex = versions.findIndex(version => version.version === exactVersion);
    return installedIndex > 0 ? versions[0] : null;
}

function normalizePackageBase(raw: PackageInfo): PtvAdminPluginPackage {
    if (!raw || typeof raw !== 'object') {
        throw new AdminPluginsServiceError('invalid-response', 'Plugin catalog information could not be read.');
    }
    const id = normalizeAdminPluginGuid(raw.guid);
    const name = text(raw.name);
    if (!id || !name || !Array.isArray(raw.versions)) {
        throw new AdminPluginsServiceError('invalid-response', 'Plugin catalog information was incomplete.');
    }
    const versions = raw.versions.map(normalizeAdminPluginVersion);
    return {
        category: text(raw.category),
        description: text(raw.description),
        id,
        imageUrl: safeRemoteImageUrl(raw.imageUrl),
        installedVersion: null,
        isInstalled: false,
        isPiggieTv: id === PTV_PLUGIN_GUID,
        latestVersion: versions[0] || null,
        name,
        overview: text(raw.overview),
        owner: text(raw.owner),
        updateVersion: null,
        versions
    };
}

export function normalizeAdminPluginPackages(raw: readonly PackageInfo[]) {
    if (!Array.isArray(raw)) {
        throw new AdminPluginsServiceError('invalid-response', 'Plugin catalog information could not be loaded.');
    }
    return raw.map(normalizePackageBase);
}

function normalizeConfigurationPage(raw: ConfigurationPageInfo): PtvAdminPluginConfigurationPage | null {
    if (!raw || typeof raw !== 'object') return null;
    const pluginId = normalizeAdminPluginGuid(raw.PluginId);
    const name = text(raw.Name);
    if (!pluginId || !name) return null;
    return {
        displayName: text(raw.DisplayName) || name,
        enableInMainMenu: raw.EnableInMainMenu === true,
        href: `#/configurationpage?name=${encodeURIComponent(name)}`,
        menuIcon: text(raw.MenuIcon),
        menuSection: text(raw.MenuSection),
        name,
        pluginId
    };
}

export function normalizeAdminPluginConfigurationPages(raw: readonly ConfigurationPageInfo[]) {
    if (!Array.isArray(raw)) {
        throw new AdminPluginsServiceError('invalid-response', 'Plugin configuration links could not be loaded.');
    }
    return raw.map(normalizeConfigurationPage)
        .filter((page): page is PtvAdminPluginConfigurationPage => Boolean(page));
}

function pluginStatusPriority(status: PtvAdminPluginStatus) {
    switch (status) {
        case 'restart': return 0;
        case 'active': return 1;
        case 'disabled': return 2;
        case 'malfunctioned': return 3;
        case 'not-supported': return 4;
        case 'deleted': return 5;
        case 'superseded': return 6;
        default: return 7;
    }
}

export function findPrimaryAdminInstalledPlugin(
    installed: readonly PtvAdminInstalledPlugin[]
) {
    return [ ...installed ].sort((left, right) => (
        pluginStatusPriority(left.status) - pluginStatusPriority(right.status)
    ))[0] || null;
}

/**
 * Jellyfin can retain multiple revisions of one plugin across lifecycle states.
 * List surfaces expose one deterministic primary row per GUID while detail
 * surfaces keep the complete revision history.
 */
export function groupPrimaryAdminInstalledPlugins(
    installed: readonly PtvAdminInstalledPlugin[]
) {
    const revisionsById = new Map<string, PtvAdminInstalledPlugin[]>();
    installed.forEach(plugin => {
        const revisions = revisionsById.get(plugin.id) || [];
        revisions.push(plugin);
        revisionsById.set(plugin.id, revisions);
    });

    return [ ...revisionsById.values() ].map(revisions => (
        findPrimaryAdminInstalledPlugin(revisions)!
    ));
}

function getPluginSource(
    id: string,
    canUninstall: boolean,
    packageInfo: PtvAdminPluginPackage | null
): PtvAdminPluginSource {
    if (id === PTV_PLUGIN_GUID) return 'piggietv';
    if (!canUninstall) return 'bundled';
    if (packageInfo) return 'repository';
    return 'unknown';
}

export function normalizeAdminInstalledPlugins(
    rawPlugins: readonly PluginInfo[],
    packages: readonly PtvAdminPluginPackage[] = [],
    pages: readonly PtvAdminPluginConfigurationPage[] = [],
    getInstalledImageUrl?: (pluginId: string, version: string) => string
): PtvAdminInstalledPlugin[] {
    if (!Array.isArray(rawPlugins)) {
        throw new AdminPluginsServiceError('invalid-response', 'Installed plugin information could not be loaded.');
    }
    const packagesById = new Map(packages.map(packageInfo => [ packageInfo.id, packageInfo ]));
    const pagesById = new Map<string, PtvAdminPluginConfigurationPage[]>();
    pages.forEach(page => {
        const current = pagesById.get(page.pluginId) || [];
        current.push(page);
        pagesById.set(page.pluginId, current);
    });

    return rawPlugins.map(raw => {
        if (!raw || typeof raw !== 'object') {
            throw new AdminPluginsServiceError('invalid-response', 'Installed plugin information could not be read.');
        }
        const id = normalizeAdminPluginGuid(raw.Id);
        const version = requireVersion(raw.Version);
        const name = text(raw.Name);
        if (!id || !name) {
            throw new AdminPluginsServiceError('invalid-response', 'Installed plugin information was incomplete.');
        }
        const status = normalizePluginStatus(raw.Status);
        const packageInfo = packagesById.get(id) || null;
        const canUninstall = raw.CanUninstall === true && status.status !== 'deleted';
        const configurationPages = pagesById.get(id) || [];
        const imageUrl = raw.HasImage === true && getInstalledImageUrl ?
            getInstalledImageUrl(id, version) :
            null;

        return {
            canConfigure: configurationPages.length > 0,
            canDisable: status.status === 'active',
            canEnable: status.status === 'disabled',
            canUninstall,
            category: packageInfo?.category || null,
            configurationPages,
            description: text(raw.Description) || packageInfo?.description || packageInfo?.overview || null,
            hasImage: raw.HasImage === true,
            id,
            imageUrl,
            isPiggieTv: id === PTV_PLUGIN_GUID,
            key: `${id}:${version}`,
            name,
            package: packageInfo,
            restartRequired: status.status === 'restart'
                || status.status === 'deleted'
                || status.status === 'superseded',
            source: getPluginSource(id, raw.CanUninstall === true, packageInfo),
            status: status.status,
            statusLabel: status.label,
            statusValue: status.value,
            updateVersion: findAdminPluginUpdateVersion(packageInfo?.versions || [], version),
            version
        };
    });
}

export function enrichAdminPluginPackages(
    packages: readonly PtvAdminPluginPackage[],
    installed: readonly PtvAdminInstalledPlugin[]
) {
    return packages.map(packageInfo => {
        const matches = installed.filter(plugin => plugin.id === packageInfo.id);
        const primary = findPrimaryAdminInstalledPlugin(matches);
        return {
            ...packageInfo,
            installedVersion: primary?.version || null,
            isInstalled: matches.length > 0,
            updateVersion: findAdminPluginUpdateVersion(packageInfo.versions, primary?.version)
        };
    });
}

/** Normalizes all source arrays in one pass; it never performs secondary requests. */
export function normalizeAdminPluginInventory(
    rawPlugins: readonly PluginInfo[],
    rawPackages: readonly PackageInfo[],
    rawPages: readonly ConfigurationPageInfo[],
    getInstalledImageUrl?: (pluginId: string, version: string) => string
) {
    const basePackages = normalizeAdminPluginPackages(rawPackages);
    const pages = normalizeAdminPluginConfigurationPages(rawPages);
    const firstInstalled = normalizeAdminInstalledPlugins(
        rawPlugins,
        basePackages,
        pages,
        getInstalledImageUrl
    );
    const packages = enrichAdminPluginPackages(basePackages, firstInstalled);
    const packageMap = new Map(packages.map(packageInfo => [ packageInfo.id, packageInfo ]));
    const installed = firstInstalled.map(plugin => {
        const packageInfo = packageMap.get(plugin.id) || null;
        return {
            ...plugin,
            package: packageInfo,
            updateVersion: findAdminPluginUpdateVersion(packageInfo?.versions || [], plugin.version)
        };
    });
    return { installed, packages, pages } as const;
}

export function normalizeAdminPluginDetail(
    pluginId: string,
    installed: readonly PtvAdminInstalledPlugin[],
    packages: readonly PtvAdminPluginPackage[],
    pages: readonly PtvAdminPluginConfigurationPage[]
): PtvAdminPluginDetail | null {
    const id = normalizeAdminPluginGuid(pluginId);
    if (!id) return null;
    const installedVersions = installed.filter(plugin => plugin.id === id);
    const packageInfo = packages.find(plugin => plugin.id === id) || null;
    const configurationPages = pages.filter(page => page.pluginId === id);
    const primary = findPrimaryAdminInstalledPlugin(installedVersions);
    if (!primary && !packageInfo) return null;
    return {
        configurationPages,
        id,
        installed: primary,
        installedVersions,
        isPiggieTv: id === PTV_PLUGIN_GUID,
        name: primary?.name || packageInfo?.name || 'Plugin',
        package: packageInfo
    };
}

export function cloneAdminPluginRepositories(
    repositories: readonly (RepositoryInfo & Record<string, unknown>)[]
): RawAdminPluginRepository[] {
    if (!Array.isArray(repositories)) {
        throw new AdminPluginsServiceError('invalid-input', 'Choose a valid repository list.');
    }
    return repositories.map(repository => cloneValue(repository));
}

export function equalAdminPluginRepositories(
    left: readonly (RepositoryInfo & Record<string, unknown>)[],
    right: readonly (RepositoryInfo & Record<string, unknown>)[]
) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return JSON.stringify(comparableValue(left)) === JSON.stringify(comparableValue(right));
}

export function normalizeAdminPluginRepositories(
    raw: readonly (RepositoryInfo & Record<string, unknown>)[]
): PtvAdminPluginRepository[] {
    if (!Array.isArray(raw)) {
        throw new AdminPluginsServiceError('invalid-response', 'Plugin repositories could not be loaded.');
    }
    return raw.map((repository, index) => {
        if (!repository || typeof repository !== 'object' || Array.isArray(repository)) {
            throw new AdminPluginsServiceError('invalid-response', 'A plugin repository could not be read.');
        }
        const name = text(repository.Name) || 'Unnamed repository';
        const url = text(repository.Url) || '';
        return {
            enabled: repository.Enabled !== false,
            id: `${index}:${url.toLowerCase()}`,
            index,
            name,
            raw: cloneValue(repository),
            url
        };
    });
}
