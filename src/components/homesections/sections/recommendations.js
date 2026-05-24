import escapeHtml from 'escape-html';

import cardBuilder from 'components/cardbuilder/cardBuilder';
import imageLoader from 'components/images/imageLoader';
import globalize from 'lib/globalize';
import { getBackdropShape } from 'utils/card';

const BECAUSE_SECTION_COUNT = 3;
const GENRE_SECTION_COUNT = 3;
const MIN_ITEMS_PER_SECTION = 3;
const SECTION_ITEM_LIMIT = 14;
const REQUEST_SECTION_LIMIT = 16;
const RELATED_RECOMMENDATION_TYPES = new Set([
    'SimilarToRecentlyPlayed',
    'SimilarToLikedItem',
    'HasDirectorFromRecentlyPlayed',
    'HasLikedDirector',
    'HasActorFromRecentlyPlayed',
    'HasLikedActor'
]);

function shuffle(items) {
    const shuffled = [...items];
    let seed = Date.now() + (shuffled.length * 9973);

    for (let i = shuffled.length - 1; i > 0; i--) {
        seed = ((seed * 1664525) + 1013904223) % 4294967296;
        const j = seed % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
}

function getRecommendationTitle(recommendation) {
    const name = recommendation.BaselineItemName || '';

    switch (recommendation.RecommendationType) {
        case 'SimilarToRecentlyPlayed':
            return globalize.translate('RecommendationBecauseYouWatched', name);
        case 'SimilarToLikedItem':
            return globalize.translate('RecommendationBecauseYouLike', name);
        case 'HasDirectorFromRecentlyPlayed':
        case 'HasLikedDirector':
            return globalize.translate('RecommendationDirectedBy', name);
        case 'HasActorFromRecentlyPlayed':
        case 'HasLikedActor':
            return globalize.translate('RecommendationStarring', name);
        default:
            return '';
    }
}

function isRelatedRecommendation(recommendation) {
    return Boolean(
        recommendation
        && RELATED_RECOMMENDATION_TYPES.has(recommendation.RecommendationType)
        && recommendation.BaselineItemName
        && (recommendation.BaselineItemId || recommendation.ItemId)
        && recommendation.Items?.length
    );
}

function getItemKey(item) {
    return item.Id || item.ItemId || `${item.Name || ''}-${item.ProductionYear || ''}`;
}

function getUniqueItems(items, usedItemIds, baselineId) {
    return (items || []).filter(item => {
        const key = getItemKey(item);

        if (!key || key === baselineId || usedItemIds.has(key)) {
            return false;
        }

        usedItemIds.add(key);
        return true;
    });
}

function getSectionHtml({ title, items }, options) {
    if (!items || items.length < MIN_ITEMS_PER_SECTION) return '';

    let html = '';

    html += '<div class="verticalSection ptv-recommendations-section">';
    html += '<h2 class="sectionTitle sectionTitle-cards padded-left">' + escapeHtml(title) + '</h2>';

    if (options.enableOverflow) {
        html += '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-mousewheel="false" data-centerfocus="true">';
        html += '<div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x">';
    } else {
        html += '<div is="emby-itemscontainer" class="itemsContainer focuscontainer-x padded-left padded-right vertical-wrap">';
    }

    html += cardBuilder.getCardsHtml({
        items,
        shape: getBackdropShape(options.enableOverflow),
        preferThumb: true,
        scalable: true,
        overlayPlayButton: true,
        allowBottomPadding: false,
        showTitle: true,
        showYear: true,
        centerText: true,
        context: 'home',
        lines: 2
    });

    if (options.enableOverflow) {
        html += '</div>';
    }

    html += '</div>';
    html += '</div>';

    return html;
}

function hydrateItemsWithMediaSources(apiClient, userId, items) {
    const ids = (items || [])
        .map(item => item.Id)
        .filter(Boolean);

    if (!ids.length) {
        return Promise.resolve(items || []);
    }

    const url = apiClient.getUrl('Users/' + userId + '/Items', {
        Ids: ids.join(','),
        Fields: 'PrimaryImageAspectRatio,MediaSources,MediaSourceCount,Genres,DateCreated,CommunityRating,CriticRating',
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop,Banner,Thumb',
        EnableTotalRecordCount: false
    });

    return apiClient.getJSON(url)
        .then(result => result.Items || items)
        .catch(() => items || []);
}

function loadBecauseYouWatchedSections(apiClient, userId) {
    const url = apiClient.getUrl('Movies/Recommendations', {
        userId,
        categoryLimit: 10,
        itemLimit: SECTION_ITEM_LIMIT,
        fields: 'PrimaryImageAspectRatio,MediaSourceCount,MediaSources,Genres,DateCreated,CommunityRating,CriticRating',
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop,Banner,Thumb'
    });

    return apiClient.getJSON(url).then(recommendations => {
        const usedItemIds = new Set();

        return shuffle(recommendations || [])
            .filter(isRelatedRecommendation)
            .map(recommendation => ({
                title: getRecommendationTitle(recommendation),
                items: getUniqueItems(
                    recommendation.Items,
                    usedItemIds,
                    recommendation.BaselineItemId || recommendation.ItemId
                )
            }))
            .filter(section => section.title && section.items.length >= MIN_ITEMS_PER_SECTION)
            .slice(0, BECAUSE_SECTION_COUNT);
    });
}

function getGenreScore(items) {
    return (items || []).reduce((scores, item) => {
        (item.Genres || []).forEach(genre => {
            scores[genre] = (scores[genre] || 0) + 1;
        });

        return scores;
    }, {});
}

function loadCandidateGenres(apiClient, userId) {
    const genreQuery = {
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        Limit: 100
    };

    const historyUrl = apiClient.getUrl('Users/' + userId + '/Items', {
        SortBy: 'DatePlayed',
        SortOrder: 'Descending',
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        IsPlayed: true,
        Fields: 'Genres',
        Limit: 80,
        EnableTotalRecordCount: false
    });

    return Promise.all([
        apiClient.getGenres(userId, genreQuery),
        apiClient.getJSON(historyUrl).catch(() => ({ Items: [] }))
    ]).then(([genresResult, historyResult]) => {
        const scores = getGenreScore(historyResult.Items);
        const genres = (genresResult.Items || [])
            .map(genre => ({
                ...genre,
                ptvScore: scores[genre.Name] || 0
            }))
            .filter(genre => genre.Id && genre.Name);

        const watchedGenres = genres.filter(genre => genre.ptvScore > 0);
        const sourceGenres = watchedGenres.length >= GENRE_SECTION_COUNT ? watchedGenres : genres;

        return shuffle(sourceGenres)
            .slice(0, GENRE_SECTION_COUNT);
    });
}

function loadGenreItems(apiClient, userId, genre) {
    const url = apiClient.getUrl('Users/' + userId + '/Items', {
        SortBy: 'Random',
        SortOrder: 'Ascending',
        IncludeItemTypes: 'Movie,Series',
        Recursive: true,
        Fields: 'PrimaryImageAspectRatio,MediaSourceCount,MediaSources,Genres,DateCreated,CommunityRating,CriticRating',
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop,Banner,Thumb',
        Limit: SECTION_ITEM_LIMIT,
        GenreIds: genre.Id,
        EnableTotalRecordCount: false
    });

    return apiClient.getJSON(url).then(result => ({
        title: `${genre.Name} Picks`,
        items: result.Items || []
    }));
}

function loadGenreSections(apiClient, userId) {
    return loadCandidateGenres(apiClient, userId)
        .then(genres => Promise.all(genres.map(genre => loadGenreItems(apiClient, userId, genre))))
        .then(sections => sections.filter(section => section.items.length >= MIN_ITEMS_PER_SECTION));
}

function loadRequestSection(apiClient, userId) {
    const url = apiClient.getUrl('HomeScreen/Section/MyJellyseerrRequests', {
        userId
    });

    return apiClient.getJSON(url)
        .then(result => hydrateItemsWithMediaSources(apiClient, userId, (result && result.Items) || []))
        .then(items => {
            const requestItems = (items || []).slice(0, REQUEST_SECTION_LIMIT);

            if (requestItems.length < MIN_ITEMS_PER_SECTION) {
                return null;
            }

            return {
                title: 'My Requests',
                items: requestItems
            };
        })
        .catch(() => null);
}

export function loadRecommendations(elem, apiClient, user, options) {
    if (!elem) return Promise.resolve();

    const userId = user.Id || apiClient.getCurrentUserId();

    elem.classList.add('ptvRecommendationsMount');
    elem.classList.add('hide');

    return Promise.all([
        loadRequestSection(apiClient, userId),
        loadBecauseYouWatchedSections(apiClient, userId),
        loadGenreSections(apiClient, userId)
    ])
        .then(([requestSection, becauseSections, genreSections]) => {
            const sections = [
                ...(requestSection ? [requestSection] : []),
                ...shuffle([
                    ...becauseSections.slice(0, BECAUSE_SECTION_COUNT),
                    ...genreSections.slice(0, GENRE_SECTION_COUNT)
                ])
            ];

            const html = sections
                .map(section => getSectionHtml(section, options))
                .filter(Boolean)
                .join('');

            if (!html) {
                elem.innerHTML = '';
                elem.classList.add('hide');
                return;
            }

            elem.innerHTML = html;
            elem.classList.remove('hide');
            imageLoader.lazyChildren(elem);
        })
        .catch(err => {
            console.warn('[PTV Home] Failed loading recommendations', err);
            elem.innerHTML = '';
            elem.classList.add('hide');
        });
}
