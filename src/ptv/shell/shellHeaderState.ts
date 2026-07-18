import type { PtvRouteControllerState } from './routeController';

function getRouteHashPath(route: PtvRouteControllerState) {
    const hash = route.hash || route.normalizedPath || route.path || '';

    return hash.replace(/^#/, '').split('?')[0].toLowerCase();
}

function getExpectedHeaderSection(route: PtvRouteControllerState) {
    const path = getRouteHashPath(route);

    if (path.startsWith('/dashboard')) return 'dashboard';
    if (path.startsWith('/music')) return 'music';
    if (path.startsWith('/reading') || path.startsWith('/books') || path.startsWith('/comics') || path.startsWith('/manga')) return 'reading';
    if (path.startsWith('/movies') || path.startsWith('/collections')) return 'movies';
    if (path.startsWith('/shows') || path.startsWith('/tv')) return 'shows';
    if (path.startsWith('/requests') || path.startsWith('/request') || path.startsWith('/ptv/request')) return 'request';
    if (path.startsWith('/search')) return 'search';
    if (path.startsWith('/mypreferences')) return 'settings';
    if (path.startsWith('/home') || path === '/' || !path) return 'home';

    return '';
}

export function getHeaderStatusForRoute(header: unknown, route: PtvRouteControllerState) {
    if (!header || typeof header !== 'object' || Array.isArray(header)) return null;
    if (route.mode === 'fallback') return null;

    const headerRecord = header as Record<string, unknown>;
    const expectedSection = getExpectedHeaderSection(route);
    const headerSection = typeof headerRecord.section === 'string' ? headerRecord.section : '';

    if (headerRecord.mounted !== true) return null;
    if (!expectedSection || headerSection !== expectedSection) return null;

    return header;
}
