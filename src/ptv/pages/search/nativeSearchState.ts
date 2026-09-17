export type PtvSearchGroupId =
    | 'albums'
    | 'artists'
    | 'collections'
    | 'episodes'
    | 'genres'
    | 'movies'
    | 'music'
    | 'people'
    | 'reading'
    | 'shows'
    | 'studios';

export type PtvSearchFilterId =
    | 'all'
    | 'collections'
    | 'episodes'
    | 'genres'
    | 'movies'
    | 'music'
    | 'people'
    | 'reading'
    | 'shows'
    | 'studios';

export type PtvSearchGroupStatus =
    | 'cancelled'
    | 'empty'
    | 'error'
    | 'idle'
    | 'loading'
    | 'queued'
    | 'success'
    | 'timeout';

export type PtvSearchFilterConfig = Readonly<{
    groups: readonly PtvSearchGroupId[];
    id: PtvSearchFilterId;
    label: string;
}>;

export type PtvSearchPresentation = Readonly<{
    failedGroupCount: number;
    isPending: boolean;
    isSettled: boolean;
    itemCount: number;
}>;

const ALL_SEARCH_GROUPS: readonly PtvSearchGroupId[] = [
    'movies',
    'shows',
    'collections',
    'episodes',
    'genres',
    'studios',
    'people',
    'reading',
    'music',
    'albums',
    'artists'
];

export const PTV_SEARCH_FILTERS: readonly PtvSearchFilterConfig[] = [
    { id: 'all', label: 'All', groups: ALL_SEARCH_GROUPS },
    { id: 'movies', label: 'Movies', groups: ['movies'] },
    { id: 'shows', label: 'Shows', groups: ['shows'] },
    { id: 'episodes', label: 'Episodes', groups: ['episodes'] },
    { id: 'genres', label: 'Genres', groups: ['genres'] },
    { id: 'studios', label: 'Studios', groups: ['studios'] },
    { id: 'music', label: 'Music', groups: ['music', 'albums', 'artists'] },
    { id: 'people', label: 'People', groups: ['people'] },
    { id: 'collections', label: 'Collections', groups: ['collections'] },
    { id: 'reading', label: 'Reading', groups: ['reading'] }
];

const PTV_SEARCH_FILTER_IDS = new Set(PTV_SEARCH_FILTERS.map(filter => filter.id));
const PENDING_SEARCH_STATUSES = new Set<PtvSearchGroupStatus>(['idle', 'loading', 'queued']);
const FAILED_SEARCH_STATUSES = new Set<PtvSearchGroupStatus>(['cancelled', 'error', 'timeout']);

export function normalizePtvSearchFilter(value: unknown): PtvSearchFilterId {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';

    return PTV_SEARCH_FILTER_IDS.has(normalized as PtvSearchFilterId) ?
        normalized as PtvSearchFilterId :
        'all';
}

export function getPtvSearchFilterConfig(filter: PtvSearchFilterId) {
    return PTV_SEARCH_FILTERS.find(candidate => candidate.id === filter) || PTV_SEARCH_FILTERS[0];
}

export function buildPtvSearchParams(query: string, filter: PtvSearchFilterId) {
    const normalizedQuery = query.trim();
    const params: Record<string, string> = {
        filter: normalizePtvSearchFilter(filter),
        ptvGrouped: 'true'
    };

    if (normalizedQuery) params.query = normalizedQuery;

    return params;
}

export function serializePtvSearchParams(query: string, filter: PtvSearchFilterId) {
    return Object.entries(buildPtvSearchParams(query, filter))
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
}

export function shouldRestartPtvCommittedSearch(
    draftWasInvalidated: boolean,
    draftQuery: string,
    committedQuery: string
) {
    return draftWasInvalidated && draftQuery.trim() === committedQuery.trim();
}

export function getPtvSearchPresentation(
    groups: readonly Readonly<{ itemCount: number; status: PtvSearchGroupStatus }>[]
): PtvSearchPresentation {
    return groups.reduce<PtvSearchPresentation>((summary, group) => ({
        failedGroupCount: summary.failedGroupCount + (FAILED_SEARCH_STATUSES.has(group.status) ? 1 : 0),
        isPending: summary.isPending || PENDING_SEARCH_STATUSES.has(group.status),
        isSettled: summary.isSettled && !PENDING_SEARCH_STATUSES.has(group.status),
        itemCount: summary.itemCount + Math.max(0, group.itemCount)
    }), {
        failedGroupCount: 0,
        isPending: false,
        isSettled: true,
        itemCount: 0
    });
}
