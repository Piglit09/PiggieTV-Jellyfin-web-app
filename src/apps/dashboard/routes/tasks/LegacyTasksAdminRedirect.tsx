import React from 'react';
import { Navigate, useParams } from 'react-router-dom';

const TASKS_ROUTE = '/settings/admin/tasks';

/** Redirects only the migrated legacy Scheduled Tasks list route. */
export function LegacyTasksRedirect() {
    return <Navigate replace to={TASKS_ROUTE} />;
}

/** Preserves a legacy Scheduled Task identity while opening its native detail route. */
export function LegacyTaskDetailRedirect() {
    const { id } = useParams<{ id: string }>();
    const taskId = id?.trim();

    return (
        <Navigate
            replace
            to={taskId ? `${TASKS_ROUTE}/${encodeURIComponent(taskId)}` : TASKS_ROUTE}
        />
    );
}
