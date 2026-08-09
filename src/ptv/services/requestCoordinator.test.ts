import {
    afterAll,
    beforeAll,
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
const serverConnectionsMocks = vi.hoisted(() => ({
    currentApiClient: vi.fn(() => null)
}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: serverConnectionsMocks.currentApiClient
    }
}));

import { ServerConnections } from 'lib/jellyfin-apiclient';
import {
    classifyPtvRequestLedgerAdmission,
    coordinatePtvJsonRequest,
    getPtvRequestCoordinatorKey,
    getPtvRequestCoordinatorReport,
    getPtvRequestValidationLedgerReport,
    installPtvRequestValidationLedger,
    invalidatePtvCoordinatedRequest,
    isPtvRequestValidationLedgerEnabled,
    recordPtvRequestLedgerIdentityRetired,
    recordPtvRequestLedgerRouteGeneration,
    recordPtvRequestLedgerStaleRejected,
    recordPtvRequestLedgerVisibleRetry,
    resetPtvRequestValidationLedger
} from './requestCoordinator';
import { createPtvAbortController } from '../core/abortController';
import Events from '../../utils/events';

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((complete, fail) => {
        resolve = complete;
        reject = fail;
    });

    return {
        promise,
        reject,
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

    it('keeps the browser validation adapter absent without the build and query opt-in', () => {
        const originalUrl = window.location.href;

        expect(isPtvRequestValidationLedgerEnabled()).toBe(false);
        expect((window.PTV as Record<string, unknown> | undefined)?.requestLedger).toBeUndefined();
        expect((ServerConnections as unknown as { _callbacks?: unknown })._callbacks).toBeUndefined();

        vi.stubGlobal('__PTV_ACCEPTANCE_LEDGER__', true);
        expect(isPtvRequestValidationLedgerEnabled()).toBe(false);
        window.history.replaceState(null, '', '/?ptvAcceptanceLedger=1');
        expect(isPtvRequestValidationLedgerEnabled()).toBe(true);

        window.history.replaceState(null, '', originalUrl);
        vi.unstubAllGlobals();
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

    it('reuses a successful settled promise inside its bounded validity window and invalidates it explicitly', async () => {
        const task = vi.fn(async () => 'complete');
        const key = getPtvRequestCoordinatorKey('GET', 'reusable-contract', true);
        const before = getPtvRequestCoordinatorReport();

        await coordinatePtvJsonRequest(key, task, { reuseSuccessfulForMs: 10_000 });
        await coordinatePtvJsonRequest(key, task, { reuseSuccessfulForMs: 10_000 });

        const afterReuse = getPtvRequestCoordinatorReport();

        expect(task).toHaveBeenCalledTimes(1);
        expect(afterReuse.cacheReusedRequests - before.cacheReusedRequests).toBe(1);
        expect(afterReuse.inFlightCount).toBe(0);
        expect(afterReuse.retainedSuccessfulCount).toBeGreaterThanOrEqual(1);
        expect(invalidatePtvCoordinatedRequest(key)).toBe(true);

        await coordinatePtvJsonRequest(key, task, { reuseSuccessfulForMs: 10_000 });

        expect(task).toHaveBeenCalledTimes(2);
        expect(invalidatePtvCoordinatedRequest(key)).toBe(true);
    });

    it('starts one fresh request after a failed request has settled', async () => {
        const failure = createDeferred<string>();
        const failedTask = vi.fn(() => failure.promise);
        const key = getPtvRequestCoordinatorKey('GET', 'failed-retry-contract', true);
        const first = coordinatePtvJsonRequest(key, failedTask);

        failure.reject(new Error('temporary failure'));

        await expect(first).rejects.toThrow('temporary failure');

        const retryTask = vi.fn(async () => 'recovered');

        await expect(coordinatePtvJsonRequest(key, retryTask)).resolves.toBe('recovered');
        expect(failedTask).toHaveBeenCalledTimes(1);
        expect(retryTask).toHaveBeenCalledTimes(1);
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
        expect(getPtvRequestCoordinatorReport().inFlightCount).toBeGreaterThanOrEqual(1);

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
        expect(getPtvRequestCoordinatorReport().inFlightCount).toBe(0);

        const secondTask = vi.fn(async () => 'fresh');

        await expect(coordinatePtvJsonRequest(key, secondTask)).resolves.toBe('fresh');
        expect(firstTask).toHaveBeenCalledTimes(1);
        expect(secondTask).toHaveBeenCalledTimes(1);
    });

    it('waits for a retired transport to settle before route re-entry starts its replacement', async () => {
        const firstController = createPtvAbortController();
        const retiredTransport = createDeferred<string>();
        const replacementTransport = createDeferred<string>();
        const replacementStarted = createDeferred<void>();
        const key = getPtvRequestCoordinatorKey('GET', 'route-reentry-contract', true);
        let activeTransports = 0;
        let peakActiveTransports = 0;
        const trackTransport = <T>(promise: Promise<T>) => {
            activeTransports += 1;
            peakActiveTransports = Math.max(peakActiveTransports, activeTransports);
            return promise.finally(() => {
                activeTransports -= 1;
            });
        };
        const firstTask = vi.fn(() => trackTransport(retiredTransport.promise));
        const first = coordinatePtvJsonRequest(key, firstTask, {
            signal: firstController.signal
        });

        firstController.abort();

        await expect(first).rejects.toMatchObject({ name: 'AbortError' });

        const replacementTask = vi.fn(() => {
            replacementStarted.resolve(undefined);
            return trackTransport(replacementTransport.promise);
        });
        const replacement = coordinatePtvJsonRequest(key, replacementTask);

        await Promise.resolve();

        expect(replacementTask).not.toHaveBeenCalled();
        expect(getPtvRequestCoordinatorReport().retiringCount).toBeGreaterThanOrEqual(1);

        const retirementError = new Error('retired transport settled');

        retirementError.name = 'AbortError';
        retiredTransport.reject(retirementError);
        await replacementStarted.promise;

        expect(replacementTask).toHaveBeenCalledTimes(1);
        expect(getPtvRequestCoordinatorReport().inFlightCount).toBeGreaterThanOrEqual(1);

        replacementTransport.resolve('fresh');

        await expect(replacement).resolves.toBe('fresh');
        expect(peakActiveTransports).toBe(1);
        expect(activeTransports).toBe(0);
    });

    it('does not coalesce request work across authorization identities', async () => {
        const first = createDeferred<string>();
        const second = createDeferred<string>();
        const taskA = vi.fn(() => first.promise);
        const taskB = vi.fn(() => second.promise);
        const keyA = getPtvRequestCoordinatorKey('GET', 'identity-contract', true, 'server:user-a');
        const keyB = getPtvRequestCoordinatorKey('GET', 'identity-contract', true, 'server:user-b');
        const requestA = coordinatePtvJsonRequest(keyA, taskA);
        const requestB = coordinatePtvJsonRequest(keyB, taskB);

        expect(taskA).toHaveBeenCalledTimes(1);
        expect(taskB).toHaveBeenCalledTimes(1);

        first.resolve('a');
        second.resolve('b');

        await expect(requestA).resolves.toBe('a');
        await expect(requestB).resolves.toBe('b');
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

describe('PTV request validation ledger', () => {
    const originalUrl = window.location.href;

    beforeAll(() => {
        vi.stubGlobal('__PTV_ACCEPTANCE_LEDGER__', true);
        window.history.replaceState(null, '', '/?ptvAcceptanceLedger=1');

        expect(installPtvRequestValidationLedger()).toBe(true);
    });

    beforeEach(() => {
        expect(resetPtvRequestValidationLedger()).toBe(true);
    });

    afterAll(() => {
        window.history.replaceState(null, '', originalUrl);
        vi.unstubAllGlobals();
    });

    it('publishes only the approved numeric count fields and never exact request keys', async () => {
        const deferred = createDeferred<string>();
        const rawKey = getPtvRequestCoordinatorKey(
            'GET',
            'https://private.invalid/Users/synthetic-user/Items/synthetic-item',
            true,
            'synthetic-server:synthetic-user'
        );
        const pending = coordinatePtvJsonRequest(rawKey, () => deferred.promise);
        const report = getPtvRequestValidationLedgerReport();

        expect(Object.keys(report)).toEqual([
            'aborted',
            'active',
            'admitted',
            'concurrentExactDuplicates',
            'failed',
            'failedReplacementHandoffs',
            'identityGeneration',
            'invalidated',
            'peakActive',
            'peakExactTransportOwnership',
            'retired',
            'routeGeneration',
            'sequentialSuccessfulDuplicates',
            'settled',
            'sharedInFlight',
            'staleRejected',
            'successfulBoundedReuse',
            'visibleRetries'
        ]);
        expect(Object.values(report).every(value => Number.isFinite(value))).toBe(true);
        expect(JSON.stringify(report)).not.toContain('private.invalid');
        expect(JSON.stringify(report)).not.toContain('synthetic-user');
        expect(JSON.stringify(getPtvRequestCoordinatorReport())).not.toContain(rawKey);

        deferred.resolve('complete');
        await expect(pending).resolves.toBe('complete');
    });

    it('directly counts one admitted transport shared by two in-flight consumers', async () => {
        const deferred = createDeferred<string>();
        const task = vi.fn(() => deferred.promise);
        const key = getPtvRequestCoordinatorKey('GET', 'ledger-shared-contract', true);
        const first = coordinatePtvJsonRequest(key, task);
        const second = coordinatePtvJsonRequest(key, task);

        expect(getPtvRequestValidationLedgerReport()).toMatchObject({
            active: 1,
            admitted: 1,
            concurrentExactDuplicates: 0,
            peakActive: 1,
            peakExactTransportOwnership: 1,
            sharedInFlight: 1
        });

        deferred.resolve('complete');
        await Promise.all([ first, second ]);

        expect(getPtvRequestValidationLedgerReport()).toMatchObject({
            active: 0,
            settled: 1
        });
    });

    it('separates bounded reuse and explicit invalidation from sequential duplicates', async () => {
        const task = vi.fn(async () => 'complete');
        const key = getPtvRequestCoordinatorKey('GET', 'ledger-reuse-contract', true);

        await coordinatePtvJsonRequest(key, task, { reuseSuccessfulForMs: 10_000 });
        await coordinatePtvJsonRequest(key, task, { reuseSuccessfulForMs: 10_000 });
        expect(invalidatePtvCoordinatedRequest(key)).toBe(true);
        await coordinatePtvJsonRequest(key, task, { reuseSuccessfulForMs: 10_000 });

        expect(task).toHaveBeenCalledTimes(2);
        expect(getPtvRequestValidationLedgerReport()).toMatchObject({
            admitted: 2,
            invalidated: 1,
            sequentialSuccessfulDuplicates: 0,
            successfulBoundedReuse: 1
        });
        expect(invalidatePtvCoordinatedRequest(key)).toBe(true);
    });

    it('classifies one failed transport replacement without counting it as a duplicate', async () => {
        const key = getPtvRequestCoordinatorKey('GET', 'ledger-failed-retry-contract', true);

        await expect(coordinatePtvJsonRequest(key, async () => {
            throw new Error('temporary failure');
        })).rejects.toThrow('temporary failure');
        await expect(coordinatePtvJsonRequest(key, async () => 'recovered')).resolves.toBe('recovered');

        expect(getPtvRequestValidationLedgerReport()).toMatchObject({
            aborted: 0,
            active: 0,
            admitted: 2,
            failed: 1,
            failedReplacementHandoffs: 1,
            peakExactTransportOwnership: 1,
            sequentialSuccessfulDuplicates: 0,
            settled: 1
        });
    });

    it('keeps a replacement behind retirement and directly proves exact transport peak one', async () => {
        const firstController = createPtvAbortController();
        const retiredTransport = createDeferred<string>();
        const replacementTransport = createDeferred<string>();
        const replacementStarted = createDeferred<void>();
        const key = getPtvRequestCoordinatorKey('GET', 'ledger-retirement-contract', true);
        const first = coordinatePtvJsonRequest(key, () => retiredTransport.promise, {
            signal: firstController.signal
        });

        firstController.abort();
        await expect(first).rejects.toMatchObject({ name: 'AbortError' });

        const replacementTask = vi.fn(() => {
            replacementStarted.resolve(undefined);
            return replacementTransport.promise;
        });
        const replacement = coordinatePtvJsonRequest(key, replacementTask);

        await Promise.resolve();
        expect(replacementTask).not.toHaveBeenCalled();
        expect(getPtvRequestValidationLedgerReport()).toMatchObject({
            active: 1,
            admitted: 1,
            retired: 1
        });

        const abortError = new Error('retired transport settled');

        abortError.name = 'AbortError';
        retiredTransport.reject(abortError);
        await replacementStarted.promise;
        replacementTransport.resolve('fresh');
        await expect(replacement).resolves.toBe('fresh');

        expect(getPtvRequestValidationLedgerReport()).toMatchObject({
            aborted: 1,
            active: 0,
            admitted: 2,
            concurrentExactDuplicates: 0,
            failed: 0,
            peakExactTransportOwnership: 1,
            settled: 1
        });
    });

    it('defines sequential duplicates and failed handoffs without identity or route values', () => {
        const compatible = {
            explicitlyInvalidated: false,
            identityCompatible: true,
            now: 100,
            reuseUntil: 101,
            routeCompatible: true
        };

        expect(classifyPtvRequestLedgerAdmission({
            ...compatible,
            previousOutcome: 'settled'
        })).toBe('sequential-successful-duplicate');
        expect(classifyPtvRequestLedgerAdmission({
            ...compatible,
            previousOutcome: 'failed'
        })).toBe('failed-replacement');
        expect(classifyPtvRequestLedgerAdmission({
            ...compatible,
            explicitlyInvalidated: true,
            previousOutcome: 'settled'
        })).toBe('none');
        expect(classifyPtvRequestLedgerAdmission({
            ...compatible,
            identityCompatible: false,
            previousOutcome: 'settled'
        })).toBe('none');
        expect(classifyPtvRequestLedgerAdmission({
            ...compatible,
            previousOutcome: 'settled',
            routeCompatible: false
        })).toBe('none');
        expect(classifyPtvRequestLedgerAdmission({
            ...compatible,
            previousOutcome: 'aborted'
        })).toBe('none');
    });

    it('projects only numeric route and identity generations and counts explicit owner hooks', () => {
        const before = getPtvRequestValidationLedgerReport();

        window.dispatchEvent(new CustomEvent('ptv:routecontrollerchange', {
            detail: {
                routeGeneration: 27,
                routeKey: 'private-route-value'
            }
        }));
        Events.trigger(ServerConnections, 'localusersignedin');
        Events.trigger(ServerConnections, 'localusersignedin');
        getPtvRequestCoordinatorKey('GET', 'identity-projection', true, 'synthetic-identity-a');
        getPtvRequestCoordinatorKey('GET', 'identity-projection', true, 'pending-42');
        Events.trigger(ServerConnections, 'localusersignedout');
        Events.trigger(ServerConnections, 'localusersignedin');
        getPtvRequestCoordinatorKey('GET', 'identity-projection', true, 'synthetic-identity-b');
        expect(recordPtvRequestLedgerIdentityRetired()).toBe(true);
        expect(recordPtvRequestLedgerRouteGeneration('invalid')).toBe(false);
        expect(recordPtvRequestLedgerStaleRejected()).toBe(true);
        expect(recordPtvRequestLedgerVisibleRetry()).toBe(true);

        const after = getPtvRequestValidationLedgerReport();

        expect(after.routeGeneration).toBe(27);
        expect(after.identityGeneration - before.identityGeneration).toBe(4);
        expect(after.staleRejected).toBe(1);
        expect(after.visibleRetries).toBe(1);
        expect(JSON.stringify(after)).not.toContain('private-route-value');
    });

    it('refuses to reset while transport ownership is active', async () => {
        const deferred = createDeferred<string>();
        const pending = coordinatePtvJsonRequest('ledger-reset-contract', () => deferred.promise);

        expect(resetPtvRequestValidationLedger()).toBe(false);

        deferred.resolve('complete');
        await expect(pending).resolves.toBe('complete');
        expect(resetPtvRequestValidationLedger()).toBe(true);
        expect(getPtvRequestValidationLedgerReport()).toMatchObject({
            active: 0,
            admitted: 0,
            settled: 0
        });
    });
});
