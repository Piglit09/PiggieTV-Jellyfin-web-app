import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getPtvServiceWorkerScriptUrl,
    PtvUpdateService
} from './updateService';

function createFixture(options: {
    activationTimeoutMs?: number;
    controller?: unknown;
    getActivityReason?: () => string;
    initialStorage?: Record<string, string>;
    registration?: Record<string, unknown>;
    registrationError?: Error;
    worker?: Record<string, unknown>;
} = {}) {
    const listeners = new Map<string, () => void>();
    const worker = {
        postMessage: vi.fn(),
        state: 'installed',
        ...options.worker
    };
    const registration = {
        addEventListener: vi.fn((type: string, listener: () => void) => listeners.set(type, listener)),
        update: vi.fn().mockResolvedValue(undefined),
        waiting: worker,
        ...options.registration
    };
    const controllerListeners = new Map<string, () => void>();
    const serviceWorker = {
        addEventListener: vi.fn((type: string, listener: () => void) => controllerListeners.set(type, listener)),
        controller: options.controller === undefined ? {} : options.controller,
        getRegistration: options.registrationError ?
            vi.fn().mockRejectedValue(options.registrationError) :
            vi.fn().mockResolvedValue(registration)
    };
    const reload = vi.fn();
    const storage = new Map<string, string>(Object.entries(options.initialStorage || {}));
    const sessionStorage = {
        getItem: (key: string) => storage.get(key) || null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, value)
    };
    const service = new PtvUpdateService({
        activationTimeoutMs: options.activationTimeoutMs,
        getActivityReason: options.getActivityReason,
        reload,
        serviceWorker,
        sessionStorage
    });

    return { controllerListeners, registration, reload, service, storage, worker };
}

describe('PiggieTV update service', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => vi.useRealTimers());

    it('resolves the worker relative to the served Jellyfin Web base path', () => {
        expect(getPtvServiceWorkerScriptUrl()).toBe('serviceworker.js');
    });

    it('stays idle when no service-worker registration exists', async () => {
        const service = new PtvUpdateService({
            serviceWorker: { getRegistration: vi.fn().mockResolvedValue(undefined) }
        });

        await service.start();
        expect(service.getSnapshot().state).toBe('idle');
    });

    it('announces a waiting update', async () => {
        const fixture = createFixture();
        await fixture.service.start();
        expect(fixture.service.getSnapshot().state).toBe('available');
    });

    it('dismisses an update for the session', async () => {
        const fixture = createFixture();
        await fixture.service.start();
        fixture.service.dismiss();
        expect(fixture.service.getSnapshot().state).toBe('dismissed');
    });

    it('activates and reloads after a safe controller transition', async () => {
        const fixture = createFixture();
        await fixture.service.start();

        expect(fixture.service.applyWhenSafe()).toBe(true);
        expect(fixture.worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
        fixture.controllerListeners.get('controllerchange')?.();
        expect(fixture.reload).toHaveBeenCalledOnce();
        expect(fixture.service.getSnapshot().state).toBe('idle');
        fixture.controllerListeners.get('controllerchange')?.();
        vi.advanceTimersByTime(3000);
        expect(fixture.reload).toHaveBeenCalledOnce();
    });

    it('does not let a stale session reload marker suppress a later update', async () => {
        const fixture = createFixture({
            initialStorage: { ['ptv:update:reloading']: 'true' }
        });
        await fixture.service.start();

        fixture.service.applyWhenSafe();
        fixture.controllerListeners.get('controllerchange')?.();

        expect(fixture.reload).toHaveBeenCalledOnce();
    });

    it('falls back to a direct reload when the waiting worker cannot activate', async () => {
        const fixture = createFixture({ worker: { postMessage: undefined } });
        await fixture.service.start();

        expect(fixture.service.applyWhenSafe()).toBe(true);
        expect(fixture.service.getSnapshot().state).toBe('idle');
        expect(fixture.reload).toHaveBeenCalledOnce();
    });

    it('reloads once when controllerchange does not arrive before the timeout', async () => {
        const fixture = createFixture({ activationTimeoutMs: 250 });
        await fixture.service.start();

        fixture.service.applyWhenSafe();
        vi.advanceTimersByTime(249);
        expect(fixture.reload).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(fixture.reload).toHaveBeenCalledOnce();

        fixture.controllerListeners.get('controllerchange')?.();
        expect(fixture.reload).toHaveBeenCalledOnce();
    });

    it('falls back once when an uncontrolled page never receives controllerchange', async () => {
        const fixture = createFixture({ activationTimeoutMs: 250, controller: null });
        await fixture.service.start();

        fixture.service.applyWhenSafe();
        expect(fixture.worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
        vi.advanceTimersByTime(250);

        expect(fixture.reload).toHaveBeenCalledOnce();
        expect(fixture.service.getSnapshot().state).toBe('idle');
    });

    it('treats repeated reload clicks as one activation attempt', async () => {
        const fixture = createFixture();
        await fixture.service.start();

        expect(fixture.service.applyWhenSafe()).toBe(true);
        expect(fixture.service.applyWhenSafe()).toBe(false);
        expect(fixture.worker.postMessage).toHaveBeenCalledOnce();
    });

    it.each([
        ['Playback is active.'],
        ['Dashboard changes have not been saved.']
    ])('defers while activity is unsafe: %s', async activityReason => {
        const fixture = createFixture({ getActivityReason: () => activityReason });
        await fixture.service.start();

        expect(fixture.service.applyWhenSafe()).toBe(false);
        expect(fixture.service.getSnapshot()).toMatchObject({ activityReason, state: 'deferred' });
        expect(fixture.worker.postMessage).not.toHaveBeenCalled();
    });

    it('recovers a deferred update when activity ends', async () => {
        let active = true;
        const fixture = createFixture({ getActivityReason: () => active ? 'Reading is active.' : '' });
        await fixture.service.start();
        fixture.service.applyWhenSafe();

        active = false;
        expect(fixture.service.retryDeferredUpdate()).toBe(true);
        expect(fixture.service.getSnapshot().state).toBe('applying');
    });

    it('reports registration failure without reloading', async () => {
        const fixture = createFixture({ registrationError: new Error('registration unavailable') });
        await fixture.service.start();
        expect(fixture.service.getSnapshot()).toMatchObject({
            error: 'registration unavailable',
            state: 'error'
        });
        expect(fixture.reload).not.toHaveBeenCalled();
    });
});
