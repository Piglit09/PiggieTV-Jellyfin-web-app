import { describe, expect, it } from 'vitest';

import {
    createPtvAdminNavigationGroups,
    getAdminLiveTvQueryKey
} from './adminNavigation';

describe('PTV administration navigation availability', () => {
    it('keeps Live TV destinations while server support is available or unknown', () => {
        expect(createPtvAdminNavigationGroups([], true).some(group => group.category.id === 'livetv')).toBe(true);
        expect(createPtvAdminNavigationGroups().some(group => group.category.id === 'livetv')).toBe(true);
    });

    it('hides the Live TV group when the server explicitly reports it disabled', () => {
        expect(createPtvAdminNavigationGroups([], false).some(group => group.category.id === 'livetv')).toBe(false);
    });

    it('isolates Live TV availability cache entries by active server', () => {
        expect(getAdminLiveTvQueryKey('server-a')).toEqual([
            'PtvAdminNavigation',
            'server-a',
            'LiveTvInfo'
        ]);
        expect(getAdminLiveTvQueryKey('server-a')).not.toEqual(getAdminLiveTvQueryKey('server-b'));
    });
});
