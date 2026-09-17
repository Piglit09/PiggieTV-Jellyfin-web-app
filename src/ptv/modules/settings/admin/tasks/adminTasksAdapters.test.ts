import type { TaskInfo } from '@jellyfin/sdk/lib/generated-client/models/task-info';
import type { TaskTriggerInfo } from '@jellyfin/sdk/lib/generated-client/models/task-trigger-info';
import { describe, expect, it } from 'vitest';

import {
    cloneTaskTriggers,
    equalTaskTriggers,
    normalizeAdminTask,
    normalizeAdminTasks
} from './adminTasksAdapters';
import { JELLYFIN_TICKS_PER_HOUR } from './adminTaskTime';

function task(overrides: Partial<TaskInfo> = {}): TaskInfo {
    return {
        Category: 'Maintenance',
        Description: 'Performs server maintenance.',
        Id: 'task-a',
        IsHidden: false,
        Key: 'MaintenanceTask',
        Name: 'Maintenance',
        State: 'Idle',
        Triggers: [],
        ...overrides
    };
}

describe('administrator Scheduled Tasks adapters', () => {
    it('normalizes state before action capability and keeps the prior result separate', () => {
        const normalized = normalizeAdminTask(task({
            CurrentProgressPercentage: 127.4,
            LastExecutionResult: {
                EndTimeUtc: '2026-08-12T10:05:00Z',
                StartTimeUtc: '2026-08-12T10:00:00Z',
                Status: 'Failed'
            },
            State: 'Running'
        }));

        expect(normalized).toMatchObject({
            canEditSchedule: false,
            canRun: false,
            canStop: true,
            lastResult: {
                completedAt: '2026-08-12T10:05:00.000Z',
                durationMilliseconds: 300_000,
                startedAt: '2026-08-12T10:00:00.000Z',
                status: 'failed'
            },
            progressPercent: 100,
            state: 'running'
        });
    });

    it('treats a missing result as never run and unknown state as non-actionable', () => {
        expect(normalizeAdminTask(task({ State: undefined }))).toMatchObject({
            canEditSchedule: false,
            canRun: false,
            canStop: false,
            lastResult: {
                completedAt: null,
                durationMilliseconds: null,
                startedAt: null,
                status: 'never-run'
            },
            state: 'unknown'
        });
    });

    it('does not treat a missing authoritative trigger array as an empty editable schedule', () => {
        expect(normalizeAdminTask(task({ Triggers: undefined }))).toMatchObject({
            canEditSchedule: false,
            triggers: [],
            triggersAvailable: false
        });
        expect(normalizeAdminTask(task({ Triggers: [] }))).toMatchObject({
            canEditSchedule: true,
            triggers: [],
            triggersAvailable: true
        });
    });

    it('labels only authoritative PiggieTV identifiers and leaves other plugin ownership unknown', () => {
        expect(normalizeAdminTask(task({ Category: 'PiggieTV' })).source).toBe('ptv');
        expect(normalizeAdminTask(task({ Category: 'Maintenance', Key: 'PtvBackup' })).source)
            .toBe('ptv');
        expect(normalizeAdminTask(task({ Category: 'Other Plugin', Key: 'VendorBackup' })).source)
            .toBe('unknown');
        expect(normalizeAdminTask(task({ Category: undefined, Key: undefined })).source)
            .toBe('unknown');
    });

    it('excludes hidden tasks defensively and rejects malformed inventories', () => {
        expect(normalizeAdminTasks([
            task({ Id: 'visible' }),
            task({ Id: 'hidden', IsHidden: true })
        ]).map(value => value.id)).toEqual([ 'visible' ]);
        expect(() => normalizeAdminTasks(null as unknown as TaskInfo[])).toThrowError(
            expect.objectContaining({ code: 'invalid-response' })
        );
        expect(() => normalizeAdminTask(task({ Id: ' ' }))).toThrowError(
            expect.objectContaining({ code: 'invalid-response' })
        );
    });

    it('retains only valid timestamps and non-negative durations', () => {
        expect(normalizeAdminTask(task({
            CurrentProgressPercentage: Number.NaN,
            LastExecutionResult: {
                EndTimeUtc: '2026-08-12T09:00:00Z',
                StartTimeUtc: '2026-08-12T10:00:00Z',
                Status: undefined
            }
        }))).toMatchObject({
            lastResult: {
                durationMilliseconds: null,
                status: 'unknown'
            },
            progressPercent: null
        });
        expect(normalizeAdminTask(task({
            CurrentProgressPercentage: -7,
            LastExecutionResult: {
                EndTimeUtc: 'not-a-time',
                StartTimeUtc: '',
                Status: 'Completed'
            }
        }))).toMatchObject({
            lastResult: {
                completedAt: null,
                durationMilliseconds: null,
                startedAt: null,
                status: 'completed'
            },
            progressPercent: 0
        });
    });

    it('normalizes all four trigger types with server-local daily and weekly wording', () => {
        const normalized = normalizeAdminTask(task({
            Triggers: [
                { Type: 'DailyTrigger', TimeOfDayTicks: 3 * JELLYFIN_TICKS_PER_HOUR },
                {
                    DayOfWeek: 'Tuesday',
                    TimeOfDayTicks: 15 * JELLYFIN_TICKS_PER_HOUR + 30 * 600_000_000,
                    Type: 'WeeklyTrigger'
                },
                { IntervalTicks: 90 * 600_000_000, Type: 'IntervalTrigger' },
                { Type: 'StartupTrigger' }
            ]
        }));

        expect(normalized.triggers.map(trigger => ({
            description: trigger.description,
            serverLocal: trigger.serverLocal,
            type: trigger.type
        }))).toEqual([
            {
                description: 'Daily at 3:00 AM server local time',
                serverLocal: true,
                type: 'daily'
            },
            {
                description: 'Tuesday at 3:30 PM server local time',
                serverLocal: true,
                type: 'weekly'
            },
            {
                description: 'Every 1.5 hours',
                serverLocal: false,
                type: 'interval'
            },
            {
                description: 'When the server starts',
                serverLocal: false,
                type: 'startup'
            }
        ]);
        expect(normalized.triggers.every(trigger => (
            !trigger.description.toLowerCase().includes('next')
        ))).toBe(true);
    });

    it('uses an unknown trigger fallback while preserving its full opaque document', () => {
        const vendorTrigger = {
            FutureMode: { Keep: [ 'all', 'fields' ] },
            MaxRuntimeTicks: JELLYFIN_TICKS_PER_HOUR,
            Type: 'VendorCalendarTrigger'
        };
        const normalized = normalizeAdminTask(task({
            Triggers: [ vendorTrigger as TaskTriggerInfo ]
        })).triggers[0];

        expect(normalized).toMatchObject({
            description: 'Unsupported schedule (VendorCalendarTrigger)',
            maxRuntimeTicks: JELLYFIN_TICKS_PER_HOUR,
            serverLocal: false,
            type: 'unknown',
            typeValue: 'VendorCalendarTrigger'
        });
        expect(normalized.raw).toEqual(vendorTrigger);
        expect(normalized.raw).not.toBe(vendorTrigger);
    });

    it('deep-clones opaque triggers and compares object keys without losing array order', () => {
        const original = [
            {
                Plugin: { Nested: [ 1, { Keep: true } ] },
                Type: 'StartupTrigger'
            },
            { IntervalTicks: JELLYFIN_TICKS_PER_HOUR, Type: 'IntervalTrigger' }
        ] as Array<TaskTriggerInfo & Record<string, unknown>>;
        const cloned = cloneTaskTriggers(original);

        expect(cloned).toEqual(original);
        expect(cloned).not.toBe(original);
        expect(cloned[0].Plugin).not.toBe(original[0].Plugin);
        expect(equalTaskTriggers(original, [
            { Type: 'StartupTrigger', Plugin: { Nested: [ 1, { Keep: true } ] } },
            { Type: 'IntervalTrigger', IntervalTicks: JELLYFIN_TICKS_PER_HOUR }
        ] as Array<TaskTriggerInfo & Record<string, unknown>>)).toBe(true);
        expect(equalTaskTriggers(original, [ original[1], original[0] ])).toBe(false);
    });
});
