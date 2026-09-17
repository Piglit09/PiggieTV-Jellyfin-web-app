import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';

import PtvIcon from '../../../icons/PtvIcon';
import { ADMIN_METADATA_QUALITY_PATH, readAdminMetadataQualityRoute } from './adminMetadataQualityRouting';
import PtvAdminMetadataQualityPage from './PtvAdminMetadataQualityPage';

import './adminMetadataQuality.scss';

function InvalidMetadataQualityRoute() {
    return (
        <section className='ptv-metadata-quality ptv-metadata-quality-invalid' role='alert'>
            <PtvIcon name='alerts' size='32px' />
            <h1>This review result is unavailable.</h1>
            <p>The link is invalid or no longer points to a Metadata Quality result.</p>
            <Link to={ADMIN_METADATA_QUALITY_PATH}>Back to Metadata Quality</Link>
        </section>
    );
}

/** Administrator authorization is resolved by SettingsPage before this route mounts. */
export default function AdminMetadataQualityRoute() {
    const location = useLocation();
    const route = readAdminMetadataQualityRoute(location.pathname);

    useEffect(() => {
        const page = document.getElementById('ptvSettingsPage');
        if (page) page.scrollTop = 0;
    }, [ location.pathname ]);

    if (route.section === 'invalid') return <InvalidMetadataQualityRoute />;

    return <PtvAdminMetadataQualityPage itemId={route.section === 'detail' ? route.itemId : ''} />;
}
