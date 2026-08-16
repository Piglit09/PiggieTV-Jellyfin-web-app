import React, { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import Loading from '../../../../../components/loading/LoadingComponent';
import { decodeAdminRouteSegment } from '../adminRouteSegments';

const PtvAdminTasksPage = lazy(() => import('./PtvAdminTasksPage'));

export const ADMIN_TASKS_PATH = '/settings/admin/tasks';

function trimTrailingSlashes(pathname: string) {
    let normalized = pathname;
    while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    return normalized;
}

/** Returns the immutable task ID for a native detail route, or an empty string for the list. */
export function readAdminTaskId(pathname: string): string | null {
    const normalized = trimTrailingSlashes(pathname);
    if (normalized.toLowerCase() === ADMIN_TASKS_PATH) return '';
    if (!normalized.toLowerCase().startsWith(`${ADMIN_TASKS_PATH}/`)) return null;

    const encodedId = normalized.slice(ADMIN_TASKS_PATH.length + 1);
    return decodeAdminRouteSegment(encodedId);
}

/** Native route boundary for Tasks & Maintenance list and detail workspaces. */
export default function AdminTasksRoute() {
    const location = useLocation();
    const taskId = readAdminTaskId(location.pathname);

    useEffect(() => {
        const page = document.getElementById('ptvSettingsPage');
        if (page) page.scrollTop = 0;
    }, [ location.pathname ]);

    return (
        <Suspense fallback={<Loading />}>
            <PtvAdminTasksPage taskId={taskId} />
        </Suspense>
    );
}
