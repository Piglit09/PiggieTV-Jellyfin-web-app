import {
    executePtvSeasonEpisodesApiBoundary,
    type PtvCoreSeasonEpisodes
} from '../core/api/seasonEpisodesBoundary';
import { type PtvCoreApiResponse } from '../core/api/apiContracts';
import { type PtvCoreResult } from '../core/errors/coreError';
import { recordPtvEvent } from '../core/observability';
import { requestPtvJson } from './client';
import { type PtvApiQuery } from './types';

type PtvSeasonEpisodesApiClient = Readonly<{
    getEpisodes: (seriesId: string, options?: Record<string, unknown>) => Promise<unknown>;
}>;

type PtvSeasonEpisodesExecution<TResponse, TEpisode> = Readonly<{
    legacyError?: unknown;
    result: PtvCoreResult<PtvCoreApiResponse<PtvCoreSeasonEpisodes<TResponse, TEpisode>>>;
}>;

type PtvSeasonEpisodesRequestOptions = Readonly<{
    serverId?: string | null;
    signal?: AbortSignal;
}>;

let seasonEpisodesRequestSequence = 0;

function createPtvSeasonEpisodesRequestId() {
    seasonEpisodesRequestSequence += 1;

    return `ptv-season-episodes-${seasonEpisodesRequestSequence}`;
}

function recordPtvSeasonEpisodesDiagnostic(detail: Record<string, unknown>) {
    try {
        recordPtvEvent('api', 'ptv-core-season-episodes-request', detail);
    } catch {
        // Existing metadata behavior must not depend on diagnostics.
    }
}

async function executePtvSeasonEpisodesRequest<TResponse, TEpisode>(
    apiClient: PtvSeasonEpisodesApiClient,
    seriesId: string,
    seasonId: string,
    options?: Record<string, unknown>,
    requestOptions: PtvSeasonEpisodesRequestOptions = {}
): Promise<PtvSeasonEpisodesExecution<TResponse, TEpisode>> {
    let legacyError: unknown;
    const result = await executePtvSeasonEpisodesApiBoundary<TResponse, TEpisode>({
        diagnostic: recordPtvSeasonEpisodesDiagnostic,
        requestId: createPtvSeasonEpisodesRequestId(),
        seasonId,
        seriesId,
        transport: async () => {
            try {
                if (requestOptions.signal) {
                    return await requestPtvJson<TResponse>(`Shows/${seriesId}/Episodes`, {
                        params: options as PtvApiQuery | undefined,
                        serverId: requestOptions.serverId,
                        signal: requestOptions.signal
                    });
                }

                return await apiClient.getEpisodes(seriesId, options);
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

export async function getPtvSeasonEpisodes<TResponse, TEpisode = unknown>(
    apiClient: PtvSeasonEpisodesApiClient,
    seriesId: string,
    seasonId: string,
    options?: Record<string, unknown>,
    requestOptions: PtvSeasonEpisodesRequestOptions = {}
): Promise<TResponse> {
    const execution = await executePtvSeasonEpisodesRequest<TResponse, TEpisode>(
        apiClient,
        seriesId,
        seasonId,
        options,
        requestOptions
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

export async function getPtvSeasonEpisodesCoreResult<TResponse, TEpisode = unknown>(
    apiClient: PtvSeasonEpisodesApiClient,
    seriesId: string,
    seasonId: string,
    options?: Record<string, unknown>,
    requestOptions: PtvSeasonEpisodesRequestOptions = {}
): Promise<PtvCoreResult<PtvCoreApiResponse<PtvCoreSeasonEpisodes<TResponse, TEpisode>>>> {
    const execution = await executePtvSeasonEpisodesRequest<TResponse, TEpisode>(
        apiClient,
        seriesId,
        seasonId,
        options,
        requestOptions
    );

    return execution.result;
}
