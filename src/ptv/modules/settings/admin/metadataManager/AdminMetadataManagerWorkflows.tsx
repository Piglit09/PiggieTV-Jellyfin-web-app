import Dialog from '@mui/material/Dialog/Dialog';
import DialogActions from '@mui/material/DialogActions/DialogActions';
import DialogContent from '@mui/material/DialogContent/DialogContent';
import DialogContentText from '@mui/material/DialogContentText/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle/DialogTitle';
import type { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import PtvIcon from '../../../icons/PtvIcon';
import type {
    AdminMetadataArtwork,
    AdminMetadataIdentifyQuery,
    AdminMetadataIdentifyResult,
    AdminMetadataProviderField,
    AdminMetadataRefreshMode,
    AdminMetadataRemoteImage,
    AdminMetadataRemoteImagePage,
    AdminMetadataRemoteImageProvider
} from './adminMetadataManagerModel';

/* eslint-disable react/jsx-no-bind */

export type AdminMetadataManagerWorkflowTab = 'artwork' | 'identify' | 'refresh';

export type AdminMetadataRemoteArtworkSearch = Readonly<{
    imageType: ImageType;
    providerName?: string;
    startIndex: number;
}>;

export type AdminMetadataArtworkWorkflowProps = Readonly<{
    busy: boolean;
    error: string | null;
    images: readonly AdminMetadataArtwork[];
    loading: boolean;
    message: string | null;
    onDelete: (image: AdminMetadataArtwork) => Promise<void>;
    onLoadRemoteProviders: () => void;
    onReorder: (image: AdminMetadataArtwork, newIndex: number) => Promise<void>;
    onRetry: () => void;
    onRetryRemoteProviders: () => void;
    onSearchRemote: (search: AdminMetadataRemoteArtworkSearch) => void;
    onUpload: (file: File, imageType: ImageType) => Promise<void>;
    onUseRemote: (image: AdminMetadataRemoteImage, imageType: ImageType) => Promise<void>;
    remoteBusy: boolean;
    remoteError: string | null;
    remoteLoading: boolean;
    remotePage: AdminMetadataRemoteImagePage | null;
    remoteProviderError: string | null;
    remoteProviders: readonly AdminMetadataRemoteImageProvider[];
    remoteProvidersLoading: boolean;
    uploadImageTypes: readonly ImageType[];
}>;

export type AdminMetadataIdentifyWorkflowProps = Readonly<{
    applying: boolean;
    error: string | null;
    initialName: string;
    initialProviderIds: Readonly<Record<string, string | null>>;
    initialYear: number | null;
    message: string | null;
    onApply: (result: AdminMetadataIdentifyResult) => Promise<void>;
    onLoadProviders: () => void;
    onRetryProviders: () => void;
    onSearch: (query: AdminMetadataIdentifyQuery) => void;
    providerError: string | null;
    providerFields: readonly AdminMetadataProviderField[];
    providersLoading: boolean;
    results: readonly AdminMetadataIdentifyResult[];
    searching: boolean;
    supported: boolean;
}>;

export type AdminMetadataRefreshWorkflowProps = Readonly<{
    busy: boolean;
    canRecurse: boolean;
    error: string | null;
    message: string | null;
    onRefresh: (mode: AdminMetadataRefreshMode, recursive: boolean) => Promise<void>;
}>;

export type AdminMetadataManagerWorkflowsProps = Readonly<{
    activeTab: AdminMetadataManagerWorkflowTab;
    artwork: AdminMetadataArtworkWorkflowProps;
    identify: AdminMetadataIdentifyWorkflowProps;
    itemId: string;
    itemName: string;
    itemType: string;
    onTabChange: (tab: AdminMetadataManagerWorkflowTab) => void;
    refresh: AdminMetadataRefreshWorkflowProps;
    showTabs?: boolean;
}>;

type ConfirmationDialogProps = Readonly<{
    busy: boolean;
    confirmLabel: string;
    destructive?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
    open: boolean;
    text: string;
    title: string;
}>;

const REFRESH_MODES: ReadonlyArray<Readonly<{
    description: string;
    destructive: boolean;
    label: string;
    value: AdminMetadataRefreshMode;
}>> = [
    {
        description: 'Scan the item and use the server\'s normal metadata and artwork behavior.',
        destructive: false,
        label: 'Scan for changes',
        value: 'scan'
    },
    {
        description: 'Ask configured providers to fill metadata and artwork that is currently missing.',
        destructive: false,
        label: 'Find missing data',
        value: 'missing'
    },
    {
        description: 'Replace existing metadata with fresh provider results. Existing manual values may change.',
        destructive: true,
        label: 'Replace metadata',
        value: 'replace-metadata'
    },
    {
        description: 'Replace existing artwork with fresh provider results. Current images may change.',
        destructive: true,
        label: 'Replace artwork',
        value: 'replace-images'
    },
    {
        description: 'Replace both metadata and artwork. Existing manual values and current images may change.',
        destructive: true,
        label: 'Replace all metadata and artwork',
        value: 'replace-all'
    }
];

function WorkflowConfirmationDialog({
    busy,
    confirmLabel,
    destructive = false,
    onCancel,
    onConfirm,
    open,
    text,
    title
}: ConfirmationDialogProps) {
    return (
        <Dialog
            aria-labelledby='ptv-metadata-workflow-confirm-title'
            className='ptv-metadata-workflow-dialog'
            disableEscapeKeyDown={busy}
            fullWidth
            maxWidth='sm'
            onClose={() => !busy && onCancel()}
            open={open}
        >
            <DialogTitle id='ptv-metadata-workflow-confirm-title'>{title}</DialogTitle>
            <DialogContent>
                <DialogContentText>{text}</DialogContentText>
            </DialogContent>
            <DialogActions className='ptv-metadata-workflow-dialog-actions'>
                <button disabled={busy} onClick={onCancel} type='button'>Cancel</button>
                <button
                    className={destructive ? 'is-danger' : 'is-primary'}
                    disabled={busy}
                    onClick={onConfirm}
                    type='button'
                >
                    {busy ? 'Working...' : confirmLabel}
                </button>
            </DialogActions>
        </Dialog>
    );
}

function StatusMessage({ error, message }: Readonly<{ error: string | null; message: string | null }>) {
    if (error) return <p aria-live='assertive' className='ptv-metadata-workflow-message is-error' role='alert'>{error}</p>;
    if (message) return <p aria-live='polite' className='ptv-metadata-workflow-message is-success' role='status'>{message}</p>;
    return null;
}

function imageTypeLabel(value: ImageType) {
    return String(value).replace(/([a-z])([A-Z])/g, '$1 $2');
}

function imageDimensions(width: number | null, height: number | null) {
    return width && height ? `${width} x ${height}` : 'Dimensions unavailable';
}

function availableImageTypes(
    uploadTypes: readonly ImageType[],
    providers: readonly AdminMetadataRemoteImageProvider[]
) {
    return Array.from(new Set<ImageType>([
        ...uploadTypes,
        ...providers.flatMap(provider => provider.supportedImageTypes)
    ]));
}

function ArtworkWorkflow({ artwork }: Readonly<{ artwork: AdminMetadataArtworkWorkflowProps }>) {
    const [ deleteTarget, setDeleteTarget ] = useState<AdminMetadataArtwork | null>(null);
    const [ remoteOpen, setRemoteOpen ] = useState(false);
    const [ remoteProvider, setRemoteProvider ] = useState('');
    const [ remoteType, setRemoteType ] = useState<ImageType | ''>('');
    const [ uploadFile, setUploadFile ] = useState<File | null>(null);
    const [ uploadType, setUploadType ] = useState<ImageType | ''>('');
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const imageTypes = useMemo(
        () => availableImageTypes(artwork.uploadImageTypes, artwork.remoteProviders),
        [ artwork.remoteProviders, artwork.uploadImageTypes ]
    );
    const effectiveUploadType = uploadType || artwork.uploadImageTypes[0] || '';
    const effectiveRemoteType = remoteType || imageTypes[0] || '';

    const openRemoteSearch = () => {
        setRemoteOpen(true);
        artwork.onLoadRemoteProviders();
    };
    const searchRemote = (startIndex = 0) => {
        if (!effectiveRemoteType) return;
        artwork.onSearchRemote({
            imageType: effectiveRemoteType,
            providerName: remoteProvider || undefined,
            startIndex
        });
    };
    const upload = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!uploadFile || !effectiveUploadType || artwork.busy) return;
        artwork.onUpload(uploadFile, effectiveUploadType).then(() => {
            setUploadFile(null);
            if (uploadInputRef.current) uploadInputRef.current.value = '';
        }, () => undefined);
    };
    const confirmDelete = () => {
        if (!deleteTarget || artwork.busy) return;
        artwork.onDelete(deleteTarget).then(() => setDeleteTarget(null), () => undefined);
    };
    const typeGroups = useMemo(() => {
        const groups = new Map<ImageType, AdminMetadataArtwork[]>();
        artwork.images.forEach(image => {
            const group = groups.get(image.imageType) || [];
            group.push(image);
            groups.set(image.imageType, group);
        });
        return groups;
    }, [ artwork.images ]);

    return (
        <section aria-labelledby='ptv-metadata-artwork-title' className='ptv-metadata-workflow'>
            <header className='ptv-metadata-workflow-header'>
                <span className='ptv-metadata-workflow-icon'><PtvIcon name='image' size='22px' /></span>
                <div><h3 id='ptv-metadata-artwork-title'>Artwork</h3><p>Manage stored images or choose artwork from server-reported providers.</p></div>
            </header>
            <StatusMessage error={artwork.error} message={artwork.message} />

            <form className='ptv-metadata-artwork-upload' onSubmit={upload}>
                <label>
                    <span>Image type</span>
                    <select
                        disabled={artwork.busy || !artwork.uploadImageTypes.length}
                        onChange={event => setUploadType(event.currentTarget.value as ImageType)}
                        value={effectiveUploadType}
                    >
                        {!artwork.uploadImageTypes.length && <option value=''>Unavailable</option>}
                        {artwork.uploadImageTypes.map(type => <option key={type} value={type}>{imageTypeLabel(type)}</option>)}
                    </select>
                </label>
                <label className='ptv-metadata-artwork-file'>
                    <span>Image file</span>
                    <input
                        accept='image/*'
                        disabled={artwork.busy}
                        onChange={event => setUploadFile(event.currentTarget.files?.[0] || null)}
                        ref={uploadInputRef}
                        type='file'
                    />
                </label>
                <button className='is-primary' disabled={artwork.busy || !uploadFile || !effectiveUploadType} type='submit'>
                    <PtvIcon name='image' size='16px' />
                    {artwork.busy ? 'Uploading...' : 'Upload artwork'}
                </button>
                <button disabled={artwork.remoteBusy} onClick={openRemoteSearch} type='button'>
                    <PtvIcon name='search' size='16px' />
                    Search artwork
                </button>
            </form>

            <div aria-busy={artwork.loading} className='ptv-metadata-artwork-grid'>
                {artwork.loading && !artwork.images.length && <p role='status'>Loading artwork...</p>}
                {!artwork.loading && artwork.error && !artwork.images.length && (
                    <div className='ptv-metadata-inline-state' role='alert'>
                        <PtvIcon name='alerts' size='24px' />
                        <strong>Artwork unavailable</strong>
                        <button onClick={artwork.onRetry} type='button'>Retry</button>
                    </div>
                )}
                {!artwork.loading && !artwork.error && !artwork.images.length && (
                    <div className='ptv-metadata-inline-state'>
                        <PtvIcon name='image' size='24px' />
                        <strong>No artwork is stored for this item.</strong>
                    </div>
                )}
                {artwork.images.map(image => {
                    const group = typeGroups.get(image.imageType) || [];
                    const position = group.findIndex(candidate => candidate.id === image.id);
                    return (
                        <article className='ptv-metadata-artwork-card' key={image.id}>
                            <div className='ptv-metadata-artwork-preview'>
                                <img alt={`${imageTypeLabel(image.imageType)} artwork`} loading='lazy' src={image.previewUrl} />
                            </div>
                            <div className='ptv-metadata-artwork-details'>
                                <strong>{imageTypeLabel(image.imageType)}{group.length > 1 ? ` ${position + 1}` : ''}</strong>
                                <small>{imageDimensions(image.width, image.height)}</small>
                            </div>
                            <div className='ptv-metadata-artwork-actions'>
                                <button
                                    aria-label={`Move ${imageTypeLabel(image.imageType)} artwork earlier`}
                                    disabled={artwork.busy || position <= 0}
                                    onClick={() => artwork.onReorder(image, position - 1)}
                                    type='button'
                                >Move up</button>
                                <button
                                    aria-label={`Move ${imageTypeLabel(image.imageType)} artwork later`}
                                    disabled={artwork.busy || position < 0 || position >= group.length - 1}
                                    onClick={() => artwork.onReorder(image, position + 1)}
                                    type='button'
                                >Move down</button>
                                <button
                                    aria-label={`Delete ${imageTypeLabel(image.imageType)} artwork`}
                                    className='is-danger'
                                    disabled={artwork.busy}
                                    onClick={() => setDeleteTarget(image)}
                                    type='button'
                                ><PtvIcon name='delete' size='15px' />Delete</button>
                            </div>
                        </article>
                    );
                })}
            </div>

            {remoteOpen && (
                <section aria-labelledby='ptv-metadata-remote-artwork-title' className='ptv-metadata-remote-artwork'>
                    <header>
                        <div><h4 id='ptv-metadata-remote-artwork-title'>Search artwork</h4><p>Browse images reported by your configured metadata providers.</p></div>
                        <button aria-label='Close artwork search' disabled={artwork.remoteBusy} onClick={() => setRemoteOpen(false)} type='button'>Close</button>
                    </header>
                    {artwork.remoteProviderError && (
                        <div className='ptv-metadata-inline-state' role='alert'>
                            <strong>Artwork providers unavailable</strong>
                            <p>{artwork.remoteProviderError}</p>
                            <button onClick={artwork.onRetryRemoteProviders} type='button'>Retry providers</button>
                        </div>
                    )}
                    {artwork.remoteProvidersLoading && <p role='status'>Loading artwork providers...</p>}
                    <div className='ptv-metadata-remote-controls'>
                        <label>
                            <span>Image type</span>
                            <select disabled={artwork.remoteLoading || !imageTypes.length} onChange={event => setRemoteType(event.currentTarget.value as ImageType)} value={effectiveRemoteType}>
                                {!imageTypes.length && <option value=''>Unavailable</option>}
                                {imageTypes.map(type => <option key={type} value={type}>{imageTypeLabel(type)}</option>)}
                            </select>
                        </label>
                        <label>
                            <span>Provider</span>
                            <select disabled={artwork.remoteLoading} onChange={event => setRemoteProvider(event.currentTarget.value)} value={remoteProvider}>
                                <option value=''>All providers</option>
                                {artwork.remoteProviders.map(provider => <option key={provider.name} value={provider.name}>{provider.name}</option>)}
                            </select>
                        </label>
                        <button className='is-primary' disabled={artwork.remoteLoading || !effectiveRemoteType} onClick={() => searchRemote(0)} type='button'>
                            <PtvIcon name='search' size='16px' />
                            {artwork.remoteLoading ? 'Searching...' : 'Search'}
                        </button>
                    </div>
                    {artwork.remoteError && (
                        <div className='ptv-metadata-inline-state' role='alert'>
                            <strong>Remote artwork unavailable</strong>
                            <p>{artwork.remoteError}</p>
                            <button disabled={!effectiveRemoteType} onClick={() => searchRemote(artwork.remotePage?.startIndex || 0)} type='button'>Retry search</button>
                        </div>
                    )}
                    {artwork.remoteLoading && <p role='status'>Searching remote artwork...</p>}
                    {!artwork.remoteLoading && artwork.remotePage && !artwork.remotePage.items.length && !artwork.remoteError && <p>No matching artwork was found.</p>}
                    <div className='ptv-metadata-remote-grid'>
                        {artwork.remotePage?.items.map(image => (
                            <article className='ptv-metadata-remote-card' key={image.id}>
                                <div className='ptv-metadata-remote-preview'>
                                    <img alt={`${imageTypeLabel(image.imageType || effectiveRemoteType as ImageType)} from ${image.providerName}`} loading='lazy' src={image.thumbnailUrl || image.url} />
                                </div>
                                <div><strong>{image.providerName}</strong><small>{imageDimensions(image.width, image.height)}{image.language ? ` - ${image.language}` : ''}</small></div>
                                <button
                                    className='is-primary'
                                    disabled={artwork.remoteBusy || !effectiveRemoteType}
                                    onClick={() => artwork.onUseRemote(image, image.imageType || effectiveRemoteType as ImageType)}
                                    type='button'
                                >{artwork.remoteBusy ? 'Using...' : 'Use this image'}</button>
                            </article>
                        ))}
                    </div>
                    {artwork.remotePage && artwork.remotePage.items.length > 0 && (
                        <footer className='ptv-metadata-pagination'>
                            <button disabled={artwork.remoteLoading || artwork.remotePage.startIndex === 0} onClick={() => searchRemote(Math.max(0, artwork.remotePage!.startIndex - artwork.remotePage!.limit))} type='button'>Previous</button>
                            <span>Results {artwork.remotePage.startIndex + 1}-{artwork.remotePage.startIndex + artwork.remotePage.items.length}</span>
                            <button disabled={artwork.remoteLoading || !artwork.remotePage.hasNextPage} onClick={() => searchRemote(artwork.remotePage!.startIndex + artwork.remotePage!.limit)} type='button'>Next</button>
                        </footer>
                    )}
                </section>
            )}

            <WorkflowConfirmationDialog
                busy={artwork.busy}
                confirmLabel='Delete artwork'
                destructive
                onCancel={() => setDeleteTarget(null)}
                onConfirm={confirmDelete}
                open={Boolean(deleteTarget)}
                text={deleteTarget ? `Delete this ${imageTypeLabel(deleteTarget.imageType)} image from the item? This cannot be undone.` : ''}
                title='Delete artwork?'
            />
        </section>
    );
}

function IdentifyWorkflow({ identify, itemId, itemName, itemType }: Readonly<{
    identify: AdminMetadataIdentifyWorkflowProps;
    itemId: string;
    itemName: string;
    itemType: string;
}>) {
    const [ name, setName ] = useState(identify.initialName);
    const [ providerIds, setProviderIds ] = useState<Record<string, string | null>>({ ...identify.initialProviderIds });
    const [ selectedResult, setSelectedResult ] = useState<AdminMetadataIdentifyResult | null>(null);
    const [ year, setYear ] = useState(identify.initialYear === null ? '' : String(identify.initialYear));
    const initialIdentifyRef = useRef(identify);
    const titleInputRef = useRef<HTMLInputElement>(null);
    initialIdentifyRef.current = identify;

    useEffect(() => {
        const initial = initialIdentifyRef.current;
        setName(initial.initialName);
        setProviderIds({ ...initial.initialProviderIds });
        setSelectedResult(null);
        setYear(initial.initialYear === null ? '' : String(initial.initialYear));
        if (initial.supported) initial.onLoadProviders();
    }, [ itemId ]); // Provider discovery is intentionally lazy per selected item.

    const numericYear = year.trim() ? Number(year) : null;
    const yearValid = numericYear === null || (Number.isFinite(numericYear) && Number.isInteger(numericYear));
    const query = (): AdminMetadataIdentifyQuery => ({
        name,
        providerIds: {
            ...identify.initialProviderIds,
            ...providerIds
        },
        year: yearValid ? numericYear : null
    });
    const providerValue = (field: AdminMetadataProviderField) => {
        if (Object.prototype.hasOwnProperty.call(providerIds, field.key)) {
            return providerIds[field.key] || '';
        }

        return field.value || '';
    };
    const hasProviderId = Object.values(providerIds).some(Boolean);
    const hasSearchFields = Boolean(name) || Boolean(year)
        || identify.providerFields.some(field => Boolean(providerValue(field)));
    const canSearch = yearValid && (Boolean(name.trim()) || hasProviderId);
    const search = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (identify.searching || !canSearch) return;
        identify.onSearch(query());
    };
    const clearSearchFields = () => {
        setName('');
        setYear('');
        setProviderIds(current => Object.fromEntries(Array.from(new Set([
            ...Object.keys(identify.initialProviderIds),
            ...Object.keys(current),
            ...identify.providerFields.map(field => field.key)
        ]), key => [ key, null ])));
        setSelectedResult(null);
        titleInputRef.current?.focus();
    };
    const confirmApply = () => {
        if (!selectedResult || identify.applying) return;
        identify.onApply(selectedResult).then(() => setSelectedResult(null), () => undefined);
    };

    return (
        <section aria-labelledby='ptv-metadata-identify-title' className='ptv-metadata-workflow'>
            <header className='ptv-metadata-workflow-header'>
                <span className='ptv-metadata-workflow-icon'><PtvIcon name='search' size='22px' /></span>
                <div><h3 id='ptv-metadata-identify-title'>Identify</h3><p>Search configured providers for a match, then review it before applying.</p></div>
            </header>
            <StatusMessage error={identify.error} message={identify.message} />
            {!identify.supported ? (
                <div className='ptv-metadata-inline-state'>
                    <PtvIcon name='info' size='24px' />
                    <strong>Identify is not available for {itemType || 'this item type'}.</strong>
                    <p>You can continue editing this item&apos;s metadata manually.</p>
                </div>
            ) : (
                <>
                    <form className='ptv-metadata-identify-form' onSubmit={search}>
                        <label><span>Title</span><input onChange={event => setName(event.currentTarget.value)} ref={titleInputRef} value={name} /></label>
                        <label>
                            <span>Year</span>
                            <input aria-invalid={!yearValid} inputMode='numeric' onChange={event => setYear(event.currentTarget.value)} placeholder='Optional' value={year} />
                            {!yearValid && <small role='alert'>Enter a whole-number year.</small>}
                        </label>
                        <fieldset className='ptv-metadata-identify-providers'>
                            <legend>Provider IDs</legend>
                            {identify.providersLoading && <p role='status'>Loading provider fields...</p>}
                            {identify.providerError && (
                                <div className='ptv-metadata-inline-state' role='alert'>
                                    <p>{identify.providerError}</p>
                                    <button onClick={identify.onRetryProviders} type='button'>Retry providers</button>
                                </div>
                            )}
                            {!identify.providersLoading && !identify.providerError && !identify.providerFields.length && <p>No provider identifiers are available for this item.</p>}
                            <div className='ptv-metadata-identify-provider-grid'>
                                {identify.providerFields.map(field => (
                                    <label key={field.key}>
                                        <span>{field.label}{!field.available ? ' (Unavailable)' : ''}</span>
                                        <input
                                            disabled={!field.available || identify.searching}
                                            onChange={event => {
                                                const value = event.currentTarget.value || null;
                                                setProviderIds(current => ({ ...current, [field.key]: value }));
                                            }}
                                            value={providerValue(field)}
                                        />
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                        <div className='ptv-metadata-identify-actions'>
                            <button disabled={identify.searching || !hasSearchFields} onClick={clearSearchFields} type='button'>Clear all fields</button>
                            <button className='is-primary' disabled={identify.searching || !canSearch} type='submit'>
                                <PtvIcon name='search' size='16px' />
                                {identify.searching ? 'Searching...' : 'Search providers'}
                            </button>
                        </div>
                    </form>
                    {identify.error && (
                        <div className='ptv-metadata-inline-state' role='alert'>
                            <strong>Identify results unavailable</strong>
                            <button disabled={!canSearch || identify.searching} onClick={() => identify.onSearch(query())} type='button'>Retry search</button>
                        </div>
                    )}
                    {!identify.searching && !identify.error && identify.results.length === 0 && <p className='ptv-metadata-workflow-empty'>Search by title, year, or a known provider ID.</p>}
                    <div aria-busy={identify.searching} className='ptv-metadata-identify-results'>
                        {identify.results.map(result => (
                            <article className='ptv-metadata-identify-result' key={result.id}>
                                <span className='ptv-metadata-identify-poster'>
                                    {result.imageUrl ? <img alt='' loading='lazy' src={result.imageUrl} /> : <PtvIcon name='metadata' size='28px' />}
                                </span>
                                <div>
                                    <h4>{result.name}</h4>
                                    <p>{[ result.year, result.providerName ].filter(Boolean).join(' - ')}</p>
                                    {result.overview && <small>{result.overview}</small>}
                                </div>
                                <button className='is-primary' disabled={identify.applying} onClick={() => setSelectedResult(result)} type='button'>Use this match</button>
                            </article>
                        ))}
                    </div>
                </>
            )}
            <WorkflowConfirmationDialog
                busy={identify.applying}
                confirmLabel='Use this match'
                onCancel={() => setSelectedResult(null)}
                onConfirm={confirmApply}
                open={Boolean(selectedResult)}
                text={selectedResult ? `Apply “${selectedResult.name}” to “${itemName}”? PiggieTV will ask Jellyfin to apply the selected provider result without replacing all artwork.` : ''}
                title='Apply identify result?'
            />
        </section>
    );
}

function RefreshWorkflow({ itemId, itemName, refresh }: Readonly<{
    itemId: string;
    itemName: string;
    refresh: AdminMetadataRefreshWorkflowProps;
}>) {
    const [ confirmOpen, setConfirmOpen ] = useState(false);
    const [ mode, setMode ] = useState<AdminMetadataRefreshMode>('scan');
    const [ recursive, setRecursive ] = useState(false);

    useEffect(() => {
        setConfirmOpen(false);
        setMode('scan');
        setRecursive(false);
    }, [ itemId ]);

    const selected = REFRESH_MODES.find(option => option.value === mode) || REFRESH_MODES[0];
    const queueRefresh = () => {
        if (refresh.busy) return;
        refresh.onRefresh(mode, refresh.canRecurse && recursive).then(() => setConfirmOpen(false), () => undefined);
    };
    const submit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (refresh.busy) return;
        if (selected.destructive) setConfirmOpen(true);
        else queueRefresh();
    };

    return (
        <section aria-labelledby='ptv-metadata-refresh-title' className='ptv-metadata-workflow'>
            <header className='ptv-metadata-workflow-header'>
                <span className='ptv-metadata-workflow-icon'><PtvIcon name='refresh' size='22px' /></span>
                <div><h3 id='ptv-metadata-refresh-title'>Refresh</h3><p>Queue an explicit metadata refresh using the server&apos;s configured providers.</p></div>
            </header>
            <StatusMessage error={refresh.error} message={refresh.message} />
            <form className='ptv-metadata-refresh-form' onSubmit={submit}>
                <fieldset>
                    <legend>Refresh mode</legend>
                    <div className='ptv-metadata-refresh-options'>
                        {REFRESH_MODES.map(option => (
                            <div className={option.destructive ? 'is-warning' : ''} key={option.value}>
                                <input aria-label={option.label} checked={mode === option.value} disabled={refresh.busy} name='metadata-refresh-mode' onChange={() => setMode(option.value)} type='radio' value={option.value} />
                                <span><strong>{option.label}</strong><small>{option.description}</small></span>
                            </div>
                        ))}
                    </div>
                </fieldset>
                {refresh.canRecurse && (
                    <div className='ptv-metadata-refresh-recursive'>
                        <input aria-label='Include child items' checked={recursive} disabled={refresh.busy} onChange={event => setRecursive(event.currentTarget.checked)} type='checkbox' />
                        <span><strong>Include child items</strong><small>Apply this refresh request recursively to items beneath this selection.</small></span>
                    </div>
                )}
                <p className='ptv-metadata-refresh-note'>Refreshing is queued by the server. This page does not claim completion when the request is accepted.</p>
                <button className={selected.destructive ? 'is-warning' : 'is-primary'} disabled={refresh.busy} type='submit'>
                    <PtvIcon name='refresh' size='16px' />
                    {refresh.busy ? 'Queueing...' : selected.label}
                </button>
            </form>
            <WorkflowConfirmationDialog
                busy={refresh.busy}
                confirmLabel={selected.label}
                destructive
                onCancel={() => setConfirmOpen(false)}
                onConfirm={queueRefresh}
                open={confirmOpen}
                text={`${selected.description} This request will be queued for “${itemName}”${refresh.canRecurse && recursive ? ' and its child items' : ''}. Review the scope before continuing.`}
                title='Confirm replacement refresh'
            />
        </section>
    );
}

export default function AdminMetadataManagerWorkflows({
    activeTab,
    artwork,
    identify,
    itemId,
    itemName,
    itemType,
    onTabChange,
    refresh,
    showTabs = true
}: AdminMetadataManagerWorkflowsProps) {
    return (
        <div className='ptv-metadata-workflows'>
            {showTabs && (
                <div aria-label='Metadata tools' className='ptv-metadata-workflow-tabs' role='tablist'>
                    {([
                        [ 'artwork', 'Artwork', 'image' ],
                        [ 'identify', 'Identify', 'search' ],
                        [ 'refresh', 'Refresh', 'refresh' ]
                    ] as const).map(([ tab, label, icon ]) => (
                        <button
                            aria-controls={`ptv-metadata-${tab}-panel`}
                            aria-selected={activeTab === tab}
                            id={`ptv-metadata-${tab}-tab`}
                            key={tab}
                            onClick={() => onTabChange(tab)}
                            role='tab'
                            type='button'
                        ><PtvIcon name={icon} size='16px' />{label}</button>
                    ))}
                </div>
            )}
            <div
                aria-labelledby={showTabs ? `ptv-metadata-${activeTab}-tab` : undefined}
                id={`ptv-metadata-${activeTab}-panel`}
                role={showTabs ? 'tabpanel' : undefined}
            >
                {activeTab === 'artwork' && <ArtworkWorkflow artwork={artwork} />}
                {activeTab === 'identify' && <IdentifyWorkflow identify={identify} itemId={itemId} itemName={itemName} itemType={itemType} />}
                {activeTab === 'refresh' && <RefreshWorkflow itemId={itemId} itemName={itemName} refresh={refresh} />}
            </div>
        </div>
    );
}

/* eslint-enable react/jsx-no-bind */
