import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
    PtvFrameDiagnostic,
    PtvPlaybackSessionDiagnostic
} from '../../core/diagnostics/diagnosticContracts';

import {
    PTV_DIAGNOSTIC_HEALTH_THRESHOLDS,
    PTV_DIAGNOSTIC_RETENTION_LIMITS,
    PTV_EXTREME_IMAGE_CHURN_WARNING,
    PTV_HIGH_API_CONCURRENCY_WARNING,
    PTV_SEVERE_FRAME_JANK_WARNING,
    PTV_SLOW_API_REQUESTS_WARNING,
    createPtvDiagnosticStore,
    normalizePtvDiagnosticRequestFamily,
    normalizePtvDiagnosticRouteFamily
} from './diagnosticStore';

function severeFrame(
    sampledAt: string,
    overrides: Partial<PtvFrameDiagnostic> = {}
): PtvFrameDiagnostic {
    return {
        approximateFps: 10,
        collectorOverheadMs: 0.2,
        frameCount: 8,
        jankyFrameCount: 8,
        jankyFramePercentage: 100,
        longestFrameMs: 180,
        longTaskCount: 0,
        p50FrameMs: 100,
        p90FrameMs: 160,
        p95FrameMs: 180,
        p99FrameMs: 180,
        reducedMotion: false,
        routeFamily: 'home',
        sampledAt,
        visibilityState: 'visible' as const,
        ...overrides
    };
}

function playbackSession(
    diagnosticSessionId: string,
    overrides: Partial<PtvPlaybackSessionDiagnostic> = {}
): PtvPlaybackSessionDiagnostic {
    return {
        buffer: {
            averageAheadSeconds: 6,
            belowTwoSecondsCount: 1,
            currentAheadSeconds: 4,
            maximumAheadSeconds: 8,
            minimumAheadSeconds: 0,
            sampleCount: 5,
            zeroBufferCount: 1
        },
        diagnosticSessionId,
        hls: {
            droppedFragmentTrackingCount: 0,
            duplicateFragmentRequestCount: 1,
            fragmentAverageLatencyMs: 900,
            fragmentFailureCount: 1,
            fragmentLongestLatencyMs: 2_200,
            fragmentP95LatencyMs: 1_800,
            fragmentRequestCount: 8,
            fragmentRetryCount: 1,
            fragmentSuccessCount: 7,
            fragmentTimeoutCount: 0,
            manifestAverageLatencyMs: 120,
            manifestP95LatencyMs: 180,
            manifestRequestCount: 1,
            manifestSuccessCount: 1
        },
        mediaMode: 'HLS Transcode',
        player: {
            activeLoadRestarts: 1,
            mediaSourceAssignments: 1,
            mountCount: 1,
            pauseCalls: 0,
            playCalls: 1,
            programmaticSeeks: 0,
            qualitySwitches: 1,
            recoveryActions: 1,
            sourceReplacements: 0,
            staleEventsIgnored: 0,
            unmountCount: 0
        },
        readyStateTransitions: [{ atMs: 250, from: 2, to: 3 }],
        routeClassification: 'LAN_DIRECT',
        routeFamily: 'playback',
        sourceGeneration: 1,
        stalls: {
            cumulativeDurationMs: 500,
            episodeDurationsMs: [500],
            longestDurationMs: 500,
            recoveryResults: ['recovered'],
            stalledCount: 1,
            waitingCount: 1
        },
        state: 'PLAYING',
        terminal: false,
        updatedAt: '2026-08-31T15:00:00.000Z',
        ...overrides
    };
}

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
        expect(normalizePtvDiagnosticRouteFamily('#/settings/admin/piggietv/diagnostics?user=private')).toBe('settings/admin/piggietv/diagnostics');
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

    it('upserts the latest eight opaque playback sessions and resets the stream', () => {
        const store = createPtvDiagnosticStore();

        for (let index = 0; index < 10; index += 1) {
            store.upsertPlaybackSession(playbackSession(`playback-session-${index}`, {
                sourceGeneration: index,
                updatedAt: `2026-08-31T15:00:${index.toString().padStart(2, '0')}.000Z`
            }));
        }
        store.upsertPlaybackSession(playbackSession('playback-session-9', {
            sourceGeneration: 9,
            state: 'ENDED',
            terminal: true,
            updatedAt: '2026-08-31T15:01:00.000Z'
        }));
        store.upsertPlaybackSession(playbackSession('playback-session-9', {
            sourceGeneration: 9,
            state: 'PLAYING',
            terminal: false,
            updatedAt: '2026-08-31T15:00:59.000Z'
        }));

        const snapshot = store.getSnapshot();

        expect(snapshot.playbackSessions).toHaveLength(PTV_DIAGNOSTIC_RETENTION_LIMITS.playbackSessions);
        expect(snapshot.playbackSessions.map(session => session.diagnosticSessionId)).toEqual([
            'playback-session-2',
            'playback-session-3',
            'playback-session-4',
            'playback-session-5',
            'playback-session-6',
            'playback-session-7',
            'playback-session-8',
            'playback-session-9'
        ]);
        expect(snapshot.playbackSessions.at(-1)).toMatchObject({ state: 'ENDED', terminal: true });
        expect(snapshot.droppedEvents.byStream.playbackSessions).toBe(2);

        store.resetSession();
        expect(store.getSnapshot().playbackSessions).toEqual([]);
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

    it('records one generation-owned critical lifecycle and keeps its terminal outcome immutable', () => {
        const store = createPtvDiagnosticStore();
        const routeId = store.startRoute('#/music', 7);

        expect(store.markRouteCriticalState(routeId, 'pending', 7)).toBe(true);
        expect(store.markRouteCriticalState(routeId, 'success', 6)).toBe(false);
        expect(store.markRouteCriticalState(routeId, 'partial', 7)).toBe(true);
        expect(store.markRouteCriticalState(routeId, 'pending', 7)).toBe(false);
        expect(store.markRouteCriticalState(routeId, 'success', 7)).toBe(false);

        expect(store.getSnapshot().routes[0]).toMatchObject({
            criticalCompletedAt: expect.any(String),
            criticalStartedAt: expect.any(String),
            criticalState: 'partial',
            routeGeneration: 7
        });
    });

    it.each([ 'success', 'partial', 'empty', 'failed', 'cancelled' ] as const)(
        'persists the %s critical terminal state',
        criticalState => {
            const store = createPtvDiagnosticStore();
            const routeId = store.startRoute('#/calendar', 3);

            store.markRouteCriticalState(routeId, 'pending', 3);
            store.markRouteCriticalState(routeId, criticalState, 3);

            expect(store.getSnapshot().routes[0]).toMatchObject({
                criticalState,
                routeGeneration: 3
            });
        }
    );

    it('treats cancelled shelf work as terminal when a route settles', () => {
        const store = createPtvDiagnosticStore();
        const routeId = store.startRoute('#/home');

        store.recordShelf({
            durationMs: null,
            itemCount: 0,
            occurredAt: new Date().toISOString(),
            routeFamily: 'home',
            shelfFamily: 'recommendations',
            status: 'request-started'
        });
        store.recordShelf({
            durationMs: 15,
            itemCount: 0,
            occurredAt: new Date().toISOString(),
            routeFamily: 'home',
            shelfFamily: 'recommendations',
            status: 'cancelled'
        });
        store.markRoutePhase(routeId, 'settled');

        expect(store.getSnapshot().routes.at(-1)?.shelvesPendingAtSettle).toBe(0);
    });

    it('separates expected cancellations from request failures and health degradation', () => {
        const store = createPtvDiagnosticStore();
        const requestIds = Array.from({ length: PTV_DIAGNOSTIC_HEALTH_THRESHOLDS.highApiConcurrency }, () => (
            store.beginRequest({ endpoint: '/Items', route: '#/home' })
        ));

        requestIds.forEach(requestId => {
            store.completeRequest(requestId, {
                cancellation: true,
                errorCategory: 'cancelled',
                success: false
            });
        });

        expect(store.getRequestSummary()).toMatchObject({
            cancellations: requestIds.length,
            failures: 0,
            peakConcurrency: PTV_DIAGNOSTIC_HEALTH_THRESHOLDS.highApiConcurrency
        });
        const snapshot = store.getSnapshot();

        expect(snapshot.warnings).not.toContain(PTV_HIGH_API_CONCURRENCY_WARNING);
        expect(snapshot.health.status).not.toBe('degraded');
    });

    it('degrades successful 10-13 second API traffic with a share-safe slow-request warning', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-01T20:00:00.000Z'));
        const store = createPtvDiagnosticStore();

        [ 9_856, 10_622, 13_291 ].forEach(durationMs => {
            const requestId = store.beginRequest({ endpoint: '/Items', route: '#/music' });

            vi.advanceTimersByTime(durationMs);
            store.completeRequest(requestId, { status: 200, success: true });
        });

        const snapshot = store.getSnapshot();

        expect(store.getRequestSummary().p95Ms).toBe(13_291);
        expect(snapshot.warnings).toContain(PTV_SLOW_API_REQUESTS_WARNING);
        expect(snapshot.health).toMatchObject({
            reason: 'API latency, request concurrency, or image lifecycle churn exceeded diagnostic health thresholds.',
            status: 'degraded'
        });
    });

    it('degrades peak API concurrency of seven after successful work completes', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-01T20:00:00.000Z'));
        const store = createPtvDiagnosticStore();
        const requestIds = Array.from({ length: PTV_DIAGNOSTIC_HEALTH_THRESHOLDS.highApiConcurrency }, () => (
            store.beginRequest({ endpoint: '/Items', route: '#/music' })
        ));

        vi.advanceTimersByTime(25);
        requestIds.forEach(requestId => {
            store.completeRequest(requestId, { status: 200, success: true });
        });

        const snapshot = store.getSnapshot();

        expect(store.getRequestSummary().peakConcurrency).toBe(7);
        expect(snapshot.warnings).toContain(PTV_HIGH_API_CONCURRENCY_WARNING);
        expect(snapshot.health.status).toBe('degraded');
    });

    it('reports seven active physical transports before any request completes', () => {
        const store = createPtvDiagnosticStore();

        Array.from({ length: PTV_DIAGNOSTIC_HEALTH_THRESHOLDS.highApiConcurrency }, () => (
            store.beginRequest({ endpoint: '/Items', route: '#/home' })
        ));

        const snapshot = store.getSnapshot();

        expect(snapshot.self.eventCounts.activeRequests).toBe(7);
        expect(snapshot.warnings).toContain(PTV_HIGH_API_CONCURRENCY_WARNING);
        expect(snapshot.health.status).toBe('degraded');
    });

    it('does not count coalesced consumers as additional physical transports', () => {
        const store = createPtvDiagnosticStore();
        const physicalRequestCount = PTV_DIAGNOSTIC_HEALTH_THRESHOLDS.highApiConcurrency - 1;

        Array.from({ length: physicalRequestCount }, () => (
            store.beginRequest({ endpoint: '/Items', route: '#/home' })
        ));
        Array.from({ length: 4 }, () => {
            store.recordCoordinatorHit({ endpoint: '/Items', route: '#/home' });
            return null;
        });

        const snapshot = store.getSnapshot();

        expect(snapshot.self.eventCounts.activeRequests).toBe(physicalRequestCount);
        expect(snapshot.warnings).not.toContain(PTV_HIGH_API_CONCURRENCY_WARNING);
    });

    it('recovers after every transport in an active high-concurrency burst is cancelled', () => {
        const store = createPtvDiagnosticStore();
        const requestIds = Array.from({ length: PTV_DIAGNOSTIC_HEALTH_THRESHOLDS.highApiConcurrency }, () => (
            store.beginRequest({ endpoint: '/Items', route: '#/home' })
        ));

        expect(store.getSnapshot().warnings).toContain(PTV_HIGH_API_CONCURRENCY_WARNING);

        requestIds.forEach(requestId => {
            store.completeRequest(requestId, {
                cancellation: true,
                errorCategory: 'cancelled',
                success: false
            });
        });

        const snapshot = store.getSnapshot();

        expect(snapshot.self.eventCounts.activeRequests).toBe(0);
        expect(snapshot.warnings).not.toContain(PTV_HIGH_API_CONCURRENCY_WARNING);
    });

    it('does not let retired cancelled requests keep the current route degraded', () => {
        const store = createPtvDiagnosticStore();
        const requestIds = Array.from({ length: PTV_DIAGNOSTIC_HEALTH_THRESHOLDS.highApiConcurrency }, () => (
            store.beginRequest({ endpoint: '/Items', route: '#/home' })
        ));

        requestIds.forEach(requestId => {
            store.completeRequest(requestId, {
                cancellation: true,
                errorCategory: 'cancelled',
                success: false
            });
        });
        store.startRoute('#/music');

        expect(store.getSnapshot().warnings).not.toContain(PTV_HIGH_API_CONCURRENCY_WARNING);
    });

    it('degrades a recent 600-event image lifecycle burst with 400 retention trims', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-01T20:00:00.000Z'));
        const store = createPtvDiagnosticStore();
        const occurredAt = new Date().toISOString();

        for (let index = 0; index < PTV_DIAGNOSTIC_HEALTH_THRESHOLDS.imageChurnMinimumEvents; index += 1) {
            store.recordImage({
                cacheClassification: 'browser-managed',
                decodeDurationMs: null,
                durationMs: 5,
                fallbackUsed: false,
                occurredAt,
                role: 'poster',
                routeFamily: 'music',
                status: 'loaded'
            });
        }

        const snapshot = store.getSnapshot();

        expect(snapshot.self.eventCounts.images).toBe(600);
        expect(snapshot.droppedEvents.byStream.images).toBe(400);
        expect(snapshot.warnings).toContain(PTV_EXTREME_IMAGE_CHURN_WARNING);
        expect(snapshot.health.status).toBe('degraded');
    });

    it('does not treat ordinary long-session image retention as a recent churn burst', () => {
        const store = createPtvDiagnosticStore();
        const startedAt = Date.parse('2026-09-01T20:00:00.000Z');

        for (let index = 0; index < PTV_DIAGNOSTIC_HEALTH_THRESHOLDS.imageChurnMinimumEvents; index += 1) {
            store.recordImage({
                cacheClassification: 'browser-managed',
                decodeDurationMs: null,
                durationMs: 5,
                fallbackUsed: false,
                occurredAt: new Date(startedAt + index * 1_000).toISOString(),
                role: 'poster',
                routeFamily: 'music',
                status: 'loaded'
            });
        }

        const snapshot = store.getSnapshot(new Date(startedAt + 599_000).toISOString());

        expect(snapshot.droppedEvents.byStream.images).toBe(400);
        expect(snapshot.warnings).not.toContain(PTV_EXTREME_IMAGE_CHURN_WARNING);
        expect(snapshot.health.status).not.toBe('degraded');
    });

    it('emits one recoverable severe-frame warning only after five settled visible route samples', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-25T12:00:00.000Z'));
        const store = createPtvDiagnosticStore();
        const routeId = store.startRoute('#/home');

        store.recordFrame(severeFrame('2026-07-25T12:00:00.500Z'));
        vi.setSystemTime(new Date('2026-07-25T12:00:01.000Z'));
        store.markRoutePhase(routeId, 'settled');
        [ 2, 3, 4, 5 ].forEach(second => {
            store.recordFrame(severeFrame(`2026-07-25T12:00:0${second}.000Z`));
        });
        store.recordFrame(severeFrame('2026-07-25T12:00:05.500Z', {
            visibilityState: 'hidden'
        }));

        expect(store.getSnapshot().warnings).not.toContain(PTV_SEVERE_FRAME_JANK_WARNING);

        store.recordFrame(severeFrame('2026-07-25T12:00:06.000Z'));
        const severe = store.getSnapshot();

        expect(severe.warnings.filter(warning => warning === PTV_SEVERE_FRAME_JANK_WARNING)).toHaveLength(1);
        expect(severe.health).toMatchObject({
            reason: 'Sustained severe frame jank was observed after the current route settled.',
            status: 'degraded',
            warnings: [ PTV_SEVERE_FRAME_JANK_WARNING ]
        });

        store.recordFrame(severeFrame('2026-07-25T12:00:07.000Z', {
            approximateFps: 60,
            jankyFrameCount: 0,
            jankyFramePercentage: 0,
            longestFrameMs: 17,
            p50FrameMs: 16,
            p90FrameMs: 17,
            p95FrameMs: 17,
            p99FrameMs: 17
        }));

        expect(store.getSnapshot().warnings).not.toContain(PTV_SEVERE_FRAME_JANK_WARNING);
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
