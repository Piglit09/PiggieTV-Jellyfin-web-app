import {
    PTV_RECOMMENDATION_SURFACE_POLICIES,
    type PtvRecommendationPolicyCandidate,
    type PtvRecommendationPolicyClassification
} from '../../core/recommendations/recommendationPolicyContracts';

export const PTV_RELATED_VIDEO_CANDIDATE_LIMIT = 48;
export const PTV_RELATED_VIDEO_DISPLAY_LIMIT = 12;
export const PTV_RELATED_VIDEO_FIELDS = [
    'PrimaryImageAspectRatio',
    'CanDelete',
    'Genres',
    'Tags',
    'Studios',
    'OriginalTitle',
    'ProviderIds',
    'SeriesStudio'
].join(',');

type PtvRelatedVideoItem = Readonly<Record<string, unknown> & {
    Genres?: unknown;
    Id?: unknown;
    Name?: unknown;
    OriginalTitle?: unknown;
    ParentId?: unknown;
    ProductionYear?: unknown;
    SeriesId?: unknown;
    Studios?: unknown;
    Tags?: unknown;
    Type?: unknown;
}>;

type ScoredRelatedVideoItem<TItem extends PtvRelatedVideoItem> = Readonly<{
    affinityStrength: number;
    item: TItem;
    originalIndex: number;
    policyCandidate: PtvRecommendationPolicyCandidate;
}>;

const TITLE_STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'for',
    'in',
    'of',
    'on',
    'the',
    'to',
    'with'
]);
const INSTALLMENT_LABELS = new Set([ 'chapter', 'part', 'vol', 'volume' ]);
const MAX_SIGNAL_VALUES = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeSignal(value: unknown) {
    return normalizeText(value)
        .toLocaleLowerCase()
        .replace(/[\s!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 128);
}

function uniqueSignals(values: readonly unknown[]) {
    const signals: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
        const signal = normalizeSignal(value);

        if (!signal || seen.has(signal)) continue;

        seen.add(signal);
        signals.push(signal);
        if (signals.length >= MAX_SIGNAL_VALUES) break;
    }

    return signals;
}

function getTextSignals(value: unknown) {
    return Array.isArray(value) ? uniqueSignals(value) : [];
}

function getNameIdSignals(value: unknown) {
    if (!Array.isArray(value)) return [];

    return uniqueSignals(value.flatMap(entry => {
        if (typeof entry === 'string') return [ entry ];
        if (!isRecord(entry)) return [];

        return [ entry.Id, entry.Name ];
    }));
}

function getTitleCore(item: PtvRelatedVideoItem) {
    const title = normalizeSignal(item.OriginalTitle) || normalizeSignal(item.Name);

    if (!title) return '';

    const tokens = title.split(' ');
    const installment = tokens.at(-1) || '';
    const installmentAlphabet = installment.charCodeAt(0) >= 48 && installment.charCodeAt(0) <= 57 ?
        '0123456789' :
        'ivxlcdm';
    const isInstallment = Boolean(installment)
        && [ ...installment ].every(character => installmentAlphabet.includes(character));

    if (!isInstallment) return title;

    tokens.pop();
    if (INSTALLMENT_LABELS.has(tokens.at(-1) || '')) tokens.pop();

    return tokens.join(' ') || title;
}

function getTitleTokens(item: PtvRelatedVideoItem) {
    return getTitleCore(item)
        .split(' ')
        .filter(token => token.length > 1 && !TITLE_STOP_WORDS.has(token));
}

function getYear(item: PtvRelatedVideoItem) {
    const year = Number(item.ProductionYear);

    return Number.isSafeInteger(year) && year >= 1880 && year <= 2200 ? year : null;
}

function getSharedValues(left: readonly string[], right: readonly string[]) {
    if (!left.length || !right.length) return [];

    const rightValues = new Set(right);

    return left.filter(value => rightValues.has(value));
}

function getOverlapRatio(left: readonly string[], right: readonly string[]) {
    if (!left.length || !right.length) return 0;

    const intersection = getSharedValues(left, right).length;
    const union = new Set([ ...left, ...right ]).size;

    return union ? intersection / union : 0;
}

function getItemIdentity(item: PtvRelatedVideoItem, originalIndex: number) {
    return normalizeText(item.Id) || `similar-item-${originalIndex}`;
}

type RelatedAffinitySignals = Readonly<{
    exactFranchise: boolean;
    itemGenres: string[];
    itemSeriesId: string;
    itemStudios: string[];
    itemTitleCore: string;
    sameSeries: boolean;
    sharedGenres: string[];
    sharedStudios: string[];
    sharedTags: string[];
    sharedTitleTokens: string[];
    titleOverlap: number;
    yearDistance: number | null;
}>;

function getRelatedAffinitySignals(seed: PtvRelatedVideoItem, item: PtvRelatedVideoItem): RelatedAffinitySignals {
    const seedGenres = getTextSignals(seed.Genres);
    const itemGenres = getTextSignals(item.Genres);
    const seedTags = getTextSignals(seed.Tags);
    const itemTags = getTextSignals(item.Tags);
    const seedStudios = getNameIdSignals(seed.Studios);
    const itemStudios = getNameIdSignals(item.Studios);
    const seedTitleCore = getTitleCore(seed);
    const itemTitleCore = getTitleCore(item);
    const seedTitleTokens = getTitleTokens(seed);
    const itemTitleTokens = getTitleTokens(item);
    const seedSeriesId = normalizeSignal(seed.SeriesId);
    const itemSeriesId = normalizeSignal(item.SeriesId);
    const seedYear = getYear(seed);
    const itemYear = getYear(item);

    return {
        exactFranchise: Boolean(seedTitleCore && itemTitleCore && seedTitleCore === itemTitleCore),
        itemGenres,
        itemSeriesId,
        itemStudios,
        itemTitleCore,
        sameSeries: Boolean(seedSeriesId && itemSeriesId && seedSeriesId === itemSeriesId),
        sharedGenres: getSharedValues(seedGenres, itemGenres),
        sharedStudios: getSharedValues(seedStudios, itemStudios),
        sharedTags: getSharedValues(seedTags, itemTags),
        sharedTitleTokens: getSharedValues(seedTitleTokens, itemTitleTokens),
        titleOverlap: getOverlapRatio(seedTitleTokens, itemTitleTokens),
        yearDistance: seedYear !== null && itemYear !== null ? Math.abs(seedYear - itemYear) : null
    };
}

function scoreTitleAffinity(signals: RelatedAffinitySignals) {
    let affinityStrength = 0;
    let score = 0;

    if (signals.sameSeries) {
        affinityStrength += 5;
        score += 120;
    }
    if (signals.exactFranchise) {
        affinityStrength += 5;
        score += 110;
    }
    if (signals.sharedTitleTokens.length >= 2) {
        affinityStrength += 3;
        score += 44 + (signals.titleOverlap * 36);
    } else if (signals.sharedTitleTokens.length === 1) {
        affinityStrength += 1;
        score += 8;
    }

    return { affinityStrength, score };
}

function scoreMetadataAffinity(signals: RelatedAffinitySignals) {
    let affinityStrength = 0;
    let score = 0;

    if (signals.sharedStudios.length) {
        affinityStrength += 3;
        score += Math.min(92, 58 + ((signals.sharedStudios.length - 1) * 17));
    }
    if (signals.sharedGenres.length) {
        affinityStrength += Math.min(4, signals.sharedGenres.length * 2);
        score += Math.min(
            84,
            (signals.sharedGenres.length * 22)
                + (getOverlapRatio(signals.sharedGenres, signals.itemGenres) * 28)
        );
    }
    if (signals.sharedTags.length) {
        affinityStrength += Math.min(3, signals.sharedTags.length);
        score += Math.min(42, (signals.sharedTags.length * 10) + 14);
    }

    return { affinityStrength, score };
}

function scoreYearAffinity(yearDistance: number | null) {
    if (yearDistance === null) return 0;
    if (yearDistance <= 2) return 14;
    if (yearDistance <= 5) return 10;
    if (yearDistance <= 10) return 5;
    if (yearDistance >= 30) return -8;

    return 0;
}

function classifyAffinity(affinityStrength: number): PtvRecommendationPolicyClassification {
    if (affinityStrength >= 3) return 'affinity';
    if (affinityStrength > 0) return 'mixed';

    return 'discovery';
}

function scoreRelatedVideoItem<TItem extends PtvRelatedVideoItem>(
    seed: PtvRelatedVideoItem,
    item: TItem,
    originalIndex: number,
    candidateCount: number
): ScoredRelatedVideoItem<TItem> {
    const signals = getRelatedAffinitySignals(seed, item);
    const titleAffinity = scoreTitleAffinity(signals);
    const metadataAffinity = scoreMetadataAffinity(signals);
    const sameType = Boolean(normalizeSignal(seed.Type) && normalizeSignal(seed.Type) === normalizeSignal(item.Type));
    const affinityStrength = titleAffinity.affinityStrength + metadataAffinity.affinityStrength;
    let score = ((candidateCount - originalIndex) / Math.max(1, candidateCount)) * 4;

    if (sameType) score += 8;
    score += titleAffinity.score + metadataAffinity.score + scoreYearAffinity(signals.yearDistance);

    return {
        affinityStrength,
        item,
        originalIndex,
        policyCandidate: {
            albumId: signals.itemSeriesId || signals.itemTitleCore || undefined,
            artistIds: signals.itemStudios,
            baseScore: score,
            classification: classifyAffinity(affinityStrength),
            genres: signals.itemGenres,
            id: getItemIdentity(item, originalIndex),
            mediaType: normalizeText(item.Type) || 'Video',
            source: 'jellyfin-similar-items',
            title: normalizeText(item.Name) || 'Untitled'
        }
    };
}

function sharesAny(left: readonly string[] | undefined, right: readonly string[] | undefined) {
    return getSharedValues(left || [], right || []).length > 0;
}

function getTransitionScore(
    previous: ScoredRelatedVideoItem<PtvRelatedVideoItem> | undefined,
    candidate: ScoredRelatedVideoItem<PtvRelatedVideoItem>
) {
    if (!previous) return 0;

    let score = sharesAny(previous.policyCandidate.genres, candidate.policyCandidate.genres) ? 6 : -2;

    if (sharesAny(previous.policyCandidate.artistIds, candidate.policyCandidate.artistIds)) score -= 10;
    if (
        previous.policyCandidate.albumId
        && previous.policyCandidate.albumId === candidate.policyCandidate.albumId
    ) score -= 16;

    return score;
}

function createsRelatedRun(
    selected: readonly ScoredRelatedVideoItem<PtvRelatedVideoItem>[],
    candidate: ScoredRelatedVideoItem<PtvRelatedVideoItem>
) {
    const constraints = PTV_RECOMMENDATION_SURFACE_POLICIES.related;
    const studioRun = selected.slice(-constraints.maxConsecutiveArtist);
    const franchiseRun = selected.slice(-constraints.maxConsecutiveAlbum);

    if (
        candidate.policyCandidate.artistIds?.length
        && studioRun.length === constraints.maxConsecutiveArtist
        && studioRun.every(item => sharesAny(item.policyCandidate.artistIds, candidate.policyCandidate.artistIds))
    ) return true;

    return Boolean(
        candidate.policyCandidate.albumId
        && franchiseRun.length === constraints.maxConsecutiveAlbum
        && franchiseRun.every(item => item.policyCandidate.albumId === candidate.policyCandidate.albumId)
    );
}

function respectsRelatedCaps(
    candidate: ScoredRelatedVideoItem<PtvRelatedVideoItem>,
    studioCounts: ReadonlyMap<string, number>,
    franchiseCounts: ReadonlyMap<string, number>
) {
    const constraints = PTV_RECOMMENDATION_SURFACE_POLICIES.related;

    if (candidate.policyCandidate.artistIds?.some(studio => (
        studioCounts.get(studio) || 0
    ) >= constraints.maxItemsPerArtist)) return false;

    const franchise = candidate.policyCandidate.albumId;

    return !franchise || (franchiseCounts.get(franchise) || 0) < constraints.maxItemsPerAlbum;
}

function incrementRelatedCounts(
    candidate: ScoredRelatedVideoItem<PtvRelatedVideoItem>,
    studioCounts: Map<string, number>,
    franchiseCounts: Map<string, number>
) {
    for (const studio of candidate.policyCandidate.artistIds || []) {
        studioCounts.set(studio, (studioCounts.get(studio) || 0) + 1);
    }

    const franchise = candidate.policyCandidate.albumId;

    if (franchise) franchiseCounts.set(franchise, (franchiseCounts.get(franchise) || 0) + 1);
}

function compareRelatedCandidates<TItem extends PtvRelatedVideoItem>(
    left: ScoredRelatedVideoItem<TItem>,
    right: ScoredRelatedVideoItem<TItem>,
    previous: ScoredRelatedVideoItem<PtvRelatedVideoItem> | undefined
) {
    const leftScore = Number(left.policyCandidate.baseScore) + getTransitionScore(previous, left);
    const rightScore = Number(right.policyCandidate.baseScore) + getTransitionScore(previous, right);

    return rightScore - leftScore
        || left.originalIndex - right.originalIndex
        || left.policyCandidate.id.localeCompare(right.policyCandidate.id);
}

function getBestRelatedCandidate<TItem extends PtvRelatedVideoItem>(
    candidates: readonly ScoredRelatedVideoItem<TItem>[],
    previous: ScoredRelatedVideoItem<PtvRelatedVideoItem> | undefined
) {
    return [ ...candidates ].sort((left, right) => (
        compareRelatedCandidates(left, right, previous)
    ))[0];
}

/**
 * Ranks an expanded Jellyfin Similar pool locally. This deliberately consumes
 * the shared `related` policy's diversity caps without adding a second network
 * dependency to the Details critical path.
 */
export function rankPtvRelatedVideoItems<TItem extends PtvRelatedVideoItem>(
    seed: PtvRelatedVideoItem | null | undefined,
    candidates: readonly TItem[] | null | undefined,
    limit = PTV_RELATED_VIDEO_DISPLAY_LIMIT
): TItem[] {
    const safeCandidates = Array.isArray(candidates) ? [ ...candidates ] : [];
    const safeLimit = Number.isSafeInteger(limit) ? Math.max(0, Math.min(limit, safeCandidates.length)) : 0;
    const fallback = safeCandidates.slice(0, safeLimit);

    if (!seed || !safeLimit) return fallback;

    try {
        const scored = safeCandidates.map((item, index) => (
            scoreRelatedVideoItem(seed, item, index, safeCandidates.length)
        ));

        if (!scored.some(item => item.affinityStrength > 0)) return fallback;

        const remaining = [ ...scored ];
        const selected: ScoredRelatedVideoItem<TItem>[] = [];
        const studioCounts = new Map<string, number>();
        const franchiseCounts = new Map<string, number>();

        while (selected.length < safeLimit && remaining.length) {
            const previous = selected.at(-1);
            const withinCaps = remaining
                .filter(candidate => respectsRelatedCaps(candidate, studioCounts, franchiseCounts));
            const eligible = withinCaps
                .filter(candidate => !createsRelatedRun(selected, candidate));
            const next = getBestRelatedCandidate(eligible, previous)
                || getBestRelatedCandidate(withinCaps, previous)
                || getBestRelatedCandidate(remaining, previous);

            selected.push(next);
            remaining.splice(remaining.indexOf(next), 1);
            incrementRelatedCounts(next, studioCounts, franchiseCounts);
        }

        return selected.map(candidate => candidate.item);
    } catch {
        return fallback;
    }
}
