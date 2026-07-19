import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectionMocks = vi.hoisted(() => ({
    client: null as null | {
        accessToken: () => string;
        ajax: ReturnType<typeof vi.fn>;
        getCurrentUserId: () => string;
        getJSON: ReturnType<typeof vi.fn>;
        getUrl: (path: string, params?: Record<string, unknown>) => string;
    }
}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: () => connectionMocks.client
    }
}));

import { getCurrentPtvPluginApiClient, resetPtvPluginApiAvailability } from './pluginApi';

describe('plugin remote diagnostics transport', () => {
    beforeEach(() => {
        resetPtvPluginApiAvailability();
        const ajax = vi.fn(async () => undefined);
        const getJSON = vi.fn(async () => []);

        connectionMocks.client = {
            accessToken: () => 'authenticated',
            ajax,
            getCurrentUserId: () => 'user',
            getJSON,
            getUrl: (path, params) => {
                const query = Object.entries(params || {})
                    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
                    .join('&');
                const querySuffix = query ? `?${query}` : '';

                return `http://localhost:8096/${path}${querySuffix}`;
            }
        };
    });

    it('posts minimal presence and reports through authenticated local plugin routes', async () => {
        const pluginApi = getCurrentPtvPluginApiClient(connectionMocks.client!);
        const presence = {
            clientId: 'ptv-client_12345',
            diagnostics: { active: false, expiresAt: null, sessionId: null },
            profile: { kind: 'webos' },
            route: '/home',
            schemaVersion: 1,
            seenAt: 1
        };

        await pluginApi!.checkInRemoteDiagnostics(presence, { bypassCache: true });
        await pluginApi!.publishRemoteDiagnosticsReport({
            client: { clientId: presence.clientId },
            schemaVersion: 1,
            session: { sessionId: 'session_12345' }
        });

        expect(connectionMocks.client!.ajax).toHaveBeenNthCalledWith(1, expect.objectContaining({
            data: JSON.stringify(presence),
            method: 'POST',
            url: 'http://localhost:8096/Ptv/v1/diagnostics/clients/check-in'
        }));
        expect(connectionMocks.client!.ajax).toHaveBeenNthCalledWith(2, expect.objectContaining({
            method: 'POST',
            url: 'http://localhost:8096/Ptv/v1/diagnostics/clients/report'
        }));
    });

    it('uses admin routes for profile filtering, leases, snapshots, reports, and stop', async () => {
        const pluginApi = getCurrentPtvPluginApiClient(connectionMocks.client!);
        const clientId = 'ptv-client_12345';

        await pluginApi!.getRemoteDiagnosticsClients('webos', { bypassCache: true });
        await pluginApi!.startRemoteDiagnosticsSession(clientId, 10);
        await pluginApi!.requestRemoteDiagnosticsSnapshot(clientId);
        await pluginApi!.getRemoteDiagnosticsReport(clientId, { bypassCache: true });
        await pluginApi!.stopRemoteDiagnosticsSession(clientId);

        expect(connectionMocks.client!.getJSON).toHaveBeenNthCalledWith(
            1,
            'http://localhost:8096/Ptv/v1/diagnostics/clients?profile=webos',
            true
        );
        expect(connectionMocks.client!.ajax).toHaveBeenNthCalledWith(1, expect.objectContaining({
            data: JSON.stringify({ durationMinutes: 10 }),
            method: 'POST',
            url: `http://localhost:8096/Ptv/v1/diagnostics/clients/${clientId}/sessions`
        }));
        expect(connectionMocks.client!.ajax).toHaveBeenNthCalledWith(2, expect.objectContaining({
            method: 'POST',
            url: `http://localhost:8096/Ptv/v1/diagnostics/clients/${clientId}/snapshot`
        }));
        expect(connectionMocks.client!.getJSON).toHaveBeenNthCalledWith(
            2,
            `http://localhost:8096/Ptv/v1/diagnostics/clients/${clientId}/report`,
            true
        );
        expect(connectionMocks.client!.ajax).toHaveBeenNthCalledWith(3, expect.objectContaining({
            method: 'DELETE',
            url: `http://localhost:8096/Ptv/v1/diagnostics/clients/${clientId}/sessions`
        }));
    });

    it('does not try to parse a 204 response body', async () => {
        const json = vi.fn(async () => {
            throw new Error('No response body');
        });

        connectionMocks.client!.ajax.mockResolvedValueOnce({ json, status: 204 });
        const pluginApi = getCurrentPtvPluginApiClient(connectionMocks.client!);

        await expect(pluginApi!.stopRemoteDiagnosticsSession('ptv-client_12345')).resolves.toBeUndefined();
        expect(json).not.toHaveBeenCalled();
    });
});
