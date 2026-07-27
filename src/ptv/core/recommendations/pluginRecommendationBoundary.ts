import {
    normalizePtvRecommendationResponse,
    type PtvCoreRecommendationResponse,
    type PtvRecommendationNormalizationDefaults
} from './recommendationContracts';

export function normalizePtvPluginRecommendationResponse(
    value: unknown,
    defaults: PtvRecommendationNormalizationDefaults
): PtvCoreRecommendationResponse {
    const normalized = normalizePtvRecommendationResponse(value, defaults);

    if (!normalized.success) throw normalized.error;

    return normalized.value;
}
