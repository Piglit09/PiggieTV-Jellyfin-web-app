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

let dashboardEnhancementLoadPromise = null;
let extendedWebFeatureLoadPromise = null;

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

function loadExtendedWebFeatures() {
    const featurePolicy = getPtvPlatformFeaturePolicy();

    if (!featurePolicy.reading && !featurePolicy.request) {
        installPtvWebOsRouteGuard();
        return;
    }

    if (extendedWebFeatureLoadPromise) return;

    extendedWebFeatureLoadPromise = Promise.all([
        import(/* webpackChunkName: "ptv-request" */ './request'),
        import(/* webpackChunkName: "ptv-reading" */ './reader'),
        import(/* webpackChunkName: "ptv-reading" */ './books')
    ]).catch(error => {
        extendedWebFeatureLoadPromise = null;
        console.warn('[PiggieTV] Extended web features failed to load', error);
    });
}

loadExtendedWebFeatures();
loadDashboardEnhancements();
window.addEventListener('hashchange', loadDashboardEnhancements);
window.addEventListener('popstate', loadDashboardEnhancements);
