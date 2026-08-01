type PtvBrowseLoadOwner = Readonly<{
    currentRouteGeneration: number;
    expectedRouteGeneration: number;
    isMounted: boolean;
    signal?: AbortSignal;
}>;

export function createPtvBrowseCancellationError(message = 'Browse route work was cancelled.') {
    if (typeof DOMException !== 'undefined') {
        return new DOMException(message, 'AbortError');
    }

    return Object.assign(new Error(message), {
        name: 'AbortError'
    });
}

export function isPtvBrowseCancellation(error: unknown, signal?: AbortSignal) {
    if (signal?.aborted) return true;
    if (typeof error === 'string') return /abort|cancel|supersed/i.test(error);
    if (!error || typeof error !== 'object') return false;

    const errorRecord = error as {
        coreError?: { kind?: unknown };
        kind?: unknown;
        message?: unknown;
        name?: unknown;
    };
    const name = typeof errorRecord.name === 'string' ? errorRecord.name : '';
    const message = typeof errorRecord.message === 'string' ? errorRecord.message : '';
    const kind = errorRecord.coreError?.kind || errorRecord.kind;

    return name === 'AbortError'
        || name === 'CanceledError'
        || kind === 'cancelled'
        || /abort|cancel|supersed/i.test(message);
}

export function throwIfPtvBrowseCancelled(error: unknown, signal?: AbortSignal) {
    if (!isPtvBrowseCancellation(error, signal)) return;

    if (error && typeof error === 'object') throw error;
    throw createPtvBrowseCancellationError();
}

export async function recoverPtvBrowseRequestWithFallback<T>(
    error: unknown,
    fallback: () => Promise<T>,
    signal?: AbortSignal
) {
    throwIfPtvBrowseCancelled(error, signal);

    return fallback();
}

export function isPtvBrowseLoadOwnerCurrent(owner: PtvBrowseLoadOwner) {
    return owner.isMounted
        && !owner.signal?.aborted
        && owner.currentRouteGeneration === owner.expectedRouteGeneration;
}

export function assertPtvBrowseLoadOwnerCurrent(owner: PtvBrowseLoadOwner) {
    if (isPtvBrowseLoadOwnerCurrent(owner)) return;

    throw createPtvBrowseCancellationError('Browse route work was superseded.');
}

export function getPtvBrowseSettledCancellation(
    results: readonly PromiseSettledResult<unknown>[],
    signal?: AbortSignal
) {
    for (const result of results) {
        if (result.status === 'rejected' && isPtvBrowseCancellation(result.reason, signal)) {
            return result.reason;
        }
    }

    return undefined;
}

export function getMissingPtvBrowseRetryTaskId(
    retrySectionId: string,
    taskIds: readonly string[]
) {
    if (!retrySectionId || taskIds.includes(retrySectionId)) return '';

    return retrySectionId;
}
