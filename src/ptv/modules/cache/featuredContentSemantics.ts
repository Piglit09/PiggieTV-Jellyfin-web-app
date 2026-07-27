export type FeaturedContentCompleteness =
    | 'complete'
    | 'configuration-only'
    | 'degraded'
    | 'empty'
    | 'intentional-empty'
    | 'partial';

export type FeaturedContentSemanticSummary = {
    completeness: FeaturedContentCompleteness;
    emptySectionCount: number;
    heroCount: number;
    payloadClassification: FeaturedContentCompleteness;
    populatedSectionCount: number;
    reason: string;
    sectionCount: number;
    totalItemCount: number;
    totalRowItemCount: number;
    usableForDisplay: boolean;
    usableForPersistence: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getField(source: Record<string, unknown>, ...keys: string[]) {
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
    }

    return undefined;
}

function getNormalizedState(payload: Record<string, unknown>) {
    const value = getField(
        payload,
        'generationState',
        'GenerationState',
        'completeness',
        'Completeness',
        'payloadClassification',
        'PayloadClassification'
    );

    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hasConfirmedEmptyState(payload: Record<string, unknown>, state: string) {
    return getField(payload, 'emptyLibraryConfirmed', 'EmptyLibraryConfirmed') === true
        || getField(payload, 'intentionalEmpty', 'IntentionalEmpty') === true
        || state === 'intentional-empty'
        || state === 'valid-empty-library';
}

function isDegradedState(state: string) {
    return [
        'authentication-lost',
        'cancelled',
        'canceled',
        'degraded',
        'incomplete',
        'malformed',
        'partial',
        'timed-out',
        'timeout'
    ].includes(state);
}

export function summarizeFeaturedContentPayload(value: unknown): FeaturedContentSemanticSummary {
    const payload = isRecord(value) ? value : {};
    const heroItems = getField(payload, 'heroItems', 'HeroItems');
    const rawSectionItems = getField(payload, 'sectionItems', 'SectionItems');
    const sectionItems = isRecord(rawSectionItems) ? rawSectionItems : {};
    const sections = getField(payload, 'sections', 'Sections');
    const sectionItemCounts = Object.values(sectionItems).map(items => Array.isArray(items) ? items.length : 0);
    const heroCount = Array.isArray(heroItems) ? heroItems.length : 0;
    const totalRowItemCount = sectionItemCounts.reduce((total, count) => total + count, 0);
    const populatedSectionCount = sectionItemCounts.filter(count => count > 0).length;
    const sectionCount = Math.max(Array.isArray(sections) ? sections.length : 0, sectionItemCounts.length);
    const emptySectionCount = Math.max(0, sectionCount - populatedSectionCount);
    const state = getNormalizedState(payload);
    const totalItemCount = heroCount + totalRowItemCount;
    let completeness: FeaturedContentCompleteness;

    if (totalItemCount > 0) completeness = isDegradedState(state) ? 'partial' : 'complete';
    else if (hasConfirmedEmptyState(payload, state)) completeness = 'intentional-empty';
    else if (sectionCount > 0) completeness = 'configuration-only';
    else if (isDegradedState(state)) completeness = 'degraded';
    else completeness = 'empty';

    const usableForDisplay = totalItemCount > 0 || completeness === 'intentional-empty';
    const usableForPersistence = completeness === 'complete' || completeness === 'intentional-empty';

    return {
        completeness,
        emptySectionCount,
        heroCount,
        payloadClassification: completeness,
        populatedSectionCount,
        reason: usableForPersistence ? 'semantic-payload-accepted' : `semantic-${completeness}`,
        sectionCount,
        totalItemCount,
        totalRowItemCount,
        usableForDisplay,
        usableForPersistence
    };
}
