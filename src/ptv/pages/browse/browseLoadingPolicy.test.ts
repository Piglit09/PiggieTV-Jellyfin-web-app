import { describe, expect, it } from 'vitest';

import {
    getPtvBrowseFeaturedQueryOverrides,
    prioritizePtvBrowseTasks
} from './browseLoadingPolicy';

describe('browseLoadingPolicy', () => {
    it('starts cheap visible content before slower resume and broad browse requests', () => {
        const tasks = prioritizePtvBrowseTasks([
            { id: 'continue' },
            { id: 'browse' },
            { id: 'featured' },
            { id: 'collections' },
            { id: 'recently-added' },
            { id: 'recommendations' }
        ]);

        expect(tasks.map(task => task.id)).toEqual([
            'recently-added',
            'featured',
            'continue',
            'recommendations',
            'browse',
            'collections'
        ]);
    });

    it('avoids an expensive server-side random sort for the featured shelf', () => {
        expect(getPtvBrowseFeaturedQueryOverrides('collections')).toEqual({
            Limit: 20,
            SortBy: 'DateCreated',
            SortOrder: 'Descending'
        });
    });

    it('uses community rating for movie/show featured shelves', () => {
        expect(getPtvBrowseFeaturedQueryOverrides('movies')).toEqual({
            Limit: 20,
            SortBy: 'CommunityRating',
            SortOrder: 'Descending'
        });

        expect(getPtvBrowseFeaturedQueryOverrides('shows')).toEqual({
            Limit: 20,
            SortBy: 'CommunityRating',
            SortOrder: 'Descending'
        });
    });
});
