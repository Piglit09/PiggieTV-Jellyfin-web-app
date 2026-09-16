import React, { lazy, Suspense, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import Loading from '../../../../../components/loading/LoadingComponent';

import '../configuration/adminConfiguration.scss';

const PtvAdminPlaybackPage = lazy(() => import('./PtvAdminPlaybackPage'));

export const ADMIN_PLAYBACK_PATH = '/settings/admin/playback';
export const ADMIN_PLAYBACK_SECTIONS = [
    'streaming',
    'transcoding',
    'resume',
    'trickplay'
] as const;

export type AdminPlaybackSection = typeof ADMIN_PLAYBACK_SECTIONS[number];

function trimTrailingSlashes(pathname: string) {
    let normalized = pathname;
    while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    return normalized;
}

export function readAdminPlaybackSection(pathname: string): AdminPlaybackSection | null {
    const normalized = trimTrailingSlashes(pathname).toLowerCase();
    if (normalized === ADMIN_PLAYBACK_PATH) return 'streaming';
    if (!normalized.startsWith(`${ADMIN_PLAYBACK_PATH}/`)) return null;

    const section = normalized.slice(ADMIN_PLAYBACK_PATH.length + 1);
    return ADMIN_PLAYBACK_SECTIONS.find(candidate => candidate === section) || null;
}

/** Native route boundary for server-wide playback administration. */
export default function AdminPlaybackRoute() {
    const location = useLocation();
    const section = readAdminPlaybackSection(location.pathname);

    useEffect(() => {
        const page = document.getElementById('ptvSettingsPage');
        if (page) page.scrollTop = 0;
    }, [ location.pathname ]);

    if (!section) return <Navigate replace to={`${ADMIN_PLAYBACK_PATH}/streaming`} />;

    return (
        <Suspense fallback={<Loading />}>
            <PtvAdminPlaybackPage section={section} />
        </Suspense>
    );
}
