import React, { useCallback, useRef, useState } from 'react';

import { useApi } from '../../../../../hooks/useApi';

import { AdminTaskDetail } from './AdminTaskDetail';
import { AdminTaskActionDialog, type PendingTaskAction } from './AdminTaskDialogs';
import { AdminTaskList } from './AdminTaskList';
import type { PtvAdminTask } from './adminTasksModel';
import { useAdminTask, useAdminTasks } from './useAdminTasks';

import './adminTasks.scss';

/* eslint-disable react/jsx-no-bind, no-void */

const IMPACTFUL_DESCRIPTION_PATTERN = /\b(delet|purg|replac|reset|restor|migrat|scan|extract|remov)/i;
const STALE_TASKS_FEEDBACK = {
    message: 'The latest task refresh failed. PiggieTV is still showing the last confirmed server state.',
    tone: 'info' as const
};

/** Confirmation is based on server-provided behavioral copy, never a guessed task name. */
export function taskNeedsRunConfirmation(task: PtvAdminTask) {
    return task.key === 'PtvAccountDataBackup'
        || Boolean(task.description && IMPACTFUL_DESCRIPTION_PATTERN.test(task.description));
}

function useTaskActionDialog(
    runTask: (taskId: string) => Promise<boolean>,
    stopTask: (taskId: string) => Promise<boolean>
) {
    const [ pending, setPending ] = useState<PendingTaskAction | null>(null);
    const confirmFlight = useRef(false);

    const requestRun = useCallback((task: PtvAdminTask) => {
        if (taskNeedsRunConfirmation(task)) {
            setPending({ action: 'run', taskId: task.id, taskName: task.name });
            return;
        }
        void runTask(task.id);
    }, [ runTask ]);

    const requestStop = useCallback((task: PtvAdminTask) => {
        setPending({ action: 'stop', taskId: task.id, taskName: task.name });
    }, []);

    const cancel = useCallback(() => {
        if (!confirmFlight.current) setPending(null);
    }, []);

    const confirm = useCallback(() => {
        if (!pending || confirmFlight.current) return;
        const action = pending;
        confirmFlight.current = true;
        setPending(null);
        const flight = action.action === 'run' ? runTask(action.taskId) : stopTask(action.taskId);
        void flight.finally(() => {
            confirmFlight.current = false;
        });
    }, [ pending, runTask, stopTask ]);

    return { cancel, confirm, pending, requestRun, requestStop } as const;
}

function AdminTasksListWorkspace() {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminTasks(api, apiClient);
    const actions = useTaskActionDialog(state.runTask, state.stopTask);
    const refresh = useCallback(() => void state.refresh(), [ state ]);

    return (
        <>
            <AdminTaskList
                actionStateByTask={state.actionStateByTask}
                error={state.error}
                feedback={state.feedback || (state.refreshError ? STALE_TASKS_FEEDBACK : null)}
                initialLoading={state.initialLoading}
                onRefresh={refresh}
                onRun={actions.requestRun}
                onStop={actions.requestStop}
                refreshing={state.refreshing}
                tasks={state.tasks}
            />
            <AdminTaskActionDialog
                action={actions.pending}
                onCancel={actions.cancel}
                onConfirm={actions.confirm}
                open={Boolean(actions.pending)}
            />
        </>
    );
}

function AdminTaskDetailWorkspace({ taskId }: Readonly<{ taskId: string }>) {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminTask(api, apiClient, taskId);
    const actions = useTaskActionDialog(state.runTask, state.stopTask);
    const refresh = useCallback(() => void state.refresh(), [ state ]);

    return (
        <>
            <AdminTaskDetail
                actionState={state.actionState}
                error={state.error}
                feedback={state.feedback || (state.refreshError ? STALE_TASKS_FEEDBACK : null)}
                loading={state.loading}
                onRefresh={refresh}
                onRun={actions.requestRun}
                onSaveTriggers={state.saveTriggers}
                onStop={actions.requestStop}
                refreshing={state.refreshing}
                task={state.task}
            />
            <AdminTaskActionDialog
                action={actions.pending}
                onCancel={actions.cancel}
                onConfirm={actions.confirm}
                open={Boolean(actions.pending)}
            />
        </>
    );
}

function InvalidAdminTaskRoute() {
    return (
        <AdminTaskDetail
            actionState={undefined}
            error={null}
            feedback={null}
            loading={false}
            onRefresh={() => undefined}
            onRun={() => undefined}
            onSaveTriggers={() => Promise.resolve(false)}
            onStop={() => undefined}
            refreshing={false}
            task={null}
        />
    );
}

export default function PtvAdminTasksPage({ taskId }: Readonly<{ taskId: string | null }>) {
    if (taskId === '') return <AdminTasksListWorkspace />;
    if (taskId === null) return <InvalidAdminTaskRoute />;
    return <AdminTaskDetailWorkspace taskId={taskId} />;
}
/* eslint-enable react/jsx-no-bind, no-void */
