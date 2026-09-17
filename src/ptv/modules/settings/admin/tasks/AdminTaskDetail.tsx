import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import PtvIcon from '../../../icons/PtvIcon';
import { useAdminUnsavedChanges } from '../configuration/useAdminUnsavedChanges';

import { equalTaskTriggers, normalizeAdminTaskTrigger } from './adminTasksAdapters';
import {
    AdminTasksServiceError,
    type PtvAdminTask,
    type PtvAdminTaskTrigger
} from './adminTasksModel';
import { ADMIN_TASKS_PATH } from './AdminTasksRoute';
import { AdminTaskTriggerDialog } from './AdminTaskDialogs';
import {
    type AdminTaskActionState,
    type AdminTaskFeedback,
    formatTaskDuration,
    formatTaskRelativeTime,
    getTaskStatus
} from './AdminTaskList';

/* eslint-disable react/jsx-no-bind, no-nested-ternary, react/no-array-index-key, sonarjs/cognitive-complexity, sonarjs/no-nested-conditional */

function rawTriggers(triggers: readonly PtvAdminTaskTrigger[]) {
    return triggers.map(trigger => trigger.raw);
}

function formatTaskDate(timestamp: string | null) {
    if (!timestamp) return 'Never';
    const value = new Date(timestamp);
    return Number.isFinite(value.getTime()) ? value.toLocaleString() : 'Unavailable';
}

function AdminTaskDetailSkeleton() {
    return (
        <div aria-label='Loading task details' aria-live='polite' className='ptv-admin-task-detail-skeleton' role='status'>
            <span className='is-title' />
            <span className='is-subtitle' />
            <div><span /><span /><span /></div>
            <div><span /><span /><span /></div>
        </div>
    );
}

function AdminTaskDetailStatus({ task }: Readonly<{ task: PtvAdminTask }>) {
    const status = getTaskStatus(task);
    return (
        <span className={`ptv-admin-task-status is-${status.severity}`}>
            <span aria-hidden='true' />
            {status.label}
        </span>
    );
}

export function AdminTaskDetail({
    actionState,
    error,
    feedback,
    loading,
    onRefresh,
    onRun,
    onSaveTriggers,
    onStop,
    refreshing,
    task
}: Readonly<{
    actionState: AdminTaskActionState;
    error: unknown;
    feedback: AdminTaskFeedback;
    loading: boolean;
    onRefresh: () => void;
    onRun: (task: PtvAdminTask) => void;
    onSaveTriggers: (baseline: readonly PtvAdminTaskTrigger[], next: readonly PtvAdminTaskTrigger[]) => Promise<boolean>;
    onStop: (task: PtvAdminTask) => void;
    refreshing: boolean;
    task: PtvAdminTask | null;
}>) {
    const [ baseline, setBaseline ] = useState<readonly PtvAdminTaskTrigger[]>(task?.triggers || []);
    const [ draft, setDraft ] = useState<readonly PtvAdminTaskTrigger[]>(task?.triggers || []);
    const [ triggerDialogOpen, setTriggerDialogOpen ] = useState(false);
    const observedTaskId = useRef<string | null>(task?.id || null);
    const observedTriggerSignature = useRef(JSON.stringify(rawTriggers(task?.triggers || [])));
    const dirty = useMemo(() => !equalTaskTriggers(rawTriggers(baseline), rawTriggers(draft)), [ baseline, draft ]);
    const taskTriggerSignature = JSON.stringify(rawTriggers(task?.triggers || []));

    useAdminUnsavedChanges(dirty, 'Leave Tasks & Maintenance without saving this schedule?');

    useEffect(() => {
        if (!task) return;
        const taskChanged = observedTaskId.current !== task.id;
        const triggersChanged = observedTriggerSignature.current !== taskTriggerSignature;
        if (!taskChanged && !triggersChanged) return;
        if (dirty && !taskChanged) return;
        observedTaskId.current = task.id;
        observedTriggerSignature.current = taskTriggerSignature;
        setBaseline(task.triggers);
        setDraft(task.triggers);
    }, [ dirty, task, taskTriggerSignature ]);

    const addTrigger = useCallback((raw: Parameters<typeof normalizeAdminTaskTrigger>[0]) => {
        setDraft(current => [ ...current, normalizeAdminTaskTrigger(raw) ]);
    }, []);

    const removeTrigger = useCallback((index: number) => {
        setDraft(current => current.filter((_, currentIndex) => currentIndex !== index));
    }, []);

    const resetTriggers = useCallback(() => {
        setDraft(baseline);
    }, [ baseline ]);

    const saveTriggers = useCallback(async () => {
        if (!dirty || actionState === 'saving-schedule') return;
        const saved = await onSaveTriggers(baseline, draft);
        if (saved) setBaseline(draft);
    }, [ actionState, baseline, dirty, draft, onSaveTriggers ]);

    if (loading) {
        return (
            <main className='ptv-admin-tasks ptv-admin-task-detail'>
                <Link className='ptv-admin-task-back' to={ADMIN_TASKS_PATH}><PtvIcon name='back' size='17px' />Back to Tasks</Link>
                <AdminTaskDetailSkeleton />
            </main>
        );
    }

    if (error instanceof AdminTasksServiceError && (error.code === 'not-found' || error.code === 'hidden-task')) {
        return (
            <main className='ptv-admin-tasks ptv-admin-task-detail'>
                <Link className='ptv-admin-task-back' to={ADMIN_TASKS_PATH}><PtvIcon name='back' size='17px' />Back to Tasks</Link>
                <section className='ptv-admin-task-state'>
                    <PtvIcon name='tasks' size='28px' />
                    <h1>This task is no longer available.</h1>
                    <p>It may have been removed or unregistered by the server or a plugin.</p>
                </section>
            </main>
        );
    }

    if (error && !task) {
        return (
            <main className='ptv-admin-tasks ptv-admin-task-detail'>
                <Link className='ptv-admin-task-back' to={ADMIN_TASKS_PATH}><PtvIcon name='back' size='17px' />Back to Tasks</Link>
                <section className='ptv-admin-task-state' role='alert'>
                    <PtvIcon name='alerts' size='28px' />
                    <h1>Task details couldn&apos;t be loaded.</h1>
                    <p>PiggieTV could not verify this task with the server.</p>
                    <button disabled={refreshing} onClick={onRefresh} type='button'>{refreshing ? 'Retrying...' : 'Retry'}</button>
                </section>
            </main>
        );
    }

    if (!task) {
        return (
            <main className='ptv-admin-tasks ptv-admin-task-detail'>
                <Link className='ptv-admin-task-back' to={ADMIN_TASKS_PATH}><PtvIcon name='back' size='17px' />Back to Tasks</Link>
                <section className='ptv-admin-task-state'>
                    <PtvIcon name='tasks' size='28px' />
                    <h1>This task is no longer available.</h1>
                    <p>It may have been removed or unregistered by the server or a plugin.</p>
                </section>
            </main>
        );
    }

    const progress = task.state === 'running' && task.progressPercent !== null ? task.progressPercent : null;
    const busy = Boolean(actionState);

    return (
        <main className='ptv-admin-tasks ptv-admin-task-detail'>
            <Link className='ptv-admin-task-back' to={ADMIN_TASKS_PATH}><PtvIcon name='back' size='17px' />Back to Tasks</Link>
            <header className='ptv-admin-task-detail-header'>
                <div>
                    <span>{task.source === 'ptv' ? 'PiggieTV maintenance' : task.category || 'Server maintenance'}</span>
                    <h1>{task.name}</h1>
                    {task.description ? <p>{task.description}</p> : null}
                </div>
                <div>
                    <AdminTaskDetailStatus task={task} />
                    <button aria-busy={refreshing} className='ptv-admin-task-refresh' disabled={refreshing} onClick={onRefresh} type='button'>
                        <PtvIcon name='refresh' size='17px' />
                        {refreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>
            </header>

            {feedback ? (
                <p aria-live='polite' className={`ptv-admin-task-feedback is-${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
                    {feedback.message}
                </p>
            ) : null}

            {error ? <p className='ptv-admin-task-feedback is-error' role='alert'>Task details could not be refreshed. Showing the last confirmed server response.</p> : null}

            <div className='ptv-admin-task-detail-grid'>
                <section className='ptv-admin-task-panel'>
                    <header><PtvIcon name='info' size='20px' /><div><h2>Overview</h2><p>How this task is registered with the server.</p></div></header>
                    <dl className='ptv-admin-task-detail-list'>
                        <div><dt>Status</dt><dd>{getTaskStatus(task).label}</dd></div>
                        <div><dt>Category</dt><dd>{task.category || 'Other'}</dd></div>
                        <div><dt>Source</dt><dd>{task.source === 'ptv' ? 'PiggieTV' : 'Server or plugin'}</dd></div>
                    </dl>
                </section>

                <section className='ptv-admin-task-panel'>
                    <header><PtvIcon name='activity' size='20px' /><div><h2>Execution</h2><p>Authoritative current progress and last result from Jellyfin.</p></div></header>
                    {progress !== null ? (
                        <div className='ptv-admin-task-detail-progress'>
                            <div><strong>Current progress</strong><span>{Math.round(progress)}%</span></div>
                            <div
                                aria-label={`${task.name} - ${Math.round(progress)}% complete`}
                                aria-valuemax={100}
                                aria-valuemin={0}
                                aria-valuenow={Math.round(progress)}
                                className='ptv-admin-task-progress'
                                role='progressbar'
                            ><span style={{ width: `${progress}%` }} /></div>
                        </div>
                    ) : null}
                    <h3 className='ptv-admin-task-subheading'>Last execution</h3>
                    <dl className='ptv-admin-task-detail-list'>
                        <div><dt>Started</dt><dd>{formatTaskDate(task.lastResult.startedAt)}{task.lastResult.startedAt ? <small>{formatTaskRelativeTime(task.lastResult.startedAt)}</small> : null}</dd></div>
                        <div><dt>Completed</dt><dd>{formatTaskDate(task.lastResult.completedAt)}</dd></div>
                        <div><dt>Duration</dt><dd>{formatTaskDuration(task.lastResult.durationMilliseconds)}</dd></div>
                        <div><dt>Result</dt><dd>{task.lastResult.status === 'never-run' ? 'Never run' : task.lastResult.status.charAt(0).toUpperCase() + task.lastResult.status.slice(1)}</dd></div>
                    </dl>
                </section>

                <section className='ptv-admin-task-panel is-wide'>
                    <header>
                        <PtvIcon name='tasks' size='20px' />
                        <div><h2>Schedule</h2><p>Known schedules use the server&apos;s local time. Unsupported schedule documents remain preserved.</p></div>
                        {task.canEditSchedule ? <button className='is-subtle' onClick={() => setTriggerDialogOpen(true)} type='button'>Add Schedule</button> : null}
                    </header>
                    {!task.triggersAvailable ? (
                        <p className='ptv-admin-task-empty-schedule'>Schedule information is unavailable.</p>
                    ) : draft.length ? (
                        <ol className='ptv-admin-task-trigger-list'>
                            {draft.map((trigger, index) => (
                                <li key={`${trigger.typeValue || trigger.type}-${index}`}>
                                    <div>
                                        <strong>{trigger.description}</strong>
                                        {trigger.type === 'unknown' ? <small>Unavailable schedule type; preserved without changes</small> : trigger.maxRuntimeTicks !== null ? <small>Maximum runtime {formatTaskDuration(trigger.maxRuntimeTicks / 10_000)}</small> : null}
                                    </div>
                                    {task.canEditSchedule && trigger.type !== 'unknown' ? (
                                        <button aria-label={`Remove ${trigger.description}`} disabled={actionState === 'saving-schedule'} onClick={() => removeTrigger(index)} type='button'>Remove</button>
                                    ) : null}
                                </li>
                            ))}
                        </ol>
                    ) : <p className='ptv-admin-task-empty-schedule'>No schedule is configured. This task can still be run manually.</p>}
                    {task.canEditSchedule ? (
                        <div className='ptv-admin-task-schedule-actions'>
                            <span aria-live='polite'>{dirty ? 'Schedule has unsaved changes.' : 'Schedule is up to date.'}</span>
                            <div>
                                <button disabled={!dirty || actionState === 'saving-schedule'} onClick={resetTriggers} type='button'>Reset Changes</button>
                                <button className='is-primary' disabled={!dirty || actionState === 'saving-schedule'} onClick={() => { saveTriggers().catch(() => undefined); }} type='button'>
                                    {actionState === 'saving-schedule' ? 'Saving...' : 'Save Changes'}
                                </button>
                            </div>
                        </div>
                    ) : task.triggersAvailable && (task.state === 'running' || task.state === 'cancelling') ? (
                        <p className='ptv-admin-task-readonly'>Schedules cannot be changed while this task is active.</p>
                    ) : task.triggersAvailable ? (
                        <p className='ptv-admin-task-readonly'>Schedule editing is unavailable for this task.</p>
                    ) : null}
                </section>

                <section className='ptv-admin-task-panel is-wide'>
                    <header><PtvIcon name='playback' size='20px' /><div><h2>Actions</h2><p>Jellyfin remains responsible for task execution and cancellation.</p></div></header>
                    <div className='ptv-admin-task-detail-actions'>
                        {task.canRun ? <button className='is-primary' disabled={busy} onClick={() => onRun(task)} type='button'>{actionState === 'starting' ? 'Starting...' : 'Run Now'}</button> : null}
                        {task.canStop ? <button className='is-warning' disabled={busy} onClick={() => onStop(task)} type='button'>{actionState === 'stopping' ? 'Stopping...' : 'Stop Task'}</button> : null}
                        <a href='#/settings/admin/server/logs'><PtvIcon name='logs' size='17px' />View Logs</a>
                    </div>
                </section>
            </div>
            <AdminTaskTriggerDialog onAdd={addTrigger} onClose={() => setTriggerDialogOpen(false)} open={triggerDialogOpen} />
        </main>
    );
}
/* eslint-enable react/jsx-no-bind, no-nested-ternary, react/no-array-index-key, sonarjs/cognitive-complexity, sonarjs/no-nested-conditional */
