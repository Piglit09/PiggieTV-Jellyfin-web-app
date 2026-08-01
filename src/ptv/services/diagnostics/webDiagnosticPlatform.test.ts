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
    createPtvImageRemountGuard,
    createPtvImageLifecycleTracker,
    disposePtvWebDiagnosticPlatformForTests,
    initializePtvWebDiagnosticPlatform,
    isPtvDiagnosticFocusVisible,
    isPtvDiagnosticRouteContentReady
} from './webDiagnosticPlatform';
import {
    getPtvDiagnosticStore,
    resetPtvDiagnosticStoreForTests
} from './diagnosticStore';

afterEach(() => {
    disposePtvWebDiagnosticPlatformForTests();
    resetPtvDiagnosticStoreForTests();
    document.body.innerHTML = '';
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
});
