import type { Api } from '@jellyfin/sdk';
import type { ApiClient } from 'jellyfin-apiclient';
import React from 'react';

import PtvAdminDashboard from '../admin/PtvAdminDashboard';

type AdminSettingsProps = Readonly<{
    api?: Api;
    apiClient?: ApiClient;
}>;

export default function AdminSettings({ api, apiClient }: AdminSettingsProps) {
    return <PtvAdminDashboard api={api} apiClient={apiClient} />;
}
