import { afterEach, describe, expect, it, vi } from 'vitest';

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
    FEATURED_CACHE_UPDATED_EVENT: 'ptv:featured-cache-updated',
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
    bridgePtvFocusDiagnosticEvent,
    classifyPtvDiagnosticFocusElement,
    classifyPtvDiagnosticShelfStatus,
    createPtvImageRemountGuard,
    createPtvImageLifecycleTracker,
    disposePtvWebDiagnosticPlatformForTests,
    getPtvDiagnosticNavigationIdentity,
    initializePtvWebDiagnosticPlatform,
    isPtvDiagnosticFocusVisible,
    isPtvDiagnosticRouteContentReady,
    isPtvDiagnosticsRouteFamily,
    normalizePtvPlaybackSessionSnapshot,
    PTV_PLAYBACK_SESSION_SNAPSHOT_EVENT
} from './webDiagnosticPlatform';
import {
    getPtvDiagnosticStore,
    resetPtvDiagnosticStoreForTests
} from './diagnosticStore';

afterEach(() => {
    disposePtvWebDiagnosticPlatformForTests();
    resetPtvDiagnosticStoreForTests();
    document.body.innerHTML = '';
    vi.useRealTimers();
});

describe('web diagnostic platform privacy classification', () => {
    it('classifies focus from safe semantics without returning labels or media IDs', () => {
        const card = document.createElement('article');
        const button = document.createElement('button');

        card.dataset.ptvItemId = 'private-media-id';
        button.textContent = 'Private movie title';
        button.setAttribute('aria-label', 'Private movie title');
        card.appendChild(button);
        document.body.appendChild(card);

        expect(classifyPtvDiagnosticFocusElement(button)).toBe('media-card');
        card.remove();
    });

    it('uses dialog, menu, player, navigation, and generic button categories', () => {
        const cases = [
            [ '<dialog open><button>Close</button></dialog>', 'dialog-control' ],
            [ '<div role="menu"><button role="menuitem">Item</button></div>', 'menu-item' ],
            [ '<div class="ptv-player-controls"><button>Play</button></div>', 'player-control' ],
            [ '<nav><a href="#">Home</a></nav>', 'nav-item' ],
            [ '<button>Action</button>', 'button' ]
        ] as const;

        cases.forEach(([ html, expected ]) => {
            const host = document.createElement('div');

            host.innerHTML = html;
            document.body.appendChild(host);
            expect(classifyPtvDiagnosticFocusElement(host.querySelector('button, a'))).toBe(expected);
            host.remove();
        });
    });

    it('redacts every prohibited user, device, DOM, media, route, host, key, and credential sentinel', () => {
        const privateHost = [ '192', '168', '8', '4' ].join('.');
        const rawUserAgent = 'LG-private-user-agent';
        const rawDomId = 'private-dom-id-9173';
        const rawSelector = `#${rawDomId} > .secret-title`;
        const rawElementText = 'Private element text 4481';
        const rawTitle = 'Private media title 5592';
        const rawMediaId = 'aaaabbbbccccddddeeeeffff00001111';
        const rawQueryValue = 'private-query-value-6204';
        const rawDeviceId = 'private-device-id-7315';
        const rawSerialNumber = 'private-serial-number-8426';
        const rawToken = 'private-access-token-9537';
        const rawCookie = 'private-cookie-value-1648';

        bridgePtvFocusDiagnosticEvent(new CustomEvent('ptv:focus-diagnostic', {
            detail: {
                detail: {
                    accessToken: rawToken,
                    cookie: rawCookie,
                    deviceId: rawDeviceId,
                    domId: rawDomId,
                    elementText: rawElementText,
                    eventType: 'keydown',
                    failureReason: rawTitle,
                    focusedFingerprint: rawSelector,
                    inputId: rawMediaId,
                    inputSource: rawUserAgent,
                    inputStage: 'completed',
                    keyCategory: '461',
                    keyCode: 461,
                    mediaId: rawMediaId,
                    mediaTitle: rawTitle,
                    rawUserAgent,
                    route: `#/details?id=${rawMediaId}&host=${privateHost}&q=${rawQueryValue}`,
                    serialNumber: rawSerialNumber,
                    stageSequence: 9,
                    targetCategory: rawTitle
                },
                name: 'ptv-tv-input-pipeline'
            }
        }));

        const exported = getPtvDiagnosticStore().createExport({
            generatedAt: '2026-07-25T12:00:00.000Z'
        });
        const input = exported.inputs.at(-1);
        const serialized = JSON.stringify(exported);

        expect(input).toMatchObject({
            failureReason: 'none',
            inputId: expect.stringMatching(/^remote-input-/),
            routeFamily: 'details',
            safeAction: 'unknown',
            source: 'keyboard',
            targetCategory: 'unknown'
        });
        [
            privateHost,
            rawUserAgent,
            rawDomId,
            rawSelector,
            rawElementText,
            rawTitle,
            rawMediaId,
            rawQueryValue,
            rawDeviceId,
            rawSerialNumber,
            rawToken,
            rawCookie,
            '"keyCode"',
            '"rawUserAgent"'
        ].forEach(sentinel => {
            expect(serialized).not.toContain(sentinel);
        });
    });

    it('classifies off-screen focus without exporting precise coordinates', () => {
        const button = document.createElement('button');

        button.getBoundingClientRect = vi.fn(() => ({
            bottom: 1100,
            height: 50,
            left: 10,
            right: 110,
            toJSON: () => ({}),
            top: 1050,
            width: 100,
            x: 10,
            y: 1050
        }));
        document.body.append(button);

        expect(isPtvDiagnosticFocusVisible(button)).toBe(false);
    });

    it('reads the diagnostic snapshot once for a continuous scroll burst', () => {
        const store = getPtvDiagnosticStore();
        const getSnapshot = vi.spyOn(store, 'getSnapshot');
        const scrollTarget = document.createElement('div');

        document.body.append(scrollTarget);
        initializePtvWebDiagnosticPlatform();
        const baselineCallCount = getSnapshot.mock.calls.length;

        scrollTarget.dispatchEvent(new Event('scroll', { bubbles: false }));
        scrollTarget.dispatchEvent(new Event('scroll', { bubbles: false }));
        scrollTarget.dispatchEvent(new Event('scroll', { bubbles: false }));

        expect(getSnapshot.mock.calls.length - baselineCallCount).toBe(1);
    });

    it('records one image request and terminal event per element/source generation', () => {
        let now = 10;
        const tracker = createPtvImageLifecycleTracker(() => now++);
        const image = document.createElement('img');

        image.setAttribute('src', '/logo.png');
        expect(tracker.begin(image)).toMatchObject({ terminal: false });
        expect(tracker.begin(image)).toBeNull();
        expect(tracker.complete(image)).toMatchObject({ terminal: true });
        expect(tracker.complete(image)).toBeNull();

        image.setAttribute('src', '/logo-next.png');
        expect(tracker.begin(image)).toMatchObject({ terminal: false });
        tracker.forget(image);
        expect(tracker.begin(image)).toMatchObject({ terminal: false });
    });

    it('suppresses an unchanged diagnostic image remounted in the same scope', () => {
        const guard = createPtvImageRemountGuard();
        const first = document.createElement('img');
        const replacement = document.createElement('img');
        first.setAttribute('src', '/logo.png');
        replacement.setAttribute('src', '/logo.png');

        expect(guard.shouldRecord('diagnostics', first)).toBe(true);
        expect(guard.shouldRecord('diagnostics', replacement)).toBe(false);

        replacement.setAttribute('src', '/logo-next.png');
        expect(guard.shouldRecord('diagnostics', replacement)).toBe(true);
        expect(guard.shouldRecord('another-route', first)).toBe(true);
    });

    it('recognizes both native and retained legacy Diagnostics route families', () => {
        expect(isPtvDiagnosticsRouteFamily('settings/admin/piggietv/diagnostics')).toBe(true);
        expect(isPtvDiagnosticsRouteFamily('dashboard/piggietv/diagnostics')).toBe(true);
        expect(isPtvDiagnosticsRouteFamily('settings/admin/piggietv/configuration')).toBe(false);
    });

    it('does not settle while route-critical or visible shelf work is pending', () => {
        const host = document.createElement('main');
        const shelf = document.createElement('section');

        shelf.dataset.ptvRowMounted = 'true';
        shelf.getBoundingClientRect = vi.fn(() => ({
            bottom: 300,
            height: 200,
            left: 0,
            right: 800,
            toJSON: () => ({}),
            top: 100,
            width: 800,
            x: 0,
            y: 100
        }));
        host.appendChild(shelf);
        document.body.appendChild(host);

        expect(isPtvDiagnosticRouteContentReady(host)).toBe(false);
        shelf.dataset.ptvRowResumed = 'true';
        expect(isPtvDiagnosticRouteContentReady(host)).toBe(true);
        host.dataset.ptvRouteCriticalPending = 'true';
        expect(isPtvDiagnosticRouteContentReady(host)).toBe(false);
    });

    it('deduplicates initial, controller, hash, and pop route starts by canonical navigation identity', () => {
        window.history.replaceState(null, '', '/web/#/music?b=2&a=1');
        initializePtvWebDiagnosticPlatform();

        window.dispatchEvent(new CustomEvent('ptv:routecontrollerchange', {
            detail: {
                hash: '#/music?a=1&b=2',
                normalizedPath: '/music',
                routeGeneration: 7,
                routeKey: 'music-controller-key'
            }
        }));
        window.dispatchEvent(new Event('hashchange'));
        window.dispatchEvent(new Event('popstate'));

        expect(getPtvDiagnosticNavigationIdentity({ hash: '#/music?b=2&a=1' }))
            .toBe('/music?a=1&b=2');
        expect(getPtvDiagnosticStore().getSnapshot().routes).toHaveLength(1);
        expect(getPtvDiagnosticStore().getSnapshot().routes[0]).toMatchObject({
            routeFamily: 'music',
            routeGeneration: 7,
            status: 'active'
        });

        window.history.replaceState(null, '', '/web/#/books?view=library');
        window.dispatchEvent(new Event('popstate'));
        window.dispatchEvent(new CustomEvent('ptv:routecontrollerchange', {
            detail: {
                hash: '#/books?view=library',
                normalizedPath: '/books',
                routeGeneration: 8,
                routeKey: 'books-controller-key'
            }
        }));
        window.dispatchEvent(new Event('hashchange'));

        const routes = getPtvDiagnosticStore().getSnapshot().routes;

        expect(routes).toHaveLength(2);
        expect(routes[0]).toMatchObject({ status: 'abandoned' });
        expect(routes[1]).toMatchObject({
            routeFamily: 'books',
            routeGeneration: 8,
            status: 'active'
        });
    });

    it('starts a new route session for a newer controller generation on the same canonical path', () => {
        window.history.replaceState(null, '', '/web/#/music?b=2&a=1');
        initializePtvWebDiagnosticPlatform();

        const dispatchControllerGeneration = (routeGeneration: number) => {
            window.dispatchEvent(new CustomEvent('ptv:routecontrollerchange', {
                detail: {
                    hash: '#/music?a=1&b=2',
                    normalizedPath: '/music',
                    routeGeneration,
                    routeKey: `music-controller-${routeGeneration}`
                }
            }));
        };

        dispatchControllerGeneration(7);
        dispatchControllerGeneration(7);
        expect(getPtvDiagnosticStore().getSnapshot().routes).toHaveLength(1);

        dispatchControllerGeneration(8);
        window.dispatchEvent(new Event('hashchange'));
        window.dispatchEvent(new Event('popstate'));

        expect(getPtvDiagnosticStore().getSnapshot().routes).toEqual([
            expect.objectContaining({
                routeGeneration: 7,
                status: 'abandoned'
            }),
            expect.objectContaining({
                routeGeneration: 8,
                status: 'active'
            })
        ]);
    });

    it('keeps a visible uninstrumented route unsettled without a route-owned terminal state', () => {
        vi.useFakeTimers();
        window.history.replaceState(null, '', '/web/#/music');
        document.body.innerHTML = `
            <main data-ptv-route-content="true">
                <button type="button">Visible shell</button>
            </main>
        `;
        initializePtvWebDiagnosticPlatform();

        vi.advanceTimersByTime(1_200);

        expect(getPtvDiagnosticStore().getSnapshot().routes.at(-1)).toMatchObject({
            criticalState: 'undeclared',
            settledAt: null,
            status: 'active'
        });
    });

    it('blocks settlement on current critical work and ignores stale route generations', () => {
        vi.useFakeTimers();
        window.history.replaceState(null, '', '/web/#/music');
        document.body.innerHTML = '<main data-ptv-route-content="true"></main>';
        initializePtvWebDiagnosticPlatform();
        vi.advanceTimersByTime(20);

        const lifecycle = (state: string, routeGeneration = 12, lifecycleId = 'music-critical-1') => ({
            at: Date.now(),
            detail: {
                lifecycleId,
                navigationKey: '/music',
                routeFamily: 'music',
                routeGeneration,
                routeKey: 'music-route-key',
                state
            },
            kind: 'event' as const,
            name: 'route-critical-lifecycle',
            type: 'route' as const
        });

        bridgePtvDiagnosticObservabilityEvent(lifecycle('pending'));
        bridgePtvDiagnosticObservabilityEvent(lifecycle('success', 11, 'stale-owner'));
        vi.advanceTimersByTime(800);
        expect(getPtvDiagnosticStore().getSnapshot().routes.at(-1)).toMatchObject({
            criticalState: 'pending',
            settledAt: null
        });

        bridgePtvDiagnosticObservabilityEvent(lifecycle('partial'));
        document.body.insertAdjacentHTML('beforeend', `
            <section data-ptv-row-mounted="true"></section>
            <img src="/background-refresh.jpg">
        `);
        vi.advanceTimersByTime(700);
        expect(getPtvDiagnosticStore().getSnapshot().routes.at(-1)).toMatchObject({
            criticalState: 'partial',
            status: 'settled'
        });
    });

    it('does not let an obsolete route RAF initialize its replacement session', () => {
        const callbacks: FrameRequestCallback[] = [];
        const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame')
            .mockImplementation(callback => {
                callbacks.push(callback);
                return callbacks.length;
            });

        window.history.replaceState(null, '', '/web/#/music');
        initializePtvWebDiagnosticPlatform();
        window.history.replaceState(null, '', '/web/#/books');
        window.dispatchEvent(new Event('popstate'));

        callbacks[1]?.(16);
        expect(getPtvDiagnosticStore().getSnapshot().routes.at(-1)?.initializedAt).toBeNull();
        callbacks[2]?.(32);
        expect(getPtvDiagnosticStore().getSnapshot().routes.at(-1)?.initializedAt).not.toBeNull();

        requestAnimationFrame.mockRestore();
    });

    it('classifies partial recommendation source failure as a bounded fallback', () => {
        bridgePtvDiagnosticObservabilityEvent({
            at: Date.now(),
            detail: {
                candidateCount: 4,
                durationMs: 7460,
                sourceFailures: [ { source: 'history' } ],
                sourceTimings: [
                    { source: 'favorites', status: 'success' },
                    { source: 'history', status: 'failed' }
                ]
            },
            durationMs: 7460,
            kind: 'timing',
            name: 'recommendation-provider-loaded',
            type: 'recommendation'
        });

        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            active: false,
            health: { status: 'healthy' },
            lastErrorCategory: 'source-partial',
            runDurationMs: 7460,
            sourceCount: 2
        });
    });

    it('keeps a recommendation generation degraded after an unrelated completion-shaped event', () => {
        bridgePtvDiagnosticObservabilityEvent({
            at: 1_000,
            detail: { generationId: 'generation-a' },
            kind: 'event',
            name: 'recommendation-generation-start',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 1_100,
            detail: { generationId: 'generation-a' },
            kind: 'event',
            name: 'recommendation-engine-creation-failed',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 1_200,
            detail: { generationId: 'generation-a', rowCount: 3 },
            kind: 'event',
            name: 'recommendation-rows-generated',
            type: 'recommendation'
        });

        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            active: false,
            health: { status: 'degraded' }
        });
    });

    it('allows a same-generation source summary to prove recommendation recovery', () => {
        bridgePtvDiagnosticObservabilityEvent({
            at: 2_000,
            detail: { generationId: 'generation-b' },
            kind: 'event',
            name: 'recommendation-generation-start',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 2_100,
            detail: { generationId: 'generation-b' },
            kind: 'event',
            name: 'recommendation-provider-source-load-failed',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 2_200,
            detail: {
                failedSourceCount: 0,
                generationId: 'generation-b',
                sourceCount: 1,
                sourceTimings: [ { source: 'history', status: 'success' } ]
            },
            kind: 'event',
            name: 'recommendation-provider-loaded',
            type: 'recommendation'
        });

        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            active: false,
            health: { status: 'healthy' },
            lastErrorCategory: 'source-partial'
        });
    });

    it('does not call a partial same-generation source summary a recovery', () => {
        const generationId = 'generation-partial';

        bridgePtvDiagnosticObservabilityEvent({
            at: 2_300,
            detail: { generationId },
            kind: 'event',
            name: 'recommendation-generation-started',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 2_400,
            detail: { generationId, source: 'history' },
            kind: 'event',
            name: 'recommendation-provider-source-load-failed',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 2_500,
            detail: {
                generationId,
                sourceFailures: [ { source: 'history' } ],
                sourceTimings: [
                    { source: 'favorites', status: 'success' },
                    { source: 'history', status: 'failed' }
                ]
            },
            kind: 'event',
            name: 'recommendation-provider-loaded',
            type: 'recommendation'
        });

        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            active: false,
            health: { status: 'degraded' },
            lastErrorCategory: 'source-partial'
        });
    });

    it('allows a proven newer recommendation generation to recover', () => {
        bridgePtvDiagnosticObservabilityEvent({
            at: 3_000,
            detail: { generationId: 'generation-c' },
            kind: 'event',
            name: 'recommendation-generation-start',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 3_100,
            detail: { generationId: 'generation-c' },
            kind: 'event',
            name: 'recommendation-generation-failed',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 3_200,
            detail: { generationId: 'generation-d' },
            kind: 'event',
            name: 'recommendation-generation-start',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 3_300,
            detail: {
                failedSourceCount: 0,
                generationId: 'generation-d',
                sourceCount: 1,
                sourceTimings: [ { source: 'favorites', status: 'success' } ]
            },
            kind: 'event',
            name: 'recommendation-generation-completed',
            type: 'recommendation'
        });

        expect(getPtvDiagnosticStore().getSnapshot().recommendations.health).toMatchObject({
            status: 'healthy'
        });
    });

    it('ignores stale recommendation completion and failure events from an older generation', () => {
        bridgePtvDiagnosticObservabilityEvent({
            at: 4_000,
            detail: { generationId: 'generation-e' },
            kind: 'event',
            name: 'recommendation-generation-start',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 4_100,
            detail: { generationId: 'generation-f' },
            kind: 'event',
            name: 'recommendation-generation-start',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 4_200,
            detail: {
                failedSourceCount: 0,
                generationId: 'generation-f',
                sourceCount: 1,
                sourceTimings: [ { source: 'resume', status: 'success' } ]
            },
            kind: 'event',
            name: 'recommendation-generation-completed',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 4_300,
            detail: { generationId: 'generation-e' },
            kind: 'event',
            name: 'recommendation-generation-failed',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 4_400,
            detail: {
                failedSourceCount: 1,
                generationId: 'generation-e',
                sourceCount: 1,
                sourceTimings: [ { source: 'history', status: 'failed' } ]
            },
            kind: 'event',
            name: 'recommendation-provider-loaded',
            type: 'recommendation'
        });

        expect(getPtvDiagnosticStore().getSnapshot().recommendations.health).toMatchObject({
            status: 'healthy'
        });
    });

    it('isolates concurrent real producer-shaped recommendation generations completed out of order', () => {
        bridgePtvDiagnosticObservabilityEvent({
            at: 4_500,
            detail: { generationId: 'recommendation-generation-older', providedBundle: false },
            kind: 'event',
            name: 'recommendation-generation-started',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 4_600,
            detail: { generationId: 'recommendation-generation-current', providedBundle: false },
            kind: 'event',
            name: 'recommendation-generation-started',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 4_700,
            detail: { generationId: 'recommendation-generation-older', source: 'history' },
            kind: 'event',
            name: 'recommendation-provider-source-load-failed',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 4_800,
            detail: {
                generationId: 'recommendation-generation-current',
                sourceFailures: [],
                sourceTimings: [ { source: 'favorites', status: 'success' } ]
            },
            kind: 'event',
            name: 'recommendation-provider-loaded',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 4_900,
            detail: { generationId: 'recommendation-generation-older', rowCount: 2 },
            kind: 'event',
            name: 'recommendation-rows-generated',
            type: 'recommendation'
        });

        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            active: false,
            health: { status: 'healthy' },
            lastGenerationAt: new Date(4_800).toISOString()
        });
    });

    it('does not let unrelated recommendation-category failures poison generation health', () => {
        bridgePtvDiagnosticObservabilityEvent({
            at: 4_950,
            detail: { generationId: 'recommendation-generation-healthy' },
            kind: 'event',
            name: 'recommendation-generation-started',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 4_960,
            detail: {
                generationId: 'recommendation-generation-healthy',
                sourceFailures: [],
                sourceTimings: [ { source: 'resume', status: 'success' } ]
            },
            kind: 'event',
            name: 'recommendation-provider-loaded',
            type: 'recommendation'
        });

        [
            'playlist-save-failed',
            'recommendation-route-matched-failed',
            'recommendation-save-failure',
            'recommendation-settings-fetch-error'
        ].forEach((name, index) => {
            bridgePtvDiagnosticObservabilityEvent({
                at: 4_970 + index,
                detail: {},
                kind: 'event',
                name,
                type: 'recommendation'
            });
        });

        expect(getPtvDiagnosticStore().getSnapshot().recommendations.health).toMatchObject({
            status: 'healthy'
        });
    });

    it('uses the nested engine timing generation identity for failure and recovery', () => {
        const generationId = 'recommendation-generation-timed';

        bridgePtvDiagnosticObservabilityEvent({
            at: 4_980,
            detail: { generationId },
            kind: 'event',
            name: 'recommendation-generation-started',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 4_990,
            detail: {
                detail: { generationId },
                error: 'bounded failure'
            },
            kind: 'timing',
            name: 'recommendation-engine-run:error',
            type: 'recommendation'
        });

        expect(getPtvDiagnosticStore().getSnapshot().recommendations.health.status).toBe('degraded');

        bridgePtvDiagnosticObservabilityEvent({
            at: 5_000,
            detail: {
                generationId,
                sourceFailures: [],
                sourceTimings: [ { source: 'favorites', status: 'success' } ]
            },
            kind: 'event',
            name: 'recommendation-provider-loaded',
            type: 'recommendation'
        });

        expect(getPtvDiagnosticStore().getSnapshot().recommendations.health.status).toBe('healthy');
    });

    it('does not clear an unscoped recommendation failure with an unscoped completion', () => {
        bridgePtvDiagnosticObservabilityEvent({
            at: 5_000,
            detail: {},
            kind: 'event',
            name: 'recommendation-engine-creation-failed',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 5_100,
            detail: { rowCount: 2 },
            kind: 'event',
            name: 'recommendation-rows-generated',
            type: 'recommendation'
        });

        expect(getPtvDiagnosticStore().getSnapshot().recommendations.health).toMatchObject({
            status: 'degraded'
        });
    });

    it('fails closed when a completion omits identity after a recommendation generation transition', () => {
        bridgePtvDiagnosticObservabilityEvent({
            at: 6_000,
            detail: { generationId: 'generation-g' },
            kind: 'event',
            name: 'recommendation-generation-start',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 6_100,
            detail: { generationId: 'generation-g' },
            kind: 'event',
            name: 'recommendation-generation-failed',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 6_200,
            detail: { generationId: 'generation-h' },
            kind: 'event',
            name: 'recommendation-generation-start',
            type: 'recommendation'
        });
        bridgePtvDiagnosticObservabilityEvent({
            at: 6_300,
            detail: {
                failedSourceCount: 0,
                sourceCount: 1,
                sourceTimings: [ { source: 'favorites', status: 'success' } ]
            },
            kind: 'event',
            name: 'recommendation-generation-completed',
            type: 'recommendation'
        });

        expect(getPtvDiagnosticStore().getSnapshot().recommendations.health).toMatchObject({
            status: 'degraded'
        });
    });

    it('bridges only the allowlisted playback snapshot shape and bounds nested aggregates', () => {
        const privateTitle = 'Private movie title 9031';
        const privateUrl = 'https://private.invalid/videos/item-id/master.m3u8?api_key=secret';

        bridgePtvDiagnosticObservabilityEvent({
            at: Date.parse('2026-08-31T15:00:00.000Z'),
            detail: {
                buffer: {
                    averageAheadSeconds: 6.25,
                    belowTwoSecondsCount: 3,
                    currentAheadSeconds: -5,
                    maximumAheadSeconds: 12,
                    minimumAheadSeconds: 0,
                    sampleCount: 9,
                    zeroBufferCount: 2
                },
                diagnosticSessionId: 'playback-session-safe1',
                hls: {
                    droppedFragmentTrackingCount: 2,
                    duplicateFragmentRequestCount: 1,
                    fragmentAverageLatencyMs: 900,
                    fragmentFailureCount: 2,
                    fragmentLongestLatencyMs: 4_000,
                    fragmentP95LatencyMs: 2_500,
                    fragmentRequestCount: 12,
                    fragmentRetryCount: 2,
                    fragmentSuccessCount: 10,
                    fragmentTimeoutCount: 1,
                    manifestAverageLatencyMs: 200,
                    manifestP95LatencyMs: 250,
                    manifestRequestCount: 1,
                    manifestSuccessCount: 1,
                    requestUrl: privateUrl
                },
                itemId: 'private-item-id',
                mediaMode: 'HLS Transcode',
                mediaTitle: privateTitle,
                playbackSessionId: 'private-play-session-id',
                player: {
                    activeLoadRestarts: 1,
                    mediaSourceAssignments: 2,
                    mountCount: 1,
                    pauseCalls: 1,
                    playCalls: 2,
                    programmaticSeeks: 1,
                    qualitySwitches: 1,
                    recoveryActions: 1,
                    sourceReplacements: 1,
                    staleEventsIgnored: 4,
                    unmountCount: 0
                },
                readyStateTransitions: Array.from({ length: 24 }, (_, index) => ({
                    atMs: index * 10,
                    from: index % 5,
                    privateUrl,
                    to: (index + 1) % 5
                })),
                routeClassification: 'LAN_DIRECT',
                routeFamily: 'playback',
                sourceGeneration: 3,
                stalls: {
                    cumulativeDurationMs: 3_000,
                    episodeDurationsMs: Array.from({ length: 25 }, (_, index) => index * 100),
                    longestDurationMs: 1_500,
                    recoveryResults: [ 'recovered', privateTitle ],
                    stalledCount: 1,
                    waitingCount: 2
                },
                state: 'DEGRADED',
                terminal: false,
                updatedAt: '2026-08-31T15:00:00.000Z',
                url: privateUrl
            },
            kind: 'event',
            name: PTV_PLAYBACK_SESSION_SNAPSHOT_EVENT,
            type: 'playback'
        });

        const session = getPtvDiagnosticStore().getSnapshot().playbackSessions.at(-1);
        const serialized = JSON.stringify(session);

        expect(session).toMatchObject({
            buffer: { currentAheadSeconds: 0, sampleCount: 9 },
            diagnosticSessionId: 'playback-session-safe1',
            mediaMode: 'HLS Transcode',
            routeClassification: 'LAN_DIRECT',
            routeFamily: 'playback',
            sourceGeneration: 3,
            state: 'DEGRADED'
        });
        expect(session?.readyStateTransitions).toHaveLength(16);
        expect(session?.stalls.episodeDurationsMs).toHaveLength(20);
        expect(session?.stalls.recoveryResults).toEqual([ 'recovered', 'unknown' ]);
        expect(serialized).not.toContain(privateTitle);
        expect(serialized).not.toContain(privateUrl);
        expect(serialized).not.toContain('private-item-id');
        expect(serialized).not.toContain('private-play-session-id');
    });

    it('accepts a nested producer detail but ignores unrelated playback events', () => {
        const nested = normalizePtvPlaybackSessionSnapshot({
            detail: {
                diagnosticSessionId: 'playback-session-nested',
                mediaMode: 'Direct Play',
                routeClassification: 'VPN_PATH',
                routeFamily: 'video',
                sourceGeneration: 1,
                state: 'PLAYING',
                terminal: false,
                updatedAt: '2026-08-31T15:05:00.000Z'
            }
        });

        expect(nested).toMatchObject({
            diagnosticSessionId: 'playback-session-nested',
            mediaMode: 'Direct Play',
            routeClassification: 'VPN_PATH',
            state: 'PLAYING'
        });

        bridgePtvDiagnosticObservabilityEvent({
            at: Date.now(),
            detail: nested,
            kind: 'event',
            name: 'ptv-playback-progress',
            type: 'playback'
        });
        expect(getPtvDiagnosticStore().getSnapshot().playbackSessions).toEqual([]);
    });

    it('classifies shelf AbortError and cancellation detail as cancelled terminal work', () => {
        expect(classifyPtvDiagnosticShelfStatus({
            detail: { error: { message: 'route disposed', name: 'AbortError' } },
            name: 'home-shelf-failed'
        })).toBe('cancelled');
        expect(classifyPtvDiagnosticShelfStatus({
            detail: { cancellation: true },
            name: 'home-shelf-request'
        })).toBe('cancelled');

        bridgePtvDiagnosticObservabilityEvent({
            at: Date.now(),
            detail: { errorCategory: 'cancelled' },
            kind: 'event',
            name: 'home-shelf-failed',
            type: 'row-fetch'
        });

        expect(getPtvDiagnosticStore().getSnapshot().shelves.at(-1)?.status).toBe('cancelled');
    });

    it('keeps timeout-driven request aborts classified as failures', () => {
        expect(classifyPtvDiagnosticShelfStatus({
            detail: { timeoutMs: 15_000 },
            name: 'native-home-slow-fetch-timed-out'
        })).toBe('failed');
    });
});
