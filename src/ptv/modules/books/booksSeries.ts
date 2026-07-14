import type {
    PtvReadingItem,
    PtvReadingRouteKind
} from './booksTypes';
import {
    normalizePtvReadingComparisonKey,
    parsePtvReadingFilename,
    type PtvReadingFilenameInfo
} from './readingFilename';

export type PtvReadingSeriesConfidence = 'explicit' | 'filename-high' | 'filename-low' | 'manual' | 'metadata' | 'provider';

export type PtvReadingSeriesItemInfo = Readonly<{
    confidence: PtvReadingSeriesConfidence;
    groupKey: string;
    issueNumber: number | null;
    issueText: string;
    seriesTitle: string;
    sortName: string;
    volumeNumber: number | null;
    year: number | null;
}>;

export type PtvReadingSeries = Readonly<{
    completedCount: number;
    confidence: PtvReadingSeriesItemInfo['confidence'];
    coverItem: PtvReadingItem;
    id: string;
    inProgressCount: number;
    itemCount: number;
    items: PtvReadingItem[];
    key: string;
    mediaKind: 'book-series' | 'comic' | 'manga';
    nextItem: PtvReadingItem;
    progressPercent: number;
    readCount: number;
    sortTitle: string;
    title: string;
    unreadCount: number;
    year: number | null;
}>;

export type PtvReadingSeriesOverride = Readonly<{
    coverItemId?: string;
    excluded?: boolean;
    issueNumber?: number | null;
    itemId: string;
    mediaKind?: 'book' | 'comic' | 'manga';
    seriesKey?: string;
    seriesTitle?: string;
    seriesYear?: number | null;
    volumeNumber?: number | null;
}>;

export type PtvReadingSeriesBuildOptions = Readonly<{
    overrides?: Record<string, PtvReadingSeriesOverride>;
}>;

function getBaseReadingTitle(item: PtvReadingItem) {
    const pathName = String(item.Path || '').split(/[\\/]/).pop() || '';

    return String(pathName || item.Name || item.SortName || '').trim();
}

function cleanSeriesCandidate(value: string) {
    return parsePtvReadingFilename(value).seriesTitle;
}

function parseYear(parsedFilename: PtvReadingFilenameInfo, item: PtvReadingItem) {
    if (item.ProductionYear) return Number(item.ProductionYear);

    return parsedFilename.year;
}

function parseNumber(value: string) {
    const number = Number.parseFloat(String(value || '').replace(/^0+(\d)/, '$1'));

    return Number.isFinite(number) ? number : null;
}

function getExplicitSeriesTitle(item: PtvReadingItem) {
    const explicitValue = String(
        item.SeriesName
        || item.Album
        || item.CollectionName
        || ''
    ).trim();

    return cleanSeriesCandidate(explicitValue);
}

function getExplicitSeriesId(item: PtvReadingItem) {
    return String(
        item.SeriesId
        || item.ProviderIds?.ComicVineSeries
        || item.ProviderIds?.ComicVineVolume
        || item.ProviderIds?.GoogleBooksSeries
        || item.ProviderIds?.OpenLibrarySeries
        || ''
    ).trim();
}

function getGroupingKey(source: string, title: string, _year: number | null, explicitId = '') {
    if (explicitId) return `${source}:${normalizeSeriesKey(explicitId)}`;

    const key = normalizeSeriesKey(title) || 'series';
    return `${source}:${key}`;
}

function getManualGroupKey(title: string, year: number | null, seriesKey = '') {
    if (!seriesKey) return getGroupingKey('filename', title, year);

    const key = normalizeSeriesKey(seriesKey) || 'series';

    return `manual:${key}`;
}

function getItemVolumeNumber(item: PtvReadingItem) {
    return parseNumber(String(item.ParentIndexNumber || ''));
}

function buildExplicitSeriesInfo(
    item: PtvReadingItem,
    parsedFilename: PtvReadingFilenameInfo,
    explicitSeriesTitle: string,
    year: number | null
) {
    const itemIndexNumber = parseNumber(String(item.IndexNumber || ''));

    if (!explicitSeriesTitle) return null;

    return {
        confidence: 'explicit',
        groupKey: getGroupingKey('explicit', explicitSeriesTitle, year),
        issueNumber: itemIndexNumber ?? parsedFilename.issueNumber,
        issueText: String(itemIndexNumber ?? parsedFilename.issueNumber ?? ''),
        seriesTitle: explicitSeriesTitle,
        sortName: parsedFilename.cleanTitle,
        volumeNumber: getItemVolumeNumber(item) ?? parsedFilename.volumeNumber,
        year
    } satisfies PtvReadingSeriesItemInfo;
}

function buildProviderSeriesInfo(
    item: PtvReadingItem,
    parsedFilename: PtvReadingFilenameInfo,
    explicitSeriesTitle: string,
    explicitSeriesId: string,
    year: number | null
) {
    if (!explicitSeriesId) return null;

    const itemIndexNumber = parseNumber(String(item.IndexNumber || ''));
    const seriesTitle = explicitSeriesTitle || parsedFilename.seriesTitle || parsedFilename.cleanTitle;

    return {
        confidence: 'provider',
        groupKey: getGroupingKey('provider', seriesTitle, year, explicitSeriesId),
        issueNumber: itemIndexNumber ?? parsedFilename.issueNumber,
        issueText: String(itemIndexNumber ?? parsedFilename.issueNumber ?? ''),
        seriesTitle,
        sortName: parsedFilename.cleanTitle,
        volumeNumber: getItemVolumeNumber(item) ?? parsedFilename.volumeNumber,
        year
    } satisfies PtvReadingSeriesItemInfo;
}

function buildFilenameSeriesInfo(parsedFilename: PtvReadingFilenameInfo, year: number | null) {
    if (parsedFilename.confidence === 'low') return null;
    if (parsedFilename.issueNumber == null && parsedFilename.volumeNumber == null) return null;

    const issueNumber = parsedFilename.issueNumber ?? parsedFilename.volumeNumber;

    return {
        confidence: 'filename-high',
        groupKey: getGroupingKey('filename', parsedFilename.seriesTitle, year),
        issueNumber,
        issueText: String(issueNumber ?? ''),
        seriesTitle: parsedFilename.seriesTitle,
        sortName: parsedFilename.cleanTitle,
        volumeNumber: parsedFilename.volumeNumber,
        year
    } satisfies PtvReadingSeriesItemInfo;
}

function buildFallbackSeriesInfo(
    item: PtvReadingItem,
    parsedFilename: PtvReadingFilenameInfo,
    year: number | null
) {
    const itemIndexNumber = parseNumber(String(item.IndexNumber || ''));
    const title = parsedFilename.cleanTitle || parsedFilename.rawName;
    const itemIdentity = getPtvReadingSeriesItemOverrideKey(item) || title;

    return {
        confidence: itemIndexNumber == null ? 'filename-low' : 'metadata',
        groupKey: `single:${normalizeSeriesKey(itemIdentity) || 'item'}`,
        issueNumber: itemIndexNumber,
        issueText: itemIndexNumber == null ? '' : String(item.IndexNumber),
        seriesTitle: title,
        sortName: title,
        volumeNumber: getItemVolumeNumber(item) ?? parsedFilename.volumeNumber,
        year
    } satisfies PtvReadingSeriesItemInfo;
}

function parseSeriesFromTitle(item: PtvReadingItem): PtvReadingSeriesItemInfo {
    const rawTitle = getBaseReadingTitle(item);
    const parsedFilename = parsePtvReadingFilename(rawTitle);
    const explicitSeriesTitle = getExplicitSeriesTitle(item);
    const explicitSeriesId = getExplicitSeriesId(item);
    const year = parseYear(parsedFilename, item);
    const providerInfo = buildProviderSeriesInfo(
        item,
        parsedFilename,
        explicitSeriesTitle,
        explicitSeriesId,
        year
    );

    if (providerInfo) return providerInfo;

    const explicitInfo = buildExplicitSeriesInfo(
        item,
        parsedFilename,
        explicitSeriesTitle,
        year
    );

    if (explicitInfo) {
        return explicitInfo;
    }

    const patternInfo = buildFilenameSeriesInfo(parsedFilename, year);

    if (patternInfo) {
        return patternInfo;
    }

    return buildFallbackSeriesInfo(item, parsedFilename, year);
}

function normalizeSeriesKey(value: string) {
    return normalizePtvReadingComparisonKey(value).replace(/\s+/g, '-');
}

export function normalizePtvReadingSeriesKey(value: string) {
    return normalizeSeriesKey(value);
}

function hashString(value: string) {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
}

function getMediaKind(routeKind: PtvReadingRouteKind): PtvReadingSeries['mediaKind'] {
    if (routeKind === 'manga') return 'manga';
    if (routeKind === 'comics') return 'comic';

    return 'book-series';
}

function getSeriesId(groupKey: string, routeKind: PtvReadingRouteKind) {
    const key = normalizeSeriesKey(groupKey) || 'series';
    const hashInput = `${routeKind}:${key}`;

    return `${key.slice(0, 64)}-${hashString(hashInput)}`;
}

export function getPtvReadingSeriesIdFromKey(groupKey: string, routeKind: PtvReadingRouteKind) {
    return getSeriesId(groupKey, routeKind);
}

export function getPtvReadingSeriesItemOverrideKey(item: PtvReadingItem) {
    return String(item.Id || item.Path || item.Name || '').trim();
}

function getItemProgressPercent(item: PtvReadingItem) {
    if (item.UserData?.Played) return 100;
    if (typeof item.UserData?.PlayedPercentage === 'number') return item.UserData.PlayedPercentage;
    if (item.RunTimeTicks && item.UserData?.PlaybackPositionTicks) {
        return Math.max(0, Math.min(100, (item.UserData.PlaybackPositionTicks / item.RunTimeTicks) * 100));
    }

    return 0;
}

function compareSeriesItems(left: PtvReadingItem, right: PtvReadingItem, leftInfo: PtvReadingSeriesItemInfo, rightInfo: PtvReadingSeriesItemInfo) {
    const leftVolume = leftInfo.volumeNumber ?? 0;
    const rightVolume = rightInfo.volumeNumber ?? 0;

    if (leftVolume !== rightVolume) return leftVolume - rightVolume;

    const leftIssue = leftInfo.issueNumber ?? Number.POSITIVE_INFINITY;
    const rightIssue = rightInfo.issueNumber ?? Number.POSITIVE_INFINITY;

    if (leftIssue !== rightIssue) return leftIssue - rightIssue;

    return leftInfo.sortName.localeCompare(rightInfo.sortName)
        || String(left.Id || '').localeCompare(String(right.Id || ''));
}

function pickSeriesNextItem(items: PtvReadingItem[]) {
    return items.find(item => {
        const percent = getItemProgressPercent(item);

        return percent > 0 && percent < 99;
    }) || items.find(item => getItemProgressPercent(item) < 99) || items[0];
}

function uniqueItems(items: PtvReadingItem[]) {
    const seenIds = new Set<string>();

    return items.filter(item => {
        const id = String(item.Id || item.Path || item.Name || '').trim();

        if (!id || seenIds.has(id)) return false;

        seenIds.add(id);
        return true;
    });
}

function getOverrideNumber(value: number | null | undefined, fallback: number | null) {
    if (value === null) return null;
    if (typeof value !== 'number') return fallback;

    return Number.isFinite(value) ? value : fallback;
}

function applySeriesOverride(
    item: PtvReadingItem,
    info: PtvReadingSeriesItemInfo,
    override?: PtvReadingSeriesOverride
): PtvReadingSeriesItemInfo {
    if (!override) return info;

    const itemKey = getPtvReadingSeriesItemOverrideKey(item);
    const fallbackTitle = cleanSeriesCandidate(getBaseReadingTitle(item)) || info.seriesTitle;
    const seriesTitle = cleanSeriesCandidate(override.seriesTitle || '') || (override.excluded ? fallbackTitle : info.seriesTitle);
    const year = override.seriesYear === undefined ? info.year : override.seriesYear;
    const issueNumber = getOverrideNumber(override.issueNumber, info.issueNumber);
    const volumeNumber = getOverrideNumber(override.volumeNumber, info.volumeNumber);

    return {
        ...info,
        confidence: 'manual',
        groupKey: override.excluded ? `manual-excluded:${normalizeSeriesKey(itemKey || fallbackTitle) || 'item'}` : getManualGroupKey(seriesTitle, year, override.seriesKey),
        issueNumber,
        issueText: issueNumber == null ? info.issueText : String(issueNumber),
        seriesTitle,
        sortName: info.sortName || fallbackTitle,
        volumeNumber,
        year
    };
}

export function getPtvReadingSeriesInfo(item: PtvReadingItem) {
    return parseSeriesFromTitle(item);
}

export function buildPtvReadingSeries(
    items: PtvReadingItem[],
    routeKind: PtvReadingRouteKind,
    options: PtvReadingSeriesBuildOptions = {}
): PtvReadingSeries[] {
    const grouped = new Map<string, {
        confidence: PtvReadingSeriesItemInfo['confidence'];
        coverItemId: string;
        groupKey: string;
        infos: Map<string, PtvReadingSeriesItemInfo>;
        items: PtvReadingItem[];
        title: string;
        year: number | null;
    }>();

    uniqueItems(items).forEach(item => {
        const itemKey = getPtvReadingSeriesItemOverrideKey(item);
        const info = applySeriesOverride(item, parseSeriesFromTitle(item), options.overrides?.[itemKey]);
        const id = getSeriesId(info.groupKey, routeKind);
        const existing = grouped.get(id) || {
            confidence: info.confidence,
            coverItemId: '',
            groupKey: info.groupKey,
            infos: new Map<string, PtvReadingSeriesItemInfo>(),
            items: [],
            title: info.seriesTitle,
            year: info.year
        };

        existing.items.push(item);
        existing.infos.set(itemKey || String(existing.items.length), info);
        existing.confidence = existing.confidence === 'manual' || info.confidence === 'manual' ? 'manual' : existing.confidence;
        existing.coverItemId = existing.coverItemId || options.overrides?.[itemKey]?.coverItemId || '';
        existing.year = existing.year || info.year;
        grouped.set(id, existing);
    });

    return Array.from(grouped.entries()).map(([id, group]) => {
        const sortedItems = [...group.items].sort((left, right) => (
            compareSeriesItems(
                left,
                right,
                group.infos.get(String(left.Id || left.Path || left.Name || '')) || parseSeriesFromTitle(left),
                group.infos.get(String(right.Id || right.Path || right.Name || '')) || parseSeriesFromTitle(right)
            )
        ));
        const readCount = sortedItems.filter(item => getItemProgressPercent(item) >= 99).length;
        const inProgressCount = sortedItems.filter(item => {
            const percent = getItemProgressPercent(item);

            return percent > 0 && percent < 99;
        }).length;
        const unreadCount = sortedItems.length - readCount;
        const progressPercent = sortedItems.length ? (sortedItems.reduce((total, item) => total + getItemProgressPercent(item), 0) / sortedItems.length) : 0;
        const nextItem = pickSeriesNextItem(sortedItems);
        const coverItem = sortedItems.find(item => getPtvReadingSeriesItemOverrideKey(item) === group.coverItemId) || nextItem || sortedItems[0];

        return {
            completedCount: readCount,
            confidence: group.confidence,
            coverItem,
            id,
            inProgressCount,
            itemCount: sortedItems.length,
            items: sortedItems,
            key: group.groupKey,
            mediaKind: getMediaKind(routeKind),
            nextItem: nextItem || sortedItems[0],
            progressPercent,
            readCount,
            sortTitle: normalizeSeriesKey(group.title),
            title: group.title,
            unreadCount,
            year: group.year
        };
    }).sort((left, right) => left.title.localeCompare(right.title));
}

export function findPtvReadingSeriesById(series: PtvReadingSeries[], seriesId: string) {
    return series.find(entry => entry.id === seriesId) || null;
}
