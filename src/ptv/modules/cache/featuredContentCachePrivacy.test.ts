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
});
