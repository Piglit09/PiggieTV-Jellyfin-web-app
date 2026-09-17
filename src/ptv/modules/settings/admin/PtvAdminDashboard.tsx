import type { Api } from '@jellyfin/sdk';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { type ReactNode, useCallback } from 'react';
import { Link } from 'react-router-dom';

import PtvIcon from '../../icons/PtvIcon';
import AdminStatusBadge from './AdminStatusBadge';
import {
    AdminPanelSkeleton,
    AdminStatusCardSkeleton
} from './AdminDashboardSkeleton';
import {
    getPtvAdminDestination,
    getPtvAdminManagementCategories,
    type PtvAdminCategory
} from './adminNavigation';
import type {
    AdminDashboardSeverity,
    AdminDashboardSnapshot,
    AdminLibrariesSummary,
    AdminPlaybackSession,
    AdminTaskSummaryItem
} from './adminDashboardModel';
import {
    type AdminDashboardSourceStates,
    useAdminDashboard
} from './useAdminDashboard';
import { usePtvAdminNavigationContext } from './adminNavigationContext';
import AdminMetadataQualityOverviewCard from './metadataQuality/AdminMetadataQualityOverviewCard';

type PtvAdminDashboardProps = Readonly<{
    api?: Api;
    apiClient?: ApiClient;
}>;

type DashboardTimestamp = string | number | null;

function resolveTimestamp(value: DashboardTimestamp) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Date.parse(value);
    return Number.NaN;
}

function formatRelativeTime(value: DashboardTimestamp) {
    const timestamp = resolveTimestamp(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;

    const elapsedMs = Date.now() - timestamp;
    if (elapsedMs < 45_000) return 'just now';

    const minutes = Math.round(elapsedMs / 60_000);
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;

    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatAbsoluteTime(value: DashboardTimestamp) {
    const timestamp = resolveTimestamp(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return undefined;
    return new Date(timestamp).toLocaleString();
}

function formatLibraryBreakdown(breakdown: AdminLibrariesSummary['breakdown']) {
    if (!breakdown) return null;

    const parts = [
        breakdown.movies ? `${breakdown.movies} Movies` : '',
        breakdown.shows ? `${breakdown.shows} Shows` : '',
        breakdown.music ? `${breakdown.music} Music` : '',
        breakdown.books ? `${breakdown.books} Reading` : '',
        breakdown.mixed ? `${breakdown.mixed} Mixed` : '',
        breakdown.other ? `${breakdown.other} Other` : ''
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(' \u00b7 ') : null;
}

function RetryButton({
    label,
    onRetry
}: Readonly<{
    label: string;
    onRetry: () => void;
}>) {
    return (
        <button className='ptv-admin-retry' onClick={onRetry} type='button'>
            Retry {label}
        </button>
    );
}

function StatusCard({
    action,
    children,
    icon,
    severity,
    status,
    title
}: Readonly<{
    action?: ReactNode;
    children: ReactNode;
    icon: string;
    severity: AdminDashboardSeverity;
    status: string;
    title: string;
}>) {
    return (
        <article className='ptv-admin-status-card ptv-glass-card'>
            <header className='ptv-admin-status-card-header'>
                <span className='ptv-admin-status-card-icon'>
                    <PtvIcon name={icon} size='23px' />
                </span>
                <div className='ptv-admin-status-card-title'>
                    <h2>{title}</h2>
                    <AdminStatusBadge label={status} severity={severity} />
                </div>
            </header>
            {children}
            {action}
        </article>
    );
}

function playbackDetail(session: AdminPlaybackSession) {
    const parts = [
        session.resolution,
        session.bitrateMbps ? `${session.bitrateMbps} Mbps` : null
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(' \u00b7 ') : null;
}

function playbackProgressLabel(session: AdminPlaybackSession) {
    if (session.progressPercent === null) return 'Progress unavailable';
    if (session.remainingMinutes !== null) {
        return `${session.progressPercent}% \u00b7 ${session.remainingMinutes} min remaining`;
    }
    return `${session.progressPercent}%`;
}

function ActiveSessionRow({ session }: Readonly<{ session: AdminPlaybackSession }>) {
    const methodDetail = playbackDetail(session);

    return (
        <li className='ptv-admin-active-row'>
            <div className='ptv-admin-active-device'>
                <PtvIcon name='devices' size='20px' />
                <div>
                    <strong>{session.deviceName}</strong>
                    {session.clientName && <small>{session.clientName}</small>}
                </div>
            </div>
            <div className='ptv-admin-active-user'>
                <PtvIcon name='user' size='18px' />
                <strong>{session.userName || 'User unavailable'}</strong>
            </div>
            <div className='ptv-admin-active-media'>
                <strong>{session.mediaTitle}</strong>
                {session.mediaSubtitle && <small>{session.mediaSubtitle}</small>}
            </div>
            <div>
                <span className='ptv-admin-playback-method' data-method={session.method}>
                    {session.methodLabel}
                </span>
                {methodDetail && <small>{methodDetail}</small>}
            </div>
            <div className='ptv-admin-active-progress'>
                <small>{playbackProgressLabel(session)}</small>
                {session.progressPercent !== null && (
                    <progress aria-label={`${session.mediaTitle} playback progress`} max='100' value={session.progressPercent} />
                )}
            </div>
            <div className='ptv-admin-active-status'>
                <PtvIcon name={session.paused ? 'pause' : 'play'} size='17px' />
                <span>{session.statusLabel}</span>
            </div>
        </li>
    );
}

function taskTime(task: AdminTaskSummaryItem) {
    if (task.state === 'running' || task.state === 'cancelling') {
        return 'Running now';
    }

    const completed = formatRelativeTime(task.completedAt);
    return completed ? `Last run ${completed}` : 'No previous run';
}

function TaskRow({ task }: Readonly<{ task: AdminTaskSummaryItem }>) {
    return (
        <li className='ptv-admin-task-row'>
            <span>
                <strong>{task.name}</strong>
                {(task.state === 'running' || task.state === 'cancelling') && task.progressPercent !== null && (
                    <progress
                        aria-label={`${task.name} progress`}
                        className='ptv-admin-task-progress'
                        max='100'
                        value={task.progressPercent}
                    />
                )}
            </span>
            <time dateTime={task.completedAt || task.startedAt || undefined} title={formatAbsoluteTime(task.completedAt || task.startedAt)}>
                {taskTime(task)}
            </time>
            <AdminStatusBadge label={task.statusLabel} severity={task.severity} />
        </li>
    );
}

function AdminCategoryLink({ category }: Readonly<{ category: PtvAdminCategory }>) {
    const content = (
        <>
            <PtvIcon name={category.icon} size='22px' />
            <span className='ptv-admin-management-copy'>
                <strong>{category.label}</strong>
                <small>{category.description}</small>
            </span>
            <PtvIcon name='right' size='15px' />
        </>
    );
    let directDestination = category.id === 'playback' ? getPtvAdminDestination('playback') : undefined;
    if (category.id === 'plugins') directDestination = getPtvAdminDestination('plugin-manager');
    const href = directDestination?.href
        || (category.id === 'overview' ? '/settings/admin' : `/settings/admin?section=${category.id}`);
    return <Link className='ptv-admin-management-link' to={href}>{content}</Link>;
}

function getOverallIcon(severity: AdminDashboardSeverity) {
    if (severity === 'healthy') return 'check';
    if (severity === 'unknown') return 'info';
    return 'alerts';
}

function formatItemCount(count: number) {
    return `${count} ${count === 1 ? 'item' : 'items'}`;
}

function DashboardHeader({
    isRefreshing,
    lastUpdatedAt,
    onRefresh
}: Readonly<{
    isRefreshing: boolean;
    lastUpdatedAt: number;
    onRefresh: () => Promise<void>;
}>) {
    const refreshedAt = formatRelativeTime(lastUpdatedAt);

    return (
        <header className='ptv-admin-dashboard-header'>
            <div>
                <h1>PiggieTV Administration</h1>
                <p>Monitor and manage your PiggieTV server.</p>
                {refreshedAt && (
                    <span className='ptv-admin-refresh-note'>Updated {refreshedAt}</span>
                )}
            </div>
            <button
                aria-busy={isRefreshing}
                aria-label='Refresh administration dashboard'
                className='ptv-button ptv-button-ghost ptv-admin-refresh-button'
                disabled={isRefreshing}
                onClick={onRefresh}
                type='button'
            >
                <PtvIcon name='refresh' size='18px' />
                <span>{isRefreshing ? 'Refreshing' : 'Refresh'}</span>
            </button>
        </header>
    );
}

function OverallStatus({
    loading,
    snapshot
}: Readonly<{
    loading: boolean;
    snapshot: AdminDashboardSnapshot;
}>) {
    const severity = loading ? 'unknown' : snapshot.overall.severity;
    const label = loading ? 'Checking system health' : snapshot.overall.statusLabel;

    return (
        <div
            aria-live='polite'
            className='ptv-admin-overall-status'
            data-severity={severity}
            role='status'
        >
            <span className='ptv-admin-overall-icon'>
                <PtvIcon name={getOverallIcon(severity)} size='16px' />
            </span>
            <span>{label}</span>
        </div>
    );
}

type SystemOverviewProps = Readonly<{
    onRetryLibraries: () => void;
    onRetryPlayback: () => void;
    onRetryPtv: () => void;
    onRetryServer: () => void;
    snapshot: AdminDashboardSnapshot;
    sourceStates: AdminDashboardSourceStates;
}>;

function SystemOverview({
    onRetryLibraries,
    onRetryPlayback,
    onRetryPtv,
    onRetryServer,
    snapshot,
    sourceStates
}: SystemOverviewProps) {
    const pluginDestination = getPtvAdminDestination('piggietv-configuration');
    const librariesDestination = getPtvAdminDestination('libraries');

    return (
        <section aria-label='System overview' className='ptv-admin-status-grid'>
            {sourceStates.server.loading ? (
                <AdminStatusCardSkeleton label='server status' />
            ) : (
                <StatusCard
                    action={sourceStates.server.error ? <RetryButton label='server' onRetry={onRetryServer} /> : undefined}
                    icon='server'
                    severity={snapshot.server.severity}
                    status={snapshot.server.statusLabel}
                    title='Server'
                >
                    <dl className='ptv-admin-status-card-details'>
                        {snapshot.server.name && <div><dt>Name</dt><dd>{snapshot.server.name}</dd></div>}
                        {snapshot.server.version && <div><dt>Version</dt><dd>{snapshot.server.version}</dd></div>}
                        {snapshot.server.operatingSystem && <div><dt>System</dt><dd>{snapshot.server.operatingSystem}</dd></div>}
                    </dl>
                </StatusCard>
            )}

            {sourceStates.ptv.loading ? (
                <AdminStatusCardSkeleton label='PTV plugin status' />
            ) : (
                <StatusCard
                    action={sourceStates.ptv.error ? (
                        <RetryButton label='plugin' onRetry={onRetryPtv} />
                    ) : (
                        <Link className='ptv-admin-card-action' to={pluginDestination?.href || '/settings/admin'}>
                            Plugin workspace <PtvIcon name='right' size='14px' />
                        </Link>
                    )}
                    icon='plugins'
                    severity={snapshot.ptv.severity}
                    status={snapshot.ptv.statusLabel}
                    title='PTV Plugin'
                >
                    <dl className='ptv-admin-status-card-details'>
                        <div><dt>PTV Web</dt><dd>{snapshot.ptv.ptvWebVersion}</dd></div>
                        {snapshot.ptv.pluginVersion && <div><dt>Plugin</dt><dd>{snapshot.ptv.pluginVersion}</dd></div>}
                        {snapshot.ptv.featuredContent.sectionCount !== null && (
                            <div><dt>Featured</dt><dd>{snapshot.ptv.featuredContent.sectionCount} sections</dd></div>
                        )}
                        {snapshot.ptv.featuredContent.itemCount !== null && (
                            <div><dt>Items</dt><dd>{snapshot.ptv.featuredContent.itemCount}</dd></div>
                        )}
                        {snapshot.ptv.featuredContent.updatedAt && (
                            <div>
                                <dt>Cache</dt>
                                <dd title={formatAbsoluteTime(snapshot.ptv.featuredContent.updatedAt)}>
                                    {formatRelativeTime(snapshot.ptv.featuredContent.updatedAt) || 'Available'}
                                </dd>
                            </div>
                        )}
                    </dl>
                </StatusCard>
            )}

            {sourceStates.libraries.loading ? (
                <AdminStatusCardSkeleton label='library status' />
            ) : (
                <StatusCard
                    action={sourceStates.libraries.error ? (
                        <RetryButton label='libraries' onRetry={onRetryLibraries} />
                    ) : (
                        <Link className='ptv-admin-card-action' to={librariesDestination?.href || '/settings/admin'}>
                            Manage libraries <PtvIcon name='right' size='14px' />
                        </Link>
                    )}
                    icon='libraries'
                    severity={snapshot.libraries.severity}
                    status={snapshot.libraries.statusLabel}
                    title='Libraries'
                >
                    {snapshot.libraries.count !== null && (
                        <div className='ptv-admin-card-metric'>
                            <strong>{snapshot.libraries.count}</strong>
                            <span>{formatLibraryBreakdown(snapshot.libraries.breakdown) || 'Configured libraries'}</span>
                        </div>
                    )}
                </StatusCard>
            )}

            {sourceStates.playback.loading ? (
                <AdminStatusCardSkeleton label='active streams' />
            ) : (
                <StatusCard
                    action={sourceStates.playback.error ? <RetryButton label='streams' onRetry={onRetryPlayback} /> : undefined}
                    icon='streaming'
                    severity={snapshot.playback.severity}
                    status={snapshot.playback.statusLabel}
                    title='Active Streams'
                >
                    {snapshot.playback.activeStreamCount !== null && (
                        <>
                            <div className='ptv-admin-card-metric'>
                                <strong>{snapshot.playback.activeStreamCount}</strong>
                                <span>{snapshot.playback.activeStreamCount === 1 ? 'Active stream' : 'Active streams'}</span>
                            </div>
                            <div className='ptv-admin-stream-breakdown'>
                                <div><i /><span>Direct Play</span><strong>{snapshot.playback.directPlayCount}</strong></div>
                                <div><i /><span>Direct Stream</span><strong>{snapshot.playback.directStreamCount}</strong></div>
                                <div><i /><span>Transcoding</span><strong>{snapshot.playback.transcodeCount}</strong></div>
                            </div>
                        </>
                    )}
                </StatusCard>
            )}
        </section>
    );
}

function ActiveNowPanel({
    loading,
    onRetry,
    snapshot,
    sourceError
}: Readonly<{
    loading: boolean;
    onRetry: () => void;
    snapshot: AdminDashboardSnapshot;
    sourceError: boolean;
}>) {
    if (loading) return <AdminPanelSkeleton label='active sessions' />;

    let body: ReactNode;
    if (sourceError) {
        body = (
            <div className='ptv-admin-empty-state'>
                <div>
                    <strong>Playback activity is unavailable.</strong>
                    <RetryButton label='sessions' onRetry={onRetry} />
                </div>
            </div>
        );
    } else if (snapshot.playback.sessions.length === 0) {
        body = (
            <div className='ptv-admin-empty-state'>
                <div>
                    <strong>No one is streaming right now.</strong>
                    <p>Active and paused playback sessions will appear here.</p>
                </div>
            </div>
        );
    } else {
        body = (
            <ul aria-label='Currently playing sessions' className='ptv-admin-active-list'>
                {snapshot.playback.sessions.map(session => (
                    <ActiveSessionRow
                        key={`${session.deviceName}-${session.userName}-${session.mediaTitle}-${session.mediaSubtitle}-${session.method}`}
                        session={session}
                    />
                ))}
            </ul>
        );
    }

    return (
        <section className='ptv-admin-panel ptv-glass-card'>
            <header className='ptv-admin-panel-header'>
                <div className='ptv-admin-panel-heading'>
                    <PtvIcon name='activity' size='21px' />
                    <h2>Active Now</h2>
                </div>
                {snapshot.playback.activeStreamCount !== null && (
                    <span className='ptv-admin-panel-summary'>
                        {snapshot.playback.activeStreamCount} {snapshot.playback.activeStreamCount === 1 ? 'stream' : 'streams'}
                    </span>
                )}
            </header>
            {body}
        </section>
    );
}

function ScheduledTasksPanel({
    loading,
    onRetry,
    snapshot,
    sourceError
}: Readonly<{
    loading: boolean;
    onRetry: () => void;
    snapshot: AdminDashboardSnapshot;
    sourceError: boolean;
}>) {
    const tasksDestination = getPtvAdminDestination('scheduled-tasks');

    if (loading) return <AdminPanelSkeleton label='scheduled tasks' />;

    let body: ReactNode;
    if (sourceError) {
        body = (
            <div className='ptv-admin-empty-state'>
                <div>
                    <strong>Task status is unavailable.</strong>
                    <RetryButton label='tasks' onRetry={onRetry} />
                </div>
            </div>
        );
    } else if (snapshot.tasks.recent.length === 0) {
        body = (
            <div className='ptv-admin-empty-state'>
                <div>
                    <strong>No task issues to report.</strong>
                    <p>Running and recent priority tasks will appear here.</p>
                </div>
            </div>
        );
    } else {
        body = (
            <ul className='ptv-admin-task-list'>
                {snapshot.tasks.recent.slice(0, 3).map(task => (
                    <TaskRow key={`${task.name}-${task.startedAt}-${task.completedAt}-${task.state}`} task={task} />
                ))}
            </ul>
        );
    }

    return (
        <section className='ptv-admin-panel ptv-glass-card'>
            <header className='ptv-admin-panel-header'>
                <div className='ptv-admin-panel-heading'>
                    <PtvIcon name='tasks' size='21px' />
                    <h2>Scheduled Tasks</h2>
                </div>
                <div className='ptv-admin-panel-summary'>
                    {snapshot.tasks.runningCount !== null && <span>{snapshot.tasks.runningCount} running</span>}
                    {snapshot.tasks.failedRecentlyCount !== null && <span>{snapshot.tasks.failedRecentlyCount} failed</span>}
                </div>
            </header>
            {body}
            <div className='ptv-admin-task-footer'>
                <Link className='ptv-admin-panel-action' to={tasksDestination?.href || '/settings/admin'}>
                    View Tasks <PtvIcon name='right' size='14px' />
                </Link>
            </div>
        </section>
    );
}

function AttentionPanel({
    loading,
    snapshot,
    sourceStates
}: Readonly<{
    loading: boolean;
    snapshot: AdminDashboardSnapshot;
    sourceStates: AdminDashboardSourceStates;
}>) {
    const warnings = snapshot.warnings.filter(warning => !sourceStates[warning.source].loading);
    let body: ReactNode;

    if (loading) {
        body = <div className='ptv-admin-empty-state'><div><strong>Checking system health...</strong></div></div>;
    } else if (warnings.length === 0) {
        body = (
            <div className='ptv-admin-empty-state'>
                <div>
                    <strong>No issues right now.</strong>
                    <p>All available dashboard signals are healthy.</p>
                </div>
            </div>
        );
    } else {
        body = (
            <ul className='ptv-admin-warning-list'>
                {warnings.map(warning => (
                    <li className='ptv-admin-warning-item' data-severity={warning.severity} key={warning.code}>
                        <PtvIcon name={warning.severity === 'error' ? 'alerts' : 'info'} size='19px' />
                        <div>
                            <strong>{warning.title}</strong>
                            <p>{warning.message}</p>
                        </div>
                    </li>
                ))}
            </ul>
        );
    }

    return (
        <section className='ptv-admin-panel ptv-glass-card'>
            <header className='ptv-admin-panel-header'>
                <div className='ptv-admin-panel-heading'>
                    <PtvIcon name='alerts' size='21px' />
                    <h2>Attention</h2>
                </div>
                <span className='ptv-admin-panel-summary'>
                    {loading ? 'Checking' : formatItemCount(warnings.length)}
                </span>
            </header>
            {body}
        </section>
    );
}

function ManagementSection({ categories }: Readonly<{ categories: readonly PtvAdminCategory[] }>) {
    return (
        <section className='ptv-admin-management'>
            <h2>Management</h2>
            <div className='ptv-admin-management-grid'>
                {categories.map(category => (
                    <AdminCategoryLink category={category} key={category.id} />
                ))}
            </div>
        </section>
    );
}

export default function PtvAdminDashboard({
    api,
    apiClient
}: PtvAdminDashboardProps) {
    const dashboard = useAdminDashboard(api, apiClient);
    const adminNavigation = usePtvAdminNavigationContext();
    const { snapshot, sourceStates } = dashboard;
    const managementCategories = adminNavigation?.groups
        .map(group => group.category)
        .filter(category => category.id !== 'overview') || getPtvAdminManagementCategories();
    const retrySource = dashboard.retrySource;
    const overallIsLoading = Object.values(sourceStates).some(source => source.loading);
    const handleRetryServer = useCallback(() => {
        retrySource('server').catch(() => undefined);
    }, [retrySource]);
    const handleRetryPtv = useCallback(() => {
        retrySource('ptv').catch(() => undefined);
    }, [retrySource]);
    const handleRetryLibraries = useCallback(() => {
        retrySource('libraries').catch(() => undefined);
    }, [retrySource]);
    const handleRetryPlayback = useCallback(() => {
        retrySource('playback').catch(() => undefined);
    }, [retrySource]);
    const handleRetryTasks = useCallback(() => {
        retrySource('tasks').catch(() => undefined);
    }, [retrySource]);

    return (
        <div className='ptv-admin-dashboard'>
            <DashboardHeader
                isRefreshing={dashboard.isRefreshing}
                lastUpdatedAt={dashboard.lastUpdatedAt}
                onRefresh={dashboard.refresh}
            />
            <OverallStatus loading={overallIsLoading} snapshot={snapshot} />
            <SystemOverview
                onRetryLibraries={handleRetryLibraries}
                onRetryPlayback={handleRetryPlayback}
                onRetryPtv={handleRetryPtv}
                onRetryServer={handleRetryServer}
                snapshot={snapshot}
                sourceStates={sourceStates}
            />
            <ActiveNowPanel
                loading={sourceStates.playback.loading}
                onRetry={handleRetryPlayback}
                snapshot={snapshot}
                sourceError={sourceStates.playback.error}
            />

            <div className='ptv-admin-system-grid'>
                <ScheduledTasksPanel
                    loading={sourceStates.tasks.loading}
                    onRetry={handleRetryTasks}
                    snapshot={snapshot}
                    sourceError={sourceStates.tasks.error}
                />
                <AttentionPanel loading={overallIsLoading} snapshot={snapshot} sourceStates={sourceStates} />
            </div>
            <AdminMetadataQualityOverviewCard apiClient={apiClient} />
            <ManagementSection categories={managementCategories} />
        </div>
    );
}
