import { describe, expect, it } from 'vitest';

import {
    clearPtvCollectionRouteMemory,
    getPtvCollectionRouteMemoryKey,
    getPtvCollectionRetryHref,
    getPtvCollectionSurfaceFocusKey,
    loadPtvCollectionRouteMemory,
    observePtvCollectionRouteMemory,
    savePtvCollectionRouteMemory
} from './collectionRoutes';

describe('Collections retry routing', () => {
    it('keeps an All retry inside the hash router', () => {
        expect(getPtvCollectionRetryHref('/collections', '?view=all'))
            .toBe('#/collections?view=all');
    });

    it('preserves a collection Details retry query', () => {
        expect(getPtvCollectionRetryHref('/collections', '?view=details&collectionId=collection'))
            .toBe('#/collections?view=details&collectionId=collection');
    });
});

describe('Collection focus identity', () => {
    it('stays unique when a collection appears in several surfaces', () => {
        const keys = [
            getPtvCollectionSurfaceFocusKey('featured', 'jellyfin:set'),
            getPtvCollectionSurfaceFocusKey('jellyfin', 'jellyfin:set'),
            getPtvCollectionSurfaceFocusKey('featured', 'jellyfin:set', 'hide')
        ];

        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe('Collection retry route coverage', () => {
    it.each([
        ['/collections', '', '#/collections'],
        ['/collections', '?view=featured', '#/collections?view=featured'],
        ['/collections', '?view=all', '#/collections?view=all'],
        ['/collections', '?view=genre&genre=Science%20Fiction', '#/collections?view=genre&genre=Science%20Fiction'],
        ['/collections/details/jellyfin%3Aset', '?sort=ReleaseDate', '#/collections/details/jellyfin%3Aset?sort=ReleaseDate']
    ])('preserves %s%s as %s', (pathname, search, expected) => {
        expect(getPtvCollectionRetryHref(pathname, search)).toBe(expected);
    });
});

describe('Collection route restoration memory', () => {
    it('is bounded to memory and isolated by authenticated identity and route', () => {
        clearPtvCollectionRouteMemory();
        const firstKey = getPtvCollectionRouteMemoryKey('server-a:user-a', '/collections', '?view=all');
        const secondKey = getPtvCollectionRouteMemoryKey('server-a:user-b', '/collections', '?view=all');

        savePtvCollectionRouteMemory(firstKey, { focusKey: 'collections-jellyfin-set-open', scrollTop: 169 });

        expect(loadPtvCollectionRouteMemory(firstKey)).toEqual({
            focusKey: 'collections-jellyfin-set-open',
            scrollTop: 169
        });
        expect(loadPtvCollectionRouteMemory(secondKey)).toEqual({ focusKey: '', scrollTop: 0 });
    });

    it('captures the outgoing route before cleanup can observe the replacement view', () => {
        clearPtvCollectionRouteMemory();
        const key = getPtvCollectionRouteMemoryKey('server-a:user-a', '/collections', '?view=all');
        const page = document.createElement('main');
        const focusedCard = document.createElement('button');
        focusedCard.dataset.ptvFocusKey = 'collections-all-set-open';
        page.append(focusedCard);
        document.body.append(page);
        focusedCard.focus();
        page.scrollTop = 169;

        const dispose = observePtvCollectionRouteMemory(key, page);
        page.dispatchEvent(new Event('scroll'));
        page.scrollTop = 0;
        dispose();

        expect(loadPtvCollectionRouteMemory(key)).toEqual({
            focusKey: 'collections-all-set-open',
            scrollTop: 169
        });
        page.remove();
    });
});
