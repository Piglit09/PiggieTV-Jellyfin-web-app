export function getProgressiveHomeRowPlan<T>(rows: readonly T[], criticalCount: number) {
    const boundedCriticalCount = Math.max(0, Math.min(rows.length, Math.floor(criticalCount)));

    return {
        criticalRows: rows.slice(0, boundedCriticalCount),
        deferredRows: rows.slice(boundedCriticalCount)
    };
}

export async function runBoundedHomeWork<T, R>(
    items: readonly T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R> | R,
    shouldContinue: () => boolean = () => true
) {
    const completed: Array<{ index: number; value: R }> = [];
    const workerCount = Math.max(1, Math.min(items.length || 1, Math.floor(concurrency) || 1));
    let nextIndex = 0;

    const runWorker = async () => {
        while (nextIndex < items.length && shouldContinue()) {
            const index = nextIndex;

            nextIndex += 1;
            const value = await worker(items[index], index);

            completed.push({ index, value });
        }
    };

    await Promise.all(Array.from({ length: workerCount }, runWorker));

    completed.sort((left, right) => left.index - right.index);

    return completed.map(entry => entry.value);
}
