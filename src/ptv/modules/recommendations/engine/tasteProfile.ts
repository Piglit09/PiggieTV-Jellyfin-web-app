import {
    getPtvCurrentUserId,
    getPtvServerId
} from '../../../api';
import type {
    PtvRecommendationInputItem,
    PtvRecommendationRunOptions,
    PtvRecommendationSourceType,
    PtvTasteCategory,
    PtvTasteProfile,
    PtvTasteSignal
} from '../types/recommendationTypes';
import {
    getRecommendationMetadata,
    normalizeRecommendationTerm,
    titleCaseTerm
} from '../scoring/metadata';
import { logPtvRecommendationFailure } from '../debug/recommendationRuntimeDebug';

const PROFILE_VERSION = 1;
const PROFILE_STORAGE_PREFIX = 'ptv.recommendations.profile.v1';
const SOURCE_WEIGHTS: Record<PtvRecommendationSourceType, number> = {
    candidate: 1,
    favorite: 34,
    history: 16,
    'recently-added': 4,
    'recently-viewed': 12,
    resume: 18
};
const CATEGORY_TO_PROFILE_KEY: Record<PtvTasteCategory, keyof PtvTasteProfile> = {
    actors: 'favoriteActors',
    artists: 'favoriteArtists',
    authors: 'favoriteAuthors',
    bookGenres: 'favoriteBookGenres',
    collections: 'favoriteCollections',
    decades: 'favoriteDecades',
    directors: 'favoriteDirectors',
    genres: 'favoriteGenres',
    mediaTypes: 'mediaTypes',
    musicGenres: 'favoriteMusicGenres',
    series: 'favoriteSeries',
    studios: 'favoriteStudios',
    tags: 'crossMediaTerms'
};

function createEmptyProfile(serverId = getPtvServerId() || 'server', userId = getPtvCurrentUserId() || 'user', now = Date.now()): PtvTasteProfile {
    return {
        crossMediaTerms: {},
        favoriteActors: {},
        favoriteArtists: {},
        favoriteAuthors: {},
        favoriteBookGenres: {},
        favoriteCollections: {},
        favoriteDecades: {},
        favoriteDirectors: {},
        favoriteGenres: {},
        favoriteMusicGenres: {},
        favoriteSeries: {},
        favoriteStudios: {},
        mediaTypes: {},
        profileVersion: PROFILE_VERSION,
        serverId,
        sourceCounts: {},
        updatedAt: now,
        userId
    };
}

function getStorageKey(profile: Pick<PtvTasteProfile, 'serverId' | 'userId'>) {
    return `${PROFILE_STORAGE_PREFIX}:${profile.serverId}:${profile.userId}`;
}

function getCompletionRatioWeight(completionRatio: number) {
    if (completionRatio > 0.85) return 6;
    if (completionRatio > 0.35) return 3;

    return 0;
}

function getCompletionWeight(item: PtvRecommendationInputItem) {
    const userData = item.item.UserData || {};
    const runtimeTicks = Number(item.item.RunTimeTicks || 0);
    const positionTicks = Number(userData.PlaybackPositionTicks || 0);
    const playCount = Number(userData.PlayCount || 0);
    const rating = Number(item.item.CommunityRating || 0);
    const completionRatio = runtimeTicks > 0 ? positionTicks / runtimeTicks : 0;

    return Math.min(12, playCount * 2)
        + (userData.Played ? 8 : 0)
        + getCompletionRatioWeight(completionRatio)
        + Math.min(8, rating);
}

function addSignalToBucket(
    bucket: Record<string, PtvTasteSignal>,
    category: PtvTasteCategory,
    label: string,
    score: number,
    source: PtvRecommendationSourceType
) {
    const normalized = normalizeRecommendationTerm(label);

    if (!normalized || score <= 0) return;

    const signal = bucket[normalized] || {
        category,
        count: 0,
        label: titleCaseTerm(normalized),
        score: 0,
        sources: {}
    };

    signal.count += 1;
    signal.score += score;
    signal.sources[source] = (signal.sources[source] || 0) + score;
    bucket[normalized] = signal;

    return normalized;
}

function addSignal(
    profile: PtvTasteProfile,
    category: PtvTasteCategory,
    label: string,
    score: number,
    source: PtvRecommendationSourceType
) {
    const key = CATEGORY_TO_PROFILE_KEY[category];
    const bucket = profile[key] as Record<string, PtvTasteSignal>;
    const normalized = addSignalToBucket(bucket, category, label, score, source);

    if (!normalized) return;

    if (category === 'genres' || category === 'bookGenres' || category === 'musicGenres') {
        addSignalToBucket(profile.crossMediaTerms, category, label, score, source);
    }
}

function addCrossMediaSignal(profile: PtvTasteProfile, label: string, score: number, source: PtvRecommendationSourceType) {
    addSignalToBucket(profile.crossMediaTerms, 'tags', label, score, source);
}

function normalizeSignalScores(bucket: Record<string, PtvTasteSignal>) {
    const maxScore = Math.max(1, ...Object.values(bucket).map(signal => signal.score));

    Object.values(bucket).forEach(signal => {
        signal.score = Math.round((signal.score / maxScore) * 100);
    });
}

function normalizeProfile(profile: PtvTasteProfile, now = Date.now()) {
    [
        profile.crossMediaTerms,
        profile.favoriteActors,
        profile.favoriteArtists,
        profile.favoriteAuthors,
        profile.favoriteBookGenres,
        profile.favoriteCollections,
        profile.favoriteDecades,
        profile.favoriteDirectors,
        profile.favoriteGenres,
        profile.favoriteMusicGenres,
        profile.favoriteSeries,
        profile.favoriteStudios,
        profile.mediaTypes
    ].forEach(normalizeSignalScores);

    profile.updatedAt = now;

    return profile;
}

export function buildPtvTasteProfile(
    items: PtvRecommendationInputItem[],
    options: {
        serverId?: string;
        userId?: string;
    } & PtvRecommendationRunOptions = {}
) {
    const profile = createEmptyProfile(options.serverId, options.userId, options.now);

    items.forEach(input => {
        const metadata = getRecommendationMetadata(input.item);
        const baseScore = SOURCE_WEIGHTS[input.source] + getCompletionWeight(input);

        profile.sourceCounts[input.source] = (profile.sourceCounts[input.source] || 0) + 1;

        Object.entries(metadata.categories).forEach(([category, values]) => {
            (values || []).forEach(value => {
                addSignal(profile, category as PtvTasteCategory, value, baseScore, input.source);
            });
        });

        [
            ...(metadata.categories.genres || []),
            ...(metadata.categories.bookGenres || []),
            ...(metadata.categories.tags || []),
            ...(metadata.categories.studios || []),
            ...(metadata.categories.artists || []),
            ...(metadata.categories.authors || [])
        ].forEach(value => {
            addCrossMediaSignal(profile, value, Math.round(baseScore / 2), input.source);
        });
    });

    return normalizeProfile(profile, options.now);
}

export function savePtvTasteProfile(profile: PtvTasteProfile) {
    try {
        window.localStorage?.setItem(getStorageKey(profile), JSON.stringify(profile));
    } catch (error) {
        logPtvRecommendationFailure('Taste profile save', error, {
            serverId: profile.serverId,
            userId: profile.userId
        });
        // Local storage is a convenience cache; recommendation generation still works without it.
    }
}

export function loadPtvTasteProfile(serverId = getPtvServerId() || 'server', userId = getPtvCurrentUserId() || 'user') {
    try {
        const raw = window.localStorage?.getItem(getStorageKey({ serverId, userId }));
        const parsed = raw ? JSON.parse(raw) as PtvTasteProfile : null;

        return parsed?.profileVersion === PROFILE_VERSION ? parsed : null;
    } catch (error) {
        logPtvRecommendationFailure('Taste profile localStorage read', error, {
            serverId,
            userId
        });
        return null;
    }
}
