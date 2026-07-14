import { describe, expect, it } from 'vitest';

import {
    buildPtvGenreDirectoryGroups,
    getPtvGenreDisplayName,
    groupPtvGenreDirectoryAlphabetically
} from './genreDirectory';

describe('genreDirectory', () => {
    it('normalizes presentation casing while preserving the original query value', () => {
        const groups = buildPtvGenreDirectoryGroups([
            { count: 4, id: 'horror-id', name: 'hORROR' },
            { count: 2, id: 'tv-id', name: 'tv movie' }
        ], { includeSensitive: true });

        expect(groups.map(group => group.displayName)).toEqual(['Horror', 'TV Movie']);
        expect(groups[0].entries[0].name).toBe('hORROR');
    });

    it('deduplicates only case-insensitive exact matches', () => {
        const groups = buildPtvGenreDirectoryGroups([
            { count: 2, id: 'first', name: 'Crime' },
            { count: 7, id: 'second', name: 'crime' },
            { count: 1, id: 'third', name: 'Crime Drama' }
        ], { includeSensitive: true });

        expect(groups).toHaveLength(2);
        expect(groups.find(group => group.displayName === 'Crime')?.entries).toEqual([
            { count: 7, id: 'second', name: 'crime' }
        ]);
        expect(groups.find(group => group.displayName === 'Crime Drama')).toBeTruthy();
    });

    it('uses explicit presentation merges without losing exact Jellyfin values', () => {
        const groups = buildPtvGenreDirectoryGroups([
            { count: 3, id: 'sci-fi', name: 'Sci-Fi' },
            { count: 5, id: 'science-fiction', name: 'Science Fiction' },
            { count: 1, id: 'not-fuzzy', name: 'Science Fictional' }
        ], { includeSensitive: true });
        const scienceFiction = groups.find(group => group.displayName === 'Science Fiction');

        expect(scienceFiction?.entries.map(entry => entry.name)).toEqual(['Sci-Fi', 'Science Fiction']);
        expect(groups.find(group => group.displayName === 'Science Fictional')).toBeTruthy();
    });

    it('hides sensitive metadata values in curated mode and exposes them in all mode', () => {
        const entries = [
            { count: 3, id: 'drama', name: 'Drama' },
            { count: 2, id: 'adult', name: 'Adult' }
        ];

        expect(buildPtvGenreDirectoryGroups(entries, { includeSensitive: false }).map(group => group.displayName))
            .toEqual(['Drama']);
        expect(buildPtvGenreDirectoryGroups(entries, { includeSensitive: true }).map(group => group.displayName))
            .toEqual(['Adult', 'Drama']);
    });

    it('filters and organizes the directory alphabetically', () => {
        const groups = buildPtvGenreDirectoryGroups([
            { count: 1, id: 'animation', name: 'animation' },
            { count: 1, id: 'horror', name: 'horror' },
            { count: 1, id: 'history', name: 'history' }
        ], { includeSensitive: false, query: 'hi' });

        expect(groups.map(group => group.displayName)).toEqual(['History']);
        expect(groupPtvGenreDirectoryAlphabetically(groups)).toEqual([
            { groups, letter: 'H' }
        ]);
        expect(getPtvGenreDisplayName('action & adventure')).toBe('Action & Adventure');
    });
});
