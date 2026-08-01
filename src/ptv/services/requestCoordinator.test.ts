import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

vi.mock('../core/observability', () => ({
    recordPtvEvent: vi.fn()
}));
vi.mock('./performanceMonitor', () => ({
    incrementPtvPerformanceCounter: vi.fn(),
    recordPtvPerformanceEntry: vi.fn()
}));
vi.mock('./runtimeStability', () => ({
    normalizePtvRouteLocation: () => ({
        routeKey: 'test-route'
    })
}));

import {
    coordinatePtvJsonRequest,
    getPtvRequestCoordinatorKey,
    getPtvRequestCoordinatorReport
} from './requestCoordinator';
import { createPtvAbortController } from '../core/abortController';

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(complete => {
        resolve = complete;
    });

    return {
        promise,
        resolve
    };
}

function createAbortRejectingTask() {
    return vi.fn((signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
            const error = new Error('transport aborted');
            error.name = 'AbortError';
            reject(error);
        }, { once: true });
    }));
}

describe('PTV request coordinator', () => {
    beforeEach(async () => {
        // Ensure any prior test finalizers have removed their in-flight entries.
        await Promise.resolve();
    });

    it('shares one promise for concurrent callers using the same key', async () => {
        const request = createDeferred<string>();
        const task = vi.fn(() => request.promise);
        const key = getPtvRequestCoordinatorKey('GET', 'same-contract', true);

        const first = coordinatePtvJsonRequest(key, task);
        const second = coordinatePtvJsonRequest(key, task);

        expect(second).toBe(first);
        expect(task).toHaveBeenCalledTimes(1);

        request.resolve('complete');

        await expect(first).resolves.toBe('complete');
        await expect(second).resolves.toBe('complete');
    });

    it('removes a settled request so a later caller performs fresh work', async () => {
        const task = vi.fn(async () => 'complete');
        const key = getPtvRequestCoordinatorKey('GET', 'fresh-contract', true);

        await coordinatePtvJsonRequest(key, task);
        await coordinatePtvJsonRequest(key, task);

        expect(task).toHaveBeenCalledTimes(2);
    });

    it('keeps authentication scope and request identity in the key', () => {
        expect(getPtvRequestCoordinatorKey('get', 'contract', true))
            .toBe('GET auth contract');
        expect(getPtvRequestCoordinatorKey('get', 'contract', true, 'server-a:user-a'))
            .toBe('GET auth:server-a:user-a contract');
        expect(getPtvRequestCoordinatorKey('get', 'contract', false))
            .toBe('GET anon contract');
    });

    it('detaches one cancelled consumer without aborting shared work for another consumer', async () => {
        const request = createDeferred<string>();
        const firstController = createPtvAbortController();
        const secondController = createPtvAbortController();
        const task = vi.fn((signal: AbortSignal) => {
            expect(signal.aborted).toBe(false);
            return request.promise;
        });
        const key = getPtvRequestCoordinatorKey('GET', 'shared-abort-contract', true);

        const first = coordinatePtvJsonRequest(key, task, {
            signal: firstController.signal
        });
        const second = coordinatePtvJsonRequest(key, task, {
            signal: secondController.signal
        });

        firstController.abort();

        await expect(first).rejects.toMatchObject({ name: 'AbortError' });
        expect(task).toHaveBeenCalledTimes(1);
        expect(getPtvRequestCoordinatorReport().inFlightKeys).toContain(key);

        request.resolve('complete');

        await expect(second).resolves.toBe('complete');
    });

    it('aborts and retires transport when its last owned consumer leaves', async () => {
        const firstController = createPtvAbortController();
        const firstTask = createAbortRejectingTask();
        const key = getPtvRequestCoordinatorKey('GET', 'retired-abort-contract', true);
        const first = coordinatePtvJsonRequest(key, firstTask, {
            signal: firstController.signal
        });

        firstController.abort();

        await expect(first).rejects.toMatchObject({ name: 'AbortError' });
        expect(getPtvRequestCoordinatorReport().inFlightKeys).not.toContain(key);

        const secondTask = vi.fn(async () => 'fresh');

        await expect(coordinatePtvJsonRequest(key, secondTask)).resolves.toBe('fresh');
        expect(firstTask).toHaveBeenCalledTimes(1);
        expect(secondTask).toHaveBeenCalledTimes(1);
    });

    it('does not start work for a consumer that was already cancelled', async () => {
        const controller = createPtvAbortController();
        const task = vi.fn(async () => 'unexpected');

        controller.abort();

        await expect(coordinatePtvJsonRequest('already-aborted', task, {
            signal: controller.signal
        })).rejects.toMatchObject({ name: 'AbortError' });
        expect(task).not.toHaveBeenCalled();
    });
});
