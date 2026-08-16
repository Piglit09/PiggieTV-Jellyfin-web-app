import React from 'react';

import type { AdminDashboardSeverity } from './adminDashboardModel';

type AdminStatusBadgeProps = Readonly<{
    label: string;
    severity: AdminDashboardSeverity;
}>;

export default function AdminStatusBadge({
    label,
    severity
}: AdminStatusBadgeProps) {
    return (
        <span className='ptv-admin-status-badge' data-severity={severity}>
            <span aria-hidden='true' className='ptv-admin-status-dot' />
            <span>{label}</span>
        </span>
    );
}
