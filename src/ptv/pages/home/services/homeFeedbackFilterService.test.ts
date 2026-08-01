import { describe, expect, it } from 'vitest';

import { applyPtvRecommendationFeedback, resetPtvRecommendationFeedback } from '../../../modules/recommendations/feedback/recommendationFeedback';
import {
    filterNativeHomeHeroItems,
    filterNativeHomeRecommendationRows
} from './homeFeedbackFilterService';
import type { NativeHomeRow } from '../hooks';

function item(Id: string, played = false) {
    return {
        Id,
        Name: Id,
        Type: 'Movie',
        UserData: {
            Played: played
        }
    };
}

function homeRow(
    id: string,
    source: NativeHomeRow['source'],
    items: NativeHomeRow['items'],
    rowType?: NativeHomeRow['rowType']
): NativeHomeRow {
    return {
        id,
        items,
        kind: 'items',
        rowType,
        source,
        subtitle: '',
        title: id
    };
}

describe('Home recommendation feedback filtering', () => {
    it('preserves continuation rows while filtering and deduping generated recommendation rows', () => {
        const feedback = applyPtvRecommendationFeedback(resetPtvRecommendationFeedback(), {
            action: 'not-interested',
            itemId: 'hidden',
            now: 1
        });
        const continuation = homeRow('continue-watching', 'resume', [
            item('hidden'),
            item('completed', true)
        ]);
        const filtered = filterNativeHomeRecommendationRows([
            continuation,
            homeRow('recommendation-a', 'recommendation', [
                item('hidden'),
                item('completed', true),
                item('a'),
                item('b')
            ], 'generated-recommendation'),
            homeRow('recommendation-b', 'recommendation', [
                item('b'),
                item('c')
            ], 'generated-recommendation')
        ], feedback);

        expect(filtered[0]).toBe(continuation);
        expect(filtered[0].items.map(value => value.Id)).toEqual(['hidden', 'completed']);
        expect(filtered[1].items.map(value => value.Id)).toEqual(['a', 'b']);
        expect(filtered[2].items.map(value => value.Id)).toEqual(['c']);
    });

    it('filters hero items immediately without reordering survivors', () => {
        const feedback = applyPtvRecommendationFeedback(resetPtvRecommendationFeedback(), {
            action: 'hide-from-home',
            itemId: 'b',
            now: 1
        });

        expect(filterNativeHomeHeroItems([
            item('a'),
            item('b'),
            item('c')
        ], feedback).map(value => value.Id)).toEqual(['a', 'c']);
    });
});
