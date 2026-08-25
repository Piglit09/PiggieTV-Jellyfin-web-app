import Dialog from '@mui/material/Dialog/Dialog';
import DialogActions from '@mui/material/DialogActions/DialogActions';
import DialogContent from '@mui/material/DialogContent/DialogContent';
import DialogTitle from '@mui/material/DialogTitle/DialogTitle';
import type { Api } from '@jellyfin/sdk';
import type { FileSystemEntryInfo } from '@jellyfin/sdk/lib/generated-client/models/file-system-entry-info';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ApiClient } from 'jellyfin-apiclient';

import PtvIcon from '../../../icons/PtvIcon';
import {
    AdminLibrariesServiceError,
    createAdminLibrary,
    loadAdminLibraryDirectory,
    validateAdminLibraryPath
} from './adminLibrariesService';
import { useAdminLibraryCreationOptions } from './useAdminLibraries';

/* eslint-disable react/jsx-no-bind, no-void, sonarjs/no-nested-functions */

const COLLECTION_TYPES = [
    { label: 'Movies', value: 'movies' },
    { label: 'Shows', value: 'tvshows' },
    { label: 'Music', value: 'music' },
    { label: 'Books', value: 'books' },
    { label: 'Home Videos', value: 'homevideos' },
    { label: 'Music Videos', value: 'musicvideos' },
    { label: 'Mixed Media', value: 'mixed' }
] as const;

const NO_SUGGESTED_PATHS: readonly string[] = [];

function safeLibraryMutationMessage(error: unknown, fallback: string) {
    if (error instanceof AdminLibrariesServiceError) return error.message;
    return fallback;
}

export function AdminLibraryFolderPicker({
    api,
    onCancel,
    onSelect,
    open,
    suggestedPaths = NO_SUGGESTED_PATHS
}: Readonly<{
    api?: Api;
    onCancel: () => void;
    onSelect: (path: string) => void;
    open: boolean;
    suggestedPaths?: readonly string[];
}>) {
    const [ currentPath, setCurrentPath ] = useState<string | undefined>(undefined);
    const [ selectedPath, setSelectedPath ] = useState('');
    const [ entries, setEntries ] = useState<readonly FileSystemEntryInfo[]>([]);
    const [ parentPath, setParentPath ] = useState('');
    const [ loading, setLoading ] = useState(false);
    const [ validating, setValidating ] = useState(false);
    const [ message, setMessage ] = useState('');
    const [ browseFailed, setBrowseFailed ] = useState(false);
    const browseAbortRef = useRef<AbortController | null>(null);
    const lastBrowsePathRef = useRef<string | undefined>(undefined);
    const requestRef = useRef(0);
    const validationRef = useRef(0);
    const configuredPaths = useMemo(() => Array.from(new Set(
        suggestedPaths.map(path => path.trim()).filter(Boolean)
    )), [suggestedPaths]);

    useEffect(() => () => {
        browseAbortRef.current?.abort();
        requestRef.current += 1;
        validationRef.current += 1;
    }, []);

    const browse = useCallback(async (path?: string) => {
        browseAbortRef.current?.abort();
        lastBrowsePathRef.current = path;
        const request = ++requestRef.current;
        if (!api) {
            setLoading(false);
            return;
        }
        const AbortControllerConstructor = globalThis['AbortController'];
        const controller = new AbortControllerConstructor();
        browseAbortRef.current = controller;
        setLoading(true);
        setMessage('');
        setBrowseFailed(false);
        try {
            const result = await loadAdminLibraryDirectory(api, path, controller.signal);
            if (request !== requestRef.current) return;
            setCurrentPath(result.path);
            setSelectedPath(result.path);
            setEntries(result.entries);
            setParentPath(result.parentPath);
        } catch (error) {
            if (request !== requestRef.current) return;
            setMessage(safeLibraryMutationMessage(error, 'This server folder could not be opened.'));
            setBrowseFailed(true);
        } finally {
            if (browseAbortRef.current === controller) browseAbortRef.current = null;
            if (request === requestRef.current) setLoading(false);
        }
    }, [api]);

    const chooseConfiguredPath = useCallback((path: string) => {
        browseAbortRef.current?.abort();
        browseAbortRef.current = null;
        requestRef.current += 1;
        setCurrentPath(undefined);
        setSelectedPath(path);
        setEntries([]);
        setParentPath('');
        setLoading(false);
        setMessage('');
        setBrowseFailed(false);
    }, []);

    useEffect(() => {
        if (open) {
            if (configuredPaths.length === 0) void browse();
        } else {
            browseAbortRef.current?.abort();
            browseAbortRef.current = null;
            requestRef.current += 1;
            validationRef.current += 1;
            setCurrentPath(undefined);
            setSelectedPath('');
            setEntries([]);
            setParentPath('');
            setLoading(false);
            setMessage('');
            setBrowseFailed(false);
        }
    }, [browse, configuredPaths, open]);

    const select = useCallback(async () => {
        if (!api || validating || !selectedPath.trim()) return;
        const request = ++validationRef.current;
        setValidating(true);
        setMessage('');
        try {
            const validated = await validateAdminLibraryPath(api, selectedPath);
            if (!open || request !== validationRef.current) return;
            onSelect(validated);
        } catch (error) {
            setMessage(safeLibraryMutationMessage(error, 'That server path could not be validated.'));
        } finally {
            if (request === validationRef.current) setValidating(false);
        }
    }, [api, onSelect, open, selectedPath, validating]);
    const cancel = useCallback(() => {
        if (validating) return;
        validationRef.current += 1;
        onCancel();
    }, [onCancel, validating]);

    return (
        <Dialog
            aria-labelledby='ptv-library-folder-picker-title'
            className='ptv-admin-library-dialog'
            fullWidth
            maxWidth='sm'
            onClose={cancel}
            open={open}
        >
            <DialogTitle id='ptv-library-folder-picker-title'>Choose a server folder</DialogTitle>
            <DialogContent>
                <div className='ptv-admin-library-dialog-form'>
                    <label className='ptv-admin-library-field'>
                        <span>Folder path</span>
                        <input onChange={event => setSelectedPath(event.currentTarget.value)} value={selectedPath} />
                        <small>Choose a configured folder or enter a path. PiggieTV validates it before saving.</small>
                    </label>
                    <div className='ptv-admin-library-folder-browser-actions'>
                        <button
                            disabled={loading || !selectedPath.trim()}
                            onClick={() => void browse(selectedPath.trim())}
                            type='button'
                        >
                            <PtvIcon name='folders' size='16px' />
                            Browse entered path
                        </button>
                    </div>
                    <div aria-busy={loading} className='ptv-admin-library-directory-list'>
                        {currentPath && (
                            <button className='ptv-admin-library-directory-entry' onClick={() => void browse(parentPath || undefined)} type='button'>
                                <PtvIcon name='back' size='16px' />
                                <span>{parentPath ? 'Parent folder' : 'Server drives'}</span>
                                <PtvIcon name='right' size='14px' />
                            </button>
                        )}
                        {entries.map(entry => {
                            const path = entry.Path || '';
                            return (
                                <button
                                    className='ptv-admin-library-directory-entry'
                                    disabled={!path}
                                    key={`${path}:${entry.Name || 'directory'}`}
                                    onClick={() => void browse(path)}
                                    title={path}
                                    type='button'
                                >
                                    <PtvIcon name='folders' size='17px' />
                                    <span>{entry.Name || path || 'Unnamed folder'}</span>
                                    <PtvIcon name='right' size='14px' />
                                </button>
                            );
                        })}
                        {!currentPath && entries.length === 0 && configuredPaths.length > 0 && (
                            <>
                                <p className='ptv-admin-library-directory-heading'>Configured library folders</p>
                                {configuredPaths.map(path => (
                                    <button
                                        aria-label={`Choose configured folder ${path}`}
                                        aria-pressed={selectedPath === path}
                                        className='ptv-admin-library-directory-suggestion'
                                        key={path}
                                        onClick={() => chooseConfiguredPath(path)}
                                        title={path}
                                        type='button'
                                    >
                                        <PtvIcon name='folders' size='17px' />
                                        <span>{path}</span>
                                    </button>
                                ))}
                                {!loading && !browseFailed && (
                                    <button
                                        className='ptv-admin-library-directory-action'
                                        onClick={() => void browse()}
                                        type='button'
                                    >
                                        <PtvIcon name='refresh' size='16px' />
                                        <span>Browse all server folders</span>
                                    </button>
                                )}
                            </>
                        )}
                        {!loading && !browseFailed && entries.length === 0 && configuredPaths.length === 0 && (
                            <p>{currentPath ? 'No folders are available here.' : 'No server folders are available.'}</p>
                        )}
                        {loading && <p role='status'>Loading server folders…</p>}
                        {!loading && browseFailed && (
                            <button
                                className='ptv-admin-library-directory-action'
                                onClick={() => void browse(lastBrowsePathRef.current)}
                                type='button'
                            >
                                <PtvIcon name='refresh' size='16px' />
                                <span>Retry server folders</span>
                            </button>
                        )}
                    </div>
                    {message && <p aria-live='polite' className='ptv-admin-library-status-message is-error'>{message}</p>}
                </div>
            </DialogContent>
            <DialogActions className='ptv-admin-library-dialog-actions'>
                <button disabled={validating} onClick={cancel} type='button'>Cancel</button>
                <button className='is-primary' disabled={validating || !selectedPath.trim()} onClick={() => void select()} type='button'>
                    {validating ? 'Checking…' : 'Use this folder'}
                </button>
            </DialogActions>
        </Dialog>
    );
}

export function AddAdminLibraryDialog({
    api,
    apiClient,
    onClose,
    onCreated,
    open,
    suggestedPaths = NO_SUGGESTED_PATHS
}: Readonly<{
    api?: Api;
    apiClient?: ApiClient;
    onClose: () => void;
    onCreated: (libraryId: string | null) => void;
    open: boolean;
    suggestedPaths?: readonly string[];
}>) {
    const [ name, setName ] = useState('');
    const [ collectionType, setCollectionType ] = useState('movies');
    const [ locations, setLocations ] = useState<string[]>([]);
    const [ folderPickerOpen, setFolderPickerOpen ] = useState(false);
    const [ busy, setBusy ] = useState(false);
    const [ message, setMessage ] = useState('');
    const busyRef = useRef(false);
    const optionsQuery = useAdminLibraryCreationOptions(api, apiClient, collectionType, open);

    const clear = useCallback(() => {
        setName('');
        setCollectionType('movies');
        setLocations([]);
        setFolderPickerOpen(false);
        setBusy(false);
        setMessage('');
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
    const addLocation = useCallback((path: string) => {
        setFolderPickerOpen(false);
        setLocations(current => current.includes(path) ? current : [ ...current, path ]);
    }, []);
    const submit = useCallback(async (event: React.FormEvent) => {
        event.preventDefault();
        if (!api || busyRef.current || busy) return;
        if (!name.trim()) {
            setMessage('Enter a library name.');
            return;
        }
        if (!locations.length) {
            setMessage('Add at least one media folder.');
            return;
        }
        if (optionsQuery.isError || !optionsQuery.data) {
            setMessage('Library defaults could not be verified. Retry before creating this library.');
            return;
        }
        busyRef.current = true;
        setBusy(true);
        setMessage('');
        try {
            const created = await createAdminLibrary(api, {
                collectionType,
                locations,
                name
            }, optionsQuery.data);
            clear();
            onCreated(created?.ItemId || null);
        } catch (error) {
            setMessage(safeLibraryMutationMessage(error, 'We could not create this library.'));
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }, [api, busy, clear, collectionType, locations, name, onCreated, optionsQuery.data, optionsQuery.isError]);

    return (
        <>
            <Dialog
                aria-labelledby='ptv-add-library-title'
                className='ptv-admin-library-dialog'
                fullWidth
                maxWidth='sm'
                onClose={close}
                open={open && !folderPickerOpen}
            >
                <DialogTitle id='ptv-add-library-title'>Add Library</DialogTitle>
                <DialogContent>
                    <form className='ptv-admin-library-dialog-form' id='ptv-add-library-form' onSubmit={submit}>
                        <p className='ptv-admin-library-status-message'>Connect one or more server folders. Advanced behavior can be adjusted after creation.</p>
                        <div className='ptv-admin-library-dialog-grid'>
                            <label className='ptv-admin-library-field'>
                                <span>Name</span>
                                <input autoComplete='off' onChange={event => setName(event.currentTarget.value)} required value={name} />
                            </label>
                            <label className='ptv-admin-library-field'>
                                <span>Content type</span>
                                <select onChange={event => setCollectionType(event.currentTarget.value)} value={collectionType}>
                                    {COLLECTION_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                                </select>
                            </label>
                        </div>
                        <fieldset className='ptv-admin-library-field'>
                            <legend>Media folders</legend>
                            {locations.length > 0 ? (
                                <div className='ptv-admin-library-path-list'>
                                    {locations.map(path => (
                                        <div className='ptv-admin-library-path-row' key={path}>
                                            <code title={path}>{path}</code>
                                            <button aria-label={`Remove ${path}`} onClick={() => setLocations(current => current.filter(value => value !== path))} type='button'>Remove</button>
                                        </div>
                                    ))}
                                </div>
                            ) : <p className='ptv-admin-library-status-message'>No folders added yet.</p>}
                            <button onClick={() => setFolderPickerOpen(true)} type='button'>
                                <PtvIcon name='folders' size='16px' />
                                Add Folder
                            </button>
                        </fieldset>
                        {optionsQuery.isPending && <p role='status' className='ptv-admin-library-status-message'>Loading safe library defaults…</p>}
                        {optionsQuery.isError && <p className='ptv-admin-library-status-message is-error'>Library defaults are unavailable. No library can be created.</p>}
                        {message && <p aria-live='polite' className='ptv-admin-library-status-message is-error'>{message}</p>}
                    </form>
                </DialogContent>
                <DialogActions className='ptv-admin-library-dialog-actions'>
                    {optionsQuery.isError && <button disabled={busy} onClick={() => void optionsQuery.refetch()} type='button'>Retry defaults</button>}
                    <button disabled={busy} onClick={close} type='button'>Cancel</button>
                    <button className='is-primary' disabled={busy || optionsQuery.isPending || optionsQuery.isError} form='ptv-add-library-form' type='submit'>
                        {busy ? 'Creating…' : 'Create Library'}
                    </button>
                </DialogActions>
            </Dialog>
            <AdminLibraryFolderPicker
                api={api}
                onCancel={() => setFolderPickerOpen(false)}
                onSelect={addLocation}
                open={folderPickerOpen}
                suggestedPaths={suggestedPaths}
            />
        </>
    );
}

/* eslint-enable react/jsx-no-bind, no-void, sonarjs/no-nested-functions */
