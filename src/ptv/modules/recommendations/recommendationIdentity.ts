import type { PtvRecommendationFeedbackState } from './types/recommendationTypes';
import { getPtvDisplayIdentityKey } from '../../services/displayIdentity';

export const PTV_RECOMMENDATION_CACHE_SCHEMA_VERSION = 2;

type PtvRecommendationIdentityInput = Readonly<{
    feedback?: PtvRecommendationFeedbackState;
    includeHomeScans?: boolean;
    serverId: string | null | undefined;
    userId: string | null | undefined;
}>;

function hashIdentityGeneration(value: string) {
    let hash = 2_166_136_261;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
    }

    return (hash >>> 0).toString(36);
}

function getFeedbackGeneration(feedback?: PtvRecommendationFeedbackState) {
    const entries = (feedback?.entries || [])
        .map(entry => ({
            action: entry.action,
            itemId: String(entry.itemId || '').trim().toLowerCase(),
            terms: (entry.terms || [])
                .map(term => String(term || '').trim().toLowerCase())
                .filter(Boolean)
                .sort((left, right) => left.localeCompare(right))
        }))
        .filter(entry => entry.itemId)
        .sort((left, right) => (
            left.itemId.localeCompare(right.itemId)
            || left.action.localeCompare(right.action)
            || left.terms.join(':').localeCompare(right.terms.join(':'))
        ));

    return entries.length ? hashIdentityGeneration(JSON.stringify(entries)) : 'default';
}

export function getPtvRecommendationCacheScopePrefix(input: Pick<PtvRecommendationIdentityInput, 'serverId' | 'userId'>) {
    const identityKey = getPtvDisplayIdentityKey(input.serverId, input.userId);

    if (!identityKey) {
        throw new Error('Recommendation caching requires an authenticated server user.');
    }

    return `ptv-recommendations:v${PTV_RECOMMENDATION_CACHE_SCHEMA_VERSION}:${identityKey}:`;
}

export function createPtvRecommendationIdentity(input: PtvRecommendationIdentityInput) {
    const serverId = String(input.serverId || '').trim();
    const userId = String(input.userId || '').trim();
    const cacheScopePrefix = getPtvRecommendationCacheScopePrefix({ serverId, userId });
    const preferenceGeneration = getFeedbackGeneration(input.feedback);
    const sourceGeneration = input.includeHomeScans ? 'home-scans-v1' : 'primary-sources-v1';

    return {
        cacheKey: `${cacheScopePrefix}preferences-${preferenceGeneration}:sources-${sourceGeneration}`,
        preferenceGeneration,
        serverId,
        sourceGeneration,
        userId
    } as const;
}
