import type { LibraryOptions } from '@jellyfin/sdk/lib/generated-client/models/library-options';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import ConfirmDialog from '../../../../../components/ConfirmDialog';
import { useApi } from '../../../../../hooks/useApi';
import PtvIcon from '../../../icons/PtvIcon';
import { getPtvAdminDestination } from '../adminNavigation';
import { useAdminUnsavedChanges } from '../configuration/useAdminUnsavedChanges';
import {
    areAdminLibraryOptionsEqual,
    areAdminLibraryProvidersEqual,
    buildAdminLibraryOptionsPatch,
    normalizeAdminLibraryOptions,
    normalizeAdminLibraryProviders
} from './adminLibrariesAdapters';
import type {
    AdminLibraryOptionsForm,
    AdminLibraryProviderChoice,
    AdminLibraryProviderSummary
} from './adminLibrariesModel';
import {
    addAdminLibraryPath,
    AdminLibrariesServiceError,
    removeAdminLibrary,
    removeAdminLibraryPath,
    renameAdminLibrary,
    startAdminLibraryScan,
    updateAdminLibraryOptions,
    updateAdminLibraryProviders
} from './adminLibrariesService';
import { AdminLibraryFolderPicker } from './AdminLibraryDialogs';
import {
    AdminLibraryBadge,
    AdminLibraryScanBadge,
    AdminLibraryTypeIcon,
    formatAdminLibraryFolderCount
} from './AdminLibraryPresentation';
import {
    ADMIN_LIBRARY_SCAN_OBSERVATION_MS,
    useAdminLibrary
} from './useAdminLibraries';
import PtvHomeTransitionRebind from './PtvHomeTransitionRebind';

/* eslint-disable react/jsx-no-bind, jsx-a11y/label-has-associated-control, no-void, no-nested-ternary, sonarjs/no-nested-conditional, sonarjs/cognitive-complexity */

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'unresolved';

const LIBRARY_METADATA_ROUTE = getPtvAdminDestination('library-metadata')?.href;
const LIBRARY_NFO_ROUTE = getPtvAdminDestination('nfo-settings')?.href;
const METADATA_MANAGER_ROUTE = getPtvAdminDestination('metadata-manager')?.href;

function LibrarySaveState({ message, state }: Readonly<{ message: string; state: SaveState }>) {
    if (state === 'unresolved') return <span role='status'>Jellyfin accepted the change. Library authority is unresolved; Home library rows remain held. Reload the library list before continuing.</span>;
    if (state === 'idle') return null;
    const text = state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'conflict' ?
        'This library changed on the server. Reload it before saving.' : message;
    const isError = state === 'error' || state === 'conflict';
    return <p aria-live='polite' className={`ptv-admin-library-status-message${isError ? ' is-error' : state === 'saved' ? ' is-success' : ''}`}>{text}</p>;
}

function LibraryOptionToggle({
    disabled,
    label,
    onChange,
    value,
    description
}: Readonly<{
    description: string;
    disabled?: boolean;
    label: string;
    onChange: (value: boolean) => void;
    value: boolean | null;
}>) {
    if (value === null) return null;
    return (
        <label className='ptv-admin-library-toggle'>
            <span><strong>{label}</strong><small>{description}</small></span>
            <input checked={value} disabled={disabled} onChange={event => onChange(event.currentTarget.checked)} role='switch' type='checkbox' />
        </label>
    );
}

function LibraryArtworkStorage({
    onChange,
    value
}: Readonly<{
    onChange: (value: boolean) => void;
    value: boolean | null;
}>) {
    if (value === null) return null;
    return (
        <div aria-label='Artwork storage' className='ptv-admin-library-artwork-storage' role='radiogroup'>
            <strong>Artwork storage</strong>
            <div className='ptv-admin-library-storage-options'>
                <label data-selected={!value}>
                    <input checked={!value} name='ptv-library-artwork-storage' onChange={() => onChange(false)} type='radio' />
                    <span>
                        <strong>Jellyfin data folder</strong>
                        <small>Keep downloaded artwork in Jellyfin-managed metadata storage.</small>
                    </span>
                </label>
                <label data-selected={value}>
                    <input checked={value} name='ptv-library-artwork-storage' onChange={() => onChange(true)} type='radio' />
                    <span>
                        <strong>Media folders</strong>
                        <small>Save artwork beside the media. Jellyfin needs write access to the folder, including a mounted ZFS dataset.</small>
                    </span>
                </label>
            </div>
        </div>
    );
}

function LibraryProviderChoices({
    choices,
    confirmedChoices,
    description,
    label,
    onChange
}: Readonly<{
    choices: readonly AdminLibraryProviderChoice[];
    confirmedChoices?: readonly AdminLibraryProviderChoice[];
    description: string;
    label: string;
    onChange: (name: string, enabled: boolean) => void;
}>) {
    if (!choices.length) return null;
    return (
        <div className='ptv-admin-library-provider-category'>
            <h3>{label}</h3>
            <div className='ptv-admin-library-provider-choices'>
                {choices.map(choice => (
                    <label
                        className={!choice.available ? 'is-unavailable' : undefined}
                        data-selected={choice.enabled}
                        key={choice.name}
                    >
                        <input
                            checked={choice.enabled}
                            disabled={!choice.available && !choice.enabled && !confirmedChoices?.some(
                                confirmedChoice => confirmedChoice.name === choice.name && confirmedChoice.enabled
                            )}
                            onChange={event => onChange(choice.name, event.currentTarget.checked)}
                            type='checkbox'
                        />
                        <span>
                            {choice.name}
                            {!choice.available ? <small>Not currently available</small> : null}
                        </span>
                    </label>
                ))}
            </div>
            <small>{description}</small>
        </div>
    );
}

function formatProviderMediaType(value: string) {
    return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function updateProviderChoice(
    current: AdminLibraryProviderSummary,
    mediaType: string,
    field: 'imageProviders' | 'metadataProviders',
    providerName: string,
    enabled: boolean
): AdminLibraryProviderSummary {
    return {
        ...current,
        groups: current.groups.map(group => group.mediaType === mediaType ? {
            ...group,
            [field]: group[field].map(choice => (
                choice.name === providerName ? { ...choice, enabled } : choice
            ))
        } : group)
    };
}

function updateMetadataSaverChoice(
    current: AdminLibraryProviderSummary,
    providerName: string,
    enabled: boolean
): AdminLibraryProviderSummary {
    return {
        ...current,
        metadataSavers: current.metadataSavers.map(choice => (
            choice.name === providerName ? { ...choice, enabled } : choice
        ))
    };
}

export default function PtvAdminLibraryDetail({ libraryId }: Readonly<{ libraryId: string }>) {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const navigate = useNavigate();
    const state = useAdminLibrary(api, apiClient, libraryId);
    const detail = state.detail;
    const hydratedId = useRef('');
    const providerHydratedId = useRef('');
    const confirmedProviderOptionsRef = useRef<LibraryOptions | null>(null);
    const mutationBusyRef = useRef(false);
    const scanBusyRef = useRef(false);
    const scanAbortRef = useRef<AbortController | null>(null);
    const scanObservedRunningRef = useRef(false);
    const scanRequestedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const removeBusyRef = useRef(false);
    const pathBusyRef = useRef(false);
    const [ name, setName ] = useState('');
    const [ confirmedName, setConfirmedName ] = useState('');
    const [ options, setOptions ] = useState<AdminLibraryOptionsForm | null>(null);
    const [ confirmedOptions, setConfirmedOptions ] = useState<AdminLibraryOptionsForm | null>(null);
    const [ providers, setProviders ] = useState<AdminLibraryProviderSummary | null>(null);
    const [ confirmedProviders, setConfirmedProviders ] = useState<AdminLibraryProviderSummary | null>(null);
    const [ generalState, setGeneralState ] = useState<SaveState>('idle');
    const [ optionsState, setOptionsState ] = useState<SaveState>('idle');
    const [ providersState, setProvidersState ] = useState<SaveState>('idle');
    const [ actionMessage, setActionMessage ] = useState('');
    const [ scanBusy, setScanBusy ] = useState(false);
    const [ scanRequested, setScanRequested ] = useState(false);
    const [ pathBusy, setPathBusy ] = useState(false);
    const [ pickerOpen, setPickerOpen ] = useState(false);
    const [ pathToRemove, setPathToRemove ] = useState<string | null>(null);
    const [ removeOpen, setRemoveOpen ] = useState(false);
    const [ removeBusy, setRemoveBusy ] = useState(false);
    const [ suppressPrompt, setSuppressPrompt ] = useState(false);

    useEffect(() => () => {
        scanAbortRef.current?.abort();
        scanAbortRef.current = null;
        if (scanRequestedTimerRef.current) globalThis.clearTimeout(scanRequestedTimerRef.current);
        scanRequestedTimerRef.current = null;
        scanBusyRef.current = false;
        scanObservedRunningRef.current = false;
    }, []);

    useEffect(() => {
        if (!detail || hydratedId.current === detail.id) return;
        hydratedId.current = detail.id || libraryId;
        setName(detail.name);
        setConfirmedName(detail.name);
        setOptions(detail.options ? { ...detail.options } : null);
        setConfirmedOptions(detail.options ? { ...detail.options } : null);
    }, [detail, libraryId]);

    useEffect(() => {
        if (detail?.scanState === 'running') {
            scanObservedRunningRef.current = true;
            return;
        }
        if (!scanObservedRunningRef.current || detail?.scanState !== 'idle') return;
        scanObservedRunningRef.current = false;
        setScanRequested(false);
        if (scanRequestedTimerRef.current) globalThis.clearTimeout(scanRequestedTimerRef.current);
        scanRequestedTimerRef.current = null;
    }, [detail?.scanState]);

    useEffect(() => {
        if (
            !detail?.providerSummary
            || !detail.rawOptions
            || state.providerLoading
            || state.providerError
        ) return;
        const identity = detail.id || libraryId;
        if (providerHydratedId.current === identity) return;
        providerHydratedId.current = identity;
        setProviders(detail.providerSummary);
        setConfirmedProviders(detail.providerSummary);
        confirmedProviderOptionsRef.current = detail.rawOptions;
    }, [detail, libraryId, state.providerError, state.providerLoading]);

    const nameDirty = Boolean(detail && name.trim() !== confirmedName);
    const optionsDirty = Boolean(
        options && confirmedOptions && !areAdminLibraryOptionsEqual(options, confirmedOptions)
    );
    const providersDirty = Boolean(
        providers && confirmedProviders && !areAdminLibraryProvidersEqual(providers, confirmedProviders)
    );
    const mutationBusy = Boolean(state.transition?.held) || generalState === 'unresolved' || optionsState === 'unresolved' || providersState === 'unresolved' || generalState === 'saving'
        || optionsState === 'saving'
        || providersState === 'saving';
    const dirty = nameDirty || optionsDirty || providersDirty;
    useAdminUnsavedChanges(
        dirty,
        'Leave without saving your library changes?',
        dirty && !suppressPrompt
    );

    const setOption = useCallback(<K extends keyof AdminLibraryOptionsForm>(field: K, value: boolean) => {
        setOptions(current => current ? { ...current, [field]: value } : current);
        setOptionsState(current => current === 'conflict' ? current : 'idle');
    }, []);
    const setProvider = useCallback((
        mediaType: string,
        field: 'imageProviders' | 'metadataProviders',
        providerName: string,
        enabled: boolean
    ) => {
        setProviders(current => current ?
            updateProviderChoice(current, mediaType, field, providerName, enabled) : current);
        setProvidersState(current => current === 'conflict' ? current : 'idle');
    }, []);
    const setMetadataSaver = useCallback((providerName: string, enabled: boolean) => {
        setProviders(current => current ?
            updateMetadataSaverChoice(current, providerName, enabled) : current);
        setProvidersState(current => current === 'conflict' ? current : 'idle');
    }, []);
    const saveName = useCallback(async () => {
        if (!api || !detail || mutationBusyRef.current || !nameDirty) return;
        mutationBusyRef.current = true;
        setGeneralState('saving');
        try {
            const saved = await renameAdminLibrary(api, libraryId, name, confirmedName);
            if (!saved?.ItemId) {
                setGeneralState('unresolved');
                void state.refreshTransition?.();
                return;
            }
            if (saved.ItemId !== libraryId) {
                await state.invalidate();
                navigate(`/settings/admin/libraries/${encodeURIComponent(saved.ItemId)}`, { replace: true });
                return;
            }
            await state.adoptLibrary(saved);
            void state.refreshTransition?.();
            const savedName = saved.Name?.trim() || name.trim();
            setConfirmedName(savedName);
            setName(savedName);
            setGeneralState('saved');
        } catch (error) {
            setGeneralState(error instanceof AdminLibrariesServiceError && error.code === 'conflict' ?
                'conflict' : 'error');
        } finally {
            void state.refreshTransition?.();
            mutationBusyRef.current = false;
        }
    }, [api, confirmedName, detail, libraryId, name, nameDirty, navigate, state]);
    const saveOptions = useCallback(async () => {
        if (!api || !detail || !options || !confirmedOptions || mutationBusyRef.current || !optionsDirty) return;
        mutationBusyRef.current = true;
        setOptionsState('saving');
        try {
            const patch = buildAdminLibraryOptionsPatch(options, confirmedOptions);
            const saved = await updateAdminLibraryOptions(
                api,
                libraryId,
                patch,
                confirmedOptions
            );
            if (!saved?.ItemId) {
                setOptionsState('unresolved');
                void state.refreshTransition?.();
                return;
            }
            await state.adoptLibrary(saved);
            void state.refreshTransition?.();
            const savedOptions = normalizeAdminLibraryOptions(saved.LibraryOptions!);
            setOptions({ ...savedOptions });
            setConfirmedOptions({ ...savedOptions });
            if (!providersDirty && providers && saved.LibraryOptions) {
                const savedProviders = normalizeAdminLibraryProviders(
                    saved.LibraryOptions,
                    state.providerOptions
                );
                setProviders(savedProviders);
                setConfirmedProviders(savedProviders);
                confirmedProviderOptionsRef.current = saved.LibraryOptions;
            }
            setOptionsState('saved');
        } catch (error) {
            setOptionsState(error instanceof AdminLibrariesServiceError && error.code === 'conflict' ?
                'conflict' : 'error');
        } finally {
            void state.refreshTransition?.();
            mutationBusyRef.current = false;
        }
    }, [api, confirmedOptions, detail, libraryId, options, optionsDirty, providers, providersDirty, state]);
    const saveProviders = useCallback(async () => {
        const confirmedProviderOptions = confirmedProviderOptionsRef.current;
        if (
            !api
            || !detail
            || !providers
            || !confirmedProviders
            || !confirmedProviderOptions
            || mutationBusyRef.current
            || !providersDirty
        ) return;
        mutationBusyRef.current = true;
        setProvidersState('saving');
        try {
            const saved = await updateAdminLibraryProviders(
                api,
                libraryId,
                providers,
                confirmedProviders,
                confirmedProviderOptions
            );
            if (!saved?.ItemId) {
                setProvidersState('unresolved');
                void state.refreshTransition?.();
                return;
            }
            await state.adoptLibrary(saved);
            void state.refreshTransition?.();
            const savedProviders = normalizeAdminLibraryProviders(
                saved.LibraryOptions!,
                state.providerOptions
            );
            setProviders(savedProviders);
            setConfirmedProviders(savedProviders);
            confirmedProviderOptionsRef.current = saved.LibraryOptions!;
            if (!optionsDirty) {
                const savedOptions = normalizeAdminLibraryOptions(saved.LibraryOptions!);
                setOptions({ ...savedOptions });
                setConfirmedOptions({ ...savedOptions });
            }
            setProvidersState('saved');
        } catch (error) {
            setProvidersState(error instanceof AdminLibrariesServiceError && error.code === 'conflict' ?
                'conflict' : 'error');
        } finally {
            void state.refreshTransition?.();
            mutationBusyRef.current = false;
        }
    }, [api, confirmedProviders, detail, libraryId, optionsDirty, providers, providersDirty, state]);
    const addPath = useCallback(async (path: string) => {
        if (!api || pathBusyRef.current) return;
        pathBusyRef.current = true;
        setPathBusy(true);
        setPickerOpen(false);
        setActionMessage('');
        try {
            await addAdminLibraryPath(api, libraryId, path);
            setActionMessage('Media folder added. Scan the library when you are ready.');
            await state.invalidate();
        } catch {
            setActionMessage('We could not add that media folder.');
        } finally {
            void state.refreshTransition?.();
            pathBusyRef.current = false;
            setPathBusy(false);
        }
    }, [api, libraryId, state]);
    const confirmRemovePath = useCallback(async () => {
        if (!api || !pathToRemove || pathBusyRef.current) return;
        pathBusyRef.current = true;
        setPathBusy(true);
        setActionMessage('');
        try {
            await removeAdminLibraryPath(api, libraryId, pathToRemove);
            setPathToRemove(null);
            setActionMessage('Media folder removed from this library.');
            await state.invalidate();
        } catch {
            setActionMessage('We could not remove that media folder.');
        } finally {
            void state.refreshTransition?.();
            pathBusyRef.current = false;
            setPathBusy(false);
        }
    }, [api, libraryId, pathToRemove, state]);
    const scanLibrary = useCallback(async () => {
        if (
            !api
            || scanBusyRef.current
            || scanRequested
            || (!state.scanStatusError && detail?.scanState === 'running')
        ) return;
        const controller = new globalThis['AbortController']();
        scanAbortRef.current = controller;
        scanObservedRunningRef.current = false;
        scanBusyRef.current = true;
        setScanBusy(true);
        setActionMessage('');
        try {
            await startAdminLibraryScan(api, libraryId, controller.signal);
            if (controller.signal.aborted) return;
            setScanRequested(true);
            if (scanRequestedTimerRef.current) globalThis.clearTimeout(scanRequestedTimerRef.current);
            scanRequestedTimerRef.current = globalThis.setTimeout(() => {
                scanRequestedTimerRef.current = null;
                setScanRequested(false);
            }, ADMIN_LIBRARY_SCAN_OBSERVATION_MS);
            setActionMessage('Library scan started.');
            state.beginScanObservation();
        } catch (error) {
            if (controller.signal.aborted) return;
            scanObservedRunningRef.current = false;
            setActionMessage(error instanceof AdminLibrariesServiceError ?
                error.message : 'The library scan could not be started.');
            if (error instanceof AdminLibrariesServiceError && error.code === 'scan-not-found') {
                void state.invalidate();
            }
        } finally {
            if (scanAbortRef.current === controller) {
                scanAbortRef.current = null;
                scanBusyRef.current = false;
                setScanBusy(false);
            }
        }
    }, [api, detail?.scanState, libraryId, scanRequested, state]);
    const confirmRemoveLibrary = useCallback(async () => {
        if (!api || !detail || removeBusyRef.current) return;
        removeBusyRef.current = true;
        setRemoveBusy(true);
        setActionMessage('');
        try {
            await removeAdminLibrary(api, libraryId, detail.name);
            setSuppressPrompt(true);
            setConfirmedName(name.trim());
            if (options) setConfirmedOptions({ ...options });
            await state.invalidate();
            state.removeCachedDetail();
            navigate('/settings/admin/libraries', { replace: true });
        } catch {
            setRemoveOpen(false);
            setActionMessage(`We could not remove ${detail.name}.`);
            setRemoveBusy(false);
        } finally {
            removeBusyRef.current = false;
        }
    }, [api, detail, libraryId, name, navigate, options, state]);
    const providerGroups = providers?.groups || [];
    const metadataSavers = providers?.metadataSavers || [];
    const hasProviderChoices = metadataSavers.length > 0 || providerGroups.some(group => (
        group.metadataProviders.length > 0 || group.imageProviders.length > 0
    ));

    if (state.loading) {
        return <>
            <div className='ptv-admin-library-detail-loading' role='status'>Loading library…</div>
            <PtvHomeTransitionRebind api={api} onChanged={() => { void state.refreshTransition(); }} transition={state.transition} transitionError={state.transitionError} />
        </>;
    }
    if (state.error || !detail) {
        return (
            <section className='ptv-admin-libraries-error' role='alert'>
                <PtvIcon name='alerts' size='30px' />
                <h1>Library unavailable</h1>
                <PtvHomeTransitionRebind api={api} onChanged={() => { void state.refreshTransition(); }} transition={state.transition} transitionError={state.transitionError} />
                <p>This library may have moved or changed on the server.</p>
                <button onClick={() => void state.refetch()} type='button'>Retry</button>
                <Link className='ptv-admin-library-button' to='/settings/admin/libraries'>Back to Libraries</Link>
            </section>
        );
    }

    return (
        <section className='ptv-admin-libraries ptv-admin-library-detail' data-testid='ptv-admin-library-detail'>
            <Link className='ptv-admin-library-detail-back' to='/settings/admin/libraries'>
                <PtvIcon name='back' size='17px' />
                Libraries
            </Link>
            <header className='ptv-admin-library-detail-header'>
                <div className='ptv-admin-library-detail-title'>
                    <AdminLibraryTypeIcon icon={detail.icon} large />
                    <div><h1>{detail.name}</h1><p>{detail.displayType} · {formatAdminLibraryFolderCount(detail.folderCount)}</p></div>
                </div>
                <div className='ptv-admin-library-badges'>
                    <AdminLibraryScanBadge
                        progress={detail.refreshProgress}
                        state={state.scanStatusError ? 'unavailable' : detail.scanState === 'running' ?
                            'running' : scanRequested ? 'requested' : detail.scanState}
                    />
                    {!detail.pathManagementSupported && <AdminLibraryBadge tone='info'>Managed by server</AdminLibraryBadge>}
                </div>
            </header>
            <PtvHomeTransitionRebind api={api} onChanged={() => { void state.refreshTransition(); }} transition={state.transition} transitionError={state.transitionError} />
            {actionMessage && <p aria-live='polite' className={`ptv-admin-library-status-message${/could not/i.test(actionMessage) ? ' is-error' : ' is-success'}`}>{actionMessage}</p>}
            {state.scanStatusError && (
                <p aria-live='polite' className='ptv-admin-library-status-message is-error'>
                    Current scan status is temporarily unavailable. The last confirmed library data remains visible.
                </p>
            )}

            <div className='ptv-admin-library-detail-grid'>
                <section className='ptv-admin-library-section'>
                    <header><h2>General</h2><p>Name and server-defined content type.</p></header>
                    <div className='ptv-admin-library-section-body'>
                        <label className='ptv-admin-library-field'>
                            <span>Library name</span>
                            <input disabled={mutationBusy} onChange={event => {
                                setName(event.currentTarget.value);
                                setGeneralState(current => current === 'conflict' ? current : 'idle');
                            }} value={name} />
                        </label>
                        <label className='ptv-admin-library-field'>
                            <span>Content type</span>
                            <input readOnly value={detail.displayType} />
                            <small>Content type is fixed after a library is created.</small>
                        </label>
                        <div className='ptv-admin-library-section-actions'>
                            <LibrarySaveState message={`We couldn't rename ${detail.name}.`} state={generalState} />
                            <button className='is-primary' disabled={!nameDirty || !name.trim() || mutationBusy || generalState === 'conflict'} onClick={() => void saveName()} type='button'>Save name</button>
                        </div>
                    </div>
                </section>

                <section className='ptv-admin-library-section'>
                    <header><h2>Library Behavior</h2><p>Everyday behavior for this media source.</p></header>
                    <fieldset className='ptv-admin-library-section-body' disabled={!options || mutationBusy}>
                        {options ? (
                            <>
                                <LibraryOptionToggle description='Make this library available to PiggieTV clients.' label='Library enabled' onChange={value => setOption('enabled', value)} value={options.enabled} />
                                <LibraryOptionToggle description='Watch supported server folders for new media.' label='Watch folders for new media' onChange={value => setOption('realTimeMonitoring', value)} value={options.realTimeMonitoring} />
                                {detail.kind === 'home-videos' ? <LibraryOptionToggle description='Include supported photo files in this library.' label='Include photos' onChange={value => setOption('photos', value)} value={options.photos} /> : null}
                                <details className='ptv-admin-library-advanced'>
                                    <summary>Advanced Library Options</summary>
                                    <div className='ptv-admin-library-advanced-content'>
                                        {detail.kind === 'shows' && <LibraryOptionToggle description='Group series found across multiple folders.' label='Automatically group series' onChange={value => setOption('automaticSeriesGrouping', value)} value={options.automaticSeriesGrouping} />}
                                        {detail.kind === 'movies' || detail.kind === 'mixed' ? <LibraryOptionToggle description='Add matching movies to server collections automatically.' label='Automatically add to collections' onChange={value => setOption('automaticallyAddToCollection', value)} value={options.automaticallyAddToCollection} /> : null}
                                        {detail.kind === 'music' && <LibraryOptionToggle description='Analyze loudness during supported library scans.' label='Analyze music loudness' onChange={value => setOption('lufsAnalysis', value)} value={options.lufsAnalysis} />}
                                        {[ 'home-videos', 'mixed', 'movies', 'music-videos', 'shows' ].includes(detail.kind) && <LibraryOptionToggle description='Prefer supported embedded titles over file names.' label='Prefer embedded titles' onChange={value => setOption('embeddedTitles', value)} value={options.embeddedTitles} />}
                                        {[ 'home-videos', 'mixed', 'movies', 'music-videos', 'shows' ].includes(detail.kind) && <LibraryOptionToggle description='Use embedded titles for supported extras.' label='Prefer embedded extras titles' onChange={value => setOption('embeddedExtrasTitles', value)} value={options.embeddedExtrasTitles} />}
                                        {detail.kind === 'shows' && <LibraryOptionToggle description='Use supported embedded episode information.' label='Prefer embedded episode information' onChange={value => setOption('embeddedEpisodeInfo', value)} value={options.embeddedEpisodeInfo} />}
                                    </div>
                                </details>
                                <div className='ptv-admin-library-section-actions'>
                                    <LibrarySaveState message={`We couldn't save ${detail.name}'s behavior.`} state={optionsState} />
                                    <button className='is-primary' disabled={!optionsDirty || mutationBusy || optionsState === 'conflict'} onClick={() => void saveOptions()} type='button'>Save changes</button>
                                </div>
                                <p className='ptv-admin-library-status-message'>Some changes may apply after the next library scan.</p>
                            </>
                        ) : <p className='ptv-admin-library-status-message is-error'>Authoritative library options are unavailable. No options can be saved.</p>}
                    </fieldset>
                </section>

                <section className='ptv-admin-library-section is-wide'>
                    <header><h2>Folders</h2><p>Server paths connected to this library.</p></header>
                    <div className='ptv-admin-library-section-body'>
                        {detail.pathManagementSupported ? (
                            <>
                                {detail.locations.length > 0 ? (
                                    <div className='ptv-admin-library-path-list'>
                                        {detail.locations.map(path => (
                                            <div className='ptv-admin-library-path-row' key={path}>
                                                <code title={path}>{path}</code>
                                                <button aria-label={`Remove ${path}`} disabled={pathBusy} onClick={() => setPathToRemove(path)} type='button'>Remove</button>
                                            </div>
                                        ))}
                                    </div>
                                ) : <p className='ptv-admin-library-status-message'>No media folders were returned by the server.</p>}
                                <div><button disabled={pathBusy} onClick={() => setPickerOpen(true)} type='button'><PtvIcon name='folders' size='16px' /> Add Folder</button></div>
                            </>
                        ) : <p className='ptv-admin-library-status-message'>Folders for Collections are managed by the server.</p>}
                    </div>
                </section>

                <section className='ptv-admin-library-section is-wide' id='ptv-admin-library-metadata'>
                    <header><h2>Metadata</h2><p>Provider choices for this library.</p></header>
                    <fieldset className='ptv-admin-library-section-body' disabled={mutationBusy}>
                        {!detail.rawOptions ? (
                            <p className='ptv-admin-library-status-message is-error'>Authoritative library options are unavailable, so provider settings cannot be shown.</p>
                        ) : state.providerLoading ? <p role='status' className='ptv-admin-library-status-message'>Loading providers…</p> : state.providerError ? (
                            <div className='ptv-admin-library-provider-error'>
                                <p>Metadata provider settings are temporarily unavailable.</p>
                                <button onClick={() => void state.refetchProviders()} type='button'>Retry providers</button>
                            </div>
                        ) : providers && hasProviderChoices ? (
                            <>
                                <div className='ptv-admin-library-provider-list'>
                                    {metadataSavers.length > 0 && (
                                        <fieldset className='ptv-admin-library-provider-group'>
                                            <legend>Metadata files</legend>
                                            <LibraryProviderChoices
                                                choices={metadataSavers}
                                                confirmedChoices={confirmedProviders?.metadataSavers}
                                                description='Choose which sidecar formats this library may write.'
                                                label='Metadata writers'
                                                onChange={setMetadataSaver}
                                            />
                                        </fieldset>
                                    )}
                                    {providerGroups.map(group => (
                                        <fieldset className='ptv-admin-library-provider-group' key={group.mediaType}>
                                            <legend>{formatProviderMediaType(group.mediaType)}</legend>
                                            <LibraryProviderChoices
                                                choices={group.metadataProviders}
                                                confirmedChoices={confirmedProviders?.groups.find(
                                                    confirmedGroup => confirmedGroup.mediaType === group.mediaType
                                                )?.metadataProviders}
                                                description='Lower entries fill information that higher-priority providers leave missing.'
                                                label='Metadata downloaders'
                                                onChange={(providerName, enabled) => setProvider(group.mediaType, 'metadataProviders', providerName, enabled)}
                                            />
                                            <LibraryProviderChoices
                                                choices={group.imageProviders}
                                                confirmedChoices={confirmedProviders?.groups.find(
                                                    confirmedGroup => confirmedGroup.mediaType === group.mediaType
                                                )?.imageProviders}
                                                description='Enabled image providers are tried in the displayed priority order.'
                                                label='Image providers'
                                                onChange={(providerName, enabled) => setProvider(group.mediaType, 'imageProviders', providerName, enabled)}
                                            />
                                        </fieldset>
                                    ))}
                                </div>
                                <div className='ptv-admin-library-section-actions'>
                                    <LibrarySaveState message={`We couldn't save ${detail.name}'s providers.`} state={providersState} />
                                    <button className='is-primary' disabled={!providersDirty || mutationBusy || providersState === 'conflict'} onClick={() => void saveProviders()} type='button'>Save providers</button>
                                </div>
                            </>
                        ) : <p className='ptv-admin-library-status-message'>No provider details were returned for this library type.</p>}
                        <div className='ptv-admin-library-related-links'>
                            {LIBRARY_METADATA_ROUTE ? <Link className='ptv-admin-library-button' to={LIBRARY_METADATA_ROUTE}>Metadata Settings</Link> : null}
                            {METADATA_MANAGER_ROUTE ? <Link className='ptv-admin-library-button' to={METADATA_MANAGER_ROUTE}>Metadata Manager</Link> : null}
                            {LIBRARY_NFO_ROUTE ? <Link className='ptv-admin-library-button' to={LIBRARY_NFO_ROUTE}>NFO Settings</Link> : null}
                        </div>
                    </fieldset>
                </section>

                <section className='ptv-admin-library-section'>
                    <header><h2>Images &amp; Extraction</h2><p>Library-specific visual processing.</p></header>
                    <fieldset className='ptv-admin-library-section-body' disabled={!options || mutationBusy}>
                        {options ? (
                            <>
                                <LibraryArtworkStorage onChange={value => setOption('saveLocalMetadata', value)} value={options.saveLocalMetadata} />
                                {[ 'home-videos', 'mixed', 'movies', 'music-videos', 'shows' ].includes(detail.kind) ? <>
                                    <LibraryOptionToggle description='Create seek-preview images for supported videos.' label='Generate trickplay images' onChange={value => setOption('trickplayImages', value)} value={options.trickplayImages} />
                                    <LibraryOptionToggle description='Generate trickplay images during a library scan.' label='Generate trickplay during scans' onChange={value => setOption('trickplayImagesDuringScan', value)} value={options.trickplayImagesDuringScan} />
                                    <LibraryOptionToggle description='Store generated trickplay data with the media when possible.' label='Save trickplay with media' onChange={value => setOption('saveTrickplayWithMedia', value)} value={options.saveTrickplayWithMedia} />
                                    <LibraryOptionToggle description='Create chapter thumbnails for supported videos.' label='Generate chapter images' onChange={value => setOption('chapterImages', value)} value={options.chapterImages} />
                                    <LibraryOptionToggle description='Generate chapter thumbnails during scans.' label='Generate chapter images during scans' onChange={value => setOption('chapterImagesDuringScan', value)} value={options.chapterImagesDuringScan} />
                                </> : <p className='ptv-admin-library-status-message'>Extraction controls do not apply to this library type.</p>}
                                <div className='ptv-admin-library-section-actions'>
                                    <LibrarySaveState message={`We couldn't save ${detail.name}'s image settings.`} state={optionsState} />
                                    <button className='is-primary' disabled={!optionsDirty || mutationBusy || optionsState === 'conflict'} onClick={() => void saveOptions()} type='button'>Save changes</button>
                                </div>
                            </>
                        ) : <p className='ptv-admin-library-status-message is-error'>Image options are unavailable. No changes can be saved.</p>}
                    </fieldset>
                </section>

                <section className='ptv-admin-library-section'>
                    <header><h2>Maintenance</h2><p>Scanning is always an explicit action.</p></header>
                    <div className='ptv-admin-library-section-body'>
                        <p className='ptv-admin-library-status-message'>Scan for new and updated files without replacing existing metadata.</p>
                        <div><button disabled={scanBusy || scanRequested || (!state.scanStatusError && detail.scanState === 'running')} onClick={() => void scanLibrary()} type='button'><PtvIcon name='refresh' size='16px' /> {scanBusy ? 'Starting…' : scanRequested || (!state.scanStatusError && detail.scanState === 'running') ? 'Scanning…' : 'Scan Library'}</button></div>
                    </div>
                </section>

                <section className='ptv-admin-library-section is-danger'>
                    <header><h2>Danger Zone</h2><p>Removal changes server library configuration.</p></header>
                    <div className='ptv-admin-library-section-body'>
                        {detail.removable ? (
                            <>
                                <p className='ptv-admin-library-status-message'>Remove this library configuration from the server.</p>
                                <div><button className='is-danger' onClick={() => setRemoveOpen(true)} type='button'>Remove Library</button></div>
                            </>
                        ) : <p className='ptv-admin-library-status-message'>This server-managed Collections library cannot be removed here.</p>}
                    </div>
                </section>
            </div>

            <AdminLibraryFolderPicker
                api={api}
                onCancel={() => setPickerOpen(false)}
                onSelect={addPath}
                open={pickerOpen}
                suggestedPaths={state.configuredLocations.length > 0 ? state.configuredLocations : detail.locations}
            />
            <ConfirmDialog
                confirmButtonColor='error'
                confirmButtonText={pathBusy ? 'Removing…' : 'Remove folder'}
                onCancel={() => { if (!pathBusy) setPathToRemove(null); }}
                onConfirm={() => void confirmRemovePath()}
                open={Boolean(pathToRemove)}
                text={`This removes ${pathToRemove || 'the selected path'} from the library configuration. It does not browse or modify the filesystem.`}
                title='Remove this media folder?'
            />
            <ConfirmDialog
                confirmButtonColor='error'
                confirmButtonText={removeBusy ? 'Removing…' : 'Remove library'}
                onCancel={() => { if (!removeBusy) setRemoveOpen(false); }}
                onConfirm={() => void confirmRemoveLibrary()}
                open={removeOpen}
                text='This removes the library configuration from the server. This action cannot be undone from PiggieTV.'
                title={`Remove ${detail.name}?`}
            />
        </section>
    );
}

/* eslint-enable react/jsx-no-bind, jsx-a11y/label-has-associated-control, no-void, no-nested-ternary, sonarjs/no-nested-conditional, sonarjs/cognitive-complexity */
