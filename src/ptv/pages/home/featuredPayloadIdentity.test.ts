import { describe, expect, it } from 'vitest';

import type { FeaturedPayload } from '../../modules/cache/featuredContentCache';
import {
    getFeaturedHeroItemsForAccessEpoch,
    getPtvFeaturedPayloadItemIds,
    hasUnprovedOwnedFeaturedCache,
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

    it('requires exact canonical Hero provenance from the final access epoch', () => {
        const current = 'B'.repeat(64);
        const old = 'C'.repeat(64);
        const currentPayload = { ...payload, heroAccessEpoch: current };
        const ambiguousPayload = { ...currentPayload, HeroAccessEpoch: current };

        expect(getFeaturedHeroItemsForAccessEpoch(currentPayload, current)).toEqual(payload.heroItems);
        expect(getFeaturedHeroItemsForAccessEpoch(currentPayload, old)).toEqual([]);
        expect(getFeaturedHeroItemsForAccessEpoch(payload, current)).toEqual([]);
        expect(getFeaturedHeroItemsForAccessEpoch(ambiguousPayload, current)).toEqual([]);
        expect(getFeaturedHeroItemsForAccessEpoch(currentPayload, null)).toEqual([]);
    });

    it('keeps unproved owned candidates separate from independently global rows', () => {
        const access = { version: 1 as const, userId: 'user-a', accessEpoch: 'B'.repeat(64),
            held: false, policyProven: true };
        const global = { ...payload, sections: [ { id: 'global', scopeType: 'global' } ] };
        const owned = { ...payload, sections: [ { id: 'owned', scopeType: 'library',
            userAccessEpoch: 'C'.repeat(64) } ] };

        expect(hasUnprovedOwnedFeaturedCache(global, access, 'user-a')).toBe(false);
        expect(hasUnprovedOwnedFeaturedCache(owned, access, 'user-a')).toBe(true);
        expect(hasUnprovedOwnedFeaturedCache(owned, null, 'user-a')).toBe(true);
        expect(hasUnprovedOwnedFeaturedCache({ ...owned, sections: [ { ...owned.sections[0],
            userAccessEpoch: access.accessEpoch } ] }, access, 'user-a')).toBe(false);
    });
});
