import { describe, expect, it } from 'vitest';

import { getPtvNavigationSections } from './navigation';

const sectionsFor = (access?: unknown) => (
    (getPtvNavigationSections as (value?: unknown) => ReturnType<typeof getPtvNavigationSections>)(access)
);
const itemsFor = (access?: unknown) => sectionsFor(access).flatMap(section => section.items);

const restrictedAccess = {
    collections: false,
    isAdmin: false,
    movies: [{ id: 'anime-movie-id', kind: 'animeMovies', name: 'Ani Movies' }],
    shows: [{ id: 'cartoon-id', kind: 'cartoons', name: 'Cartoons' }],
    music: [],
    reading: []
};

describe('permission-aware navigation registry', () => {
    it('shows Live TV and Guide only when the current user policy enables Live TV', () => {
        const denied = itemsFor({ ...restrictedAccess, liveTv: false });
        expect(denied.filter(item => ['livetv', 'guide'].includes(item.id))).toEqual([]);

        const allowed = itemsFor({ ...restrictedAccess, liveTv: true });
        expect(allowed.filter(item => ['livetv', 'guide'].includes(item.id)).map(item => item.id))
            .toEqual(['livetv', 'guide']);
    });

    it('fails closed for restricted and administrator entries while identity is unresolved', () => {
        const items = itemsFor();
        expect(items.some(item => item.id === 'home')).toBe(true);
        expect(items.some(item => item.id === 'signout')).toBe(true);
        expect(items.filter(item => ['movies', 'shows', 'music', 'reading-library', 'dashboard'].includes(item.id))).toEqual([]);
        expect(items.filter(item => ['livetv', 'guide'].includes(item.id))).toEqual([]);
        expect(sectionsFor().some(section => section.id === 'admin')).toBe(false);
    });

    it('uses only the current user-view IDs for category links', () => {
        const items = itemsFor(restrictedAccess);
        expect(items.some(item => item.href === '#/movies?topParentId=anime-movie-id')).toBe(true);
        expect(items.some(item => item.href === '#/tv?topParentId=cartoon-id')).toBe(true);
        expect(items.some(item => item.href === '#/movies')).toBe(false);
        expect(items.some(item => item.href === '#/tv')).toBe(false);
        expect(items.some(item => item.href === '#/music' || item.href === '#/reading')).toBe(false);
        expect(sectionsFor(restrictedAccess).some(section => section.id === 'admin')).toBe(false);
    });

    it('preserves distinct links for multiple accessible libraries and admin links only for admins', () => {
        const access = {
            ...restrictedAccess,
            isAdmin: true,
            movies: [
                { id: 'movie-1', kind: 'movies', name: 'Movies A' },
                { id: 'movie-2', kind: 'movies', name: 'Movies B' }
            ]
        };
        const items = itemsFor(access);
        expect(items.filter(item => item.href?.startsWith('#/movies?topParentId=')).map(item => item.href))
            .toEqual(['#/movies?topParentId=movie-1', '#/movies?topParentId=movie-2']);
        expect(sectionsFor(access).some(section => section.id === 'admin')).toBe(true);
    });
});
