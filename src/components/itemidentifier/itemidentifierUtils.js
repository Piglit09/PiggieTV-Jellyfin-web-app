import {
    normalizePtvReadingComparisonKey,
    parsePtvReadingFilename
} from '../../ptv/modules/books/readingFilename';

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

function getFirstText(...values) {
    return values.find(value => String(value || '').trim()) || '';
}

function getReadingNumber(value) {
    const parsed = Number.parseFloat(String(value ?? '').replace(/^0+(?=\d)/, ''));

    return Number.isFinite(parsed) ? parsed : null;
}

function getReadingProviderId(providerIds, providerKey) {
    const normalizedKey = normalizeProviderKey(providerKey);
    const entry = Object.entries(providerIds || {}).find(([key]) => normalizeProviderKey(key) === normalizedKey);

    return String(entry?.[1] || '').trim();
}

function formatReadingNumber(value) {
    return String(value);
}

function isAllowedProviderId(value, allowSlash) {
    return [...value].every(character => {
        const code = character.charCodeAt(0);
        const isAlphaNumeric = code >= 48 && code <= 57
            || code >= 65 && code <= 90
            || code >= 97 && code <= 122;

        return isAlphaNumeric || character === '_' || character === '-' || allowSlash && character === '/';
    });
}

export function getSafeReadingProviderLink(providerKey, providerId) {
    const normalizedKey = normalizeProviderKey(providerKey);
    const id = String(providerId || '').trim();

    if (!id || id.length > 300) return '';

    if (normalizedKey === 'googlebooks' && isAllowedProviderId(id, false)) {
        return `https://books.google.com/books?id=${encodeURIComponent(id)}`;
    }

    if (normalizedKey === 'comicvine' && isAllowedProviderId(id, true)) {
        const normalizedId = id.split('/').filter(Boolean).join('/');

        return normalizedId ? `https://comicvine.gamespot.com/${normalizedId}/` : '';
    }

    return '';
}

function hasMatchingReadingPrefix(value, expectedPrefix) {
    const normalizedValue = normalizePtvReadingComparisonKey(value);
    const normalizedPrefix = normalizePtvReadingComparisonKey(expectedPrefix);

    return Boolean(normalizedValue && normalizedPrefix && (
        normalizedValue === normalizedPrefix
        || normalizedValue.startsWith(`${normalizedPrefix} `)
        || normalizedPrefix.startsWith(`${normalizedValue} `)
    ));
}

export function isLikelyReadingMarketingTitle(value) {
    const text = String(value || '').trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    if (!text) return false;

    return wordCount > 15
        || (wordCount > 7 && /[!?]/.test(text))
        || (wordCount > 10 && /[.!?](?:\s|$)/.test(text));
}

function isBareReadingNumber(value) {
    let normalizedValue = String(value || '').trim().toLowerCase();
    const prefixes = ['volume', 'issue', 'vol.', 'vol', '#'];
    const prefix = prefixes.find(entry => normalizedValue.startsWith(entry));

    if (prefix) normalizedValue = normalizedValue.slice(prefix.length).trim();

    return normalizedValue !== '' && Number.isFinite(Number(normalizedValue));
}

function getReadingNumberKind(resultName, resultParsed, queryInfo) {
    if (resultParsed.issueNumber != null || resultName.trim().startsWith('#')) return 'issue';
    if (queryInfo.PtvReadingIssueNumber != null) return 'issue';

    return 'volume';
}

export function getReadingIdentifyInfo(item) {
    const sourceValue = getFirstText(item?.Path, item?.Name);
    const parsed = parsePtvReadingFilename(sourceValue);
    const providerIds = normalizeRemoteProviderIds(item?.ProviderIds);
    const explicitSeries = String(item?.SeriesName || item?.Album || item?.CollectionName || '').trim();
    const indexNumber = getReadingNumber(item?.IndexNumber)
        ?? parsed.issueNumber
        ?? parsed.volumeNumber;

    return {
        Author: String(item?.Author || '').trim(),
        ISBN: getReadingProviderId(providerIds, 'ISBN'),
        IndexNumber: indexNumber,
        Name: parsed.cleanTitle || item?.Name || '',
        ParentIndexNumber: item?.ParentIndexNumber ?? null,
        Path: item?.Path || '',
        ProviderIds: providerIds,
        PtvReadingIssueNumber: parsed.issueNumber,
        PtvReadingVolumeNumber: parsed.volumeNumber,
        SeriesName: explicitSeries || parsed.seriesTitle,
        Year: item?.ProductionYear || parsed.year || null
    };
}

function getReadingCandidateIdentity(result, searchInfo = {}) {
    const queryInfo = getReadingIdentifyInfo(searchInfo);
    const resultName = String(getFirstText(result?.Name, result?.name, result?.Title, result?.title)).trim();
    const resultParsed = parsePtvReadingFilename(resultName);
    const providerSeries = String(getFirstText(
        result?.SeriesName,
        result?.seriesName,
        result?.VolumeName,
        result?.volumeName,
        result?.Series,
        result?.series
    )).trim();
    const querySeries = String(getFirstText(searchInfo?.SeriesName, queryInfo.SeriesName)).trim();
    const resultNumber = getReadingNumber(result?.IndexNumber)
        ?? getReadingNumber(result?.IssueNumber)
        ?? resultParsed.issueNumber
        ?? resultParsed.volumeNumber;
    const queryNumber = getReadingNumber(searchInfo?.IndexNumber)
        ?? queryInfo.PtvReadingIssueNumber
        ?? queryInfo.PtvReadingVolumeNumber;
    const parsedSeriesTitle = resultParsed.seriesTitle && !isLikelyReadingMarketingTitle(resultParsed.seriesTitle) ?
        resultParsed.seriesTitle : querySeries;
    const seriesTitle = providerSeries || parsedSeriesTitle;
    const isBareNumber = isBareReadingNumber(resultName);
    const isMarketingCopy = isLikelyReadingMarketingTitle(resultName)
        && querySeries
        && !hasMatchingReadingPrefix(resultName, querySeries);
    const number = resultNumber ?? queryNumber;
    const numberKind = getReadingNumberKind(resultName, resultParsed, queryInfo);
    const numberLabel = numberKind === 'issue' ? '#' : 'Vol. ';
    let canonicalTitle = resultName;

    if (!canonicalTitle || isMarketingCopy) {
        canonicalTitle = queryInfo.Name || querySeries;
    } else if (seriesTitle && (isBareNumber || canonicalTitle === resultParsed.cleanTitle && isLikelyReadingMarketingTitle(canonicalTitle))) {
        canonicalTitle = number == null ? seriesTitle : `${seriesTitle} ${numberLabel}${formatReadingNumber(number)}`;
    } else if (providerSeries && resultNumber != null && !hasMatchingReadingPrefix(canonicalTitle, providerSeries)) {
        canonicalTitle = `${providerSeries} ${numberLabel}${formatReadingNumber(resultNumber)}`;
    }

    canonicalTitle = String(canonicalTitle || queryInfo.Name || seriesTitle || '').replace(/\s+/g, ' ').trim();

    return {
        canonicalTitle,
        isMarketingCopy,
        issueNumber: numberKind === 'issue' ? number : null,
        providerDisplayTitle: resultName,
        queryInfo,
        seriesTitle: seriesTitle || querySeries,
        volumeNumber: numberKind === 'volume' ? number : null
    };
}

export function normalizeReadingMetadataCandidate(result, searchInfo = {}) {
    const normalizedResult = normalizeRemoteSearchResultForApply(result);
    const identity = getReadingCandidateIdentity(normalizedResult, searchInfo);
    const resultOverview = String(normalizedResult.Overview || normalizedResult.overview || '').trim();
    const providerDisplayTitle = identity.providerDisplayTitle;
    const providerIds = normalizedResult.ProviderIds || {};
    const [providerKey = '', providerId = ''] = Object.entries(providerIds)[0] || [];
    const authors = getReadingPreviewTextList(normalizedResult.People || normalizedResult.Authors || normalizedResult.Creators);
    const aliases = getReadingPreviewTextList(normalizedResult.Aliases || normalizedResult.AlternateTitles);

    return {
        ...normalizedResult,
        IndexNumber: normalizedResult.IndexNumber ?? identity.issueNumber ?? identity.volumeNumber ?? null,
        Name: identity.canonicalTitle,
        Overview: resultOverview || (identity.isMarketingCopy ? providerDisplayTitle : ''),
        PtvProviderDisplayTitle: providerDisplayTitle,
        PtvReadingMetadata: {
            aliases,
            artwork: normalizedResult.ImageUrl || normalizedResult.imageUrl || '',
            authors,
            canonicalTitle: identity.canonicalTitle,
            description: resultOverview || (identity.isMarketingCopy ? providerDisplayTitle : ''),
            identifiers: providerIds,
            issueNumber: identity.issueNumber,
            providerDisplayTitle,
            providerId,
            providerKey,
            publicationDate: normalizedResult.PremiereDate || normalizedResult.PublishedDate || '',
            publicationYear: normalizedResult.ProductionYear || normalizedResult.Year || null,
            publisher: normalizedResult.Publisher || getReadingPreviewTextList(normalizedResult.Studios)[0] || '',
            seriesTitle: identity.seriesTitle,
            subtitle: normalizedResult.Subtitle || normalizedResult.OriginalTitle || '',
            tagline: normalizedResult.Tagline || normalizedResult.Deck || (identity.isMarketingCopy ? providerDisplayTitle : ''),
            volumeNumber: identity.volumeNumber
        },
        PtvReadingIssueNumber: identity.issueNumber,
        PtvReadingSeriesTitle: identity.seriesTitle,
        PtvReadingTitleWasNormalized: identity.canonicalTitle !== providerDisplayTitle,
        PtvReadingVolumeNumber: identity.volumeNumber,
        SeriesName: normalizedResult.SeriesName || identity.seriesTitle || ''
    };
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

function getReadingResultRank(rawResult, searchInfo, index) {
    const queryInfo = getReadingIdentifyInfo(searchInfo);
    const candidateInfo = getReadingCandidateIdentity(rawResult, searchInfo);
    const queryProviderIds = normalizeRemoteProviderIds(searchInfo?.ProviderIds);
    const candidateProviderIds = normalizeRemoteProviderIds(rawResult?.ProviderIds);
    const queryTitle = normalizePtvReadingComparisonKey(queryInfo.Name);
    const candidateTitle = normalizePtvReadingComparisonKey(candidateInfo.canonicalTitle);
    const querySeries = normalizePtvReadingComparisonKey(queryInfo.SeriesName);
    const candidateSeries = normalizePtvReadingComparisonKey(candidateInfo.seriesTitle);
    const queryNumber = getReadingNumber(searchInfo?.IndexNumber)
        ?? queryInfo.PtvReadingIssueNumber
        ?? queryInfo.PtvReadingVolumeNumber;
    const candidateNumber = getReadingNumber(rawResult?.IndexNumber)
        ?? candidateInfo.issueNumber
        ?? candidateInfo.volumeNumber;
    const queryIsbn = getReadingProviderId(queryProviderIds, 'ISBN');
    const candidateIsbn = getReadingProviderId(candidateProviderIds, 'ISBN');
    const stableProviderMatch = Object.entries(queryProviderIds).some(([key, value]) => (
        value && getReadingProviderId(candidateProviderIds, key) === value
    ));
    const reasons = [];
    let score = 0;

    if (stableProviderMatch) {
        score += 140;
        reasons.push('provider ID match');
    }

    if (queryIsbn && candidateIsbn) {
        if (queryIsbn === candidateIsbn) {
            score += 120;
            reasons.push('ISBN match');
        } else {
            score -= 90;
            reasons.push('different ISBN');
        }
    }

    if (querySeries && candidateSeries) {
        if (querySeries === candidateSeries) {
            score += 75;
            reasons.push('series match');
        } else if (hasMatchingReadingPrefix(candidateSeries, querySeries)) {
            score += 42;
            reasons.push('similar series');
        } else {
            score -= 45;
            reasons.push('different series');
        }
    }

    if (queryTitle && candidateTitle) {
        if (queryTitle === candidateTitle) {
            score += 85;
            reasons.push('title match');
        } else if (hasMatchingReadingPrefix(candidateTitle, queryTitle)) {
            score += 35;
            reasons.push('similar title');
        }
    }

    if (queryNumber != null && candidateNumber != null) {
        if (queryNumber === candidateNumber) {
            score += 55;
            reasons.push('volume/issue match');
        } else {
            score -= 70;
            reasons.push('different volume/issue');
        }
    }

    const queryYear = Number(searchInfo?.Year || queryInfo.Year || 0);
    const candidateYear = Number(rawResult?.ProductionYear || rawResult?.Year || 0);

    if (queryYear && candidateYear) {
        if (queryYear === candidateYear) {
            score += 10;
            reasons.push('year match');
        } else {
            score -= 5;
        }
    }

    const queryAuthor = normalizePtvReadingComparisonKey(searchInfo?.Author || queryInfo.Author);
    const candidateAuthor = normalizePtvReadingComparisonKey(getFirstText(
        rawResult?.Author,
        rawResult?.Authors?.[0]?.Name,
        rawResult?.People?.find(person => /author|writer|creator/i.test(person?.Type || ''))?.Name
    ));

    if (queryAuthor && candidateAuthor && hasMatchingReadingPrefix(candidateAuthor, queryAuthor)) {
        score += 18;
        reasons.push('author match');
    }

    if (candidateInfo.isMarketingCopy) score -= 15;
    if (rawResult?.ImageUrl || rawResult?.imageUrl) score += 2;
    if (rawResult?.Overview || rawResult?.overview) score += 1;

    let confidence = 'Review carefully';
    if (score >= 150) {
        confidence = 'Excellent match';
    } else if (score >= 95) {
        confidence = 'Strong match';
    } else if (score >= 45) {
        confidence = 'Possible match';
    }

    return {
        confidence,
        originalIndex: index,
        reason: reasons.filter(reason => !reason.startsWith('different ')).slice(0, 3).join(', ') || 'Provider result',
        score
    };
}

export function createMetadataSearchResultViewModel(result, index = 0, searchInfo = null) {
    const rawResult = searchInfo ?
        normalizeReadingMetadataCandidate(result, searchInfo) :
        normalizeRemoteSearchResultForApply(result);
    const providerIds = rawResult.ProviderIds || {};
    const [providerKey = '', providerId = ''] = Object.entries(providerIds)[0] || [];
    const displayTitle = String(rawResult.Name || rawResult.name || '').trim();
    const displayYear = Number(rawResult.ProductionYear || rawResult.Year || 0) || null;
    const rank = searchInfo ? getReadingResultRank(rawResult, searchInfo, index) : {
        confidence: '',
        originalIndex: index,
        reason: '',
        score: 0
    };

    return {
        confidence: rank.confidence,
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
        rankReason: rank.reason,
        rankScore: rank.score,
        originalIndex: rank.originalIndex,
        rawResult
    };
}

export function rankMetadataSearchResults(results, searchInfo = {}) {
    return (Array.isArray(results) ? results : [])
        .map((result, index) => createMetadataSearchResultViewModel(result, index, searchInfo))
        .sort((left, right) => {
            if (right.rankScore !== left.rankScore) return right.rankScore - left.rankScore;

            const providerDifference = getProviderSortIndex({ Key: left.providerName })
                - getProviderSortIndex({ Key: right.providerName });

            if (providerDifference) return providerDifference;

            const titleDifference = left.displayTitle.localeCompare(right.displayTitle);

            if (titleDifference) return titleDifference;

            const idDifference = String(left.providerId).localeCompare(String(right.providerId));

            return idDifference || left.originalIndex - right.originalIndex;
        });
}

function getReadingPreviewTextList(value) {
    return (Array.isArray(value) ? value : []).map(entry => (
        typeof entry === 'string' ? entry : entry?.Name || entry?.name || ''
    )).map(entry => String(entry).trim()).filter(Boolean);
}

function getReadingPreviewPeople(value) {
    return getReadingPreviewTextList(value).join(', ');
}

function getReadingPreviewProviderIds(value) {
    return Object.entries(normalizeRemoteProviderIds(value)).map(([key, id]) => `${key}: ${id}`).join('\n');
}

function getReadingPreviewOverview(value) {
    const source = String(value || '');
    let inTag = false;
    let text = '';

    for (const character of source) {
        if (character === '<') {
            inTag = true;
            text += ' ';
        } else if (character === '>') {
            inTag = false;
        } else if (!inTag) {
            text += character;
        }
    }

    return text.replace(/\s+/g, ' ').trim();
}

function getReadingPreviewValue(item, key) {
    switch (key) {
        case 'Name': return String(item?.Name || '').trim();
        case 'OriginalTitle': return String(item?.OriginalTitle || item?.Subtitle || '').trim();
        case 'SeriesName': return String(item?.SeriesName || '').trim();
        case 'IndexNumber': return item?.IndexNumber == null ? '' : String(item.IndexNumber);
        case 'ProductionYear': return item?.ProductionYear == null ? '' : String(item.ProductionYear);
        case 'PremiereDate': return String(item?.PremiereDate || item?.PublishedDate || '').slice(0, 10);
        case 'People': return getReadingPreviewPeople(item?.People || item?.Authors || item?.Creators || item?.Writers);
        case 'Studios': return getReadingPreviewTextList(item?.Studios).join(', ') || String(item?.Publisher || '').trim();
        case 'Genres': return getReadingPreviewTextList(item?.Genres || item?.GenreItems || item?.Categories).join(', ');
        case 'Overview': return getReadingPreviewOverview(item?.Overview || item?.Description);
        case 'ProviderIds': return getReadingPreviewProviderIds(item?.ProviderIds);
        case 'PrimaryImage': return String(item?.ImageUrl || item?.imageUrl || item?.ImageTags?.Primary || '').trim();
        default: return '';
    }
}

const READING_METADATA_PREVIEW_FIELDS = [
    ['Name', 'Name'],
    ['OriginalTitle', 'Original title / subtitle'],
    ['SeriesName', 'Series'],
    ['IndexNumber', 'Volume / issue'],
    ['ProductionYear', 'Year'],
    ['PremiereDate', 'Publication date'],
    ['People', 'Authors / creators'],
    ['Studios', 'Publisher / studio'],
    ['Genres', 'Genres / categories'],
    ['Overview', 'Overview'],
    ['ProviderIds', 'Provider IDs'],
    ['PrimaryImage', 'Primary image']
];

export function buildReadingMetadataPreview(currentItem, proposedResult) {
    const currentIdentity = getReadingIdentifyInfo(currentItem);
    const proposedIdentity = getReadingCandidateIdentity(proposedResult, currentItem);
    const currentSeries = currentIdentity.SeriesName;
    const titleSafe = Boolean(proposedIdentity.canonicalTitle)
        && !isLikelyReadingMarketingTitle(proposedIdentity.canonicalTitle)
        && (!currentSeries || hasMatchingReadingPrefix(proposedIdentity.seriesTitle || proposedIdentity.canonicalTitle, currentSeries));
    const hasCurrentPrimaryImage = Boolean(currentItem?.ImageTags?.Primary || currentItem?.PrimaryImageTag);

    return READING_METADATA_PREVIEW_FIELDS.map(([key, label]) => {
        const currentValue = getReadingPreviewValue(currentItem, key);
        const proposedValue = getReadingPreviewValue(proposedResult, key);
        const changed = normalizePtvReadingComparisonKey(currentValue) !== normalizePtvReadingComparisonKey(proposedValue);
        let safe = Boolean(proposedValue) && changed;
        let warning = '';

        if (key === 'Name' && !titleSafe) {
            safe = false;
            warning = 'Title does not strongly match the current series and is not selected automatically.';
        }

        if (key === 'PrimaryImage' && hasCurrentPrimaryImage) {
            safe = false;
            warning = 'An existing primary image will be kept unless replacement is selected.';
        }

        return {
            changed,
            currentValue,
            key,
            label,
            proposedValue,
            safe,
            selected: safe,
            warning
        };
    });
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
    const readingSearchInfo = itemType === 'Book' ? getReadingIdentifyInfo(rawSearchInfo) : rawSearchInfo;
    const searchInfo = {
        ...rawSearchInfo,
        ...readingSearchInfo,
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
    return getReadingIdentifyInfo(item).Name;
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
