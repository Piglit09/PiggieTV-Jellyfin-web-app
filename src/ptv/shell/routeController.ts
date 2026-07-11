import { emit, on } from '../core/events';
import { getRoute, scheduleRouteCheck } from '../core/router';
import { recordPtvEvent } from '../core/observability';
import { getPtvRouteOwnership } from './routes';

export type PtvRouteTakeoverMode = 'native' | 'enhanced' | 'fallback';

export type PtvNativeRouteRegistration = {
    component?: unknown;
    mode: PtvRouteTakeoverMode;
    path: string;
};

export type PtvRouteControllerState = {
    activeFeatureIds: string[];
    canRenderNative: boolean;
    fallbackReason: string;
    full: string;
    hash: string;
    layout: string;
    mode: PtvRouteTakeoverMode;
    owner: string;
    pageType: string;
    path: string;
    routeId: string;
};

type PtvRouteLike = {
    features?: string[];
    full?: string;
    hash?: string;
    id?: string;
    layout?: string;
    owner?: string;
    pageType?: string;
    path?: string;
};

const NATIVE_ROUTE_FEATURES = new Set([
    'browse',
    'signup',
    'request',
    'calendar',
    'collections',
    'movies',
    'shows'
]);

const ENHANCED_ROUTE_FEATURES = new Set([
    'books',
    'comics',
    'home',
    'details',
    'library',
    'login',
    'manga',
    'music',
    'playback',
    'reading',
    'recommendations',
    'row-builder',
    'search',
    'settings'
]);

let routeControllerStarted = false;
let currentState: PtvRouteControllerState | null = null;
const nativeRouteRegistry = new Map<string, PtvNativeRouteRegistration>();

nativeRouteRegistry.set('/home', {
    mode: 'native',
    path: '/home'
});

function getCurrentRouteDiagnostics(route?: PtvRouteLike) {
    return {
        currentHash: window.location.hash || '',
        currentPathname: window.location.pathname || '',
        currentRouteId: route?.id || route?.pageType || '',
        currentPageType: route?.pageType || '',
        full: route?.full || `${window.location.pathname}${window.location.hash}`,
        hash: route?.hash || window.location.hash || '',
        path: route?.path || window.location.pathname || ''
    };
}

function matchesDashboardPtvRoute(route: PtvRouteLike, segment: string) {
    const routeText = [
        route.hash,
        route.path,
        route.full,
        window.location.hash,
        window.location.pathname,
        `${window.location.pathname}${window.location.hash}`
    ].filter(Boolean).join(' ');
    const pattern = new RegExp(`(?:^|[#\\s])/?dashboard/piggietv/${segment}(?:[/?#\\s]|$)`, 'i');

    return pattern.test(routeText);
}

function getForcedRouteDescriptor(route: PtvRouteLike): PtvRouteLike | null {
    if (matchesDashboardPtvRoute(route, 'recommendations')) {
        return {
            ...route,
            features: [...new Set([...(route.features || []), 'dashboard', 'recommendations'])],
            id: 'recommendations',
            layout: route.layout || 'admin',
            owner: 'dashboard',
            pageType: 'recommendations'
        };
    }

    if (matchesDashboardPtvRoute(route, 'rows')) {
        return {
            ...route,
            features: [...new Set([...(route.features || []), 'dashboard', 'row-builder'])],
            id: 'row-builder',
            layout: route.layout || 'admin',
            owner: 'dashboard',
            pageType: 'row-builder'
        };
    }

    return null;
}

console.info('[PTV Recommendations] Route registered', {
    ...getCurrentRouteDiagnostics(),
    routeId: 'recommendations',
    source: 'ptv-route-controller'
});
recordPtvEvent('recommendation', 'recommendation-route-registered', {
    ...getCurrentRouteDiagnostics(),
    routeId: 'recommendations',
    source: 'ptv-route-controller'
});

function normalizeRegisteredPath(path: string) {
    const value = String(path || '').trim();

    if (!value) return '';

    return value.startsWith('/') ? value.toLowerCase() : `/${value.toLowerCase()}`;
}

function getHashPath(hash = window.location.hash || '') {
    const normalizedHash = hash.replace(/^#/, '');
    const pathOnly = normalizedHash.split('?')[0] || '';

    return normalizeRegisteredPath(pathOnly);
}

function routeMatchesRegisteredNativeRoute(route: PtvRouteLike) {
    const routeHashPath = getHashPath(route.hash);
    const routePath = normalizeRegisteredPath(route.path || '');
    const registeredRoutes = Array.from(nativeRouteRegistry.values());

    return registeredRoutes.find(entry => (
        entry.path === routeHashPath
        || entry.path === routePath
        || (entry.path.endsWith('/*') && routeHashPath.startsWith(entry.path.slice(0, -1)))
        || (entry.path.endsWith('/*') && routePath.startsWith(entry.path.slice(0, -1)))
        || routeHashPath.endsWith(entry.path)
    ));
}

function hasFeature(route: PtvRouteLike, featureIds: Set<string>) {
    return Boolean((route.features || []).some(feature => featureIds.has(feature)));
}

function getControllerMode(route: PtvRouteLike): PtvRouteTakeoverMode {
    const registeredNativeRoute = routeMatchesRegisteredNativeRoute(route);

    if (registeredNativeRoute) return registeredNativeRoute.mode;
    if (hasFeature(route, NATIVE_ROUTE_FEATURES)) return 'native';
    if (hasFeature(route, ENHANCED_ROUTE_FEATURES)) return 'enhanced';

    return 'fallback';
}

function getFallbackReason(route: PtvRouteLike, mode: PtvRouteTakeoverMode): string {
    if (mode === 'native') return '';
    if (mode === 'enhanced') return 'PTV is enhancing this Jellyfin route while Jellyfin still owns the base page.';

    return route.owner === 'shell' ?
        'No native PTV route is registered yet, falling back to Jellyfin Web.' :
        'Route remains delegated to Jellyfin Web until the native PTV replacement is complete.';
}

function normalizeRoute(route: PtvRouteLike): PtvRouteControllerState {
    const normalizedInput = getForcedRouteDescriptor(route) || route;
    const mode = getControllerMode(normalizedInput);

    return {
        activeFeatureIds: normalizedInput.features || [],
        canRenderNative: mode === 'native',
        fallbackReason: getFallbackReason(normalizedInput, mode),
        full: normalizedInput.full || `${window.location.pathname}${window.location.hash}`,
        hash: normalizedInput.hash || window.location.hash || '',
        layout: normalizedInput.layout || 'standard',
        mode,
        owner: normalizedInput.owner || 'shell',
        pageType: normalizedInput.pageType || 'generic',
        path: normalizedInput.path || window.location.pathname || '',
        routeId: normalizedInput.id || normalizedInput.pageType || 'generic'
    };
}

function stateChanged(nextState: PtvRouteControllerState) {
    if (!currentState) return true;

    return [
        'full',
        'mode',
        'owner',
        'pageType',
        'routeId'
    ].some(key => currentState?.[key as keyof PtvRouteControllerState] !== nextState[key as keyof PtvRouteControllerState]);
}

function publishRowBuilderRouteMatch(nextState: PtvRouteControllerState) {
    const isRowBuilderPath = /\/dashboard\/piggietv\/rows(?:[/?]|$)/i.test(nextState.hash)
        || /\/dashboard\/piggietv\/rows(?:[/?]|$)/i.test(nextState.path)
        || /\/dashboard\/piggietv\/rows(?:[/?]|$)/i.test(nextState.full);

    const detail = {
        componentMounted: false,
        full: nextState.full,
        hash: nextState.hash,
        mode: nextState.mode,
        owner: nextState.owner,
        pageType: nextState.pageType,
        path: nextState.path,
        routeId: nextState.routeId
    };

    if (isRowBuilderPath && nextState.routeId !== 'row-builder') {
        const failureDetail = {
            ...detail,
            interceptedByRouteId: nextState.routeId,
            reason: 'Row Builder URL was claimed by a different PTV route matcher.'
        };

        console.error('[PTV Row Builder] Route matched failed', failureDetail);
        recordPtvEvent('route', 'row-builder-route-matched-failed', failureDetail);
        return;
    }

    if (nextState.routeId !== 'row-builder') return;

    console.info('[PTV Row Builder] Route matched', detail);
    recordPtvEvent('route', 'row-builder-route-matched', detail);
}

function publishRecommendationRouteMatch(nextState: PtvRouteControllerState) {
    const isRecommendationPath = matchesDashboardPtvRoute(nextState, 'recommendations');

    const detail = {
        componentMounted: false,
        currentRouteId: nextState.routeId,
        currentPageType: nextState.pageType,
        full: nextState.full,
        hash: nextState.hash,
        mode: nextState.mode,
        owner: nextState.owner,
        pageType: nextState.pageType,
        path: nextState.path,
        routeId: nextState.routeId,
        windowLocationHash: window.location.hash
    };

    if (isRecommendationPath && nextState.routeId !== 'recommendations') {
        const failureDetail = {
            ...detail,
            interceptedByRouteId: nextState.routeId,
            reason: 'Recommendations URL was claimed by a different PTV route matcher.'
        };

        console.error('[PTV Recommendations] Route matched failed', failureDetail);
        recordPtvEvent('recommendation', 'recommendation-route-matched-failed', failureDetail);
        return;
    }

    if (nextState.routeId !== 'recommendations') return;

    console.info('[PTV Recommendations] Route matched', detail);
    recordPtvEvent('recommendation', 'recommendation-route-matched', detail);
}

function publishRouteControllerState(route: PtvRouteLike) {
    const nextState = normalizeRoute(route);

    if (!stateChanged(nextState)) {
        currentState = nextState;
        return nextState;
    }

    currentState = nextState;
    publishRecommendationRouteMatch(nextState);
    publishRowBuilderRouteMatch(nextState);
    recordPtvEvent('route', 'route-matched', {
        features: nextState.activeFeatureIds,
        full: nextState.full,
        path: nextState.path,
        routeId: nextState.routeId
    });
    recordPtvEvent('route', 'route-classified', {
        canRenderNative: nextState.canRenderNative,
        fallbackReason: nextState.fallbackReason,
        mode: nextState.mode,
        owner: nextState.owner,
        pageType: nextState.pageType,
        routeId: nextState.routeId
    });
    emit('routecontrollerchange', nextState);
    recordPtvEvent('route', 'route-controller-change', {
        fallbackReason: nextState.fallbackReason,
        mode: nextState.mode,
        owner: nextState.owner,
        pageType: nextState.pageType,
        routeId: nextState.routeId
    });

    return nextState;
}

export function getPtvRouteControllerState(): PtvRouteControllerState {
    const full = `${window.location.pathname}${window.location.hash}`;
    const shouldForceRecommendationRoute = matchesDashboardPtvRoute({
        full,
        hash: window.location.hash,
        path: window.location.pathname
    }, 'recommendations') && currentState?.routeId !== 'recommendations';

    if (currentState?.full === full && !shouldForceRecommendationRoute) return currentState;

    return publishRouteControllerState(getPtvRouteOwnership(window.location));
}

export function navigatePtvRoute(href: string, options: {
    replace?: boolean;
} = {}) {
    if (!href) return;

    if (options.replace) {
        window.history.replaceState(null, document.title, href);
    } else {
        window.history.pushState(null, document.title, href);
    }

    scheduleRouteCheck(true);
}

export function registerPtvNativeRoute(
    path: string,
    component?: unknown,
    mode: PtvRouteTakeoverMode = 'native'
) {
    const normalizedPath = normalizeRegisteredPath(path);

    if (!normalizedPath) return null;

    const registration = {
        component,
        mode,
        path: normalizedPath
    };

    nativeRouteRegistry.set(normalizedPath, registration);
    recordPtvEvent('route', 'native-route-registered', {
        mode,
        path: normalizedPath
    });

    publishRouteControllerState(getRoute());

    return registration;
}

export function getRegisteredPtvNativeRoutes() {
    return Array.from(nativeRouteRegistry.values()).map(route => ({
        mode: route.mode,
        path: route.path
    }));
}

export function startPtvRouteController() {
    if (routeControllerStarted) return;

    routeControllerStarted = true;
    publishRouteControllerState(getRoute());

    on('routechange', (event: Event) => {
        publishRouteControllerState((event as CustomEvent<PtvRouteLike>).detail || getRoute());
    });

    const root = window.PTV || (window.PTV = {});
    root.routeController = {
        getRegisteredRoutes: getRegisteredPtvNativeRoutes,
        getState: getPtvRouteControllerState,
        navigate: navigatePtvRoute,
        registerRoute: registerPtvNativeRoute,
        refresh: () => publishRouteControllerState(getRoute())
    };
}

startPtvRouteController();
