import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import PtvAdminNfoPage from './PtvAdminNfoPage';

import '../configuration/adminConfiguration.scss';

/** Native route boundary for global NFO writer behavior. */
export default function AdminNfoRoute() {
    const location = useLocation();

    useEffect(() => {
        const page = document.getElementById('ptvSettingsPage');
        if (page) page.scrollTop = 0;
    }, [ location.pathname ]);

    return <PtvAdminNfoPage />;
}
