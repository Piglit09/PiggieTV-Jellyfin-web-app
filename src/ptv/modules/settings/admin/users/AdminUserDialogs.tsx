import Dialog from '@mui/material/Dialog/Dialog';
import DialogActions from '@mui/material/DialogActions/DialogActions';
import DialogContent from '@mui/material/DialogContent/DialogContent';
import DialogTitle from '@mui/material/DialogTitle/DialogTitle';
import type { Api } from '@jellyfin/sdk';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import { useQuery } from '@tanstack/react-query';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ApiClient } from 'jellyfin-apiclient';

import { getResolvedAdminServerId } from '../adminServerIdentity';
import {
    AdminUsersServiceError,
    createAdminUser,
    loadAdminUserLibraries,
    updateAdminUserLibraryAccess,
    updateAdminUserPassword,
    updateAdminUserPolicy
} from './adminUsersService';

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

export function AddAdminUserDialog({
    api,
    apiClient,
    onClose,
    onCreated,
    open
}: Readonly<{
    api?: Api;
    apiClient?: ApiClient;
    onClose: () => void;
    onCreated: (userId: string) => void;
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
    const [ createdUser, setCreatedUser ] = useState<{ id: string; username: string } | null>(null);
    const [ busy, setBusy ] = useState(false);
    const [ message, setMessage ] = useState('');
    const busyRef = useRef(false);

    const clear = useCallback(() => {
        setUsername('');
        setPassword('');
        setConfirmPassword('');
        setAdministrator(false);
        setAllLibraries(true);
        setSelectedFolderIds([]);
        setCreatedUser(null);
        setMessage('');
        setBusy(false);
        busyRef.current = false;
    }, []);

    useEffect(() => {
        if (!open) clear();
    }, [clear, open]);

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
    const applyAccess = useCallback(async (id: string, name: string) => {
        if (!api || !serverKey) return;
        try {
            await updateAdminUserPolicy(api, id, { IsAdministrator: administrator });
            await updateAdminUserLibraryAccess(api, id, allLibraries ?
                { mode: 'all' } :
                { mode: 'selected', selectedFolderIds });
            setPassword('');
            setConfirmPassword('');
            onCreated(id);
        } catch (error) {
            setPassword('');
            setConfirmPassword('');
            setCreatedUser({ id, username: name });
            setMessage(`${name} was created, but access settings could not be saved. ${safeMutationMessage(error, 'Try the access settings again.')}`);
        }
    }, [administrator, allLibraries, api, onCreated, selectedFolderIds, serverKey]);
    const submit = useCallback(async (event: React.FormEvent) => {
        event.preventDefault();
        if (!api || !serverKey || busy || busyRef.current) return;
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

        busyRef.current = true;
        setBusy(true);
        setMessage('');
        try {
            if (createdUser) {
                await applyAccess(createdUser.id, createdUser.username);
                return;
            }
            const user = await createAdminUser(api, {
                password: password || undefined,
                username: username.trim()
            });
            await applyAccess(user.Id!, user.Name || username.trim());
        } catch (error) {
            setPassword('');
            setConfirmPassword('');
            setMessage(safeMutationMessage(error, 'We could not create this account.'));
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }, [
        api,
        applyAccess,
        busy,
        confirmPassword,
        createdUser,
        foldersQuery.data,
        foldersQuery.isError,
        password,
        serverKey,
        username
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
                            disabled={Boolean(createdUser)}
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
                                disabled={Boolean(createdUser)}
                                onChange={event => setPassword(event.currentTarget.value)}
                                type='password'
                                value={password}
                            />
                        </label>
                        <label className='ptv-admin-user-field'>
                            <span>Confirm password</span>
                            <input
                                autoComplete='new-password'
                                disabled={Boolean(createdUser)}
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
                            onChange={event => setAdministrator(event.currentTarget.checked)}
                            role='switch'
                            type='checkbox'
                        />
                    </label>
                    <fieldset className='ptv-admin-user-field' disabled={foldersQuery.isPending || foldersQuery.isError}>
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
                    {message && <p aria-live='polite' className='ptv-admin-user-status-message is-error'>{message}</p>}
                </form>
            </DialogContent>
            <DialogActions className='ptv-admin-user-dialog-actions'>
                {foldersQuery.isError && (
                    <button disabled={busy || !serverKey} onClick={() => void foldersQuery.refetch()} type='button'>Retry libraries</button>
                )}
                {createdUser && (
                    <button disabled={busy} onClick={() => onCreated(createdUser.id)} type='button'>Open User</button>
                )}
                <button disabled={busy} onClick={close} type='button'>Cancel</button>
                <button
                    className='is-primary'
                    disabled={busy || !serverKey || foldersQuery.isPending || foldersQuery.isError}
                    form='ptv-add-user-form'
                    type='submit'
                >
                    {busy ? 'Saving…' : createdUser ? 'Retry access settings' : 'Create User'}
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
