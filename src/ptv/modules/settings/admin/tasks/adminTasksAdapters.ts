import type { TaskInfo } from '@jellyfin/sdk/lib/generated-client/models/task-info';
import type { TaskTriggerInfo } from '@jellyfin/sdk/lib/generated-client/models/task-trigger-info';

import {
    AdminTasksServiceError,
    type PtvAdminTask,
    type PtvAdminTaskResultStatus,
    type PtvAdminTaskSource,
    type PtvAdminTaskState,
    type PtvAdminTaskTrigger,
    type PtvAdminTaskTriggerType
} from './adminTasksModel';
import {
    durationBetweenTimestamps,
    formatTaskInterval,
    formatTaskTimeOfDay,
    JELLYFIN_TICKS_PER_DAY,
    normalizeTicks,
    normalizeTimestamp
} from './adminTaskTime';

type RawTaskTrigger = TaskTriggerInfo & Record<string, unknown>;

function displayText(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireTaskId(value: unknown) {
    const id = displayText(value);
    if (!id) {
        throw new AdminTasksServiceError(
            'invalid-response',
            'Scheduled task information was incomplete.'
        );
    }
    return id;
}

function normalizeTaskState(value: unknown): PtvAdminTaskState {
    switch (value) {
        case 'Idle':
            return 'idle';
        case 'Running':
            return 'running';
        case 'Cancelling':
            return 'cancelling';
        default:
            return 'unknown';
    }
}

function normalizeResultStatus(value: unknown, hasResult: boolean): PtvAdminTaskResultStatus {
    if (!hasResult) return 'never-run';
    switch (value) {
        case 'Completed':
            return 'completed';
        case 'Failed':
            return 'failed';
        case 'Cancelled':
            return 'cancelled';
        case 'Aborted':
            return 'aborted';
        default:
            return 'unknown';
    }
}

function normalizeProgress(value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.min(100, Math.max(0, value));
}

function normalizeSource(category: string | null, key: string | null): PtvAdminTaskSource {
    if (category?.toLowerCase() === 'piggietv' || key?.startsWith('Ptv')) return 'ptv';
    return 'unknown';
}

function normalizeTriggerType(value: string | null): PtvAdminTaskTriggerType {
    switch (value) {
        case 'DailyTrigger':
            return 'daily';
        case 'WeeklyTrigger':
            return 'weekly';
        case 'IntervalTrigger':
            return 'interval';
        case 'StartupTrigger':
            return 'startup';
        default:
            return 'unknown';
    }
}

function triggerDescription(
    type: PtvAdminTaskTriggerType,
    dayOfWeek: string | null,
    timeOfDayTicks: number | null,
    intervalTicks: number | null,
    typeValue: string | null
) {
    switch (type) {
        case 'daily':
            return timeOfDayTicks !== null && timeOfDayTicks < JELLYFIN_TICKS_PER_DAY ?
                `Daily at ${formatTaskTimeOfDay(timeOfDayTicks)} server local time` :
                'Daily at an unavailable server-local time';
        case 'weekly':
            return timeOfDayTicks !== null && timeOfDayTicks < JELLYFIN_TICKS_PER_DAY && dayOfWeek ?
                `${dayOfWeek} at ${formatTaskTimeOfDay(timeOfDayTicks)} server local time` :
                'Weekly at an unavailable server-local time';
        case 'interval':
            return intervalTicks !== null && intervalTicks > 0 ?
                formatTaskInterval(intervalTicks) :
                'Interval schedule unavailable';
        case 'startup':
            return 'When the server starts';
        default:
            return typeValue ? `Unsupported schedule (${typeValue})` : 'Unsupported schedule';
    }
}

function cloneValue<T>(value: T): T {
    if (Array.isArray(value)) return value.map(item => cloneValue(item)) as T;
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([ key, item ]) => (
            [ key, cloneValue(item) ]
        ))) as T;
    }
    return value;
}

function comparableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(comparableValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .sort(([ left ], [ right ]) => left.localeCompare(right))
            .map(([ key, item ]) => [ key, comparableValue(item) ]));
    }
    return value;
}

export function cloneTaskTriggers(
    triggers: readonly (TaskTriggerInfo & Record<string, unknown>)[]
): RawTaskTrigger[] {
    if (!Array.isArray(triggers)) {
        throw new AdminTasksServiceError('invalid-input', 'Choose a valid task schedule.');
    }
    return triggers.map(trigger => cloneValue(trigger));
}

export function equalTaskTriggers(
    left: readonly (TaskTriggerInfo & Record<string, unknown>)[],
    right: readonly (TaskTriggerInfo & Record<string, unknown>)[]
) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return JSON.stringify(comparableValue(left)) === JSON.stringify(comparableValue(right));
}

export function normalizeAdminTaskTrigger(trigger: unknown): PtvAdminTaskTrigger {
    const raw = trigger && typeof trigger === 'object' && !Array.isArray(trigger) ?
        cloneValue(trigger as RawTaskTrigger) :
        {} as RawTaskTrigger;
    const typeValue = displayText(raw.Type);
    const type = normalizeTriggerType(typeValue);
    const dayOfWeek = displayText(raw.DayOfWeek);
    const timeOfDayTicks = normalizeTicks(raw.TimeOfDayTicks);
    const intervalTicks = normalizeTicks(raw.IntervalTicks);
    const maxRuntimeTicks = normalizeTicks(raw.MaxRuntimeTicks);

    return {
        dayOfWeek,
        description: triggerDescription(type, dayOfWeek, timeOfDayTicks, intervalTicks, typeValue),
        intervalTicks,
        maxRuntimeTicks,
        raw,
        serverLocal: type === 'daily' || type === 'weekly',
        timeOfDayTicks,
        type,
        typeValue
    };
}

export function normalizeAdminTask(raw: TaskInfo): PtvAdminTask {
    if (!raw || typeof raw !== 'object') {
        throw new AdminTasksServiceError(
            'invalid-response',
            'Scheduled task information could not be read.'
        );
    }
    const id = requireTaskId(raw.Id);
    const category = displayText(raw.Category);
    const key = displayText(raw.Key);
    const startedAt = normalizeTimestamp(raw.LastExecutionResult?.StartTimeUtc);
    const completedAt = normalizeTimestamp(raw.LastExecutionResult?.EndTimeUtc);
    const state = normalizeTaskState(raw.State);
    const authoritativeTriggers = Array.isArray(raw.Triggers) ? raw.Triggers : null;
    const triggersAvailable = authoritativeTriggers !== null;

    return {
        canEditSchedule: state === 'idle' && triggersAvailable,
        canRun: state === 'idle',
        canStop: state === 'running',
        category,
        description: displayText(raw.Description),
        hidden: raw.IsHidden === true,
        id,
        key,
        lastResult: {
            completedAt,
            durationMilliseconds: durationBetweenTimestamps(startedAt, completedAt),
            startedAt,
            status: normalizeResultStatus(
                raw.LastExecutionResult?.Status,
                Boolean(raw.LastExecutionResult)
            )
        },
        name: displayText(raw.Name) || 'Scheduled task',
        progressPercent: normalizeProgress(raw.CurrentProgressPercentage),
        source: normalizeSource(category, key),
        state,
        triggers: authoritativeTriggers ?
            authoritativeTriggers.map(normalizeAdminTaskTrigger) :
            [],
        triggersAvailable
    };
}

/** Hidden tasks are excluded defensively even when a server ignores its filter. */
export function normalizeAdminTasks(raw: readonly TaskInfo[]): PtvAdminTask[] {
    if (!Array.isArray(raw)) {
        throw new AdminTasksServiceError(
            'invalid-response',
            'Scheduled tasks could not be loaded.'
        );
    }
    return raw.filter(task => task?.IsHidden !== true).map(normalizeAdminTask);
}
