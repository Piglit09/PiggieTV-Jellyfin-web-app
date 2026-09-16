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
    previous: AdminLibraryDisplaySnapshot,
    attempted: AdminLibraryDisplaySnapshot
) {
    try {
        const current = await loadAdminLibraryDisplay(api);
        if (current.settings.useFileCreationTimeForDateAdded
            !== attempted.settings.useFileCreationTimeForDateAdded) {
            throw new AdminLibraryDisplayServiceError(
                'rollback-failed',
                'Library Display could not be restored after a failed save. Reload before trying again.'
            );
        }
        if (areAdminLibraryDisplaySettingsEqual(current.settings, attempted.settings)) {
            return;
        }
        if (hasAdminLibraryDisplayServerChanges(previous.settings, current.settings)) {
            throw new AdminLibraryDisplayServiceError(
                'rollback-failed',
                'Library Display could not be restored after a failed save. Reload before trying again.'
            );
        }
        await writeMetadataConfiguration(api, {
            ...current.metadataConfiguration,
            UseFileCreationTimeForDateAdded:
                previous.settings.useFileCreationTimeForDateAdded
        });
        const response = await getConfigurationApi(api).getNamedConfiguration({
            key: METADATA_CONFIGURATION_KEY
        });
        const verified = response.data as unknown as MetadataConfiguration;
        if (verified?.UseFileCreationTimeForDateAdded
            !== previous.settings.useFileCreationTimeForDateAdded) {
            throw new AdminLibraryDisplayServiceError(
                'rollback-failed',
                'Library Display could not be restored after a failed save. Reload before trying again.'
            );
        }
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
        attempted: AdminLibraryDisplaySnapshot;
        previous: AdminLibraryDisplaySnapshot;
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

async function verifyAdminLibraryDisplay(
    api: Api,
    signal?: AbortSignal
): Promise<AdminLibraryDisplaySnapshot> {
    try {
        return await loadAdminLibraryDisplay(api, signal);
    } catch (error) {
        if (isAbortError(error)) throw error;
        throw new AdminLibraryDisplayServiceError(
            'save-unverified',
            'Library Display settings were saved, but the latest server values could not be verified. Reload before saving again.'
        );
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
                attempted: createAdminLibraryDisplaySnapshot(
                    patched.serverConfiguration,
                    patched.metadataConfiguration
                ),
                previous: authoritative
            } : null,
            signal
        );
    }

    const verified = await verifyAdminLibraryDisplay(api, signal);
    if (!areAdminLibraryDisplaySettingsEqual(verified.settings, desiredSettings)) {
        throw new AdminLibraryDisplayServiceError(
            'save-unverified',
            'Library Display settings were saved, but the latest server values did not match the requested settings. Reload before saving again.'
        );
    }
    return verified;
}
