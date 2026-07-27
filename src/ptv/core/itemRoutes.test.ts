import { describe, expect, it, vi } from 'vitest';

const observabilityMocks = vi.hoisted(() => ({
    recordPtvEvent: vi.fn(),
    shouldCollectDiagnostics: vi.fn(() => false)
}));

vi.mock('./observability', () => ({
    recordPtvEvent: observabilityMocks.recordPtvEvent,
    shouldCollectDiagnostics: observabilityMocks.shouldCollectDiagnostics
}));

import { PTV_ROUTES } from './config';
import {
    recordPtvItemRouteClick,
    resolvePtvItemRoute
} from './itemRoutes';

describe('resolvePtvItemRoute', () => {
    const cases = [
        {
            expectedHref: '#/details?id=movie%201',
            expectedSource: 'jellyfin-fallback',
            item: { Id: 'movie 1', MediaType: 'Video', Type: 'Movie' },
            name: 'Movie Details'
        },
        {
            expectedHref: '#/details?id=episode%201',
            expectedSource: 'jellyfin-fallback',
            item: { Id: 'episode 1', MediaType: 'Video', Type: 'Episode' },
            name: 'Episode Details'
        },
        {
            expectedHref: '#/details?id=series%201',
            expectedSource: 'jellyfin-fallback',
            item: { Id: 'series 1', Type: 'Series' },
            name: 'Series Open'
        },
        {
            expectedHref: '#/music/item/song%201',
            expectedSource: 'ptv-music',
            item: { Id: 'song 1', MediaType: 'Audio', Type: 'Audio' },
            name: 'Song Play'
        },
        {
            expectedHref: '#/music/album/album%201',
            expectedSource: 'ptv-music',
            item: { Id: 'album 1', Type: 'MusicAlbum' },
            name: 'Album Open'
        },
        {
            expectedHref: '#/music/artist/artist%201',
            expectedSource: 'ptv-music',
            item: { Id: 'artist 1', Type: 'MusicArtist' },
            name: 'Artist Open'
        },
        {
            expectedHref: '#/books/item/book%201',
            expectedSource: 'ptv-reading',
            item: { CollectionType: 'books', Id: 'book 1', Type: 'Book' },
            name: 'Book Open'
        },
        {
            expectedHref: '#/comics/item/comic%201',
            expectedSource: 'ptv-reading',
            item: { Container: 'cbz', Id: 'comic 1', Type: 'Book' },
            name: 'Comic Open'
        },
        {
            expectedHref: '#/manga/item/manga%201',
            expectedSource: 'ptv-reading',
            item: { Id: 'manga 1', Name: 'Manga Volume 1', Type: 'Book' },
            name: 'Manga Open'
        },
        {
            expectedHref: '#/details?id=collection%201',
            expectedSource: 'jellyfin-fallback',
            item: { Id: 'collection 1', Type: 'BoxSet' },
            name: 'Collection Open'
        }
    ] as const;

    it.each(cases)('$name resolves to the expected route', testCase => {
        const route = resolvePtvItemRoute(testCase.item);

        expect(route.href).toBe(testCase.expectedHref);
        expect(route.routeSource).toBe(testCase.expectedSource);
        expect(route.href).not.toContain('#/playback');
    });

    it('keeps core shell routes out of the removed playback route', () => {
        expect(PTV_ROUTES.request).toBe('#/requests');
        expect(PTV_ROUTES.profilePreferences).toBe('#/mypreferencesmenu');
        const routeValues = Object.keys(PTV_ROUTES).map(key => PTV_ROUTES[key as keyof typeof PTV_ROUTES]);

        expect(routeValues).not.toContain('#/playback');
    });

    it('retains one privacy-safe legacy route event for the migrated details action', () => {
        observabilityMocks.shouldCollectDiagnostics.mockReturnValueOnce(true);
        const item = {
            Id: 'private-media-id',
            Name: 'Private Media Title',
            Type: 'Movie'
        };
        const route = resolvePtvItemRoute(item);

        recordPtvItemRouteClick(item, route, {
            action: 'open-card',
            privacySafeDiagnostics: true,
            rowId: 'private-row-id',
            rowTitle: 'Private Row Title',
            source: 'native-home-card'
        });

        expect(observabilityMocks.recordPtvEvent).toHaveBeenCalledTimes(1);
        expect(observabilityMocks.recordPtvEvent).toHaveBeenCalledWith(
            'route',
            'ptv-item-route-click',
            expect.objectContaining({
                action: 'open-card',
                hasItemId: true,
                routeSource: 'jellyfin-fallback',
                source: 'native-home-card'
            })
        );
        const serializedEvent = JSON.stringify(observabilityMocks.recordPtvEvent.mock.calls);
        expect(serializedEvent).not.toContain('private-media-id');
        expect(serializedEvent).not.toContain('Private Media Title');
        expect(serializedEvent).not.toContain('private-row-id');
        expect(serializedEvent).not.toContain('Private Row Title');
    });
});
