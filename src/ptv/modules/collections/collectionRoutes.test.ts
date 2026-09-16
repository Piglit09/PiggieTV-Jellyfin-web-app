import {
    describe,
    expect,
    it,
    vi
} from 'vitest';

import { restorePtvCollectionRouteMemory } from './collectionRoutes';

describe('PTV collection route restoration', () => {
    it('restores the exact saved scroll position after the focus owner runs', () => {
        const page = document.createElement('main');
        const restoreFocus = vi.fn((focusKey: string) => {
            expect(focusKey).toBe('collections-featured-one-open');
            page.scrollTop = 630;
        });

        page.scrollTop = 100;
        restoreFocus('collections-featured-one-open');
        restorePtvCollectionRouteMemory(page, {
            focusKey: 'collections-featured-one-open',
            scrollTop: 830
        });

        expect(restoreFocus).toHaveBeenCalledOnce();
        expect(restoreFocus).toHaveBeenCalledWith('collections-featured-one-open');
        expect(page.scrollTop).toBe(830);
    });

    it('restores scroll without invoking focus when no focus key was saved', () => {
        const page = document.createElement('main');
        const restoreFocus = vi.fn();

        restorePtvCollectionRouteMemory(page, {
            focusKey: '',
            scrollTop: 412
        });

        expect(restoreFocus).not.toHaveBeenCalled();
        expect(page.scrollTop).toBe(412);
    });
});
