import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../components/images/imageLoader', () => ({
    default: { lazyChildren: vi.fn() }
}));

vi.mock('../../api', () => ({
    getPtvItemImageCandidates: vi.fn(() => [])
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    shouldCollectDiagnostics: vi.fn(() => false)
}));

vi.mock('../../core/tvFocus', () => ({
    focusPtvTvElement: vi.fn()
}));

vi.mock('../recommendations/engine/recommendationEngine', () => ({
    getPtvRecommendationHomeData: vi.fn()
}));

vi.mock('./detailsAuthoritativeRelationships', () => ({
    getPtvAuthoritativeRelationships: vi.fn()
}));

import {
    createPtvCinematicDetailsElement
} from './detailsCinematicExperience';
import type { PtvCinematicDetailsModel } from './detailsCinematicModel';

describe('cinematic authoritative destination routing', () => {
    it('uses the actual canonical resolver for every supported target family and fallback', () => {
        const items = [
            { Id: 'movie', Name: 'Movie', Type: 'Movie' },
            { Id: 'series', Name: 'Series', Type: 'Series' },
            { Id: 'album', Name: 'Album', Type: 'MusicAlbum' },
            { Id: 'artist', Name: 'Artist', Type: 'MusicArtist' },
            { CollectionType: 'books', Id: 'book', Name: 'Book', Type: 'Book' },
            { Container: 'cbz', Id: 'comic', Name: 'Comic', Type: 'Book' },
            { Id: 'manga', Name: 'Reading Item', PtvReadingLibraryKindHint: 'manga', Type: 'Book' },
            { Id: 'photo', Name: 'Photo', Type: 'Photo' }
        ];
        const model: PtvCinematicDetailsModel = {
            candidateCount: items.length,
            dedupedCandidateCount: 0,
            facts: [],
            family: 'video',
            kicker: 'Configured relationships',
            shelves: [{
                description: 'Administrator configured.',
                id: 'cross-library',
                items: items.map(item => ({
                    item,
                    itemId: item.Id,
                    reason: 'Configured Connection',
                    subtitle: String(item.Type),
                    title: String(item.Name)
                })),
                orderLabel: 'Administrator order',
                relationship: 'cross-library',
                title: 'Connected media'
            }],
            summary: 'Configured relationship targets.',
            title: 'Source'
        };
        const section = createPtvCinematicDetailsElement(model);
        const hrefByTitle = Object.fromEntries(Array.from(section.querySelectorAll<HTMLAnchorElement>('.ptv-cinematic-card'))
            .map(anchor => [anchor.querySelector('.ptv-cinematic-card__title')?.textContent, anchor.getAttribute('href')]));

        expect(hrefByTitle).toEqual({
            Album: '#/music/album/album',
            Artist: '#/music/artist/artist',
            Book: '#/books/item/book',
            Comic: '#/comics/item/comic',
            Movie: '#/details?id=movie',
            Photo: '#/details?id=photo',
            'Reading Item': '#/manga/item/manga',
            Series: '#/details?id=series'
        });
    });
});
