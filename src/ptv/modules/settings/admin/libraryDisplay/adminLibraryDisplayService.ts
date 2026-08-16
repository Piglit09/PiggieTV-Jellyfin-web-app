import type { Api } from '@jellyfin/sdk';
import type { MetadataConfiguration } from '@jellyfin/sdk/lib/generated-client/models/metadata-configuration';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';
import { getConfigurationApi } from '@jellyfin/sdk/lib/utils/api/configuration-api';

import {
    areAdminLibraryDisplaySettingsEqual,
    createAdminLibraryDisplaySnapshot,
    hasAdminLibraryDisplayMetadataChanges,
    hasAdminLibraryDisplayServerChanges,
    patchAdminLibraryDisplayDocuments,
    requireAdminLibraryDisplaySettings
} from './adminLibraryDisplayAdapters';
import {
    AdminLibraryDisplayServiceError,
    type AdminLibraryDisplaySettings,
    type AdminLibraryDisplaySnapshot
} from './adminLibraryDisplayModel';

const METADATA_CONFIGURATION_KEY = 'metadata';

function isAbortError(error: unknown) {
    return (
        (error instanceof DOMException && error.name === 'AbortError')
        || (typeof error === 'object' && error !== null && (
            Reflect.get(error, 'code') === 'ERR_CANCELED'
            || Reflect.get(error, 'name') === 'CanceledError'
        ))
    );
}

function toLoadError(error: unknown): never {
    if (error instanceof AdminLibraryDisplayServiceError || isAbortError(error)) throw error;
    throw new AdminLibraryDisplayServiceError(
        'load-unavailable',
        'Library display settings could not be loaded.'
    );
}

/** Loads the two independent configuration sources in parallel. */
export async function loadAdminLibraryDisplay(
    api: Api,
    signal?: AbortSignal
): Promise<AdminLibraryDisplaySnapshot> {
    const configurationApi = getConfigurationApi(api);
    try {
        const [ serverResponse, metadataResponse ] = await Promise.all([
            configurationApi.getConfiguration({ signal }),
            configurationApi.getNamedConfiguration(
                { key: METADATA_CONFIGURATION_KEY },
                { signal }
            )
        ]);
        return createAdminLibraryDisplaySnapshot(
            serverResponse.data,
            metadataResponse.data as unknown as MetadataConfiguration
        );
    } catch (error) {
        return toLoadError(error);
    }
}

async function writeServerConfiguration(
    api: Api,
    serverConfiguration: ServerConfiguration,
    signal?: AbortSignal
) {
    await getConfigurationApi(api).updateConfiguration(
        { serverConfiguration },
        { signal }
    );
}

async function writeMetadataConfiguration(
    api: Api,
    metadataConfiguration: MetadataConfiguration,
    signal?: AbortSignal
) {
    await getConfigurationApi(api).updateNamedConfiguration(
        {
            body: metadataConfiguration,
            key: METADATA_CONFIGURATION_KEY
        },
        { signal }
    );
}

function toSaveError(error: unknown): never {
    if (isAbortError(error)) throw error;
    throw new AdminLibraryDisplayServiceError(
        'save-failed',
        "We couldn't save Library Display settings."
    );
}

async function persistMetadataChange(
    api: Api,
    metadataConfiguration: MetadataConfiguration,
    signal?: AbortSignal
) {
    try {
        await writeMetadataConfiguration(api, metadataConfiguration, signal);
    } catch (error) {
        return toSaveError(error);
    }
}

async function restoreMetadataConfiguration(
    api: Api,
    previousConfiguration: MetadataConfiguration,
    attemptedConfiguration: MetadataConfiguration
) {
    try {
        const response = await getConfigurationApi(api).getNamedConfiguration({
            key: METADATA_CONFIGURATION_KEY
        });
        const current = response.data as unknown as MetadataConfiguration;
        if (typeof current?.UseFileCreationTimeForDateAdded !== 'boolean'
            || current.UseFileCreationTimeForDateAdded
                !== attemptedConfiguration.UseFileCreationTimeForDateAdded) {
            throw new AdminLibraryDisplayServiceError(
                'rollback-failed',
                'Library Display could not be restored after a failed save. Reload before trying again.'
            );
        }
        await writeMetadataConfiguration(api, {
            ...current,
            UseFileCreationTimeForDateAdded: previousConfiguration.UseFileCreationTimeForDateAdded
        });
    } catch {
        throw new AdminLibraryDisplayServiceError(
            'rollback-failed',
            'Library Display could not be restored after a failed save. Reload before trying again.'
        );
    }
}

async function persistServerChange(
    api: Api,
    serverConfiguration: ServerConfiguration,
    rollbackMetadata: Readonly<{
        attempted: MetadataConfiguration;
        previous: MetadataConfiguration;
    }> | null,
    signal?: AbortSignal
) {
    try {
        await writeServerConfiguration(api, serverConfiguration, signal);
    } catch (error) {
        if (rollbackMetadata) {
            // Compensation must still run if the original signal was cancelled.
            await restoreMetadataConfiguration(
                api,
                rollbackMetadata.previous,
                rollbackMetadata.attempted
            );
        }
        return toSaveError(error);
    }
}

/**
 * Re-reads both resources, rejects stale baselines, and writes only resources
 * whose managed values changed. When both change, the small named resource is
 * written first and restored if the subsequent full-config write fails.
 */
export async function saveAdminLibraryDisplay(
    api: Api,
    desiredSettings: AdminLibraryDisplaySettings,
    confirmedSettings: AdminLibraryDisplaySettings,
    signal?: AbortSignal
): Promise<AdminLibraryDisplaySnapshot> {
    requireAdminLibraryDisplaySettings(desiredSettings);
    requireAdminLibraryDisplaySettings(confirmedSettings);

    const authoritative = await loadAdminLibraryDisplay(api, signal);
    if (!areAdminLibraryDisplaySettingsEqual(authoritative.settings, confirmedSettings)) {
        throw new AdminLibraryDisplayServiceError(
            'conflict',
            'These settings changed on the server while you were editing. Reload before saving.'
        );
    }

    const serverChanged = hasAdminLibraryDisplayServerChanges(
        authoritative.settings,
        desiredSettings
    );
    const metadataChanged = hasAdminLibraryDisplayMetadataChanges(
        authoritative.settings,
        desiredSettings
    );
    if (!serverChanged && !metadataChanged) return authoritative;

    const patched = patchAdminLibraryDisplayDocuments(
        authoritative.serverConfiguration,
        authoritative.metadataConfiguration,
        desiredSettings
    );

    if (metadataChanged) {
        await persistMetadataChange(api, patched.metadataConfiguration, signal);
    }

    if (serverChanged) {
        await persistServerChange(
            api,
            patched.serverConfiguration,
            metadataChanged ? {
                attempted: patched.metadataConfiguration,
                previous: authoritative.metadataConfiguration
            } : null,
            signal
        );
    }

    return createAdminLibraryDisplaySnapshot(
        serverChanged ? patched.serverConfiguration : authoritative.serverConfiguration,
        metadataChanged ? patched.metadataConfiguration : authoritative.metadataConfiguration
    );
}
