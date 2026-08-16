import type { PtvRecommendationRowSettings } from '../recommendations/recommendationSettings';
import { arePtvAdminSnapshotsEqual } from './piggietvConfigurationData';

export type PtvRecommendationSettingsBaseline = PtvRecommendationRowSettings | null | undefined;

export class PtvRecommendationSettingsConflictError extends Error {
    constructor() {
        super('Recommendation settings changed on the server while this page was open.');
        this.name = 'PtvRecommendationSettingsConflictError';
    }
}

export class PtvRecommendationMutationInProgressError extends Error {
    constructor() {
        super('Another recommendation change is already being saved.');
        this.name = 'PtvRecommendationMutationInProgressError';
    }
}

export function recommendationSettingsMatch(
    left: PtvRecommendationSettingsBaseline,
    right: PtvRecommendationSettingsBaseline
) {
    if (left === undefined || right === undefined) return false;
    if (left === null || right === null) return left === right;

    return arePtvAdminSnapshotsEqual(left, right);
}

export async function savePtvRecommendationMutationSafely<TResponse>({
    confirmedBaseline,
    nextSettings,
    normalizeAuthoritative,
    readAuthoritative,
    write
}: {
    confirmedBaseline: PtvRecommendationSettingsBaseline;
    nextSettings: PtvRecommendationRowSettings;
    normalizeAuthoritative: (payload: unknown) => PtvRecommendationRowSettings | null;
    readAuthoritative: () => Promise<unknown>;
    write: (settings: PtvRecommendationRowSettings) => Promise<TResponse>;
}) {
    const authoritativePayload = await readAuthoritative();
    const authoritativeSettings = normalizeAuthoritative(authoritativePayload);

    if (!recommendationSettingsMatch(authoritativeSettings, confirmedBaseline)) {
        throw new PtvRecommendationSettingsConflictError();
    }

    return write(nextSettings);
}

export type PtvRecommendationMutationRequestRef<T> = {
    current: Promise<T> | null;
};

export function runPtvRecommendationMutationSingleFlight<T>(
    requestRef: PtvRecommendationMutationRequestRef<T>,
    operation: () => Promise<T>
) {
    if (requestRef.current) {
        return Promise.reject(new PtvRecommendationMutationInProgressError());
    }

    const request = Promise.resolve()
        .then(operation)
        .finally(() => {
            if (requestRef.current === request) requestRef.current = null;
        });
    requestRef.current = request;

    return request;
}
