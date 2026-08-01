import './header';
import './sidebar/Sidebar';
import './cards';
import './media-bar';
import './settings';
import './login';
import './details';
import './integrations/arrActions';
import './signup';
import './music';
import './theme-songs';
import './playback';
import {
    getPtvPlatformFeaturePolicy,
    installPtvWebOsRouteGuard
} from '../core/platformFeatures';
import { on } from '../core/events';
import {
    isPtvReadingFeatureRoute,
    isPtvRequestFeatureRoute
} from './extendedFeatureRoutes';
import { ensurePtvReaderLoaded } from './reader/readerLoader';
import { ensurePtvRequestRoute } from './request/requestLoader';

let dashboardEnhancementLoadPromise = null;
let readingFeatureLoadPromise = null;
let requestFeatureLoadPromise = null;

function isDashboardRoute() {
    return `${window.location.pathname} ${window.location.hash}`.toLowerCase().includes('/dashboard');
}

function loadDashboardEnhancements() {
    if (!isDashboardRoute() || dashboardEnhancementLoadPromise) return;

    dashboardEnhancementLoadPromise = import(
        /* webpackChunkName: "ptv-dashboard-enhancements" */ './dashboard'
    ).catch(error => {
        dashboardEnhancementLoadPromise = null;
        console.warn('[PiggieTV] Dashboard enhancements failed to load', error);
    });
}

function loadReadingFeatures() {
    if (readingFeatureLoadPromise) return readingFeatureLoadPromise;

    readingFeatureLoadPromise = Promise.all([
        ensurePtvReaderLoaded(),
        import(/* webpackChunkName: "ptv-reading" */ './books')
    ]).catch(error => {
        readingFeatureLoadPromise = null;
        console.warn('[PiggieTV] Reading features failed to load', error);
    });

    return readingFeatureLoadPromise;
}

function loadRequestFeatures() {
    if (requestFeatureLoadPromise) return requestFeatureLoadPromise;

    requestFeatureLoadPromise = ensurePtvRequestRoute()
        .then(loaded => {
            if (!loaded) {
                requestFeatureLoadPromise = null;
            }

            return loaded;
        })
        .catch(error => {
            requestFeatureLoadPromise = null;
            console.warn('[PiggieTV] Request features failed to load', error);
        });

    return requestFeatureLoadPromise;
}

function loadExtendedWebFeatures() {
    const featurePolicy = getPtvPlatformFeaturePolicy();

    if (!featurePolicy.reading && !featurePolicy.request) {
        installPtvWebOsRouteGuard();
        return;
    }

    const hash = window.location.hash || '';

    if (featurePolicy.reading && isPtvReadingFeatureRoute(hash)) {
        void loadReadingFeatures();
    }

    if (featurePolicy.request && isPtvRequestFeatureRoute(hash)) {
        void loadRequestFeatures();
    }
}

function loadRouteFeatures() {
    loadExtendedWebFeatures();
    loadDashboardEnhancements();
}

loadRouteFeatures();
window.addEventListener('hashchange', loadRouteFeatures);
window.addEventListener('popstate', loadRouteFeatures);
on('routechange', loadRouteFeatures);
