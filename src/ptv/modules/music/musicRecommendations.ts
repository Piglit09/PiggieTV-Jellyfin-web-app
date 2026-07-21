import type {
    PtvMusicItem,
    PtvMusicPlaylistRequest,
    PtvMusicPlaylistResult,
    PtvMusicRelatedOptions,
    PtvMusicSeed
} from './musicTypes';

const DEFAULT_TRACK_LIMIT = 28;

function getMusicTitle(item: PtvMusicItem) {
    return String(item.Name || item.SortName || '').trim();
}

function getMusicArtist(item: PtvMusicItem) {
    return String(item.AlbumArtist || item.Artist || item.ArtistItems?.[0]?.Name || item.Artists?.[0] || '').trim();
}

function getMusicGenres(item: PtvMusicItem) {
    return Array.isArray(item.Genres) ? item.Genres.filter(Boolean) : [];
}

function getMusicCodec(item: PtvMusicItem) {
    return String(item.Container || '').toLowerCase();
}

function getMusicRecommendationItemKey(item: PtvMusicItem) {
    return String(item.Id || `${getMusicArtist(item)}:${getMusicTitle(item)}`).toLowerCase();
}

function uniquePtvMusicItems(items: PtvMusicItem[]) {
    const seen = new Set<string>();

    return items.filter(item => {
        const key = getMusicRecommendationItemKey(item);

        if (seen.has(key)) return false;

        seen.add(key);
        return true;
    });
}

function selectDiverseMusicRecommendationItems(
    entries: Array<{ item: PtvMusicItem; score: number }>,
    limit: number,
    blockedKeys: Set<string>
) {
    const artistCounts = new Map<string, number>();
    const albumCounts = new Map<string, number>();
    const selected: PtvMusicItem[] = [];

    entries
        .sort((left, right) => right.score - left.score || getMusicTitle(left.item).localeCompare(getMusicTitle(right.item)))
        .forEach(entry => {
            if (selected.length >= limit) return;

            const itemKey = getMusicRecommendationItemKey(entry.item);
            const artistKey = getMusicArtist(entry.item).toLowerCase() || 'unknown-artist';
            const albumKey = String(entry.item.AlbumId || entry.item.Album || '').toLowerCase();

            if (blockedKeys.has(itemKey) || artistCounts.get(artistKey) === 2 || (albumKey && albumCounts.get(albumKey) === 2)) return;

            blockedKeys.add(itemKey);
            artistCounts.set(artistKey, (artistCounts.get(artistKey) || 0) + 1);
            if (albumKey) albumCounts.set(albumKey, (albumCounts.get(albumKey) || 0) + 1);
            selected.push(entry.item);
        });

    return selected;
}

function buildMusicAffinityItems(seedItems: PtvMusicItem[], pool: PtvMusicItem[], limit = DEFAULT_TRACK_LIMIT) {
    const favoriteArtists = new Set(seedItems.map(getMusicArtist).filter(Boolean).map(artist => artist.toLowerCase()));
    const favoriteGenres = new Set(seedItems.reduce<string[]>((genres, item) => genres.concat(getMusicGenres(item)), []).map(genre => genre.toLowerCase()));
    const blockedKeys = new Set(seedItems.map(getMusicRecommendationItemKey));
    const entries = uniquePtvMusicItems(pool)
        .filter(item => !blockedKeys.has(getMusicRecommendationItemKey(item)))
        .map(item => {
            const artist = getMusicArtist(item).toLowerCase();
            const genres = getMusicGenres(item).map(genre => genre.toLowerCase());
            const playCount = Number(item.UserData?.PlayCount || 0);
            const score = (favoriteArtists.has(artist) ? 40 : 0)
                + (genres.filter(genre => favoriteGenres.has(genre)).length * 12)
                + (item.UserData?.IsFavorite ? 8 : 0)
                + (playCount * 2)
                + (['flac', 'opus'].some(codec => getMusicCodec(item).includes(codec)) ? 2 : 0);

            return { item, score };
        });

    return selectDiverseMusicRecommendationItems(entries, limit, blockedKeys);
}

function buildMusicDiscoveryItems(pool: PtvMusicItem[], blockedKeys: Set<string>, limit = DEFAULT_TRACK_LIMIT) {
    const now = Date.now();
    const entries = uniquePtvMusicItems(pool)
        .filter(item => !blockedKeys.has(getMusicRecommendationItemKey(item)))
        .map(item => {
            const createdAt = Date.parse(String(item.DateCreated || ''));
            const ageDays = Number.isFinite(createdAt) ? Math.max(0, (now - createdAt) / 86_400_000) : 365;
            const playCount = Number(item.UserData?.PlayCount || 0);
            const qualityScore = ['flac', 'opus'].some(codec => getMusicCodec(item).includes(codec)) ? 8 : 0;

            return {
                item,
                score: qualityScore + Math.max(0, 36 - Math.min(36, ageDays)) + Math.max(0, 24 - (playCount * 6))
            };
        });

    return selectDiverseMusicRecommendationItems(entries, limit, new Set(blockedKeys));
}

function getMusicRecommendationOverlapPercentage(sections: Array<{ items: PtvMusicItem[] }>) {
    const shelfSets = sections.map(section => new Set(section.items.map(getMusicRecommendationItemKey)));

    if (shelfSets.length < 2) return 0;

    let total = 0;
    let comparisons = 0;

    for (let index = 0; index < shelfSets.length; index++) {
        for (let nextIndex = index + 1; nextIndex < shelfSets.length; nextIndex++) {
            const intersection = Array.from(shelfSets[index]).filter(key => shelfSets[nextIndex].has(key)).length;
            const union = new Set([...shelfSets[index], ...shelfSets[nextIndex]]).size;

            total += union ? (intersection / union) * 100 : 0;
            comparisons += 1;
        }
    }

    return comparisons ? Number((total / comparisons).toFixed(1)) : 0;
}

export type PtvMusicRecommendationShelves = Readonly<{
    madeForYou: PtvMusicItem[];
    overlapPercentage: number;
    recommended: PtvMusicItem[];
}>;

export type PtvMusicRecommendationEngine = Readonly<{
    buildShelves: (
        seedItems: PtvMusicItem[],
        affinityPool: PtvMusicItem[],
        discoveryPool: PtvMusicItem[],
        continueListening?: PtvMusicItem[],
        limit?: number
    ) => PtvMusicRecommendationShelves;
    initialize: () => void;
    initialized: boolean;
}>;

export function buildPtvMusicRecommendationShelves(
    seedItems: PtvMusicItem[],
    affinityPool: PtvMusicItem[],
    discoveryPool: PtvMusicItem[],
    continueListening: PtvMusicItem[] = [],
    limit = DEFAULT_TRACK_LIMIT
): PtvMusicRecommendationShelves {
    const continueKeys = new Set(continueListening.map(getMusicRecommendationItemKey));
    const madeForYou = buildMusicAffinityItems(
        seedItems,
        affinityPool.filter(item => !continueKeys.has(getMusicRecommendationItemKey(item))),
        limit
    );
    const blockedKeys = new Set([
        ...continueListening,
        ...madeForYou
    ].map(getMusicRecommendationItemKey));
    const recommended = buildMusicDiscoveryItems(discoveryPool, blockedKeys, limit);

    return {
        madeForYou,
        overlapPercentage: getMusicRecommendationOverlapPercentage([
            { items: madeForYou },
            { items: recommended }
        ]),
        recommended
    };
}

export function createPtvMusicRecommendationEngine(): PtvMusicRecommendationEngine {
    let initialized = false;

    const initialize = () => {
        initialized = true;
    };

    return {
        buildShelves(seedItems, affinityPool, discoveryPool, continueListening, limit) {
            if (!initialized) initialize();

            return buildPtvMusicRecommendationShelves(
                seedItems,
                affinityPool,
                discoveryPool,
                continueListening,
                limit
            );
        },
        initialize,
        get initialized() {
            return initialized;
        }
    };
}

function getRelatedTrackScore(seedItem: PtvMusicItem, item: PtvMusicItem) {
    const seedArtist = getMusicArtist(seedItem).toLowerCase();
    const artist = getMusicArtist(item).toLowerCase();
    const seedAlbum = String(seedItem.AlbumId || seedItem.Album || '').toLowerCase();
    const album = String(item.AlbumId || item.Album || '').toLowerCase();
    const seedGenres = new Set(getMusicGenres(seedItem).map(genre => genre.toLowerCase()));
    const genreMatches = getMusicGenres(item).filter(genre => seedGenres.has(genre.toLowerCase())).length;

    return (artist && artist === seedArtist ? 60 : 0)
        + (album && album === seedAlbum ? 30 : 0)
        + (genreMatches * 12)
        + (item.UserData?.IsFavorite ? 8 : 0)
        + Number(item.UserData?.PlayCount || 0);
}

export function buildPtvMusicRelatedTracks(
    seedItem: PtvMusicItem,
    options: PtvMusicRelatedOptions = {}
): Promise<PtvMusicItem[]> {
    const seedKey = getMusicRecommendationItemKey(seedItem);
    const pool = uniquePtvMusicItems(options.pool || [])
        .filter(item => getMusicRecommendationItemKey(item) !== seedKey)
        .map(item => ({ item, score: getRelatedTrackScore(seedItem, item) }))
        .sort((left, right) => right.score - left.score || getMusicTitle(left.item).localeCompare(getMusicTitle(right.item)))
        .slice(0, options.limit || 24)
        .map(entry => entry.item);

    return Promise.resolve(pool);
}

function getDefaultMusicSeed(seed?: PtvMusicSeed): PtvMusicSeed {
    return seed || {
        kind: 'random',
        label: 'Discovery'
    };
}

export async function buildPtvMusicRecommendations(
    request: PtvMusicPlaylistRequest
): Promise<PtvMusicPlaylistResult> {
    const { getPtvMusicHome } = await import('./musicApi');
    const homeData = await getPtvMusicHome();
    const pool = uniquePtvMusicItems(homeData.sections.flatMap(section => section.items));
    const seed = getDefaultMusicSeed(request.seed);
    const items = seed.item ?
        await buildPtvMusicRelatedTracks(seed.item, { limit: request.limit || 50, pool }) :
        pool.slice(0, request.limit || 50);
    const name = request.name || (seed.label ? `${seed.label} Mix` : 'PiggieTV Music Mix');

    return {
        description: request.prompt || `A PiggieTV music mix built from ${seed.label || seed.kind}.`,
        items,
        name,
        seed
    };
}
