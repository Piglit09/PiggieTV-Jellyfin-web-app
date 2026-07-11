type PtvScheduledRequestOptions<TInput, TResult> = {
    concurrency?: number;
    onTaskFinish?: (input: TInput, result: TResult, index: number) => void;
    onTaskStart?: (input: TInput, index: number) => void;
    signal?: AbortSignal;
};

function createAbortError() {
    if (typeof DOMException !== 'undefined') {
        return new DOMException('PTV media request queue was aborted.', 'AbortError');
    }

    return Object.assign(new Error('PTV media request queue was aborted.'), {
        name: 'AbortError'
    });
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw createAbortError();
}

export async function runPtvScheduledRequests<TInput, TResult>(
    inputs: TInput[],
    worker: (input: TInput, index: number) => Promise<TResult>,
    options: PtvScheduledRequestOptions<TInput, TResult> = {}
): Promise<TResult[]> {
    if (!inputs.length) return [];

    const concurrency = Math.max(1, Math.min(options.concurrency || 2, inputs.length));
    const results = new Array<TResult>(inputs.length);
    let cursor = 0;

    async function runNext(): Promise<void> {
        throwIfAborted(options.signal);

        const index = cursor;

        cursor += 1;

        if (index >= inputs.length) return;

        const input = inputs[index];

        options.onTaskStart?.(input, index);
        const result = await worker(input, index);

        throwIfAborted(options.signal);
        results[index] = result;
        options.onTaskFinish?.(input, result, index);

        await runNext();
    }

    await Promise.all(Array.from({ length: concurrency }, () => runNext()));

    return results;
}
