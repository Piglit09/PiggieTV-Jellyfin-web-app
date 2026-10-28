import {
    getPtvSearchPrimaryOutcome,
    PtvSearchAbortedError,
    PtvSearchPrimaryTimeoutError,
    searchPtvItems
} from '../../api/search';
import { requestPtvJson } from '../../api/client';
import type { PtvItem, PtvItemsResult } from '../../api/types';
import { createPtvAbortController } from '../../core/abortController';
import type { PtvSearchRecoveryDiagnostics } from '../../services/searchRecovery';
import type { PtvSearchGroupId } from './nativeSearchState';
import { searchPtvAuthoritativeSeries } from './authoritativeSeriesSearch';
import {
    getPtvSearchHintFailureKind,
    searchPtvHints,
    type PtvGroupedSearchHints
} from './searchHintService';

type PtvDirectSearchPlan = Readonly<{
    directoryEndpoints?: readonly Readonly<{
        itemType: 'Genre' | 'MusicGenre' | 'Studio';
        path: 'Genres' | 'MusicGenres' | 'Studios';
    }>[];
    groupId: PtvSearchGroupId;
    includeItemTypes: readonly string[];
}>;

type PtvDirectSearchOptions = Readonly<{
    onGroupResult?: (progress: PtvSearchGroupProgress) => void;
    parallelDirectoryEndpoints?: boolean;
    perGroupLimit: number;
    query: string;
    serverId: string;
    signal: AbortSignal;
    userId: string;
}>;

type PtvDirectSearchOutcome = Readonly<{
    endpointPaths?: string[];
    failureReason?: string;
    groupId: PtvSearchGroupId;
    items: PtvItem[];
    requestCount: number;
    status: 'aborted' | 'error' | 'success' | 'timeout';
}>;

type PtvDirectSearchBatch = Readonly<{
    outcomes: PtvDirectSearchOutcome[];
    requestCount: number;
}>;

export type PtvSearchGroupProgress = Readonly<{
    groupId: PtvSearchGroupId;
    items: PtvItem[];
    requestCount: number;
    source: 'direct' | 'hints';
}>;

const PTV_DIRECT_SEARCH_PLANS: readonly PtvDirectSearchPlan[] = [
    { groupId: 'movies', includeItemTypes: ['Movie'] },
    { groupId: 'shows', includeItemTypes: ['Series'] },
    { groupId: 'collections', includeItemTypes: ['BoxSet'] },
    { groupId: 'episodes', includeItemTypes: ['Episode'] },
    { groupId: 'people', includeItemTypes: ['Person'] },
    { groupId: 'reading', includeItemTypes: ['Book'] },
    { groupId: 'music', includeItemTypes: ['Audio'] },
    { groupId: 'albums', includeItemTypes: ['MusicAlbum'] },
    { groupId: 'artists', includeItemTypes: ['MusicArtist'] },
    {
        directoryEndpoints: [
            { itemType: 'Genre', path: 'Genres' },
            { itemType: 'MusicGenre', path: 'MusicGenres' }
        ],
        groupId: 'genres',
        includeItemTypes: ['Genre', 'MusicGenre']
    },
    {
        directoryEndpoints: [{ itemType: 'Studio', path: 'Studios' }],
        groupId: 'studios',
        includeItemTypes: ['Studio']
    }
];
const PTV_DIRECT_PLAN_BY_TYPE = new Map(
    PTV_DIRECT_SEARCH_PLANS.flatMap(plan => (
        plan.includeItemTypes.map(type => [type.toLowerCase(), plan] as const)
    ))
);
const PTV_DIRECT_SEARCH_PRIORITY = new Map<PtvSearchGroupId, number>([
    ['movies', 0],
    ['shows', 1],
    ['collections', 2],
    ['music', 3],
    ['albums', 4],
    ['artists', 5],
    ['episodes', 6],
    ['people', 7],
    ['reading', 8],
    ['genres', 9],
    ['studios', 10]
]);
const PTV_CRITICAL_DIRECT_GROUPS = new Set<PtvSearchGroupId>(['movies', 'shows']);

export const PTV_SEARCH_HINT_PRIMARY_TIMEOUT_MS = 8000;
export const PTV_SEARCH_DIRECT_GROUP_TIMEOUT_MS = 4500;
export const PTV_SEARCH_DIRECT_BATCH_TIMEOUT_MS = 7000;
export const PTV_SEARCH_DIRECT_MAX_CONCURRENCY = 1;
export const PTV_SEARCH_MAX_CONCURRENCY = PTV_SEARCH_DIRECT_MAX_CONCURRENCY + 1;
export const PTV_SEARCH_DIRECT_FIELDS = [
    'Album',
    'AlbumArtist',
    'AlbumId',
    'Artists',
    'BackdropImageTags',
    'ChildCount',
    'ImageTags',
    'MediaType',
    'OfficialRating',
    'ParentBackdropImageTags',
    'ParentBackdropItemId',
    'ParentThumbImageTag',
    'ParentThumbItemId',
    'PremiereDate',
    'PresentationUniqueKey',
    'PrimaryImageAspectRatio',
    'ProductionYear',
    'ProviderIds',
    'RecursiveItemCount',
    'RunTimeTicks',
    'SeriesName',
    'SortName'
].join(',');

function emptyGroupedSearchHints(): PtvGroupedSearchHints {
    return {
        albums: [],
        artists: [],
        collections: [],
        episodes: [],
        genres: [],
        movies: [],
        music: [],
        people: [],
        reading: [],
        shows: [],
        studios: []
    };
}

function normalizeSearchText(value: unknown) {
    return String(value || '').trim().toLocaleLowerCase();
}

function getSearchableText(item: PtvItem) {
    return [
        item.Name,
        item.SeriesName,
        item.Album,
        item.AlbumArtist,
        ...(Array.isArray(item.Artists) ? item.Artists : [])
    ].map(normalizeSearchText).filter(Boolean);
}

function getSearchRank(item: PtvItem, query: string) {
    const normalizedQuery = normalizeSearchText(query);
    const candidates = getSearchableText(item);

    if (candidates.some(value => value === normalizedQuery)) return 0;
    if (candidates.some(value => value.startsWith(normalizedQuery))) return 1;
    if (candidates.some(value => value.includes(normalizedQuery))) return 2;

    return 3;
}

function rankAndDedupeItems(items: readonly PtvItem[], query: string, limit: number) {
    const seen = new Set<string>();
    const ranked = items
        .filter(item => {
            const id = String(item.Id || '').trim();
            const dedupeKey = `${normalizeSearchText(item.Type)}:${id}`;

            if (!id || seen.has(dedupeKey)) return false;
            seen.add(dedupeKey);
            return true;
        })
        .map((item, sourceIndex) => ({ item, sourceIndex }))
        .sort((left, right) => (
            getSearchRank(left.item, query) - getSearchRank(right.item, query)
            || left.sourceIndex - right.sourceIndex
        ))
        .map(entry => entry.item);

    return ranked.slice(0, Math.max(0, limit));
}

function getRequestedPlans(includeItemTypes: readonly string[]) {
    const seen = new Set<PtvSearchGroupId>();

    return includeItemTypes.flatMap(type => {
        const plan = PTV_DIRECT_PLAN_BY_TYPE.get(type.trim().toLowerCase());

        if (!plan || seen.has(plan.groupId)) return [];
        seen.add(plan.groupId);
        return [plan];
    }).sort((left, right) => (
        (PTV_DIRECT_SEARCH_PRIORITY.get(left.groupId) ?? Number.MAX_SAFE_INTEGER)
        - (PTV_DIRECT_SEARCH_PRIORITY.get(right.groupId) ?? Number.MAX_SAFE_INTEGER)
    ));
}

function getInitialDirectPlans(plans: readonly PtvDirectSearchPlan[]) {
    return plans.filter(plan => !plan.directoryEndpoints?.length);
}

function getFailureStatus(error: unknown): PtvDirectSearchOutcome['status'] {
    const failureKind = getPtvSearchHintFailureKind(error);

    if (failureKind === 'aborted') return 'aborted';
    if (failureKind === 'timeout') return 'timeout';
    return 'error';
}

function getRequestFailureReason(error: unknown) {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
    const response = record?.response && typeof record.response === 'object' ?
        record.response as Record<string, unknown> : null;
    const status = Number(record?.status || record?.statusCode || response?.status);

    if (Number.isInteger(status) && status >= 400 && status <= 599) return `http-${status}`;
    if (getFailureStatus(error) === 'timeout') return 'client-group-deadline';
    return 'unclassified-request-error';
}

async function searchAuthoritativeSeriesWithTimeout(options: PtvDirectSearchOptions) {
    if (options.signal.aborted) throw new PtvSearchAbortedError();

    const controller = createPtvAbortController();
    const forwardAbort = () => controller.abort();
    let timedOut = false;
    const timeout = globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, PTV_SEARCH_DIRECT_GROUP_TIMEOUT_MS);

    options.signal.addEventListener('abort', forwardAbort, { once: true });

    try {
        return await searchPtvAuthoritativeSeries({
            ...options,
            signal: controller.signal
        });
    } catch (error) {
        if (options.signal.aborted) throw new PtvSearchAbortedError();
        if (timedOut) throw new PtvSearchPrimaryTimeoutError(PTV_SEARCH_DIRECT_GROUP_TIMEOUT_MS);
        throw error;
    } finally {
        globalThis.clearTimeout(timeout);
        options.signal.removeEventListener('abort', forwardAbort);
    }
}

function getDirectoryFailureStatus(
    statuses: readonly PtvDirectSearchOutcome['status'][]
): PtvDirectSearchOutcome['status'] {
    if (statuses.includes('timeout')) return 'timeout';
    if (statuses.includes('aborted')) return 'aborted';

    return 'error';
}

function getMovieOutcomeDetails(items: readonly PtvItem[], diagnostics: PtvSearchRecoveryDiagnostics) {
    const incomplete = !items.length && diagnostics.recoveryAttempted && !diagnostics.catalogExhausted;
    const endpointPaths = ['Users/{user}/Items'];

    if (diagnostics.catalogRequestsThisSearch > 0 && diagnostics.catalogRequestEndpoint) {
        endpointPaths.push('Users/{user}/Items');
    }

    return {
        endpointPaths,
        failureReason: incomplete ? 'incomplete-catalog-recovery' : undefined,
        status: incomplete ? 'error' as const : 'success' as const
    };
}

async function searchDirectDirectoryGroup(
    plan: PtvDirectSearchPlan,
    options: PtvDirectSearchOptions
): Promise<PtvDirectSearchOutcome> {
    const items: PtvItem[] = [];
    const failureStatuses: PtvDirectSearchOutcome['status'][] = [];
    const failureReasons: string[] = [];
    const endpointPaths: string[] = [];
    let requestCount = 0;
    let successfulRequestCount = 0;
    const publishDirectoryItems = (directoryItems: readonly PtvItem[], completedRequestCount: number) => {
        options.onGroupResult?.({
            groupId: plan.groupId,
            items: rankAndDedupeItems(directoryItems, options.query, options.perGroupLimit),
            requestCount: completedRequestCount,
            source: 'direct'
        });
    };

    const requestEndpoint = async (endpoint: NonNullable<PtvDirectSearchPlan['directoryEndpoints']>[number]) => {
        endpointPaths.push(endpoint.path);
        try {
            const response = await requestPtvJson<PtvItemsResult<PtvItem>>(endpoint.path, {
                params: {
                    EnableImages: true,
                    EnableImageTypes: 'Primary,Thumb',
                    EnableTotalRecordCount: false,
                    EnableUserData: false,
                    Fields: 'PrimaryImageAspectRatio,SortName',
                    ImageTypeLimit: 1,
                    Limit: options.perGroupLimit,
                    SearchTerm: options.query,
                    SortBy: 'SortName',
                    SortOrder: 'Ascending',
                    StartIndex: 0,
                    UserId: options.userId
                },
                serverId: options.serverId,
                signal: options.signal
            });

            if (!Array.isArray(response.Items)) {
                throw new TypeError(`${endpoint.path} returned an invalid response.`);
            }

            return {
                items: response.Items.map(item => ({
                    ...item,
                    ServerId: String(item.ServerId || options.serverId),
                    Type: String(item.Type || endpoint.itemType)
                })),
                status: 'success' as const
            };
        } catch (error) {
            return {
                failureReason: getRequestFailureReason(error),
                items: [] as PtvItem[],
                status: getFailureStatus(error)
            };
        }
    };

    if (options.parallelDirectoryEndpoints) {
        const endpoints = plan.directoryEndpoints || [];
        const endpointOutcomes: Awaited<ReturnType<typeof requestEndpoint>>[] = [];
        let completedRequestCount = 0;

        await Promise.all(endpoints.map(async (endpoint, endpointIndex) => {
            const outcome = await requestEndpoint(endpoint);

            endpointOutcomes[endpointIndex] = outcome;
            completedRequestCount += 1;
            if (outcome.status === 'success') {
                publishDirectoryItems(endpointOutcomes.flatMap(entry => entry?.items || []), completedRequestCount);
            }
        }));

        requestCount = endpointOutcomes.length;
        endpointOutcomes.forEach(outcome => {
            if (outcome.status === 'success') {
                successfulRequestCount += 1;
                items.push(...outcome.items);
            } else {
                failureStatuses.push(outcome.status);
                failureReasons.push(outcome.failureReason || 'unclassified-request-error');
            }
        });
    } else {
        for (const endpoint of plan.directoryEndpoints || []) {
            if (options.signal.aborted) break;

            requestCount += 1;
            const outcome = await requestEndpoint(endpoint);

            if (outcome.status === 'success') {
                successfulRequestCount += 1;
                items.push(...outcome.items);
                publishDirectoryItems(items, requestCount);
            } else {
                failureStatuses.push(outcome.status);
                failureReasons.push(outcome.failureReason || 'unclassified-request-error');
            }
        }
    }

    if (successfulRequestCount) {
        return {
            endpointPaths,
            groupId: plan.groupId,
            items: rankAndDedupeItems(items, options.query, options.perGroupLimit),
            requestCount,
            status: 'success'
        };
    }

    return {
        endpointPaths,
        failureReason: failureReasons.every(reason => reason === failureReasons[0]) ? failureReasons[0] : 'multiple-request-failures',
        groupId: plan.groupId,
        items: [],
        requestCount,
        status: getDirectoryFailureStatus(failureStatuses)
    };
}

async function searchDirectGroup(
    plan: PtvDirectSearchPlan,
    options: PtvDirectSearchOptions
): Promise<PtvDirectSearchOutcome> {
    if (plan.groupId === 'movies') {
        try {
            const result = await searchPtvItems<PtvItem>({
                fields: PTV_SEARCH_DIRECT_FIELDS,
                includeItemTypes: 'Movie',
                limit: options.perGroupLimit,
                onPrimaryResult: primaryResult => {
                    options.onGroupResult?.({
                        groupId: plan.groupId,
                        items: rankAndDedupeItems(primaryResult.Items || [], options.query, options.perGroupLimit),
                        requestCount: 1,
                        source: 'direct'
                    });
                },
                primaryTimeoutMs: PTV_SEARCH_DIRECT_GROUP_TIMEOUT_MS,
                recoveryFields: PTV_SEARCH_DIRECT_FIELDS,
                recursive: true,
                searchTerm: options.query,
                serverId: options.serverId,
                signal: options.signal,
                userId: options.userId
            });
            const diagnostics = result.ptvSearchRecoveryDiagnostics;
            const items = rankAndDedupeItems(result.Items || [], options.query, options.perGroupLimit);
            const requestCount = 1
                + diagnostics.catalogRequestsThisSearch
                + (diagnostics.catalogHydrationCount > 0 ? 1 : 0);

            return {
                ...getMovieOutcomeDetails(items, diagnostics),
                groupId: plan.groupId,
                items,
                requestCount
            };
        } catch (error) {
            return {
                endpointPaths: ['Users/{user}/Items'],
                failureReason: getRequestFailureReason(error),
                groupId: plan.groupId,
                items: [],
                requestCount: 1,
                status: getFailureStatus(error)
            };
        }
    }

    if (plan.groupId === 'shows') {
        try {
            const result = await searchAuthoritativeSeriesWithTimeout(options);

            return {
                endpointPaths: ['Users/{user}/Items'],
                groupId: plan.groupId,
                items: result.items,
                requestCount: Math.max(1, result.pagesLoaded),
                status: 'success'
            };
        } catch (error) {
            return {
                endpointPaths: ['Users/{user}/Items'],
                failureReason: getRequestFailureReason(error),
                groupId: plan.groupId,
                items: [],
                requestCount: 1,
                status: getFailureStatus(error)
            };
        }
    }

    if (plan.directoryEndpoints?.length) return searchDirectDirectoryGroup(plan, options);

    const outcome = await getPtvSearchPrimaryOutcome<PtvItem>({
        EnableImages: true,
        EnableImageTypes: 'Primary,Backdrop,Thumb',
        EnableTotalRecordCount: false,
        EnableUserData: false,
        Fields: PTV_SEARCH_DIRECT_FIELDS,
        GroupItems: false,
        ImageTypeLimit: 1,
        IncludeItemTypes: plan.includeItemTypes.join(','),
        Limit: options.perGroupLimit,
        Recursive: true,
        SearchTerm: options.query
    }, {
        primaryTimeoutMs: PTV_SEARCH_DIRECT_GROUP_TIMEOUT_MS,
        serverId: options.serverId,
        signal: options.signal,
        userId: options.userId
    });

    return outcome.status === 'success' ? {
        endpointPaths: ['Users/{user}/Items'],
        groupId: plan.groupId,
        items: rankAndDedupeItems(outcome.items, options.query, options.perGroupLimit),
        requestCount: 1,
        status: 'success'
    } : {
        endpointPaths: ['Users/{user}/Items'],
        failureReason: getRequestFailureReason(outcome.error),
        groupId: plan.groupId,
        items: [],
        requestCount: 1,
        status: outcome.status
    };
}

async function searchDirectGroupsBounded(
    plans: readonly PtvDirectSearchPlan[],
    options: Readonly<{
        onGroupResult?: (progress: PtvSearchGroupProgress) => void;
        parallelDirectoryEndpoints?: boolean;
        perGroupLimit: number;
        query: string;
        serverId: string;
        signal: AbortSignal;
        shouldContinue?: () => boolean;
        userId: string;
    }>
): Promise<PtvDirectSearchBatch> {
    if (!plans.length) return { outcomes: [], requestCount: 0 };
    if (options.signal.aborted) throw new PtvSearchAbortedError();

    const controller = createPtvAbortController();
    const forwardAbort = () => controller.abort();
    const outcomes = new Map<PtvSearchGroupId, PtvDirectSearchOutcome>();
    let nextPlanIndex = 0;
    let requestCount = 0;
    let timedOut = false;
    const timeout = globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, PTV_SEARCH_DIRECT_BATCH_TIMEOUT_MS);

    options.signal.addEventListener('abort', forwardAbort, { once: true });

    const runWorker = async () => {
        while (!controller.signal.aborted) {
            const planIndex = nextPlanIndex;
            if (planIndex >= plans.length) return;

            const plan = plans[planIndex];

            if (
                options.shouldContinue
                && !options.shouldContinue()
                && !PTV_CRITICAL_DIRECT_GROUPS.has(plan.groupId)
            ) return;

            nextPlanIndex += 1;

            const outcome = await searchDirectGroup(plan, {
                ...options,
                signal: controller.signal
            });

            requestCount += outcome.requestCount;
            outcomes.set(plan.groupId, outcome);
            if (outcome.status === 'success') {
                options.onGroupResult?.({
                    groupId: outcome.groupId,
                    items: outcome.items,
                    requestCount: outcome.requestCount,
                    source: 'direct'
                });
            }
        }
    };
    const workerCount = Math.min(PTV_SEARCH_DIRECT_MAX_CONCURRENCY, plans.length);

    try {
        await Promise.all(Array.from({ length: workerCount }, runWorker));
    } finally {
        globalThis.clearTimeout(timeout);
        options.signal.removeEventListener('abort', forwardAbort);
    }

    if (options.signal.aborted) throw new PtvSearchAbortedError();

    return {
        outcomes: plans.map(plan => {
            const outcome = outcomes.get(plan.groupId);

            if (outcome && !(timedOut && outcome.status === 'aborted')) return outcome;

            return {
                endpointPaths: outcome?.endpointPaths || [],
                failureReason: timedOut ? 'client-batch-deadline' as const : 'request-error' as const,
                groupId: plan.groupId,
                items: [],
                requestCount: outcome?.requestCount || 0,
                status: timedOut ? 'timeout' : 'error'
            };
        }),
        requestCount
    };
}

async function searchPrimaryHints(options: Readonly<{
    includeItemTypes: readonly string[];
    limit: number;
    perGroupLimit: number;
    query: string;
    serverId: string;
    signal: AbortSignal;
    userId: string;
}>) {
    if (options.signal.aborted) throw new PtvSearchAbortedError();

    const controller = createPtvAbortController();
    const forwardAbort = () => controller.abort();
    let timedOut = false;
    const timeout = globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, PTV_SEARCH_HINT_PRIMARY_TIMEOUT_MS);

    options.signal.addEventListener('abort', forwardAbort, { once: true });

    try {
        return await searchPtvHints({
            ...options,
            signal: controller.signal
        });
    } catch (error) {
        if (options.signal.aborted) throw new PtvSearchAbortedError();
        if (timedOut || controller.signal.aborted) {
            throw new PtvSearchPrimaryTimeoutError(PTV_SEARCH_HINT_PRIMARY_TIMEOUT_MS);
        }
        throw error;
    } finally {
        globalThis.clearTimeout(timeout);
        options.signal.removeEventListener('abort', forwardAbort);
    }
}

export type PtvResilientSearchResult = Readonly<{
    endpointPaths: Partial<Record<PtvSearchGroupId, string[]>>;
    failedGroupIds: PtvSearchGroupId[];
    failedGroupReasons: Partial<Record<PtvSearchGroupId, string>>;
    failedGroupStatuses: Partial<Record<PtvSearchGroupId, 'error' | 'timeout'>>;
    groups: PtvGroupedSearchHints;
    hintCount: number;
    primaryStatus: 'error' | 'success' | 'timeout';
    recoveredGroupIds: PtvSearchGroupId[];
    requestCount: number;
    totalRecordCount: number;
}>;

export type PtvFailedGroupRetryResult = Readonly<{
    endpointPaths: Partial<Record<PtvSearchGroupId, string[]>>;
    failedGroupReasons: Partial<Record<PtvSearchGroupId, string>>;
    failedGroupStatuses: Partial<Record<PtvSearchGroupId, 'error' | 'timeout'>>;
    groups: Partial<PtvGroupedSearchHints>;
    requestCount: number;
}>;

export async function retryPtvFailedSearchGroups(options: Readonly<{
    failedGroupIds: readonly PtvSearchGroupId[];
    includeItemTypes: readonly string[];
    perGroupLimit: number;
    query: string;
    serverId: string;
    signal: AbortSignal;
    userId: string;
}>): Promise<PtvFailedGroupRetryResult> {
    if (options.signal.aborted) throw new PtvSearchAbortedError();

    const failedIds = new Set(options.failedGroupIds);
    const plans = getRequestedPlans(options.includeItemTypes).filter(plan => failedIds.has(plan.groupId));
    const batch = await searchDirectGroupsBounded(plans, options);
    const groups: Partial<PtvGroupedSearchHints> = {};
    const endpointPaths: PtvFailedGroupRetryResult['endpointPaths'] = {};
    const failedGroupReasons: PtvFailedGroupRetryResult['failedGroupReasons'] = {};
    const failedGroupStatuses: PtvFailedGroupRetryResult['failedGroupStatuses'] = {};

    batch.outcomes.forEach(outcome => {
        endpointPaths[outcome.groupId] = outcome.endpointPaths || [];
        if (outcome.status === 'success' || outcome.items.length) {
            groups[outcome.groupId] = outcome.items;
        } else {
            failedGroupStatuses[outcome.groupId] = outcome.status === 'timeout' ? 'timeout' : 'error';
            failedGroupReasons[outcome.groupId] = outcome.failureReason || (outcome.status === 'timeout' ? 'client-group-deadline' : 'unclassified-request-error');
        }
    });

    return { endpointPaths, failedGroupReasons, failedGroupStatuses, groups, requestCount: batch.requestCount };
}

export async function searchPtvWithRecovery(options: Readonly<{
    includeItemTypes: readonly string[];
    limit: number;
    onGroupResult?: (progress: PtvSearchGroupProgress) => void;
    perGroupLimit: number;
    query: string;
    serverId: string;
    signal: AbortSignal;
    userId: string;
}>): Promise<PtvResilientSearchResult> {
    if (options.signal.aborted) throw new PtvSearchAbortedError();

    const requestedPlans = getRequestedPlans(options.includeItemTypes);
    const initialDirectPlans = getInitialDirectPlans(requestedPlans);

    const initialGroupIds = new Set(initialDirectPlans.map(plan => plan.groupId));
    const publishedDirectResults = new Map<PtvSearchGroupId, PtvSearchGroupProgress>();
    let continueDirectSearch = true;
    const directOptions = {
        ...options,
        onGroupResult: (progress: PtvSearchGroupProgress) => {
            publishedDirectResults.set(progress.groupId, progress);
            options.onGroupResult?.(progress);
        },
        shouldContinue: () => continueDirectSearch
    };
    const initialDirectPromise = searchDirectGroupsBounded(initialDirectPlans, directOptions);
    let primaryResult: Awaited<ReturnType<typeof searchPtvHints>> | null = null;
    let primaryError: unknown;

    try {
        primaryResult = await searchPrimaryHints(options);
        continueDirectSearch = false;

        requestedPlans.forEach(plan => {
            options.onGroupResult?.({
                groupId: plan.groupId,
                items: primaryResult?.groups[plan.groupId] || [],
                requestCount: 0,
                source: 'hints'
            });

            const publishedDirectResult = publishedDirectResults.get(plan.groupId);

            if (publishedDirectResult?.items.length) options.onGroupResult?.(publishedDirectResult);
        });
    } catch (error) {
        if (options.signal.aborted || error instanceof PtvSearchAbortedError) {
            await initialDirectPromise.catch(() => undefined);
            throw error;
        }
        primaryError = error;
    }

    const recoveryPlans = primaryResult ? [] : initialDirectPlans.filter(plan => !initialGroupIds.has(plan.groupId));
    const recoveryPromise = searchDirectGroupsBounded(recoveryPlans, directOptions);
    const [initialBatch, recoveryBatch] = await Promise.all([
        initialDirectPromise,
        recoveryPromise
    ]);
    const directOutcomes = [...initialBatch.outcomes, ...recoveryBatch.outcomes];

    if (options.signal.aborted) throw new PtvSearchAbortedError();

    const groups = primaryResult ? { ...primaryResult.groups } : emptyGroupedSearchHints();
    const endpointPaths: PtvResilientSearchResult['endpointPaths'] = {};
    const failedGroupIds: PtvSearchGroupId[] = [];
    const failedGroupReasons: PtvResilientSearchResult['failedGroupReasons'] = {};
    const failedGroupStatuses: PtvResilientSearchResult['failedGroupStatuses'] = {};
    const recoveredGroupIds: PtvSearchGroupId[] = [];
    let successfulDirectCount = 0;

    directOutcomes.forEach(outcome => {
        endpointPaths[outcome.groupId] = outcome.endpointPaths || [];
        const publishedItems = publishedDirectResults.get(outcome.groupId)?.items || [];
        const directItems = rankAndDedupeItems([
            ...publishedItems,
            ...outcome.items
        ], options.query, options.perGroupLimit);

        if (outcome.status === 'success' || directItems.length) {
            successfulDirectCount += 1;
            if (!recoveredGroupIds.includes(outcome.groupId)) recoveredGroupIds.push(outcome.groupId);
            groups[outcome.groupId] = outcome.groupId === 'shows' ?
                directItems :
                rankAndDedupeItems([
                    ...directItems,
                    ...(groups[outcome.groupId] || [])
                ], options.query, options.perGroupLimit);
            return;
        }

        if (
            !primaryResult
            || (outcome.groupId === 'movies' && !(groups.movies || []).length)
        ) {
            failedGroupIds.push(outcome.groupId);
            failedGroupStatuses[outcome.groupId] = outcome.status === 'timeout' ? 'timeout' : 'error';
            failedGroupReasons[outcome.groupId] = outcome.failureReason || (outcome.status === 'timeout' ? 'client-group-deadline' : 'unclassified-request-error');
        }
    });

    if (!primaryResult) {
        const directGroupIds = new Set(directOutcomes.map(outcome => outcome.groupId));

        requestedPlans.forEach(plan => {
            if (!directGroupIds.has(plan.groupId) && !failedGroupIds.includes(plan.groupId)) {
                failedGroupIds.push(plan.groupId);
                failedGroupStatuses[plan.groupId] = getPtvSearchHintFailureKind(primaryError) === 'timeout' ? 'timeout' : 'error';
                failedGroupReasons[plan.groupId] = 'primary-hints-unavailable';
            }
        });
    }

    if (!primaryResult && successfulDirectCount === 0 && directOutcomes.length === 0) {
        throw primaryError || new Error('Search recovery failed');
    }

    const itemCount = Object.values(groups).reduce((total, items) => total + items.length, 0);
    let primaryStatus: PtvResilientSearchResult['primaryStatus'] = 'success';

    if (!primaryResult) {
        primaryStatus = getPtvSearchHintFailureKind(primaryError) === 'timeout' ? 'timeout' : 'error';
    }

    return {
        endpointPaths,
        failedGroupIds,
        failedGroupReasons,
        failedGroupStatuses,
        groups,
        hintCount: primaryResult?.hintCount || 0,
        primaryStatus,
        recoveredGroupIds,
        requestCount: 1 + initialBatch.requestCount + recoveryBatch.requestCount,
        totalRecordCount: Math.max(primaryResult?.totalRecordCount || 0, itemCount)
    };
}
