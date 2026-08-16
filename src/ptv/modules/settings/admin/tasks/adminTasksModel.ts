import type { TaskTriggerInfo } from '@jellyfin/sdk/lib/generated-client/models/task-trigger-info';

export type PtvAdminTaskState = 'idle' | 'running' | 'cancelling' | 'unknown';
export type PtvAdminTaskResultStatus =
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'aborted'
    | 'never-run'
    | 'unknown';
export type PtvAdminTaskSource = 'ptv' | 'unknown';
export type PtvAdminTaskTriggerType =
    | 'daily'
    | 'weekly'
    | 'interval'
    | 'startup'
    | 'unknown';

/**
 * A normalized trigger plus the complete opaque server document. PiggieTV may
 * explain known fields, but must retain unknown fields when replacing a task's
 * full trigger array.
 */
export type PtvAdminTaskTrigger = Readonly<{
    dayOfWeek: string | null;
    description: string;
    intervalTicks: number | null;
    maxRuntimeTicks: number | null;
    raw: TaskTriggerInfo & Record<string, unknown>;
    serverLocal: boolean;
    timeOfDayTicks: number | null;
    type: PtvAdminTaskTriggerType;
    typeValue: string | null;
}>;

export type PtvAdminTaskResult = Readonly<{
    completedAt: string | null;
    durationMilliseconds: number | null;
    startedAt: string | null;
    status: PtvAdminTaskResultStatus;
}>;

/** UI-facing scheduled-task projection with no raw error or authorization data. */
export type PtvAdminTask = Readonly<{
    canEditSchedule: boolean;
    canRun: boolean;
    canStop: boolean;
    category: string | null;
    description: string | null;
    hidden: boolean;
    id: string;
    key: string | null;
    lastResult: PtvAdminTaskResult;
    name: string;
    progressPercent: number | null;
    source: PtvAdminTaskSource;
    state: PtvAdminTaskState;
    triggers: readonly PtvAdminTaskTrigger[];
    /** Whether the server supplied the complete authoritative trigger array. */
    triggersAvailable: boolean;
}>;

export type AdminTasksServiceErrorCode =
    | 'conflict'
    | 'hidden-task'
    | 'invalid-input'
    | 'invalid-response'
    | 'load-unavailable'
    | 'not-found'
    | 'operation-failed'
    | 'state-changed'
    | 'update-failed';

/** A user-safe Scheduled Tasks error that never includes server response data. */
export class AdminTasksServiceError extends Error {
    public readonly code: AdminTasksServiceErrorCode;

    public constructor(code: AdminTasksServiceErrorCode, message: string) {
        super(message);
        this.code = code;
        this.name = 'AdminTasksServiceError';
    }
}
