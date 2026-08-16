import React, { useEffect, useState } from 'react';

import type { AdminUserEmailStatus } from './adminUsersModel';

/* eslint-disable react/jsx-no-bind */

export function formatAdminUserTime(value: string | null, now = Date.now()) {
    if (!value) return 'Never';
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return 'Unavailable';
    const elapsed = Math.max(0, now - timestamp);
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1) return 'Now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    if (days < 365) {
        const months = Math.max(1, Math.floor(days / 30.4375));
        return `${months} ${months === 1 ? 'month' : 'months'} ago`;
    }
    const years = Math.max(1, Math.floor(days / 365));
    return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

export function getAdminUserEmailPresentation(status: AdminUserEmailStatus) {
    switch (status) {
        case 'verified':
            return { label: 'Verified', tone: 'healthy' as const };
        case 'pending':
            return { label: 'Pending verification', tone: 'warning' as const };
        case 'expired':
            return { label: 'Verification expired', tone: 'warning' as const };
        case 'failed':
            return { label: 'Verification failed', tone: 'danger' as const };
        case 'reverification_required':
            return { label: 'Reverification required', tone: 'warning' as const };
        case 'missing':
            return { label: 'No email', tone: 'neutral' as const };
        case 'unavailable':
        default:
            return { label: 'Unavailable', tone: 'neutral' as const };
    }
}

export function AdminUserBadge({
    children,
    tone = 'neutral'
}: Readonly<{
    children: React.ReactNode;
    tone?: 'healthy' | 'warning' | 'danger' | 'info' | 'neutral';
}>) {
    return <span className='ptv-admin-user-badge' data-tone={tone}>{children}</span>;
}

export function AdminUserAvatar({
    avatarUrl,
    large = false,
    username
}: Readonly<{
    avatarUrl: string | null;
    large?: boolean;
    username: string;
}>) {
    const [ failed, setFailed ] = useState(false);
    useEffect(() => setFailed(false), [avatarUrl]);
    const initials = username.trim().slice(0, 2).toLocaleUpperCase() || 'PT';

    return (
        <span aria-label={`${username} avatar`} className={`ptv-admin-user-avatar${large ? ' is-large' : ''}`}>
            <span aria-hidden='true'>{initials}</span>
            {avatarUrl && !failed ? (
                <img alt='' onError={() => setFailed(true)} src={avatarUrl} />
            ) : null}
        </span>
    );
}

/* eslint-enable react/jsx-no-bind */
