import { describe, expect, it } from 'vitest';

import {
    getPtvReadingRouteHomeGate,
    isPtvReadingCatalogView,
    shouldStartPtvReadingLibraryIndexImmediately
} from './readingRoutePolicy';

describe('isPtvReadingCatalogView', () => {
    it('treats the scoped library view as a catalog entry route', () => {
        expect(isPtvReadingCatalogView('library')).toBe(true);
    });

    it.each([
        'home',
        'explore',
        'collections',
        'item',
        'series'
    ])('keeps %s dependent on its Reading Home snapshot', view => {
        expect(isPtvReadingCatalogView(view)).toBe(false);
    });

    it('does not gate a direct catalog route on an empty, pending Home snapshot', () => {
        expect(getPtvReadingRouteHomeGate('library', {
            hasError: false,
            hasHomeSections: false,
            isLoading: true
        })).toBe('ready');
    });

    it('starts the scoped library index independently of the Home snapshot', () => {
        expect(shouldStartPtvReadingLibraryIndexImmediately('library')).toBe(true);
        expect(shouldStartPtvReadingLibraryIndexImmediately('home')).toBe(false);
    });

    it('surfaces a terminal catalog error after its local load retires', () => {
        expect(getPtvReadingRouteHomeGate('library', {
            hasError: true,
            hasHomeSections: false,
            isLoading: false
        })).toBe('error');
    });

    it('retains loading and error gates for Home-dependent routes', () => {
        expect(getPtvReadingRouteHomeGate('home', {
            hasError: false,
            hasHomeSections: false,
            isLoading: true
        })).toBe('loading');
        expect(getPtvReadingRouteHomeGate('explore', {
            hasError: true,
            hasHomeSections: false,
            isLoading: false
        })).toBe('error');
        expect(getPtvReadingRouteHomeGate('home', {
            hasError: true,
            hasHomeSections: true,
            isLoading: false
        })).toBe('ready');
    });
});
