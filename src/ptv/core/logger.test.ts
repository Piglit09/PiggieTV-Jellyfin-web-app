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
});
