import { describe, expect, it } from 'vitest';

import { getPtvDetailsDiscoveryLinks } from './detailsDiscoveryModel';

describe('details discovery model', () => {
    it('builds a stable, prioritized strip from already-hydrated metadata', () => {
        const links = getPtvDetailsDiscoveryLinks({
            AlbumArtists: [{ Name: 'Example Artist' }],
            CollectionName: 'Example Franchise',
            Genres: ['Drama', 'Mystery'],
            People: [
                { Name: 'Example Director', Type: 'Director' },
                { Name: 'Ignored Actor', Type: 'Actor' }
            ],
            Studios: [{ Name: 'Example Studio' }],
            Type: 'Movie'
        });

        expect(links.map(link => [link.kind, link.query])).toEqual([
            ['franchise', 'Example Franchise'],
            ['artist', 'Example Artist'],
            ['creator', 'Example Director'],
            ['studio', 'Example Studio'],
            ['genre', 'Drama'],
            ['genre', 'Mystery']
        ]);
        expect(links[0]).toEqual(expect.objectContaining({
            href: '#/collections?view=all&query=Example%20Franchise',
            label: 'Explore Example Franchise'
        }));
    });

    it('adds Series context for Season and Episode details', () => {
        const links = getPtvDetailsDiscoveryLinks({
            SeriesName: 'Example Series',
            Type: 'Episode'
        });

        expect(links).toEqual([
            expect.objectContaining({
                href: '#/collections?view=all&query=Example%20Series',
                kind: 'franchise',
                label: 'Explore Example Series',
                meta: 'Series context',
                query: 'Example Series'
            })
        ]);
    });

    it('deduplicates matching metadata across categories and enforces the bounded limit', () => {
        const links = getPtvDetailsDiscoveryLinks({
            AlbumArtists: [{ Name: 'Shared Name' }],
            Artists: [' shared   name '],
            Genres: ['Shared Name', 'Adventure', 'Comedy'],
            People: [{ Name: 'Shared Name', Type: 'Composer' }],
            Studios: [{ Name: 'Shared Name' }]
        }, 2);

        expect(links.map(link => link.query)).toEqual(['Shared Name', 'Adventure']);
    });

    it('omits the strip when useful metadata is unavailable', () => {
        expect(getPtvDetailsDiscoveryLinks({
            People: [{ Name: 'Only Actor', Type: 'Actor' }],
            Type: 'Movie'
        })).toEqual([]);
    });

    it('encodes query values without placing metadata into HTML', () => {
        const [link] = getPtvDetailsDiscoveryLinks({
            Genres: ['Sci-Fi & Fantasy']
        });

        expect(link.href).toBe('#/search?query=Sci-Fi%20%26%20Fantasy&ptvGrouped=true');
        expect(link.ariaLabel).toBe('Search PiggieTV for Sci-Fi & Fantasy (genre)');
    });
});
