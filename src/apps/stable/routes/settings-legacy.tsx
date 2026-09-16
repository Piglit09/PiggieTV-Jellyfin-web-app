import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { getPtvLegacySettingsRedirect } from 'ptv/modules/settings/settingsModel';

export function Component() {
    const location = useLocation();
    const target = `${getPtvLegacySettingsRedirect(location.pathname)}${location.search}`;

    return <Navigate replace to={target} />;
}
