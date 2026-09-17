import { getCurrentPtvPluginApiClient } from '../../../../core/pluginApi';
import {
    normalizeAdminMetadataQualityAiStatus,
    normalizeAdminMetadataQualityAiTestResult,
    normalizeAdminMetadataQualityDetail,
    normalizeAdminMetadataQualityResultPage,
    normalizeAdminMetadataQualitySettings,
    normalizeAdminMetadataQualitySummary
} from './adminMetadataQualityAdapters';
import {
    ADMIN_METADATA_QUALITY_PAGE_SIZE,
    AdminMetadataQualityServiceError,
    type AdminMetadataQualityAiTestResult,
    type AdminMetadataQualityFilters,
    type AdminMetadataQualityResolutionAction,
    type AdminMetadataQualityScanMode,
    type AdminMetadataQualitySettings
} from './adminMetadataQualityModel';

export type AdminMetadataQualityApiClient = NonNullable<ReturnType<typeof getCurrentPtvPluginApiClient>>;

function requireClient(client?: AdminMetadataQualityApiClient | null) {
    if (!client) {
        throw new AdminMetadataQualityServiceError(
            'load-unavailable',
            'The PiggieTV Metadata Quality service is unavailable.'
        );
    }
    return client;
}

function requireItemId(itemId: string) {
    const normalized = itemId.trim();
    if (!normalized || normalized.includes('/') || normalized.includes('\\')) {
        throw new AdminMetadataQualityServiceError('invalid-input', 'This metadata result is invalid.');
    }
    return normalized;
}

function hasControlCharacters(value: string) {
    return Array.from(value).some(character => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
    });
}

function requireMatchingItemId(expectedItemId: string, actualItemId: string) {
    if (expectedItemId.localeCompare(actualItemId, undefined, { sensitivity: 'accent' }) !== 0) {
        throw new AdminMetadataQualityServiceError(
            'not-found',
            'This Metadata Quality result is no longer available.'
        );
    }
}

function requireAiModel(model: string) {
    const normalized = model.trim();
    if (!normalized || normalized.length > 256 || hasControlCharacters(normalized)) {
        throw new AdminMetadataQualityServiceError(
            'invalid-input',
            'Enter a valid OpenAI API model ID before testing the connection.'
        );
    }
    return normalized;
}

function resultParams(filters: AdminMetadataQualityFilters) {
    return {
        aiReviewed: filters.aiReviewed === 'all' ? undefined : filters.aiReviewed === 'true',
        itemType: filters.itemType.trim() || undefined,
        libraryId: filters.libraryId.trim() || undefined,
        limit: ADMIN_METADATA_QUALITY_PAGE_SIZE,
        maxConfidence: filters.maxConfidence ?? undefined,
        minConfidence: filters.minConfidence ?? undefined,
        provider: filters.provider.trim() || undefined,
        reason: filters.reason.trim() || undefined,
        search: filters.search.trim() || undefined,
        sort: filters.sort,
        startIndex: Math.max(0, Math.floor(filters.startIndex)),
        status: filters.status === 'all' ? undefined : filters.status
    };
}

function loadError(message: string) {
    return new AdminMetadataQualityServiceError('load-unavailable', message);
}

function errorStatus(error: unknown) {
    if (!error || typeof error !== 'object') return null;
    const record = error as Record<string, unknown>;
    if (typeof record.status === 'number') return record.status;
    if (typeof record.statusCode === 'number') return record.statusCode;
    const response = record.response;
    if (response && typeof response === 'object' && typeof (response as Record<string, unknown>).status === 'number') {
        return (response as Record<string, unknown>).status;
    }
    return null;
}

export async function loadAdminMetadataQualitySummary(
    client: AdminMetadataQualityApiClient | null | undefined,
    signal?: AbortSignal
) {
    try {
        const response = await requireClient(client).getMetadataQualitySummary<unknown>({ signal });
        return normalizeAdminMetadataQualitySummary(response);
    } catch (error) {
        if (error instanceof AdminMetadataQualityServiceError) throw error;
        throw loadError("Metadata Quality status couldn't be loaded.");
    }
}

export async function loadAdminMetadataQualityResults(
    client: AdminMetadataQualityApiClient | null | undefined,
    filters: AdminMetadataQualityFilters,
    signal?: AbortSignal
) {
    try {
        const response = await requireClient(client).getMetadataQualityResults<unknown>(resultParams(filters), { signal });
        return normalizeAdminMetadataQualityResultPage(response);
    } catch (error) {
        if (error instanceof AdminMetadataQualityServiceError) throw error;
        throw loadError("Metadata Quality results couldn't be loaded.");
    }
}

export async function loadAdminMetadataQualityDetail(
    client: AdminMetadataQualityApiClient | null | undefined,
    itemId: string,
    signal?: AbortSignal
) {
    try {
        const normalizedItemId = requireItemId(itemId);
        const response = await requireClient(client).getMetadataQualityResult<unknown>(normalizedItemId, { signal });
        const detail = normalizeAdminMetadataQualityDetail(response);
        if (!detail) throw new AdminMetadataQualityServiceError('not-found', 'This Metadata Quality result is no longer available.');
        requireMatchingItemId(normalizedItemId, detail.itemId);
        return detail;
    } catch (error) {
        if (error instanceof AdminMetadataQualityServiceError) throw error;
        throw loadError("This Metadata Quality result couldn't be loaded.");
    }
}

export async function loadAdminMetadataQualitySettings(
    client: AdminMetadataQualityApiClient | null | undefined,
    signal?: AbortSignal
) {
    try {
        const response = await requireClient(client).getMetadataQualitySettings<unknown>({ signal });
        return normalizeAdminMetadataQualitySettings(response);
    } catch (error) {
        if (error instanceof AdminMetadataQualityServiceError) throw error;
        throw loadError("Metadata Quality settings couldn't be loaded.");
    }
}

export async function loadAdminMetadataQualityAiStatus(
    client: AdminMetadataQualityApiClient | null | undefined,
    signal?: AbortSignal
) {
    try {
        const response = await requireClient(client).getMetadataQualityStatus<unknown>({ signal });
        return normalizeAdminMetadataQualityAiStatus(response);
    } catch (error) {
        if (error instanceof AdminMetadataQualityServiceError) throw error;
        throw loadError("OpenAI configuration status couldn't be loaded.");
    }
}

export async function testAdminMetadataQualityAiConnection(
    client: AdminMetadataQualityApiClient | null | undefined,
    model: string
): Promise<AdminMetadataQualityAiTestResult> {
    try {
        const response = await requireClient(client).testMetadataQualityAiConnection<unknown, { model: string }>({
            model: requireAiModel(model)
        });
        return normalizeAdminMetadataQualityAiTestResult(response);
    } catch (error) {
        if (error instanceof AdminMetadataQualityServiceError) throw error;
        throw new AdminMetadataQualityServiceError(
            'action-unavailable',
            "The OpenAI connection test couldn't be completed."
        );
    }
}

export async function startAdminMetadataQualityScan(
    client: AdminMetadataQualityApiClient | null | undefined,
    mode: AdminMetadataQualityScanMode
) {
    try {
        const response = await requireClient(client).startMetadataQualityScan<unknown, { mode: AdminMetadataQualityScanMode }>({ mode });
        return normalizeAdminMetadataQualitySummary(response);
    } catch {
        throw new AdminMetadataQualityServiceError('action-unavailable', "The Metadata Quality scan couldn't be started.");
    }
}

export async function cancelAdminMetadataQualityScan(
    client: AdminMetadataQualityApiClient | null | undefined
) {
    try {
        const response = await requireClient(client).cancelMetadataQualityScan<unknown>();
        return normalizeAdminMetadataQualitySummary(response);
    } catch {
        throw new AdminMetadataQualityServiceError('action-unavailable', "The Metadata Quality scan couldn't be stopped.");
    }
}

export async function resolveAdminMetadataQualityResult(
    client: AdminMetadataQualityApiClient | null | undefined,
    itemId: string,
    action: AdminMetadataQualityResolutionAction
) {
    try {
        const normalizedItemId = requireItemId(itemId);
        const response = await requireClient(client).resolveMetadataQualityResult<unknown, { action: AdminMetadataQualityResolutionAction }>(
            normalizedItemId,
            { action }
        );
        const detail = normalizeAdminMetadataQualityDetail(response);
        if (!detail) throw new Error('Invalid response');
        requireMatchingItemId(normalizedItemId, detail.itemId);
        return detail;
    } catch {
        throw new AdminMetadataQualityServiceError('action-unavailable', "This review decision couldn't be saved.");
    }
}

export async function saveAdminMetadataQualitySettings(
    client: AdminMetadataQualityApiClient | null | undefined,
    settings: AdminMetadataQualitySettings
) {
    try {
        const response = await requireClient(client).saveMetadataQualitySettings<unknown, AdminMetadataQualitySettings>(settings);
        return normalizeAdminMetadataQualitySettings(response);
    } catch (error) {
        if (errorStatus(error) === 409) {
            throw new AdminMetadataQualityServiceError(
                'conflict',
                'Metadata Quality settings changed on the server. Reload the latest settings and try again.'
            );
        }
        throw new AdminMetadataQualityServiceError('action-unavailable', "Metadata Quality settings couldn't be saved.");
    }
}
