import type { Api } from '@jellyfin/sdk';
import type { TaskInfo } from '@jellyfin/sdk/lib/generated-client/models/task-info';
import type { TaskTriggerInfo } from '@jellyfin/sdk/lib/generated-client/models/task-trigger-info';
import { getScheduledTasksApi } from '@jellyfin/sdk/lib/utils/api/scheduled-tasks-api';

import {
    cloneTaskTriggers,
    equalTaskTriggers,
    normalizeAdminTask,
    normalizeAdminTasks
} from './adminTasksAdapters';
import {
    AdminTasksServiceError,
    type PtvAdminTask
} from './adminTasksModel';

type RawTaskTrigger = TaskTriggerInfo & Record<string, unknown>;
type TaskAction = 'run' | 'schedule' | 'stop';

const actionFlights = new WeakMap<Api, Map<string, Promise<unknown>>>();

function isAbortError(error: unknown) {
    return (
        (typeof DOMException !== 'undefined'
            && error instanceof DOMException
            && error.name === 'AbortError')
        || (typeof error === 'object' && error !== null && (
            Reflect.get(error, 'code') === 'ERR_CANCELED'
            || Reflect.get(error, 'name') === 'CanceledError'
        ))
    );
}

function getResponseStatus(error: unknown) {
    if (!error || typeof error !== 'object') return null;
    const directStatus = Reflect.get(error, 'status');
    if (typeof directStatus === 'number') return directStatus;
    const response = Reflect.get(error, 'response');
    if (!response || typeof response !== 'object') return null;
    const responseStatus = Reflect.get(response, 'status');
    return typeof responseStatus === 'number' ? responseStatus : null;
}

function requireTaskId(taskId: string) {
    const normalized = typeof taskId === 'string' ? taskId.trim() : '';
    if (!normalized) {
        throw new AdminTasksServiceError('invalid-input', 'Choose a valid scheduled task.');
    }
    return normalized;
}

function toLoadError(error: unknown): never {
    if (error instanceof AdminTasksServiceError || isAbortError(error)) throw error;
    throw new AdminTasksServiceError(
        'load-unavailable',
        'Scheduled tasks could not be loaded.'
    );
}

function toOperationError(error: unknown, action: 'run' | 'stop'): never {
    if (error instanceof AdminTasksServiceError || isAbortError(error)) throw error;
    throw new AdminTasksServiceError(
        'operation-failed',
        action === 'run' ?
            'The scheduled task could not be started.' :
            'The scheduled task could not be stopped.'
    );
}

function toUpdateError(error: unknown): never {
    if (error instanceof AdminTasksServiceError || isAbortError(error)) throw error;
    throw new AdminTasksServiceError(
        'update-failed',
        'The task schedule could not be saved.'
    );
}

function singleFlight<T>(
    api: Api,
    taskId: string,
    action: TaskAction,
    run: () => Promise<T>
): Promise<T> {
    let flights = actionFlights.get(api);
    if (!flights) {
        flights = new Map();
        actionFlights.set(api, flights);
    }
    const key = `${taskId}:${action}`;
    const current = flights.get(key) as Promise<T> | undefined;
    if (current) return current;

    const promise = run().finally(() => {
        if (flights?.get(key) === promise) flights.delete(key);
    });
    flights.set(key, promise);
    return promise;
}

async function loadRawAdminTask(
    api: Api,
    taskId: string,
    signal?: AbortSignal
): Promise<TaskInfo> {
    const id = requireTaskId(taskId);
    try {
        const response = await getScheduledTasksApi(api).getTask({ taskId: id }, { signal });
        if (!response.data || typeof response.data !== 'object' || Array.isArray(response.data)) {
            throw new AdminTasksServiceError(
                'invalid-response',
                'Scheduled task information could not be read.'
            );
        }
        return response.data;
    } catch (error) {
        if (getResponseStatus(error) === 404) {
            throw new AdminTasksServiceError(
                'not-found',
                'This task is no longer available.'
            );
        }
        return toLoadError(error);
    }
}

/** Loads the authoritative non-hidden task inventory once. */
export async function loadAdminTasks(
    api: Api,
    signal?: AbortSignal
): Promise<PtvAdminTask[]> {
    try {
        const response = await getScheduledTasksApi(api).getTasks(
            { isHidden: false },
            { signal }
        );
        if (!Array.isArray(response.data)) {
            throw new AdminTasksServiceError(
                'invalid-response',
                'Scheduled tasks could not be loaded.'
            );
        }
        return normalizeAdminTasks(response.data);
    } catch (error) {
        return toLoadError(error);
    }
}

/** Direct task reads fail closed when a known hidden id is requested. */
export async function loadAdminTask(
    api: Api,
    taskId: string,
    signal?: AbortSignal
): Promise<PtvAdminTask> {
    const task = normalizeAdminTask(await loadRawAdminTask(api, taskId, signal));
    if (task.hidden) {
        throw new AdminTasksServiceError(
            'hidden-task',
            'This scheduled task is not available in PiggieTV Administration.'
        );
    }
    return task;
}

/** Fresh-checks Idle before requesting task execution. */
export function runAdminTask(
    api: Api,
    taskId: string,
    signal?: AbortSignal
): Promise<void> {
    const id = requireTaskId(taskId);
    return singleFlight(api, id, 'run', async () => {
        try {
            const task = await loadAdminTask(api, id, signal);
            if (!task.canRun) {
                throw new AdminTasksServiceError(
                    'state-changed',
                    'This task is no longer idle. Refresh before trying again.'
                );
            }
            await getScheduledTasksApi(api).startTask({ taskId: id }, { signal });
        } catch (error) {
            return toOperationError(error, 'run');
        }
    });
}

/** Fresh-checks Running before requesting cooperative cancellation. */
export function stopAdminTask(
    api: Api,
    taskId: string,
    signal?: AbortSignal
): Promise<void> {
    const id = requireTaskId(taskId);
    return singleFlight(api, id, 'stop', async () => {
        try {
            const task = await loadAdminTask(api, id, signal);
            if (!task.canStop) {
                throw new AdminTasksServiceError(
                    'state-changed',
                    'This task is no longer running. Refresh before trying again.'
                );
            }
            await getScheduledTasksApi(api).stopTask({ taskId: id }, { signal });
        } catch (error) {
            return toOperationError(error, 'stop');
        }
    });
}

/**
 * Refetches the authoritative task, rejects stale trigger baselines, and sends
 * one cloned full-array replacement without removing unknown fields or order.
 */
export function saveAdminTaskTriggers(
    api: Api,
    taskId: string,
    baseline: readonly RawTaskTrigger[],
    edited: readonly RawTaskTrigger[],
    signal?: AbortSignal
): Promise<PtvAdminTask> {
    const id = requireTaskId(taskId);
    const confirmed = cloneTaskTriggers(baseline);
    const desired = cloneTaskTriggers(edited);

    return singleFlight(api, id, 'schedule', async () => {
        try {
            const raw = await loadRawAdminTask(api, id, signal);
            const task = normalizeAdminTask(raw);
            if (task.hidden) {
                throw new AdminTasksServiceError(
                    'hidden-task',
                    'This scheduled task is not available in PiggieTV Administration.'
                );
            }
            if (!task.triggersAvailable) {
                throw new AdminTasksServiceError(
                    'invalid-response',
                    'This task schedule is unavailable. Reload before trying again.'
                );
            }
            if (!task.canEditSchedule) {
                throw new AdminTasksServiceError(
                    'state-changed',
                    'This task is active. Wait until it is idle before changing its schedule.'
                );
            }

            const authoritative = cloneTaskTriggers(raw.Triggers as RawTaskTrigger[]);
            if (!equalTaskTriggers(authoritative, confirmed)) {
                throw new AdminTasksServiceError(
                    'conflict',
                    'This task schedule changed on the server while you were editing. Reload before saving.'
                );
            }
            if (equalTaskTriggers(authoritative, desired)) return task;

            await getScheduledTasksApi(api).updateTask({
                taskId: id,
                taskTriggerInfo: cloneTaskTriggers(desired)
            }, { signal });
            return normalizeAdminTask({
                ...raw,
                Triggers: cloneTaskTriggers(desired)
            });
        } catch (error) {
            return toUpdateError(error);
        }
    });
}
