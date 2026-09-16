import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/client', () => ({
    getCurrentPtvApiClient: vi.fn(() => null),
    getPtvCurrentUserId: vi.fn(() => '')
}));
vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: vi.fn(() => null)
}));
vi.mock('../../core/observability', async importOriginal => ({
    ...await importOriginal<typeof import('../../core/observability')>(),
    subscribePtvObservability: vi.fn(() => vi.fn())
}));
vi.mock('../../core/tvFocus', async importOriginal => ({
    ...await importOriginal<typeof import('../../core/tvFocus')>(),
    subscribePtvTvNavigation: vi.fn(() => vi.fn())
}));
vi.mock('../../modules/cache/featuredContentCache', () => ({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    FEATURED_CACHE_UPDATED_EVENT: 'ptv:test-featured-cache-updated',
    getFeaturedContentCacheStatus: vi.fn(() => ({
        cacheVersion: null,
        createdAt: null,
        isFresh: false,
        isStored: false,
        itemCount: 0,
        lastRefreshError: null,
        readError: null,
        readInProgress: false,
        sectionCount: 0,
        storage: 'none',
        ttlMs: 0,
        writeError: null
    }))
}));

import {
    bridgePtvDiagnosticObservabilityEvent,
    disposePtvWebDiagnosticPlatformForTests,
    initializePtvWebDiagnosticPlatform
} from './webDiagnosticPlatform';
import {
    getPtvDiagnosticStore,
    resetPtvDiagnosticStoreForTests
} from './diagnosticStore';

type CriticalState = 'cancelled' | 'empty' | 'failed' | 'partial' | 'pending' | 'success';

function publishControllerRoute(path: string, routeGeneration: number) {
    window.history.replaceState(null, '', `/web/#${path}`);
    window.dispatchEvent(new CustomEvent('ptv:routecontrollerchange', {
        detail: {
            hash: `#${path}`,
            normalizedPath: path,
            routeGeneration,
            routeKey: `${path}-route-${routeGeneration}`
        }
    }));
}

function publishCriticalState(
    path: string,
    routeGeneration: number,
    state: CriticalState,
    lifecycleId = `${path}-critical-${routeGeneration}`,
    routeFamily = path.replace(/^\//, '')
) {
    bridgePtvDiagnosticObservabilityEvent({
        at: Date.now(),
        detail: {
            lifecycleId,
            navigationKey: path,
            routeFamily,
            routeGeneration,
            routeKey: `${path}-route-${routeGeneration}`,
            state
        },
        kind: 'event',
        name: 'route-critical-lifecycle',
        type: 'route'
    });
}

describe('diagnostic route ownership', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        window.history.replaceState(null, '', '/web/#/home');
        document.body.innerHTML = '<main data-ptv-route-content="true"></main>';
        initializePtvWebDiagnosticPlatform();
    });

    afterEach(() => {
        disposePtvWebDiagnosticPlatformForTests();
        resetPtvDiagnosticStoreForTests();
        document.body.innerHTML = '';
        vi.useRealTimers();
    });

    it('records one normal navigation exactly once across controller and browser notifications', () => {
        publishControllerRoute('/home', 1);
        window.dispatchEvent(new Event('hashchange'));
        window.dispatchEvent(new Event('popstate'));

        expect(getPtvDiagnosticStore().getSnapshot().routes).toHaveLength(1);
    });

    it('records one direct Manga navigation as exactly one route session', () => {
        publishControllerRoute('/reading/manga', 9);
        window.dispatchEvent(new Event('hashchange'));
        window.dispatchEvent(new Event('popstate'));
        publishControllerRoute('/reading/manga', 9);

        const routes = getPtvDiagnosticStore().getSnapshot().routes;

        expect(routes).toHaveLength(2);
        expect(routes.filter(route => route.routeFamily === 'reading')).toEqual([
            expect.objectContaining({
                routeFamily: 'reading',
                routeGeneration: 9,
                status: 'active'
            })
        ]);
    });

    it('records back navigation as one new session for the returned route', () => {
        publishControllerRoute('/home', 1);
        publishControllerRoute('/music', 2);
        publishControllerRoute('/home', 3);
        window.dispatchEvent(new Event('popstate'));

        const routes = getPtvDiagnosticStore().getSnapshot().routes;

        expect(routes).toHaveLength(3);
        expect(routes.map(route => route.routeFamily)).toEqual([ 'home', 'music', 'home' ]);
        expect(routes.slice(0, 2).every(route => route.status === 'abandoned')).toBe(true);
    });

    it('records forward navigation once when controller, hash, and pop notifications overlap', () => {
        publishControllerRoute('/home', 1);
        publishControllerRoute('/music', 2);
        publishControllerRoute('/home', 3);
        window.dispatchEvent(new Event('popstate'));
        publishControllerRoute('/music', 4);
        window.dispatchEvent(new Event('hashchange'));
        window.dispatchEvent(new Event('popstate'));

        const routes = getPtvDiagnosticStore().getSnapshot().routes;

        expect(routes).toHaveLength(4);
        expect(routes.map(route => route.routeFamily)).toEqual([ 'home', 'music', 'home', 'music' ]);
        expect(routes.slice(0, 3).every(route => route.status === 'abandoned')).toBe(true);
        expect(routes.at(-1)).toMatchObject({
            routeGeneration: 4,
            status: 'active'
        });
    });

    it('records rapid A to B to C navigation as exactly three logical sessions', () => {
        publishControllerRoute('/home', 1);
        publishControllerRoute('/music', 2);
        publishControllerRoute('/reading', 3);

        const routes = getPtvDiagnosticStore().getSnapshot().routes;

        expect(routes).toHaveLength(3);
        expect(routes.map(route => route.routeGeneration)).toEqual([ 1, 2, 3 ]);
        expect(routes.at(-1)).toMatchObject({ routeFamily: 'reading', status: 'active' });
    });

    it('does not create phantom sessions for duplicate hash and controller notifications', () => {
        publishControllerRoute('/home', 1);
        window.dispatchEvent(new Event('hashchange'));
        publishControllerRoute('/home', 1);

        expect(getPtvDiagnosticStore().getSnapshot().routes).toHaveLength(1);
    });

    it('does not settle a visible shell while route-owned critical work is pending', () => {
        publishControllerRoute('/home', 1);
        publishCriticalState('/home', 1, 'pending');
        vi.advanceTimersByTime(1_200);

        expect(getPtvDiagnosticStore().getSnapshot().routes.at(-1)).toMatchObject({
            criticalState: 'pending',
            settledAt: null,
            status: 'active'
        });
    });

    it.each([ 'success', 'empty', 'failed', 'partial' ] as const)(
        'settles only after the route-owned critical generation reaches %s',
        terminalState => {
            publishControllerRoute('/home', 1);
            publishCriticalState('/home', 1, 'pending');
            publishCriticalState('/home', 1, terminalState);
            vi.advanceTimersByTime(700);

            expect(getPtvDiagnosticStore().getSnapshot().routes.at(-1)).toMatchObject({
                criticalState: terminalState,
                status: 'settled'
            });
        }
    );

    it('does not let noncritical background shelves or images block terminal settlement', () => {
        publishControllerRoute('/home', 1);
        publishCriticalState('/home', 1, 'pending');
        document.body.insertAdjacentHTML('beforeend', `
            <section data-ptv-row-mounted="true"></section>
            <img src="/background-work.jpg">
        `);
        publishCriticalState('/home', 1, 'partial');
        vi.advanceTimersByTime(700);

        expect(getPtvDiagnosticStore().getSnapshot().routes.at(-1)).toMatchObject({
            criticalState: 'partial',
            status: 'settled'
        });
    });

    it('does not let a retired route settle after a late terminal event', () => {
        publishControllerRoute('/home', 1);
        publishCriticalState('/home', 1, 'pending', 'home-old');
        publishControllerRoute('/music', 2);
        publishCriticalState('/home', 1, 'success', 'home-old');
        vi.advanceTimersByTime(700);

        const routes = getPtvDiagnosticStore().getSnapshot().routes;

        expect(routes[0]).toMatchObject({
            criticalState: 'pending',
            settledAt: null,
            status: 'abandoned'
        });
        expect(routes[1].routeFamily).toBe('music');
    });

    it('accepts canonical Reading ownership for a nested Reading route', () => {
        publishControllerRoute('/reading/books', 4);
        publishCriticalState('/reading/books', 4, 'pending', 'reading-books-critical', 'reading');
        publishCriticalState('/reading/books', 4, 'success', 'reading-books-critical', 'reading');
        vi.advanceTimersByTime(700);

        expect(getPtvDiagnosticStore().getSnapshot().routes.at(-1)).toMatchObject({
            criticalState: 'success',
            routeFamily: 'reading',
            status: 'settled'
        });
    });
});
