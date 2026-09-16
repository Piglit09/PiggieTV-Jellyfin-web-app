
/**
 * Module for itemidentifier media item.
 * @module components/itemidentifier/itemidentifier
 */

import escapeHtml from 'escape-html';
import dialogHelper from '../dialogHelper/dialogHelper';
import loading from '../loading/loading';
import globalize from '../../lib/globalize';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import scrollHelper from '../../scripts/scrollHelper';
import layoutManager from '../layoutManager';
import focusManager from '../focusManager';
import browser from '../../scripts/browser';
import '../../elements/emby-input/emby-input';
import '../../elements/emby-checkbox/emby-checkbox';
import '../../elements/emby-button/paper-icon-button-light';
import '../formdialog.scss';
import 'material-design-icons-iconfont';
import '../cardbuilder/card.scss';
import toast from '../toast/toast';
import template from './itemidentifier.template.html';
import datetime from '../../scripts/datetime';
import { recordPtvEvent } from '../../ptv/core/observability';
import {
    classifyIdentifyAuthorityFailure,
    confirmGenericIdentifyMutation,
    createGenericIdentifyExpectedEffectProjection,
    GENERIC_IDENTIFY_READBACK_DELAYS_MS,
    GENERIC_IDENTIFY_READBACK_TIMEOUT_MS
} from './itemIdentifierExpectedEffects';
import {
    buildReadingMetadataPreview,
    buildRemoteSearchPayload,
    createIdentifyTerminalCoordinator,
    createMetadataSearchResultViewModel,
    dedupeExternalIdInfos,
    getReadingIdentifyInfo,
    getReadingIdentifyName,
    getReadingIdentifyApplyDisposition,
    getReadingIdentifyCompletionMessage,
    getReadingIdentifyFieldControlState,
    getReadingIdentifyReadbackState,
    getReadingIdentifyWritableFields,
    getSafeReadingProviderLink,
    getRemoteSearchApplyPayload,
    getRemoteSearchResponseShape,
    hasRemoteSearchProviderIds,
    normalizeProviderKey,
    normalizeReadingMetadataCandidate,
    normalizeRemoteProviderIds,
    normalizeRemoteSearchResultForApply,
    normalizeRemoteSearchResults,
    pollReadingIdentifyReadback,
    rankMetadataSearchResults,
    isReadingIdentifyFieldLocked,
    withReadingIdentifyDeadline
} from './itemidentifierUtils';
import './itemidentifier.scss';

const enableFocusTransform = !browser.slow && !browser.edge;
const IDENTIFY_SEARCH_SOFT_TIMEOUT_MS = 5000;
const IDENTIFY_SEARCH_HARD_TIMEOUT_MS = 20000;
const READING_IDENTIFY_APPLY_WRITE_TIMEOUT_MS = 45000;
const READING_IDENTIFY_READBACK_TIMEOUT_MS = 20000;
const READING_IDENTIFY_READBACK_DELAYS_MS = [0, 300, 750, 1500, 3000, 5000];

let currentItem;
let currentItemType;
let currentServerId;
let currentResolve;
let currentReject;
let hasChanges = false;
let currentSearchResult;
let currentSearchRequestId = 0;
let currentIdentifyApplyRequestId = 0;
let currentReadingMetadataPreview = [];
let currentReadingIdentifyApplyCoordinator = null;
let currentReadingIdentifyApplyPage = null;
let currentReadingIdentifyOwnerGeneration = null;
let currentIdentifyReadbackCode = null;
let currentIdentifyResultMode = 'item';

function isIdentifyPageConnected(page) {
    if (!page) return false;
    if (typeof page.isConnected === 'boolean') return page.isConnected;

    return typeof document === 'undefined' || !document.body || document.body.contains(page);
}

function isCurrentIdentifyApplyRequest(requestId) {
    return currentIdentifyApplyRequestId === requestId;
}

function canUpdateIdentifyApply(page, requestId) {
    return isCurrentIdentifyApplyRequest(requestId)
        && page?.dataset.identifyApplyLoading === 'true'
        && isIdentifyPageConnected(page);
}

function getApiClient() {
    return ServerConnections.getApiClient(currentServerId);
}

function redactDiagnosticUrl(url) {
    return String(url || '')
        .replace(/([?&](?:api_key|apikey|access_token|token)=)[^&]+/gi, '$1[redacted]')
        .replace(/(Authorization=)[^&]+/gi, '$1[redacted]');
}

function getDiagnosticError(error) {
    if (!error) return '';

    return error.message || error.statusText || error.status || String(error);
}

function getReadingIdentifyDiagnosticErrorCategory(error) {
    return classifyIdentifyAuthorityFailure(error);
}

function getReadingIdentifyFormat(item) {
    const path = item?.Path || '';
    const container = item?.Container || '';
    const sourceContainer = item?.MediaSources?.[0]?.Container || '';
    const sourceMimeType = item?.MediaSources?.[0]?.MimeType || '';

    return String(container || sourceContainer || sourceMimeType || path.split('.').pop() || '').toLowerCase();
}

function getReadingPersonName(item, types) {
    const people = Array.isArray(item?.People) ? item.People : [];
    const wantedTypes = types.map(type => type.toLowerCase());
    const person = people.find(entry => wantedTypes.includes(String(entry.Type || '').toLowerCase()))
        || people.find(entry => entry.Name);

    return person?.Name || '';
}

function getReadingLookupIssue(item) {
    if (item?.IndexNumber) return item.IndexNumber;

    return getReadingIdentifyInfo(item).IndexNumber ?? '';
}

function getReadingLookupSeries(item) {
    return getReadingIdentifyInfo(item).SeriesName;
}

function getReadingLookupIsbn(item) {
    const providerIds = item?.ProviderIds || {};

    return providerIds.ISBN || providerIds.Isbn || providerIds.isbn || '';
}

function getReadingLookupInfo(item) {
    if (!['Book', 'BoxSet', 'Photo'].includes(item?.Type)) return {};

    const readingInfo = getReadingIdentifyInfo(item);

    return {
        ...readingInfo,
        Author: getReadingPersonName(item, ['Author', 'Writer', 'Creator']),
        ISBN: getReadingLookupIsbn(item),
        ProviderIds: normalizeRemoteProviderIds(item?.ProviderIds),
        Year: item?.ProductionYear || readingInfo.Year || null
    };
}

function getUniqueTextList(values) {
    return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function stripHtmlTags(value) {
    let output = '';
    let insideTag = false;

    for (const char of String(value || '')) {
        if (char === '<') {
            insideTag = true;
            output += ' ';
            continue;
        }

        if (char === '>') {
            insideTag = false;
            output += ' ';
            continue;
        }

        if (!insideTag) {
            output += char;
        }
    }

    return output;
}

function decodeHtmlEntities(value) {
    if (!value) return '';

    const textarea = document.createElement('textarea');
    textarea.innerHTML = String(value);

    return textarea.value;
}

function cleanOverviewText(value) {
    return decodeHtmlEntities(stripHtmlTags(value)).replace(/\s+/g, ' ').trim();
}

function hasHtmlMarkup(value) {
    const text = String(value || '');
    let searchStartIndex = 0;

    while (searchStartIndex < text.length) {
        const startIndex = text.indexOf('<', searchStartIndex);

        if (startIndex === -1) {
            return false;
        }

        const endIndex = text.indexOf('>', startIndex + 1);

        if (endIndex === -1) {
            return false;
        }

        const tagBody = text.slice(startIndex + 1, endIndex).trim();

        if (!tagBody) {
            searchStartIndex = endIndex + 1;
            continue;
        }

        const normalizedTagBody = tagBody.startsWith('/') ? tagBody.slice(1) : tagBody;
        const firstChar = normalizedTagBody[0];
        const firstCharCode = String(firstChar || '').charCodeAt(0);

        if (firstChar === '!' || (firstCharCode >= 65 && firstCharCode <= 90) || (firstCharCode >= 97 && firstCharCode <= 122)) {
            return true;
        }

        searchStartIndex = endIndex + 1;
    }

    return false;
}

function getProviderIdsForDiagnostic(item) {
    return normalizeRemoteProviderIds(item?.ProviderIds);
}

function mergeProviderIds(...providerIdSources) {
    return providerIdSources.reduce((providerIds, providerIdSource) => ({
        ...providerIds,
        ...normalizeRemoteProviderIds(providerIdSource)
    }), {});
}

function getAppliedProviderIdMatches(item, applyResult) {
    const itemProviderIds = getProviderIdsForDiagnostic(item);
    const resultProviderIds = normalizeRemoteProviderIds(applyResult.ProviderIds);
    const normalizedItemProviderIds = Object.entries(itemProviderIds).reduce((providerIds, [key, value]) => {
        providerIds[normalizeProviderKey(key)] = String(value || '').trim();

        return providerIds;
    }, {});

    return Object.entries(resultProviderIds).every(([key, value]) => (
        normalizedItemProviderIds[normalizeProviderKey(key)] === String(value || '').trim()
    ));
}

function persistAppliedResultImage(apiClient, itemId, applyResult, replaceImages, diagnosticContext = {}) {
    const imageUrl = String(applyResult?.ImageUrl || applyResult?.imageUrl || '').trim();

    if (!replaceImages || !imageUrl || !apiClient?.downloadRemoteImage || !itemId) {
        return Promise.resolve(false);
    }

    const options = {
        ImageUrl: imageUrl,
        ProviderName: applyResult.SearchProviderName || 'Google Books',
        Type: 'Primary',
        itemId
    };
    const startedAt = performance.now();

    recordIdentifyAuthorityDiagnostic('ptv-identify-applied-image-save-started', {
        effectCategories: [ 'image-primary' ],
        operationGeneration: diagnosticContext.operationGeneration || null,
        ownerGeneration: diagnosticContext.ownerGeneration || null,
        phase: 'artwork-write'
    });

    return apiClient.downloadRemoteImage(options).then(() => {
        recordIdentifyAuthorityDiagnostic('ptv-identify-applied-image-save-completed', {
            durationMs: Number((performance.now() - startedAt).toFixed(1)),
            effectCategories: [ 'image-primary' ],
            operationGeneration: diagnosticContext.operationGeneration || null,
            ownerGeneration: diagnosticContext.ownerGeneration || null,
            phase: 'artwork-write'
        });

        return true;
    }, error => {
        recordIdentifyAuthorityDiagnostic('ptv-identify-applied-image-save-failed', {
            durationMs: Number((performance.now() - startedAt).toFixed(1)),
            effectCategories: [ 'image-primary' ],
            failureReason: getReadingIdentifyDiagnosticErrorCategory(error),
            operationGeneration: diagnosticContext.operationGeneration || null,
            ownerGeneration: diagnosticContext.ownerGeneration || null,
            phase: 'artwork-write'
        });

        return false;
    });
}

function getSearchProviderNameForProviderKey(providerKey, applyResult) {
    const searchProviderName = String(applyResult.SearchProviderName || '').trim();

    if (searchProviderName) return searchProviderName;

    const normalizedProviderKey = normalizeProviderKey(providerKey);

    if (normalizedProviderKey === 'comicvine') return 'Comic Vine';
    if (normalizedProviderKey === 'googlebooks') return 'Google Books';

    return providerKey;
}

function getProviderEntriesFromApplyResult(applyResult) {
    return Object.entries(applyResult.ProviderIds || {}).map(([key, value]) => ({
        key,
        providerName: getSearchProviderNameForProviderKey(key, applyResult),
        value
    })).filter(entry => String(entry.value || '').trim());
}

function getDetailedResultProviderMatch(detailedResult, applyResult) {
    const detailedProviderIds = detailedResult.ProviderIds || {};
    const appliedProviderIds = applyResult.ProviderIds || {};
    const normalizedDetailedIds = Object.entries(detailedProviderIds).reduce((providerIds, [key, value]) => {
        providerIds[normalizeProviderKey(key)] = String(value || '').trim();

        return providerIds;
    }, {});

    return Object.entries(appliedProviderIds).some(([key, value]) => (
        normalizedDetailedIds[normalizeProviderKey(key)] === String(value || '').trim()
    ));
}

function mergeRemoteSearchApplyResults(applyResult, detailedResult) {
    const mergedResult = {
        ...applyResult,
        ...detailedResult
    };

    [
        'Name',
        'OriginalTitle',
        'ImageUrl',
        'imageUrl',
        'Overview',
        'PremiereDate',
        'SearchProviderName',
        'SeriesName'
    ].forEach(key => {
        if (String(detailedResult?.[key] || '').trim()) return;
        if (applyResult?.[key] != null) {
            mergedResult[key] = applyResult[key];
        }
    });

    [
        'Genres',
        'GenreItems',
        'People',
        'Studios',
        'Tags'
    ].forEach(key => {
        if (Array.isArray(detailedResult?.[key]) && detailedResult[key].length) return;
        if (Array.isArray(applyResult?.[key])) {
            mergedResult[key] = applyResult[key];
        }
    });

    return {
        ...mergedResult,
        ProviderIds: mergeProviderIds(applyResult.ProviderIds, detailedResult.ProviderIds),
        SearchProviderName: mergedResult.SearchProviderName || applyResult.SearchProviderName
    };
}

function getProviderIdValue(providerIds, providerKey) {
    const normalizedProviderKey = normalizeProviderKey(providerKey);
    const entry = Object.entries(providerIds || {}).find(([key]) => normalizeProviderKey(key) === normalizedProviderKey);

    return String(entry?.[1] || '').trim();
}

function getProviderEntryValue(providerIdEntries, providerKey) {
    const normalizedProviderKey = normalizeProviderKey(providerKey);
    const entry = (Array.isArray(providerIdEntries) ? providerIdEntries : []).find(providerEntry => (
        normalizeProviderKey(providerEntry?.key) === normalizedProviderKey
    ));

    return String(entry?.value || '').trim();
}

function isBookIdentifyLookup() {
    return currentItemType === 'Book' || currentItem?.Type === 'Book';
}

function isPtvNativeMetadataResult(result) {
    const providerName = String(result?.SearchProviderName || result?.Provider || result?.ProviderName || '').toLowerCase();

    return Boolean(result?.PtvNativeProvider)
        || providerName.includes('google books')
        || Boolean(getProviderIdValue(result?.ProviderIds, 'GoogleBooks'));
}

function getNativeGoogleBooksSearchUrl(apiClient, lookupInfo, providerIdEntries) {
    if (!isBookIdentifyLookup()) return '';

    const providerIds = lookupInfo.ProviderIds || {};
    const googleBooksId = getProviderEntryValue(providerIdEntries, 'GoogleBooks')
        || getProviderIdValue(providerIds, 'GoogleBooks');
    const isbn = String(lookupInfo.ISBN || getProviderEntryValue(providerIdEntries, 'ISBN') || getProviderIdValue(providerIds, 'ISBN') || '').trim();
    const title = String(lookupInfo.Name || currentItem?.Name || '').trim();
    const author = String(lookupInfo.Author || '').trim();

    if (!googleBooksId && !isbn && !title) return '';

    return apiClient.getUrl('Ptv/v1/reading/metadata/googlebooks/search', {
        author,
        googleBooksId,
        isbn,
        itemId: currentItem?.Id || '',
        limit: 10,
        title,
        year: lookupInfo.Year || ''
    });
}

function searchNativeGoogleBooks(apiClient, lookupInfo, providerIdEntries) {
    const requestUrl = getNativeGoogleBooksSearchUrl(apiClient, lookupInfo, providerIdEntries);

    if (!requestUrl) {
        return Promise.resolve({
            endpoint: '',
            error: null,
            responseShape: 'skipped',
            results: []
        });
    }

    const startedAt = performance.now();

    recordIdentificationDiagnostic('ptv-reading-identify-native-googlebooks-search-started', {
        endpoint: redactDiagnosticUrl(requestUrl),
        httpMethod: 'GET'
    });

    return withIdentificationHardTimeout(apiClient.getJSON(requestUrl), IDENTIFY_SEARCH_HARD_TIMEOUT_MS)
        .then(response => {
            const results = normalizeRemoteSearchResults(response).map(result => normalizeReadingMetadataCandidate(result, lookupInfo));

            recordIdentificationDiagnostic('ptv-reading-identify-native-googlebooks-search-completed', {
                durationMs: Number((performance.now() - startedAt).toFixed(1)),
                endpoint: redactDiagnosticUrl(requestUrl),
                responseShape: getRemoteSearchResponseShape(response),
                resultCount: results.length
            });

            return {
                endpoint: requestUrl,
                error: null,
                responseShape: getRemoteSearchResponseShape(response),
                results
            };
        }, error => {
            recordIdentificationDiagnostic('ptv-reading-identify-native-googlebooks-search-failed', {
                durationMs: Number((performance.now() - startedAt).toFixed(1)),
                endpoint: redactDiagnosticUrl(requestUrl),
                error: getDiagnosticError(error),
                status: error?.status || error?.StatusCode || 'error'
            });

            return {
                endpoint: requestUrl,
                error,
                responseShape: 'error',
                results: []
            };
        });
}

function getIdentificationResultDedupeKey(result) {
    const providerIds = normalizeRemoteProviderIds(result?.ProviderIds);
    const providerKey = getProviderIdValue(providerIds, 'GoogleBooks')
        || getProviderIdValue(providerIds, 'ComicVine')
        || getProviderIdValue(providerIds, 'ISBN')
        || getProviderIdValue(providerIds, 'OpenLibrary');

    if (providerKey) return `provider:${providerKey.toLowerCase()}`;

    return [
        String(result?.Name || '').trim().toLowerCase(),
        String(result?.ProductionYear || '').trim(),
        String(result?.SearchProviderName || '').trim().toLowerCase()
    ].join('|');
}

function mergeIdentificationResults(...resultSets) {
    const resultsByKey = new Map();

    resultSets.flat().forEach(result => {
        const key = getIdentificationResultDedupeKey(result);

        if (!key || resultsByKey.has(key)) return;

        resultsByKey.set(key, result);
    });

    return Array.from(resultsByKey.values());
}

function resolveDetailedRemoteSearchResult(apiClient, itemId, applyResult) {
    if (isPtvNativeMetadataResult(applyResult)) {
        return Promise.resolve(applyResult);
    }

    const providerEntries = getProviderEntriesFromApplyResult(applyResult);

    if (!providerEntries.length || !currentItemType) {
        return Promise.resolve(applyResult);
    }

    const lookupRequest = buildRemoteSearchPayload(getReadingLookupInfo(currentItem), itemId, currentItemType, providerEntries);
    const requestUrl = apiClient.getUrl(`Items/RemoteSearch/${currentItemType}`);
    const startedAt = performance.now();

    recordIdentifyAuthorityDiagnostic('ptv-identify-detail-lookup-started', {
        phase: 'provider-detail-lookup'
    });

    return withIdentificationHardTimeout(apiClient.ajax({
        type: 'POST',
        url: requestUrl,
        data: JSON.stringify(lookupRequest),
        contentType: 'application/json',
        dataType: 'json'

    }), IDENTIFY_SEARCH_HARD_TIMEOUT_MS).then(response => {
        const searchInfo = getReadingLookupInfo(currentItem);
        const detailedResults = normalizeRemoteSearchResults(response).map(result => (
            isBookIdentifyLookup() ?
                normalizeReadingMetadataCandidate(result, searchInfo) :
                normalizeRemoteSearchResultForApply(result)
        ));
        const detailedResult = detailedResults.find(result => getDetailedResultProviderMatch(result, applyResult)) || detailedResults[0];
        const mergedResult = detailedResult ? mergeRemoteSearchApplyResults(applyResult, detailedResult) : applyResult;
        const normalizedMergedResult = isBookIdentifyLookup() ?
            normalizeReadingMetadataCandidate(mergedResult, searchInfo) :
            mergedResult;

        recordIdentifyAuthorityDiagnostic('ptv-identify-detail-lookup-completed', {
            durationMs: Number((performance.now() - startedAt).toFixed(1)),
            phase: 'provider-detail-lookup',
            resultCount: detailedResults.length,
            resultShape: detailedResult ? 'matched' : 'fallback'
        });

        return normalizedMergedResult;
    }, error => {
        recordIdentifyAuthorityDiagnostic('ptv-identify-detail-lookup-failed', {
            durationMs: Number((performance.now() - startedAt).toFixed(1)),
            failureReason: getReadingIdentifyDiagnosticErrorCategory(error),
            phase: 'provider-detail-lookup'
        });

        return applyResult;
    });
}

function normalizeUpdateStudios(studios) {
    return (Array.isArray(studios) ? studios : []).map(studio => {
        if (typeof studio === 'string') {
            return { Name: studio };
        }

        return { ...studio, Name: studio?.Name || '' };
    }).filter(studio => studio.Name);
}

function isMetadataFieldLocked(item, field) {
    return isReadingIdentifyFieldLocked(item, field);
}

function getResultTextList(applyResult, ...keys) {
    return getUniqueTextList(keys.flatMap(key => {
        const value = applyResult?.[key];

        if (Array.isArray(value)) {
            return value.map(entry => (
                typeof entry === 'string' ? entry : entry?.Name || entry?.name || ''
            ));
        }

        if (typeof value === 'string') {
            return value.split(/[;,]/);
        }

        return [];
    }));
}

function normalizeResultPeople(people, defaultType = '') {
    return (Array.isArray(people) ? people : []).map(person => {
        if (typeof person === 'string') {
            return {
                Name: person,
                Type: defaultType
            };
        }

        return {
            ...person,
            Name: person?.Name || person?.name || '',
            Type: person?.Type || person?.type || defaultType
        };
    }).filter(person => person.Name);
}

function getResultPeople(applyResult) {
    const people = normalizeResultPeople(applyResult?.People);
    const authors = normalizeResultPeople(applyResult?.Authors || applyResult?.AuthorItems, 'Author');
    const writers = normalizeResultPeople(applyResult?.Writers || applyResult?.WriterItems, 'Writer');
    const artists = normalizeResultPeople(applyResult?.Artists, 'Artist');
    const creators = normalizeResultPeople(applyResult?.Creators || applyResult?.CreatorItems, 'Creator');

    return [...people, ...authors, ...writers, ...artists, ...creators].reduce((dedupedPeople, person) => {
        const key = `${normalizeProviderKey(person.Type)}|${normalizeProviderKey(person.Name)}`;

        if (!dedupedPeople.seen.has(key)) {
            dedupedPeople.seen.add(key);
            dedupedPeople.items.push(person);
        }

        return dedupedPeople;
    }, {
        items: [],
        seen: new Set()
    }).items;
}

function getResultStudios(applyResult) {
    return normalizeUpdateStudios([
        ...(Array.isArray(applyResult?.Studios) ? applyResult.Studios : []),
        ...getResultTextList(applyResult, 'Publisher', 'Publishers')
    ]);
}

function shouldApplyMetadataField(selectedFields, field) {
    return !Array.isArray(selectedFields) || selectedFields.includes(field);
}

function getExpectedApplyFields(item, applyResult, selectedFields = null) {
    const resultOverview = cleanOverviewText(applyResult?.Overview);
    const resultGenres = getResultTextList(applyResult, 'Genres', 'GenreItems');
    const resultPeople = getResultPeople(applyResult);
    const resultStudios = getResultStudios(applyResult);
    const resultTags = getResultTextList(applyResult, 'Tags');
    const expected = [];

    if (shouldApplyMetadataField(selectedFields, 'Name') && !isMetadataFieldLocked(item, 'Name') && String(applyResult?.Name || '').trim()) {
        expected.push('title');
    }

    if (shouldApplyMetadataField(selectedFields, 'OriginalTitle') && !isMetadataFieldLocked(item, 'OriginalTitle') && String(applyResult?.OriginalTitle || '').trim()) {
        expected.push('originalTitle');
    }

    if (shouldApplyMetadataField(selectedFields, 'SeriesName') && !isMetadataFieldLocked(item, 'SeriesName') && String(applyResult?.SeriesName || '').trim()) {
        expected.push('series');
    }

    if (shouldApplyMetadataField(selectedFields, 'IndexNumber') && !isMetadataFieldLocked(item, 'IndexNumber') && applyResult?.IndexNumber != null) {
        expected.push('volumeIssue');
    }

    if (shouldApplyMetadataField(selectedFields, 'Overview') && !isMetadataFieldLocked(item, 'Overview') && resultOverview) {
        expected.push('overview');
    }

    if (shouldApplyMetadataField(selectedFields, 'Genres') && !isMetadataFieldLocked(item, 'Genres') && resultGenres.length) {
        expected.push('genres');
    }

    if (shouldApplyMetadataField(selectedFields, 'People') && !isMetadataFieldLocked(item, 'People') && resultPeople.length) {
        expected.push('people');
    }

    if (shouldApplyMetadataField(selectedFields, 'Studios') && !isMetadataFieldLocked(item, 'Studios') && resultStudios.length) {
        expected.push('studios');
    }

    if (shouldApplyMetadataField(selectedFields, 'Tags') && !isMetadataFieldLocked(item, 'Tags') && resultTags.length) {
        expected.push('tags');
    }

    if (shouldApplyMetadataField(selectedFields, 'ProductionYear') && Number(applyResult?.ProductionYear || 0) && !isMetadataFieldLocked(item, 'ProductionYear')) {
        expected.push('year');
    }

    if (shouldApplyMetadataField(selectedFields, 'PremiereDate') && String(applyResult?.PremiereDate || '').trim() && !isMetadataFieldLocked(item, 'PremiereDate')) {
        expected.push('premiereDate');
    }

    if (shouldApplyMetadataField(selectedFields, 'ProviderIds') && hasRemoteSearchProviderIds(applyResult)) {
        expected.push('providerIds');
    }

    return expected;
}

function getApplyPersistenceReport(item, applyResult, selectedFields = null) {
    const providerLinked = getAppliedProviderIdMatches(item, applyResult);
    const expected = getExpectedApplyFields(item, applyResult, selectedFields);
    const applied = [];
    const missing = [];
    const resultOverview = cleanOverviewText(applyResult?.Overview);
    const resultGenres = getResultTextList(applyResult, 'Genres', 'GenreItems');
    const resultPeople = getResultPeople(applyResult);
    const resultStudios = getResultStudios(applyResult);
    const resultTags = getResultTextList(applyResult, 'Tags');

    function check(field, passed) {
        if (!expected.includes(field)) return;

        (passed ? applied : missing).push(field);
    }

    check('title', String(item?.Name || '').trim() === String(applyResult?.Name || '').trim());
    check('originalTitle', String(item?.OriginalTitle || '').trim() === String(applyResult?.OriginalTitle || '').trim());
    check('series', String(item?.SeriesName || '').trim() === String(applyResult?.SeriesName || '').trim());
    check('volumeIssue', Number(item?.IndexNumber) === Number(applyResult?.IndexNumber));
    check('overview', !resultOverview || (cleanOverviewText(item?.Overview) === resultOverview && !hasHtmlMarkup(item?.Overview)));
    check('genres', resultGenres.some(genre => (item?.Genres || []).some(itemGenre => normalizeProviderKey(itemGenre) === normalizeProviderKey(genre))));
    check('people', resultPeople.some(person => (item?.People || []).some(itemPerson => normalizeProviderKey(itemPerson?.Name) === normalizeProviderKey(person.Name))));
    check('studios', resultStudios.some(studio => (item?.Studios || []).some(itemStudio => normalizeProviderKey(itemStudio?.Name) === normalizeProviderKey(studio.Name))));
    check('tags', resultTags.some(tag => (item?.Tags || []).some(itemTag => normalizeProviderKey(itemTag) === normalizeProviderKey(tag))));
    check('year', Number(item?.ProductionYear || 0) === Number(applyResult?.ProductionYear || 0));
    check('premiereDate', Boolean(item?.PremiereDate));
    check('providerIds', providerLinked);

    return {
        applied,
        expected,
        missing,
        providerLinked
    };
}

function getMetadataUpdateItem(item, applyResult, selectedFields = null) {
    const resultOverview = cleanOverviewText(applyResult.Overview);
    const resultYear = Number(applyResult.ProductionYear || 0);
    const lockedFields = Array.isArray(item.LockedFields) ? item.LockedFields : [];
    const resultGenres = getResultTextList(applyResult, 'Genres', 'GenreItems');
    const resultPeople = getResultPeople(applyResult);
    const resultStudios = getResultStudios(applyResult);
    const resultTags = getResultTextList(applyResult, 'Tags');
    const itemPeople = Array.isArray(item.People) ? item.People : [];
    const itemStudios = normalizeUpdateStudios(item.Studios);
    const itemTags = Array.isArray(item.Tags) ? item.Tags : [];
    const people = !shouldApplyMetadataField(selectedFields, 'People') || isMetadataFieldLocked(item, 'People') || !resultPeople.length ? itemPeople : resultPeople;
    const studios = !shouldApplyMetadataField(selectedFields, 'Studios') || isMetadataFieldLocked(item, 'Studios') || !resultStudios.length ? itemStudios : resultStudios;
    const tags = !shouldApplyMetadataField(selectedFields, 'Tags') || isMetadataFieldLocked(item, 'Tags') ? itemTags : getUniqueTextList([
        ...resultTags,
        ...itemTags
    ]);

    return {
        AirDays: Array.isArray(item.AirDays) ? item.AirDays : [],
        AirTime: item.AirTime || '',
        Album: item.Album || '',
        AlbumArtists: Array.isArray(item.AlbumArtists) ? item.AlbumArtists : [],
        ArtistItems: Array.isArray(item.ArtistItems) ? item.ArtistItems : [],
        CommunityRating: item.CommunityRating || null,
        CriticRating: item.CriticRating || null,
        CustomRating: item.CustomRating || '',
        DateCreated: item.DateCreated || null,
        EndDate: item.EndDate || null,
        ForcedSortName: item.ForcedSortName || '',
        Genres: !shouldApplyMetadataField(selectedFields, 'Genres') || isMetadataFieldLocked(item, 'Genres') ? item.Genres || [] : getUniqueTextList([
            ...(resultGenres.length ? resultGenres : []),
            ...(Array.isArray(item.Genres) ? item.Genres : [])
        ]),
        Id: item.Id,
        IndexNumber: !shouldApplyMetadataField(selectedFields, 'IndexNumber') || isMetadataFieldLocked(item, 'IndexNumber') ? item.IndexNumber ?? null : applyResult.IndexNumber ?? item.IndexNumber ?? null,
        LockData: Boolean(item.LockData),
        LockedFields: lockedFields,
        Name: !shouldApplyMetadataField(selectedFields, 'Name') || isMetadataFieldLocked(item, 'Name') ? item.Name || '' : applyResult.Name || item.Name || currentItem?.Name || '',
        OfficialRating: item.OfficialRating || '',
        OriginalTitle: !shouldApplyMetadataField(selectedFields, 'OriginalTitle') || isMetadataFieldLocked(item, 'OriginalTitle') ? item.OriginalTitle || '' : applyResult.OriginalTitle || item.OriginalTitle || '',
        Overview: !shouldApplyMetadataField(selectedFields, 'Overview') || isMetadataFieldLocked(item, 'Overview') ? item.Overview || '' : resultOverview || item.Overview || '',
        ParentIndexNumber: !shouldApplyMetadataField(selectedFields, 'IndexNumber') || isMetadataFieldLocked(item, 'ParentIndexNumber') ? item.ParentIndexNumber ?? null : applyResult.ParentIndexNumber ?? item.ParentIndexNumber ?? null,
        People: people,
        PreferredMetadataCountryCode: item.PreferredMetadataCountryCode || '',
        PreferredMetadataLanguage: item.PreferredMetadataLanguage || '',
        PremiereDate: !shouldApplyMetadataField(selectedFields, 'PremiereDate') || isMetadataFieldLocked(item, 'PremiereDate') ? item.PremiereDate || null : applyResult.PremiereDate || item.PremiereDate || null,
        ProductionYear: !shouldApplyMetadataField(selectedFields, 'ProductionYear') || isMetadataFieldLocked(item, 'ProductionYear') ? item.ProductionYear || null : resultYear || item.ProductionYear || null,
        ProviderIds: shouldApplyMetadataField(selectedFields, 'ProviderIds') ? mergeProviderIds(item.ProviderIds, applyResult.ProviderIds) : item.ProviderIds || {},
        RunTimeTicks: item.RunTimeTicks || null,
        SeriesName: !shouldApplyMetadataField(selectedFields, 'SeriesName') || isMetadataFieldLocked(item, 'SeriesName') ? item.SeriesName || '' : applyResult.SeriesName || item.SeriesName || '',
        Status: item.Status || '',
        Studios: studios,
        Tags: tags
    };
}

function getGenericIdentifyIntendedFields(item, applyResult) {
    const fields = [];
    const addTextField = (field, value) => {
        if (String(value || '').trim() && !isMetadataFieldLocked(item, field)) fields.push(field);
    };

    addTextField('Name', applyResult.Name);
    addTextField('OriginalTitle', applyResult.OriginalTitle);
    addTextField('SeriesName', applyResult.SeriesName);
    addTextField('Overview', cleanOverviewText(applyResult.Overview));

    if (applyResult.IndexNumber != null && !isMetadataFieldLocked(item, 'IndexNumber')) fields.push('IndexNumber');
    if (applyResult.ParentIndexNumber != null && !isMetadataFieldLocked(item, 'ParentIndexNumber')) fields.push('ParentIndexNumber');
    if (Number(applyResult.ProductionYear || 0) && !isMetadataFieldLocked(item, 'ProductionYear')) fields.push('ProductionYear');
    if (String(applyResult.PremiereDate || '').trim() && !isMetadataFieldLocked(item, 'PremiereDate')) fields.push('PremiereDate');
    if (getResultTextList(applyResult, 'Genres', 'GenreItems').length && !isMetadataFieldLocked(item, 'Genres')) fields.push('Genres');
    if (getResultPeople(applyResult).length && !isMetadataFieldLocked(item, 'People')) fields.push('People');
    if (getResultStudios(applyResult).length && !isMetadataFieldLocked(item, 'Studios')) fields.push('Studios');
    if (getResultTextList(applyResult, 'Tags').length && !isMetadataFieldLocked(item, 'Tags')) fields.push('Tags');
    if (Object.values(normalizeRemoteProviderIds(applyResult.ProviderIds)).some(value => String(value || '').trim())) fields.push('ProviderIds');

    return Array.from(new Set(fields));
}

function shouldPersistAppliedResultFields(item, applyResult) {
    const resultOverview = cleanOverviewText(applyResult.Overview);
    const resultYear = Number(applyResult.ProductionYear || 0);
    const report = getApplyPersistenceReport(item, applyResult);

    if (report.missing.length) return true;
    if (String(applyResult?.Name || '').trim() && !isMetadataFieldLocked(item, 'Name') && String(item?.Name || '').trim() !== String(applyResult.Name || '').trim()) return true;
    if (resultOverview && (cleanOverviewText(item?.Overview) !== resultOverview || hasHtmlMarkup(item?.Overview))) return true;
    if (resultYear && Number(item?.ProductionYear || 0) !== resultYear) return true;

    return !getAppliedProviderIdMatches(item, applyResult);
}

function persistAppliedResultFields(apiClient, item, applyResult, selectedFields = null, force = false, readBack = true, diagnosticContext = {}) {
    if (!apiClient?.updateItem || !item?.Id || (!force && !shouldPersistAppliedResultFields(item, applyResult))) {
        return Promise.resolve(item);
    }

    const userId = apiClient.getCurrentUserId?.();
    const updateItem = getMetadataUpdateItem(item, applyResult, selectedFields);
    const confirmedUpdate = {
        ...item,
        ...updateItem
    };
    const startedAt = performance.now();

    recordIdentifyAuthorityDiagnostic('ptv-identify-applied-fields-save-started', {
        effectCategories: diagnosticContext.effectCategories || [],
        operationGeneration: diagnosticContext.operationGeneration || null,
        ownerGeneration: diagnosticContext.ownerGeneration || null,
        phase: 'metadata-write'
    });

    return apiClient.updateItem(updateItem).then(() => {
        recordIdentifyAuthorityDiagnostic('ptv-identify-applied-fields-save-completed', {
            durationMs: Number((performance.now() - startedAt).toFixed(1)),
            effectCategories: diagnosticContext.effectCategories || [],
            operationGeneration: diagnosticContext.operationGeneration || null,
            ownerGeneration: diagnosticContext.ownerGeneration || null,
            phase: 'metadata-write'
        });

        if (!readBack || !userId || !apiClient.getItem) {
            return confirmedUpdate;
        }

        return apiClient.getItem(userId, updateItem.Id)
            .then(refreshedItem => refreshedItem)
            .catch(() => confirmedUpdate);
    }, error => {
        recordIdentifyAuthorityDiagnostic('ptv-identify-applied-fields-save-failed', {
            durationMs: Number((performance.now() - startedAt).toFixed(1)),
            effectCategories: diagnosticContext.effectCategories || [],
            failureReason: getReadingIdentifyDiagnosticErrorCategory(error),
            operationGeneration: diagnosticContext.operationGeneration || null,
            ownerGeneration: diagnosticContext.ownerGeneration || null,
            phase: 'metadata-write'
        });

        if (force) throw error;

        return item;
    });
}

function getReadingLookupFields(item) {
    if (!['Book', 'BoxSet', 'Photo'].includes(item?.Type)) return [];

    return [
        {
            label: 'Author / creator',
            lookup: 'Author',
            type: 'text',
            value: getReadingPersonName(item, ['Author', 'Writer', 'Creator'])
        },
        {
            label: 'Series',
            lookup: 'SeriesName',
            type: 'text',
            value: getReadingLookupSeries(item)
        },
        {
            label: 'Volume / issue',
            lookup: 'IndexNumber',
            type: 'number',
            value: getReadingLookupIssue(item)
        },
        {
            label: 'ISBN',
            lookup: 'ISBN',
            type: 'text',
            value: getReadingLookupIsbn(item)
        }
    ];
}

function getReadingLookupFieldHtml(item) {
    const fields = getReadingLookupFields(item);

    if (!fields.length) return '';

    return fields.map(field => {
        const id = `txtLookup${field.lookup}`;

        return '<div class="inputContainer">'
            + `<input is="emby-input" type="${field.type}" id="${id}" class="identifyField" data-lookup="${field.lookup}" label="${escapeHtml(field.label)}" value="${escapeHtml(String(field.value))}" />`
            + '</div>';
    }).join('');
}

function recordIdentificationDiagnostic(name, detail) {
    recordPtvEvent('api', name, {
        itemId: currentItem?.Id || null,
        itemName: currentItem?.Name || null,
        itemType: currentItemType || currentItem?.Type || null,
        libraryId: currentItem?.ParentId || null,
        mediaFormat: getReadingIdentifyFormat(currentItem),
        mediaSourceType: currentItem?.MediaType || null,
        parentId: currentItem?.ParentId || null,
        route: window.location?.hash || window.location?.pathname || '',
        serverId: currentServerId || null,
        ...detail
    });
}

function getIdentifyItemTypeCategory() {
    const category = String(currentItemType || currentItem?.Type || '')
        .replace(/[^a-z0-9]/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-/, '')
        .replace(/-$/, '')
        .toLowerCase();

    return category || 'unknown';
}

function recordIdentifyAuthorityDiagnostic(name, detail = {}) {
    recordPtvEvent('api', name, {
        itemTypeCategory: getIdentifyItemTypeCategory(),
        ...detail
    });
}

function setSearchSubmitDisabled(page, disabled) {
    const submitButton = page.querySelector('.popupIdentifyForm button[type="submit"]');

    if (submitButton) {
        submitButton.disabled = disabled;
    }
}

function showSearchStatus(page, message, state = 'info') {
    const identificationSearchResults = page.querySelector('.identificationSearchResults');
    const status = page.querySelector('.identificationSearchStatus');
    const list = page.querySelector('.identificationSearchResultList');

    if (!identificationSearchResults || !status || !list) return;

    identificationSearchResults.classList.remove('hide');
    page.querySelector('.identifyOptionsForm').classList.add('hide');
    page.querySelector('.dialogContentInner').classList.remove('dialog-content-centered');
    status.dataset.state = state;
    status.innerHTML = message ? escapeHtml(message) : '';
    list.innerHTML = '';
}

function showApplyStatus(page, message, state = 'info') {
    const status = page.querySelector('.identifyApplyStatus');

    if (!status) return;

    status.dataset.state = state;
    status.innerHTML = message ? escapeHtml(message) : '';
}

function setApplySubmitDisabled(page, disabled) {
    const submitButton = page.querySelector('.identifyOptionsForm .btnSubmit');

    if (submitButton) {
        submitButton.disabled = disabled;
    }
}

function setIdentifyDismissDisabled(page, disabled) {
    page.querySelectorAll('.btnCancel').forEach(button => {
        button.disabled = disabled;
    });
}

function requestIdentifyDialogClose(page) {
    if (currentReadingIdentifyApplyCoordinator && currentReadingIdentifyApplyPage === page) {
        if (!currentReadingIdentifyApplyCoordinator.requestClose()) {
            showApplyStatus(page, 'Finishing the metadata operation before closing...', 'loading');
        }

        return;
    }

    dialogHelper.close(page);
}

function getIdentificationSearchErrorMessage(error) {
    const status = error?.status || error?.StatusCode;

    if (status === 401 || status === 403) {
        return 'Unable to search metadata providers because the server denied access.';
    }

    if (status === 404) {
        return `No metadata search endpoint is available for ${currentItemType || 'this item type'}.`;
    }

    if (error?.name === 'PtvIdentifyTimeoutError') {
        return 'Metadata search timed out. The provider may be unavailable or slow.';
    }

    return 'Metadata search failed. Check the server provider setup and try again.';
}

function getIdentificationApplyErrorMessage(error) {
    const status = error?.status || error?.StatusCode;

    if (status === 401 || status === 403) {
        return 'Unable to apply metadata because the server denied access.';
    }

    if (status === 404) {
        return 'The server metadata apply endpoint is not available for this item.';
    }

    return 'Metadata apply failed. Check the server provider setup and try again.';
}

function withIdentificationHardTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = window.setTimeout(() => {
            if (settled) return;

            settled = true;
            const error = new Error(`Identify search timed out after ${timeoutMs}ms`);
            error.name = 'PtvIdentifyTimeoutError';
            reject(error);
        }, timeoutMs);

        promise.then(response => {
            if (settled) return;

            settled = true;
            window.clearTimeout(timer);
            resolve(response);
        }, error => {
            if (settled) return;

            settled = true;
            window.clearTimeout(timer);
            reject(error);
        });
    });
}

function searchForIdentificationResults(page) {
    if (page.dataset.identifySearchLoading === 'true') return;

    const lookupInfo = {};

    let i;
    let length;
    const identifyField = page.querySelectorAll('.identifyField');
    let value;
    for (i = 0, length = identifyField.length; i < length; i++) {
        value = identifyField[i].value;

        if (value) {
            if (identifyField[i].type === 'number') {
                value = parseInt(value, 10);
            }

            lookupInfo[identifyField[i].getAttribute('data-lookup')] = value;
        }
    }

    const providerIdEntries = [];
    const txtLookupId = page.querySelectorAll('.txtLookupId');
    for (i = 0, length = txtLookupId.length; i < length; i++) {
        value = txtLookupId[i].value?.trim();

        if (value) {
            providerIdEntries.push({
                key: txtLookupId[i].getAttribute('data-providerkey'),
                providerName: txtLookupId[i].getAttribute('data-providername') || '',
                value
            });
        }
    }
    const lookupRequest = buildRemoteSearchPayload(lookupInfo, currentItem?.Id || '', currentItemType, providerIdEntries);
    const hasId = Object.keys(lookupRequest.SearchInfo.ProviderIds || {}).length > 0;
    const hasSearchTerms = Boolean(lookupInfo.Name || lookupInfo.ISBN || lookupInfo.Author || lookupInfo.SeriesName);

    if (!hasId && !hasSearchTerms) {
        toast(globalize.translate('PleaseEnterNameOrId'));
        return;
    }

    const apiClient = getApiClient();
    const requestUrl = apiClient.getUrl(`Items/RemoteSearch/${currentItemType}`);
    const requestId = currentSearchRequestId + 1;
    const startedAt = performance.now();

    currentSearchRequestId = requestId;
    page.dataset.identifySearchLoading = 'true';
    setSearchSubmitDisabled(page, true);
    showSearchStatus(page, 'Searching metadata providers...', 'loading');
    loading.show();

    recordIdentificationDiagnostic('ptv-reading-identify-search-started', {
        endpoint: redactDiagnosticUrl(requestUrl),
        httpMethod: 'POST',
        providerIds: { ...lookupRequest.SearchInfo.ProviderIds },
        requestBody: {
            IncludeDisabledProviders: Boolean(lookupRequest.IncludeDisabledProviders),
            ItemId: lookupRequest.ItemId || null,
            SearchProviderName: lookupRequest.SearchProviderName || '',
            SearchInfo: {
                ...lookupRequest.SearchInfo,
                ProviderIds: { ...lookupRequest.SearchInfo.ProviderIds }
            }
        },
        searchAuthor: lookupInfo.Author || '',
        searchSeries: lookupRequest.SearchInfo.SeriesName || '',
        searchTitle: lookupRequest.SearchInfo.Name || '',
        searchYear: lookupRequest.SearchInfo.Year || null
    });

    const softTimer = window.setTimeout(() => {
        if (currentSearchRequestId !== requestId || page.dataset.identifySearchLoading !== 'true') return;

        showSearchStatus(page, 'Still searching metadata providers...', 'slow');
        recordIdentificationDiagnostic('ptv-reading-identify-search-soft-timeout', {
            durationMs: Number((performance.now() - startedAt).toFixed(1)),
            endpoint: redactDiagnosticUrl(requestUrl),
            softTimeoutMs: IDENTIFY_SEARCH_SOFT_TIMEOUT_MS
        });
    }, IDENTIFY_SEARCH_SOFT_TIMEOUT_MS);

    const jellyfinSearchPromise = withIdentificationHardTimeout(apiClient.ajax({
        type: 'POST',
        url: requestUrl,
        data: JSON.stringify(lookupRequest),
        contentType: 'application/json',
        dataType: 'json'

    }), IDENTIFY_SEARCH_HARD_TIMEOUT_MS).then(response => ({
        endpoint: requestUrl,
        error: null,
        response,
        responseShape: getRemoteSearchResponseShape(response),
        results: normalizeRemoteSearchResults(response)
    }), error => ({
        endpoint: requestUrl,
        error,
        response: null,
        responseShape: 'error',
        results: []
    }));

    Promise.all([
        jellyfinSearchPromise,
        searchNativeGoogleBooks(apiClient, lookupInfo, providerIdEntries)
    ]).then(([jellyfinSearch, googleBooksSearch]) => {
        if (currentSearchRequestId !== requestId) return;

        const results = mergeIdentificationResults(jellyfinSearch.results, googleBooksSearch.results);
        const durationMs = Number((performance.now() - startedAt).toFixed(1));

        loading.hide();
        window.clearTimeout(softTimer);
        page.dataset.identifySearchLoading = 'false';
        setSearchSubmitDisabled(page, false);
        recordIdentificationDiagnostic('ptv-reading-identify-search-completed', {
            durationMs,
            endpoint: redactDiagnosticUrl(requestUrl),
            googleBooksEndpoint: redactDiagnosticUrl(googleBooksSearch.endpoint),
            googleBooksResultCount: googleBooksSearch.results.length,
            jellyfinError: jellyfinSearch.error ? getDiagnosticError(jellyfinSearch.error) : '',
            jellyfinResultCount: jellyfinSearch.results.length,
            nativeGoogleBooksError: googleBooksSearch.error ? getDiagnosticError(googleBooksSearch.error) : '',
            normalizedResultCount: jellyfinSearch.results.length + googleBooksSearch.results.length,
            renderResultCount: results.length,
            responseShape: `${jellyfinSearch.responseShape};googlebooks:${googleBooksSearch.responseShape}`,
            status: results.length || (!jellyfinSearch.error && !googleBooksSearch.error) ? 'success' : 'error'
        });
        showIdentificationSearchResults(page, results, {
            responseShape: `${jellyfinSearch.responseShape};googlebooks:${googleBooksSearch.responseShape}`,
            searchInfo: lookupRequest.SearchInfo
        });
    }, error => {
        if (currentSearchRequestId !== requestId) return;

        const durationMs = Number((performance.now() - startedAt).toFixed(1));

        loading.hide();
        window.clearTimeout(softTimer);
        page.dataset.identifySearchLoading = 'false';
        setSearchSubmitDisabled(page, false);
        showSearchStatus(page, getIdentificationSearchErrorMessage(error), 'error');
        recordIdentificationDiagnostic('ptv-reading-identify-search-failed', {
            durationMs,
            endpoint: redactDiagnosticUrl(requestUrl),
            error: getDiagnosticError(error),
            responseShape: 'error',
            status: error?.status || error?.StatusCode || 'error'
        });
    });
}

function showIdentificationSearchResults(page, results, options = {}) {
    const identificationSearchResults = page.querySelector('.identificationSearchResults');
    const resultViewModels = isBookIdentifyLookup() ?
        rankMetadataSearchResults(results, options.searchInfo || getReadingLookupInfo(currentItem)) :
        results.map((result, index) => createMetadataSearchResultViewModel(result, index));

    identificationSearchResults.classList.remove('hide');
    page.querySelector('.identifyOptionsForm').classList.add('hide');
    page.querySelector('.dialogContentInner').classList.remove('dialog-content-centered');
    const resultNoun = resultViewModels.length === 1 ? 'match' : 'matches';
    let statusMessage = `${resultViewModels.length} metadata ${resultNoun} found.`;

    if (!resultViewModels.length) {
        statusMessage = 'No metadata matches found.';

        if (options.responseShape) {
            statusMessage += ` Response shape: ${escapeHtml(options.responseShape)}.`;
        }
    }

    page.querySelector('.identificationSearchStatus').innerHTML = statusMessage;

    let html = '';
    let i;
    let length;
    for (i = 0, length = resultViewModels.length; i < length; i++) {
        const result = resultViewModels[i];
        html += getSearchResultHtml(result, i);
    }

    const elem = page.querySelector('.identificationSearchResultList');
    elem.innerHTML = html;

    if (!resultViewModels.length) {
        return;
    }

    function onSearchImageClick() {
        const index = parseInt(this.getAttribute('data-index'), 10);

        const currentResult = resultViewModels[index];

        if (currentItem != null) {
            showIdentifyOptions(page, currentResult);
        } else {
            finishFindNewDialog(page, currentResult);
        }
    }

    const searchImages = elem.querySelectorAll('.card');
    for (i = 0, length = searchImages.length; i < length; i++) {
        searchImages[i].addEventListener('click', onSearchImageClick);
    }

    if (layoutManager.tv) {
        focusManager.autoFocus(identificationSearchResults);
    }
}

function finishFindNewDialog(dlg, identifyResult) {
    currentSearchResult = getRemoteSearchApplyPayload(identifyResult);
    hasChanges = true;
    loading.hide();

    dialogHelper.close(dlg);
}

function getCurrentPrimaryImageUrl(apiClient) {
    const tag = currentItem?.ImageTags?.Primary || currentItem?.PrimaryImageTag;

    if (!tag || !currentItem?.Id || !apiClient?.getImageUrl) return '';

    return apiClient.getImageUrl(currentItem.Id, {
        maxHeight: 420,
        maxWidth: 280,
        tag,
        type: 'Primary'
    });
}

function getMetadataPreviewValueHtml(value, fieldKey) {
    if (!value) return '<span class="identifyMetadataEmpty">Not set</span>';

    if (fieldKey === 'ProviderIds') {
        const labels = String(value).split('\n').map(line => line.split(':')[0]).filter(Boolean);

        return labels.map(label => `<span class="identifyProviderBadge">${escapeHtml(label)}</span>`).join(' ') || '<span class="identifyMetadataEmpty">Not set</span>';
    }

    const maxLength = fieldKey === 'Overview' ? 600 : 240;
    const text = String(value).slice(0, maxLength);

    return `<span>${escapeHtml(text)}${String(value).length > maxLength ? '…' : ''}</span>`;
}

function getReadingMetadataPreviewHtml(preview, applyResult, apiClient) {
    const metadataRows = preview.filter(field => field.key !== 'PrimaryImage');
    const imageField = preview.find(field => field.key === 'PrimaryImage');
    const currentImageUrl = getCurrentPrimaryImageUrl(apiClient);
    const proposedImageUrl = String(applyResult.ImageUrl || applyResult.imageUrl || '').trim();
    const providerDetails = Object.entries(applyResult.ProviderIds || {}).map(([key, value]) => {
        const providerUrl = getSafeReadingProviderLink(key, value);
        const label = escapeHtml(key);
        const valueHtml = escapeHtml(String(value).slice(0, 300));
        const linkHtml = providerUrl ? `<a href="${escapeHtml(providerUrl)}" target="_blank" rel="noopener noreferrer">Open provider</a>` : '';

        return `<div class="identifyProviderDetail"><strong>${label}</strong><code>${valueHtml}</code>${linkHtml}</div>`;
    }).join('');
    let html = '<div class="identifyMetadataTable" role="table" aria-label="Current and proposed metadata">';
    html += '<div class="identifyMetadataTableHeader" role="row"><span>Apply</span><span>Field</span><span>Current Jellyfin value</span><span>Proposed provider value</span></div>';

    metadataRows.forEach(field => {
        const controlState = getReadingIdentifyFieldControlState(field);
        const warningHtml = field.warning ? `<small class="identifyMetadataWarning">${escapeHtml(field.warning)}</small>` : '';
        html += `<div class="identifyMetadataRow${field.changed ? ' is-changed' : ''}" role="row">`;
        html += `<label class="identifyMetadataToggle" title="Apply ${escapeHtml(field.label)}"><input type="checkbox" is="emby-checkbox" class="readingMetadataField" data-metadata-field="${escapeHtml(field.key)}"${controlState.checked ? ' checked' : ''}${controlState.disabled ? ' disabled' : ''} /><span class="visually-hidden">Apply ${escapeHtml(field.label)}</span></label>`;
        html += `<strong class="identifyMetadataLabel">${escapeHtml(field.label)}</strong>`;
        html += `<div class="identifyMetadataValue">${getMetadataPreviewValueHtml(field.currentValue, field.key)}</div>`;
        html += `<div class="identifyMetadataValue">${getMetadataPreviewValueHtml(field.proposedValue, field.key)}${warningHtml}</div>`;
        html += '</div>';
    });

    html += '</div>';
    html += '<section class="identifyArtworkComparison" aria-label="Primary image comparison">';
    html += '<div><span>Current cover</span>';
    html += currentImageUrl ? `<img src="${escapeHtml(currentImageUrl)}" alt="Current cover" />` : '<div class="identifyCoverPlaceholder">No current cover</div>';
    html += '</div><div><span>Proposed cover</span>';
    html += proposedImageUrl ? `<img src="${escapeHtml(proposedImageUrl)}" alt="Proposed cover" />` : '<div class="identifyCoverPlaceholder">No proposed cover</div>';
    html += '</div>';
    const imageControlState = getReadingIdentifyFieldControlState(imageField, proposedImageUrl);
    const imageChecked = imageControlState.checked ? ' checked' : '';
    const imageDisabled = imageControlState.disabled ? ' disabled' : '';
    const imageWarning = imageField?.warning ? `<small>${escapeHtml(imageField.warning)}</small>` : '';
    html += `<label class="checkboxContainer identifyArtworkToggle"><input type="checkbox" is="emby-checkbox" id="chkIdentifyReplaceImages" class="readingMetadataField" data-metadata-field="PrimaryImage"${imageChecked}${imageDisabled} /><span>Replace existing primary image</span>${imageWarning}</label>`;
    html += '</section>';

    if (providerDetails) {
        html += `<details class="identifyProviderDetails"><summary>Provider details</summary>${providerDetails}</details>`;
    }

    return html;
}

function updateReadingApplyButton(page) {
    const hasSelection = Array.from(page.querySelectorAll('.readingMetadataField')).some(input => input.checked && !input.disabled);

    setApplySubmitDisabled(page, !hasSelection || !hasRemoteSearchProviderIds(currentSearchResult));
}

function bindReadingMetadataPreviewActions(page) {
    page.querySelectorAll('.readingMetadataField').forEach(input => {
        input.addEventListener('change', () => updateReadingApplyButton(page));
    });

    page.querySelector('.btnSelectSafeChanges')?.addEventListener('click', () => {
        page.querySelectorAll('.readingMetadataField').forEach(input => {
            const field = currentReadingMetadataPreview.find(candidate => candidate.key === input.dataset.metadataField);

            input.checked = Boolean(field?.safe) && !input.disabled;
        });
        updateReadingApplyButton(page);
    });

    page.querySelector('.btnClearMetadataSelections')?.addEventListener('click', () => {
        page.querySelectorAll('.readingMetadataField').forEach(input => {
            input.checked = false;
        });
        updateReadingApplyButton(page);
    });
}

function renderIdentifyOptions(page, normalizedResult) {
    const apiClient = getApiClient();
    const lines = [];
    const providerName = normalizedResult.SearchProviderName || 'Metadata provider';

    currentSearchResult = normalizedResult;
    lines.push(`<strong>${escapeHtml(normalizedResult.Name || 'Selected metadata')}</strong>`);

    if (normalizedResult.ProductionYear) {
        lines.push(escapeHtml(datetime.toLocaleString(normalizedResult.ProductionYear, { useGrouping: false })));
    }

    lines.push(`<span class="identifyProviderBadge">${escapeHtml(providerName)}</span>`);

    let resultHtml = `<div class="identifySelectedSummary">${lines.join('')}</div>`;

    if (normalizedResult.PtvProviderDisplayTitle && normalizedResult.PtvProviderDisplayTitle !== normalizedResult.Name) {
        resultHtml += `<p class="identifyProviderDeck">Provider display text: ${escapeHtml(normalizedResult.PtvProviderDisplayTitle)}</p>`;
    }

    page.querySelector('.selectedSearchResult').innerHTML = resultHtml;

    if (isBookIdentifyLookup()) {
        currentReadingMetadataPreview = buildReadingMetadataPreview(currentItem, normalizedResult);
        page.querySelector('.readingMetadataPreviewActions').classList.remove('hide');
        page.querySelector('.readingMetadataComparison').innerHTML = getReadingMetadataPreviewHtml(currentReadingMetadataPreview, normalizedResult, apiClient);
        bindReadingMetadataPreviewActions(page);
        showApplyStatus(page, 'Review each changed field, then apply the selected metadata and artwork independently.', 'info');
        updateReadingApplyButton(page);
    } else {
        currentReadingMetadataPreview = [];
        page.querySelector('.readingMetadataPreviewActions').classList.add('hide');
        page.querySelector('.readingMetadataComparison').innerHTML = '';
        showApplyStatus(page, hasRemoteSearchProviderIds(normalizedResult) ? 'Ready to apply the selected metadata.' : 'Selected result is missing provider IDs and cannot be applied safely.', hasRemoteSearchProviderIds(normalizedResult) ? 'info' : 'error');
        setApplySubmitDisabled(page, !hasRemoteSearchProviderIds(normalizedResult));
    }

    focusManager.focus(page.querySelector('.identifyOptionsForm .btnSubmit'));
}

function showIdentifyOptions(page, identifyResult) {
    const identifyOptionsForm = page.querySelector('.identifyOptionsForm');
    const selectedResult = getRemoteSearchApplyPayload(identifyResult);
    const normalizedResult = isBookIdentifyLookup() ?
        normalizeReadingMetadataCandidate(selectedResult, getReadingLookupInfo(currentItem)) :
        selectedResult;

    page.querySelector('.popupIdentifyForm').classList.add('hide');
    page.querySelector('.identificationSearchResults').classList.add('hide');
    identifyOptionsForm.classList.remove('hide');
    page.querySelector('.dialogContentInner').classList.remove('dialog-content-centered');

    currentSearchResult = normalizedResult;
    showApplyStatus(page, 'Loading complete provider details for comparison...', 'loading');
    setApplySubmitDisabled(page, true);

    resolveDetailedRemoteSearchResult(getApiClient(), currentItem?.Id, normalizedResult).then(detailedResult => {
        const result = isBookIdentifyLookup() ?
            normalizeReadingMetadataCandidate(detailedResult, getReadingLookupInfo(currentItem)) :
            detailedResult;

        renderIdentifyOptions(page, result);
    }, error => {
        recordIdentificationDiagnostic('ptv-reading-identify-preview-detail-failed', {
            error: getDiagnosticError(error),
            providerIds: normalizedResult.ProviderIds || {}
        });
        renderIdentifyOptions(page, normalizedResult);
    });
}

function getSearchResultHtml(result, index) {
    // TODO move card creation code to Card component

    let html = '';
    let cssClass = 'card scalableCard';
    let cardBoxCssClass = 'cardBox';
    let padderClass;

    if (currentItemType === 'Episode') {
        cssClass += ' backdropCard backdropCard-scalable';
        padderClass = 'cardPadder-backdrop';
    } else if (currentItemType === 'MusicAlbum' || currentItemType === 'MusicArtist') {
        cssClass += ' squareCard squareCard-scalable';
        padderClass = 'cardPadder-square';
    } else {
        cssClass += ' portraitCard portraitCard-scalable';
        padderClass = 'cardPadder-portrait';
    }

    if (layoutManager.tv) {
        cssClass += ' show-focus';

        if (enableFocusTransform) {
            cssClass += ' show-animation';
        }
    }

    cardBoxCssClass += ' cardBox-bottompadded';

    html += `<button type="button" class="${cssClass}" data-index="${index}">`;
    html += `<div class="${cardBoxCssClass}">`;
    html += '<div class="cardScalable">';
    html += `<div class="${padderClass}"></div>`;

    html += '<div class="cardContent searchImage">';

    if (result.displayImageUrl) {
        html += `<div class="cardImageContainer coveredImage" style="background-image:url('${escapeHtml(result.displayImageUrl)}');"></div>`;
    } else {
        html += `<div class="cardImageContainer coveredImage defaultCardBackground defaultCardBackground1"><div class="cardText cardCenteredText">${escapeHtml(result.displayTitle)}</div></div>`;
    }
    html += '</div>';
    html += '</div>';

    let numLines = 3;
    if (currentItemType === 'MusicAlbum') {
        numLines++;
    }

    const lines = [result.displayTitle];

    lines.push(result.providerName);

    if (result.confidence) {
        lines.push(result.rankReason ? `${result.confidence}: ${result.rankReason}` : result.confidence);
    }

    if (result.rawResult?.AlbumArtist) {
        lines.push(result.rawResult.AlbumArtist.Name);
    }
    if (result.displayYear && lines.length < numLines) {
        lines.push(result.displayYear);
    }

    for (let i = 0; i < numLines; i++) {
        if (i === 0) {
            html += '<div class="cardText cardText-first cardTextCentered">';
        } else {
            html += '<div class="cardText cardText-secondary cardTextCentered">';
        }
        html += escapeHtml(lines[i] || '') || '&nbsp;';
        html += '</div>';
    }

    html += '</div>';
    html += '</button>';
    return html;
}

function getSelectedReadingMetadataFields(page) {
    const selectedFields = Array.from(page.querySelectorAll('.readingMetadataField'))
        .filter(input => input.checked && !input.disabled)
        .map(input => input.dataset.metadataField)
        .filter(Boolean);

    return getReadingIdentifyWritableFields(currentItem, selectedFields);
}

function getBestReadingIdentifyItem(beforeItem, savedItem, readbackResult, readbackState, metadataStatus) {
    const readbackItem = readbackResult.item;

    if (readbackItem && (readbackResult.status === 'confirmed' || readbackState.metadataSettled)) {
        return readbackItem;
    }

    if (metadataStatus !== 'saved') {
        return readbackItem || beforeItem;
    }

    const bestItem = {
        ...(readbackItem || beforeItem),
        ...(savedItem || {})
    };

    if (readbackItem?.ImageTags) bestItem.ImageTags = readbackItem.ImageTags;
    if (readbackItem?.BackdropImageTags) bestItem.BackdropImageTags = readbackItem.BackdropImageTags;

    return bestItem;
}

function getReadingIdentifyUpdateEventDetail({
    applyResult,
    artworkStatus,
    disposition,
    item,
    metadataStatus,
    operationGeneration,
    readingOwnerGeneration,
    selectedMetadataFields
}) {
    if (!disposition.committed) return null;

    return {
        artworkCode: disposition.artworkCode,
        artworkStatus,
        item: item || null,
        itemId: item?.Id,
        metadataCode: disposition.metadataCode,
        metadataStatus,
        operationGeneration,
        outcome: disposition.outcome,
        provider: applyResult.SearchProviderName || '',
        readingOwnerGeneration,
        readbackCode: disposition.readbackCode,
        selectedMetadataFields
    };
}

function createCurrentIdentifyApplyCoordinator(page) {
    const coordinator = createIdentifyTerminalCoordinator({
        close: () => dialogHelper.close(page),
        dispatch: detail => {
            window.dispatchEvent(new CustomEvent('ptv-reading-item-metadata-updated', { detail }));
        },
        onPendingChange: pending => {
            page.dataset.identifyApplyLoading = String(pending);
            setIdentifyDismissDisabled(page, pending);
            if (!pending) loading.hide();
        },
        onRetryable: () => {
            if (isIdentifyPageConnected(page)) setApplySubmitDisabled(page, false);
        },
        onTerminalClosed: finishIdentifyDialogResolution
    });

    currentReadingIdentifyApplyCoordinator = coordinator;
    currentReadingIdentifyApplyPage = page;
    coordinator.start();

    return coordinator;
}

function submitReadingIdentificationResult(page, applyResult, applyRequestId) {
    const selectedFields = getSelectedReadingMetadataFields(page);
    const selectedMetadataFields = selectedFields.filter(field => field !== 'PrimaryImage');
    const replaceImages = selectedFields.includes('PrimaryImage');

    if (!selectedFields.length) {
        showApplyStatus(page, 'Select at least one metadata or artwork change.', 'error');
        return;
    }

    const apiClient = getApiClient();
    const beforeItem = currentItem;
    const readingOwnerGeneration = currentReadingIdentifyOwnerGeneration;
    const startedAt = performance.now();
    let metadataStatus = selectedMetadataFields.length ? 'saving' : 'skipped';
    let artworkStatus = replaceImages ? 'saving' : 'skipped';
    let savedItem = currentItem;
    let metadataError = null;
    let artworkError = null;

    loading.show();
    const coordinator = createCurrentIdentifyApplyCoordinator(page);
    setApplySubmitDisabled(page, true);
    showApplyStatus(page, `Metadata: ${metadataStatus}. Artwork: ${artworkStatus}.`, 'loading');

    recordIdentificationDiagnostic('ptv-reading-identify-selective-apply-started', {
        artworkSelected: replaceImages,
        provider: applyResult.SearchProviderName || '',
        selectedMetadataFields
    });

    const metadataPromise = selectedMetadataFields.length ?
        withReadingIdentifyDeadline(
            persistAppliedResultFields(apiClient, currentItem, applyResult, selectedMetadataFields, true, false, {
                effectCategories: selectedMetadataFields.map(field => String(field).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()),
                operationGeneration: applyRequestId,
                ownerGeneration: readingOwnerGeneration
            }),
            READING_IDENTIFY_APPLY_WRITE_TIMEOUT_MS
        )
            .then(item => {
                metadataStatus = 'saved';
                savedItem = item || savedItem;
                if (canUpdateIdentifyApply(page, applyRequestId)) {
                    showApplyStatus(page, `Metadata: ${metadataStatus}. Artwork: ${artworkStatus}.`, artworkStatus === 'saving' ? 'loading' : 'info');
                }

                return item;
            }, error => {
                metadataStatus = 'failed';
                metadataError = error;
                recordIdentificationDiagnostic('ptv-reading-identify-selective-metadata-failed', {
                    errorCategory: getReadingIdentifyDiagnosticErrorCategory(error),
                    reason: error?.name === 'PtvReadingIdentifyTimeoutError' ? 'METADATA_WRITE_TIMEOUT' : 'METADATA_WRITE_FAILED',
                    selectedMetadataFields
                });

                return null;
            }) :
        Promise.resolve(currentItem);
    const artworkPromise = replaceImages ?
        withReadingIdentifyDeadline(
            persistAppliedResultImage(apiClient, currentItem.Id, applyResult, true, {
                operationGeneration: applyRequestId,
                ownerGeneration: readingOwnerGeneration
            }),
            READING_IDENTIFY_APPLY_WRITE_TIMEOUT_MS
        ).then(saved => {
            artworkStatus = saved ? 'saved' : 'failed';
            if (canUpdateIdentifyApply(page, applyRequestId)) {
                showApplyStatus(page, `Metadata: ${metadataStatus}. Artwork: ${artworkStatus}.`, metadataStatus === 'saving' ? 'loading' : 'info');
            }

            return saved;
        }, error => {
            artworkStatus = 'failed';
            artworkError = error;
            recordPtvEvent('api', 'ptv-reading-identify-selective-artwork-failed', {
                errorCategory: getReadingIdentifyDiagnosticErrorCategory(error),
                reason: error?.name === 'PtvReadingIdentifyTimeoutError' ? 'ARTWORK_WRITE_TIMEOUT' : 'ARTWORK_WRITE_FAILED'
            });

            return false;
        }) :
        Promise.resolve(false);

    Promise.all([metadataPromise, artworkPromise]).then(async () => {
        const userId = apiClient.getCurrentUserId?.();
        const committed = metadataStatus === 'saved' || artworkStatus === 'saved';
        let readbackResult = {
            attempts: 0,
            error: null,
            item: null,
            status: committed ? 'failed' : 'not-required'
        };

        if (committed && userId && apiClient.getItem) {
            if (canUpdateIdentifyApply(page, applyRequestId)) {
                showApplyStatus(page, 'Changes saved. Reading back the authoritative item...', 'loading');
            }

            readbackResult = await pollReadingIdentifyReadback({
                delays: READING_IDENTIFY_READBACK_DELAYS_MS,
                isSettled: item => getReadingIdentifyReadbackState({
                    applyResult,
                    artworkStatus,
                    beforeItem,
                    expectedItem: savedItem,
                    item,
                    metadataStatus,
                    selectedMetadataFields
                }).settled,
                loadItem: () => apiClient.getItem(userId, beforeItem.Id),
                timeoutMs: READING_IDENTIFY_READBACK_TIMEOUT_MS
            });
        }

        if (!isCurrentIdentifyApplyRequest(applyRequestId) || currentReadingIdentifyApplyCoordinator !== coordinator) return;

        const readbackState = getReadingIdentifyReadbackState({
            applyResult,
            artworkStatus,
            beforeItem,
            expectedItem: savedItem,
            item: readbackResult.item,
            metadataStatus,
            selectedMetadataFields
        });
        const bestItem = getBestReadingIdentifyItem(
            beforeItem,
            savedItem,
            readbackResult,
            readbackState,
            metadataStatus
        );
        const disposition = getReadingIdentifyApplyDisposition({
            artworkStatus,
            metadataStatus,
            readbackState,
            readbackStatus: readbackResult.status
        });
        const verificationReport = getApplyPersistenceReport(bestItem, applyResult, selectedMetadataFields);
        const completionMessage = getReadingIdentifyCompletionMessage(disposition, metadataStatus, artworkStatus);

        if (bestItem) currentItem = bestItem;
        currentIdentifyReadbackCode = disposition.readbackCode;
        hasChanges = hasChanges || disposition.committed;
        currentSearchResult = applyResult;
        const eventDetail = getReadingIdentifyUpdateEventDetail({
            applyResult,
            artworkStatus,
            disposition,
            item: currentItem,
            metadataStatus,
            operationGeneration: applyRequestId,
            readingOwnerGeneration,
            selectedMetadataFields
        });

        recordIdentificationDiagnostic('ptv-reading-identify-selective-apply-completed', {
            artworkCode: disposition.artworkCode,
            artworkErrorCategory: getReadingIdentifyDiagnosticErrorCategory(artworkError),
            artworkStatus,
            durationMs: Number((performance.now() - startedAt).toFixed(1)),
            metadataCode: disposition.metadataCode,
            metadataErrorCategory: getReadingIdentifyDiagnosticErrorCategory(metadataError),
            metadataStatus,
            outcome: disposition.outcome,
            proposalDifferences: verificationReport.missing,
            readbackAttempts: readbackResult.attempts,
            readbackCode: disposition.readbackCode,
            readbackErrorCategory: getReadingIdentifyDiagnosticErrorCategory(readbackResult.error),
            selectedMetadataFields
        });

        if (isIdentifyPageConnected(page)) {
            let completionState = 'warning';

            if (disposition.outcome === 'FULL_SUCCESS') completionState = 'success';
            if (disposition.outcome === 'FAILURE') completionState = 'error';
            showApplyStatus(page, completionMessage, completionState);
            toast(completionMessage);
        }

        coordinator.settle({ disposition, eventDetail });
    }).catch(error => {
        if (!isCurrentIdentifyApplyRequest(applyRequestId) || currentReadingIdentifyApplyCoordinator !== coordinator) return;

        const committed = metadataStatus === 'saved' || artworkStatus === 'saved';
        const disposition = getReadingIdentifyApplyDisposition({
            artworkStatus,
            metadataStatus,
            readbackStatus: committed ? 'failed' : 'not-required'
        });

        if (savedItem) currentItem = savedItem;
        currentIdentifyReadbackCode = disposition.readbackCode;
        hasChanges = hasChanges || disposition.committed;
        const eventDetail = getReadingIdentifyUpdateEventDetail({
            applyResult,
            artworkStatus,
            disposition,
            item: currentItem,
            metadataStatus,
            operationGeneration: applyRequestId,
            readingOwnerGeneration,
            selectedMetadataFields
        });

        if (isIdentifyPageConnected(page)) {
            showApplyStatus(page, getIdentificationApplyErrorMessage(error), 'error');
        }
        recordIdentificationDiagnostic('ptv-reading-identify-selective-apply-failed', {
            errorCategory: getReadingIdentifyDiagnosticErrorCategory(error),
            selectedMetadataFields
        });
        coordinator.settle({ disposition, eventDetail });
    });
}

function submitIdentficationResult(page) {
    if (!currentSearchResult || !currentItem?.Id) {
        showSearchStatus(page, 'Choose a metadata match before applying.', 'error');
        return;
    }

    if (page.dataset.identifyApplyLoading === 'true') return;

    const applyRequestId = ++currentIdentifyApplyRequestId;
    const selectedSearchResult = currentSearchResult;
    let applyResult = getRemoteSearchApplyPayload(selectedSearchResult);

    if (isBookIdentifyLookup()) {
        applyResult = normalizeReadingMetadataCandidate(applyResult, getReadingLookupInfo(currentItem));
    }

    if (!hasRemoteSearchProviderIds(applyResult)) {
        showApplyStatus(page, 'This metadata result did not include a provider ID, so it cannot be applied safely.', 'error');
        recordIdentifyAuthorityDiagnostic('ptv-identify-apply-blocked', {
            failureReason: 'missing-provider-ids',
            phase: 'validation'
        });
        return;
    }

    if (isBookIdentifyLookup()) {
        submitReadingIdentificationResult(page, applyResult, applyRequestId);
        return;
    }

    loading.show();
    setApplySubmitDisabled(page, true);
    showApplyStatus(page, 'Sending selected remote result...', 'loading');

    const replaceImages = Boolean(page.querySelector('#chkIdentifyReplaceImages')?.checked);
    const options = {
        ReplaceAllImages: replaceImages
    };

    const apiClient = getApiClient();
    const requestUrl = apiClient.getUrl(`Items/RemoteSearch/Apply/${currentItem.Id}`, options);
    const startedAt = performance.now();
    const operation = Object.freeze({
        beforeItem: currentItem,
        itemId: currentItem.Id,
        itemType: currentItemType || currentItem.Type,
        operationGeneration: applyRequestId,
        ownerGeneration: currentReadingIdentifyOwnerGeneration
    });
    const coordinator = createCurrentIdentifyApplyCoordinator(page);
    let remoteMutationAccepted = false;
    const isOperationCurrent = () => isCurrentIdentifyApplyRequest(applyRequestId)
        && currentReadingIdentifyApplyCoordinator === coordinator
        && currentReadingIdentifyOwnerGeneration === operation.ownerGeneration
        && isIdentifyPageConnected(page);

    const settleRetiredOperation = () => coordinator.settle({
        disposition: {
            committed: false,
            shouldClose: true
        }
    });

    void (async () => {
        try {
            applyResult = await resolveDetailedRemoteSearchResult(apiClient, operation.itemId, applyResult);
            if (!isOperationCurrent()) {
                settleRetiredOperation();
                return;
            }

            recordIdentifyAuthorityDiagnostic('ptv-generic-identify-apply-started', {
                operationGeneration: operation.operationGeneration,
                ownerGeneration: operation.ownerGeneration,
                phase: 'remote-apply'
            });

            await apiClient.ajax({
                type: 'POST',
                url: requestUrl,
                data: JSON.stringify(applyResult),
                contentType: 'application/json'
            });
            remoteMutationAccepted = true;

            if (!isOperationCurrent()) {
                settleRetiredOperation();
                return;
            }

            const intendedFields = getGenericIdentifyIntendedFields(operation.beforeItem, applyResult);
            const initialOutboundItem = getMetadataUpdateItem(operation.beforeItem, applyResult);
            const expectedEffect = createGenericIdentifyExpectedEffectProjection({
                beforeItem: operation.beforeItem,
                expectedProviderIds: applyResult.ProviderIds,
                intendedFields,
                itemType: operation.itemType,
                mutationResult: applyResult,
                outboundItem: initialOutboundItem,
                replaceAllImages: replaceImages
            });
            const hasRelationshipExpectedEffect = expectedEffect.effects
                .some(effect => effect.kind === 'relationship-set');
            let artworkSaved = false;

            if (replaceImages) {
                artworkSaved = await persistAppliedResultImage(apiClient, operation.itemId, applyResult, true, {
                    operationGeneration: operation.operationGeneration,
                    ownerGeneration: operation.ownerGeneration
                });
            }

            const userId = apiClient.getCurrentUserId?.();
            let readbackResult = {
                attempts: 0,
                error: null,
                item: null,
                status: 'unconfirmed'
            };

            if (userId && apiClient.getItem) {
                showApplyStatus(page, 'Metadata accepted. Confirming the exact server result...', 'loading');
                readbackResult = await confirmGenericIdentifyMutation({
                    buildFallbackProjection: hasRelationshipExpectedEffect ? undefined : item => createGenericIdentifyExpectedEffectProjection({
                        beforeItem: item,
                        expectedProviderIds: applyResult.ProviderIds,
                        intendedFields,
                        itemType: operation.itemType,
                        mutationResult: applyResult,
                        outboundItem: getMetadataUpdateItem(item, applyResult),
                        replaceAllImages: replaceImages
                    }),
                    delays: GENERIC_IDENTIFY_READBACK_DELAYS_MS,
                    expectedEffect,
                    isCurrent: isOperationCurrent,
                    loadItem: () => apiClient.getItem(userId, operation.itemId),
                    onAttempt: ({ ordinal, result }) => {
                        recordIdentifyAuthorityDiagnostic('ptv-generic-identify-readback-attempted', {
                            attemptOrdinal: ordinal,
                            authorityClassification: result,
                            effectCategories: expectedEffect.effects.map(effect => effect.category),
                            operationGeneration: operation.operationGeneration,
                            ownerGeneration: operation.ownerGeneration,
                            phase: 'readback'
                        });
                    },
                    timeoutMs: GENERIC_IDENTIFY_READBACK_TIMEOUT_MS,
                    writeFallback: hasRelationshipExpectedEffect ? undefined : (item, projection) => persistAppliedResultFields(apiClient, item, applyResult, null, true, false, {
                        effectCategories: projection.effects.map(effect => effect.category),
                        operationGeneration: operation.operationGeneration,
                        ownerGeneration: operation.ownerGeneration
                    })
                });
            }

            if (readbackResult.status === 'retired' || !isOperationCurrent()) {
                settleRetiredOperation();
                return;
            }

            const readbackConfirmed = readbackResult.status === 'confirmed' && Boolean(readbackResult.item);
            const authoritativeItem = readbackConfirmed ? readbackResult.item : null;
            const readbackCode = readbackConfirmed ? 'READBACK_CONFIRMED' : 'REFRESH_FAILED';

            if (authoritativeItem) currentItem = authoritativeItem;
            currentIdentifyReadbackCode = readbackCode;
            currentSearchResult = applyResult;
            hasChanges = true;
            let artworkStatus = 'skipped';

            if (replaceImages) artworkStatus = artworkSaved ? 'saved' : 'failed';

            const eventDetail = {
                artworkStatus,
                item: authoritativeItem || operation.beforeItem,
                itemId: operation.itemId,
                metadataStatus: 'saved',
                operationGeneration: operation.operationGeneration,
                outcome: readbackConfirmed ? 'FULL_SUCCESS' : 'PARTIAL_SUCCESS',
                readingOwnerGeneration: operation.ownerGeneration,
                readbackCode
            };

            recordIdentifyAuthorityDiagnostic('ptv-generic-identify-apply-completed', {
                authorityClassification: readbackConfirmed ? 'confirmed' : readbackResult.expectedEffect?.reason || expectedEffect.reason || 'unconfirmed',
                durationMs: Number((performance.now() - startedAt).toFixed(1)),
                effectCategories: expectedEffect.effects.map(effect => effect.category),
                operationGeneration: operation.operationGeneration,
                ownerGeneration: operation.ownerGeneration,
                readbackAttempts: readbackResult.attempts
            });

            if (isIdentifyPageConnected(page)) {
                const message = readbackConfirmed ?
                    'Metadata saved and confirmed from Jellyfin.' :
                    'Metadata changes were accepted, but the authoritative item could not be fully confirmed.';

                showApplyStatus(page, message, readbackConfirmed ? 'success' : 'warning');
                toast(readbackConfirmed ? 'Metadata saved.' : 'Metadata accepted; refreshed values remain unconfirmed.');
            }

            coordinator.settle({
                disposition: {
                    committed: true,
                    shouldClose: true
                },
                eventDetail
            });
        } catch (error) {
            if (!isOperationCurrent()) {
                settleRetiredOperation();
                return;
            }

            recordIdentifyAuthorityDiagnostic('ptv-generic-identify-apply-failed', {
                durationMs: Number((performance.now() - startedAt).toFixed(1)),
                failureReason: getReadingIdentifyDiagnosticErrorCategory(error),
                operationGeneration: operation.operationGeneration,
                ownerGeneration: operation.ownerGeneration,
                phase: remoteMutationAccepted ? 'confirmation' : 'remote-apply'
            });

            if (remoteMutationAccepted) {
                hasChanges = true;
                currentIdentifyReadbackCode = 'REFRESH_FAILED';
                const message = 'Metadata changes were accepted, but the authoritative item could not be fully confirmed.';

                if (isIdentifyPageConnected(page)) {
                    showApplyStatus(page, message, 'warning');
                    toast('Metadata accepted; refreshed values remain unconfirmed.');
                }
                coordinator.settle({
                    disposition: {
                        committed: true,
                        shouldClose: true
                    },
                    eventDetail: {
                        artworkStatus: replaceImages ? 'failed' : 'skipped',
                        item: operation.beforeItem,
                        itemId: operation.itemId,
                        metadataStatus: 'saved',
                        operationGeneration: operation.operationGeneration,
                        outcome: 'PARTIAL_SUCCESS',
                        readingOwnerGeneration: operation.ownerGeneration,
                        readbackCode: 'REFRESH_FAILED'
                    }
                });
                return;
            }

            if (isIdentifyPageConnected(page)) {
                showApplyStatus(page, getIdentificationApplyErrorMessage(error), 'error');
                toast('Unable to apply metadata.');
            }
            coordinator.settle({
                disposition: {
                    committed: false,
                    shouldClose: false
                }
            });
        }
    })();
}

function showIdentificationForm(page, item) {
    const apiClient = getApiClient();

    apiClient.getJSON(apiClient.getUrl(`Items/${item.Id}/ExternalIdInfos`)).then(idList => {
        let html = '';

        const dedupedIdList = dedupeExternalIdInfos(idList);

        for (let i = 0, length = dedupedIdList.length; i < length; i++) {
            const idInfo = dedupedIdList[i];

            const safeIdKey = String(idInfo.Key).replace(/[^a-z0-9_-]/gi, '');
            const id = `txtLookup${safeIdKey}`;

            html += '<div class="inputContainer">';

            let fullName = idInfo.Name;
            if (idInfo.Type) {
                fullName = `${idInfo.Name} ${globalize.translate(idInfo.Type)}`;
            }

            const idLabel = globalize.translate('LabelDynamicExternalId', escapeHtml(fullName));

            html += `<input is="emby-input" class="txtLookupId" data-providerkey="${idInfo.Key}" data-providername="${escapeHtml(idInfo.Name || '')}" id="${id}" label="${idLabel}"/>`;

            html += '</div>';
        }

        page.querySelector('#txtLookupName').value = getReadingIdentifyName(item) || item.Name || '';

        if (item.Type === 'Person' || item.Type === 'BoxSet') {
            page.querySelector('.fldLookupYear').classList.add('hide');
            page.querySelector('#txtLookupYear').value = '';
        } else {
            page.querySelector('.fldLookupYear').classList.remove('hide');
            page.querySelector('#txtLookupYear').value = item.ProductionYear || '';
        }

        page.querySelector('.identifyReadingFields').innerHTML = getReadingLookupFieldHtml(item);
        page.querySelector('.identifyProviderIds').innerHTML = html;
        page.querySelector('.identifyAdvancedFields').classList.toggle('hide', !html);
        page.querySelector('.identifyAdvancedFields').open = false;

        page.querySelector('.formDialogHeaderTitle').innerHTML = globalize.translate('Identify');
    }, error => {
        page.querySelector('.identifyProviderIds').innerHTML = '';
        page.querySelector('.identifyAdvancedFields').classList.add('hide');
        showSearchStatus(page, 'Unable to load metadata provider IDs for this item. You can still search by title and year.', 'error');
        recordIdentificationDiagnostic('ptv-reading-identify-provider-ids-failed', {
            error: getDiagnosticError(error),
            endpoint: redactDiagnosticUrl(apiClient.getUrl(`Items/${item.Id}/ExternalIdInfos`)),
            status: error?.status || error?.StatusCode || 'error'
        });
    });
}

function showEditor(itemId) {
    loading.show();

    const apiClient = getApiClient();

    apiClient.getItem(apiClient.getCurrentUserId(), itemId).then(item => {
        currentItem = item;
        currentItemType = currentItem.Type;

        const dialogOptions = {
            size: 'small',
            removeOnClose: true,
            scrollY: false
        };

        if (layoutManager.tv) {
            dialogOptions.size = 'fullscreen';
        }

        const dlg = dialogHelper.createDialog(dialogOptions);

        dlg.classList.add('formDialog');
        dlg.classList.add('recordingDialog');
        dlg.classList.add('identifyDialog');

        let html = '';
        html += globalize.translateHtml(template, 'core');

        dlg.innerHTML = html;

        // Has to be assigned a z-index after the call to .open()
        dlg.addEventListener('close', onDialogClosed);

        if (layoutManager.tv) {
            scrollHelper.centerFocus.on(dlg.querySelector('.formDialogContent'), false);
        }

        if (item.Path) {
            dlg.querySelector('.fldPath').classList.remove('hide');
        } else {
            dlg.querySelector('.fldPath').classList.add('hide');
        }

        dlg.querySelector('.txtPath').innerText = item.Path || '';

        dialogHelper.open(dlg);

        dlg.querySelector('.popupIdentifyForm').addEventListener('submit', e => {
            e.preventDefault();
            searchForIdentificationResults(dlg);
            return false;
        });

        dlg.querySelector('.identifyOptionsForm').addEventListener('submit', e => {
            e.preventDefault();
            submitIdentficationResult(dlg);
            return false;
        });

        dlg.querySelectorAll('.btnCancel').forEach(button => {
            button.addEventListener('click', () => {
                requestIdentifyDialogClose(dlg);
            });
        });

        showIdentificationForm(dlg, item);
        loading.hide();
    });
}

function finishIdentifyDialogResolution() {
    loading.hide();
    currentIdentifyApplyRequestId += 1;
    currentReadingMetadataPreview = [];
    currentSearchResult = null;
    currentReadingIdentifyApplyCoordinator = null;
    currentReadingIdentifyApplyPage = null;
    currentReadingIdentifyOwnerGeneration = null;
    const resolution = currentIdentifyResultMode === 'authority' ? {
        item: currentIdentifyReadbackCode === 'READBACK_CONFIRMED' ? currentItem : null,
        readbackCode: currentIdentifyReadbackCode
    } : currentItem;
    if (hasChanges) {
        currentResolve?.(resolution);
    } else {
        currentReject?.();
    }

    currentResolve = null;
    currentReject = null;
    currentIdentifyReadbackCode = null;
    currentIdentifyResultMode = 'item';
}

function onDialogClosed(event) {
    if (currentReadingIdentifyApplyCoordinator && currentReadingIdentifyApplyPage === event.currentTarget) {
        loading.hide();
        currentReadingIdentifyApplyCoordinator.handleClosed();
        return;
    }

    finishIdentifyDialogResolution();
}

// TODO investigate where this was used
function showEditorFindNew(itemName, itemYear, itemType, resolveFunc) {
    currentItem = null;
    currentItemType = itemType;

    const dialogOptions = {
        size: 'small',
        removeOnClose: true,
        scrollY: false
    };

    if (layoutManager.tv) {
        dialogOptions.size = 'fullscreen';
    }

    const dlg = dialogHelper.createDialog(dialogOptions);

    dlg.classList.add('formDialog');
    dlg.classList.add('recordingDialog');

    let html = '';
    html += globalize.translateHtml(template, 'core');

    dlg.innerHTML = html;

    if (layoutManager.tv) {
        scrollHelper.centerFocus.on(dlg.querySelector('.formDialogContent'), false);
    }

    dialogHelper.open(dlg);

    dlg.querySelector('.btnCancel').addEventListener('click', () => {
        dialogHelper.close(dlg);
    });

    dlg.querySelector('.popupIdentifyForm').addEventListener('submit', e => {
        e.preventDefault();
        searchForIdentificationResults(dlg);
        return false;
    });

    dlg.addEventListener('close', () => {
        loading.hide();
        const foundItem = hasChanges ? currentSearchResult : null;

        resolveFunc(foundItem);
    });

    dlg.classList.add('identifyDialog');

    showIdentificationFormFindNew(dlg, itemName, itemYear, itemType);
}

function showIdentificationFormFindNew(dlg, itemName, itemYear, itemType) {
    dlg.querySelector('#txtLookupName').value = itemName;
    dlg.querySelector('.identifyReadingFields').innerHTML = '';

    if (itemType === 'Person' || itemType === 'BoxSet') {
        dlg.querySelector('.fldLookupYear').classList.add('hide');
        dlg.querySelector('#txtLookupYear').value = '';
    } else {
        dlg.querySelector('.fldLookupYear').classList.remove('hide');
        dlg.querySelector('#txtLookupYear').value = itemYear;
    }

    dlg.querySelector('.formDialogHeaderTitle').innerHTML = globalize.translate('Search');
}

export function show(itemId, serverId, options = {}) {
    if (currentReadingIdentifyApplyCoordinator) {
        return currentReadingIdentifyApplyCoordinator.whenTerminalClosed().then(() => show(itemId, serverId, options));
    }

    return new Promise((resolve, reject) => {
        currentResolve = resolve;
        currentReject = reject;
        currentServerId = serverId;
        currentReadingIdentifyOwnerGeneration = Number.isSafeInteger(options.readingOwnerGeneration)
            && options.readingOwnerGeneration > 0 ? options.readingOwnerGeneration : null;
        currentIdentifyReadbackCode = null;
        currentIdentifyResultMode = options.resultMode === 'authority' ? 'authority' : 'item';
        hasChanges = false;

        showEditor(itemId);
    });
}

export function showWithAuthority(itemId, serverId, options = {}) {
    return show(itemId, serverId, {
        ...options,
        resultMode: 'authority'
    });
}

export function showFindNew(itemName, itemYear, itemType, serverId) {
    if (currentReadingIdentifyApplyCoordinator) {
        return currentReadingIdentifyApplyCoordinator.whenTerminalClosed()
            .then(() => showFindNew(itemName, itemYear, itemType, serverId));
    }

    return new Promise((resolve) => {
        currentServerId = serverId;

        hasChanges = false;
        showEditorFindNew(itemName, itemYear, itemType, resolve);
    });
}

export default {
    show: show,
    showWithAuthority: showWithAuthority,
    showFindNew: showFindNew
};
