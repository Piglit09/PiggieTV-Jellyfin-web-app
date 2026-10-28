import { describe, expect, it } from 'vitest';

import type { PtvLibrary, PtvUser } from '../api/types';
import { derivePtvNavigationAccess } from './navigationAccess';

const restrictedUser: PtvUser = { Id: 'restricted-user', Policy: { IsAdministrator: false } };

function view(id: string, name: string, collectionType: string): PtvLibrary {
    return { CollectionType: collectionType, Id: id, Name: name, Type: 'UserView' };
}

describe('permission-aware navigation access', () => {
    it('fails closed when the authenticated user has no views', () => {
        expect(derivePtvNavigationAccess([], restrictedUser)).toEqual({
            movies: [],
            shows: [],
            music: [],
            reading: [],
            collections: false,
            isAdmin: false,
            liveTv: false
        });
    });

    it('never infers Shows or other media access from a Movies view', () => {
        const access = derivePtvNavigationAccess([
            view('movie-view', 'Movies', 'movies')
        ], restrictedUser);

        expect(access.movies).toEqual([{ id: 'movie-view', name: 'Movies', kind: 'movies' }]);
        expect(access.shows).toEqual([]);
        expect(access.music).toEqual([]);
        expect(access.reading).toEqual([]);
        expect(access.collections).toBe(false);
    });

    it('separates anime movies and cartoons using names within their authorized types', () => {
        const access = derivePtvNavigationAccess([
            view('ani-movie-view', 'AniMovies Library', 'movies'),
            view('cartoon-view', 'Cartoons Library', 'tvshows')
        ], restrictedUser);

        expect(access.movies).toEqual([
            { id: 'ani-movie-view', name: 'AniMovies Library', kind: 'animeMovies' }
        ]);
        expect(access.shows).toEqual([
            { id: 'cartoon-view', name: 'Cartoons Library', kind: 'cartoons' }
        ]);
    });

    it('shows only the accessible Reading subtype and treats ordinary books separately', () => {
        const access = derivePtvNavigationAccess([
            view('manga-view', 'Manga', 'books'),
            view('comic-view', 'Comic Books', 'books'),
            view('book-view', 'Novels', 'books')
        ], restrictedUser);

        expect(access.reading).toEqual([
            { id: 'manga-view', name: 'Manga', kind: 'manga' },
            { id: 'comic-view', name: 'Comic Books', kind: 'comics' },
            { id: 'book-view', name: 'Novels', kind: 'books' }
        ]);
        expect(access.movies).toEqual([]);
    });

    it('retains multiple authorized views of the same type and deduplicates their IDs', () => {
        const access = derivePtvNavigationAccess([
            view('movies-1', 'Movies', 'movies'),
            view('movies-2', 'Family Movies', 'movies'),
            view('MOVIES-1', 'Duplicate', 'movies'),
            view('shows-1', 'Shows', 'tvshows'),
            view('anime-1', 'Anime', 'tvshows'),
            view('music-1', 'Music', 'music'),
            view('music-2', 'Concerts', 'music'),
            view('collection-1', 'Collections', 'boxsets')
        ], restrictedUser);

        expect(access.movies).toEqual([
            { id: 'movies-1', name: 'Movies', kind: 'movies' },
            { id: 'movies-2', name: 'Family Movies', kind: 'movies' }
        ]);
        expect(access.shows).toEqual([
            { id: 'shows-1', name: 'Shows', kind: 'shows' },
            { id: 'anime-1', name: 'Anime', kind: 'anime' }
        ]);
        expect(access.music).toEqual([
            { id: 'music-1', name: 'Music' },
            { id: 'music-2', name: 'Concerts' }
        ]);
        expect(access.collections).toBe(true);
    });

    it('never treats a name, path, or unsupported collection type as membership evidence', () => {
        const access = derivePtvNavigationAccess([
            view('music-1', 'Movies', 'music'),
            view('book-1', 'Anime', 'books'),
            view('movie-1', 'Comic Books', 'movies'),
            { Id: 'folder-1', Name: 'Cartoons', Path: 'F:/Cartoons', Type: 'CollectionFolder' },
            view('photos-1', 'Shows', 'photos'),
            view('', 'Shows', 'tvshows'),
            view('   ', 'Movies', 'movies')
        ], restrictedUser);

        expect(access.movies).toEqual([{ id: 'movie-1', name: 'Comic Books', kind: 'movies' }]);
        expect(access.shows).toEqual([]);
        expect(access.music).toEqual([{ id: 'music-1', name: 'Movies' }]);
        expect(access.reading).toEqual([{ id: 'book-1', name: 'Anime', kind: 'books' }]);
    });

    it('uses only an explicit administrator policy for admin navigation', () => {
        const views = [view('movie-1', 'Movies', 'movies')];

        expect(derivePtvNavigationAccess(views, { Id: 'admin', Policy: { IsAdministrator: true } }).isAdmin)
            .toBe(true);
        expect(derivePtvNavigationAccess(views, { Id: 'named-admin', Name: 'Admin' }).isAdmin)
            .toBe(false);
    });

    it('uses the current user policy to authorize Live TV navigation', () => {
        const views = [view('movie-1', 'Movies', 'movies')];

        expect(derivePtvNavigationAccess(views, restrictedUser).liveTv).toBe(false);
        expect(derivePtvNavigationAccess(views, {
            Id: 'live-tv-user',
            Policy: { EnableLiveTvAccess: true, IsAdministrator: false }
        }).liveTv).toBe(true);
    });
});
