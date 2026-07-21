import { describe, expect, it, vi } from 'vitest';

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn()
}));

import { claimPtvRecommendationRouteRegistration } from './recommendationRouteRegistration';

describe('recommendation route registration', () => {
    it('claims the route exactly once even when startup modules are evaluated repeatedly', () => {
        const registry = new Set<string>();

        expect(claimPtvRecommendationRouteRegistration(registry, 'piggietv/recommendations')).toBe(true);
        expect(claimPtvRecommendationRouteRegistration(registry, 'piggietv/recommendations')).toBe(false);
        expect(registry.size).toBe(1);
    });
});
