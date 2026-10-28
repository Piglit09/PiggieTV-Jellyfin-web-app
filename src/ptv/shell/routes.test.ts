import { afterEach, describe, expect, it } from 'vitest';

import { getPtvRouteOwnership } from './routes';

function getRoute(hash: string) {
    return getPtvRouteOwnership({
        hash,
        pathname: '/'
    } as Location);
}

afterEach(() => {
    document.documentElement.classList.remove('ptv-request-active');
});

describe('PTV shell reading routes', () => {
    it('routes the primary Reading tab to Reading Home ownership', () => {
        const route = getRoute('#/reading');

        expect(route.id).toBe('reading');
        expect(route.owner).toBe('reading');
        expect(route.pageType).toBe('reading');
        expect(route.navigationItemId).toBe('reading');
        expect(route.normalizedPath).toBe('/reading');
    });

    it('keeps canonical Reading subsections under Reading ownership', () => {
        const route = getRoute('#/reading/books');

        expect(route.id).toBe('reading');
        expect(route.owner).toBe('reading');
        expect(route.normalizedPath).toBe('/reading/books');
    });

    it('preserves legacy Books route ownership for direct links', () => {
        const route = getRoute('#/books');

        expect(route.id).toBe('books');
        expect(route.owner).toBe('books');
        expect(route.pageType).toBe('books');
        expect(route.normalizedPath).toBe('/books');
    });

    it('does not let deferred Request teardown steal one canonical Manga navigation', () => {
        document.documentElement.classList.add('ptv-request-active');
        const whileRequestTeardownIsPending = getRoute('#/reading/manga');

        document.documentElement.classList.remove('ptv-request-active');
        const afterRequestTeardown = getRoute('#/reading/manga');
        const ownership = [ whileRequestTeardownIsPending, afterRequestTeardown ].map(route => ({
            id: route.id,
            normalizedPath: route.normalizedPath,
            owner: route.owner,
            pageType: route.pageType
        }));

        expect(ownership).toEqual([
            {
                id: 'reading',
                normalizedPath: '/reading/manga',
                owner: 'reading',
                pageType: 'reading'
            },
            {
                id: 'reading',
                normalizedPath: '/reading/manga',
                owner: 'reading',
                pageType: 'reading'
            }
        ]);
    });
});

describe('PTV shell Request route ownership', () => {
    it('uses the canonical Request URL before its presentation class mounts', () => {
        expect(document.documentElement.classList.contains('ptv-request-active')).toBe(false);

        expect(getRoute('#/requests')).toMatchObject({
            id: 'request',
            normalizedPath: '/requests',
            owner: 'request',
            pageType: 'request'
        });
    });
});

describe('PTV shell browse route ownership', () => {
    it('keeps static media and administrator route identity separate from displayed permissions', () => {
        expect(getRoute('#/music').navigation).toEqual({
            activeItemId: 'music',
            activeSectionId: 'media',
            href: '#/music'
        });
        expect(getRoute('#/dashboard').navigation).toMatchObject({
            activeItemId: 'dashboard',
            activeSectionId: 'admin'
        });
    });

    it.each([
        ['#/movies?view=genre&genre=Crime', 'movies'],
        ['#/shows?view=network&network=AMC', 'shows'],
        ['#/tv?view=latest', 'shows']
    ])('classifies %s under its media owner', (hash, owner) => {
        const route = getRoute(hash);

        expect(route.id).toBe(owner);
        expect(route.owner).toBe(owner);
        expect(route.pageType).toBe('browse');
        expect(route.className).toBe('ptv-route-browse');
    });

    it('keeps Collections under generic browse ownership', () => {
        const route = getRoute('#/collections');

        expect(route.id).toBe('browse');
        expect(route.owner).toBe('browse');
    });
});

describe('PTV shell details route ownership', () => {
    it.each([
        '#/details?id=movie-id',
        '#/details?id=series-id&serverId=server-id',
        '#/item/episode-id'
    ])('classifies %s as a PTV-owned details route', hash => {
        const route = getRoute(hash);

        expect(route.id).toBe('details');
        expect(route.owner).toBe('details');
        expect(route.pageType).toBe('details');
    });

    it('does not misclassify Jellyfin video playback as details', () => {
        const route = getRoute('#/video');

        expect(route.id).not.toBe('details');
        expect(route.owner).not.toBe('details');
    });

    it('does not steal native Music item routes', () => {
        const route = getRoute('#/music/item/track-id');

        expect(route.id).toBe('music');
        expect(route.owner).toBe('music');
    });
});

describe('PTV TV navigation diagnostics route', () => {
    it('classifies the on-device navigation debugger as a settings page', () => {
        const route = getRoute('#/tv-navigation-debug');

        expect(route.id).toBe('tv-navigation-debug');
        expect(route.owner).toBe('settings');
        expect(route.pageType).toBe('settings');
        expect(route.features).toContain('tv-navigation-debug');
    });
});

describe('PTV shell authentication routes', () => {
    it.each([
        '#/login',
        '#/login?serverid=server&url=%2Fhome',
        '#/selectserver',
        '#/forgotpassword'
    ])('keeps %s under login ownership', hash => {
        const route = getRoute(hash);

        expect(route.id).toBe('login');
        expect(route.owner).toBe('login');
        expect(route.layout).toBe('auth');
    });

    it('preserves signup ownership for the custom authentication route', () => {
        const route = getRoute('#/ptv/signup?mode=reset');

        expect(route.id).toBe('signup');
        expect(route.owner).toBe('signup');
        expect(route.layout).toBe('auth');
    });
});
