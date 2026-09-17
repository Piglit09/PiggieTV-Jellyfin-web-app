import { describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
    getPtvApiUrl: vi.fn((path: string, query: Record<string, unknown> = {}, serverId = 'ptv') => {
        const params = Object.entries(query).reduce<string[]>((accumulator, [key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                accumulator.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
            }

            return accumulator;
        }, []);

        const queryString = params.length ? `?${params.join('&')}` : '';

        return `https://${serverId || 'ptv'}.test/${path}${queryString}`;
    }),
    getPtvServerId: vi.fn(() => '')
}));

vi.mock('../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    shouldCollectDiagnostics: vi.fn(() => false)
}));

import {
    clearPtvImageFailuresForItem,
    getPtvItemImageCandidates,
    getPtvItemImageUrl,
    markPtvImageCandidateFailed
} from './images';
import type { PtvItem } from './types';

describe('PTV image startup guards', () => {
    it('defers item-dependent image work without throwing when server context is absent', () => {
        expect(getPtvItemImageUrl({ Id: 'item-without-server' } as never)).toBe('');
        expect(getPtvItemImageCandidates({ Id: 'item-without-server' } as never)).toEqual([]);
        expect(getPtvItemImageCandidates(null)).toEqual([]);
    });

    it('only creates candidates for image types advertised by Jellyfin', () => {
        const item = {
            Id: 'advertised-primary',
            ImageTags: { Primary: 'primary-tag' },
            ServerId: 'server-one'
        } as PtvItem;
        const candidates = getPtvItemImageCandidates(item, {
            order: ['Primary', 'Thumb']
        });

        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({
            imageItemId: 'advertised-primary',
            imageType: 'Primary',
            tag: 'primary-tag'
        });
    });

    it('keeps an advertised item primary image on the item when a parent image is also present', () => {
        const item = {
            Id: 'book-with-primary',
            ImageTags: { Primary: 'book-primary-tag' },
            ParentPrimaryImageItemId: 'book-library',
            ParentPrimaryImageTag: 'library-primary-tag',
            ServerId: 'server-one'
        } as PtvItem;
        const candidates = getPtvItemImageCandidates(item, {
            order: [ 'Primary', 'ParentPrimary' ]
        });

        expect(candidates).toHaveLength(2);
        expect(candidates[0]).toMatchObject({
            imageItemId: 'book-with-primary',
            requestedType: 'Primary',
            tag: 'book-primary-tag'
        });
        expect(candidates[0].url).toContain('/Items/book-with-primary/Images/Primary');
        expect(candidates[1]).toMatchObject({
            imageItemId: 'book-library',
            requestedType: 'ParentPrimary',
            tag: 'library-primary-tag'
        });
    });

    it('retains the parent primary fallback when the item has no primary image', () => {
        const item = {
            Id: 'book-without-primary',
            ParentPrimaryImageItemId: 'book-library-fallback',
            ParentPrimaryImageTag: 'library-fallback-tag',
            ServerId: 'server-one'
        } as PtvItem;
        const candidates = getPtvItemImageCandidates(item, {
            order: [ 'Primary', 'ParentPrimary' ]
        });

        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({
            imageItemId: 'book-library-fallback',
            requestedType: 'ParentPrimary',
            tag: 'library-fallback-tag'
        });
    });

    it('pairs ParentBackdropImageTags with the parent backdrop owner', () => {
        const item = {
            Id: 'episode-with-parent-backdrop',
            ParentBackdropImageTags: [ 'parent-backdrop-tag' ],
            ParentBackdropItemId: 'parent-series',
            ServerId: 'server-one'
        } as PtvItem;
        const candidates = getPtvItemImageCandidates(item, {
            order: [ 'Backdrop' ]
        });

        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({
            imageItemId: 'parent-series',
            imageType: 'Backdrop',
            requestedType: 'Backdrop',
            tag: 'parent-backdrop-tag'
        });
        expect(candidates[0].url).toContain('/Items/parent-series/Images/Backdrop/0');
    });

    it('keeps a parent Backdrop as a fallback after an advertised own Backdrop', () => {
        const item = {
            BackdropImageTags: [ 'own-backdrop-tag' ],
            Id: 'book-with-own-and-parent-backdrop',
            ParentBackdropImageTags: [ 'parent-backdrop-tag' ],
            ParentBackdropItemId: 'parent-series-with-backdrop',
            ServerId: 'server-one'
        } as PtvItem;
        const candidates = getPtvItemImageCandidates(item, {
            order: [ 'Backdrop' ]
        });

        expect(candidates).toHaveLength(2);
        expect(candidates.map(candidate => ({
            imageItemId: candidate.imageItemId,
            tag: candidate.tag
        }))).toEqual([
            { imageItemId: 'book-with-own-and-parent-backdrop', tag: 'own-backdrop-tag' },
            { imageItemId: 'parent-series-with-backdrop', tag: 'parent-backdrop-tag' }
        ]);
    });

    it('keeps an own Thumb first and pairs the parent fallback with its own owner', () => {
        const item = {
            Id: 'book-with-own-thumb',
            ImageTags: { Thumb: 'book-thumb-tag' },
            ParentThumbImageTag: 'library-thumb-tag',
            ParentThumbItemId: 'book-library',
            ServerId: 'server-one'
        } as PtvItem;
        const candidates = getPtvItemImageCandidates(item, {
            order: [ 'Thumb' ]
        });

        expect(candidates).toHaveLength(2);
        expect(candidates[0]).toMatchObject({
            imageItemId: 'book-with-own-thumb',
            imageType: 'Thumb',
            requestedType: 'Thumb',
            tag: 'book-thumb-tag'
        });
        expect(candidates[0].url).toContain('/Items/book-with-own-thumb/Images/Thumb');
        expect(candidates[1]).toMatchObject({
            imageItemId: 'book-library',
            imageType: 'Thumb',
            requestedType: 'Thumb',
            tag: 'library-thumb-tag'
        });
        expect(candidates[1].url).toContain('/Items/book-library/Images/Thumb');
    });

    it('pairs a parent Thumb tag with its parent Thumb owner when the item has no Thumb', () => {
        const item = {
            Id: 'book-with-parent-thumb',
            ParentThumbImageTag: 'library-thumb-tag',
            ParentThumbItemId: 'book-library',
            ServerId: 'server-one'
        } as PtvItem;
        const candidates = getPtvItemImageCandidates(item, {
            order: [ 'Thumb' ]
        });

        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({
            imageItemId: 'book-library',
            imageType: 'Thumb',
            requestedType: 'Thumb',
            tag: 'library-thumb-tag'
        });
        expect(candidates[0].url).toContain('/Items/book-library/Images/Thumb');
    });

    it('does not probe unadvertised direct image types', () => {
        const item = {
            Id: 'no-advertised-artwork',
            ServerId: 'server-one'
        } as PtvItem;

        expect(getPtvItemImageCandidates(item, {
            order: ['Primary', 'Thumb', 'Backdrop']
        })).toEqual([]);
    });

    it('falls back to untagged artwork when tags are missing and fallback is allowed', () => {
        const item = {
            Id: 'untagged-primary',
            ServerId: 'server-one'
        } as PtvItem;

        expect(getPtvItemImageCandidates(item, {
            order: ['Primary'],
            includeUntagged: true
        })).toHaveLength(1);
    });

    it('places an untagged fallback after advertised artwork for a stale tag', () => {
        const item = {
            Id: 'stale-tag-primary',
            ImageTags: { Primary: 'stale-tag' },
            ServerId: 'server-one'
        } as PtvItem;
        const candidates = getPtvItemImageCandidates(item, {
            includeUntagged: true,
            order: [ 'Primary' ]
        });

        expect(candidates).toHaveLength(2);
        expect(candidates[0]).toMatchObject({
            tag: 'stale-tag',
            tagMode: 'tagged-primary'
        });
        expect(candidates[1]).toMatchObject({
            tag: '',
            tagMode: 'untagged-primary-fallback',
            untaggedFallbackFor: 'stale-tag'
        });
    });

    it('suppresses a failed image identity across requested types and dimensions', () => {
        const item = {
            Id: 'stale-primary',
            ImageTags: { Primary: 'stale-tag' },
            ServerId: 'server-one'
        } as PtvItem;
        const firstCandidate = getPtvItemImageCandidates(item, {
            baseOptions: { fillWidth: 320 },
            order: ['Primary']
        })[0];

        expect(firstCandidate).toBeDefined();
        markPtvImageCandidateFailed(firstCandidate);

        expect(getPtvItemImageCandidates(item, {
            baseOptions: { fillWidth: 640 },
            order: ['Primary', 'ParentPrimary']
        })).toEqual([]);
    });

    it('allows an item image to retry after its failure suppression is cleared', () => {
        const item = {
            Id: 'reading-item-with-refreshed-artwork',
            ImageTags: { Primary: 'fresh-tag' },
            ServerId: 'server-one'
        } as PtvItem;
        const candidate = getPtvItemImageCandidates(item, {
            order: [ 'Primary' ]
        })[0];

        expect(candidate).toBeDefined();
        markPtvImageCandidateFailed(candidate);
        expect(getPtvItemImageCandidates(item, {
            order: [ 'Primary' ]
        })).toEqual([]);

        clearPtvImageFailuresForItem(item.Id);

        expect(getPtvItemImageCandidates(item, {
            order: [ 'Primary' ]
        })).toHaveLength(1);
    });

    it('does not suppress the same item and tag on another server', () => {
        const firstServerItem = {
            Id: 'shared-item-id',
            ImageTags: { Primary: 'shared-tag' },
            ServerId: 'server-one'
        } as PtvItem;
        const secondServerItem = {
            ...firstServerItem,
            ServerId: 'server-two'
        } as PtvItem;
        const firstCandidate = getPtvItemImageCandidates(firstServerItem, {
            order: [ 'Primary' ]
        })[0];

        markPtvImageCandidateFailed(firstCandidate);

        expect(getPtvItemImageCandidates(secondServerItem, {
            order: [ 'Primary' ]
        })).toHaveLength(1);
    });
});
