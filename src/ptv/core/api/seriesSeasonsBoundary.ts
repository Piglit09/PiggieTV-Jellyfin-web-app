import {
    getPtvCoreAliasedField,
    type PtvCoreApiResponse
} from './apiContracts';
import {
    createPtvCoreError,
    getPtvCoreErrorKindForHttpStatus,
    ptvCoreFailure,
    ptvCoreSuccess,
    toPtvCoreError,
    type PtvCoreError,
    type PtvCoreResult
} from '../errors/coreError';
import type { PtvArtworkReference } from '../media/mediaContracts';

export const PTV_SERIES_SEASONS_OPERATION = 'jellyfin-series-seasons';
export const PTV_SERIES_SEASONS_ROUTE_IDENTIFIER = 'jellyfin:series-seasons';

export type PtvCoreSeasonMetadata<TSeason> = Readonly<{
    artwork?: PtvArtworkReference;
    episodeCount?: number;
    item: TSeason;
    seasonId: string;
    seasonIndex?: number;
    seriesId: string;
    title: string;
}>;

export type PtvCoreSeriesSeasons<TResponse, TSeason> = Readonly<{
    droppedItemCount: number;
    items: readonly PtvCoreSeasonMetadata<TSeason>[];
    raw: TResponse;
    rawItemCount: number;
    totalRecordCount: number;
}>;

export type PtvSeriesSeasonsApiDiagnostic = Readonly<{
    category: 'metadata';
    coreErrorCode: string | null;
    droppedItemCount: number;
    durationMs: number;
    method: 'GET';
    operationName: typeof PTV_SERIES_SEASONS_OPERATION;
    rawItemCount: number;
    requestId: string;
    responseSize: number | null;
    routeIdentifier: typeof PTV_SERIES_SEASONS_ROUTE_IDENTIFIER;
    status: number | null;
    success: boolean;
    validItemCount: number;
}>;

export type ExecutePtvSeriesSeasonsBoundaryOptions = Readonly<{
    diagnostic?: (diagnostic: PtvSeriesSeasonsApiDiagnostic) => void;
    requestId: string;
    seriesId: string;
    transport: () => Promise<unknown>;
}>;

function getRequiredOpaqueId(value: unknown, key: string): string | null {
    const id = getPtvCoreAliasedField(value, key);

    return typeof id === 'string' && id.trim() ? id : null;
}

function getOptionalString(value: unknown, key: string): string | undefined {
    const candidate = getPtvCoreAliasedField(value, key);

    return typeof candidate === 'string' && candidate.trim() ? candidate : undefined;
}

function getOptionalNumber(value: unknown, key: string): number | undefined {
    const candidate = getPtvCoreAliasedField(value, key);

    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
}

function getItems(value: unknown): unknown[] | null {
    const items = getPtvCoreAliasedField(value, 'items');

    return Array.isArray(items) ? items : null;
}

function getPrimaryArtwork(value: unknown, mediaId: string): PtvArtworkReference | undefined {
    const imageTags = getPtvCoreAliasedField(value, 'imageTags');
    const tag = getOptionalString(imageTags, 'primary');
    const aspectRatio = getOptionalNumber(value, 'primaryImageAspectRatio');

    if (!tag && aspectRatio === undefined) return undefined;

    return {
        aspectRatio,
        imageType: 'Primary',
        mediaId,
        tag
    };
}

function getEpisodeCount(value: unknown) {
    return getOptionalNumber(value, 'childCount')
        ?? getOptionalNumber(value, 'recursiveItemCount');
}

function getSerializedSize(value: unknown): number | undefined {
    try {
        return new TextEncoder().encode(JSON.stringify(value)).byteLength;
    } catch {
        return undefined;
    }
}

function getErrorStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const record = error as Record<string, unknown>;
    const response = record.response && typeof record.response === 'object' ?
        record.response as Record<string, unknown> :
        undefined;
    const status = record.statusCode ?? record.status ?? response?.status;

    return typeof status === 'number' && status >= 100 && status <= 599 ? status : undefined;
}

function isTimeoutError(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const record = error as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.toLowerCase() : '';
    const message = typeof record.message === 'string' ? record.message.toLowerCase() : '';

    return name === 'timeouterror' || message.includes('timeout') || message.includes('timed out');
}

function createSeriesSeasonsError(
    code: string,
    message: string,
    requestId?: string
) {
    return createPtvCoreError({
        code,
        correlationId: requestId,
        kind: 'parsing',
        message,
        operation: PTV_SERIES_SEASONS_OPERATION
    });
}

function mapSeriesSeasonsError(error: unknown, requestId: string): PtvCoreError {
    const cancelled = toPtvCoreError(error, {
        correlationId: requestId,
        operation: PTV_SERIES_SEASONS_OPERATION
    });
    if (cancelled.kind === 'cancelled') return cancelled;

    const status = getErrorStatus(error);
    const timedOut = isTimeoutError(error);
    let code = 'API_NETWORK_FAILURE';
    if (status) code = `API_HTTP_${status}`;
    else if (timedOut) code = 'API_TIMEOUT';

    return createPtvCoreError({
        cause: error,
        code,
        correlationId: requestId,
        httpStatus: status,
        kind: status ? getPtvCoreErrorKindForHttpStatus(status) : 'network',
        message: timedOut ? 'The season metadata request timed out.' : 'PiggieTV could not load season metadata.',
        operation: PTV_SERIES_SEASONS_OPERATION,
        retryable: timedOut || status === undefined || status === 408 || status === 429 || status >= 500
    });
}

function recordDiagnosticSafely(
    diagnostic: ExecutePtvSeriesSeasonsBoundaryOptions['diagnostic'],
    value: PtvSeriesSeasonsApiDiagnostic
) {
    try {
        diagnostic?.(value);
    } catch {
        // Diagnostics are deliberately nonblocking.
    }
}

export function normalizePtvSeriesSeasonsResponse<TResponse, TSeason>(
    response: TResponse,
    options: Readonly<{
        requestId?: string;
        seriesId: string;
    }>
): PtvCoreResult<PtvCoreSeriesSeasons<TResponse, TSeason>> {
    const seriesId = options.seriesId.trim();
    if (!seriesId) {
        return ptvCoreFailure(createSeriesSeasonsError(
            'API_SERIES_SEASONS_SCOPE_INVALID',
            'A valid series scope is required for season metadata.',
            options.requestId
        ));
    }

    const rawItems = getItems(response);
    if (!rawItems) {
        return ptvCoreFailure(createSeriesSeasonsError(
            'API_SERIES_SEASONS_RESPONSE_INVALID',
            'The season metadata response did not contain an item list.',
            options.requestId
        ));
    }

    const items: PtvCoreSeasonMetadata<TSeason>[] = [];
    let droppedItemCount = 0;

    rawItems.forEach(rawItem => {
        const seasonId = getRequiredOpaqueId(rawItem, 'id');
        const responseSeriesId = getOptionalString(rawItem, 'seriesId');

        if (!seasonId || (responseSeriesId && responseSeriesId !== seriesId)) {
            droppedItemCount += 1;
            return;
        }

        items.push({
            artwork: getPrimaryArtwork(rawItem, seasonId),
            episodeCount: getEpisodeCount(rawItem),
            item: rawItem as TSeason,
            seasonId,
            seasonIndex: getOptionalNumber(rawItem, 'indexNumber'),
            seriesId: responseSeriesId || seriesId,
            title: getOptionalString(rawItem, 'name') || ''
        });
    });

    const rawTotalRecordCount = getOptionalNumber(response, 'totalRecordCount');

    return ptvCoreSuccess({
        droppedItemCount,
        items,
        raw: response,
        rawItemCount: rawItems.length,
        totalRecordCount: rawTotalRecordCount ?? rawItems.length
    });
}

export async function executePtvSeriesSeasonsApiBoundary<TResponse, TSeason>(
    options: ExecutePtvSeriesSeasonsBoundaryOptions
): Promise<PtvCoreResult<PtvCoreApiResponse<PtvCoreSeriesSeasons<TResponse, TSeason>>>> {
    const startedAt = performance.now();

    if (!options.seriesId.trim()) {
        const durationMs = Math.max(0, performance.now() - startedAt);
        const normalized = normalizePtvSeriesSeasonsResponse<TResponse, TSeason>(
            {} as TResponse,
            options
        );
        const coreError = normalized.success ?
            createSeriesSeasonsError(
                'API_SERIES_SEASONS_SCOPE_INVALID',
                'A valid series scope is required for season metadata.',
                options.requestId
            ) :
            normalized.error;

        recordDiagnosticSafely(options.diagnostic, {
            category: 'metadata',
            coreErrorCode: coreError.code,
            droppedItemCount: 0,
            durationMs,
            method: 'GET',
            operationName: PTV_SERIES_SEASONS_OPERATION,
            rawItemCount: 0,
            requestId: options.requestId,
            responseSize: null,
            routeIdentifier: PTV_SERIES_SEASONS_ROUTE_IDENTIFIER,
            status: null,
            success: false,
            validItemCount: 0
        });

        return ptvCoreFailure(coreError);
    }

    try {
        const response = await options.transport();
        const durationMs = Math.max(0, performance.now() - startedAt);
        const responseSize = getSerializedSize(response);
        const normalized = normalizePtvSeriesSeasonsResponse<TResponse, TSeason>(
            response as TResponse,
            options
        );

        if (!normalized.success) {
            recordDiagnosticSafely(options.diagnostic, {
                category: 'metadata',
                coreErrorCode: normalized.error.code,
                droppedItemCount: 0,
                durationMs,
                method: 'GET',
                operationName: PTV_SERIES_SEASONS_OPERATION,
                rawItemCount: 0,
                requestId: options.requestId,
                responseSize: responseSize ?? null,
                routeIdentifier: PTV_SERIES_SEASONS_ROUTE_IDENTIFIER,
                status: 200,
                success: false,
                validItemCount: 0
            });

            return normalized;
        }

        recordDiagnosticSafely(options.diagnostic, {
            category: 'metadata',
            coreErrorCode: null,
            droppedItemCount: normalized.value.droppedItemCount,
            durationMs,
            method: 'GET',
            operationName: PTV_SERIES_SEASONS_OPERATION,
            rawItemCount: normalized.value.rawItemCount,
            requestId: options.requestId,
            responseSize: responseSize ?? null,
            routeIdentifier: PTV_SERIES_SEASONS_ROUTE_IDENTIFIER,
            status: 200,
            success: true,
            validItemCount: normalized.value.items.length
        });

        return ptvCoreSuccess({
            correlationId: options.requestId,
            durationMs,
            headers: {},
            responseBytes: responseSize,
            status: 200,
            value: normalized.value
        });
    } catch (error) {
        const durationMs = Math.max(0, performance.now() - startedAt);
        const coreError = mapSeriesSeasonsError(error, options.requestId);

        recordDiagnosticSafely(options.diagnostic, {
            category: 'metadata',
            coreErrorCode: coreError.code,
            droppedItemCount: 0,
            durationMs,
            method: 'GET',
            operationName: PTV_SERIES_SEASONS_OPERATION,
            rawItemCount: 0,
            requestId: options.requestId,
            responseSize: null,
            routeIdentifier: PTV_SERIES_SEASONS_ROUTE_IDENTIFIER,
            status: getErrorStatus(error) ?? null,
            success: false,
            validItemCount: 0
        });

        return ptvCoreFailure(coreError);
    }
}
