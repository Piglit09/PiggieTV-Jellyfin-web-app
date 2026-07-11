import { recordPtvEvent, timePtvAsync } from '../../core/observability';

import {
    getPtvMusicAlbum,
    getPtvMusicArtist,
    getPtvMusicGenres,
    getPtvMusicTitle
} from './musicApi';
import type {
    PtvMusicDiscogsEnrichment,
    PtvMusicItem
} from './musicTypes';

type DiscogsArtist = {
    name?: string;
};

type DiscogsLabel = {
    name?: string;
};

type DiscogsMasterRef = Partial<Record<'master_id', number>>;

type DiscogsRelease = DiscogsMasterRef & {
    artists?: DiscogsArtist[];
    genres?: string[];
    id?: number;
    labels?: DiscogsLabel[];
    released?: string;
    styles?: string[];
    title?: string;
    year?: number;
};

type DiscogsSearchResult = DiscogsMasterRef & {
    genre?: string[];
    id?: number;
    label?: string[];
    style?: string[];
    title?: string;
    type?: string;
    year?: number | string;
};

type DiscogsSearchResponse = {
    results?: DiscogsSearchResult[];
};

type DiscogsCacheEntry<T> = {
    data: T;
    expiresAt: number;
};

type DiscogsRuntimeConfig = {
    discogsToken?: unknown;
    musicDiscogsToken?: unknown;
    musicMetadata?: {
        discogsToken?: unknown;
    };
};
type DiscogsTermValue = string | number | undefined;
type DiscogsQueryParams = Record<string, DiscogsTermValue>;

const DISCOGS_API_ROOT = 'https://api.discogs.com';
const DISCOGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DISCOGS_FETCH_TIMEOUT_MS = 6500;
const DISCOGS_MIN_REQUEST_INTERVAL_MS = 1100;
const DISCOGS_TOKEN_STORAGE_KEYS = [
    'ptv:music:discogs-token',
    'ptv:discogs-token',
    'discogs-token'
];

const responseCache = new Map<string, DiscogsCacheEntry<unknown>>();
const enrichmentCache = new Map<string, DiscogsCacheEntry<PtvMusicDiscogsEnrichment>>();

let lastRequestAt = 0;
let requestQueue = Promise.resolve();

function delay(ms: number) {
    return new Promise(resolve => {
        window.setTimeout(resolve, ms);
    });
}

function getCached<T>(cache: Map<string, DiscogsCacheEntry<T>>, key: string): T | null {
    const cached = cache.get(key);

    if (!cached) return null;
    if (cached.expiresAt < Date.now()) {
        cache.delete(key);
        return null;
    }

    return cached.data;
}

function setCached<T>(cache: Map<string, DiscogsCacheEntry<T>>, key: string, data: T) {
    cache.set(key, {
        data,
        expiresAt: Date.now() + DISCOGS_CACHE_TTL_MS
    });
}

function normalizeTerm(value?: string | number) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function uniqueNormalized(values: DiscogsTermValue[]) {
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

function cleanDiscogsName(value?: string) {
    const compactName = String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
    const suffixStart = compactName.lastIndexOf(' (');

    if (suffixStart > 0 && compactName.endsWith(')')) {
        const suffix = compactName.slice(suffixStart + 2, -1);
        const isNumericSuffix = suffix.length > 0 && Array.from(suffix).every(character => character >= '0' && character <= '9');

        if (isNumericSuffix) {
            return compactName.slice(0, suffixStart);
        }
    }

    return compactName;
}

function getProviderId(item: PtvMusicItem, keys: string[]) {
    const providerIds = item.ProviderIds || {};

    for (const key of keys) {
        const value = providerIds[key];

        if (value) return value;
    }

    return '';
}

function getDiscogsReleaseId(item: PtvMusicItem) {
    return getProviderId(item, [
        'Discogs',
        'DiscogsAlbum',
        'DiscogsRelease',
        'DiscogsReleaseId'
    ]);
}

function getDiscogsMasterId(item: PtvMusicItem) {
    return getProviderId(item, [
        'DiscogsMaster',
        'DiscogsMasterId'
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

function getRuntimeConfig() {
    return (window.PTV || {}) as DiscogsRuntimeConfig;
}

function getStringConfigValue(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function getDiscogsToken() {
    const runtimeConfig = getRuntimeConfig();
    const runtimeToken = [
        runtimeConfig.musicDiscogsToken,
        runtimeConfig.discogsToken,
        runtimeConfig.musicMetadata?.discogsToken
    ].map(getStringConfigValue).find(Boolean);

    if (runtimeToken) return runtimeToken;

    for (const key of DISCOGS_TOKEN_STORAGE_KEYS) {
        const storageToken = getStringConfigValue(window.localStorage?.getItem(key));

        if (storageToken) return storageToken;
    }

    return '';
}

function getDiscogsHeaders() {
    const token = getDiscogsToken();
    const headers: Record<string, string> = {
        Accept: 'application/json'
    };

    if (token) {
        headers.Authorization = `Discogs token=${token}`;
    }

    return headers;
}

function buildDiscogsQuery(params: DiscogsQueryParams) {
    return Object.keys(params).map(key => {
        const value = params[key];

        if (value === undefined || value === '') return '';

        return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
    }).filter(Boolean).join('&');
}

function fetchDiscogsJson<T>(url: string, headers: Record<string, string>): Promise<T> {
    let timer = 0;
    const request = fetch(url, {
        headers
    }).then(response => {
        if (!response.ok) throw new Error(`Discogs ${response.status}`);

        return response.json() as Promise<T>;
    });
    const timeout = new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => {
            reject(new Error('Discogs timeout'));
        }, DISCOGS_FETCH_TIMEOUT_MS);
    });

    return Promise.race([request, timeout]).finally(() => {
        window.clearTimeout(timer);
    });
}

function queueDiscogsRequest<T>(task: () => Promise<T>): Promise<T> {
    const queued = requestQueue.then(async () => {
        const waitMs = Math.max(0, lastRequestAt + DISCOGS_MIN_REQUEST_INTERVAL_MS - Date.now());

        if (waitMs > 0) {
            recordPtvEvent('api', 'discogs-rate-limited', {
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

function requestDiscogsJson<T>(path: string, params: DiscogsQueryParams = {}) {
    const query = buildDiscogsQuery(params);
    const querySuffix = query ? `?${query}` : '';
    const url = `${DISCOGS_API_ROOT}${path}${querySuffix}`;
    const cached = getCached(responseCache, url) as T | null;

    if (cached) {
        recordPtvEvent('api', 'discogs-cache-hit', {
            path
        });

        return Promise.resolve(cached);
    }

    return queueDiscogsRequest(() => {
        recordPtvEvent('api', 'discogs-enrichment-request', {
            hasToken: Boolean(getDiscogsToken()),
            path
        });

        return fetchDiscogsJson<T>(url, getDiscogsHeaders())
            .then(data => {
                setCached(responseCache, url, data as unknown);

                return data;
            });
    });
}

function getSearchQuery(item: PtvMusicItem) {
    return uniqueNormalized([
        getPtvMusicArtist(item),
        getPtvMusicAlbum(item),
        getPtvMusicTitle(item)
    ]).join(' ');
}

function searchDiscogsRelease(item: PtvMusicItem) {
    const artist = getPtvMusicArtist(item);
    const album = getPtvMusicAlbum(item);
    const title = getPtvMusicTitle(item);
    const q = getSearchQuery(item);
    const searchParams: DiscogsQueryParams = {
        artist: artist && artist !== 'Unknown Artist' ? artist.split(',')[0].trim() : undefined,
        q,
        track: title && title !== 'Unknown Track' ? title : undefined,
        type: 'release'
    };

    if (!q) return Promise.resolve(null);

    searchParams['per_page'] = 5;
    searchParams['release_title'] = album || undefined;

    return requestDiscogsJson<DiscogsSearchResponse>('/database/search', searchParams).then(result => {
        const match = (result.results || [])
            .filter(searchResult => searchResult.id && searchResult.type === 'release')
            .sort((left, right) => scoreDiscogsSearchResult(right, item) - scoreDiscogsSearchResult(left, item))[0];

        return match || null;
    });
}

function scoreDiscogsSearchResult(result: DiscogsSearchResult, item: PtvMusicItem) {
    const resultTitle = normalizeTerm(result.title);
    const album = normalizeTerm(getPtvMusicAlbum(item));
    const artist = normalizeTerm(getPtvMusicArtist(item).split(',')[0]);
    const title = normalizeTerm(getPtvMusicTitle(item));
    const itemYear = Number(item.ProductionYear || 0);
    const resultYear = Number(result.year || 0);
    const albumScore = album && resultTitle.includes(album) ? 24 : 0;
    const artistScore = artist && resultTitle.includes(artist) ? 14 : 0;
    const titleScore = title && resultTitle.includes(title) ? 8 : 0;
    const yearScore = itemYear && resultYear && itemYear === resultYear ? 4 : 0;
    const metadataScore = Number(Boolean(result.genre?.length)) + Number(Boolean(result.style?.length));

    return albumScore + artistScore + titleScore + yearScore + metadataScore;
}

function lookupDiscogsRelease(releaseId: string | number) {
    return requestDiscogsJson<DiscogsRelease>(`/releases/${releaseId}`);
}

function buildEnrichmentFromSearchResult(searchResult: DiscogsSearchResult): PtvMusicDiscogsEnrichment {
    return {
        artistNames: uniqueNormalized([searchResult.title?.split(' - ')[0]].map(cleanDiscogsName)),
        genres: uniqueNormalized(searchResult.genre || []),
        labels: uniqueNormalized(searchResult.label || []),
        masterIds: uniqueNormalized([searchResult['master_id']]),
        releaseIds: uniqueNormalized([searchResult.id]),
        source: 'search',
        styles: uniqueNormalized(searchResult.style || []),
        tags: uniqueNormalized([
            ...(searchResult.genre || []),
            ...(searchResult.style || []),
            ...(searchResult.label || [])
        ]),
        title: searchResult.title,
        year: Number(searchResult.year || 0) || undefined
    };
}

function buildEnrichmentFromRelease(
    release: DiscogsRelease,
    fallback?: DiscogsSearchResult | null
): PtvMusicDiscogsEnrichment {
    return {
        artistNames: uniqueNormalized([
            ...(release.artists || []).map(artist => cleanDiscogsName(artist.name)),
            fallback?.title?.split(' - ')[0]
        ]),
        genres: uniqueNormalized([
            ...(release.genres || []),
            ...(fallback?.genre || [])
        ]),
        labels: uniqueNormalized([
            ...(release.labels || []).map(label => label.name),
            ...(fallback?.label || [])
        ]),
        masterIds: uniqueNormalized([
            release['master_id'],
            fallback?.['master_id']
        ]),
        releaseIds: uniqueNormalized([
            release.id,
            fallback?.id
        ]),
        source: 'release',
        styles: uniqueNormalized([
            ...(release.styles || []),
            ...(fallback?.style || [])
        ]),
        tags: uniqueNormalized([
            ...(release.genres || []),
            ...(release.styles || []),
            ...(release.labels || []).map(label => label.name),
            ...(fallback?.genre || []),
            ...(fallback?.style || []),
            ...(fallback?.label || [])
        ]),
        title: release.title || fallback?.title,
        year: release.year || Number(fallback?.year || 0) || undefined
    };
}

function buildJellyfinFallbackEnrichment(item: PtvMusicItem): PtvMusicDiscogsEnrichment {
    const artist = getPtvMusicArtist(item);

    return {
        artistNames: artist === 'Unknown Artist' ? [] : uniqueNormalized(artist.split(',').map(value => value.trim())),
        genres: getPtvMusicGenres(item),
        labels: [],
        masterIds: uniqueNormalized([getDiscogsMasterId(item)]),
        releaseIds: uniqueNormalized([getDiscogsReleaseId(item)]),
        source: 'jellyfin',
        styles: [],
        tags: uniqueNormalized((item.Tags || []).filter((tag): tag is string => typeof tag === 'string')),
        title: getPtvMusicTitle(item),
        year: item.ProductionYear
    };
}

export function enrichPtvMusicDiscogsTrack(item: PtvMusicItem): Promise<PtvMusicDiscogsEnrichment> {
    const releaseId = getDiscogsReleaseId(item);
    const cacheKey = releaseId ? `release:${releaseId}` : getSearchCacheKey(item);
    const cached = getCached(enrichmentCache, cacheKey);

    if (cached) return Promise.resolve(cached);

    return timePtvAsync('api', 'discogs-enrichment-loaded', async () => {
        const searchResult = releaseId ? null : await searchDiscogsRelease(item);
        const lookupId = releaseId || searchResult?.id;
        let enrichment = buildJellyfinFallbackEnrichment(item);

        if (lookupId) {
            enrichment = buildEnrichmentFromRelease(await lookupDiscogsRelease(lookupId), searchResult);
        } else if (searchResult) {
            enrichment = buildEnrichmentFromSearchResult(searchResult);
        }

        setCached(enrichmentCache, cacheKey, enrichment);
        recordPtvEvent('api', 'discogs-enrichment-success', {
            genreCount: enrichment.genres.length,
            itemId: item.Id || null,
            labelCount: enrichment.labels.length,
            releaseId: enrichment.releaseIds[0] || null,
            source: enrichment.source,
            styleCount: enrichment.styles.length
        });

        return enrichment;
    }, {
        itemId: item.Id || null,
        releaseId: releaseId || null
    }).catch(error => {
        const fallback = buildJellyfinFallbackEnrichment(item);

        setCached(enrichmentCache, cacheKey, fallback);
        recordPtvEvent('api', 'discogs-enrichment-failed', {
            error: error instanceof Error ? error.message : String(error),
            itemId: item.Id || null
        });

        return fallback;
    });
}

export function getPtvMusicDiscogsTerms(enrichment?: PtvMusicDiscogsEnrichment | null) {
    if (!enrichment) return [];

    return uniqueNormalized([
        ...enrichment.genres,
        ...enrichment.styles,
        ...enrichment.tags,
        ...enrichment.labels
    ]);
}
