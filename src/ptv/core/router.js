import { emit, on } from './events';
import { recordPtvEvent, recordPtvTiming } from './observability';
import { registerPtvRuntimeListener } from './runtime';
import { schedule } from './scheduler';
import { resetRuntimeScope } from './scope';
import { getPtvRouteClassNames, getPtvRouteOwnership } from '../shell/routes';

const browserHistory = window.history;

let currentPath = '';
let patchedHistory = false;
let startedRouter = false;
const routerScope = resetRuntimeScope('router');

export function getRoute() {
    return getPtvRouteOwnership(window.location);
}

function applyRouteClasses(route) {
    const root = document.documentElement;

    root.classList.remove(...getPtvRouteClassNames());
    root.classList.add(route.className);
    root.dataset.ptvRouteOwner = route.owner;
    root.dataset.ptvRoutePageType = route.pageType;
    root.dataset.ptvRouteLayout = route.layout;
    root.dataset.ptvRouteDensity = route.density;
    root.dataset.ptvRouteElevation = String(route.elevation);
    root.dataset.ptvNavSection = route.navigation.activeSectionId || '';
    root.dataset.ptvNavItem = route.navigation.activeItemId || '';
}

export function checkRoute(options = {}) {
    const startedAt = performance.now();
    const route = getRoute();

    const routeKey = `${route.full}|${route.pageType}|${route.owner}|${route.layout}|${route.features.join(',')}`;

    if (!options.force && routeKey === currentPath) {
        return route;
    }

    currentPath = routeKey;
    applyRouteClasses(route);
    emit('routechange', route);
    recordPtvEvent('route', 'routechange', {
        features: route.features,
        full: route.full,
        layout: route.layout,
        owner: route.owner,
        pageType: route.pageType
    });
    recordPtvTiming('render', 'route-apply', performance.now() - startedAt, {
        owner: route.owner,
        pageType: route.pageType
    });

    return route;
}

export function scheduleRouteCheck(force = false) {
    schedule('route-check', () => checkRoute({ force }));
}

function patchHistory() {
    if (patchedHistory) return;

    patchedHistory = true;

    const originalPushState = browserHistory.pushState;
    const originalReplaceState = browserHistory.replaceState;

    browserHistory.pushState = function (...args) {
        const result = originalPushState.apply(this, args);
        scheduleRouteCheck();
        return result;
    };

    browserHistory.replaceState = function (...args) {
        const result = originalReplaceState.apply(this, args);
        scheduleRouteCheck();
        return result;
    };
}

export function startRouter() {
    if (startedRouter) return;

    startedRouter = true;
    patchHistory();

    registerPtvRuntimeListener('router:moduleregistered', () => on('moduleregistered', () => {
        scheduleRouteCheck(true);
    }));
    routerScope.listen(window, 'hashchange', () => scheduleRouteCheck());
    routerScope.listen(window, 'popstate', () => scheduleRouteCheck());
    // Jellyfin restores cached views between the history event and the next
    // animation frame. Reconcile synchronously so route modules are listening
    // before the restored view emits its viewshow/detailsrendered events.
    routerScope.listen(document, 'viewbeforeshow', () => checkRoute(), true);

    currentPath = '';
    checkRoute();
}
