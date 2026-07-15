import { describe, expect, it } from 'vitest';

import {
    filterPtvBrowseDirectoryEntries,
    getPtvBrowseDirectoryComparisonKey,
    groupPtvBrowseDirectoryEntries,
    mergePtvBrowseDirectoryRecents
} from './browseDirectoryModel';

const ENTRIES = [
    { count: 4, id: 'one', name: 'Action' },
    { count: 0, id: 'two', name: 'Anime' },
    { count: 2, id: 'three', name: 'Science Fiction' },
    { count: 1, id: 'four', name: 'Épopée' }
];

describe('browse directory model', () => {
    it('normalizes equivalent comparison values deterministically', () => {
        expect(getPtvBrowseDirectoryComparisonKey('  Science   Fiction ')).toBe('science fiction');
        expect(getPtvBrowseDirectoryComparisonKey('ＡＮＩＭＥ')).toBe('anime');
    });

    it('filters by query without hiding empty categories by default', () => {
        expect(filterPtvBrowseDirectoryEntries(ENTRIES, {
            hideEmpty: false,
            query: 'ani'
        })).toEqual([ENTRIES[1]]);
    });

    it('hides empty categories only when requested', () => {
        expect(filterPtvBrowseDirectoryEntries(ENTRIES, {
            hideEmpty: true,
            query: ''
        })).not.toContain(ENTRIES[1]);
    });

    it('groups entries alphabetically', () => {
        expect(groupPtvBrowseDirectoryEntries(ENTRIES).map(section => section.letter)).toEqual([
            'A',
            'P',
            'S'
        ]);
    });

    it('keeps recent values unique and bounded', () => {
        expect(mergePtvBrowseDirectoryRecents([
            'Action',
            'Drama',
            'Comedy'
        ], ' action ', 2)).toEqual([
            'action',
            'Drama'
        ]);
    });
});
