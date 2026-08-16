import React from 'react';

import PtvIcon from '../../../icons/PtvIcon';
import type { AdminLibraryScanState } from './adminLibrariesModel';

export function AdminLibraryBadge({
    children,
    tone = 'neutral'
}: Readonly<{
    children: React.ReactNode;
    tone?: 'healthy' | 'info' | 'neutral' | 'warning';
}>) {
    return <span className='ptv-admin-library-badge' data-tone={tone}>{children}</span>;
}

export function AdminLibraryTypeIcon({
    icon,
    large = false
}: Readonly<{
    icon: React.ComponentProps<typeof PtvIcon>['name'];
    large?: boolean;
}>) {
    return (
        <span className={`ptv-admin-library-type-icon${large ? ' is-large' : ''}`}>
            <PtvIcon name={icon} size={large ? '32px' : '25px'} />
        </span>
    );
}

export function AdminLibraryScanBadge({ state }: Readonly<{ state: AdminLibraryScanState }>) {
    if (state === 'running') return <AdminLibraryBadge tone='info'>Scanning</AdminLibraryBadge>;
    if (state === 'requested') return <AdminLibraryBadge tone='info'>Scan requested</AdminLibraryBadge>;
    if (state === 'unavailable') return <AdminLibraryBadge tone='warning'>Status unavailable</AdminLibraryBadge>;
    return <AdminLibraryBadge tone='healthy'>Ready</AdminLibraryBadge>;
}

export function formatAdminLibraryFolderCount(count: number) {
    return `${count} ${count === 1 ? 'folder' : 'folders'}`;
}
