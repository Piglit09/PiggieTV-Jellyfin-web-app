import type {
    PtvReadingCacheDiagnostic,
    PtvReadingLibraryDebug
} from './booksTypes';

const DEFAULT_DIAGNOSTIC_LENGTH = 480;
const MAX_DIAGNOSTIC_ENTRIES = 8;
const SENSITIVE_QUERY_PARAM = /^(?:api[-_]?key|apikey|access[-_]?token|authorization|password|token|x-emby-token)$/i;
const IDENTIFIER_QUERY_PARAM = /^(?:ids?|itemid|parentid|userid)$/i;

export type ReadingDiagnosticRow = Readonly<{
    label: string;
    value: string;
}>;

export type ReadingDiagnosticSection = Readonly<{
    id: string;
    rows: ReadingDiagnosticRow[];
    title: string;
}>;

type ReadingSeriesDiagnosticSummary = Readonly<{
    groupedSeriesCount: number;
    manualSeriesCount: number;
    overrideCount: number;
    overrideItemIds: string[];
}>;

type ReadingRuntimeDiagnosticSummary = Readonly<{
    alternateImageUsed: number;
    cachedFailureHit: number;
    failedCoverUrls: string[];
    fallbackPosterRendered: number;
    missingPrimaryImage: number;
}>;

type BuildReadingDiagnosticSectionsOptions = Readonly<{
    cacheDiagnostics?: PtvReadingCacheDiagnostic;
    debug: PtvReadingLibraryDebug;
    runtime: ReadingRuntimeDiagnosticSummary;
    seriesDiagnostics?: ReadingSeriesDiagnosticSummary;
}>;

function truncateDiagnosticText(value: string, maxLength = DEFAULT_DIAGNOSTIC_LENGTH) {
    if (value.length <= maxLength) return value;

    return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function getCompactIdentifier(value: string) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) return 'none';

    return normalizedValue.length <= 8 ? '[id]' : `[id:...${normalizedValue.slice(-6)}]`;
}

export function canShowReadingDiagnostics(isAdmin: boolean, debugEnabled: boolean) {
    return isAdmin && debugEnabled;
}

export function redactReadingDiagnosticUrl(value: string) {
    const source = String(value || '').trim();
    const schemeIndex = source.indexOf('://');
    if (schemeIndex < 1) return value;

    const pathIndex = source.indexOf('/', schemeIndex + 3);
    const pathAndQuery = pathIndex >= 0 ? source.slice(pathIndex) : '/';
    const fragmentIndex = pathAndQuery.indexOf('#');
    const withoutFragment = fragmentIndex >= 0 ? pathAndQuery.slice(0, fragmentIndex) : pathAndQuery;
    const queryIndex = withoutFragment.indexOf('?');
    const rawPathname = queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment;
    const rawQuery = queryIndex >= 0 ? withoutFragment.slice(queryIndex + 1) : '';
    const pathname = rawPathname
        .replace(/\/Users\/[^/]+/gi, '/Users/[redacted]')
        .replace(/\/Items\/[a-f\d-]{12,}/gi, '/Items/[redacted]');
    const queryEntries = rawQuery.split('&').filter(Boolean).map(entry => {
        const separatorIndex = entry.indexOf('=');
        const rawKey = separatorIndex >= 0 ? entry.slice(0, separatorIndex) : entry;
        const rawEntryValue = separatorIndex >= 0 ? entry.slice(separatorIndex + 1) : '';
        let key = rawKey;
        let entryValue = rawEntryValue;

        try {
            key = decodeURIComponent(rawKey.split('+').join(' '));
            entryValue = decodeURIComponent(rawEntryValue.split('+').join(' '));
        } catch {
            // Keep malformed values encoded and redact them using their raw key.
        }

        let safeValue = truncateDiagnosticText(entryValue, 80);
        if (SENSITIVE_QUERY_PARAM.test(key)) {
            safeValue = '[redacted]';
        } else if (IDENTIFIER_QUERY_PARAM.test(key)) {
            safeValue = getCompactIdentifier(entryValue);
        }

        return `${encodeURIComponent(key)}=${encodeURIComponent(safeValue)}`;
    });
    const search = queryEntries.join('&');
    const querySuffix = search ? `?${search}` : '';

    return `[server]${pathname}${querySuffix}`;
}

export function formatReadingDiagnosticValue(value: unknown, maxLength = DEFAULT_DIAGNOSTIC_LENGTH) {
    let formattedValue: string;

    if (value === null || value === undefined || value === '') {
        formattedValue = 'none';
    } else if (typeof value === 'string') {
        formattedValue = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
        formattedValue = String(value);
    } else {
        try {
            formattedValue = JSON.stringify(value);
        } catch {
            formattedValue = '[unavailable]';
        }
    }

    formattedValue = formattedValue
        .replace(/https?:\/\/[^\s|]+/gi, match => redactReadingDiagnosticUrl(match))
        .replace(/(?:[A-Za-z]:\\|\\\\)[^|\n]+/g, '[local path]')
        .replace(/\/(?:home|Users|mnt|var\/lib)\/[^|\n]+/g, '[local path]')
        .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s"',;|]+/gi, '$1[redacted]')
        .replace(/((?:api[-_ ]?key|access[-_ ]?token|password|token|x-emby-token)\s*[:=]\s*)[^\s"',;|&]+/gi, '$1[redacted]')
        .replace(/bearer\s+[^\s"',;|]+/gi, 'Bearer [redacted]');

    return truncateDiagnosticText(formattedValue, maxLength);
}

function formatEntries(values: string[], formatter: (value: string) => string = formatReadingDiagnosticValue) {
    if (!values.length) return 'none';

    const visibleValues = values.slice(0, MAX_DIAGNOSTIC_ENTRIES).map(formatter);
    const hiddenCount = values.length - visibleValues.length;

    const hiddenSummary = hiddenCount > 0 ? ` | +${hiddenCount} more` : '';

    return `${visibleValues.join(' | ')}${hiddenSummary}`;
}

function row(label: string, value: unknown, maxLength?: number): ReadingDiagnosticRow {
    return {
        label,
        value: formatReadingDiagnosticValue(value, maxLength)
    };
}

export function buildReadingDiagnosticSections({
    cacheDiagnostics,
    debug,
    runtime,
    seriesDiagnostics
}: BuildReadingDiagnosticSectionsOptions): ReadingDiagnosticSection[] {
    const libraryRows = debug.libraryDiagnostics.slice(0, MAX_DIAGNOSTIC_ENTRIES).map(entry => row(
        entry.name || 'Unnamed library',
        [
            getCompactIdentifier(entry.id),
            `kind=${entry.kind}`,
            `collection=${entry.collectionType || 'unknown'}`,
            `items=${entry.itemCount}`,
            `status=${entry.statusCode ?? 'n/a'}`,
            `duration=${entry.requestDurationMs ?? 'n/a'}ms`,
            `endpoint=${entry.lastQueriedUrl ? redactReadingDiagnosticUrl(entry.lastQueriedUrl) : 'none'}`,
            `timeout=${entry.timeoutReason || 'none'}`
        ].join(' ')
    ));
    const sectionRows = debug.sectionDiagnostics.slice(0, MAX_DIAGNOSTIC_ENTRIES).map(entry => row(
        entry.title || entry.id,
        [
            `status=${entry.status}`,
            `items=${entry.itemCount}`,
            `duration=${entry.requestDurationMs ?? 'n/a'}ms`,
            `source=${entry.source || 'unknown'}`,
            `endpoint=${entry.lastQueriedUrl ? redactReadingDiagnosticUrl(entry.lastQueriedUrl) : 'none'}`,
            `timeout=${entry.timeoutReason || 'none'}`
        ].join(' ')
    ));

    if (debug.libraryDiagnostics.length > libraryRows.length) {
        libraryRows.push(row('Additional libraries', `${debug.libraryDiagnostics.length - libraryRows.length} hidden`));
    }

    if (debug.sectionDiagnostics.length > sectionRows.length) {
        sectionRows.push(row('Additional shelves', `${debug.sectionDiagnostics.length - sectionRows.length} hidden`));
    }

    return [
        {
            id: 'request',
            title: 'Request summary',
            rows: [
                row('Route', debug.routeKind),
                row('Libraries', formatEntries(debug.readingLibraryNames)),
                row('Library identifiers', formatEntries(debug.selectedReadingLibraryIds, getCompactIdentifier)),
                row('Jellyfin total', debug.jellyfinItemTotal),
                row('Route total', debug.jellyfinRouteItemTotal),
                row('Fetched items', debug.fetchedItemCount),
                row('Index progress', `${debug.indexAccumulatedCount} / ${debug.totalRecordCountFromApi}`),
                row('Index stage / final', `${debug.indexStage} / ${debug.indexIsComplete}`),
                row('API record count', debug.totalRecordCountFromApi),
                row('Page size / pages', `${debug.pageSize} / ${debug.pageCount} of ${debug.indexTotalPageCount}`),
                row('Duration', debug.requestDurationMs === null ? 'n/a' : `${debug.requestDurationMs}ms`),
                row('Status', debug.statusCode ?? 'n/a'),
                row('Timeout', debug.timeoutReason || 'none'),
                row('Last endpoint', debug.lastReadingQueryUrl ? redactReadingDiagnosticUrl(debug.lastReadingQueryUrl) : 'none')
            ]
        },
        {
            id: 'cache',
            title: 'Reading cache',
            rows: [
                row('Status / source', `${cacheDiagnostics?.status || 'none'} / ${cacheDiagnostics?.source || 'none'}`),
                row('Age / fresh', `${cacheDiagnostics?.cacheAgeMs ?? 'n/a'}ms / ${cacheDiagnostics?.cacheFresh ?? 'n/a'}`),
                row('Stale hit', cacheDiagnostics?.staleHit ?? 'n/a'),
                row('Refresh duration', `${cacheDiagnostics?.refreshDurationMs ?? 'n/a'}ms`),
                row('Background refresh', `${cacheDiagnostics?.backgroundRefreshStarted ?? 'n/a'} / ${cacheDiagnostics?.backgroundRefreshCompleted ?? 'n/a'} / ${cacheDiagnostics?.backgroundRefreshDurationMs ?? 'n/a'}ms`),
                row('Fresh cache / render', `${cacheDiagnostics?.freshCacheWritten ?? 'n/a'} / ${cacheDiagnostics?.freshRenderApplied ?? 'n/a'}`),
                row('Payload / items', `${cacheDiagnostics?.payloadSize ?? 0} bytes / ${cacheDiagnostics?.itemCount ?? 0}`),
                row('Refresh error', cacheDiagnostics?.refreshError || 'none')
            ]
        },
        {
            id: 'images',
            title: 'Artwork',
            rows: [
                row('Failed covers', runtime.failedCoverUrls.length),
                row('Recent failures', formatEntries(runtime.failedCoverUrls.map(redactReadingDiagnosticUrl))),
                row('Alternate image used', runtime.alternateImageUsed),
                row('Fallback poster rendered', runtime.fallbackPosterRendered),
                row('Missing primary image', runtime.missingPrimaryImage),
                row('Cached failure hit', runtime.cachedFailureHit)
            ]
        },
        {
            id: 'series',
            title: 'Series grouping',
            rows: [
                row('Grouped series', seriesDiagnostics?.groupedSeriesCount ?? 'n/a'),
                row('Manual series', seriesDiagnostics?.manualSeriesCount ?? 'n/a'),
                row('Overrides', seriesDiagnostics?.overrideCount ?? 'n/a'),
                row('Override items', formatEntries(seriesDiagnostics?.overrideItemIds || [], getCompactIdentifier)),
                row(
                    debug.routeKind === 'reading' ? 'Shelf sample counts by kind' : 'Indexed counts by kind',
                    Object.entries(debug.kindCounts).map(([kind, count]) => `${kind}=${count}`).join(' | ')
                ),
                row('Dropped items', debug.droppedItemCount),
                row('Drop reasons', formatEntries(debug.dropReasons))
            ]
        },
        {
            id: 'libraries',
            title: 'Libraries',
            rows: libraryRows.length ? libraryRows : [row('Status', 'No library diagnostics')]
        },
        {
            id: 'shelves',
            title: 'Shelves',
            rows: sectionRows.length ? sectionRows : [row('Status', 'No shelf diagnostics')]
        }
    ];
}
