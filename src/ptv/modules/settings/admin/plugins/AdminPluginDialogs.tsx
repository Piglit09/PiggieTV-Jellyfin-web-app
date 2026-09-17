import Button from '@mui/material/Button/Button';
import Dialog from '@mui/material/Dialog/Dialog';
import DialogActions from '@mui/material/DialogActions/DialogActions';
import DialogContent from '@mui/material/DialogContent/DialogContent';
import DialogContentText from '@mui/material/DialogContentText/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle/DialogTitle';
import React, { useCallback, useEffect, useState } from 'react';

import type {
    AdminPluginAction,
    AdminPluginCardView,
    AdminPluginRepositoryView
} from './AdminPluginPresentation';

/* eslint-disable react/jsx-no-bind */

export type PendingAdminPluginAction = Readonly<{
    action: AdminPluginAction;
    plugin: AdminPluginCardView;
}>;

export type AdminPluginRepositoryDraft = Readonly<{
    enabled: boolean;
    name: string;
    url: string;
}>;

function pluginActionCopy(pending: PendingAdminPluginAction) {
    const name = pending.plugin.name;
    switch (pending.action) {
        case 'install':
            return {
                confirm: 'Install Plugin',
                text: pending.plugin.trustedSource ?
                    `PiggieTV will ask Jellyfin to install ${name} from the selected repository.` :
                    `${name} comes from a third-party repository. Plugins run code on your server. Install it only if you trust its author and repository.`,
                title: `Install ${name}?`
            };
        case 'update':
            return {
                confirm: 'Update Plugin',
                text: pending.plugin.trustedSource ?
                    `PiggieTV will ask Jellyfin to install the selected newer version of ${name}.` :
                    `${name} will be updated from a third-party repository. Continue only if you trust its author and repository.`,
                title: `Update ${name}?`
            };
        case 'uninstall':
            return {
                confirm: 'Uninstall Plugin',
                text: 'This removes the plugin from the server. Plugin data or configuration may remain depending on Jellyfin and the plugin.',
                title: `Uninstall ${name}?`
            };
        case 'disable':
            return {
                confirm: 'Disable Plugin',
                text: `PiggieTV will ask Jellyfin to disable ${name}. Jellyfin may require a server restart to finish the change.`,
                title: `Disable ${name}?`
            };
        case 'enable':
        default:
            return {
                confirm: 'Enable Plugin',
                text: `PiggieTV will ask Jellyfin to enable ${name}. Jellyfin may require a server restart to finish the change.`,
                title: `Enable ${name}?`
            };
    }
}

export function AdminPluginActionDialog({
    busy,
    onCancel,
    onConfirm,
    pending
}: Readonly<{
    busy: boolean;
    onCancel: () => void;
    onConfirm: () => void;
    pending: PendingAdminPluginAction | null;
}>) {
    const copy = pending ? pluginActionCopy(pending) : null;
    const dangerous = pending?.action === 'uninstall' || pending?.action === 'disable';

    return (
        <Dialog
            aria-describedby='ptv-plugin-action-description'
            aria-labelledby='ptv-plugin-action-title'
            className='ptv-admin-plugin-dialog'
            fullWidth
            maxWidth='xs'
            onClose={busy ? undefined : onCancel}
            open={Boolean(copy)}
        >
            <DialogTitle id='ptv-plugin-action-title'>{copy?.title}</DialogTitle>
            <DialogContent>
                <DialogContentText id='ptv-plugin-action-description'>{copy?.text}</DialogContentText>
            </DialogContent>
            <DialogActions className='ptv-admin-plugin-dialog-actions'>
                <Button disabled={busy} onClick={onCancel} variant='text'>Cancel</Button>
                <Button
                    aria-busy={busy || undefined}
                    color={dangerous ? 'error' : 'primary'}
                    disabled={busy}
                    onClick={onConfirm}
                >
                    {busy ? 'Working…' : copy?.confirm}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

function isAbsoluteUrl(value: string) {
    try {
        // The server remains responsible for scheme and repository validation.
        // eslint-disable-next-line compat/compat
        return Boolean(new URL(value).protocol);
    } catch {
        return false;
    }
}

function repositorySubmitLabel(busy: boolean, editing: boolean) {
    if (busy) return 'Saving…';
    return editing ? 'Save Repository' : 'Add Repository';
}

export function AdminPluginRepositoryDialog({
    busy,
    onCancel,
    onSubmit,
    repository
}: Readonly<{
    busy: boolean;
    onCancel: () => void;
    onSubmit: (draft: AdminPluginRepositoryDraft) => void;
    repository: AdminPluginRepositoryView | 'new' | null;
}>) {
    const [ name, setName ] = useState('');
    const [ url, setUrl ] = useState('');
    const [ enabled, setEnabled ] = useState(true);
    const [ error, setError ] = useState('');
    const editing = repository !== null && repository !== 'new';
    const submitLabel = repositorySubmitLabel(busy, editing);

    useEffect(() => {
        if (!repository) return;
        setName(editing ? repository.name : '');
        setUrl(editing ? repository.url || '' : '');
        setEnabled(editing ? repository.enabled !== false : true);
        setError('');
    }, [editing, repository]);

    const submit = useCallback((event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const normalizedName = name.trim();
        const normalizedUrl = url.trim();
        if (!normalizedName) {
            setError('Enter a repository name.');
            return;
        }
        if (!normalizedUrl || !isAbsoluteUrl(normalizedUrl)) {
            setError('Enter a valid absolute repository URL.');
            return;
        }
        setError('');
        onSubmit({ enabled, name: normalizedName, url: normalizedUrl });
    }, [enabled, name, onSubmit, url]);

    return (
        <Dialog
            aria-labelledby='ptv-plugin-repository-dialog-title'
            className='ptv-admin-plugin-dialog'
            fullWidth
            maxWidth='xs'
            onClose={busy ? undefined : onCancel}
            open={Boolean(repository)}
            slotProps={{
                paper: {
                    component: 'form',
                    onSubmit: submit
                }
            }}
        >
            <DialogTitle id='ptv-plugin-repository-dialog-title'>
                {editing ? 'Edit Repository' : 'Add Repository'}
            </DialogTitle>
            <DialogContent>
                <div className='ptv-admin-plugin-dialog-form'>
                    <label htmlFor='ptv-plugin-repository-name'>
                        <span>Name</span>
                        <input
                            autoComplete='off'
                            id='ptv-plugin-repository-name'
                            onChange={event => setName(event.currentTarget.value)}
                            required
                            value={name}
                        />
                        <small>A recognizable label for administrators.</small>
                    </label>
                    <label htmlFor='ptv-plugin-repository-url'>
                        <span>Repository URL</span>
                        <input
                            autoComplete='off'
                            id='ptv-plugin-repository-url'
                            onChange={event => setUrl(event.currentTarget.value)}
                            required
                            type='url'
                            value={url}
                        />
                        <small>Jellyfin validates and reads this repository on the server.</small>
                    </label>
                    <div className='ptv-admin-plugin-dialog-toggle'>
                        <label htmlFor='ptv-plugin-repository-enabled'>
                            <strong>Enabled</strong>
                            <small>Include this source in the plugin catalog.</small>
                        </label>
                        <input
                            checked={enabled}
                            id='ptv-plugin-repository-enabled'
                            onChange={event => setEnabled(event.currentTarget.checked)}
                            role='switch'
                            type='checkbox'
                        />
                    </div>
                    {error ? <p aria-live='assertive' className='ptv-admin-plugin-dialog-error' role='alert'>{error}</p> : null}
                </div>
            </DialogContent>
            <DialogActions className='ptv-admin-plugin-dialog-actions'>
                <Button disabled={busy} onClick={onCancel} variant='text'>Cancel</Button>
                <Button aria-busy={busy || undefined} disabled={busy} type='submit'>
                    {submitLabel}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

export function AdminPluginRepositoryRemoveDialog({
    busy,
    onCancel,
    onConfirm,
    repository
}: Readonly<{
    busy: boolean;
    onCancel: () => void;
    onConfirm: () => void;
    repository: AdminPluginRepositoryView | null;
}>) {
    return (
        <Dialog
            aria-describedby='ptv-plugin-repository-remove-description'
            aria-labelledby='ptv-plugin-repository-remove-title'
            className='ptv-admin-plugin-dialog'
            fullWidth
            maxWidth='xs'
            onClose={busy ? undefined : onCancel}
            open={Boolean(repository)}
        >
            <DialogTitle id='ptv-plugin-repository-remove-title'>Remove {repository?.name}?</DialogTitle>
            <DialogContent>
                <DialogContentText id='ptv-plugin-repository-remove-description'>
                    Removing this source changes the catalog. Plugins already installed from it are not automatically uninstalled.
                </DialogContentText>
            </DialogContent>
            <DialogActions className='ptv-admin-plugin-dialog-actions'>
                <Button disabled={busy} onClick={onCancel} variant='text'>Cancel</Button>
                <Button aria-busy={busy || undefined} color='error' disabled={busy} onClick={onConfirm}>
                    {busy ? 'Removing…' : 'Remove Repository'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

/* eslint-enable react/jsx-no-bind */
