const REMOTE_SEARCH_RESULT_KEYS = [
    'SearchResults',
    'Items',
    'Results',
    'RemoteSearchResults',
    'Candidates'
];

const PROVIDER_SORT_ORDER = [
    'googlebooks',
    'comicvine',
    'openlibrary',
    'isbn'
];

const REMOTE_PROVIDER_NAMES_BY_KEY = {
    comicvine: 'Comic Vine',
    googlebooks: 'Google Books',
    openlibrary: 'Open Library'
};

const REMOTE_PROVIDER_KEYS_BY_NORMALIZED_KEY = {
    comicvine: 'ComicVine',
    googlebooks: 'GoogleBooks',
    googlebook: 'GoogleBooks',
    google: 'GoogleBooks',
    isbn: 'ISBN',
    openlibrary: 'OpenLibrary'
};

const BOOK_REMOTE_SEARCH_FIELDS = [
    'IndexNumber',
    'MetadataCountryCode',
    'MetadataLanguage',
    'Name',
    'OriginalTitle',
    'ParentIndexNumber',
    'Path',
    'PremiereDate',
    'ProviderIds',
    'SeriesName',
    'Year'
];

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getRemoteSearchResponseShape(response) {
    if (Array.isArray(response)) return 'array';
    if (response == null) return 'null';
    if (!isObject(response)) return typeof response;

    const keys = Object.keys(response);

    if (!keys.length) return 'object-empty';

    return `object:${keys.slice(0, 8).join(',')}`;
}

function findRemoteSearchResultArray(response, depth = 0) {
    if (Array.isArray(response)) return response;
    if (!isObject(response) || depth > 2) return null;

    for (const key of REMOTE_SEARCH_RESULT_KEYS) {
        if (Array.isArray(response[key])) return response[key];
    }

    for (const key of REMOTE_SEARCH_RESULT_KEYS) {
        const nested = findRemoteSearchResultArray(response[key], depth + 1);

        if (nested) return nested;
    }

    for (const value of Object.values(response)) {
        const nested = findRemoteSearchResultArray(value, depth + 1);

        if (nested) return nested;
    }

    return null;
}

export function normalizeRemoteSearchResults(response) {
    return findRemoteSearchResultArray(response) || [];
}

export function normalizeProviderKey(key) {
    return String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function getCanonicalProviderKey(key) {
    const trimmedKey = String(key || '').trim();
    const normalizedKey = normalizeProviderKey(trimmedKey);

    return REMOTE_PROVIDER_KEYS_BY_NORMALIZED_KEY[normalizedKey] || trimmedKey;
}

function getProviderNameForKey(key) {
    return REMOTE_PROVIDER_NAMES_BY_KEY[normalizeProviderKey(key)] || '';
}

function getProviderSortIndex(providerInfo) {
    const index = PROVIDER_SORT_ORDER.indexOf(normalizeProviderKey(providerInfo?.Key));

    return index === -1 ? PROVIDER_SORT_ORDER.length : index;
}

function getProviderDisplayName(providerInfo) {
    return String(providerInfo?.Name || providerInfo?.Key || '').trim();
}

export function dedupeExternalIdInfos(idList) {
    const providersByKey = new Map();

    (Array.isArray(idList) ? idList : []).forEach(providerInfo => {
        const originalKey = String(providerInfo?.Key || '').trim();
        const normalizedKey = normalizeProviderKey(originalKey);

        if (!normalizedKey) return;

        const existing = providersByKey.get(normalizedKey);

        if (!existing) {
            providersByKey.set(normalizedKey, {
                ...providerInfo,
                Key: originalKey
            });
            return;
        }

        const existingName = getProviderDisplayName(existing);
        const nextName = getProviderDisplayName(providerInfo);

        if (!existingName && nextName) {
            providersByKey.set(normalizedKey, {
                ...providerInfo,
                Key: existing.Key || originalKey
            });
        }
    });

    return Array.from(providersByKey.values()).sort((left, right) => {
        const priorityDiff = getProviderSortIndex(left) - getProviderSortIndex(right);

        if (priorityDiff) return priorityDiff;

        return getProviderDisplayName(left).localeCompare(getProviderDisplayName(right));
    });
}

export function sanitizeProviderIds(providerEntries) {
    return (Array.isArray(providerEntries) ? providerEntries : []).reduce((providerIds, entry) => {
        const key = getCanonicalProviderKey(entry?.key);
        const value = normalizeRemoteProviderIdValue(key, entry?.value);

        if (!key || !value) return providerIds;

        providerIds[key] = value;
        return providerIds;
    }, {});
}

function getUrlParamValue(value, paramName) {
    const rawValue = String(value || '');
    const queryStart = rawValue.indexOf('?');

    if (queryStart === -1) return '';

    const hashStart = rawValue.indexOf('#', queryStart);
    const query = hashStart === -1 ? rawValue.slice(queryStart + 1) : rawValue.slice(queryStart + 1, hashStart);
    const expectedName = String(paramName).toLowerCase();

    return query.split('&').reduce((foundValue, part) => {
        if (foundValue) return foundValue;

        const [rawName, rawParamValue = ''] = part.split('=');

        return rawName.toLowerCase() === expectedName ? decodeURIComponent(rawParamValue.split('+').join(' ')) : '';
    }, '');
}

function getLastUrlPathSegment(value) {
    const withoutHash = String(value || '').split('#')[0];
    const withoutQuery = withoutHash.split('?')[0];
    const parts = withoutQuery.split('/').filter(Boolean);

    return parts[parts.length - 1] || '';
}

function trimSlashes(value) {
    let output = String(value || '').trim();

    while (output.startsWith('/')) {
        output = output.slice(1);
    }

    while (output.endsWith('/')) {
        output = output.slice(0, -1);
    }

    return output;
}

function getComicVinePathFromUrl(value) {
    const rawValue = String(value || '').trim();
    const lowerValue = rawValue.toLowerCase();
    const host = 'comicvine.gamespot.com/';
    const hostIndex = lowerValue.indexOf(host);

    if (hostIndex === -1) return '';

    return trimSlashes(rawValue.slice(hostIndex + host.length).split('?')[0].split('#')[0]);
}

export function normalizeRemoteProviderIdValue(providerKey, value) {
    const rawValue = String(value || '').trim();

    if (!rawValue) return '';

    const normalizedKey = normalizeProviderKey(providerKey);

    if (normalizedKey === 'googlebooks') {
        const idParam = getUrlParamValue(rawValue, 'id');

        if (idParam) return idParam.trim();

        const lastPathSegment = getLastUrlPathSegment(rawValue);

        if (lastPathSegment && !lastPathSegment.includes('.')) {
            return lastPathSegment.split(/[?#]/)[0].trim();
        }

        return rawValue.split(/[?#]/)[0].trim();
    }

    if (normalizedKey === 'comicvine') {
        const comicVinePath = getComicVinePathFromUrl(rawValue);

        if (comicVinePath) {
            return comicVinePath;
        }

        return trimSlashes(rawValue);
    }

    return rawValue;
}

export function normalizeRemoteProviderIds(providerIds) {
    return Object.entries(isObject(providerIds) ? providerIds : {}).reduce((normalizedProviderIds, [rawKey, rawValue]) => {
        const key = getCanonicalProviderKey(rawKey);
        const value = normalizeRemoteProviderIdValue(key, rawValue);

        if (key && value) {
            normalizedProviderIds[key] = value;
        }

        return normalizedProviderIds;
    }, {});
}

function getRemoteSearchProviderKey(result) {
    const searchProviderName = result?.SearchProviderName || result?.searchProviderName || '';
    const searchProviderKey = getCanonicalProviderKey(searchProviderName);

    if (searchProviderKey) return searchProviderKey;

    return '';
}

function getRemoteSearchResultId(result) {
    return [
        result?.ProviderId,
        result?.providerId,
        result?.ExternalId,
        result?.externalId,
        result?.Id,
        result?.id
    ].find(value => String(value || '').trim());
}

export function normalizeRemoteSearchResultForApply(result) {
    const normalizedResult = isObject(result) ? { ...result } : {};
    const providerIds = normalizeRemoteProviderIds(normalizedResult.ProviderIds || normalizedResult.providerIds);
    const providerKey = getRemoteSearchProviderKey(normalizedResult);
    const providerId = getRemoteSearchResultId(normalizedResult);

    if (providerKey && providerId && !providerIds[providerKey]) {
        providerIds[providerKey] = normalizeRemoteProviderIdValue(providerKey, providerId);
    }

    normalizedResult.ProviderIds = providerIds;

    if (!normalizedResult.SearchProviderName && providerKey) {
        normalizedResult.SearchProviderName = getProviderNameForKey(providerKey);
    }

    return normalizedResult;
}

export function createMetadataSearchResultViewModel(result, index = 0) {
    const rawResult = normalizeRemoteSearchResultForApply(result);
    const providerIds = rawResult.ProviderIds || {};
    const [providerKey = '', providerId = ''] = Object.entries(providerIds)[0] || [];
    const displayTitle = String(rawResult.Name || rawResult.name || '').trim();
    const displayYear = Number(rawResult.ProductionYear || rawResult.Year || 0) || null;

    return {
        displayImageUrl: rawResult.ImageUrl || rawResult.imageUrl || '',
        displayOverview: rawResult.Overview || rawResult.overview || '',
        displayTitle,
        displayYear,
        key: [
            providerKey,
            providerId,
            displayTitle,
            displayYear,
            index
        ].filter(value => value != null && value !== '').join('|'),
        providerId,
        providerName: rawResult.SearchProviderName || getProviderNameForKey(providerKey) || '',
        rawResult
    };
}

export function getRemoteSearchApplyPayload(resultOrViewModel) {
    return normalizeRemoteSearchResultForApply(resultOrViewModel?.rawResult || resultOrViewModel);
}

export function hasRemoteSearchProviderIds(result) {
    return Object.values(result?.ProviderIds || {}).some(value => String(value || '').trim());
}

function getProviderEntryValue(providerEntries, normalizedKey) {
    return (Array.isArray(providerEntries) ? providerEntries : [])
        .find(entry => normalizeProviderKey(entry?.key) === normalizedKey && String(entry?.value || '').trim());
}

export function getPreferredRemoteSearchProviderName(providerEntries) {
    const googleBooksEntry = getProviderEntryValue(providerEntries, 'googlebooks');

    if (googleBooksEntry) {
        return googleBooksEntry.providerName || REMOTE_PROVIDER_NAMES_BY_KEY.googlebooks;
    }

    const comicVineEntry = getProviderEntryValue(providerEntries, 'comicvine');

    if (comicVineEntry) {
        return comicVineEntry.providerName || REMOTE_PROVIDER_NAMES_BY_KEY.comicvine;
    }

    return '';
}

export function buildRemoteSearchPayload(rawSearchInfo, itemId, itemType, providerEntries = []) {
    const searchInfo = {
        ...rawSearchInfo,
        ProviderIds: sanitizeProviderIds(providerEntries)
    };
    const requestBody = {
        IncludeDisabledProviders: true,
        SearchInfo: searchInfo
    };
    const providerName = getPreferredRemoteSearchProviderName(providerEntries);

    if (itemId) {
        requestBody.ItemId = itemId;
    }

    if (providerName) {
        requestBody.SearchProviderName = providerName;
    }

    if (itemType === 'Book') {
        const isbn = String(rawSearchInfo?.ISBN || searchInfo.ProviderIds.ISBN || searchInfo.ProviderIds.Isbn || searchInfo.ProviderIds.isbn || '').trim();
        const author = String(rawSearchInfo?.Author || '').trim();

        if (isbn && !searchInfo.ProviderIds.GoogleBooks) {
            requestBody.SearchProviderName = REMOTE_PROVIDER_NAMES_BY_KEY.googlebooks;
            searchInfo.Name = `isbn:${isbn.replace(/[^0-9Xx]/g, '')}`;
        } else if (author && !searchInfo.ProviderIds.GoogleBooks) {
            searchInfo.Name = [searchInfo.Name, author].filter(Boolean).join(' ');
        }

        requestBody.SearchInfo = BOOK_REMOTE_SEARCH_FIELDS.reduce((bookInfo, field) => {
            if (searchInfo[field] != null && searchInfo[field] !== '') {
                bookInfo[field] = searchInfo[field];
            }

            return bookInfo;
        }, {});

        if (!requestBody.SearchInfo.ProviderIds) {
            requestBody.SearchInfo.ProviderIds = {};
        }
    }

    return requestBody;
}

export function getReadingIdentifyName(item) {
    const name = item?.Name || '';
    const noExtension = String(name).replace(/\.(cbz|cbr|epub|pdf)$/i, '');
    const noBracketTags = removeDelimitedSegments(noExtension, '[', ']');
    const noReleaseTags = removeDelimitedSegments(noBracketTags, '(', ')', segment => (
        ['digital', 'scan', 'scanner', 'lucaz', 'nahga', 'empire'].some(term => segment.toLowerCase().includes(term))
    ));

    return noReleaseTags
        .replace(/\s+/g, ' ')
        .trim();
}

export function removeDelimitedSegments(value, open, close, shouldRemove = () => true) {
    let output = '';
    let cursor = 0;

    while (cursor < value.length) {
        const start = value.indexOf(open, cursor);

        if (start === -1) {
            output += value.slice(cursor);
            break;
        }

        const end = value.indexOf(close, start + 1);

        if (end === -1) {
            output += value.slice(cursor);
            break;
        }

        const segment = value.slice(start + 1, end);

        output += value.slice(cursor, start);
        output += shouldRemove(segment) ? ' ' : value.slice(start, end + 1);
        cursor = end + 1;
    }

    return output;
}
