import { getRegisteredRouteEntries } from '../core/lifecycle';
import { PTV_ROUTES } from '../core/config';
import { getPtvNavigationSections } from './navigation';
import {
    getPtvAuthenticationRouteKind,
    isPtvLoginRoute
} from './authenticationRoutes';

const ROUTE_MATCHERS = [
    {
        className: 'ptv-route-login',
        density: 'comfortable',
        elevation: 1,
        features: ['login'],
        id: 'login',
        layout: 'auth',
        owner: 'login',
        pageType: 'login',
        pattern: context => isPtvLoginRoute(context)
    },
    {
        className: 'ptv-route-signup',
        density: 'comfortable',
        elevation: 1,
        features: ['signup'],
        id: 'signup',
        layout: 'auth',
        owner: 'signup',
        pageType: 'signup',
        pattern: context => getPtvAuthenticationRouteKind(context) === 'signup'
            || document.documentElement.classList.contains('ptv-signup-active')
    },
    {
        className: 'ptv-route-recommendations',
        density: 'comfortable',
        elevation: 1,
        features: ['dashboard', 'recommendations'],
        id: 'recommendations',
        layout: 'admin',
        navigationItemId: 'piggietv-recommendations',
        owner: 'dashboard',
        pageType: 'recommendations',
        pattern: context => matchesDashboardPtvRoute(context, 'recommendations')
    },
    {
        className: 'ptv-route-row-builder',
        density: 'comfortable',
        elevation: 1,
        features: ['dashboard', 'row-builder'],
        id: 'row-builder',
        layout: 'admin',
        navigationItemId: 'piggietv-row-builder',
        owner: 'dashboard',
        pageType: 'row-builder',
        pattern: context => matchesDashboardPtvRoute(context, 'rows')
    },
    {
        className: 'ptv-route-dashboard',
        density: 'comfortable',
        elevation: 1,
        features: ['dashboard'],
        id: 'dashboard',
        layout: 'admin',
        navigationItemId: 'dashboard',
        owner: 'dashboard',
        pageType: 'dashboard',
        pattern: ({ hash, path }) => hash.includes('/dashboard') || path.includes('/dashboard')
    },
    {
        className: 'ptv-route-settings',
        density: 'dense',
        elevation: 1,
        features: ['settings', 'tv-navigation-debug'],
        id: 'tv-navigation-debug',
        layout: 'settings',
        navigationItemId: 'settings',
        owner: 'settings',
        pageType: 'settings',
        pattern: ({ hash }) => /^#\/tv-navigation-debug(?:[/?]|$)/i.test(hash)
    },
    {
        className: 'ptv-route-settings',
        density: 'dense',
        elevation: 1,
        features: ['settings'],
        id: 'settings',
        layout: 'settings',
        navigationItemId: 'settings',
        owner: 'settings',
        pageType: 'settings',
        pattern: ({ hash, path }) => hash.includes('/settings') || path.includes('/settings') || hash.includes('/mypreferences')
    },
    {
        className: 'ptv-route-details',
        density: 'comfortable',
        elevation: 1,
        features: ['details'],
        id: 'details',
        layout: 'media-detail',
        owner: 'details',
        pageType: 'details',
        pattern: ({ hash }) => /^#\/(?:details|item)(?:[/?]|$)/i.test(hash)
    },
    {
        className: 'ptv-route-recommendations-hub',
        density: 'comfortable',
        elevation: 1,
        features: ['recommendations'],
        id: 'recommendations-hub',
        layout: 'media-home',
        navigationItemId: 'recommendations',
        owner: 'recommendations',
        pageType: 'recommendations',
        pattern: ({ hash }) => hash === PTV_ROUTES.recommendations
            || hash === PTV_ROUTES.recommendationsTypo
            || /^#\/recomm?endations(?:[/?]|$)/i.test(hash)
    },
    {
        className: 'ptv-route-home',
        density: 'comfortable',
        elevation: 1,
        features: ['home'],
        id: 'home',
        layout: 'media-home',
        navigationItemId: 'home',
        owner: 'home',
        pageType: 'home',
        pattern: ({ hash }) => hash === PTV_ROUTES.homeHtml || hash === PTV_ROUTES.home || hash.includes('/home')
    },
    {
        className: 'ptv-route-request',
        density: 'comfortable',
        elevation: 1,
        features: ['request'],
        id: 'request',
        layout: 'embedded',
        navigationItemId: 'request',
        owner: 'request',
        pageType: 'request',
        pattern: () => document.documentElement.classList.contains('ptv-request-active')
    },
    {
        className: 'ptv-route-calendar',
        density: 'comfortable',
        elevation: 1,
        features: ['calendar'],
        id: 'calendar',
        layout: 'embedded',
        navigationItemId: 'calendar',
        owner: 'calendar',
        pageType: 'calendar',
        pattern: ({ hash }) => hash === PTV_ROUTES.calendar || hash.includes('/calendar')
    },
    {
        className: 'ptv-route-music',
        density: 'comfortable',
        elevation: 1,
        features: ['music'],
        id: 'music',
        layout: 'media-home',
        navigationItemId: 'music',
        owner: 'music',
        pageType: 'music',
        pattern: ({ hash }) => /^#\/music(?:[/?]|$)/i.test(hash)
    },
    {
        className: 'ptv-route-browse',
        density: 'comfortable',
        elevation: 1,
        features: ['browse', 'library', 'movies', 'collections'],
        id: 'movies',
        layout: 'media-home',
        navigationItemId: 'home',
        owner: 'movies',
        pageType: 'browse',
        pattern: ({ hash }) => /^#\/movies(?:[/?]|$)/i.test(hash)
    },
    {
        className: 'ptv-route-browse',
        density: 'comfortable',
        elevation: 1,
        features: ['browse', 'library', 'shows'],
        id: 'shows',
        layout: 'media-home',
        navigationItemId: 'home',
        owner: 'shows',
        pageType: 'browse',
        pattern: ({ hash }) => /^#\/(?:shows|tv)(?:[/?]|$)/i.test(hash)
    },
    {
        className: 'ptv-route-browse',
        density: 'comfortable',
        elevation: 1,
        features: ['browse', 'library', 'collections'],
        id: 'browse',
        layout: 'media-home',
        navigationItemId: 'home',
        owner: 'browse',
        pageType: 'browse',
        pattern: ({ hash }) => /^#\/collections(?:[/?]|$)/i.test(hash)
    },
    {
        className: 'ptv-route-reading',
        density: 'comfortable',
        elevation: 1,
        features: ['books', 'comics', 'library', 'manga', 'reading'],
        id: 'reading',
        layout: 'media-home',
        navigationItemId: 'reading',
        owner: 'reading',
        pageType: 'reading',
        pattern: ({ hash }) => /^#\/reading(?:[/?]|$)/i.test(hash)
    },
    {
        className: 'ptv-route-books',
        density: 'comfortable',
        elevation: 1,
        features: ['books', 'library', 'reading'],
        id: 'books',
        layout: 'media-home',
        navigationItemId: 'books',
        owner: 'books',
        pageType: 'books',
        pattern: ({ hash }) => /^#\/books(?:[/?]|$)/i.test(hash)
    },
    {
        className: 'ptv-route-comics',
        density: 'comfortable',
        elevation: 1,
        features: ['comics', 'library', 'reading'],
        id: 'comics',
        layout: 'media-home',
        navigationItemId: 'comics',
        owner: 'books',
        pageType: 'comics',
        pattern: ({ hash }) => /^#\/comics(?:[/?]|$)/i.test(hash)
    },
    {
        className: 'ptv-route-manga',
        density: 'comfortable',
        elevation: 1,
        features: ['library', 'manga', 'reading'],
        id: 'manga',
        layout: 'media-home',
        navigationItemId: 'manga',
        owner: 'books',
        pageType: 'manga',
        pattern: ({ hash }) => /^#\/(?:manga|maga)(?:[/?]|$)/i.test(hash)
    },
    {
        className: 'ptv-route-playback',
        density: 'comfortable',
        elevation: 0,
        features: ['playback'],
        id: 'playback',
        layout: 'player',
        owner: 'playback',
        pageType: 'playback',
        pattern: () => document.documentElement.classList.contains('ptv-playing')
    },
    {
        className: 'ptv-route-library',
        density: 'comfortable',
        elevation: 1,
        features: ['library'],
        id: 'library',
        layout: 'media-grid',
        owner: 'library',
        pageType: 'library',
        pattern: ({ hash }) => /#\/(?:tv|movies|music|collections|livetv|playlists)/i.test(hash)
    }
];

console.info('[PTV Recommendations] Route registered', {
    routeId: 'recommendations',
    routeOrder: ROUTE_MATCHERS.findIndex(route => route.id === 'recommendations'),
    source: 'ptv-shell-route-registry'
});

const FALLBACK_ROUTE = {
    className: 'ptv-route-generic',
    density: 'comfortable',
    elevation: 1,
    features: [],
    id: 'generic',
    layout: 'standard',
    owner: 'shell',
    pageType: 'generic'
};

function normalizeRouteSegment(value) {
    const trimmed = String(value || '').trim();

    if (!trimmed) return '';

    const pathOnly = trimmed.replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0] || '';

    if (!pathOnly || pathOnly === '/') return '/';

    return pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
}

function getHashPath(hash) {
    return normalizeRouteSegment(String(hash || '').replace(/^#/, ''));
}

function matchesDashboardPtvRoute(context, segment) {
    const routeText = `${context.hash || ''} ${context.hashPath || ''} ${context.path || ''} ${context.full || ''}`;
    const pattern = new RegExp(`(?:^|[#\\s])/?dashboard/piggietv/${segment}(?:[/?#\\s]|$)`, 'i');

    return pattern.test(routeText);
}

export const PTV_ROUTE_REGISTRY = [...ROUTE_MATCHERS, FALLBACK_ROUTE];

export function getPtvRouteRegistry() {
    return [
        ...ROUTE_MATCHERS,
        ...getRegisteredRouteEntries(),
        FALLBACK_ROUTE
    ];
}

export function getPtvRouteClassNames() {
    return getPtvRouteRegistry().map(route => route.className).filter(Boolean);
}

function findNavigationItem(route) {
    const sections = getPtvNavigationSections();

    for (const section of sections) {
        const item = section.items.find(entry => entry.id === route.navigationItemId);

        if (item) {
            return {
                activeItemId: item.id,
                activeSectionId: section.id,
                href: item.href
            };
        }
    }

    return {
        activeItemId: route.navigationItemId || '',
        activeSectionId: '',
        href: ''
    };
}

export function getPtvRouteOwnership(location = window.location) {
    const path = location.pathname || '';
    const hash = location.hash || '';
    const hashPath = getHashPath(hash);
    const normalizedPath = hashPath && hashPath !== '/' ? hashPath : normalizeRouteSegment(path);
    const full = `${path}${hash}`;
    const context = { full, hash, hashPath, normalizedPath, path };
    const playbackActive = document.documentElement.classList.contains('ptv-playing');
    const routeRegistry = getPtvRouteRegistry();
    const playbackRoute = routeRegistry.find(entry => entry.id === 'playback');
    const route = routeRegistry
        .filter(entry => entry.id !== 'playback')
        .filter(entry => typeof entry.pattern === 'function')
        .find(entry => entry.pattern(context))
        || (playbackActive ? playbackRoute : FALLBACK_ROUTE)
        || FALLBACK_ROUTE;
    const navigation = findNavigationItem(route);
    const features = [...new Set([
        ...(route.features || []),
        ...(playbackActive ? ['playback'] : [])
    ])];

    return {
        ...route,
        className: route.className,
        density: route.density,
        elevation: route.elevation,
        features,
        full,
        hash,
        layout: route.layout,
        navigation,
        normalizedPath,
        owner: route.owner,
        pageType: route.pageType,
        path,

        isDashboard: features.includes('dashboard'),
        isCalendar: features.includes('calendar'),
        isDetails: features.includes('details'),
        isHome: features.includes('home'),
        isLibrary: features.includes('library'),
        isLogin: features.includes('login'),
        isPlayback: features.includes('playback'),
        isRequest: features.includes('request'),
        isSignup: features.includes('signup'),
        isSettings: features.includes('settings')
    };
}
