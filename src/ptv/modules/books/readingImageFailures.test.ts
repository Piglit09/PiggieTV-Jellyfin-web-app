import { describe, expect, it } from 'vitest';

import { createPtvReadingImageFailureRegistry } from './readingImageFailures';

describe('PtvReadingImageFailureRegistry', () => {
    it('keeps failed artwork and diagnostics isolated by Reading route', () => {
        const registry = createPtvReadingImageFailureRegistry();
        const books = registry.get('books');
        const manga = registry.get('manga');
        const url = 'https://server/Items/book-1/Images/Primary';

        books.failedCoverItemIds.add('book-1');
        books.failedUrls.add(url);
        books.reportedCachedFailureUrls.add(url);
        books.fallbackPosterRenderedCount += 1;

        expect(manga.failedCoverItemIds.has('book-1')).toBe(false);
        expect(manga.failedUrls.has(url)).toBe(false);
        expect(manga.fallbackPosterRenderedCount).toBe(0);
    });

    it('clears refreshed artwork only in the active route', () => {
        const registry = createPtvReadingImageFailureRegistry();
        const url = 'https://server/Items/shared-1/Images/Primary';
        const books = registry.get('books');
        const comics = registry.get('comics');

        books.failedCoverItemIds.add('shared-1');
        books.failedUrls.add(url);
        books.reportedCachedFailureUrls.add(url);
        comics.failedCoverItemIds.add('shared-1');
        comics.failedUrls.add(url);

        registry.clearForItem('books', 'shared-1');

        expect(books.failedCoverItemIds.has('shared-1')).toBe(false);
        expect(books.failedUrls.has(url)).toBe(false);
        expect(comics.failedCoverItemIds.has('shared-1')).toBe(true);
        expect(comics.failedUrls.has(url)).toBe(true);
    });
});
