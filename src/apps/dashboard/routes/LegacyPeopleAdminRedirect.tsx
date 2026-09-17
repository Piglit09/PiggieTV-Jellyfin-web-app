import React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

const DEVICES_ROUTE = '/settings/admin/devices';
const ACTIVITY_ROUTE = '/settings/admin/activity';

export function getNativeActivityRoute(searchParams: URLSearchParams) {
    const legacyViews = searchParams.getAll('useractivity');

    if (legacyViews.length !== 1) return ACTIVITY_ROUTE;
    if (legacyViews[0] === 'true') return `${ACTIVITY_ROUTE}?view=user`;
    if (legacyViews[0] === 'false') return `${ACTIVITY_ROUTE}?view=system`;

    return ACTIVITY_ROUTE;
}

/** Redirects only the migrated server-wide Devices route. */
export function LegacyDevicesRedirect() {
    return <Navigate replace to={DEVICES_ROUTE} />;
}

/** Translates the legacy activity scope while dropping unsupported query parameters. */
export function LegacyActivityRedirect() {
    const [ searchParams ] = useSearchParams();

    return <Navigate replace to={getNativeActivityRoute(searchParams)} />;
}
