import Dialog from '@mui/material/Dialog/Dialog';
import DialogActions from '@mui/material/DialogActions/DialogActions';
import DialogContent from '@mui/material/DialogContent/DialogContent';
import DialogTitle from '@mui/material/DialogTitle/DialogTitle';
import type { Api } from '@jellyfin/sdk';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import { useQuery } from '@tanstack/react-query';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { ApiClient } from 'jellyfin-apiclient';

import { getCurrentPtvPluginApiClient } from '../../../../core/pluginApi';
import { getResolvedAdminServerId } from '../adminServerIdentity';
import {
    AdminUsersServiceError,
    createAdminUser,
    loadAdminUserLibraries,
    updateAdminUserPassword
} from './adminUsersService';
import {
    bootstrapNewAdminUser,
    clearPendingNewAdminCreation,
    clearPendingNewAdminUser,
    createPendingNewAdminCreation,
    createPendingNewAdminUser,
    readPendingNewAdminCreation,
    readPendingNewAdminUser,
    reserveNewAdminUserCreation,
    resumePendingNewAdminUser,
    savePendingNewAdminCreation,
    savePendingNewAdminUser,
    type PendingNewAdminCreation,
    type PendingNewAdminUser
} from './adminNewUserBootstrapService';

/* eslint-disable react/jsx-no-bind, jsx-a11y/label-has-associated-control, no-void, no-nested-ternary, sonarjs/no-nested-conditional */

function safeMutationMessage(error: unknown, fallback: string) {
    if (error instanceof AdminUsersServiceError) return error.message;
    const status = (error as { response?: { status?: number }; status?: number })?.response?.status
        || (error as { status?: number })?.status;
    if (status === 409) return 'That username is already in use.';
    return fallback;
}

function normalizeCreationFolders(folders: readonly BaseItemDto[] | undefined) {
    return (folders || []).flatMap(folder => {
        const id = folder.Id?.trim();
        if (!id) return [];
        return [{ id, name: folder.Name?.trim() || 'Unnamed library' }];
    });
}

type CreationPhase = 'reserving' | 'creating' | 'permissions' | 'home' | 'checking' | 'complete' | 'failed';
type CreationIdentity = { api?: Api; adminUserId?: string; serverKey: string | null };

function isCurrentIdentity(activeIdentity: React.MutableRefObject<CreationIdentity | null>, expected: CreationIdentity) {
    return activeIdentity.current === expected;
}

function isCurrentCreationContext(activeIdentity: React.MutableRefObject<CreationIdentity | null>, expected: CreationIdentity, api: Api) {
    return isCurrentIdentity(activeIdentity, expected) && Boolean(getCurrentPtvPluginApiClient()?.matchesSdkApi(api));
}

function updateForCurrentIdentity(
    activeIdentity: React.MutableRefObject<CreationIdentity | null>,
    expected: CreationIdentity,
    update: () => void
) {
    if (expected.api && isCurrentCreationContext(activeIdentity, expected, expected.api)) update();
}

const CREATION_PROGRESS: Record<Exclude<CreationPhase, 'failed'>, string> = {
    reserving: 'Reserving account creation…',
    creating: 'Reservation created. Creating Jellyfin account…',
    permissions: 'Jellyfin account created. Applying permissions…',
    home: 'Permissions applied. Configuring Home access…',
    checking: 'Checking Home access verification…',
    complete: 'Completed. Account access verified.'
};

function creationFailureMessage(error: unknown, state: {
    reservation: PendingNewAdminCreation | null;
    reservationSaved: boolean;
    reservationConfirmed: boolean;
    jellyfinCreateStarted: boolean;
    jellyfinCreateConfirmed: boolean;
    confirmedUserId: string | null;
}): string {
    if (!state.reservationSaved || !state.reservation) {
        return safeMutationMessage(error, 'The creation request could not be prepared. No account creation was started.');
    }
    const { creationOperationId, username } = state.reservation;
    if (!state.reservationConfirmed) {
        return `Failed — recovery required while reserving account creation. The Plugin did not confirm the creation reservation for ${username}. Its outcome is unknown. No account creation was started. Review reservation ${creationOperationId} on the Users page before trying again.`;
    }
    if (!state.jellyfinCreateStarted) {
        return `Failed — recovery required before Jellyfin account creation for ${username}. Plugin reservation ${creationOperationId} was confirmed, but no Jellyfin creation request was started. Review the reservation on the Users page before trying again.`;
    }
    if (!state.jellyfinCreateConfirmed) {
        return `Failed — recovery required while creating Jellyfin account ${username}. ${safeMutationMessage(error, 'Jellyfin did not confirm whether the account was created.')} Plugin reservation ${creationOperationId} remains active. Review possible accounts on the Users page before trying again.`;
    }
    const confirmedIdentity = state.confirmedUserId ? ` (ID: ${state.confirmedUserId})` : '';
    return `Failed — recovery required after Jellyfin confirmed account ${username}${confirmedIdentity}. Local recovery details could not be saved. Plugin reservation ${creationOperationId} remains active. Review the account and reservation on the Users page before trying again.`;
}

export function AddAdminUserDialog({
    adminUserId,
    api,
    apiClient,
    onClose,
    onCreated,
    onReservationChanged,
    open
}: Readonly<{
    adminUserId?: string;
    api?: Api;
    apiClient?: ApiClient;
    onClose: () => void;
    onCreated: (userId: string) => void;
    onReservationChanged?: () => void;
    open: boolean;
}>) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const foldersQuery = useQuery({
        enabled: Boolean(open && api && serverKey),
        queryFn: ({ signal }) => loadAdminUserLibraries(api!, signal),
        queryKey: [ 'PtvAdminUsers', serverKey, 'creation-libraries' ],
        retry: 1,
        staleTime: 60_000
    });
    const folders = useMemo(() => normalizeCreationFolders(foldersQuery.data), [foldersQuery.data]);
    const [ username, setUsername ] = useState('');
    const [ password, setPassword ] = useState('');
    const [ confirmPassword, setConfirmPassword ] = useState('');
    const [ administrator, setAdministrator ] = useState(false);
    const [ allLibraries, setAllLibraries ] = useState(true);
    const [ selectedFolderIds, setSelectedFolderIds ] = useState<string[]>([]);
    const [ createdUser, setCreatedUser ] = useState<PendingNewAdminUser | null>(() => readPendingNewAdminUser(serverKey));
    const [ pendingCreation, setPendingCreation ] = useState<PendingNewAdminCreation | null>(() => readPendingNewAdminCreation(serverKey));
    const [ busy, setBusy ] = useState(false);
    const [ message, setMessage ] = useState('');
    const [ creationPhase, setCreationPhase ] = useState<CreationPhase | null>(null);
    const busyRef = useRef(false);
    const activeIdentityRef = useRef<CreationIdentity | null>(null);
    const operationTokenRef = useRef(0);

    useLayoutEffect(() => {
        const identity = { adminUserId, api, serverKey };
        activeIdentityRef.current = open ? identity : null;
        operationTokenRef.current += 1;
        busyRef.current = false;
        setBusy(false);
        return () => {
            if (activeIdentityRef.current === identity) activeIdentityRef.current = null;
            operationTokenRef.current += 1;
            busyRef.current = false;
        };
    }, [adminUserId, api, open, serverKey]);

    const clear = useCallback(() => {
        setUsername('');
        setPassword('');
        setConfirmPassword('');
        setAdministrator(false);
        setAllLibraries(true);
        setSelectedFolderIds([]);
        setCreatedUser(null);
        setPendingCreation(null);
        setMessage('');
        setBusy(false);
        setCreationPhase(null);
        operationTokenRef.current += 1;
        busyRef.current = false;
    }, []);

    const finishOperation = useCallback((identity: CreationIdentity, operationToken: number) => {
        if (operationTokenRef.current !== operationToken || !isCurrentIdentity(activeIdentityRef, identity)) return;
        busyRef.current = false;
        setBusy(false);
    }, []);

    useEffect(() => {
        if (!open) {
            clear();
            return;
        }
        const pending = readPendingNewAdminUser(serverKey);
        const creation = readPendingNewAdminCreation(serverKey);
        setPendingCreation(creation);
        setCreatedUser(pending);
        setUsername(pending?.username || '');
        setPassword('');
        setConfirmPassword('');
        setAdministrator(pending?.administrator || false);
        setAllLibraries(pending?.allLibraries ?? true);
        setSelectedFolderIds(pending?.selectedFolderIds || []);
        setMessage('');
        setCreationPhase(null);
    }, [adminUserId, api, clear, open, serverKey]);

    const close = useCallback(() => {
        if (busy) return;
        clear();
        onClose();
    }, [busy, clear, onClose]);
    const toggleFolder = useCallback((folderId: string) => {
        setSelectedFolderIds(current => current.includes(folderId) ?
            current.filter(id => id !== folderId) :
            [ ...current, folderId ]);
    }, []);
    const verifyCreated = useCallback(async (pending: PendingNewAdminUser, resume: boolean) => {
        if (!api || !serverKey) return;
        const identity = activeIdentityRef.current;
        if (!identity || identity.api !== api || identity.serverKey !== serverKey) return;
        const progress: { phase: 'permissions' | 'home' } = { phase: 'home' };
        try {
            if (resume) {
                updateForCurrentIdentity(activeIdentityRef, identity, () => setCreationPhase('checking'));
                await resumePendingNewAdminUser(api, pending);
            } else {
                updateForCurrentIdentity(activeIdentityRef, identity, () => setCreationPhase('home'));
                await bootstrapNewAdminUser(api, pending, phase => {
                    progress.phase = phase;
                    updateForCurrentIdentity(activeIdentityRef, identity, () => setCreationPhase(phase));
                }, () => isCurrentCreationContext(activeIdentityRef, identity, api));
            }
            clearPendingNewAdminUser(serverKey, pending.id);
            clearPendingNewAdminCreation(serverKey, pending.creationOperationId);
            updateForCurrentIdentity(activeIdentityRef, identity, () => {
                setPassword('');
                setConfirmPassword('');
                setCreationPhase('complete');
                onCreated(pending.id);
            });
        } catch (error) {
            const stage = resume ? 'checking Home access verification' :
                progress.phase === 'permissions' ? 'applying permissions' : 'configuring Home access';
            updateForCurrentIdentity(activeIdentityRef, identity, () => {
                setPassword('');
                setConfirmPassword('');
                setCreatedUser(pending);
                setCreationPhase('failed');
                setMessage(`${pending.username} was created, but ${stage} failed — recovery required. ${safeMutationMessage(error, 'Check verification again, or open this account for administrator recovery.')}`);
            });
        }
    }, [api, onCreated, serverKey]);
    const submit = useCallback(async (event: React.FormEvent) => {
        event.preventDefault();
        if (!api || !serverKey || busy || busyRef.current) return;
        const identity = activeIdentityRef.current;
        if (!identity || identity.api !== api || identity.serverKey !== serverKey) return;
        if (createdUser) {
            const operationToken = ++operationTokenRef.current;
            busyRef.current = true;
            setBusy(true);
            setMessage('');
            setCreationPhase('checking');
            try {
                await verifyCreated(createdUser, true);
            } finally {
                finishOperation(identity, operationToken);
            }
            return;
        }
        const unresolvedCreation = readPendingNewAdminCreation(serverKey) || pendingCreation;
        if (unresolvedCreation) {
            setPendingCreation(unresolvedCreation);
            setMessage('An earlier account creation needs administrator review. Resolve its reservation before creating another account.');
            return;
        }
        if (!username.trim()) {
            setMessage('Enter a username.');
            return;
        }
        if (password !== confirmPassword) {
            setMessage('Passwords do not match.');
            return;
        }
        if (foldersQuery.isError || !foldersQuery.data) {
            setMessage('Library access could not be loaded. Retry before creating the account.');
            return;
        }

        const operationToken = ++operationTokenRef.current;
        busyRef.current = true;
        setBusy(true);
        setMessage('');
        setCreationPhase('reserving');
        let reservation: PendingNewAdminCreation | null = null;
        let reservationSaved = false;
        let reservationConfirmed = false;
        let jellyfinCreateStarted = false;
        let jellyfinCreateConfirmed = false;
        let confirmedUserId: string | null = null;
        try {
            reservation = createPendingNewAdminCreation({
                administrator,
                allLibraries,
                selectedFolderIds: allLibraries ? [] : [ ...selectedFolderIds ],
                username: username.trim()
            });
            savePendingNewAdminCreation(serverKey, reservation);
            reservationSaved = true;
            setPendingCreation(reservation);
            onReservationChanged?.();
            await reserveNewAdminUserCreation(api, reservation);
            reservationConfirmed = true;
            if (!isCurrentCreationContext(activeIdentityRef, identity, api)) return;
            updateForCurrentIdentity(activeIdentityRef, identity, () => onReservationChanged?.());
            reservation = { ...reservation, stage: 'create-started' };
            savePendingNewAdminCreation(serverKey, reservation);
            updateForCurrentIdentity(activeIdentityRef, identity, () => setCreationPhase('creating'));
            jellyfinCreateStarted = true;
            const user = await createAdminUser(api, {
                password: password || undefined,
                username: username.trim()
            });
            jellyfinCreateConfirmed = true;
            const pending = createPendingNewAdminUser({
                administrator,
                allLibraries,
                creationOperationId: reservation.creationOperationId,
                id: user.Id!,
                selectedFolderIds: allLibraries ? [] : [ ...selectedFolderIds ],
                username: user.Name || username.trim()
            });
            confirmedUserId = pending.id;
            updateForCurrentIdentity(activeIdentityRef, identity, () => {
                setCreatedUser(pending);
                setPassword('');
                setConfirmPassword('');
            });
            savePendingNewAdminUser(serverKey, pending);
            if (!isCurrentCreationContext(activeIdentityRef, identity, api)) return;
            await verifyCreated(pending, false);
        } catch (error) {
            updateForCurrentIdentity(activeIdentityRef, identity, () => {
                setPassword('');
                setConfirmPassword('');
                setCreationPhase('failed');
                setMessage(creationFailureMessage(error, {
                    confirmedUserId,
                    jellyfinCreateConfirmed,
                    jellyfinCreateStarted,
                    reservation,
                    reservationConfirmed,
                    reservationSaved
                }));
                if (reservationSaved && !reservationConfirmed) onReservationChanged?.();
            });
        } finally {
            finishOperation(identity, operationToken);
        }
    }, [
        api,
        administrator,
        allLibraries,
        busy,
        confirmPassword,
        createdUser,
        foldersQuery.data,
        foldersQuery.isError,
        finishOperation,
        password,
        pendingCreation,
        onReservationChanged,
        selectedFolderIds,
        serverKey,
        username,
        verifyCreated
    ]);

    return (
        <Dialog
            aria-labelledby='ptv-add-user-title'
            className='ptv-admin-user-dialog'
            fullWidth
            maxWidth='sm'
            onClose={close}
            open={open}
        >
            <DialogTitle id='ptv-add-user-title'>Add User</DialogTitle>
            <DialogContent>
                <form className='ptv-admin-user-dialog-form' id='ptv-add-user-form' onSubmit={submit}>
                    <p className='ptv-admin-user-status-message'>Create an account directly. To let someone register themselves, use Create Invite instead.</p>
                    <label className='ptv-admin-user-field'>
                        <span>Username</span>
                        <input
                            autoComplete='off'
                            disabled={Boolean(createdUser || pendingCreation)}
                            onChange={event => setUsername(event.currentTarget.value)}
                            required
                            value={username}
                        />
                    </label>
                    <div className='ptv-admin-user-dialog-grid'>
                        <label className='ptv-admin-user-field'>
                            <span>Password (optional)</span>
                            <input
                                autoComplete='new-password'
                                disabled={Boolean(createdUser || pendingCreation)}
                                onChange={event => setPassword(event.currentTarget.value)}
                                type='password'
                                value={password}
                            />
                        </label>
                        <label className='ptv-admin-user-field'>
                            <span>Confirm password</span>
                            <input
                                autoComplete='new-password'
                                disabled={Boolean(createdUser || pendingCreation)}
                                onChange={event => setConfirmPassword(event.currentTarget.value)}
                                type='password'
                                value={confirmPassword}
                            />
                        </label>
                    </div>
                    <label className='ptv-admin-user-toggle'>
                        <span>
                            <strong>Administrator access</strong>
                            <small>Administrators can manage users, libraries, playback, plugins and server settings.</small>
                        </span>
                        <input
                            checked={administrator}
                            disabled={Boolean(createdUser || pendingCreation)}
                            onChange={event => setAdministrator(event.currentTarget.checked)}
                            role='switch'
                            type='checkbox'
                        />
                    </label>
                    <fieldset className='ptv-admin-user-field' disabled={Boolean(createdUser || pendingCreation) || foldersQuery.isPending || foldersQuery.isError}>
                        <legend>Library access</legend>
                        <label className='ptv-admin-user-library'>
                            <input checked={allLibraries} name='new-user-library-access' onChange={() => setAllLibraries(true)} type='radio' />
                            All libraries
                        </label>
                        <label className='ptv-admin-user-library'>
                            <input checked={!allLibraries} name='new-user-library-access' onChange={() => setAllLibraries(false)} type='radio' />
                            Selected libraries
                        </label>
                        {!allLibraries && (
                            <div className='ptv-admin-user-libraries'>
                                {folders.map(folder => (
                                    <label className='ptv-admin-user-library' key={folder.id}>
                                        <input
                                            checked={selectedFolderIds.includes(folder.id)}
                                            onChange={() => toggleFolder(folder.id)}
                                            type='checkbox'
                                        />
                                        {folder.name}
                                    </label>
                                ))}
                            </div>
                        )}
                    </fieldset>
                    {foldersQuery.isError && (
                        <p className='ptv-admin-user-status-message is-error'>
                            Library access could not be loaded. The account will not be created until it is available.
                        </p>
                    )}
                    {busy && creationPhase && creationPhase !== 'failed' && (
                        <p aria-live='polite' className='ptv-admin-user-status-message' role='status'>
                            {CREATION_PROGRESS[creationPhase]}
                        </p>
                    )}
                    {createdUser && !busy && (
                        <p className='ptv-admin-user-status-message' role='status'>
                            {createdUser.username} was created (ID: {createdUser.id}). Plugin verification is required before Home access. This account remains available for administrator recovery after closing or reloading this page.
                        </p>
                    )}
                    {pendingCreation && !createdUser && !busy && (
                        <p className='ptv-admin-user-status-message' role='status'>
                            The creation request for {pendingCreation.username} is unresolved (ID: {pendingCreation.creationOperationId}). Review its Plugin reservation and possible Jellyfin accounts on the Users page before creating another one.
                        </p>
                    )}
                    {message && <p aria-live='polite' className='ptv-admin-user-status-message is-error'>{message}</p>}
                </form>
            </DialogContent>
            <DialogActions className='ptv-admin-user-dialog-actions'>
                {foldersQuery.isError && (
                    <button disabled={busy || !serverKey} onClick={() => void foldersQuery.refetch()} type='button'>Retry libraries</button>
                )}
                {createdUser && (
                    <button disabled={busy} onClick={() => onCreated(createdUser.id)} type='button'>Open User for recovery</button>
                )}
                <button disabled={busy} onClick={close} type='button'>Cancel</button>
                <button
                    className='is-primary'
                    disabled={busy || !serverKey || (Boolean(pendingCreation) && !createdUser) || (!createdUser && (foldersQuery.isPending || foldersQuery.isError))}
                    form='ptv-add-user-form'
                    type='submit'
                >
                    {busy ? 'Saving…' : createdUser ? 'Check verification' : 'Create User'}
                </button>
            </DialogActions>
        </Dialog>
    );
}

export function AdminUserPasswordDialog({
    api,
    onClose,
    onSaved,
    open,
    requiresCurrentPassword = false,
    userId,
    username
}: Readonly<{
    api?: Api;
    onClose: () => void;
    onSaved: () => void;
    open: boolean;
    requiresCurrentPassword?: boolean;
    userId: string;
    username: string;
}>) {
    const [ password, setPassword ] = useState('');
    const [ confirmPassword, setConfirmPassword ] = useState('');
    const [ currentPassword, setCurrentPassword ] = useState('');
    const [ busy, setBusy ] = useState(false);
    const [ message, setMessage ] = useState('');
    const busyRef = useRef(false);
    const clear = useCallback(() => {
        setPassword('');
        setConfirmPassword('');
        setCurrentPassword('');
        setMessage('');
        setBusy(false);
        busyRef.current = false;
    }, []);
    useEffect(() => {
        if (!open) clear();
        return () => {
            setPassword('');
            setConfirmPassword('');
            setCurrentPassword('');
        };
    }, [clear, open]);
    const close = useCallback(() => {
        if (busy) return;
        clear();
        onClose();
    }, [busy, clear, onClose]);
    const submit = useCallback(async (event: React.FormEvent) => {
        event.preventDefault();
        if (!api || busy || busyRef.current) return;
        if (!password) {
            setMessage('Enter a new password.');
            return;
        }
        if (requiresCurrentPassword && !currentPassword) {
            setMessage('Enter the current password.');
            return;
        }
        if (password !== confirmPassword) {
            setMessage('Passwords do not match.');
            return;
        }
        busyRef.current = true;
        setBusy(true);
        setMessage('');
        try {
            await updateAdminUserPassword(api, userId, {
                currentPassword: requiresCurrentPassword ? currentPassword : undefined,
                newPassword: password
            });
            clear();
            onSaved();
            onClose();
        } catch (error) {
            setMessage(safeMutationMessage(error, `We couldn't update ${username}'s password.`));
            setPassword('');
            setConfirmPassword('');
            setCurrentPassword('');
            setBusy(false);
        } finally {
            busyRef.current = false;
        }
    }, [api, busy, clear, confirmPassword, currentPassword, onClose, onSaved, password, requiresCurrentPassword, userId, username]);

    return (
        <Dialog
            aria-labelledby='ptv-user-password-title'
            className='ptv-admin-user-dialog'
            fullWidth
            maxWidth='xs'
            onClose={close}
            open={open}
        >
            <DialogTitle id='ptv-user-password-title'>Set password for {username}</DialogTitle>
            <DialogContent>
                <form className='ptv-admin-user-dialog-form' id='ptv-user-password-form' onSubmit={submit}>
                    {requiresCurrentPassword && (
                        <label className='ptv-admin-user-field'>
                            <span>Current password</span>
                            <input
                                autoComplete='current-password'
                                onChange={event => setCurrentPassword(event.currentTarget.value)}
                                type='password'
                                value={currentPassword}
                            />
                        </label>
                    )}
                    <label className='ptv-admin-user-field'>
                        <span>New password</span>
                        <input
                            autoComplete='new-password'
                            onChange={event => setPassword(event.currentTarget.value)}
                            type='password'
                            value={password}
                        />
                    </label>
                    <label className='ptv-admin-user-field'>
                        <span>Confirm password</span>
                        <input
                            autoComplete='new-password'
                            onChange={event => setConfirmPassword(event.currentTarget.value)}
                            type='password'
                            value={confirmPassword}
                        />
                    </label>
                    {message && <p aria-live='polite' className='ptv-admin-user-status-message is-error'>{message}</p>}
                </form>
            </DialogContent>
            <DialogActions className='ptv-admin-user-dialog-actions'>
                <button disabled={busy} onClick={close} type='button'>Cancel</button>
                <button className='is-primary' disabled={busy} form='ptv-user-password-form' type='submit'>
                    {busy ? 'Saving…' : 'Save password'}
                </button>
            </DialogActions>
        </Dialog>
    );
}

/* eslint-enable react/jsx-no-bind, jsx-a11y/label-has-associated-control, no-void, no-nested-ternary, sonarjs/no-nested-conditional */
