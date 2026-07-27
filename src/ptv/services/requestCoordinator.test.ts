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
    getPtvRequestCoordinatorKey
} from './requestCoordinator';

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
        expect(getPtvRequestCoordinatorKey('get', 'contract', false))
            .toBe('GET anon contract');
    });
});
