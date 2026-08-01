import { describe, expect, it } from 'vitest';

import {
    buildPtvSearchParams,
    getPtvSearchFilterConfig,
    getPtvSearchPresentation,
    normalizePtvSearchFilter,
    serializePtvSearchParams
} from './nativeSearchState';

describe('native Search state', () => {
    it('normalizes supported filters and safely restores unknown values to All', () => {
        expect(normalizePtvSearchFilter(' MUSIC ')).toBe('music');
        expect(normalizePtvSearchFilter('unsupported')).toBe('all');
        expect(normalizePtvSearchFilter(null)).toBe('all');
    });

    it('maps compound and focused filters to the authoritative result groups', () => {
        expect(getPtvSearchFilterConfig('music').groups).toEqual(['music', 'albums', 'artists']);
        expect(getPtvSearchFilterConfig('people').groups).toEqual(['people']);
        expect(getPtvSearchFilterConfig('all').groups).toContain('reading');
    });

    it('serializes trimmed query and filter state for route restoration', () => {
        const params = buildPtvSearchParams('  example title  ', 'episodes');

        expect(params).toEqual({
            filter: 'episodes',
            ptvGrouped: 'true',
            query: 'example title'
        });
        expect(serializePtvSearchParams('example title', 'episodes'))
            .toBe('filter=episodes&ptvGrouped=true&query=example%20title');
    });

    it('distinguishes progressive, empty, and retryable result states', () => {
        expect(getPtvSearchPresentation([
            { itemCount: 2, status: 'success' },
            { itemCount: 0, status: 'loading' }
        ])).toEqual({
            failedGroupCount: 0,
            isPending: true,
            isSettled: false,
            itemCount: 2
        });
        expect(getPtvSearchPresentation([
            { itemCount: 0, status: 'empty' },
            { itemCount: 0, status: 'timeout' }
        ])).toEqual({
            failedGroupCount: 1,
            isPending: false,
            isSettled: true,
            itemCount: 0
        });
    });
});
