import type { Api } from '@jellyfin/sdk';
import type { TaskTriggerInfo } from '@jellyfin/sdk/lib/generated-client/models/task-trigger-info';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminTasksServiceError, type PtvAdminTask } from './adminTasksModel';

const taskService = vi.hoisted(() => ({
    loadAdminTask: vi.fn(),
    loadAdminTasks: vi.fn(),
    runAdminTask: vi.fn(),
    saveAdminTaskTriggers: vi.fn(),
    stopAdminTask: vi.fn()
}));

vi.mock('./adminTasksService', async importOriginal => {
    const original = await importOriginal<typeof import('./adminTasksService')>();
    return { ...original, ...taskService };
});

import {
    ADMIN_TASKS_IDLE_REFRESH_INTERVAL_MS,
    ADMIN_TASKS_RUNNING_REFRESH_INTERVAL_MS,
    getAdminTasksQueryKeys,
    getAdminTasksRefreshInterval,
    useAdminTask,
    useAdminTasks
} from './useAdminTasks';

const api = {} as Api;
const apiClient = { serverId: () => 'server-a' } as unknown as ApiClient;

function task(overrides: Partial<PtvAdminTask> = {}): PtvAdminTask {
    return {
        canEditSchedule: true,
        canRun: true,
        canStop: false,
        category: 'Maintenance',
        description: 'Performs safe server maintenance.',
        hidden: false,
        id: 'task-a',
        key: 'TaskA',
        lastResult: {
            completedAt: '2026-08-12T20:01:00.000Z',
            durationMilliseconds: 60_000,
            startedAt: '2026-08-12T20:00:00.000Z',
            status: 'completed'
        },
        name: 'Maintenance task',
        progressPercent: null,
        source: 'unknown',
        state: 'idle',
        triggers: [],
        triggersAvailable: true,
        ...overrides
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(next => {
        resolve = next;
    });
    return { promise, resolve };
}

type ListState = ReturnType<typeof useAdminTasks>;
type DetailState = ReturnType<typeof useAdminTask>;

function ListHarness({ client = apiClient, stateRef, enabled = true }: Readonly<{
    client?: ApiClient;
    enabled?: boolean;
    stateRef: { current?: ListState };
}>) {
    stateRef.current = useAdminTasks(enabled ? api : undefined, client);
    return null;
}

function DetailHarness({ stateRef, taskId = 'task-a' }: Readonly<{
    stateRef: { current?: DetailState };
    taskId?: string;
}>) {
    stateRef.current = useAdminTask(api, apiClient, taskId);
    return null;
}

describe('administrator scheduled-task hooks', () => {
    let container: HTMLDivElement;
    let queryClient: QueryClient;
    let root: Root;
    let visibilityState: DocumentVisibilityState;

    async function flush() {
        await act(async () => {
            await Promise.resolve();
            await vi.advanceTimersByTimeAsync(0);
            await Promise.resolve();
        });
    }

    beforeEach(() => {
        /* eslint-disable @typescript-eslint/naming-convention */
        Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
        /* eslint-enable @typescript-eslint/naming-convention */
        vi.useFakeTimers();
        visibilityState = 'visible';
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => visibilityState
        });
        vi.clearAllMocks();
        taskService.loadAdminTasks.mockResolvedValue([ task() ]);
        taskService.loadAdminTask.mockResolvedValue(task());
        taskService.runAdminTask.mockResolvedValue(task());
        taskService.stopAdminTask.mockResolvedValue(task({
            canRun: false,
            canStop: true,
            state: 'running'
        }));
        taskService.saveAdminTaskTriggers.mockResolvedValue(task());
        queryClient = new QueryClient({
            defaultOptions: { queries: { gcTime: Infinity, retry: false } }
        });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        queryClient.clear();
        container.remove();
        Reflect.deleteProperty(document, 'visibilityState');
        Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
        vi.useRealTimers();
    });

    it('does not load or run tasks before the server id resolves', async () => {
        const stateRef: { current?: ListState } = {};
        const unresolved = { serverId: () => '' } as unknown as ApiClient;
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <ListHarness client={unresolved} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flush();

        expect(taskService.loadAdminTasks).not.toHaveBeenCalled();
        let accepted = true;
        await act(async () => {
            accepted = await stateRef.current!.runTask('task-a');
        });
        expect(accepted).toBe(false);
        expect(taskService.runAdminTask).not.toHaveBeenCalled();
    });

    it('loads one non-hidden inventory request and performs no mutation on load', async () => {
        const stateRef: { current?: ListState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <ListHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flush();

        expect(stateRef.current?.tasks).toHaveLength(1);
        expect(taskService.loadAdminTasks).toHaveBeenCalledOnce();
        expect(taskService.loadAdminTask).not.toHaveBeenCalled();
        expect(taskService.runAdminTask).not.toHaveBeenCalled();
        expect(taskService.stopAdminTask).not.toHaveBeenCalled();
        expect(taskService.saveAdminTaskTriggers).not.toHaveBeenCalled();
    });

    it('direct-loads one detail without first loading the inventory or mutating it', async () => {
        const stateRef: { current?: DetailState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <DetailHarness stateRef={stateRef} taskId='task-b' />
            </QueryClientProvider>
        ));
        await flush();

        expect(taskService.loadAdminTask).toHaveBeenCalledWith(api, 'task-b', expect.any(AbortSignal));
        expect(taskService.loadAdminTasks).not.toHaveBeenCalled();
        expect(taskService.runAdminTask).not.toHaveBeenCalled();
        expect(taskService.stopAdminTask).not.toHaveBeenCalled();
        expect(taskService.saveAdminTaskTriggers).not.toHaveBeenCalled();
    });

    it('drops cached detail and reports not-found when a task disappears on refresh', async () => {
        const stateRef: { current?: DetailState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <DetailHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flush();
        expect(stateRef.current?.task?.id).toBe('task-a');

        taskService.loadAdminTask.mockRejectedValueOnce(new AdminTasksServiceError(
            'not-found',
            'This task is no longer available.'
        ));
        await act(async () => {
            await stateRef.current!.refresh();
        });
        await flush();

        expect(stateRef.current?.task).toBeNull();
        expect(stateRef.current?.error).toMatchObject({ code: 'not-found' });
        expect(stateRef.current?.refreshError).toBe(false);
        expect(taskService.loadAdminTask).toHaveBeenCalledTimes(2);
    });

    it('does not request task data without an authenticated API', async () => {
        const stateRef: { current?: ListState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <ListHarness enabled={false} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flush();

        expect(stateRef.current?.tasks).toEqual([]);
        expect(taskService.loadAdminTasks).not.toHaveBeenCalled();
    });

    it('uses adaptive visible-only refresh intervals', () => {
        expect(getAdminTasksRefreshInterval([ task() ], 'visible'))
            .toBe(ADMIN_TASKS_IDLE_REFRESH_INTERVAL_MS);
        expect(getAdminTasksRefreshInterval([
            task({ state: 'running' })
        ], 'visible')).toBe(ADMIN_TASKS_RUNNING_REFRESH_INTERVAL_MS);
        expect(getAdminTasksRefreshInterval([
            task({ state: 'cancelling' })
        ], 'visible')).toBe(ADMIN_TASKS_RUNNING_REFRESH_INTERVAL_MS);
        expect(getAdminTasksRefreshInterval([ task() ], 'hidden')).toBe(false);
    });

    it('pauses polling while hidden and refreshes once when visibility returns', async () => {
        visibilityState = 'hidden';
        const stateRef: { current?: ListState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <ListHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flush();

        await act(async () => vi.advanceTimersByTimeAsync(120_000));
        expect(taskService.loadAdminTasks).toHaveBeenCalledOnce();

        visibilityState = 'visible';
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
            await Promise.resolve();
        });
        await flush();
        expect(taskService.loadAdminTasks).toHaveBeenCalledTimes(2);
    });

    it('keeps manual refresh and task starts single-flight', async () => {
        const stateRef: { current?: ListState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <ListHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flush();

        const refreshRequest = deferred<PtvAdminTask[]>();
        taskService.loadAdminTasks.mockReturnValueOnce(refreshRequest.promise);
        let firstRefresh!: Promise<unknown>;
        let secondRefresh!: Promise<unknown>;
        await act(async () => {
            firstRefresh = stateRef.current!.refresh();
            secondRefresh = stateRef.current!.refresh();
            await Promise.resolve();
        });
        expect(firstRefresh).toBe(secondRefresh);
        expect(taskService.loadAdminTasks).toHaveBeenCalledTimes(2);
        await act(async () => {
            refreshRequest.resolve([ task() ]);
            await firstRefresh;
        });

        const runRequest = deferred<PtvAdminTask>();
        taskService.runAdminTask.mockReturnValueOnce(runRequest.promise);
        let firstRun!: Promise<boolean>;
        let secondRun!: Promise<boolean>;
        await act(async () => {
            firstRun = stateRef.current!.runTask('task-a');
            secondRun = stateRef.current!.runTask('task-a');
            await Promise.resolve();
        });
        expect(firstRun).toBe(secondRun);
        expect(taskService.runAdminTask).toHaveBeenCalledOnce();
        expect(stateRef.current?.actionStateByTask['task-a']).toBe('starting');
        await act(async () => {
            runRequest.resolve(task());
            await firstRun;
        });
        await flush();
        expect(stateRef.current?.feedback?.message).toContain('server-confirmed status');
        expect(stateRef.current?.feedback?.message).not.toContain('completed');
    });

    it('passes complete opaque trigger documents to the conflict-safe schedule service', async () => {
        const stateRef: { current?: DetailState } = {};
        const baselineRaw = {
            PluginField: { keep: true },
            TimeOfDayTicks: 108_000_000_000,
            Type: 'DailyTrigger'
        } as TaskTriggerInfo & Record<string, unknown>;
        const nextRaw = {
            PluginField: { keep: true },
            TimeOfDayTicks: 144_000_000_000,
            Type: 'DailyTrigger'
        } as TaskTriggerInfo & Record<string, unknown>;
        const trigger = (raw: TaskTriggerInfo & Record<string, unknown>) => ({
            dayOfWeek: null,
            description: 'Daily at server local time',
            intervalTicks: null,
            maxRuntimeTicks: null,
            raw,
            serverLocal: true,
            timeOfDayTicks: Number(raw.TimeOfDayTicks),
            type: 'daily' as const,
            typeValue: 'DailyTrigger'
        });
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <DetailHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flush();

        await act(async () => {
            await stateRef.current!.saveTriggers([ trigger(baselineRaw) ], [ trigger(nextRaw) ]);
        });

        expect(taskService.saveAdminTaskTriggers).toHaveBeenCalledWith(
            api,
            'task-a',
            [ baselineRaw ],
            [ nextRaw ]
        );
    });

    it('isolates list and detail keys by server and immutable task id', () => {
        expect(getAdminTasksQueryKeys('server-a', ' TASK-A ')).toEqual({
            detail: [ 'PtvAdminTasks', 'server-a', 'detail', 'TASK-A' ],
            list: [ 'PtvAdminTasks', 'server-a', 'list', { isHidden: false } ]
        });
        expect(getAdminTasksQueryKeys('server-b', 'task-b').detail)
            .toEqual([ 'PtvAdminTasks', 'server-b', 'detail', 'task-b' ]);
    });
});
