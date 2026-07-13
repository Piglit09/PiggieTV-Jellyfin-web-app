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
