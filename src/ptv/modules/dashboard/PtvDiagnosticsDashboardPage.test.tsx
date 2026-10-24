import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    PtvFrameDiagnostic,
    PtvPlaybackSessionDiagnostic
} from '../../core/diagnostics/diagnosticContracts';

vi.mock('components/Page', () => ({
    default: ({ children, title }: { children: React.ReactNode; title: string }) => (
        <main data-page-title={title}>{children}</main>
    )
}));

vi.mock('../../services/diagnostics/webDiagnosticPlatform', () => ({
    refreshPtvWebDiagnosticExternalStatus: vi.fn(() => Promise.resolve())
}));

vi.mock('./RemoteDiagnosticsPanel', () => ({
    default: () => <section>Remote diagnostics</section>,
    RemoteDiagnosticsPanel: () => <section>Remote diagnostics</section>
}));

import {
    resetPtvDiagnosticPreferencesForTests
} from '../../services/diagnostics/diagnosticPreferences';
import {
    getPtvDiagnosticStore,
    resetPtvDiagnosticStoreForTests
} from '../../services/diagnostics/diagnosticStore';
import PtvDiagnosticsDashboardPage from './PtvDiagnosticsDashboardPage';

function severeFrame(sampledAt: string): PtvFrameDiagnostic {
    return {
        approximateFps: 10,
        collectorOverheadMs: 0.1,
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
        visibilityState: 'visible'
    };
}

function playbackSession(): PtvPlaybackSessionDiagnostic {
    return {
        buffer: {
            averageAheadSeconds: 5.5,
            belowTwoSecondsCount: 2,
            currentAheadSeconds: 3.25,
            maximumAheadSeconds: 10,
            minimumAheadSeconds: 0,
            sampleCount: 12,
            zeroBufferCount: 1
        },
        diagnosticSessionId: 'playback-session-dashboard',
        hls: {
            droppedFragmentTrackingCount: 1,
            duplicateFragmentRequestCount: 2,
            fragmentAverageLatencyMs: 1_200,
            fragmentFailureCount: 1,
            fragmentLongestLatencyMs: 4_000,
            fragmentP95LatencyMs: 2_500,
            fragmentRequestCount: 12,
            fragmentRetryCount: 2,
            fragmentSuccessCount: 11,
            fragmentTimeoutCount: 1,
            manifestAverageLatencyMs: 180,
            manifestP95LatencyMs: 220,
            manifestRequestCount: 1,
            manifestSuccessCount: 1
        },
        mediaMode: 'HLS Transcode',
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
            staleEventsIgnored: 3,
            unmountCount: 0
        },
        readyStateTransitions: [{ atMs: 300, from: 2, to: 3 }],
        routeClassification: 'LAN_DIRECT',
        routeFamily: 'playback',
        sourceGeneration: 2,
        stalls: {
            cumulativeDurationMs: 3_000,
            episodeDurationsMs: [1_200, 1_800],
            longestDurationMs: 1_800,
            recoveryResults: ['recovered'],
            stalledCount: 1,
            waitingCount: 2
        },
        state: 'DEGRADED',
        terminal: false,
        updatedAt: '2026-08-31T15:00:00.000Z'
    };
}

describe('PTV diagnostics dashboard', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        resetPtvDiagnosticStoreForTests();
        resetPtvDiagnosticPreferencesForTests();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        flushSync(() => root.unmount());
        container.remove();
        resetPtvDiagnosticStoreForTests();
        resetPtvDiagnosticPreferencesForTests();
        vi.useRealTimers();
    });

    it('renders the protected dashboard overview and cleans its store subscription', () => {
        const store = getPtvDiagnosticStore();

        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));

        expect(container.querySelector('[data-testid="ptv-admin-piggietv-diagnostics"]')).not.toBeNull();
        expect(container.querySelector('h1')?.textContent).toBe('PiggieTV Diagnostics');
        expect(container.textContent).toContain('Overall health');
        expect(container.textContent).toContain('Local, bounded observability');
        expect(store.getSnapshot().self.subscriberCount).toBe(1);

        flushSync(() => root.unmount());
        expect(store.getSnapshot().self.subscriberCount).toBe(0);
        root = createRoot(container);
    });

    it('does not present unobserved overview cache and recommendation counts as zero', () => {
        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));
        const cards = Array.from(container.querySelectorAll('.ptv-diagnostics-metric-card'));
        const cacheCard = cards.find(card => card.textContent?.includes('Cache health'));
        const recommendationCard = cards.find(card => card.textContent?.includes('Recommendations'));

        expect(cacheCard?.textContent).toContain('Not observed');
        expect(cacheCard?.textContent).not.toContain('0 items');
        expect(recommendationCard?.textContent).toContain('Not observed');
        expect(recommendationCard?.textContent).not.toContain('0 generated rows');
    });

    it('resets retained history from the export section', () => {
        const store = getPtvDiagnosticStore();

        store.startRoute('#/movies');
        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));
        const exportButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Export');

        flushSync(() => exportButton?.click());
        const resetButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent?.includes('Reset session'));

        expect(resetButton).toBeTruthy();
        flushSync(() => resetButton?.click());
        expect(store.getSnapshot().routes).toEqual([]);
        expect(store.getSnapshot().session.resetCount).toBe(1);
    });

    it('removes injected credential canaries from copied diagnostics', async () => {
        const store = getPtvDiagnosticStore();
        const accessCanary = [ 'PTV_TEST', 'ACCESS_TOKEN', 'diagnostics-copy' ].join('_');
        const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        (store.updateContext as (changes: Record<string, unknown>) => void)({
            accessToken: accessCanary,
            request: {
                headers: { Authorization: `Bearer ${accessCanary}` },
                url: `https://server.invalid/socket?api_key=${accessCanary}`
            },
            tokenCount: 8
        });
        store.recordCoordinatorHit({
            endpoint: `https://server.invalid/Items?api_key=${accessCanary}`,
            route: `#/quickconnect?code=${accessCanary}`
        });
        store.startRoute(`#/quickconnect?code=${accessCanary}`);

        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));
        const exportButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Export');
        flushSync(() => exportButton?.click());
        const copyButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Copy diagnostics');

        await act(async () => {
            copyButton?.click();
            await Promise.resolve();
        });

        expect(writeText).toHaveBeenCalledOnce();
        const copied = String(writeText.mock.calls[0]?.[0] || '');
        expect(copied).not.toContain(accessCanary);
        expect(copied).toContain('"privacyClassification": "share-safe"');
    });

    it('renders the passive remote tester, safe graph inspector, and explicit recommendation unknown reason', () => {
        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));

        expect(container.textContent).toContain('Recommendation summary has not been observed.');
        const focusButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Navigation & Focus');

        flushSync(() => focusButton?.click());

        expect(container.textContent).toContain('TV Eligibility');
        expect(container.textContent).toContain('Passive Remote Tester');
        expect(container.textContent).toContain('never emits keys or moves focus');
        expect(container.textContent).toContain('Safe focus graph inspector');
        expect(container.textContent).toContain('Input Timeline');
    });

    it('shows a populated cache as fresh even when its last read was empty', () => {
        const store = getPtvDiagnosticStore();
        store.updateContext({
            cache: {
                ...store.getSnapshot().cache,
                countsObserved: true,
                itemCount: 3,
                lastReadOutcome: 'empty',
                sectionCount: 1,
                state: 'fresh'
            }
        });
        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));
        const cacheButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Cache & Recommendations');
        flushSync(() => cacheButton?.click());

        const cacheCard = Array.from(container.querySelectorAll('.ptv-diagnostics-metric-card'))
            .find(card => card.textContent?.includes('Cache state'));
        expect(cacheCard?.querySelector('.ptv-diagnostics-metric-value')?.textContent).toBe('fresh');
    });

    it('shows recommendation quantities as not observed until an engine generation finishes', () => {
        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));
        const cacheButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Cache & Recommendations');
        flushSync(() => cacheButton?.click());
        const cardValue = (title: string) => Array.from(container.querySelectorAll('.ptv-diagnostics-metric-card'))
            .find(card => card.textContent?.includes(title))
            ?.querySelector('.ptv-diagnostics-metric-value')?.textContent;

        expect(cardValue('Generated rows')).toBe('Not observed');
        expect(cardValue('Recommendation providers')).toBe('Not observed');
        expect(cardValue('Rendered items')).toBe('Not observed');
    });

    it('presents provider, candidate, generated, rendered, and rejection counts separately', () => {
        const store = getPtvDiagnosticStore();
        store.updateContext({
            recommendations: {
                ...store.getSnapshot().recommendations,
                candidateCount: 8,
                diversityCapRejectionCount: 2,
                feedbackRejectionCount: 3,
                generatedItemCount: 5,
                generatedRows: 2,
                identityDuplicateRejectionCount: 1,
                lastGenerationAt: '2026-10-24T10:40:00.000Z',
                providerCount: 4,
                renderedItemCount: null,
                tasteSignalCount: 7,
                terminalOutcome: 'partial'
            }
        });
        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));
        const cacheButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Cache & Recommendations');
        flushSync(() => cacheButton?.click());
        const card = (title: string) => Array.from(container.querySelectorAll('.ptv-diagnostics-metric-card'))
            .find(element => element.textContent?.includes(title));

        expect(card('Recommendation providers')?.textContent).toContain('4');
        expect(card('Recommendation providers')?.textContent).toContain('7 taste signals');
        expect(card('Recommendation candidates')?.textContent).toContain('8');
        expect(card('Generated rows')?.textContent).toContain('2');
        expect(card('Generated rows')?.textContent).toContain('5 generated items');
        expect(card('Rendered items')?.textContent).toContain('Not observed');
        expect(card('Recommendation rejection attempts')?.textContent).toContain('1 identity duplicates');
        expect(card('Recommendation rejection attempts')?.textContent).toContain('2 diversity caps');
        expect(card('Recommendation rejection attempts')?.textContent).toContain('3 feedback/completed');
    });

    it('renders the latest privacy-safe playback aggregates without exposing its opaque key', () => {
        const store = getPtvDiagnosticStore();

        store.upsertPlaybackSession(playbackSession());
        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));
        const playbackButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Playback');

        flushSync(() => playbackButton?.click());

        expect(container.textContent).toContain('HLS Transcode');
        expect(container.textContent).toContain('DEGRADED');
        expect(container.textContent).toContain('LAN_DIRECT');
        expect(container.textContent).toContain('3.25 s');
        expect(container.textContent).toContain('2,500 ms');
        expect(container.textContent).toContain('2→3 @ 300 ms');
        expect(container.textContent).not.toContain('playback-session-dashboard');
        expect(container.textContent).toContain('Media identity, titles, URLs, and Jellyfin session identifiers are never stored.');
    });

    it('coalesces a burst of store events into one bounded snapshot refresh', () => {
        vi.useFakeTimers();
        const store = getPtvDiagnosticStore();
        const getSnapshot = vi.spyOn(store, 'getSnapshot');

        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));
        const baseline = getSnapshot.mock.calls.length;

        for (let index = 0; index < 25; index += 1) {
            store.recordImage({
                cacheClassification: 'browser-managed',
                decodeDurationMs: null,
                durationMs: index,
                fallbackUsed: false,
                occurredAt: new Date().toISOString(),
                role: 'logo',
                routeFamily: 'dashboard/piggietv/diagnostics',
                status: 'loaded'
            });
        }

        expect(getSnapshot.mock.calls.length).toBe(baseline);
        flushSync(() => vi.advanceTimersByTime(1000));
        expect(getSnapshot.mock.calls.length).toBe(baseline + 1);
    });

    it('displays route cancellations separately instead of labelling them failed', () => {
        const store = getPtvDiagnosticStore();
        const requestId = store.beginRequest({ endpoint: '/Items', route: '#/home' });

        store.completeRequest(requestId, {
            cancellation: true,
            errorCategory: 'cancelled',
            success: false
        });
        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));

        expect(container.textContent).toContain('1 retained · 1 cancelled');
        const requestsButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Requests');

        flushSync(() => requestsButton?.click());
        expect(container.querySelector('tbody tr td:nth-child(4)')?.textContent).toBe('cancelled');
    });

    it('surfaces the bounded severe frame warning on the overview', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-25T12:00:00.000Z'));
        const store = getPtvDiagnosticStore();
        const routeId = store.startRoute('#/home');

        vi.setSystemTime(new Date('2026-07-25T12:00:01.000Z'));
        store.markRoutePhase(routeId, 'settled');
        [ 2, 3, 4, 5, 6 ].forEach(second => {
            store.recordFrame(severeFrame(`2026-07-25T12:00:0${second}.000Z`));
        });
        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));

        expect(container.textContent).toContain('SEVERE_FRAME_JANK');
        expect(container.textContent).toContain('sustained severe rendering degradation');
    });

    it('dates a retained slow request without implying latency is still current', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-24T08:47:00.000Z'));
        const store = getPtvDiagnosticStore();
        const requestId = store.beginRequest({ endpoint: '/Items', route: '#/movies' });

        vi.advanceTimersByTime(10_370);
        store.completeRequest(requestId, { status: 200, success: true });
        vi.advanceTimersByTime(2 * 60 * 60_000);
        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));

        expect(container.textContent).toContain('SLOW_API_REQUESTS');
        expect(container.textContent).toContain('2026-10-24T08:47:10.370Z');
        expect(container.textContent).toContain('retained session observation');
        expect(container.textContent).toContain('does not establish current latency');
    });

    it('labels superseded uninstrumented navigation without claiming a critical failure', () => {
        const store = getPtvDiagnosticStore();

        store.startRoute('#/settings');
        store.startRoute('#/collections');
        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));
        const routesButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Routes');

        flushSync(() => routesButton?.click());
        expect(container.textContent).toContain('superseded by navigation');
        expect(container.textContent).toContain('critical work not instrumented');
    });
});
