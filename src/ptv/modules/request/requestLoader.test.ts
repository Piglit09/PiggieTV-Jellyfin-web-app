import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMocks = vi.hoisted(() => ({
    dispatch: vi.fn(),
    getPortalUrl: vi.fn()
}));

vi.mock('../../core/events', () => ({
    dispatchPtvCustomEvent: requestMocks.dispatch
}));

vi.mock('../integrations/integrationsConfig', () => ({
    getPtvRequestPortalUrl: requestMocks.getPortalUrl
}));

describe('PTV Request lazy activation boundary', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.doMock('./index', () => ({
            closeRequestPortal: vi.fn(),
            openRequestPortal: vi.fn()
        }));
        requestMocks.dispatch.mockReset();
        requestMocks.getPortalUrl.mockReset();
        requestMocks.getPortalUrl.mockResolvedValue('https://request.example.test/');
        window.history.replaceState({}, '', '#/home');
    });

    it('coalesces overlapping activations into exactly one open event', async () => {
        const { openPtvRequestPortal } = await import('./requestLoader');
        const options = { query: 'anonymous title' };
        const firstActivation = openPtvRequestPortal(options);
        const secondActivation = openPtvRequestPortal(options);

        expect(secondActivation).toBe(firstActivation);
        await Promise.all([firstActivation, secondActivation]);

        expect(requestMocks.dispatch).toHaveBeenCalledTimes(1);
        expect(requestMocks.dispatch).toHaveBeenCalledWith(
            'ptv:request:open',
            options
        );
    });

    it('retires a cold activation when the user returns Home on the same route', async () => {
        let finishModuleLoad: (() => void) | undefined;

        vi.doMock('./index', async () => {
            await new Promise<void>(resolve => {
                finishModuleLoad = resolve;
            });

            return {
                closeRequestPortal: vi.fn(),
                openRequestPortal: vi.fn()
            };
        });

        const {
            cancelPendingPtvRequestActivation,
            openPtvRequestPortal
        } = await import('./requestLoader');
        const activation = openPtvRequestPortal();

        await vi.waitFor(() => {
            expect(finishModuleLoad).toBeTypeOf('function');
        });

        cancelPendingPtvRequestActivation();
        finishModuleLoad?.();

        await expect(activation).resolves.toBe(false);
        expect(requestMocks.dispatch).not.toHaveBeenCalled();
        expect(requestMocks.getPortalUrl).not.toHaveBeenCalled();
    });

    it('handles a chunk failure and opens the external fallback once', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation(() => undefined);

        vi.doMock('./index', () => {
            throw new Error('request chunk unavailable');
        });

        const { openPtvRequestPortal } = await import('./requestLoader');
        await expect(openPtvRequestPortal({
            query: 'anonymous title'
        })).resolves.toBe(false);

        expect(requestMocks.dispatch).not.toHaveBeenCalled();
        expect(requestMocks.getPortalUrl).toHaveBeenCalledTimes(1);
        expect(requestMocks.getPortalUrl).toHaveBeenCalledWith('anonymous title');
        expect(click).toHaveBeenCalledTimes(1);
        expect((click.mock.contexts[0] as unknown as HTMLAnchorElement).href)
            .toBe('https://request.example.test/');

        click.mockRestore();
        warn.mockRestore();
    });

    it('uses the same fallback chain when a direct Request route cannot load', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation(() => undefined);

        window.history.replaceState({}, '', '#/requests');
        vi.doMock('./index', () => {
            throw new Error('request chunk unavailable');
        });

        const { ensurePtvRequestRoute } = await import('./requestLoader');
        await expect(ensurePtvRequestRoute()).resolves.toBe(false);

        expect(requestMocks.dispatch).not.toHaveBeenCalled();
        expect(requestMocks.getPortalUrl).toHaveBeenCalledTimes(1);
        expect(click).toHaveBeenCalledTimes(1);

        click.mockRestore();
        warn.mockRestore();
    });
});
