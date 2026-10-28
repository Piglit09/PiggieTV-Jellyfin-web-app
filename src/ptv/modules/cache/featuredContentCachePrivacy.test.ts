import { describe, expect, it, vi } from 'vitest';

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: () => null,
        getLocalApiClient: () => null
    }
}));

import {
    sanitizeFeaturedPayloadForSharedCache,
    type FeaturedPayload
} from './featuredContentCache';

describe('shared featured cache privacy', () => {
    it('removes user state and generated recommendation labels recursively', () => {
        const payload = sanitizeFeaturedPayloadForSharedCache({
            heroItems: [ {
                Id: 'hero',
                Name: 'Hero',
                PtvHeroRecommendationLabel: 'Because You Watched private title',
                UserData: { IsFavorite: true, PlaybackPositionTicks: 42 }
            } ],
            sections: [ {
                items: [ { Id: 'nested', UserData: { Played: true } } ],
                RecommendationReason: 'private explanation'
            } ],
            sectionItems: {
                featured: [ { Id: 'row', Name: 'Row', UserData: { Played: true } } ]
            }
        } as unknown as FeaturedPayload);

        expect(payload.heroItems).toEqual([ { Id: 'hero', Name: 'Hero' } ]);
        expect(payload.sectionItems.featured).toEqual([ { Id: 'row', Name: 'Row' } ]);
        expect(JSON.stringify(payload)).not.toContain('UserData');
        expect(JSON.stringify(payload)).not.toContain('RecommendationReason');
        expect(JSON.stringify(payload)).not.toContain('PtvHeroRecommendationLabel');
    });

    it('never persists transient library membership proof alongside scope claims', () => {
        const payload = sanitizeFeaturedPayloadForSharedCache({
            scopeSchemaVersion: 2,
            heroItems: [],
            sections: [ {
                id: 'owned', scopeType: 'library', libraryId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                resolvedScopeHash: '12345', topologyEpoch: 'A'.repeat(64), userAccessEpoch: 'B'.repeat(64),
                bindingGeneration: 0, membershipProof: { valid: true },
                provenItemIds: [ 'foreign-item' ]
            } ],
            sectionItems: { owned: [ { Id: 'item', Type: 'Movie' } ] }
        } as FeaturedPayload);

        expect(payload.scopeSchemaVersion).toBe(2);
        expect(payload.sections?.[0]).toMatchObject({ scopeType: 'library', resolvedScopeHash: '12345' });
        expect(JSON.stringify(payload)).not.toContain('membershipProof');
        expect(JSON.stringify(payload)).not.toContain('provenItemIds');
        expect(JSON.stringify(payload)).not.toContain('userAccessEpoch');
    });
});
