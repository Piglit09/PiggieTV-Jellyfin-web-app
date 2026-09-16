import type { Api } from '@jellyfin/sdk';
import type { BrandingOptionsDto } from '@jellyfin/sdk/lib/generated-client/models/branding-options-dto';
import type { LocalizationOption } from '@jellyfin/sdk/lib/generated-client/models/localization-option';
import type { NetworkConfiguration } from '@jellyfin/sdk/lib/generated-client/models/network-configuration';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';
import type { SystemInfo } from '@jellyfin/sdk/lib/generated-client/models/system-info';
import { getBrandingApi } from '@jellyfin/sdk/lib/utils/api/branding-api';
import { getConfigurationApi } from '@jellyfin/sdk/lib/utils/api/configuration-api';
import { getImageApi } from '@jellyfin/sdk/lib/utils/api/image-api';
import { getLocalizationApi } from '@jellyfin/sdk/lib/utils/api/localization-api';
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api';

import {
    areAdminServerBrandingSettingsEqual,
    areAdminServerGeneralSettingsEqual,
    areAdminServerNetworkingSettingsEqual,
    createAdminServerBrandingSnapshot,
    createAdminServerGeneralSnapshot,
    createAdminServerNetworkingSnapshot,
    patchAdminServerBrandingConfiguration,
    patchAdminServerGeneralConfiguration,
    patchAdminServerNetworkingConfiguration,
    requireAdminServerGeneralSettings,
    requireAdminServerNetworkingSettings
} from './adminServerConfigurationAdapters';
import {
    AdminServerConfigurationError,
    type AdminServerBrandingSettings,
    type AdminServerBrandingSnapshot,
    type AdminServerCertificatePasswordChange,
    type AdminServerGeneralSettings,
    type AdminServerGeneralSnapshot,
    type AdminServerNetworkingSettings,
    type AdminServerNetworkingSaveResult,
    type AdminServerNetworkingSnapshot
} from './adminServerConfigurationModel';

const NETWORK_CONFIGURATION_KEY = 'network';
export const ADMIN_SERVER_SPLASHSCREEN_MAX_BYTES = 10 * 1024 * 1024;

const networkAuthorityVault = new WeakMap<object, NetworkConfiguration>();
const powerFlights = new WeakMap<Api, Map<'restart' | 'shutdown', Promise<void>>>();

function isAbortError(error: unknown) {
    return (
        (typeof DOMException !== 'undefined'
            && error instanceof DOMException
            && error.name === 'AbortError')
        || (typeof error === 'object' && error !== null && (
            Reflect.get(error, 'code') === 'ERR_CANCELED'
            || Reflect.get(error, 'name') === 'CanceledError'
        ))
    );
}

function sanitize(
    error: unknown,
    code: ConstructorParameters<typeof AdminServerConfigurationError>[0],
    message: string
): never {
    if (error instanceof AdminServerConfigurationError || isAbortError(error)) throw error;
    throw new AdminServerConfigurationError(code, message);
}

async function fetchGeneralDocument(api: Api, signal?: AbortSignal) {
    const response = await getConfigurationApi(api).getConfiguration({ signal });
    if (!response.data || typeof response.data !== 'object') {
        throw new AdminServerConfigurationError('general-load-failed', 'General settings could not be loaded.');
    }
    return response.data;
}

export async function loadAdminServerGeneral(
    api: Api,
    signal?: AbortSignal
): Promise<AdminServerGeneralSnapshot> {
    try {
        const configuration = await fetchGeneralDocument(api, signal);
        return createAdminServerGeneralSnapshot(configuration);
    } catch (error) {
        return sanitize(error, 'general-load-failed', 'General settings could not be loaded.');
    }
}

export async function loadAdminServerSystemInfo(api: Api, signal?: AbortSignal) {
    try {
        const response = await getSystemApi(api).getSystemInfo({ signal });
        if (!response.data || typeof response.data !== 'object') throw new Error('Invalid system information');
        return response.data;
    } catch (error) {
        if (isAbortError(error)) throw error;
        return null;
    }
}

export async function loadAdminServerLocalizationOptions(
    api: Api,
    signal?: AbortSignal
): Promise<LocalizationOption[]> {
    try {
        const response = await getLocalizationApi(api).getLocalizationOptions({ signal });
        if (!Array.isArray(response.data)) throw new Error('Invalid localization catalog');
        return response.data;
    } catch (error) {
        return sanitize(error, 'general-load-failed', 'Display languages could not be loaded.');
    }
}

export async function saveAdminServerGeneral(
    api: Api,
    desired: AdminServerGeneralSettings,
    confirmed: AdminServerGeneralSettings,
    system: SystemInfo | null,
    signal?: AbortSignal
): Promise<AdminServerGeneralSnapshot> {
    requireAdminServerGeneralSettings(desired);
    requireAdminServerGeneralSettings(confirmed);

    try {
        const authoritative = await fetchGeneralDocument(api, signal);
        const current = createAdminServerGeneralSnapshot(authoritative, system);
        if (!areAdminServerGeneralSettingsEqual(current.settings, confirmed)) {
            throw new AdminServerConfigurationError(
                'general-conflict',
                'General settings changed on the server while you were editing.'
            );
        }
        if (areAdminServerGeneralSettingsEqual(current.settings, desired)) return current;

        const patched = patchAdminServerGeneralConfiguration(authoritative, desired);
        await getConfigurationApi(api).updateConfiguration(
            { serverConfiguration: patched },
            { signal }
        );
        const verified = createAdminServerGeneralSnapshot(
            await fetchGeneralDocument(api, signal),
            system
        );
        if (!areAdminServerGeneralSettingsEqual(verified.settings, desired)) {
            throw new AdminServerConfigurationError(
                'general-save-failed',
                'The server did not confirm the requested General settings.'
            );
        }
        return verified;
    } catch (error) {
        return sanitize(error, 'general-save-failed', "We couldn't save General settings.");
    }
}

async function fetchBrandingDocument(api: Api, signal?: AbortSignal): Promise<BrandingOptionsDto> {
    const response = await getBrandingApi(api).getBrandingOptions({ signal });
    if (!response.data || typeof response.data !== 'object') {
        throw new AdminServerConfigurationError('branding-load-failed', 'Branding settings could not be loaded.');
    }
    return response.data;
}

export async function loadAdminServerBranding(
    api: Api,
    signal?: AbortSignal
): Promise<AdminServerBrandingSnapshot> {
    try {
        return createAdminServerBrandingSnapshot(await fetchBrandingDocument(api, signal));
    } catch (error) {
        return sanitize(error, 'branding-load-failed', 'Branding settings could not be loaded.');
    }
}

export async function saveAdminServerBranding(
    api: Api,
    desired: AdminServerBrandingSettings,
    confirmed: AdminServerBrandingSettings,
    signal?: AbortSignal
): Promise<AdminServerBrandingSnapshot> {
    try {
        const authoritative = await fetchBrandingDocument(api, signal);
        const current = createAdminServerBrandingSnapshot(authoritative);
        if (!areAdminServerBrandingSettingsEqual(current.settings, confirmed)) {
            throw new AdminServerConfigurationError(
                'branding-conflict',
                'Branding settings changed on the server while you were editing.'
            );
        }
        if (areAdminServerBrandingSettingsEqual(current.settings, desired)) return current;

        const patched = patchAdminServerBrandingConfiguration(authoritative, desired);
        await getConfigurationApi(api).updateBrandingConfiguration(
            { brandingOptionsDto: patched },
            { signal }
        );
        const verified = createAdminServerBrandingSnapshot(
            await fetchBrandingDocument(api, signal)
        );
        if (!areAdminServerBrandingSettingsEqual(verified.settings, desired)) {
            throw new AdminServerConfigurationError(
                'branding-save-failed',
                'The server did not confirm the requested Branding settings.'
            );
        }
        return verified;
    } catch (error) {
        return sanitize(error, 'branding-save-failed', "We couldn't save Branding settings.");
    }
}

function fileToBase64(file: File, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const reader = new FileReader();
        const abort = () => reader.abort();
        const cleanup = () => signal?.removeEventListener('abort', abort);
        signal?.addEventListener('abort', abort, { once: true });
        reader.onerror = () => {
            cleanup();
            reject(reader.error || new Error('File read failed'));
        };
        reader.onabort = () => {
            cleanup();
            reject(new DOMException('Aborted', 'AbortError'));
        };
        reader.onload = () => {
            cleanup();
            const result = typeof reader.result === 'string' ? reader.result : '';
            const separator = result.indexOf(',');
            if (separator < 0) reject(new Error('Invalid image data'));
            else resolve(result.slice(separator + 1));
        };
        reader.readAsDataURL(file);
    });
}

export async function uploadAdminServerSplashscreen(
    api: Api,
    file: File,
    signal?: AbortSignal
) {
    if (!file.type.startsWith('image/') || file.size <= 0
        || file.size > ADMIN_SERVER_SPLASHSCREEN_MAX_BYTES) {
        throw new AdminServerConfigurationError(
            'splashscreen-invalid',
            'Choose an image no larger than 10 MB.'
        );
    }
    try {
        const body = await fileToBase64(file, signal);
        await getImageApi(api).uploadCustomSplashscreen(
            { body: body as never },
            { headers: { 'Content-Type': file.type }, signal }
        );
    } catch (error) {
        return sanitize(error, 'splashscreen-save-failed', 'The splash screen image could not be uploaded.');
    }
}

export async function deleteAdminServerSplashscreen(api: Api, signal?: AbortSignal) {
    try {
        await getImageApi(api).deleteCustomSplashscreen({ signal });
    } catch (error) {
        return sanitize(error, 'splashscreen-save-failed', 'The splash screen image could not be deleted.');
    }
}

async function fetchNetworkDocument(api: Api, signal?: AbortSignal): Promise<NetworkConfiguration> {
    const response = await getConfigurationApi(api).getNamedConfiguration(
        { key: NETWORK_CONFIGURATION_KEY },
        { signal }
    );
    const document = response.data as unknown;
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
        throw new AdminServerConfigurationError('networking-load-failed', 'Networking settings could not be loaded.');
    }
    return document as NetworkConfiguration;
}

function createNetworkSnapshot(document: NetworkConfiguration) {
    const authority = {};
    networkAuthorityVault.set(authority, document);
    return createAdminServerNetworkingSnapshot(document, authority);
}

export async function loadAdminServerNetworking(
    api: Api,
    signal?: AbortSignal
): Promise<AdminServerNetworkingSnapshot> {
    try {
        return createNetworkSnapshot(await fetchNetworkDocument(api, signal));
    } catch (error) {
        return sanitize(error, 'networking-load-failed', 'Networking settings could not be loaded.');
    }
}

export async function saveAdminServerNetworking(
    api: Api,
    desired: AdminServerNetworkingSettings,
    confirmed: AdminServerNetworkingSnapshot,
    passwordChange: AdminServerCertificatePasswordChange,
    signal?: AbortSignal
): Promise<AdminServerNetworkingSaveResult> {
    requireAdminServerNetworkingSettings(desired);
    const baselineDocument = networkAuthorityVault.get(confirmed.authority);
    if (!baselineDocument) {
        throw new AdminServerConfigurationError(
            'networking-conflict',
            'Reload Networking settings before saving.'
        );
    }

    try {
        const authoritative = await fetchNetworkDocument(api, signal);
        const current = createNetworkSnapshot(authoritative);
        const passwordChanged = authoritative.CertificatePassword !== baselineDocument.CertificatePassword;
        if (passwordChanged || !areAdminServerNetworkingSettingsEqual(
            current.settings,
            confirmed.settings
        )) {
            throw new AdminServerConfigurationError(
                'networking-conflict',
                'Networking settings changed on the server while you were editing.'
            );
        }

        const patched = patchAdminServerNetworkingConfiguration(
            authoritative,
            desired,
            passwordChange
        );
        if (areAdminServerNetworkingSettingsEqual(current.settings, desired)
            && passwordChange.mode === 'unchanged') {
            return { snapshot: current, verification: 'confirmed' };
        }

        await getConfigurationApi(api).updateNamedConfiguration(
            { body: patched, key: NETWORK_CONFIGURATION_KEY },
            { signal }
        );
        try {
            const verifiedDocument = await fetchNetworkDocument(api, signal);
            const verified = createNetworkSnapshot(verifiedDocument);
            const passwordVerified = passwordChange.mode === 'unchanged'
                || verifiedDocument.CertificatePassword === patched.CertificatePassword;
            let certificatePasswordConfigured = desired.certificatePasswordConfigured;
            if (passwordChange.mode === 'clear') certificatePasswordConfigured = false;
            if (passwordChange.mode === 'replace') certificatePasswordConfigured = true;
            const expectedSettings: AdminServerNetworkingSettings = {
                ...desired,
                certificatePasswordConfigured
            };
            if (!passwordVerified || !areAdminServerNetworkingSettingsEqual(
                verified.settings,
                expectedSettings
            )) {
                throw new AdminServerConfigurationError(
                    'networking-save-failed',
                    'The server did not confirm the requested Networking settings.'
                );
            }
            return { snapshot: verified, verification: 'confirmed' };
        } catch (error) {
            if (error instanceof AdminServerConfigurationError) throw error;
            if (isAbortError(error)) throw error;
            return {
                snapshot: createNetworkSnapshot(patched),
                verification: 'connection-interrupted'
            };
        }
    } catch (error) {
        return sanitize(error, 'networking-save-failed', "We couldn't save Networking settings.");
    }
}

export function runAdminServerPowerAction(
    api: Api,
    action: 'restart' | 'shutdown',
    signal?: AbortSignal
) {
    let flights = powerFlights.get(api);
    if (!flights) {
        flights = new Map();
        powerFlights.set(api, flights);
    }
    const existing = flights.get(action);
    if (existing) return existing;

    const request = action === 'restart' ?
        getSystemApi(api).restartApplication({ signal }) :
        getSystemApi(api).shutdownApplication({ signal });
    const flight = request.then(() => undefined).catch(error => {
        if (isAbortError(error)) throw error;
        throw new AdminServerConfigurationError(
            'power-action-failed',
            action === 'restart' ?
                'The server restart request could not be confirmed.' :
                'The server shutdown request could not be confirmed.'
        );
    }).finally(() => {
        flights?.delete(action);
    });
    flights.set(action, flight);
    return flight;
}

/** Test-only inspection boundary: verifies no secret-bearing object is returned. */
export function hasAdminServerNetworkAuthority(snapshot: AdminServerNetworkingSnapshot) {
    return networkAuthorityVault.has(snapshot.authority);
}

export type { ServerConfiguration, SystemInfo };
