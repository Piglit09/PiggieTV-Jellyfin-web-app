import { afterEach, describe, expect, it } from 'vitest';

import {
    normalizePtvLibraryItems,
    normalizePtvLibraryRoot,
    resetPtvLibraryRootNormalizerForTests
} from './libraryRootNormalizer';

describe('libraryRootNormalizer', () => {
    afterEach(() => resetPtvLibraryRootNormalizerForTests());

    it('groups equivalent mergerfs, bind-mount, SMB, and Windows movie roots', () => {
        const paths = [
            '/media/Movies/Toy Story 4.mkv',
            '/media-local/Movies/Toy Story 5.mkv',
            '/mnt/L/Movies/Toy Story 3.mkv',
            '\\\\nas\\media\\Movies\\Toy Story 2.mkv',
            'D:\\Movies\\Toy Story 1.mkv'
        ];

        expect(paths.map(Path => normalizePtvLibraryRoot({ Path }).logicalRoot)).toEqual([
            'Movies', 'Movies', 'Movies', 'Movies', 'Movies'
        ]);
    });

    it('retains stable Jellyfin identity while using the logical root for grouping', () => {
        expect(normalizePtvLibraryRoot({
            CollectionType: 'movies',
            Path: '/media-local/Movies/Toy Story 5.mkv',
            TopParentId: 'movies-library'
        })).toMatchObject({ libraryId: 'movies-library', logicalRoot: 'Movies' });
    });

    it('never deduplicates distinct items solely because their names match', () => {
        const normalized = normalizePtvLibraryItems([
            { Id: 'toy-story-5', Name: 'Toy Story', Path: '/media-local/Movies/Toy Story 5.mkv' },
            { Id: 'toy-story-5', Name: 'Toy Story duplicate', Path: '/media/Movies/Toy Story 5.mkv' },
            { Name: 'Toy Story', Path: '/mnt/L/Movies/Toy Story 4.mkv' },
            { Name: 'Toy Story', Path: '/mnt/L/Movies/Toy Story 3.mkv' }
        ]);

        expect(normalized.items).toHaveLength(3);
        expect(normalized.diagnostics.deduplicatedCount).toBe(1);
        expect(normalized.diagnostics.groups).toEqual([
            expect.objectContaining({ logicalRoot: 'Movies' })
        ]);
    });
});
