export type PtvConfigurationSourceLoaders = {
    loadSettings: () => Promise<unknown>;
    loadStatus: () => Promise<unknown>;
};

export function arePtvAdminSnapshotsEqual(left: unknown, right: unknown) {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function shouldApplyPtvAdminMutationResult(
    submittedRevision: number,
    currentRevision: number
) {
    return submittedRevision === currentRevision;
}

export type PtvAdminMutationCommitDecision = {
    applyToDraft: boolean;
    confirmed: boolean;
};

/**
 * Confirms that a server save result represents the submitted document before
 * it can advance the authoritative baseline. A newer local draft is kept when
 * the request completed after another edit.
 */
export function getPtvAdminMutationCommitDecision<T>({
    areEqual,
    confirmedValue,
    currentRevision,
    submittedRevision,
    submittedValue
}: {
    areEqual: (left: T, right: T) => boolean;
    confirmedValue: T;
    currentRevision: number;
    submittedRevision: number;
    submittedValue: T;
}): PtvAdminMutationCommitDecision {
    const confirmed = areEqual(confirmedValue, submittedValue);

    return {
        applyToDraft: confirmed && shouldApplyPtvAdminMutationResult(
            submittedRevision,
            currentRevision
        ),
        confirmed
    };
}

/**
 * Starts the independent, read-only Configuration sources together. A failure
 * in one source must never prevent the other source from settling.
 */
export function loadPtvConfigurationSources({
    loadSettings,
    loadStatus
}: PtvConfigurationSourceLoaders) {
    return Promise.allSettled([
        Promise.resolve().then(loadStatus),
        Promise.resolve().then(loadSettings)
    ]);
}
