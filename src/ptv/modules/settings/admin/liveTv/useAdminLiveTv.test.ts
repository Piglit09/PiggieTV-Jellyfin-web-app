import { describe, expect, it } from 'vitest';

import { getAdminLiveTvQueryKeys } from './useAdminLiveTv';

describe('getAdminLiveTvQueryKeys', () => {
    it('isolates every query by server and source', () => {
        const serverA = getAdminLiveTvQueryKeys('server-a');
        const serverB = getAdminLiveTvQueryKeys('server-b');

        expect(serverA.configuration).not.toEqual(serverB.configuration);
        expect(serverA.configuration).not.toEqual(serverA.capability);
        expect(serverA.tunerTypes).not.toEqual(serverA.discovery);
    });

    it('scopes explicit lineup lookups by immutable provider and location inputs', () => {
        const keys = getAdminLiveTvQueryKeys('server-a');

        expect(keys.lineup('Provider-A', 'USA', '60601')).toEqual([
            'PtvAdminLiveTv',
            'server-a',
            'explicit',
            'lineups',
            'provider-a',
            'usa',
            '60601'
        ]);
        expect(keys.lineup('provider-a', 'USA', '60601')).not.toEqual(
            keys.lineup('provider-a', 'USA', '90210')
        );
    });
});
