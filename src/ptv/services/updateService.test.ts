import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PtvUpdateService } from './updateService';

function createFixture(options: {
    getActivityReason?: () => string;
    registration?: Record<string, unknown>;
    registrationError?: Error;
} = {}) {
    const listeners = new Map<string, () => void>();
    const worker = {
        postMessage: vi.fn(),
        state: 'installed'
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
        getRegistration: options.registrationError ?
            vi.fn().mockRejectedValue(options.registrationError) :
            vi.fn().mockResolvedValue(registration)
    };
    const reload = vi.fn();
    const storage = new Map<string, string>();
    const sessionStorage = {
        getItem: (key: string) => storage.get(key) || null,
        setItem: (key: string, value: string) => storage.set(key, value)
    };
    const service = new PtvUpdateService({
        getActivityReason: options.getActivityReason,
        reload,
        serviceWorker,
        sessionStorage
    });

    return { controllerListeners, registration, reload, service, worker };
}

describe('PiggieTV update service', () => {
    beforeEach(() => vi.restoreAllMocks());

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
