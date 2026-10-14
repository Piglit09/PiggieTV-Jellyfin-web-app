import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHashRouter } from 'react-router-dom';

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

    it('returns a direct Request entry to the rendered Home route on Close', async () => {
        window.history.replaceState({}, '', '#/requests');
        const router = createHashRouter([
            { path: '/home', element: null },
            { path: '*', element: null }
        ]);

        try {
            expect(router.state.matches.at(-1)?.route.path).toBe('*');

            await import('./index');
            const closeButton = document.querySelector<HTMLButtonElement>('.ptv-request-close');

            expect(closeButton).not.toBeNull();
            closeButton?.click();

            expect(window.location.hash).toBe('#/home');
            expect(router.state.location.pathname).toBe('/home');
            expect(router.state.matches.at(-1)?.route.path).toBe('/home');
            expect(document.querySelector('[data-ptv-request-view="true"]')).toBeNull();
        } finally {
            router.dispose();
        }
    });

    it('ignores an unknown previous route when closing a direct Request entry', async () => {
        window.history.replaceState({}, '', '#/not-a-ptv-route');
        const { openRequestPortal } = await import('./index');

        window.history.replaceState({}, '', '#/requests');
        openRequestPortal({ pushHistory: false });
        document.querySelector<HTMLButtonElement>('.ptv-request-close')?.click();

        expect(window.location.hash).toBe('#/home');
    });

    it('returns to a known PTV route when closing without a Request history marker', async () => {
        window.history.replaceState({}, '', '#/calendar');
        const { openRequestPortal } = await import('./index');

        window.history.replaceState({}, '', '#/requests');
        openRequestPortal({ pushHistory: false });
        document.querySelector<HTMLButtonElement>('.ptv-request-close')?.click();

        expect(window.location.hash).toBe('#/calendar');
    });

    it('preserves browser Back for a Request opened from Home', async () => {
        const { openRequestPortal } = await import('./index');
        const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);

        openRequestPortal();
        expect(window.history.state?.ptvRequestActive).toBe(true);

        document.querySelector<HTMLButtonElement>('.ptv-request-close')?.click();

        expect(back).toHaveBeenCalledOnce();
    });

    it('registers URL-owned routing independently of Request presentation state', async () => {
        routeMocks.registerModule.mockClear();
        await import('./index');

        const registration = routeMocks.registerModule.mock.calls.at(-1)?.[0];
        const matches = registration?.route?.pattern;

        expect(matches).toEqual(expect.any(Function));
        expect(matches({ hash: '#/requests' })).toBe(true);

        document.documentElement.classList.add('ptv-request-active');
        expect(matches({ hash: '#/reading/manga' })).toBe(false);
    });
});
