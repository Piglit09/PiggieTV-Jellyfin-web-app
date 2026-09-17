import React from 'react';
import { Link } from 'react-router-dom';

import PtvIcon from '../../../icons/PtvIcon';
import type { PtvIconName } from '../../../icons/iconRegistry';
import { ADMIN_SERVER_BASE_PATH, type AdminServerRouteState, type AdminServerSection } from './AdminServerRoute';
import AdminServerApiKeysPage from './sections/AdminServerApiKeysPage';
import AdminServerBackupsPage from './sections/AdminServerBackupsPage';
import AdminServerBrandingPage from './sections/AdminServerBrandingPage';
import AdminServerGeneralPage from './sections/AdminServerGeneralPage';
import AdminServerLogsPage from './sections/AdminServerLogsPage';
import AdminServerNetworkingPage from './sections/AdminServerNetworkingPage';

const TABS: readonly Readonly<{
    icon: PtvIconName;
    id: AdminServerSection;
    label: string;
}>[] = [
    { icon: 'general', id: 'general', label: 'General' },
    { icon: 'branding', id: 'branding', label: 'Branding' },
    { icon: 'networking', id: 'networking', label: 'Networking' },
    { icon: 'apiKeys', id: 'api-keys', label: 'API Keys' },
    { icon: 'backups', id: 'backups', label: 'Backups' },
    { icon: 'logs', id: 'logs', label: 'Logs' }
];

function ServerSection({ route }: Readonly<{ route: AdminServerRouteState }>) {
    switch (route.section) {
        case 'branding': return <AdminServerBrandingPage />;
        case 'networking': return <AdminServerNetworkingPage />;
        case 'api-keys': return <AdminServerApiKeysPage />;
        case 'backups': return <AdminServerBackupsPage />;
        case 'logs': return <AdminServerLogsPage routeFileName={route.logFileName} />;
        case 'general':
        default: return <AdminServerGeneralPage />;
    }
}

export default function PtvAdminServerPage({ route }: Readonly<{ route: AdminServerRouteState }>) {
    return (
        <section className='ptv-admin-server' data-admin-server-section={route.section}>
            <header className='ptv-admin-server-hero'>
                <div>
                    <span>Administration / Server</span>
                    <h1>Server</h1>
                    <p>Configure your PiggieTV server, security and connectivity.</p>
                </div>
                <div aria-label='Server state' className='ptv-admin-server-live-chip'>
                    <span aria-hidden='true' />
                    Live configuration
                </div>
            </header>

            <nav aria-label='Server administration sections' className='ptv-admin-server-tabs'>
                {TABS.map(tab => (
                    <Link
                        aria-current={route.section === tab.id ? 'page' : undefined}
                        key={tab.id}
                        to={`${ADMIN_SERVER_BASE_PATH}/${tab.id}`}
                    >
                        <PtvIcon name={tab.icon} size='17px' />
                        {tab.label}
                    </Link>
                ))}
            </nav>

            <ServerSection route={route} />
        </section>
    );
}
