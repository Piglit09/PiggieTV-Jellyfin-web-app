import { describe, expect, it, vi } from 'vitest';

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        getApiClient: vi.fn()
    }
}));

import { isPotentialReaderItem } from './jellyfinBookProvider';

describe('Jellyfin reader item classification', () => {
    it.each([
        {
            Name: 'Comic adaptation movie',
            Tags: ['based on comic'],
            Type: 'Movie'
        },
        {
            Genres: ['Manga'],
            Name: 'Manga adaptation series',
            Type: 'Series'
        }
    ])('does not classify audiovisual Details items as reader items', item => {
        expect(isPotentialReaderItem(item)).toBe(false);
    });

    it('continues to classify Jellyfin books as reader items', () => {
        expect(isPotentialReaderItem({
            Name: 'A Book',
            Type: 'Book'
        })).toBe(true);
    });

    it('continues to recognize an untyped comic archive', () => {
        expect(isPotentialReaderItem({
            Name: 'Issue 1.cbz'
        })).toBe(true);
    });
});
