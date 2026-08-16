import React, { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import Loading from '../../../../../components/loading/LoadingComponent';

import './adminPeople.scss';

const PtvAdminActivityPage = lazy(() => import('./PtvAdminActivityPage'));
const PtvAdminDevicesPage = lazy(() => import('./PtvAdminDevicesPage'));

export type AdminPeopleSection = 'activity' | 'devices';

/**
 * Native People route boundary. SettingsPage verifies administrator access
 * before this boundary mounts either data-owning workspace.
 */
export default function AdminPeopleRoute({
    section
}: Readonly<{ section: AdminPeopleSection }>) {
    const location = useLocation();

    useEffect(() => {
        const page = document.getElementById('ptvSettingsPage');
        if (page) page.scrollTop = 0;
    }, [ location.pathname ]);

    return (
        <Suspense fallback={<Loading />}>
            {section === 'devices' ? <PtvAdminDevicesPage /> : <PtvAdminActivityPage />}
        </Suspense>
    );
}
