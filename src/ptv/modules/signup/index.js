import { dispatchPtvCustomEvent, on } from '../../core/events';
import { PTV_EVENTS, PTV_ROUTES, PTV_SERVICES } from '../../core/config';
import { registerModule } from '../../core/lifecycle';
import { resetRuntimeScope } from '../../core/scope';

import './signup.scss';

const SIGNUP_ROUTE = PTV_ROUTES.signup;
const SIGNUP_FALLBACK_ROUTE = PTV_ROUTES.signupFallback;
const SIGNUP_TRIGGER_SELECTOR = [
    '[data-ptv-signup-trigger="true"]',
    '.ptv-signup-trigger',
    `a[href="${SIGNUP_ROUTE}"]`,
    `a[href="${PTV_SERVICES.signUpUrl}"]`,
    'a[href*="signup.piggietv.com/invite"]'
].join(',');
const SIGNUP_OPEN_EVENT = PTV_EVENTS.signupOpen;
const SIGNUP_CLOSE_EVENT = PTV_EVENTS.signupClose;
const SIGNUP_STATE_EVENT = PTV_EVENTS.signupStateChange;

let signupViewScheduled = false;
let lastSignupOpenAt = 0;

function isSignupRoute(hash = window.location.hash || '') {
    const normalizedHash = hash.toLowerCase();

    return normalizedHash === SIGNUP_ROUTE
        || normalizedHash.startsWith(`${SIGNUP_ROUTE}?`)
        || normalizedHash === '#/ptv/signup'
        || normalizedHash.startsWith('#/ptv/signup?');
}

function getInviteCodeFromHref(href) {
    if (!href) return '';

    try {
        const url = new URL(href, window.location.href);
        const inviteParam = url.searchParams.get('invite');

        if (inviteParam) return inviteParam;

        const segments = url.pathname.split('/').filter(Boolean);
        const inviteIndex = segments.findIndex(segment => segment.toLowerCase() === 'invite');

        if (inviteIndex !== -1 && segments[inviteIndex + 1]) {
            return decodeURIComponent(segments[inviteIndex + 1]);
        }
    } catch {
        return '';
    }

    return '';
}

function getSignupModeFromHref(href) {
    if (!href) return '';

    try {
        const url = new URL(href, window.location.href);

        return url.searchParams.get('mode') || '';
    } catch {
        return '';
    }
}

function getSignupRoute(inviteCode = '', mode = '') {
    const params = new URLSearchParams();

    if (inviteCode) {
        params.set('invite', inviteCode);
    }

    if (mode) {
        params.set('mode', mode);
    }

    const query = params.toString();

    return query ? `${SIGNUP_ROUTE}?${query}` : SIGNUP_ROUTE;
}

function syncSignupState() {
    const isActive = isSignupRoute();
    const wasActive = document.documentElement.classList.contains('ptv-signup-active');

    document.documentElement.classList.toggle('ptv-signup-active', isActive);
    document.body.classList.toggle('ptv-signup-active', isActive);

    if (wasActive !== isActive) {
        dispatchPtvCustomEvent(SIGNUP_STATE_EVENT, { isActive });
    }
}

function openSignupView(options = {}) {
    lastSignupOpenAt = Date.now();

    const route = getSignupRoute(options.inviteCode || '', options.mode || '');

    if (!isSignupRoute() || window.location.hash !== route) {
        window.location.hash = route.slice(1);
    }

    syncSignupState();
}

function closeSignupView() {
    if (isSignupRoute()) {
        window.location.hash = SIGNUP_FALLBACK_ROUTE.slice(1);
    }

    syncSignupState();
}

export function openSignupPortal(options) {
    openSignupView(options);
}

export function closeSignupPortal() {
    closeSignupView();
}

function normalizeSignupTriggers() {
    document.querySelectorAll(SIGNUP_TRIGGER_SELECTOR).forEach((trigger) => {
        trigger.dataset.ptvSignupTrigger = 'true';

        if (trigger instanceof HTMLAnchorElement) {
            const inviteCode = getInviteCodeFromHref(trigger.href);
            const mode = getSignupModeFromHref(trigger.href);

            trigger.setAttribute('href', getSignupRoute(inviteCode, mode));
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

function scheduleSignupView() {
    if (signupViewScheduled) return;

    signupViewScheduled = true;

    window.requestAnimationFrame(() => {
        signupViewScheduled = false;
        normalizeSignupTriggers();
        syncSignupState();
    });
}

function handleSignupActivation(event) {
    const trigger = event.target?.closest?.(SIGNUP_TRIGGER_SELECTOR);

    if (!trigger) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    if (typeof event.button === 'number' && event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    if (Date.now() - lastSignupOpenAt < 450) return;

    openSignupView({
        inviteCode: trigger instanceof HTMLAnchorElement ? getInviteCodeFromHref(trigger.href) : '',
        mode: trigger instanceof HTMLAnchorElement ? getSignupModeFromHref(trigger.href) : ''
    });
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
signupScope.listen(window, 'popstate', scheduleSignupView);
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
        pattern: () => isSignupRoute(),
        surface: 1
    },
    surface: 1,
    widgets: [
        {
            density: 'comfortable',
            id: 'signup-native',
            surface: 1,
            type: 'native-page'
        }
    ]
});

registerSignupApi();
scheduleSignupView();
