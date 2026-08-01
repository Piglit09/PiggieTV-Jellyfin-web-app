import { describe, expect, it } from 'vitest';

import {
    applyPtvRecommendationFeedback,
    filterAndDedupePtvRecommendationRows,
    filterPtvHeroItemsByFeedback,
    filterPtvRecommendationCandidates,
    MAX_PTV_RECOMMENDATION_FEEDBACK_ENTRIES,
    MAX_PTV_RECOMMENDATION_FEEDBACK_TERMS,
    normalizePtvRecommendationFeedbackState,
    resetPtvRecommendationFeedback,
    undoPtvRecommendationFeedback
} from './recommendationFeedback';
import type {
    PtvRecommendationFeedbackState,
    PtvRecommendationItem,
    PtvRecommendationRow,
    PtvRecommendationScore
} from '../types/recommendationTypes';

function item(
    Id: string,
    options: {
        genres?: string[];
        likes?: boolean;
        mediaType?: string;
        played?: boolean;
    } = {}
) {
    return {
        Genres: options.genres,
        Id,
        Name: Id,
        Type: options.mediaType || 'Movie',
        UserData: {
            Likes: options.likes,
            Played: options.played
        }
    } as PtvRecommendationItem;
}

function score(value: PtvRecommendationItem): PtvRecommendationScore {
    return {
        affinityScore: 50,
        discoveryWeight: 50,
        item: value,
        mediaType: 'movie',
        reasons: [],
        score: 50,
        source: 'test'
    };
}

function row(id: string, ...items: PtvRecommendationItem[]): PtvRecommendationRow {
    return {
        explanation: id,
        id,
        items: items.map(score),
        title: id
    };
}

describe('recommendation feedback', () => {
    it('normalizes invalid data, unique item IDs, bounded terms, and bounded history', () => {
        const normalized = normalizePtvRecommendationFeedbackState({
            entries: [
                ...Array.from({
                    length: MAX_PTV_RECOMMENDATION_FEEDBACK_ENTRIES + 30
                }, (_, index) => ({
                    action: 'not-interested',
                    createdAt: index,
                    itemId: `item-${index}`,
                    terms: Array.from({
                        length: MAX_PTV_RECOMMENDATION_FEEDBACK_TERMS + 10
                    }, (_unused, termIndex) => `Term ${termIndex}`)
                })),
                {
                    action: 'invalid',
                    itemId: 'invalid'
                },
                {
                    action: 'hide-from-home',
                    itemId: 'item-0'
                }
            ],
            undoStack: 'invalid'
        });

        expect(normalized.entries).toHaveLength(MAX_PTV_RECOMMENDATION_FEEDBACK_ENTRIES);
        expect(normalized.entries[0].terms).toHaveLength(MAX_PTV_RECOMMENDATION_FEEDBACK_TERMS);
        expect(new Set(normalized.entries.map(entry => entry.itemId)).size).toBe(normalized.entries.length);
        expect(normalized.undoStack).toEqual([]);
    });

    it('supports replacement, multi-step undo, and reset', () => {
        const first = applyPtvRecommendationFeedback(resetPtvRecommendationFeedback(), {
            action: 'not-interested',
            itemId: 'item-a',
            now: 10
        });
        const second = applyPtvRecommendationFeedback(first, {
            action: 'hide-from-home',
            itemId: 'item-a',
            now: 20
        });

        expect(second.entries[0].action).toBe('hide-from-home');
        expect(undoPtvRecommendationFeedback(second).entries[0].action).toBe('not-interested');
        expect(undoPtvRecommendationFeedback(undoPtvRecommendationFeedback(second)).entries).toEqual([]);
        expect(resetPtvRecommendationFeedback()).toEqual({
            entries: [],
            undoStack: []
        });
    });

    it('filters feedback, matching show-fewer terms, dislikes, and completed items while preserving order', () => {
        const feedback: PtvRecommendationFeedbackState = {
            entries: [
                {
                    action: 'not-interested',
                    createdAt: 1,
                    itemId: 'hidden',
                    terms: []
                },
                {
                    action: 'show-fewer-like-this',
                    createdAt: 2,
                    itemId: 'seed',
                    terms: ['drama']
                }
            ],
            undoStack: []
        };
        const candidates = [
            item('keep-a', { genres: ['Comedy'] }),
            item('hidden', { genres: ['Comedy'] }),
            item('same-term', { genres: ['Drama'] }),
            item('completed', { genres: ['Comedy'], played: true }),
            item('disliked', { genres: ['Comedy'], likes: false }),
            item('replayable', { genres: ['Comedy'], mediaType: 'Audio', played: true }),
            item('keep-b', { genres: ['Documentary'] })
        ];

        expect(filterPtvRecommendationCandidates(candidates, feedback).map(candidate => candidate.Id)).toEqual([
            'keep-a',
            'replayable',
            'keep-b'
        ]);
    });

    it('removes hidden and repeated items from nearby rows with stable surviving order', () => {
        const feedback = applyPtvRecommendationFeedback(resetPtvRecommendationFeedback(), {
            action: 'hide-from-home',
            itemId: 'hidden',
            now: 1
        });
        const rows = filterAndDedupePtvRecommendationRows([
            row('row-1', item('a'), item('b')),
            row('row-2', item('b'), item('c'), item('hidden'), item('d')),
            row('row-3', item('a'), item('e')),
            row('row-4', item('a'), item('f'))
        ], feedback, {
            nearbyRowWindow: 2
        });

        expect(rows.map(value => value.items.map(entry => entry.item.Id))).toEqual([
            ['a', 'b'],
            ['c', 'd'],
            ['e'],
            ['a', 'f']
        ]);
    });

    it('removes feedback items from hero candidates without changing relative order', () => {
        const feedback = applyPtvRecommendationFeedback(resetPtvRecommendationFeedback(), {
            action: 'not-interested',
            itemId: 'b',
            now: 1
        });

        expect(filterPtvHeroItemsByFeedback([
            item('a'),
            item('b'),
            item('c')
        ], feedback).map(value => value.Id)).toEqual(['a', 'c']);
    });
});
