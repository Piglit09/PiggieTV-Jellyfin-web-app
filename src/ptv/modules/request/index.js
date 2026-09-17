import { dispatchPtvCustomEvent, on } from '../../core/events';
import { PTV_BRANDING, PTV_EVENTS, PTV_ROUTES, PTV_SERVICES, PTV_TIMERS } from '../../core/config';
import { registerModule } from '../../core/lifecycle';
import { resetRuntimeScope } from '../../core/scope';
import { getPtvRequestPortalUrl } from '../integrations/integrationsConfig';
import { isPtvRequestFeatureRoute } from '../extendedFeatureRoutes';

import './request.scss';

const REQUEST_ROUTE = PTV_ROUTES.request;
const REQUEST_FALLBACK_ROUTE = PTV_ROUTES.requestFallback;
const REQUEST_LEGACY_ROUTE = PTV_ROUTES.requestLegacy;
const REQUEST_SAFE_ROUTE = PTV_ROUTES.requestSafe;
const REQUEST_URL = PTV_SERVICES.requestPortalUrl;
const REQUEST_VIEW_SELECTOR = '[data-ptv-request-view="true"]';
const REQUEST_TRIGGER_SELECTOR = [
    '[data-ptv-request-trigger="true"]',
    '[data-ptv-nav-id="request"]',
    '.ptv-top-tab-request',
    `a[href="${REQUEST_ROUTE}"]`,
    `a[href="${REQUEST_FALLBACK_ROUTE}"]`,
    `a[href="${REQUEST_LEGACY_ROUTE}"]`,
    `a[href="${REQUEST_URL}"]`,
    'a[href*="request.piggietv.com"]'
].join(',');
const REQUEST_LOAD_TIMEOUT = PTV_TIMERS.requestLoadTimeoutMs;
const REQUEST_OPEN_EVENT = PTV_EVENTS.requestOpen;
const REQUEST_CLOSE_EVENT = PTV_EVENTS.requestClose;
const REQUEST_STATE_EVENT = PTV_EVENTS.requestStateChange;

let requestViewScheduled = false;
let requestLoadTimer = null;
let lastSafeUrl = '';
let lastRequestOpenAt = 0;
let resolvedRequestUrl = REQUEST_URL;
let pendingRequestQuery = '';

function normalizeRequestTriggers() {
    document.querySelectorAll(REQUEST_TRIGGER_SELECTOR).forEach((trigger) => {
        if (trigger.closest?.('[data-ptv-request-external="true"]')) return;

        trigger.dataset.ptvRequestTrigger = 'true';

        if (trigger instanceof HTMLAnchorElement) {
            trigger.setAttribute('href', REQUEST_ROUTE);
            trigger.removeAttribute('target');
            trigger.removeAttribute('rel');
            trigger.removeAttribute('data-ptv-external');
        }

        if (trigger.dataset.ptvRequestBound === 'true') return;

        trigger.dataset.ptvRequestBound = 'true';
        trigger.addEventListener('pointerdown', handleRequestActivation, true);
        trigger.addEventListener('click', handleRequestActivation, true);
        trigger.addEventListener('keydown', handleRequestActivation, true);
    });
}

function isRequestRoute() {
    return isPtvRequestFeatureRoute(window.location.hash || '');
}

function getCurrentUrl() {
    return `${window.location.pathname}${window.location.search}${window.location.hash || ''}`;
}

function getFallbackSafeUrl() {
    return `${window.location.pathname}${window.location.search}${REQUEST_SAFE_ROUTE}`;
}

function getRequestRouteUrl() {
    return `${window.location.pathname}${window.location.search}${REQUEST_ROUTE}`;
}

function rememberSafeRoute() {
    if (isRequestRoute()) return;

    lastSafeUrl = getCurrentUrl();
}

function getRequestView() {
    const views = Array.from(document.querySelectorAll(REQUEST_VIEW_SELECTOR));
    const [view, ...extraViews] = views;

    extraViews.forEach(extraView => {
        extraView.remove();
    });

    return view;
}

function setRequestState(view, state) {
    view.dataset.ptvRequestState = state;

    const loading = view.querySelector('.ptv-request-loading');
    const fallback = view.querySelector('.ptv-request-fallback');

    if (loading instanceof HTMLElement) {
        loading.hidden = state !== 'loading';
    }

    if (fallback instanceof HTMLElement) {
        fallback.hidden = state !== 'fallback';
    }
}

function clearRequestTimer() {
    if (!requestLoadTimer) return;

    window.clearTimeout(requestLoadTimer);
    requestLoadTimer = null;
}

function showRequestFallback(view) {
    clearRequestTimer();
    setRequestState(view, 'fallback');
}

function syncRequestNavigationState(isActive) {
    const wasActive = document.documentElement.classList.contains('ptv-request-active');

    document.documentElement.classList.toggle('ptv-request-active', isActive);
    document.body.classList.toggle('ptv-request-active', isActive);

    document
        .querySelectorAll('.ptv-top-tab-request, [data-ptv-nav-id="request"]')
        .forEach((element) => {
            element.classList.toggle('emby-tab-button-active', isActive);
            element.classList.toggle('ptv-nav-link-active', isActive);
            element.classList.toggle('ptv-sidebar-item-active', isActive);
            element.classList.toggle('ptv-request-tab-active', isActive);
            element.setAttribute('aria-selected', String(isActive));
        });

    if (wasActive === isActive) return;

    dispatchPtvCustomEvent(REQUEST_STATE_EVENT, { isActive });
}

function getCurrentRequestUrl() {
    return resolvedRequestUrl || REQUEST_URL;
}

function withSearchParam(url, key, value) {
    const hashIndex = url.indexOf('#');
    const urlWithoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
    const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
    const queryIndex = urlWithoutHash.indexOf('?');
    const base = queryIndex === -1 ? urlWithoutHash : urlWithoutHash.slice(0, queryIndex);
    const query = queryIndex === -1 ? '' : urlWithoutHash.slice(queryIndex + 1);
    const encodedKey = encodeURIComponent(key);
    const params = query.split('&').filter((param) => {
        const [paramKey] = param.split('=');

        return param && paramKey !== encodedKey;
    });

    params.push(`${encodedKey}=${encodeURIComponent(value)}`);

    return `${base}?${params.join('&')}${hash}`;
}

function applyQueryToRequestUrl(url, query) {
    if (!query) return url;

    return withSearchParam(url, 'search', query);
}

function getFrameRequestUrl() {
    return applyQueryToRequestUrl(getCurrentRequestUrl(), pendingRequestQuery);
}

function updateRequestLinks(view = getRequestView()) {
    const url = getFrameRequestUrl();

    document.querySelectorAll('[data-ptv-request-external="true"]').forEach((link) => {
        if (link instanceof HTMLAnchorElement) {
            link.href = url;
        }
    });

    const frame = view?.querySelector?.('.ptv-request-frame');

    if (frame instanceof HTMLIFrameElement && frame.src !== url) {
        setRequestState(view, 'loading');
        frame.src = url;
    }
}

function resolveRequestUrl(view) {
    getPtvRequestPortalUrl()
        .then((url) => {
            resolvedRequestUrl = url || REQUEST_URL;
            updateRequestLinks(view);
        })
        .catch(() => {
            resolvedRequestUrl = REQUEST_URL;
            updateRequestLinks(view);
        });
}

function openExternalRequestPortal(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();

    window.location.href = getFrameRequestUrl();
}

function createFallbackLink(className) {
    const link = document.createElement('a');

    link.className = className;
    link.dataset.ptvRequestExternal = 'true';
    link.href = getFrameRequestUrl();
    link.textContent = 'Open Request Portal';
    link.addEventListener('click', openExternalRequestPortal, true);

    return link;
}

function closeRequestView(options = {}) {
    const shouldUseHistory = options.useHistory !== false;

    if (shouldUseHistory && window.history.state?.ptvRequestActive) {
        window.history.back();
        return;
    }

    clearRequestTimer();
    getRequestView()?.remove();
    pendingRequestQuery = '';
    syncRequestNavigationState(false);

    if (!shouldUseHistory && window.history.state?.ptvRequestActive) {
        const nextState = { ...window.history.state };

        delete nextState.ptvRequestActive;

        window.history.replaceState(nextState, '', getCurrentUrl());
    }

    if (shouldUseHistory && isRequestRoute()) {
        window.history.replaceState(getCleanRequestState(), '', lastSafeUrl || getFallbackSafeUrl());
    }
}

function getCleanRequestState() {
    const state = { ...(window.history.state || {}) };

    delete state.ptvRequestActive;

    return state;
}

function createRequestView() {
    const view = document.createElement('section');
    const header = document.createElement('div');
    const title = document.createElement('h1');
    const actions = document.createElement('div');
    const closeButton = document.createElement('button');
    const frameShell = document.createElement('div');
    const loading = document.createElement('div');
    const fallback = document.createElement('div');
    const fallbackTitle = document.createElement('h2');
    const fallbackText = document.createElement('p');
    const iframe = document.createElement('iframe');

    view.className = 'ptv-request-page';
    view.dataset.ptvRequestView = 'true';
    view.dataset.ptvRequestState = 'loading';
    view.setAttribute('aria-label', 'Request Portal');

    header.className = 'ptv-request-header';
    title.className = 'ptv-request-title';
    title.textContent = 'Request';
    actions.className = 'ptv-request-actions';
    closeButton.type = 'button';
    closeButton.className = 'ptv-request-close ptv-button ptv-button-ghost';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', () => {
        closeRequestView();
    });
    actions.append(createFallbackLink('ptv-request-open-link ptv-button ptv-button-ghost'), closeButton);
    header.append(title, actions);

    frameShell.className = 'ptv-request-frame-shell';

    loading.className = 'ptv-request-state ptv-request-loading';
    loading.textContent = 'Loading request portal...';

    fallback.className = 'ptv-request-state ptv-request-fallback';
    fallback.hidden = true;
    fallbackTitle.textContent = 'Request portal could not be embedded';
    fallbackText.textContent = 'Your browser or the request portal may be blocking embedded access.';
    fallback.append(fallbackTitle, fallbackText, createFallbackLink('ptv-request-fallback-link ptv-button ptv-button-primary'));

    iframe.className = 'ptv-request-frame';
    iframe.src = getFrameRequestUrl();
    iframe.title = PTV_BRANDING.requestPortalTitle;
    iframe.loading = 'eager';
    iframe.referrerPolicy = 'no-referrer-when-downgrade';
    iframe.sandbox = 'allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts';
    iframe.allow = 'fullscreen; clipboard-write';

    iframe.addEventListener('load', () => {
        clearRequestTimer();
        setRequestState(view, 'loaded');
    });

    iframe.addEventListener('error', () => {
        showRequestFallback(view);
    });

    frameShell.append(loading, fallback, iframe);
    view.append(header, frameShell);

    requestLoadTimer = window.setTimeout(() => {
        if (view.dataset.ptvRequestState === 'loading') {
            showRequestFallback(view);
        }
    }, REQUEST_LOAD_TIMEOUT);

    resolveRequestUrl(view);

    return view;
}

function openRequestView(options = {}) {
    lastRequestOpenAt = Date.now();
    pendingRequestQuery = typeof options.query === 'string' ? options.query : pendingRequestQuery;
    syncRequestNavigationState(true);

    if (options.pushHistory !== false && !window.history.state?.ptvRequestActive) {
        window.history.pushState({
            ...(window.history.state || {}),
            ptvRequestActive: true
        }, '', getRequestRouteUrl());
    }

    const existingView = getRequestView();

    if (existingView) {
        updateRequestLinks(existingView);
        resolveRequestUrl(existingView);
        return;
    }

    document.body.append(createRequestView());
}

export function openRequestPortal(options) {
    openRequestView(options);
}

export function closeRequestPortal(options) {
    closeRequestView(options);
}

function registerRequestApi() {
    window.PTV = window.PTV || {};
    window.PTV.openRequestPortal = openRequestPortal;
    window.PTV.closeRequestPortal = closeRequestPortal;
}

function ensureRequestView() {
    if (isRequestRoute()) {
        openRequestView({
            pushHistory: false
        });
        return;
    }

    rememberSafeRoute();

    if (getRequestView() && window.history.state?.ptvRequestActive) {
        syncRequestNavigationState(true);
        return;
    }

    if (getRequestView() && !window.history.state?.ptvRequestActive) {
        closeRequestView({
            useHistory: false
        });
    }
}

function scheduleRequestView() {
    if (requestViewScheduled) return;

    requestViewScheduled = true;

    window.requestAnimationFrame(() => {
        requestViewScheduled = false;
        normalizeRequestTriggers();
        ensureRequestView();
    });
}

function handleRequestActivation(event) {
    const trigger = event.target?.closest?.(REQUEST_TRIGGER_SELECTOR);

    if (!trigger || trigger.closest?.('[data-ptv-request-external="true"]')) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    if (typeof event.button === 'number' && event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    if (isDuplicateRequestActivation()) return;

    openRequestView();
}

function isDuplicateRequestActivation() {
    return Date.now() - lastRequestOpenAt < 450;
}

function handleRequestPopState() {
    if (window.history.state?.ptvRequestActive) return;

    if (getRequestView()) {
        closeRequestView({
            useHistory: false
        });
    }

    scheduleRequestView();
}

const requestScope = resetRuntimeScope('request-listeners');

requestScope.watchDom(scheduleRequestView);
requestScope.listen(document, 'pointerdown', handleRequestActivation, true);
requestScope.listen(document, 'click', handleRequestActivation, true);
requestScope.listen(document, 'keydown', handleRequestActivation, true);
requestScope.listen(window, REQUEST_OPEN_EVENT, (event) => openRequestView(event.detail || {}));
requestScope.listen(window, REQUEST_CLOSE_EVENT, (event) => closeRequestView(event.detail || {}));
requestScope.listen(window, 'hashchange', scheduleRequestView);
requestScope.listen(window, 'popstate', handleRequestPopState);
requestScope.add(on('routechange', scheduleRequestView));

registerModule({
    density: 'comfortable',
    features: ['request'],
    layout: 'embedded',
    name: 'request',
    route: {
        density: 'comfortable',
        id: 'request',
        layout: 'embedded',
        navigationItemId: 'request',
        owner: 'request',
        pageType: 'request',
        pattern: ({ hash }) => isPtvRequestFeatureRoute(hash),
        surface: 1
    },
    surface: 1,
    widgets: [
        {
            density: 'comfortable',
            id: 'request-iframe',
            surface: 1,
            type: 'embedded-app'
        }
    ]
});

registerRequestApi();
scheduleRequestView();
