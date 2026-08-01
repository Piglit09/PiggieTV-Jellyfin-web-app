import type {
    PtvMusicItem,
    PtvMusicPlaylistRequest,
    PtvMusicPlaylistResult,
    PtvMusicRelatedOptions,
    PtvMusicSeed
} from './musicTypes';
import { shouldExcludePtvRecommendationItem } from '../recommendations/feedback/recommendationFeedback';
import { isPlayablePtvMusicTrack } from './musicPlaybackItem';

const DEFAULT_TRACK_LIMIT = 28;
const DEFAULT_GENERATED_MIX_LIMIT = 50;
const MAX_GENERATED_MIX_LIMIT = 100;
const MAX_GENERATED_MIX_CANDIDATES = 300;
const GENERATED_MIX_FAMILIAR_INTERVAL = 4;
const GENERATED_MIX_DISCOVERY_RATIO = 0.25;
const GENERATED_MIX_FAMILIAR_RATIO = 0.25;
const GENERATED_MIX_DISCOVERY_WINDOW = 10;
const GENERATED_MIX_MAX_CONSECUTIVE_ARTIST_RUN = 2;
const GENERATED_MIX_MAX_CONSECUTIVE_ALBUM_RUN = 2;
const GENERATED_MIX_MAX_SEGMENT_ALBUM = 2;

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

export function buildPtvDistinctMusicRecommendationRow(
    items: PtvMusicItem[],
    excludedItems: PtvMusicItem[],
    limit = 24
) {
    const excludedKeys = new Set(excludedItems.map(getMusicRecommendationItemKey));

    return uniquePtvMusicItems(items)
        .filter(item => !excludedKeys.has(getMusicRecommendationItemKey(item)))
        .slice(0, limit);
}

function selectDiverseMusicRecommendationItems(
    entries: Array<{ item: PtvMusicItem; score: number }>,
    limit: number,
    blockedKeys: Set<string>
) {
    const artistCounts = new Map<string, number>();
    const albumCounts = new Map<string, number>();
    const selected: PtvMusicItem[] = [];

    entries.sort((left, right) => right.score - left.score || getMusicTitle(left.item).localeCompare(getMusicTitle(right.item)));
    entries.forEach(entry => {
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
        .filter(isPlayablePtvMusicTrack)
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

type PtvGeneratedMusicCandidate = {
    albumKey: string;
    artistKey: string;
    familiar: boolean;
    item: PtvMusicItem;
    itemKey: string;
    score: number;
    tieBreaker: number;
};

function normalizeMusicMixValue(value: unknown) {
    return String(value || '').trim().toLowerCase();
}

function uniqueMusicMixValues(values: unknown[]) {
    return Array.from(new Set(values
        .map(normalizeMusicMixValue)
        .filter(Boolean)));
}

function getMusicArtistKeys(item: PtvMusicItem) {
    return uniqueMusicMixValues([
        item.AlbumArtist,
        item.Artist,
        item.MusicBrainzArtistName,
        ...(item.MusicBrainzArtistNames || []),
        ...(item.Artists || []),
        ...(item.ArtistItems || []).flatMap(artist => [artist.Id, artist.Name])
    ]);
}

function getMusicAlbumKeys(item: PtvMusicItem) {
    return uniqueMusicMixValues([
        item.AlbumId,
        item.Album,
        item.ParentId
    ]);
}

function getMusicGenreKeys(item: PtvMusicItem) {
    return uniqueMusicMixValues([
        ...getMusicGenres(item),
        ...(item.Tags || [])
    ]);
}

function getMusicSeedKeys(seed: PtvMusicSeed) {
    const seedItem = seed.item;
    const commonKeys: unknown[] = [
        seed.id,
        seed.value,
        seedItem?.Id,
        seedItem?.Name
    ];

    switch (seed.kind) {
        case 'album':
            return uniqueMusicMixValues([
                ...commonKeys,
                seedItem?.AlbumId,
                seedItem?.Album
            ]);
        case 'artist':
            return uniqueMusicMixValues([
                ...commonKeys,
                ...(seedItem ? getMusicArtistKeys(seedItem) : [])
            ]);
        case 'genre':
            return uniqueMusicMixValues([
                seed.id,
                seed.value,
                seed.label,
                seedItem?.Name,
                ...(seedItem ? getMusicGenreKeys(seedItem) : [])
            ]);
        case 'song':
            return uniqueMusicMixValues([
                ...commonKeys,
                seedItem?.SortName,
                seedItem?.MusicBrainzTitle
            ]);
        default:
            return uniqueMusicMixValues(commonKeys);
    }
}

function hasMatchingMusicMixKey(itemKeys: string[], seedKeys: string[]) {
    return seedKeys.some(seedKey => itemKeys.includes(seedKey));
}

function isDirectMusicSeedMatch(item: PtvMusicItem, seed: PtvMusicSeed) {
    const seedKeys = getMusicSeedKeys(seed);

    switch (seed.kind) {
        case 'album':
            return hasMatchingMusicMixKey(getMusicAlbumKeys(item), seedKeys);
        case 'artist':
            return hasMatchingMusicMixKey(getMusicArtistKeys(item), seedKeys);
        case 'favorites':
            return item.UserData?.IsFavorite === true;
        case 'genre':
            return hasMatchingMusicMixKey(getMusicGenreKeys(item), seedKeys);
        case 'quality':
            return ['flac', 'opus'].some(codec => getMusicCodec(item).includes(codec));
        case 'recent':
            return Boolean(item.UserData?.LastPlayedDate);
        case 'song':
            return hasMatchingMusicMixKey(uniqueMusicMixValues([
                item.Id,
                item.Name,
                item.SortName,
                item.MusicBrainzTitle
            ]), seedKeys);
        case 'top':
            return Number(item.UserData?.PlayCount || 0) > 0;
        default:
            return false;
    }
}

function createPtvMusicMixAbortError(message: string) {
    if (typeof DOMException !== 'undefined') {
        return new DOMException(message, 'AbortError');
    }

    return Object.assign(new Error(message), {
        name: 'AbortError'
    });
}

function isPtvMusicMixAbortError(error: unknown) {
    const errorName = error && typeof error === 'object' ?
        String((error as { name?: unknown }).name || '') :
        '';
    const message = error instanceof Error ? error.message : String(error || '');

    return errorName === 'AbortError' || /abort|cancel|superseded/i.test(message);
}

function throwIfPtvMusicMixRetired(request: PtvMusicPlaylistRequest) {
    if (request.signal?.aborted) {
        throw createPtvMusicMixAbortError('PiggieTV Music mix generation was aborted.');
    }

    if (request.isCurrent?.() === false) {
        throw createPtvMusicMixAbortError('PiggieTV Music mix generation was superseded.');
    }
}

function getGeneratedMusicMixLimit(limit?: number) {
    const normalizedLimit = Number(limit);

    if (!Number.isFinite(normalizedLimit)) return DEFAULT_GENERATED_MIX_LIMIT;

    return Math.max(1, Math.min(MAX_GENERATED_MIX_LIMIT, Math.floor(normalizedLimit)));
}

function hashMusicMixValue(value: string) {
    let hash = 2_166_136_261;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
    }

    return hash >>> 0;
}

function getMusicMixSessionKey(request: PtvMusicPlaylistRequest, seed: PtvMusicSeed) {
    return [
        String(request.sessionSeed ?? 'stable-default'),
        seed.kind,
        seed.id || '',
        seed.value || '',
        seed.item ? getMusicRecommendationItemKey(seed.item) : ''
    ].join(':');
}

function getMusicMixLikes(item: PtvMusicItem) {
    return (item.UserData as { Likes?: boolean | null } | undefined)?.Likes;
}

function isFamiliarMusicMixItem(item: PtvMusicItem) {
    return item.UserData?.IsFavorite === true
        || getMusicMixLikes(item) === true
        || Number(item.UserData?.PlayCount || 0) > 0;
}

function getMusicMixDiscoveryScore(item: PtvMusicItem) {
    const playCount = Math.max(0, Number(item.UserData?.PlayCount || 0));
    const lastPlayedAt = Date.parse(String(item.UserData?.LastPlayedDate || ''));
    const hasLastPlayedAt = Number.isFinite(lastPlayedAt);
    const favoriteScore = item.UserData?.IsFavorite || getMusicMixLikes(item) === true ? 18 : 0;
    const qualityScore = ['flac', 'opus'].some(codec => getMusicCodec(item).includes(codec)) ? 3 : 0;

    return (playCount === 0 ? 44 : Math.max(0, 14 - (playCount * 2)))
        + (hasLastPlayedAt ? -(lastPlayedAt / 100_000_000_000) : 20)
        + favoriteScore
        + qualityScore;
}

function getMusicMixSeedScore(seed: PtvMusicSeed, item: PtvMusicItem) {
    const directMatch = isDirectMusicSeedMatch(item, seed);
    const seedItem = seed.item;
    const exactSeedItem = seedItem
        && getMusicRecommendationItemKey(seedItem) === getMusicRecommendationItemKey(item);
    let score = directMatch ? 220 : 0;

    if (exactSeedItem) score += 1_000;
    if (seedItem && !exactSeedItem) score += Math.min(140, getRelatedTrackScore(seedItem, item));

    switch (seed.kind) {
        case 'favorites':
            return score + (item.UserData?.IsFavorite || getMusicMixLikes(item) === true ? 220 : 0);
        case 'quality':
            return score + (['flac', 'opus'].some(codec => getMusicCodec(item).includes(codec)) ? 120 : 0);
        case 'recent': {
            const lastPlayedAt = Date.parse(String(item.UserData?.LastPlayedDate || ''));

            return score + (Number.isFinite(lastPlayedAt) ? lastPlayedAt / 10_000_000_000 : 0);
        }
        case 'top':
            return score + (Math.min(50, Math.max(0, Number(item.UserData?.PlayCount || 0))) * 8);
        default:
            return score;
    }
}

function getGeneratedMusicCandidate(
    item: PtvMusicItem,
    seed: PtvMusicSeed,
    sessionKey: string
): PtvGeneratedMusicCandidate {
    const itemKey = getMusicRecommendationItemKey(item);

    return {
        albumKey: getMusicAlbumKeys(item)[0] || '',
        artistKey: getMusicArtistKeys(item)[0] || '',
        familiar: isFamiliarMusicMixItem(item),
        item,
        itemKey,
        score: getMusicMixSeedScore(seed, item) + getMusicMixDiscoveryScore(item),
        tieBreaker: hashMusicMixValue(`${sessionKey}:${itemKey}`)
    };
}

function getConsecutiveMatchCount(
    selected: PtvGeneratedMusicCandidate[],
    value: string,
    key: 'artistKey' | 'albumKey'
) {
    if (!value) return 0;

    let count = 0;

    for (let index = selected.length - 1; index >= 0; index -= 1) {
        const candidate = selected[index];
        const currentValue = key === 'artistKey' ?
            candidate.artistKey :
            candidate.albumKey;

        if (currentValue === value) {
            count += 1;
        } else {
            break;
        }
    }

    return count;
}

function compareGeneratedMusicCandidates(
    left: PtvGeneratedMusicCandidate,
    right: PtvGeneratedMusicCandidate
) {
    return right.score - left.score
        || right.tieBreaker - left.tieBreaker
        || left.itemKey.localeCompare(right.itemKey);
}

function compareDirectSeedCandidates(
    left: PtvGeneratedMusicCandidate,
    right: PtvGeneratedMusicCandidate,
    seed: PtvMusicSeed
) {
    const seedItemKey = seed.item ? getMusicRecommendationItemKey(seed.item) : '';
    const leftIsSeedItem = left.itemKey === seedItemKey;
    const rightIsSeedItem = right.itemKey === seedItemKey;

    if (leftIsSeedItem !== rightIsSeedItem) return leftIsSeedItem ? -1 : 1;

    if (seed.kind === 'album') {
        const leftDisc = Number(left.item.ParentIndexNumber || 0);
        const rightDisc = Number(right.item.ParentIndexNumber || 0);
        const leftTrack = Number(left.item.IndexNumber || 0);
        const rightTrack = Number(right.item.IndexNumber || 0);

        return leftDisc - rightDisc
            || leftTrack - rightTrack
            || compareGeneratedMusicCandidates(left, right);
    }

    return compareGeneratedMusicCandidates(left, right);
}

function selectGeneratedMusicMix(
    items: PtvMusicItem[],
    seed: PtvMusicSeed,
    limit: number,
    sessionKey: string
) {
    const candidates = items
        .map(item => getGeneratedMusicCandidate(item, seed, sessionKey))
        .sort(compareGeneratedMusicCandidates);
    const directSeedCandidate = candidates
        .filter(candidate => isDirectMusicSeedMatch(candidate.item, seed))
        .sort((left, right) => compareDirectSeedCandidates(left, right, seed))[0];
    const selected: PtvGeneratedMusicCandidate[] = [];
    const selectedKeys = new Set<string>();
    const artistCounts = new Map<string, number>();
    const albumCounts = new Map<string, number>();
    const discoveryCandidates = candidates.filter(candidate => !candidate.familiar);
    const discoveryTarget = Math.min(
        discoveryCandidates.length,
        Math.max(1, Math.floor(limit * GENERATED_MIX_DISCOVERY_RATIO))
    );
    const familiarCandidates = candidates.filter(candidate => candidate.familiar);
    const familiarTarget = Math.min(
        familiarCandidates.length,
        Math.max(1, Math.floor(limit * GENERATED_MIX_FAMILIAR_RATIO))
    );
    const artistLimit = seed.kind === 'artist' ?
        Math.max(4, Math.ceil(limit / 2)) :
        Number.MAX_SAFE_INTEGER;
    const enforceArtistRunLimit = seed.kind !== 'artist';
    const enforceAlbumRunLimit = seed.kind !== 'album';
    let discoveryCount = 0;
    let familiarCount = 0;

    /* eslint-disable sonarjs/cognitive-complexity -- Mix concentration policies remain centralized and auditable. */
    const canSelect = (
        candidate: PtvGeneratedMusicCandidate,
        avoidAdjacentArtist: boolean,
        relaxConcentration = false
    ) => {
        if (selectedKeys.has(candidate.itemKey)) return false;
        if (
            !relaxConcentration
            && candidate.artistKey
            && (artistCounts.get(candidate.artistKey) || 0) >= artistLimit
        ) {
            return false;
        }
        if (!relaxConcentration && enforceArtistRunLimit && candidate.artistKey) {
            const consecutiveArtistRun = getConsecutiveMatchCount(
                selected,
                candidate.artistKey,
                'artistKey'
            );

            if (consecutiveArtistRun >= GENERATED_MIX_MAX_CONSECUTIVE_ARTIST_RUN) {
                return false;
            }
        }
        if (!relaxConcentration && candidate.albumKey) {
            const consecutiveAlbumRun = getConsecutiveMatchCount(
                selected,
                candidate.albumKey,
                'albumKey'
            );
            const isInitialSegment = enforceAlbumRunLimit && selected.length < GENERATED_MIX_DISCOVERY_WINDOW;

            if (enforceAlbumRunLimit && consecutiveAlbumRun >= GENERATED_MIX_MAX_CONSECUTIVE_ALBUM_RUN) {
                return false;
            }

            if (
                isInitialSegment
                && (albumCounts.get(candidate.albumKey) || 0) >= GENERATED_MIX_MAX_SEGMENT_ALBUM
            ) {
                return false;
            }
        }

        const previous = selected[selected.length - 1];

        return !avoidAdjacentArtist
            || !previous?.artistKey
            || previous.artistKey !== candidate.artistKey;
    };
    /* eslint-enable sonarjs/cognitive-complexity */
    const addCandidate = (candidate: PtvGeneratedMusicCandidate) => {
        selected.push(candidate);
        selectedKeys.add(candidate.itemKey);
        if (candidate.artistKey) {
            artistCounts.set(candidate.artistKey, (artistCounts.get(candidate.artistKey) || 0) + 1);
        }
        if (candidate.albumKey) {
            albumCounts.set(candidate.albumKey, (albumCounts.get(candidate.albumKey) || 0) + 1);
        }
        if (candidate.familiar) {
            familiarCount += 1;
        } else {
            discoveryCount += 1;
        }
    };
    const findNextCandidate = (
        preference: 'any' | 'discovery' | 'familiar',
        avoidAdjacentArtist: boolean,
        relaxConcentration = false
    ) => (
        candidates.find(candidate => (
            (preference === 'any'
                || (preference === 'discovery' && !candidate.familiar)
                || (preference === 'familiar' && candidate.familiar))
            && canSelect(candidate, avoidAdjacentArtist, relaxConcentration)
        ))
    );

    if (directSeedCandidate) addCandidate(directSeedCandidate);

    while (selected.length < limit) {
        const remainingSlots = limit - selected.length;
        const discoveryNeeded = Math.max(0, discoveryTarget - discoveryCount);
        const familiarNeeded = Math.max(0, familiarTarget - familiarCount);
        const diversitySlotsNeeded = discoveryNeeded + familiarNeeded;
        let preference: 'any' | 'discovery' | 'familiar' = 'any';

        if (remainingSlots <= diversitySlotsNeeded) {
            preference = discoveryNeeded >= familiarNeeded ? 'discovery' : 'familiar';
        } else if (
            familiarNeeded > 0
            && (selected.length + 1) % GENERATED_MIX_FAMILIAR_INTERVAL === 0
        ) {
            preference = 'familiar';
        }

        const nextCandidate = findNextCandidate(preference, true)
            || findNextCandidate(preference, false)
            || findNextCandidate('any', true)
            || findNextCandidate('any', false)
            // Small libraries may not contain enough distinct artists or albums
            // to satisfy every concentration target. Relax concentration only
            // after exhausting all strict candidates; uniqueness remains hard.
            || findNextCandidate(preference, false, true)
            || findNextCandidate('any', false, true);

        if (!nextCandidate) break;

        addCandidate(nextCandidate);
    }

    return selected.map(candidate => candidate.item);
}

function prioritizeAndFilterGeneratedMusicCandidates(
    items: PtvMusicItem[],
    seed: PtvMusicSeed,
    request: PtvMusicPlaylistRequest
) {
    const uniqueItems = uniquePtvMusicItems([
        ...(seed.item && isPlayablePtvMusicTrack(seed.item) ? [seed.item] : []),
        ...items
    ]).filter(isPlayablePtvMusicTrack);
    const directSeedItems = uniqueItems.filter(item => isDirectMusicSeedMatch(item, seed));

    return uniquePtvMusicItems([
        ...directSeedItems,
        ...uniqueItems
    ])
        .filter(item => !shouldExcludePtvRecommendationItem(item, request.feedback, {
            excludeCompleted: false
        }))
        .slice(0, MAX_GENERATED_MIX_CANDIDATES);
}

function shouldFetchGeneratedMusicFallback(
    candidates: PtvMusicItem[],
    seed: PtvMusicSeed,
    limit: number
) {
    const directSeedRequired = ['album', 'artist', 'genre', 'song'].includes(seed.kind);

    return candidates.length < limit
        || (directSeedRequired && !candidates.some(item => isDirectMusicSeedMatch(item, seed)));
}

function getGeneratedMusicFallbackQuery(seed: PtvMusicSeed) {
    if (seed.kind === 'album') {
        const seedType = normalizeMusicMixValue(seed.item?.Type);
        const parentId = seedType === 'musicalbum' ?
            seed.item?.Id :
            seed.item?.AlbumId || seed.id;

        if (parentId) {
            return {
                ParentId: parentId,
                SortBy: 'ParentIndexNumber,IndexNumber,SortName',
                SortOrder: 'Ascending'
            };
        }
    }

    return {
        SortBy: 'DatePlayed,PlayCount,SortName',
        SortOrder: 'Ascending'
    };
}

export async function buildPtvMusicRecommendations(
    request: PtvMusicPlaylistRequest
): Promise<PtvMusicPlaylistResult> {
    throwIfPtvMusicMixRetired(request);
    const { getPtvMusicHome, fetchPtvMusicTracksForGenerator } = await import('./musicApi');

    throwIfPtvMusicMixRetired(request);
    const homeData = await getPtvMusicHome({
        isCurrent: request.isCurrent,
        signal: request.signal
    });

    throwIfPtvMusicMixRetired(request);
    const limit = getGeneratedMusicMixLimit(request.limit);
    const seed = getDefaultMusicSeed(request.seed);
    const homeItems = homeData.sections.flatMap(section => section.items);
    let candidates = prioritizeAndFilterGeneratedMusicCandidates(homeItems, seed, request);

    if (shouldFetchGeneratedMusicFallback(candidates, seed, limit)) {
        const fallbackLimit = Math.min(MAX_GENERATED_MIX_LIMIT, Math.max(48, limit * 2));
        let fallbackItems: PtvMusicItem[] = [];

        throwIfPtvMusicMixRetired(request);
        try {
            fallbackItems = await fetchPtvMusicTracksForGenerator(
                getGeneratedMusicFallbackQuery(seed),
                fallbackLimit,
                request.signal
            );
        } catch (error) {
            throwIfPtvMusicMixRetired(request);
            if (isPtvMusicMixAbortError(error)) throw error;
        }
        throwIfPtvMusicMixRetired(request);
        candidates = prioritizeAndFilterGeneratedMusicCandidates([
            ...candidates,
            ...fallbackItems
        ], seed, request);
    }

    throwIfPtvMusicMixRetired(request);
    const items = selectGeneratedMusicMix(
        candidates,
        seed,
        limit,
        getMusicMixSessionKey(request, seed)
    );

    throwIfPtvMusicMixRetired(request);
    const name = request.name || (seed.label ? `${seed.label} Mix` : 'PiggieTV Music Mix');

    return {
        description: request.prompt || `A PiggieTV music mix built from ${seed.label || seed.kind}.`,
        items,
        name,
        seed
    };
}
