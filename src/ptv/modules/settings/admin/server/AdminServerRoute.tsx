import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import PtvAdminServerPage from './PtvAdminServerPage';
import { decodeAdminRouteSegment } from '../adminRouteSegments';

import '../configuration/adminConfiguration.scss';
import './adminServer.scss';

export const ADMIN_SERVER_BASE_PATH = '/settings/admin/server';
export type AdminServerSection = 'api-keys' | 'backups' | 'branding' | 'general' | 'logs' | 'networking';

export type AdminServerRouteState = Readonly<{
    logFileName: string | null;
    section: AdminServerSection;
}>;

const SECTIONS: readonly AdminServerSection[] = [
    'general',
    'branding',
    'networking',
    'api-keys',
    'backups',
    'logs'
];

export function readAdminServerRoute(pathname: string): AdminServerRouteState | null {
    const normalized = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    if (normalized.toLowerCase() === ADMIN_SERVER_BASE_PATH) {
        return { logFileName: null, section: 'general' };
    }
    const prefix = `${ADMIN_SERVER_BASE_PATH}/`;
    if (!normalized.toLowerCase().startsWith(prefix)) return null;
    const relative = normalized.slice(prefix.length);
    const [ rawSection, ...remaining ] = relative.split('/');
    const section = rawSection.toLowerCase() as AdminServerSection;
    if (!SECTIONS.includes(section)) return null;
    if (section !== 'logs') {
        return remaining.length ? null : { logFileName: null, section };
    }
    if (!remaining.length) return { logFileName: null, section };
    if (remaining.length !== 1) return null;
    const decoded = decodeAdminRouteSegment(remaining[0]);
    return decoded ? { logFileName: decoded, section } : null;
}

/** Native route boundary for PiggieTV Server Administration. */
export default function AdminServerRoute() {
    const location = useLocation();
    const route = readAdminServerRoute(location.pathname);

    useEffect(() => {
        document.getElementById('ptvSettingsPage')?.scrollTo({ top: 0 });
    }, [ location.pathname ]);

    const normalizedPath = location.pathname.endsWith('/') ? location.pathname.slice(0, -1) : location.pathname;
    if (!route || normalizedPath.toLowerCase() === ADMIN_SERVER_BASE_PATH) {
        return <Navigate replace to={`${ADMIN_SERVER_BASE_PATH}/general`} />;
    }
    return <PtvAdminServerPage route={route} />;
}
