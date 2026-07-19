import { beforeAll, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
    current: {
        features: ['browse', 'movies'],
        full: '/#/movies?view=genres',
        hash: '#/movies?view=genres',
        id: 'movies',
        layout: 'standard',
        normalizedPath: '/movies',
        owner: 'movies',
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
    getPtvRouteControllerState,
    recordPtvRouteGenerationLifecycle,
    startPtvRouteController
} from './routeController';

function getTestRouteFeatures(routeId: string) {
    if (routeId === 'reading') return ['books', 'reading'];
    if (routeId === 'dashboard') return ['dashboard'];
    if (routeId === 'login') return ['auth'];

    return ['browse', routeId];
}

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

    it('treats shared details routes as native without taking over video playback', () => {
        routeMocks.current = {
            ...routeMocks.current,
            features: ['details'],
            full: '/#/details?id=movie-id',
            hash: '#/details?id=movie-id',
            id: 'details',
            normalizedPath: '/details',
            owner: 'details',
            pageType: 'details'
        };
        window.history.replaceState(null, '', '/#/details?id=movie-id');

        recordPtvRouteGenerationLifecycle('page-render', { page: 'details' });

        expect(getPtvRouteControllerState()).toMatchObject({
            canRenderNative: true,
            fallbackReason: '',
            mode: 'native',
            owner: 'details'
        });

        routeMocks.current = {
            ...routeMocks.current,
            features: ['playback'],
            full: '/#/video',
            hash: '#/video',
            id: 'playback',
            normalizedPath: '/video',
            owner: 'playback',
            pageType: 'playback'
        };
        window.history.replaceState(null, '', '/#/video');

        recordPtvRouteGenerationLifecycle('page-render', { page: 'playback' });

        expect(getPtvRouteControllerState()).toMatchObject({
            canRenderNative: false,
            mode: 'enhanced',
            owner: 'playback'
        });
    });

    it.each([
        ['#/music', 'music'],
        ['#/music/albums', 'music'],
        ['#/books', 'reading'],
        ['#/comics', 'reading'],
        ['#/manga', 'reading'],
        ['#/maga', 'reading']
    ])('keeps PTV-rendered route %s under native shell ownership', (hash, owner) => {
        routeMocks.current = {
            ...routeMocks.current,
            features: owner === 'music' ? ['music'] : ['books', 'reading'],
            full: `/${hash}`,
            hash,
            id: owner,
            normalizedPath: hash.replace('#', ''),
            owner,
            pageType: owner
        };
        window.history.replaceState(null, '', `/${hash}`);

        recordPtvRouteGenerationLifecycle('page-render', { page: owner });

        expect(getPtvRouteControllerState()).toMatchObject({
            canRenderNative: true,
            fallbackReason: '',
            mode: 'native',
            owner
        });
    });

    it('synchronizes Browse, Reading, Dashboard, authentication, and history transitions before lifecycle events', () => {
        const transitions = [
            {
                hash: '#/movies?view=genre&genre=Crime',
                owner: 'movies',
                pageType: 'browse',
                routeId: 'movies'
            },
            {
                hash: '#/shows?view=network&network=AMC',
                owner: 'shows',
                pageType: 'browse',
                routeId: 'shows'
            },
            {
                hash: '#/reading/manga',
                owner: 'reading',
                pageType: 'reading',
                routeId: 'reading'
            },
            {
                hash: '#/dashboard/piggietv',
                owner: 'dashboard',
                pageType: 'dashboard',
                routeId: 'dashboard'
            },
            {
                hash: '#/login?serverid=server-one&url=https%3A%2F%2Fexample.invalid',
                owner: 'login',
                pageType: 'login',
                routeId: 'login'
            },
            {
                hash: '#/reading/manga',
                owner: 'reading',
                pageType: 'reading',
                routeId: 'reading'
            },
            {
                hash: '#/shows?view=network&network=AMC',
                owner: 'shows',
                pageType: 'browse',
                routeId: 'shows'
            }
        ];

        transitions.forEach((transition, index) => {
            routeMocks.current = {
                ...routeMocks.current,
                features: getTestRouteFeatures(transition.routeId),
                full: `/${transition.hash}`,
                hash: transition.hash,
                id: transition.routeId,
                normalizedPath: transition.hash.split('?')[0].replace('#', ''),
                owner: transition.owner,
                pageType: transition.pageType
            };
            window.history.replaceState(null, '', `/${transition.hash}`);

            recordPtvRouteGenerationLifecycle(index === 3 ? 'page-unmount' : 'page-render', {
                page: index === 3 ? 'dashboard' : transition.routeId
            });

            const lifecycleEvents = eventMocks.recordPtvEvent.mock.calls.filter(call => (
                call[0] === 'route' && call[1] === 'route-generation-counter'
            ));
            const lifecycleEvent = lifecycleEvents[lifecycleEvents.length - 1]?.[2];

            expect(lifecycleEvent).toMatchObject({
                routeId: transition.routeId,
                routeOwner: transition.owner
            });
            expect(lifecycleEvent.routeKey).toContain(transition.hash.split('?')[0].replace('#', ''));
        });
    });
});
