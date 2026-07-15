import { describe, expect, it } from 'vitest';

import {
    createPtvReadingProgressiveLoader,
    shouldPreservePtvReadingIndex
} from './readingProgressiveIndex';

describe('Reading progressive index', () => {
    it('indexes all 1,818 items after a bounded 200-item initial stage', async () => {
        const source = Array.from({ length: 1818 }, (_, index) => ({ id: `item-${index}` }));
        const progress: number[] = [];
        const loader = createPtvReadingProgressiveLoader<{ id: string }>({
            fetchPage: async (startIndex, limit) => ({
                items: source.slice(startIndex, startIndex + limit),
                totalRecordCount: source.length
            }),
            getKey: item => item.id,
            initialItemCount: 200,
            onProgress: snapshot => progress.push(snapshot.accumulatedCount),
            pageSize: 50
        });

        const initial = await loader.loadInitial();

        expect(initial.accumulatedCount).toBe(200);
        expect(initial.isComplete).toBe(false);
        expect(initial.pageCount).toBe(4);

        while (loader.hasMore()) await loader.loadNext();

        const complete = loader.getSnapshot();

        expect(complete.accumulatedCount).toBe(1818);
        expect(complete.fetchedCount).toBe(1818);
        expect(complete.isComplete).toBe(true);
        expect(complete.pageCount).toBe(37);
        expect(complete.totalPageCount).toBe(37);
        expect(progress[progress.length - 1]).toBe(1818);
        expect(complete.items.at(-1)?.id).toBe('item-1817');
        expect(complete.items.filter(item => item.id.includes('1817'))).toEqual([
            { id: 'item-1817' }
        ]);
    });

    it('deduplicates repeated item identities without corrupting pagination', async () => {
        const source = [
            { id: 'one', value: 1 },
            { id: 'two', value: 1 },
            { id: 'two', value: 2 },
            { id: 'three', value: 1 }
        ];
        const loader = createPtvReadingProgressiveLoader({
            fetchPage: async (startIndex, limit) => ({
                items: source.slice(startIndex, startIndex + limit),
                totalRecordCount: source.length
            }),
            getKey: item => item.id,
            initialItemCount: 2,
            pageSize: 2
        });

        await loader.loadInitial();
        while (loader.hasMore()) await loader.loadNext();

        expect(loader.getSnapshot().fetchedCount).toBe(4);
        expect(loader.getSnapshot().items).toEqual([
            { id: 'one', value: 1 },
            { id: 'two', value: 2 },
            { id: 'three', value: 1 }
        ]);
    });

    it('retires a late response after ownership changes', async () => {
        let current = true;
        let resolvePage: ((value: { items: Array<{ id: string }>; totalRecordCount: number }) => void) | undefined;
        const loader = createPtvReadingProgressiveLoader<{ id: string }>({
            fetchPage: () => new Promise(resolve => {
                resolvePage = resolve;
            }),
            getKey: item => item.id,
            initialItemCount: 50,
            isCurrent: () => current,
            pageSize: 50
        });
        const request = loader.loadNext('initial');

        current = false;
        resolvePage?.({ items: [{ id: 'stale' }], totalRecordCount: 1 });
        await request;

        expect(loader.getSnapshot().stage).toBe('retired');
        expect(loader.getSnapshot().accumulatedCount).toBe(0);
    });

    it('prevents a late partial shelf from replacing a fuller index', () => {
        expect(shouldPreservePtvReadingIndex(200, 50, 50)).toBe(true);
        expect(shouldPreservePtvReadingIndex(200, 1818, 1818)).toBe(false);
        expect(shouldPreservePtvReadingIndex(50, 200, 200)).toBe(false);
        expect(shouldPreservePtvReadingIndex(1818, 50, 50)).toBe(true);
        expect(shouldPreservePtvReadingIndex(1818, 1800, 1800)).toBe(true);
    });
});
