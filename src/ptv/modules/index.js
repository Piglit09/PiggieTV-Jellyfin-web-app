import './header';
import './sidebar/Sidebar';
import './cards';
import './media-bar';
import './settings';
import './login';
import './details';
import './integrations/arrActions';
import './request';
import './signup';
import './reader';
import './music';
import './books';
import './theme-songs';
import './playback';

let dashboardEnhancementLoadPromise = null;

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

loadDashboardEnhancements();
window.addEventListener('hashchange', loadDashboardEnhancements);
window.addEventListener('popstate', loadDashboardEnhancements);
