import { dispatchPtvCustomEvent, on } from '../../core/events';
import { PTV_BRANDING, PTV_EVENTS, PTV_ROUTES, PTV_SERVICES, PTV_TIMERS } from '../../core/config';
import { registerModule } from '../../core/lifecycle';
import { resetRuntimeScope } from '../../core/scope';

import './signup.scss';

const SIGNUP_ROUTE = PTV_ROUTES.signup;
const SIGNUP_FALLBACK_ROUTE = PTV_ROUTES.signupFallback;
const SIGNUP_URL = PTV_SERVICES.signUpUrl;
const SIGNUP_VIEW_SELECTOR = '[data-ptv-signup-view="true"]';
const SIGNUP_TRIGGER_SELECTOR = [
    '[data-ptv-signup-trigger="true"]',
    '.ptv-signup-trigger',
    `a[href="${SIGNUP_ROUTE}"]`,
    `a[href="${SIGNUP_URL}"]`,
    'a[href*="signup.piggietv.com/invite"]'
].join(',');
const SIGNUP_LOAD_TIMEOUT = PTV_TIMERS.requestLoadTimeoutMs;
const SIGNUP_OPEN_EVENT = PTV_EVENTS.signupOpen;
const SIGNUP_CLOSE_EVENT = PTV_EVENTS.signupClose;
const SIGNUP_STATE_EVENT = PTV_EVENTS.signupStateChange;

let signupViewScheduled = false;
let signupLoadTimer = null;
let lastSafeUrl = '';
let lastSignupOpenAt = 0;

function getCurrentUrl() {
    return `${window.location.pathname}${window.location.search}${window.location.hash || ''}`;
}

function getFallbackSafeUrl() {
    return `${window.location.pathname}${window.location.search}${SIGNUP_FALLBACK_ROUTE}`;
}

function isSignupRoute() {
    return (window.location.hash || '') === SIGNUP_ROUTE;
}

function rememberSafeRoute() {
    if (isSignupRoute()) return;

    lastSafeUrl = getCurrentUrl();
}

function clearSignupTimer() {
    if (!signupLoadTimer) return;

    window.clearTimeout(signupLoadTimer);
    signupLoadTimer = null;
}

function getSignupView() {
    const views = Array.from(document.querySelectorAll(SIGNUP_VIEW_SELECTOR));
    const [view, ...extraViews] = views;

    extraViews.forEach(extraView => {
        extraView.remove();
    });

    return view;
}

function setSignupState(view, state) {
    view.dataset.ptvSignupState = state;

    const loading = view.querySelector('.ptv-signup-loading');
    const fallback = view.querySelector('.ptv-signup-fallback');

    if (loading instanceof HTMLElement) {
        loading.hidden = state !== 'loading';
    }

    if (fallback instanceof HTMLElement) {
        fallback.hidden = state !== 'fallback';
    }
}

function showSignupFallback(view) {
    clearSignupTimer();
    setSignupState(view, 'fallback');
}

function syncSignupState(isActive) {
    const wasActive = document.documentElement.classList.contains('ptv-signup-active');

    document.documentElement.classList.toggle('ptv-signup-active', isActive);
    document.body.classList.toggle('ptv-signup-active', isActive);

    if (wasActive === isActive) return;

    dispatchPtvCustomEvent(SIGNUP_STATE_EVENT, { isActive });
}

function openExternalSignupPortal(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();

    const externalWindow = window.open(SIGNUP_URL, '_blank', 'noopener,noreferrer');

    if (externalWindow) {
        externalWindow.opener = null;
    }
}

function createExternalLink(className, label = 'Open Sign Up Portal') {
    const link = document.createElement('a');

    link.className = className;
    link.dataset.ptvSignupExternal = 'true';
    link.href = SIGNUP_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    link.addEventListener('click', openExternalSignupPortal, true);

    return link;
}

function closeSignupView(options = {}) {
    const shouldUseHistory = options.useHistory !== false;

    if (shouldUseHistory && isSignupRoute()) {
        if (lastSafeUrl) {
            window.history.back();
        } else {
            window.history.replaceState(window.history.state, '', getFallbackSafeUrl());
            closeSignupView({
                useHistory: false
            });
        }

        return;
    }

    clearSignupTimer();
    getSignupView()?.remove();
    syncSignupState(false);
}

function createSignupView() {
    const view = document.createElement('section');
    const shell = document.createElement('div');
    const header = document.createElement('div');
    const title = document.createElement('h1');
    const subtitle = document.createElement('p');
    const actions = document.createElement('div');
    const closeButton = document.createElement('button');
    const frameShell = document.createElement('div');
    const loading = document.createElement('div');
    const fallback = document.createElement('div');
    const fallbackTitle = document.createElement('h2');
    const fallbackText = document.createElement('p');
    const iframe = document.createElement('iframe');

    view.className = 'ptv-signup-page';
    view.dataset.ptvSignupView = 'true';
    view.dataset.ptvSignupState = 'loading';
    view.setAttribute('aria-label', 'PiggieTV signup');

    shell.className = 'ptv-signup-shell';
    header.className = 'ptv-signup-header';

    title.className = 'ptv-signup-title';
    title.textContent = 'Join PiggieTV';
    subtitle.className = 'ptv-signup-subtitle';
    subtitle.textContent = 'Create your account through the PiggieTV invite portal.';

    actions.className = 'ptv-signup-actions';
    closeButton.type = 'button';
    closeButton.className = 'ptv-signup-close ptv-button ptv-button-ghost';
    closeButton.textContent = 'Back';
    closeButton.addEventListener('click', () => closeSignupView());
    actions.append(createExternalLink('ptv-signup-open-link ptv-button ptv-button-ghost'), closeButton);

    header.append(title, subtitle, actions);

    frameShell.className = 'ptv-signup-frame-shell';

    loading.className = 'ptv-signup-state ptv-signup-loading';
    loading.textContent = 'Loading signup portal...';

    fallback.className = 'ptv-signup-state ptv-signup-fallback';
    fallback.hidden = true;
    fallbackTitle.textContent = 'Signup portal could not be embedded';
    fallbackText.textContent = 'Your browser or the signup service may be blocking embedded access.';
    fallback.append(fallbackTitle, fallbackText, createExternalLink('ptv-signup-fallback-link ptv-button ptv-button-primary'));

    iframe.className = 'ptv-signup-frame';
    iframe.src = SIGNUP_URL;
    iframe.title = PTV_BRANDING.signupPortalTitle;
    iframe.loading = 'eager';
    iframe.referrerPolicy = 'no-referrer-when-downgrade';
    iframe.sandbox = 'allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts';
    iframe.allow = 'fullscreen; clipboard-write';
    iframe.addEventListener('load', () => {
        clearSignupTimer();
        setSignupState(view, 'loaded');
    });
    iframe.addEventListener('error', () => {
        showSignupFallback(view);
    });

    frameShell.append(loading, fallback, iframe);
    shell.append(header, frameShell);
    view.append(shell);

    signupLoadTimer = window.setTimeout(() => {
        if (view.dataset.ptvSignupState === 'loading') {
            showSignupFallback(view);
        }
    }, SIGNUP_LOAD_TIMEOUT);

    return view;
}

function openSignupView(options = {}) {
    lastSignupOpenAt = Date.now();
    syncSignupState(true);

    if (options.pushRoute !== false && !isSignupRoute()) {
        window.history.pushState({
            ...(window.history.state || {}),
            ptvSignupActive: true
        }, '', `${window.location.pathname}${window.location.search}${SIGNUP_ROUTE}`);
    }

    if (getSignupView()) return;

    document.body.append(createSignupView());
}

export function openSignupPortal(options) {
    openSignupView(options);
}

export function closeSignupPortal(options) {
    closeSignupView(options);
}

function normalizeSignupTriggers() {
    document.querySelectorAll(SIGNUP_TRIGGER_SELECTOR).forEach((trigger) => {
        if (trigger.closest?.('[data-ptv-signup-external="true"]')) return;

        trigger.dataset.ptvSignupTrigger = 'true';

        if (trigger instanceof HTMLAnchorElement) {
            trigger.setAttribute('href', SIGNUP_ROUTE);
            trigger.removeAttribute('target');
            trigger.removeAttribute('rel');
        }

        if (trigger.dataset.ptvSignupBound === 'true') return;

        trigger.dataset.ptvSignupBound = 'true';
        trigger.addEventListener('pointerdown', handleSignupActivation, true);
        trigger.addEventListener('click', handleSignupActivation, true);
        trigger.addEventListener('keydown', handleSignupActivation, true);
    });
}

function ensureSignupView() {
    if (isSignupRoute()) {
        openSignupView({
            pushRoute: false
        });
        return;
    }

    rememberSafeRoute();

    if (getSignupView()) {
        closeSignupView({
            useHistory: false
        });
    }
}

function scheduleSignupView() {
    if (signupViewScheduled) return;

    signupViewScheduled = true;

    window.requestAnimationFrame(() => {
        signupViewScheduled = false;
        normalizeSignupTriggers();
        ensureSignupView();
    });
}

function handleSignupActivation(event) {
    const trigger = event.target?.closest?.(SIGNUP_TRIGGER_SELECTOR);

    if (!trigger || trigger.closest?.('[data-ptv-signup-external="true"]')) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    if (typeof event.button === 'number' && event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    if (Date.now() - lastSignupOpenAt < 450) return;

    rememberSafeRoute();
    openSignupView();
}

function handleSignupPopState() {
    if (isSignupRoute()) {
        scheduleSignupView();
        return;
    }

    if (getSignupView()) {
        closeSignupView({
            useHistory: false
        });
    }
}

function registerSignupApi() {
    window.PTV = window.PTV || {};
    window.PTV.openSignupPortal = openSignupPortal;
    window.PTV.closeSignupPortal = closeSignupPortal;
}

const signupScope = resetRuntimeScope('signup-listeners');

signupScope.watchDom(scheduleSignupView);
signupScope.listen(document, 'pointerdown', handleSignupActivation, true);
signupScope.listen(document, 'click', handleSignupActivation, true);
signupScope.listen(document, 'keydown', handleSignupActivation, true);
signupScope.listen(window, SIGNUP_OPEN_EVENT, () => openSignupView());
signupScope.listen(window, SIGNUP_CLOSE_EVENT, () => closeSignupView());
signupScope.listen(window, 'hashchange', scheduleSignupView);
signupScope.listen(window, 'popstate', handleSignupPopState);
signupScope.add(on('routechange', scheduleSignupView));

registerModule({
    density: 'comfortable',
    features: ['auth', 'signup'],
    layout: 'auth',
    name: 'signup',
    permissions: ['guest'],
    route: {
        density: 'comfortable',
        id: 'signup',
        layout: 'auth',
        owner: 'signup',
        pageType: 'signup',
        pattern: () => document.documentElement.classList.contains('ptv-signup-active') || isSignupRoute(),
        surface: 1
    },
    surface: 1,
    widgets: [
        {
            density: 'comfortable',
            id: 'signup-iframe',
            surface: 1,
            type: 'embedded-app'
        }
    ]
});

registerSignupApi();
scheduleSignupView();
