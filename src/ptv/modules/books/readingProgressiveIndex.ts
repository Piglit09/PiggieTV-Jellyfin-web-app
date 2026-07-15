export type PtvReadingIndexStage = 'initial' | 'background' | 'complete' | 'retired';

export type PtvReadingProgressivePage<T> = {
    items: T[];
    totalRecordCount: number;
};

export type PtvReadingProgressiveSnapshot<T> = {
    accumulatedCount: number;
    fetchedCount: number;
    isComplete: boolean;
    items: T[];
    pageCount: number;
    pageSize: number;
    stage: PtvReadingIndexStage;
    totalPageCount: number;
    totalRecordCount: number;
};

type PtvReadingProgressiveLoaderOptions<T> = {
    fetchPage: (startIndex: number, limit: number) => Promise<PtvReadingProgressivePage<T>>;
    getKey: (item: T) => string;
    initialItemCount: number;
    isCurrent?: () => boolean;
    onProgress?: (snapshot: PtvReadingProgressiveSnapshot<T>) => void;
    pageSize: number;
};

export type PtvReadingProgressiveLoader<T> = {
    getSnapshot: () => PtvReadingProgressiveSnapshot<T>;
    hasMore: () => boolean;
    loadInitial: () => Promise<PtvReadingProgressiveSnapshot<T>>;
    loadNext: (stage?: 'initial' | 'background') => Promise<PtvReadingProgressiveSnapshot<T>>;
    retire: () => void;
};

export function createPtvReadingProgressiveLoader<T>({
    fetchPage,
    getKey,
    initialItemCount,
    isCurrent = () => true,
    onProgress,
    pageSize
}: PtvReadingProgressiveLoaderOptions<T>): PtvReadingProgressiveLoader<T> {
    const itemsByKey = new Map<string, T>();
    let fetchedCount = 0;
    let isComplete = false;
    let pageCount = 0;
    let retired = false;
    let totalRecordCount = 0;

    const getSnapshot = (): PtvReadingProgressiveSnapshot<T> => {
        let stage: PtvReadingIndexStage = 'initial';

        if (retired) stage = 'retired';
        else if (isComplete) stage = 'complete';
        else if (fetchedCount >= initialItemCount) stage = 'background';

        return {
            accumulatedCount: itemsByKey.size,
            fetchedCount,
            isComplete: isComplete && !retired,
            items: Array.from(itemsByKey.values()),
            pageCount,
            pageSize,
            stage,
            totalPageCount: totalRecordCount ? Math.ceil(totalRecordCount / pageSize) : 0,
            totalRecordCount
        };
    };

    const retire = () => {
        retired = true;
    };

    const loadNext = async (stage: 'initial' | 'background' = 'background') => {
        if (retired || isComplete || !isCurrent()) {
            retire();
            return getSnapshot();
        }

        const page = await fetchPage(fetchedCount, pageSize);

        if (!isCurrent()) {
            retire();
            return getSnapshot();
        }

        totalRecordCount = Math.max(0, page.totalRecordCount);
        fetchedCount += page.items.length;
        pageCount += 1;

        page.items.forEach(item => {
            const key = getKey(item);

            if (key) itemsByKey.set(key, item);
        });

        isComplete = page.items.length === 0
            || page.items.length < pageSize
            || fetchedCount >= totalRecordCount;

        const snapshot = getSnapshot();

        onProgress?.({
            ...snapshot,
            stage: isComplete ? 'complete' : stage
        });

        return snapshot;
    };

    const loadInitial = async () => {
        while (!retired && !isComplete && fetchedCount < initialItemCount) {
            await loadNext('initial');
        }

        return getSnapshot();
    };

    return {
        getSnapshot,
        hasMore: () => !retired && !isComplete,
        loadInitial,
        loadNext,
        retire
    };
}

export function yieldPtvReadingIndexWork() {
    return new Promise<void>(resolve => {
        globalThis.setTimeout(resolve, 0);
    });
}

export function shouldPreservePtvReadingIndex(
    previousIndexCount: number,
    nextIndexCount: number,
    nextVisibleItemCount: number
) {
    return previousIndexCount > 0 && previousIndexCount > Math.max(nextIndexCount, nextVisibleItemCount);
}
