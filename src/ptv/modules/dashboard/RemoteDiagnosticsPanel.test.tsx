import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/naming-convention
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const pluginApiMocks = vi.hoisted(() => ({
    getCurrentUserId: vi.fn(() => 'user-1'),
    getJellyfinSessions: vi.fn(),
    getRemoteDiagnosticsClients: vi.fn(),
    getRemoteDiagnosticsReport: vi.fn(),
    requestRemoteDiagnosticsSnapshot: vi.fn(),
    startRemoteDiagnosticsSession: vi.fn(),
    stopRemoteDiagnosticsSession: vi.fn()
}));

const observabilityMocks = vi.hoisted(() => ({
    isPtvDebugEnabled: vi.fn(() => true)
}));

vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: vi.fn(() => pluginApiMocks),
    normalizePtvApiError: (error: unknown) => ({
        message: error instanceof Error ? error.message : String(error)
    })
}));

vi.mock('../../core/observability', () => ({
    isPtvDebugEnabled: observabilityMocks.isPtvDebugEnabled
}));

import { getCurrentPtvPluginApiClient } from '../../core/pluginApi';
import { RemoteDiagnosticsPanel } from './RemoteDiagnosticsPanel';

const capabilities = {
    heartbeat: true,
    memoryMetrics: true,
    navigationTiming: true,
    networkTiming: true,
    performanceMetrics: true,
    playbackTelemetry: true,
    remoteCommands: true,
    reportExport: true
};

const boot = {
    checkInAttempted: true,
    checkInStatus: 200,
    diagnosticsModuleLoaded: true,
    failureCode: null,
    frontendBuildId: 'test-build',
    loadedClientBuildId: 'test-build',
    platformDetected: 'webos',
    ptvRuntimeLoaded: true,
    remoteDiagnosticsRegistrationCount: 1
};

const clients = [
    {
        applicationName: 'Jellyfin Web',
        applicationVersion: '10.11.0',
        boot,
        capabilityMode: 'full-web',
        capabilities,
        clientId: 'client-webos-one',
        deviceName: 'Living Room LG',
        diagnosticsActive: true,
        displayName: 'Living Room LG',
        expiresAtUtc: '2026-07-19T15:10:00.000Z',
        firstSeenUtc: '2026-07-19T14:55:00.000Z',
        hasReport: true,
        lastLeaseRejection: null,
        lastSeenUtc: '2026-07-19T15:00:00.000Z',
        leasePending: false,
        online: true,
        platform: 'LG webOS',
        profile: 'webos',
        reportedAtUtc: '2026-07-19T15:01:00.000Z',
        route: '/home',
        sessionId: 'session-webos-one',
        snapshotPending: false
    },
    {
        applicationName: 'Jellyfin Android TV',
        applicationVersion: '0.19.9',
        boot: {
            ...boot,
            platformDetected: 'fire-tv'
        },
        capabilityMode: 'full-web',
        capabilities,
        clientId: 'client-firetv-two',
        deviceName: "Jonathan's Fire TV",
        diagnosticsActive: false,
        displayName: "Jonathan's Fire TV",
        expiresAtUtc: null,
        firstSeenUtc: '2026-07-19T14:50:00.000Z',
        hasReport: true,
        lastLeaseRejection: null,
        lastSeenUtc: '2026-07-19T14:59:00.000Z',
        leasePending: false,
        online: true,
        platform: 'Fire TV',
        profile: 'firetv',
        reportedAtUtc: '2026-07-19T15:02:00.000Z',
        route: '/movies',
        sessionId: null,
        snapshotPending: false
    }
];

function getButton(container: HTMLElement, label: string) {
    const button = Array.from(container.querySelectorAll('button'))
        .find(candidate => candidate.textContent?.trim() === label);

    if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);

    return button;
}

async function selectOption(container: HTMLElement, label: string, optionLabel: string) {
    const inputLabel = Array.from(container.querySelectorAll('label'))
        .find(candidate => candidate.textContent?.trim() === label);
    const controlId = inputLabel?.getAttribute('for');
    const control = controlId ? document.getElementById(controlId) : null;

    if (!control) throw new Error(`Select not found: ${label}`);

    await act(async () => {
        control.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            button: 0,
            cancelable: true
        }));
    });

    const option = Array.from(document.querySelectorAll('[role="option"]'))
        .find(candidate => candidate.textContent?.trim().includes(optionLabel));

    if (!(option instanceof HTMLElement)) throw new Error(`Option not found: ${optionLabel}`);

    await act(async () => {
        option.click();
    });
}

async function clickButton(container: HTMLElement, label: string) {
    await act(async () => {
        getButton(container, label).click();
    });
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });

    return { promise, reject, resolve };
}

describe('RemoteDiagnosticsPanel', () => {
    let container: HTMLDivElement;
    let root: Root;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    async function renderPanel() {
        await act(async () => {
            root.render(<RemoteDiagnosticsPanel />);
        });
    }

    beforeEach(() => {
        vi.mocked(getCurrentPtvPluginApiClient).mockClear();
        Object.values(pluginApiMocks).forEach(mock => {
            mock.mockReset();
        });
        observabilityMocks.isPtvDebugEnabled.mockReturnValue(true);
        pluginApiMocks.getRemoteDiagnosticsClients.mockResolvedValue(clients);
        pluginApiMocks.getJellyfinSessions.mockResolvedValue([]);
        pluginApiMocks.getRemoteDiagnosticsReport.mockResolvedValue({
            clientId: clients[0].clientId,
            receivedAtUtc: '2026-07-19T15:03:00.000Z',
            report: { marker: 'webos-report-loaded' }
        });
        pluginApiMocks.requestRemoteDiagnosticsSnapshot.mockResolvedValue(undefined);
        pluginApiMocks.startRemoteDiagnosticsSession.mockResolvedValue(undefined);
        pluginApiMocks.stopRemoteDiagnosticsSession.mockResolvedValue(undefined);

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        document.querySelectorAll('[role="presentation"]').forEach(element => {
            element.remove();
        });
        consoleWarnSpy.mockRestore();
    });

    it('selects the first returned client on initial load', async () => {
        await renderPanel();

        expect(pluginApiMocks.getRemoteDiagnosticsClients).toHaveBeenCalledWith(undefined, {
            bypassCache: true
        });
        expect(pluginApiMocks.getJellyfinSessions).toHaveBeenCalledWith({
            activeWithinSeconds: 300,
            controllableByUserId: 'user-1'
        });
        expect(container.textContent).toContain('Profile / route: webos / /home');
        expect(container.textContent).toContain('2 recent clients');
        expect(getButton(container, 'Start diagnostics').disabled).toBe(false);
        expect(getButton(container, 'Stop').disabled).toBe(false);
    });

    it('starts temporary diagnostics for both supported durations', async () => {
        await renderPanel();

        await clickButton(container, 'Start diagnostics');

        expect(pluginApiMocks.startRemoteDiagnosticsSession).toHaveBeenLastCalledWith(
            clients[0].clientId,
            5
        );

        await selectOption(container, 'Duration', '10 minutes');
        await clickButton(container, 'Start diagnostics');

        expect(pluginApiMocks.startRemoteDiagnosticsSession).toHaveBeenLastCalledWith(
            clients[0].clientId,
            10
        );
    });

    it('stops an active lease and requests a snapshot for the selected client', async () => {
        await renderPanel();

        await clickButton(container, 'Stop');
        await clickButton(container, 'Request snapshot');

        expect(pluginApiMocks.stopRemoteDiagnosticsSession).toHaveBeenCalledWith(clients[0].clientId);
        expect(pluginApiMocks.requestRemoteDiagnosticsSnapshot).toHaveBeenCalledWith(clients[0].clientId);
    });

    it('clears a loaded report when another client is selected', async () => {
        await renderPanel();

        await clickButton(container, 'View report');
        expect(pluginApiMocks.getRemoteDiagnosticsReport).toHaveBeenCalledWith(clients[0].clientId, {
            bypassCache: true
        });
        expect(container.textContent).toContain('webos-report-loaded');

        await selectOption(
            container,
            'Client',
            "Jonathan's Fire TV | Fire TV | Jellyfin Android TV 0.19.9 | online"
        );

        expect(container.textContent).toContain('Profile / route: firetv / /movies');
        expect(container.textContent).not.toContain('webos-report-loaded');
    });

    it('skips a malformed item with an undefined client id while valid clients still render', async () => {
        pluginApiMocks.getRemoteDiagnosticsClients.mockResolvedValue([
            {
                clientId: undefined,
                profile: 'webos',
                route: '/broken'
            },
            clients[1]
        ]);

        await renderPanel();

        expect(container.textContent).toContain('1 recent client');
        expect(container.textContent).toContain('Profile / route: firetv / /movies');
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            '[PiggieTV Dashboard] Malformed remote diagnostics client skipped or normalized.',
            expect.objectContaining({
                componentName: 'RemoteDiagnosticsPanel',
                itemId: '[missing]',
                itemType: 'remote-diagnostics-client',
                missingProperty: 'clientId',
                source: 'plugin-cache',
                sourceRow: 'remote-diagnostics-clients[0]'
            })
        );
    });

    it('normalizes null display fields without crashing the formatter', async () => {
        pluginApiMocks.getRemoteDiagnosticsClients.mockResolvedValue([
            {
                clientId: 'client-null-fields',
                diagnosticsActive: null,
                expiresAtUtc: null,
                hasReport: null,
                lastLeaseRejection: null,
                lastSeenUtc: null,
                leasePending: null,
                online: null,
                profile: null,
                reportedAtUtc: null,
                route: null,
                sessionId: null,
                snapshotPending: null
            }
        ]);

        await renderPanel();

        expect(container.textContent).toContain('Profile / route: unknown / /unknown');
        expect(container.textContent).toContain('Last seen: n/a');
        expect(container.textContent).toContain('Session: off');
        expect(container.textContent).toContain('Latest report: none');
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            '[PiggieTV Dashboard] Malformed remote diagnostics client skipped or normalized.',
            expect.objectContaining({
                itemId: 'client-null-fields',
                missingProperty: 'route',
                sourceRow: 'remote-diagnostics-clients[0]'
            })
        );
    });

    it('treats a missing client array response as an empty state', async () => {
        pluginApiMocks.getRemoteDiagnosticsClients.mockResolvedValue(undefined);

        await renderPanel();

        expect(container.textContent).toContain('0 recent clients');
        expect(container.textContent).toContain('No supported PTV clients have checked in yet.');
        expect(getButton(container, 'Start diagnostics').disabled).toBe(true);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            '[PiggieTV Dashboard] Malformed remote diagnostics client skipped or normalized.',
            expect.objectContaining({
                missingProperty: 'clients',
                sourceRow: 'remote-diagnostics-clients'
            })
        );
    });

    it('renders an empty response without enabling client actions', async () => {
        pluginApiMocks.getRemoteDiagnosticsClients.mockResolvedValue([]);

        await renderPanel();

        expect(container.textContent).toContain('0 recent clients');
        expect(container.textContent).toContain('No supported PTV clients have checked in yet.');
        expect(getButton(container, 'Start diagnostics').disabled).toBe(true);
        expect(getButton(container, 'Stop').disabled).toBe(true);
    });

    it('shows active native Fire TV sessions as detected but unsupported when no PTV check-in exists', async () => {
        pluginApiMocks.getRemoteDiagnosticsClients.mockResolvedValue([]);
        pluginApiMocks.getJellyfinSessions.mockResolvedValue([{
            ApplicationVersion: '0.19.9',
            Client: 'Jellyfin Android TV',
            DeviceId: 'fire-device',
            DeviceName: "Jonathan's Fire TV",
            Id: 'fire-session',
            LastActivityDate: '2026-07-19T15:04:00.000Z',
            NowPlayingItem: { Name: 'Inside Out' }
        }]);

        await renderPanel();

        expect(container.textContent).toContain('Detected Jellyfin sessions');
        expect(container.textContent).toContain("Jonathan's Fire TV");
        expect(container.textContent).toContain('unsupported');
        expect(container.textContent).toContain("Jonathan's Fire TV is connected through Jellyfin Android TV 0.19.9, but that native app does not currently include the PTV diagnostics client.");
        expect(container.textContent).toContain('0 recent clients');
        expect(getButton(container, 'Start diagnostics').disabled).toBe(true);
        expect(getButton(container, 'Request snapshot').disabled).toBe(true);
    });

    it('shows webOS sessions with a runtime/cache explanation until a real check-in arrives', async () => {
        pluginApiMocks.getRemoteDiagnosticsClients.mockResolvedValue([]);
        pluginApiMocks.getJellyfinSessions.mockResolvedValue([{
            ApplicationVersion: '1.2.2',
            Client: 'Jellyfin for WebOS',
            DeviceId: 'webos-device',
            DeviceName: 'LG Smart TV',
            Id: 'webos-session',
            LastActivityDate: '2026-07-19T15:05:00.000Z'
        }]);

        await renderPanel();

        expect(container.textContent).toContain('LG Smart TV');
        expect(container.textContent).toContain('Jellyfin for WebOS 1.2.2');
        expect(container.textContent).toContain('has not produced a PTV runtime/check-in marker');
        expect(getButton(container, 'Start diagnostics').disabled).toBe(true);
    });

    it('disables remote actions for clients without explicit command/report capability', async () => {
        pluginApiMocks.getRemoteDiagnosticsClients.mockResolvedValue([{
            ...clients[1],
            capabilities: {
                ...capabilities,
                remoteCommands: false,
                reportExport: false
            },
            hasReport: true
        }]);

        await renderPanel();

        expect(container.textContent).toContain("Jonathan's Fire TV");
        expect(getButton(container, 'Start diagnostics').disabled).toBe(true);
        expect(getButton(container, 'Request snapshot').disabled).toBe(true);
        expect(getButton(container, 'View report').disabled).toBe(true);
        expect(getButton(container, 'Download report').disabled).toBe(true);
    });

    it('keeps duplicate device names distinct without making the suffix the primary label', async () => {
        pluginApiMocks.getRemoteDiagnosticsClients.mockResolvedValue([
            {
                ...clients[1],
                clientId: 'client-firetv-alpha',
                displayName: "Jonathan's Fire TV"
            },
            {
                ...clients[1],
                clientId: 'client-firetv-beta',
                displayName: "Jonathan's Fire TV"
            }
        ]);

        await renderPanel();
        await selectOption(
            container,
            'Client',
            "Jonathan's Fire TV | id tv-alpha | Fire TV | Jellyfin Android TV 0.19.9 | online"
        );

        expect(container.textContent).toContain("Client: Jonathan's Fire TV (Fire TV)");
    });

    it('manual refresh recovers after an initial zero-client response', async () => {
        pluginApiMocks.getRemoteDiagnosticsClients
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(clients);

        await renderPanel();

        expect(container.textContent).toContain('No supported PTV clients have checked in yet.');

        await clickButton(container, 'Refresh clients');

        expect(container.textContent).toContain('2 recent clients');
        expect(container.textContent).toContain('Client: Living Room LG (LG webOS)');
    });

    it('shows loading state while clients are partially loaded', async () => {
        const deferred = createDeferred<typeof clients>();
        pluginApiMocks.getRemoteDiagnosticsClients.mockReturnValue(deferred.promise);

        await renderPanel();

        expect(container.textContent).toContain('Loading remote diagnostics clients...');
        expect(getButton(container, 'Start diagnostics').disabled).toBe(true);

        await act(async () => {
            deferred.resolve(clients);
            await deferred.promise;
        });

        expect(container.textContent).toContain('2 recent clients');
        expect(container.textContent).toContain('Profile / route: webos / /home');
    });
});
