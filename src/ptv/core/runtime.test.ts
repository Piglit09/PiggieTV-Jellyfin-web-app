import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    awaitPtvRuntimeReady,
    createPtvRuntime,
    getPtvRuntime,
    getPtvRuntimeDiagnostics,
    markPtvRuntimeReady,
    registerPtvRuntimeFeature,
    registerPtvRuntimeListener,
    resetPtvRuntimeForTests
} from './runtime';

describe('PTV runtime accessors', () => {
    afterEach(() => {
        resetPtvRuntimeForTests();
    });

    it('creates the runtime once and lets accessors reuse it without startup work', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const firstRuntime = createPtvRuntime('test-owner');
        const secondRuntime = getPtvRuntime();
        const duplicateRuntime = createPtvRuntime('duplicate-owner');
        const diagnostics = getPtvRuntimeDiagnostics();

        expect(secondRuntime).toBe(firstRuntime);
        expect(duplicateRuntime).toBe(firstRuntime);
        expect(diagnostics.runtimeCreateCount).toBe(1);
        expect(diagnostics.runtimeGetCount).toBe(1);
        expect(diagnostics.runtimeOwner).toBe('test-owner');
        expect(diagnostics.runtimeSource).toBe('window.__PTV_RUNTIME_STATE__');
        expect(diagnostics.initializationCallSites).toEqual([
            'test-owner',
            'duplicate-owner'
        ]);
    });

    it('shares one readiness promise', async () => {
        const runtime = createPtvRuntime('test-owner');
        const readyPromise = awaitPtvRuntimeReady();

        markPtvRuntimeReady();

        await expect(readyPromise).resolves.toBe(runtime);
        expect(getPtvRuntimeDiagnostics()).toMatchObject({
            ready: true,
            runtimeReadyAwaitCount: 1
        });
    });

    it('suppresses duplicate feature and listener registration', () => {
        const featureAttach = vi.fn();
        const listenerAttach = vi.fn(() => vi.fn());

        createPtvRuntime('test-owner');
        registerPtvRuntimeFeature('feature-a', featureAttach);
        registerPtvRuntimeFeature('feature-a', featureAttach);
        registerPtvRuntimeListener('listener-a', listenerAttach);
        registerPtvRuntimeListener('listener-a', listenerAttach);

        expect(featureAttach).toHaveBeenCalledTimes(1);
        expect(listenerAttach).toHaveBeenCalledTimes(1);
        expect(getPtvRuntimeDiagnostics()).toMatchObject({
            duplicateFeatureRegistrationSuppressedCount: 1,
            duplicateListenerSuppressedCount: 1,
            featureRegistrationCount: {
                'feature-a': 1
            },
            listenerRegistrationCount: 1
        });
    });
});
