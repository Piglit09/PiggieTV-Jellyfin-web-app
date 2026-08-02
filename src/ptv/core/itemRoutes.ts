import { PTV_ROUTES } from './config';
import {
    recordPtvEvent,
    shouldCollectDiagnostics
} from './observability';

export type PtvItemRouteSource = 'jellyfin-fallback' | 'ptv-collections' | 'ptv-music' | 'ptv-reading' | 'ptv-video';

export type PtvItemRouteResult = {
    fallbackReason: string;
    href: string;
    routeSource: PtvItemRouteSource;
};

export type PtvItemRouteContext = {
    enablePtvMusic?: boolean;
    enablePtvReading?: boolean;
    fallbackHref?: string;
    mediaType?: string;
    privacySafeDiagnostics?: boolean;
    source?: string;
};

type PtvRouteItem = Record<string, unknown> | null | undefined;

const READING_CONTAINERS = new Set(['cb7', 'cbr', 'cbt', 'cbz', 'epub', 'pdf']);
const COMIC_CONTAINERS = new Set(['cb7', 'cbr', 'cbt', 'cbz']);

function getRecordString(item: PtvRouteItem, ...keys: string[]) {
    if (!item) return '';

    for (const key of keys) {
        const value = item[key];

        if (typeof value === 'string' && value.trim()) return value.trim();
    }

    return '';
}

function getItemId(item: PtvRouteItem) {
    return getRecordString(item, 'Id', 'id');
}

function getItemServerId(item: PtvRouteItem) {
    return getRecordString(item, 'ServerId', 'serverId');
}

function getNormalizedItemText(item: PtvRouteItem, context: PtvItemRouteContext) {
    return [
        context.mediaType,
        getRecordString(item, 'PtvReadingLibraryKindHint', 'ptvReadingLibraryKindHint'),
        getRecordString(item, 'PtvReadingLibraryName', 'ptvReadingLibraryName'),
        getRecordString(item, 'CollectionType', 'collectionType'),
        getRecordString(item, 'Type', 'type'),
        getRecordString(item, 'MediaType', 'mediaType'),
        getRecordString(item, 'Name', 'name', 'Title', 'title'),
        getRecordString(item, 'Path', 'path')
    ].filter(Boolean).join(' ').toLowerCase();
}

function getItemContainer(item: PtvRouteItem) {
    const mediaSources = item?.MediaSources || item?.mediaSources;
    const mediaSourceContainer = Array.isArray(mediaSources) ?
        getRecordString(mediaSources[0] as PtvRouteItem, 'Container', 'container') :
        '';
    const container = getRecordString(item, 'Container', 'container') || mediaSourceContainer;
    const path = getRecordString(item, 'Path', 'path');
    const pathExtension = path.includes('.') ? path.split('.').pop() || '' : '';

    return (container || pathExtension).toLowerCase().replace(/^\./, '');
}

function getJellyfinDetailsHref(item: PtvRouteItem, fallbackHref = PTV_ROUTES.home) {
    const itemId = getItemId(item);

    if (!itemId) return fallbackHref;

    const serverId = getItemServerId(item);
    const serverParam = serverId ? `&serverId=${encodeURIComponent(serverId)}` : '';

    return `#/details?id=${encodeURIComponent(itemId)}${serverParam}`;
}

function isAudioItem(item: PtvRouteItem, context: PtvItemRouteContext) {
    const type = getRecordString(item, 'Type', 'type').toLowerCase();
    const mediaType = getRecordString(item, 'MediaType', 'mediaType').toLowerCase();
    const contextMediaType = (context.mediaType || '').toLowerCase();

    return type === 'audio'
        || mediaType === 'audio'
        || contextMediaType === 'music';
}

function isMusicAlbum(item: PtvRouteItem) {
    return getRecordString(item, 'Type', 'type').toLowerCase() === 'musicalbum';
}

function isMusicArtist(item: PtvRouteItem, context: PtvItemRouteContext) {
    const type = getRecordString(item, 'Type', 'type').toLowerCase();

    return type === 'musicartist'
        || (type === 'artist' && (context.mediaType || '').toLowerCase() === 'music');
}

function isMusicPlaylist(item: PtvRouteItem) {
    return getRecordString(item, 'Type', 'type').toLowerCase() === 'playlist';
}

function getReadingRouteBase(item: PtvRouteItem, context: PtvItemRouteContext) {
    const text = getNormalizedItemText(item, context);
    const container = getItemContainer(item);

    if (text.includes('manga') || text.includes('manhwa') || text.includes('manhua')) return 'manga';
    if (text.includes('comic') || COMIC_CONTAINERS.has(container)) return 'comics';

    return 'books';
}

function isReadingItem(item: PtvRouteItem, context: PtvItemRouteContext) {
    const type = getRecordString(item, 'Type', 'type').toLowerCase();
    const mediaType = getRecordString(item, 'MediaType', 'mediaType').toLowerCase();
    const contextMediaType = (context.mediaType || '').toLowerCase();
    const collectionType = getRecordString(item, 'CollectionType', 'collectionType').toLowerCase();
    const container = getItemContainer(item);

    return type === 'book'
        || mediaType === 'book'
        || collectionType === 'books'
        || ['audiobook', 'book', 'comic', 'manga'].includes(contextMediaType)
        || READING_CONTAINERS.has(container);
}

function makeRouteResult(
    href: string,
    routeSource: PtvItemRouteSource,
    fallbackReason = ''
): PtvItemRouteResult {
    return {
        fallbackReason,
        href,
        routeSource
    };
}

function getPtvMusicHref(item: PtvRouteItem, itemId: string, context: PtvItemRouteContext) {
    if (isMusicAlbum(item)) return `#/music/album/${encodeURIComponent(itemId)}`;
    if (isMusicArtist(item, context)) return `#/music/artist/${encodeURIComponent(itemId)}`;
    if (isMusicPlaylist(item)) return `#/music/playlist/${encodeURIComponent(itemId)}`;
    if (isAudioItem(item, context)) return `#/music/item/${encodeURIComponent(itemId)}`;

    return '';
}

export function resolvePtvItemRoute(
    item: PtvRouteItem,
    context: PtvItemRouteContext = {}
): PtvItemRouteResult {
    const itemId = getItemId(item);
    const fallbackHref = context.fallbackHref || getJellyfinDetailsHref(item, PTV_ROUTES.home);

    if (!itemId) {
        return makeRouteResult(fallbackHref, 'jellyfin-fallback', 'missing-item-id');
    }

    if (getRecordString(item, 'Type', 'type').toLocaleLowerCase('en-US') === 'boxset') {
        return makeRouteResult(
            '#/collections?view=details&collectionId=' + encodeURIComponent('jellyfin:' + itemId),
            'ptv-collections'
        );
    }

    const musicHref = getPtvMusicHref(item, itemId, context);

    if (musicHref) {
        if (context.enablePtvMusic === false) return makeRouteResult(fallbackHref, 'jellyfin-fallback', 'ptv-music-disabled');

        return makeRouteResult(musicHref, 'ptv-music');
    }

    if (isReadingItem(item, context)) {
        if (context.enablePtvReading === false) return makeRouteResult(fallbackHref, 'jellyfin-fallback', 'ptv-reading-disabled');

        return makeRouteResult(
            `#/${getReadingRouteBase(item, context)}/item/${encodeURIComponent(itemId)}`,
            'ptv-reading'
        );
    }

    return makeRouteResult(fallbackHref, 'jellyfin-fallback', 'no-ptv-native-route');
}

export function recordPtvItemRouteClick(
    item: PtvRouteItem,
    route: PtvItemRouteResult,
    context: PtvItemRouteContext & {
        action?: string;
        rowId?: string;
        rowTitle?: string;
    } = {}
) {
    if (!shouldCollectDiagnostics()) return;

    const safeDetail = {
        action: context.action || 'open',
        fallbackReason: route.fallbackReason || null,
        hasItemId: Boolean(getItemId(item)),
        itemType: getRecordString(item, 'Type', 'type') || null,
        mediaType: getRecordString(item, 'MediaType', 'mediaType') || context.mediaType || null,
        routeSource: route.routeSource,
        source: context.source || null
    };

    recordPtvEvent('route', 'ptv-item-route-click', context.privacySafeDiagnostics ? safeDetail : {
        ...safeDetail,
        itemId: getItemId(item) || null,
        itemName: getRecordString(item, 'Name', 'name', 'Title', 'title') || null,
        resolvedRoute: route.href,
        rowId: context.rowId || null,
        rowTitle: context.rowTitle || null
    });
}
