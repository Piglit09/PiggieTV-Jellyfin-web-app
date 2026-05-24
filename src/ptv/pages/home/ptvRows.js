import escapeHtml from 'escape-html';

import cardBuilder from 'components/cardbuilder/cardBuilder';
import imageLoader from 'components/images/imageLoader';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { getPtvPerformanceProfile } from 'ptv/core/clientProfile';
import {
    cleanupPtvLazyImages,
    enhancePtvLazyImageAttributes,
    loadPtvImage,
    observePtvLazyImages
} from 'ptv/core/imageManager';
import { recordPtvEvent, timePtvAsync } from 'ptv/core/observability';
import { getFeaturedContent } from 'ptv/modules/cache/featuredContentCache';
import { loadSharedHeroItems } from 'ptv/modules/hero/useHeroItems';
import { getBackdropShape, getPortraitShape, getSquareShape } from 'utils/card';
import {
    mediaBrandMatchers
} from './rowMatchers/mediaBrandMatcher';

const ROW_ITEM_LIMIT = 16;
const MEDIA_FIELDS = 'PrimaryImageAspectRatio,Path,MediaSources,MediaSourceCount,Genres,Tags,Studios,ProductionLocations,ProviderIds,OriginalTitle,DateCreated,PremiereDate,ProductionYear,CommunityRating,CriticRating';
let backdropSeed = Date.now();
const rowBackdropObservers = new WeakMap();
const rowBackdropLoads = new WeakMap();
const rowBackdropTokens = new WeakMap();

function getHomePerformanceProfile(options = {}) {
    return options.performanceProfile || getPtvPerformanceProfile();
}

function clampLimit(value, maxValue) {
    const limit = Number(value) || ROW_ITEM_LIMIT;
    const maxLimit = Number(maxValue) || limit;

    return Math.max(1, Math.min(limit, maxLimit));
}

function getRowItemLimit(row, options = {}) {
    return clampLimit(row.itemLimit || ROW_ITEM_LIMIT, getHomePerformanceProfile(options).rowItemLimit);
}

function getRowQueryLimit(row, options = {}) {
    return clampLimit(row.queryLimit || getRowItemLimit(row, options), getHomePerformanceProfile(options).rowItemLimit);
}

function getRowCandidateLimit(row, options = {}) {
    const profile = getHomePerformanceProfile(options);
    const requested = row.candidateLimit || getRowQueryLimit(row, options);
    const maxCandidates = Math.max(getRowItemLimit(row, options), (profile.rowItemLimit || ROW_ITEM_LIMIT) * 9);

    return clampLimit(requested, maxCandidates);
}

function getSearchTerms(row, options = {}) {
    const terms = row.searchTerms || [];
    const maxTerms = getHomePerformanceProfile(options).searchTermLimit;

    return maxTerms ? terms.slice(0, maxTerms) : terms;
}

export const PTV_HOME_ROWS = [
    { id: 'my-media', title: 'My Media', type: 'libraries' },
    { id: 'continue-watching', title: 'Continue Watching', type: 'continue' },
    { id: 'latest-shows', title: 'Latest Shows', type: 'latest', itemTypes: 'Series', shape: 'portrait' },
    { id: 'latest-movies', title: 'Latest Movies', type: 'latest', itemTypes: 'Movie', shape: 'portrait' },
    { id: 'latest-music', title: 'Latest Music', type: 'latest', itemTypes: 'MusicAlbum', shape: 'square' },
    { id: 'horror', title: 'Horror', type: 'genre', genres: ['Horror'] },
    { id: 'comedy', title: 'Comedy', type: 'genre', genres: ['Comedy'] },
    { id: 'family-animation', title: 'Family Animation', type: 'genre', genres: ['Family', 'Animation'] },
    { id: 'drama', title: 'Drama', type: 'genre', genres: ['Drama'] },
    { id: 'science-fiction', title: 'Science Fiction', type: 'genre', genres: ['Science Fiction', 'Sci-Fi', 'Sci Fi'] },
    { id: 'anime', title: 'Anime', type: 'library', libraryNames: ['anime'], itemTypes: 'Movie,Series' },
    {
        id: 'music',
        title: 'Music',
        type: 'library',
        libraryNames: ['music'],
        itemTypes: 'MusicAlbum',
        shape: 'square',
        sortBy: 'CommunityRating,SortName',
        sortOrder: 'Descending'
    },
    { id: 'family', title: 'Family', type: 'genre', genres: ['Family'] },
    { id: 'action', title: 'Action', type: 'genre', genres: ['Action'] },
    {
        id: 'disney',
        title: mediaBrandMatchers.disney.definition.title,
        type: 'search',
        candidateLimit: 180,
        includeItemTypes: 'Movie,Series',
        itemMatcher: mediaBrandMatchers.disney.matches,
        queryLimit: 12,
        searchTerms: mediaBrandMatchers.disney.searchTerms,
        studioKeywords: mediaBrandMatchers.disney.studioKeywords,
        studioNames: mediaBrandMatchers.disney.studioNames
    },
    { id: 'marvel', title: 'Marvel', type: 'search', searchTerm: 'marvel' },
    { id: 'star-wars', title: 'Star Wars', type: 'search', searchTerm: 'star wars' },
    { id: 'star-trek', title: 'Star Trek', type: 'search', searchTerm: 'star trek' },
    { id: 'adult-animation', title: 'Adult Animation', type: 'search', searchTerm: 'adult animation' },
    { id: 'crime', title: 'Crime', type: 'genre', genres: ['Crime'] }
];

function hasRenderableImage(item) {
    return Boolean(
        item?.ImageTags?.Primary
        || item?.ImageTags?.Backdrop
        || item?.ImageTags?.Thumb
        || item?.ImageTags?.Banner
        || item?.PrimaryImageTag
        || item?.SeriesPrimaryImageTag
        || item?.ParentPrimaryImageTag
        || item?.AlbumPrimaryImageTag
        || item?.BackdropImageTags?.length
        || item?.ParentBackdropImageTags?.length
        || item?.SeriesThumbImageTag
        || item?.ParentThumbImageTag
    );
}

function getItems(result) {
    return result?.Items || result || [];
}

function getUniqueItems(items) {
    const usedKeys = new Set();

    return (items || []).filter(item => {
        const key = item.Id || item.ItemId || `${item.Name || ''}-${item.ProductionYear || ''}`;

        if (!key || usedKeys.has(key)) return false;

        usedKeys.add(key);
        return true;
    });
}

function getItemsFromResults(results) {
    const items = [];

    results.forEach(result => {
        items.push(...getItems(result));
    });

    return items;
}

function filterRowItems(row, items) {
    if (typeof row.itemMatcher !== 'function') return items;

    return items.filter(item => row.itemMatcher(item));
}

function getGenreIds(row, genresByName) {
    return (row.genres || [])
        .map(genreName => genresByName.get(genreName.toLowerCase()))
        .filter(Boolean)
        .join(',');
}

function getPrimaryGenreId(row, genresByName) {
    return (row.genres || [])
        .map(genreName => genresByName.get(genreName.toLowerCase()))
        .find(Boolean) || '';
}

function getGenreUrl(row, genresByName, serverId) {
    if (row.type !== 'genre') return '';

    const genreId = getPrimaryGenreId(row, genresByName);
    if (!genreId || !serverId) return '';

    return `#/list?genreId=${encodeURIComponent(genreId)}&serverId=${encodeURIComponent(serverId)}`;
}

function getRowUrl(row, genresByName, serverId) {
    if (row.type === 'continue' || !serverId) return '';

    if (row.type === 'genre') {
        return getGenreUrl(row, genresByName, serverId);
    }

    if (row.type === 'latest' && row.itemTypes) {
        return `#/list?serverId=${encodeURIComponent(serverId)}&type=${encodeURIComponent(row.itemTypes)}`;
    }

    if (row.type === 'library' && row.parentId) {
        return `#/list?parentId=${encodeURIComponent(row.parentId)}&serverId=${encodeURIComponent(serverId)}`;
    }

    if (row.type === 'search') {
        const searchTerm = row.searchTerm || row.searchTerms?.[0] || row.title;

        return `#/search?query=${encodeURIComponent(searchTerm)}`;
    }

    return '';
}

function getStudioIds(row, studiosByName) {
    const studioIds = new Set();
    const studioNames = (row.studioNames || []).map(studioName => studioName.toLowerCase());
    const studioKeywords = (row.studioKeywords || []).map(studioName => studioName.toLowerCase());

    studioNames
        .map(studioName => studiosByName.get(studioName))
        .filter(Boolean)
        .forEach(studioId => {
            studioIds.add(studioId);
        });

    if (studioKeywords.length) {
        studiosByName.forEach((studioId, studioName) => {
            if (studioKeywords.some(keyword => studioName.includes(keyword))) {
                studioIds.add(studioId);
            }
        });
    }

    return Array.from(studioIds).join('|');
}

function getCardShape(row, enableOverflow) {
    if (row.shape === 'portrait') return getPortraitShape(enableOverflow);
    if (row.shape === 'square') return getSquareShape(enableOverflow);

    return getBackdropShape(enableOverflow);
}

function getCardsHtml(row, items, options) {
    let html = cardBuilder.getCardsHtml({
        items,
        shape: getCardShape(row, options.enableOverflow),
        preferThumb: row.shape !== 'portrait',
        scalable: true,
        overlayPlayButton: true,
        allowBottomPadding: false,
        showTitle: true,
        showYear: row.shape !== 'square',
        centerText: true,
        context: 'home',
        lines: 2
    });

    if (row.moreUrl) {
        html += getMoreCardHtml(row, options);
    }

    return html;
}

function getRowItemsHtml(row, options) {
    return items => getCardsHtml(row, items, options);
}

function getRandomIndex(length) {
    if (length <= 1) return 0;

    backdropSeed = (backdropSeed * 1664525 + 1013904223) >>> 0;

    return backdropSeed % length;
}

function getDirectImageUrl(apiClient, itemId, type, options) {
    if (!apiClient?.getUrl || !itemId) return '';

    const path = typeof options.index === 'number' ?
        `Items/${itemId}/Images/${type}/${options.index}` :
        `Items/${itemId}/Images/${type}`;

    const params = {
        maxWidth: options.maxWidth
    };

    if (options.tag) {
        params.tag = options.tag;
    }

    return apiClient.getUrl(path, params);
}

function getImageUrl(apiClient, itemId, type, options) {
    if (!apiClient || !itemId) return '';

    return getDirectImageUrl(apiClient, itemId, type, options)
        || apiClient.getScaledImageUrl(itemId, {
            type,
            ...options
        });
}

function getBackdropUrl(apiClient, item, options = {}) {
    const performanceProfile = getHomePerformanceProfile(options);

    if (!performanceProfile.enableRowBackdrops) return '';
    if (!apiClient || !item?.Id) return '';

    if (item.BackdropImageTags?.length) {
        return getImageUrl(apiClient, item.Id, 'Backdrop', {
            maxWidth: performanceProfile.rowBackdropMaxWidth,
            index: 0,
            tag: item.BackdropImageTags[0]
        });
    }

    if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.length) {
        return getImageUrl(apiClient, item.ParentBackdropItemId, 'Backdrop', {
            maxWidth: performanceProfile.rowBackdropMaxWidth,
            index: 0,
            tag: item.ParentBackdropImageTags[0]
        });
    }

    if (item.ImageTags?.Thumb) {
        return getImageUrl(apiClient, item.Id, 'Thumb', {
            maxWidth: performanceProfile.rowBackdropMaxWidth,
            tag: item.ImageTags.Thumb
        });
    }

    if (item.ParentThumbItemId && item.ParentThumbImageTag) {
        return getImageUrl(apiClient, item.ParentThumbItemId, 'Thumb', {
            maxWidth: performanceProfile.rowBackdropMaxWidth,
            tag: item.ParentThumbImageTag
        });
    }

    const primaryTag = item.ImageTags?.Primary
        || item.PrimaryImageTag
        || item.SeriesPrimaryImageTag
        || item.ParentPrimaryImageTag
        || item.AlbumPrimaryImageTag;

    if (!primaryTag) return '';

    return getImageUrl(apiClient, item.Id, 'Primary', {
        maxWidth: performanceProfile.rowPrimaryMaxWidth,
        tag: primaryTag
    });
}

function applyRowBackdropNow(elem, apiClient, items, options = {}) {
    const backdropElement = elem.querySelector('.ptv-row-backdrop');
    if (!backdropElement) return;

    if (!getHomePerformanceProfile(options).enableRowBackdrops) {
        rowBackdropLoads.get(elem)?.cancel();
        rowBackdropLoads.delete(elem);
        elem.classList.remove('ptv-row-has-backdrop');
        backdropElement.removeAttribute('style');
        return;
    }

    const backdropItems = getUniqueItems(items)
        .map(item => ({
            item,
            url: getBackdropUrl(apiClient, item, options)
        }))
        .filter(entry => entry.url);

    if (!backdropItems.length) {
        rowBackdropLoads.get(elem)?.cancel();
        rowBackdropLoads.delete(elem);
        elem.classList.remove('ptv-row-has-backdrop');
        backdropElement.removeAttribute('style');
        return;
    }

    const entry = backdropItems[getRandomIndex(backdropItems.length)];
    const safeUrl = entry.url.replace(/"/g, '%22');
    const token = (rowBackdropTokens.get(elem) || 0) + 1;
    const handle = loadPtvImage(entry.url, 'decorative', 'row-backdrop');

    rowBackdropTokens.set(elem, token);
    rowBackdropLoads.get(elem)?.cancel();
    rowBackdropLoads.set(elem, handle);

    void handle.promise
        .then((didLoad) => {
            if (!didLoad || rowBackdropTokens.get(elem) !== token || !elem.isConnected) return;

            backdropElement.setAttribute('style', `background-image: url("${safeUrl}");`);
            elem.classList.add('ptv-row-has-backdrop');

            const homeSections = elem.closest('.homeSectionsContainer');
            if (homeSections && !homeSections.style.getPropertyValue('--ptv-home-backdrop-image')) {
                homeSections.style.setProperty('--ptv-home-backdrop-image', `url("${safeUrl}")`);
                homeSections.classList.add('ptv-home-has-backdrop');
            }
        })
        .finally(() => {
            if (rowBackdropLoads.get(elem) === handle) {
                rowBackdropLoads.delete(elem);
            }
        });
}

function applyRowBackdrop(elem, apiClient, items, options = {}) {
    if (!getHomePerformanceProfile(options).enableRowBackdrops) {
        applyRowBackdropNow(elem, apiClient, items, options);
        return;
    }

    const existingObserver = rowBackdropObservers.get(elem);
    existingObserver?.disconnect();
    rowBackdropObservers.delete(elem);

    if (elem.dataset.ptvRowBackdropLoaded === 'true' || typeof IntersectionObserver !== 'function') {
        applyRowBackdropNow(elem, apiClient, items, options);
        elem.dataset.ptvRowBackdropLoaded = 'true';
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        if (!entries.some(entry => entry.isIntersecting)) return;

        observer.disconnect();
        rowBackdropObservers.delete(elem);
        elem.dataset.ptvRowBackdropLoaded = 'true';
        applyRowBackdropNow(elem, apiClient, items, options);
    }, {
        rootMargin: '360px 0px'
    });

    rowBackdropObservers.set(elem, observer);
    observer.observe(elem);
}

export function cleanupPtvRowBackdrops(root = document) {
    root.querySelectorAll?.('.ptv-dynamic-row').forEach((row) => {
        const observer = rowBackdropObservers.get(row);

        observer?.disconnect();
        rowBackdropObservers.delete(row);
        rowBackdropLoads.get(row)?.cancel();
        rowBackdropLoads.delete(row);
        rowBackdropTokens.delete(row);
        row.classList.remove('ptv-row-has-backdrop');
        row.querySelector('.ptv-row-backdrop')?.removeAttribute('style');
    });

    root.querySelectorAll?.('.itemsContainer').forEach((itemsContainer) => {
        if (typeof itemsContainer.ptvLazyImageCleanup === 'function') {
            itemsContainer.ptvLazyImageCleanup();
            itemsContainer.ptvLazyImageCleanup = null;
        }
    });

    if (root instanceof HTMLElement && root.classList.contains('homeSectionsContainer')) {
        root.style.removeProperty('--ptv-home-backdrop-image');
        root.classList.remove('ptv-home-has-backdrop');
    }

    cleanupPtvLazyImages(root);
}

function prepareManagedRowImages(itemsContainer, options = {}) {
    const performanceProfile = getHomePerformanceProfile(options);
    const rootMargin = performanceProfile.isLowPower || performanceProfile.isWebOs ?
        '180px 0px' :
        '480px 0px';

    enhancePtvLazyImageAttributes(itemsContainer);
    itemsContainer.ptvLazyImageCleanup?.();
    itemsContainer.ptvLazyImageCleanup = observePtvLazyImages(itemsContainer, {
        priority: performanceProfile.isLowPower ? 'below-fold-poster' : 'visible-poster',
        rootMargin,
        loadElement: (imageElement) => {
            if (
                imageElement instanceof HTMLElement
                && imageElement.classList.contains('lazy')
                && imageElement.dataset.src
            ) {
                imageLoader.lazyImage(imageElement);
            }
        }
    });
}

function forceLoadRowImages(itemsContainer, options = {}) {
    prepareManagedRowImages(itemsContainer, options);
}

function getMoreCardHtml(row, options) {
    const shape = getCardShape(row, options.enableOverflow);
    const url = escapeHtml(row.moreUrl);
    const title = escapeHtml(row.title);

    return [
        `<a is="emby-linkbutton" href="${url}" class="card ${shape}Card ptv-card ptv-row-more-card ptv-ignore-stock-bridge" aria-label="Open more ${title}">`,
        '<div class="cardBox">',
        '<div class="cardScalable">',
        `<div class="cardPadder cardPadder-${shape}"></div>`,
        '<div class="cardContent ptv-row-more-card-content">',
        '<span class="ptv-row-more-card-kicker">More</span>',
        `<span class="ptv-row-more-card-title">${title}</span>`,
        '<span class="material-icons chevron_right ptv-row-more-card-icon" aria-hidden="true"></span>',
        '</div>',
        '</div>',
        '</div>',
        '</a>'
    ].join('');
}

function getRowQuery(row, genreIds, studioIds = '', options = {}) {
    const query = {
        Limit: getRowQueryLimit(row, options),
        Recursive: true,
        Fields: MEDIA_FIELDS,
        EnableImages: true,
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop,Banner,Thumb',
        EnableTotalRecordCount: false
    };

    if (studioIds) {
        query.StudioIds = studioIds;
    }

    if (genreIds) {
        query.GenreIds = genreIds;
    }

    if (row.type === 'latest') {
        return {
            ...query,
            IncludeItemTypes: row.itemTypes,
            SortBy: 'PremiereDate,DateCreated,SortName',
            SortOrder: 'Descending'
        };
    }

    if (row.type === 'genre') {
        return {
            ...query,
            IncludeItemTypes: row.includeItemTypes || 'Movie,Series',
            GenreIds: genreIds,
            SortBy: 'Random'
        };
    }

    if (row.type === 'library') {
        const sortBy = row.sortBy || 'Random';

        return {
            ...query,
            IncludeItemTypes: row.itemTypes || 'Movie,Series',
            ParentId: row.parentId,
            SortBy: sortBy,
            SortOrder: sortBy === 'Random' ? undefined : row.sortOrder || 'Descending'
        };
    }

    return {
        ...query,
        IncludeItemTypes: row.includeItemTypes || 'Movie,Series',
        SearchTerm: row.searchTerm || row.searchTerms?.[0],
        SortBy: 'Random'
    };
}

function getLibraryParentId(row, userViews) {
    const libraryNames = row.libraryNames || [];
    const library = userViews.find(view =>
        view.Id
        && libraryNames.includes(`${view.Name || ''}`.toLowerCase())
    );

    return library?.Id || '';
}

function fetchRowResultCore(currentApiClient, userId, row, genresByName, studiosByName, userViews, options = {}) {
    if (row.type === 'continue') {
        return currentApiClient.getResumableItems(userId, {
            Limit: getRowItemLimit(row, options),
            Recursive: true,
            Fields: MEDIA_FIELDS,
            EnableImages: true,
            ImageTypeLimit: 1,
            EnableImageTypes: 'Primary,Backdrop,Thumb',
            EnableTotalRecordCount: false,
            MediaTypes: 'Video'
        });
    }

    if (row.type === 'library') {
        const parentId = row.parentId || getLibraryParentId(row, userViews);

        if (!parentId) {
            return currentApiClient.getItems(userId, getRowQuery({
                ...row,
                type: 'search',
                searchTerm: row.title
            }, '', '', options));
        }

        return currentApiClient.getItems(userId, getRowQuery({
            ...row,
            parentId
        }, '', '', options));
    }

    const genreIds = row.genres?.length ? getGenreIds(row, genresByName) : '';
    const studioIds = getStudioIds(row, studiosByName);

    if (row.type === 'genre' && !genreIds) {
        return Promise.resolve({ Items: [] });
    }

    if (row.searchTerms?.length) {
        const searchRequests = getSearchTerms(row, options).map(searchTerm =>
            currentApiClient.getItems(userId, getRowQuery({
                ...row,
                searchTerm
            }, genreIds, '', options)).catch(() => ({ Items: [] }))
        );
        const studioRequests = studioIds ? [
            currentApiClient.getItems(userId, getRowQuery({
                ...row,
                searchTerm: undefined,
                searchTerms: undefined
            }, genreIds, studioIds, options))
                .catch(() => ({ Items: [] }))
        ] : [];

        return Promise.all([
            ...searchRequests,
            ...studioRequests
        ])
            .then(results => ({
                Items: getUniqueItems(getItemsFromResults(results))
                    .slice(0, getRowCandidateLimit(row, options))
            }));
    }

    return currentApiClient.getItems(userId, getRowQuery(row, genreIds, studioIds, options));
}

function fetchRowResult(currentApiClient, userId, row, genresByName, studiosByName, userViews, options = {}) {
    return timePtvAsync(
        'row-fetch',
        row.id || row.title || row.type || 'row',
        () => fetchRowResultCore(currentApiClient, userId, row, genresByName, studiosByName, userViews, options),
        {
            renderProfile: getHomePerformanceProfile(options).renderProfile?.id,
            rowType: row.type
        }
    );
}

function getPayloadRowItems(payload, row, options = {}) {
    const rowId = row.id;
    const items = payload?.sectionItems?.[rowId];

    if (!Array.isArray(items) || !items.length) return null;
    if (!items.some(hasRenderableImage)) return null;

    return items.slice(0, getRowItemLimit(row, options));
}

function fetchSectionItems(currentApiClient, userId, row, lookupMaps, userViews, options = {}) {
    if (row.type === 'libraries') {
        return Promise.resolve([
            row.id,
            userViews.slice(0, getRowItemLimit(row, options))
        ]);
    }

    const rowForQuery = row.type === 'library' ? {
        ...row,
        parentId: row.parentId || getLibraryParentId(row, userViews)
    } : row;

    return fetchRowResult(
        currentApiClient,
        userId,
        rowForQuery,
        lookupMaps.genresByName,
        lookupMaps.studiosByName,
        userViews,
        options
    )
        .then(result => [
            row.id,
            filterRowItems(row, getItems(result)).slice(0, getRowItemLimit(row, options))
        ]);
}

function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;

    function runNext() {
        const index = nextIndex;
        nextIndex++;

        if (index >= items.length) {
            return Promise.resolve();
        }

        return Promise.resolve(mapper(items[index], index))
            .then(result => {
                results[index] = result;
            })
            .then(runNext);
    }

    const workerCount = Math.max(1, Math.min(concurrency || items.length || 1, items.length || 1));
    const workers = Array.from({ length: workerCount }, () => runNext());

    return Promise.all(workers).then(() => results);
}

export function createFeaturedContentFetcher(apiClient, userId, rows, lookupMaps, userViews, options = {}) {
    const serverId = apiClient.serverId();
    const performanceProfile = getHomePerformanceProfile(options);
    const contentRows = rows
        .filter(row => row.type !== 'libraries' && row.type !== 'continue')
        .slice(0, performanceProfile.featuredRowLimit || rows.length);

    return function () {
        const currentApiClient = ServerConnections.getApiClient(serverId) || apiClient;

        return timePtvAsync(
            'recommendation',
            'featured-content-batch',
            () => Promise.all([
                loadSharedHeroItems(currentApiClient, userId).catch(() => []),
                mapWithConcurrency(contentRows, performanceProfile.featuredFetchConcurrency, row =>
                    fetchSectionItems(currentApiClient, userId, row, lookupMaps, userViews, options)
                        .catch(() => [
                            row.id,
                            []
                        ])
                )
                    .then(entries => entries.reduce((sections, [sectionId, items]) => ({
                        ...sections,
                        [sectionId]: items
                    }), {}))
            ])
                .then(([heroItems, sectionItems]) => ({
                    heroItems,
                    sectionItems
                })),
            {
                renderProfile: performanceProfile.renderProfile?.id,
                rows: contentRows.length
            }
        );
    };
}

function createFetchData({
    apiClient,
    featuredContentSource,
    genresByName,
    options = {},
    row,
    studiosByName,
    userId,
    userViews
}) {
    const serverId = apiClient.serverId();

    return function () {
        const currentApiClient = ServerConnections.getApiClient(serverId);
        const fetchFallbackRow = () => fetchRowResult(
            currentApiClient,
            userId,
            row,
            genresByName,
            studiosByName,
            userViews,
            options
        );

        if (row.type === 'continue') {
            return fetchFallbackRow();
        }

        const sharedFeaturedContent = featuredContentSource?.get?.()
            || getFeaturedContent(createFeaturedContentFetcher(
                apiClient,
                userId,
                [row],
                {
                    genresByName,
                    studiosByName
                },
                userViews,
                options
            ));

        return sharedFeaturedContent
            .then(payload => {
                const cachedItems = getPayloadRowItems(payload, row, options);

                if (cachedItems) {
                    recordPtvEvent('cache', 'hit', {
                        row: row.id,
                        source: 'section-payload'
                    });
                    return { Items: cachedItems };
                }

                recordPtvEvent('cache', 'miss', {
                    row: row.id,
                    source: 'section-payload'
                });
                return fetchFallbackRow();
            })
            .catch(fetchFallbackRow);
    };
}

function renderRowShell(elem, row, options) {
    let html = '';

    elem.classList.add('ptv-dynamic-row');
    html += '<div class="ptv-row-backdrop" aria-hidden="true"></div>';

    if (row.moreUrl) {
        html += `<a is="emby-linkbutton" href="${escapeHtml(row.moreUrl)}" class="sectionTitle sectionTitle-cards padded-left ptv-row-title-link ptv-ignore-stock-bridge" aria-label="Open ${escapeHtml(row.title)}">`;
        html += escapeHtml(row.title);
        html += '<span class="material-icons chevron_right ptv-row-title-link-icon" aria-hidden="true"></span>';
        html += '</a>';
    } else {
        html += '<h2 class="sectionTitle sectionTitle-cards padded-left">' + escapeHtml(row.title) + '</h2>';
    }

    if (options.enableOverflow) {
        html += '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-mousewheel="false" data-centerfocus="true">';
        html += '<div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x">';
    } else {
        html += '<div is="emby-itemscontainer" class="itemsContainer focuscontainer-x padded-left padded-right vertical-wrap">';
    }

    if (options.enableOverflow) {
        html += '</div>';
    }

    html += '</div>';
    elem.innerHTML = html;
}

export function renderLibraryRow(elem, apiClient, userViews, options) {
    const rowWithNavigation = {
        ...PTV_HOME_ROWS[0],
        moreUrl: `#/home.html?serverId=${encodeURIComponent(apiClient.serverId())}`
    };

    renderRowShell(elem, rowWithNavigation, options);

    const itemsContainer = elem.querySelector('.itemsContainer');
    if (!itemsContainer) return;

    let html = cardBuilder.getCardsHtml({
        items: userViews,
        shape: getBackdropShape(options.enableOverflow),
        showTitle: true,
        centerText: true,
        overlayText: false,
        lazy: true,
        transition: false,
        allowBottomPadding: !options.enableOverflow
    });

    html += getMoreCardHtml({
        ...rowWithNavigation,
        title: 'Libraries'
    }, options);

    itemsContainer.innerHTML = html;
    imageLoader.lazyChildren(elem);
    forceLoadRowImages(itemsContainer, options);
    applyRowBackdrop(elem, apiClient, userViews, options);
}

export function renderMediaRow(elem, apiClient, userId, row, lookupMaps, userViews, options) {
    const parentId = row.type === 'library' ? getLibraryParentId(row, userViews) : '';
    const rowWithNavigation = {
        ...row,
        parentId,
        moreUrl: getRowUrl({
            ...row,
            parentId
        }, lookupMaps.genresByName, apiClient.serverId())
    };

    renderRowShell(elem, rowWithNavigation, options);
    elem.classList.add('hide');

    const itemsContainer = elem.querySelector('.itemsContainer');
    if (!itemsContainer) return;

    itemsContainer.fetchData = createFetchData({
        apiClient,
        featuredContentSource: options.featuredContentSource,
        genresByName: lookupMaps.genresByName,
        options,
        row: rowWithNavigation,
        studiosByName: lookupMaps.studiosByName,
        userId,
        userViews
    });
    itemsContainer.getItemsHtml = getRowItemsHtml(rowWithNavigation, options);
    itemsContainer.parentContainer = elem;
    itemsContainer.afterRefresh = function (result) {
        applyRowBackdrop(elem, apiClient, getItems(result), options);
        forceLoadRowImages(itemsContainer, options);
    };
}

export function loadGenreMap(apiClient, userId) {
    return apiClient.getGenres(userId, {
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        Limit: 300
    })
        .then(result => new Map((result.Items || [])
            .filter(genre => genre.Id && genre.Name)
            .map(genre => [genre.Name.toLowerCase(), genre.Id])))
        .catch(() => new Map());
}

export function loadStudioMap(apiClient, userId) {
    if (!apiClient.getStudios) {
        return Promise.resolve(new Map());
    }

    return apiClient.getStudios(userId, {
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        Limit: 500
    })
        .then(result => new Map((result.Items || [])
            .filter(studio => studio.Id && studio.Name)
            .map(studio => [studio.Name.toLowerCase(), studio.Id])))
        .catch(() => new Map());
}
