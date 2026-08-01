import { getPtvDisplayIdentityKey } from '../../services/displayIdentity';
import {
    readPtvLocalStorageJson,
    removePtvLocalStorageKey,
    writePtvLocalStorageJson
} from '../../services/runtimeStability';

import type {
    PtvMusicItem,
    PtvMusicQueueSnapshot
} from './musicTypes';

export const PTV_MUSIC_CONTINUITY_VERSION = 1;
export const PTV_MUSIC_CONTINUITY_QUEUE_LIMIT = 80;
export const PTV_MUSIC_CONTINUITY_RECENT_LIMIT = 24;
export const PTV_MUSIC_CONTINUITY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const PTV_MUSIC_CONTINUITY_MAX_BYTES = 72_000;

const PTV_MUSIC_CONTINUITY_STORAGE_PREFIX = 'ptv.music.continuity.v1';
const PTV_MUSIC_CONTINUITY_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const PTV_MUSIC_CONTINUITY_DEFAULT_ROUTE = '#/music';
const PTV_MUSIC_TICKS_PER_SECOND = 10_000_000;
const PTV_MUSIC_MINIMUM_LISTEN_SECONDS = 5;
const PTV_MUSIC_STANDARD_LISTEN_SECONDS = 30;
const PTV_MUSIC_LISTEN_FRACTION = 0.1;
const PTV_MUSIC_CONTINUITY_COLLECTION_VIEWS = new Set([
    'albums',
    'artists',
    'explore',
    'genres',
    'history',
    'library',
    'liked',
    'player',
    'playlists',
    'songs'
]);
const PTV_MUSIC_CONTINUITY_DETAIL_VIEWS = new Set([
    'album',
    'artist',
    'item',
    'playlist'
]);
const INVALID_STORAGE_VALUE = Object.freeze({
    invalidPtvMusicContinuityStorageValue: true
});

export type PtvMusicContinuityScope = Readonly<{
    serverId: unknown;
    userId: unknown;
}>;

export type PtvMusicContinuityPlayerTab = 'Lyrics' | 'Related' | 'Up Next';

export type PtvMusicContinuityItem = Readonly<{
    Album?: string;
    AlbumArtist?: string;
    AlbumId?: string;
    AlbumPrimaryImageItemId?: string;
    AlbumPrimaryImageTag?: string;
    Artist?: string;
    ArtistItems?: Array<{
        Id?: string;
        Name?: string;
    }>;
    Artists?: string[];
    Id: string;
    ImageTags?: Readonly<{
        Primary?: string;
    }>;
    IndexNumber?: number;
    MediaType: 'Audio';
    Name?: string;
    ParentIndexNumber?: number;
    RunTimeTicks?: number;
    Type: 'Audio';
}>;

export type PtvMusicContinuityQueueKind =
    | 'album'
    | 'artist'
    | 'genre'
    | 'mix'
    | 'playlist'
    | 'search'
    | 'track'
    | 'unknown';

export type PtvMusicContinuityQueueDescriptor = Readonly<{
    kind?: PtvMusicContinuityQueueKind;
    source?: string;
    sourceId?: string;
}>;

export type PtvMusicContinuityQueue = Readonly<{
    capturedAt: number;
    context: Readonly<{
        kind: PtvMusicContinuityQueueKind;
        source?: string;
        sourceId?: string;
    }>;
    currentIndex: number;
    currentItemId: string;
    items: readonly PtvMusicContinuityItem[];
    positionTicks: number;
    repeatMode: 'RepeatAll' | 'RepeatNone' | 'RepeatOne';
    runtimeTicks: number;
    shuffled: boolean;
}>;

export type PtvMusicContinuityRecentTrack = Readonly<{
    completed: boolean;
    item: PtvMusicContinuityItem;
    lastPlayedAt: number;
    positionTicks: number;
    runtimeTicks: number;
}>;

export type PtvMusicContinuityDocument = Readonly<{
    lastPlayerTab: PtvMusicContinuityPlayerTab;
    lastRoute: string;
    queue: PtvMusicContinuityQueue | null;
    recentTracks: readonly PtvMusicContinuityRecentTrack[];
    scopeKey: string;
    updatedAt: number;
    version: typeof PTV_MUSIC_CONTINUITY_VERSION;
}>;

export type PtvMusicContinuityInspectionStatus =
    | 'invalid'
    | 'missing'
    | 'scope-unavailable'
    | 'stale'
    | 'valid'
    | 'wrong-scope';

export type PtvMusicContinuityInspection = Readonly<{
    document: PtvMusicContinuityDocument | null;
    status: PtvMusicContinuityInspectionStatus;
}>;

export type PtvMusicContinuityChangeReason =
    | 'clear'
    | 'external'
    | 'initial'
    | 'queue'
    | 'recent-track'
    | 'route'
    | 'tab'
    | 'update';

export type PtvMusicContinuityChange = Readonly<{
    external: boolean;
    reason: PtvMusicContinuityChangeReason;
    scopeKey: string;
}>;

export type PtvMusicContinuityListener = (
    document: PtvMusicContinuityDocument | null,
    change: PtvMusicContinuityChange
) => void;

export type PtvMusicRecentTrackProgress = Readonly<{
    completed?: boolean;
    playedAt?: number;
    positionTicks?: number;
    runtimeTicks?: number;
}>;

export type PtvMusicContinuityQueueInput = Pick<
    PtvMusicQueueSnapshot,
    'currentIndex' | 'isShuffled' | 'playlist' | 'positionTicks' | 'repeatMode' | 'runtimeTicks'
> & Partial<Pick<PtvMusicQueueSnapshot, 'queueSourceLabel'>>;

type PtvMusicContinuityPatch = Partial<Pick<
    PtvMusicContinuityDocument,
    'lastPlayerTab' | 'lastRoute' | 'queue' | 'recentTracks'
>>;

type PtvMusicContinuityQueueBuildInput = Readonly<{
    capturedAt: number;
    currentIndexValue: unknown;
    descriptorValue: unknown;
    itemsValue: unknown;
    positionTicksValue: unknown;
    repeatModeValue: unknown;
    runtimeTicksValue: unknown;
    shuffledValue: unknown;
}>;

type PtvMusicContinuitySubscription = Readonly<{
    key: string;
    listener: PtvMusicContinuityListener;
    scope: PtvMusicContinuityScope;
    scopeKey: string;
}>;

const continuitySubscriptions = new Set<PtvMusicContinuitySubscription>();
let isStorageListenerAttached = false;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNow(value: number) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : Date.now();
}

function normalizeText(value: unknown, maxLength: number) {
    if (typeof value !== 'string') return '';

    const normalized = Array.from(value, character => {
        const code = character.charCodeAt(0);

        return code <= 31 || code === 127 ? ' ' : character;
    }).join('');

    return normalized
        .trim()
        .slice(0, maxLength);
}

function normalizeIdentifier(value: unknown, maxLength = 180) {
    const identifier = normalizeText(value, maxLength);

    if (!identifier
        || /^(?:[a-z][a-z0-9+.-]*:|[\\/]{2}|[a-z]:[\\/])/i.test(identifier)
        || /[\\/?#]/.test(identifier)
    ) {
        return '';
    }

    return identifier;
}

function normalizeNonNegativeInteger(value: unknown, fallback = 0) {
    const number = Number(value);

    if (!Number.isFinite(number) || number < 0) return fallback;

    return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(number));
}

function normalizeTimestamp(value: unknown, now: number) {
    const timestamp = normalizeNonNegativeInteger(value, 0);

    if (!timestamp || timestamp > now + PTV_MUSIC_CONTINUITY_FUTURE_TOLERANCE_MS) return 0;

    return timestamp;
}

function hashScopeIdentity(identity: string) {
    let left = 0x811c9dc5;
    let right = 0x9e3779b9;

    for (let index = 0; index < identity.length; index += 1) {
        const code = identity.charCodeAt(index);

        left = Math.imul(left ^ code, 0x01000193);
        right = Math.imul(right ^ code, 0x85ebca6b);
    }

    return `${(left >>> 0).toString(36)}${(right >>> 0).toString(36)}`;
}

export function getPtvMusicContinuityScopeKey(scope: PtvMusicContinuityScope) {
    const identity = getPtvDisplayIdentityKey(scope.serverId, scope.userId);

    return identity ? hashScopeIdentity(identity) : null;
}

export function getPtvMusicContinuityStorageKey(scope: PtvMusicContinuityScope) {
    const scopeKey = getPtvMusicContinuityScopeKey(scope);

    return scopeKey ? `${PTV_MUSIC_CONTINUITY_STORAGE_PREFIX}:${scopeKey}` : null;
}

function normalizeArtistItems(value: unknown) {
    if (!Array.isArray(value)) return undefined;

    const artists = value
        .reduce<Array<{ Id?: string; Name?: string }>>((items, candidate) => {
            if (!isRecord(candidate) || items.length >= 4) return items;

            const id = normalizeIdentifier(candidate.Id);
            const name = normalizeText(candidate.Name, 120);

            if (id || name) {
                items.push({
                    Id: id || undefined,
                    Name: name || undefined
                });
            }

            return items;
        }, []);

    return artists.length ? artists : undefined;
}

function normalizeArtists(value: unknown) {
    if (!Array.isArray(value)) return undefined;

    const artists = value
        .map(candidate => normalizeText(candidate, 120))
        .filter(Boolean)
        .slice(0, 4);

    return artists.length ? artists : undefined;
}

function normalizePrimaryImageTags(value: unknown) {
    if (!isRecord(value)) return undefined;

    const primary = normalizeIdentifier(value.Primary);

    return primary ? { Primary: primary } : undefined;
}

export function compactPtvMusicContinuityItem(value: unknown): PtvMusicContinuityItem | null {
    if (!isRecord(value)) return null;

    const id = normalizeIdentifier(value.Id, 256);
    const type = normalizeText(value.Type, 32);
    const mediaType = normalizeText(value.MediaType, 32);
    const isAudioType = type.toLowerCase() === 'audio';
    const isAudioMediaType = mediaType.toLowerCase() === 'audio';

    if (!id
        || (!isAudioType && !isAudioMediaType)
        || (type && !isAudioType)
        || (mediaType && !isAudioMediaType)
    ) {
        return null;
    }

    const album = normalizeText(value.Album, 140);
    const albumArtist = normalizeText(value.AlbumArtist, 140);
    const albumId = normalizeIdentifier(value.AlbumId);
    const albumPrimaryImageItemId = normalizeIdentifier(value.AlbumPrimaryImageItemId);
    const albumPrimaryImageTag = normalizeIdentifier(value.AlbumPrimaryImageTag);
    const artist = normalizeText(value.Artist, 140);
    const name = normalizeText(value.Name, 180);
    const runTimeTicks = normalizeNonNegativeInteger(value.RunTimeTicks);

    return {
        Album: album || undefined,
        AlbumArtist: albumArtist || undefined,
        AlbumId: albumId || undefined,
        AlbumPrimaryImageItemId: albumPrimaryImageItemId || undefined,
        AlbumPrimaryImageTag: albumPrimaryImageTag || undefined,
        Artist: artist || undefined,
        ArtistItems: normalizeArtistItems(value.ArtistItems),
        Artists: normalizeArtists(value.Artists),
        Id: id,
        ImageTags: normalizePrimaryImageTags(value.ImageTags),
        IndexNumber: value.IndexNumber === undefined ?
            undefined :
            normalizeNonNegativeInteger(value.IndexNumber),
        MediaType: 'Audio',
        Name: name || undefined,
        ParentIndexNumber: value.ParentIndexNumber === undefined ?
            undefined :
            normalizeNonNegativeInteger(value.ParentIndexNumber),
        RunTimeTicks: runTimeTicks || undefined,
        Type: 'Audio'
    };
}

function normalizeQueueKind(value: unknown): PtvMusicContinuityQueueKind {
    switch (value) {
        case 'album':
        case 'artist':
        case 'genre':
        case 'mix':
        case 'playlist':
        case 'search':
        case 'track':
            return value;
        default:
            return 'unknown';
    }
}

function normalizeQueueDescriptor(value: unknown) {
    const descriptor = isRecord(value) ? value : {};
    const source = normalizeIdentifier(descriptor.source, 80);
    const sourceId = normalizeIdentifier(descriptor.sourceId, 180);

    return {
        kind: normalizeQueueKind(descriptor.kind),
        source: source || undefined,
        sourceId: sourceId || undefined
    };
}

function normalizeRepeatMode(value: unknown): PtvMusicContinuityQueue['repeatMode'] {
    switch (value) {
        case 'RepeatAll':
        case 'RepeatOne':
            return value;
        default:
            return 'RepeatNone';
    }
}

function buildQueueSnapshot({
    capturedAt,
    currentIndexValue,
    descriptorValue,
    itemsValue,
    positionTicksValue,
    repeatModeValue,
    runtimeTicksValue,
    shuffledValue
}: PtvMusicContinuityQueueBuildInput): PtvMusicContinuityQueue | null {
    if (!Array.isArray(itemsValue)) return null;

    const requestedIndex = Math.min(
        Math.max(0, normalizeNonNegativeInteger(currentIndexValue)),
        Math.max(0, itemsValue.length - 1)
    );
    const compactEntries = itemsValue.reduce<Array<{
        item: PtvMusicContinuityItem;
        sourceIndex: number;
    }>>((entries, value, sourceIndex) => {
        const item = compactPtvMusicContinuityItem(value);

        if (item) entries.push({ item, sourceIndex });

        return entries;
    }, []);

    if (!compactEntries.length) return null;

    let compactCurrentIndex = compactEntries.findIndex(entry => entry.sourceIndex === requestedIndex);

    if (compactCurrentIndex < 0) {
        compactCurrentIndex = compactEntries.findIndex(entry => entry.sourceIndex > requestedIndex);
    }
    if (compactCurrentIndex < 0) compactCurrentIndex = compactEntries.length - 1;

    const windowStart = Math.max(0, Math.min(
        compactCurrentIndex - Math.floor(PTV_MUSIC_CONTINUITY_QUEUE_LIMIT / 2),
        compactEntries.length - PTV_MUSIC_CONTINUITY_QUEUE_LIMIT
    ));
    const windowEntries = compactEntries.slice(
        windowStart,
        windowStart + PTV_MUSIC_CONTINUITY_QUEUE_LIMIT
    );
    const currentIndex = compactCurrentIndex - windowStart;
    const currentItem = windowEntries[currentIndex]?.item || windowEntries[0].item;
    const runtimeTicks = normalizeNonNegativeInteger(runtimeTicksValue, currentItem.RunTimeTicks || 0);
    const positionTicks = Math.min(
        normalizeNonNegativeInteger(positionTicksValue),
        runtimeTicks || Number.MAX_SAFE_INTEGER
    );

    return {
        capturedAt,
        context: normalizeQueueDescriptor(descriptorValue),
        currentIndex,
        currentItemId: currentItem.Id,
        items: windowEntries.map(entry => entry.item),
        positionTicks,
        repeatMode: normalizeRepeatMode(repeatModeValue),
        runtimeTicks,
        shuffled: shuffledValue === true
    };
}

function normalizeStoredQueue(value: unknown, documentUpdatedAt: number, now: number) {
    if (value === null || value === undefined) return null;
    if (!isRecord(value)) return null;

    const storedCapturedAt = normalizeTimestamp(value.capturedAt, now);

    if ((value.capturedAt !== undefined && !storedCapturedAt)
        || (storedCapturedAt
        && now - storedCapturedAt > PTV_MUSIC_CONTINUITY_MAX_AGE_MS
        )
    ) {
        return null;
    }

    const capturedAt = storedCapturedAt || documentUpdatedAt;

    return buildQueueSnapshot({
        capturedAt,
        currentIndexValue: value.currentIndex,
        descriptorValue: value.context,
        itemsValue: value.items,
        positionTicksValue: value.positionTicks,
        repeatModeValue: value.repeatMode,
        runtimeTicksValue: value.runtimeTicks,
        shuffledValue: value.shuffled
    });
}

function trimPtvMusicContinuityQueue(
    queue: PtvMusicContinuityQueue,
    limitValue: number
): PtvMusicContinuityQueue {
    const limit = Math.max(1, Math.min(queue.items.length, Math.floor(limitValue)));

    if (limit >= queue.items.length) return queue;

    const windowStart = Math.max(0, Math.min(
        queue.currentIndex - Math.floor(limit / 2),
        queue.items.length - limit
    ));
    const items = queue.items.slice(windowStart, windowStart + limit);
    const currentIndex = queue.currentIndex - windowStart;

    return {
        ...queue,
        currentIndex,
        currentItemId: items[currentIndex]?.Id || items[0].Id,
        items
    };
}

function getPtvMusicContinuityPayloadLength(value: unknown) {
    try {
        return JSON.stringify(value).length;
    } catch {
        return Number.MAX_SAFE_INTEGER;
    }
}

function fitPtvMusicContinuityDocument(
    document: PtvMusicContinuityDocument
): PtvMusicContinuityDocument {
    let queue = document.queue;
    let recentTracks = [...document.recentTracks];
    let fitted = document;

    while (getPtvMusicContinuityPayloadLength(fitted) > PTV_MUSIC_CONTINUITY_MAX_BYTES) {
        if (queue && queue.items.length > 12) {
            queue = trimPtvMusicContinuityQueue(queue, queue.items.length - 8);
        } else if (recentTracks.length > 8) {
            recentTracks = recentTracks.slice(0, -1);
        } else if (queue && queue.items.length > 1) {
            queue = trimPtvMusicContinuityQueue(queue, queue.items.length - 1);
        } else if (recentTracks.length) {
            recentTracks = recentTracks.slice(0, -1);
        } else if (queue) {
            queue = null;
        } else {
            break;
        }

        fitted = {
            ...document,
            queue,
            recentTracks
        };
    }

    return fitted;
}

function normalizePlayerTab(value: unknown): PtvMusicContinuityPlayerTab {
    switch (value) {
        case 'Lyrics':
        case 'Related':
            return value;
        default:
            return 'Up Next';
    }
}

function arePtvMusicContinuityRoutePartsDecodable(parts: readonly string[]) {
    try {
        for (const part of parts) decodeURIComponent(part);

        return true;
    } catch {
        return false;
    }
}

function getCanonicalPtvMusicContinuityRoute(route: string, parts: readonly string[]) {
    const view = parts[1] || '';

    if (!view) return PTV_MUSIC_CONTINUITY_DEFAULT_ROUTE;
    if (view === 'home' && parts.length === 2) return PTV_MUSIC_CONTINUITY_DEFAULT_ROUTE;
    if (PTV_MUSIC_CONTINUITY_COLLECTION_VIEWS.has(view) && parts.length === 2) {
        return `#${route}`;
    }
    if (PTV_MUSIC_CONTINUITY_DETAIL_VIEWS.has(view) && parts.length === 3 && parts[2]) {
        return `#${route}`;
    }

    return null;
}

export function normalizePtvMusicContinuityRoute(value: unknown) {
    let route = normalizeText(value, 512);

    if (!route) return null;

    const hashIndex = route.indexOf('#');

    if (hashIndex >= 0) route = route.slice(hashIndex + 1);

    route = route.split('?')[0].split('&')[0].trim();
    if (!route.startsWith('/')) route = `/${route}`;
    while (route.includes('//')) route = route.replace('//', '/');
    while (route.length > 1 && route.endsWith('/')) route = route.slice(0, -1);

    if (!route.startsWith('/music')
        || route.includes('\\')
        || route.split('/').includes('..')
        || route.length > 240
    ) {
        return null;
    }

    const parts = route.split('/').filter(Boolean);

    if (parts[0] !== 'music') return null;

    if (!arePtvMusicContinuityRoutePartsDecodable(parts)) return null;

    return getCanonicalPtvMusicContinuityRoute(route, parts);
}

function notifyPtvMusicContinuityListener(
    listener: PtvMusicContinuityListener,
    document: PtvMusicContinuityDocument | null,
    change: PtvMusicContinuityChange
) {
    try {
        listener(document, change);
    } catch {
        // Optional continuity observers cannot interrupt persistence or other observers.
    }
}

function notifyInitialPtvMusicContinuityListener(
    subscription: PtvMusicContinuitySubscription,
    document: PtvMusicContinuityDocument | null
) {
    subscription.listener(document, {
        external: false,
        reason: 'initial',
        scopeKey: subscription.scopeKey
    });
}

function removePtvMusicContinuitySubscription(subscription: PtvMusicContinuitySubscription) {
    continuitySubscriptions.delete(subscription);
    detachPtvMusicContinuityStorageListener();
}

function normalizeRecentTracks(value: unknown, now: number) {
    if (!Array.isArray(value)) return [];

    const candidates = value.reduce<PtvMusicContinuityRecentTrack[]>((recent, entry) => {
        if (!isRecord(entry)) return recent;

        const item = compactPtvMusicContinuityItem(entry.item);
        const lastPlayedAt = normalizeTimestamp(entry.lastPlayedAt, now);

        if (!item
            || !lastPlayedAt
            || now - lastPlayedAt > PTV_MUSIC_CONTINUITY_MAX_AGE_MS
        ) {
            return recent;
        }

        const runtimeTicks = normalizeNonNegativeInteger(entry.runtimeTicks, item.RunTimeTicks || 0);
        const positionTicks = Math.min(
            normalizeNonNegativeInteger(entry.positionTicks),
            runtimeTicks || Number.MAX_SAFE_INTEGER
        );

        recent.push({
            completed: entry.completed === true,
            item,
            lastPlayedAt,
            positionTicks,
            runtimeTicks
        });

        return recent;
    }, []);
    const seen = new Set<string>();

    candidates.sort((left, right) => right.lastPlayedAt - left.lastPlayedAt);

    return candidates
        .filter(entry => {
            if (seen.has(entry.item.Id)) return false;

            seen.add(entry.item.Id);
            return true;
        })
        .slice(0, PTV_MUSIC_CONTINUITY_RECENT_LIMIT);
}

export function inspectPtvMusicContinuityDocument(
    value: unknown,
    scope: PtvMusicContinuityScope,
    nowValue = Date.now()
): PtvMusicContinuityInspection {
    const scopeKey = getPtvMusicContinuityScopeKey(scope);
    const now = normalizeNow(nowValue);

    if (!scopeKey) return { document: null, status: 'scope-unavailable' };
    if (value === null || value === undefined) return { document: null, status: 'missing' };
    if (!isRecord(value) || value.version !== PTV_MUSIC_CONTINUITY_VERSION) {
        return { document: null, status: 'invalid' };
    }
    if (value.scopeKey !== scopeKey) return { document: null, status: 'wrong-scope' };

    const updatedAt = normalizeTimestamp(value.updatedAt, now);

    if (!updatedAt) return { document: null, status: 'invalid' };
    if (now - updatedAt > PTV_MUSIC_CONTINUITY_MAX_AGE_MS) {
        return { document: null, status: 'stale' };
    }

    return {
        document: {
            lastPlayerTab: normalizePlayerTab(value.lastPlayerTab),
            lastRoute: normalizePtvMusicContinuityRoute(value.lastRoute)
                || PTV_MUSIC_CONTINUITY_DEFAULT_ROUTE,
            queue: normalizeStoredQueue(value.queue, updatedAt, now),
            recentTracks: normalizeRecentTracks(value.recentTracks, now),
            scopeKey,
            updatedAt,
            version: PTV_MUSIC_CONTINUITY_VERSION
        },
        status: 'valid'
    };
}

export function createPtvMusicContinuityDocument(
    scope: PtvMusicContinuityScope,
    nowValue = Date.now()
): PtvMusicContinuityDocument | null {
    const scopeKey = getPtvMusicContinuityScopeKey(scope);

    if (!scopeKey) return null;

    return {
        lastPlayerTab: 'Up Next',
        lastRoute: PTV_MUSIC_CONTINUITY_DEFAULT_ROUTE,
        queue: null,
        recentTracks: [],
        scopeKey,
        updatedAt: normalizeNow(nowValue),
        version: PTV_MUSIC_CONTINUITY_VERSION
    };
}

export function loadPtvMusicContinuity(
    scope: PtvMusicContinuityScope,
    nowValue = Date.now()
): PtvMusicContinuityDocument | null {
    const key = getPtvMusicContinuityStorageKey(scope);

    if (!key) return null;

    const value = readPtvLocalStorageJson<unknown>(key, INVALID_STORAGE_VALUE);

    if (value === INVALID_STORAGE_VALUE) {
        removePtvLocalStorageKey(key);
        return null;
    }

    const inspection = inspectPtvMusicContinuityDocument(value, scope, nowValue);

    if (inspection.status !== 'valid') removePtvLocalStorageKey(key);

    return inspection.document;
}

function emitPtvMusicContinuityChange(
    key: string,
    scopeKey: string,
    document: PtvMusicContinuityDocument | null,
    reason: PtvMusicContinuityChangeReason,
    external = false
) {
    Array.from(continuitySubscriptions).forEach(subscription => {
        if (subscription.key !== key || subscription.scopeKey !== scopeKey) return;

        notifyPtvMusicContinuityListener(subscription.listener, document, {
            external,
            reason,
            scopeKey
        });
    });
}

function persistPtvMusicContinuity(
    scope: PtvMusicContinuityScope,
    document: PtvMusicContinuityDocument,
    reason: PtvMusicContinuityChangeReason,
    nowValue: number
) {
    const key = getPtvMusicContinuityStorageKey(scope);
    const inspection = inspectPtvMusicContinuityDocument(document, scope, nowValue);

    if (!key || inspection.status !== 'valid' || !inspection.document) return null;

    const fittedDocument = fitPtvMusicContinuityDocument(inspection.document);
    const stored = writePtvLocalStorageJson(key, fittedDocument, {
        maxBytes: PTV_MUSIC_CONTINUITY_MAX_BYTES,
        namespace: 'music-continuity'
    });

    if (!stored) return null;

    emitPtvMusicContinuityChange(
        key,
        fittedDocument.scopeKey,
        fittedDocument,
        reason
    );

    return fittedDocument;
}

function patchPtvMusicContinuity(
    scope: PtvMusicContinuityScope,
    patch: PtvMusicContinuityPatch,
    reason: PtvMusicContinuityChangeReason,
    nowValue = Date.now()
) {
    const now = normalizeNow(nowValue);
    const current = loadPtvMusicContinuity(scope, now)
        || createPtvMusicContinuityDocument(scope, now);

    if (!current) return null;

    return persistPtvMusicContinuity(scope, {
        ...current,
        ...patch,
        scopeKey: current.scopeKey,
        updatedAt: now,
        version: PTV_MUSIC_CONTINUITY_VERSION
    }, reason, now);
}

export function updatePtvMusicContinuity(
    scope: PtvMusicContinuityScope,
    patch: PtvMusicContinuityPatch,
    nowValue = Date.now()
) {
    return patchPtvMusicContinuity(scope, patch, 'update', nowValue);
}

export function savePtvMusicContinuityRoute(
    scope: PtvMusicContinuityScope,
    route: unknown,
    nowValue = Date.now()
) {
    const normalizedRoute = normalizePtvMusicContinuityRoute(route);

    if (!normalizedRoute) return loadPtvMusicContinuity(scope, nowValue);

    return patchPtvMusicContinuity(scope, {
        lastRoute: normalizedRoute
    }, 'route', nowValue);
}

export function savePtvMusicContinuityPlayerTab(
    scope: PtvMusicContinuityScope,
    tab: PtvMusicContinuityPlayerTab,
    nowValue = Date.now()
) {
    if (!['Lyrics', 'Related', 'Up Next'].includes(tab)) {
        return loadPtvMusicContinuity(scope, nowValue);
    }

    return patchPtvMusicContinuity(scope, {
        lastPlayerTab: tab
    }, 'tab', nowValue);
}

export function savePtvMusicQueueContinuity(
    scope: PtvMusicContinuityScope,
    snapshot: PtvMusicContinuityQueueInput,
    descriptor: PtvMusicContinuityQueueDescriptor = {},
    nowValue = Date.now()
) {
    const now = normalizeNow(nowValue);
    const resolvedDescriptor = {
        ...descriptor,
        source: descriptor.source || snapshot.queueSourceLabel
    };
    const queue = buildQueueSnapshot({
        capturedAt: now,
        currentIndexValue: snapshot.currentIndex,
        descriptorValue: resolvedDescriptor,
        itemsValue: snapshot.playlist,
        positionTicksValue: snapshot.positionTicks,
        repeatModeValue: snapshot.repeatMode,
        runtimeTicksValue: snapshot.runtimeTicks,
        shuffledValue: snapshot.isShuffled
    });

    return patchPtvMusicContinuity(scope, { queue }, 'queue', now);
}

export function clearPtvMusicQueueContinuity(
    scope: PtvMusicContinuityScope,
    nowValue = Date.now()
) {
    return patchPtvMusicContinuity(scope, { queue: null }, 'queue', nowValue);
}

export function isMeaningfulPtvMusicRecentTrack(
    item: PtvMusicItem,
    progress: PtvMusicRecentTrackProgress = {}
) {
    if (!compactPtvMusicContinuityItem(item)) return false;
    if (progress.completed === true || item.UserData?.Played === true) return true;

    const runtimeTicks = normalizeNonNegativeInteger(
        progress.runtimeTicks,
        item.RunTimeTicks || 0
    );
    const positionTicks = normalizeNonNegativeInteger(
        progress.positionTicks,
        item.UserData?.PlaybackPositionTicks || 0
    );
    const runtimeSeconds = runtimeTicks / PTV_MUSIC_TICKS_PER_SECOND;
    const thresholdSeconds = runtimeSeconds > 0 ?
        Math.min(
            PTV_MUSIC_STANDARD_LISTEN_SECONDS,
            Math.max(
                PTV_MUSIC_MINIMUM_LISTEN_SECONDS,
                runtimeSeconds * PTV_MUSIC_LISTEN_FRACTION
            )
        ) :
        PTV_MUSIC_STANDARD_LISTEN_SECONDS;

    return positionTicks >= thresholdSeconds * PTV_MUSIC_TICKS_PER_SECOND;
}

export function recordPtvMusicRecentTrack(
    scope: PtvMusicContinuityScope,
    item: PtvMusicItem,
    progress: PtvMusicRecentTrackProgress = {},
    nowValue = Date.now()
) {
    const now = normalizeNow(nowValue);
    const compactItem = compactPtvMusicContinuityItem(item);

    if (!compactItem || !isMeaningfulPtvMusicRecentTrack(item, progress)) {
        return loadPtvMusicContinuity(scope, now);
    }

    const current = loadPtvMusicContinuity(scope, now)
        || createPtvMusicContinuityDocument(scope, now);

    if (!current) return null;

    const runtimeTicks = normalizeNonNegativeInteger(
        progress.runtimeTicks,
        item.RunTimeTicks || 0
    );
    const positionTicks = Math.min(
        normalizeNonNegativeInteger(
            progress.positionTicks,
            item.UserData?.PlaybackPositionTicks || 0
        ),
        runtimeTicks || Number.MAX_SAFE_INTEGER
    );
    const playedAt = normalizeTimestamp(progress.playedAt, now) || now;
    const recentTracks = normalizeRecentTracks([
        {
            completed: progress.completed === true || item.UserData?.Played === true,
            item: compactItem,
            lastPlayedAt: playedAt,
            positionTicks,
            runtimeTicks
        },
        ...current.recentTracks
    ], now);

    return patchPtvMusicContinuity(scope, { recentTracks }, 'recent-track', now);
}

export function clearPtvMusicRecentTracks(
    scope: PtvMusicContinuityScope,
    nowValue = Date.now()
) {
    return patchPtvMusicContinuity(scope, {
        recentTracks: []
    }, 'recent-track', nowValue);
}

export function removePtvMusicRecentTrack(
    scope: PtvMusicContinuityScope,
    itemId: string,
    nowValue = Date.now()
) {
    const now = normalizeNow(nowValue);
    const normalizedItemId = normalizeIdentifier(itemId, 256);
    const current = loadPtvMusicContinuity(scope, now);

    if (!current || !normalizedItemId) return current;

    return patchPtvMusicContinuity(scope, {
        recentTracks: current.recentTracks.filter(entry => entry.item.Id !== normalizedItemId)
    }, 'recent-track', now);
}

export function clearPtvMusicContinuity(scope: PtvMusicContinuityScope) {
    const key = getPtvMusicContinuityStorageKey(scope);
    const scopeKey = getPtvMusicContinuityScopeKey(scope);

    if (!key || !scopeKey) return false;

    const removed = removePtvLocalStorageKey(key);

    if (removed) {
        emitPtvMusicContinuityChange(key, scopeKey, null, 'clear');
    }

    return removed;
}

function handlePtvMusicContinuityStorageEvent(event: StorageEvent) {
    if (!event.key) return;

    const subscriptions = Array.from(continuitySubscriptions)
        .filter(subscription => subscription.key === event.key);

    if (!subscriptions.length) return;

    subscriptions.forEach(subscription => {
        let value: unknown = null;

        if (event.newValue !== null) {
            try {
                value = JSON.parse(event.newValue) as unknown;
            } catch {
                removePtvLocalStorageKey(subscription.key);
            }
        }

        const inspection = inspectPtvMusicContinuityDocument(
            value,
            subscription.scope
        );
        const document = inspection.status === 'valid' ? inspection.document : null;

        notifyPtvMusicContinuityListener(subscription.listener, document, {
            external: true,
            reason: 'external',
            scopeKey: subscription.scopeKey
        });
    });
}

function attachPtvMusicContinuityStorageListener() {
    if (isStorageListenerAttached || typeof window === 'undefined') return;

    window.addEventListener('storage', handlePtvMusicContinuityStorageEvent);
    isStorageListenerAttached = true;
}

function detachPtvMusicContinuityStorageListener() {
    if (!isStorageListenerAttached
        || continuitySubscriptions.size
        || typeof window === 'undefined'
    ) {
        return;
    }

    window.removeEventListener('storage', handlePtvMusicContinuityStorageEvent);
    isStorageListenerAttached = false;
}

export function subscribeToPtvMusicContinuity(
    scope: PtvMusicContinuityScope,
    listener: PtvMusicContinuityListener,
    emitCurrent = true
) {
    const key = getPtvMusicContinuityStorageKey(scope);
    const scopeKey = getPtvMusicContinuityScopeKey(scope);

    if (!key || !scopeKey) {
        if (emitCurrent) {
            listener(null, {
                external: false,
                reason: 'initial',
                scopeKey: ''
            });
        }

        return () => undefined;
    }

    const subscription = {
        key,
        listener,
        scope,
        scopeKey
    };

    continuitySubscriptions.add(subscription);
    attachPtvMusicContinuityStorageListener();

    if (emitCurrent) {
        try {
            notifyInitialPtvMusicContinuityListener(
                subscription,
                loadPtvMusicContinuity(scope)
            );
        } catch (error) {
            removePtvMusicContinuitySubscription(subscription);
            throw error;
        }
    }

    return (): undefined => {
        removePtvMusicContinuitySubscription(subscription);
        return undefined;
    };
}
