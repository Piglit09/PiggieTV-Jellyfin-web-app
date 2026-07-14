import { describe, expect, it } from 'vitest';

import { getPtvReadingItemKind } from './booksClassification';
import type { PtvReadingItem } from './booksTypes';

function readingItem(extras: Partial<PtvReadingItem>): PtvReadingItem {
    return {
        Id: 'reading-item',
        Name: 'Saki the Succubus Hungers Tonight Vol. 2',
        Type: 'Book',
        ...extras
    } as PtvReadingItem;
}

describe('PTV reading item classification', () => {
    it('does not let a ComicVine result override a Manga library classification', () => {
        const item = readingItem({
            Container: 'cbz',
            Path: '/Manga/Saki the Succubus Hungers Tonight v02.cbz',
            ProviderIds: {
                ComicVine: '4000-790398'
            },
            PtvReadingLibraryKindHint: 'manga'
        });

        expect(getPtvReadingItemKind(item, 'Manga')).toBe('manga');
    });

    it('gives an explicit manual override precedence over the library hint', () => {
        const item = readingItem({
            PtvReadingKindOverride: 'book',
            PtvReadingLibraryKindHint: 'manga'
        });

        expect(getPtvReadingItemKind(item, 'Manga')).toBe('book');
    });
});
