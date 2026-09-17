import { describe, expect, it } from 'vitest';

import {
    createPtvRecommendationIdentity,
    PTV_RECOMMENDATION_CACHE_SCHEMA_VERSION
} from './recommendationIdentity';

describe('recommendation identity', () => {
    it('normalizes server and user scope while preserving request identity', () => {
        const identity = createPtvRecommendationIdentity({
            serverId: ' Server-A ',
            userId: ' User-A '
        });

        expect(identity.cacheKey).toContain(`ptv-recommendations:v${PTV_RECOMMENDATION_CACHE_SCHEMA_VERSION}:server-a:user-a:`);
        expect(identity.serverId).toBe('Server-A');
        expect(identity.userId).toBe('User-A');
    });

    it('changes scope for either a server or user transition', () => {
        const first = createPtvRecommendationIdentity({ serverId: 'server-a', userId: 'user-a' });
        const nextServer = createPtvRecommendationIdentity({ serverId: 'server-b', userId: 'user-a' });
        const nextUser = createPtvRecommendationIdentity({ serverId: 'server-a', userId: 'user-b' });

        expect(nextServer.cacheKey).not.toBe(first.cacheKey);
        expect(nextUser.cacheKey).not.toBe(first.cacheKey);
    });

    it('keys feedback preference state without exposing item identity', () => {
        const base = createPtvRecommendationIdentity({ serverId: 'server-a', userId: 'user-a' });
        const withFeedback = createPtvRecommendationIdentity({
            feedback: {
                entries: [{
                    action: 'not-interested',
                    createdAt: 1,
                    itemId: 'private-item-id',
                    terms: ['Drama']
                }],
                undoStack: []
            },
            serverId: 'server-a',
            userId: 'user-a'
        });

        expect(withFeedback.cacheKey).not.toBe(base.cacheKey);
        expect(withFeedback.cacheKey).not.toContain('private-item-id');
    });

    it('separates primary and expanded source generations', () => {
        const primary = createPtvRecommendationIdentity({ serverId: 'server-a', userId: 'user-a' });
        const expanded = createPtvRecommendationIdentity({
            includeHomeScans: true,
            serverId: 'server-a',
            userId: 'user-a'
        });

        expect(expanded.cacheKey).not.toBe(primary.cacheKey);
        expect(expanded.sourceGeneration).toBe('home-scans-v1');
    });
});
