import type { Api } from '@jellyfin/sdk';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    AdminMetadataCatalogPage,
    AdminMetadataForm,
    AdminMetadataIdentifyResult,
    AdminMetadataItemBundle
} from './adminMetadataManagerModel';
import type {
    AdminReadingMetadataCandidate,
    AdminReadingMetadataSearchResponse
} from './adminReadingMetadataModel';

const serviceMocks = vi.hoisted(() => ({
    applyIdentify: vi.fn(),
    deleteArtwork: vi.fn(),
    downloadRemoteImage: vi.fn(),
    loadArtwork: vi.fn(),
    loadCatalog: vi.fn(),
    loadIdentifyProviders: vi.fn(),
    loadItem: vi.fn(),
    loadRemoteImageProviders: vi.fn(),
    loadRemoteImages: vi.fn(),
    loadRoots: vi.fn(),
    refreshItem: vi.fn(),
    reorderArtwork: vi.fn(),
    saveItem: vi.fn(),
    searchIdentify: vi.fn(),
    uploadArtwork: vi.fn()
}));

const readingServiceMocks = vi.hoisted(() => ({
    loadProviders: vi.fn(),
    search: vi.fn()
}));

vi.mock('./adminMetadataManagerService', async () => {
    const actual = await vi.importActual<typeof import('./adminMetadataManagerService')>(
        './adminMetadataManagerService'
    );
    return {
        ...actual,
        applyAdminMetadataIdentifyResult: serviceMocks.applyIdentify,
        deleteAdminMetadataArtwork: serviceMocks.deleteArtwork,
        downloadAdminMetadataRemoteImage: serviceMocks.downloadRemoteImage,
        loadAdminMetadataArtwork: serviceMocks.loadArtwork,
        loadAdminMetadataCatalogPage: serviceMocks.loadCatalog,
        loadAdminMetadataIdentifyProviders: serviceMocks.loadIdentifyProviders,
        loadAdminMetadataItemBundle: serviceMocks.loadItem,
        loadAdminMetadataRemoteImageProviders: serviceMocks.loadRemoteImageProviders,
        loadAdminMetadataRemoteImages: serviceMocks.loadRemoteImages,
        loadAdminMetadataRoots: serviceMocks.loadRoots,
        refreshAdminMetadataItem: serviceMocks.refreshItem,
        reorderAdminMetadataArtwork: serviceMocks.reorderArtwork,
        saveAdminMetadataItem: serviceMocks.saveItem,
        searchAdminMetadataIdentify: serviceMocks.searchIdentify,
        uploadAdminMetadataArtwork: serviceMocks.uploadArtwork
    };
});

vi.mock('../../../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: vi.fn(() => ({
        getReadingMetadataProviders: vi.fn(),
        searchReadingMetadata: vi.fn()
    }))
}));

vi.mock('./adminReadingMetadataService', () => ({
    loadAdminReadingMetadataProviders: readingServiceMocks.loadProviders,
    searchAdminReadingMetadata: readingServiceMocks.search
}));

import {
    createAdminMetadataCatalogRequest,
    getAdminMetadataManagerQueryKeys,
    useAdminMetadataManager,
    type UseAdminMetadataManagerInput
} from './useAdminMetadataManager';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

const api = {} as Api;
const apiClient = {
    serverId: () => 'server-a'
} as ApiClient;

function metadataForm(overrides: Partial<AdminMetadataForm> = {}): AdminMetadataForm {
    return {
        communityRating: null,
        criticRating: null,
        customRating: '',
        endDate: '',
        genres: [],
        indexNumber: null,
        lockData: false,
        lockedFields: [],
        name: 'Original title',
        officialRating: '',
        originalTitle: '',
        overview: '',
        parentIndexNumber: null,
        people: [],
        premiereDate: '',
        productionLocations: [],
        productionYear: 2020,
        providerIds: {},
        runtimeMinutes: null,
        sortName: '',
        studios: [],
        tagline: '',
        tags: [],
        ...overrides
    };
}

function itemBundle(
    id = 'item-a',
    form = metadataForm(),
    primaryImageTag = 'tag-a',
    type = 'Movie'
): AdminMetadataItemBundle {
    return {
        ancestors: [],
        authoritativeItem: { Id: id, Name: form.name },
        editor: { editableFields: [ 'name', 'productionYear' ], parentalRatings: [], providerFields: [] },
        editorInfo: {},
        form,
        item: {
            backdropImageTags: [],
            collectionType: '',
            id,
            imageTags: primaryImageTag ? { Primary: primaryImageTag } : {},
            isFolder: false,
            name: form.name,
            parentId: 'library-a',
            primaryImageTag,
            type
        }
    } as AdminMetadataItemBundle;
}

function readingCandidate(
    overrides: Partial<AdminReadingMetadataCandidate> = {}
): AdminReadingMetadataCandidate {
    return {
        alternateTitles: [],
        artists: [],
        authors: [],
        bannerUrl: null,
        chapterNumber: '31',
        countryOfOrigin: 'JP',
        coverUrl: null,
        description: 'Provider overview',
        endYear: null,
        externalIds: { AniList: '30013', MangaDex: 'manga-13' },
        genres: [],
        isbn10: null,
        isbn13: null,
        issueNumber: '7',
        language: 'ja',
        localizedTitles: {},
        mediaClass: 'manga',
        provider: 'AniList + MangaDex',
        providerId: 'merged-result',
        publisher: null,
        score: 94,
        scoreReasons: [],
        seriesTitle: 'Series title',
        sourceUrl: null,
        startYear: 2023,
        status: null,
        tags: [],
        title: 'Matched title',
        totalChapters: null,
        totalVolumes: null,
        volumeNumber: '4',
        year: 2023,
        ...overrides
    };
}

function readingResponse(title = 'Matched title'): AdminReadingMetadataSearchResponse {
    const candidate = readingCandidate({ title });
    return {
        candidates: [ candidate ],
        localMetadata: { sources: [], state: 'not-found', warnings: [] },
        providerResults: [],
        query: {
            alternateTitles: [],
            author: null,
            chapterNumber: '31',
            classification: { confidence: 0.9, mediaClass: 'manga', reasons: [] },
            cleanedTitle: title,
            editionKind: 'standard',
            existingProviderIds: {},
            ignoredFilenameTokens: [],
            isbn: null,
            issueNumber: '7',
            mediaClass: 'manga',
            originalLanguage: 'ja',
            providerId: null,
            rawFileName: '',
            rawTitle: title,
            seriesTitle: 'Series title',
            volumeNumber: '4',
            year: 2023
        }
    };
}

function catalogPage(name = 'Original title'): AdminMetadataCatalogPage {
    return {
        hasNextPage: false,
        items: [ {
            childCount: null,
            id: 'item-a',
            indexNumber: null,
            isFolder: false,
            name,
            parentId: 'library-a',
            parentIndexNumber: null,
            primaryImageTag: 'tag-a',
            productionYear: 2020,
            type: 'Movie'
        } ],
        limit: 50,
        scope: 'children',
        startIndex: 0,
        totalRecordCount: 1
    };
}

let latest: ReturnType<typeof useAdminMetadataManager> | null = null;

function Harness(props: UseAdminMetadataManagerInput) {
    latest = useAdminMetadataManager(props);
    return null;
}

async function flushQueries() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

describe('useAdminMetadataManager', () => {
    let container: HTMLDivElement;
    let root: Root;
    let queryClient: QueryClient;

    beforeEach(() => {
        vi.clearAllMocks();
        latest = null;
        serviceMocks.loadRoots.mockResolvedValue([ {
            childCount: 1,
            collectionType: 'movies',
            id: 'library-a',
            name: 'Movies',
            primaryImageTag: null,
            type: 'CollectionFolder'
        } ]);
        serviceMocks.loadCatalog.mockResolvedValue(catalogPage());
        serviceMocks.loadItem.mockResolvedValue(itemBundle());
        serviceMocks.loadArtwork.mockResolvedValue([]);
        serviceMocks.loadRemoteImageProviders.mockResolvedValue([]);
        serviceMocks.loadRemoteImages.mockResolvedValue({
            hasNextPage: false,
            items: [],
            limit: 30,
            startIndex: 0,
            totalRecordCount: 0
        });
        serviceMocks.loadIdentifyProviders.mockResolvedValue([]);
        serviceMocks.searchIdentify.mockResolvedValue([]);
        serviceMocks.uploadArtwork.mockResolvedValue(undefined);
        serviceMocks.deleteArtwork.mockResolvedValue(undefined);
        serviceMocks.reorderArtwork.mockResolvedValue(undefined);
        serviceMocks.downloadRemoteImage.mockResolvedValue(undefined);
        serviceMocks.refreshItem.mockResolvedValue(undefined);
        serviceMocks.applyIdentify.mockResolvedValue(itemBundle());
        serviceMocks.saveItem.mockResolvedValue(itemBundle());
        readingServiceMocks.loadProviders.mockResolvedValue({ providers: [] });
        readingServiceMocks.search.mockResolvedValue(readingResponse());
        queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        queryClient.clear();
        container.remove();
    });

    async function render(props: Partial<UseAdminMetadataManagerInput> = {}) {
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness
                    api={api}
                    apiClient={apiClient}
                    libraryId='library-a'
                    parentId='library-a'
                    userId='admin-a'
                    {...props}
                />
            </QueryClientProvider>
        ));
        await flushQueries();
    }

    it('isolates every source and response-shaping dimension by server', () => {
        const a = getAdminMetadataManagerQueryKeys('server-a');
        const b = getAdminMetadataManagerQueryKeys('server-b');
        const request = createAdminMetadataCatalogRequest({
            libraryId: 'library-a',
            parentId: 'folder-a',
            searchTerm: 'movie',
            startIndex: 50,
            userId: 'admin-a'
        });

        expect(a.roots('admin-a')).not.toEqual(b.roots('admin-a'));
        expect(a.catalog(request)[2]).toBe('catalog');
        expect(a.item('admin-a', 'item-a')[2]).toBe('item');
        expect(a.images('item-a')[2]).toBe('images');
        expect(a.remoteImages({
            imageType: ImageType.Primary,
            itemId: 'item-a',
            providerName: 'Provider A',
            startIndex: 30
        })).not.toEqual(a.remoteImages({
            imageType: ImageType.Backdrop,
            itemId: 'item-a',
            providerName: 'Provider A',
            startIndex: 30
        }));
        expect(a.identifyResults('item-a', 'Movie', {
            name: 'Movie',
            providerIds: { B: '2', A: '1' },
            year: 2020
        })).toEqual(a.identifyResults('item-a', 'Movie', {
            name: 'Movie',
            providerIds: { A: '1', B: '2' },
            year: 2020
        }));

        const readingRequest = {
            author: ' Writer One ',
            chapterNumber: '31',
            isbn: '9780000000000',
            issueNumber: '7',
            itemId: ' item-a ',
            mediaClass: 'manga' as const,
            provider: 'AniList',
            providerId: '30013',
            seriesTitle: 'Series title',
            title: ' Matched title ',
            volumeNumber: '4',
            year: 2023
        };
        expect(a.readingProviders()).not.toEqual(b.readingProviders());
        expect(a.readingResults(readingRequest)).not.toEqual(b.readingResults(readingRequest));
        expect(a.readingResults(readingRequest)[4]).toEqual({
            author: 'Writer One',
            chapterNumber: '31',
            isbn: '9780000000000',
            issueNumber: '7',
            itemId: 'item-a',
            mediaClass: 'manga',
            provider: 'AniList',
            providerId: '30013',
            seriesTitle: 'Series title',
            title: 'Matched title',
            volumeNumber: '4',
            year: 2023
        });
        for (const [ key, value ] of Object.entries({
            author: 'Different writer',
            chapterNumber: '32',
            isbn: '9781111111111',
            issueNumber: '8',
            itemId: 'item-b',
            mediaClass: 'comic',
            provider: 'ComicVine',
            providerId: '40014',
            seriesTitle: 'Different series',
            title: 'Different title',
            volumeNumber: '5',
            year: 2024
        })) {
            expect(a.readingResults({ ...readingRequest, [key]: value })).not.toEqual(
                a.readingResults(readingRequest)
            );
        }
    });

    it('loads roots and a bounded catalog page without auto-loading an item or artwork', async () => {
        await render({ itemId: '' });

        await vi.waitFor(() => expect(serviceMocks.loadCatalog).toHaveBeenCalledOnce());
        expect(serviceMocks.loadRoots).toHaveBeenCalledOnce();
        expect(serviceMocks.loadCatalog.mock.calls[0][1]).toMatchObject({
            parentId: 'library-a',
            startIndex: 0,
            userId: 'admin-a'
        });
        expect(serviceMocks.loadCatalog.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
        expect(serviceMocks.loadItem).not.toHaveBeenCalled();
        expect(serviceMocks.loadArtwork).not.toHaveBeenCalled();
        expect(latest?.itemBundle).toBeNull();
    });

    it('aborts a stale item selection and never exposes it over the new item', async () => {
        let resolveA!: (value: AdminMetadataItemBundle) => void;
        let resolveB!: (value: AdminMetadataItemBundle) => void;
        serviceMocks.loadItem.mockImplementation((_api, request) => new Promise(resolve => {
            if (request.itemId === 'item-a') resolveA = resolve;
            else resolveB = resolve;
        }));

        await render({ itemId: 'item-a' });
        await vi.waitFor(() => expect(serviceMocks.loadItem).toHaveBeenCalledOnce());
        const firstSignal = serviceMocks.loadItem.mock.calls[0][2] as AbortSignal;

        await render({ itemId: 'item-b' });
        await vi.waitFor(() => expect(serviceMocks.loadItem).toHaveBeenCalledTimes(2));
        expect(firstSignal.aborted).toBe(true);

        await act(async () => {
            resolveB(itemBundle('item-b', metadataForm({ name: 'Second' })));
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        await vi.waitFor(() => expect(latest?.itemBundle?.item.id).toBe('item-b'));
        await act(async () => {
            resolveA(itemBundle('item-a', metadataForm({ name: 'First' })));
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        expect(latest?.itemBundle?.item.id).toBe('item-b');
    });

    it('keeps artwork, remote search, and identify requests lazy until explicitly requested', async () => {
        await render({ artworkEnabled: false, itemId: 'item-a' });
        await vi.waitFor(() => expect(serviceMocks.loadItem).toHaveBeenCalledOnce());

        expect(serviceMocks.loadArtwork).not.toHaveBeenCalled();
        expect(serviceMocks.loadRemoteImageProviders).not.toHaveBeenCalled();
        expect(serviceMocks.loadRemoteImages).not.toHaveBeenCalled();
        expect(serviceMocks.loadIdentifyProviders).not.toHaveBeenCalled();
        expect(serviceMocks.searchIdentify).not.toHaveBeenCalled();
        expect(readingServiceMocks.loadProviders).not.toHaveBeenCalled();
        expect(readingServiceMocks.search).not.toHaveBeenCalled();

        await act(async () => {
            await latest?.fetchRemoteImageProviders();
            await latest?.fetchRemoteImages({ imageType: ImageType.Primary });
            await latest?.fetchIdentifyProviders();
            await latest?.fetchReadingProviders();
            await latest?.searchIdentify({
                itemType: 'Movie',
                query: { name: 'Movie', providerIds: {}, year: null }
            });
            await latest?.searchReadingIdentify({
                chapterNumber: '31',
                issueNumber: '7',
                mediaClass: 'manga',
                title: 'Manga title',
                volumeNumber: '4'
            });
        });
        expect(serviceMocks.loadRemoteImageProviders).toHaveBeenCalledOnce();
        expect(serviceMocks.loadRemoteImages).toHaveBeenCalledOnce();
        expect(serviceMocks.loadIdentifyProviders).toHaveBeenCalledOnce();
        expect(serviceMocks.searchIdentify).toHaveBeenCalledOnce();
        expect(readingServiceMocks.loadProviders).toHaveBeenCalledOnce();
        expect(readingServiceMocks.search).toHaveBeenCalledOnce();
        expect(readingServiceMocks.search.mock.calls[0][1]).toMatchObject({
            chapterNumber: '31',
            issueNumber: '7',
            itemId: 'item-a',
            mediaClass: 'manga',
            volumeNumber: '4'
        });

        await render({ artworkEnabled: true, itemId: 'item-a' });
        await vi.waitFor(() => expect(serviceMocks.loadArtwork).toHaveBeenCalledOnce());
    });

    it('cancels the prior Reading search before starting a differently shaped search', async () => {
        let resolveFirst!: (value: AdminReadingMetadataSearchResponse) => void;
        let resolveSecond!: (value: AdminReadingMetadataSearchResponse) => void;
        readingServiceMocks.search.mockImplementation((_client, request) => new Promise(resolve => {
            if (request.title === 'First title') resolveFirst = resolve;
            else resolveSecond = resolve;
        }));
        await render({ itemId: 'item-a' });

        let first!: Promise<unknown>;
        await act(async () => {
            first = latest!.searchReadingIdentify({
                chapterNumber: '10',
                mediaClass: 'manga',
                title: 'First title'
            }).catch(error => error);
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(readingServiceMocks.search).toHaveBeenCalledOnce());
        const firstSignal = readingServiceMocks.search.mock.calls[0][2] as AbortSignal;

        let second!: Promise<AdminReadingMetadataSearchResponse>;
        await act(async () => {
            second = latest!.searchReadingIdentify({
                chapterNumber: '11',
                mediaClass: 'manga',
                title: 'Second title'
            });
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(readingServiceMocks.search).toHaveBeenCalledTimes(2));
        expect(firstSignal.aborted).toBe(true);

        await act(async () => {
            resolveSecond(readingResponse('Second title'));
            await second;
        });
        expect((await second).candidates[0].title).toBe('Second title');

        resolveFirst(readingResponse('First title'));
        expect(await first).toBeInstanceOf(Error);
    });

    it('applies a Reading candidate through the conflict-safe item save path', async () => {
        const confirmed = metadataForm({
            name: 'Existing title',
            productionYear: 2001,
            providerIds: { ExistingProvider: 'keep-me' }
        });
        const current = {
            ...itemBundle('item-a', confirmed),
            editor: {
                editableFields: [ 'name', 'productionYear', 'providerIds' ],
                parentalRatings: [],
                providerFields: []
            }
        } as AdminMetadataItemBundle;
        const saved = itemBundle('item-a', metadataForm({
            name: 'Matched title',
            productionYear: 2023,
            providerIds: { AniList: '30013', ExistingProvider: 'keep-me', MangaDex: 'manga-13' }
        }));
        serviceMocks.loadItem.mockResolvedValue(current);
        serviceMocks.saveItem.mockResolvedValue(saved);
        await render({ itemId: 'item-a' });
        await vi.waitFor(() => expect(latest?.itemBundle?.form.name).toBe('Existing title'));

        const candidate = readingCandidate();
        const result: AdminMetadataIdentifyResult = {
            id: 'ptv-reading:merged-result',
            imageUrl: null,
            name: candidate.title,
            overview: candidate.description || '',
            providerIds: candidate.externalIds,
            providerName: candidate.provider,
            readingCandidate: candidate,
            source: null,
            year: candidate.startYear
        };
        await act(async () => {
            await latest!.applyIdentifyResult(result);
        });

        expect(serviceMocks.applyIdentify).not.toHaveBeenCalled();
        expect(serviceMocks.saveItem).toHaveBeenCalledOnce();
        expect(serviceMocks.saveItem.mock.calls[0][1].confirmedForm).toBe(confirmed);
        expect(serviceMocks.saveItem.mock.calls[0][1].desiredForm).toMatchObject({
            name: 'Matched title',
            productionYear: 2023,
            providerIds: {
                AniList: '30013',
                ExistingProvider: 'keep-me',
                MangaDex: 'manga-13'
            }
        });
        expect(serviceMocks.saveItem.mock.calls[0][1].desiredForm.providerIds)
            .not.toHaveProperty('AniList + MangaDex');
        expect(latest?.itemBundle?.form.name).toBe('Matched title');
    });

    it('keeps the authoritative item visible when a Reading candidate save conflicts', async () => {
        const conflict = Object.assign(new Error('The item changed while you were reviewing it.'), {
            code: 'conflict'
        });
        serviceMocks.saveItem.mockRejectedValue(conflict);
        await render({ itemId: 'item-a' });
        await vi.waitFor(() => expect(latest?.itemBundle).not.toBeNull());
        const candidate = readingCandidate();

        await act(async () => {
            await expect(latest!.applyIdentifyResult({
                id: 'ptv-reading:conflict',
                imageUrl: null,
                name: candidate.title,
                overview: candidate.description || '',
                providerIds: candidate.externalIds,
                providerName: candidate.provider,
                readingCandidate: candidate,
                source: null,
                year: candidate.year
            })).rejects.toBe(conflict);
        });

        expect(latest?.itemBundle?.form.name).toBe('Original title');
        expect(latest?.mutationError).toBe(conflict);
        expect(serviceMocks.applyIdentify).not.toHaveBeenCalled();
    });

    it('refreshes a Book from its exact saved Reading provider ID before any fuzzy server refresh', async () => {
        const confirmed = metadataForm({
            name: 'Existing manga title',
            providerIds: { AniList: '30013' }
        });
        const current = {
            ...itemBundle('item-a', confirmed, 'tag-a', 'Book'),
            editor: {
                editableFields: [ 'name', 'productionYear', 'providerIds' ],
                parentalRatings: [],
                providerFields: []
            }
        } as AdminMetadataItemBundle;
        const candidate = readingCandidate({
            externalIds: { AniList: '30013' },
            provider: 'anilist',
            providerId: '30013'
        });
        const saved = itemBundle(
            'item-a',
            metadataForm({ name: candidate.title, providerIds: { AniList: '30013' } }),
            'tag-a',
            'Book'
        );
        serviceMocks.loadItem.mockResolvedValue(current);
        serviceMocks.saveItem.mockResolvedValue(saved);
        readingServiceMocks.search.mockResolvedValue({
            ...readingResponse(),
            candidates: [ candidate ]
        });
        await render({ itemId: 'item-a' });

        let result: Awaited<ReturnType<NonNullable<typeof latest>['refreshItem']>> | undefined;
        await act(async () => {
            result = await latest!.refreshItem('scan', false);
        });

        expect(readingServiceMocks.search).toHaveBeenCalledWith(
            expect.anything(),
            { itemId: 'item-a', provider: 'anilist', providerId: '30013' },
            expect.any(AbortSignal)
        );
        expect(serviceMocks.refreshItem).not.toHaveBeenCalled();
        expect(serviceMocks.saveItem).toHaveBeenCalledOnce();
        expect(result).toEqual({ kind: 'reading-exact', provider: 'AniList' });
    });

    it('fails closed when an exact Reading provider ID cannot be verified', async () => {
        const current = itemBundle(
            'item-a',
            metadataForm({ providerIds: { ComicVine: '40014' } }),
            'tag-a',
            'Book'
        );
        serviceMocks.loadItem.mockResolvedValue(current);
        readingServiceMocks.search.mockResolvedValue({ ...readingResponse(), candidates: [] });
        await render({ itemId: 'item-a' });

        await act(async () => {
            await expect(latest!.refreshItem('scan', false)).rejects.toThrow(
                'Comic Vine could not verify the saved provider identity.'
            );
        });

        expect(serviceMocks.refreshItem).not.toHaveBeenCalled();
        expect(serviceMocks.saveItem).not.toHaveBeenCalled();
    });

    it('retains Jellyfin refresh semantics when exact Reading refresh is not applicable', async () => {
        const book = itemBundle(
            'item-a',
            metadataForm({ providerIds: { AniList: '30013' } }),
            'tag-a',
            'Book'
        );
        serviceMocks.loadItem.mockResolvedValue(book);
        await render({ itemId: 'item-a' });

        let result: Awaited<ReturnType<NonNullable<typeof latest>['refreshItem']>> | undefined;
        await act(async () => {
            result = await latest!.refreshItem('replace-metadata', false);
        });

        expect(readingServiceMocks.search).not.toHaveBeenCalled();
        expect(serviceMocks.saveItem).not.toHaveBeenCalled();
        expect(serviceMocks.refreshItem).toHaveBeenCalledOnce();
        expect(result).toEqual({ kind: 'jellyfin' });
    });

    it('debounces search and normalizes invalid pagination without blanking the prior catalog', async () => {
        await render({ searchTerm: '', startIndex: -50 });
        await vi.waitFor(() => expect(serviceMocks.loadCatalog).toHaveBeenCalledOnce());
        expect(serviceMocks.loadCatalog.mock.calls[0][1].startIndex).toBe(0);

        await render({ searchTerm: '  Matrix  ', startIndex: -50 });
        expect(latest?.debouncedSearchTerm).toBe('');
        expect(latest?.catalogPage?.items[0]?.name).toBe('Original title');
        expect(serviceMocks.loadCatalog).toHaveBeenCalledOnce();

        await act(async () => new Promise(resolve => setTimeout(resolve, 375)));
        await vi.waitFor(() => expect(serviceMocks.loadCatalog).toHaveBeenCalledTimes(2));
        expect(serviceMocks.loadCatalog.mock.calls[1][1]).toMatchObject({
            searchTerm: 'Matrix',
            startIndex: 0
        });
    });

    it('adopts an authoritative save into the exact item and visible catalog caches', async () => {
        const saved = itemBundle(
            'item-a',
            metadataForm({ name: 'Saved title', productionYear: 2024 }),
            'tag-saved'
        );
        serviceMocks.saveItem.mockResolvedValue(saved);
        await render({ itemId: 'item-a' });
        await vi.waitFor(() => expect(latest?.itemBundle).not.toBeNull());

        await act(async () => {
            await latest?.saveMetadata(saved.form, metadataForm());
        });

        const keys = getAdminMetadataManagerQueryKeys('server-a');
        const itemCache = queryClient.getQueryData<AdminMetadataItemBundle>(
            keys.item('admin-a', 'item-a')
        );
        const catalogCache = queryClient.getQueryData<AdminMetadataCatalogPage>(
            keys.catalog(latest!.catalogRequest)
        );
        expect(itemCache?.form.name).toBe('Saved title');
        expect(catalogCache?.items[0]).toMatchObject({
            name: 'Saved title',
            primaryImageTag: 'tag-saved',
            productionYear: 2024
        });
        expect(latest?.isMutating).toBe(false);
    });

    it('single-flights duplicate actions and invalidates only exact relevant caches', async () => {
        let resolveUpload!: () => void;
        serviceMocks.uploadArtwork.mockReturnValue(new Promise<void>(resolve => {
            resolveUpload = resolve;
        }));
        await render({ artworkEnabled: true, itemId: 'item-a' });
        await vi.waitFor(() => expect(serviceMocks.loadArtwork).toHaveBeenCalledOnce());
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        const file = new File([ 'image' ], 'poster.png', { type: 'image/png' });

        let first!: Promise<void>;
        let second!: Promise<void>;
        await act(async () => {
            first = latest!.uploadArtwork({ file, imageType: ImageType.Primary });
            second = latest!.uploadArtwork({ file, imageType: ImageType.Primary });
        });
        expect(first).toBe(second);
        expect(serviceMocks.uploadArtwork).toHaveBeenCalledOnce();

        await act(async () => {
            resolveUpload();
            await first;
        });
        const keys = getAdminMetadataManagerQueryKeys('server-a');
        expect(invalidate).toHaveBeenCalledTimes(3);
        expect(invalidate.mock.calls.map(([ options ]) => options)).toEqual(expect.arrayContaining([
            { exact: true, queryKey: keys.images('item-a') },
            { exact: true, queryKey: keys.item('admin-a', 'item-a') },
            { exact: true, queryKey: keys.catalog(latest!.catalogRequest) }
        ]));
        expect(invalidate.mock.calls.every(([ options ]) => options?.exact === true)).toBe(true);
    });
});
