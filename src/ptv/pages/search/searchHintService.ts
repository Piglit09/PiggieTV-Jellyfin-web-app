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
    Id?: string;
    ItemId?: string;
    MediaType?: string;
    Name?: string;
    PrimaryImageAspectRatio?: number | null;
    PrimaryImageTag?: string | null;
    ProductionYear?: number | null;
    RunTimeTicks?: number | null;
    Series?: string | null;
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
    ['movie', 'movies'],
    ['musicalbum', 'albums'],
    ['musicartist', 'artists'],
    ['person', 'people'],
    ['series', 'shows']
]);

function getHintId(hint: PtvSearchHint) {
    return String(hint.Id || hint.ItemId || '').trim();
}

function normalizeSearchText(value: unknown) {
    return String(value || '').trim().toLocaleLowerCase();
}

function getSearchHintRank(item: PtvItem, query: string) {
    const title = normalizeSearchText(item.Name);
    const normalizedQuery = normalizeSearchText(query);

    if (title === normalizedQuery) return 0;
    if (title.startsWith(normalizedQuery)) return 1;
    if (title.includes(normalizedQuery)) return 2;

    return 3;
}

export function mapPtvSearchHintToItem(hint: PtvSearchHint): PtvItem | null {
    const id = getHintId(hint);
    const type = String(hint.Type || '').trim();

    if (!id || !type) return null;

    const backdropOwnerId = String(hint.BackdropImageItemId || '').trim();
    const hasOwnedBackdrop = hint.BackdropImageTag && (!backdropOwnerId || backdropOwnerId === id);

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
        RunTimeTicks: hint.RunTimeTicks ?? undefined,
        SeriesName: hint.Series || undefined,
        Type: type
    };
}

export function groupPtvSearchHints(
    hints: readonly PtvSearchHint[],
    query: string,
    perGroupLimit: number
): PtvGroupedSearchHints {
    const grouped: PtvGroupedSearchHints = {
        albums: [],
        artists: [],
        collections: [],
        episodes: [],
        movies: [],
        music: [],
        people: [],
        reading: [],
        shows: []
    } satisfies PtvGroupedSearchHints;
    const seen = new Map<PtvSearchGroupId, Set<string>>();
    const sourceOrder = new Map<PtvItem, number>();

    hints.forEach((hint, sourceIndex) => {
        const item = mapPtvSearchHintToItem(hint);
        const groupId = PTV_SEARCH_HINT_GROUP_BY_TYPE.get(normalizeSearchText(item?.Type));
        const id = String(item?.Id || '');

        if (!item || !groupId || !id) return;

        const groupSeen = seen.get(groupId) || new Set<string>();
        if (groupSeen.has(id)) return;

        groupSeen.add(id);
        seen.set(groupId, groupSeen);
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
    const response = await requestPtvJson<PtvSearchHintResult>('Search/Hints', {
        params: {
            IncludeArtists: true,
            IncludeItemTypes: options.includeItemTypes.join(','),
            IncludeMedia: true,
            IncludePeople: true,
            Limit: options.limit,
            SearchTerm: options.query,
            StartIndex: 0,
            UserId: options.userId
        },
        serverId: options.serverId,
        signal: options.signal
    });
    const hints = response.SearchHints || [];

    return {
        groups: groupPtvSearchHints(hints, options.query, options.perGroupLimit),
        hintCount: hints.length,
        totalRecordCount: response.TotalRecordCount ?? hints.length
    };
}
