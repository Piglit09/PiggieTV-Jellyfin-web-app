import Dialog from '@mui/material/Dialog/Dialog';
import DialogActions from '@mui/material/DialogActions/DialogActions';
import DialogContent from '@mui/material/DialogContent/DialogContent';
import DialogContentText from '@mui/material/DialogContentText/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle/DialogTitle';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useApi } from '../../../../../hooks/useApi';
import PtvIcon from '../../../icons/PtvIcon';
import { useAdminConfigurationForm } from '../configuration/useAdminConfigurationForm';
import { useAdminUnsavedChanges } from '../configuration/useAdminUnsavedChanges';
import { areAdminMetadataFormsEqual } from './adminMetadataManagerAdapters';
import type { AdminMetadataManagerIdentifyPrefill } from './adminMetadataManagerIdentifyHandoff';
import AdminMetadataIdentifyPanel from './AdminMetadataIdentifyPanel';
import AdminMetadataManagerCatalog from './AdminMetadataManagerCatalog';
import AdminMetadataManagerForm from './AdminMetadataManagerForm';
import AdminMetadataManagerWorkflows, {
    type AdminMetadataArtworkWorkflowProps,
    type AdminMetadataManagerWorkflowTab,
    type AdminMetadataRefreshWorkflowProps
} from './AdminMetadataManagerWorkflows';
import {
    AdminMetadataManagerServiceError,
    type AdminMetadataCatalogItem,
    type AdminMetadataForm,
    type AdminMetadataRemoteImagePage,
    type AdminMetadataRemoteImageProvider
} from './adminMetadataManagerModel';
import { ADMIN_METADATA_MANAGER_PATH } from './AdminMetadataManagerRoute';
import { useAdminMetadataManager } from './useAdminMetadataManager';

import './adminMetadataManager.scss';

type ManagerTab = 'metadata' | AdminMetadataManagerWorkflowTab;
type NavigationTarget = Readonly<{
    itemId?: string;
    libraryId?: string;
    parentId?: string;
}>;

function managerTabForIdentifyHandoff(
    itemId: string,
    identifyPrefill?: AdminMetadataManagerIdentifyPrefill | null
): ManagerTab {
    return identifyPrefill?.itemId === itemId ? 'identify' : 'metadata';
}

function IdentifyHandoffNotice({
    activeTab,
    identifyPrefill
}: Readonly<{
    activeTab: ManagerTab;
    identifyPrefill?: AdminMetadataManagerIdentifyPrefill | null;
}>) {
    if (activeTab !== 'identify' || !identifyPrefill) return null;
    return (
        <p className='ptv-metadata-workflow-message' role='status'>
            The Metadata Quality suggestion is prefilled for review. Search providers, inspect the result, then explicitly confirm before Jellyfin changes anything.
        </p>
    );
}

const UPLOAD_IMAGE_TYPES = [
    ImageType.Primary,
    ImageType.Backdrop,
    ImageType.Logo,
    ImageType.Banner,
    ImageType.Thumb,
    ImageType.Art,
    ImageType.Disc,
    ImageType.Box,
    ImageType.BoxRear,
    ImageType.Menu,
    ImageType.Screenshot
] as const;

function safeMessage(error: unknown, fallback: string) {
    return error instanceof AdminMetadataManagerServiceError ? error.message : fallback;
}

function initialLibrary(value: string, roots: readonly Readonly<{ id: string }>[]) {
    return value && roots.some(root => root.id === value) ? value : roots[0]?.id || '';
}

function itemImageUrl(
    apiClient: ReturnType<typeof useApi>['__legacyApiClient__'],
    item: Pick<AdminMetadataCatalogItem, 'id' | 'primaryImageTag'>
) {
    if (!apiClient || !item.primaryImageTag) return '';
    return apiClient.getScaledImageUrl(item.id, {
        maxHeight: 120,
        maxWidth: 90,
        tag: item.primaryImageTag,
        type: 'Primary'
    });
}

function ItemSkeleton() {
    return (
        <div aria-label='Loading item metadata' className='ptv-metadata-item-skeleton' role='status'>
            <span />
            <span />
            <span />
        </div>
    );
}

function itemLoadErrorTitle(error: unknown) {
    return error instanceof AdminMetadataManagerServiceError && error.code === 'item-not-found' ?
        'This item is no longer available.' : 'This item could not be loaded.';
}

/* eslint-disable no-void, react/jsx-no-bind */
export default function PtvAdminMetadataManagerPage({
    identifyPrefill,
    itemId
}: Readonly<{
    identifyPrefill?: AdminMetadataManagerIdentifyPrefill | null;
    itemId: string;
}>) {
    const navigate = useNavigate();
    const { __legacyApiClient__: apiClient, api, user } = useApi();
    const [ libraryId, setLibraryId ] = useState('');
    const [ folderStack, setFolderStack ] = useState<readonly Readonly<{ id: string; name: string }>[]>([]);
    const [ search, setSearch ] = useState('');
    const [ startIndex, setStartIndex ] = useState(0);
    const [ activeTab, setActiveTab ] = useState<ManagerTab>(() => managerTabForIdentifyHandoff(itemId, identifyPrefill));
    const [ pendingNavigation, setPendingNavigation ] = useState<NavigationTarget | null>(null);
    const [ feedback, setFeedback ] = useState('');
    const [ artworkMessage, setArtworkMessage ] = useState<string | null>(null);
    const [ remoteProviders, setRemoteProviders ] = useState<readonly AdminMetadataRemoteImageProvider[]>([]);
    const [ remoteProviderError, setRemoteProviderError ] = useState<string | null>(null);
    const [ remoteProvidersLoading, setRemoteProvidersLoading ] = useState(false);
    const [ remotePage, setRemotePage ] = useState<AdminMetadataRemoteImagePage | null>(null);
    const [ remoteError, setRemoteError ] = useState<string | null>(null);
    const [ remoteLoading, setRemoteLoading ] = useState(false);
    const [ refreshError, setRefreshError ] = useState<string | null>(null);
    const [ refreshMessage, setRefreshMessage ] = useState<string | null>(null);
    const remoteProviderFlight = useRef(false);
    const remoteSearchFlight = useRef(false);
    const itemGenerationRef = useRef(0);
    const selectedParent = folderStack.at(-1);
    const state = useAdminMetadataManager({
        api,
        apiClient,
        artworkEnabled: activeTab === 'artwork',
        itemId,
        libraryId,
        parentId: selectedParent?.id || libraryId,
        searchTerm: search,
        startIndex,
        userId: user?.Id
    });
    const source = state.itemBundle?.form || null;
    const equality = useCallback((left: AdminMetadataForm, right: AdminMetadataForm) => (
        areAdminMetadataFormsEqual(left, right, state.itemBundle?.editor.editableFields)
    ), [ state.itemBundle?.editor.editableFields ]);
    const formState = useAdminConfigurationForm(source, equality);
    const roots = useMemo(() => state.roots || [], [ state.roots ]);
    const confirmedLibrary = initialLibrary(libraryId, roots);
    const bundle = state.itemBundle;
    const mutationError = state.mutationError ? safeMessage(state.mutationError, 'The metadata action could not be completed.') : null;

    useAdminUnsavedChanges(formState.dirty, 'Leave without saving your metadata changes?');

    useEffect(() => {
        if (!libraryId && roots.length) setLibraryId(roots[0].id);
    }, [ libraryId, roots ]);

    useEffect(() => {
        itemGenerationRef.current += 1;
        remoteProviderFlight.current = false;
        remoteSearchFlight.current = false;
        setActiveTab(managerTabForIdentifyHandoff(itemId, identifyPrefill));
        setFeedback('');
        setArtworkMessage(null);
        setRemoteProviders([]);
        setRemoteProviderError(null);
        setRemoteProvidersLoading(false);
        setRemotePage(null);
        setRemoteError(null);
        setRemoteLoading(false);
        setRefreshError(null);
        setRefreshMessage(null);
    }, [ identifyPrefill, itemId ]);

    const executeNavigation = useCallback((target: NavigationTarget) => {
        if (target.libraryId !== undefined) {
            setLibraryId(target.libraryId);
            setFolderStack([]);
            setSearch('');
            setStartIndex(0);
        }
        if (target.parentId !== undefined) {
            setFolderStack(current => target.parentId ? [ ...current, {
                id: target.parentId,
                name: state.catalogPage?.items.find(item => item.id === target.parentId)?.name || 'Folder'
            } ] : current.slice(0, -1));
            setSearch('');
            setStartIndex(0);
        }
        if (target.itemId !== undefined) {
            navigate(target.itemId ? `${ADMIN_METADATA_MANAGER_PATH}/${encodeURIComponent(target.itemId)}` : ADMIN_METADATA_MANAGER_PATH);
        }
    }, [ navigate, state.catalogPage?.items ]);
    const requestNavigation = useCallback((target: NavigationTarget) => {
        if (formState.dirty) setPendingNavigation(target);
        else executeNavigation(target);
    }, [ executeNavigation, formState.dirty ]);
    const discardAndNavigate = useCallback(() => {
        const target = pendingNavigation;
        setPendingNavigation(null);
        formState.reset();
        if (target) window.setTimeout(() => executeNavigation(target), 0);
    }, [ executeNavigation, formState, pendingNavigation ]);

    const save = useCallback(async () => {
        if (!formState.form || !formState.confirmed || !formState.dirty || state.isMutating) return;
        setFeedback('');
        try {
            const saved = await state.saveMetadata(formState.form, formState.confirmed);
            formState.adopt(saved.form);
            setFeedback('Metadata saved.');
        } catch (error) {
            if (error instanceof AdminMetadataManagerServiceError && error.code === 'conflict') {
                formState.setServerChanged(true);
                setFeedback('This item changed on the server while you were editing.');
            } else {
                setFeedback(safeMessage(error, "We couldn't save metadata for this item."));
            }
        }
    }, [ formState, state ]);
    const reloadItem = useCallback(async () => {
        try {
            const result = await state.refetchItem({ cancelRefetch: true });
            if (result.data) {
                formState.adopt(result.data.form);
                setFeedback('Latest item metadata loaded.');
            }
        } catch {
            setFeedback('This item could not be reloaded. Your edits are still here.');
        }
    }, [ formState, state ]);

    const loadRemoteProviders = useCallback(async () => {
        if (remoteProviderFlight.current) return;
        const generation = itemGenerationRef.current;
        remoteProviderFlight.current = true;
        setRemoteProvidersLoading(true);
        setRemoteProviderError(null);
        try {
            const providers = await state.fetchRemoteImageProviders();
            if (generation === itemGenerationRef.current) setRemoteProviders(providers);
        } catch (error) {
            if (generation === itemGenerationRef.current) {
                setRemoteProviderError(safeMessage(error, 'Remote artwork providers are unavailable.'));
            }
        } finally {
            if (generation === itemGenerationRef.current) {
                remoteProviderFlight.current = false;
                setRemoteProvidersLoading(false);
            }
        }
    }, [ state ]);
    const searchRemote = useCallback(async (request: Parameters<typeof state.fetchRemoteImages>[0]) => {
        if (remoteSearchFlight.current) return;
        const generation = itemGenerationRef.current;
        remoteSearchFlight.current = true;
        setRemoteLoading(true);
        setRemoteError(null);
        try {
            const page = await state.fetchRemoteImages(request);
            if (generation === itemGenerationRef.current) setRemotePage(page);
        } catch (error) {
            if (generation === itemGenerationRef.current) {
                setRemoteError(safeMessage(error, 'Remote artwork could not be loaded.'));
            }
        } finally {
            if (generation === itemGenerationRef.current) {
                remoteSearchFlight.current = false;
                setRemoteLoading(false);
            }
        }
    }, [ state ]);
    const artworkProps: AdminMetadataArtworkWorkflowProps = {
        busy: Boolean(state.activeMutation?.includes('artwork')),
        error: state.artworkError ? safeMessage(state.artworkError, 'Artwork could not be loaded.') : mutationError,
        images: state.artwork || [],
        loading: state.artworkLoading,
        message: artworkMessage,
        onDelete: async image => {
            setArtworkMessage(null);
            await state.deleteArtwork({ imageIndex: image.index, imageType: image.imageType });
            setArtworkMessage('Artwork removed.');
        },
        onLoadRemoteProviders: () => void loadRemoteProviders(),
        onReorder: async (image, newIndex) => {
            setArtworkMessage(null);
            await state.reorderArtwork({ imageIndex: image.index, imageType: image.imageType, newIndex });
            setArtworkMessage('Artwork order saved.');
        },
        onRetry: () => void state.refetchArtwork(),
        onRetryRemoteProviders: () => void loadRemoteProviders(),
        onSearchRemote: request => void searchRemote(request),
        onUpload: async (file, imageType) => {
            setArtworkMessage(null);
            await state.uploadArtwork({ file, imageType });
            setArtworkMessage('Artwork uploaded.');
        },
        onUseRemote: async (image, imageType) => {
            setArtworkMessage(null);
            await state.downloadRemoteArtwork({ imageType, imageUrl: image.url });
            setArtworkMessage('Remote artwork added.');
        },
        remoteBusy: state.activeMutation === 'download-artwork',
        remoteError,
        remoteLoading,
        remotePage,
        remoteProviderError,
        remoteProviders,
        remoteProvidersLoading,
        uploadImageTypes: UPLOAD_IMAGE_TYPES
    };
    const refreshProps: AdminMetadataRefreshWorkflowProps = {
        busy: state.activeMutation === 'refresh',
        canRecurse: Boolean(bundle?.item.isFolder || [ 'Series', 'Season', 'BoxSet', 'CollectionFolder' ].includes(bundle?.item.type || '')),
        error: refreshError,
        message: refreshMessage,
        onRefresh: async (mode, recursive) => {
            setRefreshError(null);
            setRefreshMessage(null);
            try {
                if (formState.dirty) {
                    throw new AdminMetadataManagerServiceError(
                        'invalid-input',
                        'Save or reset your metadata edits before refreshing this item.'
                    );
                }
                await state.refreshItem(mode, recursive);
                setRefreshMessage('Refresh requested. Jellyfin will process it in the background.');
            } catch (error) {
                const message = safeMessage(error, "We couldn't request a metadata refresh.");
                setRefreshError(message);
                throw error;
            }
        }
    };
    const posterUrl = bundle && apiClient && bundle.item.primaryImageTag ? apiClient.getScaledImageUrl(bundle.item.id, {
        maxHeight: 180,
        maxWidth: 120,
        tag: bundle.item.primaryImageTag,
        type: 'Primary'
    }) : '';

    return (
        <section className='ptv-metadata-manager' data-testid='ptv-admin-metadata-manager'>
            <header className='ptv-metadata-manager-header'>
                <div>
                    <h1>Metadata Manager</h1>
                    <p>Browse your catalog, refine item metadata, manage artwork, and run explicit provider tools.</p>
                </div>
                <span className='ptv-metadata-manager-scope'><PtvIcon name='metadata' size='17px' />Item-level administration</span>
            </header>

            <div className='ptv-metadata-workspace' data-has-selection={Boolean(itemId) || undefined}>
                <AdminMetadataManagerCatalog
                    error={Boolean(state.rootsError || state.catalogError)}
                    imageUrl={item => itemImageUrl(apiClient, item)}
                    loading={state.rootsLoading || state.catalogLoading}
                    onBack={() => requestNavigation({ parentId: '' })}
                    onLibraryChange={value => requestNavigation({ itemId: '', libraryId: value })}
                    onNextPage={() => setStartIndex(current => current + (state.catalogPage?.limit || 50))}
                    onOpenFolder={item => requestNavigation({ itemId: '', parentId: item.id })}
                    onPreviousPage={() => setStartIndex(current => Math.max(0, current - (state.catalogPage?.limit || 50)))}
                    onRetry={() => void Promise.all([ state.refetchRoots(), state.refetchCatalog() ])}
                    onSearchChange={value => {
                        setSearch(value);
                        setStartIndex(0);
                    }}
                    onSelect={item => requestNavigation({ itemId: item.id })}
                    page={state.catalogPage}
                    parentName={selectedParent?.name || roots.find(root => root.id === confirmedLibrary)?.name || 'Catalog'}
                    refreshing={state.catalogFetching && Boolean(state.catalogPage)}
                    roots={roots}
                    search={search}
                    selectedItemId={itemId}
                    selectedLibraryId={confirmedLibrary}
                    showBack={folderStack.length > 0 && !search.trim()}
                />

                {!itemId && (
                    <section className='ptv-metadata-empty-selection'>
                        <PtvIcon name='metadata' size='34px' />
                        <h2>Select an item</h2>
                        <p>Choose a title or folder from the catalog to inspect its authoritative Jellyfin metadata.</p>
                    </section>
                )}
                {Boolean(itemId && state.itemLoading && !bundle) && <ItemSkeleton />}
                {Boolean(itemId && state.itemError && !bundle) && (
                    <section className='ptv-metadata-item-state' role='alert'>
                        <PtvIcon name='alerts' size='30px' />
                        <h2>{itemLoadErrorTitle(state.itemError)}</h2>
                        <p>The catalog remains available. Retry this item or choose another one.</p>
                        <button onClick={() => void state.refetchItem()} type='button'>Retry item</button>
                    </section>
                )}
                {Boolean(itemId && bundle && formState.form) && bundle && formState.form && (
                    <article className='ptv-metadata-editor'>
                        <header className='ptv-metadata-editor-header'>
                            <button className='ptv-metadata-mobile-back' onClick={() => requestNavigation({ itemId: '' })} type='button'>
                                <PtvIcon name='back' size='16px' />Back to catalog
                            </button>
                            <span className='ptv-metadata-editor-poster'>
                                {posterUrl ? <img alt={`Primary artwork for ${bundle.item.name}`} loading='lazy' src={posterUrl} /> : <PtvIcon name='metadata' size='24px' />}
                            </span>
                            <div className='ptv-metadata-editor-title'>
                                <small>{bundle.item.type || 'Catalog item'}</small>
                                <h2>{bundle.form.name}</h2>
                                <p>{bundle.ancestors.map(ancestor => ancestor.name).join(' / ') || 'PiggieTV catalog'}</p>
                            </div>
                        </header>
                        <div aria-label='Item management' className='ptv-metadata-tabs' role='tablist'>
                            {([
                                [ 'metadata', 'Metadata', 'metadata' ],
                                [ 'artwork', 'Artwork', 'image' ],
                                [ 'identify', 'Identify', 'search' ],
                                [ 'refresh', 'Refresh', 'refresh' ]
                            ] as const).map(([ tab, label, icon ]) => (
                                <button
                                    aria-controls={`ptv-metadata-tab-${tab}`}
                                    aria-selected={activeTab === tab}
                                    id={`ptv-metadata-tab-button-${tab}`}
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    role='tab'
                                    type='button'
                                ><PtvIcon name={icon} size='15px' />{label}</button>
                            ))}
                        </div>
                        <div
                            aria-labelledby={`ptv-metadata-tab-button-${activeTab}`}
                            className='ptv-metadata-tab-panel'
                            id={`ptv-metadata-tab-${activeTab}`}
                            role='tabpanel'
                        >
                            <IdentifyHandoffNotice activeTab={activeTab} identifyPrefill={identifyPrefill} />
                            {activeTab === 'metadata' && (
                                <AdminMetadataManagerForm
                                    conflict={formState.serverChanged}
                                    dirty={formState.dirty}
                                    disabled={state.itemFetching}
                                    editor={bundle.editor}
                                    feedback={feedback}
                                    form={formState.form}
                                    onChange={(field, value) => {
                                        formState.update(field, value);
                                        setFeedback('');
                                    }}
                                    onReload={() => void reloadItem()}
                                    onReset={() => {
                                        formState.reset();
                                        setFeedback('');
                                    }}
                                    onSave={() => void save()}
                                    saving={state.activeMutation === 'save'}
                                />
                            )}
                            {activeTab === 'identify' && (
                                <AdminMetadataIdentifyPanel
                                    applyBlocker={() => formState.dirty ?
                                        'Save or reset your metadata edits before applying an Identify match.' : null}
                                    bundle={bundle}
                                    identifyPrefill={identifyPrefill}
                                    onApplied={saved => formState.adopt(saved.form)}
                                    operations={state}
                                />
                            )}
                            {(activeTab === 'artwork' || activeTab === 'refresh') && (
                                <AdminMetadataManagerWorkflows
                                    activeTab={activeTab}
                                    artwork={artworkProps}
                                    itemId={bundle.item.id}
                                    itemName={bundle.form.name}
                                    itemType={bundle.item.type}
                                    onTabChange={setActiveTab}
                                    refresh={refreshProps}
                                    showTabs={false}
                                />
                            )}
                        </div>
                    </article>
                )}
            </div>

            <Dialog
                aria-labelledby='ptv-metadata-discard-title'
                className='ptv-metadata-workflow-dialog'
                fullWidth
                maxWidth='xs'
                onClose={() => setPendingNavigation(null)}
                open={Boolean(pendingNavigation)}
            >
                <DialogTitle id='ptv-metadata-discard-title'>Discard unsaved changes?</DialogTitle>
                <DialogContent>
                    <DialogContentText>Your edits to this item have not been saved.</DialogContentText>
                </DialogContent>
                <DialogActions className='ptv-metadata-workflow-dialog-actions'>
                    <button onClick={() => setPendingNavigation(null)} type='button'>Keep Editing</button>
                    <button className='is-danger' onClick={discardAndNavigate} type='button'>Discard Changes</button>
                </DialogActions>
            </Dialog>
        </section>
    );
}
/* eslint-enable no-void, react/jsx-no-bind */
