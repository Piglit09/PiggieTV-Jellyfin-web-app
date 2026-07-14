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
        expect(getPtvBrowseFeaturedQueryOverrides()).toEqual({
            Limit: 20,
            SortBy: 'DateCreated',
            SortOrder: 'Descending'
        });
    });
});
