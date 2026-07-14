import { beforeAll, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
    current: {
        features: ['browse', 'movies'],
        full: '/#/movies?view=genres',
        hash: '#/movies?view=genres',
        id: 'movies',
        layout: 'standard',
        normalizedPath: '/movies',
        owner: 'shell',
        pageType: 'browse',
        path: '/'
    }
}));

const eventMocks = vi.hoisted(() => ({
    recordPtvEvent: vi.fn()
}));

vi.mock('../core/events', () => ({
    emit: vi.fn(),
    on: vi.fn()
}));

vi.mock('../core/router', () => ({
    getRoute: vi.fn(() => routeMocks.current),
    scheduleRouteCheck: vi.fn()
}));

vi.mock('../core/observability', () => ({
    recordPtvEvent: eventMocks.recordPtvEvent
}));

vi.mock('../core/runtime', () => ({
    registerPtvRuntimeListener: vi.fn()
}));

vi.mock('./routes', () => ({
    getPtvRouteOwnership: vi.fn(() => routeMocks.current)
}));

import {
    recordPtvRouteGenerationLifecycle,
    startPtvRouteController
} from './routeController';

describe('routeController lifecycle telemetry', () => {
    beforeAll(() => {
        window.history.replaceState(null, '', '/#/movies?view=genres');
        startPtvRouteController();
        eventMocks.recordPtvEvent.mockClear();
    });

    it('synchronizes a query-only navigation before recording shell lifecycle counters', () => {
        routeMocks.current = {
            ...routeMocks.current,
            full: '/#/movies?view=genre&genre=Crime',
            hash: '#/movies?view=genre&genre=Crime'
        };
        window.history.replaceState(null, '', '/#/movies?view=genre&genre=Crime');

        recordPtvRouteGenerationLifecycle('shell-mount', {
            route: window.location.hash
        });

        const lifecycleEvents = eventMocks.recordPtvEvent.mock.calls.filter(call => (
            call[0] === 'route' && call[1] === 'route-generation-counter'
        ));
        const lifecycleEvent = lifecycleEvents[lifecycleEvents.length - 1];

        expect(lifecycleEvent?.[2]).toMatchObject({
            lifecycle: 'shell-mount',
            normalizedPath: '/movies'
        });
        expect(lifecycleEvent?.[2].routeKey).toContain('/movies?genre=Crime&view=genre');
        expect(lifecycleEvent?.[2].route).toBe('#/movies?view=genre&genre=Crime');
    });
});
