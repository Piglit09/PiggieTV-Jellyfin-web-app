import { describe, expect, it } from 'vitest';

import { getConfigurationPagesQueryKey, QueryKey } from './queryKey';

describe('configuration page query scope', () => {
    it('isolates configuration-page cache entries by active server', () => {
        const serverA = getConfigurationPagesQueryKey('server-a', true);
        const serverB = getConfigurationPagesQueryKey('server-b', true);

        expect(serverA).toEqual([ QueryKey.ConfigurationPages, 'server-a', true ]);
        expect(serverA).not.toEqual(serverB);
    });
});
