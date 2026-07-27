import { describe, expect, it } from 'vitest';

import {
    getPtvPlatformFeaturePolicy,
    isPtvPlatformNavigationEntryAvailable,
    isPtvWebOsExcludedRoute
} from './platformFeatures';

describe('PTV platform feature policy', () => {
    it('keeps Reading and Request available outside WebOS', () => {
        expect(getPtvPlatformFeaturePolicy({ isWebOs: false })).toEqual({
            reading: true,
            request: true
        });
    });

    it('excludes Reading and Request on WebOS', () => {
        expect(getPtvPlatformFeaturePolicy({ isWebOs: true })).toEqual({
            reading: false,
            request: false
        });
    });

    it.each([
        '#/reading',
        '#/reading/library',
        '#/books?id=library',
        '#/comics',
        '#/manga',
        '#/request',
        '#/requests',
        '#/ptv/request',
        '#/calendar'
    ])('identifies the excluded WebOS route %s', route => {
        expect(isPtvWebOsExcludedRoute(route, { isWebOs: true })).toBe(true);
        expect(isPtvWebOsExcludedRoute(route, { isWebOs: false })).toBe(false);
    });

    it('does not exclude unrelated WebOS routes', () => {
        expect(isPtvWebOsExcludedRoute('#/home', { isWebOs: true })).toBe(false);
        expect(isPtvWebOsExcludedRoute('#/music/player', { isWebOs: true })).toBe(false);
        expect(isPtvWebOsExcludedRoute('#/movies', { isWebOs: true })).toBe(false);
    });

    it('filters entries by both stable identifier and route', () => {
        expect(isPtvPlatformNavigationEntryAvailable(
            { id: 'reading-library', href: '#/home' },
            { isWebOs: true }
        )).toBe(false);
        expect(isPtvPlatformNavigationEntryAvailable(
            { id: 'custom-request-link', href: '#/request' },
            { isWebOs: true }
        )).toBe(false);
        expect(isPtvPlatformNavigationEntryAvailable(
            { id: 'music', href: '#/music' },
            { isWebOs: true }
        )).toBe(true);
    });
});
