import React, { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import Loading from '../../../../../components/loading/LoadingComponent';
import { decodeAdminRouteSegment } from '../adminRouteSegments';

import './adminLibraries.scss';

const PtvAdminLibrariesPage = lazy(() => import('./PtvAdminLibrariesPage'));
const PtvAdminLibraryDetail = lazy(() => import('./PtvAdminLibraryDetail'));

const LIBRARIES_PATH = '/settings/admin/libraries';
const STATIC_LIBRARY_ROUTES = new Set([ 'display', 'metadata', 'nfo' ]);

export function readAdminLibraryId(pathname: string) {
    let normalized = pathname;
    while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    if (!normalized.startsWith(`${LIBRARIES_PATH}/`)) return '';
    const encoded = normalized.slice(LIBRARIES_PATH.length + 1);
    const libraryId = decodeAdminRouteSegment(encoded);
    return libraryId && !STATIC_LIBRARY_ROUTES.has(libraryId.toLowerCase()) ? libraryId : '';
}

export default function AdminLibrariesRoute() {
    const location = useLocation();
    const libraryId = readAdminLibraryId(location.pathname);

    useEffect(() => {
        const page = document.getElementById('ptvSettingsPage');
        if (page) page.scrollTop = 0;
    }, [location.pathname]);

    return (
        <Suspense fallback={<Loading />}>
            {libraryId ? <PtvAdminLibraryDetail libraryId={libraryId} /> : <PtvAdminLibrariesPage />}
        </Suspense>
    );
}
