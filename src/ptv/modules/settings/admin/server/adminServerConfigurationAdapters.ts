import type { BrandingOptionsDto } from '@jellyfin/sdk/lib/generated-client/models/branding-options-dto';
import type { LocalizationOption } from '@jellyfin/sdk/lib/generated-client/models/localization-option';
import type { NetworkConfiguration } from '@jellyfin/sdk/lib/generated-client/models/network-configuration';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';
import type { SystemInfo } from '@jellyfin/sdk/lib/generated-client/models/system-info';

import {
    AdminServerConfigurationError,
    type AdminServerBrandingSettings,
    type AdminServerBrandingSnapshot,
    type AdminServerCertificatePasswordChange,
    type AdminServerGeneralSettings,
    type AdminServerGeneralSnapshot,
    type AdminServerLocalizationOption,
    type AdminServerNetworkingSettings,
    type AdminServerNetworkingSnapshot
} from './adminServerConfigurationModel';

const PORT_MIN = 1;
const PORT_MAX = 65_535;
const IPV4_PATTERN = /^(?:(?:\d{1,3})\.){3}(?:\d{1,3})$/;
const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i;

function text(value: unknown) {
    return typeof value === 'string' ? value : '';
}

function requiredBoolean(value: unknown, code: 'branding-invalid' | 'general-invalid' | 'networking-invalid', field: string) {
    if (typeof value !== 'boolean') {
        throw new AdminServerConfigurationError(code, `${field} is unavailable.`);
    }
    return value;
}

function requiredNumber(value: unknown, code: 'general-invalid' | 'networking-invalid', field: string) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new AdminServerConfigurationError(code, `${field} is unavailable.`);
    }
    return value;
}

function stringArray(value: unknown) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new AdminServerConfigurationError('networking-invalid', 'A networking list is unavailable.');
    }
    return value.map(item => item.trim()).filter(Boolean);
}

function isValidIpv4(value: string) {
    return IPV4_PATTERN.test(value)
        && value.split('.').every(part => Number(part) >= 0 && Number(part) <= 255);
}

function isValidIpv6(value: string) {
    const withoutBrackets = value.startsWith('[') && value.endsWith(']') ?
        value.slice(1, -1) : value;
    const normalized = withoutBrackets.split('%')[0];
    if (!normalized.includes(':')) return false;
    const compression = normalized.indexOf('::');
    if (compression !== normalized.lastIndexOf('::')) return false;
    const normalizeParts = (side: string) => side ? side.split(':') : [];
    const left = normalizeParts(compression >= 0 ? normalized.slice(0, compression) : normalized);
    const right = normalizeParts(compression >= 0 ? normalized.slice(compression + 2) : '');
    const allParts = [ ...left, ...right ];
    const finalPart = allParts[allParts.length - 1];
    const ipv4Tail = finalPart?.includes('.') ? allParts.pop() : null;
    if (ipv4Tail && !isValidIpv4(ipv4Tail)) return false;
    if (allParts.some(part => !/^[0-9a-f]{1,4}$/i.test(part))) return false;
    const partCount = allParts.length + (ipv4Tail ? 2 : 0);
    return compression >= 0 ? partCount < 8 : partCount === 8;
}

function splitCidr(value: string) {
    const separator = value.lastIndexOf('/');
    if (separator < 0) return { address: value, prefix: null };
    const rawPrefix = value.slice(separator + 1);
    return {
        address: value.slice(0, separator),
        prefix: /^\d+$/.test(rawPrefix) ? Number(rawPrefix) : Number.NaN
    };
}

function isValidIpOrCidr(value: string) {
    const { address, prefix } = splitCidr(value);
    if (isValidIpv4(address)) {
        return prefix === null || (Number.isInteger(prefix) && prefix >= 0 && prefix <= 32);
    }
    if (isValidIpv6(address)) {
        return prefix === null || (Number.isInteger(prefix) && prefix >= 0 && prefix <= 128);
    }
    return false;
}

function isValidHostOrIp(value: string) {
    return value === '*' || isValidIpOrCidr(value) || HOST_PATTERN.test(value);
}

function invalidEntry(values: readonly string[], validate: (value: string) => boolean) {
    return values.find(value => !validate(value));
}

function isValidPublishedServerUri(value: string) {
    const separator = value.indexOf('=');
    if (separator <= 0 || separator === value.length - 1) return false;
    const scope = value.slice(0, separator).trim();
    const uri = value.slice(separator + 1).trim();
    const scopeValid = [ 'all', 'external', 'internal' ].includes(scope.toLowerCase())
        || isValidIpOrCidr(scope)
        || HOST_PATTERN.test(scope);
    if (!scopeValid) return false;
    try {
        // eslint-disable-next-line compat/compat -- evergreen clients provide URL.
        const parsed = new URL(uri);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function cloneDocument<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export function createAdminServerGeneralSnapshot(
    configuration: ServerConfiguration,
    system?: SystemInfo | null
): AdminServerGeneralSnapshot {
    const settings: AdminServerGeneralSettings = {
        cachePath: text(configuration.CachePath),
        libraryScanFanoutConcurrency: requiredNumber(
            configuration.LibraryScanFanoutConcurrency,
            'general-invalid',
            'Library scan concurrency'
        ),
        metadataPath: text(configuration.MetadataPath),
        parallelImageEncodingLimit: requiredNumber(
            configuration.ParallelImageEncodingLimit,
            'general-invalid',
            'Parallel image encoding limit'
        ),
        quickConnectAvailable: requiredBoolean(
            configuration.QuickConnectAvailable,
            'general-invalid',
            'Quick Connect availability'
        ),
        serverName: text(configuration.ServerName),
        uiCulture: text(configuration.UICulture)
    };

    const canSelfRestart = Reflect.get(system || {}, 'CanSelfRestart') as unknown;
    const operatingSystemDisplayName = Reflect.get(system || {}, 'OperatingSystemDisplayName');
    const operatingSystem = Reflect.get(system || {}, 'OperatingSystem');
    return {
        settings,
        system: system ? {
            canSelfRestart: typeof canSelfRestart === 'boolean' ? canSelfRestart : null,
            operatingSystem: text(operatingSystemDisplayName)
                || text(operatingSystem)
                || null,
            pendingRestart: typeof system.HasPendingRestart === 'boolean' ?
                system.HasPendingRestart : null,
            productName: text(system.ProductName) || null,
            version: text(system.Version) || null
        } : null
    };
}

export function areAdminServerGeneralSettingsEqual(
    left: AdminServerGeneralSettings,
    right: AdminServerGeneralSettings
) {
    return left.cachePath === right.cachePath
        && left.libraryScanFanoutConcurrency === right.libraryScanFanoutConcurrency
        && left.metadataPath === right.metadataPath
        && left.parallelImageEncodingLimit === right.parallelImageEncodingLimit
        && left.quickConnectAvailable === right.quickConnectAvailable
        && left.serverName === right.serverName
        && left.uiCulture === right.uiCulture;
}

export function patchAdminServerGeneralConfiguration(
    configuration: ServerConfiguration,
    settings: AdminServerGeneralSettings
) {
    const patched = cloneDocument(configuration);
    patched.CachePath = settings.cachePath || null;
    patched.LibraryScanFanoutConcurrency = settings.libraryScanFanoutConcurrency;
    patched.MetadataPath = settings.metadataPath;
    patched.ParallelImageEncodingLimit = settings.parallelImageEncodingLimit;
    patched.QuickConnectAvailable = settings.quickConnectAvailable;
    patched.ServerName = settings.serverName;
    patched.UICulture = settings.uiCulture;
    return patched;
}

export function requireAdminServerGeneralSettings(settings: AdminServerGeneralSettings) {
    if (!settings.serverName.trim() || !settings.uiCulture.trim()) {
        throw new AdminServerConfigurationError(
            'general-invalid',
            'Server name and display language are required.'
        );
    }
    if (!Number.isSafeInteger(settings.libraryScanFanoutConcurrency)
        || settings.libraryScanFanoutConcurrency < 0
        || !Number.isSafeInteger(settings.parallelImageEncodingLimit)
        || settings.parallelImageEncodingLimit < 0) {
        throw new AdminServerConfigurationError(
            'general-invalid',
            'Concurrency values must be whole numbers, 0 or greater.'
        );
    }
}

export function normalizeAdminServerLocalizationOptions(
    options: readonly LocalizationOption[],
    configured: string
): AdminServerLocalizationOption[] {
    const normalized = options.flatMap(option => {
        const value = text(option.Value).trim();
        if (!value) return [];
        return [ { label: text(option.Name).trim() || value, value } ];
    });
    if (configured && !normalized.some(option => option.value === configured)) {
        normalized.push({ label: `${configured} (unavailable)`, value: configured });
    }
    return normalized;
}

export function createAdminServerBrandingSnapshot(
    options: BrandingOptionsDto
): AdminServerBrandingSnapshot {
    return {
        settings: {
            customCss: text(options.CustomCss),
            loginDisclaimer: text(options.LoginDisclaimer),
            splashscreenEnabled: requiredBoolean(
                options.SplashscreenEnabled,
                'branding-invalid',
                'Splash screen state'
            )
        }
    };
}

export function areAdminServerBrandingSettingsEqual(
    left: AdminServerBrandingSettings,
    right: AdminServerBrandingSettings
) {
    return left.customCss === right.customCss
        && left.loginDisclaimer === right.loginDisclaimer
        && left.splashscreenEnabled === right.splashscreenEnabled;
}

export function patchAdminServerBrandingConfiguration(
    options: BrandingOptionsDto,
    settings: AdminServerBrandingSettings
) {
    return {
        ...cloneDocument(options),
        CustomCss: settings.customCss,
        LoginDisclaimer: settings.loginDisclaimer,
        SplashscreenEnabled: settings.splashscreenEnabled
    };
}

export function createAdminServerNetworkingSnapshot(
    configuration: NetworkConfiguration,
    authority: object
): AdminServerNetworkingSnapshot {
    return {
        authority,
        settings: {
            autoDiscovery: requiredBoolean(configuration.AutoDiscovery, 'networking-invalid', 'Auto discovery'),
            baseUrl: text(configuration.BaseUrl),
            certificatePasswordConfigured: Boolean(text(configuration.CertificatePassword)),
            certificatePath: text(configuration.CertificatePath),
            enableHttps: requiredBoolean(configuration.EnableHttps, 'networking-invalid', 'HTTPS'),
            enableIPv4: requiredBoolean(configuration.EnableIPv4, 'networking-invalid', 'IPv4'),
            enableIPv6: requiredBoolean(configuration.EnableIPv6, 'networking-invalid', 'IPv6'),
            enableRemoteAccess: requiredBoolean(configuration.EnableRemoteAccess, 'networking-invalid', 'Remote access'),
            internalHttpPort: requiredNumber(configuration.InternalHttpPort, 'networking-invalid', 'Internal HTTP port'),
            internalHttpsPort: requiredNumber(configuration.InternalHttpsPort, 'networking-invalid', 'Internal HTTPS port'),
            isRemoteIPFilterBlacklist: requiredBoolean(configuration.IsRemoteIPFilterBlacklist, 'networking-invalid', 'Remote IP filter mode'),
            knownProxies: stringArray(configuration.KnownProxies),
            localNetworkAddresses: stringArray(configuration.LocalNetworkAddresses),
            localNetworkSubnets: stringArray(configuration.LocalNetworkSubnets),
            publicHttpPort: requiredNumber(configuration.PublicHttpPort, 'networking-invalid', 'Public HTTP port'),
            publicHttpsPort: requiredNumber(configuration.PublicHttpsPort, 'networking-invalid', 'Public HTTPS port'),
            publishedServerUriBySubnet: stringArray(configuration.PublishedServerUriBySubnet),
            remoteIPFilter: stringArray(configuration.RemoteIPFilter),
            requireHttps: requiredBoolean(configuration.RequireHttps, 'networking-invalid', 'Require HTTPS')
        }
    };
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function areAdminServerNetworkingSettingsEqual(
    left: AdminServerNetworkingSettings,
    right: AdminServerNetworkingSettings
) {
    return left.autoDiscovery === right.autoDiscovery
        && left.baseUrl === right.baseUrl
        && left.certificatePasswordConfigured === right.certificatePasswordConfigured
        && left.certificatePath === right.certificatePath
        && left.enableHttps === right.enableHttps
        && left.enableIPv4 === right.enableIPv4
        && left.enableIPv6 === right.enableIPv6
        && left.enableRemoteAccess === right.enableRemoteAccess
        && left.internalHttpPort === right.internalHttpPort
        && left.internalHttpsPort === right.internalHttpsPort
        && left.isRemoteIPFilterBlacklist === right.isRemoteIPFilterBlacklist
        && arraysEqual(left.knownProxies, right.knownProxies)
        && arraysEqual(left.localNetworkAddresses, right.localNetworkAddresses)
        && arraysEqual(left.localNetworkSubnets, right.localNetworkSubnets)
        && left.publicHttpPort === right.publicHttpPort
        && left.publicHttpsPort === right.publicHttpsPort
        && arraysEqual(left.publishedServerUriBySubnet, right.publishedServerUriBySubnet)
        && arraysEqual(left.remoteIPFilter, right.remoteIPFilter)
        && left.requireHttps === right.requireHttps;
}

export function requireAdminServerNetworkingSettings(settings: AdminServerNetworkingSettings) {
    const ports = [
        settings.internalHttpPort,
        settings.internalHttpsPort,
        settings.publicHttpPort,
        settings.publicHttpsPort
    ];
    if (ports.some(port => !Number.isSafeInteger(port) || port < PORT_MIN || port > PORT_MAX)) {
        throw new AdminServerConfigurationError(
            'networking-invalid',
            'Ports must be whole numbers from 1 through 65535.'
        );
    }
    if (settings.internalHttpPort === settings.internalHttpsPort
        || settings.publicHttpPort === settings.publicHttpsPort) {
        throw new AdminServerConfigurationError(
            'networking-invalid',
            'HTTP and HTTPS ports must be different.'
        );
    }
    if (!settings.enableIPv4 && !settings.enableIPv6) {
        throw new AdminServerConfigurationError(
            'networking-invalid',
            'At least one IP protocol must remain enabled.'
        );
    }
    if (settings.enableHttps && !settings.certificatePath.trim()) {
        throw new AdminServerConfigurationError(
            'networking-invalid',
            'A certificate path is required when HTTPS is enabled.'
        );
    }

    const invalidSubnet = invalidEntry(settings.localNetworkSubnets, isValidIpOrCidr);
    const invalidRemote = invalidEntry(settings.remoteIPFilter, isValidIpOrCidr);
    const invalidBind = invalidEntry(settings.localNetworkAddresses, isValidHostOrIp);
    const invalidProxy = invalidEntry(settings.knownProxies, isValidHostOrIp);
    const invalidPublished = invalidEntry(
        settings.publishedServerUriBySubnet,
        isValidPublishedServerUri
    );
    const invalid = invalidSubnet || invalidRemote || invalidBind || invalidProxy || invalidPublished;
    if (invalid) {
        throw new AdminServerConfigurationError(
            'networking-invalid',
            `Review the networking entry "${invalid}". Use a valid IP, CIDR, hostname, or published URI mapping.`
        );
    }
}

export function patchAdminServerNetworkingConfiguration(
    configuration: NetworkConfiguration,
    settings: AdminServerNetworkingSettings,
    passwordChange: AdminServerCertificatePasswordChange
) {
    requireAdminServerNetworkingSettings(settings);
    const patched = cloneDocument(configuration);
    patched.AutoDiscovery = settings.autoDiscovery;
    patched.BaseUrl = settings.baseUrl;
    patched.CertificatePath = settings.certificatePath;
    patched.EnableHttps = settings.enableHttps;
    patched.EnableIPv4 = settings.enableIPv4;
    patched.EnableIPv6 = settings.enableIPv6;
    patched.EnableRemoteAccess = settings.enableRemoteAccess;
    patched.InternalHttpPort = settings.internalHttpPort;
    patched.InternalHttpsPort = settings.internalHttpsPort;
    patched.IsRemoteIPFilterBlacklist = settings.isRemoteIPFilterBlacklist;
    patched.KnownProxies = [ ...settings.knownProxies ];
    patched.LocalNetworkAddresses = [ ...settings.localNetworkAddresses ];
    patched.LocalNetworkSubnets = [ ...settings.localNetworkSubnets ];
    patched.PublicHttpPort = settings.publicHttpPort;
    patched.PublicHttpsPort = settings.publicHttpsPort;
    patched.PublishedServerUriBySubnet = [ ...settings.publishedServerUriBySubnet ];
    patched.RemoteIPFilter = [ ...settings.remoteIPFilter ];
    patched.RequireHttps = settings.requireHttps;

    if (passwordChange.mode === 'clear') patched.CertificatePassword = '';
    if (passwordChange.mode === 'replace') {
        const password = text(passwordChange.value);
        if (!password) {
            throw new AdminServerConfigurationError(
                'networking-invalid',
                'Enter a replacement certificate password.'
            );
        }
        patched.CertificatePassword = password;
    }
    return patched;
}

export function commaSeparated(values: readonly string[]) {
    return values.join(', ');
}

export function parseCommaSeparated(value: string) {
    return value.split(',').map(item => item.trim()).filter(Boolean);
}
