import { describe, expect, it } from 'vitest';

import { getPtvRouteOwnership } from './routes';

function getRoute(hash: string) {
    return getPtvRouteOwnership({
        hash,
        pathname: '/'
    } as Location);
}

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
});

describe('PTV shell browse route ownership', () => {
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
