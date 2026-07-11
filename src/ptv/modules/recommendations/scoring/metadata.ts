import type {
    PtvRecommendationItem,
    PtvRecommendationMediaType,
    PtvTasteCategory
} from '../types/recommendationTypes';

export type PtvRecommendationMetadata = {
    categories: Partial<Record<PtvTasteCategory, string[]>>;
    mediaType: PtvRecommendationMediaType;
    title: string;
};

const MANGA_KEYWORDS = /\b(?:manga|manhwa|manhua)\b/i;
const COMIC_KEYWORDS = /\b(?:comic|comics|graphic novel|issue|issues)\b/i;
const ANIME_KEYWORDS = /\b(?:anime|manga|crunchyroll|funimation|toonami)\b/i;
const AUDIOBOOK_KEYWORDS = /\b(?:audiobook|audio book|spoken word)\b/i;
const UNKNOWN_ARTIST_TERMS = new Set([
    'unknown',
    'unknown artist',
    'various artists',
    '[unknown]',
    '<unknown>'
]);

export function normalizeRecommendationTerm(value: unknown) {
    return String(value || '')
        .trim()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

export function titleCaseTerm(value: string) {
    return normalizeRecommendationTerm(value)
        .split(' ')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function compact(values: unknown[]) {
    const seen = new Set<string>();
    const result: string[] = [];

    values.forEach(value => {
        const normalized = normalizeRecommendationTerm(value);

        if (!normalized || seen.has(normalized)) return;

        seen.add(normalized);
        result.push(titleCaseTerm(normalized));
    });

    return result;
}

function isResolvedArtistName(value: unknown) {
    const normalized = normalizeRecommendationTerm(value);

    return Boolean(normalized) && !UNKNOWN_ARTIST_TERMS.has(normalized);
}

function splitDelimitedArtistValue(value: string) {
    const parts: string[] = [];
    let current = '';

    for (const char of value) {
        if (char === ',' || char === ';' || char === '/' || char === '|' || char === '&') {
            parts.push(current);
            current = '';
        } else {
            current += char;
        }
    }

    parts.push(current);

    return parts;
}

function splitArtistAndPhrase(value: string) {
    const parts: string[] = [];
    let remaining = value;

    while (remaining.toLowerCase().includes(' and ')) {
        const splitIndex = remaining.toLowerCase().indexOf(' and ');

        parts.push(remaining.slice(0, splitIndex));
        remaining = remaining.slice(splitIndex + 5);
    }

    parts.push(remaining);

    return parts;
}

function isShortNumericPlaceholder(value: string) {
    const trimmed = value.trim();

    return trimmed.length > 0
        && trimmed.length <= 3
        && Array.from(trimmed).every(char => char >= '0' && char <= '9');
}

function firstResolvedTitle(values: unknown[], options: { rejectNumericPlaceholder?: boolean } = {}) {
    return values
        .map(value => String(value || '').trim())
        .find(value => value && (!options.rejectNumericPlaceholder || !isShortNumericPlaceholder(value))) || '';
}

function splitArtistValues(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.flatMap(entry => splitArtistValues(entry));
    }

    if (typeof value !== 'string') return [];

    return splitDelimitedArtistValue(value)
        .flatMap(splitArtistAndPhrase)
        .map(entry => entry.trim())
        .filter(isResolvedArtistName);
}

function getStringArray(item: PtvRecommendationItem, ...keys: string[]) {
    const values: string[] = [];

    keys.forEach(key => {
        const value = item[key];

        if (Array.isArray(value)) {
            value.forEach(entry => {
                if (typeof entry === 'string') values.push(entry);
            });
        }
    });

    return compact(values);
}

function getNamedObjectArray(value: unknown): Array<{ Name?: string }> {
    if (!Array.isArray(value)) return [];

    return value.filter((entry): entry is { Name?: string } => Boolean(entry) && typeof entry === 'object');
}

function getPeople(item: PtvRecommendationItem) {
    if (!Array.isArray(item.People)) return [];

    return item.People.filter(person => Boolean(person) && typeof person === 'object');
}

function getPeopleByType(item: PtvRecommendationItem, type: string) {
    return compact(getPeople(item)
        .filter(person => normalizeRecommendationTerm(person.Type) === normalizeRecommendationTerm(type))
        .map(person => person.Name || person.Role || ''));
}

function getArtists(item: PtvRecommendationItem) {
    return compact(getResolvedRecommendationArtists(item));
}

function getAuthors(item: PtvRecommendationItem) {
    return compact([
        ...getPeopleByType(item, 'author'),
        ...getPeopleByType(item, 'writer'),
        item.AlbumArtist
    ]);
}

function getText(item: PtvRecommendationItem) {
    return [
        item.Name,
        item.Type,
        item.MediaType,
        item.CollectionType,
        item.CollectionName,
        item.SeriesName,
        item.Overview,
        item.Album,
        ...getStringArray(item, 'Genres'),
        ...getStringArray(item, 'Tags'),
        ...getStringArray(item, 'Studios')
    ].join(' ');
}

export function getRecommendationTitle(item: PtvRecommendationItem) {
    const type = normalizeRecommendationTerm(item.Type);

    if (type === 'audio') {
        return firstResolvedTitle([
            item.Name,
            item.MusicBrainzTitle,
            item.Album,
            item.SeriesName
        ], { rejectNumericPlaceholder: true }) || 'Unknown Track';
    }

    if (type === 'musicalbum') {
        return firstResolvedTitle([item.Name, item.Album, item.MusicBrainzTitle], { rejectNumericPlaceholder: true }) || 'Unknown Album';
    }

    if (type === 'musicartist') {
        return firstResolvedTitle([
            item.Name,
            item.AlbumArtist,
            ...splitArtistValues(item.Artists),
            item.Artist,
            ...getNamedObjectArray(item.AlbumArtists).flatMap(artist => splitArtistValues(artist.Name)),
            ...splitArtistValues(item.MusicBrainzArtistNames),
            item.MusicBrainzArtistName,
            ...getNamedObjectArray(item.ArtistItems).flatMap(artist => splitArtistValues(artist.Name))
        ], { rejectNumericPlaceholder: true }) || 'Unknown Artist';
    }

    return String(item.Name || item.SeriesName || item.Album || 'Untitled');
}

export function getResolvedRecommendationArtists(item: PtvRecommendationItem) {
    return [
        ...splitArtistValues(item.AlbumArtist),
        ...splitArtistValues(item.Artists),
        ...splitArtistValues(item.Artist),
        ...getNamedObjectArray(item.AlbumArtists).flatMap(artist => splitArtistValues(artist.Name)),
        ...splitArtistValues(item.MusicBrainzArtistNames),
        ...splitArtistValues(item.MusicBrainzArtistName),
        ...getNamedObjectArray(item.ArtistItems).flatMap(artist => splitArtistValues(artist.Name))
    ];
}

export function hasResolvedRecommendationArtist(item: PtvRecommendationItem) {
    return getResolvedRecommendationArtists(item).length > 0;
}

export function getRecommendationMediaType(item: PtvRecommendationItem): PtvRecommendationMediaType {
    const type = normalizeRecommendationTerm(item.Type);
    const mediaType = normalizeRecommendationTerm(item.MediaType);
    const collectionType = normalizeRecommendationTerm(item.CollectionType);
    const text = getText(item);

    if (type === 'audio' || type === 'musicalbum' || mediaType === 'audio') return 'music';
    if (type === 'movie') return ANIME_KEYWORDS.test(text) ? 'anime' : 'movie';
    if (type === 'series' || type === 'episode') return ANIME_KEYWORDS.test(text) ? 'anime' : 'show';
    if (type === 'book' || collectionType === 'books') {
        if (AUDIOBOOK_KEYWORDS.test(text)) return 'audiobook';
        if (MANGA_KEYWORDS.test(text)) return 'manga';
        if (COMIC_KEYWORDS.test(text)) return 'comic';

        return 'book';
    }
    if (collectionType.includes('game')) return 'game';

    return 'unknown';
}

function getDecade(item: PtvRecommendationItem) {
    const year = Number(item.ProductionYear || String(item.PremiereDate || '').slice(0, 4));

    if (!Number.isFinite(year) || year <= 0) return [];

    return [`${Math.floor(year / 10) * 10}s`];
}

export function getRecommendationMetadata(item: PtvRecommendationItem): PtvRecommendationMetadata {
    const mediaType = getRecommendationMediaType(item);
    const genres = getStringArray(item, 'Genres');
    const musicGenres = mediaType === 'music' ? genres : [];
    const bookGenres = ['book', 'comic', 'manga', 'audiobook'].includes(mediaType) ? genres : [];

    return {
        categories: {
            actors: getPeopleByType(item, 'actor'),
            artists: getArtists(item),
            authors: getAuthors(item),
            bookGenres,
            collections: compact([item.CollectionName, item.Album, item.SeriesName]),
            decades: getDecade(item),
            directors: getPeopleByType(item, 'director'),
            genres,
            mediaTypes: [mediaType],
            musicGenres,
            series: compact([item.SeriesName]),
            studios: getStringArray(item, 'Studios'),
            tags: getStringArray(item, 'Tags')
        },
        mediaType,
        title: getRecommendationTitle(item)
    };
}
