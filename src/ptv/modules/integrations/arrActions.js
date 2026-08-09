import { ServerConnections } from '../../../lib/jellyfin-apiclient';
import { registerModule } from '../../core/lifecycle';
import { resetRuntimeScope } from '../../core/scope';
import { getCoordinatedLegacyItemDetail } from '../../services/coordinatedLegacyItemDetail';
import { openPtvRequestPortal } from '../request/requestLoader';
import { getPtvIntegrationActions } from './arrLinks';
import { getPtvIntegrationSettings } from './integrationsConfig';

import './integrations.scss';

const DETAIL_PAGE_SELECTOR = '#itemDetailPage, .itemDetailPage';
const ACTION_CLASS = 'ptv-integration-action';
const ACTION_GROUP_CLASS = 'ptv-integration-actions';
const CACHE_TTL_MS = 2 * 60 * 1000;
const REQUEST_EXCLUDED_DETAIL_TYPES = new Set(['movie', 'series']);

let currentParams = {};
let requestToken = 0;
const itemCache = new Map();

function readParamsFromHash() {
    const hash = window.location.hash || '';
    const queryIndex = hash.indexOf('?');

    if (queryIndex === -1) return {};

    return hash.slice(queryIndex + 1).split('&').reduce((result, part) => {
        const splitIndex = part.indexOf('=');
        const key = splitIndex === -1 ? part : part.slice(0, splitIndex);
        const value = splitIndex === -1 ? '' : part.slice(splitIndex + 1);

        if (key) {
            result[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
        }

        return result;
    }, {});
}

function getCurrentParams() {
    const hashParams = readParamsFromHash();

    return {
        id: currentParams.id || currentParams.itemId || hashParams.id || hashParams.itemId,
        serverId: currentParams.serverId || hashParams.serverId
    };
}

function getApiClient(serverId) {
    if (serverId) {
        return ServerConnections.getApiClient(serverId);
    }

    return ServerConnections.currentApiClient?.() || null;
}

function getCacheKey(serverId, userId, itemId) {
    return `${serverId || 'default'}:${userId}:${itemId}`;
}

async function loadItem(serverId, itemId) {
    const apiClient = getApiClient(serverId);
    const userId = apiClient?.getCurrentUserId?.();

    if (!apiClient || !userId || !itemId) return null;

    const cacheKey = getCacheKey(serverId, userId, itemId);
    const cached = itemCache.get(cacheKey);

    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
        return cached.item;
    }

    const item = await getCoordinatedLegacyItemDetail(apiClient, itemId).catch(() => null);

    if (getApiClient(serverId)?.getCurrentUserId?.() !== userId) return null;

    if (item) {
        itemCache.set(cacheKey, {
            createdAt: Date.now(),
            item
        });
    }

    return item;
}

function getTargetContainer(page) {
    return page.querySelector('.mainDetailButtons') || page.querySelector('.detailRibbon');
}

function getOrCreateGroup(target) {
    const existing = target.querySelector(`.${ACTION_GROUP_CLASS}`);

    if (existing) return existing;

    const group = document.createElement('div');

    group.className = ACTION_GROUP_CLASS;
    group.dataset.ptvEnhanced = 'true';
    target.append(group);

    return group;
}

function clearActions(page) {
    page?.querySelector(`.${ACTION_GROUP_CLASS}`)?.remove();
}

function getRequestQuery(item) {
    return [
        item?.SeriesName || item?.Name,
        item?.ProductionYear
    ].filter(Boolean).join(' ');
}

export function createRequestButton(item) {
    const button = document.createElement('button');
    const icon = document.createElement('span');
    const label = document.createElement('span');

    button.type = 'button';
    button.className = `${ACTION_CLASS} ptv-integration-action-request`;
    icon.className = 'ptv-integration-action-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '+';
    label.textContent = 'Request';
    button.append(icon, label);
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void openPtvRequestPortal({
            query: getRequestQuery(item)
        });
    });

    return button;
}

function createManagerLink(action) {
    const link = document.createElement('a');
    const icon = document.createElement('span');
    const label = document.createElement('span');

    link.className = `${ACTION_CLASS} ptv-integration-action-${action.service}`;
    link.href = action.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    icon.className = 'ptv-integration-action-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '>';
    label.textContent = action.label;
    link.append(icon, label);

    return link;
}

export function shouldShowRequest(settings, item) {
    const itemType = String(item?.Type || '').trim().toLowerCase();

    return settings.seerr.enabled
        && settings.seerr.enableRequestsPage
        && !REQUEST_EXCLUDED_DETAIL_TYPES.has(itemType);
}

function renderActions(page, item, settings) {
    const target = getTargetContainer(page);

    if (!target || !item) return;

    const actions = getPtvIntegrationActions(item, settings);
    const showRequest = shouldShowRequest(settings, item);
    const actionKey = [
        item.Id || item.Name || '',
        showRequest ? 'request' : '',
        ...actions.map(action => `${action.id}:${action.href}`)
    ].join('|');

    if (page.dataset.ptvIntegrationActionsKey === actionKey && page.querySelector(`.${ACTION_GROUP_CLASS}`)) {
        return;
    }

    page.dataset.ptvIntegrationActionsKey = actionKey;
    clearActions(page);

    if (!showRequest && !actions.length) return;

    const group = getOrCreateGroup(target);

    if (showRequest) {
        group.append(createRequestButton(item));
    }

    actions.forEach(action => {
        group.append(createManagerLink(action));
    });
}

async function enhanceDetailIntegrations() {
    const page = document.querySelector(DETAIL_PAGE_SELECTOR);

    if (!page) return;

    const { serverId, id } = getCurrentParams();

    if (!id) {
        clearActions(page);
        return;
    }

    const token = ++requestToken;
    const [item, settings] = await Promise.all([
        loadItem(serverId, id),
        getPtvIntegrationSettings()
    ]);

    if (token !== requestToken || !page.isConnected) return;

    renderActions(page, item, settings);
}

function onViewShow(event) {
    currentParams = event.detail?.params || {};
    void enhanceDetailIntegrations();
}

function init({ scope } = {}) {
    scope?.listen(document, 'viewshow', onViewShow, true);
    scope?.watchDom(() => {
        void enhanceDetailIntegrations();
    });
    void enhanceDetailIntegrations();
}

function refresh() {
    void enhanceDetailIntegrations();
}

function destroy() {
    requestToken += 1;
    currentParams = {};
    itemCache.clear();
    document.querySelectorAll(`.${ACTION_GROUP_CLASS}`).forEach((group) => {
        group.remove();
    });
}

resetRuntimeScope('integrations-actions');

registerModule({
    density: 'comfortable',
    features: ['details', 'integrations'],
    name: 'integrations-actions',
    permissions: ['authenticated'],
    route: 'details',
    surface: 2,
    widgets: [
        {
            density: 'comfortable',
            id: 'integration-actions',
            surface: 2,
            type: 'detail-action'
        }
    ],
    init,
    refresh,
    destroy
});
