import type { ConfigurationPageInfo } from '@jellyfin/sdk/lib/generated-client/models/configuration-page-info';
import type { PackageInfo } from '@jellyfin/sdk/lib/generated-client/models/package-info';
import type { PluginInfo } from '@jellyfin/sdk/lib/generated-client/models/plugin-info';
import type { RepositoryInfo } from '@jellyfin/sdk/lib/generated-client/models/repository-info';

/** Jellyfin serializes API GUIDs as lower-case 32-character values. */
export const PTV_PLUGIN_GUID = '27c90ee77d56459198f8b0ebcda8c5fd';

export type RawAdminPluginInfo = PluginInfo & Record<string, unknown>;
export type RawAdminPluginPackage = PackageInfo & Record<string, unknown>;
export type RawAdminPluginRepository = RepositoryInfo & Record<string, unknown>;
export type RawAdminPluginConfigurationPage = ConfigurationPageInfo & Record<string, unknown>;

export type PtvAdminPluginStatus =
    | 'active'
    | 'restart'
    | 'deleted'
    | 'superseded'
    | 'malfunctioned'
    | 'not-supported'
    | 'disabled'
    | 'unknown';

export type PtvAdminPluginSource = 'piggietv' | 'bundled' | 'repository' | 'unknown';

export type PtvAdminPluginConfigurationPage = Readonly<{
    displayName: string;
    enableInMainMenu: boolean;
    href: string;
    menuIcon: string | null;
    menuSection: string | null;
    name: string;
    pluginId: string;
}>;

export type PtvAdminPluginVersion = Readonly<{
    changelog: string | null;
    key: string;
    repositoryName: string | null;
    repositoryUrl: string | null;
    targetAbi: string | null;
    timestamp: string | null;
    version: string;
    versionNumber: string;
}>;

export type PtvAdminPluginPackage = Readonly<{
    category: string | null;
    description: string | null;
    id: string;
    imageUrl: string | null;
    installedVersion: string | null;
    isInstalled: boolean;
    isPiggieTv: boolean;
    latestVersion: PtvAdminPluginVersion | null;
    name: string;
    overview: string | null;
    owner: string | null;
    updateVersion: PtvAdminPluginVersion | null;
    versions: readonly PtvAdminPluginVersion[];
}>;

export type PtvAdminInstalledPlugin = Readonly<{
    canConfigure: boolean;
    canDisable: boolean;
    canEnable: boolean;
    canUninstall: boolean;
    category: string | null;
    configurationPages: readonly PtvAdminPluginConfigurationPage[];
    description: string | null;
    hasImage: boolean;
    id: string;
    imageUrl: string | null;
    isPiggieTv: boolean;
    key: string;
    name: string;
    package: PtvAdminPluginPackage | null;
    restartRequired: boolean;
    source: PtvAdminPluginSource;
    status: PtvAdminPluginStatus;
    statusLabel: string;
    statusValue: string | null;
    updateVersion: PtvAdminPluginVersion | null;
    version: string;
}>;

export type PtvAdminPluginDetail = Readonly<{
    configurationPages: readonly PtvAdminPluginConfigurationPage[];
    id: string;
    installed: PtvAdminInstalledPlugin | null;
    installedVersions: readonly PtvAdminInstalledPlugin[];
    isPiggieTv: boolean;
    name: string;
    package: PtvAdminPluginPackage | null;
}>;

/**
 * A UI projection plus the complete opaque server document. Repository writes
 * replace Jellyfin's entire ordered array, so `raw` must never be reconstructed.
 */
export type PtvAdminPluginRepository = Readonly<{
    enabled: boolean;
    id: string;
    index: number;
    name: string;
    raw: RawAdminPluginRepository;
    url: string;
}>;

export type AdminPluginRepositoryInput = Readonly<{
    enabled?: boolean;
    name: string;
    url: string;
}>;

export type AdminPluginActionState =
    | 'installing'
    | 'updating'
    | 'uninstalling'
    | 'enabling'
    | 'disabling';

export type AdminPluginRepositoryActionState = Readonly<{
    action: 'adding' | 'editing' | 'removing';
    repositoryId: string | null;
}>;

export type AdminPluginsFeedback = Readonly<{
    message: string;
    tone: 'error' | 'info' | 'success';
}>;

export type AdminPluginsServiceErrorCode =
    | 'conflict'
    | 'invalid-input'
    | 'invalid-response'
    | 'not-found'
    | 'operation-failed'
    | 'repository-conflict'
    | 'repository-unavailable'
    | 'source-unavailable'
    | 'state-changed'
    | 'verification-failed';

export type AdminPluginMutationSnapshot = Readonly<{
    /** Always present: lifecycle verification is authoritative through `/Plugins`. */
    installed: readonly RawAdminPluginInfo[];
}>;

/** User-safe plugin error. Raw server responses and remote URLs are never copied into it. */
export class AdminPluginsServiceError extends Error {
    public readonly code: AdminPluginsServiceErrorCode;

    public constructor(code: AdminPluginsServiceErrorCode, message: string) {
        super(message);
        this.code = code;
        this.name = 'AdminPluginsServiceError';
    }
}
