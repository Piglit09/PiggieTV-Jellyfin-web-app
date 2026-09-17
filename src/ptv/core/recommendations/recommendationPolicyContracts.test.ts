import { describe, expect, it } from 'vitest';

import {
    isPtvRecommendationPolicyResponse,
    PTV_RECOMMENDATION_SURFACE_POLICIES
} from './recommendationPolicyContracts';

function createValidResponse(overrides: Record<string, unknown> = {}) {
    return {
        algorithmId: 'ptv-diversified-sequence-v2',
        cohort: 'dev',
        constraints: PTV_RECOMMENDATION_SURFACE_POLICIES.radio,
        contractVersion: '2.0',
        generatedAt: '2026-08-08T00:00:00Z',
        generationLatencyMs: 12,
        items: [{
            classification: 'discovery',
            futureItemSignal: 0.5,
            id: 'track-1',
            mediaType: 'Audio',
            rank: 1,
            reasons: [ 'seed-genre' ],
            score: 0.82,
            source: 'jellyfin-music-library',
            title: 'Track One',
            transitionScore: 0.15
        }],
        policyVersion: 'music-premium-v2',
        requestId: 'request-1',
        surface: 'radio',
        ...overrides
    };
}

describe('recommendation policy v2 contracts', () => {
    it('uses context-specific familiar and discovery targets with strict diversity caps', () => {
        expect(PTV_RECOMMENDATION_SURFACE_POLICIES['made-for-you']).toMatchObject({
            discoveryTarget: 0.3,
            familiarTarget: 0.7,
            maxConsecutiveArtist: 2
        });
        expect(PTV_RECOMMENDATION_SURFACE_POLICIES.discovery).toMatchObject({
            discoveryTarget: 0.8,
            familiarTarget: 0.2,
            maxItemsPerAlbum: 1
        });
    });

    it('accepts a complete V2 response and ignores additive fields', () => {
        const response = createValidResponse({ futureDiagnostic: 'supported' });

        expect(isPtvRecommendationPolicyResponse(response, {
            requestId: 'request-1',
            surface: 'radio'
        })).toBe(true);
        expect(isPtvRecommendationPolicyResponse({ contractVersion: '1.0' })).toBe(false);
    });

    it.each([
        [ 'policy', { policyVersion: 'music-premium-v3' } ],
        [ 'algorithm', { algorithmId: 'some-other-ranker' } ],
        [ 'surface', { surface: 'music' } ],
        [ 'timestamp', { generatedAt: 'not-a-date' } ],
        [ 'negative latency', { generationLatencyMs: -1 } ],
        [ 'non-finite latency', { generationLatencyMs: Number.POSITIVE_INFINITY } ]
    ])('rejects an invalid %s boundary field', (_field, overrides) => {
        expect(isPtvRecommendationPolicyResponse(createValidResponse(overrides))).toBe(false);
    });

    it('rejects responses that do not match the originating request', () => {
        const response = createValidResponse();

        expect(isPtvRecommendationPolicyResponse(response, { requestId: 'another-request' })).toBe(false);
        expect(isPtvRecommendationPolicyResponse(response, { surface: 'discovery' })).toBe(false);
    });

    it.each([
        [ 'non-finite target', { discoveryTarget: Number.NaN } ],
        [ 'out-of-range target', { familiarTarget: 1.5 } ],
        [ 'fractional cap', { maxItemsPerArtist: 1.5 } ],
        [ 'zero cap', { maxConsecutiveAlbum: 0 } ]
    ])('rejects constraints with an invalid %s', (_field, constraintOverrides) => {
        expect(isPtvRecommendationPolicyResponse(createValidResponse({
            constraints: {
                ...PTV_RECOMMENDATION_SURFACE_POLICIES.radio,
                ...constraintOverrides
            }
        }))).toBe(false);
    });

    it.each([
        [ 'missing fields', {} ],
        [ 'empty id', { id: '' } ],
        [ 'unknown classification', { classification: 'popular' } ],
        [ 'invalid rank', { rank: 0 } ],
        [ 'non-finite score', { score: Number.NaN } ],
        [ 'non-finite transition', { transitionScore: Number.POSITIVE_INFINITY } ],
        [ 'invalid reasons', { reasons: [ '' ] } ]
    ])('rejects a ranked item with %s', (_field, item) => {
        expect(isPtvRecommendationPolicyResponse(createValidResponse({ items: [ item ] }))).toBe(false);
    });
});
