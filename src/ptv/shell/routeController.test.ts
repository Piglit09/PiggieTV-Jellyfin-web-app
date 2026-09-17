import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import * as routeControllerModule from './routeController';

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
    capturePtvRouteGeneration,
    getPtvRouteControllerState,
    isPtvRouteGenerationCurrent,
    recordPtvRouteGenerationLifecycle,
    startPtvRouteController
} from './routeController';

type PtvRouteLifetimeContract = Readonly<{
    active: boolean;
    generation: number;
    identity: string;
    isCurrent: () => boolean;
    retired: boolean;
    routeFamily: string;
    routeKey: string;
    signal: AbortSignal;
}>;

const routeLifetimeApi = routeControllerModule as typeof routeControllerModule & {
    acquirePtvRouteLifetime: (routeFamily: string) => PtvRouteLifetimeContract;
    retirePtvRouteLifetime: (lifetime: PtvRouteLifetimeContract) => boolean;
};

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

    it('creates only one Manga generation while Request presentation teardown lags', async () => {
        const { getPtvRouteOwnership } = await vi.importActual<typeof import('./routes')>('./routes');
        const synchronizeCurrentLocation = (lifecycle: 'page-mount' | 'page-render') => {
            routeMocks.current = getPtvRouteOwnership(window.location);
            recordPtvRouteGenerationLifecycle(lifecycle, { page: routeMocks.current.id });

            return getPtvRouteControllerState();
        };

        document.documentElement.classList.add('ptv-request-active');

        try {
            window.history.replaceState(null, '', '/#/requests');
            const requestRoute = synchronizeCurrentLocation('page-render');

            window.history.replaceState(null, '', '/#/reading/manga');
            const mangaDuringRequestTeardown = synchronizeCurrentLocation('page-mount');

            document.documentElement.classList.remove('ptv-request-active');
            const mangaAfterRequestTeardown = synchronizeCurrentLocation('page-render');

            expect(requestRoute.owner).toBe('request');
            expect(mangaDuringRequestTeardown).toMatchObject({
                normalizedPath: '/reading/manga',
                owner: 'reading',
                pageType: 'reading'
            });
            expect(mangaDuringRequestTeardown.routeGeneration).toBe(requestRoute.routeGeneration + 1);
            expect(mangaAfterRequestTeardown.routeGeneration).toBe(mangaDuringRequestTeardown.routeGeneration);
            expect(mangaAfterRequestTeardown.routeKey).toBe(mangaDuringRequestTeardown.routeKey);
        } finally {
            document.documentElement.classList.remove('ptv-request-active');
        }
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

    it('rejects a captured generation after route identity changes', () => {
        const token = capturePtvRouteGeneration();

        expect(isPtvRouteGenerationCurrent(token)).toBe(true);

        routeMocks.current = {
            ...routeMocks.current,
            features: ['browse', 'movies'],
            full: '/#/movies?view=latest',
            hash: '#/movies?view=latest',
            id: 'movies',
            normalizedPath: '/movies',
            owner: 'movies',
            pageType: 'browse'
        };
        window.history.replaceState(null, '', '/#/movies?view=latest');

        expect(isPtvRouteGenerationCurrent(token)).toBe(false);
        expect(capturePtvRouteGeneration()).not.toEqual(token);
    });
});

describe('routeController-owned route lifetime', () => {
    const acquiredLifetimes: PtvRouteLifetimeContract[] = [];

    const synchronizeRoute = (routeId: 'home' | 'movies') => {
        const hash = `#/${routeId}`;

        routeMocks.current = {
            ...routeMocks.current,
            features: [ routeId ],
            full: `/${hash}`,
            hash,
            id: routeId,
            normalizedPath: `/${routeId}`,
            owner: routeId,
            pageType: routeId
        };
        window.history.replaceState(null, '', `/${hash}`);
        recordPtvRouteGenerationLifecycle('page-render', { page: routeId });

        return getPtvRouteControllerState();
    };

    const acquireLifetime = (routeFamily: string) => {
        const lifetime = routeLifetimeApi.acquirePtvRouteLifetime(routeFamily);

        acquiredLifetimes.push(lifetime);

        return lifetime;
    };

    afterEach(() => {
        acquiredLifetimes.splice(0).forEach(lifetime => {
            routeLifetimeApi.retirePtvRouteLifetime(lifetime);
        });
    });

    it('returns one immutable family, generation, route identity, and signal contract', () => {
        const route = synchronizeRoute('home');
        const lifetime = acquireLifetime('home');

        expect(Object.keys(lifetime).sort((left, right) => left.localeCompare(right))).toEqual([
            'active',
            'generation',
            'identity',
            'isCurrent',
            'retired',
            'routeFamily',
            'routeKey',
            'signal'
        ]);
        expect(Object.isFrozen(lifetime)).toBe(true);
        expect(Object.getOwnPropertyDescriptor(lifetime, 'active')?.get).toEqual(expect.any(Function));
        expect(Object.getOwnPropertyDescriptor(lifetime, 'retired')?.get).toEqual(expect.any(Function));
        expect(lifetime).toMatchObject({
            active: true,
            retired: false,
            routeFamily: 'home',
            routeKey: route.routeKey
        });
        expect(lifetime.generation).toBeGreaterThan(0);
        expect(lifetime.identity).not.toBe('');
        expect(lifetime.signal).toBeInstanceOf(AbortSignal);
        expect(lifetime.signal.aborted).toBe(false);
        expect(lifetime.isCurrent()).toBe(true);
    });

    it('retires the previous same-family generation when the same route remounts', () => {
        const navigationGeneration = synchronizeRoute('home').routeGeneration;
        const first = acquireLifetime('home');
        const second = acquireLifetime('home');

        expect(second.routeKey).toBe(first.routeKey);
        expect(second.generation).toBeGreaterThan(first.generation);
        expect(second.identity).not.toBe(first.identity);
        expect(first.signal.aborted).toBe(true);
        expect(first.active).toBe(false);
        expect(first.retired).toBe(true);
        expect(first.isCurrent()).toBe(false);
        expect(second.signal.aborted).toBe(false);
        expect(second.active).toBe(true);
        expect(second.retired).toBe(false);
        expect(second.isCurrent()).toBe(true);
        expect(getPtvRouteControllerState().routeGeneration).toBe(navigationGeneration);
    });

    it('retires every active family lifetime when the canonical route changes', () => {
        synchronizeRoute('home');
        const home = acquireLifetime('home');
        const observer = acquireLifetime('home-observer');

        synchronizeRoute('movies');

        for (const lifetime of [ home, observer ]) {
            expect(lifetime.signal.aborted).toBe(true);
            expect(lifetime.active).toBe(false);
            expect(lifetime.retired).toBe(true);
            expect(lifetime.isCurrent()).toBe(false);
        }
    });

    it('retires a lifetime exactly once', () => {
        synchronizeRoute('home');
        const lifetime = acquireLifetime('home');

        expect(routeLifetimeApi.retirePtvRouteLifetime(lifetime)).toBe(true);
        expect(routeLifetimeApi.retirePtvRouteLifetime(lifetime)).toBe(false);
        expect(lifetime.signal.aborted).toBe(true);
        expect(lifetime.active).toBe(false);
        expect(lifetime.retired).toBe(true);
        expect(lifetime.isCurrent()).toBe(false);
    });
});
