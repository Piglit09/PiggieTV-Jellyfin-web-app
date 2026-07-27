import {
    executePtvSeriesSeasonsApiBoundary,
    type PtvCoreSeriesSeasons
} from '../core/api/seriesSeasonsBoundary';
import { type PtvCoreApiResponse } from '../core/api/apiContracts';
import { type PtvCoreResult } from '../core/errors/coreError';
import { recordPtvEvent } from '../core/observability';

type PtvSeriesSeasonsApiClient = Readonly<{
    getSeasons: (seriesId: string, options?: Record<string, unknown>) => Promise<unknown>;
}>;

type PtvSeriesSeasonsExecution<TResponse, TSeason> = Readonly<{
    legacyError?: unknown;
    result: PtvCoreResult<PtvCoreApiResponse<PtvCoreSeriesSeasons<TResponse, TSeason>>>;
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
    options?: Record<string, unknown>
): Promise<PtvSeriesSeasonsExecution<TResponse, TSeason>> {
    let legacyError: unknown;
    const result = await executePtvSeriesSeasonsApiBoundary<TResponse, TSeason>({
        diagnostic: recordPtvSeriesSeasonsDiagnostic,
        requestId: createPtvSeriesSeasonsRequestId(),
        seriesId,
        transport: async () => {
            try {
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

export async function getPtvSeriesSeasons<TResponse, TSeason = unknown>(
    apiClient: PtvSeriesSeasonsApiClient,
    seriesId: string,
    options?: Record<string, unknown>
): Promise<TResponse> {
    const execution = await executePtvSeriesSeasonsRequest<TResponse, TSeason>(
        apiClient,
        seriesId,
        options
    );

    if (execution.result.success) return execution.result.value.value.raw;
    if (execution.legacyError !== undefined) throw execution.legacyError;

    const error = new Error(execution.result.error.message) as Error & {
        coreError: typeof execution.result.error;
    };
    error.name = 'PtvApiError';
    error.coreError = execution.result.error;
    throw error;
}

export async function getPtvSeriesSeasonsCoreResult<TResponse, TSeason = unknown>(
    apiClient: PtvSeriesSeasonsApiClient,
    seriesId: string,
    options?: Record<string, unknown>
): Promise<PtvCoreResult<PtvCoreApiResponse<PtvCoreSeriesSeasons<TResponse, TSeason>>>> {
    const execution = await executePtvSeriesSeasonsRequest<TResponse, TSeason>(
        apiClient,
        seriesId,
        options
    );

    return execution.result;
}
