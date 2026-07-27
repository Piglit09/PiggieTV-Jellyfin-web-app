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
import {
    jellyfinTicksToMilliseconds,
    type PtvArtworkReference
} from '../media/mediaContracts';

export const PTV_SEASON_EPISODES_OPERATION = 'jellyfin-season-episodes';
export const PTV_SEASON_EPISODES_ROUTE_IDENTIFIER = 'jellyfin:season-episodes';

export type PtvCoreEpisodeProgress = Readonly<{
    playbackPositionMilliseconds?: number;
    played?: boolean;
    playedPercentage?: number;
}>;

export type PtvCoreEpisodeMetadata<TEpisode> = Readonly<{
    artwork?: PtvArtworkReference;
    episodeId: string;
    episodeIndex?: number;
    item: TEpisode;
    overview?: string;
    premiereDate?: string;
    progress?: PtvCoreEpisodeProgress;
    runtimeMilliseconds?: number;
    seasonId: string;
    seasonIndex?: number;
    seriesId: string;
    title: string;
}>;

export type PtvCoreSeasonEpisodes<TResponse, TEpisode> = Readonly<{
    droppedInvalidIdCount: number;
    droppedItemCount: number;
    droppedSeasonScopeCount: number;
    droppedSeriesScopeCount: number;
    items: readonly PtvCoreEpisodeMetadata<TEpisode>[];
    raw: TResponse;
    rawItemCount: number;
    totalRecordCount: number;
}>;

export type PtvSeasonEpisodesApiDiagnostic = Readonly<{
    category: 'metadata';
    coreErrorCode: string | null;
    droppedInvalidIdCount: number;
    droppedSeasonScopeCount: number;
    droppedSeriesScopeCount: number;
    durationMs: number;
    method: 'GET';
    operationName: typeof PTV_SEASON_EPISODES_OPERATION;
    rawItemCount: number;
    requestId: string;
    responseSize: number | null;
    routeIdentifier: typeof PTV_SEASON_EPISODES_ROUTE_IDENTIFIER;
    status: number | null;
    success: boolean;
    validItemCount: number;
}>;

export type ExecutePtvSeasonEpisodesBoundaryOptions = Readonly<{
    diagnostic?: (diagnostic: PtvSeasonEpisodesApiDiagnostic) => void;
    requestId: string;
    seasonId: string;
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

function getOptionalBoolean(value: unknown, key: string): boolean | undefined {
    const candidate = getPtvCoreAliasedField(value, key);

    return typeof candidate === 'boolean' ? candidate : undefined;
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

function getOptionalMilliseconds(value: unknown, key: string): number | undefined {
    const ticks = getPtvCoreAliasedField(value, key);

    return typeof ticks === 'number' && Number.isFinite(ticks) ?
        jellyfinTicksToMilliseconds(ticks) :
        undefined;
}

function getProgress(value: unknown): PtvCoreEpisodeProgress | undefined {
    const userData = getPtvCoreAliasedField(value, 'userData');
    const played = getOptionalBoolean(userData, 'played');
    const playbackPositionMilliseconds = getOptionalMilliseconds(userData, 'playbackPositionTicks');
    const playedPercentage = getOptionalNumber(userData, 'playedPercentage');

    if (
        played === undefined
        && playbackPositionMilliseconds === undefined
        && playedPercentage === undefined
    ) {
        return undefined;
    }

    return {
        playbackPositionMilliseconds,
        played,
        playedPercentage
    };
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

function createSeasonEpisodesError(
    code: string,
    message: string,
    requestId?: string
) {
    return createPtvCoreError({
        code,
        correlationId: requestId,
        kind: 'parsing',
        message,
        operation: PTV_SEASON_EPISODES_OPERATION
    });
}

function getRequestedScopeError(options: Readonly<{
    requestId?: string;
    seasonId: string;
    seriesId: string;
}>): PtvCoreError | null {
    if (!options.seriesId.trim()) {
        return createSeasonEpisodesError(
            'API_SEASON_EPISODES_SERIES_SCOPE_INVALID',
            'A valid series scope is required for episode metadata.',
            options.requestId
        );
    }
    if (!options.seasonId.trim()) {
        return createSeasonEpisodesError(
            'API_SEASON_EPISODES_SEASON_SCOPE_INVALID',
            'A valid season scope is required for episode metadata.',
            options.requestId
        );
    }

    return null;
}

function mapSeasonEpisodesError(error: unknown, requestId: string): PtvCoreError {
    const cancelled = toPtvCoreError(error, {
        correlationId: requestId,
        operation: PTV_SEASON_EPISODES_OPERATION
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
        message: timedOut ? 'The episode metadata request timed out.' : 'PiggieTV could not load episode metadata.',
        operation: PTV_SEASON_EPISODES_OPERATION,
        retryable: timedOut || status === undefined || status === 408 || status === 429 || status >= 500
    });
}

function recordDiagnosticSafely(
    diagnostic: ExecutePtvSeasonEpisodesBoundaryOptions['diagnostic'],
    value: PtvSeasonEpisodesApiDiagnostic
) {
    try {
        diagnostic?.(value);
    } catch {
        // Diagnostics are deliberately nonblocking.
    }
}

function createEmptyDiagnosticCounts() {
    return {
        droppedInvalidIdCount: 0,
        droppedSeasonScopeCount: 0,
        droppedSeriesScopeCount: 0,
        rawItemCount: 0,
        validItemCount: 0
    };
}

export function normalizePtvSeasonEpisodesResponse<TResponse, TEpisode>(
    response: TResponse,
    options: Readonly<{
        requestId?: string;
        seasonId: string;
        seriesId: string;
    }>
): PtvCoreResult<PtvCoreSeasonEpisodes<TResponse, TEpisode>> {
    const requestedScopeError = getRequestedScopeError(options);
    if (requestedScopeError) return ptvCoreFailure(requestedScopeError);

    const seriesId = options.seriesId.trim();
    const seasonId = options.seasonId.trim();
    const envelopeSeriesId = getOptionalString(response, 'seriesId');
    const envelopeSeasonId = getOptionalString(response, 'seasonId');
    if (
        (envelopeSeriesId && envelopeSeriesId !== seriesId)
        || (envelopeSeasonId && envelopeSeasonId !== seasonId)
    ) {
        return ptvCoreFailure(createSeasonEpisodesError(
            'API_SEASON_EPISODES_RESPONSE_SCOPE_INVALID',
            'The episode metadata response did not match the requested scope.',
            options.requestId
        ));
    }

    const rawItems = getItems(response);
    if (!rawItems) {
        return ptvCoreFailure(createSeasonEpisodesError(
            'API_SEASON_EPISODES_RESPONSE_INVALID',
            'The episode metadata response did not contain an item list.',
            options.requestId
        ));
    }

    const items: PtvCoreEpisodeMetadata<TEpisode>[] = [];
    let droppedInvalidIdCount = 0;
    let droppedSeasonScopeCount = 0;
    let droppedSeriesScopeCount = 0;

    rawItems.forEach(rawItem => {
        const episodeId = getRequiredOpaqueId(rawItem, 'id');
        const responseSeriesId = getOptionalString(rawItem, 'seriesId');
        const responseSeasonId = getOptionalString(rawItem, 'seasonId');

        if (!episodeId) {
            droppedInvalidIdCount += 1;
            return;
        }
        if (responseSeriesId && responseSeriesId !== seriesId) {
            droppedSeriesScopeCount += 1;
            return;
        }
        if (responseSeasonId && responseSeasonId !== seasonId) {
            droppedSeasonScopeCount += 1;
            return;
        }

        items.push({
            artwork: getPrimaryArtwork(rawItem, episodeId),
            episodeId,
            episodeIndex: getOptionalNumber(rawItem, 'indexNumber'),
            item: rawItem as TEpisode,
            overview: getOptionalString(rawItem, 'overview'),
            premiereDate: getOptionalString(rawItem, 'premiereDate'),
            progress: getProgress(rawItem),
            runtimeMilliseconds: getOptionalMilliseconds(rawItem, 'runTimeTicks'),
            seasonId: responseSeasonId || seasonId,
            seasonIndex: getOptionalNumber(rawItem, 'parentIndexNumber'),
            seriesId: responseSeriesId || seriesId,
            title: getOptionalString(rawItem, 'name') || ''
        });
    });

    const rawTotalRecordCount = getOptionalNumber(response, 'totalRecordCount');

    return ptvCoreSuccess({
        droppedInvalidIdCount,
        droppedItemCount: droppedInvalidIdCount
            + droppedSeriesScopeCount
            + droppedSeasonScopeCount,
        droppedSeasonScopeCount,
        droppedSeriesScopeCount,
        items,
        raw: response,
        rawItemCount: rawItems.length,
        totalRecordCount: rawTotalRecordCount ?? rawItems.length
    });
}

export async function executePtvSeasonEpisodesApiBoundary<TResponse, TEpisode>(
    options: ExecutePtvSeasonEpisodesBoundaryOptions
): Promise<PtvCoreResult<PtvCoreApiResponse<PtvCoreSeasonEpisodes<TResponse, TEpisode>>>> {
    const startedAt = performance.now();
    const requestedScopeError = getRequestedScopeError(options);

    if (requestedScopeError) {
        recordDiagnosticSafely(options.diagnostic, {
            category: 'metadata',
            coreErrorCode: requestedScopeError.code,
            ...createEmptyDiagnosticCounts(),
            durationMs: Math.max(0, performance.now() - startedAt),
            method: 'GET',
            operationName: PTV_SEASON_EPISODES_OPERATION,
            requestId: options.requestId,
            responseSize: null,
            routeIdentifier: PTV_SEASON_EPISODES_ROUTE_IDENTIFIER,
            status: null,
            success: false
        });

        return ptvCoreFailure(requestedScopeError);
    }

    try {
        const response = await options.transport();
        const durationMs = Math.max(0, performance.now() - startedAt);
        const responseSize = getSerializedSize(response);
        const normalized = normalizePtvSeasonEpisodesResponse<TResponse, TEpisode>(
            response as TResponse,
            options
        );

        if (!normalized.success) {
            recordDiagnosticSafely(options.diagnostic, {
                category: 'metadata',
                coreErrorCode: normalized.error.code,
                ...createEmptyDiagnosticCounts(),
                durationMs,
                method: 'GET',
                operationName: PTV_SEASON_EPISODES_OPERATION,
                requestId: options.requestId,
                responseSize: responseSize ?? null,
                routeIdentifier: PTV_SEASON_EPISODES_ROUTE_IDENTIFIER,
                status: 200,
                success: false
            });

            return normalized;
        }

        recordDiagnosticSafely(options.diagnostic, {
            category: 'metadata',
            coreErrorCode: null,
            droppedInvalidIdCount: normalized.value.droppedInvalidIdCount,
            droppedSeasonScopeCount: normalized.value.droppedSeasonScopeCount,
            droppedSeriesScopeCount: normalized.value.droppedSeriesScopeCount,
            durationMs,
            method: 'GET',
            operationName: PTV_SEASON_EPISODES_OPERATION,
            rawItemCount: normalized.value.rawItemCount,
            requestId: options.requestId,
            responseSize: responseSize ?? null,
            routeIdentifier: PTV_SEASON_EPISODES_ROUTE_IDENTIFIER,
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
        const coreError = mapSeasonEpisodesError(error, options.requestId);

        recordDiagnosticSafely(options.diagnostic, {
            category: 'metadata',
            coreErrorCode: coreError.code,
            ...createEmptyDiagnosticCounts(),
            durationMs,
            method: 'GET',
            operationName: PTV_SEASON_EPISODES_OPERATION,
            requestId: options.requestId,
            responseSize: null,
            routeIdentifier: PTV_SEASON_EPISODES_ROUTE_IDENTIFIER,
            status: getErrorStatus(error) ?? null,
            success: false
        });

        return ptvCoreFailure(coreError);
    }
}
