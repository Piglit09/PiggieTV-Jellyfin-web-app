import type { PtvItem } from '../../../api';
import {
    filterPtvHeroItemsByFeedback,
    shouldExcludePtvRecommendationItem
} from '../../../modules/recommendations/feedback/recommendationFeedback';
import type {
    PtvRecommendationFeedbackState,
    PtvRecommendationItem
} from '../../../modules/recommendations/types/recommendationTypes';
import type { NativeHomeRow } from '../hooks';

const CONTINUATION_SOURCES = new Set([
    'continue-listening',
    'continue-reading',
    'next-up',
    'resume'
]);

function isContinuationRow(row: NativeHomeRow) {
    if (CONTINUATION_SOURCES.has(row.source)) return true;

    return /\b(?:continue|next up|pick up|resume)\b/i.test(`${row.id} ${row.title}`);
}

function isGeneratedRecommendationRow(row: NativeHomeRow) {
    return row.source === 'recommendation'
        || row.renderedSource === 'recommendation-settings'
        || row.rowType === 'generated-recommendation';
}

function getItemId(item: NativeHomeRow['items'][number]) {
    return typeof item.Id === 'string' ? item.Id.trim() : '';
}

export function filterNativeHomeHeroItems(
    items: PtvItem[],
    feedback: PtvRecommendationFeedbackState
) {
    return filterPtvHeroItemsByFeedback(items, feedback);
}

export function filterNativeHomeRecommendationRows(
    rows: NativeHomeRow[],
    feedback: PtvRecommendationFeedbackState,
    options: {
        nearbyRowWindow?: number;
    } = {}
) {
    const nearbyRowWindow = Math.max(1, Math.min(10, Math.floor(options.nearbyRowWindow ?? 2)));
    const recentRecommendationIds: Array<Set<string>> = [];

    return rows.flatMap(row => {
        if (isContinuationRow(row) || !isGeneratedRecommendationRow(row)) {
            return [row];
        }

        const nearbyIds = new Set(recentRecommendationIds.flatMap(ids => [...ids]));
        let feedbackRemovals = 0;
        let dedupeRemovals = 0;
        const items = row.items.filter(item => {
            const itemId = getItemId(item);

            if (shouldExcludePtvRecommendationItem(item as PtvRecommendationItem, feedback)) {
                feedbackRemovals += 1;
                return false;
            }

            if (itemId && nearbyIds.has(itemId)) {
                dedupeRemovals += 1;
                return false;
            }

            return true;
        });
        const currentIds = new Set(items.map(getItemId).filter(Boolean));

        recentRecommendationIds.push(currentIds);
        if (recentRecommendationIds.length > nearbyRowWindow) recentRecommendationIds.shift();

        if (!items.length) return [];

        return [{
            ...row,
            dedupeRemovals: (row.dedupeRemovals || 0) + dedupeRemovals,
            filteredReason: feedbackRemovals ?
                'recommendation-feedback' :
                row.filteredReason,
            finalRenderedCount: items.length,
            items
        }];
    });
}
