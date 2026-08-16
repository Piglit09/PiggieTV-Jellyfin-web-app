import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

const LIVE_TV_ROUTE = '/settings/admin/livetv';

function readParameter(search: string, name: string) {
    const encodedName = encodeURIComponent(name);
    const match = new RegExp(`(?:^|[?&])${encodedName}=([^&]*)`, 'i').exec(search);
    if (!match?.[1]) return '';
    try {
        return decodeURIComponent(match[1].replace(/\+/g, ' ')).trim();
    } catch {
        return '';
    }
}

export function getNativeLiveTvAdminRoute(pathname: string, search = '') {
    let normalized = pathname.toLowerCase();
    while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);

    if (normalized.endsWith('/recordings')) return `${LIVE_TV_ROUTE}/dvr`;

    if (normalized.endsWith('/tuner')) {
        const id = readParameter(search, 'id');
        return id ? `${LIVE_TV_ROUTE}/tuners/${encodeURIComponent(id)}` : `${LIVE_TV_ROUTE}/tuners/new`;
    }

    if (normalized.endsWith('/guide')) {
        const id = readParameter(search, 'id');
        if (id) return `${LIVE_TV_ROUTE}/guide/${encodeURIComponent(id)}`;
        const type = readParameter(search, 'type').toLowerCase();
        if (type === 'schedulesdirect' || type === 'xmltv') {
            return `${LIVE_TV_ROUTE}/guide/new?type=${encodeURIComponent(type)}`;
        }
        return `${LIVE_TV_ROUTE}/guide`;
    }

    return LIVE_TV_ROUTE;
}

/** Replaces only the migrated Jellyfin Live TV administration family. */
export function LegacyLiveTvAdminRedirect() {
    const location = useLocation();
    return <Navigate replace to={getNativeLiveTvAdminRoute(location.pathname, location.search)} />;
}

export { LegacyLiveTvAdminRedirect as Component };
