import type {
    PtvReadingItem,
    PtvReadingRouteKind
} from './booksTypes';

export type PtvReadingSeriesItemInfo = Readonly<{
    confidence: 'explicit' | 'provider' | 'metadata' | 'filename-high' | 'filename-low';
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

function getBaseReadingTitle(item: PtvReadingItem) {
    const pathName = String(item.Path || '').split(/[\\/]/).pop() || '';
    const withoutExtension = pathName.replace(/\.[a-z0-9]{2,5}$/i, '');

    return String(item.Name || item.SortName || withoutExtension || '').trim();
}

function cleanSeriesCandidate(value: string) {
    return String(value || '')
        .replace(/\.[a-z0-9]{2,5}$/i, '')
        .replace(/\[(?:[^[\]]*)\]/g, ' ')
        .replace(/\((?:digital|empire|nahga|lucaz|getcomics|webrip|retail|scan|c2c|minutemen|dcp|hybrid)[^)]*\)/gi, ' ')
        .replace(/\b(?:getcomics|getcomics\.info|readcomiconline|comicextra)\b.*$/i, ' ')
        .replace(/_+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseYear(value: string, item: PtvReadingItem) {
    if (item.ProductionYear) return Number(item.ProductionYear);

    const match = /\b((?:19|20)\d{2})\b/.exec(value);

    return match ? Number(match[1]) : null;
}

function parseNumber(value: string) {
    const number = Number.parseFloat(String(value || '').replace(/^0+(\d)/, '$1'));

    return Number.isFinite(number) ? number : null;
}

function stripTrailingIssueDecorations(value: string) {
    let nextValue = value;
    // eslint-disable-next-line sonarjs/slow-regex -- Bounded title fragment, not untrusted bulk text.
    const yearMatch = /\s+\((?:19|20)\d{2}\)/i.exec(nextValue);
    const dashIndex = nextValue.indexOf(' - ');

    if (yearMatch?.index !== undefined) {
        nextValue = nextValue.slice(0, yearMatch.index);
    }

    if (dashIndex >= 0) {
        nextValue = nextValue.slice(0, dashIndex);
    }

    return nextValue.replace(/\s+/g, ' ')
        .trim();
}

function getExplicitSeriesTitle(item: PtvReadingItem) {
    const explicitValue = String(
        (item as PtvReadingItem & { SeriesName?: string }).SeriesName
        || item.Album
        || item.CollectionName
        || ''
    ).trim();

    return cleanSeriesCandidate(explicitValue);
}

function getExplicitSeriesId(item: PtvReadingItem) {
    return String(
        (item as PtvReadingItem & { SeriesId?: string }).SeriesId
        || item.ProviderIds?.ComicVineSeries
        || item.ProviderIds?.ComicVineVolume
        || item.ProviderIds?.GoogleBooksSeries
        || item.ProviderIds?.OpenLibrarySeries
        || ''
    ).trim();
}

function getGroupingKey(source: string, title: string, year: number | null, explicitId = '') {
    if (explicitId) return `${source}:${normalizeSeriesKey(explicitId)}`;

    const key = normalizeSeriesKey(title) || 'series';
    return `${source}:${key}:${year || 'unknown'}`;
}

function getItemVolumeNumber(item: PtvReadingItem) {
    return parseNumber(String(item.ParentIndexNumber || ''));
}

function buildExplicitSeriesInfo(
    item: PtvReadingItem,
    cleanedTitle: string,
    explicitSeriesTitle: string,
    explicitSeriesId: string,
    year: number | null
) {
    const itemIndexNumber = parseNumber(String(item.IndexNumber || ''));

    if (!explicitSeriesTitle) return null;

    return {
        confidence: explicitSeriesId ? 'provider' : 'explicit',
        groupKey: getGroupingKey('explicit', explicitSeriesTitle, year, explicitSeriesId),
        issueNumber: itemIndexNumber,
        issueText: itemIndexNumber == null ? '' : String(item.IndexNumber),
        seriesTitle: explicitSeriesTitle,
        sortName: cleanedTitle,
        volumeNumber: getItemVolumeNumber(item),
        year
    } satisfies PtvReadingSeriesItemInfo;
}

function findNumberedSeriesTitle(value: string) {
    const patterns = [
        // eslint-disable-next-line sonarjs/slow-regex -- Bounded title fragment, not untrusted bulk text.
        /\s+#\s*(\d+(?:\.\d+)?)(?:\b|$)/i,
        // eslint-disable-next-line sonarjs/slow-regex -- Bounded title fragment, not untrusted bulk text.
        /\s+(?:issue|chapter|ch)\s*(\d+(?:\.\d+)?)(?:\b|$)/i,
        // eslint-disable-next-line sonarjs/slow-regex -- Bounded title fragment, not untrusted bulk text.
        /\s+v(?:ol(?:ume)?)?\.?\s*(\d+(?:\.\d+)?)(?:\b|$)/i,
        // eslint-disable-next-line sonarjs/slow-regex -- Bounded title fragment, not untrusted bulk text.
        /\s+(\d{1,4}(?:\.\d+)?)(?:\s*\((?:19|20)\d{2}\))?$/i
    ];

    for (const pattern of patterns) {
        const match = pattern.exec(value);
        const matchIndex = match?.index ?? -1;
        const issueText = match?.[1] || '';

        if (matchIndex >= 0 && issueText) {
            return {
                issueText,
                seriesTitle: stripTrailingIssueDecorations(value.slice(0, matchIndex))
            };
        }
    }

    return null;
}

function buildPatternSeriesInfo(
    item: PtvReadingItem,
    cleanedTitle: string,
    explicitSeriesId: string,
    year: number | null
) {
    const numberedSeries = findNumberedSeriesTitle(cleanedTitle);
    const issueNumber = parseNumber(numberedSeries?.issueText || '');

    if (!numberedSeries?.seriesTitle || issueNumber == null) return null;

    const source = explicitSeriesId ? 'provider' : 'filename';

    return {
        confidence: explicitSeriesId ? 'provider' : 'filename-high',
        groupKey: getGroupingKey(source, numberedSeries.seriesTitle, year, explicitSeriesId),
        issueNumber,
        issueText: numberedSeries.issueText,
        seriesTitle: numberedSeries.seriesTitle,
        sortName: cleanedTitle,
        volumeNumber: getItemVolumeNumber(item),
        year
    } satisfies PtvReadingSeriesItemInfo;
}

function buildFallbackSeriesInfo(
    item: PtvReadingItem,
    cleanedTitle: string,
    rawTitle: string,
    explicitSeriesId: string,
    year: number | null
) {
    const itemIndexNumber = parseNumber(String(item.IndexNumber || ''));
    let confidence: PtvReadingSeriesItemInfo['confidence'] = 'metadata';
    let source = 'metadata';

    if (explicitSeriesId) {
        confidence = 'provider';
        source = 'provider';
    } else if (itemIndexNumber == null) {
        confidence = 'filename-low';
        source = 'single';
    }

    const title = cleanedTitle || rawTitle;

    return {
        confidence,
        groupKey: getGroupingKey(source, title, year, explicitSeriesId),
        issueNumber: itemIndexNumber,
        issueText: itemIndexNumber == null ? '' : String(item.IndexNumber),
        seriesTitle: title,
        sortName: title,
        volumeNumber: getItemVolumeNumber(item),
        year
    };
}

function parseSeriesFromTitle(item: PtvReadingItem): PtvReadingSeriesItemInfo {
    const rawTitle = getBaseReadingTitle(item);
    const cleanedTitle = cleanSeriesCandidate(rawTitle);
    const explicitSeriesTitle = getExplicitSeriesTitle(item);
    const explicitSeriesId = getExplicitSeriesId(item);
    const year = parseYear(cleanedTitle, item);
    const explicitInfo = buildExplicitSeriesInfo(
        item,
        cleanedTitle,
        explicitSeriesTitle,
        explicitSeriesId,
        year
    );

    if (explicitInfo) {
        return explicitInfo;
    }

    const patternInfo = buildPatternSeriesInfo(item, cleanedTitle, explicitSeriesId, year);

    if (patternInfo) {
        return patternInfo;
    }

    return buildFallbackSeriesInfo(item, cleanedTitle, rawTitle, explicitSeriesId, year);
}

function normalizeSeriesKey(value: string) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        // eslint-disable-next-line sonarjs/slow-regex -- Bounded normalized key fragment.
        .replace(/(?:^-+)|(?:-+$)/g, '');
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

export function getPtvReadingSeriesInfo(item: PtvReadingItem) {
    return parseSeriesFromTitle(item);
}

export function buildPtvReadingSeries(items: PtvReadingItem[], routeKind: PtvReadingRouteKind): PtvReadingSeries[] {
    const grouped = new Map<string, {
        confidence: PtvReadingSeriesItemInfo['confidence'];
        groupKey: string;
        infos: Map<string, PtvReadingSeriesItemInfo>;
        items: PtvReadingItem[];
        title: string;
        year: number | null;
    }>();

    uniqueItems(items).forEach(item => {
        const info = parseSeriesFromTitle(item);
        const id = getSeriesId(info.groupKey, routeKind);
        const existing = grouped.get(id) || {
            confidence: info.confidence,
            groupKey: info.groupKey,
            infos: new Map<string, PtvReadingSeriesItemInfo>(),
            items: [],
            title: info.seriesTitle,
            year: info.year
        };

        existing.items.push(item);
        existing.infos.set(String(item.Id || item.Path || item.Name || existing.items.length), info);
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

        return {
            completedCount: readCount,
            confidence: group.confidence,
            coverItem: nextItem || sortedItems[0],
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
