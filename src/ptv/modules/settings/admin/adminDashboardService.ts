import type { Api } from '@jellyfin/sdk';
import { getLibraryStructureApi } from '@jellyfin/sdk/lib/utils/api/library-structure-api';
import { getScheduledTasksApi } from '@jellyfin/sdk/lib/utils/api/scheduled-tasks-api';
import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api';
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api';

import { getCurrentPtvPluginApiClient } from '../../../core/pluginApi';
import {
    createAdminDashboardSnapshot,
    createUnavailableAdminLibraries,
    createUnavailableAdminPlayback,
    createUnavailableAdminPtv,
    createUnavailableAdminServer,
    createUnavailableAdminTasks,
    normalizeAdminLibraries,
    normalizeAdminPlayback,
    normalizeAdminPtvStatus,
    normalizeAdminServer,
    normalizeAdminTasks,
    type AdminTaskNormalizationOptions
} from './adminDashboardAdapters';
import type {
    AdminDashboardSnapshot,
    AdminDashboardSourceKey,
    AdminLibrariesSummary,
    AdminPlaybackSummary,
    AdminPtvSummary,
    AdminServerSummary,
    AdminTasksSummary
} from './adminDashboardModel';

export type { AdminDashboardSourceKey } from './adminDashboardModel';

export type AdminPtvApiClient = NonNullable<ReturnType<typeof getCurrentPtvPluginApiClient>>;

export type AdminDashboardLogger = (message: string) => void;

export type AdminDashboardLoaders = Readonly<{
    libraries: (api: Api, signal?: AbortSignal) => Promise<AdminLibrariesSummary>;
    playback: (api: Api, signal?: AbortSignal) => Promise<AdminPlaybackSummary>;
    ptv: (
        apiClient: AdminPtvApiClient | null | undefined,
        signal?: AbortSignal,
        bypassCache?: boolean
    ) => Promise<AdminPtvSummary>;
    server: (api: Api, signal?: AbortSignal) => Promise<AdminServerSummary>;
    tasks: (
        api: Api,
        signal?: AbortSignal,
        options?: AdminTaskNormalizationOptions
    ) => Promise<AdminTasksSummary>;
}>;

export type LoadAdminDashboardOptions = AdminTaskNormalizationOptions & Readonly<{
    bypassPtvCache?: boolean;
    loaders?: Partial<AdminDashboardLoaders>;
    logger?: AdminDashboardLogger;
    ptvApiClient?: AdminPtvApiClient | null;
    signal?: AbortSignal;
}>;

const SOURCE_FAILURE_MESSAGES: Readonly<Record<AdminDashboardSourceKey, string>> = {
    libraries: '[PiggieTV Administration] Library information request failed.',
    playback: '[PiggieTV Administration] Sessions request failed.',
    ptv: '[PiggieTV Administration] PTV status request failed.',
    server: '[PiggieTV Administration] Server information request failed.',
    tasks: '[PiggieTV Administration] Scheduled tasks request failed.'
};

function defaultLogger(message: string) {
    console.warn(message);
}

function throwIfAborted(signal?: AbortSignal) {
    if (!signal?.aborted) return;

    const error = new Error('Administration dashboard request was aborted.');
    error.name = 'AbortError';
    throw error;
}

function settledValueOrFallback<T>(
    result: PromiseSettledResult<T>,
    source: AdminDashboardSourceKey,
    fallback: () => T,
    logger: AdminDashboardLogger
) {
    if (result.status === 'fulfilled') return result.value;

    logger(SOURCE_FAILURE_MESSAGES[source]);
    return fallback();
}

export async function loadAdminServer(
    api: Api,
    signal?: AbortSignal
): Promise<AdminServerSummary> {
    const response = await getSystemApi(api).getSystemInfo({
        headers: { 'Cache-Control': 'no-cache' },
        signal
    });

    return normalizeAdminServer(response.data);
}

export async function loadAdminPtv(
    apiClient: AdminPtvApiClient | null | undefined,
    signal?: AbortSignal,
    bypassCache = false
): Promise<AdminPtvSummary> {
    if (!apiClient) {
        throw new Error('PiggieTV plugin API client is unavailable.');
    }

    const status = await apiClient.getStatus<unknown>({
        bypassCache,
        params: { full: true },
        signal
    });

    return normalizeAdminPtvStatus(status);
}

export async function loadAdminLibraries(
    api: Api,
    signal?: AbortSignal
): Promise<AdminLibrariesSummary> {
    const response = await getLibraryStructureApi(api).getVirtualFolders({ signal });
    return normalizeAdminLibraries(response.data);
}

export async function loadAdminPlayback(
    api: Api,
    signal?: AbortSignal
): Promise<AdminPlaybackSummary> {
    const response = await getSessionApi(api).getSessions(undefined, { signal });
    return normalizeAdminPlayback(response.data);
}

export async function loadAdminTasks(
    api: Api,
    signal?: AbortSignal,
    options: AdminTaskNormalizationOptions = {}
): Promise<AdminTasksSummary> {
    const response = await getScheduledTasksApi(api).getTasks({
        isHidden: false
    }, { signal });

    return normalizeAdminTasks(response.data, options);
}

export async function loadAdminDashboard(
    api: Api,
    options: LoadAdminDashboardOptions = {}
): Promise<AdminDashboardSnapshot> {
    throwIfAborted(options.signal);

    const loaders: AdminDashboardLoaders = {
        libraries: options.loaders?.libraries || loadAdminLibraries,
        playback: options.loaders?.playback || loadAdminPlayback,
        ptv: options.loaders?.ptv || loadAdminPtv,
        server: options.loaders?.server || loadAdminServer,
        tasks: options.loaders?.tasks || loadAdminTasks
    };
    let ptvApiClient = options.ptvApiClient;
    if (ptvApiClient === undefined) {
        ptvApiClient = getCurrentPtvPluginApiClient();
    }
    const taskOptions: AdminTaskNormalizationOptions = {
        now: options.now,
        recentFailureWindowMs: options.recentFailureWindowMs,
        recentLimit: options.recentLimit
    };
    const logger = options.logger || defaultLogger;

    const [ serverResult, ptvResult, librariesResult, playbackResult, tasksResult ] = await Promise.allSettled([
        loaders.server(api, options.signal),
        loaders.ptv(ptvApiClient, options.signal, options.bypassPtvCache),
        loaders.libraries(api, options.signal),
        loaders.playback(api, options.signal),
        loaders.tasks(api, options.signal, taskOptions)
    ] as const);

    throwIfAborted(options.signal);

    return createAdminDashboardSnapshot({
        libraries: settledValueOrFallback(
            librariesResult,
            'libraries',
            createUnavailableAdminLibraries,
            logger
        ),
        playback: settledValueOrFallback(
            playbackResult,
            'playback',
            createUnavailableAdminPlayback,
            logger
        ),
        ptv: settledValueOrFallback(
            ptvResult,
            'ptv',
            createUnavailableAdminPtv,
            logger
        ),
        server: settledValueOrFallback(
            serverResult,
            'server',
            createUnavailableAdminServer,
            logger
        ),
        tasks: settledValueOrFallback(
            tasksResult,
            'tasks',
            createUnavailableAdminTasks,
            logger
        )
    }, options.now);
}
