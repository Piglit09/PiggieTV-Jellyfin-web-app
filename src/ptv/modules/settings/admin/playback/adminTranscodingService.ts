import type { Api } from '@jellyfin/sdk';
import { getConfigurationApi } from '@jellyfin/sdk/lib/utils/api/configuration-api';

import {
    areAdminTranscodingSettingsEqual,
    createAdminTranscodingSnapshot,
    patchAdminTranscodingConfiguration,
    requireAdminTranscodingSettings
} from './adminTranscodingAdapters';
import {
    AdminTranscodingServiceError,
    type AdminTranscodingSettings,
    type AdminTranscodingSnapshot
} from './adminTranscodingModel';

export const ENCODING_CONFIGURATION_KEY = 'encoding';

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
    if (error instanceof AdminTranscodingServiceError || isAbortError(error)) throw error;
    throw new AdminTranscodingServiceError(
        'load-unavailable',
        'Transcoding settings could not be loaded.'
    );
}

function toSaveError(error: unknown): never {
    if (isAbortError(error)) throw error;
    throw new AdminTranscodingServiceError(
        'save-failed',
        "We couldn't save Transcoding settings."
    );
}

/** Loads the complete authoritative named encoding configuration. */
export async function loadAdminTranscoding(
    api: Api,
    signal?: AbortSignal
): Promise<AdminTranscodingSnapshot> {
    try {
        const response = await getConfigurationApi(api).getNamedConfiguration(
            { key: ENCODING_CONFIGURATION_KEY },
            { signal }
        );
        return createAdminTranscodingSnapshot(response.data);
    } catch (error) {
        return toLoadError(error);
    }
}

async function writeAdminTranscoding(
    api: Api,
    snapshot: AdminTranscodingSnapshot,
    signal?: AbortSignal
) {
    try {
        await getConfigurationApi(api).updateNamedConfiguration({
            body: snapshot.configuration,
            key: ENCODING_CONFIGURATION_KEY
        }, { signal });
    } catch (error) {
        return toSaveError(error);
    }
}

async function verifyAdminTranscodingSave(
    api: Api,
    signal?: AbortSignal
): Promise<AdminTranscodingSnapshot> {
    try {
        return await loadAdminTranscoding(api, signal);
    } catch (error) {
        if (isAbortError(error)) throw error;
        throw new AdminTranscodingServiceError(
            'save-unverified',
            'Transcoding settings were saved, but the latest server values could not be verified. Reload before saving again.'
        );
    }
}

/**
 * Fresh-reads the named resource, rejects a stale managed baseline, deep-clones
 * the authoritative document, and persists only explicitly managed changes.
 */
export async function saveAdminTranscoding(
    api: Api,
    desiredSettings: AdminTranscodingSettings,
    confirmedSettings: AdminTranscodingSettings,
    signal?: AbortSignal
): Promise<AdminTranscodingSnapshot> {
    const desired = requireAdminTranscodingSettings(desiredSettings);
    const confirmed = requireAdminTranscodingSettings(confirmedSettings);
    const authoritative = await loadAdminTranscoding(api, signal);

    if (!areAdminTranscodingSettingsEqual(authoritative.settings, confirmed)) {
        throw new AdminTranscodingServiceError(
            'conflict',
            'These settings changed on the server while you were editing. Reload before saving.'
        );
    }

    if (areAdminTranscodingSettingsEqual(authoritative.settings, desired)) {
        return authoritative;
    }

    const saved = createAdminTranscodingSnapshot(patchAdminTranscodingConfiguration(
        authoritative.configuration,
        desired
    ));
    await writeAdminTranscoding(api, saved, signal);
    const verified = await verifyAdminTranscodingSave(api, signal);
    if (!areAdminTranscodingSettingsEqual(verified.settings, desired)) {
        throw new AdminTranscodingServiceError(
            'save-unverified',
            'Transcoding settings were saved, but the latest server values did not match the requested settings. Reload before saving again.'
        );
    }
    return verified;
}
