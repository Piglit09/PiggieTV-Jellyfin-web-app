export type PtvReadingIdentifyReconciliationDiagnostic =
    | Readonly<{
        category: 'publication';
        reason: 'authoritative' | 'readback';
    }>
    | Readonly<{
        category: 'mutation';
        reason: 'confirmed' | 'duplicate' | 'stale-generation' | 'unconfirmed';
    }>
    | Readonly<{
        category: 'readback';
        reason: 'coalesced' | 'failed' | 'started';
    }>
    | Readonly<{
        category: 'retirement';
        reason: 'authoritative-publish' | 'cancel-all' | 'request-aborted' | 'stale-generation' | 'unconfirmed-mutation';
    }>;

export type PtvReadingIdentifyReconciliationResult<T> =
    | Readonly<{
        generation: number;
        status: 'cancelled';
    }>
    | Readonly<{
        error: unknown;
        generation: number;
        status: 'failed';
    }>
    | Readonly<{
        generation: number;
        status: 'published';
        value: T;
    }>;

export type PtvReadingIdentifyMutationReconciliationResult<T> =
    | Readonly<{
        generation: number;
        operationGeneration: number;
        status: 'ignored-stale';
    }>
    | Readonly<{
        generation: number;
        operationGeneration: number;
        status: 'retained-unconfirmed';
    }>
    | Readonly<{
        generation: number;
        operationGeneration: number;
        status: 'published';
        value: T;
    }>;

type PtvReadingIdentifyReconciliationOptions<T> = Readonly<{
    onDiagnostic?: (event: PtvReadingIdentifyReconciliationDiagnostic) => void;
    publish: (itemId: string, value: T) => void;
    read: (itemId: string, options: Readonly<{ signal: AbortSignal }>) => Promise<T>;
}>;

type RetirementReason = Extract<
    PtvReadingIdentifyReconciliationDiagnostic,
    { category: 'retirement' }
>['reason'];

type ReadbackEntry<T> = {
    cancellationReported: boolean;
    controller: AbortController;
    generation: number;
    promise: Promise<PtvReadingIdentifyReconciliationResult<T>>;
    retirementReason: RetirementReason | null;
};

export type PtvReadingIdentifyReconciliationCoordinator<T> = Readonly<{
    cancelAll: () => void;
    getGeneration: (itemId: string) => number;
    publishAuthoritative: (itemId: string, value: T) => number;
    reconcileMutation: (
        itemId: string,
        value: T,
        result: Readonly<{
            authority: 'confirmed' | 'unconfirmed';
            operationGeneration: number;
        }>
    ) => PtvReadingIdentifyMutationReconciliationResult<T>;
    requestReadback: (itemId: string) => Promise<PtvReadingIdentifyReconciliationResult<T>>;
}>;

function getItemKey(itemId: string) {
    const itemKey = String(itemId || '').trim();

    if (!itemKey) {
        throw new TypeError('A Reading item identifier is required.');
    }

    return itemKey;
}

function getOperationGeneration(operationGeneration: number) {
    if (!Number.isSafeInteger(operationGeneration) || operationGeneration < 1) {
        throw new TypeError('A positive Reading Identify operation generation is required.');
    }

    return operationGeneration;
}

function isAbortError(error: unknown) {
    return Boolean(error && typeof error === 'object' && 'name' in error
        && (error as { name?: unknown }).name === 'AbortError');
}

/**
 * Coordinates per-item Identify readbacks without leaking media identifiers into
 * diagnostics. The coordinator deliberately performs no retries: every request
 * reaches one terminal result and callers decide whether a later readback is useful.
 */
export function createPtvReadingIdentifyReconciliationCoordinator<T>({
    onDiagnostic,
    publish,
    read
}: PtvReadingIdentifyReconciliationOptions<T>): PtvReadingIdentifyReconciliationCoordinator<T> {
    const generations = new Map<string, number>();
    const inFlight = new Map<string, ReadbackEntry<T>>();
    const mutationStates = new Map<string, Readonly<{
        authority: 'confirmed' | 'unconfirmed';
        operationGeneration: number;
        retired: boolean;
    }>>();

    const emit = (event: PtvReadingIdentifyReconciliationDiagnostic) => {
        onDiagnostic?.(event);
    };

    const getGenerationForKey = (itemKey: string) => generations.get(itemKey) || 0;

    const advanceGeneration = (itemKey: string) => {
        const generation = getGenerationForKey(itemKey) + 1;

        generations.set(itemKey, generation);
        return generation;
    };

    const reportCancellation = (entry: ReadbackEntry<T>, reason: RetirementReason) => {
        if (entry.cancellationReported) return;

        entry.cancellationReported = true;
        emit({
            category: 'retirement',
            reason
        });
    };

    const retire = (entry: ReadbackEntry<T>, reason: RetirementReason) => {
        entry.retirementReason = reason;
        reportCancellation(entry, reason);
        entry.controller.abort();
    };

    const retireMutationState = (itemKey: string) => {
        const mutationState = mutationStates.get(itemKey);

        if (!mutationState || mutationState.retired) return;

        mutationStates.set(itemKey, {
            ...mutationState,
            retired: true
        });
    };

    const requestReadback = (itemId: string) => {
        const itemKey = getItemKey(itemId);

        retireMutationState(itemKey);
        const existing = inFlight.get(itemKey);

        if (existing) {
            emit({
                category: 'readback',
                reason: 'coalesced'
            });
            return existing.promise;
        }

        // eslint-disable-next-line compat/compat -- Jellyfin installs its AbortController polyfill before PTV starts.
        const controller = new AbortController();
        const entry: ReadbackEntry<T> = {
            cancellationReported: false,
            controller,
            generation: getGenerationForKey(itemKey),
            promise: undefined as unknown as Promise<PtvReadingIdentifyReconciliationResult<T>>,
            retirementReason: null
        };

        emit({
            category: 'readback',
            reason: 'started'
        });

        entry.promise = Promise.resolve()
            .then(() => read(itemKey, { signal: controller.signal }))
            .then(value => {
                const isCurrent = inFlight.get(itemKey) === entry;
                const isCurrentGeneration = getGenerationForKey(itemKey) === entry.generation;

                if (entry.retirementReason || controller.signal.aborted) {
                    reportCancellation(entry, entry.retirementReason || 'request-aborted');
                    return {
                        generation: getGenerationForKey(itemKey),
                        status: 'cancelled' as const
                    };
                }

                if (!isCurrent || !isCurrentGeneration) {
                    reportCancellation(entry, 'stale-generation');
                    return {
                        generation: getGenerationForKey(itemKey),
                        status: 'cancelled' as const
                    };
                }

                inFlight.delete(itemKey);
                const generation = advanceGeneration(itemKey);

                publish(itemKey, value);
                emit({
                    category: 'publication',
                    reason: 'readback'
                });

                return {
                    generation,
                    status: 'published' as const,
                    value
                };
            })
            .catch((error: unknown) => {
                if (inFlight.get(itemKey) === entry) {
                    inFlight.delete(itemKey);
                }

                if (entry.retirementReason || controller.signal.aborted || isAbortError(error)) {
                    reportCancellation(entry, entry.retirementReason || 'request-aborted');
                    return {
                        generation: getGenerationForKey(itemKey),
                        status: 'cancelled' as const
                    };
                }

                emit({
                    category: 'readback',
                    reason: 'failed'
                });
                return {
                    error,
                    generation: getGenerationForKey(itemKey),
                    status: 'failed' as const
                };
            });

        inFlight.set(itemKey, entry);
        return entry.promise;
    };

    const publishAuthoritative = (itemId: string, value: T) => {
        const itemKey = getItemKey(itemId);
        const pending = inFlight.get(itemKey);

        retireMutationState(itemKey);

        if (pending) {
            inFlight.delete(itemKey);
        }

        const generation = advanceGeneration(itemKey);

        if (pending) {
            retire(pending, 'authoritative-publish');
        }

        publish(itemKey, value);
        emit({
            category: 'publication',
            reason: 'authoritative'
        });

        return generation;
    };

    const reconcileMutation: PtvReadingIdentifyReconciliationCoordinator<T>['reconcileMutation'] = (
        itemId,
        value,
        result
    ) => {
        const itemKey = getItemKey(itemId);
        const operationGeneration = getOperationGeneration(result.operationGeneration);
        const previous = mutationStates.get(itemKey);

        if (previous && operationGeneration < previous.operationGeneration) {
            emit({
                category: 'mutation',
                reason: 'stale-generation'
            });
            return {
                generation: getGenerationForKey(itemKey),
                operationGeneration,
                status: 'ignored-stale'
            };
        }

        if (previous?.retired && operationGeneration === previous.operationGeneration) {
            emit({
                category: 'mutation',
                reason: 'stale-generation'
            });
            return {
                generation: getGenerationForKey(itemKey),
                operationGeneration,
                status: 'ignored-stale'
            };
        }

        if (previous && operationGeneration === previous.operationGeneration) {
            emit({
                category: 'mutation',
                reason: 'duplicate'
            });
            return previous.authority === 'unconfirmed' ? {
                generation: getGenerationForKey(itemKey),
                operationGeneration,
                status: 'retained-unconfirmed'
            } : {
                generation: getGenerationForKey(itemKey),
                operationGeneration,
                status: 'ignored-stale'
            };
        }

        const pending = inFlight.get(itemKey);

        if (pending) {
            inFlight.delete(itemKey);
        }

        const generation = advanceGeneration(itemKey);

        mutationStates.set(itemKey, {
            authority: result.authority,
            operationGeneration,
            retired: false
        });

        if (pending) {
            retire(pending, result.authority === 'confirmed' ? 'authoritative-publish' : 'unconfirmed-mutation');
        }

        if (result.authority === 'unconfirmed') {
            emit({
                category: 'mutation',
                reason: 'unconfirmed'
            });
            return {
                generation,
                operationGeneration,
                status: 'retained-unconfirmed'
            };
        }

        publish(itemKey, value);
        emit({
            category: 'mutation',
            reason: 'confirmed'
        });
        emit({
            category: 'publication',
            reason: 'authoritative'
        });

        return {
            generation,
            operationGeneration,
            status: 'published',
            value
        };
    };

    const cancelAll = () => {
        const pendingEntries = Array.from(inFlight.entries());

        inFlight.clear();
        pendingEntries.forEach(([ itemKey ]) => {
            advanceGeneration(itemKey);
        });
        pendingEntries.forEach(([, entry ]) => {
            retire(entry, 'cancel-all');
        });
        mutationStates.forEach((_state, itemKey) => {
            retireMutationState(itemKey);
        });
    };

    return {
        cancelAll,
        getGeneration: itemId => getGenerationForKey(getItemKey(itemId)),
        publishAuthoritative,
        reconcileMutation,
        requestReadback
    };
}
