import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    shouldCollectDiagnostics: () => false
}));

import {
    clearPtvPerformanceMonitor,
    getPtvPerformanceReport,
    recordPtvPerformanceEntry,
    recordPtvRouteTransition
} from './performanceMonitor';

const ACCESS_CANARY = [ 'PTV_TEST', 'ACCESS_TOKEN', 'performance' ].join('_');

describe('performance monitor credential safety', () => {
    beforeEach(() => {
        clearPtvPerformanceMonitor();
        window.history.replaceState(null, '', '/');
    });

    it('sanitizes details and Quick Connect routes before retaining or exporting them', () => {
        recordPtvPerformanceEntry('request', `request?api_key=${ACCESS_CANARY}`, {
            error: Object.assign(new Error(`failed?token=${ACCESS_CANARY}`), {
                config: { headers: { Authorization: `Bearer ${ACCESS_CANARY}` } }
            }),
            tokenCount: 12
        });
        recordPtvRouteTransition(`#/quickconnect?code=${ACCESS_CANARY}`);
        window.location.hash = `#/quickconnect?code=${ACCESS_CANARY}`;

        const serialized = JSON.stringify(getPtvPerformanceReport());

        expect(serialized).not.toContain(ACCESS_CANARY);
        expect(serialized).toContain('[REDACTED]');
        expect(serialized).toContain('"tokenCount":12');
    });
});
