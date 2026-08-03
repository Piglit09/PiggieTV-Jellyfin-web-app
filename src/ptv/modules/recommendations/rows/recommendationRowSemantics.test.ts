import { describe, expect, it } from 'vitest';

import type {
    PtvRecommendationMediaType,
    PtvRecommendationScore,
    PtvTasteProfile
} from '../types/recommendationTypes';
import { buildPtvRecommendationRowsWithQuality } from './recommendationRows';

const MEDIA_TYPES: PtvRecommendationMediaType[] = ['movie', 'show', 'anime', 'music', 'book', 'comic', 'manga'];
const WATCHED_MEDIA_TYPES: PtvRecommendationMediaType[] = ['movie', 'show', 'anime'];

function score(id: string, index: number, userSignal: boolean): PtvRecommendationScore {
    return {
        affinityScore: userSignal ? 78 - index : 18,
        discoveryWeight: userSignal ? 52 : 82 - index,
        item: {
            Id: id,
            Name: id,
            Type: 'Movie',
            UserData: {
                PlayCount: 0,
                Played: false
            }
        },
        mediaType: userSignal ?
            WATCHED_MEDIA_TYPES[index % WATCHED_MEDIA_TYPES.length] :
            MEDIA_TYPES[index % MEDIA_TYPES.length],
        reasons: [{
            category: userSignal ? 'cross-media' : 'discovery',
            label: userSignal ? 'history signal' : 'library discovery',
            score: userSignal ? 75 : 40,
            source: userSignal ? 'history' : 'candidate'
        }],
        score: userSignal ? 80 - index : 50 - index,
        source: userSignal ? 'history signal' : 'library discovery'
    };
}

describe('recommendation row semantics', () => {
    it('keeps personalized rows distinct and balances PTV Recommendation inputs', () => {
        const profile = new Proxy({}, { get: () => [] }) as PtvTasteProfile;
        const scores = [
            ...Array.from({ length: 12 }, (_, index) => score(`user-${index}`, index, true)),
            ...Array.from({ length: 12 }, (_, index) => score(`aggregate-${index}`, index, false))
        ];
        const rows = buildPtvRecommendationRowsWithQuality(profile, scores).rows;
        const madeForYou = rows.find(row => row.id === 'recommended-for-you');
        const becauseYouWatched = rows.find(row => row.id === 'because-you-watched');
        const ptvRecommendation = rows.find(row => row.id === 'ptv-discovery');
        const hiddenGems = rows.find(row => row.id === 'hidden-gems');

        expect(madeForYou?.title).toBe('Made For You');
        expect(madeForYou?.items.every(item => item.reasons.some(reason => reason.source === 'history'))).toBe(true);
        expect(becauseYouWatched?.items.every(item => item.reasons.some(reason => reason.source === 'history'))).toBe(true);
        expect(ptvRecommendation?.title).toBe('PTV Recommendation');

        const userCount = ptvRecommendation?.items.filter(item => item.reasons.some(reason => reason.source === 'history')).length || 0;
        const aggregateCount = (ptvRecommendation?.items.length || 0) - userCount;

        expect(userCount).toBeGreaterThan(0);
        expect(aggregateCount).toBeGreaterThan(0);
        expect(Math.abs(userCount - aggregateCount)).toBeLessThanOrEqual(1);
        expect(hiddenGems?.items.every(item => item.item.UserData?.Played !== true)).toBe(true);
    });

    it('does not invent personalized rows without user evidence', () => {
        const profile = new Proxy({}, { get: () => [] }) as PtvTasteProfile;
        const scores = Array.from({ length: 12 }, (_, index) => score(`aggregate-${index}`, index, false));
        const rowIds = buildPtvRecommendationRowsWithQuality(profile, scores).rows.map(row => row.id);

        expect(rowIds).not.toContain('recommended-for-you');
        expect(rowIds).not.toContain('because-you-watched');
        expect(rowIds).not.toContain('ptv-discovery');
        expect(rowIds).not.toContain('rediscover');
        expect(rowIds).not.toContain('hidden-gems');
    });
});
