import { recordPtvEvent, timePtvAsync } from '../../core/observability';
import type { PtvItemQuery } from '../../api';

import {
    fetchPtvMusicItem,
    fetchPtvMusicTracksForGenerator,
    getPtvMusicArtist,
    getPtvMusicBitrate,
    getPtvMusicCodec,
    getPtvMusicGenres,
    getPtvMusicTitle,
    isPtvMusicQualityMatch,
    uniquePtvMusicItems
} from './musicApi';
import {
    enrichPtvMusicBrainzTrack,
    getPtvMusicBrainzTerms
} from './musicBrainz';
import {
    enrichPtvMusicDiscogsTrack,
    getPtvMusicDiscogsTerms
} from './musicDiscogs';
import { getPtvLikedMusicItems } from './musicLikes';
import type {
    PtvMusicBrainzEnrichment,
    PtvMusicDiscogsEnrichment,
    PtvMusicItem,
    PtvMusicPlaylistRequest,
    PtvMusicPlaylistResult,
    PtvMusicRelatedOptions,
    PtvMusicSeed
} from './musicTypes';

type ParsedPrompt = {
    codecs: string[];
    genres: string[];
    limit: number;
    title: string;
};

type PtvMusicMetadataEnrichment = PtvMusicBrainzEnrichment & {
    discogs?: PtvMusicDiscogsEnrichment | null;
};

const DEFAULT_PLAYLIST_LIMIT = 50;
const MAX_PLAYLIST_LIMIT = 100;
const PROMPT_GENRES = [
    'acoustic',
    'ambient',
    'blues',
    'classical',
    'country',
    'disco',
    'electronic',
    'folk',
    'funk',
    'hip hop',
    'horror',
    'jazz',
    'metal',
    'pop',
    'punk',
    'r&b',
    'rap',
    'rock',
    'soul',
    'soundtrack',
    'synthwave'
];

function clampLimit(limit?: number) {
    if (!limit || Number.isNaN(limit)) return DEFAULT_PLAYLIST_LIMIT;

    return Math.max(1, Math.min(MAX_PLAYLIST_LIMIT, Math.round(limit)));
}

function parsePrompt(prompt = ''): ParsedPrompt {
    const normalized = prompt.toLowerCase();
    const limitMatch = /(\d{1,3})\s*(?:song|track)/.exec(normalized);
    const codecs = ['flac', 'opus', 'mp3'].filter(codec => normalized.includes(codec));
    const genres = PROMPT_GENRES.filter(genre => normalized.includes(genre));
    const requestedLimit = limitMatch ? Number(limitMatch[1]) : DEFAULT_PLAYLIST_LIMIT;
    const title = prompt
        .replace(/^make\s+/i, '')
        .replace(/^playlist\s+/i, '')
        .trim();

    return {
        codecs,
        genres,
        limit: clampLimit(requestedLimit),
        title: title || 'PiggieTV Smart Mix'
    };
}

function seedToTitle(seed: PtvMusicSeed, promptTitle?: string) {
    if (promptTitle) return promptTitle;
    if (seed.label) return `${seed.label} Radio`;
    if (seed.item) return `${getPtvMusicTitle(seed.item)} Radio`;

    return 'PiggieTV Smart Mix';
}

function normalizeTerm(value?: string) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function uniqueTerms(values: Array<string | undefined>) {
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

function splitArtistNames(value: string) {
    return value
        .split(',')
        .map(artist => artist.trim())
        .filter(Boolean);
}

function getStringTags(item: PtvMusicItem) {
    return (item.Tags || []).filter((tag): tag is string => typeof tag === 'string');
}

function getMusicBrainzProviderId(item: PtvMusicItem, keys: string[]) {
    const providerIds = item.ProviderIds || {};

    for (const key of keys) {
        const value = providerIds[key];

        if (value) return value;
    }

    return '';
}

function getMetadataTerms(enrichment?: PtvMusicMetadataEnrichment | null) {
    if (!enrichment) return [];

    return uniqueTerms([
        ...getPtvMusicBrainzTerms(enrichment),
        ...getPtvMusicDiscogsTerms(enrichment.discogs)
    ]);
}

function mergeMetadataEnrichment(
    musicBrainz: PtvMusicBrainzEnrichment,
    discogs: PtvMusicDiscogsEnrichment | null
): PtvMusicMetadataEnrichment {
    return {
        ...musicBrainz,
        artistNames: uniqueTerms([
            ...musicBrainz.artistNames,
            ...(discogs?.artistNames || [])
        ]),
        discogs,
        genres: uniqueTerms([
            ...musicBrainz.genres,
            ...(discogs?.genres || []),
            ...(discogs?.styles || [])
        ]),
        releaseIds: uniqueTerms([
            ...musicBrainz.releaseIds,
            ...(discogs?.releaseIds || [])
        ]),
        tags: uniqueTerms([
            ...musicBrainz.tags,
            ...(discogs?.tags || []),
            ...(discogs?.styles || []),
            ...(discogs?.labels || [])
        ])
    };
}

async function enrichPtvMusicMetadataTrack(item: PtvMusicItem): Promise<PtvMusicMetadataEnrichment> {
    const [musicBrainz, discogs] = await Promise.all([
        enrichPtvMusicBrainzTrack(item),
        enrichPtvMusicDiscogsTrack(item).catch(error => {
            recordPtvEvent('api', 'discogs-enrichment-skipped', {
                error: error instanceof Error ? error.message : String(error),
                itemId: item.Id || null
            });

            return null;
        })
    ]);
    const enrichment = mergeMetadataEnrichment(musicBrainz, discogs);

    recordPtvEvent('api', 'music-metadata-enrichment-built', {
        discogsSource: discogs?.source || 'none',
        genreCount: enrichment.genres.length,
        itemId: item.Id || null,
        musicBrainzSource: musicBrainz.source,
        tagCount: enrichment.tags.length
    });

    return enrichment;
}

function getSeedGenres(seed: PtvMusicSeed, parsed: ParsedPrompt, enrichment?: PtvMusicMetadataEnrichment | null) {
    const genres = new Set<string>(parsed.genres);

    if (seed.kind === 'genre' && seed.value) {
        genres.add(seed.value);
    }

    getPtvMusicGenres(seed.item).forEach(genre => {
        genres.add(genre);
    });

    enrichment?.genres.forEach(genre => {
        genres.add(genre);
    });

    return Array.from(genres);
}

function getSeedArtists(seed: PtvMusicSeed, enrichment?: PtvMusicMetadataEnrichment | null) {
    const artists = new Set<string>();

    if (seed.kind === 'artist' && seed.value) {
        artists.add(seed.value);
    }

    const artist = getPtvMusicArtist(seed.item);
    if (artist && artist !== 'Unknown Artist') {
        artist.split(',')
            .map(value => value.trim())
            .filter(Boolean)
            .forEach(value => {
                artists.add(value);
            });
    }

    enrichment?.artistNames.forEach(artistName => {
        artists.add(artistName);
    });

    return Array.from(artists);
}

function getSeedQuery(seed: PtvMusicSeed, parsed: ParsedPrompt, enrichment?: PtvMusicMetadataEnrichment | null) {
    const genres = getSeedGenres(seed, parsed, enrichment);

    if (seed.kind === 'album') {
        const albumId = seed.id || seed.item?.AlbumId || seed.item?.Id;

        return albumId ? { ParentId: albumId } : { SearchTerm: seed.value || seed.label || seed.item?.Album };
    }

    if (seed.kind === 'artist') {
        return seed.id ? { ArtistIds: seed.id } : { SearchTerm: seed.value || seed.label };
    }

    if (genres.length) {
        return { Genres: genres.join(',') };
    }

    if (seed.kind === 'favorites') {
        return { Filters: 'IsFavorite' };
    }

    if (seed.kind === 'top') {
        return { SortBy: 'PlayCount,SortName', SortOrder: 'Descending' };
    }

    if (seed.kind === 'recent') {
        return { SortBy: 'DatePlayed', SortOrder: 'Descending' };
    }

    return { SortBy: 'Random' };
}

function scoreTrack(
    track: PtvMusicItem,
    seed: PtvMusicSeed,
    parsed: ParsedPrompt,
    enrichment?: PtvMusicMetadataEnrichment | null,
    likedSeedItems: PtvMusicItem[] = []
) {
    const seedGenres = new Set(getSeedGenres(seed, parsed, enrichment).map(normalizeTerm));
    const seedTags = new Set(getMetadataTerms(enrichment).map(normalizeTerm));
    const seedArtists = new Set(getSeedArtists(seed, enrichment).map(normalizeTerm));
    const trackGenres = getPtvMusicGenres(track).map(normalizeTerm);
    const trackTags = getStringTags(track).map(normalizeTerm);
    const trackArtist = normalizeTerm(getPtvMusicArtist(track));
    const playCount = Number(track.UserData?.PlayCount || 0);
    const favoriteScore = track.UserData?.IsFavorite ? 10 : 0;
    const genreScore = trackGenres.filter(genre => seedGenres.has(genre)).length * 8;
    const tagScore = trackTags.filter(tag => seedTags.has(tag)).length * 5;
    const artistScore = Array.from(seedArtists).some(artist => trackArtist.includes(artist)) ? 6 : 0;
    const codecScore = parsed.codecs.length && isPtvMusicQualityMatch(track, parsed.codecs) ? 9 : 0;
    const qualityScore = ['flac', 'opus'].some(codec => getPtvMusicCodec(track).includes(codec)) ? 2 : 0;
    const bitrateScore = Math.min(5, Math.round(getPtvMusicBitrate(track) / 320000));
    const likedArtists = new Set(likedSeedItems.map(item => normalizeTerm(getPtvMusicArtist(item))).filter(Boolean));
    const likedGenres = new Set(likedSeedItems.flatMap(getPtvMusicGenres).map(normalizeTerm).filter(Boolean));
    const likedSeedIds = new Set(likedSeedItems.map(item => item.Id).filter(Boolean));
    const likedArtistScore = likedArtists.has(trackArtist) ? 12 : 0;
    const likedGenreScore = trackGenres.filter(genre => likedGenres.has(genre)).length * 6;
    const likedNoveltyScore = likedSeedIds.has(track.Id) ? -8 : 0;

    return playCount
        + favoriteScore
        + genreScore
        + tagScore
        + artistScore
        + codecScore
        + qualityScore
        + bitrateScore
        + likedArtistScore
        + likedGenreScore
        + likedNoveltyScore;
}

function describePlaylist(seed: PtvMusicSeed, parsed: ParsedPrompt, count: number) {
    const details = [
        seed.kind,
        parsed.genres.length ? parsed.genres.join(', ') : '',
        parsed.codecs.length ? parsed.codecs.join('/').toUpperCase() : '',
        `${count} tracks`
    ].filter(Boolean);

    return details.join(' - ');
}

function getFallbackQuery(seed: PtvMusicSeed, parsed: ParsedPrompt) {
    if (parsed.codecs.length) {
        return { SortBy: 'Random' };
    }

    if (seed.kind === 'song' && seed.item?.AlbumId) {
        return { ParentId: seed.item.AlbumId };
    }

    return { SortBy: 'Random' };
}

function getRelatedSeedTerms(seedItem: PtvMusicItem, enrichment: PtvMusicMetadataEnrichment) {
    return {
        artistIds: uniqueTerms([
            ...enrichment.artistIds,
            ...(seedItem.ArtistItems || []).map(artist => artist.Id)
        ]).map(normalizeTerm),
        artists: uniqueTerms([
            ...enrichment.artistNames,
            ...splitArtistNames(getPtvMusicArtist(seedItem))
        ]).map(normalizeTerm),
        genres: uniqueTerms([
            ...enrichment.genres,
            ...getPtvMusicGenres(seedItem)
        ]).map(normalizeTerm),
        releaseGroupIds: enrichment.releaseGroupIds.map(normalizeTerm),
        releaseIds: uniqueTerms([
            ...enrichment.releaseIds,
            getMusicBrainzProviderId(seedItem, ['MusicBrainzAlbum', 'MusicBrainzRelease', 'MusicBrainzReleaseId'])
        ]).map(normalizeTerm),
        tags: getMetadataTerms(enrichment).map(normalizeTerm)
    };
}

function scoreRelatedTrack(
    seedItem: PtvMusicItem,
    enrichment: PtvMusicMetadataEnrichment,
    candidate: PtvMusicItem
) {
    if (!candidate.Id || candidate.Id === seedItem.Id) return -1;

    const seedTerms = getRelatedSeedTerms(seedItem, enrichment);
    const candidateArtists = splitArtistNames(getPtvMusicArtist(candidate)).map(normalizeTerm);
    const candidateArtistIds = (candidate.ArtistItems || []).map(artist => normalizeTerm(artist.Id));
    const candidateGenres = getPtvMusicGenres(candidate).map(normalizeTerm);
    const candidateTags = getStringTags(candidate).map(normalizeTerm);
    const candidateReleaseIds = [
        getMusicBrainzProviderId(candidate, ['MusicBrainzAlbum', 'MusicBrainzRelease', 'MusicBrainzReleaseId'])
    ].map(normalizeTerm);
    const candidateReleaseGroupIds = [
        getMusicBrainzProviderId(candidate, ['MusicBrainzReleaseGroup', 'MusicBrainzReleaseGroupId'])
    ].map(normalizeTerm);
    const artistScore = candidateArtists.some(artist => seedTerms.artists.some(seedArtist => artist === seedArtist || artist.includes(seedArtist))) ? 18 : 0;
    const artistIdScore = candidateArtistIds.some(artistId => seedTerms.artistIds.includes(artistId)) ? 22 : 0;
    const genreScore = candidateGenres.filter(genre => seedTerms.genres.includes(genre)).length * 14;
    const tagScore = candidateTags.filter(tag => seedTerms.tags.includes(tag)).length * 8;
    const releaseScore = candidateReleaseIds.some(id => id && seedTerms.releaseIds.includes(id)) ? 6 : 0;
    const releaseGroupScore = candidateReleaseGroupIds.some(id => id && seedTerms.releaseGroupIds.includes(id)) ? 10 : 0;
    const albumScore = seedItem.AlbumId && candidate.AlbumId === seedItem.AlbumId ? 4 : 0;
    const favoriteScore = candidate.UserData?.IsFavorite ? 2 : 0;
    const playScore = Math.min(5, Number(candidate.UserData?.PlayCount || 0));

    return artistScore
        + artistIdScore
        + genreScore
        + tagScore
        + releaseScore
        + releaseGroupScore
        + albumScore
        + favoriteScore
        + playScore;
}

function getRelatedCandidateQueries(seedItem: PtvMusicItem, enrichment: PtvMusicMetadataEnrichment): PtvItemQuery[] {
    const seedTerms = getRelatedSeedTerms(seedItem, enrichment);
    const artistId = seedItem.ArtistItems?.[0]?.Id;
    const genreQuery = uniqueTerms([
        ...enrichment.genres,
        ...getPtvMusicGenres(seedItem)
    ]).slice(0, 4);
    const queries: PtvItemQuery[] = [];

    if (artistId) {
        queries.push({ ArtistIds: artistId });
    } else if (seedTerms.artists[0]) {
        queries.push({ SearchTerm: seedTerms.artists[0] });
    }

    if (genreQuery.length) {
        queries.push({ Genres: genreQuery.join(',') });
    }

    if (seedItem.AlbumId) {
        queries.push({ ParentId: seedItem.AlbumId });
    }

    queries.push({ SortBy: 'PlayCount,SortName', SortOrder: 'Descending' });
    queries.push({ SortBy: 'DateCreated', SortOrder: 'Descending' });

    return queries;
}

function capRepeatedArtists(items: PtvMusicItem[], seedItem: PtvMusicItem, limit: number) {
    const artistCounts = new Map<string, number>();
    const seedArtist = normalizeTerm(getPtvMusicArtist(seedItem));
    const capped: PtvMusicItem[] = [];

    items.some(item => {
        const artist = normalizeTerm(getPtvMusicArtist(item));
        const count = artistCounts.get(artist) || 0;
        const maxForArtist = artist === seedArtist ? 6 : 4;

        if (count < maxForArtist || capped.length < 6) {
            artistCounts.set(artist, count + 1);
            capped.push(item);
        }

        return capped.length >= limit;
    });

    return capped;
}

function getLocalMusicEnrichment(): PtvMusicMetadataEnrichment {
    return {
        artistIds: [],
        artistNames: [],
        genres: [],
        releaseGroupIds: [],
        releaseIds: [],
        source: 'jellyfin',
        tags: []
    };
}

function scoreLocalRelatedTracks(seedItem: PtvMusicItem, pool: PtvMusicItem[], limit: number) {
    const enrichment = getLocalMusicEnrichment();

    return capRepeatedArtists(
        uniquePtvMusicItems(pool)
            .map(item => ({
                item,
                score: scoreRelatedTrack(seedItem, enrichment, item)
            }))
            .filter(entry => entry.score > 0)
            .sort((left, right) => right.score - left.score || getPtvMusicTitle(left.item).localeCompare(getPtvMusicTitle(right.item)))
            .map(entry => entry.item),
        seedItem,
        limit
    );
}

export function buildPtvMusicRelatedTracks(
    seedItem: PtvMusicItem,
    options: PtvMusicRelatedOptions = {}
): Promise<PtvMusicItem[]> {
    const limit = Math.max(1, Math.min(options.limit || 24, 50));

    return timePtvAsync('recommendation', 'music-metadata-up-next-built', async () => {
        const startedAt = performance.now();
        const localCandidateStartedAt = performance.now();
        const localCandidates = uniquePtvMusicItems([
            ...(options.pool || []),
            ...getPtvLikedMusicItems()
        ]);
        const localItems = scoreLocalRelatedTracks(seedItem, localCandidates, limit);
        const candidateNormalizeMs = Number((performance.now() - localCandidateStartedAt).toFixed(1));

        if (localItems.length >= Math.min(limit, 12)) {
            recordPtvEvent('recommendation', 'music-metadata-up-next-built', {
                candidateCount: localCandidates.length,
                candidateFetchMs: 0,
                candidateNormalizeMs,
                count: localItems.length,
                dedupeMs: 0,
                enrichmentWaitMs: 0,
                finalizationMs: Number((performance.now() - startedAt).toFixed(1)),
                itemId: seedItem.Id || null,
                musicBrainzSource: 'skipped-cache-pool',
                scoreMs: candidateNormalizeMs
            });

            return localItems;
        }

        const enrichmentStartedAt = performance.now();
        const enrichment = await enrichPtvMusicMetadataTrack(seedItem);
        const enrichmentWaitMs = Number((performance.now() - enrichmentStartedAt).toFixed(1));
        const candidateFetchStartedAt = performance.now();
        const fetchedCandidates = await Promise.all(getRelatedCandidateQueries(seedItem, enrichment)
            .map(query => fetchPtvMusicTracksForGenerator(query, 80).catch(() => [])));
        const candidateFetchMs = Number((performance.now() - candidateFetchStartedAt).toFixed(1));
        const normalizeStartedAt = performance.now();
        const sourceItems = uniquePtvMusicItems([
            ...(options.pool || []),
            ...fetchedCandidates.reduce<PtvMusicItem[]>((items, candidateItems) => items.concat(candidateItems), [])
        ]);
        const networkCandidateNormalizeMs = Number((performance.now() - normalizeStartedAt).toFixed(1));
        const scoreStartedAt = performance.now();
        const scoredItems = sourceItems
            .map(item => ({
                item,
                score: scoreRelatedTrack(seedItem, enrichment, item)
            }))
            .filter(entry => entry.score > 0)
            .sort((left, right) => right.score - left.score || getPtvMusicTitle(left.item).localeCompare(getPtvMusicTitle(right.item)))
            .map(entry => entry.item);
        const scoreMs = Number((performance.now() - scoreStartedAt).toFixed(1));
        const dedupeStartedAt = performance.now();
        const relatedItems = capRepeatedArtists(scoredItems, seedItem, limit);
        const dedupeMs = Number((performance.now() - dedupeStartedAt).toFixed(1));

        recordPtvEvent('recommendation', 'music-metadata-up-next-built', {
            candidateFetchMs,
            candidateNormalizeMs: networkCandidateNormalizeMs,
            candidateCount: sourceItems.length,
            count: relatedItems.length,
            dedupeMs,
            discogsSource: enrichment.discogs?.source || 'none',
            enrichmentWaitMs,
            finalizationMs: Number((performance.now() - startedAt).toFixed(1)),
            genreCount: enrichment.genres.length,
            itemId: seedItem.Id || null,
            musicBrainzSource: enrichment.source,
            scoreMs,
            tagCount: enrichment.tags.length
        });

        return relatedItems;
    }, {
        itemId: seedItem.Id || null,
        limit
    }).catch(error => {
        recordPtvEvent('recommendation', 'music-metadata-up-next-failed', {
            error: error instanceof Error ? error.message : String(error),
            itemId: seedItem.Id || null
        });

        return [];
    });
}

export function buildPtvMusicRecommendations(request: PtvMusicPlaylistRequest): Promise<PtvMusicPlaylistResult> {
    const parsed = parsePrompt(request.prompt || '');
    const limit = clampLimit(request.limit || parsed.limit);
    const initialSeed = request.seed || {
        kind: parsed.codecs.length ? 'quality' : 'random',
        label: parsed.title,
        value: parsed.codecs.join(',')
    } as PtvMusicSeed;

    return timePtvAsync('recommendation', 'music-recommendations-built', async () => {
        const seed = initialSeed.id && !initialSeed.item && initialSeed.kind === 'song' ?
            {
                ...initialSeed,
                item: await fetchPtvMusicItem(initialSeed.id)
            } :
            initialSeed;
        const enrichment = seed.item ? await enrichPtvMusicMetadataTrack(seed.item) : null;
        const primaryQuery = getSeedQuery(seed, parsed, enrichment);
        const likedSeedItems = seed.kind === 'favorites' ? getPtvLikedMusicItems() : [];
        const primaryItems = await fetchPtvMusicTracksForGenerator(primaryQuery, limit);
        const fallbackItems = primaryItems.length < limit ?
            await fetchPtvMusicTracksForGenerator(getFallbackQuery(seed, parsed), limit) :
            [];
        const sourceItems = uniquePtvMusicItems([...likedSeedItems, ...primaryItems, ...fallbackItems])
            .filter(item => {
                if (seed.item?.Id && item.Id === seed.item.Id) return false;
                return isPtvMusicQualityMatch(item, parsed.codecs);
            });
        const items = sourceItems
            .map(item => ({
                item,
                score: scoreTrack(item, seed, parsed, enrichment, likedSeedItems)
            }))
            .sort((left, right) => right.score - left.score || getPtvMusicTitle(left.item).localeCompare(getPtvMusicTitle(right.item)))
            .map(entry => entry.item)
            .slice(0, limit);
        const result = {
            description: describePlaylist(seed, parsed, items.length),
            items,
            name: request.name || seedToTitle(seed, parsed.title),
            seed
        };

        recordPtvEvent('recommendation', 'music-recommendations-built', {
            count: items.length,
            discogsSource: enrichment?.discogs?.source || 'none',
            musicBrainzSource: enrichment?.source || 'none',
            name: result.name,
            seed: seed.kind
        });

        return result;
    }, {
        prompt: request.prompt,
        seed: initialSeed.kind
    });
}
