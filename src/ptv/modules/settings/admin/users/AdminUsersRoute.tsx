import React, { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';

import Loading from '../../../../../components/loading/LoadingComponent';
import { decodeAdminRouteSegment } from '../adminRouteSegments';

import './adminUsers.scss';

const PtvAdminUserDetail = lazy(() => import('./PtvAdminUserDetail'));
const PtvAdminUsersPage = lazy(() => import('./PtvAdminUsersPage'));

const USERS_PATH = '/settings/admin/users';

export function readAdminUserId(pathname: string) {
    let normalized = pathname;
    while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    if (!normalized.startsWith(`${USERS_PATH}/`)) return '';
    const encoded = normalized.slice(USERS_PATH.length + 1);
    return decodeAdminRouteSegment(encoded) || '';
}

/**
 * Route boundary for the native PiggieTV Users workspace.
 *
 * The user-management implementation composes beneath this boundary so
 * SettingsPage can enforce administrator authorization before it mounts.
 */
export default function AdminUsersRoute() {
    const location = useLocation();
    const userId = readAdminUserId(location.pathname);

    return (
        <Suspense fallback={<Loading />}>
            {userId ? <PtvAdminUserDetail userId={userId} /> : <PtvAdminUsersPage />}
        </Suspense>
    );
}
