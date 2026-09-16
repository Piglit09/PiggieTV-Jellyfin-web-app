import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import PtvAdminMetadataPage from './PtvAdminMetadataPage';

import '../configuration/adminConfiguration.scss';

/** Native route boundary for server-wide metadata defaults. */
export default function AdminMetadataRoute() {
    const location = useLocation();

    useEffect(() => {
        const page = document.getElementById('ptvSettingsPage');
        if (page) page.scrollTop = 0;
    }, [ location.pathname ]);

    return <PtvAdminMetadataPage />;
}
