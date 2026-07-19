import { beforeEach, describe, expect, it, vi } from 'vitest';

const transportMocks = vi.hoisted(() => ({
    api: null as null | {
        checkInRemoteDiagnostics: ReturnType<typeof vi.fn>;
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
        kind: error.status === 404 ? 'missing' : 'network'
    }),
    waitForCurrentPtvPluginApiClient: () => Promise.resolve(transportMocks.api)
}));

vi.mock('./remoteDiagnostics', () => ({
    disposePtvRemoteDiagnosticsAgent: vi.fn(),
    setPtvRemoteDiagnosticsTransport: (transport: typeof transportMocks.installedTransport) => {
        transportMocks.installedTransport = transport;
        transportMocks.setTransport(transport);
    },
    startPtvRemoteDiagnosticsAgent: transportMocks.startAgent
}));

import { startPtvPluginRemoteDiagnosticsTransport } from './pluginRemoteDiagnosticsTransport';

describe('plugin remote diagnostics capability gate', () => {
    beforeEach(() => {
        transportMocks.serverSequence += 1;
        transportMocks.api = {
            checkInRemoteDiagnostics: vi.fn().mockResolvedValue({}),
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
