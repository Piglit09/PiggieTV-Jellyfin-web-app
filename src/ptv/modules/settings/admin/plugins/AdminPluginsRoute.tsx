import React, { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import Loading from '../../../../../components/loading/LoadingComponent';
import { decodeAdminRouteSegment } from '../adminRouteSegments';

const PtvAdminPluginsPage = lazy(() => import('./PtvAdminPluginsPage'));

export const ADMIN_PLUGINS_PATH = '/settings/admin/plugins';

export type AdminPluginsRouteState =
    | Readonly<{ section: 'installed' | 'catalog' | 'repositories' }>
    | Readonly<{ pluginId: string; section: 'detail' }>
    | Readonly<{ section: 'invalid' }>;

function trimTrailingSlashes(pathname: string) {
    let normalized = pathname;
    while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    return normalized;
}

/**
 * Parses only the native Plugin Administration route family. Reserved tab
 * names are resolved before the remaining single segment is treated as an
 * immutable plugin identifier.
 */
export function readAdminPluginsRoute(pathname: string): AdminPluginsRouteState {
    const normalized = trimTrailingSlashes(pathname);
    const lowerPath = normalized.toLowerCase();

    if (lowerPath === ADMIN_PLUGINS_PATH) return { section: 'installed' };
    if (!lowerPath.startsWith(`${ADMIN_PLUGINS_PATH}/`)) return { section: 'invalid' };

    const encodedSegment = normalized.slice(ADMIN_PLUGINS_PATH.length + 1);
    if (!encodedSegment || encodedSegment.includes('/')) return { section: 'invalid' };

    const reservedSection = encodedSegment.toLowerCase();
    if (
        reservedSection === 'installed'
        || reservedSection === 'catalog'
        || reservedSection === 'repositories'
    ) {
        return { section: reservedSection };
    }

    const pluginId = decodeAdminRouteSegment(encodedSegment);
    return pluginId ? { pluginId, section: 'detail' } : { section: 'invalid' };
}

/** Administrator authorization is resolved by SettingsPage before this route mounts. */
export default function AdminPluginsRoute() {
    const location = useLocation();
    const route = readAdminPluginsRoute(location.pathname);

    useEffect(() => {
        const page = document.getElementById('ptvSettingsPage');
        if (page) page.scrollTop = 0;
    }, [ location.pathname ]);

    return (
        <Suspense fallback={<Loading />}>
            <PtvAdminPluginsPage route={route} />
        </Suspense>
    );
}
