import type {
    PtvRecommendationHomeData,
    PtvRecommendationRow
} from '../../modules/recommendations/types/recommendationTypes';
import type { PtvItem } from '../../api';
import type { NativeHomeRow } from './hooks';

const PTV_HOME_PERSONALIZED_ROW_IDS = [
    'recommended-for-you',
    'because-you-watched',
    'ptv-discovery',
    'rediscover',
    'hidden-gems'
] as const;

const PTV_HOME_PERSONALIZED_ROW_PREFIX = 'personalized-';
const PTV_HOME_PERSONALIZED_ROW_LIMIT = 8;
const PTV_HOME_PERSONALIZED_ITEM_LIMIT = 18;
const PTV_HOME_HERO_ITEM_LIMIT = 8;

function getItemId(item: PtvItem) {
    return String(item.Id || '');
}

function isContinuationRow(row: NativeHomeRow) {
    const text = `${row.id} ${row.source} ${row.sourceType || ''} ${row.title}`.toLowerCase();

    return row.source === 'resume'
        || row.source === 'next-up'
        || row.source === 'continue-listening'
        || row.source === 'continue-reading'
        || /\b(?:continue|next up|resume)\b/.test(text);
}

function hasHeroArtwork(item: PtvItem) {
    return Boolean(
        (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags.length)
        || (Array.isArray(item.ParentBackdropImageTags) && item.ParentBackdropImageTags.length)
        || item.ParentBackdropItemId
        || item.ImageTags?.Primary
        || item.ImageTags?.Thumb
    );
}

function toNativeHomePersonalizedRow(row: PtvRecommendationRow, index: number): NativeHomeRow {
    return {
        accepted: true,
        candidateCount: row.diagnostics?.candidateCount ?? row.items.length,
        dedupeRemovals: row.diagnostics?.dedupeRemovals ?? 0,
        enabled: true,
        finalRenderedCount: row.items.length,
        generatedAt: Date.now(),
        id: `${PTV_HOME_PERSONALIZED_ROW_PREFIX}${row.id}`,
        items: row.items
            .map(score => score.item)
            .filter(item => Boolean(getItemId(item)))
            .slice(0, PTV_HOME_PERSONALIZED_ITEM_LIMIT),
        kind: 'items',
        mediaType: row.mediaType,
        persisted: false,
        renderedSource: 'generated-preview',
        rowType: 'generated-recommendation',
        source: 'recommendation',
        sourceGroupId: 'personalized-home',
        sourceGroupTitle: 'For You',
        sourceRecommendationId: row.id,
        sourceSortIndex: index,
        sourceType: 'personalized-home',
        subtitle: row.explanation || 'Selected from your recent activity and favorites.',
        title: row.title
    };
}

function selectPersonalizedRows(rows: readonly PtvRecommendationRow[]) {
    const byId = new Map(rows.map(row => [row.id, row]));
    const watchedSubjectRows = rows
        .filter(row => row.id.startsWith('because-you-watched-'))
        .slice(0, 4);
    const selectedIds = watchedSubjectRows.length ?
        PTV_HOME_PERSONALIZED_ROW_IDS.filter(id => id !== 'because-you-watched') :
        PTV_HOME_PERSONALIZED_ROW_IDS;
    const selected = selectedIds
        .flatMap(id => id === 'ptv-discovery' ? [ ...watchedSubjectRows, byId.get(id) ] : [ byId.get(id) ])
        .filter((row): row is PtvRecommendationRow => Boolean(row));

    return selected.slice(0, PTV_HOME_PERSONALIZED_ROW_LIMIT);
}

export function createNativeHomePersonalizedRows(
    data: Pick<PtvRecommendationHomeData, 'rows'> | null | undefined
) {
    if (!data?.rows?.length) return [];

    return selectPersonalizedRows(data.rows)
        .map(toNativeHomePersonalizedRow)
        .filter(row => row.items.length > 0);
}

export function mergeNativeHomePersonalizedRows(
    baseRows: NativeHomeRow[],
    personalizedRows: NativeHomeRow[]
) {
    if (!personalizedRows.length) return baseRows;

    const incomingIds = new Set(personalizedRows.map(row => row.id));
    const incomingSourceIds = new Set(personalizedRows.map(row => row.sourceRecommendationId).filter(Boolean));
    const withoutReplacedRows = baseRows.filter(row => (
        !incomingIds.has(row.id)
        && !(
            row.source === 'recommendation'
            && row.sourceRecommendationId
            && incomingSourceIds.has(row.sourceRecommendationId)
        )
    ));
    let insertionIndex = 0;

    while (
        insertionIndex < withoutReplacedRows.length
        && isContinuationRow(withoutReplacedRows[insertionIndex])
    ) {
        insertionIndex += 1;
    }

    return [
        ...withoutReplacedRows.slice(0, insertionIndex),
        ...personalizedRows,
        ...withoutReplacedRows.slice(insertionIndex)
    ];
}

export function prioritizeNativeHomePersonalizedHeroItems(
    personalizedRows: NativeHomeRow[],
    existingHeroItems: PtvItem[],
    limit = PTV_HOME_HERO_ITEM_LIMIT
) {
    const seen = new Set<string>();
    const items: PtvItem[] = [];
    const candidates = [
        ...personalizedRows.flatMap(row => row.items as PtvItem[]).filter(hasHeroArtwork),
        ...existingHeroItems
    ];

    candidates.some(item => {
        const id = getItemId(item);

        if (!id || seen.has(id)) return false;

        seen.add(id);
        items.push(item);

        return items.length >= limit;
    });

    return items;
}
