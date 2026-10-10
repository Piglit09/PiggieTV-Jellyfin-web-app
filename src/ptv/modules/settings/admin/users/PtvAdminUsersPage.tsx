import React, { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { useApi } from '../../../../../hooks/useApi';
import PtvIcon from '../../../icons/PtvIcon';
import { selectAdminUsers } from './adminUsersAdapters';
import type { AdminUserFilter, AdminUserSort, AdminUserSummary } from './adminUsersModel';
import {
    AdminUserAvatar,
    AdminUserBadge,
    formatAdminUserTime,
    getAdminUserEmailPresentation
} from './AdminUserPresentation';
import { useAdminUsers } from './useAdminUsers';
import PtvAdminUserVerification from './PtvAdminUserVerification';
import PtvAdminCreationRecovery from './PtvAdminCreationRecovery';

const AddAdminUserDialog = lazy(async () => {
    const module = await import('./AdminUserDialogs');
    return { default: module.AddAdminUserDialog };
});

/* eslint-disable react/jsx-no-bind, no-void, no-nested-ternary, sonarjs/no-nested-conditional */

const FILTERS: ReadonlyArray<{ id: AdminUserFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'administrators', label: 'Administrators' },
    { id: 'members', label: 'Members' },
    { id: 'disabled', label: 'Disabled' }
];

function getActivityLabel(user: AdminUserSummary) {
    if (user.sessionSourceState === 'unavailable') return formatAdminUserTime(user.lastActivityAt);
    return user.activeSessionCount > 0 ? 'Now' : formatAdminUserTime(user.lastActivityAt);
}

function getSessionLabel(user: AdminUserSummary) {
    if (user.sessionSourceState === 'unavailable') return 'Session activity unavailable';
    if (user.activeSessionCount === 0) return 'No active session';
    return `${user.activeSessionCount} active ${user.activeSessionCount === 1 ? 'session' : 'sessions'}`;
}

function UserRow({ user }: Readonly<{ user: AdminUserSummary }>) {
    const email = user.email || user.maskedEmail;
    const emailPresentation = getAdminUserEmailPresentation(user.emailStatus);
    const authorizationUnavailable = user.authorizationState === 'unavailable';
    const activityLabel = getActivityLabel(user);
    const sessionLabel = getSessionLabel(user);
    const roleLabel = authorizationUnavailable ? 'Role unavailable' : user.isAdministrator ? 'Administrator' : 'Member';
    const roleTone = authorizationUnavailable ? 'warning' : user.isAdministrator ? 'info' : 'neutral';
    const statusLabel = authorizationUnavailable ? 'Status unavailable' : user.enabled ? 'Active' : 'Disabled';
    const statusTone = authorizationUnavailable ? 'warning' : user.enabled ? 'healthy' : 'danger';

    return (
        <article className='ptv-admin-user-row' data-user-state={user.accountStatus}>
            <div className='ptv-admin-user-identity'>
                <AdminUserAvatar avatarUrl={user.avatarUrl} username={user.username} />
                <span className='ptv-admin-user-copy'>
                    <strong>{user.username}</strong>
                    <small>{sessionLabel}</small>
                </span>
            </div>
            <span className='ptv-admin-user-email'>
                <strong>{email || (user.emailStatus === 'unavailable' ? 'Unavailable' : 'No email')}</strong>
                <small>{emailPresentation.label}</small>
            </span>
            <span className='ptv-admin-user-badges'>
                <AdminUserBadge tone={roleTone}>{roleLabel}</AdminUserBadge>
                <AdminUserBadge tone={statusTone}>{statusLabel}</AdminUserBadge>
            </span>
            <span className='ptv-admin-user-activity'>
                <strong>{activityLabel}</strong>
                <small>Last active</small>
            </span>
            <Link
                aria-label={`View ${user.username}`}
                className='ptv-admin-user-button'
                to={`/settings/admin/users/${encodeURIComponent(user.id)}`}
            >
                View
            </Link>
        </article>
    );
}

function UserListSkeleton() {
    return (
        <div aria-label='Loading users' className='ptv-admin-users-list' role='status'>
            {Array.from({ length: 6 }, (_, index) => (
                <div className='ptv-admin-user-row is-skeleton' key={index}>
                    <div className='ptv-admin-user-identity'>
                        <span className='ptv-admin-user-avatar' />
                        <span className='ptv-admin-user-copy'>
                            <span className='ptv-admin-user-skeleton-block' />
                            <span className='ptv-admin-user-skeleton-block' />
                        </span>
                    </div>
                    <span className='ptv-admin-user-skeleton-block' />
                    <span className='ptv-admin-user-skeleton-block' />
                    <span className='ptv-admin-user-skeleton-block' />
                    <span className='ptv-admin-user-skeleton-block' />
                </div>
            ))}
        </div>
    );
}

export default function PtvAdminUsersPage() {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const navigate = useNavigate();
    const [ searchParams, setSearchParams ] = useSearchParams();
    const usersState = useAdminUsers(api, apiClient);
    const [ query, setQuery ] = useState('');
    const [ filter, setFilter ] = useState<AdminUserFilter>('all');
    const [ sort, setSort ] = useState<AdminUserSort>('username');
    const addOpen = searchParams.get('action') === 'add';
    const visibleUsers = useMemo(() => selectAdminUsers(usersState.users, {
        filter,
        query,
        sort
    }), [filter, query, sort, usersState.users]);
    const openAdd = useCallback(() => setSearchParams({ action: 'add' }), [setSearchParams]);
    const closeAdd = useCallback(() => setSearchParams({}, { replace: true }), [setSearchParams]);
    const handleCreated = useCallback((userId: string) => {
        closeAdd();
        void usersState.refresh();
        navigate(`/settings/admin/users/${encodeURIComponent(userId)}`);
    }, [closeAdd, navigate, usersState]);

    return (
        <section className='ptv-admin-users' data-testid='ptv-admin-users-list'>
            <header className='ptv-admin-users-header'>
                <div>
                    <h1>Users</h1>
                    <p>Manage PiggieTV accounts, access and permissions.</p>
                </div>
                <div className='ptv-admin-users-header-actions'>
                    <Link className='ptv-admin-user-button' to='/settings/admin/users/signup-invites'>Create Invite</Link>
                    <button className='is-primary' onClick={openAdd} type='button'>
                        <PtvIcon name='users' size='17px' />
                        Add User
                    </button>
                </div>
            </header>

            <PtvAdminUserVerification api={api} users={usersState.users} />
            <PtvAdminCreationRecovery api={api} apiClient={apiClient} users={usersState.users} />

            <div className='ptv-admin-users-toolbar'>
                <label className='ptv-admin-user-search' htmlFor='ptv-admin-user-search'>
                    <PtvIcon name='search' size='18px' />
                    <input
                        aria-label='Search users'
                        id='ptv-admin-user-search'
                        onChange={event => setQuery(event.currentTarget.value)}
                        placeholder='Search users…'
                        type='search'
                        value={query}
                    />
                </label>
                <div className='ptv-admin-users-toolbar-actions'>
                    <div aria-label='Filter users' className='ptv-admin-user-filter-group' role='group'>
                        {FILTERS.map(option => (
                            <button
                                aria-pressed={filter === option.id}
                                className='ptv-admin-user-filter'
                                key={option.id}
                                onClick={() => setFilter(option.id)}
                                type='button'
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    <label className='ptv-admin-user-sort'>
                        Sort
                        <select onChange={event => setSort(event.currentTarget.value as AdminUserSort)} value={sort}>
                            <option value='username'>Username</option>
                            <option value='last-activity'>Last Active</option>
                            <option value='role'>Role</option>
                        </select>
                    </label>
                </div>
                <span aria-live='polite' className='ptv-admin-users-count'>
                    {visibleUsers.length} {visibleUsers.length === 1 ? 'user' : 'users'}
                </span>
            </div>

            {usersState.profileError && !usersState.coreError && (
                <aside className='ptv-admin-users-notice' role='status'>
                    <PtvIcon name='alerts' size='21px' />
                    <div>
                        <strong>PTV profile details are unavailable</strong>
                        <p>Core Jellyfin accounts remain available. Email status will return after the PTV profile service responds.</p>
                    </div>
                    <button onClick={() => void usersState.refresh()} type='button'>Retry</button>
                </aside>
            )}
            {usersState.sessionsError && !usersState.coreError && (
                <aside className='ptv-admin-users-notice' role='status'>
                    <PtvIcon name='activity' size='21px' />
                    <div>
                        <strong>Session activity is unavailable</strong>
                        <p>User accounts remain fully manageable.</p>
                    </div>
                </aside>
            )}

            {usersState.isInitialLoading ? <UserListSkeleton /> : usersState.coreError ? (
                <div className='ptv-admin-users-error' role='alert'>
                    <PtvIcon name='alerts' size='30px' />
                    <h2>We couldn&apos;t load users.</h2>
                    <p>Administration navigation is still available while you retry.</p>
                    <button onClick={() => void usersState.refresh()} type='button'>Retry users</button>
                </div>
            ) : visibleUsers.length > 0 ? (
                <div className='ptv-admin-users-list'>
                    {visibleUsers.map(user => <UserRow key={user.id} user={user} />)}
                </div>
            ) : (
                <div className='ptv-admin-users-empty'>
                    <PtvIcon name='users' size='30px' />
                    <h2>{query ? `No users match “${query}”.` : 'No users found.'}</h2>
                    <p>{query || filter !== 'all' ? 'Try a different search or filter.' : 'Create a user or invite someone to join PiggieTV.'}</p>
                </div>
            )}

            {addOpen && (
                <Suspense fallback={null}>
                    <AddAdminUserDialog
                        api={api}
                        apiClient={apiClient}
                        onClose={closeAdd}
                        onCreated={handleCreated}
                        open
                    />
                </Suspense>
            )}
        </section>
    );
}

/* eslint-enable react/jsx-no-bind, no-void, no-nested-ternary, sonarjs/no-nested-conditional */
