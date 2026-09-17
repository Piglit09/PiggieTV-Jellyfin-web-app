import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import ConfirmDialog from '../../../../../components/ConfirmDialog';
import { useApi } from '../../../../../hooks/useApi';
import PtvIcon from '../../../icons/PtvIcon';
import { useAdminUnsavedChanges } from '../configuration/useAdminUnsavedChanges';
import {
    getAdminUserActionGuard,
    getAdminUserIdentityKey
} from './adminUsersAdapters';
import type { AdminUserDangerousAction } from './adminUsersModel';
import {
    AdminUsersServiceError,
    type AdminUserLibraryAccessBaseline,
    type AdminUserPlaybackPolicyField,
    type AdminUserPlaybackPolicyValues,
    captureAdminUserLibraryAccess,
    captureAdminUserPlaybackPolicy,
    deleteAdminUser,
    resetAdminUserPassword,
    setAdminUserAdministrator,
    setAdminUserEnabled,
    updateAdminUserLibraryAccessFromBaseline,
    updateAdminUserPlaybackPolicyFromBaseline,
    updateAdminUsername
} from './adminUsersService';
import { AdminUserPasswordDialog } from './AdminUserDialogs';
import {
    AdminUserAvatar,
    AdminUserBadge,
    formatAdminUserTime,
    getAdminUserEmailPresentation
} from './AdminUserPresentation';
import { useAdminUser, useAdminUsers } from './useAdminUsers';

/* eslint-disable react/jsx-no-bind, jsx-a11y/label-has-associated-control, no-void, no-nested-ternary, sonarjs/no-nested-conditional, sonarjs/cognitive-complexity, sonarjs/no-alphabetical-sort, @stylistic/max-statements-per-line, compat/compat */

type ConfirmAction = 'promote' | 'demote' | 'disable' | 'enable' | 'delete' | 'reset-password';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function friendlyError(error: unknown, fallback: string) {
    if (error instanceof AdminUsersServiceError) return error.message;
    const status = (error as { response?: { status?: number }; status?: number })?.response?.status
        || (error as { status?: number })?.status;
    if (status === 409) return 'That username is already in use.';
    return fallback;
}

function FieldSaveState({ state, message }: Readonly<{ message: string; state: SaveState }>) {
    if (state === 'idle') return null;
    let text = message;
    if (state === 'saving') text = 'Saving…';
    if (state === 'saved') text = 'Saved';
    return <p aria-live='polite' className={`ptv-admin-user-status-message${state === 'error' ? ' is-error' : state === 'saved' ? ' is-success' : ''}`}>{text}</p>;
}

function confirmationCopy(action: ConfirmAction, username: string) {
    switch (action) {
        case 'promote':
            return {
                button: 'Make administrator',
                text: 'Administrators can manage users, libraries, playback, plugins and server settings.',
                title: `Make ${username} an administrator?`
            };
        case 'demote':
            return {
                button: 'Remove access',
                text: 'This account will no longer be able to administer the PiggieTV server.',
                title: `Remove administrator access from ${username}?`
            };
        case 'disable':
            return {
                button: 'Disable account',
                text: 'They will no longer be able to sign in. The account itself will remain.',
                title: `Disable ${username}?`
            };
        case 'enable':
            return {
                button: 'Enable account',
                text: 'This account will be able to sign in again.',
                title: `Enable ${username}?`
            };
        case 'delete':
            return {
                button: 'Delete user',
                text: 'This permanently removes the Jellyfin user account. This action cannot be undone from PiggieTV.',
                title: `Delete ${username}?`
            };
        case 'reset-password':
            return {
                button: 'Remove password',
                text: 'The current password will be removed. Set a new password afterward if this account should remain protected.',
                title: `Remove ${username}'s password?`
            };
    }
}

function getDangerousAction(action: ConfirmAction): AdminUserDangerousAction | null {
    if (action === 'delete') return 'delete';
    if (action === 'disable') return 'disable';
    if (action === 'demote') return 'demote';
    return null;
}

export default function PtvAdminUserDetail({ userId }: Readonly<{ userId: string }>) {
    const { __legacyApiClient__: apiClient, api, user: currentUser } = useApi();
    const navigate = useNavigate();
    const location = useLocation();
    const state = useAdminUser(api, apiClient, userId);
    const usersState = useAdminUsers(api, apiClient);
    const detail = state.detail;
    const hydratedId = useRef('');
    const libraryHydratedId = useRef('');
    const playbackHydratedId = useRef('');
    const mutationBusyRef = useRef(false);
    const [ username, setUsername ] = useState('');
    const [ usernameState, setUsernameState ] = useState<SaveState>('idle');
    const [ allLibraries, setAllLibraries ] = useState(true);
    const [ selectedFolderIds, setSelectedFolderIds ] = useState<string[]>([]);
    const [ libraryBaseline, setLibraryBaseline ] = useState<AdminUserLibraryAccessBaseline | null>(null);
    const [ libraryState, setLibraryState ] = useState<SaveState>('idle');
    const [ playback, setPlayback ] = useState<AdminUserPlaybackPolicyValues | null>(null);
    const [ playbackBaseline, setPlaybackBaseline ] = useState<AdminUserPlaybackPolicyValues | null>(null);
    const [ playbackState, setPlaybackState ] = useState<SaveState>('idle');
    const [ passwordOpen, setPasswordOpen ] = useState(false);
    const [ confirmAction, setConfirmAction ] = useState<ConfirmAction | null>(null);
    const [ actionBusy, setActionBusy ] = useState(false);
    const [ policyBusy, setPolicyBusy ] = useState(false);
    const [ actionMessage, setActionMessage ] = useState('');

    useEffect(() => {
        if (!detail) return;
        if (hydratedId.current !== detail.id) {
            hydratedId.current = detail.id;
            libraryHydratedId.current = '';
            playbackHydratedId.current = '';
            setUsername(detail.username);
        }
        if (playbackHydratedId.current === detail.id) return;
        const openingPlayback = captureAdminUserPlaybackPolicy(state.coreUser?.Policy);
        if (!openingPlayback) return;
        playbackHydratedId.current = detail.id;
        setPlayback({ ...openingPlayback });
        setPlaybackBaseline(openingPlayback);
    }, [detail, state.coreUser?.Policy]);

    useEffect(() => {
        if (!detail || state.libraryAccess.mode === 'unavailable'
            || libraryHydratedId.current === detail.id) return;
        const openingLibraryAccess = captureAdminUserLibraryAccess(state.coreUser?.Policy);
        setLibraryBaseline(openingLibraryAccess);
        if (!openingLibraryAccess) return;
        libraryHydratedId.current = detail.id;
        setAllLibraries(openingLibraryAccess.enableAllFolders);
        setSelectedFolderIds([ ...openingLibraryAccess.enabledFolderIds ]);
    }, [detail, state.coreUser?.Policy, state.libraryAccess.mode]);

    useEffect(() => {
        const panel = new URLSearchParams(location.search).get('panel');
        if (!panel) return;
        const target = document.getElementById(`ptv-admin-user-${panel}`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [location.search, detail?.id]);

    const libraryDirty = useMemo(() => {
        if (!libraryBaseline || state.libraryAccess.mode === 'unavailable') return false;
        if (allLibraries !== libraryBaseline.enableAllFolders) return true;
        if (allLibraries) return false;
        const current = [ ...selectedFolderIds ].sort().join('|');
        const original = [ ...libraryBaseline.enabledFolderIds ].sort().join('|');
        return current !== original;
    }, [allLibraries, libraryBaseline, selectedFolderIds, state.libraryAccess.mode]);
    const usernameDirty = Boolean(detail && username.trim() !== detail.username);
    const playbackDirty = Boolean(playback && playbackBaseline
        && Object.entries(playback).some(([ key, value ]) => (
            value !== playbackBaseline[key as AdminUserPlaybackPolicyField]
        )));
    const dirty = usernameDirty || libraryDirty || playbackDirty;

    useAdminUnsavedChanges(
        dirty,
        'You have unsaved user changes. Leave without saving them?',
        dirty && !actionBusy && !policyBusy && usernameState !== 'saving'
    );

    const setPlaybackValue = useCallback((key: AdminUserPlaybackPolicyField, value: boolean) => {
        setPlayback(current => current ? { ...current, [key]: value } : current);
        setPlaybackState('idle');
    }, []);
    const toggleFolder = useCallback((folderId: string) => {
        setSelectedFolderIds(current => current.includes(folderId) ?
            current.filter(id => id !== folderId) :
            [ ...current, folderId ]);
        setLibraryState('idle');
    }, []);
    const saveUsername = useCallback(async () => {
        if (!api || !detail || !username.trim() || usernameState === 'saving' || mutationBusyRef.current) return;
        mutationBusyRef.current = true;
        setUsernameState('saving');
        try {
            await updateAdminUsername(api, detail.id, username.trim());
            await state.invalidate();
            setUsernameState('saved');
        } catch (error) {
            setUsernameState('error');
            setActionMessage(friendlyError(error, `We couldn't rename ${detail.username}.`));
        } finally {
            mutationBusyRef.current = false;
        }
    }, [api, detail, state, username, usernameState]);
    const saveLibraries = useCallback(async () => {
        if (!api || !detail || !libraryBaseline || state.libraryAccess.mode === 'unavailable'
            || libraryState === 'saving' || policyBusy || mutationBusyRef.current) return;
        mutationBusyRef.current = true;
        setPolicyBusy(true);
        setLibraryState('saving');
        try {
            await state.cancelPolicyQueries();
            const saved = await updateAdminUserLibraryAccessFromBaseline(
                api,
                detail.id,
                libraryBaseline,
                allLibraries ?
                    { mode: 'all' } :
                    { mode: 'selected', selectedFolderIds }
            );
            state.adoptPolicy(saved.policy);
            setLibraryBaseline(saved.confirmedBaseline);
            setAllLibraries(saved.confirmedBaseline.enableAllFolders);
            setSelectedFolderIds([ ...saved.confirmedBaseline.enabledFolderIds ]);
            setLibraryState('saved');
        } catch (error) {
            setLibraryState('error');
            setActionMessage(friendlyError(error, `We couldn't save ${detail.username}'s library access.`));
        } finally {
            mutationBusyRef.current = false;
            setPolicyBusy(false);
        }
    }, [allLibraries, api, detail, libraryBaseline, libraryState, policyBusy, selectedFolderIds, state]);
    const savePlayback = useCallback(async () => {
        if (!api || !detail || !playback || !playbackBaseline || !detail.policyAvailable
            || playbackState === 'saving' || policyBusy || mutationBusyRef.current) return;
        mutationBusyRef.current = true;
        setPolicyBusy(true);
        setPlaybackState('saving');
        try {
            await state.cancelPolicyQueries();
            const saved = await updateAdminUserPlaybackPolicyFromBaseline(
                api,
                detail.id,
                playbackBaseline,
                playback
            );
            state.adoptPolicy(saved.policy);
            setPlaybackBaseline(saved.confirmedBaseline);
            setPlayback({ ...saved.confirmedBaseline });
            setPlaybackState('saved');
        } catch (error) {
            setPlaybackState('error');
            setActionMessage(friendlyError(error, `We couldn't save ${detail.username}'s playback access.`));
        } finally {
            mutationBusyRef.current = false;
            setPolicyBusy(false);
        }
    }, [api, detail, playback, playbackBaseline, playbackState, policyBusy, state]);

    const guardFor = useCallback((action: AdminUserDangerousAction) => detail ?
        getAdminUserActionGuard(action, detail, currentUser?.Id, usersState.coreError ? null : usersState.users) :
        { allowed: false, code: 'state-unavailable' as const, reason: 'Administrator account state could not be verified.' },
    [currentUser?.Id, detail, usersState.coreError, usersState.users]);
    const requestAction = useCallback((action: ConfirmAction) => {
        const dangerous = getDangerousAction(action);
        if (dangerous) {
            const guard = guardFor(dangerous);
            if (!guard.allowed) {
                setActionMessage(guard.reason || 'This action is unavailable.');
                return;
            }
        }
        setActionMessage('');
        setConfirmAction(action);
    }, [guardFor]);
    const performConfirmedAction = useCallback(async () => {
        if (!api || !detail || !confirmAction || actionBusy || policyBusy || mutationBusyRef.current) return;
        mutationBusyRef.current = true;
        const dangerous = getDangerousAction(confirmAction);
        setActionBusy(true);
        if (confirmAction !== 'reset-password') setPolicyBusy(true);
        setActionMessage('');
        try {
            if (dangerous) {
                const fresh = await usersState.refresh();
                const freshTarget = fresh?.find(user => (
                    getAdminUserIdentityKey(user.id) === getAdminUserIdentityKey(detail.id)
                ));
                const guard = freshTarget ? getAdminUserActionGuard(
                    dangerous,
                    freshTarget,
                    currentUser?.Id,
                    fresh
                ) : {
                    allowed: false,
                    reason: 'Administrator account state could not be verified.'
                };
                if (!guard.allowed) {
                    setActionMessage(guard.reason || 'This action is unavailable.');
                    setConfirmAction(null);
                    return;
                }
            }
            if (confirmAction === 'delete') {
                await deleteAdminUser(api, detail.id);
                setConfirmAction(null);
                await usersState.refresh();
                navigate('/settings/admin/users', { replace: true });
                return;
            }
            if (confirmAction === 'promote' || confirmAction === 'demote') {
                await setAdminUserAdministrator(api, detail.id, confirmAction === 'promote');
            } else if (confirmAction === 'enable' || confirmAction === 'disable') {
                await setAdminUserEnabled(api, detail.id, confirmAction === 'enable');
            } else if (confirmAction === 'reset-password') {
                await resetAdminUserPassword(api, detail.id);
            }
            await state.invalidate();
            await usersState.refresh();
            setActionMessage('Account updated.');
            setConfirmAction(null);
        } catch (error) {
            setActionMessage(friendlyError(error, `We couldn't update ${detail.username}.`));
            setConfirmAction(null);
        } finally {
            mutationBusyRef.current = false;
            setActionBusy(false);
            setPolicyBusy(false);
        }
    }, [actionBusy, api, confirmAction, currentUser?.Id, detail, navigate, policyBusy, state, usersState]);

    if (state.loading) {
        return (
            <section aria-label='Loading user' className='ptv-admin-users' role='status'>
                <span className='ptv-admin-user-skeleton-block' style={{ height: 46, width: '44%' }} />
                <div className='ptv-admin-user-detail-grid'>
                    {Array.from({ length: 6 }, (_, index) => (
                        <div className='ptv-admin-user-section' key={index} style={{ minHeight: 180 }} />
                    ))}
                </div>
            </section>
        );
    }

    if (state.error || !detail) {
        return (
            <section className='ptv-admin-users'>
                <Link className='ptv-admin-user-detail-back' to='/settings/admin/users'><PtvIcon name='back' size='17px' />Users</Link>
                <div className='ptv-admin-users-error' role='alert'>
                    <PtvIcon name='alerts' size='30px' />
                    <h2>This user could not be loaded.</h2>
                    <p>The account may no longer exist, or the server may be temporarily unavailable.</p>
                    <button onClick={() => void state.refetch()} type='button'>Retry</button>
                </div>
            </section>
        );
    }

    const emailPresentation = getAdminUserEmailPresentation(detail.emailStatus);
    const email = detail.email || detail.maskedEmail;
    const libraryAvailable = state.libraryAccess.mode !== 'unavailable' && Boolean(libraryBaseline);
    const demoteGuard = guardFor('demote');
    const disableGuard = guardFor('disable');
    const deleteGuard = guardFor('delete');
    const isCurrentUser = getAdminUserIdentityKey(detail.id) === getAdminUserIdentityKey(currentUser?.Id);
    const confirm = confirmAction ? confirmationCopy(confirmAction, detail.username) : null;

    return (
        <section className='ptv-admin-users' data-testid='ptv-admin-user-detail'>
            <Link className='ptv-admin-user-detail-back' to='/settings/admin/users'>
                <PtvIcon name='back' size='17px' />
                Users
            </Link>
            <header className='ptv-admin-user-detail-header'>
                <div className='ptv-admin-user-detail-title'>
                    <AdminUserAvatar avatarUrl={detail.avatarUrl} large username={detail.username} />
                    <div>
                        <h1>{detail.username}</h1>
                        <p>{detail.authorizationState === 'ready' ? (detail.isAdministrator ? 'Administrator' : 'Member') : 'Role unavailable'} · {detail.authorizationState === 'ready' ? (detail.enabled ? 'Active' : 'Disabled') : 'Status unavailable'} · Last active {detail.sessionSourceState === 'ready' && detail.activeSessionCount > 0 ? 'now' : formatAdminUserTime(detail.lastActivityAt).toLocaleLowerCase()}</p>
                    </div>
                </div>
                <div className='ptv-admin-user-badges'>
                    <AdminUserBadge tone={detail.authorizationState === 'ready' ? (detail.isAdministrator ? 'info' : 'neutral') : 'warning'}>{detail.authorizationState === 'ready' ? (detail.isAdministrator ? 'Administrator' : 'Member') : 'Role unavailable'}</AdminUserBadge>
                    <AdminUserBadge tone={detail.authorizationState === 'ready' ? (detail.enabled ? 'healthy' : 'danger') : 'warning'}>{detail.authorizationState === 'ready' ? (detail.enabled ? 'Active' : 'Disabled') : 'Status unavailable'}</AdminUserBadge>
                </div>
            </header>

            {(state.profileError || state.sessionsError) && (
                <aside className='ptv-admin-users-notice' role='status'>
                    <PtvIcon name='alerts' size='21px' />
                    <div>
                        <strong>Some account context is unavailable</strong>
                        <p>Jellyfin account controls remain usable. {state.profileError ? 'PTV email status is unavailable. ' : ''}{state.sessionsError ? 'Session activity is unavailable.' : ''}</p>
                    </div>
                </aside>
            )}
            {actionMessage && (
                <p aria-live='polite' className={`ptv-admin-user-status-message${/couldn't|cannot|unavailable|failed|changed on the server/i.test(actionMessage) ? ' is-error' : ' is-success'}`}>{actionMessage}</p>
            )}

            <div className='ptv-admin-user-detail-grid'>
                <section className='ptv-admin-user-section' id='ptv-admin-user-profile'>
                    <header><h2>Profile</h2><p>Jellyfin identity and PTV profile status.</p></header>
                    <div className='ptv-admin-user-section-body'>
                        <label className='ptv-admin-user-field'>
                            <span>Username</span>
                            <input onChange={event => { setUsername(event.currentTarget.value); setUsernameState('idle'); }} value={username} />
                        </label>
                        <div className='ptv-admin-user-field'>
                            <span>Email</span>
                            <div className='ptv-admin-user-readonly'>
                                <span>{email || (detail.emailStatus === 'unavailable' ? 'Unavailable' : 'No email')}</span>
                                <AdminUserBadge tone={emailPresentation.tone}>{emailPresentation.label}</AdminUserBadge>
                            </div>
                            <small>Email is managed by the PTV profile service and is read-only here.</small>
                        </div>
                        <div className='ptv-admin-user-section-actions'>
                            <FieldSaveState message={`We couldn't rename ${detail.username}.`} state={usernameState} />
                            <button className='is-primary' disabled={!usernameDirty || !username.trim() || usernameState === 'saving'} onClick={() => void saveUsername()} type='button'>Save profile</button>
                        </div>
                    </div>
                </section>

                <section className='ptv-admin-user-section' id='ptv-admin-user-access'>
                    <header><h2>Account Access</h2><p>Role and sign-in availability.</p></header>
                    <div className='ptv-admin-user-section-body'>
                        <label className='ptv-admin-user-toggle'>
                            <span><strong>Administrator access</strong><small>Manage users, libraries, playback, plugins and server settings.</small></span>
                            <input
                                checked={detail.isAdministrator}
                                disabled={policyBusy || detail.authorizationState !== 'ready' || (detail.isAdministrator && !demoteGuard.allowed)}
                                onChange={() => requestAction(detail.isAdministrator ? 'demote' : 'promote')}
                                role='switch'
                                type='checkbox'
                            />
                        </label>
                        {!demoteGuard.allowed && detail.isAdministrator && <p className='ptv-admin-user-status-message'>{demoteGuard.reason}</p>}
                        <label className='ptv-admin-user-toggle'>
                            <span><strong>Account enabled</strong><small>Disabled accounts cannot sign in.</small></span>
                            <input
                                checked={detail.enabled}
                                disabled={policyBusy || detail.authorizationState !== 'ready' || (detail.enabled && !disableGuard.allowed)}
                                onChange={() => requestAction(detail.enabled ? 'disable' : 'enable')}
                                role='switch'
                                type='checkbox'
                            />
                        </label>
                        {!disableGuard.allowed && detail.enabled && <p className='ptv-admin-user-status-message'>{disableGuard.reason}</p>}
                    </div>
                </section>

                <section className='ptv-admin-user-section is-wide'>
                    <header><h2>Library Access</h2><p>Choose which Jellyfin libraries this member can open.</p></header>
                    <div className='ptv-admin-user-section-body'>
                        {!libraryAvailable ? (
                            <div className='ptv-admin-users-notice' role='alert'>
                                <PtvIcon name='alerts' size='21px' />
                                <div><strong>Library access could not be loaded.</strong><p>No access values can be saved until the source is available.</p></div>
                                <button onClick={() => void Promise.all([ state.refetch(), state.refetchLibraries() ])} type='button'>Retry</button>
                            </div>
                        ) : (
                            <>
                                <label className='ptv-admin-user-library'>
                                    <input checked={allLibraries} name='user-library-access' onChange={() => { setAllLibraries(true); setLibraryState('idle'); }} type='radio' />
                                    All libraries
                                </label>
                                <label className='ptv-admin-user-library'>
                                    <input checked={!allLibraries} name='user-library-access' onChange={() => { setAllLibraries(false); setLibraryState('idle'); }} type='radio' />
                                    Selected libraries
                                </label>
                                {!allLibraries && (
                                    <div className='ptv-admin-user-libraries'>
                                        {state.libraryAccess.folders.map(folder => (
                                            <label className='ptv-admin-user-library' key={folder.id}>
                                                <input checked={selectedFolderIds.includes(folder.id)} onChange={() => toggleFolder(folder.id)} type='checkbox' />
                                                {folder.name}
                                            </label>
                                        ))}
                                    </div>
                                )}
                                <div className='ptv-admin-user-section-actions'>
                                    <FieldSaveState message={`We couldn't save ${detail.username}'s library access.`} state={libraryState} />
                                    <button className='is-primary' disabled={!libraryBaseline || !libraryDirty || libraryState === 'saving' || policyBusy} onClick={() => void saveLibraries()} type='button'>Save library access</button>
                                </div>
                            </>
                        )}
                    </div>
                </section>

                <section className='ptv-admin-user-section is-wide' id='ptv-admin-user-playback'>
                    <header><h2>Playback &amp; Content</h2><p>Everyday playback permissions, with advanced controls kept secondary.</p></header>
                    <fieldset className='ptv-admin-user-section-body' disabled={!detail.editablePlaybackPolicy || !playbackBaseline}>
                        <label className='ptv-admin-user-toggle'><span><strong>Media playback</strong><small>Allow this member to play media.</small></span><input checked={Boolean(playback?.EnableMediaPlayback)} onChange={event => setPlaybackValue('EnableMediaPlayback', event.currentTarget.checked)} role='switch' type='checkbox' /></label>
                        <label className='ptv-admin-user-toggle'><span><strong>Downloads</strong><small>Allow media downloads to supported clients.</small></span><input checked={Boolean(playback?.EnableContentDownloading)} onChange={event => setPlaybackValue('EnableContentDownloading', event.currentTarget.checked)} role='switch' type='checkbox' /></label>
                        <label className='ptv-admin-user-toggle'><span><strong>Live TV</strong><small>Allow browsing and playing Live TV.</small></span><input checked={Boolean(playback?.EnableLiveTvAccess)} onChange={event => setPlaybackValue('EnableLiveTvAccess', event.currentTarget.checked)} role='switch' type='checkbox' /></label>
                        <details className='ptv-admin-user-advanced'>
                            <summary>Advanced Access</summary>
                            <div className='ptv-admin-user-advanced-content'>
                                <label className='ptv-admin-user-toggle'><span><strong>Video transcoding</strong><small>Allow the server to convert video during playback.</small></span><input checked={Boolean(playback?.EnableVideoPlaybackTranscoding)} onChange={event => setPlaybackValue('EnableVideoPlaybackTranscoding', event.currentTarget.checked)} role='switch' type='checkbox' /></label>
                                <label className='ptv-admin-user-toggle'><span><strong>Audio transcoding</strong><small>Allow the server to convert audio during playback.</small></span><input checked={Boolean(playback?.EnableAudioPlaybackTranscoding)} onChange={event => setPlaybackValue('EnableAudioPlaybackTranscoding', event.currentTarget.checked)} role='switch' type='checkbox' /></label>
                                <label className='ptv-admin-user-toggle'><span><strong>Remuxing</strong><small>Allow compatible streams to be repackaged without re-encoding.</small></span><input checked={Boolean(playback?.EnablePlaybackRemuxing)} onChange={event => setPlaybackValue('EnablePlaybackRemuxing', event.currentTarget.checked)} role='switch' type='checkbox' /></label>
                                <label className='ptv-admin-user-toggle'><span><strong>Remote access</strong><small>Allow this account to connect remotely when the server permits it.</small></span><input checked={Boolean(playback?.EnableRemoteAccess)} onChange={event => setPlaybackValue('EnableRemoteAccess', event.currentTarget.checked)} role='switch' type='checkbox' /></label>
                            </div>
                        </details>
                        <div className='ptv-admin-user-section-actions'>
                            <FieldSaveState message={`We couldn't save ${detail.username}'s playback access.`} state={playbackState} />
                            <button className='is-primary' disabled={!detail.editablePlaybackPolicy || !playbackBaseline || !playbackDirty || playbackState === 'saving' || policyBusy} onClick={() => void savePlayback()} type='button'>Save playback access</button>
                        </div>
                        {!detail.editablePlaybackPolicy && <p className='ptv-admin-user-status-message is-error'>Playback permissions could not be verified. No changes can be saved.</p>}
                    </fieldset>
                </section>

                <section className='ptv-admin-user-section' id='ptv-admin-user-restrictions'>
                    <header><h2>Content Restrictions</h2><p>Parental ratings, tags and access schedules.</p></header>
                    <div className='ptv-admin-user-section-body'>
                        <p className='ptv-admin-user-status-message'>
                            {detail.contentPolicy.maxParentalRating === null ? 'Maximum parental rating is unavailable.' : `Maximum parental rating value: ${detail.contentPolicy.maxParentalRating}.`}
                            {' '}Blocked tags: {detail.contentPolicy.blockedTagCount ?? 'unavailable'} · Access schedules: {detail.contentPolicy.accessScheduleCount ?? 'unavailable'}.
                        </p>
                        <a className='ptv-admin-user-button' href={`#/dashboard/users/parentalcontrol?userId=${encodeURIComponent(detail.id)}`}>Open content restrictions</a>
                    </div>
                </section>

                <section className='ptv-admin-user-section' id='ptv-admin-user-activity'>
                    <header><h2>Devices &amp; Activity</h2><p>Current sessions and related server workspaces.</p></header>
                    <div className='ptv-admin-user-section-body'>
                        {state.sessionsError ? (
                            <p className='ptv-admin-user-status-message'>Session activity is unavailable.</p>
                        ) : detail.sessions.length > 0 ? (
                            <div className='ptv-admin-user-session-list'>
                                {detail.sessions.map(session => (
                                    <div className='ptv-admin-user-session' key={`${session.deviceName || 'device'}:${session.client || 'client'}:${session.mediaTitle || 'media'}:${session.lastActivityAt || 'active'}`}>
                                        <span><strong>{session.deviceName || session.client || 'Unknown device'}</strong><small>{session.client || 'Unknown client'}{session.mediaTitle ? ` · ${session.mediaTitle}` : ''}</small></span>
                                        <AdminUserBadge tone={session.playing ? 'info' : 'neutral'}>{session.paused ? 'Paused' : session.playing ? 'Playing' : 'Active'}</AdminUserBadge>
                                    </div>
                                ))}
                            </div>
                        ) : <p className='ptv-admin-user-status-message'>No active sessions.</p>}
                        <p className='ptv-admin-user-status-message'>Last login: {formatAdminUserTime(detail.lastLoginAt)} · Last activity: {formatAdminUserTime(detail.lastActivityAt)}</p>
                        <div className='ptv-admin-user-related-links'>
                            <Link className='ptv-admin-user-button' to='/settings/admin/devices'>View Devices</Link>
                            <Link className='ptv-admin-user-button' to='/settings/admin/activity'>View Activity</Link>
                        </div>
                    </div>
                </section>

                <section className='ptv-admin-user-section' id='ptv-admin-user-security'>
                    <header><h2>Security</h2><p>Password controls use Jellyfin&apos;s existing account APIs.</p></header>
                    <div className='ptv-admin-user-section-body'>
                        <p className='ptv-admin-user-status-message'>{detail.hasConfiguredPassword === null ? 'Password status is unavailable.' : detail.hasConfiguredPassword ? 'A password is configured.' : 'No password is configured.'}</p>
                        <div className='ptv-admin-user-section-actions'>
                            <button onClick={() => setPasswordOpen(true)} type='button'>Set password</button>
                            {detail.hasConfiguredPassword && !detail.isAdministrator && <button onClick={() => requestAction('reset-password')} type='button'>Remove password</button>}
                        </div>
                    </div>
                </section>

                <section className='ptv-admin-user-section is-danger' id='ptv-admin-user-danger'>
                    <header><h2>Danger Zone</h2><p>Permanent account actions require confirmation.</p></header>
                    <div className='ptv-admin-user-section-body'>
                        {!deleteGuard.allowed && <p className='ptv-admin-user-status-message'>{deleteGuard.reason}</p>}
                        <button className='is-danger' disabled={!deleteGuard.allowed || actionBusy} onClick={() => requestAction('delete')} type='button'>Delete user</button>
                    </div>
                </section>
            </div>

            <AdminUserPasswordDialog
                api={api}
                onClose={() => setPasswordOpen(false)}
                onSaved={() => { setActionMessage('Password updated.'); void state.invalidate(); }}
                open={passwordOpen}
                requiresCurrentPassword={isCurrentUser && Boolean(detail.hasConfiguredPassword)}
                userId={detail.id}
                username={detail.username}
            />
            {confirm && (
                <ConfirmDialog
                    className='ptv-admin-user-dialog'
                    confirmButtonColor={confirmAction === 'delete' ? 'error' : 'primary'}
                    confirmButtonText={actionBusy ? 'Working…' : confirm.button}
                    onCancel={() => !actionBusy && setConfirmAction(null)}
                    onConfirm={() => void performConfirmedAction()}
                    open
                    text={confirm.text}
                    title={confirm.title}
                />
            )}
        </section>
    );
}

/* eslint-enable react/jsx-no-bind, jsx-a11y/label-has-associated-control, no-void, no-nested-ternary, sonarjs/no-nested-conditional, sonarjs/cognitive-complexity, sonarjs/no-alphabetical-sort, @stylistic/max-statements-per-line, compat/compat */
