import type { Api } from '@jellyfin/sdk';
import type { ListingsProviderInfo } from '@jellyfin/sdk/lib/generated-client/models/listings-provider-info';
import type { TunerHostInfo } from '@jellyfin/sdk/lib/generated-client/models/tuner-host-info';
import { getConfigurationApi } from '@jellyfin/sdk/lib/utils/api/configuration-api';
import { getLiveTvApi } from '@jellyfin/sdk/lib/utils/api/live-tv-api';

import {
    areAdminLiveTvDvrSettingsEqual,
    createAdminLiveTvConfigurationSnapshot,
    createAdminLiveTvTunerDraft,
    normalizeAdminLiveTvCapability,
    normalizeAdminLiveTvCountries,
    normalizeAdminLiveTvLineups,
    normalizeAdminLiveTvProvider,
    normalizeAdminLiveTvTuner,
    normalizeAdminLiveTvTunerTypes,
    patchAdminLiveTvDvrConfiguration,
    patchAdminLiveTvTuner,
    patchAdminSchedulesDirectAccount,
    patchAdminSchedulesDirectListing,
    patchAdminXmlTvProvider
} from './adminLiveTvAdapters';
import {
    AdminLiveTvServiceError,
    type AdminLiveTvCapability,
    type AdminLiveTvConfigurationDocument,
    type AdminLiveTvConfigurationSnapshot,
    type AdminLiveTvCountry,
    type AdminLiveTvDvrSettings,
    type AdminLiveTvGuideProvider,
    type AdminLiveTvLineup,
    type AdminLiveTvSchedulesDirectAccountDraft,
    type AdminLiveTvSchedulesDirectListingDraft,
    type AdminLiveTvTuner,
    type AdminLiveTvTunerDraft,
    type AdminLiveTvTunerType,
    type AdminLiveTvXmlTvDraft
} from './adminLiveTvModel';

export const LIVE_TV_CONFIGURATION_KEY = 'livetv';

const operationFlights = new WeakMap<Api, Map<string, Promise<unknown>>>();

function isAbortError(error: unknown) {
    return (
        (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError')
        || (typeof error === 'object' && error !== null && (
            Reflect.get(error, 'code') === 'ERR_CANCELED'
            || Reflect.get(error, 'name') === 'CanceledError'
        ))
    );
}

function responseStatus(error: unknown) {
    if (!error || typeof error !== 'object') return null;
    const response = Reflect.get(error, 'response');
    return response && typeof response === 'object' ? Reflect.get(response, 'status') : null;
}

function toLoadError(error: unknown): never {
    if (error instanceof AdminLiveTvServiceError || isAbortError(error)) throw error;
    throw new AdminLiveTvServiceError('load-unavailable', 'Live TV configuration could not be loaded.');
}

function toOperationError(error: unknown, message: string): never {
    if (error instanceof AdminLiveTvServiceError || isAbortError(error)) throw error;
    if (responseStatus(error) === 404) {
        throw new AdminLiveTvServiceError('not-found', 'This Live TV resource is no longer available.');
    }
    throw new AdminLiveTvServiceError('operation-failed', message);
}

function singleFlight<T>(api: Api, key: string, operation: () => Promise<T>): Promise<T> {
    let flights = operationFlights.get(api);
    if (!flights) {
        flights = new Map();
        operationFlights.set(api, flights);
    }
    const existing = flights.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const flight = operation().finally(() => flights?.delete(key));
    flights.set(key, flight);
    return flight;
}

function requireDocument(value: unknown): AdminLiveTvConfigurationDocument {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new AdminLiveTvServiceError('invalid-response', 'Live TV configuration could not be read.');
    }
    return value as AdminLiveTvConfigurationDocument;
}

async function loadRawAdminLiveTvConfiguration(
    api: Api,
    signal?: AbortSignal
): Promise<AdminLiveTvConfigurationDocument> {
    const response = await getConfigurationApi(api).getNamedConfiguration(
        { key: LIVE_TV_CONFIGURATION_KEY },
        { signal }
    );
    return requireDocument(response.data);
}

/** Loads and immediately redacts the shared named configuration for UI use. */
export async function loadAdminLiveTvConfiguration(
    api: Api,
    signal?: AbortSignal
): Promise<AdminLiveTvConfigurationSnapshot> {
    try {
        return createAdminLiveTvConfigurationSnapshot(
            await loadRawAdminLiveTvConfiguration(api, signal)
        );
    } catch (error) {
        return toLoadError(error);
    }
}

export async function loadAdminLiveTvCapability(
    api: Api,
    signal?: AbortSignal
): Promise<AdminLiveTvCapability> {
    try {
        const response = await getLiveTvApi(api).getLiveTvInfo({ signal });
        return normalizeAdminLiveTvCapability(response.data);
    } catch (error) {
        return toLoadError(error);
    }
}

export async function loadAdminLiveTvTunerTypes(
    api: Api,
    signal?: AbortSignal
): Promise<AdminLiveTvTunerType[]> {
    try {
        const response = await getLiveTvApi(api).getTunerHostTypes({ signal });
        return normalizeAdminLiveTvTunerTypes(response.data);
    } catch (error) {
        return toLoadError(error);
    }
}

export async function discoverAdminLiveTvTuners(
    api: Api,
    signal?: AbortSignal
): Promise<AdminLiveTvTunerDraft[]> {
    try {
        const response = await getLiveTvApi(api).discoverTuners(
            { newDevicesOnly: true },
            { signal }
        );
        if (!Array.isArray(response.data)) {
            throw new AdminLiveTvServiceError('invalid-response', 'Discovered tuners could not be read.');
        }
        return response.data.map(raw => createAdminLiveTvTunerDraft(raw.Type || '', raw));
    } catch (error) {
        return toOperationError(error, 'Tuners could not be discovered.');
    }
}

async function confirmConfigurationAfterWrite(api: Api, signal?: AbortSignal) {
    try {
        return await loadAdminLiveTvConfiguration(api, signal);
    } catch (error) {
        if (isAbortError(error)) throw error;
        throw new AdminLiveTvServiceError(
            'save-confirmation-failed',
            'The server accepted the change, but its updated Live TV configuration could not be confirmed.'
        );
    }
}

export function saveAdminLiveTvDvr(
    api: Api,
    desired: AdminLiveTvDvrSettings,
    confirmed: AdminLiveTvDvrSettings,
    signal?: AbortSignal
) {
    return singleFlight(api, 'dvr:save', async () => {
        try {
            const authoritative = await loadRawAdminLiveTvConfiguration(api, signal);
            const current = createAdminLiveTvConfigurationSnapshot(authoritative).dvr;
            if (!areAdminLiveTvDvrSettingsEqual(current, confirmed)) {
                throw new AdminLiveTvServiceError(
                    'conflict',
                    'These DVR settings changed on the server while you were editing. Reload before saving.'
                );
            }
            if (areAdminLiveTvDvrSettingsEqual(current, desired)) {
                return createAdminLiveTvConfigurationSnapshot(authoritative);
            }
            await getConfigurationApi(api).updateNamedConfiguration({
                body: patchAdminLiveTvDvrConfiguration(authoritative, desired),
                key: LIVE_TV_CONFIGURATION_KEY
            }, { signal });
            // The server updates MediaLocationsCreated asynchronously after path changes.
            return await confirmConfigurationAfterWrite(api, signal);
        } catch (error) {
            return toOperationError(error, "We couldn't save DVR settings.");
        }
    });
}

function findRawTuner(configuration: AdminLiveTvConfigurationDocument, id: string) {
    const normalizedId = id.trim().toLowerCase();
    return configuration.TunerHosts?.find(tuner => tuner.Id?.toLowerCase() === normalizedId) as
        (TunerHostInfo & Record<string, unknown>) | undefined;
}

function findRawProvider(configuration: AdminLiveTvConfigurationDocument, id: string) {
    const normalizedId = id.trim().toLowerCase();
    return configuration.ListingProviders?.find(provider => provider.Id?.toLowerCase() === normalizedId) as
        (ListingsProviderInfo & Record<string, unknown>) | undefined;
}

function equalProjection(left: unknown, right: unknown) {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function saveAdminLiveTvTuner(
    api: Api,
    draft: AdminLiveTvTunerDraft,
    confirmed?: AdminLiveTvTuner,
    signal?: AbortSignal
) {
    const key = `tuner:save:${draft.id.trim().toLowerCase() || 'new'}`;
    return singleFlight(api, key, async () => {
        try {
            const configuration = await loadRawAdminLiveTvConfiguration(api, signal);
            const raw = draft.id ? findRawTuner(configuration, draft.id) : undefined;
            if (draft.id && !raw) {
                throw new AdminLiveTvServiceError('not-found', 'This tuner is no longer configured.');
            }
            if (raw && confirmed && !equalProjection(normalizeAdminLiveTvTuner(raw), confirmed)) {
                throw new AdminLiveTvServiceError('conflict', 'This tuner changed on the server. Reload before saving.');
            }
            const body = patchAdminLiveTvTuner(raw || {}, draft);
            await getLiveTvApi(api).addTunerHost({ tunerHostInfo: body }, { signal });
            return await confirmConfigurationAfterWrite(api, signal);
        } catch (error) {
            return toOperationError(error, "We couldn't save this tuner.");
        }
    });
}

export function deleteAdminLiveTvTuner(api: Api, id: string, signal?: AbortSignal) {
    const normalizedId = id.trim();
    if (!normalizedId) return Promise.reject(new AdminLiveTvServiceError('invalid-input', 'Tuner identifier is unavailable.'));
    return singleFlight(api, `tuner:delete:${normalizedId.toLowerCase()}`, async () => {
        try {
            const configuration = await loadRawAdminLiveTvConfiguration(api, signal);
            if (!findRawTuner(configuration, normalizedId)) {
                throw new AdminLiveTvServiceError('not-found', 'This tuner is no longer configured.');
            }
            await getLiveTvApi(api).deleteTunerHost({ id: normalizedId }, { signal });
            return await confirmConfigurationAfterWrite(api, signal);
        } catch (error) {
            return toOperationError(error, "We couldn't remove this tuner.");
        }
    });
}

async function defaultProvider(api: Api, signal?: AbortSignal) {
    const response = await getLiveTvApi(api).getDefaultListingProvider({ signal });
    return requireDocument(response.data) as ListingsProviderInfo & Record<string, unknown>;
}

export function saveAdminXmlTvProvider(
    api: Api,
    draft: AdminLiveTvXmlTvDraft,
    confirmed?: AdminLiveTvGuideProvider,
    signal?: AbortSignal
) {
    const key = `provider:xmltv:${draft.id.trim().toLowerCase() || 'new'}`;
    return singleFlight(api, key, async () => {
        try {
            const configuration = await loadRawAdminLiveTvConfiguration(api, signal);
            const raw = draft.id ? findRawProvider(configuration, draft.id) : await defaultProvider(api, signal);
            if (!raw) throw new AdminLiveTvServiceError('not-found', 'This guide provider is no longer configured.');
            if (draft.id && confirmed && !equalProjection(normalizeAdminLiveTvProvider(raw), confirmed)) {
                throw new AdminLiveTvServiceError('conflict', 'This guide provider changed on the server. Reload before saving.');
            }
            const body = patchAdminXmlTvProvider(raw, draft);
            await getLiveTvApi(api).addListingProvider({
                listingsProviderInfo: body,
                validateListings: true
            }, { signal });
            return await confirmConfigurationAfterWrite(api, signal);
        } catch (error) {
            return toOperationError(error, "We couldn't save this XMLTV provider.");
        }
    });
}

/** Explicit credential action. A blank password preserves an existing opaque password. */
export function connectAdminSchedulesDirect(
    api: Api,
    draft: AdminLiveTvSchedulesDirectAccountDraft,
    confirmed?: AdminLiveTvGuideProvider,
    signal?: AbortSignal
) {
    const key = `provider:sd-account:${draft.id.trim().toLowerCase() || 'new'}`;
    return singleFlight(api, key, async () => {
        try {
            const configuration = await loadRawAdminLiveTvConfiguration(api, signal);
            const raw = draft.id ? findRawProvider(configuration, draft.id) : await defaultProvider(api, signal);
            if (!raw) throw new AdminLiveTvServiceError('not-found', 'This guide provider is no longer configured.');
            if (draft.id && confirmed && !equalProjection(normalizeAdminLiveTvProvider(raw), confirmed)) {
                throw new AdminLiveTvServiceError('conflict', 'This guide provider changed on the server. Reload before saving.');
            }
            const body = patchAdminSchedulesDirectAccount(raw, draft);
            await getLiveTvApi(api).addListingProvider({
                listingsProviderInfo: body,
                validateLogin: true
            }, { signal });
            return await confirmConfigurationAfterWrite(api, signal);
        } catch (error) {
            return toOperationError(error, "We couldn't connect this Schedules Direct account.");
        }
    });
}

export function saveAdminSchedulesDirectListing(
    api: Api,
    draft: AdminLiveTvSchedulesDirectListingDraft,
    confirmed: AdminLiveTvGuideProvider,
    signal?: AbortSignal
) {
    const key = `provider:sd-listing:${draft.id.trim().toLowerCase()}`;
    return singleFlight(api, key, async () => {
        try {
            const configuration = await loadRawAdminLiveTvConfiguration(api, signal);
            const raw = findRawProvider(configuration, draft.id);
            if (!raw) throw new AdminLiveTvServiceError('not-found', 'This guide provider is no longer configured.');
            if (!equalProjection(normalizeAdminLiveTvProvider(raw), confirmed)) {
                throw new AdminLiveTvServiceError('conflict', 'This guide provider changed on the server. Reload before saving.');
            }
            await getLiveTvApi(api).addListingProvider({
                listingsProviderInfo: patchAdminSchedulesDirectListing(raw, draft),
                validateListings: true
            }, { signal });
            return await confirmConfigurationAfterWrite(api, signal);
        } catch (error) {
            return toOperationError(error, "We couldn't save this Schedules Direct lineup.");
        }
    });
}

export function deleteAdminLiveTvProvider(api: Api, id: string, signal?: AbortSignal) {
    const normalizedId = id.trim();
    if (!normalizedId) return Promise.reject(new AdminLiveTvServiceError('invalid-input', 'Provider identifier is unavailable.'));
    return singleFlight(api, `provider:delete:${normalizedId.toLowerCase()}`, async () => {
        try {
            const configuration = await loadRawAdminLiveTvConfiguration(api, signal);
            if (!findRawProvider(configuration, normalizedId)) {
                throw new AdminLiveTvServiceError('not-found', 'This guide provider is no longer configured.');
            }
            await getLiveTvApi(api).deleteListingProvider({ id: normalizedId }, { signal });
            return await confirmConfigurationAfterWrite(api, signal);
        } catch (error) {
            return toOperationError(error, "We couldn't remove this guide provider.");
        }
    });
}

async function parseCountryResponse(value: unknown) {
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
        try {
            return JSON.parse(await value.text()) as unknown;
        } catch {
            throw new AdminLiveTvServiceError('invalid-response', 'Schedules Direct countries could not be read.');
        }
    }
    return value;
}

/** Explicit-only lookup; callers must not mount this query automatically. */
export async function loadAdminSchedulesDirectCountries(api: Api, signal?: AbortSignal): Promise<AdminLiveTvCountry[]> {
    try {
        const response = await getLiveTvApi(api).getSchedulesDirectCountries({ signal });
        return normalizeAdminLiveTvCountries(await parseCountryResponse(response.data));
    } catch (error) {
        return toOperationError(error, 'Schedules Direct countries could not be loaded.');
    }
}

/** Explicit-only lookup for a previously connected provider. */
export async function loadAdminSchedulesDirectLineups(
    api: Api,
    providerId: string,
    country: string,
    postalCode: string,
    signal?: AbortSignal
): Promise<AdminLiveTvLineup[]> {
    const id = providerId.trim();
    if (!id || !country.trim() || !postalCode.trim()) {
        throw new AdminLiveTvServiceError('invalid-input', 'Connect an account and choose a country and postal code first.');
    }
    try {
        const response = await getLiveTvApi(api).getLineups({
            country: country.trim(),
            id,
            location: postalCode.trim()
        }, { signal });
        return normalizeAdminLiveTvLineups(response.data);
    } catch (error) {
        return toOperationError(error, 'Schedules Direct lineups could not be loaded.');
    }
}
