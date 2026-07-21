import type { PtvItem } from '../api/types';
import {
    normalizePtvLibraryRoot,
    getPtvLogicalRelativeMediaPath,
    normalizePtvLibraryItems,
    type PtvLibraryRootDiagnostics
} from './libraryRootNormalizer';

export type PtvSearchRecoveryReason =
    | 'aborted-primary-request'
    | 'authentication-error'
    | 'complete-primary-result'
    | 'disabled-non-movie-group'
    | 'empty-primary-result'
    | 'not-started'
    | 'primary-error'
    | 'primary-timeout'
    | 'root-divergence'
    | 'supplemental-failed'
    | 'underfilled-primary-result';

export type PtvSearchRecoveryCacheSource = 'memory' | 'network' | 'not-requested' | 'shared-promise';
export type PtvSearchPrimaryStatus = 'aborted' | 'error' | 'not-started' | 'success' | 'timeout';
export type PtvSearchSupplementalStatus = 'error' | 'not-requested' | 'success';

export type PtvSearchRecoveryCandidateDiagnostic = Readonly<{
    dateCreated: string;
    id: string;
    logicalRoot: string;
    name: string;
    productionYear: string;
    topParentId: string;
}>;

export type PtvSearchSupplementalRequestDiagnostic = Readonly<{
    enableImages: string;
    enableUserData: string;
    endpoint: string;
    fields: string;
    groupItems: string;
    imageTypeLimit: string;
    includeItemTypes: string;
    limit: string;
    parentId: string;
    userId: string;
}>;

export type PtvSearchRecoveryDiagnostics = Readonly<{
    catalogActualHasParentId: boolean;
    catalogActualParentId: string;
    catalogActualQueryKeys: string[];
    catalogActualRequestCountByParentId: Record<string, number>;
    catalogActualRequestUrl: string;
    catalogCacheAgeMs: number;
    catalogCachedItemCount: number;
    catalogExhausted: boolean;
    catalogHydrationCount: number;
    catalogHydrationDurationMs: number;
    catalogMatchCount: number;
    catalogMatchedLocations: string[];
    catalogMatchedNames: string[];
    catalogPageSize: number;
    catalogPagesLoaded: number;
    catalogRequestEndpoint: string;
    catalogRequestFields: string;
    catalogRequestParentId: string;
    catalogRequestSortBy: string;
    catalogRequestSortOrder: string;
    catalogRequestStartIndex: number;
    catalogRequestsThisSearch: number;
    catalogSearchDurationMs: number;
    catalogStopReason: 'cancelled' | 'empty-page' | 'exact-match-found' | 'exhausted' | 'not-requested' | 'page-budget' | 'repeated-page' | 'request-error' | 'time-budget';
    catalogStatus: 'cold' | 'complete' | 'not-requested' | 'partial' | 'refreshing';
    catalogTotalRecordCount: number;
    catalogCountByLogicalRoot: Record<string, number>;
    catalogCountByTopParentId: Record<string, number>;
    catalogDistinctTopParentIdCount: number;
    catalogPhysicalRootSample: string[];
    catalogTopParentIds: string[];
    cacheSource: PtvSearchRecoveryCacheSource;
    finalItemCount: number;
    primaryError: string;
    primaryDurationMs: number;
    primaryItemCount: number;
    primaryStatus: PtvSearchPrimaryStatus;
    rawTopParentIds: string[];
    recoveryAttempted: boolean;
    recoveryReason: PtvSearchRecoveryReason;
    supplementalCandidateCount: number;
    supplementalCandidateSample: PtvSearchRecoveryCandidateDiagnostic[];
    supplementalDurationMs: number;
    supplementalMatchCount: number;
    supplementalMatchedNames: string[];
    supplementalRawItemCount: number;
    supplementalRequest: PtvSearchSupplementalRequestDiagnostic;
    supplementalResponseKeys: string[];
    supplementalResponseShape: 'array' | 'invalid' | 'not-requested' | 'wrapped-items';
    supplementalStatus: PtvSearchSupplementalStatus;
    supplementalTotalRecordCount: number;
    timeoutOrAbort: 'aborted' | 'none' | 'timeout';
}>;

export function createPtvSearchRecoveryDiagnostics(
    overrides: Partial<PtvSearchRecoveryDiagnostics> = {}
): PtvSearchRecoveryDiagnostics {
    return {
        catalogActualHasParentId: false,
        catalogActualParentId: 'not-requested',
        catalogActualQueryKeys: [],
        catalogActualRequestCountByParentId: {},
        catalogActualRequestUrl: '',
        catalogCacheAgeMs: 0,
        catalogCachedItemCount: 0,
        catalogExhausted: false,
        catalogHydrationCount: 0,
        catalogHydrationDurationMs: 0,
        catalogMatchCount: 0,
        catalogMatchedLocations: [],
        catalogMatchedNames: [],
        catalogPageSize: 0,
        catalogPagesLoaded: 0,
        catalogRequestEndpoint: '',
        catalogRequestFields: '',
        catalogRequestParentId: 'not-requested',
        catalogRequestSortBy: '',
        catalogRequestSortOrder: '',
        catalogRequestStartIndex: 0,
        catalogRequestsThisSearch: 0,
        catalogSearchDurationMs: 0,
        catalogStopReason: 'not-requested',
        catalogStatus: 'not-requested',
        catalogTotalRecordCount: 0,
        catalogCountByLogicalRoot: {},
        catalogCountByTopParentId: {},
        catalogDistinctTopParentIdCount: 0,
        catalogPhysicalRootSample: [],
        catalogTopParentIds: [],
        cacheSource: 'not-requested',
        finalItemCount: 0,
        primaryError: '',
        primaryDurationMs: 0,
        primaryItemCount: 0,
        primaryStatus: 'not-started',
        rawTopParentIds: [],
        recoveryAttempted: false,
        recoveryReason: 'not-started',
        supplementalCandidateCount: 0,
        supplementalCandidateSample: [],
        supplementalDurationMs: 0,
        supplementalMatchCount: 0,
        supplementalMatchedNames: [],
        supplementalRawItemCount: 0,
        supplementalRequest: {
            enableImages: 'not-requested',
            enableUserData: 'not-requested',
            endpoint: '',
            fields: '',
            groupItems: 'not-requested',
            imageTypeLimit: 'not-requested',
            includeItemTypes: '',
            limit: '',
            parentId: 'not-requested',
            userId: ''
        },
        supplementalResponseKeys: [],
        supplementalResponseShape: 'not-requested',
        supplementalStatus: 'not-requested',
        supplementalTotalRecordCount: 0,
        timeoutOrAbort: 'none',
        ...overrides
    };
}

function getText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeSearchText(value: string) {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function getProductionYears(item: PtvItem) {
    const explicitYear = item.ProductionYear;
    const year = typeof explicitYear === 'number' ? String(explicitYear) : getText(explicitYear);
    const premiereYear = getText(item.PremiereDate).slice(0, 4);

    return [year, premiereYear].filter(Boolean);
}

function getPathBasename(item: PtvItem) {
    const relativePath = getPtvLogicalRelativeMediaPath(item);
    const basename = relativePath.split('/').filter(Boolean).pop() || '';

    return basename.replace(/\.[a-z0-9]{1,8}$/i, '');
}

function getCandidateText(item: PtvItem) {
    return [
        getText(item.Name),
        getText(item.OriginalTitle),
        getText(item.SortName)
    ].filter(Boolean);
}

function isMovie(item: PtvItem) {
    const type = getText(item.Type || item.MediaType);

    return !type || type.toLowerCase() === 'movie';
}

export function matchesPtvSearchRecoveryCandidate(item: PtvItem, searchTerm: string) {
    if (!isMovie(item)) return false;

    const normalizedTerm = normalizeSearchText(searchTerm);

    if (!normalizedTerm) return false;

    const queryYears = normalizedTerm.match(/\b(?:18|19|20)\d{2}\b/g) || [];
    const candidateYears = getProductionYears(item);

    if (queryYears.length && !queryYears.some(year => candidateYears.includes(year))) return false;

    const titleSearchTerm = normalizeSearchText(normalizedTerm.replace(/\b(?:18|19|20)\d{2}\b/g, ''));

    if (!titleSearchTerm) return queryYears.length > 0;

    const titleMatch = getCandidateText(item)
        .map(normalizeSearchText)
        .some(candidate => candidate.includes(titleSearchTerm));

    if (titleMatch) return true;

    return normalizeSearchText(getPathBasename(item)).includes(titleSearchTerm);
}

export function filterPtvSearchRecoveryCandidates(items: PtvItem[], searchTerm: string) {
    return items.filter(item => matchesPtvSearchRecoveryCandidate(item, searchTerm));
}

export function mergePtvSearchRecoveryItems(primaryItems: PtvItem[], supplementalItems: PtvItem[], limit: number) {
    return normalizePtvLibraryItems([...primaryItems, ...supplementalItems]).items.slice(0, limit);
}

export function getPtvSearchRecoveryReason(input: Readonly<{
    includeItemTypes?: string;
    isAuthenticationError?: boolean;
    limit: number;
    parentId?: string;
    primaryItemCount: number;
    primaryLibraryRoots: PtvLibraryRootDiagnostics;
    primaryStatus: PtvSearchPrimaryStatus;
}>): PtvSearchRecoveryReason {
    const itemTypes = (input.includeItemTypes || '').split(',').map(type => type.trim().toLowerCase()).filter(Boolean);
    const isMovieOnly = itemTypes.length === 1 && itemTypes[0] === 'movie';

    if (!isMovieOnly || input.parentId) return 'disabled-non-movie-group';
    if (input.primaryStatus === 'aborted') return 'aborted-primary-request';
    if (input.primaryStatus === 'timeout') return 'primary-timeout';
    if (input.primaryStatus === 'error') return input.isAuthenticationError ? 'authentication-error' : 'primary-error';
    if (input.primaryStatus === 'not-started') return 'not-started';
    if (!input.primaryItemCount) return 'empty-primary-result';
    if (input.primaryItemCount < input.limit) return 'underfilled-primary-result';

    const physicalRootCount = new Set(input.primaryLibraryRoots.groups.flatMap(root => root.physicalRoots)).size;

    return physicalRootCount > 1 ? 'root-divergence' : 'complete-primary-result';
}

export function shouldRecoverPtvSearchResults(reason: PtvSearchRecoveryReason) {
    return reason === 'empty-primary-result'
        || reason === 'primary-error'
        || reason === 'primary-timeout'
        || reason === 'root-divergence'
        || reason === 'underfilled-primary-result';
}

export function getPtvSearchRawTopParentIds(items: PtvItem[]) {
    return [...new Set(items
        .map(item => getText(item.TopParentId))
        .filter(Boolean))]
        .sort();
}

export function getPtvSearchRecoveryCandidateSample(items: PtvItem[], limit = 20): PtvSearchRecoveryCandidateDiagnostic[] {
    return items.slice(0, limit).map(item => ({
        dateCreated: getText(item.DateCreated),
        id: getText(item.Id),
        logicalRoot: normalizePtvLibraryRoot(item).logicalRoot,
        name: getText(item.Name),
        productionYear: getText(item.ProductionYear),
        topParentId: getText(item.TopParentId)
    }));
}
