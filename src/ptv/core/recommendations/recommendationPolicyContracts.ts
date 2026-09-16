import type { PtvCoreMediaType } from '../media/mediaContracts';

export const PTV_RECOMMENDATION_POLICY_CONTRACT_VERSION = '2.0' as const;
export const PTV_RECOMMENDATION_POLICY_VERSION = 'music-premium-v2' as const;
export const PTV_RECOMMENDATION_ALGORITHM_ID = 'ptv-diversified-sequence-v2' as const;

export type PtvRecommendationSurface =
    | 'home'
    | 'made-for-you'
    | 'radio'
    | 'related'
    | 'discovery';

export type PtvRecommendationPolicyClassification = 'affinity' | 'discovery' | 'mixed';

export type PtvRecommendationQualityEventType =
    | 'generated'
    | 'fallback'
    | 'shown'
    | 'played'
    | 'skipped'
    | 'completed';

export type PtvRecommendationQualityEvent = Readonly<{
    algorithmId: string;
    classification?: PtvRecommendationPolicyClassification;
    cohort?: string;
    contractVersion: typeof PTV_RECOMMENDATION_POLICY_CONTRACT_VERSION;
    discoveryCount?: number;
    eventType: PtvRecommendationQualityEventType;
    fallbackReason?: string;
    familiarCount?: number;
    generationLatencyMs?: number;
    itemCount?: number;
    playbackLatencyMs?: number;
    playedMs?: number;
    policyVersion: string;
    rank?: number;
    reasonCodes?: readonly string[];
    requestId?: string;
    source?: string;
    surface: PtvRecommendationSurface;
    timestamp: string;
}>;

export type PtvRecommendationPolicyConstraints = Readonly<{
    discoveryTarget: number;
    familiarTarget: number;
    maxConsecutiveAlbum: number;
    maxConsecutiveArtist: number;
    maxItemsPerAlbum: number;
    maxItemsPerArtist: number;
}>;

export const PTV_RECOMMENDATION_SURFACE_POLICIES: Readonly<
    Record<PtvRecommendationSurface, PtvRecommendationPolicyConstraints>
> = Object.freeze({
    home: {
        discoveryTarget: 0.3,
        familiarTarget: 0.7,
        maxConsecutiveAlbum: 2,
        maxConsecutiveArtist: 2,
        maxItemsPerAlbum: 2,
        maxItemsPerArtist: 3
    },
    'made-for-you': {
        discoveryTarget: 0.3,
        familiarTarget: 0.7,
        maxConsecutiveAlbum: 2,
        maxConsecutiveArtist: 2,
        maxItemsPerAlbum: 2,
        maxItemsPerArtist: 3
    },
    radio: {
        discoveryTarget: 0.75,
        familiarTarget: 0.25,
        maxConsecutiveAlbum: 2,
        maxConsecutiveArtist: 2,
        maxItemsPerAlbum: 2,
        maxItemsPerArtist: 3
    },
    related: {
        discoveryTarget: 0.4,
        familiarTarget: 0.6,
        maxConsecutiveAlbum: 2,
        maxConsecutiveArtist: 2,
        maxItemsPerAlbum: 2,
        maxItemsPerArtist: 3
    },
    discovery: {
        discoveryTarget: 0.8,
        familiarTarget: 0.2,
        maxConsecutiveAlbum: 1,
        maxConsecutiveArtist: 1,
        maxItemsPerAlbum: 1,
        maxItemsPerArtist: 2
    }
});

export type PtvRecommendationPolicySeed = Readonly<{
    albumId?: string;
    artistIds?: readonly string[];
    genres?: readonly string[];
    id: string;
}>;

export type PtvRecommendationPolicyCandidate = Readonly<{
    albumId?: string;
    artistIds?: readonly string[];
    baseScore?: number;
    classification: PtvRecommendationPolicyClassification;
    familiar?: boolean;
    genres?: readonly string[];
    id: string;
    mediaType: PtvCoreMediaType | string;
    source: string;
    title: string;
}>;

export type PtvRecommendationPolicyRequest = Readonly<{
    algorithmId?: string;
    candidates: readonly PtvRecommendationPolicyCandidate[];
    cohort?: string;
    contractVersion: typeof PTV_RECOMMENDATION_POLICY_CONTRACT_VERSION;
    limit?: number;
    policyVersion: string;
    requestId?: string;
    seed?: PtvRecommendationPolicySeed;
    serverId: string;
    surface: PtvRecommendationSurface;
    userId: string;
}>;

export type PtvRankedRecommendationPolicyItem = Readonly<{
    classification: PtvRecommendationPolicyClassification;
    id: string;
    mediaType: PtvCoreMediaType | string;
    rank: number;
    reasons: readonly string[];
    score: number;
    source: string;
    title: string;
    transitionScore: number;
}>;

export type PtvRecommendationPolicyResponse = Readonly<{
    algorithmId: string;
    cohort: string;
    constraints: PtvRecommendationPolicyConstraints;
    contractVersion: typeof PTV_RECOMMENDATION_POLICY_CONTRACT_VERSION;
    fallbackReason?: string | null;
    generatedAt: string;
    generationLatencyMs: number;
    items: readonly PtvRankedRecommendationPolicyItem[];
    policyVersion: string;
    requestId: string;
    surface: PtvRecommendationSurface;
}>;

type PtvRecommendationPolicyResponseExpectation = Readonly<{
    requestId?: string;
    surface?: PtvRecommendationSurface;
}>;

const PTV_RECOMMENDATION_POLICY_CLASSIFICATIONS: readonly PtvRecommendationPolicyClassification[] = [
    'affinity',
    'discovery',
    'mixed'
];
const PTV_RECOMMENDATION_POLICY_SURFACES: readonly PtvRecommendationSurface[] = [
    'home',
    'made-for-you',
    'radio',
    'related',
    'discovery'
];
const PTV_RECOMMENDATION_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const PTV_RECOMMENDATION_MAX_ITEMS = 200;
const PTV_RECOMMENDATION_MAX_REASONS = 16;

function isPtvRecommendationRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPtvRecommendationNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isPtvRecommendationFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPtvRecommendationTarget(value: unknown): value is number {
    return isPtvRecommendationFiniteNumber(value) && value >= 0 && value <= 1;
}

function isPtvRecommendationPositiveInteger(value: unknown): value is number {
    return isPtvRecommendationFiniteNumber(value) && Number.isInteger(value) && value >= 1;
}

function isPtvRecommendationSurface(value: unknown): value is PtvRecommendationSurface {
    return typeof value === 'string'
        && PTV_RECOMMENDATION_POLICY_SURFACES.includes(value as PtvRecommendationSurface);
}

function isPtvRecommendationClassification(
    value: unknown
): value is PtvRecommendationPolicyClassification {
    return typeof value === 'string'
        && PTV_RECOMMENDATION_POLICY_CLASSIFICATIONS.includes(
            value as PtvRecommendationPolicyClassification
        );
}

function isPtvRecommendationConstraints(value: unknown): value is PtvRecommendationPolicyConstraints {
    if (!isPtvRecommendationRecord(value)) return false;

    return isPtvRecommendationTarget(value.discoveryTarget)
        && isPtvRecommendationTarget(value.familiarTarget)
        && isPtvRecommendationPositiveInteger(value.maxConsecutiveAlbum)
        && isPtvRecommendationPositiveInteger(value.maxConsecutiveArtist)
        && isPtvRecommendationPositiveInteger(value.maxItemsPerAlbum)
        && isPtvRecommendationPositiveInteger(value.maxItemsPerArtist);
}

function isPtvRankedRecommendationPolicyItem(
    value: unknown
): value is PtvRankedRecommendationPolicyItem {
    if (!isPtvRecommendationRecord(value)) return false;
    if (!Array.isArray(value.reasons) || value.reasons.length > PTV_RECOMMENDATION_MAX_REASONS) {
        return false;
    }

    return isPtvRecommendationNonEmptyString(value.id)
        && isPtvRecommendationNonEmptyString(value.title)
        && isPtvRecommendationNonEmptyString(value.mediaType)
        && isPtvRecommendationNonEmptyString(value.source)
        && isPtvRecommendationClassification(value.classification)
        && isPtvRecommendationPositiveInteger(value.rank)
        && isPtvRecommendationFiniteNumber(value.score)
        && isPtvRecommendationFiniteNumber(value.transitionScore)
        && value.reasons.every(isPtvRecommendationNonEmptyString);
}

function isPtvRecommendationGeneratedAt(value: unknown): value is string {
    return typeof value === 'string'
        && PTV_RECOMMENDATION_DATE_TIME_PATTERN.test(value)
        && Number.isFinite(Date.parse(value));
}

/**
 * Validates the complete V2 response at the untrusted plugin boundary. Unknown
 * additive fields are intentionally ignored, while fields consumed by the web
 * client must satisfy the current contract before ranking data can be used.
 */
export function isPtvRecommendationPolicyResponse(
    value: unknown,
    expected: PtvRecommendationPolicyResponseExpectation = {}
): value is PtvRecommendationPolicyResponse {
    if (!isPtvRecommendationRecord(value)) return false;
    if (!Array.isArray(value.items) || value.items.length > PTV_RECOMMENDATION_MAX_ITEMS) return false;

    return value.contractVersion === PTV_RECOMMENDATION_POLICY_CONTRACT_VERSION
        && value.policyVersion === PTV_RECOMMENDATION_POLICY_VERSION
        && value.algorithmId === PTV_RECOMMENDATION_ALGORITHM_ID
        && isPtvRecommendationNonEmptyString(value.requestId)
        && (expected.requestId === undefined || value.requestId === expected.requestId)
        && typeof value.cohort === 'string'
        && isPtvRecommendationSurface(value.surface)
        && (expected.surface === undefined || value.surface === expected.surface)
        && isPtvRecommendationGeneratedAt(value.generatedAt)
        && isPtvRecommendationFiniteNumber(value.generationLatencyMs)
        && value.generationLatencyMs >= 0
        && (value.fallbackReason === undefined
            || value.fallbackReason === null
            || typeof value.fallbackReason === 'string')
        && isPtvRecommendationConstraints(value.constraints)
        && value.items.every(isPtvRankedRecommendationPolicyItem);
}
