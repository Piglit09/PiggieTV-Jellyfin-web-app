import { describe, expect, it, vi } from 'vitest';

vi.mock('ptv/modules/dashboard/RemoteDiagnosticsPanel', () => ({
    RemoteDiagnosticsPanel: () => null
}));

vi.mock('ptv/services/diagnostics/webDiagnosticPlatform', () => ({
    refreshPtvWebDiagnosticExternalStatus: vi.fn(() => Promise.resolve())
}));
vi.mock('ptv/modules/recommendations/recommendationRouteRegistration', () => ({
    registerPtvRecommendationRouteOnce: vi.fn()
}));
vi.mock('components/Page', () => ({
    default: () => null
}));

import { ASYNC_ADMIN_ROUTES } from '../_asyncRoutes';
import { Component } from './diagnostics';

describe('PiggieTV diagnostics admin route', () => {
    it('registers the diagnostics page in the protected dashboard route set', () => {
        expect(typeof Component).toBe('function');
        expect(ASYNC_ADMIN_ROUTES).toContainEqual(expect.objectContaining({
            path: 'piggietv/diagnostics'
        }));
    });
});
