import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AdminMetadataManagerWorkflows, {
    AdminMetadataArtworkWorkflowProps,
    AdminMetadataIdentifyWorkflowProps,
    AdminMetadataRefreshWorkflowProps
} from './AdminMetadataManagerWorkflows';
import type {
    AdminMetadataCatalogItem,
    AdminMetadataForm,
    AdminMetadataItemBundle
} from './adminMetadataManagerModel';
import type { AdminReadingMetadataSearchResponse } from './adminReadingMetadataModel';
import type {
    UseAdminMetadataManagerInput,
    useAdminMetadataManager
} from './useAdminMetadataManager';

/* eslint-disable @typescript-eslint/naming-convention */

type HookState = ReturnType<typeof useAdminMetadataManager>;

const uiMocks = vi.hoisted(() => ({
    hookInputs: [] as UseAdminMetadataManagerInput[],
    prompt: vi.fn(),
    state: null as unknown as HookState
}));

vi.mock('../../../../../hooks/useApi', () => ({
    useApi: () => ({
        __legacyApiClient__: {
            getScaledImageUrl: vi.fn(() => '/image'),
            serverId: () => 'server-a'
        },
        api: {},
        user: { Id: 'admin-a', Policy: { IsAdministrator: true } }
    })
}));

vi.mock('./useAdminMetadataManager', () => ({
    useAdminMetadataManager: (input: UseAdminMetadataManagerInput) => {
        uiMocks.hookInputs.push(input);
        return uiMocks.state;
    }
}));

vi.mock('../../../icons/PtvIcon', () => ({
    default: ({ name }: Readonly<{ name: string }>) => <span data-icon={name} />
}));

vi.mock('@mui/material/Dialog/Dialog', () => ({
    default: ({ children, open }: Readonly<{ children: React.ReactNode; open: boolean }>) =>
        open ? <div role='dialog'>{children}</div> : null
}));
vi.mock('@mui/material/DialogActions/DialogActions', () => ({
    default: ({ children }: Readonly<{ children: React.ReactNode }>) => <div>{children}</div>
}));
vi.mock('@mui/material/DialogContent/DialogContent', () => ({
    default: ({ children }: Readonly<{ children: React.ReactNode }>) => <div>{children}</div>
}));
vi.mock('@mui/material/DialogContentText/DialogContentText', () => ({
    default: ({ children }: Readonly<{ children: React.ReactNode }>) => <p>{children}</p>
}));
vi.mock('@mui/material/DialogTitle/DialogTitle', () => ({
    default: ({ children, id }: Readonly<{ children: React.ReactNode; id?: string }>) => <h2 id={id}>{children}</h2>
}));

vi.mock('react-router-dom', async importOriginal => {
    const actual = await importOriginal<typeof import('react-router-dom')>();
    return {
        ...actual,
        unstable_usePrompt: uiMocks.prompt
    };
});

import PtvAdminMetadataManagerPage from './PtvAdminMetadataManagerPage';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function metadataForm(overrides: Partial<AdminMetadataForm> = {}): AdminMetadataForm {
    return {
        communityRating: 8.2,
        criticRating: 74,
        customRating: '',
        endDate: '',
        genres: [ 'Drama' ],
        indexNumber: null,
        lockData: false,
        lockedFields: [],
        name: 'Example Movie',
        officialRating: 'PG-13',
        originalTitle: 'Example Movie',
        overview: 'An example movie used by the focused UI tests.',
        parentIndexNumber: null,
        people: [],
        premiereDate: '2024-03-14',
        productionLocations: [ 'US' ],
        productionYear: 2024,
        providerIds: { Imdb: 'tt123' },
        runtimeMinutes: 103,
        sortName: 'Example Movie',
        studios: [],
        tagline: 'An example tagline',
        tags: [ 'Featured' ],
        ...overrides
    };
}

function itemBundle(overrides: Readonly<{
    editableFields?: AdminMetadataItemBundle['editor']['editableFields'];
    form?: Partial<AdminMetadataForm>;
    id?: string;
    isFolder?: boolean;
    type?: string;
}> = {}): AdminMetadataItemBundle {
    const value = metadataForm(overrides.form);
    const id = overrides.id || 'item-a';
    const type = overrides.type || 'Movie';
    return {
        ancestors: [{ id: 'library-a', name: 'Movies', type: 'CollectionFolder' }],
        authoritativeItem: { Id: id, Name: value.name, Type: type },
        editor: {
            editableFields: overrides.editableFields || [
                'name',
                'originalTitle',
                'sortName',
                'overview',
                'tagline',
                'productionYear',
                'premiereDate',
                'runtimeMinutes',
                'officialRating',
                'genres',
                'tags',
                'providerIds',
                'lockData',
                'lockedFields'
            ],
            parentalRatings: [ { label: 'PG-13', value: 'PG-13' } ],
            providerFields: [ {
                available: true,
                key: 'Imdb',
                label: 'IMDb',
                type: 'Movie',
                value: 'tt123'
            } ]
        },
        editorInfo: {},
        form: value,
        item: {
            backdropImageTags: [],
            collectionType: '',
            id,
            imageTags: {},
            isFolder: overrides.isFolder || false,
            name: value.name,
            parentId: 'library-a',
            primaryImageTag: null,
            type
        }
    } as AdminMetadataItemBundle;
}

function catalogItem(overrides: Partial<AdminMetadataCatalogItem> = {}): AdminMetadataCatalogItem {
    return {
        childCount: null,
        id: 'item-a',
        indexNumber: null,
        isFolder: false,
        name: 'Example Movie',
        parentId: 'library-a',
        parentIndexNumber: null,
        primaryImageTag: null,
        productionYear: 2024,
        type: 'Movie',
        ...overrides
    };
}

function readingSearchResponse(title: string): AdminReadingMetadataSearchResponse {
    return {
        candidates: [{
            alternateTitles: [],
            artists: [],
            authors: [],
            bannerUrl: null,
            chapterNumber: null,
            countryOfOrigin: null,
            coverUrl: null,
            description: null,
            endYear: null,
            externalIds: { AniList: '30013' },
            genres: [],
            isbn10: null,
            isbn13: null,
            issueNumber: null,
            language: null,
            localizedTitles: {},
            mediaClass: 'manga',
            provider: 'AniList',
            providerId: '30013',
            publisher: null,
            score: 91,
            scoreReasons: [],
            seriesTitle: null,
            sourceUrl: null,
            startYear: 2024,
            status: null,
            tags: [],
            title,
            totalChapters: null,
            totalVolumes: null,
            volumeNumber: null,
            year: 2024
        }],
        localMetadata: { sources: [], state: 'not-found', warnings: [] },
        providerResults: [],
        query: {
            alternateTitles: [],
            author: null,
            chapterNumber: null,
            classification: { confidence: 0.9, mediaClass: 'manga', reasons: [] },
            cleanedTitle: title,
            editionKind: 'standard',
            existingProviderIds: {},
            ignoredFilenameTokens: [],
            isbn: null,
            issueNumber: null,
            mediaClass: 'manga',
            originalLanguage: null,
            providerId: null,
            rawFileName: '',
            rawTitle: title,
            seriesTitle: null,
            volumeNumber: null,
            year: 2024
        }
    };
}

function metadataManagerState(overrides: Partial<HookState> = {}): HookState {
    const saveMetadata = vi.fn(async (desired: AdminMetadataForm) => itemBundle({ form: desired }));
    return {
        activeMutation: null,
        applyIdentifyResult: vi.fn(async () => itemBundle()),
        artwork: null,
        artworkError: null,
        artworkFetching: false,
        artworkLoading: false,
        catalogError: null,
        catalogFetching: false,
        catalogLoading: false,
        catalogPage: {
            hasNextPage: false,
            items: [
                catalogItem(),
                catalogItem({ id: 'item-b', name: 'Second Movie', productionYear: 2023 })
            ],
            limit: 50,
            scope: 'children',
            startIndex: 0,
            totalRecordCount: 2
        },
        catalogRequest: { libraryId: 'library-a', parentId: 'library-a', startIndex: 0, userId: 'admin-a' },
        debouncedSearchTerm: '',
        deleteArtwork: vi.fn(async () => undefined),
        downloadRemoteArtwork: vi.fn(async () => undefined),
        fetchIdentifyProviders: vi.fn(async () => []),
        fetchReadingProviders: vi.fn(async () => ({ providers: [] })),
        fetchRemoteImageProviders: vi.fn(async () => []),
        fetchRemoteImages: vi.fn(async () => ({
            hasNextPage: false,
            items: [],
            limit: 30,
            startIndex: 0,
            totalRecordCount: 0
        })),
        isMutating: false,
        itemBundle: null,
        itemError: null,
        itemFetching: false,
        itemLoading: false,
        mutationError: null,
        queryKeys: {} as HookState['queryKeys'],
        refetchArtwork: vi.fn(async () => ({ data: [] })),
        refetchCatalog: vi.fn(async () => ({ data: null })),
        refetchItem: vi.fn(async () => ({ data: null })),
        refetchRoots: vi.fn(async () => ({ data: null })),
        refreshItem: vi.fn(async () => undefined),
        reorderArtwork: vi.fn(async () => undefined),
        roots: [{
            childCount: 2,
            collectionType: 'movies',
            id: 'library-a',
            name: 'Movies',
            primaryImageTag: null,
            type: 'CollectionFolder'
        }],
        rootsError: null,
        rootsFetching: false,
        rootsLoading: false,
        saveMetadata,
        searchReadingIdentify: vi.fn(async () => ({ candidates: [], providerResults: [], query: {} })),
        searchIdentify: vi.fn(async () => []),
        uploadArtwork: vi.fn(async () => undefined),
        ...overrides
    } as unknown as HookState;
}

function artworkProps(overrides: Partial<AdminMetadataArtworkWorkflowProps> = {}): AdminMetadataArtworkWorkflowProps {
    return {
        busy: false,
        error: null,
        images: [],
        loading: false,
        message: null,
        onDelete: vi.fn(async () => undefined),
        onLoadRemoteProviders: vi.fn(),
        onReorder: vi.fn(async () => undefined),
        onRetry: vi.fn(),
        onRetryRemoteProviders: vi.fn(),
        onSearchRemote: vi.fn(),
        onUpload: vi.fn(async () => undefined),
        onUseRemote: vi.fn(async () => undefined),
        remoteBusy: false,
        remoteError: null,
        remoteLoading: false,
        remotePage: null,
        remoteProviderError: null,
        remoteProviders: [],
        remoteProvidersLoading: false,
        uploadImageTypes: [ ImageType.Primary ],
        ...overrides
    };
}

function identifyProps(overrides: Partial<AdminMetadataIdentifyWorkflowProps> = {}): AdminMetadataIdentifyWorkflowProps {
    return {
        applying: false,
        error: null,
        initialName: 'Example Movie',
        initialProviderIds: {},
        initialYear: 2024,
        message: null,
        onApply: vi.fn(async () => undefined),
        onLoadProviders: vi.fn(),
        onRetryProviders: vi.fn(),
        onSearch: vi.fn(),
        providerError: null,
        providerFields: [],
        providersLoading: false,
        results: [],
        searching: false,
        supported: true,
        ...overrides
    };
}

function refreshProps(overrides: Partial<AdminMetadataRefreshWorkflowProps> = {}): AdminMetadataRefreshWorkflowProps {
    return {
        busy: false,
        canRecurse: false,
        error: null,
        message: null,
        onRefresh: vi.fn(async () => undefined),
        ...overrides
    };
}

function buttonWithText(root: ParentNode, text: string) {
    return Array.from(root.querySelectorAll('button')).find(button => button.textContent === text);
}

function inputForLabel(root: ParentNode, text: string) {
    return Array.from(root.querySelectorAll('label')).find(label =>
        label.querySelector(':scope > span')?.textContent === text
    )?.querySelector<HTMLInputElement>('input');
}

async function changeInput(input: HTMLInputElement | null | undefined, value: string) {
    if (!input) return;
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

async function flushAsync() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => window.setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

function LocationProbe() {
    const location = useLocation();
    return <output data-testid='location'>{location.pathname}</output>;
}

describe('PiggieTV native Metadata Manager UI', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        uiMocks.hookInputs = [];
        uiMocks.state = metadataManagerState();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    function renderPage(
        itemId = '',
        identifyPrefill: React.ComponentProps<typeof PtvAdminMetadataManagerPage>['identifyPrefill'] = null
    ) {
        return act(async () => root.render(
            <MemoryRouter initialEntries={[ itemId ? `/settings/admin/media/metadata-manager/${itemId}` : '/settings/admin/media/metadata-manager' ]}>
                <PtvAdminMetadataManagerPage identifyPrefill={identifyPrefill} itemId={itemId} />
                <LocationProbe />
            </MemoryRouter>
        ));
    }

    function renderWorkflow(
        activeTab: 'artwork' | 'identify' | 'refresh',
        options: Readonly<{
            artwork?: AdminMetadataArtworkWorkflowProps;
            identify?: AdminMetadataIdentifyWorkflowProps;
            refresh?: AdminMetadataRefreshWorkflowProps;
        }> = {}
    ) {
        return act(async () => root.render(
            <AdminMetadataManagerWorkflows
                activeTab={activeTab}
                artwork={options.artwork || artworkProps()}
                identify={options.identify || identifyProps()}
                itemId='item-a'
                itemName='Example Movie'
                itemType='Movie'
                onTabChange={vi.fn()}
                refresh={options.refresh || refreshProps()}
                showTabs={false}
            />
        ));
    }

    it('renders the native shell and usable catalog without fabricating a selected item', async () => {
        await renderPage();

        expect(container.querySelector('h1')?.textContent).toBe('Metadata Manager');
        expect(container.querySelector('[aria-label="Media catalog"]')).not.toBeNull();
        expect(container.textContent).toContain('Example Movie');
        expect(container.textContent).toContain('Second Movie');
        expect(container.textContent).toContain('Select an item');
        expect(container.querySelector('.ptv-metadata-form')).toBeNull();
        expect(uiMocks.hookInputs.every(input => input.itemId === '')).toBe(true);
    });

    it('renders a selected movie with type-aware authoritative fields', async () => {
        uiMocks.state = metadataManagerState({ itemBundle: itemBundle() });
        await renderPage('item-a');

        expect(container.querySelector('.ptv-metadata-editor-title h2')?.textContent).toBe('Example Movie');
        expect(inputForLabel(container, 'Name')?.value).toBe('Example Movie');
        expect(inputForLabel(container, 'Production year')?.value).toBe('2024');
        expect(inputForLabel(container, 'Premiere date')?.value).toBe('2024-03-14');
        expect(inputForLabel(container, 'Episode / track number')).toBeUndefined();
        expect(container.textContent).toContain('Provider IDs');
    });

    it('tracks dirty metadata, resets locally, and saves only through the explicit action', async () => {
        const bundle = itemBundle();
        const saveMetadata = vi.fn(async (desired: AdminMetadataForm) => ({ ...bundle, form: desired }));
        uiMocks.state = metadataManagerState({ itemBundle: bundle, saveMetadata });
        await renderPage('item-a');

        const name = inputForLabel(container, 'Name');
        await changeInput(name, 'Edited title');
        expect(buttonWithText(container, 'Save Metadata')?.disabled).toBe(false);
        expect(buttonWithText(container, 'Reset Changes')?.disabled).toBe(false);
        expect(uiMocks.prompt).toHaveBeenLastCalledWith(expect.objectContaining({ when: true }));
        expect(saveMetadata).not.toHaveBeenCalled();

        await act(async () => buttonWithText(container, 'Reset Changes')?.click());
        expect(name?.value).toBe('Example Movie');
        expect(buttonWithText(container, 'Save Metadata')?.disabled).toBe(true);

        await changeInput(name, 'Saved title');
        await act(async () => buttonWithText(container, 'Save Metadata')?.click());
        await flushAsync();

        expect(saveMetadata).toHaveBeenCalledOnce();
        expect(saveMetadata).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Saved title' }),
            expect.objectContaining({ name: 'Example Movie' })
        );
        expect(container.textContent).toContain('Metadata saved.');
    });

    it('uses the PTV discard dialog before switching a dirty item', async () => {
        uiMocks.state = metadataManagerState({ itemBundle: itemBundle() });
        await renderPage('item-a');
        await changeInput(inputForLabel(container, 'Name'), 'Unsaved title');

        await act(async () => buttonWithText(container, 'Second Movie2023 · Movie')?.click());
        const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
        expect(dialog?.textContent).toContain('Discard unsaved changes?');
        expect(container.querySelector('[data-testid="location"]')?.textContent)
            .toBe('/settings/admin/media/metadata-manager/item-a');

        await act(async () => buttonWithText(dialog!, 'Keep Editing')?.click());
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(container.querySelector('[data-testid="location"]')?.textContent)
            .toBe('/settings/admin/media/metadata-manager/item-a');

        await act(async () => buttonWithText(container, 'Second Movie2023 · Movie')?.click());
        await act(async () => buttonWithText(container.querySelector('[role="dialog"]')!, 'Discard Changes')?.click());
        await flushAsync();
        expect(container.querySelector('[data-testid="location"]')?.textContent)
            .toBe('/settings/admin/media/metadata-manager/item-b');
    });

    it('enables the artwork query only after the Artwork tab is opened', async () => {
        uiMocks.state = metadataManagerState({ artwork: [], itemBundle: itemBundle() });
        await renderPage('item-a');

        expect(uiMocks.hookInputs.length).toBeGreaterThan(0);
        expect(uiMocks.hookInputs.every(input => input.artworkEnabled === false)).toBe(true);
        await act(async () => buttonWithText(container, 'Artwork')?.click());

        expect(uiMocks.hookInputs.at(-1)?.artworkEnabled).toBe(true);
        expect(container.textContent).toContain('No artwork is stored for this item.');
    });

    it('retains the catalog when the selected item core request fails', async () => {
        uiMocks.state = metadataManagerState({
            itemBundle: null,
            itemError: new Error('technical detail omitted')
        });
        await renderPage('item-a');

        expect(container.querySelector('[aria-label="Media catalog"]')).not.toBeNull();
        expect(container.textContent).toContain('Example Movie');
        expect(container.textContent).toContain('Second Movie');
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('This item could not be loaded.');
        expect(buttonWithText(container, 'Retry item')).not.toBeUndefined();
    });

    it('requires explicit confirmation before deleting artwork', async () => {
        const image = {
            height: 900,
            id: 'primary-0',
            imageType: ImageType.Primary,
            index: 0,
            itemId: 'item-a',
            previewUrl: '/Items/item-a/Images/Primary',
            size: 1234,
            tag: 'tag-a',
            width: 600
        } as const;
        const onDelete = vi.fn(async () => undefined);
        await renderWorkflow('artwork', { artwork: artworkProps({ images: [ image ], onDelete }) });

        await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Delete Primary artwork"]')?.click());
        expect(onDelete).not.toHaveBeenCalled();
        const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
        expect(dialog?.textContent).toContain('Delete artwork?');
        await act(async () => buttonWithText(dialog!, 'Delete artwork')?.click());
        await flushAsync();
        expect(onDelete).toHaveBeenCalledOnce();
        expect(onDelete).toHaveBeenCalledWith(image);
    });

    it('reviews an Identify result without automatically applying it', async () => {
        const result = {
            id: 'result-a',
            imageUrl: null,
            name: 'Provider Match',
            overview: 'Matched provider record.',
            providerIds: { Imdb: 'tt999' },
            providerName: 'IMDb',
            source: {},
            year: 2024
        } as const;
        const onApply = vi.fn(async () => undefined);
        const onLoadProviders = vi.fn();
        await renderWorkflow('identify', {
            identify: identifyProps({ onApply, onLoadProviders, results: [ result ] })
        });

        expect(onLoadProviders).toHaveBeenCalledOnce();
        expect(onApply).not.toHaveBeenCalled();
        await act(async () => buttonWithText(container, 'Use this match')?.click());
        expect(onApply).not.toHaveBeenCalled();
        const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
        expect(dialog?.textContent).toContain('Apply identify result?');
        await act(async () => buttonWithText(dialog!, 'Use this match')?.click());
        await flushAsync();
        expect(onApply).toHaveBeenCalledOnce();
        expect(onApply).toHaveBeenCalledWith(result);
    });

    it('mounts provider-neutral Reading Identify for Books without loading the legacy provider form', async () => {
        const applyIdentifyResult = vi.fn(async () => itemBundle());
        const fetchIdentifyProviders = vi.fn(async () => []);
        const fetchReadingProviders = vi.fn(async () => ({ providers: [] }));
        const searchReadingIdentify = vi.fn(async () => readingSearchResponse('Matched title'));
        uiMocks.state = metadataManagerState({
            applyIdentifyResult,
            fetchIdentifyProviders,
            fetchReadingProviders,
            itemBundle: itemBundle({
                form: { name: 'Delicious in Dungeon, Vol. 1' },
                type: 'Book'
            }),
            searchReadingIdentify
        });
        await renderPage('item-a');

        await act(async () => buttonWithText(container, 'Identify')?.click());
        await flushAsync();

        expect(container.textContent).toContain('Identify reading metadata');
        expect(container.textContent).toContain('Advanced search');
        expect(fetchReadingProviders).toHaveBeenCalledOnce();
        expect(fetchIdentifyProviders).not.toHaveBeenCalled();
        expect(searchReadingIdentify).not.toHaveBeenCalled();
        expect(applyIdentifyResult).not.toHaveBeenCalled();
    });

    it('does not leave an older Reading result actionable after a newer search fails', async () => {
        const searchReadingIdentify = vi.fn()
            .mockResolvedValueOnce(readingSearchResponse('Older successful match'))
            .mockRejectedValueOnce(new Error('private provider failure'));
        uiMocks.state = metadataManagerState({
            itemBundle: itemBundle({ form: { name: 'Reading title' }, type: 'Book' }),
            searchReadingIdentify
        });
        await renderPage('item-a');
        await act(async () => buttonWithText(container, 'Identify')?.click());
        await flushAsync();

        await act(async () => buttonWithText(container, 'Search')?.click());
        await flushAsync();
        expect(container.textContent).toContain('Older successful match');

        await act(async () => buttonWithText(container, 'Search')?.click());
        await flushAsync();
        expect(searchReadingIdentify).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Reading identification results could not be loaded.');
        expect(container.textContent).not.toContain('Older successful match');
        expect(buttonWithText(container, 'Review match')).toBeUndefined();
    });

    it('opens a verified Metadata Quality suggestion in Identify without searching or applying on load', async () => {
        const applyIdentifyResult = vi.fn(async () => itemBundle());
        const searchIdentify = vi.fn(async () => []);
        uiMocks.state = metadataManagerState({
            applyIdentifyResult,
            itemBundle: itemBundle(),
            searchIdentify
        });

        await renderPage('item-a', {
            itemId: 'item-a',
            name: 'The Thing',
            providerIds: { TMDb: '1091' },
            year: 1982
        });
        await flushAsync();

        expect(buttonWithText(container, 'Identify')?.getAttribute('aria-selected')).toBe('true');
        expect(inputForLabel(container, 'Title')?.value).toBe('The Thing');
        expect(inputForLabel(container, 'Year')?.value).toBe('1982');
        expect(container.textContent).toContain('Metadata Quality suggestion is prefilled');
        expect(searchIdentify).not.toHaveBeenCalled();
        expect(applyIdentifyResult).not.toHaveBeenCalled();

        await act(async () => buttonWithText(container, 'Search providers')?.click());
        await flushAsync();

        expect(searchIdentify).toHaveBeenCalledWith({
            itemType: 'Movie',
            query: {
                name: 'The Thing',
                providerIds: { TMDb: '1091' },
                year: 1982
            }
        });
        expect(applyIdentifyResult).not.toHaveBeenCalled();
    });

    it('prefills comic run evidence from Metadata Quality without searching or applying on load', async () => {
        const applyIdentifyResult = vi.fn(async () => itemBundle({ type: 'Book' }));
        const searchReadingIdentify = vi.fn(async () => readingSearchResponse('Deadpool'));
        uiMocks.state = metadataManagerState({
            applyIdentifyResult,
            itemBundle: itemBundle({
                form: {
                    name: 'Deadpool 009 (2019) (Digital) (Zone-Empire)',
                    productionYear: 2020,
                    providerIds: { ComicVine: '4000-77815' }
                },
                type: 'Book'
            }),
            searchReadingIdentify
        });

        await renderPage('item-a', {
            issueNumber: '9',
            itemId: 'item-a',
            mediaClass: 'comic',
            name: 'Deadpool',
            provider: 'Comic Vine',
            providerIds: { ComicVine: '4000-77815' },
            seriesStartYear: 2019,
            seriesTitle: 'Deadpool',
            year: 2020
        });
        await flushAsync();

        expect(buttonWithText(container, 'Identify')?.getAttribute('aria-selected')).toBe('true');
        expect(inputForLabel(container, 'Title')?.value).toBe('Deadpool');
        expect(inputForLabel(container, 'Series')?.value).toBe('Deadpool');
        expect(inputForLabel(container, 'Issue')?.value).toBe('9');
        expect(inputForLabel(container, 'Series year')?.value).toBe('2019');
        expect(container.textContent).toContain('Metadata Quality suggestion is prefilled');
        expect(searchReadingIdentify).not.toHaveBeenCalled();
        expect(applyIdentifyResult).not.toHaveBeenCalled();
    });

    it('allows every Identify field to be cleared individually without searching or applying a match', async () => {
        const onApply = vi.fn(async () => undefined);
        const onSearch = vi.fn();
        await renderWorkflow('identify', {
            identify: identifyProps({
                initialProviderIds: { Imdb: 'tt1234567' },
                onApply,
                onSearch,
                providerFields: [ {
                    available: true,
                    key: 'Imdb',
                    label: 'IMDb',
                    type: null,
                    value: 'tt1234567'
                } ]
            })
        });

        await changeInput(inputForLabel(container, 'Title'), '');
        await changeInput(inputForLabel(container, 'Year'), '');
        await changeInput(inputForLabel(container, 'IMDb'), '');

        expect(inputForLabel(container, 'Title')?.value).toBe('');
        expect(inputForLabel(container, 'Year')?.value).toBe('');
        expect(inputForLabel(container, 'IMDb')?.value).toBe('');
        expect(buttonWithText(container, 'Search providers')?.disabled).toBe(true);
        expect(onSearch).not.toHaveBeenCalled();
        expect(onApply).not.toHaveBeenCalled();
    });

    it('clears all Identify fields locally without searching or applying a match', async () => {
        const onApply = vi.fn(async () => undefined);
        const onSearch = vi.fn();
        await renderWorkflow('identify', {
            identify: identifyProps({
                initialProviderIds: { Imdb: 'tt1234567', Tmdb: '456' },
                onApply,
                onSearch,
                providerFields: [
                    { available: true, key: 'Imdb', label: 'IMDb', type: null, value: 'tt1234567' },
                    { available: true, key: 'Tmdb', label: 'TMDb', type: null, value: '456' }
                ]
            })
        });

        await act(async () => buttonWithText(container, 'Clear all fields')?.click());

        expect(inputForLabel(container, 'Title')?.value).toBe('');
        expect(inputForLabel(container, 'Year')?.value).toBe('');
        expect(inputForLabel(container, 'IMDb')?.value).toBe('');
        expect(inputForLabel(container, 'TMDb')?.value).toBe('');
        expect(document.activeElement).toBe(inputForLabel(container, 'Title'));
        expect(buttonWithText(container, 'Clear all fields')?.disabled).toBe(true);
        expect(buttonWithText(container, 'Search providers')?.disabled).toBe(true);
        expect(onSearch).not.toHaveBeenCalled();
        expect(onApply).not.toHaveBeenCalled();
    });

    it('does not refresh on load and confirms destructive replacement modes', async () => {
        const onRefresh = vi.fn(async () => undefined);
        await renderWorkflow('refresh', { refresh: refreshProps({ onRefresh }) });

        expect(onRefresh).not.toHaveBeenCalled();
        await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Replace all metadata and artwork"]')?.click());
        await act(async () => buttonWithText(container, 'Replace all metadata and artwork')?.click());
        expect(onRefresh).not.toHaveBeenCalled();

        const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
        expect(dialog?.textContent).toContain('Confirm replacement refresh');
        await act(async () => buttonWithText(dialog!, 'Replace all metadata and artwork')?.click());
        await flushAsync();
        expect(onRefresh).toHaveBeenCalledOnce();
        expect(onRefresh).toHaveBeenCalledWith('replace-all', false);
    });
});

/* eslint-enable @typescript-eslint/naming-convention */
