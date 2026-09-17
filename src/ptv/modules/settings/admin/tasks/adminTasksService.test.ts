import type { Api } from '@jellyfin/sdk';
import type { TaskInfo } from '@jellyfin/sdk/lib/generated-client/models/task-info';
import type { TaskTriggerInfo } from '@jellyfin/sdk/lib/generated-client/models/task-trigger-info';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    getTask: vi.fn(),
    getTasks: vi.fn(),
    startTask: vi.fn(),
    stopTask: vi.fn(),
    updateTask: vi.fn()
}));

vi.mock('@jellyfin/sdk/lib/utils/api/scheduled-tasks-api', () => ({
    getScheduledTasksApi: () => apiMocks
}));

import { JELLYFIN_TICKS_PER_HOUR } from './adminTaskTime';
import {
    loadAdminTask,
    loadAdminTasks,
    runAdminTask,
    saveAdminTaskTriggers,
    stopAdminTask
} from './adminTasksService';

type RawTrigger = TaskTriggerInfo & Record<string, unknown>;

const api = {} as Api;

function rawTask(overrides: Partial<TaskInfo> = {}): TaskInfo {
    return {
        Category: 'Maintenance',
        Description: 'Runs maintenance.',
        Id: 'task-a',
        IsHidden: false,
        Key: 'MaintenanceTask',
        Name: 'Maintenance',
        State: 'Idle',
        Triggers: [],
        ...overrides
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe('administrator Scheduled Tasks service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMocks.getTask.mockResolvedValue({ data: rawTask() });
        apiMocks.getTasks.mockResolvedValue({ data: [ rawTask() ] });
        apiMocks.startTask.mockResolvedValue({ data: undefined });
        apiMocks.stopTask.mockResolvedValue({ data: undefined });
        apiMocks.updateTask.mockResolvedValue({ data: undefined });
    });

    it('uses the exact SDK list and detail reads with AbortSignals', async () => {
        const signal = {} as AbortSignal;
        const list = await loadAdminTasks(api, signal);
        const detail = await loadAdminTask(api, ' task-a ', signal);

        expect(apiMocks.getTasks).toHaveBeenCalledWith(
            { isHidden: false },
            { signal }
        );
        expect(apiMocks.getTask).toHaveBeenCalledWith(
            { taskId: 'task-a' },
            { signal }
        );
        expect(list).toHaveLength(1);
        expect(detail.id).toBe('task-a');
    });

    it('rejects a non-array list response and hides technical request failures', async () => {
        apiMocks.getTasks.mockResolvedValueOnce({ data: {} });
        await expect(loadAdminTasks(api)).rejects.toMatchObject({
            code: 'invalid-response',
            message: 'Scheduled tasks could not be loaded.'
        });

        apiMocks.getTasks.mockRejectedValueOnce(new Error('secret upstream response'));
        await expect(loadAdminTasks(api)).rejects.toMatchObject({
            code: 'load-unavailable',
            message: 'Scheduled tasks could not be loaded.'
        });
    });

    it('preflights invalid ids and rejects direct reads of hidden tasks', async () => {
        await expect(loadAdminTask(api, '  ')).rejects.toMatchObject({
            code: 'invalid-input'
        });
        expect(apiMocks.getTask).not.toHaveBeenCalled();

        apiMocks.getTask.mockResolvedValueOnce({
            data: rawTask({ IsHidden: true })
        });
        await expect(loadAdminTask(api, 'hidden-task')).rejects.toMatchObject({
            code: 'hidden-task'
        });
    });

    it('returns a user-safe not-found state when a selected task disappears', async () => {
        apiMocks.getTask.mockRejectedValueOnce({
            response: {
                data: 'secret response body',
                status: 404
            }
        });

        await expect(loadAdminTask(api, 'removed-task')).rejects.toMatchObject({
            code: 'not-found',
            message: 'This task is no longer available.'
        });
    });

    it('fresh-checks Idle and keeps duplicate Run requests single-flight', async () => {
        const pending = deferred<{ data: TaskInfo }>();
        apiMocks.getTask.mockReturnValueOnce(pending.promise);

        const first = runAdminTask(api, 'task-a');
        const second = runAdminTask(api, 'task-a');

        expect(first).toBe(second);
        expect(apiMocks.getTask).toHaveBeenCalledOnce();
        pending.resolve({ data: rawTask({ State: 'Idle' }) });
        await first;

        expect(apiMocks.startTask).toHaveBeenCalledOnce();
        expect(apiMocks.startTask).toHaveBeenCalledWith(
            { taskId: 'task-a' },
            { signal: undefined }
        );
    });

    it('does not Run after a fresh non-idle state and sanitizes execution failures', async () => {
        apiMocks.getTask.mockResolvedValueOnce({ data: rawTask({ State: 'Running' }) });
        await expect(runAdminTask(api, 'task-a')).rejects.toMatchObject({
            code: 'state-changed'
        });
        expect(apiMocks.startTask).not.toHaveBeenCalled();

        apiMocks.getTask.mockResolvedValueOnce({ data: rawTask({ State: 'Idle' }) });
        apiMocks.startTask.mockRejectedValueOnce(new Error('secret execution response'));
        await expect(runAdminTask(api, 'task-a')).rejects.toMatchObject({
            code: 'operation-failed',
            message: 'The scheduled task could not be started.'
        });
    });

    it('fresh-checks Running before the exact cooperative stop request', async () => {
        const signal = {} as AbortSignal;
        apiMocks.getTask.mockResolvedValueOnce({ data: rawTask({ State: 'Running' }) });

        await stopAdminTask(api, 'task-a', signal);

        expect(apiMocks.stopTask).toHaveBeenCalledWith(
            { taskId: 'task-a' },
            { signal }
        );

        apiMocks.getTask.mockResolvedValueOnce({ data: rawTask({ State: 'Cancelling' }) });
        await expect(stopAdminTask(api, 'task-a')).rejects.toMatchObject({
            code: 'state-changed'
        });
        expect(apiMocks.stopTask).toHaveBeenCalledOnce();
    });

    it('isolates flights by Api instance, task, and action', async () => {
        const anotherApi = {} as Api;
        const pending = deferred<{ data: TaskInfo }>();
        apiMocks.getTask
            .mockReturnValueOnce(pending.promise)
            .mockResolvedValueOnce({ data: rawTask({ Id: 'task-b', State: 'Idle' }) })
            .mockResolvedValueOnce({ data: rawTask({ State: 'Idle' }) });

        const sameTaskApiA = runAdminTask(api, 'task-a');
        const differentTask = runAdminTask(api, 'task-b');
        const sameTaskApiB = runAdminTask(anotherApi, 'task-a');
        pending.resolve({ data: rawTask({ State: 'Idle' }) });
        await Promise.all([ sameTaskApiA, differentTask, sameTaskApiB ]);

        expect(apiMocks.getTask).toHaveBeenCalledTimes(3);
        expect(apiMocks.startTask).toHaveBeenCalledTimes(3);
    });

    it('rejects a changed authoritative trigger baseline without writing', async () => {
        const baseline: RawTrigger[] = [
            { IntervalTicks: JELLYFIN_TICKS_PER_HOUR, Type: 'IntervalTrigger' }
        ];
        apiMocks.getTask.mockResolvedValueOnce({
            data: rawTask({
                Triggers: [
                    { IntervalTicks: 2 * JELLYFIN_TICKS_PER_HOUR, Type: 'IntervalTrigger' }
                ]
            })
        });

        await expect(saveAdminTaskTriggers(api, 'task-a', baseline, [])).rejects.toMatchObject({
            code: 'conflict'
        });
        expect(apiMocks.updateTask).not.toHaveBeenCalled();
    });

    it('refuses to reconstruct a schedule when the authoritative trigger array is unavailable', async () => {
        apiMocks.getTask.mockResolvedValueOnce({
            data: rawTask({ Triggers: undefined })
        });

        await expect(saveAdminTaskTriggers(api, 'task-a', [], [])).rejects.toMatchObject({
            code: 'invalid-response',
            message: 'This task schedule is unavailable. Reload before trying again.'
        });
        expect(apiMocks.updateTask).not.toHaveBeenCalled();
    });

    it('clones and replaces the full edited array while preserving unknown fields and order', async () => {
        const baseline = [
            {
                PluginState: { Keep: [ 'nested' ] },
                TimeOfDayTicks: 3 * JELLYFIN_TICKS_PER_HOUR,
                Type: 'VendorTrigger'
            },
            { Type: 'StartupTrigger' }
        ] as unknown as RawTrigger[];
        const edited = [
            baseline[1],
            {
                PluginState: { Keep: [ 'nested' ] },
                TimeOfDayTicks: 4 * JELLYFIN_TICKS_PER_HOUR,
                Type: 'VendorTrigger'
            }
        ] as unknown as RawTrigger[];
        const pending = deferred<{ data: TaskInfo }>();
        apiMocks.getTask.mockReturnValueOnce(pending.promise);

        const save = saveAdminTaskTriggers(api, 'task-a', baseline, edited);
        (edited[1].PluginState as { Keep: string[] }).Keep.push('late-mutation');
        pending.resolve({ data: rawTask({ Triggers: baseline }) });
        const result = await save;

        const written = apiMocks.updateTask.mock.calls[0][0].taskTriggerInfo as RawTrigger[];
        expect(written).toEqual([
            { Type: 'StartupTrigger' },
            {
                PluginState: { Keep: [ 'nested' ] },
                TimeOfDayTicks: 4 * JELLYFIN_TICKS_PER_HOUR,
                Type: 'VendorTrigger'
            }
        ]);
        expect(written).not.toBe(edited);
        expect(written[1].PluginState).not.toBe(baseline[0].PluginState);
        expect(result.triggers.map(trigger => trigger.raw)).toEqual(written);
    });

    it('avoids a write when the desired full trigger array is already authoritative', async () => {
        const triggers: RawTrigger[] = [ { Type: 'StartupTrigger', VendorFlag: true } ];
        apiMocks.getTask.mockResolvedValueOnce({ data: rawTask({ Triggers: triggers }) });

        const result = await saveAdminTaskTriggers(api, 'task-a', triggers, triggers);

        expect(apiMocks.updateTask).not.toHaveBeenCalled();
        expect(result.triggers[0].raw).toEqual(triggers[0]);
    });

    it('keeps duplicate schedule saves single-flight and rejects changes while active', async () => {
        const baseline: RawTrigger[] = [ { Type: 'StartupTrigger' } ];
        const edited: RawTrigger[] = [];
        const pending = deferred<{ data: TaskInfo }>();
        apiMocks.getTask.mockReturnValueOnce(pending.promise);

        const first = saveAdminTaskTriggers(api, 'task-a', baseline, edited);
        const second = saveAdminTaskTriggers(api, 'task-a', baseline, edited);
        expect(first).toBe(second);
        pending.resolve({ data: rawTask({ Triggers: baseline }) });
        await first;
        expect(apiMocks.updateTask).toHaveBeenCalledOnce();

        apiMocks.getTask.mockResolvedValueOnce({
            data: rawTask({ State: 'Running', Triggers: baseline })
        });
        await expect(saveAdminTaskTriggers(api, 'task-a', baseline, edited))
            .rejects.toMatchObject({ code: 'state-changed' });
        expect(apiMocks.updateTask).toHaveBeenCalledOnce();
    });
});
