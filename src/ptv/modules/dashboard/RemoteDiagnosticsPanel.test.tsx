import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/naming-convention
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const pluginApiMocks = vi.hoisted(() => ({
    getRemoteDiagnosticsClients: vi.fn(),
    getRemoteDiagnosticsReport: vi.fn(),
    requestRemoteDiagnosticsSnapshot: vi.fn(),
    startRemoteDiagnosticsSession: vi.fn(),
    stopRemoteDiagnosticsSession: vi.fn()
}));

vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: vi.fn(() => pluginApiMocks),
    normalizePtvApiError: (error: unknown) => ({
        message: error instanceof Error ? error.message : String(error)
    })
}));

import { getCurrentPtvPluginApiClient } from '../../core/pluginApi';
import { RemoteDiagnosticsPanel } from './RemoteDiagnosticsPanel';

const clients = [
    {
        clientId: 'client-webos-one',
        diagnosticsActive: true,
        expiresAtUtc: '2026-07-19T15:10:00.000Z',
        hasReport: true,
        lastLeaseRejection: null,
        lastSeenUtc: '2026-07-19T15:00:00.000Z',
        leasePending: false,
        online: true,
        profile: 'webos',
        reportedAtUtc: '2026-07-19T15:01:00.000Z',
        route: '/home',
        sessionId: 'session-webos-one',
        snapshotPending: false
    },
    {
        clientId: 'client-firetv-two',
        diagnosticsActive: false,
        expiresAtUtc: null,
        hasReport: true,
        lastLeaseRejection: null,
        lastSeenUtc: '2026-07-19T14:59:00.000Z',
        leasePending: false,
        online: true,
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
        .find(candidate => candidate.textContent?.trim() === optionLabel);

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

describe('RemoteDiagnosticsPanel', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(async () => {
        vi.mocked(getCurrentPtvPluginApiClient).mockClear();
        Object.values(pluginApiMocks).forEach(mock => {
            mock.mockReset();
        });
        pluginApiMocks.getRemoteDiagnosticsClients.mockResolvedValue(clients);
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

        await act(async () => {
            root.render(<RemoteDiagnosticsPanel />);
        });
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        document.querySelectorAll('[role="presentation"]').forEach(element => {
            element.remove();
        });
    });

    it('selects the first returned client on initial load', () => {
        expect(pluginApiMocks.getRemoteDiagnosticsClients).toHaveBeenCalledWith(undefined, {
            bypassCache: true
        });
        expect(container.textContent).toContain('Profile / route: webos / /home');
        expect(container.textContent).toContain('2 recent clients');
        expect(getButton(container, 'Start diagnostics').disabled).toBe(false);
        expect(getButton(container, 'Stop').disabled).toBe(false);
    });

    it('starts temporary diagnostics for both supported durations', async () => {
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
        await clickButton(container, 'Stop');
        await clickButton(container, 'Request snapshot');

        expect(pluginApiMocks.stopRemoteDiagnosticsSession).toHaveBeenCalledWith(clients[0].clientId);
        expect(pluginApiMocks.requestRemoteDiagnosticsSnapshot).toHaveBeenCalledWith(clients[0].clientId);
    });

    it('clears a loaded report when another client is selected', async () => {
        await clickButton(container, 'View report');
        expect(pluginApiMocks.getRemoteDiagnosticsReport).toHaveBeenCalledWith(clients[0].clientId, {
            bypassCache: true
        });
        expect(container.textContent).toContain('webos-report-loaded');

        await selectOption(
            container,
            'Client',
            'firetv | /movies | retv-two | online'
        );

        expect(container.textContent).toContain('Profile / route: firetv / /movies');
        expect(container.textContent).not.toContain('webos-report-loaded');
    });
});
