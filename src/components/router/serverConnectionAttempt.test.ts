import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    getServerConnectionAttemptSnapshot,
    resetServerConnectionAttemptForTests,
    runServerConnectionAttempt
} from './serverConnectionAttempt';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, reject, resolve };
}

afterEach(() => {
    resetServerConnectionAttemptForTests();
});

describe('Jellyfin connection-attempt gate', () => {
    it('shares one authoritative attempt across concurrent StrictMode-style callers', async () => {
        const pending = deferred<never>();
        const connect = vi.fn(() => pending.promise);
        const first = runServerConnectionAttempt(connect);
        const second = runServerConnectionAttempt(connect);

        expect(first).toBe(second);
        expect(connect).not.toHaveBeenCalled();
        await Promise.resolve();
        expect(connect).toHaveBeenCalledTimes(1);
        expect(getServerConnectionAttemptSnapshot()).toEqual({
            active: true,
            attemptCount: 1,
            reuseCount: 1
        });

        pending.reject(new Error('temporary network loss'));
        await expect(first).rejects.toThrow('temporary network loss');
    });

    it('clears a settled attempt so a later recovery owns one fresh call', async () => {
        const connect = vi.fn()
            .mockResolvedValueOnce({ State: 'Unavailable' })
            .mockResolvedValueOnce({ State: 'SignedIn' });

        await runServerConnectionAttempt(connect);
        await runServerConnectionAttempt(connect);

        expect(connect).toHaveBeenCalledTimes(2);
        expect(getServerConnectionAttemptSnapshot()).toMatchObject({
            active: false,
            attemptCount: 2
        });
    });
});
