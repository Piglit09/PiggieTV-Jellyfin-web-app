import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
    getPtvApiUrl: (path: string) => `http://localhost/${path}`
}));
vi.mock('../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    shouldCollectDiagnostics: () => false
}));

import {
    clearPtvImageFailuresForItem,
    getPtvImageFailureDiagnostics,
    hasPtvImageUrlFailed,
    markPtvImageUrlFailed
} from './images';

describe('PTV image failure cache', () => {
    afterEach(() => {
        vi.useRealTimers();
        clearPtvImageFailuresForItem('image-test-item');
    });

    it('suppresses immediate retries but expires isolated failures', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-13T12:00:00Z'));
        const url = 'http://localhost/Items/image-test-item/Images/Primary';

        markPtvImageUrlFailed(url);

        expect(hasPtvImageUrlFailed(url)).toBe(true);
        expect(getPtvImageFailureDiagnostics().cachedFailures).toBeGreaterThan(0);

        vi.advanceTimersByTime((5 * 60 * 1000) + 1);

        expect(hasPtvImageUrlFailed(url)).toBe(false);
    });
});
