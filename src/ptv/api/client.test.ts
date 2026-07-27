import { describe, expect, it, vi } from 'vitest';

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {}
}));

import { cleanPtvQuery, normalizePtvItemFields } from './client';

describe('PTV ItemFields query normalization', () => {
    it('keeps only generated Jellyfin ItemFields values', () => {
        expect(normalizePtvItemFields(
            'Container,DateCreated,ImageTags,Overview,UserData,MediaSources'
        )).toBe('DateCreated,Overview,MediaSources');
    });

    it('canonicalizes and deduplicates array values', () => {
        expect(normalizePtvItemFields([
            'genres',
            'DateCreated,Overview',
            'Genres'
        ])).toBe('Genres,DateCreated,Overview');
    });

    it('preserves non-Fields query values and removes an empty Fields query', () => {
        expect(cleanPtvQuery({
            Fields: 'Container,ImageTags,UserData',
            IncludeItemTypes: 'Movie',
            Limit: 50
        })).toEqual({
            IncludeItemTypes: 'Movie',
            Limit: 50
        });
    });
});
