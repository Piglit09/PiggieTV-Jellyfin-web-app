import React from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';

const PLUGINS_ROUTE = '/settings/admin/plugins';

export function getNativePluginAdminRoute(pathname: string, pluginId?: string) {
    let normalizedPath = pathname;
    while (normalizedPath.endsWith('/')) normalizedPath = normalizedPath.slice(0, -1);
    normalizedPath = normalizedPath.toLowerCase();

    if (normalizedPath.endsWith('/catalog')) return `${PLUGINS_ROUTE}/catalog`;
    if (normalizedPath.endsWith('/repositories')) return `${PLUGINS_ROUTE}/repositories`;

    const id = pluginId?.trim();
    if (id) return `${PLUGINS_ROUTE}/${encodeURIComponent(id)}`;

    return `${PLUGINS_ROUTE}/installed`;
}

/** Redirects only the migrated legacy Plugin Manager routes. */
export function LegacyPluginAdminRedirect() {
    const location = useLocation();
    const { pluginId } = useParams<{ pluginId: string }>();

    return (
        <Navigate
            replace
            to={getNativePluginAdminRoute(location.pathname, pluginId)}
        />
    );
}

export { LegacyPluginAdminRedirect as Component };
