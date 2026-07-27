import { beforeEach, describe, expect, it, vi } from 'vitest';

const transportMocks = vi.hoisted(() => ({
    api: null as null | {
        checkInRemoteDiagnostics: ReturnType<typeof vi.fn>;
        getRemoteDiagnosticsCheckInUrl: ReturnType<typeof vi.fn>;
        getRemoteDiagnosticsReportDownloadUrl: ReturnType<typeof vi.fn>;
        getStatus: ReturnType<typeof vi.fn>;
        publishRemoteDiagnosticsReport: ReturnType<typeof vi.fn>;
    },
    installedTransport: null as null | {
        checkIn: (presence: unknown) => Promise<unknown>;
        publishSnapshot: (payload: unknown) => Promise<void>;
    },
    serverSequence: 0,
    setTransport: vi.fn(),
    startAgent: vi.fn()
}));

vi.mock('../core/pluginApi', () => ({
    normalizePtvApiError: (error: { status?: number }) => ({
        kind: error.status === 404 ? 'missing' : 'network',
        message: error.status ? `HTTP ${error.status}` : 'network'
    }),
    waitForCurrentPtvPluginApiClient: () => Promise.resolve(transportMocks.api)
}));

vi.mock('./remoteDiagnostics', () => ({
    disposePtvRemoteDiagnosticsAgent: vi.fn(),
    setPtvRemoteDiagnosticsTransport: (transport: typeof transportMocks.installedTransport) => {
        transportMocks.installedTransport = transport;
        transportMocks.setTransport(transport);
    },
    startPtvRemoteDiagnosticsAgent: transportMocks.startAgent,
    updatePtvRemoteDiagnosticsBootMarker: vi.fn()
}));

import {
    getPtvPluginRemoteDiagnosticsTransportDebug,
    startPtvPluginRemoteDiagnosticsTransport
} from './pluginRemoteDiagnosticsTransport';

describe('plugin remote diagnostics capability gate', () => {
    beforeEach(() => {
        transportMocks.serverSequence += 1;
        transportMocks.api = {
            checkInRemoteDiagnostics: vi.fn().mockResolvedValue({}),
            getRemoteDiagnosticsCheckInUrl: vi.fn().mockReturnValue(`https://jellyfin-${transportMocks.serverSequence}.test/Ptv/v1/diagnostics/clients/check-in`),
            getRemoteDiagnosticsReportDownloadUrl: vi.fn().mockReturnValue(`https://jellyfin-${transportMocks.serverSequence}.test/Ptv/v1/diagnostics/clients/capability-probe/report/download`),
            getStatus: vi.fn(),
            publishRemoteDiagnosticsReport: vi.fn().mockResolvedValue(undefined)
        };
        transportMocks.installedTransport = null;
        transportMocks.setTransport.mockClear();
        transportMocks.startAgent.mockClear();
    });

    it('disables local collection without polling missing diagnostics endpoints', async () => {
        transportMocks.api!.getStatus.mockResolvedValue({ features: ['status'] });
        startPtvPluginRemoteDiagnosticsTransport();

        const command = await transportMocks.installedTransport!.checkIn({});
        await transportMocks.installedTransport!.publishSnapshot({});

        expect(command).toEqual({ disable: true });
        expect(transportMocks.api!.checkInRemoteDiagnostics).not.toHaveBeenCalled();
        expect(transportMocks.api!.publishRemoteDiagnosticsReport).not.toHaveBeenCalled();
        expect(transportMocks.api!.getStatus).toHaveBeenCalledOnce();
        expect(getPtvPluginRemoteDiagnosticsTransportDebug()).toMatchObject({
            bootstrapLoaded: true,
            capabilityAdvertised: false,
            checkInEndpointUrl: `https://jellyfin-${transportMocks.serverSequence}.test/Ptv/v1/diagnostics/clients/check-in`,
            registrationAttempted: true
        });
    });

    it('uses and caches an advertised remoteDiagnostics capability', async () => {
        transportMocks.api!.getStatus.mockResolvedValue({ featureFlags: { remoteDiagnostics: true } });
        transportMocks.api!.checkInRemoteDiagnostics.mockResolvedValue({ requestSnapshot: true });
        startPtvPluginRemoteDiagnosticsTransport();

        await expect(transportMocks.installedTransport!.checkIn({ clientId: 'client' })).resolves.toEqual({
            requestSnapshot: true
        });
        await transportMocks.installedTransport!.publishSnapshot({ schemaVersion: 1 });

        expect(transportMocks.api!.getStatus).toHaveBeenCalledOnce();
        expect(transportMocks.api!.checkInRemoteDiagnostics).toHaveBeenCalledOnce();
        expect(transportMocks.api!.publishRemoteDiagnosticsReport).toHaveBeenCalledOnce();
        expect(getPtvPluginRemoteDiagnosticsTransportDebug()).toMatchObject({
            capabilityAdvertised: true,
            detectedClientProfile: null,
            generatedClientId: 'client',
            lastFailureReason: null,
            lastHeartbeatStatus: 200,
            registrationAttempted: true
        });
    });

    it('normalizes PascalCase Jellyfin lease commands at the transport boundary', async () => {
        transportMocks.api!.getStatus.mockResolvedValue({ featureFlags: { remoteDiagnostics: true } });
        transportMocks.api!.checkInRemoteDiagnostics.mockResolvedValue({
            Disable: false,
            Lease: {
                DurationMs: 300_000,
                Enabled: true,
                ExpiresAt: 1_700_000_300_000,
                IssuedAt: 1_700_000_000_000,
                Profiles: ['webos'],
                SessionId: 'session-pascal'
            },
            RequestSnapshot: true
        });
        startPtvPluginRemoteDiagnosticsTransport();

        await expect(transportMocks.installedTransport!.checkIn({ clientId: 'client' })).resolves.toEqual({
            disable: false,
            lease: {
                durationMs: 300_000,
                enabled: true,
                expiresAt: 1_700_000_300_000,
                issuedAt: 1_700_000_000_000,
                profiles: ['webos'],
                sessionId: 'session-pascal'
            },
            requestSnapshot: true
        });
    });

    it('records sanitized check-in failure diagnostics without payload details', async () => {
        transportMocks.api!.getStatus.mockResolvedValue({ featureFlags: { remoteDiagnostics: true } });
        transportMocks.api!.checkInRemoteDiagnostics.mockRejectedValue({ status: 401, secret: 'private-token' });
        startPtvPluginRemoteDiagnosticsTransport();

        await expect(transportMocks.installedTransport!.checkIn({
            clientId: 'client-private',
            profile: { kind: 'firetv' }
        })).rejects.toMatchObject({ status: 401 });

        expect(getPtvPluginRemoteDiagnosticsTransportDebug()).toMatchObject({
            detectedClientProfile: 'firetv',
            generatedClientId: 'client-private',
            lastFailureReason: 'HTTP 401',
            lastHeartbeatStatus: 401
        });
        expect(JSON.stringify(getPtvPluginRemoteDiagnosticsTransportDebug())).not.toContain('private-token');
    });

    it('rechecks an unavailable capability after the bounded backoff', async () => {
        const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

        transportMocks.api!.getStatus.mockResolvedValueOnce({ features: ['status'] });
        startPtvPluginRemoteDiagnosticsTransport();
        await expect(transportMocks.installedTransport!.checkIn({})).resolves.toEqual({ disable: true });

        transportMocks.api!.getStatus.mockResolvedValue({ features: ['remoteDiagnostics'] });
        clock.mockReturnValue(1_700_000_000_000 + 5 * 60 * 1000 + 1);
        await expect(transportMocks.installedTransport!.checkIn({})).resolves.toEqual({});

        expect(transportMocks.api!.getStatus).toHaveBeenCalledTimes(2);
        clock.mockRestore();
    });
});
