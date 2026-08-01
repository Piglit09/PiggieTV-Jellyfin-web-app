import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
    dispatch: vi.fn(),
    registerModule: vi.fn()
}));

vi.mock('../../core/events', () => ({
    dispatchPtvCustomEvent: routeMocks.dispatch,
    on: vi.fn(() => () => undefined)
}));

vi.mock('../../core/lifecycle', () => ({
    registerModule: routeMocks.registerModule
}));

vi.mock('../../core/scope', () => ({
    resetRuntimeScope: vi.fn(() => ({
        add: vi.fn(() => () => undefined),
        listen: vi.fn(() => () => undefined),
        watchDom: vi.fn(() => () => undefined)
    }))
}));

vi.mock('../integrations/integrationsConfig', () => ({
    getPtvRequestPortalUrl: vi.fn(async () => 'https://request.example.test/')
}));

describe('PTV Request direct-route mounting', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            callback(0);
            return 1;
        });
        document.body.replaceChildren();
        document.body.classList.remove('ptv-request-active');
        document.documentElement.classList.remove('ptv-request-active');
        window.history.replaceState({}, '', '#/home');
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.replaceChildren();
        document.body.classList.remove('ptv-request-active');
        document.documentElement.classList.remove('ptv-request-active');
    });

    it.each([
        '#/requests?search=query',
        '#/requests/',
        '#/request?source=legacy',
        '#/ptv/request/'
    ])('mounts one Request view for direct route %s', async hash => {
        window.history.replaceState({}, '', hash);

        await import('./index');

        expect(document.querySelectorAll('[data-ptv-request-view="true"]'))
            .toHaveLength(1);
        expect(document.documentElement.classList.contains('ptv-request-active'))
            .toBe(true);
    });

    it('does not mount the Request view on a core route', async () => {
        await import('./index');

        expect(document.querySelector('[data-ptv-request-view="true"]')).toBeNull();
        expect(document.documentElement.classList.contains('ptv-request-active'))
            .toBe(false);
    });
});
