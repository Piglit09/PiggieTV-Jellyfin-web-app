import React, { useEffect } from 'react';

import InviteAdminPage from '../../../signup/InviteAdminPage';

export default function AdminSignupInvitesRoute() {
    useEffect(() => {
        document.getElementById('ptvSettingsPage')?.scrollTo({ top: 0 });
    }, []);

    return <InviteAdminPage />;
}
