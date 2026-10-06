import { describe, expect, it, vi } from 'vitest';
import { ServerConnections } from 'lib/jellyfin-apiclient';

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        getApiClient: vi.fn()
    }
}));

import { createJellyfinReaderSource, isPotentialReaderItem } from './jellyfinBookProvider';

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

describe('Jellyfin reader download URL', () => {
    it('uses the current user token with the canonical query name on the policy-protected Download route', () => {
        const serverUrl = 'https://jellyfin.example';
        const userToken = 'user-device-token';
        const client = {
            accessToken: () => userToken,
            getItemDownloadUrl: (id: string) => `${serverUrl}/Items/${id}/Download?api_key=${userToken}`,
            getUrl: (path: string, query: Record<string, string>) => {
                // eslint-disable-next-line compat/compat -- URL parsing here runs only in the test runtime.
                const url = new URL(path, `${serverUrl}/`);
                Object.entries(query).forEach(([key, value]) => {
                    url.searchParams.set(key, value);
                });
                return url.toString();
            }
        };
        vi.mocked(ServerConnections.getApiClient).mockReturnValue(client as never);

        const source = createJellyfinReaderSource({
            Id: 'book-id',
            Name: 'Book.pdf',
            Path: '/library/Book.pdf',
            ServerId: 'server-a',
            Type: 'Book'
        });
        // eslint-disable-next-line compat/compat -- URL parsing here runs only in the test runtime.
        const url = new URL(source.downloadUrl || '');

        expect(url.origin).toBe(serverUrl);
        expect(url.pathname).toBe('/Items/book-id/Download');
        expect(url.searchParams.get('ApiKey')).toBe(userToken);
        expect(url.searchParams.has('api_key')).toBe(false);
    });
});
