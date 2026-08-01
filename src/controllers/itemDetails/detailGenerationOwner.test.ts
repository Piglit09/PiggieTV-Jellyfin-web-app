import {
    describe,
    expect,
    it
} from 'vitest';

import {
    beginPtvDetailPageGeneration,
    isPtvDetailItemGenerationCurrent,
    retirePtvDetailPageGeneration,
    resumePtvDetailPageGeneration,
    stampPtvDetailItemGeneration
} from './detailGenerationOwner';

describe('detail secondary request generation ownership', () => {
    it('rejects an older load of the same item after leave and reopen', () => {
        const page = document.createElement('div');
        const firstItem = { Id: 'series-a' };
        const reopenedItem = { Id: 'series-a' };

        beginPtvDetailPageGeneration(page, 'series-a', 1);
        stampPtvDetailItemGeneration(firstItem, 1);
        expect(isPtvDetailItemGenerationCurrent(page, firstItem)).toBe(true);

        retirePtvDetailPageGeneration(page);
        expect(isPtvDetailItemGenerationCurrent(page, firstItem)).toBe(false);

        beginPtvDetailPageGeneration(page, 'series-a', 2);
        stampPtvDetailItemGeneration(reopenedItem, 2);

        expect(isPtvDetailItemGenerationCurrent(page, firstItem)).toBe(false);
        expect(isPtvDetailItemGenerationCurrent(page, reopenedItem)).toBe(true);
    });

    it('also rejects an older item identity', () => {
        const page = document.createElement('div');
        const oldItem = { Id: 'series-a' };

        beginPtvDetailPageGeneration(page, 'series-b', 2);
        stampPtvDetailItemGeneration(oldItem, 1);

        expect(isPtvDetailItemGenerationCurrent(page, oldItem)).toBe(false);
    });

    it('renews ownership for the same cached item when its page is restored', () => {
        const page = document.createElement('div');
        const cachedItem = { Id: 'series-a' };

        beginPtvDetailPageGeneration(page, 'series-a', 1);
        stampPtvDetailItemGeneration(cachedItem, 1);
        retirePtvDetailPageGeneration(page);

        const resumedItem = resumePtvDetailPageGeneration(page, cachedItem, 3);

        expect(page.dataset.ptvDetailItemId).toBe('series-a');
        expect(page.dataset.ptvDetailGeneration).toBe('3');
        expect(resumedItem).not.toBe(cachedItem);
        expect(isPtvDetailItemGenerationCurrent(page, cachedItem)).toBe(false);
        expect(isPtvDetailItemGenerationCurrent(page, resumedItem)).toBe(true);
    });
});
