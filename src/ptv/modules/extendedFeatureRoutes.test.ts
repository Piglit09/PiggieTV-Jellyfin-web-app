import { describe, expect, it } from 'vitest';

import {
    isPtvReadingFeatureRoute,
    isPtvRequestFeatureRoute
} from './extendedFeatureRoutes';

describe('extended feature routes', () => {
    it.each([
        '#/reading',
        '#/reading/books',
        '#/books',
        '#/comics?tab=recent',
        '#/manga/title',
        '#/maga'
    ])('recognizes Reading route %s', hash => {
        expect(isPtvReadingFeatureRoute(hash)).toBe(true);
    });

    it.each([
        '#/requests',
        '#/requests?search=query',
        '#/request',
        '#/ptv/request'
    ])('recognizes Request route %s', hash => {
        expect(isPtvRequestFeatureRoute(hash)).toBe(true);
    });

    it.each(['', '#/home', '#/music', '#/dashboard', '#/requesting'])(
        'does not classify core route %s as an extended feature',
        hash => {
            expect(isPtvReadingFeatureRoute(hash)).toBe(false);
            expect(isPtvRequestFeatureRoute(hash)).toBe(false);
        }
    );
});
