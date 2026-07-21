import { describe, expect, it } from 'vitest';

import {
    canUsePtvReadingHomeCache,
    isPtvReadingFullHomeCache
} from './readingCachePolicy';

describe('canUsePtvReadingHomeCache()', () => {
    const scoped = {
        cachedLibrarySetIdentity: 'books:library-a',
        cachedRouteKind: 'books',
        librarySetIdentity: 'books:library-a',
        routeKind: 'books'
    };

    it('accepts a scoped cache when route and library identity match', () => {
        expect(canUsePtvReadingHomeCache(scoped)).toBe(true);
    });

    it('rejects an unscoped provisional cache before discovery', () => {
        expect(canUsePtvReadingHomeCache({
            ...scoped,
            cachedLibrarySetIdentity: 'unscoped',
            librarySetIdentity: 'unscoped'
        })).toBe(false);
    });

    it('rejects route changes and library-set changes', () => {
        expect(canUsePtvReadingHomeCache({ ...scoped, cachedRouteKind: 'manga' })).toBe(false);
        expect(canUsePtvReadingHomeCache({ ...scoped, cachedLibrarySetIdentity: 'books:library-b' })).toBe(false);
    });

    it('rejects force-refresh and stale entries', () => {
        expect(canUsePtvReadingHomeCache({ ...scoped, forceRefresh: true })).toBe(false);
        expect(canUsePtvReadingHomeCache({ ...scoped, staleHit: true })).toBe(false);
    });

    it('keeps stale full data distinct from a partial summary response', () => {
        expect(isPtvReadingFullHomeCache({ isPartial: false })).toBe(true);
        expect(isPtvReadingFullHomeCache({ isPartial: true })).toBe(false);
        expect(isPtvReadingFullHomeCache(null)).toBe(false);
    });
});
