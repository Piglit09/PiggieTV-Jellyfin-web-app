import { describe, expect, it } from 'vitest';

import { getPtvCanonicalRouteIdentity } from './routeIdentity';

describe('routeIdentity', () => {
    it('normalizes query order without discarding route state', () => {
        expect(getPtvCanonicalRouteIdentity('#/movies?view=genre&genre=Drama'))
            .toBe('/movies?genre=Drama&view=genre');
        expect(getPtvCanonicalRouteIdentity('#/movies?genre=Drama&view=genre'))
            .toBe('/movies?genre=Drama&view=genre');
    });

    it('distinguishes query-only route changes', () => {
        expect(getPtvCanonicalRouteIdentity('#/shows?view=latest&page=1'))
            .not.toBe(getPtvCanonicalRouteIdentity('#/shows?view=latest&page=2'));
    });
});
