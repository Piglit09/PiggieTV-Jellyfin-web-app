import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';

import { ServerConnections } from '../../../lib/jellyfin-apiclient';
import { currentSettings as userSettings } from '../../../scripts/settings/userSettings';
import { toApi } from '../../../utils/jellyfin-apiclient/compat';
import { registerModule } from '../../core/lifecycle';
import { watchElement } from '../../core/observer';
import { createPtvAbortController } from '../../core/abortController';
import { ptvSafeConsole } from '../../core/safeConsole';

import './theme-songs.scss';

const DETAIL_PAGE_SELECTOR = '#itemDetailPage, .itemDetailPage';
const PRIMARY_TARGET_SELECTOR = '.mainDetailButtons';
const FALLBACK_TARGET_SELECTOR = '.detailRibbon';
const TARGET_DISCOVERY_SELECTOR = `${PRIMARY_TARGET_SELECTOR}, ${FALLBACK_TARGET_SELECTOR}`;
const CHIP_CLASS = 'ptv-theme-song-chip';
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 64;
const MUTATION_ENHANCE_DELAY = 16;

let active = false;
let activeEnhancement = null;
let activeRequest = null;
let cancelScheduledEnhancement = null;
let currentParams = {};
let currentScope = null;
let lifecycleGeneration = 0;
let observedPage = null;
let stopListeningViewShow = null;
let stopObservingPage = null;
let stopWatchingDetails = null;
const cache = new Map();
const inFlight = new Map();

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

function getThemeCacheKey(serverId, userId, itemId) {
    return JSON.stringify([serverId || 'default', userId || 'anonymous', itemId]);
}

function getCachedThemeSongs(key) {
    const cached = cache.get(key);

    if (!cached || Date.now() - cached.createdAt > CACHE_TTL) {
        cache.delete(key);
        return null;
    }

    cache.delete(key);
    cache.set(key, cached);

    return cached.items;
}

function setCachedThemeSongs(key, items) {
    cache.delete(key);
    cache.set(key, {
        createdAt: Date.now(),
        items
    });

    while (cache.size > CACHE_MAX_ENTRIES) {
        cache.delete(cache.keys().next().value);
    }
}

function createThemeIdentity(serverId, itemId) {
    const apiClient = ServerConnections.getApiClient(serverId);
    const userId = apiClient?.getCurrentUserId?.();

    if (!apiClient || !userId) {
        throw new Error('Theme song lookup requires an authenticated server connection.');
    }

    return {
        apiClient,
        itemId,
        key: getThemeCacheKey(serverId, userId, itemId),
        serverId,
        userId
    };
}

function loadThemeSongs(identity) {
    const cached = getCachedThemeSongs(identity.key);

    if (cached) return Promise.resolve(cached);

    const existingRequest = inFlight.get(identity.key);

    if (existingRequest) return existingRequest.promise;

    const controller = createPtvAbortController();
    const request = (async () => {
        const api = toApi(identity.apiClient);
        const { data } = await getLibraryApi(api).getThemeMedia({
            userId: identity.userId,
            itemId: identity.itemId,
            inheritFromParent: true,
            sortBy: [ItemSortBy.Random]
        }, {
            signal: controller.signal
        });
        if (controller.signal.aborted) return [];

        const songs = data?.ThemeSongsResult?.Items || [];

        setCachedThemeSongs(identity.key, songs);

        return songs;
    })();
    const entry = {
        controller,
        promise: request
    };
    const clearRequest = () => {
        if (inFlight.get(identity.key) === entry) {
            inFlight.delete(identity.key);
        }
        if (activeRequest === entry) {
            activeRequest = null;
        }
    };

    inFlight.set(identity.key, entry);
    activeRequest = entry;
    request.then(clearRequest, clearRequest);

    return request;
}

function removeChip(page) {
    page?.querySelector(`.${CHIP_CLASS}`)?.remove();
    page?.classList.remove('ptv-has-theme-songs');
}

function getTargetContainer(page) {
    return page.querySelector(PRIMARY_TARGET_SELECTOR)
        || page.querySelector(FALLBACK_TARGET_SELECTOR);
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

function isCurrentEnhancement(generation, page, identity) {
    if (!active || generation !== lifecycleGeneration || !page.isConnected) {
        return false;
    }

    if (document.querySelector(DETAIL_PAGE_SELECTOR) !== page) {
        return false;
    }

    const { serverId, id } = getCurrentParams();

    if (serverId !== identity.serverId || id !== identity.itemId) {
        return false;
    }

    try {
        return createThemeIdentity(serverId, id).key === identity.key;
    } catch {
        return false;
    }
}

function enhanceThemeSongs(generation = lifecycleGeneration) {
    if (!active || generation !== lifecycleGeneration) {
        return Promise.resolve();
    }

    const page = document.querySelector(DETAIL_PAGE_SELECTOR);

    if (!page) return Promise.resolve();

    const { serverId, id } = getCurrentParams();

    if (!id || !serverId) {
        removeChip(page);
        return Promise.resolve();
    }

    let identity;

    try {
        identity = createThemeIdentity(serverId, id);
    } catch (err) {
        ptvSafeConsole.warn('[PiggieTV] Theme song lookup failed', err);
        removeChip(page);

        return Promise.resolve();
    }

    if (
        activeEnhancement?.generation === generation
        && activeEnhancement.identityKey === identity.key
        && activeEnhancement.page === page
    ) {
        return activeEnhancement.promise;
    }

    const promise = (async () => {
        try {
            const songs = await loadThemeSongs(identity);

            if (!isCurrentEnhancement(generation, page, identity)) return;

            renderThemeSongChip(page, songs);
        } catch (err) {
            if (!isCurrentEnhancement(generation, page, identity)) return;

            ptvSafeConsole.warn('[PiggieTV] Theme song lookup failed', err);
            removeChip(page);
        }
    })();
    const enhancement = {
        generation,
        identityKey: identity.key,
        page,
        promise
    };
    const clearEnhancement = () => {
        if (activeEnhancement === enhancement) {
            activeEnhancement = null;
        }
    };

    activeEnhancement = enhancement;
    promise.then(clearEnhancement, clearEnhancement);

    return promise;
}

function cancelEnhancementSchedule() {
    cancelScheduledEnhancement?.();
    cancelScheduledEnhancement = null;
}

function retireActiveRequest() {
    if (!activeRequest) return;

    const request = activeRequest;

    activeRequest = null;
    request.controller.abort();
    inFlight.forEach((entry, key) => {
        if (entry === request) inFlight.delete(key);
    });
}

function scheduleEnhancement() {
    if (!active || cancelScheduledEnhancement) return;

    const generation = lifecycleGeneration;
    const run = () => {
        cancelScheduledEnhancement = null;

        if (!active || generation !== lifecycleGeneration) return;

        void enhanceThemeSongs(generation);
    };

    if (currentScope?.timeout) {
        cancelScheduledEnhancement = currentScope.timeout(run, MUTATION_ENHANCE_DELAY);
        return;
    }

    const timer = window.setTimeout(run, MUTATION_ENHANCE_DELAY);

    cancelScheduledEnhancement = () => window.clearTimeout(timer);
}

function beginGeneration() {
    lifecycleGeneration += 1;
    activeEnhancement = null;
    cancelEnhancementSchedule();
}

function mutationMayExposeTarget(mutation) {
    const target = mutation.target instanceof Element ?
        mutation.target :
        mutation.target?.parentElement;

    if (target?.closest(PRIMARY_TARGET_SELECTOR)) {
        return mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0;
    }

    const targetAdded = Array.from(mutation.addedNodes).some(node => (
        node instanceof Element
        && (
            node.matches(TARGET_DISCOVERY_SELECTOR)
            || Boolean(node.querySelector(TARGET_DISCOVERY_SELECTOR))
        )
    ));

    if (targetAdded) return true;

    if (!target?.closest(FALLBACK_TARGET_SELECTOR)) return false;

    return Array.from(mutation.removedNodes).some(node => (
        node instanceof Element
        && (
            node.matches(`.${CHIP_CLASS}`)
            || Boolean(node.querySelector(`.${CHIP_CLASS}`))
        )
    ));
}

function onPageMutations(mutations) {
    if (!active || !observedPage) return;

    const chip = observedPage.querySelector(`.${CHIP_CLASS}`);

    if (chip?.parentElement === getTargetContainer(observedPage)) return;

    if (mutations.some(mutationMayExposeTarget)) {
        scheduleEnhancement();
    }
}

function disconnectObservedPage() {
    stopObservingPage?.();
    stopObservingPage = null;
    observedPage = null;
}

function observeDetailsPage(page) {
    if (!active || page === observedPage) return;

    disconnectObservedPage();
    observedPage = page;

    if (currentScope?.mutationObserver) {
        stopObservingPage = currentScope.mutationObserver(onPageMutations, page, {
            childList: true,
            subtree: true
        });
    } else {
        const observer = new MutationObserver(onPageMutations);

        observer.observe(page, {
            childList: true,
            subtree: true
        });
        stopObservingPage = () => observer.disconnect();
    }

    scheduleEnhancement();
}

function onDetailsPageMissing() {
    retireActiveRequest();
    disconnectObservedPage();
}

function onViewShow(event) {
    if (!active) return;

    removeChip(document.querySelector(DETAIL_PAGE_SELECTOR));
    retireActiveRequest();
    currentParams = event.detail?.params || {};
    beginGeneration();
    scheduleEnhancement();
}

function init({ scope } = {}) {
    if (active) {
        destroy();
    }

    active = true;
    currentScope = scope || null;
    beginGeneration();
    stopListeningViewShow = scope?.listen?.(document, 'viewshow', onViewShow, true) || (() => {
        document.addEventListener('viewshow', onViewShow, true);

        return () => document.removeEventListener('viewshow', onViewShow, true);
    })();
    stopWatchingDetails = scope?.watchElement ?
        scope.watchElement(DETAIL_PAGE_SELECTOR, observeDetailsPage, {
            onMissing: onDetailsPageMissing
        }) :
        watchElement(DETAIL_PAGE_SELECTOR, observeDetailsPage, {
            onMissing: onDetailsPageMissing
        });

    const page = document.querySelector(DETAIL_PAGE_SELECTOR);

    if (page) {
        observeDetailsPage(page);
    } else {
        scheduleEnhancement();
    }
}

function refresh() {
    if (!active) return;

    beginGeneration();
    scheduleEnhancement();
}

function destroy() {
    const page = observedPage;

    active = false;
    retireActiveRequest();
    beginGeneration();
    stopListeningViewShow?.();
    stopListeningViewShow = null;
    stopWatchingDetails?.();
    stopWatchingDetails = null;
    disconnectObservedPage();
    removeChip(page);
    currentParams = {};
    currentScope = null;
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
