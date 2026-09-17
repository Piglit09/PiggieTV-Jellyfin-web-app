import {
    cleanPtvQuery,
    getPtvApiUrl,
    getPtvCurrentUserId,
    getPtvServerId,
    PtvApiError,
    requestPtvJson,
    type PtvItemQuery,
    type PtvItemsResult
} from '../../../api';
import { getPtvReadingHome } from '../../books/booksApi';
import { getPtvMusicHome, getPtvMusicLibrary } from '../../music/musicApi';
import {
    logPtvRecommendationFailure,
    logPtvRecommendationStage
} from '../debug/recommendationRuntimeDebug';
import type {
    PtvRecommendationDataBundle,
    PtvRecommendationInputItem,
    PtvRecommendationItem,
    PtvRecommendationSourceFailure,
    PtvRecommendationSourceTiming,
    PtvRecommendationSourceType
} from '../types/recommendationTypes';

const RECOMMENDATION_FIELDS = [
    'Album',
    'AlbumArtist',
    'AlbumPrimaryImageItemId',
    'AlbumPrimaryImageTag',
    'AlbumArtists',
    'AlbumId',
    'Artist',
    'ArtistItems',
    'Artists',
    'BackdropImageTags',
    'CollectionName',
    'Container',
    'DateCreated',
    'Genres',
    'ImageTags',
    'MediaType',
    'OfficialRating',
    'Overview',
    'ParentBackdropImageTags',
    'ParentPrimaryImageItemId',
    'ParentPrimaryImageTag',
    'People',
    'PremiereDate',
    'ProductionYear',
    'ProviderIds',
    'RunTimeTicks',
    'SeriesName',
    'Studios',
    'Tags'
].join(',');

const CANDIDATE_ITEM_TYPES = 'Movie,Series,Episode,Audio,MusicAlbum,Book';
const PRIMARY_SOURCE_LIMIT = 48;
const RESUME_SOURCE_LIMIT = 48;
const BROAD_SOURCE_LIMIT = 48;
const HOME_SCAN_SOURCE_LIMIT = 48;
const RECOMMENDATION_SOURCE_CONCURRENCY = 2;
const SLOW_SOURCE_MS = 5500;

type PtvRecommendationSourceResult = {
    failure?: PtvRecommendationSourceFailure;
    items: PtvRecommendationItem[];
    timing: PtvRecommendationSourceTiming;
};

type PtvRecommendationSourceTask = () => Promise<PtvRecommendationSourceResult>;

type PtvRecommendationSourcePool = {
    nextIndex: number;
    results: PtvRecommendationSourceResult[];
    signal?: AbortSignal;
    tasks: PtvRecommendationSourceTask[];
};

type PtvRecommendationProviderContext = {
    diagnosticGenerationId?: string;
    musicLibraryDetectionReason?: string | null;
    musicLibraryId?: string | null;
    musicLibraryName?: string | null;
    serverId: string;
    signal?: AbortSignal;
    userId: string;
};

type PtvRecommendationSourceRequestTiming = Partial<PtvRecommendationSourceTiming> & {
    endpoint: string;
    query?: Record<string, unknown>;
    requestMs: number;
    responseBodySummary?: string;
    responseSizeBytes: number;
    statusCode?: number | null;
    url: string;
    userId: string | null;
};

type PtvRecommendationSourceErrorContext = Partial<PtvRecommendationSourceTiming> & {
    endpoint?: string;
    failureReason: string;
    responseBodySummary?: string;
    statusCode?: number | null;
    url?: string;
    userId?: string | null;
};

type PtvRecommendationSourceError = Error & {
    ptvRecommendationSource?: PtvRecommendationSourceErrorContext;
};

type PtvRecommendationQueryVariant = {
    label: string;
    parameterUnderTest: string;
    query: PtvItemQuery;
    usable?: boolean;
};

type PtvRecommendationItemsWithTiming = PtvRecommendationItem[] & {
    __ptvTiming?: Partial<PtvRecommendationSourceTiming>;
};

function attachRecommendationTiming(
    items: PtvRecommendationItem[],
    timing: Partial<PtvRecommendationSourceTiming>
): PtvRecommendationItemsWithTiming {
    Object.defineProperty(items, '__ptvTiming', {
        configurable: true,
        enumerable: false,
        value: timing
    });

    return items as PtvRecommendationItemsWithTiming;
}

function getAttachedRecommendationTiming(items: PtvRecommendationItem[]) {
    return (items as PtvRecommendationItemsWithTiming).__ptvTiming || {};
}

function getApproxResponseSizeBytes(value: unknown) {
    try {
        return JSON.stringify(value).length;
    } catch {
        return 0;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object';
}

function redactRecommendationDiagnosticText(value: string) {
    return value
        .replace(/(authorization\s*[:=]\s*)(bearer\s+)?[^\s"',;]+/gi, '$1[redacted]')
        .replace(/(api[-_ ]?key\s*[:=]\s*)[^\s"',;]+/gi, '$1[redacted]')
        .replace(/(token\s*[:=]\s*)[^\s"',;]+/gi, '$1[redacted]')
        .replace(/(password\s*[:=]\s*)[^\s"',;]+/gi, '$1[redacted]');
}

function summarizeResponsePayload(value: unknown): string {
    if (Array.isArray(value)) {
        const firstItem = value.find(isRecord);
        const firstKeys = firstItem ? Object.keys(firstItem).slice(0, 12) : [];

        return `array(length=${value.length}, firstKeys=${firstKeys.join(',') || 'none'})`;
    }

    if (isRecord(value)) {
        const items = Array.isArray(value.Items) ? value.Items : [];
        const keys = Object.keys(value).slice(0, 12);
        const total = typeof value.TotalRecordCount === 'number' ? value.TotalRecordCount : null;

        return `object(keys=${keys.join(',') || 'none'}, itemCount=${items.length}, totalRecordCount=${total ?? 'unknown'})`;
    }

    if (value === null) return 'null';
    if (value === undefined) return 'undefined';

    return `${typeof value}`;
}

function getSourceFallbackMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error.trim()) return error;
    if (error === undefined) return 'api failure: request rejected without error detail';
    if (error === null) return 'api failure: request rejected with null error';
    if (isRecord(error) && typeof error.message === 'string' && error.message.trim()) return error.message;

    return fallback;
}

function getApiErrorStatus(error: unknown): number | null {
    if (error instanceof PtvApiError) return error.statusCode;
    if (!isRecord(error)) return null;

    const status = error.statusCode || error.status;

    return typeof status === 'number' ? status : null;
}

function getApiErrorResponseBody(error: unknown): string {
    if (error instanceof PtvApiError) return redactRecommendationDiagnosticText(error.responseBody || '').slice(0, 1200);
    if (!isRecord(error)) return '';

    const responseBody = error.responseBody || error.responseText || error.body;

    if (typeof responseBody === 'string') return redactRecommendationDiagnosticText(responseBody).slice(0, 1200);
    if (isRecord(responseBody)) {
        try {
            return redactRecommendationDiagnosticText(JSON.stringify(responseBody)).slice(0, 1200);
        } catch {
            return '[unserializable response body]';
        }
    }

    return '';
}

function createRecommendationSourceError(
    message: string,
    sourceContext: PtvRecommendationSourceErrorContext,
    cause?: unknown
): PtvRecommendationSourceError {
    const error = new Error(message) as PtvRecommendationSourceError;

    error.ptvRecommendationSource = sourceContext;

    if (cause !== undefined) {
        (error as PtvRecommendationSourceError & { cause?: unknown }).cause = cause;
    }

    return error;
}

function getRecommendationSourceErrorContext(error: unknown): PtvRecommendationSourceErrorContext {
    if (isRecord(error) && isRecord(error.ptvRecommendationSource)) {
        return error.ptvRecommendationSource as PtvRecommendationSourceErrorContext;
    }

    return {
        failureReason: getSourceFallbackMessage(error, 'unknown source failure'),
        responseBodySummary: getApiErrorResponseBody(error),
        statusCode: getApiErrorStatus(error)
    };
}

function getRecommendationErrorMessage(error: unknown) {
    return getSourceFallbackMessage(error, 'unknown source failure');
}

function buildSourceContext(
    context: PtvRecommendationProviderContext,
    endpoint?: string,
    query?: Record<string, unknown>,
    url?: string
): PtvRecommendationSourceErrorContext {
    return {
        endpoint,
        failureReason: '',
        libraryId: context.musicLibraryId || null,
        query,
        url,
        userId: context.userId || null
    };
}

function requireRecommendationUserId(context: PtvRecommendationProviderContext, source: string) {
    if (context.userId) return;

    throw createRecommendationSourceError('missing userId', {
        failureReason: 'missing userId',
        libraryId: context.musicLibraryId || null,
        source,
        userId: null
    });
}

async function requestRecommendationJson<T>(
    source: string,
    endpoint: string,
    query: PtvItemQuery,
    context: PtvRecommendationProviderContext
): Promise<{ payload: T; timing: PtvRecommendationSourceRequestTiming }> {
    throwIfRecommendationAborted(context.signal);
    requireRecommendationUserId(context, source);

    const cleanedQuery = cleanPtvQuery(query);
    const diagnosticQuery = (cleanedQuery || {}) as Record<string, unknown>;
    let url = '';

    try {
        url = redactRecommendationDiagnosticText(getPtvApiUrl(endpoint, cleanedQuery, context.serverId));
    } catch (error) {
        throwIfRecommendationCancelled(error, context.signal);

        throw createRecommendationSourceError(
            `url build failure: ${getRecommendationErrorMessage(error)}`,
            {
                ...buildSourceContext(context, endpoint, diagnosticQuery),
                failureReason: 'url build failure',
                statusCode: getApiErrorStatus(error)
            },
            error
        );
    }

    const startedAt = Date.now();

    logPtvRecommendationStage('Source request started', {
        endpoint,
        generationId: context.diagnosticGenerationId,
        libraryId: context.musicLibraryId || null,
        query: diagnosticQuery,
        source,
        url,
        userId: context.userId || null
    });

    try {
        const payload = await requestPtvJson<T>(endpoint, {
            params: cleanedQuery,
            serverId: context.serverId,
            signal: context.signal
        });
        throwIfRecommendationAborted(context.signal);

        const timing: PtvRecommendationSourceRequestTiming = {
            endpoint,
            libraryId: context.musicLibraryId || null,
            query: diagnosticQuery,
            requestMs: Date.now() - startedAt,
            responseBodySummary: summarizeResponsePayload(payload),
            responseSizeBytes: getApproxResponseSizeBytes(payload),
            serverTimeMs: null,
            statusCode: 200,
            url,
            userId: context.userId || null
        };

        logPtvRecommendationStage('Source request completed', {
            ...timing,
            generationId: context.diagnosticGenerationId,
            source
        });

        return {
            payload,
            timing
        };
    } catch (error) {
        throwIfRecommendationCancelled(error, context.signal);

        const responseBodySummary = getApiErrorResponseBody(error);
        const statusCode = getApiErrorStatus(error);
        const message = getRecommendationErrorMessage(error);

        logPtvRecommendationFailure('Source request failed', error, {
            endpoint,
            failureReason: 'api failure',
            generationId: context.diagnosticGenerationId,
            libraryId: context.musicLibraryId || null,
            query: diagnosticQuery,
            responseBodySummary,
            source,
            statusCode,
            url,
            userId: context.userId || null
        });

        throw createRecommendationSourceError(
            message.startsWith('api failure') ? message : `api failure: ${message}`,
            {
                endpoint,
                failureReason: 'api failure',
                libraryId: context.musicLibraryId || null,
                query: diagnosticQuery,
                responseBodySummary,
                statusCode,
                url,
                userId: context.userId || null
            },
            error
        );
    }
}

function getItemsResultItems(
    payload: PtvItemsResult<PtvRecommendationItem>,
    context: PtvRecommendationSourceRequestTiming
) {
    if (payload == null) {
        throw createRecommendationSourceError('null response', {
            ...context,
            failureReason: 'null response'
        });
    }

    if (!isRecord(payload)) {
        throw createRecommendationSourceError('parse failure: expected Jellyfin item result object', {
            ...context,
            failureReason: 'parse failure'
        });
    }

    if (payload.Items === undefined && typeof payload.TotalRecordCount !== 'number') {
        throw createRecommendationSourceError('parse failure: missing Items array', {
            ...context,
            failureReason: 'parse failure'
        });
    }

    if (payload.Items !== undefined && !Array.isArray(payload.Items)) {
        throw createRecommendationSourceError('parse failure: Items is not an array', {
            ...context,
            failureReason: 'parse failure'
        });
    }

    return payload.Items || [];
}

function getLatestItemsResultItems(
    payload: PtvRecommendationItem[],
    context: PtvRecommendationSourceRequestTiming
) {
    if (payload == null) {
        throw createRecommendationSourceError('null response', {
            ...context,
            failureReason: 'null response'
        });
    }

    if (!Array.isArray(payload)) {
        throw createRecommendationSourceError('parse failure: expected Jellyfin latest items array', {
            ...context,
            failureReason: 'parse failure'
        });
    }

    return payload;
}

function createRecommendationAbortError(message = 'Recommendation generation was cancelled.') {
    return Object.assign(new Error(message), {
        name: 'AbortError',
        kind: 'abort'
    });
}

function isRecommendationAbortError(error: unknown) {
    if (!error || typeof error !== 'object') return false;

    const candidate = error as { kind?: unknown; name?: unknown };

    return candidate.name === 'AbortError' || candidate.kind === 'abort';
}

function throwIfRecommendationAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw createRecommendationAbortError();
}

function throwIfRecommendationCancelled(error: unknown, signal?: AbortSignal) {
    if (isRecommendationAbortError(error)) throw error;
    if (signal?.aborted) throw createRecommendationAbortError();
}

function rejectOnRecommendationAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(createRecommendationAbortError());

    return new Promise((resolve, reject) => {
        const handleAbort = () => {
            reject(createRecommendationAbortError());
        };

        signal.addEventListener('abort', handleAbort, { once: true });
        promise
            .then(value => {
                signal.removeEventListener('abort', handleAbort);
                if (signal.aborted) {
                    reject(createRecommendationAbortError());
                    return;
                }

                resolve(value);
            })
            .catch(error => {
                signal.removeEventListener('abort', handleAbort);
                reject(error);
            });
    });
}

async function runRecommendationSourceWorker(pool: PtvRecommendationSourcePool) {
    while (pool.nextIndex < pool.tasks.length) {
        throwIfRecommendationAborted(pool.signal);

        const taskIndex = pool.nextIndex;

        pool.nextIndex += 1;
        pool.results[taskIndex] = await pool.tasks[taskIndex]();
    }
}

async function runRecommendationSourceTasks(
    tasks: PtvRecommendationSourceTask[],
    signal?: AbortSignal
) {
    throwIfRecommendationAborted(signal);

    const pool: PtvRecommendationSourcePool = {
        nextIndex: 0,
        results: new Array<PtvRecommendationSourceResult>(tasks.length),
        signal,
        tasks
    };
    const workers: Promise<void>[] = [];
    const workerCount = Math.min(RECOMMENDATION_SOURCE_CONCURRENCY, tasks.length);

    for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
        workers.push(runRecommendationSourceWorker(pool));
    }

    await Promise.all(workers);
    throwIfRecommendationAborted(signal);

    return pool.results;
}

function uniqueInputs(items: PtvRecommendationInputItem[]) {
    const seen = new Set<string>();
    const uniqueInputsList: PtvRecommendationInputItem[] = [];

    items.forEach(input => {
        const id = String(input.item.Id || input.item.Name || '');
        const key = `${id}:${input.source}`;

        if (!id || seen.has(key)) return;

        seen.add(key);
        uniqueInputsList.push(input);
    });

    return uniqueInputsList;
}

function uniqueItems(items: PtvRecommendationItem[]) {
    const seen = new Set<string>();
    const uniqueLibraryItems: PtvRecommendationItem[] = [];

    items.forEach(item => {
        const id = String(item.Id || item.Name || '');

        if (!id || seen.has(id)) return;

        seen.add(id);
        uniqueLibraryItems.push(item);
    });

    return uniqueLibraryItems;
}

function toInputs(items: PtvRecommendationItem[], source: PtvRecommendationSourceType) {
    return items.map(item => ({
        item,
        source
    }));
}

function fetchRecommendationSource(
    stage: string,
    task: () => Promise<PtvRecommendationItem[]>,
    options: {
        diagnosticGenerationId?: string;
        signal?: AbortSignal;
    } = {}
): Promise<PtvRecommendationSourceResult> {
    const startedAt = Date.now();

    logPtvRecommendationStage('Source fetch started', {
        generationId: options.diagnosticGenerationId,
        source: stage,
        startedAt
    });

    const taskPromise = Promise.resolve().then(task);

    return rejectOnRecommendationAbort(taskPromise, options.signal)
        .then(items => {
            const durationMs = Date.now() - startedAt;
            const attachedTiming = getAttachedRecommendationTiming(items);
            const requestMs = attachedTiming.requestMs;
            const clientProcessingMs = requestMs === undefined ?
                undefined :
                Math.max(0, durationMs - requestMs);
            const candidateCount = uniqueItems(items).length;
            const timing: PtvRecommendationSourceTiming = {
                ...attachedTiming,
                candidateCount,
                clientProcessingMs,
                durationMs,
                itemCount: items.length,
                slow: durationMs > SLOW_SOURCE_MS,
                source: stage,
                status: items.length ? 'success' : 'empty'
            };

            logPtvRecommendationStage('Source fetch completed', {
                ...timing,
                generationId: options.diagnosticGenerationId
            });

            return {
                items,
                timing
            };
        })
        .catch(error => {
            throwIfRecommendationCancelled(error, options.signal);

            const durationMs = Date.now() - startedAt;
            const sourceErrorContext = getRecommendationSourceErrorContext(error);
            const errorMessage = getRecommendationErrorMessage(error);
            const failure = {
                durationMs,
                endpoint: sourceErrorContext.endpoint,
                error: errorMessage,
                failureReason: sourceErrorContext.failureReason || errorMessage,
                libraryId: sourceErrorContext.libraryId || null,
                responseBodySummary: sourceErrorContext.responseBodySummary,
                source: stage,
                statusCode: sourceErrorContext.statusCode ?? null,
                url: sourceErrorContext.url,
                userId: sourceErrorContext.userId || null
            };
            const timing: PtvRecommendationSourceTiming = {
                ...sourceErrorContext,
                durationMs,
                error: failure.error,
                itemCount: 0,
                slow: durationMs > SLOW_SOURCE_MS,
                source: stage,
                status: 'failed'
            };

            logPtvRecommendationFailure('Provider source load', error, {
                durationMs,
                endpoint: failure.endpoint,
                failureReason: failure.failureReason,
                generationId: options.diagnosticGenerationId,
                libraryId: failure.libraryId,
                responseBodySummary: failure.responseBodySummary,
                source: stage,
                statusCode: failure.statusCode,
                url: failure.url,
                userId: failure.userId
            });

            return {
                failure,
                items: [],
                timing
            };
        });
}

async function getItems(
    source: string,
    context: PtvRecommendationProviderContext,
    query: PtvItemQuery,
    limit = PRIMARY_SOURCE_LIMIT
) {
    requireRecommendationUserId(context, source);

    const requestQuery = {
        EnableImageTypes: 'Primary,Backdrop,Thumb',
        Fields: RECOMMENDATION_FIELDS,
        IncludeItemTypes: CANDIDATE_ITEM_TYPES,
        Limit: limit,
        Recursive: true,
        ...query
    };
    const { payload, timing } = await requestRecommendationJson<PtvItemsResult<PtvRecommendationItem>>(
        source,
        `Users/${context.userId}/Items`,
        requestQuery,
        context
    );
    const items = getItemsResultItems(payload, timing);

    return attachRecommendationTiming(items, {
        ...timing,
        itemCount: items.length,
        source
    });
}

function getVariantSourceName(source: string, variant: PtvRecommendationQueryVariant) {
    return variant.label === 'primary' ? source : `${source}-${variant.label}`;
}

function getSourceSubqueryTiming(
    source: string,
    variant: PtvRecommendationQueryVariant,
    items: PtvRecommendationItem[],
    used: boolean
) {
    const timing = getAttachedRecommendationTiming(items);

    return {
        endpoint: timing.endpoint,
        itemCount: items.length,
        label: variant.label,
        libraryId: timing.libraryId,
        parameterUnderTest: variant.parameterUnderTest,
        query: timing.query,
        requestMs: timing.requestMs,
        responseBodySummary: timing.responseBodySummary,
        responseSizeBytes: timing.responseSizeBytes,
        serverTimeMs: timing.serverTimeMs,
        source: getVariantSourceName(source, variant),
        status: items.length ? 'success' as const : 'empty' as const,
        statusCode: timing.statusCode,
        usable: variant.usable !== false,
        used,
        url: timing.url,
        userId: timing.userId
    };
}

function getFailedSourceSubqueryTiming(
    source: string,
    variant: PtvRecommendationQueryVariant,
    error: unknown
) {
    const errorContext = getRecommendationSourceErrorContext(error);
    const errorMessage = getRecommendationErrorMessage(error);

    return {
        endpoint: errorContext.endpoint,
        error: errorMessage,
        failureReason: errorContext.failureReason || errorMessage,
        itemCount: 0,
        label: variant.label,
        libraryId: errorContext.libraryId || null,
        parameterUnderTest: variant.parameterUnderTest,
        query: errorContext.query || variant.query,
        responseBodySummary: errorContext.responseBodySummary,
        source: getVariantSourceName(source, variant),
        status: 'failed' as const,
        statusCode: errorContext.statusCode ?? null,
        usable: variant.usable !== false,
        used: false,
        url: errorContext.url,
        userId: errorContext.userId || null
    };
}

async function getItemsWithFallbacks(
    source: string,
    context: PtvRecommendationProviderContext,
    variants: PtvRecommendationQueryVariant[],
    limit = PRIMARY_SOURCE_LIMIT
) {
    const subqueries: NonNullable<PtvRecommendationSourceTiming['subqueries']> = [];
    let lastError: unknown = null;

    for (const variant of variants) {
        throwIfRecommendationAborted(context.signal);

        const variantSource = getVariantSourceName(source, variant);

        try {
            const items = await getItems(variantSource, context, variant.query, limit);
            const usable = variant.usable !== false;

            subqueries.push(getSourceSubqueryTiming(source, variant, items, usable));
            logPtvRecommendationStage('Source query variant completed', {
                generationId: context.diagnosticGenerationId,
                itemCount: items.length,
                label: variant.label,
                parameterUnderTest: variant.parameterUnderTest,
                source,
                status: items.length ? 'success' : 'empty',
                usable,
                used: usable
            });

            if (!usable) continue;

            const timing = getAttachedRecommendationTiming(items);
            const failedSubqueries = subqueries.filter(subquery => subquery.status === 'failed');

            return attachRecommendationTiming(items, {
                ...timing,
                failureReason: failedSubqueries.length ?
                    `used ${variant.label} after ${failedSubqueries.length} failed query variant(s)` :
                    timing.failureReason,
                itemCount: items.length,
                requestMs: subqueries.reduce((total, subquery) => total + (subquery.requestMs || 0), 0),
                responseSizeBytes: subqueries.reduce((total, subquery) => total + (subquery.responseSizeBytes || 0), 0),
                source,
                subqueries: subqueries.map(subquery => ({
                    ...subquery,
                    used: subquery.label === variant.label
                }))
            });
        } catch (error) {
            throwIfRecommendationCancelled(error, context.signal);

            lastError = error;
            const failedSubquery = getFailedSourceSubqueryTiming(source, variant, error);

            subqueries.push(failedSubquery);
            logPtvRecommendationFailure('Source query variant', error, {
                endpoint: failedSubquery.endpoint,
                failureReason: failedSubquery.failureReason,
                generationId: context.diagnosticGenerationId,
                label: variant.label,
                parameterUnderTest: variant.parameterUnderTest,
                query: failedSubquery.query,
                responseBodySummary: failedSubquery.responseBodySummary,
                source,
                statusCode: failedSubquery.statusCode,
                url: failedSubquery.url,
                usable: failedSubquery.usable,
                userId: failedSubquery.userId
            });
        }
    }

    const lastContext = getRecommendationSourceErrorContext(lastError);
    const failedLabels = subqueries.map(subquery => subquery.label).filter(Boolean).join(', ');

    throw createRecommendationSourceError(
        `all query variants failed: ${failedLabels || 'none'}`,
        {
            ...lastContext,
            failureReason: `all query variants failed: ${failedLabels || 'none'}`,
            subqueries
        },
        lastError
    );
}

function getFavoriteItems(context: PtvRecommendationProviderContext, limit = PRIMARY_SOURCE_LIMIT) {
    return getItems('favorites', context, {
        Filters: 'IsFavorite',
        SortBy: 'DateCreated',
        SortOrder: 'Descending'
    }, limit);
}

function getHistoryItems(context: PtvRecommendationProviderContext, limit = PRIMARY_SOURCE_LIMIT) {
    return getItemsWithFallbacks('history', context, [
        {
            label: 'primary',
            parameterUnderTest: 'SortBy=DatePlayed',
            query: {
                SortBy: 'DatePlayed',
                SortOrder: 'Descending'
            }
        },
        {
            label: 'date-created',
            parameterUnderTest: 'SortBy=DateCreated',
            query: {
                SortBy: 'DateCreated',
                SortOrder: 'Descending'
            }
        }
    ], limit);
}

async function getRecentlyAddedItems(context: PtvRecommendationProviderContext, limit = PRIMARY_SOURCE_LIMIT) {
    requireRecommendationUserId(context, 'recently-added');

    const requestQuery = {
        EnableImageTypes: 'Primary,Backdrop,Thumb',
        Fields: RECOMMENDATION_FIELDS,
        IncludeItemTypes: CANDIDATE_ITEM_TYPES,
        Limit: limit
    };
    const endpoint = `Users/${context.userId}/Items/Latest`;

    try {
        const { payload, timing } = await requestRecommendationJson<PtvRecommendationItem[]>(
            'recently-added',
            endpoint,
            requestQuery,
            context
        );
        const items = getLatestItemsResultItems(payload, timing);

        return attachRecommendationTiming(items, {
            ...timing,
            itemCount: items.length,
            source: 'recently-added'
        });
    } catch (error) {
        throwIfRecommendationCancelled(error, context.signal);

        const primaryContext = getRecommendationSourceErrorContext(error);
        const primaryError = getRecommendationErrorMessage(error);

        logPtvRecommendationFailure('Recently added primary endpoint', error, {
            ...primaryContext,
            generationId: context.diagnosticGenerationId,
            source: 'recently-added'
        });

        const fallbackItems = await getItemsWithFallbacks('recently-added-fallback', context, [
            {
                label: 'date-created',
                parameterUnderTest: 'SortBy=DateCreated',
                query: {
                    SortBy: 'DateCreated',
                    SortOrder: 'Descending'
                }
            }
        ], limit);
        const fallbackTiming = getAttachedRecommendationTiming(fallbackItems);

        return attachRecommendationTiming(fallbackItems, {
            ...fallbackTiming,
            failureReason: `primary endpoint failed: ${primaryError}`,
            itemCount: fallbackItems.length,
            source: 'recently-added',
            subqueries: [
                {
                    ...primaryContext,
                    error: primaryError,
                    itemCount: 0,
                    source: 'recently-added-primary',
                    status: 'failed' as const
                },
                ...(fallbackTiming.subqueries?.length ? fallbackTiming.subqueries : [{
                    ...fallbackTiming,
                    itemCount: fallbackItems.length,
                    source: 'recently-added-fallback',
                    status: fallbackItems.length ? 'success' as const : 'empty' as const
                }])
            ]
        });
    }
}

function getResumeItems(context: PtvRecommendationProviderContext, limit = RESUME_SOURCE_LIMIT) {
    return getItemsWithFallbacks('resume', context, [
        {
            label: 'primary',
            parameterUnderTest: 'Filters=IsResumable; SortBy=DatePlayed',
            query: {
                Filters: 'IsResumable',
                SortBy: 'DatePlayed',
                SortOrder: 'Descending'
            }
        },
        {
            label: 'resumable-date-created',
            parameterUnderTest: 'Filters=IsResumable with SortBy=DateCreated',
            query: {
                Filters: 'IsResumable',
                SortBy: 'DateCreated',
                SortOrder: 'Descending'
            }
        },
        {
            label: 'resumable-sort-name',
            parameterUnderTest: 'Filters=IsResumable with SortBy=SortName',
            query: {
                Filters: 'IsResumable',
                SortBy: 'SortName',
                SortOrder: 'Ascending'
            }
        }
    ], limit);
}

function getBroadCandidateItems(context: PtvRecommendationProviderContext) {
    return getItemsWithFallbacks('broad-candidates', context, [
        {
            label: 'newest',
            parameterUnderTest: 'SortBy=DateCreated',
            query: {
                SortBy: 'DateCreated',
                SortOrder: 'Descending'
            }
        }
    ], BROAD_SOURCE_LIMIT);
}

function getMusicHomeItems(context: PtvRecommendationProviderContext, limit = HOME_SCAN_SOURCE_LIMIT) {
    const startedAt = Date.now();

    return getPtvMusicHome()
        .then(home => {
            const items = home.sections.reduce<PtvRecommendationItem[]>((sectionItems, section) => sectionItems.concat(section.items), []).slice(0, limit);

            return attachRecommendationTiming(items, {
                itemCount: items.length,
                libraryId: context.musicLibraryId || null,
                query: 'getPtvMusicHome',
                requestMs: Date.now() - startedAt,
                responseSizeBytes: getApproxResponseSizeBytes({
                    sectionCount: home.sections.length,
                    stats: home.stats
                }),
                serverTimeMs: null,
                userId: context.userId || null
            });
        });
}

function getReadingHomeItems(context: PtvRecommendationProviderContext, limit = HOME_SCAN_SOURCE_LIMIT) {
    const startedAt = Date.now();

    return Promise.all([
        getPtvReadingHome('books').catch(() => null),
        getPtvReadingHome('comics').catch(() => null),
        getPtvReadingHome('manga').catch(() => null)
    ]).then(homes => {
        const items = homes.reduce<PtvRecommendationItem[]>((homeItems, home) => {
            if (!home) return homeItems;

            return homeItems.concat(home.sections.reduce<PtvRecommendationItem[]>((sectionItems, section) => sectionItems.concat(section.items), []));
        }, []).slice(0, limit);

        return attachRecommendationTiming(items, {
            itemCount: items.length,
            libraryId: context.musicLibraryId || null,
            query: 'getPtvReadingHome',
            requestMs: Date.now() - startedAt,
            responseSizeBytes: getApproxResponseSizeBytes(homes.map(home => home ? {
                sectionCount: home.sections.length
            } : null)),
            serverTimeMs: null,
            userId: context.userId || null
        });
    });
}

export async function getPtvRecommendationDataBundle(options: {
    diagnosticGenerationId?: string;
    includeHomeScans?: boolean;
    serverId?: string | null;
    signal?: AbortSignal;
    userId?: string | null;
} = {}): Promise<PtvRecommendationDataBundle> {
    throwIfRecommendationAborted(options.signal);

    const serverId = String(options.serverId || getPtvServerId() || 'server').trim();
    const userId = String(options.userId || getPtvCurrentUserId() || '').trim();
    const includeHomeScans = options.includeHomeScans === true;
    const sources = [
        'favorites',
        'history',
        'recently-added',
        'resume',
        'broad-candidates',
        ...(includeHomeScans ? ['music-home', 'reading-home'] : [])
    ];
    let favorites: PtvRecommendationItem[] = [];
    let history: PtvRecommendationItem[] = [];
    let recentlyAdded: PtvRecommendationItem[] = [];
    let resume: PtvRecommendationItem[] = [];
    let broadCandidates: PtvRecommendationItem[] = [];
    let musicHome: PtvRecommendationItem[] = [];
    let readingHome: PtvRecommendationItem[] = [];
    let sourceFailures: PtvRecommendationSourceFailure[] = [];
    let sourceTimings: PtvRecommendationSourceTiming[] = [];
    const musicLibrary = await rejectOnRecommendationAbort(
        getPtvMusicLibrary().catch(error => {
            logPtvRecommendationFailure('Music library prerequisite', error, {
                generationId: options.diagnosticGenerationId,
                serverId,
                userId: userId || null
            });

            return null;
        }),
        options.signal
    );
    const providerContext: PtvRecommendationProviderContext = {
        diagnosticGenerationId: options.diagnosticGenerationId,
        musicLibraryDetectionReason: musicLibrary?.detectionReason || null,
        musicLibraryId: musicLibrary?.id || null,
        musicLibraryName: musicLibrary?.name || null,
        serverId,
        signal: options.signal,
        userId
    };

    logPtvRecommendationStage('Provider created', {
        currentUserLoaded: Boolean(userId),
        generationId: options.diagnosticGenerationId,
        musicLibraryDetectionReason: providerContext.musicLibraryDetectionReason,
        musicLibraryDiscovered: Boolean(providerContext.musicLibraryId),
        musicLibraryId: providerContext.musicLibraryId,
        musicLibraryName: providerContext.musicLibraryName,
        serverId,
        userId: userId || null
    });
    logPtvRecommendationStage('Provider prerequisites resolved', {
        currentUserLoaded: Boolean(userId),
        generationId: options.diagnosticGenerationId,
        musicLibraryDetectionReason: providerContext.musicLibraryDetectionReason,
        musicLibraryDiscovered: Boolean(providerContext.musicLibraryId),
        musicLibraryId: providerContext.musicLibraryId,
        musicLibraryName: providerContext.musicLibraryName,
        serverId,
        userId: userId || null
    });
    logPtvRecommendationStage('Candidate fetch started', {
        currentUserLoaded: Boolean(userId),
        generationId: options.diagnosticGenerationId,
        musicLibraryId: providerContext.musicLibraryId,
        serverId,
        sources,
        userId: userId || null
    });

    try {
        const sourceTasks: PtvRecommendationSourceTask[] = [
            () => fetchRecommendationSource('favorites', () => getFavoriteItems(providerContext), options),
            () => fetchRecommendationSource('history', () => getHistoryItems(providerContext), options),
            () => fetchRecommendationSource('recently-added', () => getRecentlyAddedItems(providerContext), options),
            () => fetchRecommendationSource('resume', () => getResumeItems(providerContext), options),
            () => fetchRecommendationSource('broad-candidates', () => getBroadCandidateItems(providerContext), options)
        ];

        if (includeHomeScans) {
            sourceTasks.push(
                () => fetchRecommendationSource('music-home', () => getMusicHomeItems(providerContext), options),
                () => fetchRecommendationSource('reading-home', () => getReadingHomeItems(providerContext), options)
            );
        }

        const results = await rejectOnRecommendationAbort(
            runRecommendationSourceTasks(sourceTasks, options.signal),
            options.signal
        );
        const [
            favoritesResult,
            historyResult,
            recentlyAddedResult,
            resumeResult,
            broadCandidatesResult,
            musicHomeResult,
            readingHomeResult
        ] = results;

        favorites = favoritesResult?.items || [];
        history = historyResult?.items || [];
        recentlyAdded = recentlyAddedResult?.items || [];
        resume = resumeResult?.items || [];
        broadCandidates = broadCandidatesResult?.items || [];
        musicHome = musicHomeResult?.items || [];
        readingHome = readingHomeResult?.items || [];
        throwIfRecommendationAborted(options.signal);

        sourceFailures = results
            .map(result => result?.failure)
            .filter((failure): failure is PtvRecommendationSourceFailure => Boolean(failure));
        sourceTimings = results
            .map(result => result?.timing)
            .filter((timing): timing is PtvRecommendationSourceTiming => Boolean(timing));
    } catch (error) {
        logPtvRecommendationFailure('Provider creation', error, {
            generationId: options.diagnosticGenerationId,
            serverId,
            userId: userId || null
        });
        throw error;
    }

    logPtvRecommendationStage('Candidate fetch completed', {
        broadCandidateCount: broadCandidates.length,
        favoriteCount: favorites.length,
        generationId: options.diagnosticGenerationId,
        historyCount: history.length,
        musicHomeCount: musicHome.length,
        readingHomeCount: readingHome.length,
        recentlyAddedCount: recentlyAdded.length,
        resumeCount: resume.length,
        serverId,
        sourceFailures,
        sourceTimings,
        userId: userId || null
    });

    const profileSignals = uniqueInputs([
        ...toInputs(favorites, 'favorite'),
        ...toInputs(history, 'history'),
        ...toInputs(resume, 'resume'),
        ...toInputs(musicHome, 'history'),
        ...toInputs(readingHome, 'history')
    ]);
    const candidates = uniqueInputs([
        ...toInputs(broadCandidates, 'candidate'),
        ...toInputs(recentlyAdded, 'recently-added'),
        ...toInputs(favorites, 'favorite'),
        ...toInputs(resume, 'resume'),
        ...toInputs(musicHome, 'candidate'),
        ...toInputs(readingHome, 'candidate')
    ]);

    logPtvRecommendationStage('Provider loaded', {
        broadCandidateCount: broadCandidates.length,
        candidateCount: candidates.length,
        favoriteCount: favorites.length,
        generationId: options.diagnosticGenerationId,
        historyCount: history.length,
        musicLibraryId: providerContext.musicLibraryId,
        musicHomeCount: musicHome.length,
        profileSignalCount: profileSignals.length,
        readingHomeCount: readingHome.length,
        recentlyAddedCount: recentlyAdded.length,
        resumeCount: resume.length,
        serverId,
        sourceFailures,
        sourceTimings,
        userId: userId || null
    });

    return {
        candidates,
        profileSignals,
        serverId,
        sourceFailures,
        sourceTimings,
        userId
    };
}
