import type { Api } from '@jellyfin/sdk';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getCurrentPtvPluginApiClient } from '../../../../core/pluginApi';
import { getResolvedAdminServerId } from '../adminServerIdentity';
import {
    createAdminMetadataFormFromReadingCandidate,
    findAdminStoredReadingProviderIdentity
} from './adminReadingMetadataAdapters';
import type { AdminReadingMetadataSearchRequest } from './adminReadingMetadataModel';
import {
    loadAdminReadingMetadataProviders,
    searchAdminReadingMetadata
} from './adminReadingMetadataService';
import {
    ADMIN_METADATA_CATALOG_PAGE_SIZE,
    ADMIN_METADATA_REMOTE_IMAGE_PAGE_SIZE,
    AdminMetadataManagerServiceError,
    type AdminMetadataCatalogPage,
    type AdminMetadataCatalogRequest,
    type AdminMetadataForm,
    type AdminMetadataIdentifyQuery,
    type AdminMetadataIdentifyResult,
    type AdminMetadataIdentifyType,
    type AdminMetadataItemBundle,
    type AdminMetadataRefreshMode
} from './adminMetadataManagerModel';
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
    uploadAdminMetadataArtwork,
    type AdminMetadataArtworkInput,
    type DownloadAdminMetadataRemoteImageInput,
    type LoadAdminMetadataRemoteImagesInput,
    type ReorderAdminMetadataArtworkInput,
    type SearchAdminMetadataIdentifyInput,
    type UploadAdminMetadataArtworkInput
} from './adminMetadataManagerService';

const ADMIN_METADATA_MANAGER_QUERY_SCOPE = 'PtvAdminMetadataManager';
const ADMIN_METADATA_SEARCH_DEBOUNCE_MS = 350;

type AdminMetadataManagerMutation =
    | 'apply-identify'
    | 'delete-artwork'
    | 'download-artwork'
    | 'refresh'
    | 'reorder-artwork'
    | 'save'
    | 'upload-artwork';

export type UseAdminMetadataManagerInput = Readonly<{
    api?: Api;
    apiClient?: ApiClient;
    artworkEnabled?: boolean;
    itemId?: string;
    libraryId?: string;
    parentId?: string;
    searchTerm?: string;
    startIndex?: number;
    userId?: string;
}>;

function normalizeText(value?: string) {
    return value?.trim() || '';
}

function normalizeStartIndex(value?: number) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeProviderIds(providerIds: AdminMetadataIdentifyQuery['providerIds']) {
    return Object.fromEntries(
        Object.entries(providerIds || {})
            .sort(([ left ], [ right ]) => left.localeCompare(right))
    );
}

function normalizeIdentifyQuery(query: AdminMetadataIdentifyQuery) {
    return {
        author: normalizeText(query.author),
        chapterNumber: normalizeText(query.chapterNumber),
        isbn: normalizeText(query.isbn),
        issueNumber: normalizeText(query.issueNumber),
        mediaClass: query.mediaClass || 'unknown',
        name: normalizeText(query.name),
        providerId: normalizeText(query.providerId),
        providerIds: normalizeProviderIds(query.providerIds),
        providerName: normalizeText(query.providerName),
        seriesTitle: normalizeText(query.seriesTitle),
        volumeNumber: normalizeText(query.volumeNumber),
        year: query.year
    } as const;
}

export function createAdminMetadataCatalogRequest(input: Pick<
    UseAdminMetadataManagerInput,
    'libraryId' | 'parentId' | 'searchTerm' | 'startIndex' | 'userId'
>): AdminMetadataCatalogRequest {
    const libraryId = normalizeText(input.libraryId);
    const parentId = normalizeText(input.parentId) || libraryId;
    const searchTerm = normalizeText(input.searchTerm);

    return {
        libraryId: libraryId || undefined,
        parentId: parentId || undefined,
        searchTerm: searchTerm || undefined,
        startIndex: normalizeStartIndex(input.startIndex),
        userId: normalizeText(input.userId)
    };
}

/** Server- and source-scoped query identities for the complete workspace. */
export function getAdminMetadataManagerQueryKeys(serverKey: string) {
    const scope = [ ADMIN_METADATA_MANAGER_QUERY_SCOPE, normalizeText(serverKey) || 'unresolved-server' ] as const;

    return {
        catalog: (request: AdminMetadataCatalogRequest) => [
            ...scope,
            'catalog',
            {
                libraryId: normalizeText(request.libraryId),
                limit: ADMIN_METADATA_CATALOG_PAGE_SIZE,
                parentId: normalizeText(request.parentId),
                searchTerm: normalizeText(request.searchTerm),
                startIndex: normalizeStartIndex(request.startIndex),
                userId: normalizeText(request.userId)
            }
        ] as const,
        identifyProviders: (itemId: string) => [
            ...scope,
            'identify',
            'providers',
            { itemId: normalizeText(itemId) }
        ] as const,
        identifyResults: (
            itemId: string,
            itemType: AdminMetadataIdentifyType,
            query: AdminMetadataIdentifyQuery
        ) => [
            ...scope,
            'identify',
            'results',
            {
                itemId: normalizeText(itemId),
                itemType,
                query: normalizeIdentifyQuery(query)
            }
        ] as const,
        readingProviders: () => [
            ...scope,
            'reading-identify',
            'providers'
        ] as const,
        readingResults: (request: AdminReadingMetadataSearchRequest) => [
            ...scope,
            'reading-identify',
            'results',
            {
                ...request,
                author: normalizeText(request.author || undefined),
                chapterNumber: normalizeText(request.chapterNumber || undefined),
                isbn: normalizeText(request.isbn || undefined),
                issueNumber: normalizeText(request.issueNumber || undefined),
                itemId: normalizeText(request.itemId),
                provider: normalizeText(request.provider || undefined),
                providerId: normalizeText(request.providerId || undefined),
                seriesTitle: normalizeText(request.seriesTitle || undefined),
                title: normalizeText(request.title || undefined),
                volumeNumber: normalizeText(request.volumeNumber || undefined)
            }
        ] as const,
        images: (itemId: string) => [
            ...scope,
            'images',
            { itemId: normalizeText(itemId) }
        ] as const,
        item: (userId: string, itemId: string) => [
            ...scope,
            'item',
            { itemId: normalizeText(itemId), userId: normalizeText(userId) }
        ] as const,
        remoteImageProviders: (itemId: string) => [
            ...scope,
            'remote-images',
            'providers',
            { itemId: normalizeText(itemId) }
        ] as const,
        remoteImages: (input: LoadAdminMetadataRemoteImagesInput) => [
            ...scope,
            'remote-images',
            'results',
            {
                imageType: input.imageType,
                itemId: normalizeText(input.itemId),
                limit: ADMIN_METADATA_REMOTE_IMAGE_PAGE_SIZE,
                providerName: normalizeText(input.providerName),
                startIndex: normalizeStartIndex(input.startIndex)
            }
        ] as const,
        roots: (userId: string) => [
            ...scope,
            'roots',
            { userId: normalizeText(userId) }
        ] as const,
        scope
    };
}

function useDebouncedText(value: string) {
    const [ debounced, setDebounced ] = useState(value);

    useEffect(() => {
        const timeout = window.setTimeout(() => setDebounced(value), ADMIN_METADATA_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timeout);
    }, [ value ]);

    return debounced;
}

function updateCatalogItem(
    page: AdminMetadataCatalogPage | undefined,
    bundle: AdminMetadataItemBundle
) {
    if (!page?.items.some(item => item.id === bundle.item.id)) return page;

    return {
        ...page,
        items: page.items.map(item => item.id === bundle.item.id ? {
            ...item,
            name: bundle.form.name,
            primaryImageTag: bundle.item.primaryImageTag,
            productionYear: bundle.form.productionYear
        } : item)
    };
}

function requireResource<T>(resource: T | undefined, message: string): T {
    if (resource) return resource;
    throw new AdminMetadataManagerServiceError('item-unavailable', message);
}

export function useAdminMetadataManager(input: UseAdminMetadataManagerInput) {
    const {
        api,
        apiClient,
        artworkEnabled = false
    } = input;
    const serverKey = getResolvedAdminServerId(apiClient);
    const userId = normalizeText(input.userId);
    const itemId = normalizeText(input.itemId);
    const searchTerm = normalizeText(input.searchTerm);
    const debouncedSearchTerm = useDebouncedText(searchTerm);
    const queryClient = useQueryClient();
    const readingApi = useMemo(() => getCurrentPtvPluginApiClient(apiClient), [ apiClient ]);
    const keys = useMemo(
        () => getAdminMetadataManagerQueryKeys(serverKey || 'unresolved-server'),
        [ serverKey ]
    );
    const catalogRequest = useMemo(() => createAdminMetadataCatalogRequest({
        libraryId: input.libraryId,
        parentId: input.parentId,
        searchTerm: debouncedSearchTerm,
        startIndex: input.startIndex,
        userId
    }), [ debouncedSearchTerm, input.libraryId, input.parentId, input.startIndex, userId ]);
    const rootsKey = keys.roots(userId);
    const catalogKey = keys.catalog(catalogRequest);
    const itemKey = keys.item(userId, itemId);
    const imagesKey = keys.images(itemId);
    const queriesEnabled = Boolean(api && serverKey);
    const catalogEnabled = Boolean(queriesEnabled && userId && catalogRequest.parentId);
    const itemEnabled = Boolean(queriesEnabled && itemId);

    const rootsQuery = useQuery({
        enabled: queriesEnabled,
        queryFn: ({ signal }) => loadAdminMetadataRoots(api!, { userId: userId || undefined }, signal),
        queryKey: rootsKey,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 60_000
    });
    const catalogQuery = useQuery({
        enabled: catalogEnabled,
        placeholderData: keepPreviousData,
        queryFn: ({ signal }) => loadAdminMetadataCatalogPage(api!, catalogRequest, signal),
        queryKey: catalogKey,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 15_000
    });
    const itemQuery = useQuery({
        enabled: itemEnabled,
        queryFn: ({ signal }) => loadAdminMetadataItemBundle(
            api!,
            { itemId, userId: userId || undefined },
            signal
        ),
        queryKey: itemKey,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 10_000
    });
    const artworkQuery = useQuery({
        enabled: Boolean(itemEnabled && artworkEnabled),
        queryFn: ({ signal }) => loadAdminMetadataArtwork(api!, { itemId }, signal),
        queryKey: imagesKey,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 15_000
    });
    const mutationFlightRef = useRef<Readonly<{
        operation: AdminMetadataManagerMutation;
        promise: Promise<unknown>;
    }> | null>(null);
    const [ activeMutation, setActiveMutation ] = useState<AdminMetadataManagerMutation | null>(null);
    const [ mutationError, setMutationError ] = useState<Error | null>(null);

    useEffect(() => setMutationError(null), [ itemId ]);

    const runExclusive = useCallback(<T>(
        operation: AdminMetadataManagerMutation,
        work: () => Promise<T>
    ): Promise<T> => {
        const active = mutationFlightRef.current;
        if (active) {
            if (active.operation === operation) return active.promise as Promise<T>;
            return Promise.reject(new AdminMetadataManagerServiceError(
                'invalid-input',
                'Finish the current metadata action before starting another.'
            ));
        }

        setActiveMutation(operation);
        setMutationError(null);
        const promise = work().catch(error => {
            const normalizedError = error instanceof Error ? error : new Error('Metadata action failed.');
            setMutationError(normalizedError);
            throw error;
        }).finally(() => {
            if (mutationFlightRef.current?.promise === promise) mutationFlightRef.current = null;
            setActiveMutation(null);
        });
        mutationFlightRef.current = { operation, promise };
        return promise;
    }, []);

    const updateAuthoritativeItem = useCallback((bundle: AdminMetadataItemBundle) => {
        queryClient.setQueryData(itemKey, bundle);
        queryClient.setQueryData<AdminMetadataCatalogPage>(
            catalogKey,
            page => updateCatalogItem(page, bundle)
        );
    }, [ catalogKey, itemKey, queryClient ]);

    const invalidateArtworkConsumers = useCallback(async () => {
        await Promise.all([
            queryClient.invalidateQueries({ exact: true, queryKey: imagesKey }),
            queryClient.invalidateQueries({ exact: true, queryKey: itemKey }),
            queryClient.invalidateQueries({ exact: true, queryKey: catalogKey })
        ]);
    }, [ catalogKey, imagesKey, itemKey, queryClient ]);

    const saveMetadata = useCallback((desiredForm: AdminMetadataForm, confirmedForm: AdminMetadataForm) => (
        runExclusive('save', async () => {
            const currentApi = requireResource(api, 'Metadata editing is unavailable.');
            await queryClient.cancelQueries({ exact: true, queryKey: itemKey });
            const saved = await saveAdminMetadataItem(currentApi, {
                confirmedForm,
                desiredForm,
                itemId,
                userId: userId || undefined
            });
            updateAuthoritativeItem(saved);
            return saved;
        })
    ), [ api, itemId, itemKey, queryClient, runExclusive, updateAuthoritativeItem, userId ]);

    const uploadArtwork = useCallback((artwork: Omit<UploadAdminMetadataArtworkInput, 'itemId'>) => (
        runExclusive('upload-artwork', async () => {
            const client = requireResource(apiClient, 'Artwork editing is unavailable.');
            await Promise.all([
                queryClient.cancelQueries({ exact: true, queryKey: imagesKey }),
                queryClient.cancelQueries({ exact: true, queryKey: itemKey })
            ]);
            await uploadAdminMetadataArtwork(client, { ...artwork, itemId });
            await invalidateArtworkConsumers();
        })
    ), [ apiClient, imagesKey, invalidateArtworkConsumers, itemId, itemKey, queryClient, runExclusive ]);

    const deleteArtwork = useCallback((artwork: Omit<AdminMetadataArtworkInput, 'itemId'>) => (
        runExclusive('delete-artwork', async () => {
            const currentApi = requireResource(api, 'Artwork editing is unavailable.');
            await queryClient.cancelQueries({ exact: true, queryKey: imagesKey });
            await deleteAdminMetadataArtwork(currentApi, { ...artwork, itemId });
            await invalidateArtworkConsumers();
        })
    ), [ api, imagesKey, invalidateArtworkConsumers, itemId, queryClient, runExclusive ]);

    const reorderArtwork = useCallback((artwork: Omit<ReorderAdminMetadataArtworkInput, 'itemId'>) => (
        runExclusive('reorder-artwork', async () => {
            const currentApi = requireResource(api, 'Artwork editing is unavailable.');
            await queryClient.cancelQueries({ exact: true, queryKey: imagesKey });
            await reorderAdminMetadataArtwork(currentApi, { ...artwork, itemId });
            await invalidateArtworkConsumers();
        })
    ), [ api, imagesKey, invalidateArtworkConsumers, itemId, queryClient, runExclusive ]);

    const fetchRemoteImageProviders = useCallback(() => {
        const currentApi = requireResource(api, 'Remote artwork is unavailable.');
        const queryKey = keys.remoteImageProviders(itemId);
        return queryClient.fetchQuery({
            queryFn: ({ signal }) => loadAdminMetadataRemoteImageProviders(currentApi, { itemId }, signal),
            queryKey,
            staleTime: 60_000
        });
    }, [ api, itemId, keys, queryClient ]);

    const fetchRemoteImages = useCallback((request: Omit<LoadAdminMetadataRemoteImagesInput, 'itemId'>) => {
        const currentApi = requireResource(api, 'Remote artwork is unavailable.');
        const normalizedRequest = {
            ...request,
            itemId,
            providerName: normalizeText(request.providerName) || undefined,
            startIndex: normalizeStartIndex(request.startIndex)
        };
        return queryClient.fetchQuery({
            queryFn: ({ signal }) => loadAdminMetadataRemoteImages(currentApi, normalizedRequest, signal),
            queryKey: keys.remoteImages(normalizedRequest),
            staleTime: 30_000
        });
    }, [ api, itemId, keys, queryClient ]);

    const downloadRemoteArtwork = useCallback((artwork: Omit<DownloadAdminMetadataRemoteImageInput, 'itemId'>) => (
        runExclusive('download-artwork', async () => {
            const currentApi = requireResource(api, 'Remote artwork is unavailable.');
            await downloadAdminMetadataRemoteImage(currentApi, { ...artwork, itemId });
            await invalidateArtworkConsumers();
        })
    ), [ api, invalidateArtworkConsumers, itemId, runExclusive ]);

    const fetchIdentifyProviders = useCallback(() => {
        const currentApi = requireResource(api, 'Identify providers are unavailable.');
        return queryClient.fetchQuery({
            queryFn: ({ signal }) => loadAdminMetadataIdentifyProviders(currentApi, { itemId }, signal),
            queryKey: keys.identifyProviders(itemId),
            staleTime: 60_000
        });
    }, [ api, itemId, keys, queryClient ]);

    const searchIdentify = useCallback((request: Omit<SearchAdminMetadataIdentifyInput, 'itemId'>) => {
        const currentApi = requireResource(api, 'Identify is unavailable.');
        const normalizedRequest = { ...request, itemId };
        return queryClient.fetchQuery({
            queryFn: ({ signal }) => searchAdminMetadataIdentify(currentApi, normalizedRequest, signal),
            queryKey: keys.identifyResults(itemId, request.itemType, request.query),
            staleTime: 30_000
        });
    }, [ api, itemId, keys, queryClient ]);

    const fetchReadingProviders = useCallback(() => queryClient.fetchQuery({
        queryFn: ({ signal }) => loadAdminReadingMetadataProviders(readingApi, signal),
        queryKey: keys.readingProviders(),
        staleTime: 60_000
    }), [ keys, queryClient, readingApi ]);

    const searchReadingIdentify = useCallback(async (request: Omit<AdminReadingMetadataSearchRequest, 'itemId'>) => {
        const normalizedRequest: AdminReadingMetadataSearchRequest = { ...request, itemId };
        await queryClient.cancelQueries({
            predicate: query => query.queryKey[0] === ADMIN_METADATA_MANAGER_QUERY_SCOPE
                && query.queryKey[1] === (serverKey || 'unresolved-server')
                && query.queryKey[2] === 'reading-identify'
                && query.queryKey[3] === 'results'
        });
        return queryClient.fetchQuery({
            queryFn: ({ signal }) => searchAdminReadingMetadata(readingApi, normalizedRequest, signal),
            queryKey: keys.readingResults(normalizedRequest),
            staleTime: 30_000
        });
    }, [ itemId, keys, queryClient, readingApi, serverKey ]);

    const applyIdentifyResult = useCallback((result: AdminMetadataIdentifyResult) => (
        runExclusive('apply-identify', async () => {
            const currentApi = requireResource(api, 'Identify is unavailable.');
            await queryClient.cancelQueries({ exact: true, queryKey: itemKey });
            const currentBundle = itemQuery.data;
            const saved = result.readingCandidate && currentBundle ?
                await saveAdminMetadataItem(currentApi, {
                    confirmedForm: currentBundle.form,
                    desiredForm: createAdminMetadataFormFromReadingCandidate(
                        currentBundle.form,
                        result.readingCandidate,
                        currentBundle.editor.editableFields,
                        result.readingQuery
                    ),
                    itemId,
                    userId: userId || undefined
                }) : await applyAdminMetadataIdentifyResult(currentApi, {
                    itemId,
                    result,
                    userId: userId || undefined
                });
            updateAuthoritativeItem(saved);
            return saved;
        })
    ), [ api, itemId, itemKey, itemQuery.data, queryClient, runExclusive, updateAuthoritativeItem, userId ]);

    const refreshItem = useCallback((mode: AdminMetadataRefreshMode, recursive = false) => (
        runExclusive('refresh', async () => {
            const currentBundle = itemQuery.data;
            const storedIdentity = mode === 'scan' && !recursive && currentBundle?.item.type === 'Book' ?
                findAdminStoredReadingProviderIdentity(currentBundle.form.providerIds) :
                null;
            if (storedIdentity && currentBundle) {
                const currentApi = requireResource(api, 'Metadata refresh is unavailable.');
                const request: AdminReadingMetadataSearchRequest = {
                    itemId,
                    provider: storedIdentity.provider,
                    providerId: storedIdentity.providerId
                };
                await Promise.all([
                    queryClient.cancelQueries({ exact: true, queryKey: itemKey }),
                    queryClient.cancelQueries({ exact: true, queryKey: keys.readingResults(request) })
                ]);
                const response = await queryClient.fetchQuery({
                    queryFn: ({ signal }) => searchAdminReadingMetadata(readingApi, request, signal),
                    queryKey: keys.readingResults(request),
                    staleTime: 0
                });
                const candidate = response.candidates.find(value => (
                    value.providerId.localeCompare(storedIdentity.providerId, undefined, { sensitivity: 'accent' }) === 0
                ));
                if (!candidate) {
                    throw new AdminMetadataManagerServiceError(
                        'item-unavailable',
                        `${storedIdentity.displayName} could not verify the saved provider identity.`
                    );
                }
                const saved = await saveAdminMetadataItem(currentApi, {
                    confirmedForm: currentBundle.form,
                    desiredForm: createAdminMetadataFormFromReadingCandidate(
                        currentBundle.form,
                        candidate,
                        currentBundle.editor.editableFields,
                        response.query
                    ),
                    itemId,
                    userId: userId || undefined
                });
                updateAuthoritativeItem(saved);
                return { kind: 'reading-exact', provider: storedIdentity.displayName } as const;
            }

            const client = requireResource(apiClient, 'Metadata refresh is unavailable.');
            await refreshAdminMetadataItem(client, {
                itemId,
                options: createAdminMetadataRefreshOptions(mode, recursive)
            });
            await invalidateArtworkConsumers();
            return { kind: 'jellyfin' } as const;
        })
    ), [
        api,
        apiClient,
        invalidateArtworkConsumers,
        itemId,
        itemKey,
        itemQuery.data,
        keys,
        queryClient,
        readingApi,
        runExclusive,
        updateAuthoritativeItem,
        userId
    ]);

    return {
        activeMutation,
        applyIdentifyResult,
        artwork: artworkQuery.data || null,
        artworkError: artworkQuery.error instanceof Error ? artworkQuery.error : null,
        artworkFetching: artworkQuery.isFetching,
        artworkLoading: Boolean(itemEnabled && artworkEnabled && artworkQuery.isPending && !artworkQuery.data),
        catalogError: catalogQuery.error instanceof Error ? catalogQuery.error : null,
        catalogFetching: catalogQuery.isFetching,
        catalogLoading: Boolean(catalogEnabled && catalogQuery.isPending && !catalogQuery.data),
        catalogPage: catalogQuery.data || null,
        catalogRequest,
        debouncedSearchTerm,
        deleteArtwork,
        downloadRemoteArtwork,
        fetchIdentifyProviders,
        fetchReadingProviders,
        fetchRemoteImageProviders,
        fetchRemoteImages,
        isMutating: activeMutation !== null,
        itemBundle: itemQuery.data || null,
        itemError: itemQuery.error instanceof Error ? itemQuery.error : null,
        itemFetching: itemQuery.isFetching,
        itemLoading: Boolean(itemEnabled && itemQuery.isPending && !itemQuery.data),
        mutationError,
        queryKeys: keys,
        refetchArtwork: artworkQuery.refetch,
        refetchCatalog: catalogQuery.refetch,
        refetchItem: itemQuery.refetch,
        refetchRoots: rootsQuery.refetch,
        refreshItem,
        reorderArtwork,
        roots: rootsQuery.data || null,
        rootsError: rootsQuery.error instanceof Error ? rootsQuery.error : null,
        rootsFetching: rootsQuery.isFetching,
        rootsLoading: Boolean(queriesEnabled && rootsQuery.isPending && !rootsQuery.data),
        saveMetadata,
        searchReadingIdentify,
        searchIdentify,
        uploadArtwork
    } as const;
}
