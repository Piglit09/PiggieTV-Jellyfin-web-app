import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import {
    awaitPtvDetailLoad,
    clearPtvDetailLoadFailure,
    PtvDetailLoadTimeoutError,
    renderPtvDetailLoadFailure
} from './detailLoadRecovery';
import { createPtvAbortController } from '../../ptv/core/abortController';

afterEach(() => {
    vi.useRealTimers();
});

describe('detail load recovery', () => {
    it('reaches a bounded terminal state when the transport never settles', async () => {
        vi.useFakeTimers();
        const onTimeout = vi.fn();
        const request = awaitPtvDetailLoad(new Promise(() => undefined), {
            onTimeout,
            timeoutMs: 100
        });
        const assertion = expect(request).rejects.toBeInstanceOf(PtvDetailLoadTimeoutError);

        await vi.advanceTimersByTimeAsync(100);
        await assertion;
        expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('aborts the owned transport on timeout while preserving a timeout result', async () => {
        vi.useFakeTimers();
        const controller = createPtvAbortController();
        const request = awaitPtvDetailLoad(new Promise(() => undefined), {
            onTimeout: () => controller.abort(),
            signal: controller.signal,
            timeoutMs: 100
        });
        const assertion = expect(request).rejects.toBeInstanceOf(PtvDetailLoadTimeoutError);

        await vi.advanceTimersByTimeAsync(100);

        await assertion;
        expect(controller.signal.aborted).toBe(true);
    });

    it('retires a request without allowing its late value to commit', async () => {
        const controller = createPtvAbortController();
        let resolveRequest!: (value: string) => void;
        const transport = new Promise<string>(resolve => {
            resolveRequest = resolve;
        });
        const request = awaitPtvDetailLoad(transport, {
            signal: controller.signal,
            timeoutMs: 1_000
        });

        controller.abort();
        resolveRequest('stale details');

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('renders one explicit retry action and clears it on the next attempt', () => {
        const page = document.createElement('div');
        const host = document.createElement('div');
        const retry = vi.fn();

        host.className = 'detailPagePrimaryContainer';
        page.append(host);
        renderPtvDetailLoadFailure(page, 'The server did not respond.', retry);

        const button = page.querySelector<HTMLButtonElement>('.ptv-detail-load-failure button');
        button?.click();

        expect(retry).toHaveBeenCalledTimes(1);
        expect(page.querySelectorAll('.ptv-detail-load-failure')).toHaveLength(1);

        clearPtvDetailLoadFailure(page);
        expect(page.querySelector('.ptv-detail-load-failure')).toBeNull();
    });
});
