import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import PtvIcon from '../../../icons/PtvIcon';

import type { PtvAdminTask } from './adminTasksModel';
import { ADMIN_TASKS_PATH } from './AdminTasksRoute';

/* eslint-disable react/jsx-no-bind, no-nested-ternary, sonarjs/cognitive-complexity, sonarjs/no-nested-conditional */

export type AdminTaskActionState = 'starting' | 'stopping' | 'saving-schedule' | undefined;
export type AdminTaskFeedback = Readonly<{
    message: string;
    tone: 'error' | 'info' | 'success';
}> | null;

type TaskGroup = 'running' | 'attention' | 'available';
type TaskFilter = 'all' | TaskGroup;

export function formatTaskRelativeTime(timestamp: string | null, now = Date.now()) {
    if (!timestamp) return 'Never';
    const time = Date.parse(timestamp);
    if (!Number.isFinite(time)) return 'Unavailable';

    const elapsed = Math.max(0, now - time);
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function formatTaskDuration(milliseconds: number | null) {
    if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) return 'Unavailable';
    const seconds = Math.round(milliseconds / 1000);
    if (seconds < 60) return `${seconds} sec`;
    const minutes = Math.floor(seconds / 60);
    const remainderSeconds = seconds % 60;
    if (minutes < 60) return remainderSeconds ? `${minutes} min ${remainderSeconds} sec` : `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainderMinutes = minutes % 60;
    return remainderMinutes ? `${hours} hr ${remainderMinutes} min` : `${hours} hr`;
}

export function getTaskStatus(task: PtvAdminTask) {
    if (task.state === 'running') return { label: 'Running', severity: 'info' as const };
    if (task.state === 'cancelling') return { label: 'Stopping', severity: 'warning' as const };
    if (task.state === 'unknown') return { label: 'Unavailable', severity: 'unknown' as const };

    switch (task.lastResult.status) {
        case 'completed': return { label: 'Completed', severity: 'healthy' as const };
        case 'failed': return { label: 'Failed', severity: 'error' as const };
        case 'cancelled': return { label: 'Cancelled', severity: 'warning' as const };
        case 'aborted': return { label: 'Aborted', severity: 'warning' as const };
        case 'never-run': return { label: 'Never run', severity: 'unknown' as const };
        default: return { label: 'Unavailable', severity: 'unknown' as const };
    }
}

export function getTaskGroup(task: PtvAdminTask): TaskGroup {
    if (task.state === 'running' || task.state === 'cancelling') return 'running';
    if (task.lastResult.status === 'failed' || task.lastResult.status === 'aborted') return 'attention';
    return 'available';
}

function taskCanRun(task: PtvAdminTask) {
    const capability = (task as PtvAdminTask & { canRun?: boolean }).canRun;
    return typeof capability === 'boolean' ? capability : task.state === 'idle';
}

function taskCanStop(task: PtvAdminTask) {
    const capability = (task as PtvAdminTask & { canStop?: boolean }).canStop;
    return typeof capability === 'boolean' ? capability : task.state === 'running';
}

function AdminTaskStatusBadge({ task }: Readonly<{ task: PtvAdminTask }>) {
    const status = getTaskStatus(task);
    return (
        <span className={`ptv-admin-task-status is-${status.severity}`}>
            <span aria-hidden='true' />
            {status.label}
        </span>
    );
}

function taskTimestamp(task: PtvAdminTask) {
    const value = task.lastResult.startedAt ? Date.parse(task.lastResult.startedAt) : 0;
    return Number.isFinite(value) ? value : 0;
}

function AdminTaskRow({
    actionState,
    onRun,
    onStop,
    task
}: Readonly<{
    actionState: AdminTaskActionState;
    onRun: (task: PtvAdminTask) => void;
    onStop: (task: PtvAdminTask) => void;
    task: PtvAdminTask;
}>) {
    const canRun = taskCanRun(task);
    const canStop = taskCanStop(task);
    const busy = Boolean(actionState);
    const progress = task.state === 'running' && Number.isFinite(task.progressPercent) ?
        task.progressPercent :
        null;

    return (
        <article className='ptv-admin-task-row'>
            <div className='ptv-admin-task-row-icon' aria-hidden='true'>
                <PtvIcon name={task.source === 'ptv' ? 'piggieHub' : 'tasks'} size='23px' />
            </div>
            <div className='ptv-admin-task-row-main'>
                <div className='ptv-admin-task-row-title'>
                    <h3>{task.name}</h3>
                    {task.source === 'ptv' ? <span className='ptv-admin-task-source'>PiggieTV</span> : null}
                </div>
                {task.description ? <p>{task.description}</p> : null}
                <dl className='ptv-admin-task-row-meta'>
                    <div><dt>Last run</dt><dd>{formatTaskRelativeTime(task.lastResult.startedAt)}</dd></div>
                    {task.lastResult.durationMilliseconds !== null ? (
                        <div><dt>Duration</dt><dd>{formatTaskDuration(task.lastResult.durationMilliseconds)}</dd></div>
                    ) : null}
                    {task.triggers.length ? <div><dt>Schedule</dt><dd>{task.triggers[0].description}</dd></div> : null}
                </dl>
                {progress !== null ? (
                    <div
                        aria-label={`${task.name} - ${Math.round(progress)}% complete`}
                        aria-valuemax={100}
                        aria-valuemin={0}
                        aria-valuenow={Math.round(progress)}
                        className='ptv-admin-task-progress'
                        role='progressbar'
                    >
                        <span style={{ width: `${progress}%` }} />
                    </div>
                ) : null}
            </div>
            <div className='ptv-admin-task-row-actions'>
                <AdminTaskStatusBadge task={task} />
                <div>
                    <Link aria-label={`View ${task.name}`} to={`${ADMIN_TASKS_PATH}/${encodeURIComponent(task.id)}`}>View</Link>
                    {canRun ? (
                        <button aria-label={`Run ${task.name} now`} disabled={busy} onClick={() => onRun(task)} type='button'>
                            {actionState === 'starting' ? 'Starting...' : 'Run Now'}
                        </button>
                    ) : null}
                    {canStop ? (
                        <button aria-label={`Stop ${task.name}`} className='is-warning' disabled={busy} onClick={() => onStop(task)} type='button'>
                            {actionState === 'stopping' ? 'Stopping...' : 'Stop Task'}
                        </button>
                    ) : null}
                </div>
            </div>
        </article>
    );
}

function AdminTaskSkeleton() {
    return (
        <div aria-label='Loading server tasks' aria-live='polite' className='ptv-admin-task-skeletons' role='status'>
            {[ 0, 1, 2, 3 ].map(index => (
                <div className='ptv-admin-task-row is-skeleton' key={index}>
                    <span className='ptv-admin-task-skeleton-icon' />
                    <span className='ptv-admin-task-skeleton-copy'><i /><i /><i /></span>
                    <span className='ptv-admin-task-skeleton-action' />
                </div>
            ))}
        </div>
    );
}

const GROUP_LABELS: Readonly<Record<TaskGroup, string>> = {
    attention: 'Needs Attention',
    available: 'Available',
    running: 'Running'
};

export function AdminTaskList({
    actionStateByTask,
    error,
    feedback,
    initialLoading,
    onRefresh,
    onRun,
    onStop,
    refreshing,
    tasks
}: Readonly<{
    actionStateByTask: Readonly<Record<string, AdminTaskActionState>>;
    error: unknown;
    feedback: AdminTaskFeedback;
    initialLoading: boolean;
    onRefresh: () => void;
    onRun: (task: PtvAdminTask) => void;
    onStop: (task: PtvAdminTask) => void;
    refreshing: boolean;
    tasks: readonly PtvAdminTask[];
}>) {
    const [ query, setQuery ] = useState('');
    const [ filter, setFilter ] = useState<TaskFilter>('all');
    const [ category, setCategory ] = useState('all');

    const counts = useMemo(() => tasks.reduce<Record<TaskGroup, number>>((result, task) => {
        result[getTaskGroup(task)] += 1;
        return result;
    }, { attention: 0, available: 0, running: 0 }), [ tasks ]);

    const categories = useMemo(() => Array.from(new Set(tasks
        .map(task => task.category)
        .filter((value): value is string => Boolean(value))))
        .sort((left, right) => left.localeCompare(right)), [ tasks ]);

    const visibleTasks = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        return tasks.filter(task => {
            if (filter !== 'all' && getTaskGroup(task) !== filter) return false;
            if (category !== 'all' && task.category !== category) return false;
            if (!normalizedQuery) return true;
            return [ task.name, task.description, task.category, task.source ]
                .some(value => value?.toLowerCase().includes(normalizedQuery));
        }).sort((left, right) => {
            const groupDifference = [ 'running', 'attention', 'available' ].indexOf(getTaskGroup(left))
                - [ 'running', 'attention', 'available' ].indexOf(getTaskGroup(right));
            if (groupDifference) return groupDifference;
            const recentDifference = taskTimestamp(right) - taskTimestamp(left);
            return recentDifference || left.name.localeCompare(right.name);
        });
    }, [ category, filter, query, tasks ]);

    const groups = useMemo(() => ([ 'running', 'attention', 'available' ] as const)
        .map(group => ({ group, tasks: visibleTasks.filter(task => getTaskGroup(task) === group) }))
        .filter(entry => entry.tasks.length > 0), [ visibleTasks ]);

    const handleQuery = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(event.currentTarget.value);
    }, []);

    return (
        <main className='ptv-admin-tasks'>
            <header className='ptv-admin-tasks-header'>
                <div>
                    <h1>Tasks &amp; Maintenance</h1>
                    <p>Run, schedule and review PiggieTV server maintenance jobs.</p>
                </div>
                <button aria-busy={refreshing} className='ptv-admin-task-refresh' disabled={refreshing} onClick={onRefresh} type='button'>
                    <PtvIcon name='refresh' size='17px' />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </header>

            {feedback ? (
                <p aria-live='polite' className={`ptv-admin-task-feedback is-${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
                    {feedback.message}
                </p>
            ) : null}

            {error && tasks.length > 0 ? (
                <p className='ptv-admin-task-feedback is-error' role='alert'>Task data could not be refreshed. Showing the last confirmed server response.</p>
            ) : null}

            {initialLoading ? <AdminTaskSkeleton /> : error && tasks.length === 0 ? (
                <section className='ptv-admin-task-state' role='alert'>
                    <PtvIcon name='alerts' size='28px' />
                    <h2>Tasks couldn&apos;t be loaded.</h2>
                    <p>PiggieTV could not verify the server&apos;s maintenance task registry.</p>
                    <button disabled={refreshing} onClick={onRefresh} type='button'>{refreshing ? 'Retrying...' : 'Retry'}</button>
                </section>
            ) : tasks.length === 0 ? (
                <section className='ptv-admin-task-state'>
                    <PtvIcon name='tasks' size='28px' />
                    <h2>No maintenance tasks are available.</h2>
                    <p>The server did not return any administrator-visible tasks.</p>
                </section>
            ) : (
                <>
                    <section aria-label='Task filters' className='ptv-admin-task-toolbar'>
                        <label className='ptv-admin-task-search'>
                            <PtvIcon name='search' size='18px' />
                            <input aria-label='Search tasks' onChange={handleQuery} placeholder='Search tasks' type='search' value={query} />
                        </label>
                        <div aria-label='Task status' className='ptv-admin-task-filter-group' role='group'>
                            <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')} type='button'>All <span>{tasks.length}</span></button>
                            {counts.running ? <button aria-pressed={filter === 'running'} onClick={() => setFilter('running')} type='button'>Running <span>{counts.running}</span></button> : null}
                            {counts.attention ? <button aria-pressed={filter === 'attention'} onClick={() => setFilter('attention')} type='button'>Needs Attention <span>{counts.attention}</span></button> : null}
                            {counts.available ? <button aria-pressed={filter === 'available'} onClick={() => setFilter('available')} type='button'>Available <span>{counts.available}</span></button> : null}
                        </div>
                        {categories.length > 1 ? (
                            <label className='ptv-admin-task-category'>
                                <span>Category</span>
                                <select onChange={event => setCategory(event.currentTarget.value)} value={category}>
                                    <option value='all'>All categories</option>
                                    {categories.map(value => <option key={value} value={value}>{value}</option>)}
                                </select>
                            </label>
                        ) : null}
                    </section>
                    {groups.length ? groups.map(entry => (
                        <section className={`ptv-admin-task-group is-${entry.group}`} key={entry.group}>
                            <header><h2>{GROUP_LABELS[entry.group]}</h2><span>{entry.tasks.length}</span></header>
                            <div className='ptv-admin-task-list'>
                                {entry.tasks.map(task => (
                                    <AdminTaskRow
                                        actionState={actionStateByTask[task.id]}
                                        key={task.id}
                                        onRun={onRun}
                                        onStop={onStop}
                                        task={task}
                                    />
                                ))}
                            </div>
                        </section>
                    )) : (
                        <section className='ptv-admin-task-state is-compact'>
                            <h2>No tasks match your filters.</h2>
                            <button onClick={() => {
                                setFilter('all');
                                setCategory('all');
                                setQuery('');
                            }} type='button'>Clear Filters</button>
                        </section>
                    )}
                </>
            )}
        </main>
    );
}
/* eslint-enable react/jsx-no-bind, no-nested-ternary, sonarjs/cognitive-complexity, sonarjs/no-nested-conditional */
