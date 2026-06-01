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
    'signup',
    'request',
    'calendar'
]);

const ENHANCED_ROUTE_FEATURES = new Set([
    'home',
    'details',
    'library',
    'login',
    'playback',
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

    return route.owner === 'shell'
        ? 'No native PTV route is registered yet, falling back to Jellyfin Web.'
        : 'Route remains delegated to Jellyfin Web until the native PTV replacement is complete.';
}

function normalizeRoute(route: PtvRouteLike): PtvRouteControllerState {
    const mode = getControllerMode(route);

    return {
        activeFeatureIds: route.features || [],
        canRenderNative: mode === 'native',
        fallbackReason: getFallbackReason(route, mode),
        full: route.full || `${window.location.pathname}${window.location.hash}`,
        hash: route.hash || window.location.hash || '',
        layout: route.layout || 'standard',
        mode,
        owner: route.owner || 'shell',
        pageType: route.pageType || 'generic',
        path: route.path || window.location.pathname || '',
        routeId: route.id || route.pageType || 'generic'
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

function publishRouteControllerState(route: PtvRouteLike) {
    const nextState = normalizeRoute(route);

    if (!stateChanged(nextState)) {
        currentState = nextState;
        return nextState;
    }

    currentState = nextState;
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
    if (currentState) return currentState;

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
