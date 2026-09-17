import { getPtvItems } from '../../api/items';
import type { PtvItem, PtvItemsResult } from '../../api/types';

export const PTV_AUTHORITATIVE_SERIES_PAGE_SIZE = 50;
export const PTV_AUTHORITATIVE_SERIES_PAGE_BUDGET = 4;
export const PTV_AUTHORITATIVE_SERIES_FIELDS = [
    'BackdropImageTags',
    'ChildCount',
    'CommunityRating',
    'CriticRating',
    'DateCreated',
    'Genres',
    'ImageTags',
    'OfficialRating',
    'OriginalTitle',
    'Overview',
    'ParentBackdropImageTags',
    'ParentBackdropItemId',
    'ParentLogoImageTag',
    'ParentLogoItemId',
    'ParentThumbImageTag',
    'ParentThumbItemId',
    'PremiereDate',
    'PresentationUniqueKey',
    'PrimaryImageAspectRatio',
    'ProductionYear',
    'ProviderIds',
    'RecursiveItemCount',
    'RunTimeTicks',
    'SortName',
    'Studios',
    'Tags',
    'UserData'
] as const;

export type PtvAuthoritativeSeriesSearchOptions = Readonly<{
    perGroupLimit: number;
    query: string;
    serverId: string;
    signal: AbortSignal;
    userId: string;
}>;

export type PtvAuthoritativeSeriesSearchResult = Readonly<{
    items: PtvItem[];
    pagesLoaded: number;
    totalRecordCount: number;
}>;

type RankedSeries = Readonly<{
    firstSourceIndex: number;
    identities: Set<string>;
    item: PtvItem;
}>;

function createSeriesAbortError() {
    const error = new Error('Authoritative Series search was cancelled.');

    error.name = 'AbortError';
    return error;
}

function throwIfSeriesSearchAborted(signal: AbortSignal) {
    if (signal.aborted) throw createSeriesAbortError();
}

function awaitSeriesSearchAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
        void promise.catch(() => undefined);
        return Promise.reject(createSeriesAbortError());
    }

    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const cleanup = () => signal.removeEventListener('abort', onAbort);
        const onAbort = () => {
            if (settled) return;

            settled = true;
            cleanup();
            reject(createSeriesAbortError());
        };

        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            value => {
                if (settled) return;

                settled = true;
                cleanup();
                resolve(value);
            },
            error => {
                if (settled) return;

                settled = true;
                cleanup();
                reject(error);
            }
        );
    });
}

function getText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeSeriesText(value: unknown) {
    return getText(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('en-US')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function getSeriesYear(item: PtvItem) {
    const productionYear = typeof item.ProductionYear === 'number' ?
        String(item.ProductionYear) :
        getText(item.ProductionYear);

    return productionYear || getText(item.PremiereDate).slice(0, 4);
}

function getSeriesTitle(item: PtvItem) {
    return normalizeSeriesText(item.Name)
        || normalizeSeriesText(item.OriginalTitle)
        || normalizeSeriesText(item.SortName);
}

function getProviderIdentities(item: PtvItem) {
    const providerIds = item.ProviderIds;

    if (!providerIds || typeof providerIds !== 'object' || Array.isArray(providerIds)) return [];

    return Object.entries(providerIds as Record<string, unknown>)
        .map(([provider, value]) => {
            const providerId = getText(value).toLocaleLowerCase('en-US');

            return providerId ?
                `provider:${provider.toLocaleLowerCase('en-US')}:${providerId}` :
                '';
        })
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
}

function getSeriesLogicalIdentities(item: PtvItem, sourceIndex: number) {
    const year = getSeriesYear(item) || 'unknown';
    const presentationKey = getText(item.PresentationUniqueKey).toLocaleLowerCase('en-US');
    const authoritativeIdentities = [
        ...(presentationKey ? [`presentation:${presentationKey}`] : []),
        ...getProviderIdentities(item)
    ];

    if (authoritativeIdentities.length) {
        return authoritativeIdentities.map(identity => `${identity}|year:${year}`);
    }

    const title = getSeriesTitle(item);

    if (title) return [`title:${title}|year:${year}`];

    const id = getText(item.Id);

    return [id ? `id:${id}|year:${year}` : `source:${sourceIndex}`];
}

function getRecursiveItemCount(item: PtvItem) {
    const count = item.RecursiveItemCount;

    return typeof count === 'number' && Number.isFinite(count) ? count : null;
}

function getSeriesSearchRank(item: PtvItem, query: string) {
    const normalizedQuery = normalizeSeriesText(query);
    const candidateTitles = [item.Name, item.OriginalTitle, item.SortName]
        .map(normalizeSeriesText)
        .filter(Boolean);

    if (candidateTitles.some(title => title === normalizedQuery)) return 0;
    if (candidateTitles.some(title => title.startsWith(normalizedQuery))) return 1;
    if (candidateTitles.some(title => title.includes(normalizedQuery))) return 2;

    return 3;
}

function preferSeriesCandidate(current: PtvItem, candidate: PtvItem, query: string) {
    const currentCount = getRecursiveItemCount(current) ?? -1;
    const candidateCount = getRecursiveItemCount(candidate) ?? -1;

    if (candidateCount !== currentCount) return candidateCount > currentCount ? candidate : current;

    return getSeriesSearchRank(candidate, query) < getSeriesSearchRank(current, query) ?
        candidate :
        current;
}

function rankAndDedupeSeries(items: readonly PtvItem[], query: string) {
    const logicalSeries: RankedSeries[] = [];

    items.forEach((item, sourceIndex) => {
        if (item.RecursiveItemCount === 0) return;

        const identities = new Set(getSeriesLogicalIdentities(item, sourceIndex));
        const matchingGroups = logicalSeries.filter(group => (
            [...identities].some(identity => group.identities.has(identity))
        ));

        if (!matchingGroups.length) {
            logicalSeries.push({ firstSourceIndex: sourceIndex, identities, item });
            return;
        }

        const mergedGroup = matchingGroups.reduce<RankedSeries>((group, match) => ({
            firstSourceIndex: Math.min(group.firstSourceIndex, match.firstSourceIndex),
            identities: new Set([...group.identities, ...match.identities]),
            item: preferSeriesCandidate(group.item, match.item, query)
        }), { firstSourceIndex: sourceIndex, identities, item });
        const matchingGroupSet = new Set(matchingGroups);

        logicalSeries.splice(0, logicalSeries.length, ...logicalSeries.filter(group => !matchingGroupSet.has(group)));
        logicalSeries.push(mergedGroup);
    });

    logicalSeries.sort((left, right) => (
        getSeriesSearchRank(left.item, query) - getSeriesSearchRank(right.item, query)
        || left.firstSourceIndex - right.firstSourceIndex
    ));

    return logicalSeries.map(entry => entry.item);
}

function hasPositiveExactSeries(items: readonly PtvItem[], query: string) {
    return items.some(item => (
        getSeriesSearchRank(item, query) === 0
        && (getRecursiveItemCount(item) || 0) > 0
    ));
}

function getResponseItems(result: PtvItemsResult<PtvItem>) {
    return Array.isArray(result.Items) ? result.Items : [];
}

function getReportedTotalRecordCount(result: PtvItemsResult<PtvItem>) {
    const count = result.TotalRecordCount;

    return typeof count === 'number' && Number.isFinite(count) && count >= 0 ? count : null;
}

export async function searchPtvAuthoritativeSeries(
    options: PtvAuthoritativeSeriesSearchOptions
): Promise<PtvAuthoritativeSeriesSearchResult> {
    throwIfSeriesSearchAborted(options.signal);

    const query = options.query.trim();
    const limit = Math.max(0, Math.floor(options.perGroupLimit));

    if (!query || !limit) {
        return { items: [], pagesLoaded: 0, totalRecordCount: 0 };
    }

    const collectedItems: PtvItem[] = [];
    let pagesLoaded = 0;
    let reportedTotalRecordCount: number | null = null;
    let startIndex = 0;

    while (pagesLoaded < PTV_AUTHORITATIVE_SERIES_PAGE_BUDGET) {
        throwIfSeriesSearchAborted(options.signal);

        const result = await awaitSeriesSearchAbort(getPtvItems<PtvItem>({
            EnableImages: true,
            EnableImageTypes: 'Primary,Backdrop,Thumb,Logo',
            EnableUserData: true,
            Fields: PTV_AUTHORITATIVE_SERIES_FIELDS.join(','),
            GroupItems: false,
            ImageTypeLimit: 2,
            IncludeItemTypes: 'Series',
            Limit: PTV_AUTHORITATIVE_SERIES_PAGE_SIZE,
            Recursive: true,
            SearchTerm: query,
            StartIndex: startIndex
        }, {
            serverId: options.serverId,
            signal: options.signal,
            userId: options.userId
        }), options.signal);

        throwIfSeriesSearchAborted(options.signal);

        const pageItems = getResponseItems(result);
        const pageTotalRecordCount = getReportedTotalRecordCount(result);

        pagesLoaded += 1;
        collectedItems.push(...pageItems);
        startIndex += pageItems.length;
        if (pageTotalRecordCount !== null) {
            reportedTotalRecordCount = Math.max(reportedTotalRecordCount || 0, pageTotalRecordCount);
        }

        const matches = rankAndDedupeSeries(collectedItems, query);
        const reachedReportedEnd = reportedTotalRecordCount !== null
            && startIndex >= reportedTotalRecordCount;
        const reachedUnreportedEnd = reportedTotalRecordCount === null
            && pageItems.length < PTV_AUTHORITATIVE_SERIES_PAGE_SIZE;

        if (
            (matches.length >= limit && hasPositiveExactSeries(matches, query))
            || pageItems.length === 0
            || reachedReportedEnd
            || reachedUnreportedEnd
        ) {
            break;
        }
    }

    throwIfSeriesSearchAborted(options.signal);

    return {
        items: rankAndDedupeSeries(collectedItems, query).slice(0, limit),
        pagesLoaded,
        totalRecordCount: Math.max(reportedTotalRecordCount || 0, startIndex)
    };
}
