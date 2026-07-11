import type {
    PtvRecommendationItem,
    PtvRecommendationReason,
    PtvRecommendationRunOptions,
    PtvRecommendationScore,
    PtvTasteCategory,
    PtvTasteProfile,
    PtvTasteSignal
} from '../types/recommendationTypes';
import {
    getRecommendationMetadata,
    getRecommendationTitle,
    normalizeRecommendationTerm,
    titleCaseTerm
} from './metadata';

const AFFINITY_RATIO = 0.7;
const DISCOVERY_RATIO = 0.3;
const MAX_NORMALIZED_SCORE = 96;
const MIN_NORMALIZED_SCORE = 24;
const CATEGORY_WEIGHTS: Partial<Record<PtvTasteCategory, number>> = {
    actors: 0.55,
    artists: 1,
    authors: 1,
    bookGenres: 1,
    collections: 0.8,
    decades: 0.35,
    directors: 0.7,
    genres: 1,
    mediaTypes: 0.3,
    musicGenres: 1,
    series: 0.7,
    studios: 0.75,
    tags: 0.6
};
const CROSS_MEDIA_EXPANSIONS: Record<string, string[]> = {
    anime: ['Manga', 'Japanese', 'Mecha', 'Shonen', 'Supernatural', 'Dark Fantasy'],
    disney: ['Animation', 'Family', 'Musical', 'Pixar', 'Marvel', 'Star Wars'],
    fantasy: ['Magic', 'Dark Fantasy', 'Adventure', 'Anime', 'Manga', 'Comics'],
    gothic: ['Horror', 'Vampire', 'Dark Fantasy', 'Metal', 'Supernatural'],
    horror: ['Supernatural', 'Vampire', 'Zombie', 'Gothic', 'Dark Fantasy', 'Metal'],
    metal: ['Metalcore', 'Gothic', 'Horror', 'Dark Fantasy', 'Anime', 'Vampire'],
    metalcore: ['Metal', 'Gothic', 'Horror', 'Dark Fantasy', 'Anime'],
    'science fiction': ['Sci Fi', 'Cyberpunk', 'Space', 'Alien', 'Robot', 'Dystopian'],
    'sci fi': ['Science Fiction', 'Cyberpunk', 'Space', 'Alien', 'Robot', 'Dystopian'],
    superhero: ['Comics', 'Action', 'Animation', 'Marvel', 'DC'],
    vampire: ['Horror', 'Gothic', 'Dark Fantasy', 'Metal', 'Supernatural']
};

function getSignal(profile: PtvTasteProfile, category: PtvTasteCategory, value: string): PtvTasteSignal | null {
    const normalized = normalizeRecommendationTerm(value);

    switch (category) {
        case 'actors':
            return profile.favoriteActors[normalized] || null;
        case 'artists':
            return profile.favoriteArtists[normalized] || null;
        case 'authors':
            return profile.favoriteAuthors[normalized] || null;
        case 'bookGenres':
            return profile.favoriteBookGenres[normalized] || profile.crossMediaTerms[normalized] || null;
        case 'collections':
            return profile.favoriteCollections[normalized] || null;
        case 'decades':
            return profile.favoriteDecades[normalized] || null;
        case 'directors':
            return profile.favoriteDirectors[normalized] || null;
        case 'genres':
            return profile.favoriteGenres[normalized] || profile.crossMediaTerms[normalized] || null;
        case 'mediaTypes':
            return profile.mediaTypes[normalized] || null;
        case 'musicGenres':
            return profile.favoriteMusicGenres[normalized] || profile.crossMediaTerms[normalized] || null;
        case 'series':
            return profile.favoriteSeries[normalized] || null;
        case 'studios':
            return profile.favoriteStudios[normalized] || null;
        case 'tags':
            return profile.crossMediaTerms[normalized] || null;
        default:
            return null;
    }
}

function getCrossMediaSignals(profile: PtvTasteProfile, terms: string[]) {
    const reasons: PtvRecommendationReason[] = [];
    const normalizedTerms = new Set(terms.map(normalizeRecommendationTerm));

    Object.values(profile.crossMediaTerms).forEach(signal => {
        const expansions = CROSS_MEDIA_EXPANSIONS[normalizeRecommendationTerm(signal.label)] || [];
        const matched = expansions.find(term => normalizedTerms.has(normalizeRecommendationTerm(term)));

        if (!matched) return;

        reasons.push({
            category: 'cross-media',
            label: `${signal.label} -> ${titleCaseTerm(matched)}`,
            score: Math.round(signal.score * 0.45)
        });
    });

    return reasons;
}

function getDiscoveryWeight(item: PtvRecommendationItem, now = Date.now()) {
    const userData = item.UserData || {};
    const playCount = Number(userData.PlayCount || 0);
    const createdAt = Date.parse(String(item.DateCreated || ''));
    const ageDays = Number.isFinite(createdAt) ? (now - createdAt) / 86400000 : 9999;
    const hiddenGem = !userData.IsFavorite && playCount <= 1;
    const newlyAdded = ageDays <= 45;
    const unfinished = Boolean(userData.PlaybackPositionTicks) && userData.Played !== true;

    return Math.min(100,
        (hiddenGem ? 44 : 18)
        + (newlyAdded ? 34 : 0)
        + (unfinished ? 16 : 0)
        + (playCount === 0 ? 18 : 0));
}

function getItemAlreadyConsumed(item: PtvRecommendationItem) {
    const userData = item.UserData || {};

    return Boolean(userData.Played || Number(userData.PlayCount || 0) > 3);
}

function getStableScoreKey(item: PtvRecommendationItem) {
    return [
        item.Id,
        item.ProviderIds?.Imdb,
        item.ProviderIds?.Tmdb,
        item.ProviderIds?.Tvdb,
        item.ProviderIds?.MusicBrainzTrackId,
        item.ProviderIds?.MusicBrainzAlbum,
        item.ProviderIds?.MusicBrainzArtist,
        getRecommendationTitle(item)
    ].find(Boolean) || 'recommendation-item';
}

function stableHash(value: string) {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
}

function getDiminishedAffinityScore(reasons: PtvRecommendationReason[]) {
    if (!reasons.length) return 0;

    const weighted = reasons
        .slice()
        .sort((left, right) => right.score - left.score)
        .reduce((total, reason, index) => {
            const weight = index === 0 ? 1 : Math.max(0.08, 0.68 ** index);

            return total + (reason.score * weight);
        }, 0);
    const curved = 100 * (1 - Math.exp(-weighted / 118));

    return Math.min(MAX_NORMALIZED_SCORE, Math.round(curved));
}

function getAffinityReasons(profile: PtvTasteProfile, item: PtvRecommendationItem) {
    const metadata = getRecommendationMetadata(item);
    const reasons: PtvRecommendationReason[] = [];
    const allTerms: string[] = [];

    Object.entries(metadata.categories).forEach(([category, values]) => {
        (values || []).forEach(value => {
            allTerms.push(value);
            const signal = getSignal(profile, category as PtvTasteCategory, value);

            if (!signal) return;

            const score = Math.round(signal.score * (CATEGORY_WEIGHTS[category as PtvTasteCategory] || 0.4));

            reasons.push({
                category: category as PtvTasteCategory,
                label: signal.label,
                score,
                source: Object.entries(signal.sources)
                    .sort((left, right) => right[1] - left[1])[0]?.[0] as PtvRecommendationReason['source']
            });
        });
    });

    return [
        ...reasons,
        ...getCrossMediaSignals(profile, allTerms)
    ].sort((left, right) => right.score - left.score);
}

export function scorePtvRecommendationItem(
    profile: PtvTasteProfile,
    item: PtvRecommendationItem,
    options: PtvRecommendationRunOptions = {}
): PtvRecommendationScore {
    const metadata = getRecommendationMetadata(item);
    const affinityReasons = getAffinityReasons(profile, item);
    const affinityScore = getDiminishedAffinityScore(affinityReasons);
    const discoveryWeight = getDiscoveryWeight(item, options.now);
    const consumedPenalty = getItemAlreadyConsumed(item) ? 0.82 : 1;
    const score = Math.round(((affinityScore * AFFINITY_RATIO) + (discoveryWeight * DISCOVERY_RATIO)) * consumedPenalty);
    const discoveryReason: PtvRecommendationReason = {
        category: 'discovery',
        label: discoveryWeight >= 60 ? 'Fresh or underplayed library item' : 'Controlled discovery',
        score: discoveryWeight
    };

    return {
        affinityScore,
        discoveryWeight,
        item,
        mediaType: metadata.mediaType,
        reasons: affinityReasons.length ? affinityReasons.slice(0, 5) : [discoveryReason],
        score,
        source: affinityReasons[0]?.label || discoveryReason.label
    };
}

function normalizeScoreSpread(scores: PtvRecommendationScore[]) {
    if (!scores.length) return scores;

    const sortedByRawScore = scores
        .slice()
        .sort((left, right) => right.score - left.score || getRecommendationTitle(left.item).localeCompare(getRecommendationTitle(right.item)));
    const minScore = Math.min(...sortedByRawScore.map(entry => entry.score));
    const maxScore = Math.max(...sortedByRawScore.map(entry => entry.score));
    const scoreRange = Math.max(1, maxScore - minScore);
    const usedScores = new Map<number, number>();

    return sortedByRawScore
        .map((entry, index) => {
            const ratio = (entry.score - minScore) / scoreRange;
            const curvedRatio = Math.pow(ratio, 0.82);
            const deterministicJitter = (stableHash(String(getStableScoreKey(entry.item))) % 200) / 100;
            const rankEase = Math.min(9, index * 0.12);
            const normalized = Math.round(
                MIN_NORMALIZED_SCORE
                + (curvedRatio * (MAX_NORMALIZED_SCORE - MIN_NORMALIZED_SCORE))
                + deterministicJitter
                - rankEase
            );
            const clamped = Math.max(1, Math.min(MAX_NORMALIZED_SCORE, normalized));
            const usedCount = usedScores.get(clamped) || 0;
            const spreadScore = Math.max(1, clamped - Math.min(usedCount, 6));

            usedScores.set(clamped, usedCount + 1);

            return {
                ...entry,
                score: spreadScore
            };
        })
        .sort((left, right) => right.score - left.score || getRecommendationTitle(left.item).localeCompare(getRecommendationTitle(right.item)));
}

export function scorePtvRecommendationCandidates(
    profile: PtvTasteProfile,
    items: PtvRecommendationItem[],
    options: PtvRecommendationRunOptions = {}
) {
    const seen = new Set<string>();

    const scoredItems = items
        .filter(item => {
            const id = String(item.Id || getRecommendationTitle(item));

            if (seen.has(id)) return false;

            seen.add(id);
            return true;
        })
        .map(item => scorePtvRecommendationItem(profile, item, options))
        .filter(entry => entry.score > 0);

    return normalizeScoreSpread(scoredItems);
}

export function getPtvRecommendationScoreModel() {
    return {
        affinityRatio: AFFINITY_RATIO,
        categoryWeights: CATEGORY_WEIGHTS,
        crossMediaExpansions: CROSS_MEDIA_EXPANSIONS,
        discoveryRatio: DISCOVERY_RATIO
    };
}
