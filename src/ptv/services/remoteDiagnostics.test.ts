import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const diagnosticsMocks = vi.hoisted(() => ({
    profile: {
        isLowPower: false,
        kind: 'desktop',
        layoutMode: 'desktop',
        renderProfile: {
            className: 'ptv-render-desktop',
            id: 'balanced',
            matchReason: 'desktop-default',
            tier: 'balanced'
        },
        supportsAspectRatio: true,
        supportsBackdropFilter: true,
        supportsContainerQueries: true,
        supportsContentVisibility: true,
        tvPlatform: 'none',
        lowPowerProfileDecision: 'not-required',
        lowPowerProfileDecisionReason: 'low-power signals not detected',
        userAgent: 'Mozilla/5.0 Chrome/126.0 Safari/537.36'
    },
    logs: [] as Array<{
        at: string;
        level: 'info';
        message: string;
        route: string;
        scope: string;
    }>,
    unsubscribe: vi.fn()
}));

vi.mock('../core/clientProfile', () => ({
    getPtvClientProfile: () => diagnosticsMocks.profile,
    getPtvPerformanceProfile: () => diagnosticsMocks.profile
}));

vi.mock('./playbackStateService', () => ({
    subscribeToPtvGlobalPlaybackState: () => diagnosticsMocks.unsubscribe
}));

vi.mock('../core/logger', () => ({
    ptvLogger: {
        getEntries: () => diagnosticsMocks.logs
    }
}));

import {
    applyPtvRemoteDiagnosticsLease,
    disposePtvRemoteDiagnosticsAgent,
    getPtvRemoteDiagnosticsPresence,
    getPtvRemoteDiagnosticsSnapshot,
    getPtvRemoteDiagnosticsState,
    recordPtvRemoteDiagnostic,
    setPtvRemoteDiagnosticsTransport,
    startPtvRemoteDiagnosticsAgent
} from './remoteDiagnostics';

describe('remote diagnostics runtime gate', () => {
    const currentTime = 1_700_000_000_000;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(currentTime);
        window.sessionStorage.clear();
        Reflect.deleteProperty(window, 'ApiClient');
        disposePtvRemoteDiagnosticsAgent();
        diagnosticsMocks.unsubscribe.mockClear();
        diagnosticsMocks.logs = [];
        startPtvRemoteDiagnosticsAgent();
    });

    afterEach(() => {
        disposePtvRemoteDiagnosticsAgent();
        vi.useRealTimers();
    });

    it('stays off for a profile mismatch and automatically expires an accepted lease', () => {
        applyPtvRemoteDiagnosticsLease({
            enabled: true,
            expiresAt: currentTime + 5_000,
            profiles: ['webos'],
            sessionId: 'webos-session-123'
        });

        expect(getPtvRemoteDiagnosticsState()).toMatchObject({
            active: false,
            lastLeaseRejection: 'profile-mismatch'
        });
        expect(recordPtvRemoteDiagnostic('system', 'should-not-collect')).toBe(false);

        applyPtvRemoteDiagnosticsLease({
            enabled: true,
            expiresAt: currentTime + 1_000,
            profiles: ['desktop'],
            sessionId: 'desktop-session-123'
        });

        expect(getPtvRemoteDiagnosticsState().active).toBe(true);
        expect(recordPtvRemoteDiagnostic('system', 'collected')).toBe(true);

        vi.advanceTimersByTime(1_001);

        expect(getPtvRemoteDiagnosticsState().active).toBe(false);
        const samples = getPtvRemoteDiagnosticsSnapshot()?.samples || [];

        expect(samples[samples.length - 1]?.name).toBe('session-expired');
        expect(diagnosticsMocks.unsubscribe).toHaveBeenCalledOnce();
    });

    it('copies a bounded sanitized log tail and obeys an explicit server revoke', async () => {
        diagnosticsMocks.logs = [{
            at: '2026-07-19T12:00:00.000Z',
            level: 'info',
            message: 'request token=private-value https://example.test/private?id=7',
            route: '/web/#/items/private-title.mkv?token=private-value',
            scope: 'Playback'
        }];

        applyPtvRemoteDiagnosticsLease({
            enabled: true,
            expiresAt: currentTime + 60_000,
            profiles: ['desktop'],
            sessionId: 'desktop-session-logs'
        });

        const logSample = getPtvRemoteDiagnosticsSnapshot()?.samples.find(sample => sample.kind === 'log');

        expect(logSample).toMatchObject({
            detail: {
                message: '[message-omitted]',
                route: '[url:/items/:id]',
                scope: 'Other'
            },
            name: 'client-log'
        });

        diagnosticsMocks.logs.push({
            at: '2026-07-19T12:00:01.000Z',
            level: 'info',
            message: 'reproduction step finished',
            route: '/web/#/home',
            scope: 'Runtime'
        });
        expect(getPtvRemoteDiagnosticsSnapshot()?.samples.filter(sample => sample.kind === 'log')).toHaveLength(2);
        expect(getPtvRemoteDiagnosticsSnapshot()?.samples.filter(sample => sample.kind === 'log')).toHaveLength(2);

        window.dispatchEvent(new ErrorEvent('error', {
            error: new Error('Failed to play Inside Out'),
            message: 'Failed to play Inside Out'
        }));
        const errorSample = getPtvRemoteDiagnosticsSnapshot()?.samples.find(sample => sample.kind === 'error');

        expect(JSON.stringify(errorSample)).not.toContain('Inside Out');
        expect(errorSample?.detail.error).toEqual({ category: 'media', name: 'Error' });

        setPtvRemoteDiagnosticsTransport({
            checkIn: vi.fn().mockResolvedValue({ disable: true }),
            publishSnapshot: vi.fn().mockResolvedValue(undefined)
        });
        await vi.waitFor(() => expect(getPtvRemoteDiagnosticsState().active).toBe(false));
    });

    it('includes safe client metadata and explicit capabilities in presence', () => {
        Object.assign(window, {
            ApiClient: {
                appName: () => 'Jellyfin Android TV',
                appVersion: () => '0.19.9',
                deviceName: () => "Jonathan's Fire TV"
            }
        });
        diagnosticsMocks.profile = {
            ...diagnosticsMocks.profile,
            kind: 'firetv',
            tvPlatform: 'fire-tv'
        };

        const presence = getPtvRemoteDiagnosticsPresence();

        expect(presence.metadata).toMatchObject({
            applicationName: 'Jellyfin Android TV',
            applicationVersion: '0.19.9',
            deviceDisplayName: "Jonathan's Fire TV",
            platform: 'Fire TV'
        });
        expect(presence.capabilities).toMatchObject({
            heartbeat: true,
            playbackTelemetry: true,
            remoteCommands: true,
            reportExport: true
        });
        expect(presence.boot).toMatchObject({
            checkInAttempted: false,
            diagnosticsModuleLoaded: true,
            platformDetected: 'fire-tv'
        });
        expect(presence.profile.lowPowerProfileDecision).toBe('not-required');
        expect(presence.profile.renderProfile.matchReason).toBe('desktop-default');
        expect(JSON.stringify(presence)).not.toContain('authorization');
        Reflect.deleteProperty(window, 'ApiClient');
    });
});
