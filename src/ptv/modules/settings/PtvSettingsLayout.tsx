import React, { type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import PtvIcon from '../icons/PtvIcon';
import PtvAdminLayout from './admin/PtvAdminLayout';
import {
    getVisiblePtvSettingsGroups,
    type PtvSettingsSectionId
} from './settingsModel';

type PtvSettingsLayoutProps = Readonly<{
    children: ReactNode;
    currentSection: PtvSettingsSectionId;
    isAdministrator: boolean;
}>;

function getSidebarLabel(label: string) {
    if (label === 'Devices & Quick Connect') return 'Devices';
    return label;
}

const ADMIN_DESTINATION_BY_SECTION: Partial<Record<PtvSettingsSectionId, string>> = {
    'admin-activity': 'activity',
    'admin-devices': 'devices',
    'admin-dvr': 'dvr',
    'admin-libraries': 'libraries',
    'admin-library-display': 'library-display',
    'admin-library-metadata': 'library-metadata',
    'admin-library-nfo': 'nfo-settings',
    'admin-live-tv': 'live-tv',
    'admin-metadata-quality': 'metadata-quality',
    'admin-metadata-manager': 'metadata-manager',
    'admin-playback': 'playback',
    'admin-piggietv': '',
    'admin-plugins': 'plugin-manager',
    'admin-server': '',
    'admin-signup-invites': 'signup-invites',
    'admin-tasks': 'scheduled-tasks',
    'admin-users': 'users',
    media: 'media-management'
};

function getAdminDestinationId(section: PtvSettingsSectionId) {
    return ADMIN_DESTINATION_BY_SECTION[section] ?? 'overview';
}

export default function PtvSettingsLayout({
    children,
    currentSection,
    isAdministrator
}: PtvSettingsLayoutProps) {
    const groups = getVisiblePtvSettingsGroups(isAdministrator);

    if (currentSection === 'hub') {
        return <main className='ptv-settings-hub'>{children}</main>;
    }

    if (
        currentSection === 'admin'
        || currentSection === 'admin-activity'
        || currentSection === 'admin-devices'
        || currentSection === 'admin-library-display'
        || currentSection === 'admin-library-metadata'
        || currentSection === 'admin-library-nfo'
        || currentSection === 'admin-libraries'
        || currentSection === 'admin-live-tv'
        || currentSection === 'admin-dvr'
        || currentSection === 'admin-metadata-quality'
        || currentSection === 'admin-metadata-manager'
        || currentSection === 'admin-playback'
        || currentSection === 'admin-piggietv'
        || currentSection === 'admin-plugins'
        || currentSection === 'admin-server'
        || currentSection === 'admin-tasks'
        || currentSection === 'admin-signup-invites'
        || currentSection === 'admin-users'
        || currentSection === 'media'
    ) {
        return (
            <PtvAdminLayout currentDestinationId={getAdminDestinationId(currentSection)}>
                {children}
            </PtvAdminLayout>
        );
    }

    return (
        <main className='ptv-settings-application'>
            <aside aria-label='Settings sections' className='ptv-settings-sidebar'>
                <Link className='ptv-settings-all-link' to='/settings'>
                    <PtvIcon name='back' size='18px' />
                    <span>All settings</span>
                </Link>

                <nav>
                    {groups.map(group => (
                        <section key={group.id}>
                            <h2>{group.label}</h2>
                            {group.items.map(item => (
                                <Link
                                    key={item.id}
                                    aria-current={item.id === currentSection ? 'page' : undefined}
                                    className='ptv-settings-sidebar-link'
                                    data-settings-section={item.id}
                                    to={item.href.slice(1)}
                                >
                                    <PtvIcon name={item.icon} size='20px' />
                                    <span>{getSidebarLabel(item.label)}</span>
                                </Link>
                            ))}
                        </section>
                    ))}
                </nav>
            </aside>

            <div className='ptv-settings-main-column'>
                <div className='ptv-settings-mobile-context'>
                    <span>Settings</span>
                    <Link to='/settings'>
                        <PtvIcon name='back' size='18px' />
                        Back
                    </Link>
                </div>
                {children}
            </div>
        </main>
    );
}
