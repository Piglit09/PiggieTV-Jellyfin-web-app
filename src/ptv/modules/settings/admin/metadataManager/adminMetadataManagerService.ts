import type { Api } from '@jellyfin/sdk';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { ExternalIdInfo } from '@jellyfin/sdk/lib/generated-client/models/external-id-info';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import type { MetadataEditorInfo } from '@jellyfin/sdk/lib/generated-client/models/metadata-editor-info';
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order';
import { getImageApi } from '@jellyfin/sdk/lib/utils/api/image-api';
import { getItemLookupApi } from '@jellyfin/sdk/lib/utils/api/item-lookup-api';
import { getItemsApi } from '@jellyfin/sdk/lib/utils/api/items-api';
import { getItemUpdateApi } from '@jellyfin/sdk/lib/utils/api/item-update-api';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { getRemoteImageApi } from '@jellyfin/sdk/lib/utils/api/remote-image-api';
import { getUserLibraryApi } from '@jellyfin/sdk/lib/utils/api/user-library-api';

import type { ApiClient } from 'jellyfin-apiclient';

import { createPtvCoreRequestCancellation } from '../../../../core/api/apiContracts';
import { isPtvTimeoutError, withPtvTimeout } from '../../../../utils/withPtvTimeout';
import {
    areAdminMetadataFormsEqual,
    createAdminMetadataItemBundle,
    normalizeAdminMetadataArtwork,
    normalizeAdminMetadataCatalogPage,
    normalizeAdminMetadataIdentifyResults,
    normalizeAdminMetadataRemoteImagePage,
    normalizeAdminMetadataRemoteImageProviders,
    normalizeAdminMetadataRoots,
    patchAdminMetadataItem,
    requireAdminMetadataForm
} from './adminMetadataManagerAdapters';
import {
    ADMIN_METADATA_CATALOG_PAGE_SIZE,
    ADMIN_METADATA_REMOTE_IMAGE_PAGE_SIZE,
    AdminMetadataManagerServiceError,
    type AdminMetadataArtwork,
    type AdminMetadataCatalogPage,
    type AdminMetadataCatalogRequest,
    type AdminMetadataCatalogRoot,
    type AdminMetadataForm,
    type AdminMetadataIdentifyQuery,
    type AdminMetadataIdentifyResult,
    type AdminMetadataIdentifyType,
    type AdminMetadataItemBundle,
    type AdminMetadataProviderField,
    type AdminMetadataRefreshMode,
    type AdminMetadataRefreshOptions,
    type AdminMetadataRemoteImagePage,
    type AdminMetadataRemoteImageProvider
} from './adminMetadataManagerModel';

export const ADMIN_METADATA_ITEM_BUNDLE_TIMEOUT_MS = 15_000;

type ItemIdentityInput = Readonly<{
    itemId: string;
    userId?: string;
}>;

export type LoadAdminMetadataRootsInput = Readonly<{
    userId?: string;
}>;

export type SaveAdminMetadataItemInput = ItemIdentityInput & Readonly<{
    confirmedForm: AdminMetadataForm;
    desiredForm: AdminMetadataForm;
}>;

export type AdminMetadataArtworkInput = Readonly<{
    imageIndex?: number;
    imageType: ImageType;
    itemId: string;
}>;

export type UploadAdminMetadataArtworkInput = Readonly<{
    file: File;
    imageType: ImageType;
    itemId: string;
}>;

export type ReorderAdminMetadataArtworkInput = Required<AdminMetadataArtworkInput> & Readonly<{
    newIndex: number;
}>;

export type LoadAdminMetadataRemoteImagesInput = Readonly<{
    imageType: ImageType;
    itemId: string;
    providerName?: string;
    startIndex?: number;
}>;

export type DownloadAdminMetadataRemoteImageInput = Readonly<{
    imageType: ImageType;
    imageUrl: string;
    itemId: string;
}>;

export type SearchAdminMetadataIdentifyInput = Readonly<{
    itemId: string;
    itemType: AdminMetadataIdentifyType;
    query: AdminMetadataIdentifyQuery;
}>;

export type ApplyAdminMetadataIdentifyInput = ItemIdentityInput & Readonly<{
    result: AdminMetadataIdentifyResult;
}>;

export type RefreshAdminMetadataItemInput = Readonly<{
    itemId: string;
    options: AdminMetadataRefreshOptions;
}>;

const IMAGE_TYPES = new Set<string>(Object.values(ImageType));

function requireIdentity(value: unknown, label: 'item' | 'user' = 'item') {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id) {
        throw new AdminMetadataManagerServiceError(
            'invalid-input',
            label === 'item' ? 'Choose a valid item.' : 'The authenticated user is unavailable.'
        );
    }
    return id;
}

function requireImageType(value: unknown) {
    if (typeof value !== 'string' || !IMAGE_TYPES.has(value)) {
        throw new AdminMetadataManagerServiceError('invalid-input', 'Choose a supported artwork type.');
    }
    return value as ImageType;
}

function requireIndex(value: unknown, label = 'image') {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new AdminMetadataManagerServiceError('invalid-input', `Choose a valid ${label} position.`);
    }
    return value;
}

function isAbortError(error: unknown) {
    return (
        (typeof DOMException !== 'undefined'
            && error instanceof DOMException
            && error.name === 'AbortError')
        || (typeof error === 'object' && error !== null && (
            Reflect.get(error, 'code') === 'ERR_CANCELED'
            || Reflect.get(error, 'name') === 'CanceledError'
        ))
    );
}

function responseStatus(error: unknown) {
    if (!error || typeof error !== 'object') return null;
    const response = Reflect.get(error, 'response');
    if (!response || typeof response !== 'object') return null;
    const status = Reflect.get(response, 'status');
    return typeof status === 'number' ? status : null;
}

function throwSanitized(
    error: unknown,
    code: ConstructorParameters<typeof AdminMetadataManagerServiceError>[0],
    message: string
): never {
    if (error instanceof AdminMetadataManagerServiceError || isAbortError(error)) throw error;
    if (responseStatus(error) === 404) {
        throw new AdminMetadataManagerServiceError('item-not-found', 'This item is no longer available.');
    }
    throw new AdminMetadataManagerServiceError(code, message);
}

export async function loadAdminMetadataRoots(
    api: Api,
    _input: LoadAdminMetadataRootsInput = {},
    signal?: AbortSignal
): Promise<AdminMetadataCatalogRoot[]> {
    if (_input.userId !== undefined) requireIdentity(_input.userId, 'user');
    try {
        const response = await getLibraryApi(api).getMediaFolders({ isHidden: false }, { signal });
        let items: BaseItemDto[] | null = null;
        if (Array.isArray(response.data.Items)) {
            items = response.data.Items;
        } else if (response.data.Items == null && response.data.TotalRecordCount === 0) {
            items = [];
        }
        if (!items) {
            throw new AdminMetadataManagerServiceError(
                'invalid-response',
                'Metadata libraries are unavailable.'
            );
        }
        return normalizeAdminMetadataRoots(items);
    } catch (error) {
        return throwSanitized(error, 'catalog-unavailable', 'Metadata libraries could not be loaded.');
    }
}

export async function loadAdminMetadataCatalogPage(
    api: Api,
    request: AdminMetadataCatalogRequest,
    signal?: AbortSignal
): Promise<AdminMetadataCatalogPage> {
    const userId = requireIdentity(request.userId, 'user');
    const searchTerm = typeof request.searchTerm === 'string' ? request.searchTerm.trim() : '';
    const scope = searchTerm ? 'search' as const : 'children' as const;
    const parentId = requireIdentity(searchTerm ?
        (request.libraryId || request.parentId) : request.parentId);
    const startIndex = request.startIndex ?? 0;
    requireIndex(startIndex, 'page');
    try {
        const response = await getItemsApi(api).getItems({
            enableImages: true,
            enableTotalRecordCount: true,
            enableUserData: false,
            fields: [ ItemFields.ChildCount, ItemFields.ParentId ],
            imageTypeLimit: 1,
            limit: ADMIN_METADATA_CATALOG_PAGE_SIZE,
            parentId,
            recursive: scope === 'search',
            searchTerm: searchTerm || undefined,
            sortBy: [ ItemSortBy.IsFolder, ItemSortBy.SortName ],
            sortOrder: [ SortOrder.Descending, SortOrder.Ascending ],
            startIndex,
            userId
        }, { signal });
        return normalizeAdminMetadataCatalogPage(response.data, startIndex, scope);
    } catch (error) {
        return throwSanitized(error, 'catalog-unavailable', 'Catalog items could not be loaded.');
    }
}

async function loadExactAdminMetadataItem(
    api: Api,
    input: ItemIdentityInput,
    signal?: AbortSignal
): Promise<BaseItemDto> {
    const itemId = requireIdentity(input.itemId);
    const response = await getUserLibraryApi(api).getItem({
        itemId,
        userId: input.userId ? requireIdentity(input.userId, 'user') : undefined
    }, { signal });
    return response.data;
}

async function loadExactAdminMetadataEditor(
    api: Api,
    itemId: string,
    signal?: AbortSignal
): Promise<MetadataEditorInfo> {
    const response = await getItemUpdateApi(api).getMetadataEditorInfo({ itemId }, { signal });
    return response.data;
}

export async function loadAdminMetadataItemBundle(
    api: Api,
    input: ItemIdentityInput,
    signal?: AbortSignal
): Promise<AdminMetadataItemBundle> {
    const itemId = requireIdentity(input.itemId);
    const userId = input.userId ? requireIdentity(input.userId, 'user') : undefined;
    const request = createPtvCoreRequestCancellation({
        signal
    });
    try {
        const [ item, editorInfo, ancestorsResponse ] = await withPtvTimeout(
            Promise.all([
                loadExactAdminMetadataItem(api, { itemId, userId }, request.signal),
                loadExactAdminMetadataEditor(api, itemId, request.signal),
                getLibraryApi(api).getAncestors({ itemId, userId }, { signal: request.signal })
            ]),
            ADMIN_METADATA_ITEM_BUNDLE_TIMEOUT_MS,
            'Metadata item loading timed out.',
            request.abort,
            signal
        );
        return createAdminMetadataItemBundle(item, editorInfo, ancestorsResponse.data);
    } catch (error) {
        request.abort();
        if (signal?.aborted) throw error;
        if (isPtvTimeoutError(error)) {
            throw new AdminMetadataManagerServiceError(
                'item-unavailable',
                'This item took too long to load. Try again.'
            );
        }
        return throwSanitized(error, 'item-unavailable', 'This item could not be loaded.');
    } finally {
        request.dispose();
    }
}

async function reloadAdminMetadataItemAfterMutation(
    api: Api,
    input: ItemIdentityInput,
    signal: AbortSignal | undefined,
    message: string
): Promise<AdminMetadataItemBundle> {
    try {
        return await loadAdminMetadataItemBundle(api, input, signal);
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new AdminMetadataManagerServiceError('item-unavailable', message);
    }
}

const saveFlights = new WeakMap<Api, Map<string, Promise<AdminMetadataItemBundle>>>();

/** Refetches, compares the material form, patches the fresh DTO, updates and refetches. */
export function saveAdminMetadataItem(
    api: Api,
    input: SaveAdminMetadataItemInput,
    signal?: AbortSignal
): Promise<AdminMetadataItemBundle> {
    const itemId = requireIdentity(input.itemId);
    requireAdminMetadataForm(input.desiredForm);
    requireAdminMetadataForm(input.confirmedForm);
    let flights = saveFlights.get(api);
    if (!flights) {
        flights = new Map();
        saveFlights.set(api, flights);
    }
    const active = flights.get(itemId);
    if (active) return active;
    const promise = (async () => {
        const authoritative = await loadAdminMetadataItemBundle(api, input, signal);
        const fields = authoritative.editor.editableFields;
        if (!areAdminMetadataFormsEqual(authoritative.form, input.confirmedForm, fields)) {
            throw new AdminMetadataManagerServiceError(
                'conflict',
                'This item changed on the server while you were editing. Reload before saving.'
            );
        }
        if (areAdminMetadataFormsEqual(authoritative.form, input.desiredForm, fields)) {
            return authoritative;
        }
        const patched = patchAdminMetadataItem(
            authoritative.authoritativeItem,
            input.desiredForm,
            input.confirmedForm,
            fields
        );
        try {
            await getItemUpdateApi(api).updateItem({ itemId, baseItemDto: patched }, { signal });
        } catch (error) {
            return throwSanitized(error, 'save-failed', "We couldn't save metadata for this item.");
        }
        return reloadAdminMetadataItemAfterMutation(
            api,
            input,
            signal,
            'Metadata was saved, but the updated item could not be reloaded. Reload the page before trying again.'
        );
    })().finally(() => flights?.delete(itemId));
    flights.set(itemId, promise);
    return promise;
}

export async function loadAdminMetadataArtwork(
    api: Api,
    input: Pick<ItemIdentityInput, 'itemId'>,
    signal?: AbortSignal
): Promise<AdminMetadataArtwork[]> {
    const itemId = requireIdentity(input.itemId);
    try {
        const imageApi = getImageApi(api);
        const response = await imageApi.getItemImageInfos({ itemId }, { signal });
        return normalizeAdminMetadataArtwork(imageApi, itemId, response.data);
    } catch (error) {
        return throwSanitized(error, 'artwork-unavailable', 'Artwork could not be loaded.');
    }
}

/** Uses Jellyfin Web's proven authenticated File-to-base64 upload implementation. */
export async function uploadAdminMetadataArtwork(
    apiClient: ApiClient,
    input: UploadAdminMetadataArtworkInput
) {
    const itemId = requireIdentity(input.itemId);
    const imageType = requireImageType(input.imageType);
    if (!input.file || typeof input.file.type !== 'string' || !input.file.type.startsWith('image/')) {
        throw new AdminMetadataManagerServiceError('invalid-input', 'Choose a valid image file.');
    }
    try {
        await apiClient.uploadItemImage(itemId, imageType, input.file);
    } catch (error) {
        return throwSanitized(error, 'artwork-unavailable', "We couldn't upload this artwork.");
    }
}

export async function deleteAdminMetadataArtwork(
    api: Api,
    input: AdminMetadataArtworkInput,
    signal?: AbortSignal
) {
    const itemId = requireIdentity(input.itemId);
    const imageType = requireImageType(input.imageType);
    const imageIndex = input.imageIndex === undefined ? undefined : requireIndex(input.imageIndex);
    try {
        await getImageApi(api).deleteItemImage({ itemId, imageType, imageIndex }, { signal });
    } catch (error) {
        return throwSanitized(error, 'artwork-unavailable', "We couldn't remove this artwork.");
    }
}

export async function reorderAdminMetadataArtwork(
    api: Api,
    input: ReorderAdminMetadataArtworkInput,
    signal?: AbortSignal
) {
    const itemId = requireIdentity(input.itemId);
    const imageType = requireImageType(input.imageType);
    const imageIndex = requireIndex(input.imageIndex);
    const newIndex = requireIndex(input.newIndex);
    try {
        await getImageApi(api).updateItemImageIndex({
            imageIndex,
            imageType,
            itemId,
            newIndex
        }, { signal });
    } catch (error) {
        return throwSanitized(error, 'artwork-unavailable', "We couldn't reorder this artwork.");
    }
}

export async function loadAdminMetadataRemoteImageProviders(
    api: Api,
    input: Pick<ItemIdentityInput, 'itemId'>,
    signal?: AbortSignal
): Promise<AdminMetadataRemoteImageProvider[]> {
    const itemId = requireIdentity(input.itemId);
    try {
        const response = await getRemoteImageApi(api).getRemoteImageProviders({ itemId }, { signal });
        return normalizeAdminMetadataRemoteImageProviders(response.data);
    } catch (error) {
        return throwSanitized(
            error,
            'remote-artwork-unavailable',
            'Remote artwork providers are temporarily unavailable.'
        );
    }
}

export async function loadAdminMetadataRemoteImages(
    api: Api,
    input: LoadAdminMetadataRemoteImagesInput,
    signal?: AbortSignal
): Promise<AdminMetadataRemoteImagePage> {
    const itemId = requireIdentity(input.itemId);
    const imageType = requireImageType(input.imageType);
    const startIndex = input.startIndex ?? 0;
    requireIndex(startIndex, 'page');
    try {
        const response = await getRemoteImageApi(api).getRemoteImages({
            includeAllLanguages: true,
            itemId,
            limit: ADMIN_METADATA_REMOTE_IMAGE_PAGE_SIZE,
            providerName: input.providerName?.trim() || undefined,
            startIndex,
            type: imageType
        }, { signal });
        return normalizeAdminMetadataRemoteImagePage(response.data, startIndex);
    } catch (error) {
        return throwSanitized(error, 'remote-artwork-unavailable', 'Remote artwork could not be loaded.');
    }
}

export async function downloadAdminMetadataRemoteImage(
    api: Api,
    input: DownloadAdminMetadataRemoteImageInput,
    signal?: AbortSignal
) {
    const itemId = requireIdentity(input.itemId);
    const imageType = requireImageType(input.imageType);
    const imageUrl = typeof input.imageUrl === 'string' ? input.imageUrl.trim() : '';
    if (!imageUrl) {
        throw new AdminMetadataManagerServiceError('invalid-input', 'Choose remote artwork to download.');
    }
    try {
        await getRemoteImageApi(api).downloadRemoteImage({
            imageUrl,
            itemId,
            type: imageType
        }, { signal });
    } catch (error) {
        return throwSanitized(error, 'remote-artwork-unavailable', "We couldn't download this artwork.");
    }
}

export async function loadAdminMetadataIdentifyProviders(
    api: Api,
    input: Pick<ItemIdentityInput, 'itemId'>,
    signal?: AbortSignal
): Promise<AdminMetadataProviderField[]> {
    const itemId = requireIdentity(input.itemId);
    try {
        const response = await getItemLookupApi(api).getExternalIdInfos({ itemId }, { signal });
        if (!Array.isArray(response.data)) {
            throw new AdminMetadataManagerServiceError('invalid-response', 'Identify providers are unavailable.');
        }
        return response.data.flatMap((provider: ExternalIdInfo) => {
            const key = provider.Key?.trim();
            if (!key) return [];
            return [{
                available: true,
                key,
                label: provider.Name?.trim() || key,
                type: provider.Type || null,
                value: null
            }];
        });
    } catch (error) {
        return throwSanitized(error, 'identify-unavailable', 'Identify providers are temporarily unavailable.');
    }
}

function validateIdentifyQuery(query: AdminMetadataIdentifyQuery) {
    if (!query || typeof query !== 'object') {
        throw new AdminMetadataManagerServiceError('invalid-input', 'Enter identify search criteria.');
    }
    const name = typeof query.name === 'string' ? query.name.trim() : '';
    const providerIds = query.providerIds && typeof query.providerIds === 'object' ?
        Object.fromEntries(Object.entries(query.providerIds).filter(
            (entry): entry is [string, string | null] => entry[1] === null || typeof entry[1] === 'string'
        )) : {};
    if (!name && !Object.values(providerIds).some(Boolean)) {
        throw new AdminMetadataManagerServiceError(
            'invalid-input',
            'Enter a title or provider identifier to search.'
        );
    }
    if (query.year !== null && (!Number.isInteger(query.year) || !Number.isFinite(query.year))) {
        throw new AdminMetadataManagerServiceError('invalid-input', 'Enter a valid identify year.');
    }
    return { name, providerIds };
}

export async function searchAdminMetadataIdentify(
    api: Api,
    input: SearchAdminMetadataIdentifyInput,
    signal?: AbortSignal
): Promise<AdminMetadataIdentifyResult[]> {
    const itemId = requireIdentity(input.itemId);
    const { name, providerIds } = validateIdentifyQuery(input.query);
    const remoteQuery = {
        IncludeDisabledProviders: false,
        ItemId: itemId,
        SearchInfo: {
            Name: name,
            ProviderIds: providerIds,
            Year: input.query.year
        },
        SearchProviderName: input.query.providerName?.trim() || null
    };
    const lookup = getItemLookupApi(api);
    try {
        let response;
        switch (input.itemType) {
            case 'Movie':
                response = await lookup.getMovieRemoteSearchResults({ movieInfoRemoteSearchQuery: remoteQuery }, { signal });
                break;
            case 'Trailer':
                response = await lookup.getTrailerRemoteSearchResults({ trailerInfoRemoteSearchQuery: remoteQuery }, { signal });
                break;
            case 'Series':
                response = await lookup.getSeriesRemoteSearchResults({ seriesInfoRemoteSearchQuery: remoteQuery }, { signal });
                break;
            case 'BoxSet':
                response = await lookup.getBoxSetRemoteSearchResults({ boxSetInfoRemoteSearchQuery: remoteQuery }, { signal });
                break;
            case 'Person':
                response = await lookup.getPersonRemoteSearchResults({ personLookupInfoRemoteSearchQuery: remoteQuery }, { signal });
                break;
            case 'Book':
                // Use only the official typed contract. PTV supplemental Book
                // results cannot be safely applied through this endpoint.
                response = await lookup.getBookRemoteSearchResults({ bookInfoRemoteSearchQuery: remoteQuery }, { signal });
                break;
            case 'MusicAlbum':
                response = await lookup.getMusicAlbumRemoteSearchResults({ albumInfoRemoteSearchQuery: remoteQuery }, { signal });
                break;
            case 'MusicArtist':
                response = await lookup.getMusicArtistRemoteSearchResults({ artistInfoRemoteSearchQuery: remoteQuery }, { signal });
                break;
            case 'MusicVideo':
                response = await lookup.getMusicVideoRemoteSearchResults({ musicVideoInfoRemoteSearchQuery: remoteQuery }, { signal });
                break;
            default:
                throw new AdminMetadataManagerServiceError(
                    'unsupported-item-type',
                    'Identify is not available for this item type.'
                );
        }
        return normalizeAdminMetadataIdentifyResults(response.data);
    } catch (error) {
        return throwSanitized(error, 'identify-unavailable', 'Identify results could not be loaded.');
    }
}

const identifyFlights = new WeakMap<Api, Map<string, Promise<AdminMetadataItemBundle>>>();

export function applyAdminMetadataIdentifyResult(
    api: Api,
    input: ApplyAdminMetadataIdentifyInput,
    signal?: AbortSignal
): Promise<AdminMetadataItemBundle> {
    const itemId = requireIdentity(input.itemId);
    if (!input.result?.source || typeof input.result.source !== 'object') {
        throw new AdminMetadataManagerServiceError('invalid-input', 'Choose a valid identify result.');
    }
    const source = input.result.source;
    let flights = identifyFlights.get(api);
    if (!flights) {
        flights = new Map();
        identifyFlights.set(api, flights);
    }
    const active = flights.get(itemId);
    if (active) return active;
    const promise = (async () => {
        try {
            await getItemLookupApi(api).applySearchCriteria({
                itemId,
                remoteSearchResult: source,
                replaceAllImages: false
            }, { signal });
        } catch (error) {
            return throwSanitized(error, 'identify-unavailable', "We couldn't apply this identify result.");
        }
        return reloadAdminMetadataItemAfterMutation(
            api,
            input,
            signal,
            'The identify result was applied, but the updated item could not be reloaded. Reload the page before trying again.'
        );
    })().finally(() => flights?.delete(itemId));
    flights.set(itemId, promise);
    return promise;
}

export function createAdminMetadataRefreshOptions(
    mode: AdminMetadataRefreshMode,
    recursive = false
): AdminMetadataRefreshOptions {
    switch (mode) {
        case 'scan':
            return {
                imageMode: 'default',
                metadataMode: 'default',
                recursive,
                regenerateTrickplay: false,
                replaceAllImages: false,
                replaceAllMetadata: false
            };
        case 'missing':
            return {
                imageMode: 'full',
                metadataMode: 'full',
                recursive,
                regenerateTrickplay: false,
                replaceAllImages: false,
                replaceAllMetadata: false
            };
        case 'replace-metadata':
            return {
                imageMode: 'default',
                metadataMode: 'full',
                recursive,
                regenerateTrickplay: false,
                replaceAllImages: false,
                replaceAllMetadata: true
            };
        case 'replace-images':
            return {
                imageMode: 'full',
                metadataMode: 'default',
                recursive,
                regenerateTrickplay: false,
                replaceAllImages: true,
                replaceAllMetadata: false
            };
        case 'replace-all':
            return {
                imageMode: 'full',
                metadataMode: 'full',
                recursive,
                regenerateTrickplay: false,
                replaceAllImages: true,
                replaceAllMetadata: true
            };
        default:
            throw new AdminMetadataManagerServiceError('invalid-input', 'Choose a supported refresh mode.');
    }
}

function requireRefreshOptions(options: AdminMetadataRefreshOptions) {
    if (
        !options
        || ![ 'default', 'full' ].includes(options.imageMode)
        || ![ 'default', 'full' ].includes(options.metadataMode)
        || typeof options.recursive !== 'boolean'
        || typeof options.regenerateTrickplay !== 'boolean'
        || typeof options.replaceAllImages !== 'boolean'
        || typeof options.replaceAllMetadata !== 'boolean'
    ) {
        throw new AdminMetadataManagerServiceError('invalid-input', 'Review the refresh options.');
    }
    return options;
}

const refreshFlights = new WeakMap<ApiClient, Map<string, Promise<void>>>();

/** The legacy client is retained because it forwards Jellyfin's explicit Recursive option. */
export function refreshAdminMetadataItem(
    apiClient: ApiClient,
    input: RefreshAdminMetadataItemInput
): Promise<void> {
    const itemId = requireIdentity(input.itemId);
    const options = requireRefreshOptions(input.options);
    let flights = refreshFlights.get(apiClient);
    if (!flights) {
        flights = new Map();
        refreshFlights.set(apiClient, flights);
    }
    const active = flights.get(itemId);
    if (active) return active;
    const promise = apiClient.refreshItem(itemId, {
        ImageRefreshMode: options.imageMode === 'full' ? 'FullRefresh' : 'Default',
        MetadataRefreshMode: options.metadataMode === 'full' ? 'FullRefresh' : 'Default',
        Recursive: options.recursive,
        RegenerateTrickplay: options.regenerateTrickplay,
        ReplaceAllImages: options.replaceAllImages,
        ReplaceAllMetadata: options.replaceAllMetadata
    }).catch(error => throwSanitized(
        error,
        'refresh-unavailable',
        "We couldn't request a metadata refresh."
    )).finally(() => flights?.delete(itemId));
    flights.set(itemId, promise);
    return promise;
}
