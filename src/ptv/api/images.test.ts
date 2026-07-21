import { describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
    getPtvApiUrl: vi.fn()
}));

vi.mock('../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    shouldCollectDiagnostics: vi.fn(() => false)
}));

import { getPtvItemImageCandidates, getPtvItemImageUrl } from './images';

describe('PTV image startup guards', () => {
    it('defers item-dependent image work without throwing when server context is absent', () => {
        expect(getPtvItemImageUrl({ Id: 'item-without-server' } as never)).toBe('');
        expect(getPtvItemImageCandidates({ Id: 'item-without-server' } as never)).toEqual([]);
        expect(getPtvItemImageCandidates(null)).toEqual([]);
    });
});
