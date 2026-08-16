import type { Api } from '@jellyfin/sdk';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ApiClient } from 'jellyfin-apiclient';

import { getResolvedAdminServerId } from '../adminServerIdentity';
import {
    AdminTasksServiceError,
    type PtvAdminTaskTrigger
} from './adminTasksModel';
import {
    loadAdminTask,
    loadAdminTasks,
    runAdminTask,
    saveAdminTaskTriggers,
    stopAdminTask
} from './adminTasksService';

const ADMIN_TASKS_QUERY_SCOPE = 'PtvAdminTasks';
export const ADMIN_TASKS_RUNNING_REFRESH_INTERVAL_MS = 8_000;
export const ADMIN_TASKS_IDLE_REFRESH_INTERVAL_MS = 45_000;

export type AdminTaskActionState =
    | 'starting'
    | 'stopping'
    | 'saving-schedule';

export type AdminTasksFeedback = Readonly<{
    message: string;
    tone: 'error' | 'info' | 'success';
}>;

export function getAdminTasksQueryKeys(serverKey: string | null, taskId?: string) {
    const scope = [ ADMIN_TASKS_QUERY_SCOPE, serverKey ] as const;
    return {
        detail: [ ...scope, 'detail', taskId?.trim() || '' ] as const,
        list: [ ...scope, 'list', { isHidden: false } ] as const
    };
}

// React Query uses false to disable an otherwise numeric interval.
// eslint-disable-next-line sonarjs/function-return-type
export function getAdminTasksRefreshInterval(
    tasks: readonly { state: string }[] | undefined,
    visibilityState?: DocumentVisibilityState
): number | false {
    // eslint-disable-next-line compat/compat
    const currentVisibility = visibilityState ?? (typeof document === 'undefined' ? 'visible' : document.visibilityState);
    if (currentVisibility !== 'visible') return false;
    return tasks?.some(task => task.state === 'running' || task.state === 'cancelling') ?
        ADMIN_TASKS_RUNNING_REFRESH_INTERVAL_MS :
        ADMIN_TASKS_IDLE_REFRESH_INTERVAL_MS;
}

function taskActionError(error: unknown, fallback: string): AdminTasksFeedback {
    return {
        message: error instanceof AdminTasksServiceError ? error.message : fallback,
        tone: 'error'
    };
}

function retryAdminTasksQuery(failureCount: number, error: unknown) {
    return failureCount < 1
        && error instanceof AdminTasksServiceError
        && error.code === 'load-unavailable';
}

async function invalidateAdminTaskConsumers(
    queryClient: ReturnType<typeof useQueryClient>,
    serverKey: string,
    taskId: string
) {
    const keys = getAdminTasksQueryKeys(serverKey, taskId);
    await Promise.allSettled([
        queryClient.invalidateQueries({ exact: true, queryKey: keys.list }),
        queryClient.invalidateQueries({ exact: true, queryKey: keys.detail }),
        queryClient.invalidateQueries({
            exact: true,
            queryKey: [ 'PtvAdminDashboard', serverKey, 'tasks' ]
        }),
        queryClient.invalidateQueries({
            exact: true,
            queryKey: [ 'PtvAdminLibraries', serverKey, 'scan-task', { isHidden: false } ]
        }),
        queryClient.invalidateQueries({ queryKey: [ 'Tasks' ] })
    ]);
}

function useVisibleTaskRefresh(refresh: () => Promise<unknown>) {
    useEffect(() => {
        if (typeof document === 'undefined') return;

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') void refresh();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [ refresh ]);
}

function useAdminTaskActions(
    api: Api | undefined,
    apiClient: ApiClient | undefined
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const queryClient = useQueryClient();
    const flightsRef = useRef(new Map<string, Promise<boolean>>());
    const [ actionStateByTask, setActionStateByTask ] = useState<Record<string, AdminTaskActionState | undefined>>({});
    const [ feedback, setFeedback ] = useState<AdminTasksFeedback | null>(null);

    const setActionState = useCallback((taskId: string, state?: AdminTaskActionState) => {
        setActionStateByTask(current => {
            if (current[taskId] === state) return current;
            const next = { ...current };
            if (state) next[taskId] = state;
            else delete next[taskId];
            return next;
        });
    }, []);

    const performAction = useCallback((
        taskId: string,
        actionState: AdminTaskActionState,
        action: () => Promise<unknown>,
        acceptedMessage: string,
        failureMessage: string
    ) => {
        const normalizedTaskId = taskId.trim();
        if (!api || !serverKey || !normalizedTaskId) {
            setFeedback({ message: failureMessage, tone: 'error' });
            return Promise.resolve(false);
        }

        const existingFlight = flightsRef.current.get(normalizedTaskId);
        if (existingFlight) return existingFlight;

        const keys = getAdminTasksQueryKeys(serverKey, normalizedTaskId);
        const flight = (async () => {
            setActionState(normalizedTaskId, actionState);
            setFeedback(null);
            try {
                await Promise.allSettled([
                    queryClient.cancelQueries({ exact: true, queryKey: keys.list }),
                    queryClient.cancelQueries({ exact: true, queryKey: keys.detail })
                ]);
                await action();
                setFeedback({ message: acceptedMessage, tone: 'success' });
                await invalidateAdminTaskConsumers(queryClient, serverKey, normalizedTaskId);
                return true;
            } catch (error) {
                setFeedback(taskActionError(error, failureMessage));
                return false;
            } finally {
                setActionState(normalizedTaskId);
                flightsRef.current.delete(normalizedTaskId);
            }
        })();

        flightsRef.current.set(normalizedTaskId, flight);
        return flight;
    }, [ api, queryClient, serverKey, setActionState ]);

    const runTask = useCallback((taskId: string) => performAction(
        taskId,
        'starting',
        () => runAdminTask(api!, taskId),
        'Task start request accepted. PiggieTV is refreshing its server-confirmed status.',
        "We couldn't start this task."
    ), [ api, performAction ]);

    const stopTask = useCallback((taskId: string) => performAction(
        taskId,
        'stopping',
        () => stopAdminTask(api!, taskId),
        'Cancellation requested. PiggieTV is refreshing its server-confirmed status.',
        "We couldn't stop this task."
    ), [ api, performAction ]);

    const saveTriggers = useCallback((
        taskId: string,
        baseline: readonly PtvAdminTaskTrigger[],
        next: readonly PtvAdminTaskTrigger[]
    ) => performAction(
        taskId,
        'saving-schedule',
        () => saveAdminTaskTriggers(
            api!,
            taskId,
            baseline.map(trigger => trigger.raw),
            next.map(trigger => trigger.raw)
        ),
        'Task schedule saved.',
        "We couldn't save this task schedule."
    ), [ api, performAction ]);

    return {
        actionStateByTask,
        feedback,
        runTask,
        saveTriggers,
        stopTask
    } as const;
}

export function useAdminTasks(api?: Api, apiClient?: ApiClient) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const keys = getAdminTasksQueryKeys(serverKey);
    const actions = useAdminTaskActions(api, apiClient);
    const listQuery = useQuery({
        enabled: Boolean(api && serverKey),
        queryFn: ({ signal }) => loadAdminTasks(api!, signal),
        queryKey: keys.list,
        refetchInterval: query => getAdminTasksRefreshInterval(query.state.data),
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        retry: retryAdminTasksQuery,
        staleTime: 4_000
    });
    const refreshFlightRef = useRef<Promise<unknown> | null>(null);
    const refetchList = listQuery.refetch;
    const refresh = useCallback(() => {
        if (!api || !serverKey) return Promise.resolve();
        if (refreshFlightRef.current) return refreshFlightRef.current;
        const flight = refetchList({ cancelRefetch: true }).finally(() => {
            refreshFlightRef.current = null;
        });
        refreshFlightRef.current = flight;
        return flight;
    }, [ api, refetchList, serverKey ]);

    useVisibleTaskRefresh(refresh);

    return {
        ...actions,
        error: listQuery.isError && !listQuery.data ? listQuery.error : null,
        refreshError: listQuery.isError && Boolean(listQuery.data),
        initialLoading: listQuery.isPending && !listQuery.data,
        refresh,
        refreshing: listQuery.isFetching && Boolean(listQuery.data),
        tasks: listQuery.data || []
    } as const;
}

export function useAdminTask(
    api: Api | undefined,
    apiClient: ApiClient | undefined,
    taskId: string
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const keys = getAdminTasksQueryKeys(serverKey, taskId);
    const actions = useAdminTaskActions(api, apiClient);
    const detailQuery = useQuery({
        enabled: Boolean(api && serverKey && taskId),
        queryFn: ({ signal }) => loadAdminTask(api!, taskId, signal),
        queryKey: keys.detail,
        refetchInterval: query => getAdminTasksRefreshInterval(
            query.state.data ? [ query.state.data ] : undefined
        ),
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        retry: retryAdminTasksQuery,
        staleTime: 4_000
    });
    const refreshFlightRef = useRef<Promise<unknown> | null>(null);
    const refetchDetail = detailQuery.refetch;
    const refresh = useCallback(() => {
        if (!api || !serverKey) return Promise.resolve();
        if (refreshFlightRef.current) return refreshFlightRef.current;
        const flight = refetchDetail({ cancelRefetch: true }).finally(() => {
            refreshFlightRef.current = null;
        });
        refreshFlightRef.current = flight;
        return flight;
    }, [ api, refetchDetail, serverKey ]);

    useVisibleTaskRefresh(refresh);

    const terminalError = detailQuery.error instanceof AdminTasksServiceError
        && detailQuery.error.code !== 'load-unavailable';

    const saveTriggers = useCallback((
        baseline: readonly PtvAdminTaskTrigger[],
        next: readonly PtvAdminTaskTrigger[]
    ) => actions.saveTriggers(taskId, baseline, next), [ actions, taskId ]);
    const actionState = actions.actionStateByTask[taskId];

    return useMemo(() => ({
        actionState,
        error: detailQuery.isError && (terminalError || !detailQuery.data) ? detailQuery.error : null,
        feedback: actions.feedback,
        loading: detailQuery.isPending && !detailQuery.data,
        refresh,
        refreshing: detailQuery.isFetching && Boolean(detailQuery.data),
        refreshError: detailQuery.isError && Boolean(detailQuery.data) && !terminalError,
        runTask: actions.runTask,
        saveTriggers,
        stopTask: actions.stopTask,
        task: terminalError ? null : detailQuery.data || null
    }), [
        actionState,
        actions.feedback,
        actions.runTask,
        actions.stopTask,
        detailQuery.data,
        detailQuery.error,
        detailQuery.isError,
        detailQuery.isFetching,
        detailQuery.isPending,
        refresh,
        saveTriggers,
        terminalError
    ]);
}
