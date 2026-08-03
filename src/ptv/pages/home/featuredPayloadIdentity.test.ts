import { describe, expect, it } from 'vitest';

import type { FeaturedPayload } from '../../modules/cache/featuredContentCache';
import {
    getPtvFeaturedPayloadItemIds,
    reconcilePtvFeaturedPayloadForUser
} from './featuredPayloadIdentity';

describe('featured payload identity reconciliation', () => {
    const payload = {
        heroItems: [ { Id: 'allowed', UserData: { Played: true } }, { Id: 'retired' } ],
        sectionItems: { featured: [ { Id: 'retired' }, { Id: 'allowed' } ] },
        sections: [ { items: [ { Id: 'allowed' }, { Id: 'retired' } ] } ]
    } as unknown as FeaturedPayload;

    it('collects bounded candidate identities', () => {
        expect(getPtvFeaturedPayloadItemIds(payload)).toEqual([ 'allowed', 'retired' ]);
        expect(getPtvFeaturedPayloadItemIds(payload, 1)).toEqual([ 'allowed' ]);
    });

    it('drops inaccessible candidates and adopts current-user objects', () => {
        const current = { Id: 'allowed', UserData: { Played: false, IsFavorite: true } };
        const reconciled = reconcilePtvFeaturedPayloadForUser(payload, [ current ]);

        expect(reconciled.heroItems).toEqual([ current ]);
        expect(reconciled.sectionItems.featured).toEqual([ current ]);
        expect((reconciled.sections as Array<{ items: unknown[] }>)[0].items).toEqual([ current ]);
    });
});
