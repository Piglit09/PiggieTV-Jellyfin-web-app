import type {
    PtvReadingItem,
    PtvReadingMetadataProvider,
    PtvReadingMetadataProviderId,
    PtvReadingMetadataStats
} from './booksTypes';

type MetadataProviderConfig = {
    aliases: string[];
    id: PtvReadingMetadataProviderId;
    label: string;
    providerKey: string;
    toUrl: (value: string) => string;
};

const HTTP_URL_PATTERN = /^https?:\/\//i;
const OPEN_LIBRARY_WORK_KEY_PATTERN = /^OL\d+W$/i;
const OPEN_LIBRARY_EDITION_KEY_PATTERN = /^OL\d+M$/i;
const OPEN_LIBRARY_AUTHOR_KEY_PATTERN = /^OL\d+A$/i;
const COMIC_VINE_BASE_URL = 'https://comicvine.gamespot.com';

function encodePath(value: string) {
    return value.split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/');
}

function normalizeProviderKey(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getProviderValue(item: PtvReadingItem | null | undefined, config: MetadataProviderConfig) {
    const providerIds = item?.ProviderIds;

    if (!providerIds) return '';

    const normalizedAliases = config.aliases.map(normalizeProviderKey);
    const matchedEntry = Object.entries(providerIds).find(([key]) => (
        normalizedAliases.includes(normalizeProviderKey(key))
    ));

    if (!matchedEntry) return '';

    return String(matchedEntry[1] || '').trim();
}

function getGoogleBooksUrl(value: string) {
    if (HTTP_URL_PATTERN.test(value)) return value;

    return `https://books.google.com/books?id=${encodeURIComponent(value)}`;
}

function getOpenLibraryUrl(value: string) {
    if (HTTP_URL_PATTERN.test(value)) return value;

    if (value.startsWith('/')) {
        return `https://openlibrary.org${encodePath(value)}`;
    }

    if (OPEN_LIBRARY_WORK_KEY_PATTERN.test(value)) {
        return `https://openlibrary.org/works/${encodeURIComponent(value)}`;
    }

    if (OPEN_LIBRARY_EDITION_KEY_PATTERN.test(value)) {
        return `https://openlibrary.org/books/${encodeURIComponent(value)}`;
    }

    if (OPEN_LIBRARY_AUTHOR_KEY_PATTERN.test(value)) {
        return `https://openlibrary.org/authors/${encodeURIComponent(value)}`;
    }

    return `https://openlibrary.org/search?q=${encodeURIComponent(value)}`;
}

function getComicVineUrl(value: string) {
    if (HTTP_URL_PATTERN.test(value)) return value;

    const path = value
        .replace(/^\/+/, '')
        .replace(/^comicvine\.gamespot\.com\/?/i, '');

    return `${COMIC_VINE_BASE_URL}/${encodePath(path)}`;
}

const METADATA_PROVIDER_CONFIGS: MetadataProviderConfig[] = [
    {
        aliases: ['GoogleBooks', 'Google Books', 'GoogleBook'],
        id: 'googlebooks',
        label: 'Google Books',
        providerKey: 'GoogleBooks',
        toUrl: getGoogleBooksUrl
    },
    {
        aliases: ['OpenLibrary', 'Open Library'],
        id: 'openlibrary',
        label: 'OpenLibrary',
        providerKey: 'OpenLibrary',
        toUrl: getOpenLibraryUrl
    },
    {
        aliases: ['ComicVine', 'Comic Vine'],
        id: 'comicvine',
        label: 'Comic Vine',
        providerKey: 'ComicVine',
        toUrl: getComicVineUrl
    }
];

export const EMPTY_PTV_READING_METADATA_STATS: PtvReadingMetadataStats = {
    itemCount: 0,
    providerCounts: {
        comicvine: 0,
        googlebooks: 0,
        openlibrary: 0
    }
};

export function getPtvReadingMetadataProviders(
    item: PtvReadingItem | null | undefined
): PtvReadingMetadataProvider[] {
    return METADATA_PROVIDER_CONFIGS.map(config => {
        const value = getProviderValue(item, config);

        if (!value) return null;

        return {
            id: config.id,
            label: config.label,
            providerKey: config.providerKey,
            url: config.toUrl(value),
            value
        };
    }).filter((provider): provider is PtvReadingMetadataProvider => Boolean(provider));
}

export function getPtvReadingMetadataStats(items: PtvReadingItem[]): PtvReadingMetadataStats {
    return items.reduce<PtvReadingMetadataStats>((stats, item) => {
        const providers = getPtvReadingMetadataProviders(item);

        if (!providers.length) return stats;

        return {
            itemCount: stats.itemCount + 1,
            providerCounts: providers.reduce<Record<PtvReadingMetadataProviderId, number>>((counts, provider) => ({
                ...counts,
                [provider.id]: counts[provider.id] + 1
            }), stats.providerCounts)
        };
    }, {
        itemCount: 0,
        providerCounts: {
            ...EMPTY_PTV_READING_METADATA_STATS.providerCounts
        }
    });
}
