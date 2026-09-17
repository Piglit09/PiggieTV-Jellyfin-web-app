import {
    executePtvSeriesSeasonsApiBoundary,
    type PtvCoreSeriesSeasons
} from '../core/api/seriesSeasonsBoundary';
import { type PtvCoreApiResponse } from '../core/api/apiContracts';
import {
    type PtvCoreError,
    type PtvCoreResult
} from '../core/errors/coreError';
import { recordPtvEvent } from '../core/observability';
import { requestPtvJson } from './client';
import { type PtvApiQuery } from './types';

type PtvSeriesSeasonsApiClient = Readonly<{
    getSeasons: (seriesId: string, options?: Record<string, unknown>) => Promise<unknown>;
}>;

type PtvSeriesSeasonsExecution<TResponse, TSeason> = Readonly<{
    legacyError?: unknown;
    result: PtvCoreResult<PtvCoreApiResponse<PtvCoreSeriesSeasons<TResponse, TSeason>>>;
}>;

type PtvSeriesSeasonsRequestOptions = Readonly<{
    serverId?: string | null;
    signal?: AbortSignal;
}>;

let seriesSeasonsRequestSequence = 0;

function createPtvSeriesSeasonsRequestId() {
    seriesSeasonsRequestSequence += 1;

    return `ptv-series-seasons-${seriesSeasonsRequestSequence}`;
}

function recordPtvSeriesSeasonsDiagnostic(detail: Record<string, unknown>) {
    try {
        recordPtvEvent('api', 'ptv-core-series-seasons-request', detail);
    } catch {
        // Existing metadata behavior must not depend on diagnostics.
    }
}

async function executePtvSeriesSeasonsRequest<TResponse, TSeason>(
    apiClient: PtvSeriesSeasonsApiClient,
    seriesId: string,
    options?: Record<string, unknown>,
    requestOptions: PtvSeriesSeasonsRequestOptions = {}
): Promise<PtvSeriesSeasonsExecution<TResponse, TSeason>> {
    let legacyError: unknown;
    const result = await executePtvSeriesSeasonsApiBoundary<TResponse, TSeason>({
        diagnostic: recordPtvSeriesSeasonsDiagnostic,
        requestId: createPtvSeriesSeasonsRequestId(),
        seriesId,
        transport: async () => {
            try {
                if (requestOptions.signal) {
                    return await requestPtvJson<TResponse>(`Shows/${seriesId}/Seasons`, {
                        params: options as PtvApiQuery | undefined,
                        serverId: requestOptions.serverId,
                        signal: requestOptions.signal
                    });
                }

                return await apiClient.getSeasons(seriesId, options);
            } catch (error) {
                legacyError = error;
                throw error;
            }
        }
    });

    return {
        legacyError,
        result
    };
}

function throwPtvSeriesSeasonsFailure(
    legacyError: unknown,
    coreError: PtvCoreError
): never {
    if (legacyError !== undefined) throw legacyError;

    const error = new Error(coreError.message) as Error & {
        coreError: PtvCoreError;
    };
    error.name = 'PtvApiError';
    error.coreError = coreError;
    throw error;
}

export async function getPtvSeriesSeasons<TResponse, TSeason = unknown>(
    apiClient: PtvSeriesSeasonsApiClient,
    seriesId: string,
    options?: Record<string, unknown>,
    requestOptions: PtvSeriesSeasonsRequestOptions = {}
): Promise<TResponse> {
    const execution = await executePtvSeriesSeasonsRequest<TResponse, TSeason>(
        apiClient,
        seriesId,
        options,
        requestOptions
    );

    if (execution.result.success) return execution.result.value.value.raw;

    return throwPtvSeriesSeasonsFailure(
        execution.legacyError,
        execution.result.error
    );
}

export async function getPtvSeriesSeasonItems<TSeason = unknown>(
    apiClient: PtvSeriesSeasonsApiClient,
    seriesId: string,
    options?: Record<string, unknown>,
    requestOptions: PtvSeriesSeasonsRequestOptions = {}
): Promise<TSeason[]> {
    const execution = await executePtvSeriesSeasonsRequest<unknown, TSeason>(
        apiClient,
        seriesId,
        options,
        requestOptions
    );

    if (execution.result.success) {
        return execution.result.value.value.items.map(metadata => metadata.item);
    }

    return throwPtvSeriesSeasonsFailure(
        execution.legacyError,
        execution.result.error
    );
}

export async function getPtvSeriesSeasonsCoreResult<TResponse, TSeason = unknown>(
    apiClient: PtvSeriesSeasonsApiClient,
    seriesId: string,
    options?: Record<string, unknown>,
    requestOptions: PtvSeriesSeasonsRequestOptions = {}
): Promise<PtvCoreResult<PtvCoreApiResponse<PtvCoreSeriesSeasons<TResponse, TSeason>>>> {
    const execution = await executePtvSeriesSeasonsRequest<TResponse, TSeason>(
        apiClient,
        seriesId,
        options,
        requestOptions
    );

    return execution.result;
}
