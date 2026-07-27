import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRuntimeScope } from './scope';

describe('runtime scope timers', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('runs a live timeout once and releases its resource', () => {
        const callback = vi.fn();
        const scope = createRuntimeScope('timeout-live');

        scope.timeout(callback, 25);
        vi.advanceTimersByTime(25);

        expect(callback).toHaveBeenCalledTimes(1);
        expect(scope.resources.size).toBe(0);
    });

    it('does not invoke a delayed browser callback after its window is torn down', () => {
        const callback = vi.fn();
        const scope = createRuntimeScope('timeout-window-teardown');

        scope.timeout(callback, 25);
        vi.stubGlobal('window', undefined);
        vi.advanceTimersByTime(25);

        expect(callback).not.toHaveBeenCalled();
        expect(scope.resources.size).toBe(0);
    });
});
