import { getCurrentPtvPluginApiClient } from '../../../../core/pluginApi';
import type { AdminMetadataManagerServiceError } from './adminMetadataManagerModel';
import {
    normalizeAdminReadingMetadataProviders,
    normalizeAdminReadingMetadataSearchResponse
} from './adminReadingMetadataAdapters';
import type {
    AdminReadingMetadataSearchRequest,
    AdminReadingMetadataSearchResponse,
    AdminReadingMetadataProvidersResponse
} from './adminReadingMetadataModel';

export type AdminReadingMetadataApiClient = NonNullable<ReturnType<typeof getCurrentPtvPluginApiClient>>;

function requireClient(client?: AdminReadingMetadataApiClient | null) {
    if (!client?.searchReadingMetadata || !client.getReadingMetadataProviders) {
        const error = new Error('The PiggieTV Reading identification service is unavailable.') as AdminMetadataManagerServiceError;
        throw error;
    }
    return client;
}

export async function loadAdminReadingMetadataProviders(
    client: AdminReadingMetadataApiClient | null | undefined,
    signal?: AbortSignal
): Promise<AdminReadingMetadataProvidersResponse> {
    try {
        const response = await requireClient(client).getReadingMetadataProviders<unknown>({ signal });
        return normalizeAdminReadingMetadataProviders(response);
    } catch {
        throw new Error('Reading metadata providers are temporarily unavailable.');
    }
}

export async function searchAdminReadingMetadata(
    client: AdminReadingMetadataApiClient | null | undefined,
    request: AdminReadingMetadataSearchRequest,
    signal?: AbortSignal
): Promise<AdminReadingMetadataSearchResponse> {
    try {
        const response = await requireClient(client).searchReadingMetadata<unknown, AdminReadingMetadataSearchRequest>(
            request,
            { signal }
        );
        return normalizeAdminReadingMetadataSearchResponse(response);
    } catch {
        throw new Error('Reading identification results could not be loaded.');
    }
}
