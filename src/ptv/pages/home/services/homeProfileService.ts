import { getPtvServerId, type PtvItem, type PtvLibrary, type PtvUser } from '../../../api';
import { getPtvDisplayIdentityKey } from '../../../services/displayIdentity';
import type { NativeHomeRow } from '../hooks';
import { inferNativeHomeMood, type NativeHomeMood, type NativeHomeMoodResult } from './moodInferenceService';
import { getNativeHomeSeasonalContext, type NativeHomeSeasonalContext } from './seasonalContentService';

export type NativeHomeProfile = {
    context: {
        isWeekend: boolean;
        timeOfDay: 'afternoon' | 'evening' | 'morning' | 'night';
    };
    continueCounts: {
        listening: number;
        reading: number;
        watching: number;
    };
    favoriteCount: number;
    mediaCounts: Record<string, number>;
    mood: NativeHomeMood;
    moodConfidence: number;
    moodSignals: string[];
    profileVersion: number;
    seasonal: NativeHomeSeasonalContext;
    serverId: string;
    topArtists: string[];
    topAuthors: string[];
    topGenres: string[];
    topStudios: string[];
    updatedAt: number;
    userId: string;
};

const HOME_PROFILE_VERSION = 2;
const HOME_PROFILE_STORAGE_PREFIX = 'ptv.home.profile.v2';
const MAX_PROFILE_TERMS = 10;

type NativeHomeMaybeItem = PtvItem | PtvLibrary | null | undefined;

function getStorageKey(serverId: string, userId: string) {
    const identityKey = getPtvDisplayIdentityKey(serverId, userId);
    return identityKey ? `${HOME_PROFILE_STORAGE_PREFIX}:${identityKey}` : null;
}

function readString(item: NativeHomeMaybeItem, ...keys: string[]) {
    const record = item as Record<string, unknown> | null | undefined;

    if (!record) return '';

    for (const key of keys) {
        const value = record[key];

        if (typeof value === 'string' && value.trim()) return value.trim();
    }

    return '';
}

function readStringArray(item: NativeHomeMaybeItem, ...keys: string[]) {
    const record = item as Record<string, unknown> | null | undefined;

    if (!record) return [];

    for (const key of keys) {
        const value = record[key];

        if (Array.isArray(value)) {
            return value
                .map(entry => typeof entry === 'string' ? entry.trim() : '')
                .filter(Boolean);
        }
    }

    return [];
}

function getUserData(item: NativeHomeMaybeItem) {
    return (item as PtvItem | null | undefined)?.UserData || {};
}

function addCount(counts: Record<string, number>, label: string, weight = 1) {
    const normalized = label.trim().toLowerCase();

    if (!normalized) return;

    counts[normalized] = (counts[normalized] || 0) + weight;
}

function getTopTerms(counts: Record<string, number>) {
    return Object.entries(counts)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, MAX_PROFILE_TERMS)
        .map(([term]) => term.replace(/\b\w/g, match => match.toUpperCase()));
}

function getTimeOfDay(date: Date): NativeHomeProfile['context']['timeOfDay'] {
    const hour = date.getHours();

    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    if (hour < 22) return 'evening';

    return 'night';
}

export function loadNativeHomeProfile(serverId = getPtvServerId() || '', userId = '') {
    try {
        const storageKey = getStorageKey(serverId, userId);
        const expectedIdentity = getPtvDisplayIdentityKey(serverId, userId);

        if (!storageKey || !expectedIdentity) return null;

        const raw = window.localStorage?.getItem(storageKey);
        const parsed = raw ? JSON.parse(raw) as NativeHomeProfile : null;

        if (
            parsed?.profileVersion === HOME_PROFILE_VERSION
            && getPtvDisplayIdentityKey(parsed.serverId, parsed.userId) === expectedIdentity
        ) return parsed;

        return null;
    } catch {
        return null;
    }
}

export function saveNativeHomeProfile(profile: NativeHomeProfile) {
    try {
        const storageKey = getStorageKey(profile.serverId, profile.userId);
        if (!storageKey) return false;

        window.localStorage?.setItem(storageKey, JSON.stringify(profile));
        return true;
    } catch {
        // Home personalization is an opportunistic cache; rendering must not depend on it.
        return false;
    }
}

export function buildNativeHomeProfile(
    rows: NativeHomeRow[],
    options: {
        now?: Date;
        save?: boolean;
        user?: PtvUser | null;
    } = {}
) {
    const now = options.now || new Date();
    const serverId = getPtvServerId() || '';
    const userId = options.user?.Id || '';
    const genreCounts: Record<string, number> = {};
    const studioCounts: Record<string, number> = {};
    const artistCounts: Record<string, number> = {};
    const authorCounts: Record<string, number> = {};
    const mediaCounts: Record<string, number> = {};
    const continueCounts = {
        listening: 0,
        reading: 0,
        watching: 0
    };
    let favoriteCount = 0;

    rows.forEach(row => {
        const rowText = `${row.id} ${row.source} ${row.title}`.toLowerCase();

        row.items.forEach(item => {
            const itemType = readString(item, 'Type', 'MediaType').toLowerCase();
            const mediaType = readString(item, 'MediaType').toLowerCase();
            const mediaKey = itemType || mediaType || 'unknown';
            const userData = getUserData(item);
            const resumeWeight = userData.PlaybackPositionTicks ? 2 : 1;

            addCount(mediaCounts, mediaKey, resumeWeight);

            readStringArray(item, 'Genres', 'Tags').forEach(genre => addCount(genreCounts, genre, resumeWeight));
            readStringArray(item, 'Studios').forEach(studio => addCount(studioCounts, studio, resumeWeight));
            readStringArray(item, 'Artists').forEach(artist => addCount(artistCounts, artist, resumeWeight));
            readStringArray(item, 'AlbumArtists').forEach(artist => addCount(artistCounts, artist, resumeWeight));
            readStringArray(item, 'Authors').forEach(author => addCount(authorCounts, author, resumeWeight));

            if (userData.IsFavorite) favoriteCount += 1;

            if (/reading/.test(rowText) || itemType === 'book') continueCounts.reading += userData.PlaybackPositionTicks ? 1 : 0;
            if (/listening/.test(rowText) || mediaType === 'audio' || itemType === 'audio') continueCounts.listening += userData.PlaybackPositionTicks ? 1 : 0;
            if (/watching|resume/.test(rowText) || mediaType === 'video') continueCounts.watching += userData.PlaybackPositionTicks ? 1 : 0;

            if (readString(item, 'CollectionType').toLowerCase() === 'books') {
                continueCounts.reading += userData.PlaybackPositionTicks ? 1 : 0;
            }
        });
    });

    const context = {
        isWeekend: [0, 6].includes(now.getDay()),
        timeOfDay: getTimeOfDay(now)
    };
    const moodResult: NativeHomeMoodResult = inferNativeHomeMood({
        genreScores: genreCounts,
        isWeekend: context.isWeekend,
        mediaCounts,
        timeOfDay: context.timeOfDay
    });
    const profile: NativeHomeProfile = {
        context,
        continueCounts,
        favoriteCount,
        mediaCounts,
        mood: moodResult.mood,
        moodConfidence: moodResult.confidence,
        moodSignals: moodResult.signals,
        profileVersion: HOME_PROFILE_VERSION,
        seasonal: getNativeHomeSeasonalContext(now),
        serverId,
        topArtists: getTopTerms(artistCounts),
        topAuthors: getTopTerms(authorCounts),
        topGenres: getTopTerms(genreCounts),
        topStudios: getTopTerms(studioCounts),
        updatedAt: now.getTime(),
        userId
    };

    if (options.save !== false && serverId && userId) {
        saveNativeHomeProfile(profile);
    }

    return profile;
}
