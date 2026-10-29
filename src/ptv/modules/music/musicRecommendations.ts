import type {
    PtvMusicItem,
    PtvMusicPlaylistRequest,
    PtvMusicPlaylistResult,
    PtvMusicRelatedOptions,
    PtvMusicSeed
} from './musicTypes';
import { recordPtvEvent } from '../../core/observability';
import { getCurrentPtvPluginApiClient } from '../../core/pluginApi';
import {
    isPtvRecommendationPolicyResponse,
    PTV_RECOMMENDATION_ALGORITHM_ID,
    PTV_RECOMMENDATION_POLICY_CONTRACT_VERSION,
    PTV_RECOMMENDATION_POLICY_VERSION,
    PTV_RECOMMENDATION_SURFACE_POLICIES,
    type PtvRecommendationPolicyRequest,
    type PtvRecommendationPolicyConstraints,
    type PtvRecommendationSurface
} from '../../core/recommendations/recommendationPolicyContracts';
import { shouldExcludePtvRecommendationItem } from '../recommendations/feedback/recommendationFeedback';
import { isPlayablePtvMusicTrack } from './musicPlaybackItem';
import { getPtvCurrentUserId, getPtvServerId } from '../../api';

const DEFAULT_TRACK_LIMIT = 28;
const DEFAULT_GENERATED_MIX_LIMIT = 50;
const MAX_GENERATED_MIX_LIMIT = 100;
const MAX_GENERATED_MIX_CANDIDATES = 300;
const GENERATED_MIX_TRANSITION_WINDOW = 18;
const MADE_FOR_YOU_DISCOVERY_RATIO = PTV_RECOMMENDATION_SURFACE_POLICIES['made-for-you'].discoveryTarget;
const RADIO_DISCOVERY_RATIO = PTV_RECOMMENDATION_SURFACE_POLICIES.radio.discoveryTarget;
const RELATED_DISCOVERY_RATIO = PTV_RECOMMENDATION_SURFACE_POLICIES.related.discoveryTarget;
const DISCOVERY_SURFACE_DISCOVERY_RATIO = PTV_RECOMMENDATION_SURFACE_POLICIES.discovery.discoveryTarget;
const MUSIC_RECOMMENDATION_POLICY_TIMEOUT_MS = 800;

const MUSIC_MOOD_TERMS: Record<string, string[]> = {
    chill: [ 'ambient', 'acoustic', 'chillout', 'downtempo', 'jazz', 'lofi', 'lounge', 'mellow', 'soft' ],
    commute: [ 'alternative', 'country', 'electronic', 'indie', 'pop', 'rock', 'synthwave' ],
    discovery: [],
    drive: [ 'alternative', 'country', 'electronic', 'indie', 'pop', 'rock', 'synthwave' ],
    driving: [ 'alternative', 'country', 'electronic', 'indie', 'pop', 'rock', 'synthwave' ],
    focus: [ 'ambient', 'classical', 'instrumental', 'lofi', 'minimal', 'post rock', 'soundtrack' ],
    party: [ 'dance', 'disco', 'electronic', 'funk', 'hip hop', 'house', 'latin', 'pop', 'r&b' ],
    relax: [ 'ambient', 'acoustic', 'chillout', 'downtempo', 'jazz', 'lofi', 'lounge', 'mellow', 'soft' ],
    relaxing: [ 'ambient', 'acoustic', 'chillout', 'downtempo', 'jazz', 'lofi', 'lounge', 'mellow', 'soft' ],
    romance: [ 'acoustic', 'jazz', 'love', 'pop', 'r&b', 'romantic', 'soul' ],
    romantic: [ 'acoustic', 'jazz', 'love', 'pop', 'r&b', 'romantic', 'soul' ],
    sleep: [ 'ambient', 'classical', 'drone', 'instrumental', 'meditation', 'new age', 'sleep' ],
    workout: [ 'dance', 'electronic', 'hard rock', 'hip hop', 'metal', 'metalcore', 'punk', 'rock' ]
};
const MUSIC_PROMPT_STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'build',
    'create',
    'discovery',
    'for',
    'from',
    'make',
    'me',
    'mix',
    'music',
    'my',
    'of',
    'only',
    'playlist',
    'please',
    'piggietv',
    'radio',
    'song',
    'songs',
    'smart',
    'station',
    'the',
    'this',
    'track',
    'tracks',
    'with'
]);
const MUSIC_PROMPT_PHRASES = [
    'alternative rock',
    'drum and bass',
    'hard rock',
    'hip hop',
    'lo fi',
    'new age',
    'post rock',
    'progressive metal',
    'r&b',
    'synth pop'
];
const MUSIC_QUALITY_CODECS = [ 'aac', 'alac', 'flac', 'mp3', 'opus', 'wav' ];

type PtvMusicMixIntent = Readonly<{
    affinityTerms: string[];
    promptTerms: string[];
    requestedCodec: string;
}>;

type PtvMusicMixPolicy = Readonly<{
    discoveryRatio: number;
    surface: PtvRecommendationSurface;
}>;

type PtvMusicPluginStatus = Readonly<{
    featureFlags?: Record<string, boolean>;
    features?: Record<string, boolean> | string[];
}>;

type PtvMusicPolicyRankResult = Readonly<{
    fallbackReason: string;
    items: PtvMusicItem[] | null;
    source: 'local-v2' | 'plugin-v2';
}>;

type PtvMusicPolicyClientResult = Readonly<{
    client: NonNullable<ReturnType<typeof getCurrentPtvPluginApiClient>> | null;
    fallbackReason: string;
}>;

type PtvMusicPolicyTimedResult<T> =
    | Readonly<{ status: 'resolved'; value: T }>
    | Readonly<{ status: 'rejected' }>
    | Readonly<{ status: 'timed-out' }>;

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
    const audioStream = (item.MediaSources || [])
        .flatMap(source => source.MediaStreams || [])
        .find(stream => String(stream.Type || '').toLowerCase() === 'audio');

    return String(
        audioStream?.Codec
        || item.Container
        || item.MediaSources?.[0]?.Container
        || ''
    ).toLowerCase();
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
    blockedKeys: Set<string>,
    constraints: PtvRecommendationPolicyConstraints
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

        if (
            blockedKeys.has(itemKey)
            || (artistCounts.get(artistKey) || 0) >= constraints.maxItemsPerArtist
            || (albumKey && (albumCounts.get(albumKey) || 0) >= constraints.maxItemsPerAlbum)
        ) return;

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

    return selectDiverseMusicRecommendationItems(
        entries,
        limit,
        blockedKeys,
        PTV_RECOMMENDATION_SURFACE_POLICIES['made-for-you']
    );
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

    return selectDiverseMusicRecommendationItems(
        entries,
        limit,
        new Set(blockedKeys),
        PTV_RECOMMENDATION_SURFACE_POLICIES.discovery
    );
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

function sequenceMusicSurfaceItems(
    items: PtvMusicItem[],
    constraints: PtvRecommendationPolicyConstraints
) {
    const remaining = items.slice();
    const selected: PtvMusicItem[] = [];

    while (remaining.length) {
        const nextIndex = remaining.findIndex(item => {
            const artist = getMusicArtist(item).toLowerCase();
            const album = String(item.AlbumId || item.Album || '').toLowerCase();
            const artistRun = artist ? selected.slice(-constraints.maxConsecutiveArtist)
                .filter(previous => getMusicArtist(previous).toLowerCase() === artist).length : 0;
            const albumRun = album ? selected.slice(-constraints.maxConsecutiveAlbum)
                .filter(previous => String(previous.AlbumId || previous.Album || '').toLowerCase() === album).length : 0;

            return artistRun < constraints.maxConsecutiveArtist
                && albumRun < constraints.maxConsecutiveAlbum;
        });

        if (nextIndex < 0) break;
        selected.push(remaining[nextIndex]);
        remaining.splice(nextIndex, 1);
    }

    return selected;
}

function blendMusicSurfaceFamiliarity(
    items: PtvMusicItem[],
    limit: number,
    discoveryRatio: number,
    constraints: PtvRecommendationPolicyConstraints
) {
    const targetLength = Math.min(limit, items.length);
    const discoveryTarget = Math.min(
        items.filter(item => !isFamiliarMusicMixItem(item)).length,
        Math.round(targetLength * discoveryRatio)
    );
    const familiarTarget = Math.min(
        items.filter(isFamiliarMusicMixItem).length,
        targetLength - discoveryTarget
    );
    const familiar = items.filter(isFamiliarMusicMixItem).slice(0, familiarTarget);
    const discovery = items.filter(item => !isFamiliarMusicMixItem(item)).slice(0, discoveryTarget);
    const selectedKeys = new Set([...familiar, ...discovery].map(getMusicRecommendationItemKey));
    const remainder = items.filter(item => !selectedKeys.has(getMusicRecommendationItemKey(item)));
    const selected = [...familiar, ...discovery, ...remainder].slice(0, targetLength);
    const selectedDiscovery = selected.filter(item => !isFamiliarMusicMixItem(item));
    const selectedFamiliar = selected.filter(isFamiliarMusicMixItem);
    const blended: PtvMusicItem[] = [];

    while (blended.length < selected.length) {
        const desiredDiscoveryCount = Math.floor(
            ((blended.length + 1) * selectedDiscovery.length) / Math.max(1, selected.length)
        );
        const currentDiscoveryCount = blended.filter(item => !isFamiliarMusicMixItem(item)).length;
        const next = currentDiscoveryCount < desiredDiscoveryCount ?
            selectedDiscovery.shift() :
            selectedFamiliar.shift() || selectedDiscovery.shift();

        if (!next) break;
        blended.push(next);
    }

    return sequenceMusicSurfaceItems(blended, constraints);
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
    const madeForYou = blendMusicSurfaceFamiliarity(buildMusicAffinityItems(
        seedItems,
        affinityPool.filter(item => !continueKeys.has(getMusicRecommendationItemKey(item))),
        limit * 2
    ), limit, MADE_FOR_YOU_DISCOVERY_RATIO, PTV_RECOMMENDATION_SURFACE_POLICIES['made-for-you']);
    const blockedKeys = new Set([
        ...continueListening,
        ...madeForYou
    ].map(getMusicRecommendationItemKey));
    const recommended = blendMusicSurfaceFamiliarity(
        buildMusicDiscoveryItems(discoveryPool, blockedKeys, limit * 2),
        limit,
        DISCOVERY_SURFACE_DISCOVERY_RATIO,
        PTV_RECOMMENDATION_SURFACE_POLICIES.discovery
    );

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

function getSharedMusicKeyCount(left: string[], right: string[]) {
    const rightKeys = new Set(right);

    return left.filter(key => rightKeys.has(key)).length;
}

function getRelatedTrackAffinityScore(seedItem: PtvMusicItem, item: PtvMusicItem) {
    const artistMatch = getSharedMusicKeyCount(getMusicArtistKeys(seedItem), getMusicArtistKeys(item)) > 0;
    const albumMatch = getSharedMusicKeyCount(getMusicAlbumKeys(seedItem), getMusicAlbumKeys(item)) > 0;
    const seedGenreKeys = getMusicGenreKeys(seedItem);
    const genreStrength = seedGenreKeys.reduce((best, genre) => (
        Math.max(best, getMusicTermMatchScore(genre, getMusicGenreKeys(item)))
    ), 0);
    const seedYear = Number(seedItem.ProductionYear || 0);
    const itemYear = Number(item.ProductionYear || 0);
    const eraMatch = seedYear > 0 && itemYear > 0 && Math.abs(seedYear - itemYear) <= 5;

    return (artistMatch ? 64 : 0)
        + (albumMatch ? 34 : 0)
        + Math.round(genreStrength * 28)
        + (eraMatch ? 5 : 0);
}

function getRelatedTrackScore(seedItem: PtvMusicItem, item: PtvMusicItem) {
    const affinityScore = getRelatedTrackAffinityScore(seedItem, item);

    if (!affinityScore) return 0;

    return affinityScore
        + (item.UserData?.IsFavorite ? 6 : 0)
        + Math.min(8, Math.max(0, Number(item.UserData?.PlayCount || 0)));
}

function getRelatedTrackTransitionScore(previous: PtvMusicItem | undefined, item: PtvMusicItem) {
    if (!previous) return 0;

    const sharedGenres = getSharedMusicKeyCount(getMusicGenreKeys(previous), getMusicGenreKeys(item));
    const previousYear = Number(previous.ProductionYear || 0);
    const itemYear = Number(item.ProductionYear || 0);
    const yearDistance = previousYear > 0 && itemYear > 0 ? Math.abs(previousYear - itemYear) : Number.MAX_SAFE_INTEGER;
    let eraScore = 0;

    if (yearDistance <= 3) {
        eraScore = 8;
    } else if (yearDistance <= 8) {
        eraScore = 4;
    }

    return Math.min(36, sharedGenres * 16)
        + eraScore;
}

function sequenceRelatedMusicTracks(seedItem: PtvMusicItem, items: PtvMusicItem[]) {
    const remaining = items.map(item => ({
        item,
        score: getRelatedTrackScore(seedItem, item)
    }));
    const selected: PtvMusicItem[] = [];

    while (remaining.length) {
        const previous = selected[selected.length - 1];
        const previousArtist = previous ? getMusicArtistKeys(previous)[0] || '' : '';
        const previousAlbum = previous ? getMusicAlbumKeys(previous)[0] || '' : '';
        const previousPrevious = selected[selected.length - 2];
        const previousPreviousArtist = previousPrevious ? getMusicArtistKeys(previousPrevious)[0] || '' : '';
        const previousPreviousAlbum = previousPrevious ? getMusicAlbumKeys(previousPrevious)[0] || '' : '';
        const eligible = remaining.filter(({ item }) => {
            const artist = getMusicArtistKeys(item)[0] || '';
            const album = getMusicAlbumKeys(item)[0] || '';

            return !(artist && artist === previousArtist && artist === previousPreviousArtist)
                && !(album && album === previousAlbum && album === previousPreviousAlbum);
        });

        if (!eligible.length) break;
        eligible.sort((left, right) => {
            const leftScore = left.score + getRelatedTrackTransitionScore(previous, left.item);
            const rightScore = right.score + getRelatedTrackTransitionScore(previous, right.item);

            return rightScore - leftScore
                || getMusicTitle(left.item).localeCompare(getMusicTitle(right.item));
        });
        const next = eligible[0];
        const nextIndex = remaining.indexOf(next);

        selected.push(next.item);
        remaining.splice(nextIndex, 1);
    }

    return selected;
}

export function buildPtvMusicRelatedTracks(
    seedItem: PtvMusicItem,
    options: PtvMusicRelatedOptions = {}
): Promise<PtvMusicItem[]> {
    const seedKey = getMusicRecommendationItemKey(seedItem);
    const limit = options.limit || 24;
    const entries = uniquePtvMusicItems(options.pool || [])
        .filter(isPlayablePtvMusicTrack)
        .filter(item => getMusicRecommendationItemKey(item) !== seedKey)
        .map(item => ({
            affinityScore: getRelatedTrackAffinityScore(seedItem, item),
            item,
            score: getRelatedTrackScore(seedItem, item)
        }))
        .filter(entry => entry.affinityScore > 0)
        .map(({ item, score }) => ({ item, score }));
    const diversePool = selectDiverseMusicRecommendationItems(
        entries,
        entries.length,
        new Set([ seedKey ]),
        PTV_RECOMMENDATION_SURFACE_POLICIES.related
    );
    const familiarTarget = Math.round(limit * (1 - RELATED_DISCOVERY_RATIO));
    const discoveryTarget = Math.max(0, limit - familiarTarget);
    const familiar = diversePool.filter(isFamiliarMusicMixItem).slice(0, familiarTarget);
    const discovery = diversePool.filter(item => !isFamiliarMusicMixItem(item)).slice(0, discoveryTarget);
    const selectedKeys = new Set([...familiar, ...discovery].map(getMusicRecommendationItemKey));
    const pool = [
        ...familiar,
        ...discovery,
        ...diversePool.filter(item => !selectedKeys.has(getMusicRecommendationItemKey(item)))
    ].slice(0, limit);

    return Promise.resolve(sequenceRelatedMusicTracks(seedItem, pool));
}

function getDefaultMusicSeed(seed?: PtvMusicSeed): PtvMusicSeed {
    return seed || {
        kind: 'random',
        label: 'Discovery'
    };
}

type PtvGeneratedMusicCandidate = {
    affinityScore: number;
    albumKey: string;
    artistKey: string;
    directSeedMatch: boolean;
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

function normalizeMusicIntentValue(value: unknown) {
    return normalizeMusicMixValue(value)
        .replace(/[-_]+/g, ' ')
        .replace(/[^a-z0-9&]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getMusicIntentTokens(value: unknown) {
    return normalizeMusicIntentValue(value)
        .split(' ')
        .filter(token => token.length > 1 && !MUSIC_PROMPT_STOP_WORDS.has(token));
}

function hasMusicIntentPhrase(value: string, phrase: string) {
    return ` ${normalizeMusicIntentValue(value)} `.includes(` ${normalizeMusicIntentValue(phrase)} `);
}

function getMusicMoodTerms(values: unknown[]) {
    const normalizedValues = values.map(normalizeMusicIntentValue).filter(Boolean);

    return uniqueMusicMixValues(Object.entries(MUSIC_MOOD_TERMS)
        .filter(([mood]) => normalizedValues.some(value => hasMusicIntentPhrase(value, mood)))
        .flatMap(([, terms]) => terms));
}

function getMusicPromptTerms(prompt: unknown) {
    const normalizedPrompt = normalizeMusicIntentValue(prompt);

    if (!normalizedPrompt) return [];

    const phrases = MUSIC_PROMPT_PHRASES.filter(phrase => hasMusicIntentPhrase(normalizedPrompt, phrase));
    const phraseTokens = new Set(phrases.flatMap(getMusicIntentTokens));
    const tokens = getMusicIntentTokens(normalizedPrompt)
        .filter(token => !phraseTokens.has(token))
        .filter(token => !/^\d+$/.test(token));

    return uniqueMusicMixValues([
        ...phrases,
        ...tokens
    ]);
}

function getRequestedMusicCodec(seed: PtvMusicSeed, prompt?: string) {
    const candidates = [
        seed.kind === 'quality' ? seed.value : '',
        seed.kind === 'quality' ? seed.label : '',
        prompt
    ];

    return MUSIC_QUALITY_CODECS.find(codec => candidates.some(value => (
        getMusicIntentTokens(value).includes(codec)
    ))) || '';
}

function getMusicSeedAffinityTerms(seed: PtvMusicSeed) {
    if (seed.kind !== 'genre' && seed.kind !== 'random') return [];

    const rawTerms = seed.kind === 'genre' ? [ seed.value, seed.label ] : [ seed.value ];

    return uniqueMusicMixValues([
        ...rawTerms,
        ...getMusicMoodTerms(rawTerms)
    ]).filter(term => term !== 'discovery' && term !== 'random');
}

function getMusicMixIntent(request: PtvMusicPlaylistRequest, seed: PtvMusicSeed): PtvMusicMixIntent {
    const promptTerms = getMusicPromptTerms(request.prompt);
    const moodTerms = getMusicMoodTerms([
        request.prompt,
        seed.kind === 'genre' || seed.kind === 'random' ? seed.label : '',
        seed.kind === 'genre' || seed.kind === 'random' ? seed.value : ''
    ]);
    const requestedCodec = getRequestedMusicCodec(seed, request.prompt);
    const affinityTerms = uniqueMusicMixValues([
        ...getMusicSeedAffinityTerms(seed),
        ...promptTerms,
        ...moodTerms
    ]).filter(term => term !== requestedCodec);

    return {
        affinityTerms,
        promptTerms,
        requestedCodec
    };
}

function getGeneratedMusicMixPolicy(seed: PtvMusicSeed, intent: PtvMusicMixIntent): PtvMusicMixPolicy {
    switch (seed.kind) {
        case 'favorites':
            return { discoveryRatio: MADE_FOR_YOU_DISCOVERY_RATIO, surface: 'made-for-you' };
        case 'random':
            return intent.affinityTerms.length ?
                { discoveryRatio: RADIO_DISCOVERY_RATIO, surface: 'radio' } :
                { discoveryRatio: DISCOVERY_SURFACE_DISCOVERY_RATIO, surface: 'discovery' };
        case 'album':
        case 'artist':
        case 'quality':
        case 'song':
        case 'genre':
        case 'recent':
        case 'top':
        default:
            return { discoveryRatio: RADIO_DISCOVERY_RATIO, surface: 'radio' };
    }
}

function hasMusicRecommendationPolicyV2(status: PtvMusicPluginStatus) {
    const featureFlag = Object.entries(status.featureFlags || {})
        .find(([name]) => name.toLowerCase() === 'recommendationpolicyv2')?.[1];

    if (featureFlag !== undefined) return featureFlag;
    if (Array.isArray(status.features)) {
        return status.features.some(name => name.toLowerCase() === 'recommendationpolicyv2');
    }

    return Object.entries(status.features || {})
        .some(([name, enabled]) => name.toLowerCase() === 'recommendationpolicyv2' && enabled);
}

function resolveMusicPolicyWithin<T>(task: Promise<T>): Promise<PtvMusicPolicyTimedResult<T>> {
    return new Promise(resolve => {
        let settled = false;
        const timer = window.setTimeout(() => {
            settled = true;
            resolve({ status: 'timed-out' });
        }, MUSIC_RECOMMENDATION_POLICY_TIMEOUT_MS);

        task.then(value => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve({ status: 'resolved', value });
        }, () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve({ status: 'rejected' });
        });
    });
}

async function getMusicRecommendationPolicyClient(signal?: AbortSignal): Promise<PtvMusicPolicyClientResult> {
    const client = getCurrentPtvPluginApiClient();

    if (!client) return { client: null, fallbackReason: 'plugin-client-unavailable' };

    const statusResult = await resolveMusicPolicyWithin(client.getStatus<PtvMusicPluginStatus>({ signal }));

    if (statusResult.status === 'timed-out') {
        return { client: null, fallbackReason: 'plugin-status-timeout' };
    }
    if (statusResult.status === 'rejected') {
        return { client: null, fallbackReason: 'plugin-status-failed' };
    }
    if (!hasMusicRecommendationPolicyV2(statusResult.value)) {
        return { client: null, fallbackReason: 'plugin-policy-unavailable' };
    }

    return { client, fallbackReason: 'none' };
}

function getMusicPolicyArtistIds(item: PtvMusicItem) {
    return uniqueMusicMixValues([
        ...(item.ArtistItems || []).flatMap(artist => [ artist.Id, artist.Name ]),
        ...(item.Artists || []),
        item.AlbumArtist,
        item.Artist
    ]);
}

function getMusicPolicySeed(seed: PtvMusicSeed, intent: PtvMusicMixIntent) {
    const seedItem = seed.item;

    return {
        albumId: String(seedItem?.AlbumId || (seed.kind === 'album' ? seedItem?.Id || seed.id : '') || '') || undefined,
        artistIds: uniqueMusicMixValues([
            ...(seedItem ? getMusicPolicyArtistIds(seedItem) : []),
            seed.kind === 'artist' ? seedItem?.Id || seed.id : ''
        ]),
        genres: uniqueMusicMixValues([
            ...(seedItem?.Genres || []),
            seed.kind === 'genre' ? seed.value || seed.label : '',
            ...intent.affinityTerms.slice(0, 12)
        ]).slice(0, 12),
        id: getMusicRecommendationItemKey(seedItem || ({
            Id: seed.id || seed.value || seed.label || seed.kind
        } as PtvMusicItem))
    };
}

async function rankGeneratedMusicMixWithPlugin(
    clientResult: PtvMusicPolicyClientResult,
    candidates: PtvMusicItem[],
    seed: PtvMusicSeed,
    intent: PtvMusicMixIntent,
    request: PtvMusicPlaylistRequest,
    limit: number,
    sessionKey: string
): Promise<PtvMusicPolicyRankResult> {
    if (!clientResult.client) {
        return {
            fallbackReason: clientResult.fallbackReason,
            items: null,
            source: 'local-v2'
        };
    }

    const policy = getGeneratedMusicMixPolicy(seed, intent);
    const policySeed = getMusicPolicySeed(seed, intent);

    if (
        policy.surface === 'radio'
        && !policySeed.albumId
        && !policySeed.artistIds.length
        && !policySeed.genres.length
    ) {
        return {
            fallbackReason: 'plugin-seed-affinity-unavailable',
            items: null,
            source: 'local-v2'
        };
    }

    const candidateById = new Map(candidates.map(item => [ getMusicRecommendationItemKey(item), item ]));
    const policyRequest: PtvRecommendationPolicyRequest = {
        algorithmId: PTV_RECOMMENDATION_ALGORITHM_ID,
        candidates: candidates.map(item => {
            const itemKey = getMusicRecommendationItemKey(item);
            const candidate = getGeneratedMusicCandidate(item, seed, intent, sessionKey);

            return {
                albumId: String(item.AlbumId || item.Album || '') || undefined,
                artistIds: getMusicPolicyArtistIds(item),
                baseScore: candidate.score,
                classification: candidate.familiar ? 'affinity' : 'discovery',
                familiar: candidate.familiar,
                genres: uniqueMusicMixValues(item.Genres || []),
                id: itemKey,
                mediaType: String(item.MediaType || item.Type || 'Audio'),
                source: 'jellyfin-music-library',
                title: getMusicTitle(item)
            };
        }),
        cohort: 'music-premium',
        contractVersion: PTV_RECOMMENDATION_POLICY_CONTRACT_VERSION,
        limit,
        policyVersion: PTV_RECOMMENDATION_POLICY_VERSION,
        requestId: `music-${hashMusicMixValue(sessionKey).toString(16)}`,
        seed: policySeed,
        serverId: clientResult.client.getCurrentServerId?.() || 'current-server',
        surface: policy.surface,
        userId: clientResult.client.getCurrentUserId() || 'current-user'
    };
    const rankedResult = await resolveMusicPolicyWithin(
        clientResult.client.rankRecommendations(policyRequest, { signal: request.signal })
    );

    if (
        rankedResult.status !== 'resolved'
        || !isPtvRecommendationPolicyResponse(rankedResult.value, {
            requestId: policyRequest.requestId,
            surface: policyRequest.surface
        })
    ) {
        return {
            fallbackReason: rankedResult.status === 'timed-out' ? 'plugin-rank-timeout' : 'plugin-rank-failed',
            items: null,
            source: 'local-v2'
        };
    }

    const rankedItems = rankedResult.value.items
        .map(item => candidateById.get(item.id.toLowerCase()))
        .filter((item): item is PtvMusicItem => Boolean(item));

    return rankedItems.length ? {
        fallbackReason: rankedResult.value.fallbackReason || 'none',
        items: rankedItems.slice(0, limit),
        source: 'plugin-v2'
    } : {
        fallbackReason: 'plugin-rank-empty',
        items: null,
        source: 'local-v2'
    };
}

function getMusicTermMatchScore(term: string, values: string[]) {
    const normalizedTerm = normalizeMusicIntentValue(term);

    if (!normalizedTerm) return 0;

    const termTokens = new Set(getMusicIntentTokens(normalizedTerm));

    return values.reduce((best, rawValue) => {
        const value = normalizeMusicIntentValue(rawValue);

        if (!value) return best;
        if (value === normalizedTerm) return Math.max(best, 1);
        if (hasMusicIntentPhrase(value, normalizedTerm) || hasMusicIntentPhrase(normalizedTerm, value)) {
            return Math.max(best, 0.78);
        }

        const valueTokens = getMusicIntentTokens(value);
        const sharedTokens = valueTokens.filter(token => termTokens.has(token)).length;
        const denominator = Math.max(1, Math.min(valueTokens.length, termTokens.size));

        return Math.max(best, sharedTokens ? (sharedTokens / denominator) * 0.58 : 0);
    }, 0);
}

function getMusicMixIntentScore(intent: PtvMusicMixIntent, item: PtvMusicItem) {
    if (!intent.affinityTerms.length) return 0;

    const genresAndTags = getMusicGenreKeys(item);
    const artists = getMusicArtistKeys(item);
    const albums = getMusicAlbumKeys(item);
    const titles = uniqueMusicMixValues([ item.Name, item.SortName, item.MusicBrainzTitle ]);

    return Math.min(360, Math.round(intent.affinityTerms.reduce((total, term) => {
        const metadataMatch = getMusicTermMatchScore(term, genresAndTags) * 110;
        const artistMatch = getMusicTermMatchScore(term, artists) * 125;
        const albumMatch = getMusicTermMatchScore(term, albums) * 90;
        const titleMatch = getMusicTermMatchScore(term, titles) * 70;

        return total + Math.max(metadataMatch, artistMatch, albumMatch, titleMatch);
    }, 0)));
}

function matchesRequestedMusicCodec(item: PtvMusicItem, requestedCodec: string) {
    return !requestedCodec || getMusicCodec(item).includes(requestedCodec);
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
        case 'genre': {
            const genreTerms = uniqueMusicMixValues([
                ...seedKeys,
                ...getMusicSeedAffinityTerms(seed)
            ]);

            return genreTerms.some(term => getMusicTermMatchScore(term, getMusicGenreKeys(item)) >= 0.58);
        }
        case 'quality': {
            const requestedCodec = getRequestedMusicCodec(seed);

            return requestedCodec ?
                matchesRequestedMusicCodec(item, requestedCodec) :
                [ 'flac', 'opus' ].some(codec => getMusicCodec(item).includes(codec));
        }
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
            return score + (isDirectMusicSeedMatch(item, seed) ? 120 : 0);
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
    intent: PtvMusicMixIntent,
    sessionKey: string
): PtvGeneratedMusicCandidate {
    const itemKey = getMusicRecommendationItemKey(item);
    const directSeedMatch = isDirectMusicSeedMatch(item, seed);
    const intentScore = getMusicMixIntentScore(intent, item);
    const seedScore = getMusicMixSeedScore(seed, item);

    return {
        affinityScore: seedScore + intentScore,
        albumKey: getMusicAlbumKeys(item)[0] || '',
        artistKey: getMusicArtistKeys(item)[0] || '',
        directSeedMatch,
        familiar: isFamiliarMusicMixItem(item),
        item,
        itemKey,
        score: seedScore + intentScore + getMusicMixDiscoveryScore(item),
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

function getGeneratedMusicTransitionScore(
    previous: PtvGeneratedMusicCandidate | undefined,
    candidate: PtvGeneratedMusicCandidate
) {
    if (!previous) return 0;

    const sharedGenres = getSharedMusicKeyCount(
        getMusicGenreKeys(previous.item),
        getMusicGenreKeys(candidate.item)
    );
    const previousYear = Number(previous.item.ProductionYear || 0);
    const candidateYear = Number(candidate.item.ProductionYear || 0);
    const yearDistance = previousYear > 0 && candidateYear > 0 ?
        Math.abs(previousYear - candidateYear) :
        Number.MAX_SAFE_INTEGER;
    let eraScore = 0;

    if (yearDistance <= 3) {
        eraScore = 8;
    } else if (yearDistance <= 8) {
        eraScore = 4;
    }

    return Math.min(42, sharedGenres * 18)
        + eraScore
        + (previous.artistKey && previous.artistKey === candidate.artistKey ? 5 : 0)
        + (previous.albumKey && previous.albumKey === candidate.albumKey ? 3 : 0);
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- Mix sequencing keeps concentration, familiarity, discovery, and transition policy in one auditable selector.
function selectGeneratedMusicMix(
    items: PtvMusicItem[],
    seed: PtvMusicSeed,
    intent: PtvMusicMixIntent,
    limit: number,
    sessionKey: string
) {
    const candidates = items
        .map(item => getGeneratedMusicCandidate(item, seed, intent, sessionKey))
        .sort(compareGeneratedMusicCandidates);
    const directSeedCandidate = candidates
        .filter(candidate => candidate.directSeedMatch)
        .sort((left, right) => compareDirectSeedCandidates(left, right, seed))[0];
    const selected: PtvGeneratedMusicCandidate[] = [];
    const selectedKeys = new Set<string>();
    const artistCounts = new Map<string, number>();
    const albumCounts = new Map<string, number>();
    const policy = getGeneratedMusicMixPolicy(seed, intent);
    const discoveryCandidates = candidates.filter(candidate => !candidate.familiar);
    let discoveryTarget = Math.min(
        discoveryCandidates.length,
        Math.max(1, Math.round(limit * policy.discoveryRatio))
    );
    const familiarCandidates = candidates.filter(candidate => candidate.familiar);
    let familiarTarget = Math.min(
        familiarCandidates.length,
        Math.max(0, limit - discoveryTarget)
    );

    if (discoveryTarget + familiarTarget < limit) {
        discoveryTarget = Math.min(
            discoveryCandidates.length,
            discoveryTarget + (limit - discoveryTarget - familiarTarget)
        );
    }
    if (discoveryTarget + familiarTarget < limit) {
        familiarTarget = Math.min(
            familiarCandidates.length,
            familiarTarget + (limit - discoveryTarget - familiarTarget)
        );
    }
    const constraints = PTV_RECOMMENDATION_SURFACE_POLICIES[policy.surface];
    let discoveryCount = 0;
    let familiarCount = 0;

    const canSelect = (
        candidate: PtvGeneratedMusicCandidate,
        avoidAdjacentArtist: boolean
    ) => {
        if (selectedKeys.has(candidate.itemKey)) return false;
        if (
            candidate.artistKey
            && (artistCounts.get(candidate.artistKey) || 0) >= constraints.maxItemsPerArtist
        ) {
            return false;
        }
        if (candidate.artistKey) {
            const consecutiveArtistRun = getConsecutiveMatchCount(
                selected,
                candidate.artistKey,
                'artistKey'
            );

            if (consecutiveArtistRun >= constraints.maxConsecutiveArtist) {
                return false;
            }
        }
        if (candidate.albumKey) {
            const consecutiveAlbumRun = getConsecutiveMatchCount(
                selected,
                candidate.albumKey,
                'albumKey'
            );

            if (consecutiveAlbumRun >= constraints.maxConsecutiveAlbum) {
                return false;
            }
            if ((albumCounts.get(candidate.albumKey) || 0) >= constraints.maxItemsPerAlbum) {
                return false;
            }
        }

        const previous = selected[selected.length - 1];

        return !avoidAdjacentArtist
            || !previous?.artistKey
            || previous.artistKey !== candidate.artistKey;
    };
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
        avoidAdjacentArtist: boolean
    ) => {
        const eligible = candidates.filter(candidate => (
            (preference === 'any'
                || (preference === 'discovery' && !candidate.familiar)
                || (preference === 'familiar' && candidate.familiar))
            && canSelect(candidate, avoidAdjacentArtist)
        )).slice(0, GENERATED_MIX_TRANSITION_WINDOW);
        const previous = selected[selected.length - 1];

        eligible.sort((left, right) => {
            const leftSequenceScore = left.score + getGeneratedMusicTransitionScore(previous, left);
            const rightSequenceScore = right.score + getGeneratedMusicTransitionScore(previous, right);

            return rightSequenceScore - leftSequenceScore
                || compareGeneratedMusicCandidates(left, right);
        });

        return eligible[0];
    };

    if (directSeedCandidate) addCandidate(directSeedCandidate);

    while (selected.length < limit) {
        const remainingSlots = limit - selected.length;
        const discoveryNeeded = Math.max(0, discoveryTarget - discoveryCount);
        const familiarNeeded = Math.max(0, familiarTarget - familiarCount);
        const diversitySlotsNeeded = discoveryNeeded + familiarNeeded;
        const nextPosition = selected.length + 1;
        const desiredDiscoveryByPosition = Math.min(
            discoveryTarget,
            Math.floor((nextPosition * discoveryTarget) / Math.max(1, limit))
        );
        const desiredFamiliarByPosition = Math.min(
            familiarTarget,
            Math.floor(((nextPosition + 1) * familiarTarget) / Math.max(1, limit))
        );
        const discoveryDue = discoveryCount < desiredDiscoveryByPosition;
        const familiarDue = familiarCount < desiredFamiliarByPosition;
        let preference: 'any' | 'discovery' | 'familiar' = 'any';

        if (remainingSlots <= diversitySlotsNeeded) {
            if (discoveryNeeded && familiarNeeded) {
                const discoveryProgress = discoveryTarget ? discoveryCount / discoveryTarget : 1;
                const familiarProgress = familiarTarget ? familiarCount / familiarTarget : 1;

                preference = discoveryProgress <= familiarProgress ? 'discovery' : 'familiar';
            } else {
                preference = discoveryNeeded ? 'discovery' : 'familiar';
            }
        } else if (discoveryDue && familiarDue) {
            const discoveryProgress = discoveryTarget ? discoveryCount / discoveryTarget : 1;
            const familiarProgress = familiarTarget ? familiarCount / familiarTarget : 1;

            preference = discoveryProgress <= familiarProgress ? 'discovery' : 'familiar';
        } else if (discoveryDue) {
            preference = 'discovery';
        } else if (familiarDue) {
            preference = 'familiar';
        }

        const nextCandidate = findNextCandidate(preference, true)
            || findNextCandidate(preference, false)
            || findNextCandidate('any', true)
            || findNextCandidate('any', false);

        if (!nextCandidate) break;

        addCandidate(nextCandidate);
    }

    return selected.map(candidate => candidate.item);
}

function prioritizeAndFilterGeneratedMusicCandidates(
    items: PtvMusicItem[],
    seed: PtvMusicSeed,
    request: PtvMusicPlaylistRequest,
    intent: PtvMusicMixIntent,
    sessionKey: string
) {
    // Only the fresh, explicitly library-scoped response proves membership. Cached Home
    // shelves and the caller's seed DTO may contain items from another Music view.
    const uniqueItems = uniquePtvMusicItems(items)
        .filter(isPlayablePtvMusicTrack)
        .filter(item => matchesRequestedMusicCodec(item, intent.requestedCodec));
    const directSeedItems = uniqueItems.filter(item => isDirectMusicSeedMatch(item, seed));
    const intentItems = uniqueItems.filter(item => getMusicMixIntentScore(intent, item) > 0);
    const seedAffinityItems = uniqueItems.filter(item => getMusicMixSeedScore(seed, item) > 0);
    const hasExplicitPromptMatch = intent.promptTerms.length > 0 && (
        directSeedItems.length > 0 || intentItems.length > 0
    );
    const requiresStrictAffinity = seed.kind !== 'favorites'
        && (seed.kind !== 'random' || intent.affinityTerms.length > 0);

    if (
        (intent.affinityTerms.length > 0 || requiresStrictAffinity)
        && !directSeedItems.length
        && !intentItems.length
        && !seedAffinityItems.length
    ) {
        return [];
    }

    let eligibleItems = uniqueItems;

    if (hasExplicitPromptMatch) {
        eligibleItems = uniquePtvMusicItems([ ...directSeedItems, ...intentItems ]);
    } else if (requiresStrictAffinity && seedAffinityItems.length) {
        eligibleItems = uniquePtvMusicItems([ ...directSeedItems, ...seedAffinityItems ]);
    }

    const eligible = uniquePtvMusicItems([
        ...directSeedItems,
        ...intentItems,
        ...eligibleItems
    ])
        .filter(item => !shouldExcludePtvRecommendationItem(item, request.feedback, {
            excludeCompleted: false
        }));

    if (eligible.length <= MAX_GENERATED_MIX_CANDIDATES) return eligible;

    // Rank *before* the 300-item Plugin boundary. A later library page has the
    // same opportunity as the fresh Home-like page. Existing affinity, discovery,
    // and seed scores still determine relevance. The session key breaks ties in a
    // reproducible way and lets distinct explicit generations vary membership.
    const ranked = eligible
        .map(item => getGeneratedMusicCandidate(item, seed, intent, sessionKey))
        .sort((left, right) => Number(right.directSeedMatch) - Number(left.directSeedMatch)
            || compareGeneratedMusicCandidates(left, right));
    const discoveryTarget = Math.round(
        MAX_GENERATED_MIX_CANDIDATES * getGeneratedMusicMixPolicy(seed, intent).discoveryRatio
    );
    const selected = new Map<string, PtvGeneratedMusicCandidate>();
    const take = (candidates: PtvGeneratedMusicCandidate[], limit: number) => {
        for (const candidate of candidates) {
            if (selected.size >= limit) break;
            selected.set(candidate.itemKey, candidate);
        }
    };

    take(ranked.filter(candidate => candidate.directSeedMatch), MAX_GENERATED_MIX_CANDIDATES);
    take(ranked.filter(candidate => !candidate.familiar), Math.min(
        MAX_GENERATED_MIX_CANDIDATES,
        selected.size + discoveryTarget
    ));
    take(ranked, MAX_GENERATED_MIX_CANDIDATES);

    return Array.from(selected.values(), candidate => candidate.item);
}

export async function buildPtvMusicRecommendations(
    request: PtvMusicPlaylistRequest
): Promise<PtvMusicPlaylistResult> {
    const generationStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ?
        performance.now() :
        Date.now();

    throwIfPtvMusicMixRetired(request);
    const { samplePtvMusicMixCandidates } = await import('./musicApi');
    const limit = getGeneratedMusicMixLimit(request.limit);
    const seed = getDefaultMusicSeed(request.seed);
    const intent = getMusicMixIntent(request, seed);
    const policy = getGeneratedMusicMixPolicy(seed, intent);
    const sessionKey = getMusicMixSessionKey(request, seed);

    recordPtvEvent('recommendation', 'music-recommendation-generation-started', {
        algorithmId: PTV_RECOMMENDATION_ALGORITHM_ID,
        algorithmPolicyId: PTV_RECOMMENDATION_POLICY_VERSION,
        requestedItemCount: limit,
        surface: policy.surface
    });

    throwIfPtvMusicMixRetired(request);
    const sample = await samplePtvMusicMixCandidates({
        affinityGenres: seed.kind === 'genre' || seed.kind === 'random' ? intent.affinityTerms : [],
        isCurrent: request.isCurrent,
        seed,
        sessionSeed: sessionKey,
        signal: request.signal
    });
    const assertCurrentScope = () => {
        throwIfPtvMusicMixRetired(request);
        sample.assertCurrent();
        if (
            getPtvServerId() !== sample.serverId
            || getPtvCurrentUserId(sample.serverId) !== sample.userId
        ) {
            throw createPtvMusicMixAbortError('PiggieTV Music mix identity changed.');
        }
    };

    assertCurrentScope();
    if (
        ['album', 'artist', 'song'].includes(seed.kind)
        && sample.seedVerified !== true
    ) {
        throw new Error('The requested Music mix seed is not verified in the selected library.');
    }
    const candidates = prioritizeAndFilterGeneratedMusicCandidates(
        sample.items,
        seed,
        request,
        intent,
        sessionKey
    );

    assertCurrentScope();
    const localItems = selectGeneratedMusicMix(
        candidates,
        seed,
        intent,
        limit,
        sessionKey
    );
    const policyClientPromise = getMusicRecommendationPolicyClient(request.signal);
    const pluginRank = await rankGeneratedMusicMixWithPlugin(
        await policyClientPromise,
        candidates,
        seed,
        intent,
        request,
        limit,
        sessionKey
    );

    await sample.verifyCurrent();
    assertCurrentScope();
    const items = pluginRank.items || localItems;
    let resultFallbackReason = pluginRank.fallbackReason;

    if (resultFallbackReason === 'none' && !sample.complete) {
        resultFallbackReason = 'sample-partial';
    }
    const familiarCount = items.filter(isFamiliarMusicMixItem).length;
    const discoveryCount = Math.max(0, items.length - familiarCount);

    if (pluginRank.source === 'local-v2') {
        recordPtvEvent('recommendation', 'music-recommendation-policy-fallback', {
            algorithmId: PTV_RECOMMENDATION_ALGORITHM_ID,
            algorithmPolicyId: PTV_RECOMMENDATION_POLICY_VERSION,
            fallbackReason: pluginRank.fallbackReason,
            itemCount: items.length,
            source: pluginRank.source,
            surface: policy.surface
        });
    }

    const name = request.name || (seed.label ? `${seed.label} Mix` : 'PiggieTV Music Mix');
    const generationFinishedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ?
        performance.now() :
        Date.now();

    recordPtvEvent('recommendation', 'music-recommendation-generation-completed', {
        algorithmId: PTV_RECOMMENDATION_ALGORITHM_ID,
        algorithmPolicyId: PTV_RECOMMENDATION_POLICY_VERSION,
        candidateCount: candidates.length,
        discoveryCount,
        fallbackReason: resultFallbackReason,
        fallbackUsed: !sample.complete || pluginRank.source === 'local-v2',
        familiarCount,
        itemCount: items.length,
        latencyMs: Number((generationFinishedAt - generationStartedAt).toFixed(1)),
        source: pluginRank.source,
        sourceItemCount: sample.items.length,
        surface: policy.surface,
        sampleItemCount: sample.items.length,
        sampleReceivedCount: sample.received,
        sampleRequestCount: sample.requests,
        selectedLibraryId: sample.libraryId
    });

    return {
        description: request.prompt || `A PiggieTV music mix built from ${seed.label || seed.kind}.`,
        items,
        name,
        seed
    };
}
