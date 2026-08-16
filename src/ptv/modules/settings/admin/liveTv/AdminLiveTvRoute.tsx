import React, { lazy, Suspense, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import Loading from '../../../../../components/loading/LoadingComponent';
import { decodeAdminRouteSegment } from '../adminRouteSegments';

import '../configuration/adminConfiguration.scss';
import './adminLiveTv.scss';

const PtvAdminLiveTvPage = lazy(() => import('./PtvAdminLiveTvPage'));

export const ADMIN_LIVE_TV_PATH = '/settings/admin/livetv';
export const ADMIN_LIVE_TV_DVR_PATH = `${ADMIN_LIVE_TV_PATH}/dvr`;

export type AdminLiveTvRouteState =
    | Readonly<{ kind: 'overview' | 'tuners' | 'guide' | 'dvr' }>
    | Readonly<{ kind: 'tuner'; tunerId: string | null }>
    | Readonly<{ kind: 'provider'; providerId: string | null; providerType: 'schedules-direct' | 'xmltv' | null }>;

function trimTrailingSlashes(pathname: string) {
    let normalized = pathname;
    while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    return normalized;
}

function decodeSegment(value: string) {
    try {
        return decodeURIComponent(value);
    } catch {
        return '';
    }
}

function readProviderType(search: string) {
    const encoded = /(?:^|[?&])type=([^&]*)/i.exec(search)?.[1];
    const type = encoded ? decodeSegment(encoded.replace(/\+/g, ' ')).toLowerCase() : '';
    if (type === 'schedulesdirect' || type === 'schedules-direct') return 'schedules-direct' as const;
    if (type === 'xmltv') return 'xmltv' as const;
    return null;
}

export function readAdminLiveTvRoute(pathname: string, search = ''): AdminLiveTvRouteState | null {
    const normalized = trimTrailingSlashes(pathname).toLowerCase();
    if (normalized === ADMIN_LIVE_TV_PATH) return { kind: 'overview' };
    if (normalized === `${ADMIN_LIVE_TV_PATH}/tuners`) return { kind: 'tuners' };
    if (normalized === `${ADMIN_LIVE_TV_PATH}/tuners/new`) return { kind: 'tuner', tunerId: null };
    if (normalized.startsWith(`${ADMIN_LIVE_TV_PATH}/tuners/`)) {
        const tunerId = decodeAdminRouteSegment(
            trimTrailingSlashes(pathname).slice(`${ADMIN_LIVE_TV_PATH}/tuners/`.length)
        );
        return tunerId ? { kind: 'tuner', tunerId } : null;
    }
    if (normalized === `${ADMIN_LIVE_TV_PATH}/guide`) return { kind: 'guide' };
    if (normalized === `${ADMIN_LIVE_TV_PATH}/guide/new`) {
        return { kind: 'provider', providerId: null, providerType: readProviderType(search) };
    }
    if (normalized.startsWith(`${ADMIN_LIVE_TV_PATH}/guide/`)) {
        const providerId = decodeAdminRouteSegment(
            trimTrailingSlashes(pathname).slice(`${ADMIN_LIVE_TV_PATH}/guide/`.length)
        );
        return providerId ? { kind: 'provider', providerId, providerType: null } : null;
    }
    if (normalized === ADMIN_LIVE_TV_DVR_PATH || normalized === `${ADMIN_LIVE_TV_PATH}/recordings`) {
        return { kind: 'dvr' };
    }
    return null;
}

export default function AdminLiveTvRoute() {
    const location = useLocation();
    const route = readAdminLiveTvRoute(location.pathname, location.search);

    useEffect(() => {
        const page = document.getElementById('ptvSettingsPage');
        if (page) page.scrollTop = 0;
    }, [ location.pathname ]);

    if (!route) return <Navigate replace to={ADMIN_LIVE_TV_PATH} />;

    return (
        <Suspense fallback={<Loading />}>
            <PtvAdminLiveTvPage route={route} />
        </Suspense>
    );
}
