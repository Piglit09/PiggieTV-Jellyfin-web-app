import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    getPtvWebAppBootstrapSnapshot,
    initializePtvWebAppOnce,
    resetPtvWebAppBootstrapForTests
} from './webAppBootstrap';

afterEach(() => {
    resetPtvWebAppBootstrapForTests();
});

describe('web application bootstrap ownership', () => {
    it('reuses one initialization across duplicate entry and HMR-style evaluation', async () => {
        const initialize = vi.fn(async () => undefined);
        const first = initializePtvWebAppOnce(initialize);
        const second = initializePtvWebAppOnce(initialize);

        expect(first).toBe(second);
        await first;
        await initializePtvWebAppOnce(initialize);

        expect(initialize).toHaveBeenCalledTimes(1);
        expect(getPtvWebAppBootstrapSnapshot()).toEqual({
            initializationCount: 1,
            reuseCount: 2,
            started: true
        });
    });

    it('allows one explicit retry after initialization rejects', async () => {
        const initialize = vi.fn()
            .mockRejectedValueOnce(new Error('bootstrap failed'))
            .mockResolvedValueOnce(undefined);

        await expect(initializePtvWebAppOnce(initialize)).rejects.toThrow('bootstrap failed');
        await initializePtvWebAppOnce(initialize);

        expect(initialize).toHaveBeenCalledTimes(2);
        expect(getPtvWebAppBootstrapSnapshot()).toMatchObject({
            initializationCount: 2,
            started: true
        });
    });
});
