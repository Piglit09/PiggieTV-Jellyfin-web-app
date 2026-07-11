import { recordPtvEvent, timePtvAsync } from '../../core/observability';

import {
    getPtvMusicAlbum,
    getPtvMusicArtist,
    getPtvMusicGenres,
    getPtvMusicTitle
} from './musicApi';
import type {
    PtvMusicBrainzEnrichment,
    PtvMusicItem
} from './musicTypes';

type MusicBrainzTag = {
    count?: number;
    name?: string;
};

type MusicBrainzArtistCredit = {
    artist?: {
        genres?: MusicBrainzTag[];
        id?: string;
        name?: string;
        tags?: MusicBrainzTag[];
    };
    name?: string;
};

type MusicBrainzReleaseGroup = {
    'first-release-date'?: string;
    genres?: MusicBrainzTag[];
    id?: string;
    tags?: MusicBrainzTag[];
    title?: string;
};

type MusicBrainzRelease = {
    date?: string;
    genres?: MusicBrainzTag[];
    id?: string;
    'release-group'?: MusicBrainzReleaseGroup;
    tags?: MusicBrainzTag[];
    title?: string;
};

type MusicBrainzRecording = {
    'artist-credit'?: MusicBrainzArtistCredit[];
    'first-release-date'?: string;
    genres?: MusicBrainzTag[];
    id?: string;
    releases?: MusicBrainzRelease[];
    'release-groups'?: MusicBrainzReleaseGroup[];
    score?: number;
    tags?: MusicBrainzTag[];
    title?: string;
};

type MusicBrainzRecordingSearchResult = {
    recordings?: MusicBrainzRecording[];
};

type MusicBrainzCacheEntry<T> = {
    data: T;
    expiresAt: number;
};

const MUSICBRAINZ_API_ROOT = 'https://musicbrainz.org/ws/2';
const MUSICBRAINZ_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS = 1100;
const MUSICBRAINZ_RECORDING_INCLUDES = 'artist-credits+releases+release-groups+genres+tags';

const responseCache = new Map<string, MusicBrainzCacheEntry<unknown>>();
const enrichmentCache = new Map<string, MusicBrainzCacheEntry<PtvMusicBrainzEnrichment>>();

let lastRequestAt = 0;
let requestQueue = Promise.resolve();

function delay(ms: number) {
    return new Promise(resolve => {
        window.setTimeout(resolve, ms);
    });
}

function getCached<T>(cache: Map<string, MusicBrainzCacheEntry<T>>, key: string): T | null {
    const cached = cache.get(key);

    if (!cached) return null;
    if (cached.expiresAt < Date.now()) {
        cache.delete(key);
        return null;
    }

    return cached.data;
}

function setCached<T>(cache: Map<string, MusicBrainzCacheEntry<T>>, key: string, data: T) {
    cache.set(key, {
        data,
        expiresAt: Date.now() + MUSICBRAINZ_CACHE_TTL_MS
    });
}

function normalizeTerm(value?: string) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function uniqueNormalized(values: Array<string | undefined>) {
    const seen = new Set<string>();
    const terms: string[] = [];

    values.forEach(value => {
        const normalized = normalizeTerm(value);
        if (!normalized || seen.has(normalized)) return;

        seen.add(normalized);
        terms.push(String(value || '').trim());
    });

    return terms;
}

function getProviderId(item: PtvMusicItem, keys: string[]) {
    const providerIds = item.ProviderIds || {};

    for (const key of keys) {
        const value = providerIds[key];

        if (value) return value;
    }

    return '';
}

function getRecordingMbid(item: PtvMusicItem) {
    return getProviderId(item, [
        'MusicBrainzRecording',
        'MusicBrainzRecordingId',
        'MusicBrainzTrack',
        'MusicBrainzTrackId'
    ]);
}

function getSearchCacheKey(item: PtvMusicItem) {
    return [
        'search',
        normalizeTerm(getPtvMusicTitle(item)),
        normalizeTerm(getPtvMusicArtist(item)),
        normalizeTerm(getPtvMusicAlbum(item))
    ].join(':');
}

function escapeMusicBrainzQueryTerm(value: string) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
}

function buildRecordingSearchQuery(item: PtvMusicItem) {
    const title = getPtvMusicTitle(item);
    const artist = getPtvMusicArtist(item);
    const album = getPtvMusicAlbum(item);
    const parts = [
        title && title !== 'Unknown Track' ? `recording:"${escapeMusicBrainzQueryTerm(title)}"` : '',
        artist && artist !== 'Unknown Artist' ? `artist:"${escapeMusicBrainzQueryTerm(artist.split(',')[0].trim())}"` : '',
        album ? `release:"${escapeMusicBrainzQueryTerm(album)}"` : ''
    ].filter(Boolean);

    return parts.join(' AND ');
}

function collectTags(tags: MusicBrainzTag[] | undefined) {
    return (tags || [])
        .filter((tag): tag is MusicBrainzTag & { name: string } => Boolean(tag.name))
        .sort((left, right) => Number(right.count || 0) - Number(left.count || 0))
        .map(tag => tag.name);
}

function collectRecordingGenres(recording: MusicBrainzRecording) {
    const releaseGroups = recording['release-groups'] || [];
    const releases = recording.releases || [];
    const releaseGroupFromReleases = releases
        .map(release => release['release-group'])
        .filter((releaseGroup): releaseGroup is MusicBrainzReleaseGroup => Boolean(releaseGroup));

    return uniqueNormalized([
        ...collectTags(recording.genres),
        ...releases.reduce<string[]>((genres, release) => genres.concat(collectTags(release.genres)), []),
        ...releaseGroups.reduce<string[]>((genres, releaseGroup) => genres.concat(collectTags(releaseGroup.genres)), []),
        ...releaseGroupFromReleases.reduce<string[]>((genres, releaseGroup) => genres.concat(collectTags(releaseGroup.genres)), [])
    ]);
}

function collectRecordingTags(recording: MusicBrainzRecording) {
    const releaseGroups = recording['release-groups'] || [];
    const releases = recording.releases || [];
    const artists = recording['artist-credit'] || [];

    return uniqueNormalized([
        ...collectTags(recording.tags),
        ...releases.reduce<string[]>((tags, release) => tags.concat(collectTags(release.tags)), []),
        ...releaseGroups.reduce<string[]>((tags, releaseGroup) => tags.concat(collectTags(releaseGroup.tags)), []),
        ...artists.reduce<string[]>((tags, artistCredit) => tags.concat(collectTags(artistCredit.artist?.tags)), []),
        ...artists.reduce<string[]>((tags, artistCredit) => tags.concat(collectTags(artistCredit.artist?.genres)), [])
    ]);
}

function getFirstReleaseDate(recording: MusicBrainzRecording) {
    const releaseDates = [
        recording['first-release-date'],
        ...(recording.releases || []).map(release => release.date),
        ...(recording['release-groups'] || []).map(releaseGroup => releaseGroup['first-release-date']),
        ...(recording.releases || []).map(release => release['release-group']?.['first-release-date'])
    ].filter((value): value is string => Boolean(value));

    releaseDates.sort((left, right) => left.localeCompare(right));

    return releaseDates[0];
}

function buildEnrichmentFromRecording(
    recording: MusicBrainzRecording,
    source: PtvMusicBrainzEnrichment['source']
): PtvMusicBrainzEnrichment {
    const artistCredits = recording['artist-credit'] || [];
    const releases = recording.releases || [];
    const releaseGroups = [
        ...(recording['release-groups'] || []),
        ...releases
            .map(release => release['release-group'])
            .filter((releaseGroup): releaseGroup is MusicBrainzReleaseGroup => Boolean(releaseGroup))
    ];

    return {
        artistIds: uniqueNormalized(artistCredits.map(artistCredit => artistCredit.artist?.id)),
        artistNames: uniqueNormalized([
            ...artistCredits.map(artistCredit => artistCredit.artist?.name),
            ...artistCredits.map(artistCredit => artistCredit.name)
        ]),
        firstReleaseDate: getFirstReleaseDate(recording),
        genres: collectRecordingGenres(recording),
        recordingId: recording.id,
        releaseGroupIds: uniqueNormalized(releaseGroups.map(releaseGroup => releaseGroup.id)),
        releaseIds: uniqueNormalized(releases.map(release => release.id)),
        source,
        tags: collectRecordingTags(recording),
        title: recording.title
    };
}

function buildJellyfinFallbackEnrichment(item: PtvMusicItem): PtvMusicBrainzEnrichment {
    const artist = getPtvMusicArtist(item);

    return {
        artistIds: uniqueNormalized(item.ArtistItems?.map(artistItem => artistItem.Id) || []),
        artistNames: artist === 'Unknown Artist' ? [] : uniqueNormalized(artist.split(',').map(value => value.trim())),
        genres: getPtvMusicGenres(item),
        recordingId: getRecordingMbid(item) || undefined,
        releaseGroupIds: uniqueNormalized([getProviderId(item, ['MusicBrainzReleaseGroup', 'MusicBrainzReleaseGroupId'])]),
        releaseIds: uniqueNormalized([getProviderId(item, ['MusicBrainzAlbum', 'MusicBrainzRelease', 'MusicBrainzReleaseId'])]),
        source: 'jellyfin',
        tags: uniqueNormalized((item.Tags || []).filter((tag): tag is string => typeof tag === 'string')),
        title: getPtvMusicTitle(item)
    };
}

function queueMusicBrainzRequest<T>(task: () => Promise<T>): Promise<T> {
    const queued = requestQueue.then(async () => {
        const waitMs = Math.max(0, lastRequestAt + MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS - Date.now());

        if (waitMs > 0) {
            recordPtvEvent('api', 'musicbrainz-rate-limited', {
                waitMs
            });
            await delay(waitMs);
        }

        lastRequestAt = Date.now();

        return task();
    });

    requestQueue = queued.then(() => undefined, () => undefined);

    return queued;
}

function buildMusicBrainzQuery(params: Record<string, string | number>) {
    const mergedParams: Record<string, string | number> = {
        ...params,
        fmt: 'json'
    };

    return Object.keys(mergedParams).map(key => {
        const value = mergedParams[key];

        return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
    }).join('&');
}

function requestMusicBrainzJson<T>(path: string, params: Record<string, string | number>) {
    const url = `${MUSICBRAINZ_API_ROOT}/${path}?${buildMusicBrainzQuery(params)}`;
    const cached = getCached(responseCache, url) as T | null;

    if (cached) {
        recordPtvEvent('api', 'musicbrainz-cache-hit', {
            path
        });

        return Promise.resolve(cached);
    }

    return queueMusicBrainzRequest(() => {
        recordPtvEvent('api', 'musicbrainz-enrichment-request', {
            path
        });

        return fetch(url, {
            headers: {
                Accept: 'application/json'
            }
        }).then(response => {
            if (!response.ok) {
                throw new Error(`MusicBrainz ${response.status}`);
            }

            return response.json() as Promise<T>;
        }).then(data => {
            setCached(responseCache, url, data as unknown);

            return data;
        });
    });
}

async function lookupRecordingById(recordingId: string) {
    return requestMusicBrainzJson<MusicBrainzRecording>(`recording/${recordingId}`, {
        inc: MUSICBRAINZ_RECORDING_INCLUDES
    });
}

async function searchRecording(item: PtvMusicItem) {
    const query = buildRecordingSearchQuery(item);

    if (!query) return null;

    const searchResult = await requestMusicBrainzJson<MusicBrainzRecordingSearchResult>('recording', {
        limit: 5,
        query
    });
    const recording = (searchResult.recordings || [])
        .filter(result => result.id)
        .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))[0];

    if (!recording?.id) return null;

    return lookupRecordingById(recording.id);
}

export function enrichPtvMusicBrainzTrack(item: PtvMusicItem): Promise<PtvMusicBrainzEnrichment> {
    const recordingId = getRecordingMbid(item);
    const cacheKey = recordingId ? `recording:${recordingId}` : getSearchCacheKey(item);
    const cached = getCached(enrichmentCache, cacheKey);

    if (cached) return Promise.resolve(cached);

    return timePtvAsync('api', 'musicbrainz-enrichment-loaded', async () => {
        const recording = recordingId ? await lookupRecordingById(recordingId) : await searchRecording(item);
        let enrichment = buildJellyfinFallbackEnrichment(item);

        if (recording) {
            enrichment = buildEnrichmentFromRecording(recording, recordingId ? 'lookup' : 'search');
        }

        setCached(enrichmentCache, cacheKey, enrichment);
        recordPtvEvent('api', 'musicbrainz-enrichment-success', {
            artistCount: enrichment.artistNames.length,
            genreCount: enrichment.genres.length,
            itemId: item.Id || null,
            recordingId: enrichment.recordingId || null,
            source: enrichment.source,
            tagCount: enrichment.tags.length
        });

        return enrichment;
    }, {
        itemId: item.Id || null,
        recordingId: recordingId || null
    }).catch(error => {
        const fallback = buildJellyfinFallbackEnrichment(item);

        setCached(enrichmentCache, cacheKey, fallback);
        recordPtvEvent('api', 'musicbrainz-enrichment-failed', {
            error: error instanceof Error ? error.message : String(error),
            itemId: item.Id || null
        });

        return fallback;
    });
}

export function getPtvMusicBrainzTerms(enrichment: PtvMusicBrainzEnrichment) {
    return uniqueNormalized([
        ...enrichment.genres,
        ...enrichment.tags
    ]);
}
