import type { TaskTriggerInfo } from '@jellyfin/sdk/lib/generated-client/models/task-trigger-info';
import { TaskTriggerInfoType } from '@jellyfin/sdk/lib/generated-client/models/task-trigger-info-type';
import { DayOfWeek } from '@jellyfin/sdk/lib/generated-client/models/day-of-week';
import Button from '@mui/material/Button/Button';
import Dialog from '@mui/material/Dialog/Dialog';
import DialogActions from '@mui/material/DialogActions/DialogActions';
import DialogContent from '@mui/material/DialogContent/DialogContent';
import DialogTitle from '@mui/material/DialogTitle/DialogTitle';
import MenuItem from '@mui/material/MenuItem/MenuItem';
import Stack from '@mui/material/Stack/Stack';
import TextField from '@mui/material/TextField/TextField';
import React, { useCallback, useMemo, useState } from 'react';

import { getIntervalOptions, getTimeOfDayOptions } from '../../../../../apps/dashboard/features/tasks/utils/edit';
import ConfirmDialog from '../../../../../components/ConfirmDialog';
import { useLocale } from '../../../../../hooks/useLocale';

/* eslint-disable react/jsx-no-bind */

export type PendingTaskAction = Readonly<{
    action: 'run' | 'stop';
    taskId: string;
    taskName: string;
}>;

export function AdminTaskActionDialog({
    action,
    onCancel,
    onConfirm,
    open
}: Readonly<{
    action: PendingTaskAction | null;
    onCancel: () => void;
    onConfirm: () => void;
    open: boolean;
}>) {
    const stopping = action?.action === 'stop';
    const title = stopping ? 'Stop this running task?' : `Run ${action?.taskName || 'this task'} now?`;
    const text = stopping ?
        'The task may leave partial work behind. PiggieTV will ask the server to stop it without promising a rollback.' :
        'PiggieTV will ask the server to begin this maintenance task. Completion will be reported only after the server confirms it.';

    return (
        <ConfirmDialog
            className='ptv-admin-task-dialog'
            confirmButtonColor={stopping ? 'warning' : 'primary'}
            confirmButtonText={stopping ? 'Stop Task' : 'Run Now'}
            fullWidth
            maxWidth='xs'
            onCancel={onCancel}
            onConfirm={onConfirm}
            open={open}
            text={text}
            title={title}
        />
    );
}

export function AdminTaskTriggerDialog({
    onAdd,
    onClose,
    open
}: Readonly<{
    onAdd: (trigger: TaskTriggerInfo) => void;
    onClose: () => void;
    open: boolean;
}>) {
    const { dateFnsLocale } = useLocale();
    const [ triggerType, setTriggerType ] = useState<TaskTriggerInfoType>(TaskTriggerInfoType.DailyTrigger);
    const timeOfDayOptions = useMemo(() => getTimeOfDayOptions(dateFnsLocale), [ dateFnsLocale ]);
    const intervalOptions = useMemo(() => getIntervalOptions(dateFnsLocale), [ dateFnsLocale ]);

    const handleClose = useCallback(() => {
        setTriggerType(TaskTriggerInfoType.DailyTrigger);
        onClose();
    }, [ onClose ]);

    const handleSubmit = useCallback((event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const raw: TaskTriggerInfo = {
            Type: data.get('TriggerType')?.toString() as TaskTriggerInfoType
        };

        if (raw.Type === TaskTriggerInfoType.WeeklyTrigger) {
            raw.DayOfWeek = data.get('DayOfWeek')?.toString() as DayOfWeek;
        }

        if (raw.Type === TaskTriggerInfoType.DailyTrigger || raw.Type === TaskTriggerInfoType.WeeklyTrigger) {
            raw.TimeOfDayTicks = Number(data.get('TimeOfDay'));
        }

        if (raw.Type === TaskTriggerInfoType.IntervalTrigger) {
            raw.IntervalTicks = Number(data.get('Interval'));
        }

        const maxRuntimeHours = Number(data.get('MaxRuntimeHours'));
        if (Number.isFinite(maxRuntimeHours) && maxRuntimeHours > 0) {
            raw.MaxRuntimeTicks = maxRuntimeHours * 36e9;
        }

        onAdd(raw);
        handleClose();
    }, [ handleClose, onAdd ]);

    return (
        <Dialog
            className='ptv-admin-task-dialog'
            fullWidth
            maxWidth='xs'
            onClose={handleClose}
            open={open}
            slotProps={{
                paper: {
                    component: 'form',
                    onSubmit: handleSubmit
                }
            }}
        >
            <DialogTitle>Add schedule</DialogTitle>
            <DialogContent>
                <Stack spacing={2.5}>
                    <p className='ptv-admin-task-dialog-note'>Times use the server&apos;s local time.</p>
                    <TextField
                        fullWidth
                        label='Schedule type'
                        name='TriggerType'
                        onChange={event => setTriggerType(event.target.value as TaskTriggerInfoType)}
                        select
                        value={triggerType}
                    >
                        <MenuItem value={TaskTriggerInfoType.DailyTrigger}>Daily</MenuItem>
                        <MenuItem value={TaskTriggerInfoType.WeeklyTrigger}>Weekly</MenuItem>
                        <MenuItem value={TaskTriggerInfoType.IntervalTrigger}>On an interval</MenuItem>
                        <MenuItem value={TaskTriggerInfoType.StartupTrigger}>On server startup</MenuItem>
                    </TextField>
                    {triggerType === TaskTriggerInfoType.WeeklyTrigger ? (
                        <TextField defaultValue={DayOfWeek.Sunday} fullWidth label='Day' name='DayOfWeek' select>
                            {Object.values(DayOfWeek).map(day => <MenuItem key={day} value={day}>{day}</MenuItem>)}
                        </TextField>
                    ) : null}
                    {triggerType === TaskTriggerInfoType.DailyTrigger || triggerType === TaskTriggerInfoType.WeeklyTrigger ? (
                        <TextField defaultValue={0} fullWidth label='Server time' name='TimeOfDay' select>
                            {timeOfDayOptions.map(option => <MenuItem key={option.value} value={option.value}>{option.name}</MenuItem>)}
                        </TextField>
                    ) : null}
                    {triggerType === TaskTriggerInfoType.IntervalTrigger ? (
                        <TextField defaultValue={intervalOptions[0]?.value} fullWidth label='Interval' name='Interval' required select>
                            {intervalOptions.map(option => <MenuItem key={option.value} value={option.value}>{option.name}</MenuItem>)}
                        </TextField>
                    ) : null}
                    <TextField
                        fullWidth
                        label='Maximum runtime (hours)'
                        name='MaxRuntimeHours'
                        slotProps={{ htmlInput: { min: 1, step: 0.5 } }}
                        type='number'
                    />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} variant='text'>Cancel</Button>
                <Button type='submit' variant='contained'>Add Schedule</Button>
            </DialogActions>
        </Dialog>
    );
}
/* eslint-enable react/jsx-no-bind */
