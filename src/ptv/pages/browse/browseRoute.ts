import {
    getPtvQueryStringValue,
    parsePtvQueryString,
    serializePtvQueryString,
    type PtvQueryStringEntry
} from '../../core/queryString';

export type PtvBrowseMediaKind = 'collections' | 'movies' | 'shows';

export type PtvBrowseView =
    | 'continue'
    | 'featured'
    | 'genre'
    | 'genres'
    | 'landing'
    | 'latest'
    | 'network'
    | 'networks'
    | 'season'
    | 'studio'
    | 'studios'
    | 'trending'
    | 'unsupported';

export type PtvBrowseRoute = Readonly<{
    canonicalHref: string;
    canonicalRouteKey: string;
    collectionId: string;
    error: string;
    filterType: 'collection' | 'genre' | 'network' | 'none' | 'query' | 'studio';
    filterValue: string;
    genre: string;
    kind: PtvBrowseMediaKind;
    network: string;
    page: number;
    pageSize: number;
    query: string;
    rawView: string;
    scopeAlias: string;
    seasonParentId: string;
    sortBy: string;
    sortOrder: 'Ascending' | 'Descending';
    studio: string;
    view: PtvBrowseView;
}>;

export type PtvBrowseRouteUpdates = Partial<Pick<PtvBrowseRoute,
    | 'collectionId'
    | 'genre'
    | 'network'
    | 'page'
    | 'query'
    | 'scopeAlias'
    | 'seasonParentId'
    | 'sortBy'
    | 'sortOrder'
    | 'studio'
    | 'view'
>>;

const PTV_BROWSE_PAGE_SIZE = 50;
const PTV_BROWSE_MAX_PAGE = 200;
const PTV_BROWSE_SORTS = new Set([
    'CommunityRating',
    'DateCreated',
    'DatePlayed',
    'PremiereDate',
    'SortName'
]);

const SUPPORTED_VIEWS: Record<PtvBrowseMediaKind, ReadonlySet<PtvBrowseView>> = {
    collections: new Set(['featured', 'genres', 'landing']),
    movies: new Set(['genre', 'genres', 'landing', 'latest', 'studio', 'studios', 'trending']),
    shows: new Set(['continue', 'genre', 'genres', 'landing', 'latest', 'network', 'networks', 'season', 'trending'])
};

function normalizeText(value: string | null | undefined) {
    return String(value || '').trim();
}

function normalizeKey(value: string | null | undefined) {
    return normalizeText(value).toLowerCase();
}

function getBrowseKind(pathname: string): PtvBrowseMediaKind {
    const normalizedPath = normalizeKey(pathname).replace(/^#/, '');

    if (normalizedPath.includes('collections')) return 'collections';
    if (normalizedPath.includes('shows') || normalizedPath.includes('/tv')) return 'shows';

    return 'movies';
}

function getBrowsePath(kind: PtvBrowseMediaKind) {
    if (kind === 'collections') return '#/collections';

    return `#/${kind}`;
}

function getBrowsePathView(pathname: string) {
    const segments = normalizeKey(pathname)
        .replace(/^#/, '')
        .split('/')
        .filter(Boolean);

    return segments.length > 1 ? segments[segments.length - 1] : '';
}

function getBrowseViewPath(kind: PtvBrowseMediaKind, view: PtvBrowseView) {
    const basePath = getBrowsePath(kind);

    if (view === 'landing' || view === 'unsupported') return basePath;

    return `${basePath}/${view}`;
}

function getDefaultSort(view: PtvBrowseView) {
    if (view === 'latest') return { sortBy: 'DateCreated', sortOrder: 'Descending' as const };
    if (view === 'continue') return { sortBy: 'DatePlayed', sortOrder: 'Descending' as const };
    if (view === 'trending') return { sortBy: 'CommunityRating', sortOrder: 'Descending' as const };

    return { sortBy: 'SortName', sortOrder: 'Ascending' as const };
}

function getParam(params: PtvQueryStringEntry[], key: string) {
    return getPtvQueryStringValue(params, key);
}

function getFilter(view: PtvBrowseView, params: PtvQueryStringEntry[]) {
    if (view === 'genre') return { filterType: 'genre' as const, filterValue: normalizeText(getParam(params, 'genre')) };
    if (view === 'studio') return { filterType: 'studio' as const, filterValue: normalizeText(getParam(params, 'studio')) };
    if (view === 'network') return { filterType: 'network' as const, filterValue: normalizeText(getParam(params, 'network')) };

    const collectionId = normalizeText(getParam(params, 'collectionId'));
    const query = normalizeText(getParam(params, 'query') || getParam(params, 'q'));

    if (collectionId) return { filterType: 'collection' as const, filterValue: collectionId };
    if (query) return { filterType: 'query' as const, filterValue: query };

    return { filterType: 'none' as const, filterValue: '' };
}

function clampPage(value: string) {
    const parsed = Number.parseInt(String(value || '0'), 10);

    if (!Number.isFinite(parsed)) return 0;

    return Math.max(0, Math.min(PTV_BROWSE_MAX_PAGE, parsed));
}

function canonicalizeBrowseParams(route: Omit<PtvBrowseRoute, 'canonicalHref' | 'canonicalRouteKey'>) {
    const defaultSort = getDefaultSort(route.view);
    const entries: PtvQueryStringEntry[] = [
        ['topParentId', route.scopeAlias],
        ['genre', route.genre],
        ['studio', route.studio],
        ['network', route.network],
        ['collectionId', route.collectionId],
        ['seriesId', route.seasonParentId],
        ['query', route.query],
        ['sort', route.sortBy === defaultSort.sortBy ? '' : route.sortBy],
        ['sortOrder', route.sortOrder === defaultSort.sortOrder ? '' : route.sortOrder],
        ['page', route.page ? String(route.page) : '']
    ];

    return serializePtvQueryString(entries);
}

function getPtvBrowseRouteError(route: Pick<PtvBrowseRoute,
    'genre' | 'network' | 'rawView' | 'seasonParentId' | 'studio' | 'view'
>) {
    if (route.view === 'unsupported') return `The ${route.rawView || 'requested'} browse view is not supported.`;
    if (route.view === 'genre' && !route.genre) return 'Choose a genre to browse.';
    if (route.view === 'studio' && !route.studio) return 'Choose a studio to browse.';
    if (route.view === 'network' && !route.network) return 'Choose a network to browse.';
    if (route.view === 'season' && !route.seasonParentId) return 'Choose a series before opening its seasons.';

    return '';
}

function getUpdatedValue(update: string | undefined, current: string) {
    return update === undefined ? current : update;
}

function getFilterUpdate(update: string | undefined, preserveCurrent: boolean, current: string) {
    if (update !== undefined) return update;

    return preserveCurrent ? current : '';
}

export function parsePtvBrowseRoute(pathname: string, search = ''): PtvBrowseRoute {
    const kind = getBrowseKind(pathname);
    const params = parsePtvQueryString(search);
    const rawView = normalizeKey(getParam(params, 'view') || getBrowsePathView(pathname));
    const requestedView = (rawView || 'landing') as PtvBrowseView;
    const view = SUPPORTED_VIEWS[kind].has(requestedView) ? requestedView : 'unsupported';
    const genre = normalizeText(getParam(params, 'genre'));
    const studio = normalizeText(getParam(params, 'studio'));
    const network = normalizeText(getParam(params, 'network'));
    const collectionId = normalizeText(getParam(params, 'collectionId'));
    const seasonParentId = normalizeText(getParam(params, 'seriesId') || getParam(params, 'parentId'));
    const query = normalizeText(getParam(params, 'query') || getParam(params, 'q'));
    const scopeAlias = normalizeKey(getParam(params, 'topParentId') || getParam(params, 'kind'));
    const defaultSort = getDefaultSort(view);
    const requestedSort = normalizeText(getParam(params, 'sort'));
    const sortBy = PTV_BROWSE_SORTS.has(requestedSort) ? requestedSort : defaultSort.sortBy;
    const requestedSortOrder = normalizeKey(getParam(params, 'sortOrder'));
    let sortOrder = defaultSort.sortOrder;

    if (requestedSortOrder === 'descending') sortOrder = 'Descending';
    if (requestedSortOrder === 'ascending') sortOrder = 'Ascending';

    const filter = getFilter(view, params);
    const error = getPtvBrowseRouteError({ genre, network, rawView, seasonParentId, studio, view });

    const routeWithoutCanonical = {
        collectionId,
        error,
        filterType: filter.filterType,
        filterValue: filter.filterValue,
        genre,
        kind,
        network,
        page: clampPage(getParam(params, 'page')),
        pageSize: PTV_BROWSE_PAGE_SIZE,
        query,
        rawView,
        scopeAlias,
        seasonParentId,
        sortBy,
        sortOrder,
        studio,
        view
    };
    const canonicalSearch = canonicalizeBrowseParams(routeWithoutCanonical);
    const searchSuffix = canonicalSearch ? `?${canonicalSearch}` : '';
    const canonicalHref = `${getBrowseViewPath(kind, view)}${searchSuffix}`;

    return {
        ...routeWithoutCanonical,
        canonicalHref,
        canonicalRouteKey: `${kind}|${view}|${canonicalSearch || 'unfiltered'}`
    };
}

export function buildPtvBrowseHref(route: PtvBrowseRoute, updates: PtvBrowseRouteUpdates = {}) {
    const nextView = updates.view || route.view;
    const scopeAlias = getUpdatedValue(updates.scopeAlias, route.scopeAlias);
    const genre = getFilterUpdate(updates.genre, nextView === 'genre', route.genre);
    const studio = getFilterUpdate(updates.studio, nextView === 'studio', route.studio);
    const network = getFilterUpdate(updates.network, nextView === 'network', route.network);
    const collectionId = getUpdatedValue(updates.collectionId, route.collectionId);
    const seasonParentId = getUpdatedValue(updates.seasonParentId, route.seasonParentId);
    const query = getUpdatedValue(updates.query, route.query);
    const page = updates.page === undefined ? 0 : updates.page;
    const defaultSort = getDefaultSort(nextView);
    const sortBy = updates.sortBy || defaultSort.sortBy;
    const sortOrder = updates.sortOrder || defaultSort.sortOrder;
    const entries: PtvQueryStringEntry[] = [
        ['topParentId', scopeAlias],
        ['genre', genre],
        ['studio', studio],
        ['network', network],
        ['collectionId', collectionId],
        ['seriesId', seasonParentId],
        ['query', query],
        ['sort', sortBy === defaultSort.sortBy ? '' : sortBy],
        ['sortOrder', sortOrder === defaultSort.sortOrder ? '' : sortOrder],
        ['page', page > 0 ? String(page) : '']
    ];
    const search = serializePtvQueryString(entries);
    const searchSuffix = search ? `?${search}` : '';

    return `${getBrowseViewPath(route.kind, nextView)}${searchSuffix}`;
}

export function getPtvBrowseSupportedViews(kind: PtvBrowseMediaKind) {
    return [...SUPPORTED_VIEWS[kind]];
}
