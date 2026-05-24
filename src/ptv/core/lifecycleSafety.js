import { on } from './events';
import {
    cancelPtvImageScope,
    trimPtvImageManagerMemory
} from './imageManager';
import { getObserverDiagnostics } from './observer';
import { recordPtvEvent } from './observability';
import { getRuntimeDiagnostics, resetRuntimeScope } from './scope';
import {
    cleanupDisconnectedPtvHomeHeroes,
    unmountPtvHomeHero
} from '../pages/home/mountHero';
import { cleanupPtvRowBackdrops } from '../pages/home/ptvRows';

const routeLifecycleScope = resetRuntimeScope('route-lifecycle');

let previousRoute = null;

function isDebugEnabled() {
    return window.PTV_DEBUG === true;
}

function debugLog(message, detail) {
    if (!isDebugEnabled()) return;

    console.debug(`[PiggieTV LifecycleSafety] ${message}`, detail);
}

function getHomeContainers() {
    return Array.from(document.querySelectorAll('.homeSectionsContainer'));
}

function cleanupHomeSurface(reason) {
    getHomeContainers().forEach((container) => {
        unmountPtvHomeHero(container);
        cleanupPtvRowBackdrops(container);
    });

    cleanupDisconnectedPtvHomeHeroes();
    cancelPtvImageScope('hero-backdrop');
    cancelPtvImageScope('row-backdrop');
    cancelPtvImageScope('viewport');
    cancelPtvImageScope('viewport-fallback');
    debugLog('home surface cleaned', { reason });
}

function cleanupPlaybackSurface(route) {
    if (route?.isPlayback) return;

    cancelPtvImageScope('pause-screen-backdrop');
    cancelPtvImageScope('pause-screen-logo');
    cancelPtvImageScope('pause-screen-disc');
}

function cleanupRouteTransition(route) {
    if (!previousRoute) {
        previousRoute = route;
        return;
    }

    const routeChanged = previousRoute.full !== route.full
        || previousRoute.pageType !== route.pageType
        || previousRoute.owner !== route.owner;

    if (!routeChanged) return;

    if (previousRoute.isHome && !route.isHome) {
        cleanupHomeSurface('route-exit');
    } else {
        cleanupDisconnectedPtvHomeHeroes();
    }

    cleanupPlaybackSurface(route);
    trimPtvImageManagerMemory();

    recordPtvEvent('route', 'route-cleanup', {
        from: {
            full: previousRoute.full,
            owner: previousRoute.owner,
            pageType: previousRoute.pageType
        },
        observer: getObserverDiagnostics(),
        runtime: getRuntimeDiagnostics().totals,
        to: {
            full: route.full,
            owner: route.owner,
            pageType: route.pageType
        }
    });

    previousRoute = route;
}

function getLifecycleReport() {
    return {
        observer: getObserverDiagnostics(),
        route: previousRoute,
        runtime: getRuntimeDiagnostics()
    };
}

function installLifecycleApi() {
    const ptv = window.PTV || (window.PTV = {});

    ptv.lifecycle = {
        ...(ptv.lifecycle || {}),
        cleanupHome: () => cleanupHomeSurface('manual'),
        report: getLifecycleReport
    };
}

routeLifecycleScope.add(on('routechange', ({ detail }) => {
    cleanupRouteTransition(detail);
}), {
    label: 'routechange cleanup',
    type: 'listener'
});

routeLifecycleScope.listen(window, 'pagehide', () => {
    cleanupHomeSurface('pagehide');
    trimPtvImageManagerMemory();
});

installLifecycleApi();
