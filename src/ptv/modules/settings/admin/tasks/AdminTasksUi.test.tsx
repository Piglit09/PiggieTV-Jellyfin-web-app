import React, { act } from 'react';
import type { TaskTriggerInfo } from '@jellyfin/sdk/lib/generated-client/models/task-trigger-info';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PtvAdminTask, PtvAdminTaskTrigger } from './adminTasksModel';

/* eslint-disable @typescript-eslint/naming-convention */

vi.mock('../../../icons/PtvIcon', () => ({
    default: ({ name }: Readonly<{ name: string }>) => <span data-icon={name} />
}));

vi.mock('../../../../../hooks/useApi', () => ({
    useApi: () => ({ __legacyApiClient__: undefined, api: undefined })
}));

vi.mock('./AdminTaskDialogs', () => ({
    AdminTaskTriggerDialog: ({ open }: Readonly<{ open: boolean }>) => open ? <div role='dialog'>Schedule editor</div> : null
}));

vi.mock('react-router-dom', async importOriginal => {
    const actual = await importOriginal<typeof import('react-router-dom')>();
    return {
        ...actual,
        unstable_usePrompt: vi.fn()
    };
});

import { AdminTaskDetail } from './AdminTaskDetail';
import { AdminTaskList, formatTaskDuration, formatTaskRelativeTime } from './AdminTaskList';
import { taskNeedsRunConfirmation } from './PtvAdminTasksPage';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const dailyTrigger: PtvAdminTaskTrigger = {
    dayOfWeek: null,
    description: 'Daily at 3:00 AM server local time',
    intervalTicks: null,
    maxRuntimeTicks: null,
    raw: { Type: 'DailyTrigger', TimeOfDayTicks: 108_000_000_000 },
    serverLocal: true,
    timeOfDayTicks: 108_000_000_000,
    type: 'daily',
    typeValue: 'DailyTrigger'
};

function task(overrides: Partial<PtvAdminTask> = {}): PtvAdminTask {
    return {
        canEditSchedule: true,
        canRun: true,
        canStop: false,
        category: 'System',
        description: 'Runs routine server maintenance.',
        hidden: false,
        id: 'task-a',
        key: 'TaskA',
        lastResult: {
            completedAt: '2026-08-12T18:02:00.000Z',
            durationMilliseconds: 120_000,
            startedAt: '2026-08-12T18:00:00.000Z',
            status: 'completed'
        },
        name: 'Routine Maintenance',
        progressPercent: null,
        source: 'unknown',
        state: 'idle',
        triggers: [ dailyTrigger ],
        triggersAvailable: true,
        ...overrides
    };
}

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
    act(() => {
        root.render(<MemoryRouter>{node}</MemoryRouter>);
    });
}

function renderDetail(taskValue: PtvAdminTask) {
    render(<AdminTaskDetail
        actionState={undefined}
        error={null}
        feedback={null}
        loading={false}
        onRefresh={vi.fn()}
        onRun={vi.fn()}
        onSaveTriggers={vi.fn(async () => true)}
        onStop={vi.fn()}
        refreshing={false}
        task={taskValue}
    />);
}

function click(element: Element | null) {
    expect(element).toBeTruthy();
    act(() => {
        (element as HTMLElement).click();
    });
}

function change(element: HTMLInputElement, value: string) {
    act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
});

describe('Tasks & Maintenance list UI', () => {
    it('groups dynamic tasks, shows authoritative progress, and exposes supported actions', () => {
        const run = vi.fn();
        const stop = vi.fn();
        render(
            <AdminTaskList
                actionStateByTask={{}}
                error={null}
                feedback={null}
                initialLoading={false}
                onRefresh={vi.fn()}
                onRun={run}
                onStop={stop}
                refreshing={false}
                tasks={[
                    task({
                        canEditSchedule: false,
                        canRun: false,
                        canStop: true,
                        id: 'running-task',
                        name: 'Detect Intro Segments',
                        progressPercent: 61,
                        state: 'running'
                    }),
                    task({ id: 'failed-task', lastResult: { ...task().lastResult, status: 'failed' }, name: 'Plugin Maintenance' }),
                    task({ id: 'available-task', name: 'Refresh Guide' })
                ]}
            />
        );

        expect(container.textContent).toContain('Tasks & Maintenance');
        expect(container.textContent).toContain('Running');
        expect(container.textContent).toContain('Needs Attention');
        expect(container.textContent).toContain('Available');
        const progress = container.querySelector('[role="progressbar"]');
        expect(progress?.getAttribute('aria-valuenow')).toBe('61');
        expect(container.querySelector('a[href="/settings/admin/tasks/running-task"]')).toBeTruthy();
        click(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Stop Task') || null);
        expect(stop).toHaveBeenCalledWith(expect.objectContaining({ id: 'running-task' }));
        expect(run).not.toHaveBeenCalled();
    });

    it('searches locally and renders a true no-match state', () => {
        render(
            <AdminTaskList
                actionStateByTask={{}}
                error={null}
                feedback={null}
                initialLoading={false}
                onRefresh={vi.fn()}
                onRun={vi.fn()}
                onStop={vi.fn()}
                refreshing={false}
                tasks={[ task({ name: 'Refresh Guide' }), task({ id: 'task-b', name: 'Clean Cache' }) ]}
            />
        );
        change(container.querySelector('input[type="search"]') as HTMLInputElement, 'missing');
        expect(container.textContent).toContain('No tasks match your filters.');
        expect(container.textContent).not.toContain('Refresh Guide');
    });

    it('keeps loading, failure, and empty states distinct', () => {
        const props = {
            actionStateByTask: {}, feedback: null, onRefresh: vi.fn(), onRun: vi.fn(), onStop: vi.fn(), refreshing: false, tasks: []
        } as const;
        render(<AdminTaskList {...props} error={null} initialLoading />);
        expect(container.querySelector('[aria-label="Loading server tasks"]')).toBeTruthy();
        render(<AdminTaskList {...props} error initialLoading={false} />);
        expect(container.textContent).toContain("Tasks couldn't be loaded.");
        render(<AdminTaskList {...props} error={null} initialLoading={false} />);
        expect(container.textContent).toContain('No maintenance tasks are available.');
    });
});

describe('task detail UI', () => {
    const baseProps = {
        actionState: undefined,
        error: null,
        feedback: null,
        loading: false,
        onRefresh: vi.fn(),
        onRun: vi.fn(),
        onSaveTriggers: vi.fn(async () => true),
        onStop: vi.fn(),
        refreshing: false
    } as const;

    it('shows execution facts, schedule, logs, and never exposes the task ID', () => {
        render(<AdminTaskDetail {...baseProps} task={task()} />);
        expect(container.textContent).toContain('Last execution');
        expect(container.textContent).toContain('Daily at 3:00 AM server local time');
        expect(container.querySelector('a[href="#/settings/admin/server/logs"]')).toBeTruthy();
        expect(container.textContent).not.toContain('task-a');
    });

    it('preserves an unknown trigger and disables its removal', () => {
        const unknown: PtvAdminTaskTrigger = {
            ...dailyTrigger,
            description: 'Unsupported schedule (PluginTrigger)',
            raw: { PluginOption: { future: true }, Type: 'PluginTrigger' } as unknown as TaskTriggerInfo & Record<string, unknown>,
            type: 'unknown',
            typeValue: 'PluginTrigger'
        };
        render(<AdminTaskDetail {...baseProps} task={task({ triggers: [ unknown ] })} />);
        expect(container.textContent).toContain('preserved without changes');
        expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Remove')).toBe(false);
    });

    it('shows schedule unavailable and safe disappeared-task states', () => {
        render(<AdminTaskDetail {...baseProps} task={task({ canEditSchedule: false, triggers: [], triggersAvailable: false })} />);
        expect(container.textContent).toContain('Schedule information is unavailable.');
        render(<AdminTaskDetail {...baseProps} task={null} />);
        expect(container.textContent).toContain('This task is no longer available.');
        expect(container.querySelector('a[href="/settings/admin/tasks"]')).toBeTruthy();
    });

    it('keeps dirty edits during a server refresh, then adopts the waiting schedule after reset', () => {
        const remoteTrigger: PtvAdminTaskTrigger = {
            ...dailyTrigger,
            description: 'When the server starts',
            raw: { Type: 'StartupTrigger' },
            serverLocal: false,
            timeOfDayTicks: null,
            type: 'startup',
            typeValue: 'StartupTrigger'
        };
        renderDetail(task());
        click(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Remove') || null);
        expect(container.textContent).toContain('No schedule is configured.');

        renderDetail(task({ triggers: [ remoteTrigger ] }));
        expect(container.textContent).toContain('No schedule is configured.');
        expect(container.textContent).not.toContain('When the server starts');

        click(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Reset Changes') || null);
        expect(container.textContent).toContain('When the server starts');
    });

    it('keeps confirmed details visible when a background refresh fails', () => {
        render(<AdminTaskDetail {...baseProps} error={new Error('offline')} task={task()} />);
        expect(container.textContent).toContain('Routine Maintenance');
        expect(container.textContent).toContain('Showing the last confirmed server response.');
        expect(container.textContent).not.toContain("Task details couldn't be loaded.");
    });
});

describe('task presentation helpers', () => {
    it('formats friendly time and duration without exposing raw values', () => {
        expect(formatTaskRelativeTime('2026-08-12T12:00:00.000Z', Date.parse('2026-08-12T14:30:00.000Z'))).toBe('2 hrs ago');
        expect(formatTaskRelativeTime(null)).toBe('Never');
        expect(formatTaskDuration(3_738_000)).toBe('1 hr 2 min');
        expect(formatTaskDuration(null)).toBe('Unavailable');
    });

    it('confirms the stable PiggieTV backup task and description-declared impactful work', () => {
        expect(taskNeedsRunConfirmation(task({ key: 'PtvAccountDataBackup' }))).toBe(true);
        expect(taskNeedsRunConfirmation(task({ description: 'Deletes stale cache records.', key: 'Other' }))).toBe(true);
        expect(taskNeedsRunConfirmation(task({ description: 'Checks for updates.', key: 'Other' }))).toBe(false);
    });
});
/* eslint-enable @typescript-eslint/naming-convention */
