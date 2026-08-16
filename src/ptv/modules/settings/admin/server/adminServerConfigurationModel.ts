import type { BrandingOptionsDto } from '@jellyfin/sdk/lib/generated-client/models/branding-options-dto';
import type { NetworkConfiguration } from '@jellyfin/sdk/lib/generated-client/models/network-configuration';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';

export type AdminServerGeneralSettings = Readonly<{
    cachePath: string;
    libraryScanFanoutConcurrency: number;
    metadataPath: string;
    parallelImageEncodingLimit: number;
    quickConnectAvailable: boolean;
    serverName: string;
    uiCulture: string;
}>;

export type AdminServerSystemSummary = Readonly<{
    canSelfRestart: boolean | null;
    operatingSystem: string | null;
    pendingRestart: boolean | null;
    productName: string | null;
    version: string | null;
}>;

export type AdminServerGeneralSnapshot = Readonly<{
    settings: AdminServerGeneralSettings;
    system: AdminServerSystemSummary | null;
}>;

export type AdminServerBrandingSettings = Readonly<{
    customCss: string;
    loginDisclaimer: string;
    splashscreenEnabled: boolean;
}>;

export type AdminServerBrandingSnapshot = Readonly<{
    settings: AdminServerBrandingSettings;
}>;

export type AdminServerCertificatePasswordChange = Readonly<{
    mode: 'clear' | 'replace' | 'unchanged';
    value?: string;
}>;

export type AdminServerNetworkingSettings = Readonly<{
    autoDiscovery: boolean;
    baseUrl: string;
    certificatePasswordConfigured: boolean;
    certificatePath: string;
    enableHttps: boolean;
    enableIPv4: boolean;
    enableIPv6: boolean;
    enableRemoteAccess: boolean;
    internalHttpPort: number;
    internalHttpsPort: number;
    isRemoteIPFilterBlacklist: boolean;
    knownProxies: readonly string[];
    localNetworkAddresses: readonly string[];
    localNetworkSubnets: readonly string[];
    publicHttpPort: number;
    publicHttpsPort: number;
    publishedServerUriBySubnet: readonly string[];
    remoteIPFilter: readonly string[];
    requireHttps: boolean;
}>;

/**
 * The authority object is an opaque handle into a private service WeakMap. It
 * never contains the certificate password or the raw network document.
 */
export type AdminServerNetworkingSnapshot = Readonly<{
    authority: object;
    settings: AdminServerNetworkingSettings;
}>;

export type AdminServerNetworkingSaveResult = Readonly<{
    snapshot: AdminServerNetworkingSnapshot;
    verification: 'confirmed' | 'connection-interrupted';
}>;

export type AdminServerPowerAction = 'restart' | 'shutdown';

export type AdminServerLocalizationOption = Readonly<{
    label: string;
    value: string;
}>;

export type AdminServerConfigurationErrorCode =
    | 'branding-conflict'
    | 'branding-invalid'
    | 'branding-load-failed'
    | 'branding-save-failed'
    | 'general-conflict'
    | 'general-invalid'
    | 'general-load-failed'
    | 'general-save-failed'
    | 'networking-conflict'
    | 'networking-invalid'
    | 'networking-load-failed'
    | 'networking-save-failed'
    | 'power-action-failed'
    | 'splashscreen-invalid'
    | 'splashscreen-save-failed';

export class AdminServerConfigurationError extends Error {
    public readonly code: AdminServerConfigurationErrorCode;

    public constructor(code: AdminServerConfigurationErrorCode, message: string) {
        super(message);
        this.code = code;
        this.name = 'AdminServerConfigurationError';
    }
}

export type AdminServerRawGeneralDocument = ServerConfiguration;
export type AdminServerRawBrandingDocument = BrandingOptionsDto;
export type AdminServerRawNetworkingDocument = NetworkConfiguration;
