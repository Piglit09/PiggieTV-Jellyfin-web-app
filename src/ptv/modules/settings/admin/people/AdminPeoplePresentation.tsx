import React, { useCallback } from 'react';
import { Link } from 'react-router-dom';

import PtvIcon from '../../../icons/PtvIcon';
import type {
    AdminPeopleActivityEntry,
    AdminPeopleDevice,
    AdminPeopleDeviceStatus,
    AdminPeopleSession
} from './adminPeopleModel';

function parseTimestamp(value: string | null) {
    if (!value) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

export function formatAdminPeopleTime(value: string | null, now = Date.now()) {
    const timestamp = parseTimestamp(value);
    if (timestamp === null) return 'Unavailable';
    const elapsed = Math.max(0, now - timestamp);
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1) return 'Now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    const months = Math.max(1, Math.floor(days / 30.4375));
    if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
    const years = Math.max(1, Math.floor(days / 365));
    return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

export function formatAdminPeopleDate(value: string | null) {
    const timestamp = parseTimestamp(value);
    if (timestamp === null) return 'Timestamp unavailable';
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(timestamp);
}

function getDeviceTone(status: AdminPeopleDeviceStatus) {
    switch (status) {
        case 'playing':
        case 'active':
            return 'healthy';
        case 'paused':
            return 'info';
        case 'unavailable':
            return 'warning';
        default:
            return 'neutral';
    }
}

export function AdminPeopleBadge({
    children,
    tone = 'neutral'
}: Readonly<{
    children: React.ReactNode;
    tone?: 'danger' | 'healthy' | 'info' | 'neutral' | 'warning';
}>) {
    return <span className='ptv-admin-people-badge' data-tone={tone}>{children}</span>;
}

function DeviceSession({ session }: Readonly<{ session: AdminPeopleSession }>) {
    const media = [ session.mediaTitle, session.mediaSubtitle ].filter(Boolean).join(' · ');
    const client = [ session.clientName, session.clientVersion ].filter(Boolean).join(' ');
    const user = session.user?.username || 'User unavailable';
    let icon: 'activity' | 'pause' | 'play' = 'activity';
    if (session.paused) icon = 'pause';
    else if (session.playing) icon = 'play';
    const playbackTone = session.playbackMethod === 'transcoding' ? 'warning' : 'info';

    return (
        <li className='ptv-admin-device-session'>
            <span className='ptv-admin-device-session-state'>
                <PtvIcon name={icon} size='15px' />
                <strong>{session.statusLabel}</strong>
            </span>
            <span>
                <strong>{media || client || 'Connected session'}</strong>
                <small>{[ user, media ? client : null ].filter(Boolean).join(' · ')}</small>
            </span>
            {session.playing ? (
                <AdminPeopleBadge tone={playbackTone}>
                    {session.playbackMethodLabel}
                </AdminPeopleBadge>
            ) : null}
        </li>
    );
}

export function AdminDeviceRow({
    busy,
    device,
    onRemove
}: Readonly<{
    busy: boolean;
    device: AdminPeopleDevice;
    onRemove: (device: AdminPeopleDevice) => void;
}>) {
    const client = [ device.appName, device.appVersion ].filter(Boolean).join(' ');
    const userNames = device.users.map(user => user.username).filter(Boolean);
    let users = userNames.join(', ');
    if (!users) users = device.userSourceState === 'unavailable' ? 'User mapping unavailable' : 'No associated user';
    let activityLabel = 'Session count unavailable';
    if (device.activeSessionCount !== null) {
        const unit = device.activeSessionCount === 1 ? 'session' : 'sessions';
        activityLabel = `${device.activeSessionCount} active ${unit}`;
    }
    const registrationLabel = device.registryEntryCount > 1 ?
        `${device.registryEntryCount} registered access records` :
        'Recent and active users';
    const handleRemove = useCallback(() => onRemove(device), [device, onRemove]);
    let action = (
        <button aria-label={`${device.name} has no removable registration`} disabled type='button'>Session only</button>
    );
    if (device.current) {
        action = <button aria-label={`${device.name} is the current device`} disabled type='button'>Current device</button>;
    } else if (device.canRemove) {
        action = (
            <button
                aria-label={`Remove ${device.name}`}
                className='is-danger'
                disabled={busy}
                onClick={handleRemove}
                type='button'
            >
                <PtvIcon name='delete' size='16px' />
                {busy ? 'Checking…' : 'Remove'}
            </button>
        );
    }

    return (
        <article className='ptv-admin-device-row' data-device-status={device.status}>
            <div className='ptv-admin-device-main'>
                <span aria-hidden='true' className='ptv-admin-device-icon'>
                    <PtvIcon name='devices' size='25px' />
                </span>
                <span className='ptv-admin-device-identity'>
                    <strong>{device.name}</strong>
                    <small>{client || 'Client information unavailable'}</small>
                </span>
            </div>
            <span className='ptv-admin-device-users'>
                <strong>{users}</strong>
                <small>{registrationLabel}</small>
            </span>
            <span className='ptv-admin-device-activity'>
                <strong title={formatAdminPeopleDate(device.lastSeenAt)}>{formatAdminPeopleTime(device.lastSeenAt)}</strong>
                <small>{activityLabel}</small>
            </span>
            <span className='ptv-admin-device-state'>
                <AdminPeopleBadge tone={getDeviceTone(device.status)}>{device.statusLabel}</AdminPeopleBadge>
            </span>
            {action}
            {device.sessions.length > 0 ? (
                <ul aria-label={`Sessions on ${device.name}`} className='ptv-admin-device-sessions'>
                    {device.sessions.map((session, index) => (
                        <DeviceSession key={session.sessionId || `${session.deviceId}:${index}`} session={session} />
                    ))}
                </ul>
            ) : null}
        </article>
    );
}

function getSeverityTone(entry: AdminPeopleActivityEntry) {
    if (entry.severity === 'error') return 'danger';
    if (entry.severity === 'warning') return 'warning';
    if (entry.severity === 'info') return 'info';
    return 'neutral';
}

function shouldLinkItem(entry: AdminPeopleActivityEntry) {
    return Boolean(entry.itemId && (entry.category === 'playback' || entry.category === 'library'));
}

function conciseActivityDescription(value: string) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 320 ? `${normalized.slice(0, 317)}…` : normalized;
}

export function AdminActivityRow({ entry }: Readonly<{ entry: AdminPeopleActivityEntry }>) {
    let userContent: React.ReactNode = <span>Server</span>;
    if (entry.user?.isCurrentUser && entry.user.id) {
        userContent = (
            <Link to={`/settings/admin/users/${encodeURIComponent(entry.user.id)}`}>
                {entry.user.username || 'View user'}
            </Link>
        );
    } else if (entry.user) {
        userContent = <span>{entry.user.username || 'User unavailable'}</span>;
    }

    return (
        <article className='ptv-admin-activity-row'>
            <time dateTime={entry.createdAt || undefined} title={formatAdminPeopleDate(entry.createdAt)}>
                {formatAdminPeopleTime(entry.createdAt)}
            </time>
            <span aria-hidden='true' className='ptv-admin-activity-marker' data-severity={entry.severity} />
            <div className='ptv-admin-activity-copy'>
                <div className='ptv-admin-activity-title-line'>
                    <strong>{entry.name}</strong>
                    <AdminPeopleBadge tone={getSeverityTone(entry)}>{entry.severityLabel}</AdminPeopleBadge>
                    <AdminPeopleBadge>{entry.categoryLabel}</AdminPeopleBadge>
                </div>
                {entry.description ? <p title={entry.description}>{conciseActivityDescription(entry.description)}</p> : null}
                <div className='ptv-admin-activity-meta'>
                    {userContent}
                    {entry.type ? <span>{entry.type}</span> : null}
                    {shouldLinkItem(entry) ? (
                        <Link to={`/settings/admin/media/metadata-manager/${encodeURIComponent(entry.itemId!)}`}>
                            Open item
                        </Link>
                    ) : null}
                </div>
            </div>
        </article>
    );
}
