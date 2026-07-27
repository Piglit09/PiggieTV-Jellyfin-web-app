import { describe, expect, it } from 'vitest';

import { normalizePtvRecommendationResponse } from './recommendationContracts';

const defaults = {
    cacheVersion: 7,
    generatedAt: 1_753_188_400_000,
    serverId: 'server-1',
    userId: 'user-1'
};

describe('PTV Core recommendation contracts', () => {
    it('normalizes current camelCase score wrappers', () => {
        const result = normalizePtvRecommendationResponse({
            cacheVersion: 7,
            contractVersion: '1.0',
            generatedAt: '2026-07-22T12:00:00.000Z',
            rows: [{
                explanation: 'Matches your genres',
                id: 'because-genres',
                items: [{
                    affinityScore: 4,
                    discoveryWeight: 1,
                    item: {
                        Id: 'item-1',
                        Name: 'Example',
                        Type: 'Movie'
                    },
                    reasons: [{ label: 'Science fiction', score: 4 }],
                    score: 8,
                    source: 'history'
                }],
                mediaType: 'movie',
                title: 'Because you watched'
            }],
            serverId: 'server-1',
            userId: 'user-1'
        });

        expect(result).toMatchObject({
            success: true,
            value: {
                rows: [{
                    id: 'because-genres',
                    items: [{
                        classification: 'mixed',
                        id: 'item-1',
                        mediaType: 'movie',
                        reasons: [{ score: 4, text: 'Science fiction' }],
                        score: 8,
                        source: 'history',
                        title: 'Example'
                    }]
                }]
            }
        });
    });

    it('accepts PascalCase Row Builder responses and explicit legacy defaults', () => {
        const result = normalizePtvRecommendationResponse({
            GeneratedAt: 1_753_188_400_000,
            Rows: [{
                Items: [{
                    Id: 'book-1',
                    Name: 'Book',
                    PtvRecommendationReasonText: 'Same author',
                    Type: 'Book'
                }],
                MediaType: 'book',
                RowId: 'books',
                RowTitle: 'For readers',
                SourceType: 'row-builder'
            }]
        }, defaults);

        expect(result).toMatchObject({
            success: true,
            value: {
                cacheVersion: 7,
                contractVersion: '1.0',
                rows: [{
                    id: 'books',
                    items: [{
                        id: 'book-1',
                        mediaType: 'book',
                        reasons: [{ text: 'Same author' }]
                    }],
                    source: 'row-builder'
                }],
                serverId: 'server-1',
                userId: 'user-1'
            }
        });
    });

    it('keeps empty rows, drops invalid nested items, and generates stable legacy row IDs', () => {
        const payload = {
            rows: [{
                items: [{ Name: 'Missing ID' }, null],
                title: 'Empty but intentional'
            }]
        };
        const first = normalizePtvRecommendationResponse(payload, defaults);
        const second = normalizePtvRecommendationResponse(payload, defaults);

        expect(first).toMatchObject({
            success: true,
            value: { rows: [{ items: [] }] }
        });
        if (!first.success || !second.success) throw new Error('Expected normalized responses.');
        expect(first.value.rows[0].id).toBe(second.value.rows[0].id);
    });

    it('rejects invalid responses, versions, scope, rows, and cache versions', () => {
        expect(normalizePtvRecommendationResponse(null, defaults)).toMatchObject({
            error: { code: 'RECOMMENDATION_RESPONSE_INVALID' },
            success: false
        });
        expect(normalizePtvRecommendationResponse({
            contractVersion: '2.0',
            rows: []
        }, defaults)).toMatchObject({
            error: { code: 'RECOMMENDATION_CONTRACT_VERSION_MISMATCH' },
            success: false
        });
        expect(normalizePtvRecommendationResponse({ rows: [] })).toMatchObject({
            error: { code: 'RECOMMENDATION_SCOPE_REQUIRED' },
            success: false
        });
        expect(normalizePtvRecommendationResponse({ rows: null }, defaults)).toMatchObject({
            error: { code: 'RECOMMENDATION_ROWS_REQUIRED' },
            success: false
        });
        expect(normalizePtvRecommendationResponse({
            cacheVersion: 0,
            rows: []
        }, defaults)).toMatchObject({
            error: { code: 'RECOMMENDATION_CACHE_VERSION_INVALID' },
            success: false
        });
    });
});
