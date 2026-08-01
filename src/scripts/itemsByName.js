import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';

import listView from 'components/listview/listview';
import cardBuilder from 'components/cardbuilder/cardBuilder';
import imageLoader from 'components/images/imageLoader';
import globalize from 'lib/globalize';
import {
    getPtvCurrentUserId,
    requestPtvJson
} from '../ptv/api/client';

import '../elements/emby-itemscontainer/emby-itemscontainer';
import '../elements/emby-button/emby-button';

function isItemsByNameRenderCurrent(options) {
    return !options?.signal?.aborted && options?.isCurrent?.() !== false;
}

function isItemsByNameAbortError(error) {
    return error?.name === 'AbortError';
}

function createItemsByNameAbortError() {
    const error = new Error('Items-by-name rendering was cancelled.');

    error.name = 'AbortError';
    return error;
}

function renderItems(page, item, options = {}) {
    if (options.signal?.aborted) {
        return Promise.reject(createItemsByNameAbortError());
    }

    if (!isItemsByNameRenderCurrent(options)) return Promise.resolve();

    const sections = [];

    if (item.ArtistCount) {
        sections.push({
            name: globalize.translate('Artists'),
            type: 'MusicArtist'
        });
    }

    if (item.ProgramCount && item.Type === 'Person') {
        sections.push({
            name: globalize.translate('HeaderUpcomingOnTV'),
            type: 'Program'
        });
    }

    if (item.MovieCount) {
        sections.push({
            name: globalize.translate('Movies'),
            type: 'Movie'
        });
    }

    if (item.SeriesCount) {
        sections.push({
            name: globalize.translate('Shows'),
            type: 'Series'
        });
    }

    if (item.EpisodeCount) {
        sections.push({
            name: globalize.translate('Episodes'),
            type: 'Episode'
        });
    }

    if (item.TrailerCount) {
        sections.push({
            name: globalize.translate('Trailers'),
            type: 'Trailer'
        });
    }

    if (item.AlbumCount) {
        sections.push({
            name: globalize.translate('Albums'),
            type: 'MusicAlbum'
        });
    }

    if (item.MusicVideoCount) {
        sections.push({
            name: globalize.translate('MusicVideos'),
            type: 'MusicVideo'
        });
    }

    const elem = page.querySelector('#childrenContent');
    elem.innerHTML = sections.map(function (section) {
        let html = '';
        let sectionClass = 'verticalSection';

        if (section.type === 'Audio') {
            sectionClass += ' verticalSection-extrabottompadding';
        }

        html += '<div class="' + sectionClass + '" data-type="' + section.type + '">';
        html += '<div class="sectionTitleContainer sectionTitleContainer-cards">';
        html += '<h2 class="sectionTitle sectionTitle-cards">';
        html += section.name;
        html += '</h2>';
        html += '<a is="emby-linkbutton" href="#" class="clearLink hide" style="margin-left:1em;vertical-align:middle;"><button is="emby-button" type="button" class="raised more raised-mini noIcon">' + globalize.translate('ButtonMore') + '</button></a>';
        html += '</div>';
        html += '<div is="emby-itemscontainer" class="itemsContainer padded-right">';
        html += '</div>';
        html += '</div>';
        return html;
    }).join('');
    const sectionElems = elem.querySelectorAll('.verticalSection');

    return Promise.all(Array.from(sectionElems, section => (
        renderSection(item, section, section.getAttribute('data-type'), options)
    )));
}

function renderSection(item, element, type, options) {
    let loadPromise = Promise.resolve();
    const loadCurrentItems = (query, listOptions) => (
        loadPromise = loadItems(element, item, type, query, listOptions, options)
    );

    switch (type) {
        case 'Program':
            loadCurrentItems({
                MediaTypes: '',
                IncludeItemTypes: 'Program',
                PersonTypes: '',
                ArtistIds: '',
                AlbumArtistIds: '',
                Limit: 10,
                SortBy: 'StartDate'
            }, {
                shape: 'overflowBackdrop',
                showTitle: true,
                centerText: true,
                overlayMoreButton: true,
                preferThumb: true,
                overlayText: false,
                showAirTime: true,
                showAirDateTime: true,
                showChannelName: true
            });
            break;

        case 'Movie':
            loadCurrentItems({
                MediaTypes: '',
                IncludeItemTypes: 'Movie',
                PersonTypes: '',
                ArtistIds: '',
                AlbumArtistIds: '',
                Limit: 10,
                SortOrder: 'Descending,Descending,Ascending',
                SortBy: 'PremiereDate,ProductionYear,SortName'
            }, {
                shape: 'overflowPortrait',
                showTitle: true,
                centerText: true,
                overlayMoreButton: true,
                overlayText: false,
                showYear: true
            });
            break;

        case 'MusicVideo':
            loadCurrentItems({
                MediaTypes: '',
                IncludeItemTypes: 'MusicVideo',
                PersonTypes: '',
                ArtistIds: '',
                AlbumArtistIds: '',
                Limit: 10,
                SortBy: 'SortName'
            }, {
                shape: 'overflowBackdrop',
                showTitle: true,
                centerText: true,
                overlayPlayButton: true
            });
            break;

        case 'Trailer':
            loadCurrentItems({
                MediaTypes: '',
                IncludeItemTypes: 'Trailer',
                PersonTypes: '',
                ArtistIds: '',
                AlbumArtistIds: '',
                Limit: 10,
                SortBy: 'SortName'
            }, {
                shape: 'overflowPortrait',
                showTitle: true,
                centerText: true,
                overlayPlayButton: true
            });
            break;

        case 'Series':
            loadCurrentItems({
                MediaTypes: '',
                IncludeItemTypes: 'Series',
                PersonTypes: '',
                ArtistIds: '',
                AlbumArtistIds: '',
                Limit: 10,
                SortBy: 'SortName'
            }, {
                shape: 'overflowPortrait',
                showTitle: true,
                centerText: true,
                overlayMoreButton: true
            });
            break;

        case 'MusicAlbum':
            loadCurrentItems({
                MediaTypes: '',
                IncludeItemTypes: 'MusicAlbum',
                PersonTypes: '',
                ArtistIds: '',
                AlbumArtistIds: '',
                SortOrder: 'Descending,Descending,Ascending',
                SortBy: 'PremiereDate,ProductionYear,Sortname'
            }, {
                shape: 'overflowSquare',
                playFromHere: true,
                showTitle: true,
                showYear: true,
                coverImage: true,
                centerText: true,
                overlayPlayButton: true
            });
            break;

        case 'MusicArtist':
            loadCurrentItems({
                MediaTypes: '',
                IncludeItemTypes: 'MusicArtist',
                PersonTypes: '',
                ArtistIds: '',
                AlbumArtistIds: '',
                Limit: 8,
                SortBy: 'SortName'
            }, {
                shape: 'overflowSquare',
                playFromHere: true,
                showTitle: true,
                showParentTitle: true,
                coverImage: true,
                centerText: true,
                overlayPlayButton: true
            });
            break;

        case 'Episode':
            loadCurrentItems({
                MediaTypes: '',
                IncludeItemTypes: 'Episode',
                PersonTypes: '',
                ArtistIds: '',
                AlbumArtistIds: '',
                Limit: 6,
                SortBy: 'SortName'
            }, {
                shape: 'overflowBackdrop',
                showTitle: true,
                showParentTitle: true,
                centerText: true,
                overlayPlayButton: true
            });
            break;

        case 'Audio':
            loadCurrentItems({
                MediaTypes: '',
                IncludeItemTypes: 'Audio',
                PersonTypes: '',
                ArtistIds: '',
                AlbumArtistIds: '',
                SortBy: 'AlbumArtist,Album,SortName'
            }, {
                playFromHere: true,
                action: 'playallfromhere',
                smallIcon: true,
                artist: true
            });
    }

    return loadPromise;
}

function loadItems(element, item, type, query, listOptions, options) {
    query = getQuery(query, item);
    return requestItemsByName(query, item, options).then(function (result) {
        if (!isItemsByNameRenderCurrent(options)) return;

        // If results are empty, hide the section
        if (!result.Items?.length) {
            element.classList.add('hide');
            return;
        }

        let html = '';

        if (query.Limit && result.TotalRecordCount > query.Limit) {
            const link = element.querySelector('a');
            link.classList.remove('hide');
            link.setAttribute('href', getMoreItemsHref(item, type));
        } else {
            element.querySelector('a').classList.add('hide');
        }

        listOptions.items = result.Items;
        const itemsContainer = element.querySelector('.itemsContainer');

        if (type === 'Audio') {
            html = listView.getListViewHtml(listOptions);
            itemsContainer.classList.remove('vertical-wrap');
            itemsContainer.classList.add('vertical-list');
        } else {
            html = cardBuilder.getCardsHtml(listOptions);
            itemsContainer.classList.add('vertical-wrap');
            itemsContainer.classList.remove('vertical-list');
        }

        itemsContainer.innerHTML = html;
        imageLoader.lazyChildren(itemsContainer);
    }).catch(error => {
        if (isItemsByNameAbortError(error)) throw error;
        if (!isItemsByNameRenderCurrent(options)) return;

        renderItemsByNameFailure(
            element,
            () => loadItems(element, item, type, query, listOptions, options)
        );
    });
}

function renderItemsByNameFailure(element, retry) {
    const itemsContainer = element.querySelector('.itemsContainer');
    const panel = document.createElement('div');
    const message = document.createElement('span');
    const button = document.createElement('button');

    panel.className = 'ptv-detail-section-failure';
    panel.setAttribute('role', 'status');
    message.textContent = 'This section could not be loaded.';
    button.type = 'button';
    button.className = 'button-submit raised emby-button';
    button.textContent = 'Retry';
    button.addEventListener('click', () => {
        button.disabled = true;
        void retry().catch(error => {
            if (!isItemsByNameAbortError(error)) {
                console.error('[ItemsByName] Retry failed', error);
            }
        });
    }, { once: true });
    panel.append(message, button);
    itemsContainer.replaceChildren(panel);
    element.classList.remove('hide');
}

function getMoreItemsHref(item, type) {
    if (item.Type === 'Genre') {
        return '#/list?type=' + type + '&genreId=' + item.Id + '&serverId=' + item.ServerId;
    }

    if (item.Type === 'MusicGenre') {
        return '#/list?type=' + type + '&musicGenreId=' + item.Id + '&serverId=' + item.ServerId;
    }

    if (item.Type === 'Studio') {
        return '#/list?type=' + type + '&studioId=' + item.Id + '&serverId=' + item.ServerId;
    }

    if (item.Type === 'MusicArtist') {
        return '#/list?type=' + type + '&artistId=' + item.Id + '&serverId=' + item.ServerId;
    }

    if (item.Type === 'Person') {
        return '#/list?type=' + type + '&personId=' + item.Id + '&serverId=' + item.ServerId;
    }

    return '#/list?type=' + type + '&parentId=' + item.Id + '&serverId=' + item.ServerId;
}

function addCurrentItemToQuery(query, item) {
    switch (item.Type) {
        case BaseItemKind.Person:
            query.PersonIds = item.Id;
            break;
        case BaseItemKind.Genre:
            query.Genres = item.Name;
            break;
        case BaseItemKind.MusicGenre:
            query.Genres = item.Name;
            break;
        case BaseItemKind.Studio:
            query.StudioIds = item.Id;
            break;
        case BaseItemKind.MusicArtist:
            if (query.IncludeItemTypes === BaseItemKind.MusicVideo) {
                query.ArtistIds = item.Id;
            } else {
                query.AlbumArtistIds = item.Id;
            }
    }
}

function getQuery(options, item) {
    let query = {
        SortOrder: 'Ascending',
        IncludeItemTypes: '',
        Recursive: true,
        Fields: 'ParentId,PrimaryImageAspectRatio',
        Limit: 100,
        StartIndex: 0,
        CollapseBoxSetItems: false
    };
    query = Object.assign(query, options || {});
    addCurrentItemToQuery(query, item);
    return query;
}

function requestItemsByName(query, item, options) {
    const userId = options.userId || getPtvCurrentUserId(item.ServerId);
    const params = {
        ...query
    };
    let path = `Users/${userId}/Items`;

    if (params.IncludeItemTypes === 'MusicArtist') {
        params.IncludeItemTypes = null;
        params.UserId = userId;
        path = 'Artists/AlbumArtists';
    }

    return requestPtvJson(path, {
        params,
        serverId: item.ServerId,
        signal: options.signal
    });
}

const ItemsByName = {
    renderItems
};

export default ItemsByName;
