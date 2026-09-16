import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

const SERVER_ROUTE = '/settings/admin/server';

function decodeSegment(value: string) {
    try {
        return decodeURIComponent(value);
    } catch {
        return '';
    }
}

export function getNativeServerAdminRoute(pathname: string) {
    let normalized = pathname;
    while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    const lowered = normalized.toLowerCase();

    const logPrefix = '/dashboard/logs/';
    if (lowered.startsWith(logPrefix)) {
        const filename = decodeSegment(normalized.slice(logPrefix.length));
        return filename ? `${SERVER_ROUTE}/logs/${encodeURIComponent(filename)}` : `${SERVER_ROUTE}/logs`;
    }
    if (lowered.endsWith('/branding')) return `${SERVER_ROUTE}/branding`;
    if (lowered.endsWith('/networking')) return `${SERVER_ROUTE}/networking`;
    if (lowered.endsWith('/keys')) return `${SERVER_ROUTE}/api-keys`;
    if (lowered.endsWith('/backups')) return `${SERVER_ROUTE}/backups`;
    if (lowered.endsWith('/logs')) return `${SERVER_ROUTE}/logs`;
    return `${SERVER_ROUTE}/general`;
}

/** Replaces only the migrated first-party Jellyfin server administration family. */
export function LegacyServerAdminRedirect() {
    const location = useLocation();
    return <Navigate replace to={getNativeServerAdminRoute(location.pathname)} />;
}

export { LegacyServerAdminRedirect as Component };
