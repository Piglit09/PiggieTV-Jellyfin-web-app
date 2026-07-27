import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    PTV_DIAGNOSTIC_RETENTION_LIMITS,
    createPtvDiagnosticStore,
    normalizePtvDiagnosticRequestFamily,
    normalizePtvDiagnosticRouteFamily
} from './diagnosticStore';

afterEach(() => {
    vi.useRealTimers();
});

describe('PTV diagnostic store', () => {
    it('normalizes requests and routes without retaining URLs, queries, or identifiers', () => {
        expect(normalizePtvDiagnosticRequestFamily('/Users/private/Items?api_key=secret')).toBe('Items list');
        expect(normalizePtvDiagnosticRequestFamily('/Shows/private/Episodes?SeasonId=private')).toBe('Episodes');
        expect(normalizePtvDiagnosticRequestFamily('/Ptv/v1/Status?token=secret')).toBe('Plugin status');
        expect(normalizePtvDiagnosticRouteFamily('#/details?id=private-media-id')).toBe('details');
        expect(normalizePtvDiagnosticRouteFamily('#/dashboard/piggietv/diagnostics?user=private')).toBe('dashboard/piggietv/diagnostics');
    });

    it('bounds histories and counts dropped events', () => {
        const store = createPtvDiagnosticStore();

        for (let index = 0; index < PTV_DIAGNOSTIC_RETENTION_LIMITS.images + 7; index += 1) {
            store.recordImage({
                cacheClassification: 'browser-managed',
                decodeDurationMs: null,
                durationMs: index,
                fallbackUsed: false,
                occurredAt: new Date().toISOString(),
                role: 'poster',
                routeFamily: 'home',
                status: 'loaded'
            });
        }

        const snapshot = store.getSnapshot('2026-07-25T12:00:00.000Z');

        expect(snapshot.images).toHaveLength(PTV_DIAGNOSTIC_RETENTION_LIMITS.images);
        expect(snapshot.droppedEvents.byStream.images).toBe(7);
        expect(snapshot.droppedEvents.total).toBe(7);
    });

    it('calculates route lifecycle timing and pending counts', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-25T12:00:00.000Z'));
        const store = createPtvDiagnosticStore();
        const routeId = store.startRoute('#/movies');

        vi.setSystemTime(new Date('2026-07-25T12:00:00.120Z'));
        store.markRoutePhase(routeId, 'first-content');
        vi.setSystemTime(new Date('2026-07-25T12:00:00.200Z'));
        store.markRoutePhase(routeId, 'first-focusable');
        vi.setSystemTime(new Date('2026-07-25T12:00:00.500Z'));
        store.markRoutePhase(routeId, 'settled');

        expect(store.getSnapshot().routes[0]).toMatchObject({
            navigationToFirstContentMs: 120,
            navigationToFocusableMs: 200,
            navigationToSettledMs: 500,
            routeFamily: 'movies',
            status: 'settled'
        });
    });

    it('creates deterministic privacy-safe exports with no token, URL, private host, or raw ID leakage', () => {
        const store = createPtvDiagnosticStore();
        const sensitiveUserId = '11112222333344445555666677778888';
        const sensitiveItemId = 'aaaabbbbccccddddeeeeffff00001111';
        const privateHost = [ '192', '168', '20', '40' ].join('.');
        const endpoint = `http://${privateHost}:8096/Users/${sensitiveUserId}/Items/${sensitiveItemId}?api_key=secret-token`;
        const requestId = store.beginRequest({ endpoint, route: '#/details?id=raw-media-id' });

        store.completeRequest(requestId, { status: 200, success: true });
        const first = store.createExport({ generatedAt: '2026-07-25T12:00:00.000Z' });
        const second = store.createExport({ generatedAt: '2026-07-25T12:00:00.000Z' });
        const serialized = JSON.stringify(first);

        expect(first).toEqual(second);
        expect(first.privacyClassification).toBe('share-safe');
        expect(first.privacy.schemaVersion).toBe(1);
        expect(serialized).not.toContain(privateHost);
        expect(serialized).not.toContain(sensitiveUserId);
        expect(serialized).not.toContain(sensitiveItemId);
        expect(serialized).not.toContain('secret-token');
        expect(serialized).not.toContain('http://');
        expect(serialized).not.toContain('raw-media-id');
        expect(serialized).toContain('Item details');
    });

    it('resets bounded histories while retaining platform context', () => {
        const store = createPtvDiagnosticStore();
        const original = store.getSnapshot();

        store.startRoute('#/home');
        store.addWarning('test warning');
        store.resetSession();
        const reset = store.getSnapshot();

        expect(reset.routes).toEqual([]);
        expect(reset.warnings).toEqual([]);
        expect(reset.diagnosticSessionId).not.toBe(original.diagnosticSessionId);
        expect(reset.session.resetCount).toBe(1);
        expect(reset.platform).toEqual(original.platform);
    });

    it('reports unsupported collectors without classifying them as failures and can disable collection', () => {
        const store = createPtvDiagnosticStore();

        expect(store.getSnapshot().collectorCapabilities.longTasks).toBe(false);
        expect(store.getSnapshot().health.status).not.toBe('failing');
        store.setCollectorEnabled(false);
        store.recordImage({
            cacheClassification: 'browser-managed',
            decodeDurationMs: null,
            durationMs: 10,
            fallbackUsed: false,
            occurredAt: new Date().toISOString(),
            role: 'poster',
            routeFamily: 'home',
            status: 'loaded'
        });

        expect(store.getSnapshot().images).toEqual([]);
        expect(store.getSnapshot().self.collectorEnabled).toBe(false);
    });

    it('bounds the 300-stage remote pipeline and distinguishes retention trimming from overload', () => {
        const store = createPtvDiagnosticStore();

        for (let index = 0; index < PTV_DIAGNOSTIC_RETENTION_LIMITS.inputs + 5; index += 1) {
            store.recordInput({
                activeRequests: 0,
                currentCandidateResolved: true,
                defaultPreventedAfter: true,
                defaultPreventedBefore: false,
                delayClassification: 'unknown',
                direction: 'right',
                elapsedMs: index,
                eventPhase: 'capture',
                eventType: 'keydown',
                failureReason: 'none',
                frameP95Ms: 16,
                handlerReached: true,
                inputId: `remote-input-${index}`,
                movementAttempted: true,
                movementResult: 'confirmed',
                movementSucceeded: true,
                nextFocusFingerprint: 'focus-next',
                occurredAt: new Date().toISOString(),
                pendingImages: 0,
                pendingShelves: 0,
                previousFocusFingerprint: 'focus-previous',
                propagationStopped: false,
                repeat: false,
                repeatCount: 1,
                routeFamily: 'home',
                routeSettled: true,
                safeAction: 'right',
                source: 'synthetic-test',
                stage: 'movement-confirmed',
                stageSequence: index,
                targetCandidateFound: true,
                targetCategory: 'media-card'
            });
        }

        const snapshot = store.getSnapshot();

        expect(snapshot.inputs).toHaveLength(PTV_DIAGNOSTIC_RETENTION_LIMITS.inputs);
        expect(snapshot.droppedEvents.retentionTrimmed).toBe(5);
        expect(snapshot.droppedEvents.collectorOverload).toBe(0);
    });

    it('correlates graph readiness, initial focus, movement, loss, and Back restoration with the route', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-25T12:00:00.000Z'));
        const store = createPtvDiagnosticStore();

        store.startRoute('#/movies');
        vi.setSystemTime(new Date('2026-07-25T12:00:00.050Z'));
        store.markRouteFocusPhase('focus-graph-ready');
        vi.setSystemTime(new Date('2026-07-25T12:00:00.080Z'));
        store.markRouteFocusPhase('initial-focus');
        vi.setSystemTime(new Date('2026-07-25T12:00:00.120Z'));
        store.markRouteFocusPhase('first-directional-movement');
        store.markRouteFocusPhase('focus-lost');
        store.markRouteFocusPhase('restoration-started');
        vi.setSystemTime(new Date('2026-07-25T12:00:00.165Z'));
        store.markRouteFocusPhase('restored');

        expect(store.getSnapshot().routes.at(-1)).toMatchObject({
            focusLossCount: 1,
            focusRestorationDurationMs: 45,
            focusRestorationStatus: 'restored',
            navigationToFirstDirectionalMovementMs: 120,
            navigationToGraphReadyMs: 50,
            navigationToInitialFocusMs: 80
        });
    });
});
