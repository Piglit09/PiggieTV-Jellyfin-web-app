import React, { lazy, Suspense, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import Loading from '../../../../../components/loading/LoadingComponent';

import './adminPiggietv.scss';

const PiggieTvConfigurationPage = lazy(() => import('../../../dashboard/PiggieTvDashboardPage'));
const PiggieTvRowsPage = lazy(() => import('../../../dashboard/PiggieTvRowsPage'));
const PtvDiagnosticsPage = lazy(() => import('../../../dashboard/PtvDiagnosticsDashboardPage'));

export const ADMIN_PIGGIETV_PATH = '/settings/admin/piggietv';
export const ADMIN_PIGGIETV_SECTIONS = [
    'configuration',
    'rows',
    'diagnostics'
] as const;

export type AdminPiggietvSection = typeof ADMIN_PIGGIETV_SECTIONS[number];

function trimTrailingSlashes(pathname: string) {
    let normalized = pathname;
    while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    return normalized;
}

export function readAdminPiggietvSection(pathname: string): AdminPiggietvSection | null {
    const normalized = trimTrailingSlashes(pathname).toLowerCase();
    if (normalized === ADMIN_PIGGIETV_PATH) return 'configuration';
    if (!normalized.startsWith(`${ADMIN_PIGGIETV_PATH}/`)) return null;

    const section = normalized.slice(ADMIN_PIGGIETV_PATH.length + 1);
    if (section === 'rows' || section === 'diagnostics') return section;
    return null;
}

/** Native Settings route boundary for first-party PiggieTV administration. */
export default function AdminPiggietvRoute() {
    const location = useLocation();
    const section = readAdminPiggietvSection(location.pathname);

    useEffect(() => {
        const page = document.getElementById('ptvSettingsPage');
        if (page) page.scrollTop = 0;
    }, [ location.pathname ]);

    if (!section) return <Navigate replace to={ADMIN_PIGGIETV_PATH} />;

    return (
        <Suspense fallback={<Loading />}>
            {section === 'configuration' ? <PiggieTvConfigurationPage /> : null}
            {section === 'rows' ? <PiggieTvRowsPage /> : null}
            {section === 'diagnostics' ? <PtvDiagnosticsPage /> : null}
        </Suspense>
    );
}
