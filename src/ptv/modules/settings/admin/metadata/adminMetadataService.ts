import type { Api } from '@jellyfin/sdk';
import type { CountryInfo } from '@jellyfin/sdk/lib/generated-client/models/country-info';
import type { CultureDto } from '@jellyfin/sdk/lib/generated-client/models/culture-dto';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';
import { getConfigurationApi } from '@jellyfin/sdk/lib/utils/api/configuration-api';
import { getLocalizationApi } from '@jellyfin/sdk/lib/utils/api/localization-api';

import {
    areAdminMetadataSettingsEqual,
    createAdminMetadataSnapshot,
    patchAdminMetadataConfiguration,
    requireAdminMetadataSettings
} from './adminMetadataAdapters';
import {
    AdminMetadataServiceError,
    type AdminMetadataSettings,
    type AdminMetadataSnapshot
} from './adminMetadataModel';

function isAbortError(error: unknown) {
    return (
        (typeof DOMException !== 'undefined'
            && error instanceof DOMException
            && error.name === 'AbortError')
        || (typeof error === 'object' && error !== null && (
            Reflect.get(error, 'code') === 'ERR_CANCELED'
            || Reflect.get(error, 'name') === 'AbortError'
            || Reflect.get(error, 'name') === 'CanceledError'
        ))
    );
}

function sanitizeLoadError(error: unknown): never {
    if (error instanceof AdminMetadataServiceError || isAbortError(error)) throw error;
    throw new AdminMetadataServiceError(
        'load-unavailable',
        'Metadata settings could not be loaded.'
    );
}

export async function loadAdminMetadataConfiguration(
    api: Api,
    signal?: AbortSignal
): Promise<AdminMetadataSnapshot> {
    try {
        const response = await getConfigurationApi(api).getConfiguration({ signal });
        return createAdminMetadataSnapshot(response.data);
    } catch (error) {
        return sanitizeLoadError(error);
    }
}

export async function loadAdminMetadataCultures(
    api: Api,
    signal?: AbortSignal
): Promise<CultureDto[]> {
    try {
        const response = await getLocalizationApi(api).getCultures({ signal });
        if (!Array.isArray(response.data)) throw new Error('Invalid culture catalog');
        return response.data;
    } catch (error) {
        if (isAbortError(error)) throw error;
        throw new AdminMetadataServiceError(
            'cultures-unavailable',
            'Metadata languages are temporarily unavailable.'
        );
    }
}

export async function loadAdminMetadataCountries(
    api: Api,
    signal?: AbortSignal
): Promise<CountryInfo[]> {
    try {
        const response = await getLocalizationApi(api).getCountries({ signal });
        if (!Array.isArray(response.data)) throw new Error('Invalid country catalog');
        return response.data;
    } catch (error) {
        if (isAbortError(error)) throw error;
        throw new AdminMetadataServiceError(
            'countries-unavailable',
            'Metadata countries are temporarily unavailable.'
        );
    }
}

async function updateAdminMetadataConfiguration(
    api: Api,
    serverConfiguration: ServerConfiguration,
    signal?: AbortSignal
) {
    try {
        await getConfigurationApi(api).updateConfiguration(
            { serverConfiguration },
            { signal }
        );
    } catch (error) {
        if (isAbortError(error)) throw error;
        throw new AdminMetadataServiceError(
            'save-failed',
            "We couldn't save Metadata settings."
        );
    }
}

async function verifyAdminMetadataConfiguration(
    api: Api,
    signal?: AbortSignal
): Promise<AdminMetadataSnapshot> {
    try {
        return await loadAdminMetadataConfiguration(api, signal);
    } catch (error) {
        if (isAbortError(error)) throw error;
        throw new AdminMetadataServiceError(
            'save-unverified',
            'Metadata settings were saved, but the latest server values could not be verified. Reload before saving again.'
        );
    }
}

/** Refetches, detects a managed-field conflict, then patches the full document. */
export async function saveAdminMetadata(
    api: Api,
    desiredSettings: AdminMetadataSettings,
    confirmedSettings: AdminMetadataSettings,
    signal?: AbortSignal
): Promise<AdminMetadataSnapshot> {
    requireAdminMetadataSettings(desiredSettings);
    requireAdminMetadataSettings(confirmedSettings);

    const authoritative = await loadAdminMetadataConfiguration(api, signal);
    if (!areAdminMetadataSettingsEqual(authoritative.settings, confirmedSettings)) {
        throw new AdminMetadataServiceError(
            'conflict',
            'These settings changed on the server while you were editing. Reload before saving.'
        );
    }
    if (areAdminMetadataSettingsEqual(authoritative.settings, desiredSettings)) {
        return authoritative;
    }

    const patched = patchAdminMetadataConfiguration(
        authoritative.serverConfiguration,
        desiredSettings
    );
    await updateAdminMetadataConfiguration(api, patched, signal);
    const verified = await verifyAdminMetadataConfiguration(api, signal);
    if (!areAdminMetadataSettingsEqual(verified.settings, desiredSettings)) {
        throw new AdminMetadataServiceError(
            'save-unverified',
            'Metadata settings were saved, but the latest server values did not match the requested settings. Reload before saving again.'
        );
    }
    return verified;
}
