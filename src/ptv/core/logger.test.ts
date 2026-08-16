import { afterEach, describe, expect, it, vi } from 'vitest';

import { destroyPtvLogging, initPtvLogging, ptvLogger } from './logger';

type PtvLoggerWindow = Window & {
    PTV?: {
        duplicateInitializationSuppressed?: number;
        loggerCreateCount?: number;
        loggerReuseCount?: number;
    };
};

afterEach(() => {
    destroyPtvLogging();
    ptvLogger.clear();
    delete (window as unknown as Record<string, unknown>).PTV_DEBUG;
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
});

describe('PTV client logger', () => {
    it('records startup and runtime events without creating a browser download', () => {
        const createObjectUrl = vi.fn();
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');

        vi.stubGlobal('URL', {
            createObjectURL: createObjectUrl,
            revokeObjectURL: vi.fn()
        });

        initPtvLogging();
        ptvLogger.info('Runtime started', {}, 'Runtime');

        expect(createObjectUrl).not.toHaveBeenCalled();
        expect(click).not.toHaveBeenCalled();
    });

    it('reuses the logger owner for repeated initialization in one document', () => {
        const beforeCreateCount = (window as PtvLoggerWindow).PTV?.loggerCreateCount || 0;
        const first = initPtvLogging();
        const second = initPtvLogging();
        const state = (window as PtvLoggerWindow).PTV;

        expect(second).toBe(first);
        expect(state?.loggerCreateCount).toBe(beforeCreateCount + 1);
        expect(state?.loggerReuseCount).toBeGreaterThanOrEqual(1);
        expect(state?.duplicateInitializationSuppressed).toBeGreaterThanOrEqual(1);
    });

    it('redacts credentials from memory entries, routes, browser errors, and debug console output', () => {
        const accessCanary = [ 'PTV_TEST', 'ACCESS_TOKEN', 'logger' ].join('_');
        const passwordCanary = [ 'PTV_TEST', 'PASSWORD', 'logger' ].join('_');
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

        (window as unknown as Record<string, unknown>).PTV_DEBUG = true;
        window.history.replaceState({}, '', `/?api_key=${accessCanary}#/settings`);
        initPtvLogging();
        ptvLogger.error('Authenticated request failed', {
            config: {
                headers: {
                    Authorization: `Bearer ${accessCanary}`
                },
                password: passwordCanary
            },
            tokenCount: 9
        }, 'Authentication');
        window.dispatchEvent(new ErrorEvent('error', {
            error: Object.assign(new Error(`socket?token=${accessCanary}`), {
                headers: { 'X-Emby-Token': accessCanary }
            }),
            message: `socket?token=${accessCanary}`
        }));

        const serializedEntries = JSON.stringify(ptvLogger.getEntries());
        const serializedConsole = JSON.stringify(debug.mock.calls);

        expect(serializedEntries).not.toContain(accessCanary);
        expect(serializedEntries).not.toContain(passwordCanary);
        expect(serializedConsole).not.toContain(accessCanary);
        expect(serializedConsole).not.toContain(passwordCanary);
        expect(serializedEntries).toContain('[REDACTED]');
        expect(serializedEntries).toContain('tokenCount');
    });
});
