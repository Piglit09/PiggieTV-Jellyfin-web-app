import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';

import { ServerConnections } from '../../../lib/jellyfin-apiclient';
import { currentSettings as userSettings } from '../../../scripts/settings/userSettings';
import { toApi } from '../../../utils/jellyfin-apiclient/compat';
import { registerModule } from '../../core/lifecycle';
import { watchDom } from '../../core/observer';

import './theme-songs.scss';

const DETAIL_PAGE_SELECTOR = '#itemDetailPage, .itemDetailPage';
const CHIP_CLASS = 'ptv-theme-song-chip';
const CACHE_TTL = 5 * 60 * 1000;

let currentParams = {};
let stopWatchingDom = null;
let requestToken = 0;
const cache = new Map();

function readParamsFromHash() {
    const hash = window.location.hash || '';
    const queryIndex = hash.indexOf('?');

    if (queryIndex === -1) return {};

    const params = hash.slice(queryIndex + 1).split('&').reduce((result, part) => {
        const splitIndex = part.indexOf('=');
        const key = splitIndex === -1 ? part : part.slice(0, splitIndex);
        const value = splitIndex === -1 ? '' : part.slice(splitIndex + 1);

        if (key) {
            result[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
        }

        return result;
    }, {});

    return {
        id: params.id || params.itemId,
        serverId: params.serverId
    };
}

function getCurrentParams() {
    const hashParams = readParamsFromHash();

    return {
        id: currentParams.id || hashParams.id,
        serverId: currentParams.serverId || hashParams.serverId
    };
}

function getThemeCacheKey(serverId, itemId) {
    return `${serverId || 'default'}:${itemId}`;
}

function getCachedThemeSongs(serverId, itemId) {
    const cached = cache.get(getThemeCacheKey(serverId, itemId));

    if (!cached || Date.now() - cached.createdAt > CACHE_TTL) {
        return null;
    }

    return cached.items;
}

function setCachedThemeSongs(serverId, itemId, items) {
    cache.set(getThemeCacheKey(serverId, itemId), {
        createdAt: Date.now(),
        items
    });
}

async function loadThemeSongs(serverId, itemId) {
    const cached = getCachedThemeSongs(serverId, itemId);

    if (cached) return cached;

    const apiClient = ServerConnections.getApiClient(serverId);
    const api = toApi(apiClient);
    const userId = apiClient.getCurrentUserId();
    const { data } = await getLibraryApi(api).getThemeMedia({
        userId,
        itemId,
        inheritFromParent: true,
        sortBy: [ItemSortBy.Random]
    });

    const songs = data?.ThemeSongsResult?.Items || [];
    setCachedThemeSongs(serverId, itemId, songs);

    return songs;
}

function removeChip(page) {
    page?.querySelector(`.${CHIP_CLASS}`)?.remove();
}

function getTargetContainer(page) {
    return page.querySelector('.mainDetailButtons') || page.querySelector('.detailRibbon');
}

function createChip(count) {
    const chip = document.createElement('button');
    const enabled = userSettings.enableThemeSongs();

    chip.type = 'button';
    chip.className = `${CHIP_CLASS} ${enabled ? 'ptv-theme-song-chip-enabled' : 'ptv-theme-song-chip-disabled'}`;
    chip.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    chip.setAttribute('aria-label', enabled ? 'Theme songs enabled' : 'Enable theme songs');
    chip.innerHTML = `
        <span class="ptv-icon" data-ptv-icon="music" aria-hidden="true"></span>
        <span class="ptv-theme-song-chip-text">${enabled ? 'Theme Song' : 'Theme Songs Off'}</span>
        <span class="ptv-theme-song-chip-count" aria-hidden="true">${count}</span>
    `;

    chip.addEventListener('click', () => {
        const nextEnabled = !userSettings.enableThemeSongs();
        userSettings.enableThemeSongs(nextEnabled);
        chip.classList.toggle('ptv-theme-song-chip-enabled', nextEnabled);
        chip.classList.toggle('ptv-theme-song-chip-disabled', !nextEnabled);
        chip.setAttribute('aria-pressed', nextEnabled ? 'true' : 'false');
        chip.setAttribute('aria-label', nextEnabled ? 'Theme songs enabled' : 'Enable theme songs');

        const text = chip.querySelector('.ptv-theme-song-chip-text');
        if (text) {
            text.textContent = nextEnabled ? 'Theme Song' : 'Theme Songs Off';
        }
    });

    return chip;
}

function renderThemeSongChip(page, songs) {
    removeChip(page);

    if (!songs.length) return;

    const target = getTargetContainer(page);
    if (!target) return;

    target.append(createChip(songs.length));
    page.classList.add('ptv-has-theme-songs');
}

async function enhanceThemeSongs() {
    const page = document.querySelector(DETAIL_PAGE_SELECTOR);

    if (!page) return;

    const { serverId, id } = getCurrentParams();

    if (!id || !serverId) {
        removeChip(page);
        return;
    }

    const token = ++requestToken;

    try {
        const songs = await loadThemeSongs(serverId, id);

        if (token !== requestToken) return;

        renderThemeSongChip(page, songs);
    } catch (err) {
        console.warn('[PiggieTV] Theme song lookup failed', err);
        removeChip(page);
    }
}

function onViewShow(event) {
    currentParams = event.detail?.params || {};
    void enhanceThemeSongs();
}

function init({ scope } = {}) {
    scope?.listen(document, 'viewshow', onViewShow, true);
    void enhanceThemeSongs();
    stopWatchingDom = scope?.watchDom ? scope.watchDom(() => {
        void enhanceThemeSongs();
    }) : watchDom(() => {
        void enhanceThemeSongs();
    });
}

function refresh() {
    void enhanceThemeSongs();
}

function destroy() {
    stopWatchingDom?.();
    stopWatchingDom = null;
    currentParams = {};
    requestToken += 1;
}

registerModule({
    density: 'comfortable',
    features: ['details', 'theme-songs'],
    name: 'theme-songs',
    permissions: ['authenticated'],
    route: 'details',
    surface: 2,
    widgets: [
        {
            density: 'comfortable',
            id: 'theme-song-chip',
            surface: 2,
            type: 'detail-action'
        }
    ],
    init,
    refresh,
    destroy
});
