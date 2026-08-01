import type {
    PtvRecommendationFeedbackAction,
    PtvRecommendationFeedbackEntry,
    PtvRecommendationFeedbackState,
    PtvRecommendationFeedbackUndoEntry,
    PtvRecommendationItem,
    PtvRecommendationRow
} from '../types/recommendationTypes';
import { getRecommendationMetadata, normalizeRecommendationTerm } from '../scoring/metadata';

export const MAX_PTV_RECOMMENDATION_FEEDBACK_ENTRIES = 200;
export const MAX_PTV_RECOMMENDATION_FEEDBACK_TERMS = 12;
export const MAX_PTV_RECOMMENDATION_FEEDBACK_UNDO_ENTRIES = 25;

const MAX_ITEM_ID_LENGTH = 256;
const MAX_TERM_LENGTH = 80;
const VALID_ACTIONS = new Set<PtvRecommendationFeedbackAction>([
    'hide-from-home',
    'not-interested',
    'show-fewer-like-this'
]);
const REPLAYABLE_MEDIA_TYPES = new Set([
    'audio',
    'musicalbum',
    'musicartist',
    'musicgenre',
    'playlist'
]);

export const EMPTY_PTV_RECOMMENDATION_FEEDBACK: PtvRecommendationFeedbackState = {
    entries: [],
    undoStack: []
};

type FeedbackItem = Pick<PtvRecommendationItem, 'Id' | 'UserData'> & Partial<PtvRecommendationItem>;

function normalizeString(value: unknown, maxLength: number) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeTimestamp(value: unknown) {
    const timestamp = Number(value);

    return Number.isFinite(timestamp) ?
        Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(timestamp))) :
        0;
}

function normalizeTerms(value: unknown) {
    if (!Array.isArray(value)) return [];

    const seen = new Set<string>();
    const terms: string[] = [];

    value.forEach(rawTerm => {
        const term = normalizeRecommendationTerm(normalizeString(rawTerm, MAX_TERM_LENGTH));

        if (!term || seen.has(term) || terms.length >= MAX_PTV_RECOMMENDATION_FEEDBACK_TERMS) return;

        seen.add(term);
        terms.push(term);
    });

    return terms;
}

function normalizeFeedbackEntry(value: unknown): PtvRecommendationFeedbackEntry | null {
    if (!value || typeof value !== 'object') return null;

    const candidate = value as Partial<PtvRecommendationFeedbackEntry>;
    const action = candidate.action;
    const itemId = normalizeString(candidate.itemId, MAX_ITEM_ID_LENGTH);

    if (!itemId || !action || !VALID_ACTIONS.has(action)) return null;

    return {
        action,
        createdAt: normalizeTimestamp(candidate.createdAt),
        itemId,
        terms: normalizeTerms(candidate.terms)
    };
}

function normalizeUndoEntry(value: unknown): PtvRecommendationFeedbackUndoEntry | null {
    if (!value || typeof value !== 'object') return null;

    const candidate = value as Partial<PtvRecommendationFeedbackUndoEntry>;
    const itemId = normalizeString(candidate.itemId, MAX_ITEM_ID_LENGTH);

    if (!itemId) return null;

    if (candidate.previous == null) {
        return {
            itemId,
            previous: null
        };
    }

    const previous = normalizeFeedbackEntry(candidate.previous);

    return previous ? {
        itemId,
        previous
    } : null;
}

export function normalizePtvRecommendationFeedbackState(value: unknown): PtvRecommendationFeedbackState {
    if (!value || typeof value !== 'object') {
        return {
            entries: [],
            undoStack: []
        };
    }

    const candidate = value as Partial<PtvRecommendationFeedbackState>;
    const entries: PtvRecommendationFeedbackEntry[] = [];
    const seenItemIds = new Set<string>();

    if (Array.isArray(candidate.entries)) {
        candidate.entries.forEach(rawEntry => {
            const entry = normalizeFeedbackEntry(rawEntry);

            if (
                !entry
                || seenItemIds.has(entry.itemId)
                || entries.length >= MAX_PTV_RECOMMENDATION_FEEDBACK_ENTRIES
            ) {
                return;
            }

            seenItemIds.add(entry.itemId);
            entries.push(entry);
        });
    }

    const undoStack = Array.isArray(candidate.undoStack) ?
        candidate.undoStack
            .map(normalizeUndoEntry)
            .filter((entry): entry is PtvRecommendationFeedbackUndoEntry => Boolean(entry))
            .slice(0, MAX_PTV_RECOMMENDATION_FEEDBACK_UNDO_ENTRIES) :
        [];

    return {
        entries,
        undoStack
    };
}

export function applyPtvRecommendationFeedback(
    state: PtvRecommendationFeedbackState,
    input: {
        action: PtvRecommendationFeedbackAction;
        itemId: string;
        now?: number;
        terms?: string[];
    }
): PtvRecommendationFeedbackState {
    const normalized = normalizePtvRecommendationFeedbackState(state);
    const itemId = normalizeString(input.itemId, MAX_ITEM_ID_LENGTH);

    if (!itemId || !VALID_ACTIONS.has(input.action)) return normalized;

    const previous = normalized.entries.find(entry => entry.itemId === itemId) || null;
    const entry: PtvRecommendationFeedbackEntry = {
        action: input.action,
        createdAt: normalizeTimestamp(input.now ?? Date.now()),
        itemId,
        terms: normalizeTerms(input.terms)
    };

    return {
        entries: [
            entry,
            ...normalized.entries.filter(existing => existing.itemId !== itemId)
        ].slice(0, MAX_PTV_RECOMMENDATION_FEEDBACK_ENTRIES),
        undoStack: [
            {
                itemId,
                previous
            },
            ...normalized.undoStack
        ].slice(0, MAX_PTV_RECOMMENDATION_FEEDBACK_UNDO_ENTRIES)
    };
}

export function undoPtvRecommendationFeedback(state: PtvRecommendationFeedbackState): PtvRecommendationFeedbackState {
    const normalized = normalizePtvRecommendationFeedbackState(state);
    const [undoEntry, ...undoStack] = normalized.undoStack;

    if (!undoEntry) return normalized;

    const entries = normalized.entries.filter(entry => entry.itemId !== undoEntry.itemId);

    if (undoEntry.previous) {
        entries.unshift(undoEntry.previous);
    }

    return {
        entries: entries.slice(0, MAX_PTV_RECOMMENDATION_FEEDBACK_ENTRIES),
        undoStack
    };
}

export function resetPtvRecommendationFeedback(): PtvRecommendationFeedbackState {
    return {
        entries: [],
        undoStack: []
    };
}

export function getPtvRecommendationFeedbackTerms(item: PtvRecommendationItem) {
    const metadata = getRecommendationMetadata(item);

    return normalizeTerms(Object.values(metadata.categories).flatMap(values => values || []));
}

function getFeedbackItemId(item: FeedbackItem) {
    return normalizeString(item.Id, MAX_ITEM_ID_LENGTH);
}

function getFeedbackUserData(item: FeedbackItem) {
    return item.UserData as {
        Likes?: boolean | null;
        Played?: boolean;
    } | undefined;
}

export function isPtvRecommendationItemCompleted(item: FeedbackItem) {
    const mediaType = String(item.Type || '').toLowerCase();

    return !REPLAYABLE_MEDIA_TYPES.has(mediaType) && getFeedbackUserData(item)?.Played === true;
}

function getShowFewerTerms(feedback: PtvRecommendationFeedbackState) {
    return new Set(normalizePtvRecommendationFeedbackState(feedback).entries
        .filter(entry => entry.action === 'show-fewer-like-this')
        .flatMap(entry => entry.terms));
}

function itemMatchesFeedbackTerms(item: PtvRecommendationItem, terms: Set<string>) {
    if (!terms.size) return false;

    return getPtvRecommendationFeedbackTerms(item).some(term => terms.has(term));
}

export function shouldExcludePtvRecommendationItem(
    item: PtvRecommendationItem,
    feedback: PtvRecommendationFeedbackState = EMPTY_PTV_RECOMMENDATION_FEEDBACK,
    options: {
        excludeCompleted?: boolean;
    } = {}
) {
    const normalized = normalizePtvRecommendationFeedbackState(feedback);
    const blockedItemIds = new Set(normalized.entries.map(entry => entry.itemId));
    const itemId = getFeedbackItemId(item);

    if (itemId && blockedItemIds.has(itemId)) return true;
    if (getFeedbackUserData(item)?.Likes === false) return true;
    if (options.excludeCompleted !== false && isPtvRecommendationItemCompleted(item)) return true;

    return itemMatchesFeedbackTerms(item, getShowFewerTerms(normalized));
}

export function filterPtvRecommendationCandidates(
    items: PtvRecommendationItem[],
    feedback: PtvRecommendationFeedbackState = EMPTY_PTV_RECOMMENDATION_FEEDBACK
) {
    return items.filter(item => !shouldExcludePtvRecommendationItem(item, feedback));
}

export function filterPtvHeroItemsByFeedback<T extends FeedbackItem>(
    items: T[],
    feedback: PtvRecommendationFeedbackState = EMPTY_PTV_RECOMMENDATION_FEEDBACK
) {
    const blockedItemIds = new Set(normalizePtvRecommendationFeedbackState(feedback).entries.map(entry => entry.itemId));

    return items.filter(item => {
        const itemId = getFeedbackItemId(item);

        return !itemId || !blockedItemIds.has(itemId);
    });
}

export function filterAndDedupePtvRecommendationRows(
    rows: PtvRecommendationRow[],
    feedback: PtvRecommendationFeedbackState = EMPTY_PTV_RECOMMENDATION_FEEDBACK,
    options: {
        nearbyRowWindow?: number;
    } = {}
) {
    const nearbyRowWindow = Math.max(1, Math.min(10, Math.floor(options.nearbyRowWindow ?? 2)));
    const recentRowIds: Array<Set<string>> = [];

    return rows.flatMap(row => {
        const nearbyIds = new Set(recentRowIds.flatMap(ids => [...ids]));
        let removedCount = 0;
        const items = row.items.filter(score => {
            const itemId = getFeedbackItemId(score.item);

            if (
                shouldExcludePtvRecommendationItem(score.item, feedback)
                || (itemId && nearbyIds.has(itemId))
            ) {
                removedCount += 1;
                return false;
            }

            return true;
        });

        const currentIds = new Set(items
            .map(score => getFeedbackItemId(score.item))
            .filter(Boolean));

        recentRowIds.push(currentIds);
        if (recentRowIds.length > nearbyRowWindow) recentRowIds.shift();

        if (!items.length) return [];

        return [{
            ...row,
            diagnostics: row.diagnostics ? {
                ...row.diagnostics,
                dedupeRemovals: row.diagnostics.dedupeRemovals + removedCount,
                finalRenderedCount: items.length
            } : undefined,
            items
        }];
    });
}

export function getPtvAdjacentRecommendationRowOverlapPercentage(rows: PtvRecommendationRow[]) {
    let overlapCount = 0;
    let comparisonCount = 0;

    for (let index = 1; index < rows.length; index += 1) {
        const previousIds = new Set(rows[index - 1].items
            .map(score => getFeedbackItemId(score.item))
            .filter(Boolean));
        const currentIds = rows[index].items
            .map(score => getFeedbackItemId(score.item))
            .filter(Boolean);

        currentIds.forEach(itemId => {
            comparisonCount += 1;
            if (previousIds.has(itemId)) overlapCount += 1;
        });
    }

    return comparisonCount ?
        Number(((overlapCount / comparisonCount) * 100).toFixed(2)) :
        0;
}
