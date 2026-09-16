import React, { lazy, Suspense, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';

import Loading from '../../../../../components/loading/LoadingComponent';
import { decodeAdminRouteSegment } from '../adminRouteSegments';
import { readAdminMetadataManagerIdentifyHandoff } from './adminMetadataManagerIdentifyHandoff';

const PtvAdminMetadataManagerPage = lazy(() => import('./PtvAdminMetadataManagerPage'));

export const ADMIN_METADATA_MANAGER_PATH = '/settings/admin/media/metadata-manager';

export function readAdminMetadataManagerItemId(pathname: string) {
    let normalized = pathname;
    while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    if (!normalized.startsWith(`${ADMIN_METADATA_MANAGER_PATH}/`)) return '';

    const encoded = normalized.slice(ADMIN_METADATA_MANAGER_PATH.length + 1);
    return decodeAdminRouteSegment(encoded) || '';
}

/** Native route boundary for item-level metadata administration. */
export default function AdminMetadataManagerRoute() {
    const location = useLocation();
    const itemId = readAdminMetadataManagerItemId(location.pathname);
    const identifyPrefill = useMemo(
        () => readAdminMetadataManagerIdentifyHandoff(location.state, itemId),
        [ itemId, location.state ]
    );

    useEffect(() => {
        const page = document.getElementById('ptvSettingsPage');
        if (page) page.scrollTop = 0;
    }, [ location.pathname ]);

    return (
        <Suspense fallback={<Loading />}>
            <PtvAdminMetadataManagerPage identifyPrefill={identifyPrefill} itemId={itemId} />
        </Suspense>
    );
}
