import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: () => null
    }
}));

import {
    getCurrentPtvPluginApiClient,
    normalizePtvApiError,
    resetPtvPluginApiAvailability
} from './pluginApi';

afterEach(() => {
    (window as unknown as Record<string, unknown>)['PTV_DEBUG'] = false;
    resetPtvPluginApiAvailability();
    vi.restoreAllMocks();
});

describe('normalizePtvApiError', () => {
    it('classifies HTTP 500 as a plugin server error and sanitizes its response body', () => {
        const sampleCredential = [ 'sample', 'credential' ].join('-');
        const result = normalizePtvApiError({
            message: 'Network middleware reported an unavailable service',
            responseText: `authorization=Bearer ${sampleCredential} token=${sampleCredential}`,
            status: 500
        });

        expect(result).toMatchObject({
            kind: 'server',
            message: 'Plugin server error: endpoint returned HTTP 500',
            status: 500
        });
        expect(result.responseBody).toContain('[REDACTED]');
        expect(result.responseBody).not.toContain(sampleCredential);
    });

    it('keeps transport failures separate from HTTP responses', () => {
        expect(normalizePtvApiError(new TypeError('Failed to fetch'))).toMatchObject({
            kind: 'network',
            message: 'Network failure: endpoint unreachable',
            status: undefined
        });
    });

    it('redacts credentials from raw error messages', () => {
        const credential = [ 'private', 'plugin', 'credential' ].join('-');
        const result = normalizePtvApiError(new Error(
            `Plugin rejected password=${credential} token=${credential}`
        ));

        expect(result.message).toContain('[REDACTED]');
        expect(result.message).not.toContain(credential);
    });

    it('structurally redacts provider credentials from response objects', () => {
        const credential = [ 'private', 'provider', 'credential' ].join('-');
        const result = normalizePtvApiError({
            data: {
                accessKey: credential,
                certificatePassword: credential,
                nested: {
                    openAiApiKey: credential
                }
            },
            message: 'Plugin request failed',
            status: 500
        });

        expect(result.responseBody).toContain('[REDACTED]');
        expect(result.responseBody).not.toContain(credential);
    });

    it('logs only a safe error projection when plugin probing is disabled', async () => {
        const credential = [ 'private', 'transport', 'credential' ].join('-');
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
        (window as unknown as Record<string, unknown>)['PTV_DEBUG'] = true;
        resetPtvPluginApiAvailability();
        const failure = Object.assign(
            new Error(`Request failed token=${credential}`),
            {
                config: { headers: { Authorization: `Bearer ${credential}` } },
                status: 500
            }
        );
        const client = {
            accessToken: () => credential,
            getCurrentUserId: () => 'admin-user',
            getJSON: vi.fn().mockRejectedValue(failure),
            getUrl: (path: string) => `https://private-server.example/${path}`
        };

        await expect(getCurrentPtvPluginApiClient(client)!.getStatus({ bypassCache: true }))
            .rejects.toBe(failure);

        const serialized = JSON.stringify(debug.mock.calls);
        expect(serialized).not.toContain(credential);
        expect(serialized).not.toContain('Authorization');
        expect(debug).toHaveBeenCalledWith(
            '[PTV Plugin API] temporarily disabled plugin endpoint probing',
            expect.objectContaining({ errorCategory: 'server', status: 500 })
        );
    });
});
