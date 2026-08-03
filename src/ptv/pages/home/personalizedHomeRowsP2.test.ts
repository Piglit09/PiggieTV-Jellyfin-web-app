import { describe, expect, it } from 'vitest';

import type { PtvRecommendationHomeData } from '../../modules/recommendations/types/recommendationTypes';
import { createNativeHomePersonalizedRows } from './personalizedHomeRows';

describe('P2 personalized Home row selection', () => {
    it('keeps four subject-specific watched rows in stable priority order', () => {
        const ids = [
            'hidden-gems',
            'because-you-watched-four',
            'ptv-discovery',
            'because-you-watched-two',
            'recommended-for-you',
            'because-you-watched-one',
            'rediscover',
            'because-you-watched-three'
        ];
        const data = {
            rows: ids.map(id => ({
                id,
                items: [ { item: { Id: `item-${id}` } } ],
                mediaType: 'mixed',
                title: id
            }))
        } as unknown as Pick<PtvRecommendationHomeData, 'rows'>;

        expect(createNativeHomePersonalizedRows(data).map(row => row.sourceRecommendationId)).toEqual([
            'recommended-for-you',
            'because-you-watched-four',
            'because-you-watched-two',
            'because-you-watched-one',
            'because-you-watched-three',
            'ptv-discovery',
            'rediscover',
            'hidden-gems'
        ]);
    });
});
