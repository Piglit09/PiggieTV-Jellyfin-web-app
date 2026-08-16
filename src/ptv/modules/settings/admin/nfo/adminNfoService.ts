import type { Api } from '@jellyfin/sdk';
import { getConfigurationApi } from '@jellyfin/sdk/lib/utils/api/configuration-api';
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api';

import {
    areAdminNfoSettingsEqual,
    createAdminNfoSnapshot,
    normalizeAdminNfoUsers,
    patchAdminNfoConfiguration,
    requireAdminNfoSettings
} from './adminNfoAdapters';
import {
    AdminNfoServiceError,
    type AdminNfoSettings,
    type AdminNfoSnapshot,
    type AdminNfoUserOption
} from './adminNfoModel';

export const NFO_CONFIGURATION_KEY = 'xbmcmetadata';

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

function toLoadError(error: unknown): never {
    if (error instanceof AdminNfoServiceError || isAbortError(error)) throw error;
    throw new AdminNfoServiceError(
        'load-unavailable',
        'NFO settings could not be loaded.'
    );
}

function toUsersError(error: unknown): never {
    if (error instanceof AdminNfoServiceError || isAbortError(error)) throw error;
    throw new AdminNfoServiceError(
        'users-unavailable',
        'NFO watch-data users could not be loaded.'
    );
}

function toSaveError(error: unknown): never {
    if (isAbortError(error)) throw error;
    throw new AdminNfoServiceError(
        'save-failed',
        "We couldn't save NFO settings."
    );
}

export async function loadAdminNfo(
    api: Api,
    signal?: AbortSignal
): Promise<AdminNfoSnapshot> {
    try {
        const response = await getConfigurationApi(api).getNamedConfiguration(
            { key: NFO_CONFIGURATION_KEY },
            { signal }
        );
        return createAdminNfoSnapshot(response.data);
    } catch (error) {
        return toLoadError(error);
    }
}

/** Optional enrichment kept independent from the authoritative NFO document. */
export async function loadAdminNfoUsers(
    api: Api,
    signal?: AbortSignal
): Promise<AdminNfoUserOption[]> {
    try {
        const response = await getUserApi(api).getUsers({}, { signal });
        return normalizeAdminNfoUsers(response.data);
    } catch (error) {
        return toUsersError(error);
    }
}

async function writeAdminNfo(
    api: Api,
    snapshot: AdminNfoSnapshot,
    signal?: AbortSignal
) {
    try {
        await getConfigurationApi(api).updateNamedConfiguration({
            body: snapshot.configuration,
            key: NFO_CONFIGURATION_KEY
        }, { signal });
    } catch (error) {
        return toSaveError(error);
    }
}

/**
 * Re-reads the named resource, rejects a stale managed baseline, and replaces
 * only the four fields owned by the native NFO page.
 */
export async function saveAdminNfo(
    api: Api,
    desiredSettings: AdminNfoSettings,
    confirmedSettings: AdminNfoSettings,
    signal?: AbortSignal
): Promise<AdminNfoSnapshot> {
    const desired = requireAdminNfoSettings(desiredSettings);
    const confirmed = requireAdminNfoSettings(confirmedSettings);
    const authoritative = await loadAdminNfo(api, signal);

    if (!areAdminNfoSettingsEqual(authoritative.settings, confirmed)) {
        throw new AdminNfoServiceError(
            'conflict',
            'These settings changed on the server while you were editing. Reload before saving.'
        );
    }

    if (areAdminNfoSettingsEqual(authoritative.settings, desired)) {
        return authoritative;
    }

    const saved = createAdminNfoSnapshot(patchAdminNfoConfiguration(
        authoritative.configuration,
        desired
    ));
    await writeAdminNfo(api, saved, signal);
    return saved;
}
