import {
    requestPtvJson,
    type PtvItem
} from '../../api';
import type { PtvSearchGroupId } from './nativeSearchState';

type PtvSearchHint = Readonly<{
    Album?: string | null;
    AlbumArtist?: string | null;
    AlbumId?: string | null;
    Artists?: string[];
    BackdropImageItemId?: string | null;
    BackdropImageTag?: string | null;
    EpisodeCount?: number | null;
    Id?: string;
    ItemId?: string;
    MediaType?: string;
    Name?: string;
    PrimaryImageAspectRatio?: number | null;
    PrimaryImageTag?: string | null;
    ProductionYear?: number | null;
    RunTimeTicks?: number | null;
    Series?: string | null;
    SongCount?: number | null;
    ThumbImageItemId?: string | null;
    ThumbImageTag?: string | null;
    Type?: string;
}>;

type PtvSearchHintResult = Readonly<{
    SearchHints?: PtvSearchHint[];
    TotalRecordCount?: number;
}>;

export type PtvGroupedSearchHints = Record<PtvSearchGroupId, PtvItem[]>;
export type PtvSearchHintFailureKind = 'aborted' | 'error' | 'timeout';

const PTV_SEARCH_HINT_GROUP_BY_TYPE = new Map<string, PtvSearchGroupId>([
    ['album', 'albums'],
    ['artist', 'artists'],
    ['audio', 'music'],
    ['book', 'reading'],
    ['boxset', 'collections'],
    ['episode', 'episodes'],
    ['genre', 'genres'],
    ['movie', 'movies'],
    ['musicalbum', 'albums'],
    ['musicartist', 'artists'],
    ['musicgenre', 'genres'],
    ['person', 'people'],
    ['series', 'shows'],
    ['studio', 'studios']
]);

function getHintId(hint: PtvSearchHint) {
    return String(hint.Id || hint.ItemId || '').trim();
}

function normalizeSearchText(value: unknown) {
    return String(value || '').trim().toLocaleLowerCase();
}

function getOptionalCount(value: unknown) {
    if (value === null || value === undefined || value === '') return undefined;

    const count = Number(value);

    return Number.isFinite(count) ? count : undefined;
}

function getSearchHintText(item: PtvItem) {
    return [
        item.Name,
        item.SeriesName,
        item.Album,
        item.AlbumArtist,
        ...(Array.isArray(item.Artists) ? item.Artists : [])
    ].map(normalizeSearchText).filter(Boolean);
}

function getSearchHintRank(item: PtvItem, query: string) {
    const normalizedQuery = normalizeSearchText(query);
    const candidates = getSearchHintText(item);

    if (candidates.some(value => value === normalizedQuery)) return 0;
    if (candidates.some(value => value.startsWith(normalizedQuery))) return 1;
    if (candidates.some(value => value.includes(normalizedQuery))) return 2;

    return 3;
}

export function mapPtvSearchHintToItem(hint: PtvSearchHint, serverId = ''): PtvItem | null {
    const id = getHintId(hint);
    const type = String(hint.Type || '').trim();

    if (!id || !type) return null;

    const backdropOwnerId = String(hint.BackdropImageItemId || '').trim();
    const hasOwnedBackdrop = hint.BackdropImageTag && (!backdropOwnerId || backdropOwnerId === id);
    const episodeCount = getOptionalCount(hint.EpisodeCount);
    const songCount = getOptionalCount(hint.SongCount);

    return {
        Album: hint.Album || undefined,
        AlbumArtist: hint.AlbumArtist || undefined,
        AlbumId: hint.AlbumId || undefined,
        Artists: hint.Artists || undefined,
        BackdropImageTags: hasOwnedBackdrop ? [hint.BackdropImageTag] : undefined,
        Id: id,
        ImageTags: hint.PrimaryImageTag ? { Primary: hint.PrimaryImageTag } : undefined,
        MediaType: hint.MediaType || undefined,
        Name: hint.Name || undefined,
        ParentBackdropImageTags: hint.BackdropImageTag ? [hint.BackdropImageTag] : undefined,
        ParentBackdropItemId: hint.BackdropImageItemId || undefined,
        ParentThumbImageTag: hint.ThumbImageTag || undefined,
        ParentThumbItemId: hint.ThumbImageItemId || undefined,
        PrimaryImageAspectRatio: hint.PrimaryImageAspectRatio ?? undefined,
        ProductionYear: hint.ProductionYear ?? undefined,
        RecursiveItemCount: episodeCount ?? songCount,
        RunTimeTicks: hint.RunTimeTicks ?? undefined,
        ServerId: serverId || undefined,
        SeriesName: hint.Series || undefined,
        Type: type
    };
}

export function groupPtvSearchHints(
    hints: readonly PtvSearchHint[],
    query: string,
    perGroupLimit: number,
    serverId = ''
): PtvGroupedSearchHints {
    const grouped: PtvGroupedSearchHints = {
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
    } satisfies PtvGroupedSearchHints;
    const seen = new Map<PtvSearchGroupId, Set<string>>();
    const seriesByLogicalKey = new Map<string, number>();
    const sourceOrder = new Map<PtvItem, number>();

    hints.forEach((hint, sourceIndex) => {
        const item = mapPtvSearchHintToItem(hint, serverId);
        const groupId = PTV_SEARCH_HINT_GROUP_BY_TYPE.get(normalizeSearchText(item?.Type));
        const id = String(item?.Id || '');

        if (!item || !groupId || !id) return;

        const recursiveItemCount = getOptionalCount(item.RecursiveItemCount);

        if (groupId === 'shows' && recursiveItemCount === 0) return;

        const groupSeen = seen.get(groupId) || new Set<string>();
        const dedupeKey = `${normalizeSearchText(item.Type)}:${id}`;
        if (groupSeen.has(dedupeKey)) return;

        groupSeen.add(dedupeKey);
        seen.set(groupId, groupSeen);

        if (groupId === 'shows') {
            const logicalKey = [
                normalizeSearchText(item.Name),
                String(item.ProductionYear || '')
            ].join(':');
            const existingIndex = seriesByLogicalKey.get(logicalKey);

            if (logicalKey !== ':' && existingIndex !== undefined) {
                const existing = grouped.shows[existingIndex];
                const existingCount = getOptionalCount(existing?.RecursiveItemCount);

                if ((recursiveItemCount ?? -1) > (existingCount ?? -1)) {
                    grouped.shows[existingIndex] = item;
                    sourceOrder.set(item, sourceIndex);
                }
                return;
            }

            if (logicalKey !== ':') {
                seriesByLogicalKey.set(logicalKey, grouped.shows.length);
            }
        }

        grouped[groupId].push(item);
        sourceOrder.set(item, sourceIndex);
    });

    Object.values(grouped).forEach(items => {
        items.sort((left, right) => (
            getSearchHintRank(left, query) - getSearchHintRank(right, query)
            || (sourceOrder.get(left) ?? 0) - (sourceOrder.get(right) ?? 0)
        ));
        items.splice(Math.max(0, perGroupLimit));
    });

    return grouped;
}

export function getPtvSearchHintFailureKind(
    error: unknown,
    timedOut = false
): PtvSearchHintFailureKind {
    if (timedOut) return 'timeout';

    const errorName = error && typeof error === 'object' && 'name' in error ?
        String(error.name) :
        '';

    if (errorName === 'PtvSearchPrimaryTimeoutError') return 'timeout';
    if (errorName === 'AbortError' || errorName === 'PtvSearchAbortedError') return 'aborted';

    return 'error';
}

export async function searchPtvHints(options: Readonly<{
    includeItemTypes: readonly string[];
    limit: number;
    perGroupLimit: number;
    query: string;
    serverId: string;
    signal: AbortSignal;
    userId: string;
}>) {
    const requestedTypes = new Set(options.includeItemTypes.map(type => type.trim().toLowerCase()));
    const includeArtists = requestedTypes.has('audio')
        || requestedTypes.has('musicalbum')
        || requestedTypes.has('musicartist');
    const includeGenres = requestedTypes.has('genre') || requestedTypes.has('musicgenre');
    const includePeople = requestedTypes.has('person');
    const includeStudios = requestedTypes.has('studio');
    const nonMediaTypes = new Set(['genre', 'musicgenre', 'person', 'studio']);
    const includeMedia = options.includeItemTypes.some(type => !nonMediaTypes.has(type.trim().toLowerCase()));
    const response = await requestPtvJson<PtvSearchHintResult>('Search/Hints', {
        params: {
            IncludeArtists: includeArtists,
            IncludeGenres: includeGenres,
            IncludeItemTypes: options.includeItemTypes.join(','),
            IncludeMedia: includeMedia,
            IncludePeople: includePeople,
            IncludeStudios: includeStudios,
            Limit: options.limit,
            SearchTerm: options.query,
            StartIndex: 0,
            UserId: options.userId
        },
        serverId: options.serverId,
        signal: options.signal
    });
    if (!Array.isArray(response.SearchHints)) {
        throw new TypeError('Search/Hints returned an invalid response.');
    }

    const hints = response.SearchHints;

    return {
        groups: groupPtvSearchHints(hints, options.query, options.perGroupLimit, options.serverId),
        hintCount: hints.length,
        totalRecordCount: response.TotalRecordCount ?? hints.length
    };
}
