import { describe, expect, it } from 'vitest';

import type {
    PtvRecommendationRow,
    PtvRecommendationScore
} from '../../modules/recommendations/types/recommendationTypes';
import type { PtvItem } from '../../api';
import type { NativeHomeRow } from './hooks';
import {
    createNativeHomePersonalizedRows,
    mergeNativeHomePersonalizedRows,
    prioritizeNativeHomePersonalizedHeroItems
} from './personalizedHomeRows';

function score(id: string, options: Partial<PtvItem> = {}): PtvRecommendationScore {
    return {
        affinityScore: 80,
        discoveryWeight: 20,
        item: {
            Id: id,
            Name: id,
            Type: 'Movie',
            ...options
        },
        mediaType: 'movie',
        reasons: [],
        score: 80,
        source: 'profile'
    };
}

function recommendationRow(id: string, itemIds: string[]): PtvRecommendationRow {
    return {
        explanation: `${id} explanation`,
        id,
        items: itemIds.map(itemId => score(itemId)),
        mediaType: 'movie',
        title: id
    };
}

function homeRow(id: string, source: NativeHomeRow['source'] = 'featured-cache'): NativeHomeRow {
    return {
        id,
        items: [score(`${id}-item`).item],
        kind: 'items',
        source,
        subtitle: '',
        title: id
    };
}

describe('personalized Home rows', () => {
    it('selects the cohesive flagship row slice in stable order', () => {
        const rows = createNativeHomePersonalizedRows({
            rows: [
                recommendationRow('ptv-discovery', ['discovery']),
                recommendationRow('rediscover', ['rediscover']),
                recommendationRow('because-you-watched', ['watched']),
                recommendationRow('recommended-for-you', ['recommended']),
                recommendationRow('recommended-movies', ['movie'])
            ]
        });

        expect(rows.map(row => row.id)).toEqual([
            'personalized-recommended-for-you',
            'personalized-because-you-watched',
            'personalized-ptv-discovery',
            'personalized-rediscover'
        ]);
        expect(rows.every(row => row.source === 'recommendation')).toBe(true);
    });

    it('keeps aggregate discovery evidence bounded and omits empty rows', () => {
        const rows = createNativeHomePersonalizedRows({
            rows: [
                recommendationRow('recommended-for-you', []),
                recommendationRow('ptv-discovery', ['discovery'])
            ]
        });

        expect(rows.map(row => row.id)).toEqual(['personalized-ptv-discovery']);
    });

    it('inserts personalized rows after continuation and replaces matching generated rows', () => {
        const existing = homeRow('existing-recommendation', 'recommendation');
        existing.sourceRecommendationId = 'recommended-for-you';
        const personalized = createNativeHomePersonalizedRows({
            rows: [recommendationRow('recommended-for-you', ['new'])]
        });
        const merged = mergeNativeHomePersonalizedRows([
            homeRow('resume', 'resume'),
            existing,
            homeRow('recent')
        ], personalized);

        expect(merged.map(row => row.id)).toEqual([
            'resume',
            'personalized-recommended-for-you',
            'recent'
        ]);
    });

    it('prioritizes personalized artwork without repeating hero items', () => {
        const personalized = createNativeHomePersonalizedRows({
            rows: [{
                ...recommendationRow('recommended-for-you', []),
                items: [
                    score('no-art'),
                    score('hero-a', { BackdropImageTags: ['tag'] }),
                    score('hero-b', { ImageTags: { Primary: 'tag' } })
                ]
            }]
        });
        const items = prioritizeNativeHomePersonalizedHeroItems(personalized, [
            { Id: 'hero-a', Name: 'duplicate' },
            { Id: 'hero-c', Name: 'existing' }
        ]);

        expect(items.map(item => item.Id)).toEqual(['hero-a', 'hero-b', 'hero-c']);
    });
});
