import { afterEach, describe, expect, it } from 'vitest';

import {
    createPtvRuntime,
    markPtvRuntimeReady,
    resetPtvRuntimeForTests
} from '../../core/runtime';
import { getPtvDashboardRuntimeDiagnostics } from './dashboardRuntimeDiagnostics';

describe('dashboard runtime diagnostics ownership', () => {
    afterEach(() => {
        resetPtvRuntimeForTests();
    });

    it('reads the canonical runtime after Reading and Browse navigation without creating another runtime', () => {
        createPtvRuntime('core-app');
        markPtvRuntimeReady();

        window.history.replaceState(null, '', '/#/reading');
        const reading = getPtvDashboardRuntimeDiagnostics();
        window.history.replaceState(null, '', '/#/shows?view=network&network=HBO');
        const browse = getPtvDashboardRuntimeDiagnostics();
        window.history.replaceState(null, '', '/#/dashboard/piggietv');
        const dashboard = getPtvDashboardRuntimeDiagnostics();

        expect(reading).toMatchObject({
            ready: true,
            runtimeCreateCount: 1,
            runtimeOwner: 'core-app',
            runtimeSource: 'window.__PTV_RUNTIME_STATE__'
        });
        expect(browse.runtimeCreateCount).toBe(1);
        expect(dashboard.runtimeCreateCount).toBe(1);
    });
});
