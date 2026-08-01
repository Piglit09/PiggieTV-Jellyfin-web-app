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
