import { afterEach, describe, expect, it, vi } from 'vitest';

import { isPtvTimeoutError, withPtvTimeout } from './withPtvTimeout';

describe('withPtvTimeout', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('settles a stalled promise with a stable timeout error and invokes cancellation once', async () => {
        vi.useFakeTimers();
        const onTimeout = vi.fn();
        const result = withPtvTimeout(
            new Promise<never>(() => undefined),
            50,
            'The request timed out.',
            onTimeout
        ).catch((error: unknown) => error);

        await vi.advanceTimersByTimeAsync(50);
        const error = await result;

        expect(error).toMatchObject({
            message: 'The request timed out.',
            name: 'PtvTimeoutError'
        });
        expect(isPtvTimeoutError(error)).toBe(true);
        expect(isPtvTimeoutError({ name: 'PtvTimeoutError' })).toBe(true);
        expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('settles immediately when the caller aborts even if the transport ignores cancellation', async () => {
        vi.useFakeTimers();
        const AbortControllerConstructor = globalThis['AbortController'];
        const controller = new AbortControllerConstructor();
        const onTimeout = vi.fn();
        const result = withPtvTimeout(
            new Promise<never>(() => undefined),
            50,
            'The request timed out.',
            onTimeout,
            controller.signal
        ).catch((error: unknown) => error);

        controller.abort();
        const error = await result;
        await vi.advanceTimersByTimeAsync(50);

        expect(error).toMatchObject({ name: 'AbortError' });
        expect(onTimeout).not.toHaveBeenCalled();
    });
});
