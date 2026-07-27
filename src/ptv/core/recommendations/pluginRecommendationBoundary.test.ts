import { describe, expect, it } from 'vitest';

import { normalizePtvPluginRecommendationResponse } from './pluginRecommendationBoundary';

const defaults = {
    cacheVersion: 7,
    generatedAt: '2026-07-22T12:00:00.000Z',
    serverId: 'server',
    userId: 'user'
};

describe('plugin recommendation v1 boundary', () => {
    it('normalizes Row Builder PascalCase while preserving ids, scores, and cache version', () => {
        const payload = {
            CacheVersion: 7,
            Rows: [{
                Items: [{
                    Item: { Id: 'movie-1', Name: 'Movie', Type: 'Movie' },
                    Score: 8.5,
                    Source: 'row-builder'
                }],
                MediaType: 'movie',
                RowId: 'stable-row',
                RowTitle: 'Recommended'
            }]
        };
        const first = normalizePtvPluginRecommendationResponse(payload, defaults);
        const second = normalizePtvPluginRecommendationResponse(payload, defaults);

        expect(first.cacheVersion).toBe(7);
        expect(first.rows[0]).toMatchObject({
            id: 'stable-row',
            items: [{ id: 'movie-1', score: 8.5, source: 'row-builder' }],
            title: 'Recommended'
        });
        expect(second.rows[0].id).toBe(first.rows[0].id);
    });

    it('keeps legacy defaults and camelCase score behavior', () => {
        const response = normalizePtvPluginRecommendationResponse({
            rows: [{
                items: [{
                    affinityScore: 3,
                    discoveryWeight: 2,
                    item: { id: 'book-1', name: 'Book', type: 'Book' },
                    score: 4.25
                }],
                title: 'For readers'
            }]
        }, defaults);

        expect(response).toMatchObject({
            cacheVersion: 7,
            contractVersion: '1.0',
            serverId: 'server',
            userId: 'user',
            rows: [{
                items: [{
                    classification: 'mixed',
                    id: 'book-1',
                    score: 4.25
                }]
            }]
        });
    });
});
