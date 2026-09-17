import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import PtvAdminLibraryDisplayPage from './PtvAdminLibraryDisplayPage';

import './adminLibraryDisplay.scss';

/** Native route boundary for the server-owned Library Display settings. */
export default function AdminLibraryDisplayRoute() {
    const location = useLocation();

    useEffect(() => {
        const page = document.getElementById('ptvSettingsPage');
        if (page) page.scrollTop = 0;
    }, [ location.pathname ]);

    return <PtvAdminLibraryDisplayPage />;
}
