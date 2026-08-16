import type { Api } from '@jellyfin/sdk';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import type { ApiClient } from 'jellyfin-apiclient';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    applySearchCriteria: vi.fn(),
    deleteItemImage: vi.fn(),
    downloadRemoteImage: vi.fn(),
    getAncestors: vi.fn(),
    getBookRemoteSearchResults: vi.fn(),
    getBoxSetRemoteSearchResults: vi.fn(),
    getExternalIdInfos: vi.fn(),
    getItem: vi.fn(),
    getItemImageInfos: vi.fn(),
    getItemImageUrlById: vi.fn(),
    getItems: vi.fn(),
    getMediaFolders: vi.fn(),
    getMetadataEditorInfo: vi.fn(),
    getMovieRemoteSearchResults: vi.fn(),
    getMusicAlbumRemoteSearchResults: vi.fn(),
    getMusicArtistRemoteSearchResults: vi.fn(),
    getMusicVideoRemoteSearchResults: vi.fn(),
    getPersonRemoteSearchResults: vi.fn(),
    getRemoteImageProviders: vi.fn(),
    getRemoteImages: vi.fn(),
    getSeriesRemoteSearchResults: vi.fn(),
    getTrailerRemoteSearchResults: vi.fn(),
    updateItem: vi.fn(),
    updateItemImageIndex: vi.fn()
}));

vi.mock('@jellyfin/sdk/lib/utils/api/library-api', () => ({
    getLibraryApi: () => ({
        getAncestors: apiMocks.getAncestors,
        getMediaFolders: apiMocks.getMediaFolders
    })
}));
vi.mock('@jellyfin/sdk/lib/utils/api/items-api', () => ({
    getItemsApi: () => ({ getItems: apiMocks.getItems })
}));
vi.mock('@jellyfin/sdk/lib/utils/api/user-library-api', () => ({
    getUserLibraryApi: () => ({ getItem: apiMocks.getItem })
}));
vi.mock('@jellyfin/sdk/lib/utils/api/item-update-api', () => ({
    getItemUpdateApi: () => ({
        getMetadataEditorInfo: apiMocks.getMetadataEditorInfo,
        updateItem: apiMocks.updateItem
    })
}));
vi.mock('@jellyfin/sdk/lib/utils/api/image-api', () => ({
    getImageApi: () => ({
        deleteItemImage: apiMocks.deleteItemImage,
        getItemImageInfos: apiMocks.getItemImageInfos,
        getItemImageUrlById: apiMocks.getItemImageUrlById,
        updateItemImageIndex: apiMocks.updateItemImageIndex
    })
}));
vi.mock('@jellyfin/sdk/lib/utils/api/remote-image-api', () => ({
    getRemoteImageApi: () => ({
        downloadRemoteImage: apiMocks.downloadRemoteImage,
        getRemoteImageProviders: apiMocks.getRemoteImageProviders,
        getRemoteImages: apiMocks.getRemoteImages
    })
}));
vi.mock('@jellyfin/sdk/lib/utils/api/item-lookup-api', () => ({
    getItemLookupApi: () => ({
        applySearchCriteria: apiMocks.applySearchCriteria,
        getBookRemoteSearchResults: apiMocks.getBookRemoteSearchResults,
        getBoxSetRemoteSearchResults: apiMocks.getBoxSetRemoteSearchResults,
        getExternalIdInfos: apiMocks.getExternalIdInfos,
        getMovieRemoteSearchResults: apiMocks.getMovieRemoteSearchResults,
        getMusicAlbumRemoteSearchResults: apiMocks.getMusicAlbumRemoteSearchResults,
        getMusicArtistRemoteSearchResults: apiMocks.getMusicArtistRemoteSearchResults,
        getMusicVideoRemoteSearchResults: apiMocks.getMusicVideoRemoteSearchResults,
        getPersonRemoteSearchResults: apiMocks.getPersonRemoteSearchResults,
        getSeriesRemoteSearchResults: apiMocks.getSeriesRemoteSearchResults,
        getTrailerRemoteSearchResults: apiMocks.getTrailerRemoteSearchResults
    })
}));

import { normalizeAdminMetadataForm } from './adminMetadataManagerAdapters';
import {
    applyAdminMetadataIdentifyResult,
    createAdminMetadataRefreshOptions,
    deleteAdminMetadataArtwork,
    downloadAdminMetadataRemoteImage,
    loadAdminMetadataArtwork,
    loadAdminMetadataCatalogPage,
    loadAdminMetadataIdentifyProviders,
    loadAdminMetadataItemBundle,
    loadAdminMetadataRemoteImageProviders,
    loadAdminMetadataRemoteImages,
    loadAdminMetadataRoots,
    refreshAdminMetadataItem,
    reorderAdminMetadataArtwork,
    saveAdminMetadataItem,
    searchAdminMetadataIdentify,
    uploadAdminMetadataArtwork
} from './adminMetadataManagerService';
import type { AdminMetadataIdentifyType } from './adminMetadataManagerModel';

const api = {} as Api;

function rawItem(overrides: Partial<BaseItemDto> = {}): BaseItemDto {
    return {
        ForcedSortName: 'Example, The',
        Genres: [ 'Drama' ],
        Id: 'item-a',
        ImageTags: { Primary: 'tag-a' },
        IsFolder: false,
        LockData: false,
        LockedFields: [],
        Name: 'The Example',
        Overview: 'Original overview',
        People: [{
            Id: 'person-a',
            Name: 'Actor One',
            Role: 'Lead',
            Type: 'Actor',
            UnknownPersonData: { keep: true }
        } as never],
        ProductionYear: 2024,
        ProviderIds: { Imdb: 'tt123', PluginId: 'keep-me' },
        Studios: [{ Id: 'studio-a', Name: 'Studio One' }],
        Taglines: [ 'Tagline' ],
        Tags: [ 'Favorite' ],
        Type: 'Movie',
        ...overrides
    };
}

const editorInfo = {
    ExternalIdInfos: [{ Key: 'Imdb', Name: 'IMDb', Type: 'Movie' }],
    ParentalRatingOptions: [{ Name: 'PG' }]
};

function remoteResult() {
    return {
        data: [{
            ImageUrl: 'https://images/poster.jpg',
            Name: 'Matched title',
            ProductionYear: 2023,
            ProviderIds: { Imdb: 'tt999' },
            SearchProviderName: 'Provider'
        }]
    };
}

describe('Metadata Manager service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMocks.getMediaFolders.mockResolvedValue({
            data: { Items: [ rawItem({ CollectionType: 'movies', Type: 'CollectionFolder' }) ] }
        });
        apiMocks.getItems.mockResolvedValue({ data: { Items: [ rawItem() ], TotalRecordCount: 1 } });
        apiMocks.getItem.mockResolvedValue({ data: rawItem() });
        apiMocks.getMetadataEditorInfo.mockResolvedValue({ data: editorInfo });
        apiMocks.getAncestors.mockResolvedValue({
            data: [ rawItem({ Id: 'library-a', Name: 'Movies', Type: 'CollectionFolder' }) ]
        });
        apiMocks.updateItem.mockResolvedValue({});
        apiMocks.getItemImageInfos.mockResolvedValue({ data: [] });
        apiMocks.getItemImageUrlById.mockReturnValue('/thumbnail');
        apiMocks.deleteItemImage.mockResolvedValue({});
        apiMocks.updateItemImageIndex.mockResolvedValue({});
        apiMocks.getRemoteImageProviders.mockResolvedValue({
            data: [{ Name: 'Provider', SupportedImages: [ ImageType.Primary ] }]
        });
        apiMocks.getRemoteImages.mockResolvedValue({ data: { Images: [], TotalRecordCount: 0 } });
        apiMocks.downloadRemoteImage.mockResolvedValue({});
        apiMocks.getExternalIdInfos.mockResolvedValue({
            data: [{ Key: 'Imdb', Name: 'IMDb', Type: 'Movie' }]
        });
        [
            apiMocks.getBookRemoteSearchResults,
            apiMocks.getBoxSetRemoteSearchResults,
            apiMocks.getMovieRemoteSearchResults,
            apiMocks.getMusicAlbumRemoteSearchResults,
            apiMocks.getMusicArtistRemoteSearchResults,
            apiMocks.getMusicVideoRemoteSearchResults,
            apiMocks.getPersonRemoteSearchResults,
            apiMocks.getSeriesRemoteSearchResults,
            apiMocks.getTrailerRemoteSearchResults
        ].forEach(mock => {
            mock.mockResolvedValue(remoteResult());
        });
        apiMocks.applySearchCriteria.mockResolvedValue({});
    });

    it('loads only media-folder roots and forwards AbortSignal', async () => {
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();
        const roots = await loadAdminMetadataRoots(api, { userId: 'user-a' }, controller.signal);

        expect(roots).toHaveLength(1);
        expect(apiMocks.getMediaFolders).toHaveBeenCalledWith(
            { isHidden: false },
            { signal: controller.signal }
        );
        expect(apiMocks.getItems).not.toHaveBeenCalled();
        expect(apiMocks.getItem).not.toHaveBeenCalled();
    });

    it('uses one bounded non-recursive children request with total count', async () => {
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();
        const page = await loadAdminMetadataCatalogPage(api, {
            parentId: 'folder-a',
            startIndex: 50,
            userId: 'user-a'
        }, controller.signal);

        expect(page).toMatchObject({ limit: 50, scope: 'children', startIndex: 50 });
        expect(apiMocks.getItems).toHaveBeenCalledOnce();
        expect(apiMocks.getItems.mock.calls[0][0]).toMatchObject({
            enableTotalRecordCount: true,
            limit: 50,
            parentId: 'folder-a',
            recursive: false,
            startIndex: 50,
            userId: 'user-a'
        });
        expect(apiMocks.getItems.mock.calls[0][0].searchTerm).toBeUndefined();
        expect(apiMocks.getItems.mock.calls[0][1]).toEqual({ signal: controller.signal });
    });

    it('scopes recursive search to the selected library and keeps the request bounded', async () => {
        await loadAdminMetadataCatalogPage(api, {
            libraryId: 'library-a',
            parentId: 'folder-a',
            searchTerm: ' matrix ',
            userId: 'user-a'
        });

        expect(apiMocks.getItems.mock.calls[0][0]).toMatchObject({
            limit: 50,
            parentId: 'library-a',
            recursive: true,
            searchTerm: 'matrix',
            startIndex: 0
        });
    });

    it('loads exact item, editor information and ancestors in one bundle', async () => {
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();
        const bundle = await loadAdminMetadataItemBundle(api, {
            itemId: 'item-a',
            userId: 'user-a'
        }, controller.signal);

        expect(bundle.item.id).toBe('item-a');
        expect(bundle.editor.providerFields[0].label).toBe('IMDb');
        expect(bundle.ancestors[0].id).toBe('library-a');
        expect(apiMocks.getItem).toHaveBeenCalledWith(
            { itemId: 'item-a', userId: 'user-a' },
            { signal: controller.signal }
        );
        expect(apiMocks.getMetadataEditorInfo).toHaveBeenCalledWith(
            { itemId: 'item-a' },
            { signal: controller.signal }
        );
        expect(apiMocks.getAncestors).toHaveBeenCalledWith(
            { itemId: 'item-a', userId: 'user-a' },
            { signal: controller.signal }
        );
    });

    it('sanitizes transport failures and distinguishes an externally deleted item', async () => {
        apiMocks.getItem.mockRejectedValueOnce(new Error('private filesystem response'));
        await expect(loadAdminMetadataItemBundle(api, { itemId: 'item-a' })).rejects.toMatchObject({
            code: 'item-unavailable',
            message: 'This item could not be loaded.'
        });

        apiMocks.getItem.mockRejectedValueOnce({ response: { data: 'private', status: 404 } });
        await expect(loadAdminMetadataItemBundle(api, { itemId: 'item-a' })).rejects.toMatchObject({
            code: 'item-not-found',
            message: 'This item is no longer available.'
        });
    });

    it('refetches, patches the fresh complete DTO, updates the exact item, then refetches', async () => {
        const authoritative = rawItem({
            FutureTopLevel: { nested: [ 'preserve' ] }
        } as never);
        const confirmedForm = normalizeAdminMetadataForm(authoritative);
        const desiredForm = { ...confirmedForm, name: 'Renamed', overview: 'Updated overview' };
        apiMocks.getItem
            .mockResolvedValueOnce({ data: authoritative })
            .mockResolvedValueOnce({ data: rawItem({ ...authoritative, Name: 'Renamed', Overview: 'Updated overview' }) });

        const saved = await saveAdminMetadataItem(api, {
            confirmedForm,
            desiredForm,
            itemId: 'item-a',
            userId: 'user-a'
        });

        expect(apiMocks.getItem).toHaveBeenCalledTimes(2);
        expect(apiMocks.updateItem).toHaveBeenCalledOnce();
        const outgoing = apiMocks.updateItem.mock.calls[0][0].baseItemDto as BaseItemDto;
        expect(apiMocks.updateItem.mock.calls[0][0].itemId).toBe('item-a');
        expect(outgoing.Name).toBe('Renamed');
        expect(outgoing.Overview).toBe('Updated overview');
        expect(outgoing.ProviderIds).toEqual({ Imdb: 'tt123', PluginId: 'keep-me' });
        expect(Reflect.get(outgoing, 'FutureTopLevel')).toEqual({ nested: [ 'preserve' ] });
        expect(Reflect.get(outgoing.People![0], 'UnknownPersonData')).toEqual({ keep: true });
        expect(saved.form.name).toBe('Renamed');
    });

    it('fails closed on a material baseline conflict before any update', async () => {
        const confirmedForm = normalizeAdminMetadataForm(rawItem());
        apiMocks.getItem.mockResolvedValue({ data: rawItem({ Overview: 'Changed elsewhere' }) });

        await expect(saveAdminMetadataItem(api, {
            confirmedForm,
            desiredForm: { ...confirmedForm, name: 'Desired rename' },
            itemId: 'item-a'
        })).rejects.toMatchObject({ code: 'conflict' });
        expect(apiMocks.updateItem).not.toHaveBeenCalled();
    });

    it('performs no update when fresh authoritative values already match desired values', async () => {
        const confirmedForm = normalizeAdminMetadataForm(rawItem());
        const saved = await saveAdminMetadataItem(api, {
            confirmedForm,
            desiredForm: confirmedForm,
            itemId: 'item-a'
        });

        expect(saved.form).toEqual(confirmedForm);
        expect(apiMocks.updateItem).not.toHaveBeenCalled();
        expect(apiMocks.getItem).toHaveBeenCalledOnce();
    });

    it('single-flights duplicate saves for the same item', async () => {
        let resolveUpdate!: () => void;
        apiMocks.updateItem.mockImplementation(() => new Promise<void>(resolve => {
            resolveUpdate = resolve;
        }));
        const confirmedForm = normalizeAdminMetadataForm(rawItem());
        const input = {
            confirmedForm,
            desiredForm: { ...confirmedForm, name: 'Renamed' },
            itemId: 'item-a'
        };

        const first = saveAdminMetadataItem(api, input);
        const second = saveAdminMetadataItem(api, input);
        await vi.waitFor(() => expect(apiMocks.updateItem).toHaveBeenCalledOnce());
        expect(second).toBe(first);
        resolveUpdate();
        await first;
        expect(apiMocks.updateItem).toHaveBeenCalledOnce();
    });

    it('uses normalized artwork reads and proven legacy upload without mutating on load', async () => {
        apiMocks.getItemImageInfos.mockResolvedValue({
            data: [{ ImageIndex: 0, ImageTag: 'tag-a', ImageType: ImageType.Primary }]
        });
        const uploadItemImage = vi.fn().mockResolvedValue(undefined);
        const file = { type: 'image/png' } as File;

        const artwork = await loadAdminMetadataArtwork(api, { itemId: 'item-a' });
        await uploadAdminMetadataArtwork({ uploadItemImage } as never, {
            file,
            imageType: ImageType.Primary,
            itemId: 'item-a'
        });

        expect(artwork[0].previewUrl).toBe('/thumbnail');
        expect(uploadItemImage).toHaveBeenCalledWith('item-a', ImageType.Primary, file);
        expect(apiMocks.deleteItemImage).not.toHaveBeenCalled();
        expect(apiMocks.downloadRemoteImage).not.toHaveBeenCalled();
    });

    it('rejects non-image uploads before calling the legacy client', async () => {
        const uploadItemImage = vi.fn();
        await expect(uploadAdminMetadataArtwork({ uploadItemImage } as never, {
            file: { type: 'text/plain' } as File,
            imageType: ImageType.Primary,
            itemId: 'item-a'
        })).rejects.toMatchObject({ code: 'invalid-input' });
        expect(uploadItemImage).not.toHaveBeenCalled();
    });

    it('uses exact SDK contracts for explicit artwork delete and reorder', async () => {
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();
        await deleteAdminMetadataArtwork(api, {
            imageIndex: 1,
            imageType: ImageType.Backdrop,
            itemId: 'item-a'
        }, controller.signal);
        await reorderAdminMetadataArtwork(api, {
            imageIndex: 2,
            imageType: ImageType.Backdrop,
            itemId: 'item-a',
            newIndex: 0
        }, controller.signal);

        expect(apiMocks.deleteItemImage).toHaveBeenCalledWith({
            imageIndex: 1,
            imageType: ImageType.Backdrop,
            itemId: 'item-a'
        }, { signal: controller.signal });
        expect(apiMocks.updateItemImageIndex).toHaveBeenCalledWith({
            imageIndex: 2,
            imageType: ImageType.Backdrop,
            itemId: 'item-a',
            newIndex: 0
        }, { signal: controller.signal });
    });

    it('lazy-loads bounded remote providers/results and only downloads explicitly', async () => {
        apiMocks.getRemoteImages.mockResolvedValue({
            data: {
                Images: [{ ProviderName: 'Provider', Type: ImageType.Primary, Url: 'https://image/full.jpg' }],
                TotalRecordCount: 1
            }
        });
        const providers = await loadAdminMetadataRemoteImageProviders(api, { itemId: 'item-a' });
        const page = await loadAdminMetadataRemoteImages(api, {
            imageType: ImageType.Primary,
            itemId: 'item-a',
            providerName: 'Provider'
        });

        expect(providers[0].name).toBe('Provider');
        expect(page.limit).toBe(30);
        expect(apiMocks.getRemoteImages.mock.calls[0][0]).toMatchObject({
            includeAllLanguages: true,
            itemId: 'item-a',
            limit: 30,
            providerName: 'Provider',
            startIndex: 0,
            type: ImageType.Primary
        });
        expect(apiMocks.downloadRemoteImage).not.toHaveBeenCalled();

        await downloadAdminMetadataRemoteImage(api, {
            imageType: ImageType.Primary,
            imageUrl: page.items[0].url,
            itemId: 'item-a'
        });
        expect(apiMocks.downloadRemoteImage).toHaveBeenCalledWith({
            imageUrl: 'https://image/full.jpg',
            itemId: 'item-a',
            type: ImageType.Primary
        }, { signal: undefined });
    });

    it('loads identify provider capabilities independently', async () => {
        const providers = await loadAdminMetadataIdentifyProviders(api, { itemId: 'item-a' });
        expect(providers).toEqual([{
            available: true,
            key: 'Imdb',
            label: 'IMDb',
            type: 'Movie',
            value: null
        }]);
        expect(apiMocks.getMovieRemoteSearchResults).not.toHaveBeenCalled();
    });

    const identifyCases: Array<[AdminMetadataIdentifyType, keyof typeof apiMocks, string]> = [
        [ 'Movie', 'getMovieRemoteSearchResults', 'movieInfoRemoteSearchQuery' ],
        [ 'Trailer', 'getTrailerRemoteSearchResults', 'trailerInfoRemoteSearchQuery' ],
        [ 'Series', 'getSeriesRemoteSearchResults', 'seriesInfoRemoteSearchQuery' ],
        [ 'BoxSet', 'getBoxSetRemoteSearchResults', 'boxSetInfoRemoteSearchQuery' ],
        [ 'Person', 'getPersonRemoteSearchResults', 'personLookupInfoRemoteSearchQuery' ],
        [ 'Book', 'getBookRemoteSearchResults', 'bookInfoRemoteSearchQuery' ],
        [ 'MusicAlbum', 'getMusicAlbumRemoteSearchResults', 'albumInfoRemoteSearchQuery' ],
        [ 'MusicArtist', 'getMusicArtistRemoteSearchResults', 'artistInfoRemoteSearchQuery' ],
        [ 'MusicVideo', 'getMusicVideoRemoteSearchResults', 'musicVideoInfoRemoteSearchQuery' ]
    ];

    it.each(identifyCases)('uses the official typed %s identify endpoint', async (
        itemType,
        mockName,
        wrapperName
    ) => {
        const results = await searchAdminMetadataIdentify(api, {
            itemId: 'item-a',
            itemType,
            query: {
                name: ' Example ',
                providerIds: { Imdb: 'tt123' },
                providerName: 'Provider',
                year: 2024
            }
        });

        const mock = apiMocks[mockName] as ReturnType<typeof vi.fn>;
        expect(mock).toHaveBeenCalledOnce();
        expect(mock.mock.calls[0][0][wrapperName]).toMatchObject({
            IncludeDisabledProviders: false,
            ItemId: 'item-a',
            SearchInfo: {
                Name: 'Example',
                ProviderIds: { Imdb: 'tt123' },
                Year: 2024
            },
            SearchProviderName: 'Provider'
        });
        expect(results[0]).toMatchObject({ name: 'Matched title', providerName: 'Provider' });
    });

    it('rejects unsupported identify types and empty criteria without a request', async () => {
        await expect(searchAdminMetadataIdentify(api, {
            itemId: 'item-a',
            itemType: 'Episode' as never,
            query: { name: 'Episode', providerIds: {}, year: null }
        })).rejects.toMatchObject({ code: 'unsupported-item-type' });
        await expect(searchAdminMetadataIdentify(api, {
            itemId: 'item-a',
            itemType: 'Movie',
            query: { name: '', providerIds: {}, year: null }
        })).rejects.toMatchObject({ code: 'invalid-input' });
    });

    it('applies an identify result explicitly with image replacement disabled, then refetches', async () => {
        const result = (await searchAdminMetadataIdentify(api, {
            itemId: 'item-a',
            itemType: 'Movie',
            query: { name: 'Example', providerIds: {}, year: null }
        }))[0];
        const bundle = await applyAdminMetadataIdentifyResult(api, {
            itemId: 'item-a',
            result,
            userId: 'user-a'
        });

        expect(apiMocks.applySearchCriteria).toHaveBeenCalledWith({
            itemId: 'item-a',
            remoteSearchResult: result.source,
            replaceAllImages: false
        }, { signal: undefined });
        expect(bundle.item.id).toBe('item-a');
        expect(apiMocks.getItem).toHaveBeenCalledOnce();
    });

    it('creates explicit safe refresh presets', () => {
        expect(createAdminMetadataRefreshOptions('scan')).toEqual({
            imageMode: 'default',
            metadataMode: 'default',
            recursive: false,
            regenerateTrickplay: false,
            replaceAllImages: false,
            replaceAllMetadata: false
        });
        expect(createAdminMetadataRefreshOptions('replace-all', true)).toMatchObject({
            imageMode: 'full',
            metadataMode: 'full',
            recursive: true,
            replaceAllImages: true,
            replaceAllMetadata: true
        });
    });

    it('uses explicit legacy refresh options and single-flights duplicate item requests', async () => {
        let resolveRefresh!: () => void;
        const refreshItem = vi.fn(() => new Promise<void>(resolve => {
            resolveRefresh = resolve;
        }));
        const apiClient = { refreshItem } as never as ApiClient;
        const input = {
            itemId: 'item-a',
            options: createAdminMetadataRefreshOptions('replace-metadata', true)
        };

        const first = refreshAdminMetadataItem(apiClient, input);
        const second = refreshAdminMetadataItem(apiClient, input);
        expect(second).toBe(first);
        expect(refreshItem).toHaveBeenCalledOnce();
        expect(refreshItem).toHaveBeenCalledWith('item-a', {
            ImageRefreshMode: 'Default',
            MetadataRefreshMode: 'FullRefresh',
            Recursive: true,
            RegenerateTrickplay: false,
            ReplaceAllImages: false,
            ReplaceAllMetadata: true
        });
        resolveRefresh();
        await first;
    });

    it('sanitizes artwork, identify, save and refresh errors', async () => {
        apiMocks.getItemImageInfos.mockRejectedValue(new Error('/secret/path'));
        await expect(loadAdminMetadataArtwork(api, { itemId: 'item-a' })).rejects.toMatchObject({
            code: 'artwork-unavailable',
            message: 'Artwork could not be loaded.'
        });

        apiMocks.getMovieRemoteSearchResults.mockRejectedValue(new Error('private provider response'));
        await expect(searchAdminMetadataIdentify(api, {
            itemId: 'item-a',
            itemType: 'Movie',
            query: { name: 'Example', providerIds: {}, year: null }
        })).rejects.toMatchObject({ code: 'identify-unavailable' });

        apiMocks.updateItem.mockRejectedValue(new Error('private item object'));
        const confirmedForm = normalizeAdminMetadataForm(rawItem());
        await expect(saveAdminMetadataItem(api, {
            confirmedForm,
            desiredForm: { ...confirmedForm, name: 'Changed' },
            itemId: 'item-a'
        })).rejects.toMatchObject({ code: 'save-failed' });

        const refreshItem = vi.fn().mockRejectedValue(new Error('private refresh data'));
        await expect(refreshAdminMetadataItem({ refreshItem } as never, {
            itemId: 'item-a',
            options: createAdminMetadataRefreshOptions('scan')
        })).rejects.toMatchObject({
            code: 'refresh-unavailable',
            message: "We couldn't request a metadata refresh."
        });
    });
});
