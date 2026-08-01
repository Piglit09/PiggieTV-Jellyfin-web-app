import {
    describe,
    expect,
    it
} from 'vitest';

import {
    claimPtvDetailImageRepair,
    clearPtvDetailImageRepairAttempts
} from './detailImageRepairState';

describe('detail image repair ownership', () => {
    it('deduplicates a repair only for the same image element and item', () => {
        const firstImage = document.createElement('img');
        const revisitedImage = document.createElement('img');
        const target = 'https://jellyfin.test/Items/item-a/Images/Thumb';

        expect(claimPtvDetailImageRepair(firstImage, 'item-a', target, 1)).toBe(true);
        expect(claimPtvDetailImageRepair(firstImage, 'item-a', target, 2)).toBe(false);
        expect(claimPtvDetailImageRepair(revisitedImage, 'item-a', target, 2)).toBe(true);
    });

    it('allows a reused details image to repair a different item', () => {
        const image = document.createElement('img');
        const target = 'https://jellyfin.test/Items/shared/Images/Thumb';

        expect(claimPtvDetailImageRepair(image, 'item-a', target, 1)).toBe(true);
        expect(claimPtvDetailImageRepair(image, 'item-b', target, 2)).toBe(true);
    });

    it('retries a transient failure after the bounded repair TTL or a successful load', () => {
        const image = document.createElement('img');
        const target = 'https://jellyfin.test/Items/item-a/Images/Thumb';

        expect(claimPtvDetailImageRepair(image, 'item-a', target, 0)).toBe(true);
        expect(claimPtvDetailImageRepair(image, 'item-a', target, 299_999)).toBe(false);
        expect(claimPtvDetailImageRepair(image, 'item-a', target, 300_000)).toBe(true);

        clearPtvDetailImageRepairAttempts(image);
        expect(claimPtvDetailImageRepair(image, 'item-a', target, 300_001)).toBe(true);
    });
});
