import { describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
    getPtvApiUrl: vi.fn((path: string, query: Record<string, unknown> = {}) => {
        const params = new URLSearchParams();

        Object.entries(query).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
        });

        return `https://ptv.test/${path}${params.size ? `?${params.toString()}` : ''}`;
    })
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
});
