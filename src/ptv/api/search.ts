import {
    getPtvItems
} from './items';
import {
    normalizePtvLibraryItems,
    type PtvLibraryRootDiagnostics
} from '../services/libraryRootNormalizer';
import {
    createPtvSearchRecoveryDiagnostics,
    getPtvSearchRecoveryCandidateSample,
    getPtvSearchRawTopParentIds,
    getPtvSearchRecoveryReason,
    mergePtvSearchRecoveryItems,
    shouldRecoverPtvSearchResults,
    type PtvSearchPrimaryStatus,
    type PtvSearchRecoveryDiagnostics,
    type PtvSearchSupplementalRequestDiagnostic
} from '../services/searchRecovery';
import {
    resetPtvMovieSearchCatalogForTests,
    searchPtvMovieCatalog,
    type PtvMovieSearchCatalogRequest
} from '../services/movieSearchCatalog';
import type {
    PtvItem,
    PtvItemQuery,
    PtvItemsResult
} from './types';

export type PtvSearchOptions = {
    fields?: string;
    includeItemTypes?: string;
    limit?: number;
    parentId?: string;
    primaryTimeoutMs?: number;
    recoveryFields?: string;
    recursive?: boolean;
    onPrimaryResult?: (result: PtvSearchItemsResult<PtvItem>) => void;
    searchTerm: string;
    signal?: AbortSignal;
    serverId?: string | null;
    userId?: string | null;
};

export type PtvSearchItemsResult<TItem> = PtvItemsResult<TItem> & {
    ptvLibraryRootDiagnostics: PtvLibraryRootDiagnostics;
    ptvSearchRecoveryDiagnostics: PtvSearchRecoveryDiagnostics;
};

export type PtvSearchPrimaryOutcome<TItem extends PtvItem> =
    | Readonly<{ durationMs: number; items: TItem[]; result: PtvItemsResult<TItem>; status: 'success' }>
    | Readonly<{ durationMs: number; error: Error; items: TItem[]; status: 'timeout' | 'error' | 'aborted' }>;

export class PtvSearchAbortedError extends Error {
    constructor() {
        super('Search request was cancelled');
        this.name = 'PtvSearchAbortedError';
    }
}

export class PtvSearchPrimaryTimeoutError extends Error {
    durationMs: number;

    constructor(timeoutMs: number) {
        super(`Primary search timed out after ${timeoutMs}ms`);
        this.name = 'PtvSearchPrimaryTimeoutError';
        this.durationMs = timeoutMs;
    }
}

function getPtvSearchError(error: unknown) {
    return error instanceof Error ? error : new Error('Search request failed');
}

function getPtvErrorStatus(error: unknown) {
    if (!error || typeof error !== 'object') return 0;

    const source = error as Record<string, unknown>;
    const directStatus = source.status || source.statusCode;
    const response = source.response;
    const responseStatus = response && typeof response === 'object'
        ? (response as Record<string, unknown>).status
        : 0;
    const value = Number(directStatus || responseStatus);

    return Number.isFinite(value) ? value : 0;
}

function isPtvAuthenticationError(error: Error | undefined) {
    const status = getPtvErrorStatus(error);

    return status === 401 || status === 403;
}

function awaitPtvSearchAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(new PtvSearchAbortedError());

    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(new PtvSearchAbortedError());

        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            value => {
                signal.removeEventListener('abort', onAbort);
                resolve(value);
            },
            error => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            }
        );
    });
}

function withPtvSearchTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
    if (!timeoutMs || timeoutMs <= 0) return promise;

    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const timeout = globalThis.setTimeout(() => {
            if (settled) return;

            settled = true;
            reject(new PtvSearchPrimaryTimeoutError(timeoutMs));
        }, timeoutMs);

        promise.then(
            value => {
                if (settled) return;

                settled = true;
                globalThis.clearTimeout(timeout);
                resolve(value);
            },
            error => {
                if (settled) return;

                settled = true;
                globalThis.clearTimeout(timeout);
                reject(error);
            }
        );
    });
}

export async function getPtvSearchPrimaryOutcome<TItem extends PtvItem>(
    query: PtvItemQuery,
    options: Pick<PtvSearchOptions, 'primaryTimeoutMs' | 'serverId' | 'signal' | 'userId'>
): Promise<PtvSearchPrimaryOutcome<TItem>> {
    const startedAt = performance.now();
    const request = Promise.resolve().then(() => getPtvItems<TItem>(query, {
        serverId: options.serverId,
        userId: options.userId
    }));

    try {
        const result = await awaitPtvSearchAbort(withPtvSearchTimeout(request, options.primaryTimeoutMs), options.signal);

        return {
            durationMs: Number((performance.now() - startedAt).toFixed(1)),
            items: result.Items || [],
            result,
            status: 'success'
        };
    } catch (error) {
        const failure = getPtvSearchError(error);
        const status: PtvSearchPrimaryStatus = failure instanceof PtvSearchAbortedError
            ? 'aborted'
            : failure instanceof PtvSearchPrimaryTimeoutError
                ? 'timeout'
                : 'error';

        return {
            durationMs: Number((performance.now() - startedAt).toFixed(1)),
            error: failure,
            items: [],
            status
        };
    }
}

function getPtvRecoveryRequestDiagnostic(
    request: PtvMovieSearchCatalogRequest
): PtvSearchSupplementalRequestDiagnostic {
    return {
        enableImages: 'false',
        enableUserData: 'false',
        endpoint: request.endpoint,
        fields: request.fields,
        groupItems: 'false',
        imageTypeLimit: '0',
        includeItemTypes: 'Movie',
        limit: String(request.limit),
        parentId: request.parentId,
        userId: request.userId
    };
}

export async function searchPtvItems<TItem extends PtvItem = PtvItem>(
    options: PtvSearchOptions
): Promise<PtvSearchItemsResult<TItem>> {
    const query: PtvItemQuery = {
        EnableImages: false,
        Fields: options.fields,
        ImageTypeLimit: 0,
        IncludeItemTypes: options.includeItemTypes,
        Limit: options.limit || 50,
        ParentId: options.parentId,
        Recursive: options.recursive !== false,
        SearchTerm: options.searchTerm
    };
    const primaryOutcome = await getPtvSearchPrimaryOutcome<TItem>(query, options);

    if (primaryOutcome.status === 'aborted') throw primaryOutcome.error;

    const primaryResult: PtvItemsResult<TItem> = primaryOutcome.status === 'success'
        ? primaryOutcome.result
        : { Items: [] };
    const primaryItems = primaryOutcome.items;
    const primaryNormalized = normalizePtvLibraryItems(primaryItems);
    const primaryError = primaryOutcome.status === 'success' ? undefined : primaryOutcome.error;
    const recoveryReason = getPtvSearchRecoveryReason({
        includeItemTypes: options.includeItemTypes,
        isAuthenticationError: isPtvAuthenticationError(primaryError),
        limit: options.limit || 50,
        parentId: options.parentId,
        primaryItemCount: primaryNormalized.items.length,
        primaryLibraryRoots: primaryNormalized.diagnostics,
        primaryStatus: primaryOutcome.status
    });
    const baseDiagnostics = createPtvSearchRecoveryDiagnostics({
        finalItemCount: primaryNormalized.items.length,
        primaryDurationMs: primaryOutcome.durationMs,
        primaryError: primaryError?.message || '',
        primaryItemCount: primaryNormalized.items.length,
        primaryStatus: primaryOutcome.status,
        rawTopParentIds: getPtvSearchRawTopParentIds(primaryItems),
        recoveryReason
    });

    if (!shouldRecoverPtvSearchResults(recoveryReason)) {
        if (primaryOutcome.status !== 'success') throw primaryOutcome.error;

        return {
            ...primaryResult,
            Items: primaryNormalized.items,
            ptvLibraryRootDiagnostics: primaryNormalized.diagnostics,
            ptvSearchRecoveryDiagnostics: baseDiagnostics
        };
    }

    if (primaryOutcome.status === 'success' && options.onPrimaryResult) {
        options.onPrimaryResult({
            ...primaryResult,
            Items: primaryNormalized.items,
            ptvLibraryRootDiagnostics: primaryNormalized.diagnostics,
            ptvSearchRecoveryDiagnostics: createPtvSearchRecoveryDiagnostics({
                ...baseDiagnostics,
                recoveryAttempted: true,
                catalogStatus: 'cold'
            })
        });
    }

    const supplementalStartedAt = performance.now();

    try {
        const supplemental = await awaitPtvSearchAbort(searchPtvMovieCatalog(options.searchTerm, {
            excludeItemIds: primaryItems.map(item => String(item.Id || '')).filter(Boolean),
            fields: options.recoveryFields || options.fields,
            serverId: options.serverId,
            userId: options.userId
        }), options.signal);
        const supplementalDurationMs = Number((performance.now() - supplementalStartedAt).toFixed(1));
        const matches = supplemental.items;
        const mergedItems = mergePtvSearchRecoveryItems(primaryItems, matches, options.limit || 50) as TItem[];
        const normalized = normalizePtvLibraryItems(mergedItems);

        return {
            ...primaryResult,
            Items: normalized.items,
            TotalRecordCount: Math.max(primaryResult.TotalRecordCount || 0, normalized.items.length),
            ptvLibraryRootDiagnostics: normalized.diagnostics,
            ptvSearchRecoveryDiagnostics: createPtvSearchRecoveryDiagnostics({
                ...baseDiagnostics,
                cacheSource: supplemental.cacheSource,
                catalogActualHasParentId: supplemental.actualHasParentId,
                catalogActualParentId: supplemental.actualParentId,
                catalogActualQueryKeys: supplemental.actualQueryKeys,
                catalogActualRequestCountByParentId: supplemental.actualRequestCountByParentId,
                catalogActualRequestUrl: supplemental.actualRequestUrl,
                catalogCacheAgeMs: supplemental.cacheAgeMs,
                catalogCachedItemCount: supplemental.cachedItemCount,
                catalogExhausted: supplemental.exhausted,
                catalogHydrationCount: supplemental.hydrationCount,
                catalogHydrationDurationMs: supplemental.hydrationDurationMs,
                catalogMatchCount: matches.length,
                catalogMatchedLocations: supplemental.matchedLocations,
                catalogMatchedNames: supplemental.matchedNames,
                catalogPageSize: supplemental.pageSize,
                catalogPagesLoaded: supplemental.pagesLoaded,
                catalogRequestEndpoint: supplemental.request.endpoint,
                catalogRequestFields: supplemental.request.fields,
                catalogRequestParentId: supplemental.request.parentId,
                catalogRequestSortBy: supplemental.request.sortBy,
                catalogRequestSortOrder: supplemental.request.sortOrder,
                catalogRequestStartIndex: supplemental.request.startIndex,
                catalogRequestsThisSearch: supplemental.requestsThisSearch,
                catalogSearchDurationMs: supplemental.searchDurationMs,
                catalogStopReason: supplemental.stopReason,
                catalogStatus: supplemental.status,
                catalogTotalRecordCount: supplemental.totalRecordCount,
                catalogCountByLogicalRoot: supplemental.countByLogicalRoot,
                catalogCountByTopParentId: supplemental.countByTopParentId,
                catalogDistinctTopParentIdCount: supplemental.distinctTopParentIdCount,
                catalogPhysicalRootSample: supplemental.physicalRootSample,
                catalogTopParentIds: supplemental.topParentIds,
                finalItemCount: normalized.items.length,
                rawTopParentIds: getPtvSearchRawTopParentIds([...primaryItems, ...matches]),
                recoveryAttempted: true,
                supplementalCandidateCount: supplemental.cachedItemCount,
                supplementalCandidateSample: getPtvSearchRecoveryCandidateSample(matches),
                supplementalDurationMs,
                supplementalMatchCount: matches.length,
                supplementalMatchedNames: supplemental.matchedNames,
                supplementalRawItemCount: supplemental.cachedItemCount,
                supplementalRequest: getPtvRecoveryRequestDiagnostic({
                    ...supplemental.request,
                    parentId: supplemental.actualParentId
                }),
                supplementalResponseKeys: [],
                supplementalResponseShape: 'wrapped-items',
                supplementalStatus: 'success',
                supplementalTotalRecordCount: supplemental.totalRecordCount
            })
        };
    } catch (error) {
        if (error instanceof PtvSearchAbortedError) throw error;
        if (primaryOutcome.status !== 'success') throw primaryOutcome.error;

        return {
            ...primaryResult,
            Items: primaryNormalized.items,
            ptvLibraryRootDiagnostics: primaryNormalized.diagnostics,
            ptvSearchRecoveryDiagnostics: createPtvSearchRecoveryDiagnostics({
                ...baseDiagnostics,
                recoveryAttempted: true,
                recoveryReason: 'supplemental-failed',
                supplementalStatus: 'error'
            })
        };
    }
}

export function resetPtvMovieSearchRecoveryCacheForTests() {
    resetPtvMovieSearchCatalogForTests();
}
