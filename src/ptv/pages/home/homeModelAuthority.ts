import type { FeaturedContentCompleteness } from '../../modules/cache/featuredContentSemantics';

type HomeModelRowLike = { items?: unknown[] };

export type NativeHomeModelLike = {
    completeness?: FeaturedContentCompleteness;
    emptyLibraryConfirmed?: boolean;
    heroItems?: unknown[];
    rows?: HomeModelRowLike[];
    sectionCount?: number;
};

export function summarizeNativeHomeModel(model: NativeHomeModelLike) {
    const rows = Array.isArray(model.rows) ? model.rows : [];
    const heroCount = Array.isArray(model.heroItems) ? model.heroItems.length : 0;
    const rowCounts = rows.map(row => Array.isArray(row.items) ? row.items.length : 0);
    const totalRowItemCount = rowCounts.reduce((total, count) => total + count, 0);
    const totalItemCount = heroCount + totalRowItemCount;
    const populatedSectionCount = rowCounts.filter(count => count > 0).length;
    const sectionCount = Math.max(model.sectionCount || 0, rows.length);
    let completeness = model.completeness;

    if (!completeness) {
        if (totalItemCount > 0) completeness = 'complete';
        else if (model.emptyLibraryConfirmed) completeness = 'intentional-empty';
        else if (sectionCount > 0) completeness = 'configuration-only';
        else completeness = 'empty';
    }

    return {
        completeness,
        emptySectionCount: Math.max(0, sectionCount - populatedSectionCount),
        heroCount,
        populated: totalItemCount > 0,
        populatedSectionCount,
        sectionCount,
        totalItemCount,
        totalRowItemCount
    };
}

export function decideNativeHomeModelReplacement(options: {
    configurationMatches?: boolean;
    current: NativeHomeModelLike;
    currentGeneration: number;
    incoming: NativeHomeModelLike;
    incomingGeneration: number;
    recommendationMatches?: boolean;
}) {
    const current = summarizeNativeHomeModel(options.current);
    const incoming = summarizeNativeHomeModel(options.incoming);
    const decision = (allow: boolean, reason: string) => ({
        allow,
        current,
        incoming,
        reason,
        replacesPopulatedModel: current.populated
    });

    if (options.incomingGeneration !== options.currentGeneration) return decision(false, 'stale-route-generation');
    if (options.configurationMatches === false) return decision(false, 'configuration-hash-mismatch');
    if (options.recommendationMatches === false) return decision(false, 'recommendation-hash-mismatch');
    if (current.populated && !incoming.populated) return decision(false, 'preserve-populated-current-model');
    if (current.completeness === 'complete' && incoming.completeness === 'partial' && incoming.totalItemCount <= current.totalItemCount) {
        return decision(false, 'preserve-complete-current-model');
    }
    if (!current.populated && incoming.completeness === 'configuration-only') return decision(false, 'reject-section-shell-model');

    return decision(true, incoming.completeness === 'intentional-empty' ? 'accept-intentional-empty' : 'accept-incoming-model');
}
